---
generated_at: 2026-09-12T10:37:59.238Z
sources_reconcile: 命中（ran_at=2026-09-12T10:30:55.935Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-09-12-chat-turn-auto-recovery

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

（受影响模块集为空——交付/差集文件均未命中任何模块 paths）

未匹配文件（不归属任何模块 paths，人工裁量）：.sillyspec/docs/backend/modules/daemon.md、.sillyspec/docs/backend/modules/migrations.md、.sillyspec/docs/frontend/modules/components-agent-log.md、.sillyspec/docs/frontend/modules/components-daemon.md、.sillyspec/docs/sillyhub-daemon/modules/interactive.md、.sillyspec/docs/sillyhub-daemon/modules/model-error.md、backend/app/modules/agent/model.py、backend/app/modules/daemon/model_error.py、backend/app/modules/daemon/router/session_queue.py、backend/app/modules/daemon/run_sync/service/close_run_steps.py、backend/app/modules/daemon/scheduled_send.py、backend/app/modules/daemon/schema.py、backend/app/modules/daemon/session/service/auto_resume.py、backend/app/modules/daemon/session/service/inject.py、backend/app/modules/daemon/session/service/queue.py、backend/app/modules/daemon/tests/test_auto_recover_failed_turn.py、backend/app/modules/daemon/tests/test_auto_recover_integration.py、backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py、backend/migrations/versions/20260912110000_add_scheduled_message_origin.py、backend/openapi.json、frontend/src/components/agent-log/__tests__/run-error-item.test.tsx、frontend/src/components/agent-log/run-error-item.tsx、frontend/src/components/daemon/scheduled-messages-bar.tsx、frontend/src/components/daemon/session-panel/session-panel-dialog.tsx、frontend/src/components/daemon/session-panel/session-panel-page.tsx、frontend/src/components/daemon/turn-timeline.tsx、frontend/src/lib/api-types.ts、sillyhub-daemon/src/daemon.ts、sillyhub-daemon/src/interactive/pi-rpc-driver.ts、sillyhub-daemon/src/model-error/classifier.ts、sillyhub-daemon/src/model-error/types.ts、sillyhub-daemon/tests/interactive/pi-rpc-driver-turn-result.test.ts、sillyhub-daemon/tests/model-error/classifier.test.ts、.sillyspec/docs/SillyHub/modules/daemon.changelog.md、.sillyspec/docs/SillyHub/modules/frontend_components.md、.sillyspec/docs/SillyHub/modules/frontend_lib.md、backend/app/modules/daemon/router/session_insights.py、backend/app/modules/daemon/run_sync/service/__init__.py、backend/app/modules/daemon/session/service/__init__.py、backend/app/modules/daemon/tests/test_auth_transient_autoretry.py、backend/app/modules/daemon/tests/test_session_runs_endpoint.py、docs/sillyspec/agent-log-ctx-attribution-mismatch.md、docs/sillyspec/conflict-compare-wrong-status-root.md、docs/sillyspec/docs-gate-shared-worktree-parallel-block.md、docs/sillyspec/finished/agent-log-ctx-attribution-mismatch.md、docs/sillyspec/finished/agent-log-hub-attribution-cross-session-contamination.md、docs/sillyspec/finished/conflict-compare-wrong-status-root.md、docs/sillyspec/finished/docs-gate-shared-worktree-parallel-block.md、docs/sillyspec/finished/platform-spec-junction-migration-split.md、docs/sillyspec/finished/platform-sync-progress-rollback-and-db-corruption.md、docs/sillyspec/finished/pre-commit-autofix-swallows-commit.md、docs/sillyspec/platform-spec-junction-migration-split.md、docs/sillyspec/platform-sync-progress-rollback-and-db-corruption.md、docs/sillyspec/pre-commit-autofix-swallows-commit.md、frontend/src/components/agent-log/__tests__/normalize.test.ts、frontend/src/components/agent-log/normalize.ts、frontend/src/components/daemon/__tests__/scheduled-messages-bar.test.tsx、frontend/src/components/daemon/__tests__/task-execution-panel.test.tsx、frontend/src/components/daemon/__tests__/turn-timeline-auto-recover.test.ts、frontend/src/components/daemon/task-execution-panel.tsx、frontend/src/hooks/use-message-queue.ts、frontend/src/hooks/use-scheduled-messages.ts、frontend/src/lib/daemon/session-queue.ts、frontend/src/lib/daemon/sessions.ts、scripts/migrate-spec-junction.mjs、sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts

