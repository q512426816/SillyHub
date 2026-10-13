---
author: flow-machine-draft
created_at: 2026-10-13T01:14:30.214Z
---
# 提案书（Proposal）— 2026-10-13-multiturn-changeid-misjudge

## 动机

任务原话转写：动机：轮级变更归因（2026-10-12-run-level-change-attribution）给聊天轮 run.change_id 打锚后，_apply_session_terminal_status 的多轮判定（spec_strategy==interactive 且 run.change_id is None）被击穿——生产实证会话 47e2ff1a 今天每轮完成后会话被误置 ended，用户每轮都要手动重新开启。

成功标准：
- 聊天会话（session.change_id 为 NULL）的 interactive 轮无论 completed/failed 均保持 active，不再被 run.change_id 误收口
- stage 等真绑定会话（session.change_id 非空）维持既有语义：completed→ended、失败→failed，D-006 可恢复失败豁免不变
- quick-chat / platform-managed / sillyspec / None 策略等单轮收口语义零回归
- D-005 幂等守卫零回归（session 已终态返回 None）

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 聊天会话（session.change_id 为 NULL）的 interactive 轮无论 completed/failed 均保持 active，不再被 run.change_id 误收口
2. stage 等真绑定会话（session.change_id 非空）维持既有语义：completed→ended、失败→failed，D-006 可恢复失败豁免不变
3. quick-chat / platform-managed / sillyspec / None 策略等单轮收口语义零回归
4. D-005 幂等守卫零回归（session 已终态返回 None）

## 成功标准（可验证）

1. 聊天会话（session.change_id 为 NULL）的 interactive 轮无论 completed/failed 均保持 active，不再被 run.change_id 误收口
2. stage 等真绑定会话（session.change_id 非空）维持既有语义：completed→ended、失败→failed，D-006 可恢复失败豁免不变
3. quick-chat / platform-managed / sillyspec / None 策略等单轮收口语义零回归
4. D-005 幂等守卫零回归（session 已终态返回 None）
