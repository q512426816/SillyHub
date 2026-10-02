---
author: sillyspec-fr-index
created_at: 2026-10-01T11:33:26.735Z
---

# FR 索引 — config

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/config.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-config-001 reset_tool_report_session 会话查询补 deleted_at IS NULL
变更：2026-10-01-review-followup-reset-guard-machineid
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When reset_tool_report_session 会话查询补 deleted_at IS NULL 守卫，软删会话重置返回 404，与 takeover 同款；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-01-review-followup-reset-guard-machineid/requirements.md#FR-01
最近确认：9f38792b6b354fb02d4e6b43d23726a68b1056e1

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-01-review-followup-reset-guard-machineid:flow:FR-01
  tests: backend/app/modules/daemon/tests/test_takeover.py::TestResetToolReport::test_reset_soft_deleted_session_rejected（软删会话重置
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-01-review-followup-reset-guard-machineid
  status: active

## FR-config-002 readOrCreateMachineId 改独占创建（wx）+ 写冲突回读胜者 + 非 uuid
变更：2026-10-01-review-followup-reset-guard-machineid
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When readOrCreateMachineId 改独占创建（wx）+ 写冲突回读胜者 + 非 uuid 形损坏覆写自愈，注释如实描述不再宣称原子落盘，附单测；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-01-review-followup-reset-guard-machineid/requirements.md#FR-02
最近确认：9f38792b6b354fb02d4e6b43d23726a68b1056e1

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-01-review-followup-reset-guard-machineid:flow:FR-02
  tests: sillyhub-daemon/tests/config-machine-id.test.ts::readOrCreateMachineId
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-01-review-followup-reset-guard-machineid
  status: active

## FR-config-003 仅跑触达文件的相关测试（backend daemon reset 用例 + sillyhub-dae
变更：2026-10-01-review-followup-reset-guard-machineid
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 仅跑触达文件的相关测试（backend daemon reset 用例 + sillyhub-daemon config-machine-id 用例），全部通过；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-01-review-followup-reset-guard-machineid/requirements.md#FR-03
最近确认：9f38792b6b354fb02d4e6b43d23726a68b1056e1

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-01-review-followup-reset-guard-machineid:flow:FR-03
  tests: backend/app/modules/daemon/tests/test_takeover.py | sillyhub-daemon/tests/config-machine-id.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-01-review-followup-reset-guard-machineid
  status: active