### 声明域并集（decisions.md 模块域）

（decisions.md 解析出 0 条当前版本决策，均未填写模块域——声明域为空）

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| .sillyspec/docs/backend/modules/daemon.md | —（未匹配） |
| .sillyspec/docs/backend/modules/migrations.md | —（未匹配） |
| .sillyspec/docs/frontend/modules/components-agent-log.md | —（未匹配） |
| .sillyspec/docs/frontend/modules/components-daemon.md | —（未匹配） |
| .sillyspec/docs/sillyhub-daemon/modules/interactive.md | —（未匹配） |
| .sillyspec/docs/sillyhub-daemon/modules/model-error.md | —（未匹配） |
| backend/app/modules/agent/model.py | —（未匹配） |
| backend/app/modules/daemon/model_error.py | —（未匹配） |
| backend/app/modules/daemon/router/session_queue.py | —（未匹配） |
| backend/app/modules/daemon/run_sync/service/close_run_steps.py | —（未匹配） |
| backend/app/modules/daemon/scheduled_send.py | —（未匹配） |
| backend/app/modules/daemon/schema.py | —（未匹配） |
| backend/app/modules/daemon/session/service/auto_resume.py | —（未匹配） |
| backend/app/modules/daemon/session/service/inject.py | —（未匹配） |
| backend/app/modules/daemon/session/service/queue.py | —（未匹配） |
| backend/app/modules/daemon/tests/test_auto_recover_failed_turn.py | —（未匹配） |
| backend/app/modules/daemon/tests/test_auto_recover_integration.py | —（未匹配） |
| backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | —（未匹配） |
| backend/migrations/versions/20260912110000_add_scheduled_message_origin.py | —（未匹配） |
| backend/openapi.json | —（未匹配） |
| frontend/src/components/agent-log/__tests__/run-error-item.test.tsx | —（未匹配） |
| frontend/src/components/agent-log/run-error-item.tsx | —（未匹配） |
| frontend/src/components/daemon/scheduled-messages-bar.tsx | —（未匹配） |
| frontend/src/components/daemon/session-panel/session-panel-dialog.tsx | —（未匹配） |
| frontend/src/components/daemon/session-panel/session-panel-page.tsx | —（未匹配） |
| frontend/src/components/daemon/turn-timeline.tsx | —（未匹配） |
| frontend/src/lib/api-types.ts | —（未匹配） |
| sillyhub-daemon/src/daemon.ts | —（未匹配） |
| sillyhub-daemon/src/interactive/pi-rpc-driver.ts | —（未匹配） |
| sillyhub-daemon/src/model-error/classifier.ts | —（未匹配） |
| sillyhub-daemon/src/model-error/types.ts | —（未匹配） |
| sillyhub-daemon/tests/interactive/pi-rpc-driver-turn-result.test.ts | —（未匹配） |
| sillyhub-daemon/tests/model-error/classifier.test.ts | —（未匹配） |

