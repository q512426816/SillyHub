---
name: sillyspec:run-brainstorm
description: brainstorm 头脑风暴阶段：需求澄清→四件套→设计→Grill 审查
---
# 何时用

新能力/行为契约变更/跨模块取舍——需要落盘设计决策的变更，第一步走这里（判规模：范围明确的局部修补走 flow 轻量变更卡）。

# 生命周期速查

```bash
export SILLYSPEC_SESSION_ID=<agent名+任务名>   # 每条命令都带（shell 状态不持久；多会话并行的所有权判定依赖它）
sillyspec run brainstorm --change <变更名> --input "<需求一句话>"
# 每步产出后：
sillyspec run brainstorm --done --change <变更名> --output "<摘要>"
# 方案选择/设计确认等用户决策点（已拍板则一步落）：
sillyspec run brainstorm --done --answer "<用户回答>" --change <变更名> --output "<摘要>"
# 预检省一轮返工：
sillyspec gate brainstorm --change <变更名>
# 在隔离 worktree 内跑时（守卫默认拒绝，需双 flag）：
#   sillyspec <cmd> --allow-worktree-cwd --spec-dir "<worktree>/.sillyspec"
```

# 防坑清单

- 四件套/设计/任务卡一律用 CLI 骨架生成（fourpiece-init / design-init / taskcard）——手拼 frontmatter 会被门禁拦。
- design.md 计划新建的文件路径必须带 `NEW:` 前缀（末步存在性核验铁律）。
- Grill 审查档 S2=独立子代理单轮；审查者只读，唯一可写 review.json；FAIL 后 resume 同一审查者只验阻断项（禁全文重审）。
- 用户决策点用 --answer 落既有决策，不要空等。

# 边界声明

本卡不含步骤内容——每步的具体指令由 `sillyspec run brainstorm` 按当前状态实时渲染（含门禁、审查档位、产物契约）。本卡只管启动与防坑。
<!-- sillyspec-card: v3.32.0 sha256=364590c186a83e85736fc169054d7396eb60fa0b699d32cffe3df536b2d3b994 -->
