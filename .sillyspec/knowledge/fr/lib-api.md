## FR-lib-api-001 列表页 step 级徽章
变更：2026-08-15-change-step-visibility
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 变更的 latest_progress.steps[] 非空 steps 缺失/空/结构异常；When 用户打开变更中心列表；Then 阶段徽章区显示 `step x/y`（全 stage 累计）+ 迷你进度条 + 当前步名；当前步状态映射：active→蓝脉动、waiting（wait_rea
全文：.sillyspec/changes/archive/2026-08-15-change-step-visibility/requirements.md#FR-01
最近确认：3f00a3b9d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulckm66:frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 529f34e400dca8a71e39b33efd217d1ab9bd6c91
  source_change: 2026-08-15-change-step-visibility
  status: active

## FR-lib-api-002 详情页步骤时间线
变更：2026-08-15-change-step-visibility
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 变更 steps[] 非空；When 用户打开变更详情；Then 显示按 stage 分组（STAGE_ORDER 序，quick/未知追加在后）的垂直时间线：每步名称/状态/output 摘要（截断 200 字）/完成时间（
全文：.sillyspec/changes/archive/2026-08-15-change-step-visibility/requirements.md#FR-02
最近确认：3f00a3b9d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulckmir:frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx
  tests: frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 529f34e400dca8a71e39b33efd217d1ab9bd6c91
  source_change: 2026-08-15-change-step-visibility
  status: active

## FR-lib-api-003 智能轮询不乱跳
变更：2026-08-15-change-step-visibility
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 列表/详情页打开且存在非终态变更 全部变更终态（status=="archived" || location=="archive"） document.visi；When 到达轮询间隔（列表 30s / 详情 10s）
全文：.sillyspec/changes/archive/2026-08-15-change-step-visibility/requirements.md#FR-03
最近确认：3f00a3b9d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulckmt0:frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 529f34e400dca8a71e39b33efd217d1ab9bd6c91
  source_change: 2026-08-15-change-step-visibility
  status: active

## FR-lib-api-004 后端读侧提取
变更：2026-08-15-change-step-visibility
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given platform_change_progress.latest_progress 含 steps[]；When enrich_summaries / enrich_with_workspace_ids 执行；Then ChangeSummary.step_progress 填摘要（step_total/steps_completed/current_step_name/cur
全文：.sillyspec/changes/archive/2026-08-15-change-step-visibility/requirements.md#FR-04
最近确认：3f00a3b9d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulckn3c:backend/app/modules/change/tests/test_step_progress.py
  tests: backend/app/modules/change/tests/test_step_progress.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 529f34e400dca8a71e39b33efd217d1ab9bd6c91
  source_change: 2026-08-15-change-step-visibility
  status: active

## FR-lib-api-005 上行时 owner 对齐 token 身份
变更：2026-08-16-change-owner-from-token
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 有效 shpsync_ token 上行某变更进度被接受 owner_id 不同于 token 用户 owner_id 等于 token 用户；When ux_changes.owner_id 为 None（占位行/存量）；Then 更新为 token 用户，不产生事件 同一 savepoint 内更新 owner_id 并写 owner_change 事件（detail 含 from/to
全文：.sillyspec/changes/archive/2026-08-16-change-owner-from-token/requirements.md#FR-01
最近确认：3a0ef0a24

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcktq3:backend/app/modules/platform_sync/tests/test_owner_sync.py
  tests: backend/app/modules/platform_sync/tests/test_owner_sync.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 529f34e400dca8a71e39b33efd217d1ab9bd6c91
  source_change: 2026-08-16-change-owner-from-token
  status: active

