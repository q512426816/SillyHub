---
author: sillyspec-fr-index
created_at: 2026-10-15T11:52:52.897Z
---

# FR 索引 — knowledge

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/knowledge.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-knowledge-001 搜索入口与语料覆盖
变更：2026-10-15-platform-knowledge-search
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1
场景正文：
- 场景：默认场景 — Given 用户打开某工作区知识库页，spec 树含 knowledge/ 与 docs/ 下 md 文档；When 在左栏搜索框输入关键词并停止输入（debounce 300ms）；Then 前端 MUST 请求后端搜索端点，后端 MUST 在 `spec_root/knowledge/**` 与 `spec_root/docs/**`（排除 IND
全文：.sillyspec/changes/archive/2026-10-15-platform-knowledge-search/requirements.md#FR-01
最近确认：7af8e0e32

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-platform-knowledge-search:task-01:acc-0-b1a4ec84
  tests: backend/app/modules/knowledge/tests/test_knowledge_search.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-platform-knowledge-search
  status: active
- row: 2026-10-15-platform-knowledge-search:task-01:acc-1-7e84d0b0
  tests: backend/app/modules/knowledge/tests/test_knowledge_search.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-platform-knowledge-search
  status: active
- row: 2026-10-15-platform-knowledge-search:task-01:acc-2-87827ae0
  tests: backend/app/modules/knowledge/tests/test_knowledge_search.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-platform-knowledge-search
  status: active
- row: 2026-10-15-platform-knowledge-search:task-01:acc-3-6a19bd57
  tests: backend/app/modules/knowledge/tests/test_knowledge_search.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-platform-knowledge-search
  status: active
- row: 2026-10-15-platform-knowledge-search:task-01:acc-4-8f77e04b
  tests: backend/app/modules/knowledge/tests/test_knowledge_search.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-platform-knowledge-search
  status: active
- row: 2026-10-15-platform-knowledge-search:task-02:acc-0-e378104c
  tests: backend/app/modules/knowledge/tests/test_router.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-platform-knowledge-search
  status: active
- row: 2026-10-15-platform-knowledge-search:task-02:acc-1-3fe5f05a
  tests: backend/app/modules/knowledge/tests/test_router.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-platform-knowledge-search
  status: active
- row: 2026-10-15-platform-knowledge-search:task-02:acc-2-ca7813ba
  tests: backend/app/modules/knowledge/tests/test_router.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-platform-knowledge-search
  status: active
- row: 2026-10-15-platform-knowledge-search:task-02:acc-3-89ce4522
  tests: backend/app/modules/knowledge/tests/test_router.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-platform-knowledge-search
  status: active
- row: 2026-10-15-platform-knowledge-search:task-02:acc-4-cee84c26
  tests: backend/app/modules/knowledge/tests/test_router.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-platform-knowledge-search
  status: active
- row: 2026-10-15-platform-knowledge-search:task-05:acc-0-b240150f
  tests: backend/app/modules/agent/tests/test_group_chat_models.py | backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_files_router.py | backend/app/modules/change/tests/test_session_changes_endpoint.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_timeline.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/change/tests/test_usage_stats.py | backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_attachment_pipeline.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_attachment_gate.py | backend/app/modules/daemon/tests/test_group_bridge_projection.py | backend/app/modules/daemon/tests/test_group_cross_mention.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_group_mention_pipeline.py | backend/app/modules/daemon/tests/test_group_p2.py | backend/app/modules/daemon/tests/test_inject_origin_guard.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-platform-knowledge-search
  status: active
- row: 2026-10-15-platform-knowledge-search:task-05:acc-1-7bd4601a
  tests: backend/app/modules/agent/tests/test_group_chat_models.py | backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_files_router.py | backend/app/modules/change/tests/test_session_changes_endpoint.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_timeline.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/change/tests/test_usage_stats.py | backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_attachment_pipeline.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_attachment_gate.py | backend/app/modules/daemon/tests/test_group_bridge_projection.py | backend/app/modules/daemon/tests/test_group_cross_mention.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_group_mention_pipeline.py | backend/app/modules/daemon/tests/test_group_p2.py | backend/app/modules/daemon/tests/test_inject_origin_guard.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-platform-knowledge-search
  status: active
