---
author: flow-machine-draft
created_at: 2026-10-20T05:33:12.928Z
---
# 决策记录（Decisions）— 2026-10-20-codex-models-fetch-candidates

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：追加候选使「全候选 404」场景多一次上游请求（每条 models 拉取至多多 1 次 GET），对中转站限流面略增——量级可忽略（手动触发的低频操作）。次风险：`base+"/models"` 对某些会把 `/models` 当模型名路由的网关返回 200 非 models JSON——`_parse_models_response` 已有「body 不可解析/缺 data 字段 → AllFailed」兜底，不会误报成功。 试过但放弃的方案： - 按 provider 名/域名特判端点（如 bigmodel → /api/paas/v4/models）：vendor 分支进 service，维护面差、新供应商每次都要改代码；放弃。 - 前端对 codex 条目隐藏拉取按钮：不解决根因，且智谱/OpenCode 端点本就支持拉取；放弃。
