---
name: sillyspec:status
description: 状态查询：进度/变更清单/断点恢复入口
---
# 何时用

任何时刻查「我在哪、下一步做什么」——多变更并行时先看再动。

# 生命周期速查

```bash
export SILLYSPEC_SESSION_ID=<agent名+任务名>   # 每条命令都带（shell 状态不持久；多会话并行的所有权判定依赖它）
sillyspec progress show [--change <名>] [--all] [--json]
sillyspec status
# 有信号变更（冲突/滞留/疑似完成）保持详情渲染；--all 展开全部
# 在隔离 worktree 内跑时（守卫默认拒绝，需双 flag）：
#   sillyspec <cmd> --allow-worktree-cwd --spec-dir "<worktree>/.sillyspec"
```

# 防坑清单

- 多会话并行：变更各自 --change 隔离，永不 reset 他人变更。
- 中途停下不靠额外命令存进度——上次 --done 已落盘。

# 边界声明

本卡不含步骤内容——每步的具体指令由 `sillyspec run status` 按当前状态实时渲染（含门禁、审查档位、产物契约）。本卡只管启动与防坑。
<!-- sillyspec-card: v3.32.0 sha256=763c1e45e00ea7aa31420694ee286b74fa030c2611274bcf2bd4f476a2cd9311 -->
