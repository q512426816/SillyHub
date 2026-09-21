## FR-lib-daemon-001 轮内结构化分段
变更：2026-08-19-session-stream-ux
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given 一轮 agent 回复（主 agent 或含子代理归属的日志流） 历史日志（REST 拉取，`AgentRunLogEntry` 形状）；When 该轮日志事件（含归属字段）被装配器处理 `logsToSegments` 批量装配；Then 输出有序段序列：文本段/思考段/工具段/stderr 段按真实到达顺序排列，文本被非文本段打断则开新段，不 concat 为单条 与 SSE 实时路径产出的段结
全文：.sillyspec/changes/archive/2026-08-19-session-stream-ux/requirements.md#FR-01
最近确认：b0f2a115c

## FR-lib-daemon-002 轮级实时状态条
变更：2026-08-19-session-stream-ux
状态：active
摘要：默认场景
依据决策：D-001@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 一轮处于 running/pending/interrupting 状态 用户中途刷新/attach 到运行中轮 轮到达终态（completed/failed/；When TurnTimeline v2 渲染该轮（「对话」与「进度」视图均显示） 状态条计时恢复 渲染；Then 轮头部显示状态条：计时 + 工具计数（含子代理内部递归）+ 运行中子代理计数 + 当前活动摘要（最新 running 段派生；无 running 工具段时回退「
全文：.sillyspec/changes/archive/2026-08-19-session-stream-ux/requirements.md#FR-02
最近确认：b0f2a115c

## FR-lib-daemon-003 子代理进度嵌套展示
变更：2026-08-19-session-stream-ux
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1
场景正文：
- 场景：默认场景 — Given 日志事件携带 `parent_tool_use_id` 且能匹配到已有 tool 段 id 子代理消息先于其 tool_use 段到达（乱序/丢失） 主/子代理；When 装配器路由 装配器处理 tool_result 到达（SSE/DB 均无自身 tool_use_id）；Then 该事件的段进入对应 tool 段的 `children`，渲染为子代理块（头部状态点/名称(Task description)/subagent_type/时长
全文：.sillyspec/changes/archive/2026-08-19-session-stream-ux/requirements.md#FR-03
最近确认：b0f2a115c

## FR-lib-daemon-004 子代理目录（仅 /sessions 页）
变更：2026-08-19-session-stream-ux
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 当前选中会话存在（含子代理调用的）轮次；When 用户点击会话头部子代理目录按钮 用户点击目录中某子代理行；Then 下拉列表展示子代理清单：状态点（运行中脉冲）、名称、subagent_type、时长（运行中 = 起始时间戳 + 每秒 tick；已完成 = endedAt -
全文：.sillyspec/changes/archive/2026-08-19-session-stream-ux/requirements.md#FR-04
最近确认：b0f2a115c

