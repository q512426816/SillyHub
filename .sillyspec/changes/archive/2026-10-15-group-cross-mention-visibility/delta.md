---
generated_at: 2026-10-15T07:57:07.858Z
sources_reconcile: 命中（ran_at=2026-10-15T06:00:13.231Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-10-15-group-cross-mention-visibility

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

| 模块 | status | paths+core_files 条目数 |
|---|---|---|
| backend | active | 1 |
| frontend | active | 1 |
| sillyhub-daemon | active | 1 |
| sillyspec | active | 1 |
| docs | active | 1 |

未匹配文件（不归属任何模块 paths，人工裁量）：backend/app/modules/agent/model.py、backend/app/modules/agent/schema.py、backend/app/modules/agent/tests/test_group_chat_models.py、backend/app/modules/daemon/group/service/crud.py、backend/app/modules/daemon/group/service/delegation_notice.py、backend/app/modules/daemon/group/service/helpers.py、backend/app/modules/daemon/group/service/mentions.py、backend/app/modules/daemon/run_sync/service/group_bridge.py、backend/app/modules/daemon/tests/test_group_bridge_projection.py、backend/app/modules/daemon/tests/test_group_cross_mention.py、backend/migrations/versions/20261015120000_add_group_cross_mention_mode.py、backend/openapi.json、backend/tests/test_align_platform_change_events_migration.py、frontend/src/components/group-chat/__tests__/member-panel.test.tsx、frontend/src/components/group-chat/create-group-wizard.tsx、frontend/src/components/group-chat/member-panel.tsx、frontend/src/lib/api-types.ts、sillyhub-daemon/src/api-types.ts、.sillyspec/docs/SillyHub/modules/frontend_app.changelog.md、.sillyspec/docs/SillyHub/modules/frontend_components.changelog.md、.sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md、docs/sillyspec/execute-auto-check-misdetect.md、docs/sillyspec/finished/distill-rejected-field-late-hint.md、docs/sillyspec/finished/probe-noise-and-commit-suggest-quality.md、docs/sillyspec/finished/stage-review-dir-naming-mismatch.md、docs/sillyspec/finished/task-review-retired-archive-mismatch.md、docs/sillyspec/finished/verify-close-gate-staggered-exposure.md、docs/sillyspec/finished/wt-commit-auto-tick-unimplemented-tasks.md、docs/sillyspec/plan-module-impact-autogen-missing.md、frontend/src/components/changes/detail/change-assets-graph.tsx、frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx、frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx、frontend/src/components/daemon/__tests__/turn-timeline-scroll.test.tsx、frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts、frontend/src/components/daemon/session-panel/preview-merge.ts、frontend/src/components/daemon/session-panel/session-panel-dialog.tsx、frontend/src/components/daemon/session-panel/session-panel-page.tsx、frontend/src/components/daemon/turn-timeline.tsx、frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx、frontend/src/components/sessions/__tests__/session-list-panel.test.tsx、frontend/src/components/sessions/__tests__/sessions-portal.test.tsx、frontend/src/lib/__tests__/knowledge-graph-guard.test.ts、frontend/src/lib/knowledge.ts

### 声明域并集（decisions.md 模块域）

（decisions.md 解析出 11 条当前版本决策，均未填写模块域——声明域为空）

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| backend/app/modules/agent/model.py | —（未匹配） |
| backend/app/modules/agent/schema.py | —（未匹配） |
| backend/app/modules/agent/tests/test_group_chat_models.py | —（未匹配） |
| backend/app/modules/daemon/group/service/crud.py | —（未匹配） |
| backend/app/modules/daemon/group/service/delegation_notice.py | —（未匹配） |
| backend/app/modules/daemon/group/service/helpers.py | —（未匹配） |
| backend/app/modules/daemon/group/service/mentions.py | —（未匹配） |
| backend/app/modules/daemon/run_sync/service/group_bridge.py | —（未匹配） |
| backend/app/modules/daemon/tests/test_group_bridge_projection.py | —（未匹配） |
| backend/app/modules/daemon/tests/test_group_cross_mention.py | —（未匹配） |
| backend/migrations/versions/20261015120000_add_group_cross_mention_mode.py | —（未匹配） |
| backend/openapi.json | —（未匹配） |
| backend/tests/test_align_platform_change_events_migration.py | —（未匹配） |
| frontend/src/components/group-chat/__tests__/member-panel.test.tsx | —（未匹配） |
| frontend/src/components/group-chat/create-group-wizard.tsx | —（未匹配） |
| frontend/src/components/group-chat/member-panel.tsx | —（未匹配） |
| frontend/src/lib/api-types.ts | —（未匹配） |
| sillyhub-daemon/src/api-types.ts | —（未匹配） |

- 对账基线：status=undeclared / form=worktree / sources=worktree:diff-base..HEAD、worktree:status-porcelain(uncommitted)
- missing（声明未落盘）：无
- undeclared（落盘未声明，25 项）：.sillyspec/docs/SillyHub/modules/frontend_app.changelog.md；.sillyspec/docs/SillyHub/modules/frontend_components.changelog.md；.sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md；docs/sillyspec/execute-auto-check-misdetect.md；docs/sillyspec/finished/distill-rejected-field-late-hint.md；docs/sillyspec/finished/probe-noise-and-commit-suggest-quality.md；docs/sillyspec/finished/stage-review-dir-naming-mismatch.md；docs/sillyspec/finished/task-review-retired-archive-mismatch.md；docs/sillyspec/finished/verify-close-gate-staggered-exposure.md；docs/sillyspec/finished/wt-commit-auto-tick-unimplemented-tasks.md；docs/sillyspec/plan-module-impact-autogen-missing.md；frontend/src/components/changes/detail/change-assets-graph.tsx；frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx；frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx；frontend/src/components/daemon/__tests__/turn-timeline-scroll.test.tsx；frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts；frontend/src/components/daemon/session-panel/preview-merge.ts；frontend/src/components/daemon/session-panel/session-panel-dialog.tsx；frontend/src/components/daemon/session-panel/session-panel-page.tsx；frontend/src/components/daemon/turn-timeline.tsx；frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx（疑似归因 task-04）；frontend/src/components/sessions/__tests__/session-list-panel.test.tsx（疑似归因 task-04）；frontend/src/components/sessions/__tests__/sessions-portal.test.tsx（疑似归因 task-04）；frontend/src/lib/__tests__/knowledge-graph-guard.test.ts；frontend/src/lib/knowledge.ts

