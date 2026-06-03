"""HTTP routes for agent execution."""

from __future__ import annotations

import json
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission
from app.core.db import get_session
from app.core.errors import AgentRunNotFound, AgentRunNotRunning
from app.modules.agent.coordinator import ExecutionCoordinatorService
from app.modules.agent.coordinator_schema import (
    ApproveRequest,
    CheckpointResponse,
    CheckpointSaveRequest,
    CheckpointSaveResponse,
    ResumeRequest,
)
from app.modules.agent.model import AgentRun
from app.modules.agent.schema import (
    AgentKillResponse,
    AgentRunCreate,
    AgentRunLogEntry,
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
    response: Response,
) -> AgentRunResponse:
    svc = AgentService(session)
    run = await svc.start_run(
        workspace_id,
        user.id,
        task_id=data.task_id,
        lease_id=data.lease_id,
        agent_type=data.agent_type,
        idempotency_key=data.idempotency_key,
    )
    # If run was returned from idempotency check, return 200 instead of 201
    if data.idempotency_key and run.status not in ("pending", "running"):
        response.status_code = status.HTTP_200_OK
    enriched = await svc.enrich_with_workspace_ids(run)
    return enriched


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


_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}


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
        done_data = json.dumps({"status": run.status, "exit_code": run.exit_code})
        return StreamingResponse(
            iter([f"event: done\ndata: {done_data}\n\n"]),
            media_type="text/event-stream",
            headers=_SSE_HEADERS,
        )
    return StreamingResponse(
        svc.stream_run_logs(run_id, session=session),
        media_type="text/event-stream",
        headers=_SSE_HEADERS,
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


# ---------------------------------------------------------------------------
# Execution Coordinator endpoints
# ---------------------------------------------------------------------------


@router.post(
    "/workspaces/{workspace_id}/agent/runs/{run_id}/resume",
    response_model=AgentRunResponse,
)
async def resume_agent_run(
    workspace_id: uuid.UUID,
    run_id: uuid.UUID,
    data: ResumeRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.TASK_RUN_AGENT))],
) -> AgentRunResponse:
    """Resume an interrupted agent run using a resume token."""
    coordinator = ExecutionCoordinatorService(session)
    run = await coordinator.resume_run(
        run_id,
        data.resume_token,
        context_fingerprint=data.context_fingerprint,
    )
    svc = AgentService(session)
    return await svc.enrich_with_workspace_ids(run)


@router.post(
    "/workspaces/{workspace_id}/agent/runs/{run_id}/approve",
    response_model=AgentRunResponse,
)
async def approve_agent_run(
    workspace_id: uuid.UUID,
    run_id: uuid.UUID,
    data: ApproveRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.TASK_RUN_AGENT))],
) -> AgentRunResponse:
    """Approve a pending agent run using an approval token."""
    coordinator = ExecutionCoordinatorService(session)
    run = await coordinator.approve(run_id, data.approval_token)
    svc = AgentService(session)
    return await svc.enrich_with_workspace_ids(run)


@router.get(
    "/workspaces/{workspace_id}/agent/runs/{run_id}/checkpoint",
    response_model=CheckpointResponse,
)
async def get_agent_run_checkpoint(
    workspace_id: uuid.UUID,
    run_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
) -> CheckpointResponse:
    """Get the latest checkpoint for an agent run."""
    coordinator = ExecutionCoordinatorService(session)
    run_obj = await session.get(AgentRun, run_id)
    if run_obj is None:
        raise AgentRunNotFound(
            f"Agent run '{run_id}' not found.",
            details={"run_id": str(run_id)},
        )
    data = await coordinator.load_checkpoint(run_id)
    return CheckpointResponse(
        version=run_obj.checkpoint_version,
        data=data,
        created_at=run_obj.updated_at if hasattr(run_obj, "updated_at") else None,
    )


@router.post(
    "/workspaces/{workspace_id}/agent/runs/{run_id}/checkpoint",
    response_model=CheckpointSaveResponse,
)
async def save_agent_run_checkpoint(
    workspace_id: uuid.UUID,
    run_id: uuid.UUID,
    data: CheckpointSaveRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.TASK_RUN_AGENT))],
) -> CheckpointSaveResponse:
    """Save checkpoint data for an agent run."""
    coordinator = ExecutionCoordinatorService(session)
    run_obj = await session.get(AgentRun, run_id)
    if run_obj is None:
        raise AgentRunNotFound(
            f"Agent run '{run_id}' not found.",
            details={"run_id": str(run_id)},
        )
    new_version = await coordinator.save_checkpoint(
        run_id, data.data, expected_version=run_obj.checkpoint_version
    )
    return CheckpointSaveResponse(
        version=new_version,
        created_at=None,
    )
