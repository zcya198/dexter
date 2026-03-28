/**
 * Feishu/Lark Bot API Client
 * Handles authentication and API calls to Feishu Open Platform
 */

import { logger } from '../../../utils/logger.js';
import type { FeishuAccountConfig, OutboundMessage } from './types.js';

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis';

interface TokenResponse {
  code: number;
  msg: string;
  tenant_access_token?: string;
  expire: number;
}

interface ApiResponse<T = unknown> {
  code: number;
  msg: string;
  data?: T;
}

/**
 * Feishu API client with automatic token management
 */
export class FeishuApiClient {
  private appId: string;
  private appSecret: string;
  private tenantToken: string | null = null;
  private tokenExpiresAt: number = 0;

  constructor(config: FeishuAccountConfig) {
    this.appId = config.appId;
    this.appSecret = config.appSecret;
  }

  /**
   * Get or refresh the tenant access token
   */
  async getToken(): Promise<string> {
    // Return cached token if still valid (with 60s buffer)
    if (this.tenantToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.tenantToken;
    }

    const url = `${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
    });

    const data = (await response.json()) as TokenResponse;

    if (data.code !== 0 || !data.tenant_access_token) {
      throw new Error(`Failed to get Feishu token: ${data.msg} (code: ${data.code})`);
    }

    this.tenantToken = data.tenant_access_token;
    // Token typically expires in 2 hours
    this.tokenExpiresAt = Date.now() + (data.expire || 7200) * 1000;

    logger.info(`[Feishu API] Got tenant token, expires in ${data.expire}s`);
    return this.tenantToken;
  }

  /**
   * Make an authenticated API request
   */
  async request<T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = await this.getToken();
    const url = `${FEISHU_API_BASE}${path}`;

    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    const data = (await response.json()) as ApiResponse<T>;

    if (data.code !== 0) {
      throw new Error(`Feishu API error: ${data.msg} (code: ${data.code})`);
    }

    return data.data as T;
  }

  /**
   * Send a message to a user or chat
   */
  async sendMessage(message: OutboundMessage): Promise<{ message_id: string }> {
    return this.request<{ message_id: string }>('POST', '/im/v1/messages', message);
  }

  /**
   * Reply to an existing message
   */
  async replyMessage(messageId: string, message: Omit<OutboundMessage, 'receive_id'>): Promise<{ message_id: string }> {
    return this.request<{ message_id: string }>(
      'POST',
      `/im/v1/messages/${messageId}/reply`,
      { ...message, msg_type: message.msg_type || 'text' },
    );
  }

  /**
   * Get bot info - uses raw fetch since this endpoint returns bot directly (not in data wrapper)
   */
  async getBotInfo(): Promise<{ app_id: string; app_name: string; open_id: string }> {
    const token = await this.getToken();
    const response = await fetch(`${FEISHU_API_BASE}/bot/v3/info`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = (await response.json()) as { code: number; msg: string; bot: { activate_status: number; app_name: string; open_id: string } };
    if (json.code !== 0) {
      throw new Error(`Failed to get bot info: ${json.msg} (code: ${json.code})`);
    }
    return {
      app_id: this.appId, // Use the appId from credentials
      app_name: json.bot.app_name,
      open_id: json.bot.open_id,
    };
  }

  /**
   * Get user info by open_id
   */
  async getUserInfo(openId: string): Promise<{ name: string; avatar?: string; open_id: string }> {
    const data = await this.request<{ user?: { name: string; avatar?: { avatar_72: string }; open_id: string } }>(
      'GET',
      `/contact/v3/users/${openId}?user_id_type=open_id`,
    );
    return {
      name: data.user?.name || 'Unknown',
      avatar: data.user?.avatar?.avatar_72,
      open_id: data.user?.open_id || openId,
    };
  }

  /**
   * Upload an image for sending
   */
  async uploadImage(imageBuffer: Buffer, imageName = 'image.png'): Promise<string> {
    const form = new FormData();
    form.append('image_type', 'message');
    form.append('image', new Blob([imageBuffer]), imageName);

    const token = await this.getToken();
    const response = await fetch(`${FEISHU_API_BASE}/im/v1/images`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    const data = (await response.json()) as ApiResponse<{ image_key: string }>;
    if (data.code !== 0) {
      throw new Error(`Failed to upload image: ${data.msg}`);
    }
    return data.data!.image_key;
  }

  /**
   * Parse message content based on type
   */
  static parseMessageContent(content: string, messageType: string): string {
    try {
      const parsed = JSON.parse(content);

      switch (messageType) {
        case 'text':
          return parsed.text || '';
        case 'post':
          // Post messages contain rich text with potentially multiple paragraphs
          return FeishuApiClient.extractTextFromPost(parsed);
        case 'image':
          return '[图片]';
        case 'file':
          return '[文件]';
        case 'audio':
          return '[语音]';
        case 'video':
          return '[视频]';
        case 'sticker':
          return '[表情包]';
        case 'share_chat':
          return '[分享群聊]';
        case 'share_user':
          return '[分享人员]';
        default:
          return content;
      }
    } catch {
      return content;
    }
  }

  /**
   * Extract plain text from Feishu post content
   */
  private static extractTextFromPost(post: unknown): string {
    if (!post || typeof post !== 'object') return '';
    const texts: string[] = [];

    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return;
      const obj = node as Record<string, unknown>;
      if (obj.tag === 'text' && typeof obj.text === 'string') {
        texts.push(obj.text as string);
      }
      if (Array.isArray(obj.elements)) {
        obj.elements.forEach(walk);
      }
      if (Array.isArray(obj.children)) {
        obj.children.forEach(walk);
      }
    };

    walk(post);
    return texts.join('').trim() || '[动态卡片消息]';
  }
}