- row: 2026-10-15-platform-knowledge-search:task-05:acc-2-0766cb33
  tests: backend/app/modules/agent/tests/test_group_chat_models.py | backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_files_router.py | backend/app/modules/change/tests/test_session_changes_endpoint.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_timeline.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/change/tests/test_usage_stats.py | backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_attachment_pipeline.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_attachment_gate.py | backend/app/modules/daemon/tests/test_group_bridge_projection.py | backend/app/modules/daemon/tests/test_group_cross_mention.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_group_mention_pipeline.py | backend/app/modules/daemon/tests/test_group_p2.py | backend/app/modules/daemon/tests/test_inject_origin_guard.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-platform-knowledge-search
  status: active
- row: 2026-10-15-platform-knowledge-search:task-05:acc-3-f0d2b91f
  tests: backend/app/modules/agent/tests/test_group_chat_models.py | backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_files_router.py | backend/app/modules/change/tests/test_session_changes_endpoint.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_timeline.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/change/tests/test_usage_stats.py | backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_attachment_pipeline.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_attachment_gate.py | backend/app/modules/daemon/tests/test_group_bridge_projection.py | backend/app/modules/daemon/tests/test_group_cross_mention.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_group_mention_pipeline.py | backend/app/modules/daemon/tests/test_group_p2.py | backend/app/modules/daemon/tests/test_inject_origin_guard.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-platform-knowledge-search
  status: active

## FR-knowledge-002 结果形态与片段高亮
变更：2026-10-15-platform-knowledge-search
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 检索返回非空结果；When 渲染结果列表（替换文件树视图）；Then 每条 MUST 含：来源徽章（决策/需求/知识/模块文档等，由 kind 派生）、标题（条目标题或标题块）、`spec_path`、匹配上下文片段（词面命中位置
全文：.sillyspec/changes/archive/2026-10-15-platform-knowledge-search/requirements.md#FR-02
最近确认：7af8e0e32

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-platform-knowledge-search:task-03:acc-0-c9c34300
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-platform-knowledge-search
  status: active
- row: 2026-10-15-platform-knowledge-search:task-03:acc-1-ec6f3614
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-platform-knowledge-search
  status: active
- row: 2026-10-15-platform-knowledge-search:task-03:acc-2-da2eb275
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-platform-knowledge-search
  status: active
- row: 2026-10-15-platform-knowledge-search:task-03:acc-3-0623ca7b
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-platform-knowledge-search
  status: active
- row: 2026-10-15-platform-knowledge-search:task-03:acc-4-3abafdb0
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-platform-knowledge-search
  status: active

## FR-knowledge-003 双路召回与语义降级
变更：2026-10-15-platform-knowledge-search
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 搜索请求到达后端；When 语义 embedder 可用 embedder 不可用（fastembed 缺席/模型加载失败）；Then 结果 MUST 为词面匹配与向量语义召回的融合排序（`0.6*向量 + 0.4*词面`），且精确编号/文件名命中（title/path 词面命中）经保底 0.9
全文：.sillyspec/changes/archive/2026-10-15-platform-knowledge-search/requirements.md#FR-03
最近确认：7af8e0e32

## FR-knowledge-004 搜索结果的权限边界（按权限过滤语料）
变更：2026-10-15-platform-knowledge-search
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 调用者持 `knowledge:read` 调用者无 `knowledge:read`；When 调用搜索端点且调用者无 `scan-docs:read`
全文：.sillyspec/changes/archive/2026-10-15-platform-knowledge-search/requirements.md#FR-04
最近确认：7af8e0e32

