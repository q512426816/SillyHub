---
author: flow-machine-draft
created_at: 2026-10-27T03:24:31.025Z
---
# 设计记录（Design Record）— 2026-10-27-mobile-chat-visual-round4

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

用户四轮反馈：①子代理卡与进度视图过程块仍不满宽——根因是 turn-segment-views 里 13 处容器各挂 max-w-[calc(100%-120px)]（2026-10-25 统一限宽，PC 防一行过长，手机被吃 30%）；②对话/进度两 tab 轮次样式不一（进度用旧 TurnStatusBadge 小字）要求统一。方案：①13 处 arbitrary 类一次替换为语义类 seg-width-cap，限宽规则收敛 globals.css 单点（.seg-width-cap=calc(100%-120px) desktop 等价 + [data-variant=mobile] 覆盖 100%）——比逐处加 mobile prop 分支轻 13 倍且防未来漂移；②turn-timeline 轮尾 viewMode 条件删除，all 视图与对话视图共用同一 RoundDivider JSX 块（meta/detail/mobile 同源同构），自动续跑徽标并入统一行，TurnStatusBadge 函数退役（dead code 删除）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

无端点/schema。组件签名零变化（RoundDivider 既有 props 复用）。删除函数：turn-timeline.tsx 内部 TurnStatusBadge（私有，无外部引用）。行为变化：all 视图轮尾从「小字状态行」变为「对话视图同款轮次分隔」（用户指定）；mobile 全过程块满宽；desktop 全部视觉等价（seg-width-cap CSS 值与原 arbitrary 类同值）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

不适用——纯渲染层（类名收敛+组件统一），无输入事件序。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

不适用——无数据写入。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

安全——限宽是纯 CSS；统一 RoundDivider 是同步渲染无状态。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：seg-width-cap 类被未来新块遗忘挂载（回到散装限宽）——已由测试断言锚（6 用例锚 seg-width-cap）+ globals.css 注释声明单一源约束。放弃的方案：①13 处逐个加 mobile prop 分支（组件改动 13 处×两行 vs 一次类替换+CSS 两行）；②all 视图保留 TurnStatusBadge 仅调样式近似（用户明确「统一用对话的」，两套组件近似必再漂移，正解是删旧用同组件）。
