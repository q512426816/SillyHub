---
schema_version: 1
doc_type: module-card
module_id: build
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 构建与容器配置（build）

## 定位
backend 的构建、依赖、容器化与代码风格配置集合：`pyproject.toml`（项目元数据 + 依赖 + hatchling 构建 + ruff/pytest/mypy 配置）、`Dockerfile`（多阶段镜像，含 node 工具链与 daemon 分发物注入）、`alembic.ini`（迁移配置，详见 migrations 卡片）、`ruff.toml`（子目录兜底）。迁移脚本本身（migrations/）不归本卡。

## 契约摘要
- `pyproject.toml`：项目名 `multi-agent-platform-api`，requires-python ≥3.12，PEP 621 + hatchling（wheel 只打包 `app`）。
  - 核心依赖：fastapi/uvicorn[standard]/pydantic-settings/sqlmodel/asyncpg/alembic/redis/structlog/python-jose/passlib/pynacl/httpx/aiobotocore（S3）/`mcp>=1.29,<2`（锁 v1 线，v2 移除 FastMCP 属 breaking）等。
  - dev extra（pytest/pytest-asyncio/pytest-xdist/pytest-rerunfailures/ruff/mypy/aiosqlite）+ `[dependency-groups]` dev（mypy/pre-commit/pymysql/ruff）。
  - pytest：asyncio_mode=auto、`addopts = "-o dist=loadscope"`（xdist 按模块分组到 worker，消除跨模块状态污染 flaky）、testpaths 覆盖 `tests` 与 `app`（模块内单测）。
  - ruff：line-length 100、target py312、select E/F/I/B/UP/N/SIM/RUF/BLE + 定向 ignore（中文串 RUF001-003、裸 except BLE001、B008 FastAPI 默认参数等）；per-file-ignores 豁免 tests 与 migrations/versions UP035。
  - mypy：py312 非 strict、pydantic 插件、disable_error_code 定向豁免、禁中文 `# type:ignore`。
- `Dockerfile`（多阶段）：node-tools（node:20-slim 装 `@anthropic-ai/claude-code`（pin）+ `sillyspec`（可 pin，npmmirror 源））→ builder（uv 0.4.18 建 /opt/venv + `uv pip install -e .` + alembic，清华源）→ runtime（python:3.12-slim + git/curl + node 与 claude/sillyspec 软链 + /opt/venv + 源码；额外注入 daemon 分发物（sillyhub-daemon.js/mcp-server.js/install.sh/install.ps1，additional context "daemon"）与 sillyspec skills（context "skills" → /app/sillyspec-skills）；非 root `app` 用户；`COMMIT_SHA` build arg → ENV；EXPOSE 8000；healthcheck 打 `/api/health`；ENTRYPOINT docker-entrypoint.sh（迁移+启动），CMD uvicorn）。
- `alembic.ini`：`script_location = migrations`，`sqlalchemy.url` 留空由 env.py 注入。
- `ruff.toml`：`extend = "pyproject.toml"`——子目录跑 ruff 也用同一份配置。

## 关键逻辑
```
# Dockerfile 要点:
# apt 源换清华 tuna(国内网络), install.sh 去 CR(LF)/install.ps1 补 CR(CRLF)
# sillyspec-skills 拷到 /app/sillyspec-skills(非 volume 路径), entrypoint 软链
# 到 /app/.claude/skills 供容器内 claude 使用
# CMD uvicorn app.main:app --host 0.0.0.0 --port 8000
```

## 注意事项
- `mcp` 依赖锁 `>=1.29,<2`：v2.0.0 移除 FastMCP 是 breaking，升级前必须核对 mcp_gateway 的 mount 写法。
- Dockerfile 有三个 additional context：`daemon`（分发物）、`skills`（sillyspec skills）；缺 context 构建直接失败。
- 本地 rebuild 镜像注意：传 `COMMIT_SHA` build arg 会让 runtime apt 层 cache-miss（历史踩坑）；不传即缓存命中。Docker 内代码不热重载，改后端源码需 rebuild。
- 容器内 healthcheck 打 `/api/health`；Docker 注入的 http_proxy 可能让探针误报 unhealthy（服务实际正常）。
- uv 安装当前 lock-less（注释提示后续切 `uv sync --frozen`）；README.md 必须与 pyproject 同在 build context（long_description 引用）。
- 提交时 Local CI hook 会跑 backend ruff format/mypy，未过会被拦；格式化用 backend venv 内 ruff。
- 改 pytest addopts/loadscope 语义会影响并行全量稳定性（loadscope 是为消 flaky 特意选的，勿回退 load）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
