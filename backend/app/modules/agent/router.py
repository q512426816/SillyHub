"""HTTP routes for agent execution."""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.auth_deps import get_current_user, require_permission, require_permission_any
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
from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
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
from app.modules.daemon.lease.context import _inject_provider_config
from app.modules.daemon.model import DaemonTaskLease
from app.modules.daemon.permission_service import WorkspaceDialogRead
from app.modules.daemon.router import PermissionServiceDep
from app.modules.daemon.schema import AgentSessionListItem, ChangeSessionAuthor
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
    msg = "无法判定执行类型：缺少阶段标记与任务关联，请重新发起执行。"
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
            "指定的执行记录不存在，可能已被删除。",
            details={"run_id": str(run_id)},
        )

    # -- 归属校验（R-02：跨 user 访问 → 403）-------------------------------
    # platform admin 放行（与 rbac.has_permission 语义一致；老数据残留场景下
    # workspace.created_by 可能是另一个 admin 账号，不应阻塞 daemon 执行）。
    if not await _user_owns_run(session, user.id, run_id, is_platform_admin=user.is_platform_admin):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="当前用户无权访问该执行记录。",
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

    # task-06（D-012@v2）：run 绑定 AgentProfile 且快照含 system_prompt 时，prepend 到
    # claudeMd 顶部。直接读已加载的 ``AgentRun.agent_profile_snapshot`` JSON 列——
    # 零额外查询（C-07：null 路径无新增 DB 查询；snapshot 缺失 / prompt 为空同样不查）。
    # stage 分支随后会把 claude_md 重置为 ""，故 stage run 自然不携带 prompt（stage
    # 不写 CLAUDE.md，D-007 既有约束不受影响）；task / scan（batch + interactive）两
    # 路径都 fetch claudeMd，一次 prepend 双覆盖（design §7）。
    # ``build_spec_bundle`` / ``render_bundle_to_claude_md`` 函数零改动（非渲染管线）。
    _profile_snapshot = (
        run.agent_profile_snapshot if isinstance(run.agent_profile_snapshot, dict) else None
    )
    _profile_system_prompt = _profile_snapshot.get("system_prompt") if _profile_snapshot else None
    if _profile_system_prompt:
        claude_md = f"{_profile_system_prompt}\n\n{claude_md}"

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

    # task-06 X-10 补漏（2026-07-26）：/execution-context 也注入 provider_config
    # + 覆盖 model。原 X-10 只覆盖 claim_lease payload[model]，但 claude SDK 走
    # /execution-context 拿 execPayload.model，漏覆盖致 opus[1m] 透传给 DeepSeek 报
    # "模型不存在"。此处复用 _inject_provider_config 与 claim 同源。
    exec_lease = (
        (
            await session.execute(
                select(DaemonTaskLease)
                .where(
                    DaemonTaskLease.agent_run_id == run_id,
                    DaemonTaskLease.status.in_(["pending", "claimed"]),
                )
                .order_by(DaemonTaskLease.created_at.desc())
                .limit(1)
            )
        )
        .scalars()
        .first()
    )
    exec_payload: dict = {"model": run.model or lease_meta.get("model")}
    if exec_lease is not None:
        await _inject_provider_config(
            session,
            exec_lease,
            lease_meta,
            exec_payload,
            agent_kind_raw=run.provider or lease_meta.get("provider"),
        )

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
        model=exec_payload.get("model") or run.model or lease_meta.get("model"),
        provider_config=exec_payload.get("provider_config"),
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
        # task-12 / 2026-08-02-agent-profile-layer：透传用户指定的 AgentProfile
        # （软约束兜底，design §8）。service.start_run → _resolve_dispatch_profile
        # → resolve_profile(run_profile_id=...)，None 走兜底链不阻断（FR-15 零回归）。
        agent_profile_id=data.agent_profile_id,
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
            "指定的执行记录不存在，可能已被删除。",
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
            "指定的执行记录不存在，可能已被删除。",
            details={"run_id": str(run_id)},
        )
    if run.status not in ("pending", "running"):
        raise AgentRunNotRunning(
            "执行已结束或尚未开始，无法执行终止操作。",
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
    after: datetime | None = Query(
        None,
        description=(
            "增量游标（ISO timestamp）：只返回 timestamp 严格更新的日志条目；"
            "不传返回全量（perf-remediation task-08 / FR-10）"
        ),
    ),
) -> list[AgentRunLogEntry]:
    svc = AgentService(session)
    run = await svc.get_run(run_id)
    if run is None:
        raise AgentRunNotFound(
            "指定的执行记录不存在，可能已被删除。",
            details={"run_id": str(run_id)},
        )
    logs = await svc.get_run_logs(run_id, tool_kind=tool_kind, after=after)
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
            "指定的执行记录不存在，可能已被删除。",
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
    include_ended: bool = False,
) -> list[dict]:
    """工作区会话列表（2026-08-14-change-center-conversation-driven task-06 / D-002@v1）。

    include_ended=false（缺省）：现状——仅 active 会话最小字段 dict
    （id/status/mode/provider），供 approvals 审批中心聚合 scan 歧义决策。
    include_ended=true：工作区全量会话（含已结束），完整 AgentSessionListItem
    （id/provider/status/turn_count/author/last_active_at/title，对齐
    daemon/schema.py:71-84），排序 coalesce(last_active_at, created_at) desc。
    权限/过滤保持现状（workspace 成员跨成员可见），不因 include_ended 改变。
    """
    if not include_ended:
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
    items = await _build_workspace_session_items(session, workspace_id, mode=mode)
    return [item.model_dump() for item in items]


