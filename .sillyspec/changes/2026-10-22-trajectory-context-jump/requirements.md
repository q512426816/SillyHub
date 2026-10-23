---
author: flow-machine-draft
created_at: 2026-10-23T16:30:40.307Z
---
# 需求规格（Requirements）— 2026-10-22-trajectory-context-jump

## 功能需求

### FR-01: processItems 的 system_event 在轨迹账本显示为「上下文」类型行（真实文案与时间锚点，缺锚点用轮首，不伪造）

- `trajectoryFromTurnViews` **必须**把每轮 `processItems` 中 `kind === "system_event"` 的项派生为账本行：类型标签显示「上下文」，摘要为该项原文；时间锚点取项自带 `ts`，缺失时 **必须** 落到该轮首锚点（与段缺锚点同语义），**禁止** 用当前时刻或 0 伪造。无 `system_event` 的轮 **禁止** 产生额外行（零回归）。

#### 场景：主路径

Given 一轮 processItems 含 `system_event`（text="Agent sent a message"，ts=轮中段时刻）；When 打开轨迹；Then 账本出现一条「上下文」行，摘要为原文，位于按时间排序的正确位置。

#### 场景：缺锚点

Given `system_event` 无 ts；When 派生；Then 行锚点=该轮首锚点，行不丢失。

#### 场景：零回归

Given 一轮无任何 system_event；When 派生；Then 该轮行集合与改动前完全一致。

### FR-02: 轨迹视图下点击左侧轮次刻度，账本滚动定位到对应轮次首行并选中（复用 handleJumpToTurn 的轨迹分支）

- `viewMode === "trajectory"` 时点击轮次导航（TurnCatalog/TurnNavList），`handleJumpToTurn` **必须** 走轨迹分支：按 `entry.key` 匹配轮（realRunId ?? runId），把该轮首个可见行置为选中并 **必须** 让账本滚动定位到该行；对话/进度视图行为 **禁止** 变化。

#### 场景：主路径

Given 轨迹视图 + 多轮会话；When 点击左侧第 N 轮刻度；Then 账本滚动到第 N 轮首行且该行选中（详情面板显示该行）。

#### 场景：未加载轮

Given 目标轮尚未加载（预览态）；When 点击该轮刻度；Then 行为不劣化——预览轮本就不进轨迹（既有 D-006 语义），定位跳过该轮不报错。

### FR-03: 点击时间线条块或键盘 ↑/↓ 移动选中时，账本自动把选中行滚入视野

- 选中行变化（点击账本行、点击时间线条块、键盘 ↑/↓、轮次跳转）时，账本 **必须** 调用 `scrollIntoView({ block: "nearest" })` 把选中行滚入视野（带 jsdom `typeof` 守卫）；选中被清空时 **禁止** 滚动。

#### 场景：主路径

Given 账本已滚出选中行视口；When 点击时间线某条块；Then 对应行被选中且滚回视野。

### FR-04: 轨迹相关测试零回归、新增用例全绿、frontend tsc --noEmit 退出 0

- 既有轨迹/会话面板用例 **禁止** 放宽或删除；新增用例 **必须** 全绿；`frontend` 的 `tsc --noEmit` **必须** 退出 0。

#### 场景：主路径

Given 变更落盘；When 跑轨迹目录与会话面板相关测试与 tsc；Then 全部通过。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: `frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts`「system_event 派生为上下文行：原文摘要 + ts 锚点 + 无事件轮零变化」
FR-02: `frontend/src/components/daemon/trajectory/__tests__/trajectory-redesign.test.tsx`「轮次跳转信号：选中目标轮首行并滚入视野」+ `frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx`「TurnTimeline 透传轨迹跳转信号」
FR-03: `frontend/src/components/daemon/trajectory/__tests__/trajectory-redesign.test.tsx`「选中行变化时账本滚入视野（时间线条块/键盘）」
FR-04: 不适用：类型检查无测试面，`pnpm exec tsc --noEmit` 直接验证退出码；回归面由上述目录全量跑覆盖
