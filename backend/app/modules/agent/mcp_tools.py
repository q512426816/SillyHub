"""Team 主 agent MCP endpoint（2026-07-12-team-main-agent-orchestration D-007@v2）。

主 agent 通过 MCP tool 反向调 backend：派 worker / 读产出 / 列 worker / 收敛 / 报进度。
daemon 侧 MCP server（task-05）转发 tool_call 到这些 endpoint。

路径不与现有 mission endpoint 冲突：均挂在 ``/workspaces/{workspace_id}/missions/
{mission_id}/`` 下，动作子路径（dispatch_worker / workers / converge / progress）与
现有 ``/missions/{mission_id}/cancel``（router.py:811）平级但带 workspace 前缀。

task-05（2026-08-22-team-session-unify / design §5 Phase 1 / §7）：新增会话维度
路由族 ``/sessions/{session_id}/missions/...``（5 端点同构）——mission_id/
workspace_id 缺省的调用（daemon mcp-server task-10 参数可选化后）按 X-Session-Id
（header 优先，路径 session_id 兜底）解析会话活跃 mission；dispatch_worker 无
活跃 mission 时懒建兜底。既有 workspace/mission 路径前缀路由零回归。

task-06（2026-08-22-team-session-unify / D-010 / design §5 Phase 1 converge 段）：
converge 语义重定义——分身 run（role!='orchestrator' 含 NULL）未全终态返
``busy`` 引导等待；全终态独立原子置位 ``converged_at``（不依赖主控 run 状态）；
``_get_main_run``/finalizer 锚点取该 mission**最新** orchestrator run；
``ConvergeResponse.status`` 收敛为 converged/busy/conflict/needs_manual 四值。

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

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission, require_permission_any
from app.core.db import get_session
from app.core.logging import get_logger
from app.modules.agent.execution import MissionExecutionService, mark_worker_run_failed
from app.modules.agent.model import (
    AgentArtifact,
    AgentMission,
    AgentRun,
    AgentRunLog,
    AgentSession,
)
from app.modules.agent.service import _build_agent_profile_snapshot
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.daemon.host_fs import new_host_fs_delegate
from app.modules.daemon.host_fs.delegate import HostFsDelegateUnavailable

log = get_logger(__name__)

router = APIRouter(tags=["agent-mcp"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]

# worker run 的 role 默认（worker_preset 条目缺 role 时兜底）
_DEFAULT_WORKER_ROLE = "worker"

# ── task-05（2026-08-22-team-session-unify）：X-Session-Id 会话定位 + 懒建 ──
# 会话维度路由（/sessions/{sid}/missions/...）无 workspace_id 路径锚，鉴权走
# require_permission_any（任意工作区 WORKSPACE_WRITE）+ 解析后按 mission 锚工作区
# 复核（_resolve_session_mission 的 enforce_workspace_permission）。
SessionMcpUser = Annotated[User, Depends(require_permission_any(Permission.WORKSPACE_WRITE))]

# X-Session-Id 请求头（design §5 Phase 2 / §7：daemon MCP server 经
# env MCP_SESSION_ID → hub-client 统一附头；优先级 header > 路径 session_id）。
_SESSION_ID_HEADER = "x-session-id"

# 会话活跃 run 判定口径（与 daemon/router._session_has_active_turn、session/service
# task-04 inject 同源）：懒建成功后按此取会话当前活跃 run 补回填主控轮双标记。
_ACTIVE_RUN_STATUSES = ("pending", "running", "interrupting")

# task-06（D-010）：converge busy 判定的分身 run 终态集合——与 derive_status 的
# _DONE|_FAILED（mission.py）及 finalizer cleanup_mission 的终态过滤同口径
# （pending/running/interrupting 均视为未终态）。
_TERMINAL_RUN_STATUSES = ("completed", "failed", "killed")

# 懒建默认预算上限（design §5 Phase 1 / §10 R-02：防 agent 未被要求时自主派团队
# 失控）。命名对齐 config.py mission_* 家族；本卡 allowed_paths 不含 config.py，
# 故以模块级常量 + env 覆盖落地（同 _max_conflict_attempts 惯例），后续变更可迁
# Settings（mission_lazy_budget_usd）。
_LAZY_MISSION_BUDGET_USD_DEFAULT = 5.0


def _lazy_mission_budget_usd() -> float:
    """读懒建默认预算上限（默认 5.0 USD，env ``TEAM_LAZY_MISSION_BUDGET_USD`` 可覆盖）。"""
    import os

    raw = os.environ.get("TEAM_LAZY_MISSION_BUDGET_USD")
    if raw is None:
        return _LAZY_MISSION_BUDGET_USD_DEFAULT
    try:
        val = float(raw)
    except ValueError:
        return _LAZY_MISSION_BUDGET_USD_DEFAULT
    return val if val > 0 else _LAZY_MISSION_BUDGET_USD_DEFAULT


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
    # task-10（change 2026-08-06-public-mcp-server）：可选绑 AgentProfile。None = 走
    # 兜底链（老调用不传行为不变）；非空时校验可见性 + workspace 归属后冻结快照。
    agent_profile_id: uuid.UUID | None = None
    # task-05（2026-08-08-dispatch-worker-caller-worktree / 路径A，链路A HTTP）：caller
    # （SillySpec）提供自己的 worktree 派 worker，三参默认 None 走原 team 模式自建
    # worktree 逻辑（design §7.3 / §9 零回归）。字段名 branch 对齐跨仓契约 + 链路B
    # （mcp_gateway/tools.py）同构（D-009 / R-06 防漂移）。
    worktree_path: str | None = None
    branch: str | None = None
    worker_prompt: str | None = None
    # task-08（2026-08-19-cross-workspace-team-mission / §7.2 链路A）：
    # 跨工作区派发目标工作区。NULL = anchor workspace（零回归单 ws 模式）；
    # 非 NULL = 指定目标工作区，服务端校验 ∈ scope（含 anchor）。
    target_workspace_id: uuid.UUID | None = None


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
    """``converge_mission`` tool 返回契约（task-06 D-010，design §5 Phase 1 / §7 / §7.5）。

    ``status`` 取值收敛为四值（task-06，design §7；既有 done/degraded/merged 并入
    ``converged``、failed_manual 改 ``needs_manual``）：
    - ``converged``：收敛完成（bootstrap 合并产物 / execute 全分支 merged），
      ``converged_at`` 已置位（不依赖主控 run 状态——分身全终态即置位，D-010）。
    - ``busy``：分身 run（``role!='orchestrator'`` 含 NULL）未全终态——引导主
      agent 等待后重试（mission 状态不变、不置位、不 finalize；message 附引导
      文案与未完成计数）。
    - ``conflict``：有合并冲突，已把 ``conflicts`` 返给主 agent；主 agent 自己用
      SDK Read/Write 解决后重入 ``converge_mission``（X-004，backend 不写文件；
      冲突未解决不算收敛，converged_at 回滚保持会话活跃 mission 可重入）。
    - ``needs_manual``：解冲突轮次超 R-07 上限，mission 标 needs_manual，副本保留
      （原 ``failed_manual`` 改名并入四值契约）。

    防御透传：cancelled/planning 等不可达派生值原样返回（正常流 busy 前置判定已
    挡；planning= 无分身 run 未置位，见 _converge_core）。

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
    # task-06：busy/needs_manual 等状态的引导文案（design §5「分身未全终态返回
    # 引导信息」；主 agent 据 status+message 决定等待/重入）。
    message: str | None = None


