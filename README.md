# 多智能体协作管理平台 — SillySpec Native 搭建文档包 v2

这是一套按 **SillySpec 真实变更包结构** 组织的平台搭建文档，不再使用理想化的 `/requirements、/plans、/tasks` 目录。

核心定位：

> 平台不是重新定义 SillySpec，而是把 `.sillyspec` 的真实目录、变更包、项目组组件、运行态、知识库和 Git 执行边界，产品化成多人、多项目、多 Agent 的全生命周期执行管理系统。

## 入口

```text
2026-05-25-multi-agent-platform-bootstrap-v2/
  MASTER.md
  proposal.md
  requirements.md
  design.md
  plan.md
  tasks.md
  verification.md
  tasks/
  references/
```

## 本版重点修正

1. `.sillyspec/projects/*.yaml` 不是项目列表，而是 **项目组成员 / 关联项目组件配置**。
2. 一个 `.sillyspec` 根目录是一个 **Workspace**。
3. `changes/change` 和 `changes/archive` 是 **Workspace 级变更管理**，一个变更可以影响多个组件。
4. `docs/{component}/scan` 是 **组件级扫描认知**。
5. `.runtime` 是本地运行态，不是长期事实源。
6. 新增 **Git Identity、Credential、Worktree Lease、Git Tool Gateway**，解决单服务器部署下多人只能控制自己的 Git 的问题。

## 推荐阅读顺序

1. `MASTER.md`
2. `proposal.md`
3. `requirements.md`
4. `design.md`
5. `references/02-lifecycle-from-requirement-to-deployment.md`
6. `references/04-git-identity-and-worktree-isolation.md`
7. `references/15-authentication.md`
8. `references/16-rbac.md`
9. `references/17-db-schema.md`
10. `references/18-error-recovery.md`
11. `plan.md`
12. `tasks.md` + `tasks/task-01.md`（task 模板）

## 技术栈（已锁定）

```text
后端：FastAPI (Python 3.12) + SQLModel + Alembic
前端：Next.js 14 App Router + TypeScript + shadcn/ui + TanStack Query + Zustand
数据库：PostgreSQL 16（开启 pgvector / RLS）
缓存：Redis 7
Git：libgit2 / subprocess + 自研 Git Tool Gateway
凭据加密：libsodium secretbox (PyNaCl)，主密钥外部注入
监控：OpenTelemetry SDK
部署：Docker Compose 单机起步
Agent：subprocess + 自研 Adapter，首发 Claude Code
```

## 开工前必跑：V0 Spikes

```text
spikes/
  01-git-isolation/    # 多用户 Git 凭据隔离（最关键）
  02-workspace-scan/   # SillySpec 解析可用性
  03-claude-code/      # Claude Code 子进程可控性
```

**任一 spike 不通过，V1 必须暂停**。详见 `spikes/README.md` 与 `spikes/REPORT.md`。

当前状态：**3/3 PASS（2026-05-25）**，V1 前置门禁已解除。

## 30 分钟跑通本地开发环境

> 目标：在一台干净机器上，30 分钟内启动 `前端 → 后端 → Postgres → Redis` 全链路，访问 `localhost:3000` 看到"后端健康: ok"。

### 0. 前置工具

