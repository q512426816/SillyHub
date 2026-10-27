---
author: flow-machine-draft
created_at: 2026-10-27T00:58:14.400Z
---
# 决策记录（Decisions）— 2026-10-27-mobile-chat-visual-round2

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：玻璃半透明在深色/花哨内容上滚动时对比度下降——bg-card/75+blur-md 是透明度与模糊的平衡点（穿行内容呈朦胧块非清晰透字），真机不满意可一行调参（/75→/85 或 blur-md→lg）。放弃的方案：①直接改组件内 max-w 类（两挂点+PC 要分支判断，CSS 一处覆盖更稳）；②输入区外框也玻璃化（非悬浮层，无穿行内容只有色差，无视觉收益）；③两面板收进 Drawer（⋯ 菜单开关已够轻，Drawer 交互重）。
