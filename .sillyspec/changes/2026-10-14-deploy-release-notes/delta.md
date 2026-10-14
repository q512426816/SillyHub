---
generated_at: 2026-10-14T06:01:53.894Z
sources_reconcile: 命中（ran_at=2026-10-14T05:52:15.865Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-10-14-deploy-release-notes

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

| 模块 | status | paths+core_files 条目数 |
|---|---|---|
| build | active | 5 |

未匹配文件（不归属任何模块 paths，人工裁量）：.zcode/skills/sillyhub-docker-deploy/SKILL.md、backend/app/main.py、backend/app/modules/auth/permissions.py、backend/app/modules/deploy_records/__init__.py、backend/app/modules/deploy_records/router.py、backend/app/modules/deploy_records/schema.py、backend/app/modules/deploy_records/service.py、backend/app/modules/deploy_records/tests/__init__.py、backend/app/modules/deploy_records/tests/test_router.py、backend/app/modules/deploy_records/tests/test_service.py、backend/migrations/versions/20261014110000_add_deploy_record_read_permission.py、backend/openapi.json、backend/tests/modules/auth/test_permissions.py、backend/tests/test_align_platform_change_events_migration.py、frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx、frontend/src/app/(dashboard)/deploy-records/__tests__/page.test.tsx、frontend/src/app/(dashboard)/deploy-records/page.tsx、frontend/src/components/__tests__/app-shell.test.tsx、frontend/src/components/app-shell.tsx、frontend/src/lib/api-types.ts、frontend/src/lib/deploy-records.ts、frontend/src/lib/menu-permissions.ts、frontend/src/lib/query-keys.ts、.sillyspec/docs/SillyHub/modules/frontend_app.changelog.md、.sillyspec/docs/SillyHub/modules/frontend_components.changelog.md、.sillyspec/docs/backend/modules/change.changelog.md、.sillyspec/docs/multi-agent-platform/modules/backend.changelog.md、.sillyspec/docs/multi-agent-platform/modules/deploy.md、.sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md、backend/app/modules/agent/profile/seed.py、backend/app/modules/agent/tests/test_profile_seed.py、backend/app/modules/change/router.py、backend/app/modules/change/service.py、backend/app/modules/change/tests/test_change_lineage_filter.py、backend/uv.lock、deploy/docker-compose.dev.yml、deploy/litellm-config.yaml、docs/sillyspec/finished/flowdone-patch-refreeze-missing-artifact.md、docs/sillyspec/finished/litellm-v1950-image-entrypoint-not-found.md、docs/sillyspec/finished/tests-redomain-from-prefix-doubling.md、frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx、frontend/src/app/m/account/page.test.tsx、frontend/src/app/m/account/page.tsx、frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx、frontend/src/app/m/workspaces/[id]/changes/page.tsx、frontend/src/components/__tests__/change-file-tree-autorefresh.test.tsx、frontend/src/components/mobile/mobile-change-card.test.tsx、frontend/src/components/mobile/mobile-change-card.tsx、frontend/src/lib/__tests__/logout-storage.test.ts、frontend/src/lib/__tests__/menu-permissions.test.ts、frontend/src/lib/api.ts、frontend/src/lib/changes.ts、frontend/src/lib/logout-storage.ts

### 声明域并集（decisions.md 模块域）

