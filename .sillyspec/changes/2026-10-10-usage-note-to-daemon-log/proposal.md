---
author: flow-machine-draft
created_at: 2026-10-10T02:08:40.012Z
---
# 提案书（Proposal）— 2026-10-10-usage-note-to-daemon-log

## 动机

任务原话转写：交互会话里 run 收口时若有存活后台任务，daemon 会向会话消息流追加 [USAGE_NOTE] 标注行（daemon.ts FR-04），每轮必触发、对用户是纯噪音且无法量化归属，需要移除会话内提示、排障信息降级到 daemon 日志。
成功标准：
- hasLiveBackgroundTasks=true 的 run 收口不再向 submitMessages 发 [USAGE_NOTE] 行
- 排障意图保留：daemon 结构化日志记录存活后台任务标记 + 本轮 cost 差分（cost_delta_usd）
- total_cost_usd 缺失时日志安全降级（字段 null，不抛错）
- daemon-usage-note.test.ts 改写为两态断言（无消息流行 + 有日志），先红后绿
- 相关面（daemon-interactive-bridge 等）合跑通过 + tsc --noEmit 0 错

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. hasLiveBackgroundTasks=true 的 run 收口不再向 submitMessages 发 [USAGE_NOTE] 行
2. 排障意图保留：daemon 结构化日志记录存活后台任务标记 + 本轮 cost 差分（cost_delta_usd）
3. total_cost_usd 缺失时日志安全降级（字段 null，不抛错）
4. daemon-usage-note.test.ts 改写为两态断言（无消息流行 + 有日志），先红后绿
5. 相关面（daemon-interactive-bridge 等）合跑通过 + tsc --noEmit 0 错

## 成功标准（可验证）

1. hasLiveBackgroundTasks=true 的 run 收口不再向 submitMessages 发 [USAGE_NOTE] 行
2. 排障意图保留：daemon 结构化日志记录存活后台任务标记 + 本轮 cost 差分（cost_delta_usd）
3. total_cost_usd 缺失时日志安全降级（字段 null，不抛错）
4. daemon-usage-note.test.ts 改写为两态断言（无消息流行 + 有日志），先红后绿
5. 相关面（daemon-interactive-bridge 等）合跑通过 + tsc --noEmit 0 错
