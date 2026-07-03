---
schema_version: 1
doc_type: module-card
module_id: backend
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:42
---
# backend

## 定位

multi-agent-platform 的核心 API 服务，monorepo 的"大脑"。以 FastAPI 提供 REST/SSE/WebSocket 接口，承载多智能体协作平台全部领域逻辑：工作区管理、SillySpec 变更编排、Agent 运行时调度、PPM 项目管理、知识库、发布、权限治理等。是 frontend 与 sillyhub-daemon 的唯一数据后端，二者均通过 HTTP/WebSocket 调用它。

技术栈：Python 3.12+、FastAPI、SQLModel、Alembic（迁移）、PostgreSQL、Redis（缓存/会话）、httpx、uvicorn、uv（包管理）、pytest。代码组织为"核心 core + 按领域分 modules"两层结构。

## 契约摘要

对外契约是 `/api` 前缀的 HTTP 路由树。`app/main.py` 聚合 30+ 个领域路由，统一挂在 `/api` 下：

- 基础：health、auth、members、workspace、admin、settings、scan_docs
- SillySpec 编排：change、change_writer、task、workflow、archive、spec_workspace、release、knowledge、incident
- Agent/运行时：agent、runtime、daemon（守护进程接入）、lease（租约）、tool_gateway、policy（权限策略）
- Git：git_identity、git_gateway、worktree
- PPM 子树（统一前缀 `/api/ppm`）：project、plan、task、problem、kanban

启动入口 `uvicorn app.main:app`，带 `lifespan` 钩子（初始化/释放 DB 引擎、Redis、遥测）。`app = FastAPI(...)` 实例在 `main.py` 构建，装配 CORS 中间件与全局异常处理器（`core/errors.register_exception_handlers`）。

## 关键逻辑

- **分层结构**：`app/core/`（config/db/redis/security/crypto/logging/telemetry/audit_hooks/spec_paths 等横切关注）+ `app/models/base.py`（SQLModel 基类）+ `app/modules/<域>/`（每域含 `router.py` + 业务/service + tests）。
- **领域模块清单**：admin、agent、archive、auth、change、change_writer、daemon、git_gateway、git_identity、health、incident、knowledge、ppm(5 子域)、release、runtime、scan_docs、settings、spec_profile、spec_workspace、task、tool_gateway、workflow、workspace、worktree。
- **Daemon 接入**：daemon 模块与 lease 模块共同支撑本地守护进程注册、领租约、心跳、消息回传的在线交互模型。
- **迁移与建表**：Alembic（`migrations/`）+ `create_tables.py` 兜底；`core/layout_migration.py` 处理 SillySpec Native Layout 演进。
- **测试**：`backend/tests/` + 各模块内 `tests/`；CI 要求 `--cov-fail-under=60`。

## 注意事项

- 改动 backend 必须实测 API（curl 打端点），不能只靠 tsc/mypy，历史上出现过运行时未导入符号导致 500 的案例。
- Docker 部署时 backend 容器跑镜像内代码、不热重载，改源码后需 rebuild 镜像再验。
- 路由前缀约定：绝大多数在 `/api`，PPM 走 `/api/ppm`；新增模块要在 `main.py` 显式 `include_router`。
- 提交前需跑 `backend/.venv/bin/ruff format` 处理 staged 文件，否则 pre-commit hook 拦截。
- **scan 命令路径加引号**：`build_scan_bundle` 生成 sillyspec 命令（init/scan start/scan done）时 `--dir` 路径必须双引号包裹，防 Windows 反斜杠路径在 Git Bash 无引号时被转义吃掉（`C:\Users` 的 `\U` 被吞 → 路径变形/目录不存在）。
- **daemon-client spec 同步契约（D-005@v1，2026-06-26-daemon-client-spec-sync-fix）**：`platform-managed` workspace（`spec_workspaces.strategy`）的 spec_root 是扁平 `.sillyspec` 内容根，reader 经 `SpecPathResolver.for_spec_workspace(spec_ws)` 选 mode；`apply_sync` 接收 daemon tar 含 `.runtime`（push 非对称，pull `build_bundle` 仍排除）+ 落 `last_synced_at`/`sync_status=clean`；change-write 经 `daemon_change_writes` 表 lease-polling（`change_writer.proxy_create_change` + daemon `pending-change-writes`/`claim`/`complete` 三端点 + 60s 超时 gc），无在线 daemon 抛 `DaemonClientNoActiveSession`(400 `DAEMON_CLIENT_NO_SESSION`)。

## 人工备注
<!-- MANUAL_NOTES_START -->
## 变更索引
- ql-20260625-003-4d7a | AgentRunResponse 与 session SSE tokens/turn_completed 透出缓存读取/写入 token 字段，供前端运行日志与会话消息展示 cache 用量。
- ql-20260626-001-4a8e | 放宽 AgentRunLog content 落库与 SSE 推送截断 5000→50000（run_sync/service.py submit_messages），避免 agent 长答复/最终总结被硬切。
- 2026-06-26-daemon-client-spec-sync-fix | daemon-client spec 同步修复：SpecPathResolver platform_managed mode（FR-01~04）+ apply_sync .runtime/last_synced_at（FR-06/07）+ daemon_change_writes lease-polling change-write 三端点 + proxy_create_change（FR-08~09）。
- ql-20260703-001-643f | build_claim_payload interactive 分支 provider 归一化（_normalize_lease_provider：claude_code/claude-code→claude，其余原样），与 daemon normalizeProvider 双保险——修 backend 透传 adapter id 'claude_code' 致 daemon _agentPaths.get 失败、interactive 静默早返回、lease 永远 claimed/run 永远 pending。

<!-- MANUAL_NOTES_END -->
