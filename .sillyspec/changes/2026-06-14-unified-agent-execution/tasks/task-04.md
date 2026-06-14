---
author: qinyi
created_at: 2026-06-14T17:52:18
change: 2026-06-14-unified-agent-execution
stage: plan
id: task-04
title: kill 改 cancel_lease + 状态映射验证 + diff 收口
priority: P0
depends_on: [task-01]
blocks: [task-11]
allowed_paths:
  - backend/app/modules/agent/service.py
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/lease_service.py
---

# task-04: kill 改 cancel_lease + 状态映射验证 + diff 收口

> 对应 plan 全局验收 4 / 5；风险 R-04（kill 改道后 daemon 离线无法取消子进程）。
> 对应 design §Phase 3（114-125）。
> **依赖 task-01**：task-01 已删 kill_run 的 SIGTERM→SIGKILL 链(487-543) 与 `_proc_registry`(143)，留 TODO 空壳；本任务接入 `DaemonLeaseService.cancel_lease`。
> **状态映射机制**：design §Phase 3 明确「由 daemon 侧 `sync_agent_run_status`(`daemon/service.py:667`) 驱动，已是既有机制」——本任务**不新建**映射，仅**验证**既有映射单一驱动无对账漂移。

## 修改文件

- `backend/app/modules/agent/service.py` — `kill_run`(487-543，task-01 后为空壳) 接入 `DaemonLeaseService.cancel_lease`；删除残留的 `collect_diff` 调用（若 task-01 未清完，本任务兜底）；移除 SERVER 侧任何 diff collector 触发点
- `backend/app/modules/daemon/service.py` — **无逻辑改动**，仅验证 `sync_agent_run_status`(667) 与 `complete_lease`(429) 的状态映射正确性（design §Phase 3 第 116-124 行映射表）；若验证发现 bug 则修复（不预期有）
- `backend/app/modules/daemon/lease_service.py` — **无逻辑改动**，`cancel_lease`(280) 已存在且签名匹配，本任务直接消费

## 实现要求

1. **`kill_run` 接入 cancel_lease**（service.py:487，task-01 后的空壳）：
   ```python
   async def kill_run(self, run_id: uuid.UUID) -> AgentRun:
       """Terminate a running agent execution via daemon lease cancellation.

       SERVER-side SIGTERM/SIGKILL chain removed (task-01).
       This method now delegates to DaemonLeaseService.cancel_lease(agent_run_id),
       which marks the active lease as 'cancelled'; the daemon detects the
       status on its next heartbeat/WS message and SIGTERMs the claude subprocess.
       """
       lease_svc = DaemonLeaseService(self._session)
       await lease_svc.cancel_lease(run_id)
       # 状态由 sync_agent_run_status 异步驱动（lease.cancelled → daemon 感知 → 上报 killed）
       # 本方法不直接写 AgentRun.status，等待 daemon 上报；返回当前 run 状态
       run = await self.get_run(run_id)
       return run
   ```
   - **关键**：`cancel_lease` 已在 `lease_service.py:280` 实现，签名 `async def cancel_lease(self, agent_run_id: uuid.UUID) -> None`，查 active lease（pending/claimed）→ 置 status='cancelled' + commit。本任务**直接调用**，不重新实现。
   - **状态机**：lease.cancelled **不直接**写 AgentRun.status；daemon 经 WS/poll 感知 cancelled → task-runner SIGTERM 子进程 → daemon 调 `sync_agent_run_status(lease_id, token, status="killed")` → AgentRun.status="killed"（design §Phase 3 第 116-124 行映射表）。

2. **import 注入**（service.py 顶部）：`from app.modules.daemon.lease_service import DaemonLeaseService`（若未导入）。

