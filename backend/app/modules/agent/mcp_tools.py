"""Team 主 agent MCP endpoint（2026-07-12-team-main-agent-orchestration D-007@v2）。

主 agent 通过 MCP tool 反向调 backend：派 worker / 读产出 / 列 worker / 收敛 / 报进度。
daemon 侧 MCP server（task-05）转发 tool_call 到这些 endpoint。

路径不与现有 mission endpoint 冲突：均挂在 ``/workspaces/{workspace_id}/missions/
{mission_id}/`` 下，动作子路径（dispatch_worker / workers / converge / progress）与
现有 ``/missions/{mission_id}/cancel``（router.py:811）平级但带 workspace 前缀。

权限（task-09 P0 鉴权 gap 已闭合）：统一 ``WORKSPACE_WRITE``，经
``require_permission`` → ``get_current_principal``（auth_deps.py:154）双路径鉴权——
浏览器/直调走 JWT（``Authorization: Bearer``），daemon MCP server 走长期 API Key
（``X-API-Key``，admin 签发绑 user）。daemon mcp-server.ts 把 apiKey 经
``X-API-Key`` header 发（task-09 修，非 Bearer——apiKey 非 JWT，Bearer 路径只解
JWT 会 401），backend 解析 apiKey → User → ``has_permission(WORKSPACE_WRITE)``
按 workspace 成员关系校验。两条路径都落同一 User 对象，权限模型一致。
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
    """``converge_mission`` tool 返回契约（task-06 改可重入，design §5.2 / §7.5）。

    ``status`` 取值（task-06 起新增可重入三态，保留 task-04 既有收敛态）：
    - ``conflict``：有合并冲突，已把 ``conflicts`` 返给主 agent；主 agent 自己用 SDK
      Read/Write 解决后重入 ``converge_mission``（X-004，backend 不写文件）。
    - ``merged``：全部 worker_branch 合并完成（本次或重入后），已触发 cleanup。
    - ``failed_manual``：解冲突轮次超 R-07 上限，mission 标 needs_manual，副本保留。
    - ``done``/``degraded``/``running``：既有语义（bootstrap 收敛 / 部分终态 / 进行中）。

    ``conflicts`` 形如 ``[{file, marker_lines, branch}]``（FinalizerMergeResult 透传）。
    ``attempt`` 为本次返的解冲突轮次（per mission 计数，存 ``AgentMission.constraints``）。
    """

    mission_id: uuid.UUID
    status: str
    converged: bool
    artifact_id: uuid.UUID | None = None
    merged_branches: list[str] = []
    conflicts: list[dict] = []
    attempt: int = 0


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


# R-07（design §10）：主 agent LLM 解冲突轮次上限。超限 → mission 标 needs_manual，
# 副本保留供排查（X-003）。默认 3 轮（design §5.2 / §10 R-07）；可经 env
# ``CONVERGE_MAX_CONFLICT_ATTEMPTS`` 覆盖。计数 per mission 存 ``AgentMission.constraints``
# JSON 的 ``conflict_attempts`` 键（task-06 决策：复用既有 JSON 列，避免新 migration，
# design §8「无新列」契约）。
_MAX_CONFLICT_ATTEMPTS_DEFAULT = 3
_CONFLICT_ATTEMPTS_KEY = "conflict_attempts"
_NEEDS_MANUAL_KEY = "needs_manual"


def _max_conflict_attempts() -> int:
    """读 R-07 上限（默认 3，env 可覆盖）。抽函数便于单测边界。"""
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
    """从 mission.constraints JSON 读当前解冲突轮次（默认 0）。

    复用既有 ``constraints`` JSON 列存计数（design §8「无新列」契约 + task-06 决策：
    避免为单一计数器加 nullable 列触发 migration 链断裂风险）。mission.constraints
    可能被 mode=team 等语义占用，做防御式 dict merge。
    """
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
    """mission 解冲突轮次 +1 并落库（返回自增后的值）。

    单测里把本函数整个 mock 掉，避免依赖 session。生产落 ``AgentMission.constraints``
    JSON（``merge_dict`` 防御式，保留既有键如 mode/budget）。
    """
    attempts = _read_conflict_attempts(mission) + 1
    raw = mission.constraints or {}
    new_constraints = {**(raw if isinstance(raw, dict) else {}), _CONFLICT_ATTEMPTS_KEY: attempts}
    mission.constraints = new_constraints
    return attempts


async def _mark_mission_needs_manual(
    session: AsyncSession, mission: AgentMission, reason: str
) -> None:
    """R-07 超限标 mission needs_manual（design §9 / §10 R-07）。

    简化（task-06 决策）：不实际 ``git merge --abort``——主 agent SDK 在 workspace root
    上解冲突的工作区状态 backend 不可控（cwd 在 daemon 侧），强行 abort 可能误清主 agent
    已写的解决内容。改为标 needs_manual 让用户/主 agent 手动 ``git merge --abort`` /
    继续；worker 副本保留供排查（X-003，区别于成功路径的立即清理）。reason 落
    ``constraints.needs_manual`` 供前端/审计展示。
    """
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

    task-05 ``converge_mission_for_completed_run`` 内部已调
    ``FinalizerService.finalize_execute_mission`` 做逐个 git_merge，但其返回值只有
    mission status（str），``FinalizerMergeResult`` 未透出到 converge_mission endpoint
    （改其签名会断 orchestrator.py / lease/service.py / dispatch.py 多调用方 + 8 个测试，
    超 allowed_paths）。故 endpoint 侧直接复用 ``FinalizerService`` 重跑
    ``finalize_execute_mission`` 拿契约：已 merged 分支 git 视 already-up-to-date 返
    ok=True（幂等），pending 冲突仍返 ok=False（主 agent 重入前已 git add 解决的内容
    也在工作区，下次 merge --continue/重试 会合进去）。生产由 task-08 注入 host_fs_delegate。

    单测整体 mock 本函数（返回 merged/conflict 混合），隔离 git_merge 依赖。
    """
    from app.modules.agent.finalizer import FinalizerService

    finalizer = FinalizerService(session)
    result = await finalizer.finalize_execute_mission(mission_id)
    return result.merged_branches, result.pending_conflicts


