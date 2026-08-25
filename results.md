# Multi-Agent Platform (SillyHub) — 项目分析报告

> 调研时间: 2026-08-25 | 基于 worktree 8dc9c1c1 (HEAD: 9d68a859)

---

## 1. 项目定位与用途

**SillyHub** 是一个**多智能体协作管理平台**，目标是让 AI Agent 在团队中落地写代码。核心能力包括：

- 把规范驱动开发（SillySpec）从单人 CLI 工具升级为团队级协作平台
- 管理工作空间、编排多个 AI Agent、跟踪结构化变更规格
- 协调多人协作与审批流程
- 支持 12 种宿主 Agent（Claude Code / Codex / Copilot / OpenCode 等），6 种协议适配
- 变更全生命周期：brainstorm → plan → execute → verify → archive

**当前状态**: PPM 模块已上线，其余功能未正式上线。

---

## 2. 技术栈

| 层 | 技术 |
|---|---|
| **后端** | Python 3.12 · FastAPI · SQLModel · SQLAlchemy (async) · Alembic · Pydantic v2 · structlog |
| **前端** | Next.js 14 (App Router) · React 18 · TypeScript 5 · Ant Design 6 · @xyflow/react · TanStack Query · Zustand · Tailwind CSS · ECharts |
| **数据库** | PostgreSQL 16 · Redis 7 (缓存 + Pub/Sub) |
| **对象存储** | MinIO (S3 兼容) |
| **Daemon** | Node.js ≥20 · TypeScript · @anthropic-ai/claude-agent-sdk · @modelcontextprotocol/sdk · ws |
| **LLM 网关** | LiteLLM (容器化，多 Provider 路由) |
| **部署** | Docker Compose (全栈容器化) |
| **包管理** | uv (后端) · pnpm 9 (前端 + daemon) |
| **构建** | hatchling (Python wheel) · tsc (TS) · Next.js build · @vercel/ncc (daemon bundle) |

---

## 3. 核心模块及职责

### 3.1 Backend (Python/FastAPI) — 34 个路由模块

**基础核心** (`backend/app/core/`):
- `config.py` — 配置管理
- `db.py` — 数据库连接池
- `redis.py` — Redis 连接
- `auth_deps.py` — 鉴权依赖注入
- `errors.py` — 统一错误体系 (AppError)
- `security.py` — 安全工具
- `ssrf.py` — SSRF 防护
- `audit_hooks.py` — 审计钩子
- `permission_cache.py` — 权限缓存
- `spec_paths.py` — 规范路径管理

**业务域** (`backend/app/modules/`，vertical slice 架构):

| 模块 | 职责 |
|---|---|
| `workspace/` | 工作空间管理（Git 仓库注册、扫描、组件拓扑） |
| `change/` | 变更生命周期（brainstorm→plan→execute→verify→archive） |
| `task/` | 任务调度与执行 |
| `agent/` | AI Agent 编排与运行时管理 |
| `daemon/` | Daemon 节点管理（连接、心跳、lease） |
| `runtime/` | 运行时实例管理 |
| `session_attachment/` | 会话附件与日志 |
| `auth/` | 用户认证与授权 |
| `ppm/` | 项目计划管理（project/plan/task/problem/kanban/workbench） |
| `llm_provider/` | LLM 提供商管理 |
| `mcp_gateway/` | MCP 协议网关 |
| `file/` | 文件管理（MinIO/S3 对象存储） |
| `git_gateway/` | Git 操作网关 |
| `git_identity/` | Git 身份管理 |
| `skills/` | 自定义技能管理 |
| `spec_workspace/` | 规范工作空间 |
| `spec_profile/` | 规范配置 |
| `knowledge/` | 知识库 |
| `incident/` | 线上事件管理 |
| `release/` | 发布管理 |
| `workflow/` | 工作流编排 |
| `platform_sync/` | 跨平台进度同步 |
| `explorer/` | 文件浏览器 |
| `scan_docs/` | 文档扫描 |
| `tool_gateway/` | 工具网关 |
| `storage/` | 存储服务 |
| `admin/` | 管理后台 |
| `settings/` | 系统设置 |
| `health/` | 健康检查 |
| `change_writer/` | 变更写入器 |
| `worktree/` | Git Worktree 管理 |

### 3.2 Frontend (Next.js 14)

**66 个前端页面**，主要分区：
- `(auth)/` — 登录页
- `(dashboard)/` — 主控制台（工作空间、变更、设置、PPM、运行时、会话等）
- `m/` — 移动端页面
- 全局悬浮会话宿主（FloatingSessionHost）

**核心前端模块**:
- `stores/` — Zustand 状态管理（session, workspace, theme, kanban, floating-session）
- `lib/` — API 客户端（60+ 模块）、类型定义（从后端 OpenAPI 自动生成）
- `components/` — UI 组件库（agent, agent-log, changes, charts, daemon, explorer 等）
- `styles/` — 主题系统（双主题：blue / ai-native）
- `hooks/` — 自定义 Hook

