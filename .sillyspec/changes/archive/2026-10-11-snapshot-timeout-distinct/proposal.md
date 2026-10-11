---
author: flow-machine-draft
created_at: 2026-10-11T05:04:48.021Z
---
# 提案书（Proposal）— 2026-10-11-snapshot-timeout-distinct

## 动机

任务原话转写：local-snapshot 的 daemon_offline 误报实证（用户生产案例 2026-10-11）：daemon 自更新后进程未重启跑旧代码，旧 dispatch 对未知 RPC 静默不回 → 15s 超时被并入 daemon_offline 显示「守护进程离线」，但机器实际在线——误导排障方向。修复：超时从离线态拆分独立状态与引导文案。
成功标准：
- LocalSnapshotResponse 的 status 拆出 daemon_timeout 五态（offline=无 WS 连接/timeout=连接在但 15s 无响应），router 按异常类型精确映射不再 except-All 归 offline
- 超时态前端文案引导正确方向：「守护进程无响应——若刚更新过 daemon 请重启进程」（本案例根因即此）
- 既有四态（ok/offline/unsupported/binding_missing）行为回归不变；api-types 重新生成同步
- 仅跑改动相关测试 + typecheck/lint 绿，全量留给 CI

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. LocalSnapshotResponse 的 status 拆出 daemon_timeout 五态（offline=无 WS 连接/timeout=连接在但 15s 无响应），router 按异常类型精确映射不再 except-All 归 offline
2. 超时态前端文案引导正确方向：「守护进程无响应——若刚更新过 daemon 请重启进程」（本案例根因即此）
3. 既有四态（ok/offline/unsupported/binding_missing）行为回归不变；api-types 重新生成同步
4. 仅跑改动相关测试 + typecheck/lint 绿，全量留给 CI

## 成功标准（可验证）

1. LocalSnapshotResponse 的 status 拆出 daemon_timeout 五态（offline=无 WS 连接/timeout=连接在但 15s 无响应），router 按异常类型精确映射不再 except-All 归 offline
2. 超时态前端文案引导正确方向：「守护进程无响应——若刚更新过 daemon 请重启进程」（本案例根因即此）
3. 既有四态（ok/offline/unsupported/binding_missing）行为回归不变；api-types 重新生成同步
4. 仅跑改动相关测试 + typecheck/lint 绿，全量留给 CI
