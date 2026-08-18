---
author: qinyi
created_at: 2026-08-18 01:06:26
source_commit: 744e3de4
updated_at: 2026-08-17T17:06:26Z
generator: sillyspec-scan
---

# 集成（Integrations）

> 按「数据 / LLM / 协议端点 / 跨服务跨仓 / 外部 HTTP / 认证加密 / 工具链」分组，基于 `backend/pyproject.toml` 依赖与 `app/core/*.py`、各模块 grep 实测于 commit `744e3de4`（上次扫描 `6e78b29a`，2026-07-26）。
> 本次增量：新增对外 MCP 服务器（`mcp>=1.29,<2` FastMCP mount `/mcp`）、SillySpec CLI 回传通道（`platform_sync` 模块 + `shpsync_` token + spec-manifest/spec-sync 端点）、LiteLLM 网关 admin API 客户端、daemon `/api/llm-proxy` 透传、`core/ssrf.py` SSRF 统一入口。

## 数据 — PostgreSQL / Redis / S3 兼容对象存储

| 集成 | 用途 | 依据 |
| --- | --- | --- |
| PostgreSQL（`asyncpg>=0.29`） | 主存储，SQLAlchemy URL `postgresql+asyncpg://`，进程级引擎 + sessionmaker | `backend/app/core/db.py`；`sqlalchemy[asyncio]>=2.0` + `sqlmodel>=0.0.22`（`app/models/base.py`） |
| Redis（`redis>=5.0`） | 异步缓存 + pub/sub：权限缓存、daemon 会话状态/run_sync 缓存、ws_hub 权限查询、McpToken/验证码缓存、agent 运行态；默认 `redis://localhost:6379/0`（测试 db 15） | `app/core/redis.py`（`get_redis` 单例）、`app/core/permission_cache.py`；消费方 grep：`daemon/session/service.py`、`daemon/run_sync/service.py`、`daemon/lease/service.py`、`mcp_gateway/service.py`、`auth/api_key_service.py`、`auth/captcha_service.py`、`agent/service.py`、`spec_workspace/bootstrap.py`、`health/router.py` |
| S3 兼容对象存储（`aiobotocore>=3.8,<4`，部署用 MinIO） | 平台文件中心后端存储 | `app/modules/storage/minio_backend.py`（`MinioStorage`）；抽象层 `storage/base.py`（`StorageBackend` 接口）+ `storage/factory.py`（单例 + Depends）；HTTP 面 `app/modules/file/router.py`；配置 `Settings.s3_endpoint/s3_access_key/s3_secret_key/s3_bucket/s3_region` |

## LLM — LiteLLM 网关（openai 格式供应商经 LiteLLM 转 Anthropic↔OpenAI）

| 集成 | 用途 | 依据 |
| --- | --- | --- |
| LiteLLM admin API（httpx 出站） | openai 格式 LlmProvider 注册/注销：`POST /model/new`（`model_info.mode=chat` 强制 Chat Completions）、`/model/info` → `/model/delete`（按 model_id）；best-effort 降级不阻塞主流程；上游 api_key 明文仅出现在 register 请求体，不入日志/审计 | `app/modules/llm_provider/litellm_client.py`（`httpx` + master key，超时 10s）；网关自身配置文件在**仓库根 `deploy/litellm-config.yaml`**（跨目录，不在 backend/ 内，部署期由 compose 挂载） |
| `/api/llm-proxy` 透传端点 | daemon 侧经 backend 代理访问 LiteLLM（master key 只在 backend 进程内注入，不出进程） | `app/modules/daemon/router.py` L2243-2317：`GET/POST /llm-proxy/{path:path}` → `_llm_proxy_impl` 返回 StreamingResponse |

## 协议端点 — MCP / SSE / WebSocket

| 集成 | 用途 | 依据 |
| --- | --- | --- |
| MCP 对外服务器（`mcp>=1.29,<2`，FastMCP） | FastMCP streamable HTTP ASGI 子应用 mount 在 `/mcp`，供外部 MCP 客户端（Claude Code 等）调用平台能力；lifespan 内 `async with mcp.session_manager.run()` 驱动会话；`McpAuthMiddleware` 鉴权（workspace 级 `shmcp_`/McpToken） | `app/modules/mcp_gateway/server.py`（`mcp` 实例 + `mount_mcp`，`app/main.py` L710 调用）、`mcp_gateway/tools.py`（工具定义）、`mcp_gateway/auth.py`、`mcp_gateway/router.py`（`/api/workspaces/{wid}/mcp-tokens` 签发/吊销） |
| SSE / 流式响应（StreamingResponse，未用 sse-starlette） | ① mission 级 SSE（MCP 场景）；② daemon 会话日志/llm-proxy 流式；③ agent 运行流；④ spec_workspace bundle 同步流；⑤ file 下载流；⑥ PPM Excel 导出流 | `mcp_gateway/sse.py`（mission SSE，main.py L663 挂 `/api`）、`daemon/router.py`、`agent/router.py`、`spec_workspace/{router,service}.py`、`file/router.py`、`ppm/common/export.py` + `ppm/project/router.py` + `ppm/task/router.py`；main.py 内联 daemon-chat `/{run_id}/stream` |
| WebSocket | 全仓唯一 `@router.websocket`：`/ws` daemon 双向 RPC 通道（按 `daemon_id` 路由连接池，承载权限下行、会话消息回传、会话控制） | `app/modules/daemon/router.py`、`daemon/ws_hub.py`、`daemon/protocol.py` |

