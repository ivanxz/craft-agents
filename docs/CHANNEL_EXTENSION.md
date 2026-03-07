# 多通道扩展方案

> 本文档描述如何为 Craft Agents 添加新的消息通道（如 Discord、Telegram 等）

## 1. 概述

### 1.1 当前架构

Electron App 和 CLI Client 通过统一的 WebSocket RPC 协议与服务器通信：

```
┌─────────────────┐     ┌─────────────────┐
│  Electron App   │     │   CLI Client    │
│  (WsRpcClient)  │     │  (CliRpcClient) │
└────────┬────────┘     └────────┬────────┘
         │                       │
         │   WebSocket RPC       │
         └───────────┬───────────┘
                     ▼
         ┌─────────────────────┐
         │   server-core       │
         │   (WsServer)        │
         │   RPC Handlers      │
         └─────────────────────┘
```

### 1.2 扩展目标

支持新的消息通道：
- Discord
- Telegram
- Slack
- 微信/飞书等

### 1.3 设计原则

1. **零侵入性** - 不修改 server-core 或 shared 包
2. **独立部署** - 通道服务可独立部署和扩展
3. **统一协议** - 所有通道使用相同的 WebSocket RPC 协议
4. **会话隔离** - 每个对话有独立的会话 ID

---

## 2. 架构设计

### 2.1 多通道架构

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            消息通道层                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │ Electron App│  │  CLI Client │  │ Discord Bot │  │Telegram Bot │     │
│  │ (WsRpcClient)│ │(CliRpcClient)│ │(ChannelAdapter)│(ChannelAdapter)│  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘     │
└─────────┼────────────────┼────────────────┼────────────────┼─────────────┘
          │                │                │                │
          │  WebSocket RPC │ WebSocket RPC  │ WebSocket RPC  │ WebSocket RPC
          └────────────────┴────────────────┴────────────────┘
                                    ▼
                    ┌───────────────────────────────┐
                    │       server-core             │
                    │  ┌─────────────────────────┐  │
                    │  │    SessionManager       │  │
                    │  │    RPC Handlers         │  │
                    │  └─────────────────────────┘  │
                    └───────────────────────────────┘
```

### 2.2 核心组件

| 组件 | 职责 |
|------|------|
| `ChannelAdapter` | 通道适配器接口，定义统一的消息收发 API |
| `ChannelSessionManager` | 管理通道用户与 Craft Agent 会话的映射 |
| `ChannelServer` | 独立服务，加载和运行多个适配器 |

---

## 3. 接口定义

### 3.1 通道适配器接口

```typescript
// packages/channel-adapter/src/types.ts

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
    data?: Buffer;
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
```

### 3.2 通道会话管理器

```typescript
// packages/channel-adapter/src/session-manager.ts

import { CliRpcClient } from '@craft-agent/shared/protocol';

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
 * 映射的会话
 */
export interface MappedSession {
  /** Craft Agent 会话 ID */
  sessionId: string;

  /** 工作区 ID */
  workspaceId: string;

  /** 通道用户 ID */
  channelUserId: string;

  /** 通道对话 ID */
  channelConversationId: string;

  /** 最后活动时间 */
  lastActivity: number;

  /** RPC 客户端 */
  client: CliRpcClient;
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

/**
 * 通道会话管理器
 *
 * 职责：
 * 1. 管理通道用户与 Craft Agent 会话的映射
 * 2. 创建和清理 RPC 客户端连接
 * 3. 发送消息并处理流式响应
 */
export class ChannelSessionManager {
  private sessions = new Map<string, MappedSession>();
  private config: ChannelSessionConfig;
  private cleanupInterval?: ReturnType<typeof setInterval>;

  constructor(config: ChannelSessionConfig) {
    this.config = config;
  }

  /**
   * 启动会话管理器
   */
  async start(): Promise<void> {
    // 启动空闲会话清理定时器
    this.cleanupInterval = setInterval(
      () => this.cleanupIdleSessions(),
      60000
    );
  }

  /**
   * 停止会话管理器
   */
  async stop(): Promise<void> {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
    }
    await this.cleanupAllSessions();
  }

