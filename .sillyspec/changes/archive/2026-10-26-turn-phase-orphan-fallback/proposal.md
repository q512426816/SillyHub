---
author: flow-machine-draft
created_at: 2026-10-26T07:01:45.648Z
---
# 提案书（Proposal）— 2026-10-26-turn-phase-orphan-fallback

## 动机

任务原话转写：阶段事件竞态丢弃修复:turn_phase 事件按 run_id 精确匹配未命中时改为回退归属到当前唯一活跃轮(占位轮)。背景:生产实证(会话 221ac351/1f0836a1)daemon 每轮正常上报(TRACE 记点成对铁证),但前端 applyTurnPhase 在事件跑赢 HTTP 响应(占位轮尚未换成真实 run_id)时按设计丢弃孤 phase→间歇性永远卡「执行器已接收」超时警示;本机 daemon 事件路径快,竞态高发。已与用户确认方案:回退活跃轮(借平台单会话单活跃 run 不变式,零缓存零 TTL),否决暂存池方案(补丁性质,TTL/补写钩子复杂度)。

成功标准：
- applyTurnPhase 未命中 run_id 时必须回退写入当前唯一 pending/running/interrupting 轮(currentRunId 指向),禁止静默丢弃该事件
- 无活跃轮时(断线重连迟到事件等)必须维持丢弃,禁止创建幽灵轮(原设计不变)
- replacePlaceholderTurn 换真实 run_id 时 currentPhase 必须保留(spread 已保留,测试锁定)
- 排队轮(非活跃)必须不接回退事件
- 竞态用例(事件先于 HTTP 响应到达)与既有 turn_phase 前端单测全绿

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. applyTurnPhase 未命中 run_id 时必须回退写入当前唯一 pending/running/interrupting 轮(currentRunId 指向),禁止静默丢弃该事件
2. 无活跃轮时(断线重连迟到事件等)必须维持丢弃,禁止创建幽灵轮(原设计不变)
3. replacePlaceholderTurn 换真实 run_id 时 currentPhase 必须保留(spread 已保留,测试锁定)
4. 排队轮(非活跃)必须不接回退事件
5. 竞态用例(事件先于 HTTP 响应到达)与既有 turn_phase 前端单测全绿

## 成功标准（可验证）

1. applyTurnPhase 未命中 run_id 时必须回退写入当前唯一 pending/running/interrupting 轮(currentRunId 指向),禁止静默丢弃该事件
2. 无活跃轮时(断线重连迟到事件等)必须维持丢弃,禁止创建幽灵轮(原设计不变)
3. replacePlaceholderTurn 换真实 run_id 时 currentPhase 必须保留(spread 已保留,测试锁定)
4. 排队轮(非活跃)必须不接回退事件
5. 竞态用例(事件先于 HTTP 响应到达)与既有 turn_phase 前端单测全绿
