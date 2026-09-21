---
author: qinyi
created_at: 2026-09-21 01:29:55
generated_by: sillyspec-fourpiece-init
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| workspace 成员（SCAN_DOCS_READ） | 查看扫描文档运营指标/陈旧清单/最近更新榜 |
| workspace 管理员（WORKSPACE_WRITE） | 同上 + 按陈旧清单引导人工补写/归档/重扫 |

## 功能需求

### FR-01: stats 聚合端点
覆盖决策：D-002@v1
Given workspace 的 scan_documents 表已有数据（reparse 后）
When 调用 GET /workspaces/{ws}/scan-docs/stats（SCAN_DOCS_READ）
Then 返回 ScanDocsStatsOut：coverage（std_have/std_expected/module_have/module_expected + 近 8 周趋势）、stale_docs（last_modified_at 为空或距今>90 天，最旧在前，上限 200）、density（per_project_avg=exists 总数÷项目数）、freshness（近 30 天更新数/总数）、recent_board（last_modified_at 降序 Top 10）；端点注册在 /scan-docs/{doc_id} 通配之前（请求不被吞）

### FR-02: 覆盖率两级口径（含模块文档层）
覆盖决策：D-001@v1
Given docs 树按项目分组（剥 .sillyspec/docs 前缀后第一段）
When 计算覆盖率
Then 七件套：have=各项目 scan/ 下 doc_type ∈ STANDARD_DOC_TYPES 去重计数，expected=项目数×7；模块层：have=modules/ 实有 .md（排除 _module-map.yaml），expected=各项目 modules/_module-map.yaml 登记的 modules 条目数（解析 DB 内 yaml 行；无 map 或解析失败的项目 expected 退化为该项目的 have，不虚摊）；主显综合百分比=(std_have+module_have)/(std_expected+module_expected)，子行透出两档明细

### FR-03: 运营指标面板
覆盖决策：D-001@v1, D-002@v1
Given workspace 已有扫描文档
When 打开 scan-docs 页
Then PageHeader 之下渲染面板（视觉对齐知识库 OpsDashboard）：指标大卡四子卡——标准文档覆盖率（百分比+两档明细+8 周趋势折线）、陈旧文档（数字+点开内嵌清单：路径+最后修改时间/未知）、每项目文档密度（篇/项目+口径 tooltip）、近 30 天更新（x/y）；右侧最近更新榜 Top 10（路径+相对时间）；面板走独立 useQuery 数据链不阻塞主列表

### FR-04: 三态健壮
Given stats 接口异常 / 工作区无文档 / 加载中
When 面板渲染
Then 分别显示错误条（不白屏、不影响主列表）/ 空态卡 / 加载占位，三者占住同版位避免布局跳动

### FR-05: 类型链同步
Given 后端新增 stats DTO
When 实现完成
Then pnpm gen:types 再生成 api-types.ts + openapi.json 并同变更提交；前端消费生成类型（components["schemas"]["ScanDocsStatsOut"]），禁手写

### FR-06: docs 注入遥测链（CLI→daemon→平台）
覆盖决策：D-003@v1
Given CLI 模块上下文注入命中
When 注入发生
Then sillyspec CLI 经既有 appendKnowledgeHit 追加 `{type:'docs-inject', change, query, matchedFiles:[docs 相对路径], at}` 行（fail-soft：遥测写失败不影响注入本体）；daemon 整 jsonl 上行零改动；平台 ingest 宽容落库零改动且 USAGE_TYPES 白名单不含 docs-inject（知识库 stats 口径不受污染）

### FR-07: 注入频次指标与榜单双 tab
覆盖决策：D-003@v1
Given knowledge_hits 表存在 type='docs-inject' 行
When stats 聚合与面板渲染
Then injection 字段返回近 30 天总次数/被注入文档数/文档级频次榜 Top 10（路径剥前缀对齐 scan_documents）；右侧榜单双 tab——「🔥 注入频次」默认、「🕘 最近更新」可切；无遥测数据（旧 CLI）时空态「暂无注入数据（CLI 升级后自动汇聚）」不报错

## 非功能需求
- 兼容性：纯新增只读端点，旧前端零感知；_module-map.yaml 解析失败按无 map 退化不 500
- UI 中文 + brand 语义阶主题 token（随主题换色，stroke=currentColor）
- 兼容 Windows/Linux/macOS
- 性能：单表 load_only 轻列内存聚合（排除 content 大列），296 行量级毫秒级

## 决策覆盖矩阵（如存在 decisions.md）
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-02, FR-03 | 健康度四指标口径 + 模块文档层覆盖基准 |
| D-002@v1 | FR-01, FR-03, FR-05 | 后端聚合端点 + 独立面板组件 + 生成类型链 |
| D-003@v1 | FR-06, FR-07 | docs-inject 遥测链复用 knowledge-hits 通道 + 榜双 tab |
