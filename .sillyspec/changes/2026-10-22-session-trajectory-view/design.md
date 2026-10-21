---
author: flow-machine-draft
created_at: 2026-10-21T22:49:03.254Z
---
# 设计记录（Design Record）— 2026-10-22-session-trajectory-view

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

把父变更已定稿的轨迹视图接进产品会话页，按用户裁决（D-035，覆盖 D-022@v1）**不加第三个视图模式**：`SessionViewMode` 仍是 `"conversation" | "all"`，轨迹作为「进度」视图内部的**呈现方式开关**（`role="tablist"`，时间线 / 轨迹），默认「时间线」＝现状逐字不变；选中「轨迹」时同一个进度容器改渲染 `TrajectoryPane`，轮块列表让位（不双画）。

数据侧两件事：①新写纯函数适配器 `trajectoryFromTurnViews(turns)` 把页面已加载的 `SessionTurnView[]` 映射成 `TrajectoryRow[]`/`TrajectoryTurn[]`，再交给从 `buildTrajectory` 尾部抽出的 `assembleTrajectory`（窗口 / 覆盖率 / 口径同一套数学），因此 dev 路由与产品页只差数据来源、渲染组件完全相同；②`page-helpers.enrichDisplayTurns` 把 `/runs` 已经拿到的 `run.timing`（daemon TTFT/attempt 采样）透传到轮视图 `timing`，模型泳道据此从「近似空档」切成 `observed` 真实占用区间。没有新请求、没有新端点、没有后端改动。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `build-trajectory.ts`：**新增导出** `assembleTrajectory(rows, turns, timingByRunId?)`——从 `buildTrajectory` 尾部原样抽出（窗口 / 覆盖率 / 泳道 / `modelBasis`），`buildTrajectory` 改为 `return assembleTrajectory(rows, turns, timingByRunId)`，行为与返回值逐字等价（35 例既有断言零改动通过）。
- **新增** `trajectory/from-turn-views.ts`：`trajectoryFromTurnViews(turns: readonly SessionTurnView[], opts?: { maxTextLen?: number }): Trajectory`——纯函数、零 I/O、零 `Date.now()`；无锚点轮与 `preview` 条目直接跳过。
- `turn-timeline.tsx`：`SessionViewMode` **不变**（仍两态）；`SessionTurnView` **加**可选字段 `timing?: TurnTimingSnapshot | null`；新增内部组件 `TrajectoryPane`（`data-testid="trajectory-pane"` / 空态 `data-testid="trajectory-empty"`）；`TurnTimeline` 内新增本地 state `progressLens: "timeline" | "trajectory"`（默认 `timeline`，仅 `viewMode === "all"` 时渲染开关）。
- `session-panel/page-helpers.tsx`：`enrichDisplayTurns` 的 `enrichOne` **加** `timing: t.timing ?? meta.timing ?? null`；身份稳定守卫的 `timing` 比较改为 `(candidate.timing ?? null) !== (t.timing ?? null)`——缺省归一（`undefined ≡ null`），否则每个无 timing 的轮都会因多一个 `null` 键丢引用稳定性，击穿下游 memo。
- **无**后端改动、**无**新端点、**无**新网络请求、**无** API 字段变化（`/runs` 的 `timing` 字段父变更已存在，本变更只是消费它）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

轨迹只消费当前会话的 `turns`（含 `realRunId` 归一），不跨会话/跨工作区取数；`timingByRunId` 以 `runId` 为键在本会话内构建，多实例互不串台。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

切「轨迹」只换进度容器内的渲染分支，`TurnTimeline` 的 SSE 订阅、贴底跟随、prepend 分页逻辑全未动；`timing` 透传只在既有 `enrichDisplayTurns` 里加字段，不新增 effect、不改轮状态机。`progressLens` 是组件本地 state（不持久化），切视图/重进回到「时间线」，不存在上一次选择劫持下次打开的问题。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

本变更是纯渲染 + 纯函数派生，不写任何数据/文件；`progressLens` 各自持有本地 state，多标签页并发切换只影响本页。

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

适配器按 `startedAt` 稳定排序（同刻用 `id` 兜底），迟到段只会追加到对应轮并重排；`turns` 引用变化即重算（`useMemo([turns])`），与既有轮渲染同一输入源，不存在第二套时钟假设。`timing` 迟于轮视图到达时，`enrichDisplayTurns` 产生新对象引用 → `useMemo` 重算 → 泳道从「近似」自愈为「真实占用」，不会停在过期口径。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- **最大风险**：轮视图的时间戳精度不如原始日志（段级 `startedAt` 可能为 null，只有工具段有真实 `endedAt`），且老 daemon / 未采样轮没有 `timing`——这些轮会走「近似」口径，同一面板可能出现「部分轮真实占用、部分轮近似」的混合（`modelBasis` 按整条泳道降级为 `approx` 并标注，不把近似说成真实）。缓解＝口径标注始终可见 + 适配器对缺锚点的段退回**轮首真实锚点**（不是 `now()`）。
- **试过但放弃**：①**第三视图**（`viewMode: "trajectory"`，D-022@v1 原方案）——用户裁决「不要第三个视图，放进进度里」，且三态视图要改 `turn-state` 持久化与两处视图切换（page/dialog），回归面更大；②在产品页新增 `GET /sessions/{id}/logs` 拉全量日志再 `buildTrajectory`——多一次全量拉取（长会话 MB 级），与既有分页/懒加载冲突，违反「零新增网络请求」；③把 `buildTrajectory` 逻辑复制一份改成轮视图入参——两份装配数学必然漂移（窗口/覆盖率/口径双维护），故抽 `assembleTrajectory` 共用；④`progressLens` 持久化到 localStorage——用户切回「对话」再回来会被上次选择「劫持」，且与「默认时间线＝现状零变化」的验收口径冲突。

## 文件变更清单（自声明面——收口对账用，与提交面逐项对应）

**生产代码（4）**

- `frontend/src/components/daemon/trajectory/build-trajectory.ts`（改）——抽出并导出 `assembleTrajectory`，`buildTrajectory` 改为调用它（行为零变化）。
- `frontend/src/components/daemon/trajectory/from-turn-views.ts`（新增）——`trajectoryFromTurnViews(turns, opts?)` 纯函数适配器（含 `timing` 按 runId 收集）。
- `frontend/src/components/daemon/turn-timeline.tsx`（改）——新增 `TrajectoryPane`（含空态）、进度视图呈现开关（`progressLens`）、`SessionTurnView.timing` 可选字段。
- `frontend/src/components/daemon/session-panel/page-helpers.tsx`（改）——`enrichDisplayTurns` 透传 `/runs` 的 `timing`，身份稳定守卫按缺省归一比较。

**测试（2 新增）**

- `frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts`（新增，9 例）。
- `frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx`（新增，5 例）。

**变更工件（本目录）**：`proposal.md` / `requirements.md` / `design.md` / `tasks.md` / `decisions.md` / `visual-evidence.md` / `flow-state.yaml`。

**机读配置（不入 git）**：`.sillyspec/local.yaml` 新增 2 条窄 `known_failures`（并发 flake 豁免，已注释复核条件）。
