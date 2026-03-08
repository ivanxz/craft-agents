/**
 * IM Channels Settings Page
 *
 * Configure Feishu, Discord, and other IM bot integrations
 */

import { useState, useEffect } from 'react'
import { PanelHeader } from '@/components/app-shell/PanelHeader'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Button } from '@/components/ui/button'
import { HeaderMenu } from '@/components/ui/HeaderMenu'
import { routes } from '@/lib/navigate'
import {
  Plus,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  MessageSquare,
} from 'lucide-react'
import type { DetailsPageMeta } from '@/lib/navigation-registry'
import {
  SettingsSection,
  SettingsCard,
  SettingsToggle,
  SettingsInput,
  SettingsSecretInput,
  SettingsMenuSelectRow,
} from '@/components/settings'
import { cn } from '@/lib/utils'
import type {
  ImChannelConfig,
  ImChannelType,
  FeishuCredentials,
  DiscordCredentials,
} from '../../../shared/types'

export const meta: DetailsPageMeta = {
  navigator: 'settings',
  slug: 'im-channels',
}

// ============================================
// Types
// ============================================

type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

interface ChannelWithStatus extends ImChannelConfig {
  connectionStatus: ConnectionStatus
  error?: string
}

// ============================================
// Platform Icons
// ============================================

function FeishuIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z" />
    </svg>
  )
}

function DiscordIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor">
      <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z" />
    </svg>
  )
}

// ============================================
// Status Badge Component
// ============================================

function StatusBadge({ status, error }: { status: ConnectionStatus; error?: string }) {
  const config = {
    disconnected: { icon: XCircle, color: 'text-muted-foreground', label: 'Disconnected' },
    connecting: { icon: RefreshCw, color: 'text-amber-500 animate-spin', label: 'Connecting...' },
    connected: { icon: CheckCircle2, color: 'text-green-500', label: 'Connected' },
    error: { icon: AlertTriangle, color: 'text-red-500', label: error || 'Error' },
  }[status]

  const Icon = config.icon

  return (
    <div className={cn('flex items-center gap-1.5 text-xs', config.color)}>
      <Icon className="h-3.5 w-3.5" />
      <span>{config.label}</span>
    </div>
  )
}

// ============================================
// Channel Form Component
// ============================================

interface ChannelFormProps {
  channel: ChannelWithStatus | null
  onSave: (config: Partial<ImChannelConfig>, credentials: FeishuCredentials | DiscordCredentials) => Promise<void>
  onTest: () => Promise<void>
  onDelete: () => void
  isNew?: boolean
}

