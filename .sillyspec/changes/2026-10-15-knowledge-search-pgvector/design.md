---
author: qinyi
created_at: 2026-10-15 20:24:10
generated_by: sillyspec-design-init
scale: "large"  # 规模评估（Step 8 精判）：无 Wave 真并行簇（任务链式依赖），large 依据 = 用户显式流程要求（仓库规则 3 新功能走完整流程，上变更同款先例）+ 含 DB schema/迁移/部署治理面
---

# 设计文档（Design）— 2026-10-15-knowledge-search-pgvector

<!-- 引用规范：全文源码位置写仓根相对全路径+行号（src/foo.js:123）——裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工） -->

## 背景

知识搜索（变更 2026-10-15-platform-knowledge-search，已归档）的向量索引是**进程内存态**（backend/app/modules/knowledge/search.py 的 `_indexes` 字典 + `_index_lock`）：每次查询懒构建，服务重启即清空。实测首查含全量嵌入 **304.67s**（437 文件 / 6586 chunks），缓存命中后 0.47s——重启代价随语料增长线性恶化，而该语料每天都在增长（归档/蒸馏持续写 spec 树）。用户裁决持久化到 PostgreSQL pgvector（decisions.md D-001@v1；重议依据 = 首查 304s 实测触发上变更归档决策 D-unmapped-012 死路③的复潮信号「语料量级致文件/内存直读不可行」）。

本变更只动检索内核的**存储与同步层**；对外契约冻结（D-005）：`search_sync` 返回形态、`POST /workspaces/{workspace_id}/knowledge/search` 端点、api-types、前端、daemon 全部零改动。

## 设计目标

1. **重启零重建**：服务重启后首次搜索秒级返回（库有数据时）；全量嵌入只在首次建库与模型版本变更时发生一次。
2. **自动增量同步**：文档增/删/改后搜索自动反映——查询时指纹触发差量同步，无后台任务、无 daemon 改动（D-003/D-011）。
3. **对外契约零变化**：上变更 199+46 测试回归全绿（仅 fake 注入点适配）；openapi/api-types 零 diff（规则 21 无触发）。
4. **fail-soft 不劣化**：embedder 缺席 → 纯词面（现语义）；PG/DB 异常 → 词面走内存扫描直查（新增降级面），搜索永不 5xx。
5. **测试可跑**：SQLite 内存测试环境（backend/conftest.py:248，无 vector 类型）下方言分叉，两方言返回形态逐字段一致（D-004）。

## 非目标

- 不做启动预热/后台常驻同步协程（D-010/D-012 落选）。
- 不做 ANN 索引（ivfflat/hnsw）——7k 量级 KNN 足够，十万级再补（R-02 复潮触发器）。
- 不改 CLI 向量端点 `/api/spec/knowledge/vector-search`（服务 CLI decisions-only 召回，内存实现独立保留，D-001 边界）。
- 不做多模型并存/混合检索（单模型 + model_version 全量重算，D-007）。
- 不改前端任何文件（「首次搜索需建立索引」loading 文案在建库期继续有效）。

## 拆分判断

单变更单 PR，任务链式：task-01（依赖+表+迁移）→ task-02（检索层改造）→ task-03（路由协作）→ task-04（部署）→ task-05（回归收口）。无真并行簇；判 large 依据 = 用户显式要求完整流程（规则 3，上变更先例）+ schema/迁移/部署治理面。

## 总体方案

### Phase 1：数据层（依赖 + 表 + 迁移）

**新 ORM（backend/app/modules/knowledge/search.py 内定义——先例：backend/app/modules/knowledge/hits.py:79 模块内 `KnowledgeHit(BaseModel, table=True)`）**：

