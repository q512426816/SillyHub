---
author: flow-machine-draft
created_at: 2026-10-22T01:23:58.655Z
---
# 需求规格（Requirements）— 2026-10-22-session-trajectory-third-view

> 背景与裁决：2026-10-22-session-trajectory-view（D-035）曾把轨迹定为「进度」视图内的呈现方式、不新增第三视图。
> 用户 2026-10-22 明确裁决改为**顶层三态**：轨迹与「对话 / 进度」同层并列（见本变更 decisions D-001）。
> 同时并入原 2026-10-22-fix-trajectory-row-select 的缺陷修复：产品页 `TrajectoryPane` 漏传
> `selectedRowId` / `onSelectRow` 导致轨迹面板点击无反应。

## 功能需求

### FR-01: 会话面板视图切换为三态：对话 / 进度 / 轨迹，轨迹与另外两态同层并列

- 会话面板的视图切换控件 **必须** 渲染三枚 tab（文案「对话」「进度」「轨迹」，同一 `role="tablist"`），`SessionViewMode` **必须** 扩展为 `"conversation" | "all" | "trajectory"`；三态 **必须** 共用同一 `viewMode` 状态与切换回调，轨迹 **禁止** 嵌套在「进度」视图内部。切换控件 **必须** 抽为单一共享组件，由弹窗版与整页版复用，禁止各写一份。

#### 场景：主路径

Given 一个有历史轮的会话；When 查看顶部视图切换；Then 三枚 tab「对话 / 进度 / 轨迹」同层并列、默认选中「对话」；When 点「轨迹」；Then `viewMode === "trajectory"` 且轨迹面板出现。

#### 场景：旧会话默认值

Given localStorage 无本会话的视图记录；When 打开会话；Then 默认「对话」，与现状一致。

### FR-02: 「进度」视图恢复纯时间线，不再出现「时间线 / 轨迹」第二层开关

- 选择「进度」（`viewMode === "all"`）时 **必须** 只渲染原有轮块时间线与汇总，**禁止** 出现 `data-testid="progress-lens"`、「进度视图呈现方式」tablist 或任何「时间线 / 轨迹」第二层开关。

#### 场景：主路径

Given 有历史轮的会话；When 切到「进度」；Then 轮块（`data-testid="turn-block"`）照常渲染，页面中不存在 `progress-lens`。

### FR-03: 选择「轨迹」直接渲染三泳道面板，点击账本行或时间轴条目可选中并在右侧检查器看输入/输出，↑/↓ 切换、Esc 清除

- 选择「轨迹」（`viewMode === "trajectory"`）时 **必须** 直接渲染三泳道轨迹面板（`data-testid="trajectory-pane"`，恰 3 个泳道标签），轮块列表 **禁止** 同时渲染；`TrajectoryPane` **必须** 以受控状态接入 `TrajectoryView`（传 `selectedRowId` + `onSelectRow`）。点击任意账本行或时间轴条目后，对应账本行 **必须** 置 `aria-selected="true"`，右侧检查器 **必须** 显示该行元数据与输入/输出；账本获得焦点时 `↑` / `↓` **必须** 切换选中（两端夹紧），`Esc` **必须** 清空选中。

#### 场景：主路径

Given 切到「轨迹」且存在可绘制行；When 点击账本第一行；Then 该行 `aria-selected="true"` 且检查器出现「输入 / 输出」节；When 点时间轴上一根条目；Then 其 `data-row-id` 对应行选中；When 按 `↓`；Then 选中移动到下一行；When 按 `Esc`；Then 无行选中、检查器回落空提示。

### FR-04: 无可绘制时序时轨迹视图仍显示显式空态提示，不白屏不伪造

- 「轨迹」视图下若整段会话没有任何可用时间锚点，**必须** 渲染显式空态（`data-testid="trajectory-empty"`），**禁止** 白屏、**禁止** 用当前时刻或 0 伪造条。

#### 场景：主路径

