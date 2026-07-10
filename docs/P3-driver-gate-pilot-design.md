---
author: qinyi
created_at: 2026-07-10T15:00:00+08:00
updated_at: 2026-07-10T13:00:06+08:00
status: draft v6（实现层修正版，待 review）
revision_note: |
  v1 错→v2 双路径→v3 单路径 daemon→v4 HostFsDelegate 同步→v5 异步化（close 快速 commit + 后台 gate 任务 + reconcile）。

  v6（子代理第 6 轮 review + 我核实，2026-07-10）：v5 架构对，但有 4 个"伪代码没贴合项目现有基础设施"的硬伤：
  H1 gate 任务用 self._session_factory——RunSyncService 没这属性（run_sync/service.py:198-199 只有 self._session）；
  H2 _trigger_stage_completion_callback 写死 self._session（:959/965/969/987），gate 任务复用会踩同坑；
  H3 migration down_revision 写死 419d34f8e33f——当前分支多 head，应开工时 alembic heads 确认；
  H4 裸 asyncio.create_task——GC 静默回收 + 异常静默丢失，项目有 _fire_background_task 范式（agent/service.py:358）。
  v6 修复：① gate 任务用 get_session_factory()()（core/db.py:53）开独立 session；② gate 任务内联 sync+auto_dispatch
  （不调 callback，避免 self._session）；③ migration down_revision 不写死；④ 复用 _fire_background_task（强引用 set +
  add_done_callback）；⑤ M2 gate_status 随 :876 commit；⑥ M3 reconcile_gate 挂 lifespan startup + 重置 running→pending；
  ⑦ M4 补 auto_dispatch:197 改动伪代码；⑧ M5 send_rpc 协议加 timeout。
---

# P3 Driver Gate Pilot — 设计草案

> 目标：agent 完成→平台推进间插入 SillySpec `gate` 客观核验，把"agent 自述完成就推进"升级为"平台客观核验通过才推进"。

> **gate 命令就绪状态**：`sillyspec gate`/`derive` 源码在 sillyspec 主仓库就绪（归档 2026-07-09-machine-interface-v1），bin 实测可跑。`package.json` 仍 3.22.9 未 npm publish。本机已 `npm link` 开发版；**生产部署需 sillyspec 侧 npm version patch + publish**。

> **命名约定（host 移除方向）**：后期 host 移除、daemon 本地跑时，统一重命名 host_*→daemon_*：HostFsDelegate→DaemonFsDelegate、host-fs-handler.ts→daemon-fs-handler.ts、host_fs 模块→daemon_fs、HOST_FS_RPC_TIMEOUT→DAEMON_FS_RPC_TIMEOUT、_registerHostFsRpcHandler→_registerDaemonFsRpcHandler。本文档沿用**现有代码名**（便于实现时 grep 定位），重命名随 host 移除独立做（不在 P3 范围）。

## 1. 问题（现状）

### 1.1 核验全是声明态
`sync_stage_status` 读 agent 自己 `--done` 写的 sillyspec.db（`dispatch.py:1019`）；verify 靠 `read_verify_result`（`dispatch.py:769`），**文件缺失默认 passed**（`:775`）。无客观核验。

### 1.2 stage 完成唯一路径
- `placement.py:285-292`：`dispatch_to_daemon` lease kind 硬编码 `'interactive'`（bfaa9256）
- `daemon.ts:3192-3196`：`kind==='interactive'` → `_startInteractiveSession` early-return
- **stage 完成唯一出口是 `close_interactive_run`**（`daemon/router.py:1116` → `run_sync/service.py:684`）
- `complete_lease:541` 的 callback 对 stage 是死代码（lease:608 过时注释与 :802 task-05 矛盾，以 :802 为准）
- **task-00 原始障碍**：`close_interactive_run`（`:684`）只更新 `last_dispatch.status`（`:806-842`），不触发 auto_dispatch

### 1.3 gate 三约束
| 约束 | 推论 |
|---|---|
| ① 核验源代码产物 | gate 执行必须在 daemon（agent 在 daemon 跑，产物在 daemon 侧） |
| ② 只在 stage 完成跑一次 | 触发必须由 backend（daemon 不知 stage 完成） |
| ③ gate 慢（27s+）不能在 HTTP 同步链 | daemon fetch 30s 超时（hub-client.ts:177/588）+ TimeoutError 可重试（error-classify.ts:45）→ double-fire |

三约束交集：**backend 触发 + daemon 执行 + 后台异步**。

