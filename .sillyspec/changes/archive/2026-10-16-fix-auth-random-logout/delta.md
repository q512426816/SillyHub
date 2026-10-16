---
generated_at: 2026-10-16T10:54:26.676Z
sources_reconcile: 命中（ran_at=2026-10-16T10:32:34.817Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-10-16-fix-auth-random-logout

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

| 模块 | status | paths+core_files 条目数 |
|---|---|---|
| sillyspec | active | 1 |
| backend | active | 1 |
| frontend | active | 1 |
| docs | active | 1 |
| sillyhub-daemon | active | 1 |

未匹配文件（不归属任何模块 paths，人工裁量）：.sillyspec/docs/multi-agent-platform/flows/auth-flow.md、backend/app/core/config.py、backend/app/core/tests/test_config_auth.py、backend/app/modules/auth/model.py、backend/app/modules/auth/service.py、backend/migrations/versions/c3f8a1d6e2b4_add_sessions_family_id.py、backend/tests/modules/auth/test_refresh_family_revocation.py、backend/tests/modules/auth/test_refresh_grace_window.py、backend/tests/test_align_platform_change_events_migration.py、frontend/src/lib/__tests__/token-refresh.test.ts、frontend/src/lib/api.ts、frontend/src/lib/token-refresh.ts、.sillyspec/docs/SillyHub/modules/change.md、.sillyspec/docs/SillyHub/modules/daemon.changelog.md、.sillyspec/docs/SillyHub/modules/frontend_components.changelog.md、.sillyspec/docs/SillyHub/modules/frontend_components.md、.sillyspec/docs/SillyHub/modules/frontend_lib.changelog.md、.sillyspec/docs/SillyHub/modules/frontend_lib.md、.sillyspec/docs/backend/modules/auth.changelog.md、.sillyspec/docs/backend/modules/auth.md、.sillyspec/docs/backend/modules/change.changelog.md、.sillyspec/docs/backend/modules/change.md、.sillyspec/docs/multi-agent-platform/modules/backend.changelog.md、.sillyspec/docs/multi-agent-platform/modules/docs.changelog.md、.sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md、.sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.changelog.md、.zcode/skills/deploy-to-server/SKILL.md、backend/app/modules/change/router.py、backend/app/modules/change/schema.py、backend/app/modules/change/tests/test_files_refresh_sync.py、backend/app/modules/daemon/router/machines.py、backend/app/modules/daemon/sillyspec_compare.py、backend/app/modules/daemon/tests/test_sillyspec_compare.py、backend/openapi.json、docs/sillyspec/active-pitfalls.md、docs/sillyspec/conflict-compare-full-tree-label-mismatch.md、frontend/prototype-dist/change-center.html、frontend/prototype-dist/change-detail-v2.html、frontend/prototype-dist/change-detail.html、frontend/prototype-dist/conflict-sync-states.html、frontend/prototype-dist/index.html、frontend/prototype-dist/session-portal.html、frontend/prototype-dist/sillyspec-flow.html、frontend/prototype-dist/workspace-list.html、frontend/prototype-dist/workspace-overview.html、frontend/scripts/prototype-build.mjs、frontend/src/components/__tests__/change-file-tree-sync-feedback.test.tsx、frontend/src/components/change-file-tree.tsx、frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx、frontend/src/components/changes/__tests__/platform-sync-section.test.tsx、frontend/src/components/changes/conflict-compare-modal.tsx、frontend/src/components/changes/platform-sync-section.tsx、frontend/src/components/prototype/conflict-sync-states-view.tsx、frontend/src/lib/__tests__/change-file-sync.test.ts、frontend/src/lib/api-types.ts、frontend/src/lib/change-file-sync.ts、frontend/src/lib/change-files.ts、frontend/src/lib/spec-workspaces.ts、sillyhub-daemon/src/api-types.ts

### 声明域并集（decisions.md 模块域）

（decisions.md 解析出 8 条当前版本决策，均未填写模块域——声明域为空）

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| .sillyspec/docs/multi-agent-platform/flows/auth-flow.md | —（未匹配） |
| backend/app/core/config.py | —（未匹配） |
| backend/app/core/tests/test_config_auth.py | —（未匹配） |
| backend/app/modules/auth/model.py | —（未匹配） |
| backend/app/modules/auth/service.py | —（未匹配） |
| backend/migrations/versions/c3f8a1d6e2b4_add_sessions_family_id.py | —（未匹配） |
| backend/tests/modules/auth/test_refresh_family_revocation.py | —（未匹配） |
| backend/tests/modules/auth/test_refresh_grace_window.py | —（未匹配） |
| backend/tests/test_align_platform_change_events_migration.py | —（未匹配） |
| frontend/src/lib/__tests__/token-refresh.test.ts | —（未匹配） |
| frontend/src/lib/api.ts | —（未匹配） |
| frontend/src/lib/token-refresh.ts | —（未匹配） |

