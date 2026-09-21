---
author: qinyi
created_at: 2026-09-21 09:28:37
generated_by: sillyspec-design-init
scale: large
---

# 设计文档（Design）— 2026-09-21-scan-docs-ops-panel

## 背景

知识库在 2026-09-20-knowledge-effect-panel 变更中落地了运营指标面板（`frontend/src/components/knowledge/ops-dashboard.tsx` + `GET /workspaces/{ws}/knowledge/stats`，backend/app/modules/knowledge/router.py:240），把「知识被用起来的效果」变成一屏可读的四指标 + 使用率榜。扫描文档页（`frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx`）目前只有文档树 + 内容区，296 篇文档的结构健康度（标准七件套齐不齐、模块文档有没有跟上登记、多少文档已经烂了 90 天没人动）完全不可见，要靠人翻树发现。用户要求：参考知识库运营指标，扫描文档也做一套类似展示。

关键差异：扫描文档**没有现成命中遥测**（知识库指标的分子来自 hits 表），健康度指标围绕「覆盖 / 陈旧 / 密度 / 新鲜度 / 最近更新」重新设计（D-001@v1）；注入使用频次经用户追问定案补入（D-003@v1）——CLI 埋点 docs-inject 行复用 knowledge-hits 通道（daemon 与平台 ingest 零改动）。健康度指标数据均已在 `scan_documents` 单表（path/doc_type/exists/last_modified_at + `_module-map.yaml` 行的 content）。

## 设计目标

1. scan-docs 页顶部（PageHeader 之下、树之上，与知识库同位）挂一块运营指标面板，视觉与 OpsDashboard 同构：指标大卡（四子卡 2×2）+ 右侧榜单（1/3 栏）。
2. 四指标 + 榜单口径（D-001@v1 定稿）：
   - **标准文档覆盖率**：综合百分比 = (七件套实有 + 模块文档实有) / (项目数×7 + 登记模块数)；子行两档明细「七件套 a/b · 模块文档 c/d」；卡内附近 8 周更新趋势折线。
   - **陈旧文档**：`last_modified_at` 距今 > 90 天（或为空）的文档数，点开内嵌清单（路径 + 最后修改时间，空显示「未知」）。
   - **每项目文档密度**：exists 文档总数 ÷ 项目数（docs 树剥前缀后第一层目录数），带口径 tooltip。
   - **近 30 天更新**：近 30 天有 last_modified_at 的文档数 / 全部。
   - **最近更新榜**：按 last_modified_at 降序 Top 10（路径 + 相对时间）。
   - **注入使用频次**（D-003@v1，用户追问并入）：CLI 模块上下文注入埋点 → 平台聚合近 30 天 docs-inject 行——总次数/被注入文档数/文档级频次榜，右侧榜单双 tab（「🔥 注入频次」默认 /「🕘 最近更新」）。
3. 数据链与知识库同构（D-002@v1）：后端聚合端点 → lib 封装 → useQuery → 面板组件；面板独立数据链，不阻塞主列表。
4. 三态健壮：加载 / 错误 / 空态（无文档）均不白屏、占住同版位。

## 非目标

- **不做人工浏览计数**：注入遥测限于 CLI 机械注入（docs-inject 行型，D-003@v1）；「被人在网页点开过」类浏览行为不计数（噪声大，同知识库口径）。
- **不做自动清理/归档动作**：陈旧清单只引导（补写/归档/重扫由人工执行），同知识库死条目卡的非目标边界。
- **不做内容体量指标**（最大文档榜/截断风险）：用户在口径选择题中未选（D-001@v1 evidence）。
- **不改 reparse / 列表 / 详情既有行为**：stats 是纯新增只读端点；不改 knowledge 模块既有 ingest/stats（docs-inject 行宽容落库是既有行为，非本变更引入）。
- **不做主题适配特例**：面板走既有 brand 语义阶 token，随主题自动换色。

## 拆分判断

单变更承接：面板是一个内聚功能（一个端点 + 一个组件 + 挂载），拆成多变更会把「口径定义」和「口径实现」割裂（口径在 design 定死，实现拆开无并行收益）。不走批量模式：仅一个页面消费，无多点铺开诉求。

## 总体方案

