---
id: task-06
title: page.tsx 瘦身编排
title_zh: page.tsx 瘦身编排（两栏网格 + 状态提升 + handler 下沉 + 删旧区块死代码）
author: qinyi
created_at: 2026-08-11 11:36:04
priority: P0
depends_on:
  - task-01
  - task-02
  - task-03
  - task-04
  - task-05
  - task-07
blocks:
  - task-08
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
goal: >
  把变更详情页 page.tsx 从约 1100 行的大单体瘦身为纯编排层，落地左主右辅布局并清除旧区块与死代码。
  依据 design.md §5.1 布局骨架与 §6 修改行：网格 lg:grid-cols-[1fr_320px]（移动端 <lg 单列折叠），
  页面只保留数据加载、共享状态（provider/model/teamMode/stageWorkers 等）与组件组合；handler 下沉到
  ChangeStageActions；删除「审批状态」区块、审查记录旧实现（listReviews 死表）、handleExecute 与
  handleTransition 死代码。覆盖 FR-01/FR-01b/FR-04/FR-06，决策 D-001@v1/D-003@v1/D-004@v1。
implementation:
  - 布局改为两栏网格 lg:grid-cols-[1fr_320px]，<lg 退化为单列，主线在上、次线卡片折叠堆叠在下方
  - 顶部保留 PageHeader（标题+阶段徽标+Key/类型/位置/影响），下方挂 ChangeStageHeader 阶段步骤条
  - 主线左栏依次组合 ChangeStageActions（当前阶段操作区）与 ChangeAgentRunLog（智能体执行日志）
  - 次线右栏依次组合 ChangeFilesCard、ChangeSessionsCard、ChangeReviewHistoryCard、ChangeTaskBoardCard
  - page.tsx 保留数据加载 Promise.all（getChange/getTaskBoard/getAgentStatus），删除 listReviews 调用与 reviews 状态
  - 保留并提升共享状态 stageProvider/stageModel/teamMode/stageWorkers/stageTeamMissionId/gateStatus/gateComment/advancing/dispatching/transitioning/localRunId 等，按契约 props 注入各子组件
  - 把 gate/推进/运行验证门禁/触发智能体等 handler 透传给 ChangeStageActions 的 onGateAction/onAdvance/onRunVerifyGate/onDispatch，删除组件内重复入口
  - 删除「审批状态」section（approval_status 区块与 APPROVAL_LABELS）、审查记录旧 section（reviews 渲染）
  - 删除死代码 handleExecute 与 handleTransition 及其专属状态 executing；审核/推进链路统一走 submitStageReview 与 advanceChangeStage
  - ChangeAgentRunLog 组合 SillySpecStepProgress 时传 onDispatch 为 undefined 消除双入口（R-04），page 侧不再单独渲染 SillySpecStepProgress 触发按钮
acceptance:
  - 打开详情页默认只见主线（阶段操作区 + 执行日志），次要信息在右侧栏，桌面宽屏两栏、移动端单列折叠正常
  - 「审批状态」区块与「审查记录」旧实现不再出现，页面无 listReviews 引用
  - handleExecute 与 handleTransition 死代码已删除，源码 grep 无残留引用
  - 智能体操作入口集中在当前阶段操作区，子步骤进度不重复暴露触发按钮
  - 同一变更的可用操作集合与现状一致，仅位置与归组变化（brownfield 行为不变）
verify: cd frontend && pnpm exec tsc --noEmit
constraints:
  - 纯前端展示层重组，不改任何 API/表结构/业务语义，不新增或修改对外字段与响应体
  - 审核历史数据来自 ChangeRead.stages.review_history，由 task-02 归一化为 ReviewHistoryItem 后消费，本任务不做后端改动也无需 gen:types
  - 复用不重建 AgentRunPanel/ChangeFileTree/ChangeSessionSection/SillySpecStepProgress/TeamProgress 等黑盒组件，不改其内部实现
  - team toggle 的 role 为 switch、aria-label 为用团队执行 的 DOM 契约由 task-04 保留在 ChangeStageActions，本任务透传即可不得破坏
  - 沿用本页现有 components/ui，不引入 antd
  - 代码实现须兼容 Windows、Linux 和 macOS
provides:
expects_from:
  task-01:
    needs:
      - title
      - defaultOpen
      - children
  task-02:
    needs:
      - reviewHistory
  task-03:
    needs:
      - currentStage
      - stages
      - updatedAt
  task-04:
    needs:
      - change
      - agentStatus
      - nextStage
      - verifyGate
      - gateComment
      - onGateCommentChange
      - onGateAction
      - onAdvance
      - onRunVerifyGate
      - onDispatch
      - transitioning
      - dispatching
      - advancing
      - stageProvider
      - onStageProviderChange
      - stageModel
      - onStageModelChange
      - teamMode
      - onTeamModeChange
      - stageWorkers
      - onStageWorkersChange
  task-05:
    needs:
      - workspaceId
      - panelRunId
      - panelIsActive
      - agentStatus
      - gateStatus
      - currentStage
      - steps
      - teamMode
      - stageTeamMissionId
      - onDone
      - onGateStatusChanged
      - onRefresh
      - refreshing
      - onDispatch
      - dispatching
  task-07:
    needs:
      - taskBoard
      - workspaceId
      - changeId
---
