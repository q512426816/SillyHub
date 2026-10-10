---
author: flow-machine-draft
created_at: 2026-10-10T09:06:23.767Z
---
# 设计记录（Design Record）— 2026-10-10-single-turn-nav-and-jump-head

## 做法概述

线上实证（会话 47e2ff1a，单 run 6969 行活跃流）：左侧轮次导航 `MIN_ENTRIES=3` 把单轮会话整条隐藏；触顶「加载更早」每页 400 行 + prepend 锚定钉回原视口，慢服务器（2C，接口 1s+）上体感为「滚动不了、一直刷新、还是最后这点」，且面板重开进度归零（24h 内重开 19 次）。本变更两点：

1. **阈值放宽**：`turn-nav-list.tsx` 与 `turn-catalog.tsx` 的隐藏阈值 3 → 1（空数组仍不渲染），单轮会话显示「第1轮」导航，点击走既有 `onJump`/`handleJumpToTurn`。
2. **回到会话开头**：时间线顶部（`renderHistoryAndLocalReport` 位置）新增「回到会话开头」入口（仅 `hasEarlier=true` 渲染），点击后以 interval 轮询循环（40ms，对齐 `fallbackLoop` 惯例——纯 async/await 循环在生产环境有冻结前科 ql-20260916-014）连续驱动既有 `loadEarlierOnce()` 翻页，直至 `hasEarlierRef=false`（到头）或 50 页上限（toast 提示可再点）；到头后清 prepend 滚动锚（`pendingAnchorRef`/`anchorPinRef`，防 300ms 重申钉回）并双 rAF 后 `scrollTo(0)` 定位到最早内容。不选「修触顶手感/虚拟化」——无浏览器复现条件下动高测试密度滚动机制回归风险大，留给确证后的后续变更。

## 接口契约

- `TurnNavList`/`TurnCatalog`：`entries` props 契约不变，仅渲染门槛行为变化（<1 隐藏，原 <3）。
- `renderHistoryAndLocalReport(o)`（page-helpers.tsx）：新增 3 个可选 props `hasEarlier?: boolean`、`jumpHeadLoading?: boolean`、`onJumpToHead?: () => void`——缺省不渲染新入口，既有调用面零影响。
- `session-panel-page.tsx` 新增内部回调 `handleJumpToHead`（不导出）；`jumpHeadLoading` state 随 `sessionId` 切换复位（attach effect 重置段）。
- 后端零改动（翻页 API `/logs?before=&before_id=` 原样复用）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/sessions/turn-nav-list.tsx | MIN_ENTRIES 3→1 + 注释更新 |
| 修改 | frontend/src/components/sessions/turn-catalog.tsx | 隐藏阈值 3→1 同口径 + 注释更新 |
| 修改 | frontend/src/components/daemon/session-panel/page-helpers.tsx | renderHistoryAndLocalReport 增「回到会话开头」入口（props + 渲染） |
| 修改 | frontend/src/components/daemon/session-panel/session-panel-page.tsx | handleJumpToHead 循环 + jumpHeadLoading state + 复位 + 接线 |
| 修改 | frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx | 新增 1 条渲染/0 条隐藏用例 |
| 修改 | frontend/src/components/sessions/__tests__/turn-catalog.test.tsx | 隐藏阈值用例改写（0 隐藏/1 起出现） |
| 修改 | frontend/src/components/daemon/__tests__/session-history-scroll.test.tsx | 新增回到开头两条用例 |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. **乱序/迟到到达**：连续翻页串行推进（interval tick 见 `historyLoadingRef` 在途即跳过本轮），游标单调递减由 `loadEarlierOnce` 的「游标任一分量前进」返回值保证；乱序到达的旧响应经纪元校验（`sessionEpochRef`）丢弃，不 prepend。循环仅认 `hasEarlierRef` 镜像（await 间隙不读过期 state）。
2. **并发写**：入口点击有 `jumpHeadInflightRef` 同步锁防重入；循环期间 `jumpSuppressLoadEarlierRef=true` 抑制触顶自动加载竞争（既有 R-02 机制）；用户同时手动触顶被 suppress 挡下；`handleLoadEarlier` 自身 `historyLoadingRef` 锁防双发。
3. **切换/生命周期**：换会话时 attach effect 重置段新增 `setJumpHeadLoading(false)` + inflight ref 复位 + epoch 校验让在途 `loadEarlierOnce` 空转（游标不动 → 循环判 false 退出）；卸载由 `mountedRef` 守卫（interval tick 首查）；suppress 在 stop() 的所有出口复位，不残留。
4. **作用域**：全部状态（`jumpHeadLoading`/refs/游标）为组件实例私有、随 `sessionId` 重建；无跨工作区/跨会话共享面；后端无改动，无多实例串台面。

## 风险与死路

- 最大风险：50 页上限内连续 prepend 大量 DOM（巨型会话全量加载），低配端渲染压力——已有 `content-visibility` 与 50 页上限兜底，且为用户显式点击触发（非自动）；toast 明示可续。
- 放弃方案 A「修触顶手感（阈值/锚定参数调优）」：无浏览器复现定位精确体感根因，动高测试密度滚动机制（触顶/锚定/贴底三方交互）回归面大；放弃方案 B「列表虚拟化」：属大改，超出轻量变更范围。
- 已知残留：滚动体感问题本身未根治（本变更提供绕开路径）；用户侧验证待部署后确认。
