# multi-agent-platform 项目调研报告

> 调研时间：2026-08-27 | 分身角色：调研员

---

## 一、项目定位

**SillyHub — 多智能体协作管理平台**

核心愿景：让 AI Agent 真正在团队里落地写代码。将规范驱动开发（SillySpec）从单人 CLI 工具升级为团队级协作平台——管理工作空间、编排多个 AI Agent、跟踪结构化变更规格、协调多人协作与审批。

项目本身"吃自己的狗粮"——用 SillySpec 管理自身的每一次变更迭代。

---

## 二、技术栈总览

| 层 | 技术选型 |
|---|---|
| **后端** | Python 3.12 · FastAPI · SQLModel · SQLAlchemy(async) · Alembic · Pydantic v2 · structlog |
| **前端** | Next.js 14 (App Router) · React 18 · TypeScript 5 · Ant Design 6 · @xyflow/react · TanStack Query · Zustand · Tailwind CSS · ECharts |
| **数据库** | PostgreSQL 16 · Redis 7 (缓存 + Pub/Sub) |
| **对象存储** | MinIO (S3 兼容) |
| **Daemon** | Node.js ≥20 · TypeScript · @anthropic-ai/claude-agent-sdk · @modelcontextprotocol/sdk · ws |
| **LLM 网关** | LiteLLM (多 Provider 统一代理) |
| **部署** | Docker Compose (全栈容器化) |
| **包管理** | uv (后端) · pnpm 9 (前端 + daemon) |
| **CI** | GitHub Actions (backend-ci / frontend-ci / daemon-ci / scan-drift 四条流水线) |

---

## 三、项目结构

```
multi-agent-platform/
├── backend/              # FastAPI 后端
│   ├── app/
│   │   ├── core/         # 基础设施层（config, db, auth, security, redis, ssrf, audit 等）
│   │   ├── modules/      # 业务域 vertical slice（30+ 模块）
│   │   ├── models/       # 公共模型基类
│   │   └── main.py       # FastAPI 入口 + 所有 router 注册
│   ├── migrations/       # Alembic 数据库迁移
│   ├── tests/            # 集成测试
│   ├── openapi.json      # OpenAPI 规范（1.7MB，前端 gen:types 源）
│   └── pyproject.toml    # uv 依赖管理
├── frontend/             # Next.js 14 前端
│   └── src/
│       ├── app/          # App Router 页面（(dashboard) 下含 workspaces/sessions/agent/ppm/settings 等）
│       ├── components/   # 组件库（80+ 组件，含 agent/daemon/changes/ppm/explorer 等）
│       ├── lib/          # 工具函数 + api-types.ts（从 OpenAPI 自动生成）
│       ├── stores/       # Zustand 状态管理
│       ├── styles/       # 主题系统（blue/ai-native 双主题）
│       └── hooks/        # 自定义 hooks
├── sillyhub-daemon/      # 本地执行守护进程
│   └── src/
│       ├── adapters/     # 协议适配器（stream_json/json_rpc/jsonl/ndjson/text/pi-json）
│       ├── policy/       # 文件系统策略引擎（安全沙箱）
│       ├── resilience/   # 容错/重试机制
│       ├── interactive/  # 交互式会话管理
│       ├── mcp-server.ts # MCP Server 实现
│       ├── task-runner.ts # 任务执行器（核心调度）
│       ├── daemon.ts     # Daemon 主入口
│       └── ws-client.ts  # WebSocket 客户端（连 backend）
├── deploy/               # Docker Compose 编排
│   ├── docker-compose.yml      # 全栈部署
│   ├── docker-compose.dev.yml  # 开发依赖
│   └── litellm-config.yaml     # LiteLLM 路由配置
├── docs/                 # 设计与文档
├── scripts/              # 仓库级脚本（scan 漂移检查等）
├── spikes/               # 技术探索（5 个 spike：git-isolation / workspace-scan / claude-code / delegate-task 等）
├── .github/workflows/    # CI 流水线
├── .sillyspec/           # SillySpec 规范驱动工作区（changes / docs / knowledge）
└── Makefile              # 统一开发入口
```

---

## 四、核心功能模块

### 4.1 工作空间管理 (`workspace`)
- 注册 Git 仓库为工作空间
- 自动扫描规范目录（SillySpec 文件树）
- 组件拓扑可视化（@xyflow/react）
- 多成员协作 + RBAC 权限控制

### 4.2 变更全生命周期 (`change`)
- **brainstorm → plan → execute → verify → archive** 五阶段状态机
- 每阶段有评审门禁（Stage Review / Task Review）
- 结构化文档（proposal / design / plan / tasks 四件套）
- Git Worktree 隔离——每个变更在独立 worktree 执行，并行不冲突

### 4.3 AI Agent 编排 (`agent` / `daemon` / `runtime`)
- 多 Agent 调度（任务分派、上下文指纹、中断恢复）
- 双层审批（工具级 + 阶段级）
- SSE 流式输出——实时查看 Agent 执行过程
- Agent Profile 配置增强层

### 4.4 多 Provider 适配 (`sillyhub-daemon/src/adapters/`)
- 支持 12 种宿主 Agent：Claude Code / Codex / Copilot / OpenCode / Hermes / Gemini / Pi / Cursor / Kimi / Kiro / Antigravity / OpenClaw
- 6 种协议适配：stream_json / json_rpc / jsonl / ndjson / text / pi_json
- 新增 Agent 只加 adapter 不碰控制面

### 4.5 MCP Gateway (`mcp_gateway`)
- 对外暴露 MCP Server（FastMCP streamable HTTP）
- SSE 端点支持
- MCP Token 管理 UI（签发/列表/吊销）