```
knowledge_search_chunks：
  id: uuid PK
  workspace_id: uuid FK workspaces.id ON DELETE CASCADE（普通索引）
  spec_path: str(1024)      # 仓根相对 POSIX
  kind: str(32) / title: str(512) / anchor: str(256)|None / start_line: int / text: Text
  content_hash: str(64)     # sha256(text)——差量比对键
  embedding: PG = Vector(512) / SQLite = JSON 文本（with_variant）
  created_at: datetime
  约束：uq(workspace_id, spec_path, anchor, title)；ix(workspace_id)

knowledge_search_state：
  id: uuid PK / workspace_id: uuid FK CASCADE（唯一）
  corpus_fingerprint: JSON   # 现 corpus_fingerprint() 返回值序列化
  model_version: str(128)   # settings.knowledge_embedding_model 值
  updated_at: datetime
```

**迁移（NEW:backend/migrations/versions/20261015200000_knowledge_search_pgvector.py）**：`CREATE EXTENSION IF NOT EXISTS vector`（方言守卫：非 PG 直接 return——先例 backend/migrations/versions/20260825150000_agent_run_logs_trgm_index.py:34；PG 侧 extension 不可用时 raise 含「换 pgvector/pgvector:pg16 镜像」修复指引，R-06 fail-closed）+ 两表 DDL（embedding 列用 `pgvector.sqlalchemy.Vector(512)`）。

**依赖**：backend/pyproject.toml dependencies 加 `pgvector>=0.3`（提供 `pgvector.sqlalchemy.Vector` 列类型 + 绑定互转）；`uv lock` 随 `uv sync` 更新。

**维度说明**：bge-small-zh-v1.5 = 512 维（settings 默认，vector_search.py:114 注释同源）；同维度换模型走 model_version 全量重算（D-007），跨维度换模型需显式改列迁移（R-03）。

### Phase 2：检索层改造（search.py，async 编排 + CPU 线程池卸载）

`search_sync` 改造为 **async 协程**（`async def search_sync(..., session_factory: async_sessionmaker | None = None)`，返回形态 `{results, model_ready, reason}` 不变）——**执行模型定案（Grill X2 修订，方案④）**：DB 读写 await 在调用方事件循环上原生执行（共享全局 async 会话工厂，连接池与 loop 归属一致，无跨 loop 面）；纯 CPU/文件 IO 面（embedder.embed / scan_corpus / corpus_fingerprint / chunk 打分）经 `asyncio.to_thread` 卸载不卡事件循环（平台惯例形态：service.py 的 `asyncio.to_thread` 同族；**撤回**原稿对 service.py:52 的「async 会话先证」引用——该处仅为同步文件 IO 卸载，本设计不再依赖任何跨 loop 会话机制）。测试面：pytest-asyncio 直接 `await search_sync(...)`（与现有 async 测试同形态）。

**主流程**（替代现 `_indexes` 懒构建段；`chunk_markdown/scan_corpus/corpus_fingerprint/_word_score/_make_snippet/_cosine` 全部原样复用）：

```
1. q 空 / corpus_fingerprint(spec_root) is None → 现有早退语义不变
2. 同步判定（async with session_factory() 短会话）：
   state = SELECT knowledge_search_state WHERE workspace_id
   指纹归一化口径（Grill 修订）：fp_now 与库值比较前统一 list 化——
   存库时 fp 存 JSON（天然 list[list]），fp_now 经 list(map(list, fp)) 归一，
   两侧同为 list 结构再比对（否则 tuple != list 恒真、快路径恒失效）。
   if state 缺失 or state.model_version != model_name → 全量同步（清 chunks → 逐 chunk 嵌入批量插入 → 写 state）
   elif state.corpus_fingerprint != fp_now_normalized → 差量同步（下）→ 更写 state
3. 向量路（embedder 非 None 时）：
   PG → SELECT id,...,1 - (embedding <=> :qvec) AS sim ORDER BY embedding <=> :qvec LIMIT k*3
   SQLite → 拉回该 ws 全部 (id, embedding JSON) → Python 余弦 top-k*3（复用 _cosine）
4. 词面路：
   SELECT 候选 WHERE title ILIKE :pat OR spec_path ILIKE :pat OR text ILIKE :pat
   （escape 口径对齐 backend/app/modules/scan_docs/service.py:158-169；候选 LIMIT 500 防单字短查询爆量）
   → Python _word_score 精确打分（权重/次数增益口径不变）
5. 融合 0.6*vec+0.4*word + anchor∨title∨path 保底 0.9 + 零信号过滤 + 去重 + snippet → 现逻辑不动
```

