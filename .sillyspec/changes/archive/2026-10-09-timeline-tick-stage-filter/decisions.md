---
author: flow-machine-draft
created_at: 2026-10-09T04:17:26.743Z
---
# 决策记录（Decisions）— 2026-10-09-timeline-tick-stage-filter

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：tasks 域内仍无法区分 tasks.md 与 tasks/task-NN.md 卡片的勾选计数（卡片段落勾选会以「tasks · checked N→M」进入推断）——这是 CLI 同款已知诚实面限制（事件只记计数不记任务 id），本次对齐 CLI 语义不扩大不收窄。试过放弃：①events 表加 stage 列 + watcher 推送带 stage——需 schema 迁移与历史回填，跨仓协同成本远超收益；②按 detail 前缀白名单枚举具体 stage 名（design/proposal…）——黑名单式枚举漏新 stage 域，白名单「仅 tasks 参与」与 CLI 语义一致更稳。
