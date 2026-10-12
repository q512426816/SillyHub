---
generated_at: 2026-10-12T23:04:25.539Z
sources_reconcile: 命中（ran_at=2026-10-12T15:53:05.244Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-10-12-session-defects

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

（受影响模块集为空——交付/差集文件均未命中任何模块 paths）

未匹配文件（不归属任何模块 paths，人工裁量）：backend/app/modules/daemon/agent_task_store.py、backend/app/modules/daemon/model_error.py、backend/app/modules/daemon/router/session_insights.py、backend/app/modules/daemon/run_sync/service/submit_steps.py、backend/app/modules/daemon/session/service/auto_resume.py、backend/app/modules/daemon/session/service/export.py、backend/app/modules/daemon/session/service/helpers.py、backend/app/modules/daemon/session/service/inject.py、backend/app/modules/daemon/tests/test_agent_session_tasks.py、backend/app/modules/daemon/tests/test_apply_session_terminal_status.py、backend/app/modules/daemon/tests/test_auto_recover_failed_turn.py、backend/app/modules/daemon/tests/test_close_interactive_run_model_error.py、backend/app/modules/daemon/tests/test_run_sync_submit_timestamp.py、backend/app/modules/daemon/tests/test_session_switch_config.py、backend/app/modules/daemon/tests/test_session_tasks_dedupe.py、backend/openapi.json、backend/tests/modules/daemon/test_session_export.py、docs/sillyspec/cli-cwd-coupling.md、docs/sillyspec/deps-gate-offline-fragile.md、frontend/src/components/agent-log/__tests__/run-error-item.test.tsx、frontend/src/components/agent-log/normalize.ts、frontend/src/components/agent-log/run-error-item.tsx、frontend/src/lib/api-types.ts、sillyhub-daemon/src/agent-log/message-coalescer.ts、sillyhub-daemon/src/event-wire.ts、sillyhub-daemon/src/interactive/session-manager/write-guard.ts、sillyhub-daemon/src/model-error/classifier.ts、sillyhub-daemon/src/model-error/types.ts、sillyhub-daemon/src/policy/filesystem-policy.ts、sillyhub-daemon/src/policy/path-utils.ts、sillyhub-daemon/src/policy/shell-paths.ts、sillyhub-daemon/src/types.ts、sillyhub-daemon/tests/agent-log/message-coalescer.test.ts、sillyhub-daemon/tests/event-wire-timestamp.test.ts、sillyhub-daemon/tests/event-wire.test.ts、sillyhub-daemon/tests/model-error/classifier.test.ts、sillyhub-daemon/tests/policy/filesystem-policy.test.ts、sillyhub-daemon/tests/policy/path-utils.test.ts、sillyhub-daemon/tests/policy/shell-paths.test.ts、sillyhub-daemon/tests/task-runner.test.ts、backend/app/modules/daemon/task_snapshot_dedupe.py、docs/sillyspec/cross-worktree-ghost-metadata-archive-blindspot.md、skills-lock.json

### 声明域并集（decisions.md 模块域）

（decisions.md 解析出 12 条当前版本决策，均未填写模块域——声明域为空）

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| backend/app/modules/daemon/agent_task_store.py | —（未匹配） |
| backend/app/modules/daemon/model_error.py | —（未匹配） |
| backend/app/modules/daemon/router/session_insights.py | —（未匹配） |
| backend/app/modules/daemon/run_sync/service/submit_steps.py | —（未匹配） |
| backend/app/modules/daemon/session/service/auto_resume.py | —（未匹配） |
| backend/app/modules/daemon/session/service/export.py | —（未匹配） |
| backend/app/modules/daemon/session/service/helpers.py | —（未匹配） |
| backend/app/modules/daemon/session/service/inject.py | —（未匹配） |
| backend/app/modules/daemon/tests/test_agent_session_tasks.py | —（未匹配） |
| backend/app/modules/daemon/tests/test_apply_session_terminal_status.py | —（未匹配） |
| backend/app/modules/daemon/tests/test_auto_recover_failed_turn.py | —（未匹配） |
| backend/app/modules/daemon/tests/test_close_interactive_run_model_error.py | —（未匹配） |
| backend/app/modules/daemon/tests/test_run_sync_submit_timestamp.py | —（未匹配） |
| backend/app/modules/daemon/tests/test_session_switch_config.py | —（未匹配） |
| backend/app/modules/daemon/tests/test_session_tasks_dedupe.py | —（未匹配） |
| backend/openapi.json | —（未匹配） |
| backend/tests/modules/daemon/test_session_export.py | —（未匹配） |
| docs/sillyspec/cli-cwd-coupling.md | —（未匹配） |
| docs/sillyspec/deps-gate-offline-fragile.md | —（未匹配） |
| frontend/src/components/agent-log/__tests__/run-error-item.test.tsx | —（未匹配） |
| frontend/src/components/agent-log/normalize.ts | —（未匹配） |
| frontend/src/components/agent-log/run-error-item.tsx | —（未匹配） |
| frontend/src/lib/api-types.ts | —（未匹配） |
| sillyhub-daemon/src/agent-log/message-coalescer.ts | —（未匹配） |
| sillyhub-daemon/src/event-wire.ts | —（未匹配） |
| sillyhub-daemon/src/interactive/session-manager/write-guard.ts | —（未匹配） |
| sillyhub-daemon/src/model-error/classifier.ts | —（未匹配） |
| sillyhub-daemon/src/model-error/types.ts | —（未匹配） |
| sillyhub-daemon/src/policy/filesystem-policy.ts | —（未匹配） |
| sillyhub-daemon/src/policy/path-utils.ts | —（未匹配） |
| sillyhub-daemon/src/policy/shell-paths.ts | —（未匹配） |
| sillyhub-daemon/src/types.ts | —（未匹配） |
| sillyhub-daemon/tests/agent-log/message-coalescer.test.ts | —（未匹配） |
| sillyhub-daemon/tests/event-wire-timestamp.test.ts | —（未匹配） |
| sillyhub-daemon/tests/event-wire.test.ts | —（未匹配） |
| sillyhub-daemon/tests/model-error/classifier.test.ts | —（未匹配） |
| sillyhub-daemon/tests/policy/filesystem-policy.test.ts | —（未匹配） |
| sillyhub-daemon/tests/policy/path-utils.test.ts | —（未匹配） |
| sillyhub-daemon/tests/policy/shell-paths.test.ts | —（未匹配） |
| sillyhub-daemon/tests/task-runner.test.ts | —（未匹配） |