**差量同步（D-003）**：

```
库行键集 = {(spec_path, anchor, title): content_hash}（一次 SELECT）
新扫描 = scan_corpus(spec_root)（复用现函数）
for chunk in 新扫描：
    键不存在 → INSERT（嵌入该 chunk）
    content_hash 不同 → UPDATE text/hash + 重嵌 embedding
    否则跳过（mtime 指纹漂移被 hash 层吸收）
库行键 − 新扫描键 → DELETE
commit → 写 state（fp_now + model_version）
```

**同步锁（R-04）**：进程内 `asyncio.Lock`（键 = workspace_key——async 协程跨 await 持有安全，Grill 增量复审残留①修订）；跨进程由 DB 行为兜底——uq 约束 + `INSERT ... ON CONFLICT DO UPDATE`（PG）/ `INSERT OR REPLACE`（SQLite）幂等写。查询在同步完成后同会话执行，不读半态。

**DB 异常降级链（fail-soft）**：短会话内任何 DB 异常 → 捕获 → 词面退回**内存扫描直查**（`scan_corpus` + `_word_score`，即现实现的无向量版本）+ reason 记 DB 降级；搜索永不 5xx。`scan_corpus` 一次 ~0.25s（实测 437 文件），可接受。

### Phase 3：路由协作（router.py 极小改）

`search_knowledge` 端点：**直接 `await search_sync(...)`**（async 协程原生执行；`session_factory` 缺省取 `app.core.db` 全局工厂，或端点显式传入）；原 `run_in_threadpool(search_sync, ...)` 整体卸载退役——CPU 面已由 search_sync 内部的 `asyncio.to_thread` 分段卸载（嵌入批量/文件扫描），事件循环不再被长阻塞。端点签名/响应模型/权限过滤零改动。

### Phase 4：部署变更（deploy）

- deploy/docker-compose.yml:7 与 deploy/docker-compose.dev.yml:7：`postgres:16-alpine` → `pgvector/pgvector:pg16`（官方同源 + vector 扩展预装；数据卷不丢）。
- 升级顺序（部署说明单列）：换镜像重启 PG → `alembic upgrade head`（装扩展建表）→ 重启 backend → 首次搜索触发建库（304s 一次，前端 loading 文案已有）。
- **升级顺序（部署执行单，D-008@v1）**：① 换镜像并重启 PG（`docker compose up -d postgres`，数据卷不丢）；② `alembic upgrade head`（装扩展建表；镜像未换时 fail-closed 中止含修复指引）；③ 重启 backend；④ 首次搜索触发建库（~5 分钟一次，前端 loading 文案已有）。
- 升级前生产验证 SQL：`SELECT name FROM pg_available_extensions WHERE name='vector';`（用户记忆核实入口——若曾手工装过，镜像替换仍建议执行以固化镜像面管理）。

### Phase 5：测试与收口