## FR-knowledge-005 结果跳转
变更：2026-10-15-platform-knowledge-search
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 搜索结果列表已渲染；When 点击 `spec_path` 以 `knowledge/` 开头的结果 点击 `spec_path` 以 `docs/` 开头的结果；Then 右栏 MUST 就地加载该文件并滚动定位到条目锚点——经既有 `?file=&anchor=` URL 深链通路（`router.push` 更新 URL，可分
全文：.sillyspec/changes/archive/2026-10-15-platform-knowledge-search/requirements.md#FR-05
最近确认：7af8e0e32

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-platform-knowledge-search:task-04:acc-0-c04eb98a
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-platform-knowledge-search
  status: active
- row: 2026-10-15-platform-knowledge-search:task-04:acc-1-6330b041
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-platform-knowledge-search
  status: active
- row: 2026-10-15-platform-knowledge-search:task-04:acc-2-93293333
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-platform-knowledge-search
  status: active
- row: 2026-10-15-platform-knowledge-search:task-04:acc-3-cc18cc50
  tests: frontend/src/app/(dashboard)/workspaces/[id]/__tests__/scan-docs-page.test.tsx
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 7af8e0e32720f2cdad8183f10b8853ba08ac70ab
  source_change: 2026-10-15-platform-knowledge-search
  status: active

## FR-knowledge-006 索引自愈
变更：2026-10-15-platform-knowledge-search
状态：active
摘要：默认场景
依据决策：D-007@v1、D-010@v1
场景正文：
- 场景：默认场景 — Given 索引已构建且 spec 语料文件发生增/删/改；When 下一次搜索请求到达；Then 文件集指纹（path/mtime_ns/size）比对失配时索引 MUST 自动重建，MUST NOT 要求重启进程；进程重启后首次查询 MUST 按需重建（缓
全文：.sillyspec/changes/archive/2026-10-15-platform-knowledge-search/requirements.md#FR-06
最近确认：7af8e0e32

