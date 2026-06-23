---
schema_version: 1
doc_type: module-card
module_id: build
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:09:00
---
# build

## 定位
backend 的构建、依赖、容器化与代码风格配置集合。包含 pyproject.toml（项目元数据 + 依赖 + hatchling 构建 + ruff/pytest/mypy 配置）、Dockerfile（多阶段镜像）、alembic.ini（迁移配置，详见 migrations 卡片）、ruff.toml（ruff 兜底配置）。

## 契约摘要
- `pyproject.toml` — 项目名 `multi-agent-platform-api`，version 0.1.0，requires-python ≥3.12
  - 核心依赖：fastapi≥0.115、uvicorn[standard]、sqlmodel≥0.0.22、asyncpg≥0.29、alembic≥1.13 等
  - dev 依赖：pytest/pytest-asyncio/pytest-cov/ruff
  - build-backend = `hatchling.build`；`[tool.hatch.build.targets.wheel]` 指定打包目标
- `Dockerfile` — 多阶段：node-tools（装 node）→ builder（uv 建 venv + `uv pip install -e .`）→ runtime（拷 venv + 源码 + node）
- `ruff.toml` — `extend = "pyproject.toml"`，保证子目录调用 ruff 也用同一份配置
- `alembic.ini` — `script_location = migrations`，`sqlalchemy.url` 留空由 env.py 注入

## 关键逻辑
```
# Dockerfile 关键阶段：
# builder: pip install uv==0.4.18 → uv venv /opt/venv → uv pip install -e .
# runtime: python:3.12-slim + COPY venv + COPY /build → /app → EXPOSE 8000
# healthcheck: curl http://127.0.0.1:8000/api/health
# CMD 由 docker-compose 注入（uvicorn app.main:app）

# ruff: target-version py312，per-file-ignores 豁免 migrations/versions 的 UP035
# pytest: [tool.pytest.ini_options] 配置 asyncio mode
# mypy: python_version 3.12
```

## 注意事项
- 构建用 hatchling（PEP 621），`uv pip install -e .` 当前 lock-less，注释提示后续切 `uv sync --frozen`
- Dockerfile 用 uv 0.4.18 单二进制装依赖；镜像含 node（供前端工具链/某些运行时依赖）
- runtime 阶段 WORKDIR=/app，COPY builder 的 /opt/venv 与 /build 源码；EXPOSE 8000
- 容器内 healthcheck 打 `/api/health`；注意 Docker 注入的 http_proxy 会让 busybox wget 探针误报 unhealthy（服务实际正常）
- ruff 配置主源在 pyproject.toml 的 `[tool.ruff]`，ruff.toml 仅作子目录兜底（extend）
- 改后端源码后 Docker 不热重载（镜像内代码），需 rebuild 镜像才能生效
- 提交时 Local CI hook 会跑 backend ruff format，未格式化代码会被拦；提交前用 `backend/.venv/bin/ruff format` 处理 staged 文件

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
