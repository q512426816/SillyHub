---
author: qinyi
created_at: 2026-10-22 07:20:00
change: 2026-10-22-session-trajectory-view
---

# 决策记录（Decisions）— 2026-10-22-session-trajectory-view

## D-035@v1: 轨迹不做第三个视图，改为「进度」视图内的呈现方式开关；同时把 `/runs` 的 `timing` 透传到轮视图走真实占用
- type: ux
- priority: P0
- status: accepted
- source: user
- question: 轨迹接进产品会话页的形态——按 D-022@v1 加第三个视图模式，还是别的形态？产品页模型泳道是否只停留在「近似」口径？
- answer: 用户裁决（原话「2 和 3」，即两项都要）：**①不加第三视图**——轨迹作为「进度」视图内部的「时间线 / 轨迹」呈现开关（默认时间线＝现状零变化），`SessionViewMode` 保持两态、不新增持久化取值；**②把 `/runs` 返回的 `timing` 透传到轮视图**，让模型泳道有 attempts 采样时按真实占用（`observed`）绘制、泳道头标「真实占用」，无采样才退回「近似（无 TTFT 采样）」。
- normalized_requirement: `TurnTimeline` 在 `viewMode === "all"` 时渲染 `role="tablist"`「进度视图呈现方式」（时间线 / 轨迹），选「轨迹」改渲染 `TrajectoryPane`（轮块让位）；`enrichDisplayTurns` 把 `run.timing` 补进 `SessionTurnView.timing`（缺省 null，且不破坏身份稳定守卫）；`trajectoryFromTurnViews` 依据 `timing` 分派 `assembleTrajectory` 的 `modelBasis`。零新增网络请求、零后端改动。
- impacts: requirements FR-01 / FR-03；design「做法概述」「接口契约」；frontend `turn-timeline.tsx`、`session-panel/page-helpers.tsx`、`trajectory/from-turn-views.ts`
- evidence: frontend/src/components/daemon/turn-timeline.tsx:1345-1348、1812-1841；frontend/src/components/daemon/session-panel/page-helpers.tsx:249-258、280-283；frontend/src/components/daemon/trajectory/from-turn-views.ts:113-116、207
- 故障面: 若把 `progressLens` 持久化，用户切回「对话」再回来会被上次选择劫持，破坏「默认时间线＝现状零变化」的验收口径；若 `timing` 缺失时用 0 或 `now()` 补值，会把「没采样」伪装成「真实占用」，故一律 `null` + `approx` 标注。
- 退坡判据: 出现「需要轨迹与进度并排同时可见」的强需求，或第三视图能带来独立路由/深度链接能力时，重新评估视图模型（届时另开变更扩 `SessionViewMode`，不在本变更内）。
