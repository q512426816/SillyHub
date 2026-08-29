---
author: qinyi
created_at: 2026-08-29 02:52:40
---
# 需求规格（Requirements）

## 角色
| 角色 | 说明 |
|---|---|
| 平台用户 | 在前端会话面板与 agent 对话、审批权限请求的业务/开发人员 |
| daemon | 跑在用户本机的守护进程（sillyhub-daemon），驱动本地 agent 执行 |
| 平台 backend | 调度中枢（FastAPI），管理 run/lease/session 状态与消息持久化 |
| 运维 | 重新部署 backend（进程重启，DB 保留）的人员 |

## 功能需求

### FR-01: 控制指令可靠投递
覆盖决策：D-004@v1, D-005@v1, D-006@v1, D-007@v1
Given backend 需向在线 daemon 下发控制指令（session_inject/interrupt/end/resume、permission_response、provider_config_changed）
When 指令入队 daemon_control_commands（pending）后尝试 WS 推送
Then 推送成功标 delivered；失败或 daemon 不在线保持 pending

Given daemon WS 断线期间 backend 入队了控制指令
When daemon 重连对账（onConnected 或心跳响应 pending_controls>0 触发）
Then daemon 补拉全部 pending 指令、按 command_id LRU 去重消费、逐条 ACK；**补拉只返回 pending，delivered 一律不重发**（零重复执行）

Given inject 类指令过期（pending 过期或 delivered-未-ack 超 10min 过期）
When backend GC 协程扫描
Then 对应 pending run 标 failed（error_code=interactive_inject_send_failed，幂等）

### FR-02: backend 进程重启后自动收敛
覆盖决策：D-002@v1, D-005@v1
Given backend 重启（DB 保留），重启前存在在线 daemon 的 pending batch lease
When lifespan 启动恢复执行
Then 对在线 daemon 重发 WS 唤醒；running run 按既有逻辑清理；reconnecting 会话交既有 180s sweeper 收敛

Given daemon 在 backend 重启窗口内启动或运行中
When register 失败或心跳暂时不可达
Then daemon 周期重试 register（15s 起步退避至 60s 封顶）直至成功，恢复心跳与 WS，无需人工干预

### FR-03: 上行消息与终态可靠化
覆盖决策：D-004@v1, D-005@v1, D-007@v1
Given daemon 需上报 run 终态（notifyRunResult）或会话结束（notifySessionEnd）
When retryTerminal 快路径 3 次用尽
Then 落入 outbox（kind=run_result/session_end，dedupId 维度命名），重连/心跳恢复后 drain 按 kind 路由重放；backend 端点幂等（重复提交→no-op/409=已送达）

Given daemon WS 不通时 agent 发起需审批的工具调用
When PERMISSION_REQUEST WS 发送失败
Then 改走 HTTP 上行通道创建待审记录，等待审批而非 fail-closed deny；审批结果经 FR-01 下行补拉送达

Given interactive 流式消息上报遇 422（claim_token 失效）
When submitWithRetry 处理
Then 消息入 outbox 暂存并触发一次会话详情对账刷新 token，不静默丢弃

### FR-04: daemon 重启后会话自动恢复可继续
覆盖决策：D-001@v1, D-005@v1, D-007@v1
Given 会话 active 且 daemon 优雅停止
When stop() 执行
Then 调 suspend-batch：中断 run→failed(daemon_stopped)、session→suspended、挂起 lease→cancelled；suspend-batch 调用失败（网络断）时与强杀等价走 600s offline sweep 收敛为 suspended

Given daemon 离线超 600s 且有 active 会话（含强杀场景）
When offline sweep 执行
Then active 会话→suspended（不再 failed）、挂起 run→failed、lease→cancelled；**pending 会话维持 failed**（本地无快照记录，无人 recover）

Given suspended 会话（未超 24h）
When daemon 重新启动，_recoverSessionsOnBoot 执行
Then recover（非终态一律可 recover，含 suspended）→reconnecting→restoreAndReconnect（SDK resume）→confirm-reconnected→active，历史消息完整，用户可直接继续发消息

Given daemon 启动时 backend 恰好不可达
When recover HTTP 网络类失败
Then 本地会话记录保留并退避重试（30s 起步封顶 5min；WS onConnected 时立即重试一轮）；仅业务终态（ended/failed/rejected）删记录

