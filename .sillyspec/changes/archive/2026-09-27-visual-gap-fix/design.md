---
author: flow-machine-draft
created_at: 2026-09-26T23:20:17.496Z
---
# 设计记录（Design Record）— 2026-09-27-visual-gap-fix

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-visual-gap-fix 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
workspace-card.tsx 渲染层重写为 GitHub Repositories 行式条目（单条目两段式：主行=名称 h3+别名+类型/状态徽章+slug mono+负责人；meta 行=技术栈/关联项目/创建与扫描时间；右置守护徽标+hover 操作组），props 契约与内部行为（busy/error/别名/重扫/删除 Modal/拖拽手柄）零改动。概览页 stats-row.tsx 的 StatCard 换 Insights 竖排（label 上/mono 大数字下），page.tsx 段②′ 改两栏 grid（左=活跃变更总览+入口链，右 340px=Agent 状态总览卡），基本信息/配置卡保持全宽。会话门户沿用已落地的 11px 下限与 brand 阶（不再深改）。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-visual-gap-fix 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
无对外签名变化：WorkspaceCard/WorkspaceStatsRow/AgentLivenessOverviewCard/ChangesOverviewCard props 全保留；纯前端展示层（render/className），无 API/DTO/路由改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-visual-gap-fix 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：不适用——纯展示层，数据到达顺序由既有 hooks 保证。
2. 并发写：不适用——无新增写路径（别名/重扫/删除沿用既有 mutation）。
3. 切换/生命周期：hover 操作组 opacity 过渡纯 CSS，中断无状态残留；Modal 受控态不变。
4. 作用域：不适用——组件无跨工作区数据，props 注入。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-visual-gap-fix 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：两栏 grid 中 ChangesOverviewCard（内部自带高度行为）在窄栏挤压下的布局回归——已跑概览 23 用例 + 卡片 19 用例全绿对冲。试过放弃：把 WorkspaceConfigCard 也收进右栏——放弃（ql-20260821-003 用户裁决全宽展示，不推翻既有用户决策）。会话门户左栏深改（3665 行条目重构）放弃——风险收益比差，已有 11px/brand 阶打底，留待专项。
