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

from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.daemon.model import AgentSessionTask
from app.modules.daemon.schema import AgentTaskStatusEvent

# 终态集合（语义②/③的判定口径；schema Literal 四态中的非 running 三态，与
# 前端归约的终态吸收态一致）。
_TERMINAL_STATUSES: frozenset[str] = frozenset({"completed", "failed", "stopped"})


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
    row = (
        await session.execute(
            select(AgentSessionTask).where(
                AgentSessionTask.session_id == event.session_id,
                AgentSessionTask.task_id == event.task_id,
            )
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
        if row.status in _TERMINAL_STATUSES and event.status == "running":
            return row
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
