---
author: flow-machine-draft
created_at: 2026-10-13T05:53:22.087Z
---
# 需求规格（Requirements）— 2026-10-13-slim-subagent-false-running

## 功能需求

### FR-01: 后端 /sessions/{id}/logs?slim=true 截断 tool_call 行时，必须从完整原文解析 tool_use_id 并随 DTO 回传（解析失败不阻断截断）

- slim 截断发生时，后端必须在截断 `content_redacted` 之前从完整原文解析 `tool_use_id`，并把解析结果写入该条 `AgentRunLogEntry` 的新可选字段 `tool_use_id` 回传；原文非 JSON 或缺 `tool_use_id` 时该字段必须为 null，且不得阻断/改变截断行为本身。
- 非 slim 路径（不传 slim 的历史/实时）与未达截断线的行，`tool_use_id` 必须恒为 null（零额外解析成本、零行为变化）。

#### 场景：超长 Agent 派发行截断时回传配对键

- Given 一条 channel=tool_call、content 为含 `tool_use_id` 的合法 JSON 且长度超 2000 字符的日志
- When 客户端以 slim=true 拉取
- Then 该条返回 `content_redacted` 截到 2000 字符、`content_truncated=true`、`tool_use_id` 等于完整 JSON 里的配对键

#### 场景：非 JSON tool_call 行截断容错

- Given 一条 channel=tool_call、content 非 JSON（人类可读摘要）且超长的日志
- When 客户端以 slim=true 拉取
- Then 截断照常发生，`tool_use_id` 为 null，接口不报错

### FR-02: 前端历史装配在 tool_call JSON 解析失败时必须回退消费回传的 tool_use_id：子代理日志正确挂进派发 tool 段，不再产生 stub

- 装配器（applyLogToSegments）处理 tool_use 段时，若行内 JSON 解析不出 `tool_use_id`，必须回退采用归一输入回传的 `toolUseId` 作为段 id 与 stub 合并键；子代理日志（parent_tool_use_id 匹配）必须挂进该 tool 段 children，不得再跌落为 subagent_stub。
- 历史跨 run 重挂登记（regroupSubagentLogsByParent）同样必须回退消费该字段，保证落在后续 run 的 [TASK_*] 终态行能重挂回派发组。

#### 场景：slim 历史回放子代理正确挂靠（会话 f231ca18 实证形态）

- Given 历史日志含一条超长 Agent 派发 tool_call（slim 截断、回传 tool_use_id=call_X）及若干 parent_tool_use_id=call_X 的子代理日志
- When logsToTurns 装配历史轮
- Then 子代理日志全部进入派发 tool 段 children，段序列中不存在该 call_X 的 subagent_stub

#### 场景：跨 run 终态行重挂

- Given 派发 tool_call 在 run A（截断行），其 [TASK_NOTIFICATION] 落在 run B 且 parent_tool_use_id=call_X
- When logsToTurns 装配整个窗口
- Then run B 的该行被重挂进 run A 的组并路由写入派发段 taskStatus

### FR-03: 恢复配对后子代理块状态必须由 result 配对与 [TASK_*] 元数据接管（终态显示已完成/失败，不再恒「运行中」）

- 配对恢复后，子代理块头状态推导不得变化（既有机制：[TASK_*] 元数据优先，其次 tool 段三态）——终态轮里已完成的子代理必须显示已完成徽标与服务端权威时长，禁止再恒显「运行中」。

#### 场景：已完成后台子代理的终态显示

- Given 派发段成功挂靠且有 [TASK_STARTED]（async=true）与 [TASK_NOTIFICATION]（status=completed, elapsed_ms=N）
- When 历史轮渲染子代理块头
- Then 状态徽标为「已完成」、时长为 formatClockDuration(N)，非「运行中」

### FR-04: 历史批量装配（logsToSegments）结束后仍残留的孤儿 stub 必须渲染为中性已结束态（灰点、无脉冲、不显示「运行中」），实时路径 stub 行为零变化

- logsToSegments 批量装配完成后仍存在的 subagent_stub 必须标记为孤儿（派发行缺失/不可解析的数据病理），渲染层对孤儿 stub 必须显示灰色静态状态点、无扫动动画、无「运行中」文案；实时 SSE 路径（applyLogToSegments 逐条增量）产生的暂态 stub 行为必须保持现状（running + 脉冲，等待 tool_use 到达合并）。

#### 场景：派发行彻底缺失的历史孤儿

- Given 历史日志只有某 parent_tool_use_id=call_Y 的子代理日志、其派发 tool_call 行不存在
- When logsToSegments 装配完成
- Then 该 stub 被标记孤儿，渲染为灰点无脉冲，不显示「运行中」

#### 场景：实时暂态 stub 不受影响

- Given 实时 SSE 流中子代理消息先于派发 tool_call 到达
- When applyLogToSegments 逐条装配
- Then stub 按现状显示 running 脉冲，tool_use 到达后照常合并迁入（不标记孤儿）

### FR-05: 非 slim 路径（实时 SSE / 非 slim 历史）行为必须零变化；真实运行中的会话不受影响

- 本变更所有前端改动必须只在「行内 JSON 解析失败」这一回退分支生效；解析成功时（实时流、非 slim 历史）装配产物必须与改前逐字节一致。运行中会话的实时显示不得受影响。

#### 场景：解析成功时零回归

- Given 一条 JSON 完整可解析的 tool_call 行（含 tool_use_id）
- When 装配（无论输入是否携带回传 toolUseId）
- Then 段 id、状态、归属与改前完全一致（行内解析值优先）

### FR-06: 新增/更新的前后端相关测试必须全部通过（不跑全量，全量留给 CI）

- 本变更新增/修改的前后端测试文件必须全部通过；禁止运行全量测试套件。

#### 场景：相关测试绿

- When 运行本变更触达的后端 pytest 子集与前端 vitest 子集
- Then 全部通过，无新增失败

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/daemon/tests/test_session_fast_replay.py::TestSessionLogsRunIdAndSlim::test_slim_truncated_row_returns_tool_use_id「slim 截断回传 tool_use_id / 非 JSON 容错 / 非 slim 恒 None」
FR-02: frontend/src/components/daemon/__tests__/session-log-assembler.test.ts「slim 截断回退 toolUseId：子日志挂进派发段不产生 stub」+ frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx「regroup 回退登记跨 run 终态行」
FR-03: frontend/src/components/daemon/__tests__/session-log-assembler.test.ts「恢复配对后 taskStatus 终态接管头部显示」
FR-04: frontend/src/components/daemon/__tests__/session-log-assembler.test.ts「历史孤儿 stub 标记 orphaned」+ frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx「孤儿 stub 灰点无脉冲不显示运行中、实时 stub 仍脉冲」
FR-05: frontend/src/components/daemon/__tests__/session-log-assembler.test.ts「解析成功时零回归（行内值优先）」
FR-06: 同上前后端测试子集执行记录（flow done 测试对账）
