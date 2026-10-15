---
author: qinyi
created_at: 2026-10-15 16:06:28
generated_by: sillyspec-design-init
scale: "large"  # 规模评估（Step 8 精判）：无真并行任务簇（task-01→05 全链顺序依赖），按 2026-10-14 反判据「跨端/多文件/顺序依赖不构成 Wave 证据」本应倾向 small——large 的依据是**用户显式要求完整流程**：仓库 CLAUDE.md 规则 3「新功能／大改动必须走完整 SillySpec 流程技能：brainstorm → plan → execute → verify → archive」（本变更为新功能，非小修复）。如用户认为收编轻量道更合适，可直接改本值并改走 flow start。
---

# 设计文档（Design）— 2026-10-15-platform-knowledge-search

<!-- 由 sillyspec design-init 生成的骨架（2026-10-15-platform-knowledge-search）——逐节填散文后删除本注释 -->
<!-- 引用规范：全文源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## 背景

知识库页（frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx）目前只有「文件树 + 单文件查看」：322 行起的树按 zone 分组（待审核/知识手册/决策库/需求规则/自动生成），用户找内容是「凭记忆逐目录翻文件」。spec 树里已沉淀四类知识资产——知识手册（knowledge/ 顶层 7 个 md：conventions/patterns/known-issues 等）、需求规格（knowledge/fr/ 56 个 md）、决策库（knowledge/decisions/ 19 个 md）、模块文档（docs/<project>/modules/ 244 个 md，另有 scan/flows/glossary）——共 421 个 md、约 4.9MB，且经 daemon spec-sync 全量在平台侧可读（backend/app/modules/knowledge/service.py:31 `_spec_content_root` 解析口径）。

两块既有能力可以拼出这条路，但都差一步：① 平台已有向量检索基建（backend/app/modules/knowledge/vector_search.py，fastembed 本地小模型 bge-small-zh-v1.5 + 进程内懒索引 + 余弦）——但它服务于 sillyspec CLI 召回，端点只接受 `shpsync_` workspace token（vector_router.py:88）且语料只有 decisions；② 模块文档页（scan-docs）有词面搜索（backend/app/modules/scan_docs/service.py:158-169，SQL LIKE path/title/content），但只覆盖 docs 侧且无语义能力。本变更把两者合起来补齐用户侧搜索。

## 设计目标

1. 平台用户（浏览器会话）在知识库页能用一个输入框搜索四类知识资产，自然语言与精确词都能命中，结果可点击直达原文。
2. 检索为**双路融合**：词面精确匹配（编号/文件名/术语）与向量语义召回互补；fastembed 不可用时 fail-soft 降级为纯词面，页面标注、不报错。
3. 语料与索引由后端从 spec 根直读构建（懒构建 + 指纹失效自愈），不新增 DB 表、不改 daemon、不动 CLI 契约。
4. 权限与既有边界一致：KNOWLEDGE_READ 门控，docs/ 类结果按 SCAN_DOCS_READ 过滤（服务端）。

## 非目标

- 不检索 changes/ 归档（7550 个 md；噪音与体量不匹配「理解知识内容」场景，D-002）。
- 不改 POST /api/spec/knowledge/vector-search 端点与其契约（CLI 通道，D-001）。
- 不做跨 workspace / 平台级全局搜索、搜索历史、热门榜、个性化排序。
- 不做 DB 持久化索引（进程内懒构建，D-007；D-unmapped-012 死路④/③ 防复潮）。
- 不做 ⌘K 全局命令面板（原型里的 Ctrl K 键位提示仅示意，本期不注册快捷键）。

## 拆分判断

单变更、单 PR、5 个任务顺序执行即可（后端服务 → 端点 → 前端 lib+页 → scan-docs 深链 → gen:types 与测试收口）。任务间有顺序依赖（前端依赖端点 schema 定稿），不需要 Wave 真并行编排；判 large 走完整流程的理由：新功能跨双端 + 新端点契约 + 双端 gen:types 义务，仓库 CLAUDE.md 规则 3 要求新功能走 brainstorm→plan→execute→verify。

## 总体方案

分 Phase 描述（与 tasks 一一对应）：

### Phase 1：后端检索服务（NEW:backend/app/modules/knowledge/search.py）

**语料扫描**：`spec_root/knowledge/**/*.md` ∪ `spec_root/docs/**/*.md`（rglob；排除任意层级的 `INDEX.md`；symlink 不外逃——沿用 parser.py:387 的拒收口径思路）。spec_root 解析复用 `KnowledgeService._spec_content_root`（service.py:31，platform-managed 优先、`root_path/.sillyspec` 兜底——与 vector_search.py 同源口径）。

