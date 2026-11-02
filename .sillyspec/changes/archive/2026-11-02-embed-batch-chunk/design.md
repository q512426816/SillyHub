---
author: flow-machine-draft
created_at: 2026-11-02T01:03:44.470Z
---
# 设计记录（Design Record）— 2026-11-02-embed-batch-chunk

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

答：在 `vector_search.py` 加模块级常量 `_EMBED_BATCH_SIZE = 32` 与聚合助手 `_embed_corpus(embedder, texts)`——把 `search_sync` 索引重建处的一次性全量 `embedder.embed([e.text for e in entries])` 改为按 32 条/批顺序分批调用并按序 `extend` 聚合；查询嵌入（`embed([q])`）与缓存/指纹逻辑零改动。选调用点分批而非代理层（`EmbeddingSubprocessProxy.embed` 内分批）：① 改动面最小且天然让每批各享一次代理超时/透明重启重试语义（代理层分批需把整段批序列塞进一个 300s deadline，超时与重试语义要重造）；② 现存 embed 调用点仅两处（语料全量 + 单条查询），爆炸面就是索引重建这一处，调用点收口即根治；③ 既有 FakeEmbedder 注入测试可直接断言批形状，无需 mock 子进程协议。批大小经生产 A/B 实测定档（998 条真实语料，bge-small-zh-v1.5）：64 → cgroup 峰值 2.09GiB（对 2500m 配额余量不足），32 → 峰值 1.47GiB/稳态 1.26GiB（留 ~1GB 余量给并发翻译 worker）——推理瞬态随 batch×seq² 缩放，批形状（而非语料总量）成为内存上界的决定项。

依据：2026-11-02 生产排查（dmesg 6 次 `Memory cgroup out of memory: Killed process (python)`，RSS 稳定 2.3~2.45GB；Netdata `mem.oom_kill` 告警 10-29×3/10-30/11-02；触发端点 `/api/knowledge/vector-search` 缓存未命中 → `vector_search.py:419` 全量批）；宿主内存充裕（available 5.9G），纯 cgroup 配额内单批过大。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

答：对外 API/端点/HTTP 契约**无变化**（`/api/knowledge/vector-search` 请求响应体不变）。模块内变化：`search_sync` 内部语料嵌入从单次全量调用改为 `_embed_corpus` 分批聚合（新增私有函数 + 模块常量 `_EMBED_BATCH_SIZE`）；`EmbeddingSubprocessProxy.embed` 签名与行为零改动（每批即一次普通 embed 请求，超时/崩溃重试/退避语义按批生效）。行为可观测差异：一次索引重建期间子进程收到多条（⌈N/32⌉ 条）embed 请求而非一条。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   答：成立——分批在 `search_sync` 单线程内顺序发出、按序聚合（`extend` 保序），无乱序面；子进程行协议本就按请求 id 串行应答（代理持锁），多批只是多次串行往返。指纹缓存判定发生在分批之前，与批形状无关。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   答：不变——索引缓存的读（`_index_cache_get`）与写（`_index_cache_put`）各自持 `_index_lock` 短临界区，重建（含分批 embed）发生在两锁之间的锁外区：并发首查可能双双重建，这是既有行为（分批前后一致），重建幂等、put 原子整体替换无半成品撕裂，无正确性影响；批与批之间经 `EmbeddingSubprocessProxy.embed` 自身 `self._lock` 串行化，跨请求无批交错。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   答：安全——中途某批失败（worker 被杀/超时）时行为与今天单批失败一致：`EmbeddingSubprocessError` 向上抛，索引缓存不写入半成品（`cached` 赋值在全部批次完成后），下一个请求重新完整重建；已完成批的向量是局部变量，无持久化残留。worker 三闸自灭（闲置/父亡/寿命帽）与批间空闲无交互（批间隔毫秒级，远小于 900s 闲置闸）。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   答：不会——缓存键仍为 `(workspace_key, model_name)`+指纹，分批不触碰键语义；多 workspace 轮换挤出 LRU 缓存后重建，同样走分批路径，无跨 workspace 状态。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

答：最大风险：批内失败重试粒度变粗的反向担忧——实为不变（今天单批失败也是整体重建重来，分批后同样整体重来，且单批成功率上升而非下降）。次级风险：批大小 64 若未来语料单条文本极长（每条数十 KB），单批字节量仍可能偏大——当前决策条目文本为百字级，64×百字 ≈ 数十 KB JSON，远低于风险线；若未来形态变化，常量提升为 Settings 配置即可（本变更不做，避免无据配置面）。试过但放弃的方案：① 代理层（`EmbeddingSubprocessProxy.embed`）透明分批——超时/透明重启重试语义需在代理内重造（整批序列共享 deadline 的切分与 `attempts` 计数重定义），复杂度高于收益，且现存爆炸面仅 search_sync 一处；② 只提 mem_limit（2500m→3500m）——治标：语料单调增长，2026-10-24 的 1100m→2500m 提额四天后即被 2.4GB 批复现，继续提额只是推迟；③ worker 侧（embedding_worker.py）内部再分批——worker 收到的单请求 JSON 已含全量 texts，解析瞬间内存峰值已发生，worker 内分批为时已晚，必须在请求发起侧收口。

## 文件变更清单

| 操作 | 路径 | 说明 |
| --- | --- | --- |
| 修改 | backend/app/modules/knowledge/vector_search.py | 新增 `_EMBED_BATCH_SIZE` 常量与 `_embed_corpus` 分批聚合助手；`search_sync` 索引重建改走分批；文件头设计注补一条分批说明 |
| 修改 | backend/app/modules/knowledge/tests/test_vector_search.py | FakeEmbedder 增批形状记录；新增 `test_index_rebuild_embeds_in_batches`（批上限/顺序聚合/查询独立成批/小语料单批） |