  /**
   * 获取或创建会话
   *
   * @param channelUserId 通道用户 ID
   * @param channelConversationId 通道对话 ID
   * @returns 映射的会话
   */
  async getOrCreateSession(
    channelUserId: string,
    channelConversationId: string
  ): Promise<MappedSession> {
    const key = this.getSessionKey(channelUserId, channelConversationId);

    // 检查现有会话
    let session = this.sessions.get(key);
    if (session) {
      session.lastActivity = Date.now();
      return session;
    }

    // 创建新的 RPC 客户端
    const client = new CliRpcClient(this.config.serverUrl, {
      token: this.config.serverToken,
      workspaceId: this.config.defaultWorkspaceId,
      requestTimeout: 300000, // 5 分钟
    });

    // 连接到服务器
    await client.connect();

    // 切换到目标工作区
    await client.invoke('window:switchWorkspace', this.config.defaultWorkspaceId);

    // 创建新会话
    const sessionResult = await client.invoke('sessions:create',
      this.config.defaultWorkspaceId,
      {
        permissionMode: this.config.defaultPermissionMode,
        name: `Channel: ${channelUserId}`,
      }
    ) as { id: string };

    // 订阅会话事件
    client.on('session:event', () => {
      // 事件由 sendMessage 中的回调处理
    });

    // 保存会话
    session = {
      sessionId: sessionResult.id,
      workspaceId: this.config.defaultWorkspaceId,
      channelUserId,
      channelConversationId,
      lastActivity: Date.now(),
      client,
    };

    this.sessions.set(key, session);
    return session;
  }

  /**
   * 发送消息并处理流式响应
   *
   * @param session 映射的会话
   * @param message 消息内容
   * @param onEvent 事件回调
   */
  async sendMessage(
    session: MappedSession,
    message: string,
    onEvent: (event: ChannelAgentEvent) => void | Promise<void>
  ): Promise<void> {
    // 更新活动时间
    session.lastActivity = Date.now();

    // 设置事件监听器
    const eventHandler = async (event: unknown) => {
      const ev = event as { type: string; sessionId: string; [key: string]: unknown };

      // 只处理当前会话的事件
      if (ev.sessionId !== session.sessionId) return;

      // 转换事件类型
      const channelEvent = this.mapEvent(ev);
      await onEvent(channelEvent);
    };

    // 订阅事件
    const unsubscribe = session.client.on('session:event', eventHandler);

    try {
      // 发送消息
      await session.client.invoke('sessions:sendMessage', session.sessionId, message);

      // 等待完成
      await this.waitForCompletion(session);
    } finally {
      // 取消订阅
      unsubscribe();
    }
  }

  /**
   * 等待会话完成
   */
  private waitForCompletion(session: MappedSession): Promise<void> {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        // 检查会话是否仍在处理
        // 这里简化处理，实际应该跟踪事件
        clearInterval(checkInterval);
        resolve();
      }, 1000);
    });
  }

  /**
   * 映射 Agent 事件到通道事件
   */
  private mapEvent(event: Record<string, unknown>): ChannelAgentEvent {
    switch (event.type) {
      case 'text_delta':
        return { type: 'text_delta', delta: String(event.delta ?? '') };
      case 'text_complete':
        return { type: 'text_complete' };
      case 'tool_start':
        return {
          type: 'tool_start',
          toolName: String(event.toolName ?? ''),
          intent: event.toolIntent ? String(event.toolIntent) : undefined
        };
      case 'tool_result':
        return {
          type: 'tool_result',
          toolName: String(event.toolName ?? ''),
          result: String(event.result ?? '')
        };
      case 'complete':
        return { type: 'complete' };
      case 'error':
        return { type: 'error', message: String(event.error ?? 'Unknown error') };
      case 'interrupted':
        return { type: 'interrupted' };
      default:
        return { type: 'unknown', raw: event };
    }
  }

  /**
   * 生成会话键
   */
  private getSessionKey(userId: string, conversationId: string): string {
    return `${userId}:${conversationId}`;
  }

  /**
   * 清理空闲会话
   */
  private cleanupIdleSessions(): void {
    const now = Date.now();
    const idleTime = this.config.idleCleanupTime ?? 30 * 60 * 1000; // 30 分钟

    for (const [key, session] of this.sessions) {
      if (now - session.lastActivity > idleTime) {
        console.log(`[ChannelSessionManager] Cleaning up idle session: ${session.sessionId}`);
        this.sessions.delete(key);

        // 删除服务器端会话
        session.client.invoke('sessions:delete', session.sessionId).catch(() => {});
        session.client.destroy();
      }
    }
  }

  /**
   * 清理所有会话
   */
  private async cleanupAllSessions(): Promise<void> {
    for (const session of this.sessions.values()) {
      try {
        await session.client.invoke('sessions:delete', session.sessionId);
      } catch {
        // 忽略删除错误
      }
      session.client.destroy();
    }
    this.sessions.clear();
  }
}
```

---

## 4. 适配器实现

### 4.1 Discord 适配器

```typescript
// packages/channel-discord/src/index.ts

