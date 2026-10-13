# 跨仓 worktree 幽灵元数据（fire-equipment 2026-10-10/12 实证）——归档链跨仓盲区 + 清理链静默吞错

> 记录时间：2026-10-12 · 来源：会话导出包 d1372dc9（会话导出_完整信息_20261012_053255.zip）+ sillyspec v3.32.6 源码核查
> 状态：活跃坑（现场已手工恢复；工具侧三个结构性缺口待修复）

## 现象

10-12 上午，消防项目前端仓切分支报错：

```
'sillyspec/2026-10-10-fire-equipment' is already used by worktree at
'/root/.sillyhub/daemon/specs/4e9eb05b-.../.runtime/worktrees/2026-10-10-fire-equipment--subgrid'
```

现场还原（daemon 机 sevishes/centos8）：

- worktree 实体目录已在 10-10 16:59 被清空（`.runtime/worktrees/` 空目录留存，`apply-pathspec-*.txt` mtime 同为 16:59）；
- 但 `sub-grid-security`、`spdemo` 两仓的 `.git/worktrees/<name>/` 注册元数据残留（gitdir 指向已消失路径）——分支被「幽灵 worktree」占用，无法 checkout；
- 后端 `urgent` 仓无残留（同一批三个 worktree，只有它清干净了）；
- 10-10 开发会话日志（a0a5cc81.jsonl）里无任何手工 `rm -rf` / `worktree remove` / `prune` 命令——删除来自 CLI 内部进程；
- 手工 `git worktree prune -v` 即愈（清掉 "gitdir file points to non-existent location" 两条），代码零丢失。

## 代码核查结论（sillyspec v3.32.6，含 10-10 事故时点版本 0de332da）

导出会话第 5 轮的结论「SillySpec CLI 归档收口只删目录不清元数据」**与代码不符**，需要纠正：

1. **归档收口根本不删跨仓 worktree**。`archiveWorktreeCleanup`（src/run/complete-handlers.js:310，正常归档/自愈归档/change-delete 三处调用）只处理**主仓** worktree（`WorktreeManager.cleanup`）；跨仓 worktree 既不删目录也不 prune——归档链对跨仓是**全盲区**，不是「删了不 prune」。
2. **归档 runtime 回收不碰 worktrees**。`pruneArchivedChangeRuntime`（同文件 :184）只收 apply-pathspec / prompt-inject / friction-tally / execute-runs / stage-reviews / verify-runs。
3. **跨仓唯一删除方 `cleanupCrossWorktrees`（src/worktree-cross.js:400）全路径带 prune**：目录在 → `git worktree remove --force`（连元数据一起删）；remove 失败 → rmSync + `git worktree prune`（:435）；目录已不在 → 直接 prune（:409）。09-12 版本（事故时点代码）即已如此。

## 真正的结构性缺口（代码可证）

无论当时是哪条路径删的目录，幽灵元数据能存活至今，靠的是三个工具缺陷：

- **缺口① 清理链静默吞错、无事后验证**。`cleanupCrossWorktrees` 的 prune 用 `try { gitQuiet(...) } catch {}` 包裹（:260/:409 直接吞；:435 仅记 residual 打 warning）。prune 失败后不做 `git worktree list --porcelain` 复核——对比 gate-snapshot 清理链已有「双清契约」（run/gate-snapshot.js:126 只认 `git worktree list` 的确认答复），跨仓清理链没有对齐。跨盘挂载（/mnt/e 9p/drvfs）上 git 锁竞态会让 prune 静默失败；`git worktree prune` 对 **locked 条目也会静默跳过**——两者都产出零报错的幽灵。
- **缺口② 归档链跨仓盲区**。跨仓清理只挂在 apply 空清理/apply 成功/execute reset/手工 `worktree cleanup` 四个时机；归档作为最后一道收口不补刀。apply 侧任何一次 partial（prune 失败只打 warning 继续走），幽灵就永久滞留——没有第二道网。
- **缺口③ doctor 跨仓盲区**。doctor 的幽灵/孤儿扫描只看主仓 meta 目录；跨仓仓 `.git/worktrees/` 里的失效注册没有任何自愈路径能扫到。

