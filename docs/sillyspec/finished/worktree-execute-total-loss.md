# 活跃坑：sillyspec worktree execute 可标"全 Wave 完成"但实现代码全丢

> 状态：**已解决**（sillyspec commit `083a18e`，2026-08-13）· 发现于 2026-08-10 · change `2026-08-09-security-backend-guardrails`
>
> **修复**：①`worktree.js cleanup()` fail-closed 保护——未落主仓交付变更拒绝清理（`hasUnappliesChanges` 门控，需 `--force` 绕过），apply 后/reset 显式 force（D-006）；②execute 完成阶段级核验 `findMissingDeliverables` + 聚合 review.changedFiles，缺失 warn 非阻断（防空跑谎报）；③index.js blocked 分支 + doctor 提示；④补 worktree-cleanup-guard 23 + execute-loss-guard 20 断言测试。全量 npm test 187 文件 0 失败 + lint 271 通过。遗留 2 P2（平台 runtimeRoot 透传 / 并发跨 run 聚合）已登记。**注意**：execute --done 批量完成路径 cleanup 仍可能删分支 ref（本变更执行时复现，已 fsck 恢复，见 memory execute-batch-cleanup-deletes-branch-recovery）——为已知盲区，后续单独修。

## 现象

`sillyspec progress show --change <X>` 显示「⚡ 波次执行」**全部 ✅**（含子步骤摘要"测试运行全绿""代码审查通过""对照设计检查全通过"等详细文案），但实际**实现代码完全丢失**：

- worktree 目录 `.sillyspec/.runtime/worktrees/<X>/` **被清**（`git worktree list` 仍注册，磁盘无目录）；
- worktree 分支 `sillyspec/<X>` **只有 1 个 baseline checkpoint commit**（`git log main..sillyspec/<X>` 仅一行）；
- 目标新文件 `git cat-file -e sillyspec/<X>:<path>` → **does not exist**；
- `git fsck --lost-found` 的 dangling commit 里**找不到**含目标代码的提交（全是其它 stash/WIP）。

即 sillyspec.db 记"done"，磁盘 + git 里没有任何代码。子代理在 worktree 工作区"实现"了、甚至跑通测试写了 review，但**从未 commit 到 worktree 分支**，worktree 目录随后被清，内容蒸发。

## 复现 / 验证手法

execute progress 标完成后，**绝不轻信**，核验三连：

```bash
# 1. 分支确有实现 commit（应 >1 行，非仅 baseline）
git log --oneline main..sillyspec/<change>

# 2. 目标新文件在分支 tree 里
git cat-file -e sillyspec/<change>:<新文件路径> && echo EXISTS

# 3. dangling commit 里翻目标代码（兜底）
git fsck --no-reflogs --lost-found | grep "dangling commit"
```

任一不满足 = 实现丢失。

## 影响

- 完全静默：progress 全绿，无任何告警，若不主动核验会以为已交付。
- CONCERNS/文档可能据"已完成"误标 ✅（本 change 的 CONCERNS 三处 SSRF 曾被 a8447a19 误标已修复，止血见 c2479fb4）。
- review.json（Stage/Task Review Gate）引用的 base/head 是丢失的 worktree commit，后续 verify 在不一致的 execute 产物上跑，可能假失败或需手 fixup。

## 临时绕过（当前采用）

worktree 代码丢了就**不要救 worktree**（目录已没、`worktree apply` 无源）。直接按 design.md（grill 过的权威规范）在**主仓重实现**：

1. 按 design §5/§7 在主仓写代码 + 测试；
2. backend 全量 `uv run pytest -n auto`（3791 passed）作权威验收信号（比 sillyspec gate verify 子命令可靠，gate verify 本身见 `finished/` 相关 issue）；
3. commit message 注明"原 worktree execute 代码全丢，按 design 主仓重实现"；
4. CONCERNS 据真实代码状态标 ✅。

## 期望工具修复（上游）

- execute 每个 task/子代理完成后，CLI 应**核验 worktree 分支确有新 commit 且 tree 含目标文件**，否则标该 task 失败而非 ✅。
- worktree 清理（cleanup）前应校验"分支已含工作区全部改动"，未 commit 的改动拒绝清理或自动 commit 暂存。
- progress 摘要的"测试运行全绿"应绑定真实 commit sha + 文件清单，防子代理空跑谎报。
