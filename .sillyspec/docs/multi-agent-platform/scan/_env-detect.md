---
author: qinyi
created_at: 2026-08-18T01:04:33
source_commit: ba87eec
---

# 构建环境探测（临时文件，扫描完删除）

> 本次 scan 范围（用户确认）：SillyHub（根）+ backend + frontend + sillyhub-daemon，共 4 个；跳过 multi-agent-platform 根命名空间。

## 1. SillyHub（根，path: "."）

- 顶层 Makefile（跨平台：Linux/macOS + Windows Git Bash），目标分三组：
  - dev：`dev-up/dev-down/dev-logs/dev-reset`（`deploy/docker-compose.dev.yml` 起 postgres + redis）
  - backend：`backend-install`(uv) / `backend-run`(reload) / `backend-test`(pytest) / `backend-lint`(ruff+mypy) / `backend-format` / `backend-migrate`(alembic)
  - frontend：`frontend-install`(pnpm) / `frontend-run` / `frontend-test`(vitest) / `frontend-lint` / `frontend-typecheck` / `frontend-build`
  - 聚合：`test` / `lint` / `up` / `down` / `logs`（`deploy/docker-compose.yml` 生产栈）
- `deploy/`：docker-compose.yml（生产）、docker-compose.dev.yml（开发依赖）、litellm-config.yaml（LLM 网关）
- 根目录无 package.json / pyproject.toml（纯编排层）

## 2. backend（multi-agent-platform-api）

- `pyproject.toml`：Python ≥3.12，hatchling 构建
- 运行时依赖：fastapi/uvicorn/pydantic-v2/sqlmodel/sqlalchemy[asyncio]/asyncpg/alembic/redis/structlog/python-jose/passlib/pynacl/httpx/python-frontmatter/openpyxl/Pillow/python-multipart/psutil/aiobotocore（S3 对象存储）/mcp>=1.29,<2（官方 MCP SDK v1 线，锁 <2 因 v2 移除 FastMCP breaking）
- dev 依赖：pytest/pytest-asyncio/pytest-cov/pytest-xdist（并行）/pytest-rerunfailures（CI flaky 兜底）/ruff/mypy/anyio/aiosqlite
- 配置：`alembic.ini`（迁移）、`ruff.toml`、`conftest.py`；pytest/mypy/ruff 配置在 pyproject.toml `[tool.*]` 段
- 包管理：uv（Makefile backend-install 用 uv sync）

## 3. frontend（multi-agent-platform-web）

- `package.json`：Next.js 14.2.5 + React 18 + TypeScript
- UI 栈：antd v5 + @ant-design/icons + radix-ui（dialog/dropdown/avatar）+ tailwindcss + tailwindcss-animate + cva + clsx + lucide-react
- 数据/状态：@tanstack/react-query + zustand + zod + @tanstack/react-virtual
- 可视化/渲染：echarts + echarts-for-react + @xyflow/react（流程图）+ @uiw/react-markdown-preview + rehype-sanitize
- scripts：dev/build/start/lint(next lint)/typecheck(tsc --noEmit)/test(vitest run)/gen:types(openapi-typescript 从后端 OpenAPI 生成 api-types.ts，含 gen:types:check 防漂移)
- 配置：next.config.mjs、tailwind.config.ts、postcss.config.mjs、tsconfig.json、vitest.config.ts、components.json（shadcn）
- dev 工具含 @playwright/test + puppeteer（E2E/截图）
- 包管理：pnpm

## 4. sillyhub-daemon（sillyhub-daemon）

- `package.json`：Node.js CLI，TypeScript（tsc 构建 → dist/cli.js）
- 依赖：@anthropic-ai/claude-agent-sdk 0.3.181、@modelcontextprotocol/sdk ^1.29、commander（CLI）、js-yaml、ws（WebSocket 连平台）、zod v4
- scripts：dev(tsc --watch)/build(tsc)/typecheck/test(vitest --passWithNoTests)/start(node dist/cli.js)/bundle(scripts/build-bundle.sh)/gen:types(自有 api-types 生成，含 check)/prebuild+postinstall(gen-build-id.mjs)
- 配置：tsconfig.json、vitest.config.ts、vitest.spikes.config.ts（spike 专用测试配置）

## 环境摘要（横切）

| 项目 | 语言/运行时 | 包管理 | 构建 | 测试 | Lint/类型 |
|---|---|---|---|---|---|
| 根(SillyHub) | —（编排） | — | Makefile + docker compose | make test 聚合 | make lint 聚合 |
| backend | Python ≥3.12 | uv | hatchling | pytest（xdist 可选） | ruff + mypy |
| frontend | TypeScript | pnpm | next build | vitest | next lint + tsc |
| sillyhub-daemon | TypeScript | npm | tsc | vitest（--passWithNoTests） | tsc --noEmit |