function ChannelForm({ channel, onSave, onTest, onDelete, isNew }: ChannelFormProps) {
  const [name, setName] = useState(channel?.name || '')
  const [enabled, setEnabled] = useState(channel?.enabled ?? false)
  const [domain, setDomain] = useState<'feishu' | 'lark'>(
    (channel?.config as any)?.domain || 'feishu'
  )
  const [renderMode, setRenderMode] = useState<'text' | 'card'>(
    (channel?.config as any)?.renderMode || 'text'
  )
  const [credentials, setCredentials] = useState<FeishuCredentials | DiscordCredentials>(
    {} as any
  )
  const [isSaving, setIsSaving] = useState(false)
  const [isTesting, setIsTesting] = useState(false)

  useEffect(() => {
    if (channel) {
      setName(channel.name)
      setEnabled(channel.enabled)
      if (channel.type === 'feishu') {
        setDomain((channel.config as any).domain || 'feishu')
        setRenderMode((channel.config as any).renderMode || 'text')
      }
      // Load credentials
      window.electronAPI?.getImChannelCredentials(channel.id).then((result: any) => {
        if (result.success && result.credentials) {
          setCredentials(result.credentials)
        }
      })
    }
  }, [channel])

  const handleSave = async () => {
    setIsSaving(true)
    try {
      const config = channel?.type === 'feishu'
        ? { domain, renderMode }
        : {}

      await onSave(
        { name, enabled, config: config as any },
        credentials
      )
    } finally {
      setIsSaving(false)
    }
  }

  const handleTest = async () => {
    setIsTesting(true)
    try {
      await onTest()
    } finally {
      setIsTesting(false)
    }
  }

  if (!channel) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted-foreground py-20">
        <MessageSquare className="h-12 w-12 mb-4 opacity-50" />
        <p className="text-sm">Select a channel to configure</p>
        <p className="text-xs mt-1">or add a new one</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      {/* Connection Status */}
      <SettingsSection
        title="Connection"
        description="Test the connection to verify credentials are correct."
        action={
          !isNew && (
            <Button
              variant="outline"
              size="sm"
              onClick={onDelete}
              className="text-red-500 hover:text-red-600"
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              Delete
            </Button>
          )
        }
      >
        <SettingsCard divided>
          <div className="flex items-center justify-between px-4 py-3">
            <div className="flex items-center gap-3">
              <StatusBadge status={channel.connectionStatus} error={channel.error} />
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={isTesting || !enabled}
            >
              {isTesting ? (
                <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              )}
              Test Connection
            </Button>
          </div>
        </SettingsCard>
      </SettingsSection>

      {/* Basic Settings */}
      <SettingsSection
        title="Basic Settings"
        description="Configure the channel name and enable/disable."
      >
        <SettingsCard divided>
          <SettingsInput
            label="Name"
            description="Display name for this channel."
            value={name}
            onChange={setName}
            placeholder="My Feishu Bot"
            inCard
          />
          <SettingsToggle
            label="Enabled"
            description="Enable or disable this channel."
            checked={enabled}
            onCheckedChange={setEnabled}
            inCard
          />
        </SettingsCard>
      </SettingsSection>

      {/* Credentials */}
      <SettingsSection
        title="Credentials"
        description="API credentials for authenticating with the platform."
      >
        <SettingsCard divided>
          {channel.type === 'feishu' ? (
            <>
              <SettingsInput
                label="App ID"
                description="Feishu application ID (App ID)."
                value={(credentials as FeishuCredentials).appId || ''}
                onChange={(v) => setCredentials({ ...credentials, appId: v })}
                placeholder="cli_a92ad9b76af8dccb"
                inCard
              />
              <SettingsSecretInput
                label="App Secret"
                description="Feishu application secret (App Secret)."
                value={(credentials as FeishuCredentials).appSecret || ''}
                onChange={(v) => setCredentials({ ...credentials, appSecret: v })}
                placeholder="••••••••••••••••"
                inCard
              />
              <SettingsSecretInput
                label="Encrypt Key"
                description="Optional, for event encryption verification."
                value={(credentials as FeishuCredentials).encryptKey || ''}
                onChange={(v) => setCredentials({ ...credentials, encryptKey: v || undefined })}
                placeholder="Optional"
                inCard
              />
            </>
          ) : (
            <SettingsSecretInput
              label="Bot Token"
              description="Discord bot token from the Developer Portal."
              value={(credentials as DiscordCredentials).botToken || ''}
              onChange={(v) => setCredentials({ ...credentials, botToken: v })}
              placeholder="••••••••••••••••"
              inCard
            />
          )}
        </SettingsCard>
      </SettingsSection>

      {/* Platform-specific Settings */}
      {channel.type === 'feishu' && (
        <SettingsSection
          title="Feishu Settings"
          description="Configure Feishu-specific options."
        >
          <SettingsCard divided>
            <SettingsMenuSelectRow
              label="Domain"
              description="Feishu (China) or Lark (International)."
              value={domain}
              onValueChange={(v) => setDomain(v as 'feishu' | 'lark')}
              options={[
                { value: 'feishu', label: 'Feishu (飞书)', description: 'For users in China' },
                { value: 'lark', label: 'Lark', description: 'For international users' },
              ]}
              inCard
            />
            <SettingsMenuSelectRow
              label="Render Mode"
              description="Response formatting style."
              value={renderMode}
              onValueChange={(v) => setRenderMode(v as 'text' | 'card')}
              options={[
                { value: 'text', label: 'Plain Text', description: 'Simple text responses' },
                { value: 'card', label: 'Interactive Cards', description: 'Rich formatting with cards' },
              ]}
              inCard
            />
          </SettingsCard>
        </SettingsSection>
      )}

      {/* Save Button */}
      <div className="flex justify-end pt-2">
        <Button onClick={handleSave} disabled={isSaving}>
          {isSaving ? (
            <RefreshCw className="h-3.5 w-3.5 animate-spin mr-1.5" />
          ) : null}
          {isNew ? 'Create Channel' : 'Save Changes'}
        </Button>
      </div>
    </div>
  )
}

// ============================================
// Main Component
// ============================================

