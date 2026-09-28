---
author: flow-machine-draft
created_at: 2026-09-28T13:57:00.343Z
---
# 设计记录（Design Record）— 2026-09-28-knowledge-touch-live

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-knowledge-touch-live 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） --
backend assets.py 单函数新增 + get_change_assets 接线 + frontend 资产卡两处文案（数据链无新端点，响应 schema 字段不变）：
- 新增 _live_touch_rows(session, ws, change_key)：查 knowledge_hits 表 type='inject' 且 change_name=本变更的 matched_anchors（按 occurred_at 排序保确定性），file#slug / 裸文件两形态展开去重，(id,title)=slug（裸文件=文件名），上限 100 条。
- get_change_assets：live 查询与三路文件扫描 asyncio.gather 并行；与标记反查行合并——标记行在前（归档后复核权威口径），live 补差，去重 key=(去 knowledge/ 前缀的 file, id)。
- frontend：在途态标签「知识触达（注入命中 · 实时）」区分归档态「（待复核标记反查）」；在途空态文案改为「执行中的知识注入命中会实时出现…FR/决策/测试绑定归档后汇总」。
- 审计结论（不动）：详情页文档区读变更目录实时可见；FR/决策/测试绑定/模块触达为 flow done 生成的结构化产物，归档前不存在结构化形态（设计内）。
>

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-knowledge-touch-live 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） --
响应模型零变化（ChangeKnowledgeTouch id/title/file 既有字段）。行为变化：GET /changes/{id}/assets 的 knowledge_touch 在途变更也非空（live 命中），归档态为标记+live 合并去重列表（标记行序在前）。无新端点/无 schema 改动/api-types 零变化。
>

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-knowledge-touch-live 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） --
1. 乱序/迟到：hits 行按 occurred_at 排序，上行乱序不破坏展示序；dedupe 幂等（任意行序结果集相同）。
2. 并发写：纯读查询+既有 gather 结构；knowledge_hits 上行幂等（line_hash uq）不产生重复锚。
3. 切换/生命周期：live 与标记两口径合并在单次请求内完成，无中间态；变更归档瞬间两数据源共存——去重 key 保证无重复。
4. 作用域：查询带 workspace_id + change_name 双条件（跨工作区/跨变更隔离）；局部 import KnowledgeHit 防模块环。
>

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-28-knowledge-touch-live 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） --
最大风险：live 锚 title 用 slug 原文（非知识条目标题原文）——slug 是标题的连字符化形态，可读但有损（空格变连字符）；条目卡深链按锚 id 命中不受影响。取标题原文需读全知识文件树，代价不成比例，取舍为 slug 即可读。放弃的方案：①在途也做 FR/决策/测试绑定实时索引——结构化产物归档时才生成，实时化=给在途变更建临时索引器（大特性且与「归档产物」语义冲突，用户审计确认只错位在知识触达）；②前端单独拉 /knowledge/stats 再按 change 过滤——stats 无 per-change 明细端点，且资产卡自取数模式（useQuery 单源）会被打破。
>
