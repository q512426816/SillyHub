---
id: task-01
title: 初始化平台仓库与基础工程
phase: V1
priority: P0
status: draft
owner: qinyi
estimated_hours: 16
affected_components:
  - platform-web
  - platform-api
allowed_paths:
  - frontend/
  - backend/
  - deploy/
  - .github/
  - Makefile
  - README.md
depends_on: []
blocks:
  - task-02
  - task-03
---

## 1. 目标

建立平台前后端工程骨架，跑通 `前端 → 后端 → Postgres / Redis` 最小回路。

**不在范围**：

- 业务逻辑（Workspace / Component / Change 解析在 task-02 ~ task-08）
- Git Identity / Worktree（task-09 / task-10）
- 认证业务逻辑（仅留接口骨架，详见 references/15）

## 2. 输入

- `MASTER.md`
- `design.md` §1 总体架构、§9 技术选型
- `references/10-storage-and-indexing.md`
- `references/11-deployment-single-server.md`
- `references/15-authentication.md`
- `references/17-db-schema.md`

## 3. 产出清单

### 3.1 仓库结构（必须严格按此创建）

```text
multi-agent-platform/
├─ frontend/
│  ├─ src/
│  │  ├─ app/
│  │  │  ├─ (auth)/login/page.tsx
│  │  │  ├─ (dashboard)/layout.tsx
│  │  │  ├─ layout.tsx
│  │  │  └─ page.tsx                  # 健康页
│  │  ├─ components/ui/               # shadcn 初始化
│  │  ├─ lib/api.ts                   # fetch 封装
│  │  └─ stores/                      # zustand
│  ├─ package.json
│  ├─ next.config.mjs
│  ├─ tsconfig.json
│  ├─ tailwind.config.ts
│  ├─ components.json                 # shadcn
│  ├─ .env.example
│  └─ Dockerfile
├─ backend/
│  ├─ app/
│  │  ├─ __init__.py
│  │  ├─ main.py                      # FastAPI 入口
│  │  ├─ core/
│  │  │  ├─ config.py                 # Pydantic Settings
│  │  │  ├─ db.py                     # async engine + session
│  │  │  ├─ redis.py                  # aioredis
│  │  │  ├─ logging.py                # structlog
│  │  │  ├─ telemetry.py              # OpenTelemetry init（V1 可空实现）
│  │  │  └─ errors.py                 # 统一异常拦截器
│  │  ├─ modules/
│  │  │  ├─ __init__.py
│  │  │  └─ health/
│  │  │     ├─ __init__.py
│  │  │     ├─ router.py              # GET /api/health
│  │  │     └─ schema.py
│  │  └─ models/
│  │     ├─ __init__.py
│  │     └─ base.py                   # SQLModel base
│  ├─ migrations/                     # Alembic
│  │  ├─ env.py
│  │  ├─ script.py.mako
│  │  └─ versions/
│  ├─ tests/
│  │  ├─ conftest.py
│  │  └─ test_health.py
│  ├─ alembic.ini
│  ├─ pyproject.toml                  # uv / poetry
│  ├─ ruff.toml
│  ├─ .env.example
│  └─ Dockerfile
├─ deploy/
│  ├─ docker-compose.yml              # 全栈
│  ├─ docker-compose.dev.yml          # 仅依赖（pg / redis）
│  └─ .env.example
├─ .github/workflows/
│  ├─ backend-ci.yml                  # ruff + mypy + pytest
│  └─ frontend-ci.yml                 # eslint + tsc + vitest + build
├─ Makefile
├─ .editorconfig
├─ .gitignore
└─ README.md
```

### 3.2 必须可运行的命令

```bash
# 启动依赖
make dev-up                # docker compose -f deploy/docker-compose.dev.yml up -d

# 后端
cd backend
uv venv && . .venv/Scripts/activate    # Windows; Linux: source .venv/bin/activate
uv pip install -e .
alembic upgrade head
uvicorn app.main:app --reload --port 8000

# 前端
cd frontend
pnpm install
pnpm dev                                # localhost:3000

# 测试
make test                               # 前后端测试一并跑

# 完整容器化
docker compose -f deploy/docker-compose.yml up --build
```

### 3.3 API 必须实现

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 返回 `{status, db, redis, version, commit_sha, server_time, environment}` |
| GET | `/api/version` | 返回构建信息（同上 subset） |

`/api/health` 返回示例：

```json
{
  "status": "ok",
  "db": "ok",
  "redis": "ok",
  "version": "0.1.0",
  "commit_sha": "abcd1234",
  "server_time": "2026-05-25T14:00:00Z",
  "environment": "dev"
}
```

任意依赖不可用时对应字段返回 `"down"`，整体 `status="degraded"`，HTTP 仍 200（让 LB 不要直接摘除）。

### 3.4 数据库 Schema（仅本任务）

