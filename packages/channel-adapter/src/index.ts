/**
 * @craft-agent/channel-adapter
 *
 * 通道适配器基础包，提供：
 * - ChannelAdapter 接口定义
 * - ChannelSessionManager 会话管理器
 * - 类型定义
 */

// Types
export type {
  ChannelAdapter,
  ChannelContext,
  ChannelMessageEvent,
  RichContent,
  ContentBlock,
  ChannelSessionConfig,
  ChannelAgentEvent,
} from './types';

// Session Manager
export {
  ChannelSessionManager,
  ChannelRpcClient,
  type MappedSession,
} from './session-manager';
