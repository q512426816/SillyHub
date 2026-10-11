---
author: flow-machine-draft
created_at: 2026-10-11T03:59:27.322Z
---
# 设计记录（Design Record）— 2026-10-11-retire-components-page

## 做法概述

<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-11-retire-components-page 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->
纯前端下线：删除 /components 与 /components/topology 两个页面目录、侧边栏「项目组组件/拓扑图」
两个菜单项、工作区 tabs 组件入口、统计卡组件格、config-card 的「生成项目组件」按钮（判据
componentCount 已无数据源——扫描确认门与同步按钮显隐改用 specWs.last_synced_at 同口径）、
lib/components.ts 与 spec-workspaces.ts 的 generateProjects 封装、
use-page-session-context 的 components 分支。后端 components/generate-projects 端点原样保留
（零 API 破坏），信息面由关联仓卡片「本机现状回显」（2026-10-10-linked-repos-local-echo）
承接——它读的就是真实现状而非这份长期为空的派生物。

## 接口契约

<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-11-retire-components-page 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->
不适用：后端零改动——components/generate-projects 端点、openapi.json、api-types.ts 全部
不动。前端侧删除的均为页面层/菜单层/lib 封装，无对外签名。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-11-retire-components-page 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->
1. 乱序/迟到到达：不适用——纯静态页面下线，无事件流；已打开的旧页面标签在部署后刷新即 404，属预期。
2. 并发写：不适用——无共享数据写面。
3. 切换/生命周期：会话 pageContext 的 workspace_components/workspace_topology tabKey 分支
   一并删除，路径回落 workspace_overview（use-page-session-context 兜底）。
4. 作用域：全局菜单（menu-permissions）与工作区 tabs 两处入口同步删除，无跨工作区差异；
   权限枚举镜像 topology:read 保留（后端仍枚举），仅组内引用消失。

## 风险与死路

<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-10-11-retire-components-page 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->
最大风险：有外部脚本/书签直连 /components 路径——下线后 404。接受理由：该页 13/15 工作区
本就空数据，无可书签价值；信息已在关联仓回显。放弃的方案：①加「从模块索引生成」按钮复活
组件页（选项 B）——为空页续命而非解决问题；②后端端点一并删——破坏 openapi 面且无收益
（无人调用的 GET 无害）。
