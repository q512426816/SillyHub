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
- Agent/运行时：agent、runtime、daemon（守护进程接入）、lease（租约）、tool_gateway、policy（权限策略）。
- **AgentProfile 配置层**（2026-08-04-agent-profile-ui-redesign）：`agent` 模块 `profile/` 子域（agent_profiles 表 CRUD + 三级 visibility private/workspace/platform + 系统预置只读）；新增 `GET /api/agent-profiles?scope=mine` 跨工作区聚合只读端点（scope 省略=原 platform 级冻结 C8，前端选档下拉依赖），聚合视图逐档 `_can_read_async` 越权防护。**模型错误可见性**：daemon 回传的 `InteractiveRunResultRequest.error`（ModelErrorDTO）写入 `AgentRun.error_detail` JSON 列（与 `error_code` 正交）；`GET /api/daemon/sessions/{id}/runs` 返 SessionRunRead（含 error_detail）；会话 SSE 在 failed turn 推 `run_error` 事件。三端同构 ModelErrorDTO 由 gen:types 对齐（design §7.1）。
- Git：git_identity、git_gateway、worktree
- LLM：llm_provider（LLM 供应商配置，含 `POST /api/llm-providers/{id}/usage` 用量/余额查询）
- PPM 子树（统一前缀 `/api/ppm`）：project、plan、task、problem、kanban
- **SillySpec 进度同步层**（2026-08-10-sillyhub-platform-sync）：`platform_sync` 模块 3 端点——POST `/api/changes/{name}/progress`（上行 `serializeForSync` 六表裸 JSON + 读 3 个 `X-SillySpec-*` header[User/Base-Ts/Pushed-At，缺失/空均 None] + §4.2 base_ts 字典序乐观锁：无 base_ts 或 stored≤base_ts→接受 200 / stored>base_ts→409 body `{conflict,platform_progress,last_pushed_at}` 不 auto-merge）/ GET `/api/changes`（轻量列表裸数组 `[{name,current_stage,last_pushed_at,last_pusher}]`）/ GET `/api/changes/{name}/progress`（完整六表 JSON + 顶层 `last_pushed_at`，不存在 404）。Bearer=APIKey(`shk_live_`)/JWT 双路径鉴权（复用 `ApiKeyService.authenticate`+`get_current_user`）；`platform_change_progress` 表单行存 `latest_progress`(JSON)+`last_pushed_at`/`last_pusher`；裸 dict 透传（NG-6 不强类型校验）；铁律不碰派发层（D-004，与 `/api/workspaces/{wid}/changes/*` 正交，无路径/数据重叠）。跨仓契约见 `sillyspec/docs/sillyspec/sillyhub-progress-sync-contract.md`。

启动入口 `uvicorn app.main:app`，带 `lifespan` 钩子（初始化/释放 DB 引擎、Redis、遥测）。`app = FastAPI(...)` 实例在 `main.py` 构建，装配 CORS 中间件与全局异常处理器（`core/errors.register_exception_handlers`）。

## 关键逻辑

- **分层结构**：`app/core/`（config/db/redis/security/crypto/logging/telemetry/audit_hooks/spec_paths 等横切关注）+ `app/models/base.py`（SQLModel 基类）+ `app/modules/<域>/`（每域含 `router.py` + 业务/service + tests）。
- **领域模块清单**：admin、agent、archive、auth、change、change_writer、daemon、git_gateway、git_identity、health、incident、knowledge、ppm(5 子域)、platform_sync、release、runtime、scan_docs、settings、spec_profile、spec_workspace、task、tool_gateway、workflow、workspace、worktree。
- **Daemon 接入**：daemon 模块与 lease 模块共同支撑本地守护进程注册、领租约、心跳、消息回传的在线交互模型。**模型错误回传**：daemon 在 turn 失败时归类出 ModelError（auth_failed/quota_exceeded[不可重试]/rate_limited[可重试]/timeout/model_not_found/network/provider_error/unknown），经 notifyRunResult → close_interactive_run 三层透传（router+facade+实体）写 AgentRun.error_detail，run→failed。
- **迁移与建表**：Alembic（`migrations/`）+ `create_tables.py` 兜底；`core/layout_migration.py` 处理 SillySpec Native Layout 演进。
- **测试**：`backend/tests/` + 各模块内 `tests/`；CI 要求 `--cov-fail-under=60`。

## 注意事项

