---
author: flow-machine-draft
created_at: 2026-11-04T16:40:01.740Z
---
# 任务注册表（Tasks）— 2026-11-05-knowledge-vector-async-refresh

- [x] task-01: vector_search.py 检索主体分流重构——search_sync 改只读判定（missing 即时空返回+调度后台首建；stale 旧索引即时出结果+调度重建；fresh 直查）+ `_bg_builds` 注册表在途判重 + `await_background_builds_for_tests` 隔离钩子；验证：新增冷启动/判重用例绿（test_vector_search.py）
- [x] task-02: 禁建库开关门控——`knowledge_search_server_build=False` 时跳过调度、冷启动返回 reason=index_not_built（stale 服务不受开关影响）；验证：开关关闭用例绿（注册表零线程断言）
- [x] task-03: 查询嵌入限时——EmbeddingSubprocessProxy.embed 增 keyword-only `timeout_sec`（None=300s 原语义），search_sync 查询路传 `_QUERY_EMBED_TIMEOUT_SEC=15.0`，超时/失败 fail-soft 降级不抛；验证：注入阻塞 embedder 的限时用例绿（秒级返回 model_ready=False）
- [x] task-04: 契约透传——schema.py VectorSearchOut 增 `index_sync: str | None = None` + vector_router 出参透传；验证：路由 happy path 契约用例（含新字段）绿
- [x] task-05: Dockerfile 预烤 bge-small-zh-v1.5——builder 段 HF_ENDPOINT=https://hf-mirror.com 下载到 /opt/fastembed-cache（fail-soft 层，失败告警不破构建）+ runtime COPY + ENV FASTEMBED_CACHE_PATH；验证：人工核验层口径 + 本变更测试面全绿（运行时行为由 task-01/02 覆盖）
- [x] task-06: 既有测试面等价迁移——指纹缓存/分批形状/小语料单批/排序 limit 契约/fail-soft/路由四用例按新异步契约改写（覆盖不降级）+ 新增五类用例收口全绿；验证：`python -m pytest app/modules/knowledge/tests/test_vector_search.py` 全绿 + ruff 零告警
