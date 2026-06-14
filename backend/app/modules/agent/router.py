"""HTTP routes for agent execution."""

from __future__ import annotations

import json
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission, require_permission_any
from app.core.db import get_session
from app.core.errors import AgentRunNotFound, AgentRunNotRunning
from app.core.logging import get_logger
from app.modules.agent.context_builder import (
    build_scan_bundle,
    build_spec_bundle,
    build_stage_bundle,
    render_bundle_to_claude_md,
)
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
    ExecutionContextResponse,
)
from app.modules.agent.service import AgentService
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.daemon.model import DaemonTaskLease
from app.modules.workspace.model import AgentRunWorkspace, Workspace

log = get_logger(__name__)

router = APIRouter(tags=["agent"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


# ---------------------------------------------------------------------------
# GET /agent-runs/{run_id}/execution-context (task-02 / design §Phase 2)
# ---------------------------------------------------------------------------


def _determine_run_type(agent_run: AgentRun, lease_meta: dict) -> str:
    """返回 'task' | 'stage' | 'scan'；无法判定抛 ValueError（端点转 400）。

    优先 lease.metadata 显式标记（task-03 写入），其次 agent_type，最后 task_id。
    """
    if lease_meta.get("stage") or lease_meta.get("step_prompt"):
        return "stage"
    if lease_meta.get("root_path") or lease_meta.get("spec_root"):
        return "scan"
    if agent_run.agent_type == "scan":
        return "scan"
    if agent_run.task_id is not None:
        return "task"
    msg = "cannot determine run type for execution-context"
    raise ValueError(msg)


async def _user_owns_run(session: AsyncSession, user_id: uuid.UUID, run_id: uuid.UUID) -> bool:
    """校验 run 归属当前 user（AgentRunWorkspace → Workspace.created_by）。

    AgentRun 无 user_id 列（V1），通过 M:N 关联反查 workspace owner。
    """
    stmt = (
        select(Workspace.id)
        .join(
            AgentRunWorkspace,
            AgentRunWorkspace.workspace_id == Workspace.id,
        )
        .where(
            AgentRunWorkspace.agent_run_id == run_id,
            Workspace.created_by == user_id,
        )
        .limit(1)
    )
    result = await session.execute(stmt)
    return result.scalar_one_or_none() is not None


async def _fetch_active_lease_meta(session: AsyncSession, run_id: uuid.UUID) -> dict:
    """查 run 的活跃 lease（pending/claimed），返回 metadata（无则 {}）。

    参考 ``lease_service.py`` 同款查询；status IN ('pending','claimed')
    排除已 completed/cancelled/expired 的历史 lease。
    """
    stmt = (
        select(DaemonTaskLease)
        .where(
            DaemonTaskLease.agent_run_id == run_id,
            DaemonTaskLease.status.in_(["pending", "claimed"]),
        )
        .order_by(DaemonTaskLease.created_at.desc())
        .limit(1)
    )
    lease = (await session.execute(stmt)).scalars().first()
    if lease is None:
        return {}
    return lease.metadata_ or {}


async def _resolve_workspace_id(session: AsyncSession, run_id: uuid.UUID) -> uuid.UUID | None:
    """反查 run 关联的 workspace_id（bundle 构建需要）。"""
    stmt = (
        select(AgentRunWorkspace.workspace_id)
        .where(AgentRunWorkspace.agent_run_id == run_id)
        .limit(1)
    )
    return (await session.execute(stmt)).scalar_one_or_none()


@router.get(
    "/agent-runs/{run_id}/execution-context",
    response_model=ExecutionContextResponse,
)
async def get_execution_context(
    run_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.TASK_READ))],
) -> ExecutionContextResponse:
    """返回 daemon 执行所需的完整上下文（task-02 / design §Phase 2）。

    1. 查 AgentRun（404 if missing）。
    2. 校验 run 归属当前 user（403 if mismatch，R-02 应对）。
    3. 查活跃 lease.metadata 恢复临时参数（R-stage 应对，依赖 task-03）。
    4. 按 run 类型分发调 build_spec/stage/scan_bundle。
    5. render_bundle_to_claude_md 生成 claude_md（不入 metadata）。
    """
    svc = AgentService(session)
    run = await svc.get_run(run_id)
    if run is None:
        raise AgentRunNotFound(
            f"Agent run '{run_id}' not found.",
            details={"run_id": str(run_id)},
        )

    # -- 归属校验（R-02：跨 user 访问 → 403）-------------------------------
    if not await _user_owns_run(session, user.id, run_id):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="run not owned by current user",
        )

    # -- 恢复 lease.metadata 临时参数（task-03 持久化）-----------------------
    lease_meta = await _fetch_active_lease_meta(session, run_id)
    if not lease_meta:
        log.warning("execution_context_lease_missing", run_id=str(run_id))

    workspace_id = await _resolve_workspace_id(session, run_id)

    # -- run 类型分发 + bundle 构建 ------------------------------------------
    try:
        run_type = _determine_run_type(run, lease_meta)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    log.info(
        "execution_context_build",
        run_id=str(run_id),
        run_type=run_type,
        workspace_id=str(workspace_id),
    )

    if run_type == "task":
        bundle = await build_spec_bundle(
            session,
            change_id=run.change_id,
            task_id=run.task_id,
            workspace_id=workspace_id,
        )
    elif run_type == "stage":
        bundle = await build_stage_bundle(
            session,
            change_id=run.change_id,
            stage=lease_meta.get("stage", ""),
            workspace_id=workspace_id,
            read_only=bool(lease_meta.get("read_only", False)),
            step_prompt=lease_meta.get("step_prompt"),
        )
    else:  # scan
        bundle = await build_scan_bundle(
            session,
            workspace_id=workspace_id,
            spec_root=lease_meta.get("spec_root", ""),
            root_path=lease_meta.get("root_path", ""),
            run_id=run.id,
            runtime_root=lease_meta.get("runtime_root"),
        )

    claude_md = render_bundle_to_claude_md(bundle)

    return ExecutionContextResponse(
        agent_run_id=str(run.id),
        claude_md=claude_md,
        prompt=lease_meta.get("prompt"),
        provider=lease_meta.get("provider"),
        resume_session_id=lease_meta.get("resume_session_id"),
        repo_url=lease_meta.get("repo_url"),
        branch=lease_meta.get("branch"),
        allowed_paths=lease_meta.get("allowed_paths"),
        tool_config=lease_meta.get("tool_config"),
        session_id=run.session_id,
    )


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
        preferred_backend=data.preferred_backend,
        provider=data.provider,
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
