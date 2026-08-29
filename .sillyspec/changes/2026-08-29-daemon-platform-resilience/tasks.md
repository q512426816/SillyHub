---
author: qinyi
created_at: 2026-08-29 02:52:40
---
# 任务清单（Tasks）

> 骨架只列任务名。plan 阶段会把展开后的清单**写回本文件**（checkbox 行带一句话名，可附 [model:xxx]/(depends_on: …) 标注；保留 frontmatter/标题/ql-xxx 等非 task-XX 行）；execute 勾选与 verify 对照都在本文件。

- [x] task-01: backend 控制指令表+服务+迁移（daemon_control_commands + ControlCommandService + alembic，迁移落 backend/migrations/versions/）
- [x] task-02: backend WS 断开 10s 延迟降级+placement 派发实连接检查
- [x] task-03: backend lease 过期 GC 常驻协程+lifespan 重启恢复扩展
- [x] task-04: backend 下发方接入控制指令+pending-controls/ack 端点+心跳 pending_controls 扩展+控制指令 GC 挂载（depends_on: task-01, task-03）
- [x] task-05: backend 会话挂起语义（suspended/suspend-batch/offline sweep 改挂起/24h 超龄 GC/recover 用例锁定/同步修 offline sweep 与广播断言）（depends_on: task-01）
- [x] task-06: daemon 连接韧性+控制指令消费+统一对账（退避重连/register 重试/control-dispatcher/_reconcileAfterReconnect/同步修 ws-client 5s 断言）（depends_on: task-04）
- [x] task-07: daemon 上行可靠化+backend 幂等端点（outbox kind 扩展/终态入箱/422 对账/权限 HTTP 通道/同步修 outbox.test 断言）（depends_on: task-06）
- [x] task-08: daemon 优雅停止挂起+恢复健壮性（suspend-batch 接入/网络失败保留重试/claimToken 空窗入箱）（depends_on: task-05, task-07）
- [x] task-09: 前端连接状态+运行轮看门狗+run 流预算重置+审批面板重连（depends_on: task-04）
- [x] task-10: 前端 suspended 会话展示+未知状态兜底（四入口：session-panel/session-list-layout/runtime-session-helpers/浮窗）（depends_on: task-05, task-09）
- [x] task-11: 三端 gen:types+四场景集成回归（depends_on: task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10）
