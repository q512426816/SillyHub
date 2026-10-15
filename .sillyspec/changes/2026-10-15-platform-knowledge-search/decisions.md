---
author: qinyi
created_at: 2026-10-15 15:59:42
generated_by: sillyspec-fourpiece-init
change: 2026-10-15-platform-knowledge-search
---

# 决策记录（Decisions）

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-001@v1: 检索端点新建（平台用户侧），不复用 CLI 的 shpsync_ 端点
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 平台搜索能力挂在哪个端点上？现有 POST /api/spec/knowledge/vector-search 能否直接用？
- answer: 现有端点（2026-10-15-platform-vector-search 落地）只接受 shpsync_ workspace token（CLI 契约固化，非 shpsync_ 一律 403），且语料只索引 knowledge/decisions——消费方是 sillyspec CLI，前端 JWT 无法调用。平台用户侧必须新建独立端点；CLI 端点契约零改动（同号消歧/降级纪律是 CLI 侧语义）。
- normalized_requirement: 新增平台用户侧搜索端点，走 JWT + require_permission 鉴权；现有 /api/spec/knowledge/vector-search 端点与其测试零改动。
- impacts: [task-01, task-02, verify-01]
- evidence: backend/app/modules/knowledge/vector_router.py:88（scope.workspace_id is None → PermissionDenied）；backend/app/modules/knowledge/vector_router.py:7-11（文件头契约注释）；backend/app/main.py:965（knowledge_vector_router 挂载）
- 故障面: 双端点并存可能造成语料/索引重复建设——通过共享 embedder 单例与解析工具函数收敛（见 D-007）。
- 退役判据: 若 CLI 侧日后改用用户会话调用平台（CLI 本地零凭据约束解除），可评估收敛为单端点。

## D-002@v1: 语料范围 = knowledge/ 全域 + docs/ 全域，不含 changes/ 归档
- type: boundary
- priority: P0
- status: accepted
- source: user
- question: 搜索覆盖哪些文档？（用户原话：「包括 知识、需求规格、决策、模块文档等」）
- answer: 用户列举四类映射到 spec 树：知识=knowledge/ 顶层手册（conventions/patterns/known-issues 等）、需求规格=knowledge/fr/、决策=knowledge/decisions/、（另有 proposed/generated 两个 zone 一并纳入）；模块文档=docs/<project>/modules/，随行纳入 docs/<project>/{scan,flows,glossary.md} 等全部 md。changes/（本仓 7550 个 md，归档历史持续增长）不纳入——噪音大、非「理解知识内容」的主场，且与知识库页现有导航面不匹配。
- normalized_requirement: 语料 = {spec_root}/knowledge/**/*.md ∪ {spec_root}/docs/**/*.md（排除 INDEX.md 类索引文件）；changes/ 与 .runtime/ 零收录。
- impacts: [task-01, verify-02]
- evidence: backend/app/modules/knowledge/parser.py:17（ZONE_SUBDIRS=decisions/generated/proposed/fr）；backend/app/modules/knowledge/parser.py:387（parse_knowledge_entries 解析口径）；.sillyspec/docs 目录结构（SillyHub/backend/frontend/multi-agent-platform/sillyhub-daemon 五项目，modules 244 个 md）
- 故障面: docs/ 大文件（本仓 frontend.md 120KB、fr/backend.md 350KB）整文件 embed 会爆索引时间与召回精度——由切块策略消化（D-003）。
- 退役判据: 若用户明确要求搜归档变更文档，再评估纳入 changes/ 的独立 scope（分面开关）。

