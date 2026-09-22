---
generated_at: 2026-09-22T17:02:27.992Z
sources_reconcile: 命中（ran_at=2026-09-11T12:48:06.895Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-09-11-session-provider-switch-codex-pi

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

（受影响模块集为空——交付/差集文件均未命中任何模块 paths）

未匹配文件（不归属任何模块 paths，人工裁量）：frontend/src/components/daemon/__tests__/session-panel-provider-caps.test.tsx、frontend/src/components/daemon/session-panel/session-panel-page.tsx、frontend/src/components/sessions/__tests__/session-config-bar.test.tsx、frontend/src/components/sessions/session-config-bar.tsx、frontend/src/lib/provider-caps.ts、sillyhub-daemon/src/codex-settings.ts、sillyhub-daemon/src/daemon.ts、sillyhub-daemon/src/provider-file-settings.ts、sillyhub-daemon/src/task-runner.ts、sillyhub-daemon/tests/daemon-provider-file-dispatch.test.ts、sillyhub-daemon/tests/provider-injection-smoke.integ.test.ts、deploy/backend-only.tar.gz、sillyhub-daemon/src/cli.ts、sillyhub-daemon/src/credential-injector.ts、sillyhub-daemon/src/interactive/session-manager.ts、sillyhub-daemon/src/interactive/session-manager/persistence.ts、sillyhub-daemon/src/interactive/types.ts、sillyhub-daemon/tests/cli-session-manager-injection.test.ts、sillyhub-daemon/tests/daemon-provider-config-changed-handler.test.ts、sillyhub-daemon/tests/interactive/session-manager-config-switch.test.ts、sillyhub-daemon/tests/interactive/session-manager-reload-provider.test.ts、sillyhub-daemon/tests/interactive/session-recovery.test.ts、sillyhub-daemon/tests/provider-file-settings-reload.test.ts

### 声明域并集（decisions.md 模块域）

sillyhub-daemon、frontend

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| frontend/src/components/daemon/__tests__/session-panel-provider-caps.test.tsx | —（未匹配） |
| frontend/src/components/daemon/session-panel/session-panel-page.tsx | —（未匹配） |
| frontend/src/components/sessions/__tests__/session-config-bar.test.tsx | —（未匹配） |
| frontend/src/components/sessions/session-config-bar.tsx | —（未匹配） |
| frontend/src/lib/provider-caps.ts | —（未匹配） |
| sillyhub-daemon/src/codex-settings.ts | —（未匹配） |
| sillyhub-daemon/src/daemon.ts | —（未匹配） |
| sillyhub-daemon/src/provider-file-settings.ts | —（未匹配） |
| sillyhub-daemon/src/task-runner.ts | —（未匹配） |
| sillyhub-daemon/tests/daemon-provider-file-dispatch.test.ts | —（未匹配） |
| sillyhub-daemon/tests/provider-injection-smoke.integ.test.ts | —（未匹配） |

- 对账基线：status=undeclared / form=post-apply / sources=main:diff-merge-base、main:status-porcelain(untracked-all)、apply-pathspec
- missing（声明未落盘）：无
- undeclared（落盘未声明，12 项）：deploy/backend-only.tar.gz；sillyhub-daemon/src/cli.ts（疑似归因 task-03）；sillyhub-daemon/src/credential-injector.ts（疑似归因 task-03）；sillyhub-daemon/src/interactive/session-manager.ts（疑似归因 task-03）；sillyhub-daemon/src/interactive/session-manager/persistence.ts（疑似归因 task-04）；sillyhub-daemon/src/interactive/types.ts（疑似归因 task-03）；sillyhub-daemon/tests/cli-session-manager-injection.test.ts（疑似归因 task-06）；sillyhub-daemon/tests/daemon-provider-config-changed-handler.test.ts（疑似归因 task-01）；sillyhub-daemon/tests/interactive/session-manager-config-switch.test.ts（疑似归因 task-06）；sillyhub-daemon/tests/interactive/session-manager-reload-provider.test.ts（疑似归因 task-06）；sillyhub-daemon/tests/interactive/session-recovery.test.ts（疑似归因 task-06）；sillyhub-daemon/tests/provider-file-settings-reload.test.ts（疑似归因 task-06）

### 决策清单（id × 模块域）

| 决策 | 模块域 |
|---|---|
| D-001@v1 | sillyhub-daemon |
| D-002@v1 | frontend |
| D-003@v1 | sillyhub-daemon |

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-09-11T12:34:22.928Z
- probe1：matches=0 / skippedFiles=2 / worktreeHits=0 / globEntries=0
- probe3：tasks=7 / hasTest=6
- probe5：backendEndpoints=2768 / frontendCalls=0
- probe6：deletions=0 / unavailable=false

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 本变更不改模块边界（无新增模块/路径前缀变化）；R-03 口径同步（daemon 模块卡「热切换尽力重写」→「确定性 reload + daemon.ts:7713 幂等预写」）在归档 spec-sync 时更新 daemon 模块卡 | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

### scan 刷新建议

- （受影响模块集为空——无重点刷新面）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：frontend/src/components/daemon/__tests__/session-panel-provider-caps.test.tsx、frontend/src/components/daemon/session-panel/session-panel-page.tsx、frontend/src/components/sessions/__tests__/session-config-bar.test.tsx、frontend/src/components/sessions/session-config-bar.tsx、frontend/src/lib/provider-caps.ts、sillyhub-daemon/src/codex-settings.ts、sillyhub-daemon/src/daemon.ts、sillyhub-daemon/src/provider-file-settings.ts、sillyhub-daemon/src/task-runner.ts、sillyhub-daemon/tests/daemon-provider-file-dispatch.test.ts、sillyhub-daemon/tests/provider-injection-smoke.integ.test.ts、deploy/backend-only.tar.gz、sillyhub-daemon/src/cli.ts、sillyhub-daemon/src/credential-injector.ts、sillyhub-daemon/src/interactive/session-manager.ts、sillyhub-daemon/src/interactive/session-manager/persistence.ts、sillyhub-daemon/src/interactive/types.ts、sillyhub-daemon/tests/cli-session-manager-injection.test.ts、sillyhub-daemon/tests/daemon-provider-config-changed-handler.test.ts、sillyhub-daemon/tests/interactive/session-manager-config-switch.test.ts、sillyhub-daemon/tests/interactive/session-manager-reload-provider.test.ts、sillyhub-daemon/tests/interactive/session-recovery.test.ts、sillyhub-daemon/tests/provider-file-settings-reload.test.ts

### 端点基线提示

- 端点 diff：基线 595 端点 × 现算 617 端点（method+归一 path 集合运算；changed 不配对，天然呈独立行）

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
| + 新增 | GET | /workspaces/{workspace_id}/skills/adoptable | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\workspace\router.py |
| + 新增 | POST | /workspaces/{workspace_id}/skills/adopt | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\workspace\router.py |
| + 新增 | POST | /workspaces/{workspace_id}/mcp/import-from-registry | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\workspace\router.py |
| - 删除 | GET | /workspaces/{workspace_id}/knowledge/{filename} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
