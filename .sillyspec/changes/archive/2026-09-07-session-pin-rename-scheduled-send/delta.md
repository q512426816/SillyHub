---
generated_at: 2026-09-22T16:35:55.211Z
sources_reconcile: 命中（ran_at=2026-09-07T23:23:37.432Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-09-07-session-pin-rename-scheduled-send

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

（受影响模块集为空——交付/差集文件均未命中任何模块 paths）

未匹配文件（不归属任何模块 paths，人工裁量）：backend/app/main.py、backend/app/modules/agent/model.py、backend/app/modules/agent/tests/test_agent_session_model.py、backend/app/modules/agent/tests/test_mission_session_id.py、backend/app/modules/daemon/router.py、backend/app/modules/daemon/scheduled_send.py、backend/app/modules/daemon/schema.py、backend/app/modules/daemon/service.py、backend/app/modules/daemon/session/service.py、backend/app/modules/daemon/tests/test_scheduled_messages_crud.py、backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py、backend/app/modules/daemon/tests/test_session_pin_rename.py、backend/migrations/versions/20260907231000_add_session_pin_title_scheduled.py、frontend/src/components/daemon/__tests__/scheduled-messages-bar.test.tsx、frontend/src/components/daemon/scheduled-messages-bar.tsx、frontend/src/components/sessions/__tests__/session-list-panel.test.tsx、frontend/src/components/sessions/session-list-panel.tsx、frontend/src/components/sessions/sessions-portal.tsx、frontend/src/hooks/__tests__/use-scheduled-messages.test.ts、frontend/src/hooks/use-scheduled-messages.ts、backend/openapi.json、frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx、frontend/src/components/daemon/session-input-bar.tsx、frontend/src/components/daemon/session-panel.tsx、frontend/src/lib/api-types.ts、frontend/src/lib/daemon.ts

### 声明域并集（decisions.md 模块域）

backend、frontend

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| backend/app/main.py | —（未匹配） |
| backend/app/modules/agent/model.py | —（未匹配） |
| backend/app/modules/agent/tests/test_agent_session_model.py | —（未匹配） |
| backend/app/modules/agent/tests/test_mission_session_id.py | —（未匹配） |
| backend/app/modules/daemon/router.py | —（未匹配） |
| backend/app/modules/daemon/scheduled_send.py | —（未匹配） |
| backend/app/modules/daemon/schema.py | —（未匹配） |
| backend/app/modules/daemon/service.py | —（未匹配） |
| backend/app/modules/daemon/session/service.py | —（未匹配） |
| backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | —（未匹配） |
| backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | —（未匹配） |
| backend/app/modules/daemon/tests/test_session_pin_rename.py | —（未匹配） |
| backend/migrations/versions/20260907231000_add_session_pin_title_scheduled.py | —（未匹配） |
| frontend/src/components/daemon/__tests__/scheduled-messages-bar.test.tsx | —（未匹配） |
| frontend/src/components/daemon/scheduled-messages-bar.tsx | —（未匹配） |
| frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | —（未匹配） |
| frontend/src/components/sessions/session-list-panel.tsx | —（未匹配） |
| frontend/src/components/sessions/sessions-portal.tsx | —（未匹配） |
| frontend/src/hooks/__tests__/use-scheduled-messages.test.ts | —（未匹配） |
| frontend/src/hooks/use-scheduled-messages.ts | —（未匹配） |

- 对账基线：status=undeclared / form=post-apply / sources=main:status-porcelain(untracked-all)、apply-pathspec
- missing（声明未落盘）：无
- undeclared（落盘未声明，6 项）：backend/openapi.json（疑似归因 task-05）；frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx；frontend/src/components/daemon/session-input-bar.tsx（疑似归因 task-08）；frontend/src/components/daemon/session-panel.tsx（疑似归因 task-08）；frontend/src/lib/api-types.ts（疑似归因 task-05）；frontend/src/lib/daemon.ts（疑似归因 task-05）

### 决策清单（id × 模块域）

| 决策 | 模块域 |
|---|---|
| D-001@v1 | backend、frontend |
| D-003@v1 | backend |
| D-002@v1 | backend、frontend |

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-09-07T23:19:11.844Z
- probe1：matches=0 / skippedFiles=1 / worktreeHits=0 / globEntries=0
- probe3：tasks=10 / hasTest=10
- probe5：backendEndpoints=4942 / frontendCalls=0
- probe6：deletions=0 / unavailable=false

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|---|---|---|
| （plan 阶段首版，待 execute 后按实际 diff 复核） | — | — |

