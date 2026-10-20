---
author: sillyspec-fr-index
created_at: 2026-10-20T00:11:44.578Z
---

# FR 索引 — scripts

> fr-index 从归档变更 requirements.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为机械解析契约，勿手改。
> superseded 条目保留供取代链回溯；brainstorm 注入默认只给 active。
> 模块卡：modules/scripts.md（域=模块 id 同构；行为条目↔模块契约互跳）

## FR-scripts-001 python scripts/backfill_commit_type.py 裸跑零落盘（输出计划写入与汇总）；--apply 不带 --yes 拒绝执行退出码 2；--apply --yes 落盘行为与原执行路径一致（幂等 unchanged 不写、CRLF 保留）
变更：2026-10-20-backfill-dryrun-log-scrub
状态：active
摘要：裸跑即安全；确认门拦截；显式落盘与幂等
全文：.sillyspec/changes/archive/2026-10-20-backfill-dryrun-log-scrub/requirements.md#FR-01
最近确认：3490518aa9925709efdbf3880a441593fb04d89f

## FR-scripts-002 zcode-app-server-driver.ts 不再输出含 cwd 的 spawn 明文日志；daemon 既有 zcode 相关测试全绿
变更：2026-10-20-backfill-dryrun-log-scrub
状态：active
摘要：spawn 无明文 cwd 日志
全文：.sillyspec/changes/archive/2026-10-20-backfill-dryrun-log-scrub/requirements.md#FR-02
最近确认：3490518aa9925709efdbf3880a441593fb04d89f

测试绑定：
<!-- test-bindings: 机器字段（sillyspec tests 管理），勿手改 -->
- row: 2026-10-20-backfill-dryrun-log-scrub:flow:测试绑定FR-02
  tests: sillyhub-daemon/tests/interactive/zcode-app-server-driver.test.ts「既有 zcode driver 用例全绿（回归面，行为零变化）」
  reason: spec
  state: candidate
  discovery: machine
  confirmed_by: null
  confirmed_at: null
  source_change: 2026-10-20-backfill-dryrun-log-scrub
  status: active