## FR-lib-daemon-005 共享装配器收敛
变更：2026-08-19-session-stream-ux
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given sessions 页与 runtimes 弹窗两处消费方 override 撤回令箭（`[ASSISTANT_OVERRIDE]`/`[THINKING_OVE；When 任意一方处理日志事件或历史日志 装配器处理；Then 均调用同一 `session-log-assembler` 模块（`applyLogToSegments` / `logsToSegments`），不存在第二份
全文：.sillyspec/changes/archive/2026-08-19-session-stream-ux/requirements.md#FR-05
最近确认：b0f2a115c

## FR-lib-daemon-006 渲染经济性
变更：2026-08-19-session-stream-ux
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 一轮包含多个段且流式 delta 持续到达；When React 渲染更新；Then 仅当前 streaming 段的组件重渲染（段级 memo + 稳定 id key + 装配器段级 copy-on-write），其它段/轮组件不重渲染
全文：.sillyspec/changes/archive/2026-08-19-session-stream-ux/requirements.md#FR-06
最近确认：b0f2a115c

## FR-lib-daemon-007 左侧工作区树列表
变更：2026-08-23-sessions-workspace-hub
状态：active
摘要：默认场景
依据决策：D-103@v1
场景正文：
- 场景：默认场景 — Given 会话门户已打开且列表已加载（listAgentSessions limit≤500，客户端按 workspace_id 分组） 列表数据一次拉取；When 用户查看左侧列表 会话总数超过组内展示上限（50）；Then 工作区按分组手风琴展示（组头=名称+会话数+「＋」+展开箭头），组内按机器分小节（标题=机器名+在线状态点），「非工作区」固定为末尾分组且组头同样有「＋」；条目
全文：.sillyspec/changes/archive/2026-08-23-sessions-workspace-hub/requirements.md#FR-01
最近确认：b2485699a

## FR-lib-daemon-008 两层筛选 tab（机器>智能体）
变更：2026-08-23-sessions-workspace-hub
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户未选筛选（默认「全部」）；When 点击第一层某机器 tab 点击「全部」（第一层）；Then 出现第二层智能体 tab；列表条目按该机器过滤、机器小节标题隐藏（已隐含）；再点智能体 tab 后按引擎过滤。 两层筛选清空、智能体 tab 收起、列表恢复全量
全文：.sillyspec/changes/archive/2026-08-23-sessions-workspace-hub/requirements.md#FR-02
最近确认：b2485699a

## FR-lib-daemon-009 预会话态（新建即聊天界面）
变更：2026-08-23-sessions-workspace-hub
状态：active
摘要：默认场景
依据决策：D-101@v1、D-102@v1、D-104@v1
场景正文：
- 场景：默认场景 — Given 用户点击某分组组头「＋」（上下文已解析：工作区=分组、机器+智能体按 FR-04）；When 右侧渲染 用户输入第一句并点发送 用户不发言离开预会话态（切会话/切路由） createSession 失败；Then 显示与正常会话完全同构的 SessionPanel 空态（同面板头/时间线/输入区），无独立新建页面；顶部一行锁定上下文（📂工作区·🖥机器·⚡智能体 + "
全文：.sillyspec/changes/archive/2026-08-23-sessions-workspace-hub/requirements.md#FR-03
最近确认：b2485699a

## FR-lib-daemon-010 新建上下文解析与两步选择浮层
变更：2026-08-23-sessions-workspace-hub
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 筛选 tab 已选具体机器+智能体，用户点组头「＋」 筛选为「全部」，用户点组头「＋」 分组为「非工作区」或工作区无绑定机器；Then 直接带 tab 上下文进入预会话（不再选择）。 弹出两步轻选择浮层：①仅在线机器 ②该机器可用智能体（claude/codex，默认 Claude Code）；
全文：.sillyspec/changes/archive/2026-08-23-sessions-workspace-hub/requirements.md#FR-04
最近确认：b2485699a

## FR-lib-daemon-011 创建人 chip
变更：2026-08-23-sessions-workspace-hub
状态：active
摘要：默认场景
依据决策：D-108@v2
场景正文：
- 场景：默认场景 — Given 列表 DTO 含 owner_name（后端 join users，缺失 null）；Then 条目 chips 显示创建人（当前本人隔离视图下恒为"我"；null 显"—"）。
全文：.sillyspec/changes/archive/2026-08-23-sessions-workspace-hub/requirements.md#FR-05
最近确认：b2485699a

## FR-lib-daemon-012 入口收敛与 NewSessionForm 退役
变更：2026-08-23-sessions-workspace-hub
状态：active
摘要：默认场景
依据决策：D-106@v1、D-109@v1
场景正文：
- 场景：默认场景 — Given 三入口路由 /sessions、/workspaces/[id]/sessions、/workspaces/[id]/changes/[cid]/session；When 分别访问；Then 全局=完整工作区树；workspace=深链预展开并滚动到该分组；change=独立页（预会话上下文行加显变更名；调用方显式双传 workspaceId+cha
全文：.sillyspec/changes/archive/2026-08-23-sessions-workspace-hub/requirements.md#FR-06
最近确认：b2485699a

## FR-lib-daemon-013 会话用量聚合查询
变更：2026-08-29-session-usage-stats
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 一个会话含若干轮次（run），其中部分轮次有按模型明细行（2026-08-29 后）、部分只有 AgentRun 四维 token 列（历史轮次） 会话无任何用；When 调用 `GET /api/daemon/sessions/{session_id}/usage` 调用同一端点；Then 返回 `SessionUsageRead`：`totals`（输入/输出/缓存读取/缓存写入/请求次数五指标 = 明细+兜底之和）与 `by_model`（每模
全文：.sillyspec/changes/archive/2026-08-29-session-usage-stats/requirements.md#FR-01
最近确认：c73461186

## FR-lib-daemon-014 会话内用量展示
变更：2026-08-29-session-usage-stats
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户打开会话；When 页面渲染；Then page 会话详情页（会话头部下方）与 dialog 浮窗（输入框上方）都显示用量条：摘要行常驻五指标 + 缓存命中率（= cache_read ÷ (cach
全文：.sillyspec/changes/archive/2026-08-29-session-usage-stats/requirements.md#FR-02
最近确认：c73461186

## FR-lib-daemon-015 随轮次终态刷新
变更：2026-08-29-session-usage-stats
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 会话内一轮对话结束（轮次终态事件到达前端）；When 用量条所在组件收到 refreshSignal 递增；Then 重新拉取聚合端点并更新显示（不做秒级轮询）
全文：.sillyspec/changes/archive/2026-08-29-session-usage-stats/requirements.md#FR-03
最近确认：c73461186

## FR-lib-daemon-016 归属与安全
变更：2026-08-29-session-usage-stats
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 非会话属主的认证主体（或会话不存在）；When 调用 `GET /sessions/{session_id}/usage`；Then 404 resource-hiding（与既有会话端点同语义）；未认证 401
全文：.sillyspec/changes/archive/2026-08-29-session-usage-stats/requirements.md#FR-04
最近确认：c73461186

## FR-lib-daemon-017 任务执行面板常驻折叠形态
变更：2026-09-04-session-task-execution-panel
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 用户打开任一会话（sessions 页 page 模式 / runtimes 弹窗 dialog 模式 / mobile）；When 用户点击折叠条 面板展开且内容超限；Then 会话头部区（AgentLogCard 同层）显示「任务执行」折叠条，折叠态一行摘要：运行中任务数、任务总数（成功 X/失败 Y）、轮次数 面板展开显示三个页签：
全文：.sillyspec/changes/archive/2026-09-04-session-task-execution-panel/requirements.md#FR-01
最近确认：234d13f27

## FR-lib-daemon-018 任务清单页签（持久化 + 实时）
变更：2026-09-04-session-task-execution-panel
状态：active
摘要：默认场景
依据决策：D-006@v1
场景正文：
- 场景：默认场景 — Given 会话面板挂载（含刷新/重连后）；When SSE 推送 `agent_task_status` 事件 该会话有 `plan_mode_entered` 事件；Then 从 `GET /sessions/{id}/tasks` 拉取快照渲染任务清单（每行：状态圆标/任务名/摘要/耗时/tokens/工具数，终态定格显示） 面板按
全文：.sillyspec/changes/archive/2026-09-04-session-task-execution-panel/requirements.md#FR-02
最近确认：234d13f27

## FR-lib-daemon-019 运行中页签（实时三类卡复用）
变更：2026-09-04-session-task-execution-panel
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 会话有运行中的 agent 任务 / Bash 命令 / 团队任务；When 无任何运行中任务；Then 运行中页签渲染现有 agent-task-card / bash-progress-card / team-task-block 组件（与 ActivityCa
全文：.sillyspec/changes/archive/2026-09-04-session-task-execution-panel/requirements.md#FR-03
最近确认：234d13f27

## FR-lib-daemon-020 轮次历史页签
变更：2026-09-04-session-task-execution-panel
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 会话存在历史轮次（listSessionRuns 数据）；When 收到 `turn_completed` 事件信号；Then 轮次页签显示紧凑列表（轮次号/状态/耗时/tokens/发送者） 列表刷新（refreshSignal 模式）
全文：.sillyspec/changes/archive/2026-09-04-session-task-execution-panel/requirements.md#FR-04
最近确认：234d13f27

## FR-lib-daemon-021 任务状态服务端持久化
变更：2026-09-04-session-task-execution-panel
状态：active
摘要：默认场景
依据决策：D-006@v1
场景正文：
- 场景：默认场景 — Given daemon 上报 `agent_task_status`（POST /sessions/{id}/agent-task-status）；When 已定格终态（completed/failed/stopped）的任务再收到 running 事件 任务进入终态 会话被删除；Then backend 在转发 SSE 的同时 upsert `agent_session_task` 行（(session_id, task_id) 唯一）：无则插入
全文：.sillyspec/changes/archive/2026-09-04-session-task-execution-panel/requirements.md#FR-05
最近确认：234d13f27

## FR-lib-daemon-022 任务快照端点
变更：2026-09-04-session-task-execution-panel
状态：active
摘要：默认场景
依据决策：D-006@v1
场景正文：
- 场景：默认场景 — When 无任务数据；Then 返回 `list[AgentSessionTaskRead]`（按 updated_at desc 最近 200 条；字段含 run_id/progress/m
全文：.sillyspec/changes/archive/2026-09-04-session-task-execution-panel/requirements.md#FR-06
最近确认：234d13f27

## FR-lib-daemon-023 多引擎降级空态
变更：2026-09-04-session-task-execution-panel
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 引擎不上报任务事件（如 pi 无 task 帧）；Then 任务清单显示空态文案，面板不报错、不阻塞对话流
全文：.sillyspec/changes/archive/2026-09-04-session-task-execution-panel/requirements.md#FR-07
最近确认：234d13f27