class ProgressRequest(BaseModel):
    """主 agent 决策日志（落 AgentRunLog channel=tool_call）。

    task-10 对齐（审查 B1）：``run_id`` 可选——显式传参时透传（越权校验锚）；
    缺省时 backend 按 ``X-Session-Id`` 解析会话当前主控 run（须已双标记到活跃
    mission），无会话上下文且缺 run_id → 400。
    """

    run_id: uuid.UUID | None = None
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
    """取 mission 并校验属于该 workspace（scope 放宽）。

    task-08（2026-08-19-cross-workspace-team-mission / §7.2 链路A）：
    - workspace_id == mission.workspace_id（anchor）→ 放行
    - workspace_id ∈ mission.scope_workspace_ids（scope 包含）→ 放行
    - scope_workspace_ids 为 NULL/缺省时按 [workspace_id] 处理（P2-2，零回归）

    所有 UUID 比较用 str（scope_workspace_ids 是 JSON 列，存 uuid-hex）。
    """
    mission = await session.get(AgentMission, mission_id)
    if mission is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "mission not found")

    # 快速路径：anchor 匹配
    if mission.workspace_id == workspace_id:
        return mission

    # scope 校验：workspace_id ∈ scope_workspace_ids（NULL scope 按 [workspace_id]）
    scope = mission.scope_workspace_ids or [str(mission.workspace_id)]
    ws_hex = str(workspace_id)
    if ws_hex not in scope:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "mission not found")

    return mission


# ---------------------------------------------------------------------------
# task-05（2026-08-22-team-session-unify）：X-Session-Id 会话定位 + 懒建辅助
# design §5 Phase 1 / §7——解析优先级：X-Session-Id header > 路径 session_id >
# 显式 workspace_id/mission_id（显式参数仅作越权校验锚，header 缺席时显式路径
# 行为零回归）。
# ---------------------------------------------------------------------------


def _request_session_id(request: Request, path_session_id: uuid.UUID | None) -> uuid.UUID | None:
    """从请求头解析 X-Session-Id（优先）；header 缺席回落路径 session_id。

    header 非法（非 UUID）→ 400；header 与路径 session_id 同时存在且不一致 → 400
    （防歧义——两者应同源自 daemon env MCP_SESSION_ID）。
    """
    raw = request.headers.get(_SESSION_ID_HEADER)
    if not raw:
        return path_session_id
    try:
        header_sid = uuid.UUID(raw)
    except ValueError:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "X-Session-Id 无效：需要 UUID 形式的会话 id",
        ) from None
    if path_session_id is not None and header_sid != path_session_id:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "X-Session-Id 与路径 session_id 不一致",
        )
    return header_sid


async def _backfill_orchestrator_run(
    session: AsyncSession, session_id: uuid.UUID, mission: AgentMission
) -> bool:
    """懒建成功后补回填会话当前活跃 run 的主控轮双标记（Grill NEW-1 / D-009）。

    与 task-04 inject 双标记同语义：把会话当前活跃（pending/running/interrupting）
    run 回填 ``mission_id + role='orchestrator'``，保证懒建 mission 也有主控轮锚点
    （task-06 converge/_get_main_run、task-08 patrol 消费）。仅回填 ``mission_id``
    仍为 NULL 的最新一条活跃 run（已标记/分身 run 不动）；无活跃 run（如 dispatch
    发生在 turn 间隙）静默跳过，下一轮 inject 由 task-04 正常标记。
    """
    stmt = (
        select(AgentRun)
        .where(
            AgentRun.agent_session_id == session_id,
            AgentRun.status.in_(_ACTIVE_RUN_STATUSES),
            AgentRun.mission_id.is_(None),
        )
        .order_by(AgentRun.created_at.desc())
        .limit(1)
    )
    run = (await session.execute(stmt)).scalars().first()
    if run is None:
        return False
    run.mission_id = mission.id
    run.role = "orchestrator"
    session.add(run)
    await session.commit()
    log.info(
        "lazy_mission_orchestrator_backfilled",
        session_id=str(session_id),
        mission_id=str(mission.id),
        run_id=str(run.id),
    )
    return True


async def _check_workspace_write(
    session: AsyncSession, user: User, workspace_id: uuid.UUID
) -> None:
    """按 workspace 复核 WORKSPACE_WRITE（无 workspace 路径锚的路由族用，403 拒绝）。"""
    from app.modules.auth.rbac import has_permission

    if not await has_permission(
        session,
        user=user,
        permission=Permission.WORKSPACE_WRITE,
        workspace_id=workspace_id,
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "对该团队任务的工作区无写权限",
        )


async def _get_mission_without_workspace_anchor(
    session: AsyncSession,
    user: User,
    mission_id: uuid.UUID,
    *,
    enforce_workspace_permission: bool,
) -> AgentMission:
    """仅 mission_id（无 workspace 路径锚）时按 id 取 mission + 锚工作区权限复核。

    task-10 对齐的 ``/missions/{mid}/{action}`` 路由族：mission 自带 workspace
    归属，按 mission.workspace_id 复核（daemon hub-client `_missionActionPath`
    仅 mid 形态的消费方）。
    """
    mission = await session.get(AgentMission, mission_id)
    if mission is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "mission not found")
    if enforce_workspace_permission:
        await _check_workspace_write(session, user, mission.workspace_id)
    return mission