### scan 刷新建议

- （受影响模块集为空——无重点刷新面）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：backend/app/main.py、backend/app/modules/agent/model.py、backend/app/modules/agent/tests/test_agent_session_model.py、backend/app/modules/agent/tests/test_mission_session_id.py、backend/app/modules/daemon/router.py、backend/app/modules/daemon/scheduled_send.py、backend/app/modules/daemon/schema.py、backend/app/modules/daemon/service.py、backend/app/modules/daemon/session/service.py、backend/app/modules/daemon/tests/test_scheduled_messages_crud.py、backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py、backend/app/modules/daemon/tests/test_session_pin_rename.py、backend/migrations/versions/20260907231000_add_session_pin_title_scheduled.py、frontend/src/components/daemon/__tests__/scheduled-messages-bar.test.tsx、frontend/src/components/daemon/scheduled-messages-bar.tsx、frontend/src/components/sessions/__tests__/session-list-panel.test.tsx、frontend/src/components/sessions/session-list-panel.tsx、frontend/src/components/sessions/sessions-portal.tsx、frontend/src/hooks/__tests__/use-scheduled-messages.test.ts、frontend/src/hooks/use-scheduled-messages.ts、backend/openapi.json、frontend/src/components/daemon/__tests__/session-panel-dialog.test.tsx、frontend/src/components/daemon/session-input-bar.tsx、frontend/src/components/daemon/session-panel.tsx、frontend/src/lib/api-types.ts、frontend/src/lib/daemon.ts

### 端点基线提示

- 端点 diff：基线 565 端点 × 现算 617 端点（method+归一 path 集合运算；changed 不配对，天然呈独立行）

