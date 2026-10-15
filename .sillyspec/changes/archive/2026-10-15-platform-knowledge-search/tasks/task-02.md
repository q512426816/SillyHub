---
id: task-02
title: 'Knowledge search endpoint + schema'
title_zh: '搜索端点与 schema（声明序/权限门控/docs 过滤/线程池卸载）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 16:26:20
priority: P0
depends_on: ['task-01']
blocks: [task-03, task-05]
requirement_ids: [FR-01, FR-03, FR-04]
decision_ids: [D-001@v1, D-005@v1]
allowed_paths:
  - backend/app/modules/knowledge/schema.py
  - backend/app/modules/knowledge/router.py
  - backend/app/modules/knowledge/tests/test_router.py
target_files:
  - backend/app/modules/knowledge/schema.py
  - backend/app/modules/knowledge/router.py
  - backend/app/modules/knowledge/tests/test_router.py
expects_from:
  task-01:
    - contract: search_sync
      needs: [results, model_ready, reason, spec_path, kind, title, anchor, snippet, score]
provides:
  - contract: KnowledgeSearchIn
    fields: [query, limit]
  - contract: KnowledgeSearchResultItem
    fields: [spec_path, kind, title, anchor, snippet, score]
  - contract: KnowledgeSearchOut
    fields: [ok, results, model_ready, reason]
goal: >
  暴露平台用户侧搜索端点 POST /api/workspaces/{workspace_id}/knowledge/search：
  JWT + KNOWLEDGE_READ 门控，docs/ 类结果按 SCAN_DOCS_READ 过滤（has_permission 同一权威函数），
  CPU 阻塞面经 run_in_threadpool 卸载，schema 供前端与 gen:types 双端消费。
implementation:
  - backend/app/modules/knowledge/schema.py 新增 KnowledgeSearchIn（query 为 str 必填 + limit 为 int 默认 20 钳 1..50）、KnowledgeSearchResultItem（spec_path/kind/title/anchor 可空 str/snippet/score）、KnowledgeSearchOut（ok 布尔默认 True/results/model_ready 布尔默认 True/reason 可空 str）
  - backend/app/modules/knowledge/router.py 新增 POST /knowledge/search，**注册在 GET /knowledge/{filename:path}（router.py:454）之前**（含既有字面量路由簇）；依赖 require_permission(Permission.KNOWLEDGE_READ)（backend/app/core/auth_deps.py:108-132）
  - 端点体：query.strip()[:4000] 截断 + limit 钳位；spec_root 经 KnowledgeService._spec_content_root（backend/app/modules/knowledge/service.py:31，与 vector_router.py 同源口径）；embedder = get_embedder(settings.knowledge_embedding_model)；run_in_threadpool 调 search_sync(..., 候选 3×limit)
  - docs 过滤：await has_permission(session, user=user, permission=Permission.SCAN_DOCS_READ, workspace_id=workspace_id)（backend/app/modules/auth/rbac.py:109-149，admin 短路 :132-133）——无该权限时过滤 spec_path.startswith("docs/") 项，再截断 limit；未知 workspace → 404（WorkspaceService.get 口径）
  - 配测试 backend/app/modules/knowledge/tests/test_router.py（扩展该文件）：无权限 403 / 未知 workspace 404 / query 空白 → 200 空结果 / docs 过滤（有 SCAN_DOCS_READ 全量、无则 docs 项消失且知识项保留）/ 降级（get_embedder 注入不可用 → model_ready=False）/ 响应形态契约字段（依赖覆盖 + spec_root 重定向，对齐 test_vector_search.py 的端点测试形态）
acceptance:
  - 端点契约：POST /api/workspaces/{id}/knowledge/search 200 返回 {ok, results:[{spec_path,kind,title,anchor,snippet,score}], model_ready, reason} 字段齐全
  - 声明序断言：路由注册位在 GET /knowledge/{filename:path} 之前（代码审查 + 既有 propose/distill 路由不受影响回归）
  - 权限断言：无 KNOWLEDGE_READ → 403；无 SCAN_DOCS_READ → 结果无 docs/ 前缀项且知识类结果照常；admin 短路全量
  - 降级断言：embedder 不可用 → 200 + model_ready=False + reason 非空（不 5xx）
  - query 空白 → 200 空 results（不报错）；limit 超界被钳到 1..50
verify:
  - cd backend && uv run pytest app/modules/knowledge/tests/test_router.py app/modules/knowledge/tests/test_vector_search.py -q
  - cd backend && uv run ruff check app/modules/knowledge/router.py app/modules/knowledge/schema.py && uv run mypy app/modules/knowledge
constraints:
  - MUST NOT 修改 vector_router.py / vector_search.py 对外契约与 /api/spec/knowledge/vector-search 行为（D-001@v1/D-009@v1）
  - docs 过滤判定 MUST 经 has_permission 同一权威函数；MUST NOT 读 user.permissions 快照（丢 is_platform_admin 短路）
  - 过滤顺序 MUST 为先取 3×limit 候选再过滤截断（MUST NOT 先截断后过滤——会把 top-k 挤空）
  - 端点 MUST 为新回归断言补测试；既有 test_router.py 用例 MUST NOT 被削弱或删除
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
