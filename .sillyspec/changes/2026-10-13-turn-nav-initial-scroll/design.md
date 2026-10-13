---
author: flow-machine-draft
created_at: 2026-10-13T06:43:06.704Z
---
# 设计记录（Design Record）— 2026-10-13-turn-nav-initial-scroll

## 做法概述

上一变更（2026-10-13-turn-nav-rail-overflow-fix）让窄轨轨内滚动真正生效后暴露 P3 留债：长会话首屏轨道 scrollTop 停在顶部，当前轮（最新）刻度沉在可视区外。根因是滚动联动 effect 的 mountedRef 守卫「首次渲染不滚」——这是 2026-09-08-session-turn-nav（design §5）TurnCatalog 刻度居中形态时代的决策（当时轨道满铺居中、无滚动，首渲滚动无意义），窄轨+轨内滚动形态下语义反转：首渲恰恰最需要对齐 active。

修复为删除 mountedRef 守卫（turn-nav-list.tsx 滚动联动 useEffect），让 effect 首挂载即执行：focusKey = hoverTurnKey ?? activeTurnKey，命中 [data-turn-key] 的窄轨刻度 scrollIntoView({ block: "nearest" })；activeTurnKey 为 null 时 focusKey 为空自然短路不滚。选此方案因为改动最小（删 5 行守卫）、与既有变化联动共用同一条 effect 路径（无双机制）、block:"nearest" 保证短会话（刻度本就全可见）零滚动位移。旧组件 turn-catalog.tsx（未挂载、仅回退保留）的「首渲不滚」语义不动。

## 接口契约

无对外签名/端点/命令/文件格式变化。组件内部行为变更一处：`TurnNavList` 首挂载时若 activeTurnKey 非空，窄轨刻度立即 scrollIntoView({ block: "nearest" })（原行为：首渲不滚）；props（`TurnNavListProps`）、testid、aria 语义、浮层行为、变化联动均不变。消费方 `session-panel-page.tsx:4960` 零改动。

### 文件变更清单（自声明）

- frontend/src/components/sessions/turn-nav-list.tsx（交付：删 mountedRef 守卫 + 注释更新）
- frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx（交付：「首渲不滚」断言更新为首挂载即滚 + 新增 null 不滚边界用例）

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：成立——滚动联动是纯本地视觉态，entries 由父层派生传入；会话切换（key 重挂载）后首挂载滚动按新会话 active 执行，无跨会话时序依赖；父层跳转翻页期间的 suppressFollowBottom 作用于聊天区贴底跟随，与窄轨自身 scrollIntoView 不冲突。
2. 并发写：不适用——组件内单 effect 读写自身 DOM 滚动位置，无共享可变状态。
3. 切换/生命周期：安全——useEffect 在 commit 后执行（rootRef 已挂载）；scrollIntoView({ block: "nearest" }) 对已完全可见元素无操作（短会话零位移）；组件卸载后 effect 清理照旧（本 effect 无副作用订阅）。
4. 作用域：无串台面——改动仅在 desktop 会话面板组件内部；mobile Drawer 形态不挂本组件；无跨工作区数据。

## 风险与死路

最大风险：首挂载滚动在 flex 布局完成前执行的时序疑虑——useEffect 运行于 DOM commit 后，读取滚动几何会强制同步布局，且窄轨刻度高度固定（h-2.5/h-1.5）不受 markdown 异步撑高等影响，位置首挂载即最终位置，无竞态；jsdom 层以 scrollIntoView stub 断言调用事实（真实滚动行为由浏览器 block:"nearest" 标准语义担保）。

放弃的方案：① 首挂载改用 requestAnimationFrame 延帧滚动——刻度位置无异步依赖，延帧只增加闪跳窗口，无收益；② 在父层（session-panel-page）打开会话时显式触发滚轨——把组件内视觉态外泄到挂载方，破坏「受控纯组件、props 进回调出」契约（turn-catalog 先例约束）；③ 保留 mountedRef 但首渲用 useLayoutEffect 单独滚——双路径冗余，与既有 effect 维护同一语义却分两处，后续改联动易漏同步。
