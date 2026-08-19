---
author: qinyi
created_at: 2026-08-19 09:35:00
status: fixed
fixed_at: 2026-08-19 09:38:00
fix_commit: 9edbf2d（sillyspec 仓）
---

# platform resolve --keep-local 用旧冲突文件 ts 回退已推进的 base_ts

**发现日期**：2026-08-19（base-ts-silent-conflict 存量恢复时实证）
**状态**：已修复（sillyspec 仓 9edbf2d，ql-20260819-002-8f16）

## 现象

`2026-08-18-workspace-file-browser` 恢复时：本地 DB 的 `last_synced_platform_ts` 已是 09:07:56.232（早前成功推送回填），但残留冲突文件（07:32 自竞态时落盘）里存的 `platform_last_pushed_at` 是 07:32:12.432。执行 `platform resolve <change> --keep-local` 后，base_ts 被**回退**到 07:32:12.432——紧接着的 sync 立即撞 409 又落一个新冲突文件（冲突横幅正确拦截并给出指引，二轮 resolve+sync 才收敛）。

## 根因

`resolve` keep-local 分支（sync.js）无条件 `UPDATE changes SET last_synced_platform_ts = <冲突文件的 platform_last_pushed_at>`，没有与 DB 现值比较——语义应是「base_ts 只推进不回退」（monotonic），冲突文件是历史快照，其 ts 可能早于 DB 已回填的值。

## 修复（已落地）

`MAX(?, COALESCE(last_synced_platform_ts, ?))` 单调取大：
- MAX 防「旧冲突文件 ts 回退已推进值」；
- COALESCE 防 SQLite 标量 `MAX(x, NULL) 恒 NULL`（首同步前 base_ts NULL 应直取平台 ts）。

测试：sync-conflict-statemachine F（06:00 不被 05:00 回退）/ G（NULL 直取平台 ts）两场景。

## 关联

- 上游坑：2026-08-19-platform-sync-base-ts-silent-conflict（已修已归档 finished/）
- 同日修复：b557253（冲突横幅/pull 自竞态防御/X-SillySpec-User 兜底）