## FR-lib-api-006 通用事件表
变更：2026-08-16-change-owner-from-token
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 任一 owner 变化；Then change_events 写入一行：event_type='owner_change'、detail JSONB={from_user_id,to_user_
全文：.sillyspec/changes/archive/2026-08-16-change-owner-from-token/requirements.md#FR-02
最近确认：3a0ef0a24

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcku0u:backend/app/modules/platform_sync/tests/test_owner_sync.py
  tests: backend/app/modules/platform_sync/tests/test_owner_sync.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 529f34e400dca8a71e39b33efd217d1ab9bd6c91
  source_change: 2026-08-16-change-owner-from-token
  status: active

## FR-lib-api-007 时间线合成事件条目
变更：2026-08-16-change-owner-from-token
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 变更存在 owner_change 事件；When 详情页读取；Then 事件转为时间线条目（kind='event'，name=责任人变更，output="A → B" 用户名，completed_at=事件时间），按时间序插入步骤
全文：.sillyspec/changes/archive/2026-08-16-change-owner-from-token/requirements.md#FR-03
最近确认：3a0ef0a24

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulckuab:frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx
  tests: frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 529f34e400dca8a71e39b33efd217d1ab9bd6c91
  source_change: 2026-08-16-change-owner-from-token
  status: active

## FR-lib-api-008 用户名展示
变更：2026-08-16-change-owner-from-token
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更 owner_id 非空 owner_id 为空；Then 列表/详情显示 owner_name（display_name 优先 username fallback，批量一次 IN 查询禁 N+1） 降级现状展示（—）
全文：.sillyspec/changes/archive/2026-08-16-change-owner-from-token/requirements.md#FR-04
最近确认：3a0ef0a24

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulckujw:frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx
  tests: frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 529f34e400dca8a71e39b33efd217d1ab9bd6c91
  source_change: 2026-08-16-change-owner-from-token
  status: active

## FR-lib-api-009 履历明细不截断
变更：2026-08-16-change-owner-from-token
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 时间线条目 output 任意长度；Then 详情页全量展示（后端不截断明细、前端不 clamp 自然换行）
全文：.sillyspec/changes/archive/2026-08-16-change-owner-from-token/requirements.md#FR-05
最近确认：3a0ef0a24

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulckuuw:frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx
  tests: frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 529f34e400dca8a71e39b33efd217d1ab9bd6c91
  source_change: 2026-08-16-change-owner-from-token
  status: active

## FR-lib-api-010 扫描会话绑定工作区
变更：2026-08-18-scan-into-session
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 用户在工作区触发 scan-generate；When `start_scan_dispatch` 创建 AgentSession；Then 该 AgentSession 的 `workspace_id` 等于目标工作区 id，出现在工作区会话列表
全文：.sillyspec/changes/archive/2026-08-18-scan-into-session/requirements.md#FR-01
最近确认：6011d8222

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcl123:backend/tests/modules/agent/test_scan_interactive_dispatch.py
  tests: backend/tests/modules/agent/test_scan_interactive_dispatch.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 529f34e400dca8a71e39b33efd217d1ab9bd6c91
  source_change: 2026-08-18-scan-into-session
  status: active

## FR-lib-api-011 scan-generate 响应返回 session_id
变更：2026-08-18-scan-into-session
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 前端调用 `POST /api/workspaces/scan-generate`；When 后端完成派发（含 `_find_active_scan_run` 早返回分支）；Then 响应体含 `session_id`（早返回的老 run 无 agent_session_id 时为 null）
全文：.sillyspec/changes/archive/2026-08-18-scan-into-session/requirements.md#FR-02
最近确认：6011d8222

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcl1gx:backend/app/modules/workspace/tests/test_daemon_client_scan.py
  tests: backend/app/modules/workspace/tests/test_daemon_client_scan.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 529f34e400dca8a71e39b33efd217d1ab9bd6c91
  source_change: 2026-08-18-scan-into-session
  status: active

## FR-lib-api-012 配置卡触发扫描后进入会话页
变更：2026-08-18-scan-into-session
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 工作区配置卡用户点击「扫描」且确认重扫；When scanGenerate 成功返回；Then 前端跳转 `/workspaces/{id}/sessions?session=<session_id>`（session_id 为 null 时仅跳会话页不深
全文：.sillyspec/changes/archive/2026-08-18-scan-into-session/requirements.md#FR-03
最近确认：6011d8222

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcl1rr:frontend/src/components/workspace-config-card.test.tsx
  tests: frontend/src/components/workspace-config-card.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 529f34e400dca8a71e39b33efd217d1ab9bd6c91
  source_change: 2026-08-18-scan-into-session
  status: active

## FR-lib-api-013 会话页深链 attach scan 会话
变更：2026-08-18-scan-into-session
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 会话页 URL 带 `?session=<id>`；When 页面挂载且深链参数到达（可能早于列表异步加载）；Then 自动 attach 该会话（fetch logs → setActiveSessionId），未命中列表时直接按 id 加载不静默 no-op
全文：.sillyspec/changes/archive/2026-08-18-scan-into-session/requirements.md#FR-04
最近确认：6011d8222

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcl22k:frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
  tests: frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 529f34e400dca8a71e39b33efd217d1ab9bd6c91
  source_change: 2026-08-18-scan-into-session
  status: active

## FR-lib-api-014 会话列表展示扫描徽标
变更：2026-08-18-scan-into-session
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 工作区会话列表（include_ended=true）；When 列表项 `mode === "scan"`；Then 渲染「扫描」徽标；非 scan 会话无徽标（runtimes/变更会话零回归）
全文：.sillyspec/changes/archive/2026-08-18-scan-into-session/requirements.md#FR-05
最近确认：6011d8222

## FR-lib-api-015 移除智能体控制台
变更：2026-08-18-scan-into-session
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 移除 `/workspaces/{id}/agent` 页面；When 完成页面/快捷导航/侧边栏菜单组/仅其使用模块的删除；Then 全仓 grep `href: "agent"` / `"/agent"`（指向控制台）为零死链；任务 run 在任务详情页、阶段 run 在变更详情页执行日志可
全文：.sillyspec/changes/archive/2026-08-18-scan-into-session/requirements.md#FR-06
最近确认：6011d8222

## FR-lib-api-016 变更级会话列表同步 mode 字段
变更：2026-08-18-scan-into-session
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given `GET /workspaces/{wid}/changes/{cid}/sessions`；When 后端组装 AgentSessionListItem；Then `mode` 字段与工作区级列表一致填充（config.mode）
全文：.sillyspec/changes/archive/2026-08-18-scan-into-session/requirements.md#FR-07
最近确认：6011d8222

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcl2ej:backend/app/modules/daemon/tests/test_change_session.py
  tests: backend/app/modules/daemon/tests/test_change_session.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: 529f34e400dca8a71e39b33efd217d1ab9bd6c91
  source_change: 2026-08-18-scan-into-session
  status: active

## FR-lib-api-017 会话绑定 PPM 任务/问题（创建通道）
变更：2026-08-28-session-ppm-task-binding
状态：active
摘要：默认场景
依据决策：D-004@v2、D-005@v1
场景正文：
- 场景：默认场景 — Given 存在 PlanTask/PpmProblemList 记录（任意状态） `ppm_item_id` 不存在或已删；When 创建会话请求携带 `ppm_item_kind`（plan_task|problem）+ `ppm_item_id` 创建会话；Then 写入 `ppm_item_session_links`（幂等 upsert，唯一约束 kind+item_id+session_id），link.workspa
全文：.sillyspec/changes/archive/2026-08-28-session-ppm-task-binding/requirements.md#FR-01
最近确认：8397ea766

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcl9t1:backend/app/modules/daemon/tests/test_ppm_session.py
  tests: backend/app/modules/daemon/tests/test_ppm_session.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-08-28-session-ppm-task-binding
  status: active

## FR-lib-api-018 @联想与追问绑定（双向入口）
变更：2026-08-28-session-ppm-task-binding
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given 会话输入框（有 workspace 的会话，atEnabled 门控沿用） 预会话选中 PPM 条目后发送首句 真会话中选中 PPM 条目后追问；When 输入 @ 唤起联想 createSession 提交 injectSession 提交；Then 出现「PPM 任务」「PPM 问题」分组：任务=listPersonalPlanTasks(status=["进行中"])，问题=问题列表 duty_user_
全文：.sillyspec/changes/archive/2026-08-28-session-ppm-task-binding/requirements.md#FR-02
最近确认：8397ea766

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcla2n:frontend/src/lib/__tests__/session-mention-sources.test.tsx
  tests: frontend/src/lib/__tests__/session-mention-sources.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-08-28-session-ppm-task-binding
  status: active

## FR-lib-api-019 上下文注入（文字全字段 + 附件）
变更：2026-08-28-session-ppm-task-binding
状态：active
摘要：默认场景
依据决策：D-003@v1、D-006@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 会话绑定 PPM item 成功 item.file_urls 非空且 provider=claude 且与手动附件合并后 图≤5/文≤5 且逐条通过 _can；When create_session 组装 dispatch_prompt 物化 物化；Then 注入【PPM 任务上下文】/【问题上下文】前导（标题/描述/状态/项目/模块/责任人/周期全字段），执行序为物化在前、前导消费 attachment_lines
全文：.sillyspec/changes/archive/2026-08-28-session-ppm-task-binding/requirements.md#FR-03
最近确认：8397ea766

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulclacg:backend/app/modules/daemon/tests/test_session_service.py
  tests: backend/app/modules/daemon/tests/test_session_service.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-08-28-session-ppm-task-binding
  status: active

## FR-lib-api-020 任务/问题侧入口 + 关联会话卡片
变更：2026-08-28-session-ppm-task-binding
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v2
场景正文：
- 场景：默认场景 — Given task-plans 个人视图 / workbench 我的任务表 / problem-list 详情抽屉 任务/问题详情渲染；When 点击行/详情处「发起会话」 存在关联会话；Then store 写入 pendingPpmItem 挂起位并 requestNewSession，宿主构造 preContext.ppmItem，前端解析项目第一个
全文：.sillyspec/changes/archive/2026-08-28-session-ppm-task-binding/requirements.md#FR-04
最近确认：8397ea766

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulclapr:frontend/src/components/floating/floating-session-host.test.tsx
  tests: frontend/src/components/floating/floating-session-host.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-08-28-session-ppm-task-binding
  status: active

## FR-lib-api-021 会话列表关联筛选（ppm 维度）
变更：2026-08-28-session-ppm-task-binding
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — When 会话列表「关联」筛选选择 PPM 任务/问题选项（value 编码 `ppm:<kind>:<uuid>`）；Then listAgentSessions 透传 ppm_item_kind/ppm_item_id，后端 M:N 子查询过滤
全文：.sillyspec/changes/archive/2026-08-28-session-ppm-task-binding/requirements.md#FR-05
最近确认：8397ea766

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulclb4v:backend/app/modules/daemon/tests/test_ppm_session.py
  tests: backend/app/modules/daemon/tests/test_ppm_session.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-08-28-session-ppm-task-binding
  status: active

## FR-lib-api-022 「发起团队」预选修复
变更：2026-08-28-session-ppm-task-binding
状态：active
摘要：默认场景
依据决策：D-004@v2
场景正文：
- 场景：默认场景 — Given PPM 项目页点击「发起团队」；When 预会话面板打开；Then 派团队弹层自动打开；项目自动选中（defaultProjectId）+ scopeMode=按项目；自动拉取项目关联工作区按 workspace_id 升序预选
全文：.sillyspec/changes/archive/2026-08-28-session-ppm-task-binding/requirements.md#FR-06
最近确认：8397ea766

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulclbh5:frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx
  tests: frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-08-28-session-ppm-task-binding
  status: active

## FR-lib-api-023 群归档
变更：2026-09-03-group-chat-archive-delete
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 群主或 workspace admin 打开会话门户，群行可见 已归档的群 已解散（ended_at 非空）但未删除的群；When 点击群行 hover「归档」按钮并在确认 Modal 点「归档」 重复调用归档 群主归档；Then `agent_group_chats.archived_at = now()`，群从默认列表消失，toast 提示 无操作（幂等，行锁内早退），HTTP 204
全文：.sillyspec/changes/archive/2026-09-03-group-chat-archive-delete/requirements.md#FR-01
最近确认：3e9c2cdf3

## FR-lib-api-024 群取消归档
变更：2026-09-03-group-chat-archive-delete
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 已归档的群在「已归档会话」视图中可见（带「已归档」徽标） 未归档的群；When 群主/admin 点击群行 hover「取消归档」并确认 重复调用取消归档；Then `archived_at = NULL`，群回到默认列表，toast 确认，SSE status_changed 无操作（幂等），HTTP 204
全文：.sillyspec/changes/archive/2026-09-03-group-chat-archive-delete/requirements.md#FR-02
最近确认：3e9c2cdf3

## FR-lib-api-025 群删除（软删）
变更：2026-09-03-group-chat-archive-delete
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 活跃群（未解散） 已解散的群 已删除的群 群软删后；When 群主/admin 点击群行 hover「删除」并在确认 Modal 点「删除」 群主/admin 删除 再次删除或归档/取消归档 成员访问群列表/详情/群 SS；Then 先复用 end 收口链（全部 agent 成员影子会话置 ended + 影子队列清理 + 跳过收口直接双置 deleted_at（end_group 幂等早退
全文：.sillyspec/changes/archive/2026-09-03-group-chat-archive-delete/requirements.md#FR-03
最近确认：3e9c2cdf3

## FR-lib-api-026 归档视图与列表过滤
变更：2026-09-03-group-chat-archive-delete
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 会话门户切到「已归档会话」筛选视图 默认视图 已归档群在归档视图中被打开（归档≠解散，群仍可用）；When 群分区渲染 拉取群列表 群面板 presence 刷新；Then 拉取 `GET /group-chats?archived=true` 列表，群行带「已归档」徽标（muted `GET /group-chats` 不传参 →
全文：.sillyspec/changes/archive/2026-09-03-group-chat-archive-delete/requirements.md#FR-04
最近确认：3e9c2cdf3

## FR-lib-api-027 权限边界
变更：2026-09-03-group-chat-archive-delete
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 普通群成员（非群主非 admin） 非群成员；When 调用归档/取消归档/删除端点 调用任一新端点；Then 403「只有群主或工作区管理员可以执行该操作。」 404 不泄露群存在性
全文：.sillyspec/changes/archive/2026-09-03-group-chat-archive-delete/requirements.md#FR-05
最近确认：3e9c2cdf3

## FR-lib-api-028 会话置顶（分组内）
变更：2026-09-07-session-pin-rename-scheduled-send
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 属主已登录且会话可见（未删除） 会话已置顶 会话不存在或非属主；When 调用 `PATCH /api/daemon/sessions/{id}/pin` 再次调用 pin 调用 pin；Then `pinned_at=now` 落库，列表排序变为 `(pinned_at IS NULL) ASC, coalesce(last_active_at, cre
全文：.sillyspec/changes/archive/2026-09-07-session-pin-rename-scheduled-send/requirements.md#FR-01
最近确认：35f3d6528

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulclh0u:backend/app/modules/daemon/tests/test_session_pin_rename.py
  tests: backend/app/modules/daemon/tests/test_session_pin_rename.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-09-07-session-pin-rename-scheduled-send
  status: active

## FR-lib-api-029 取消置顶
变更：2026-09-07-session-pin-rename-scheduled-send
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 会话已置顶 会话未置顶；When 调用 `PATCH /api/daemon/sessions/{id}/unpin` 再次调用 unpin；Then `pinned_at` 置 NULL，会话回到分组内最近活跃序；SSE 广播同 FR-01 幂等无操作，204
全文：.sillyspec/changes/archive/2026-09-07-session-pin-rename-scheduled-send/requirements.md#FR-02
最近确认：35f3d6528

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulclha7:backend/app/modules/daemon/tests/test_session_pin_rename.py
  tests: backend/app/modules/daemon/tests/test_session_pin_rename.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-09-07-session-pin-rename-scheduled-send
  status: active

## FR-lib-api-030 会话重命名
变更：2026-09-07-session-pin-rename-scheduled-send
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 属主已登录 title strip 后为空或超过 255 字符；When 调用 `PATCH /api/daemon/sessions/{id}/title`，body `{"title": "新名字"}` 调用；Then `title` 列写入 strip 后值；列表标题派生逻辑（title 优先、回退首条 user_input）使其立即生效；SSE 广播 `status_cha
全文：.sillyspec/changes/archive/2026-09-07-session-pin-rename-scheduled-send/requirements.md#FR-03
最近确认：35f3d6528

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulclhjw:backend/app/modules/daemon/tests/test_session_pin_rename.py
  tests: backend/app/modules/daemon/tests/test_session_pin_rename.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-09-07-session-pin-rename-scheduled-send
  status: active

## FR-lib-api-031 定时消息创建/列表/取消（一次性）
变更：2026-09-07-session-pin-rename-scheduled-send
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given 会话属主已登录、会话非终态 dispatch_at 早于 now+60s，或 prompt 与附件全空，或会话已终态（ended/failed）/已软删 会话有；When 调用 `POST /api/daemon/sessions/{id}/scheduled`，body `{prompt, dispatch_at, attach；Then 落库一行 status=pending（快照字段原样保存，sender_user_id=当前用户），响应 201 + 完整条目；仅一次性，到点派发后不重复 42
全文：.sillyspec/changes/archive/2026-09-07-session-pin-rename-scheduled-send/requirements.md#FR-04
最近确认：35f3d6528

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulclhuq:backend/app/modules/daemon/tests/test_scheduled_messages_crud.py
  tests: backend/app/modules/daemon/tests/test_scheduled_messages_crud.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-09-07-session-pin-rename-scheduled-send
  status: active

## FR-lib-api-032 到点自动派发（sweeper）
变更：2026-09-07-session-pin-rename-scheduled-send
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 存在 status=pending 且 dispatch_at ≤ now 的条目 到点时会话正忙（有活跃 run） 到点时会话已终态或已软删 到点时会话正忙且；When sweeper 周期（30s）到达 sweeper 派发 sweeper 派发 sweeper 派发 sweeper 处理 sweeper 启动后首轮；Then 行锁复核 pending 后调 `inject_session_as_service(prompt=…, queue_when_busy=True, queue
全文：.sillyspec/changes/archive/2026-09-07-session-pin-rename-scheduled-send/requirements.md#FR-05
最近确认：35f3d6528

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcli3c:backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py
  tests: backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-09-07-session-pin-rename-scheduled-send
  status: active

## FR-lib-api-033 多端 SSE 同步
变更：2026-09-07-session-pin-rename-scheduled-send
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户在两个浏览器标签打开会话门户；When 一端置顶/取消置顶/重命名；Then 另一端经 `agent_sessions:changed` SSE 事件秒级刷新列表（复用 `publish_sessions_changed`，事件 reas
全文：.sillyspec/changes/archive/2026-09-07-session-pin-rename-scheduled-send/requirements.md#FR-06
最近确认：35f3d6528

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulclibj:backend/app/modules/daemon/tests/test_session_pin_rename.py
  tests: backend/app/modules/daemon/tests/test_session_pin_rename.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-09-07-session-pin-rename-scheduled-send
  status: active

## FR-lib-api-034 兼容与回归
变更：2026-09-07-session-pin-rename-scheduled-send
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 存量数据（无 pinned_at、无定时消息）；When 升级后首次请求；Then 列表排序与响应行为与升级前一致（pinned_at 恒 NULL 时谓词恒真）；`AgentSessionRead` 仅新增 `pinned_at` 字段，旧前
全文：.sillyspec/changes/archive/2026-09-07-session-pin-rename-scheduled-send/requirements.md#FR-07
最近确认：35f3d6528

## FR-lib-api-035 对比/裁决全链携带 workspace_id
变更：2026-09-09-conflict-root-workspace-scoping
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户在变更中心打开某工作区的冲突对比/裁决；When 前端发起 compare（查询参数已有）或 resolve（请求体新增必填 workspace_id）；Then backend → daemon 的 RPC params / WS payload 均携带 `workspace_id`；
全文：.sillyspec/changes/archive/2026-09-09-conflict-root-workspace-scoping/requirements.md#FR-01
最近确认：28b758edc

## FR-lib-api-036 daemon 按工作区映射取根，未命中不回退
变更：2026-09-09-conflict-root-workspace-scoping
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 内存映射 `_sillyspecStatusRoots` 中存在该 workspace_id 映射中不存在该 workspace_id（含 LRU；When 对比 RPC / 裁决指令带该 workspace_id 到达 对比 RPC / 裁决指令带该 workspace_id 到达；Then 用映射中的主仓根执行（不受单槽位投毒影响） 对比抛 RpcError `workspace_root_unknown`（提示「该工作区尚未被本机会话
全文：.sillyspec/changes/archive/2026-09-09-conflict-root-workspace-scoping/requirements.md#FR-02
最近确认：28b758edc

## FR-lib-api-037 legacy 调用保留单槽位语义
变更：2026-09-09-conflict-root-workspace-scoping
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 不带 workspace_id 的旧调用形态；When 对比 / 裁决到达 daemon；Then 沿用单槽位（`_statusCwd()`）读路径；单槽位为空时对比抛 `no_spec_root`
全文：.sillyspec/changes/archive/2026-09-09-conflict-root-workspace-scoping/requirements.md#FR-03
最近确认：28b758edc

## FR-lib-api-038 无 workspaceId 的 claim 不再覆盖单槽位（辅防）
变更：2026-09-09-conflict-root-workspace-scoping
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given claim 到达且 workspaceId 为 null/undefined、rootPath 任意（含 Temp）；When daemon 执行 `_noteSillySpecStatusRoot`；Then 单槽位值与落盘文件**均不变**；合法 UUID 的 claim 仍「映射+单槽位」双写
全文：.sillyspec/changes/archive/2026-09-09-conflict-root-workspace-scoping/requirements.md#FR-04
最近确认：28b758edc

## FR-lib-api-039 resolve 端点补 workspace 成员校验
变更：2026-09-09-conflict-root-workspace-scoping
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户已通过机器归属校验（owner/admin）；When 对非本人成员的 workspace_id 下发裁决；Then 403 `PermissionDenied`（文案区分「查看」（compare）/「下发裁决」（resolve）
全文：.sillyspec/changes/archive/2026-09-09-conflict-root-workspace-scoping/requirements.md#FR-05
最近确认：28b758edc

## FR-lib-api-040 （可选）502 网关文案按 daemon_code 分叉
变更：2026-09-09-conflict-root-workspace-scoping
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 对比 RPC 因 daemon 业务错误返回 502；When daemon_code = workspace_root_unknown / conflict_record_missing；Then 用户可见文案分别为「该工作区尚未被本机认领…」/「冲突记录已失效，请刷新
全文：.sillyspec/changes/archive/2026-09-09-conflict-root-workspace-scoping/requirements.md#FR-06
最近确认：28b758edc

## FR-lib-api-041 同 ts 批次逐页可达
变更：2026-09-16-logs-cursor-tiebreaker
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 单事务写入 ≥HISTORY_PAGE_SIZE(100) 行同 timestamp 的日志批次；When 前端带 (before, before_id) 复合游标向上翻页；Then 每页返回批内 id 严格更小的行，批内全部行经有限页可达（150 行批两页取尽）
全文：.sillyspec/changes/archive/2026-09-16-logs-cursor-tiebreaker/requirements.md#FR-01
最近确认：b204034fb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulclo7w:backend/app/modules/daemon/tests/test_group_logs_pagination.py
  tests: backend/app/modules/daemon/tests/test_group_logs_pagination.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-09-16-logs-cursor-tiebreaker
  status: active

## FR-lib-api-042 边界行零重叠
变更：2026-09-16-logs-cursor-tiebreaker
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 复合游标（before, before_id）；When 请求下一页；Then 返回行集与已加载行集交集为空（(ts,id) 严格小于游标，`<=` 的单行重叠同时消除）
全文：.sillyspec/changes/archive/2026-09-16-logs-cursor-tiebreaker/requirements.md#FR-02
最近确认：b204034fb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulclohb:backend/app/modules/daemon/tests/test_group_logs_pagination.py
  tests: backend/app/modules/daemon/tests/test_group_logs_pagination.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-09-16-logs-cursor-tiebreaker
  status: active

## FR-lib-api-043 旧客户端零回归
变更：2026-09-16-logs-cursor-tiebreaker
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 调用方不传 before_id；When 带 before 请求；Then 过滤行为与现行 `timestamp <= before` 完全一致（回归用例逐字节断言）
全文：.sillyspec/changes/archive/2026-09-16-logs-cursor-tiebreaker/requirements.md#FR-03
最近确认：b204034fb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcloqu:backend/app/modules/daemon/tests/test_group_logs_pagination.py
  tests: backend/app/modules/daemon/tests/test_group_logs_pagination.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-09-16-logs-cursor-tiebreaker
  status: active

## FR-lib-api-044 轮序派生零影响
变更：2026-09-16-logs-cursor-tiebreaker
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 本变更部署后；When 前端 logsToTurns 按 run_id 首见序装配轮次；Then 输入行序仍为 run 块序（ORDER BY 零改动），轮序与现状一致（同 ts 批次翻页跨页拆块的场景除外——该场景现状本就不可达，属修复目标）
全文：.sillyspec/changes/archive/2026-09-16-logs-cursor-tiebreaker/requirements.md#FR-04
最近确认：b204034fb

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulclp0y:frontend/src/lib/__tests__/agent-log-turns.test.ts
  tests: frontend/src/lib/__tests__/agent-log-turns.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-09-16-logs-cursor-tiebreaker
  status: active

## FR-lib-api-045 会话蒸馏派发
变更：2026-09-17-knowledge-precipitation
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个存在记录的 agent 会话；When 用户在知识库页「沉淀知识 → 从记录提炼」选择该会话（可附关注点提示词）并派发；Then 平台创建 knowledge-distill 类 AgentRun 后台执行，任务条显示进行中；完成后候选知识出现在待审核区（proposed/），失败时任务条
全文：.sillyspec/changes/archive/2026-09-17-knowledge-precipitation/requirements.md#FR-01
最近确认：e83c21744

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulclvo0:backend/app/modules/knowledge/tests/test_distill.py
  tests: backend/app/modules/knowledge/tests/test_distill.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-09-17-knowledge-precipitation
  status: active

## FR-lib-api-046 手工录入候选
变更：2026-09-17-knowledge-precipitation
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户具有 KNOWLEDGE_WRITE；When 填写标题/分类/正文并保存；Then 生成 `knowledge/proposed/<slug>.md`（frontmatter 含 author/created_at/proposed_at/so
全文：.sillyspec/changes/archive/2026-09-17-knowledge-precipitation/requirements.md#FR-02
最近确认：e83c21744

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulclvzh:backend/app/modules/knowledge/tests/test_writer.py
  tests: backend/app/modules/knowledge/tests/test_writer.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-09-17-knowledge-precipitation
  status: active

## FR-lib-api-047 变更蒸馏派发
变更：2026-09-17-knowledge-precipitation
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个已归档变更；When 用户选择该变更并派发蒸馏；Then 行为同 FR-01（源为变更四件套与决策记录）
全文：.sillyspec/changes/archive/2026-09-17-knowledge-precipitation/requirements.md#FR-03
最近确认：e83c21744

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulclw8z:backend/app/modules/knowledge/tests/test_distill.py
  tests: backend/app/modules/knowledge/tests/test_distill.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-09-17-knowledge-precipitation
  status: active

## FR-lib-api-048 平台直写底座
变更：2026-09-17-knowledge-precipitation
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 任何知识写操作（录入/编辑/合并/拒绝）；When 后端执行落盘；Then 全部经 spec_workspace apply_ops 语义：manifest 行版本 +1、spec_version 递增、删除内容进 30 天备份区；与上
全文：.sillyspec/changes/archive/2026-09-17-knowledge-precipitation/requirements.md#FR-04
最近确认：e83c21744

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulclwiv:backend/app/modules/knowledge/tests/test_writer.py
  tests: backend/app/modules/knowledge/tests/test_writer.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-09-17-knowledge-precipitation
  status: active

## FR-lib-api-049 审核合并与拒绝
变更：2026-09-17-knowledge-precipitation
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 待审核区一条候选；When 用户执行合并（选目标文件 ∈ {known-issues.md, patterns.md, conventions.md} + 小节标题 + 路由关键词）；Then 预览展示将追加的 `##` 小节与 INDEX 路由行；确认后两段式落盘（先目标文件+INDEX 更新、无冲突后再移除候选）；目标文件追加小节、INDEX.md
全文：.sillyspec/changes/archive/2026-09-17-knowledge-precipitation/requirements.md#FR-05
最近确认：e83c21744

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulclwsi:backend/app/modules/knowledge/tests/test_writer.py
  tests: backend/app/modules/knowledge/tests/test_writer.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-09-17-knowledge-precipitation
  status: active

## FR-lib-api-050 递归 zone 展示
变更：2026-09-17-knowledge-precipitation
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given spec 树 knowledge/ 下存在子目录（decisions/、generated/、proposed/）；When 用户打开知识库页；Then 列表递归展示全部 `*.md` 条目并按 zone 分组（待审核置顶 + 计数徽标），子目录条目可点开查看正文
全文：.sillyspec/changes/archive/2026-09-17-knowledge-precipitation/requirements.md#FR-06
最近确认：e83c21744

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulclx2n:frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-09-17-knowledge-precipitation
  status: active

## FR-lib-api-051 全层编辑
变更：2026-09-17-knowledge-precipitation
状态：active
摘要：默认场景
依据决策：D-006@v1
场景正文：
- 场景：默认场景 — Given 手册层或 generated 层一条条目；When 用户具有 KNOWLEDGE_WRITE 并编辑保存；Then 正文更新（frontmatter 保持不动，版本 +1、旧内容入备份区）；decisions/ 条目不提供编辑入口并标注"由归档流程维护"
全文：.sillyspec/changes/archive/2026-09-17-knowledge-precipitation/requirements.md#FR-07
最近确认：e83c21744

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulclxcs:backend/app/modules/knowledge/tests/test_writer.py
  tests: backend/app/modules/knowledge/tests/test_writer.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-09-17-knowledge-precipitation
  status: active

## FR-lib-api-052 全菜单按角色开关（4 个常显菜单补独立权限 key）
变更：2026-09-18-web-menu-management
状态：active
摘要：默认场景；角色收回菜单权限；角色授予菜单权限；零角色用户（已接受例外 R-07）
场景正文：
- 场景：默认场景 — Given 迁移已执行、未做任何后续配置；When 持任意角色的存量用户登录；Then 技能管理 / MCP 资产库 / 智能体档案 / 智能体会话 4 个菜单可见性与迁移前一致（种子已将 `skill:read`/`mcp:read`/`agen
- 场景：角色收回菜单权限 — Given 某角色的权限集合不含 `skill:read`；When 该角色用户登录后查看侧边栏；Then 「技能管理」菜单不显示
- 场景：角色授予菜单权限 — Given 管理员在角色管理页为角色勾选 `skill:read`；When 该角色用户重新登录或权限缓存失效后（TTL 300s）；Then 「技能管理」菜单显示
- 场景：零角色用户（已接受例外 R-07） — Given 用户不持有任何角色；When 登录后查看侧边栏；Then 4 个菜单不可见（现状语义为可见；该人群本无任何权限门控菜单，接受并记录）
全文：.sillyspec/changes/archive/2026-09-18-web-menu-management/requirements.md#FR-01
最近确认：d2b380ae2

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcm3j9:frontend/src/lib/__tests__/menu-permissions.test.ts
  tests: frontend/src/lib/__tests__/menu-permissions.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-09-18-web-menu-management
  status: active

## FR-lib-api-053 菜单管理页（改名 / 组内排序 / 全局隐藏，行级即时保存）
变更：2026-09-18-web-menu-management
状态：active
摘要：默认场景；恢复默认显示名；组内排序；全局隐藏；菜单管理入口自锁防护（R-03）
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 管理员（持 `menu:admin`）打开 `/admin/menus`；When 将某菜单显示名改为新名并确认；Then PUT `/api/menu-overrides/{menu_key}` 保存成功，任意用户（含平台管理员）导航渲染新名；写审计日志
- 场景：恢复默认显示名 — Given 某菜单存在 label_override；When 管理员点「恢复默认」（label 置 null 或整行 DELETE）；Then 导航恢复代码默认名
- 场景：组内排序 — When 管理员对某分组内菜单上移/下移；Then 该菜单 sort_order 更新并持久化，导航同分组内顺序随之变化；分组结构与分组顺序不变（代码定义）
- 场景：全局隐藏 — When 管理员开启某菜单的隐藏开关（hidden=true）；Then 所有用户侧边栏不显示该菜单（含平台管理员）；URL 直达仍可行
- 场景：菜单管理入口自锁防护（R-03） — When 管理员尝试隐藏 menuKey="menus"（菜单管理自身）；Then 管理页开关为 disabled 不可操作；即使经 API 直接写入 hidden，前端合并层对该 key 豁免恒显（对持 menu:admin 者）
全文：.sillyspec/changes/archive/2026-09-18-web-menu-management/requirements.md#FR-02
最近确认：d2b380ae2

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcm3sd:frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx
  tests: frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-09-18-web-menu-management
  status: active

## FR-lib-api-054 挂载权限与持有角色只读展示
变更：2026-09-18-web-menu-management
状态：active
摘要：默认场景；缺 role:read 的优雅降级（R-08）
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 管理员展开某菜单的权限明细；When 数据加载完成；Then 显示该菜单挂载的每个权限 key（代码体）、中文名、当前持有角色 chips（数据来自既有 `GET /api/admin/roles` 响应 `permiss
- 场景：缺 role:read 的优雅降级（R-08） — Given 管理员仅持 `menu:admin` 不持 `role:read`；When 展开权限明细；Then 角色 chips 区显示占位「需 role:read 查看角色分布」，权限 key 与中文名正常显示，改名/排序/隐藏主功能不受阻
全文：.sillyspec/changes/archive/2026-09-18-web-menu-management/requirements.md#FR-03
最近确认：d2b380ae2

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcm41k:frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx
  tests: frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-09-18-web-menu-management
  status: active

## FR-lib-api-055 前端权限 key 编译期守卫
变更：2026-09-18-web-menu-management
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given `menu-permissions.ts` 的 `PermissionItem.key` 类型已收紧为 api-types 生成的 Permission 联合类；When 开发者引用后端枚举中不存在的权限 key；Then `tsc` 编译报错（不再等到运行时 422）
全文：.sillyspec/changes/archive/2026-09-18-web-menu-management/requirements.md#FR-04
最近确认：d2b380ae2

## FR-lib-api-056 覆盖只读下发端点与导航合并
变更：2026-09-18-web-menu-management
状态：active
摘要：默认场景；未配置覆盖；拉取失败降级；孤儿覆盖容忍（R-01）
场景正文：
- 场景：默认场景 — Given 任意已认证用户；When 前端导航加载调用 GET `/api/menu-overrides`；Then 返回全量覆盖列表（无敏感信息，仅显示配置）
- 场景：未配置覆盖 — Given `menu_overrides` 表为空；When 任意用户登录；Then `mergeMenus` 直通注册表，导航渲染与现状逐项一致
- 场景：拉取失败降级 — When GET `/api/menu-overrides` 请求失败；Then 导航按空覆盖直通渲染，不阻塞、不报错弹窗
- 场景：孤儿覆盖容忍（R-01） — Given 覆盖表中存在注册表已无对应条目的 menu_key；When 导航合并；Then 该覆盖被忽略，无报错
全文：.sillyspec/changes/archive/2026-09-18-web-menu-management/requirements.md#FR-05
最近确认：d2b380ae2

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcm4dd:frontend/src/lib/__tests__/menu-overrides.test.ts
  tests: frontend/src/lib/__tests__/menu-overrides.test.ts
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-09-18-web-menu-management
  status: active

## FR-lib-api-057 覆盖率分母分层（可路由口径）
变更：2026-09-25-knowledge-stats-layering
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-knowledge-stats-layering/requirements.md#FR-01
最近确认：6e023509d2ad8e6aa19188004a703bc77e2ee16e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-knowledge-stats-layering:flow:FR-01
  tests: backend/app/modules/knowledge/tests/test_hits.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-25-knowledge-stats-layering
  status: active

## FR-lib-api-058 失效命中（幽灵锚）单列
变更：2026-09-25-knowledge-stats-layering
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-knowledge-stats-layering/requirements.md#FR-02
最近确认：6e023509d2ad8e6aa19188004a703bc77e2ee16e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-knowledge-stats-layering:flow:FR-02
  tests: backend/app/modules/knowledge/tests/test_hits.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-25-knowledge-stats-layering
  status: active

## FR-lib-api-059 数据截止时间
变更：2026-09-25-knowledge-stats-layering
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-knowledge-stats-layering/requirements.md#FR-03
最近确认：6e023509d2ad8e6aa19188004a703bc77e2ee16e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-knowledge-stats-layering:flow:FR-03
  tests: backend/app/modules/knowledge/tests/test_hits.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-25-knowledge-stats-layering
  status: active

## FR-lib-api-060 前端运营面板配套
变更：2026-09-25-knowledge-stats-layering
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-knowledge-stats-layering/requirements.md#FR-04
最近确认：6e023509d2ad8e6aa19188004a703bc77e2ee16e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-knowledge-stats-layering:flow:FR-04
  tests: frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-25-knowledge-stats-layering
  status: active

## FR-lib-api-061 契约同步
变更：2026-09-25-knowledge-stats-layering
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-knowledge-stats-layering/requirements.md#FR-05
最近确认：6e023509d2ad8e6aa19188004a703bc77e2ee16e

## FR-lib-api-062 测试与零回归
变更：2026-09-25-knowledge-stats-layering
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-knowledge-stats-layering/requirements.md#FR-06
最近确认：6e023509d2ad8e6aa19188004a703bc77e2ee16e

## FR-lib-api-063 可路由判定与锚点容错同源
变更：2026-09-25-knowledge-stats-layering
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-knowledge-stats-layering/requirements.md#FR-07
最近确认：6e023509d2ad8e6aa19188004a703bc77e2ee16e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-knowledge-stats-layering:flow:FR-07
  tests: backend/app/modules/knowledge/tests/test_hits.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-25-knowledge-stats-layering
  status: active

## FR-lib-api-064 前端可路由口径回退
变更：2026-09-25-knowledge-stats-layering
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-knowledge-stats-layering/requirements.md#FR-08
最近确认：6e023509d2ad8e6aa19188004a703bc77e2ee16e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-knowledge-stats-layering:flow:FR-08
  tests: frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-25-knowledge-stats-layering
  status: active

## FR-lib-api-065 失效命中期开合交互
变更：2026-09-25-knowledge-stats-layering
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-knowledge-stats-layering/requirements.md#FR-09
最近确认：6e023509d2ad8e6aa19188004a703bc77e2ee16e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-knowledge-stats-layering:flow:FR-09
  tests: frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-25-knowledge-stats-layering
  status: active

## FR-lib-api-066 数据截至展示形态
变更：2026-09-25-knowledge-stats-layering
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-knowledge-stats-layering/requirements.md#FR-10
最近确认：6e023509d2ad8e6aa19188004a703bc77e2ee16e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-knowledge-stats-layering:flow:FR-10
  tests: frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-25-knowledge-stats-layering
  status: active

## FR-lib-api-067 gen:types 契约闭环
变更：2026-09-25-knowledge-stats-layering
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-knowledge-stats-layering/requirements.md#FR-11
最近确认：6e023509d2ad8e6aa19188004a703bc77e2ee16e

## FR-lib-api-068 退化与零命中端用例
变更：2026-09-25-knowledge-stats-layering
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-knowledge-stats-layering/requirements.md#FR-12
最近确认：6e023509d2ad8e6aa19188004a703bc77e2ee16e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-knowledge-stats-layering:flow:FR-12
  tests: backend/app/modules/knowledge/tests/test_hits.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-25-knowledge-stats-layering
  status: active

## FR-lib-api-069 端点形状契约更新
变更：2026-09-25-knowledge-stats-layering
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-knowledge-stats-layering/requirements.md#FR-13
最近确认：6e023509d2ad8e6aa19188004a703bc77e2ee16e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-knowledge-stats-layering:flow:FR-13
  tests: backend/app/modules/knowledge/tests/test_hits.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-25-knowledge-stats-layering
  status: active

## FR-lib-api-070 三向对账端点
变更：2026-09-26-spec-consistency-writer
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-spec-consistency-writer/requirements.md#FR-01
最近确认：be2883b6f40375652f6e48221fea775117a774f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-26-spec-consistency-writer:flow:FR-01
  tests: backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 4d34ed131ad55d9d98502b0e342a9af79289fcb4
  source_change: 2026-09-26-spec-consistency-writer
  status: active

## FR-lib-api-071 写方记录
变更：2026-09-26-spec-consistency-writer
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-spec-consistency-writer/requirements.md#FR-02
最近确认：be2883b6f40375652f6e48221fea775117a774f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcm4rb:backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py
  tests: backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-09-26-spec-consistency-writer
  status: active

## FR-lib-api-072 写方切换告警
变更：2026-09-26-spec-consistency-writer
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-spec-consistency-writer/requirements.md#FR-03
最近确认：be2883b6f40375652f6e48221fea775117a774f8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: manual:mulcm519:backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py
  tests: backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py
  reason: spec
  state: active
  discovery: agent
  confirmed_by: agent
  confirmed_at: c23caca58108db852a5d1658a772d392f07e17cd
  source_change: 2026-09-26-spec-consistency-writer
  status: active

## FR-lib-api-073 Read DTO 透传
变更：2026-09-26-spec-consistency-writer
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-spec-consistency-writer/requirements.md#FR-04
最近确认：be2883b6f40375652f6e48221fea775117a774f8

## FR-lib-api-074 DB 迁移
变更：2026-09-26-spec-consistency-writer
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-spec-consistency-writer/requirements.md#FR-05
最近确认：be2883b6f40375652f6e48221fea775117a774f8

## FR-lib-api-075 契约与零回归
变更：2026-09-26-spec-consistency-writer
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-26-spec-consistency-writer/requirements.md#FR-06
最近确认：be2883b6f40375652f6e48221fea775117a774f8

## FR-lib-api-076 Change 表新增 description 可空列（alembic 迁移），reparse 与文档
变更：change-list-description
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 迁移 相关模块就绪；When Change 表新增 description 可空列（alembic 迁移），reparse 与文档推送两条写路径同源提取不互翻；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/change-list-description/requirements.md#FR-01
最近确认：581ee6412672d6db110f6f0ec6e3114278bef231

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: change-list-description:flow:FR-01
  tests: backend/app/modules/change/tests/test_title_normalization.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: change-list-description
  status: active

## FR-lib-api-077 提取规则：proposal.md 动机段首个非空段落，剥机器注释与「任务原话转写：」前缀、截到「成功
变更：change-list-description
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 提取规；Then ：proposal.md 动机段首个非空段落，剥机器注释与「任务原话转写：」前缀、截到「成功标准」行前，最长 500 字符
全文：.sillyspec/changes/archive/change-list-description/requirements.md#FR-02
最近确认：581ee6412672d6db110f6f0ec6e3114278bef231

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: change-list-description:flow:FR-02
  tests: backend/app/modules/change/tests/test_title_normalization.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: change-list-description
  status: active

## FR-lib-api-078 ChangeSummary
变更：change-list-description
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When ChangeSummary；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/change-list-description/requirements.md#FR-03
最近确认：581ee6412672d6db110f6f0ec6e3114278bef231

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: change-list-description:flow:FR-03
  tests: backend/app/modules/change/tests/test_title_normalization.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: change-list-description
  status: active

## FR-lib-api-079 ChangeRead 带 description
变更：change-list-description
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When ChangeRead 带 description；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/change-list-description/requirements.md#FR-04
最近确认：581ee6412672d6db110f6f0ec6e3114278bef231

## FR-lib-api-080 列表搜索 ILIKE 同时命中 change_key/title/description
变更：change-list-description
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 列表搜索 ILIKE 同时命中 change_key/title/description；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/change-list-description/requirements.md#FR-05
最近确认：581ee6412672d6db110f6f0ec6e3114278bef231

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: change-list-description:flow:FR-05
  tests: backend/app/modules/change/tests/test_title_normalization.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: change-list-description
  status: active

## FR-lib-api-081 变更中心列表（桌面与移动）行内展示描述（单行截断、悬浮全文），无描述行零占位
变更：change-list-description
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 变更中心列表（桌面与移动）行内展示描述（单行截断、悬浮全文），无描述行零占位；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/change-list-description/requirements.md#FR-06
最近确认：581ee6412672d6db110f6f0ec6e3114278bef231

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: change-list-description:flow:FR-06
  tests: frontend/src/app/page.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: change-list-description
  status: active

## FR-lib-api-082 相关 backend pytest 与 frontend 测试通过
变更：change-list-description
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 相关 backend pytest 与 frontend 测试通过；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/change-list-description/requirements.md#FR-07
最近确认：581ee6412672d6db110f6f0ec6e3114278bef231

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: change-list-description:flow:FR-07
  tests: backend/app/modules/change/tests/test_title_normalization.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: change-list-description
  status: active

## FR-lib-api-083 api-types 由 pnpm gen:types 再生成并随变更提交
变更：change-list-description
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given api 相关模块就绪；When api-types 由 pnpm gen:types 再生成并随变更提交；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/change-list-description/requirements.md#FR-08
最近确认：581ee6412672d6db110f6f0ec6e3114278bef231

## FR-lib-api-084 上报协议 v2 携带机器身份并落库
变更：2026-09-30-tool-report-activation-wrong-machine
状态：active
摘要：默认场景；老协议兼容
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given `POST /api/platform-sync/agent-logs` 上报链路（CLI 直跑与 daemon 注入两路）；When entries 携带 `machine` 块（`machine_id?`、`hostname?`）；Then platform_agent_logs MUST 落 `reported_machine_id`/`reported_machine_name` 两列；会话聚合
- 场景：老协议兼容 — Given 老 CLI 上报不含 machine 块；When upsert 处理该 entries；Then 两列 MUST 落 NULL 且 MUST NOT 报错（extra=ignore 既有行为），上报幂等语义不变
全文：.sillyspec/changes/archive/2026-09-30-tool-report-activation-wrong-machine/requirements.md#FR-01
最近确认：58a3516c9

## FR-lib-api-085 分叉式接手（原会话只读）
变更：2026-09-30-tool-report-activation-wrong-machine
状态：active
摘要：默认场景；旧入口拒绝
依据决策：D-006@v1
场景正文：
- 场景：默认场景 — Given 未激活 tool_report 会话（status=pending、turn_count=0）；When 用户在输入区发送首条消息（POST /sessions/{id}/takeover）；Then 后端 MUST 创建新接手会话（origin='fork' + `fork_of_session_id`=源会话 + fork 三件套，源会话零 run 时 `
- 场景：旧入口拒绝 — Given pending tool_report 会话收到 inject 请求；Then MUST 返回 409 + 中文指引（引导 takeover 端点），懒激活分支 MUST 已退役（`_activate_tool_report_session
全文：.sillyspec/changes/archive/2026-09-30-tool-report-activation-wrong-machine/requirements.md#FR-02
最近确认：58a3516c9

## FR-lib-api-086 原机四级钉定派发
变更：2026-09-30-tool-report-activation-wrong-machine
状态：active
摘要：默认场景；原机离线
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given takeover 请求；When 解析目标 runtime；Then MUST 按四级顺序匹配：① 最新 entry `reported_machine_id` 精确匹配在线 runtime → ② `reported_machi
- 场景：原机离线 — Given 上报机器可识别（①②级命中身份）但该机器 runtime 离线；When takeover；Then MUST 409（文案含机器名），MUST NOT 建会话 MUST NOT 回退其它机器
全文：.sillyspec/changes/archive/2026-09-30-tool-report-activation-wrong-machine/requirements.md#FR-03
最近确认：58a3516c9

## FR-lib-api-087 引擎分档衔接（native resume / handoff 交接文档）
变更：2026-09-30-tool-report-activation-wrong-machine
状态：active
摘要：默认场景；handoff 引擎/档案重选；交接文档读取失败降级
依据决策：D-004@v1、D-005@v2
场景正文：
- 场景：默认场景 — Given 源会话 harness 可判定；When takeover 分档；Then harness ∈ {claude-code, codex}（caps.resume=True）MUST 走 native 档：lease metadata 携
- 场景：handoff 引擎/档案重选 — Given handoff 档请求携带 provider/agent_profile_id/llm_provider_id；When 校验；Then 所选 provider MUST 属于原机 runtime 支持集合（按 daemon_instance 聚合），不符 MUST 422；默认值 = harne
- 场景：交接文档读取失败降级 — Given 原机在线但 RPC 读日志失败；When handoff 档组装；Then MUST 降级为普通新会话激活（不带交接文档），响应 `handoff_doc=false` 供前端提示，MUST NOT 阻塞接手
全文：.sillyspec/changes/archive/2026-09-30-tool-report-activation-wrong-machine/requirements.md#FR-04
最近确认：58a3516c9

## FR-lib-api-088 存量钉死会话一键重置
变更：2026-09-30-tool-report-activation-wrong-machine
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 存量已激活（旧懒激活路径）钉死在错误机器的 tool_report 会话；When 属主调用 POST /sessions/{id}/reset-tool-report；Then 后端 MUST 校验（origin=tool_report、属主、无 running run，running 时 409）后回滚：status=pending、
全文：.sillyspec/changes/archive/2026-09-30-tool-report-activation-wrong-machine/requirements.md#FR-05
最近确认：58a3516c9

## FR-lib-api-089 前端衔接状态 UI
变更：2026-09-30-tool-report-activation-wrong-machine
状态：active
摘要：默认场景；普通会话零影响
依据决策：D-002@v1、D-005@v2、D-006@v1
场景正文：
- 场景：默认场景 — Given 未激活 tool_report 会话面板；When 渲染输入区
- 场景：普通会话零影响 — Given origin=chat 会话；When 渲染会话面板；Then 以上新元素 MUST NOT 出现
全文：.sillyspec/changes/archive/2026-09-30-tool-report-activation-wrong-machine/requirements.md#FR-06
最近确认：58a3516c9

## FR-lib-api-090 stats 聚合端点
变更：2026-09-21-scan-docs-ops-panel
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given workspace 的 scan_documents 表已有数据（reparse 后）；When 调用 GET /workspaces/{ws}/scan-docs/stats（SCAN_DOCS_READ）；Then 返回 ScanDocsStatsOut：coverage（std_have/std_expected/module_have/module_expected +
全文：.sillyspec/changes/archive/2026-09-21-scan-docs-ops-panel/requirements.md#FR-01
最近确认：e05d03fed

## FR-lib-api-091 覆盖率两级口径（含模块文档层）
变更：2026-09-21-scan-docs-ops-panel
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given docs 树按项目分组（剥 .sillyspec/docs 前缀后第一段）；When 计算覆盖率；Then 七件套：have=各项目 scan/ 下 doc_type ∈ STANDARD_DOC_TYPES 去重计数，expected=项目数×7；模块层：have=
全文：.sillyspec/changes/archive/2026-09-21-scan-docs-ops-panel/requirements.md#FR-02
最近确认：e05d03fed

## FR-lib-api-092 运营指标面板
变更：2026-09-21-scan-docs-ops-panel
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given workspace 已有扫描文档；When 打开 scan-docs 页；Then PageHeader 之下渲染面板（视觉对齐知识库 OpsDashboard）：指标大卡四子卡——标准文档覆盖率（百分比+两档明细+8 周趋势折线）、陈旧文档（
全文：.sillyspec/changes/archive/2026-09-21-scan-docs-ops-panel/requirements.md#FR-03
最近确认：e05d03fed

## FR-lib-api-093 三态健壮
变更：2026-09-21-scan-docs-ops-panel
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given stats 接口异常 / 工作区无文档 / 加载中；When 面板渲染；Then 分别显示错误条（不白屏、不影响主列表）/ 空态卡 / 加载占位，三者占住同版位避免布局跳动
全文：.sillyspec/changes/archive/2026-09-21-scan-docs-ops-panel/requirements.md#FR-04
最近确认：e05d03fed

## FR-lib-api-094 类型链同步
变更：2026-09-21-scan-docs-ops-panel
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 后端新增 stats DTO；When 实现完成；Then pnpm gen:types 再生成 api-types.ts + openapi.json 并同变更提交；前端消费生成类型（components["schem
全文：.sillyspec/changes/archive/2026-09-21-scan-docs-ops-panel/requirements.md#FR-05
最近确认：e05d03fed

## FR-lib-api-095 docs 注入遥测链（CLI→daemon→平台）
变更：2026-09-21-scan-docs-ops-panel
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given CLI 模块上下文注入命中；When 注入发生；Then sillyspec CLI 经既有 appendKnowledgeHit 追加 `{type:'docs-inject', change, query, mat
全文：.sillyspec/changes/archive/2026-09-21-scan-docs-ops-panel/requirements.md#FR-06
最近确认：e05d03fed

## FR-lib-api-096 注入频次指标与榜单双 tab
变更：2026-09-21-scan-docs-ops-panel
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given knowledge_hits 表存在 type='docs-inject' 行；When stats 聚合与面板渲染；Then injection 字段返回近 30 天总次数/被注入文档数/文档级频次榜 Top 10（路径剥前缀对齐 scan_documents）；右侧榜单双 tab——
全文：.sillyspec/changes/archive/2026-09-21-scan-docs-ops-panel/requirements.md#FR-07
最近确认：e05d03fed

## FR-lib-api-097 agent-logs 上报后异步摄取用量快照
变更：2026-10-02-change-center-token-usage
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — When 上报响应返回后 后台任务筛选候选 再次上报触发摄取 落库 摄取；Then backend 以 fire-and-forget 后台任务对候选 entry 逐个解析用量并覆盖写 `platform_agent_logs` 五列快照；上报
全文：.sillyspec/changes/archive/2026-10-02-change-center-token-usage/requirements.md#FR-01
最近确认：0dc1de6bd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-02-change-center-token-usage:task-02:acc-0-c923036f
  tests: backend/app/modules/platform_sync/tests/test_usage_ingest.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-02-change-center-token-usage
  status: active
- row: 2026-10-02-change-center-token-usage:task-02:acc-1-f27e8f0b
  tests: backend/app/modules/platform_sync/tests/test_usage_ingest.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-02-change-center-token-usage
  status: active
- row: 2026-10-02-change-center-token-usage:task-02:acc-2-5493d570
  tests: backend/app/modules/platform_sync/tests/test_usage_ingest.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-02-change-center-token-usage
  status: active
- row: 2026-10-02-change-center-token-usage:task-02:acc-3-11cd8d62
  tests: backend/app/modules/platform_sync/tests/test_usage_ingest.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-02-change-center-token-usage
  status: active

## FR-lib-api-098 变更/快速修复用量聚合并入本地 CLI 段
变更：2026-10-02-change-center-token-usage
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — When 聚合该变更用量 聚合 聚合 分别查看各变更用量 聚合；Then 本地段 SUM 四维 token 并入 totals，并形成 by_model「本地 CLI」桶行（api_requests=0）；本地段不贡献时间三元组、轮次
全文：.sillyspec/changes/archive/2026-10-02-change-center-token-usage/requirements.md#FR-02
最近确认：0dc1de6bd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-02-change-center-token-usage:task-03:acc-0-f61e3d02
  tests: backend/app/modules/change/tests/test_usage_stats.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-02-change-center-token-usage
  status: active
- row: 2026-10-02-change-center-token-usage:task-03:acc-1-733c02ef
  tests: backend/app/modules/change/tests/test_usage_stats.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-02-change-center-token-usage
  status: active
- row: 2026-10-02-change-center-token-usage:task-03:acc-2-ae5c134d
  tests: backend/app/modules/change/tests/test_usage_stats.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-02-change-center-token-usage
  status: active

## FR-lib-api-099 前端用量展示扩展
变更：2026-10-02-change-center-token-usage
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 变更/快速修复的用量数据含本地 CLI 段 纯本地 CLI 变更（无 runs：时间三元组 None、轮次 0）且 totals 非 0；When 用户查看详情用量卡 用户查看列表「执行」列 渲染用量卡；Then 摘要行四维 token 为合并值；明细表出现「本地 CLI」绿阶 tag 桶行（对齐「未记录」灰阶兜底桶先例），其请求列显示「—」，命中率照常计算；口径注脚更新
全文：.sillyspec/changes/archive/2026-10-02-change-center-token-usage/requirements.md#FR-03
最近确认：0dc1de6bd

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-02-change-center-token-usage:task-04:acc-0-ca3d9e65
  tests: frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-02-change-center-token-usage
  status: active
- row: 2026-10-02-change-center-token-usage:task-04:acc-1-66e6bc18
  tests: frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-02-change-center-token-usage
  status: active
- row: 2026-10-02-change-center-token-usage:task-04:acc-2-ac0f5209
  tests: frontend/src/components/changes/detail/__tests__/change-usage-card.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-02-change-center-token-usage
  status: active

## FR-lib-api-100 兼容与回退
变更：2026-10-02-change-center-token-usage
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 未升级（read_agent_log_messages 未注册） 迁移回退（downgrade）；When 摄取任务 RPC 执行；Then 回 method_not_found → 捕获跳过（复用回放通道既有异常分类），上报主流程不受影响 5 列删除，聚合本地段空结果时与改造前完全一致（API DT
全文：.sillyspec/changes/archive/2026-10-02-change-center-token-usage/requirements.md#FR-04
最近确认：0dc1de6bd

## FR-lib-api-101 供应商模型列表
变更：2026-10-06-provider-model-list
状态：active
摘要：默认场景；条目角色标记
依据决策：D-001@v1、D-002@v1、D-005@v1
场景正文：
- 场景：默认场景 — Given 供应商创建/编辑表单；When 用户添加多条模型条目（名称 + 多模态三态 + 可选角色标记 + one_m）；Then 行 models 列表存储条目数组（条数不限）；Claude 角色可多标；其它引擎不标角色
- 场景：条目角色标记 — Given 一条模型标了 sonnet 角色；When Claude 会话解析该供应商；Then ANTHROPIC_MODEL 与 ANTHROPIC_DEFAULT_SONNET_MODEL 指向该模型（one_m 按 [1m] 后缀语义）
全文：.sillyspec/changes/archive/2026-10-06-provider-model-list/requirements.md#FR-01
最近确认：965f15b80

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-06-provider-model-list:task-01:acc-0-9b8f28e0
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-01:acc-1-bf1e7652
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-01:acc-2-72f01c07
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-01:acc-3-03de6035
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-01:acc-4-523bf3a5
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-01:acc-5-17acbff1
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-02:acc-0-6a89242d
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-02:acc-1-f3ca95a6
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-02:acc-2-5cb30b88
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-02:acc-3-4672926d
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-03:acc-0-341b82db
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-03:acc-1-1598f897
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-03:acc-2-79d5bc34
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-03:acc-3-b8782a0f
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-04:acc-0-6bffaf10
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-04:acc-1-1e30d804
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-04:acc-2-af4cbe49
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-04:acc-3-31f842a8
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-04:acc-4-bd467d6c
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-07:acc-0-ac9dffd4
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-07:acc-1-81656c3e
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-07:acc-2-03c179de
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-07:acc-3-6677c6aa
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-08:acc-0-8c6eadc3
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-08:acc-1-d2941603
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-08:acc-2-1a26f86c
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-08:acc-3-4855a4d7
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-08:acc-4-0949c1e1
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-09:acc-0-71553574
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-09:acc-1-0c9aba43
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-09:acc-2-75fa116b
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-09:acc-3-57d605c2
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-10:acc-0-1aed0131
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-10:acc-1-82fcf3cf
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-10:acc-2-7f65152a
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-11:acc-0-00f3de17
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-11:acc-1-bcc46a67
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-11:acc-2-725896fe
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-11:acc-3-216bf9e1
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-11:acc-4-710228c6
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active

## FR-lib-api-102 多模态下沉模型级
变更：2026-10-06-provider-model-list
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 附件门控判定；When 会话生效模型在供应商 models 列表内；Then 按条目 multimodal 三态判定（auto 走模型名启发式 / true / false）；列表未命中保守 false
全文：.sillyspec/changes/archive/2026-10-06-provider-model-list/requirements.md#FR-02
最近确认：965f15b80

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-06-provider-model-list:task-05:acc-0-843c4093
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-05:acc-1-5de9c319
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-05:acc-2-b43f241d
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-05:acc-3-9b3471ca
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active

## FR-lib-api-103 会话选模型
变更：2026-10-06-provider-model-list
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 会话配置条模型下拉；When 用户选择模型；Then 选项来自供应商 models 列表；选列表外模型 MUST 422（带可用模型提示）；主模型派生 = sonnet 首条 ?? 列表首条
全文：.sillyspec/changes/archive/2026-10-06-provider-model-list/requirements.md#FR-03
最近确认：965f15b80

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-06-provider-model-list:task-06:acc-0-5874b7a1
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-06:acc-1-b5ca94a2
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-06:acc-2-fcba8fe4
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active
- row: 2026-10-06-provider-model-list:task-06:acc-3-4860a741
  tests: backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-provider-model-list
  status: active

## FR-lib-api-104 注入折算契约保持
变更：2026-10-06-provider-model-list
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given claim/切换下发 provider_config；Then model 与 default_fallback_model 两键同值 = 会话所选 ?? 主模型；model_role_mappings 键形态与 daemo
全文：.sillyspec/changes/archive/2026-10-06-provider-model-list/requirements.md#FR-04
最近确认：965f15b80

## FR-lib-api-105 存量自动折算
变更：2026-10-06-provider-model-list
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 迁移执行；Then [model] + [default_fallback_model] + 4 槽值去重折算成列表（多模态标 auto、角色归并、one_m 透传、display
全文：.sillyspec/changes/archive/2026-10-06-provider-model-list/requirements.md#FR-05
最近确认：965f15b80

## FR-lib-api-106 删除 14 个零端点消费的死权限（枚举 72→58）
变更：2026-10-08-rbac-dead-permissions-cleanup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-08-rbac-dead-permissions-cleanup/requirements.md#FR-01
最近确认：765f4e7b684aa63c7d98653aa6b3e89af1057321

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-rbac-dead-permissions-cleanup:flow:测试绑定FR-01
  tests: backend/tests/modules/auth/test_permissions.py「test_permission_count_is_58」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-rbac-dead-permissions-cleanup
  status: active

## FR-lib-api-107 活权限 task:create / task:assign 挂变更中心卡
变更：2026-10-08-rbac-dead-permissions-cleanup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-08-rbac-dead-permissions-cleanup/requirements.md#FR-02
最近确认：765f4e7b684aa63c7d98653aa6b3e89af1057321

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-rbac-dead-permissions-cleanup:flow:测试绑定FR-02
  tests: frontend/src/lib/__tests__/menu-permissions.test.ts「changes = change:create/read/approve/archive + task:read/create/assign（2026-10-08 清理版）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-rbac-dead-permissions-cleanup
  status: active

## FR-lib-api-108 存量数据清理迁移（16 死字符串）
变更：2026-10-08-rbac-dead-permissions-cleanup
状态：active
摘要：存量收敛
全文：.sillyspec/changes/archive/2026-10-08-rbac-dead-permissions-cleanup/requirements.md#FR-03
最近确认：765f4e7b684aa63c7d98653aa6b3e89af1057321

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-rbac-dead-permissions-cleanup:flow:测试绑定FR-03
  tests: backend/tests/modules/auth/test_permissions.py「test_drop_dead_rbac_migration_upgrade_deletes_and_downgrade_replants」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-rbac-dead-permissions-cleanup
  status: active

## FR-lib-api-109 前端菜单卡与角色页同步
变更：2026-10-08-rbac-dead-permissions-cleanup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-08-rbac-dead-permissions-cleanup/requirements.md#FR-04
最近确认：765f4e7b684aa63c7d98653aa6b3e89af1057321

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-rbac-dead-permissions-cleanup:flow:测试绑定FR-04
  tests: frontend/src/lib/__tests__/menu-permissions.test.ts「所有 permission.key 命中 BACKEND_PERMISSION_KEYS，且镜像常量长度 === 58」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-rbac-dead-permissions-cleanup
  status: active

## FR-lib-api-110 测试同步全绿 + 静态检查零新增
变更：2026-10-08-rbac-dead-permissions-cleanup
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-08-rbac-dead-permissions-cleanup/requirements.md#FR-05
最近确认：765f4e7b684aa63c7d98653aa6b3e89af1057321

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-rbac-dead-permissions-cleanup:flow:测试绑定FR-05
  tests: backend/tests/modules/auth/test_permissions.py | frontend/src/lib/__tests__/menu-permissions.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-rbac-dead-permissions-cleanup
  status: active

## FR-lib-api-111 backend change assets 聚合摘除「待复核」标记反查面，knowledge_touch 单一来源为 knowledge_hits inject 实时命中
变更：2026-10-09-knowledge-touch-marker-sunset
状态：active
摘要：标记行不再进触达面；归档态与在途同源；归属解析不受影响
场景正文：
- 场景：标记行不再进触达面 — Given 域文件存在「待复核：<变更名>」行且库中无该变更的 inject 行 / When 聚合 / Then knowledge_touch == []（标记行被无视
- 场景：归档态与在途同源 — Given 变更已归档且库中有 inject 行 / When 聚合 / Then 触达面内容与在途态同源同序（无归档特化合并路径）。
- 场景：归属解析不受影响 — Given 域文件含「变更：<change_key>」归属行 / When 聚合 / Then fr_entries/decisions 归属条目解析行为与改前逐字一致（o
全文：.sillyspec/changes/archive/2026-10-09-knowledge-touch-marker-sunset/requirements.md#FR-01
最近确认：54e72b580d5108fd12c60fad18c2c31ca0d51535

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-knowledge-touch-marker-sunset:flow:测试绑定FR-01
  tests: backend/app/modules/change/tests/test_assets.py「金样本聚合 + live 触达标记忽略」用例
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-knowledge-touch-marker-sunset
  status: active

## FR-lib-api-112 前端知识触达标题与悬停文案统一为注入命中留痕口径
变更：2026-10-09-knowledge-touch-marker-sunset
状态：active
摘要：在途与归档同文案
场景正文：
- 场景：在途与归档同文案 — Given knowledge_touch 非空 / When 分别以 archived=true 与 archived=false 渲染 / Then 两次标题与悬停文案
全文：.sillyspec/changes/archive/2026-10-09-knowledge-touch-marker-sunset/requirements.md#FR-02
最近确认：54e72b580d5108fd12c60fad18c2c31ca0d51535

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-knowledge-touch-marker-sunset:flow:测试绑定FR-02
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「知识触达统一文案」用例
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-knowledge-touch-marker-sunset
  status: active

## FR-lib-api-113 触达条目渲染去重与分组收拢
变更：2026-10-09-knowledge-touch-marker-sunset
状态：active
摘要：同 slug 去重；整文件与锚点分形
场景正文：
- 场景：同 slug 去重 — Given 条目 id==title==slug / When 渲染 / Then 该 slug 在组内文本中恰好出现一次。
- 场景：整文件与锚点分形 — Given 同组数据含裸文件条目（fr/daemon.md）与锚点条目（known-issues.md#slug）/ When 渲染 / Then 裸文件以 chip 呈现
全文：.sillyspec/changes/archive/2026-10-09-knowledge-touch-marker-sunset/requirements.md#FR-03
最近确认：54e72b580d5108fd12c60fad18c2c31ca0d51535

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-knowledge-touch-marker-sunset:flow:测试绑定FR-03
  tests: frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx「同 slug 去重与整文件分组」用例
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-knowledge-touch-marker-sunset
  status: active

## FR-lib-api-114 相关测试更新并通过（仅跑相关，不全量）
变更：2026-10-09-knowledge-touch-marker-sunset
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 改动落盘 / When 跑上述两组定向测试 / Then 全绿。
全文：.sillyspec/changes/archive/2026-10-09-knowledge-touch-marker-sunset/requirements.md#FR-04
最近确认：54e72b580d5108fd12c60fad18c2c31ca0d51535
