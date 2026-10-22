---
author: flow-machine-draft
created_at: 2026-10-22T04:04:55.020Z
---
# 设计记录（Design Record）— 2026-10-22-askuser-card-inline

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

turn-timeline.tsx 中 pending AskUser 提问卡容器（`stickyCardsRef` div，行 ~1775）目前以 `sticky top-0 z-10 + border-b border-indigo-300 bg-indigo-50/95 backdrop-blur-sm shadow-sm` 钉在滚动容器顶部悬浮。本次把容器类名改为普通文档流内嵌 `mb-3 space-y-2`（去掉 sticky/z-10/indigo 背景条/backdrop-blur/border-b），卡片随日志内容上下滚动；卡片本体（AskUserDialogCard 的 border bg-card shadow-sm）不变，内嵌后以卡片自身边框呈现。同步项：容器 ref `stickyCardsRef` 更名 `inlineCardsRef`（名实一致），相关注释（容器注释块、决策 pill effect 注释、session-panel-page.tsx 4331 注释中的「sticky 卡」措辞）同步更新；最小化占位逻辑（visiblePendingCount === 0 时 className 为 undefined）零改动。

选此方案原因：用户明确要求「不要悬浮、直接嵌入内容流可滚动」；容器本就渲染在内容流顶部（错误横幅后、轮次前），去掉 sticky 即达成，改动面最小（一处类名 + 命名/注释同步）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无对外接口变化：组件 props、SSE/REST 协议、数据结构零改动。纯展示层 CSS 类名变化——pending 卡容器从 sticky 钉顶视觉条变为文档流内嵌块。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

成立：pending 卡无论经 SSE 实时到达还是 REST 恢复，都渲染在内容流顶部固定位置（错误横幅后、轮次前），渲染位置与到达顺序无关。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

纯前端展示态（React 组件局部 state/ref），无共享数据写面，无并发问题。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全：最小化集合是会话内内存态，挂载占位容器保留 state 的既有设计零改动；提交回答后 permission_resolved 移除卡片的路径零改动；ended/failed 不回显 pending 卡的门控零改动。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

不会：改动仅在 TurnTimeline 组件内部渲染层；群聊面板（group-chat-panel.tsx）对 AskUserDialogCard 的内嵌渲染本就独立，不受影响；session-panel page/dialog 两模式共用 TurnTimeline，行为一致变化（预期内）。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：内嵌后用户滚动到长日志深处时新提问卡不可见、错过提问。兜底不缺：①待决策 pill 定位还原保留（点击滚顶+ring 闪烁直达卡片）；②卡片仍在内容流最顶部，回到顶部即见；③输入栏输入轮由后端 permission 队列门控，不答则挂起不丢。

放弃的方案：a) 保留 sticky 但滚动时折叠成细条——复杂度与状态面增加，用户明确不要悬浮形态；b) 新卡到达时自动滚动定位到卡——会打断用户阅读长日志的当前位置，侵略性强，弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | frontend/src/components/daemon/turn-timeline.tsx | pending 卡容器类名 sticky 钉顶→内嵌文档流；ref stickyCardsRef→inlineCardsRef；注释同步 |
| 修改 | frontend/src/components/daemon/__tests__/turn-timeline-dialog-minimize.test.tsx | 新增非 sticky 容器类名断言；注释/用例名措辞同步（视觉框→挂载占位语义） |
