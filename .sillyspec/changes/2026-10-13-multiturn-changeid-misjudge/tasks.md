---
author: flow-machine-draft
created_at: 2026-10-13T01:14:30.214Z
---
# 任务注册表（Tasks）— 2026-10-13-multiturn-changeid-misjudge

- [x] task-01: 聊天会话（session.change_id 为 NULL）的 interactive 轮无论 completed/failed 均保持 active，不再被 run.change_id 误收口
- [x] task-02: stage 等真绑定会话（session.change_id 非空）维持既有语义：completed→ended、失败→failed，D-006 可恢复失败豁免不变
- [x] task-03: quick-chat / platform-managed / sillyspec / None 策略等单轮收口语义零回归
- [x] task-04: D-005 幂等守卫零回归（session 已终态返回 None）