## FR-knowledge-007 向量持久化与重启零重建
变更：2026-10-15-knowledge-search-pgvector
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given 知识搜索已建库（chunks/state 表有该 workspace 数据）；When 服务重启后用户首次搜索；Then 结果 MUST 秒级返回（不再全量重嵌入）；向量与 chunk 元数据 MUST 持久化在 PG pgvector 表（embedding vector(512
全文：.sillyspec/changes/archive/2026-10-15-knowledge-search-pgvector/requirements.md#FR-01
最近确认：898bb901c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-knowledge-search-pgvector:task-01:acc-0-7d72b71b
  tests: backend/app/modules/knowledge/tests/test_knowledge_search.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 07355c2a0105569903b451450ab23b12174b02e1
  source_change: 2026-10-15-knowledge-search-pgvector
  status: active
- row: 2026-10-15-knowledge-search-pgvector:task-01:acc-1-32f76d08
  tests: backend/app/modules/knowledge/tests/test_knowledge_search.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-knowledge-search-pgvector
  status: active
- row: 2026-10-15-knowledge-search-pgvector:task-01:acc-2-18b956f0
  tests: backend/app/modules/knowledge/tests/test_knowledge_search.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 07355c2a0105569903b451450ab23b12174b02e1
  source_change: 2026-10-15-knowledge-search-pgvector
  status: active
- row: 2026-10-15-knowledge-search-pgvector:task-02:acc-0-bb728faf
  tests: backend/app/modules/knowledge/tests/test_knowledge_search.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 07355c2a0105569903b451450ab23b12174b02e1
  source_change: 2026-10-15-knowledge-search-pgvector
  status: active
- row: 2026-10-15-knowledge-search-pgvector:task-02:acc-1-5e299d25
  tests: backend/app/modules/knowledge/tests/test_knowledge_search.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 07355c2a0105569903b451450ab23b12174b02e1
  source_change: 2026-10-15-knowledge-search-pgvector
  status: active
- row: 2026-10-15-knowledge-search-pgvector:task-02:acc-2-fabde006
  tests: backend/app/modules/knowledge/tests/test_knowledge_search.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-knowledge-search-pgvector
  status: active
- row: 2026-10-15-knowledge-search-pgvector:task-02:acc-3-4eab82a5
  tests: backend/app/modules/knowledge/tests/test_knowledge_search.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 07355c2a0105569903b451450ab23b12174b02e1
  source_change: 2026-10-15-knowledge-search-pgvector
  status: active

## FR-knowledge-008 查询结果与现实现逐字段一致
变更：2026-10-15-knowledge-search-pgvector
状态：active
摘要：默认场景
依据决策：D-004@v1、D-005@v1、D-006@v1
场景正文：
- 场景：默认场景 — Given 相同语料与查询；When 分别用内存实现（升级前）与 DB 实现（升级后）搜索；Then 返回的 results 条目（spec_path/kind/title/anchor/snippet/score）MUST 语义一致（融合 0.6/0.4、an
全文：.sillyspec/changes/archive/2026-10-15-knowledge-search-pgvector/requirements.md#FR-02
最近确认：898bb901c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-knowledge-search-pgvector:task-05:acc-0-745e6b26
  tests: backend/app/modules/agent/tests/test_group_chat_models.py | backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_files_router.py | backend/app/modules/change/tests/test_session_changes_endpoint.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_timeline.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/change/tests/test_usage_stats.py | backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_attachment_pipeline.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_attachment_gate.py | backend/app/modules/daemon/tests/test_group_bridge_projection.py | backend/app/modules/daemon/tests/test_group_cross_mention.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_group_mention_pipeline.py | backend/app/modules/daemon/tests/test_group_p2.py | backend/app/modules/daemon/tests/test_inject_origin_guard.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 07355c2a0105569903b451450ab23b12174b02e1
  source_change: 2026-10-15-knowledge-search-pgvector
  status: active

## FR-knowledge-009 自动增量同步
变更：2026-10-15-knowledge-search-pgvector
状态：active
摘要：默认场景
依据决策：D-003@v1、D-007@v1、D-011@v1
场景正文：
- 场景：默认场景 — Given 库已建且语料文件发生增/删/改；When 下一次搜索请求到达；Then 指纹失配 MUST 触发差量同步（新增插入/变更重嵌/消失删除；mtime 漂移但内容未变 MUST 被 content_hash 层吸收不重嵌）；同步 MUS
全文：.sillyspec/changes/archive/2026-10-15-knowledge-search-pgvector/requirements.md#FR-03
最近确认：898bb901c

## FR-knowledge-010 对外契约零变化
变更：2026-10-15-knowledge-search-pgvector
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 本变更部署后；When 回归上变更全部测试；Then knowledge 模块 199 + 前端 46 MUST 全绿（仅 fake 注入点适配）；openapi.json/api-types MUST 零 dif
全文：.sillyspec/changes/archive/2026-10-15-knowledge-search-pgvector/requirements.md#FR-04
最近确认：898bb901c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-knowledge-search-pgvector:task-03:acc-0-8935abe3
  tests: backend/app/modules/knowledge/tests/test_router.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-15-knowledge-search-pgvector
  status: active

## FR-knowledge-011 部署与降级安全
变更：2026-10-15-knowledge-search-pgvector
状态：active
摘要：默认场景
依据决策：D-008@v1
场景正文：
- 场景：默认场景 — Given 生产环境升级（换镜像 → 迁移 → 重启）；When 迁移在未换镜像的 PG 上执行；Then 迁移 MUST fail-closed（报含修复指引的错误，不留半态表）；升级后搜索 MUST 可用（首查建库一次 304s 级可接受，loading 文案已有
全文：.sillyspec/changes/archive/2026-10-15-knowledge-search-pgvector/requirements.md#FR-05
最近确认：898bb901c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-15-knowledge-search-pgvector:task-04:acc-0-767bc8e9
  tests: backend/app/modules/agent/tests/test_group_chat_models.py | backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_files_router.py | backend/app/modules/change/tests/test_session_changes_endpoint.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_timeline.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/change/tests/test_usage_stats.py | backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_attachment_pipeline.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_attachment_gate.py | backend/app/modules/daemon/tests/test_group_bridge_projection.py | backend/app/modules/daemon/tests/test_group_cross_mention.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_group_mention_pipeline.py | backend/app/modules/daemon/tests/test_group_p2.py | backend/app/modules/daemon/tests/test_inject_origin_guard.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 07355c2a0105569903b451450ab23b12174b02e1
  source_change: 2026-10-15-knowledge-search-pgvector
  status: active

## FR-knowledge-012 zcode 轮次进行中调用 close 时 consume 正常收敛返回（对照 codex _finishTurnOnClose 先例），协程与清理不悬挂
变更：2026-10-16-driver-audit-fixes
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-driver-audit-fixes/requirements.md#FR-01
最近确认：6d2fd757fe62c88c9ddc024cfaa6c90b42e0f077

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-driver-audit-fixes:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts「轮次进行中 close → consume 收敛返回，不上报幽灵 result（旧实现永挂）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-driver-audit-fixes
  status: active

## FR-knowledge-013 zcode stdout 跨 chunk 多字节 UTF-8 有状态解码，中文内容不再产生 U+FFFD
变更：2026-10-16-driver-audit-fixes
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-driver-audit-fixes/requirements.md#FR-02
最近确认：6d2fd757fe62c88c9ddc024cfaa6c90b42e0f077

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-driver-audit-fixes:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts「stdout 跨 chunk 多字节 UTF-8：中文字符不再被切烂成 U+FFFD」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-driver-audit-fixes
  status: active

## FR-knowledge-014 zcode close 阶梯 SIGTERM 到期后无条件升级 SIGKILL（仅以 exitCode 判活）
变更：2026-10-16-driver-audit-fixes
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-driver-audit-fixes/requirements.md#FR-03
最近确认：6d2fd757fe62c88c9ddc024cfaa6c90b42e0f077

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-driver-audit-fixes:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts「close 阶梯：SIGTERM 后到期无条件升级 SIGKILL（killed 置位不再短路）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-driver-audit-fixes
  status: active

## FR-knowledge-015 driver-factory 把 enableApproval/effectiveAskUserOnly 映射为 codex/pi/dsh/zcode 的 manualApproval/askUserOnly，并把 zcode 加入 sessionPermission 注入名单
变更：2026-10-16-driver-audit-fixes
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-driver-audit-fixes/requirements.md#FR-04
最近确认：6d2fd757fe62c88c9ddc024cfaa6c90b42e0f077

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-driver-audit-fixes:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/interactive/driver-factory-approval-wiring.test.ts「审批三态接线（driver-factory → codex 族 driverOpts）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-driver-audit-fixes
  status: active

## FR-knowledge-016 dsh 驱动消费 stderr（诊断可见，管道不再可被子进程写满阻塞）
变更：2026-10-16-driver-audit-fixes
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-driver-audit-fixes/requirements.md#FR-05
最近确认：6d2fd757fe62c88c9ddc024cfaa6c90b42e0f077

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-driver-audit-fixes:flow:测试绑定FR-05
  tests: sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts「引擎 stderr 诊断行进 console.warn（流被消费，管道不再可被子进程写满阻塞）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-driver-audit-fixes
  status: active

## FR-knowledge-017 backend search.py 模块 docstring 与同步注释与当前实现（async 直调、无 DB uq 约束）一致
变更：2026-10-16-driver-audit-fixes
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-driver-audit-fixes/requirements.md#FR-06
最近确认：6d2fd757fe62c88c9ddc024cfaa6c90b42e0f077

## FR-knowledge-018 聚焦测试全绿：daemon zcode/dsh 驱动与接线相关测试 + tsc 零错误；backend test_knowledge_search.py
变更：2026-10-16-driver-audit-fixes
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-16-driver-audit-fixes/requirements.md#FR-07
最近确认：6d2fd757fe62c88c9ddc024cfaa6c90b42e0f077

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-driver-audit-fixes:flow:测试绑定FR-07
  tests: backend/app/modules/knowledge/tests/test_knowledge_search.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-driver-audit-fixes
  status: active

## FR-knowledge-019 嵌入计算子进程封装
变更：2026-10-16-backend-mem-polling
状态：active
摘要：默认场景；三闸自灭；失败 fail-soft；OOM 保护
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given backend 进程运行且知识搜索向量路径被调用；When get_embedder 初始化；Then MUST 返回子进程代理（EmbeddingSubprocessProxy），fastembed 模型 MUST 在独立子进程加载，主进程 MUST NOT 直
- 场景：三闸自灭 — Given 嵌入子进程运行中；When ①闲置满 idle_exit_sec（默认 900s）或 ②stdin 读到 EOF（父进程死亡）或 ③连续运行满 60min；Then 子进程 MUST 退出（进程退出=内存确定性归还 OS）；下次 embed 请求 MUST 重新拉起
- 场景：失败 fail-soft — Given 子进程 spawn 失败或连续崩溃 ≥3 次；Then 语义 MUST 与现状模型缺席一致（model_ready=false + 词面兜底 + reason），且 MUST 退避 10 分钟后重试；MUST NOT
- 场景：OOM 保护 — Given 容器内存告急触发 memcg OOM；Then 主进程 MUST 受 oom_score_adj=-500 保护（compose 服务级设置），嵌入子进程 MUST 在启动时把自身 oom_score_adj
全文：.sillyspec/changes/archive/2026-10-16-backend-mem-polling/requirements.md#FR-01
最近确认：439cdc46c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-backend-mem-polling:task-01:acc-0-b27000a4
  tests: backend/app/modules/knowledge/tests/test_embedding_subprocess.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active
- row: 2026-10-16-backend-mem-polling:task-01:acc-1-7d42fcce
  tests: backend/app/modules/knowledge/tests/test_embedding_subprocess.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active
- row: 2026-10-16-backend-mem-polling:task-01:acc-2-9eb1f314
  tests: backend/app/modules/knowledge/tests/test_embedding_subprocess.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active
- row: 2026-10-16-backend-mem-polling:task-01:acc-3-2d0288d0
  tests: backend/app/modules/knowledge/tests/test_embedding_subprocess.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active

## FR-knowledge-020 向量索引缓存上限
变更：2026-10-16-backend-mem-polling
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given _indexes 进程内缓存持有多个 workspace 索引；When 工作区数超过 KNOWLEDGE_EMBEDDING_INDEX_MAX_WS（默认 4）；Then MUST 按最久未用淘汰（LRU）；MUST NOT 无界增长
全文：.sillyspec/changes/archive/2026-10-16-backend-mem-polling/requirements.md#FR-02
最近确认：439cdc46c

## FR-knowledge-021 spec 包缓存全局帽
变更：2026-10-16-backend-mem-polling
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given _bundle_gzip_cache 跨工作区累积 gzip 整包；When 总字节数超过 SPEC_BUNDLE_CACHE_MAX_BYTES（默认 128MB）；Then MUST 按最久未用淘汰；per-workspace 最新 2 版本保留策略 MUST 保持
全文：.sillyspec/changes/archive/2026-10-16-backend-mem-polling/requirements.md#FR-03
最近确认：439cdc46c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-backend-mem-polling:task-02:acc-0-32092bba
  tests: backend/app/modules/spec_workspace/tests/test_bundle_sync.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active
- row: 2026-10-16-backend-mem-polling:task-02:acc-1-1eda6997
  tests: backend/app/modules/spec_workspace/tests/test_bundle_sync.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active
- row: 2026-10-16-backend-mem-polling:task-02:acc-2-f30b3198
  tests: backend/app/modules/spec_workspace/tests/test_bundle_sync.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active

## FR-knowledge-022 权限定时器会话治理
变更：2026-10-16-backend-mem-polling
状态：active
摘要：默认场景；idle-in-transaction 消除
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 权限请求挂起 5 分钟超时定时器；When _on_timeout 回调执行；Then MUST 经 session_factory() 使用全新短会话，MUST NOT 复用外层已关闭 session；全部路径（含 route_key is No
- 场景：idle-in-transaction 消除 — Given 权限超时回调各路径执行后；Then postgres MUST NOT 出现因该路径产生的 idle in transaction 连接（生产 FATAL 根因消除）
全文：.sillyspec/changes/archive/2026-10-16-backend-mem-polling/requirements.md#FR-04
最近确认：439cdc46c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-backend-mem-polling:task-03:acc-0-06d3d8c8
  tests: backend/app/modules/daemon/tests/test_permission_http_uplink.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active
- row: 2026-10-16-backend-mem-polling:task-03:acc-1-5269ffdd
  tests: backend/app/modules/daemon/tests/test_permission_http_uplink.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active
- row: 2026-10-16-backend-mem-polling:task-03:acc-2-ed795125
  tests: backend/app/modules/daemon/tests/test_permission_http_uplink.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active

## FR-knowledge-023 ws_hub 泄漏修复与身份校验
变更：2026-10-16-backend-mem-polling
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given ws_hub 处理 RPC 与连接生命周期；When ①send_rpc 被外部取消（CancelledError）或 ②resolve_rpc 遇 done future 或 ③disconnect 收到旧连接的；Then ①② MUST 清理 _pending_rpcs 条目；③ MUST 校验连接实例身份（仅当前注册实例可 pop，对齐 _evict_stale 先例）——MU
全文：.sillyspec/changes/archive/2026-10-16-backend-mem-polling/requirements.md#FR-05
最近确认：439cdc46c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-backend-mem-polling:task-04:acc-0-320cfcc2
  tests: backend/app/modules/daemon/tests/test_ws_hub.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active
- row: 2026-10-16-backend-mem-polling:task-04:acc-1-ba0431bc
  tests: backend/app/modules/daemon/tests/test_ws_hub.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active
- row: 2026-10-16-backend-mem-polling:task-04:acc-2-5b1f8df8
  tests: backend/app/modules/daemon/tests/test_ws_hub.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active

## FR-knowledge-024 附件预检与日志截断
变更：2026-10-16-backend-mem-polling
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 附件上传 / WS 大消息日志；When 上传请求到达或超大消息被日志记录；Then 上传 MUST 先读 UploadFile.size 超限 413 再读内容；日志 MUST 截断（超 8KB 只记前后 4KB+总长标注）
全文：.sillyspec/changes/archive/2026-10-16-backend-mem-polling/requirements.md#FR-06
最近确认：439cdc46c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-backend-mem-polling:task-05:acc-0-8894ad4f
  tests: backend/app/modules/session_attachment/tests/test_upload_precheck.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active
- row: 2026-10-16-backend-mem-polling:task-05:acc-1-c52bae84
  tests: backend/app/modules/session_attachment/tests/test_upload_precheck.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active
- row: 2026-10-16-backend-mem-polling:task-05:acc-2-e360469a
  tests: backend/app/modules/session_attachment/tests/test_upload_precheck.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active

## FR-knowledge-025 change-write WS 事件推送
变更：2026-10-16-backend-mem-polling
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given DaemonChangeWrite pending 行落库；When 四个落库点（change/service.py 新建与 match 更新、change_writer/proxy.py、spec_workspace/route；Then backend MUST 经 ws_hub 向该 runtime 所属 daemon 推送 daemon:change_write_available（payl
全文：.sillyspec/changes/archive/2026-10-16-backend-mem-polling/requirements.md#FR-07
最近确认：439cdc46c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-backend-mem-polling:task-06:acc-0-4f0baccb
  tests: backend/app/modules/daemon/tests/test_ws_hub.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active
- row: 2026-10-16-backend-mem-polling:task-06:acc-1-41bf4bc5
  tests: backend/app/modules/daemon/tests/test_ws_hub.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active
- row: 2026-10-16-backend-mem-polling:task-06:acc-2-851a7926
  tests: backend/app/modules/daemon/tests/test_ws_hub.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active
- row: 2026-10-16-backend-mem-polling:task-07:acc-0-2b1b0abf
  tests: sillyhub-daemon/tests/config.test.ts | sillyhub-daemon/tests/protocol-session-contract.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active
- row: 2026-10-16-backend-mem-polling:task-07:acc-1-7baf803e
  tests: sillyhub-daemon/tests/config.test.ts | sillyhub-daemon/tests/protocol-session-contract.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active
- row: 2026-10-16-backend-mem-polling:task-07:acc-2-9c260248
  tests: sillyhub-daemon/tests/config.test.ts | sillyhub-daemon/tests/protocol-session-contract.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active
- row: 2026-10-16-backend-mem-polling:task-07:acc-3-49def444
  tests: sillyhub-daemon/tests/config.test.ts | sillyhub-daemon/tests/protocol-session-contract.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active

## FR-knowledge-026 change-write 兜底轮询独立间隔
变更：2026-10-16-backend-mem-polling
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given daemon _pollLoop 运行；When change-write 分支等待下一轮
全文：.sillyspec/changes/archive/2026-10-16-backend-mem-polling/requirements.md#FR-08
最近确认：439cdc46c

## FR-knowledge-027 会话标题预览持久化
变更：2026-10-16-backend-mem-polling
状态：active
摘要：默认场景；列表读列
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given agent_sessions 表；Then MUST 新增 title_fallback（String(64) nullable）列；迁移 MUST 一次性回填存量（与 session_crud.py:3
- 场景：列表读列 — Given 会话列表请求（limit≤500）；When 组装 title；Then MUST 优先 item.title、次 title_fallback；仅两列皆 NULL 的漏网会话 MUST 收窄查询一次并回写（列或哨兵），之后 MUST
全文：.sillyspec/changes/archive/2026-10-16-backend-mem-polling/requirements.md#FR-09
最近确认：439cdc46c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-backend-mem-polling:task-08:acc-0-4ca0bf93
  tests: backend/app/modules/daemon/tests/test_session_router.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active
- row: 2026-10-16-backend-mem-polling:task-08:acc-1-060436cc
  tests: backend/app/modules/daemon/tests/test_session_router.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active
- row: 2026-10-16-backend-mem-polling:task-08:acc-2-ddaec966
  tests: backend/app/modules/daemon/tests/test_session_router.py
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 9d40341aae3baa9d25dcf9a0cc75c314b48d8708
  source_change: 2026-10-16-backend-mem-polling
  status: active

## FR-knowledge-028 部署配额与保护
变更：2026-10-16-backend-mem-polling
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given deploy/docker-compose.yml；Then mem_limit MUST 重分配（backend 1100m 保持 + oom_score_adj: -500；frontend 300m；minio 12
全文：.sillyspec/changes/archive/2026-10-16-backend-mem-polling/requirements.md#FR-10
最近确认：439cdc46c

## FR-knowledge-029 后端：GET /knowledge 每条目新增 sections 数组（有标记的节：heading+scope+domains；无标记空数组，零标记文件行为与现状一致）；PATCH /knowledge/scope 按 filename+heading 精确定位节内标记做增/改/删（keyword=移除标记），module 档 domains 非空且格式合法（小写域 id），heading 不存在/多义/坏 scope/坏 domain → 422；写入走既有 KnowledgeWriterService.apply_ops 单写者（版本锁+备份），不改其它节内容
变更：2026-10-23-knowledge-scope-maintenance
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-knowledge-scope-maintenance/requirements.md#FR-01
最近确认：80f9dd90355be5253439d049cadcd771baf88c09

## FR-knowledge-030 前端：知识库页面新增作用域筛选（全部/always/repo/module/关键词）与条目/节级徽标；条目卡提供「维护作用域」入口：对话框选择档位（含 module 域输入，逗号分隔）保存后列表刷新，错误可见；页面不回归（既有 zone 分组/搜索/统计面不变）
变更：2026-10-23-knowledge-scope-maintenance
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-knowledge-scope-maintenance/requirements.md#FR-02
最近确认：80f9dd90355be5253439d049cadcd771baf88c09

## FR-knowledge-031 测试：后端 knowledge 模块 pytest 新增用例（sections 解析/scope 增改删/422 矩阵）；前端 vitest 新增用例（筛选与对话框逻辑）；scoped 跑绿
变更：2026-10-23-knowledge-scope-maintenance
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-23-knowledge-scope-maintenance/requirements.md#FR-03
最近确认：80f9dd90355be5253439d049cadcd771baf88c09
