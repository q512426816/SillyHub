---
author: qinyi
created_at: 2026-07-10T14:14:00+08:00
scale: large
---

# 设计文档（Design）— P3 Driver Gate Pilot

## 1. 背景

SillyHub 当前是"半 driver"：agent 跑完 stage → daemon 上报 → backend 读 sillyspec.db（agent 自己 `--done` 写的声明态）→ 推进下一 stage。核验全是声明态：
- `sync_stage_status` 读 agent 自己写的 sillyspec.db（`dispatch.py:1019`）
- verify 靠 `read_verify_result` 读 verify-result.md（`dispatch.py:769`），**文件缺失默认 passed**（`:775`）

agent 自述完成平台就信——这是"驾驭不住 agent"的根因。

sillyspec 已提供 `gate`/`derive` 机器接口（源码就绪，归档 2026-07-09-machine-interface-v1；npm 仍 3.22.9 未 publish，本机已 npm link 开发版）：`sillyspec gate verify --change <name> --json` 客观核验 stage 能否标记完成（跑 verify-test 真测试 + artifacts），exit 0/1/2。

**stage 完成唯一路径（实证）**：`placement.py:285-292` dispatch_to_daemon lease kind 硬编码 `'interactive'`（bfaa9256）→ `daemon.ts:3192-3196` kind 分流 early-return → `close_interactive_run`（`run_sync/service.py:684`）唯一出口；`complete_lease:541` 对 stage 是死代码。

**gate 三约束（核心）**：

| 约束 | 推论 |
|---|---|
| ① 核验源代码产物 | gate 执行必须在 daemon（agent 在 daemon 跑，产物在 daemon 侧） |
| ② 只在 stage 完成跑一次 | 触发必须由 backend（daemon 不知 stage 完成） |
| ③ gate 慢（27s+）不能在 HTTP 同步链 | daemon notifyRunResult fetch 30s 超时（hub-client.ts:177/588）+ TimeoutError 可重试（error-classify.ts:45）→ double-fire |

三约束交集：**backend 触发 + daemon 执行 + 后台异步**。

## 2. 设计目标

P3 verify stage 试点：`gate verify` 替代 `read_verify_result`，客观核验替代声明态。三态：
- **exit 0** → 推进下一 stage
- **exit 1** → 打回（errors 反馈 agent 重跑同 stage），**3 次上限**（`change.stages last_dispatch gate_retry_count`，>=3 升级 exit 2 报警人工）
- **exit 2** → 卡住报警（fail-loud；verify 强制 gate，sillyspec 未发版则阻断）

errors 可见性：前端摘要（`gate_result.errors` 截断展示）+ 完整审计（`raw_envelope` 落 AgentRunLog/审计）。跑通后扩 execute（P4）。

## 3. 非目标

- daemon 主动跑 gate（v3）：daemon 不知最后 turn，N×27s 死穴
- backend 容器直接跑（容器路）：够不到源代码，verify-test 跑空
- gate 同步在 HTTP 链（v4）：30s 超时 double-fire
- execute 波次编排（P4）/ brainstorm/plan gate：留后
- host_* 代码实体重命名（HostFsDelegate→DaemonFsDelegate 等）：随 host 移除独立做，不在 P3
- 独立 worker / 消息队列：用 `_fire_background_task` + reconcile 够

## 4. 拆分判断

无需拆分。P3 单一目标（机器 gate 核验），~11 task（task-00 前置 + HostFsDelegate run_command + gate 异步任务 + reconcile + 决策 + migration + 前端 gate_status + Z1 探测 + sillyspec 发版）。不满足拆分（非 3+ 独立可交付模块 / 无多角色 / 无审批流），不满足批量（无重复模式）。task-00 是前置（gate 决策入口），非独立变更。

## 5. 总体方案（HostFsDelegate 路 + 异步化）

