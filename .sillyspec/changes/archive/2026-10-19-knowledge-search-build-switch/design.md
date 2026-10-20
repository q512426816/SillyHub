---
author: flow-machine-draft
created_at: 2026-10-19T05:48:59.930Z
---
# 设计记录（Design Record）— 2026-10-19-knowledge-search-build-switch

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）？

沿 known-issues「首搜建库地雷」条目的既定方向做最小闭环：① `config.py` Settings 增 `knowledge_search_server_build: bool = True`（env `KNOWLEDGE_SEARCH_SERVER_BUILD`，默认 True=现行为零变化）；② `search_sync` 增 keyword-only 参数 `server_build`，router 端点从 settings 接线传入。关闭时分支：无 state 行 → 复用既有 `_fallback_word_scan`（词面内存直查，与 DB 异常降级同一条路）返回 `model_ready=False + reason="index_not_built"`；有 state 行 → 跳过 `_ensure_synced`（全量与差量嵌入都禁），直接走既有查询双路（词面 ILIKE + 向量 KNN 查存量行，查询向量嵌入保留——容器只跑查询的既定运维口径）。改动面三点式：config 一字段、search.py 一分支、router 一参数，复用全部既有降级基建，不新增文件。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- `app.core.config.Settings` 新增字段 `knowledge_search_server_build: bool = True`（env `KNOWLEDGE_SEARCH_SERVER_BUILD`）——默认值下行为零变化。
- `search_sync(..., *, server_build: bool = True, ...)` 新增 keyword-only 参数（默认 True，既有调用方零改动兼容）。
- `POST /api/workspaces/{id}/knowledge/search` 出参契约零变化：复用 `model_ready/reason` 字段；`reason` 词表新增一个值 `"index_not_built"`（表示索引未建且服务器禁建库，results 为纯词面内存直查结果）。
- 行为矩阵：开关 True=现状（懒建库全量/差量）；开关 False+无 state 行=词面内存降级（零建库零嵌入零写库）；开关 False+有 state 行=跳过 sync 直接查库（查询向量嵌入保留）。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

   不适用——单请求内顺序编排（指纹→分支→查询），无跨请求事件流；外部机器预建与本服务器查询的「乱序」表现为指纹过期，显式裁决为「跳过 sync 服务存量行」（见风险③）。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

   开关关闭路径只读（SELECT state + SELECT chunks，零写库），与外部机器预建写入天然无竞争；开关默认路径沿用既有 per-workspace single-flight 锁不动。同一 ws 开关翻转瞬间无中间态（per-request 读 settings，下次请求即生效）。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

   开关翻转无持久状态迁移（不写 state 行、不清 chunks）——关→开时懒同步按指纹判定自然补建；开→关时已建索引原地服务。请求中断（超时取消）在关闭路径只涉及只读查询，无半态。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

   开关是进程级全局（非 per-workspace）——生产单容器一键禁建，本地/开发默认 True 不受影响；多 workspace 共享同一开关语义一致。DB 面经 workspace_id 过滤，无跨工作区串台。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 风险①：默认值写错（如 False）会让所有部署静默失去懒建库。对策：默认 True + FR-02 用例③显式回归「缺省=仍建库」。
- 风险②：`reason="index_not_built"` 语义与 `model_ready=False` 的既有口径（「语义模型不可用」）有细微偏移——此处模型可能可用但索引缺失。裁决：沿用该字段（schema 注释已写「model_ready=False + results 纯词面 + reason 带因」的 fail-soft 语义，reason 词表扩一个值），文档同步说明。
- 风险③：关闭时跳过差量 sync，state 行存在但指纹过期的 ws 会静默服务陈旧索引。这是显式交付边界：禁建库服务器的索引新鲜度职责移交外部预建机器（known-issues 运维解既有口径），服务器端不做部分嵌入（部分嵌入=重新打开容器内嵌入门）。
- 风险④：无索引词面降级每次搜索全语料 scan（文件读放大）。裁决：可接受——仅发生在「未预建的 ws + 禁建库服务器」组合，本就是运维例外态；量级 ~百文件（生产实证 108 md/7 ws），且 DB 异常降级路径已是同款实现先例。
- 放弃方案A：开关关闭时对无索引 ws 返回空结果（不词面降级）——搜索完全不可用，违背「搜索永不 5xx/可查」的既有设计底线，放弃。
- 放弃方案B：per-workspace 建库白名单（哪些 ws 允许容器内建）——配置面与运维模型复杂化（known-issues 口径是「建库一律外部机器」，全局开关即够），放弃。

## 文件变更清单

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | backend/app/core/config.py | Settings 增 knowledge_search_server_build 字段 |
| 修改 | backend/app/modules/knowledge/search.py | search_sync 增 server_build 参数与禁建库分支 |
| 修改 | backend/app/modules/knowledge/router.py | 端点接线 settings.knowledge_search_server_build |
| 修改 | backend/app/modules/knowledge/schema.py | reason 词表注释补 index_not_built |
| 修改 | backend/app/modules/knowledge/tests/test_knowledge_search.py | 禁建库用例组三条 |
| 修改 | .sillyspec/knowledge/known-issues.md | 首搜建库地雷条目状态更新 |
| 修改 | backend/app/modules/translate/translate_worker.py | 跨变更共享 lint 门修复（task-04）：184 行 `resp` 补 `dict[str, object]` 类型标注——他侧变更 2026-10-19-thinking-zh-translate 已提交代码（d792d3de4）的 mypy var-annotated 错误阻断全仓 lint 门（flow done 实测门 fail-closed）；纯标注零运行时影响，等待 3 分钟他侧未自修后按最小修复纳入本变更并全披露；translate 37 测试复跑仍绿 |
