---
author: qinyi
created_at: 2026-08-05 16:57:16
---

# 需求规格 — daemon kill 通道统一

## 功能需求

### FR-01 interactive END/fail 可靠终止子进程
对 Claude/Codex interactive session，`end`/`fail` 必须主动触发子进程强制终止。Claude 经 `ClaudeDriverHandle.close()` → `query.close()`（SDK kill 链：stdin EOF → 2s → SIGTERM → 5s → SIGKILL）；Codex 经现有 `_close()`。收敛点为 `SessionManager._terminateSession(state, reason)`。验收：当前 turn 卡死（mock hang tool）场景下，END 后 ≤10s 子进程被终止，consume 循环退出。

### FR-02 "打断本轮"按钮保留 turn 级软中断（D-001@v2）
仅 interruptSession 端点（"打断本轮"按钮）走软中断：`SessionManager.interrupt` 不调 `driverHandle.close`，仍只调 `q.interrupt()`（Claude）/`turn/interrupt`（Codex），session 保持 active 可续轮。验收：interrupt 按钮后 session.status 仍 active，进程不退，可续轮。

### FR-03 batch lease WS 即时取消
新增 `daemon:lease_cancel` WS 消息（双端 protocol）。backend `cancel_lease` 对 batch lease（`kind != interactive`）标记 cancelled 后经 `ws_hub` 即时下发；daemon `_handleWsMessage` 收到后调 `taskRunner.cancel(leaseId)`（复用 AbortController → `_killChild`）。验收：batch cancel 后无需等心跳周期即触发 `_killChild`；发送失败靠心跳兜底（不丢）。

### FR-04 轻量终态确认（D-007，含 XC-03/04/08）
`DaemonTaskLease` 加 `terminating_at`（**仅 cancel_lease 时写**；end_session 同事务即 completed 不写，XC-03）；daemon 完成 kill 后经现有 `complete_lease`/`notifySessionEnd` 回传，backend 收到即清 `terminating_at`；sweeper **独立查询** `terminating_at IS NOT NULL`（不并入 expire GC，XC-08），超 30s 无回传 → 告警 + 标记（不改 `lease.status`，不重试）。验收：cancel 流程中 `terminating_at` 正确写/清；end_session 不写；超时告警可观测。

### FR-05 budget_tokens 运行期软切断检查点（D-005/D-006/D-009）
backend claim payload（`LeaseCtx`）下发 `budget_tokens`（来自 `AgentMission.budget_tokens`）；daemon 执行循环累计 token（**口径 = input_tokens + output_tokens，不含 cache；per AgentRun 归集，D-009**；batch task-runner 本次补累计器），≥ budget → 设 `overBudget` flag + 回传 `budget_exceeded` 事件（带 usage），当前 turn/step 跑完后终止（不硬 kill）。`budget_tokens` 为 None 时检查点短路。验收：超 budget 的 run 在当前 turn 完成后终止并回传事件（input+output 口径）；未配 budget 行为不变。

### FR-06 Windows 跨平台进程终止（D-004）
全平台仅依赖 SDK `close()` 终止子进程（win32：stdin.end + 5s TerminateProcess）；daemon 代码无 `taskkill /IM` 调用。验收：grep 无 `taskkill`；Windows 场景（mock/实测验）子进程被终止。

### FR-07 向后兼容
`close` 为可选契约（`?.()`），未实现的 driver 不报错；`budget_tokens` None 时短路；`terminating_at` 默认 None；`LEASE_CANCEL` 是纯新增消息，旧 daemon 收到走 default 仅 warn。验收：旧路径（无 budget/无 close 的 driver）行为不变；既有测试全绿。

### FR-09 "取消/停止 run" 走硬终止（D-001@v2/XC-01）
cancel_lease 对 interactive lease 改发 SESSION_END（不再发 SESSION_INTERRUPT），使"取消/停止 run"与"结束会话"都走 `_terminateSession` 硬杀链（接通 SDK query.close → SIGTERM → SIGKILL）。SESSION_INTERRUPT 此后仅"打断本轮"按钮用。验收：cancel interactive run 后，卡死 turn 场景下子进程 ≤10s 被终止（与 END 一致）。

### FR-08 测试覆盖 + 文档同步
daemon：session-manager 终态、LEASE_CANCEL、budget 检查点、Windows kill（mock）。backend：cancel_lease 发 LEASE_CANCEL、terminating_at sweeper、budget 下发。gen:types 同步双端 api-types.ts + openapi.json。更新 scan CONCERNS.md（标原 P0 已修 + 新机制）、protocol 双端消息表。验收：受影响模块测试全绿；类型无漂移；CONCERNS.md 不再过期描述。

## 决策覆盖矩阵（详见 design.md §11 / decisions.md）

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v2 | FR-02, FR-09 | INTERRUPT 软只守"打断本轮"按钮；cancel/终止硬杀（取代 D-001@v1） |
| D-002@v1 | FR-07 | 不改 daemon-entity-binding（兼容） |
| D-003@v1 | FR-01, FR-02 | Claude close 用 SDK query.close() |
| D-004@v1 | FR-06 | Windows 靠 SDK close()，不自己 taskkill |
| D-005@v1 | FR-05 | 本次含 budget |
| D-006@v1 | FR-05 | budget 软切断（不硬 kill 当前 turn） |
| D-007@v1 | FR-04 | 方案 C，无 outbox 重试 |
| D-009@v1 | FR-05 | budget 口径 = input+output，per-run，batch 补累计器 |

剩余风险：design §12 自审留 1 处 execute 阶段细化项（`_terminateSession` 的 partial buffer 清理顺序，对照 session-manager.ts:1937-1958），属实现细节，不阻塞进入 plan。
