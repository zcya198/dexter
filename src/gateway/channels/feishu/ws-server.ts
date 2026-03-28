/**
 * Feishu Bot Server using WebSocket Long Connection
 *
 * Uses Feishu's WSClient to maintain a persistent WebSocket connection.
 * NO public URL needed!
 *
 * Run:
 *   bun run src/gateway/channels/feishu/ws-server.ts
 *
 * Environment variables:
 *   FEISHU_APP_ID        - Bot App ID
 *   FEISHU_APP_SECRET    - Bot App Secret
 *   FEISHU_DOMAIN        - "feishu" or "lark" (default: feishu)
 *   DEXTER_AGENT_URL     - URL of Dexter agent (default: http://localhost:3000)
 */

import {
  WSClient,
  EventDispatcher,
  LoggerLevel,
  Domain,
} from '@larksuiteoapi/node-sdk';
import type { IConstructorParams } from '@larksuiteoapi/node-sdk';

const FEISHU_APP_ID = process.env.FEISHU_APP_ID || '';
const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET || '';
const FEISHU_DOMAIN = (process.env.FEISHU_DOMAIN || 'feishu') === 'lark' ? Domain.Lark : Domain.Feishu;
const DEXTER_AGENT_URL = process.env.DEXTER_AGENT_URL || 'http://localhost:3000';

// Rate limiting
const RATE_LIMIT = 10;
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(openId: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(openId);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(openId, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= RATE_LIMIT) return false;
  entry.count++;
  return true;
}