import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  TextChannel,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder,
  ComponentType,
} from 'discord.js';
import type {
  ChannelAdapter,
  ChannelContext,
  ChannelMessageEvent,
  RichContent,
  ContentBlock,
} from '@craft-agent/channel-adapter';
import { ChannelSessionManager } from '@craft-agent/channel-adapter';

/**
 * Discord 适配器配置
 */
export interface DiscordAdapterConfig {
  /** Discord Bot Token */
  botToken: string;

  /** 允许的频道 ID (可选，为空则允许所有) */
  allowedChannelIds?: string[];

  /** 允许的用户 ID (可选，为空则允许所有) */
  allowedUserIds?: string[];

  /** 会话管理器配置 */
  sessionConfig: ChannelSessionConfig;
}

/**
 * Discord 通道适配器
 */
export class DiscordAdapter implements ChannelAdapter {
  readonly channelId = 'discord';
  readonly channelName = 'Discord';

  private client: Client;
  private config: DiscordAdapterConfig;
  private sessionManager: ChannelSessionManager;

  onMessage?: (event: ChannelMessageEvent) => void;
  onError?: (error: Error) => void;

  constructor(config: DiscordAdapterConfig) {
    this.config = config;

    // 创建 Discord 客户端
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages,
      ],
    });

    // 创建会话管理器
    this.sessionManager = new ChannelSessionManager(config.sessionConfig);

    // 设置事件处理器
    this.setupEventHandlers();
  }

  async start(): Promise<void> {
    await this.sessionManager.start();
    await this.client.login(this.config.botToken);
    console.log('[Discord] Bot logged in');
  }

  async stop(): Promise<void> {
    await this.sessionManager.stop();
    this.client.destroy();
  }

  async sendMessage(context: ChannelContext, content: string | RichContent): Promise<void> {
    const channel = await this.client.channels.fetch(context.channelConversationId);
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Channel ${context.channelConversationId} not found or not text-based`);
    }

    if (typeof content === 'string') {
      // 纯文本消息
      await this.sendTextMessage(channel as TextChannel, content);
    } else {
      // 富文本消息
      await this.sendRichContent(channel as TextChannel, content);
    }
  }

  async sendTypingIndicator(context: ChannelContext): Promise<void> {
    const channel = await this.client.channels.fetch(context.channelConversationId);
    if (channel && channel.isTextBased()) {
      await channel.sendTyping();
    }
  }

  private async sendTextMessage(channel: TextChannel, text: string): Promise<void> {
    // Discord 消息限制 2000 字符
    if (text.length > 2000) {
      const chunks = this.splitMessage(text, 2000);
      for (const chunk of chunks) {
        await channel.send(chunk);
      }
    } else {
      await channel.send(text);
    }
  }

  private async sendRichContent(channel: TextChannel, content: RichContent): Promise<void> {
    if (content.text) {
      await this.sendTextMessage(channel, content.text);
    }

    if (content.blocks) {
      for (const block of content.blocks) {
        await this.sendBlock(channel, block);
      }
    }
  }

  private async sendBlock(channel: TextChannel, block: ContentBlock): Promise<void> {
    switch (block.type) {
      case 'text':
        await channel.send(block.text);
        break;

      case 'code':
        const codeContent = block.code.length > 1900
          ? block.code.slice(0, 1900) + '\n... (truncated)'
          : block.code;
        await channel.send(`\`\`\`${block.language ?? ''}\n${codeContent}\n\`\`\``);
        break;

      case 'image':
        await channel.send({
          content: block.alt,
          files: [block.url]
        });
        break;

      case 'tool_use':
        const toolEmbed = new EmbedBuilder()
          .setColor(0x0099FF)
          .setTitle(`🔧 Tool: ${block.name}`)
          .setDescription(block.intent ?? 'Executing...');
        await channel.send({ embeds: [toolEmbed] });
        break;

      case 'tool_result':
        const resultEmbed = new EmbedBuilder()
          .setColor(block.success ? 0x00FF00 : 0xFF0000)
          .setTitle(`${block.success ? '✅' : '❌'} Result: ${block.name}`)
          .setDescription(
            block.result.length > 4000
              ? block.result.slice(0, 4000) + '...'
              : block.result
          );
        await channel.send({ embeds: [resultEmbed] });
        break;
    }
  }

  private setupEventHandlers(): void {
    // Bot 就绪
    this.client.on(Events.ClientReady, (client) => {
      console.log(`[Discord] Bot ready: ${client.user.tag}`);
    });

    // 收到消息
    this.client.on(Events.MessageCreate, async (message) => {
      // 忽略机器人消息
      if (message.author.bot) return;

      // 检查频道白名单
      if (this.config.allowedChannelIds?.length &&
          !this.config.allowedChannelIds.includes(message.channelId)) {
        return;
      }

      // 检查用户白名单
      if (this.config.allowedUserIds?.length &&
          !this.config.allowedUserIds.includes(message.author.id)) {
        return;
      }

      // 构建消息事件
      const event: ChannelMessageEvent = {
        channelUserId: message.author.id,
        channelConversationId: message.channelId,
        content: message.content,
        attachments: message.attachments.map((a) => ({
          name: a.name ?? 'attachment',
          url: a.url,
          mimeType: a.contentType ?? 'application/octet-stream',
        })),
        replyToId: message.reference?.messageId,
        raw: message,
      };

      // 处理消息
      await this.handleMessage(event, message);
    });

    // 错误处理
    this.client.on(Events.Error, (error) => {
      console.error('[Discord] Error:', error);
      this.onError?.(error);
    });
  }

  private async handleMessage(event: ChannelMessageEvent, discordMessage: Message): Promise<void> {
    try {
      // 显示打字指示器
      await this.sendTypingIndicator({
        sessionId: '',
        workspaceId: this.config.sessionConfig.defaultWorkspaceId,
        channelUserId: event.channelUserId,
        channelConversationId: event.channelConversationId,
      });

      // 获取或创建会话
      const session = await this.sessionManager.getOrCreateSession(
        event.channelUserId,
        event.channelConversationId
      );

      // 构建完整消息（包含附件）
      let fullContent = event.content;
      if (event.attachments?.length) {
        fullContent += '\n\n📎 Attachments:\n';
        for (const att of event.attachments) {
          fullContent += `- ${att.name}: ${att.url}\n`;
        }
      }

      // 收集响应
      const responseParts: string[] = [];
      let currentText = '';

      // 发送消息并处理流式响应
      await this.sessionManager.sendMessage(session, fullContent, async (agentEvent) => {
        switch (agentEvent.type) {
          case 'text_delta':
            currentText += agentEvent.delta;
            // Discord 消息限制 2000 字符，累积后发送
            if (currentText.length > 1800) {
              responseParts.push(currentText);
              currentText = '';
            }
            // 定期发送打字指示器
            await discordMessage.channel.sendTyping();
            break;

          case 'tool_start':
            // 保存当前文本
            if (currentText) {
              responseParts.push(currentText);
              currentText = '';
            }
            // 发送工具开始指示
            await this.sendMessage({
              sessionId: session.sessionId,
              workspaceId: session.workspaceId,
              channelUserId: event.channelUserId,
              channelConversationId: event.channelConversationId,
            }, {
              blocks: [{
                type: 'tool_use',
                name: agentEvent.toolName,
                intent: agentEvent.intent
              }]
            });
            break;

          case 'tool_result':
            // 发送工具结果
            await this.sendMessage({
              sessionId: session.sessionId,
              workspaceId: session.workspaceId,
              channelUserId: event.channelUserId,
              channelConversationId: event.channelConversationId,
            }, {
              blocks: [{
                type: 'tool_result',
                name: agentEvent.toolName,
                result: agentEvent.result,
                success: true
              }]
            });
            break;

          case 'complete':
            // 发送剩余文本
            if (currentText) {
              responseParts.push(currentText);
            }
            break;

          case 'error':
            await discordMessage.reply(`❌ Error: ${agentEvent.message}`);
            break;
        }
      });

      // 发送所有响应
      for (const part of responseParts) {
        if (part.trim()) {
          await discordMessage.reply(part);
        }
      }

    } catch (error) {
      console.error('[Discord] Error handling message:', error);
      await discordMessage.reply('❌ An error occurred while processing your message.');
    }
  }

  private splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    while (text.length > maxLength) {
      // 尝试在换行符处分割
      let splitIndex = text.lastIndexOf('\n', maxLength);
      if (splitIndex === -1 || splitIndex < maxLength / 2) {
        splitIndex = maxLength;
      }
      chunks.push(text.slice(0, splitIndex));
      text = text.slice(splitIndex).trim();
    }
    if (text) chunks.push(text);
    return chunks;
  }
}
```

### 4.2 Telegram 适配器

```typescript
// packages/channel-telegram/src/index.ts

