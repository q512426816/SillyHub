---
author: flow-machine-draft
created_at: 2026-11-04T16:40:01.740Z
---
# 需求规格（Requirements）— 2026-11-05-knowledge-vector-async-refresh

## 功能需求

### FR-01: 冷启动（无缓存）首查即时返回空 results + index_sync=scheduled，语料嵌入转进程内后台线程（在途判重），请求不再阻塞

- search_sync 在索引缓存缺失（冷启动/进程重启后）时**必须**零嵌入返回：results=[] + model_ready=True + index_sync="scheduled"，同时调度进程内后台线程执行全量语料解析+嵌入（沿用 _embed_corpus 32 条/批），且同一 (workspace, model) 键在途构建**必须**判重（存活即跳过，不重复建）。

#### 场景：冷启动首查

- Given 后端进程刚启动（_indexes 空）且语料 decisions/ 在场、embedder 可用
- When POST /api/spec/knowledge/vector-search {query, limit}
- Then 立即（无语料嵌入等待）返回 200 {ok:true, results:[], index_sync:"scheduled"}；后台线程完成语料嵌入后缓存就位，**第二次**同查询返回真实向量召回且不再触发语料嵌入（只嵌查询 1 条）

#### 场景：在途判重

- Given 键 (ws, model) 的后台构建线程存活在途
- When 再次发起同工作区查询
- Then 不再启动第二个构建线程（注册表判重），请求照常即时返回

### FR-02: 缓存陈旧（指纹失配）时即时返回旧索引结果并调度后台重建（stale-while-revalidate）

- search_sync 在缓存在场但指纹失配（语料文件增删改）时**必须**用旧索引即时出结果（正常查询嵌入+余弦）并返回 index_sync="scheduled"，同时调度后台重建；**禁止**在请求路径内同步重建语料嵌入。

#### 场景：语料变更后首查

- Given 索引缓存命中过且语料 demo.md 已追加新条目（指纹失配）
- When 查询命中
- Then 返回旧索引的召回结果（新条目不在其中）+ index_sync="scheduled"；后台重建完成后下一查返回含新条目的结果

### FR-03: KNOWLEDGE_SEARCH_SERVER_BUILD=0 时后台构建不调度，冷启动返回 reason=index_not_built（对齐 search.py 既有治理口径）

- settings.knowledge_search_server_build 为 False 时（env KNOWLEDGE_SEARCH_SERVER_BUILD=0）**必须**跳过后台构建调度（容器内禁嵌入建库，与 search.py「服务器禁建库开关」同一治理语义），冷启动返回 results=[] + reason="index_not_built"；存量陈旧缓存照常服务（stale 结果不受开关影响，仅不再重建）。

#### 场景：禁建库开关关闭

- Given monkeypatch settings.knowledge_search_server_build=False 且索引缓存为空
- When 查询命中
- Then 返回 results=[] + reason="index_not_built"，后台构建线程零启动（注册表为空）

### FR-04: 查询单条嵌入限时（默认 15s）——worker 子进程挂起不再把请求拖到 300s

- 查询向量嵌入（单条）**必须**带独立限时（模块常量 _QUERY_EMBED_TIMEOUT_SEC=15.0，经 EmbeddingSubprocessProxy.embed(timeout_sec=…) 传达；语料批量嵌入维持 REQUEST_TIMEOUT_SEC=300s 不变）；限时到点**必须** fail-soft 返回 results=[] + model_ready=False + reason 带因，**禁止**抛 5xx。

#### 场景：worker 挂起

- Given 注入的 embedder 查询嵌入阻塞超过限时
- When 查询命中（索引缓存 fresh）
- Then 在限时预算内返回 200 降级（model_ready=False + reason 含超时语义），不抛异常

### FR-05: 镜像预烤 bge-small-zh-v1.5 模型（fail-soft 层，hf-mirror 源），容器内不再首用下载

- backend/Dockerfile **必须**在 builder 段预下载 bge-small-zh-v1.5 到固定缓存路径并 COPY 进 runtime + 设置 FASTEMBED_CACHE_PATH 指向该路径；预烤层**必须** fail-soft（镜像源失败只告警不破构建，回退首用下载现状），下载源用 HF_ENDPOINT=https://hf-mirror.com（与仓内 npmmirror/tsinghua/aliyun 国内源策略一致）。

#### 场景：镜像构建

- Given 构建机可达 hf-mirror.com
- When docker build backend
- Then 模型文件进镜像层；运行时 TextEmbedding 初始化零网络下载

### FR-06: 既有测试面等价迁移（分批/指纹/LRU 隔离/排序/fail-soft）全绿 + 新增冷启动/陈旧/判重/开关关闭/查询限时用例

- 既有同步语义断言（首查全量嵌入/同请求内重建）**必须**按新异步契约等价改写（断言面迁移到「调度→等待后台→复查」形态），分批形状/LRU 工作区隔离/排序/fail-soft 覆盖**必须**保留不降级；**必须**新增：冷启动即时返回、陈旧 stale-serve、在途判重、开关关闭零调度、查询嵌入超时降级 五类用例；全套 backend knowledge 向量面测试全绿。

#### 场景：回归等价

- Given 本变更合入后
- When 运行 backend/app/modules/knowledge/tests/test_vector_search.py
- Then 全部用例通过（含迁移改写与新增）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/knowledge/tests/test_vector_search.py「test_cold_query_returns_immediately_and_background_builds」
FR-02: backend/app/modules/knowledge/tests/test_vector_search.py「test_stale_index_serves_old_results_and_reschedules」
FR-03: backend/app/modules/knowledge/tests/test_vector_search.py「test_server_build_disabled_skips_scheduling」
FR-04: backend/app/modules/knowledge/tests/test_vector_search.py「test_query_embed_timeout_degrades_fail_soft」
FR-05: 不适用：镜像构建层纯配置面，运行时行为由 FR-01/02 用例覆盖——预烤层以 Dockerfile 人工核验（构建验证归部署面），不写单测
FR-06: backend/app/modules/knowledge/tests/test_vector_search.py「test_index_fingerprint_cache_and_invalidation」+「test_index_rebuild_embeds_in_batches」+ 既有迁移面全绿
