---
author: sillyspec-fr-index
created_at: 2026-09-22T16:26:24.345Z
---

# FR 索引 — types

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/types.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-types-001 AgentEvent v2 统一事件契约
变更：2026-09-03-agent-provider-abstraction
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given `sillyhub-daemon/src/types.ts` 现有 5 型 AgentEvent（text/tool_use/tool_result/error；When 扩展类型联合（+thinking/status/turn_result）与一等可选字段（subtype/seq/tool_name/call_id/sessio；Then 类型与 zod schema（独立文件 agent-event-schema.ts）一致，批量 adapter 现有 5 型用法零破坏，交互式与批量共用一份 I
全文：.sillyspec/changes/archive/2026-09-03-agent-provider-abstraction/requirements.md#FR-01
最近确认：c6c74aa49

## FR-types-002 Claude 交互式归一化下沉 daemon
变更：2026-09-03-agent-provider-abstraction
状态：active
摘要：默认场景
依据决策：D-002@v1、D-003@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given ClaudeEventNormalizer（有状态类，每会话实例）接收一帧 SDK 完整消息 stream_event partial 流（content_bl；When normalizeMessage 展开为 AgentEvent[]（text/thinking/tool_use/tool_result 配对/usage/se；Then 输出与该函数现状行为逐字段等价（golden 对照） 产出 is_partial+segment_id 半截事件；override 信号产出 override:
全文：.sillyspec/changes/archive/2026-09-03-agent-provider-abstraction/requirements.md#FR-02
最近确认：c6c74aa49

## FR-types-003 backend 双轨接收与落库
变更：2026-09-03-agent-provider-abstraction
状态：active
摘要：默认场景
依据决策：D-001@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given submit_lease_messages 收到 kind='agent_event' 消息 override:true+segment_id 事件到达 旧形态；When `_persist_agent_event` 处理 落库 走原 `_extract_sdk_messages` 路径 组装 run/session 双 chan；Then 按现行为合成同款文本行（[TOOL_USE] 等前缀，未升级前端渲染不断）+ 填充既有结构化列（tool_kind/parent 三列/segment_id/e
全文：.sillyspec/changes/archive/2026-09-03-agent-provider-abstraction/requirements.md#FR-03
最近确认：c6c74aa49

## FR-types-004 前端双轨渲染
变更：2026-09-03-agent-provider-abstraction
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given SSE/回放日志行携带 agent_event 字段 同一事件序列生成的两种载荷（旧文本行 vs agent_event 行）；When normalize 解析 分别过两条解析路径；Then 直接由结构化事件构造渲染模型（不进文本正则）；无 agent_event 字段时回退现有 [ASSISTANT] 文本协议解析 normalize 渲染模型树等
全文：.sillyspec/changes/archive/2026-09-03-agent-provider-abstraction/requirements.md#FR-04
最近确认：c6c74aa49

## FR-types-005 provider 注册表
变更：2026-09-03-agent-provider-abstraction
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given providers.ts 注册表（ProviderDescriptor：provider/family/displayName/createDriver/cap；When 新增 provider 经注册表路径创建 driver；Then 仅需注册表条目，不改 InteractiveProvider 类型（从注册表推导）；SessionManager._getDriver 改读注册表，未注册 pr
全文：.sillyspec/changes/archive/2026-09-03-agent-provider-abstraction/requirements.md#FR-05
最近确认：c6c74aa49

