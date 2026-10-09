---
author: flow-machine-draft
created_at: 2026-10-09T00:59:09.043Z
---
# 设计记录（Design Record）— 2026-10-09-graph-query-ux

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

图谱页两处交互优化：①runQuery 后新增自动选中 effect——带锚点的查询结果到达时，锚点节点（用户输入或后端归一回填 anchor/key/from 三候选）直接置选中态；仅 neighbors 自动切「节点详情」tab（锚点中心视图），impact/path 保持「查询结果」（闭包/推理链价值所在，不抢焦点）；guard ref 按查询签名防重复选中与重置后被拉回。②SUB_DESCRIPTIONS 人话映射七条，双通道呈现：antd Select 选项 title 悬浮 + 下拉下方动态说明行（antd Select 弹层内 title 悬浮在部分环境不稳，动态行保底）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

文件清单（自声明）：①`frontend/src/app/(dashboard)/workspaces/[id]/knowledge/graph/page.tsx`（SUB_DESCRIPTIONS 常量+选项 title+说明行+自动选中 effect）；②`frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx`（+2 用例）。零接口变更（纯前端交互层，无端点/schema/lib 改动）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
   不适用——React Query 结果缓存确定性到达；effect 依赖 data 引用，陈旧响应由 query key 隔离。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
   不适用——纯前端组件态；两次快速查询由 guard 签名判重。
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
   安全——选中态是组件本地 state，卸载即清；重置按钮清 selectedId 后 guard 拦截同签名重选。
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
   不会——workspaceId 在路由层隔离，guard 签名含 sub/anchor 不含跨区共享态。
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：自动切 tab 抢走结果面焦点（实测即翻车——path 预置用例被详情 tab 抢走 reason 文案）。已收口为仅 neighbors 切详情。放弃的方案：①所有带锚点 sub 都切详情——否，impact 闭包/path 推理链的价值在结果面；②antd Select 弹层内做富 tooltip——否，原生 title 在弹层滚动环境不稳，动态说明行同信息更可靠。
