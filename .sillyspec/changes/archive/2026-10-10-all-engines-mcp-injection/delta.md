---
generated_at: 2026-10-11T07:21:01.104Z
sources_reconcile: 命中（ran_at=2026-10-11T07:07:46.070Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-10-10-all-engines-mcp-injection

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

（受影响模块集为空——交付/差集文件均未命中任何模块 paths）

未匹配文件（不归属任何模块 paths，人工裁量）：backend/app/modules/agent/provider_caps.py、frontend/src/lib/provider-caps.ts、sillyhub-daemon/src/cli.ts、sillyhub-daemon/src/codex-settings.ts、sillyhub-daemon/src/interactive/codex-app-server-driver.ts、sillyhub-daemon/src/interactive/cursor-driver.ts、sillyhub-daemon/src/interactive/pi-rpc-driver.ts、sillyhub-daemon/src/interactive/providers.ts、sillyhub-daemon/src/pi-settings.ts、sillyhub-daemon/tests/codex-settings-mcp.test.ts、sillyhub-daemon/tests/mcp-config.test.ts、sillyhub-daemon/tests/pi-settings-mcp.test.ts、.sillyspec/docs/multi-agent-platform/modules/_module-map.yaml、.sillyspec/docs/multi-agent-platform/modules/backend.md、.sillyspec/docs/multi-agent-platform/modules/frontend.md、.sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md、backend/app/core/auth_deps.py、backend/app/modules/agent/service.py、backend/app/modules/daemon/agent_task_store.py、backend/app/modules/daemon/linked_repos_sync.py、backend/app/modules/daemon/router/session_crud.py、backend/app/modules/daemon/run_sync/service/close_run_steps.py、backend/app/modules/daemon/schema.py、backend/app/modules/daemon/service.py、backend/app/modules/daemon/session/service/__init__.py、backend/app/modules/daemon/session/service/helpers.py、backend/app/modules/daemon/session/service/inject.py、backend/app/modules/daemon/session/service/queue.py、backend/app/modules/daemon/tests/test_agent_session_tasks.py、backend/app/modules/daemon/tests/test_inject_origin_guard.py、backend/app/modules/daemon/tests/test_linked_repos_sync.py、backend/app/modules/daemon/tests/test_session_queue.py、backend/app/modules/daemon/tests/test_session_queue_actions.py、backend/app/modules/workspace/linked_repos/router.py、backend/app/modules/workspace/linked_repos/schema.py、backend/app/modules/workspace/linked_repos/service.py、backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py、backend/openapi.json、backend/tests/test_align_platform_change_events_migration.py、frontend/src/app/(dashboard)/workspaces/[id]/components/page.tsx、frontend/src/app/(dashboard)/workspaces/[id]/components/topology/page.tsx、frontend/src/app/(dashboard)/workspaces/[id]/layout.tsx、frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/page.tsx、frontend/src/components/__tests__/app-shell.test.tsx、frontend/src/components/app-shell.tsx、frontend/src/components/daemon/__tests__/session-panel-mobile-subagent.test.tsx、frontend/src/components/daemon/session-panel/session-panel-page.tsx、frontend/src/components/workspace-config-card.test.tsx、frontend/src/components/workspace-config-card.tsx、frontend/src/components/workspace-tabs.tsx、frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx、frontend/src/components/workspace/linked-repos-card.tsx、frontend/src/components/workspace/stats-row.tsx、frontend/src/hooks/use-page-session-context.test.ts、frontend/src/hooks/use-page-session-context.ts、frontend/src/lib/__tests__/menu-permissions.test.ts、frontend/src/lib/api-types.ts、frontend/src/lib/components.ts、frontend/src/lib/linked-repos.ts、frontend/src/lib/menu-permissions.ts、frontend/src/lib/spec-workspaces.ts、frontend/src/lib/workspaces.ts、sillyhub-daemon/src/borrow-sandbox-context.ts、sillyhub-daemon/src/daemon.ts、sillyhub-daemon/src/hub-client.ts、sillyhub-daemon/src/interactive/session-manager/background-tasks.ts、sillyhub-daemon/src/linked-repos-path.ts、sillyhub-daemon/src/linked-repos-snapshot.ts、sillyhub-daemon/src/linked-repos-sync.ts、sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/borrow-sandbox-context.test.ts、sillyhub-daemon/tests/interactive/session-live-task-ids.test.ts、sillyhub-daemon/tests/linked-repos-snapshot.test.ts、sillyhub-daemon/tests/linked-repos-sync.test.ts、sillyhub-daemon/tests/test_init_lease.test.ts

### 声明域并集（decisions.md 模块域）

