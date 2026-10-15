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
