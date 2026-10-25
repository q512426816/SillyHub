---
author: qinyi
created_at: 2026-10-26 03:23:30
---

# 决策记录 — 会话阶段化进度展示

## D-001@v1: 展示形态=轻量单行状态文案（接受不留痕 trade-off）

- type: architecture
- status: accepted
- source: user
- question: 阶段进度在会话页面上用什么形态展示（阶段轨迹时间线 / 状态条文案增强 / 并入实时活动流）？
- answer: 状态条文案增强（轻量）——不新增独立区域，把单行「思考中/执行中」替换为当前具体阶段文案，随阶段实时切换；接受「历史轮次不留痕、阶段一闪而过无法回看」的代价。
- normalized_requirement: 运行中轮的状态条单行区域须显示当前阶段文案（替代笼统「思考中」），阶段切换时文案即时更新；不得为展示阶段新增独立面板/时间线区域。
- impacts: [FR-01, FR-05, verify-01]
- evidence: 用户 AskUserQuestion 回答「状态条文案增强（轻量）」2026-10-26 03:15 前后轮次
- 故障面: 阶段文案与右侧活动摘要并存时单行信息密度上升，窄视口下截断优先级需定义（活动摘要 truncate 既有行为保留，阶段标签 shrink-0 不截断）。
- 退役判据: 若用户反馈需要回看历史阶段轨迹，升级为阶段轨迹时间线形态（原型 ① 档）时本决策由 v2 取代。
- 锚点: `frontend/src/components/daemon/turn-status-bar.tsx`
- 模块域: [frontend]

## D-002@v1: 覆盖范围=盲区补齐 + 轮内统一阶段轴

- type: architecture
- status: accepted
- source: user
- question: 阶段覆盖只补卡顿盲区，还是把整轮过程统一成一条阶段轴？
- answer: 盲区+统一阶段轴——静默盲区（平台转发→执行器领取→启动准备→等待首响）补齐信号，并把 AI 干活期间已有信号（执行命令/工具调用/输出间隙）统一映射到同一阶段文案体系。
- normalized_requirement: 从用户发送消息到轮终态的全程，状态条须能区分展示：已发送→已领取→启动准备（技能/规范/工具/进程）→等待首响→思考/输出→执行命令/工具→等待模型响应→完成；盲区阶段不得再显示笼统「思考中」。
- impacts: [FR-02, FR-03, FR-04, verify-02]
- evidence: 用户 AskUserQuestion 回答「盲区+统一阶段轴（推荐）」2026-10-26 03:15 前后轮次
- 故障面: 统一阶段轴依赖三端词表同步——任一端词表漂移（新增 phase 未同步前端映射）会显示原始英文 phase 值；已由兼容策略「未知 phase 显示原始字符串兜底」覆盖。
- 退役判据: 若阶段体系演进为服务端驱动的通用任务阶段模型（跨会话/任务类型复用），本词表并入更大模型后本决策由 v2 收编。
- 锚点: `backend/app/modules/daemon/control_commands.py`、`sillyhub-daemon/src/daemon.ts`
- 模块域: [backend, frontend, sillyhub-daemon]

## D-003@v1: 异常处理=阶段超时变色提示（不弹窗）

- type: architecture
- status: accepted
- source: user
- question: 异常场景（执行器不在线、投递失败、阶段卡超时）在进度里怎么处理？
- answer: 阶段超时提示——单阶段停留超过阈值（默认 30s，实现期可调）时该行变色并显示「已等待 X 秒」，区分「正常慢」和「卡死了」；不弹窗、不做独立告警系统。
- normalized_requirement: 任一阶段停留时长超过阈值时，状态条该行须切换为警示样式并显示已等待时长；超时提示不得阻断或替换正常阶段推进展示。
- impacts: [FR-05, verify-03]
- evidence: 用户 AskUserQuestion 回答「阶段超时提示（推荐）」2026-10-26 03:15 前后轮次
- 故障面: 前端本地计时与事件到达延迟叠加可能瞬时误报（如浏览器标签页休眠后恢复、计时跨度被拉长）——标签页不可见时 rAF/interval 节流属已知浏览器行为，恢复后按真实墙钟差显示，短暂「跳秒」可接受。
- 退役判据: 若引入服务端心跳阶段快照（D-006 复潮路径），超时判定可迁移服务端权威时钟，本地计时降级为兜底。
- 锚点: `frontend/src/components/daemon/turn-status-bar.tsx`
- 模块域: [frontend]

