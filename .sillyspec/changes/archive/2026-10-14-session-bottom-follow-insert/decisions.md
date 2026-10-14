---
author: flow-machine-draft
created_at: 2026-10-14T07:13:00.689Z
---
# 决策记录（Decisions）— 2026-10-14-session-bottom-follow-insert

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：既有测试若显式断言「末轮不变长度变不滚动」会回归——已跑贴底/翻页/竞态/跳转 6 文件 77 例 + preview 三件套 27 例全绿，证实无此断言面。放弃方案：①延长/重启重申窗口至大纲到达——治标且时序敏感（大纲无到达信号）；②page 层 outline effect 主动滚底——绕开 TurnTimeline 守卫链（prepend 静默窗不知情），有上拉弹回回归风险。