（decisions.md 解析出 7 条当前版本决策，均未填写模块域——声明域为空）

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| .zcode/skills/sillyhub-docker-deploy/SKILL.md | —（未匹配） |
| backend/app/main.py | —（未匹配） |
| backend/app/modules/auth/permissions.py | —（未匹配） |
| backend/app/modules/deploy_records/__init__.py | —（未匹配） |
| backend/app/modules/deploy_records/router.py | —（未匹配） |
| backend/app/modules/deploy_records/schema.py | —（未匹配） |
| backend/app/modules/deploy_records/service.py | —（未匹配） |
| backend/app/modules/deploy_records/tests/__init__.py | —（未匹配） |
| backend/app/modules/deploy_records/tests/test_router.py | —（未匹配） |
| backend/app/modules/deploy_records/tests/test_service.py | —（未匹配） |
| backend/migrations/versions/20261014110000_add_deploy_record_read_permission.py | —（未匹配） |
| backend/openapi.json | —（未匹配） |
| backend/pyproject.toml | build |
| backend/tests/modules/auth/test_permissions.py | —（未匹配） |
| backend/tests/test_align_platform_change_events_migration.py | —（未匹配） |
| frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | —（未匹配） |
| frontend/src/app/(dashboard)/deploy-records/__tests__/page.test.tsx | —（未匹配） |
| frontend/src/app/(dashboard)/deploy-records/page.tsx | —（未匹配） |
| frontend/src/components/__tests__/app-shell.test.tsx | —（未匹配） |
| frontend/src/components/app-shell.tsx | —（未匹配） |
| frontend/src/lib/api-types.ts | —（未匹配） |
| frontend/src/lib/deploy-records.ts | —（未匹配） |
| frontend/src/lib/menu-permissions.ts | —（未匹配） |
| frontend/src/lib/query-keys.ts | —（未匹配） |

- 对账基线：status=undeclared / form=worktree / sources=worktree:diff-base..HEAD、worktree:status-porcelain(uncommitted)
- missing（声明未落盘）：无
- undeclared（落盘未声明，32 项）：.sillyspec/docs/SillyHub/modules/frontend_app.changelog.md；.sillyspec/docs/SillyHub/modules/frontend_components.changelog.md；.sillyspec/docs/backend/modules/change.changelog.md；.sillyspec/docs/multi-agent-platform/modules/backend.changelog.md；.sillyspec/docs/multi-agent-platform/modules/deploy.md（疑似归因 task-12）；.sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md；backend/app/modules/agent/profile/seed.py（疑似归因 task-11）；backend/app/modules/agent/tests/test_profile_seed.py（疑似归因 task-11）；backend/app/modules/change/router.py（疑似归因 task-03、task-05、task-04、task-02、task-11）；backend/app/modules/change/service.py（疑似归因 task-04、task-06、task-01、task-08、task-05、task-10、task-07、task-02、task-03）；backend/app/modules/change/tests/test_change_lineage_filter.py；backend/uv.lock（疑似归因 task-04）；deploy/docker-compose.dev.yml（疑似归因 task-08）；deploy/docker-compose.yml（疑似归因 task-14、task-08、task-07）；deploy/litellm-config.yaml（疑似归因 task-08）；docs/sillyspec/finished/flowdone-patch-refreeze-missing-artifact.md；docs/sillyspec/finished/litellm-v1950-image-entrypoint-not-found.md；docs/sillyspec/finished/tests-redomain-from-prefix-doubling.md；frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx（疑似归因 task-08、task-10、task-05、task-06、task-09）；frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx（疑似归因 task-08、task-10、task-05、task-06、task-09、task-02）；frontend/src/app/m/account/page.test.tsx；frontend/src/app/m/account/page.tsx；frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx；frontend/src/app/m/workspaces/[id]/changes/page.tsx；frontend/src/components/__tests__/change-file-tree-autorefresh.test.tsx；frontend/src/components/mobile/mobile-change-card.test.tsx；frontend/src/components/mobile/mobile-change-card.tsx；frontend/src/lib/__tests__/logout-storage.test.ts；frontend/src/lib/__tests__/menu-permissions.test.ts（疑似归因 task-09、task-05、task-02、task-07）；frontend/src/lib/api.ts；frontend/src/lib/changes.ts（疑似归因 task-09、task-10、task-05、task-01、task-12、task-13）；frontend/src/lib/logout-storage.ts

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

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-10-14T05:40:13.348Z
- probe1：matches=0 / skippedFiles=0 / worktreeHits=10 / globEntries=0
- probe3：tasks=6 / hasTest=5
- probe5：backendEndpoints=3045 / frontendCalls=2
- probe6：deletions=0 / unavailable=false
- probe8：mispairs=0 / feOnly=0 / missingNotNull=0 / contractCount=0 / contractOrphans=0 / missingRequired=0 / feKeys=0 / backendFields=0
- probe9：javaFileCount=0 / groupCount=0 / inconsistentGroups=0
- probe10：checkedFiles=7 / unclearedFiles=0

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 文档 | 状态 | 说明 |
|---|---|---|
| modules/backend.md | done | backend entrypoints 补 deploy_records_router；卡片契约摘要随归档留档 |
| modules/frontend.md | done | /deploy-records 页与菜单注册属页面级新增，卡片无契约级变化 |
| _module-map.yaml | done | backend entrypoints 已补 deploy_records_router 行 |

