---
author: flow-machine-draft
created_at: 2026-10-15T01:27:32.423Z
---
# 需求规格（Requirements）— 2026-10-14-session-bottom-no-restore

## 功能需求

### FR-01: 会话时间线挂载期间 history.scrollRestoration='manual'（禁浏览器恢复），卸载还原 'auto'——刷新后不恢复上次容器滚动位置，由贴底链统一落底

- 必须：会话时间线挂载期间 history.scrollRestoration 置 manual（禁浏览器刷新滚动恢复），卸载还原挂载前值——刷新后禁止恢复上次容器滚动位置，由贴底链统一落底。

#### 场景：主路径

（场景已并入行为句；主场景：上次停留顶部 → 刷新 → 落底 delta=0）

### FR-02: 刷新（任意上次停留位置）后落底 delta=0（程序性滚顶/滚中后刷新均验证）

- 必须：刷新（任意上次停留位置：贴底/中部/顶部）后落底 delta=0——真浏览器程序性滚顶/滚中后 reload 验证。

#### 场景：主路径

（场景已并入行为句；主场景：上次停留顶部 → 刷新 → 落底 delta=0）

### FR-03: 切换会话/上滚读历史/跳转/翻页既有行为不变

- 禁止：切换会话/上滚读历史/跳转/翻页既有行为变化——仅恢复通道被禁，滚动链其余语义原样。

#### 场景：主路径

（场景已并入行为句；主场景：上次停留顶部 → 刷新 → 落底 delta=0）

### FR-04: 既有测试面复跑绿 + tsc 0

- 必须：无 scrollRestoration API 环境优雅跳过不抛错；卸载还原不影响其它页面刷新体验。

#### 场景：主路径

（场景已并入行为句；主场景：上次停留顶部 → 刷新 → 落底 delta=0）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: frontend/src/components/daemon/turn-timeline.tsx（scrollRestoration effect 代码锚）
FR-02: 真浏览器程序性滚顶/滚中后 reload 实测（部署后取证）
FR-03: frontend/src/components/daemon/__tests__/turn-timeline-scroll.test.tsx + session-history-scroll.test.tsx（上滚/翻页/跳转既有用例全绿）
FR-04: vitest 全套在 jsdom（history.scrollRestoration 不可用/可用两态均不抛错——75 例绿）
