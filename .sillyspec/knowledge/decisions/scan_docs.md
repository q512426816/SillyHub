# 决策知识 — scan_docs

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-002@v1 实现方案=后端聚合 stats 端点 + 独立前端面板组件
状态：implemented
变更：2026-09-21-scan-docs-ops-panel
锚点：未记录
最近确认：e05d03fed
理由：用户方案选择题选定（2026-09-21）：新增 GET /workspaces/{ws}/scan-docs/stats（SCAN_DOCS_READ），四指标+榜单全部后端 SQL 聚合 + 解析库内 _module-map.yaml 行；前端独立 ScanDocsStatsPanel 组件（视觉对齐知识库 OpsDashboard）挂 scan-docs 页 PageHeader 之下，useQuery 消费。否决的替代：前端全量自算（口径散落、逐项目拉 yaml 详情请求多）、物化快照表（296 行量级过度设计）。
故障面：新增 DTO 触发 gen:types 类型链（api-types.ts + openapi.json 同步提交）。
退役判据：若扫描文档指标演进到需要跨工作区汇总或遥测实时推送，聚合端点形态重议（本决策只钉「口径在后端算」）。

## D-003@v1 注入频次遥测=docs-inject 行复用 knowledge-hits 通道（并入本变更）
状态：implemented
变更：2026-09-21-scan-docs-ops-panel
锚点：未记录
最近确认：e05d03fed
理由：CLI 在模块上下文注入点（prompt.js renderModuleContext 及 execute.js 孪生处）经既有 appendKnowledgeHit 追加 `{type:'docs-inject', change, query, matchedFiles:[docs 相对路径], at}` 行——复用 knowledge-hits.jsonl 通道而非新建文件：daemon 上行链路整 jsonl 原样转发零改动；平台 HitsService.ingest 对白名单外 type 宽容前向落库（hits.py:233「外型存原值」），且 USAGE_TYPES 白名单不含 docs-inject，不污染知识库统计。平台 stats 聚合读 type='docs-inject' 行做 30 天窗口指标与文档级频次榜。
故障面：跨仓交付（sillyspec CLI 独立发版节奏）——CLI 未升级环境永远空态；docs-inject 行量随 quick/execute 步骤注入频次增长（每步一行，量级=知识 inject 同款，可控）。
退役判据：若未来 docs 注入改为平台侧统一注入（不经 CLI），本遥测型随 CLI 注入下线一并退役。