- 新单测（test_knowledge_search.py 扩展）：with_variant 双方言建表；差量同步四态（新增/变更/删除/指纹漂移 hash 吸收）；model_version 变更全量重算（embed_calls 计数）；SQLite 向量路 Python 余弦 + 词面 ILIKE 候选；DB 异常降级链（monkeypatch session 抛错 → 词面内存直查 + reason）；指纹一致零嵌入（embed_calls 不变）。
- 回归：上变更 knowledge 模块 199 + 前端 46 全绿（`get_embedder` fake 注入路径不动，端点测试走 SQLite 方言天然覆盖 DB 面）。
- ruff/mypy；模块卡 + changelog sidecar 同步。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/knowledge/search.py | 检索层改造：新增两 ORM（模块内定义，hits.py 先例）+ 懒同步差量 + 双路方言分叉 + DB 异常降级链；纯函数工具（chunk_markdown/scan_corpus/corpus_fingerprint/_word_score/_make_snippet/_cosine）原样复用 |
| 新增 | NEW:backend/migrations/versions/20261015200000_knowledge_search_pgvector.py | CREATE EXTENSION vector（方言守卫 + 可用性 fail-closed）+ 两表 DDL |
| 修改 | backend/pyproject.toml | dependencies 加 pgvector>=0.3（uv.lock 随 sync） |
| 修改 | backend/app/modules/knowledge/router.py | 端点内 session_factory 构造与传参（极小改；签名/响应零变化） |
| 修改 | backend/app/modules/knowledge/tests/test_knowledge_search.py | 新增 DB 面用例 + 既有用例 session_factory 注入适配 |
| 修改 | backend/app/modules/knowledge/tests/test_router.py | 端点用例适配（预期零改或极小——SQLite 方言天然可跑） |
| 修改 | deploy/docker-compose.yml | postgres 镜像 → pgvector/pgvector:pg16 |
| 修改 | deploy/docker-compose.dev.yml | 同上（dev 栈） |
| 修改 | .sillyspec/docs/backend/modules/knowledge.md | 模块卡检索层存储形态更新 + backend.changelog.md sidecar（knowledge.md 卡同目录无 sidecar 则建） |
| 修改 | backend/tests/test_align_platform_change_events_migration.py | 迁移链尾锚钉子测试 head 前移（新迁移成为 head 的注释链续写 + assert 更新——仓库迁移准入惯例，同类先例 20261010190000 漏更锚收口） |

（无 openapi/api-types/frontend/daemon 改动——契约冻结 D-005，规则 21 无触发面。）

## 接口定义

本变更接口面：0 端点（无接口变更）——对外 API/前端契约冻结（D-005）。内部协作面唯一新增：

```python
# backend/app/modules/knowledge/search.py —— search_sync 改造为 async 协程（Grill X2 定案：DB 面原生 await + CPU 面 to_thread）：
async def search_sync(
    spec_root: Path, workspace_key: str, query: str, limit: int,
    embedder: object | None, model_name: str, *,
    embedder_error: str | None = None,
    session_factory: async_sessionmaker[AsyncSession] | None = None,  # 缺省取全局工厂
) -> dict:  # {results, model_ready, reason} 形态不变（对外契约；调用方由 run_in_threadpool 改 await）
```

新表 DDL 见「数据模型」。

## 生命周期契约表

本变更不涉及生命周期契约（无 session/lease/agent_run/daemon 状态机改动；检索为无状态请求-响应面，同步为查询内联动作非生命周期事件）。

## 数据模型

两新表（Phase 1 详述）。迁移内 PG DDL：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE TABLE knowledge_search_chunks (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    spec_path VARCHAR(1024) NOT NULL, kind VARCHAR(32) NOT NULL, title VARCHAR(512) NOT NULL,
    anchor VARCHAR(256), start_line INTEGER NOT NULL, text TEXT NOT NULL,
    content_hash VARCHAR(64) NOT NULL, embedding vector(512) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    UNIQUE (workspace_id, spec_path, anchor, title));
CREATE INDEX ix_kssc_workspace ON knowledge_search_chunks (workspace_id);
CREATE TABLE knowledge_search_state (
    id UUID PRIMARY KEY,
    workspace_id UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
    corpus_fingerprint JSON NOT NULL, model_version VARCHAR(128) NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL);
