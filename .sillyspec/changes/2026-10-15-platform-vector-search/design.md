---
author: flow-machine-draft
created_at: 2026-10-15T03:25:03.698Z
---
# 设计记录（Design Record）— 2026-10-15-platform-vector-search

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

效果评估清偿批 B1 平台面（用户拍板本地小模型方案）：CLI 向量召回层 2026-09-29 发布即对接本端点，平台从未实现（404 半个月实证；CLI 侧已收紧为显式开启+404 短路，见 sillyspec 仓 2026-10-15-vector-gate-tighten）。本变更补齐平台端四件：

① **端点** `POST /api/spec/knowledge/vector-search`（vector_router.py，独立 router 不入 /workspaces/{id}/knowledge/* 族——路径在 /spec/* 命名空间、shpsync token 鉴权单通道，对齐 platform_sync router 形态）。鉴权复用 require_platform_sync 三通道分流，但**只接受 shpsync_ workspace token**（scope.workspace_id 非 None；shk_live_/JWT 凭据有效也 403——并集 scope 表达不了「检索单一 workspace 语料」，且 CLI 固化 Bearer shpsync_）。

② **embedding = fastembed 本地 ONNX 小模型**（`BAAI/bge-small-zh-v1.5`，512 维，镜像内 ~90MB 首用自动下载，零 key 零 API 零持续成本；`Settings.knowledge_embedding_model` 可配）。lazy import 不阻塞启动；初始化任何异常缓存为不可用态（进程级一次），端点 fail-soft 返回 `{ok, results:[], model_ready:false, reason}`——CLI 按空 results 静默降级本地词面层（与 404 时代降级契约同语义）。

③ **索引** = 进程内 per-workspace 按文件集指纹 `(name, mtime_ns, size)` 懒构建缓存。**设计偏差（相对提案）**：daemon sync 挂点灌索引 → 查询时懒构建（语料 700-2400 条秒级，免 daemon 改动，文件增删改自动失效自愈）。

④ **语料与相似度**：workspace spec 树 `knowledge/decisions/*.md` 条目（CLI `buildResultFromPlatform` 只认该前缀），embedding 文本 = `id+标题+理由`（rejected 条目照常入索引——策略面 CLI 本地解析，「平台只做语义召回」原则）；归一化点积纯 Python（不引 numpy 耦合）。检索主体经 run_in_threadpool 卸载（首查秒级不卡事件循环）。

依赖：pyproject 增 `fastembed>=0.4`（uv lock 已同步）；测试不依赖 fastembed（embedder 全 fake 注入）。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `POST /api/spec/knowledge/vector-search`：Body `{query: str, limit: int = 10}` → `200 {ok: true, results: [{spec_path, anchor, change, score}], model_ready: bool, reason: str|null}`；401 无凭据/凭据无效、403 非 shpsync 凭据、404 未知 workspace（hits 同语义）。model_ready/reason 为附加可观测键（CLI 忽略未知键）。
- `Settings.knowledge_embedding_model`（env `KNOWLEDGE_EMBEDDING_MODEL`）。
- main.py 增 knowledge_vector_router 挂载（/api 前缀）；pyproject 增 fastembed。
- CLI 侧消费零改动：本仓 local.yaml `knowledge.vector_search: on` 打开即通（部署新后端后）。

## 文件变更清单

| 文件 | 变更 |
|------|------|
| backend/app/modules/knowledge/vector_search.py | 新增——检索服务核心（解析/指纹/索引/embedder 单例/余弦） |
| backend/app/modules/knowledge/vector_router.py | 新增——POST /api/spec/knowledge/vector-search 路由 |
| backend/app/modules/knowledge/schema.py | 增量——VectorSearchIn/ResultItem/Out 三模型 |
| backend/app/core/config.py | 增量——knowledge_embedding_model 字段（默认 BAAI/bge-small-zh-v1.5） |
| backend/app/main.py | 增量——knowledge_vector_router 挂载（/api 前缀） |
| backend/pyproject.toml + uv.lock | 增量——fastembed>=0.4 依赖（uv lock 实跑同步） |
| backend/app/modules/knowledge/tests/test_vector_search.py | 新增——9 组测试（解析/指纹/排序/fail-soft/路由 401·403·200·降级） |

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

1. 乱序/迟到到达：索引按指纹失效自愈——spec 树同步晚到/乱序只造成一次多余重建，语义最终一致；无跨请求时序依赖。
2. 并发写：_indexes/_embedder 全局态有 threading.Lock；并发首查同 workspace 会串行重建（最坏重复一次 embed，秒级，无腐化）；spec 树文件由 daemon 同步写、本服务只读（mtime 指纹容忍读到半态——重建发生在读后，坏行解析 fail-soft 跳过）。
3. 切换/生命周期：进程重启索引/单例全重建（懒加载零预热义务）；模型名变更自动换缓存键；uv sync 后 dev 依赖回归已实测（uv run 自愈）。
4. 作用域：workspace 以 token 派生 id 隔离，索引键 (workspace_id, model_name) 双键；跨 workspace 串台有测试钉（ws-a/ws-b 各自建索引）；平台多实例（横向扩容）各持独立内存索引——正确语义（语料只读，重建幂等），无共享态需求。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

最大风险：真模型首查秒级 embed 延迟（700-2400 条）+ 首次模型下载 90MB——已卸线程池不卡事件循环；生产建议镜像预烤模型（文档在 FastembedEmbedder docstring）；workspace 语料超万条时首查可感——当前量级（本体系最大 2400）无虞，超限再引增量索引。次风险：fastembed/ONNX 依赖体积（镜像 +~200MB）——用户已拍板接受；embedding 质量对极短条目（纯标题无理由）弱——语料契约本就含理由文本，模板保证在场。死路（放弃）：①API embedding（litellm/openai）——用户指出 litellm 平台侧已去，且要 key 要钱要外网；②统计向量（TF-IDF/n-gram）——与 CLI 本地层同构重复建设，语义增益零；③pgvector——2400 条暴力余弦毫秒级，数据库往返反而更慢且加迁移负担；④daemon sync 挂点灌索引——免 daemon 改动的懒构建已覆盖，挂点属过早优化。
