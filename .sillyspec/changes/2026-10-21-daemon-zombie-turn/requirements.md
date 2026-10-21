---
author: flow-machine-draft
created_at: 2026-10-21T07:19:34.302Z
---
# 需求规格（Requirements）— 2026-10-21-daemon-zombie-turn

## 功能需求

### FR-01: inject 在会话非 idle 时不再 ack 了事：排队补启或拒绝，不产生无 started_at 的悬挂 run

- daemon 必须对「inject 已确认（ack）但引擎迟迟未启动本轮」的会话自动收敛：inject 走首轮启动路径（push 前会话非 running）时布防轮启动看门狗（默认 90s，env `SILLYHUB_TURN_START_WATCHDOG_MS` 可调）；看门狗到点时若该会话仍无任何轮事件（status=running 且 currentRunId 仍为该轮且期间零 onMessage/onResult），必须重置会话态为 active 并把该轮经 notifyRunResult 上报失败（is_error=true，带中文可读原因），禁止让 run 永久悬挂等待 daemon 重启才被清扫。
- 看门狗在任意轮事件（onMessage / onResult）到达、会话终态（end/fail）、SessionManager stop 时必须撤防，禁止误伤已正常启动的轮（含等待用户审批的长轮——审批前轮事件已到达即撤防）。

#### 场景：打断收尾竞态吞没 inject（主事故路径）

- Given 会话上一轮被用户打断，SDK 正在 abort 收尾；backend 0.6s 后自动注入新消息并创建新 run
- When daemon 收到 SESSION_INJECT，push 进引擎输入流并 ack，但引擎在 abort 收尾窗口把该输入吞掉（无新轮、无事件、无 result）
- Then 90s 看门狗到点：会话态重置为 active（保留 currentRunId 作迟到结果归属锚，见 design B-1），该 run 经 notifyRunResult 收敛为 failed（可读原因说明「引擎未启动本轮，请重发」），前端经 SSE 显示该轮失败而非永久转圈

#### 场景：正常启动的轮不误伤

- Given inject push 后引擎正常启动，首个轮事件（system/assistant 消息）1~2s 内到达
- When onMessage 到达
- Then 看门狗立即撤防，本轮生命周期与现状逐字一致（长轮、等待审批 90s+ 均不受影响）

### FR-02: interrupt 对非 running 的 no-op 结果回传后端；后端对 acked-but-ineffective 打断立即收敛 pending run 并通知前端

- backend 下发 SESSION_INTERRUPT 的 payload 必须携带 run_id（interrupt 端点与 dispatch-now 忙时打断共用路径同改）。
- daemon 处理 SESSION_INTERRUPT 时必须消费 `interrupt()` 的布尔结果：返回 false 且会话 status !== 'running'（无 running 轮）且 payload 带 run_id 时，必须经 notifyRunResult 把该 run 以 error_during_execution 收敛（is_error=true，可读原因「执行端无进行中的轮次，已按打断收敛」），让 backend 即刻收敛 pending run 并经既有 SSE 终态事件回报前端（前端按 interactive_interrupted 显示已中止）；会话不在 daemon 内存 store（无法判定）或仍处 running（false 仅可能是驱动写失败/超时，见 design B-3）时禁止回报。
- 打断信号已送达且有效（返回 true）时行为保持现状：终态仍由 SDK result 驱动，不得提前改判。

#### 场景：僵尸 run 上按打断（事故主场景）

- Given backend 存在活跃 pending run（无 started_at），daemon 侧会话 status 非 running（或 query 已死）
- When 用户按「打断本轮」，daemon interrupt() 返回 false
- Then daemon 回传 noop 结果，backend 秒级把该 run 收敛为 failed+interactive_interrupted，前端该轮显示「已中止」，打断按钮状态随之复位

### FR-03: 后端主动清扫「创建后 N 秒未被 daemon 启动」的 pending run（N 可配置）

- backend 必须周期清扫满足以下全部条件的 run 并收敛：status='pending' 且 started_at IS NULL 且 created_at 距今超过 N 秒（默认 300s，经 app Settings `daemon_pending_run_start_timeout_sec` 可配置），且其所属会话绑定的 runtime 在线（daemon 在线 + 心跳新鲜）；收敛动作为 failed + finished_at + error_code='interactive_turn_not_started' + 中文可读原因（output_redacted），不动会话与 lease（会话保持 active，用户可重发），并经既有 SSE 终态事件通知前端。
- 清扫必须跳过：pending_approval 状态的 run（审批等待非僵尸）、runtime 离线会话的 run（既有 offline sweep 管辖）、未超龄的新 run。

#### 场景：僵尸 pending run 兜底收敛

- Given 会话 runtime 在线，其活跃 run 已 pending 且无 started_at 超过 N 秒（inject 被吞且看门狗上报也丢失的兜底路径）
- When 清扫周期到达
- Then 该 run 收敛 failed+interactive_turn_not_started+可读原因，前端收到终态事件不再转圈；同会话无其他活跃 run 时用户可正常重发消息

### FR-04: 前端打断 15s 超时回退提示，不再永久停在「打断中」

- 前端发起打断后必须布防 15s 超时：到点该轮仍处 interrupting（无 SSE 终态到达）时，必须把该轮 UI 状态回退为 running（打断按钮可再次点击）并给出提示（打断已发出未生效，本轮可能异常，可再次打断或等待系统自动收敛），禁止永久停留在「打断中」。
- 超时定时器在该轮收到任何终态（SSE turn_completed / 本地已处理）或组件卸载时必须清除，禁止泄漏。

#### 场景：打断无效不卡死

- Given 用户对运行中轮点击打断，请求成功但 15s 内无 turn_completed 到达（如 daemon 侧空转）
- When 15s 定时器触发
- Then 该轮 UI 回退 running、按钮恢复可用，并显示「打断已发出 15 秒未生效」类提示；用户可再按或等待 FR-01/FR-03 的自动收敛

## 测试绑定

FR-01: sillyhub-daemon/tests/interactive/turn-start-watchdog.test.ts「inject 布防/事件撤防/到点收敛上报/终态撤防」
FR-02: sillyhub-daemon/tests/daemon-interrupt-noop-report.test.ts「interrupt false 回传 notifyRunResult / 会话缺失不回报」＋backend/app/modules/daemon/tests/test_interrupt_payload_run_id.py「interrupt payload 携带 run_id」
FR-03: backend/app/modules/daemon/tests/test_pending_run_start_sweep.py「超龄在线 pending run 收敛 / 新 run·审批等待·离线 runtime 不扫」
FR-04: frontend/src/components/daemon/session-panel/__tests__/interrupt-timeout.test.ts「15s 到点回退 running+提示 / 终态到达清定时器」