async def _build_workspace_session_items(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    *,
    mode: str | None = None,
) -> list[AgentSessionListItem]:
    """include_ended=true 分支：工作区全量会话（含已结束）→ AgentSessionListItem。

    过滤：AgentSession.workspace_id == workspace_id（工作区级会话，D-002@v1）+
    软删过滤（FR-07：deleted_at IS NULL）；跨成员可见（D-005@v1，不按 user_id 过滤）。
    mode 非空时按 config['mode'] 过滤（与 active-only 分支语义一致）。
    排序 coalesce(last_active_at, created_at) desc（NULL last_active_at 回落 created_at，
    对齐 daemon/session/service.py:1499-1515 先例）。
    """
    stmt = (
        select(AgentSession)
        .where(
            col(AgentSession.workspace_id) == workspace_id,
            col(AgentSession.deleted_at).is_(None),
        )
        .order_by(
            func.coalesce(AgentSession.last_active_at, AgentSession.created_at).desc(),
        )
    )
    sessions = list((await session.execute(stmt)).scalars().all())
    if mode:
        sessions = [s for s in sessions if (s.config or {}).get("mode") == mode]
    if not sessions:
        return []
    return await _assemble_workspace_session_items(session, sessions)


async def _assemble_workspace_session_items(
    session: AsyncSession,
    sessions: list[AgentSession],
) -> list[AgentSessionListItem]:
    """把 AgentSession 列表组装为 AgentSessionListItem（批量取作者名 + user_input 标题）。

    标题逻辑对齐 change/router.py list_change_sessions（X-04 干净来源）：取该会话
    最早一条 channel=user_input 的 AgentRunLog 摘要（前 30 字）。
    """
    session_ids = [s.id for s in sessions]
    user_ids = {s.user_id for s in sessions}

    # 批量取作者展示名（避免 N+1）。
    users = (await session.execute(select(User).where(col(User.id).in_(user_ids)))).scalars().all()
    user_name_map: dict[uuid.UUID, str | None] = {u.id: u.display_name for u in users}

    # 批量取每个 session 的首条 user_input 标题：JOIN AgentRun 过滤
    # agent_session_id IN (...) + AgentRunLog.channel='user_input'，按
    # (agent_session_id, timestamp asc) 取首条。Python 侧 group + 取最早。
    title_stmt = (
        select(
            AgentRun.agent_session_id.label("session_id"),
            AgentRunLog.timestamp.label("ts"),
            AgentRunLog.content_redacted.label("content"),
        )
        .join(AgentRunLog, AgentRunLog.run_id == AgentRun.id)
        .where(
            col(AgentRun.agent_session_id).in_(session_ids),
            col(AgentRunLog.channel) == "user_input",
        )
    )
    title_rows = (await session.execute(title_stmt)).all()
    first_input_by_session: dict[uuid.UUID, datetime] = {}
    content_by_session: dict[uuid.UUID, str] = {}
    for row in title_rows:
        sid = row.session_id
        ts = row.ts
        prev = first_input_by_session.get(sid)
        if prev is None or ts < prev:
            first_input_by_session[sid] = ts
            content_by_session[sid] = row.content or ""

    return [
        AgentSessionListItem(
            id=s.id,
            provider=s.provider,
            status=s.status,
            turn_count=s.turn_count,
            mode=(s.config or {}).get("mode"),
            author=ChangeSessionAuthor(
                user_id=s.user_id,
                display_name=user_name_map.get(s.user_id),
            ),
            last_active_at=s.last_active_at,
            title=(content_by_session.get(s.id, "") or "")[:30] or None,
        )
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
            "指定的执行记录不存在，可能已被删除。",
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
            "指定的执行记录不存在，可能已被删除。",
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
    """把 AgentMission + runs 转换成 MissionResponse（task-07 扩展 project 概要字段）。"""
    artifacts_by_run = artifacts_by_run or {}
    workers: list[MissionWorkerRunResponse] = []
    for r in runs:
        w = MissionWorkerRunResponse.model_validate(r)
        w.artifacts = [
            MissionArtifactResponse.model_validate(a) for a in artifacts_by_run.get(r.id, [])
        ]
        workers.append(w)

    # 转换 scope_workspace_ids JSON 列 → UUID 列（task-07）
    scope_uuids: list[uuid.UUID] | None = None
    if mission.scope_workspace_ids:
        scope_uuids = []
        for sid in mission.scope_workspace_ids:
            try:
                scope_uuids.append(uuid.UUID(sid))
            except (ValueError, AttributeError):
                pass  # 无效 UUID 跳过（防御性编程，理论上不应发生）

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
        # task-07（2026-08-19-cross-workspace-team-mission）：跨 workspace mission 概要字段
        project_id=mission.project_id,
        scope_workspace_ids=scope_uuids,
        # workspace_name / workspace_type 由调用方按需填充（list_project_missions 批量填充），
        # 单个 mission 端点（get_mission / create_mission）不填充以保持零回归（设计 §7.1）。
        workspace_name=None,
        workspace_type=None,
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
    # BE-P1-1（2026-08-21 审查）：原 require_permission_any 使 path 的 workspace_id
    # 完全不参与鉴权（任意 ws 有 TASK_READ 即可列他人 ws 的 mission）。路径含
    # {workspace_id}，改 require_permission 让其参与校验。
    user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
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
    if not missions:
        return []
    mission_ids = [m.id for m in missions]
    # Wave B（2026-07-25）：批量化 runs + cost + artifacts。原每 mission 调 worker_runs
    # + cost_so_far（内部重复 worker_runs）+ _load_mission_artifacts = 3 SELECT × N。
    # 现改为 2 SELECT（runs IN mission_ids / artifacts IN run_ids），cost 复用 runs 聚合。
    all_runs = (
        (await session.execute(select(AgentRun).where(AgentRun.mission_id.in_(mission_ids))))
        .scalars()
        .all()
    )
    runs_by_mission: dict[uuid.UUID, list[AgentRun]] = {}
    cost_by_mission: dict[uuid.UUID, float] = {}
    for r in all_runs:
        # IN mission_ids 查询保证 mission_id 非空；narrow 给 mypy（AgentRun.mission_id 可空）。
        mid = r.mission_id
        if mid is None:
            continue
        runs_by_mission.setdefault(mid, []).append(r)
        cost_by_mission[mid] = cost_by_mission.get(mid, 0.0) + (r.total_cost_usd or 0.0)
    arts_by_run: dict[uuid.UUID, list[AgentArtifact]] = {}
    if all_runs:
        art_stmt = (
            select(AgentArtifact)
            .where(AgentArtifact.run_id.in_([r.id for r in all_runs]))
            .order_by(AgentArtifact.created_at)
        )
        for a in (await session.execute(art_stmt)).scalars().all():
            arts_by_run.setdefault(a.run_id, []).append(a)
    return [
        _mission_to_response(
            m,
            runs_by_mission.get(m.id, []),
            cost_by_mission.get(m.id, 0.0),
            arts_by_run,
        )
        for m in missions
    ]


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
    # BE-P2-4（2026-08-21 审查）：剥状态机保留键（与 create_project_mission 同款）。
    constraints = _sanitize_constraints(payload.constraints)
    if getattr(payload, "mode", None) is not None:
        constraints["mode"] = payload.mode
    if getattr(payload, "session_id", None) is not None:
        constraints["session_id"] = str(payload.session_id)
    # task-05（2026-08-08-dispatch-worker-caller-worktree / 路径A，D-007@v1）：把
    # orchestration_mode 并入 constraints（与 mode/session_id 并入同款）。team_mission_entry
    # （task-01）内部也会按 orchestration_mode 形参落同一键，幂等。constraints 反映 mode 供
    # finalizer（task-03）/ 前端读取，无论哪层判定都不依赖单一来源。
    if getattr(payload, "orchestration_mode", None) is not None:
        constraints["orchestration_mode"] = payload.orchestration_mode
    # 2026-07-12-team-main-agent-orchestration task-03 / D-001@v2：mode=team 旁路
    # GLM CoordinatorPlanner，走主 agent OrchestratorService。主 agent = 真 agent
    # （daemon interactive lease + MCP tool），像项目经理读 worker 产出再决策。
    # mode=single / None 走原 planner 链路（零回归，下方 start_mission 不动）。
    # task-05（路径A）：orchestration_mode=="external" 是 team 路径子模式（SillySpec
    # 外部调度，跳过 orchestrator spawn），也进 team_mission_entry，不落 GLM planner 单
    # agent 链路。判定口径与链路B（mcp_gateway/tools.py）+ team_mission_entry 三入口对齐。
    orchestration_mode = payload.orchestration_mode or "team"
    if constraints.get("mode") == "team" or orchestration_mode == "external":
        orchestrator = OrchestratorService(session)
        # external 模式 team_mission_entry 返回 (mission, None)——不 spawn 主 agent run。
        # 下方用 ctrl.worker_runs 重查（source of truth），不读 _main_run，故 None 安全；
        # MissionResponse.workers 自然为空，derive_status([]) → "planning"（design §7.1）。
        # task-07（2026-08-19-cross-workspace-team-mission）：透传 anchor_workspace_id /
        # scope_workspace_ids 到 team_mission_entry（存量不传 → 行为不变，零回归）。
        mission, _main_run = await orchestrator.team_mission_entry(
            workspace_id=workspace_id,
            objective=payload.objective,
            created_by=user.id,
            change_id=payload.change_id,
            constraints=constraints,
            budget_usd=payload.budget_usd,
            worker_preset=payload.worker_preset,
            main_agent_config=payload.main_agent_config,
            orchestration_mode=orchestration_mode,
            scope_workspace_ids=getattr(payload, "scope_workspace_ids", None),
        )
        ctrl = MissionControlService(session)
        fresh = await ctrl.worker_runs(mission.id)
        cost = MissionControlService.cost_from_runs(fresh)
        arts = await _load_mission_artifacts(session, mission.id)
        return _mission_to_response(mission, fresh, cost, arts)
    cfg = GLMConfig.from_env()
    if cfg is None:
        raise HTTPException(
            status.HTTP_503_SERVICE_UNAVAILABLE,
            "GLM 服务端点未配置（ANTHROPIC_BASE_URL/AUTH_TOKEN），请联系管理员。",
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
    cost = MissionControlService.cost_from_runs(fresh)
    arts = await _load_mission_artifacts(session, mission.id)
    return _mission_to_response(mission, fresh, cost, arts)


@router.get("/missions/{mission_id}", response_model=MissionResponse)
async def get_mission(
    mission_id: uuid.UUID,
    session: SessionDep,
    # BE-P1-1（2026-08-21 审查）：原 require_permission_any(TASK_READ) + 无归属校验，
    # 任意 ws 有 TASK_READ 的用户凭 mission_id 可读任意 mission。入口仅认证，
    # 归属判定（anchor/scope 读权限或项目经理/超管）收敛到 _require_mission_access。
    user: Annotated[User, Depends(get_current_user)],
) -> MissionResponse:
    mission = await session.get(AgentMission, mission_id)
    if mission is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "指定的任务组不存在。")
    # BE-P1-1（2026-08-21 审查）：原先无归属校验，任何持 TASK_READ 的用户凭 mission_id
    # 可读任意 mission。现要求 anchor/scope 内任一 ws 有 TASK_READ（或项目经理）。
    await _require_mission_access(session, user, mission, write=False)
    # NOTE: collect_completed_artifacts is NOT called on every GET — it provoked
    # connection-pool exhaustion under polling (each GET ran extra queries).
    # Artifact 回灌 is triggered explicitly (cancel) / via complete_lease hook (todo).
    ctrl = MissionControlService(session)
    runs = await ctrl.worker_runs(mission.id)
    cost = MissionControlService.cost_from_runs(runs)
    arts = await _load_mission_artifacts(session, mission.id)
    return _mission_to_response(mission, runs, cost, arts)


@router.post("/missions/{mission_id}/cancel", response_model=MissionResponse)
async def cancel_mission(
    mission_id: uuid.UUID,
    session: SessionDep,
    # BE-P0-1（2026-08-21 审查）：原 require_permission(WORKSPACE_WRITE) 的 checker
    # 声明 workspace_id: Path(...)，本路由路径无该参数 → 已认证请求恒 422，取消功能
    # 完全不可用。入口仅认证（get_current_user），归属判定（anchor/scope 写权限或
    # 项目经理/超管）全部收敛到 _require_mission_access——用任意 ws 权限做入口门槛
    # 会把"项目经理但无 ws 角色"的合法取消者挡在门外。
    user: Annotated[User, Depends(get_current_user)],
) -> MissionResponse:
    mission = await session.get(AgentMission, mission_id)
    if mission is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "指定的任务组不存在。")
    await _require_mission_access(session, user, mission, write=True)
    ctrl = MissionControlService(session)
    await ctrl.cancel(mission)
    runs = await ctrl.worker_runs(mission.id)
    cost = MissionControlService.cost_from_runs(runs)
    arts = await _load_mission_artifacts(session, mission.id)
    return _mission_to_response(mission, runs, cost, arts)