sillyhub-daemon、backend、frontend

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| backend/app/modules/agent/provider_caps.py | —（未匹配） |
| frontend/src/lib/provider-caps.ts | —（未匹配） |
| sillyhub-daemon/src/cli.ts | —（未匹配） |
| sillyhub-daemon/src/codex-settings.ts | —（未匹配） |
| sillyhub-daemon/src/interactive/codex-app-server-driver.ts | —（未匹配） |
| sillyhub-daemon/src/interactive/cursor-driver.ts | —（未匹配） |
| sillyhub-daemon/src/interactive/pi-rpc-driver.ts | —（未匹配） |
| sillyhub-daemon/src/interactive/providers.ts | —（未匹配） |
| sillyhub-daemon/src/pi-settings.ts | —（未匹配） |
| sillyhub-daemon/tests/codex-settings-mcp.test.ts | —（未匹配） |
| sillyhub-daemon/tests/mcp-config.test.ts | —（未匹配） |
| sillyhub-daemon/tests/pi-settings-mcp.test.ts | —（未匹配） |

- 对账基线：status=undeclared / form=worktree / sources=worktree:diff-base..HEAD、worktree:status-porcelain(uncommitted)
- missing（声明未落盘）：无
- undeclared（落盘未声明，64 项）：.sillyspec/docs/multi-agent-platform/modules/_module-map.yaml；.sillyspec/docs/multi-agent-platform/modules/backend.md（疑似归因 task-10、task-13、task-09、task-08）；.sillyspec/docs/multi-agent-platform/modules/frontend.md（疑似归因 task-08）；.sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md（疑似归因 task-13）；backend/app/core/auth_deps.py（疑似归因 task-01、task-12）；backend/app/modules/agent/service.py（疑似归因 task-01、task-07、task-08、task-05、task-06、task-10、task-11、task-09）；backend/app/modules/daemon/agent_task_store.py；backend/app/modules/daemon/linked_repos_sync.py；backend/app/modules/daemon/router/session_crud.py；backend/app/modules/daemon/run_sync/service/close_run_steps.py；backend/app/modules/daemon/schema.py（疑似归因 task-03、task-11、task-13、task-05、task-10）；backend/app/modules/daemon/service.py（疑似归因 task-06、task-05、task-07、task-10）；backend/app/modules/daemon/session/service/__init__.py；backend/app/modules/daemon/session/service/helpers.py；backend/app/modules/daemon/session/service/inject.py；backend/app/modules/daemon/session/service/queue.py；backend/app/modules/daemon/tests/test_agent_session_tasks.py；backend/app/modules/daemon/tests/test_inject_origin_guard.py；backend/app/modules/daemon/tests/test_linked_repos_sync.py；backend/app/modules/daemon/tests/test_session_queue.py；backend/app/modules/daemon/tests/test_session_queue_actions.py；backend/app/modules/workspace/linked_repos/router.py；backend/app/modules/workspace/linked_repos/schema.py；backend/app/modules/workspace/linked_repos/service.py；backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py；backend/openapi.json（疑似归因 task-13、task-04、task-05、task-09、task-07、task-03、task-06、task-11、task-08、task-01、task-15、task-02）；backend/tests/test_align_platform_change_events_migration.py；frontend/src/app/(dashboard)/workspaces/[id]/components/page.tsx（疑似归因 task-08）；frontend/src/app/(dashboard)/workspaces/[id]/components/topology/page.tsx；frontend/src/app/(dashboard)/workspaces/[id]/layout.tsx；frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx（疑似归因 task-10、task-11）；frontend/src/app/(dashboard)/workspaces/[id]/page.tsx（疑似归因 task-07、task-08、task-05、task-11、task-12）；frontend/src/components/__tests__/app-shell.test.tsx；frontend/src/components/app-shell.tsx（疑似归因 task-05、task-04、task-07）；frontend/src/components/daemon/__tests__/session-panel-mobile-subagent.test.tsx；frontend/src/components/daemon/session-panel/session-panel-page.tsx；frontend/src/components/workspace-config-card.test.tsx（疑似归因 task-10、task-02、task-05、task-14）；frontend/src/components/workspace-config-card.tsx（疑似归因 task-04、task-05、task-02、task-03、task-09、task-14）；frontend/src/components/workspace-tabs.tsx（疑似归因 task-08、task-04）；frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx；frontend/src/components/workspace/linked-repos-card.tsx；frontend/src/components/workspace/stats-row.tsx；frontend/src/hooks/use-page-session-context.test.ts；frontend/src/hooks/use-page-session-context.ts；frontend/src/lib/__tests__/menu-permissions.test.ts（疑似归因 task-09、task-05、task-02、task-07）；frontend/src/lib/api-types.ts（疑似归因 task-13、task-04、task-05、task-09、task-07、task-03、task-06、task-11、task-01、task-15、task-02）；frontend/src/lib/components.ts；frontend/src/lib/linked-repos.ts；frontend/src/lib/menu-permissions.ts（疑似归因 task-08、task-05、task-02、task-04、task-07）；frontend/src/lib/spec-workspaces.ts（疑似归因 task-01、task-09）；frontend/src/lib/workspaces.ts（疑似归因 task-05、task-06）；sillyhub-daemon/src/borrow-sandbox-context.ts；sillyhub-daemon/src/daemon.ts（疑似归因 task-09、task-16、task-03、task-02、task-08、task-04、task-06、task-05、task-07）；sillyhub-daemon/src/hub-client.ts（疑似归因 task-10、task-01、task-08、task-06、task-04、task-05、task-07）；sillyhub-daemon/src/interactive/session-manager/background-tasks.ts；sillyhub-daemon/src/linked-repos-path.ts；sillyhub-daemon/src/linked-repos-snapshot.ts；sillyhub-daemon/src/linked-repos-sync.ts；sillyhub-daemon/src/spec-sync.ts（疑似归因 task-04、task-05、task-07、task-10、task-01、task-02、task-08、task-12、task-06）；sillyhub-daemon/tests/borrow-sandbox-context.test.ts；sillyhub-daemon/tests/interactive/session-live-task-ids.test.ts；sillyhub-daemon/tests/linked-repos-snapshot.test.ts；sillyhub-daemon/tests/linked-repos-sync.test.ts；sillyhub-daemon/tests/test_init_lease.test.ts（疑似归因 task-05、task-08、task-12）

