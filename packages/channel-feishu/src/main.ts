/**
 * Feishu Channel Server
 *
 * 独立运行飞书适配器的入口点
 *
 * 使用方法:
 * 1. 复制 .env.example 为 .env
 * 2. 填写配置
 * 3. 运行: bun run src/main.ts
 */

import 'dotenv/config';
import { FeishuAdapter, type FeishuAdapterConfig } from './index';
import type { ChannelSessionConfig } from '@craft-agent/channel-adapter';

// 验证必需配置
function validateConfig(): {
  sessionConfig: ChannelSessionConfig;
  feishuConfig: Omit<FeishuAdapterConfig, 'sessionConfig'>;
} {
  const requiredEnvVars = [
    'CRAFT_SERVER_URL',
    'CRAFT_SERVER_TOKEN',
    'DEFAULT_WORKSPACE_ID',
    'FEISHU_APP_ID',
    'FEISHU_APP_SECRET',
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

  const feishuConfig: Omit<FeishuAdapterConfig, 'sessionConfig'> = {
    appId: process.env.FEISHU_APP_ID!,
    appSecret: process.env.FEISHU_APP_SECRET!,
    domain: (process.env.FEISHU_DOMAIN || 'feishu') as 'feishu' | 'lark',
    encryptKey: process.env.FEISHU_ENCRYPT_KEY,
    verificationToken: process.env.FEISHU_VERIFICATION_TOKEN,
    renderMode: (process.env.FEISHU_RENDER_MODE || 'text') as 'text' | 'card',
    allowedChatIds: process.env.FEISHU_CHAT_IDS?.split(',').filter(Boolean),
    allowedUserIds: process.env.FEISHU_USER_IDS?.split(',').filter(Boolean),
    debug: process.env.DEBUG === 'true',
  };

  return { sessionConfig, feishuConfig };
}

async function main(): Promise<void> {
  console.log('[FeishuServer] Starting...');

  const { sessionConfig, feishuConfig } = validateConfig();

  // 创建适配器
  const adapter = new FeishuAdapter({
    ...feishuConfig,
    sessionConfig,
  });

  // 设置错误处理
  adapter.onError = (error) => {
    console.error('[FeishuServer] Adapter error:', error);
  };

  // 优雅关闭
  const shutdown = async (signal: string) => {
    console.log(`[FeishuServer] Received ${signal}, shutting down...`);
    try {
      await adapter.stop();
      console.log('[FeishuServer] Stopped');
    } catch (error) {
      console.error('[FeishuServer] Error during shutdown:', error);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  // 启动适配器
  try {
    await adapter.start();
    console.log('[FeishuServer] Feishu adapter started successfully');
  } catch (error) {
    console.error('[FeishuServer] Failed to start adapter:', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('[FeishuServer] Fatal error:', error);
  process.exit(1);
});
