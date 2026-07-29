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
- LLM：llm_provider（LLM 供应商配置，含 `POST /api/llm-providers/{id}/usage` 用量/余额查询）
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

- ql-20260709-001-7e3a | tool_result 命令输出截断 3000→100000（run_sync/service.py `_extract_sdk_messages`，新增常量 TOOL_RESULT_MAX_CHARS）+ 超长追加中文标注，避免 scan/构建/测试日志尾部被砍（interactive 路径，daemon 透传不截）。

- ql-20260709-002-1b8c | thinking/TOOL_USE 命令行截断 2000→2万 + result_summary 兜底 4000→5万（service.py `_extract_sdk_messages`），A 类日志截断放宽（B 类防刷屏保留）。

- ql-20260723-010-32d6 | 后端测试提速：conftest 设 `AUTH_BCRYPT_ROUNDS=4`（测试档位，省每认证测试 ~0.3s 哈希）+ pyproject 加 pytest-xdist 并行（`-n auto` 全量 ~50min→7min）+ 根 conftest 新增 `seed_spec_root_fn` fixture 让 5 个 change/task 测试经依赖注入取根 helper（根治 `from conftest import` 因 9 个同名 conftest 模块名共享在 xdist 下解析顺序歧义）+ git_gateway 参数化 `list(frozenset)`→`sorted`（消 xdist 多 worker 收集顺序不一致）。

- ql-20260726-001-ac8a | daemon-borrow 迁移 revision 碰撞修复：本变更 3 迁移与 llm-provider 变更撞 revision id `202607251100` 致 alembic 双 head（生产 `alembic upgrade head` 必报 Multiple heads crash-loop，daemon-borrow verify-result.md P0）。renumber 内容 revision 1100/1200/1300→1400/500/600（1400 down_revision 接 llm-provider 的 1100，形成 1000→1100llm→1400→1500→1600 单 head 链），同步改 3 测试硬编码 id 断言。13fc1dc9 已先纯重命名文件名但未改内容，本 ql 补全内容修复。

- 2026-07-25-daemon-borrow-for-business | 业务/管理人员（business_member 角色）借用工作空间共享 daemon 跑 agent 读源码出业务方案。数据：workspace_member_runtimes 加 shared 列 + daemon_borrow_audit 表 + business_member 角色种子（DAEMON_BORROW=daemon:borrow + task:run_agent + workspace:read）。派发：4 路 resolver（placement dispatch/decide/interactive + member_runtimes writeback）收敛到 agent/borrow_resolver._resolve_borrowed_or_own_runtime（先自有零回归，无则借用三重校验 权限→shared→online）。落点：close_interactive_run 回调落 FileService（owner_type=workspace, text/markdown 白名单）+ 审计。接口：PUT /my-binding/shared + GET /shared-daemons + GET /api/file/list。零回归：shared 默认 false、DAEMON_BORROW 默认不授、helper 第1步自有原路径。

- ql-20260728-002-21aa | 登录爆破防护（安全审计 P0-8/P1-14 修复）：同 IP 60s 窗口 INCR 限流（`auth_login_rate_limit_per_minute=5` → 429）+ 失败计数（达 `auth_login_fail_threshold=3` 后该 IP 须带 captcha_token）+ Pillow 滑块验证码（背景含凹槽+滑块块，target_x 仅存 Redis 不返前端，±6px 容差验过签发一次性 captcha_token；slider/token 均一次性消费防重放爆破）。新增 `modules/auth/captcha_service.py`；router 加 `GET /captcha/slider`、`POST /captcha/verify`，登录端点串 check_rate_limit→assert_captcha_if_needed→record_login_failure；Redis 故障降级放行不阻断登录（同 api_key 缓存降级哲学）。

- ql-20260728-003 | 滑块验证码下线换点按式人机确认（滑块交互 ±6px 难对齐、体验差）：`captcha_service.py` 删 Pillow 滑块生成/校验，新增 `create_confirmation`/`verify_confirmation`（一次性 captcha_id→captcha_token，取到即签发，无坐标判断）；限流/失败计数/`assert_captcha_if_needed`/`_consume_captcha_token`/Redis 降级全保留。schema 删 `SliderCaptcha*` 加 `ConfirmCaptchaResponse`/`CaptchaVerifyRequest`/`CaptchaVerifyResponse`；router `GET /captcha/slider`→`/captcha/confirm`、`POST /captcha/verify` 体 `{captcha_id,x}`→`{captcha_id}`；登录端点/423 触发不动。Pillow 因 PPM 模块在用保留依赖。`tests/test_login_captcha.py` 重写为 6 测试（限流/423/全流程/id 一次性/未知 id/降级放行）。