import TelegramBot from 'node-telegram-bot-api';
import type {
  ChannelAdapter,
  ChannelContext,
  ChannelMessageEvent,
  RichContent,
} from '@craft-agent/channel-adapter';
import { ChannelSessionManager } from '@craft-agent/channel-adapter';

/**
 * Telegram 适配器配置
 */
export interface TelegramAdapterConfig {
  /** Telegram Bot Token */
  botToken: string;

  /** 允许的用户 ID (可选) */
  allowedUserIds?: number[];

  /** 允许的聊天 ID (可选) */
  allowedChatIds?: number[];

  /** 会话管理器配置 */
  sessionConfig: ChannelSessionConfig;
}

/**
 * Telegram 通道适配器
 */
export class TelegramAdapter implements ChannelAdapter {
  readonly channelId = 'telegram';
  readonly channelName = 'Telegram';

  private bot: TelegramBot;
  private config: TelegramAdapterConfig;
  private sessionManager: ChannelSessionManager;

  onMessage?: (event: ChannelMessageEvent) => void;
  onError?: (error: Error) => void;

  constructor(config: TelegramAdapterConfig) {
    this.config = config;

    // 创建 Telegram Bot
    this.bot = new TelegramBot(config.botToken, { polling: false });

    // 创建会话管理器
    this.sessionManager = new ChannelSessionManager(config.sessionConfig);

    // 设置事件处理器
    this.setupEventHandlers();
  }

