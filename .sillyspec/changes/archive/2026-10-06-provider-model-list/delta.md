---
generated_at: 2026-10-07T06:55:01.136Z
sources_reconcile: 命中（ran_at=2026-10-07T06:39:00.188Z，verify-runs 按 change 过滤取最新）
sources_verify_facts: 命中
sources_module_map: 命中
sources_decisions: 命中
---

# 变更 Delta — 2026-10-06-provider-model-list

## Before（变更前状态）

### 受影响模块（module-map 注册摘要）

（受影响模块集为空——交付/差集文件均未命中任何模块 paths）

未匹配文件（不归属任何模块 paths，人工裁量）：backend/app/modules/daemon/attachment_pipeline.py、backend/app/modules/daemon/group/service/shadow.py、backend/app/modules/daemon/lease/context.py、backend/app/modules/daemon/session/service/attachments.py、backend/app/modules/daemon/session/service/create.py、backend/app/modules/daemon/session/service/inject_gates.py、backend/app/modules/llm_provider/litellm_client.py、backend/app/modules/llm_provider/model.py、backend/app/modules/llm_provider/router.py、backend/app/modules/llm_provider/schema.py、backend/app/modules/llm_provider/service.py、backend/app/modules/session_attachment/capability.py、backend/migrations/versions/20261006200000_provider_models.py、frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx、frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx、frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx、frontend/src/lib/api/__tests__/llm-providers.test.ts、backend/app/modules/agent/schema.py、backend/app/modules/daemon/session/service/__init__.py、backend/app/modules/daemon/session/service/results.py、backend/app/modules/daemon/tests/test_attachment_pipeline.py、backend/app/modules/daemon/tests/test_change_session.py、backend/app/modules/daemon/tests/test_e2e_model_usage_flow.py、backend/app/modules/daemon/tests/test_group_cross_mention.py、backend/app/modules/daemon/tests/test_group_p1.py、backend/app/modules/daemon/tests/test_inject_first_turn_briefing.py、backend/app/modules/daemon/tests/test_inject_orchestrator_tagging.py、backend/app/modules/daemon/tests/test_inject_session_model.py、backend/app/modules/daemon/tests/test_lease_context_provider_priority.py、backend/app/modules/daemon/tests/test_lease_model_usage.py、backend/app/modules/daemon/tests/test_provider_switch.py、backend/app/modules/daemon/tests/test_provider_switch_integration.py、backend/app/modules/daemon/tests/test_resolve_bound_provider_config.py、backend/app/modules/daemon/tests/test_resolve_default_provider_config.py、backend/app/modules/daemon/tests/test_runtime_usage_by_provider.py、backend/app/modules/daemon/tests/test_session_create_config.py、backend/app/modules/daemon/tests/test_session_fork.py、backend/app/modules/daemon/tests/test_session_optimize_round2.py、backend/app/modules/daemon/tests/test_session_queue.py、backend/app/modules/daemon/tests/test_session_reopen.py、backend/app/modules/daemon/tests/test_session_runs_endpoint.py、backend/app/modules/daemon/tests/test_session_switch_config.py、backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py、backend/app/modules/llm_provider/tests/test_api_format.py、backend/app/modules/llm_provider/tests/test_fetch_models.py、backend/app/modules/llm_provider/tests/test_litellm_client.py、backend/app/modules/llm_provider/tests/test_llm_provider.py、backend/app/modules/llm_provider/tests/test_quota.py、backend/app/modules/llm_provider/tests/test_router.py、backend/app/modules/mcp_gateway/tests/test_tools_new.py、backend/app/modules/session_attachment/tests/test_capability.py、backend/openapi.json、backend/tests/modules/daemon/lease/test_provider_config_payload.py、frontend/src/app/m/workspaces/[id]/sessions/[sid]/__tests__/page.m-session-chat.test.tsx、frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx、frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx、frontend/src/components/daemon/session-panel/page-helpers.tsx、frontend/src/components/daemon/session-panel/session-panel-page.tsx、frontend/src/components/knowledge/__tests__/precipitate-dialog.test.tsx、frontend/src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx、frontend/src/components/llm-providers/llm-provider-form.tsx、frontend/src/components/llm-providers/llm-provider-list.tsx、frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx、frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx、frontend/src/components/sessions/__tests__/session-config-bar.test.tsx、frontend/src/components/sessions/ctx-usage-bar.tsx、frontend/src/components/sessions/session-config-bar.tsx、frontend/src/lib/api-types.ts、frontend/src/lib/api/llm-providers.ts

