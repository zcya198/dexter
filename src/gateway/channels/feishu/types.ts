/**
 * Feishu/Lark Bot Channel Types
 *
 * Feishu uses a webhook-based event subscription model.
 * The bot receives events via HTTP POST to a configured webhook URL.
 */

export type ChannelId = 'feishu';

export interface FeishuAccountConfig {
  accountId: string;
  /** Bot App ID from Feishu Open Platform */
  appId: string;
  /** Bot App Secret from Feishu Open Platform */
  appSecret: string;
  /** Verification token for webhook validation */
  verificationToken?: string;
  /** Encrypt key for event encryption (optional) */
  encryptKey?: string;
  /** Allow incoming messages only from these open_ids (empty = allow all) */
  allowFrom: string[];
  /** Enable DM (direct message) handling */
  dmEnabled: boolean;
  /** Enable group message handling */
  groupEnabled: boolean;
}

export interface FeishuMessageEvent {
  schema: string;
  header: {
    event_id: string;
    event_type: string;
    create_time: string;
    token: string;
    app_id: string;
    tenant_key: string;
  };
  event: {
    sender?: {
      sender_id: { open_id: string; union_id: string; user_id: string };
      sender_type: 'user' | 'bot' | 'app';
    };
    recipient_id?: { open_id: string; union_id: string; user_id: string };
    chat_id?: string;
    chat_type?: 'direct' | 'group';
    message?: {
      message_id: string;
      root_id?: string;
      parent_id?: string;
      create_time: string;
      chat_id: string;
      chat_type: string;
      sender: {
        sender_id: { open_id: string; union_id: string; user_id: string };
        sender_type: 'user' | 'bot';
      };
      message_type: 'text' | 'post' | 'image' | 'file' | 'audio' | 'video' | 'sticker' | 'interactive' | 'share_chat' | 'share_user' | 'system';
      content: string; // JSON string
    };
  };
}

export interface OutboundMessage {
  receive_id: string;
  receive_id_type: 'open_id' | 'user_id' | 'union_id' | 'chat_id';
  msg_type: 'text' | 'post' | 'image' | 'file' | 'audio' | 'video' | 'sticker' | 'interactive' | 'share_chat' | 'share_user';
  content: string; // JSON string
}

export interface ChannelRuntimeSnapshot {
  accountId: string;
  running: boolean;
  connected?: boolean;
  lastError?: string | null;
  lastStartAt?: number;
  lastStopAt?: number;
  botName?: string;
  tenantName?: string;
}

export interface ChannelStartContext<TAccount> {
  accountId: string;
  account: TAccount;
  abortSignal: AbortSignal;
  getStatus: () => ChannelRuntimeSnapshot;
  setStatus: (next: Partial<ChannelRuntimeSnapshot>) => ChannelRuntimeSnapshot;
}

export interface ChannelStopContext<TAccount> {
  accountId: string;
  account: TAccount;
  abortSignal: AbortSignal;
  getStatus: () => ChannelRuntimeSnapshot;
  setStatus: (next: Partial<ChannelRuntimeSnapshot>) => ChannelRuntimeSnapshot;
}
