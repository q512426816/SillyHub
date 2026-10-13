---
author: flow-machine-draft
created_at: 2026-10-13T01:32:26.804Z
---
# 决策记录（Decisions）— 2026-10-13-agent-task-stuck-running

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：前端 task_id 兜底把行吸收到**非派发段**（taskTaskId 撞车）。task_id 由 SDK harness 全局唯一生成（call id 亦然），且反查域限于单轮树，实际撞车概率趋零；即便撞车，后果仅是段元数据被终态覆盖（展示层），无数据损坏。 试过但放弃的方案：① backend 读侧把同名组 running 行也参与终态收敛——被 D-009@v1 裁决否决（同名多 running 是合法重试在途实例，会误杀），不动；② daemon 三无场景强行落行/emit——无 runId 载体（`onTurnMessage`/`_emitSessionEvent` 均必填 runId），强行造 run id 会产生脏轮，降级为 WARN 日志；③ 前端 upsertTurn 层按 task_id 跨轮路由——需在轮路由层解析行 content JSON（越层），且 2026-09-15 已有 parent_tool_use_id 跨轮路由覆盖「行落错轮」主场景，收益边际小、风险面大，不做；④ 修存量脏数据（迁移/清洗脚本）——项目未正式上线允许重置数据，且存量行经既有清扫（run 收口 60s / 启动清扫）→ stopped → 读侧去重收敛闭环，无需脚本。
