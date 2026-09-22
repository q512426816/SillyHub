---
generated_at: 2026-09-22T17:13:55.575Z
sources_reconcile: 命中（ran_at=2026-09-14T16:48:47.928Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-09-14-session-export

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

（受影响模块集为空——交付/差集文件均未命中任何模块 paths）

未匹配文件（不归属任何模块 paths，人工裁量）：backend/app/modules/daemon/router/__init__.py、backend/app/modules/daemon/router/session_export.py、backend/app/modules/daemon/schema.py、backend/app/modules/daemon/service.py、backend/app/modules/daemon/session/service/__init__.py、backend/app/modules/daemon/session/service/export.py、backend/openapi.json、backend/tests/modules/daemon/test_session_export.py、frontend/src/components/sessions/__tests__/session-list-panel.test.tsx、frontend/src/components/sessions/session-list-panel.tsx、frontend/src/components/sessions/sessions-portal.tsx、frontend/src/lib/api-types.ts、frontend/src/lib/daemon/session-export.ts、.sillyspec/docs/SillyHub/modules/agent.md、.sillyspec/docs/SillyHub/modules/daemon.changelog.md、.sillyspec/docs/SillyHub/modules/frontend_components.changelog.md、backend/app/modules/agent/provider_caps.py、backend/app/modules/agent/tests/test_group_chat_models.py、backend/app/modules/agent/tests/test_provider_caps_alignment.py、backend/app/modules/daemon/router/session_crud.py、backend/app/modules/daemon/session/service/compact.py、backend/app/modules/daemon/tests/test_session_compact_endpoint.py、backend/app/modules/skill_source/git_fetcher.py、backend/app/modules/skill_source/tests/test_library_enable.py、docs/agent-provider-onboarding.md、frontend/src/components/daemon/__tests__/session-panel-platform-shared.test.tsx、frontend/src/components/daemon/__tests__/turn-timeline-auto-recover.test.ts、frontend/src/components/daemon/session-panel/session-panel-page.tsx、frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx、frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx、frontend/src/components/sessions/ctx-usage-bar.tsx、frontend/src/components/sessions/turn-catalog.tsx、frontend/src/lib/daemon/sessions.ts、frontend/src/lib/provider-caps.ts、sillyhub-daemon/scripts/gen-provider-caps.mjs、sillyhub-daemon/src/daemon.ts、sillyhub-daemon/src/interactive/codex-app-server-driver.ts、sillyhub-daemon/src/interactive/driver.ts、sillyhub-daemon/src/interactive/pi-rpc-driver.ts、sillyhub-daemon/src/interactive/providers.ts、sillyhub-daemon/src/interactive/session-manager.ts、sillyhub-daemon/src/interactive/session-manager/compact.ts、sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts、sillyhub-daemon/tests/interactive/cursor-driver.test.ts、sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts、sillyhub-daemon/tests/interactive/provider-registry.test.ts、sillyhub-daemon/tests/interactive/session-compact.test.ts、sillyhub-daemon/tests/provider-adapter-registry.test.ts

### 声明域并集（decisions.md 模块域）

backend、frontend

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| backend/app/modules/daemon/router/__init__.py | —（未匹配） |
| backend/app/modules/daemon/router/session_export.py | —（未匹配） |
| backend/app/modules/daemon/schema.py | —（未匹配） |
| backend/app/modules/daemon/service.py | —（未匹配） |
| backend/app/modules/daemon/session/service/__init__.py | —（未匹配） |
| backend/app/modules/daemon/session/service/export.py | —（未匹配） |
| backend/openapi.json | —（未匹配） |
| backend/tests/modules/daemon/test_session_export.py | —（未匹配） |
| frontend/src/components/sessions/__tests__/session-list-panel.test.tsx | —（未匹配） |
| frontend/src/components/sessions/session-list-panel.tsx | —（未匹配） |
| frontend/src/components/sessions/sessions-portal.tsx | —（未匹配） |
| frontend/src/lib/api-types.ts | —（未匹配） |
| frontend/src/lib/daemon/session-export.ts | —（未匹配） |

- 对账基线：status=undeclared / form=worktree / sources=worktree:diff-base..HEAD、worktree:status-porcelain(uncommitted)
- missing（声明未落盘）：无
- undeclared（落盘未声明，35 项）：.sillyspec/docs/SillyHub/modules/agent.md（疑似归因 task-13）；.sillyspec/docs/SillyHub/modules/daemon.changelog.md；.sillyspec/docs/SillyHub/modules/frontend_components.changelog.md；backend/app/modules/agent/provider_caps.py；backend/app/modules/agent/tests/test_group_chat_models.py；backend/app/modules/agent/tests/test_provider_caps_alignment.py；backend/app/modules/daemon/router/session_crud.py；backend/app/modules/daemon/session/service/compact.py；backend/app/modules/daemon/tests/test_session_compact_endpoint.py；backend/app/modules/skill_source/git_fetcher.py；backend/app/modules/skill_source/tests/test_library_enable.py；docs/agent-provider-onboarding.md；frontend/src/components/daemon/__tests__/session-panel-platform-shared.test.tsx；frontend/src/components/daemon/__tests__/turn-timeline-auto-recover.test.ts；frontend/src/components/daemon/session-panel/session-panel-page.tsx；frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx；frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx；frontend/src/components/sessions/ctx-usage-bar.tsx；frontend/src/components/sessions/turn-catalog.tsx；frontend/src/lib/daemon/sessions.ts；frontend/src/lib/provider-caps.ts；sillyhub-daemon/scripts/gen-provider-caps.mjs；sillyhub-daemon/src/daemon.ts（疑似归因 task-09）；sillyhub-daemon/src/interactive/codex-app-server-driver.ts；sillyhub-daemon/src/interactive/driver.ts；sillyhub-daemon/src/interactive/pi-rpc-driver.ts；sillyhub-daemon/src/interactive/providers.ts；sillyhub-daemon/src/interactive/session-manager.ts（疑似归因 task-01）；sillyhub-daemon/src/interactive/session-manager/compact.ts；sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts；sillyhub-daemon/tests/interactive/cursor-driver.test.ts；sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts；sillyhub-daemon/tests/interactive/provider-registry.test.ts；sillyhub-daemon/tests/interactive/session-compact.test.ts；sillyhub-daemon/tests/provider-adapter-registry.test.ts