async def _resolve_session_mission(
    session: AsyncSession,
    request: Request,
    user: User,
    *,
    path_session_id: uuid.UUID | None = None,
    workspace_id: uuid.UUID | None = None,
    mission_id: uuid.UUID | None = None,
    allow_lazy: bool = False,
    lazy_objective: str | None = None,
    enforce_workspace_permission: bool = False,
) -> AgentMission:
    """5 个 MCP 端点统一的 mission 解析（task-05，design §5 Phase 1 / §7）。

    解析优先级与语义：

    1. ``X-Session-Id`` header（或会话路由的路径 session_id）缺席 → 显式路径
       回退：ws+mid 走既有 ``_get_mission``（零回归）；仅 mid（task-10 对齐的
       ``/missions/{mid}/{action}`` 族）按 id 取 mission + 锚工作区复核；
       两者皆无（``/missions/{action}`` header-only 族未带头）→ 400 提示缺
       X-Session-Id。
    2. 会话维度解析：``get_active_mission_for_session``（task-02）取会话活跃
       mission；命中后显式参数仅作越权校验锚——mission_id 不一致 → 404（资源
       隐藏口径），workspace_id 复用 ``_get_mission`` 的 anchor∪scope 校验。
    3. 会话无活跃 mission：
       - ``allow_lazy``（仅 dispatch_worker）且无显式 mission_id 锚 → 懒建
         （scope=会话工作区、objective=dispatch 上下文、预算=默认上限 R-02，
         复用 task-03 预建入口 ``orchestration_mode="session"``），成功后补回填
         当前活跃 run 双标记；会话未绑定 workspace → 422 引导弹层文案（CC-10）；
         并发守卫（Grill NEW-3）捕获 ``uq_agent_missions_session_active`` 部分
         唯一索引的 IntegrityError → 回滚重查复用先到者的活跃 mission（SQLite
         测试方言不支持 SELECT...FOR UPDATE，唯一索引双方言同语义可测，PG 生产
         同样生效）。
       - 有显式 mission_id（显式路由带 header）→ 回退显式路径（存量 external/
         已收敛 mission 继续可用，零回归）。
       - 其余（非 dispatch 端点）→ 404 会话无活跃团队任务。

    ``enforce_workspace_permission``（无 workspace 路径锚的路由族用）：解析后按
    mission 锚工作区（懒建路径按会话工作区）复核 WORKSPACE_WRITE——对齐显式路由
    ``require_permission`` 的口径。
    """
    sid = _request_session_id(request, path_session_id)
    if sid is None:
        # 无会话上下文：显式路径回退（三种形态见 docstring 第 1 条）
        if workspace_id is not None:
            return await _get_mission(session, workspace_id, mission_id)
        if mission_id is not None:
            return await _get_mission_without_workspace_anchor(
                session, user, mission_id, enforce_workspace_permission=enforce_workspace_permission
            )
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "缺少 X-Session-Id 会话头：mission_id/workspace_id 缺省的调用必须携带该头",
        )

    agent_session = await session.get(AgentSession, sid)
    if agent_session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "session not found")

    from app.modules.agent.mission import get_active_mission_for_session

    mission = await get_active_mission_for_session(session, sid)
    if mission is not None:
        if mission_id is not None and mission_id != mission.id:
            # 显式 mission_id 仅作越权校验锚：与活跃 mission 失配 → 404 资源隐藏
            raise HTTPException(status.HTTP_404_NOT_FOUND, "mission not found")
        if workspace_id is not None:
            # 复用 anchor∪scope 口径（task-08 链路A）
            await _get_mission(session, workspace_id, mission.id)
        if enforce_workspace_permission:
            await _check_workspace_write(session, user, mission.workspace_id)
        return mission

    # ── 会话无活跃 mission ──
    if not allow_lazy or mission_id is not None:
        # 非 dispatch 端点不懒建；带 mission_id 锚 → 回退显式路径（存量 external/
        # 已收敛 mission 零回归）。
        if mission_id is not None:
            if workspace_id is not None:
                return await _get_mission(session, workspace_id, mission_id)
            return await _get_mission_without_workspace_anchor(
                session, user, mission_id, enforce_workspace_permission=enforce_workspace_permission
            )
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "该会话当前没有活跃团队任务（先 dispatch_worker 或经派团队弹层预建）",
        )

    ws_id = agent_session.workspace_id
    if ws_id is None:
        # CC-10：会话未绑定工作区 → 422 引导走派团队弹层显式选范围
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "该会话未绑定工作区，请通过派团队弹层显式选择工作区范围。",
        )
    if enforce_workspace_permission:
        await _check_workspace_write(session, user, ws_id)

    change_id = agent_session.change_id
    from app.modules.agent.orchestrator import OrchestratorService

    try:
        mission, _main_run = await OrchestratorService(session).team_mission_entry(
            workspace_id=ws_id,
            objective=lazy_objective or "",
            created_by=user.id,
            # change_id 继承会话上下文（同 task-03 预建口径）
            change_id=change_id,
            constraints=None,
            budget_usd=_lazy_mission_budget_usd(),
            worker_preset=None,
            main_agent_config=None,
            orchestration_mode="session",
            scope_workspace_ids=[ws_id],
            session_id=sid,
        )
    except IntegrityError:
        await session.rollback()
        mission = await get_active_mission_for_session(session, sid)
        if mission is None:
            raise
        log.info(
            "lazy_mission_race_reused",
            session_id=str(sid),
            mission_id=str(mission.id),
        )
        return mission
    await _backfill_orchestrator_run(session, sid, mission)
    return mission


async def _resolve_dispatch_agent_profile(
    session: AsyncSession,
    mission: AgentMission,
    profile_id: uuid.UUID | None,
    user: User,
):
    """task-10：dispatch_worker 绑 AgentProfile（FR-04，design §5.2 P4 / §1.2）。

    ``profile_id`` 为 None（老调用不传）→ 返 None，走兜底链零回归。非空时：
    - 经 ``AgentProfileService.get`` 取 profile（自带三级 visibility 校验；不存在 404 /
      不可见 403 统一转成 400——对主 agent 而言「绑不上」都是请求参数问题）。
    - 断言可用于本 mission：workspace 级 profile 须
      ``profile.workspace_id ∈ {anchor} ∪ scope``（P2-1，放宽）；
      private / platform 级放行。不匹配返 400。
    校验通过返回 profile，由调用方冻结快照落 run。

    task-08（2026-08-19-cross-workspace-team-mission / §7.2 链路A）：
    - 原 ``== mission.workspace_id`` 在跨 ws worker 绑 target ws profile 时误判 400
    - 改为 ``profile.workspace_id ∈ {anchor} ∪ scope_workspace_ids``
    - scope 为 NULL 时按 [workspace_id] 处理（P2-2 零回归）
    """
    if profile_id is None:
        return None

    from app.modules.agent.profile.model import AgentProfileVisibility
    from app.modules.agent.profile.service import (
        AgentProfileNotFound,
        AgentProfilePermissionDenied,
        AgentProfileService,
    )

    svc = AgentProfileService(session)
    try:
        profile = await svc.get(profile_id=profile_id, actor=user)
    except (AgentProfileNotFound, AgentProfilePermissionDenied) as exc:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"agent_profile_id 不可用：{exc.message}",
        ) from exc

    # workspace 级 profile 须属于 {anchor} ∪ scope（P2-1 放宽）
    if profile.visibility == AgentProfileVisibility.WORKSPACE.value:
        scope = mission.scope_workspace_ids or [str(mission.workspace_id)]
        allowed = {str(mission.workspace_id)} | set(scope)
        if str(profile.workspace_id) not in allowed:
            raise HTTPException(
                status.HTTP_400_BAD_REQUEST,
                "agent_profile_id 属于其它 workspace，不能用于本 mission",
            )
    return profile


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

    finalizer = FinalizerService(session, host_fs_delegate=new_host_fs_delegate(session))
    result = await finalizer.finalize_execute_mission(mission_id)
    return result.merged_branches, result.pending_conflicts


