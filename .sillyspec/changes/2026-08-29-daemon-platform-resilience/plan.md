---
author: qinyi
created_at: 2026-08-29 03:05:20
plan_level: full
---

# 实现计划（Plan）：daemon 与平台对接稳定性优化

## Wave 1（backend 基础设施，并行无依赖）
- task-01
- task-02
- task-03

## Wave 2（backend 控制面接线，依赖 Wave 1）
- task-04

## Wave 3（daemon 连接面 + backend 挂起语义，依赖 Wave 1/2）
- task-05
- task-06

## Wave 4（daemon 上行可靠化，依赖 Wave 3）
- task-07

## Wave 5（daemon 生命周期 + 前端连接可见性，依赖 Wave 4）
- task-08
- task-09

## Wave 6（前端挂起展示，依赖 Wave 5）
- task-10

## Wave 7（三端类型收口与集成回归，依赖 Wave 6）
- task-11

## 任务总表
| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | backend 控制指令表+服务+迁移 | W1 | P0 | — | FR-01, D-004@v1, D-006@v1 | daemon_control_commands 表（kind String(32)）+ alembic 迁移 + ControlCommandService（enqueue/mark_delivered/fetch_pending/ack/gc 方法） |
| task-02 | backend WS 断开延迟降级+派发实连接检查 | W1 | P0 | — | FR-07, D-007@v1 | ws_hub disconnect 挂 10s 延迟任务（执行时复查 is_connected(daemon_instance_id) 取消）+ runtime 标 offline + placement 候选联查实连接 |
| task-03 | backend lease GC 常驻协程+lifespan 重启恢复 | W1 | P0 | — | FR-02, FR-07, D-002@v1, D-005@v1 | lease_expiry_sweeper（60s）调 expire_leases+handle_expired_leases_batch+alert_stuck_terminating_leases；lifespan 对在线 daemon pending lease 重发 WS 唤醒 |
| task-04 | backend 下发方接入控制指令+补拉端点+心跳扩展 | W2 | P0 | task-01, task-03 | FR-01, D-005@v1, D-006@v1, D-007@v1 | session inject/interrupt/end/resume、permission_response、provider_config_changed 改 enqueue+WS 推送；GET pending-controls（仅 pending）/POST controls/ack；心跳响应加 pending_controls；控制指令 GC 挂载 task-03 的常驻 sweeper+inject 两条过期路径联动 run failed |
| task-05 | backend 会话挂起语义 | W3 | P0 | task-01 | FR-04, D-001@v1, D-007@v1 | AgentSession.status 加 suspended；suspend-batch 端点（中断 run failed(daemon_stopped)+session suspended+lease cancelled）；offline sweep active→suspended（pending 维持 failed）；suspended 24h 超龄 GC；recover 非白名单用例锁定（suspended/pending/reconnecting 三态）；同步更新 test_session_reconnect_sweep.py offline 断言与 test_session_events_cross.py offline 广播断言 |
| task-06 | daemon 连接韧性+控制指令消费+统一对账 | W3 | P0 | task-04 | FR-01, FR-05, D-005@v1 | ws-client 指数退避 [1,2,4,8,16,30]s+±20% jitter+消息重置；daemon.ts register 周期重试（15s 起步封顶 60s）；control-dispatcher.ts 新模块（(kind,payload) 统一入口+LRU 256 去重+ACK）；_reconcileAfterReconnect（心跳→outbox→控制指令→pending leases，幂等防重入）；hub-client/protocol 扩展；同步更新 ws-client.test.ts 固定 5s 重连断言与重连时序用例 |
| task-07 | daemon 上行可靠化+backend 幂等端点 | W4 | P0 | task-06 | FR-03, D-004@v1, D-007@v1 | outbox 扩展（entry kind 字段/drain 按 kind 路由/SubmitClient 扩展两方法/dedupId 命名/旧 runId 文件兼容）；终态 retryTerminal 用尽落箱重放；422 对账刷新 claim_token；PERMISSION_REQUEST HTTP 上行（daemon hub-client + backend permission-requests 端点）；backend result/session-end 端点幂等化；同步更新 tests/resilience/outbox.test.ts entry 形状与文件命名断言 |
| task-08 | daemon 优雅停止挂起+恢复健壮性 | W5 | P0 | task-05, task-07 | FR-04, D-001@v1 | stop() 调 suspend-batch 后再 markOffline；_recoverOneSession 网络失败保留记录退避重试（30s 起步封顶 5min+onConnected 重试轮）；claimToken 空窗 no_claim_token 上报入 outbox 暂存重放 |
| task-09 | 前端连接状态+看门狗+预算重置+审批重连 | W5 | P1 | task-04 | FR-06, D-003@v1 | streamSession onStatusChange；session-panel 连接横幅（重连中/已恢复 2s 消失）；运行轮 90s 看门狗对账（30s×3 复核+提示不伪造终态）；agent-stream 成功事件重置 retryCount；审批面板无限退避重连+dialogs 补拉 |
| task-10 | 前端 suspended 展示+未知状态兜底 | W6 | P1 | task-05, task-09 | FR-04, FR-06, D-001@v1, D-003@v1 | 状态徽标「已挂起」+横幅「守护进程不在线，重新启动后自动恢复」+输入禁用；四入口同改：session-panel.tsx、session-list-layout.tsx（SESSION_STATUS_LABELS）、runtime-session-helpers.tsx（ACTIVE_SESSION_VIEW_STATUSES/恢复按钮）、浮窗；status 映射 default 兜底；开始前先跑 pnpm gen:types（backend 端点 W3 已定稿）；对照原型 prototype-session-connection-states.html |
| task-11 | 三端 gen:types+集成回归 | W7 | P0 | task-01~task-10 | 全 FR, D-004@v1 | backend openapi 再生成→daemon/frontend pnpm gen:types 终态对账提交；四场景集成用例：断线补拉零丢失零重复、backend 重启收敛、daemon 重启会话恢复可继续、前端断线横幅与看门狗 |

