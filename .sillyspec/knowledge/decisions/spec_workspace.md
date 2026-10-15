# 决策知识 — spec_workspace

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-001@v1 风险与死路（design 槽4 收割）
状态：implemented
变更：2026-10-07-spec-sync-task-reparse
锚点：未记录
最近确认：f82bc067ca74946ac7c6b88d4e6382e54e6c665c
理由：最大风险：archive_hit 全量路径下对大 workspace 逐变更 reparse 的耗时——已在后台任务里（不阻塞同步响应）且全量路径仅归档移动触发（罕见）；后续可按 location 过滤收窄。试过放弃：在 apply_ops 落盘循环里逐 op 触发——绕过调度器会复活 ql-20260909-021 修掉的风暴；放弃。
