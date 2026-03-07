/**
 * 飞书通道适配器类型定义
 */

// Import from channel-adapter
import type { ChannelSessionConfig } from '@craft-agent/channel-adapter';

/**
 * 飞书适配器配置
 */
export interface FeishuAdapterConfig {
  /** 飞书应用 ID */
  appId: string;

  /** 飞书应用密钥 */
  appSecret: string;

  /** 域名: 'feishu' 或 'lark' */
  domain?: 'feishu' | 'lark';

  /** 加密密钥（可选） */
  encryptKey?: string;

  /** 验证令牌（可选） */
  verificationToken?: string;

  /** 消息渲染模式: 'text' 或 'card' */
  renderMode?: 'text' | 'card';

  /** 允许的聊天 ID (可选，为空则允许所有) */
  allowedChatIds?: string[];

  /** 允许的用户 ID (可选，为空则允许所有) */
  allowedUserIds?: string[];

  /** 调试模式 */
  debug?: boolean;

  /** 会话管理器配置 */
  sessionConfig: ChannelSessionConfig;
}

/**
 * 飞书消息事件结构
 */
export interface FeishuMessageEvent {
  message: {
    message_id: string;
    root_id?: string;
    parent_id?: string;
    chat_id: string;
    chat_type: 'p2p' | 'group';
    message_type: string;
    content: string;
    mentions?: Array<{
      key: string;
      id: { open_id?: string; user_id?: string };
      name: string;
    }>;
  };
  sender: {
    sender_id: {
      open_id?: string;
      user_id?: string;
    };
    sender_type: string;
  };
}

/**
 * 飞书消息上下文
 */
export interface FeishuMessageContext {
  chatId: string;
  messageId: string;
  senderId: string;
  senderOpenId: string;
  chatType: 'p2p' | 'group';
  mentionedBot: boolean;
  rootId?: string;
  parentId?: string;
  content: string;
  contentType: string;
  mediaKey?: string;
  mediaType?: string;
  mediaFileName?: string;
  mediaDuration?: number;
}

/**
 * 飞书文件类型
 */
export type FeishuFileType = 'opus' | 'mp4' | 'pdf' | 'doc' | 'xls' | 'ppt' | 'stream';

/**
 * 飞书图片上传结果
 */
export interface FeishuImageUploadResult {
  success: boolean;
  imageKey?: string;
  error?: string;
}

/**
 * 飞书文件上传结果
 */
export interface FeishuFileUploadResult {
  success: boolean;
  fileKey?: string;
  error?: string;
}

// Re-export ChannelSessionConfig
export type { ChannelSessionConfig };
