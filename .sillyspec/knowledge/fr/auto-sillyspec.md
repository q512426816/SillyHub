---
author: sillyspec-fr-index
created_at: 2026-10-05T23:35:27.631Z
---

# FR 索引 — auto-sillyspec

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-sillyspec-045 isToolReportBody 派生上移到所有早退分支之前（session 判空安全），handleSend 依赖数组补该变量
变更：2026-10-06-opencode-session-send-incident
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-06-opencode-session-send-incident/requirements.md#FR-01
最近确认：27deb16a7b065fbf623f9f1e5e40ec8fc3d494c6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-06-opencode-session-send-incident:flow:测试绑定FR-01
  tests: test/frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx「首句发送 → createSession 含 runtime_id + prompt + manual_approval/ask_user_only（不带 provider），成功清空输入并上报 onPreSessionCreated」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-opencode-session-send-incident
  status: active

## FR-auto-sillyspec-046 session-panel-pre-session.test.tsx 原先挂掉的 15 个用例全部转绿（TDZ 回归测试即现有用例）
变更：2026-10-06-opencode-session-send-incident
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-06-opencode-session-send-incident/requirements.md#FR-02
最近确认：27deb16a7b065fbf623f9f1e5e40ec8fc3d494c6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-06-opencode-session-send-incident:flow:测试绑定FR-02
  tests: test/frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx | test/frontend/src/components/daemon/__tests__/session-panel-takeover.test.tsx
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-opencode-session-send-incident
  status: active

## FR-auto-sillyspec-047 服务器 OpenCode Go 供应商行 extra_env 注入 HTTPS_PROXY=http://127.0.0.1:7897，daemon 本机 Claude Code 经代理连 opencode.ai 实测 200
变更：2026-10-06-opencode-session-send-incident
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-06-opencode-session-send-incident/requirements.md#FR-03
最近确认：27deb16a7b065fbf623f9f1e5e40ec8fc3d494c6

## FR-auto-sillyspec-048 未跑全量测试（仅跑本修复相关测试文件）
变更：2026-10-06-opencode-session-send-incident
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-06-opencode-session-send-incident/requirements.md#FR-04
最近确认：27deb16a7b065fbf623f9f1e5e40ec8fc3d494c6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-06-opencode-session-send-incident:flow:测试绑定FR-04
  tests: test/frontend/src/components/daemon/__tests__/session-panel-pre-session.test.tsx「空文本不发首句（后端 prompt 首句约束）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-06-opencode-session-send-incident
  status: active

## FR-auto-sillyspec-049 服务器 OpenCode Go 供应商行 settings_config 已清 NULL（psql 回显核对）
变更：2026-10-06-opencode-settings-config-poison
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-06-opencode-settings-config-poison/requirements.md#FR-01
最近确认：18205e82742eba62c020a512efc29e2df21fc718

## FR-auto-sillyspec-050 平台 UI 真实新会话（OpenCode Go + deepseek-v4.1-flash）发送首句收到模型回复（第 1 轮已完成）
变更：2026-10-06-opencode-settings-config-poison
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-06-opencode-settings-config-poison/requirements.md#FR-02
最近确认：18205e82742eba62c020a512efc29e2df21fc718

## FR-auto-sillyspec-051 坑文档补记 settings_config 覆盖链教训（规则 7 优先级高于平台注入，编辑供应商数据时必须同步检查该字段）
变更：2026-10-06-opencode-settings-config-poison
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-06-opencode-settings-config-poison/requirements.md#FR-03
最近确认：18205e82742eba62c020a512efc29e2df21fc718

## FR-auto-sillyspec-052 无代码改动，无测试面（纯运维数据 + 文档）
变更：2026-10-06-opencode-settings-config-poison
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-06-opencode-settings-config-poison/requirements.md#FR-04
最近确认：18205e82742eba62c020a512efc29e2df21fc718
