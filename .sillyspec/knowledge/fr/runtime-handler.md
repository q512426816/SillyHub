---
author: sillyspec-fr-index
created_at: 2026-10-08T11:44:49.977Z
---

# FR 索引 — runtime-handler

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/runtime-handler.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-runtime-handler-001 图查询五视图端点
变更：2026-10-08-platform-knowledge-graph
状态：active
摘要：默认场景；不可用态六键 reason（D-001@v2）
场景正文：
- 场景：默认场景 — Given 用户已绑定 daemon 且 daemon 可达；When `GET /api/workspaces/{ws}/knowledge/graph/query?sub=<neighbors|path|impact|orpha；Then 返回 HTTP 200 信封 `{available: true, source: "daemon-rpc", data: <按 sub 分型的规范化 DTO>
- 场景：不可用态六键 reason（D-001@v2） — Given 未绑定/离线/超时/旧 CLI·旧 daemon/消毒拒绝/服务异常任一态；When 同端点调用；Then 仍 HTTP 200，`available=false` 且 `reason` 为六稳定键之一（`unbound`→绑定引导 / `offline`·`time
全文：.sillyspec/changes/archive/2026-10-08-platform-knowledge-graph/requirements.md#FR-01
最近确认：537f2ed0e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-platform-knowledge-graph:task-02:acc-0-7058bebc
  tests: backend/app/modules/knowledge/tests/test_graph.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-platform-knowledge-graph
  status: active
- row: 2026-10-08-platform-knowledge-graph:task-02:acc-1-2b68dc2c
  tests: backend/app/modules/knowledge/tests/test_graph.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-platform-knowledge-graph
  status: active
- row: 2026-10-08-platform-knowledge-graph:task-02:acc-2-6ed0d481
  tests: backend/app/modules/knowledge/tests/test_graph.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-platform-knowledge-graph
  status: active
- row: 2026-10-08-platform-knowledge-graph:task-03:acc-0-bcd94a74
  tests: backend/app/modules/knowledge/tests/test_graph.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-platform-knowledge-graph
  status: active
- row: 2026-10-08-platform-knowledge-graph:task-03:acc-1-74f46d51
  tests: backend/app/modules/knowledge/tests/test_graph.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-platform-knowledge-graph
  status: active
- row: 2026-10-08-platform-knowledge-graph:task-05:acc-0-d811601d
  tests: backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_build_claim_payload.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_pending_update_upsert.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_compact_endpoint.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_readiness.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/daemon/tests/test_session_suspend.py | backend/app/modules/daemon/tests/test_worker_redispatch.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_governance.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py | backend/app/modules/platform_sync/tests/test_agent_log_states_push.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | backend/tests/modules/auth/test_permissions.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx | frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/governance-cards.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/mobile/mobile-change-detail.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts | sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts | sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts | sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts | sillyhub-daemon/tests/disk-probe-pending.test.ts | sillyhub-daemon/tests/integration/worker-resume.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-platform-knowledge-graph
  status: active
- row: 2026-10-08-platform-knowledge-graph:task-05:acc-1-7fd369f2
  tests: backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_build_claim_payload.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_pending_update_upsert.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_compact_endpoint.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_readiness.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/daemon/tests/test_session_suspend.py | backend/app/modules/daemon/tests/test_worker_redispatch.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_governance.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py | backend/app/modules/platform_sync/tests/test_agent_log_states_push.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | backend/tests/modules/auth/test_permissions.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx | frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/governance-cards.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/mobile/mobile-change-detail.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts | sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts | sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts | sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts | sillyhub-daemon/tests/disk-probe-pending.test.ts | sillyhub-daemon/tests/integration/worker-resume.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-platform-knowledge-graph
  status: active
- row: 2026-10-08-platform-knowledge-graph:task-10:acc-0-761dbc7d
  tests: backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_build_claim_payload.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_pending_update_upsert.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_compact_endpoint.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_readiness.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/daemon/tests/test_session_suspend.py | backend/app/modules/daemon/tests/test_worker_redispatch.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_governance.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py | backend/app/modules/platform_sync/tests/test_agent_log_states_push.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | backend/tests/modules/auth/test_permissions.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx | frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/governance-cards.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/mobile/mobile-change-detail.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts | sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts | sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts | sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts | sillyhub-daemon/tests/disk-probe-pending.test.ts | sillyhub-daemon/tests/integration/worker-resume.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-platform-knowledge-graph
  status: active
- row: 2026-10-08-platform-knowledge-graph:task-10:acc-1-952ddddb
  tests: backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_build_claim_payload.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_pending_update_upsert.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_compact_endpoint.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_readiness.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/daemon/tests/test_session_suspend.py | backend/app/modules/daemon/tests/test_worker_redispatch.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_governance.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py | backend/app/modules/platform_sync/tests/test_agent_log_states_push.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | backend/tests/modules/auth/test_permissions.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx | frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/governance-cards.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/mobile/mobile-change-detail.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts | sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts | sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts | sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts | sillyhub-daemon/tests/disk-probe-pending.test.ts | sillyhub-daemon/tests/integration/worker-resume.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-platform-knowledge-graph
  status: active

## FR-runtime-handler-002 图概览端点（轻量，含 lite 簇代表）
变更：2026-10-08-platform-knowledge-graph
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 同 FR-01 可用态；When `GET /api/workspaces/{ws}/knowledge/graph/overview`；Then 返回 `data.summary={nodes,edges,byType,byEdge,orphans,module_doc_gaps,changelog_da
全文：.sillyspec/changes/archive/2026-10-08-platform-knowledge-graph/requirements.md#FR-02
最近确认：537f2ed0e

## FR-runtime-handler-003 锚点搜索端点
变更：2026-10-08-platform-knowledge-graph
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 同 FR-01 可用态且 CLI 已含 nodes 子命令；When `GET /api/workspaces/{ws}/knowledge/graph/nodes?search=<模糊>&limit=<1-50>`
全文：.sillyspec/changes/archive/2026-10-08-platform-knowledge-graph/requirements.md#FR-03
最近确认：537f2ed0e

## FR-runtime-handler-004 daemon RPC 白名单与消毒
变更：2026-10-08-platform-knowledge-graph
状态：active
摘要：默认场景；注入尝试
场景正文：
- 场景：默认场景 — Given daemon 收到 `knowledge.graph` RPC；Then 子命令 MUST 在白名单 {summary,nodes,neighbors,path,impact,orphans,dangling}；**anchor/an
- 场景：注入尝试 — Given anchor/anchor2/search 任一含 `; rm -rf`、反引号、`$()`、`"`、换行或控制字符；When RPC 调用；Then sanitize 拒绝并回 validation_rejected（backend 译 reason=invalid_input），MUST NOT 到达 sh
全文：.sillyspec/changes/archive/2026-10-08-platform-knowledge-graph/requirements.md#FR-04
最近确认：537f2ed0e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-platform-knowledge-graph:task-01:acc-0-96b2825c
  tests: sillyhub-daemon/tests/knowledge-governance-handler.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-platform-knowledge-graph
  status: active
- row: 2026-10-08-platform-knowledge-graph:task-01:acc-1-fb183535
  tests: sillyhub-daemon/tests/knowledge-governance-handler.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-platform-knowledge-graph
  status: active
- row: 2026-10-08-platform-knowledge-graph:task-01:acc-2-48326a73
  tests: sillyhub-daemon/tests/knowledge-governance-handler.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-platform-knowledge-graph
  status: active
- row: 2026-10-08-platform-knowledge-graph:task-04:acc-0-6ae10298
  tests: sillyhub-daemon/tests/knowledge-governance-handler.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-platform-knowledge-graph
  status: active
- row: 2026-10-08-platform-knowledge-graph:task-04:acc-1-a9136c32
  tests: sillyhub-daemon/tests/knowledge-governance-handler.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-platform-knowledge-graph
  status: active

## FR-runtime-handler-005 知识图谱页签与页面
变更：2026-10-08-platform-knowledge-graph
状态：active
摘要：默认场景；节点详情与深链
场景正文：
- 场景：默认场景 — Given workspace 顶部页签栏；When 渲染；Then 「知识库」后出现「知识图谱」页签（`/knowledge/graph`），权限复用 knowledge 菜单卡（knowledge:read 可见）；页面三栏（
- 场景：节点详情与深链 — Given 画布中点击节点；Then 选中环+一跳邻域高亮+其余降暗（alpha 0.06-0.1），右栏显示 attrs 与按边型分组的出入邻居（行点击跳选）；entry 类节点提供知识库深链 `
全文：.sillyspec/changes/archive/2026-10-08-platform-knowledge-graph/requirements.md#FR-05
最近确认：537f2ed0e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-platform-knowledge-graph:task-07:acc-0-a9f18b76
  tests: frontend/src/components/knowledge/__tests__/graph-canvas.test.ts | frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-platform-knowledge-graph
  status: active
- row: 2026-10-08-platform-knowledge-graph:task-07:acc-1-579d5cf8
  tests: frontend/src/components/knowledge/__tests__/graph-canvas.test.ts | frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-platform-knowledge-graph
  status: active
- row: 2026-10-08-platform-knowledge-graph:task-07:acc-2-9dd7f53a
  tests: frontend/src/components/knowledge/__tests__/graph-canvas.test.ts | frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-platform-knowledge-graph
  status: active
- row: 2026-10-08-platform-knowledge-graph:task-08:acc-0-8a5cac67
  tests: frontend/src/components/knowledge/__tests__/graph-canvas.test.ts | frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-platform-knowledge-graph
  status: active
- row: 2026-10-08-platform-knowledge-graph:task-08:acc-1-5e152cf1
  tests: frontend/src/components/knowledge/__tests__/graph-canvas.test.ts | frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-platform-knowledge-graph
  status: active
- row: 2026-10-08-platform-knowledge-graph:task-08:acc-2-defd8269
  tests: frontend/src/components/knowledge/__tests__/graph-canvas.test.ts | frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-platform-knowledge-graph
  status: active
- row: 2026-10-08-platform-knowledge-graph:task-09:acc-0-791cc500
  tests: frontend/src/components/knowledge/__tests__/graph-canvas.test.ts | frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-platform-knowledge-graph
  status: active

## FR-runtime-handler-006 画布力场与三主题
变更：2026-10-08-platform-knowledge-graph
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 查询结果切片 ≤200 节点；When 画布渲染
全文：.sillyspec/changes/archive/2026-10-08-platform-knowledge-graph/requirements.md#FR-06
最近确认：537f2ed0e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-platform-knowledge-graph:task-06:acc-0-be92aee5
  tests: backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_build_claim_payload.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_pending_update_upsert.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_compact_endpoint.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_readiness.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/daemon/tests/test_session_suspend.py | backend/app/modules/daemon/tests/test_worker_redispatch.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_governance.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py | backend/app/modules/platform_sync/tests/test_agent_log_states_push.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | backend/tests/modules/auth/test_permissions.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx | frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/governance-cards.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/mobile/mobile-change-detail.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts | sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts | sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts | sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts | sillyhub-daemon/tests/disk-probe-pending.test.ts | sillyhub-daemon/tests/integration/worker-resume.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-platform-knowledge-graph
  status: active
- row: 2026-10-08-platform-knowledge-graph:task-06:acc-1-5b35dc52
  tests: backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_build_claim_payload.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_pending_update_upsert.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_compact_endpoint.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_readiness.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/daemon/tests/test_session_suspend.py | backend/app/modules/daemon/tests/test_worker_redispatch.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_governance.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py | backend/app/modules/platform_sync/tests/test_agent_log_states_push.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | backend/tests/modules/auth/test_permissions.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx | frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/governance-cards.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/mobile/mobile-change-detail.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts | sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts | sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts | sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts | sillyhub-daemon/tests/disk-probe-pending.test.ts | sillyhub-daemon/tests/integration/worker-resume.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-platform-knowledge-graph
  status: active
- row: 2026-10-08-platform-knowledge-graph:task-06:acc-2-e2ca1db5
  tests: backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_build_claim_payload.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_pending_update_upsert.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_compact_endpoint.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_readiness.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/daemon/tests/test_session_suspend.py | backend/app/modules/daemon/tests/test_worker_redispatch.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_governance.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py | backend/app/modules/platform_sync/tests/test_agent_log_states_push.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | backend/tests/modules/auth/test_permissions.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx | frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/governance-cards.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/mobile/mobile-change-detail.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts | sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts | sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts | sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts | sillyhub-daemon/tests/disk-probe-pending.test.ts | sillyhub-daemon/tests/integration/worker-resume.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-platform-knowledge-graph
  status: active

## FR-runtime-handler-007 OpsDashboard 图维度指标卡
变更：2026-10-08-platform-knowledge-graph
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 知识页 OpsDashboard；When overview 可用；Then 指标网格新增「图·孤儿」「图·悬空」卡（text-warning 主数值+点开清单，清单行点击跳图谱页对应查询）；available=false 时卡位显示绑定
全文：.sillyspec/changes/archive/2026-10-08-platform-knowledge-graph/requirements.md#FR-07
最近确认：537f2ed0e

## FR-runtime-handler-008 能力探测降级（跨仓两段独立交付）
变更：2026-10-08-platform-knowledge-graph
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given Phase 0（sillyspec 仓 summary/nodes）未交付或 CLI 未升级；When 平台侧调用 overview/nodes；Then daemon 回 cli_feature_missing:<sub> → summary=None / nodes 信封 unavailable，前端隐藏 li
全文：.sillyspec/changes/archive/2026-10-08-platform-knowledge-graph/requirements.md#FR-08
最近确认：537f2ed0e

## FR-runtime-handler-009 CLI dump 子命令
变更：2026-10-09-knowledge-graph-fullmap
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given specRoot 全图（本仓真图 5812 节点量级）；When `sillyspec knowledge graph dump --layout --json`；Then 输出 `{ok, nodes:[{id,type,label,x,y}], edges:[{s,t,type,strength}], stats}`；坐标 MU
全文：.sillyspec/changes/archive/2026-10-09-knowledge-graph-fullmap/requirements.md#FR-01
最近确认：3a04f370e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-knowledge-graph-fullmap:task-07:acc-0-9ee4d2ad
  tests: backend/app/modules/agent/tests/test_mcp_tools.py | backend/app/modules/agent/tests/test_provider_caps_alignment.py | backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_build_claim_payload.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_pending_update_upsert.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_compact_endpoint.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_readiness.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/daemon/tests/test_session_suspend.py | backend/app/modules/daemon/tests/test_worker_redispatch.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_governance.py | backend/app/modules/knowledge/tests/test_graph.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_agent_blocked_notify.py | backend/app/modules/platform_sync/tests/test_agent_log_states_push.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | backend/tests/modules/auth/test_permissions.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/machine-card-pending.test.tsx | frontend/src/components/daemon/__tests__/session-panel-mobile-detail-guard.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/entry-card-list.test.tsx | frontend/src/components/knowledge/__tests__/governance-cards.test.tsx | frontend/src/components/knowledge/__tests__/graph-canvas.test.ts | frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/mobile/mobile-change-detail.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/hooks/__tests__/use-session-liveness.test.ts | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/knowledge-graph-timeout.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts | sillyhub-daemon/tests/agent-log/liveness/discovery.test.ts | sillyhub-daemon/tests/agent-log/liveness/registry.test.ts | sillyhub-daemon/tests/agent-log/liveness/tailer.test.ts | sillyhub-daemon/tests/daemon-hits-periodic-lifecycle.test.ts | sillyhub-daemon/tests/daemon-selfupdate-orchestrator.test.ts | sillyhub-daemon/tests/disk-probe-pending.test.ts | sillyhub-daemon/tests/integration/worker-resume.test.ts | sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts | sillyhub-daemon/tests/interactive/daemon-notify-session-ready.test.ts | sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts | sillyhub-daemon/tests/knowledge-governance-handler.test.ts | sillyhub-daemon/tests/knowledge-hits-periodic.test.ts | sillyhub-daemon/tests/knowledge-hits-upload.test.ts | sillyhub-daemon/tests/sillyspec-platform-command.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-knowledge-graph-fullmap
  status: active

## FR-runtime-handler-010 daemon dump 白名单
变更：2026-10-09-knowledge-graph-fullmap
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given daemon 收到 knowledge.graph RPC sub=dump；Then 白名单 MUST 放行 dump；layout MUST 为 true（false/缺省回 validation_rejected）；回包 MUST 全量不裁剪
全文：.sillyspec/changes/archive/2026-10-09-knowledge-graph-fullmap/requirements.md#FR-02
最近确认：3a04f370e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-knowledge-graph-fullmap:task-02:acc-0-841e275c
  tests: sillyhub-daemon/tests/knowledge-governance-handler.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-knowledge-graph-fullmap
  status: active

## FR-runtime-handler-011 backend dump 端点与压缩
变更：2026-10-09-knowledge-graph-fullmap
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 可用态；When `GET /api/workspaces/{ws}/knowledge/graph/dump`（KNOWLEDGE_READ，注册在 {filename:pat；Then 信封六键同族，data={nodes,edges,stats}；GZipMiddleware(minimum_size=1024) 全站启用，带 Accept-
全文：.sillyspec/changes/archive/2026-10-09-knowledge-graph-fullmap/requirements.md#FR-03
最近确认：3a04f370e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-knowledge-graph-fullmap:task-03:acc-0-3bb39675
  tests: backend/app/modules/knowledge/tests/test_graph.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-knowledge-graph-fullmap
  status: active
- row: 2026-10-09-knowledge-graph-fullmap:task-04:acc-0-e5e7d02a
  tests: frontend/src/components/knowledge/__tests__/graph-canvas.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-knowledge-graph-fullmap
  status: active

## FR-runtime-handler-012 前端默认全图与下钻
变更：2026-10-09-knowledge-graph-fullmap
状态：active
摘要：默认场景；lite 移除
场景正文：
- 场景：默认场景 — Given 图谱页可用态且 dump 在场 dump 不可用（cli_feature_missing:dump 或旧 daemon）；When 首载；Then 默认加载 dump 并静态渲染全图星空（不启力场；k<0.5 不画边；标签只在大半径类型或 k>1.35）；点任意节点 MUST 切「查询切片」模式并以该节点发
- 场景：lite 移除 — Given 任意态；Then lite 渲染分支与胶囊 MUST 移除；liteClusterLayout 纯函数及其单测保留（无 UI 引用，注释标注保留原因）
全文：.sillyspec/changes/archive/2026-10-09-knowledge-graph-fullmap/requirements.md#FR-04
最近确认：3a04f370e

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-knowledge-graph-fullmap:task-05:acc-0-3be54a60
  tests: frontend/src/components/knowledge/__tests__/graph-canvas.test.ts | frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-knowledge-graph-fullmap
  status: active
- row: 2026-10-09-knowledge-graph-fullmap:task-06:acc-0-7fe20191
  tests: frontend/src/components/knowledge/__tests__/knowledge-graph-page.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-knowledge-graph-fullmap
  status: active

## FR-runtime-handler-013 全图渲染性能
变更：2026-10-09-knowledge-graph-fullmap
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 5812 节点静态全图；When 缩放平移交互；Then 帧渲染 MUST 无力场计算（恒静态）；边绘制按缩放阈值裁剪；交互帧脏标记重绘；肉眼流畅（无逐帧全量重算）
全文：.sillyspec/changes/archive/2026-10-09-knowledge-graph-fullmap/requirements.md#FR-05
最近确认：3a04f370e

## FR-runtime-handler-014 GRAPH_TEXT_BLACKLIST_RE 字符集补反斜杠（\）
变更：2026-10-09-graph-text-backslash
状态：active
摘要：反斜杠锚点被拒
全文：.sillyspec/changes/archive/2026-10-09-graph-text-backslash/requirements.md#FR-01
最近确认：4fa6ce567d22b4d41f5b07583630510edd340a77

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-graph-text-backslash:flow:测试绑定FR-01
  tests: test/sillyhub-daemon/tests/knowledge-governance-handler.test.ts「②b 反斜杠样本全拒（2026-10-09 审查加固：结尾 / 转义闭合引号吞旗标，先红后绿钉住）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-graph-text-backslash
  status: active

## FR-runtime-handler-015 先红后绿用例钉住
变更：2026-10-09-graph-text-backslash
状态：active
摘要：加固可回归检测
全文：.sillyspec/changes/archive/2026-10-09-graph-text-backslash/requirements.md#FR-02
最近确认：4fa6ce567d22b4d41f5b07583630510edd340a77

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-graph-text-backslash:flow:测试绑定FR-02
  tests: test/sillyhub-daemon/tests/knowledge-governance-handler.test.ts「②b（旧黑名单形态下反斜杠样本放行即红——先红实证由字符集 diff 可推）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-graph-text-backslash
  status: active

## FR-runtime-handler-016 既有面零回归
变更：2026-10-09-graph-text-backslash
状态：active
摘要：正常 id 不受影响
全文：.sillyspec/changes/archive/2026-10-09-graph-text-backslash/requirements.md#FR-03
最近确认：4fa6ce567d22b4d41f5b07583630510edd340a77

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-09-graph-text-backslash:flow:测试绑定FR-03
  tests: test/sillyhub-daemon/tests/knowledge-governance-handler.test.ts「①/②/③ 既有用例 + ③ 正常节点 id 样本全放行；26 测绿 + tsc 0（已实测）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-09-graph-text-backslash
  status: active
