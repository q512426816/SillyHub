---
author: flow-machine-draft
created_at: 2026-10-21T22:49:03.254Z
---
# 需求规格（Requirements）— 2026-10-22-session-trajectory-view

> D-035（用户裁决，覆盖 D-022@v1 的「第三视图」）：**不新增第三个视图模式**。轨迹作为「进度」视图内部的
> 呈现方式开关（时间线 / 轨迹），「对话」「进度」两态与视图枚举逐字不变。

## 功能需求

### FR-01: 「进度」视图内提供「时间线 / 轨迹」呈现方式开关；默认「时间线」＝现状零变化，「对话」视图不出现该开关

- 「进度」视图（`viewMode === "all"`）**MUST** 渲染一个呈现方式开关（`role="tablist"`，`aria-label="进度视图呈现方式"`，两枚 tab 文案「时间线」「轨迹」）；默认选中「时间线」，此时渲染结果 **MUST** 与本变更前逐字一致（同一轮块列表、同一汇总、同一流式尾注）。切到「轨迹」时 **MUST** 改渲染三泳道轨迹面板，且 **MUST NOT** 同时渲染轮块列表（不双画）。「对话」视图（`viewMode === "conversation"`）**MUST NOT** 出现该开关，`SessionViewMode` 取值集合 **MUST** 保持 `"conversation" | "all"` 两态（不新增第三视图、不写第三种持久化值）。

#### 场景：主路径

Given 一个有历史轮的会话；When 切到「进度」并点「轨迹」；Then 出现 `data-testid="trajectory-pane"`（含恰 3 个 `trajectory-lane-label`），`turn-block` 列表让位。

#### 场景：默认与零回归

Given 同一会话；When 切到「进度」（默认「时间线」）；Then `turn-block` 照常渲染且不出现轨迹面板。And When 处于「对话」；Then 页面无「进度视图呈现方式」tablist。

### FR-02: 轨迹数据由当前会话已加载的 SessionTurnView[] 派生（零新增网络请求、零后端改动、零 API 变更）

- 轨迹 **MUST** 只由会话页已加载的轮视图（`SessionTurnView[]`，含段级时间戳）经纯函数派生，**MUST NOT** 新增任何网络请求、后端端点或 API 字段；派生 **MUST** 与 dev 路由共用同一套装配数学（抽出 `assembleTrajectory` 承担窗口 / 覆盖率 / 口径）。

#### 场景：主路径

Given 已加载的轮视图（thinking / tool / text 三类段）；When 派生轨迹；Then 每类段各成对应行（`thinking` / `tool` / `assistant`），工具行保留 `toolName` 与真实起止。

### FR-03: `/runs` 的 `timing` 透传到轮视图：有 TTFT/attempt 采样时模型泳道标「真实占用」，无采样标「近似」，不伪造

- 会话页从 `/runs` 拿到的 `run.timing` **MUST** 经 `enrichDisplayTurns` 补进轮视图的 `timing` 字段（缺省 `null`，不造假数据），轨迹面板据此在模型泳道走 `observed` 口径并把泳道头条文写成「真实占用」；无 `timing` / attempts 不可解析时 **MUST** 走 `approx` 并写「近似」。`timing` 透传 **MUST NOT** 破坏 `enrichDisplayTurns` 的身份稳定守卫（逐字段值等价时仍返回原对象）。

#### 场景：主路径

Given 轮的 `timing.attempts[0]` 起止可解析；When 打开轨迹；Then 泳道头含「真实占用」，模型条区间落在 attempt 起止内。And Given 无 `timing`；Then 泳道头含「近似」。

### FR-04: 无可用时序数据时显示显式空态提示，不白屏、不伪造条

- 当整段会话没有任何可用时间锚点时，轨迹呈现 **MUST** 渲染显式空态提示（`data-testid="trajectory-empty"`），**MUST NOT** 白屏、**MUST NOT** 用当前时刻或 0 伪造条；预览条目（未加载轮）与无锚点的轮 **MUST** 被跳过而不是补值。

#### 场景：主路径

Given 轮视图缺 `turnStartedAt`、缺 `replyAt` 且无段；When 打开「轨迹」；Then 出现空态提示且不出现三泳道面板、不出现轮块。

### FR-05: tsc 退出 0；既有 trajectory 61 / turn-segment-views / turn-time-display / session-list-panel 用例不回归，新增适配器与呈现开关用例全绿

- 本变更 **MUST** 保持 `tsc --noEmit` 退出 0，且既有断言 **MUST NOT** 失效；新增的适配器单测与「进度视图呈现方式」渲染用例 **MUST** 全绿。

#### 场景：主路径

Given 变更落盘；When 跑 `tsc --noEmit` 与 `src/components/daemon` + `src/pages/sessions` + `src/components/chat` 全量；Then 退出 0 且用例全绿。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: `frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx`「进度视图默认「时间线」：轮块照常渲染、不出轨迹面板（现状零变化）」+「点「轨迹」→ 三泳道面板在场、轮块列表让位」+「对话视图不出现「时间线 / 轨迹」开关（两态视图零回归）」
FR-02: `frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts`「段映射：thinking/tool/text 各成一行，toolName 与 tool 状态保留」+「三泳道齐备，且 coverage.modelMs + toolMs ≤ windowMs（不越窗）」+ `frontend/src/components/daemon/trajectory/__tests__/build-trajectory.test.ts`（35 例，抽出 `assembleTrajectory` 后零回归）
FR-03: `frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx`「无 timing 采样 → 模型泳道标「近似」；有 timing → 标「真实占用」」+ `frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts`「轮视图带 /runs timing（attempts 可解析）→ modelBasis=observed（真实占用）」+ `frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx`「活跃轮快照值稳定 → 引用不变（身份稳定守卫不抖动）」+ `frontend/src/components/daemon/__tests__/page-helpers-enrich-api-duration.test.ts`「全字段一致（含 apiDurationMs=12500）→ 返回原对象引用（身份稳定守卫）」
FR-04: `frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx`「无可绘制时序（无时间锚点）→ 显式空态，不白屏、不渲染轮块」+ `frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts`「无任何时间锚点的轮被跳过（不伪造 now / 不补 0）」+「预览条目（未加载轮）不参与轨迹」
FR-05: `frontend/src/components/daemon/trajectory/__tests__/from-turn-views.test.ts`（9 例）+ `frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx`（5 例）+ 回归 `frontend/src/components/daemon`、`frontend/src/pages/sessions`、`frontend/src/components/chat`（109 files / 1535 passed）+ `tsc --noEmit` exit 0