### 决策清单（id × 模块域）

| 决策 | 模块域 |
|---|---|
| D-001@v1 | backend、frontend |
| D-002@v1 | backend、frontend |

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-09-14T16:44:30.729Z
- probe1：matches=0 / skippedFiles=0 / worktreeHits=4 / globEntries=0
- probe3：tasks=8 / hasTest=5
- probe5：backendEndpoints=3387 / frontendCalls=2
- probe6：deletions=0 / unavailable=false

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 不增改(skipped):无新模块/新路径形态,daemon 会话子域粒度沿用既有索引粒度;多并行活跃变更共享索引,rebuild 留待统一操作 | skipped |
| `modules/backend.md` | 变更索引追加 session-export（backend 侧）条目（导出端点/权限口径/截断/噪声排除/zip+附件/52 用例/gen:types） | done |
| `modules/frontend.md` | 变更索引追加 session-export（frontend 侧）条目（双入口/单一源 items/可选 prop/下载通道/4 用例零回归） | done |

规则:execute/verify 完成文档同步后把对应行回填 done;确定不同步的行改 skipped 并在操作列写明原因。

### scan 刷新建议

- （受影响模块集为空——无重点刷新面）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：backend/app/modules/daemon/router/__init__.py、backend/app/modules/daemon/router/session_export.py、backend/app/modules/daemon/schema.py、backend/app/modules/daemon/service.py、backend/app/modules/daemon/session/service/__init__.py、backend/app/modules/daemon/session/service/export.py、backend/openapi.json、backend/tests/modules/daemon/test_session_export.py、frontend/src/components/sessions/__tests__/session-list-panel.test.tsx、frontend/src/components/sessions/session-list-panel.tsx、frontend/src/components/sessions/sessions-portal.tsx、frontend/src/lib/api-types.ts、frontend/src/lib/daemon/session-export.ts、.sillyspec/docs/SillyHub/modules/agent.md、.sillyspec/docs/SillyHub/modules/daemon.changelog.md、.sillyspec/docs/SillyHub/modules/frontend_components.changelog.md、backend/app/modules/agent/provider_caps.py、backend/app/modules/agent/tests/test_group_chat_models.py、backend/app/modules/agent/tests/test_provider_caps_alignment.py、backend/app/modules/daemon/router/session_crud.py、backend/app/modules/daemon/session/service/compact.py、backend/app/modules/daemon/tests/test_session_compact_endpoint.py、backend/app/modules/skill_source/git_fetcher.py、backend/app/modules/skill_source/tests/test_library_enable.py、docs/agent-provider-onboarding.md、frontend/src/components/daemon/__tests__/session-panel-platform-shared.test.tsx、frontend/src/components/daemon/__tests__/turn-timeline-auto-recover.test.ts、frontend/src/components/daemon/session-panel/session-panel-page.tsx、frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx、frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx、frontend/src/components/sessions/ctx-usage-bar.tsx、frontend/src/components/sessions/turn-catalog.tsx、frontend/src/lib/daemon/sessions.ts、frontend/src/lib/provider-caps.ts、sillyhub-daemon/scripts/gen-provider-caps.mjs、sillyhub-daemon/src/daemon.ts、sillyhub-daemon/src/interactive/codex-app-server-driver.ts、sillyhub-daemon/src/interactive/driver.ts、sillyhub-daemon/src/interactive/pi-rpc-driver.ts、sillyhub-daemon/src/interactive/providers.ts、sillyhub-daemon/src/interactive/session-manager.ts、sillyhub-daemon/src/interactive/session-manager/compact.ts、sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts、sillyhub-daemon/tests/interactive/cursor-driver.test.ts、sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts、sillyhub-daemon/tests/interactive/provider-registry.test.ts、sillyhub-daemon/tests/interactive/session-compact.test.ts、sillyhub-daemon/tests/provider-adapter-registry.test.ts

### 端点基线提示

- 端点 diff：基线 598 端点 × 现算 617 端点（method+归一 path 集合运算；changed 不配对，天然呈独立行）

| 增删 | method | path | source |
|---|---|---|---|
| + 新增 | GET | /menu-overrides | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\admin\menu_overrides_router.py |
| + 新增 | PUT | /menu-overrides/{menu_key} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\admin\menu_overrides_router.py |
| + 新增 | DELETE | /menu-overrides/{menu_key} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\admin\menu_overrides_router.py |
| + 新增 | POST | /sessions/{session_id}/compact | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
| + 新增 | GET | /sessions/{session_id}/thinking-levels | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
| + 新增 | POST | /sessions/{session_id}/thinking-level | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
| + 新增 | POST | /sessions/export | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_export.py |
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
| + 新增 | GET | /workspaces/{workspace_id}/scan-docs/stats | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\scan_docs\router.py |
| + 新增 | POST | /workspaces/{workspace_id}/move | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\workspace\router.py |
| - 删除 | GET | /workspaces/{workspace_id}/knowledge/{filename} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
