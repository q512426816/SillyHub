---
author: flow-machine-draft
created_at: 2026-10-13T06:32:14.177Z
---
# 设计记录（Design Record）— 2026-10-13-turn-nav-rail-overflow-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

根因是窄轨 flex 钳制链断裂：desktop 挂载行（`session-panel-page.tsx` 外层 `flex min-h-0 flex-1`，行高=面板剩余高度）→ root `turn-nav-column` 交叉轴 stretch 高度=行高，但中间层 `turn-nav-rail` 带 `shrink-0` 且高度 basis auto——轮次内容总高（把手 36px + N×11px）超过面板高时轨道拒绝收缩、直接溢出 root（root 无 overflow 裁切），刻度叠到输入区/底部配置条上；nav 的 `flex-1 min-h-0 overflow-y-auto` 因 rail 高度恒等于内容高度而拿不到高度钳制，轨内滚动永不生效。

修复取最小改动：`turn-nav-rail` 去掉 `shrink-0`（保留 `min-h-0`），让 rail 可收缩到面板高、nav `flex-1+overflow-y-auto` 真正生效，超出轮次轨内滚动；nav 补 `[scrollbar-width:none] [&::-webkit-scrollbar]:hidden`（与 turn-catalog.tsx:226 同款）避免 Windows 露滚动条。选此方案因为与既有工作先例 turn-catalog（nav 直接被 stretch 行钳制）机制等价，两处 className 改动、少量轮次 flex-basis auto 形态零变化。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无对外签名/端点/命令/文件格式变化。纯 `frontend/src/components/sessions/turn-nav-list.tsx` 组件内部布局类名调整（`turn-nav-rail` 去 `shrink-0`、`turn-nav-rail-ticks` 追加滚动条隐藏类）；组件 props（`TurnNavListProps`）、testid、aria 语义、浮层行为均不变，desktop 会话页唯一挂载点 `session-panel-page.tsx:4960` 零改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：不适用——纯静态布局类名调整，不涉事件/输入顺序；entries 增删（翻页 prepend、新轮 append）只影响刻度数量，钳制行为与顺序无关。
2. 并发写：不适用——组件无共享可变态，`hoverOpen/pinned/hoverTurnKey` 均为组件内 useState，无跨执行体写面。
3. 切换/生命周期：安全——会话切换（key 重挂载）后 rail 按新 entries 重排，钳制是纯 CSS 派生无持久状态；轨内 scrollTop 随重挂载归顶，与既有「active 变化才 scrollIntoView」语义一致（首挂载不滚是既有行为，未扩范围）。
4. 作用域：无串台面——改动仅在 desktop 会话面板组件内部；mobile 分支不挂 TurnNavList（Drawer 形态），悬浮窗 host（不传 variant）自动同构受益，无跨工作区数据。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：jsdom 无法断真实 flex 布局，契约测试只能断 className（若未来有人改回 shrink-0 而同时改 testid/类名结构，断言可能失守）——已用 `data-testid="turn-nav-rail"` 命中容器并把「无 shrink-0 + min-h-0」写成显式用例降低静默回归概率；真实视觉验收（50+ 轮会话）留人工确认项记入 visual-evidence.md。

放弃的方案：① 沿用 turn-catalog 结构把 nav 直接提为行的 stretch 子项——需重排把手/浮层 DOM 层级，改动面大于收益；② 提高密集阈值或按容器高度自适应刻度尺寸——只缓解不治本（溢出仍在），且引入测量逻辑复杂度；③ root 加 overflow-hidden 裁切——会连把手/浮层一起裁，且不可滚动更差。