## D-004@v1: 实现方案=方案 A 阶段事件推送（新增 turn_phase 事件 kind）

- type: architecture
- status: accepted
- source: user
- question: 采用哪个实现方案（A 阶段事件推送 / B 后端推断式 / C 心跳快照轮询）？
- answer: 方案 A——新增会话 SSE 事件 kind `turn_phase`。启动准备各步骤边界由 daemon 经既有 endStep 钩子新增 HTTP 上报端点发出（照抄 notify_bash_status 已验证模式）；平台转发段由 backend 在控制指令状态机翻转点（delivered/acked）直接发布（零 daemon 改动）；轮内阶段由已有事件映射。前端 SessionEventKind 加 kind、分发器加 case、状态条消费。
- normalized_requirement: 阶段信号必须由实际执行方上报（daemon 发启动阶段、backend 发转发段），前端不得用计时推断伪造阶段语义；新增事件走现有 `agent_session:{id}` SSE 通道，SSE 透传层不改；不新增 daemon↔backend WS 消息类型。
- impacts: [FR-01, FR-02, FR-03, FR-04]
- evidence: 用户 AskUserQuestion 回答「方案 A：阶段事件（推荐）」2026-10-26 03:20 前后轮次
- 故障面: SSE 无历史（Redis pub/sub 无持久化），断线/刷新期间错过的阶段事件不可回放，重连后只能显示最新已知阶段或回退兜底文案——属轻量形态（D-001）可接受范围。
- 退役判据: 若后续引入会话事件持久化回放（可查询历史阶段轨迹），单行实时文案可升级为轨迹回看而不废弃事件本身。
- 锚点: `backend/app/modules/daemon/router/notify.py`、`sillyhub-daemon/src/daemon.ts`、`frontend/src/lib/daemon/session-sse.ts`
- 模块域: [backend, frontend, sillyhub-daemon]

## D-005@v1: 否决方案 B——后端推断式（零 daemon 改动）

- type: architecture
- status: rejected
- source: user
- question: 采用哪个实现方案（A 阶段事件推送 / B 后端推断式 / C 心跳快照轮询）？
- answer: （落选）方案 B——backend 仅用已有信号（控制指令状态机、run.status 翻转、首条 log 事件）+ 前端计时推断阶段文案。
- impacts: []
- evidence: 方案对比轮次 2026-10-26 03:20，用户选 A 弃 B
- 否决理由: daemon 内部三段同步（技能/规范/工具配置）对外不可见，推断式区分不了「启动 agent」与「同步文件中」，只能笼统显示「准备中」——用户核心诉求「展示是在启动 agent 还是同步文件中」直接落空；且阶段切换时刻靠启发式计时猜测，语义不精确。
- 复潮条件: 若 daemon 侧始终无法改造（如版本冻结），且用户接受粗粒度「准备中」文案时，可重议。

## D-006@v1: 否决方案 C——心跳快照轮询

- type: architecture
- status: rejected
- source: user
- question: 采用哪个实现方案（A 阶段事件推送 / B 后端推断式 / C 心跳快照轮询）？
- answer: （落选）方案 C——daemon 把当前阶段写入既有心跳结构化字段（sillyspec_status 先例），backend 落库，前端每 2-3s 轮询显示。
- impacts: []
- evidence: 方案对比轮次 2026-10-26 03:20，用户选 A 弃 C
- 否决理由: 心跳间隔+轮询间隔叠加导致阶段切换显示延迟数十秒，与「实时进度」诉求相悖；阶段是瞬时态，轮询会跳过短暂阶段；轮内秒级变化（工具运行/等待模型响应）轮询机制表达不了，仍需事件流兜底=两套机制并存；新增查询端点+轮询逻辑后改动并不比 A 少。
- 复潮条件: 若后续需要「断线/刷新后仍可查当前阶段」的持久化快照能力（作为方案 A 的增量补充而非替代），可复用心跳通道先例重议。