- 对账基线：status=undeclared / form=post-apply / sources=main:status-porcelain(untracked-all)、apply-pathspec
- missing（声明未落盘）：无
- undeclared（落盘未声明，3 项）：backend/app/modules/daemon/task_snapshot_dedupe.py；docs/sillyspec/cross-worktree-ghost-metadata-archive-blindspot.md；skills-lock.json

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

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-10-12T15:40:09.606Z
- probe1：matches=0 / skippedFiles=0 / worktreeHits=0 / globEntries=0
- probe3：tasks=12 / hasTest=11
- probe5：backendEndpoints=4962 / frontendCalls=0
- probe6：deletions=0 / unavailable=false
- probe8：mispairs=0 / feOnly=0 / missingNotNull=0 / contractCount=0 / contractOrphans=0 / missingRequired=0 / feKeys=0 / backendFields=0
- probe9：javaFileCount=0 / groupCount=0 / inconsistentGroups=0
- probe10：checkedFiles=13 / unclearedFiles=0

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/lib-api.md` | 生成文件（gen:types 产物）无需模块卡更新 | skipped |
| `modules/model-error.md` | 模块卡同步（context_overflow 归类规则+错误卡，commit 4dabdc28/0841ede2） | done |
| `modules/policy.md` | 模块卡同步（flag 过滤+anchor 贯通+双拼写文案，commit e9975101） | done |
| `modules/types.md` | 模块卡同步（wire timestamp 可选字段，commit 8371e41f） | done |
| `_module-map.yaml` | 未命中文件均为既有模块内深路径，索引粒度使然，无需 rebuild | skipped |

### scan 刷新建议

- （受影响模块集为空——无重点刷新面）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：backend/app/modules/daemon/agent_task_store.py、backend/app/modules/daemon/model_error.py、backend/app/modules/daemon/router/session_insights.py、backend/app/modules/daemon/run_sync/service/submit_steps.py、backend/app/modules/daemon/session/service/auto_resume.py、backend/app/modules/daemon/session/service/export.py、backend/app/modules/daemon/session/service/helpers.py、backend/app/modules/daemon/session/service/inject.py、backend/app/modules/daemon/tests/test_agent_session_tasks.py、backend/app/modules/daemon/tests/test_apply_session_terminal_status.py、backend/app/modules/daemon/tests/test_auto_recover_failed_turn.py、backend/app/modules/daemon/tests/test_close_interactive_run_model_error.py、backend/app/modules/daemon/tests/test_run_sync_submit_timestamp.py、backend/app/modules/daemon/tests/test_session_switch_config.py、backend/app/modules/daemon/tests/test_session_tasks_dedupe.py、backend/openapi.json、backend/tests/modules/daemon/test_session_export.py、docs/sillyspec/cli-cwd-coupling.md、docs/sillyspec/deps-gate-offline-fragile.md、frontend/src/components/agent-log/__tests__/run-error-item.test.tsx、frontend/src/components/agent-log/normalize.ts、frontend/src/components/agent-log/run-error-item.tsx、frontend/src/lib/api-types.ts、sillyhub-daemon/src/agent-log/message-coalescer.ts、sillyhub-daemon/src/event-wire.ts、sillyhub-daemon/src/interactive/session-manager/write-guard.ts、sillyhub-daemon/src/model-error/classifier.ts、sillyhub-daemon/src/model-error/types.ts、sillyhub-daemon/src/policy/filesystem-policy.ts、sillyhub-daemon/src/policy/path-utils.ts、sillyhub-daemon/src/policy/shell-paths.ts、sillyhub-daemon/src/types.ts、sillyhub-daemon/tests/agent-log/message-coalescer.test.ts、sillyhub-daemon/tests/event-wire-timestamp.test.ts、sillyhub-daemon/tests/event-wire.test.ts、sillyhub-daemon/tests/model-error/classifier.test.ts、sillyhub-daemon/tests/policy/filesystem-policy.test.ts、sillyhub-daemon/tests/policy/path-utils.test.ts、sillyhub-daemon/tests/policy/shell-paths.test.ts、sillyhub-daemon/tests/task-runner.test.ts、backend/app/modules/daemon/task_snapshot_dedupe.py、docs/sillyspec/cross-worktree-ghost-metadata-archive-blindspot.md、skills-lock.json

### 端点基线提示

- 端点增删：无增删（基线 649 端点 × 现算 649 端点，method+归一 path 全一致）
