---
source_commit: fcbf3fa7
updated_at: 2026-06-22T17:56:21Z
generator: sillyspec-scan
author: qinyi
created_at: 2026-06-23 01:56:21
---

# multi-agent-platform — 项目结构（根 monorepo）

> 本文档由 `sillyspec-scan` 在 `fcbf3fa7` 处自动扫描根 monorepo 生成。
> path = `.`（仓库根），包含 backend / frontend / sillyhub-daemon 三个子项目。

## 1. 顶层布局

```
multi-agent-platform/                # monorepo 根
├── .claude/                          # 项目约定：CLAUDE.md + hooks + skills + worktrees
├── .sillyspec/                       # SillySpec 变更 / 扫描文档 / 知识库 / 工作流
├── backend/                          # FastAPI + Python 3.12 + SQLModel 后端 API
├── frontend/                         # Next.js 14 + React 18 + TS Web 前端
├── sillyhub-daemon/                  # 本地守护进程（Node ≥20 ESM），管 Claude Agent SDK 进程
├── deploy/                           # Docker Compose 编排（full + dev）
├── scripts/                          # 辅助脚本（如 migrate_scan_docs.py）
├── docs/                             # 项目级设计文档 / QA / 参考资料
├── spikes/                           # 技术探针（01-git-isolation ~ 05-mission-e2e）
├── Makefile                          # 常用命令（make up / test / lint 等）
├── README.md                         # 项目总览
├── AGENTS.md                         # Agent 行为约定
├── package.json                      # 根 package（仅声明子项目聚合）
├── .env                              # 本地环境变量
├── .editorconfig / .gitignore
└── .github/                          # CI 配置
```

## 2. 各顶层目录职责

| 目录 | 角色 | 关键内容 |
| --- | --- | --- |
| `backend/` | **API 后端**：FastAPI 应用、领域模块、迁移、测试 | `app/`（含 modules/agent、modules/daemon、modules/spec_workspace、modules/workspace、modules/health 等子模块）、`migrations/`（alembic）、`pyproject.toml`（Python 3.12）、`Dockerfile`、`docker-entrypoint.sh`、`hooks/`、`tests/`、`create_tables.py` |
| `frontend/` | **Web 前端**：Next.js 14 App Router + React 18 + Ant Design + Tailwind | `src/`（页面/组件）、`public/`、`next.config.mjs`、`tailwind.config.ts`、`tsconfig.json`、`vitest.config.ts`、`Dockerfile`、`package.json`（pnpm@9.6.0） |
| `sillyhub-daemon/` | **本地守护进程**：Node ≥20 ESM 单进程，通过 `@anthropic-ai/claude-agent-sdk` 驱动 Claude 子进程，提供交互式会话与任务执行 | `src/`（daemon.ts、cli.ts、interactive/、adapters/、spawn-env.ts、workspace.ts）、`dist/`、`tests/`、`tsconfig.json`、`vitest.config.ts`、`package.json` |
| `deploy/` | **Docker 编排**：全栈与服务依赖声明 | `docker-compose.yml`（postgres + redis + backend + frontend）、`docker-compose.dev.yml`（仅 postgres + redis） |
| `scripts/` | **辅助脚本**：一次性维护工具 | `migrate_scan_docs.py`（scan 文档迁移） |
| `docs/` | **项目级设计文档**：跨子项目的方案与参考资料 | `change-center-redesign.md`、`claude-loop-v1-p0.md`、`execution-plan-v2-v5.md`、`spec-alignment.md`、`agent-sillyspec-stage-execution-analysis.md`、`sillyspec-tool-side-requirements.md`、`qa/`、`sillyhub_refs/` |
| `spikes/` | **技术探针**：独立可行性验证（每个 spike 一个目录） | `01-git-isolation/`、`02-workspace-scan/`、`03-claude-code/`、`04-delegate-task/`、`05-mission-e2e/`、`README.md`、`REPORT.md` |
| `.sillyspec/` | **SillySpec 工作区**：变更生命周期与产物 | `changes/`（变更目录）、`docs/`（scan/模块文档）、`knowledge/`、`projects/`、`quicklog/`、`workflows/`、`sillyspec.db` |
| `.claude/` | **项目约定与技能**：Claude Code 行为配置 | `CLAUDE.md`（硬性规则）、`hooks/`、`settings.json`、`skills/`、`worktrees/` |

## 3. 子项目顶层速览

### 3.1 backend/
```
app/                # 应用主体（core/ + modules/<domain>/）
migrations/         # alembic 版本
hooks/              # git / CI hook 资源
scripts/            # 后端内部脚本
tests/              # 顶层集成测试
pyproject.toml      # Python 3.12 依赖（fastapi/sqlmodel/asyncpg/redis/alembic/...）
alembic.ini         # 迁移配置
Dockerfile          # 生产镜像
docker-entrypoint.sh
create_tables.py    # 建表工具
```

### 3.2 frontend/
```
src/                # 页面与组件（App Router）
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
  ├── interactive/       # 交互式 Claude 会话（session-manager / claude-sdk-driver / input-queue / types）
  ├── adapters/          # 协议适配（stream-json / json-rpc / jsonl / ndjson / protocol-adapter）
  ├── task-runner.ts     # 一次性任务执行
  ├── workspace.ts       # 工作目录解析
  └── spawn-env.ts       # 子进程环境构建
dist/               # 编译产物
tests/              # vitest 套件
package.json        # ESM / pnpm / @anthropic-ai/claude-agent-sdk@0.3.181 / ws / commander
tsconfig.json
```

## 4. 模块映射（根级 → 文档位置）

- 本根 monorepo 的 scan 文档输出到：`.sillyspec/docs/multi-agent-platform/scan/`
- 各子项目（backend / frontend / sillyhub-daemon）的 scan 文档输出到对应 `.sillyspec/docs/<project>/scan/`。
- 跨子项目的协调与变更流程参见 `.sillyspec/changes/` 与根 `AGENTS.md`、`.claude/CLAUDE.md`。
