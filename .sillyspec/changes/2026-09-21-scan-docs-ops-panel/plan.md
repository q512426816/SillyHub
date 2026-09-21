---
plan_level: full
author: qinyi
created_at: 2026-09-21 10:02:00
---

# 实现计划（Plan）— 2026-09-21-scan-docs-ops-panel

## Wave 1（并行，无依赖）
- task-01
- task-04

## Wave 2（依赖 Wave 1）
- task-02

## Wave 3（依赖 Wave 2）
- task-03

## Wave 4（依赖 Wave 3）
- task-05

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | backend stats 数据底座：schema DTO 族（ScanDocs 前缀 9 类含 InjectionOut/BoardItem）+ ScanDocsService.stats()（单表 load_only 轻列内存聚合：覆盖率两级含 _module-map.yaml 行解析/陈旧 90 天/密度/新鲜/8 周趋势/最近更新榜 + knowledge_hits type='docs-inject' 注入聚合）+ GET /scan-docs/stats 端点（SCAN_DOCS_READ，字面量先于 {doc_id} 通配）+ test_stats.py（口径复算 + 知识 stats 不受污染断言） | W1 | P0 | — | FR-01, FR-02, FR-06(平台半), D-001, D-002, D-003 | 测试：覆盖率两级/陈旧边界/密度/新鲜/榜/注入三值/路由序 200 |
| task-04 | CLI docs-inject 埋点（sillyspec 仓）：prompt.js buildModuleContextInjection 注入命中处 + execute.js 注入孪生处（grep 实定位）append `{type:'docs-inject', change, query, matchedFiles, at}`（复用 appendKnowledgeHit，fail-soft）+ test/docs-inject-telemetry.test.mjs（命中落行/未命不落/写失败不影响注入） | W1 | P0 | — | FR-06(CLI 半), D-003 | 跨仓段（repo-key=sillyspec）；格式漂移由既有等价断言锁定 |
| task-02 | 类型链同步：pnpm gen:types 再生成 api-types.ts + openapi.json 提交 + lib/scan-docs.ts getScanDocsStats/scanDocsStatsQueryKey | W2 | P0 | task-01 | FR-05, D-002 | gen 前验 node_modules 健康（tsc --version） |
| task-03 | frontend 运营面板：scan-docs-stats-panel 组件（四子卡 2×2 + 覆盖率趋势折线 + 陈旧清单开合 + 密度口径 tooltip + 注入/最近更新双榜 tab + 三态）+ page.tsx PageHeader 下挂载（独立 useQuery）+ 组件用例 + 页面挂载冒烟 | W3 | P0 | task-02 | FR-03, FR-04, FR-07, D-001, D-002, D-003 | 视觉对齐 ops-dashboard.tsx；注入空态文案 |
| task-05 | 模块文档增量（backend/scan_docs、app-workspace-pages、NEW 新组件卡）+ 既有 scan-docs 页面测试零回归 + 原型对照复核 | W4 | P1 | task-03, task-04 | 全 FR | 文档与实现一致；CLI 仓改动同步其仓内文档（若有模块卡） |

## 关键路径
task-01 → task-02 → task-03 → task-05（task-04 与 task-01 并行后汇于 task-05 回归）

## 全局硬约束（从 design.md 逐字抄录，绑定所有 task）
- 路由注册序铁律：`/scan-docs/stats` 字面量必须声明在 `/scan-docs/{doc_id}` 通配之前（FastAPI 按声明序匹配）
- DTO 命名统一 ScanDocs 前缀（CoverageOut/DensityOut/FreshnessOut 与 knowledge/schema.py 同名会产生 OpenAPI 去重后缀）
- CLI 遥测 fail-soft：遥测写失败不影响注入本体（对齐 buildKnowledgeInjection 先例）
- 遥测行型固定 `{type:'docs-inject', change, query, matchedFiles:[docs 相对路径], at}`
- daemon 与平台 knowledge ingest 零改动（整 jsonl 上行 + 宽容落库是既有行为）；USAGE_TYPES 白名单不含 docs-inject
- UI 中文 + brand 语义阶主题 token（stroke=currentColor）；兼容 Windows/Linux/macOS
- 前端类型经 gen:types 生成提交，禁手写
- 非目标边界：不做人工浏览计数/内容体量指标/自动清理动作/跨工作区汇总

## 全局验收标准
1. 单测全绿：backend scan_docs 面（新增 test_stats.py）+ frontend 面板组件+页面 + sillyspec 仓 docs-inject 埋点用例
2. 集成冒烟：GET /scan-docs/stats 200（路由序生效）；插入 docs-inject 行后 injection 三值正确且知识库 stats 数值不变（口径隔离断言）
3. brownfield：无 docs-inject 数据（旧 CLI）→ 注入榜空态不报错；stats 接口失败 → 面板错误条不白屏不阻塞主列表；既有 scan-docs 四端点零回归
4. gen:types 产物随变更提交无手写类型

## 覆盖矩阵（如存在 decisions.md）
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-01, task-03 | AC-1（覆盖率两级/陈旧/密度/新鲜口径用例） |
| D-002@v1 | task-01, task-02, task-03 | AC-4（后端聚合端点 + 生成类型链） |
| D-003@v1 | task-01, task-03, task-04 | AC-2（docs-inject 全链：CLI 落行 → 宽容落库 → 聚合出数 + 知识 stats 不变） |
