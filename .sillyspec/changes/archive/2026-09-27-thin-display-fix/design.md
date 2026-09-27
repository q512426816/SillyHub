---
author: flow-machine-draft
created_at: 2026-09-27T05:52:55.219Z
---
# 设计记录（Design Record）— 2026-09-27-thin-display-fix

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-thin-display-fix 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 -->
四处修正：①详情页新增导出 isThinLineageChange（三分支：stage=thin / quick 且 created_at>=2026-09-25 分流上线窗 / steps 全无标准四阶段痕迹的兜底），命中时 ChangeStageHeader 六阶段 checks 换轻量流程条（StateLabel zap「轻量变更」+ flow start→干活→flow done 三步绿勾）；②change-stage-actions 的 thin 只读卡判定同口径扩展（归档 thin 不再落通用「无可审批」）；③详情标题「影响: —」空值不再渲染；④列表行 changeRowState 加 stage=thin→attention（琥珀闪电）。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-thin-display-fix 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 -->
新增导出纯函数 isThinLineageChange（[cid]/page.tsx）；其余纯展示层，无 API/路由改动。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-thin-display-fix 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 -->
四问全 n/a：纯展示判定（同步纯函数），无状态/写路径/作用域引入。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-thin-display-fix 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 -->
最大风险：steps 兜底判定对「无 steps 记录的标准变更」误判——判定要求 steps.length>0，空 steps 不命中（标准变更 active 期必有步骤记录，归档标准变更 steps 含四阶段痕迹已验证 observation 样本）。钉子测试暴露并修正了 quick 时间窗缺失（历史 quick 误标）；放弃：列表行归档 flow-thin 出身标识——列表投影无 steps/change created_at 有但 change_type=feature 无信号，需后端 is_thin 投影（已列遗留）。
