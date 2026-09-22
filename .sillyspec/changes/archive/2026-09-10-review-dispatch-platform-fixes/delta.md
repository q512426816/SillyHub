---
generated_at: 2026-09-22T16:51:09.810Z
sources_reconcile: 命中（ran_at=2026-09-10T14:53:31.291Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-09-10-review-dispatch-platform-fixes

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

（受影响模块集为空——交付/差集文件均未命中任何模块 paths）

未匹配文件（不归属任何模块 paths，人工裁量）：backend/app/modules/llm_provider/schema.py、backend/app/modules/llm_provider/tests/test_llm_provider_pi_kind.py、backend/app/modules/mcp_gateway/tests/test_tools_new.py、backend/app/modules/mcp_gateway/tools.py、backend/openapi.json、frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx、frontend/src/components/llm-providers/llm-provider-form.tsx、frontend/src/lib/api-types.ts、sillyhub-daemon/src/api-types.ts、sillyhub-daemon/src/credential-injector.ts、sillyhub-daemon/src/daemon.ts、sillyhub-daemon/src/hub-client.ts、sillyhub-daemon/src/interactive/pi-rpc-driver.ts、sillyhub-daemon/tests/credential-injector-pi.test.ts、sillyhub-daemon/tests/credential-injector.test.ts、sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts、sillyhub-daemon/tests/hub-client-worker-done-session.test.ts、sillyhub-daemon/tests/interactive/pi-rpc-driver-turn-result.test.ts、frontend/src/lib/api/llm-providers.ts

### 声明域并集（decisions.md 模块域）

sillyhub-daemon、backend、frontend

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| backend/app/modules/llm_provider/schema.py | —（未匹配） |
| backend/app/modules/llm_provider/tests/test_llm_provider_pi_kind.py | —（未匹配） |
| backend/app/modules/mcp_gateway/tests/test_tools_new.py | —（未匹配） |
| backend/app/modules/mcp_gateway/tools.py | —（未匹配） |
| backend/openapi.json | —（未匹配） |
| frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx | —（未匹配） |
| frontend/src/components/llm-providers/llm-provider-form.tsx | —（未匹配） |
| frontend/src/lib/api-types.ts | —（未匹配） |
| sillyhub-daemon/src/api-types.ts | —（未匹配） |
| sillyhub-daemon/src/credential-injector.ts | —（未匹配） |
| sillyhub-daemon/src/daemon.ts | —（未匹配） |
| sillyhub-daemon/src/hub-client.ts | —（未匹配） |
| sillyhub-daemon/src/interactive/pi-rpc-driver.ts | —（未匹配） |
| sillyhub-daemon/tests/credential-injector-pi.test.ts | —（未匹配） |
| sillyhub-daemon/tests/credential-injector.test.ts | —（未匹配） |
| sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts | —（未匹配） |
| sillyhub-daemon/tests/hub-client-worker-done-session.test.ts | —（未匹配） |
| sillyhub-daemon/tests/interactive/pi-rpc-driver-turn-result.test.ts | —（未匹配） |

- 对账基线：status=undeclared / form=worktree / sources=worktree:diff-base..HEAD、worktree:status-porcelain(uncommitted)
- missing（声明未落盘）：无
- undeclared（落盘未声明，1 项）：frontend/src/lib/api/llm-providers.ts（疑似归因 task-07）

### 决策清单（id × 模块域）

| 决策 | 模块域 |
|---|---|
| D-001@v1 | sillyhub-daemon |
| D-002@v1 | backend、sillyhub-daemon、frontend |
| D-003@v1 | backend |

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-09-10T14:39:37.457Z
- probe1：matches=0 / skippedFiles=5 / worktreeHits=0 / globEntries=0
- probe3：tasks=9 / hasTest=9
- probe5：backendEndpoints=4476 / frontendCalls=5
- probe6：deletions=0 / unavailable=false

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 无需 rebuild：根 map 三模块条目已覆盖本变更全部文件（未匹配为生成期路径解析问题，非索引过期） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

### scan 刷新建议

- （受影响模块集为空——无重点刷新面）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：backend/app/modules/llm_provider/schema.py、backend/app/modules/llm_provider/tests/test_llm_provider_pi_kind.py、backend/app/modules/mcp_gateway/tests/test_tools_new.py、backend/app/modules/mcp_gateway/tools.py、backend/openapi.json、frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx、frontend/src/components/llm-providers/llm-provider-form.tsx、frontend/src/lib/api-types.ts、sillyhub-daemon/src/api-types.ts、sillyhub-daemon/src/credential-injector.ts、sillyhub-daemon/src/daemon.ts、sillyhub-daemon/src/hub-client.ts、sillyhub-daemon/src/interactive/pi-rpc-driver.ts、sillyhub-daemon/tests/credential-injector-pi.test.ts、sillyhub-daemon/tests/credential-injector.test.ts、sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts、sillyhub-daemon/tests/hub-client-worker-done-session.test.ts、sillyhub-daemon/tests/interactive/pi-rpc-driver-turn-result.test.ts、frontend/src/lib/api/llm-providers.ts

### 端点基线提示

- 端点 diff：基线 585 端点 × 现算 617 端点（method+归一 path 集合运算；changed 不配对，天然呈独立行）

| 增删 | method | path | source |
|---|---|---|---|
| + 新增 | GET | /menu-overrides | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\admin\menu_overrides_router.py |
| + 新增 | PUT | /menu-overrides/{menu_key} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\admin\menu_overrides_router.py |
| + 新增 | DELETE | /menu-overrides/{menu_key} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\admin\menu_overrides_router.py |
| + 新增 | GET | /workspaces/{workspace_id}/sillyspec/file-diff | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\change\router.py |
| + 新增 | GET | /workspaces/{workspace_id}/sillyspec/scope-audit | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\change\router.py |
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
| - 删除 | GET | /workspaces/{workspace_id}/knowledge/{filename} | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\knowledge\router.py |
