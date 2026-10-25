---
author: flow-machine-draft
created_at: 2026-10-25T03:52:51.959Z
---
# 决策记录（Decisions）— 2026-10-25-subagent-card-unify-panel

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：- 风险：无 Provider 宿主（回放体、悬浮助手）失去子代理详情入口——头部信息仍完整，完整过程可去「进度」视图看；属用户裁决的统一取舍（已声明边界）。 - Drawer 覆盖在弹窗内容上而非并排：弹窗宽度有限（约 60vw~90vw），固定右栏会把消息流压到不可用；浮层是移动端已验证的同构方案。 - 放弃方案：① dialog 内固定右栏（布局压缩严重）；② 保留内联展开作为无 Provider 回退（用户明确要求去掉）；③ 把 page 右栏整套抽出共享 hook（改动面大，dialog 仅需 Drawer 出口，复制 20 行状态更小）。
