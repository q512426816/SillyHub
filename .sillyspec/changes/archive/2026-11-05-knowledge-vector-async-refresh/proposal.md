---
author: flow-machine-draft
created_at: 2026-11-04T16:40:01.740Z
---
# 提案书（Proposal）— 2026-11-05-knowledge-vector-async-refresh

## 动机

任务原话转写：CLI 向量检索端点读路径去嵌入化

动机与背景：
生产实证（2026-11-05）：POST /api/spec/knowledge/vector-search 冷启动请求分钟级挂起（CLI 3s 预算超时静默降级、curl 15s 无响应）。根因 = search_sync 指纹失配/缺缓存在请求路径内同步做全量语料嵌入（vector_search.py 检索主体），叠加容器内模型首用现场下载（镜像未预烤、HF 网络受限）。同病已两度根治于 UI 搜索路径（search.py）：2026-10-19-knowledge-search-build-switch（禁建库开关）、2026-11-03-knowledge-search-async-refresh（读路径去嵌入化+后台同步）——本 CLI 端点两者皆未覆盖。

成功标准：
- 冷启动（无缓存）首查即时返回空 results + index_sync=scheduled，语料嵌入转进程内后台线程（在途判重），请求不再阻塞
- 缓存陈旧（指纹失配）时即时返回旧索引结果并调度后台重建（stale-while-revalidate）
- KNOWLEDGE_SEARCH_SERVER_BUILD=0 时后台构建不调度，冷启动返回 reason=index_not_built（对齐 search.py 既有治理口径）
- 查询单条嵌入限时（默认 15s）——worker 子进程挂起不再把请求拖到 300s
- 镜像预烤 bge-small-zh-v1.5 模型（fail-soft 层，hf-mirror 源），容器内不再首用下载
- 既有测试面等价迁移（分批/指纹/LRU 隔离/排序/fail-soft）全绿 + 新增冷启动/陈旧/判重/开关关闭/查询限时用例

## 变更范围

按成功标准机械推导，共 6 条验收面：
1. 冷启动（无缓存）首查即时返回空 results + index_sync=scheduled，语料嵌入转进程内后台线程（在途判重），请求不再阻塞
2. 缓存陈旧（指纹失配）时即时返回旧索引结果并调度后台重建（stale-while-revalidate）
3. KNOWLEDGE_SEARCH_SERVER_BUILD=0 时后台构建不调度，冷启动返回 reason=index_not_built（对齐 search.py 既有治理口径）
4. 查询单条嵌入限时（默认 15s）——worker 子进程挂起不再把请求拖到 300s
5. 镜像预烤 bge-small-zh-v1.5 模型（fail-soft 层，hf-mirror 源），容器内不再首用下载
6. 既有测试面等价迁移（分批/指纹/LRU 隔离/排序/fail-soft）全绿 + 新增冷启动/陈旧/判重/开关关闭/查询限时用例

## 成功标准（可验证）

1. 冷启动（无缓存）首查即时返回空 results + index_sync=scheduled，语料嵌入转进程内后台线程（在途判重），请求不再阻塞
2. 缓存陈旧（指纹失配）时即时返回旧索引结果并调度后台重建（stale-while-revalidate）
3. KNOWLEDGE_SEARCH_SERVER_BUILD=0 时后台构建不调度，冷启动返回 reason=index_not_built（对齐 search.py 既有治理口径）
4. 查询单条嵌入限时（默认 15s）——worker 子进程挂起不再把请求拖到 300s
5. 镜像预烤 bge-small-zh-v1.5 模型（fail-soft 层，hf-mirror 源），容器内不再首用下载
6. 既有测试面等价迁移（分批/指纹/LRU 隔离/排序/fail-soft）全绿 + 新增冷启动/陈旧/判重/开关关闭/查询限时用例
