---
author: flow-machine-draft
created_at: 2026-11-02T01:03:44.470Z
---
# 需求规格（Requirements）— 2026-11-02-embed-batch-chunk

## 功能需求

### FR-01: search_sync 索引重建路径按固定批大小（≤64 条/批）分批调用 embed，不再存在单次全量调用；

- search_sync 的索引重建路径**必须**按固定批大小（`_EMBED_BATCH_SIZE` = 32 条/批）分批调用 `embedder.embed`，**禁止**把整个决策语料一次性传入单次 embed 请求（2026-11-02 生产实证：全量批把 embedding 子进程 RSS 推到 2.3~2.45GB，撞 backend 容器 2500m cgroup 配额被 OOM 强杀，dmesg 6 次记录 10-29/10-30/11-02；批大小生产 A/B 实测：64 → 峰值 2.09GiB 余量不足，32 → 1.47GiB 稳态 1.26GiB）。

#### 场景：索引重建分批

- Given：workspace 首次向量搜索（索引缓存未命中），decisions 语料 150 条；
- When：调用 search_sync；
- Then：语料嵌入经多次 embed 调用完成，每次调用 texts 长度 ≤ 32，各批按顺序聚合后与条目一一对应；查询文本单独 1 条成批。

#### 场景：小语料单批

- Given：语料条目数 ≤ 32；
- When：索引重建；
- Then：仍为单次 embed 调用（分批不改变小语料行为面）。

### FR-02: 既有向量搜索行为不回归（检索结果排序/缓存语义不变）；

- 分批**必须**对调用方透明：检索结果排序、索引缓存命中/指纹失效语义、embedder 不可用 fail-soft 语义均**必须**与分批前一致（分批只改变喂给 embed 的批形状，不改变聚合结果与缓存键语义）。

#### 场景：排序与缓存不回归

- Given：既有测试 `test_index_fingerprint_cache_and_invalidation`、`test_search_ranking_limit_and_contract` 的全部夹具与断言；
- When：实施分批后运行；
- Then：全部原样通过（断言零修改）。

### FR-03: backend 相关测试全绿，ruff 零告警。

- 本变更涉及的 backend 测试面（knowledge 模块测试 ∪ FR 关联回归）**必须**全绿，ruff/format **必须**零告警。

#### 场景：验收

- Given：实现合入后；
- When：运行 knowledge 模块测试与 ruff 检查；
- Then：全部通过、零告警。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/knowledge/tests/test_vector_search.py「test_index_rebuild_embeds_in_batches（新增：批上限/顺序聚合/查询独立成批）」
FR-02: backend/app/modules/knowledge/tests/test_vector_search.py「test_index_fingerprint_cache_and_invalidation / test_search_ranking_limit_and_contract（既有断言零改动通过）」
FR-03: backend/app/modules/knowledge/tests/「knowledge 模块测试面全绿 + ruff 零告警（不适用单用例：以模块面+lint 命令输出为证据）」
