---
generated_at: 2026-11-07T05:34:43.834Z
sources_reconcile: 命中（ran_at=2026-11-07T02:32:39.729Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-11-06-session-git-approval

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

| 模块 | status | paths+core_files 条目数 |
|---|---|---|
| backend | active | 1 |
| frontend | active | 1 |
| sillyhub-daemon | active | 1 |
| deploy | active | 1 |
| docs | active | 1 |

未匹配文件（不归属任何模块 paths，人工裁量）：backend/app/modules/daemon/router/session_crud.py、backend/app/modules/daemon/session/service/git_diff.py、backend/openapi.json、frontend/src/components/daemon/__tests__/git-approval-card.test.tsx、frontend/src/components/daemon/git-approval-card.tsx、frontend/src/components/daemon/pending-dialog-dock.tsx、frontend/src/components/daemon/session-panel/session-panel-dialog.tsx、frontend/src/components/daemon/session-panel/session-panel-page.tsx、frontend/src/lib/api-types.ts、sillyhub-daemon/src/api-types.ts、sillyhub-daemon/src/interactive/git-approval-collector.ts、sillyhub-daemon/src/interactive/git-command-guard.ts、sillyhub-daemon/src/interactive/git-executor.ts、sillyhub-daemon/src/interactive/session-manager/driver-factory.ts、sillyhub-daemon/src/interactive/session-manager/permission.ts、sillyhub-daemon/tests/interactive/driver-factory-approval-wiring.test.ts、sillyhub-daemon/tests/interactive/git-approval-collector.test.ts、sillyhub-daemon/tests/interactive/git-command-guard.test.ts、sillyhub-daemon/tests/interactive/git-executor.test.ts、sillyhub-daemon/tests/interactive/session-manager-permission.test.ts、backend/app/core/db.py、backend/app/modules/daemon/agent_task_store.py、backend/app/modules/daemon/router/__init__.py、backend/app/modules/task/parser.py、docs/sillyspec/active-pitfalls.md、docs/sillyspec/finished/platform-worker-specroot-junction-dangling.md、docs/sillyspec/platform-worker-specroot-junction-dangling.md、frontend/prototype-dist/change-center.html、frontend/prototype-dist/change-detail-v2.html、frontend/prototype-dist/change-detail.html、frontend/prototype-dist/conflict-sync-states.html、frontend/prototype-dist/engine-live-perception.html、frontend/prototype-dist/explorer-git-status.html、frontend/prototype-dist/git-approval.html、frontend/prototype-dist/index.html、frontend/prototype-dist/session-config-pending.html、frontend/prototype-dist/session-fold.html、frontend/prototype-dist/session-portal.html、frontend/prototype-dist/session-stage-progress.html、frontend/prototype-dist/sillyspec-flow.html、frontend/prototype-dist/trajectory-redesign.html、frontend/prototype-dist/workspace-list.html、frontend/prototype-dist/workspace-overview.html、frontend/scripts/prototype-build.mjs、frontend/src/components/prototype/git-approval-view.tsx、sillyhub-daemon/src/host-fs-handler.ts、sillyhub-daemon/tests/host-fs-handler-worktree.test.ts

### 声明域并集（decisions.md 模块域）