## 2. 目标（P3 verify 试点）
`gate verify`（verify-test + artifacts）替代 `read_verify_result`。exit 0 推进 / 1 打回 / 2 卡住。verify 强制 gate（无 flag，sillyspec 未发版则 exit 2 阻断 fail-loud）。

## 3. 设计（HostFsDelegate 路 + 异步化 + 项目范式）

### 核心原则：close 快速返回，gate 后台跑（用项目现成范式）
- **close_interactive_run**：agent_run 终态 + gate_status='pending'（M2：随 :784 区设，随 :876 commit 一起持久化）+ enqueue gate 任务 → 快速返回 HTTP（<30s）
- **gate 决策任务**（`_fire_background_task` 防 GC + 独立 session）：HostFsDelegate run_command 跑 gate → 存结果 → 内联 sync+auto_dispatch 决策
- **reconcile_gate**：挂 lifespan startup（M3），重启时扫 + 重置孤儿 running→pending 重 enqueue

### 3a. HostFsDelegate run_command RPC 扩展（同 v4/v5 + M5）
现状：`delegate.py:131` 8 方法锁死契约（`:13-15`），WS RPC `send_rpc`（`:117-125`），超时 `HOST_FS_RPC_TIMEOUT=30s`（`ws_rpc.py:49`）；daemon `host-fs-handler.ts:282` 八方法靠 `assertWithinAllowedRoots`（`:298`）。

扩展第 9 方法 `run_command(command, args, cwd, timeout, env)` → `{exit_code, stdout, stderr, duration_ms}`：
- daemon-client 分支：`send_rpc(method="run_command", ...)` → daemon 执行
- 🔴 **命令白名单安全层**（新抽象）：路径白名单约束不了命令，需命令白名单只允 `sillyspec gate` 模板（stage 枚举 + changeName）
- **M5 超时穿透**：`_WsRpcLike.send_rpc` 协议（`:117-125`）**当前无 timeout 参数**——扩展签名加 `timeout: float | None = None`（向下兼容，其他 8 方法不传走默认 30s），run_command 传 12min（verify-test 27s 余量）
- 破锁死契约 → 更新 design §5.1 + 跨任务契约表；daemon 加 `run_command` handler + `daemon.ts:_registerHostFsRpcHandler` 注册

### 3b. close 快速返回 + gate 异步任务 + reconcile（v6 用项目范式）

**close_interactive_run（`run_sync/service.py:684`）改动**：
- 保留：agent_run 终态映射（`:783-800`）+ `gate_status='pending'`（**M2：在此区设，随 :876 commit**）+ last_dispatch.status（`:806-842`）+ usage（`:849-866`）+ `:876` commit + Redis publish（`:879-924`）
- 🔴 **删 v4 R2**（末尾补 callback）
- 🔴 **新增**：`commit :876` 后、`return :935` 前，`self._fire_background_task(self._run_gate_decision_task(agent_run.id, workspace_id, change_id))` → 快速返回。gate_status='pending' 已随 commit 持久化，gate 任务能读到

**🔴 H4：复用 `_fire_background_task` 范式**（防 GC + 异常静默）：
RunSyncService 加类级 `_background_tasks: set[asyncio.Task]` + helper（抄 `agent/service.py:358-375`）：
```python
def _fire_background_task(self, coro):
    task = asyncio.create_task(coro)
    self._background_tasks.add(task)            # 强引用防 GC
    task.add_done_callback(self._background_tasks.discard)
    task.add_done_callback(self._on_bg_task_done)  # 取异常防静默丢失

def _on_bg_task_done(self, task):
    if task.exception():
        log.error("gate_bg_task_crashed", error=task.exception())
```
> 不能裸 `asyncio.create_task`——Python asyncio 只留 task 弱引用，会被 GC 中断（agent_run 永卡 pending）。

