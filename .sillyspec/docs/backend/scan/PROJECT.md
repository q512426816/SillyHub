---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 项目（Project）

## 项目简介

**multi-agent-platform-api**（构建名 `app`）是 SillyHub 多智能体协作平台的后端 API，FastAPI + Python 3.12 全异步实现。把 SillySpec 规范驱动开发方法论产品化，提供多用户、多工作空间的变更全生命周期管理，并对接 SillySpec CLI 与本地 daemon。

后端职责（按模块与代码核实）：

- **工作空间管理** — Git 仓库注册为工作空间，扫描 `.sillyspec` 目录树（workspace 模块）。
- **变更生命周期** — SillySpec change 流程的状态机、gate 决策、审批与进度投影（change / workflow / change_writer / platform_sync）。
- **AI Agent 编排** — Claude Code 等 agent 的派发 / mission / 会话，SSE 实时回传日志（agent 模块）。
- **daemon 协同** — WebSocket 下发 lease、SESSION_* 会话控制与 kill，回收 patch / usage / artifact（daemon 模块，host_fs 委托文件系统操作）。
- **文件中心** — 平台文件的上传/管理与 S3 兼容存储（file + storage，MinIO/aiobotocore）。
- **LLM 网关** — llm_provider 提供经代理的 LLM 访问（上游密钥不出后端进程）+ tool_gateway 工具级审批。
- **对外 MCP 服务** — mcp_gateway 以官方 mcp SDK FastMCP ASGI mount 暴露平台能力。
- **进度同步** — platform_sync 收 SillySpec CLI 以 shpsync_ token 回传的进度 / 文档 / 审批，并提供 spec 树 manifest + 增量 sync，由 spec_workspace 落盘 workspace spec_root。
- **PPM（已上线）** — 计划 / 问题 / 看板 / 工时 / 工作台 / 项目管理（ppm 模块族）。
- **认证授权** — JWT 浏览器会话 + API Key（daemon 长凭证）+ RBAC（auth 模块）。
- **其余域** — release（发布审批/部署窗口）、incident、knowledge、skills、scan_docs、spec_profile、runtime、settings、admin、git_identity、git_gateway、worktree、task、health。

代码组织为 vertical slice：`app/modules/<feature>/` 内含 router + schema + service + models + tests，在 `app/main.py::create_app()` 聚合挂载到 `/api` 前缀。

规模（Glob/ls 实测）：**29 个业务模块**（`ls app/modules/`）；`app/**/*.py` 共 640 个（含模块内测试 278）；`backend/tests/` 76 个测试文件；alembic migration 144 个 revision。入口 `app.main:app`，OpenAPI 文档 `/api/docs`（Swagger）与 `/api/redoc`。

## 技术栈

| 维度 | 技术 | 版本约束（backend/pyproject.toml） |
|---|---|---|
| 语言 | Python | >=3.12 |
| Web 框架 | FastAPI + Uvicorn[standard] | >=0.115 / >=0.30 |
| 数据建模 | Pydantic + pydantic-settings + SQLModel | >=2.8 / >=2.4 / >=0.0.22 |
| ORM / DB 驱动 | SQLAlchemy[asyncio] + asyncpg（生产 PostgreSQL 16） | >=2.0 / >=0.29 |
| 迁移 | Alembic（migrations/versions/，144 个 revision） | >=1.13 |
| 缓存 / 消息 | Redis（redis.asyncio：pub/sub、token/权限缓存、限流） | >=5.0 |
| 对象存储 | aiobotocore（S3 兼容 / MinIO） | >=3.8,<4 |
| MCP 服务 | 官方 mcp SDK（FastMCP ASGI mount，锁 v1 线） | >=1.29,<2 |
| 认证加密 | python-jose[cryptography]（JWT）+ passlib[bcrypt] + pynacl | >=3.3 / >=1.7 / >=1.5 |
| 结构化日志 | structlog（禁 print）；OpenTelemetry 现为 stub | >=24.4 |
| HTTP 客户端 | httpx（LLM 上游、daemon 回调、测试 ASGI client） | >=0.27 |
| Excel / 图像 | openpyxl + Pillow（PPM 导入 / DISPIMG 图像） | >=3.1 / >=10 |
| 文档解析 | python-frontmatter（spec markdown frontmatter）+ python-multipart | >=1.1 / >=0.0.9 |
| 系统信息 | psutil | >=5.9 |
| 测试 | pytest + pytest-asyncio(auto) + pytest-cov + pytest-xdist + pytest-rerunfailures + aiosqlite + anyio | >=8 等 |
| 代码质量 | ruff（line-length=100, py312）+ mypy（非严格，pydantic 插件）+ pre-commit | >=0.6 / >=1.11 / >=4.6 |
| 构建 / 包管理 | hatchling（wheel packages=["app"]）+ uv | uv >=0.4 |

**生产数据库** PostgreSQL 16；**测试数据库** 内存异步 SQLite（aiosqlite，conftest override `get_session`），零外部依赖。

## 模块域清单（ls app/modules/，29 个）

admin / agent / auth / change / change_writer / daemon / file / git_gateway / git_identity / health / incident / knowledge / llm_provider / mcp_gateway / platform_sync / ppm / release / runtime / scan_docs / settings / skills / spec_profile / spec_workspace / storage / task / tool_gateway / workflow / workspace / worktree

## 与前端 / daemon / SillySpec CLI 的边界

- **前端类型契约**：后端 `backend/scripts/dump_openapi.py` 导出 `backend/openapi.json`，前端 `pnpm gen:types` 生成 `frontend/src/lib/api-types.ts` —— OpenAPI 是单一事实源，前端类型禁止手写。
- **sillyhub-daemon（Node.js/TypeScript）**：per-host 本地守护进程。后端经 WebSocket（daemon/ws_hub）下发 lease 与会话控制指令，daemon 回传运行日志 / usage / patch；后端不直接操作宿主文件系统（经 host_fs 委托 daemon 执行）。
- **SillySpec CLI**：以 shpsync_ token 调 platform_sync 端点回传进度、文档与审批结果；spec 文件经 manifest + 增量 sync（tar 整包校验后落盘）同步到 workspace 的 spec_root，server 侧排除 local.yaml 等敏感文件。
- **LLM 上游**：llm_provider 网关代理，鉴权 / 限额在后端，上游密钥不出后端进程；team mission 的 Coordinator/Finalizer 直接走 messages API。
- **部署**：Docker Compose（deploy/），后端 + 前端 Next.js + Postgres + Redis + MinIO；健康检查 `GET /api/health`。

## 运行入口与开发约定（backend/README.md + Makefile）

- 安装：`cd backend && uv sync --all-extras`（dev 组含 pytest 全家桶 / ruff / mypy / pre-commit）。
- 启动：`cd backend && uv run uvicorn app.main:app --reload --port 8000`（需 `DATABASE_URL`、`SECRET_KEY` 等 env 或 `.env`）。
- 测试：`make backend-test`（= `cd backend && uv run pytest -q --cov=app --cov-fail-under=60`）。
- 约定：Async-first（同步代码仅限 CLI/migrations）；settings 不可变、`get_settings()` 单例缓存；structlog 禁 `print`；错误响应统一 `{code, message, request_id, details}` 且用户面文案中文。
