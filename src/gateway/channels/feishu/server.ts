/**
 * Standalone Feishu Bot Server
 * A lightweight HTTP server that acts as a Feishu Bot frontend for Dexter.
 * Receives messages from Feishu and forwards them to the Dexter agent.
 *
 * Run separately from the main Dexter gateway.
 *
 * Usage:
 *   bun run src/gateway/channels/feishu/server.ts
 *
 * Environment variables:
 *   FEISHU_APP_ID        - Bot App ID
 *   FEISHU_APP_SECRET    - Bot App Secret
 *   FEISHU_VERIFICATION_TOKEN - Webhook verification token (optional)
 *   FEISHU_PORT          - HTTP server port (default: 8088)
 *   FEISHU_HOST          - HTTP server host (default: 0.0.0.0)
 *   DEXTER_AGENT_URL      - URL of Dexter agent (default: http://localhost:3000)
 */

import http from 'node:http';
import { FeishuApiClient } from './api.js';
import { verifyFeishuWebhook } from './inbound.js';
import type { FeishuMessageEvent, FeishuInboundEvent } from './types.js';

const FEISHU_APP_ID = process.env.FEISHU_APP_ID || '';
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || '';
const FEISHU_VERIFICATION_TOKEN = process.env.FEISHU_VERIFICATION_TOKEN;
const FEISHU_PORT = parseInt(process.env.FEISHU_PORT || '8088', 10);
const FEISHU_HOST = process.env.FEISHU_HOST || '0.0.0.0';
const DEXTER_AGENT_URL = process.env.DEXTER_AGENT_URL || 'http://localhost:3000';

// In-memory session store (simple, per-user conversation context)
const userSessions = new Map<string, { openId: string; lastMessageId: string; lastTime: number }>();

// Rate limiting: max messages per user per minute
const RATE_LIMIT = 10;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(openId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(openId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(openId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= RATE_LIMIT) {
    return false;
  }
  entry.count++;
  return true;
}

async function callDexterAgent(message: string, sessionKey?: string): Promise<string> {
  const body: Record<string, unknown> = {
    message: message.trim(),
  };
  if (sessionKey) {
    body.sessionKey = sessionKey;
  }

  try {
    const response = await fetch(`${DEXTER_AGENT_URL}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Dexter agent returned ${response.status}`);
    }

    const data = (await response.json()) as { response?: string; text?: string; message?: string };
    return data.response || data.text || data.message || '抱歉，Agent 没有返回内容。';
  } catch (err) {
    console.error(`[Feishu Server] Error calling Dexter agent: ${err}`);
    return '抱歉，Agent 服务暂时不可用。请稍后再试。';
  }
}

function parseInboundEvent(raw: FeishuMessageEvent): FeishuInboundEvent | null {
  const msg = raw.event?.message;
  if (!msg) return null;

  const senderOpenId = msg.sender?.sender_id?.open_id || '';
  const openId = msg.sender?.sender_id?.open_id || '';
  const chatId = msg.chat_id || '';
  const chatType = (msg.chat_type || 'direct') as 'direct' | 'group';
  const content = FeishuApiClient.parseMessageContent(msg.content || '', msg.message_type || 'text');

  return {
    accountId: 'default',
    eventId: raw.header?.event_id || '',
    eventType: raw.header?.event_type || '',
    openId,
    chatId,
    chatType,
    messageId: msg.message_id || '',
    content,
    messageType: msg.message_type || 'text',
    senderOpenId,
    senderType: (msg.sender?.sender_type as 'user' | 'bot') || 'user',
    timestamp: msg.create_time || raw.header?.create_time || new Date().toISOString(),
    raw,
  };
}