**🔴 H1+H2：gate 任务用 `get_session_factory()()` 独立 session + 内联决策**（不调 callback）：
```python
async def _run_gate_decision_task(self, agent_run_id, workspace_id, change_id):
    # H1：独立 session（core/db.py:53 get_session_factory，项目范式 agent/service.py:842）
    # 禁用 self._session——那是 handler 的，close 返回后已关
    async with get_session_factory()() as gate_session:
        # R3：cas gate_status pending→running（原子防 double-enqueue / 重启重复）
        updated = await gate_session.execute(
            update(AgentRun).where(AgentRun.id == agent_run_id,
                                   AgentRun.gate_status == "pending")
            .values(gate_status="running"))
        if updated.rowcount == 0:
            return  # 已被其他任务接管 / 已 decided
        try:
            agent_run = await gate_session.get(AgentRun, agent_run_id)
            # 跑 gate（HostFsDelegate → daemon，27s+）
            gate_result = await self._run_gate_via_delegate(
                gate_session, workspace_id, change_id, agent_run)
            agent_run.gate_result = gate_result
            agent_run.gate_status = "decided"
            await gate_session.commit()
            # H2：内联 sync + auto_dispatch（用 gate_session，不调 self._trigger_stage_completion_callback
            # 避免它写死 self._session 踩坑；逻辑对齐 run_sync/service.py:969-993）
            from app.modules.change.dispatch import SillySpecStageDispatchService, auto_dispatch_next_step
            svc = SillySpecStageDispatchService(gate_session)
            sync_result = await svc.sync_stage_status(gate_session, change_id, agent_run_id)
            if sync_result.synced:
                user_id = (await gate_session.get(Change, change_id)).owner_id or uuid.UUID(int=0)
                await auto_dispatch_next_step(
                    session=gate_session, workspace_id=workspace_id, change_id=change_id,
                    user_id=user_id, sync_result=sync_result)  # 读 agent_run.gate_result 决策
        except Exception as exc:
            await gate_session.rollback()
            await gate_session.execute(update(AgentRun).where(AgentRun.id == agent_run_id)
                .values(gate_status="failed", gate_result={"exit_code": 2, "error": str(exc)}))
            await gate_session.commit()
            log.warning("gate_decision_task_failed", agent_run_id=agent_run_id, error=exc)
```
> **M1 cas 原子性**：PG 的 `UPDATE...WHERE...rowcount` 对并发原子可靠；SQLite（测试）rowcount 语义不稳，单测用 mock 或 `RETURNING` 验证。生产 PG 才是真核验。

**🔴 M3：reconcile_gate 挂 lifespan startup**（非 per-dispatch）：
`reconcile_stale_runs`（dispatch.py:358）是 `_cleanup_before_dispatch`（:553）同步调，重启后无 dispatch 不触发——**不能对齐它**。v6 挂 `main.py:73-81` lifespan startup（重启必跑一次）：
```python
async def reconcile_pending_gate_decisions(session):
    # 启动时：所有 completed + gate_status in (pending, running) 都是孤儿（旧进程死，in-flight 全丢）
    # 无超时阈值——pending 是过渡态（fire 即 cas 成 running），running 是任务态；重启时两者必孤儿，无条件重 enqueue
    orphans = await session.execute(
        select(AgentRun).where(AgentRun.status == "completed",
            AgentRun.gate_status.in_(["pending", "running"])))
    for run in orphans.scalars():
        await session.execute(update(AgentRun).where(AgentRun.id == run.id)
            .values(gate_status="pending"))  # running→pending（孤儿）+ 超时 pending 重 enqueue
        svc = RunSyncService(session)
        svc._fire_background_task(svc._run_gate_decision_task(run.id, ...))
```
挂 `main.py` lifespan（`AgentService.cleanup_stale_runs` 旁加一行）。

**🔴 M4：auto_dispatch_next_step 决策改动伪代码**（`dispatch.py:197` stage_completed 分支）：
当前 :219-222 读 `read_verify_result`（声明态 md），改成读 gate_result：
```python
if sync_result.stage_completed:
    gate_result = agent_run.gate_result or {}  # gate 任务已写入（内联调用时传入）
    if gate_result.get("exit_code") == 1:
        return await dispatch(same_stage, feedback=gate_result.get("errors"))  # 打回
    if gate_result.get("exit_code") == 2:
        return {"dispatched": False, "reason": "gate_unknown"}  # 卡住 fail-loud
    # exit 0 → 原 complete_stage + dispatch(next)
    complete_result = await cs.complete_stage(...)  # 原 :225
    ...
```
verify stage（`:221-222`）：`read_verify_result` 替代为读 gate_result（exit 0 才过，强制，Z3）。

### 3c. 数据流（v6）

```
agent turn 完成 → daemon notifyRunResult:1402 → backend close_interactive_run:684
  → agent_run 终态(:784) + gate_status='pending'(随 :876 commit) + last_dispatch.status
  → 🔴 _fire_background_task(_run_gate_decision_task)（强引用防 GC）
  → return HTTP 200（<30s，daemon 不重试）
      └── 后台 gate 任务（get_session_factory 独立 session）
            → R3 cas gate_status pending→running
            → HostFsDelegate.run_command(gate verify, daemon 27s+)
            → 存 AgentRun.gate_result + gate_status='decided'
            → 内联 sync_stage_status + auto_dispatch:197（用 gate_session）
                → 读 gate_result → exit 0 推进 / 1 打回 / 2 卡住
  → reconcile_gate（lifespan startup）：重启扫孤儿 running→pending + 重 enqueue
```