## 关键路径
task-01 → task-04 → task-06 → task-07 → task-08 → task-11（最长依赖链，决定最短交付周期）
## 全局验收标准
1. backend/daemon/frontend 三端相关单测全绿（仅跑本变更相关测试，全量留 CI）；mypy/ruff/tsc 无新增错误
2. 集成敏感（本变更判级 integration-critical）必做集成冒烟：控制指令断线补拉后零丢失且 inject 零重复执行；backend 进程重启后 daemon 自动恢复且 pending lease 重唤醒；daemon 停止>600s 重启后 suspended 会话恢复为 active 可继续对话；前端断线期间横幅可见、恢复后 resync 无重复
3. alembic 单 head；旧 outbox `<runId>.jsonl` 文件 load 兼容（缺 kind 按 messages）
4. 未触发新链路时旧行为不变（WS 直推、心跳、会话状态机既有语义回归）

## 覆盖矩阵
| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-05, task-08, task-10 | daemon 重启后 suspended→reconnecting→active 恢复用例 + 前端挂起展示对照原型 |
| D-002@v1 | task-03 | backend 重启 lifespan 恢复集成用例（DB 保留） |
| D-003@v1 | task-09, task-10 | 连接横幅/看门狗/审批重连/suspended 展示前端用例 |
| D-004@v1 | task-01, task-04, task-07, task-11 | 新表+4 端点+gen:types 三端同步 |
| D-005@v1 | task-01~task-11 | 方案 A 六块全覆盖（A1→task-06、A2→task-01/04/06、A3→task-07、A4→task-02/03、A5→task-05/08/10、A6→task-09/10） |
| D-006@v1 | task-01, task-04 | 补拉仅返回 pending 用例（delivered 不重发） |
| D-007@v1 | task-02, task-04, task-05, task-07 | 取消判定/pending 会话归宿/outbox 形态/inject 双路径过期联动/recover 非白名单用例 |
| FR-01 | task-01, task-04, task-06 | 控制指令可靠投递 GWT 用例 |
| FR-02 | task-03, task-06 | backend 重启收敛 + daemon register 重试用例 |
| FR-03 | task-07 | 终态入箱重放幂等 + 权限 HTTP 通道用例 |
| FR-04 | task-05, task-08, task-10 | 挂起/恢复全链路用例 |
| FR-05 | task-06 | 退避重连 + 统一对账用例 |
| FR-06 | task-09, task-10 | 前端回显兜底用例 |
| FR-07 | task-02, task-03 | lease GC + 延迟降级用例 |