- ql-20260729-001-30e5 | 修复登录验证码吞掉密码错误提示：阈值触发后用户带有效 captcha_token 登录但密码错时，后端不再绕回 423"需要验证码"（token 已被 assert_captcha_if_needed 提前一次性消费，陷"验证→又让验证"循环、用户永远看不到密码错误），改为明确返回 401"用户名或密码错误"。根因 router.py login 的 except AuthInvalidCredentials 分支达阈值后把所有密码错误转 LoginCaptchaRequired。修复：`assert_captcha_if_needed` 返回 bool（本次是否已通过人机验证/消费有效 token），`captcha_verified=True` 时密码错正常抛 AuthInvalidCredentials。爆破防护不降（每次试密码仍须先过验证码 token 一次性 + IP 限流）。`test_login_captcha.py` 加 `test_captcha_verified_then_wrong_password_returns_401` 回归。

- ql-20260729-002-833d | 修后端测试 collection ERROR 阻塞：backend/conftest.py 的 db_engine fixture 漏 import app.modules.ppm.project.model（ppm_project_maintenance/customer/member/stakeholder 4 表），而 workspace.model 的 ppm_project_workspace 外键→ppm_project_maintenance.id，该表未注册致 sqlite create_all 报 NoReferencedTableError，连带所有依赖 db_session/client 的测试 collection ERROR（auth 全模块 138 errors）。补一行 import，外部依赖链全满足（organizations→admin.model、users→auth.model 均已在上文注册）。修后 auth 全模块 137 passed（暴露 1 个预存 migration 测试债 test_alembic_head_includes_new_revision 过时断言"是 head"，实际 202607271700 被 202607281500 接续，需另修）。

- ql-20260729-003-2ff0 | 修 migration 测试债让 auth 全绿：test_refresh_token_index.py::test_alembic_head_includes_new_revision 断言过时（断 revision 202607271700 是 head，但 ppm-project-link-workspace 的 202607281500 down_revision=202607271700 已把 head 接续成 202607281500，链健康单 head）。AC-10 真实意图是验证 refresh-token-index 的 migration 已落地进 alembic 链——断言从"是 head"改"在链中存在"(script.get_revision 非 None)，保留"链单 head 无分叉"检查(len(heads)==1)，不绑定具体 head(随新 migration 演进)。同步更新文件级 docstring AC-10 描述。auth 全模块 137 passed/1 failed→138 passed/2 xfailed 全绿零回归。

- 2026-07-28-llm-provider-presets-and-usage | LLM 供应商预设模板 + 用量/余额查询：llm_provider 模块新增 `POST /api/llm-providers/{id}/usage`（owner 级，跨用户 404/403 不泄漏）。schema 加 `UsageData`（plan_name/total/used/remaining/unit/is_valid 全 Optional）+ `UsageResult`（success/data/error）；新增 `usage_handlers.py` 按 balance（DeepSeek `/user/balance`、硅基 `/v1/user/info`、OpenRouter `/api/v1/credits`）与 token_plan（Kimi For Coding、智谱 coding-plan/quota、MiniMax coding_plan/remains）两路径逐家硬编码 query+parser；`service.query_usage()` 解密 key + `_detect_usage_provider(base_url)` 路由 + 错误两态（瞬时网络/5xx/429/超时 → raise 5xx；确定性 401/403/空 key/未知供应商 → success:false）+ SSRF 复用 `tool_policy.assert_public_hostname`（15s 超时）。无 DB 字段（D-004，detect_provider(base_url) 实时路由）。新增 `tests/test_usage.py`（46 用例：各家正常 + 错误分类 + detect 路由 + SSRF 拒私网/IPv6 + key 明文不入响应）。

<!-- MANUAL_NOTES_END -->