（decisions.md 解析出 21 条当前版本决策，均未填写模块域——声明域为空）

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| backend/app/modules/daemon/router/session_crud.py | —（未匹配） |
| backend/app/modules/daemon/session/service/git_diff.py | —（未匹配） |
| backend/openapi.json | —（未匹配） |
| frontend/src/components/daemon/__tests__/git-approval-card.test.tsx | —（未匹配） |
| frontend/src/components/daemon/git-approval-card.tsx | —（未匹配） |
| frontend/src/components/daemon/pending-dialog-dock.tsx | —（未匹配） |
| frontend/src/components/daemon/session-panel/session-panel-dialog.tsx | —（未匹配） |
| frontend/src/components/daemon/session-panel/session-panel-page.tsx | —（未匹配） |
| frontend/src/lib/api-types.ts | —（未匹配） |
| sillyhub-daemon/src/api-types.ts | —（未匹配） |
| sillyhub-daemon/src/interactive/git-approval-collector.ts | —（未匹配） |
| sillyhub-daemon/src/interactive/git-command-guard.ts | —（未匹配） |
| sillyhub-daemon/src/interactive/git-executor.ts | —（未匹配） |
| sillyhub-daemon/src/interactive/session-manager/driver-factory.ts | —（未匹配） |
| sillyhub-daemon/src/interactive/session-manager/permission.ts | —（未匹配） |
| sillyhub-daemon/tests/interactive/driver-factory-approval-wiring.test.ts | —（未匹配） |
| sillyhub-daemon/tests/interactive/git-approval-collector.test.ts | —（未匹配） |
| sillyhub-daemon/tests/interactive/git-command-guard.test.ts | —（未匹配） |
| sillyhub-daemon/tests/interactive/git-executor.test.ts | —（未匹配） |
| sillyhub-daemon/tests/interactive/session-manager-permission.test.ts | —（未匹配） |