**结构切块**（D-003）：三档规则产出 `Chunk(spec_path, kind, title, anchor, start_line, text)`：
- `knowledge/decisions/*.md` → 每个 `## D-...@vN 标题` 条目一块（正则沿用 vector_search.py:35 的 `_DECISION_HEADING_RE` 形态，本模块内独立定义——不复用 CLI 契约模块避免耦合），anchor = 条目 id；
- `knowledge/fr/*.md` → 每个 `## FR-...-NNN 标题` 条目一块，anchor = FR 编号；
- 其余 md → 按 `^## ` 二级标题切块（frontmatter 段不切块、不入 embedding 文本），块超 1500 字符按 `### ` 或空行段落滑窗细分（窗 ~1000 字符 / 重叠 ~150）；够小整文件一块。anchor = 标题（无标题则 None）。

**kind 派生**（由 spec_path 判）：`knowledge/decisions/`→`decision`、`knowledge/fr/`→`fr`、`knowledge/proposed/`→`proposed`、`knowledge/generated/`→`generated`、`knowledge/` 顶层→`knowledge`、`docs/<p>/modules/`→`module`、`docs/<p>/scan/`→`scan`、`docs/<p>/flows/`→`flow`、`docs/<p>/glossary.md`→`glossary`。

**索引**（D-007）：进程内 per-(workspace_key, model_name) 缓存，指纹 = 全语料文件集 `tuple(sorted((rel_path, mtime_ns, size)))`；指纹变化即重建。与 vector_search.py 的 `_indexes`（vector_search.py:168-171）**完全独立**（不同 dict、不同条目形态——避免污染 CLI decisions 召回）。embedder 一律经 `get_embedder(settings.knowledge_embedding_model)`（vector_search.py:137-154，与 vector_router.py:57 同源参数）——**新模块不得传其他模型名**：单例是单槽位（vector_search.py:139-143 按 model_name 比对，异名会重建顶掉正在使用的实例），同名校验是「不重复加载模型」承诺（D-007）的前提。

**索引并发语义**（D-007 故障面对策细化）：构建在 `_index_lock` 内进行（同 vector_search.py:227-233 形态）——锁内构建天然 single-flight，并发首查只建一次、其余请求持锁等待；**构建顺序为「先算指纹 → 持锁构建 → 构建完成后复算指纹，若已变化则立即重建」**（防「旧内容 + 新指纹」的永久陈旧索引——先算指纹保证文件变更不被后续冒领）。构建期间发生的文件变更最迟在下一次查询被复算探知。Redis 不在链路内，多工作区按 workspace_key 隔离无串台。

**检索**（D-004）：对 chunk 全集并行两路打分后融合——
- 词面路：query（lower/trim）对 `title`/`spec_path`/`text` 子串匹配；title 命中权重最高、path 次之、正文命中按出现次数对数增益；归一化 [0,1]；title 或 path 命中者记 `word_hit_exact=True`；
- 向量路：`embed(query)` 与 chunk 向量做归一化点积（余弦，纯 Python 实现沿用 vector_search.py:179-197 口径）；
- 融合：`score = 0.6*vec + 0.4*word`，`word_hit_exact` 者 `score = max(score, 0.9)` 保底；`model_ready=False` 时 `score = word` 纯词面。
- **精确命中排前的可断言形态**：保底 0.9 是下界而非数学保证（非精确块理论可 >0.9）——成功标准「精确编号排前」落实为**相对排序断言**：单测以「查询词=某条目编号时该条目 rank=1」钉住（同分场景按词面命中优先次序 tie-break）。
- 同文件同 anchor 去重取最高分；取 limit 条返回。

**snippet**：chunk text 中 query 首次出现位置取 ±120 字符窗口（词面命中）；纯语义命中取 text 前 240 字符。截断处补省略号。

**权限过滤**（D-005）：服务层不做权限判断；**端点层 docs 过滤的判定入口钉死为 `has_permission(session, user=user, permission=Permission.SCAN_DOCS_READ, workspace_id=workspace_id)`（backend/app/modules/auth/rbac.py:109-149，is_platform_admin 短路在 :132-133）**——与门控依赖 `require_permission(KNOWLEDGE_READ)`（backend/app/core/auth_deps.py:108-132）同一权威函数，禁止读 `user.permissions` 快照或页面级权限集（那会丢掉 admin 短路与角色解析语义）。收齐结果后过滤 `spec_path.startswith("docs/")` 的项（无 SCAN_DOCS_READ 时），再截断 limit——实现上先取 `3*limit` 候选再过滤截断（D-005 故障面对策）。

