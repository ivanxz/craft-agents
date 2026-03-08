/**
 * IM Channel Manager
 *
 * Manages the lifecycle of IM channel adapters (Feishu, Discord, etc.)
 * - Starts enabled channels on app launch
 * - Provides CRUD operations for channel configs
 * - Stores credentials securely via CredentialManager
 */

import type { RpcServer } from '@craft-agent/server-core/transport'
import {
  getImChannels,
  getImChannel,
  addImChannel,
  updateImChannel,
  deleteImChannel,
  getEnabledImChannels,
  type ImChannelConfig,
  type ImChannelType,
  type FeishuCredentials,
  type DiscordCredentials,
} from '@craft-agent/shared/config'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol/channels'

// Import channel adapters
import { FeishuAdapter, type FeishuAdapterConfig } from '@craft-agent/channel-feishu'
import { DiscordAdapter, type DiscordAdapterConfig } from '@craft-agent/channel-discord'
import type { ChannelAdapter, ChannelSessionConfig } from '@craft-agent/channel-adapter'

// ============================================
// Types
// ============================================

export type ImChannelStatus = 'stopped' | 'starting' | 'running' | 'stopping' | 'error'

export interface ImChannelState {
  config: ImChannelConfig
  status: ImChannelStatus
  error?: string
  adapter?: ChannelAdapter
}

// ============================================
// IM Channel Manager
// ============================================

/**
 * Manages IM channel adapters lifecycle
 */
export class ImChannelManager {
  private channels: Map<string, ImChannelState> = new Map()
  private rpcServer: RpcServer | null = null
  private rpcHost: string
  private rpcPort: number
  private rpcToken: string

  constructor(rpcHost: string, rpcPort: number, rpcToken: string) {
    this.rpcHost = rpcHost
    this.rpcPort = rpcPort
    this.rpcToken = rpcToken
  }

  /**
   * Set RPC server for broadcasting events
   */
  setRpcServer(server: RpcServer): void {
    this.rpcServer = server
  }

  /**
   * Start all enabled channels
   */
  async startEnabledChannels(): Promise<void> {
    const enabledChannels = getEnabledImChannels()
    console.log(`[ImChannelManager] Starting ${enabledChannels.length} enabled channel(s)`)

    for (const config of enabledChannels) {
      try {
        await this.startChannel(config.id)
      } catch (error) {
        console.error(`[ImChannelManager] Failed to start channel ${config.id}:`, error)
      }
    }
  }

  /**
   * Stop all running channels
   */
  async stopAllChannels(): Promise<void> {
    console.log(`[ImChannelManager] Stopping all channels`)

    for (const [channelId, state] of this.channels) {
      if (state.status === 'running' || state.status === 'starting') {
        try {
          await this.stopChannel(channelId)
        } catch (error) {
          console.error(`[ImChannelManager] Failed to stop channel ${channelId}:`, error)
        }
      }
    }
  }

