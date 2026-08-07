---
author: qinyi
created_at: 2026-08-07 17:05:01
---

# 坑：worktree apply 排除 `.sillyspec/` 文件，scan 文档/模块文档等交付物被静默漏掉

## 现象

`sillyspec worktree apply <变更名>` 只应用**产品代码**文件，所有 `.sillyspec/` 开头的文件（scan 文档、模块文档、spec 变更文档）被**静默跳过**。

实测（2026-08-06-scan-doc-drift-gate archive）：
- 该变更 task-01 的核心交付物是 8 篇 scan 文档刷新（`.sillyspec/docs/SillyHub/scan/*.md`，source_commit 6e78b29a→5a00fc7e）。
- `worktree apply --check-only` 只报 **3 个文件**（scan-drift.yml + 2 个 scripts），实际变更应 11 个（含 8 篇 scan 文档）。
- apply 后 CLI **自动清理 worktree**（目录+分支都删），scan 文档刷新内容留在 **dangling commit**（e9880d77）里，主仓库仍是旧版本。

## 根因

`src/change-list.js` `_parseFileListDetailed` 第 222 行：`if (isPlaceholder(filePath) || filePath.startsWith('.sillyspec/')) continue` —— design.md 文件变更清单里所有 `.sillyspec/` 开头的路径被 parseFileChangeList 跳过，进不了 apply 的 allowSet。这是**有意设计**（apply 只管产品代码），但对「scan 文档刷新」这类 `.sillyspec/` 交付物是漏网。

## 影响

依赖 `.sillyspec/` 下交付物的变更（scan 文档刷新、模块文档、配置）apply 后主仓库缺失。对本项目特别危险：drift 检测门（scan-drift-check.py）上线后，若 scan 文档 source_commit 刷新没回 main，**门立即自报漂移**（D-003 失效）。

## 绕行（本次已验证）

1. apply 后（worktree 已清理），从 dangling commit 手动取回：
   ```
   git cat-file -t <dangling-commit>   # 确认可达（如 e9880d77）
   git checkout <dangling-commit> -- .sillyspec/docs/SillyHub/scan/
   ```
2. 或 apply 前先用 `--check-only` 核对文件数（若明显少于预期 = 有 `.sillyspec/` 交付物被漏）。
3. apply 输出末尾有提示「.sillyspec/ 下的文件按规则不自动 apply，如需请手动从 worktree 分支或 dangling commit 取」，但 `--check-only` 不提示。

## 建议

- 工具应区分「产品代码」与「spec/scan 文档」交付物：`.sillyspec/` 文件要么自动 apply（文档变更也是合法交付物），要么在 check-only / apply 报告里**显式列出被排除的文件清单**，避免 agent 误以为 apply 完整。
- 至少：`--check-only` 报告应包含「被排除的 .sillyspec/ 文件 N 个」提示。
