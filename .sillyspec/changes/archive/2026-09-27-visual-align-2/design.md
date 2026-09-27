---
author: flow-machine-draft
created_at: 2026-09-26T23:43:19.940Z
---
# 设计记录（Design Record）— 2026-09-27-visual-align-2

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-visual-align-2 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 -->
三处对齐：①变更中心 renderChangeRow 重排为原型 issue-row 口径（主行=标题 14px/600 链接色+待办胶囊；副行=key mono 12px 灰+组件圆角胶囊+活动徽标；右列=阶段徽章+20px 首字符头像+compact 单行用量+相对时间），加底部「显示 x/y」脚注与工具条圆角容器，UsageExecCell 加 compact prop；②详情页右栏 320→296px 并以外层圆角边框容器+[&>*] 任意值选择器去子卡边框/阴影，六卡融合为单块 MetaPanel 观感（各卡自取数/折叠功能零改动）；③概览右栏 Agent 卡下新增 About MetaPanel（repo_url mono/技术栈胶囊/关联项目 tag/创建时间，数据全来自已加载 workspace 与 linkedProjectNames）。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-visual-align-2 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 -->
UsageExecCell 新增可选 compact prop（默认 false 零影响）；其余无签名变化，纯展示层。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-visual-align-2 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 -->
1. 乱序：n/a 纯展示。2. 并发：n/a 无新增写路径。3. 切换：n/a 无状态（相对时间每次渲染重算）。4. 作用域：n/a props 注入。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-visual-align-2 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 -->
最大风险：[&>*] 子选择器依赖子卡 SectionCard 边框类形态，子卡改版式会失效——已用详情域 134 用例对冲。放弃：时间线组件重写——核对发现其已是竖线节点形态（pl-[26px]+before 竖线），无需重写；头像完整用户名展示——原型即 20px 首字符，title 携全名。
