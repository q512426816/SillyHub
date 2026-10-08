---
name: sillyspec:run-archive
description: archive 归档阶段：变更产物归档+知识蒸馏+FR/决策入库
---
# 何时用

verify PASS 后归档：目录迁移+distill 知识沉淀+活文档同步。

# 生命周期速查

```bash
export SILLYSPEC_SESSION_ID=<agent名+任务名>   # 每条命令都带（shell 状态不持久；多会话并行的所有权判定依赖它）
sillyspec run archive --change <变更名>
sillyspec run archive --done --change <变更名> --output "<归档摘要>"
# 在隔离 worktree 内跑时（守卫默认拒绝，需双 flag）：
#   sillyspec <cmd> --allow-worktree-cwd --spec-dir "<worktree>/.sillyspec"
```

# 防坑清单

- 归档是移动不是复制——活跃目录会被迁走，勿在归档中途手改。
- 跨仓同步检查（multi-repo 场景）在归档收口统一出。

# 边界声明

本卡不含步骤内容——每步的具体指令由 `sillyspec run archive` 按当前状态实时渲染（含门禁、审查档位、产物契约）。本卡只管启动与防坑。
<!-- sillyspec-card: v3.32.0 sha256=e4feb6ae5dda8582149174a9f6b837a20545740d8bb152272dc9a52aa1228419 -->
