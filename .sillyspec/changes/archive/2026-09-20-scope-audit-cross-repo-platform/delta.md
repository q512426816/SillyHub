---
generated_at: 2026-10-02T00:59:23.377Z
sources_reconcile: 命中（ran_at=2026-09-20T13:09:44.440Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-09-20-scope-audit-cross-repo-platform

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

（受影响模块集为空——交付/差集文件均未命中任何模块 paths）

未匹配文件（不归属任何模块 paths，人工裁量）：backend/app/modules/change/schema.py、backend/app/modules/change/scope_audit.py、backend/app/modules/change/tests/test_scope_file_diff.py、backend/openapi.json、frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx、frontend/src/components/changes/scope-audit-command-card.tsx、frontend/src/lib/api-types.ts、sillyhub-daemon/src/sillyspec-manager.ts、sillyhub-daemon/tests/sillyspec-file-diff.test.ts

### 声明域并集（decisions.md 模块域）

（decisions.md 解析出 5 条当前版本决策，均未填写模块域——声明域为空）

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| backend/app/modules/change/schema.py | —（未匹配） |
| backend/app/modules/change/scope_audit.py | —（未匹配） |
| backend/app/modules/change/tests/test_scope_file_diff.py | —（未匹配） |
| backend/openapi.json | —（未匹配） |
| frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx | —（未匹配） |
| frontend/src/components/changes/scope-audit-command-card.tsx | —（未匹配） |
| frontend/src/lib/api-types.ts | —（未匹配） |
| sillyhub-daemon/src/sillyspec-manager.ts | —（未匹配） |
| sillyhub-daemon/tests/sillyspec-file-diff.test.ts | —（未匹配） |

- 对账基线：status=ok / form=worktree / sources=worktree:diff-base..HEAD、worktree:status-porcelain(uncommitted)
- missing（声明未落盘）：无
- undeclared（落盘未声明）：无

### 决策清单（id × 模块域）

| 决策 | 模块域 |
|---|---|
| D-001@v1 | （未填写） |
| D-002@v1 | （未填写） |
| D-003@v1 | （未填写） |
| D-005@v1 | （未填写） |
| D-004@v2 | （未填写） |

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-09-20T12:38:24.803Z
- probe1：matches=0 / skippedFiles=0 / worktreeHits=0 / globEntries=0
- probe3：tasks=3 / hasTest=3
- probe5：backendEndpoints=1633 / frontendCalls=0
- probe6：deletions=0 / unavailable=false
- probe8：mispairs=0 / feOnly=0 / missingNotNull=0 / contractCount=0 / contractOrphans=0 / missingRequired=0 / feKeys=0 / backendFields=0
- probe9：javaFileCount=0 / groupCount=0 / inconsistentGroups=0
- probe10：checkedFiles=4 / unclearedFiles=0

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 模块索引覆盖面不足（子项目内部模块未收录，非本变更引入）；是否 rebuild 属全局治理决策，不在本变更内动 | skipped（原因：索引过期为存量债，本变更按子项目 scan 文档口径判定归属；rebuild 建议在归档时另行评估） |

### scan 刷新建议

- （受影响模块集为空——无重点刷新面）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：backend/app/modules/change/schema.py、backend/app/modules/change/scope_audit.py、backend/app/modules/change/tests/test_scope_file_diff.py、backend/openapi.json、frontend/src/components/changes/__tests__/scope-audit-command-card.test.tsx、frontend/src/components/changes/scope-audit-command-card.tsx、frontend/src/lib/api-types.ts、sillyhub-daemon/src/sillyspec-manager.ts、sillyhub-daemon/tests/sillyspec-file-diff.test.ts

### 端点基线提示

- 端点 diff：基线 614 端点 × 现算 631 端点（method+归一 path 集合运算；changed 不配对，天然呈独立行）

| 增删 | method | path | source |
|---|---|---|---|
| + 新增 | GET | /workspaces/{workspace_id}/changes/{change_id}/assets | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\change\router.py |
| + 新增 | GET | /workspaces/{workspace_id}/changes/{change_id}/timeline | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\change\router.py |
| + 新增 | GET | /workspaces/{workspace_id}/changes/{change_id}/assets/patch-file | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\change\router.py |
| + 新增 | POST | /sessions/{session_id}/takeover | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
| + 新增 | POST | /sessions/{session_id}/reset-tool-report | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
| + 新增 | POST | /sessions/{session_id}/fork | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
| + 新增 | GET | /sessions/{session_id}/turn-outline | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_insights.py |
| + 新增 | GET | /sessions/{session_id}/logs/{log_id} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_insights.py |
| + 新增 | POST | /workspaces/{workspace_id}/knowledge/hits/batch | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | GET | /workspaces/{workspace_id}/knowledge/stats | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | GET | /workspaces/{workspace_id}/knowledge/governance | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | POST | /workspaces/{workspace_id}/knowledge/governance/actions | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
| + 新增 | POST | /changes/{name}/events | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\platform_sync\router.py |
| + 新增 | GET | /changes/{name}/events | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\platform_sync\router.py |
| + 新增 | GET | /workspaces/{workspace_id}/scan-docs/stats | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\scan_docs\router.py |
| + 新增 | POST | /spec-workspace/manifest-heal | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\spec_workspace\router.py |
| + 新增 | GET | /spec-workspace/consistency | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\spec_workspace\router.py |