### 决策清单（id × 模块域）

| 决策 | 模块域 |
|---|---|
| D-001@v1 | sillyhub-daemon |
| D-002@v1 | sillyhub-daemon |
| D-003@v1 | sillyhub-daemon |
| D-004@v1 | sillyhub-daemon |
| D-005@v1 | sillyhub-daemon |
| D-006@v1 | sillyhub-daemon |
| D-007@v1 | sillyhub-daemon、backend、frontend |
| D-008@v1 | （未填写） |
| D-009@v1 | （未填写） |
| D-010@v1 | （未填写） |
| D-011@v1 | sillyhub-daemon |
| D-012@v1 | sillyhub-daemon |
| D-013@v1 | sillyhub-daemon |

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-10-11T07:05:29.749Z
- probe1：matches=3 / skippedFiles=1 / worktreeHits=0 / globEntries=0
- probe3：tasks=9 / hasTest=8
- probe5：backendEndpoints=1074 / frontendCalls=0
- probe6：deletions=3 / unavailable=false
- probe8：mispairs=0 / feOnly=0 / missingNotNull=0 / contractCount=0 / contractOrphans=0 / missingRequired=0 / feKeys=0 / backendFields=0
- probe9：javaFileCount=0 / groupCount=0 / inconsistentGroups=0
- probe10：checkedFiles=10 / unclearedFiles=0

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/cli.md` | archive 阶段同步（2026-10-11）：注意事项补「主控 MCP 引擎门装配」条——isMainAgentSession 委托 isMainAgentMcpCandidate（caps 驱动）、分身谓词不动（D-008）、cli 层只做委托装配 | done |
| `modules/codex-settings.md` | archive 阶段同步（2026-10-11）：定位/契约摘要/关键逻辑/注意事项补 MCP 面——mergeCodexMcpToml + writeCodexMcpServers（[mcp_servers.*] 托管段差量替换）+ CodexMcpServerConfig；config.toml 托管段分工（provider 段归 writeCodexHome / mcp_servers 段归 writeCodexMcpServers）；caps=false 未触达留复评 SOP（D-011） | done |
| `modules/interactive.md` | archive 阶段同步（2026-10-11）：关键逻辑「主 agent MCP」行补引擎门新口径 + 追加「2026-10-10-all-engines-mcp-injection 增量」节——providers.ts 谓词能力化与 PROVIDER_CAPS pi.mcp 翻值、pi-rpc-driver start 消费+版本门控三重降级、codex driver 写盘块（未触达）、cursor 零 diff、写盘调用点纪律（D-012）、五环节端到端证据 | done |
| `modules/pi-settings.md` | archive 阶段同步（2026-10-11）：定位/契约摘要/关键逻辑/注意事项补 MCP 面——writePiMcpConfig + PiMcpServerConfig（mcp.json 覆写语义、空表跳过、pi 1.1.0 形态① golden、调用方 pi-rpc-driver start、版本门控责任在 driver） | done |
| `_module-map.yaml` | archive 阶段同步（2026-10-11）：interactive.paths 补登 pi-rpc-driver.ts/cursor-driver.ts/providers.ts（存量 unmapped 缺口收口，此后 module-impact 前缀匹配可自动命中）+ depends_on 增 pi-settings/codex-settings + main_symbols/aliases 增补；pi-settings/codex-settings 两模块 entrypoints/main_symbols/used_by（+interactive）/tags（+mcp）/notes 增补 MCP 面事实 | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

### scan 刷新建议

- （受影响模块集为空——无重点刷新面）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：backend/app/modules/agent/provider_caps.py、frontend/src/lib/provider-caps.ts、sillyhub-daemon/src/cli.ts、sillyhub-daemon/src/codex-settings.ts、sillyhub-daemon/src/interactive/codex-app-server-driver.ts、sillyhub-daemon/src/interactive/cursor-driver.ts、sillyhub-daemon/src/interactive/pi-rpc-driver.ts、sillyhub-daemon/src/interactive/providers.ts、sillyhub-daemon/src/pi-settings.ts、sillyhub-daemon/tests/codex-settings-mcp.test.ts、sillyhub-daemon/tests/mcp-config.test.ts、sillyhub-daemon/tests/pi-settings-mcp.test.ts、.sillyspec/docs/multi-agent-platform/modules/_module-map.yaml、.sillyspec/docs/multi-agent-platform/modules/backend.md、.sillyspec/docs/multi-agent-platform/modules/frontend.md、.sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md、backend/app/core/auth_deps.py、backend/app/modules/agent/service.py、backend/app/modules/daemon/agent_task_store.py、backend/app/modules/daemon/linked_repos_sync.py、backend/app/modules/daemon/router/session_crud.py、backend/app/modules/daemon/run_sync/service/close_run_steps.py、backend/app/modules/daemon/schema.py、backend/app/modules/daemon/service.py、backend/app/modules/daemon/session/service/__init__.py、backend/app/modules/daemon/session/service/helpers.py、backend/app/modules/daemon/session/service/inject.py、backend/app/modules/daemon/session/service/queue.py、backend/app/modules/daemon/tests/test_agent_session_tasks.py、backend/app/modules/daemon/tests/test_inject_origin_guard.py、backend/app/modules/daemon/tests/test_linked_repos_sync.py、backend/app/modules/daemon/tests/test_session_queue.py、backend/app/modules/daemon/tests/test_session_queue_actions.py、backend/app/modules/workspace/linked_repos/router.py、backend/app/modules/workspace/linked_repos/schema.py、backend/app/modules/workspace/linked_repos/service.py、backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py、backend/openapi.json、backend/tests/test_align_platform_change_events_migration.py、frontend/src/app/(dashboard)/workspaces/[id]/components/page.tsx、frontend/src/app/(dashboard)/workspaces/[id]/components/topology/page.tsx、frontend/src/app/(dashboard)/workspaces/[id]/layout.tsx、frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/page.tsx、frontend/src/components/__tests__/app-shell.test.tsx、frontend/src/components/app-shell.tsx、frontend/src/components/daemon/__tests__/session-panel-mobile-subagent.test.tsx、frontend/src/components/daemon/session-panel/session-panel-page.tsx、frontend/src/components/workspace-config-card.test.tsx、frontend/src/components/workspace-config-card.tsx、frontend/src/components/workspace-tabs.tsx、frontend/src/components/workspace/__tests__/linked-repos-card.test.tsx、frontend/src/components/workspace/linked-repos-card.tsx、frontend/src/components/workspace/stats-row.tsx、frontend/src/hooks/use-page-session-context.test.ts、frontend/src/hooks/use-page-session-context.ts、frontend/src/lib/__tests__/menu-permissions.test.ts、frontend/src/lib/api-types.ts、frontend/src/lib/components.ts、frontend/src/lib/linked-repos.ts、frontend/src/lib/menu-permissions.ts、frontend/src/lib/spec-workspaces.ts、frontend/src/lib/workspaces.ts、sillyhub-daemon/src/borrow-sandbox-context.ts、sillyhub-daemon/src/daemon.ts、sillyhub-daemon/src/hub-client.ts、sillyhub-daemon/src/interactive/session-manager/background-tasks.ts、sillyhub-daemon/src/linked-repos-path.ts、sillyhub-daemon/src/linked-repos-snapshot.ts、sillyhub-daemon/src/linked-repos-sync.ts、sillyhub-daemon/src/spec-sync.ts、sillyhub-daemon/tests/borrow-sandbox-context.test.ts、sillyhub-daemon/tests/interactive/session-live-task-ids.test.ts、sillyhub-daemon/tests/linked-repos-snapshot.test.ts、sillyhub-daemon/tests/linked-repos-sync.test.ts、sillyhub-daemon/tests/test_init_lease.test.ts

### 端点基线提示

- 无基线（变更未拍 baseline）：C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\endpoint-baselines\2026-10-10-all-engines-mcp-injection.json 不存在或不可解析——端点增删不可比（backendEndpoints=1074（>0））
