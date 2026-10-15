---
generated_at: 2026-10-15T18:12:42.337Z
sources_reconcile: 命中（ran_at=2026-10-15T18:04:51.954Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-10-15-change-detail-redesign

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

| 模块 | status | paths+core_files 条目数 |
|---|---|---|
| frontend | active | 1 |
| docs | active | 1 |

未匹配文件（不归属任何模块 paths，人工裁量）：frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-tabs.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx、frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx、frontend/src/components/changes/detail/__tests__/change-assets-fallback.test.tsx、frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx、frontend/src/components/changes/detail/__tests__/change-files-panel.test.tsx、frontend/src/components/changes/detail/__tests__/change-overview-panel.test.tsx、frontend/src/components/changes/detail/__tests__/change-overview-side.test.tsx、frontend/src/components/changes/detail/__tests__/change-tabs.test.tsx、frontend/src/components/changes/detail/__tests__/change-task-checklist.test.tsx、frontend/src/components/changes/detail/__tests__/change-unified-timeline.test.tsx、frontend/src/components/changes/detail/__tests__/merge-change-timeline.test.ts、frontend/src/components/changes/detail/change-assets-card.tsx、frontend/src/components/changes/detail/change-assets-graph.tsx、frontend/src/components/changes/detail/change-files-panel.tsx、frontend/src/components/changes/detail/change-overview-panel.tsx、frontend/src/components/changes/detail/change-overview-side.tsx、frontend/src/components/changes/detail/change-tabs.tsx、frontend/src/components/changes/detail/change-task-checklist.tsx、frontend/src/components/changes/detail/change-unified-timeline.tsx、frontend/src/components/changes/detail/change-usage-card.tsx、frontend/src/components/changes/detail/merge-change-timeline.ts、docs/releases/2026-10-16-003-09bc9e15d.md、frontend/prototype-dist/change-center.html、frontend/prototype-dist/change-detail-v2.html、frontend/prototype-dist/change-detail.html、frontend/prototype-dist/index.html、frontend/prototype-dist/session-portal.html、frontend/prototype-dist/sillyspec-flow.html、frontend/prototype-dist/workspace-list.html、frontend/prototype-dist/workspace-overview.html

### 声明域并集（decisions.md 模块域）

frontend

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx | —（未匹配） |
| frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx | —（未匹配） |
| frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-tabs.test.tsx | —（未匹配） |
| frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx | —（未匹配） |
| frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx | —（未匹配） |
| frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx | —（未匹配） |
| frontend/src/components/changes/detail/__tests__/change-assets-fallback.test.tsx | —（未匹配） |
| frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx | —（未匹配） |
| frontend/src/components/changes/detail/__tests__/change-files-panel.test.tsx | —（未匹配） |
| frontend/src/components/changes/detail/__tests__/change-overview-panel.test.tsx | —（未匹配） |
| frontend/src/components/changes/detail/__tests__/change-overview-side.test.tsx | —（未匹配） |
| frontend/src/components/changes/detail/__tests__/change-tabs.test.tsx | —（未匹配） |
| frontend/src/components/changes/detail/__tests__/change-task-checklist.test.tsx | —（未匹配） |
| frontend/src/components/changes/detail/__tests__/change-unified-timeline.test.tsx | —（未匹配） |
| frontend/src/components/changes/detail/__tests__/merge-change-timeline.test.ts | —（未匹配） |
| frontend/src/components/changes/detail/change-assets-card.tsx | —（未匹配） |
| frontend/src/components/changes/detail/change-assets-graph.tsx | —（未匹配） |
| frontend/src/components/changes/detail/change-files-panel.tsx | —（未匹配） |
| frontend/src/components/changes/detail/change-overview-panel.tsx | —（未匹配） |
| frontend/src/components/changes/detail/change-overview-side.tsx | —（未匹配） |
| frontend/src/components/changes/detail/change-tabs.tsx | —（未匹配） |
| frontend/src/components/changes/detail/change-task-checklist.tsx | —（未匹配） |
| frontend/src/components/changes/detail/change-unified-timeline.tsx | —（未匹配） |
| frontend/src/components/changes/detail/change-usage-card.tsx | —（未匹配） |
| frontend/src/components/changes/detail/merge-change-timeline.ts | —（未匹配） |

