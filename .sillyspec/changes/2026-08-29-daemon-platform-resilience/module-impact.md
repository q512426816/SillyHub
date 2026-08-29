---
author: qinyi
created_at: 2026-08-29 03:15:10
---
# 模块影响分析（Module Impact）— daemon 与平台对接稳定性优化

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend:daemon | 修改+新增 | 控制指令可靠投递（新增 model 表定义 + control_commands.py 服务 + router 4 端点）、WS 断开延迟降级（ws_hub/runtime）、lease GC 常驻协程与 lifespan 恢复扩展（sweep/main 引用）、会话挂起语义（session/service、sweep、permission_service、lease/provider_switch 下发方接入） |
| backend:agent | 修改 | AgentSession.status 词表加 suspended（model.py）；placement 派发候选联查 WS 实连接（placement.py） |
| backend:migrations | 新增 | daemon_control_commands 建表迁移（backend/migrations/versions/） |
| frontend:components-daemon | 修改 | session-panel 连接横幅/看门狗/suspended 展示；session-list-layout SESSION_STATUS_LABELS；runtime-session-helpers 词表与恢复按钮 |
| frontend:components-permissions | 修改 | 审批面板 SSE 无限退避重连 + dialogs 补拉 |
| frontend:lib-daemon | 修改 | streamSession onStatusChange 状态回调、suspended 辅助 |
| frontend:lib-agent-stream | 修改 | 成功事件重置 retryCount 预算 |
| sillyhub-daemon:daemon | 修改 | register 周期重试、_reconcileAfterReconnect、stop 挂起接入、恢复健壮性、终态入箱挂点 |
| sillyhub-daemon:client | 修改 | hub-client 新增 getPendingControls/ackControls/suspendSessions/submitPermissionRequest |
| sillyhub-daemon:ws-client | 修改 | 指数退避重连序列 + jitter + 消息重置 |
| sillyhub-daemon:protocol | 修改 | 控制指令 kind 常量与心跳响应类型扩展 |
| sillyhub-daemon:resilience | 修改 | outbox kind 扩展、drain 按 kind 路由、终态/claimToken 空窗暂存 |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| backend/app/main.py | 根 lifespan 文件（daemon 模块协程挂载点），模块归属超出子映射细粒度（core 仅覆盖 app/core/**）；execute 中由 task-03 修改，无遗漏风险 |
| sillyhub-daemon/src/control-dispatcher.ts | 本变更新增文件，建议归入 client 模块或待 scan 刷新 _module-map 时新建条目；task-06 创建 |
| frontend/src/lib/api-types.ts、sillyhub-daemon/src/api-types.ts、backend/openapi.json | 生成物（pnpm gen:types），task-11 收口再生成，不手改 |

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend.md`（backend:daemon/agent） | 更新 daemon 连接与会话挂起语义说明（本次变更涉及） | done |
| `modules/frontend.md`（components-daemon/lib-*） | 更新会话面板连接状态与 suspended 展示说明 | done |
| `modules/sillyhub-daemon.md`（daemon/client/ws-client/protocol/resilience） | 更新连接韧性、控制指令消费、outbox 扩展说明 | done |
| `_module-map.yaml` | 待 control-dispatcher.ts 落地后由 scan 刷新（本变更不手动改映射） | skipped |
