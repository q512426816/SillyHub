---
id: task-10
title: frontend change detail degrade + approval card with notify
title_zh: 变更详情页退化 + 审批卡改造
author: qinyi
created_at: 2026-08-14 15:46:49
priority: P0
depends_on: [task-02, task-03, task-04]
blocks: [task-11]
requirement_ids: [FR-05a, FR-05b, FR-05e]
decision_ids: [D-003@v1, D-006@v2]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx
  - frontend/src/components/changes/detail/change-stage-actions.tsx
  - frontend/src/components/changes/detail/change-stage-header.tsx
  - frontend/src/lib/changes.ts
  - frontend/src/lib/daemon.ts
  - frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx
goal: >
  详情页退化：删全部执行控制（推进/重新派发/验证门禁/选档案/团队配置，含 quick 分支），保留只读
  展示区 + 人工审批卡；审批卡改为单端点调用（notify_session）+ 绑定会话只读展示 + 三类降级提示。
implementation:
  - [cid]/page.tsx：删执行控制 state/handler（handleAdvance/handleDispatch/handleRunVerifyGate/
    handleStageProfileChange/teamMode 等）；保留阶段进度条/执行日志流/文件卡/历史卡/看板展示；
    删 agent_dispatch 消费逻辑（:218-230，随 handleAdvance 一起删）
  - change-stage-actions.tsx：删执行控制 UI（推进/重新派发/验证门禁/选档案/团队配置，含 quick 分支
    :143-199 的 onDispatch+档案选择）；改为审批卡：意见输入 + 绑定会话只读展示（取 change_session_links
    最新会话标题/信息，后端或前端取）+「通过并通知绑定会话 / 打回并通知绑定会话」按钮
  - 审批卡按钮映射（plan 前置钉死）：proposal_review→proposal_approve/proposal_revise；
    plan_review→plan_approve/plan_replan；human_test→test_pass/test_bug；archive_confirm→archive_confirm（无打回）
  - 调用走 submitStageReview（lib/changes.ts:567 分发）+ notify_session 透传；据响应 notified_session/
    notify_error 展示三类降级：turn_conflict→「审批已生效，agent 忙，稍后会话告知」；
    session_inactive→「绑定会话已结束，去会话页开启（文案可复制）」；其它→通用提示+文案可复制。
    审批记录/状态不受注入失败影响（提示里说明）
  - lib/changes.ts：submitStageReview 加 notify_session 透传（各 stage review 客户端方法加参数）；
    保留 advanceChangeStage/triggerDispatch 等后端仍有但前端不再调的？（task-03 后端仍保留 service，
    HTTP advance 端点保留与否按 design——删详情页执行控制但端点本身不动，lib 方法可留或删，
    以 typecheck 无 unused 为准）
  - 详情页既有测试改写（删执行控制断言），新增审批卡降级提示测试
acceptance:
  - 详情页无任何执行控制按钮（含 quick 分支）；保留进度条/日志/文件/历史/看板
  - 审批卡：「通过/打回并通知绑定会话」单端点调用，绑定会话只读展示，三类降级提示按 notify_error
    分类展示；文案可复制
  - submitStageReview 透传 notify_session；既有 stage review 调用方（无）不受影响
  - vitest 详情页/审批卡 + pnpm typecheck/lint 通过
verify:
  - cd frontend && pnpm test
  - cd frontend && pnpm typecheck && pnpm lint
constraints:
  - 审批入口仍在详情页（design 非目标：不做会话内审批 UI）
  - 后端审批端点/服务保留（task-03/04 改造后），前端只删 UI 控制 + 改审批卡调用
  - 中文 UI；locale zh-CN 显式传（frontend-locale 坑）
---
