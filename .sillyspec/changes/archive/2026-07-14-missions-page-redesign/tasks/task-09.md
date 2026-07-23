---
id: task-09
title: STATUS_LABEL Chinese mapping and hide internal jargon
title_zh: STATUS_LABEL 中文化映射并隐藏内部黑话
author: qinyi
created_at: 2026-07-14 10:34:25
priority: P2
depends_on: []
blocks: [task-10]
requirement_ids: [FR-9, FR-10]
decision_ids: [D-005@v1]
allowed_paths:
  - frontend/src/components/mission-console.tsx
goal: |
  在 mission-console.tsx 中新增 STATUS_LABEL 中英文映射表（mission 级 6 值 + worker 级 5 值），所有用户可见状态徽标改为中文显示；同时替换 UI 文案中的内部黑话（Coordinator/Worker/daemon/Orchestrator/Mission 等），并隐藏 workspace_id/mission_id/run_id 三层内部标识，确保非开发者用户全程只见中文。
implementation:
  - 新增 mission 级 STATUS_LABEL 常量映射：planning→规划中 / running→运行中 / done→已完成 / degraded→部分完成 / failed→失败 / cancelled→已取消。
  - 新增 worker 级（AgentRunStatus）状态映射：pending→排队中 / running→运行中 / completed→已完成 / failed→失败 / killed→已终止。
  - STATUS_BADGE（mission-console.tsx:24-31）保留作为配色表，徽标文案改用 STATUS_LABEL[status] ?? status 渲染，不再直接输出 status 原文。
  - 详情态 mission 状态徽标（mission-console.tsx:818-820）从 `{mission.status}` 改为 `{STATUS_LABEL[mission.status] ?? mission.status}`。
  - 历史列表 mission 状态徽标（mission-console.tsx:722-725）同样改为中文 STATUS_LABEL。
  - WorkerRow 状态文案（mission-console.tsx:300 `{worker.status}`）改为 worker 级中文映射。
  - UI 黑话文案替换：CoordinatorPanel 标题/正文「Coordinator 正在拆解任务为 Worker 团队…」（:157-158）、「已拆解为 N 个 Worker」（:171-173）改为主控/分身中文；WorkerLogPanel 标题（:254）「主 Agent 日志 / Worker 日志」去 Worker 黑话；主 agent 区块与 worker 列表标题（:845-859）的 Worker 字样改中文。
  - ROLE_LABEL（:36-45）已有中文，确认 orchestrator 显示为「主控」（当前为「主 Agent」，按 design §6 统一为主控，与 task-07 角色徽标配合）。
  - 隐藏 workspace_id / mission_id / run_id 三层内部标识：WorkerLogPanel 标题中 `（${runId.slice(0,8)}）`（:254）移除 run_id 露出；确认组件 UI 不展示 workspaceId/missionId（仅作为 props 内部使用）。
  - CoordinatorPanel 描述「调用 GLM 分析任务…」（:161）移除 GLM/daemon 等内部词，改人话。
acceptance:
  - STATUS_LABEL 覆盖 mission 级全部 6 值（planning/running/done/degraded/failed/cancelled）与 worker 级全部 5 值（pending/running/completed/failed/killed）。
  - 所有用户可见的状态徽标（mission 详情态、历史列表、WorkerRow）显示中文，不出现 planning/running/done/degraded/failed/cancelled 英文原文。
  - UI 文案不出现 Coordinator/Worker/daemon/Orchestrator/Mission 等黑话（grep 用户可见 JSX 零命中，注释不计）。
  - run_id（runId.slice(0,8)）不再在 WorkerLogPanel 标题等用户可见处露出。
  - workspace_id / mission_id 不出现在用户可见 UI（仅内部 props/URL 用）。
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm test
constraints:
  - 后端零改动（mission.status / worker.status 字段值不变，仅前端展示层翻译）。
  - 文案中文（遵循 CLAUDE.md 规则 12），不使用专业术语黑话。
  - 测试断言不绑死英文 status 字符串（用中文映射值或 data-testid 锚点，防未来翻译再次回归）。
  - STATUS_BADGE 配色表保留（仅映射颜色，不改文案）；缺失 key 走默认兜底不崩溃。
  - 注释中的英文黑话（如 CoordinatorPanel 函数名）不影响用户可见 UI，不强制改名。
---