async function handleWebhook(
  client: FeishuApiClient,
  bodyStr: string,
): Promise<{ status: number; body: string }> {
  let body: unknown;
  try {
    body = JSON.parse(bodyStr);
  } catch {
    return { status: 400, body: JSON.stringify({ error: 'invalid JSON' }) };
  }

  // URL verification
  const verifyResult = verifyFeishuWebhook(body as Record<string, unknown>, FEISHU_VERIFICATION_TOKEN);
  if (verifyResult) {
    return { status: 200, body: JSON.stringify({ challenge: verifyResult.challenge }) };
  }

  const event = parseInboundEvent(body as FeishuMessageEvent);
  if (!event) {
    return { status: 200, body: JSON.stringify({ code: 0, msg: 'event ignored' }) };
  }

  // Ignore bot messages
  if (event.senderType === 'bot') {
    return { status: 200, body: JSON.stringify({ code: 0, msg: 'bot message ignored' }) };
  }

  // Rate limiting
  if (!checkRateLimit(event.openId)) {
    console.warn(`[Feishu Server] Rate limit exceeded for user ${event.openId}`);
    await client.sendMessage({
      receive_id: event.openId,
      receive_id_type: 'open_id',
      msg_type: 'text',
      content: JSON.stringify({ text: '消息发送过于频繁，请稍后再试。' }),
    });
    return { status: 200, body: JSON.stringify({ code: 0, msg: 'rate limited' }) };
  }

  // Update session
  const sessionKey = `feishu:${event.openId}`;
  userSessions.set(event.openId, {
    openId: event.openId,
    lastMessageId: event.messageId,
    lastTime: Date.now(),
  });

  console.log(`[Feishu Server] Received from ${event.openId} (${event.chatType}): ${event.content}`);

  // Send "typing" indicator
  await client.sendMessage({
    receive_id: event.openId,
    receive_id_type: 'open_id',
    msg_type: 'text',
    content: JSON.stringify({ text: '🤔 正在思考...' }),
  });

  // Call Dexter agent
  const reply = await callDexterAgent(event.content, sessionKey);

  // Send reply
  await client.sendMessage({
    receive_id: event.openId,
    receive_id_type: 'open_id',
    msg_type: 'text',
    content: JSON.stringify({ text: reply }),
  });

  console.log(`[Feishu Server] Replied to ${event.openId}: ${reply.substring(0, 100)}...`);

  return { status: 200, body: JSON.stringify({ code: 0, msg: 'ok' }) };
}

async function main() {
  // Validate credentials
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
    console.error('[Feishu Server] FEISHU_APP_ID and FEISHU_APP_SECRET are required');
    console.error('  Get them from: https://open.feishu.cn/ → Your App → Credentials');
    process.exit(1);
  }

  // Initialize Feishu client
  const client = new FeishuApiClient({
    accountId: 'default',
    appId: FEISHU_APP_ID,
    appSecret: FEISHU_APP_SECRET,
    allowFrom: [],
    dmEnabled: true,
    groupEnabled: false,
  } as any);

  // Verify credentials
  try {
    const botInfo = await client.getBotInfo();
    console.log(`✅ Feishu Bot: ${botInfo.app_name}`);
    console.log(`   App ID: ${FEISHU_APP_ID}`);
  } catch (err) {
    console.error(`❌ Failed to connect to Feishu: ${err}`);
    console.error('   Check your FEISHU_APP_ID and FEISHU_APP_SECRET');
    process.exit(1);
  }

  // Create HTTP server
  const server = http.createServer(async (req, res) => {
    const url = req.url || '/';

    // CORS
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
      res.end(JSON.stringify({ status: 'ok', bot: 'feishu', uptime: process.uptime() }));
      return;
    }

    // Status page
    if (url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        activeSessions: userSessions.size,
        sessions: Array.from(userSessions.entries()).map(([openId, s]) => ({
          openId,
          lastMessageId: s.lastMessageId,
          lastSeen: new Date(s.lastTime).toISOString(),
        })),
      }));
      return;
    }

    // Webhook endpoint
    if (req.method === 'POST' && (url === '/webhook' || url.startsWith('/webhook/'))) {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', async () => {
        const result = await handleWebhook(client, body);
        res.writeHead(result.status, { 'Content-Type': 'application/json' });
        res.end(result.body);
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });

  server.listen(FEISHU_PORT, FEISHU_HOST, () => {
    console.log(`\n🐔 Feishu Bot Server started!`);
    console.log(`   Webhook URL: http://${FEISHU_HOST}:${FEISHU_PORT}/webhook`);
    console.log(`   Health:      http://${FEISHU_HOST}:${FEISHU_PORT}/health`);
    console.log(`   Status:      http://${FEISHU_HOST}:${FEISHU_PORT}/status`);
    console.log(`\n📋 Next steps:`);
    console.log(`   1. Go to https://open.feishu.cn/app/{APP_ID}/event`);
    console.log(`   2. Set Request URL to: http://your-server:${FEISHU_PORT}/webhook`);
    console.log(`   3. Subscribe to: im.message.receive_v1`);
    console.log(`   4. Make sure your server is publicly accessible!\n`);
  });
}

main();
