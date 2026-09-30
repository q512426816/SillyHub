---
generated_at: 2026-09-30T06:44:31.315Z
sources_reconcile: 命中（ran_at=2026-09-30T06:11:28.627Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-09-30-tool-report-activation-wrong-machine

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

（受影响模块集为空——交付/差集文件均未命中任何模块 paths）

未匹配文件（不归属任何模块 paths，人工裁量）：backend/app/modules/daemon/router/heartbeat.py、backend/app/modules/daemon/router/session_crud.py、backend/app/modules/daemon/schema.py、backend/app/modules/daemon/session/service/helpers.py、backend/app/modules/daemon/session/service/inject.py、backend/app/modules/daemon/session/service/ppm_activation.py、backend/app/modules/daemon/session/service/takeover.py、backend/app/modules/daemon/tests/test_takeover.py、backend/app/modules/daemon/tests/test_takeover_handoff.py、backend/app/modules/platform_sync/model.py、backend/app/modules/platform_sync/schema.py、backend/app/modules/platform_sync/service.py、backend/app/modules/platform_sync/tests/test_agent_log_machine.py、docs/platform-agent-log-protocol.md、frontend/src/components/daemon/__tests__/session-panel-takeover.test.tsx、frontend/src/components/daemon/session-panel/page-helpers.tsx、frontend/src/components/daemon/session-panel/session-panel-page.tsx、frontend/src/lib/api-types.ts、sillyhub-daemon/src/config.ts、sillyhub-daemon/src/daemon.ts、sillyhub-daemon/src/hub-client.ts、backend/app/modules/daemon/router/__init__.py、backend/app/modules/daemon/session/service/__init__.py、backend/app/modules/daemon/tests/test_heartbeat_machine_id.py、backend/app/modules/daemon/tests/test_session_optimize_round2.py、backend/app/modules/daemon/tests/test_tool_report_activation.py、backend/migrations/versions/20260930110000_tool_report_machine.py、backend/openapi.json、frontend/src/components/daemon/session-panel/takeover-bridge-note.tsx、frontend/src/lib/daemon/sessions.ts、sillyhub-daemon/tests/config-machine-id.test.ts、sillyhub-daemon/tests/daemon-heartbeat-pending.test.ts、sillyhub-daemon/tests/daemon-heartbeat-sillyspec.test.ts

### 声明域并集（decisions.md 模块域）

backend

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| backend/app/modules/daemon/router/heartbeat.py | —（未匹配） |
| backend/app/modules/daemon/router/session_crud.py | —（未匹配） |
| backend/app/modules/daemon/schema.py | —（未匹配） |
| backend/app/modules/daemon/session/service/helpers.py | —（未匹配） |
| backend/app/modules/daemon/session/service/inject.py | —（未匹配） |
| backend/app/modules/daemon/session/service/ppm_activation.py | —（未匹配） |
| backend/app/modules/daemon/session/service/takeover.py | —（未匹配） |
| backend/app/modules/daemon/tests/test_takeover.py | —（未匹配） |
| backend/app/modules/daemon/tests/test_takeover_handoff.py | —（未匹配） |
| backend/app/modules/platform_sync/model.py | —（未匹配） |
| backend/app/modules/platform_sync/schema.py | —（未匹配） |
| backend/app/modules/platform_sync/service.py | —（未匹配） |
| backend/app/modules/platform_sync/tests/test_agent_log_machine.py | —（未匹配） |
| docs/platform-agent-log-protocol.md | —（未匹配） |
| frontend/src/components/daemon/__tests__/session-panel-takeover.test.tsx | —（未匹配） |
| frontend/src/components/daemon/session-panel/page-helpers.tsx | —（未匹配） |
| frontend/src/components/daemon/session-panel/session-panel-page.tsx | —（未匹配） |
| frontend/src/lib/api-types.ts | —（未匹配） |
| sillyhub-daemon/src/config.ts | —（未匹配） |
| sillyhub-daemon/src/daemon.ts | —（未匹配） |
| sillyhub-daemon/src/hub-client.ts | —（未匹配） |

- 对账基线：status=missing_declared / form=worktree / sources=worktree:diff-base..HEAD、worktree:status-porcelain(uncommitted)
- missing（声明未落盘，4 项）：task-01：backend/migrations/versions/2026xxxx_tool_report_machine.py（NEW: 声明，路径已剥前缀）；task-04：backend/app/modules/daemon/session/service/fork.py；task-07：frontend/src/lib/takeover.ts（NEW: 声明，路径已剥前缀）；task-07：frontend/src/lib/agent-logs.ts
- undeclared（落盘未声明，12 项）：backend/app/modules/daemon/router/__init__.py；backend/app/modules/daemon/session/service/__init__.py（疑似归因 task-06）；backend/app/modules/daemon/tests/test_heartbeat_machine_id.py（疑似归因 task-02、task-04、task-05、task-06）；backend/app/modules/daemon/tests/test_session_optimize_round2.py（疑似归因 task-06）；backend/app/modules/daemon/tests/test_tool_report_activation.py（疑似归因 task-06）；backend/migrations/versions/20260930110000_tool_report_machine.py（疑似归因 task-01）；backend/openapi.json（疑似归因 task-13、task-04、task-05、task-09、task-07、task-03、task-06、task-11、task-08、task-01、task-15、task-02）；frontend/src/components/daemon/session-panel/takeover-bridge-note.tsx；frontend/src/lib/daemon/sessions.ts；sillyhub-daemon/tests/config-machine-id.test.ts（疑似归因 task-02）；sillyhub-daemon/tests/daemon-heartbeat-pending.test.ts（疑似归因 task-02）；sillyhub-daemon/tests/daemon-heartbeat-sillyspec.test.ts（疑似归因 task-02）

