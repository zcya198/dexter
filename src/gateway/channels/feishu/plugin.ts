/**
 * Feishu Channel Plugin
 * Implements the ChannelPlugin interface for Feishu/Lark Bot
 */

import { z } from 'zod';
import http from 'node:http';
import https from 'node:https';
import { readFileSync } from 'node:fs';
import { logger } from '../../../utils/logger.js';
import { getOrCreateClient, removeClient } from './api.js';
import {
  processFeishuInbound,
  verifyFeishuWebhook,
  type InboundHandler,
  type FeishuInboundEvent,
} from './inbound.js';
import { sendFeishuText, sendFeishuGroupText } from './outbound.js';
import type {
  FeishuAccountConfig,
  ChannelId,
  ChannelPlugin,
  ChannelConfigAdapter,
  ChannelGatewayAdapter,
  ChannelStartContext,
  ChannelRuntimeSnapshot,
} from './types.js';
import type { GatewayConfig } from '../../config.js';

// ============================================================
// Config Schema
// ============================================================

const FeishuAccountSchema = z.object({
  enabled: z.boolean().optional().default(true),
  appId: z.string().describe('Feishu Bot App ID'),
  appSecret: z.string().describe('Feishu Bot App Secret'),
  verificationToken: z.string().optional(),
  encryptKey: z.string().optional(),
  allowFrom: z.array(z.string()).optional().default([]),
  dmEnabled: z.boolean().optional().default(true),
  groupEnabled: z.boolean().optional().default(false),
});

const FeishuConfigSchema = z.object({
  enabled: z.boolean().optional(),
  port: z.number().optional().default(8088),
  host: z.string().optional().default('0.0.0.0'),
  accounts: z.record(z.string(), FeishuAccountSchema).optional(),
  allowFrom: z.array(z.string()).optional().default([]),
});

export type FeishuPluginConfig = z.infer<typeof FeishuConfigSchema>;

// ============================================================
// Channel Config Adapter
// ============================================================

function listFeishuAccountIds(cfg: GatewayConfig & { channels?: { feishu?: FeishuPluginConfig } }): string[] {
  const accounts = cfg.channels?.feishu?.accounts ?? {};
  const ids = Object.keys(accounts);
  return ids.length > 0 ? ids : ['default'];
}

function resolveFeishuAccount(
  cfg: GatewayConfig & { channels?: { feishu?: FeishuPluginConfig } },
  accountId: string,
): FeishuAccountConfig {
  const pluginCfg = cfg.channels?.feishu;
  const account = pluginCfg?.accounts?.[accountId] ?? {};

  return {
    accountId,
    appId: account.appId || process.env.FEISHU_APP_ID || '',
    appSecret: account.appSecret || process.env.FEISHU_APP_SECRET || '',
    verificationToken: account.verificationToken || pluginCfg?.accounts?.[accountId]?.verificationToken,
    encryptKey: account.encryptKey || pluginCfg?.accounts?.[accountId]?.encryptKey,
    allowFrom: account.allowFrom ?? pluginCfg?.allowFrom ?? [],
    dmEnabled: account.dmEnabled ?? true,
    groupEnabled: account.groupEnabled ?? false,
  };
}

function isFeishuConfigured(
  account: FeishuAccountConfig,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _cfg: GatewayConfig,
): boolean {
  return !!(account.appId && account.appSecret);
}

export const feishuConfig: ChannelConfigAdapter<GatewayConfig, FeishuAccountConfig> = {
  listAccountIds: listFeishuAccountIds,
  resolveAccount: resolveFeishuAccount,
  isConfigured: isFeishuConfigured,
};

// ============================================================
// Inbound Handler (passed from gateway)
// ============================================================

let globalInboundHandler: InboundHandler | null = null;

export function setGlobalFeishuHandler(handler: InboundHandler): void {
  globalInboundHandler = handler;
}

// ============================================================
// HTTP Server
// ============================================================