- 对账基线：status=undeclared / form=worktree / sources=worktree:diff-base..HEAD、worktree:status-porcelain(uncommitted)
- missing（声明未落盘）：无
- undeclared（落盘未声明，33 项）：.sillyspec/docs/SillyHub/modules/daemon.changelog.md；.sillyspec/docs/SillyHub/modules/frontend_components.md；.sillyspec/docs/SillyHub/modules/frontend_lib.md；backend/app/modules/daemon/router/session_insights.py；backend/app/modules/daemon/run_sync/service/__init__.py（疑似归因 task-04）；backend/app/modules/daemon/session/service/__init__.py（疑似归因 task-05）；backend/app/modules/daemon/tests/test_auth_transient_autoretry.py（疑似归因 task-04）；backend/app/modules/daemon/tests/test_session_runs_endpoint.py（疑似归因 task-07）；docs/sillyspec/agent-log-ctx-attribution-mismatch.md；docs/sillyspec/conflict-compare-wrong-status-root.md；docs/sillyspec/docs-gate-shared-worktree-parallel-block.md；docs/sillyspec/finished/agent-log-ctx-attribution-mismatch.md；docs/sillyspec/finished/agent-log-hub-attribution-cross-session-contamination.md；docs/sillyspec/finished/conflict-compare-wrong-status-root.md；docs/sillyspec/finished/docs-gate-shared-worktree-parallel-block.md；docs/sillyspec/finished/platform-spec-junction-migration-split.md；docs/sillyspec/finished/platform-sync-progress-rollback-and-db-corruption.md；docs/sillyspec/finished/pre-commit-autofix-swallows-commit.md；docs/sillyspec/platform-spec-junction-migration-split.md；docs/sillyspec/platform-sync-progress-rollback-and-db-corruption.md；docs/sillyspec/pre-commit-autofix-swallows-commit.md；frontend/src/components/agent-log/__tests__/normalize.test.ts（疑似归因 task-06）；frontend/src/components/agent-log/normalize.ts（疑似归因 task-06）；frontend/src/components/daemon/__tests__/scheduled-messages-bar.test.tsx（疑似归因 task-06）；frontend/src/components/daemon/__tests__/task-execution-panel.test.tsx；frontend/src/components/daemon/__tests__/turn-timeline-auto-recover.test.ts（疑似归因 task-06）；frontend/src/components/daemon/task-execution-panel.tsx；frontend/src/hooks/use-message-queue.ts（疑似归因 task-06）；frontend/src/hooks/use-scheduled-messages.ts（疑似归因 task-06）；frontend/src/lib/daemon/session-queue.ts（疑似归因 task-06）；frontend/src/lib/daemon/sessions.ts；scripts/migrate-spec-junction.mjs；sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts（疑似归因 task-02）

### 决策清单（id × 模块域）