## D-007@v1: 超时阈值=前端常量 30s（非用户/服务端配置）

- type: definition
- status: implemented
- source: code
- question: 阶段超时阈值取多少、配置在哪一层？
- answer: 我的判断：前端常量 30 秒（对照生产 TURN_STATUS_ELAPSED_MIN_MS=15s 先例，状态条已有前端常量门槛惯例）；不做服务端下发配置，首版不暴露设置项。
- normalized_requirement: 阶段停留 ≥30s 时状态条切警示样式；阈值为前端模块常量，调整走代码评审不走配置。
- impacts: [FR-05]
- evidence: frontend/src/components/daemon/turn-status-bar.tsx:359（TURN_STATUS_ELAPSED_MIN_MS 先例）

## D-008@v1: 轮内阶段由客户端从已有事件映射，不发新事件

- type: boundary
- status: implemented
- source: code
- question: AI 干活期间（思考/工具/输出间隙）的阶段文案从哪来？
- answer: 我的判断：纯客户端映射——thinking partial→「正在思考」、running 工具段→工具摘要、无事件间隙→「等待模型响应」，全部复用 deriveTurnActivity 既有派生链；不新增轮内 turn_phase 事件（信号源重复且带宽浪费）。
- normalized_requirement: turn_phase 事件仅承载「首响前」盲区阶段（派发段+启动准备段+first_event）；首响后活动摘要接管，阶段标签退位。
- impacts: [FR-04]
- evidence: frontend/src/components/daemon/turn-status-bar.tsx:324（deriveTurnActivity 回退链已存在）

## D-009@v1: 阶段上报失败静默降级，不阻塞会话主流程

- type: boundary
- status: implemented
- source: code
- question: daemon 上报 turn-phase 失败（网络/后端重启）时如何处置？
- answer: 我的判断：静默降级——上报失败仅记 daemon 日志，不重试队列、不失败会话；阶段展示是纯增强，任何失败都不得影响会话创建/消息注入主流程。与 publish_session_event「异常吞噬+warning」同语义。
- normalized_requirement: turn-phase 上报路径任何异常不得抛出到会话创建/注入调用链；前端对 phase 事件缺失有兜底文案。
- impacts: [FR-02]
- evidence: backend/app/modules/daemon/event_publish.py（publish_json_event 异常吞噬先例）

## D-010@v1: 断线/刷新后阶段未知→回退现有兜底文案，不做持久化

- type: boundary
- status: implemented
- source: code
- question: SSE 断线重连或页面刷新后，错过 phase 事件怎么办？
- answer: 我的判断：回退现有兜底文案（「执行中」+活动摘要派生），不做阶段状态持久化/快照查询——SSE 无历史是通道既有属性（D-004 故障面已登记），轻量形态（D-001）下可接受。
- normalized_requirement: 前端对「无 phase 信号」的运行中轮显示与现状一致的兜底文案；不新增阶段查询端点/轮询。
- impacts: [FR-01]
- evidence: backend/app/modules/agent/service.py stream_session_logs（SSE 透传无历史）

## D-011@v1: delivered 阶段挂 ack 回执点（非 mark_delivered push 成功点）

