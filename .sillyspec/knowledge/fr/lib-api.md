## FR-lib-api-001 列表页 step 级徽章
变更：2026-08-15-change-step-visibility
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 变更的 latest_progress.steps[] 非空 steps 缺失/空/结构异常；When 用户打开变更中心列表；Then 阶段徽章区显示 `step x/y`（全 stage 累计）+ 迷你进度条 + 当前步名；当前步状态映射：active→蓝脉动、waiting（wait_rea
全文：.sillyspec/changes/archive/2026-08-15-change-step-visibility/requirements.md#FR-01
最近确认：3f00a3b9d

## FR-lib-api-002 详情页步骤时间线
变更：2026-08-15-change-step-visibility
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 变更 steps[] 非空；When 用户打开变更详情；Then 显示按 stage 分组（STAGE_ORDER 序，quick/未知追加在后）的垂直时间线：每步名称/状态/output 摘要（截断 200 字）/完成时间（
全文：.sillyspec/changes/archive/2026-08-15-change-step-visibility/requirements.md#FR-02
最近确认：3f00a3b9d

## FR-lib-api-003 智能轮询不乱跳
变更：2026-08-15-change-step-visibility
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 列表/详情页打开且存在非终态变更 全部变更终态（status=="archived" || location=="archive"） document.visi；When 到达轮询间隔（列表 30s / 详情 10s）
全文：.sillyspec/changes/archive/2026-08-15-change-step-visibility/requirements.md#FR-03
最近确认：3f00a3b9d

## FR-lib-api-004 后端读侧提取
变更：2026-08-15-change-step-visibility
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given platform_change_progress.latest_progress 含 steps[]；When enrich_summaries / enrich_with_workspace_ids 执行；Then ChangeSummary.step_progress 填摘要（step_total/steps_completed/current_step_name/cur
全文：.sillyspec/changes/archive/2026-08-15-change-step-visibility/requirements.md#FR-04
最近确认：3f00a3b9d

## FR-lib-api-005 上行时 owner 对齐 token 身份
变更：2026-08-16-change-owner-from-token
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 有效 shpsync_ token 上行某变更进度被接受 owner_id 不同于 token 用户 owner_id 等于 token 用户；When ux_changes.owner_id 为 None（占位行/存量）；Then 更新为 token 用户，不产生事件 同一 savepoint 内更新 owner_id 并写 owner_change 事件（detail 含 from/to
全文：.sillyspec/changes/archive/2026-08-16-change-owner-from-token/requirements.md#FR-01
最近确认：3a0ef0a24