### 3.3 Daemon (Node.js/TypeScript)

**本机执行守护进程**，核心职责：
- `daemon.ts` (221KB) — 主守护逻辑
- `task-runner.ts` (154KB) — 任务执行引擎
- `hub-client.ts` (80KB) — 与 backend 的 WebSocket 通信
- `spec-sync.ts` (90KB) — 规范文件同步
- `mcp-server.ts` (38KB) — MCP 服务端

**子系统**:
- `adapters/` — 8 种协议适配器（JSON-RPC, JSONL, NDJSON, Pi-JSON, Stream-JSON 等）
- `interactive/` — 交互式 Agent 驱动（Claude SDK, Codex App Server, 权限解析）
- `policy/` — 文件系统策略引擎（路径安全、审计）
- `resilience/` — 弹性机制（错误分类、重试、outbox）
- `agent-log/` — Agent 日志处理
- `model-error/` — 模型错误处理

---

## 4. 目录结构概览

```
multi-agent-platform/
├── backend/                    # FastAPI 后端
│   ├── app/                    # 应用代码
│   │   ├── core/               # 基础设施（DB/Redis/Auth/Security）
│   │   ├── modules/            # 34 个业务域（vertical slice）
│   │   ├── models/             # 共享数据模型
│   │   └── main.py             # 路由注册入口 (42KB)
│   ├── tests/                  # 集成测试 + E2E 测试
│   ├── migrations/versions/    # 157 个 Alembic 迁移
│   ├── hooks/                  # Git hooks
│   ├── templates/              # 模板
│   ├── conftest.py             # 测试 fixtures
│   ├── pyproject.toml          # Python 项目配置
│   ├── openapi.json            # OpenAPI 规范 (1.6MB)
│   └── Dockerfile              # 后端容器
├── frontend/                   # Next.js 14 前端
│   ├── src/
│   │   ├── app/                # 66 个页面路由
│   │   ├── components/         # UI 组件
│   │   ├── lib/                # API 客户端 + 工具库 (60+ 文件)
│   │   ├── stores/             # Zustand 状态管理
│   │   ├── styles/             # 主题系统
│   │   ├── hooks/              # 自定义 Hook
│   │   └── config/             # 配置
│   ├── package.json
│   └── Dockerfile
├── sillyhub-daemon/            # 本地执行守护进程
│   ├── src/
│   │   ├── adapters/           # 8 种协议适配器
│   │   ├── interactive/        # 交互式 Agent 驱动
│   │   ├── policy/             # 文件系统策略引擎
│   │   ├── resilience/         # 弹性机制
│   │   ├── agent-log/          # Agent 日志
│   │   ├── model-error/        # 模型错误处理
│   │   ├── daemon.ts           # 主守护逻辑 (221KB)
│   │   ├── task-runner.ts      # 任务执行引擎 (154KB)
│   │   ├── hub-client.ts       # Backend 通信 (80KB)
│   │   └── spec-sync.ts        # 规范同步 (90KB)
│   ├── tests/                  # 159 个测试文件
│   └── package.json
├── deploy/                     # Docker Compose 编排
│   ├── docker-compose.yml      # 全栈部署
│   ├── docker-compose.dev.yml  # 开发环境
│   └── litellm-config.yaml     # LiteLLM 配置
├── docs/                       # 设计与文档
├── scripts/                    # 仓库级脚本
├── .github/workflows/          # CI (4 个 workflow)
├── .sillyspec/                 # 规范驱动工作区
│   ├── changes/                # 34 个活跃变更 + 212 个已归档
│   ├── docs/                   # 扫描文档
│   ├── knowledge/              # 知识库
│   ├── quicklog/               # 快速日志
│   ├── workflows/              # 工作流定义
│   └── ROADMAP.md              # 路线图
├── spikes/                     # 技术 Spike
├── attachments/                # 附件
├── Makefile                    # 统一开发入口
├── README.md                   # 项目说明
├── CLAUDE.md                   # Claude Code 指引
└── AGENTS.md                   # Agent 行为规范
```

---

## 5. 文件统计

| 类型 | 数量 |
|---|---|
| Python (.py) | 1,043 |
| TypeScript (.ts) | 384 |
| TSX (.tsx) | 391 |
| HTML (.html) | 110 |
| CSS (.css) | 1 |
| YAML/YML (.yaml/.yml) | 26 |
| Markdown (.md) | 4,448 |
| JSON (.json) | 91 |
| Shell (.sh) | 7 |
| **总文件数（去依赖/锁）** | **6,756** |

### 测试文件

| 组件 | 测试文件数 | 测试框架 |
|---|---|---|
| Backend (集成) | 80 | pytest + pytest-asyncio + xdist |
| Backend (模块内) | 331 | pytest |
| Frontend | 194 | Vitest + @testing-library/react |
| Daemon | 159 | Vitest |
| **总计** | **764** | — |

### 后端模块测试分布