- 对账基线：status=undeclared / form=post-apply / sources=main:diff-merge-base、main:status-porcelain(untracked-all)、main:log-20-commit-window(declared-rescue-only:sillyspec-audit/sillyspec/2026-11-06-session-git-approval)、apply-pathspec
- missing（声明未落盘）：无
- undeclared（落盘未声明，28 项）：backend/app/core/db.py；backend/app/modules/daemon/agent_task_store.py；backend/app/modules/daemon/router/__init__.py；backend/app/modules/task/parser.py；deploy/docker-compose.yml（疑似归因 task-14、task-08、task-07）；docs/sillyspec/active-pitfalls.md；docs/sillyspec/finished/platform-worker-specroot-junction-dangling.md；docs/sillyspec/platform-worker-specroot-junction-dangling.md；frontend/prototype-dist/change-center.html；frontend/prototype-dist/change-detail-v2.html；frontend/prototype-dist/change-detail.html；frontend/prototype-dist/conflict-sync-states.html；frontend/prototype-dist/engine-live-perception.html；frontend/prototype-dist/explorer-git-status.html；frontend/prototype-dist/git-approval.html；frontend/prototype-dist/index.html；frontend/prototype-dist/session-config-pending.html；frontend/prototype-dist/session-fold.html；frontend/prototype-dist/session-portal.html；frontend/prototype-dist/session-stage-progress.html；frontend/prototype-dist/sillyspec-flow.html；frontend/prototype-dist/trajectory-redesign.html；frontend/prototype-dist/workspace-list.html；frontend/prototype-dist/workspace-overview.html；frontend/scripts/prototype-build.mjs（疑似归因 task-15）；frontend/src/components/prototype/git-approval-view.tsx（疑似归因 task-15）；sillyhub-daemon/src/host-fs-handler.ts（疑似归因 task-03）；sillyhub-daemon/tests/host-fs-handler-worktree.test.ts

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
| D-009@v1 | （未填写） |
| D-010@v1 | （未填写） |
| D-011@v1 | （未填写） |
| D-012@v1 | （未填写） |
| D-013@v1 | （未填写） |
| D-014@v1 | （未填写） |
| D-015@v1 | （未填写） |
| D-016@v1 | （未填写） |
| D-017@v1 | （未填写） |
| D-018@v1 | （未填写） |
| D-019@v1 | （未填写） |
| D-020@v1 | （未填写） |
| D-021@v1 | （未填写） |

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-11-07T02:19:29.878Z
- probe1：matches=0 / skippedFiles=0 / worktreeHits=0 / globEntries=0
- probe3：tasks=15 / hasTest=12
- probe5：backendEndpoints=3152 / frontendCalls=0
- probe6：deletions=1 / unavailable=false
- probe8：mispairs=0 / feOnly=0 / missingNotNull=0 / contractCount=0 / contractOrphans=0 / missingRequired=0 / feKeys=0 / backendFields=0
- probe9：javaFileCount=0 / groupCount=0 / inconsistentGroups=0
- probe10：checkedFiles=16 / unclearedFiles=0

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend.md` | 更新backend模块卡（本次变更涉及） | done |
| `modules/components-daemon.md` | 更新components-daemon模块卡（本次变更涉及） | done |
| `modules/frontend.md` | 更新frontend模块卡（本次变更涉及） | done |
| `modules/lib-api.md` | 更新lib-api模块卡（本次变更涉及） | done |
| `modules/sillyhub-daemon.md` | 更新sillyhub-daemon模块卡（本次变更涉及） | done |
| `modules/test-utils.md` | 更新test-utils模块卡（本次变更涉及） | done |
| `_module-map.yaml` | 无变化（未增删模块） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

### scan 刷新建议

- `sillyspec scan facts` 下次刷新重点关注：backend、frontend、sillyhub-daemon、deploy、docs（共 5 个模块）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：backend/app/modules/daemon/router/session_crud.py、backend/app/modules/daemon/session/service/git_diff.py、backend/openapi.json、frontend/src/components/daemon/__tests__/git-approval-card.test.tsx、frontend/src/components/daemon/git-approval-card.tsx、frontend/src/components/daemon/pending-dialog-dock.tsx、frontend/src/components/daemon/session-panel/session-panel-dialog.tsx、frontend/src/components/daemon/session-panel/session-panel-page.tsx、frontend/src/lib/api-types.ts、sillyhub-daemon/src/api-types.ts、sillyhub-daemon/src/interactive/git-approval-collector.ts、sillyhub-daemon/src/interactive/git-command-guard.ts、sillyhub-daemon/src/interactive/git-executor.ts、sillyhub-daemon/src/interactive/session-manager/driver-factory.ts、sillyhub-daemon/src/interactive/session-manager/permission.ts、sillyhub-daemon/tests/interactive/driver-factory-approval-wiring.test.ts、sillyhub-daemon/tests/interactive/git-approval-collector.test.ts、sillyhub-daemon/tests/interactive/git-command-guard.test.ts、sillyhub-daemon/tests/interactive/git-executor.test.ts、sillyhub-daemon/tests/interactive/session-manager-permission.test.ts、backend/app/core/db.py、backend/app/modules/daemon/agent_task_store.py、backend/app/modules/daemon/router/__init__.py、backend/app/modules/task/parser.py、docs/sillyspec/active-pitfalls.md、docs/sillyspec/finished/platform-worker-specroot-junction-dangling.md、docs/sillyspec/platform-worker-specroot-junction-dangling.md、frontend/prototype-dist/change-center.html、frontend/prototype-dist/change-detail-v2.html、frontend/prototype-dist/change-detail.html、frontend/prototype-dist/conflict-sync-states.html、frontend/prototype-dist/engine-live-perception.html、frontend/prototype-dist/explorer-git-status.html、frontend/prototype-dist/git-approval.html、frontend/prototype-dist/index.html、frontend/prototype-dist/session-config-pending.html、frontend/prototype-dist/session-fold.html、frontend/prototype-dist/session-portal.html、frontend/prototype-dist/session-stage-progress.html、frontend/prototype-dist/sillyspec-flow.html、frontend/prototype-dist/trajectory-redesign.html、frontend/prototype-dist/workspace-list.html、frontend/prototype-dist/workspace-overview.html、frontend/scripts/prototype-build.mjs、frontend/src/components/prototype/git-approval-view.tsx、sillyhub-daemon/src/host-fs-handler.ts、sillyhub-daemon/tests/host-fs-handler-worktree.test.ts

### 端点基线提示

- 端点 diff：基线 676 端点 × 现算 677 端点（method+归一 path 集合运算；changed 不配对，天然呈独立行）

| 增删 | method | path | source |
|---|---|---|---|
| + 新增 | GET | /sessions/{session_id}/git-diff | C:\Users\qinyi\IdeaProjects\multi-agent-platform\backend\app\modules\daemon\router\session_crud.py |
