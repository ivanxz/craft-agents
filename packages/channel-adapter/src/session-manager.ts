/**
 * 通道会话管理器
 *
 * 职责：
 * 1. 管理通道用户与 Craft Agent 会话的映射
 * 2. 创建和清理 RPC 客户端连接
 * 3. 发送消息并处理流式响应
 */

import {
  PROTOCOL_VERSION,
  type MessageEnvelope,
} from '@craft-agent/shared/protocol';
import {
  serializeEnvelope,
  deserializeEnvelope,
} from '@craft-agent/server-core/transport';
import type {
  ChannelSessionConfig,
  ChannelAgentEvent,
  ContentBlock,
} from './types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
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
  client: ChannelRpcClient;
}

/**
 * 简化的 RPC 客户端（基于 CliRpcClient）
 */
export class ChannelRpcClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private listeners = new Map<string, Set<(...args: unknown[]) => void>>();
  private _clientId: string | null = null;
  private _connected = false;
  private _destroyed = false;

  private readonly url: string;
  private readonly token: string | undefined;
  private readonly workspaceId: string | undefined;
  private readonly requestTimeout: number;
  private readonly connectTimeout: number;

  constructor(url: string, opts?: { token?: string; workspaceId?: string; requestTimeout?: number }) {
    this.url = url;
    this.token = opts?.token;
    this.workspaceId = opts?.workspaceId;
    this.requestTimeout = opts?.requestTimeout ?? 300_000; // 5 分钟
    this.connectTimeout = 10_000;
  }

  /** Connect to the server and complete the handshake. Returns the assigned clientId. */
  async connect(): Promise<string> {
    if (this._destroyed) throw new Error('Client destroyed');

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Connection timeout (${this.connectTimeout}ms)`));
        this.ws?.close();
      }, this.connectTimeout);

      this.ws = new WebSocket(this.url);

      this.ws.onopen = () => {
        const handshake: MessageEnvelope = {
          id: crypto.randomUUID(),
          type: 'handshake',
          protocolVersion: PROTOCOL_VERSION,
          workspaceId: this.workspaceId,
          token: this.token,
        };
        this.ws!.send(serializeEnvelope(handshake));
      };

      this.ws.onmessage = (event) => {
        const raw = typeof event.data === 'string' ? event.data : String(event.data);
        let envelope: MessageEnvelope;
        try {
          envelope = deserializeEnvelope(raw);
        } catch {
          return;
        }

        if (envelope.type === 'handshake_ack') {
          clearTimeout(timer);
          this._clientId = envelope.clientId ?? null;
          this._connected = true;
          // Switch to normal message handler
          this.ws!.onmessage = (e) => {
            this.onMessage(typeof e.data === 'string' ? e.data : String(e.data));
          };
          resolve(this._clientId!);
        } else if (envelope.type === 'error') {
          clearTimeout(timer);
          const err = new Error(envelope.error?.message ?? 'Connection rejected');
          (err as Error & { code?: string }).code = envelope.error?.code;
          reject(err);
        }
      };

      this.ws.onerror = () => {
        if (!this._connected) {
          clearTimeout(timer);
          reject(new Error(`WebSocket connection error: Cannot connect to ${this.url}. Make sure the Craft Agent server is running.`));
        }
      };

      this.ws.onclose = () => {
        if (!this._connected) {
          clearTimeout(timer);
          reject(new Error('WebSocket closed before handshake'));
        }
        this._connected = false;
        for (const [, req] of this.pending) {
          clearTimeout(req.timeout);
          req.reject(new Error('Disconnected'));
        }
        this.pending.clear();
      };
    });
  }

  /** Send an RPC request and await the response. */
  async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    if (!this._connected || !this.ws) {
      throw new Error(`Not connected (channel: ${channel})`);
    }

    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Request timeout: ${channel} (${this.requestTimeout}ms)`));
      }, this.requestTimeout);

      this.pending.set(id, { resolve, reject, timeout });

      const envelope: MessageEnvelope = {
        id,
        type: 'request',
        channel,
        args,
      };
      this.ws!.send(serializeEnvelope(envelope));
    });
  }

  /** Subscribe to push events on a channel. Returns an unsubscribe function. */
  on(channel: string, callback: (...args: unknown[]) => void): () => void {
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
    }
    set.add(callback);

    return () => {
      set!.delete(callback);
      if (set!.size === 0) this.listeners.delete(channel);
    };
  }

  /** Close the connection and reject all pending requests. */
  destroy(): void {
    this._destroyed = true;
    for (const [, req] of this.pending) {
      clearTimeout(req.timeout);
      req.reject(new Error('Client destroyed'));
    }
    this.pending.clear();
    this.ws?.close();
    this.ws = null;
    this._connected = false;
  }

  get isConnected(): boolean {
    return this._connected;
  }

  get clientId(): string | null {
    return this._clientId;
  }

  // -------------------------------------------------------------------------
  // Internal message routing
  // -------------------------------------------------------------------------

  private onMessage(raw: string): void {
    let envelope: MessageEnvelope;
    try {
      envelope = deserializeEnvelope(raw);
    } catch {
      return;
    }

    switch (envelope.type) {
      case 'response': {
        const req = this.pending.get(envelope.id);
        if (req) {
          this.pending.delete(envelope.id);
          clearTimeout(req.timeout);
          if (envelope.error) {
            const err = new Error(envelope.error.message);
            (err as Error & { code?: string; data?: unknown }).code = envelope.error.code;
            (err as Error & { code?: string; data?: unknown }).data = envelope.error.data;
            req.reject(err);
          } else {
            req.resolve(envelope.result);
          }
        }
        break;
      }

      case 'event': {
        if (envelope.channel) {
          const set = this.listeners.get(envelope.channel);
          if (set) {
            for (const cb of set) {
              try {
                cb(...(envelope.args ?? []));
              } catch {
                // Listener errors shouldn't break the client
              }
            }
          }
        }
        break;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Session Manager
// ---------------------------------------------------------------------------

/**
 * 通道会话管理器
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
    const client = new ChannelRpcClient(this.config.serverUrl, {
      token: this.config.serverToken,
      workspaceId: this.config.defaultWorkspaceId,
      requestTimeout: 300000, // 5 分钟
    });

    // 连接到服务器
    await client.connect();

    // 切换到目标工作区
    await client.invoke('window:switchWorkspace', this.config.defaultWorkspaceId);

    // 创建新会话
    const sessionResult = await client.invoke(
      'sessions:create',
      this.config.defaultWorkspaceId,
      {
        permissionMode: this.config.defaultPermissionMode,
        name: `Channel: ${channelUserId}`,
      }
    ) as { id: string };

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

    // 用于跟踪完成状态
    let completed = false;
    let resolveCompletion: () => void;
    const completionPromise = new Promise<void>((resolve) => {
      resolveCompletion = resolve;
    });

    // 设置事件监听器
    const eventHandler = async (event: unknown) => {
      const ev = event as { type: string; sessionId: string; [key: string]: unknown };

      // 只处理当前会话的事件
      if (ev.sessionId !== session.sessionId) return;

      // 转换事件类型
      const channelEvent = this.mapEvent(ev);
      await onEvent(channelEvent);

      // 检查是否完成
      if (channelEvent.type === 'complete' || channelEvent.type === 'error' || channelEvent.type === 'interrupted') {
        completed = true;
        resolveCompletion();
      }
    };

    // 订阅事件
    const unsubscribe = session.client.on('session:event', eventHandler);

    try {
      // 发送消息
      await session.client.invoke('sessions:sendMessage', session.sessionId, message);

      // 等待完成（带超时）
      const timeout = setTimeout(() => {
        if (!completed) {
          resolveCompletion();
        }
      }, 300000); // 5 分钟超时

      await completionPromise;
      clearTimeout(timeout);
    } finally {
      // 取消订阅
      unsubscribe();
    }
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
          intent: event.toolIntent ? String(event.toolIntent) : undefined,
        };
      case 'tool_result':
        return {
          type: 'tool_result',
          toolName: String(event.toolName ?? ''),
          result: String(event.result ?? ''),
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

// Re-export types
export type { ChannelSessionConfig, ChannelAgentEvent, ContentBlock };
