"""Agent task status persistence store——``agent_session_task`` upsert 服务。

2026-09-04-session-task-execution-panel task-03（FR-05 / D-006@v1）：SSE
``agent_task_status`` 事件的服务端落库侧。按 (session_id, task_id) 查行做
insert-or-update 单行写入（R-03 控写放大，刻意不做事件流水表），归约语义与
前端 ``applyAgentTaskStatusEvent``（agent-task-store.ts，自 session-panel.tsx
等值抽出）同构：

1. 首事件插入新行且 ``started_at = now(UTC)``，此后 started_at 不再变；
2. 行已是终态（completed / failed / stopped）再收 running——整行跳过
   （终态定格：status 不回退、finished_at 不清除、任何字段含 updated_at
   均不刷新，迟到 running 心跳不复活任务）；
3. 后到的异种终态允许覆盖（completed 后到 failed 以最新终态为准），终态
   事件置 ``finished_at = now(UTC)``；
4. Optional 契约字段（progress / summary / message / last_tool_name /
   tool_use_id / elapsed_ms / total_tokens / tool_uses / is_async）事件值为
   None 时保留行内旧值（服务端累计量只增不减），非 None 值逐次覆盖；
5. 每次实际写入都维护 ``updated_at = now(UTC)``（快照排序键）。

调用方：router.py ``notify_agent_task_status``（SSE 转发之外的持久化旁路，
失败只记日志不影响转发与 200 返回，design §兼容策略「可回退」）。行为用例
归 task-04（tests/test_agent_session_tasks.py），本模块不带测试。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.modules.daemon.model import AgentSessionTask
from app.modules.daemon.schema import AgentTaskStatusEvent

_log = get_logger(__name__)

# 终态集合（语义②/③的判定口径；schema Literal 四态中的非 running 三态，与
# 前端归约的终态吸收态一致）。
_TERMINAL_STATUSES: frozenset[str] = frozenset({"completed", "failed", "stopped"})

# 2026-10-10-run-close-task-sweep：轮终态清扫的可读原因（任务列表 message 列）。
# 2026-10-11-task-sweep-liveness-guard：该 message 兼作「清扫收口行」识别标记
# ——upsert 对携带本标记的 stopped 行放行 running 心跳复活（自愈误收的活跃
# 任务），事件驱动的真实终态行（message 非本标记）维持终态吸收。
# 2026-10-11-task-sweep-daemon-truth：文案沿用（历史语义「随轮收口」不再准确，
# 实际含义为「daemon 确认不在活跃注册表」——保留原文仅为复活标记稳定性，
# 不改已落库行的标记可比性）。
RUN_CLOSE_SWEEP_REASON = "轮次已结束，任务未上报终态"


async def sweep_confirmed_dead_tasks(
    session: AsyncSession,
    *,
    hub,
    run_id: uuid.UUID | None = None,
    rpc_timeout: float = 5.0,
) -> int:
    """2026-10-11-task-sweep-daemon-truth：确认制任务清扫——问 daemon 注册表才收口。

    演进史：run-close-task-sweep（run 终态即收）→ task-sweep-liveness-guard
    （5 分钟心跳宽限启发式）均被用户指正误判（后台任务跨轮存活 / 长耗时任务
    静默）。本版死活判定回归唯一真相源——daemon 后台任务注册表
    （mgr._backgroundTasks：task_started 注册 / task_notification 注销 / 会话
    终态清空=SDK 进程 kill 任务随进程消亡，daemon 自己的权威语义）：

    - 会话终态（ended/failed）或无绑定 runtime → 任务必死（daemon 语义背书），
      直接收口；
    - 其余候选逐 runtime 调 ``session_live_tasks`` RPC 问活跃集，候选 task_id
      不在活跃集内才收口（活着但长时间静默的任务注册表仍在，永不被误收——
      无任何时间启发式参与死判）；
    - daemon 离线 / RPC 超时 / 旧版 daemon method_not_found → 跳过该批
      （fail-open 保活，下轮触发点再问）。

    清扫行写 RUN_CLOSE_SWEEP_REASON 标记（复活分支识别）；已终态行不触碰。
    run_id 限定时只扫该 run 的候选（run 收口延迟确认清扫用）；不限定则全量
    （启动兜底用）。

    Args:
        hub: DaemonWsHub 或等价物（async send_rpc(daemon_id, method, params,
            timeout=...)）。
        run_id: 可选——限定候选行归属的 run。

    Returns:
        实际收口的行数。
    """
    from app.modules.agent.model import AgentSession

    cand = (
        await session.execute(
            select(
                AgentSessionTask.id,
                AgentSessionTask.task_id,
                AgentSessionTask.session_id,
                AgentSession.runtime_id,
                AgentSession.status.label("session_status"),
            )
            .join(AgentSession, AgentSessionTask.session_id == AgentSession.id)
            .where(
                AgentSessionTask.status.notin_(_TERMINAL_STATUSES),
                *([] if run_id is None else [AgentSessionTask.run_id == run_id]),
            )
        )
    ).all()
    if not cand:
        return 0

    dead_row_ids: list[uuid.UUID] = []
    # runtime_id -> {session_id: {task_id: row_id}}（待 daemon 确认的候选）
    pending: dict[uuid.UUID, dict[uuid.UUID, dict[str, uuid.UUID]]] = {}
    for row in cand:
        session_status = str(row.session_status or "")
        if session_status in ("ended", "failed") or row.runtime_id is None:
            dead_row_ids.append(row.id)
            continue
        pending.setdefault(row.runtime_id, {}).setdefault(row.session_id, {})[row.task_id] = row.id

    for runtime_id, sessions in pending.items():
        for sess_id, tasks in sessions.items():
            try:
                res = await hub.send_rpc(
                    runtime_id,
                    "session_live_tasks",
                    {"session_id": str(sess_id)},
                    timeout=rpc_timeout,
                )
                live = {str(t) for t in (res.get("live_task_ids") or [])}
            except Exception as exc:
                # 离线/超时/旧版 method_not_found → fail-open 跳过该会话候选。
                _log.warning(
                    "task_sweep_daemon_confirm_failed",
                    runtime_id=str(runtime_id),
                    session_id=str(sess_id),
                    error=str(exc),
                )
                continue
            dead_row_ids.extend(rid for tid, rid in tasks.items() if tid not in live)

    if not dead_row_ids:
        return 0
    now = datetime.now(UTC)
    # 评审 F1（P2）修复：UPDATE 带非终态守卫——候选 SELECT 与最终 UPDATE 之间
    # 有真实窗口（RPC 逐会话串行，离线每会话吃满超时），期间 task_notification
    # 终态事件提交后按 id 裸 UPDATE 会把 completed/failed 覆写成 stopped+清扫
    # 标记，且已终态任务无后续事件、复活分支/latest-wins 均无法自愈（违反语义
    # ①终态定格与「已终态行不触碰」承诺；v2 的同款守卫在重写时丢失，此处恢复）。
    result = await session.execute(
        update(AgentSessionTask)
        .where(
            AgentSessionTask.id.in_(dead_row_ids),
            AgentSessionTask.status.notin_(_TERMINAL_STATUSES),
        )
        .values(
            status="stopped",
            finished_at=now,
            updated_at=now,
            message=RUN_CLOSE_SWEEP_REASON,
        )
    )
    await session.commit()
    return int(result.rowcount or 0)


def _non_none_overrides(event: AgentTaskStatusEvent) -> dict[str, object]:
    """收集事件中非 None 的 Optional 契约字段（语义④的覆盖集，键=行列名）。

    事件契约名 ``async`` 在 DTO 为 ``async_``（Python 关键字更名），行列为
    ``is_async``，在此单独映射；None 一律不进覆盖集（保留行内旧值，首插落列
    默认 False）。
    """
    candidates: dict[str, object] = {
        "progress": event.progress,
        "summary": event.summary,
        "message": event.message,
        "last_tool_name": event.last_tool_name,
        "tool_use_id": event.tool_use_id,
        "elapsed_ms": event.elapsed_ms,
        "total_tokens": event.total_tokens,
        "tool_uses": event.tool_uses,
        "is_async": event.async_,
    }
    return {key: value for key, value in candidates.items() if value is not None}


async def upsert_agent_task(session: AsyncSession, event: AgentTaskStatusEvent) -> AgentSessionTask:
    """Upsert one ``agent_session_task`` row from an ``agent_task_status`` event.

    定位键 (session_id, task_id)（表唯一约束 uq_agent_session_task_session_task），
    查行 insert-or-update 并 commit，返回写入后的行（终态吸收跳过时返回原行，
    不产生写、不 commit）。并发同键双插由唯一约束兜底——后写者撞约束抛错进
    调用方旁路 except，下一次事件即恢复单行，无需在此重试。
    """
    now = datetime.now(UTC)
    # 评审 P3-1 修复（2026-10-10-run-close-task-sweep）：FOR UPDATE 行锁读——
    # 与 close 清扫（持 run 行锁后 UPDATE 本表）的跨 commit 并发交错中，无锁
    # SELECT 快照可能读过期 running（close 已 commit stopped），随后 UPDATE 把
    # stopped 覆写回 running（丢失更新 + 残留 finished_at）。行锁串行化后读到
    # 的必是已提交终值，语义②「迟到 running 不复活」对在途事件同样成立。
    row = (
        await session.execute(
            select(AgentSessionTask)
            .where(
                AgentSessionTask.session_id == event.session_id,
                AgentSessionTask.task_id == event.task_id,
            )
            .with_for_update()
        )
    ).scalar_one_or_none()
    overrides = _non_none_overrides(event)

    if row is None:
        # 语义①：首事件插入，started_at 置 now 后不再变；首见即终态的补记
        # finished_at（同前端 terminalAt 首终态即置）。语义⑤ updated_at 同步维护。
        row = AgentSessionTask(
            session_id=event.session_id,
            run_id=event.run_id,
            task_id=event.task_id,
            task_name=event.task_name,
            status=event.status,
            started_at=now,
            finished_at=now if event.status in _TERMINAL_STATUSES else None,
            updated_at=now,
            **overrides,
        )
        session.add(row)
    else:
        # 语义②：终态吸收态——行已定格再收 running 整行跳过（不 commit、不刷新
        # 任何字段含 updated_at），迟到 running 心跳不复活任务。
        # 2026-10-11-task-sweep-liveness-guard 复活例外：行是**清扫收口**的
        # stopped（message=RUN_CLOSE_SWEEP_REASON 识别标记）且本事件是 running
        # 心跳 → 该任务实为跨轮次存活的后台任务被宽限误判收口，放行复活
        # （status 回 running、finished_at 清空、清扫标记清除），后续字段照常
        # latest-wins 累积。事件驱动的真实终态行（message 非本标记）维持吸收。
        if (
            row.status in _TERMINAL_STATUSES
            and event.status == "running"
            and not (row.status == "stopped" and row.message == RUN_CLOSE_SWEEP_REASON)
        ):
            return row
        if row.status == "stopped" and row.message == RUN_CLOSE_SWEEP_REASON:
            row.finished_at = None
            row.message = None
        # 必填字段（run_id / task_name / status）latest-wins 逐次覆盖（与前端
        # taskName 逐次覆盖同构）；语义④ Optional 字段只在事件非 None 时覆盖。
        row.run_id = event.run_id
        row.task_name = event.task_name
        row.status = event.status
        for field, value in overrides.items():
            setattr(row, field, value)
        # 语义③：终态事件（含同态重放 / 异种覆盖）每次置 finished_at=now，以最新
        # 终态为准；running 更新不动 finished_at（能走到这说明行非终态，值本就为
        # None）。started_at 保持首插值（语义①）。
        if event.status in _TERMINAL_STATUSES:
            row.finished_at = now
        row.updated_at = now  # 语义⑤

    await session.commit()
    return row
