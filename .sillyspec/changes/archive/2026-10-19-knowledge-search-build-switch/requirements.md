---
author: flow-machine-draft
created_at: 2026-10-19T05:48:59.930Z
---
# 需求规格（Requirements）— 2026-10-19-knowledge-search-build-switch

## 功能需求

### FR-01: 新增配置开关（默认开启建库=现行为零变化）；关闭时未建索引工作区首搜不触发建库/嵌入，直接词面降级返回且带 reason=index_not_built，秒回不超时

- backend Settings 必须新增 `knowledge_search_server_build: bool`（默认 `True`，env `KNOWLEDGE_SEARCH_SERVER_BUILD`）；默认值下懒建库行为必须与现状逐字节一致（现行为零变化）。
- 开关关闭时，`search_sync` 对无 `knowledge_search_state` 行的工作区必须：跳过全量建库（零 `scan_corpus` 落库、零语料 embed 调用、零 DB 写入）、直接词面内存直查返回结果、`model_ready=False`、`reason="index_not_built"`，禁止触发任何建库/嵌入路径（首搜秒回不超时）。

#### 场景：开关关闭+未建索引工作区首搜

- Given：开关关闭、目标 workspace 无 knowledge_search_state 行、spec 语料含可词面命中的 md。
- When：POST /api/workspaces/{id}/knowledge/search（或直调 search_sync，server_build=False）。
- Then：200 返回纯词面结果（可命中），model_ready=False，reason="index_not_built"，knowledge_search_chunks/state 表零新增行，embedder 零调用。

#### 场景：默认开关（不传/为 True）

- Given：开关缺省（True）、未建索引工作区首搜。
- When：search_sync 不传 server_build。
- Then：行为与现状一致（懒同步全量建库 + 融合检索），embed_calls > 0，state 行落库。

### FR-02: 关闭路径 pytest 单测覆盖（不建库断言+降级语义+reason 字段），指定面全绿

- `backend/app/modules/knowledge/tests/test_knowledge_search.py` 必须新增禁建库用例组，覆盖：① 无索引+关闭 → 不建库断言（chunks/state 零行 + embed_calls==0）+ 词面结果 + reason=index_not_built；② 有索引+关闭 → 跳过 sync 直接查库（语料变更也不触发差量重嵌，embed_calls 不增）；③ 默认值回归（不传参数仍建库）。指定测试面必须全绿。

#### 场景：主路径

- Given：FakeEmbedder（embed_calls 计数）+ search_env fixture（SQLite 测试引擎）。
- When：分别以 server_build=False/缺省跑三条用例。
- Then：断言全过，指定面（knowledge 模块测试）全绿。

### FR-03: known-issues 该条目状态更新为已根治（运维缓解+代码根治双闭环）

- `known-issues.md`「平台知识搜索首搜建库地雷」条目必须更新状态行：标注代码根治已落地（本变更名 + 开关名 + 部署口径=生产容器设 KNOWLEDGE_SEARCH_SERVER_BUILD=0、建库走外部机器预建），🟡 升级口径按实际（开关部署到位后 🟢；代码落地但生产 env 未配前保持 🟡 并写明剩余动作）。

#### 场景：主路径

- Given：FR-01/FR-02 实现合入。
- When：更新 known-issues 条目状态行。
- Then：条目状态与事实一致（代码已根治、部署开关为剩余动作），INDEX 索引无需变化（标题不变）。

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/knowledge/tests/test_knowledge_search.py「禁建库：未建索引工作区首搜词面降级零建库」
FR-02: backend/app/modules/knowledge/tests/test_knowledge_search.py「禁建库：有索引直接查库跳过 sync / 默认缺省仍懒建库」
FR-03: 不适用：知识条目状态更新为文档语义无测试面；验收靠正文与 git diff 对照
