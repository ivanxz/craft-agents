/**
 * 飞书/Lark 通道适配器
 *
 * 实现 ChannelAdapter 接口，将飞书消息桥接到 Craft Agent
 */

import * as path from 'path';
import type {
  ChannelAdapter,
  ChannelContext,
  ChannelMessageEvent,
  RichContent,
  ContentBlock,
} from '@craft-agent/channel-adapter';
import { ChannelSessionManager } from '@craft-agent/channel-adapter';
import type { FeishuAdapterConfig, FeishuMessageEvent, FeishuMessageContext } from './types';
import { downloadFeishuMedia } from './media';

// Re-export types
export type { FeishuAdapterConfig } from './types';
export * from './media';

// Message deduplication cache
const processedMessages = new Map<string, number>();
const MESSAGE_DEDUP_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * 飞书通道适配器
 */
export class FeishuAdapter implements ChannelAdapter {
  readonly channelId = 'feishu';
  readonly channelName = 'Feishu/Lark';

  private wsClient: any = null;
  private restClient: any = null;
  private config: FeishuAdapterConfig | null = null;
  private sessionManager: ChannelSessionManager | null = null;
  private botOpenId: string | null = null;
  private lastChatId: string | null = null;
  private log: (...args: unknown[]) => void = () => {};

  onMessage?: (event: ChannelMessageEvent) => void;
  onError?: (error: Error) => void;

  constructor(config: FeishuAdapterConfig) {
    this.config = config;
    this.log = config.debug ? console.log.bind(console) : () => {};
    this.sessionManager = new ChannelSessionManager(config.sessionConfig);
  }

  async start(): Promise<void> {
    if (!this.config) {
      throw new Error('Feishu adapter config is required');
    }

    if (!this.config.appId || !this.config.appSecret) {
      throw new Error('Feishu appId and appSecret are required');
    }

    this.log('[Feishu] Starting...');

    // Start session manager
    if (this.sessionManager) {
      await this.sessionManager.start();
    }

    try {
      // Dynamically import @larksuiteoapi/node-sdk
      const Lark = await import('@larksuiteoapi/node-sdk');

      // Resolve domain
      const domain = this.resolveDomain(this.config.domain || 'feishu', Lark);

      // Create REST client for sending messages
      this.restClient = new Lark.Client({
        appId: this.config.appId,
        appSecret: this.config.appSecret,
        appType: Lark.AppType.SelfBuild,
        domain,
      });

      // Probe bot info to get open_id
      const probeResult = await this.probeBot();
      if (!probeResult.ok) {
        throw new Error(`Failed to probe bot: ${probeResult.error}`);
      }

      this.botOpenId = probeResult.botOpenId || null;
      this.log(`[Feishu] Bot info: ${probeResult.botName} (${this.botOpenId})`);

      // Create WebSocket client
      this.wsClient = new Lark.WSClient({
        appId: this.config.appId,
        appSecret: this.config.appSecret,
        domain,
        loggerLevel: this.config.debug ? Lark.LoggerLevel.debug : Lark.LoggerLevel.info,
      });

      // Create event dispatcher
      const eventDispatcher = new Lark.EventDispatcher({
        encryptKey: this.config.encryptKey,
        verificationToken: this.config.verificationToken,
      });

      // Register event handlers
      eventDispatcher.register({
        'im.message.receive_v1': async (data: unknown) => {
          try {
            const event = data as FeishuMessageEvent;

            // Check for duplicate
            if (this.isMessageProcessed(event.message.message_id)) {
              this.log(`[Feishu] Duplicate message ignored: ${event.message.message_id}`);
              return;
            }

            const ctx = this.parseMessageEvent(event);
            // Fire-and-forget: do not await so the Lark SDK can send the ack
            this.handleInboundMessage(ctx).catch((err) => {
              console.error(`[Feishu] Error handling message ${ctx.messageId}: ${err.message}`);
            });
          } catch (err: any) {
            console.error(`[Feishu] Error parsing message event: ${err.message}`);
          }
        },
        'im.message.message_read_v1': async () => {
          // Ignore read receipts
        },
      });

      // Start WebSocket client
      this.wsClient.start({ eventDispatcher });

      this.log('[Feishu] Started successfully');
    } catch (error: any) {
      this.wsClient = null;
      this.restClient = null;
      console.error(`[Feishu] Failed to start: ${error.message}`);
      this.onError?.(error);
      throw error;
    }
  }

  async stop(): Promise<void> {
    this.log('[Feishu] Stopping...');

    if (this.sessionManager) {
      await this.sessionManager.stop();
    }
    this.wsClient = null;
    this.restClient = null;

    this.log('[Feishu] Stopped');
  }

