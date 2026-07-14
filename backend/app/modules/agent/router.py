"""HTTP routes for agent execution."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission, require_permission_any
from app.core.db import get_session, get_session_factory
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
    AgentRunInputRequest,
    AgentRunInputResponse,
    AgentRunLogEntry,
    AgentRunResponse,
    ExecutionContextResponse,
)
from app.modules.agent.service import AgentService, submit_run_input
from app.modules.auth.model import User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.daemon.host_fs import new_host_fs_delegate
from app.modules.daemon.model import DaemonTaskLease
from app.modules.daemon.permission_service import WorkspaceDialogRead
from app.modules.daemon.router import PermissionServiceDep
from app.modules.workspace.model import AgentRunWorkspace, Workspace
from app.modules.workspace.service import resolve_root_path_for_daemon

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


async def _user_owns_run(
    session: AsyncSession,
    user_id: uuid.UUID,
    run_id: uuid.UUID,
    *,
    is_platform_admin: bool = False,
) -> bool:
    """校验当前 user 能否访问该 run。

    AgentRun 无 user_id 列（V1），通过 ``AgentRunWorkspace → Workspace`` 反查：
    - platform admin：放行（与 rbac.has_permission 一致；同时兼容 quick-chat
      这种没有 workspace 关联的 run——admin 创建即可访问）。
    - 普通用户：必须在该 run 关联的 workspace 里有成员关系
      （UserWorkspaceRole 行存在即可，不限定 created_by，与 "workspace 成员"
      语义一致；历史数据 created_by 与 UserWorkspaceRole 不同步时不会被阻塞）。
    - quick-chat 类无 workspace 关联的 run：仅 admin 能访问（V1 简化）。
    """
    if is_platform_admin:
        return True
    stmt = (
        select(UserWorkspaceRole.workspace_id)
        .join(
            AgentRunWorkspace,
            AgentRunWorkspace.workspace_id == UserWorkspaceRole.workspace_id,
        )
        .where(
            AgentRunWorkspace.agent_run_id == run_id,
            UserWorkspaceRole.user_id == user_id,
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
    # platform admin 放行（与 rbac.has_permission 语义一致；老数据残留场景下
    # workspace.created_by 可能是另一个 admin 账号，不应阻塞 daemon 执行）。
    if not await _user_owns_run(session, user.id, run_id, is_platform_admin=user.is_platform_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="run not owned by current user",
        )

    # -- 恢复 lease.metadata 临时参数（task-03 持久化）-----------------------
    lease_meta = await _fetch_active_lease_meta(session, run_id)
    if not lease_meta:
        log.warning("execution_context_lease_missing", run_id=str(run_id))

    workspace_id = await _resolve_workspace_id(session, run_id)

    # ql-20260617-009：加载 Workspace 行，向 daemon 透传真实 root_path / slug。
    # daemon 收到 root_path 后若本地可访问直接用作 cwd，跳过 mirror clone；
    # quick-chat 场景 workspace_id 为 None，三字段都 None，daemon 兜底 'default'。
    ws_row = await session.get(Workspace, workspace_id) if workspace_id else None

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

    # task-02（2026-07-07-daemon-skill-execution / D-001/D-005/D-007）：stage 投递重构。
    # stage 类型 run 不再把完整 stage prompt 塞进 claude_md（避免覆盖 worktree CLAUDE.md，
    # patch 基准不一致 → does not match index 冲突）。改为：
    #   - claude_md 留空（stage run 不写 CLAUDE.md，worktree 原项目规则保留）
    #   - prompt 改为 skill 调用指令（/<skill_name> --change <id> --stage <stage>），
    #     stage run 总是用 skill 调用指令（lease_meta.prompt 是旧式 stage prompt，已废弃）
    #   - stage_meta + stage_dispatch 透传 bundle 数据，daemon 注入 STAGE_META env
    # task/scan run 保持原 claude_md 渲染（零回归）。
    stage_meta_out: dict | None = None
    stage_dispatch_out: bool | None = None
    if run_type == "stage":
        claude_md = ""
        stage_meta_out = getattr(bundle, "stage_meta", None)
        stage_dispatch_out = True
        if stage_meta_out and stage_meta_out.get("skill_name"):
            parts = [f"/{stage_meta_out['skill_name']}"]
            if stage_meta_out.get("change_id"):
                parts.append(f"--change {stage_meta_out['change_id']}")
            if stage_meta_out.get("stage"):
                parts.append(f"--stage {stage_meta_out['stage']}")
            lease_meta["prompt"] = " ".join(parts)

    # D-007@2026-07-10（remove-server-local-workspace-mode）：单一 daemon-client 模式，
    # backend 机器路径不可达，spec_root 恒为 None（daemon 自行解 bundle 到本地）。
    # 原 server-local + scan 的 lease_meta spec_root 透传已废（server-local 列删除）。
    response_spec_root: str | None = None

    return ExecutionContextResponse(
        agent_run_id=str(run.id),
        claude_md=claude_md,
        # 2026-07-08：stage/scan 返回 kind=interactive，让 daemon 走 SessionManager
        # （实时日志转发），不走 batch task-runner（adapter 对 claude 2.1.193 格式解析不全）。
        kind="interactive" if run_type in ("stage", "scan") else None,
        prompt=lease_meta.get("prompt"),
        # ql-20260618-009：AgentRun 是 source of truth；lease_meta 仅在 AgentRun
        # 字段为空时兜底（旧测试场景），避免 transport 覆盖快照。
        provider=run.provider or lease_meta.get("provider"),
        model=run.model or lease_meta.get("model"),
        resume_session_id=lease_meta.get("resume_session_id"),
        repo_url=lease_meta.get("repo_url"),
        branch=lease_meta.get("branch"),
        allowed_paths=lease_meta.get("allowed_paths"),
        tool_config=lease_meta.get("tool_config"),
        session_id=run.session_id,
        workspace_name=ws_row.name if ws_row else None,
        workspace_slug=ws_row.slug if ws_row else None,
        # D-007@2026-07-10：resolve_root_path_for_daemon 单参（server-local 列删除）。
        root_path=(resolve_root_path_for_daemon(ws_row.root_path) if ws_row else None),
        # task-07 新增：workspace_id 无条件透传（None 时 daemon 兜底）；
        # spec_root 单一 daemon-client 模式下恒 None（见上方 response_spec_root）。
        workspace_id=workspace_id,
        spec_root=response_spec_root,
        # task-02：stage 投递元数据 + stage_dispatch 透传（仅 stage run 非空）。
        stage_meta=stage_meta_out,
        stage_dispatch=stage_dispatch_out,
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
        model=data.model,
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


@router.post(
    "/workspaces/{workspace_id}/agent/runs/{run_id}/input",
    response_model=AgentRunInputResponse,
)
async def submit_agent_run_input(
    workspace_id: uuid.UUID,
    run_id: uuid.UUID,
    data: AgentRunInputRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> AgentRunInputResponse:
    """Submit user guidance input to an agent run.

    ql-20260617-005：恢复端点（cf71836 误删）。daemon 模式下 claude.cmd --print
    无法中途注入 stdin，但持久化 AgentRunLog(channel=user_input) + Redis pub/sub
    推到 SSE，前端 pending_input 指导框不会 404。
    """
    await submit_run_input(
        session,
        workspace_id=workspace_id,
        run_id=run_id,
        content=data.content,
    )
    return AgentRunInputResponse(run_id=run_id, accepted=True)


@router.get(
    "/workspaces/{workspace_id}/agent/runs/{run_id}/logs",
    response_model=list[AgentRunLogEntry],
)
async def get_agent_run_logs(
    workspace_id: uuid.UUID,
    run_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
    tool_kind: str | None = Query(
        None,
        description="逗号分隔多选工具种类，仅筛 channel=tool_call 行；不传返回全部",
    ),
) -> list[AgentRunLogEntry]:
    svc = AgentService(session)
    run = await svc.get_run(run_id)
    if run is None:
        raise AgentRunNotFound(
            f"Agent run '{run_id}' not found.",
            details={"run_id": str(run_id)},
        )
    logs = await svc.get_run_logs(run_id, tool_kind=tool_kind)
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
    user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
) -> StreamingResponse:
    """SSE endpoint — stream real-time logs for a running agent run.

    连接池安全：不注入请求级 session（会贯穿整个 StreamingResponse 生命周期、
    长时间占用一个连接池 slot）。run 存在性 / 状态校验改用短 session——校验后
    立即归还；stream_run_logs 生成器内部用 get_session_factory() 自建独立
    短 session（见 AgentService.stream_run_logs）。
    """
    # 存在性 + 状态校验：短 session，校验完即归还连接池 slot
    run_status = None
    run_exit_code = None
    found = False
    async with get_session_factory()() as session:
        run = await AgentService(session).get_run(run_id)
        if run is not None:
            found = True
            run_status = run.status
            run_exit_code = run.exit_code
    if not found:
        raise AgentRunNotFound(
            f"Agent run '{run_id}' not found.",
            details={"run_id": str(run_id)},
        )
    if run_status not in ("pending", "running"):
        done_data = json.dumps({"status": run_status, "exit_code": run_exit_code})
        return StreamingResponse(
            iter([f"event: done\ndata: {done_data}\n\n"]),
            media_type="text/event-stream",
            headers=_SSE_HEADERS,
        )
    # 生成器对象惰性求值；构造用短 session 随即归还，stream_run_logs 内部
    # 自建短 session 做逐次查询，不占用请求级连接池 slot。
    async with get_session_factory()() as ctor_session:
        gen = AgentService(ctor_session).stream_run_logs(run_id)
    return StreamingResponse(
        gen,
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
    "/workspaces/{workspace_id}/agent-sessions",
)
async def list_workspace_agent_sessions(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
    mode: str | None = None,
) -> list[dict]:
    """scan 真阻塞（改造点 E）：workspace 维度 active AgentSession 列表。

    供 approvals 审批中心页聚合 scan 歧义决策——前端拿 session_id 列表后订阅各自
    SSE（permission_request），实现"在审核页看到 scan 待决策 + 反馈续 turn"。
    """
    svc = AgentService(session)
    sessions = await svc.list_workspace_active_sessions(workspace_id, mode=mode)
    return [
        {
            "id": str(s.id),
            "status": s.status,
            "mode": (s.config or {}).get("mode"),
            "provider": s.provider,
        }
        for s in sessions
    ]


@router.get(
    "/workspaces/{workspace_id}/dialogs",
    response_model=list[WorkspaceDialogRead],
)
async def list_workspace_dialogs(
    workspace_id: uuid.UUID,
    user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
    perm_svc: PermissionServiceDep,
) -> list[WorkspaceDialogRead]:
    """工作区级 pending 对话查询（design §4.1 / FR-5 审批中心兜底）。

    URL 落地 ``/api/workspaces/{workspace_id}/dialogs``（agent router 默认 /api 前缀，
    不挂 daemon router——其 prefix=/daemon 会变形 URL）。成员校验由
    ``require_permission(TASK_READ)`` 从路径参数 ``{workspace_id}`` 完成（非成员 403）；
    实现委托 ``DaemonPermissionService.list_pending_dialogs_for_workspace``（跨模块读，
    permission_service 已有先例 import AgentSession）。只读，不触碰 PERMISSION_REQUEST
    写链路（D-001）。
    """
    return await perm_svc.list_pending_dialogs_for_workspace(workspace_id, user.id)


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


# ---------------------------------------------------------------------------
# Mission endpoints (Wave 5, 2026-06-19-multi-agent-orchestration)
# End-to-end: POST creates a Mission (GLM plans), creates Worker Runs, and
# dispatches them to an online daemon. GET reads derived status.
# ---------------------------------------------------------------------------

from app.modules.agent.control import MissionControlService  # noqa: E402
from app.modules.agent.delegation import CoordinatorPlanner, GLMConfig  # noqa: E402
from app.modules.agent.execution import MissionExecutionService  # noqa: E402
from app.modules.agent.mcp_tools import router as mcp_tools_router  # noqa: E402
from app.modules.agent.mission import MissionService, derive_status  # noqa: E402
from app.modules.agent.mission_schema import (  # noqa: E402
    MissionArtifactResponse,
    MissionCreateRequest,
    MissionResponse,
    MissionWorkerRunResponse,
)
from app.modules.agent.model import AgentArtifact, AgentMission  # noqa: E402
from app.modules.agent.orchestrator import OrchestratorService  # noqa: E402

# Roles that need write tools; everything else is treated read-only at dispatch.
_WRITE_ROLES = frozenset({"impl"})


def _mission_to_response(
    mission: AgentMission,
    runs: list[AgentRun],
    cost: float,
    artifacts_by_run: dict[uuid.UUID, list[AgentArtifact]] | None = None,
) -> MissionResponse:
    artifacts_by_run = artifacts_by_run or {}
    workers: list[MissionWorkerRunResponse] = []
    for r in runs:
        w = MissionWorkerRunResponse.model_validate(r)
        w.artifacts = [
            MissionArtifactResponse.model_validate(a) for a in artifacts_by_run.get(r.id, [])
        ]
        workers.append(w)
    return MissionResponse(
        id=mission.id,
        workspace_id=mission.workspace_id,
        change_id=mission.change_id,
        objective=mission.objective,
        status=derive_status(runs, cancelled=mission.cancelled_at is not None),
        budget_usd=mission.budget_usd,
        cost_so_far=cost,
        constraints=mission.constraints,
        cancelled_at=mission.cancelled_at,
        created_at=mission.created_at,
        workers=workers,
    )


async def _load_mission_artifacts(
    session: AsyncSession, mission_id: uuid.UUID
) -> dict[uuid.UUID, list[AgentArtifact]]:
    """Group a mission's Artifacts by run_id (for Worker.artifacts, Wave 3)."""
    stmt = (
        select(AgentArtifact)
        .join(AgentRun, AgentArtifact.run_id == AgentRun.id)
        .where(AgentRun.mission_id == mission_id)
        .order_by(AgentArtifact.created_at)
    )
    out: dict[uuid.UUID, list[AgentArtifact]] = {}
    for a in (await session.execute(stmt)).scalars().all():
        out.setdefault(a.run_id, []).append(a)
    return out