async def _cleanup_mission(session: AsyncSession, mission_id: uuid.UUID) -> None:
    """合并成功后清 worker 副本（task-07 提供 ``finalizer.cleanup_mission``）。

    expects_from task-07：全 merged 成功 → 逐个 git_worktree_remove 清各 worker 副本 +
    采合并 diff 作 patch artifact。task-06 消费方只调一次，失败保留副本（X-003）。
    单测整体 mock 本函数（隔离 task-07 实现）。task-08 集成接线 delegate。
    """
    from app.modules.agent.finalizer import FinalizerService

    finalizer = FinalizerService(session, host_fs_delegate=new_host_fs_delegate(session))
    cleanup = getattr(finalizer, "cleanup_mission", None)
    if cleanup is None:
        # task-07 未落地前兜底（expects_from 契约；集成期 task-08 接线后必有）
        log.info("converge_mission_cleanup_not_yet_wired_skip", mission_id=str(mission_id))
        return
    await cleanup(mission_id)


async def _get_main_run(session: AsyncSession, mission_id: uuid.UUID) -> AgentRun:
    """取 mission 最新主控轮 run（task-06，design §5 核心机制 D-009/D-010）。

    ``role='orchestrator'`` 按 ``created_at desc`` 取**最新一条**——会话 mission 的
    主控轮是逐 turn 回填双标记的多条 run（task-04 inject / task-05 懒建补回填），
    converge/finalize 锚定当轮；存量 external/bootstrap mission 单主控 run 且先于
    worker 创建（首条即唯一），同规则命中零回归。无主控轮回填 → 404（fail-loud，
    会话链路 inject/懒建均保证双标记，缺失属接线异常）。
    """
    stmt = (
        select(AgentRun)
        .where(AgentRun.mission_id == mission_id, AgentRun.role == "orchestrator")
        .order_by(AgentRun.created_at.desc())
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
    request: Request,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> WorkerRunResponse:
    """主 agent 动态派一个 worker run（D-002@v2）。

    建 AgentRun(role 从 payload 或 preset 对应条目, status=pending) + 调
    ``MissionExecutionService.dispatch_worker`` 派 daemon lease。daemon 离线 /
    未绑定时 lease 失败但 run 仍建（pending + error_code=no_online_daemon），
    主 agent 可读 worker 状态决定重派。

    task-08（2026-08-19-cross-workspace-team-mission / §7.2 链路A）：
    - 新增 target_workspace_id 参数（payload.target_workspace_id）
    - 服务端校验 target ∈ scope（含 anchor），越界抛 400 mission_target_out_of_scope
    - 有效 target 传 exec_svc.dispatch_worker 的 target_workspace_id 形参

    task-05（2026-08-22-team-session-unify）：mission 解析接入 X-Session-Id 会话
    定位（design §5 Phase 1 / §7）——header 命中会话活跃 mission 时显式路径参数
    仅作越权校验锚；会话无活跃 mission 且无显式 mission_id 时懒建兜底（scope=
    会话工作区、objective=dispatch 上下文、预算=默认上限 R-02 + 补回填双标记 +
    并发守卫）。header 缺席走 ``_get_mission`` 显式路径，行为零回归。
    """
    mission = await _resolve_session_mission(
        session,
        request,
        user,
        workspace_id=workspace_id,
        mission_id=mission_id,
        allow_lazy=True,
        lazy_objective=payload.objective,
    )
    return await _dispatch_worker_core(
        session, request, user, mission, payload, anchor_workspace_id=workspace_id
    )


async def _dispatch_worker_core(
    session: AsyncSession,
    request: Request,
    user: User,
    mission: AgentMission,
    payload: DispatchWorkerRequest,
    *,
    anchor_workspace_id: uuid.UUID,
) -> WorkerRunResponse:
    """dispatch_worker 共用主体（显式路由 / 会话路由同构，task-05 抽取）。

    ``anchor_workspace_id``：工作区派发锚——显式路由为路径 workspace_id（已过
    ``_get_mission`` anchor∪scope 校验），会话路由为 mission.workspace_id。
    """
    role = payload.role or _DEFAULT_WORKER_ROLE

    # task-08：scope 校验（显式 target_workspace_id ∈ {anchor} ∪ scope）。
    # 单 workspace 模式 payload.target_workspace_id 为 None → 不传显式 target，
    # 由 execution.py 使用 anchor workspace 零回归，且 AgentRun.target_workspace_id
    # 保持 NULL（mission_schema.py:65 契约，task-16 review 追补）。
    explicit_target = payload.target_workspace_id
    anchor = mission.workspace_id
    scope = mission.scope_workspace_ids or [str(anchor)]
    allowed = {str(anchor)} | set(scope)
    if explicit_target is not None and str(explicit_target) not in allowed:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "mission_target_out_of_scope: target_workspace_id 不在 mission scope 内",
        )

    # BE-P0-2（2026-08-21 审查）：跨 ws 派发越权修复。原先只查 target ∈ scope，
    # 不校验调用者对 target 的权限——scope 内 A ws 的普通成员可向自己无权限的
    # B ws 注入带 Bash/Edit/Write 的 worker（representative binding 落到 B 成员
    # 机器执行）。现在：JWT 用户通道（Bearer）要求对 target 也有 WORKSPACE_WRITE；
    # daemon apiKey 通道（X-API-Key）豁免——主 agent 编排是设计 D-006 允许的
    # 跨 ws 派发路径（scope 圈选即授权，R-03）。
    if explicit_target is not None and explicit_target != anchor_workspace_id:
        auth_header = request.headers.get("authorization") or ""
        if auth_header.lower().startswith("bearer "):
            from app.modules.auth.rbac import has_permission

            if not await has_permission(
                session,
                user=user,
                permission=Permission.WORKSPACE_WRITE,
                workspace_id=explicit_target,
            ):
                raise HTTPException(
                    status.HTTP_403_FORBIDDEN,
                    "mission_target_forbidden: 对目标工作区无写权限，不能跨工作区派发",
                )

    # task-10：可选绑 AgentProfile（FR-04）。None → profile=None 走兜底链零回归；
    # 非空 → 校验可见性 + workspace 归属（不可用 / 跨 workspace 返 400，先于建 run）。
    profile = await _resolve_dispatch_agent_profile(
        session, mission, payload.agent_profile_id, user
    )

    # 治理门（与 create_mission 一致，control.can_dispatch_worker）。
    # BE-P1-7（2026-08-21 审查）：gate 挪到建 run **之前**，拒绝直接抛 400（携带
    # reason），不再产生 killed run。原先先建 run 再拒绝标 killed——killed 属
    # derive_status 的 _FAILED 集合，治理性拒绝（max_workers_reached 是正常运行
    # 路径：worker 尚在 running 时补派）会把全 worker 成功的 mission 也 derive 成
    # degraded，且僵尸 run 永久留在 worker 列表。主 agent 从错误 message 读 reason
    # 自主决策（等待重派 / 收敛）。
    from app.modules.agent.control import MissionControlService

    ctrl = MissionControlService(session)
    allowed, reason = await ctrl.can_dispatch_worker(mission)
    if not allowed:
        log.info(
            "mcp_dispatch_worker_rejected",
            mission_id=str(mission.id),
            reason=reason,
        )
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"mcp_dispatch_worker_rejected: {reason}",
        )

    run = AgentRun(
        mission_id=mission.id,
        change_id=mission.change_id,
        agent_type=payload.agent_type or "claude_code",
        provider=None,
        model=payload.model,
        status="pending",
        role=role,
        objective=payload.objective,
        # task-09：read_only 落 run 记录（FR-06 / D-005@v2）。列在 task-01 已建
        # （agent_runs.read_only nullable bool），execution.py 已按 run.read_only
        # 流转 worker_tool_config，此处补 dispatch 落列这一缺口。
        read_only=payload.read_only,
        # task-10：profile 绑定 + 冻结快照（含 version，复用 service 既有构造）。
        agent_profile_id=(profile.id if profile is not None else None),
        agent_profile_snapshot=(
            _build_agent_profile_snapshot(profile) if profile is not None else None
        ),
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)

    exec_svc = MissionExecutionService(session, host_fs_delegate=new_host_fs_delegate(session))
    try:
        await exec_svc.dispatch_worker(
            run,
            workspace_id=anchor_workspace_id,
            user_id=user.id,
            read_only=payload.read_only,
            # task-05 路径A 透传（design §7.3）：caller worktree 三参，默认 None
            # → execution 走原 team 模式自建 worktree 逻辑（§9 零回归）。字段名 branch
            # 对齐链路B + 跨仓契约（D-009）。
            worktree_path=payload.worktree_path,
            branch=payload.branch,
            worker_prompt=payload.worker_prompt,
            # task-08：跨工作区派发目标工作区（design §7.2 链路A）。
            # 单 workspace 模式传 None，保持 target_workspace_id 列 NULL 零回归。
            target_workspace_id=explicit_target,
        )
    except HostFsDelegateUnavailable:
        # delegate wiring 错误（workspace 无 bound daemon）fail-loud 503
        # （ql-20260713-002 契约，delegate.py:734 不 degrade）——不吞，主 agent 收到
        # 503 知道是 binding 问题，区别于 worktree_create_failed/no_online_daemon
        # （execution 内部已收敛为 run failed，可重试/收敛）。
        raise
    except Exception as exc:
        # 诊断 36b9b475：execution 内部已统一收敛 worktree/daemon 失败（failed +
        # error_code + finished_at），不再冒泡 NoOnlineDaemonError。此处仅兜底未预期
        # 异常，同样写 error_code 杜绝静默 failed（原 NoOnlineDaemon 分支设 pending
        # 语义错——pending 让 derive_status 永远 running、mission 永不收敛）。
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
    return WorkerRunResponse.model_validate(run)


