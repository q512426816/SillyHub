---
author: flow-machine-draft
created_at: 2026-10-15T03:25:03.698Z
---
# 需求规格（Requirements）— 2026-10-15-platform-vector-search

## 功能需求

### FR-01: 端点契约逐字段对齐 CLI：Bearer shpsync 鉴权（无 token 401、非 shpsync 凭据 403）、Body {query,limit}、200 {ok,results:[{spec_path:'knowledge/decisions/x.md',anchor:'D-xxx@vN',change,score}]}

- 端点必须挂在 `/api/spec/knowledge/vector-search`（POST），鉴权必须走 require_platform_sync 三通道分流且**只接受 shpsync_ workspace token**（scope.workspace_id 非 None；shk_live_/JWT 凭据有效也必须 403）；召回条目必须只含 `knowledge/decisions/` 前缀语料且每条必须带 spec_path/anchor/change/score 四键；query 截断 4000 字符、limit 钳 1-50（CLI 同款上限）。

#### 场景：主路径

- Given workspace 语料两条件目，When 带合法 scope POST，Then 200 且结果四键齐全、前缀正确、余弦降序（测试 happy path）。

#### 场景：边界

- 无凭据 → 401；JWT/APIKey 形态 scope（workspace_id=None）→ 403（测试两态）。

### FR-02: 索引懒构建+指纹失效（文件增删改后重建），余弦排序 top-k、limit 钳位

- 索引必须按 decisions 文件集指纹 `(name, mtime_ns, size)` 进程内懒构建缓存：指纹未变必须零重建、文件变更必须重建、不同 workspace 必须各自建索引互不串台；相似度必须为归一化点积（余弦）降序取 top-k。

#### 场景：主路径

- Given 语料三条件目，When 首查/重查/改文件后查/换 workspace 查，Then embed 文本计数依次为 4/5/10/15（测试指纹组）。

### FR-03: fastembed 缺席/模型初始化失败 → 200 {ok,results:[],model_ready:false,reason} 不 5xx 不阻塞启动

- fastembed 依赖缺席或模型初始化任何异常必须 fail-soft：端点返回 200 + 空 results + `model_ready:false` + reason 带因（CLI 按空 results 静默降级本地词面层）；fastembed import 必须 lazy（应用启动零依赖阻塞）；真模型冒烟必须通过（语义排序：词面不相交条目正确召回）。

#### 场景：主路径

- Given get_embedder 注入不可用态，When POST，Then 200/空结果/model_ready false/reason 带因（测试降级组）；真模型 FastembedEmbedder('BAAI/bge-small-zh-v1.5') 冒烟 512 维、查询「缓存淘汰策略该怎么选」对 LRU 条目余弦 ≥0.85、对不相关条目 ≤0.3（留档回执）。

### FR-04: 单测：解析/指纹失效/余弦排序/fake embedder 端点契约/401/403 全绿

- test_vector_search.py 必须覆盖解析双 id 形态/指纹缓存失效/排序契约/fail-soft/路由 401·403·200·降级 全分支且全绿；knowledge 模块既有 166 用例必须零回归。

#### 场景：主路径

- When uv run pytest app/modules/knowledge/tests/，Then 166+9 全绿。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/knowledge/tests/test_vector_search.py「test_vector_search_happy_path_contract」「test_vector_search_requires_token」「test_vector_search_rejects_non_shpsync_scope」
FR-02: backend/app/modules/knowledge/tests/test_vector_search.py「test_index_fingerprint_cache_and_invalidation」「test_search_ranking_limit_and_contract」
FR-03: backend/app/modules/knowledge/tests/test_vector_search.py「test_embedder_unavailable_fail_soft」「test_vector_search_degraded_when_model_unavailable」+ 真模型冒烟留档（verify-result.md）
FR-04: backend/app/modules/knowledge/tests/test_vector_search.py（全文件 9 组）+ 模块回归 166 用例
