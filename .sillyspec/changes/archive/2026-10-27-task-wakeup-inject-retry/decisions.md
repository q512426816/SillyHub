---
author: flow-machine-draft
created_at: 2026-10-27T02:21:33.257Z
---
# 决策记录（Decisions）— 2026-10-27-task-wakeup-inject-retry

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：- **最大风险**：重试造成的重复唤醒轮（首注入实际成功但响应丢失时）。缓解：后端忙轮合并恒≤1 条 + prompt 防重执行指令；空闲期重复轮为纯汇报轮，成本可容忍。 - **次风险**：env 覆写错误计划（如全 0 列表）导致重试风暴——解析层非正整数项忽略、默认计划兜底；止血开关 `=0` 一键回旧行为。 - **放弃的方案**：B/C 两方向（理由见上问评估）；「WS onConnected 立即重试一轮」（recover 链先例）——需挂 WS 连接回调穿层接线，收益（最快场景省 ≤5s）不配复杂度，退避首档 5s 已够短；TRACE 刷屏曾考虑在 daemon.ts 拦截点把 `notePhaseEmit` 挪到 first_event 防重 Set 判定之后——只治桥侧半边，emit 侧（events.ts 每 envelope）仍刷，防重做进 helper 一处治两侧。
