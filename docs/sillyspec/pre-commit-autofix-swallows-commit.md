---
author: qinyi
created_at: 2026-09-11 14:35:00
---

# pre-commit「auto-fix 与 stash 冲突」会静默吞掉整次 git commit

> 状态：活跃（2026-09-11 两连实证：alembic 合并迁移提交、session-task-panel 残留清理提交，均被吞）。
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

## 实际危害

- **提交静默丢失，工作树文件还在**：代码照样能被本地构建/部署用到（镜像从工作树打包），形成「已部署但 git 里没有」的隐性分叉——2026-09-11 实证：alembic 双 head 合并迁移 `5e295549e20f` 只存在于工作树与已部署镜像、远端仓库缺失，直到次日用例行清理提交才补上；期间任何人从远端拉代码重部署都会复现双 head 崩溃。
- 吞提交后 push 输出 `Everything up-to-date`，与「我以为已提交」的预期一致，极具迷惑性。

## 绕过

- commit 后**必须**核对：`git log --oneline -1` 是否真有新提交；输出里 grep `WARNING.*conflicted` 即为吞提交信号。
- 命中循环时：`git add` 把 hook 的修复一并暂存（消除「未暂存改动」条件）再 commit。
- 高风险提交（迁移/部署前置）前后 `git status --short` 确认暂存面与 `git log` 确认落库。

## 待工具修复

- pre-commit 层：`--no-stash`（跳过 stash，要求干净工作树）或升级新版（已知对 stash-restore 冲突处理有改进）；至少把「rolling back fixes + 提交未创建」以非零退出码显式失败，而非静默成功。
- 仓配层（可选）：`pre-commit run` 换 `pre-commit run --hook-stage manual` 手动跑修复类 hook、提交钩只留只读检查，auto-fix 类放 `make fmt` 显式执行。