@router.get(
    "/workspaces/{workspace_id}/missions/{mission_id}/workers/{worker_id}/result",
    response_model=WorkerResultResponse,
)
async def get_worker_result(
    workspace_id: uuid.UUID,
    mission_id: uuid.UUID,
    worker_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> WorkerResultResponse:
    """读单个 worker 的结构化产出（AgentArtifact kind=patch/summary/...）。

    task-05：接入 X-Session-Id 会话定位（header 命中活跃 mission 时显式参数仅作
    越权校验锚；header 缺席零回归）。
    """
    mission = await _resolve_session_mission(
        session, request, user, workspace_id=workspace_id, mission_id=mission_id
    )
    return await _get_worker_result_core(session, mission, worker_id)


async def _get_worker_result_core(
    session: AsyncSession, mission: AgentMission, worker_id: uuid.UUID
) -> WorkerResultResponse:
    """get_worker_result 共用主体（显式路由 / 会话路由同构，task-05 抽取）。"""
    run = await session.get(AgentRun, worker_id)
    if run is None or run.mission_id != mission.id:
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
    request: Request,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> WorkerListResponse:
    """列 mission 下所有 worker runs 状态（含主 agent run）。

    task-05：接入 X-Session-Id 会话定位（header 命中活跃 mission 时显式参数仅作
    越权校验锚；header 缺席零回归）。
    """
    mission = await _resolve_session_mission(
        session, request, user, workspace_id=workspace_id, mission_id=mission_id
    )
    return await _list_workers_core(session, mission)


async def _list_workers_core(session: AsyncSession, mission: AgentMission) -> WorkerListResponse:
    """list_workers 共用主体（显式路由 / 会话路由同构，task-05 抽取）。"""
    stmt = select(AgentRun).where(AgentRun.mission_id == mission.id).order_by(AgentRun.created_at)
    runs = list((await session.execute(stmt)).scalars().all())
    return WorkerListResponse(
        mission_id=mission.id,
        workers=[WorkerListItem.model_validate(r) for r in runs],
    )


@router.post(
    "/workspaces/{workspace_id}/missions/{mission_id}/converge",
    response_model=ConvergeResponse,
)
async def converge_mission(
    workspace_id: uuid.UUID,
    mission_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> ConvergeResponse:
    """主 agent 触发 mission 收敛（task-06 D-010 语义重定义，design §5 / §7 / §7.5）。

    状态机（per mission，无新列——计数存 ``AgentMission.constraints`` JSON）：

    0. **busy 前置**：分身 run（``role!='orchestrator'`` 含 NULL）未全终态 → 返
       ``status=busy`` + message 引导文案，零状态变更（不置位/不 finalize）。
    1. 分身全终态 → 以最新 orchestrator run 为锚调 ``converge_mission_for_completed_run``
       （``converge_explicit=True``：分身维度判据 + converged_at 原子抢占置位，
       不依赖主控 run 状态；保留 artifact 回灌 + bootstrap/execute 路由；冲突时
       入口内回滚置位保重入）。
    2. 复用 ``FinalizerService.finalize_execute_mission`` 拿 ``FinalizerMergeResult``
       （merged_branches / pending_conflicts）——见 ``_finalize_merge_for_mission``
       注释（为何不直接改 converge_mission_for_completed_run 返回值）。
    3. ``pending_conflicts`` 非空 → 返 ``status=conflict`` + conflicts 给主 agent；
       主 agent 自己 SDK Read/Write 解决（X-004，backend 不写文件）+ git add 后重入。
    4. 重入：``finalize_execute_mission`` 重跑，已 merged 分支幂等（already-up-to-date），
       主 agent 解决后的内容被下次 git 合进去；全 merged → ``status=converged`` +
       调 ``_cleanup_mission``（task-07 cleanup_mission）清 worker 副本。
    5. R-07：每次返 conflict 时计数 +1（``_bump_conflict_attempts``）；超限（默认 3）
       → ``_mark_mission_needs_manual`` 标 ``needs_manual`` + 返
       ``status=needs_manual``，副本保留供排查（X-003）。

    简化（task-06 决策，见 ``_mark_mission_needs_manual``）：不实际 ``git merge --abort``——
    workspace root 工作区状态在 daemon 侧，backend 不可控，强行 abort 可能误清主 agent 已
    写的解决内容；改为标 needs_manual 让用户/主 agent 手动处理。

    task-05（2026-08-22-team-session-unify）：mission 解析接入 X-Session-Id 会话
    定位（header 命中活跃 mission 时显式参数仅作越权校验锚；header 缺席零回归）。
    """
    mission = await _resolve_session_mission(
        session, request, user, workspace_id=workspace_id, mission_id=mission_id
    )
    return await _converge_core(session, mission)


async def _converge_core(session: AsyncSession, mission: AgentMission) -> ConvergeResponse:
    """converge_mission 共用主体（task-05 抽取显式/会话路由同构；task-06 D-010 语义重定义）。

    判定序（design §5 Phase 1 / §7.5 converge 行）：

    1. **busy 前置判定**：分身 run（``role!='orchestrator'``，含 NULL role 守卫——
       SQL 三值逻辑下 ``!=`` 漏 NULL 行，统一走 ``non_orchestrator_runs``）未全
       终态 → 返 ``status=busy`` + 引导文案（message 携未完成计数）；mission
       状态不变、不置 ``converged_at``、不触发 finalize/merge（主 agent 等待后
       重试）。
    2. 分身全终态 → 以**最新 orchestrator run** 为锚调 ``converge_mission_for_completed_run``
       （``converge_explicit=True``：derive 判据只看分身 run + ``converged_at``
       原子抢占 UPDATE...WHERE IS NULL——**不依赖主控 run 状态**，会话 mission
       主控轮当轮 running 也能收敛；execute 冲突未解决时该入口回滚置位，保住
       会话活跃 mission 重入）。
    3. merge 结果（``_finalize_merge_for_mission``）有 pending_conflicts → 可重入
       conflict 状态机（attempt 计数 / R-07 超限 → ``needs_manual``，语义保留）；
       全 merged → cleanup + ``status=converged``。

    响应 ``status`` 四值 converged/busy/conflict/needs_manual（ConvergeResponse
    docstring）；cancelled/planning 等防御性派生值原样透传（busy 已前置挡 running）。
    """
    from app.modules.agent.control import MissionControlService

    # --- 1. busy 前置判定（D-010：分身未全终态 → 引导等待，零状态变更）---
    ctrl = MissionControlService(session)
    worker_runs = await ctrl.non_orchestrator_runs(mission.id)
    active_workers = [r for r in worker_runs if r.status not in _TERMINAL_RUN_STATUSES]
    if active_workers:
        log.info(
            "converge_mission_busy",
            mission_id=str(mission.id),
            active_workers=len(active_workers),
            total_workers=len(worker_runs),
        )
        return ConvergeResponse(
            mission_id=mission.id,
            status="busy",
            converged=False,
            artifact_id=None,
            merged_branches=[],
            conflicts=[],
            attempt=_read_conflict_attempts(mission),
            message=(
                f"还有 {len(active_workers)} 个分身任务未完成（共 {len(worker_runs)} 个），"
                "尚不能收敛：请等待全部分身到达终态后重试 converge，"
                "或先用 list_workers 查看各分身进度。"
            ),
        )

    # --- 2. 分身全终态 → 收敛（锚点=最新 orchestrator run，不依赖主控 run 状态）---
    main_run = await _get_main_run(session, mission.id)

    from app.modules.agent.delegation import GLMConfig
    from app.modules.agent.finalizer import converge_mission_for_completed_run

    cfg = GLMConfig.from_env()
    result_status = await converge_mission_for_completed_run(
        session, main_run.id, cfg, converge_explicit=True
    )
    # done/degraded/failed 均为分身全终态（failed=无一 completed 的全终态），
    # 置位与合并已由 converge_explicit 入口完成；running/planning/cancelled 未置位。
    base_converged = result_status in ("done", "degraded", "failed")

    # converge_mission_for_completed_run 内部已 commit；补 flush 保证后续读取一致。
    await session.flush()

    # 读 merge 结果（merged_branches / pending_conflicts）。execute mission（有 patch /
    # worktree_branch）走 conflict 状态机；bootstrap mission（无 patch）merge 结果为空
    # → 走收敛语义（artifact_id 取最新 summary）。
    merged_branches, pending_conflicts = await _finalize_merge_for_mission(session, mission.id)

    # --- bootstrap 路径（无 worker_branch 合并需求）→ 不进 conflict 状态机 ---
    if not merged_branches and not pending_conflicts:
        artifact_id = await _latest_artifact_id(session, mission.id) if base_converged else None
        # 四值映射：置位成功 → converged；running（防御，busy 前置判定已挡）→ busy；
        # cancelled/planning（已叫停 / 尚无分身 run，均未置位）原样透传供主 agent 判断。
        if base_converged:
            resp_status = "converged"
        elif result_status == "running":
            resp_status = "busy"
        else:
            resp_status = result_status or "busy"
        return ConvergeResponse(
            mission_id=mission.id,
            status=resp_status,
            converged=base_converged,
            artifact_id=artifact_id,
            merged_branches=[],
            conflicts=[],
            attempt=_read_conflict_attempts(mission),
        )

    # --- execute 路径（有 merge 需求）→ 可重入 conflict 状态机（design §5.2）---
    if pending_conflicts:
        # R-07：先判是否已超限（避免超限后仍 +1 漂移）。当前 attempts 是返 conflict 前
        # 的累计值；超限指「即将超过上限」即 attempts+1 > max。needs_manual 路径不回滚
        # converged_at（终态转人工；置位与否随 converge_explicit 入口的冲突回滚结果）。
        current_attempts = _read_conflict_attempts(mission)
        if current_attempts + 1 > _max_conflict_attempts():
            await _mark_mission_needs_manual(session, mission, reason="R-07 解冲突轮次超限")
            return ConvergeResponse(
                mission_id=mission.id,
                status="needs_manual",
                converged=False,
                artifact_id=None,
                merged_branches=merged_branches,
                conflicts=pending_conflicts,
                attempt=current_attempts,
                message=(
                    f"解冲突轮次已达上限（{current_attempts}），mission 已标记 needs_manual，"
                    "worker 副本保留供人工排查（X-003），请转人工处理。"
                ),
            )
        # 未超限 → 计数 +1（落库）+ 返 conflict 给主 agent。
        # D-010 冲突重入守卫（兜底）：冲突未解决不算收敛——``converge_explicit`` 入口
        # 已按内部 merge 结果回滚本次置位，此处对**最终判定**（``_finalize_merge_for_
        # mission`` 结果）再兜底置空一次（防御两段 merge 结果短暂不一致），保持会话
        # 活跃 mission 可解析——session 路由重入 converge 不 404（重入语义不回退）。
        await session.execute(
            update(AgentMission).where(AgentMission.id == mission.id).values(converged_at=None)
        )
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

    # --- 全 merged 成功（pending_conflicts 空 + 有 merged_branches）→ cleanup + converged ---
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
        status="converged",
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
    request: Request,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> ProgressResponse:
    """落主 agent 决策日志（AgentRunLog channel=tool_call, tool_kind=other）。

    主 agent 每次决策（派 worker / 判断达成 / 收敛）都调此 endpoint 落一条日志，
    供前端展示决策链路 + 审计。``decision`` 字段拼到 content 前缀便于筛选。

    task-05：接入 X-Session-Id 会话定位（header 命中活跃 mission 时显式参数仅作
    越权校验锚；header 缺席零回归）。run_id 缺省时按会话当前主控 run 解析
    （task-10 对齐）。
    """
    mission = await _resolve_session_mission(
        session, request, user, workspace_id=workspace_id, mission_id=mission_id
    )
    return await _report_progress_core(
        session,
        mission,
        payload,
        agent_session_id=_request_session_id(request, None),
    )


async def _report_progress_core(
    session: AsyncSession,
    mission: AgentMission,
    payload: ProgressRequest,
    *,
    agent_session_id: uuid.UUID | None = None,
) -> ProgressResponse:
    """report_progress 共用主体（显式路由 / 会话路由同构，task-05 抽取）。

    run 解析（task-10 对齐）：``payload.run_id`` 显式传参 → 直接取（须属本
    mission，否则 404）；缺省 → 按 ``agent_session_id`` 解析会话当前主控 run
    （口径同懒建补回填：会话活跃 run 且已双标记本 mission；活跃轮间隙回落
    mission 最新 orchestrator run，converge 前后的决策日志仍可落）。无会话
    上下文且缺 run_id → 400。
    """
    run: AgentRun | None = None
    if payload.run_id is not None:
        run = await session.get(AgentRun, payload.run_id)
        if run is None or run.mission_id != mission.id:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "run not found in mission")
    elif agent_session_id is not None:
        stmt = (
            select(AgentRun)
            .where(
                AgentRun.agent_session_id == agent_session_id,
                AgentRun.status.in_(_ACTIVE_RUN_STATUSES),
                AgentRun.mission_id == mission.id,
            )
            .order_by(AgentRun.created_at.desc())
            .limit(1)
        )
        run = (await session.execute(stmt)).scalars().first()
        if run is None:
            # 活跃轮间隙（turn 已完成）：回落 mission 最新主控 run，保住
            # converge 前后的决策日志链路。
            stmt = (
                select(AgentRun)
                .where(AgentRun.mission_id == mission.id, AgentRun.role == "orchestrator")
                .order_by(AgentRun.created_at.desc())
                .limit(1)
            )
            run = (await session.execute(stmt)).scalars().first()
        if run is None:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                "该会话没有可挂载进度日志的主控 run，请显式传 run_id",
            )
    else:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "report_progress 缺 run_id 且无 X-Session-Id 会话上下文，无法定位主控 run",
        )
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


