---
author: flow-machine-draft
created_at: 2026-10-24T16:08:34.422Z
---
# 提案书（Proposal）— 2026-10-24-trajectory-context-rows

## 动机

任务原话转写：上一变更（2026-10-22-trajectory-context-jump）接错了数据源：processItems.system_event 在实时与历史路径均几乎为空（DB 实证 channel 仅 stdout/tool_call/user_input/stderr 四种，注入信息以 user_input 落库、装配成 turn_trigger 段）。实测取证：turn_trigger 段（后台任务通知/自动续跑/群聊影子直聊来源/定时到点）当前被 rowKindOf 标为「用户」行且 ts 未用作锚点（全部挤在轮首）——这就是用户看不到「上下文/系统」行的根因。

成功标准：
- turn_trigger 段在轨迹账本显示为「上下文」类型行（kind=system + meta.contextEvent），摘要为段 text，锚点取段 ts（缺失用轮首，不伪造）
- user_msg 段保持「用户」行，锚点同样优先 startedAt 再 ts
- processItems.system_event 派生保留（回放路径零回归）
- 相关测试零回归、新增用例全绿、frontend tsc --noEmit 退出 0

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. turn_trigger 段在轨迹账本显示为「上下文」类型行（kind=system + meta.contextEvent），摘要为段 text，锚点取段 ts（缺失用轮首，不伪造）
2. user_msg 段保持「用户」行，锚点同样优先 startedAt 再 ts
3. processItems.system_event 派生保留（回放路径零回归）
4. 相关测试零回归、新增用例全绿、frontend tsc --noEmit 退出 0

## 成功标准（可验证）

1. turn_trigger 段在轨迹账本显示为「上下文」类型行（kind=system + meta.contextEvent），摘要为段 text，锚点取段 ts（缺失用轮首，不伪造）
2. user_msg 段保持「用户」行，锚点同样优先 startedAt 再 ts
3. processItems.system_event 派生保留（回放路径零回归）
4. 相关测试零回归、新增用例全绿、frontend tsc --noEmit 退出 0