  /**
   * Start a specific channel
   */
  async startChannel(channelId: string): Promise<{ success: boolean; error?: string }> {
    const config = getImChannel(channelId)
    if (!config) {
      return { success: false, error: `Channel ${channelId} not found` }
    }

    // Check if already running
    const existing = this.channels.get(channelId)
    if (existing && existing.status === 'running') {
      return { success: true }
    }

    // Update state
    this.channels.set(channelId, {
      config,
      status: 'starting',
    })

    try {
      // Get credentials
      const credentials = await this.getChannelCredentials(config.type, channelId)
      if (!credentials) {
        throw new Error(`Credentials not found for channel ${channelId}`)
      }

      // Create session config
      const sessionConfig: ChannelSessionConfig = {
        serverUrl: `ws://${this.rpcHost}:${this.rpcPort}`,
        serverToken: this.rpcToken,
        defaultWorkspaceId: config.defaultWorkspaceId,
        defaultPermissionMode: config.defaultPermissionMode,
      }

      // Create adapter based on type
      let adapter: ChannelAdapter
      switch (config.type) {
        case 'feishu': {
          const feishuCreds = credentials as FeishuCredentials
          const feishuConfig: FeishuAdapterConfig = {
            appId: feishuCreds.appId,
            appSecret: feishuCreds.appSecret,
            encryptKey: feishuCreds.encryptKey,
            verificationToken: feishuCreds.verificationToken,
            domain: (config.config as any).domain || 'feishu',
            renderMode: (config.config as any).renderMode || 'text',
            sessionConfig,
          }
          adapter = new FeishuAdapter(feishuConfig)
          break
        }
        case 'discord': {
          const discordCreds = credentials as DiscordCredentials
          const discordConfig: DiscordAdapterConfig = {
            botToken: discordCreds.botToken,
            sessionConfig,
          }
          adapter = new DiscordAdapter(discordConfig)
          break
        }
        default:
          throw new Error(`Unknown channel type: ${config.type}`)
      }

      // Start the adapter
      await adapter.start()

      // Update state
      this.channels.set(channelId, {
        config,
        status: 'running',
        adapter,
      })

      console.log(`[ImChannelManager] Channel ${channelId} started successfully`)
      this.broadcastChanged()

      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`[ImChannelManager] Failed to start channel ${channelId}:`, errorMessage)

      this.channels.set(channelId, {
        config,
        status: 'error',
        error: errorMessage,
      })

      this.broadcastChanged()
      return { success: false, error: errorMessage }
    }
  }

  /**
   * Stop a specific channel
   */
  async stopChannel(channelId: string): Promise<{ success: boolean; error?: string }> {
    const state = this.channels.get(channelId)
    if (!state) {
      return { success: true } // Already stopped
    }

    if (state.status === 'stopped') {
      return { success: true }
    }

    // Update state
    this.channels.set(channelId, {
      ...state,
      status: 'stopping',
    })

    try {
      if (state.adapter) {
        await state.adapter.stop()
      }

      this.channels.set(channelId, {
        config: state.config,
        status: 'stopped',
      })

      console.log(`[ImChannelManager] Channel ${channelId} stopped successfully`)
      this.broadcastChanged()

      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      console.error(`[ImChannelManager] Failed to stop channel ${channelId}:`, errorMessage)

      this.channels.set(channelId, {
        ...state,
        status: 'error',
        error: errorMessage,
      })

      return { success: false, error: errorMessage }
    }
  }

  /**
   * Test channel connection
   */
  async testChannel(channelId: string): Promise<{ success: boolean; error?: string }> {
    const config = getImChannel(channelId)
    if (!config) {
      return { success: false, error: `Channel ${channelId} not found` }
    }

    try {
      // Get credentials
      const credentials = await this.getChannelCredentials(config.type, channelId)
      if (!credentials) {
        throw new Error('Credentials not found')
      }

      // For now, just validate that credentials exist and have required fields
      switch (config.type) {
        case 'feishu': {
          const creds = credentials as FeishuCredentials
          if (!creds.appId || !creds.appSecret) {
            throw new Error('App ID and App Secret are required')
          }
          break
        }
        case 'discord': {
          const creds = credentials as DiscordCredentials
          if (!creds.botToken) {
            throw new Error('Bot Token is required')
          }
          break
        }
      }

      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  }

  /**
   * Get channel status
   */
  getChannelStatus(channelId: string): ImChannelStatus {
    const state = this.channels.get(channelId)
    return state?.status || 'stopped'
  }

  /**
   * Get all channel states
   */
  getAllChannelStates(): ImChannelState[] {
    return Array.from(this.channels.values())
  }

  // ============================================
  // Credentials Management
  // ============================================

  /**
   * Get credentials for a channel
   * Uses source_apikey type with channelId as the name field
   */
  async getChannelCredentials(type: ImChannelType, channelId: string): Promise<FeishuCredentials | DiscordCredentials | null> {
    const credentialManager = getCredentialManager()
    const cred = await credentialManager.get({
      type: 'source_apikey',
      workspaceId: 'im_channels',
      sourceId: channelId,
    })

    if (!cred?.value) return null

    // Parse the JSON stored in value field
    try {
      return JSON.parse(cred.value) as FeishuCredentials | DiscordCredentials
    } catch {
      return null
    }
  }

  /**
   * Save credentials for a channel
   */
  async saveChannelCredentials(type: ImChannelType, channelId: string, credentials: FeishuCredentials | DiscordCredentials): Promise<void> {
    const credentialManager = getCredentialManager()
    await credentialManager.set({
      type: 'source_apikey',
      workspaceId: 'im_channels',
      sourceId: channelId,
    }, {
      value: JSON.stringify(credentials),
    })
  }

  /**
   * Delete credentials for a channel
   */
  async deleteChannelCredentials(type: ImChannelType, channelId: string): Promise<void> {
    const credentialManager = getCredentialManager()
    await credentialManager.delete({
      type: 'source_apikey',
      workspaceId: 'im_channels',
      sourceId: channelId,
    })
  }

  // ============================================
  // Event Broadcasting
  // ============================================

  /**
   * Broadcast channel list changed event
   */
  broadcastChanged(): void {
    if (this.rpcServer) {
      this.rpcServer.push(
        RPC_CHANNELS.imChannels.CHANGED,
        { to: 'all' as const },
        { channels: getImChannels() }
      )
    }
  }
}

// ============================================
// Singleton Instance
// ============================================

let instance: ImChannelManager | null = null

export function getImChannelManager(): ImChannelManager | null {
  return instance
}

export function initImChannelManager(rpcHost: string, rpcPort: number, rpcToken: string): ImChannelManager {
  if (!instance) {
    instance = new ImChannelManager(rpcHost, rpcPort, rpcToken)
  }
  return instance
}
