---
author: flow-machine-draft
created_at: 2026-10-07T13:56:32.468Z
---
# 决策记录（Decisions）— 2026-10-07-spec-sync-task-reparse

## D-001@v1: 风险与死路（design 槽4 收割）
- 类型：process
- 状态：confirmed
- 答案：最大风险：archive_hit 全量路径下对大 workspace 逐变更 reparse 的耗时——已在后台任务里（不阻塞同步响应）且全量路径仅归档移动触发（罕见）；后续可按 location 过滤收窄。试过放弃：在 apply_ops 落盘循环里逐 op 触发——绕过调度器会复活 ql-20260909-021 修掉的风暴；放弃。
