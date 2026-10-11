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
from datetime import UTC, datetime, timedelta

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.daemon.model import AgentSessionTask
from app.modules.daemon.schema import AgentTaskStatusEvent

# 终态集合（语义②/③的判定口径；schema Literal 四态中的非 running 三态，与
# 前端归约的终态吸收态一致）。
_TERMINAL_STATUSES: frozenset[str] = frozenset({"completed", "failed", "stopped"})

# 2026-10-10-run-close-task-sweep：轮终态清扫的可读原因（任务列表 message 列）。
# 2026-10-11-task-sweep-liveness-guard：该 message 兼作「清扫收口行」识别标记
# ——upsert 对携带本标记的 stopped 行放行 running 心跳复活（自愈误收的活跃
# 任务），事件驱动的真实终态行（message 非本标记）维持终态吸收。
RUN_CLOSE_SWEEP_REASON = "轮次已结束，任务未上报终态"

# 2026-10-11-task-sweep-liveness-guard：清扫心跳宽限窗——后台子代理任务跨轮次
# 存活（主代理开轮派发后轮结束、任务继续跑、跑完发 [后台任务通知] 唤醒新轮
# 继续回复，用户指正），且线上 is_async 恒 false（daemon 上报未打标），按标记
# 排除保护不了它们。以「最近无心跳」为死判：updated_at 距清扫时刻超过本窗才
# 收口；宽限内活跃（含跨轮次后台任务）不误收，真死的任务由延迟复扫/启动兜底
# 在窗后收敛。
TASK_SWEEP_GRACE = timedelta(minutes=5)


async def finalize_running_tasks_for_run(
    session: AsyncSession,
    *,
    run_id: uuid.UUID,
    now: datetime | None = None,
) -> int:
    """2026-10-10-run-close-task-sweep：把一个 run 的非终态任务行批量收口 stopped。

    线上实证（会话 47e2ff1a，run 5e485ba2 completed）：子代理被放弃/未上报终态
    时 agent_session_task 永卡 running（17 条），任务列表在会话结束后仍显示
    「进行中」。调用方（close_interactive_run 同事务 / 启动兜底清扫 / 延迟复扫）
    以本函数收口。

    2026-10-11-task-sweep-liveness-guard 收窄（用户指正 run 终态≠任务必死）：
    只收「最近无心跳」（updated_at 距 now 超过 TASK_SWEEP_GRACE）且非异步标记
    （is_async，双保险——线上恒 false 但语义上后台任务应打标）的行；宽限窗内
    活跃的任务（跨轮次后台任务）不误收——真死任务由调用方的延迟复扫在窗后
    收敛。已终态行不触碰（终态定格语义①③不破坏）；清扫行带
    RUN_CLOSE_SWEEP_REASON 标记，误收的活跃任务下一个 running 心跳经 upsert
    复活分支自愈（真实终态行维持终态吸收不复活）。

    Returns:
        实际收口的行数。
    """
    sweep_at = now or datetime.now(UTC)
    result = await session.execute(
        update(AgentSessionTask)
        .where(
            AgentSessionTask.run_id == run_id,
            AgentSessionTask.status.notin_(_TERMINAL_STATUSES),
            AgentSessionTask.is_async.is_(False),
            AgentSessionTask.updated_at <= sweep_at - TASK_SWEEP_GRACE,
        )
        .values(
            status="stopped",
            finished_at=sweep_at,
            updated_at=sweep_at,
            message=RUN_CLOSE_SWEEP_REASON,
        )
    )
    return int(result.rowcount or 0)


async def sweep_orphan_running_tasks(session: AsyncSession, *, now: datetime | None = None) -> int:
    """2026-10-10-run-close-task-sweep：启动兜底清扫——run 已终态但任务仍 running 的行。

    自愈两类存量：①历史收口无清扫（close_interactive_run 接清扫前的旧数据）；
    ②后端重启判死路径（cleanup_stale_runs 把 running run 翻 failed）不经
    daemon 收口、无 task 事件。仅扫 run 已终态（TERMINAL_TURN_STATUSES）的行——
    running run 的任务是活跃心跳，不误伤。

    2026-10-11-task-sweep-liveness-guard：同 finalize 的心跳宽限与 is_async
    豁免（跨轮次后台任务可跨后端重启存活，updated_at 新鲜的不误收；真死任务
    下次重启收敛）。

    Returns:
        实际收口的行数。
    """
    # late import 防 agent ↔ daemon 循环依赖（对齐本模块 upsert 的调用方惯例）。
    from app.modules.daemon.session.service import TERMINAL_TURN_STATUSES

    sweep_at = now or datetime.now(UTC)
    result = await session.execute(
        update(AgentSessionTask)
        .where(
            AgentSessionTask.status.notin_(_TERMINAL_STATUSES),
            AgentSessionTask.is_async.is_(False),
            AgentSessionTask.updated_at <= sweep_at - TASK_SWEEP_GRACE,
            AgentSessionTask.run_id.in_(
                select(AgentRun.id).where(AgentRun.status.in_(TERMINAL_TURN_STATUSES))
            ),
        )
        .values(
            status="stopped",
            finished_at=sweep_at,
            updated_at=sweep_at,
            message=RUN_CLOSE_SWEEP_REASON,
        )
    )
    swept = int(result.rowcount or 0)
    await session.commit()
    return swept


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