# ---------------------------------------------------------------------------
# Project-scoped Mission endpoints (task-07, 2026-08-19-cross-workspace-team-mission)
# POST/GET /api/projects/{pid}/missions — 项目维度创建/查询 mission
# ---------------------------------------------------------------------------


async def _require_project_manager(
    session: AsyncSession, user: User, project_id: uuid.UUID
) -> None:
    """校验当前用户对该 PPM 项目有 manager 权限,否则 403（design §7.1 / FR-05）。

    复用 ppm/common/data_scope 的 is_super_admin + manager_project_ids。
    """
    if await _require_project_manager_or(session, user, project_id):
        return
    from app.core.errors import PermissionDenied

    raise PermissionDenied(
        "仅项目经理可创建项目团队会话。",
        details={"project_id": str(project_id)},
    )


async def _require_mission_access(
    session: AsyncSession, user: User, mission: AgentMission, *, write: bool
) -> None:
    """通用 mission 端点（get/cancel，路径无 workspace_id）的归属校验，否则 403。

    放行口径与 mcp_tools._get_mission 的 scope 语义对齐：用户对 anchor 或 scope
    内任一 workspace 持对应权限即放行；项目维度 mission（project_id 非空）另放行
    项目经理。修复审查 BE-P0-1/BE-P1-1：这两类端点原先完全无归属校验。
    """
    from app.modules.auth.rbac import has_permission

    permission = Permission.WORKSPACE_WRITE if write else Permission.TASK_READ
    scope_ids = {mission.workspace_id}
    for sid in mission.scope_workspace_ids or []:
        try:
            scope_ids.add(uuid.UUID(sid))
        except (ValueError, TypeError):
            continue
    for ws_id in scope_ids:
        if await has_permission(session, user=user, permission=permission, workspace_id=ws_id):
            return
    if mission.project_id is not None and await _require_project_manager_or(
        session, user, mission.project_id
    ):
        return
    from app.core.errors import PermissionDenied

    raise PermissionDenied(
        "无权访问该任务组。",
        details={"mission_id": str(mission.id)},
    )