### Phase 2：端点（backend/app/modules/knowledge/router.py + schema.py）

新增 `POST /workspaces/{workspace_id}/knowledge/search`。**声明序铁律**（router.py:63-69 既有注释）：按既有保守口径注册在 `GET /knowledge/{filename:path}` 通配路由（router.py:454）**之前**（本端点方法为 POST、通配为 GET，Starlette 按方法判全量匹配——声明序对 POST 非必需，但沿用铁律零成本且防未来加 GET 变体）。鉴权 `require_permission(Permission.KNOWLEDGE_READ)`（auth_deps.py:108-132，返回 User）；docs 过滤的 `has_permission(..., SCAN_DOCS_READ, ...)` 二次判定入口见 Phase 1「权限过滤」。CPU 阻塞面（索引构建/embed/余弦）经 `run_in_threadpool` 卸载（vector_router.py:58-70 同款）。

### Phase 3：前端知识库页搜索（frontend/src/lib/knowledge.ts + knowledge/page.tsx）

- lib：`searchKnowledge(workspaceId, {query, limit})` → apiFetch POST（`{method:"POST", json:input, timeoutMs: 120_000}`——首查含索引构建，POST 无缺省超时，显式放宽对齐既有显式超时纪律（先例 frontend/src/lib/knowledge.ts:463/501 的 graph 端点显式 timeoutMs），实测校准见 R-01）；类型从 api-types 生成物取别名。
- 页：左栏 pane-title 下新增搜索框（antd Input 前缀放大镜图标 + 清除按钮；debounce 300ms 对齐 scan-docs 页 297-305 行同款节流）；`debouncedQuery` 非空时结果列表**替换**文件树（同一列表位两种视图，空查询回树）；
- 结果条目：kind 徽章（中文化：决策/需求/知识/模块文档/…）+ 标题 + `spec_path` + 片段（query 词面子串高亮 `<mark>`，样式走 brand 阶）+ 匹配度小数；
- **点击跳转（口径定稿 = URL 深链驱动，与 FR-05/D-006 一致）**：`spec_path` 以 `knowledge/` 开头 → `router.push('?file=<去掉 knowledge/ 前缀的相对路径>&anchor=<anchor>')`——复用既有 URL 深链通路（page.tsx:272-275 读参 + 443-452 消费一次 + selectEntry 锚点滚动），结果**可分享、刷新保持定位**，不新增第二条选中通路；以 `docs/` 开头 → `router.push('/workspaces/{id}/scan-docs?path=...')`。
- **同 key 重选边界**（增量复审 nit-a）：URL 已消费后右栏被树点选换走（树点选不回写 URL），再点同一结果时 push 相同 URL 不触发 searchParams 变化与深链消费——push 前做等值比较，URL 与目标一致时直调 `selectEntry`（组件测试覆盖该场景）。
- **搜索态与深链互斥位点**：搜索词是组件内状态、深链是 URL 驱动，二者以「结果列表覆盖树视图」为视觉互斥；点击结果产生的 URL 变化照常触发深链 effect（key=file#anchor 变化才消费——重复点击同一结果不重复触发，符合消费一次语义）。URL 带 file/anchor 时搜索词可并存（结果列表仍在，右栏已定位）——无冲突路径，无需守卫分支。
- `model_ready === false` → 搜索框下方黄色提示条「语义模型暂不可用，当前为关键词匹配结果」；
- 编辑/审核按钮仅对当前选中条目生效，语义不变。

### Phase 4：scan-docs 页深链（frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx）

`useSearchParams()` 读 `path`；**选中链路走既有 requestDoc 通路**——列表就绪后在 `docs`（ScanDocSummary[]，scan-docs/page.tsx:204）中 `find(d => d.path === path)` 命中 summary 后调用既有 `requestDoc(summary.id)` → `getScanDoc` → `selectDoc`（scan-docs/page.tsx:338-348；不能直接对 summary 调 selectDoc——其形参是 ScanDocRead（含 content），summary 无 content 字段）。

**消费时机（防「未同步即永久落空」）**：ref 记录「已消费」，**只在命中并选中后置位**；命中前每次列表刷新（含进页 reparse 的静默刷新，scan-docs/page.tsx:279-295）都重试匹配——目标文件在下一次列表刷新出现时自动选中；用户手动点选文档同样置位（不再自动跳）。查无此文件时**静默留在列表态**（不报错、不提示、不重试任何请求）——与 FR-05 措辞统一（D-006「保持空白态并提示」以本句为准：不提示）。

### Phase 5：类型生成与测试收口

