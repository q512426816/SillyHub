---
author: flow-machine-draft
created_at: 2026-10-10T10:35:27.990Z
---
# 设计记录（Design Record）— 2026-10-10-session-turn-token-speed

## 做法概述

参考 deepseek-harness 的口径：token 速度 = 提供方报告的输出词元 ÷ 模型生成时长
（**不含**工具执行时间），宁可不显示也不用含工具等待的墙钟估速（那会把 45 tok/s
稀释成 3 tok/s，多供应商平台里会误导用户以为供应商慢）。本平台没有逐 chunk 流
（deepseek-harness 的 TTFT/decode 分段拿不到），但 `AgentRun.duration_api_ms` 列
（Claude SDK 语义=本轮累计 API 调用时长，天然不含工具时间）在轮收尾时已由
daemon 结果元数据写入（close_run_steps.py:313），只是两个出口都没透传。因此本
变更是一个纯透传 + 展示改动：后端在 turn_completed SSE 事件与 SessionRunRead
DTO 两处补上该字段，前端沿既有 token 接线路径（envelope → onTurnCompleted →
SessionTurnView → 轮尾徽标）加一个可选字段 `apiDurationMs`，轮尾在终态轮把
`outputTokens ÷ (apiDurationMs/1000)` 格式化为『N tok/s』追加在 token 计数后。
运行中 / 无数据不显示（诚实优于伪造，对齐 deepseek-harness 哲学）。

实时运行中的速度（需 daemon 在 usage 管线逐调用计时）不在本变更范围，作后续
可选项；会话级聚合速度因历史窗口化求和必算少（agent-log-turns.ts 既有结论）
且需聚合端点改动，同样不在本次范围。

## 接口契约

- SSE `turn_completed` 事件（backend → 前端，ad-hoc dict 契约在
  frontend/src/lib/daemon/session-sse.ts SessionStreamEnvelope）：新增可选键
  `duration_api_ms: number | null`（close_run_steps.py 无条件携带，None=null）。
  旧前端忽略新键零影响；新前端对旧 backend 键缺失按 undefined→null 处理。
- REST `GET /api/daemon/sessions/{id}/runs`：SessionRunRead 新增
  `duration_api_ms: int | None`（from_attributes 直映，查询零改动）；OpenAPI
  重生成 `backend/openapi.json` + `frontend/src/lib/api-types.ts`（pnpm gen:types）。
- 前端 `SessionTurnView`（turn-timeline.tsx）：新增可选字段
  `apiDurationMs?: number | null`（外部构造者 logsToTurns / agent-log-turns /
  旧组装不改不受影响，ctxTokens 可选字段同款先例）。
- 新增纯函数模块 `frontend/src/components/daemon/turn-speed.ts`：
  `formatTokensPerSecond(tps: number): string`（≥10 取整、<10 一位小数、负值钳 0）
  与 `turnTokenSpeedText(outputTokens, apiDurationMs, status): string | null`
  （终态 + 双值可得 + 时长 > 0 才返回文本，否则 null）。
- 其余函数签名零变化（upsertTurn / enrichDisplayTurns / onTurnCompleted 内部
  多写一个字段）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：duration_api_ms 只随 turn_completed 终态事件/终态 run 快照
   到达，无中途流；迟到的重复 turn_completed（对账重放）经既有幂等终态门
   （TERMINAL_TURN_STATUSES 不覆盖）与 ?? 链（`env.duration_api_ms ??
   turn.apiDurationMs`）保持首值稳定；enrichDisplayTurns 只补缺不覆盖实时值。
2. 并发写：单轮字段仅由该轮事件写入（upsertTurn 按 run_id 定位），page/dialog
   各自独立 state 无跨模式共享；runsMeta 快照刷新（refreshRunsMeta）与实时
   onTurnCompleted 竞争时 ?? 链「实时值优先」语义与既有 inputTokens 完全一致。
3. 切换/生命周期：会话切换时 page 的 turns/runsMeta 随既有 effect 重建，新字段
   随对象整体重建不残留；duration_api_ms 是轮级不可变终值，无跨轮累加状态，
   无需清理。
4. 作用域：字段按 run_id 挂轮，跨工作区/跨会话无共享面；群聊影子会话
   （group-shadow-stream）不经本链路不受影响；子代理行不产生独立 turn，
   其 token 已并入主轮 usage，速度分母同源（duration_api_ms 为 run 级），口径一致。

## 风险与死路

最大风险：`duration_api_ms` 只有 Claude 系引擎上报（codex/cursor 等引擎结果
元数据可能缺省）→ 这些引擎的轮永远无速度显示。处置：FR-04 明确不显示即预期
行为，不伪造；后续若要全引擎覆盖需 daemon 各 driver 逐调用计时（独立变更）。
第二风险：api-types 重生成暴露无关旧测试债——按仓库规则 21 顺手补字段修好，
不回退手写。

试过但放弃的方案：
- 实时运行中显示 Δoutput/Δt（tokens 事件差分 ÷ 墙钟）：分母含工具执行时间，
  数字被稀释 5-10 倍，多供应商对比场景下误导性强，且 deepseek-harness 明确
  拒绝该口径——放弃，宁可运行中不显示。
- 后端聚合端点加会话级总时长出「会话平均速度」：历史窗口化下前端求和必算少
  （agent-log-turns.ts 注释既有结论），需新聚合查询，收益/成本比低——留后续。
- daemon 侧逐调用计时透传（对齐 deepseek-harness 的 decode 段口径）：跨
  claude/codex/cursor 三引擎消息边界形状不一致，改动面大——本变更先用
  duration_api_ms（含 TTFT 的近似 decode 口径），逐调用计时留独立变更。