3. **移除 SERVER 侧 collect_diff 调用**（service.py:424-426，task-01 应已删，本任务兜底）：
   ```python
   # 必须删除（本任务 grep 验证）：
   from app.modules.agent.diff_collector import collect_diff  # service.py:424
   diff_result = await collect_diff(lease_path)               # service.py:426
   ```
   **diff 收口 daemon**（design §Phase 3 第 125 行）：daemon `task-runner.collectDiff` → `complete_lease` 上报（既有链路），作为唯一 diff 来源；后端不再独立 collect。

4. **状态映射验证**（**不**新建映射，验证既有 `sync_agent_run_status` 667 + `complete_lease` 429）：
   | lease.status | AgentRun.status | 驱动点 |
   |---|---|---|
   | claimed（start 后） | running | `sync_agent_run_status(status="running")` |
   | completed | completed | `complete_lease` → result.status |
   | expired | failed | `handle_expired_leases`(daemon/service.py:752/887 区域) |
   | cancelled | killed | kill_run → cancel_lease → daemon 感知 → sync_agent_run_status(status="killed") |

   - **验证手段**：task-11 测试用例覆盖四种 lease.status → AgentRun.status 映射（**单一驱动**，无并行对账）。
   - **若发现既有逻辑漂移**（如 `complete_lease` 写 completed 但 `sync_agent_run_status` 又写 failed）→ 修复为单一驱动；**不预期**有漂移（design 自审第 329 行明确「lease.status 5 值映射已核实」）。

5. **`AgentRun.status` 不直接 mutate**：本任务 `kill_run` 不写 `run.status = "killed"`；等待 daemon 上报（design §Phase 3 第 115 行「kill 改道」语义）。**例外**：若 daemon 离线（R-04），lease 已 cancelled 但 daemon 永不上报 → AgentRun 停留在 running；由 `handle_expired_leases`(752) 心跳超时 → lease.expired → AgentRun.status="failed"（既有兜底机制，本任务**不新增**）。
   > **需 execute 时确认**：`handle_expired_leases` 是否在 lease.cancelled 但 daemon 离线时也能驱动 AgentRun 状态收口；若否，task-11 覆盖该边界用例并补修复（design §Phase 3 已假定此路径，本任务标注待验证）。

6. **kill_run 异常处理**：
   - lease 不存在（无 active lease）→ `cancel_lease` 内部 log warning 并返回 None（lease_service.py:303-308 既有行为），`kill_run` 返回当前 run（不抛错，幂等）。
   - DB 异常向上抛。
   - **不**捕获 `cancel_lease` 内部异常（让 FastAPI 转 500）。

7. **kill_run 签名兼容**：保持 `async def kill_run(self, run_id: uuid.UUID) -> AgentRun`（router.py:112 既有调用不变）。

## 接口定义

### kill_run（service.py:487）

```python
async def kill_run(self, run_id: uuid.UUID) -> AgentRun:
    """Terminate a running agent execution.

    SERVER SIGTERM/SIGKILL chain removed (task-01); this method now delegates
    to DaemonLeaseService.cancel_lease(agent_run_id). The daemon detects the
    cancelled lease status on its next heartbeat/WS poll and SIGTERMs the
    claude subprocess, then reports back via sync_agent_run_status(status="killed").

    Returns the current AgentRun (status may still be 'running' immediately
    after this call — it transitions to 'killed' asynchronously via daemon report).

    Raises:
        AgentRunNotFound: if run_id does not exist.
    """
    lease_svc = DaemonLeaseService(self._session)
    await lease_svc.cancel_lease(run_id)  # 既有实现 lease_service.py:280
    return await self.get_run(run_id)
```

### 状态映射（既有，本任务验证不新建）