### Wave 0 — CLI 注入遥测埋点（sillyspec 仓，D-003@v1）

sillyspec CLI 已有知识注入遥测底座：`appendKnowledgeHit`（sillyspec/src/knowledge-hits.js）通用 append 任意 `{type, change, query, matchedFiles, at}` 行，`buildKnowledgeInjection` 是消费先例（sillyspec/src/run/prompt.js:410）。本 Wave 在**模块上下文注入点**（sillyspec/src/run/prompt.js 的 buildModuleContextInjection:168 一族；execute.js 的孪生注入是 knowledge-inject 型:23/:85，模块上下文若另有孪生实现则同步埋——执行时以 grep 实定位为准）追加同款遥测：每次模块上下文注入命中时 append 一行 `{type:'docs-inject', change, query, matchedFiles:[<注入的 docs 相对路径>], at}`（fail-soft：遥测写失败不影响注入本体）。daemon 上行链路（sillyhub-daemon/src/knowledge-hits-upload.ts）整 jsonl 原样转发——**零改动**；平台 HitsService.ingest 对白名单外 type 宽容落库（backend/app/modules/knowledge/hits.py:233「外型存原值」）——**零改动**，且 USAGE_TYPES 白名单（hits.py:59）不含 docs-inject，不污染知识库 stats 口径。

### Wave 1 — 后端 stats 端点

`backend/app/modules/scan_docs/service.py` 新增 `stats(workspace_id)`：

- 一次 `load_only` 轻列查询取全部 exists 行（path/doc_type/last_modified_at，排除 content——296 行小表内存聚合，不写多条 SQL）；`_module-map.yaml` 行单独 SELECT content 解析（yaml.safe_load，取 `modules:` 字典条目数；解析失败按无 map 退化处理，不抛错）。
- 项目分组：path 剥前导包裹段（`.sillyspec`? + `docs`?，与前端 `stripPathPrefix` 同口径）后第一段；无项目段的根级文件（如历史布局）归入「(根)」伪项目。
- 覆盖率：七件套 have = Σ 各项目 `scan/` 下 doc_type ∈ STANDARD_DOC_TYPES 的去重计数；expected = 项目数 × 7（STANDARD_DOC_TYPES 恒 7，引用 backend parser 常量不复制）。模块层 have = Σ 各项目 `modules/` 下实有 .md（排除 `_module-map.yaml` 自身）；expected = Σ 各项目登记模块数，**无 map 的项目 expected 退化为该项目 have**（不虚摊覆盖率）。
- 陈旧：`last_modified_at` 为空或 < now-90d；清单含 path/doc_type/last_modified_at，按 last_modified_at 升序（最烂的在前），上限 200 条。
- 密度：total ÷ max(项目数,1)。
- 新鲜：last_modified_at ≥ now-30d 计数（分母 total）。
- 趋势：近 8 个自然周（周一为界）桶内 last_modified_at 落桶计数。
- 榜：last_modified_at 非空的 exists 行降序 Top 10。
- **注入频次（D-003@v1）**：读 `knowledge_hits` 表 `type='docs-inject'` 行（跨模块只读引用 backend/app/modules/knowledge/model.py 的 KnowledgeHit，对齐 spec_workspace 引 ScanDocument 的先例），近 30 天窗口：total_30d=行数、docs_hit_30d=matched_anchors 去重路径数、board=按路径聚合计数降序 Top 10。路径归一：遥测 matchedFiles 记 docs 树相对路径（如 `docs/SillyHub/modules/core.md`），与 scan_documents.path 对齐时统一剥 `.sillyspec`/`docs` 前导段（同前端 stripPathPrefix 口径）后比对。

`backend/app/modules/scan_docs/router.py` 新增 `GET /scan-docs/stats`（`SCAN_DOCS_READ`）。**路由注册序铁律**：字面量 `/scan-docs/stats` 必须声明在 `/scan-docs/{doc_id}` 通配之前（FastAPI 按声明序匹配；knowledge stats 同款坑，router.py:215 注释先例）。

### Wave 2 — 前端面板