- 对账基线：status=undeclared / form=post-apply / sources=main:diff-merge-base、main:status-porcelain(untracked-all)、main:log-20-commit-window(declared-rescue-only:sillyspec-audit/sillyspec/2026-10-16-fix-auth-random-logout)、apply-pathspec
- missing（声明未落盘）：无
- undeclared（落盘未声明，47 项）：.sillyspec/docs/SillyHub/modules/change.md（疑似归因 task-18）；.sillyspec/docs/SillyHub/modules/daemon.changelog.md；.sillyspec/docs/SillyHub/modules/frontend_components.changelog.md；.sillyspec/docs/SillyHub/modules/frontend_components.md；.sillyspec/docs/SillyHub/modules/frontend_lib.changelog.md；.sillyspec/docs/SillyHub/modules/frontend_lib.md；.sillyspec/docs/backend/modules/auth.changelog.md；.sillyspec/docs/backend/modules/auth.md；.sillyspec/docs/backend/modules/change.changelog.md；.sillyspec/docs/backend/modules/change.md（疑似归因 task-12、task-18）；.sillyspec/docs/multi-agent-platform/modules/backend.changelog.md；.sillyspec/docs/multi-agent-platform/modules/docs.changelog.md；.sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md；.sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.changelog.md；.zcode/skills/deploy-to-server/SKILL.md；backend/app/modules/change/router.py（疑似归因 task-03、task-05、task-04、task-02、task-11）；backend/app/modules/change/schema.py（疑似归因 task-05、task-03、task-04、task-02、task-07、task-01、task-11）；backend/app/modules/change/tests/test_files_refresh_sync.py；backend/app/modules/daemon/router/machines.py；backend/app/modules/daemon/sillyspec_compare.py；backend/app/modules/daemon/tests/test_sillyspec_compare.py；backend/openapi.json（疑似归因 task-13、task-04、task-05、task-09、task-07、task-03、task-06、task-11、task-08、task-01、task-15、task-02）；docs/sillyspec/active-pitfalls.md；docs/sillyspec/conflict-compare-full-tree-label-mismatch.md；frontend/prototype-dist/change-center.html；frontend/prototype-dist/change-detail-v2.html；frontend/prototype-dist/change-detail.html；frontend/prototype-dist/conflict-sync-states.html；frontend/prototype-dist/index.html；frontend/prototype-dist/session-portal.html；frontend/prototype-dist/sillyspec-flow.html；frontend/prototype-dist/workspace-list.html；frontend/prototype-dist/workspace-overview.html；frontend/scripts/prototype-build.mjs；frontend/src/components/__tests__/change-file-tree-sync-feedback.test.tsx；frontend/src/components/change-file-tree.tsx（疑似归因 task-13）；frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx；frontend/src/components/changes/__tests__/platform-sync-section.test.tsx；frontend/src/components/changes/conflict-compare-modal.tsx；frontend/src/components/changes/platform-sync-section.tsx；frontend/src/components/prototype/conflict-sync-states-view.tsx；frontend/src/lib/__tests__/change-file-sync.test.ts；frontend/src/lib/api-types.ts（疑似归因 task-13、task-04、task-05、task-09、task-07、task-03、task-06、task-11、task-01、task-15、task-02）；frontend/src/lib/change-file-sync.ts；frontend/src/lib/change-files.ts；frontend/src/lib/spec-workspaces.ts（疑似归因 task-01、task-09）；sillyhub-daemon/src/api-types.ts（疑似归因 task-13、task-09、task-07、task-04）

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

