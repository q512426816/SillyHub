---
author: qinyi
created_at: 2026-08-10 07:20:00
stage: verify
severity: high
status: done
resolved_at: 2026-08-10
fixed_in: sillyspec@adf69d3
fixed_by: quick ql-20260810-002-7b3a
---

# verify：worktree baseline checkpoint 模式下 module 检测 baseHash 用错（误测无关模块）

> 变更 `2026-08-09-security-ppm-ownership` verify 阶段实测踩到（2026-08-10）。

## 症状

worktree 隔离 + baseline checkpoint 模式下（meta.json 同时有 `baseHash`=pre-baseline 与 `baselineCommit`/`actualBaseHash`=post-baseline），`sillyspec run verify --done` 的测试对账 module 检测把 **baseline overlay 同步的跨模块文件**全算进 verify diff → 命中无关模块 → 跑它们的 test → 慢/超时/失败 → verify 完成被阻断。

本次 PPM-only 变更（只动 `backend/app/modules/ppm/`）竟检测出 5 个模块（ppm + frontend + sillyhub-daemon + llm_provider + daemon），其中 daemon 模块 test 撞 `SILLYSPEC_TEST_TIMEOUT_MS`（10min）失败 → verify gate FAIL。实际 ppm 496 全绿，其余 4 模块是 baseline 同步进 worktree 分支的他人/历史文件。

## 根因

`src/verify-postcheck.js` `resolveVerifyChangedFiles` 用 `git diff --name-only ${meta.baseHash}..HEAD`（worktree gitDir）取 verify 变更集，`baseHash` 取 meta.baseHash。

但 baseline checkpoint 模式下：
- `meta.baseHash` = baseline checkpoint 的**父提交**（pre-baseline，如 d9dfc971）。
- `meta.baselineCommit` / `meta.actualBaseHash` = baseline checkpoint 本身（post-baseline，如 caca0584），= 本 change 真实代码改动起点。

`git diff <baseHash=d9dfc971>..HEAD` 含 baseline checkpoint 那一笔（同步的 52 个跨模块 overlay 文件）+ 本 change 改动 → `pickHitModules` 命中所有 overlay 涉及的模块。

**同源不一致**：`src/task-review.js:694` 已正确用 `meta.baselineCommit || meta.baseHash`，唯独 `verify-postcheck.js` 只用 `meta.baseHash`。

## 实测证据

- meta.json：`baseHash=d9dfc971...` / `baselineCommit=caca0584...` / `actualBaseHash=caca0584...`。
- worktree `git diff --name-only d9dfc971..HEAD`：含 52 个 baseline overlay 文件（daemon/llm_provider/frontend/sillyhub-daemon/deploy）+ 10 个本 change ppm/docs → 5 模块。
- worktree `git diff --name-only caca0584..HEAD`：仅 10 个本 change ppm/docs → 1 模块（ppm）。
- verify-runs/.../test-result.json：`command: "module[ppm\nsillyhub-daemon\ndaemon]"`（实际还跑了 frontend/llm_provider），`status: failed`，`reason: 模块子集测试失败：daemon`（daemon 撞 timeout，非本 change 引入）。

## 影响

- 高：单个模块的小变更 verify 却跑一堆无关模块的 test，慢（frontend 1346 + daemon 大套件 + sillyhub-daemon vitest）、撞 timeout、被无关模块的预存失败/flaky 阻断 → verify 永远过不去 → 无法归档。
- 误判面：任何 baseline 同步过他人跨模块文件的 worktree change 都中招（baseline checkpoint 模式常见）。

## 本地修复（已应用，待上游）

改 `C:\Users\qinyi\IdeaProjects\sillyspec\src\verify-postcheck.js` `resolveVerifyChangedFiles`：diff base 优先 `meta.baselineCommit || meta.actualBaseHash || meta.baseHash`（与 task-review.js:694 对齐）。

修后重跑 `verify --done`：`module[ppm]` 退出码 0（71.4s），verify 7/7 通过。

⚠️ 修复在本地 sillyspec 工具仓库（IdeaProjects/sillyspec，sillyspec npm 包 symlink 指向它，直接跑 src 无 build）；上游未发布，`git pull` 更新工具可能覆盖，需重新应用或提 PR。

## 验证规避（修复前的临时绕过，不再需要）

- 把工作区并发 dirty 文件清掉（让 fallback `git diff --name-only HEAD` 只见本 change）——无效：worktree 模式走的是 worktree gitDir 的 baseHash..HEAD，不看主仓 dirty。
- 临时改 meta.json `baseHash`=`baselineCommit`——能解但语义偏（baseHash 应是分支点）。
- **正确做法即上述源码修复。**

## 建议

1. 上游 sillyspec 修 `verify-postcheck.js` resolveVerifyChangedFiles 用 `baselineCommit || actualBaseHash || baseHash`（已本地改）。
2. 顺带审查其它读 `meta.baseHash` 的处（stage-contract/checkExecuteCodeEvidence 等）是否同样应优先 baselineCommit。
