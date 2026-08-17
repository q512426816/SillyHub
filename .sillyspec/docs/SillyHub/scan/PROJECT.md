---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 项目（Project）

## 项目简介

SillyHub（仓库 `multi-agent-platform`）是多智能体协作管理平台：把规范驱动开发方法论 [SillySpec](https://github.com/q512426816/sillyspec) 从单人命令行工具升级成团队级协作平台——管理工作空间（Git 仓库）、编排多个 AI Agent、跟踪结构化变更规格、协调多人协作与审批，「Agent 写的每一行代码都有规可循、有迹可查、有人把关」（根 `README.md`，2026-08 现版）。产品形态为 FastAPI 后端 + Next.js 前端 + 本地 Node daemon 的全栈 Web 应用；平台托管 SillySpec 文档驱动开发全流程（scan → brainstorm → plan → execute → verify → archive），变更状态机与阶段评审门禁在平台侧，执行侧由 daemon 驱动宿主 Agent（Claude Code / Codex 等）完成各阶段。

核心能力（`README.md`）：工作空间管理（注册 Git 仓库 + 扫描 `.sillyspec` 目录 + 组件拓扑）、变更全生命周期（brainstorm → plan → execute → verify → archive 五段）、AI Agent 编排（SSE 实时流式 + 中断恢复 + 上下文指纹 + 工具级 / 阶段级双层审批）、多 Provider 适配（claude / codex / copilot / opencode / hermes / gemini / pi / cursor / kimi / kiro / antigravity / openclaw 共 12 种，6 种协议适配）、Git Worktree 隔离、平台文件中心（MinIO/S3）、LLM 提供商管理、PPM 项目计划管理域、知识库 / 事件 / 发布工作流。

项目状态：**未正式上线（仅 PPM 模块已上线）**，允许重置开发 / 测试数据，不要求历史兼容（`.claude/CLAUDE.md` 规则 11）。SillyHub 自身用 SillySpec 规范驱动开发构建（吃自己的狗粮，`README.md` §「用 SillySpec 构建 SillyHub」）。

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python ≥3.12 + FastAPI + SQLModel + SQLAlchemy(async) + Alembic + Pydantic v2 + structlog；python-jose(JWT) + passlib[bcrypt] + PyNaCl；aiobotocore（S3 对象存储）；mcp Python SDK v1 线（FastMCP ASGI mount，锁 <2） |
| 前端 | Next.js 14.2.5(App Router) + React 18.3.1 + TypeScript 5.5 + Ant Design 6 + shadcn/radix + @xyflow/react + TanStack Query + Zustand + Tailwind 3.4 + ECharts；类型由 OpenAPI 生成（openapi-typescript，禁手写） |
| daemon | Node.js ≥20 + TypeScript 5.5(ESM/pnpm) + `@anthropic-ai/claude-agent-sdk` 0.3.181 + `@modelcontextprotocol/sdk` + `ws`；HTTP 用原生 fetch |
| 数据 | PostgreSQL 16（生产，asyncpg）/ aiosqlite（单测）；Redis 7（缓存 + Pub/Sub）；MinIO（S3 兼容对象存储） |
| LLM | 平台 LLM 提供商管理域（多提供商启停 / 默认切换）；OpenAI 兼容格式供应商经 OpenAI 兼容网关接入（依据归档 change `2026-08-10-llm-provider-openai-format`）；Claude / Codex 会话经 daemon interactive driver |
| 部署 | Docker Compose（`deploy/docker-compose.yml` 全栈 + `docker-compose.dev.yml` 开发依赖）；GitHub Actions 3 workflow（backend-ci / frontend-ci / scan-drift） |
| 包管理 | uv（backend）/ pnpm 9.6.0（frontend + sillyhub-daemon） |

## 子项目清单

- **backend**（`backend/`，包名 `multi-agent-platform-api`，`pyproject.toml`）：FastAPI 模块化单体；`app/modules/` 按业务模块 vertical slice（每模块 router / schema / service / models / tests 标准布局），`core/` 提供配置、数据库、Redis、认证、加密、日志；集成测试在 `tests/`，模块内单测在 `app/modules/*/tests/`。
- **frontend**（`frontend/`，包名 `multi-agent-platform-web`，`package.json`）：Next.js App Router 管理台；页面 `src/app/`（桌面 dashboard + 移动端 `m/`）、组件 `src/components/`、API 模块 `src/lib/`（类型 `api-types.ts` 由后端 OpenAPI 生成）、全局状态 `src/stores/`（Zustand）。
- **sillyhub-daemon**（`sillyhub-daemon/`）：本地守护进程——宿主 Agent 检测（12 provider）、batch lease 任务执行（`task-runner.ts`）、交互式会话（`claude-sdk-driver.ts` / `codex-app-server-driver.ts`）、宿主文件系统代理 + `FilesystemPolicyEngine` 策略引擎、技能 / MCP 分发、断网韧性（outbox + 重连）。

## 架构与流程要点

- 变更生命周期五段 brainstorm → plan → execute → verify → archive（scan 为入口动作）；平台侧状态机 + 阶段评审门禁（PendingReview），执行侧 daemon 驱动 Agent 按阶段推进。
- 工作区绑定 = daemon 实体（per-member binding、per-daemon WebSocket），runtime 为 daemon 从属。
- provider 抽象：6 种协议适配器 + interactive driver，新增 Agent 加驱动不碰控制面。
- 前端 / daemon 接口类型一律从后端 OpenAPI 生成（`pnpm gen:types`），禁止手写（`.claude/CLAUDE.md` 规则 21）。

## 关联文档与进度库

- `.sillyspec/`：SillySpec 进度库——`changes/`（活跃变更）、`changes/archive/`（已归档变更）、`quicklog/`（小修记录）、`docs/`（模块文档；`SillyHub/` 与 `multi-agent-platform/` 双命名空间并存，见 CONCERNS）。
- `docs/sillyspec/`：SillySpec 工具坑记录目录；本轮实测仅剩 `finished/`（已处理坑），活跃坑目录已清空。
- `docs/`：事实文档——深度审计 `agent-platform-deep-audit-2026-07-12.md`、代码质量加固记录（2026-07-24 / 07-27）、安全审计 `security-audit-2026-07-28.md`、worktree 陷阱 `worktree-pitfalls.md` 等。
- `.sillyspec/docs/SillyHub/scan/`：8 篇扫描文档（ARCHITECTURE / PROJECT / STRUCTURE / CONVENTIONS / TESTING / CONCERNS / INTEGRATIONS / FRONTEND_PAGE_STYLE；后者为页面级前端实现规范）。
- 根 `Makefile`：跨子项目统一入口（dev 起停 / test / lint / build / docker）；`README.md` 为快速开始与开发指南权威入口。仓库根已无 ROADMAP.md / meta.json（本轮实测）。
