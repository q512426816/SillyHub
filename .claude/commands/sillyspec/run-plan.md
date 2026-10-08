---
name: sillyspec:run-plan
description: plan 计划阶段：复杂度分类→分级计划→计划审查→TaskCard→Wave 校验
---
# 何时用

brainstorm 收口后拆任务排 Wave（plan_level=light 走轻计划，仍需 Wave 结构与任务卡）。

# 生命周期速查

```bash
export SILLYSPEC_SESSION_ID=<agent名+任务名>   # 每条命令都带（shell 状态不持久；多会话并行的所有权判定依赖它）
sillyspec run plan --change <变更名>
sillyspec run plan --done --change <变更名> --output "<摘要>"
# 在隔离 worktree 内跑时（守卫默认拒绝，需双 flag）：
#   sillyspec <cmd> --allow-worktree-cwd --spec-dir "<worktree>/.sillyspec"
```

# 防坑清单

- plan.md 的 Wave 段只收纯 ID 引用行（`- task-01`），带括注长文会被 execute 契约门禁拦。
- 任务卡用 Edit 填充勿整文件重写（CRLF/漏字段回归）；taskcard 骨架占位符未替换会被 --done 硬校验拦。
- 卡内 depends_on 必须与 tasks.md 注册表一致（分叉=执行序错乱）。

# 边界声明

本卡不含步骤内容——每步的具体指令由 `sillyspec run plan` 按当前状态实时渲染（含门禁、审查档位、产物契约）。本卡只管启动与防坑。
<!-- sillyspec-card: v3.32.0 sha256=17fb0d136c06a9cc4113565e67f28d3f9a47345ff45e0edacdd338728f54ad5e -->
