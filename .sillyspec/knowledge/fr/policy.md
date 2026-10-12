---
author: sillyspec-fr-index
created_at: 2026-10-12T23:28:08.903Z
---

# FR 索引 — policy

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/policy.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-policy-001 task-runner 渲染轨生产路径（spawn-stream handleLine）传入 MessageCoalescer：流式 delta 缓冲合并为单行提交，attempt 收尾 flushAll 残留缓冲冲刷转发（宁碎片不丢内容），新增测试证明接线后多条 delta 仅产出一行合并内容+完结行、流结束残留被冲刷
变更：2026-10-13-review-risk-fixes
状态：active
摘要：多条 delta 合并为单行；attempt 收尾残留冲刷；透传断言
全文：.sillyspec/changes/archive/2026-10-13-review-risk-fixes/requirements.md#FR-01
最近确认：4caba5b215fd2dc2147694f0afaf9aec48ce936d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-review-risk-fixes:flow:测试绑定FR-01
  tests: sillyhub-daemon/tests/task-runner/spawn-stream-coalescer.test.ts「handleLine 透传 coalescer / 多 delta 合并单行 / 收尾 flushAll 冲刷转发」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-review-risk-fixes
  status: active

## FR-policy-002 backend 启动清理的 AskUserQuestion 等待豁免加 24h 时间上限：最后 ask 信号超龄后不再豁免、按既有判死路径收口，测试覆盖时限内豁免与超时限判死两分支
变更：2026-10-13-review-risk-fixes
状态：active
摘要：时限内豁免（零回归）；超时限判死（防会话永久楔死）
全文：.sillyspec/changes/archive/2026-10-13-review-risk-fixes/requirements.md#FR-02
最近确认：4caba5b215fd2dc2147694f0afaf9aec48ce936d

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-13-review-risk-fixes:flow:测试绑定FR-02
  tests: backend/app/modules/agent/tests/test_cleanup_stale_runs_error_code.py「test_stale_run_awaiting_user_ask_over_24h_killed / 既有 test_stale_run_awaiting_user_answer_skipped 零回归」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-13-review-risk-fixes
  status: active

## FR-policy-003 path-utils.ts isPathUnderAnyRoot 注释与实现对齐（anchor 仅 target 透传，roots 维持单参解析）
变更：2026-10-13-review-risk-fixes
状态：active
摘要：注释对齐
全文：.sillyspec/changes/archive/2026-10-13-review-risk-fixes/requirements.md#FR-03
最近确认：4caba5b215fd2dc2147694f0afaf9aec48ce936d

## FR-policy-004 shell-paths.ts isFlagToken 注释补记已知残留放行面（- 开头文件名不进白名单校验）与 cd 盲区既有边界
变更：2026-10-13-review-risk-fixes
状态：active
摘要：注释记档
全文：.sillyspec/changes/archive/2026-10-13-review-risk-fixes/requirements.md#FR-04
最近确认：4caba5b215fd2dc2147694f0afaf9aec48ce936d

## FR-policy-005 sillyhub-daemon 定向 vitest（event-wire/task-runner/coalescer）+ pnpm typecheck 通过；backend 定向 pytest（stale runs 两文件）通过；不跑全量
变更：2026-10-13-review-risk-fixes
状态：active
摘要：定向验收
全文：.sillyspec/changes/archive/2026-10-13-review-risk-fixes/requirements.md#FR-05
最近确认：4caba5b215fd2dc2147694f0afaf9aec48ce936d