### 决策清单（id × 模块域）

| 决策 | 模块域 |
|---|---|
| D-001@v1 | （未填写） |
| D-002@v1 | （未填写） |
| D-003@v1 | （未填写） |
| D-004@v1 | （未填写） |
| D-005@v2 | backend |
| D-006@v1 | （未填写） |

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-09-30T04:57:52.319Z
- probe1：matches=0 / skippedFiles=2 / worktreeHits=6 / globEntries=0
- probe3：tasks=7 / hasTest=7
- probe5：backendEndpoints=3579 / frontendCalls=4
- probe6：deletions=1 / unavailable=false
- probe8：mispairs=0 / feOnly=0 / missingNotNull=0 / contractCount=0 / contractOrphans=0 / missingRequired=0 / feKeys=0 / backendFields=0
- probe9：javaFileCount=0 / groupCount=0 / inconsistentGroups=0
- probe10：checkedFiles=8 / unclearedFiles=0

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 模块文档 | 操作 | 状态 |
|---|---|---|
| modules/daemon.md（backend 项目） | 人工备注追加本变更条目 | ✅ 已更新（2026-09-30） |
| modules/platform_sync.md（backend 项目） | 人工备注追加本变更条目 | ✅ 已更新（2026-09-30） |
| modules/migrations.md | 迁移 20260930110000 已随 task-01 落盘，模块文档按惯例不逐迁移记行 | ⏭ 跳过（归档 distill 统一沉淀） |
| modules/components-daemon.md（frontend 项目） | 组件级行为变化（提示条/选择器/重置入口），页面骨架不变 | ⏭ 跳过（归档 distill 统一沉淀） |
| modules/lib-api.md（frontend 项目） | 生成物 api-types 随 gen:types 同步，非手写接口面 | ⏭ 跳过（生成物无文档债） |
| _module-map.yaml | 无新模块/无路径变更（全部改动落在既有模块 paths 内） | ⏭ 跳过（无需重建） |

### scan 刷新建议

- （受影响模块集为空——无重点刷新面）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：backend/app/modules/daemon/router/heartbeat.py、backend/app/modules/daemon/router/session_crud.py、backend/app/modules/daemon/schema.py、backend/app/modules/daemon/session/service/helpers.py、backend/app/modules/daemon/session/service/inject.py、backend/app/modules/daemon/session/service/ppm_activation.py、backend/app/modules/daemon/session/service/takeover.py、backend/app/modules/daemon/tests/test_takeover.py、backend/app/modules/daemon/tests/test_takeover_handoff.py、backend/app/modules/platform_sync/model.py、backend/app/modules/platform_sync/schema.py、backend/app/modules/platform_sync/service.py、backend/app/modules/platform_sync/tests/test_agent_log_machine.py、docs/platform-agent-log-protocol.md、frontend/src/components/daemon/__tests__/session-panel-takeover.test.tsx、frontend/src/components/daemon/session-panel/page-helpers.tsx、frontend/src/components/daemon/session-panel/session-panel-page.tsx、frontend/src/lib/api-types.ts、sillyhub-daemon/src/config.ts、sillyhub-daemon/src/daemon.ts、sillyhub-daemon/src/hub-client.ts、backend/app/modules/daemon/router/__init__.py、backend/app/modules/daemon/session/service/__init__.py、backend/app/modules/daemon/tests/test_heartbeat_machine_id.py、backend/app/modules/daemon/tests/test_session_optimize_round2.py、backend/app/modules/daemon/tests/test_tool_report_activation.py、backend/migrations/versions/20260930110000_tool_report_machine.py、backend/openapi.json、frontend/src/components/daemon/session-panel/takeover-bridge-note.tsx、frontend/src/lib/daemon/sessions.ts、sillyhub-daemon/tests/config-machine-id.test.ts、sillyhub-daemon/tests/daemon-heartbeat-pending.test.ts、sillyhub-daemon/tests/daemon-heartbeat-sillyspec.test.ts

### 端点基线提示

- 无基线（变更未拍 baseline）：C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\endpoint-baselines\2026-09-30-tool-report-activation-wrong-machine.json 不存在或不可解析——端点增删不可比（backendEndpoints=3579（>0））