- 后端 schema 改动 → `pnpm gen:types`（frontend）+ `pnpm -C sillyhub-daemon gen:types`（规则 21 双端义务），提交 backend/openapi.json + 两端 api-types.ts；
- 后端单测：切块（三档规则/边界：空文件、无标题、超长块、frontmatter 排除）、融合排序（精确编号排前）、权限过滤（无 SCAN_DOCS_READ 时 docs 项消失）、降级（embedder 缺席纯词面）、端点层（鉴权 403 / 未知 workspace 404 / 响应形态）；
- 前端单测：搜索框交互（输入→结果列表替换树/清除还原）、结果点击跳转（knowledge 类 selectEntry；docs 类 router.push）、降级提示条、scan-docs `?path=` 深链选中。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | NEW:backend/app/modules/knowledge/search.py | 检索服务：语料扫描/三档切块/kind 派生/懒索引/词面+向量融合/snippet 提取 |
| 新增 | NEW:backend/app/modules/knowledge/tests/test_knowledge_search.py | 切块与融合检索单测（纯函数层） |
| 修改 | backend/app/modules/knowledge/schema.py | 新增 KnowledgeSearchIn / KnowledgeSearchResultItem / KnowledgeSearchOut（producer 后端 → consumer 前端 lib/knowledge.ts 与 gen:types 双端产物） |
| 修改 | backend/app/modules/knowledge/router.py | 新增 POST /knowledge/search（声明序在 GET /knowledge/{filename:path} 之前）；端点级权限过滤与降级组装 |
| 修改 | backend/app/modules/knowledge/tests/test_router.py | 端点层测试（鉴权/过滤/降级/响应形态） |
| 修改 | frontend/src/lib/knowledge.ts | searchKnowledge() + 生成类型别名导出 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx | 左栏搜索框 + 结果列表替换树 + 点击跳转 + 降级提示条 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx | ?path= 深链选中（useSearchParams + 消费一次守门） |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | 搜索交互/跳转/降级测试 |
| 修改 | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx | 深链选中测试 |
| 修改 | backend/openapi.json | gen:types 产物（纯新增 schema/端点面） |
| 修改 | frontend/src/lib/api-types.ts | gen:types 产物 |
| 修改 | sillyhub-daemon/src/api-types.ts | gen:types 产物（规则 21 daemon 同款义务） |

## 接口定义

**端点**：`POST /api/workspaces/{workspace_id}/knowledge/search`

- 鉴权：JWT（平台用户会话）+ `require_permission(Permission.KNOWLEDGE_READ)`；未知 workspace → 404（WorkspaceService.get 口径）；无 KNOWLEDGE_READ → 403。
- 请求体（Pydantic）：
  ```python
  class KnowledgeSearchIn(BaseModel):
      query: str                      # 必填；trim 后空串 → 返回空结果（200，不报错）
      limit: int = 20                 # 钳位 1..50（沿用 vector_router.py:42 的钳位口径）
  ```
- 响应体：
  ```python
  class KnowledgeSearchResultItem(BaseModel):
      spec_path: str                  # 仓根相对 POSIX：knowledge/... 或 docs/...
      kind: str                       # decision|fr|proposed|generated|knowledge|module|scan|flow|glossary
      title: str                      # 条目/标题块标题（无标题时取文件名）
      anchor: str | None              # 条目锚点（D-xxx@vN / FR-xxx-NNN / 标题），供右栏定位
      snippet: str                    # 匹配上下文片段（词面命中 ±120 字符；纯语义取前 240 字符）
      score: float                    # 融合分 [0,1]，保留 6 位小数

  class KnowledgeSearchOut(BaseModel):
      ok: bool = True
      results: list[KnowledgeSearchResultItem]   # 已按权限过滤 + 截断 limit
      model_ready: bool = True        # False = 语义模型不可用，结果为纯词面
      reason: str | None = None       # 降级原因（如 "ImportError: ..."）
  ```
- 行为契约：query 空白 → `{ok: true, results: [], model_ready: <现状>}`；语料目录缺席 → 空结果不报错；无 SCAN_DOCS_READ → 结果中无 `docs/` 前缀项（知识类结果照常返回）。

**前端函数**（frontend/src/lib/knowledge.ts）：
```ts
export function searchKnowledge(
  workspaceId: string,
  input: { query: string; limit?: number },
): Promise<KnowledgeSearchOut>;   // POST /api/workspaces/{id}/knowledge/search
```

**不改动的对外面**：vector_router.py 的 CLI 端点、scan_docs 端点、knowledge 既有读写端点全部零变化。

## 生命周期契约表

