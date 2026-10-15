---
author: qinyi
created_at: 2026-10-15 20:24:10
---
# 任务清单（Tasks）— 2026-10-15-knowledge-search-pgvector

- [x] task-01: 数据层——backend/pyproject.toml 加 pgvector>=0.3（uv sync 更新 lock）；search.py 内新增两 ORM（KnowledgeSearchChunk/KnowledgeSearchState，Field(sa_column=Column(...)) + embedding 列 Column(JSON).with_variant(Vector(512), "postgresql")，hits.py:79 先例）；NEW:backend/migrations/versions/20261015200000_knowledge_search_pgvector.py（CREATE EXTENSION IF NOT EXISTS vector + PG 方言守卫 + extension 缺失 fail-closed raise + 两表 DDL + downgrade 删表不卸扩展，20260825150000 先例）；配单测（双方言建表/uq 约束/metadata 注册）
- [x] task-02: 检索层改造——search_sync 改 async 协程（session_factory 可选参数缺省取全局工厂；DB await 原生执行 + CPU/IO 经 asyncio.to_thread；asyncio.Lock single-flight）；懒同步三分支（指纹归一化 list(map(list)) 比对 → 全量/差量/model_version 重算；差量四态 + ON CONFLICT/INSERT OR REPLACE 幂等）；查询双路方言分叉（PG embedding <=> KNN 取 1-distance；SQLite 拉回 JSON embedding Python 余弦；词面 ILIKE 候选 LIMIT 500 + Python _word_score 打分）；DB 异常降级链（词面内存直查 + reason）；六纯函数复用不动；配单测（同步四态/hash 吸收 embed_calls 不变/重算计数/两方言一致/降级链/跨 loop 混跑无 attached-to-different-loop）；**既有 test_knowledge_search 全部用例改 pytest-asyncio await 形态**（17 函数/10 处 search_sync 同步直调点 async 化后结构性失效——plan 审查行动项闭合） (depends_on: task-01)
- [x] task-03: 路由协作——router.py search 端点改直接 await search_sync（run_in_threadpool 整体卸载退役；session_factory 显式传入）；端点签名/响应模型零改动；test_router 既有搜索 8 例适配（async 调用形态）+ 回归 (depends_on: task-02)
- [x] task-04: 部署——deploy/docker-compose.yml 与 deploy/docker-compose.dev.yml 镜像 postgres:16-alpine → pgvector/pgvector:pg16；升级顺序说明（换镜像→迁移→重启→首查建库）与生产验证 SQL 落 design Phase 4 部署节；迁移 fail-closed 文案核验（无镜像时 raise 含修复指引） (depends_on: task-01)
- [x] task-05: 回归收口——knowledge 模块 199+前端 46 全绿；ruff/mypy；openapi.json/api-types 零 diff 核验（git diff 物证）；模块卡 knowledge.md 存储形态更新 + changelog sidecar；实测回填（重启后首查秒级/差量只重嵌变更文件） (depends_on: task-02, task-03)
