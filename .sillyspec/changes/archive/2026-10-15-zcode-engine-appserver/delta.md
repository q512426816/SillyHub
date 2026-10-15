---
generated_at: 2026-10-15T12:38:14.948Z
sources_reconcile: 命中（ran_at=2026-10-15T10:15:32.987Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-10-15-zcode-engine-appserver

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

| 模块 | status | paths+core_files 条目数 |
|---|---|---|
| backend | active | 1 |
| frontend | active | 1 |
| sillyhub-daemon | active | 1 |
| sillyspec | active | 1 |
| docs | active | 1 |

未匹配文件（不归属任何模块 paths，人工裁量）：backend/app/modules/agent/provider_caps.py、backend/app/modules/daemon/schema.py、backend/openapi.json、frontend/src/lib/api-types.ts、frontend/src/lib/daemon/__tests__/runtimes.test.ts、frontend/src/lib/daemon/runtimes.ts、frontend/src/lib/provider-caps.ts、sillyhub-daemon/src/adapters/zcode-envelope.ts、sillyhub-daemon/src/agent-detector.ts、sillyhub-daemon/src/api-types.ts、sillyhub-daemon/src/interactive/providers.ts、sillyhub-daemon/src/interactive/thinking-levels.ts、sillyhub-daemon/src/interactive/zcode-app-server-driver.ts、sillyhub-daemon/src/interactive/zcode-events.ts、sillyhub-daemon/src/version.ts、sillyhub-daemon/src/zcode-settings.ts、sillyhub-daemon/tests/agent-detector.test.ts、sillyhub-daemon/tests/interactive/provider-registry.test.ts、sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts、sillyhub-daemon/tests/interactive/zcode-e2e.smoke.test.ts、sillyhub-daemon/tests/interactive/zcode-envelope.test.ts、sillyhub-daemon/tests/interactive/zcode-events.test.ts、sillyhub-daemon/tests/version.test.ts、sillyhub-daemon/tests/zcode-settings.test.ts、.sillyspec/docs/SillyHub/modules/daemon.changelog.md、.sillyspec/docs/SillyHub/modules/frontend_app.changelog.md、.sillyspec/docs/SillyHub/modules/frontend_components.changelog.md、.sillyspec/docs/backend/modules/daemon.changelog.md、.sillyspec/docs/frontend/modules/app-admin-pages.md、.sillyspec/docs/frontend/modules/app-workspace-pages.changelog.md、.sillyspec/docs/frontend/modules/app-workspace-pages.md、.sillyspec/docs/frontend/modules/lib-api.changelog.md、.sillyspec/docs/frontend/modules/lib-api.md、.sillyspec/docs/frontend/modules/lib-health.md、.sillyspec/docs/frontend/modules/lib-knowledge.changelog.md、.sillyspec/docs/frontend/modules/lib-knowledge.md、.sillyspec/docs/multi-agent-platform/modules/backend.changelog.md、.sillyspec/docs/multi-agent-platform/modules/backend.md、.sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md、.sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.changelog.md、.sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md、backend/app/modules/agent/model.py、backend/app/modules/agent/schema.py、backend/app/modules/agent/tests/test_group_chat_models.py、backend/app/modules/agent/tests/test_provider_caps_alignment.py、backend/app/modules/daemon/group/service/crud.py、backend/app/modules/daemon/group/service/delegation_notice.py、backend/app/modules/daemon/group/service/helpers.py、backend/app/modules/daemon/group/service/mentions.py、backend/app/modules/daemon/group/service/messages.py、backend/app/modules/daemon/group/service/shadow.py、backend/app/modules/daemon/run_sync/service/group_bridge.py、backend/app/modules/daemon/tests/test_group_attachment_gate.py、backend/app/modules/daemon/tests/test_group_bridge_projection.py、backend/app/modules/daemon/tests/test_group_cross_mention.py、backend/migrations/versions/20261015120000_add_group_cross_mention_mode.py、backend/tests/test_align_platform_change_events_migration.py、docs/releases/2026-10-15-002-b28df6881.md、docs/sillyspec/active-pitfalls.md、docs/sillyspec/finished/stage-review-dir-naming-mismatch.md、docs/sillyspec/verify-incremental-rerun-infra-batch-growth.md、docs/sillyspec/verify-jsx-batch-cmd-too-long.md、docs/sillyspec/verify-lint-triage-path-divergence.md、frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx、frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx、frontend/src/app/m/workspaces/[id]/sessions/page.tsx、frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx、frontend/src/components/changes/detail/change-assets-graph.tsx、frontend/src/components/floating/floating-session-host.test.tsx、frontend/src/components/floating/floating-session-host.tsx、frontend/src/components/group-chat/__tests__/member-panel.test.tsx、frontend/src/components/group-chat/create-group-wizard.tsx、frontend/src/components/group-chat/member-panel.tsx、frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx、frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx、frontend/src/components/sessions/__tests__/session-list-panel.test.tsx、frontend/src/components/sessions/__tests__/sessions-portal.test.tsx、frontend/src/components/sessions/pre-session-picker.tsx、frontend/src/components/sessions/session-list-panel.tsx、frontend/src/components/sessions/sessions-portal.tsx、sillyhub-daemon/scripts/gen-provider-caps.mjs、sillyhub-daemon/src/dsh-settings.ts、sillyhub-daemon/src/interactive/dsh-acp-driver.ts、sillyhub-daemon/src/interactive/dsh-acp-events.ts、sillyhub-daemon/src/interactive/session-manager/driver-factory.ts、sillyhub-daemon/tests/dsh-settings.test.ts、sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts、sillyhub-daemon/tests/interactive/dsh-acp-events.test.ts、sillyhub-daemon/tests/interactive/dsh-acp-smoke.test.ts

