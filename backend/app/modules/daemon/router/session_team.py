"""session 团队任务端点与组装 helper（task-07 拆分，原 session_extras team 域）。

POST ``/sessions/{id}/team-mission`` 预建 mission + GET ``/team-missions``
列表（2026-08-22-team-session-unify task-03，design §5 Phase 1 / §7）。
``_session_has_active_turn`` / ``_team_mission_summary`` /
``validate_team_mission_block`` 随域同迁，经包 ``__init__`` 重导出（测试与
session.service:1524 lazy import 消费面零改动）。
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.modules.auth.model import User
from app.modules.daemon.router import SessionDep, TaskRunAgentUser, router
from app.modules.daemon.schema import (
    TeamMissionCreateBlock,
    TeamMissionSummary,
    TeamMissionTriggerRequest,
    TeamMissionWorkerSummary,
    TeamWorkspaceRef,
)
from app.modules.daemon.service import DaemonService

if TYPE_CHECKING:
    # 仅类型注解用（team-mission 汇总 helper 形参）；运行时在各端点内延迟 import。
    from app.modules.agent.model import AgentMission

log = get_logger("app.modules.daemon.router")


# ── Session team mission trigger/list（2026-08-22-team-session-unify task-03）──
# 会话内团队能力数据源（design §5 Phase 1 / §7）：POST 预建 mission（scope 冻结
# 快照 + objective 空落占位 + 活跃冲突 409 R-07），GET 供前端 TeamTaskBlock 轮询。
# 归属校验同 get_session_detail 口径（missing/跨用户 → 404 资源隐藏）。


async def _session_has_active_turn(session: AsyncSession, session_id: uuid.UUID) -> bool:
    """会话当前是否有活跃 turn（ACTIVE_RUN_STATUSES 词表单源）。

    扩展后 derive_status 的 ``session_active_turn`` 入参（task-02 契约）：主控轮
    还在跑 → 会话 mission 不进 awaiting_input 档。状态集合与 get_session_detail
    的 current_run 查询同口径。task-09 起 ``_team_mission_summary`` 改经
    ``mission_derive_status``（内部同词表查明）后本 helper 无生产调用方，保留
    作口径文档锚点与守护测试入口（test_session_optimize_round2 三处同源断言）。

    P2（2026-08-25 二审 #3）：改用 ``agent.model.ACTIVE_RUN_STATUSES`` 单源词表
    （pending/running/pending_approval）——修复审批中的主控轮（pending_approval）
    被漏判致 mission 误入 awaiting_input 档；interrupting 为前端展示态、backend
    不落库，已从词表剔除。
    """
    from app.modules.agent.model import ACTIVE_RUN_STATUSES, AgentRun

    stmt = (
        select(AgentRun.id)
        .where(
            AgentRun.agent_session_id == session_id,
            AgentRun.status.in_(list(ACTIVE_RUN_STATUSES)),
        )
        .limit(1)
    )
    return (await session.execute(stmt)).first() is not None


async def _team_mission_summary(
    session: AsyncSession,
    mission: AgentMission,
) -> TeamMissionSummary:
    """AgentMission + 全量 run → TeamMissionSummary（触发/列表共用组装）。

    - status 用 task-08 包装 ``mission_derive_status`` 的**同口径本地展开**
      （design §5.C.4，task-09 换源；2026-08-26 审计 F03 批量化）：分身子会话
      映射虚拟 run（idle 未 done → running，不被首 run 终态遮蔽），会话维度
      入参（converged/has_session/session_active_turn）在本函数内一次查明——
      分身 idle 未 done 不再误显 awaiting_input（防 patrol 超时收敛时钟误启动）；
    - workers 双形态行化（task-13 / design §5.C.5 / §5.E）：分身列表 =
      子会话行（新形态，``parent_session_id = 根`` 的**一层**行——自全树结果
      过滤，与 ``mission_worker_sessions`` 单一真相源同口径；``sub_session_id``
      取子会话 id、``run_id``/``first_run_id`` 取首 run id（首 run 双标记锚，
      供 get_worker_result 连续消费）、role/objective 取首 run双标记、status
      按 ``is_worker_complete`` 完成判定映射为 ``mission_derive_status`` 虚拟
      run 同款三值）∪ 存量 batch 分身 run 行（无子会话 mission 回落，行内容
      逐字节不变、两新字段 None）；追问轮次 run 不写 mission_id 天然不进
      （轮次 run 不混入），主控轮 ``role != orchestrator`` 过滤语义保留
      （D-009：Python 比较 None != 'orchestrator' 为 True，NULL role 分身天然
      保留）；子会话首 run 从存量侧剔除防同分身双计（对齐
      ``mission_derive_status`` 虚拟映射同款剔除口径）；同根上一场已收敛
      mission 的子会话（无本场首 run）不是本场分身，不进行；
    - task-08（2026-08-26-team-subsession-recursion / design §5.E）：workers
      行化保持一层（展示细节留 P3，status 已由全树 derive 正确含孙），另经
      全树枚举的 parent 关系聚合一层分身的孙后代数填 ``sub_workers_count``
      （孙层折叠计数——无孙分身 / 存量 batch 行保持默认 None，FR-08 零回归）；
    - scope 概要读落库冻结快照，NULL 缺省回落 [anchor]（单 ws 语义）。

    **2026-08-26 审计 F03 批量化**（docs/qa/subsession-backend-audit-2026-08-26.md
    §A.3）：旧实现每 mission ≈14+Nd 查询（mission 行被重复 get 4 次、derive/
    一层/树三口径各自枚举、done 分身逐个查询）。本函数现为：

    | 步骤 | 查询数 |
    |---|---|
    | 全量 run（worker_runs，derive 输入 + 存量行化复用） | 1 |
    | 全树枚举一次（``root_session_id`` 透传跳过内部 mission get） | 1 |
    | 批量活跃 turn（树会话 ∪ 根，一次查询） | 1 |
    | 根会话存在性 get（identity map 命中则免） | ≤1 |
    | 首 run IN 批查 | 1 |
    | scope 名称 IN 批查 | 1 |

    合计 ~6 查询/mission（``GET /sessions/{sid}/team-missions`` 列表 M 倍放大
    同步受益）。status 口径与 ``mission.mission_derive_status`` 逐分支等价
    （虚拟映射优先级复刻 + ``derive_status`` 纯函数单源 import）——等价性由
    test_session_team_mission 守护测试锁定；mission.py 归审计 A 组并行修复，
    本地展开漂移由守护测试兜住。

    mission 模块延迟 import（与 orchestrator.schedule_loop 同款，避免循环
    import；task-02 并行时序下也保证本模块可 import）。
    """
    from app.modules.agent.control import (
        MissionControlService,
        is_worker_complete_from_active,
        sessions_with_active_turns,
    )
    from app.modules.agent.mission import (
        BUDGET_FORCE_ENDED_AT_KEY,
        WORKER_FORCE_ENDED_AT_KEY,
        derive_status,
    )
    from app.modules.agent.model import AgentRun, AgentSession, mission_worker_sessions_tree

    root_id = mission.session_id

    # 1) 全量 run：derive 输入与存量 workers 行化共用一次查询。
    all_runs = await MissionControlService(session).worker_runs(mission.id)

    # 2) 全树一次（root 透传省掉内部 mission get）：喂 derive 虚拟映射、一层
    #    workers 行化（parent==根 过滤——一层集合 ⊆ 全树，等价
    #    mission_worker_sessions）与孙折叠计数三口径。
    tree_sessions: list[AgentSession] = []
    if root_id is not None:
        tree_sessions = await mission_worker_sessions_tree(
            session, mission.id, root_session_id=root_id
        )
    tree_session_ids = {s.id for s in tree_sessions}
    tree_children: dict[uuid.UUID, list[uuid.UUID]] = {}
    for tree_session in tree_sessions:
        if tree_session.parent_session_id is not None:
            tree_children.setdefault(tree_session.parent_session_id, []).append(tree_session.id)
    worker_sessions = [
        s for s in tree_sessions if root_id is not None and s.parent_session_id == root_id
    ]

    # 3) status 本地展开（= mission_derive_status 同口径）：批量活跃 turn 一次
    #    查询覆盖「树会话 done 判定 + 根会话活跃 turn」两用途。
    active_ids: set[uuid.UUID] = set()
    if root_id is not None:
        probe_ids = list(tree_session_ids | {root_id})
        active_ids = await sessions_with_active_turns(session, probe_ids)
    budget_force_ended = (
        mission.constraints is not None and BUDGET_FORCE_ENDED_AT_KEY in mission.constraints
    )
    worker_force_ended = (
        mission.constraints is not None and WORKER_FORCE_ENDED_AT_KEY in mission.constraints
    )

    # ql-20260828-013-a55b：每树会话首 run 终态兜底查表（all_runs 含树内 run，
    # 仅从 derive 输入剔除；按 created_at 排序 setdefault 取最早——run killed/
    # failed 后会话侧未收敛的形态虚拟 run 不再 running）。
    first_run_status_by_session: dict[uuid.UUID, str] = {}
    for r in sorted(all_runs, key=lambda x: x.created_at.isoformat() if x.created_at else ""):
        if r.agent_session_id is not None and r.role is not None:
            first_run_status_by_session.setdefault(r.agent_session_id, r.status)

    def _virtual_status(s: AgentSession) -> str:
        # 优先级复刻 mission.mission_derive_status._virtual_status（§5.C.4）：
        # done 且无活跃 turn → completed > 强收标记（budget 或 worker 任一，
        # 审计 F01 两键同象）下会话 ended 且未 done → failed（终态，可收敛
        # degraded）> 会话终态 failed → failed > 首 run 终态 failed/killed →
        # failed（ql-20260828-013-a55b 收敛兜底，同 mission.py 单源）> 其余
        # （idle 未 done / 追问重开工中 / 无标记 ended 未 done）→ running。
        if s.worker_done_at is not None and s.id not in active_ids:
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
        AgentRun(agent_type="claude_code", status=_virtual_status(s)) for s in tree_sessions
    ]
    derive_runs = [r for r in all_runs if r.agent_session_id not in tree_session_ids]
    has_session = False
    session_active_turn = False
    if root_id is not None:
        # 会话 mission 判别同 mission_derive_status 口径：session_id 列对存量
        # 构造路径可能是随机 uuid，按「该 id 的 AgentSession 真实存在」判别，
        # 查无行 → has_session=False（永不进 awaiting_input，存量零回归）。
        bound_session = await session.get(AgentSession, root_id)
        if bound_session is not None:
            has_session = True
            session_active_turn = root_id in active_ids
    status = derive_status(
        [*derive_runs, *virtual_runs],
        cancelled=mission.cancelled_at is not None,
        converged=mission.converged_at is not None,
        has_session=has_session,
        session_active_turn=session_active_turn,
    )

    def _sub_workers_count(start_id: uuid.UUID) -> int:
        count = 0
        visited = {start_id}
        queue = [start_id]
        while queue:
            for child_id in tree_children.get(queue.pop(), []):
                if child_id not in visited:
                    visited.add(child_id)
                    queue.append(child_id)
                    count += 1
        return count

    # 4) 一层分身行化：首 run 双标记锚（design §5.A：派发三元组写 mission_id
    #    + role 的最早 run；追问轮 run 无 mission_id 天然不命中）。
    sub_session_ids = {s.id for s in worker_sessions}
    first_run_by_session: dict[uuid.UUID, AgentRun] = {}
    if sub_session_ids:
        first_run_rows = (
            (
                await session.execute(
                    select(AgentRun)
                    .where(
                        AgentRun.mission_id == mission.id,
                        AgentRun.role.is_not(None),
                        AgentRun.agent_session_id.in_(sub_session_ids),
                    )
                    .order_by(AgentRun.created_at)
                )
            )
            .scalars()
            .all()
        )
        for run in first_run_rows:
            if run.agent_session_id is not None:
                first_run_by_session.setdefault(run.agent_session_id, run)
    worker_rows: list[TeamMissionWorkerSummary] = []
    for worker_session in worker_sessions:
        first_run = first_run_by_session.get(worker_session.id)
        if first_run is None:
            continue
        # status 三值映射对齐 mission_derive_status 虚拟 run 优先级（§5.C.4）：
        # worker_done 且无活跃 turn（is_worker_complete=True）→ completed
        # （优先于终态映射——converge end_session 后 done 分身仍映射 done）>
        # 会话终态 failed → failed > 首 run 终态 failed/killed → failed
        # （ql-20260828-013-a55b 收敛兜底：run 已死任务卡不再显示运行中）>
        # 其余（idle 未 done / 追问重开工中）→ running；完成判定经
        # is_worker_complete_from_active（§5.C.3 单一真相源的批量形态，
        # active_ids 一次查明，F09）。
        if worker_session.worker_done_at is not None and is_worker_complete_from_active(
            worker_session, active_ids
        ):
            row_status = "completed"
        elif worker_session.status == "failed" or (
            first_run is not None and first_run.status in ("failed", "killed")
        ):
            row_status = "failed"
        else:
            row_status = "running"
        sub_count = _sub_workers_count(worker_session.id)
        worker_rows.append(
            TeamMissionWorkerSummary(
                run_id=first_run.id,
                role=first_run.role,
                status=row_status,
                objective=first_run.objective,
                workspace_id=str(first_run.target_workspace_id or mission.workspace_id),
                sub_session_id=worker_session.id,
                first_run_id=first_run.id,
                # 折叠计数：有后代才填（无孙 → None，与存量行同形）。
                sub_workers_count=sub_count if sub_count > 0 else None,
            )
        )
    # UX 走查 ③（2026-08-26）：运行中分身最新动作预览——批量一次查询
    # agent_run_logs（经 agent_runs.agent_session_id join，ix_agent_runs_
    # agent_session_id 索引支撑），每会话取最新一条日志行截断 80 字符。
    # 仅 running 行消费；completed/failed/存量行保持 None。
    running_sub_ids = [
        r.sub_session_id
        for r in worker_rows
        if r.status == "running" and r.sub_session_id is not None
    ]
    latest_by_session: dict[uuid.UUID, str] = {}
    if running_sub_ids:
        from app.modules.agent.model import AgentRunLog

        # 直接 select AgentRun.agent_session_id（日志行可属会话任意 run——含
        # 追问轮 run，经首 run id 映射会漏，禁用该形态）。
        log_rows = (
            await session.execute(
                select(AgentRun.agent_session_id, AgentRunLog.content_redacted)
                .join(AgentRunLog, AgentRunLog.run_id == AgentRun.id)
                .where(AgentRun.agent_session_id.in_(running_sub_ids))
                .order_by(AgentRunLog.timestamp.desc())
                .limit(len(running_sub_ids) * 5)
            )
        ).all()
        for sub_id, content_redacted in log_rows:
            if sub_id is not None and sub_id not in latest_by_session and content_redacted:
                latest_by_session[sub_id] = content_redacted[:80]
        for row in worker_rows:
            if row.sub_session_id is not None:
                row.latest_action = latest_by_session.get(row.sub_session_id)

    # UX 优化（2026-08-27）：completed 分身的 result_summary——从 worker_done 上报
    # 的 summary artifact 取前 120 字符，团队任务块直接展示结论（不用点浮层）。
    completed_sub_ids = [
        r.sub_session_id
        for r in worker_rows
        if r.status == "completed" and r.sub_session_id is not None
    ]
    if completed_sub_ids:
        from app.modules.agent.model import AgentArtifact

        summary_rows = (
            await session.execute(
                select(AgentArtifact.run_id, AgentArtifact.content_ref)
                .join(AgentRun, AgentArtifact.run_id == AgentRun.id)
                .where(
                    AgentRun.agent_session_id.in_(completed_sub_ids),
                    AgentArtifact.kind == "summary",
                )
                .order_by(AgentArtifact.created_at.desc())
                .limit(len(completed_sub_ids) * 3)
            )
        ).all()
        summary_by_session: dict[uuid.UUID, str] = {}
        for run_id, content_ref in summary_rows:
            if content_ref is None:
                continue
            # run_id → sub_session_id 需经 first_run 映射（summary artifact 挂首 run）
            for ws in worker_sessions:
                fr = first_run_by_session.get(ws.id)
                if fr is not None and fr.id == run_id and ws.id not in summary_by_session:
                    summary_by_session[ws.id] = content_ref[:120]
                    break
        for row in worker_rows:
            if row.sub_session_id is not None:
                row.result_summary = summary_by_session.get(row.sub_session_id)

    # 存量回落：batch 分身 run 行（子会话首 run 已剔除防双计；**全树**会话 id
    # 集合剔除——task-08 孙层首 run（带 mission_id+role 双标记）同样不进
    # workers 行，孙层以 sub_workers_count 折叠呈现而非独立行，design §5.E
    # 「孙折叠计数」；存量 mission 无子会话 → 树集合空 → 行内容与改动前
    # 逐字节一致，FR-08/FR-09 零回归）。
    worker_rows.extend(
        TeamMissionWorkerSummary(
            run_id=r.id,
            role=r.role,
            status=r.status,
            objective=r.objective,
            workspace_id=str(r.target_workspace_id or mission.workspace_id),
        )
        for r in all_runs
        if r.role != "orchestrator" and r.agent_session_id not in tree_session_ids
    )
    # ql-20260825-003：scope 名称 enriched 视图（批量一次查询；查无行的条目
    # name=None，前端回落 id 徽标）。
    scope_ids = list(mission.scope_workspace_ids or [str(mission.workspace_id)])
    from sqlmodel import col as _col

    from app.modules.workspace.model import Workspace as _Ws

    _ws_rows = (
        await session.execute(
            select(_Ws.id, _Ws.name).where(_col(_Ws.id).in_([uuid.UUID(sid) for sid in scope_ids]))
        )
    ).all()
    _ws_names = {str(row[0]): row[1] for row in _ws_rows}
    return TeamMissionSummary(
        mission_id=mission.id,
        status=status,
        objective=mission.objective,
        scope_workspace_ids=scope_ids,
        scope_workspaces=[
            TeamWorkspaceRef(id=ws_id, name=_ws_names.get(ws_id)) for ws_id in scope_ids
        ],
        budget_usd=mission.budget_usd,
        # ql-20260828-012-4425：编辑回显三件套（行直取透传）。
        project_id=mission.project_id,
        worker_preset=mission.worker_preset,
        main_agent_config=mission.main_agent_config,
        workers=worker_rows,
    )


async def validate_team_mission_block(
    session: AsyncSession,
    user: User,
    block: TeamMissionTriggerRequest | TeamMissionCreateBlock,
    *,
    fallback_workspace_id: uuid.UUID | None,
) -> tuple[list[uuid.UUID], uuid.UUID]:
    """团队任务块 scope/项目维度共享校验（task-07 自 trigger 端点逐字抽出）。

    trigger 端点（TeamMissionTriggerRequest）与 create 路径
    （SessionCreateRequest.team_mission → TeamMissionCreateBlock，task-09）共用
    同一实现——两 DTO 六字段同名同形态（schema.py），结构复用无复制粘贴。

    - scope 解析：``block`` 未传 → ``fallback_workspace_id``（trigger=会话绑定
      工作区）；两者皆无 → 422（CC-10 同款语义）；传了则去重保序；
    - 项目维度（复用旧项目端点口径，agent/router.py:1239-1357）：非项目经理
      （非超管）→ 403；scope ⊄ 项目关联工作区 → 422；
    - anchor 派生：scope 内 type=backend-code 优先否则第一个（agent/router.py
      :1295-1309 口径）；单工作区 anchor 即该工作区（免查 Workspace type）。

    Returns:
        ``(scope_ids, anchor_id)``——去重保序后的 scope 与派生 anchor。
    """
    # scope 解析：未传取会话绑定工作区；两者皆无 → 422。
    if block.scope_workspace_ids:
        scope_ids = list(dict.fromkeys(block.scope_workspace_ids))  # 去重保序
    elif fallback_workspace_id is not None:
        scope_ids = [fallback_workspace_id]
    else:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="该会话未绑定工作区，请在触发团队任务时显式选择工作区范围（scope_workspace_ids）。",
        )

    anchor_id: uuid.UUID
    if block.project_id is not None:
        # 项目经理/超管校验（复用 ppm/common/data_scope 口径，非项目经理 403）。
        from app.modules.ppm.common.data_scope import is_super_admin, manager_project_ids

        if not (
            await is_super_admin(session, user)
            or block.project_id in await manager_project_ids(session, user)
        ):
            from app.core.errors import PermissionDenied

            raise PermissionDenied(
                "仅项目经理可创建项目维度的会话团队任务。",
                details={"project_id": str(block.project_id)},
            )

        # scope ⊆ 项目关联工作区（复用 workspace link_service.list_by_project，越界 422）。
        from app.modules.workspace import link_service

        bound_workspaces = await link_service.list_by_project(
            session, ppm_project_id=block.project_id
        )
        bound_ids = {w.workspace_id for w in bound_workspaces}
        invalid_ids = set(scope_ids) - bound_ids
        if invalid_ids:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"指定的工作区不在项目关联范围内：{', '.join(str(i) for i in invalid_ids)}",
            )

        # anchor 缺省：scope 内 type=backend-code 优先否则第一个（对齐
        # agent/router.py:1295-1309 旧项目端点口径，逐字同款 backend_ws 选择）。
        backend_ws = next(
            (
                w
                for w in bound_workspaces
                if w.type == "backend-code" and w.workspace_id in scope_ids
            ),
            None,
        )
        anchor_id = backend_ws.workspace_id if backend_ws else scope_ids[0]
    elif len(scope_ids) == 1:
        anchor_id = scope_ids[0]  # 单工作区：anchor 即该工作区（免查 Workspace type）
    else:
        # 非项目多工作区：scope 内 type=backend-code 优先否则第一个（同口径）。
        from app.modules.workspace.model import Workspace

        ws_rows = (
            (await session.execute(select(Workspace).where(Workspace.id.in_(scope_ids))))
            .scalars()
            .all()
        )
        type_by_id = {w.id: w.type for w in ws_rows}
        anchor_id = next(
            (sid for sid in scope_ids if type_by_id.get(sid) == "backend-code"),
            scope_ids[0],
        )

    return scope_ids, anchor_id


@router.post(
    "/sessions/{session_id}/team-mission",
    response_model=TeamMissionSummary,
    status_code=status.HTTP_201_CREATED,
)
async def trigger_session_team_mission(
    session_id: uuid.UUID,
    data: TeamMissionTriggerRequest,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> TeamMissionSummary:
    """预建会话团队 mission（design §5 Phase 1 / §7）。

    - 归属校验：跨用户/不存在 → 404（``svc.get_agent_session``，同
      get_session_detail 资源隐藏口径）；
    - 活跃冲突：会话已有活跃 mission（未收敛未取消）→ 409（R-07，经 task-02
      ``get_active_mission_for_session`` 判活跃，与 uq_agent_missions_session_active
      部分唯一索引同语义）；
    - scope 解析：未传 → 会话绑定工作区；会话无工作区且未传 → 422（CC-10 同款）；
    - 项目维度校验复用旧项目端点口径（agent/router.py:1239-1357，本卡迁移复用）：
      非项目经理（非超管）→ 403；scope ⊄ 项目关联工作区 → 422；anchor 缺省取
      scope 内 type=backend-code 优先否则第一个（DTO 不带 anchor，服务端派生）
      ——以上经 ``validate_team_mission_block`` 共享函数（task-07 抽出，create
      路径 task-09 复用同一实现）；
    - 落库走 ``OrchestratorService.team_mission_entry`` 的 ``"session"`` 预建模式
      （不建主控 run / 不派 lease / objective 空落 SESSION_OBJECTIVE_PLACEHOLDER）。
    """
    svc = DaemonService(session)
    agent_session = await svc.get_agent_session(session_id, user.id)

    # 活跃冲突（R-07 单活跃约束）。
    from app.modules.agent.mission import get_active_mission_for_session

    active_mission = await get_active_mission_for_session(session, session_id)
    if active_mission is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="该会话已有进行中的团队任务，请先收敛或取消后再发起新任务。",
        )

    # scope/项目维度/anchor 校验抽共享函数（task-07）：与 create 路径
    # （SessionCreateRequest.team_mission，task-09）单一实现，行为逐字不变。
    scope_ids, anchor_id = await validate_team_mission_block(
        session,
        user,
        data,
        fallback_workspace_id=agent_session.workspace_id,
    )

    from app.modules.agent.orchestrator import OrchestratorService

    mission, _main_run = await OrchestratorService(session).team_mission_entry(
        workspace_id=anchor_id,
        objective=data.objective or "",
        created_by=user.id,
        # change_id 继承会话上下文（会话即团队任务的发起锚点，D-001 会话内能力）。
        change_id=agent_session.change_id,
        constraints=None,
        budget_usd=data.budget_usd,
        worker_preset=data.worker_preset,
        main_agent_config=data.main_agent_config,
        orchestration_mode="session",
        scope_workspace_ids=scope_ids,
        project_id=data.project_id,
        session_id=session_id,
    )
    log.info(
        "session_team_mission_prebuilt",
        session_id=str(session_id),
        mission_id=str(mission.id),
        anchor_workspace_id=str(anchor_id),
        project_id=str(data.project_id) if data.project_id else None,
    )
    # task-09：status 源换 mission_derive_status（会话活跃 turn 由包装内部
    # 按同源词表判定），触发端点不再单独预查 _session_has_active_turn。
    return await _team_mission_summary(session, mission)


@router.get(
    "/sessions/{session_id}/team-missions",
    response_model=list[TeamMissionSummary],
)
async def list_session_team_missions(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> list[TeamMissionSummary]:
    """列出会话全部团队 mission（created_at 倒序）+ 分身概要（TeamTaskBlock 数据源）。

    归属校验同 POST（404 资源隐藏）；workers 双形态行（task-13：子会话行含
    sub_session_id/first_run_id ∪ 存量 batch 分身 run，主控轮 D-009 不进、
    轮次 run 不混入）；status 用 task-08 包装 ``mission_derive_status``（task-09
    换源——会话维度入参由包装内部查明，列表不再统一预查会话活跃 turn）。
    """
    svc = DaemonService(session)
    await svc.get_agent_session(session_id, user.id)

    from app.modules.agent.model import AgentMission

    missions = (
        (
            await session.execute(
                select(AgentMission)
                .where(AgentMission.session_id == session_id)
                .order_by(AgentMission.created_at.desc())
            )
        )
        .scalars()
        .all()
    )
    return [await _team_mission_summary(session, m) for m in missions]
