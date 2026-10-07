---
author: sillyspec-fr-index
created_at: 2026-10-03T12:34:45.318Z
---

# FR 索引 — auto-backend

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 伪域（auto- 前缀）：由文件路径段投票派生，无模块卡——为该域补模块卡后，新变更将自动落回真域

## FR-auto-backend-091 上报时记录水位（ctx 接管时点累计值）
变更：2026-10-03-local-usage-segment-attribution
状态：active
摘要：默认场景
依据决策：D-001@v1、D-002@v1、D-004@v1
场景正文：
- 场景：默认场景 — Given CLI 上报 entry（带 change_key 或 quick_id 或双空） 同一 entry 连续多次同 ctx 上报 某 entry 水位行数超过 2；When backend 执行 upsert（行覆盖前） 每次上报 插入新水位；Then 插入一行水位记录：ctx + 当行**已落库**五项累计值（invocations/四维 token，无旧行或 NULL 快照按 0）+ reported_at
全文：.sillyspec/changes/archive/2026-10-03-local-usage-segment-attribution/requirements.md#FR-01
最近确认：ba6e699c8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-03-local-usage-segment-attribution:task-02:acc-0-5060d5df
  tests: backend/app/modules/platform_sync/tests/test_agent_log_push.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-03-local-usage-segment-attribution
  status: active

## FR-auto-backend-092 聚合本地段改水位差分（双路径）
变更：2026-10-03-local-usage-segment-attribution
状态：active
摘要：默认场景
依据决策：D-001@v1
场景正文：
- 场景：默认场景 — Given 变更 X 的某日志 entry 存在水位行 某 entry 无水位行（存量/回填数据） 水位 ctx 双 NULL（无变更上下文的上报） quicklog（qu；When 聚合 X 的本地用量 聚合 聚合 聚合；Then X 的量 = Σ over 水位 w(ctx=X)：max(0, 下一水位值 − w 值) 五项（无下一水位取 entry 当前快照值）；api_request
全文：.sillyspec/changes/archive/2026-10-03-local-usage-segment-attribution/requirements.md#FR-02
最近确认：ba6e699c8

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-03-local-usage-segment-attribution:task-03:acc-0-dcd82f34
  tests: backend/app/modules/change/tests/test_usage_stats.py
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-03-local-usage-segment-attribution
  status: active