### 声明域并集（decisions.md 模块域）

（decisions.md 解析出 8 条当前版本决策，均未填写模块域——声明域为空）

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| backend/app/modules/agent/provider_caps.py | —（未匹配） |
| backend/app/modules/daemon/schema.py | —（未匹配） |
| backend/openapi.json | —（未匹配） |
| frontend/src/lib/api-types.ts | —（未匹配） |
| frontend/src/lib/daemon/__tests__/runtimes.test.ts | —（未匹配） |
| frontend/src/lib/daemon/runtimes.ts | —（未匹配） |
| frontend/src/lib/provider-caps.ts | —（未匹配） |
| sillyhub-daemon/src/adapters/zcode-envelope.ts | —（未匹配） |
| sillyhub-daemon/src/agent-detector.ts | —（未匹配） |
| sillyhub-daemon/src/api-types.ts | —（未匹配） |
| sillyhub-daemon/src/interactive/providers.ts | —（未匹配） |
| sillyhub-daemon/src/interactive/thinking-levels.ts | —（未匹配） |
| sillyhub-daemon/src/interactive/zcode-app-server-driver.ts | —（未匹配） |
| sillyhub-daemon/src/interactive/zcode-events.ts | —（未匹配） |
| sillyhub-daemon/src/version.ts | —（未匹配） |
| sillyhub-daemon/src/zcode-settings.ts | —（未匹配） |
| sillyhub-daemon/tests/agent-detector.test.ts | —（未匹配） |
| sillyhub-daemon/tests/interactive/provider-registry.test.ts | —（未匹配） |
| sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts | —（未匹配） |
| sillyhub-daemon/tests/interactive/zcode-e2e.smoke.test.ts | —（未匹配） |
| sillyhub-daemon/tests/interactive/zcode-envelope.test.ts | —（未匹配） |
| sillyhub-daemon/tests/interactive/zcode-events.test.ts | —（未匹配） |
| sillyhub-daemon/tests/version.test.ts | —（未匹配） |
| sillyhub-daemon/tests/zcode-settings.test.ts | —（未匹配） |