```

无既有表改动；无数据回填（首查建库即回填）。

## 兼容策略（brownfield 必填）

- **升级前后行为连续**：部署本变更前现内存实现照常工作；升级后首查建库一次，之后秒级。搜索可用性无中断窗口（迁移加表不动既有 schema）。
- **迁移安全**：`CREATE EXTENSION IF NOT EXISTS` 幂等；extension 不可用 fail-closed（R-06，防「只跑迁移没换镜像」的半态）。
- **回滚**：downgrade 删两表（DROP EXTENSION 不做——共享扩展，pg_trgm downgrade 同款先例）；代码回滚回内存实现，库表残留无害（下次升级复用）。
- **降级链**：embedder 缺席 → 纯词面（现语义）；DB 异常 → 词面内存扫描直查（新增，搜索永不 5xx）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | async 会话跨事件循环误用（已按 Grill X2 修订根除）——**实测收口（task-05）**：SQLite 全链断言通过（建库首查 0.017s/3 chunks；**重启后首查 0.003s 仅嵌 query（零重建物证）**；差量新文件只嵌 2 = 新块+query；生产 PG 面部署后同口径复测） | P1 | **机制定案 = async 编排（方案④）**：search_sync 为 async 协程，DB await 在调用方 loop 原生执行（池与 loop 同源，跨 loop 面不存在）；CPU/IO 经 asyncio.to_thread 卸载；async with 短会话自动关闭；单测含连续多次查询 + 与主 loop 并发混跑断言（无 'attached to a different loop'） |
| R-02 | KNN 无 ANN 索引随量级退化 | P2 | 接受：7k 量级 pgvector 顺序扫描毫秒级（社区同量级实测）；十万级触发 D-012 复潮（后台同步 + hnsw 一并重议），本行即触发器登记 |
| R-03 | 换模型维度 ≠512 需改列迁移 | P2 | 同维度换型由 model_version 全量重算覆盖；跨维度显式迁移（设计已声明）；单测锁 512 常量与 settings 默认一致性 |
| R-04 | 差量同步与并发查询竞态（读到半态/重复嵌入） | P1 | 进程锁 single-flight（键=workspace_key）+ DB uq + ON CONFLICT 幂等写；查询在同步完成后同会话执行不读半态；Grill 审查重点核验 |
| R-05 | SQLite 测试路（拉回全量 Python 余弦）随用例语料变慢 | P2 | 测试语料人工小规模（<1k chunks）；生产路径不受影响（走 PG KNN） |
| R-06 | 生产镜像替换遗漏（只跑迁移没换镜像） | P1 | 迁移内 fail-closed：PG 方言下 extension 不可用即 raise（文案含「换 pgvector/pgvector:pg16 镜像后重跑」）；部署说明单列升级顺序 |
| R-07 | 词面 ILIKE 候选在中文单字查询爆量 | P2 | 候选 LIMIT 500 + 现有零信号过滤截断保 top；极端短查询体验靠融合排序兜底 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1 | 总体方案（pgvector 持久化）+ 背景 | 已确认 |
| D-002@v1 | Phase 1 两表 + with_variant + 数据模型 | 已确认 |
| D-003@v1 | Phase 2 差量同步 | 已确认 |
| D-004@v1 | Phase 2 双路方言分叉 | 已确认 |
| D-005@v1→@v2 | 接口定义（0 端点 + async 编排定案）+ 非目标 + 文件清单（无前端） | 已确认（@v2 修订执行模型） |
| D-006@v1 | Phase 2 词面 SQL 候选 + R-07 | 已确认 |
| D-007@v1 | Phase 2 model_version 重算 | 已确认 |
| D-008@v1 | Phase 4 部署 + R-06 + 兼容策略 | 已确认 |
| D-009@v1 | 非目标（文件缓存落选） | 已确认（防复潮） |
| D-010@v1 | 非目标（预热落选） | 已确认（防复潮） |
| D-011@v1 | 拆分判断 + Phase 2（方案 A 内联懒同步） | 已确认 |
| D-012@v1 | R-02 复潮触发器（落选 B） | 已确认（防复潮） |
| D-013@v1 | 非目标（混合落选） | 已确认（防复潮） |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale）
- [x] 引用所有当前版本 D-xxx@vN（D-001~D-013 全部在决策追踪表）
- [x] 生命周期契约豁免短语已写（「不涉及生命周期契约」紧邻标题）
- [x] UI 原型分级：纯后端零 UI 变化（D-005 契约冻结，文件清单无前端文件）——跳过档成立
- [x] ⚠️ 自审存疑已闭合：R-04 竞态方案（进程锁+DB 幂等+同会话串行）列为 Grill 审查重点项