## FR-auto-backend-093 时序守恒
变更：2026-10-03-local-usage-segment-attribution
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 序列：上报(ctx=A) → 异步摄取刷快照至 V（含 A 尾巴）→ 上报(ctx=B) 序列：上报(ctx=A) → 上报(ctx=B)（A 时期摄取尚未落库；When 计算 A 与 B 的量 计算 A/B/C 与文件累计 首次上报插首水位 mark=V0 后聚合；Then A = mark_B − mark_A（含尾巴）、B = 当前快照 − mark_B——Σ = 文件累计，无缺口无重叠（max(0,·) 防御重置类异常） Σ(
全文：.sillyspec/changes/archive/2026-10-03-local-usage-segment-attribution/requirements.md#FR-03
最近确认：ba6e699c8

## FR-auto-backend-094 兼容与回退
变更：2026-10-03-local-usage-segment-attribution
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 存量 410 条回填快照（无水位） 迁移回退（downgrade）；When 上线后聚合 执行；Then 数字与改造前一致（整行路径） 水位表删除，聚合全部回落整行路径（与改造前一致）；API/DTO 零变化
全文：.sillyspec/changes/archive/2026-10-03-local-usage-segment-attribution/requirements.md#FR-04
最近确认：ba6e699c8

## FR-auto-backend-095 spec-sync 自动连动任务表重解析
变更：2026-10-07-spec-sync-task-reparse
状态：active
摘要：任务卡改写跟随
场景正文：
- 场景：任务卡改写跟随 — Given 厚档变更已有 4 张任务卡且任务表已解析 4 行；When 增量同步落盘改题后的 task-01 与新增 task-05（change_dirs 标注该变更）；Then drain 后任务表 5 行、task-01 标题为新值
全文：.sillyspec/changes/archive/2026-10-07-spec-sync-task-reparse/requirements.md#FR-01
最近确认：f82bc067ca74946ac7c6b88d4e6382e54e6c665c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-07-spec-sync-task-reparse:flow:测试绑定FR-01
  tests: backend/app/modules/spec_workspace/tests/test_task_reparse_on_sync.py「test_tasks_md_rewrite_updates_task_rows」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-07-spec-sync-task-reparse
  status: active

## FR-auto-backend-096 测试覆盖连动与失败面
变更：2026-10-07-spec-sync-task-reparse
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-10-07-spec-sync-task-reparse/requirements.md#FR-02
最近确认：f82bc067ca74946ac7c6b88d4e6382e54e6c665c

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-07-spec-sync-task-reparse:flow:测试绑定FR-02
  tests: backend/app/modules/spec_workspace/tests/test_task_reparse_on_sync.py「test_task_reparse_failure_does_not_block_sync」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-07-spec-sync-task-reparse
  status: active

## FR-auto-backend-097 任务板解析 tasks.md 注册表行
变更：2026-10-07-taskboard-tasks-md
状态：active
摘要：thin 变更进任务板
场景正文：
- 场景：thin 变更进任务板 — Given thin 变更只有 tasks.md（两行：一勾一未勾），无任务卡目录；When 增量同步落盘 tasks.md 并连动 reparse；Then 任务板出现 task-01(done)/task-02(draft) 两行；改写勾选后跟随为全 done
全文：.sillyspec/changes/archive/2026-10-07-taskboard-tasks-md/requirements.md#FR-01
最近确认：fbf4ae2753b9bbf2a14d929ecd2c900b533d6100

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-07-taskboard-tasks-md:flow:测试绑定FR-01
  tests: backend/app/modules/task/tests/test_parser.py「TestTasksMdRegistryLines.test_thin_tasks_md_only」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-07-taskboard-tasks-md
  status: active

## FR-auto-backend-098 测试双覆盖
变更：2026-10-07-taskboard-tasks-md
状态：active
摘要：（无场景名）
全文：.sillyspec/changes/archive/2026-10-07-taskboard-tasks-md/requirements.md#FR-02
最近确认：fbf4ae2753b9bbf2a14d929ecd2c900b533d6100

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-07-taskboard-tasks-md:flow:测试绑定FR-02
  tests: backend/app/modules/spec_workspace/tests/test_task_reparse_on_sync.py「test_thin_tasks_md_registry_reaches_task_board」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-07-taskboard-tasks-md
  status: active

## FR-auto-backend-099 backend/tests/test_align_platform_change_events_migration.py 链尾锚更新为当前唯一 head 20261006200000 且该文件全绿
变更：2026-10-07-ci-failures-sweep
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given versions 目录含 20261006120000→20261006200000 两新迁移 / When test_file_exists_and_sing
全文：.sillyspec/changes/archive/2026-10-07-ci-failures-sweep/requirements.md#FR-01
最近确认：4a538caa395a449c33567c50bf18c219b65a4466

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-07-ci-failures-sweep:flow:测试绑定FR-01
  tests: backend/tests/test_align_platform_change_events_migration.py「TestMigrationStructure::test_file_exists_and_single_head_chain」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-07-ci-failures-sweep
  status: active

## FR-auto-backend-100 test_files_router.py fixture 确定性选取活跃 change（不依赖排序巧合），test_list_files 全绿
变更：2026-10-07-ci-failures-sweep
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given fixtures 含归档 change（changes/archive/ 子树）/ When 列表排序把归档行排首（CI Linux 同刻 mtime 实况）/
全文：.sillyspec/changes/archive/2026-10-07-ci-failures-sweep/requirements.md#FR-02
最近确认：4a538caa395a449c33567c50bf18c219b65a4466

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-07-ci-failures-sweep:flow:测试绑定FR-02
  tests: backend/app/modules/change/tests/test_files_router.py「test_list_files」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-07-ci-failures-sweep
  status: active

## FR-auto-backend-101 test_attachment_pipeline.py 两个 group 装配用例 member 夹具补 config_snapshot 并断言 D-003 模型透传，全绿
变更：2026-10-07-ci-failures-sweep
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given member.config_snapshot={"model": "glm-4.7"} / When 群装配执行 / Then resolve_session_
全文：.sillyspec/changes/archive/2026-10-07-ci-failures-sweep/requirements.md#FR-03
最近确认：4a538caa395a449c33567c50bf18c219b65a4466

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-07-ci-failures-sweep:flow:测试绑定FR-03
  tests: backend/app/modules/daemon/tests/test_attachment_pipeline.py「TestGroupWrapperEquivalence::test_group_assembly_gate_basis_owner_and_member / test_group_assembly_member_provider_fallback_claude」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-07-ci-failures-sweep
  status: active

## FR-auto-backend-102 test_archived_write_guard.py 懒激活退役用例改断言 TOOL_REPORT_TAKEOVER_INVALID（归档写入口兜底由 create 链既有守卫用例覆盖），全绿
变更：2026-10-07-ci-failures-sweep
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 归档工作区 + pending tool_report 会话 / When POST inject / Then 409 code=HTTP_409_TOOL_
全文：.sillyspec/changes/archive/2026-10-07-ci-failures-sweep/requirements.md#FR-04
最近确认：4a538caa395a449c33567c50bf18c219b65a4466

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-07-ci-failures-sweep:flow:测试绑定FR-04
  tests: backend/app/modules/workspace/tests/test_archived_write_guard.py「test_tool_report_activation_on_archived_returns_409」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-07-ci-failures-sweep
  status: active

## FR-auto-backend-103 precipitate-dialog.test.tsx 载荷断言回归 model 单串契约，全绿
变更：2026-10-07-ci-failures-sweep
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 选定供应商+选定模型 glm-4.7 / When 提交派发 / Then 载荷含 llm_provider_id + model: "glm-4.7"，无 m
全文：.sillyspec/changes/archive/2026-10-07-ci-failures-sweep/requirements.md#FR-05
最近确认：4a538caa395a449c33567c50bf18c219b65a4466

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-07-ci-failures-sweep:flow:测试绑定FR-05
  tests: frontend/src/components/knowledge/__tests__/precipitate-dialog.test.tsx「选定供应商 → 「获取模型」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-07-ci-failures-sweep
  status: active

## FR-auto-backend-104 pre-session-picker.test.tsx 两处 caps 期望对象恢复 multimodal 键，全绿
变更：2026-10-07-ci-failures-sweep
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given provider-caps.ts 查表含 multimodal / When 全对象断言执行 / Then 两处期望对象 16 键全量相等。
全文：.sillyspec/changes/archive/2026-10-07-ci-failures-sweep/requirements.md#FR-06
最近确认：4a538caa395a449c33567c50bf18c219b65a4466

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-07-ci-failures-sweep:flow:测试绑定FR-06
  tests: frontend/src/components/sessions/__tests__/pre-session-picker.test.tsx「十六键与 daemon 单源一致；未知 provider 默认拒绝（boolean 全 false + dialog/sessionFork none）不抛错」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-07-ci-failures-sweep
  status: active

## FR-auto-backend-105 sessions page.test.tsx 供应商 mock 补 agent_kinds 必填字段，whoLine 用例全绿
变更：2026-10-07-ci-failures-sweep
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given mock 供应商含 agent_kinds / When 渲染会话面板 / When attach 拉 run 快照 / Then 轮次配置快照 whoLine
全文：.sillyspec/changes/archive/2026-10-07-ci-failures-sweep/requirements.md#FR-07
最近确认：4a538caa395a449c33567c50bf18c219b65a4466

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-07-ci-failures-sweep:flow:测试绑定FR-07
  tests: frontend/src/app/(dashboard)/sessions/__tests__/page.test.tsx「历史轮 whoLine 按 run 快照渲染（档案快照名 / 会话 agent_name / 供应商名对照）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-07-ci-failures-sweep
  status: active

## FR-auto-backend-106 本地仅跑上述相关测试文件全绿（全量留给 CI），四 workflow 推送后全绿
变更：2026-10-07-ci-failures-sweep
状态：active
摘要：主路径
场景正文：
- 场景：主路径 — Given 上述修复落地 / When 本地跑相关文件 / Then 全绿；When push 到 main / When GitHub Actions 四 workflo
全文：.sillyspec/changes/archive/2026-10-07-ci-failures-sweep/requirements.md#FR-08
最近确认：4a538caa395a449c33567c50bf18c219b65a4466
