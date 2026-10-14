---
author: flow-machine-draft
created_at: 2026-10-14T07:50:47.367Z
---
# 需求规格（Requirements）— 2026-10-14-session-bottom-switch-remount

## 功能需求

### FR-01: TurnTimeline 挂载点带 key=会话标识——切换会话时组件重挂载，全部滚动判定/基线/状态归零（初始贴底语义恢复）

- 必须：TurnTimeline 生产挂载点（page/dialog 两处）携带 key=会话标识——切换会话时组件强制重挂载，全部滚动判定 refs（isNearBottomRef/scrollBaselineRef/lastSigRef/firstTurnKeyRef 等）与内部 state 归零，恢复初始贴底语义；禁止跨会话残留滚动状态。

#### 场景：主路径

（场景已并入各 FR 行为句；主场景：会话 A 上滚读历史 → 列表点击切换会话 B → 视口落底）

### FR-02: 整页加载路径行为不变（重挂载对冷加载无差异）

- 必须：整页加载路径行为不变——重挂载对冷加载无差异（初次挂载本就是全新 refs）。

#### 场景：主路径

（场景已并入各 FR 行为句；主场景：会话 A 上滚读历史 → 列表点击切换会话 B → 视口落底）

### FR-03: 切换会话后落底：上滚会话 A → 切换到长会话 → 落底（真浏览器实测 3/3）

- 必须：切换会话后落底——上一会话上滚读历史（贴底判定 false）→ 切换到长会话 → 视口落底（导航 active=末轮），真浏览器实测 3/3。

#### 场景：主路径

（场景已并入各 FR 行为句；主场景：会话 A 上滚读历史 → 列表点击切换会话 B → 视口落底）

### FR-04: 既有测试面复跑绿 + tsc 0

- 禁止：key 化引发既有行为回归——钉回锚定/翻页/跳转/dialog 展开等既有测试面全部复跑通过（时序敏感型偶发用例单跑复核为准）。

#### 场景：主路径

（场景已并入各 FR 行为句；主场景：会话 A 上滚读历史 → 列表点击切换会话 B → 视口落底）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/session-panel/session-panel-page.tsx + session-panel-dialog.tsx（key 接线，代码锚点；agent-replay-body 单会话回放场景不 key 化）
FR-02: src/components/daemon/__tests__/turn-timeline-scroll.test.tsx + session-panel-pre-session.test.tsx + session-panel-variant.test.tsx（挂载形态回归全绿）
FR-03: 不适用：jsdom 无法复现 SPA 切换的滚动残留（无真实滚动布局）——真浏览器实测验收（复现脚本序列 + 3/3 落底）
FR-04: frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx（11/11 含钉回 rAF 用例——首轮全量跑 1 例时序偶发，单跑与整文件复跑均绿，与本改动无关二分实证 stash 对照同样路径）