async def _require_project_manager_or(
    session: AsyncSession, user: User, project_id: uuid.UUID
) -> bool:
    """项目经理/超管判定（布尔版，供 _require_mission_access 复用）。"""
    from app.modules.ppm.common.data_scope import is_super_admin, manager_project_ids

    if await is_super_admin(session, user):
        return True
    return project_id in await manager_project_ids(session, user)


def _sanitize_constraints(raw: dict | None) -> dict:
    """剥离 constraints 中的状态机保留键（BE-P2-4，2026-08-21 审查）。

    用户可预置 ``orchestration_mode``（使 finalizer 短路跳过一切 merge，与主
    agent spawn 自相矛盾）、``conflict_attempts``（直接顶满解冲突轮次）、
    ``needs_manual``（伪造人工介入态）等内部键操纵状态机。这些键只允许后端
    按参数化路径写入（team_mission_entry / converge 状态机），创建入口一律剥离。
    """
    reserved = {"orchestration_mode", "conflict_attempts", "needs_manual"}
    return {k: v for k, v in (raw or {}).items() if k not in reserved}


async def _check_scope_bindings(
    session: AsyncSession, scope_workspace_ids: list[uuid.UUID]
) -> list[dict]:
    """预检 scope 内各 workspace 是否至少有一条带 daemon_id 的 member binding。

    返回缺 binding 的 workspace 清单（[{id, name}]），空列表表示全部有 binding。
    不阻断创建（design §7.1）——仅作 warning 清单提示。
    """
    from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
    from app.modules.workspace.model import Workspace

    missing: list[dict] = []
    for ws_id in scope_workspace_ids:
        stmt = select(WorkspaceMemberRuntime).where(
            WorkspaceMemberRuntime.workspace_id == ws_id,
            WorkspaceMemberRuntime.daemon_id.isnot(None),
        )
        binding = (await session.execute(stmt)).first()
        if binding is None:
            ws = await session.get(Workspace, ws_id)
            if ws:
                missing.append({"id": str(ws_id), "name": ws.name})
    return missing


