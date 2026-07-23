---
id: task-02
title: Rearrange creation form - single-column flow with human placeholder
title_zh: 创建态重排，输入框顶置与文案人话化
author: qinyi
created_at: 2026-07-14 10:34:25
priority: P1
depends_on: [task-01]
blocks: []
requirement_ids: [FR-1]
decision_ids: [D-004@v1]
allowed_paths:
  - frontend/src/components/mission-console.tsx
goal: |
  重排创建态布局为单栏流式：删除 mission-console.tsx:696 重复 h2 标题，textarea 输入框顶置为页面第一焦点，placeholder 换成人话（无代码路径示例），副标题改为一句话说明。
implementation:
  - 删除 mission-console.tsx:695-697 的 `<h2>🤝 Agent 团队（Mission）</h2>`（h1 由 page.tsx 统一提供，组件内不再重复）。
  - 副标题（mission-console.tsx:698-701）从「描述任务目标，Coordinator 会拆解为 Worker 团队…」改为一句人话，不带 Coordinator/Worker/daemon 内部黑话（如「描述你要 AI 团队做的事，主控会自动拆分分工并行执行」）。
  - 将 textarea 输入框移到创建表单区顶部（在模式选择 / 高级折叠 / 费用上限之前），成为页面第一焦点。
  - textarea placeholder（mission-console.tsx:745）从「例：分析 backend/app/modules/agent/ 目录的架构…」改为无代码路径的人话（如「描述你要 AI 团队做什么…」）。
  - 调整 JSX 顺序：textarea → 高级折叠（task-04）→ 费用上限 + 启动按钮，保持单栏自上而下流式。
acceptance:
  - mission-console.tsx 中不再渲染 `<h2>🤝 Agent 团队（Mission）</h2>`（grep 零命中）。
  - textarea 在创建表单区位于最上方（mode 删除后直接是首元素）。
  - textarea placeholder 不含 `backend/app/` 或其他代码路径示例，是面向非开发者的人话。
  - 副标题只有一句话，不含 Coordinator/Worker/daemon/Finalizer 等黑话词。
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm test
constraints:
  - 后端零改动。
  - 副标题与 placeholder 文案为中文、面向非开发者。
  - 不破坏现有创建表单提交逻辑（objective/budget 字段绑定不变）。
  - 单栏流式，不引入多列网格。
---
