/**
 * IM Channel Configuration
 *
 * Manages IM bot configurations (Feishu, Discord, etc.)
 * - Channel configs are stored in config.json
 * - Credentials are stored separately in credentials.enc (encrypted)
 */

import { randomUUID } from 'crypto'
import { loadStoredConfig, saveConfig } from './storage'

// ============================================
// Types
// ============================================

/**
 * IM channel type
 */
export type ImChannelType = 'feishu' | 'discord'

/**
 * IM channel configuration
 * Stored in config.json (non-sensitive data only)
 */
export interface ImChannelConfig {
  /** Channel type: feishu, discord */
  type: ImChannelType

  /** Unique channel ID (e.g., 'feishu-main', 'discord-dev') */
  id: string

  /** Display name */
  name: string

  /** Whether the channel is enabled */
  enabled: boolean

  /** Channel-specific configuration */
  config: ImChannelTypeConfig

  /** Default workspace ID for this channel */
  defaultWorkspaceId: string

  /** Default permission mode */
  defaultPermissionMode: 'safe' | 'ask' | 'allow-all'

  /** Creation timestamp */
  createdAt: number

  /** Last update timestamp */
  updatedAt: number
}

/**
 * Channel-specific configuration (non-sensitive)
 */
export type ImChannelTypeConfig =
  | FeishuChannelConfig
  | DiscordChannelConfig

/**
 * Feishu/Lark channel configuration
 */
export interface FeishuChannelConfig {
  /** Domain: feishu (China) or lark (International) */
  domain: 'feishu' | 'lark'

  /** Render mode: text or interactive cards */
  renderMode: 'text' | 'card'
}

/**
 * Discord channel configuration
 */
export interface DiscordChannelConfig {
  // Discord doesn't need extra non-sensitive config
  // Bot token is stored in credentials
}

/**
 * Feishu credentials (stored encrypted)
 */
export interface FeishuCredentials {
  /** App ID */
  appId: string

  /** App Secret */
  appSecret: string

  /** Encrypt Key (optional, for event verification) */
  encryptKey?: string

  /** Verification Token (optional) */
  verificationToken?: string
}

/**
 * Discord credentials (stored encrypted)
 */
export interface DiscordCredentials {
  /** Bot Token */
  botToken: string
}

// ============================================
// CRUD Operations
// ============================================

/**
 * Get all IM channel configurations
 */
export function getImChannels(): ImChannelConfig[] {
  const config = loadStoredConfig()
  return config?.imChannels || []
}

/**
 * Get a specific IM channel by ID
 */
export function getImChannel(id: string): ImChannelConfig | null {
  const channels = getImChannels()
  return channels.find(c => c.id === id) || null
}

/**
 * Generate a unique channel ID
 */
export function generateImChannelId(type: ImChannelType): string {
  return `${type}-${randomUUID().slice(0, 8)}`
}

/**
 * Create a new IM channel configuration
 */
export function addImChannel(channel: Omit<ImChannelConfig, 'createdAt' | 'updatedAt'>): ImChannelConfig {
  const config = loadStoredConfig()
  if (!config) {
    throw new Error('Config not initialized')
  }

  // Initialize imChannels if not exists
  if (!config.imChannels) {
    config.imChannels = []
  }

  // Check for duplicate ID
  if (config.imChannels.some(c => c.id === channel.id)) {
    throw new Error(`Channel with ID "${channel.id}" already exists`)
  }

  const now = Date.now()
  const newChannel: ImChannelConfig = {
    ...channel,
    createdAt: now,
    updatedAt: now,
  }

  config.imChannels.push(newChannel)
  saveConfig(config)

  return newChannel
}

/**
 * Update an existing IM channel configuration
 */
export function updateImChannel(
  id: string,
  updates: Partial<Omit<ImChannelConfig, 'id' | 'createdAt'>>
): ImChannelConfig | null {
  const config = loadStoredConfig()
  if (!config || !config.imChannels) {
    return null
  }

  const index = config.imChannels.findIndex(c => c.id === id)
  if (index === -1) {
    return null
  }

  const existing = config.imChannels[index]!
  const updated: ImChannelConfig = {
    ...existing,
    ...updates,
    id: existing.id, // Prevent ID changes
    createdAt: existing.createdAt, // Prevent createdAt changes
    updatedAt: Date.now(),
  }

  config.imChannels[index] = updated
  saveConfig(config)

  return updated
}

/**
 * Delete an IM channel configuration
 */
export function deleteImChannel(id: string): boolean {
  const config = loadStoredConfig()
  if (!config || !config.imChannels) {
    return false
  }

  const index = config.imChannels.findIndex(c => c.id === id)
  if (index === -1) {
    return false
  }

  config.imChannels.splice(index, 1)
  saveConfig(config)

  return true
}

/**
 * Enable/disable an IM channel
 */
export function setImChannelEnabled(id: string, enabled: boolean): boolean {
  return updateImChannel(id, { enabled }) !== null
}

/**
 * Get enabled IM channels
 */
export function getEnabledImChannels(): ImChannelConfig[] {
  return getImChannels().filter(c => c.enabled)
}

// ============================================
// Defaults
// ============================================

/**
 * Get default configuration for a channel type
 */
export function getDefaultImChannelConfig(
  type: ImChannelType,
  defaultWorkspaceId: string
): Omit<ImChannelConfig, 'id' | 'createdAt' | 'updatedAt'> {
  const base = {
    type,
    name: type === 'feishu' ? 'Feishu/Lark' : 'Discord',
    enabled: false,
    defaultWorkspaceId,
    defaultPermissionMode: 'ask' as const,
  }

  switch (type) {
    case 'feishu':
      return {
        ...base,
        config: {
          domain: 'feishu',
          renderMode: 'text',
        } satisfies FeishuChannelConfig,
      }
    case 'discord':
      return {
        ...base,
        config: {} satisfies DiscordChannelConfig,
      }
  }
}
