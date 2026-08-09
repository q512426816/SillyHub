---
author: qinyi
created_at: 2026-08-09 05:00:00
status: active
---

# archive 阶段物理归档与进度 DB 跟踪脱钩（无对账/自愈）

## 现象
change `2026-08-08-change-center-on-demand` 已**物理归档完成**：
- 目录已移到 `.sillyspec/changes/archive/2026-08-08-change-center-on-demand/`（26 文件齐），
  active 路径 `.sillyspec/changes/2026-08-08-change-center-on-demand/` 已不存在；
- 已 git commit（`db5d0ed3`，含 verify-result.md PASS WITH NOTES + module-impact.md）；
- 不在 active changes 列表（`ls changes/ | grep -v archive` 看不到）。

但 SillySpec 进度 DB 仍显示 archive 阶段 **0/5 未完成**：
- `sillyspec run archive --status` →「Step 1: 任务完成度检查 ← 当前」，5 步全 ⬜；
- 无 `current-archive-run-id-<change>` marker（对比 execute/brainstorm/plan 都有各自 run-id marker）；
- `.runtime/workflow-runs/` 下有一条 `20260808202349-archive-impact-multi-agent-platform-fail.json`（status=fail，但 runId/error/startedAt 等字段全 null，记录不完整，无法定位失败根因）。

## 根因（可确定部分）
archive 阶段的「extract-module-impact」步骤产出的 archive-impact 工作流 run 标记为 fail。
之后目录被（手动或部分流程）移到 archive/ 并 commit，但 archive 阶段的 `--done --confirm`
收尾从未正式跑完，导致进度 DB 与物理状态脱钩。

## 影响 / 绕过
- **不影响交付**：物理归档 + commit 是 archive 的实质目的，已达成；active 列表也不再列此 change。
- **进度 DB 显示 archive 0/5 纯属外观**：`sillyspec status` / `progress show` 会显示此 change 卡在 archive 阶段，
  但实际已归档。
- **无法用 archive CLI 补完跟踪**：source 目录已移走，重跑 `archive --done --confirm`（步骤 4 会 move
  `changes/<名>/ → changes/archive/<名>/`）找不到 source，会报错或行为未定义。

## 建议（工具修复）
- archive `--confirm` 移动目录前/后做**幂等校验**：若目标已在 `changes/archive/`，判定为已归档，
  直接把进度 DB 的 archive 阶段标记完成（自愈），而非要求 source 存在。
- 或提供 `sillyspec archive reconcile <change>` 子命令，对账物理状态（目录在 archive/ + verify-result 存在）
  → 回填进度 DB。
- archive-impact workflow run 失败时，应写全 errorMessage/stack，便于定位（当前 fail 记录字段全 null）。

## 关联
- 本次 change：`2026-08-08-change-center-on-demand`（commit `db5d0ed3`，分支 `feat/change-center-on-demand-form-a`）。
- 类似的「物理状态 vs 进度 DB 脱钩」也见 [[execute-stage-review-gate-null-path]]（marker 缺失致错误路径），
  均属 SillySpec 运行时状态与文件系统状态缺少对账。
