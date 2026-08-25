"""Mission control plane — governance (Wave 4, 2026-06-19-multi-agent-orchestration).

Budget / concurrency / cancellation / partial-failure policies for a Mission,
operating on the Wave 1 data model. Status stays derived (``derive_status``);
this service only enforces gates and mutates cancellation.

- Budget (brainstorm 坑 4): before dispatching a Worker, check cumulative cost
  vs ``Mission.budget_usd``; exceeding refuses new Workers (a convergence
  signal, not an error).
- Concurrency: cap active Workers at ``MAX_WORKERS``.
- Cancellation: mark ``cancelled_at`` + kill active child Runs.
- Partial failure (D6): handled by ``derive_status`` → ``degraded`` (not here).

2026-08-22-team-session-unify task-07（design §5 D-009 / 审查 B3 / D-007@v2）：
治理口径（并发额度 / 成本 / kill 对象）统一收窄为仅分身 run
（``non_orchestrator_runs``，NULL role 三值逻辑守卫）——主控轮
（role='orchestrator'）回填 mission_id 后不占 MAX_WORKERS、不计分身成本、
不进 cancel kill 名单；``worker_runs`` 保持全量供主控锚点 / derive 消费。

2026-08-25-team-subsession-governance task-11（FR-07 / design §5.C.6 + §5.D）：
治理三口径换子会话新形态（混跑双形态并存，FR-09 存量零回归）：
- 并发计数 = 存量 running/pending 分身 run + ``is_worker_complete=False`` 的
  分身子会话合计（子会话首 run 从 run 维度剔除，防同分身双计——对齐
  ``mission_derive_status`` 虚拟映射的剔除口径）；
- ``cost_so_far`` 输入 union = 存量分身 run ∪ 分身子会话轮次 run
  （``agent_session_id ∈ mission_worker_sessions``），预算治理门覆盖追问轮成本；
- ``cancel`` kill 名单 = 活跃存量分身 run ∪ 活跃分身子会话——子会话按其活跃轮
  run（无活跃轮取首 run）调 ``cancel_lease``，命中 P0-2
  ``_lookup_interactive_lease_by_run`` 回捞链发 SESSION_END（lease cancelled +
  子会话 ended），存量 batch run 路径不变。
子会话完成判定唯一入口 ``mission.is_worker_complete``（task-08）、枚举唯一入口
``model.mission_worker_sessions_tree``（task-01，2026-08-26-team-subsession-recursion
task-08 起治理口径换全树含孙层，design §5.E），本模块不自写判据。
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from datetime import UTC, datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.logging import get_logger
from app.modules.agent.delegation import MAX_WORKERS
from app.modules.agent.mission import (
    _WORKER_RUN_TERMINAL,
    _WORKER_SESSION_TERMINAL,
    _sessions_with_active_turns,
)
from app.modules.agent.model import (
    ACTIVE_RUN_STATUSES,
    AgentMission,
    AgentRun,
    AgentSession,
    mission_worker_sessions_tree,
)

log = get_logger(__name__)

_ACTIVE = ("pending", "running")

# 主控轮标记（2026-08-22-team-session-unify task-07 / D-009，design §5 核心机制）：
# role='orchestrator' 的 mission run 是主控轮（存量 external mission 同标记）。
_ORCHESTRATOR_ROLE = "orchestrator"

# 可收口的会话状态（task-11 / design §5.D cancel 沿树收口）：与
# lease_service.cancel_lease 的会话收口词表同源（pending/active/reconnecting）——
# 已终态（ended/failed）子会话不复活重杀。
_ACTIVE_SESSION_STATUSES = ("pending", "active", "reconnecting")


# ── 2026-08-26 审计 F09（docs/qa/subsession-backend-audit-2026-08-26.md §A.1）──
# is_worker_complete 的批量化形态：循环消费点（派发门计数 / busy / worker_done
# 全完成判定 / summary 行化）先**一次**批量查明活跃 turn 集合，再经纯函数逐
# worker 判定——把「每 done 分身 1 查询」的 N+1 压成恒定 1 查询。
# 判据与 mission.is_worker_complete 逐分支等价（词表直接 import 单源，不复制）；
# mission.py 归审计 A 组并行修复，本模块只读借用（禁改 mission.py）。

# 批量活跃 turn 判定：只读借用 mission._sessions_with_active_turns（口径单一
# 真相源在 mission.py，勿在本模块复制实现防漂移）。
sessions_with_active_turns = _sessions_with_active_turns


def is_worker_complete_from_active(
    worker: AgentSession | AgentRun,
    active_session_ids: frozenset[uuid.UUID] | set[uuid.UUID],
) -> bool:
    """``mission.is_worker_complete`` 的纯函数形态（活跃 turn 集合外注入）。

    双形态判据逐分支等价（task-08 单一真相源的批量展开）：

    - 子会话（``AgentSession``）：会话终态（failed/ended）→ True；
      ``worker_done_at`` 空 → False；否则「无活跃 turn」→ True；
    - 存量 batch run（``AgentRun``）：run 终态 completed/failed/killed。

    ``active_session_ids`` 须由调用方经 :data:`sessions_with_active_turns`
    一次性查明（覆盖所判定的全部子会话 id）；集合不含某会话 id 即视为该会话
    无活跃 turn。等价性由 test_worker_subsession_control 守护测试锁定。
    """
    if isinstance(worker, AgentSession):
        if worker.status in _WORKER_SESSION_TERMINAL:
            return True
        if worker.worker_done_at is None:
            return False
        return worker.id not in active_session_ids
    return worker.status in _WORKER_RUN_TERMINAL


async def _incomplete_session_count(db: AsyncSession, sessions: Iterable[AgentSession]) -> int:
    """批量统计未完成（``is_worker_complete=False``）子会话数（F09）。

    一次批量活跃 turn 查询 + 纯函数判定；空集零查询。
    """
    session_list = list(sessions)
    if not session_list:
        return 0
    active_ids = await sessions_with_active_turns(db, [s.id for s in session_list])
    return sum(1 for s in session_list if not is_worker_complete_from_active(s, active_ids))


class MissionControlService:
    """Enforces budget / concurrency / cancellation gates for a Mission."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def worker_runs(self, mission_id: uuid.UUID) -> list[AgentRun]:
        """Mission 下**全量** run（含主控轮）。

        消费方：orchestrator.py schedule_loop 主控锚点（``role == 'orchestrator'``
        的 main_run 查找）与 finalizer.py converge 的 derive_status 输入——两者
        依赖全量，故本方法不收窄。治理口径（并发额度/成本/kill 对象）一律走
        ``non_orchestrator_runs``（task-07 / D-009，审查 B3）。
        """
        stmt = select(AgentRun).where(col(AgentRun.mission_id) == mission_id)
        return list((await self._session.execute(stmt)).scalars().all())

    async def non_orchestrator_runs(self, mission_id: uuid.UUID) -> list[AgentRun]:
        """Mission 下仅**分身** run（role 非 orchestrator，含 NULL role）。

        2026-08-22-team-session-unify task-07（design §5 核心机制 D-009 / 审查 B3）：
        主控轮回填 mission_id 后不占 MAX_WORKERS 并发额度、不计入分身成本、不进
        cancel kill 名单——治理门/成本/workers 列表的统一口径。

        NULL role 守卫：AgentRun.role 可空（存量分身 run），SQL 三值逻辑下
        ``role != 'orchestrator'`` 会漏掉 NULL 行，须显式 ``role IS NULL OR ...``
        （D-007@v2 / R-08 存量规则统一）。
        """
        stmt = select(AgentRun).where(
            col(AgentRun.mission_id) == mission_id,
            or_(
                col(AgentRun.role).is_(None),
                col(AgentRun.role) != _ORCHESTRATOR_ROLE,
            ),
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def _split_worker_forms(
        self,
        mission_id: uuid.UUID,
        *,
        root_session_id: uuid.UUID | None = None,
    ) -> tuple[list[AgentRun], list[AgentSession]]:
        """混跑双形态拆分（task-11）：存量 batch 分身 run + 分身子会话行。

        存量口径 = ``non_orchestrator_runs`` 剔除 ``agent_session_id ∈ 分身子会话``
        的 run（即子会话首 run——design §5.A 双标记锚）——分身状态一律以子会话
        行（``is_worker_complete``）/ 子会话轮次 run 为准，避免同一分身在 run 与
        会话两维度双计（对齐 ``mission_derive_status`` 剔除口径）。
        无子会话 mission（session_id NULL / 无子行）返回空会话列表，全量回落
        存量口径（FR-09 零回归）。

        2026-08-26-team-subsession-recursion task-08（design §5.E / FR-07）：
        枚举单点换 ``mission_worker_sessions_tree`` **全树**（一层→含孙层）——
        下方三口径（并发计数 / cost union / cancel kill 名单）全部经本方法取
        会话集合，孙层分身自动计入治理；无孙树与一层枚举等价（FR-08 零回归）。

        2026-08-26 审计 F03/F07：``root_session_id`` 可选参透传树枚举——调用方
        已持有 mission 行时传入可省掉树内部的一次 mission get（治理门两闸共用
        一次枚举时同步省一次）；缺省行为不变。
        """
        runs = await self.non_orchestrator_runs(mission_id)
        sessions = await mission_worker_sessions_tree(
            self._session, mission_id, root_session_id=root_session_id
        )
        session_ids = {s.id for s in sessions}
        legacy_runs = [r for r in runs if r.agent_session_id not in session_ids]
        return legacy_runs, sessions

    @staticmethod
    def cost_from_runs(runs: list[AgentRun]) -> float:
        """第六批：从内存 runs 直接求 cost（与 cost_so_far 同公式），供调用方复用
        已 fetch 的 runs 避免「worker_runs 后又 cost_so_far 再 SELECT 一遍」的冗余。

        注意（task-07）：求和口径 = 传入的 runs 本身——治理预算口径请传
        ``non_orchestrator_runs`` 结果；orchestrator.py 信号 3 预算强收等需要全量
        成本的调用方传 ``worker_runs`` 结果，两者由调用方按语义选择。
        """
        return sum(r.total_cost_usd or 0.0 for r in runs)

    async def _sum_session_runs_cost(self, session_ids: list[uuid.UUID]) -> float:
        """子会话轮次 run 的 ``total_cost_usd`` SQL SUM（F07：不 ORM 全行加载）。

        union 侧集合大小 = 分身数×历史轮数、随 mission 生命期单调增长，逐行
        实体化只为求和是纯浪费；``agent_session_id`` 有
        ``ix_agent_runs_agent_session_id`` 索引支撑，SUM 下推到库端。空集零查询
        返回 0.0。
        """
        if not session_ids:
            return 0.0
        stmt = select(func.sum(col(AgentRun.total_cost_usd))).where(
            col(AgentRun.agent_session_id).in_(session_ids)
        )
        total = (await self._session.execute(stmt)).scalar_one_or_none()
        return float(total or 0.0)

    async def cost_so_far(self, mission_id: uuid.UUID) -> float:
        """Sum of ``total_cost_usd`` across the Mission's Worker Runs.

        task-07（D-009）：仅累计分身成本，主控轮不计入（审查 B3）。

        task-11（design §5.C.6）：输入扩为 union——存量分身 run ∪ 分身子会话
        轮次 run（``agent_session_id ∈ mission_worker_sessions_tree`` 全树，task-08
        起含孙层轮次 run），治理门预算拦截覆盖子会话追问轮（无 mission_id 的
        轮次 run）成本。子会话首 run 已从存量侧剔除（``_split_worker_forms``），
        union 天然去重不双计。

        2026-08-26 审计 F07：子会话轮次侧改 SQL SUM（``_sum_session_runs_cost``，
        不再 ORM 全行加载）；存量侧 runs 本就要加载（计数/取消口径复用），
        内存求和公式 ``cost_from_runs`` 不动。
        """
        legacy_runs, sessions = await self._split_worker_forms(mission_id)
        return self.cost_from_runs(legacy_runs) + await self._sum_session_runs_cost(
            [s.id for s in sessions]
        )

    async def _worker_form_count(
        self, mission_id: uuid.UUID, *, legacy_statuses: frozenset[str]
    ) -> int:
        """混跑形态统一计数（task-11，verify NOTES 去重抽取）。

        存量分身 run 按 ``legacy_statuses`` 过滤 + ``is_worker_complete=False``
        子会话合计；子会话首 run 已被 ``_split_worker_forms`` 从 run 侧剔除
        防双计。active（_ACTIVE）/running（{"running"}）两口径仅存量侧过滤集
        不同，子会话语义一致（未完成即计入）。

        2026-08-26 审计 F09：子会话完成判定批量化——一次批量活跃 turn 查询
        （``sessions_with_active_turns``）+ 纯函数
        （``is_worker_complete_from_active``），不再逐分身查询（N+1）。
        """
        legacy_runs, sessions = await self._split_worker_forms(mission_id)
        count = sum(1 for r in legacy_runs if r.status in legacy_statuses)
        count += await _incomplete_session_count(self._session, sessions)
        return count

    async def active_worker_count(self, mission_id: uuid.UUID) -> int:
        """活跃分身计数（pending+running，cancel 漏杀防护视角）。

        task-11 混跑口径：存量 pending/running 分身 run + 未完成子会话（经
        ``is_worker_complete``，pending 子会话——首 run pending 未 claim——天然
        计入）合计；子会话首 run 从 run 维度剔除防双计。
        """
        return await self._worker_form_count(mission_id, legacy_statuses=_ACTIVE)

    async def running_worker_count(self, mission_id: uuid.UUID) -> int:
        """Count Workers already claimed by a daemon (``running``) — concurrency basis.

        Distinct from ``active_worker_count`` (pending+running, used by cancel): the
        dispatch gate limits *concurrently running* daemon processes, not pending
        (not-yet-dispatched) Runs — otherwise a flat mission of N pending Workers
        trips ``max_workers`` before any dispatch happens (2026-06-28 D-008@v1).

        task-07（D-009 / 审查 B3）：仅统计分身——主控轮不占 MAX_WORKERS 并发额度。

        task-11 混跑口径（design §5.C.6 / FR-07）：存量 running 分身 run +
        ``is_worker_complete=False`` 且会话非终态的分身子会话数合计——子会话形态
        分身只要未显式完成（worker_done）即占并发额度（追问重开工中也占），
        子会话首 run 从 run 维度剔除防同分身双计。
        """
        return await self._worker_form_count(mission_id, legacy_statuses=frozenset({"running"}))

    async def can_dispatch_worker(self, mission: AgentMission) -> tuple[bool, str]:
        """Pre-dispatch gate. Returns ``(allowed, reason)``.

        ``reason`` is ``ok`` when allowed, otherwise one of:
        ``mission_cancelled | max_workers_reached | budget_exceeded``.

        Concurrency uses ``running_worker_count`` (claimed by daemon), NOT
        ``active_worker_count`` (pending+running) — see D-008@v1.

        2026-08-26 审计 F07：门内**一次** ``_split_worker_forms`` 枚举同时喂
        并发与预算两闸（旧实现 running_worker_count + cost_so_far 各自枚举——
        同一 mission 行被 get 3 次、树 CTE 跑 2 次）；计数走批量活跃 turn
        （F09），子会话轮次成本走 SQL SUM——不重复执行树 CTE、不逐分身查询。
        判定序（cancelled → max_workers → budget）与拒绝 reason 语义不变。
        """
        if mission.cancelled_at is not None:
            return False, "mission_cancelled"
        legacy_runs, sessions = await self._split_worker_forms(
            mission.id, root_session_id=mission.session_id
        )
        running = sum(1 for r in legacy_runs if r.status == "running")
        running += await _incomplete_session_count(self._session, sessions)
        if running >= MAX_WORKERS:
            return False, "max_workers_reached"
        if mission.budget_usd is not None:
            cost = self.cost_from_runs(legacy_runs) + await self._sum_session_runs_cost(
                [s.id for s in sessions]
            )
            if cost >= mission.budget_usd:
                return False, "budget_exceeded"
        return True, "ok"

    async def _cancel_target_run_for_session(self, session_id: uuid.UUID) -> uuid.UUID | None:
        """取子会话的 cancel_lease 入参 run（task-11 / design §5.D）。

        优先活跃轮 run（``ACTIVE_RUN_STATUSES`` 词表单源）——cancel_lease 沿
        ``run.agent_session_id → AgentSession.lease_id`` 回捞 interactive lease
        并 kill 该活跃轮；无活跃轮（已 done 待收敛 / 轮间隙）取首 run（最早
        run）——目标仍是收口子会话（lease cancelled + SESSION_END + 会话
        ended），首 run 已终态时 ``_mark_agent_run_killed_if_pending`` 幂等跳过。
        会话无任何 run 行（脏数据）返回 None，调用方跳过并告警。
        """
        active_stmt = (
            select(AgentRun.id)
            .where(
                AgentRun.agent_session_id == session_id,
                AgentRun.status.in_(list(ACTIVE_RUN_STATUSES)),
            )
            .order_by(AgentRun.created_at)
            .limit(1)
        )
        run_id = (await self._session.execute(active_stmt)).scalars().first()
        if run_id is not None:
            return run_id
        first_stmt = (
            select(AgentRun.id)
            .where(AgentRun.agent_session_id == session_id)
            .order_by(AgentRun.created_at)
            .limit(1)
        )
        return (await self._session.execute(first_stmt)).scalars().first()

    async def cancel(self, mission: AgentMission) -> int:
        """Cancel a Mission: mark ``cancelled_at`` + kill active child Runs.

        委托 ``DaemonLeaseService.cancel_lease`` 收尾每个 active Worker，确保 daemon
        真收到取消信号（batch 走心跳 SIGTERM、interactive 走 WS SESSION_INTERRUPT）。
        ql-20260712-001（审计 P0-2）：旧实现只 flip ``AgentRun.status`` 不通知 daemon，
        worker 继续跑成僵尸 lease。``cancel_lease`` 内部已含"标记 killed + lease
        cancelled + 发信号"，对无 active lease 的 run 也走 ``_mark_agent_run_killed_if_pending``
        兜底标记，故覆盖旧手动 status flip 的全部场景。

        Returns the number of Runs killed.

        task-07（D-009 / design §7.5）：kill 对象仅为分身（``non_orchestrator_runs``，
        含 NULL role）——主控轮非分身，不进 kill 名单；存量 external mission 规则
        同步统一（R-08）。

        task-11（design §5.D）：kill 名单扩活跃分身子会话——统一走 ``cancel_lease``
        （含 SESSION_END 的 P0-2 链，不重造 kill 逻辑）：子会话按其活跃轮 run
        （无活跃轮取首 run，``_cancel_target_run_for_session``）入参，命中
        ``_lookup_interactive_lease_by_run`` 回捞链 → lease cancelled +
        SESSION_END 下发 + 子会话 ended，daemon 无僵尸。已终态子会话不复活重杀；
        无子会话 mission 名单回落存量 batch run（FR-09 零回归）。
        """
        # lazy import：agent.control → daemon.lease_service，避免顶层循环 import
        from app.modules.daemon.lease_service import DaemonLeaseService

        mission.cancelled_at = datetime.now(UTC)
        self._session.add(mission)
        await self._session.commit()

        lease_svc = DaemonLeaseService(self._session)
        killed = 0
        legacy_runs, sessions = await self._split_worker_forms(mission.id)
        for r in legacy_runs:
            if r.status not in _ACTIVE:
                continue
            try:
                await lease_svc.cancel_lease(r.id)
                killed += 1
            except Exception as exc:
                log.warning(
                    "mission_cancel_worker_failed",
                    mission_id=str(mission.id),
                    run_id=str(r.id),
                    error=str(exc),
                )
        for s in sessions:
            if s.status not in _ACTIVE_SESSION_STATUSES:
                continue
            target_run_id = await self._cancel_target_run_for_session(s.id)
            if target_run_id is None:
                log.warning(
                    "mission_cancel_worker_session_no_run",
                    mission_id=str(mission.id),
                    session_id=str(s.id),
                )
                continue
            try:
                await lease_svc.cancel_lease(target_run_id)
                killed += 1
            except Exception as exc:
                log.warning(
                    "mission_cancel_worker_failed",
                    mission_id=str(mission.id),
                    session_id=str(s.id),
                    run_id=str(target_run_id),
                    error=str(exc),
                )
        log.info("mission_cancelled", mission_id=str(mission.id), killed=killed)
        return killed