  async start(): Promise<void> {
    await this.sessionManager.start();
    await this.bot.startPolling();
    console.log('[Telegram] Bot started polling');
  }

  async stop(): Promise<void> {
    await this.sessionManager.stop();
    await this.bot.stopPolling();
  }

  async sendMessage(context: ChannelContext, content: string | RichContent): Promise<void> {
    const chatId = parseInt(context.channelConversationId, 10);

    if (typeof content === 'string') {
      await this.sendTextMessage(chatId, content);
    } else {
      await this.sendRichContent(chatId, content);
    }
  }

  async sendTypingIndicator(context: ChannelContext): Promise<void> {
    const chatId = parseInt(context.channelConversationId, 10);
    await this.bot.sendChatAction(chatId, 'typing');
  }

  private async sendTextMessage(chatId: number, text: string): Promise<void> {
    // Telegram 消息限制 4096 字符
    if (text.length > 4000) {
      const chunks = this.splitMessage(text, 4000);
      for (const chunk of chunks) {
        await this.bot.sendMessage(chatId, chunk, { parse_mode: 'Markdown' });
      }
    } else {
      await this.bot.sendMessage(chatId, text, { parse_mode: 'Markdown' });
    }
  }

  private async sendRichContent(chatId: number, content: RichContent): Promise<void> {
    if (content.text) {
      await this.sendTextMessage(chatId, content.text);
    }

    if (content.blocks) {
      for (const block of content.blocks) {
        await this.sendBlock(chatId, block);
      }
    }
  }

  private async sendBlock(chatId: number, block: ContentBlock): Promise<void> {
    switch (block.type) {
      case 'text':
        await this.bot.sendMessage(chatId, block.text);
        break;

      case 'code':
        const codeContent = block.code.length > 4000
          ? block.code.slice(0, 4000) + '\n... (truncated)'
          : block.code;
        await this.bot.sendMessage(chatId, `\`\`\`${block.language ?? ''}\n${codeContent}\n\`\`\``, {
          parse_mode: 'Markdown',
        });
        break;

      case 'image':
        await this.bot.sendPhoto(chatId, block.url, {
          caption: block.alt
        });
        break;

      case 'tool_use':
        await this.bot.sendMessage(chatId, `🔧 *Tool:* ${block.name}\n_${block.intent ?? 'Executing...'}_`, {
          parse_mode: 'Markdown',
        });
        break;

      case 'tool_result':
        const emoji = block.success ? '✅' : '❌';
        const truncatedResult = block.result.length > 3500
          ? block.result.slice(0, 3500) + '...'
          : block.result;
        await this.bot.sendMessage(chatId, `${emoji} *Result:* ${block.name}\n\`\`\`\n${truncatedResult}\n\`\`\``, {
          parse_mode: 'Markdown',
        });
        break;
    }
  }

  private setupEventHandlers(): void {
    this.bot.on('message', async (msg) => {
      // 忽略无文本消息
      if (!msg.text) return;

      // 检查用户白名单
      if (this.config.allowedUserIds?.length &&
          !this.config.allowedUserIds.includes(msg.from?.id ?? 0)) {
        return;
      }

      // 检查群组白名单
      if (this.config.allowedChatIds?.length &&
          !this.config.allowedChatIds.includes(msg.chat.id)) {
        return;
      }

      const event: ChannelMessageEvent = {
        channelUserId: String(msg.from?.id),
        channelConversationId: String(msg.chat.id),
        content: msg.text,
        raw: msg,
      };

      await this.handleMessage(event);
    });

    this.bot.on('error', (error) => {
      console.error('[Telegram] Error:', error);
      this.onError?.(error);
    });
  }