# ---------------------------------------------------------------------------
# task-05（2026-08-22-team-session-unify）：会话维度路由（缺参调用形态）
# design §5 Phase 1 / §7——5 工具参数可选化（daemon mcp-server task-10）后，
# mission_id/workspace_id 缺省的调用经 ``/sessions/{session_id}/missions/...``
# 路由 + X-Session-Id（header 或路径）解析会话活跃 mission；既有 workspace/
# mission 路径前缀路由不动（零回归）。鉴权：require_permission_any（路径无
# workspace 锚）+ 解析后按 mission 锚工作区复核（enforce_workspace_permission）。
# ---------------------------------------------------------------------------


@router.post(
    "/sessions/{session_id}/missions/dispatch_worker",
    response_model=WorkerRunResponse,
    status_code=status.HTTP_201_CREATED,
)
async def dispatch_worker_for_session(
    session_id: uuid.UUID,
    payload: DispatchWorkerRequest,
    request: Request,
    session: SessionDep,
    user: SessionMcpUser,
) -> WorkerRunResponse:
    """会话维度 dispatch_worker——无活跃 mission 时懒建兜底（design §5 Phase 1）。

    懒建：scope=会话绑定工作区、objective=dispatch 上下文、预算=默认上限（R-02），
    复用 task-03 预建入口（``orchestration_mode="session"``）；建后补回填会话
    当前活跃 run 双标记（Grill NEW-1）。会话未绑定工作区 → 422 引导弹层文案
    （CC-10）；并发双懒建由部分唯一索引兜底（Grill NEW-3）。
    """
    mission = await _resolve_session_mission(
        session,
        request,
        user,
        path_session_id=session_id,
        allow_lazy=True,
        lazy_objective=payload.objective,
        enforce_workspace_permission=True,
    )
    return await _dispatch_worker_core(
        session, request, user, mission, payload, anchor_workspace_id=mission.workspace_id
    )