### 5.1 close 快速返回（规避 30s 超时）
`close_interactive_run`（`run_sync/service.py:684`）：agent_run 终态（`:783-800`）+ `gate_status='pending'`（随 `:784` 区，`:876` commit）+ last_dispatch.status（`:806-842`）+ commit（`:876`）+ `_fire_background_task` enqueue gate 任务 → return HTTP（<30s，daemon 不重试）。删 v4 R2（末尾补 callback）。

### 5.2 gate 决策任务（后台异步，项目范式）
`_run_gate_decision_task`（新 method）：
- **H1**：`get_session_factory()()`（`core/db.py:53`）独立 session（`RunSyncService.__init__:198` 无 session_factory，禁用 self._session）
- **H4**：`_fire_background_task`（`agent/service.py:358` 范式）强引用 set 防 GC + add_done_callback 取异常防静默
- **R3**：cas `gate_status` pending→running（原子防 double-enqueue）
- 跑 `HostFsDelegate.run_command`（daemon 跑 sillyspec gate，27s+）
- 存 gate_result + gate_status=decided
- **H2**：内联 `sync_stage_status` + `auto_dispatch_next_step`（用 gate_session，不调 `_trigger_stage_completion_callback`——它写死 self._session `:959/965/969/987`）
- 异常 → gate_status=failed + exit 2

### 5.3 HostFsDelegate run_command 扩展
`delegate.py:131` 加第 9 方法 `run_command`（破 §5.1 锁死契约 `:13-15`，更新契约表）：
- daemon-client 分支：`send_rpc(method="run_command")` → daemon 执行
- **命令白名单安全层**（新抽象）：现有 8 方法靠 `assertWithinAllowedRoots`（`host-fs-handler.ts:298`）路径白名单，run_command 跑命令需命令白名单（只允 sillyspec gate 模板，stage 枚举 + changeName）
- **M5**：`send_rpc` 协议（`delegate.py:117-125`）加 timeout 参数（向下兼容），run_command 传 12min
- daemon `host-fs-handler.ts:282` 加 run_command handler + `daemon.ts:_registerHostFsRpcHandler` 注册

### 5.4 决策 + 数据模型
`auto_dispatch_next_step:197`（stage_completed 分支）：读 `AgentRun.gate_result`（exit 0 推进 / 1 打回 / 2 卡住）；verify stage（`:221-222`）gate 替代 `read_verify_result`，强制 gate（exit 2 阻断 fail-loud）。

AgentRun 加列：`gate_result` JSON（{exit_code, errors, raw_envelope}，nullable）+ `gate_status` str（pending/running/decided/failed，nullable）。

`change.stages last_dispatch` 加 `gate_retry_count`（exit 1 时 +1，>=3 升级 exit 2）。

### 5.5 reconcile 兜底（重启恢复）
`reconcile_pending_gate_decisions`（新）：挂 `main.py:73-81` lifespan startup（`reconcile_stale_runs` 是 per-dispatch 同步 `dispatch.py:553`，重启不触发，不对齐它）。启动扫 completed + gate_status in(pending,running) 全重置 pending + 重 enqueue（都是孤儿，无超时阈值——pending 是过渡态 fire 即 cas 成 running）。

### 5.6 Z1 启动探测
`_run_gate_via_delegate` 内部探测 sillyspec gate 子命令存在性，缺失给清晰 exit 2（诊断，非 fallback）。