- type: consistency
- priority: P0
- status: implemented
- source: code
- question: phase=delivered 发布点挂控制指令状态机哪个时刻（mark_delivered 的 WS push 成功点 vs daemon ack 回执点）？
- answer: 我的判断：挂 **ack 回执点**——「执行器已接收」以 daemon 真实确认为准；mark_delivered（control_commands.py:233）与 ack（:331）是状态机两个不同时刻，daemon 离线补拉时差可达分钟级，挂 push 成功点会在离线场景显示假「已接收」。
- normalized_requirement: delivered 事件仅在 daemon ack 回执处理路径发布；dispatched 在下发成功点照发（daemon 离线待补拉时文案「已发送 · 等待执行器领取」语义兼容）。
- impacts: [FR-01, task-02]
- evidence: Grill 阻断①（review.json 2026-10-26）；backend/app/modules/daemon/control_commands.py:233/:331 实测两时刻
- 故障面: ack 回执路径需能拿到 session_id/run_id（控制指令 payload 反查），若 ack 处理缺上下文需补传递。
- 退役判据: 无——挂点跟随状态机语义，状态机不变则不变。
- 锚点: backend/app/modules/daemon/control_commands.py:331
- 模块域: [backend]

## D-012@v1: SSE 键名三端逐字对齐（phase/detail/timestamp）

- type: consistency
- priority: P0
- status: implemented
- source: code
- question: turn_phase 事件 payload 键名与前端信封字段名以哪套为准？
- answer: 我的判断：以发布侧组装为单一事实源，三端逐字对齐为 `phase` / `detail` / `timestamp`（timestamp 复用前端信封既有字段名）——SSE 透传层原样转发不改名（agent/service.py transparent passthrough 实证），键名不一致字段必丢且无映射层。
- normalized_requirement: backend 发布 payload、前端 SessionStreamEnvelope、session-stream 解析三处键名逐字一致；禁止出现 phase_detail/ts 等变体键名。
- impacts: [FR-04, FR-06, task-01, task-07]
- evidence: Grill 阻断②（review.json 2026-10-26）；agent/service.py:1380 透传不改名实证
- 故障面: 后续新增 phase 事件字段时同样必须三端同提交（与 WS 消息类型双侧契约同性质）。
- 退役判据: 无——键名契约长期有效。
- 锚点: backend/app/modules/daemon/run_sync/service/publish.py、frontend/src/lib/daemon/session-sse.ts:160
- 模块域: [backend, frontend]

## D-013@v1: 阶段展示精度包——at 时钟源/run_id 必填/轮终态清理/防重键/并行边界

- type: definition
- priority: P0
- status: implemented
- source: code
- question: Grill 指出的四处精度缺口（at 时钟源、null run_id 归属、轮终态清 currentPhase、first_event 防重键与并行阶段展示）如何定？
- answer: 我的判断：① at=客户端本地 Date.now()（事件到达时刻，规避时钟偏移）；② run_id 必填（daemon 恒带 firstRunId，daemon.ts:9522 守卫后必非空——「create 前 run 未定」原假设与代码不符），前端对缺失 run_id 的 phase 事件防御丢弃；③ turn_completed/failed/killed 终态分支清空 currentPhase（兑现 R-01「不显示陈旧值」，防断线场景假超时警示）；④ first_event 防重键=(session_id, run_id)（run 级标志，新 AgentRun 自然重置）；⑤ 冷启动三步 Promise.all 并行保持独立上报+覆盖式刷新（跳动亚秒级真实，聚合文案违背轻量）；SWR 跳过步不发事件。
- normalized_requirement: 终态分支必须清 currentPhase 且有测试断言；run_id 缺失事件不进轮状态；防重键跨 run 不串。
- impacts: [FR-02, FR-04, task-05, task-07, task-09]
- evidence: Grill 阻断③+四 gap（review.json 2026-10-26）；daemon.ts:9522/:10018 实证
- 故障面: 终态清理若漏接（如新增终态类型未清 phase）会复现假警示——测试断言面需覆盖全部终态枚举。
- 退役判据: 无——精度规则跟随轮生命周期语义。
- 锚点: frontend/src/components/daemon/session-panel/turn-state.ts、sillyhub-daemon/src/interactive/session-manager/events.ts
- 模块域: [backend, frontend, sillyhub-daemon]
