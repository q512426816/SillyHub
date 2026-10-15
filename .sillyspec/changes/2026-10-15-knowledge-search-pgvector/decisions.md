---
author: qinyi
created_at: 2026-10-15 20:19:20
generated_by: sillyspec-fourpiece-init
change: 2026-10-15-knowledge-search-pgvector
---

# 决策记录（Decisions）

## D-001@v1: 向量索引持久化选型 = PostgreSQL pgvector（用户裁决）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 知识搜索的向量索引从进程内存改为持久化，存哪里？
- answer: 用户裁决走 pgvector。重议依据成立：上一变更（2026-10-15-platform-knowledge-search）design R-01 实测首查 304.67s（6586 chunks/437 文件）且语料持续增长，触发其归档决策 D-unmapped-012 死路③的复潮条件「语料量级远超万条致文件直读不可行」的同类信号（重启代价随语料线性恶化）；当时否决前提「2400 条暴力余弦毫秒级、首查秒级可接受」已被 304s 实测打破。选 pgvector 而非本地文件缓存的理由：重启零重建、增长曲线稳定（KNN 毫秒级不随量级退化）、数据可查可运维；复杂度大头（增量同步）两方案等价。
- normalized_requirement: 向量与 chunk 元数据持久化到 PostgreSQL pgvector 表；重启后查询秒级就绪（不再全量重嵌入）；首查冷启动仅在建库未完成时出现一次。
- impacts: [FR-01, FR-02, task-01, task-02]
- evidence: 用户会话原话「确认，但是我之前记得早都已经迁移过呀」→ 核实代码/migrations/部署均无 pgvector 痕迹（仅有 pgcrypto/pg_trgm），旧接口 /api/spec/knowledge/vector-search 底层为 fastembed+进程内存；deploy/docker-compose.yml:7 image=postgres:16-alpine（不带 vector）。
- 故障面: PG 不可用/表损坏 → 检索降级纯词面（与 embedder 缺席同款 fail-soft，不 5xx）。
- 退役判据: 若未来迁移到专用向量库（milvus/qdrant），本方案整体退役。
- 模块域: backend

## D-002@v1: 表结构 = chunks 表 + state 表（workspace 级指纹与模型版本）
- type: architecture
- priority: P0
- status: accepted
- source: code
- question: 持久化的表怎么组织？
- answer: 两表：①knowledge_search_chunks（workspace_id FK、spec_path/kind/title/anchor/start_line/text、embedding vector(512)、行级内容 hash 用于差量比对；索引：workspace_id + 查询用 ivfflat/hnsw cosine——量级 ~7k 起步 hnsw 更优但 PG16 vector 扩展两者皆可，初版建基础索引+KNN，量级到十万再补 ANN 索引）；②knowledge_search_state（workspace_id 唯一、corpus_fingerprint JSON、model_version、updated_at）——指纹存 state 而非逐 chunk，与现有 corpus_fingerprint() 单一源口径一致。ORM 先例对齐 hits.py 的 KnowledgeHit(BaseModel, table=True)。
- normalized_requirement: embedding 列 PG 方言 = vector(512)（with_variant，SQLite 变体 JSON 文本——测试引擎为 aiosqlite 内存库，backend/conftest.py:248）；迁移含 CREATE EXTENSION IF NOT EXISTS vector + 方言守卫（非 PG 直接 return，pg_trgm 先例 20260825150000）。
- impacts: [FR-01, task-01]
- evidence: backend/app/modules/knowledge/hits.py:79（模块内 ORM 先例）；backend/migrations/versions/20260825150000_agent_run_logs_trgm_index.py:34（方言守卫先例）；backend/conftest.py:248（SQLite 测试引擎）。
- 故障面: bge-small-zh-v1.5 维度 512 硬编码 → 换模型维度变化需迁移改列——model_version 字段触发全量重算兜底，维度变更走显式迁移。
- 退役判据: 无。
- 模块域: backend