| 增删 | method | path | source |
|---|---|---|---|
| + 新增 | GET | /menu-overrides | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\admin\menu_overrides_router.py |
| + 新增 | PUT | /menu-overrides/{menu_key} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\admin\menu_overrides_router.py |
| + 新增 | DELETE | /menu-overrides/{menu_key} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\admin\menu_overrides_router.py |
| + 新增 | PATCH | /auth/me/avatar | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\auth\router.py |
| + 新增 | GET | /workspaces/{workspace_id}/sillyspec/file-diff | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\change\router.py |
| + 新增 | GET | /workspaces/{workspace_id}/sillyspec/scope-audit | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\change\router.py |
| + 新增 | POST | /runtimes/{runtime_id}/list-dir | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\daemon_rpc.py |
| + 新增 | POST | /runtimes/{runtime_id}/list-roots | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\daemon_rpc.py |
| + 新增 | GET | /runtimes/{runtime_id}/pending-leases | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\daemon_rpc.py |
| + 新增 | GET | /runtimes/{runtime_id}/pending-controls | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\daemon_rpc.py |
| + 新增 | POST | /runtimes/{runtime_id}/controls/ack | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\daemon_rpc.py |
| + 新增 | GET | /skills/latest/manifest | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\daemon_rpc.py |
| + 新增 | GET | /skills/latest/bundle | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\daemon_rpc.py |
| + 新增 | GET | /skills/{skill_name}/content | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\daemon_rpc.py |
| + 新增 | GET | /mcp/config | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\daemon_rpc.py |
| + 新增 | GET | /llm-proxy/{path:path} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\gateway_misc.py |
| + 新增 | POST | /llm-proxy/{path:path} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\gateway_misc.py |
| + 新增 | POST | /heartbeat | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\heartbeat.py |
| + 新增 | POST | /leases/{lease_id}/claim | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\lease.py |
| + 新增 | POST | /leases/{lease_id}/start | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\lease.py |
| + 新增 | POST | /leases/{lease_id}/heartbeat | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\lease.py |
| + 新增 | POST | /leases/{lease_id}/messages | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\lease.py |
| + 新增 | POST | /leases/{lease_id}/complete | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\lease.py |
| + 新增 | POST | /leases/{lease_id}/sync | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\lease.py |
| + 新增 | POST | /leases/{lease_id}/runs/{run_id}/result | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\lease.py |
| + 新增 | GET | /leases/{lease_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\lease.py |
| + 新增 | GET | /runtimes/{runtime_id}/leases | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\lease.py |
| + 新增 | GET | /machines | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\machines.py |
| + 新增 | PATCH | /machines/{instance_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\machines.py |
| + 新增 | POST | /machines/{instance_id}/self-update | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\machines.py |
| + 新增 | POST | /machines/{instance_id}/cleanup | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\machines.py |
| + 新增 | POST | /machines/{instance_id}/sillyspec-update | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\machines.py |
| + 新增 | POST | /machines/{instance_id}/sillyspec-resolve | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\machines.py |
| + 新增 | POST | /machines/{instance_id}/sillyspec-ghost-cleanup | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\machines.py |
| + 新增 | DELETE | /machines/{instance_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\machines.py |
| + 新增 | GET | /instances | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\machines.py |
| + 新增 | GET | /machines/{instance_id}/sillyspec-conflicts/{change}/compare | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\machines.py |
| + 新增 | POST | /sessions/{session_id}/recover | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\notify.py |
| + 新增 | POST | /sessions/{session_id}/confirm-reconnected | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\notify.py |
| + 新增 | POST | /sessions/{session_id}/mark-recovery-failed | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\notify.py |
| + 新增 | POST | /sessions/suspend-batch | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\notify.py |
| + 新增 | POST | /sessions/{session_id}/ready | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\notify.py |
| + 新增 | POST | /sessions/{session_id}/plan-response | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\notify.py |
| + 新增 | POST | /sessions/{session_id}/plan-mode-entered | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\notify.py |
| + 新增 | POST | /sessions/{session_id}/bash-status | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\notify.py |
| + 新增 | POST | /sessions/{session_id}/bash-chunk | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\notify.py |
| + 新增 | POST | /sessions/{session_id}/agent-task-status | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\notify.py |
| + 新增 | POST | /sessions/{session_id}/permissions/{request_id}/response | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\notify.py |
| + 新增 | POST | /sessions/{session_id}/permission-requests | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\notify.py |
| + 新增 | GET | /sessions/{session_id}/dialogs | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\notify.py |
| + 新增 | GET | /sessions/{session_id}/dialogs/history | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\notify.py |
| + 新增 | GET | /runtimes/usage | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\runtimes.py |
| + 新增 | GET | /runtimes/page | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\runtimes.py |
| + 新增 | PATCH | /runtimes/{runtime_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\runtimes.py |
| + 新增 | PUT | /runtimes/{runtime_id}/allowed-roots | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\runtimes.py |
| + 新增 | POST | /runtimes/{runtime_id}/self-update | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\runtimes.py |
| + 新增 | GET | /runtimes/{runtime_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\runtimes.py |
| + 新增 | POST | /runtimes/{runtime_id}/disable | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\runtimes.py |
| + 新增 | POST | /runtimes/{runtime_id}/enable | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\runtimes.py |
| + 新增 | DELETE | /runtimes/{runtime_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\runtimes.py |
| + 新增 | POST | /runtimes/{runtime_id}/offline | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\runtimes.py |
| + 新增 | GET | /runtimes | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\runtimes.py |
| + 新增 | GET | /sessions | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
| + 新增 | GET | /sessions/events | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
| + 新增 | GET | /sessions/{session_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
| + 新增 | POST | /sessions | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
| + 新增 | POST | /sessions/{session_id}/inject | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
| + 新增 | POST | /sessions/{session_id}/compact | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
| + 新增 | GET | /sessions/{session_id}/thinking-levels | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
| + 新增 | POST | /sessions/{session_id}/thinking-level | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
| + 新增 | POST | /sessions/{session_id}/reopen | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
| + 新增 | POST | /sessions/{session_id}/interrupt | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
| + 新增 | POST | /sessions/{session_id}/end | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
| + 新增 | DELETE | /sessions/{session_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
| + 新增 | PATCH | /sessions/{session_id}/archive | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
| + 新增 | PATCH | /sessions/{session_id}/unarchive | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
| + 新增 | PATCH | /sessions/{session_id}/ctx-window | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
| + 新增 | PATCH | /sessions/{session_id}/auto-resume | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
| + 新增 | PATCH | /sessions/{session_id}/pin | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
| + 新增 | PATCH | /sessions/{session_id}/unpin | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
| + 新增 | PATCH | /sessions/{session_id}/title | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
| + 新增 | POST | /sessions/export | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_export.py |
| + 新增 | GET | /sessions/{session_id}/stream | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_insights.py |
| + 新增 | GET | /sessions/{session_id}/runs | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_insights.py |
| + 新增 | GET | /sessions/{session_id}/tasks | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_insights.py |
| + 新增 | GET | /sessions/{session_id}/logs | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_insights.py |
| + 新增 | GET | /sessions/{session_id}/usage | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_insights.py |
| + 新增 | GET | /sessions/{session_id}/queue | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_queue.py |
| + 新增 | PATCH | /sessions/{session_id}/queue/reorder | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_queue.py |
| + 新增 | DELETE | /sessions/{session_id}/queue/{entry_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_queue.py |
| + 新增 | PATCH | /sessions/{session_id}/queue/{entry_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_queue.py |
| + 新增 | POST | /sessions/{session_id}/queue/{entry_id}/retry | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_queue.py |
| + 新增 | POST | /sessions/{session_id}/queue/{entry_id}/dispatch-now | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_queue.py |
| + 新增 | POST | /sessions/{session_id}/scheduled | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_queue.py |
| + 新增 | GET | /sessions/{session_id}/scheduled | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_queue.py |
| + 新增 | DELETE | /sessions/{session_id}/scheduled/{message_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_queue.py |
| + 新增 | POST | /sessions/{session_id}/team-mission | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_team.py |
| + 新增 | GET | /sessions/{session_id}/team-missions | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_team.py |
| + 新增 | POST | /register | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\version.py |
| + 新增 | POST | /workspaces/{workspace_id}/knowledge/propose | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | PATCH | /workspaces/{workspace_id}/knowledge/entries/{filename:path} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | POST | /workspaces/{workspace_id}/knowledge/proposed/{filename:path}/preview-merge | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | POST | /workspaces/{workspace_id}/knowledge/proposed/{filename:path}/merge | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | POST | /workspaces/{workspace_id}/knowledge/proposed/{filename:path}/reject | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | POST | /workspaces/{workspace_id}/knowledge/distill | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | GET | /workspaces/{workspace_id}/knowledge/distill/tasks | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | GET | /workspaces/{workspace_id}/knowledge/distill/quick-entries | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | POST | /workspaces/{workspace_id}/knowledge/hits/batch | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | GET | /workspaces/{workspace_id}/knowledge/stats | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | GET | /workspaces/{workspace_id}/knowledge/{filename:path} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | POST | /mcp-servers/import-json | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\mcp_registry\router.py |
| + 新增 | POST | /mcp-servers/workspace-scan | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\mcp_registry\router.py |
| + 新增 | POST | /mcp-servers/workspace-import-apply | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\mcp_registry\router.py |
| + 新增 | GET | /mcp-servers/templates | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\mcp_registry\router.py |
| + 新增 | POST | /mcp-servers/templates | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\mcp_registry\router.py |
| + 新增 | GET | /mcp-servers/diagnostics | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\mcp_registry\router.py |
| + 新增 | GET | /mcp-servers | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\mcp_registry\router.py |
| + 新增 | POST | /mcp-servers | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\mcp_registry\router.py |
| + 新增 | GET | /mcp-servers/{server_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\mcp_registry\router.py |
| + 新增 | PATCH | /mcp-servers/{server_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\mcp_registry\router.py |
| + 新增 | DELETE | /mcp-servers/{server_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\mcp_registry\router.py |
| + 新增 | POST | /mcp-servers/{server_id}/bindings | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\mcp_registry\router.py |
| + 新增 | DELETE | /mcp-servers/{server_id}/bindings/{scope_type} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\mcp_registry\router.py |
| + 新增 | DELETE | /mcp-servers/{server_id}/bindings/{scope_type}/{scope_ref} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\mcp_registry\router.py |
| + 新增 | GET | /workspaces/{workspace_id}/scan-docs/stats | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\scan_docs\router.py |
| + 新增 | GET | /skill-sources | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\skill_source\router.py |
| + 新增 | POST | /skill-sources | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\skill_source\router.py |
| + 新增 | PATCH | /skill-sources/{source_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\skill_source\router.py |
| + 新增 | DELETE | /skill-sources/{source_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\skill_source\router.py |
| + 新增 | POST | /skill-sources/{source_id}/refresh | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\skill_source\router.py |
| + 新增 | GET | /skills/library | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\skill_source\router.py |
| + 新增 | POST | /skills/{skill_key}/enable | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\skill_source\router.py |
| + 新增 | DELETE | /skills/{skill_key}/enable | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\skill_source\router.py |
| + 新增 | POST | /workspaces/{workspace_id}/move | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\workspace\router.py |
| + 新增 | GET | /workspaces/{workspace_id}/skills/adoptable | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\workspace\router.py |
| + 新增 | POST | /workspaces/{workspace_id}/skills/adopt | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\workspace\router.py |
| + 新增 | POST | /workspaces/{workspace_id}/mcp/import-from-registry | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\workspace\router.py |
| - 删除 | GET | /daemon/version | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/register | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/heartbeat | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/runtimes/usage | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/runtimes/page | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | PATCH | /daemon/runtimes/{runtime_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | PUT | /daemon/runtimes/{runtime_id}/allowed-roots | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/runtimes/{runtime_id}/self-update | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/machines | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | PATCH | /daemon/machines/{instance_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/machines/{instance_id}/self-update | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/machines/{instance_id}/cleanup | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/machines/{instance_id}/sillyspec-update | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/machines/{instance_id}/sillyspec-resolve | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/machines/{instance_id}/sillyspec-ghost-cleanup | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/machines/{instance_id}/sillyspec-conflicts/{change}/compare | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | DELETE | /daemon/machines/{instance_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/runtimes/{runtime_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/runtimes/{runtime_id}/disable | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/runtimes/{runtime_id}/enable | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | DELETE | /daemon/runtimes/{runtime_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/runtimes/{runtime_id}/offline | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/instances | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/runtimes | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/leases/{lease_id}/claim | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/leases/{lease_id}/start | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/leases/{lease_id}/heartbeat | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/leases/{lease_id}/messages | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/leases/{lease_id}/complete | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/leases/{lease_id}/sync | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/leases/{lease_id}/runs/{run_id}/result | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/sessions/{session_id}/recover | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/sessions/{session_id}/confirm-reconnected | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/sessions/{session_id}/mark-recovery-failed | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/sessions/suspend-batch | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/sessions/{session_id}/ready | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/sessions/{session_id}/plan-response | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/sessions/{session_id}/plan-mode-entered | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/sessions/{session_id}/bash-status | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/sessions/{session_id}/bash-chunk | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/sessions/{session_id}/agent-task-status | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/leases/{lease_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/runtimes/{runtime_id}/leases | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/runtimes/{runtime_id}/list-dir | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/runtimes/{runtime_id}/list-roots | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/sessions/{session_id}/permissions/{request_id}/response | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/sessions/{session_id}/permission-requests | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/sessions/{session_id}/dialogs | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/sessions/{session_id}/dialogs/history | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/sessions | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/sessions/events | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/sessions/{session_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/sessions | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/sessions/{session_id}/inject | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/sessions/{session_id}/queue | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | PATCH | /daemon/sessions/{session_id}/queue/reorder | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | DELETE | /daemon/sessions/{session_id}/queue/{entry_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | PATCH | /daemon/sessions/{session_id}/queue/{entry_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/sessions/{session_id}/queue/{entry_id}/retry | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/sessions/{session_id}/queue/{entry_id}/dispatch-now | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/sessions/{session_id}/reopen | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/sessions/{session_id}/interrupt | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/sessions/{session_id}/end | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | DELETE | /daemon/sessions/{session_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | PATCH | /daemon/sessions/{session_id}/archive | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | PATCH | /daemon/sessions/{session_id}/unarchive | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | PATCH | /daemon/sessions/{session_id}/ctx-window | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/sessions/{session_id}/stream | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/sessions/{session_id}/runs | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/sessions/{session_id}/tasks | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/sessions/{session_id}/logs | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/sessions/{session_id}/usage | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/sessions/{session_id}/team-mission | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/sessions/{session_id}/team-missions | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/llm-proxy/{path:path} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/llm-proxy/{path:path} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/runtimes/{runtime_id}/pending-leases | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/runtimes/{runtime_id}/pending-controls | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | POST | /daemon/runtimes/{runtime_id}/controls/ack | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/skills/latest/manifest | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/skills/latest/bundle | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/skills/{skill_name}/content | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /daemon/mcp/config | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router.py |
| - 删除 | GET | /workspaces/{workspace_id}/knowledge/{filename} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| - 删除 | GET | /platform-settings/mcp | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\settings\router.py |
| - 删除 | PUT | /platform-settings/mcp | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\settings\router.py |
