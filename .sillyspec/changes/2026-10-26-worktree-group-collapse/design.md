---
author: flow-machine-draft
created_at: 2026-10-26T01:06:55.909Z
---
# 设计记录（Design Record）— 2026-10-26-worktree-group-collapse

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

Git 日志页「工作区更改」卡的三个分组头（更改/未纳入版本管理/已忽略）原为纯展示 div（箭头字符写死），改为可点击 button + 折叠状态：组件内加 `groupOpen` state（`{ changed: true, untracked: false, ignored: false }`——用户实测反馈要求后两组默认收起省屏），三个分组头换成与目录行同款的 ChevronRight 旋转箭头按钮（aria-expanded + data-testid），内容区按开合条件渲染；收起态头行右缘显示该组计数（N 个文件 / N 项），收起不丢信息量。选这个方案是因为分组折叠与目录折叠在卡内已是同构交互（StatusTreeRows 的 toggleDir 先例），零新增依赖。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

改动仅限前端组件内部：`frontend/src/components/git-log/worktree-changes-card.tsx` 新增 `groupOpen` state 与 `toggleGroup`，三分组头 div→button（新增 testid：worktree-group-toggle-changed/untracked/ignored）；组件对外 props（workspaceId/onOpenFile）与数据接口零变化。后端/daemon/类型产物：无。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：分组数据由 useGitLogDirtyFiles 单源驱动，折叠态是纯 UI state 与数据到达顺序无关；数据晚到重渲染不重置用户已切换的折叠态（state 在组件实例存活期内保持）。
2. 并发写：纯前端组件态，无共享可写数据；多标签页各持独立 state 天然隔离。
3. 切换/生命周期：刷新查询/重新进页后折叠态回到默认（changed 展开、其余收起）——符合「进页先看概要」预期，无中间态残留。
4. 作用域：折叠 state 组件内私有，不跨工作区/实例共享，无串台面。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：默认收起后用户找不到 untracked/ignored 内容——已用收起态头行计数（N 个文件/N 项）+ 旋转箭头提示可展开缓解。试过放弃：把三组并成 Tab 切换（放弃——破坏三组同屏对照，IDEA 参照形态就是纵向分组树）。