| 工具 | 版本 | 用途 |
| ---- | ---- | ---- |
| Docker Desktop / Engine | ≥ 24 | 起 Postgres + Redis（及完整容器化部署） |
| Python | 3.12 | 后端 |
| [`uv`](https://github.com/astral-sh/uv) | ≥ 0.4 | 替代 pip/poetry，速度快 |
| Node.js | 20 | 前端 |
| pnpm | 9 | 前端包管理 |
| Git | ≥ 2.40 | 必须 |

Windows 用户：用 Git Bash 或 PowerShell 7 都可；Makefile 在 Git Bash 下兼容性更好。

### 1. 克隆并起依赖

```bash
git clone <your-fork-url> multi-agent-platform
cd multi-agent-platform

cp deploy/.env.example deploy/.env       # 至少把 SECRET_KEY 改成随机串
make dev-up                              # 启动 Postgres + Redis（仅依赖）
```

### 2. 起后端

```bash
cd backend
cp .env.example .env                     # DATABASE_URL/REDIS_URL 与 deploy/.env 对齐
uv sync --all-extras                     # 装依赖
uv run alembic upgrade head              # 建 _health_probe 表
uv run uvicorn app.main:app --reload --port 8000

# 验证
curl http://localhost:8000/api/health
# => {"status":"ok","db":"ok","redis":"ok",...}
```

### 3. 起前端

```bash
cd frontend
cp .env.example .env.local               # 默认指向 http://localhost:8000
pnpm install
pnpm dev                                 # http://localhost:3000
```

打开 `http://localhost:3000`，看到"平台健康"卡片上有绿色 "后端健康: ok" 徽章即成功。

### 4. 全链路容器化（可选，对应 AC-01）

```bash
make up                                  # docker compose -f deploy/docker-compose.yml up --build
# 浏览器访问 http://localhost:3000
make down
```

### 5. 测试 / 校验

```bash
make test          # 后端 pytest + 前端 vitest
make lint          # 后端 ruff/mypy + 前端 eslint
```

## 仓库结构

```text
multi-agent-platform/
├─ backend/                              # FastAPI app（详见 backend/README.md）
├─ frontend/                             # Next.js 14 app
├─ deploy/                               # docker-compose 文件 + .env 模板
├─ .github/workflows/                    # CI（backend-ci / frontend-ci）
├─ spikes/                               # V0 风险验证脚本 + REPORT.md
├─ 2026-05-25-multi-agent-platform-bootstrap-v2/    # SillySpec 当前变更包
│  ├─ MASTER.md / proposal / requirements / design / plan / tasks / verification
│  ├─ tasks/                             # 16 个 task 详单
│  └─ references/                        # 18 篇参考文档
├─ .sillyspec/                           # SillySpec 工作区元数据
├─ Makefile / .editorconfig / .gitignore
└─ README.md
```

## 如何贡献一个新 task

1. 在 `2026-05-25-...-v2/tasks/` 新建 `task-NN.md`，**严格按 `task-01.md` 的 1~6 节模板**：
   - 第 1 节"目标" ≤ 5 行，必须列"不在范围"
   - 第 2 节"输入"列具体文件路径
   - 第 3 节"产出"必须有：文件清单 / API / DB schema / 命令 / 配置
   - 第 4 节"验收"每条可点击验证（不要写"功能可演示"这种）
   - 第 5 节"风险"必须列具体对策
   - 第 6 节"DoD"用 checkbox
2. 在 `tasks.md` 的总表里追加一行（priority / phase / estimated_hours / depends_on）。
3. 提 PR，至少一人 Review 后合入。

## 如何加一个新业务模块（backend）

后端按"vertical slice"组织 —— 每个业务功能是一个独立目录：

```
backend/app/modules/<feature>/
├─ __init__.py
├─ router.py        # APIRouter
├─ schema.py        # Pydantic 输入/输出模型
├─ service.py       # 业务逻辑（无 HTTP / DB session 注入由 router 完成）
├─ models.py        # SQLModel 表（如有）
└─ tests/           # 紧挨业务代码（也可统一放 backend/tests/）
```

落到代码上需要做的 5 件事：

1. 新增 `app/modules/<feature>/` 目录，至少写 `router.py + schema.py`
2. 在 `app/main.py` 里 `app.include_router(your_router, prefix="/api")`
3. 如有新表：
   - 在 `app/modules/<feature>/models.py` 写 SQLModel 类（继承 `BaseModel`）
   - `cd backend && uv run alembic revision --autogenerate -m "create xxx"`
   - 检查生成的 migration（**永远不要直接提交未审查的 autogenerate**）
4. 在 `backend/tests/` 加测试，覆盖率不低于既有水位
5. 跑 `make backend-lint backend-test` 全绿后再提 PR

## 如何加一个新前端页面

1. 在 `frontend/src/app/<route>/page.tsx` 新建路由（App Router 约定）
2. 共享 UI 组件放 `src/components/`，shadcn 组件统一放 `src/components/ui/`
3. API 调用统一走 `src/lib/api.ts`，禁止直接 `fetch`
4. 全局状态用 Zustand（`src/stores/`），服务端状态用 TanStack Query
5. 跑 `make frontend-lint frontend-typecheck frontend-test frontend-build`

## 常见问题

- **`asyncpg` 在 Windows 装不上**：用 docker compose 起 Postgres，本地后端连容器即可；或临时 fallback `psycopg[binary]`。
- **`pnpm: command not found`**：装 Node 20 后 `corepack enable pnpm`。
- **`make` 在 Windows 没有**：装 Git for Windows 后用 Git Bash；或直接照搬 Makefile 里的命令手跑。
- **/api/health 返回 `db: down`**：检查 `DATABASE_URL` 是否指向已 `make dev-up` 的 Postgres，以及是否跑过 `alembic upgrade head`。