## 4. 接入点清单（v6 实证，行号截至 main @ 2026-07-10）

| 侧 | 文件:行号 | 改动 |
|---|---|---|
| 🔴 close 改 enqueue | `run_sync/service.py:684`（commit `:876` 后、return `:935` 前） | 删 R2；加 `_fire_background_task(_run_gate_decision_task)`；gate_status='pending' 在 :784 区随 commit |
| 🔴 H4 后台任务范式 | `run_sync/service.py` RunSyncService 类 | 加 `_background_tasks: set` + `_fire_background_task` + `_on_bg_task_done`（抄 agent/service.py:358-375） |
| 🔴 H1+H2 gate 任务 | `run_sync/service.py` 新 `_run_gate_decision_task` | `get_session_factory()()` 独立 session + R3 cas + gate + 内联 sync/auto_dispatch（不调 callback） |
| 🔴 M3 reconcile | `dispatch.py` 新 `reconcile_pending_gate_decisions` + 挂 `main.py:73-81` lifespan | 启动扫 completed + gate_status in (pending, running) 全重置 pending + 重 enqueue（都是孤儿，无超时阈值） |
| HostFsDelegate 新方法 | `delegate.py:131`（破 `:13-15`）+ `:117-125` send_rpc | 加 `run_command` + **M5 send_rpc 协议加 timeout 参数** |
| daemon handler | `host-fs-handler.ts:282` + `daemon.ts:_registerHostFsRpcHandler` | 加 `run_command`（命令白名单 + execFile）+ 注册 |
| backend 决策 | `dispatch.py:197`（def `:145`）+ `:221-222` | M4：读 gate_result 替代 read_verify_result（三态分支） |
| backend gate 探测（Z1） | `_run_gate_via_delegate` 内部 | 探测 gate 子命令，缺失给 exit 2（诊断） |
| 🔴 backend 存储（列） | `agent/model.py` AgentRun + migration | 加 `gate_result` JSON + `gate_status` str（pending/running/decided/failed）；migration `down_revision` = **开工时 `alembic heads` 确认的真实 head**（H3：不写死，当前分支多 head） |
| sillyspec 发版 🔴 | sillyspec 主仓库 | 3.22.9 未含 gate；部署前 publish |

> H3 提醒：main 当前 **14 个 head**（含 419d34f8e33f / dceb0c45ab3e 等 merge），migration 链碎片化。P3 实现必须：① `alembic heads` 看全貌；② 合并或确认目标 head 再定 down_revision（挂错会 crash-loop，见 migration-chain-fragmentation-pattern）。

## 5. 不做（范围控制）
- daemon 主动跑 gate（v3）/ 容器路 / gate 同步在 HTTP 链（v4）：已证不可行
- 独立 worker / 消息队列：v6 用 `_fire_background_task` + reconcile 兜底，够；持久化队列留后
- execute 波次编排（P4）/ brainstorm/plan gate：留后

## 6. 风险与对策
| 风险 | 对策 |
|---|---|
| 🔴 H4 后台任务 GC/异常静默 | `_fire_background_task` 强引用 set + add_done_callback 取异常（agent/service.py:358 范式） |
| 🔴 H1 session 关闭 | gate 任务用 `get_session_factory()()` 独立 session，禁用 self._session |
| 🔴 H2 callback 写死 self._session | gate 任务内联 sync+auto_dispatch（用 gate_session），不调 callback |
| 🔴 H3 migration 多 head | 开工 `alembic heads` 确认真实 head；切 main |
| backend 重启丢 in-flight 任务 | M3 reconcile_gate 挂 lifespan startup + 重置孤儿 running→pending 重 enqueue |
| 🔴 破 HostFsDelegate 锁死契约 | 加第 9 方法，更新 §5.1 契约 |
| 🔴 命令白名单 | run_command 拒任意命令，只允 sillyspec gate 模板；单测覆盖注入 |
| 🔴 sillyspec 未发版 | 硬前置；gate 子命令缺失（Z1）→ exit 2 阻断 fail-loud |
| M1 cas SQLite rowcount | 生产 PG 原子可靠；SQLite 测试 mock 或 RETURNING |
| double-fire（reconcile + 原任务） | R3 cas gate_status 原子，只一任务抢到 |
| gate verify-test 慢 | 异步不阻塞 HTTP；per-call 12min；前端完成已显示，推进稍晚 |