  async sendMessage(context: ChannelContext, content: string | RichContent): Promise<void> {
    if (!this.restClient) {
      throw new Error('Feishu adapter not connected');
    }

    if (typeof content === 'string') {
      await this.sendTextMessage(context.channelConversationId, content);
    } else {
      await this.sendRichContent(context.channelConversationId, content);
    }
  }

  async sendTypingIndicator(_context: ChannelContext): Promise<void> {
    // Feishu doesn't have typing indicator API - no-op
  }

  // -------------------------------------------------------------------------
  // Private: Domain & Bot Info
  // -------------------------------------------------------------------------

  private resolveDomain(domain: string, Lark: any): any {
    if (domain === 'lark') return Lark.Domain.Lark;
    if (domain === 'feishu') return Lark.Domain.Feishu;
    return domain.replace(/\/+$/, '');
  }

  private async probeBot(): Promise<{
    ok: boolean;
    error?: string;
    botName?: string;
    botOpenId?: string;
  }> {
    try {
      const response: any = await this.restClient.request({
        method: 'GET',
        url: '/open-apis/bot/v3/info',
      });

      if (response.code !== 0) {
        return { ok: false, error: response.msg };
      }

      return {
        ok: true,
        botName: response.data?.app_name ?? response.data?.bot?.app_name,
        botOpenId: response.data?.open_id ?? response.data?.bot?.open_id,
      };
    } catch (err: any) {
      return { ok: false, error: err.message };
    }
  }

  // -------------------------------------------------------------------------
  // Private: Message Deduplication
  // -------------------------------------------------------------------------

  private isMessageProcessed(messageId: string): boolean {
    this.cleanupProcessedMessages();
    if (processedMessages.has(messageId)) {
      return true;
    }
    processedMessages.set(messageId, Date.now());
    return false;
  }