```sql
CREATE TABLE IF NOT EXISTS _health_probe (
    id SERIAL PRIMARY KEY,
    probed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

Alembic migration 在 `backend/migrations/versions/`，文件名 `202605251400_create_health_probe.py`，必须可 `downgrade`。

### 3.5 配置规范

后端用 Pydantic Settings：

```python
class Settings(BaseSettings):
    database_url: str
    redis_url: str
    secret_key: str
    log_level: str = "INFO"
    environment: Literal["dev", "test", "prod"] = "dev"
    cors_allowed_origins: list[str] = ["http://localhost:3000"]
    otel_endpoint: str | None = None

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
```

前端：

```ts
NEXT_PUBLIC_API_BASE_URL="http://localhost:8000"
```

`.env.example` 必须列全所有可配项，**严禁提交真实密钥**。

### 3.6 关键依赖锁定

`backend/pyproject.toml`：

```toml
[project]
name = "multi-agent-platform-api"
version = "0.1.0"
requires-python = ">=3.12"
dependencies = [
  "fastapi>=0.115",
  "uvicorn[standard]>=0.30",
  "pydantic>=2.8",
  "pydantic-settings>=2.4",
  "sqlmodel>=0.0.22",
  "asyncpg>=0.29",
  "alembic>=1.13",
  "redis>=5.0",
  "structlog>=24.4",
  "python-jose[cryptography]>=3.3",
  "passlib[bcrypt]>=1.7",
  "pynacl>=1.5",
  "httpx>=0.27",
]

[project.optional-dependencies]
dev = ["pytest>=8", "pytest-asyncio>=0.23", "ruff>=0.6", "mypy>=1.11"]
```

`frontend/package.json` 关键依赖：

```json
{
  "dependencies": {
    "next": "14.2.5",
    "react": "18.3.1",
    "react-dom": "18.3.1",
    "@tanstack/react-query": "^5.51.0",
    "zustand": "^4.5.0",
    "zod": "^3.23.0",
    "class-variance-authority": "^0.7.0",
    "tailwind-merge": "^2.4.0",
    "lucide-react": "^0.400.0"
  },
  "devDependencies": {
    "typescript": "5.5.4",
    "@types/node": "20.14.0",
    "@types/react": "18.3.3",
    "eslint": "9.7.0",
    "eslint-config-next": "14.2.5",
    "tailwindcss": "3.4.7",
    "vitest": "^2.0.0"
  }
}
```

### 3.7 CI 必须通过

`.github/workflows/backend-ci.yml`：

- `ruff check .`
- `ruff format --check .`
- `mypy app`
- `pytest -q --cov=app --cov-fail-under=60`

`.github/workflows/frontend-ci.yml`：

- `pnpm lint`
- `pnpm typecheck`
- `pnpm test --run`
- `pnpm build`

## 4. 验收标准（每条可点击验证）

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `docker compose up --build` 后访问 `localhost:3000` | 看到"后端健康: ok"绿色徽章 |
| AC-02 | `docker stop` Postgres，刷新前端 | 显示"db: down"红色徽章，前端不崩 |
| AC-03 | `curl localhost:8000/api/health` | 返回 200，JSON 含 `commit_sha`、`environment` |
| AC-04 | `alembic downgrade base && alembic upgrade head` | 无错，`_health_probe` 表被重建 |
| AC-05 | 后端 `pytest` | 全部通过，覆盖率 ≥ 60% |
| AC-06 | 前端 `pnpm build` | 无 type error，首屏产物 ≤ 5MB gzip |
| AC-07 | `make lint` | 0 error，0 warning |
| AC-08 | GitHub Actions 两个 workflow | 全绿 |
| AC-09 | `.env.example` 完整 | 含全部 Settings 字段，且不含真实值 |
| AC-10 | README | 新人按 README 30 分钟内本地跑通 |

## 5. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Windows 路径处理 | 后续 worktree 任务踩坑 | 全程 pathlib.Path，禁用字符串拼接 |
| asyncpg 在 Windows 编译失败 | 开发者起不来 | 默认走 docker compose 提供 pg；如本机直跑则 fallback psycopg3 |
| Next.js App Router 与 shadcn SSR 兼容 | 首屏白屏 | 严格按 shadcn init 默认配置；不要在 layout.tsx 调浏览器 API |
| AI 写代码引入未声明依赖 | CI 红 | 后端 uv lock；前端 pnpm-lock 强校验 |
| pydantic v2 迁移坑 | 序列化报错 | 全部用 `model_*` 命名，禁用 v1 API |

## 6. 完成定义（DoD）

- [ ] 10 个 AC 全部通过，附验证截图或日志
- [ ] CI 全绿
- [ ] README 中加入"如何贡献 task"、"如何加新模块"两节
- [ ] `verification.md` 追加 task-01 验证记录
- [ ] `.runtime/progress.json` 写入完成时间
- [ ] 提 PR，由 Workspace Owner Review 通过

## 7. 后续 task 模板规则

本 task 文档结构（1~6 节）是后续所有 task 的模板。每个新 task 必须：

- 第 1 节"目标" ≤ 5 行，必须列"不在范围"
- 第 2 节"输入" 列具体文件路径
- 第 3 节"产出" 必须有文件清单 / API / DB / 命令
- 第 4 节"验收" 每条可点击验证，禁止"功能可演示"这种笼统话
- 第 5 节"风险" 必须列对策
- 第 6 节"DoD" 用 checkbox
