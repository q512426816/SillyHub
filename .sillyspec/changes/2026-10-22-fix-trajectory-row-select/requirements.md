---
author: flow-machine-draft
created_at: 2026-10-22T01:21:47.535Z
---
# 需求规格（Requirements）— 2026-10-22-fix-trajectory-row-select

> 背景：2026-10-22-session-trajectory-view 把 `TrajectoryView` 接进会话页「进度」视图时，漏传了
> 受控选中 props（`selectedRowId` / `onSelectRow`）；这两个 prop 是可选的，点击回调用 `?.` 空转，
> 账本行点击、时间轴条目点击、键盘切换全部静默失效。dev 预览页（`trajectory-proto-view.tsx`）
> 传了这两个 props，可作参考实现。

## 功能需求

### FR-01: 「进度」→「轨迹」下点击任意账本行，该行进入选中态（aria-selected=true）且右侧检查器显示该行详情（输入/输出/元数据）

- 会话页「进度」视图切到「轨迹」呈现时，`TrajectoryPane` **必须**以受控状态接入 `TrajectoryView`（传 `selectedRowId` + `onSelectRow`）；点击任意账本行后该行 **必须** 置 `aria-selected="true"`，右侧检查器 **必须** 渲染该行的元数据与输入/输出内容（不再停留在「选中一行查看输入 / 输出」空提示）。

#### 场景：主路径

Given 会话页「进度」视图已切到「轨迹」且有可绘制行；When 点击账本第一行；Then 该行 `aria-selected="true"`，检查器出现该行的「输入」「输出」节（无正文的行显示「无正文」）。

### FR-02: 点击三泳道时间轴上的条目同样选中对应账本行（timeline 的 onSelectRow 已支持）

- 点击三泳道时间轴上的任意条目（`data-testid="trajectory-bar"`）时，轨迹面板 **必须** 把该条目对应的账本行设为选中（同一 `selectedRowId`），且该账本行 **必须** 带有选中态。

#### 场景：主路径

Given 轨迹面板已渲染三泳道条目；When 点击其中一根条目；Then 其 `data-row-id` 指向的账本行 `aria-selected="true"`，该条目 `aria-pressed="true"`。

### FR-03: 选中行可用 ↑/↓ 切换、Esc 清除

- 轨迹账本获得焦点时，按 `↓` / `↑` **必须** 在账本行之间移动选中（未选中时 `↓` 选首行、`↑` 选末行；到达两端 **必须** 夹紧不越界）；按 `Esc` **必须** 清空选中并回落空提示。

#### 场景：主路径

Given 已选中账本第 2 行；When 按 `↓`；Then 第 3 行选中、第 2 行取消；When 按 `Esc`；Then 无行处于选中态且检查器回到空提示。

### FR-04: 新增轨迹选中交互用例通过，既有 turn-timeline 轨迹用例零回归

- 本变更新增的轨迹选中交互用例 **必须** 全绿，且 `turn-timeline-trajectory-view.test.tsx` 既有用例与 `trajectory/__tests__` 目录既有单测 **必须** 零回归（禁止修改既有断言来「通过」）。

#### 场景：主路径

Given 变更落盘；When 跑 `frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx` 与 `frontend/src/components/daemon/trajectory/__tests__`；Then 全部用例通过。

### FR-05: 相关目录 tsc --noEmit 退出 0

- 变更后 `frontend` 的 `tsc --noEmit` **必须** 退出 0，不新增类型错误。

#### 场景：主路径

Given 变更落盘；When 在 `frontend` 跑 `pnpm exec tsc --noEmit`；Then 退出码为 0。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: `frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx`「点击账本行 → 选中态 + 右侧检查器显示行详情」
FR-02: `frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx`「点击时间轴条目 → 对应账本行选中」
FR-03: `frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx`「↑/↓ 切换选中、Esc 清除」
FR-04: `frontend/src/components/daemon/__tests__/turn-timeline-trajectory-view.test.tsx`（新增 3 例 + 既有 5 例）+ `frontend/src/components/daemon/trajectory/__tests__`（既有全绿）
FR-05: 不适用：类型检查无测试面，`pnpm exec tsc --noEmit` 直接验证退出码
