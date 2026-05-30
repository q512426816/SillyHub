"""HTTP routes for agent execution."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission
from app.core.db import get_session
from app.core.errors import AgentRunNotFound, AgentRunNotRunning
from app.modules.agent.schema import (
    AgentRunCreate,
    AgentRunLogEntry,
    AgentKillResponse,
    AgentRunResponse,
)
from app.modules.agent.service import AgentService
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission

router = APIRouter(tags=["agent"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.post(
    "/workspaces/{workspace_id}/agent/runs",
    response_model=AgentRunResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_agent_run(
    workspace_id: uuid.UUID,
    data: AgentRunCreate,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.TASK_RUN_AGENT))],
) -> AgentRunResponse:
    svc = AgentService(session)
    run = await svc.start_run(
        workspace_id,
        user.id,
        task_id=data.task_id,
        lease_id=data.lease_id,
        agent_type=data.agent_type,
    )
    return await svc.enrich_with_workspace_ids(run)


@router.get(
    "/workspaces/{workspace_id}/agent/runs/{run_id}",
    response_model=AgentRunResponse,
)
async def get_agent_run(
    workspace_id: uuid.UUID,
    run_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
) -> AgentRunResponse:
    svc = AgentService(session)
    run = await svc.get_run(run_id)
    if run is None:
        raise AgentRunNotFound(
            f"Agent run '{run_id}' not found.",
            details={"run_id": str(run_id)},
        )
    return await svc.enrich_with_workspace_ids(run)


@router.post(
    "/workspaces/{workspace_id}/agent/runs/{run_id}/kill",
    response_model=AgentKillResponse,
)
async def kill_agent_run(
    workspace_id: uuid.UUID,
    run_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.TASK_RUN_AGENT))],
) -> AgentKillResponse:
    """Terminate a running agent execution."""
    svc = AgentService(session)
    run = await svc.get_run(run_id)
    if run is None:
        raise AgentRunNotFound(
            f"Agent run '{run_id}' not found.",
            details={"run_id": str(run_id)},
        )
    if run.status not in ("pending", "running"):
        raise AgentRunNotRunning(
            f"Agent run '{run_id}' is not running (current status: {run.status}).",
            details={"run_id": str(run_id), "status": run.status},
        )
    await svc.kill_run(run_id)
    await session.refresh(run)
    return AgentKillResponse(id=run.id, status=run.status)


@router.get(
    "/workspaces/{workspace_id}/agent/runs/{run_id}/logs",
    response_model=list[AgentRunLogEntry],
)
async def get_agent_run_logs(
    workspace_id: uuid.UUID,
    run_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
) -> list[AgentRunLogEntry]:
    svc = AgentService(session)
    run = await svc.get_run(run_id)
    if run is None:
        raise AgentRunNotFound(
            f"Agent run '{run_id}' not found.",
            details={"run_id": str(run_id)},
        )
    logs = await svc.get_run_logs(run_id)
    return [AgentRunLogEntry.model_validate(e) for e in logs]


@router.get(
    "/workspaces/{workspace_id}/agent/runs/{run_id}/stream",
)
async def stream_agent_run_logs(
    workspace_id: uuid.UUID,
    run_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
) -> StreamingResponse:
    """SSE endpoint — stream real-time logs for a running agent run."""
    svc = AgentService(session)
    run = await svc.get_run(run_id)
    if run is None:
        raise AgentRunNotFound(
            f"Agent run '{run_id}' not found.",
            details={"run_id": str(run_id)},
        )
    if run.status not in ("pending", "running"):
        return StreamingResponse(
            iter(["event: done\ndata: {}\n\n"]),
            media_type="text/event-stream",
        )
    return StreamingResponse(
        svc.stream_run_logs(run_id),
        media_type="text/event-stream",
    )


@router.get(
    "/workspaces/{workspace_id}/agent/runs",
    response_model=list[AgentRunResponse],
)
async def list_workspace_agent_runs(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
) -> list[AgentRunResponse]:
    svc = AgentService(session)
    runs = await svc.list_runs(workspace_id, task_id=None)
    return await svc.enrich_list(runs)


@router.get(
    "/workspaces/{workspace_id}/tasks/{task_id}/agent/runs",
    response_model=list[AgentRunResponse],
)
async def list_task_agent_runs(
    workspace_id: uuid.UUID,
    task_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
) -> list[AgentRunResponse]:
    svc = AgentService(session)
    runs = await svc.list_runs(workspace_id, task_id=task_id)
    return await svc.enrich_list(runs)