### 决策清单（id × 模块域）

| 决策 | 模块域 |
|---|---|
| D-001@v1 | （未填写） |
| D-002@v1 | （未填写） |
| D-003@v1 | （未填写） |
| D-004@v2 | （未填写） |
| D-005@v1 | （未填写） |
| D-006@v1 | （未填写） |
| D-007@v2 | （未填写） |
| D-008@v1 | （未填写） |
| D-009@v1 | （未填写） |
| D-010@v1 | （未填写） |
| D-011@v1 | （未填写） |

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-10-15T05:19:43.008Z
- probe1：matches=0 / skippedFiles=1 / worktreeHits=1 / globEntries=0
- probe3：tasks=4 / hasTest=4
- probe5：backendEndpoints=3049 / frontendCalls=0
- probe6：deletions=6 / unavailable=false
- probe8：mispairs=0 / feOnly=0 / missingNotNull=0 / contractCount=0 / contractOrphans=0 / missingRequired=0 / feKeys=0 / backendFields=0
- probe9：javaFileCount=0 / groupCount=0 / inconsistentGroups=0
- probe10：checkedFiles=5 / unclearedFiles=0

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/api-types.md` | 更新api-types模块卡（本次变更涉及） | done（gen:types 再生成为机械产物，模块卡描述的再生成流程未变，无需改卡） |
| `modules/lib-api.md` | 更新lib-api模块卡（本次变更涉及） | done（同上） |
| `_module-map.yaml` | 未匹配文件均为群聊子域文件（backend daemon/group 子域+frontend group-chat 组件），module-map 按子项目级粒度索引、无群聊模块条目——群聊功能跨 2026-09 起多个变更均未建模块条目，维持现状不为本变更单建（modules rebuild 留给群聊模块化整理时统一处理） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

### scan 刷新建议

- `sillyspec scan facts` 下次刷新重点关注：backend、frontend、sillyhub-daemon、sillyspec、docs（共 5 个模块）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：backend/app/modules/agent/model.py、backend/app/modules/agent/schema.py、backend/app/modules/agent/tests/test_group_chat_models.py、backend/app/modules/daemon/group/service/crud.py、backend/app/modules/daemon/group/service/delegation_notice.py、backend/app/modules/daemon/group/service/helpers.py、backend/app/modules/daemon/group/service/mentions.py、backend/app/modules/daemon/run_sync/service/group_bridge.py、backend/app/modules/daemon/tests/test_group_bridge_projection.py、backend/app/modules/daemon/tests/test_group_cross_mention.py、backend/migrations/versions/20261015120000_add_group_cross_mention_mode.py、backend/openapi.json、backend/tests/test_align_platform_change_events_migration.py、frontend/src/components/group-chat/__tests__/member-panel.test.tsx、frontend/src/components/group-chat/create-group-wizard.tsx、frontend/src/components/group-chat/member-panel.tsx、frontend/src/lib/api-types.ts、sillyhub-daemon/src/api-types.ts、.sillyspec/docs/SillyHub/modules/frontend_app.changelog.md、.sillyspec/docs/SillyHub/modules/frontend_components.changelog.md、.sillyspec/docs/multi-agent-platform/modules/frontend.changelog.md、docs/sillyspec/execute-auto-check-misdetect.md、docs/sillyspec/finished/distill-rejected-field-late-hint.md、docs/sillyspec/finished/probe-noise-and-commit-suggest-quality.md、docs/sillyspec/finished/stage-review-dir-naming-mismatch.md、docs/sillyspec/finished/task-review-retired-archive-mismatch.md、docs/sillyspec/finished/verify-close-gate-staggered-exposure.md、docs/sillyspec/finished/wt-commit-auto-tick-unimplemented-tasks.md、docs/sillyspec/plan-module-impact-autogen-missing.md、frontend/src/components/changes/detail/change-assets-graph.tsx、frontend/src/components/daemon/__tests__/session-preview-integration.test.tsx、frontend/src/components/daemon/__tests__/turn-preview-card.test.tsx、frontend/src/components/daemon/__tests__/turn-timeline-scroll.test.tsx、frontend/src/components/daemon/session-panel/__tests__/preview-merge.test.ts、frontend/src/components/daemon/session-panel/preview-merge.ts、frontend/src/components/daemon/session-panel/session-panel-dialog.tsx、frontend/src/components/daemon/session-panel/session-panel-page.tsx、frontend/src/components/daemon/turn-timeline.tsx、frontend/src/components/sessions/__tests__/create-group-wizard.test.tsx、frontend/src/components/sessions/__tests__/session-list-panel.test.tsx、frontend/src/components/sessions/__tests__/sessions-portal.test.tsx、frontend/src/lib/__tests__/knowledge-graph-guard.test.ts、frontend/src/lib/knowledge.ts

### 端点基线提示

- 无基线（变更未拍 baseline）：C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\endpoint-baselines\2026-10-15-group-cross-mention-visibility.json 不存在或不可解析——端点增删不可比（backendEndpoints=3049（>0））
