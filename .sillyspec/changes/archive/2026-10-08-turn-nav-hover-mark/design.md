---
author: admin2
created_at: 2026-10-08T03:19:39.993Z
---
# 设计记录（Design Record）— 2026-10-08-turn-nav-hover-mark

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

问题根因：`TurnNavList`（frontend/src/components/sessions/turn-nav-list.tsx）浮层行高亮只由 `activeTurnKey`（聊天滚动联动当前轮）驱动，鼠标悬浮窄轨刻度（横条）展开浮层后，浮层内没有任何「鼠标正指向哪一轮」的标记——刻度本身不带轮号，用户无法建立横条与浮层行的对应关系。

方案：组件内新增 `hoverTurnKey` 本地 state（纯视觉态，props 契约不动）。窄轨刻度 button 与浮层行 button 均挂 `onMouseEnter` 写入该 key（单一指向源，最后进入者生效）；浮层行渲染命中时加细 ring 描边（`ring-1 ring-inset ring-brand-400` + `data-hovered` 测试锚点）——ring 描边与 active 行的底色高亮（`bg-muted/60` + inset brand 竖线）正交，同行叠加不冲突，语义上「描边=我在指它、底色=聊天当前停在哪轮」。滚动联动 effect 扩为指向优先（`hoverTurnKey ?? activeTurnKey`，`expanded` 进依赖让悬停展开瞬间补滚一次），指向清除后自动回落既有 active 联动。清除点收口在四个既有收起/离开路径：组件 mouseleave 的 250ms 防抖回调、pin 切换、组件外 pointerdown 收起、浮层行跳转收起。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `TurnNavListProps` 不变（entries / activeTurnKey / loadingEarlier / onJump）——消费方 session-panel-page 零改动。
- 无后端 / API / 类型生成变化。
- DOM 面：浮层行新增 `data-hovered="true"` 属性（仅测试锚点，无 aria 语义——hover 是瞬时视觉态，读屏可达性由刻度/行自身的 aria-label 与 aria-current 承担，语义不变）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   鼠标 enter 事件按真实交互时序同步派发，无异步数据参与；React 对同一 tick 内多次 setState 以最后写入为准，指向恒为「最后进入的刻度/行」，假设成立。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   `hoverTurnKey` 是单组件实例的本地 useState，无跨组件共享、无外部存储，不存在并发写面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   会话切换导致 entries 更换时，残留的旧 key 在新列表中无命中行 → 自然无标记，无副作用；组件卸载 state 随之销毁；250ms 收起防抖回调挂在既有 timer 清理链路上（clearTimers 卸载清理），无泄漏 setState。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   纯组件内部 state 不外溢，跨工作区 / 跨会话 / 多实例（page 与 dialog 各自挂载的 TurnNavList）互不串台。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：指向 ring 与浮层行既有 `hover:bg-muted/50` 底色叠加的视觉密度——选择仅 ring 描边不加底色，二者正交叠加不糊（token 均为主题语义阶，随 data-theme 换肤）。放弃方案：①指向行加底色（与 active 行 `bg-muted/60` 底色同型，视觉冲突辨识度差）；②刻度上挂原生 title/tooltip 显示轮号（>60 轮密集态刻度仅 6px 高命中差，且不满足「浮层卡片标记指向轮」的需求本体）；③浮层行高亮直接复用 active 同款样式（「我在指」与「聊天停在哪」两语义混同，正是本 bug 的认知混淆点）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/sessions/turn-nav-list.tsx | hoverTurnKey state + 刻度/行 onMouseEnter + 浮层行 ring 指向标记 + 滚动联动指向优先 + 收起点清指向 |
| 修改 | frontend/src/components/sessions/__tests__/turn-nav-list.test.tsx | 新增 FR-01～04 用例（标记渲染区分 / 实时跟随 / 滚入 / 清除与零回归） |
