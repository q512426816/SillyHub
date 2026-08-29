---
author: qinyi
created_at: 2026-08-29 03:28:15
---

# 符号影响面报告（Symbol Impact）— daemon 与平台对接稳定性优化

> 逐 task 列签名级变更（构造参数/接口/DTO/方法签名增删改）+ 受影响调用点 + 是否在任务范围内。无签名级变更也显式声明。

| task | 签名级变更 | 受影响调用点 | 范围内处置 |
|---|---|---|---|
| task-01 | 无既有签名变更；新增符号：DaemonControlCommand 表模型、ControlCommandService（enqueue/mark_delivered/fetch_pending/ack/gc）、alembic 迁移 | 纯新增，无既有调用点 | 新文件+model.py 增类，测试新建 |
| task-02 | 无签名级变更；ws_hub.disconnect 内部挂 10s 延迟任务、runtime/service 新增内部方法 mark_instance_offline_delayed、placement 三处候选查询（1586/1622/1661）加实连接过滤 | ws_hub.disconnect 调用方（router.py WS 端点 finally）行为不变；placement 候选行过滤对派发调用方透明 | 均在 task-02 allowed_paths |
| task-03 | 新增符号：lease_expiry_sweeper 协程（sweep.py）；main.py lifespan 挂载新增 create_task；lease/service 三个既有函数只调用不改签名 | main.py lifespan 既有挂载模式（session_reconnect_sweeper 先例）；无既有调用点受影响 | 均在 task-03 allowed_paths |
| task-04 | **心跳响应 DTO 增字段 pending_controls**（HeartbeatResponse/response schema 追加可选 int，既有消费方向后兼容）；新增符号：3 端点（GET pending-controls、POST controls/ack、runtime/service 心跳响应组装扩展）；session/permission/provider_switch 下发路径内部改走 enqueue（函数签名不变） | daemon 侧心跳响应解析（task-06 同变更内消费）；openapi schema 变化由 task-11 gen:types 收口 | 均在 task-04 allowed_paths；WS 消息 payload 注入 command_id 为可选字段向后兼容 |
| task-05 | **AgentSession.status 词表增加值 suspended**（String 列无 DB 枚举，应用层词表+校验）；新增符号：suspend-batch 端点；sweep.py offline sweep 语义改（函数签名不变）；SUSPENDED_MAX_AGE_SEC 新常量 | 前端 status 展示（task-10 同变更内消费）；offline sweep 既有测试断言（task-05 related_tests 内同步修） | 均在 task-05 allowed_paths |
| task-06 | **RECONNECT_INTERVAL_MS 常量语义变更**（固定 5000 → 退避序列函数，导出符号移除/替换）；新增符号：control-dispatcher.ts（dispatch/ack 导出）、hub-client.getPendingControls/ackControls、protocol 控制指令 kind 常量、daemon._reconcileAfterReconnect | ws-client.test.ts 引用 RECONNECT_INTERVAL_MS===5000 断言（related_tests 同步修）；onConnected 回调签名不变（daemon.ts 挂载点内部扩展） | 均在 task-06 allowed_paths |
| task-07 | **OutboxEntry 接口增字段 kind（可选，缺省 messages）**；**SubmitClient 接口扩展 notifyRunResult/notifySessionEnd 两方法**（实现方 hub-client 同步实现）；文件命名维度 runId→dedupId（内部）；新增符号：hub-client.submitPermissionRequest、backend permission-requests 端点 | OutboxEntry 构造点（task-runner/daemon.ts 两处 submitWithRetry 调用——kind 缺省向后兼容）；SubmitClient 实现（HubClient）与测试 fake（outbox.test/resilience-service.test 内同步） | 均在 task-07 allowed_paths；backend runs/result 与 session/end 幂等化为行为变更无签名 |
| task-08 | 无既有签名变更；新增符号：hub-client.suspendSessions；daemon.stop 内部插入挂起调用；_recoverOneSession 行为改（网络失败保留记录）；no_claim_token 上报路径改入 outbox（内部） | stop() 调用方（cli/SIGTERM）行为不变；session-recovery/daemon-recovery-boot 既有测试补断言（related_tests） | 均在 task-08 allowed_paths |
| task-09 | **SessionStreamHandlers 接口增可选回调 onStatusChange**（可选字段，既有传入对象向后兼容）；agent-stream retryCount 重置为内部逻辑；session-permission-panel 重连为内部 | streamSession 调用方（session-panel 两模式，同 task 内消费）；use-agent-run-stream 消费 status 不受影响 | 均在 task-09 allowed_paths |
| task-10 | **SESSION_STATUS_LABELS 映射增加值**（suspended）、**ACTIVE_SESSION_VIEW_STATUSES 词表增值**（UI 常量级，非函数签名）；runtime-session-helpers 恢复按钮分支扩展 | 徽标/词表消费点均在同文件内；浮窗经 session-panel 复用自动跟随 | 均在 task-10 allowed_paths；default 兜底分支覆盖未知值 |
| task-11 | 无签名级变更；生成物（openapi.json/api-types.ts×2）+ 新增集成测试文件 | api-types 消费方全前端/daemon（类型再生成，字段追加不破坏既有引用） | 均在 task-11 allowed_paths |

**汇总**：签名级变更集中在 task-04（心跳响应增字段）、task-05（status 词表增值）、task-06（RECONNECT_INTERVAL_MS 替换）、task-07（OutboxEntry/SubmitClient 接口扩展）、task-09（handlers 增可选回调）——全部为**追加式**（可选字段/新值/新方法），无破坏性删除；受影响调用点均在同变更的对应 task allowed_paths 内闭环。
