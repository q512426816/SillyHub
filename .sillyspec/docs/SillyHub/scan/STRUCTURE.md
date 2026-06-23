---
date: 2026-06-24
source_commit: ba87eec
updated_at: 2026-06-23T16:32:14Z
created_at: 2026-06-24T00:32:14
author: qinyi
generator: sillyspec-scan
---

# SillyHub — 项目结构（产品根 monorepo）

> 本文档由 `sillyspec-scan` 在 `ba87eec` 处全量重扫 SillyHub 产品根（path = `.`，仓库根）生成。
> SillyHub 与 `multi-agent-platform` 同指根目录；根目录本身**不含应用源码**，代码在 3 个子项目 + 部署/脚本目录。

## 1. 顶层布局

```
SillyHub/  (multi-agent-platform 产品根)
├── .claude/             # 项目约定：CLAUDE.md（硬性规则 + 执行顺序）+ hooks + skills + worktrees + settings.json
├── .codex/              # Codex CLI 约定配置（与 Claude 并行的 agent runtime）
├── .sillyspec/          # SillySpec 工作区：changes / docs / knowledge / projects / quicklog / workflows / sillyspec.db
├── .github/             # CI 配置
├── backend/             # FastAPI + Python 3.12 + SQLModel 后端 API
├── frontend/            # Next.js 14 + React 18 + TS Web 前端
├── sillyhub-daemon/     # 本地守护进程（Node ≥20 ESM），驱动 Claude Agent SDK 进程
├── deploy/              # Docker Compose 编排（full + dev）
├── scripts/             # 辅助脚本
├── docs/                # 项目级设计文档 / QA / 参考资料
├── spikes/              # 技术探针（01-git-isolation ~ 05-mission-e2e）
├── data/                # 运行时数据/种子（本地）
├── backups/             # 备份
├── Makefile             # 跨子项目统一入口（make up / test / lint 等）
├── README.md            # 产品总览（含架构图、快速开始）
├── AGENTS.md            # Agent 行为约定（指向 .claude/CLAUDE.md）
├── package.json         # 根 package（占位，仅声明聚合）
├── .env                 # 本地环境变量
└── .editorconfig / .gitignore / .idea/ / .pytest_cache/ / .ruff_cache/
```

## 2. 各顶层目录职责

| 目录 | 角色 | 关键内容 |
| --- | --- | --- |
| `backend/` | **API 后端**：FastAPI 应用、领域模块、迁移、测试 | `app/`（`core/` + `modules/<domain>/`，共 26 个领域模块：agent / admin / archive / auth / change / change_writer / daemon / git_gateway / git_identity / health / incident / knowledge / ppm / release / runtime / scan_docs / settings / spec_profile / spec_workspace / task / tool_gateway / workflow / workspace / worktree）、`migrations/`（alembic）、`hooks/`、`scripts/`、`tests/`、`pyproject.toml`（Python 3.12）、`alembic.ini`、`Dockerfile`、`docker-entrypoint.sh`、`create_tables.py` |
| `frontend/` | **Web 前端**：Next.js 14 App Router + React 18 + Ant Design + Tailwind | `src/`（`app/` 页面路由 + `components/` + `lib/` API 客户端 + `stores/` Zustand）、`public/`、`next.config.mjs`（含后端代理 `INTERNAL_API_BASE_URL`）、`tailwind.config.ts`、`tsconfig.json`、`vitest.config.ts`、`Dockerfile`、`package.json`（pnpm@9.6.0） |
| `sillyhub-daemon/` | **本地守护进程**：Node ≥20 ESM 单进程，通过 `@anthropic-ai/claude-agent-sdk` 驱动 Claude 子进程，提供交互式会话与任务执行 | `src/`（`daemon.ts` 主循环 / `cli.ts` CLI / `hub-client.ts`+`ws-client.ts` 通信 / `interactive/` 会话管理 / `adapters/` 协议适配 / `task-runner.ts` / `workspace.ts` / `spawn-env.ts` / `credential.ts` / `agent-detector.ts` / `protocol.ts` / `types.ts`）、`dist/`、`tests/`、`tsconfig.json`、`vitest.config.ts`、`package.json` |
| `deploy/` | **Docker 编排**：全栈与服务依赖声明 | `docker-compose.yml`（postgres + redis + backend + frontend）、`docker-compose.dev.yml`（仅 postgres + redis）、`.env.example` |
| `scripts/` | **辅助脚本**：一次性维护工具 | `migrate_scan_docs.py`（scan 文档迁移，含 workspace 路径处理） |
| `docs/` | **项目级设计文档**：跨子项目的方案与参考资料 | `change-center-redesign.md`、`claude-loop-v1-p0.md`、`execution-plan-v2-v5.md`、`spec-alignment.md`、`agent-sillyspec-stage-execution-analysis.md`、`sillyspec-tool-side-requirements.md`、`qa/`、`sillyhub_refs/`（harness-runtime / knowledge-moat / cloud-runner） |
| `spikes/` | **技术探针**：独立可行性验证 | `01-git-isolation/`、`02-workspace-scan/`、`03-claude-code/`、`04-delegate-task/`、`05-mission-e2e/`、`README.md`、`REPORT.md` |
| `data/` | **本地运行时数据 / 种子数据** | 本地开发用数据落盘 |
| `backups/` | **备份** | 周期性备份产物 |
| `.sillyspec/` | **SillySpec 工作区**：变更生命周期与产物 | `changes/`（36 个变更目录，活跃 + `archive/`）、`docs/`（`SillyHub/` + `multi-agent-platform/` + 子项目 scan / modules）、`knowledge/`、`projects/`、`quicklog/`、`workflows/`、`sillyspec.db` |
| `.claude/` | **项目约定与技能**：Claude Code 行为配置 | `CLAUDE.md`（硬性规则 + 执行顺序：文档→读码→测试→实现→验收→更新文档）、`settings.json`（PreToolUse hook CI gate）、`hooks/`、`skills/`、`worktrees/` |
| `.codex/` | **Codex CLI 约定** | 与 Claude 并行的 agent runtime 配置 |

