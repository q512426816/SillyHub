---
id: task-02
title: 'Search core: async orchestration + lazy sync + dialect fork'
title_zh: '检索层改造（async 编排/懒同步差量/双路分叉/降级链）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 21:45:00
priority: P0
depends_on: ["task-01"]
blocks: ["task-03", "task-05"]
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-003@v1, D-004@v1, D-005@v2, D-006@v1, D-007@v1, D-011@v1]
allowed_paths:
  - backend/app/modules/knowledge/search.py
  - backend/app/modules/knowledge/tests/test_knowledge_search.py
target_files:
  - backend/app/modules/knowledge/search.py
  - backend/app/modules/knowledge/tests/test_knowledge_search.py
provides:
  - contract: search_sync(async)
    fields: [results, model_ready, reason, spec_path, kind, title, anchor, snippet, score]
expects_from:
  task-01:
    - contract: KnowledgeSearchChunk
      needs: [workspace_id, spec_path, kind, title, anchor, text, content_hash, embedding]
    - contract: KnowledgeSearchState
      needs: [corpus_fingerprint, model_version]
goal: >
  检索内核从进程内存索引改为 pgvector 持久化：async 编排（Grill X2 定案）+ 查询时懒同步差量 + 双路方言分叉 + DB 异常降级链；六纯函数复用不动。
implementation:
  - search_sync 改 async def：新增 keyword-only session_factory（async_sessionmaker，缺省取 app.core.db.get_session_factory()）；返回形态不变
  - 执行模型：DB await 原生执行；CPU/IO（embedder.embed/scan_corpus/corpus_fingerprint）经 asyncio.to_thread 卸载；禁跨 loop 会话
  - 懒同步（asyncio.Lock 键=workspace_key single-flight）：state 查询三分支——缺失或 model_version 不符→全量（清 chunks→to_thread 批量嵌入→批量插入）；指纹失配（fp_now 经 list(map(list, fp)) 归一后比较）→差量；一致直查；完成写 state
  - 差量四态：库行键集 {(spec_path,anchor,title):content_hash} vs scan_corpus——新键 INSERT（嵌入）/hash 变 UPDATE 重嵌/消失 DELETE/同跳过（mtime 漂移吸收）；ON CONFLICT DO UPDATE（PG）/INSERT OR REPLACE（SQLite）幂等分叉
  - 查询双路：向量路 PG=SELECT ...,1-(embedding <=> :qvec) AS sim ORDER BY embedding <=> :qvec LIMIT k*3；SQLite=拉回 embedding JSON→Python 余弦 top-k*3（复用 _cosine）；词面路=ILIKE 候选（escape 对齐 scan_docs/service.py:158-169）LIMIT 500→_word_score 打分
  - 融合段不动：0.6*vec+0.4*word+anchor∨title∨path 保底 0.9+零信号过滤+去重+_make_snippet
  - 降级链：短会话内 DB 异常→捕获→scan_corpus+_word_score 词面内存直查+reason 记降级（永不 5xx）
  - 单测扩展：同步四态/hash 吸收（embed_calls 不变）/model_version 重算计数/指纹归一化快路径/两方言形态一致/降级链（monkeypatch 会话抛错）/连续多次查询+并发混跑无 attached-to-different-loop；既有 test_knowledge_search 全部用例（17 函数/10 处直调点）改 pytest-asyncio await 形态
acceptance:
  - 指纹一致二次查询 embed_calls 零调用（直查库）
  - 单文件改动后仅该文件 chunk 重嵌（embed 计数=该文件 chunk 数）；mtime touch 不重嵌
  - model_version 变更全量重嵌一次
  - SQLite 方言全用例绿；DB 异常 200+词面+reason 含降级
verify:
  - cd backend && uv run pytest app/modules/knowledge/tests/test_knowledge_search.py -q --no-cov
constraints:
  - MUST NOT 引入第二新依赖；MUST NOT 加后台任务/main.py 改动（D-010/D-012 落选）
  - MUST NOT 改六纯函数行为
  - MUST asyncio.Lock（禁 threading.Lock 跨 await）
  - 指纹比较前 MUST list(map(list)) 归一
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