  private async handleMessage(event: ChannelMessageEvent): Promise<void> {
    const chatId = parseInt(event.channelConversationId, 10);

    try {
      // 发送打字指示器
      await this.sendTypingIndicator({
        sessionId: '',
        workspaceId: this.config.sessionConfig.defaultWorkspaceId,
        channelUserId: event.channelUserId,
        channelConversationId: event.channelConversationId,
      });

      // 获取或创建会话
      const session = await this.sessionManager.getOrCreateSession(
        event.channelUserId,
        event.channelConversationId
      );

      let response = '';

      // 发送消息并处理响应
      await this.sessionManager.sendMessage(session, event.content, async (agentEvent) => {
        switch (agentEvent.type) {
          case 'text_delta':
            response += agentEvent.delta;
            // 定期更新打字指示器
            await this.bot.sendChatAction(chatId, 'typing');
            break;

          case 'tool_start':
            response += `\n\n🔧 *${agentEvent.toolName}*`;
            if (agentEvent.intent) {
              response += `: ${agentEvent.intent}`;
            }
            break;

          case 'complete':
            // 发送完整响应
            if (response.trim()) {
              await this.sendTextMessage(chatId, response);
            }
            break;

          case 'error':
            await this.bot.sendMessage(chatId, `❌ Error: ${agentEvent.message}`);
            break;
        }
      });

    } catch (error) {
      console.error('[Telegram] Error handling message:', error);
      await this.bot.sendMessage(chatId, '❌ An error occurred.');
    }
  }

  private splitMessage(text: string, maxLength: number): string[] {
    const chunks: string[] = [];
    while (text.length > maxLength) {
      let splitIndex = text.lastIndexOf('\n', maxLength);
      if (splitIndex === -1 || splitIndex < maxLength / 2) {
        splitIndex = maxLength;
      }
      chunks.push(text.slice(0, splitIndex));
      text = text.slice(splitIndex).trim();
    }
    if (text) chunks.push(text);
    return chunks;
  }
}
```

---

## 5. 项目结构

### 5.1 目录结构

```
packages/
├── channel-adapter/           # 基础适配器包
│   ├── src/
│   │   ├── index.ts           # 导出入口
│   │   ├── types.ts           # 接口定义
│   │   ├── session-manager.ts # 会话管理器
│   │   └── utils.ts           # 工具函数
│   ├── package.json
│   └── tsconfig.json
│
├── channel-discord/           # Discord 适配器
│   ├── src/
│   │   └── index.ts
│   ├── package.json
│   └── tsconfig.json
│
└── channel-telegram/          # Telegram 适配器
    ├── src/
    │   └── index.ts
    ├── package.json
    └── tsconfig.json

apps/
└── channel-server/            # 独立通道服务
    ├── src/
    │   ├── index.ts           # 入口
    │   ├── config.ts          # 配置加载
    │   └── adapters/          # 适配器管理
    │       └── loader.ts
    ├── package.json
    ├── tsconfig.json
    └── .env.example
```

### 5.2 包依赖

```json
// packages/channel-adapter/package.json
{
  "name": "@craft-agent/channel-adapter",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./types": "./src/types.ts"
  },
  "dependencies": {
    "@craft-agent/shared": "workspace:*"
  },
  "peerDependencies": {
    "typescript": "^5.0.0"
  }
}

// packages/channel-discord/package.json
{
  "name": "@craft-agent/channel-discord",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": {
    "@craft-agent/channel-adapter": "workspace:*",
    "discord.js": "^14.14.0"
  }
}

// packages/channel-telegram/package.json
{
  "name": "@craft-agent/channel-telegram",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "dependencies": {
    "@craft-agent/channel-adapter": "workspace:*",
    "node-telegram-bot-api": "^0.64.0"
  }
}
```

---

## 6. 部署与运行

### 6.1 环境变量

```bash
# apps/channel-server/.env.example

# Craft Agent 服务器配置
CRAFT_SERVER_URL=ws://127.0.0.1:9100
CRAFT_SERVER_TOKEN=your-server-token
DEFAULT_WORKSPACE_ID=your-workspace-id

# Discord 配置 (可选)
DISCORD_BOT_TOKEN=your-discord-bot-token
DISCORD_CHANNEL_IDS=channel1,channel2
DISCORD_USER_IDS=user1,user2

# Telegram 配置 (可选)
TELEGRAM_BOT_TOKEN=your-telegram-bot-token
TELEGRAM_USER_IDS=12345678,87654321
TELEGRAM_CHAT_IDS=-1001234567890