@router.get(
    "/sessions/{session_id}/missions/workers/{worker_id}/result",
    response_model=WorkerResultResponse,
)
async def get_worker_result_for_session(
    session_id: uuid.UUID,
    worker_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    user: SessionMcpUser,
) -> WorkerResultResponse:
    """会话维度 get_worker_result——按会话活跃 mission 读分身产出。"""
    mission = await _resolve_session_mission(
        session,
        request,
        user,
        path_session_id=session_id,
        enforce_workspace_permission=True,
    )
    return await _get_worker_result_core(session, mission, worker_id)


@router.get(
    "/sessions/{session_id}/missions/workers",
    response_model=WorkerListResponse,
)
async def list_workers_for_session(
    session_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    user: SessionMcpUser,
) -> WorkerListResponse:
    """会话维度 list_workers——按会话活跃 mission 列 run 状态。"""
    mission = await _resolve_session_mission(
        session,
        request,
        user,
        path_session_id=session_id,
        enforce_workspace_permission=True,
    )
    return await _list_workers_core(session, mission)


@router.post(
    "/sessions/{session_id}/missions/converge",
    response_model=ConvergeResponse,
)
async def converge_mission_for_session(
    session_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    user: SessionMcpUser,
) -> ConvergeResponse:
    """会话维度 converge——按会话活跃 mission 触发收敛（内部语义归 task-06）。"""
    mission = await _resolve_session_mission(
        session,
        request,
        user,
        path_session_id=session_id,
        enforce_workspace_permission=True,
    )
    return await _converge_core(session, mission)


@router.post(
    "/sessions/{session_id}/missions/progress",
    response_model=ProgressResponse,
    status_code=status.HTTP_201_CREATED,
)
async def report_progress_for_session(
    session_id: uuid.UUID,
    payload: ProgressRequest,
    request: Request,
    session: SessionDep,
    user: SessionMcpUser,
) -> ProgressResponse:
    """会话维度 report_progress——按会话活跃 mission 落主控决策日志。"""
    mission = await _resolve_session_mission(
        session,
        request,
        user,
        path_session_id=session_id,
        enforce_workspace_permission=True,
    )
    return await _report_progress_core(
        session,
        mission,
        payload,
        agent_session_id=_request_session_id(request, session_id),
    )


