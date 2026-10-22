---
author: flow-machine-draft
created_at: 2026-10-21T22:49:03.254Z
---
# 任务注册表（Tasks）— 2026-10-22-session-trajectory-view

> D-035（用户裁决）已把形态从「第三视图」改为「进度视图内的呈现方式开关 + `timing` 透传」，
> 任务面按新 FR 重排（1:1 对齐 requirements 的 FR-01…FR-05）。

- [x] task-01: 「进度」视图内提供「时间线 / 轨迹」呈现开关；默认时间线＝现状零变化，对话视图不出现该开关（FR-01）
- [x] task-02: 轨迹数据由已加载 `SessionTurnView[]` 经纯函数派生，与 dev 路由共用 `assembleTrajectory`（零新增请求/后端改动/API 字段）（FR-02）
- [x] task-03: `/runs` 的 `timing` 透传到轮视图，有采样走 `observed`「真实占用」、无采样走 `approx`「近似」，不伪造（FR-03）
- [x] task-04: 无可用时序数据时显示显式空态提示，不白屏、不伪造条（FR-04）
- [x] task-05: `tsc --noEmit` 退出 0；既有 trajectory / turn-segment-views / turn-time-display / session-list-panel 用例不回归，新增适配器与呈现开关用例全绿（FR-05）
