---
id: task-10
title: Unify page header and rewrite tests with zero regression
title_zh: 统一标题区与重写测试，前端全量零回归
author: qinyi
created_at: 2026-07-14 10:34:25
priority: P1
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09]
blocks: []
requirement_ids: [NFR-2]
decision_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/missions/page.tsx
  - frontend/src/components/__tests__/mission-console.test.tsx
goal: |
  作为变更收尾任务：统一 page.tsx 标题区与 mission-console（避免 h1/h2 重复），并重写 mission-console.test.tsx 测试断言（删除 mode 切换相关断言，新增高级默认折叠 / MissionSummaryCard 总览 / 中文状态 / 分工目标折叠 / 黑话不出现断言），跑前端全量 test + lint + typecheck 确认零回归。
implementation:
  - page.tsx：确认 PageHeader h1「Agent 团队」（:14-15）与 mission-console 组件标题区不重复——task-02 已删组件内 h2，本任务核对 page.tsx 标题文案与组件副标题（人话一句话）协调，必要时把 h1 文案与副标题对齐到统一中文表述（如「任务团队」/「AI 团队」二选一，组件副标题承接）。
  - page.tsx 标题若需微调（如「Agent 团队」→更人话的「AI 任务团队」），同步确保不与组件副标题重复或冲突。
  - mission-console.test.tsx 删除 mode 切换相关断言：移除「mode=single 默认不渲染 team 面板」（:73-78）、「mode=team 选中展开」（:80-90，含 fireEvent 切 team）、「worker 增删依赖 mode=team 前置」（:92-103 调整为直接操作高级折叠展开后的面板）。
  - mission-console.test.tsx 删除「submit(single)」用例（:144-163）——mode 已固定 team，single 路径不再存在。
  - 新增断言：高级「手动配分身」默认折叠（TeamConfigPanel 在 details close，主 agent 类型 label 初始不可见，展开后可见）。
  - 新增断言：MissionSummaryCard 总览渲染（中文状态徽标 + 成败统计 + 成本 + AI 最终结论；用 data-testid 或中文文案锚点，不绑英文 status）。
  - 新增断言：中文状态显示（如状态徽标文本含「规划中」/「运行中」/「已完成」等，不出现 planning/running/done 英文）。
  - 新增断言：分工目标默认折叠（WorkerRow 的 objective 默认收起，点击「▸ 分工目标」展开后可见完整文本）。
  - 新增断言：黑话不出现（渲染创建态与详情态后，screen 不含 Coordinator/Worker/daemon/orchestrator 等英文黑话文本——用 queryByText 正则匹配用户可见处）。
  - 调整 submit(team) 用例：去掉 fireEvent 切 team 步骤（:112），直接填 objective → 展开 advanced → 改配置 → 提交，断言 payload.mode==="team" + main_agent_config + worker_preset 仍成立。
  - 跑前端全量 pnpm test / pnpm lint / pnpm typecheck，修复因 mission-console 重构引入的断言失败与类型错误，确保零回归。
acceptance:
  - page.tsx 标题区与 mission-console 副标题不重复（h1 唯一，组件内无 h2 重复标题）。
  - mission-console.test.tsx 不再含 mode 切换 / ModeCard / submit(single) 相关断言（grep "mode" / "模式 team" / "submit(single)" 零命中）。
  - mission-console.test.tsx 新增高阶默认折叠 / MissionSummaryCard 总览 / 中文状态 / 分工目标折叠 / 黑话不出现 断言全部通过。
  - 测试断言不绑死英文 status 字符串（用中文映射值或语义锚点）。
  - `cd frontend && pnpm test` 全量通过（含其他组件测试零回归）。
  - `cd frontend && pnpm lint` 零 error。
  - `cd frontend && pnpm typecheck` 零 error。
verify:
  - cd frontend && pnpm test
  - cd frontend && pnpm lint
  - cd frontend && pnpm typecheck
constraints:
  - 后端零改动。
  - 文案中文（遵循 CLAUDE.md 规则 12）。
  - 测试断言不绑死英文 status（防未来翻译再次回归，用中文映射值或 data-testid）。
  - 仅改 page.tsx 标题区与 mission-console.test.tsx 两文件；不改 mission-console.tsx（由 task-01~09 负责）。
  - 本任务为收尾，depends_on task-01~09，必须等前序任务全部完成后再执行。
  - 测试失败优先修测试断言对齐新 UI，非测试逻辑本身有误禁止改实现绕过（CLAUDE.md 规则 9）。
---