# ---------------------------------------------------------------------------
# task-10 对齐路由族（2026-08-22-team-session-unify）：``/missions/{action}``
# （header-only）与 ``/missions/{mid}/{action}``（仅 mid）——daemon hub-client
# `_missionActionPath` 的两种缺参 URL 形态（ws/mid 可选化后 ws 缺省即落此二族），
# 与上方 /sessions/{sid}/missions/... 族共享同一批 core。三族差异只在身份来源：
# 本族无任何路径锚 → 会话身份完全由 X-Session-Id header 承载（缺失 → 400）；
# 仅 mid 族 header 缺席时按 mission 反解 + 锚工作区权限复核。
#
# 路由冲突注意：GET ``/missions/workers``（单段 GET）会被先注册的
# ``GET /missions/{mission_id}``（router.py:1086，mcp_tools include 于 :1451 之后）
# 按 Starlette 首个全匹配规则截走 → uuid 校验 422，本路由不可达。已注册留作
# include 顺序调整（把 mcp_tools include 挪到 :1086 之前）后即生效的锚点，
# 见 test_mcp_tools.py 的 xfail 用例与 task-05 报告。其余 9 条（POST 单段 /
# 多段 GET）与既有路由无正则交叠，正常可达（单段 POST 依赖 Starlette 方法
# 失配续扫语义）。
# ---------------------------------------------------------------------------


@router.post(
    "/missions/dispatch_worker",
    response_model=WorkerRunResponse,
    status_code=status.HTTP_201_CREATED,
)
async def dispatch_worker_scoped(
    payload: DispatchWorkerRequest,
    request: Request,
    session: SessionDep,
    user: SessionMcpUser,
) -> WorkerRunResponse:
    """header-only dispatch_worker（``/missions/dispatch_worker``）——懒建兜底同会话族。"""
    mission = await _resolve_session_mission(
        session,
        request,
        user,
        allow_lazy=True,
        lazy_objective=payload.objective,
        enforce_workspace_permission=True,
    )
    return await _dispatch_worker_core(
        session, request, user, mission, payload, anchor_workspace_id=mission.workspace_id
    )


@router.get(
    "/missions/workers/{worker_id}/result",
    response_model=WorkerResultResponse,
)
async def get_worker_result_scoped(
    worker_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    user: SessionMcpUser,
) -> WorkerResultResponse:
    """header-only get_worker_result（``/missions/workers/{wid}/result``）。"""
    mission = await _resolve_session_mission(
        session, request, user, enforce_workspace_permission=True
    )
    return await _get_worker_result_core(session, mission, worker_id)


@router.get(
    "/missions/workers",
    response_model=WorkerListResponse,
    # 见上方路由冲突注意：当前被 router.py:1086 的 /missions/{mission_id} 截走
    # （首个全匹配 + uuid 校验 422），include 顺序调整后本路由生效。
)
async def list_workers_scoped(
    request: Request,
    session: SessionDep,
    user: SessionMcpUser,
) -> WorkerListResponse:
    """header-only list_workers（``/missions/workers``）——按 X-Session-Id 解析。"""
    mission = await _resolve_session_mission(
        session, request, user, enforce_workspace_permission=True
    )
    return await _list_workers_core(session, mission)


@router.post(
    "/missions/converge",
    response_model=ConvergeResponse,
)
async def converge_mission_scoped(
    request: Request,
    session: SessionDep,
    user: SessionMcpUser,
) -> ConvergeResponse:
    """header-only converge（``/missions/converge``）——内部语义归 task-06。"""
    mission = await _resolve_session_mission(
        session, request, user, enforce_workspace_permission=True
    )
    return await _converge_core(session, mission)


@router.post(
    "/missions/progress",
    response_model=ProgressResponse,
    status_code=status.HTTP_201_CREATED,
)
async def report_progress_scoped(
    payload: ProgressRequest,
    request: Request,
    session: SessionDep,
    user: SessionMcpUser,
) -> ProgressResponse:
    """header-only report_progress（``/missions/progress``）。"""
    mission = await _resolve_session_mission(
        session, request, user, enforce_workspace_permission=True
    )
    return await _report_progress_core(
        session,
        mission,
        payload,
        agent_session_id=_request_session_id(request, None),
    )


@router.post(
    "/missions/{mission_id}/dispatch_worker",
    response_model=WorkerRunResponse,
    status_code=status.HTTP_201_CREATED,
)
async def dispatch_worker_by_mission(
    mission_id: uuid.UUID,
    payload: DispatchWorkerRequest,
    request: Request,
    session: SessionDep,
    user: SessionMcpUser,
) -> WorkerRunResponse:
    """仅 mid dispatch_worker（``/missions/{mid}/dispatch_worker``）。

    header 在场：会话活跃 mission 解析 + mid 越权校验锚；header 缺席：mission
    反解 + 锚工作区复核。有 mid 锚时不懒建（回退显式 mission，防锚失配副作用）。
    """
    mission = await _resolve_session_mission(
        session,
        request,
        user,
        mission_id=mission_id,
        allow_lazy=True,
        lazy_objective=payload.objective,
        enforce_workspace_permission=True,
    )
    return await _dispatch_worker_core(
        session, request, user, mission, payload, anchor_workspace_id=mission.workspace_id
    )


@router.get(
    "/missions/{mission_id}/workers/{worker_id}/result",
    response_model=WorkerResultResponse,
)
async def get_worker_result_by_mission(
    mission_id: uuid.UUID,
    worker_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    user: SessionMcpUser,
) -> WorkerResultResponse:
    """仅 mid get_worker_result（``/missions/{mid}/workers/{wid}/result``）。"""
    mission = await _resolve_session_mission(
        session, request, user, mission_id=mission_id, enforce_workspace_permission=True
    )
    return await _get_worker_result_core(session, mission, worker_id)


@router.get(
    "/missions/{mission_id}/workers",
    response_model=WorkerListResponse,
)
async def list_workers_by_mission(
    mission_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    user: SessionMcpUser,
) -> WorkerListResponse:
    """仅 mid list_workers（``/missions/{mid}/workers``）。"""
    mission = await _resolve_session_mission(
        session, request, user, mission_id=mission_id, enforce_workspace_permission=True
    )
    return await _list_workers_core(session, mission)


@router.post(
    "/missions/{mission_id}/converge",
    response_model=ConvergeResponse,
)
async def converge_mission_by_mission(
    mission_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    user: SessionMcpUser,
) -> ConvergeResponse:
    """仅 mid converge（``/missions/{mid}/converge``）——内部语义归 task-06。"""
    mission = await _resolve_session_mission(
        session, request, user, mission_id=mission_id, enforce_workspace_permission=True
    )
    return await _converge_core(session, mission)


@router.post(
    "/missions/{mission_id}/progress",
    response_model=ProgressResponse,
    status_code=status.HTTP_201_CREATED,
)
async def report_progress_by_mission(
    mission_id: uuid.UUID,
    payload: ProgressRequest,
    request: Request,
    session: SessionDep,
    user: SessionMcpUser,
) -> ProgressResponse:
    """仅 mid report_progress（``/missions/{mid}/progress``）。"""
    mission = await _resolve_session_mission(
        session, request, user, mission_id=mission_id, enforce_workspace_permission=True
    )
    return await _report_progress_core(
        session,
        mission,
        payload,
        agent_session_id=_request_session_id(request, None),
    )