## 3. 子项目顶层速览

### 3.1 backend/
```
app/                # 应用主体（core/ + modules/<domain>/，vertical slice: router/schema/service/models/tests）
migrations/         # alembic 版本
hooks/              # git / CI hook 资源
scripts/            # 后端内部脚本
tests/              # 顶层集成测试
pyproject.toml      # Python 3.12 依赖（fastapi/sqlmodel/asyncpg/redis/alembic/ruff/mypy...）
alembic.ini         # 迁移配置
Dockerfile          # 生产镜像（build-args 注入 CLAUDE_CODE_VERSION / SILLYSPEC_VERSION）
docker-entrypoint.sh
create_tables.py    # 建表工具
```

### 3.2 frontend/
```
src/                # 页面与组件（App Router: app/ + components/ + lib/ + stores/）
public/             # 静态资源
next.config.mjs     # Next.js 配置（含后端代理 INTERNAL_API_BASE_URL）
tailwind.config.ts
tsconfig.json
vitest.config.ts
Dockerfile          # 构建时注入 API base url
package.json        # next 14.2.5 / react 18.3.1 / antd 6 / @tanstack/react-query / @xyflow/react / echarts
```

### 3.3 sillyhub-daemon/
```
src/                # TypeScript 源
  ├── daemon.ts          # 守护进程主循环（ws + SDK 消息驱动）
  ├── cli.ts             # 命令行入口
  ├── hub-client.ts      # REST 回调客户端（原生 fetch）
  ├── ws-client.ts       # WebSocket 客户端（连 backend Hub，含重连）
  ├── protocol.ts        # Daemon ↔ Server WS 消息协议常量
  ├── types.ts           # 共享类型（含 WS 消息信封）
  ├── interactive/       # 交互式 Claude 会话（session-manager / claude-sdk-driver / input-queue / types）
  ├── adapters/          # 协议适配（stream-json / json-rpc / jsonl / ndjson / protocol-adapter）
  ├── task-runner.ts     # 一次性任务执行
  ├── workspace.ts       # 工作目录解析
  ├── spawn-env.ts       # 子进程环境构建
  └── credential.ts      # 凭证注入
dist/               # 编译产物
tests/              # vitest 套件
package.json        # ESM / pnpm / @anthropic-ai/claude-agent-sdk@0.3.181 / ws / commander
tsconfig.json
```

## 4. SillyHub 功能域模块矩阵（呼应 modules/ 30 篇）

> 模块文档位于 `.sillyspec/docs/SillyHub/modules/`，覆盖产品功能域。下表按域归类：

| 功能域 | 模块文档 | 对应代码位置 |
| --- | --- | --- |
| **Agent 运行** | `agent` / `runtime` / `task` / `incident` | `backend/app/modules/agent|runtime|task|incident/` |
| **Daemon** | `daemon` / `worktree` | `sillyhub-daemon/src/` + `backend/app/modules/daemon/` |
| **SillySpec 工作区** | `spec_workspace` / `spec_profile` / `change` / `change_writer` / `workflow` / `archive` / `knowledge` / `scan_docs` | `backend/app/modules/spec_workspace|spec_profile|change|change_writer|workflow|archive|knowledge|scan_docs/` |
| **PPM 项目域** | `ppm` | `backend/app/modules/ppm/` + `frontend/src/lib/ppm/` |
| **Git / 工具网关** | `git_gateway` / `git_identity` / `tool_gateway` | `backend/app/modules/git_gateway|git_identity|tool_gateway/` |
| **用户与权限** | `auth` / `settings` / `workspace` | `backend/app/modules/auth|settings|workspace/` + `frontend/src/lib/auth.ts` |
| **基础设施** | `core` / `health` / `models` / `release` / `admin` | `backend/app/core/` + `backend/app/modules/health|release|admin/` |
| **前端** | `frontend_app` / `frontend_components` / `frontend_lib` / `frontend_stores` | `frontend/src/app|components|lib|stores/` |
| **文档索引** | `_module-map.yaml` / `scan_docs` | 模块总映射 + scan 产物 |

## 5. scan 文档分布

- SillyHub 产品根 scan：`.sillyspec/docs/SillyHub/scan/`（本目录，产品/功能视角）。
- `multi-agent-platform` 同根工程结构视角：`.sillyspec/docs/multi-agent-platform/scan/`。
- 各子项目 scan：`.sillyspec/docs/<backend|frontend|sillyhub-daemon>/scan/`。
- 跨子项目协调与变更流程参见 `.sillyspec/changes/`（36 项）、根 `AGENTS.md`、`.claude/CLAUDE.md`。
