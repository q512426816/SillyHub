---
name: sillyspec:run-execute
description: execute 执行阶段：按 Wave 逐任务实现（子代理或直做）+ 逐 task review
---
# 何时用

plan 收口后写代码。多 agent 共享仓——开工前重读目标文件最新态。

# 生命周期速查

```bash
export SILLYSPEC_SESSION_ID=<agent名+任务名>   # 每条命令都带（shell 状态不持久；多会话并行的所有权判定依赖它）
sillyspec run execute --change <变更名>
sillyspec run execute --done --change <变更名> --output "<摘要>"
# 逐 task review.json：
sillyspec review write --change <变更名> --task task-NN --spec <verdict> --quality <verdict>
# 在隔离 worktree 内跑时（守卫默认拒绝，需双 flag）：
#   sillyspec <cmd> --allow-worktree-cwd --spec-dir "<worktree>/.sillyspec"
```

# 防坑清单

- 改前重跑读最新态（多 agent 并行，Edit 前文件可能已被他侧改）。
- review 的 changedFiles 必须与本 task 卡 target_files/allowed_paths 相交（完全不相交过不了门）。
- 破坏性 git op 前先备份；禁止跳过 hook。

# 边界声明

本卡不含步骤内容——每步的具体指令由 `sillyspec run execute` 按当前状态实时渲染（含门禁、审查档位、产物契约）。本卡只管启动与防坑。
<!-- sillyspec-card: v3.32.0 sha256=e3cc45943a7975173bc764132457436a25f415937d11cf54b0c704769a9c4221 -->