  private cleanupProcessedMessages(): void {
    const now = Date.now();
    for (const [messageId, timestamp] of processedMessages) {
      if (now - timestamp > MESSAGE_DEDUP_TTL) {
        processedMessages.delete(messageId);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private: Message Parsing
  // -------------------------------------------------------------------------

  private parseMessageEvent(event: FeishuMessageEvent): FeishuMessageContext {
    const messageType = event.message.message_type;
    const rawContent = this.parseMessageContent(event.message.content, messageType);
    const mentionedBot = this.checkBotMentioned(event);
    const content = this.stripBotMention(rawContent, event.message.mentions);

    // Extract media keys from content JSON for media message types
    let mediaKey: string | undefined;
    let mediaType: string | undefined;
    let mediaFileName: string | undefined;
    let mediaDuration: number | undefined;

    if (['image', 'file', 'audio', 'video', 'media'].includes(messageType)) {
      try {
        const parsed = JSON.parse(event.message.content);
        mediaType = messageType;

        if (messageType === 'image') {
          mediaKey = parsed.image_key;
        } else {
          // file, audio, video, media all use file_key
          mediaKey = parsed.file_key;
          mediaFileName = parsed.file_name;
          if (parsed.duration !== undefined) {
            mediaDuration =
              typeof parsed.duration === 'string' ? parseInt(parsed.duration, 10) : parsed.duration;
          }
        }
      } catch {
        // JSON parse failed, skip media extraction
      }
    }

    return {
      chatId: event.message.chat_id,
      messageId: event.message.message_id,
      senderId: event.sender.sender_id.user_id || event.sender.sender_id.open_id || '',
      senderOpenId: event.sender.sender_id.open_id || '',
      chatType: event.message.chat_type,
      mentionedBot,
      rootId: event.message.root_id,
      parentId: event.message.parent_id,
      content,
      contentType: messageType,
      mediaKey,
      mediaType,
      mediaFileName,
      mediaDuration,
    };
  }

  private parseMessageContent(content: string, messageType: string): string {
    try {
      const parsed = JSON.parse(content);
      if (messageType === 'text') {
        return parsed.text || '';
      }
      if (messageType === 'post') {
        return this.parsePostContent(content);
      }
      // For media types, return descriptive text
      if (messageType === 'image') return '[图片]';
      if (messageType === 'audio') return '[语音]';
      if (messageType === 'video' || messageType === 'media') return '[视频]';
      if (messageType === 'file') return parsed.file_name ? `[文件: ${parsed.file_name}]` : '[文件]';
      return content;
    } catch {
      return content;
    }
  }

  private parsePostContent(content: string): string {
    try {
      const parsed = JSON.parse(content);
      const title = parsed.title || '';
      const contentBlocks = parsed.content || [];
      let textContent = title ? `${title}\n\n` : '';

      for (const paragraph of contentBlocks) {
        if (Array.isArray(paragraph)) {
          for (const element of paragraph) {
            if (element.tag === 'text') {
              textContent += element.text || '';
            } else if (element.tag === 'a') {
              textContent += element.text || element.href || '';
            } else if (element.tag === 'at') {
              textContent += `@${element.user_name || element.user_id || ''}`;
            }
          }
          textContent += '\n';
        }
      }

      return textContent.trim() || '[富文本消息]';
    } catch {
      return '[富文本消息]';
    }
  }

  private checkBotMentioned(event: FeishuMessageEvent): boolean {
    const mentions = event.message.mentions ?? [];
    if (mentions.length === 0) return false;
    if (!this.botOpenId) return mentions.length > 0;
    return mentions.some((m) => m.id.open_id === this.botOpenId);
  }

  private stripBotMention(
    text: string,
    mentions?: FeishuMessageEvent['message']['mentions']
  ): string {
    if (!mentions || mentions.length === 0) return text;
    let result = text;
    for (const mention of mentions) {
      result = result.replace(new RegExp(`@${mention.name}\\s*`, 'g'), '').trim();
      result = result.replace(new RegExp(mention.key, 'g'), '').trim();
    }
    return result;
  }

  // -------------------------------------------------------------------------
  // Private: Message Sending
  // -------------------------------------------------------------------------

  private resolveReceiveIdType(target: string): 'open_id' | 'user_id' | 'chat_id' {
    if (target.startsWith('ou_')) return 'open_id';
    if (target.startsWith('oc_')) return 'chat_id';
    return 'chat_id';
  }

  private stringifyAsciiJson(obj: unknown): string {
    return JSON.stringify(obj).replace(/[^\x00-\x7F]/g, (char) => {
      return '\\u' + ('0000' + char.charCodeAt(0).toString(16)).slice(-4);
    });
  }

  private async sendTextMessage(to: string, text: string): Promise<void> {
    const receiveIdType = this.resolveReceiveIdType(to);
    const content = this.stringifyAsciiJson({ text });

    const renderMode = this.config?.renderMode || 'text';

    this.log(
      '[Feishu] Sending text message:',
      JSON.stringify({ to, renderMode, textLength: text.length })
    );

    if (renderMode === 'card') {
      await this.sendCardMessage(to, text);
    } else {
      const response = await this.restClient.im.message.create({
        params: { receive_id_type: receiveIdType },
        data: { receive_id: to, content, msg_type: 'text' },
      });

      if (response.code !== 0) {
        throw new Error(`Feishu send failed: ${response.msg || `code ${response.code}`}`);
      }
    }
  }

  private buildMarkdownCard(text: string): Record<string, unknown> {
    return {
      config: { wide_screen_mode: true },
      elements: [{ tag: 'markdown', content: text }],
    };
  }

  private async sendCardMessage(to: string, text: string): Promise<void> {
    const receiveIdType = this.resolveReceiveIdType(to);
    const card = this.buildMarkdownCard(text);
    const content = this.stringifyAsciiJson(card);

    const response = await this.restClient.im.message.create({
      params: { receive_id_type: receiveIdType },
      data: { receive_id: to, content, msg_type: 'interactive' },
    });

    if (response.code !== 0) {
      throw new Error(`Feishu card send failed: ${response.msg || `code ${response.code}`}`);
    }
  }

  private async sendRichContent(to: string, content: RichContent): Promise<void> {
    if (content.text) {
      await this.sendTextMessage(to, content.text);
    }

    if (content.blocks) {
      for (const block of content.blocks) {
        await this.sendBlock(to, block);
      }
    }
  }

  private async sendBlock(to: string, block: ContentBlock): Promise<void> {
    switch (block.type) {
      case 'text':
        await this.sendTextMessage(to, block.text);
        break;

      case 'code':
        await this.sendTextMessage(to, `\`\`\`${block.language ?? ''}\n${block.code}\n\`\`\``);
        break;

      case 'image':
        // For simplicity, just send the URL as text
        await this.sendTextMessage(to, block.url);
        break;

      case 'tool_use':
        await this.sendTextMessage(to, `🔧 **Tool: ${block.name}**\n${block.intent ?? 'Executing...'}`);
        break;

      case 'tool_result': {
        const emoji = block.success ? '✅' : '❌';
        await this.sendTextMessage(to, `${emoji} **Result: ${block.name}**\n\`\`\`\n${block.result}\n\`\`\``);
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private: Inbound Message Handling
  // -------------------------------------------------------------------------

  private async handleInboundMessage(ctx: FeishuMessageContext): Promise<void> {
    // In group chat, only respond when bot is mentioned
    if (ctx.chatType === 'group' && !ctx.mentionedBot) {
      this.log('[Feishu] Ignoring group message without bot mention');
      return;
    }

    // Check whitelist
    if (this.config?.allowedChatIds?.length && !this.config.allowedChatIds.includes(ctx.chatId)) {
      this.log('[Feishu] Ignoring message from non-whitelisted chat');
      return;
    }

    if (this.config?.allowedUserIds?.length && !this.config.allowedUserIds.includes(ctx.senderId)) {
      this.log('[Feishu] Ignoring message from non-whitelisted user');
      return;
    }

    // Download media attachments if present
    let attachments: ChannelMessageEvent['attachments'];
    if (ctx.mediaKey && ctx.mediaType && this.restClient) {
      try {
        const result = await downloadFeishuMedia(
          this.restClient,
          ctx.messageId,
          ctx.mediaKey,
          ctx.mediaType,
          ctx.mediaFileName
        );
        if (result) {
          attachments = [
            {
              name: ctx.mediaFileName || 'media',
              url: `file://${result.localPath}`,
              mimeType: this.getMimeType(ctx.mediaType, ctx.mediaFileName),
            },
          ];
        }
      } catch (err: any) {
        console.error(`[Feishu] Failed to download media: ${err.message}`);
      }
    }

    // Build full content with attachments
    let fullContent = ctx.content;
    if (attachments?.length) {
      fullContent += '\n\n📎 Attachments:\n';
      for (const att of attachments) {
        fullContent += `- ${att.name}: ${att.url}\n`;
      }
    }

    // Create message event
    const event: ChannelMessageEvent = {
      channelUserId: ctx.senderId,
      channelConversationId: ctx.chatId,
      content: fullContent,
      attachments,
      raw: ctx,
    };

    this.log(
      '[Feishu] Received message:',
      JSON.stringify({
        sender: ctx.senderOpenId,
        senderId: ctx.senderId,
        chatId: ctx.chatId,
        chatType: ctx.chatType,
        messageId: ctx.messageId,
        contentType: ctx.contentType,
        content: ctx.content,
        mentionedBot: ctx.mentionedBot,
        attachmentsCount: attachments?.length || 0,
      })
    );

    // Store last chat ID
    this.lastChatId = ctx.chatId;

    // Get or create session
    if (!this.sessionManager) {
      throw new Error('Session manager not initialized');
    }

    let session;
    try {
      session = await this.sessionManager.getOrCreateSession(ctx.senderId, ctx.chatId);
    } catch (err: any) {
      console.error(`[Feishu] Failed to create session: ${err.message}`);
      await this.sendTextMessage(ctx.chatId, `❌ 无法连接到 Craft Agent 服务器。请确保服务器正在运行。\n\n错误: ${err.message}`);
      return;
    }

    // Collect response
    const responseParts: string[] = [];
    let currentText = '';

    // Send message and handle streaming response
    await this.sessionManager.sendMessage(session, fullContent, async (agentEvent) => {
      switch (agentEvent.type) {
        case 'text_delta':
          currentText += agentEvent.delta;
          // Feishu message limit is 30KB, we use smaller chunks
          if (currentText.length > 8000) {
            responseParts.push(currentText);
            currentText = '';
          }
          break;

        case 'tool_start':
          if (currentText) {
            responseParts.push(currentText);
            currentText = '';
          }
          // Send tool start indicator
          await this.sendMessage(
            {
              sessionId: session.sessionId,
              workspaceId: session.workspaceId,
              channelUserId: ctx.senderId,
              channelConversationId: ctx.chatId,
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
          await this.sendMessage(
            {
              sessionId: session.sessionId,
              workspaceId: session.workspaceId,
              channelUserId: ctx.senderId,
              channelConversationId: ctx.chatId,
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
          if (currentText) {
            responseParts.push(currentText);
          }
          break;

        case 'error':
          await this.sendTextMessage(ctx.chatId, `❌ Error: ${agentEvent.message}`);
          break;

        case 'interrupted':
          if (currentText) {
            responseParts.push(currentText);
          }
          await this.sendTextMessage(ctx.chatId, '⚠️ Response was interrupted.');
          break;
      }
    });

    // Send all response parts
    for (const part of responseParts) {
      if (part.trim()) {
        await this.sendTextMessage(ctx.chatId, part);
      }
    }
  }

  private getMimeType(mediaType: string, fileName?: string): string {
    if (fileName) {
      const ext = path.extname(fileName).toLowerCase();
      const mimeMap: Record<string, string> = {
        '.jpg': 'image/jpeg',
        '.jpeg': 'image/jpeg',
        '.png': 'image/png',
        '.gif': 'image/gif',
        '.webp': 'image/webp',
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
        '.opus': 'audio/ogg',
        '.ogg': 'audio/ogg',
        '.mp3': 'audio/mpeg',
        '.pdf': 'application/pdf',
      };
      if (mimeMap[ext]) return mimeMap[ext];
    }

    switch (mediaType) {
      case 'image':
        return 'image/jpeg';
      case 'audio':
        return 'audio/ogg';
      case 'video':
      case 'media':
        return 'video/mp4';
      default:
        return 'application/octet-stream';
    }
  }
}