async def _cleanup_mission(session: AsyncSession, mission_id: uuid.UUID) -> None:
    """合并成功后清 worker 副本（task-07 提供 ``finalizer.cleanup_mission``）。

    expects_from task-07：全 merged 成功 → 逐个 git_worktree_remove 清各 worker 副本 +
    采合并 diff 作 patch artifact。task-06 消费方只调一次，失败保留副本（X-003）。
    单测整体 mock 本函数（隔离 task-07 实现）。task-08 集成接线 delegate。
    """
    from app.modules.agent.finalizer import FinalizerService

    finalizer = FinalizerService(session)
    cleanup = getattr(finalizer, "cleanup_mission", None)
    if cleanup is None:
        # task-07 未落地前兜底（expects_from 契约；集成期 task-08 接线后必有）
        log.info("converge_mission_cleanup_not_yet_wired_skip", mission_id=str(mission_id))
        return
    await cleanup(mission_id)


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
    """主 agent 触发 mission 收敛（task-06 改可重入，design §5.2 / §7.5）。

    可重入状态机（per mission，无新列——计数存 ``AgentMission.constraints`` JSON）：

    1. 调 ``converge_mission_for_completed_run``（既有链路，保留 artifact 回灌 +
       derive_status + bootstrap 路由语义；其内部已调 finalize_execute_mission）。
    2. 复用 ``FinalizerService.finalize_execute_mission`` 拿 ``FinalizerMergeResult``
       （merged_branches / pending_conflicts）——见 ``_finalize_merge_for_mission``
       注释（为何不直接改 converge_mission_for_completed_run 返回值）。
    3. ``pending_conflicts`` 非空 → 返 ``status=conflict`` + conflicts 给主 agent；
       主 agent 自己 SDK Read/Write 解决（X-004，backend 不写文件）+ git add 后重入。
    4. 重入：``finalize_execute_mission`` 重跑，已 merged 分支幂等（already-up-to-date），
       主 agent 解决后的内容被下次 git 合进去；全 merged → ``status=merged`` +
       调 ``_cleanup_mission``（task-07 cleanup_mission）清 worker 副本。
    5. R-07：每次返 conflict 时计数 +1（``_bump_conflict_attempts``）；超限（默认 3）
       → ``_mark_mission_needs_manual`` 标 ``needs_manual`` + 返
       ``status=failed_manual``，副本保留供排查（X-003）。

    简化（task-06 决策，见 ``_mark_mission_needs_manual``）：不实际 ``git merge --abort``——
    workspace root 工作区状态在 daemon 侧，backend 不可控，强行 abort 可能误清主 agent 已
    写的解决内容；改为标 needs_manual 让用户/主 agent 手动处理。
    """
    mission = await _get_mission(session, workspace_id, mission_id)
    main_run = await _get_main_run(session, mission.id)

    from app.modules.agent.delegation import GLMConfig
    from app.modules.agent.finalizer import converge_mission_for_completed_run

    cfg = GLMConfig.from_env()
    result_status = await converge_mission_for_completed_run(session, main_run.id, cfg)
    base_converged = result_status in ("done", "degraded")

    # converge_mission_for_completed_run 内部已 commit；补 flush 保证后续读取一致。
    await session.flush()

    # 读 merge 结果（merged_branches / pending_conflicts）。execute mission（有 patch /
    # worktree_branch）走 conflict 状态机；bootstrap mission（无 patch）merge 结果为空
    # → 走既有 done/degraded 收敛语义（artifact_id 取最新 summary）。
    merged_branches, pending_conflicts = await _finalize_merge_for_mission(session, mission.id)

    # --- bootstrap 路径（无 worker_branch 合并需求）→ 既有语义，不进 conflict 状态机 ---
    if not merged_branches and not pending_conflicts:
        artifact_id = await _latest_artifact_id(session, mission.id) if base_converged else None
        return ConvergeResponse(
            mission_id=mission.id,
            status=result_status or "running",
            converged=base_converged,
            artifact_id=artifact_id,
            merged_branches=[],
            conflicts=[],
            attempt=_read_conflict_attempts(mission),
        )

    # --- execute 路径（有 merge 需求）→ 可重入 conflict 状态机（design §5.2）---
    if pending_conflicts:
        # R-07：先判是否已超限（避免超限后仍 +1 漂移）。当前 attempts 是返 conflict 前
        # 的累计值；超限指「即将超过上限」即 attempts+1 > max。
        current_attempts = _read_conflict_attempts(mission)
        if current_attempts + 1 > _max_conflict_attempts():
            await _mark_mission_needs_manual(session, mission, reason="R-07 解冲突轮次超限")
            return ConvergeResponse(
                mission_id=mission.id,
                status="failed_manual",
                converged=False,
                artifact_id=None,
                merged_branches=merged_branches,
                conflicts=pending_conflicts,
                attempt=current_attempts,
            )
        # 未超限 → 计数 +1（落库）+ 返 conflict 给主 agent
        new_attempt = await _bump_conflict_attempts(mission)
        await session.commit()
        await session.refresh(mission)
        log.info(
            "converge_mission_conflict_return",
            mission_id=str(mission.id),
            attempt=new_attempt,
            conflict_count=len(pending_conflicts),
        )
        return ConvergeResponse(
            mission_id=mission.id,
            status="conflict",
            converged=False,
            artifact_id=None,
            merged_branches=merged_branches,
            conflicts=pending_conflicts,
            attempt=new_attempt,
        )

    # --- 全 merged 成功（pending_conflicts 空 + 有 merged_branches）→ cleanup + merged ---
    # 副本清理由 task-07 cleanup_mission 负责（expects_from 契约）；失败保留（X-003）。
    await _cleanup_mission(session, mission.id)
    artifact_id = await _latest_artifact_id(session, mission.id)
    log.info(
        "converge_mission_merged",
        mission_id=str(mission.id),
        merged_branches=len(merged_branches),
        attempt=_read_conflict_attempts(mission),
    )
    return ConvergeResponse(
        mission_id=mission.id,
        status="merged",
        converged=True,
        artifact_id=artifact_id,
        merged_branches=merged_branches,
        conflicts=[],
        attempt=_read_conflict_attempts(mission),
    )


async def _latest_artifact_id(session: AsyncSession, mission_id: uuid.UUID) -> uuid.UUID | None:
    """取 mission 下最新 AgentArtifact id（converge 后供前端跳转）。"""
    stmt = (
        select(AgentArtifact)
        .join(AgentRun, AgentArtifact.run_id == AgentRun.id)
        .where(AgentRun.mission_id == mission_id)
        .order_by(AgentArtifact.created_at.desc())
        .limit(1)
    )
    art = (await session.execute(stmt)).scalars().first()
    return art.id if art else None


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