## D-003@v1: 增量同步 = 查询时指纹比对 + 差量 upsert/delete（无后台任务）
- type: architecture
- priority: P0
- status: accepted
- source: code
- question: 文件增删改后库里的向量怎么跟着变？
- answer: 沿用现内存方案的懒触发形态：每次查询先算 corpus_fingerprint（全语料 (path, mtime_ns, size) 元组）与 state 表比对——一致直接查库；不一致进入差量同步：逐文件比内容 hash（新文件插入、变更重嵌、消失删除），完成后更新 state。不改 daemon、不加后台任务、不加同步配置——上一变更 D-010 死路④（daemon 挂点）继续规避。首查构建与差量同步走 run_in_threadpool 同款卸载。
- normalized_requirement: 同步在查询路径内联完成（锁内 single-flight 防并发重复嵌入，对齐现 _index_lock 语义）；同步失败 fail-soft 降级纯词面；指纹/内容 hash 双层比对（指纹变了才逐文件比 hash）。
- impacts: [FR-03, task-02]
- evidence: backend/app/modules/knowledge/search.py 的 corpus_fingerprint/_build_index_locked/构建后复算（现有懒构建语义直接平移到 DB 面）。
- 故障面: 指纹漂移（mtime 变了内容没变）→ 逐文件 hash 层吸收（hash 未变不重嵌，只更新记录）。
- 退役判据: 若引入文件监听（watcher）主动同步，懒触发可退役。
- 模块域: backend

## D-004@v1: 查询方言分叉 = PG 走 pgvector KNN；SQLite/降级走候选拉回 Python 余弦
- type: architecture
- priority: P0
- status: accepted
- source: code
- question: 测试环境（SQLite 内存库）没有 vector 类型与 KNN 算子，怎么办？
- answer: 查询层按 dialect 分叉：PG → ORDER BY embedding <=> :q LIMIT k（余弦距离，1-distance 转回相似度）；SQLite（测试）→ 拉回该 workspace 全部 chunk 的 embedding（JSON 文本解析）Python 余弦打分（7k 条×512 维纯 Python 毫秒~十毫秒级，测试可接受）。方言分叉先例：patrol.py _dialect_name、scan_docs LIKE 跨方言注释。
- normalized_requirement: 两方言下 search_sync 返回形态逐字段一致（测试同源覆盖）；词面路不受分叉影响。
- impacts: [FR-01, FR-02, task-02]
- evidence: backend/app/modules/agent/patrol.py:176（方言分支先例）；backend/app/modules/knowledge/search.py:174-197（Python 余弦现成实现可复用为 SQLite 路径）。
- 故障面: SQLite 路径性能随 chunk 数线性——仅测试环境受影响，量级受控（测试语料人工构造）。
- 退役判据: 测试库换 PG（testcontainers）时统一走 KNN。
- 模块域: backend

## D-005@v1: 对外契约零变化（search_sync 签名/返回形态/端点/前端均不动）【已被 D-005@v2 修订执行模型，契约冻结口径不变】
- type: boundary
- priority: P0
- status: accepted
- source: code
- question: 持久化改造会不会波及接口与前端？
- answer: 不会也不允许：search_sync(spec_root, workspace_key, query, limit, embedder, model_name, embedder_error) 签名与 {results, model_ready, reason} 返回形态保持；POST /knowledge/search 端点、api-types、前端搜索 UI 全部零改动。改造收敛在 search.py 内部（索引层换 DB）+ 新增表/迁移。唯一新增入参面：session（AsyncSession）——路由已持有，注入即可，属内部协作面。
- normalized_requirement: 上变更的 199+46 测试除 monkeypatch 注入点外零改动全绿（端点测试的 fake embedder 注入路径 get_embedder 保持）。
- impacts: [FR-04]
- evidence: backend/app/modules/knowledge/router.py search 端点（run_in_threadpool 调 search_sync——DB 操作在 threadpool 内用独立 session，对齐 BQ-2 注释先例）。
- 故障面: threadpool 内新建 AsyncSession 的生命周期管理——用 async_sessionmaker 工厂短会话，异常回滚。
- 退役判据: 无。
- 模块域: backend

## D-006@v1: 词面路去内存全量化 = SQL ILIKE 候选 + Python 精确打分
- type: architecture
- priority: P1
- status: accepted
- source: code
- question: chunks 入库后，词面匹配还需要在内存里持有全量文本吗？
- answer: 不需要：词面候选用 SQL（WHERE title/spec_path/text ILIKE %q% ESCAPE，跨方言对齐 scan_docs LIKE 转义先例）取回候选集，Python 侧按现 _word_score 口径精确打分（anchor/title/path/text 权重与次数增益）。候选集小（命中项），单查开销可控；重启后词面路同样零重建。零信号过滤语义保持。
- normalized_requirement: 融合公式与保底语义不变（0.6*vec+0.4*word，anchor∨title∨path 保底 0.9，score=0 不返回）。
- impacts: [FR-02]
- evidence: backend/app/modules/scan_docs/service.py:158-169（ILIKE+escape 跨方言先例）；search.py _word_score（打分逻辑原样平移）。
- 故障面: ILIKE 候选在中文短查询（单字）可能命中过千 → LIMIT 候选上限 + 提示用户查询过短（沿用现有零信号过滤，超限截断保 top）。
- 退役判据: 若 PG 侧引入全文索引（tsvector/zhparser），词面候选可升级。
- 模块域: backend