# 权限配置
DEFAULT_PERMISSION_MODE=ask  # safe | ask | allow-all
```

### 6.2 启动脚本

```typescript
// apps/channel-server/src/index.ts

import 'dotenv/config';
import { DiscordAdapter } from '@craft-agent/channel-discord';
import { TelegramAdapter } from '@craft-agent/channel-telegram';
import type { ChannelAdapter } from '@craft-agent/channel-adapter';

const adapters: ChannelAdapter[] = [];

/**
 * 加载并启动所有配置的适配器
 */
async function main(): Promise<void> {
  console.log('[ChannelServer] Starting...');

  // 验证必需配置
  if (!process.env.CRAFT_SERVER_URL) {
    throw new Error('CRAFT_SERVER_URL is required');
  }
  if (!process.env.CRAFT_SERVER_TOKEN) {
    throw new Error('CRAFT_SERVER_TOKEN is required');
  }
  if (!process.env.DEFAULT_WORKSPACE_ID) {
    throw new Error('DEFAULT_WORKSPACE_ID is required');
  }

  const sessionConfig = {
    serverUrl: process.env.CRAFT_SERVER_URL,
    serverToken: process.env.CRAFT_SERVER_TOKEN,
    defaultWorkspaceId: process.env.DEFAULT_WORKSPACE_ID,
    defaultPermissionMode: (process.env.DEFAULT_PERMISSION_MODE || 'ask') as 'safe' | 'ask' | 'allow-all',
  };

  // 启动 Discord 适配器
  if (process.env.DISCORD_BOT_TOKEN) {
    console.log('[ChannelServer] Loading Discord adapter...');
    const discord = new DiscordAdapter({
      botToken: process.env.DISCORD_BOT_TOKEN,
      allowedChannelIds: process.env.DISCORD_CHANNEL_IDS?.split(',').filter(Boolean),
      allowedUserIds: process.env.DISCORD_USER_IDS?.split(',').filter(Boolean),
      sessionConfig,
    });
    adapters.push(discord);
  }

  // 启动 Telegram 适配器
  if (process.env.TELEGRAM_BOT_TOKEN) {
    console.log('[ChannelServer] Loading Telegram adapter...');
    const telegram = new TelegramAdapter({
      botToken: process.env.TELEGRAM_BOT_TOKEN,
      allowedUserIds: process.env.TELEGRAM_USER_IDS?.split(',').map(Number).filter(Boolean),
      allowedChatIds: process.env.TELEGRAM_CHAT_IDS?.split(',').map(Number).filter(Boolean),
      sessionConfig,
    });
    adapters.push(telegram);
  }

  if (adapters.length === 0) {
    console.warn('[ChannelServer] No adapters configured!');
    return;
  }

  // 启动所有适配器
  for (const adapter of adapters) {
    try {
      await adapter.start();
      console.log(`[ChannelServer] Started ${adapter.channelName} adapter`);
    } catch (error) {
      console.error(`[ChannelServer] Failed to start ${adapter.channelName}:`, error);
    }
  }

  console.log('[ChannelServer] All adapters started!');

  // 优雅关闭
  const shutdown = async (signal: string) => {
    console.log(`[ChannelServer] Received ${signal}, shutting down...`);

    for (const adapter of adapters) {
      try {
        await adapter.stop();
        console.log(`[ChannelServer] Stopped ${adapter.channelName} adapter`);
      } catch (error) {
        console.error(`[ChannelServer] Error stopping ${adapter.channelName}:`, error);
      }
    }

    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[ChannelServer] Fatal error:', error);
  process.exit(1);
});
```

### 6.3 运行命令

```bash
# 开发模式
cd apps/channel-server
bun run src/index.ts

# 或从项目根目录
bun run apps/channel-server/src/index.ts

# 生产环境 (需要先构建)
bun run build
NODE_ENV=production node dist/index.js
```

---

## 7. 扩展指南

### 7.1 添加新通道

要添加新的消息通道（如 Slack、微信等），需要：

1. **创建新的适配器包**：

```bash
mkdir -p packages/channel-slack/src
```

2. **实现 ChannelAdapter 接口**：

```typescript
// packages/channel-slack/src/index.ts
import type { ChannelAdapter, ChannelContext, ChannelMessageEvent } from '@craft-agent/channel-adapter';
import { ChannelSessionManager } from '@craft-agent/channel-adapter';
import { App } from '@slack/bolt';

export class SlackAdapter implements ChannelAdapter {
  readonly channelId = 'slack';
  readonly channelName = 'Slack';

