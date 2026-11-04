---
author: flow-machine-draft
created_at: 2026-11-04T16:40:01.740Z
---
# 设计记录（Design Record）— 2026-11-05-knowledge-vector-async-refresh

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

把 2026-11-03-knowledge-search-async-refresh 已在 UI 搜索路径（search.py）归档验证过的「读路径去嵌入化（stale-while-revalidate）」模式迁移到 CLI 向量端点（vector_search.py）：search_sync 检索主体改为只读判定（缓存 fresh 直查 / stale 用旧索引出结果并调度后台重建 / missing 即时空返回并调度后台首建），语料解析+嵌入全部移入进程内后台线程（注册表在途判重 + 强引用），请求路径永不等待语料嵌入。根因（vector_search.py:435-439 请求内同步全量嵌入，冷启动叠加容器内模型首用下载 → 分钟级挂起，CLI 3s 预算必超时）由此消除——与 2026-10-19-knowledge-search-build-switch 的「服务器禁建库」治理语义打通：knowledge_search_server_build=False 时后台构建同样不调度。

配套两件：① 查询单条嵌入限时（EmbeddingSubprocessProxy.embed 增 keyword-only timeout_sec，默认 None=沿用 REQUEST_TIMEOUT_SEC=300s；search_sync 查询路传 15s）——即使 worker 子进程挂起（模型下载死连等），请求也在秒级降级返回而非 300s；② backend/Dockerfile 预烤 bge-small-zh-v1.5（builder 段 HF_ENDPOINT=https://hf-mirror.com 下载 → COPY 进 runtime + ENV FASTEMBED_CACHE_PATH），fail-soft 层——镜像源失败只告警不破构建。选该方案因为同病同药先例已在同仓两次落地（build-switch / async-refresh），模式、命名、reason 口径（index_not_built）全部对齐，零新机制发明。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `vector_search.search_sync(spec_root, workspace_key, query, limit, embedder, model_name, *, embedder_error=None, server_build=True) -> dict`：新增 keyword-only `server_build`（「服务器禁建库」开关，router 从 settings.knowledge_search_server_build 注入——对齐 search.py 同名参数注入模式，服务层不读 settings）；返回 dict 新增可选键 `index_sync`（"scheduled" 表示已调度后台构建；其余情形键缺省）。行为变化：missing→即时 `{results:[], model_ready:True, index_sync:"scheduled"}`；stale→旧索引即时结果 + `index_sync:"scheduled"`；开关关且 missing→`{results:[], reason:"index_not_built"}`；查询嵌入失败/超时→`{results:[], model_ready:False, reason:<因>}`（fail-soft 不抛）。
- `EmbeddingSubprocessProxy.embed(texts, *, timeout_sec=None)`：新增 keyword-only 参数；None=REQUEST_TIMEOUT_SEC(300s) 原语义不变（语料批量路）。duck-typed fake 注入方（测试）需接受该 kwarg。
- 新增内部面：`_bg_builds: dict[key, Thread]` 注册表、`_schedule_background_build(...)`、`await_background_builds_for_tests()`（测试隔离钩子，同 reset_index_for_tests 族）。
- HTTP 契约：`POST /api/spec/knowledge/vector-search` 200 载荷新增可选字段 `index_sync`（VectorSearchOut 增 `index_sync: str | None = None`）——CLI（sillyspec 仓 knowledge-vector.js）只读 `results[]`，新增字段向后兼容零影响；`model_ready/reason` 语义不变。
- 环境变量/配置：无新增键（复用 KNOWLEDGE_SEARCH_SERVER_BUILD；查询限时为模块常量非配置）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   成立。指纹在后台构建开始时采样（fp 取建首而非请求时传参）：构建期间语料再变 → 缓存落盘的指纹与下次请求实测指纹失配 → 再次调度重建（自愈，无需失效通知）。请求序乱序无影响——每个请求只读缓存 + 判定，无跨请求顺序假设。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   `_indexes` 与 `_bg_builds` 各自由既有 `_index_lock` / 注册表判重保护：并发冷启动请求同键只启动一个构建线程（`Thread.is_alive()` 判重 + 启动前检查，竞窗内重复启动最坏多建一份索引，`_index_cache_put` 原子替换无破坏，幂等收敛）。`_embed_corpus` 在后台线程内经 EmbeddingSubprocessProxy 的 `self._lock` 串行喂批，与查询嵌入天然互斥。语料文件读为只读快照（parse 时 read_text），与 sync 写侧（外部进程写文件）无共享句柄。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   安全。构建线程 daemon=True：进程退出不阻塞；中途被杀 → 缓存未写（`_index_cache_put` 是构建完成后的单点原子替换，无半成品缓存态），下次请求指纹仍失配再调度（自愈）。失败只记日志不重试（对齐 search.py D-003：防周期空转，重触发权交给下一次查询）。请求即返后客户端断连不影响后台构建继续完成（线程不随请求取消）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   不会。索引键 `(workspace_key, model_name)` 既有隔离不变；后台注册表同键空间，判重不跨工作区误伤。多 worker 实例（uvicorn 多进程）各自进程内缓存+线程，最坏各建一份（现状既有语义，无共享态引入）。禁建库开关为进程级 settings，语义与 search.py 同源。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：生产 KNOWLEDGE_SEARCH_SERVER_BUILD=0（2026-10-19 为小内存容器而设）时本端点将恒空结果（快速降级但无向量召回）——这是治理决策的正确行为而非缺陷；向量召回恢复需运维将开关回 1（mem_limit 已 3500m，批 32 实测峰值 1.47GiB 有余量）或外部预建（本端点无 PG 持久化，不适用）。次风险：CLI 预算 3s < worker 冷启 1~3s+查询嵌入，偶发查询仍会降级——属 sillyspec 仓 CLI 侧常量（VECTOR_TIMEOUT_MS=3000 硬编码）的独立议题，本变更不动其契约。

死路：① 改为 pgvector 持久化复用 search.py 索引——放弃：两路语料口径不同（UI 路 scan 全树 chunks vs 本路仅 decisions 条目）、引入 DB schema 变更面，远超「消除挂起」的必要量；② asyncio.create_task 版后台（照抄 search.py 形态）——放弃：search_sync 经 run_in_threadpool 调用，无事件循环上下文，threading.Thread 才是正确执行面；③ 请求路径保留同步构建但加 overall deadline——放弃：治标不治本，冷启动请求仍占满线程池预算（anyio 默认 40 线程，几个并发冷查询即耗尽）。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/knowledge/vector_search.py | search_sync 去嵌入化分流（fresh/stale/missing）+ 后台构建注册表与调度 + 禁建库开关门控 + 查询嵌入限时传参 + await_background_builds_for_tests |
| 修改 | backend/app/modules/knowledge/schema.py | VectorSearchOut 增 index_sync: str \| None = None |
| 修改 | backend/app/modules/knowledge/vector_router.py | 出参透传 index_sync（一行） |
| 修改 | backend/Dockerfile | builder 段预烤 bge-small-zh-v1.5（hf-mirror，fail-soft）+ runtime COPY + ENV FASTEMBED_CACHE_PATH |
| 修改 | backend/app/modules/knowledge/tests/test_vector_search.py | 既有同步语义断言按新契约等价迁移 + 新增五类用例（冷启动/陈旧/判重/开关/限时） |