## D-007@v1: 模型版本管理 = state.model_version 驱动全量重算
- type: boundary
- priority: P1
- status: accepted
- source: code
- question: 换 embedding 模型后库里旧向量怎么办？
- answer: state 表存 model_version（settings.knowledge_embedding_model 值）；查询时版本不一致 → 全量重嵌（清 chunks 重算），完成后写新版本。embedder 不可用时不动库（纯词面降级不触发重算）。
- normalized_requirement: 模型名变更 = 一次全量重嵌的确定性触发；中途失败不写新版本（下次查询重试）。
- impacts: [FR-03, task-02]
- evidence: vector_search.py:139-143（单例按 model_name 比对语义同款思路）。
- 故障面: 全量重嵌期间的长查询——与首查同款（run_in_threadpool + 前端 loading 文案已有）。
- 退役判据: 无。
- 模块域: backend

## D-008@v1: 部署变更 = 镜像换 pgvector/pgvector:pg16 + 迁移内装扩展；升级步骤单列
- type: compatibility
- priority: P0
- status: accepted
- source: user
- question: 生产（阿里云）怎么升级？
- answer: ①docker-compose 的 postgres 镜像 postgres:16-alpine → pgvector/pgvector:pg16（数据卷不丢，官方同源镜像+vector 扩展）；②扩展安装放 alembic 迁移内（CREATE EXTENSION IF NOT EXISTS vector + 方言守卫——pgcrypto/pg_trgm 同款）；③升级顺序：换镜像重启 PG → 跑迁移 → 重启 backend；④升级前生产库跑验证 SQL（SELECT name FROM pg_available_extensions WHERE name='vector'）确认扩展可用（用户可能手动装过——核实过代码无痕迹，但手工操作查不到）。dev compose 同步换。
- normalized_requirement: 部署说明单列文档节；本地开发全 Docker 栈 dev-compose 同步；不换镜像时迁移在原生 PG 上 fail-closed 报「extension vector 不可用」。
- impacts: [FR-05, task-04]
- evidence: deploy/docker-compose.yml:7 + deploy/docker-compose.dev.yml:7（image=postgres:16-alpine）；backend/migrations/versions/202605260900（CREATE EXTENSION pgcrypto 先例）。
- 故障面: 迁移先于镜像替换执行 → 方言守卫内检查 extension 可用性，缺失时报错中止（信息含修复指引），不留半态表。
- 退役判据: 无。
- 模块域: backend, deploy

## D-009@v1: 落选——本地文件缓存（向量序列化到 .runtime 缓存文件）
- type: architecture
- priority: P1
- status: rejected
- source: user
- question: 向量持久化存哪里？
- answer: （用户裁决落选）不选本地文件缓存。
- normalized_requirement: 不引入文件级向量缓存。
- impacts: [FR-01]
- evidence: 用户会话「我还是更倾向于存数据库，除非你给我理由说服我」——AI 复核后复杂度大头等价、数据库运维面更优，维持用户倾向。
- 否决理由: 重启加载仍需读文件+反序列化（秒级但非零）；数据不可查不可运维（出问题只能删缓存）；与平台既有 PG 基础设施割裂，多一套存储形态。
- 复潮条件: 无 PG 的轻量部署形态（如单机 sqlite 化部署）出现时重议。
- 模块域: backend

## D-010@v1: 落选——仅做启动预热（不改存储）
- type: architecture
- priority: P1
- status: rejected
- source: code
- question: 首查 304s 怎么治？
- answer: （随 D-001 落选）不选纯预热。
- normalized_requirement: 不加 main.py lifespan 预热任务。
- impacts: []
- evidence: AI 上轮建议方案；用户反问「为什么还要预热」后转向持久化——预热治标（挪时间）不治本（重启代价随语料线性增长）。
- 否决理由: 重启后仍要全量重嵌（只是用户看不到）；语料增长后预热窗口持续变长；CPU 空转浪费。
- 复潮条件: 若 pgvector 部署受阻回退内存方案时，预热作为过渡补丁复潮。
- 模块域: backend

