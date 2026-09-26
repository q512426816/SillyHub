---
author: flow-machine-draft
created_at: 2026-09-26T08:19:43.797Z
---
# 设计记录（Design Record）— 2026-09-26-change-asset-transparency

> 四节的「问题」是机器段（指纹保护，勿改）；你的回答写在每节问题下方的 AGENT 槽里。
> 每节至少一行——小改动可写「不适用：<理由>」；flow done 空槽拒收。

## 做法概述
<!-- MACHINE-DRAFT:design-approach:4fa550e9aac26c5f5a3c89b853d9af0ad0749943358808fbc1196064a42c1173:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-change-asset-transparency 留痕重锚 -->
本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。
<!-- MACHINE-DRAFT:design-approach:end -->

<!--AGENT:槽1 做法概述作答——例外裁决书写面（机器段之外合法） -->
只读展示增强，沿用沉淀资产聚合与卡片：①后端 assets.py 两组聚合——知识触达复用既有 fr/decisions 条目解析（_parse_entries_owned_by 的「变更：」归属改为「待复核：」归属变体参数化，双域全扫）；模块触达读归档 change-patch 的 file_list（既有数据）× 镜像 docs/*/modules/_module-map.yaml（yaml 安全解析，paths 去 ** 后前缀匹配，多项目并扫），模块中文名读 doc 文件首行 h1 提取（失败回退模块 id）；DTO 两组挂 ChangeAssetsRead。②前端资产卡两组渲染：知识触达行 Link 跳知识库 ?file=&anchor=（FR 行同款）；模块触达 chip 点击开独立文件预览弹窗（explorer FilePreview 直挂，路径确定不走测试文件的搜索解析）。③规则 21 gen:types。数据可得性依据：待复核标记由 flow done 对触达域 active FR 打标（knowledge/fr/auto-backend.md 实证 2026-09-26-assets-test-binding-raw-text 六处）；模块图 schema_version 2 含 doc/paths。

## 接口契约
<!-- MACHINE-DRAFT:design-contract:86ee80e3cad9ae1c299a0c54bf5503a112d318bb2e5490a32fcd5c1724293a0b:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-change-asset-transparency 留痕重锚 -->
动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？
<!-- MACHINE-DRAFT:design-contract:end -->

<!--AGENT:槽2 接口契约作答——例外裁决书写面（机器段之外合法） -->
GET /changes/{cid}/assets 响应新增两组（既有字段零变化）：knowledge_touch: [{id, title, file}] 与 touched_modules: [{id, name, project, doc}]；api-types.ts 随 gen:types 再生成。无新端点。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）
<!-- MACHINE-DRAFT:design-boundaries:98046ccf043ed9302175b492d297f70dfd943c39f2e8770e8a6039ea302cbb6a:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-change-asset-transparency 留痕重锚 -->
1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？
2. 并发写：两个执行体同时操作同一数据/文件会发生什么？
3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？
4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？
<!-- MACHINE-DRAFT:design-boundaries:end -->

<!--AGENT:槽3 盲维四问作答——例外裁决书写面（机器段之外合法） -->
1. 乱序/迟到：知识条目与模块图是镜像快照（append-only 为主），聚合每次整读；「待复核」标记在 flow done 时点写入，归档后稳定，在途变更读到的标记随轮询自然增长。
2. 并发写：全只读（镜像文件 SELECT 级读）；yaml/md 解析失败逐项 fail-open 降空组，不影响其余组。
3. 切换/生命周期：弹窗复用既有 Dialog 模式（关闭清态）；模块 doc 文件在仓库被移动/删除 → explorer 预览呈现真实错误（既有行为），不吞。
4. 作用域：镜像根与变更目录由 workspace_id 解析（既有逻辑）；知识触达按 change_key 匹配标记（变更名全局唯一约定）；模块图按镜像内 docs 归属，无跨工作区串面。

## 风险与死路
<!-- MACHINE-DRAFT:design-risks:03ff22f024c81093b38d2bb78b9d095acf5be70d5c09b17c10da44e4655ddb72:begin 机器预填段——整段改写会被 flow done 拒收；确要修改：sillyspec flow amend-draft --change 2026-09-26-change-asset-transparency 留痕重锚 -->
本方案最大的风险是什么？试过但放弃的方案及放弃理由？
<!-- MACHINE-DRAFT:design-risks:end -->

<!--AGENT:槽4 风险与死路作答——例外裁决书写面（机器段之外合法） -->
最大风险：「待复核」标记语义≠完整知识消费面——flow start 注入的知识命中（conventions/patterns 锚点）不落盘，本组只覆盖被 flow done 打标的 FR/决策（有覆盖交集才打标）；页脚措辞如实（「知识触达（待复核标记反查）」）不冒充全量消费记录。次风险：模块图 paths glob 语义简化为去 ** 前缀匹配——深嵌套例外路径（负 glob/多段通配）会误归/漏归，模块图现行形态（单前缀+**）下无实例，误归代价是 chip 多一个可点项（低危）。中文名 h1 提取对无 h1 文档回退 id（conventions 要求模块卡 h1 中文名，存量已合规）。试过但放弃：①CLI 侧落盘完整注入清单（含知识命中）——外部工具改动，留坑建议；②模块页独立路由——平台无模块卡页面先例，开新页面超本变更换代价值，先以文档预览弹窗承接，后续有模块中心需求再升格。
