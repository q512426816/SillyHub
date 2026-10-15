---
id: task-01
title: 'Data layer: deps + ORM + migration'
title_zh: '数据层（pgvector 依赖/两 ORM/迁移）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 21:45:00
priority: P0
depends_on: []
blocks: ["task-02"]
requirement_ids: [FR-01, FR-05]
decision_ids: [D-002@v1, D-008@v1]
allowed_paths:
  - backend/pyproject.toml
  - backend/uv.lock
  - backend/app/modules/knowledge/search.py
  - NEW:backend/migrations/versions/20261015200000_knowledge_search_pgvector.py
  - backend/app/modules/knowledge/tests/test_knowledge_search.py
target_files:
  - backend/pyproject.toml
  - backend/uv.lock
  - backend/app/modules/knowledge/search.py
  - NEW:backend/migrations/versions/20261015200000_knowledge_search_pgvector.py
  - backend/app/modules/knowledge/tests/test_knowledge_search.py
provides:
  - contract: KnowledgeSearchChunk
    fields: [workspace_id, spec_path, kind, title, anchor, start_line, text, content_hash, embedding]
  - contract: KnowledgeSearchState
    fields: [workspace_id, corpus_fingerprint, model_version]
  - contract: pgvector_migration
    fields: [fail_closed_raise, dialect_guard, two_tables_ddl]
goal: >
  落地持久化数据面：pgvector 依赖、两 ORM（with_variant 双方言）与迁移（装扩展+建表，fail-closed 守卫）。
implementation:
  - backend/pyproject.toml dependencies 加 "pgvector>=0.3"；uv sync --project backend 更新 uv.lock（真实安装供 import）
  - search.py 内新增两 ORM（hits.py:79 先例 Field(sa_column=Column(...))）：KnowledgeSearchChunk（workspace_id FK CASCADE/spec_path(1024)/kind(32)/title(512)/anchor(256) 可空/start_line/text/content_hash(64)/embedding/created_at；uq(workspace_id,spec_path,anchor,title)+ix(workspace_id)）与 KnowledgeSearchState（workspace_id 唯一 FK/corpus_fingerprint JSON/model_version(128)/updated_at）
  - embedding 列：Column(JSON).with_variant(Vector(512), "postgresql")——import pgvector.sqlalchemy.Vector；SQLite（测试）落 JSON、PG 落 vector(512)
  - NEW 迁移 20261015200000：upgrade = PG 方言守卫（非 postgresql 直接 return，20260825150000:34 先例）+ CREATE EXTENSION IF NOT EXISTS vector（extension 缺失 raise RuntimeError 文案含「换 pgvector/pgvector:pg16 镜像后重跑迁移」= R-06 fail-closed）+ 两表 DDL；downgrade = 删两表不卸扩展
  - 单测：SQLite 内存 create_all 建表命中 JSON 变体/uq 约束冲突/ORM 注册进 metadata（测试 import search 模块即注册）
acceptance:
  - 建表/约束用例绿（SQLite 下 embedding 为 JSON 无 vector 依赖）
  - 迁移方言守卫结构正确（PG 守卫 + fail-closed raise + downgrade 不卸扩展）
  - pgvector 进依赖且 uv.lock 更新（import pgvector.sqlalchemy 可用）
verify:
  - cd backend && uv run pytest app/modules/knowledge/tests/test_knowledge_search.py -q --no-cov
constraints:
  - MUST NOT 改动 vector_search.py/vector_router.py（CLI 端点零改动）
  - 迁移 MUST 非 PG 方言直接 return
  - embedding 维度 512 与 settings 默认模型一致（跨维度走显式迁移 R-03）
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
