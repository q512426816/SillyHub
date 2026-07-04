---
author: qinyi
created_at: 2026-07-01 11:48:00
type: sillyspec-tool-bug
---

# sillyspec CLI 运行时清理逻辑摧毁 worktree meta（平台模式 worktree 不可用）

## 现象
平台模式（源码目录 `.sillyspec/` 存在）下，`sillyspec run execute` 创建 worktree 成功（meta 显示 `depsStatus=installed`），但下一次任意 `sillyspec run execute --done` 报：
```
❌ 拒绝 --done：依赖未就绪（depsStatus=unknown）
```
反复重创 worktree 无解。

## 根因
`src/run.js:1294-1299`（同样逻辑在 `src/init.js:130-137`）：每次 `sillyspec run` 命令启动时，检测到源码目录的 `.sillyspec/` 含真实资产（changes/projects/sillyspec.db），执行"仅清理运行时残留"：
```js
for (const residue of ['.runtime', 'local.yaml', 'codebase']) {
  const p = join(legacyDir, residue);
  if (existsSync(p)) { try { rmSync(p, { recursive: true, force: true }) } catch {} }
}
```
该清理**删除整个 `.sillyspec/.runtime/`**，而 worktree 的 meta、worktrees 目录正存在此处。后果：
1. `execute` 创建 worktree → 写 `.runtime/worktrees/<change>/` + meta
2. 进程结束
3. 下次 `execute --done` 启动 → run.js:1296 删 `.runtime/` → worktree meta 丢失
4. `enforceDepsGate`（run.js:2207）读不到 meta → `depsStatus=unknown` → 阻断 `--done`

worktree 无法跨命令存活，`execute` 流程在平台模式彻底卡死。

## 附加 bug：worktree doctor 误判 orphan
`sillyspec worktree doctor --fix` 会把**实际存在**的 worktree 判为 orphan 并 prune（doctor 的目录存在性检查与 git worktree list 状态不一致），导致 worktree 目录被删、分支残留为 prunable。修复需手动 `git worktree prune` + `git branch -D`。

## 影响范围
- 平台模式 + 源码目录 `.sillyspec/` 共存的环境（本项目正是此场景）下，`execute` 阶段的 worktree 隔离完全不可用。
- `--no-worktree` 可绕过，但失去隔离（migration 污染本地 PG 风险，见记忆 worktree-migration-pollutes-deploy）。

## 建议修复（待工具作者）
- `run.js:1294` / `init.js:130` 的清理逻辑应**排除 `.runtime/worktrees/` 与 worktree meta**，只清 `.runtime/` 下的临时缓存（scan-runs / history / workflow-runs 等），保留 worktree 状态。
- 或：平台模式下 worktree meta 应写到 specDir（daemon specDir）而非源码 `.sillyspec/.runtime/`，避免被源码清理逻辑误删。
- doctor 的 orphan 判定应基于 `git worktree list` 而非自检目录存在性。

## 本项目规避
本变更（2026-07-01-changes-align-sillyspec）execute 采用 `--no-worktree` 主仓库直接改 + commit；migration 文件写入但不 apply 到运行中的本地 PG（由 docker 重启时 alembic upgrade head 在 merge 后统一 apply），规避 worktree-migration-pollutes-deploy 风险。
