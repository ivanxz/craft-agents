/**
 * 通道适配器类型定义
 *
 * 所有通道（Discord、Telegram 等）都需要实现 ChannelAdapter 接口
 */

/**
 * 通道适配器接口
 * 所有通道（Discord、Telegram 等）都需要实现此接口
 */
export interface ChannelAdapter {
  /** 通道标识符 (如 'discord', 'telegram') */
  readonly channelId: string;

  /** 通道显示名称 */
  readonly channelName: string;

  /** 启动适配器 */
  start(): Promise<void>;

  /** 停止适配器 */
  stop(): Promise<void>;

  /**
   * 发送消息到通道
   * @param context 通道上下文
   * @param content 消息内容（文本或富文本）
   */
  sendMessage(context: ChannelContext, content: string | RichContent): Promise<void>;

  /**
   * 发送打字指示器（可选）
   * @param context 通道上下文
   */
  sendTypingIndicator?(context: ChannelContext): Promise<void>;

  /** 收到消息时的回调 */
  onMessage?: (event: ChannelMessageEvent) => void;

  /** 发生错误时的回调 */
  onError?: (error: Error) => void;
}

/**
 * 通道上下文
 * 标识一次对话的唯一上下文
 */
export interface ChannelContext {
  /** 会话 ID (由 ChannelSessionManager 分配) */
  sessionId: string;

  /** 工作区 ID */
  workspaceId: string;

  /** 通道特定的用户标识 (如 Discord 用户 ID) */
  channelUserId: string;

  /** 通道特定的对话标识 (如 Discord channel ID) */
  channelConversationId: string;

  /** 原始消息元数据 */
  metadata?: Record<string, unknown>;
}

/**
 * 通道消息事件
 * 从通道接收到的消息
 */
export interface ChannelMessageEvent {
  /** 通道用户 ID */
  channelUserId: string;

  /** 通道对话 ID */
  channelConversationId: string;

  /** 消息内容 */
  content: string;

  /** 附件列表 */
  attachments?: Array<{
    name: string;
    url?: string;
    data?: Uint8Array;
    mimeType: string;
  }>;

  /** 回复的消息 ID (用于 thread) */
  replyToId?: string;

  /** 原始事件数据 */
  raw: unknown;
}

/**
 * 富文本内容
 */
export interface RichContent {
  text?: string;
  blocks?: ContentBlock[];
}

/**
 * 内容块类型
 */
export type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'code'; code: string; language?: string }
  | { type: 'image'; url: string; alt?: string }
  | { type: 'tool_use'; name: string; intent?: string }
  | { type: 'tool_result'; name: string; result: string; success: boolean };

/**
 * 通道会话配置
 */
export interface ChannelSessionConfig {
  /** RPC 服务器 URL */
  serverUrl: string;

  /** RPC 服务器令牌 */
  serverToken: string;

  /** 默认工作区 ID */
  defaultWorkspaceId: string;

  /** 默认权限模式 */
  defaultPermissionMode: 'safe' | 'ask' | 'allow-all';

  /** 会话超时 (毫秒)，默认 30 分钟 */
  idleCleanupTime?: number;
}

/**
 * Agent 事件类型
 */
export type ChannelAgentEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'text_complete' }
  | { type: 'tool_start'; toolName: string; intent?: string }
  | { type: 'tool_result'; toolName: string; result: string }
  | { type: 'complete' }
  | { type: 'error'; message: string }
  | { type: 'interrupted' }
  | { type: 'unknown'; raw: unknown };
