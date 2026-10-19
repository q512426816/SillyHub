---
author: flow-machine-draft
created_at: 2026-10-19T07:14:26.388Z
---
# 任务注册表（Tasks）— 2026-10-19-change-assets-cross-repo-repos

- [x] task-01: assets DTO 增 scopeAudit.repos 元数据（key/锚点/计数/降级/patchSha256，不回传 patch 正文），旧归档无 repos 时零变化
- [x] task-02: 变更资产卡按仓分段展示跨仓冻结面，并标注主仓/各仓口径避免双计歧义
- [x] task-03: 后端单测覆盖 repos 投影与缺键/降级形态，前端类型检查与构建通过
- [x] task-04: 既有 patch 语义不变：files/totals 仍为主仓面
