/**
 * Discord 通道适配器
 *
 * 实现 ChannelAdapter 接口，将 Discord 消息桥接到 Craft Agent
 */

import {
  Client,
  GatewayIntentBits,
  Events,
  Message,
  TextChannel,
  EmbedBuilder,
  Partials,
} from 'discord.js';
import type {
  ChannelAdapter,
  ChannelContext,
  ChannelMessageEvent,
  RichContent,
  ContentBlock,
  ChannelSessionConfig,
} from '@craft-agent/channel-adapter';
import { ChannelSessionManager } from '@craft-agent/channel-adapter';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

  /** 允许的服务器 ID (可选，为空则允许所有) */
  allowedGuildIds?: string[];

  /** 会话管理器配置 */
  sessionConfig: ChannelSessionConfig;
}

// ---------------------------------------------------------------------------
// Discord Adapter
// ---------------------------------------------------------------------------

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
      partials: [Partials.Channel], // 用于 DM
    });

    // 创建会话管理器
    this.sessionManager = new ChannelSessionManager(config.sessionConfig);

    // 设置事件处理器
    this.setupEventHandlers();
  }

  async start(): Promise<void> {
    await this.sessionManager.start();
    await this.client.login(this.config.botToken);
    console.log('[Discord] Bot logged in, waiting for ready...');
  }

  async stop(): Promise<void> {
    await this.sessionManager.stop();
    this.client.destroy();
    console.log('[Discord] Bot stopped');
  }

  async sendMessage(context: ChannelContext, content: string | RichContent): Promise<void> {
    const channel = await this.client.channels.fetch(context.channelConversationId);
    if (!channel?.isTextBased()) {
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
    if (channel?.isTextBased()) {
      // sendTyping exists on TextChannel, NewsChannel, VoiceChannel, etc.
      // but not on PartialGroupDMChannel - we use try/catch to handle this
      try {
        await (channel as TextChannel).sendTyping();
      } catch {
        // Ignore typing indicator errors for unsupported channel types
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private: Message Sending
  // -------------------------------------------------------------------------

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

      case 'code': {
        const codeContent =
          block.code.length > 1900
            ? block.code.slice(0, 1900) + '\n... (truncated)'
            : block.code;
        await channel.send(`\`\`\`${block.language ?? ''}\n${codeContent}\n\`\`\``);
        break;
      }

      case 'image':
        await channel.send({
          content: block.alt,
          files: [block.url],
        });
        break;

      case 'tool_use': {
        const toolEmbed = new EmbedBuilder()
          .setColor(0x0099ff)
          .setTitle(`🔧 Tool: ${block.name}`)
          .setDescription(block.intent ?? 'Executing...');
        await channel.send({ embeds: [toolEmbed] });
        break;
      }

      case 'tool_result': {
        const resultEmbed = new EmbedBuilder()
          .setColor(block.success ? 0x00ff00 : 0xff0000)
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
  }

  // -------------------------------------------------------------------------
  // Private: Event Handlers
  // -------------------------------------------------------------------------

  private setupEventHandlers(): void {
    // Bot 就绪
    this.client.on(Events.ClientReady, (client) => {
      console.log(`[Discord] Bot ready: ${client.user.tag}`);
    });

    // 收到消息
    this.client.on(Events.MessageCreate, async (message) => {
      await this.handleMessageCreate(message);
    });

    // 错误处理
    this.client.on(Events.Error, (error) => {
      console.error('[Discord] Error:', error);
      this.onError?.(error);
    });

    // 警告处理
    this.client.on(Events.Warn, (message) => {
      console.warn('[Discord] Warning:', message);
    });

    // Debug (仅在开发时启用)
    // this.client.on(Events.Debug, (message) => {
    //   console.log('[Discord] Debug:', message);
    // });
  }

  private async handleMessageCreate(message: Message): Promise<void> {
    // 忽略机器人消息
    if (message.author.bot) return;

    // 检查服务器白名单（仅对服务器消息）
    if (message.guild && this.config.allowedGuildIds?.length) {
      if (!this.config.allowedGuildIds.includes(message.guild.id)) {
        return;
      }
    }

    // 检查频道白名单
    if (this.config.allowedChannelIds?.length) {
      if (!this.config.allowedChannelIds.includes(message.channelId)) {
        return;
      }
    }

    // 检查用户白名单
    if (this.config.allowedUserIds?.length) {
      if (!this.config.allowedUserIds.includes(message.author.id)) {
        return;
      }
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
            try {
              await (discordMessage.channel as TextChannel).sendTyping();
            } catch {
              // Ignore typing indicator errors
            }
            break;

          case 'tool_start':
            // 保存当前文本
            if (currentText) {
              responseParts.push(currentText);
              currentText = '';
            }
            // 发送工具开始指示
            await this.sendMessage(
              {
                sessionId: session.sessionId,
                workspaceId: session.workspaceId,
                channelUserId: event.channelUserId,
                channelConversationId: event.channelConversationId,
              },
              {
                blocks: [
                  {
                    type: 'tool_use',
                    name: agentEvent.toolName,
                    intent: agentEvent.intent,
                  },
                ],
              }
            );
            break;

          case 'tool_result':
            // 发送工具结果
            await this.sendMessage(
              {
                sessionId: session.sessionId,
                workspaceId: session.workspaceId,
                channelUserId: event.channelUserId,
                channelConversationId: event.channelConversationId,
              },
              {
                blocks: [
                  {
                    type: 'tool_result',
                    name: agentEvent.toolName,
                    result: agentEvent.result,
                    success: true,
                  },
                ],
              }
            );
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

          case 'interrupted':
            if (currentText) {
              responseParts.push(currentText);
            }
            await discordMessage.reply('⚠️ Response was interrupted.');
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
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await discordMessage.reply(`❌ An error occurred: ${errorMessage}`).catch(() => {});
    }
  }

  // -------------------------------------------------------------------------
  // Private: Utilities
  // -------------------------------------------------------------------------

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