- 对账基线：status=undeclared / form=worktree / sources=worktree:diff-base..HEAD、worktree:status-porcelain(uncommitted)
- missing（声明未落盘）：无
- undeclared（落盘未声明，65 项）：.sillyspec/docs/SillyHub/modules/daemon.changelog.md；.sillyspec/docs/SillyHub/modules/frontend_app.changelog.md；.sillyspec/docs/SillyHub/modules/frontend_components.changelog.md；.sillyspec/docs/backend/modules/daemon.changelog.md；.sillyspec/docs/frontend/modules/app-admin-pages.md；.sillyspec/docs/frontend/modules/app-workspace-pages.changelog.md；.sillyspec/docs/frontend/modules/app-workspace-pages.md；.sillyspec/docs/frontend/modules/lib-api.changelog.md；.sillyspec/docs/frontend/modules/lib-api.md；.sillyspec/docs/frontend/modules/lib-health.md；.sillyspec/docs/frontend/modules/lib-knowledge.changelog.md；.sillyspec/docs/frontend/modules/lib-knowledge.md；.sillyspec/docs/multi-agent-platform/modules/backend.changelog.md；.sillyspec/docs/multi-agent-platform/modules/backend.md（疑似归因 task-10、task-13、task-09、task-08）；.sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md；.sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.changelog.md；.sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md（疑似归因 task-13）；backend/app/modules/agent/model.py（疑似归因 task-01、task-02、task-05）；backend/app/modules/agent/schema.py（疑似归因 task-10、task-02）；backend/app/modules/agent/tests/test_group_chat_models.py；backend/app/modules/agent/tests/test_provider_caps_alignment.py（疑似归因 task-05）；backend/app/modules/daemon/group/service/crud.py；backend/app/modules/daemon/group/service/delegation_notice.py；backend/app/modules/daemon/group/service/helpers.py；backend/app/modules/daemon/group/service/mentions.py；backend/app/modules/daemon/group/service/messages.py；backend/app/modules/daemon/group/service/shadow.py；backend/app/modules/daemon/run_sync/service/group_bridge.py；backend/app/modules/daemon/tests/test_group_attachment_gate.py；backend/app/modules/daemon/tests/test_group_bridge_projection.py；backend/app/modules/daemon/tests/test_group_cross_mention.py；backend/migrations/versions/20261015120000_add_group_cross_mention_mode.py；backend/tests/test_align_platform_change_events_migration.py；docs/releases/2026-10-15-002-b28df6881.md；docs/sillyspec/active-pitfalls.md；docs/sillyspec/finished/stage-review-dir-naming-mismatch.md；docs/sillyspec/verify-incremental-rerun-infra-batch-growth.md；docs/sillyspec/verify-jsx-batch-cmd-too-long.md；docs/sillyspec/verify-lint-triage-path-divergence.md；frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx；frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx；frontend/src/app/m/workspaces/[id]/sessions/page.tsx；frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx；frontend/src/components/changes/detail/change-assets-graph.tsx；frontend/src/components/floating/floating-session-host.test.tsx；frontend/src/components/floating/floating-session-host.tsx；frontend/src/components/group-chat/__tests__/member-panel.test.tsx；frontend/src/components/group-chat/create-group-wizard.tsx；frontend/src/components/group-chat/member-panel.tsx；frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx；frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx（疑似归因 task-05）；frontend/src/components/sessions/__tests__/session-list-panel.test.tsx；frontend/src/components/sessions/__tests__/sessions-portal.test.tsx；frontend/src/components/sessions/pre-session-picker.tsx；frontend/src/components/sessions/session-list-panel.tsx；frontend/src/components/sessions/sessions-portal.tsx；sillyhub-daemon/scripts/gen-provider-caps.mjs；sillyhub-daemon/src/dsh-settings.ts；sillyhub-daemon/src/interactive/dsh-acp-driver.ts；sillyhub-daemon/src/interactive/dsh-acp-events.ts；sillyhub-daemon/src/interactive/session-manager/driver-factory.ts；sillyhub-daemon/tests/dsh-settings.test.ts；sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts；sillyhub-daemon/tests/interactive/dsh-acp-events.test.ts；sillyhub-daemon/tests/interactive/dsh-acp-smoke.test.ts