### 5.7 gate 完成的前端通知（Grill 补）
gate 任务后台完成（27s+）后，前端需更新 gate_status 展示（"客观核验中"→"已通过"/"失败"）。close 的 SSE 只发 turn_completed（agent 完成），gate 完成无 SSE。方案：gate 任务完成时（gate_status→decided/failed）发 Redis 事件 `gate_status_changed`（agent_run_id + gate_status + errors 摘要），复用现有 agent_run SSE channel（对齐 close 的 status_changed 模式 `run_sync/service.py:879-924`），前端订阅更新。备选：前端轮询 AgentRun gate_status（5s）。推荐 SSE。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增方法 | backend/app/modules/daemon/run_sync/service.py | `_run_gate_decision_task` + `_fire_background_task` + `_background_tasks` set |
| 修改 | run_sync/service.py:684 close_interactive_run | 删 R2；commit 后 `_fire_background_task` enqueue；gate_status='pending' 随 commit |
| 新增方法 | backend/app/modules/daemon/host_fs/delegate.py:131 | `run_command`（第 9 方法，破锁死）+ 命令白名单 |
| 修改 | delegate.py:117-125 send_rpc 协议 | 加 timeout 参数（M5） |
| 新增 handler | sillyhub-daemon/src/host-fs-handler.ts:282 | `run_command`（命令白名单 + execFile） |
| 修改 | sillyhub-daemon/src/daemon.ts | `_registerHostFsRpcHandler` 注册 run_command |
| 新增方法 | backend/app/modules/change/dispatch.py | `reconcile_pending_gate_decisions` + `_run_gate_via_delegate` + `_read_gate_result` |
| 修改 | dispatch.py:197 auto_dispatch_next_step | 读 gate_result 决策（三态） |
| 修改 | dispatch.py:221-222 | verify gate 替代 read_verify_result；gate_retry_count 逻辑 |
| 修改 | backend/app/main.py:73-81 lifespan | 挂 reconcile_pending_gate_decisions |
| 修改 | backend/app/modules/agent/model.py AgentRun | 加 gate_result JSON + gate_status str 列 |
| 新增 | backend/migrations/versions/`<新>`.py | AgentRun 加列；down_revision 开工 `alembic heads` 确认 |
| 修改 | frontend change detail 页 | gate_status 展示（"客观核验中"徽标 + 失败摘要） |

## 7. 接口定义

### HostFsDelegate.run_command（新第 9 方法）
```python
async def run_command(
    self, workspace, *, command: str, args: list[str], cwd: str,
    timeout: float, env: dict | None = None,
) -> dict:
    # 返回 {exit_code, stdout, stderr, duration_ms}
    # daemon-client: send_rpc(method="run_command", workspace_id, daemon_id,
    #   args={command, args, cwd, timeout, env}, timeout=timeout)
    # server-local: raise HostFsDelegateError（gate 必须 daemon 跑，容器够不到源代码）
```

### _WsRpcLike.send_rpc（M5 加 timeout）
```python
async def send_rpc(
    self, *, method: str, workspace_id: str, daemon_id: str,
    args: dict, timeout: float | None = None,
) -> dict:  # timeout=None 走默认 30s（其他 8 方法）；run_command 传 12min
```

### _run_gate_decision_task（新）
```python
async def _run_gate_decision_task(self, agent_run_id, workspace_id, change_id):
    async with get_session_factory()() as gate_session:  # H1 独立 session
        # R3 cas gate_status pending→running（rowcount==0 则 return）
        # _run_gate_via_delegate（HostFsDelegate.run_command 跑 sillyspec gate verify，Z1 探测）
        # 存 gate_result + gate_status=decided
        # H2 内联：SillySpecStageDispatchService(gate_session).sync_stage_status + auto_dispatch_next_step
        # 异常 → rollback + gate_status=failed + gate_result exit 2
```

## 7.5 生命周期契约表

P3 涉及 session/lease/agent_run/daemon/lifecycle/complete，必填：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| close_interactive_run（HTTP） | daemon notifyRunResult | backend close_interactive_run | leaseId, runId, status, gate_status='pending' | agent_run running→completed；gate_status=pending |
| gate 任务 enqueue（fire） | close_interactive_run | 后台 _run_gate_decision_task | agent_run_id, workspace_id, change_id | gate_status pending→running（cas） |
| gate 执行（RPC） | backend HostFsDelegate | daemon run_command | command, args, cwd, timeout=12min | gate 跑（27s+），无状态变 |
| gate 完成 | gate 任务 | AgentRun | gate_result（exit_code/errors/raw_envelope） | gate_status running→decided |
| auto_dispatch 决策 | gate 任务（内联） | auto_dispatch_next_step | gate_result, sync_result | stage_completed → 推进/打回/卡住 |
| gate 打回（exit 1） | auto_dispatch | dispatch(same_stage) | feedback=errors | gate_retry_count +1；重 dispatch 同 stage |
| gate 失败 | gate 任务（catch） | AgentRun | gate_result exit 2 | gate_status → failed |
| reconcile（重启） | lifespan startup | reconcile_pending_gate_decisions | 扫 completed + gate_status in(pending/running) | 孤儿 gate_status→pending 重 enqueue |

