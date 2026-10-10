---
author: flow-machine-draft
created_at: 2026-10-10T00:49:23.984Z
---
# 设计记录（Design Record）— 2026-10-10-att-ref-badge-hover

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

问题：编辑态引用标签的 × 角标常显，视觉噪音大；用户要求悬停标签才显示。

关键约束：镜像高亮层位于 textarea **下方**（z 序），标签文字区域被 textarea 覆盖，纯 CSS `:hover` 在 span 上永不触发（指针事件被 textarea 截获），也不能给 span 开 pointer-events（会挡住下方 textarea 的光标定位/选字）。

方案：**宿主 wrapper 级 pointermove 命中测试**。

附带修复（用户实测 2026-10-10）：token 占位 span 的 mx-px 外边距是多标签场景背景错位的根因（每标签多 2px 累积漂移，overlay 与 textarea 逐字符失配）——已移除并立守卫用例：占位 span 禁带 margin/padding 布局类，背景块只用 background+radius 零布局影响。InputRefOverlay 的每个 token 占位 span 带 `data-att-ref-occ`（出现序号）；新增导出 `hitTestAttRefOverlay(container, x, y)`——遍历这些 span 的 getBoundingClientRect（外扩 8px，覆盖右上角外挂的角标区），返回命中序号或 null。宿主（session-input-bar / group-chat-panel）在 overlay+textarea 的共同 wrapper 上挂 `onPointerMove`（React 合成事件从 textarea 冒泡到 wrapper）调 hitTest 写 `hoveredRefOcc` state，`onPointerLeave` 清空；`hoveredRefOcc` 经新 prop `visibleBadgeIndex` 传回 overlay——只有命中的角标 `opacity-100 + pointer-events-auto`，其余 `opacity-0 + pointer-events-none`（隐藏态不吃点击）。指针移到角标本体上时：外扩 8px 的命中区仍覆盖角标位置，状态不闪灭，可正常点击。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

不动后端/存储。前端组件新增可选 prop 与导出（全部向后兼容）：

- `InputRefOverlay` 新增 `visibleBadgeIndex?: number | null`（缺省 undefined = 全部隐藏）与 `containerRef?: React.Ref<HTMLDivElement>`；既有 props 不变。
- 新增导出纯函数 `hitTestAttRefOverlay(container: HTMLElement | null, x: number, y: number): number | null`。
- 两宿主各加 `hoveredRefOcc` state 与 wrapper onPointerMove/onPointerLeave。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

pointermove 高频触发——hitTest 为 O(span 数) 线性遍历（标签数≤10 上限），setState 同值 bail-out 截断多余渲染；无乱序面。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

纯 UI 状态（hoveredRefOcc），单组件内读写，无并发面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

value 编辑导致出现序号偏移时 hoveredRefOcc 可能瞬时指错——下一次 pointermove 立即纠正；onPointerLeave/组件卸载清空，无泄漏。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

纯组件本地状态，无跨会话/跨工作区面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：角标显示后指针移向角标本体——离开 span 原始矩形瞬间若命中测试失败会闪灭循环。缓解：命中矩形外扩 8px 覆盖角标外挂区（-right-1.5 -top-1 = 6px）。放弃的方案：①纯 CSS group-hover——span 被 textarea 覆盖，:hover 永不触发（可行性死路）；②给 span 开 pointer-events-auto——挡住下方 textarea 的点击/选字，违反 FR-02；③mousemove 监听 textarea——指针移到角标（sibling）后事件不再冒泡到 textarea，同样闪灭。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/input-ref-overlay.tsx | 角标可见性受控（visibleBadgeIndex/containerRef）+ hitTestAttRefOverlay 导出 |
| 修改 | frontend/src/components/daemon/session-input-bar.tsx | hoveredRefOcc state + wrapper pointermove/leave + 传参 |
| 修改 | frontend/src/components/group-chat/group-chat-panel.tsx | 同款 |
| 修改 | frontend/src/components/daemon/__tests__/input-ref-overlay.test.tsx | 可见性/命中测试新用例 |
