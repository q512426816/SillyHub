---
author: qinyi
created_at: 2026-08-11 11:07:09
plan_level: full
---

# 实现计划（Plan）

> 变更：2026-08-11-change-detail-layout-rework ｜ 来源：design.md §5/§6/§7、requirements.md FR-01~FR-06、decisions.md D-001~D-005
> 全部前端模块（frontend/），零后端改动。测试命令：`cd frontend && pnpm test`（test_strategy=module）。

## Wave 1（并行，无依赖 —— 独立展示组件）
- [x] task-01: 次线卡片容器与折叠基件（CollapsibleCard 受控折叠 + 变更文件卡 ChangeFilesCard 包 ChangeFileTree + 会话调试卡 ChangeSessionsCard 包 ChangeSessionSection）（覆盖：FR-01, FR-01b, FR-02, D-001@v1, D-002@v1）
- [x] task-02: 审核历史组件 ChangeReviewHistoryCard（读 change.stages.review_history，兼容 gate/rerun 两种形状，归一化 ReviewHistoryItem + 倒序 + 中文标签/颜色 + 空态）+ 测试（覆盖：FR-03, FR-03b, D-003@v1）
- [x] task-03: 阶段步骤条组件 ChangeStageHeader（5 大阶段宏观进度 + lastActive，抽自 page.tsx）+ 测试（覆盖：FR-01, D-001@v1）
- [x] task-07: 任务看板摘要卡 ChangeTaskBoardCard（进度条 + 各状态计数 + 打开看板链接，无任务时隐藏）+ 测试（覆盖：FR-01, D-001@v1）

## Wave 2（依赖 Wave 1 的复用组件契约，不依赖 W1 文件本身 —— 主线复合区）
- [x] task-04: 当前阶段操作区 ChangeStageActions（收口 gate 面板/推进横幅/运行验证门禁/触发智能体/Agent Provider+Model/团队开关+StageTeamConfig；保留 team toggle 的 role=switch + aria-label="用团队执行" DOM 契约）+ 测试（覆盖：FR-05, D-004@v1）
- [x] task-05: 智能体执行日志区 ChangeAgentRunLog（包 AgentRunPanel + gate 徽标 + 子步骤进度 SillySpecStepProgress 组合时传 onDispatch=undefined 消除双入口 + TeamProgress 团队按需展开）+ 测试（覆盖：FR-02, FR-05b, D-002@v1, D-004@v1）

## Wave 3（依赖 Wave 1+2 —— 编排集成）
- [x] task-06: page.tsx 瘦身编排（两栏网格 lg:grid-cols-[1fr_320px] + 移动端 <lg 单列折叠；数据加载 + 状态提升 + handler 下沉到 ChangeStageActions；删除审批状态区块、审查记录旧实现、handleExecute/handleTransition 死代码）（覆盖：FR-01, FR-01b, FR-04, FR-06, D-001@v1, D-003@v1, D-004@v1）

## Wave 4（依赖 Wave 3 —— 测试迁移与回归）
- [x] task-08: 现有测试迁移与全量回归（page-team-toggle.test 重写指向 ChangeStageActions；change-session-section 等回归；跑 frontend 模块 vitest 全量）（覆盖：FR-06, 非功能-可测试, D-004@v1）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | 次线折叠基件+文件卡+会话卡 | W1 | P0 | — | FR-01,FR-01b,FR-02 / D-001,D-002 | CollapsibleCard 复用形态；文件/会话卡包现有组件 |
| task-02 | 审核历史卡 | W1 | P0 | — | FR-03,FR-03b / D-003 | 核心新逻辑：review_history 双形状归一化 |
| task-03 | 阶段步骤条 | W1 | P1 | — | FR-01 / D-001 | 纯抽取，逻辑搬自 page.tsx |
| task-07 | 任务看板摘要卡 | W1 | P1 | — | FR-01 / D-001 | 摘要+链接，无任务隐藏 |
| task-04 | 当前阶段操作区 | W2 | P0 | task-01(契约) | FR-05 / D-004 | 收口 5+ 入口，接线最复杂，保留 aria 契约 |
| task-05 | 智能体执行日志区 | W2 | P0 | task-03(契约) | FR-02,FR-05b / D-002,D-004 | 包 AgentRunPanel+子步骤(onDispatch=undefined)+团队 |
| task-06 | page.tsx 瘦身编排 | W3 | P0 | task-01~05,07 | FR-01,FR-01b,FR-04,FR-06 / D-001,D-003,D-004 | 布局+编排+删旧区块/死代码 |
| task-08 | 测试迁移与回归 | W3 | P0 | task-04,06 | FR-06,非功能 / D-004 | team-toggle 重写 + frontend 全量回归 |

## 关键路径

```
task-01 ─┐
task-02 ─┤
task-03 ─┼─→ task-04 ─┐
task-07 ─┘   task-05 ─┴─→ task-06 ─→ task-08
```

最长路径：W1(任一) → task-04/05 → task-06 → task-08。task-06 编排集成是汇点，决定最短交付周期。

## 全局验收标准

- [ ] 打开详情页默认只见主线（阶段操作区 + 执行日志），次要信息在右侧栏（FR-01/FR-02）
- [ ] 「审核历史」显示真实审核留痕（时间/结果/意见），gate 与 rerun 两种形状均正确渲染（FR-03/FR-03b）
- [ ] 「审批状态」区块与「审查记录」旧实现不再出现；`handleExecute`/`handleTransition` 死代码已删（FR-04/FR-06）
- [ ] 智能体操作入口集中在「当前阶段操作区」，子步骤进度不重复暴露触发按钮（FR-05/FR-05b）
- [ ] 移动端 <1024px 单列折叠正常（FR-01b）
- [ ] 所有新组件测试通过 + frontend 模块 vitest 全量回归通过（含 page-team-toggle 迁移后断言契约）
- [ ] 集成冒烟：真实打开一个含审核记录的变更详情页，主线/次线/操作区/审核历史联动正确（组件单测全绿 ≠ 集成正确）
- [ ] （brownfield）未配置新功能时行为不变：同一变更的可用操作集合与现状一致，仅位置/归组变化

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-03, task-06, task-07 | 全局验收-FR-01/FR-01b |
| D-002@v1 | task-01, task-05 | 全局验收-FR-02 |
| D-003@v1 | task-02, task-06 | 全局验收-FR-03/FR-03b/FR-04 |
| D-004@v1 | task-04, task-05, task-06, task-08 | 全局验收-FR-05/FR-05b/FR-06 |
| D-005@v1 | 全部（沿用 @/components/ui） | 全局验收-brownfield 行为不变 |