@router.get(
    "/workspaces/{workspace_id}/missions",
    response_model=list[MissionResponse],
)
async def list_missions(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.TASK_READ))],
    limit: int = Query(20, ge=1),
    offset: int = Query(0, ge=0),
) -> list[MissionResponse]:
    """列出 workspace 的 mission（按 created_at 倒序，分页）。

    quick（mission 历史列表）：前端 Agent 团队页进页面时调，展示历史 mission
    （状态徽标/目标/时间/worker 数），点击单条调 getMission 刷新详情。返回完整
    MissionResponse（含 workers + cost + artifacts）以复用 _mission_to_response；
    N+1 查询可接受（列表通常 <20，非高频轮询路径——活跃 mission 走 getMission 轮询）。
    limit 默认 20，硬上限 50（min(limit,50) 防滥用，不报 422）。
    """
    stmt = (
        select(AgentMission)
        .where(AgentMission.workspace_id == workspace_id)
        .order_by(AgentMission.created_at.desc())
        .limit(min(limit, 50))
        .offset(offset)
    )
    missions = (await session.execute(stmt)).scalars().all()
    ctrl = MissionControlService(session)
    out: list[MissionResponse] = []
    for m in missions:
        runs = await ctrl.worker_runs(m.id)
        cost = await ctrl.cost_so_far(m.id)
        arts = await _load_mission_artifacts(session, m.id)
        out.append(_mission_to_response(m, runs, cost, arts))
    return out


