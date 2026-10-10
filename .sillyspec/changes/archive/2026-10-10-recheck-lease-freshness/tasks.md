---
author: flow-machine-draft
created_at: 2026-10-10T00:34:34.662Z
---
# 任务注册表（Tasks）— 2026-10-10-recheck-lease-freshness

- [x] task-01: _run_daemon_alive 实例 online 分支必须叠加最新 lease 续约新鲜度核验：lease updated_at 停滞超宽限窗（STALE_RUN_ACTIVE_GRACE）→ 返回 False（实例活着但已放弃此 run），fall through 判死出列
- [x] task-02: 健康 run（日志停滞但 lease 续约新鲜，如等用户应答/长工具调用）必须保持不判死；daemon 确死/链路不可解析语义不变
- [x] task-03: 新增用例先红后绿：实例 online+心跳新鲜+lease updated_at 停滞 1h → 判死 failed/SERVICE_RESTART_INTERRUPTED；既有 pardons 用例 fixture 对齐真实续约时序（lease 新鲜）零回归
