---
author: WhaleFall
created_at: 2026-07-14 09:37:47
type: sillyspec-defect
stage: quick
---

# Defect：quick 阶段步骤完成命令模板带 `--change default`，触发步骤重置致 `--done` 进度丢失

## 现象
quick 阶段每一步 CLI 自动生成的「完成后执行」命令是：

```
sillyspec run quick --done --change default --input "..." --output "..."
```

但 `--change` flag 会**触发步骤重置**。执行该命令后 `sillyspec run quick --status` 显示步骤回退（例如在 step 3 执行 `--done --change default` 后，status 退回「step 2 current」，进度停在 1/3），形成「--done 永远无法推进」的假象。

## 复现
- 变更/任务：ql-20260714-001-8c02（ppm export-excel 路由顺序修复）
- 连续多次 `sillyspec run quick --done --change default ...` 后，`--status` 仍显示 `step 2 ← 当前`、进度 `1/3`。
- 去掉 `--change`、改用 `sillyspec run quick --done --linked-changes none ...` 后，step 2 → step 3 → 3/3 完成，正常收尾。

## 根因（工具自身矛盾）
quick skill 文档已明确警告：

> quick 阶段的 `--change` 语义是「关联变更」**且会触发步骤重置**，**不要用 `--change` 来指定关联变更**。多活跃变更时改用 `--linked-changes none`。

但 CLI 自动渲染的步骤完成命令模板仍硬编码 `--change default`，与上述文档自相矛盾，直接误导执行者反复踩重置。

## 规避（已验证）
执行 quick `--done` 时**不要带 `--change`**：
- 不关联变更：`sillyspec run quick --done --linked-changes none --output "..."`
- 多变更关联：`sillyspec run quick --done --linked-changes a,b --output "..."`

## 期望修复
步骤模板的「完成后执行」命令应改为不带 `--change`（或用 `--linked-changes`），与 skill 文档一致，避免把会导致重置的 flag 写进引导命令。