Given 恢复后 claimToken 空窗期产生 onTurnResult/onTurnMessage
When 上报遇 no_claim_token
Then 消息入 outbox 暂存，下一次 SESSION_INJECT 刷新 token 后重放

### FR-05: daemon 连接韧性
覆盖决策：D-005@v1
Given WS 断开后重连
When _scheduleReconnect 执行
Then 按指数退避 [1,2,4,8,16,30]s + ±20% jitter 重试（封顶 30s）；收到任何 WS 消息（含 pong）重置退避

Given WS 重连成功
When onConnected 触发
Then 执行统一对账（幂等、防重入）：立即心跳→drain outbox→补拉控制指令→补拉 pending leases

### FR-06: 前端回显兜底
覆盖决策：D-003@v1
Given 会话 SSE 断开/重连
When streamSession 状态变化
Then 面板顶部显示「实时连接已断开，正在重连…（第 N 次）」warning 横幅；恢复后显示「连接已恢复，正在同步…」2s 自动消失

Given 轮次 running 且 90s 无新日志/SSE 事件
When 看门狗触发
Then 主动 getAgentSession+listSessionRuns 对账；连续 3 轮（30s 间隔）仍 running 且 SSE 断开时显示对账提示（不伪造终态）；对账发现终态则按 resync 刷新

Given run 级流曾断连耗尽部分重试预算
When 收到任一成功事件
Then retryCount 重置为 0（不再 5 次耗尽永久停连）

Given 审批面板 SSE 断开
When 重连逻辑执行
Then 无限退避自动重连 + 重连成功补拉 dialogs

Given 会话处于 suspended
When 列表/详情/浮窗渲染
Then 状态徽标「已挂起」+ 横幅「守护进程不在线，重新启动后自动恢复」+ 输入禁用；未知 status 走 default 兜底展示

### FR-07: lease 过期回收与派发在线判定
覆盖决策：D-005@v1, D-007@v1
Given claimed batch lease 心跳停止致 lease_expires_at 过期
When lease_expiry_sweeper（60s 周期常驻协程）执行
Then 过期 lease→expired；run 重派（attempt<3，新 pending lease+WS 唤醒）或 failed（≥3）；不再永挂

Given WS 断开 10s 后仍未恢复
When 延迟降级任务执行
Then 复查 ws_hub.is_connected(daemon_instance_id)，为真跳过；为假则 instance+runtimes 标 offline（DB）；心跳恢复即回 online；DB 抖动窗口上限一个心跳周期（~15s，期间拒绝派发优于派发即卡死）

Given placement 候选筛选
When DB status=online 的候选行评估
Then 联查 ws_hub.is_connected(row.daemon_instance_id)，不实连的候选跳过

## 非功能需求
- 兼容性：daemon 代码兼容 Windows/Linux/macOS（现有跨平台约束）；旧 outbox `<runId>.jsonl` 文件 load 兼容（缺 kind 按 messages）；WS 控制消息新增 command_id 字段向后兼容（旧 daemon 忽略）
- 可回退：控制指令表/端点为增量新增，回退后 WS 直推路径仍可用；suspended 状态回退后由既有 failed 语义兜底
- 可测试：全部 FR 提供 GWT 用例；后台协程用例显式注入 fake 时钟/独立事件循环；遵守 known_failures 豁免清单纪律
- 幂等性：控制指令零重复执行（delivered 不重发）；终态重放幂等；suspend/recover 双向可重入

## 决策覆盖矩阵
| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-04 | 自动恢复可继续对话口径 |
| D-002@v1 | FR-02 | 重部署仅进程重启 DB 保留边界 |
| D-003@v1 | FR-06 | 前端关键修复纳入范围 |
| D-004@v1 | FR-01, FR-03 | 允许结构改造（新表/端点/协程） |
| D-005@v1 | FR-01~FR-07 | 方案 A 选型（可靠投递+分层加固） |
| D-006@v1 | FR-01 | 补拉只返回 pending 等关键投递语义 |
| D-007@v1 | FR-01, FR-03, FR-04, FR-07 | Grill 裁定的 5 处语义（取消判定/pending 会话归宿/outbox 形态/过期联动/recover 非白名单） |
