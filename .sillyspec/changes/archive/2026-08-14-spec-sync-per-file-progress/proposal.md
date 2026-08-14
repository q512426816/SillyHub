---
author: qinyi
created_at: 2026-08-14T02:50:00
change: 2026-08-14-spec-sync-per-file-progress
---

# 提案：spec-sync 逐文件级进度（升级 P1 FR-06）

## 一句话

把「同步到服务器」进度从当前 0→total 两段式升级为逐文件真实跳动（1/35...35/35），让前端 Progress 条可见逐文件推进。

## 背景与动机

P1（2026-08-13-spec-sync-visibility）实现了同步进度展示，但 design D-001 取「阶段级」。实测发现 files_processed 只有 0→total 两个上报点，中间无推进——前端 Progress 条实际只看到 0/N 或瞬间 done。根因：后端 apply 在 daemon 单次 HTTP 内同步执行，daemon 无法在 apply 期间逐文件回写 processed。

## 方案

方案 A（task_id 透传 + 后端 apply 循环内独立 session 回写）：daemon 在 sync HTTP 头透传 X-Change-Write-Id，后端 apply_sync/apply_ops 循环内每处理一个文件用独立 session UPDATE files_processed+=1（不动主事务）。processed 真逐文件递增。初版方案C（分批发ops）经 Design Grill 否决（与 apply_ops 乐观锁 base_version 不兼容）。

## 不在范围内

- 不分批发 ops（方案C否决，D-003）。
- 不改 progress 端点/D-004/BL-3/前端（复用 P1）。
- 不保证 processed 与主事务强一致（取 eventual，终态 complete 覆盖）。

## 关键决策

D-001@V2 逐文件级（推翻 P1 阶级级）/ D-002@V1 N次UPDATE性能 / D-003@V1 方案C否决。
