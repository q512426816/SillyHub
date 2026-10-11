---
author: sillyspec-fr-index
created_at: 2026-10-08T15:19:22.662Z
---

# FR 索引 — auto-sillyhub-daemon

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-sillyhub-daemon-021 git-log-page.test.tsx TABS 数量钉 15→16（用例名+头注释同步），该文件全绿
变更：2026-10-08-ci-sweep-2
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given WorkspaceTabs 注册 16 键（知识图谱插知识库后）/ When 渲染取 link / Then toHaveLength(16) 且 Git 日志
全文：.sillyspec/changes/archive/2026-10-08-ci-sweep-2/requirements.md#FR-01
最近确认：97c6598b93fd8f805dda5ab1c3f94386881a116b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-ci-sweep-2:flow:测试绑定FR-01
  tests: frontend/src/components/git-log/__tests__/git-log-page.test.tsx「TABS 增至 16 项，「Git 日志」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-ci-sweep-2
  status: active

## FR-auto-sillyhub-daemon-022 test_cleanup_stale_runs_error_code.py error_detail 期望改新文案（reason=no daemon activity within grace window (startup cleanup / deferred recheck)/finished_by=stale_run_cleanup），全绿
变更：2026-10-08-ci-sweep-2
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 无可恢复元数据的 stale run / When _cleanup_stale_runs_impl 执行 / Then error_detail 等于新文案两
全文：.sillyspec/changes/archive/2026-10-08-ci-sweep-2/requirements.md#FR-02
最近确认：97c6598b93fd8f805dda5ab1c3f94386881a116b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-ci-sweep-2:flow:测试绑定FR-02
  tests: backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py「test_stale_run_failed_branch_writes_error_code」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-ci-sweep-2
  status: active

## FR-auto-sillyhub-daemon-023 sillyspec-platform-command.test.ts 6 处与 selfupdate-scenarios.test.ts 2 处 length 断言 10→11（带 task-02 machine-id 尾参注释，同 daemon-heartbeat 先例），全绿
变更：2026-10-08-ci-sweep-2
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 心跳 11 参平铺（第 11 machineId，undefined 占位）/ When 断言 call.length / Then toBe(11) 且第 7
全文：.sillyspec/changes/archive/2026-10-08-ci-sweep-2/requirements.md#FR-03
最近确认：97c6598b93fd8f805dda5ab1c3f94386881a116b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-ci-sweep-2:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/integration/selfupdate-scenarios.test.ts「路径④ pending 可见性闭环」 | sillyhub-daemon/tests/sillyspec-platform-command.test.ts「task-07 心跳携带…」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-ci-sweep-2
  status: active

## FR-auto-sillyhub-daemon-024 provider-adapter-registry.test.ts readBackendAgentKindVocab 正则改 agent_kinds 复数 list Literal 形态（注释锚同步），对账恢复夹逼语义，全绿
变更：2026-10-08-ci-sweep-2
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given backend schema 字段为复数 list Literal / When readBackendAgentKindVocab 解析 / Then 词表=
全文：.sillyspec/changes/archive/2026-10-08-ci-sweep-2/requirements.md#FR-04
最近确认：97c6598b93fd8f805dda5ab1c3f94386881a116b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-08-ci-sweep-2:flow:测试绑定FR-04
  tests: sillyhub-daemon/tests/provider-adapter-registry.test.ts「backend agent_kind 词表（源读取解析）⊆ 聚合表键（backend 可下发 kind 必有声明）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-08-ci-sweep-2
  status: active

## FR-auto-sillyhub-daemon-025 本地仅跑相关测试文件全绿（全量留 CI），推送后 frontend-ci/backend-ci/daemon-ci/e2e-ci/scan-drift 全绿
变更：2026-10-08-ci-sweep-2
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 修复落地 / When 本地相关面跑测 / Then 全绿；When push / When 五 workflow 完成 / Then 全部 success。
全文：.sillyspec/changes/archive/2026-10-08-ci-sweep-2/requirements.md#FR-05
最近确认：97c6598b93fd8f805dda5ab1c3f94386881a116b

## FR-auto-sillyhub-daemon-026 tests/protocol-session-contract.test.ts MSG 总数钉 24→25（补 TOMBSTONE_CLEANUP 来历注释），定向 vitest 绿
变更：2026-10-11-daemon-masked-test-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-11-daemon-masked-test-fix/requirements.md#FR-01
最近确认：2e2f4cc17fdda1c14c1bb12669c2e8ac1d0e927b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-daemon-masked-test-fix:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/protocol-session-contract.test.ts「MSG 总数 = 25」
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 004af2936041cba741bbce9afef8a46a6e412c9c
  source_change: 2026-10-11-daemon-masked-test-fix
  status: active

## FR-auto-sillyhub-daemon-027 tests/fixtures/claude-sdk-messages/golden-session.events.json 帧 7/15/29 补 usage.api_duration_ms（500/1100/400）+ 头注再生成记录 + §2 锚点两处同步，定向 vitest 绿
变更：2026-10-11-daemon-masked-test-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-11-daemon-masked-test-fix/requirements.md#FR-02
最近确认：2e2f4cc17fdda1c14c1bb12669c2e8ac1d0e927b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-daemon-masked-test-fix:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/interactive/golden/claude-events-golden.test.ts
  reason: spec
  state: active
  discovery: machine
  confirmed_by: agent
  confirmed_at: 004af2936041cba741bbce9afef8a46a6e412c9c
  source_change: 2026-10-11-daemon-masked-test-fix
  status: active

## FR-auto-sillyhub-daemon-028 tests/daemon-mission-worker-artifact.test.ts 兜底代报载体 pi→codex（caps.mcp 仍 false，机制断言原样保留）+ 新增 pi 零代报钉子（自报路径防双写），定向 vitest 绿
变更：2026-10-11-daemon-masked-test-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-11-daemon-masked-test-fix/requirements.md#FR-03
最近确认：2e2f4cc17fdda1c14c1bb12669c2e8ac1d0e927b

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-11-daemon-masked-test-fix:flow:测试绑定FR-03
  tests: sillyhub-daemon/tests/daemon-mission-worker-artifact.test.ts「mission_worker + codex(mcp=false) + success + 全文非空 → 恰一次代报」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-11-daemon-masked-test-fix
  status: active

## FR-auto-sillyhub-daemon-029 daemon typecheck 过；不跑全量（规则 0），全量留给 CI
变更：2026-10-11-daemon-masked-test-fix
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-11-daemon-masked-test-fix/requirements.md#FR-04
最近确认：2e2f4cc17fdda1c14c1bb12669c2e8ac1d0e927b