（decisions.md 无当前版本 D 条目——决策清单为空）

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-09-12T10:01:20.283Z
- probe1：matches=0 / skippedFiles=2 / worktreeHits=0 / globEntries=0
- probe3：tasks=7 / hasTest=7
- probe5：backendEndpoints=2783 / frontendCalls=0
- probe6：deletions=5 / unavailable=false

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml` | skipped：终审判定无需增改——未匹配文件均为既有模块存量路径（索引粒度现象非游离文件）；本变更未触碰该文件（diff 无此文件，核对一致） | skipped |
| sillyhub-daemon/modules/model-error.md | 增量段落（泛化/断流关键词/resetAt） | done |
| sillyhub-daemon/modules/interactive.md | 增量段落（静默检测两入口与判定） | done |
| backend/modules/daemon.md | 增量段落（三分支恢复+派发链+origin 列） | done |
| backend/modules/migrations.md | 20260912110000 条目 | done |
| frontend/modules/components-daemon.md | 增量段落（双信号/数据上提/徽标） | done |
| frontend/modules/components-agent-log.md | 增量段落（reset_at/autoRecoverHint 链序） | done |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

### scan 刷新建议

- （受影响模块集为空——无重点刷新面）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：.sillyspec/docs/backend/modules/daemon.md、.sillyspec/docs/backend/modules/migrations.md、.sillyspec/docs/frontend/modules/components-agent-log.md、.sillyspec/docs/frontend/modules/components-daemon.md、.sillyspec/docs/sillyhub-daemon/modules/interactive.md、.sillyspec/docs/sillyhub-daemon/modules/model-error.md、backend/app/modules/agent/model.py、backend/app/modules/daemon/model_error.py、backend/app/modules/daemon/router/session_queue.py、backend/app/modules/daemon/run_sync/service/close_run_steps.py、backend/app/modules/daemon/scheduled_send.py、backend/app/modules/daemon/schema.py、backend/app/modules/daemon/session/service/auto_resume.py、backend/app/modules/daemon/session/service/inject.py、backend/app/modules/daemon/session/service/queue.py、backend/app/modules/daemon/tests/test_auto_recover_failed_turn.py、backend/app/modules/daemon/tests/test_auto_recover_integration.py、backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py、backend/migrations/versions/20260912110000_add_scheduled_message_origin.py、backend/openapi.json、frontend/src/components/agent-log/__tests__/run-error-item.test.tsx、frontend/src/components/agent-log/run-error-item.tsx、frontend/src/components/daemon/scheduled-messages-bar.tsx、frontend/src/components/daemon/session-panel/session-panel-dialog.tsx、frontend/src/components/daemon/session-panel/session-panel-page.tsx、frontend/src/components/daemon/turn-timeline.tsx、frontend/src/lib/api-types.ts、sillyhub-daemon/src/daemon.ts、sillyhub-daemon/src/interactive/pi-rpc-driver.ts、sillyhub-daemon/src/model-error/classifier.ts、sillyhub-daemon/src/model-error/types.ts、sillyhub-daemon/tests/interactive/pi-rpc-driver-turn-result.test.ts、sillyhub-daemon/tests/model-error/classifier.test.ts、.sillyspec/docs/SillyHub/modules/daemon.changelog.md、.sillyspec/docs/SillyHub/modules/frontend_components.md、.sillyspec/docs/SillyHub/modules/frontend_lib.md、backend/app/modules/daemon/router/session_insights.py、backend/app/modules/daemon/run_sync/service/__init__.py、backend/app/modules/daemon/session/service/__init__.py、backend/app/modules/daemon/tests/test_auth_transient_autoretry.py、backend/app/modules/daemon/tests/test_session_runs_endpoint.py、docs/sillyspec/agent-log-ctx-attribution-mismatch.md、docs/sillyspec/conflict-compare-wrong-status-root.md、docs/sillyspec/docs-gate-shared-worktree-parallel-block.md、docs/sillyspec/finished/agent-log-ctx-attribution-mismatch.md、docs/sillyspec/finished/agent-log-hub-attribution-cross-session-contamination.md、docs/sillyspec/finished/conflict-compare-wrong-status-root.md、docs/sillyspec/finished/docs-gate-shared-worktree-parallel-block.md、docs/sillyspec/finished/platform-spec-junction-migration-split.md、docs/sillyspec/finished/platform-sync-progress-rollback-and-db-corruption.md、docs/sillyspec/finished/pre-commit-autofix-swallows-commit.md、docs/sillyspec/platform-spec-junction-migration-split.md、docs/sillyspec/platform-sync-progress-rollback-and-db-corruption.md、docs/sillyspec/pre-commit-autofix-swallows-commit.md、frontend/src/components/agent-log/__tests__/normalize.test.ts、frontend/src/components/agent-log/normalize.ts、frontend/src/components/daemon/__tests__/scheduled-messages-bar.test.tsx、frontend/src/components/daemon/__tests__/task-execution-panel.test.tsx、frontend/src/components/daemon/__tests__/turn-timeline-auto-recover.test.ts、frontend/src/components/daemon/task-execution-panel.tsx、frontend/src/hooks/use-message-queue.ts、frontend/src/hooks/use-scheduled-messages.ts、frontend/src/lib/daemon/session-queue.ts、frontend/src/lib/daemon/sessions.ts、scripts/migrate-spec-junction.mjs、sillyhub-daemon/tests/interactive/pi-rpc-driver.test.ts

### 端点基线提示

- 无基线（变更未拍 baseline）：C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\endpoint-baselines\2026-09-12-chat-turn-auto-recovery.json 不存在或不可解析——端点增删不可比（backendEndpoints=2783（>0））