## 跨服务 / 跨仓

| 集成 | 用途 | 依据 |
| --- | --- | --- |
| sillyhub-daemon（独立子项目） | WS RPC + HTTP 租约（claim/start/heartbeat/complete）+ 安装包分发（`/daemon/install.sh`、`/daemon/latest/...`）+ 变更写回；daemon 侧源码不在本扫描范围 | `app/modules/daemon/{router,ws_hub,lease_service,dist_router,change_write_router}.py` |
| SillySpec CLI 回传（platform_sync） | CLI 把进度/文档/审批结果回传平台；**写通道仅接受 `shpsync_` 前缀 workspace 同步 token**（其它 403）；spec 文件增量同步 = `GET /api/changes/-/spec-manifest`（服务器权威清单，CLI 以此为基线 diff）+ `POST /api/changes/-/spec-sync`（增量 ops）；token 签发/吊销走 workspace router | `app/modules/platform_sync/router.py`（L155/L179 端点）、`platform_sync/auth.py`（`shpsync_` 鉴权）、`platform_sync/token_service.py`、`platform_sync/workspace_router.py` |
| 前端类型契约（OpenAPI） | 静态导出 FastAPI OpenAPI schema 供前端 `pnpm gen:types` 生成 `api-types.ts`（不启动 uvicorn、不连 DB/Redis，dummy env 兜底） | `backend/scripts/dump_openapi.py` → 产物 `backend/openapi.json`（随仓提交） |
| SSRF 统一入口（façade） | 三个「替用户发外部请求」的入口（mcp webhook 回调 / worktree git clone / http_get 工具）统一经此做公网 IP 校验（IPv4+IPv6 + `asyncio.to_thread` 防 DNS 阻塞），复用 tool_gateway IP 原语 | `app/core/ssrf.py` |

## 外部 HTTP — httpx(async)

| 调用点 | 用途 |
| --- | --- |
| `app/modules/git_identity/providers/github.py` | GitHub OAuth 身份校验（timeout=15） |
| `app/modules/tool_gateway/service.py` | 工具网关转发（处理 `httpx.TimeoutException`/`RequestError`） |
| `app/modules/agent/finalizer.py`、`app/modules/agent/delegation.py` | agent → daemon 收尾/委派调用（`trust_env=False`，不读宿主代理 env） |
| `app/modules/llm_provider/litellm_client.py` | LiteLLM admin API（见上节） |
| 测试侧 | `httpx.ASGITransport` 直连 app 做 ASGI 集成测试（`backend/conftest.py`） |

## 认证 / 加密（库依赖）

| 依赖 | 用途 | 依据 |
| --- | --- | --- |
| `python-jose[cryptography]>=3.3` | JWT 签发/校验（HS256） | `app/core/security.py` |
| `passlib[bcrypt]>=1.7` | 口令 bcrypt 哈希 | `app/core/security.py`、`app/modules/auth/service.py` |
| `pynacl>=1.5` | NaCl SecretBox 主密钥对称加解密（`v1:` 前缀密文；llm_provider 上游 api_key、凭据落库） | `app/core/crypto.py`、`app/modules/llm_provider/litellm_client.py`（`CredentialCipher`） |
| FastAPI 鉴权依赖 | `get_current_user` / `require_permission(_any)` / `get_current_principal` / `require_platform_admin`；daemon 持 API Key（`X-API-Key`）同一 principal；mcp/shpsync 走各自 token 鉴权 | `app/core/auth_deps.py`、`mcp_gateway/auth.py`、`platform_sync/auth.py` |

## 工具链

- **alembic**：数据库迁移，`migrations/env.py` 异步上下文，144 个 revision（`alembic.ini`）。
- **uv**：包管理与运行（`uv run pytest` 等），`uv.lock` 锁定；hatchling 构建后端（wheel `packages=["app"]`）。
- **ruff**：Lint + format（line-length=100，规则集 E/F/I/B/UP/N/SIM/RUF/BLE + 中文文案豁免）。
- **mypy**：非严格 + pydantic 插件（`[tool.mypy]`，CI 与 pre-commit 各跑一层）。
- **pytest**：`pytest-asyncio`（auto）/ `pytest-cov` / `pytest-xdist`（loadscope 分组）/ `pytest-rerunfailures`（CI `--reruns 2`）；`aiosqlite` 测试内存库替代 Postgres。
- **可观测**：structlog 事件日志（`app/core/logging.py`）+ `psutil` 系统观测 + `app/core/monitoring.py` 性能四件套（慢请求/事件循环看门狗/慢 SQL）+ OTEL 可选 stub（`app/core/telemetry.py`）。
- **其它业务库**：`python-frontmatter`（SillySpec markdown frontmatter 解析）、`openpyxl` + `Pillow`（PPM Excel 导入导出含图像，`templates/weekly-plan-template.xlsx`）、`python-multipart`（表单/文件上传）。
