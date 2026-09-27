---
author: flow-machine-draft
created_at: 2026-09-27T13:35:24.365Z
---
# 设计记录（Design Record）— 2026-09-27-timeline-coexist

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-timeline-coexist 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
变更详情页（changes/[cid]/page.tsx）把「步骤时间线卡」与「真实留痕时间线卡」的互斥挂载改为共存：steps 非空时步骤卡照常渲染，ChangeTimelineCard 恒挂载（组件自身 events/tasks/born 全空时静默 return null，无观测数据零占位）。归因：归档时 CLI unregisterChange 终态一致化会补种 3 行同一时间戳 steps，原互斥逻辑（steps 空才挂合成卡）恰好被这批补种行顶掉，归档后的轻量变更看不到事件轴/任务面/墙钟真实数据。选恒挂载而非「归档态才双显」：空态判定本就内聚在组件里（观测事件卡同款范式），页面不需要重复条件，厚变更无事件流数据时行为零变化。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-timeline-coexist 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
后端与 API 零改动（GET /changes/{cid}/timeline 与 ChangeRead.steps 均为既有接口）。前端仅两文件：page.tsx 三元互斥改为「steps 卡条件渲染 + 合成卡无条件挂载」；page-restore-assets.test.tsx 新增共存钉子用例（归档补种 steps fixture + timeline mockResolvedValue → 断言两 testid 同屏）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-timeline-coexist 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：不适用——纯展示层挂载条件改动，数据顺序语义由既有 timeline/steps 接口承担，本变更不触碰。
2. 并发写：不适用——无共享可变状态，ChangeTimelineCard 自取数（react-query 30s 轮询），与步骤卡（随 change 查询渲染）数据通道独立。
3. 切换/生命周期：合成卡 query 失败 retry:false 静默隐藏（既有行为），切换变更/下线不影响步骤卡；两卡无共享取消逻辑。
4. 作用域：组件按 workspaceId+changeId 取数，query key 含两 id，跨工作区不串台。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-timeline-coexist 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：厚变更若事件表有历史数据，归档后详情页会多出一张合成卡——判定为可接受（信息增量，非误报；事件恒 provisional 角标已声明观测语义）。试过放弃的方案：恢复第一代 tasks.md 勾选时间戳指令（需改 CLI 流程模板且与第二代 watcher 事件流机制重复，放弃）；后端在 steps 里带真实事件时间（改 CLI 同步协议，面大，放弃）。
