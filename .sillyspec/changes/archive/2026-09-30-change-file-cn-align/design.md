---
author: flow-machine-draft
created_at: 2026-09-30T02:32:53.242Z
---
# 设计记录（Design Record）— 2026-09-30-change-file-cn-align

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-change-file-cn-align 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
change-file-tree.tsx 树节点行布局返工：上一变更把英文原名小字放 ml-auto 徽标区导致与中文名两端分离、各行参差不齐。改为外层文本 span（flex-1）内部「中文名 truncate + 原名 shrink-0」紧凑相邻左对齐；徽标（排队中/只读）保留 ml-auto 靠右。纯 className 布局调整，无逻辑变化。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-change-file-cn-align 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
无。仅 change-file-tree.tsx 树节点 JSX 类名与 span 嵌套结构调整，组件 Props、导出、数据链路、测试锚点（文本内容/testid）均不变。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-change-file-cn-align 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序：不适用——纯展示布局，数据序不变。2. 并发：不适用——无状态无 mutation。3. 切换：不适用——无本地 state（选中态/展开态既有机制不变）。4. 作用域：不适用——无跨组件数据。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-30-change-file-cn-align 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：窄列（280px 文件树列 + 深层缩进）下中文名+原名同排可能溢出——已用外层 min-w-0+truncate、原名 shrink-0+truncate 双兜底（原名截断 hover 有 title 全路径）。放弃的方案：原名整体隐藏只显中文名——放弃：丢失「原名保留可对照」的 FR-03 语义。
