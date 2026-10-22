---
author: flow-machine-draft
created_at: 2026-10-20T04:26:38.309Z
---
# 决策记录（Decisions）— 2026-10-20-session-error-visibility

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：把真打断误报为失败（ql-20260918-003 曾专门修过反方向——打断被渲染成「轮次失败」的误导）。对策：升级条件严格限定 buildErrorLogItem 返回非 null（模型错误键存在才非 null），error_detail 空的真打断零触碰；FR-03 零回归用例钉住。 试过放弃的方案：① 后端拆新 error_code（如 interactive_model_failed）——需 backend+daemon+前端三方发版且存量 run 无法重写，放弃；② RunErrorItem 默认展开完整 raw——raw 可达数千字符（实测 404 HTML 全文），撑爆消息流，改为首行截断摘要 + 折叠全文。