@router.post(
    "/projects/{project_id}/missions",
    response_model=MissionResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_project_mission(
    project_id: uuid.UUID,
    payload: MissionCreateRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.TASK_READ))],
) -> MissionResponse:
    """项目维度创建 mission（design §7.1 / FR-04）。

    鉴权：项目经理或超管（非项目经理 403）。
    校验：scope_workspace_ids ⊆ ppm_project_workspace(project_id)（越界 422）；
          anchor_workspace_id ∈ scope（越界 422）；
          scope 必填 ≥1 去重（项目维度入口强制）。
    预检：scope 内各 ws 至少一条 binding 带 daemon_id（缺的报清单，不阻断）。
    行为：mode 强制 team；project_id 落列；调 team_mission_entry 传 scope。
    anchor 缺省：scope 第一个或 type=backend 优先。
    """
    # 鉴权：项目经理或超管
    await _require_project_manager(session, user, project_id)

    # 校验 scope_workspace_ids 必填 ≥1
    scope_ids = getattr(payload, "scope_workspace_ids", None)
    if not scope_ids or len(scope_ids) == 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="项目维度创建 mission 必须指定 scope_workspace_ids（至少一个工作区）。",
        )
    # 去重（保持顺序）
    scope_ids = list(dict.fromkeys(scope_ids))

    # 校验 scope ⊆ ppm_project_workspace
    from app.modules.workspace import link_service
    from app.modules.workspace.schema import WorkspaceBrief

    bound_workspaces: list[WorkspaceBrief] = await link_service.list_by_project(
        session, ppm_project_id=project_id
    )
    bound_ids = {w.workspace_id for w in bound_workspaces}
    invalid_ids = set(scope_ids) - bound_ids
    if invalid_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"指定的工作区不在项目关联范围内：{', '.join(str(i) for i in invalid_ids)}",
        )

    # 校验 anchor ∈ scope（若指定）
    anchor_id = getattr(payload, "anchor_workspace_id", None)
    if anchor_id and anchor_id not in scope_ids:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"anchor_workspace_id({anchor_id}) 必须在 scope_workspace_ids 范围内。",
        )

    # anchor 缺省：scope 第一个或 type=backend-code 优先
    if not anchor_id:
        # 按 type=backend-code 优先排序，否则取第一个。
        # 逐字对齐词表真值 WORKSPACE_TYPE_VALUES（workspace/constants.py:20，
        # change 2026-08-18-workspace-role-type）——"backend" 只是旧值归一化的
        # 来源 key（YAML_TYPE_NORMALIZE_MAP），存量数据里已不存在，比对它永不命中。
        backend_ws = next(
            (
                w
                for w in bound_workspaces
                if w.type == "backend-code" and w.workspace_id in scope_ids
            ),
            None,
        )
        anchor_id = backend_ws.workspace_id if backend_ws else scope_ids[0]

    # 预检 binding（不阻断）
    missing_bindings = await _check_scope_bindings(session, scope_ids)
    if missing_bindings:
        log.warning(
            "project_mission_bindings_missing",
            project_id=str(project_id),
            missing=[m["name"] for m in missing_bindings],
        )

    # 构造 constraints：mode 强制 team + project_id 落列。
    # BE-P2-4：先剥保留键（orchestration_mode 由下方参数化路径写入，不信任用户预置）。
    constraints = _sanitize_constraints(payload.constraints)
    constraints["mode"] = "team"  # 项目维度无 single 语义
    if getattr(payload, "session_id", None) is not None:
        constraints["session_id"] = str(payload.session_id)
    if getattr(payload, "orchestration_mode", None) is not None:
        constraints["orchestration_mode"] = payload.orchestration_mode

    orchestration_mode = payload.orchestration_mode or "team"
    orchestrator = OrchestratorService(session)

    mission, _main_run = await orchestrator.team_mission_entry(
        workspace_id=anchor_id,  # anchor 作为主 agent 运行所在 workspace
        objective=payload.objective,
        created_by=user.id,
        change_id=payload.change_id,
        constraints=constraints,
        budget_usd=payload.budget_usd,
        worker_preset=payload.worker_preset,
        main_agent_config=payload.main_agent_config,
        orchestration_mode=orchestration_mode,
        scope_workspace_ids=scope_ids,
        project_id=project_id,  # 落 project_id 列
    )

    ctrl = MissionControlService(session)
    fresh = await ctrl.worker_runs(mission.id)
    cost = MissionControlService.cost_from_runs(fresh)
    arts = await _load_mission_artifacts(session, mission.id)
    response = _mission_to_response(mission, fresh, cost, arts)

    # 附 binding 缺失 warning（若存在）
    if missing_bindings:
        response.constraints = response.constraints or {}
        response.constraints["missing_bindings"] = missing_bindings

    return response


