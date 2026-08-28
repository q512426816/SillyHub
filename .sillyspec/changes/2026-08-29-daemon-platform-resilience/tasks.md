---
author: qinyi
created_at: 2026-08-29 02:52:40
---
# 任务清单（Tasks）

> 骨架只列任务名。plan 阶段会把展开后的清单写回本文件（checkbox 行带一句话名，可附依赖标注）。

- [ ] task-01: daemon WS 指数退避重连（[1,2,4,8,16,30]s + jitter + 消息重置）
- [ ] task-02: daemon register 周期重试（心跳循环内退避重试至成功）
- [ ] task-03: backend daemon_control_commands 表 + alembic 迁移（kind String(32)）
- [ ] task-04: backend ControlCommandService（enqueue/deliver/fetch_pending/ack/gc）
- [ ] task-05: backend 下发方接入控制指令（session inject/interrupt/end/resume、permission_response、provider_config_changed）
- [ ] task-06: backend pending-controls/ack 端点 + 心跳响应 pending_controls 扩展
- [ ] task-07: daemon control-dispatcher 消费分发（WS/补拉统一入口 + LRU 去重 + ACK）
- [ ] task-08: daemon 重连统一对账 _reconcileAfterReconnect（心跳→outbox→控制指令→pending leases）
- [ ] task-09: daemon outbox 扩展（kind 字段/drain 按 kind 路由/dedupId 命名/旧文件兼容）
- [ ] task-10: daemon 终态入 outbox（notifyRunResult/notifySessionEnd 快路径用尽落箱）
- [ ] task-11: backend result/session-end 端点幂等化
- [ ] task-12: PERMISSION_REQUEST HTTP 上行通道 + submitWithRetry 422 对账
- [ ] task-13: backend lease 过期 GC 常驻协程 + 控制指令 GC + inject 过期联动 run failed
- [ ] task-14: backend WS 断开 10s 延迟降级（复查取消判定）+ placement 实连接检查
- [ ] task-15: backend lifespan 重启恢复扩展（在线 daemon pending lease 重唤醒）
- [ ] task-16: AgentSession suspended 状态 + suspend-batch 端点 + daemon stop() 接入
- [ ] task-17: backend offline sweep 改挂起（active→suspended、pending 维持 failed）+ suspended 24h 超龄 GC + recover 非白名单用例锁定
- [ ] task-18: daemon 恢复健壮性（网络失败保留记录退避重试 + claimToken 空窗入箱重放）
- [ ] task-19: 前端 streamSession onStatusChange + 连接状态横幅
- [ ] task-20: 前端运行轮 90s 看门狗对账 + run 流重试预算重置 + 审批面板自动重连
- [ ] task-21: 前端 suspended 会话展示（徽标/横幅/输入禁用/浮窗）+ 未知状态兜底
- [ ] task-22: 三端 gen:types（backend openapi → daemon/frontend）+ 集成回归