### scan 刷新建议

- `sillyspec scan facts` 下次刷新重点关注：build（共 1 个模块）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：.zcode/skills/sillyhub-docker-deploy/SKILL.md、backend/app/main.py、backend/app/modules/auth/permissions.py、backend/app/modules/deploy_records/__init__.py、backend/app/modules/deploy_records/router.py、backend/app/modules/deploy_records/schema.py、backend/app/modules/deploy_records/service.py、backend/app/modules/deploy_records/tests/__init__.py、backend/app/modules/deploy_records/tests/test_router.py、backend/app/modules/deploy_records/tests/test_service.py、backend/migrations/versions/20261014110000_add_deploy_record_read_permission.py、backend/openapi.json、backend/tests/modules/auth/test_permissions.py、backend/tests/test_align_platform_change_events_migration.py、frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx、frontend/src/app/(dashboard)/deploy-records/__tests__/page.test.tsx、frontend/src/app/(dashboard)/deploy-records/page.tsx、frontend/src/components/__tests__/app-shell.test.tsx、frontend/src/components/app-shell.tsx、frontend/src/lib/api-types.ts、frontend/src/lib/deploy-records.ts、frontend/src/lib/menu-permissions.ts、frontend/src/lib/query-keys.ts、.sillyspec/docs/SillyHub/modules/frontend_app.changelog.md、.sillyspec/docs/SillyHub/modules/frontend_components.changelog.md、.sillyspec/docs/backend/modules/change.changelog.md、.sillyspec/docs/multi-agent-platform/modules/backend.changelog.md、.sillyspec/docs/multi-agent-platform/modules/deploy.md、.sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md、backend/app/modules/agent/profile/seed.py、backend/app/modules/agent/tests/test_profile_seed.py、backend/app/modules/change/router.py、backend/app/modules/change/service.py、backend/app/modules/change/tests/test_change_lineage_filter.py、backend/uv.lock、deploy/docker-compose.dev.yml、deploy/litellm-config.yaml、docs/sillyspec/finished/flowdone-patch-refreeze-missing-artifact.md、docs/sillyspec/finished/litellm-v1950-image-entrypoint-not-found.md、docs/sillyspec/finished/tests-redomain-from-prefix-doubling.md、frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/changes/page.tsx、frontend/src/app/m/account/page.test.tsx、frontend/src/app/m/account/page.tsx、frontend/src/app/m/workspaces/[id]/changes/__tests__/page.test.tsx、frontend/src/app/m/workspaces/[id]/changes/page.tsx、frontend/src/components/__tests__/change-file-tree-autorefresh.test.tsx、frontend/src/components/mobile/mobile-change-card.test.tsx、frontend/src/components/mobile/mobile-change-card.tsx、frontend/src/lib/__tests__/logout-storage.test.ts、frontend/src/lib/__tests__/menu-permissions.test.ts、frontend/src/lib/api.ts、frontend/src/lib/changes.ts、frontend/src/lib/logout-storage.ts

### 端点基线提示

- 无基线（变更未拍 baseline）：C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\endpoint-baselines\2026-10-14-deploy-release-notes.json 不存在或不可解析——端点增删不可比（backendEndpoints=3045（>0））
