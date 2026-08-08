"""对外 MCP 5 个现有 tool handler（task-06 / design §7.1 前 5 行 / D-001）。

用 FastMCP 注册 5 个与平台内部 ``agent/mcp_tools.py`` 5 endpoint **行为一致**的
tool，业务逻辑零重复——全部直接调现有 service 层：

- ``dispatch_worker``（scope=dispatch）：派一个 worker run（复用
  ``MissionExecutionService.dispatch_worker`` + ``MissionControlService`` 治理门 +
  ``mark_worker_run_failed``）。
- ``get_worker_result``（scope=read）：读单个 worker 的结构化产出（AgentArtifact）。
- ``list_workers``（scope=read）：列 mission 下所有 run 状态。
- ``converge_mission``（scope=converge）：触发 mission 收敛（复用
  ``converge_mission_for_completed_run`` + ``FinalizerService`` + R-07 conflict 计数）。
- ``report_progress``（scope=dispatch）：落主 agent 决策日志（AgentRunLog
  channel=tool_call）。

注册 / 鉴权写法严格对齐 task-04 spike-A 验证版本：

1. **tool 注册**：``@mcp.tool()`` 装饰到 ``mcp_gateway/server.py`` 导出的
   :data:`~app.modules.mcp_gateway.server.mcp` 实例（``from .server import mcp``）。
   tool handler 的第一个参数 ``workspace_id`` **不进 inputSchema**（由 middleware
   从 McpToken 注入，spike 建议 1），mission_id 等业务参数进 inputSchema。
2. **context 读取**：Starlette ``Request`` 在 ``ctx.request_context.request``（spike
   坑 4：``mcp.shared.context.RequestContext.request``，不是
   ``ctx.request_context.state``）。经 ``get_mcp_auth(request)`` 读 task-03 middleware
   注入的 :class:`~app.modules.mcp_gateway.auth.McpAuthContext`，缺失 fail-closed 401。
3. **scope 校验**：每个 handler 入口先 ``require_mcp_scope``，scope 不足抛
   ``PermissionDenied`` → FastMCP 转 MCP error（``Tool.run`` 捕获包装），**不触达
   service 层**。
4. **workspace 隔离**：mission/run 一律按 ``auth.workspace_id`` 过滤，跨 workspace
   的 mission_id 视同 not found（客户端传了不一致的 workspace 也不信，token 绑定为唯一真相源）。
5. **dispatch actor**：``dispatch_worker`` 的 ``user_id`` 用 McpToken 的
   ``created_by``（签发该 token 的 user，CC-05 决议同款；McpToken 无独立 user）。

inputSchema 字段对齐 ``sillyhub-daemon/src/mcp-server.ts`` 现有 5 tool
（``mcp-server.ts:154-312``）保第三方兼容（字段名一致，仅 workspace_id 不暴露）。
返回 dict 由 FastMCP 序列化成 JSON text（与 daemon ``okContent`` 的
``{content:[{type:'text', text: JSON.stringify(payload)}]}`` 对齐，spike-A 实测形态）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from mcp.server.fastmcp import Context
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session_factory
from app.core.errors import AppError, AuthTokenMissing
from app.core.logging import get_logger
from app.modules.agent.control import MissionControlService
from app.modules.agent.execution import MissionExecutionService, mark_worker_run_failed
from app.modules.agent.mission import derive_status
from app.modules.agent.model import AgentArtifact, AgentMission, AgentRun, AgentRunLog
from app.modules.agent.orchestrator import OrchestratorService
from app.modules.agent.profile.model import AgentProfile
from app.modules.agent.profile.service import AgentProfileService
from app.modules.agent.service import _build_agent_profile_snapshot
from app.modules.auth.model import User
from app.modules.daemon.host_fs import new_host_fs_delegate
from app.modules.daemon.host_fs.delegate import HostFsDelegateUnavailable
from app.modules.mcp_gateway.auth import (
    MCP_SCOPE_CONVERGE,
    MCP_SCOPE_DISPATCH,
    MCP_SCOPE_READ,
    McpAuthContext,
    get_mcp_auth,
    require_mcp_scope,
)
from app.modules.mcp_gateway.model import McpTokenORM
from app.modules.mcp_gateway.server import mcp
from app.modules.workspace.model import Workspace

log = get_logger(__name__)

# worker run 的 role 默认（worker_preset 条目缺 role 时兜底，对齐 mcp_tools.py:47）。
_DEFAULT_WORKER_ROLE = "worker"

# R-07（design §10）：主 agent LLM 解冲突轮次上限。计数 per mission 存
# ``AgentMission.constraints`` JSON（对齐 mcp_tools.py:160-207，design §8「无新列」契约）。
_MAX_CONFLICT_ATTEMPTS_DEFAULT = 3
_CONFLICT_ATTEMPTS_KEY = "conflict_attempts"
_NEEDS_MANUAL_KEY = "needs_manual"


# ── context / 鉴权 helpers ───────────────────────────────────────────────────


def _auth_from_ctx(ctx: Context | None) -> McpAuthContext:
    """从 FastMCP tool context 读 task-03 middleware 注入的 :class:`McpAuthContext`。

    spike-A 坑 4：Starlette ``Request`` 在 ``ctx.request_context.request``
    （``mcp.shared.context.RequestContext.request``），不是
    ``ctx.request_context.state``。缺上下文（middleware 未挂 / 直调未传）fail-closed
    抛 401。
    """
    if ctx is None:
        raise AuthTokenMissing(
            "MCP auth context missing: tool called without a Context.",
            details={"hint": "Tool handlers require a Context injected by the MCP server."},
        )
    request = ctx.request_context.request
    if request is None:
        raise AuthTokenMissing(
            "MCP auth context missing: no HTTP request attached to the tool call.",
            details={"hint": "McpAuthMiddleware must be mounted on the /mcp ASGI app."},
        )
    return get_mcp_auth(request)


async def _resolve_actor_user_id(session: AsyncSession, auth: McpAuthContext) -> uuid.UUID:
    """``dispatch_worker`` 的派发 actor：McpToken 的 ``created_by``（CC-05 决议同款）。

    ``MissionExecutionService.dispatch_worker`` 需要 ``user_id`` 走 per-member
    daemon binding（``WorkspaceMemberRuntime``）解析目标 runtime；McpToken 无独立
    user（design §8.1），actor 用签发该 token 的 user。creator 被删（SET NULL）则
    无法派发，抛 400 明确报错（不误导成 daemon 离线 / 静默 failed）。
    """
    token = await session.get(McpTokenORM, auth.token_id)
    if token is None or token.created_by is None:
        raise AppError(
            "MCP token has no creator user to act as the dispatch actor.",
            code="MCP_400_MCP_TOKEN_NO_CREATOR",
            http_status=400,
            details={"token_id": str(auth.token_id)},
        )
    return token.created_by


async def _resolve_actor_user(session: AsyncSession, auth: McpAuthContext) -> User:
    """``list_agent_profiles`` 的可见性 actor：``McpToken.created_by`` 对应的 User 行。

    ``AgentProfileService.list`` 需要 :class:`User` 实体（判 private owner + workspace
    成员），不是裸 UUID。与 :func:`_resolve_actor_user_id` 同根（CC-05：actor=签发该
    token 的 user），但额外 load User 行；creator 行被物理删（罕见，SET NULL 之外）则
    无法判定可见性，抛 400 明确报错而非静默返空列表误导第三方。
    """
    user_id = await _resolve_actor_user_id(session, auth)
    user = await session.get(User, user_id)
    if user is None:
        raise AppError(
            "MCP token creator user no longer exists.",
            code="MCP_400_MCP_TOKEN_CREATOR_GONE",
            http_status=400,
            details={"token_id": str(auth.token_id)},
        )
    return user


async def _get_mission(
    session: AsyncSession, workspace_id: uuid.UUID, mission_id: uuid.UUID
) -> AgentMission:
    """取 mission 并校验属于该 workspace（与 mcp_tools.py:145 同语义，MCP error 形态）。"""
    mission = await session.get(AgentMission, mission_id)
    if mission is None or mission.workspace_id != workspace_id:
        raise AppError(
            "mission not found",
            code="MCP_404_MISSION_NOT_FOUND",
            http_status=404,
            details={"mission_id": str(mission_id)},
        )
    return mission


async def _get_main_run(session: AsyncSession, mission_id: uuid.UUID) -> AgentRun:
    """取 mission 的主 agent run（role=orchestrator），对齐 mcp_tools.py:277。"""
    stmt = (
        select(AgentRun)
        .where(AgentRun.mission_id == mission_id, AgentRun.role == "orchestrator")
        .order_by(AgentRun.created_at)
        .limit(1)
    )
    run = (await session.execute(stmt)).scalars().first()
    if run is None:
        raise AppError(
            "orchestrator run not found",
            code="MCP_404_ORCHESTRATOR_RUN_NOT_FOUND",
            http_status=404,
            details={"mission_id": str(mission_id)},
        )
    return run


async def _resolve_dispatch_profile_mcp(
    session: AsyncSession,
    mission: AgentMission,
    profile_id: uuid.UUID | None,
    actor: User,
) -> AgentProfile | None:
    """对外 MCP 版 dispatch 绑 profile（FR-04，对齐 mcp_tools.py::_resolve_dispatch_agent_profile）。

    语义与内部 HTTP endpoint 完全一致，仅错误形态是 MCP ``AppError``（非 HTTPException）：
    ``profile_id`` 为 None → 返 None 走兜底链；非空时经 ``AgentProfileService.get``
    （自带三级 visibility）取 profile，不存在/不可见统一转 400；再断言 workspace 级
    profile 须 ``workspace_id == mission.workspace_id``（private/platform 放行），跨
    workspace 返 400。校验通过返回 profile，由调用方冻结快照落 run。
    """
    if profile_id is None:
        return None

    from app.modules.agent.profile.model import AgentProfileVisibility
    from app.modules.agent.profile.service import (
        AgentProfileNotFound,
        AgentProfilePermissionDenied,
    )

    svc = AgentProfileService(session)
    try:
        profile = await svc.get(profile_id=profile_id, actor=actor)
    except (AgentProfileNotFound, AgentProfilePermissionDenied) as exc:
        raise AppError(
            f"agent_profile_id 不可用：{exc.message}",
            code="MCP_400_AGENT_PROFILE_UNAVAILABLE",
            http_status=400,
            details={"agent_profile_id": str(profile_id)},
        ) from exc

    if (
        profile.visibility == AgentProfileVisibility.WORKSPACE.value
        and profile.workspace_id != mission.workspace_id
    ):
        raise AppError(
            "agent_profile_id 属于其它 workspace，不能用于本 mission",
            code="MCP_400_AGENT_PROFILE_WORKSPACE_MISMATCH",
            http_status=400,
            details={"agent_profile_id": str(profile_id)},
        )
    return profile


# ── converge 可重入状态机 helpers（对齐 mcp_tools.py:155-288，R-07 conflict 计数）────


def _max_conflict_attempts() -> int:
    """读 R-07 上限（默认 3，env ``CONVERGE_MAX_CONFLICT_ATTEMPTS`` 可覆盖）。"""
    import os

    raw = os.environ.get("CONVERGE_MAX_CONFLICT_ATTEMPTS")
    if raw is None:
        return _MAX_CONFLICT_ATTEMPTS_DEFAULT
    try:
        n = int(raw)
    except ValueError:
        return _MAX_CONFLICT_ATTEMPTS_DEFAULT
    return n if n > 0 else _MAX_CONFLICT_ATTEMPTS_DEFAULT


def _read_conflict_attempts(mission: AgentMission) -> int:
    """从 mission.constraints JSON 读当前解冲突轮次（默认 0）。"""
    raw = mission.constraints or {}
    if not isinstance(raw, dict):
        return 0
    val = raw.get(_CONFLICT_ATTEMPTS_KEY)
    if isinstance(val, bool):  # bool 是 int 子类，先挡（True!=1 语义）
        return 0
    if isinstance(val, int):
        return val
    return 0


async def _bump_conflict_attempts(mission: AgentMission) -> int:
    """mission 解冲突轮次 +1 并落库（返回自增后的值）。"""
    attempts = _read_conflict_attempts(mission) + 1
    raw = mission.constraints or {}
    new_constraints = {**(raw if isinstance(raw, dict) else {}), _CONFLICT_ATTEMPTS_KEY: attempts}
    mission.constraints = new_constraints
    return attempts


async def _mark_mission_needs_manual(
    session: AsyncSession, mission: AgentMission, reason: str
) -> None:
    """R-07 超限标 mission needs_manual（对齐 mcp_tools.py:210，不做 git merge --abort）。"""
    raw = mission.constraints or {}
    new_constraints = {
        **(raw if isinstance(raw, dict) else {}),
        _NEEDS_MANUAL_KEY: {"reason": reason},
    }
    mission.constraints = new_constraints
    await session.commit()
    await session.refresh(mission)
    log.warning(
        "converge_mission_needs_manual",
        mission_id=str(mission.id),
        reason=reason,
    )


async def _finalize_merge_for_mission(
    session: AsyncSession, mission_id: uuid.UUID
) -> tuple[list[str], list[dict]]:
    """读 mission 当前 merge 结果（merged_branches / pending_conflicts）。

    复用 ``FinalizerService.finalize_execute_mission``（对齐 mcp_tools.py:236），
    已 merged 分支 git 视 already-up-to-date 幂等返 ok=True。生产由 task-08 注入
    host_fs_delegate。
    """
    from app.modules.agent.finalizer import FinalizerService

    finalizer = FinalizerService(session, host_fs_delegate=new_host_fs_delegate(session))
    result = await finalizer.finalize_execute_mission(mission_id)
    return result.merged_branches, result.pending_conflicts


async def _cleanup_mission(session: AsyncSession, mission_id: uuid.UUID) -> None:
    """合并成功后清 worker 副本（对齐 mcp_tools.py:259，task-07 cleanup_mission）。"""
    from app.modules.agent.finalizer import FinalizerService

    finalizer = FinalizerService(session, host_fs_delegate=new_host_fs_delegate(session))
    cleanup = getattr(finalizer, "cleanup_mission", None)
    if cleanup is None:
        log.info("converge_mission_cleanup_not_yet_wired_skip", mission_id=str(mission_id))
        return
    await cleanup(mission_id)


async def _latest_artifact_id(session: AsyncSession, mission_id: uuid.UUID) -> uuid.UUID | None:
    """取 mission 下最新 AgentArtifact id（对齐 mcp_tools.py:555）。"""
    stmt = (
        select(AgentArtifact)
        .join(AgentRun, AgentArtifact.run_id == AgentRun.id)
        .where(AgentRun.mission_id == mission_id)
        .order_by(AgentArtifact.created_at.desc())
        .limit(1)
    )
    art = (await session.execute(stmt)).scalars().first()
    return art.id if art else None


# ── 5 个现有 tool（@mcp.tool() 注册，inputSchema 对齐 mcp-server.ts）─────────────


@mcp.tool()
async def dispatch_worker(
    mission_id: uuid.UUID,
    objective: str,
    role: str | None = None,
    agent_type: str | None = None,
    model: str | None = None,
    read_only: bool = False,
    agent_profile_id: uuid.UUID | None = None,
    # task-04（2026-08-08-dispatch-worker-caller-worktree，链路B / 路径A）：caller
    # （SillySpec）提供自己的 worktree 派 worker，三参默认 None 走原 team 模式自建
    # worktree 逻辑（design §7.3 / §9 零回归）。字段名 branch 对齐跨仓契约（D-009）。
    worktree_path: str | None = None,
    branch: str | None = None,
    worker_prompt: str | None = None,
    ctx: Context | None = None,
) -> dict:
    """派一个 worker run（需要 dispatch scope）。

    建 AgentRun(status=pending, role 从入参或默认 worker) + 治理门
    （``MissionControlService.can_dispatch_worker``，取消/并发上限/预算，拒绝标
    killed）+ ``MissionExecutionService.dispatch_worker`` 派 daemon lease。daemon
    离线 / worktree 建不起来时 run 标 failed（``error_code`` 可读原因），不抛。
    返回 ``{id, role, objective, status, agent_type, lease_id, error_code}``，
    行为与 ``agent/mcp_tools.py`` ``POST dispatch_worker`` endpoint 一致。

    ``read_only`` 落 ``run.read_only`` 审计列并经 worker_tool_config 物制
    （--allowedTools Read,Glob,Grep）；``agent_profile_id``（可选）绑 AgentProfile
    并冻结 snapshot（FR-04，对齐内部 endpoint，visibility + workspace 归属校验，
    不可用/跨 workspace 返 400）。``workspace_id`` 由 middleware 从 McpToken 注入。

    task-04 路径A 三参（design §7.3，默认 None → team 模式字节不变）：
    ``worktree_path`` caller 自带 worktree 绝对路径（非空 → execution 跳过
    git_worktree_add，作 daemon root_path）；``branch`` caller worktree 分支
    （如 ``sillyspec/<change>``，仅入 lease metadata，**不落 run.worktree_branch**
    防 finalize 误 merge，D-008）；``worker_prompt`` 覆写 worker prompt（含
    "不 commit / 不越界"指令，非空 → 替代 render_worker_prompt）。
    """
    auth = _auth_from_ctx(ctx)
    require_mcp_scope(auth, MCP_SCOPE_DISPATCH)

    async with get_session_factory()() as session:
        mission = await _get_mission(session, auth.workspace_id, mission_id)
        # FR-04：可选绑 AgentProfile（visibility + workspace 归属校验，actor=token.created_by）。
        actor = await _resolve_actor_user(session, auth)
        profile = await _resolve_dispatch_profile_mcp(session, mission, agent_profile_id, actor)
        run = AgentRun(
            mission_id=mission.id,
            change_id=mission.change_id,
            agent_type=agent_type or "claude_code",
            provider=None,
            model=model,
            status="pending",
            role=role or _DEFAULT_WORKER_ROLE,
            objective=objective,
            # FR-06：read_only 落审计列（物制经 worker_tool_config 单腿强制，
            # 此处补审计展示缺口）。
            read_only=read_only,
            # FR-04：绑 profile + 冻结快照（复用 _build_agent_profile_snapshot 含 version）。
            agent_profile_id=(profile.id if profile is not None else None),
            agent_profile_snapshot=(
                _build_agent_profile_snapshot(profile) if profile is not None else None
            ),
        )
        session.add(run)
        await session.commit()
        await session.refresh(run)

        # 治理门（与 create_mission / mcp_tools 一致，control.can_dispatch_worker）。
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
            return {
                "id": str(run.id),
                "role": run.role,
                "objective": run.objective,
                "status": run.status,
                "agent_type": run.agent_type,
                "lease_id": None,
                "error_code": run.error_code,
            }

        exec_svc = MissionExecutionService(session, host_fs_delegate=new_host_fs_delegate(session))
        try:
            await exec_svc.dispatch_worker(
                run,
                workspace_id=auth.workspace_id,
                user_id=await _resolve_actor_user_id(session, auth),
                read_only=read_only,
                # task-04 路径A 透传（design §7.3）：caller worktree 三参，默认 None
                # → execution 走原 team 模式自建 worktree 逻辑（§9 零回归）。
                worktree_path=worktree_path,
                branch=branch,
                worker_prompt=worker_prompt,
            )
        except HostFsDelegateUnavailable:
            # delegate wiring 错误（workspace 无 bound daemon）fail-loud（对齐
            # mcp_tools.py:361-366），不吞——MCP 客户端收到明确错误知道是 binding 问题。
            raise
        except Exception as exc:
            await mark_worker_run_failed(
                session, run, error_code="dispatch_exception", message=str(exc)
            )
            log.warning(
                "mcp_dispatch_worker_exception",
                mission_id=str(mission.id),
                run_id=str(run.id),
                error=str(exc),
            )
        await session.commit()
        await session.refresh(run)
        return {
            "id": str(run.id),
            "role": run.role,
            "objective": run.objective,
            "status": run.status,
            "agent_type": run.agent_type,
            "lease_id": str(run.lease_id) if run.lease_id else None,
            "error_code": run.error_code,
        }


@mcp.tool()
async def get_worker_result(
    mission_id: uuid.UUID,
    worker_id: uuid.UUID,
    ctx: Context | None = None,
) -> dict:
    """读单个 worker 的结构化产出（需要 read scope）。

    返回 ``{worker_id, status, artifacts:[{kind, content_ref, id}]}``（AgentArtifact
    kind=patch/summary/...），行为与 ``agent/mcp_tools.py``
    ``GET workers/{worker_id}/result`` endpoint 一致。worker 不属于该 mission → 404。
    """
    auth = _auth_from_ctx(ctx)
    require_mcp_scope(auth, MCP_SCOPE_READ)

    async with get_session_factory()() as session:
        await _get_mission(session, auth.workspace_id, mission_id)
        run = await session.get(AgentRun, worker_id)
        if run is None or run.mission_id != mission_id:
            raise AppError(
                "worker run not found",
                code="MCP_404_WORKER_RUN_NOT_FOUND",
                http_status=404,
                details={"worker_id": str(worker_id), "mission_id": str(mission_id)},
            )
        stmt = (
            select(AgentArtifact)
            .where(AgentArtifact.run_id == worker_id)
            .order_by(AgentArtifact.created_at)
        )
        arts = list((await session.execute(stmt)).scalars().all())
        return {
            "worker_id": str(worker_id),
            "status": run.status,
            "artifacts": [
                {"kind": a.kind, "content_ref": a.content_ref, "id": str(a.id)} for a in arts
            ],
        }


@mcp.tool()
async def list_workers(
    mission_id: uuid.UUID,
    ctx: Context | None = None,
) -> dict:
    """列 mission 下所有 worker runs 状态（需要 read scope，含主 agent run）。

    返回 ``{mission_id, workers:[{id, role, status, objective, total_cost_usd}]}``，
    行为与 ``agent/mcp_tools.py`` ``GET workers`` endpoint 一致。
    """
    auth = _auth_from_ctx(ctx)
    require_mcp_scope(auth, MCP_SCOPE_READ)

    async with get_session_factory()() as session:
        await _get_mission(session, auth.workspace_id, mission_id)
        stmt = (
            select(AgentRun).where(AgentRun.mission_id == mission_id).order_by(AgentRun.created_at)
        )
        runs = list((await session.execute(stmt)).scalars().all())
        return {
            "mission_id": str(mission_id),
            "workers": [
                {
                    "id": str(r.id),
                    "role": r.role,
                    "status": r.status,
                    "objective": r.objective,
                    "total_cost_usd": r.total_cost_usd,
                }
                for r in runs
            ],
        }


@mcp.tool()
async def converge_mission(
    mission_id: uuid.UUID,
    ctx: Context | None = None,
) -> dict:
    """触发 mission 收敛（需要 converge scope）。

    可重入状态机（与 ``agent/mcp_tools.py`` ``POST converge`` endpoint 行为一致，
    design §5.2 / §7.5）：调 ``converge_mission_for_completed_run`` 回灌 artifact +
    ``FinalizerService`` 逐个 git merge → 有冲突返 ``status=conflict`` + conflicts 给
    主 agent 解决后重入；全 merged 返 ``status=merged`` + 清 worker 副本；R-07 超限
    标 ``needs_manual`` 返 ``status=failed_manual``；bootstrap mission（无 merge 需求）
    走既有 done/degraded 收敛语义。返回
    ``{mission_id, status, converged, artifact_id, merged_branches, conflicts, attempt}``。
    """
    auth = _auth_from_ctx(ctx)
    require_mcp_scope(auth, MCP_SCOPE_CONVERGE)

    async with get_session_factory()() as session:
        mission = await _get_mission(session, auth.workspace_id, mission_id)
        main_run = await _get_main_run(session, mission.id)

        from app.modules.agent.delegation import GLMConfig
        from app.modules.agent.finalizer import converge_mission_for_completed_run

        cfg = GLMConfig.from_env()
        result_status = await converge_mission_for_completed_run(session, main_run.id, cfg)
        base_converged = result_status in ("done", "degraded")

        # converge_mission_for_completed_run 内部已 commit；补 flush 保证后续读取一致。
        await session.flush()

        merged_branches, pending_conflicts = await _finalize_merge_for_mission(session, mission.id)

        # --- bootstrap 路径（无 worker_branch 合并需求）→ 既有语义，不进 conflict 状态机 ---
        if not merged_branches and not pending_conflicts:
            artifact_id = await _latest_artifact_id(session, mission.id) if base_converged else None
            return {
                "mission_id": str(mission.id),
                "status": result_status or "running",
                "converged": base_converged,
                "artifact_id": str(artifact_id) if artifact_id else None,
                "merged_branches": [],
                "conflicts": [],
                "attempt": _read_conflict_attempts(mission),
            }

        # --- execute 路径（有 merge 需求）→ 可重入 conflict 状态机（design §5.2）---
        if pending_conflicts:
            current_attempts = _read_conflict_attempts(mission)
            if current_attempts + 1 > _max_conflict_attempts():
                await _mark_mission_needs_manual(session, mission, reason="R-07 解冲突轮次超限")
                return {
                    "mission_id": str(mission.id),
                    "status": "failed_manual",
                    "converged": False,
                    "artifact_id": None,
                    "merged_branches": merged_branches,
                    "conflicts": pending_conflicts,
                    "attempt": current_attempts,
                }
            new_attempt = await _bump_conflict_attempts(mission)
            await session.commit()
            await session.refresh(mission)
            log.info(
                "converge_mission_conflict_return",
                mission_id=str(mission.id),
                attempt=new_attempt,
                conflict_count=len(pending_conflicts),
            )
            return {
                "mission_id": str(mission.id),
                "status": "conflict",
                "converged": False,
                "artifact_id": None,
                "merged_branches": merged_branches,
                "conflicts": pending_conflicts,
                "attempt": new_attempt,
            }

        # --- 全 merged 成功（pending_conflicts 空 + 有 merged_branches）→ cleanup + merged ---
        await _cleanup_mission(session, mission.id)
        artifact_id = await _latest_artifact_id(session, mission.id)
        log.info(
            "converge_mission_merged",
            mission_id=str(mission.id),
            merged_branches=len(merged_branches),
            attempt=_read_conflict_attempts(mission),
        )
        return {
            "mission_id": str(mission.id),
            "status": "merged",
            "converged": True,
            "artifact_id": str(artifact_id) if artifact_id else None,
            "merged_branches": merged_branches,
            "conflicts": [],
            "attempt": _read_conflict_attempts(mission),
        }


@mcp.tool()
async def report_progress(
    mission_id: uuid.UUID,
    run_id: uuid.UUID,
    message: str,
    decision: str | None = None,
    ctx: Context | None = None,
) -> dict:
    """落主 agent 决策日志（需要 dispatch scope）。

    写 AgentRunLog（channel=tool_call, tool_kind=other），``decision`` 拼到 content
    前缀便于筛选。返回 ``{run_id, log_id}``，行为与 ``agent/mcp_tools.py``
    ``POST progress`` endpoint 一致。run 不属于该 mission → 404。
    """
    auth = _auth_from_ctx(ctx)
    require_mcp_scope(auth, MCP_SCOPE_DISPATCH)

    async with get_session_factory()() as session:
        await _get_mission(session, auth.workspace_id, mission_id)
        run = await session.get(AgentRun, run_id)
        if run is None or run.mission_id != mission_id:
            raise AppError(
                "run not found in mission",
                code="MCP_404_RUN_NOT_FOUND",
                http_status=404,
                details={"run_id": str(run_id), "mission_id": str(mission_id)},
            )
        content = message
        if decision:
            content = f"[{decision}] {message}"
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
        return {"run_id": str(run.id), "log_id": str(log_entry.id)}


# ── task-14 新增 3 tool（列 profile / 建 mission / 看日志，design §7.1 后 3 行）────


def _profile_tools_summary(profile: AgentProfile) -> dict:
    """把 profile 的工具能力字段压成第三方可读的摘要（design §7.1 ``tools_summary``）。

    AgentProfile 管工具能力的字段是 ``tool_policy_id`` / ``mcp_refs`` / ``skill_refs``
    （model.py:111-129），没有字面 ``tools`` 列——摘要把三者透出供第三方选 agent 时
    判断能力面。不读写任何密钥（agent 层红线，design §10）。
    """
    return {
        "tool_policy_id": str(profile.tool_policy_id) if profile.tool_policy_id else None,
        "mcp_refs": list(profile.mcp_refs or []),
        "skill_refs": list(profile.skill_refs or []),
    }


def _profile_description(profile: AgentProfile) -> str | None:
    """profile 无独立 ``description`` 列（model.py），用 system_prompt 首行截断充当。

    第三方据此快速理解 agent 人格/用途；system_prompt 为空则 None。截 200 字符防爆量。
    """
    prompt = (profile.system_prompt or "").strip()
    if not prompt:
        return None
    first_line = prompt.splitlines()[0].strip()
    return first_line[:200]


@mcp.tool()
async def list_agent_profiles(
    ctx: Context | None = None,
) -> dict:
    """列当前 workspace 可见的 agent 档案（需要 read scope）。

    复用 ``AgentProfileService.list``（``profile/router.py:list_workspace_profiles``
    同款清单逻辑）：actor=签发该 token 的 user（``McpToken.created_by``，CC-05 决议
    同款——McpToken 无独立 user），workspace=token 绑定的 workspace。可见集合 =
    platform 全档 ∪ 该 ws 的 workspace 级档（actor 是成员）∪ actor 自己的 private 档。

    返回 ``{profiles:[{id, name, description, provider, model, tools_summary}]}``
    （design §7.1）。``workspace_id`` 由 middleware 从 McpToken 注入，不进 inputSchema。
    """
    auth = _auth_from_ctx(ctx)
    require_mcp_scope(auth, MCP_SCOPE_READ)

    async with get_session_factory()() as session:
        workspace = await session.get(Workspace, auth.workspace_id)
        if workspace is None:
            raise AppError(
                "workspace not found",
                code="MCP_404_WORKSPACE_NOT_FOUND",
                http_status=404,
                details={"workspace_id": str(auth.workspace_id)},
            )
        # actor=token.created_by 对应 user；creator 被删（SET NULL）则退化为匿名 actor，
        # 仍可见 platform 全档（不返 4xx，列表是只读探测面）。
        actor = await _resolve_actor_user(session, auth)
        profiles = await AgentProfileService(session).list(actor=actor, workspace=workspace)
        return {
            "profiles": [
                {
                    "id": str(p.id),
                    "name": p.name,
                    "description": _profile_description(p),
                    "provider": p.provider,
                    "model": p.model,
                    "tools_summary": _profile_tools_summary(p),
                }
                for p in profiles
            ],
        }


@mcp.tool()
async def create_mission(
    objective: str,
    worker_preset: list[dict] | None = None,
    main_agent_config: dict | None = None,
    budget_usd: float | None = None,
    change_id: uuid.UUID | None = None,
    # task-04（2026-08-08-dispatch-worker-caller-worktree，链路B / 路径A）：
    # orchestration_mode="external" → team_mission_entry 跳过 orchestrator spawn
    # （mission 由外部 caller SillySpec 自己 dispatch_worker 调度）。默认 "team"
    # 零回归（design §7.1 / D-007 / §9）。
    orchestration_mode: str = "team",
    ctx: Context | None = None,
) -> dict:
    """建一个 team / external mission（需要 dispatch scope）。

    复用 ``OrchestratorService.team_mission_entry``：``orchestration_mode="team"``
    （默认，D-004 忍一个闲置主 agent run）→ 建 AgentMission + 主 agent run
    （role=orchestrator）+ 派 daemon lease；``orchestration_mode="external"``（路径A，
    SillySpec 外部调度）→ 跳过 orchestrator spawn，返回 ``main_run=None``，mission 由
    caller 后续 ``dispatch_worker`` 派 worker（design §7.1 / D-007）。daemon 离线 /
    workspace 未绑定时主 agent run 标 ``pending`` + ``error_code``，不抛（mission 仍建，
    后续靠 reconcile 重派）。

    **CC-05 / G-4 决议**：McpToken 无独立 user，``created_by`` 用 ``token.created_by``
    （签发该 token 的 user，最小改动、可审计），不传 None。creator 被删（SET NULL）→
    400 明确报错（同 ``_resolve_actor_user_id`` 语义）。

    返回 ``{mission_id, status, main_run_id, workers}``（design §7.1）。team 模式
    ``workers`` 即主 agent run 单条，第三方据此拿到 run_id 调 get_run_logs /
    dispatch_worker；external 模式 ``main_run_id=null`` / ``workers=[]``（无 main_run，
    待 caller 派 worker）。``workspace_id`` 由 middleware 注入，不进 inputSchema。
    """
    auth = _auth_from_ctx(ctx)
    require_mcp_scope(auth, MCP_SCOPE_DISPATCH)

    async with get_session_factory()() as session:
        actor_user_id = await _resolve_actor_user_id(session, auth)
        svc = OrchestratorService(session)
        mission, main_run = await svc.team_mission_entry(
            workspace_id=auth.workspace_id,
            objective=objective,
            created_by=actor_user_id,
            change_id=change_id,
            constraints=None,
            budget_usd=budget_usd,
            worker_preset=worker_preset,
            main_agent_config=main_agent_config,
            # task-04（design §7.1 / D-007）：透传 orchestration_mode；mode 落
            # AgentMission.constraints 由 task-01 在 team_mission_entry 内合并落库。
            orchestration_mode=orchestration_mode,
        )
        # external 模式：team_mission_entry 跳过 orchestrator spawn，返回 main_run=None
        # （design §7.1 / D-007）。external mission 无 main_run / 无 worker，由 caller
        # （SillySpec）后续 dispatch_worker 派；响应 main_run_id=None / workers=[]。
        # 不访问 main_run.id / role 等属性，避免 NoneType 崩。
        if main_run is None:
            return {
                "mission_id": str(mission.id),
                # 无子 run → derive_status 返 "planning"（mission.py:44）。
                "status": derive_status([], cancelled=mission.cancelled_at is not None),
                "main_run_id": None,
                "workers": [],
            }
        return {
            "mission_id": str(mission.id),
            # AgentMission 不持久化 status（派生自子 run，router._mission_to_response 同款），
            # 用 derive_status 算（新建时仅主 agent run 一条，通常 pending）。
            "status": derive_status([main_run], cancelled=mission.cancelled_at is not None),
            "main_run_id": str(main_run.id),
            "workers": [
                {
                    "id": str(main_run.id),
                    "role": main_run.role,
                    "status": main_run.status,
                    "objective": main_run.objective,
                    "error_code": main_run.error_code,
                }
            ],
        }


@mcp.tool()
async def get_run_logs(
    mission_id: uuid.UUID,
    worker_id: uuid.UUID,
    limit: int = 100,
    channel: str | None = None,
    ctx: Context | None = None,
) -> dict:
    """读单个 run 的执行日志（需要 read scope）。

    查 ``AgentRunLog`` by run_id（worker_id 即 run_id，model.py:346），按时间升序，
    ``limit``（默认 100）/ ``channel``（stdout/stderr/tool_call）过滤。run 必须属于该
    mission 且 mission 属于 token 绑定 workspace，否则 404（跨 workspace 视同 not found）。

    返回 ``{logs:[{timestamp, channel, tool_kind, content_redacted}]}``（design §7.1）。
    **CC-09**：返 ``content_redacted`` 不返 ``content``（对齐 model.py:401——AgentRunLog
    只存脱敏后内容，密钥永不外泄）。
    """
    auth = _auth_from_ctx(ctx)
    require_mcp_scope(auth, MCP_SCOPE_READ)

    async with get_session_factory()() as session:
        await _get_mission(session, auth.workspace_id, mission_id)
        run = await session.get(AgentRun, worker_id)
        if run is None or run.mission_id != mission_id:
            raise AppError(
                "worker run not found",
                code="MCP_404_WORKER_RUN_NOT_FOUND",
                http_status=404,
                details={"worker_id": str(worker_id), "mission_id": str(mission_id)},
            )
        stmt = select(AgentRunLog).where(AgentRunLog.run_id == run.id)
        if channel is not None:
            stmt = stmt.where(AgentRunLog.channel == channel)
        stmt = stmt.order_by(AgentRunLog.timestamp).limit(limit)
        logs = list((await session.execute(stmt)).scalars().all())
        return {
            "logs": [
                {
                    "timestamp": entry.timestamp.isoformat(),
                    "channel": entry.channel,
                    "tool_kind": entry.tool_kind,
                    "content_redacted": entry.content_redacted,
                }
                for entry in logs
            ],
        }


__all__ = [
    "converge_mission",
    "create_mission",
    "dispatch_worker",
    "get_run_logs",
    "get_worker_result",
    "list_agent_profiles",
    "list_workers",
    "report_progress",
]
