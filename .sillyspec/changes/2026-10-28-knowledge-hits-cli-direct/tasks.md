---
author: flow-machine-draft
created_at: 2026-10-27T20:44:33.086Z
---
# 任务注册表（Tasks）— 2026-10-28-knowledge-hits-cli-direct

- [x] task-01: backend 新增 POST /changes/-/hits-sync（platform_sync 命名空间，字面量路由注册序先例同 spec-sync）：require_platform_sync_write 鉴权，workspace_id 从 shpsync_ 令牌派生，无归属 403 fail-closed
- [x] task-02: 请求体 HitsBatchIn / 响应 HitsBatchOut 与现有 hits/batch 完全同构，落库复用 HitsService.ingest_batch（行 hash 幂等去重语义不变），daemon_local_id 落调用方标识（CLI 传 cli-<user> 或缺省）
- [x] task-03: daemon_local_id 与既有通道行可区分（数据层留归属，统计口径不受影响——USAGE_TYPES 聚合同源）
- [x] task-04: 相关单测通过：shpsync_ 鉴权派生落库路 / 无归属 403 / 坏行宽容计数与既有 ingest 语义一致
- [x] task-05: backend schema 改动同变更内跑前端与 daemon 的 pnpm gen:types 并提交三件

> 执行留痕（2026-10-27）：task-01~05 单次连续会话完成——端点（platform_sync/router.py 字面量块内，注册序前置）+ 测试 6 例全绿（test_hits_cli_direct.py）+ gen:types 三件。共享仓既有红留痕：test_agent_log_push.py 6 failed 经 stash 归属判别为并行变更 2026-10-28-change-detail-sessions-source-fix 的 session 域中间态（移除本变更 router.py 改动后失败依旧），非本变更引入，不阻断。