35 个模块级 tests 目录，覆盖 agent、change、daemon、file、ppm 全子域、knowledge、incident、release、mcp_gateway、platform_sync 等。

---

## 6. 近期开发活动

基于 `git log --oneline -20`（2026-08-25）：

**高活跃度开发领域**：
1. **会话系统增强**（最高频）：悬浮会话宿主、智能入口、分身日志/产物展示、上下文前导可视化
2. **性能优化**：会话优化第二轮 14 项（行锁优化、GIN 索引、O(n²) 消除、超时控制）
3. **审查修复**：33 项审查修复（SSE 连接管理、内存泄漏、并发安全、越权注入等 P0×4）
4. **团队协作**：团队四缺陷修复（范围徽标、worker 日志/产物 403、死循环改主动汇报、断线恢复优先级）
5. **会话 SSE 变更信号**：Redis 全局频道 + SSE 端点 + 前端订阅客户端

**关键模式**：
- 几乎每个提交都包含测试覆盖和类型检查
- 使用 SillySpec 管理变更（ql-20260825-001/002/003/004 等）
- 多 worktree 并行开发，冲突解决频繁
- 前端后端 Daemon 三端同步测试（backend 5382/frontend 2181/daemon 2748）

---

## 7. 依赖与构建系统

### 7.1 后端 Python 依赖（核心）

- **Web 框架**: FastAPI + Uvicorn
- **ORM**: SQLModel + SQLAlchemy (async) + asyncpg
- **迁移**: Alembic (157 个版本)
- **验证**: Pydantic v2
- **认证**: python-jose + passlib + PyNaCl
- **HTTP 客户端**: httpx
- **对象存储**: aiobotocore (S3 兼容)
- **MCP 协议**: mcp SDK v1 (≥1.29, <2)
- **文档处理**: python-frontmatter + openpyxl + Pillow
- **日志**: structlog
- **缓存/消息**: Redis

### 7.2 前端 Node 依赖（核心）

- **框架**: Next.js 14 + React 18 + TypeScript 5
- **UI**: Ant Design 6 + Radix UI + Tailwind CSS
- **状态**: Zustand + TanStack Query
- **可视化**: @xyflow/react (组件拓扑) + ECharts
- **Markdown**: @uiw/react-markdown-preview + rehype-sanitize
- **虚拟化**: @tanstack/react-virtual

### 7.3 Daemon Node 依赖（核心）

- **Agent SDK**: @anthropic-ai/claude-agent-sdk 0.3.181
- **MCP**: @modelcontextprotocol/sdk ≥1.29
- **WebSocket**: ws
- **验证**: zod v4
- **CLI**: commander

### 7.4 CI/CD

4 个 GitHub Actions Workflow：
- `backend-ci.yml` — 后端测试 + lint + mypy
- `frontend-ci.yml` — 前端测试 + typecheck
- `daemon-ci.yml` — Daemon 测试 + typecheck
- `scan-drift.yml` — 文档漂移检查

### 7.5 开发工具链

- **Linting**: Ruff (Python) + ESLint (TS) + mypy (Python)
- **Formatting**: Ruff format
- **测试**: pytest (backend) + Vitest (frontend/daemon)
- **并行测试**: pytest-xdist (后端，loadscope 分组)
- **类型生成**: openapi-typescript (从后端 OpenAPI 生成前端/Daemon 类型)

---

## 8. 架构亮点

1. **单一 API 真相**: 前后端与 Daemon 共享 backend 的 OpenAPI 规范，类型自动生成，CI 卡类型漂移
2. **Vertical Slice 架构**: 后端按业务域组织（每个模块含 router/service/model/schema/tests）
3. **Git Worktree 隔离**: 每个变更在独立 worktree 执行，并行不冲突
4. **双层审批**: 工具级 + 阶段级审批门禁
5. **多 Provider 适配**: 12 种 Agent 宿主通过适配器模式统一接入
6. **规范驱动开发**: SillySpec 全流程管理（brainstorm→plan→execute→verify→archive），212 个已归档变更
7. **安全纵深**: SSRF 防护、文件系统策略引擎、RBAC 权限、审计钩子、凭据网关

---

## 9. 风险与观察

1. **代码规模大**: daemon.ts (221KB) 和 task-runner.ts (154KB) 是超大单文件，维护风险高
2. **迁移数量多**: 157 个 Alembic 迁移版本，需注意迁移链健康
3. **Markdown 文档量极大**: 4,448 个 .md 文件（主要是 SillySpec 变更规格和知识库），仓库体积大
4. **多 Agent 并行冲突**: MEMORY.md 记录了大量 worktree 并行开发的冲突和踩坑经验
5. **Windows/Linux 跨平台**: 项目要求三平台兼容，已知 Windows bind mount stat 性能断崖、BOM 编码等坑
6. **SillySpec 工具缺陷**: docs/sillyspec/ 下记录了多个待修复的 CLI 工具问题
7. **预存测试债**: 部分预存测试失败（如 scan_generate 相关），CI 红但本机绿的偶发问题
