---
author: qinyi
created_at: 2026-09-21 01:29:55
generated_by: sillyspec-fourpiece-init
---
# 提案书（Proposal）

## 动机
知识库已有运营指标面板（四指标+使用率榜，2026-09-20-knowledge-effect-panel），资产健康度一屏可读。扫描文档页（本仓 296 篇、5 个子项目）只有文档树+内容区，标准七件套齐不齐、模块文档有没有跟上 _module-map.yaml 登记、多少文档 90 天没人动，全靠人翻树发现。用户要求：参考知识库运营指标，扫描文档也做一套类似展示。

## 关键问题
1. 扫描文档没有命中遥测（知识库指标的分子来自 hits 表），指标口径必须重设计——围绕覆盖/陈旧/密度/新鲜度的文档健康度。
2. 「应有多少文档」无基准：纯文档数没有意义，需要 _module-map.yaml 登记数（模块层）+ STANDARD_DOC_TYPES 七件套（扫描层）作分母，两者均已在 scan_documents 表内。
3. 指标散在前端算会逐项目拉 yaml 详情（请求多、口径漂移），须与知识库同构走后端聚合端点。

## 变更范围
backend 新增 GET /scan-docs/stats 只读聚合端点（覆盖率两级口径含 map 解析/陈旧 90 天清单/每项目密度/近 30 天新鲜度/8 周趋势/最近更新榜 Top10，单表轻列内存聚合）；frontend 新增 ScanDocsStatsPanel 面板组件（视觉对齐 OpsDashboard）挂 scan-docs 页顶部 + lib 封装 + gen:types 类型链；**注入使用频次遥测（D-003@v1，用户追问并入）**——sillyspec CLI 模块上下文注入埋点 docs-inject 行（复用 knowledge-hits.jsonl 通道，daemon 与平台 ingest 零改动）+ stats 注入聚合（近 30 天次数/文档数/频次榜）+ 面板榜单双 tab；后端/前端/CLI 测试与模块文档同步。

## 不在范围内（显式清单）
- 不做人工浏览计数（注入遥测限于 CLI 机械注入 docs-inject 型）
- 不做内容体量指标（最大文档榜/截断风险，用户未选）
- 不做自动清理/归档动作（陈旧清单仅引导，人工执行）
- 不改 reparse/list/get/conflicts 既有端点行为；不改 knowledge 模块既有 ingest/stats
- 不做跨工作区汇总（面板按单 workspace）

## 成功标准（可验证）
- 本仓工作区打开 scan-docs 页：顶部面板出数——覆盖率可手工复算（七件套 a/b · 模块文档 c/d 与 docs 树实际一致）、陈旧数与清单一致、密度=总数/项目数、近 30 天更新数可对拍 git log 量级
- CLI 升级后跑一次 quick/execute：.runtime/knowledge-hits.jsonl 出现 docs-inject 行 → daemon 同步上行 → 平台注入频次卡/榜出数；旧 CLI 环境注入榜空态不报错
- 知识库 stats 各指标在有 docs-inject 行前后数值不变（口径不受污染，断言锁定）
- 面板三态：接口失败出错误条不白屏、无文档工作区出空态、均不阻塞主列表加载
- GET /scan-docs/stats 在 {doc_id} 通配之前注册（请求不被吞，集成断言 200）
- api-types.ts/openapi.json 同步再生成提交（无手写类型）
- 既有 scan-docs 页面功能（树/搜索/卡片视图/后台同步）零回归