```python
# backend/app/modules/daemon/service.py 既有：
# sync_agent_run_status(667): status 参数直接写 agent_run.status
# complete_lease(429): result.status 写 agent_run.status (completed/failed)
# handle_expired_leases(752/887): lease.expired → agent_run.status = "failed"

# 映射表（design §Phase 3 第 116-124 行）：
# lease.status="claimed" + daemon start_lease → daemon sync_agent_run_status("running")
# lease.status="completed" + complete_lease(result.status="completed") → agent_run.status="completed"
# lease.status="expired" + handle_expired_leases → agent_run.status="failed"
# lease.status="cancelled" + kill_run/cancel_lease → daemon 感知 → sync_agent_run_status("killed")
```

### cancel_lease（既有，lease_service.py:280，本任务直接消费）

```python
async def cancel_lease(self, agent_run_id: uuid.UUID) -> None:
    """取消租赁（用户主动取消任务）。

    1. 设置 status='cancelled'
    2. 发送 WebSocket 取消信号给 daemon（WS 桩）

    Args:
        agent_run_id: 要取消的 agent run ID。
    """
    # 查 active lease（pending/claimed）→ 置 cancelled → commit
    ...
```

## 边界处理

1. **（null/空值）** `run_id` 必填（router 路径参数）；`get_run(run_id)` 返回 None → 抛 `AgentRunNotFound`（既有行为，router:102 已处理）。
2. **（兼容性 brownfield）** `kill_run` 签名不变（router 不改）；既有调用方 `router.kill_agent_run`(112) 调用方式不变；返回值 AgentRun 不变（status 字段值可能延迟变更，前端按 `agent_run:{id}` channel 异步感知）。
3. **（异常不静默吞）** `cancel_lease` 内部 lease 不存在 → log warning + return None（lease_service.py:303-308 既有），`kill_run` 返回当前 run（幂等）；**其他**异常（DB / WS 桩）向上抛，FastAPI 转 500。
4. **（参数不可变）** `kill_run` 不修改 run_id 参数；`cancel_lease` 内部修改 lease.status 但不修改入参。
5. **（歧义/冲突）** 同一 agent_run_id 有多个 active lease（理论不应发生，但 DB 无唯一约束）→ `cancel_lease` 取最新（`order_by created_at DESC LIMIT 1`，lease_service.py:298 既有行为）；其余 lease 不动（design §Phase 3 假定单一 active lease）。
6. **（daemon 离线 R-04）** kill_run 调 cancel_lease 后 lease.cancelled，但 daemon 离线 → AgentRun 停留 running；由 `handle_expired_leases`(752) 心跳超时驱动 → lease.expired → AgentRun.status="failed"（既有兜底，本任务验证不新建）。task-11 覆盖该边界。
7. **（状态映射单一驱动）** **禁止**在 kill_run 内直接写 `run.status = "killed"`（会与 sync_agent_run_status 双驱动漂移）；**禁止**在 complete_lease 与 sync_agent_run_status 同时写不同 status（验证既有逻辑无此漂移）。
8. **（diff 收口）** 后端 `service.py` 不再有 `collect_diff` 调用（grep 验证）；diff 唯一来源是 daemon `complete_lease` 上报（既有链路）；`diff_collector.py` 文件**不删**（daemon 子项目可能复用？——需 execute 时确认；保守保留，仅移除调用点）。

## 非目标

- **不**改 `cancel_lease` 签名或内部逻辑（既有实现可用）。
- **不**改 `sync_agent_run_status` / `complete_lease` / `handle_expired_leases` 既有逻辑（仅验证）；若发现 bug 才修复（最小改动）。
- **不**新建状态映射机制（design §Phase 3 明确「已是既有机制」）。
- **不**删除 `diff_collector.py` 文件（仅移除 service.py 调用点；文件保留供其他模块复用）。
- **不**改 daemon 侧 task-runner SIGTERM 逻辑（那是 sillyhub-daemon 子项目，本 Wave 1 仅后端）。
- **不**改 `AgentRun.status` 枚举值（5 值 pending/running/completed/failed/killed 不变）。
- **不**新增 lease 状态（pending/claimed/completed/expired/cancelled 5 值不变）。
- **不**实现 R-04 完整解决方案（daemon 离线兜底依赖既有 `handle_expired_leases`，本任务仅验证）。

