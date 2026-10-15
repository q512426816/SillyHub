---
author: flow-machine-draft
created_at: 2026-10-15T01:46:12.968Z
---
# 决策记录（Decisions）— 2026-10-14-session-bottom-no-restore

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：用户期望「刷新回到上次阅读位置」的语义被改（现改为落底）——与产品贴底跟随设计及用户本次诉求（刷新应落底）一致，且切换会话本就落底，语义统一。放弃方案：①识别恢复写入并重新贴底（恢复事件 isTrusted=true 无法与用户滚动区分，只能加时序启发式，脆弱）；②挂载后延时强贴底（时序赌注，恢复时机无上界）。