function createWebhookServer(
  account: FeishuAccountConfig,
  port: number,
  host: string,
  tlsCert?: { key: string; cert: string },
): http.Server {
  const server = tlsCert
    ? https.createServer({ key: tlsCert.key, cert: tlsCert.cert })
    : http.createServer();

  const inboundHandler: InboundHandler = async (event: FeishuInboundEvent) => {
    // Check allowlist
    if (account.allowFrom.length > 0 && !account.allowFrom.includes(event.openId)) {
      logger.debug(`[Feishu] Ignoring message from unauthorized user: ${event.openId}`);
      return;
    }

    // Check DM/Group policy
    if (event.chatType === 'direct' && !account.dmEnabled) {
      logger.debug('[Feishu] DM disabled, ignoring message');
      return;
    }
    if (event.chatType === 'group' && !account.groupEnabled) {
      logger.debug('[Feishu] Group messages disabled, ignoring');
      return;
    }

    if (globalInboundHandler) {
      await globalInboundHandler(event);
    }
  };

  server.on('request', async (req, res) => {
    const url = req.url || '/';

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-Feishu-Event-Type',
      });
      res.end();
      return;
    }

    // Health check
    if (url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', channel: 'feishu' }));
      return;
    }

    // Webhook endpoint
    if (req.method === 'POST' && (url === '/webhook' || url === `/webhook/${account.accountId}`)) {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        try {
          const data = JSON.parse(body);

          // URL verification challenge
          const verifyResult = verifyFeishuWebhook(data, account.verificationToken);
          if (verifyResult) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ challenge: verifyResult.challenge }));
            return;
          }

          // Process inbound message
          processFeishuInbound(data, account, inboundHandler);

          // Always respond quickly to Feishu
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 0, msg: 'ok' }));
        } catch (err) {
          logger.error(`[Feishu] Error handling webhook: ${err}`);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 500, msg: 'internal error' }));
        }
      });
      return;
    }

    // Unknown route
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  return server;
}

// ============================================================
// Channel Gateway Adapter
// ============================================================

async function startFeishuAccount(ctx: ChannelStartContext<FeishuAccountConfig>): Promise<void> {
  const { account, setStatus } = ctx;

  logger.info(`[Feishu] Starting account ${account.accountId}...`);

  // Validate credentials
  if (!account.appId || !account.appSecret) {
    throw new Error(`Feishu account ${account.accountId}: appId and appSecret are required`);
  }

  // Create API client and verify credentials
  const client = getOrCreateClient(account);
  try {
    const botInfo = await client.getBotInfo();
    logger.info(`[Feishu] Bot info: ${botInfo.app_name} (${botInfo.app_id})`);
    setStatus({ botName: botInfo.app_name });
  } catch (err) {
    logger.error(`[Feishu] Failed to get bot info: ${err}`);
    throw err;
  }

  // Get port from config (default 8088 + account index)
  const port = parseInt(process.env.FEISHU_WEBHOOK_PORT || '8088', 10);
  const host = process.env.FEISHU_WEBHOOK_HOST || '0.0.0.0';

  const server = createWebhookServer(account, port, host);

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, host, () => {
      logger.info(`[Feishu] Webhook server listening on ${host}:${port}`);
      logger.info(`[Feishu] Webhook URL: http://${host}:${port}/webhook`);
      logger.info(`[Feishu] Configure this URL in your Feishu app's event subscription settings`);
      resolve();
    });
  });

  setStatus({ running: true, connected: true });

  // Cleanup on abort
  ctx.abortSignal.addEventListener('abort', () => {
    logger.info(`[Feishu] Stopping account ${account.accountId}...`);
    server.close();
    removeClient(account.accountId);
    setStatus({ running: false, connected: false, lastStopAt: Date.now() });
  });
}

// ============================================================
// Channel Plugin Definition
// ============================================================

export const feishuPlugin: ChannelPlugin<GatewayConfig, FeishuAccountConfig> = {
  id: 'feishu' as ChannelId,
  config: feishuConfig,
  gateway: { startAccount: startFeishuAccount },
  status: {
    defaultRuntime: {
      accountId: 'default',
      running: false,
      connected: false,
      lastError: null,
    },
  },
};

// Export account config schema for use in gateway config
export { FeishuAccountSchema, FeishuConfigSchema };