## TDD 步骤

1. **写测试** `backend/app/modules/agent/tests/test_kill_and_state_mapping.py`（task-11 主体，本任务先写骨架）：
   - `test_kill_run_calls_cancel_lease`：mock `DaemonLeaseService.cancel_lease` → 调 kill_run → assert cancel_lease 被调用 with run_id
   - `test_kill_run_no_proc_registry`：`grep "_proc_registry\|SIGTERM" service.py` 无命中（静态，task-01 已保证，本任务再 grep）
   - `test_kill_run_no_collect_diff`：`grep "collect_diff" service.py` 无命中（diff 收口 daemon）
   - `test_kill_run_idempotent_no_active_lease`：mock cancel_lease 返回 None（无 active lease）→ kill_run 不抛错，返回 run
   - `test_state_mapping_claimed_to_running`：mock lease.status="claimed" + daemon sync_agent_run_status("running") → AgentRun.status=="running"
   - `test_state_mapping_completed`：complete_lease(result.status="completed") → AgentRun.status=="completed"
   - `test_state_mapping_expired_to_failed`：handle_expired_leases 置 lease.expired → AgentRun.status=="failed"
   - `test_state_mapping_cancelled_to_killed`：cancel_lease → daemon 感知 → sync_agent_run_status("killed") → AgentRun.status=="killed"
2. **确认失败**：`cd backend && uv run pytest app/modules/agent/tests/test_kill_and_state_mapping.py -q` → kill_run 测试红（task-01 空壳未接 cancel_lease）。
3. **写实现**：kill_run 接入 cancel_lease；移除残留 collect_diff；import 注入。
4. **确认通过**：重跑测试 → 全绿。
5. **回归**：`cd backend && uv run pytest -q`；`grep "_proc_registry\|SIGTERM" backend/app/modules/agent/service.py` 无命中（plan 全局验收 4）。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `grep -n "_proc_registry\|SIGTERM\|SIGKILL" backend/app/modules/agent/service.py` | 无命中（对齐 plan 全局验收 4，task-01 已删 + task-04 未重新引入） |
| AC-02 | `grep -n "collect_diff" backend/app/modules/agent/service.py` | 无命中（diff 收口 daemon，对齐 design §Phase 3 第 125 行） |
| AC-03 | `grep -n "DaemonLeaseService\|cancel_lease" backend/app/modules/agent/service.py` | kill_run 内（约 487 行）命中 `lease_svc.cancel_lease(run_id)` |
| AC-04 | 单测：`test_kill_run_calls_cancel_lease` | mock cancel_lease → kill_run 后 assert 被调用 with run_id（对齐 plan 全局验收 4） |
| AC-05 | 单测：`test_state_mapping_cancelled_to_killed`（kill_run → cancel_lease → daemon sync_agent_run_status("killed")） | AgentRun.status=="killed"（对齐 plan 全局验收 5 cancelled→killed） |
| AC-06 | 单测：`test_state_mapping_completed`（complete_lease(result.status="completed")） | AgentRun.status=="completed"（对齐 plan 全局验收 5 completed→completed） |
| AC-07 | 单测：`test_state_mapping_expired_to_failed`（handle_expired_leases → lease.expired） | AgentRun.status=="failed"（对齐 plan 全局验收 5 expired→failed） |
| AC-08 | 单测：`test_kill_run_idempotent_no_active_lease`（mock cancel_lease 返回 None） | kill_run 不抛错，返回当前 run（幂等，无 SERVER 残留进程需清） |
| AC-09 | `grep -n "run.status = .killed.\|run.status=\"killed\"" backend/app/modules/agent/service.py` | 无命中（kill_run 不直接写 killed，由 daemon sync_agent_run_status 单一驱动，对齐 plan 全局验收 5「单一驱动无对账漂移」） |
