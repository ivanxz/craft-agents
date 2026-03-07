/**
 * Discord Channel Server
 *
 * 独立运行 Discord 适配器的入口点
 *
 * 使用方法:
 * 1. 复制 .env.example 为 .env
 * 2. 填写配置
 * 3. 运行: bun run src/main.ts
 */

import 'dotenv/config';
import { DiscordAdapter, type DiscordAdapterConfig } from './index';
import type { ChannelSessionConfig } from '@craft-agent/channel-adapter';

// 验证必需配置
function validateConfig(): {
  sessionConfig: ChannelSessionConfig;
  discordConfig: Omit<DiscordAdapterConfig, 'sessionConfig'>;
} {
  const requiredEnvVars = [
    'CRAFT_SERVER_URL',
    'CRAFT_SERVER_TOKEN',
    'DEFAULT_WORKSPACE_ID',
    'DISCORD_BOT_TOKEN',
  ];

  const missing = requiredEnvVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const sessionConfig: ChannelSessionConfig = {
    serverUrl: process.env.CRAFT_SERVER_URL!,
    serverToken: process.env.CRAFT_SERVER_TOKEN!,
    defaultWorkspaceId: process.env.DEFAULT_WORKSPACE_ID!,
    defaultPermissionMode: (process.env.DEFAULT_PERMISSION_MODE || 'ask') as 'safe' | 'ask' | 'allow-all',
    idleCleanupTime: process.env.IDLE_CLEANUP_TIME
      ? parseInt(process.env.IDLE_CLEANUP_TIME, 10)
      : 30 * 60 * 1000, // 30 分钟
  };

  const discordConfig: Omit<DiscordAdapterConfig, 'sessionConfig'> = {
    botToken: process.env.DISCORD_BOT_TOKEN!,
    allowedChannelIds: process.env.DISCORD_CHANNEL_IDS?.split(',').filter(Boolean),
    allowedUserIds: process.env.DISCORD_USER_IDS?.split(',').filter(Boolean),
    allowedGuildIds: process.env.DISCORD_GUILD_IDS?.split(',').filter(Boolean),
  };

  return { sessionConfig, discordConfig };
}

async function main(): Promise<void> {
  console.log('[DiscordServer] Starting...');

  const { sessionConfig, discordConfig } = validateConfig();

  // 创建适配器
  const adapter = new DiscordAdapter({
    ...discordConfig,
    sessionConfig,
  });

  // 设置错误处理
  adapter.onError = (error) => {
    console.error('[DiscordServer] Adapter error:', error);
  };

  // 优雅关闭
  const shutdown = async (signal: string) => {
    console.log(`[DiscordServer] Received ${signal}, shutting down...`);
    try {
      await adapter.stop();
      console.log('[DiscordServer] Stopped');
    } catch (error) {
      console.error('[DiscordServer] Error during shutdown:', error);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // 启动适配器
  try {
    await adapter.start();
    console.log('[DiscordServer] Discord adapter started successfully');
  } catch (error) {
    console.error('[DiscordServer] Failed to start adapter:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[DiscordServer] Fatal error:', error);
  process.exit(1);
});
