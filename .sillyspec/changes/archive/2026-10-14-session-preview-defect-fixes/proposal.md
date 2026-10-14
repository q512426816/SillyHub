---
author: flow-machine-draft
created_at: 2026-10-14T06:20:49.727Z
---
# 提案书（Proposal）— 2026-10-14-session-preview-defect-fixes

## 动机

任务原话转写：用户实测 2026-10-14-session-turn-preview-cards 上线后发现两缺陷：①额度耗尽失败轮（第4/10轮，日志含 user_input 无答复）点击预览卡/导航无反应不展开——三处 anyBody/hasBody 判定只认 segments/output 不认 prompt，失败轮被误入零正文幂等黑名单，而其失败详情卡本可由 runs 快照 error_detail 注入渲染；②轮次编号错乱——logsToTurns 按批次局部编号（初始窗口末块显第12轮/单轮直达全显第1轮/翻页首块显第8轮），归并层未把大纲 seq 盖章到已加载块，预览卡轮号正确而真实块错误。

成功标准：
- 额度失败轮（有 prompt 无 output）点击预览卡/导航后原位展开：用户消息气泡 + 失败详情卡（error_detail 注入），预览卡被替换无双块
- 真零正文轮（无 prompt 无 output，群聊空 user_input）幂等语义不变：首次直达后重复点击仍不重复请求不重复 prepend
- 已加载块 RoundDivider 轮号 = 大纲权威 seq（初始窗口/直达/预取/翻页四路径一致），与预览卡/导航轮号对齐
- 盖章不击穿 TurnRow memo（同输入重复派生保持同引用）
- 既有 preview 相关测试面复跑绿 + 新增失败轮展开/轮号盖章用例绿 + tsc 0

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. 额度失败轮（有 prompt 无 output）点击预览卡/导航后原位展开：用户消息气泡 + 失败详情卡（error_detail 注入），预览卡被替换无双块
2. 真零正文轮（无 prompt 无 output，群聊空 user_input）幂等语义不变：首次直达后重复点击仍不重复请求不重复 prepend
3. 已加载块 RoundDivider 轮号 = 大纲权威 seq（初始窗口/直达/预取/翻页四路径一致），与预览卡/导航轮号对齐
4. 盖章不击穿 TurnRow memo（同输入重复派生保持同引用）
5. 既有 preview 相关测试面复跑绿 + 新增失败轮展开/轮号盖章用例绿 + tsc 0

## 成功标准（可验证）

1. 额度失败轮（有 prompt 无 output）点击预览卡/导航后原位展开：用户消息气泡 + 失败详情卡（error_detail 注入），预览卡被替换无双块
2. 真零正文轮（无 prompt 无 output，群聊空 user_input）幂等语义不变：首次直达后重复点击仍不重复请求不重复 prepend
3. 已加载块 RoundDivider 轮号 = 大纲权威 seq（初始窗口/直达/预取/翻页四路径一致），与预览卡/导航轮号对齐
4. 盖章不击穿 TurnRow memo（同输入重复派生保持同引用）
5. 既有 preview 相关测试面复跑绿 + 新增失败轮展开/轮号盖章用例绿 + tsc 0