- 改动 backend 必须实测 API（curl 打端点），不能只靠 tsc/mypy，历史上出现过运行时未导入符号导致 500 的案例。
- Docker 部署时 backend 容器跑镜像内代码、不热重载，改源码后需 rebuild 镜像再验。
- 路由前缀约定：绝大多数在 `/api`，PPM 走 `/api/ppm`；新增模块要在 `main.py` 显式 `include_router`。
- 提交前需跑 `backend/.venv/bin/ruff format` 处理 staged 文件，否则 pre-commit hook 拦截。
- **scan 命令路径加引号**：`build_scan_bundle` 生成 sillyspec 命令（init/scan start/scan done）时 `--dir` 路径必须双引号包裹，防 Windows 反斜杠路径在 Git Bash 无引号时被转义吃掉（`C:\Users` 的 `\U` 被吞 → 路径变形/目录不存在）。
- **daemon-client spec 同步契约（D-005@v1，2026-06-26-daemon-client-spec-sync-fix）**：`platform-managed` workspace（`spec_workspaces.strategy`）的 spec_root 是扁平 `.sillyspec` 内容根，reader 经 `SpecPathResolver.for_spec_workspace(spec_ws)` 选 mode；`apply_sync` 接收 daemon tar 含 `.runtime`（push 非对称，pull `build_bundle` 仍排除）+ 落 `last_synced_at`/`sync_status=clean`；change-write 经 `daemon_change_writes` 表 lease-polling（`change_writer.proxy_create_change` + daemon `pending-change-writes`/`claim`/`complete` 三端点 + 60s 超时 gc），无在线 daemon 抛 `DaemonClientNoActiveSession`(400 `DAEMON_CLIENT_NO_SESSION`)。
- **SillySpec 进度同步契约（2026-08-10-sillyhub-platform-sync）**：`platform_sync` router **不自带 prefix**（路径写全 `/changes/...`，main 挂 `/api` 落地 `/api/changes/...`）——避开 FastAPI 对 `GET /changes` 的尾斜杠 307 redirect（客户端 `sync.js` 打无尾斜杠 `/api/changes`）。POST 409 必用 `JSONResponse` 绕过 `response_model` 校验，确保 body 严格按契约 §4.4（`{conflict,platform_progress,last_pushed_at}`，`platform_progress` 是平台当前 `latest_progress` 原样回显，**不 auto-merge** 客户端 body）。base_ts 比对用 ISO 8601 UTC **字符串字典序**（不转 `datetime`，契约 §7：字典序==时间序）。铁律 D-004：进度同步层永不触碰 `/api/workspaces/{wid}/changes/*` 派发层（无路径/数据重叠）。gen:types 须在主仓跑（worktree + editable install 坑：worktree 跑 `dump_openapi.py` 会加载主仓 `app.main` 不含本改动，须 `PYTHONPATH=<worktree>/backend` 或主仓合并后跑）。

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

- ql-20260731-001-3abf | 平台技能清单 manifest 增 skills 摘要字段：`skills_bundle_service.py` 新增 `_parse_skill_frontmatter`（解析 SKILL.md 开头 YAML frontmatter 取 name/description，无围栏 / YAML 语法错 / 解码错均返回空 dict 不抛异常）+ `_summarize_skills`（按顶层目录聚合 name/description/file_count，name=目录名与 daemon 同步路径一致，注意目录名 `sillyspec-archive` 与 frontmatter `name: sillyspec:archive` 不同）；`build_skills_manifest` 返回新增 `skills` 字段供前端清单页展示每个技能描述（不动 `files`，daemon 同步与 version 计算零影响）。`test_skills_bundle.py` 加 4 测试（frontmatter 解析 / 聚合 / 端到端 description / 无 frontmatter 空兜底），15 passed。

- ql-20260803-003-cb34 | POST /api/workspaces 复用已存在工作区时显式提示：`WorkspaceRead` 加可选 `creation_notice`（仅创建端点填，列表/详情恒 None）；`WorkspaceService.create` 加 `notice` 注入参数（默认 None 零影响）在「同 root_path 已有 active→reused_active / pending→activated_pending / 软删→resurrected」三分支填 kind；router 据此转中文提示（含 daemon 绑定未写入提醒）。`test_router.py::test_create_duplicate_returns_existing` 补回归断言（新建无提示 + 复用必带「复用」文案）。

