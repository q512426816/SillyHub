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