- `pnpm gen:types` 同步 `frontend/src/lib/api-types.ts` + `backend/openapi.json`（同变更提交，CLAUDE.md 规则 21）。
- `frontend/src/lib/scan-docs.ts` 新增 `getScanDocsStats(workspaceId)` + 查询键导出。
- 新组件 `frontend/src/components/scan-docs-stats-panel.tsx`：复刻 OpsDashboard 布局（`lg:grid lg:grid-cols-3`，指标大卡 `lg:col-span-2` 内四子卡 `sm:grid-cols-2`）；覆盖率卡带 svg polyline 趋势（`stroke=currentColor` 随主题）；陈旧卡 button 开合内嵌清单；密度卡口径 tooltip（原生 title）；**右侧榜单双 tab**——「🔥 注入频次」（默认；路径+近 30 天次数，头部小结「近 30 天 N 次 · M 篇」）/「🕘 最近更新」（路径+相对时间）；注入频次无数据（旧 CLI 未升级）时空态「暂无注入数据（CLI 升级后自动汇聚）」并自动落到最近更新 tab 的可用态。
- `frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx`：PageHeader 之下挂载 `<ScanDocsStatsPanel workspaceId={...} />`（错误条之上，同知识库 page.tsx:462 位置语义）。

### Wave 3 — 测试与文档

- 后端 `backend/app/modules/scan_docs/tests/test_stats.py`：fixture 双项目（A 七件套齐全 + map 登记 3 模块实有 3；B 缺 2 件 + 无 map 有 2 篇模块文档）+ 陈旧/新鲜边界（91 天前/10 天前 mtime）+ docs-inject 遥测行（直插 knowledge_hits 表）断言注入频次三值。
- 前端：组件三态 + 指标渲染 + 陈旧清单开合 + 榜双 tab 切换/空态用例（`frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx`）+ 页面挂载冒烟（并入 scan-docs-page.test.tsx）。
- CLI（sillyspec 仓）：docs-inject 埋点单测（注入命中落行/未命不落/写失败不影响注入——对齐 test/knowledge-inject.test.mjs 先例形态）。
- 模块文档同步 3 份（见文件清单）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/scan_docs/schema.py | 新增 stats DTO 族 9 类（ScanDocsStatsOut/ScanDocsCoverageOut/ScanDocsStaleDocOut/ScanDocsDensityOut/ScanDocsFreshnessOut/ScanDocsRecentBoardItem/ScanDocsTrendPoint/ScanDocsInjectionOut/ScanDocsInjectionBoardItem）。数据流：producer=ScanDocsService.stats() 构造 → FastAPI response_model 序列化 → consumer=前端 api-types.ts 生成类型（gen:types） |
| 修改 | backend/app/modules/scan_docs/service.py | 新增 stats() 聚合方法（单表轻列内存聚合 + map yaml 解析 + knowledge_hits docs-inject 行聚合） |
| 修改 | backend/app/modules/scan_docs/router.py | 新增 GET /scan-docs/stats（SCAN_DOCS_READ；**声明在 /scan-docs/{doc_id} 之前**） |
| 新增 | NEW:backend/app/modules/scan_docs/tests/test_stats.py | stats 聚合口径用例（覆盖率两级/陈旧边界/密度/新鲜/榜/注入频次） |
| 修改 | backend/openapi.json | gen:types 再生成（stats 端点 schema） |
| 修改 | frontend/src/lib/api-types.ts | gen:types 再生成（ScanDocsStatsOut 族） |
| 修改 | frontend/src/lib/scan-docs.ts | 新增 getScanDocsStats + scanDocsStatsQueryKey 导出 |
| 新增 | NEW:frontend/src/components/scan-docs-stats-panel.tsx | 运营指标面板组件（四子卡+注入/更新双榜 tab+陈旧清单开合+三态） |
| 新增 | NEW:frontend/src/components/__tests__/scan-docs-stats-panel.test.tsx | 面板组件用例 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx | PageHeader 下挂载面板（独立数据链） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx | 面板挂载冒烟（mock stats 接口） |
| 修改 | .sillyspec/docs/backend/modules/scan_docs.md | 契约摘要 + stats 口径注记 |
| 修改 | .sillyspec/docs/frontend/modules/app-workspace-pages.md | ScanDocsPage 条目补面板行为 |
| 新增 | NEW:.sillyspec/docs/frontend/modules/scan-docs-stats-panel.md | 新组件模块卡 |