@router.post(
    "/workspaces/{workspace_id}/missions",
    response_model=MissionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_mission(
    workspace_id: uuid.UUID,
    payload: MissionCreateRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> MissionResponse:
    """Plan a Mission via GLM, create Worker Runs, dispatch them to a daemon."""
    constraints = dict(payload.constraints or {})
    if getattr(payload, "mode", None) is not None:
        constraints["mode"] = payload.mode
    if getattr(payload, "session_id", None) is not None:
        constraints["session_id"] = str(payload.session_id)
    # 2026-07-12-team-main-agent-orchestration task-03 / D-001@v2：mode=team 旁路
    # GLM CoordinatorPlanner，走主 agent OrchestratorService。主 agent = 真 agent
    # （daemon interactive lease + MCP tool），像项目经理读 worker 产出再决策。
    # mode=single / None 走原 planner 链路（零回归，下方 start_mission 不动）。
    if constraints.get("mode") == "team":
        orchestrator = OrchestratorService(session)
        mission, _main_run = await orchestrator.team_mission_entry(
            workspace_id=workspace_id,
            objective=payload.objective,
            created_by=user.id,
            change_id=payload.change_id,
            constraints=constraints,
            budget_usd=payload.budget_usd,
            worker_preset=payload.worker_preset,
            main_agent_config=payload.main_agent_config,
        )
        ctrl = MissionControlService(session)
        fresh = await ctrl.worker_runs(mission.id)
        cost = await ctrl.cost_so_far(mission.id)
        arts = await _load_mission_artifacts(session, mission.id)
        return _mission_to_response(mission, fresh, cost, arts)
    cfg = GLMConfig.from_env()
    if cfg is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "GLM endpoint not configured (ANTHROPIC_BASE_URL/AUTH_TOKEN)",
        )
    planner = CoordinatorPlanner(cfg)
    mission, runs = await MissionService(session).start_mission(
        workspace_id=workspace_id,
        objective=payload.objective,
        created_by=user.id,
        change_id=payload.change_id,
        constraints=constraints,
        budget_usd=payload.budget_usd,
        planner=planner,
    )
    exec_svc = MissionExecutionService(session, host_fs_delegate=new_host_fs_delegate(session))
    ctrl = MissionControlService(session)
    now = datetime.now(UTC)
    for run in runs:
        # 治理门（D-008@v1，2026-06-28-team-mainline-integration）：dispatch 前检查
        # 取消/并发上限/预算。拒绝时把该 Run 标 ``killed``（非悬挂），否则 pending
        # 悬挂会让 derive_status 永远 running、Mission 永不收敛（start_mission 已
        # persist N 个 pending，超预算/超并发时剩余的必须进入终态）。
        allowed, reason = await ctrl.can_dispatch_worker(mission)
        if not allowed:
            run.status = "killed"
            run.finished_at = now
            run.exit_code = -1
            log.info(
                "mission_worker_dispatch_rejected",
                run_id=str(run.id),
                reason=reason,
            )
            continue
        read_only = run.role not in _WRITE_ROLES
        try:
            await exec_svc.dispatch_worker(
                run, workspace_id=workspace_id, user_id=user.id, read_only=read_only
            )
        except Exception as exc:
            # 诊断 36b9b475：原 except 吞异常不写 error_code，failed run 不可诊断。
            # execution 内部已统一收敛 worktree/daemon 失败；此处仅兜底未预期异常，
            # 同样写 error_code 杜绝静默 failed。
            from app.modules.agent.execution import mark_worker_run_failed

            await mark_worker_run_failed(
                session, run, error_code="dispatch_exception", message=str(exc)
            )
            log.warning("mission_worker_dispatch_failed", run_id=str(run.id), error=str(exc))
    await session.commit()  # 提交 killed / dispatch 状态
    fresh = await ctrl.worker_runs(mission.id)
    cost = await ctrl.cost_so_far(mission.id)
    arts = await _load_mission_artifacts(session, mission.id)
    return _mission_to_response(mission, fresh, cost, arts)


@router.get("/missions/{mission_id}", response_model=MissionResponse)
async def get_mission(
    mission_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.TASK_READ))],
) -> MissionResponse:
    mission = await session.get(AgentMission, mission_id)
    if mission is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "mission not found")
    # NOTE: collect_completed_artifacts is NOT called on every GET — it provoked
    # connection-pool exhaustion under polling (each GET ran extra queries).
    # Artifact 回灌 is triggered explicitly (cancel) / via complete_lease hook (todo).
    ctrl = MissionControlService(session)
    runs = await ctrl.worker_runs(mission.id)
    cost = await ctrl.cost_so_far(mission.id)
    arts = await _load_mission_artifacts(session, mission.id)
    return _mission_to_response(mission, runs, cost, arts)


@router.post("/missions/{mission_id}/cancel", response_model=MissionResponse)
async def cancel_mission(
    mission_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> MissionResponse:
    mission = await session.get(AgentMission, mission_id)
    if mission is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "mission not found")
    ctrl = MissionControlService(session)
    await ctrl.cancel(mission)
    runs = await ctrl.worker_runs(mission.id)
    cost = await ctrl.cost_so_far(mission.id)
    arts = await _load_mission_artifacts(session, mission.id)
    return _mission_to_response(mission, runs, cost, arts)


# Team 主 agent MCP endpoint（2026-07-12-team-main-agent-orchestration task-03 / D-007@v2）：
# 嵌套 include，随 agent_router 一起挂到 /api 前缀。
router.include_router(mcp_tools_router)