## 8. 数据模型

AgentRun（`agent/model.py`）加列：

| 列 | 类型 | 说明 |
|---|---|---|
| gate_result | JSON, nullable | {exit_code: int, errors: list[str], raw_envelope: dict} |
| gate_status | str, nullable | pending / running / decided / failed |

`change.stages`（JSON）last_dispatch 加：

| 字段 | 类型 | 说明 |
|---|---|---|
| gate_retry_count | int | exit 1 打回时 +1；>=3 升级 exit 2 |
| gate_last_errors | list[str] | exit 1 时写本 run 的 gate errors 摘要；跨 run 持久（exit 1 打回建新 AgentRun，errors 在旧 run gate_result 不便关联；新 run/前端读 change.stages 此字段做修复参考与展示） |

migration：`backend/migrations/versions/<新 revision>.py`，`down_revision` = 开工 `alembic heads` 确认（main 当前 14 head 碎片化，不写死）。

## 9. 兼容策略（brownfield）

- gate_result / gate_status 列可空（老 agent_run 无值）
- 未跑 gate（列空）时 auto_dispatch fallback 当前声明态行为（**非 verify stage**）；verify stage 强制 gate（fail-loud，sillyspec 未发版时阻断——部署前置发版）
- 纯增量：所有改动可独立回退（删新方法/列/migration down）
- gate_status='pending' 随 close commit（gate 任务读到一致快照）
- HostFsDelegate 加第 9 方法不影响现有 8 方法（锁死契约更新但旧调用不变）
- close_interactive_run 的改动回退后，interactive stage 完成不推进的原始 bug 仍在（独立于 gate，可单独修）

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R1 | backend 重启丢 in-flight gate 任务 | 高 | reconcile 挂 lifespan startup + 重置孤儿 running→pending 重 enqueue |
| R2 | 破 HostFsDelegate 锁死契约（`:13-15`） | 高 | 加第 9 方法，更新 design §5.1 + 跨任务契约表；关联 host-fs-delegate-daemon-id-routing-bug |
| R3 | 命令白名单安全层（新抽象） | 高 | run_command 拒任意命令，只允 sillyspec gate 模板；单测覆盖注入 |
| R4 | sillyspec 未发版 | 高 | 硬前置（部署前 publish）；gate 子命令缺失（Z1）→ exit 2 阻断 fail-loud |
| R5 | H4 后台任务 GC/异常静默 | 高 | `_fire_background_task` 强引用 set + add_done_callback（agent/service.py:358 范式） |
| R6 | H1 session 关闭 | 高 | gate 任务用 `get_session_factory()()` 独立 session，禁用 self._session |
| R7 | H2 callback 写死 self._session | 高 | gate 任务内联 sync+auto_dispatch，不调 callback |
| R8 | migration 多 head（main 14 head） | 高 | 开工 `alembic heads` 确认目标 head，不写死 down_revision |
| R9 | M1 cas SQLite rowcount | 中 | 生产 PG 原子可靠；SQLite 测试 mock 或 RETURNING |
| R10 | double-fire（reconcile + 原任务） | 中 | R3 cas gate_status 原子，只一任务抢到 |
| R11 | gate verify-test 慢（27s+） | 中 | 异步不阻塞 HTTP；per-call 12min；前端完成已显示，推进稍晚 |
| R12 | gate exit 1 死循环打回 | 中 | gate_retry_count 3 次上限，>=3 升级 exit 2 报警人工 |