Given 轮视图缺时间戳且无段；When 切到「轨迹」；Then 出现「没有可绘制的时间数据」提示，且不出现三泳道面板与轮块。

### FR-05: 视图选择按会话持久化，「轨迹」刷新后仍保持

- `readPersistedViewMode` / `writePersistedViewMode` **必须** 支持 `"trajectory"`：写入后刷新 **必须** 恢复「轨迹」；旧值 `"conversation"` / `"all"` **必须** 保持原义，非法值/缺失/SSR 无 window **必须** 回落 `"conversation"`。

#### 场景：主路径

Given 某会话当前为「轨迹」；When 刷新页面；Then 视图仍为「轨迹」。

#### 场景：旧值兼容

Given localStorage 存的是 `"all"`；When 打开会话；Then 视图为「进度」；存的是无法识别的值时回落「对话」。

### FR-06: 弹窗版、整页版、移动版三处会话面板行为一致

- 弹窗版（`session-panel-dialog`）、整页版（`session-panel-page`）与移动版（同一 page 的 `variant="mobile"`）**必须** 都渲染同一个三态切换组件并共享同一 `viewMode` 语义；`SessionPanel` 的受控 props `viewMode` / `onViewModeChange` 类型 **必须** 同步扩展为三态。回放视图（`agent-replay-body`）**必须** 保持原有「对话 / 全部」两态行为不变。

#### 场景：主路径

Given 移动端打开会话；When 查看视图切换；Then 同样出现三枚 tab；When 点「轨迹」；Then 与桌面一致直接渲染轨迹面板。

### FR-07: 新增/更新用例全绿，既有会话面板、轨迹、回放相关用例零回归且不改既有断言

- 新增的三态切换、轨迹选中、持久化用例 **必须** 全绿；既有断言 **禁止** 被放宽或删除来「通过」，与三态语义直接冲突的旧用例（如「进度内出现 progress-lens」「对话视图不出现轨迹开关」）**必须** 按新需求改写标题与断言而非删除覆盖。

#### 场景：主路径

Given 变更落盘；When 跑会话面板、轨迹、回放相关测试；Then 全部通过且无跳过的既有断言。

### FR-08: frontend tsc --noEmit 退出 0

- 变更后 `frontend` 的 `tsc --noEmit` **必须** 退出 0，不新增类型错误（三态类型扩展引发的穷举分支必须同步收口）。

#### 场景：主路径

Given 变更落盘；When 在 `frontend` 跑 `pnpm exec tsc --noEmit`；Then 退出码为 0。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: `frontend/src/components/daemon/session-panel/__tests__/session-view-tabs.test.tsx`「三态并列：对话 / 进度 / 轨迹，点击回调当前值」+「默认选中对话」
FR-02: `frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx`「进度视图纯时间线：轮块照常、无 progress-lens」
FR-03: `frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx`「轨迹视图直接出三泳道面板、轮块让位」+「点击账本行 → 选中态 + 检查器详情」+「点击时间轴条目 → 对应行选中」+「↑/↓ 切换、Esc 清除」
FR-04: `frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx`「无时间锚点 → 轨迹视图显式空态」
FR-05: `frontend/src/components/daemon/session-panel/__tests__/view-mode-persist.test.ts`「写入轨迹后回读为 trajectory」+「all/conversation 旧值原义」+「非法值/缺失回落 conversation」
FR-06: `frontend/src/components/daemon/session-panel/__tests__/session-view-tabs.test.tsx`（共享组件三态）+ `frontend/src/components/daemon/__tests__/session-panel-variant.test.tsx`「移动 variant 头部同款三态 tablist」
FR-07: `frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx`（全部用例）+ `frontend/src/components/daemon/session-panel/__tests__/` + `frontend/src/components/daemon/__tests__/` 会话面板/回放相关用例（零回归）
FR-08: 不适用：类型检查无测试面，`pnpm exec tsc --noEmit` 直接验证退出码