  // ... 实现所有接口方法
}
```

3. **在 channel-server 中注册**：

```typescript
// apps/channel-server/src/index.ts
import { SlackAdapter } from '@craft-agent/channel-slack';

if (process.env.SLACK_BOT_TOKEN) {
  const slack = new SlackAdapter({
    botToken: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    sessionConfig,
  });
  adapters.push(slack);
}
```

### 7.2 自定义消息格式化

可以扩展 `RichContent` 类型或添加自定义格式化器：

```typescript
// 自定义格式化器
export interface MessageFormatter {
  formatText(text: string): string;
  formatCode(code: string, language?: string): string;
  formatToolUse(name: string, intent?: string): string;
  formatToolResult(name: string, result: string, success: boolean): string;
}

// Discord 格式化器
export class DiscordFormatter implements MessageFormatter {
  formatText(text: string): string {
    return text;
  }

  formatCode(code: string, language?: string): string {
    return `\`\`\`${language ?? ''}\n${code}\n\`\`\``;
  }

  formatToolUse(name: string, intent?: string): string {
    return `🔧 **${name}**${intent ? `: ${intent}` : ''}`;
  }

  formatToolResult(name: string, result: string, success: boolean): string {
    const emoji = success ? '✅' : '❌';
    return `${emoji} **${name}**\n\`\`\`\n${result}\n\`\`\``;
  }
}
```

### 7.3 添加权限控制

可以在适配器层面添加更细粒度的权限控制：

```typescript
export interface ChannelPermission {
  /** 允许的工具列表 */
  allowedTools?: string[];

  /** 禁止的工具列表 */
  blockedTools?: string[];

  /** 允许的文件路径 */
  allowedPaths?: string[];

  /** 速率限制 (每分钟请求数) */
  rateLimit?: number;
}

// 在会话创建时应用权限
const session = await sessionManager.getOrCreateSession(
  channelUserId,
  channelConversationId,
  {
    permissionMode: 'ask',
    customPermissions: channelPermissions[channelUserId],
  }
);
```

---

## 8. 最佳实践

### 8.1 错误处理

```typescript
// 全局错误处理
adapter.onError = (error) => {
  // 记录错误
  logger.error('Channel error', { adapter: adapter.channelId, error });

  // 发送告警
  alerting.send({
    level: 'error',
    message: `Channel ${adapter.channelId} error: ${error.message}`,
  });
};

// 消息处理错误
try {
  await handleMessage(event);
} catch (error) {
  // 发送用户友好的错误消息
  await adapter.sendMessage(context, 'Sorry, an error occurred. Please try again.');

  // 记录详细错误
  logger.error('Message handling error', { event, error });
}
```

### 8.2 消息限流

```typescript
import { RateLimiter } from 'limiter';

const rateLimiters = new Map<string, RateLimiter>();

function getRateLimiter(userId: string): RateLimiter {
  let limiter = rateLimiters.get(userId);
  if (!limiter) {
    limiter = new RateLimiter({
      tokensPerInterval: 10,
      interval: 'minute',
    });
    rateLimiters.set(userId, limiter);
  }
  return limiter;
}

async function handleMessage(event: ChannelMessageEvent): Promise<void> {
  const limiter = getRateLimiter(event.channelUserId);

  if (!(await limiter.tryRemoveTokens(1))) {
    await adapter.sendMessage(context, '⚠️ Rate limit exceeded. Please wait a moment.');
    return;
  }

  // 处理消息...
}
```

### 8.3 监控与日志

```typescript
import { metrics } from './metrics';

// 记录消息处理时间
const startTime = Date.now();
await handleMessage(event);
metrics.timing('channel.message.process_time', Date.now() - startTime, {
  channel: adapter.channelId,
});

// 记录消息计数
metrics.increment('channel.message.received', 1, {
  channel: adapter.channelId,
  user_id: event.channelUserId,
});
```

---

## 9. 总结

本方案提供了一个可扩展的多通道架构，主要优势：

| 优势 | 说明 |
|------|------|
| **零侵入** | 不需要修改 server-core 或 shared 包 |
| **独立部署** | 通道服务可以独立部署和扩展 |
| **统一协议** | 所有通道使用相同的 WebSocket RPC 协议 |
| **会话隔离** | 每个对话有独立的会话 ID |
| **易于扩展** | 只需实现 ChannelAdapter 接口即可添加新通道 |
| **灵活配置** | 支持白名单、权限模式等配置 |

通过这种架构，可以轻松将 Craft Agents 扩展到 Discord、Telegram、Slack、飞书等各种消息平台。
