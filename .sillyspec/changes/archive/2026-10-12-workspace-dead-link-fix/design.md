---
author: flow-machine-draft
created_at: 2026-10-12T00:42:29.656Z
---
# 设计记录（Design Record）— 2026-10-12-workspace-dead-link-fix

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

8a928588f 下线「项目组组件」页时删除了 `workspaces/[id]/components` 路由（含 topology 子页），但审批中心与审计日志两页页头的返回 `<Link>` 仍指向该路由——点击即 Next.js 404，audit 页文案还是「← 组件列表」。修法：两处 `href` 改指 `/workspaces/${workspaceId}`（工作区详情首页，与平台其余「← 工作区」返回约定一致），audit 文案同步改「← 工作区」；两页此前无页面级测试，各补一个最小渲染测试钉住链接文案与 href（next/link mock 成真实 `<a>` 以可断言，数据面取空列表、SessionPermissionPanel 桩化）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 纯前端两处 JSX `href`/文案改动与两个新增测试文件；无函数签名、端点、schema、路由结构变化；`pnpm gen:types` 不需跑。用户可见变化：两页返回链接从 404 死链变为工作区详情首页。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   链接是纯静态 JSX 渲染，无数据依赖与时序面；页面数据加载失败不影响页头渲染（header 不在 loading 分支内），断言用 `findByText` 容忍异步首帧。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   不适用：纯展示链接改动，无共享可变状态；测试侧各用独立 QueryClient 与 cleanup，无跨用例污染面。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   不适用：无状态迁移；两页卸载/重挂载仅重复既有取数行为，链接渲染与生命周期解耦。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   href 模板按当前页 `params.id` 插值，不跨 workspace 串台；不触及其它仓。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 风险：指向工作区首页后若用户期望回到「上一列表页」会多一跳——但两页入口本就来自工作区详情（侧边栏/卡片），回首页即原入口，且与平台其余子页「← 工作区」约定一致；无更优既有目标。
- 放弃方案：删除返回链接（对齐组件页下线的减法思路）——否，页头返回锚是既有导航约定，删除损失导航一致性且改动面反而更大（需动 PageHeader 结构）。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 改 | frontend/src/app/(dashboard)/workspaces/[id]/approvals/page.tsx | 返回链接 href 改指工作区首页 |
| 改 | frontend/src/app/(dashboard)/workspaces/[id]/audit/page.tsx | 返回链接 href 改指工作区首页 + 文案「← 组件列表」→「← 工作区」 |
| 增 | frontend/src/app/(dashboard)/workspaces/[id]/approvals/__tests__/page.test.tsx | 返回链接最小断言测试 |
| 增 | frontend/src/app/(dashboard)/workspaces/[id]/audit/__tests__/page.test.tsx | 返回链接最小断言测试 |
