---
id: task-06
title: 'CI workflow: e2e-ci.yml'
title_zh: 'CI e2e job（.github/workflows/e2e-ci.yml）'
author: 'qinyi'
created_at: 2026-08-29 14:55:00
priority: P0
depends_on: ['task-01', 'task-03', 'task-04']
blocks: ['task-08']
requirement_ids: [FR-07]
decision_ids: [D-004@v1, D-007@v1, D-008@v1]
allowed_paths:
  - .github/workflows/e2e-ci.yml
goal: >
  新增 GitHub Actions e2e job：services postgres:16 + redis:7 → backend（uvicorn，限流 60 +
  bootstrap admin + health status=="ok" 轮询）→ frontend（pnpm build + next start :3000）→
  playwright chromium → pnpm test:e2e → 失败上传 trace/report artifact（design §5.2，FR-07）。
implementation:
  - 触发 on.push/on.pull_request paths [frontend/**, .github/workflows/e2e-ci.yml] + workflow_dispatch（D-007@v1：backend 变更不触发）；timeout-minutes 20
  - services：postgres:16-alpine（env POSTGRES_PASSWORD=postgres、ports 5432:5432、health pg_isready -U postgres）、redis:7-alpine（ports 6379:6379、health redis-cli ping）；options --health-retries 10
  - 步骤：checkout → pnpm/action-setup@v4（pnpm 9.6.0）→ actions/setup-node@v4（node 20，cache pnpm，cache-dependency-path frontend/pnpm-lock.yaml）→ cd frontend && pnpm install --frozen-lockfile → astral-sh/setup-uv + uv python install 3.12 + cd backend && uv sync --all-extras → 起 backend（env：DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/postgres、REDIS_URL=redis://localhost:6379/0、SECRET_KEY（≥16 字符）、PLATFORM_BOOTSTRAP_ADMIN_EMAIL/PASSWORD（避开弱口令黑名单 config.py:502-524，须含字母数字）、AUTH_LOGIN_RATE_LIMIT_PER_MINUTE=60（D-008@v1）、CORS_ALLOWED_ORIGINS=["http://localhost:3000"]；uv run uvicorn app.main:app --port 8000 后台 + 轮询 curl http://localhost:8000/api/health 校验 body status=="ok"，超时 90s）→ cd frontend && pnpm build（INTERNAL_API_BASE_URL=http://localhost:8000）&& pnpm start 后台（等 3000 端口就绪）→ pnpm exec playwright install --with-deps chromium → E2E_BOOTSTRAP_* env 下 pnpm test:e2e
  - 失败时 always()/if: failure() 上传 frontend/playwright-report/ 与 frontend/test-results/ artifact（retention 7 天）
  - 写法对齐现有 frontend-ci.yml / backend-ci.yml 习惯（action 版本、defaults.run）
acceptance:
  - workflow YAML 语法有效（actionlint 或 GH 解析通过）
  - push 到分支触发首跑绿（与 task-08 联动验收）
verify:
  - yaml 解析检查（nodejs yaml 或 actionlint 如可用）
  - 实际 push 触发首跑（task-08 内收口）
constraints:
  - 只新增 .github/workflows/e2e-ci.yml 一个文件
  - next start 用生产形态（D-004@v1），不用 dev server
  - 健康轮询校验 body status=="ok"（恒 200 不足以证明 db/redis 就绪）
  - Windows 本机不执行此 workflow（CI ubuntu-latest）；后台进程用 shell & + 轮询就绪模式
---
