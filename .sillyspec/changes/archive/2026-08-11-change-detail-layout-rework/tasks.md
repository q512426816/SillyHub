---
author: qinyi
created_at: 2026-08-11 11:07:09
---

# 任务清单（Tasks）

> 骨架，plan 阶段展开为 Wave + 依赖。覆盖 FR-01~FR-06。
> ⚠️ 编号语义以 plan.md 为准（本骨架与 plan.md 已对齐；task-07=任务看板卡，移动端折叠并入 task-01/task-06）。

- [ ] task-01: 次线卡片容器与折叠基件（CollapsibleCard 受控折叠 + 变更文件卡 + 会话调试卡，含移动端折叠形态）
- [ ] task-02: 审核历史组件 ChangeReviewHistoryCard（读 stages.review_history，兼容 gate/rerun 异构形状，归一化+倒序+中文标签）+ 测试
- [ ] task-03: 阶段步骤条组件 ChangeStageHeader（含 lastActive）+ 测试
- [ ] task-04: 当前阶段操作区 ChangeStageActions（收口 gate/推进/verify/dispatch/provider/model/team，保留 team toggle aria-label 契约）+ 测试
- [ ] task-05: 智能体执行日志区 ChangeAgentRunLog（包 AgentRunPanel + gate 徽标 + 子步骤进度传 onDispatch=undefined + 团队进度按需）+ 测试
- [ ] task-06: page.tsx 瘦身编排（两栏布局 lg:grid-cols-[1fr_320px] + 移动端单列折叠；数据加载、状态提升、handler 下沉；删审批状态区块 + handleExecute/handleTransition 死代码）
- [ ] task-07: 任务看板摘要卡 ChangeTaskBoardCard（进度条+各状态计数+打开看板链接，无任务时隐藏）+ 测试
- [ ] task-08: 现有测试迁移与全量回归（page-team-toggle 重写指向 ChangeStageActions；session-section 等回归；frontend 模块 vitest 全量）
