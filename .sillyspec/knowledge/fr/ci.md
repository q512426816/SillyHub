---
author: sillyspec-fr-index
created_at: 2026-10-15T08:08:54.577Z
---

# FR 索引 — ci

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/ci.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-auto-github-001 backend-ci.yml push 与 pull_request 两处 paths 各加 sillyhub-daemon/tests/fixtures/**，workflow 文件自身路径保留
变更：2026-10-11-backend-ci-golden-fixture-path
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-11-backend-ci-golden-fixture-path/requirements.md#FR-01
最近确认：4892540870bff8d45997995ad89d60eb9ed323ed

## FR-auto-github-002 YAML 语法可解析（python yaml.safe_load 过）
变更：2026-10-11-backend-ci-golden-fixture-path
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-11-backend-ci-golden-fixture-path/requirements.md#FR-02
最近确认：4892540870bff8d45997995ad89d60eb9ed323ed

## FR-auto-github-003 不跑全量测试（规则 0），workflow 生效由推送后 backend-ci 实跑验证
变更：2026-10-11-backend-ci-golden-fixture-path
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-11-backend-ci-golden-fixture-path/requirements.md#FR-03
最近确认：4892540870bff8d45997995ad89d60eb9ed323ed

## FR-ci-001 e2e-ci workflow 的 PG service 必须使用含 pgvector 扩展的镜像，迁移链可完整执行
变更：2026-10-26-ci-red-to-green
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-26-ci-red-to-green/requirements.md#FR-01
最近确认：fa5a6fe1108b468f037a94263c1adb76f2e62dc6

## FR-ci-002 daemon 11 个失败用例必须修复——turn_phase 上报不得中断会话创建链，测试夹具须与新源码导出面同步
变更：2026-10-26-ci-red-to-green
状态：active
摘要：主路径；夹具同步
全文：.sillyspec/changes/archive/2026-10-26-ci-red-to-green/requirements.md#FR-02
最近确认：fa5a6fe1108b468f037a94263c1adb76f2e62dc6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-ci-red-to-green:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/interactive/session-thinking-level.test.ts「claim payload snake_case thinking_level → CreateSessionInput.thinkingLevel」 | sillyhub-daemon/tests/interactive/task-lifecycle.test.ts「FR-03 落行：[TASK_STARTED]/[TASK_PROGRESS]/[TASK_NOTIFICATION] flat 行（前缀+单行 JSON task_name 键 + parent_tool_use_id）」 | sillyhub-daemon/tests/spec-transport-tar-sync/daemon-interactive-spec-sync.test.ts「B1: tar 模式 _startInteractiveSession 调 pullSpecBundle，且 await 先于 _sessionManager.create」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-26-ci-red-to-green
  status: active

## FR-ci-003 frontend CI 5 个失败文件必须根因定位并修复——CI 同条件复刻跑必须全绿
变更：2026-10-26-ci-red-to-green
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-26-ci-red-to-green/requirements.md#FR-03
最近确认：fa5a6fe1108b468f037a94263c1adb76f2e62dc6

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-26-ci-red-to-green:flow:测试绑定FR-03
  tests: frontend/src/components/sessions/__tests__/sessions-portal.test.tsx「同机器同智能体再次「＋」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-26-ci-red-to-green
  status: active

## FR-ci-004 修复推送后 GitHub Actions 四条 workflow 必须全绿
变更：2026-10-26-ci-red-to-green
状态：active
摘要：主路径
全文：.sillyspec/changes/archive/2026-10-26-ci-red-to-green/requirements.md#FR-04
最近确认：fa5a6fe1108b468f037a94263c1adb76f2e62dc6