## 根因判定与一步验证法

「谁在 16:59 删了目录、为何 prune 没生效」两个存活假设（从本机无法定案）：

- 假设 A：**apply 时跨仓清理走了，`git worktree remove` 在 /mnt/e 跨盘仓上失败，兜底 prune 也静默失败**（缺口①+跨盘 git 锁竞态）——与「urgent 仓干净（remove 成功）、两个前端仓残留」的分叉吻合；
- 假设 B：**daemon 机当时装的是更老版本 sillyspec**（跨仓清理无 prune 逻辑）——本仓 09-12 才有 prune 版，但机上安装版本无法回溯。

机上一步可定案：在 daemon 机 grep 10-10 主会话日志（`/root/.claude/projects/-mnt-e-crrcdt-sillyWork-2026-------/a0a5cc81-*.jsonl`）：

```bash
grep -o '清理 partial[^"]*\|prune 失败[^"]*\|已清理跨仓[^"]*' a0a5cc81-*.jsonl | head
```

命中「清理 partial / prune 失败」→ 假设 A；日志里有 apply 输出但无任何跨仓清理行 → 假设 B。

## 期望修复（sillyspec 工具侧）

1. `cleanupCrossWorktrees` 对齐 gate-snapshot 双清契约：清理后 `git worktree list --porcelain` 断言注册已消失；prune 失败/断言不过 → 结果置 partial + 持久留痕（QUICKLOG/doctor issue），不静默。
2. `archiveWorktreeCleanup` 补跨仓兜底：主仓清理后调用 `cleanupCrossWorktrees`（force 语义与主仓孤儿清理一致——幂等、目录不在即 prune 注册），归档成为跨仓幽灵的最后一道网。
3. doctor 增跨仓注册扫描：对 local.yaml repos 注册表各仓跑 `git worktree list` + `--porcelain` 对照 `.runtime/worktrees/` 实体与注册表，失效注册列 issue，`--fix` 执行 prune（现成能力：ensureCrossWorktrees 重建分支已有同款 prune，:260）。
4. （低优）`git worktree remove` 失败时检测 locked 条目并提示 `git worktree unlock`（prune 对 locked 静默跳过是隐晦失败面）。

## 用户侧缓解（已验证）

- 报 `already used by worktree` 且报错路径已不存在 → 到**分支所属仓**（不是 daemon 目录）跑 `git worktree prune -v`，即愈，无数据风险（git 只清指向不存在位置的注册）。
- `sillyspec/<change>` 分支是有意保留的 review 锚点，prune 不动分支；确认无需回溯后 `git branch -D` 清理。

## 处置记录（2026-10-13）

**三缺口全部已修**（并行会话 `2026-10-12-cross-worktree-toolchain` 系列落地，本日逐项
核实验证）：

1. **缺口①（清理链双清契约）✅** `59a87eeb`：`cleanupCrossWorktrees` remove/prune 后以
   `git worktree list` 复核注册已消失，复核不过 → partial + residual（locked 条目附
   unlock 指引不自动解除）；顺带修正未交付检测把自家 meta.json 误计为交付致 force=false
   恒误报的既有 bug。
2. **缺口②（归档链跨仓兜底）✅** 同提交：`archiveWorktreeCleanup` 主仓清理后追加跨仓
   兜底（force=false 幂等 fail-open，有未 apply 交付保留并警告）。
3. **缺口③（doctor 跨仓扫描）✅** `e70468c4`：`detectCrossWorktreeHealth` 维度——
   local.yaml repos 各仓 worktree list 对照实体目录，失效注册列 finding + WARNING；
   `doctor --prune-cross-worktrees`（默认 dry-run，--confirm 执行 + 复扫断言）。

**测试**：`cross-worktree-ghost-registration.test.mjs` 8/8 本日复跑绿。坑内「一步定案法」
（grep daemon 机会话日志判假设 A/B）随三缺口修复失去必要性——根因处置已不依赖当时路径
判定。用户侧缓解（prune -v 即愈）继续有效作兜底口径。归档。