## sillyspec 仓变更

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | src/run/prompt.js | 模块上下文注入命中处（buildModuleContextInjection:168 一族）append docs-inject 遥测行（复用 appendKnowledgeHit:31，fail-soft）。数据流：producer=CLI 注入引擎（matchedFiles=注入 docs 相对路径）→ .runtime/knowledge-hits.jsonl → daemon 整文件上行 → consumer=平台 knowledge_hits 表（宽容落库） |
| 修改 | src/stages/execute.js | 注入孪生处同款埋点（execute.js:23/:35/:85 现为 knowledge-inject 型孪生；模块上下文若有本地孪生实现则同步改——执行时 grep 实定位，格式漂移由既有 test/knowledge-inject.test.mjs 等价断言锁定） |
| 新增 | NEW:test/docs-inject-telemetry.test.mjs | docs-inject 埋点用例（命中落行/未命不落/写失败不影响注入） |

## 接口定义

```python
# backend/app/modules/scan_docs/schema.py（新增，统一 ScanDocs 前缀——Grill 项4：
# CoverageOut/DensityOut/FreshnessOut 与 knowledge/schema.py 已有类同名，跨模块
# 同名在 OpenAPI 共享文档会产生 CoverageOut1 式去重后缀污染生成类型）

class ScanDocsTrendPoint(BaseModel):
    week: str            # 周一日期 ISO（"2026-09-15"）
    updated: int         # 该周桶内更新文档数

class ScanDocsCoverageOut(BaseModel):
    std_have: int        # 七件套实有（Σ 各项目 scan/ 标准类型去重）
    std_expected: int    # 项目数 × 7
    module_have: int     # modules/ 实有 .md（排除 _module-map.yaml）
    module_expected: int # Σ 登记模块数（无 map 项目退化为实有）
    trend: list[ScanDocsTrendPoint]  # 近 8 周

class ScanDocsStaleDocOut(BaseModel):
    path: str
    doc_type: str
    last_modified_at: datetime | None = None   # null=未知时间

class ScanDocsDensityOut(BaseModel):
    per_project_avg: float   # total ÷ max(项目数, 1)

class ScanDocsFreshnessOut(BaseModel):
    recent_updated: int
    total: int

class ScanDocsRecentBoardItem(BaseModel):
    path: str
    doc_type: str
    last_modified_at: datetime

class ScanDocsInjectionBoardItem(BaseModel):
    path: str            # 剥前缀后的 docs 路径（与树/卡片锚点同口径）
    hits_30d: int        # 近 30 天被注入次数

class ScanDocsInjectionOut(BaseModel):
    total_30d: int       # docs-inject 行数（近 30 天）
    docs_hit_30d: int    # 被注入文档去重数
    board: list[ScanDocsInjectionBoardItem]  # 按次数降序 Top 10

class ScanDocsStatsOut(BaseModel):
    coverage: ScanDocsCoverageOut
    stale_docs: list[ScanDocsStaleDocOut]   # 最旧在前，上限 200
    density: ScanDocsDensityOut
    freshness: ScanDocsFreshnessOut
    recent_board: list[ScanDocsRecentBoardItem]  # last_modified_at 降序 Top 10
    injection: ScanDocsInjectionOut         # D-003@v1（旧 CLI 无遥测 → 全零值，前端空态）

# service.py
async def stats(self, workspace_id: uuid.UUID) -> ScanDocsStatsOut: ...

# router.py（声明序：在 get_scan_doc 通配之前）
@router.get("/scan-docs/stats", response_model=ScanDocsStatsOut)
async def get_scan_docs_stats(workspace_id, session, _user=Depends(require_permission(Permission.SCAN_DOCS_READ))) -> ScanDocsStatsOut
```

```typescript
// frontend/src/lib/scan-docs.ts（新增）
export function scanDocsStatsQueryKey(workspaceId: string) { return ["scan-docs", "stats", workspaceId] as const; }
export function getScanDocsStats(workspaceId: string) { return apiFetch<ScanDocsStatsOut>(`/api/workspaces/${workspaceId}/scan-docs/stats`); }
// ScanDocsStatsOut = components["schemas"]["ScanDocsStatsOut"]（gen:types 生成）

// frontend/src/components/scan-docs-stats-panel.tsx
export function ScanDocsStatsPanel({ workspaceId, className }: { workspaceId: string; className?: string })
```

