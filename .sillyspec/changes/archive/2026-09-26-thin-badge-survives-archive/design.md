---
author: flow-machine-draft
created_at: 2026-09-26T13:39:44.512Z
---
# 设计记录（Design Record）— 2026-09-26-thin-badge-survives-archive

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-thin-badge-survives-archive 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
纯前端展示修复，只动详情页 page.tsx 标题徽章分支：归档态且判定轻量出身时，在「已归档」徽章旁并排渲染 STATUS_BADGE.thin 的「轻量变更」徽章。出身判定用既有 ChangeRead 字段（change_type=="quick" + created_at>=2026-09-25 时间窗），零后端改动零新请求。选时间窗而非镜像 flow-state.yaml tier 投影：后者要动后端读侧投影（每次详情读文件系统），收益不成比例；时间窗依据 thin 写入分流上线日（2026-09-25-change-center-thin-flow，此后新 quick 类型变更全部分流 thin），存量 quick 均早于该日，判定可靠。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-thin-badge-survives-archive 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
无接口变化——纯前端徽章渲染分支，消费既有 ChangeRead.change_type/created_at/current_stage/location 字段。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-thin-badge-survives-archive 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：不适用——纯渲染派生，输入是单次详情快照字段，无时序。
2. 并发写：不适用——无状态无写。
3. 切换/生命周期：不适用——徽章随组件渲染，无弹窗/请求生命周期。
4. 作用域：时间窗常量 2026-09-25 是平台级 thin 分流上线日（全局事实），非工作区相关；change_type/created_at 均来自该变更行，无跨工作区串面。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-thin-badge-survives-archive 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：时间窗边界误判——若数据库存在 created_at 异常（时钟漂移/手工导入）的边界数据，可能误标/漏标出身；误标代价仅是多显示一个徽章（低危展示层），且 thin 分流上线后 quick 类型不再新增，窗口语义单调。试过但放弃：①镜像 flow-state.yaml tier==thin 精确投影——需后端详情读侧加文件系统读取，读放大不成比例；②列表页徽章同改——列表行徽章走 ChangeStepBadge（另一组件），用户诉求在详情页标题，列表另行跟进不夹带。
