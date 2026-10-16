---
author: sillyspec-fr-index
created_at: 2026-10-02T02:55:12.745Z
---

# FR 索引 — change

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/change.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-auto-sillyspec-040 「任务注册表（Tasks）— <变更名>」「设计记录（Design Record）— <变更名>」「
变更：2026-10-02-title-norm-thin-h1-family
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 「任务注册表（Tasks）— <变更名>」「设计记录（Design Record）— <变更名>」「决策记录（Decisions）— <变更名>」「验证回执（f；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-02-title-norm-thin-h1-family/requirements.md#FR-01
最近确认：c854d89601d8529ac2d1e883f41972b287a89a27

## FR-auto-sillyspec-041 is_fallback_display_title 对上述 raw 模板标题判 True（存量污染行
变更：2026-10-02-title-norm-thin-h1-family
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When is_fallback_display_title 对上述 raw 模板标题判 True（存量污染行可被后续推送/reparse 自愈刷新）；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-02-title-norm-thin-h1-family/requirements.md#FR-02
最近确认：c854d89601d8529ac2d1e883f41972b287a89a27

## FR-auto-sillyspec-042 收养语义标题在 thin 模板四件套 documents 推送后不回翻
变更：2026-10-02-title-norm-thin-h1-family
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 收养语义标题在 thin 模板四件套 documents 推送后不回翻；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-02-title-norm-thin-h1-family/requirements.md#FR-03
最近确认：c854d89601d8529ac2d1e883f41972b287a89a27

## FR-auto-sillyspec-043 既有词表条目与冒号自定义标题行为不变
变更：2026-10-02-title-norm-thin-h1-family
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When 既有词表条目与冒号自定义标题行为不变；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-02-title-norm-thin-h1-family/requirements.md#FR-04
最近确认：c854d89601d8529ac2d1e883f41972b287a89a27

## FR-auto-sillyspec-044 backend test_title_normalization.py 新增用例全绿且既有用例无回归
变更：2026-10-02-title-norm-thin-h1-family
状态：active
骨架：thin
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 系统就绪；When backend test_title_normalization.py 新增用例全绿且既有用例无回归；Then 行为符合本条标准描述
全文：.sillyspec/changes/archive/2026-10-02-title-norm-thin-h1-family/requirements.md#FR-05
最近确认：c854d89601d8529ac2d1e883f41972b287a89a27

## FR-change-001 后端 _FILES_REFRESH_SYNC_RPC_TIMEOUT_S 从 3s 放宽到 15s（覆盖实测 6~13.5s 同步耗时）
变更：2026-10-16-change-files-sync-result
状态：active
摘要：真实同步在预算内完成；超预算仍降级不阻断
全文：.sillyspec/changes/archive/2026-10-16-change-files-sync-result/requirements.md#FR-01
最近确认：7ca3e7ba66d5d065715a08ea885d064b2617e3e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-change-files-sync-result:flow:测试绑定FR-01
  tests: backend/app/modules/change/tests/test_files_refresh_sync.py「test_sync_budget_covers_measured_cli_runtime」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-change-files-sync-result
  status: active

## FR-change-002 后端消费 sillyspec_sync_change 回执：ok:false/超时/远程错误/连接丢失记 warning 日志（含 reason 与 stderr_tail），成功与防抖跳过记 info
变更：2026-10-16-change-files-sync-result
状态：active
摘要：CLI 失败回执透传；防抖跳过不算失败；四路异常降级留痕
全文：.sillyspec/changes/archive/2026-10-16-change-files-sync-result/requirements.md#FR-02
最近确认：7ca3e7ba66d5d065715a08ea885d064b2617e3e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-change-files-sync-result:flow:测试绑定FR-02
  tests: backend/app/modules/change/tests/test_files_refresh_sync.py「test_daemon_cli_failure_result_propagates / test_daemon_no_workspace_root_result_propagates / test_daemon_debounce_skip_maps_to_info / test_rpc_timeout_degrades / test_rpc_remote_error_degrades_old_daemon / test_runtime_offline_degrades」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-change-files-sync-result
  status: active

## FR-change-003 GET files?sync=1 响应新增可选 sync_result 字段（triggered/ok/reason/stderr_tail）；默认纯读不带（null）
变更：2026-10-16-change-files-sync-result
状态：active
摘要：纯读不带回执；未触发可区分
全文：.sillyspec/changes/archive/2026-10-16-change-files-sync-result/requirements.md#FR-03
最近确认：7ca3e7ba66d5d065715a08ea885d064b2617e3e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-change-files-sync-result:flow:测试绑定FR-03
  tests: backend/app/modules/change/tests/test_files_refresh_sync.py「test_online_triggers_sync_before_list / test_default_read_only_skips_sync / test_no_binding_skips_sync / test_daemon_offline_skips_sync / test_binding_without_daemon_id_skips_sync」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-change-files-sync-result
  status: active

## FR-change-004 前端「刷新」按钮：sync_result 失败或未触发时展示同步未完成提示（含原因中文标注），文件树照常展示；成功与防抖跳过不提示
变更：2026-10-16-change-files-sync-result
状态：active
摘要：失败可见且不挡文件树；先失败后成功自动清除
全文：.sillyspec/changes/archive/2026-10-16-change-files-sync-result/requirements.md#FR-04
最近确认：7ca3e7ba66d5d065715a08ea885d064b2617e3e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-change-files-sync-result:flow:测试绑定FR-04
  tests: frontend/src/components/__tests__/change-file-tree-sync-feedback.test.tsx「刷新回执提示 6 例」 | frontend/src/lib/__tests__/change-file-sync.test.ts「changeFileSyncWarningText 全分支（10 例）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-change-files-sync-result
  status: active

## FR-change-005 新增/更新后端与前端测试全绿，既有 test_files_refresh_sync.py 各路用例语义不回归
变更：2026-10-16-change-files-sync-result
状态：active
摘要：回归面被守护
全文：.sillyspec/changes/archive/2026-10-16-change-files-sync-result/requirements.md#FR-05
最近确认：7ca3e7ba66d5d065715a08ea885d064b2617e3e9

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-16-change-files-sync-result:flow:测试绑定FR-05
  tests: frontend/src/lib/__tests__/change-file-sync.test.ts
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-16-change-files-sync-result
  status: active

## FR-change-006 后端 openapi.json 与前端/daemon api-types.ts 依据 pnpm gen:types 重新生成并提交
变更：2026-10-16-change-files-sync-result
状态：active
摘要：类型与 schema 同步
全文：.sillyspec/changes/archive/2026-10-16-change-files-sync-result/requirements.md#FR-06
最近确认：7ca3e7ba66d5d065715a08ea885d064b2617e3e9
