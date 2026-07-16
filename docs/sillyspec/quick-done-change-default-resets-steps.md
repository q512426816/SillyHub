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

## 2026-07-16 复测：CLI 行为已变，上述规避失效，根因深挖

当前 CLI 版本模板已改为 `--change quick-<sessionId>`（不再是 `--change default`）。复测 ql-20260716-001-7f3a（ppm 项目维护创建人自动填充）发现**两条路都无法把 quick 会话推进到 3/3**：

- **带 `--change quick-<id>`**：sessionId 稳定（不再串号），但 step3 的 `--done` 反复退回显示「✅ Step 2/3 完成」+ step3 prompt，进度卡死无法收尾。
- **不带 `--change` / `--linked-changes none`**：每次 `--done` 都生成**全新** sessionId（如 quick-bff37301 / quick-8ae18a4a），从头「完成 step1 → 进 step2」，7/14 的 `--linked-changes none` 规避方案完全失效。

### 根因（更深一层）
quick **会话的 step 进度根本不落盘**：
- `.sillyspec/.runtime/quick-sessions/<id>/` 只有 `guard.json`（baseline/allowedFiles），**无 step 进度文件**；
- `sillyspec.db` 的 `steps` 表列是 `stage_id`→指向 `stages` 表，`stages` 表按 **change_id** 组织（正式变更流程），**不含独立 quick 会话**。
- 因此 `sillyspec run quick`（短进程）每次都重新推算/生成会话，`--done` 的「完成」标记写不进任何持久存储，下一次 run 读不到 → 永远漂移。这是短进程 + 非 TTY fallback 模式下的根本性缺陷，与带不带 `--change` 无关。

### 当前结论（绕过）
quick 会话 step 标记在当前版本**无法可靠推进到 3/3**。实质交付以以下三件为准，不强求 CLI 会话「完成」：
1. `QUICKLOG-<user>.md` 已记录 ql-ID + 状态「已完成」+ 根因/方案/结果；
2. 相关代码 + 测试已通过（pytest/ruff/mypy）；
3. 改动已 `git add` 暂存，交由统一提交。

`.sillyspec/.runtime/quick-sessions/` 下会残留多个孤儿会话目录（每次失败 run 生成一个），不影响代码与文档，可定期清理。
