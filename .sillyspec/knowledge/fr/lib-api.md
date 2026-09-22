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

## FR-lib-api-029 取消置顶
变更：2026-09-07-session-pin-rename-scheduled-send
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 会话已置顶 会话未置顶；When 调用 `PATCH /api/daemon/sessions/{id}/unpin` 再次调用 unpin；Then `pinned_at` 置 NULL，会话回到分组内最近活跃序；SSE 广播同 FR-01 幂等无操作，204
全文：.sillyspec/changes/archive/2026-09-07-session-pin-rename-scheduled-send/requirements.md#FR-02
最近确认：35f3d6528

## FR-lib-api-030 会话重命名
变更：2026-09-07-session-pin-rename-scheduled-send
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 属主已登录 title strip 后为空或超过 255 字符；When 调用 `PATCH /api/daemon/sessions/{id}/title`，body `{"title": "新名字"}` 调用；Then `title` 列写入 strip 后值；列表标题派生逻辑（title 优先、回退首条 user_input）使其立即生效；SSE 广播 `status_cha
全文：.sillyspec/changes/archive/2026-09-07-session-pin-rename-scheduled-send/requirements.md#FR-03
最近确认：35f3d6528

## FR-lib-api-031 定时消息创建/列表/取消（一次性）
变更：2026-09-07-session-pin-rename-scheduled-send
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given 会话属主已登录、会话非终态 dispatch_at 早于 now+60s，或 prompt 与附件全空，或会话已终态（ended/failed）/已软删 会话有；When 调用 `POST /api/daemon/sessions/{id}/scheduled`，body `{prompt, dispatch_at, attach；Then 落库一行 status=pending（快照字段原样保存，sender_user_id=当前用户），响应 201 + 完整条目；仅一次性，到点派发后不重复 42
全文：.sillyspec/changes/archive/2026-09-07-session-pin-rename-scheduled-send/requirements.md#FR-04
最近确认：35f3d6528

## FR-lib-api-032 到点自动派发（sweeper）
变更：2026-09-07-session-pin-rename-scheduled-send
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 存在 status=pending 且 dispatch_at ≤ now 的条目 到点时会话正忙（有活跃 run） 到点时会话已终态或已软删 到点时会话正忙且；When sweeper 周期（30s）到达 sweeper 派发 sweeper 派发 sweeper 派发 sweeper 处理 sweeper 启动后首轮；Then 行锁复核 pending 后调 `inject_session_as_service(prompt=…, queue_when_busy=True, queue
全文：.sillyspec/changes/archive/2026-09-07-session-pin-rename-scheduled-send/requirements.md#FR-05
最近确认：35f3d6528

## FR-lib-api-033 多端 SSE 同步
变更：2026-09-07-session-pin-rename-scheduled-send
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户在两个浏览器标签打开会话门户；When 一端置顶/取消置顶/重命名；Then 另一端经 `agent_sessions:changed` SSE 事件秒级刷新列表（复用 `publish_sessions_changed`，事件 reas
全文：.sillyspec/changes/archive/2026-09-07-session-pin-rename-scheduled-send/requirements.md#FR-06
最近确认：35f3d6528

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

## FR-lib-api-042 边界行零重叠
变更：2026-09-16-logs-cursor-tiebreaker
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 复合游标（before, before_id）；When 请求下一页；Then 返回行集与已加载行集交集为空（(ts,id) 严格小于游标，`<=` 的单行重叠同时消除）
全文：.sillyspec/changes/archive/2026-09-16-logs-cursor-tiebreaker/requirements.md#FR-02
最近确认：b204034fb

## FR-lib-api-043 旧客户端零回归
变更：2026-09-16-logs-cursor-tiebreaker
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 调用方不传 before_id；When 带 before 请求；Then 过滤行为与现行 `timestamp <= before` 完全一致（回归用例逐字节断言）
全文：.sillyspec/changes/archive/2026-09-16-logs-cursor-tiebreaker/requirements.md#FR-03
最近确认：b204034fb

## FR-lib-api-044 轮序派生零影响
变更：2026-09-16-logs-cursor-tiebreaker
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 本变更部署后；When 前端 logsToTurns 按 run_id 首见序装配轮次；Then 输入行序仍为 run 块序（ORDER BY 零改动），轮序与现状一致（同 ts 批次翻页跨页拆块的场景除外——该场景现状本就不可达，属修复目标）
全文：.sillyspec/changes/archive/2026-09-16-logs-cursor-tiebreaker/requirements.md#FR-04
最近确认：b204034fb