export default function ImChannelsSettingsPage() {
  const [channels, setChannels] = useState<ChannelWithStatus[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [isAdding, setIsAdding] = useState(false)
  const [newChannelType, setNewChannelType] = useState<ImChannelType>('feishu')

  const selectedChannel = channels.find((c) => c.id === selectedId)

  // Load channels on mount
  useEffect(() => {
    loadChannels()

    // Subscribe to changes
    const unsubscribe = window.electronAPI?.onImChannelsChanged?.(() => {
      loadChannels()
    })

    return () => {
      unsubscribe?.()
    }
  }, [])

  const loadChannels = async () => {
    const result = await window.electronAPI?.listImChannels()
    if (result?.channels) {
      setChannels(
        result.channels.map((c: ImChannelConfig) => ({
          ...c,
          connectionStatus: 'disconnected' as ConnectionStatus,
        }))
      )
    }
  }

  const handleAddChannel = (type: ImChannelType) => {
    setNewChannelType(type)
    setIsAdding(true)
    setSelectedId(null)
  }

  const handleCreateChannel = async (
    config: Partial<ImChannelConfig>,
    credentials: FeishuCredentials | DiscordCredentials
  ) => {
    const result = await window.electronAPI?.createImChannel(
      newChannelType,
      config.name || (newChannelType === 'feishu' ? 'Feishu Bot' : 'Discord Bot'),
      '' // TODO: Get default workspace ID
    )

    if (result?.success && result.channel) {
      // Save credentials
      await window.electronAPI?.saveImChannelCredentials(result.channel.id, credentials)

      // Update config
      await window.electronAPI?.updateImChannel(result.channel.id, {
        enabled: config.enabled,
        config: config.config,
      })

      setIsAdding(false)
      loadChannels()
    }
  }

  const handleSaveChannel = async (
    id: string,
    config: Partial<ImChannelConfig>,
    credentials: FeishuCredentials | DiscordCredentials
  ) => {
    await window.electronAPI?.updateImChannel(id, config)
    await window.electronAPI?.saveImChannelCredentials(id, credentials)
    loadChannels()
  }

  const handleTestChannel = async (id: string) => {
    setChannels((prev) =>
      prev.map((c) => (c.id === id ? { ...c, connectionStatus: 'connecting' as const } : c))
    )

    const result = await window.electronAPI?.testImChannel(id)

    setChannels((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              connectionStatus: result?.success ? 'connected' : 'error',
              error: result?.error,
            }
          : c
      )
    )
  }

  const handleDeleteChannel = async (id: string) => {
    await window.electronAPI?.deleteImChannel(id)
    setSelectedId(null)
    loadChannels()
  }

  return (
    <div className="h-full flex">
      {/* Left Panel - Channel List */}
      <div className="w-64 border-r border-border flex flex-col">
        <div className="p-4 border-b border-border">
          <h3 className="font-medium text-sm">Channels</h3>
        </div>

        <ScrollArea className="flex-1">
          <div className="p-2 space-y-1">
            {channels.map((channel) => (
              <button
                key={channel.id}
                onClick={() => {
                  setSelectedId(channel.id)
                  setIsAdding(false)
                }}
                className={cn(
                  'w-full flex items-center gap-3 px-3 py-2 rounded-md text-left transition-colors',
                  selectedId === channel.id
                    ? 'bg-accent text-accent-foreground'
                    : 'hover:bg-accent/50'
                )}
              >
                {channel.type === 'feishu' ? (
                  <FeishuIcon className="h-4 w-4 flex-shrink-0" />
                ) : (
                  <DiscordIcon className="h-4 w-4 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{channel.name}</div>
                  <div className="text-xs text-muted-foreground capitalize">{channel.type}</div>
                </div>
                <div className="flex-shrink-0">
                  <StatusBadge status={channel.connectionStatus} />
                </div>
              </button>
            ))}

            {channels.length === 0 && !isAdding && (
              <div className="text-center py-8 text-muted-foreground text-sm">
                No channels configured
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Add Channel Buttons */}
        <div className="p-2 border-t border-border space-y-1">
          <button
            onClick={() => handleAddChannel('feishu')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-accent/50 transition-colors"
          >
            <FeishuIcon className="h-4 w-4" />
            <span>Add Feishu</span>
            <Plus className="h-3.5 w-3.5 ml-auto" />
          </button>
          <button
            onClick={() => handleAddChannel('discord')}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm hover:bg-accent/50 transition-colors"
          >
            <DiscordIcon className="h-4 w-4" />
            <span>Add Discord</span>
            <Plus className="h-3.5 w-3.5 ml-auto" />
          </button>
        </div>
      </div>

      {/* Right Panel - Channel Configuration */}
      <div className="flex-1 flex flex-col min-w-0">
        <PanelHeader
          title="IM Bot Configuration"
          actions={<HeaderMenu route={routes.view.settings('im-channels')} />}
        />

        <div className="flex-1 min-h-0 mask-fade-y">
          <ScrollArea className="h-full">
            <div className="px-5 py-7 max-w-3xl mx-auto">
              {isAdding ? (
                <ChannelForm
                  channel={{
                    id: 'new',
                    type: newChannelType,
                    name: newChannelType === 'feishu' ? 'New Feishu Bot' : 'New Discord Bot',
                    enabled: false,
                    config: newChannelType === 'feishu' ? { domain: 'feishu', renderMode: 'text' } : {},
                    defaultWorkspaceId: '',
                    defaultPermissionMode: 'ask',
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                    connectionStatus: 'disconnected',
                  }}
                  onSave={handleCreateChannel}
                  onTest={async () => {}}
                  onDelete={() => setIsAdding(false)}
                  isNew
                />
              ) : (
                <ChannelForm
                  channel={selectedChannel || null}
                  onSave={async (config, credentials) => {
                    if (selectedId) {
                      await handleSaveChannel(selectedId, config, credentials)
                    }
                  }}
                  onTest={() => handleTestChannel(selectedId!)}
                  onDelete={() => handleDeleteChannel(selectedId!)}
                />
              )}
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  )
}
