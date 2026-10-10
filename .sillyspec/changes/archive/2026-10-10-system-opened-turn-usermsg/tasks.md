---
author: flow-machine-draft
created_at: 2026-10-10T15:33:49.552Z
---
# 任务注册表（Tasks）— 2026-10-10-system-opened-turn-usermsg

- [x] task-01: 回放 logsToTurns：首条 user_input 即使是系统注入（剥空）也占住开轮槽（prompt 保持空、顶部无用户气泡），后到真实消息转 user_msg 段按 ts 插入输出之间（openerSlotSeen + 占位空组；用例「系统通知开轮 + 中途消息」）
- [x] task-02: 实时路径：prompt 为空但轮已有输出段的 user_input 不再写 prompt，转 delivered user_msg 段（appendDeliveredUserMsgIfAbsent 守卫放宽 + page/dialog prompt 补写新鲜轮条件；用例「追加 delivered 段，不再前移轮首」）
- [x] task-03: 正常轮（首条 user_input 是真实文本）行为零变化；[后台任务通知] 唯一开轮（无中途消息）行为零变化（用例「正常轮不受影响」「系统通知唯一开轮」「新鲜轮原样返回」+ 既有回归 5 文件 136/136 绿）
- [x] task-04: logsToTurns / appendDeliveredUserMsgIfAbsent 新单测覆盖上述场景，既有相关测试全绿 + tsc 零错（新 7 用例 + 2 文件 41/41；回归簇 5 文件 136/136；tsc exit 0）
