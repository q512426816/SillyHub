---
author: flow-machine-draft
created_at: 2026-10-15T02:08:56.580Z
---
# 需求规格（Requirements）— 2026-10-14-session-bottom-grace-window

## 功能需求

### FR-01: RO 钉底条件扩为 isNearBottomRef ||（距最近贴底 <10s 且无用户输入）——加载期 near 被误清后宽限窗内自动钉底

- 必须：贴底记忆宽限窗——距最近一次成功贴底 <10s 且用户无真实滚动输入（wheel/touchstart/pointerdown/keydown 四类，程序性滚动不产生）期间，内容任何高度变化（RO）与 turns 提交（[turns] effect）都强制钉底；初始挂载视为在窗内（冷加载全程受保护）。

#### 场景：主路径

（场景已并入行为句；主场景：加载期贴底判定被误清 → 宽限窗内内容变化自动钉底复活）

### FR-02: 用户真实滚动（滚轮/触摸/拖动）立即恢复既有让权语义（near=false 后不强拉）

- 必须：用户真实滚动输入（含键盘 PgUp/方向键）立即置接管标记终止宽限窗——回既有让权语义（上滚读历史不被拉回）。

#### 场景：主路径

（场景已并入行为句；主场景：加载期贴底判定被误清 → 宽限窗内内容变化自动钉底复活）

### FR-03: 挂载即视为在窗内（初始加载全程受保护），超过 10s 或用户输入后回到既有语义

- 必须：宽限窗不穿透既有守卫——isPrepend 早退+3s 静默窗（翻页）、suppressFollowBottom（跳转）、selecting（选中文字）原样优先。

#### 场景：主路径

（场景已并入行为句；主场景：加载期贴底判定被误清 → 宽限窗内内容变化自动钉底复活）

### FR-04: 既有测试面复跑绿 + tsc 0

- 必须：每次真实贴底（delta<80）与宽限窗钉底刷新记忆时间戳（连续保护流式期）。

#### 场景：主路径

（场景已并入行为句；主场景：加载期贴底判定被误清 → 宽限窗内内容变化自动钉底复活）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/turn-timeline.tsx（inBottomGraceWindow + RO/[turns] effect 双接线代码锚）
FR-02: frontend/src/components/daemon/__tests__/turn-timeline-scroll.test.tsx「用户上滚读历史后，流式更新不再强制拉回底部」等 3 用例（补 wheel 输入后全绿——让权语义锁定）
FR-03: frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx（翻页/静默窗用例全绿）
FR-04: frontend/src/components/daemon/turn-timeline.tsx handleScroll near 分支 + RO rAF 回调（时间戳刷新代码锚）