### 决策清单（id × 模块域）

| 决策 | 模块域 |
|---|---|
| D-001@v1 | （未填写） |
| D-002@v1 | （未填写） |
| D-003@v1 | （未填写） |
| D-004@v1 | （未填写） |
| D-005@v1 | （未填写） |
| D-006@v1 | （未填写） |
| D-007@v1 | （未填写） |
| D-008@v1 | （未填写） |

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-10-15T08:14:19.165Z
- probe1：matches=3 / skippedFiles=0 / worktreeHits=7 / globEntries=0
- probe3：tasks=8 / hasTest=8
- probe5：backendEndpoints=1090 / frontendCalls=6
- probe6：deletions=0 / unavailable=false
- probe8：mispairs=0 / feOnly=0 / missingNotNull=0 / contractCount=0 / contractOrphans=0 / missingRequired=0 / feKeys=0 / backendFields=0
- probe9：javaFileCount=0 / groupCount=0 / inconsistentGroups=0
- probe10：checkedFiles=9 / unclearedFiles=0

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 状态 | 说明 |
|---|---|---|
| `modules/sillyhub-daemon.md` | done | 交互引擎清单/驱动注册面补 zcode 条目（归档语义收尾同步） |
| `modules/backend.md` | done | 交互 provider 枚举白名单补 zcode（归档语义收尾同步） |
| `modules/frontend.md` | done | 单聊引擎白名单单一源补 zcode（归档语义收尾同步） |
| `_module-map.yaml: sillyhub-daemon` | skipped | 新增文件均命中既有模块前缀（adapters/interactive/settings/tests），无需新归类 |
| `_module-map.yaml: backend` | skipped | 同上（daemon/agent 既有前缀） |
| `_module-map.yaml: frontend` | skipped | 同上（lib/daemon、sessions 既有前缀） |

### scan 刷新建议