@router.get(
    "/projects/{project_id}/missions",
    response_model=list[MissionResponse],
)
async def list_project_missions(
    project_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission_any(Permission.TASK_READ))],
    limit: int = Query(20, ge=1),
    offset: int = Query(0, ge=0),
) -> list[MissionResponse]:
    """列出项目下的 mission（按 created_at 倒序，分页，design §7.1 / FR-04）。

    鉴权同 POST（项目经理/超管）。
    返回 MissionResponse 列表（过滤 mission.project_id == project_id），复用
    _mission_to_response 并扩展 workspace_name / workspace_type / scope 概要字段。
    """
    # 鉴权：项目经理或超管
    await _require_project_manager(session, user, project_id)

    stmt = (
        select(AgentMission)
        .where(AgentMission.project_id == project_id)
        .order_by(AgentMission.created_at.desc())
        .limit(min(limit, 50))
        .offset(offset)
    )
    missions = (await session.execute(stmt)).scalars().all()
    if not missions:
        return []

    mission_ids = [m.id for m in missions]
    all_runs = (
        (await session.execute(select(AgentRun).where(AgentRun.mission_id.in_(mission_ids))))
        .scalars()
        .all()
    )
    runs_by_mission: dict[uuid.UUID, list[AgentRun]] = {}
    cost_by_mission: dict[uuid.UUID, float] = {}
    for r in all_runs:
        mid = r.mission_id
        if mid is None:
            continue
        runs_by_mission.setdefault(mid, []).append(r)
        cost_by_mission[mid] = cost_by_mission.get(mid, 0.0) + (r.total_cost_usd or 0.0)

    arts_by_run: dict[uuid.UUID, list[AgentArtifact]] = {}
    if all_runs:
        art_stmt = (
            select(AgentArtifact)
            .where(AgentArtifact.run_id.in_([r.id for r in all_runs]))
            .order_by(AgentArtifact.created_at)
        )
        for a in (await session.execute(art_stmt)).scalars().all():
            arts_by_run.setdefault(a.run_id, []).append(a)

    # 批量取 workspace name/type（避免 N+1）
    from app.modules.workspace.model import Workspace

    ws_ids = {m.workspace_id for m in missions}
    if missions:
        for m in missions:
            if m.scope_workspace_ids:
                ws_ids.update(uuid.UUID(sid) for sid in m.scope_workspace_ids)
    workspaces = (
        (await session.execute(select(Workspace).where(col(Workspace.id).in_(ws_ids))))
        .scalars()
        .all()
    )
    ws_map: dict[uuid.UUID, Workspace] = {ws.id: ws for ws in workspaces}

    responses: list[MissionResponse] = []
    for m in missions:
        resp = _mission_to_response(
            m,
            runs_by_mission.get(m.id, []),
            cost_by_mission.get(m.id, 0.0),
            arts_by_run,
        )
        # 扩展概要字段（design §7.1）
        anchor_ws = ws_map.get(m.workspace_id)
        if anchor_ws:
            resp.workspace_name = anchor_ws.name
            resp.workspace_type = anchor_ws.type
        responses.append(resp)

    return responses


# Team 主 agent MCP endpoint（2026-07-12-team-main-agent-orchestration task-03 / D-007@v2）：
# 嵌套 include，随 agent_router 一起挂到 /api 前缀。
router.include_router(mcp_tools_router)