### 4.6 平台文件中心 (`storage`)
- MinIO/S3 兼容对象存储
- 上传/下载/流式分发
- 文件预览（Office 文档、PDF、图片等）

### 4.7 LLM 提供商管理 (`llm_provider`)
- 多提供商切换（启停/设默认）
- 对接 LiteLLM 网关
- 代理转发（llm-proxy）

### 4.8 PPM 项目计划管理 (`ppm`)
- 项目/计划节点/任务执行/问题清单/看板
- 完整的项目交付域（已上线模块）
- 子模块：kanban / plan / problem / project / task / workbench

### 4.9 其他重要模块
| 模块 | 功能 |
|---|---|
| `auth` | JWT 认证 + RBAC 权限 |
| `admin` | 用户管理、组织架构 |
| `incident` | 线上事件复盘 |
| `release` | 发布审批工作流 |
| `knowledge` | 经验沉淀知识库 |
| `platform_sync` | 跨平台进度同步 |
| `spec_workspace` | SillySpec 工作区管理 |
| `scan_docs` | 文档扫描 |
| `workflow` | 工作流编排 |
| `explorer` | 文件浏览器 |
| `git_gateway` | Git 操作网关 |
| `git_identity` | Git 身份管理 |
| `git_log` | Git 日志查看 |
| `monitoring` | 慢请求监控 + 事件循环看门狗 |
| `audit_hooks` | 审计钩子（登录/设置等操作审计） |

---

## 五、架构特点

### 5.1 整体架构
```
浏览器 ──HTTP/REST + SSE──▶ backend(FastAPI) ──▶ PostgreSQL / Redis / MinIO
                                 ▲
                                 │ WebSocket
                          sillyhub-daemon(Node, 本机)
                                 │ spawn + MCP
                                 ▼
                       Claude Code / Codex … Agent
```

- **backend**：持久化与鉴权中心，所有 API 的唯一真相源
- **daemon**：本机执行边缘节点，主动连 backend 调度任务、读写宿主文件系统
- **单一 API 真相**：前后端与 daemon 共享 backend 的 OpenAPI，类型自动生成（`pnpm gen:types`），CI 卡类型漂移

### 5.2 关键设计决策
1. **Vertical Slice 架构**：后端按业务域组织（每个模块独立 router/service/model/schema/tests）
2. **规范驱动开发（SillySpec）**：所有变更走结构化流程，文档先行
3. **Worktree 隔离**：每个变更在独立 Git Worktree 执行，避免并行冲突
4. **双层安全**：文件系统策略引擎（daemon policy）+ 后端 RBAC 权限
5. **AI-Native 双主题**：前端支持 blue / ai-native 双主题切换

---

## 六、开发流程与约定

### 6.1 代码约定
- 后端：ruff (lint+format) + mypy (类型检查)
- 前端：ESLint + TypeScript strict + vitest
- Daemon：TypeScript typecheck + vitest
- 所有类型从后端 OpenAPI 自动生成，禁止手写

### 6.2 变更流程
- **新功能/大改动**：brainstorm → plan → execute → verify → archive（完整 SillySpec 流程）
- **小修复/小调整**：sillyspec run quick（快速通道）
- **进度管理**：sillyspec status / sillyspec resume

### 6.3 平台管理文件同步
- CLI 直跑 spec 树增量同步（manifest + sync 端点）
- 乐观锁 + hash/rename/base_version 识别

---

## 七、规模估计

| 维度 | 估计 |
|---|---|
| 后端模块数 | 30+ 业务模块 |
| 前端组件数 | 80+ 组件 |
| 后端测试 | ~3960+ passed（pytest） |
| 前端测试 | ~1400+ passed（vitest） |
| CI 流水线 | 4 条（backend/frontend/daemon/scan-drift） |
| 数据库迁移 | 50+ Alembic migration |
| OpenAPI 规范 | 1.7MB（完整 REST API） |

---

## 八、关键依赖版本

### 后端核心
- FastAPI ≥0.115
- SQLAlchemy ≥2.0 (async)
- Pydantic ≥2.8
- PostgreSQL (asyncpg ≥0.29)
- Redis ≥5.0
- aiobotocore ≥3.8 (S3)
- mcp ≥1.29,<2 (MCP SDK v1)

### 前端核心
- Next.js 14.2.5
- React 18.3.1
- Ant Design 6.4.4
- @xyflow/react 12.10.2
- TanStack Query 5.51.0
- Zustand 4.5.0

### Daemon 核心
- @anthropic-ai/claude-agent-sdk 0.3.181
- @modelcontextprotocol/sdk ≥1.29.0
- ws ≥8.18.0

---

## 九、总结

multi-agent-platform（SillyHub）是一个**全栈多智能体协作管理平台**，核心价值在于：

1. **规范化**：用 SillySpec 把 AI Agent 写代码的过程从黑箱变成可追溯、可审查、可复盘的结构化流程
2. **多 Agent 编排**：一套平台调度 12+ 种 AI Agent，协议适配层解耦，扩展成本低
3. **团队协作**：多用户/多项目/多工作空间 + RBAC + Git 凭据网关，开箱即用
4. **安全可控**：本地 daemon 执行 + 文件系统策略引擎 + worktree 隔离，不越权不互扰
5. **实时可视**：SSE 流式输出 + 组件拓扑 + 运行日志 + 看板

技术上是一个成熟的全栈项目，覆盖了从 LLM 网关到前端 UI 的完整链路，有完善的 CI/CD 和测试体系。
