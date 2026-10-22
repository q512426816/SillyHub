---
author: flow-machine-draft
created_at: 2026-10-22T03:12:11.443Z
---
# 决策记录（Decisions）— 2026-10-22-agent-profile-modal-restyle

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：既有单测查询方式依赖旧 DOM（antd Checkbox.Group 的 label 结构），重构后需按新 DOM（芯片以 role=checkbox/aria-checked 暴露）调整查询手段——行为断言不变、只改查询方式，逐用例核对防止「改测试凑通过」。次风险：antd Modal title 传 ReactNode 后高度变化在不同视口的表现，靠实页三主题截图对照兜底。已放弃方案：①继续用 antd Checkbox.Group + options render 定制两行芯片（Group 布局受限、工具栏与三态联动要绕过 Group 自身 state，别扭且难测，放弃）；②全局滚动条主题化（影响面全站，超出本变更范围，收窄为作用域工具类，全局化留给后续独立变更）。
