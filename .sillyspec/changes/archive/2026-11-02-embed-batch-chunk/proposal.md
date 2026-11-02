---
author: flow-machine-draft
created_at: 2026-11-02T01:03:44.469Z
---
# 提案书（Proposal）— 2026-11-02-embed-batch-chunk

## 动机

任务原话转写：embedding 全量批分批化根治 cgroup OOM

动机与背景：生产（腾讯云 124.222.127.242）10-29/10-30/11-02 共 6 次 dmesg Memory cgroup OOM，被杀进程为 backend 容器内 embedding 子进程（RSS 稳定 2.3~2.45GB，撞 2500m mem_limit）。根因：/api/knowledge/vector-search 缓存未命中时 search_sync 把整个决策语料一次性 embedder.embed(全量 texts)（vector_search.py:419），语料随使用增长已越过配额，且只会更大。宿主内存充裕（available 5.9G），纯配额内单批过大问题。

成功标准：
- search_sync 索引重建路径按固定批大小（≤64 条/批）分批调用 embed，不再存在单次全量调用；
- 既有向量搜索行为不回归（检索结果排序/缓存语义不变）；
- backend 相关测试全绿，ruff 零告警。

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. search_sync 索引重建路径按固定批大小（≤64 条/批）分批调用 embed，不再存在单次全量调用；
2. 既有向量搜索行为不回归（检索结果排序/缓存语义不变）；
3. backend 相关测试全绿，ruff 零告警。

## 成功标准（可验证）

1. search_sync 索引重建路径按固定批大小（≤64 条/批）分批调用 embed，不再存在单次全量调用；
2. 既有向量搜索行为不回归（检索结果排序/缓存语义不变）；
3. backend 相关测试全绿，ruff 零告警。