快照时刻：2026-10-16T09:11:21.371Z
- probe1：matches=1 / skippedFiles=0 / worktreeHits=0 / globEntries=0
- probe3：tasks=4 / hasTest=3
- probe5：backendEndpoints=2406 / frontendCalls=1
- probe6：deletions=0 / unavailable=false
- probe8：mispairs=0 / feOnly=0 / missingNotNull=0 / contractCount=0 / contractOrphans=0 / missingRequired=0 / feKeys=0 / backendFields=0
- probe9：javaFileCount=0 / groupCount=0 / inconsistentGroups=0
- probe10：checkedFiles=5 / unclearedFiles=0

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `.sillyspec/docs/backend/modules/auth.md` | 更新 auth 模块卡：族级吊销语义 + family_id + grace 300s + revoke_all 用途收窄（task-01/02） | done |
| `.sillyspec/docs/backend/modules/auth.changelog.md` | 追加 2026-10-16 变更条目 | done |
| `.sillyspec/docs/SillyHub/modules/frontend_lib.md` | 更新 token-refresh 状态码分流语义（task-03） | done |
| `.sillyspec/docs/SillyHub/modules/frontend_lib.changelog.md` | 新建 sidecar + 首条变更索引（task-03） | done |
| `_module-map.yaml` | 无变化（未增删模块） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

### scan 刷新建议

- `sillyspec scan facts` 下次刷新重点关注：sillyspec、backend、frontend、docs、sillyhub-daemon（共 5 个模块）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：.sillyspec/docs/multi-agent-platform/flows/auth-flow.md、backend/app/core/config.py、backend/app/core/tests/test_config_auth.py、backend/app/modules/auth/model.py、backend/app/modules/auth/service.py、backend/migrations/versions/c3f8a1d6e2b4_add_sessions_family_id.py、backend/tests/modules/auth/test_refresh_family_revocation.py、backend/tests/modules/auth/test_refresh_grace_window.py、backend/tests/test_align_platform_change_events_migration.py、frontend/src/lib/__tests__/token-refresh.test.ts、frontend/src/lib/api.ts、frontend/src/lib/token-refresh.ts、.sillyspec/docs/SillyHub/modules/change.md、.sillyspec/docs/SillyHub/modules/daemon.changelog.md、.sillyspec/docs/SillyHub/modules/frontend_components.changelog.md、.sillyspec/docs/SillyHub/modules/frontend_components.md、.sillyspec/docs/SillyHub/modules/frontend_lib.changelog.md、.sillyspec/docs/SillyHub/modules/frontend_lib.md、.sillyspec/docs/backend/modules/auth.changelog.md、.sillyspec/docs/backend/modules/auth.md、.sillyspec/docs/backend/modules/change.changelog.md、.sillyspec/docs/backend/modules/change.md、.sillyspec/docs/multi-agent-platform/modules/backend.changelog.md、.sillyspec/docs/multi-agent-platform/modules/docs.changelog.md、.sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md、.sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.changelog.md、.zcode/skills/deploy-to-server/SKILL.md、backend/app/modules/change/router.py、backend/app/modules/change/schema.py、backend/app/modules/change/tests/test_files_refresh_sync.py、backend/app/modules/daemon/router/machines.py、backend/app/modules/daemon/sillyspec_compare.py、backend/app/modules/daemon/tests/test_sillyspec_compare.py、backend/openapi.json、docs/sillyspec/active-pitfalls.md、docs/sillyspec/conflict-compare-full-tree-label-mismatch.md、frontend/prototype-dist/change-center.html、frontend/prototype-dist/change-detail-v2.html、frontend/prototype-dist/change-detail.html、frontend/prototype-dist/conflict-sync-states.html、frontend/prototype-dist/index.html、frontend/prototype-dist/session-portal.html、frontend/prototype-dist/sillyspec-flow.html、frontend/prototype-dist/workspace-list.html、frontend/prototype-dist/workspace-overview.html、frontend/scripts/prototype-build.mjs、frontend/src/components/__tests__/change-file-tree-sync-feedback.test.tsx、frontend/src/components/change-file-tree.tsx、frontend/src/components/changes/__tests__/conflict-compare-modal.test.tsx、frontend/src/components/changes/__tests__/platform-sync-section.test.tsx、frontend/src/components/changes/conflict-compare-modal.tsx、frontend/src/components/changes/platform-sync-section.tsx、frontend/src/components/prototype/conflict-sync-states-view.tsx、frontend/src/lib/__tests__/change-file-sync.test.ts、frontend/src/lib/api-types.ts、frontend/src/lib/change-file-sync.ts、frontend/src/lib/change-files.ts、frontend/src/lib/spec-workspaces.ts、sillyhub-daemon/src/api-types.ts

### 端点基线提示

- 端点增删：无增删（基线 658 端点 × 现算 658 端点，method+归一 path 全一致）
