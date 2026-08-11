---
id: task-05
title: ChangeAgentRunLog agent run log section
title_zh: 智能体执行日志区 ChangeAgentRunLog（包 AgentRunPanel + gate 徽标 + 子步骤 onDispatch=undefined + 团队按需展开）
author: qinyi
created_at: 2026-08-11 11:36:04
priority: P0
depends_on: [task-03]
blocks: [task-06]
requirement_ids: [FR-02, FR-05b]
decision_ids: [D-002@v1, D-004@v1]
allowed_paths:
  - frontend/src/components/changes/detail/change-agent-run-log.tsx
  - frontend/src/components/changes/detail/__tests__/change-agent-run-log.test.tsx
provides:
  - contract: ChangeAgentRunLog
    fields: [workspaceId, panelRunId, panelIsActive, agentStatus, gateStatus, currentStage, steps, teamMode, stageTeamMissionId, onDone, onGateStatusChanged, onRefresh, refreshing, onDispatch, dispatching]
goal: >
  新建主线「智能体执行日志」组件 ChangeAgentRunLog，把现 page.tsx 中 SillySpecStepProgress（子步骤进度）+ gate 徽标 + AgentRunPanel（执行日志）+ TeamProgress（团队按需）四处收口为单一日志区；组合 SillySpecStepProgress 时传 onDispatch=undefined 消除双入口（FR-05b），逻辑全部黑盒复用现有组件不改内部。
implementation:
  - 新建 change-agent-run-log.tsx，定义并导出 ChangeAgentRunLogProps（字段见 design §7 change-agent-run-log 接口定义，与 provides.fields 一致）
  - 渲染 SillySpecStepProgress：currentStage/steps/hasActiveRun/configEnabled/lastDispatch* 等 props 从 agentStatus 派生（搬自 page.tsx L847-881），steps 派生逻辑上移本组件，但 onDispatch 传 undefined 使其内嵌「触发智能体/执行下一步」按钮不渲染（R-04）
  - 渲染 gate 徽标 Badge：数据源合并 gateStatus?.gate_status 回退 agentStatus.last_dispatch.gate_status；pending/running→客观核验中(animate-pulse)、decided 无 errors→✓ 已通过(success)、failed/decided 有 errors→✗ 核验失败(destructive)，搬自 page.tsx L896-918
  - 渲染 AgentRunPanel（panelRunId 非空时）：workspaceId/runId=panelRunId/isActive=panelIsActive/isLive/title=智能体执行日志/onDone/onGateStatusChanged 透传，搬自 page.tsx L884-946 含折叠展开
  - teamMode 且 stageTeamMissionId 非空时渲染 TeamProgress(missionId, workspaceId)，团队进度按需展开
  - 新建 __tests__/change-agent-run-log.test.tsx：日志面板+子步骤+gate 徽标组合渲染、SillySpecStepProgress 不渲染触发按钮、teamMode 开且有 missionId 时 TeamProgress 出现
acceptance:
  - 组件按 Props 渲染 AgentRunPanel + gate 徽标 + 子步骤进度，主线只见执行日志不见会话（FR-02）
  - 组合 SillySpecStepProgress 时其内嵌触发/执行下一步按钮不渲染（FR-05b，onDispatch=undefined）
  - teamMode=true 且 stageTeamMissionId 非空时展示 TeamProgress，否则不展示
  - tsc 无类型错误，新测试全通过
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test change-agent-run-log
constraints:
  - 不改 AgentRunPanel/SillySpecStepProgress/TeamProgress 内部，全部黑盒引用（design §6 复用不重建）
  - 消除双入口唯一可行接线为传 onDispatch=undefined，不得新增 hide prop（R-04 / Design Grill 确认）
  - 纯前端展示层组件，不触碰任何 API/DTO/后端逻辑，无需 gen:types
---
