---
author: flow-machine-draft
created_at: 2026-10-10T00:34:34.662Z
---
# 提案书（Proposal）— 2026-10-10-recheck-lease-freshness

## 动机

任务原话转写：24h 审查发现复扫链 daemon 活性门只看实例 online 即豁免判死：daemon 进程重启丢失 run 执行状态但实例重新上线时，日志停滞+实例在线 → run 永卡 running、复扫链永驻空转（patrol 对 online 实例同样豁免，无第二兜底）。关键事实：健康 run 的 lease 由 daemon 每 lease_heartbeat_interval（默认 5s）续约刷新 updated_at，daemon 重启丢态后不再续约。
成功标准：
- _run_daemon_alive 实例 online 分支必须叠加最新 lease 续约新鲜度核验：lease updated_at 停滞超宽限窗（STALE_RUN_ACTIVE_GRACE）→ 返回 False（实例活着但已放弃此 run），fall through 判死出列
- 健康 run（日志停滞但 lease 续约新鲜，如等用户应答/长工具调用）必须保持不判死；daemon 确死/链路不可解析语义不变
- 新增用例先红后绿：实例 online+心跳新鲜+lease updated_at 停滞 1h → 判死 failed/SERVICE_RESTART_INTERRUPTED；既有 pardons 用例 fixture 对齐真实续约时序（lease 新鲜）零回归

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. _run_daemon_alive 实例 online 分支必须叠加最新 lease 续约新鲜度核验：lease updated_at 停滞超宽限窗（STALE_RUN_ACTIVE_GRACE）→ 返回 False（实例活着但已放弃此 run），fall through 判死出列
2. 健康 run（日志停滞但 lease 续约新鲜，如等用户应答/长工具调用）必须保持不判死；daemon 确死/链路不可解析语义不变
3. 新增用例先红后绿：实例 online+心跳新鲜+lease updated_at 停滞 1h → 判死 failed/SERVICE_RESTART_INTERRUPTED；既有 pardons 用例 fixture 对齐真实续约时序（lease 新鲜）零回归

## 成功标准（可验证）

1. _run_daemon_alive 实例 online 分支必须叠加最新 lease 续约新鲜度核验：lease updated_at 停滞超宽限窗（STALE_RUN_ACTIVE_GRACE）→ 返回 False（实例活着但已放弃此 run），fall through 判死出列
2. 健康 run（日志停滞但 lease 续约新鲜，如等用户应答/长工具调用）必须保持不判死；daemon 确死/链路不可解析语义不变
3. 新增用例先红后绿：实例 online+心跳新鲜+lease updated_at 停滞 1h → 判死 failed/SERVICE_RESTART_INTERRUPTED；既有 pardons 用例 fixture 对齐真实续约时序（lease 新鲜）零回归
