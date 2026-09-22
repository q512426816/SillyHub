---
generated_at: 2026-09-22T17:01:57.203Z
sources_reconcile: 命中（ran_at=2026-09-11T21:46:54.860Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-09-11-provider-adapter-registry

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

| 模块 | status | paths+core_files 条目数 |
|---|---|---|
| build | active | 5 |

未匹配文件（不归属任何模块 paths，人工裁量）：sillyhub-daemon/tests/codex-settings.test.ts、sillyhub-daemon/tests/pi-settings.test.ts、sillyhub-daemon/tests/provider-adapter-registry.test.ts、.sillyspec/ROADMAP.md、backend/app/modules/agent/provider_caps.py、backend/app/modules/agent/skills_bundle_service.py、backend/app/modules/agent/tests/test_provider_caps_alignment.py、backend/app/modules/daemon/router/daemon_rpc.py、backend/app/modules/daemon/tests/test_skills_bundle.py、backend/app/modules/mcp_registry/schema.py、backend/app/modules/mcp_registry/service.py、backend/app/modules/mcp_registry/tests/test_service.py、backend/app/modules/skill_source/model.py、backend/app/modules/skill_source/router.py、backend/app/modules/skill_source/service.py、backend/app/modules/skill_source/tests/test_library_enable.py、backend/app/modules/skill_source/tests/test_model.py、backend/app/modules/workspace/router.py、backend/app/modules/workspace/skills_view_service.py、backend/app/modules/workspace/tests/test_mcp_import_registry.py、backend/app/modules/workspace/tests/test_skills_adopt.py、backend/migrations/versions/20260911220000_add_workspace_scope_enables.py、backend/openapi.json、deploy/backend-only.tar.gz、docs/sillyspec/agent-log-ctx-attribution-mismatch.md、docs/sillyspec/agent-log-hub-attribution-cross-session-contamination.md、frontend/src/app/(dashboard)/workspaces/[id]/mcp/__tests__/page.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/mcp/page.tsx、frontend/src/app/(dashboard)/workspaces/[id]/skills/__tests__/page.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/skills/page.tsx、frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx、frontend/src/components/skills-library/__tests__/library-enable-list.test.tsx、frontend/src/components/skills-library/library-enable-list.tsx、frontend/src/components/skills-library/skill-source-api.ts、frontend/src/lib/api-types.ts、frontend/src/lib/provider-caps.ts、sillyhub-daemon/scripts/gen-provider-caps.mjs、sillyhub-daemon/src/api-types.ts、sillyhub-daemon/src/codex-settings.ts、sillyhub-daemon/src/credential-injector.ts、sillyhub-daemon/src/daemon.ts、sillyhub-daemon/src/interactive/providers.ts、sillyhub-daemon/src/interactive/session-manager.ts、sillyhub-daemon/src/interactive/session-manager/persistence.ts、sillyhub-daemon/src/pi-settings.ts、sillyhub-daemon/src/provider-file-settings.ts、sillyhub-daemon/src/skill-manager.ts、sillyhub-daemon/src/task-runner.ts、sillyhub-daemon/tests/interactive/provider-registry.test.ts、sillyhub-daemon/tests/skill-manager.test.ts、sillyhub-daemon/tests/task-runner-file-mcp.test.ts、sillyhub-daemon/tests/task-runner-skill-detect.test.ts、sillyhub-daemon/tests/task-runner.test.ts

### 声明域并集（decisions.md 模块域）

（decisions.md 解析出 3 条当前版本决策，均未填写模块域——声明域为空）

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| sillyhub-daemon/tests/codex-settings.test.ts | —（未匹配） |
| sillyhub-daemon/tests/pi-settings.test.ts | —（未匹配） |
| sillyhub-daemon/tests/provider-adapter-registry.test.ts | —（未匹配） |

- 对账基线：status=undeclared / form=post-apply / sources=main:diff-merge-base、main:status-porcelain(untracked-all)、apply-pathspec
- missing（声明未落盘）：无
- undeclared（落盘未声明，51 项）：.sillyspec/ROADMAP.md；backend/app/modules/agent/provider_caps.py（疑似归因 task-04）；backend/app/modules/agent/skills_bundle_service.py（疑似归因 task-06）；backend/app/modules/agent/tests/test_provider_caps_alignment.py（疑似归因 task-04）；backend/app/modules/daemon/router/daemon_rpc.py；backend/app/modules/daemon/tests/test_skills_bundle.py（疑似归因 task-01）；backend/app/modules/mcp_registry/schema.py；backend/app/modules/mcp_registry/service.py；backend/app/modules/mcp_registry/tests/test_service.py；backend/app/modules/skill_source/model.py；backend/app/modules/skill_source/router.py；backend/app/modules/skill_source/service.py；backend/app/modules/skill_source/tests/test_library_enable.py；backend/app/modules/skill_source/tests/test_model.py；backend/app/modules/workspace/router.py（疑似归因 task-01）；backend/app/modules/workspace/skills_view_service.py；backend/app/modules/workspace/tests/test_mcp_import_registry.py；backend/app/modules/workspace/tests/test_skills_adopt.py；backend/migrations/versions/20260911220000_add_workspace_scope_enables.py；backend/openapi.json（疑似归因 task-13）；deploy/backend-only.tar.gz；docs/sillyspec/agent-log-ctx-attribution-mismatch.md；docs/sillyspec/agent-log-hub-attribution-cross-session-contamination.md；frontend/package.json（疑似归因 task-04）；frontend/src/app/(dashboard)/workspaces/[id]/mcp/__tests__/page.test.tsx；frontend/src/app/(dashboard)/workspaces/[id]/mcp/page.tsx；frontend/src/app/(dashboard)/workspaces/[id]/skills/__tests__/page.test.tsx；frontend/src/app/(dashboard)/workspaces/[id]/skills/page.tsx；frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx；frontend/src/components/skills-library/__tests__/library-enable-list.test.tsx；frontend/src/components/skills-library/library-enable-list.tsx；frontend/src/components/skills-library/skill-source-api.ts；frontend/src/lib/api-types.ts（疑似归因 task-13）；frontend/src/lib/provider-caps.ts（疑似归因 task-04）；sillyhub-daemon/scripts/gen-provider-caps.mjs（疑似归因 task-04）；sillyhub-daemon/src/api-types.ts（疑似归因 task-13）；sillyhub-daemon/src/codex-settings.ts（疑似归因 task-02）；sillyhub-daemon/src/credential-injector.ts（疑似归因 task-02）；sillyhub-daemon/src/daemon.ts（疑似归因 task-03）；sillyhub-daemon/src/interactive/providers.ts（疑似归因 task-01）；sillyhub-daemon/src/interactive/session-manager.ts（疑似归因 task-03）；sillyhub-daemon/src/interactive/session-manager/persistence.ts（疑似归因 task-03）；sillyhub-daemon/src/pi-settings.ts（疑似归因 task-02）；sillyhub-daemon/src/provider-file-settings.ts（疑似归因 task-02）；sillyhub-daemon/src/skill-manager.ts（疑似归因 task-03）；sillyhub-daemon/src/task-runner.ts（疑似归因 task-06）；sillyhub-daemon/tests/interactive/provider-registry.test.ts（疑似归因 task-01）；sillyhub-daemon/tests/skill-manager.test.ts（疑似归因 task-03）；sillyhub-daemon/tests/task-runner-file-mcp.test.ts；sillyhub-daemon/tests/task-runner-skill-detect.test.ts（疑似归因 task-08）；sillyhub-daemon/tests/task-runner.test.ts（疑似归因 task-09）

