/**
 * Feishu Inbound Message Handler
 * Receives and processes incoming webhooks from Feishu
 */

import { logger } from '../../../utils/logger.js';
import type { FeishuAccountConfig, FeishuMessageEvent } from './types.js';
import { FeishuApiClient } from './api.js';

export type InboundHandler = (event: FeishuInboundEvent) => Promise<void>;

export interface FeishuInboundEvent {
  accountId: string;
  eventId: string;
  eventType: string;
  openId: string;
  chatId: string;
  chatType: 'direct' | 'group';
  messageId: string;
  content: string;
  messageType: string;
  senderOpenId: string;
  senderType: 'user' | 'bot';
  timestamp: string;
  raw: FeishuMessageEvent;
}

/**
 * Process an incoming Feishu webhook event
 */
export function processFeishuInbound(
  body: unknown,
  account: FeishuAccountConfig,
  handler: InboundHandler,
): void {
  const rawEvent = body as FeishuMessageEvent;

  // Skip non-message events
  if (!rawEvent.event?.message) {
    // Handle URL verification challenge
    if (rawEvent.header?.event_type === 'im.message.receive_v1') {
      logger.debug('[Feishu] Received non-message event, skipping');
    }
    return;
  }

  const msg = rawEvent.event.message;
  if (!msg) return;

  // Ignore messages sent by bots
  if (msg.sender?.sender_type === 'bot') {
    logger.debug('[Feishu] Ignoring bot message');
    return;
  }

  const openId = msg.sender?.sender_id?.open_id || '';
  const chatId = msg.chat_id || '';
  const chatType = (msg.chat_type || 'direct') as 'direct' | 'group';
  const content = FeishuApiClient.parseMessageContent(msg.content || '', msg.message_type || 'text');

  // Skip empty messages
  if (!content && msg.message_type !== 'image' && msg.message_type !== 'file') {
    return;
  }

  const event: FeishuInboundEvent = {
    accountId: account.accountId,
    eventId: rawEvent.header?.event_id || '',
    eventType: rawEvent.header?.event_type || '',
    openId,
    chatId,
    chatType,
    messageId: msg.message_id || '',
    content,
    messageType: msg.message_type || 'text',
    senderOpenId: openId,
    senderType: (msg.sender?.sender_type as 'user' | 'bot') || 'user',
    timestamp: msg.create_time || rawEvent.header?.create_time || new Date().toISOString(),
    raw: rawEvent,
  };

  logger.info(`[Feishu] Inbound ${chatType} from ${openId}: ${content.substring(0, 100)}`);

  // Process asynchronously (don't await - webhook needs fast response)
  handler(event).catch((err) => {
    logger.error(`[Feishu] Error processing inbound: ${err}`);
  });
}

/**
 * Verify webhook URL (Feishu sends a challenge on URL verification)
 */
export function verifyFeishuWebhook(
  body: Record<string, unknown>,
  verificationToken?: string,
): { challenge?: string } | null {
  // URL verification event type
  if (body.challenge !== undefined) {
    if (verificationToken && body.token !== verificationToken) {
      logger.warn('[Feishu] Webhook verification failed: invalid token');
      return null;
    }
    logger.info('[Feishu] Webhook URL verified');
    return { challenge: body.challenge as string };
  }
  return null;
}
