---
author: qinyi
created_at: 2026-06-25T15:42:00
---

# Requirements

## 角色表

| 角色 | 说明 |
|---|---|
| 用户 | 发起 scan/stage 任务、多轮对话；可手动结束会话 |
| backend | lease 管理、AgentRun 状态机、完成时主动 end_session |
| daemon | interactive session 生命周期持有者、SessionManager |
| claude CLI | `-p --input-format stream-json` 常驻进程，等 stdin inject |

## 功能需求

### FR-1: daemon idle 自动回收默认禁用（D-001）

**Given** daemon 启动且未显式配置 `SESSION_IDLE_TIMEOUT_SEC`
**When** 一个 interactive session 处于 running 状态持续超过 30 分钟（turn 进行中，持续吐 tool_use/tool_result）
**Then** `_idleTimer` 不启动，`_scanIdle` 永不触发，session 不被自动 end（不出现 `[Request interrupted by user]` 误杀）

### FR-2: idle 逃生口保留（D-001）

**Given** env `SESSION_IDLE_TIMEOUT_SEC=1800`
**When** daemon 启动
**Then** `_idleTimeoutSec=1800`，`_idleTimer` 启动，恢复旧行为（向后兼容逃生口）

### FR-3: scan 完成主动 end_session（D-002）

**Given** 一个 scan run（`AgentRun.change_id is None` 且 `spec_strategy == "platform-managed"`）的 lease 完成
**When** daemon 调 `complete_lease`（status=completed）
**Then** backend 在收尾链末尾读取 `agent_run.agent_session_id`，经 facade 调 `end_session(agent_session_id, reason="task_completed")`，daemon 收 FR-05 `session_end` → `SessionManager.end()` → claude 进程退出

### FR-4: stage 完成主动 end_session（D-002）

**Given** 一个 stage run（`AgentRun.change_id is not None`）的 lease 完成
**When** daemon 调 `complete_lease`（status=completed）
**Then** 同 FR-3，主动调 `end_session` 关闭该 stage 独立 session

### FR-5: 多轮对话不自动 end（D-002@v1 边界）

**Given** 一个多轮对话 session（非 platform-managed 的 interactive lease）
**When** 其 lease 完成
**Then** **不**自动调 `end_session`（留给用户手动结束，保持多轮语义）

### FR-6: 完成驱动 end 失败不阻塞 lease（D-002@v1 容错）

**Given** `complete_lease` 的完成驱动 end 钩子执行
**When** `end_session` 抛异常（如 agent_session_id 为空 / daemon 不可达 / facade 调用失败）
**Then** 捕获异常，warn log（`complete_lease_end_session_failed`），lease 完成语义不受影响（AgentRun 仍标 completed）

### FR-7: 手动终止链路保持不变（D-003）

**Given** 用户在 interactive-session-panel 点"结束会话"
**When** 前端调 backend end_session HTTP 端点
**Then** 经 FR-05 `session_end` → daemon `SessionManager.end()`，行为与变更前一致（回归）

## 非功能需求

- **NFR-1 兼容性**：未配置 env 时 idle 禁用（新默认）；旧行为可经 env 恢复；无表结构 / API 签名变更。
- **NFR-2 幂等**：daemon `end()` 对已 ended/failed session no-op；完成驱动 end 与用户手动 end 竞态安全。
- **NFR-3 可观测**：完成驱动 end 成功 / 失败均有 log 留痕（`complete_lease_end_session_failed` 等）。
- **NFR-4 平台兼容**：daemon TS 改动 + backend Python 改动均兼容 Windows/Linux/macOS。

## D-xxx@vN 覆盖关系

| 决策 | 覆盖 FR |
|---|---|
| D-001@v1 移除 idle 自动回收 | FR-1, FR-2 |
| D-002@v1 scan/stage 完成主动 end | FR-3, FR-4, FR-5, FR-6 |
| D-003@v1 不引入绝对上限 | FR-7（手动链路不变）+ 非目标 |