本变更不涉及生命周期契约（session/lease/agent_run/daemon 状态机零改动；检索为无状态请求-响应面）。索引缓存的「懒构建/指纹失效」是进程内缓存生命周期，已在 Phase 1 描述。

## 数据模型

无 DB schema 变更（不新增表/列/migration）。索引为进程内内存结构（见 Phase 1）；语料为文件系统直读。

## 兼容策略（brownfield 必填）

- 未配置/未使用搜索时行为不变：知识库页默认仍是文件树视图，搜索框空态零副作用；scan-docs 页无 `?path=` 参数时行为与现在完全一致。
- 既有接口与表结构零改动：CLI 向量端点、knowledge 读写端点、scan-docs 端点签名与行为不变。
- fastembed 缺席/模型加载失败 → 端点 fail-soft（model_ready=false + 纯词面结果），前端提示条；与 vector_search.py 的降级契约同语义（vector_router.py:12-14）。
- 索引缓存为进程内易失结构：进程重启后首次查询重建（行为正确性不依赖缓存命中）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 首查索引构建耗时未实测（421 文件/4.9MB，~3000+ chunks；embed 可能数十秒） | P1 | execute 阶段实测：若首查 >5s，在响应前加前端明确 loading 文案（「首次搜索正在建立索引…」）；若 >30s 再评估启动预热钩子（D-007 预留） |
| R-02 | Windows bind mount stat 性能（known-issues 有先例） | P2 | 指纹只 stat 不读内容 + 构建结果缓存；单文件 stat 失败 fail-soft 跳过（D-007 故障面） |
| R-03 | 融合权重与保底阈值（0.6/0.4、exact=0.9）是初值，可能与真实语料分布不合；且 FR-03/requirements.md:29 已引用同组数值，调参会与需求面脱钩 | P1 | 单测钉住关键行为（精确编号 rank=1 的相对排序断言/纯语义可召回）；execute 用本仓真实语料人工抽验 3-5 组 query，必要时调参并**同步回写 requirements.md FR-03 与单测断言（三方同步）** |
| R-04 | 前端搜索态与既有深链/编辑态交互冲突 | P2 | 搜索词非空时优先级最高（结果列表替换树）；deepLink ref 机制消费一次语义不变；组件测试覆盖「搜索中打开深链」场景 |
| R-05 | 大文件切块后 snippet 定位到行号的精度（右栏滚动定位锚点） | P2 | 本期右栏定位复用既有 anchor 滚动机制（锚点=条目/标题文本匹配）；定位失败时至少文件级定位（不报错） |
| R-06 | UI 原型的形态为项目惯例单 HTML（themes.ts token 复刻），非 React 真码 | P2 | 项目无 React 原型管线（51 个历史原型同为单 HTML + token 复刻形态，最近先例 2026-08-26-file-fullscreen-preview）；原型与本设计 token 单一源核对一致；用户如要求真码原型可补 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 总体方案 Phase 2（新端点）+ 接口定义「不改动的对外面」；FR-01 | 已确认 |
| D-002@v1 | 总体方案 Phase 1 语料扫描 + 非目标第 1 条；FR-01/FR-02 | 已确认 |
| D-003@v1 | 总体方案 Phase 1 结构切块；FR-02/task-01 | 已确认 |
| D-004@v1 | 总体方案 Phase 1 检索 + Phase 3 降级提示；FR-03 | 已确认 |
| D-005@v1 | Phase 2 权限过滤 + 接口定义行为契约；FR-04 | 已确认 |
| D-006@v1 | Phase 3 前端交互 + Phase 4 scan-docs 深链；FR-05 | 已确认 |
| D-007@v1 | Phase 1 索引；R-01/R-02 | 已确认 |
| D-008@v1 | 拆分判断 + 总体方案（方案 A 落地为 5 Phase） | 已确认 |
| D-009@v1 | 非目标第 2 条（CLI 端点零改动） | 已确认（落选方案防复潮） |
| D-010@v1 | 数据模型（无 DB 表）+ 非目标第 4 条 | 已确认（落选方案防复潮） |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale）
- [x] 引用所有当前版本 D-xxx@vN（D-001~D-010 全部在决策追踪表）
- [x] 涉及生命周期关键词时含「生命周期契约表」或紧邻豁免短语（已写豁免：不涉及生命周期契约）
- [x] UI 原型分级核对：涉前端文件，原型已生成 `.sillyspec/changes/2026-10-15-platform-knowledge-search/prototype-knowledge-search.html`（形态为项目惯例单 HTML + themes.ts token 复刻，非 React 真码——理由与影响记入 R-06）
- [ ] ⚠️ 自审存疑：融合权重/阈值初值（R-03）与首查耗时（R-01）需 execute 实测校准