- ql-20260809-003-56db | 多代理审计 8 个低风险单点修复（backend 部分 5 处）：release promote 死路由 require_permission→require_permission_any（路径无 workspace_id 占位符，原装饰器恒 422）；incident `update` 补 VALID_SEVERITIES 校验与 create 对称（堵 update 直接入库非法 severity）；core/errors `_request_id` 优先读 request.state.request_id 再回退 header/uuid（与 main.py 中间件 + x-request-id 响应头/慢请求日志对齐）；knowledge parser `_read_file_safe` 大文件改限量读前 MAX_CONTENT_BYTES//4 字节（OOM 防护，不整读后切片）；ppm/kanban `_parse_date_range` datetime.combine 补 tzinfo=UTC（匹配 PlanTask.end_time timestamptz）。配测试 errors×3/incident×2/knowledge×2/kanban×2/release×1，后端 pytest 110 passed + ruff 全过。

- change 2026-08-09-security-backend-guardrails | 后端防护加固（incident 状态机 + SSRF 三连）：①`incident/service.py` 加 `INCIDENT_TRANSITIONS` 放宽版图（open→{investigating,resolved}；investigating→{mitigated,open,resolved}；mitigated→{resolved,investigating}；resolved→{investigating}）+ 复用 `ppm/common/fsm.assert_transition` 校验非法迁移返 `InvalidTransition`(422)，值非法仍 `IncidentError`(400)，同态幂等，resolved 重开→investigating 清 resolved_at/by（D-001/002/006）；②新建 `core/ssrf.py` 统一 SSRF 入口 façade——`assert_public_url`（scheme 白名单 + 复用 `tool_policy.assert_public_hostname` IPv4+IPv6 全量 SSRF）+ `assert_safe_repo_url`（纯协议白名单不查 IP，拒 ext::/file:///裸路径/Windows 盘符，放行 https/ssh/git/scp-like 含内网 git）+ `UnsafeRepoUrl`(400)；③`mcp_gateway/service.py` create 注册前 + `_deliver_one` 投递前双查（投递 best-effort catch）；④`worktree/git_runner.py` clone_bare 前置 `assert_safe_repo_url`；⑤`tool_gateway/service.py` `_handle_http_get` 改 `follow_redirects=False` 手动逐跳≤3跳 + 每跳 `assert_public_url`（同时修 IPv6 私网 + 重定向不复查两缺口，工具返 result dict 不抛）。顺补 `conftest.py` db_engine 漏 import incident+release model 的 pre-existing 测试基建债（解 incident 全套 collection ERROR）。新增 test_fsm(16)+test_repo_url_guard(22)+test_ssrf(6)+test_webhook_ssrf(6)=50 用例，incident/worktree/tool_gateway/mcp_gateway 回归全绿。ruff 过、不改 OpenAPI/DTO/migration 无需 gen:types。

- change 2026-08-09-security-credentials-hygiene | 安全凭据卫生（后端部分）：`core/config.py` 加 field_validator 拒 bootstrap 管理员弱口令——模块级 `_WEAK_BOOTSTRAP_PASSWORDS` 黑名单（admin123/password/12345678 等 12 项）+ 与 email 本地部分相同拒，配置加载期 fail-fast（ValidationError）连 lifespan 都不进；`None` 放行（bootstrap 可选 D-004）。新增 `tests/modules/auth/test_bootstrap_password_strength.py` 16 用例（弱口令表参数化逐项拒 + email 同名拒 + 强口令过 + None 过）。ruff/mypy 过、auth 目录零回归（9 failed 为 login rate-limit 族既有，与本次无关）。

- change 2026-08-09-security-ppm-ownership | PPM 代填冒名防护（已上线模块，纵深防御）：新建 `ppm/common/ownership.py` 归属校验原语 `resolve_owner`（鸭子类型仅读 `actor.is_platform_admin`/`actor.id`，不查库、无 isinstance）+ `PpmOwnershipDenied`(403, code=`HTTP_403_PPM_OWNERSHIP_DENIED`，仿 `tool_policy.SsrfBlocked` 经 `core/errors` 全局 handler 按 http_status 自动映射、无需改 router)——非管理员显式填他人 execute_user_id/check_user_id/current_user_id/user_id → 403，平台管理员可代填（运维纠错），None（未指定）/自填放行。校验放 service 层（非 router）：task/problem service 7 个写方法（`PlanTaskService.start`/`execute_plan`、`TaskExecuteService.create`/`update`、`WorkHourService.create`/`update`、`ProblemService.execute_problem`）落库前各字段过 resolve_owner；router 仅透传 `actor=user`（删 execute_problem/start 的 `execute_user_id or user.id` 收窄，避免 service 层兜底遮蔽）。既有 `test_task.py`(13)/`test_problem_flow.py`(9) 处补 `actor=_ADMIN`（types.SimpleNamespace stub，test_task 含 11 直调+2 helper）放行造数，PlanTaskService.create 建计划（非冒名面）不动；新增 `common/tests/test_ownership.py`——resolve_owner 纯函数 4 分支 + PpmOwnershipDenied 错误语义（code/http_status/details）+ `start_plan_task` 端点双角色（非 admin 代填→403+code / 自填→201，admin 代填由既有 task `test_router.py` admin token 填随机 execute_user_id 走通回归）。ppm 全量 496 passed（489 既有 + 7 新增）、ruff 过、不改 OpenAPI/DTO/migration 无需 gen:types。