## FR-types-006 能力矩阵三端表
变更：2026-09-03-agent-provider-abstraction
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given ProviderCaps（resume/mcp/multimodal/thinking/subagent/permission_dialog/edit_patc；When daemon/backend/frontend 三份镜像表建立；Then 守护测试以源文件读取断言三端键值一致；前端 session-panel 与 backend daemon/session service 散落的 `=== 'c
全文：.sillyspec/changes/archive/2026-09-03-agent-provider-abstraction/requirements.md#FR-06
最近确认：c6c74aa49

## FR-types-007 接入清单文档
变更：2026-09-03-agent-provider-abstraction
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 新 provider 接入需求；When 查阅 docs/agent-provider-onboarding.md；Then 三档路径（换 wrapper 零代码/族内成员描述符/新协议族 driver+归一化器+注册）有可执行 checklist 与 multica 对照引用
全文：.sillyspec/changes/archive/2026-09-03-agent-provider-abstraction/requirements.md#FR-07
最近确认：c6c74aa49

## FR-types-008 context_overflow 全链路归因与自动压缩续跑（含熔断）
变更：2026-10-12-session-defects
状态：active
摘要：上下文超限自动恢复；熔断；归因命中
依据决策：D-003@v1、D-006@v1
全文：.sillyspec/changes/archive/2026-10-12-session-defects/requirements.md#FR-01
最近确认：35cbb66b8

## FR-types-009 日志行时间戳反映事件发生时刻
变更：2026-10-12-session-defects
状态：active
摘要：批量提交时间戳分散；向后兼容
依据决策：D-004@v1
全文：.sillyspec/changes/archive/2026-10-12-session-defects/requirements.md#FR-02
最近确认：35cbb66b8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-session-defects:task-01:acc-0-5d717414
  tests: backend/app/modules/daemon/tests/test_run_sync_submit_timestamp.py | sillyhub-daemon/tests/event-wire-timestamp.test.ts | sillyhub-daemon/tests/event-wire.test.ts | sillyhub-daemon/tests/task-runner.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-session-defects
  status: active
- row: 2026-10-12-session-defects:task-01:acc-1-1b5a5d4c
  tests: backend/app/modules/daemon/tests/test_run_sync_submit_timestamp.py | sillyhub-daemon/tests/event-wire-timestamp.test.ts | sillyhub-daemon/tests/event-wire.test.ts | sillyhub-daemon/tests/task-runner.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-session-defects
  status: active
- row: 2026-10-12-session-defects:task-01:acc-2-6360f34d
  tests: backend/app/modules/daemon/tests/test_run_sync_submit_timestamp.py | sillyhub-daemon/tests/event-wire-timestamp.test.ts | sillyhub-daemon/tests/event-wire.test.ts | sillyhub-daemon/tests/task-runner.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-session-defects
  status: active

## FR-types-010 同一助手消息单行完整落库
变更：2026-10-12-session-defects
状态：active
摘要：delta 合并；缓冲不丢失
依据决策：D-004@v1
全文：.sillyspec/changes/archive/2026-10-12-session-defects/requirements.md#FR-03
最近确认：35cbb66b8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-session-defects:task-02:acc-0-4b4c15e1
  tests: sillyhub-daemon/tests/agent-log/message-coalescer.test.ts | sillyhub-daemon/tests/event-wire.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-session-defects
  status: active
- row: 2026-10-12-session-defects:task-02:acc-1-86f8df67
  tests: sillyhub-daemon/tests/agent-log/message-coalescer.test.ts | sillyhub-daemon/tests/event-wire.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-session-defects
  status: active
- row: 2026-10-12-session-defects:task-02:acc-2-67667469
  tests: sillyhub-daemon/tests/agent-log/message-coalescer.test.ts | sillyhub-daemon/tests/event-wire.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-session-defects
  status: active

## FR-types-011 任务幽灵行根治（一逻辑任务一行）
变更：2026-10-12-session-defects
状态：active
摘要：复现转绿
依据决策：D-005@v1
全文：.sillyspec/changes/archive/2026-10-12-session-defects/requirements.md#FR-04
最近确认：35cbb66b8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-session-defects:task-03:acc-0-d1bf78cf
  tests: backend/app/modules/daemon/tests/test_agent_session_tasks.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-session-defects
  status: active
- row: 2026-10-12-session-defects:task-03:acc-1-8e6618e8
  tests: backend/app/modules/daemon/tests/test_agent_session_tasks.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-session-defects
  status: active

## FR-types-012 策略写守卫路径解析三类误拒清零
变更：2026-10-12-session-defects
状态：active
摘要：flag 不当路径；相对路径锚定会话根；deny 双拼写提示
依据决策：D-007@v1
全文：.sillyspec/changes/archive/2026-10-12-session-defects/requirements.md#FR-05
最近确认：35cbb66b8

## FR-types-013 config_snapshot 落 model/provider + 打断工具调用日志行
变更：2026-10-12-session-defects
状态：active
摘要：快照非空；拒绝有痕
全文：.sillyspec/changes/archive/2026-10-12-session-defects/requirements.md#FR-06
最近确认：35cbb66b8

## FR-types-014 导出与任务列表去重
变更：2026-10-12-session-defects
状态：active
摘要：导出无幽灵
依据决策：D-005@v1
全文：.sillyspec/changes/archive/2026-10-12-session-defects/requirements.md#FR-07
最近确认：35cbb66b8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-session-defects:task-06:acc-0-df433f79
  tests: backend/app/modules/daemon/tests/test_session_tasks_dedupe.py | backend/tests/modules/daemon/test_session_export.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-session-defects
  status: active
- row: 2026-10-12-session-defects:task-06:acc-1-2681edf6
  tests: backend/app/modules/daemon/tests/test_session_tasks_dedupe.py | backend/tests/modules/daemon/test_session_export.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-session-defects
  status: active

## FR-types-015 sillyspec 工具缺陷记档
变更：2026-10-12-session-defects
状态：active
摘要：记档在场
依据决策：D-008@v1
全文：.sillyspec/changes/archive/2026-10-12-session-defects/requirements.md#FR-08
最近确认：35cbb66b8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-session-defects:task-11:acc-0-c60b5b28
  tests: backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_inject_origin_guard.py | backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_queue.py | backend/app/modules/daemon/tests/test_session_queue_actions.py | backend/app/modules/daemon/tests/test_session_runs_endpoint.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | backend/tests/modules/auth/test_permissions.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/daemon/__tests__/turn-speed.test.ts | frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx | frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx | frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx | frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-config-bar.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/daemon-session-stream-sync.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-session-defects
  status: active
- row: 2026-10-12-session-defects:task-11:acc-1-aad39546
  tests: backend/app/modules/change/tests/test_assets.py | backend/app/modules/change/tests/test_step_progress.py | backend/app/modules/change/tests/test_title_normalization.py | backend/app/modules/daemon/tests/test_change_session.py | backend/app/modules/daemon/tests/test_group_logs_pagination.py | backend/app/modules/daemon/tests/test_inject_origin_guard.py | backend/app/modules/daemon/tests/test_interactive_lifecycle_patch.py | backend/app/modules/daemon/tests/test_ppm_session.py | backend/app/modules/daemon/tests/test_scheduled_messages_crud.py | backend/app/modules/daemon/tests/test_scheduled_send_sweeper.py | backend/app/modules/daemon/tests/test_session_pin_rename.py | backend/app/modules/daemon/tests/test_session_queue.py | backend/app/modules/daemon/tests/test_session_queue_actions.py | backend/app/modules/daemon/tests/test_session_runs_endpoint.py | backend/app/modules/daemon/tests/test_session_service.py | backend/app/modules/knowledge/tests/test_distill.py | backend/app/modules/knowledge/tests/test_hits.py | backend/app/modules/knowledge/tests/test_writer.py | backend/app/modules/llm_provider/tests/test_agent_kinds_multi.py | backend/app/modules/platform_sync/tests/test_owner_sync.py | backend/app/modules/spec_workspace/tests/test_full_sync_convergence.py | backend/app/modules/workspace/linked_repos/tests/test_linked_repos.py | backend/app/modules/workspace/tests/test_daemon_client_scan.py | backend/tests/modules/agent/test_scan_interactive_dispatch.py | backend/tests/modules/auth/test_permissions.py | frontend/src/app/(dashboard)/admin/menus/__tests__/page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/__tests__/knowledge-page.test.tsx | frontend/src/app/(dashboard)/workspaces/[id]/changes/__tests__/page.test.tsx | frontend/src/app/page.test.tsx | frontend/src/components/changes/detail/__tests__/change-assets-card.test.tsx | frontend/src/components/changes/detail/__tests__/change-step-timeline.test.tsx | frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx | frontend/src/components/daemon/__tests__/team-trigger-popover.test.tsx | frontend/src/components/daemon/__tests__/turn-speed.test.ts | frontend/src/components/daemon/__tests__/turn-timeline-token-speed.test.tsx | frontend/src/components/floating/floating-session-host.test.tsx | frontend/src/components/knowledge/__tests__/ops-dashboard.test.tsx | frontend/src/components/llm-providers/__tests__/llm-provider-form-apiformat.test.tsx | frontend/src/components/llm-providers/__tests__/llm-provider-form-fetch-config.test.tsx | frontend/src/components/llm-providers/__tests__/llm-provider-form.test.tsx | frontend/src/components/llm-providers/__tests__/llm-provider-list.test.tsx | frontend/src/components/sessions/__tests__/ctx-usage-bar.test.tsx | frontend/src/components/sessions/__tests__/session-config-bar.test.tsx | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | frontend/src/components/workspace-config-card.test.tsx | frontend/src/lib/__tests__/agent-log-turns.test.ts | frontend/src/lib/__tests__/daemon-session-stream-sync.test.ts | frontend/src/lib/__tests__/menu-overrides.test.ts | frontend/src/lib/__tests__/menu-permissions.test.ts | frontend/src/lib/__tests__/session-mention-sources.test.tsx | frontend/src/lib/api/__tests__/llm-providers.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-session-defects
  status: active

## FR-types-016 仅跑本改动相关测试（规则 0）
变更：2026-10-12-session-defects
状态：active
摘要：相关面回归
全文：.sillyspec/changes/archive/2026-10-12-session-defects/requirements.md#FR-09
最近确认：35cbb66b8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-12-session-defects:task-12:acc-0-d5a00096
  tests: backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_auto_recover_failed_turn.py | backend/app/modules/daemon/tests/test_auto_recover_integration.py | backend/app/modules/daemon/tests/test_auto_resume_chain_limit_hint.py | backend/app/modules/daemon/tests/test_auto_resume_integration.py | backend/app/modules/daemon/tests/test_close_interactive_run_model_error.py | backend/app/modules/daemon/tests/test_close_interactive_run_session_status.py | backend/app/modules/daemon/tests/test_inject_session_model.py | backend/app/modules/daemon/tests/test_run_sync_agent_events.py | backend/app/modules/daemon/tests/test_session_create_config.py | backend/app/modules/daemon/tests/test_session_recovery.py | frontend/src/components/agent-log/__tests__/normalize-dual-path.test.ts | frontend/src/components/agent-log/__tests__/normalize.test.ts | frontend/src/components/agent-log/__tests__/run-error-item.test.tsx | sillyhub-daemon/tests/event-wire.test.ts | sillyhub-daemon/tests/interactive/session-manager-write-guard.test.ts | sillyhub-daemon/tests/model-error/classifier.test.ts | sillyhub-daemon/tests/policy/filesystem-policy.test.ts | sillyhub-daemon/tests/policy/path-utils.test.ts | sillyhub-daemon/tests/policy/shell-paths.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-session-defects
  status: active
- row: 2026-10-12-session-defects:task-12:acc-1-d5176e9d
  tests: backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_auto_recover_failed_turn.py | backend/app/modules/daemon/tests/test_auto_recover_integration.py | backend/app/modules/daemon/tests/test_auto_resume_chain_limit_hint.py | backend/app/modules/daemon/tests/test_auto_resume_integration.py | backend/app/modules/daemon/tests/test_close_interactive_run_model_error.py | backend/app/modules/daemon/tests/test_close_interactive_run_session_status.py | backend/app/modules/daemon/tests/test_inject_session_model.py | backend/app/modules/daemon/tests/test_run_sync_agent_events.py | backend/app/modules/daemon/tests/test_session_create_config.py | backend/app/modules/daemon/tests/test_session_recovery.py | frontend/src/components/agent-log/__tests__/normalize-dual-path.test.ts | frontend/src/components/agent-log/__tests__/normalize.test.ts | frontend/src/components/agent-log/__tests__/run-error-item.test.tsx | sillyhub-daemon/tests/event-wire.test.ts | sillyhub-daemon/tests/interactive/session-manager-write-guard.test.ts | sillyhub-daemon/tests/model-error/classifier.test.ts | sillyhub-daemon/tests/policy/filesystem-policy.test.ts | sillyhub-daemon/tests/policy/path-utils.test.ts | sillyhub-daemon/tests/policy/shell-paths.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-session-defects
  status: active
- row: 2026-10-12-session-defects:task-12:acc-2-35361fdb
  tests: backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_auto_recover_failed_turn.py | backend/app/modules/daemon/tests/test_auto_recover_integration.py | backend/app/modules/daemon/tests/test_auto_resume_chain_limit_hint.py | backend/app/modules/daemon/tests/test_auto_resume_integration.py | backend/app/modules/daemon/tests/test_close_interactive_run_model_error.py | backend/app/modules/daemon/tests/test_close_interactive_run_session_status.py | backend/app/modules/daemon/tests/test_inject_session_model.py | backend/app/modules/daemon/tests/test_run_sync_agent_events.py | backend/app/modules/daemon/tests/test_session_create_config.py | backend/app/modules/daemon/tests/test_session_recovery.py | frontend/src/components/agent-log/__tests__/normalize-dual-path.test.ts | frontend/src/components/agent-log/__tests__/normalize.test.ts | frontend/src/components/agent-log/__tests__/run-error-item.test.tsx | sillyhub-daemon/tests/event-wire.test.ts | sillyhub-daemon/tests/interactive/session-manager-write-guard.test.ts | sillyhub-daemon/tests/model-error/classifier.test.ts | sillyhub-daemon/tests/policy/filesystem-policy.test.ts | sillyhub-daemon/tests/policy/path-utils.test.ts | sillyhub-daemon/tests/policy/shell-paths.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-session-defects
  status: active
- row: 2026-10-12-session-defects:task-12:acc-3-d0cf8f7b
  tests: backend/app/modules/daemon/tests/test_agent_session_tasks.py | backend/app/modules/daemon/tests/test_auto_recover_failed_turn.py | backend/app/modules/daemon/tests/test_auto_recover_integration.py | backend/app/modules/daemon/tests/test_auto_resume_chain_limit_hint.py | backend/app/modules/daemon/tests/test_auto_resume_integration.py | backend/app/modules/daemon/tests/test_close_interactive_run_model_error.py | backend/app/modules/daemon/tests/test_close_interactive_run_session_status.py | backend/app/modules/daemon/tests/test_inject_session_model.py | backend/app/modules/daemon/tests/test_run_sync_agent_events.py | backend/app/modules/daemon/tests/test_session_create_config.py | backend/app/modules/daemon/tests/test_session_recovery.py | frontend/src/components/agent-log/__tests__/normalize-dual-path.test.ts | frontend/src/components/agent-log/__tests__/normalize.test.ts | frontend/src/components/agent-log/__tests__/run-error-item.test.tsx | sillyhub-daemon/tests/event-wire.test.ts | sillyhub-daemon/tests/interactive/session-manager-write-guard.test.ts | sillyhub-daemon/tests/model-error/classifier.test.ts | sillyhub-daemon/tests/policy/filesystem-policy.test.ts | sillyhub-daemon/tests/policy/path-utils.test.ts | sillyhub-daemon/tests/policy/shell-paths.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-12-session-defects
  status: active
