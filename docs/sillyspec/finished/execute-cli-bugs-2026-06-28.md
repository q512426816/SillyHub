---
author: qinyi
created_at: 2026-06-28 04:24:00
---

# sillyspec CLI execute 阶段 bug 记录（2026-06-28）

变更 `2026-06-28-daemon-client-spec-sync-strategy` 执行过程中发现 sillyspec CLI（npm 全局版，node v24.15.0）的 execute 阶段阻塞性 bug。

## bug-1：`sillyspec worktree meta` 子命令不存在

- **触发**：execute step 3（确认 worktree 路径）prompt 要求运行 `sillyspec worktree meta 2026-06-28-daemon-client-spec-sync-strategy`
- **报错**：`❌ 未知子命令: worktree meta`
- **实际命令**：`sillyspec worktree --help` 显示有效子命令为 `create / apply / assess / list / cleanup / doctor`，无 `meta`
- **绕过**：直接读文件 `.sillyspec/.runtime/worktrees/<change>/meta.json`（含 worktreePath/branch/mode/baseBranch）
- **建议修复**：要么实现 `worktree meta` 子命令，要么 step 3 prompt 改为直接读 meta.json

## bug-2：execute step 5+ outputStep `effectiveChange is not defined`

- **触发**：execute step 4 `--done` 后进入 step 5（Wave 1 执行），CLI 输出 step prompt 时崩溃
- **报错**：`ReferenceError: effectiveChange is not defined` at `run.js:828`（`const runIdFile = join(execSpecBase, '.runtime', \`current-execute-run-id-${effectiveChange}\`)`）
- **影响**：execute 的 Wave 执行 step（step 5+）prompt 无法输出，无法用 `sillyspec run execute --done` 正常推进 Wave 实现
- **根因推测**：`outputStep` 函数（run.js:645/828）引用 `effectiveChange` 变量，但在该执行路径（execute stage）未定义该变量（其他 stage 可能定义）
- **绕过**：execute step 4 进度已落库；直接在 worktree 按 plan.md 实现 task 代码，跳过 CLI step 引导；代码 + 测试完成后按 `sillyspec-execute-worktree-overlay-pitfall` 经验收口

## 影响

execute 阶段的 CLI 引导（step prompt）在 worktree 确认后断裂，但不阻塞实际代码实现（worktree 可读可写，plan.md 已有完整 task 清单）。建议 sillyspec CLI 修复 `outputStep` 中 `effectiveChange` 作用域 + 补 `worktree meta` 子命令。