### 决策清单（id × 模块域）

| 决策 | 模块域 |
|---|---|
| D-001@v1 | （未填写） |
| D-002@v1 | （未填写） |
| D-003@v2 | （未填写） |

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-09-11T21:46:31.140Z
- probe1：matches=3 / skippedFiles=2 / worktreeHits=0 / globEntries=0
- probe3：tasks=7 / hasTest=6
- probe5：backendEndpoints=3961 / frontendCalls=0
- probe6：deletions=0 / unavailable=false

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | 本变更不改模块边界；daemon 模块卡「聚合契约」条目随归档 spec-sync 补登（providers.ts main_symbols 已有 INTERACTIVE_PROVIDERS 条目，描述升格 ProviderAdapter 一句话） | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

### scan 刷新建议

- `sillyspec scan facts` 下次刷新重点关注：build（共 1 个模块）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：sillyhub-daemon/tests/codex-settings.test.ts、sillyhub-daemon/tests/pi-settings.test.ts、sillyhub-daemon/tests/provider-adapter-registry.test.ts、.sillyspec/ROADMAP.md、backend/app/modules/agent/provider_caps.py、backend/app/modules/agent/skills_bundle_service.py、backend/app/modules/agent/tests/test_provider_caps_alignment.py、backend/app/modules/daemon/router/daemon_rpc.py、backend/app/modules/daemon/tests/test_skills_bundle.py、backend/app/modules/mcp_registry/schema.py、backend/app/modules/mcp_registry/service.py、backend/app/modules/mcp_registry/tests/test_service.py、backend/app/modules/skill_source/model.py、backend/app/modules/skill_source/router.py、backend/app/modules/skill_source/service.py、backend/app/modules/skill_source/tests/test_library_enable.py、backend/app/modules/skill_source/tests/test_model.py、backend/app/modules/workspace/router.py、backend/app/modules/workspace/skills_view_service.py、backend/app/modules/workspace/tests/test_mcp_import_registry.py、backend/app/modules/workspace/tests/test_skills_adopt.py、backend/migrations/versions/20260911220000_add_workspace_scope_enables.py、backend/openapi.json、deploy/backend-only.tar.gz、docs/sillyspec/agent-log-ctx-attribution-mismatch.md、docs/sillyspec/agent-log-hub-attribution-cross-session-contamination.md、frontend/src/app/(dashboard)/workspaces/[id]/mcp/__tests__/page.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/mcp/page.tsx、frontend/src/app/(dashboard)/workspaces/[id]/skills/__tests__/page.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/skills/page.tsx、frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx、frontend/src/components/skills-library/__tests__/library-enable-list.test.tsx、frontend/src/components/skills-library/library-enable-list.tsx、frontend/src/components/skills-library/skill-source-api.ts、frontend/src/lib/api-types.ts、frontend/src/lib/provider-caps.ts、sillyhub-daemon/scripts/gen-provider-caps.mjs、sillyhub-daemon/src/api-types.ts、sillyhub-daemon/src/codex-settings.ts、sillyhub-daemon/src/credential-injector.ts、sillyhub-daemon/src/daemon.ts、sillyhub-daemon/src/interactive/providers.ts、sillyhub-daemon/src/interactive/session-manager.ts、sillyhub-daemon/src/interactive/session-manager/persistence.ts、sillyhub-daemon/src/pi-settings.ts、sillyhub-daemon/src/provider-file-settings.ts、sillyhub-daemon/src/skill-manager.ts、sillyhub-daemon/src/task-runner.ts、sillyhub-daemon/tests/interactive/provider-registry.test.ts、sillyhub-daemon/tests/skill-manager.test.ts、sillyhub-daemon/tests/task-runner-file-mcp.test.ts、sillyhub-daemon/tests/task-runner-skill-detect.test.ts、sillyhub-daemon/tests/task-runner.test.ts

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
