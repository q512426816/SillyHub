---
author: flow-machine-draft
created_at: 2026-10-10T16:29:19.608Z
---
# 决策记录（Decisions）— 2026-10-11-mobile-subagent-drawer

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：- 最大风险：Drawer 内 SubagentDetailPanel 的 h-full 布局在 antd Drawer body 内的高度链——body 已设 flex column + 面板根 h-full（jsdom 无布局无法实测，真机验收项）；若异常退化方案为 body 加显式 height。 - 放弃方案「mobile 页宿主自持三 props（照 portal 装配）」：手机页无右栏可开，props 还得指回组件内状态，多一层无意义转发；放弃「mobile 复用内联展开 + 默认折叠」：信息密度仍高于紧凑卡且与 PC 形态不一致（用户点名要 PC 同构）。 - 已知残留：Drawer 无嵌套路由/返回键联动（移动端返回手势直接退页面而非关 Drawer）——后续可按需接 antd onClose 与历史栈。
