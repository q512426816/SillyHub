"""Team 主 agent MCP endpoint（2026-07-12-team-main-agent-orchestration D-007@v2）。

主 agent 通过 MCP tool 反向调 backend：派 worker / 读产出 / 列 worker / 收敛 / 报进度。
daemon 侧 MCP server（task-05）转发 tool_call 到这些 endpoint。

路径不与现有 mission endpoint 冲突：均挂在 ``/workspaces/{workspace_id}/missions/
{mission_id}/`` 下，动作子路径（dispatch_worker / workers / converge / progress）与
现有 ``/missions/{mission_id}/cancel``（router.py:811）平级但带 workspace 前缀。

权限：统一 ``WORKSPACE_WRITE``（与 create_mission 一致）。主 agent run 的 daemon
lease 携带 user token，daemon MCP server 转发时透传，backend 走同一权限校验。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission
from app.core.db import get_session
from app.core.logging import get_logger
from app.modules.agent.execution import MissionExecutionService
from app.modules.agent.model import AgentArtifact, AgentMission, AgentRun, AgentRunLog
from app.modules.agent.placement import NoOnlineDaemonError
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission

log = get_logger(__name__)

router = APIRouter(tags=["agent-mcp"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]

# worker run 的 role 默认（worker_preset 条目缺 role 时兜底）
_DEFAULT_WORKER_ROLE = "worker"


# ---------------------------------------------------------------------------
# Schemas
# ---------------------------------------------------------------------------


class DispatchWorkerRequest(BaseModel):
    """主 agent 派 worker 的请求体（D-002@v2）。

    字段对齐 worker_preset 单条结构（{agent_type, model, objective, role}），
    主 agent 可在 mission 启动时的 preset 之外动态补派（如发现新子任务）。
    """

    objective: str
    role: str | None = None
    agent_type: str | None = None
    model: str | None = None
    read_only: bool = False


class WorkerRunResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: str | None = None
    objective: str | None = None
    status: str
    agent_type: str
    lease_id: uuid.UUID | None = None
    error_code: str | None = None


class WorkerResultResponse(BaseModel):
    """单个 worker 的结构化产出（AgentArtifact kind=patch/summary/...）。"""

    worker_id: uuid.UUID
    status: str
    artifacts: list[dict] = []


class WorkerListItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    role: str | None = None
    status: str
    objective: str | None = None
    total_cost_usd: float | None = None


class WorkerListResponse(BaseModel):
    mission_id: uuid.UUID
    workers: list[WorkerListItem]


class ConvergeResponse(BaseModel):
    mission_id: uuid.UUID
    status: str
    converged: bool
    artifact_id: uuid.UUID | None = None


class ProgressRequest(BaseModel):
    """主 agent 决策日志（落 AgentRunLog channel=tool_call）。"""

    run_id: uuid.UUID
    message: str
    decision: str | None = None


class ProgressResponse(BaseModel):
    run_id: uuid.UUID
    log_id: uuid.UUID


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _get_mission(
    session: AsyncSession, workspace_id: uuid.UUID, mission_id: uuid.UUID
) -> AgentMission:
    """取 mission 并校验属于该 workspace。"""
    mission = await session.get(AgentMission, mission_id)
    if mission is None or mission.workspace_id != workspace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "mission not found")
    return mission


async def _get_main_run(session: AsyncSession, mission_id: uuid.UUID) -> AgentRun:
    """取 mission 的主 agent run（role=orchestrator）。"""
    stmt = (
        select(AgentRun)
        .where(AgentRun.mission_id == mission_id, AgentRun.role == "orchestrator")
        .order_by(AgentRun.created_at)
        .limit(1)
    )
    run = (await session.execute(stmt)).scalars().first()
    if run is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "orchestrator run not found")
    return run


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/workspaces/{workspace_id}/missions/{mission_id}/dispatch_worker",
    response_model=WorkerRunResponse,
    status_code=status.HTTP_201_CREATED,
)
async def dispatch_worker(
    workspace_id: uuid.UUID,
    mission_id: uuid.UUID,
    payload: DispatchWorkerRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> WorkerRunResponse:
    """主 agent 动态派一个 worker run（D-002@v2）。

    建 AgentRun(role 从 payload 或 preset 对应条目, status=pending) + 调
    ``MissionExecutionService.dispatch_worker`` 派 daemon lease。daemon 离线 /
    未绑定时 lease 失败但 run 仍建（pending + error_code=no_online_daemon），
    主 agent 可读 worker 状态决定重派。
    """
    mission = await _get_mission(session, workspace_id, mission_id)
    role = payload.role or _DEFAULT_WORKER_ROLE
    run = AgentRun(
        mission_id=mission.id,
        change_id=mission.change_id,
        agent_type=payload.agent_type or "claude_code",
        provider=None,
        model=payload.model,
        status="pending",
        role=role,
        objective=payload.objective,
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)

    # 治理门（与 create_mission 一致，control.can_dispatch_worker）
    # 主 agent 派 worker 时也走同一治理：取消 / 并发上限 / 预算。拒绝时标 killed。
    from app.modules.agent.control import MissionControlService

    ctrl = MissionControlService(session)
    allowed, reason = await ctrl.can_dispatch_worker(mission)
    if not allowed:
        run.status = "killed"
        run.finished_at = datetime.now(UTC)
        run.exit_code = -1
        run.error_code = reason
        session.add(run)
        await session.commit()
        await session.refresh(run)
        log.info(
            "mcp_dispatch_worker_rejected",
            mission_id=str(mission.id),
            run_id=str(run.id),
            reason=reason,
        )
        return WorkerRunResponse.model_validate(run)

    exec_svc = MissionExecutionService(session)
    try:
        await exec_svc.dispatch_worker(
            run,
            workspace_id=workspace_id,
            user_id=user.id,
            read_only=payload.read_only,
        )
    except NoOnlineDaemonError as exc:
        run.status = "pending"
        run.error_code = "no_online_daemon"
        run.output_redacted = exc.message
        session.add(run)
        await session.commit()
        await session.refresh(run)
        log.warning(
            "mcp_dispatch_worker_no_online_daemon",
            mission_id=str(mission.id),
            run_id=str(run.id),
            message=exc.message,
        )
    await session.commit()
    await session.refresh(run)
    return WorkerRunResponse.model_validate(run)


@router.get(
    "/workspaces/{workspace_id}/missions/{mission_id}/workers/{worker_id}/result",
    response_model=WorkerResultResponse,
)
async def get_worker_result(
    workspace_id: uuid.UUID,
    mission_id: uuid.UUID,
    worker_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> WorkerResultResponse:
    """读单个 worker 的结构化产出（AgentArtifact kind=patch/summary/...）。"""
    await _get_mission(session, workspace_id, mission_id)
    run = await session.get(AgentRun, worker_id)
    if run is None or run.mission_id != mission_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "worker run not found")
    stmt = (
        select(AgentArtifact)
        .where(AgentArtifact.run_id == worker_id)
        .order_by(AgentArtifact.created_at)
    )
    arts = list((await session.execute(stmt)).scalars().all())
    return WorkerResultResponse(
        worker_id=worker_id,
        status=run.status,
        artifacts=[{"kind": a.kind, "content_ref": a.content_ref, "id": str(a.id)} for a in arts],
    )


@router.get(
    "/workspaces/{workspace_id}/missions/{mission_id}/workers",
    response_model=WorkerListResponse,
)
async def list_workers(
    workspace_id: uuid.UUID,
    mission_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> WorkerListResponse:
    """列 mission 下所有 worker runs 状态（含主 agent run）。"""
    await _get_mission(session, workspace_id, mission_id)
    stmt = select(AgentRun).where(AgentRun.mission_id == mission_id).order_by(AgentRun.created_at)
    runs = list((await session.execute(stmt)).scalars().all())
    return WorkerListResponse(
        mission_id=mission_id,
        workers=[WorkerListItem.model_validate(r) for r in runs],
    )


@router.post(
    "/workspaces/{workspace_id}/missions/{mission_id}/converge",
    response_model=ConvergeResponse,
)
async def converge_mission(
    workspace_id: uuid.UUID,
    mission_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> ConvergeResponse:
    """主 agent 触发 mission 收敛（复用 FinalizerService + converge 链路）。

    调 ``converge_mission_for_completed_run``（finalizer.py:189）以主 agent run 为
    锚点触发：回灌 artifacts → derive_status → 全终态时 Finalizer 合并。
    GLM 未配置时走 concat 回退（Finalizer 永远收敛）。
    """
    mission = await _get_mission(session, workspace_id, mission_id)
    main_run = await _get_main_run(session, mission.id)

    from app.modules.agent.delegation import GLMConfig
    from app.modules.agent.finalizer import converge_mission_for_completed_run

    cfg = GLMConfig.from_env()
    result_status = await converge_mission_for_completed_run(session, main_run.id, cfg)
    converged = result_status in ("done", "degraded")

    # converge_mission_for_completed_run 内部已 commit（FinalizerService.commit），
    # 但 status None（run 不属 mission，理论上不会，主 agent run 有 mission_id）时
    # 无 commit；补一次 flush 保证后续读取一致。
    await session.flush()
    artifact_id: uuid.UUID | None = None
    if converged:
        stmt = (
            select(AgentArtifact)
            .join(AgentRun, AgentArtifact.run_id == AgentRun.id)
            .where(AgentRun.mission_id == mission.id)
            .order_by(AgentArtifact.created_at.desc())
            .limit(1)
        )
        art = (await session.execute(stmt)).scalars().first()
        artifact_id = art.id if art else None
    return ConvergeResponse(
        mission_id=mission.id,
        status=result_status or "running",
        converged=converged,
        artifact_id=artifact_id,
    )


@router.post(
    "/workspaces/{workspace_id}/missions/{mission_id}/progress",
    response_model=ProgressResponse,
    status_code=status.HTTP_201_CREATED,
)
async def report_progress(
    workspace_id: uuid.UUID,
    mission_id: uuid.UUID,
    payload: ProgressRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> ProgressResponse:
    """落主 agent 决策日志（AgentRunLog channel=tool_call, tool_kind=other）。

    主 agent 每次决策（派 worker / 判断达成 / 收敛）都调此 endpoint 落一条日志，
    供前端展示决策链路 + 审计。``decision`` 字段拼到 content 前缀便于筛选。
    """
    await _get_mission(session, workspace_id, mission_id)
    run = await session.get(AgentRun, payload.run_id)
    if run is None or run.mission_id != mission_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "run not found in mission")
    content = payload.message
    if payload.decision:
        content = f"[{payload.decision}] {payload.message}"
    log_entry = AgentRunLog(
        run_id=run.id,
        timestamp=datetime.now(UTC),
        channel="tool_call",
        content_redacted=content,
        tool_kind="other",
    )
    session.add(log_entry)
    await session.commit()
    await session.refresh(log_entry)
    return ProgressResponse(run_id=run.id, log_id=log_entry.id)