async function callDexterAgent(message: string, sessionKey?: string): Promise<string> {
  const body: Record<string, unknown> = { message: message.trim() };
  if (sessionKey) body.sessionKey = sessionKey;

  try {
    const response = await fetch(`${DEXTER_AGENT_URL}/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`Agent returned ${response.status}`);
    const data = (await response.json()) as { response?: string; text?: string; message?: string };
    return data.response || data.text || data.message || '抱歉，Agent 没有返回内容。';
  } catch (err) {
    console.error(`[Feishu WS] Agent call failed: ${err}`);
    return '抱歉，Agent 服务暂时不可用。请稍后再试。';
  }
}

// Feishu event types
interface FeishuMessageEvent {
  sender?: {
    sender_id?: { open_id?: string; user_id?: string; union_id?: string };
    sender_type?: string;
    tenant_key?: string;
  };
  message?: {
    message_id?: string;
    root_id?: string;
    parent_id?: string;
    thread_id?: string;
    chat_id?: string;
    chat_type?: 'p2p' | 'group' | 'private';
    message_type?: string;
    content?: string;
    create_time?: string;
    mentions?: Array<{ key: string; id: { open_id?: string }; name: string }>;
  };
}

interface FeishuBotAddedEvent {
  chat_id?: string;
  operator_id?: { open_id?: string };
  external?: boolean;
}

function parseTextContent(content: string, messageType: string): string {
  try {
    const parsed = JSON.parse(content);
    switch (messageType) {
      case 'text': return parsed.text || '';
      case 'post': return extractTextFromPost(parsed);
      case 'image': return '[图片]';
      case 'file': return '[文件]';
      case 'audio': return '[语音]';
      case 'video': return '[视频]';
      case 'sticker': return '[表情包]';
      default: return content;
    }
  } catch {
    return content;
  }
}

function extractTextFromPost(post: unknown): string {
  if (!post || typeof post !== 'object') return '';
  const texts: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const obj = node as Record<string, unknown>;
    if (obj.tag === 'text' && typeof obj.text === 'string') texts.push(obj.text as string);
    if (Array.isArray(obj.elements)) obj.elements.forEach(walk);
    if (Array.isArray(obj.children)) obj.children.forEach(walk);
  };
  walk(post);
  return texts.join('').trim() || '[动态卡片消息]';
}

// Simple token holder
let tokenCache = { token: '', expiresAt: 0 };

async function getToken(): Promise<string> {
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 60_000) {
    return tokenCache.token;
  }
  const resp = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }),
  }).then(r => r.json()) as { code: number; tenant_access_token?: string; expire?: number };
  if (resp.code !== 0 || !resp.tenant_access_token) throw new Error('Failed to get token');
  tokenCache = { token: resp.tenant_access_token, expiresAt: Date.now() + (resp.expire || 7200) * 1000 };
  return tokenCache.token;
}

async function sendText(openId: string, text: string): Promise<void> {
  try {
    const token = await getToken();
    await fetch('https://open.feishu.cn/open-apis/im/v1/messages', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        receive_id: openId,
        receive_id_type: 'open_id',
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }),
    });
  } catch (err) {
    console.error(`[Feishu WS] Send failed: ${err}`);
  }
}

async function main() {
  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
    console.error('[Feishu WS] FEISHU_APP_ID and FEISHU_APP_SECRET are required');
    process.exit(1);
  }

  console.log(`\n🐔 Feishu Bot Server (WebSocket Mode)`);
  console.log(`   App ID: ${FEISHU_APP_ID}`);
  console.log(`   Domain: ${FEISHU_DOMAIN === Domain.Lark ? 'Lark (international)' : 'Feishu (国内)'}`);
  console.log(`   Agent:  ${DEXTER_AGENT_URL}`);
  console.log('');

  // Test connection
  try {
    await getToken();
    console.log(`✅ Connected to Feishu!\n`);
  } catch (err) {
    console.error(`❌ Failed to connect: ${err}`);
    process.exit(1);
  }

  // Create event dispatcher
  const dispatcher = new EventDispatcher({}).register({
    'im.message.receive_v1': async (data: FeishuMessageEvent) => {
      const msg = data.message;
      if (!msg) return;

      // Ignore bot messages
      if (data.sender?.sender_type === 'bot') return;

      const openId = data.sender?.sender_id?.open_id || '';
      const chatId = msg.chat_id || '';
      const chatType = msg.chat_type || 'p2p';
      const content = parseTextContent(msg.content || '', msg.message_type || 'text');

      if (!content) return;

      console.log(`[Feishu WS] ${chatType} from ${openId}: ${content}`);

      // Rate limiting
      if (!checkRateLimit(openId)) {
        await sendText(openId, '消息发送过于频繁，请稍后再试。');
        return;
      }

      // Session key
      const sessionKey = chatType === 'p2p' ? `feishu:${openId}` : `feishu:group:${chatId}`;

      // Send typing indicator
      await sendText(openId, '🤔 正在思考...');

      // Call Dexter
      const reply = await callDexterAgent(content, sessionKey);

      // Send reply
      await sendText(openId, reply);
      console.log(`[Feishu WS] Replied to ${openId}`);
    },

    'im.bot.added_v1': async (data: FeishuBotAddedEvent) => {
      const openId = data.operator_id?.open_id;
      console.log(`[Feishu WS] Bot added to chat ${data.chat_id} by ${openId}`);
      if (openId) {
        await sendText(openId, '你好！我是金融研究助手。有任何股票问题可以问我！');
      }
    },
  });

  // Create and start WebSocket client
  const appIdNum = parseInt(FEISHU_APP_ID.replace('cli_', ''), 10);

  const wsClient = new WSClient({
    appId: FEISHU_APP_ID,
    appSecret: FEISHU_APP_SECRET,
    domain: FEISHU_DOMAIN,
    loggerLevel: LoggerLevel.info,
  });

  wsClient.start({ eventDispatcher: dispatcher });
  console.log(`🔗 WebSocket connecting to Feishu...`);
  console.log(`   (No public URL needed - this connects OUT to Feishu)\n`);

  process.on('SIGINT', () => {
    console.log(`\n[Feishu WS] Shutting down...`);
    wsClient.stop();
    process.exit(0);
  });
}

main();
