## FR-client-001 控制指令可靠投递
变更：2026-08-29-daemon-platform-resilience
状态：active
摘要：默认场景
依据决策：D-004@v1、D-006@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given backend 需向在线 daemon 下发控制指令（session_inject/interrupt/end/resume、permission_respon；When 指令入队 daemon_control_commands（pending）后尝试 WS 推送 daemon 重连对账（onConnected 或心跳响应 pen；Then 推送成功标 delivered；失败或 daemon 不在线保持 pending daemon 补拉全部 pending 指令、按 command_id LRU
全文：.sillyspec/changes/archive/2026-08-29-daemon-platform-resilience/requirements.md#FR-01
最近确认：2c290d7c7

## FR-client-002 backend 进程重启后自动收敛
变更：2026-08-29-daemon-platform-resilience
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given backend 重启（DB 保留），重启前存在在线 daemon 的 pending batch lease daemon 在 backend 重启窗口内启动或；When lifespan 启动恢复执行 register 失败或心跳暂时不可达；Then 对在线 daemon 重发 WS 唤醒；running run 按既有逻辑清理；reconnecting 会话交既有 180s sweeper 收敛 daemo
全文：.sillyspec/changes/archive/2026-08-29-daemon-platform-resilience/requirements.md#FR-02
最近确认：2c290d7c7

## FR-client-003 上行消息与终态可靠化
变更：2026-08-29-daemon-platform-resilience
状态：active
摘要：默认场景
依据决策：D-004@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given daemon 需上报 run 终态（notifyRunResult）或会话结束（notifySessionEnd） daemon WS 不通时 agent 发起；When retryTerminal 快路径 3 次用尽 PERMISSION_REQUEST WS 发送失败 submitWithRetry 处理；Then 落入 outbox（kind=run_result/session_end，dedupId 维度命名），重连/心跳恢复后 drain 按 kind 路由重放；b
全文：.sillyspec/changes/archive/2026-08-29-daemon-platform-resilience/requirements.md#FR-03
最近确认：2c290d7c7

## FR-client-004 daemon 重启后会话自动恢复可继续
变更：2026-08-29-daemon-platform-resilience
状态：active
摘要：默认场景
依据决策：D-001@v1、D-007@v1
场景正文：
- 场景：默认场景 — Given 会话 active 且 daemon 优雅停止 daemon 离线超 600s 且有 active 会话（含强杀场景） suspended 会话（未超 24h）；When stop() 执行 offline sweep 执行 daemon 重新启动，_recoverSessionsOnBoot 执行 recover HTTP 网络；Then 调 suspend-batch：中断 run→failed(daemon_stopped)、session→suspended、挂起 lease→cancell
全文：.sillyspec/changes/archive/2026-08-29-daemon-platform-resilience/requirements.md#FR-04
最近确认：2c290d7c7

## FR-client-005 daemon 连接韧性
变更：2026-08-29-daemon-platform-resilience
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given WS 断开后重连 WS 重连成功；When _scheduleReconnect 执行 onConnected 触发；Then 按指数退避 [1,2,4,8,16,30]s + ±20% jitter 重试（封顶 30s）；收到任何 WS 消息（含 pong）重置退避 执行统一对账（幂等
全文：.sillyspec/changes/archive/2026-08-29-daemon-platform-resilience/requirements.md#FR-05
最近确认：2c290d7c7

## FR-client-006 前端回显兜底
变更：2026-08-29-daemon-platform-resilience
状态：active
摘要：默认场景
依据决策：D-003@v1
场景正文：
- 场景：默认场景 — Given 会话 SSE 断开/重连 轮次 running 且 90s 无新日志/SSE 事件 run 级流曾断连耗尽部分重试预算 审批面板 SSE 断开 会话处于 sus；When streamSession 状态变化 看门狗触发 收到任一成功事件 重连逻辑执行 列表/详情/浮窗渲染；Then 面板顶部显示「实时连接已断开，正在重连…（第 N 次）」warning 横幅；恢复后显示「连接已恢复，正在同步…」2s 自动消失 主动 getAgentSess
全文：.sillyspec/changes/archive/2026-08-29-daemon-platform-resilience/requirements.md#FR-06
最近确认：2c290d7c7

## FR-client-007 lease 过期回收与派发在线判定
变更：2026-08-29-daemon-platform-resilience
状态：active
摘要：默认场景
依据决策：D-007@v1
场景正文：
- 场景：默认场景 — Given claimed batch lease 心跳停止致 lease_expires_at 过期 WS 断开 10s 后仍未恢复 placement 候选筛选；When lease_expiry_sweeper（60s 周期常驻协程）执行 延迟降级任务执行 DB status=online 的候选行评估；Then 过期 lease→expired；run 重派（attempt<3，新 pending lease+WS 唤醒）或 failed（≥3）；不再永挂 复查 ws_
全文：.sillyspec/changes/archive/2026-08-29-daemon-platform-resilience/requirements.md#FR-07
最近确认：2c290d7c7