## FR-lib-api-006 通用事件表
变更：2026-08-16-change-owner-from-token
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 任一 owner 变化；Then change_events 写入一行：event_type='owner_change'、detail JSONB={from_user_id,to_user_
全文：.sillyspec/changes/archive/2026-08-16-change-owner-from-token/requirements.md#FR-02
最近确认：3a0ef0a24

## FR-lib-api-007 时间线合成事件条目
变更：2026-08-16-change-owner-from-token
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 变更存在 owner_change 事件；When 详情页读取；Then 事件转为时间线条目（kind='event'，name=责任人变更，output="A → B" 用户名，completed_at=事件时间），按时间序插入步骤
全文：.sillyspec/changes/archive/2026-08-16-change-owner-from-token/requirements.md#FR-03
最近确认：3a0ef0a24

## FR-lib-api-008 用户名展示
变更：2026-08-16-change-owner-from-token
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 变更 owner_id 非空 owner_id 为空；Then 列表/详情显示 owner_name（display_name 优先 username fallback，批量一次 IN 查询禁 N+1） 降级现状展示（—）
全文：.sillyspec/changes/archive/2026-08-16-change-owner-from-token/requirements.md#FR-04
最近确认：3a0ef0a24

## FR-lib-api-009 履历明细不截断
变更：2026-08-16-change-owner-from-token
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 时间线条目 output 任意长度；Then 详情页全量展示（后端不截断明细、前端不 clamp 自然换行）
全文：.sillyspec/changes/archive/2026-08-16-change-owner-from-token/requirements.md#FR-05
最近确认：3a0ef0a24

## FR-lib-api-010 扫描会话绑定工作区
变更：2026-08-18-scan-into-session
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 用户在工作区触发 scan-generate；When `start_scan_dispatch` 创建 AgentSession；Then 该 AgentSession 的 `workspace_id` 等于目标工作区 id，出现在工作区会话列表
全文：.sillyspec/changes/archive/2026-08-18-scan-into-session/requirements.md#FR-01
最近确认：6011d8222

## FR-lib-api-011 scan-generate 响应返回 session_id
变更：2026-08-18-scan-into-session
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 前端调用 `POST /api/workspaces/scan-generate`；When 后端完成派发（含 `_find_active_scan_run` 早返回分支）；Then 响应体含 `session_id`（早返回的老 run 无 agent_session_id 时为 null）
全文：.sillyspec/changes/archive/2026-08-18-scan-into-session/requirements.md#FR-02
最近确认：6011d8222

## FR-lib-api-012 配置卡触发扫描后进入会话页
变更：2026-08-18-scan-into-session
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 工作区配置卡用户点击「扫描」且确认重扫；When scanGenerate 成功返回；Then 前端跳转 `/workspaces/{id}/sessions?session=<session_id>`（session_id 为 null 时仅跳会话页不深
全文：.sillyspec/changes/archive/2026-08-18-scan-into-session/requirements.md#FR-03
最近确认：6011d8222

## FR-lib-api-013 会话页深链 attach scan 会话
变更：2026-08-18-scan-into-session
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 会话页 URL 带 `?session=<id>`；When 页面挂载且深链参数到达（可能早于列表异步加载）；Then 自动 attach 该会话（fetch logs → setActiveSessionId），未命中列表时直接按 id 加载不静默 no-op
全文：.sillyspec/changes/archive/2026-08-18-scan-into-session/requirements.md#FR-04
最近确认：6011d8222

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

## FR-lib-api-017 会话绑定 PPM 任务/问题（创建通道）
变更：2026-08-28-session-ppm-task-binding
状态：active
摘要：默认场景
依据决策：D-004@v2、D-005@v1
场景正文：
- 场景：默认场景 — Given 存在 PlanTask/PpmProblemList 记录（任意状态） `ppm_item_id` 不存在或已删；When 创建会话请求携带 `ppm_item_kind`（plan_task|problem）+ `ppm_item_id` 创建会话；Then 写入 `ppm_item_session_links`（幂等 upsert，唯一约束 kind+item_id+session_id），link.workspa
全文：.sillyspec/changes/archive/2026-08-28-session-ppm-task-binding/requirements.md#FR-01
最近确认：8397ea766

## FR-lib-api-018 @联想与追问绑定（双向入口）
变更：2026-08-28-session-ppm-task-binding
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given 会话输入框（有 workspace 的会话，atEnabled 门控沿用） 预会话选中 PPM 条目后发送首句 真会话中选中 PPM 条目后追问；When 输入 @ 唤起联想 createSession 提交 injectSession 提交；Then 出现「PPM 任务」「PPM 问题」分组：任务=listPersonalPlanTasks(status=["进行中"])，问题=问题列表 duty_user_
全文：.sillyspec/changes/archive/2026-08-28-session-ppm-task-binding/requirements.md#FR-02
最近确认：8397ea766

## FR-lib-api-019 上下文注入（文字全字段 + 附件）
变更：2026-08-28-session-ppm-task-binding
状态：active
摘要：默认场景
依据决策：D-003@v1、D-006@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 会话绑定 PPM item 成功 item.file_urls 非空且 provider=claude 且与手动附件合并后 图≤5/文≤5 且逐条通过 _can；When create_session 组装 dispatch_prompt 物化 物化；Then 注入【PPM 任务上下文】/【问题上下文】前导（标题/描述/状态/项目/模块/责任人/周期全字段），执行序为物化在前、前导消费 attachment_lines
全文：.sillyspec/changes/archive/2026-08-28-session-ppm-task-binding/requirements.md#FR-03
最近确认：8397ea766

## FR-lib-api-020 任务/问题侧入口 + 关联会话卡片
变更：2026-08-28-session-ppm-task-binding
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v2
场景正文：
- 场景：默认场景 — Given task-plans 个人视图 / workbench 我的任务表 / problem-list 详情抽屉 任务/问题详情渲染；When 点击行/详情处「发起会话」 存在关联会话；Then store 写入 pendingPpmItem 挂起位并 requestNewSession，宿主构造 preContext.ppmItem，前端解析项目第一个
全文：.sillyspec/changes/archive/2026-08-28-session-ppm-task-binding/requirements.md#FR-04
最近确认：8397ea766

## FR-lib-api-021 会话列表关联筛选（ppm 维度）
变更：2026-08-28-session-ppm-task-binding
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — When 会话列表「关联」筛选选择 PPM 任务/问题选项（value 编码 `ppm:<kind>:<uuid>`）；Then listAgentSessions 透传 ppm_item_kind/ppm_item_id，后端 M:N 子查询过滤
全文：.sillyspec/changes/archive/2026-08-28-session-ppm-task-binding/requirements.md#FR-05
最近确认：8397ea766

## FR-lib-api-022 「发起团队」预选修复
变更：2026-08-28-session-ppm-task-binding
状态：active
摘要：默认场景
依据决策：D-004@v2
场景正文：
- 场景：默认场景 — Given PPM 项目页点击「发起团队」；When 预会话面板打开；Then 派团队弹层自动打开；项目自动选中（defaultProjectId）+ scopeMode=按项目；自动拉取项目关联工作区按 workspace_id 升序预选
全文：.sillyspec/changes/archive/2026-08-28-session-ppm-task-binding/requirements.md#FR-06
最近确认：8397ea766