## 7. 回退
纯增量：close 还原（删 enqueue + gate_status）+ 删 `_run_gate_decision_task`/`_fire_background_task`/`reconcile_pending_gate_decisions`/`_run_gate_via_delegate` + 还原 auto_dispatch:197 + 删 HostFsDelegate run_command + drop gate_result/gate_status 列。task-00 close 改动回退后，interactive 不推进的原始 bug 仍在（独立可修）。

## 8. 验收
1. verify 实测通过 → gate exit 0 → 推进
2. verify 实测失败 → exit 1 → 打回
3. gate 异常（离线/超时/未发版）→ exit 2 → 阻断 fail-loud
4. close 快速返回（<30s，daemon 不重试）
5. 不 double-fire（gate>30s daemon 不重试；reconcile+原任务 cas 只一跑）
6. backend 重启恢复（lifespan reconcile 扫孤儿重 enqueue）
7. H4 任务不丢（_fire_background_task 强引用；异常被 log）
8. gate 只跑一次（stage_completed 决策点）
9. 命令白名单拒非 gate 命令
10. 对话型 run / 非 verify stage → 不调 gate

## 9. 下一步
1. **确认 migration head**（H3）：`alembic heads` 看 main 14 head 全貌，合并或确认目标 head 再定 down_revision
2. **task-00 v6**：close 改 enqueue + RunSyncService 加 `_fire_background_task`（H4）+ gate 任务（H1 独立 session + H2 内联）+ reconcile lifespan（M3）
3. **HostFsDelegate run_command**：契约 + 命令白名单 + M5 send_rpc timeout + daemon handler
4. **auto_dispatch:197 + migration**：M4 读 gate_result + AgentRun 加列
5. **Z1 探测 + sillyspec 发版**
6. **verify 试点测试**
7. **前端 gate_status 消费（UX）**：close 立即返回后到 gate 推进有 ~27s 窗口，前端读 gate_status=running 显示"客观核验中"（pending/decided/failed 对应待核验/已通过/核验失败），避免用户看到 run 完成却卡住困惑。plan 记前端任务。
8. **gate errors 可见性决策（plan）**：gate exit 1 打回时 errors 经新 dispatch prompt 注入 agent；errors 原文是否暴露给前端/审计（vs agent-only），plan 时定。

## 附录 A：关键函数定位（实证）

| 函数/类 | 位置 | 职责 |
|---|---|---|
| `auto_dispatch_next_step` | `dispatch.py:145`（stage_completed `:197-269`） | 决策点：M4 读 gate_result（替代 read_verify_result :222） |
| `read_verify_result` | `dispatch.py:769` | 被 gate verify 替代 |
| `sync_stage_status` | `dispatch.py:1019` | gate 任务内联调（gate_session） |
| `reconcile_stale_runs` | `dispatch.py:358`（被 `_cleanup_before_dispatch:553` 同步调） | per-dispatch 非启动 cron；**reconcile_gate 不对齐它，挂 lifespan** |
| `close_interactive_run` | `run_sync/service.py:684`（早返回 `:772-779` / commit `:876` / 末尾 `:935`） | v6：快速 commit + `_fire_background_task` enqueue |
| `RunSyncService.__init__` | `run_sync/service.py:198-199`（仅 self._session + self._facade） | **无 session_factory** → H1 用 get_session_factory()() |
| `_trigger_stage_completion_callback` | `run_sync/service.py:939`（self._session `:959/965/969/987`） | **H2 gate 任务不调它，内联** |
| `get_session_factory` | `core/db.py:53` | H1 独立 session（范式 agent/service.py:842） |
| `_fire_background_task` 范式 | `agent/service.py:358-375`、`coordinator.py:95-112` | H4 复用（强引用 set + done_callback） |
| `reconcile_pending_gate_decisions`（新） | 挂 `main.py:73-81` lifespan | M3 启动扫孤儿 |
| `HostFsDelegate` | `delegate.py:131`（锁死 `:13-15`）+ `send_rpc:117-125` | v6 加 run_command + M5 send_rpc timeout |
| `HostFsHandler` | `host-fs-handler.ts:282`（白名单 `:298`） | v6 加 run_command + 命令白名单 |
| `HOST_FS_RPC_TIMEOUT` | `ws_rpc.py:49`（30s） | run_command per-call 传 12min（经 M5 send_rpc） |
| daemon notifyRunResult 超时 | `hub-client.ts:177/588`（30s） | close 快速返回规避 |
| `_runLeaseStateMachine` | `daemon.ts:3062`（kind 分流 `:3192-3196`） | interactive early-return |
