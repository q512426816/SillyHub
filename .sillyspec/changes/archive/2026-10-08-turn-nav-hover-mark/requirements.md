---
author: admin2
created_at: 2026-10-08T03:19:39.993Z
---
# 需求规格（Requirements）— 2026-10-08-turn-nav-hover-mark

## 功能需求

### FR-01: 悬停窄轨刻度展开浮层后，浮层内当前指向的轮次行有可见指向标记（与 activeTurnKey 当前轮高亮视觉区分）

轮次导航浮层展开时，若鼠标正悬浮在窄轨某刻度上，浮层内该刻度对应的轮次行必须渲染可见指向标记；指向标记必须与 activeTurnKey 当前轮高亮（底色 + 左侧 brand 竖线）视觉区分——采用细 ring 描边（`ring-1 ring-inset ring-brand-400`），与底色高亮正交叠加不冲突。

#### 场景：悬停刻度看浮层标记

- Given：≥3 轮会话，轮次导航浮层已展开（悬停防抖或 pin）
- When：鼠标悬浮窄轨第 N 轮刻度（横条）
- Then：浮层内第 N 轮行出现 ring 指向标记，其余行无该标记

#### 场景：指向行与当前轮同行

- Given：activeTurnKey 指向第 1 轮（行有底色高亮 + aria-current）
- When：鼠标悬浮第 1 轮刻度
- Then：第 1 轮行底色高亮保持，同时叠加 ring 指向标记，两者不互相覆盖

### FR-02: 指向标记随鼠标在刻度间/浮层行间移动实时跟随更新

指向标记必须实时跟随鼠标：鼠标沿窄轨刻度滑动时，标记行随最后进入的刻度切换；鼠标移入浮层某行时，指向同步到该行（浮层行与刻度同为指向源，单一指向态不并存双标记）。

#### 场景：刻度滑动跟随

- Given：浮层展开，鼠标悬浮第 2 轮刻度（第 2 行有标记）
- When：鼠标滑到第 3 轮刻度
- Then：标记从第 2 行移到第 3 行

#### 场景：浮层行同步

- Given：浮层展开，标记在第 2 行（来自刻度悬停）
- When：鼠标移入浮层第 1 行
- Then：标记同步到第 1 行

### FR-03: 浮层内指向行超出可视区时自动滚入（block:nearest，不抢既有 active 联动语义之外的新滚动）

滚动联动必须扩展为指向优先：hoverTurnKey 存在时滚入指向行，清除后回落既有 activeTurnKey 联动（block:nearest，jsdom 无实现时静默跳过）；不引入其它新滚动行为。

#### 场景：长会话指向滚入

- Given：>200 轮长会话浮层展开，指向行在滚动视口外
- When：鼠标悬浮对应刻度
- Then：浮层该行 scrollIntoView(block:"nearest") 滚入可视区

### FR-04: 鼠标移开组件后指向标记清除，既有展开/收起/pin/跳转/aria 行为零回归

鼠标移开组件（250ms 收起防抖到点）后指向标记必须清除；pin 切换、点击组件外部收起、浮层行跳转收起三个既有收起点必须同步清除指向。既有展开/收起防抖、pin 锁定、刻度与行点击跳转、aria-label/aria-current/aria-expanded 行为零回归。

#### 场景：移开清除

- Given：浮层展开且标记在第 2 行
- When：鼠标移出组件根，250ms 防抖到点
- Then：浮层收起，指向态清空（再次展开无残留标记）

### FR-05: turn-nav-list 组件单测覆盖上述新行为且既有用例全绿

组件单测必须覆盖 FR-01～FR-04 各行为（标记渲染与区分、实时跟随、滚入、清除），且既有全部用例保持通过。

#### 场景：测试全绿

- Given：turn-nav-list.test.tsx 含新增用例
- When：vitest run 该测试文件
- Then：新增与既有用例全部通过

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`）

FR-01: test/frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「悬停刻度展开浮层后浮层内指向行有可见指向标记（与 active 高亮区分）」
FR-02: test/frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「指向标记随刻度滑动与浮层行 hover 实时跟随」
FR-03: test/frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「指向行滚入可视区（scrollIntoView block:nearest，指向优先回落 active）」
FR-04: test/frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「移开组件防抖到点清指向；收起点同步清除；既有行为零回归」
FR-05: test/frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx「turn-nav-list 既有用例全绿（vitest run 全文件）」
