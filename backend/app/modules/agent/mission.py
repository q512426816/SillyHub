"""Mission aggregation + status derivation (2026-06-19-multi-agent-orchestration).

Wave 1: ``derive_status`` — Mission status is NOT persisted, derived from child
AgentRuns so the source of truth stays AgentRun + Lease (no second state system).
Wave 2: ``MissionService.start_mission`` — create a Mission, plan Worker
delegations via a direct GLM call (CoordinatorPlanner), and persist pending
Worker Runs. Worker *execution* (daemon dispatch) is Wave 3.

2026-08-25-team-subsession-governance task-08（FR-05 / D-005@v1，design
§5.C.3–5.C.4）：``is_worker_complete``（worker 完成判据单一真相源，双形态）
+ ``mission_derive_status``（derive_status 的 mission 级虚拟 run 映射包装）。

2026-08-26-team-subsession-recursion task-03（FR-05 / FR-07 / design §5.E）：
``mission_derive_status`` 分身集合换 ``mission_worker_sessions_tree`` 全树
枚举（孙层计入）+ ``budget_force_ended_at`` 预算强收标记的虚拟映射增补
（会话 ended 且未 done → failed 终态，强收后 mission 可收敛 degraded）。

审计修复 F01（docs/qa/subsession-backend-audit-2026-08-26.md §A.6-1）：
``worker_force_ended_at`` 死分身标记键——「会话 ended/failed 且未 done」存在
预算强收之外的生成源（手动 end_session / 空闲清扫 / 终态清扫），无标记时映射
running 使非预算 mission 死锁（converge 永久 busy）。patrol 职责⑦对超宽限
死分身置位；本模块映射规则扩为「budget 或 worker 任一标记存在时 ended 未
done → failed 终态」（两标记同象，F01）。
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from typing import Any

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.logging import get_logger
from app.modules.agent.delegation import CoordinatorPlanner, DelegationError
from app.modules.agent.model import (
    ACTIVE_RUN_STATUSES,
    AgentMission,
    AgentRun,
    AgentSession,
    mission_worker_sessions_tree,
)

log = get_logger(__name__)

_ACTIVE = {"pending", "running"}
_DONE = {"completed"}
_FAILED = {"failed", "killed"}


def derive_status(
    runs: Iterable[AgentRun],
    cancelled: bool = False,
    *,
    converged: bool = False,
    has_session: bool = False,
    session_active_turn: bool = False,
) -> str:
    """Derive Mission status from its child AgentRuns.

    Returns one of:
    ``planning | running | awaiting_input | degraded | done | failed | cancelled``.

    判据矩阵（2026-08-22-team-session-unify task-02 / design §5 Phase1，按序判）：

    - ``cancelled``: mission explicitly cancelled (``cancelled_at`` set).
    - ``planning``: no child runs yet（无分身 run 且无主控轮回填，输入为空）.
    - ``running``: any run（主控轮或分身）still pending/running.
    - ``awaiting_input``: all runs terminal + 未 converge（``converged_at`` IS NULL）
      + 无会话活跃 turn + mission 绑定会话（``has_session``）——会话 mission 等
      主控输入的中间档，仅派生不落库（design §8）。
    - ``degraded``: all terminal, at least one completed AND at least one failed.
    - ``done``: all terminal, at least one completed, none failed.
    - ``failed``: all terminal, none completed.

    纯函数契约：``converged`` / ``has_session`` / ``session_active_turn`` 由调用方
    查明后以 keyword-only 布尔传入，函数内不查 DB。NULL 守卫（Grill NEW-4）：
    ``has_session=False``（存量 external/bootstrap mission，session 维度缺失）永不
    进 ``awaiting_input``——存量调用方不传新参时返回值逐字节不变，complete_lease
    自动收敛依赖的 derive∈{done, degraded} 语义零回归。
    """
    if cancelled:
        return "cancelled"
    statuses = [r.status for r in runs]
    if not statuses:
        return "planning"
    if any(s in _ACTIVE for s in statuses):
        return "running"
    # awaiting_input 仅会话 mission（session_id 非 NULL）可进；converge 置位
    # （已终态化）或主控会话有活跃 turn（新一轮进行中）时回落存量终态判定。
    if has_session and not converged and not session_active_turn:
        return "awaiting_input"
    has_completed = any(s in _DONE for s in statuses)
    has_failed = any(s in _FAILED for s in statuses)
    if has_completed and has_failed:
        return "degraded"
    if has_completed:
        return "done"
    return "failed"


# ── 分身完成判据单一真相源（2026-08-25-team-subsession-governance task-08，
#    FR-05 / D-005@v1 / design §5.C.3–5.C.4）──────────────────────────────────

# 主控轮标记（字面量对齐 control._ORCHESTRATOR_ROLE / D-009：role='orchestrator'
# 的 mission run 是主控轮；NULL role 是存量分身 run——workers_only 收窄不可漏）。
_ORCHESTRATOR_ROLE = "orchestrator"
# 分身会话终态（AgentSession.status 词表子集：failed / ended；pending / active /
# reconnecting 均为进行中）。
_WORKER_SESSION_TERMINAL = frozenset({"failed", "ended"})
# 存量 batch run 终态（= derive_status 词表 _DONE ∪ _FAILED，FR-09 存量判据零回归）。
_WORKER_RUN_TERMINAL = frozenset({"completed", "failed", "killed"})
# 预算强收标记键（2026-08-26-team-subsession-recursion task-03 / design §5.E，
# mission.py 单源）：patrol 预算触顶批量强收前原子置位到 mission.constraints
# （ISO 时间戳值，task-07 写）；本模块只读键存在性做虚拟映射——标记存在时
# 「会话 ended 且未 done」映射 failed 终态，保证强收后 mission 可收敛 degraded。
BUDGET_FORCE_ENDED_AT_KEY = "budget_force_ended_at"
# 死分身强收标记键（审计修复 F01 / docs/qa/subsession-backend-audit-2026-08-26.md
# §A.6-1，mission.py 单源）：「会话 ended/failed 且未 done」存在预算强收之外的
# 生成源（属主门户手动 end_session / reconnecting 空闲清扫 / 终态清扫残留），
# 无标记时该形态映射 running → derive 恒 running → converge 永久 busy、
# awaiting_input 超时收敛永不触发（非预算 mission 唯一出口人工 cancel 的死锁态）。
# patrol 职责⑦对超宽限的死分身原子置位（ISO 时间戳值）；本模块只读键存在性
# 做虚拟映射——与 budget 标记同象：「会话 ended 且未 done」→ failed 终态。
WORKER_FORCE_ENDED_AT_KEY = "worker_force_ended_at"


async def _sessions_with_active_turns(
    db: AsyncSession, session_ids: list[uuid.UUID]
) -> set[uuid.UUID]:
    """批量查明哪些会话当前有活跃 turn（ACTIVE_RUN_STATUSES 单源词表）。

    判定口径与 ``finalizer._session_has_active_turn`` 同款（会话下存在
    status ∈ ACTIVE_RUN_STATUSES 的 run 即活跃，含 pending_approval，不含前端
    展示态 interrupting——backend 不落库）；状态集合从 ``agent.model`` 单源
    import 不另抄（task-08 约束）。批量 IN 查询避免逐会话 N+1；空集直接返回。
    """
    if not session_ids:
        return set()
    stmt = select(AgentRun.agent_session_id).where(
        AgentRun.agent_session_id.in_(session_ids),
        AgentRun.status.in_(list(ACTIVE_RUN_STATUSES)),
    )
    rows = (await db.execute(stmt)).all()
    return {session_id for (session_id,) in rows if session_id is not None}


async def is_worker_complete(db: AsyncSession, worker: AgentSession | AgentRun) -> bool:
    """worker 完成判据单一真相源（FR-05 / D-005@v1，design §5.C.3）。

    双形态并存即双判据兼容（task-09 替换五处判据点时按对象形态分发：
    子会话形态传 ``AgentSession``、存量 batch 形态传 ``AgentRun``）：

    - **子会话形态**（``AgentSession``，D-002@v1 显式标记）：
      - 完成 = ``worker_done_at IS NOT NULL`` **且**该会话无活跃 turn——追问
        重开工期间（新一轮 run 活跃）自动回未完成，干完再调 worker_done 回到
        完成，可重复完成周期语义自洽；
      - 失败/终结 = 会话终态（``failed`` / ``ended``）。
    - **存量 batch 形态**（``AgentRun``）：run 终态集合 completed / failed /
      killed（无子会话的存量 mission 判据路径零回归，FR-09）。
    """
    if isinstance(worker, AgentSession):
        if worker.status in _WORKER_SESSION_TERMINAL:
            return True
        if worker.worker_done_at is None:
            return False
        active_ids = await _sessions_with_active_turns(db, [worker.id])
        return worker.id not in active_ids
    return worker.status in _WORKER_RUN_TERMINAL


async def mission_derive_status(
    db: AsyncSession, mission_id: uuid.UUID, *, workers_only: bool = False
) -> str:
    """``derive_status`` 的 mission 级包装（design §5.C.4 虚拟 run 映射）。

    纯函数 ``derive_status`` 的 run 级签名与判定不动（D-005@v1）——本包装
    查明 mission 维度事实（cancelled / converged / has_session /
    session_active_turn）并把分身子会话映射为虚拟 run 后合并喂给纯函数：

    1. 收集 mission 下**非子会话** run（主控轮 + 存量 batch run）原样；
       ``workers_only=True`` 时排除 ``role='orchestrator'``（对齐 D-010
       「置位不依赖主控 run 状态」与 schedule_loop 信号 1 现行收窄——否则
       主控在自己活跃轮内 derive 恒 running、converge 置位永败）。NULL role
       守卫同 ``control.non_orchestrator_runs``（SQL 三值逻辑 ``!=`` 漏 NULL
       行，存量分身 run 不容漏）。分身首 run（带 mission_id 但
       agent_session_id ∈ 子会话全树）被剔除——分身状态一律以子会话行的
       虚拟映射为准，避免同分身双计（含孙首 run，按全树 id 集合剔除）；
    2. 每个分身子会话（``mission_worker_sessions_tree`` 全树枚举，含孙层，
       2026-08-26 task-03 / design §5.E——无孙树与一层枚举等价，FR-08 零回归）
       映射虚拟 run，优先级从高到低：``worker_done_at`` 非空且无活跃 turn →
       ``completed``（优先于终态映射——converge end_session 后 done 分身仍
       映射 done 而非 failed）；mission.constraints 带强收标记
       （``budget_force_ended_at`` 预算强收 / ``worker_force_ended_at`` 死分身
       扫描，审计修复 F01——只读键存在性，任一存在即生效）时会话 ``ended``
       且未 done → ``failed``（终态而非 running——强收后 mission 可收敛
       degraded，design §5.E Grill M2）；会话终态 ``failed`` → ``failed``；
       其余（含 idle 未 done、追问重开工中、无标记 ended 未 done）→
       ``running``；
    3. 两组合并喂 ``derive_status``。空集语义：有分身时虚拟集合非空，不会
       误判 planning。

    mission 不存在 / session_id 查无会话行（存量 external 形态）→ 输入按空集
    宽限（对齐 ``mission_worker_sessions_tree`` 缺行返 [] 口径），返回
    planning。
    """
    mission = (
        (await db.execute(select(AgentMission).where(col(AgentMission.id) == mission_id)))
        .scalars()
        .first()
    )
    worker_sessions = await mission_worker_sessions_tree(db, mission_id)
    worker_session_ids = {s.id for s in worker_sessions}

    runs_stmt = select(AgentRun).where(col(AgentRun.mission_id) == mission_id)
    if workers_only:
        runs_stmt = runs_stmt.where(
            or_(col(AgentRun.role).is_(None), col(AgentRun.role) != _ORCHESTRATOR_ROLE)
        )
    raw_runs = (await db.execute(runs_stmt)).scalars().all()
    runs = [r for r in raw_runs if r.agent_session_id not in worker_session_ids]

    active_worker_ids = await _sessions_with_active_turns(db, list(worker_session_ids))
    # 强收标记只查键存在性（constraints None 安全）；置位归 patrol（budget 键=
    # 职责⑥预算触顶，worker 键=职责⑦死分身扫描，审计修复 F01）。两键同象：
    # 任一存在即武装「ended 未 done → failed」终态映射。
    budget_force_ended = (
        mission is not None
        and mission.constraints is not None
        and BUDGET_FORCE_ENDED_AT_KEY in mission.constraints
    )
    worker_force_ended = (
        mission is not None
        and mission.constraints is not None
        and WORKER_FORCE_ENDED_AT_KEY in mission.constraints
    )

    # ql-20260828-013-a55b：每子会话首 run（mission 下带 role 的最早 run）终态
    # 兜底查表——raw_runs 含树内 run（仅从 derive 输入剔除防双计），按
    # created_at 排序后 setdefault 取最早；追问轮 run 无 mission_id 天然不进。
    first_run_status_by_session: dict[uuid.UUID, str] = {}
    for r in sorted(raw_runs, key=lambda x: x.created_at.isoformat() if x.created_at else ""):
        if r.agent_session_id is not None and r.role is not None:
            first_run_status_by_session.setdefault(r.agent_session_id, r.status)

    def _virtual_status(s: AgentSession) -> str:
        # 优先级：done 且无活跃 turn → completed > 强收标记（budget 或 worker
        # 任一，F01）下会话 ended 且未 done → failed（终态，可收敛 degraded）>
        # 会话终态 failed → failed > 首 run 终态 failed/killed → failed
        # （ql-20260828-013-a55b：树内 run 从 derive 输入剔除，run 已死的终态
        # 信息原本完全丢失——run killed 后会话 ended 无强收标记、run failed
        # 后会话未收敛 active，两种形态虚拟 run 都卡 running 致 mission 永不
        # 收敛）> 其余（idle 未 done / 追问重开工中 / 无标记 ended 未 done）→
        # running。
        if s.worker_done_at is not None and s.id not in active_worker_ids:
            return "completed"
        if (
            (budget_force_ended or worker_force_ended)
            and s.status == "ended"
            and s.worker_done_at is None
        ):
            return "failed"
        if s.status == "failed":
            return "failed"
        if first_run_status_by_session.get(s.id) in ("failed", "killed"):
            return "failed"
        return "running"

    virtual_runs = [
        AgentRun(agent_type="claude_code", status=_virtual_status(s)) for s in worker_sessions
    ]

    cancelled = mission is not None and mission.cancelled_at is not None
    converged = mission is not None and mission.converged_at is not None
    has_session = False
    session_active_turn = False
    if mission is not None and mission.session_id is not None:
        # 会话 mission 判别同 finalizer 口径：session_id 列对存量构造路径可能
        # 是随机 uuid，按「该 id 的 AgentSession 真实存在」判别，查无行 →
        # has_session=False（永不进 awaiting_input，存量零回归）。
        bound_session = await db.get(AgentSession, mission.session_id)
        if bound_session is not None:
            has_session = True
            session_active_turn = mission.session_id in await _sessions_with_active_turns(
                db, [mission.session_id]
            )
    return derive_status(
        [*runs, *virtual_runs],
        cancelled=cancelled,
        converged=converged,
        has_session=has_session,
        session_active_turn=session_active_turn,
    )


async def get_active_mission_for_session(
    db: AsyncSession, session_id: uuid.UUID
) -> AgentMission | None:
    """按会话取活跃 mission（design §6 辅助查询，R-07 单活跃约束）。

    活跃 = ``session_id = X`` AND ``converged_at IS NULL`` AND
    ``cancelled_at IS NULL``；命中多条时取 ``created_at`` 最新一条（数据库侧
    部分唯一索引 ``uq_agent_missions_session_active`` 已保证至多一条，排序仅
    防御），无活跃返回 ``None``。消费方：task-03 预建 409 冲突检测 / task-04
    inject 双标记回填 / task-05 mcp_tools 会话定位。注意：懒建并发守卫
    （Grill NEW-3）在 daemon 侧另走 SELECT...FOR UPDATE，本查询不加锁。
    """
    stmt = (
        select(AgentMission)
        .where(
            col(AgentMission.session_id) == session_id,
            col(AgentMission.converged_at).is_(None),
            col(AgentMission.cancelled_at).is_(None),
        )
        .order_by(col(AgentMission.created_at).desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    return result.scalars().first()


class MissionService:
    """Create + plan a multi-agent Mission (Wave 2).

    Planning is a direct GLM call (``CoordinatorPlanner``); Worker execution is
    Wave 3 (daemon dispatch). This service only persists the Mission + pending
    Worker Runs (flat — no inter-worker DAG edges in v1; Finalizer dependency
    wiring lands in Wave 3).
    """

    def __init__(self, session: AsyncSession, planner: CoordinatorPlanner | None = None) -> None:
        self._session = session
        self._planner = planner

    async def start_mission(
        self,
        *,
        workspace_id: uuid.UUID,
        objective: str,
        created_by: uuid.UUID | None = None,
        change_id: uuid.UUID | None = None,
        constraints: dict[str, Any] | None = None,
        budget_tokens: int | None = None,
        budget_usd: float | None = None,
        planner: CoordinatorPlanner | None = None,
    ) -> tuple[AgentMission, list[AgentRun]]:
        """Plan delegations and persist Mission + pending Worker Runs.

        Returns ``(mission, worker_runs)``. Workers stay ``pending`` until Wave 3
        dispatches them to a daemon.
        """
        active_planner = planner or self._planner
        if active_planner is None:
            raise DelegationError("MissionService requires a CoordinatorPlanner")
        coordinator_summary, delegations = await active_planner.plan(objective, constraints)

        # 存 Coordinator 拆解 summary 到 constraints（供前端展示拆解结果，无 migration，
        # 2026-06-28：让"Coordinator 拆解"从黑盒变为页面可见）。
        merged_constraints: dict[str, Any] = dict(constraints or {})
        if coordinator_summary:
            merged_constraints["coordinator_summary"] = coordinator_summary

        mission = AgentMission(
            workspace_id=workspace_id,
            change_id=change_id,
            objective=objective,
            constraints=merged_constraints,
            budget_tokens=budget_tokens,
            budget_usd=budget_usd,
            created_by=created_by,
        )
        self._session.add(mission)
        await self._session.commit()
        await self._session.refresh(mission)

        runs: list[AgentRun] = []
        for d in delegations:
            run = AgentRun(
                mission_id=mission.id,
                change_id=change_id,
                agent_type="claude_code",
                status="pending",
                role=d.role,
                objective=d.objective,
            )
            self._session.add(run)
            runs.append(run)
        await self._session.commit()
        for r in runs:
            await self._session.refresh(r)

        log.info(
            "mission_started",
            mission_id=str(mission.id),
            workers=len(runs),
            roles=[d.role for d in delegations],
        )
        return mission, runs
