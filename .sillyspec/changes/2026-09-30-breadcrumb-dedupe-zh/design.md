---
author: flow-machine-draft
created_at: 2026-09-30T08:05:20.453Z
---
# 设计记录（Design Record）— 2026-09-30-breadcrumb-dedupe-zh

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-breadcrumb-dedupe-zh 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
两处页内面包屑直接删除：变更中心列表页 PageHead 的 breadcrumb 传参（top-bar 已有【工作区>变更中心】同位信息）；任务详情页手写 nav 面包屑块。TopBar 的 SEGMENT_LABEL 段名映射表补全遗漏段（changes/sessions/files/git-log 等约 30 个），中文取自既有权威命名：侧边栏菜单 lib/menu-permissions.ts 的 menuLabel、工作区页签 components/workspace-tabs.tsx 的 label，不新造叫法；MCP/Git/API/Skills 等专业术语保留原文（CLAUDE.md 规则 12）。方案选映射表补全而非逐页硬编码：单点维护、与菜单命名同源可对账。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-breadcrumb-dedupe-zh 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
frontend/src/components/top-bar.tsx：SEGMENT_LABEL 纯数据扩充；buildBreadcrumbs 由模块私有改 export（与 resolvePlatformSwitch 同款可测纯函数出口，供单测断言段名中文化）。无后端/接口/文件格式变化。PageHead（primer 组件）的 breadcrumb 插槽本身保留——组件能力归组件（primer-structures.test 仍覆盖），仅真实页面不再传参。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-breadcrumb-dedupe-zh 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：纯静态映射表 + 同步 pathname 派生，无事件流，不适用。
2. 并发写：无共享可变状态（map 为模块级常量，只读），不适用。
3. 切换/生命周期：面包屑由 usePathname 每渲染重算，路由切换即重派生，无残留状态。
4. 作用域：映射按 URL 段全局共享，但段名（如 changes→变更中心）在全站语义唯一（侧边栏/页签同源命名），不串台；动态段（[cid]/[tid] 等 id）维持原样显示原值，与现状一致。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-breadcrumb-dedupe-zh 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：中文命名与用户心智不一致（如 changes 译「变更中心」而页签叫「变更」）——以侧边栏 menuLabel 为第一权威、页签 label 为工作区语境补充，两侧本来就有「变更中心/变更」粒度差，面包屑取菜单级「变更中心」与被删页内面包屑文案一致。试过放弃的方案：把动态 id 段也替换为业务名（changeKey/task_key）——需要 TopBar 拉工作区数据引入请求依赖，超出本次「去重复+中文化」范围，放弃；id 段维持现状原样显示。
