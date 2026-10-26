---
author: flow-machine-draft
created_at: 2026-10-26T07:01:45.648Z
---
# 需求规格（Requirements）— 2026-10-26-turn-phase-orphan-fallback

## 功能需求

### FR-01: applyTurnPhase 未命中 run_id 时必须回退写入当前唯一 pending/running/interrupting 轮(currentRunId 指向),禁止静默丢弃该事件

turn_phase 事件按 run_id 精确匹配（含 realRunId）未命中、且当前存在 currentRunId 指向的活跃轮（pending/running/interrupting）时，必须把 {phase, at} 写入该活跃轮（last-write-wins 语义不变）；禁止静默丢弃。回退必须只写 currentRunId 指向的轮，禁止扫描猜测"最近的轮"。

#### 场景：竞态（生产实证形态——事件跑赢 HTTP 响应）

Given 用户发送消息→前端插入本地占位轮（临时 id）→HTTP 响应未回、真实 run_id 未替换
When daemon 侧 inject_received/first_event 阶段事件（带真实 run_id）先于 HTTP 响应到达
Then 事件必须写入占位轮（currentRunId 指向）；随后 replacePlaceholderTurn 换真实 id 时 phase 保留（FR-03）；状态条不得卡死在 delivered 超时警示

### FR-02: 无活跃轮时(断线重连迟到事件等)必须维持丢弃,禁止创建幽灵轮(原设计不变)

turn_phase 事件未命中 run_id 且当前无活跃轮（currentRunId 为空或指向轮已终态）时，必须维持现状原样返回（丢弃）；禁止为 phase 事件创建新轮——phase 不是轮存在性信号（原设计注释语义保留）。

#### 场景：断线重连迟到事件

Given 会话无进行中轮（上一轮已终态、无排队派发中的占位轮）
When 迟到的 turn_phase 事件到达（SSE 重连后补推等）
Then 状态必须原样返回，不建轮、不写入任何历史轮

### FR-03: replacePlaceholderTurn 换真实 run_id 时 currentPhase 必须保留(spread 已保留,测试锁定)

replacePlaceholderTurn 以对象展开保留全部字段（currentPhase 随占位轮过渡到真实轮），此行为必须由测试锁定防回归（后续改动若改为显式字段挑选将静默丢失 phase）。

### FR-04: 排队轮(非活跃)必须不接回退事件

存在排队中（queued）消息且活跃轮另有其轮时，回退必须只写活跃轮；排队轮在派发建轮前不得接收任何 turn_phase。

### FR-05: 回退安全性前提=单会话单活跃 run 不变式(显式记录,反例排查)

回退归属的安全性依赖平台「单会话单活跃 run」不变式，必须作为决策记录落盘并附反例排查：跨轮子代理（parent_tool_use_id 归属派生轮，不建轮）、团队分身（parent_session_id 独立会话树，事件按会话路由）、忙轮守卫（已有活跃轮时后端拒绝新 run 或转排队）、steering（沿用活跃轮不建新）、自动续跑（前轮终态后才建新轮）。若未来平台放松该不变式（如允许会话内并行多轮），本回退语义必须重新评估。

## 非功能需求
- 兼容性：命中 run_id 的事件路径必须逐字节不变（回退只影响未命中分支）；last-write-wins 与 at=本地到达时刻语义不变
- 可回退：回退分支为纯函数内新增路径，revert 即恢复原丢弃行为
- 可测试：竞态/无活跃轮/排队轮/占位轮过渡四场景均有可构造单测

## 测试绑定（每条 FR 至少一行）
FR-01: frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts「未命中 run_id 回退写 currentRunId 轮/竞态事件先于替换」
FR-02: frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts「无活跃轮丢弃不建轮不写历史轮」
FR-03: frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts「竞态全链：回退写占位轮→replacePlaceholderTurn 换真实 id 后 phase 保留」
FR-04: frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts「排队轮不接回退事件」
FR-05: 不适用：决策记录（decisions.md D-001 反例排查表），无行为面
