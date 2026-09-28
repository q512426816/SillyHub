---
author: sillyspec-fr-index
created_at: 2026-09-22T16:38:58.642Z
---

# FR 索引 — auto-sillyhub-daemon

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-sillyhub-daemon-001 轮任务派生
变更：2026-09-07-pi-task-events
状态：active
摘要：默认场景
待复核：2026-09-25-daemon-hits-upload-fingerprint
依据决策：D-001@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given pi 会话产生一轮 turn（turn_start → ... → turn_end）；When 轮内出现 tool_execution_start；Then 归一化器产出一组任务事件：turn_start 时 running（task_id=pi-t<seq>），turn_end 时按 stopReason 映射终态
全文：.sillyspec/changes/archive/2026-09-07-pi-task-events/requirements.md#FR-01
最近确认：35f3d6528

## FR-auto-sillyhub-daemon-002 上报链路复用
变更：2026-09-07-pi-task-events
状态：active
摘要：默认场景
待复核：2026-09-25-daemon-hits-upload-fingerprint
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 归一化器产出 status/agent_task_status 事件；Then 经既有 envelope→_onMessage→_dispatchStatusEvent→cli onSessionEvent→notifyAgentTaskS
全文：.sillyspec/changes/archive/2026-09-07-pi-task-events/requirements.md#FR-02
最近确认：35f3d6528

## FR-auto-sillyhub-daemon-003 异常流防御
变更：2026-09-07-pi-task-events
状态：active
摘要：默认场景
待复核：2026-09-25-daemon-hits-upload-fingerprint
场景正文：
- 场景：默认场景 — Given 上一轮任务仍 running 时新 turn_start 到达（上轮 turn_end 丢失）；Then 先补发上轮 completed 再开新行，不产生悬挂 running
全文：.sillyspec/changes/archive/2026-09-07-pi-task-events/requirements.md#FR-03
最近确认：35f3d6528

## FR-auto-sillyhub-daemon-004 既有行为零回归
变更：2026-09-07-pi-task-events
状态：active
摘要：默认场景
待复核：2026-09-25-daemon-hits-upload-fingerprint
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given 全部既有 pi-events 用例与 claude/codex 会话；Then 映射表零改动；既有用例仅 expected 数组适配（追加派生事件）；claude/codex 零变化
全文：.sillyspec/changes/archive/2026-09-07-pi-task-events/requirements.md#FR-04
最近确认：35f3d6528

## FR-auto-sillyhub-daemon-005 断点状态记录行指纹
变更：2026-09-25-daemon-hits-upload-fingerprint
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-daemon-hits-upload-fingerprint/requirements.md#FR-01
最近确认：064b606a4cd620ad60aa9ad218ff130a648acf13

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-daemon-hits-upload-fingerprint:flow:FR-01
  tests: sillyhub-daemon/tests/knowledge-hits-upload.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-daemon-hits-upload-fingerprint
  status: active

## FR-auto-sillyhub-daemon-006 替换检测与全量自愈重报
变更：2026-09-25-daemon-hits-upload-fingerprint
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-daemon-hits-upload-fingerprint/requirements.md#FR-02
最近确认：064b606a4cd620ad60aa9ad218ff130a648acf13

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-daemon-hits-upload-fingerprint:flow:FR-02
  tests: sillyhub-daemon/tests/knowledge-hits-upload.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-daemon-hits-upload-fingerprint
  status: active

## FR-auto-sillyhub-daemon-007 钳位语义不变
变更：2026-09-25-daemon-hits-upload-fingerprint
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-daemon-hits-upload-fingerprint/requirements.md#FR-03
最近确认：064b606a4cd620ad60aa9ad218ff130a648acf13

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-daemon-hits-upload-fingerprint:flow:FR-03
  tests: sillyhub-daemon/tests/knowledge-hits-upload.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-daemon-hits-upload-fingerprint
  status: active

## FR-auto-sillyhub-daemon-008 legacy 状态零误伤
变更：2026-09-25-daemon-hits-upload-fingerprint
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-daemon-hits-upload-fingerprint/requirements.md#FR-04
最近确认：064b606a4cd620ad60aa9ad218ff130a648acf13

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-daemon-hits-upload-fingerprint:flow:FR-04
  tests: sillyhub-daemon/tests/knowledge-hits-upload.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-daemon-hits-upload-fingerprint
  status: active

## FR-auto-sillyhub-daemon-009 单测覆盖三态
变更：2026-09-25-daemon-hits-upload-fingerprint
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-daemon-hits-upload-fingerprint/requirements.md#FR-05
最近确认：064b606a4cd620ad60aa9ad218ff130a648acf13

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-daemon-hits-upload-fingerprint:flow:FR-05
  tests: sillyhub-daemon/tests/knowledge-hits-upload.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-daemon-hits-upload-fingerprint
  status: active

## FR-auto-sillyhub-daemon-010 零回归
变更：2026-09-25-daemon-hits-upload-fingerprint
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-daemon-hits-upload-fingerprint/requirements.md#FR-06
最近确认：064b606a4cd620ad60aa9ad218ff130a648acf13

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-25-daemon-hits-upload-fingerprint:flow:FR-06
  tests: sillyhub-daemon/tests/knowledge-hits-upload.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-25-daemon-hits-upload-fingerprint
  status: active

## FR-auto-sillyhub-daemon-011 类型检查零错
变更：2026-09-25-daemon-hits-upload-fingerprint
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-09-25-daemon-hits-upload-fingerprint/requirements.md#FR-07
最近确认：064b606a4cd620ad60aa9ad218ff130a648acf13