### 声明域并集（decisions.md 模块域）

（decisions.md 解析出 0 条当前版本决策，均未填写模块域——声明域为空）

## Delta（做了什么）

### 交付文件 × 模块归属

| 交付文件 | 模块归属 |
|---|---|
| backend/app/modules/daemon/attachment_pipeline.py | —（未匹配） |
| backend/app/modules/daemon/group/service/shadow.py | —（未匹配） |
| backend/app/modules/daemon/lease/context.py | —（未匹配） |
| backend/app/modules/daemon/session/service/attachments.py | —（未匹配） |
| backend/app/modules/daemon/session/service/create.py | —（未匹配） |
| backend/app/modules/daemon/session/service/inject_gates.py | —（未匹配） |
| backend/app/modules/llm_provider/litellm_client.py | —（未匹配） |
| backend/app/modules/llm_provider/model.py | —（未匹配） |
| backend/app/modules/llm_provider/router.py | —（未匹配） |
| backend/app/modules/llm_provider/schema.py | —（未匹配） |
| backend/app/modules/llm_provider/service.py | —（未匹配） |
| backend/app/modules/session_attachment/capability.py | —（未匹配） |
| backend/migrations/versions/20261006200000_provider_models.py | —（未匹配） |
| frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx | —（未匹配） |
| frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx | —（未匹配） |
| frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx | —（未匹配） |
| frontend/src/lib/api/__tests__/llm-providers.test.ts | —（未匹配） |

- 对账基线：status=undeclared / form=worktree / sources=worktree:diff-base..HEAD、worktree:status-porcelain(uncommitted)
- missing（声明未落盘）：无
- undeclared（落盘未声明，52 项）：backend/app/modules/agent/schema.py（疑似归因 task-10、task-02）；backend/app/modules/daemon/session/service/__init__.py；backend/app/modules/daemon/session/service/results.py；backend/app/modules/daemon/tests/test_attachment_pipeline.py；backend/app/modules/daemon/tests/test_change_session.py（疑似归因 task-10）；backend/app/modules/daemon/tests/test_e2e_model_usage_flow.py；backend/app/modules/daemon/tests/test_group_cross_mention.py；backend/app/modules/daemon/tests/test_group_p1.py；backend/app/modules/daemon/tests/test_inject_first_turn_briefing.py；backend/app/modules/daemon/tests/test_inject_orchestrator_tagging.py；backend/app/modules/daemon/tests/test_inject_session_model.py；backend/app/modules/daemon/tests/test_lease_context_provider_priority.py；backend/app/modules/daemon/tests/test_lease_model_usage.py；backend/app/modules/daemon/tests/test_provider_switch.py；backend/app/modules/daemon/tests/test_provider_switch_integration.py；backend/app/modules/daemon/tests/test_resolve_bound_provider_config.py；backend/app/modules/daemon/tests/test_resolve_default_provider_config.py（疑似归因 task-10）；backend/app/modules/daemon/tests/test_runtime_usage_by_provider.py；backend/app/modules/daemon/tests/test_session_create_config.py；backend/app/modules/daemon/tests/test_session_fork.py；backend/app/modules/daemon/tests/test_session_optimize_round2.py；backend/app/modules/daemon/tests/test_session_queue.py；backend/app/modules/daemon/tests/test_session_reopen.py；backend/app/modules/daemon/tests/test_session_runs_endpoint.py（疑似归因 task-07）；backend/app/modules/daemon/tests/test_session_switch_config.py；backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py；backend/app/modules/llm_provider/tests/test_api_format.py（疑似归因 task-03）；backend/app/modules/llm_provider/tests/test_fetch_models.py（疑似归因 task-12）；backend/app/modules/llm_provider/tests/test_litellm_client.py（疑似归因 task-09、task-12）；backend/app/modules/llm_provider/tests/test_llm_provider.py（疑似归因 task-09）；backend/app/modules/llm_provider/tests/test_quota.py；backend/app/modules/llm_provider/tests/test_router.py；backend/app/modules/mcp_gateway/tests/test_tools_new.py（疑似归因 task-14）；backend/app/modules/session_attachment/tests/test_capability.py；backend/openapi.json（疑似归因 task-13、task-04、task-05、task-09、task-07、task-03、task-06、task-11、task-08、task-01、task-15、task-02）；backend/tests/modules/daemon/lease/test_provider_config_payload.py（疑似归因 task-10）；frontend/src/app/m/workspaces/[id]/sessions/[sid]/__tests__/page.m-session-chat.test.tsx；frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx；frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx；frontend/src/components/daemon/session-panel/page-helpers.tsx；frontend/src/components/daemon/session-panel/session-panel-page.tsx；frontend/src/components/knowledge/__tests__/precipitate-dialog.test.tsx；frontend/src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx（疑似归因 task-07）；frontend/src/components/llm-providers/llm-provider-form.tsx（疑似归因 task-05、task-07、task-09、task-10）；frontend/src/components/llm-providers/llm-provider-list.tsx（疑似归因 task-06、task-12、task-09）；frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx；frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx；frontend/src/components/sessions/__tests__/session-config-bar.test.tsx；frontend/src/components/sessions/ctx-usage-bar.tsx；frontend/src/components/sessions/session-config-bar.tsx；frontend/src/lib/api-types.ts（疑似归因 task-13、task-04、task-05、task-09、task-07、task-03、task-06、task-11、task-01、task-15、task-02）；frontend/src/lib/api/llm-providers.ts（疑似归因 task-04、task-06、task-11）

