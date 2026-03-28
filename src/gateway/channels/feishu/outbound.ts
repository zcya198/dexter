/**
 * Feishu Outbound Message Handler
 * Sends messages back to Feishu users/chats
 */

import { logger } from '../../../utils/logger.js';
import { FeishuApiClient } from './api.js';
import type { FeishuAccountConfig, FeishuInboundEvent } from './types.js';

const activeClients = new Map<string, FeishuApiClient>();

export function getOrCreateClient(account: FeishuAccountConfig): FeishuApiClient {
  const existing = activeClients.get(account.accountId);
  if (existing) return existing;

  const client = new FeishuApiClient(account);
  activeClients.set(account.accountId, client);
  return client;
}

export function removeClient(accountId: string): void {
  activeClients.delete(accountId);
}

/**
 * Send a text reply to a Feishu user
 */
export async function sendFeishuText(
  account: FeishuAccountConfig,
  toOpenId: string,
  text: string,
): Promise<string> {
  const client = getOrCreateClient(account);

  const message = {
    receive_id: toOpenId,
    receive_id_type: 'open_id' as const,
    msg_type: 'text' as const,
    content: JSON.stringify({ text }),
  };

  const result = await client.sendMessage(message);
  logger.info(`[Feishu] Sent text message to ${toOpenId}, id: ${result.message_id}`);
  return result.message_id;
}

/**
 * Send a text reply to a chat (group)
 */
export async function sendFeishuGroupText(
  account: FeishuAccountConfig,
  chatId: string,
  text: string,
): Promise<string> {
  const client = getOrCreateClient(account);

  const message = {
    receive_id: chatId,
    receive_id_type: 'chat_id' as const,
    msg_type: 'text' as const,
    content: JSON.stringify({ text }),
  };

  const result = await client.sendMessage(message);
  logger.info(`[Feishu] Sent group message to ${chatId}, id: ${result.message_id}`);
  return result.message_id;
}

/**
 * Reply to a specific message (in thread)
 */
export async function replyFeishuMessage(
  account: FeishuAccountConfig,
  messageId: string,
  text: string,
): Promise<string> {
  const client = getOrCreateClient(account);

  const result = await client.replyMessage(messageId, {
    msg_type: 'text',
    content: JSON.stringify({ text }),
  });

  logger.info(`[Feishu] Replied to message ${messageId}, id: ${result.message_id}`);
  return result.message_id;
}

/**
 * Send a rich text (post) message
 */
export async function sendFeishuPost(
  account: FeishuAccountConfig,
  toOpenId: string,
  title: string,
  content: string[],
): Promise<string> {
  const client = getOrCreateClient(account);

  // Build post content in Feishu format
  const postContent = {
    zh_cn: {
      title,
      content: content.map((paragraph) => [
        {
          tag: 'text',
          text: paragraph,
        },
      ]),
    },
  };

  const message = {
    receive_id: toOpenId,
    receive_id_type: 'open_id' as const,
    msg_type: 'post' as const,
    content: JSON.stringify(postContent),
  };

  const result = await client.sendMessage(message);
  logger.info(`[Feishu] Sent post message to ${toOpenId}, id: ${result.message_id}`);
  return result.message_id;
}

/**
 * Send an interactive card message
 */
export async function sendFeishuCard(
  account: FeishuAccountConfig,
  toOpenId: string,
  card: Record<string, unknown>,
): Promise<string> {
  const client = getOrCreateClient(account);

  const message = {
    receive_id: toOpenId,
    receive_id_type: 'open_id' as const,
    msg_type: 'interactive' as const,
    content: JSON.stringify(card),
  };

  const result = await client.sendMessage(message);
  logger.info(`[Feishu] Sent card to ${toOpenId}, id: ${result.message_id}`);
  return result.message_id;
}