- 对账基线：status=undeclared / form=worktree / sources=worktree:diff-base..HEAD、worktree:status-porcelain(uncommitted)
- missing（声明未落盘）：无
- undeclared（落盘未声明，9 项）：docs/releases/2026-10-16-003-09bc9e15d.md；frontend/prototype-dist/change-center.html；frontend/prototype-dist/change-detail-v2.html；frontend/prototype-dist/change-detail.html；frontend/prototype-dist/index.html；frontend/prototype-dist/session-portal.html；frontend/prototype-dist/sillyspec-flow.html；frontend/prototype-dist/workspace-list.html；frontend/prototype-dist/workspace-overview.html

### 决策清单（id × 模块域）

| 决策 | 模块域 |
|---|---|
| D-001@v1 | frontend |
| D-002@v1 | frontend |
| D-003@v1 | frontend |
| D-004@v1 | frontend |
| D-005@v1 | frontend |
| D-006@v1 | frontend |
| D-007@v1 | frontend |
| D-008@v1 | frontend |
| D-009@v1 | frontend |
| D-010@v1 | frontend |
| D-011@v1 | frontend |
| D-012@v1 | frontend |
| D-013@v1 | frontend |
| D-014@v1 | frontend |
| D-015@v1 | frontend |
| D-016@v1 | frontend |
| D-017@v1 | frontend |
| D-018@v1 | frontend |

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-10-15T17:56:33.449Z
- probe1：matches=0 / skippedFiles=0 / worktreeHits=15 / globEntries=5
- probe3：tasks=8 / hasTest=4
- probe5：backendEndpoints=1094 / frontendCalls=0
- probe6：deletions=0 / unavailable=false
- probe8：mispairs=0 / feOnly=0 / missingNotNull=0 / contractCount=0 / contractOrphans=0 / missingRequired=0 / feKeys=0 / backendFields=0
- probe9：javaFileCount=0 / groupCount=0 / inconsistentGroups=0
- probe10：checkedFiles=9 / unclearedFiles=0

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/app-workspace-pages.md` | 更新app-workspace-pages模块卡（本次变更涉及） | done（同上；变更详情页四 tab 结构） |
| `modules/components-changes.md` | 更新components-changes模块卡（本次变更涉及） | done（同上；新增 detail 组件族 7 件 + 测试 8 件） |
| `modules/frontend.md` | 更新frontend模块卡（本次变更涉及） | done（module-docs-sync 已同步 sidecar + updated_at 戳） |
| `_module-map.yaml` | 无变化（未增删模块） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

### scan 刷新建议

- `sillyspec scan facts` 下次刷新重点关注：frontend、docs（共 2 个模块）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-last-signal.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-restore-assets.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-tabs.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/__tests__/page-team-toggle.test.tsx、frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx、frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx、frontend/src/components/changes/detail/__tests__/change-assets-fallback.test.tsx、frontend/src/components/changes/detail/__tests__/change-assets-graph.test.tsx、frontend/src/components/changes/detail/__tests__/change-files-panel.test.tsx、frontend/src/components/changes/detail/__tests__/change-overview-panel.test.tsx、frontend/src/components/changes/detail/__tests__/change-overview-side.test.tsx、frontend/src/components/changes/detail/__tests__/change-tabs.test.tsx、frontend/src/components/changes/detail/__tests__/change-task-checklist.test.tsx、frontend/src/components/changes/detail/__tests__/change-unified-timeline.test.tsx、frontend/src/components/changes/detail/__tests__/merge-change-timeline.test.ts、frontend/src/components/changes/detail/change-assets-card.tsx、frontend/src/components/changes/detail/change-assets-graph.tsx、frontend/src/components/changes/detail/change-files-panel.tsx、frontend/src/components/changes/detail/change-overview-panel.tsx、frontend/src/components/changes/detail/change-overview-side.tsx、frontend/src/components/changes/detail/change-tabs.tsx、frontend/src/components/changes/detail/change-task-checklist.tsx、frontend/src/components/changes/detail/change-unified-timeline.tsx、frontend/src/components/changes/detail/change-usage-card.tsx、frontend/src/components/changes/detail/merge-change-timeline.ts、docs/releases/2026-10-16-003-09bc9e15d.md、frontend/prototype-dist/change-center.html、frontend/prototype-dist/change-detail-v2.html、frontend/prototype-dist/change-detail.html、frontend/prototype-dist/index.html、frontend/prototype-dist/session-portal.html、frontend/prototype-dist/sillyspec-flow.html、frontend/prototype-dist/workspace-list.html、frontend/prototype-dist/workspace-overview.html

### 端点基线提示

- 无基线（变更未拍 baseline）：C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\endpoint-baselines\2026-10-15-change-detail-redesign.json 不存在或不可解析——端点增删不可比（backendEndpoints=1094（>0））
