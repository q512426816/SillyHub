---
id: task-01
title: 'Backend knowledge search service (search.py)'
title_zh: '后端检索服务（语料扫描/三档切块/懒索引/词面向量融合/片段提取）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-15 16:26:20
priority: P0
depends_on: []
blocks: [task-02]
requirement_ids: [FR-01, FR-02, FR-03, FR-06]
decision_ids: [D-002@v1, D-003@v1, D-004@v1, D-007@v1]
allowed_paths:
  - backend/app/modules/knowledge/search.py
  - backend/app/modules/knowledge/tests/test_knowledge_search.py
target_files:
  - NEW:backend/app/modules/knowledge/search.py
  - NEW:backend/app/modules/knowledge/tests/test_knowledge_search.py
provides:
  - contract: search_sync
    fields: [results, model_ready, reason, spec_path, kind, title, anchor, snippet, score]
  - contract: Chunk
    fields: [spec_path, kind, title, anchor, start_line, text]
goal: >
  实现平台知识搜索的检索内核（纯函数友好结构，供 task-02 端点经 run_in_threadpool 调用）：
  扫描 spec 根 knowledge/ 与 docs/ 全语料（排 INDEX.md），按结构三档切块为 Chunk，
  进程内懒构建向量索引（全语料指纹失效、与 CLI decisions 索引完全独立），
  词面 + 向量双路融合打分并产出可展示片段。
implementation:
  - 新建 backend/app/modules/knowledge/search.py：Chunk dataclass（spec_path/kind/title/anchor/start_line/text）+ scan_corpus(spec_root)（rglob knowledge/**/*.md ∪ docs/**/*.md，排任意层级 INDEX.md，读失败 fail-soft 跳过）
  - 三档切块（design.md Phase 1 / D-003@v1）：decisions/*.md 按 `## D-...@vN 标题` 条目切（正则独立定义，对齐 backend/app/modules/knowledge/vector_search.py:35 形态不复用该模块）；fr/*.md 按 `## FR-...-NNN 标题` 条目切；其余 md 按 `^## ` 标题块切（frontmatter 段跳过），单块 >1500 字符按 `### ` / 空行段落滑窗细分（窗 ~1000 / 重叠 ~150），anchor=标题 slug 或 None
  - kind 派生（design.md Phase 1 表）：knowledge/decisions→decision、fr→fr、proposed→proposed、generated→generated、顶层→knowledge、docs/<p>/modules→module、scan→scan、flows→flow、glossary.md→glossary
  - 索引：corpus_fingerprint(spec_root)=tuple(sorted((rel_path, mtime_ns, size)))，缓存键 (workspace_key, model_name)，锁内构建（single-flight）；构建顺序 = 先算指纹 → 持锁构建 → 构建完成后复算指纹，变化即重建（design.md Phase 1 索引并发语义）；embedder 经 get_embedder(settings.knowledge_embedding_model)（vector_search.py:137-154）单例共享
  - 检索（D-004@v1）：词面路 title/spec_path/text 子串匹配（title 权重最高、path 次之、正文按次数对数增益，归一化 [0,1]，title 或 path 命中记 word_hit_exact）；向量路归一化点积余弦（纯 Python，口径对齐 vector_search.py:179-197）；融合 score=0.6*vec+0.4*word，word_hit_exact 者 score=max(score,0.9)；embedder 不可用 → {results:[], model_ready:False, reason}；同文件同 anchor 去重取最高分；limit 截断
  - snippet：chunk text 中 query 首次出现 ±120 字符窗口（查询词空/无词面命中取前 240 字符），截断补省略号
  - 配测试 backend/app/modules/knowledge/tests/test_knowledge_search.py：三档切块（条目/标题块/滑窗/阈值边界 1500/1000/150/frontmatter 排除/INDEX.md 排除）、kind 派生全表、指纹失效（增改后重建、无变化零重建）、融合排序（精确编号 rank=1 相对排序断言 + tie-break）、降级（embedder=None 纯词面 + reason）、snippet 提取；fake embedder 字符桶计数向量（对齐 backend/app/modules/knowledge/tests/test_vector_search.py:31-43 形态）
  - 写事件循环隔离辅助：reset_index_for_tests()（测试隔离，production 勿调）
acceptance:
  - 扫描面断言：knowledge/ 与 docs/ 下 md 全部入语料、INDEX.md 与 changes/ 零收录（测试用临时目录构造）
  - 切块断言：D-xxx@vN / FR-xxx-NNN 条目级切块 anchor 正确；普通 md 标题级切块；2000 字符块被滑窗为多块且相邻块重叠 >0
  - 指纹断言：文件未变二次查询零重建（embed_calls 计数）；文件 mtime/size 变化后重建
  - 融合断言：查询词等于某条目编号时该条目 rank=1；纯语义（构造无词面命中的 query + fake embedder 相似向量）也能召回
  - 降级断言：embedder 不可用返回 model_ready=False + reason 非空 + results 为纯词面（不报错）
verify:
  - cd backend && uv run pytest app/modules/knowledge/tests/test_knowledge_search.py -q
  - cd backend && uv run ruff check app/modules/knowledge/search.py app/modules/knowledge/tests/test_knowledge_search.py && uv run mypy app/modules/knowledge/search.py
constraints:
  - MUST NOT 修改 backend/app/modules/knowledge/vector_search.py 与 vector_router.py（CLI 契约零改动，D-009@v1 防复潮）
  - MUST NOT 引入新运行时依赖（fastembed 缺席 fail-soft；余弦纯 Python 不引 numpy 耦合）
  - MUST NOT 收录 changes/ 与 .runtime/（语料边界 D-002@v1）
  - embedding 模型名 MUST 经 settings.knowledge_embedding_model 单一源（get_embedder 单例单槽位，异名互顶）
  - 路径处理 MUST 兼容 Windows（统一 POSIX 形态输出，MUST NOT 硬编码分隔符）
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
