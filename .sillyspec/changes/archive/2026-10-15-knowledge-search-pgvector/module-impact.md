# 模块影响分析（Module Impact）— 平台知识搜索向量索引持久化（pgvector）

> 文件×模块归属按 _module-map.yaml paths 前缀约定匹配；影响类型与 review 标记为语义判断，以最终 git diff 为准（真实 > 记录）。
> 本版为归档终审版。对账基准说明：CLI 活口径 16 文件 = execute 冻结面（change-patch 9 件）+ verify 知识 sidecar 3 件 + 归档期模块文档同步 4 件（`.sillyspec/docs/multi-agent-platform/modules/backend.md` 一条因并行会话声明被 CLI 对账排除，同步实际已落）；部署期已提交件（drop uq 迁移、迁移钉子前移、compose 部署加固）不在 CLI 冻结基准内，「以 git 真实为准」已并入矩阵。
> 两类差集裁决：① diff 有而未列——治理产物（知识 sidecar + 归档期模块文档）已补入「未匹配文件」；`backend/pyproject.toml`/`backend/uv.lock`/`deploy/*.yml` 已在矩阵（CLI 启发式扩展白名单不含 .toml/.lock/.yml，结构性 advisory 保留项，非漏记）；
> ② 列而 diff 无——`test_router.py` plan 原列、execute 实证零改动（见「execute 期事实修正」，已移除）；`modules/backend.md`/`modules/deploy.md`/`_module-map.yaml` 为文档同步目标、`20261016010000_drop_kssc_unique.py` 为部署期新增（均不在冻结基准内），保留。

## 模块影响矩阵

| 模块 | 变更文件 | 影响类型 | 需 review |
|---|---|---|---|
| backend | `backend/app/modules/knowledge/search.py` | 逻辑变更（async 编排+懒同步差量四态+PG 原生 SQL KNN+词面降级链）+ 数据结构变更（新增两 ORM 表） | 否 |
| backend | `backend/migrations/versions/20261015200000_knowledge_search_pgvector.py`（NEW） | 新增（CREATE EXTENSION vector + 两表 DDL + 方言守卫 fail-closed） | 否 |
| backend | `backend/migrations/versions/20261016010000_drop_kssc_unique.py`（NEW，部署期实证） | 新增（drop uq_kssc_workspace_path_anchor_title——生产重号条目撞约束） | 否 |
| backend | `backend/pyproject.toml` | 配置变更（新依赖 pgvector>=0.3） | 否 |
| backend | `backend/uv.lock` | 配置变更（依赖锁同步） | 否 |
| backend | `backend/app/modules/knowledge/router.py` | 调用关系变更（await 化+session_factory 注入，签名/响应零改动） | 否 |
| backend | `backend/app/modules/knowledge/tests/test_knowledge_search.py` | 逻辑变更（全用例 async 化+重号共存替换 uq 拒绝用例） | 否 |
| backend | `backend/tests/test_align_platform_change_events_migration.py` | 逻辑变更（迁移钉子 head 两度前移：20261015200000→20261016010000，assertion-surfaces 闸门） | 否 |
| deploy | `deploy/docker-compose.yml` | 配置变更（postgres 换 pgvector/pgvector:pg16 + fastembed 模型缓存挂载 + backend mem_limit 1100m） | 否 |
| deploy | `deploy/docker-compose.dev.yml` | 配置变更（postgres 换 pgvector/pgvector:pg16） | 否 |

## 未匹配文件

- 治理产物（非模块路径，随知识库/模块文档留档）：`.sillyspec/knowledge/decisions/backend.md`、`.sillyspec/knowledge/decisions/deploy.md`、`.sillyspec/knowledge/fr/knowledge.md`（verify 决策/FR 蒸馏 sidecar）；`.sillyspec/docs/backend/modules/knowledge.md`、`.sillyspec/docs/backend/modules/knowledge.changelog.md`、`.sillyspec/docs/multi-agent-platform/modules/backend.changelog.md`、`.sillyspec/docs/multi-agent-platform/modules/deploy.md`（归档期模块文档同步，backend.md 因并行会话声明被 CLI 对账排除、同步实际已落）。
- 其余代码交付文件全部命中既有模块路径前缀（backend/**、deploy/**）。

## 影响类型说明

逻辑变更 / 数据结构变更 / 接口变更 / 调用关系变更 / 配置变更 / 新增；不确定的影响标 needs review。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `.sillyspec/docs/multi-agent-platform/modules/backend.md` | 加「平台知识搜索·pgvector 持久化」特性行（含部署实证） | done |
| `.sillyspec/docs/multi-agent-platform/modules/deploy.md` | postgres 镜像/backend 模型挂载与 mem_limit/注意事项/变更索引 | done |
| `.sillyspec/docs/multi-agent-platform/modules/_module-map.yaml: backend` | 无变化（无增删模块与路径；main_symbols 循 platform-knowledge-search 先例不加） | skipped |
| `.sillyspec/docs/multi-agent-platform/modules/_module-map.yaml: deploy` | 无变化（同上） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

## execute 期事实修正

- `test_router.py`：plan 原列「8 例适配 async 调用形态」，execute 实证零改动（测试经 ASGI HTTP 层调用，端点签名零变，无需适配）——矩阵已移除，git diff 自 base 零改动为证。
- backend 子项目细粒度卡（`.sillyspec/docs/backend/modules/knowledge.md` + `knowledge.changelog.md`）execute 期已同步（992209265）；归档期修正其中 uq 陈述（约束已 drop）并补部署实证。
- top-level `backend.changelog.md` 归档期补本变更条目（execute 期漏；与 platform-knowledge-search 条目同形制）。

## 跨模块影响说明

- **迁移链**：20261015200000（建扩展+两表，含 uq 约束）→ 20261016010000（drop uq）两迁移同属本变更；钉子测试 head 两度前移。新装环境顺序执行两迁移（建后又 drop，幂等无害）。
- **部署环境面（deploy 模块）**：服务器无外网 + 1.6G 内存——模型缓存挂载预置、mem_limit 1100m、建库走本机+SSH 隧道直写（容器内全量嵌入必 OOM）；细节见 deploy-notes.md D-014~D-018。
- **零改动红线（git 事实核验）**：CLI 向量端点（vector_search.py/vector_router.py）与 `search.py` 六纯函数（chunk_markdown/scan_corpus/corpus_fingerprint/_cosine/_make_snippet/_word_score）复用不动；端点签名/openapi.json/api-types.ts 零 diff（gen:types 物证）。
