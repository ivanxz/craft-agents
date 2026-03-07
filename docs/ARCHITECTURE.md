# Craft Agents OSS 架构文档

> 版本: 0.7.1 | 最后更新: 2025-03-07

本文档详细介绍 Craft Agents OSS 项目的整体架构、模块设计和代码组织。

---

## 目录

1. [项目概述](#1-项目概述)
2. [整体架构](#2-整体架构)
3. [包结构详解](#3-包结构详解)
4. [应用结构详解](#4-应用结构详解)
5. [核心模块分析](#5-核心模块分析)
6. [通信协议](#6-通信协议)
7. [数据流](#7-数据流)
8. [关键设计决策](#8-关键设计决策)

---

## 1. 项目概述

**Craft Agents** 是一个类 Claude Code 的 AI 代理工具，专为 Craft 文档和通用编程任务设计。

### 技术栈

| 类别 | 技术 |
|------|------|
| **运行时** | Bun, Node.js |
| **框架** | Electron, React 18 |
| **语言** | TypeScript 5 |
| **构建** | Vite, esbuild |
| **包管理** | Bun Workspaces |
| **AI SDK** | Claude Agent SDK, Pi SDK, GitHub Copilot SDK |
| **UI** | Radix UI, Tailwind CSS 4, Lucide Icons |
| **状态管理** | Jotai |
| **MCP** | @modelcontextprotocol/sdk |

### 核心功能

1. **多会话收件箱** - 桌面应用会话管理
2. **Claude Code 体验** - 流式响应、工具可视化
3. **多 LLM 连接** - 支持多个 AI 提供商
4. **Craft MCP 集成** - 32+ Craft 文档工具
5. **Sources 系统** - 连接 MCP 服务器、REST API、本地文件
6. **权限模式** - 三级系统 (safe/ask/allow-all)
7. **后台任务** - 长时间运行操作
8. **技能系统** - 专业化代理指令

---

## 2. 整体架构

### 架构图

```
┌─────────────────────────────────────────────────────────────────────────┐
│                              用户界面层                                   │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐      │
│  │  Electron App    │  │    CLI Client    │  │   Web Viewer     │      │
│  │  (apps/electron) │  │   (apps/cli)     │  │  (apps/viewer)   │      │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘      │
└───────────┼─────────────────────┼─────────────────────┼─────────────────┘
            │                     │                     │
            │  WebSocket RPC      │  WebSocket RPC      │  静态文件
            ▼                     ▼                     ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            服务器层                                      │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                    @craft-agent/server-core                       │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │  │
│  │  │  Transport  │  │   Runtime   │  │     RPC Handlers        │  │  │
│  │  │  (WebSocket)│  │ (Bootstrap) │  │ (sessions, sources...)  │  │  │
│  │  └─────────────┘  └─────────────┘  └─────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                            业务逻辑层                                    │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                     @craft-agent/shared                           │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │  │
│  │  │    Agent    │  │     MCP     │  │   Sources   │              │  │
│  │  │ (Claude/Pi) │  │   (Client)  │  │  (MCP/API)  │              │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘              │  │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │  │
│  │  │   Config    │  │Credentials  │  │   Skills    │              │  │
│  │  │  (Storage)  │  │ (AES-256)   │  │  (Custom)   │              │  │
│  │  └─────────────┘  └─────────────┘  └─────────────┘              │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                             类型层                                       │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                      @craft-agent/core                            │  │
│  │           (Workspace, Session, Message, AgentEvent)              │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                           外部服务层                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐   │
│  │  Anthropic  │  │   OpenAI    │  │   Google    │  │    MCP      │   │
│  │   (Claude)  │  │  (Codex)    │  │  (Gemini)   │  │  (Sources)  │   │
│  └─────────────┘  └─────────────┘  └─────────────┘  └─────────────┘   │
└─────────────────────────────────────────────────────────────────────────┘
```

### 包依赖关系

```
@craft-agent/electron
    ├── @craft-agent/core
    ├── @craft-agent/shared
    ├── @craft-agent/server-core
    └── @craft-agent/ui

@craft-agent/server
    ├── @craft-agent/core
    ├── @craft-agent/server-core
    └── @craft-agent/shared

@craft-agent/cli
    ├── @craft-agent/shared
    └── @craft-agent/server-core

@craft-agent/session-mcp-server
    ├── @craft-agent/session-tools-core
    └── @craft-agent/shared

@craft-agent/shared
    ├── @craft-agent/core
    └── @craft-agent/session-tools-core

@craft-agent/ui
    └── @craft-agent/core

@craft-agent/viewer
    ├── @craft-agent/core
    └── @craft-agent/ui
```

---

## 3. 包结构详解

### 3.1 @craft-agent/core

**路径:** `packages/core`

**职责:** 核心类型定义和基础工具

```
packages/core/
├── src/
│   ├── index.ts           # 主入口
│   ├── types/
│   │   ├── index.ts       # 类型重导出
│   │   ├── workspace.ts   # Workspace, Auth, Config 类型
│   │   ├── session.ts     # Session, Metadata 类型
│   │   └── message.ts     # Message, Token, Event 类型
│   └── utils/
│       ├── index.ts       # 工具重导出
│       └── debug.ts       # 调试日志
├── package.json
└── tsconfig.json
```

**核心类型:**

| 类型 | 文件 | 描述 |
|------|------|------|
| `Workspace` | workspace.ts | 工作区配置，包含 MCP URL 和认证信息 |
| `Session` | session.ts | 会话作用域，绑定 SDK 会话 |
| `Message` | message.ts | 运行时消息，包含所有字段 |
| `AgentEvent` | message.ts | CraftAgent 事件流 |
| `TokenUsage` | message.ts | Token 使用统计 |
| `McpAuthType` | workspace.ts | MCP 认证方式 |

**设计原则:**
- 仅包含类型和纯工具函数
- 无运行时依赖
- 作为整个 monorepo 的类型基础

---

### 3.2 @craft-agent/shared

**路径:** `packages/shared`

**职责:** 共享业务逻辑，是核心业务实现层

```
packages/shared/
├── src/
│   ├── index.ts           # 主入口 (仅导出 branding)
│   ├── agent/             # Agent 实现
│   │   ├── base-agent.ts  # 抽象基类
│   │   ├── claude-agent.ts# Claude SDK 封装
│   │   ├── pi-agent.ts    # Pi SDK 封装
│   │   ├── backend/       # 后端类型定义
│   │   ├── core/          # 核心模块
│   │   │   ├── permission-manager.ts
│   │   │   ├── source-manager.ts
│   │   │   ├── prompt-builder.ts
│   │   │   └── ...
│   │   ├── mode-manager.ts     # 权限模式管理
│   │   ├── permissions-config.ts
│   │   └── session-scoped-tools.ts
│   ├── auth/              # OAuth, 令牌管理
│   ├── automations/       # 自动化系统
│   ├── config/            # 存储配置, 主题, 模型
│   │   ├── storage.ts     # 配置持久化
│   │   └── theme.ts       # 主题系统
│   ├── credentials/       # AES-256-GCM 加密凭证
│   ├── mcp/               # MCP 客户端, 连接池
│   │   ├── mcp-pool.ts    # 集中式 MCP 连接池
│   │   └── ...
│   ├── protocol/          # RPC 协议定义
│   │   ├── channels.ts    # 通道名常量
│   │   ├── types.ts       # 消息类型
│   │   └── events.ts      # 事件定义
│   ├── sessions/          # 会话持久化
│   ├── skills/            # 技能系统
│   ├── sources/           # 外部数据源
│   ├── prompts/           # 系统提示词
│   ├── utils/             # 工具函数
│   └── ...                # 其他模块
├── tests/                 # 测试文件
├── CLAUDE.md              # 开发指南
└── package.json
```

**子路径导出:**

```typescript
import { CraftAgent } from '@craft-agent/shared/agent'
import { loadStoredConfig } from '@craft-agent/shared/config'
import { getCredentialManager } from '@craft-agent/shared/credentials'
import { CraftMcpClient } from '@craft-agent/shared/mcp'
import { loadSource, createSource } from '@craft-agent/shared/sources'
import { createWorkspace, loadWorkspace } from '@craft-agent/shared/workspaces'
```

**关键模块:**

#### Agent 模块 (`src/agent/`)

```
┌─────────────────────────────────────────────────────────────────┐
│                         BaseAgent                                │
│  (抽象基类 - 共享模型/权限/源管理)                                 │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │PermissionManager│  │  SourceManager  │  │  PromptBuilder  │ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐ │
│  │  UsageTracker   │  │ PrerequisiteMgr │  │ ConfigWatcherMgr│ │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘ │
├─────────────────────────────────────────────────────────────────┤
│         △                △                △                     │
│         │                │                │                     │
│  ┌──────┴──────┐  ┌──────┴──────┐  ┌──────┴──────┐            │
│  │ ClaudeAgent │  │  PiAgent    │  │ CodexAgent  │            │
│  │ (Claude SDK)│  │ (Pi SDK)    │  │ (Codex SDK) │            │
│  └─────────────┘  └─────────────┘  └─────────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

**BaseAgent 核心职责:**
- 模型/思考配置管理
- 权限模式管理 (通过 PermissionManager)
- 源管理 (通过 SourceManager)
- 规划启发式 (通过 PlanningAdvisor)
- 配置监听 (通过 ConfigWatcherManager)
- 使用量追踪 (通过 UsageTracker)

#### 权限模式系统

| 模式 | 显示名 | 行为 |
|------|--------|------|
| `safe` | Explore | 只读，阻止所有写操作 |
| `ask` | Ask to Edit | 请求批准 (默认) |
| `allow-all` | Auto | 自动批准所有命令 |

#### MCP 连接池 (`src/mcp/mcp-pool.ts`)

```
┌─────────────────────────────────────────────────────────────────┐
│                       McpClientPool                              │
│                    (主进程中的集中式连接池)                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  MCP Sources: pool.sync(mcpServers)                         ││
│  │  - 连接新源，断开已移除的源                                    ││
│  └─────────────────────────────────────────────────────────────┘│
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  API Sources: pool.syncApiServers(apiServers)               ││
│  │  - 连接进程内 ApiSourcePoolClient 实例                       ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

#### 凭证存储 (`src/credentials/`)

- 存储位置: `~/.craft-agent/credentials.enc`
- 加密方式: AES-256-GCM
- 内容: API 密钥、OAuth 令牌等敏感信息

---

### 3.3 @craft-agent/server-core

**路径:** `packages/server-core`

**职责:** 可复用的无头服务器基础设施

```
packages/server-core/
├── src/
│   ├── index.ts
│   ├── bootstrap/         # 服务器启动逻辑
│   │   └── index.ts       # startHeadlessServer()
│   ├── domain/            # 领域逻辑
│   ├── handlers/          # RPC 处理器
│   │   ├── index.ts
│   │   ├── utils.ts
│   │   ├── session-manager-interface.ts
│   │   └── rpc/           # RPC 方法实现
│   │       ├── index.ts
│   │       ├── sessions.ts
│   │       ├── sources.ts
│   │       ├── skills.ts
│   │       ├── oauth.ts
│   │       ├── llm-connections.ts
│   │       └── ...
│   ├── model-fetchers/    # 模型列表获取
│   ├── runtime/           # 运行时平台抽象
│   ├── services/          # 服务层
│   ├── sessions/          # 会话管理器
│   │   └── index.ts       # SessionManager 类
│   └── transport/         # 传输层
│       ├── index.ts
│       ├── ws-server.ts   # WebSocket 服务器
│       └── serialization.ts
├── package.json
└── tsconfig.json
```

**核心组件:**

#### Bootstrap (`src/bootstrap/`)

```typescript
startHeadlessServer<SessionManager, HandlerDeps>({
  bundledAssetsRoot,
  applyPlatformToSubsystems,  // 配置平台适配
  initModelRefreshService,    // 初始化模型刷新
  createSessionManager,       // 创建会话管理器
  createHandlerDeps,          // 创建处理器依赖
  registerAllRpcHandlers,     // 注册 RPC 处理器
  setSessionEventSink,        // 设置事件接收器
  initializeSessionManager,   // 初始化会话管理器
  cleanupSessionManager,      // 清理会话管理器
  cleanupClientResources,     // 清理客户端资源
})
```

#### RPC 处理器 (`src/handlers/rpc/`)

| 文件 | 职责 |
|------|------|
| `sessions.ts` | 会话 CRUD、消息发送、取消 |
| `sources.ts` | 源管理、OAuth |
| `skills.ts` | 技能 CRUD |
| `oauth.ts` | OAuth 流程管理 |
| `llm-connections.ts` | LLM 连接管理 |
| `system.ts` | 系统信息、版本 |
| `workspace.ts` | 工作区管理 |
| `automations.ts` | 自动化系统 |
| `labels.ts` | 标签管理 |
| `statuses.ts` | 状态管理 |

#### SessionManager (`src/sessions/`)

```typescript
class SessionManager {
  // 会话生命周期
  async createSession(workspaceId, options): Promise<Session>
  async deleteSession(sessionId): Promise<void>
  async getSessions(workspaceId): Promise<Session[]>

  // 消息处理
  async sendMessage(sessionId, message, options): Promise<void>
  async cancel(sessionId): Promise<void>

  // 事件
  setEventSink(sink: SessionEventSink): void

  // 持久化
  async flushAllSessions(): Promise<void>
  initialize(): Promise<void>
  cleanup(): void
}
```

---

### 3.4 @craft-agent/ui

**路径:** `packages/ui`

**职责:** 共享 React UI 组件

```
packages/ui/
├── src/
│   ├── index.ts
│   ├── components/
│   │   ├── chat/           # SessionViewer, TurnCard
│   │   ├── code-viewer/    # 代码查看器
│   │   ├── icons/          # 图标组件
│   │   ├── markdown/       # Markdown 渲染
│   │   ├── overlay/        # 覆盖层组件
│   │   ├── terminal/       # 终端组件
│   │   └── ui/             # 基础 UI 组件
│   ├── context/            # React Context
│   ├── lib/                # 工具库
│   ├── pdfjs-worker.d.ts   # PDF.js 类型
│   └── styles/             # CSS 样式
├── package.json
└── tsconfig.json
```

**主要组件:**

| 组件 | 描述 |
|------|------|
| `SessionViewer` | 会话消息查看器 |
| `TurnCard` | 单轮对话卡片 |
| `CodeViewer` | 代码高亮显示 |
| `MarkdownRenderer` | Markdown 渲染 |
| `Terminal` | 终端输出显示 |

---

### 3.5 @craft-agent/server

**路径:** `packages/server`

**职责:** 独立无头服务器入口点

```
packages/server/
├── src/
│   └── index.ts           # 服务器入口
├── package.json
└── tsconfig.json
```

**用途:**
- 作为独立 npm 包发布
- 允许其他项目嵌入 Craft Agent 服务器

---

### 3.6 @craft-agent/session-mcp-server

**路径:** `packages/session-mcp-server`

**职责:** 会话范围工具的 MCP 服务器

```
packages/session-mcp-server/
├── src/
│   └── index.ts           # MCP 服务器实现
├── dist/                  # 编译输出
├── package.json
└── tsconfig.json
```

**提供的工具:**
- `SubmitPlan` - 提交计划
- `source_oauth_trigger` - 源 OAuth 触发
- `source_credential_prompt` - 凭证提示
- `config_validate` - 配置验证
- `transform_data` - 数据转换
- `script_sandbox` - 脚本沙箱

---

### 3.7 @craft-agent/session-tools-core

**路径:** `packages/session-tools-core`

**职责:** 会话范围工具的共享核心

```
packages/session-tools-core/
├── src/
│   ├── index.ts
│   ├── context.ts         # 上下文管理
│   ├── handlers/          # 工具处理器
│   ├── runtime/           # 运行时
│   ├── source-helpers.ts  # 源辅助
│   ├── templates/         # 模板
│   ├── tool-defs.ts       # 工具定义
│   ├── types.ts           # 类型定义
│   └── validation.ts      # 验证逻辑
├── package.json
└── tsconfig.json
```

---

### 3.8 @craft-agent/pi-agent-server

**路径:** `packages/pi-agent-server`

**职责:** 进程外 Pi 代理服务器

```
packages/pi-agent-server/
├── src/
│   └── index.ts           # 通过 stdio JSONL 通信
├── dist/
├── package.json
└── tsconfig.json
```

**通信方式:** stdio JSONL (JSON Lines)

---

## 4. 应用结构详解

### 4.1 @craft-agent/electron

**路径:** `apps/electron`

**职责:** Electron 桌面应用 (主应用)

```
apps/electron/
├── src/
│   ├── main/              # 主进程
│   │   ├── index.ts       # 主入口
│   │   ├── auto-update.ts # 自动更新
│   │   ├── browser-cdp.ts # Chrome DevTools Protocol
│   │   ├── browser-pane-manager.ts # 浏览器面板管理
│   │   ├── deep-link.ts   # 深度链接
│   │   ├── handlers/      # IPC 处理器
│   │   ├── lib/           # 工具库
│   │   ├── logger.ts      # 日志
│   │   ├── menu.ts        # 菜单
│   │   ├── notifications.ts
│   │   ├── onboarding.ts
│   │   ├── power-manager.ts
│   │   ├── shell-env.ts
│   │   ├── thumbnail-protocol.ts
│   │   └── window-manager.ts
│   ├── preload/           # 预加载脚本
│   │   ├── bootstrap.ts
│   │   └── browser-toolbar.ts
│   ├── renderer/          # 渲染进程 (React)
│   │   ├── index.html
│   │   ├── main.tsx
│   │   ├── App.tsx        # 主应用组件
│   │   ├── index.css      # 样式
│   │   ├── components/    # React 组件
│   │   ├── pages/         # 页面
│   │   ├── hooks/         # React Hooks
│   │   ├── atoms/         # Jotai atoms
│   │   ├── context/       # React Context
│   │   ├── event-processor/ # 事件处理
│   │   ├── lib/           # 工具库
│   │   └── utils/         # 工具函数
│   ├── server/            # 内嵌服务器
│   │   ├── index.ts       # 入口
│   │   └── start.ts       # 启动逻辑
│   ├── runtime/           # 运行时
│   ├── shared/            # 共享代码
│   └── transport/         # 传输层
├── resources/             # 应用资源
│   ├── bin/               # 二进制工具
│   ├── bridge-mcp-server/ # Bridge MCP 服务器
│   ├── scripts/           # Python 脚本
│   ├── themes/            # 主题文件
│   └── tool-icons/        # 工具图标
├── scripts/               # 构建脚本
├── electron-builder.yml   # 打包配置
├── vite.config.ts         # Vite 配置
└── package.json
```

**进程架构:**

```
┌─────────────────────────────────────────────────────────────────┐
│                        Electron 主进程                           │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  - 应用生命周期管理                                          ││
│  │  - 窗口管理 (WindowManager)                                 ││
│  │  - 浏览器面板管理 (BrowserPaneManager)                      ││
│  │  - 自动更新                                                 ││
│  │  - 菜单管理                                                 ││
│  │  - IPC 处理器                                               ││
│  │  - 内嵌 WebSocket 服务器                                    ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
            │
            │ IPC / WebSocket
            ▼
┌─────────────────────────────────────────────────────────────────┐
│                        渲染进程 (React)                          │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  - UI 渲染                                                  ││
│  │  - 状态管理 (Jotai)                                         ││
│  │  - RPC 客户端                                               ││
│  │  - 事件处理                                                 ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

### 4.2 @craft-agent/cli

**路径:** `apps/cli`

**职责:** 终端客户端

```
apps/cli/
├── src/
│   ├── index.ts           # CLI 入口 (1400+ 行)
│   ├── client.ts          # CliRpcClient
│   ├── server-spawner.ts  # 服务器启动器
│   ├── index.test.ts      # 测试
│   ├── client.test.ts
│   ├── commands.test.ts
│   ├── run.test.ts
│   └── validate.test.ts
├── package.json
└── tsconfig.json
```

**核心组件:**

#### CliRpcClient (`client.ts`)

精简版 WebSocket RPC 客户端:
- 无自动重连
- 无能力协商
- 连接、工作、退出

```typescript
class CliRpcClient {
  connect(): Promise<string>        // 连接并握手
  invoke(channel, ...args): Promise<unknown>  // RPC 调用
  on(channel, callback): () => void // 订阅事件
  destroy(): void                   // 销毁连接
}
```

#### ServerSpawner (`server-spawner.ts`)

自动启动 headless 服务器:
1. 生成令牌
2. 启动 `bun run <serverEntry>` 子进程
3. 监听 stdout 等待 `CRAFT_SERVER_URL=`
4. 返回服务器句柄

#### 命令处理器

| 命令 | 函数 | 描述 |
|------|------|------|
| `run` | `cmdRun()` | 自包含模式：启动服务器、发送消息、流式响应、退出 |
| `ping` | `cmdPing()` | 验证连接 |
| `send` | `cmdSend()` | 发送消息到会话 |
| `sessions` | `cmdSessions()` | 列出会话 |
| `--validate-server` | `cmdValidate()` | 21 步集成测试 |

---

### 4.3 @craft-agent/viewer

**路径:** `apps/viewer`

**职责:** Web 会话查看器

```
apps/viewer/
├── src/
│   ├── App.tsx            # 主应用
│   ├── main.tsx
│   ├── index.css
│   └── components/
├── public/
├── index.html
├── vite.config.ts
├── package.json
└── tsconfig.json
```

**用途:**
- 上传和分享会话记录
- 纯静态 Web 应用

---

## 5. 核心模块分析

### 5.1 Agent 系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                         AgentBackend                             │
│                          (接口定义)                               │
├─────────────────────────────────────────────────────────────────┤
│  chat(message, attachments, options): AsyncGenerator<AgentEvent>│
│  abort(reason?): Promise<void>                                  │
│  forceAbort(reason): void                                       │
│  isProcessing(): boolean                                        │
│  respondToPermission(requestId, allowed, alwaysAllow): void     │
│  runMiniCompletion(prompt): Promise<string | null>              │
│  queryLlm(request): Promise<LLMQueryResult>                     │
└─────────────────────────────────────────────────────────────────┘
                              △
                              │
┌─────────────────────────────────────────────────────────────────┐
│                         BaseAgent                                │
│                        (抽象基类)                                 │
├─────────────────────────────────────────────────────────────────┤
│  配置:                                                          │
│  - config: BackendConfig                                        │
│  - _model: string                                               │
│  - _thinkingLevel: ThinkingLevel                               │
│                                                                 │
│  核心模块:                                                       │
│  - permissionManager: PermissionManager                         │
│  - sourceManager: SourceManager                                 │
│  - promptBuilder: PromptBuilder                                 │
│  - pathProcessor: PathProcessor                                 │
│  - configWatcherManager: ConfigWatcherManager                   │
│  - usageTracker: UsageTracker                                   │
│  - prerequisiteManager: PrerequisiteManager                     │
│                                                                 │
│  回调:                                                          │
│  - onPermissionRequest                                          │
│  - onPlanSubmitted                                              │
│  - onAuthRequest                                                │
│  - onSourceChange                                               │
│  - onUsageUpdate                                                │
└─────────────────────────────────────────────────────────────────┘
         △                    △                    △
         │                    │                    │
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  ClaudeAgent    │  │    PiAgent      │  │   CodexAgent    │
│                 │  │                 │  │                 │
│ - Claude SDK    │  │ - Pi SDK        │  │ - Codex SDK     │
│ - OAuth 认证    │  │ - API Key       │  │ - OAuth 认证    │
│ - 原生技能工具  │  │ - 进程外服务器  │  │ - Bridge MCP    │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

### 5.2 源系统架构

```
┌─────────────────────────────────────────────────────────────────┐
│                       LoadedSource                               │
│                      (源配置接口)                                 │
├─────────────────────────────────────────────────────────────────┤
│  type: 'mcp' | 'api' | 'local'                                  │
│  config: SourceConfig                                            │
│  status: 'connected' | 'disconnected' | 'error'                 │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                        源类型                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  MCP 源:                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  - MCP 服务器连接                                        │   │
│  │  - 通过 McpClientPool 管理                               │   │
│  │  - 支持 OAuth、Bearer、无认证                            │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  API 源:                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  - REST API 连接                                         │   │
│  │  - 通过 ApiSourcePoolClient 管理                         │   │
│  │  - 支持 Bearer、Basic、API Key 认证                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  本地源:                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  - 本地文件/目录                                          │   │
│  │  - 无需认证                                              │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 5.3 技能系统

```
┌─────────────────────────────────────────────────────────────────┐
│                         技能结构                                 │
├─────────────────────────────────────────────────────────────────┤
│  ~/.craft-agent/workspaces/{id}/skills/{slug}/                  │
│  ├── SKILL.md              # 技能定义 (YAML frontmatter + 指令) │
│  ├── guide.md              # 可选指南                           │
│  └── ...                    # 其他资源                          │
└─────────────────────────────────────────────────────────────────┘

SKILL.md 格式:
---
name: "技能名称"
description: "技能描述"
requiredSources:
  - "source-slug-1"
  - "source-slug-2"
---

技能指令内容...
```

### 5.4 自动化系统

```
┌─────────────────────────────────────────────────────────────────┐
│                     automations.json                             │
│           ~/.craft-agent/workspaces/{id}/automations.json       │
├─────────────────────────────────────────────────────────────────┤
│  [                                                              │
│    {                                                            │
│      "trigger": { "type": "agent_event", "event": "complete" },│
│      "action": { "type": "bash", "command": "..." },           │
│      "enabled": true                                            │
│    }                                                            │
│  ]                                                              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 6. 通信协议

### 6.1 WebSocket RPC 协议

**消息信封格式:**

```typescript
interface MessageEnvelope {
  id: string                    // 消息 ID
  type: 'handshake' | 'handshake_ack' | 'request' | 'response' | 'event' | 'error'
  protocolVersion?: string      // 协议版本
  workspaceId?: string          // 工作区 ID
  token?: string                // 认证令牌
  clientId?: string             // 客户端 ID
  channel?: string              // RPC 通道
  args?: unknown[]              // 请求参数
  result?: unknown              // 响应结果
  error?: { code: string; message: string; data?: unknown }  // 错误
}
```

**连接流程:**

```
┌──────────────┐                           ┌──────────────┐
│   Client     │                           │   Server     │
└──────┬───────┘                           └──────┬───────┘
       │                                          │
       │  1. WebSocket Connect                    │
       │─────────────────────────────────────────>│
       │                                          │
       │  2. handshake { token, workspaceId }     │
       │─────────────────────────────────────────>│
       │                                          │
       │  3. handshake_ack { clientId }           │
       │<─────────────────────────────────────────│
       │                                          │
       │  4. request { channel, args }            │
       │─────────────────────────────────────────>│
       │                                          │
       │  5. response { result } 或 error         │
       │<─────────────────────────────────────────│
       │                                          │
       │  6. event { channel, args } (推送)       │
       │<─────────────────────────────────────────│
       │                                          │
```

### 6.2 RPC 通道

**会话管理:**

| 通道 | 描述 |
|------|------|
| `sessions:get` | 获取会话列表 |
| `sessions:create` | 创建会话 |
| `sessions:delete` | 删除会话 |
| `sessions:sendMessage` | 发送消息 |
| `sessions:cancel` | 取消处理 |
| `session:event` | 会话事件推送 |

**源管理:**

| 通道 | 描述 |
|------|------|
| `sources:get` | 获取源列表 |
| `sources:create` | 创建源 |
| `sources:delete` | 删除源 |
| `sources:startOAuth` | 启动 OAuth |

**LLM 连接:**

| 通道 | 描述 |
|------|------|
| `LLM_Connection:list` | 列出连接 |
| `LLM_Connection:save` | 保存连接 |
| `LLM_Connection:setDefault` | 设置默认 |

**系统:**

| 通道 | 描述 |
|------|------|
| `system:versions` | 获取版本 |
| `system:homeDir` | 获取主目录 |
| `credentials:healthCheck` | 凭证健康检查 |

---

## 7. 数据流

### 7.1 消息发送流程

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Renderer   │     │  RPC Server  │     │SessionManager│
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │ sendMessage(id,msg)│                    │
       │───────────────────>│                    │
       │                    │ invoke('sessions:sendMessage')
       │                    │───────────────────>│
       │                    │                    │
       │                    │                    │ getAgent(sessionId)
       │                    │                    │──────┐
       │                    │                    │      │
       │                    │                    │<─────┘
       │                    │                    │
       │                    │                    │ agent.chat(message)
       │                    │                    │──────┐
       │                    │                    │      │
       │                    │                    │<─────┘
       │                    │                    │
       │  session:event     │                    │
       │<───────────────────│<───────────────────│
       │  { type: 'text_delta', delta: '...' }  │
       │                    │                    │
       │  session:event     │                    │
       │<───────────────────│<───────────────────│
       │  { type: 'tool_start', toolName: 'Bash' }
       │                    │                    │
       │  session:event     │                    │
       │<───────────────────│<───────────────────│
       │  { type: 'complete' }                   │
       │                    │                    │
```

### 7.2 源激活流程

```
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│   Renderer   │     │  RPC Server  │     │  McpPool     │
└──────┬───────┘     └──────┬───────┘     └──────┬───────┘
       │                    │                    │
       │ enableSource(slug) │                    │
       │───────────────────>│                    │
       │                    │ setSourceServers() │
       │                    │───────────────────>│
       │                    │                    │
       │                    │                    │ sync(mcpServers)
       │                    │                    │──────┐
       │                    │                    │      │
       │                    │                    │<─────┘
       │                    │                    │
       │                    │                    │ connect(newSource)
       │                    │                    │──────┐
       │                    │                    │      │
       │                    │                    │<─────┘
       │                    │                    │
       │  sources:changed   │                    │
       │<───────────────────│<───────────────────│
       │                    │                    │
```

---

## 8. 关键设计决策

### 8.1 会话作为主要边界

**原则:** 会话是主要的隔离边界，而非工作区。

**理由:**
- 每个会话有独立的 ID (立即可知)
- 1:1 映射到 SDK 会话
- 属于单个工作区
- 可以归档和命名

### 8.2 MCP 认证分离

**原则:** Craft OAuth 仅用于 Craft API，MCP 服务器有自己的 OAuth。

**配置:**
- Craft API: `craft_oauth::global`
- MCP 服务器: `workspace_oauth::{workspaceId}`

### 8.3 集中式 MCP 连接池

**原则:** 所有源连接通过单一 `McpClientPool` 管理。

**优点:**
- 避免重复连接
- 统一生命周期管理
- 简化认证流程

### 8.4 Bridge MCP 服务器

**用途:** 为 Codex 和 Copilot 后端提供 API 源访问。

**凭证流:**
1. 主进程解密凭证
2. 写入 `.credential-cache.json` (权限 0600)
3. Bridge MCP 服务器读取缓存文件
4. 发起 API 请求

### 8.5 权限模式系统

**三级系统:**

| 模式 | 用途 |
|------|------|
| `safe` | 探索模式，只读 |
| `ask` | 默认模式，请求批准 |
| `allow-all` | 自动模式，自动批准 |

**配置层级 (合并):**
- 工作区: `permissions.json`
- 源: `sources/{slug}/permissions.json`

### 8.6 主题系统

**级联配置:** 应用 → 工作区 (后者优先)

**存储:**
- 应用: `~/.craft-agent/theme.json`
- 工作区: `~/.craft-agent/workspaces/{id}/theme.json`

### 8.7 凭证加密

**方式:** AES-256-GCM

**存储:** `~/.craft-agent/credentials.enc`

**内容:**
- API 密钥
- OAuth 令牌
- 其他敏感信息

---

## 附录

### A. 文件存储位置

```
~/.craft-agent/
├── config.json                 # 应用配置
├── theme.json                  # 应用主题
├── credentials.enc             # 加密凭证
├── llm-connections.json        # LLM 连接配置
├── preferences.json            # 用户偏好
└── workspaces/
    └── {workspace-id}/
        ├── workspace.json      # 工作区配置
        ├── sessions/
        │   └── {session-id}/
        │       ├── session.json
        │       └── messages.jsonl
        ├── sources/
        │   └── {source-slug}/
        │       └── source.json
        ├── skills/
        │   └── {skill-slug}/
        │       └── SKILL.md
        ├── automations.json    # 自动化配置
        ├── permissions.json    # 权限配置
        ├── statuses.json       # 状态配置
        └── theme.json          # 工作区主题
```

### B. 环境变量

| 变量 | 描述 |
|------|------|
| `CRAFT_SERVER_URL` | 服务器 URL |
| `CRAFT_SERVER_TOKEN` | 认证令牌 |
| `CRAFT_RPC_HOST` | 绑定地址 (默认: 127.0.0.1) |
| `CRAFT_RPC_PORT` | 绑定端口 (默认: 9100) |
| `CRAFT_DEBUG` | 调试模式 |
| `ANTHROPIC_API_KEY` | Anthropic API 密钥 |
| `OPENAI_API_KEY` | OpenAI API 密钥 |
| `GOOGLE_API_KEY` | Google API 密钥 |

### C. 相关文档

- [CLI 使用文档](./cli.md)
- [共享包开发指南](../packages/shared/CLAUDE.md)
- [核心包说明](../packages/core/CLAUDE.md)
