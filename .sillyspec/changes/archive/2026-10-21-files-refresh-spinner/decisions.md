---
author: flow-machine-draft
created_at: 2026-10-21T03:45:08.341Z
---
# 决策记录（Decisions）— 2026-10-21-files-refresh-spinner

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：答：最大风险是双入口（按钮+错误重试）并发时转圈提前消失的反馈时机问题——影响仅视觉反馈、不涉数据，触发条件苛刻（错误态下双击两入口），接受不改计数器（复杂度不值）。放弃方案：① 给全局 `Button` 组件加通用 loading prop——影响全部消费面，远超本诉求；② 新增独立 POST 同步端点+按钮联动——已被 2026-10-13-change-files-refresh-sync D-007@v1 否决（GET 纯读语义 + 用户诉求是刷新动作本身带同步），不复潮。
