---
author: flow-machine-draft
created_at: 2026-10-10T15:33:49.552Z
---
# 提案书（Proposal）— 2026-10-10-system-opened-turn-usermsg

## 动机

任务原话转写：运行中「立即发送（⚡引导注入）」的用户消息落到轮次顶部而非按发生时间穿插在回复流中。根因（服务器 run 4296aa6a 实证）：轮次由 [后台任务通知] 系统消息开启——该行被剥前导后为空、不占 prompt 槽；用户 07:47 中途注入的真实消息成了该轮首条有效 user_input，回放路径被提升为轮 prompt（顶部气泡）、实时路径同理（prompt 空即写入），时序全丢（该轮已有 240 行更早输出）。
成功标准：
- 回放 logsToTurns：首条 user_input 即使是系统注入（剥空）也占住开轮槽（prompt 保持空、顶部无用户气泡），后到真实消息转 user_msg 段按 ts 插入输出之间
- 实时路径：prompt 为空但轮已有输出段的 user_input 不再写 prompt，转 delivered user_msg 段（appendDeliveredUserMsgIfAbsent 守卫放宽）；新鲜轮（无输出段）行为不变
- 正常轮（首条 user_input 是真实文本）行为零变化；[后台任务通知] 唯一开轮（无中途消息）行为零变化
- logsToTurns / appendDeliveredUserMsgIfAbsent 新单测覆盖上述场景，既有相关测试全绿 + tsc 零错

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 回放 logsToTurns：首条 user_input 即使是系统注入（剥空）也占住开轮槽（prompt 保持空、顶部无用户气泡），后到真实消息转 user_msg 段按 ts 插入输出之间
2. 实时路径：prompt 为空但轮已有输出段的 user_input 不再写 prompt，转 delivered user_msg 段（appendDeliveredUserMsgIfAbsent 守卫放宽）；新鲜轮（无输出段）行为不变
3. 正常轮（首条 user_input 是真实文本）行为零变化；[后台任务通知] 唯一开轮（无中途消息）行为零变化
4. logsToTurns / appendDeliveredUserMsgIfAbsent 新单测覆盖上述场景，既有相关测试全绿 + tsc 零错

## 成功标准（可验证）

1. 回放 logsToTurns：首条 user_input 即使是系统注入（剥空）也占住开轮槽（prompt 保持空、顶部无用户气泡），后到真实消息转 user_msg 段按 ts 插入输出之间
2. 实时路径：prompt 为空但轮已有输出段的 user_input 不再写 prompt，转 delivered user_msg 段（appendDeliveredUserMsgIfAbsent 守卫放宽）；新鲜轮（无输出段）行为不变
3. 正常轮（首条 user_input 是真实文本）行为零变化；[后台任务通知] 唯一开轮（无中途消息）行为零变化
4. logsToTurns / appendDeliveredUserMsgIfAbsent 新单测覆盖上述场景，既有相关测试全绿 + tsc 零错
