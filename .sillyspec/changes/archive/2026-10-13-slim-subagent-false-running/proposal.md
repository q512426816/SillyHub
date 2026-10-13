---
author: flow-machine-draft
created_at: 2026-10-13T05:53:22.087Z
---
# 提案书（Proposal）— 2026-10-13-slim-subagent-false-running

## 动机

任务原话转写：动机：历史会话里已结束的子代理（Explore/general-purpose 等）永远显示「运行中」——2026-09-27-session-fast-replay 的 slim 截断把超 2000 字符的 Agent 派发 tool_call JSON 截残，前端 parseToolUseRaw 解析失败拿不到 tool_use_id，子代理日志路由不进派发 tool 段、跌落为 subagent_stub 兜底段，而 stub 状态写死 running（实证会话 f231ca18 两条派发 3333/11291 字符均中招）。
成功标准：
- 后端 /sessions/{id}/logs?slim=true 截断 tool_call 行时，从完整原文解析 tool_use_id 并随 DTO 回传（解析失败不阻断截断）
- 前端历史装配在 tool_call JSON 解析失败时回退消费回传的 tool_use_id：子代理日志正确挂进派发 tool 段，不再产生 stub
- 恢复配对后子代理块状态由 result 配对与 [TASK_*] 元数据接管（终态显示已完成/失败，不再恒「运行中」）
- 历史批量装配（logsToSegments）结束后仍残留的孤儿 stub 渲染为中性已结束态（灰点、无脉冲、不显示「运行中」），实时路径 stub 行为零变化
- 非 slim 路径（实时 SSE / 非 slim 历史）行为零变化；真实运行中的会话不受影响
- 新增/更新的前后端相关测试全部通过（不跑全量）

## 变更范围

按成功标准机械推导，共 6 条验收面：
1. 后端 /sessions/{id}/logs?slim=true 截断 tool_call 行时，从完整原文解析 tool_use_id 并随 DTO 回传（解析失败不阻断截断）
2. 前端历史装配在 tool_call JSON 解析失败时回退消费回传的 tool_use_id：子代理日志正确挂进派发 tool 段，不再产生 stub
3. 恢复配对后子代理块状态由 result 配对与 [TASK_*] 元数据接管（终态显示已完成/失败，不再恒「运行中」）
4. 历史批量装配（logsToSegments）结束后仍残留的孤儿 stub 渲染为中性已结束态（灰点、无脉冲、不显示「运行中」），实时路径 stub 行为零变化
5. 非 slim 路径（实时 SSE / 非 slim 历史）行为零变化；真实运行中的会话不受影响
6. 新增/更新的前后端相关测试全部通过（不跑全量）

## 成功标准（可验证）

1. 后端 /sessions/{id}/logs?slim=true 截断 tool_call 行时，从完整原文解析 tool_use_id 并随 DTO 回传（解析失败不阻断截断）
2. 前端历史装配在 tool_call JSON 解析失败时回退消费回传的 tool_use_id：子代理日志正确挂进派发 tool 段，不再产生 stub
3. 恢复配对后子代理块状态由 result 配对与 [TASK_*] 元数据接管（终态显示已完成/失败，不再恒「运行中」）
4. 历史批量装配（logsToSegments）结束后仍残留的孤儿 stub 渲染为中性已结束态（灰点、无脉冲、不显示「运行中」），实时路径 stub 行为零变化
5. 非 slim 路径（实时 SSE / 非 slim 历史）行为零变化；真实运行中的会话不受影响
6. 新增/更新的前后端相关测试全部通过（不跑全量）
