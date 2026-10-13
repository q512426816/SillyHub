---
author: flow-machine-draft
created_at: 2026-10-13T06:43:06.704Z
---
# 需求规格（Requirements）— 2026-10-13-turn-nav-initial-scroll

## 功能需求

### FR-01: 首挂载带 activeTurnKey 时窄轨刻度立即 scrollIntoView(block:nearest) 对齐当前轮

- 会话页打开（组件首挂载）且 activeTurnKey 非空时，窄轨必须立即把命中 activeTurnKey 的刻度 scrollIntoView({ block: "nearest" }) 滚入轨内可视区——长会话打开即见当前轮高亮，不得停留在轨道顶部让当前轮刻度沉在可视区外。

#### 场景：主路径

Given 53 轮长会话、activeTurnKey=最新轮 / When 打开会话页桌面面板（窄轨首挂载） / Then 当前轮刻度被滚入轨内可视区（scrollIntoView 调用 1 次、参数 block:"nearest"、命中元素为该轮刻度 button）。

### FR-02: activeTurnKey 为 null(无活跃轮)首挂载不滚

- 首挂载时 activeTurnKey 为 null（无活跃轮/空轮次）必须不触发任何 scrollIntoView 调用。

#### 场景：主路径

Given 3 轮短会话、activeTurnKey=null / When 组件首挂载 / Then scrollIntoView 零调用。

### FR-03: active 变化/hover 指向/浮层展开的既有滚动联动语义不变

- 既有联动语义必须保持：activeTurnKey 变化时命中刻度（及展开浮层中的行）scrollIntoView({ block: "nearest" })；hoverTurnKey 指向优先（指向存在时滚指向行，清除后回落 active）；expanded 变化（悬停展开/pin）补滚一次把浮层内指向行滚入。

#### 场景：主路径

Given 指向第 3 轮刻度触发展开浮层 / When 指向行与 active 行切换 / Then 刻度与浮层行两元素均按指向优先/回落 active 语义滚入（与 2026-10-08-turn-nav-hover-mark 时代行为一致）。

### FR-04: 既有「首渲不滚」测试断言按新行为更新(行为有意变更,非为绿改测试),turn-nav-list 全绿

- 「首渲不滚」断言（2026-09-08 TurnCatalog 居中形态时代决策）必须随行为有意变更更新为新语义断言（首挂载即滚 + null 不滚边界），且 turn-nav-list 测试文件全部用例保持通过。

#### 场景：主路径

Given 更新后的实现与测试 / When 运行 `pnpm vitest run src/components/sessions/__tests__/turn-nav-list.test.tsx` / Then 24/24 通过（含更新后的首挂载滚动断言与新增 null 边界用例）。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「activeTurnKey 命中刻度/行 aria-current=true；首挂载即滚对齐当前轮，变化时轨内 scrollIntoView（block:nearest）」
FR-02: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「首挂载 activeTurnKey=null 不滚（无活跃轮无对齐目标）」
FR-03: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「指向行滚入可视区（指向优先 scrollIntoView block:nearest）；指向清除后回落 active 联动」+「移开组件 250ms 到点清指向」等既有联动用例
FR-04: frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx 全文件 24 用例
