---
author: qinyi
created_at: 2026-07-27 00:35:31
source_commit: 6e78b29a
updated_at: 2026-07-26T16:35:31Z
generator: sillyspec-scan
---

# 项目(Project)

## 项目简介

SillyHub(仓库 `multi-agent-platform`)是多智能体协作管理平台,将 [SillySpec](https://github.com/nicepkg/sillyspec) 规范驱动开发方法论产品化,提供多用户、多项目、多 Agent 的全生命周期管理系统。通过 Web 界面管理工作空间(Git 仓库)、编排 AI Agent(首发 Claude Code + Codex)、跟踪结构化变更规格、协调团队协作。产品形态为模块化单体 backend + Next.js 前端 + 本地 daemon 的全栈 Web 应用。

核心能力:工作空间管理(注册 Git 仓库 + 扫描 `.sillyspec` 目录)、变更生命周期(brainstorm → plan → execute → verify → archive 五段)、AI Agent 编排(实时 SSE 流式输出 + 中断恢复 + 上下文指纹 + 审批门禁)、Git Worktree 隔离(每个变更在独立 worktree 执行)、多用户认证(JWT + bcrypt + RBAC)、Git 凭据网关(共享服务器多用户隔离)、本地 Daemon(宿主机 Agent 检测 + 任务执行)、拓扑可视化、知识库 / 事件 / 发布工作流、PPM 项目计划管理域(约 20 张表)。

项目状态:**未正式上线**(仅 PPM 模块已上线),允许重置开发 / 测试数据,不要求历史兼容(`.claude/CLAUDE.md` 规则 11)。

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python 3.12 + FastAPI + SQLModel + SQLAlchemy(async) + Alembic + Pydantic v2 + structlog;python-jose(JWT) + passlib[bcrypt] + PyNaCl;aiobotocore(对象存储) |
| 前端 | Next.js 14.2.5(App Router) + React 18.3.1 + TypeScript 5.5 + shadcn/ui + Ant Design 6 + @xyflow/react 12 + TanStack Query + Zustand + Tailwind 3.4 + ECharts |
| 数据库 | PostgreSQL 16(生产,asyncpg) / aiosqlite(单测) |
| 缓存 | Redis 7(Pub/Sub + 凭据 / token 缓存) |
| Agent | Claude Code CLI / Codex(经 daemon interactive driver) |
| Daemon | Node.js 20 + TypeScript 5.5(ESM / pnpm)+ `@anthropic-ai/claude-agent-sdk` 0.3.181 + `ws`;HTTP 用 Node 20 原生 `fetch`(零 HTTP 库依赖) |
| 对象存储 | MinIO(S3 兼容,平台文件中心) |
| 部署 | Docker Compose(`deploy/docker-compose.yml`,全栈 4 服务) |
| 包管理 | uv(后端) / pnpm 9.6.0(前端 + daemon) |

## 三端架构

- **backend(`backend/app/`)**:24 个业务模块 vertical slice,每模块标准布局 `router.py` / `schema.py` / `service.py` / `models.py` / `tests/`。核心抽象:Agent Adapter、Change Writer、Execution Coordinator、Tool Gateway、Workflow State Machine。`core/` 含配置、数据库、Redis、认证、加密、日志。
- **frontend(`frontend/src/`)**:App Router 页面(`app/`)+ 共享组件(`components/`)+ 33 个 lib API 模块(`lib/`)+ Zustand 全局状态(`stores/`)。类型由 OpenAPI 生成(`lib/api-types.ts`,`pnpm gen:types`)。
- **sillyhub-daemon(`sillyhub-daemon/`)**:本地守护进程,负责宿主机 Agent 检测(12 provider:claude / codex / copilot / opencode / hermes / gemini / pi / cursor / kimi / kiro / antigravity / openclaw)、任务执行(`task-runner.ts` batch lease)、交互式会话(`claude-sdk-driver.ts` / `codex-app-server-driver.ts`)、文件系统代理(`host_fs/delegate.ts` + `FilesystemPolicyEngine`)、技能 / MCP 分发、网络韧性(outbox + 重连)。

**数据层关键模型**:`AgentRun` / `AgentSession` / `AgentMission` / `AgentArtifact` / `AgentRunLog` / `DaemonTaskLease` / `DaemonInstance` / `WorkspaceMemberRuntime`。工作区绑定 = daemon 实体(per-member binding,per-daemon WebSocket)。

## 关键架构决策

- **5 段变更流程**:brainstorm → plan → execute → verify → archive(scan / propose / quick 已移除);状态机定义 `backend/app/modules/change/model.py StageEnum`。
- **工作区绑定 = daemon 实体**(非 runtime):`daemon_instances` 表,per-daemon WS + dispatch daemon_id,runtime 退化为 daemon 的从属。
- **provider 抽象**:Claude / Codex 经 6 协议适配器(stream_json / json_rpc / jsonl / ndjson / pi_json / text)+ interactive driver;新增 provider 加 driver 不触碰控制面。batch 能跑任何探测到的 provider,interactive / scan 仅 claude + codex。
- **前端类型生成**:手写类型 → OpenAPI 生成类型(react-query 服务端状态 + zustand 全局状态并存)。
- **双层审批**:工具级(`permission_service` canUseTool 5min 超时 deny + AskUserQuestion 持久化不超时)+ 阶段级(PendingReview 四面板 proposal / plan / human_test / archive)。

## 开发入口与文档

根 `Makefile` 暴露跨子项目统一入口(约 22 个 target):`make dev-up` / `dev-down`(起/停 pg+redis)、`make up` / `down`(全栈 docker)、`make test` / `backend-test` / `frontend-test`、`make lint` / `backend-format` / `frontend-typecheck` / `frontend-build`。后端启动后 API 文档:`http://localhost:8000/api/docs`(Swagger)/ `/api/redoc` / `/api/openapi.json`。

权威文档:`README.md`(快速开始 / 项目结构 / 开发指南)、`ROADMAP.md`(里程碑 / 活跃变更 / 已知技术债)、`docs/agent-platform-deep-audit-2026-07-12.md`(能力审计 + P0~P3 方案带 file:line)、`docs/code-quality-hardening-2026-07-24.md`(六批加固 + DEFER 清单)、`.claude/CLAUDE.md`(项目规则 + 完成汇报格式)、`.sillyspec/changes/` 与 `.sillyspec/changes/archive/`(详细变更规格)。