## FR-auto-sillyhub-daemon-012 frontend-ci 4 用例稳定失败（分身会话浮层找不到关闭按钮 ×2 / getProvide
变更：2026-09-28-ci-failures-sweep
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When frontend-ci 4 用例稳定失败（分身会话浮层找不到关闭按钮 ×2 / getProviderCaps 14vs13 键 / ChangesOvervi；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-ci-failures-sweep/requirements.md#FR-01
最近确认：e31d0e07bd259252cdced59554fba8de5bec566a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-ci-failures-sweep:flow:FR-01
  tests: frontend/src/components/daemon/__tests__/session-panel-team.test.ts | frontend/src/components/sessions/__tests__/pre-session-picker.test.ts | frontend/src/components/workspace/__tests__/changes-overview-card.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-ci-failures-sweep
  status: active

## FR-auto-sillyhub-daemon-013 daemon-ci 12 用例 60s 超时（batch runLease spawn 集成）+ r
变更：2026-09-28-ci-failures-sweep
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When daemon-ci 12 用例 60s 超时（batch runLease spawn 集成）+ runtime-handler 注册器多了 knowledge；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-ci-failures-sweep/requirements.md#FR-02
最近确认：e31d0e07bd259252cdced59554fba8de5bec566a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-ci-failures-sweep:flow:FR-02
  tests: sillyhub-daemon/tests/cache-passthrough.test.ts | sillyhub-daemon/tests/runtime-handler.test.ts | sillyhub-daemon/tests/stats-passthrough.test.ts | sillyhub-daemon/tests/task-runner-budget.test.ts | sillyhub-daemon/tests/task-runner-policy-cache.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-ci-failures-sweep
  status: active

## FR-auto-sillyhub-daemon-014 e2e N2/N3 侧边栏导航 toBeVisible 元素找不到（含重试均失败）
变更：2026-09-28-ci-failures-sweep
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given e2e 相关模块就绪；When e2e N2/N3 侧边栏导航 toBeVisible 元素找不到（含重试均失败）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-ci-failures-sweep/requirements.md#FR-03
最近确认：e31d0e07bd259252cdced59554fba8de5bec566a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-ci-failures-sweep:flow:FR-03
  tests: frontend/e2e/navigation.spec.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-ci-failures-sweep
  status: active

## FR-auto-sillyhub-daemon-015 turn-control-attachment-atomic mtimeMs 0.001ms 浮点差
变更：2026-09-28-ci-failures-sweep
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When turn-control-attachment-atomic mtimeMs 0.001ms 浮点差异为 flaky（09-27 过 09-28 挂）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-ci-failures-sweep/requirements.md#FR-04
最近确认：e31d0e07bd259252cdced59554fba8de5bec566a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-ci-failures-sweep:flow:FR-04
  tests: sillyhub-daemon/tests/turn-control-attachment-atomic.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-ci-failures-sweep
  status: active

## FR-auto-sillyhub-daemon-016 上列 backend/frontend/daemon/e2e 失败用例根因定位并修复，本地仅跑相关测
变更：2026-09-28-ci-failures-sweep
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given e2e / 测试 相关模块就绪；When 上列 backend/frontend/daemon/e2e 失败用例根因定位并修复，本地仅跑相关测试通过；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-ci-failures-sweep/requirements.md#FR-05
最近确认：e31d0e07bd259252cdced59554fba8de5bec566a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-ci-failures-sweep:flow:FR-05
  tests: backend/app/modules/platform_sync/tests/test_change_deleted_guard.py | backend/app/modules/platform_sync/tests/test_thin_stage_guard.py | backend/app/modules/spec_workspace/tests/test_soft_delete_change_dir.py | backend/tests/modules/auth/test_rbac_broadcast.py | sillyhub-daemon/tests/helpers/fake-child.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-ci-failures-sweep
  status: active

## FR-auto-sillyhub-daemon-017 修复不违背「非测试逻辑本身有误时禁止改测试通过」原则：实现 bug 修实现，测试过时
变更：2026-09-28-ci-failures-sweep
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 修复不违背「非测试逻辑本身有误时禁止改测试通过」原；Then ：实现 bug 修实现，测试过时
全文：.sillyspec/changes/archive/2026-09-28-ci-failures-sweep/requirements.md#FR-06
最近确认：e31d0e07bd259252cdced59554fba8de5bec566a

## FR-auto-sillyhub-daemon-018 平台差异修测试断言并注明依据
变更：2026-09-28-ci-failures-sweep
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 测试 相关模块就绪；When 平台差异修测试断言并注明依据；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-ci-failures-sweep/requirements.md#FR-07
最近确认：e31d0e07bd259252cdced59554fba8de5bec566a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-ci-failures-sweep:flow:FR-07
  tests: backend/app/modules/spec_workspace/tests/test_soft_delete_change_dir.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-ci-failures-sweep
  status: active

## FR-auto-sillyhub-daemon-019 flaky 用例（mtime 精度）改为精度容差断言，注明文件系统精度依据
变更：2026-09-28-ci-failures-sweep
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When flaky 用例（mtime 精度）改为精度容差断言，注明文件系统精度依据；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-ci-failures-sweep/requirements.md#FR-08
最近确认：e31d0e07bd259252cdced59554fba8de5bec566a

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-09-28-ci-failures-sweep:flow:FR-08
  tests: sillyhub-daemon/tests/turn-control-attachment-atomic.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-09-28-ci-failures-sweep
  status: active

## FR-auto-sillyhub-daemon-020 推送后四 workflow CI 转绿（或仅剩与本次无关的新失败并说明）
变更：2026-09-28-ci-failures-sweep
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 推送后四 workflow CI 转绿（或仅剩与本次无关的新失败并说明）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-09-28-ci-failures-sweep/requirements.md#FR-09
最近确认：e31d0e07bd259252cdced59554fba8de5bec566a
