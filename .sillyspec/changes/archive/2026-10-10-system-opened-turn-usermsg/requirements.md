---
author: flow-machine-draft
created_at: 2026-10-10T15:33:49.552Z
---
# 需求规格（Requirements）— 2026-10-10-system-opened-turn-usermsg

## 功能需求

### FR-01: 回放路径——系统注入开轮的占位槽（首条 user_input 剥空也占住 prompt 槽）

- `logsToTurns` 必须把每个 run 的**首条** user_input 行（即使被剥前导后为空——[后台任务通知]/纯前导系统注入）视为开轮正文占位：prompt 保持空（顶部无用户气泡），后到真实文本消息不得提升为轮 prompt，必须转 user_msg 段按 ts 插入轮内输出之间。占位键必须不可与真实消息体碰撞。

#### 场景：系统通知开轮 + 中途⚡消息（run 4296aa6a 实证）

- Given 一个 run：首条 user_input 是 [后台任务通知]（07:32），其后 240 行输出，用户 07:47 中途注入真实消息
- When 回放渲染该轮
- Then prompt 为空（顶部无用户气泡），该消息为 user_msg 段且位于 07:47 时间位置的输出之间

### FR-02: 实时路径——空 prompt 已有输出段的轮，user_input 转 user_msg 段

- `appendDeliveredUserMsgIfAbsent` 的「prompt 为空即返回」守卫必须放宽为「prompt 为空**且**无输出段（preamble 不算输出）才返回」；page 与 dialog 两模式的 prompt 补写必须增加同款新鲜轮条件（prompt 空 + 已有输出段 → 不写 prompt，由 user_msg 段承载）。

#### 场景：实时中途消息不前移轮首

- Given 运行中的系统通知开轮（prompt 空、已有输出段），SSE 到达一条真实消息 user_input
- Then 该轮 prompt 保持空，消息以 delivered user_msg 段追加（段尾=当前时刻位置）

### FR-03: 既有行为零回归

- 正常轮（首条 user_input 为真实文本）prompt/组归并行为必须零变化；[后台任务通知] 唯一开轮（无中途消息）必须仍无用户气泡且不产出占位 user_msg 段；新鲜轮（排队派发，无输出段）的 prompt 补写路径必须原样。

#### 场景：正常轮与新鲜轮

- Given 首条 user_input 为真实文本的轮 / 无任何输出段的新鲜轮
- When 各自场景渲染与实时处理
- Then 行为与改动前一致（既有测试全绿）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx「系统通知开轮 + 中途消息：prompt 保持空，消息转 user_msg 段按 ts 插入输出之间」
FR-02: frontend/src/components/daemon/__tests__/steered-usermsg-guard.test.tsx「prompt 空 + 已有输出段（系统通知开轮）：追加 delivered 段，不再前移轮首」
FR-03: frontend/src/components/daemon/__tests__/steered-usermsg-guard.test.tsx「prompt 空 + 无输出段（新鲜轮）：原样返回——开轮正文走 prompt 写入路径」
