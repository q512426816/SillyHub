---
author: flow-machine-draft
created_at: 2026-09-27T09:00:33.252Z
---
# 设计记录（Design Record）— 2026-09-27-change-list-is-thin

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-change-list-is-thin 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 -->
后端 ChangeSummary 加 is_thin 计算字段（DTO 层零 migration），ChangeService._is_thin_lineage 三分支判定（stage=thin / quick 且 created_at>=2026-09-25 / latest_progress.steps 全无标准四阶段痕迹且同窗——steps 数据已在投影 JSON 内零新增查询，offset-naive 归一 UTC 后比较），enrich_summaries 投影循环注入（stage_info 命中用 latest_progress、miss 用 row 现值）；前端 gen:types 后列表行消费（is_thin=true 行图标琥珀闪电+标题行「轻量」徽章，与状态图标并存对齐详情双徽章口径），16 处测试 mock 顺手补 is_thin 字段。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-change-list-is-thin 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 -->
ChangeSummary schema +is_thin: bool=False；service +_is_thin_lineage 类方法；api-types/openapi.json 重生成同批；前端 changes/page.tsx 两处消费。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-change-list-is-thin 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 -->
四问全 n/a：读时投影（read-only DTO 层），无写路径/状态/作用域引入。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-27-change-list-is-thin 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 -->
最大风险：判定口径与前端 lib/thin-lineage.ts 双实现漂移——注释互指+同口径测试锚定（后端 6 用例对齐前端 6 用例矩阵）；已放弃：ChangeRead 详情也加 is_thin——详情前端已有本地判定且正确，最小面原则不加。