### 决策清单（id × 模块域）

（decisions.md 无当前版本 D 条目——决策清单为空）

### 探针 metrics 摘要（验证结论表的机器半边）

快照时刻：2026-10-07T06:23:24.625Z
- probe1：matches=0 / skippedFiles=2 / worktreeHits=1 / globEntries=1
- probe3：tasks=11 / hasTest=10
- probe5：backendEndpoints=6099 / frontendCalls=3
- probe6：deletions=0 / unavailable=false
- probe8：mispairs=0 / feOnly=0 / missingNotNull=0 / contractCount=0 / contractOrphans=0 / missingRequired=0 / feKeys=0 / backendFields=0
- probe9：javaFileCount=0 / groupCount=0 / inconsistentGroups=0
- probe10：checkedFiles=12 / unclearedFiles=0

## After（建议动作）

### 模块卡同步状态（module-impact.md「更新结果」）

（引自变更目录 module-impact.md，人工维护为准）

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/components-agent-profile.md` | 不更新：worktree diff 实测该文件零改动（design 声明清单列名未触——真实 > 声明），卡内容仍准确 | skipped |
| `modules/lib-api.md` | 已更新：追加本变更条目（api-types.ts 契约再生日志） | done |
| `modules/lib-llm-providers.md` | 已更新：模型列表契约（models/ProviderModelEntry）+ 映射器语义变化条目 | done |
| `_module-map.yaml` | 不适用：本变更未新增模块/目录，全部为既有模块面内改动（backend/frontend 细粒度归属不变，索引无需 rebuild） | skipped |

规则：execute/verify 完成文档同步后把对应行回填 done；确定不同步的行改 skipped 并在操作列写明原因。

### scan 刷新建议

- （受影响模块集为空——无重点刷新面）
- 未匹配文件补录提示：以下文件未命中任何模块 paths——建议补录 _module-map.yaml（新文件）或核对归属（人工裁量）：backend/app/modules/daemon/attachment_pipeline.py、backend/app/modules/daemon/group/service/shadow.py、backend/app/modules/daemon/lease/context.py、backend/app/modules/daemon/session/service/attachments.py、backend/app/modules/daemon/session/service/create.py、backend/app/modules/daemon/session/service/inject_gates.py、backend/app/modules/llm_provider/litellm_client.py、backend/app/modules/llm_provider/model.py、backend/app/modules/llm_provider/router.py、backend/app/modules/llm_provider/schema.py、backend/app/modules/llm_provider/service.py、backend/app/modules/session_attachment/capability.py、backend/migrations/versions/20261006200000_provider_models.py、frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx、frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx、frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx、frontend/src/lib/api/__tests__/llm-providers.test.ts、backend/app/modules/agent/schema.py、backend/app/modules/daemon/session/service/__init__.py、backend/app/modules/daemon/session/service/results.py、backend/app/modules/daemon/tests/test_attachment_pipeline.py、backend/app/modules/daemon/tests/test_change_session.py、backend/app/modules/daemon/tests/test_e2e_model_usage_flow.py、backend/app/modules/daemon/tests/test_group_cross_mention.py、backend/app/modules/daemon/tests/test_group_p1.py、backend/app/modules/daemon/tests/test_inject_first_turn_briefing.py、backend/app/modules/daemon/tests/test_inject_orchestrator_tagging.py、backend/app/modules/daemon/tests/test_inject_session_model.py、backend/app/modules/daemon/tests/test_lease_context_provider_priority.py、backend/app/modules/daemon/tests/test_lease_model_usage.py、backend/app/modules/daemon/tests/test_provider_switch.py、backend/app/modules/daemon/tests/test_provider_switch_integration.py、backend/app/modules/daemon/tests/test_resolve_bound_provider_config.py、backend/app/modules/daemon/tests/test_resolve_default_provider_config.py、backend/app/modules/daemon/tests/test_runtime_usage_by_provider.py、backend/app/modules/daemon/tests/test_session_create_config.py、backend/app/modules/daemon/tests/test_session_fork.py、backend/app/modules/daemon/tests/test_session_optimize_round2.py、backend/app/modules/daemon/tests/test_session_queue.py、backend/app/modules/daemon/tests/test_session_reopen.py、backend/app/modules/daemon/tests/test_session_runs_endpoint.py、backend/app/modules/daemon/tests/test_session_switch_config.py、backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py、backend/app/modules/llm_provider/tests/test_api_format.py、backend/app/modules/llm_provider/tests/test_fetch_models.py、backend/app/modules/llm_provider/tests/test_litellm_client.py、backend/app/modules/llm_provider/tests/test_llm_provider.py、backend/app/modules/llm_provider/tests/test_quota.py、backend/app/modules/llm_provider/tests/test_router.py、backend/app/modules/mcp_gateway/tests/test_tools_new.py、backend/app/modules/session_attachment/tests/test_capability.py、backend/openapi.json、backend/tests/modules/daemon/lease/test_provider_config_payload.py、frontend/src/app/m/workspaces/[id]/sessions/[sid]/__tests__/page.m-session-chat.test.tsx、frontend/src/app/m/workspaces/[id]/sessions/__tests__/page.m-sessions.test.tsx、frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx、frontend/src/components/daemon/session-panel/page-helpers.tsx、frontend/src/components/daemon/session-panel/session-panel-page.tsx、frontend/src/components/knowledge/__tests__/precipitate-dialog.test.tsx、frontend/src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx、frontend/src/components/llm-providers/llm-provider-form.tsx、frontend/src/components/llm-providers/llm-provider-list.tsx、frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx、frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx、frontend/src/components/sessions/__tests__/session-config-bar.test.tsx、frontend/src/components/sessions/ctx-usage-bar.tsx、frontend/src/components/sessions/session-config-bar.tsx、frontend/src/lib/api-types.ts、frontend/src/lib/api/llm-providers.ts

### 端点基线提示

- 无基线（变更未拍 baseline）：C:\Users\qinyi\IdeaProjects\multi-agent-platform\.sillyspec\.runtime\endpoint-baselines\2026-10-06-provider-model-list.json 不存在或不可解析——端点增删不可比（backendEndpoints=6099（>0））