- change 2026-08-08-llm-provider-openai-format | llm_provider 加 api_format（anthropic/openai_chat）列 + 完整 URL 按格式归一（不加 is_full_url 列）；fetch-models/probe 按 api_format 产鉴权头（openai=纯 Bearer）+ 候选 URL，schema 透传 api_format + litellm_registered 响应；新增 litellm_client.py（register/unregister LiteLLM admin API，gap-A 定稿 model_info.mode=chat 强制 Chat Completions 走 /v1/chat/completions 非 Responses API，best-effort R-09 失败不阻塞 set/unset/delete 主流程）；lease context.py provider_config openai 形态（litellm_base_url/auth_token/model_name 6 字段，不含上游 api_key D-003/NFR-01，上游 key 只在 LiteLLM 注册）；config 加 litellm_base_url/litellm_master_key 设置；alembic 迁移 202608091100_add_llm_provider_api_format 加列；openapi.json + api-types 重生成。

- change 2026-08-10-sillyhub-platform-sync | SillySpec 跨仓进度同步契约后端落地：新建 `platform_sync` 模块（model/service/schema/auth/router 5 文件 + tests 15 用例）3 端点——POST `/api/changes/{name}/progress`（读 3 个 `X-SillySpec-*` header[User/Base-Ts/Pushed-At] + §4.2 base_ts ISO8601 字典序乐观锁：无 base_ts/stored≤base_ts→200 / stored>base_ts→409 body `{conflict,platform_progress,last_pushed_at}` 不 auto-merge）/ GET `/api/changes`（裸数组轻量列表 `[{name,current_stage,last_pushed_at,last_pusher}]`）/ GET `/api/changes/{name}/progress`（完整六表 JSON+顶层 last_pushed_at，404）。`PlatformChangeProgressORM`(BaseModel,table) 单行存 `latest_progress`(JSON)+`last_pushed_at`/`last_pusher`+`updated_at`；alembic 迁移 `20260810150000_create_platform_change_progress`（down_revision=202608091100，方言无关 create/drop）。`require_platform_sync` Bearer=APIKey(`shk_live_`)/JWT 双路径鉴权（复用 `ApiKeyService.authenticate`+`get_current_user`，无新鉴权原语）。router 不自带 prefix 避尾斜杠 307；POST 409 用 JSONResponse 绕 response_model 校验保 body 严格按契约。裸 dict 透传（NG-6 不强类型），铁律不碰派发层（D-004，与 `/api/workspaces/{wid}/changes/*` 正交）。契约 §13 校验清单 8 项 + §4.2 三分支 + §7 字典序 + 鉴权双路径 15 测试全过。gen:types 同步 `openapi.json`(361 paths)+`api-types.ts`（含 `/api/changes*` 路径 + `ChangeListItem`）。

- ql-20260811-001-8cb0 | 修复 tool_gateway test_ssrf.py mypy CI 错误（Invalid base class "real_client"）：`_patch_http_client` 里 `real_client=httpx.AsyncClient` 变量赋值后 `class _Client(real_client)` 用变量作基类，mypy 不接受非 Final 变量作基类；改 `class _Client(httpx.AsyncClient)` 直接继承、删中间变量（class 定义在 `monkeypatch.setattr` 前求值，此时 `httpx.AsyncClient` 仍是原始类，注入 transport 逻辑等价）。全量 `uv run mypy app` = Success no issues found in 589 source files（原 test_ssrf:71 error 消除，仅剩 4 个预存 annotation-unchecked note 非 error），pytest test_ssrf 18 passed。

<!-- MANUAL_NOTES_END -->