<!-- 增量落盘：每解决一个有实现影响的问题当场追加一条（格式见 brainstorm Step 3 模板）；幂等按 D-xxx@vN 判重 -->
<!-- 引用规范：evidence 等处的源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## D-011@v1: 同步触发机制选定——方案 A（查询路径内联懒同步）
- type: architecture
- priority: P0
- status: accepted
- source: user
- question: 库内向量与文件的同步怎么触发？（方案 A 查询内联懒同步 / 方案 B 后台常驻协程 / 方案 C 混合）
- answer: 方案 A：查询时指纹比对 → 一致直查库 / 不一致差量同步。理由：用户要买的重启零重建由持久化本身交付，与触发机制无关；A 零新增组件、与现内存懒构建语义同构（迁移面最小）、不加 main.py lifespan 边界；库空首查 304s 为一次性成本（建库本质），loading 文案已有兜底。
- normalized_requirement: 同步收敛在 search.py 检索层内部；无常驻协程/无周期任务/无 main.py 改动。
- impacts: [FR-03, task-02]
- evidence: 方案对比表见 proposal.md「方案对比与选择（Step 4）」；现懒构建语义 backend/app/modules/knowledge/search.py（corpus_fingerprint/_index_lock/构建后复算直接平移）。
- 故障面: 并发首查同时触发同步 → 锁内 single-flight（对齐现 _index_lock，DB 面 = workspace 级行锁或进程锁择一，设计细化）。
- 退役判据: 语料十万级或查询 P95 受指纹 stat 挤压 → 后台同步 + ANN 索引一并重议（方案 B 复潮条件）。
- 模块域: backend

## D-012@v1: 落选——方案 B（后台常驻同步协程）
- type: architecture
- priority: P1
- status: rejected
- source: user
- question: 库内向量与文件的同步怎么触发？
- answer: （落选）不选后台常驻协程。
- normalized_requirement: 不加 main.py lifespan 同步协程。
- impacts: []
- evidence: proposal.md 方案对比表。
- 否决理由: main.py 边界扩张；空转/周期权衡；同步态与查询态竞态面新增；与「懒触发」决策族（上变更 D-007 + 本变更 D-003）不一致。
- 复潮条件: 语料十万级或 KNN P95 退化时，后台同步 + ANN 索引一并重议。
- 模块域: backend

## D-013@v1: 落选——方案 C（首查触发 + 周期刷新混合）
- type: architecture
- priority: P1
- status: rejected
- source: user
- question: 库内向量与文件的同步怎么触发？
- answer: （落选）不选混合双通道。
- normalized_requirement: 不引入双触发路径。
- impacts: []
- evidence: proposal.md 方案对比表。
- 否决理由: 两套触发路径 = 最大复杂度；收益与 A 重叠（A 已覆盖查询正确性）；维护两份同步态。
- 复潮条件: 同 D-012。
- 模块域: backend

## D-005@v2: 对外契约零变化 + 执行模型定案（async 编排）——修订 v1 的注入物描述
- type: boundary
- priority: P0
- status: accepted
- supersedes: D-005@v1
- source: design-grill
- question: v1 写「新增入参面：session（AsyncSession）——路由已持有，注入即可」与 design 的 session_factory 漂移，且请求级 session 在 threadpool 内使用是跨 loop 违规；Grill X2 判定 threadpool 内 async 会话驱动机制必须定案。
- answer: 定案方案④（四选一之首）：search_sync 改造为 async 协程——DB await 在调用方事件循环原生执行（全局 async 工厂与 loop 同源，跨 loop 面不存在），CPU/IO（嵌入/文件扫描）经 asyncio.to_thread 卸载；端点直接 await，原 run_in_threadpool 整体卸载退役。注入物 = session_factory（async_sessionmaker，缺省取全局）。对外契约（端点签名/响应形态/api-types/前端）零变化口径不变；search_sync 的 sync→async 属内部协作面（审查判定：内部参数/形态扩展不算对外契约变化）。
- normalized_requirement: search_sync 为 async def；无任何跨事件循环会话使用；测试直接 await（pytest-asyncio 同形态）；端点行为与响应零变化。
- impacts: [FR-02, FR-04, task-02, task-03]
- evidence: Grill 审查 X2（review-2026-10-15-202825/review.json requiredEvidence#1）；backend/app/core/db.py:88-98 get_session_factory；conftest.py:264-287 _redirect_session_factory（测试面全局工厂重定向，async 测试直 await 成立）。
- 故障面: 嵌入批量（建库 304s 级）在 to_thread 内执行——事件循环不阻塞，其余请求可并发；长事务持锁窗口 = 同步短会话内（秒级），可接受。
- 退役判据: 无。
- 模块域: backend