## D-003@v1: 切块策略——条目锚点优先（D-xxx@vN / FR-xxx-NNN）+ 标题切块 + 超长滑窗
- type: architecture
- priority: P1
- status: accepted
- source: code
- question: 大文件（350KB 级）如何切块才能既召回准又可定位？
- answer: 三档策略：① decisions/*.md 按 `## D-xxx@vN 标题` 条目切（复用现有 parse_decision_entries 口径扩展）；② fr/*.md 按 `## FR-xxx-NNN 标题` 条目切；③ 其余 md（模块文档/scan/flows/knowledge 顶层）按 `##`/`###` 标题切块，单块超 1500 字符再按段落滑窗细分（窗 ~1000 字符 / 重叠 ~150 字符）。每块携带 (文件路径, 锚点/标题, 片段起点) 供前端跳转定位。frontmatter 不入 embedding。
- normalized_requirement: 每个 chunk 携带可定位锚点（条目 id 或标题 slug）；决策/fr 条目级切块，其余标题级切块；切块阈值 = 1500 字符上限、滑窗 1000 字符、重叠 150 字符（与 design.md Phase 1 同值，单测基准同源）；超长块滑窗细分且块间保持 >0 overlap。
- impacts: [task-02, verify-02]
- evidence: backend/app/modules/knowledge/vector_search.py:35（_DECISION_HEADING_RE 条目正则先例）；.sillyspec/knowledge/fr/lib-api.md:1（`## FR-lib-api-001 标题` 条目格式实证）；.sillyspec/docs/multi-agent-platform/modules/frontend.md:1-12（frontmatter + `# 前端控制台（frontend）` + `## 定位` 结构实证）
- 故障面: 切块粒度不齐会让融合打分跨档不可比——按块文本长度做归一化惩罚（设计细化）。
- 退役判据: 若引入第三方切块库（unstructured 等）且验证更优，可整体替换本策略。

## D-004@v1: 检索算法 = 词面 + 向量融合，向量不可用 fail-soft 纯词面
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 「搜索匹配能力」用什么召回？（用户原话：「基于 [cli 向量检索] 做个搜索匹配能力」）
- answer: 双路融合：词面路子串/大小写不敏感匹配（文件名、标题、正文——scan-docs 已有 LIKE 先例；中文短词精确命中向量不敏感场景必须词面兜底）+ 向量路 fastembed bge-small-zh-v1.5 语义召回（复用平台既有 embedding 基建）。两路分数归一化后加权融合。fastembed 缺席/模型加载失败时（容器无模型、显存不足）端点 fail-soft 返回纯词面结果 + model_ready=false 标注，前端降级展示提示。
- normalized_requirement: 同 query 下词面命中与语义命中合并为单一结果列表（去重取最高分）；model_ready=false 时结果不空且响应头/字段标注降级。
- impacts: [task-02, task-03, verify-03]
- evidence: backend/app/modules/knowledge/vector_search.py:137（get_embedder fail-soft 单例先例）；backend/app/modules/scan_docs/service.py:158-169（LIKE 词面搜索先例）；backend/app/core/config.py（knowledge_embedding_model 配置项）
- 故障面: 权重失当会让语义噪声压过精确词面命中（如搜文件名被近似文本挤掉）——文件名/标题命中给固定高权重保底（设计细化）。
- 退役判据: 若纯向量在真实语料上人工评测优于融合，可简化为单路。

## D-005@v1: 鉴权 = JWT 铸造 + KNOWLEDGE_READ 门控，docs/ 结果按 SCAN_DOCS_READ 过滤
- type: boundary
- priority: P0
- status: accepted
- source: code
- question: 平台搜索端点的权限边界？（语料横跨 knowledge 与 scan-docs 两个权限域）
- answer: 端点门控 require_permission(KNOWLEDGE_READ)（搜索入口在知识库页，与页内其它读接口同权限）；docs/ 类结果额外检查调用者是否持有 SCAN_DOCS_READ——无则该类结果从响应中过滤（不是 403，知识结果照常返回）。管理员经 is_platform_admin 短路天然全量。
- normalized_requirement: 无 KNOWLEDGE_READ → 403；无 SCAN_DOCS_READ → 响应中不含 spec_path 以 docs/ 开头的结果（服务端过滤，非前端隐藏）。
- impacts: [task-01, task-04, verify-04]
- evidence: backend/app/modules/auth/permissions.py:78（KNOWLEDGE_READ）；backend/app/modules/auth/permissions.py:76（SCAN_DOCS_READ）；backend/app/modules/knowledge/router.py:57（list_knowledge 权限门控先例）；backend/app/modules/scan_docs/router.py:40-46（scan-docs 读接口权限先例）
- 故障面: 权限过滤若发生在召回后置阶段，可能把 top-k 挤空导致结果稀薄——取 3×limit 候选再过滤截断（设计细化）。
- 退役判据: 若平台引入统一「知识域」权限（合并 knowledge/scan-docs 读），过滤逻辑随之删除。

## D-006@v1: 交互形态 = 知识库页内嵌搜索 + 结果面板 + 双落点跳转
- type: architecture
- priority: P1
- status: accepted
- source: user
- question: 搜索入口放哪？结果点开落到哪？
- answer: 知识库页（/workspaces/[id]/knowledge）顶部内嵌搜索框（用户原话场景：方便在知识库里检索数据和理解知识内容）；结果面板展示 来源徽章/文件路径/条目或标题/片段高亮/匹配度。点击落点分两类：knowledge/ 结果 → 既有深链 ?file=&anchor=（page.tsx deepLinkDoneRef 机制现成）；docs/ 结果 → scan-docs 页新增 ?path= 深链（该页现无 URL 参数定位，需补选中逻辑）。片段文本随结果直接展示，不点开也能看到匹配上下文。
- normalized_requirement: 知识库页可搜索；knowledge 结果跳现有深链；docs 结果跳 scan-docs 页并选中目标文档；搜索历史/最近无要求。
- impacts: [task-04, task-05, verify-05]
- evidence: frontend/src/app/(dashboard)/workspaces/[id]/knowledge/page.tsx:443-452（deepLinkDoneRef 深链机制）；frontend/src/lib/knowledge.ts:99-104（normalizeKnowledgeFileParam 仅认 knowledge/ 前缀）；frontend/src/app/(dashboard)/workspaces/[id]/scan-docs/page.tsx:209（selectedDoc state，无 URL 参数入口）
- 故障面: scan-docs 深链若只按 path 精确匹配而 workspace 尚未同步该文件，会静默落空——落空时保持空白态静默（不报错、不提示、不重试请求）；消费时机对策：ref 只在命中并选中后置位，命中前每次列表刷新（含 reparse 静默刷新）重试匹配，目标出现即自动选中（design.md Phase 4，评审 X5 修订）。
- 退役判据: 若日后引入全局 ⌘K 命令面板聚合搜索，页内搜索框可降级为入口之一。

## D-007@v1: 索引生命周期 = 懒构建 + 全语料指纹失效，独立于 decisions 向量索引
- type: architecture
- priority: P1
- status: accepted
- source: code
- question: 400+ 文件、5MB 级语料的索引在哪建、何时失效？与现有 decisions 索引什么关系？
- answer: 沿用 vector_search.py 已验证的「查询时懒构建 + 文件集指纹 (name, mtime_ns, size) 失效自愈」模式，但**独立索引实例**——现有 _indexes 键是 (workspace_key, model_name) 且条目形态是 DecisionEntry，直接复用会被新语料污染 CLI 召回结果；新建模块（如 search_index.py）自带索引缓存与指纹。首查构建耗时用前端 loading 文案消化；若实测构建 >5s 则在端点内保留可选的启动后台预热钩子（execute 阶段实测拍板）。
- normalized_requirement: 新搜索索引与 decisions 索引互不污染；文件增删改自动失效；embedder 单例进程级共享（不重复加载模型）。
- impacts: [task-02, task-03, verify-03]
- evidence: backend/app/modules/knowledge/vector_search.py:168-172（_indexes 键结构）；backend/app/modules/knowledge/vector_search.py:227-233（懒构建+指纹换缓存实现）；backend/app/modules/knowledge/vector_search.py:99-111（decisions_fingerprint 先例）
- 故障面: 全语料指纹 mtime 轮询在 Windows bind mount 上有 stat 性能断崖（known-issues 有先例）——指纹只 stat 文件不读内容，且构建结果缓存，风险可控；实现时对单次 stat 失败 fail-soft 跳过。
- 退役判据: 若 daemon 上行时能顺带维护持久化索引，可退役进程内懒构建（届时索引落 DB）。

## D-008@v1: 实现方案选定——方案 A（新用户侧端点 + 文件系统直读 + 词面/向量融合）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 平台搜索能力用哪种实现路径？（方案 A 新用户侧端点+文件直读+双路融合 / 方案 B 扩展 CLI 向量端点 / 方案 C DB 表混合检索）
- answer: （autonomous 会话代拍板——用户未在线，AI 按仓库既有约束与 D-001~D-007 权衡代选方案 A，待用户复核）方案 A：新建独立搜索服务与用户侧端点，spec 根直读文件、结构切块、词面与向量双路融合、进程内懒索引。理由：①唯一不破坏 CLI 契约（B 的问题）又能复用平台 embedding 基建的路径；②文件直读与 vector_search.py 已验证的懒构建同构，故障面最小；③切块/权限/降级全可控。
- normalized_requirement: 新建 backend/app/modules/knowledge/search.py（或等价命名）+ POST /api/workspaces/{workspace_id}/knowledge/search；不修改 vector_router.py/vector_search.py 的对外契约。
- impacts: [task-01, task-02, task-03, task-04, task-05]
- evidence: 方案对比表见本变更 proposal.md「方案对比与选择（Step 4）」节；backend/app/modules/knowledge/vector_search.py:200-235（懒构建先例）；backend/app/modules/knowledge/vector_router.py:88（CLI 通道限制——B 放弃的直接依据）
- 故障面: 前端需同时接两个后端查询面（知识搜索 + scan-docs 列表）做跳转；若 scan-docs 深链不同步做，docs 结果不可直达（风险已记 D-006）。
- 退役判据: 若 B/C 的否决条件消失（见 D-009/D-010 复潮条件），可重议。

## D-009@v1: 落选——方案 B（扩展 CLI 向量端点至全语料 + 放开 JWT）
- type: architecture
- priority: P1
- status: rejected
- source: user
- question: 平台搜索能力用哪种实现路径？
- answer: （autonomous 会话代拍板落选，待用户复核）不选 B。
- normalized_requirement: 不修改 /api/spec/knowledge/vector-search 的鉴权通道与语料范围。
- impacts: [task-01]
- evidence: backend/app/modules/knowledge/vector_router.py:7-15（文件头契约：CLI 唯一消费方、shpsync_ 固化）；sillyspec CLI src/knowledge-vector.js:11-20（四层检索契约，向量层输出按决策条目 anchor 语义消费）
- 否决理由: 破坏 CLI 契约——CLI 向量层结果按决策条目 anchor 语义消费（同号消歧/策略面本地解析），混入非决策条目即破坏召回语义；shpsync_ 通道与 JWT 用户会话鉴权模型冲突，强行放开需重造鉴权分支。
- 复潮条件: CLI 侧检索契约弃用 anchor 语义（或 CLI 全量改用用户会话调用平台）且平台侧统一鉴权通道时，可重议单端点收敛。

## D-010@v1: 落选——方案 C（基于 DB 表混合检索：ScanDocument + 新增 knowledge 入库链路）
- type: architecture
- priority: P1
- status: rejected
- source: user
- question: 平台搜索能力用哪种实现路径？
- answer: （autonomous 会话代拍板落选，待用户复核）不选 C。
- normalized_requirement: 检索不为 knowledge 侧新建 DB 表或 daemon 上行链路。
- impacts: [task-02]
- evidence: knowledge/decisions/unmapped.md:3188（D-unmapped-012@v1 死路④「daemon sync 挂点灌索引——免 daemon 改动的懒构建已覆盖，挂点属过早优化」）；backend/app/modules/scan_docs/service.py:146-194（ScanDocument 只覆盖 docs 侧，knowledge 侧无对应表）
- 否决理由: knowledge 侧无 DB 表，需新增同步链路（daemon 挂点或轮询），命中既有防复潮死路④；且 D-unmapped-012 死路③（pgvector/DB 往返）同域否决；延迟同步与索引维护复杂度都高于文件直读。
- 复潮条件: 出现跨 workspace 聚合检索需求（单 workspace 文件直读不满足）或语料量级远超万条致文件直读不可行时，可重议持久化索引方案。

