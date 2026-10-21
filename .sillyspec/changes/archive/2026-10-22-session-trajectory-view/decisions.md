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

## D-036@v1: 独立评审 3 条 findings 的处置（1×P2 + 2×P3，全部 PASS 后登记为后续项）
- type: review
- priority: P2
- status: accepted
- source: review
- question: 独立评审（review.json，verdict=PASS，reviewedAgainst=6d4dd386f）报了 1 条 P2（`timing` 透传无测试断言）、2 条 P3（跳轮后轮号重排、design「切换」措辞与实现不符），是否在本次收口内修？
- answer: **本次不修代码**（修改会让冻结面与评审锚 `6d4dd386f` 漂移，触发「过期评审隔离重评」，收益小于成本）：P3「切换」措辞当场改（D-035 的 design 已同步澄清：换会话/重进才重置，同会话内保留上次选择）；P2 与 P3「轮号」登记为后续项 R-20 / R-21，理由如下。
- normalized_requirement: R-20（P2）：补一条 `enrichDisplayTurns` 透传 `timing` 的单测（`page-helpers-*.test.ts`），并给 `frontend/src/lib/daemon/sessions.ts` 的手工镜像 `SessionRunRead` 补 `timing?: TurnTimingSnapshot | null`（父变更 R-17 的收口），去掉 `page-helpers.tsx` 里的 `(meta as { timing?: … })` 结构断言——两者同一变更做。R-21（P3）：`trajectoryFromTurnViews` 的轮号改用 `turn.turn ?? outTurns.length + 1`，被跳过的轮不再导致面板 T## 与真实会话轮号错位。
- impacts: requirements FR-03（R-20 补测试绑定）、design「接口契约」（R-20 的镜像补列）
- evidence: .sillyspec/changes/2026-10-22-session-trajectory-view/review.json:7-25；frontend/src/components/daemon/session-panel/page-helpers.tsx:253-258；frontend/src/components/daemon/trajectory/from-turn-views.ts:132；backend/app/modules/daemon/router/session_insights.py:431（后端已透传，运行时今天可用）
- 故障面: R-20 未做前，`/runs` 的 `timing` 字段若改名或 `sessions.ts` 镜像漂移，前端会静默退回「近似」口径而不报错（表现为泳道头恒「近似（无 TTFT 采样）」，不是崩溃）。R-21 未做前，仅「首轮无时间锚点」的历史会话会出现 T## 与真实轮号错位（数据不伪造，仅标注失真）。
- 退坡判据: R-20 随 R-17 一起清偿（同一变更）；R-21 若在真实会话里观察到轮号错位被用户感知（截图/反馈），提前到下一个变更首项修。
