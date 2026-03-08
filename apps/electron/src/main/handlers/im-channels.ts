/**
 * IM Channels RPC Handlers
 *
 * Handles all IM channel-related RPC calls from the renderer process
 */

import type { RpcServer } from '@craft-agent/server-core/transport'
import type { HandlerDeps } from './handler-deps'
import { RPC_CHANNELS } from '@craft-agent/shared/protocol/channels'
import {
  getImChannels,
  getImChannel,
  addImChannel,
  updateImChannel,
  deleteImChannel,
  generateImChannelId,
  getDefaultImChannelConfig,
  type ImChannelConfig,
  type ImChannelType,
  type FeishuCredentials,
  type DiscordCredentials,
} from '@craft-agent/shared/config'
import { getImChannelManager } from '../im-channel-manager'

export function registerImChannelsHandlers(server: RpcServer, _deps: HandlerDeps): void {
  // List all IM channels
  server.handle(RPC_CHANNELS.imChannels.LIST, async () => {
    return { channels: getImChannels() }
  })

  // Get a specific channel
  server.handle(RPC_CHANNELS.imChannels.GET, async (_ctx, channelId: string) => {
    const channel = getImChannel(channelId)
    return { channel }
  })

  // Create a new channel
  server.handle(RPC_CHANNELS.imChannels.CREATE, async (_ctx, type: ImChannelType, name: string, defaultWorkspaceId: string) => {
    try {
      const id = generateImChannelId(type)
      const defaultConfig = getDefaultImChannelConfig(type, defaultWorkspaceId)
      const now = Date.now()

      const newChannel: ImChannelConfig = {
        ...defaultConfig,
        id,
        name: name || defaultConfig.name,
        enabled: false, // New channels start disabled
        createdAt: now,
        updatedAt: now,
      }

      addImChannel(newChannel)

      // Broadcast change
      const manager = getImChannelManager()
      if (manager) {
        manager.broadcastChanged()
      }

      return { success: true, channel: newChannel }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  // Update a channel
  server.handle(RPC_CHANNELS.imChannels.UPDATE, async (_ctx, channelId: string, updates: Partial<Omit<ImChannelConfig, 'id' | 'createdAt'>>) => {
    try {
      const updated = updateImChannel(channelId, updates)

      if (updated) {
        // Broadcast change
        const manager = getImChannelManager()
        if (manager) {
          manager.broadcastChanged()
        }

        return { success: true, channel: updated }
      }

      return { success: false, error: 'Channel not found' }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  // Delete a channel
  server.handle(RPC_CHANNELS.imChannels.DELETE, async (_ctx, channelId: string) => {
    try {
      // Stop channel first if running
      const manager = getImChannelManager()
      if (manager) {
        await manager.stopChannel(channelId)
      }

      // Get channel type before deleting
      const channel = getImChannel(channelId)
      const channelType = channel?.type

      // Delete config
      const deleted = deleteImChannel(channelId)

      if (deleted && channelType && manager) {
        // Delete credentials
        await manager.deleteChannelCredentials(channelType, channelId)

        // Broadcast change
        manager.broadcastChanged()
      }

      return { success: deleted }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  // Start a channel
  server.handle(RPC_CHANNELS.imChannels.START, async (_ctx, channelId: string) => {
    try {
      const manager = getImChannelManager()
      if (!manager) {
        return { success: false, error: 'IM Channel Manager not initialized' }
      }

      await manager.startChannel(channelId)
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  // Stop a channel
  server.handle(RPC_CHANNELS.imChannels.STOP, async (_ctx, channelId: string) => {
    try {
      const manager = getImChannelManager()
      if (!manager) {
        return { success: false, error: 'IM Channel Manager not initialized' }
      }

      await manager.stopChannel(channelId)
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  // Test channel connection
  server.handle(RPC_CHANNELS.imChannels.TEST, async (_ctx, channelId: string) => {
    try {
      const manager = getImChannelManager()
      if (!manager) {
        return { success: false, error: 'IM Channel Manager not initialized' }
      }

      const result = await manager.testChannel(channelId)
      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  // Get channel credentials (for editing)
  server.handle(RPC_CHANNELS.imChannels.GET_CREDENTIALS, async (_ctx, channelId: string) => {
    try {
      const channel = getImChannel(channelId)
      if (!channel) {
        return { success: false, error: 'Channel not found' }
      }

      const manager = getImChannelManager()
      if (!manager) {
        return { success: false, error: 'IM Channel Manager not initialized' }
      }

      const credentials = await manager.getChannelCredentials(channel.type, channelId)
      return { success: true, credentials }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })

  // Save channel credentials
  server.handle(RPC_CHANNELS.imChannels.SAVE_CREDENTIALS, async (_ctx, channelId: string, credentials: FeishuCredentials | DiscordCredentials) => {
    try {
      const channel = getImChannel(channelId)
      if (!channel) {
        return { success: false, error: 'Channel not found' }
      }

      const manager = getImChannelManager()
      if (!manager) {
        return { success: false, error: 'IM Channel Manager not initialized' }
      }

      await manager.saveChannelCredentials(channel.type, channelId, credentials)
      return { success: true }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      return { success: false, error: errorMessage }
    }
  })
}
