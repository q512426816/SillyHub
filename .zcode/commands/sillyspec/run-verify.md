---
name: sillyspec:run-verify
description: verify 验证阶段：探针核验+测试对账+验收报告
---
# 何时用

execute 收口后对照文档验收（probe 契约+known_failures 对账+测试绿）。

# 生命周期速查

```bash
export SILLYSPEC_SESSION_ID=<agent名+任务名>   # 每条命令都带（shell 状态不持久；多会话并行的所有权判定依赖它）
sillyspec run verify --change <变更名>
sillyspec run verify --done --change <变更名> --output "<验收摘要>"
# 探针骨架缺失时：
sillyspec verify-probes --init --change <变更名>   # 已存在加 --force 刷新
# 在隔离 worktree 内跑时（守卫默认拒绝，需双 flag）：
#   sillyspec <cmd> --allow-worktree-cwd --spec-dir "<worktree>/.sillyspec"
```

# 防坑清单

- gate 失败明细落 .runtime/verify-runs/gate-<stage>-<change>.json（勿靠 stdout 记忆）。
- 非测试逻辑有误禁改测试来过——修逻辑。
- known_failures 豁免只在 local.yaml 声明位置复核，勿手抄。

# 边界声明

本卡不含步骤内容——每步的具体指令由 `sillyspec run verify` 按当前状态实时渲染（含门禁、审查档位、产物契约）。本卡只管启动与防坑。
<!-- sillyspec-card: v3.32.0 sha256=d3e36d42709e9cfc5fa0bdefda99294743ba27323033320146403c11910001f0 -->
