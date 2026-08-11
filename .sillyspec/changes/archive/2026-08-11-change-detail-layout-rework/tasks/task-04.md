---
id: task-04
title: ChangeStageActions 当前阶段操作区组件
title_zh: 当前阶段操作区组件（收口 gate/推进/门禁/触发/Provider/团队）
author: qinyi
created_at: 2026-08-11 11:36:04
priority: P0
depends_on:
  - task-01
blocks:
  - task-06
  - task-08
allowed_paths:
  - frontend/src/components/changes/detail/change-stage-actions.tsx
  - frontend/src/components/changes/detail/__tests__/change-stage-actions.test.tsx
provides:
  - contract: ChangeStageActions
    fields:
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
goal: >
  新建 ChangeStageActions 组件，把 page.tsx 当前散落 5+ 处的智能体操作入口
  （gate 审核面板 / 完成待触发推进横幅 / 运行验证门禁 / 触发智能体 / Agent
  Provider+Model 覆盖 / 团队开关+StageTeamConfig）统一收口到「当前阶段操作区」。
  组件为纯受控展示组件，全部 handler 与状态由 page.tsx 经 Props 注入，不自带数据
  请求。依据 design.md §5.1/§7 ChangeStageActionsProps、§6 文件清单、§10 R-02/R-06。
implementation:
  - 新建 change-stage-actions.tsx，导出 ChangeStageActions 与 ChangeStageActionsProps interface，字段与 design.md §7 完全一致（21 个 props）。
  - gate 面板，依据 change.pending_review 投影查 GATE_PANELS 配置渲染标题/描述/审核意见 textarea/动作按钮，按钮 onClick 调 onGateAction(action)，disabled 随 transitioning，配置常量从现 page.tsx GATE_PANELS 原样搬入。
  - 推进横幅，显示条件 非gate 且 nextStage 非空 且 agentStatus.has_active_run 为假，渲染下一阶段中文标签，点推进调 onAdvance，verify 阶段额外渲染运行验证门禁按钮调 onRunVerifyGate，verifyGate 结果文案逻辑照搬现 page.tsx。
  - 触发智能体入口保留为 onDispatch 回调按钮（供 SillySpecStepProgress onDispatch=undefined 后的统一触发点），disabled 随 dispatching。
  - Agent Provider 用 AgentProviderSelect（value=stageProvider onChange=onStageProviderChange includeDefault=跟随工作区默认）与 AgentModelInput（value=stageModel onChange=onStageModelChange），黑盒复用。
  - 团队开关渲染条件与现 page.tsx 一致，pending_review 为 plan_review 或 human_test 或 current_stage 为 execute 或 verify 时渲染。
  - team toggle 必须原样保留 DOM 契约，button role 为 switch，aria-checked 随 teamMode，aria-label 为 用团队执行，onClick 调 onTeamModeChange(!teamMode)，文案随 stage 切 用团队执行/用团队验证，violet 配色照搬。
  - teamMode 为 true 时展开 StageTeamConfig（stage execute 或 verify，workers=stageWorkers，onWorkersChange=onStageWorkersChange，provider/model 透传），黑盒复用。
  - 组件不含 useState/useEffect 数据请求，不自调 lib/changes，全部经 props；StageWorkerPreset 类型从 @/components/stage-team-config import。
  - 新建 __tests__/change-stage-actions.test.tsx，覆盖 gate 面板渲染与回调、推进横幅显示条件与 onAdvance、verify 门禁按钮、团队 toggle role 与 aria-label 契约、toggle 开启后 StageTeamConfig 出现。
acceptance:
  - gate 面板四种 pending_review 均能渲染对应标题与动作按钮，点按钮以正确 action 调 onGateAction，textarea onChange 调 onGateCommentChange。
  - 推进横幅仅在有下一阶段且无活跃 run 时显示，点推进调 onAdvance；verify 阶段运行验证门禁按钮调 onRunVerifyGate 且 verifyGate 结果文案正确。
  - team toggle 在 execute/verify/plan_review/human_test 渲染、brainstorm 等不渲染，且 getByRole switch name 用团队执行 可命中，aria-label 契约未被破坏。
  - 开启 team toggle 后渲染 StageTeamConfig（出现 添加 Worker 按钮），provider/model 透传。
  - cd frontend && pnpm exec tsc --noEmit 通过，新增测试全绿。
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test -- change-stage-actions
constraints:
  - 仅新增两个文件，不修改 page.tsx（page 编排在 task-06），不修改被复用组件内部。
  - 零后端改动，不新增 API，不跑 gen:types（无 schema 变动）。
  - 不改 GATE_PANELS 语义、不改 stage 推进/派发业务逻辑，仅重组展示与入口位置。
  - team toggle 的 role=switch 与 aria-label=用团队执行 为硬 DOM 契约，page-team-toggle 测试迁移依赖，严禁破坏。
---
