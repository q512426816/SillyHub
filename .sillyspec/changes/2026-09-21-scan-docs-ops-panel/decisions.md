---
author: qinyi
created_at: 2026-09-21 09:12:00
---

# 决策记录（Decisions）

## D-001@v1: 指标口径=文档健康度四指标 + 模块文档层纳入覆盖基准
- type: term
- priority: P0
- status: accepted
- source: user
- question: 扫描文档没有命中遥测，运营指标用什么口径？覆盖率分母怎么定？
- answer: 用户选择题选定（2026-09-21）：①指标组合=文档健康度四指标——标准文档覆盖率（含近 8 周更新趋势）、陈旧文档（90 天未更新，可点开清单）、每项目文档密度、近 30 天更新占比，右侧配「最近更新榜」；不用内容体量视角。②覆盖基准=包含模块文档层——分母=项目数×7（STANDARD_DOC_TYPES 七件套）+ 各项目 modules/_module-map.yaml 登记模块条目数（yaml 行已在 scan_documents 表内，后端解析即可，无新遥测）；分子=scan/ 七件套实有 + modules/ 实有 .md；无 map 的项目模块层分母退化为该项目实有数（不虚摊）。
- normalized_requirement: 四指标+榜单全部从 scan_documents 单表聚合派生；覆盖口径两级（七件套 a/b · 模块文档 c/d）主显综合百分比。
- impacts: [全部 FR]
- evidence: 用户 AskUserQuestion 两问两答（2026-09-21）：「文档健康度四指标（推荐）」+「包含模块文档层」。
- 故障面: _module-map.yaml 为机器生成物，模块登记数随重扫漂移——覆盖分母随之漂移属预期（map 即真相源）。

## D-002@v1: 实现方案=后端聚合 stats 端点 + 独立前端面板组件
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 指标在哪里算、怎么送到前端？
- answer: 用户方案选择题选定（2026-09-21）：新增 GET /workspaces/{ws}/scan-docs/stats（SCAN_DOCS_READ），四指标+榜单全部后端 SQL 聚合 + 解析库内 _module-map.yaml 行；前端独立 ScanDocsStatsPanel 组件（视觉对齐知识库 OpsDashboard）挂 scan-docs 页 PageHeader 之下，useQuery 消费。否决的替代：前端全量自算（口径散落、逐项目拉 yaml 详情请求多）、物化快照表（296 行量级过度设计）。
- normalized_requirement: 数据链与知识库 OpsDashboard 同构（后端聚合端点 → lib 封装 → useQuery → 面板组件）；路由注册序铁律：/scan-docs/stats 字面量必须在 /scan-docs/{doc_id} 之前。
- impacts: [FR-stats 端点, FR 前端面板]
- evidence: 用户 AskUserQuestion 方案三选一（2026-09-21）：「后端聚合端点（推荐）」。
- 故障面: 新增 DTO 触发 gen:types 类型链（api-types.ts + openapi.json 同步提交）。
- 退役判据: 若扫描文档指标演进到需要跨工作区汇总或遥测实时推送，聚合端点形态重议（本决策只钉「口径在后端算」）。
- 故障面: 新增 DTO 触发 gen:types 类型链（api-types.ts + openapi.json 同步提交）。

## D-003@v1: 注入频次遥测=docs-inject 行复用 knowledge-hits 通道（并入本变更）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 扫描文档的注入使用频次怎么统计？（用户 2026-09-21 追问，选定并入本变更）
- answer: CLI 在模块上下文注入点（prompt.js renderModuleContext 及 execute.js 孪生处）经既有 appendKnowledgeHit 追加 `{type:'docs-inject', change, query, matchedFiles:[docs 相对路径], at}` 行——复用 knowledge-hits.jsonl 通道而非新建文件：daemon 上行链路整 jsonl 原样转发零改动；平台 HitsService.ingest 对白名单外 type 宽容前向落库（hits.py:233「外型存原值」），且 USAGE_TYPES 白名单不含 docs-inject，不污染知识库统计。平台 stats 聚合读 type='docs-inject' 行做 30 天窗口指标与文档级频次榜。
- normalized_requirement: CLI 埋点 fail-soft（遥测写失败不影响注入本体，对齐 buildKnowledgeInjection 先例）；matchedFiles 记 docs 树相对路径，平台聚合按剥前缀口径对齐 scan_documents.path；旧 CLI 无此行型 → 面板空态「暂无注入数据」不报错。
- impacts: [FR-06, FR-07]
- evidence: 用户 AskUserQuestion（2026-09-21）：「并入当前变更」；代码核实：sillyspec/src/knowledge-hits.js appendKnowledgeHit 通用 append、hits.py:44-59 白名单+宽容落库、knowledge-hits-upload.ts 整文件上行。
- 故障面: 跨仓交付（sillyspec CLI 独立发版节奏）——CLI 未升级环境永远空态；docs-inject 行量随 quick/execute 步骤注入频次增长（每步一行，量级=知识 inject 同款，可控）。
- 退役判据: 若未来 docs 注入改为平台侧统一注入（不经 CLI），本遥测型随 CLI 注入下线一并退役。
