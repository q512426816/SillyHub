# 决策记录（Decisions）

## D-001@v1: 三入口统一为一个门户组件（以 /sessions 为准）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 工作区会话页/变更会话区与 /sessions 不一致，如何统一？
- answer: 以 /sessions 为准抽共享 SessionsPortal（scope 判别联合），三入口渲染同一组件（用户三轮 AskUserQuestion 拍板：范围两处一起/方案A/设计确认）。
- normalized_requirement: /sessions、/workspaces/[id]/sessions、/workspaces/[id]/changes/[cid]/sessions 三路由渲染点均为 SessionsPortal；观感口径=布局/交互/面板一致，列表行信息密度按端点字段能力呈现（design §4.B 降级矩阵）。
- impacts: [FR-01, FR-02, FR-03, FR-04, task-01~04]
- evidence: 用户问答回合；Grill v2 复审 passed。

## D-002@v1: 变更详情承载=专属路由门户
- type: architecture
- priority: P1
- status: accepted
- source: user
- question: 变更侧边窄卡塞不下全页门户，承载形态？
- answer: 方案A：卡片变入口（前 3 条预览+打开按钮）跳专属路由（用户选，对比页内展开/全屏弹窗两案）。
- impacts: [FR-03, task-03, task-06]
- evidence: 用户方案选择回合；aside 窄卡事实（page.tsx:388）。

## D-003@v1: scope 模式客户端仅本人过滤
- type: compatibility
- priority: P0
- status: accepted
- source: code
- question: listWorkspaceAgentSessions 跨成员返回，他人会话 attach 必 404（Grill P0-1）？
- answer: scope 模式按 AgentSessionListItem.author 过滤仅本人（迁移旧 workspace-section :201-212 语义）；change 级由旧跨成员变仅本人属有意统一；全局模式服务端行为零动。
- impacts: [FR-04, task-04, task-06, task-08]
- evidence: Grill v1 P0-1 + daemon.ts:1286 author 字段实测。

## D-004@v1: ?session= 升级为门户统一能力
- type: compatibility
- priority: P0
- status: accepted
- source: code
- question: 旧工作区页深链随退役丢失 vs design 自称「沿用」矛盾（Grill P0-2）？
- answer: SessionsPortal 统一支持 ?session=<id> 初始选中（迁移旧 :95-113 能力，无效 id 静默忽略），三入口通用。
- impacts: [FR-05, task-01, task-06, task-08]
- evidence: Grill v1 P0-2 → v2 消解核对。

## D-005@v1: ended 会话恢复自动→手动（以 /sessions 行为为准）
- type: boundary
- priority: P1
- status: accepted
- source: user
- question: 旧装配「选中 ended 即自动 reopen」，page 模式是手动按钮（240s/409 文案）？
- answer: 统一为 page 模式手动重开——用户「以 /sessions 为准」原则的直接推论；design §4.E 明示为有意交互变更。
- impacts: [FR-06, task-07]
- evidence: session-panel.tsx:1453-1466 vs workspace-section:164-176（Grill 核对）。

## D-003@v2: scope 列表数据源=全局端点+服务端过滤（取代 D-003@v1 客户端过滤）
- type: architecture
- priority: P0
- status: accepted
- supersedes: D-003@v1
- source: user
- question: 用户验收：scope 列表缺字段/缺筛选，「完整移植」不成立（v1 为零后端约束选瘦端点+降级）？
- answer: 后端 GET /sessions 增 workspace_id/change_id 可选过滤参；前端 scope 复用全局端点（owner-scoped+全字段+筛选+分页），v2 的降级矩阵/客户端过滤/筛选隐藏全部退场。
- normalized_requirement: workspace/change 列表请求与全局同端点同字段同筛选 UI，仅多两个过滤参数；行为一致性由同组件+同数据形状保证。
- impacts: [FR-04 修订, task-10, task-11, task-12]
- evidence: 全局/瘦端点字段对比实测（24 键 vs 8 键）+ 全局端点 owner-scoped docstring（router.py:1824）+ 用户验收反馈轮。