- `sillyspec scan facts` 下次刷新重点关注：backend、frontend、sillyhub-daemon、sillyspec、docs（共 5 个模块）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：backend/app/modules/agent/provider_caps.py、backend/app/modules/daemon/schema.py、backend/openapi.json、frontend/src/lib/api-types.ts、frontend/src/lib/daemon/__tests__/runtimes.test.ts、frontend/src/lib/daemon/runtimes.ts、frontend/src/lib/provider-caps.ts、sillyhub-daemon/src/adapters/zcode-envelope.ts、sillyhub-daemon/src/agent-detector.ts、sillyhub-daemon/src/api-types.ts、sillyhub-daemon/src/interactive/providers.ts、sillyhub-daemon/src/interactive/thinking-levels.ts、sillyhub-daemon/src/interactive/zcode-app-server-driver.ts、sillyhub-daemon/src/interactive/zcode-events.ts、sillyhub-daemon/src/version.ts、sillyhub-daemon/src/zcode-settings.ts、sillyhub-daemon/tests/agent-detector.test.ts、sillyhub-daemon/tests/interactive/provider-registry.test.ts、sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts、sillyhub-daemon/tests/interactive/zcode-e2e.smoke.test.ts、sillyhub-daemon/tests/interactive/zcode-envelope.test.ts、sillyhub-daemon/tests/interactive/zcode-events.test.ts、sillyhub-daemon/tests/version.test.ts、sillyhub-daemon/tests/zcode-settings.test.ts、.sillyspec/docs/SillyHub/modules/daemon.changelog.md、.sillyspec/docs/SillyHub/modules/frontend_app.changelog.md、.sillyspec/docs/SillyHub/modules/frontend_components.changelog.md、.sillyspec/docs/backend/modules/daemon.changelog.md、.sillyspec/docs/frontend/modules/app-admin-pages.md、.sillyspec/docs/frontend/modules/app-workspace-pages.changelog.md、.sillyspec/docs/frontend/modules/app-workspace-pages.md、.sillyspec/docs/frontend/modules/lib-api.changelog.md、.sillyspec/docs/frontend/modules/lib-api.md、.sillyspec/docs/frontend/modules/lib-health.md、.sillyspec/docs/frontend/modules/lib-knowledge.changelog.md、.sillyspec/docs/frontend/modules/lib-knowledge.md、.sillyspec/docs/multi-agent-platform/modules/backend.changelog.md、.sillyspec/docs/multi-agent-platform/modules/backend.md、.sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md、.sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.changelog.md、.sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md、backend/app/modules/agent/model.py、backend/app/modules/agent/schema.py、backend/app/modules/agent/tests/test_group_chat_models.py、backend/app/modules/agent/tests/test_provider_caps_alignment.py、backend/app/modules/daemon/group/service/crud.py、backend/app/modules/daemon/group/service/delegation_notice.py、backend/app/modules/daemon/group/service/helpers.py、backend/app/modules/daemon/group/service/mentions.py、backend/app/modules/daemon/group/service/messages.py、backend/app/modules/daemon/group/service/shadow.py、backend/app/modules/daemon/run_sync/service/group_bridge.py、backend/app/modules/daemon/tests/test_group_attachment_gate.py、backend/app/modules/daemon/tests/test_group_bridge_projection.py、backend/app/modules/daemon/tests/test_group_cross_mention.py、backend/migrations/versions/20261015120000_add_group_cross_mention_mode.py、backend/tests/test_align_platform_change_events_migration.py、docs/releases/2026-10-15-002-b28df6881.md、docs/sillyspec/active-pitfalls.md、docs/sillyspec/finished/stage-review-dir-naming-mismatch.md、docs/sillyspec/verify-incremental-rerun-infra-batch-growth.md、docs/sillyspec/verify-jsx-batch-cmd-too-long.md、docs/sillyspec/verify-lint-triage-path-divergence.md、frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx、frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx、frontend/src/app/m/workspaces/[id]/sessions/page.tsx、frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx、frontend/src/components/changes/detail/change-assets-graph.tsx、frontend/src/components/floating/floating-session-host.test.tsx、frontend/src/components/floating/floating-session-host.tsx、frontend/src/components/group-chat/__tests__/member-panel.test.tsx、frontend/src/components/group-chat/create-group-wizard.tsx、frontend/src/components/group-chat/member-panel.tsx、frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx、frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx、frontend/src/components/sessions/__tests__/session-list-panel.test.tsx、frontend/src/components/sessions/__tests__/sessions-portal.test.tsx、frontend/src/components/sessions/pre-session-picker.tsx、frontend/src/components/sessions/session-list-panel.tsx、frontend/src/components/sessions/sessions-portal.tsx、sillyhub-daemon/scripts/gen-provider-caps.mjs、sillyhub-daemon/src/dsh-settings.ts、sillyhub-daemon/src/interactive/dsh-acp-driver.ts、sillyhub-daemon/src/interactive/dsh-acp-events.ts、sillyhub-daemon/src/interactive/session-manager/driver-factory.ts、sillyhub-daemon/tests/dsh-settings.test.ts、sillyhub-daemon/tests/interactive/dsh-acp-driver.test.ts、sillyhub-daemon/tests/interactive/dsh-acp-events.test.ts、sillyhub-daemon/tests/interactive/dsh-acp-smoke.test.ts

### 端点基线提示

- 无基线（变更未拍 baseline）：C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\endpoint-baselines\2026-10-15-zcode-engine-appserver.json 不存在或不可解析——端点增删不可比（backendEndpoints=1090（>0））
