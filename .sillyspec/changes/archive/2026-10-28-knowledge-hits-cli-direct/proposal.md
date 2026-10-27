---
author: flow-machine-draft
created_at: 2026-10-27T20:44:33.086Z
---
# 提案书（Proposal）— 2026-10-28-knowledge-hits-cli-direct

## 动机

任务原话转写：CLI 直报主通道的接收侧（用户拍板方案收尾）：CLI 侧只持有 shpsync_ 平台令牌（workspace 从令牌派生，无显式 workspace_id），现有 POST /knowledge/hits/batch 走 require_permission 用户鉴权调不通——照 platform_sync 命名空间 spec-sync 字面量端点先例新增接收端点，供 sillyspec 仓另立变更的写后直报调用。

成功标准：
- backend 新增 POST /changes/-/hits-sync（platform_sync 命名空间，字面量路由注册序先例同 spec-sync）：require_platform_sync_write 鉴权，workspace_id 从 shpsync_ 令牌派生，无归属 403 fail-closed
- 请求体 HitsBatchIn / 响应 HitsBatchOut 与现有 hits/batch 完全同构，落库复用 HitsService.ingest_batch（行 hash 幂等去重语义不变），daemon_local_id 落调用方标识（CLI 传 cli-<user> 或缺省）
- daemon_local_id 与既有通道行可区分（数据层留归属，统计口径不受影响——USAGE_TYPES 聚合同源）
- 相关单测通过：shpsync_ 鉴权派生落库路 / 无归属 403 / 坏行宽容计数与既有 ingest 语义一致
- backend schema 改动同变更内跑前端与 daemon 的 pnpm gen:types 并提交三件

## 变更范围

按成功标准机械推导，共 5 条验收面：
1. backend 新增 POST /changes/-/hits-sync（platform_sync 命名空间，字面量路由注册序先例同 spec-sync）：require_platform_sync_write 鉴权，workspace_id 从 shpsync_ 令牌派生，无归属 403 fail-closed
2. 请求体 HitsBatchIn / 响应 HitsBatchOut 与现有 hits/batch 完全同构，落库复用 HitsService.ingest_batch（行 hash 幂等去重语义不变），daemon_local_id 落调用方标识（CLI 传 cli-<user> 或缺省）
3. daemon_local_id 与既有通道行可区分（数据层留归属，统计口径不受影响——USAGE_TYPES 聚合同源）
4. 相关单测通过：shpsync_ 鉴权派生落库路 / 无归属 403 / 坏行宽容计数与既有 ingest 语义一致
5. backend schema 改动同变更内跑前端与 daemon 的 pnpm gen:types 并提交三件

## 成功标准（可验证）

1. backend 新增 POST /changes/-/hits-sync（platform_sync 命名空间，字面量路由注册序先例同 spec-sync）：require_platform_sync_write 鉴权，workspace_id 从 shpsync_ 令牌派生，无归属 403 fail-closed
2. 请求体 HitsBatchIn / 响应 HitsBatchOut 与现有 hits/batch 完全同构，落库复用 HitsService.ingest_batch（行 hash 幂等去重语义不变），daemon_local_id 落调用方标识（CLI 传 cli-<user> 或缺省）
3. daemon_local_id 与既有通道行可区分（数据层留归属，统计口径不受影响——USAGE_TYPES 聚合同源）
4. 相关单测通过：shpsync_ 鉴权派生落库路 / 无归属 403 / 坏行宽容计数与既有 ingest 语义一致
5. backend schema 改动同变更内跑前端与 daemon 的 pnpm gen:types 并提交三件
