---
id: task-01
title: '嵌入子进程封装（embedding_worker.py 三闸自灭+代理）+ 向量索引缓存 LRU 上限 + 配置键 + 单测'
title_zh: '嵌入子进程封装（embedding_worker.py 三闸自灭+代理）+ 向量索引缓存 LRU 上限 + 配置键 + 单测'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-16 10:13:55
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-001@v1, D-004@v1]
allowed_paths:
  - backend/app/modules/knowledge/vector_search.py
  - backend/app/modules/knowledge/embedding_worker.py
  - backend/app/modules/knowledge/tests/test_embedding_subprocess.py
  - backend/app/core/config.py
target_files:
  - backend/app/modules/knowledge/vector_search.py
  - NEW:backend/app/modules/knowledge/embedding_worker.py
  - NEW:backend/app/modules/knowledge/tests/test_embedding_subprocess.py
  - backend/app/core/config.py
goal: >
  把 fastembed 嵌入模型移出 backend 主进程（子进程封装+三闸自灭），并给 _indexes 加 LRU 工作区上限——消除 backend RSS 单调增长主因（2026-10-15 夜 7 次 OOM 回归）。
implementation:
  - 新建 backend/app/modules/knowledge/embedding_worker.py：加载 fastembed 模型，stdin/stdout 行协议（{"id","op":"embed","texts"} → {"id","ok",...vectors|"error"}）；三闸自灭=闲置 idle_exit_sec(默认900)/stdin EOF 立即退/硬寿命 60min；启动重置自身 oom_score_adj=0（/proc 不可用 fail-soft）；stdin 等待用读线程（Windows 无 select-on-pipe）
  - 改 backend/app/modules/knowledge/vector_search.py:137-154 get_embedder：返回 EmbeddingSubprocessProxy（embed() 管道往返，签名与 FastembedEmbedder 一致）；spawn 失败沿用失败原因缓存；连续 3 次崩溃标记不可用退避 10min
  - 改 backend/app/modules/knowledge/vector_search.py:168-171 _indexes：LRU 上限 knowledge_embedding_index_max_ws（默认 4）淘汰最久未用
  - 改 backend/app/core/config.py 加两键（idle_exit_sec=900 / index_max_ws=4；bundle 帽键留 task-02）
  - 新建 backend/app/modules/knowledge/tests/test_embedding_subprocess.py：行协议往返/三闸自灭（注入假时钟或假进程）/spawn 失败 fail-soft/连续崩溃退避/并发 embed 单例串行化不重复 spawn
acceptance:
  - 主进程不再有 TextEmbedding 加载路径（代理化后 grep 断言）
  - 闲置/EOF/寿命帽三路径子进程退出且下次请求重新拉起（测试）
  - _indexes 超 4 工作区按 LRU 淘汰（测试）
  - 既有 knowledge 模块测试全绿（模块级回归，见 verify 命令覆盖范围）
verify:
  - cd backend && uv run pytest app/modules/knowledge -q --no-cov
  - cd backend && uv run ruff check app/modules/knowledge app/core/config.py && uv run mypy app
constraints:
  - 三平台兼容：Windows/macOS 无 /proc 时 fail-soft 跳过重置；读线程等待
  - MUST NOT 回退进程内加载；fail-soft 与现状模型缺席同语义（model_ready=false+词面兜底）
  - get_embedder 返回签名不变（knowledge/search.py pgvector 编排零改动）
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