生命周期契约：无/N/A（纯只读聚合端点，不涉及 session/lease/daemon 状态转移）。

## 数据模型

无 schema 变更：`scan_documents` 表零改动，stats 全部从既有列派生（path/doc_type/exists/last_modified_at + `_module-map.yaml` 行 content）。

## 兼容策略（brownfield 必填）

- 纯新增只读端点：不调用时一切行为不变；旧前端（未部署面板）零感知。
- 面板三态兜底：stats 接口失败显示错误条不白屏、不阻塞主列表（独立 useQuery）；无文档工作区显示空态卡。
- `_module-map.yaml` 解析失败（yaml 损坏/字段缺失）按「无 map」退化（模块层 expected=have），不抛 500。
- 不改变的 API：list/get/reparse/conflicts 四端点与既有 DTO 原样。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | `_module-map.yaml` 为 sillyspec-scan 机器生成物，登记模块数随重扫漂移 → 覆盖率分母漂移 | P2 | 预期行为（map 即真相源）；卡面子行透出两档明细 a/b，漂移可解释 |
| R-02 | last_modified_at 为空的存量行被全量计入陈旧，数字虚高 | P2 | 清单行显示「未知」；reparse 会随访问补齐 mtime，自然收敛 |
| R-03 | 路由声明序错误导致 stats 被 {doc_id} 通配吞掉（doc_id 按 UUID 解析失败返回 422） | P1 | router.py 声明序铁律注释 + test_stats 断言 GET /scan-docs/stats 200 |
| R-04 | gen:types 环节 node_modules 半坏报假类型错 | P2 | CLAUDE.md 规则 21 流程：先 `pnpm exec tsc --version` 验健康再生成 |
| R-05 | 大工作区（数千文档）stats 内存聚合变慢 | P2 | 当前量级 296 行；load_only 已排除 content；超千行再演进 SQL 聚合（非本变更） |
| R-06 | 跨仓交付节奏：sillyspec CLI 未升级的环境永远无 docs-inject 行 → 注入频次恒空态 | P1 | 前端空态文案明示「CLI 升级后自动汇聚」；榜单双 tab 保底切最近更新；不报错不阻塞 |
| R-07 | docs-inject 行与知识 inject 行共用 jsonl/表，误入知识统计口径 | P1 | USAGE_TYPES 白名单（hits.py:59）不含 docs-inject，知识 stats 天然排除；test_stats 断言知识 stats 不变（防回归） |
| R-08 | CLI 注入点孪生实现（prompt.js / execute.js）改一处漏一处 | P2 | 格式等价单测锁定（既有 test/knowledge-inject.test.mjs 先例）+ 新增 docs-inject 用例双点覆盖 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 设计目标 §2（四指标口径）、总体方案 Wave 1（覆盖率/陈旧/密度/新鲜/榜计算规则）、非目标（不做体量/遥测） | 已覆盖 |
| D-002@v1 | 总体方案（后端聚合端点 → lib → useQuery → 面板，与知识库同构）、文件变更清单、接口定义 | 已覆盖 |
| D-003@v1 | 总体方案 Wave 0（CLI 埋点复用 knowledge-hits 通道）、Wave 1 注入频次聚合、Wave 2 榜双 tab、sillyspec 仓变更段、R-06~R-08 | 已覆盖 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/拆分判断/总体方案/文件变更清单/接口定义/数据模型/兼容策略/风险登记/决策追踪/自审）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-xxx@v1（D-001/D-002/D-003 均已覆盖）
- [x] 生命周期契约豁免短语已写（「生命周期契约：无/N/A」紧邻标题）
- [x] UI 原型已生成（prototype-scan-docs-ops-panel.html，页面新增视图级面板属「必须生成」档；注入频次并入后榜单双 tab 为组件内局部变化，原型以文字口径为准）
- [x] 跨仓段落头格式合规（`## sillyspec 仓变更`，路径相对该仓根，repo-key 已在 local.yaml repos: 注册）
- [x] 无自审存疑项：口径均有数据源可算、端点纯增量、路由序风险已有测试兜底、docs-inject 全链路（CLI→daemon→平台）每跳零改动或增量已逐跳核实
