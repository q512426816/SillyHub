---
author: qinyi
created_at: 2026-09-11 14:35:00
---

# pre-commit「auto-fix 与 stash 冲突」会静默吞掉整次 git commit

> 状态：**已修复**（2026-09-11 ql-20260911-006 落 check-only 方案，见文末「修复落地」；原文保留作坑史）——修复验证后应迁 `finished/`。
> 注：坑主是 pre-commit 框架行为（非 sillyspec CLI），但本仓所有提交都过这套 hook，按工具坑同规格记录。

## 现象

`git commit` 输出里出现：

```
Found 4 errors (4 fixed, 0 remaining).
[WARNING] Stashed changes conflicted with hook auto-fixes... Rolling back fixes...
[INFO] Restored changes from C:\Users\qinyi\.cache\pre-commit\patch...patch
```

之后命令退出（exit code 可能仍为 0），**`git log` 无新提交**——提交被静默吞掉。暂存区（staged）原样保留。

## 触发条件（2026-09-11 两次实证归纳）

1. 工作树存在**未暂存改动**（哪怕只是 hook 自己上一轮 auto-fix 产生的）；
2. pre-commit 的自动修复 hook（ruff format / trailing-whitespace 等）对**已暂存文件**做出修改；
3. pre-commit 结束时把暂存的 stash 弹回工作树 → 与 hook 的修复冲突 → 回滚修复并放弃提交。

典型序列：第一次 commit → hook auto-fix 改文件 → 吞提交但修复留在工作树（文件呈 `AM`/`MM` 态）→ 第二次 commit 又因同一冲突再吞（循环）。

## 实测修正（2026-09-11 临时分支复现）

pre-commit 4.6.1 下该路径 **exit code = 1（git 层面是响亮失败，非静默成功）**——
"吞提交"的感知帮凶是**管道掩码退出码**（`git commit … | tail -1` 管道出口恒 0，
后续 `&& git push` 照跑 + 输出 `Everything up-to-date`，与"我以为已提交"的预期
互相印证）。真实危害=退出码被掩码 + 回滚后 AM 态重试循环（不 `git add` hook 的
修复就永远重试失败）。

## 实际危害

- **提交静默丢失，工作树文件还在**：代码照样能被本地构建/部署用到（镜像从工作树打包），形成「已部署但 git 里没有」的隐性分叉——2026-09-11 实证：alembic 双 head 合并迁移 `5e295549e20f` 只存在于工作树与已部署镜像、远端仓库缺失，直到次日用例行清理提交才补上；期间任何人从远端拉代码重部署都会复现双 head 崩溃。
- 吞提交后 push 输出 `Everything up-to-date`，与「我以为已提交」的预期一致，极具迷惑性。

## 绕过

- commit 后**必须**核对：`git log --oneline -1` 是否真有新提交；输出里 grep `WARNING.*conflicted` 即为吞提交信号。
- 命中循环时：`git add` 把 hook 的修复一并暂存（消除「未暂存改动」条件）再 commit。
- 高风险提交（迁移/部署前置）前后 `git status --short` 确认暂存面与 `git log` 确认落库。

## 修复落地（2026-09-11 ql-20260911-006）

- **方案**：仓配层 check-only——`backend/.pre-commit-config.yaml` 两个 hook 改
  `ruff format --check` / `ruff check`（去掉 `--fix`）。hook 不再修改文件 →
  stash↔auto-fix 冲突类从根上消失；格式问题以 `Would reformat` 响亮失败。
  格式化改为提交前手动：`uv run ruff format && uv run ruff check --fix` 后再 add。
- **实测**（临时分支 AM 场景三段验证）：改前=Failed+回滚循环；改后失败态=响亮
  `Would reformat` exit 1 无回滚；格式化+add 后=正常提交 exit 0。
- **否决项**：`--no-stash` 不被 `hook-impl` 子命令接受（仅 `pre-commit run` 参数），
  编辑生成 hook 脚本又会被 `pre-commit install` 覆盖——不可持久，弃。
- **习惯项（对 agent 尤其）**：`git commit` 不接管道掩码退出码（或用
  `set -o pipefail`）；提交后核对 `git log -1` 真有新提交。

## 处置记录（2026-09-12 定时收口，验证归档）

- check-only 方案已入库实证：commit d1d472795（backend/.pre-commit-config.yaml 两 hook 去 --fix，三段实测记录随坑文档进提交）；本仓 pre-push docs gate 亦在同批恢复。
- 习惯项（不接管道掩码退出码 / 提交后核对 git log -1）与 CLAUDE.md 规则 12 的核实要求互补，继续有效。归档。
