---
author: flow-machine-draft
created_at: 2026-09-27T01:26:02.698Z
---
# 设计记录（Design Record）— 2026-09-27-hover-polish

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-hover-polish 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 -->
三处 hover 对齐原型口径：IssueRow 与 UnderlineNav 的 hover:bg-muted/60→hover:bg-muted（实色，原型 .issue-row:hover{background:var(--canvas)} 无透明度叠加）+transition-colors 补 duration-100（原型 .1s）；workspace-card 旧 hover 三件套（border-brand-300 紫边+-translate-y-1 抬升+shadow-lg）整体替换为 hover:bg-muted（原型 repo-row:hover 仅背景），操作组浮现补 duration-100。范围归属声明：工作区 diff 中 workspace-card 的行式布局重写属已归档的 2026-09-27-visual-gap-fix（未提交改动叠加显示），本变更仅认领其中 hover/transition 三处 className。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-hover-polish 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 -->
无签名变化，纯 className 修改三个组件文件。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-hover-polish 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 -->
四问全 n/a：纯 CSS 类，无状态/写路径/作用域引入。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-hover-polish 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 -->
最大风险：muted 实色在 dark 主题的悬浮对比（dark muted=zinc-700 深灰，实色悬浮为深一档——与原型 canvas 语义一致方向）；已放弃：自定义 canvas 色阶 token——三主题 muted 即语义等价物，不新增阶。
