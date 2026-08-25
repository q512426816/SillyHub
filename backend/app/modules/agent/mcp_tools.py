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

task-03（2026-08-24-session-team-mission-context / FR-02 / D-005 / D-012）：
新增常驻查询端点 ``GET /missions/status``（header-only，X-Session-Id 定位，实际
URL /api/missions/status，对齐 hub-client ``_missionActionPath`` 缺参形态）与
同构变体 ``GET /sessions/{sid}/missions/status``——定位不走
``_resolve_session_mission``（无活跃 mission 抛 404 语义不符），直接
``get_active_mission_for_session``：无活跃 → 200 ``active=false`` + hint；
有活跃 → 权限复核后组装 ``MissionStatusResponse``（DTO 在 agent/schema.py，
scope 实时探测、status 派生、workers 与 _list_workers_core 同源）。

task-07（2026-08-25-team-subsession-governance / FR-04 / D-002@v1 / design
§5.C.2）：新增分身显式完成信号端点 ``POST .../worker_done``（四路由族同
report_progress 形态）——会话定位 X-Session-Id → 子会话行 →
``resolve_mission_for_session`` 沿 parent 链爬根（活跃 miss 时含终态二次解析
区分 409/404）；置位 ``worker_done_at``（可重复置位取最新）；summary 落
AgentArtifact（kind=summary）挂首 run（mission_id+role 双标记最早 run，
``_worker_artifacts`` / ``get_worker_result`` / Finalizer 合并链零新查询路径
可见）；全分身完成迁移（is_worker_complete 单源判定）时先 DEL
``_WORKERS_DONE_NOTIFY_KEY`` 再 SETNX 唤醒主控（重复完成周期可再次唤醒）；
迟到（mission 终态）409 零写入。

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
from app.modules.agent.execution import (
    MISSION_WORKER_STAGE,
    mark_worker_run_failed,
    prepare_worker_worktree,
    worker_tool_config,
)
from app.modules.agent.model import (
    ACTIVE_RUN_STATUSES,
    AgentArtifact,
    AgentMission,
    AgentRun,
    AgentRunLog,
    AgentSession,
    mission_worker_sessions,
    resolve_mission_for_session,
)
from app.modules.agent.schema import (
    MissionStatusResponse,
    ScopeWorkspaceStatus,
    WorkerListItem,
)
from app.modules.agent.service import _build_agent_profile_snapshot
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.daemon.host_fs import new_host_fs_delegate

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
# P2（2026-08-25 二审 #3）：单源 ``agent.model.ACTIVE_RUN_STATUSES``
# （pending/running/pending_approval——审批中的 run 仍是当前活跃轮，可被回填/
# 被 converge 定位；interrupting 为前端展示态，backend 不落库，已剔除）。
_ACTIVE_RUN_STATUSES = ACTIVE_RUN_STATUSES

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


# WorkerListItem（task-03 上移 agent/schema.py——schema 顶层 import mcp_tools 会
# 成环，反向无环）：顶部 from-import 即模块级重导出，既有
# ``from app.modules.agent.mcp_tools import WorkerListItem`` 消费方零改动；
# 字段定义单源在 schema.py，此处禁止复制。


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


class WorkerDoneRequest(BaseModel):
    """分身显式完成信号请求体（task-07 / FR-04 / D-002@v1，design §5.C.2）。

    会话定位同 report_progress 模式：``X-Session-Id``（header 优先，路径
    session_id 兜底）承载分身子会话身份；``workspace_id`` / ``mission_id``
    显式参数仅作越权校验锚（daemon 受限 server 缺参调用形态，对齐
    task-10 五工具可选化先例）。
    """

    summary: str
    workspace_id: uuid.UUID | None = None
    mission_id: uuid.UUID | None = None


class WorkerDoneResponse(BaseModel):
    """worker_done 响应契约：置位落点 + 全完成迁移结果。"""

    mission_id: uuid.UUID
    session_id: uuid.UUID
    # 首 run（mission_id+role 双标记最早 run）——summary artifact 挂载点
    run_id: uuid.UUID
    artifact_id: uuid.UUID
    worker_done_at: datetime
    # 置位后全分身完成判定（is_worker_complete 单源，design §5.C.3）
    all_workers_done: bool
    # 本次调用是否触发主控唤醒（false→true 迁移 / 重开工重复完成周期）
    orchestrator_notified: bool


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

    与 task-04 inject 双标记同语义：把会话当前活跃（ACTIVE_RUN_STATUSES 词表）
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
    """主 agent 动态派一个 worker run（D-002@v2；task-05 2026-08-25 起为子会话形态）。

    task-05（2026-08-25-team-subsession-governance / FR-02 / design §5.B）：执行段
    整体换子会话三元组——AgentSession(parent=主控会话, owner=mission.created_by) +
    interactive lease(metadata.stage=mission_worker, metadata.role) + 首 run
    (mission_id+role 双标记)，前置治理段逐项保留（scope / BE-P0-2 / 档案 / 治理门 /
    在线预检）；worktree 失败 / 派发失败按 mark_worker_run_failed 同款收敛（首 run
    failed + error_code，子会话收口终态），不崩 mission 主 agent 可补派。

    task-08（2026-08-19-cross-workspace-team-mission / §7.2 链路A）：
    - 新增 target_workspace_id 参数（payload.target_workspace_id）
    - 服务端校验 target ∈ scope（含 anchor），越界抛 400 mission_target_out_of_scope
    - 有效 target 作为分身落地工作区（worktree / runtime 钉定 / AgentRunWorkspace
      双关联全按 target 路由）

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


async def _fail_worker_subsession(
    session: AsyncSession,
    sub_session: AgentSession,
    run: AgentRun,
    *,
    error_code: str,
    message: str,
    run_already_failed: bool = False,
) -> None:
    """子会话派发失败统一收敛终态（task-05 / design §5.B 失败语义）。

    首 run 复用 ``mark_worker_run_failed`` 同款口径（failed + error_code +
    finished_at + output_redacted——``run_already_failed=True`` 表示 helper 已标，
    如 worktree 失败路径）；子会话收口 failed+ended_at（不残留活跃态，形态对齐
    ``session/service._converge_failed_dispatch``）。调用点均在 lease 创建前/无
    lease 在途，无 lease 收口需求。不抛——主 agent 从
    WorkerRunResponse.error_code 读原因自主决策补派/收敛，不崩 mission。
    """
    from app.modules.daemon.session_events import publish_sessions_changed

    if not run_already_failed:
        await mark_worker_run_failed(session, run, error_code=error_code, message=message)
    now = datetime.now(UTC)
    sub_session.status = "failed"
    sub_session.ended_at = now
    sub_session.last_active_at = now
    session.add(sub_session)
    await session.commit()
    await session.refresh(run)
    # publish 内部静默容错（redis 不可达不阻断失败收敛）
    await publish_sessions_changed("status_changed", sub_session.id, sub_session.user_id)


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

    task-05（2026-08-25-team-subsession-governance / FR-02 / design §5.B）：执行段
    从「建 batch AgentRun + MissionExecutionService.dispatch_worker」整体换子会话
    三元组——前置治理段逐项保留（scope 校验 / BE-P0-2 越权 / 档案校验 / 治理门 /
    resolve_representative_binding 在线预检），执行段：

    1. runtime 解析（D-004@v1）：anchor 本机自有 runtime 在线优先，无自有 →
       预检解析的代表 binding 以钉定模式传入（``pinned_skip_owner_check=True``，
       task-03 原语——代表机器属主常非 mission.created_by）；
    2. 子会话 + 首 run 落行（flush）：AgentSession(parent=mission.session_id,
       owner=mission.created_by) + 首 run(mission_id+role 双标记) + AgentRunWorkspace
       anchor∪target 双关联 + 首 prompt 的 user_input 日志行；
    3. ``prepare_worker_worktree``（task-02 共享 helper）三形态定 worker cwd——
       失败已由 helper 统一标 failed，此处收口子会话终态后返回失败响应；
    4. ``placement.prepare_interactive_dispatch``（flush-only 原语，task-03 扩展）
       建 interactive lease——stage=MISSION_WORKER_STAGE、worktree 副本路径作
       lease metadata cwd（claim payload root_path 源，创建时即定无补丁竞态）；
       事务内 ``_merge_lease_metadata`` 补 metadata.role + tool_config
       （read_only 物制口径与 batch 路径同源），回填三元组绑定字段后单 commit；
    5. 唤醒 daemon（``notify_interactive_dispatch``）——投递不可达仅告警不收敛
       （lease pending 等 daemon 轮询自领取，与 batch 路径同口径）；档案键
       best-effort 补写。
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

    # 冒烟修复①（ql-20260822-008）：目标工作区在线绑定预检——原先要到
    # worktree 阶段才 failed hostfs_unavailable（run 已落库成垃圾、主 agent
    # 拿不到可引导的信息）。owner 优先→任意在线（resolve_representative_binding
    # 与派发链路同一启发式）都查无在线 → 422 中文引导，不建 run。
    # 语义安全性：该函数返回 None 意味着全工作区（含创建者本人）无在线绑定，
    # 本人 binding 路径（placement）也必失败，前置拦截不误伤。
    from app.modules.workspace.member_runtimes.queries import (
        resolve_representative_binding,
    )

    dispatch_target = explicit_target or anchor
    # user_id 供 resolve 的 owner 分支过滤；懒建竞态 rollback 会 expire 会话内
    # 全部对象（含请求 user），过期属性访问触发隐式刷新在 greenlet 外炸
    # MissingGreenlet——捕获后回落 None（owner 分支 miss，走「任意在线」分支2
    # 兜底，绑定是工作区维度，语义不受影响）。
    try:
        dispatch_user_id = user.id
    except Exception:
        dispatch_user_id = None
    binding = await resolve_representative_binding(
        session,
        workspace_id=uuid.UUID(str(dispatch_target)),
        user_id=dispatch_user_id,
        provider=None,
    )
    if binding is None:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            "该工作区暂无在线机器绑定，分身无法在其上创建工作副本执行任务。"
            "请让该工作区绑定的守护进程上线后重试，或改选其它有在线绑定的"
            "工作区范围。",
        )

    # ── task-05（2026-08-25-team-subsession-governance / FR-02 / design §5.B）──
    # 执行段：子会话三元组派发（不再建 batch AgentRun / 不再调
    # MissionExecutionService.dispatch_worker / placement.dispatch_to_daemon；
    # 存量 batch 路径保留不删，bootstrap 等仍用）。
    from app.modules.agent.mission_context import build_worker_briefing
    from app.modules.agent.placement import NoOnlineDaemonError, RunPlacementService
    from app.modules.workspace.model import AgentRunWorkspace, Workspace
    from app.modules.workspace.service import resolve_root_path_for_daemon

    effective_target = dispatch_target
    # D-004@v1：分身归属 = mission 创建者（追问/权限卡片/门户/审计 owner-only 机制
    # 全部因归属正确而自然通）；存量 mission（bootstrap/external）created_by 可空，
    # 回落派发主体保底（行 NOT NULL）。
    owner_id = mission.created_by or user.id

    ws = await session.get(Workspace, effective_target)

    # 1) runtime 解析（D-004@v1）：anchor 本机自有在线优先（用户级 first-online，
    # provider 按 target workspace default_agent 匹配 + fallback）→ 无自有用上方
    # 预检解析的代表 binding 钉定。两条路都经 prepare_interactive_dispatch 的
    # 钉定复查（在线不可满足抛 NoOnlineDaemonError 绝不静默换机，Grill C-01）。
    placement_svc = RunPlacementService(session)
    target_provider = (ws.default_agent if ws is not None else None) or "claude"

    def _runtime_uuid(raw: object) -> uuid.UUID:
        return raw if isinstance(raw, uuid.UUID) else uuid.UUID(str(raw))

    own_rt = await placement_svc._get_online_runtime(owner_id, provider=target_provider)
    if own_rt is not None:
        pinned_runtime_id = _runtime_uuid(own_rt["id"])
        pinned_skip_owner_check = False  # 自有机器：属主校验天然通过
        lease_provider = own_rt.get("provider") or target_provider
    else:
        # 代表钉定：resolve_representative_binding 已保证在线；属主跳过由
        # pinned_skip_owner_check 表达（跨 ws 代表机器属主常非 mission.created_by）。
        pinned_runtime_id = _runtime_uuid(binding["id"])
        pinned_skip_owner_check = True
        lease_provider = binding.get("provider") or target_provider

    # delegate 构造前置（构造失败 fail-loud 503，零半成品行）。
    host_fs_delegate = new_host_fs_delegate(session)

    # 2) 子会话 + 首 run 落行（flush；与 lease 同事务收口，见 4) 的唯一 commit）。
    now = datetime.now(UTC)
    sub_session = AgentSession(
        user_id=owner_id,
        provider=lease_provider,
        status="pending",
        config={"manual_approval": False},
        turn_count=0,
        created_at=now,
        change_id=mission.change_id,
        workspace_id=effective_target,
        # task-04 / FR-02 / D-001@v1：会话树挂载——parent=主控会话
        # （mission.session_id；external mission 为 NULL 走存量回落）。
        parent_session_id=mission.session_id,
        agent_profile_id=(profile.id if profile is not None else None),
    )
    session.add(sub_session)
    await session.flush()

    first_run = AgentRun(
        mission_id=mission.id,
        change_id=mission.change_id,
        agent_type=payload.agent_type or "claude_code",
        provider=lease_provider,
        model=payload.model or (ws.default_model if ws is not None else None),
        status="pending",
        # 子会话形态首 run 与 create_session 首 turn 同款（interactive 驱动）。
        spec_strategy="interactive",
        role=role,
        objective=payload.objective,
        read_only=payload.read_only,
        # task-04（D-001@v2）：显式 target 落列供 finalizer merge/cleanup 分组。
        target_workspace_id=explicit_target,
        agent_profile_id=(profile.id if profile is not None else None),
        agent_profile_snapshot=(
            _build_agent_profile_snapshot(profile) if profile is not None else None
        ),
        # task-04 / FR-02 / design §5.A：首 run 双标记（mission_id + 分身 role）。
        agent_session_id=sub_session.id,
        user_id=owner_id,
    )
    session.add(first_run)
    await session.flush()

    # AgentRunWorkspace 关联行（ql-20260825-003 口径，对齐 execution.py 既有写法）：
    # anchor 与显式 target 都关联——前端 per-run 端点可能以任一 workspace 为路径
    # 前缀（_require_run_workspace 按 AgentRunWorkspace 授权）。
    for _link_ws_id in {anchor_workspace_id, effective_target}:
        session.add(AgentRunWorkspace(agent_run_id=first_run.id, workspace_id=_link_ws_id))
    await session.commit()

    # 3) worktree（task-02 共享 helper 三形态：git 探测 / direct 旁路 / worktree_add）。
    # 失败语义在 helper 内统一收敛（mark_worker_run_failed 标 failed + ok=False），
    # 此处收口子会话终态后直接返回失败响应，不进 lease 段（design §9 不崩 mission）。
    root_path = (
        resolve_root_path_for_daemon(ws.root_path) if ws is not None and ws.root_path else None
    )
    lease_branch = payload.branch
    if lease_branch is None:
        lease_branch = ws.default_branch if ws is not None else None
    if payload.worktree_path:
        # 路径A（caller worktree，D-008@v1）：caller 路径直接作子会话 cwd，
        # 跳过自建（helper 内部按 worktree_path 短路），不写 run.worktree_branch。
        root_path = payload.worktree_path
    wt_outcome = await prepare_worker_worktree(
        session,
        first_run,
        ws,
        host_fs_delegate=host_fs_delegate,
        root_path=root_path,
        lease_branch=lease_branch,
        worktree_path=payload.worktree_path,
    )
    if not wt_outcome.ok:
        log.info(
            "mcp_dispatch_worker_worktree_failed",
            mission_id=str(mission.id),
            run_id=str(first_run.id),
            git_mode=wt_outcome.git_mode,
        )
        await _fail_worker_subsession(
            session,
            sub_session,
            first_run,
            run_already_failed=True,
            error_code="worktree_create_failed",
            message="per-worker worktree 创建失败",
        )
        return WorkerRunResponse.model_validate(first_run)

    # 首 prompt：task-04 分身任务简报（objective + worktree/direct 约束变体 +
    # worker_done 用法；git 探测 unknown 时省略模式段）；caller 显式覆写优先
    # （路径A caller 注入约束，D-001 方案A）。
    briefing_mode = wt_outcome.git_mode if wt_outcome.git_mode in ("git", "direct") else None
    prompt = (
        payload.worker_prompt
        if payload.worker_prompt is not None
        else build_worker_briefing(
            objective=payload.objective,
            role=role,
            mode=briefing_mode,
        )
    )

    # 4) interactive lease（task-03 扩展形参：stage / pinned 钉定）。flush-only
    # 原语——lease 与上方行同事务，回填绑定字段后单 commit 收口三元组（无孤儿）。
    # worktree 副本路径经 cwd 参数在 lease 创建时即落 metadata（claim payload
    # root_path 源，context.build_claim_payload interactive 分支 cwd 优先），
    # 无 post-hoc 补丁竞态。
    try:
        dispatch = await placement_svc.prepare_interactive_dispatch(
            agent_session_id=sub_session.id,
            agent_run_id=first_run.id,
            user_id=owner_id,
            provider=lease_provider,
            prompt=prompt,
            model=first_run.model,
            workspace_id=effective_target,
            cwd=wt_outcome.root_path,
            pinned_runtime_id=pinned_runtime_id,
            pinned_skip_owner_check=pinned_skip_owner_check,
            stage=MISSION_WORKER_STAGE,
        )
    except NoOnlineDaemonError as exc:
        # 钉定复查竞态（预检通过后 runtime 掉线）：按失败语义收敛，不崩 mission。
        log.warning(
            "mcp_dispatch_worker_no_online_runtime",
            mission_id=str(mission.id),
            pinned_runtime_id=str(pinned_runtime_id),
            error=str(exc),
        )
        await _fail_worker_subsession(
            session,
            sub_session,
            first_run,
            error_code="no_online_daemon",
            message=str(exc),
        )
        return WorkerRunResponse.model_validate(first_run)
    except Exception as exc:
        # 兜底未预期异常（诊断 36b9b475 口径：杜绝静默 failed——首 run 带
        # error_code 终态，主 agent 可读原因决策补派，mission 不崩）。
        await session.rollback()
        log.warning(
            "mcp_dispatch_worker_exception",
            mission_id=str(mission.id),
            run_id=str(first_run.id),
            error=str(exc),
        )
        await _fail_worker_subsession(
            session,
            sub_session,
            first_run,
            error_code="dispatch_exception",
            message=str(exc),
        )
        return WorkerRunResponse.model_validate(first_run)

    # 事务内补 lease metadata（_merge_lease_metadata 不 commit，随三元组唯一
    # commit 原子落库）：
    # - role：stage 固定 MISSION_WORKER_STAGE 后 role 语义的落点（task-09 口径）；
    # - tool_config：read_only 物制（claim payload 透传，2026-08-06 verify 修复口径
    #   ——interactive lease 缺 tool_config 时 read_only 分身 Write/Bash 全放行），
    #   与 batch 路径 worker_tool_config 同源。
    from app.modules.daemon.session.service import _merge_lease_metadata

    _lease_meta_updates: dict = {
        "role": role,
        "tool_config": worker_tool_config(payload.read_only),
    }
    await _merge_lease_metadata(session, dispatch.lease_id, _lease_meta_updates)

    # 回填三元组绑定字段 + 激活（对齐 create_session 收口形态）。
    sub_session.runtime_id = dispatch.runtime_id
    sub_session.lease_id = dispatch.lease_id
    sub_session.status = "active"
    sub_session.turn_count = 1
    sub_session.last_active_at = now
    if wt_outcome.root_path:
        sub_session.cwd = wt_outcome.root_path
    session.add(sub_session)
    first_run.lease_id = dispatch.lease_id
    session.add(first_run)
    # 首 prompt 落一条 user_input 日志行（历史回看与 create_session 首 turn 同源）。
    session.add(
        AgentRunLog(
            run_id=first_run.id,
            channel="user_input",
            content_redacted=prompt[:5000],
            timestamp=now,
        )
    )
    await session.commit()
    await session.refresh(first_run)
    await session.refresh(sub_session)

    # 5) 唤醒 daemon + 列表信号。唤醒不可达不收敛——worker 派发对投递失败
    # 容忍（与 batch 路径同口径：lease pending 等 daemon 轮询/重连自领取，
    # runtime 在线判定已由预检+钉定复查把守；区别于用户会话 create_session 的
    # DaemonRuntimeOffline 收敛链——那是人对反馈即时性的要求）。
    from app.modules.daemon.session_events import publish_sessions_changed

    await publish_sessions_changed("created", sub_session.id, sub_session.user_id)
    await publish_sessions_changed("status_changed", sub_session.id, sub_session.user_id)

    delivered = await placement_svc.notify_interactive_dispatch(dispatch)
    if not delivered:
        log.warning(
            "mission_worker_subsession_wakeup_undelivered",
            mission_id=str(mission.id),
            run_id=str(first_run.id),
            lease_id=str(dispatch.lease_id),
            runtime_id=str(dispatch.runtime_id),
        )

    # 档案键 best-effort 补写（lease 在途，失败仅告警不收敛——与 batch 路径
    # _apply_worker_profile_to_lease 的兜底风格一致，不崩 mission）。
    if profile is not None:
        try:
            from app.modules.agent.service import AgentService

            await AgentService(session)._apply_profile_to_lease(dispatch.lease_id, profile)
        except Exception as exc:
            log.warning(
                "mcp_dispatch_worker_profile_apply_failed",
                mission_id=str(mission.id),
                run_id=str(first_run.id),
                lease_id=str(dispatch.lease_id),
                error=str(exc),
            )

    log.info(
        "mission_worker_subsession_dispatched",
        mission_id=str(mission.id),
        run_id=str(first_run.id),
        sub_session_id=str(sub_session.id),
        lease_id=str(dispatch.lease_id),
        runtime_id=str(dispatch.runtime_id),
        role=role,
        read_only=payload.read_only,
    )
    return WorkerRunResponse.model_validate(first_run)


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
    """列 mission 分身状态（双形态：子会话行 / 存量 batch run 行，主控轮不混入）。

    task-05：接入 X-Session-Id 会话定位（header 命中活跃 mission 时显式参数仅作
    越权校验锚；header 缺席零回归）。FR-09 补漏：行化口径见
    ``_list_workers_core``（与 ``_team_mission_summary`` workers 同源语义）。
    """
    mission = await _resolve_session_mission(
        session, request, user, workspace_id=workspace_id, mission_id=mission_id
    )
    return await _list_workers_core(session, mission)


async def _list_workers_core(session: AsyncSession, mission: AgentMission) -> WorkerListResponse:
    """list_workers 共用主体（显式路由 / 会话路由同构，task-05 抽取）。

    FR-09 验收补漏（2026-08-25-team-subsession-governance / design §1 痛点 1 /
    §5.C.5 / §5.E）：workers 数据源子会话行化，与 ``daemon/router.
    _team_mission_summary``（task-13）同口径双形态——

    - 新形态子会话行：``mission_worker_sessions``（task-01 单一真相源）一层
      枚举，每分身一行，行取首 run 双标记锚（mission_id+role 的最早 run）：
      ``id`` = 首 run id（供 ``get_worker_result`` 连续消费，对齐
      ``TeamMissionWorkerSummary.run_id`` 口径）、role/objective 取首 run、
      status 按 ``is_worker_complete``（task-08 单一真相源）映射三值——
      worker_done 且无活跃 turn → completed > 会话终态 failed → failed >
      其余（idle 未 done / 追问重开工中）→ running（idle 未 done 分身不再被
      首 run 终态遮蔽）；同根上一场已收敛 mission 的子会话（无本场首 run）
      不是本场分身，不进行；
    - 存量回落 batch run 行：mission run 剔除主控轮（``role !=
      'orchestrator'``，Python 比较 None != 'orchestrator' 为 True，NULL role
      分身天然保留——主控轮不混入，design §1 痛点 1 修复）与子会话 run
      （首 run 防同分身双计），行内容与既有形态一致（run 原始 status 透传）；
      追问轮次 run 无 mission_id 天然不进。

    ``WorkerListItem`` 现无 sub_session_id/first_run_id 字段（schema.py 单源，
    本卡不动）——新形态行 ``id`` 即首 run id 承担同语义。mission.py 延迟
    import（与 _converge_core 同款，避免循环 import）。
    """
    from app.modules.agent.mission import is_worker_complete

    stmt = select(AgentRun).where(AgentRun.mission_id == mission.id).order_by(AgentRun.created_at)
    runs = list((await session.execute(stmt)).scalars().all())

    worker_sessions = await mission_worker_sessions(session, mission.id)
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

    workers: list[WorkerListItem] = []
    for worker_session in worker_sessions:
        first_run = first_run_by_session.get(worker_session.id)
        if first_run is None:
            continue
        # status 三值映射对齐 mission_derive_status 虚拟 run 优先级（§5.C.4，
        # 与 _team_mission_summary 逐分支同构）：完成判定经 is_worker_complete
        # 单一真相源（§5.C.3，禁第三套口径）。
        if worker_session.worker_done_at is not None and await is_worker_complete(
            session, worker_session
        ):
            row_status = "completed"
        elif worker_session.status == "failed":
            row_status = "failed"
        else:
            row_status = "running"
        workers.append(
            WorkerListItem(
                id=first_run.id,
                role=first_run.role,
                status=row_status,
                objective=first_run.objective,
                total_cost_usd=first_run.total_cost_usd,
            )
        )

    # 存量回落：主控轮 + 子会话 run（含首 run）剔除后的 batch 分身 run 行。
    workers.extend(
        WorkerListItem.model_validate(r)
        for r in runs
        if r.role != "orchestrator" and r.agent_session_id not in sub_session_ids
    )
    return WorkerListResponse(mission_id=mission.id, workers=workers)


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

    0. **busy 前置**：分身未全完成（task-09 判据 = ``mission_derive_status(
       workers_only=True)`` 派生 running；分身 idle 未 done 不算全完成）→ 返
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

    1. **busy 前置判定**（task-09 / FR-05）：``mission_derive_status(
       workers_only=True)`` 派生 running（分身子会话经虚拟 run 映射——idle 未
       done / 追问重开工中均为 running，不被首 run 终态遮蔽；主控轮剔除，D-010
       语义保留）→ 返 ``status=busy`` + 引导文案（message 携未完成计数，计数经
       ``is_worker_complete`` 按对象形态分发）；mission 状态不变、不置
       ``converged_at``、不触发 finalize/merge（主 agent 等待后重试）。
    2. 分身全完成 → 以**最新 orchestrator run** 为锚调 ``converge_mission_for_completed_run``
       （``converge_explicit=True``：task-09 起内部判据同源 mission_derive_status
       (workers_only=True) + ``converged_at`` 原子抢占 UPDATE...WHERE IS NULL——
       **不依赖主控 run 状态**，会话 mission 主控轮当轮 running 也能收敛；execute
       冲突未解决时该入口回滚置位，保住会话活跃 mission 重入）。
    3. merge 结果（``_finalize_merge_for_mission``）有 pending_conflicts → 可重入
       conflict 状态机（attempt 计数 / R-07 超限 → ``needs_manual``，语义保留）；
       全 merged → cleanup + ``status=converged``。

    响应 ``status`` 四值 converged/busy/conflict/needs_manual（ConvergeResponse
    docstring）；cancelled/planning 等防御性派生值原样透传（busy 已前置挡 running）。
    """
    from app.modules.agent.control import MissionControlService
    from app.modules.agent.mission import is_worker_complete, mission_derive_status

    # --- 1. busy 前置判定（task-09 / FR-05：判据换 task-08 单一真相源）---
    # mission_derive_status(workers_only=True)：分身子会话映射虚拟 run（idle 未
    # done / 追问重开工中 → running，不被首 run 终态遮蔽）+ 存量 batch run 原样、
    # 主控轮剔除（D-010 语义保留）——非全终态派生 running → busy（零状态变更）；
    # planning（尚无分身）/ cancelled 原样透传，不进 busy 档。未完成计数文案口径
    # 保留：经 is_worker_complete 按对象形态分发（子会话 AgentSession / 存量
    # AgentRun）逐一判定，本处不再自持终态词表（design §5.C.5 / taskcard 铁律）。
    derive_value = await mission_derive_status(session, mission.id, workers_only=True)
    if derive_value == "running":
        ctrl = MissionControlService(session)
        worker_sessions = await mission_worker_sessions(session, mission.id)
        worker_session_ids = {s.id for s in worker_sessions}
        # 子会话首 run（agent_session_id ∈ 分身子会话）从 run 维度剔除，同分身
        # run/会话不双计（对齐 mission_derive_status 虚拟映射的同款剔除口径）。
        legacy_runs = [
            r
            for r in await ctrl.non_orchestrator_runs(mission.id)
            if r.agent_session_id not in worker_session_ids
        ]
        workers: list[AgentSession | AgentRun] = [*worker_sessions, *legacy_runs]
        active_workers = [w for w in workers if not await is_worker_complete(session, w)]
        total_workers = len(workers)
        log.info(
            "converge_mission_busy",
            mission_id=str(mission.id),
            active_workers=len(active_workers),
            total_workers=total_workers,
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
                f"还有 {len(active_workers)} 个分身任务未完成（共 {total_workers} 个），"
                "尚不能收敛：请等待全部分身到达终态后重试 converge，"
                "或先用 list_workers 查看各分身进度。"
            ),
        )

    # --- 2. 分身全完成 → 收敛（锚点=最新 orchestrator run，不依赖主控 run 状态）---
    main_run = await _get_main_run(session, mission.id)

    from app.modules.agent.delegation import GLMConfig
    from app.modules.agent.finalizer import converge_mission_for_completed_run

    cfg = GLMConfig.from_env()
    result_status = await converge_mission_for_completed_run(
        session, main_run.id, cfg, converge_explicit=True
    )
    # done/degraded/failed 均为分身全完成（failed=无一 completed 的全完成），
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


@router.post(
    "/workspaces/{workspace_id}/missions/{mission_id}/worker_done",
    response_model=WorkerDoneResponse,
)
async def worker_done(
    workspace_id: uuid.UUID,
    mission_id: uuid.UUID,
    payload: WorkerDoneRequest,
    request: Request,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> WorkerDoneResponse:
    """分身显式完成信号（task-07 / FR-04 / D-002@v1，design §5.C.2）。

    会话定位同 report_progress 模式（X-Session-Id 承载分身子会话身份，
    mission 解析沿 parent 链爬根）；置位 ``worker_done_at``、summary 落
    AgentArtifact 挂首 run、全分身完成迁移唤醒主控；迟到（mission 终态）409。
    """
    return await _worker_done_core(
        session,
        request,
        user,
        payload,
        workspace_id=workspace_id,
        mission_id=mission_id,
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
# task-07（2026-08-25-team-subsession-governance / FR-04 / D-002@v1 / design §5.C.2）：
# worker_done——分身显式完成信号（分身受限 MCP server 的唯一写入落点）。
# ---------------------------------------------------------------------------


async def _worker_first_run(
    session: AsyncSession, worker_session_id: uuid.UUID, mission_id: uuid.UUID
) -> AgentRun | None:
    """取分身子会话在 mission 下的**首 run**（design §5.A 双标记锚）。

    首 run = 该子会话下 ``mission_id=本 mission`` 且带 ``role`` 的最早 run
    （派发三元组写入的双标记，design §5.B）——summary artifact 挂载点，经
    ``mission_id`` join 使 ``_worker_artifacts`` / ``get_worker_result`` /
    Finalizer 合并链全部既有可见（零新查询路径）。追问轮 run 不写
    mission_id（归会话管），天然不命中。
    """
    stmt = (
        select(AgentRun)
        .where(
            AgentRun.agent_session_id == worker_session_id,
            AgentRun.mission_id == mission_id,
            AgentRun.role.is_not(None),
        )
        .order_by(AgentRun.created_at)
        .limit(1)
    )
    return (await session.execute(stmt)).scalars().first()


async def _worker_done_core(
    session: AsyncSession,
    request: Request,
    user: User,
    payload: WorkerDoneRequest,
    *,
    path_session_id: uuid.UUID | None = None,
    workspace_id: uuid.UUID | None = None,
    mission_id: uuid.UUID | None = None,
    enforce_workspace_permission: bool = False,
) -> WorkerDoneResponse:
    """worker_done 共用主体（四路由族同构，task-07 抽取，design §5.C.2）。

    会话定位与 report_progress 模式的差异：调用方是**分身子会话**（非主控
    会话）——子会话自身不落 ``AgentMission.session_id``，mission 解析走 task-01
    ``resolve_mission_for_session`` 沿 parent 链爬根，不复用
    ``_resolve_session_mission``（其按调用会话自身查活跃 mission，对子会话
    恒 miss 且无懒建语义）。

    判定序：

    1. X-Session-Id（header > 路径）缺席 → 400（worker_done 必须由分身会话
       发起，无显式路径回退形态）；
    2. 活跃 resolve miss 时含终态二次解析（``include_terminal=True``）：
       根上最新 mission 已 converged/cancelled → 记 warning 返 **409** 零写入
       零唤醒（迟到调用；区分 404=根上无 mission）；
    3. 显式参数仅作越权校验锚（mission_id 失配 404 资源隐藏；workspace_id
       复用 ``_get_mission`` anchor∪scope 口径；会话路由族按 mission 锚工作区
       复核 WORKSPACE_WRITE）；
    4. 调用会话必须 ∈ ``mission_worker_sessions``（分身一层枚举）——主控根
       会话 / 存量 batch 形态（无子会话）调用 → 422 拒绝零写入；
    5. 首 run 缺失（派发链路异常）→ fail-loud 404 零写入；
    6. 置位 ``worker_done_at=now()``（可重复置位取最新——追问重开工后再干
       再置位）+ summary 落 ``AgentArtifact(kind=summary)`` 挂首 run；
    7. 全分身完成迁移唤醒：按 ``mission_worker_sessions`` 枚举经
       ``is_worker_complete``（§5.C.3 单一真相源，禁第三套口径）判定全完成；
       本调用构成**新完成信号**（首信号，或重开工周期——上一 done 置位后
       会话下出现更新 run）且置位后全完成 → 先 DEL
       ``_WORKERS_DONE_NOTIFY_KEY``（``clear_workers_done_notify_key`` 单源）
       再调 ``notify_orchestrator_workers_done``（内部 SETNX），重复完成周期
       可再次唤醒；冗余重复调用（无新 turn）不重复唤醒。
    """
    sid = _request_session_id(request, path_session_id)
    if sid is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "缺少 X-Session-Id 会话头：worker_done 必须由分身子会话发起",
        )
    # 越权校验锚：路径参数优先，缺省回落 payload 显式参数（header-only 形态）
    anchor_workspace_id = workspace_id or payload.workspace_id
    anchor_mission_id = mission_id or payload.mission_id

    worker = await session.get(AgentSession, sid)
    if worker is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "session not found")

    # ── mission 解析：活跃 resolve miss → 含终态二次解析区分 409/404 ──
    mission = await resolve_mission_for_session(session, sid)
    if mission is None:
        terminal_mission = await resolve_mission_for_session(session, sid, include_terminal=True)
        if terminal_mission is not None and (
            terminal_mission.converged_at is not None or terminal_mission.cancelled_at is not None
        ):
            if anchor_mission_id is not None and anchor_mission_id != terminal_mission.id:
                raise HTTPException(status.HTTP_404_NOT_FOUND, "mission not found")
            if anchor_workspace_id is not None:
                await _get_mission(session, anchor_workspace_id, terminal_mission.id)
            if enforce_workspace_permission:
                await _check_workspace_write(session, user, terminal_mission.workspace_id)
            log.warning(
                "worker_done_late_rejected",
                mission_id=str(terminal_mission.id),
                session_id=str(sid),
            )
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                "该团队任务已收敛或已取消：worker_done 迟到调用被拒绝，未写入任何状态。",
            )
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "该会话当前没有活跃团队任务，无法调用 worker_done",
        )

    # ── 越权校验锚（活跃 mission）──
    if anchor_mission_id is not None and anchor_mission_id != mission.id:
        # 显式 mission_id 仅作越权校验锚：失配 → 404 资源隐藏（同 _resolve_session_mission）
        raise HTTPException(status.HTTP_404_NOT_FOUND, "mission not found")
    if anchor_workspace_id is not None:
        await _get_mission(session, anchor_workspace_id, mission.id)
    if enforce_workspace_permission:
        await _check_workspace_write(session, user, mission.workspace_id)

    # ── 调用会话必须是本 mission 的分身子会话（一层枚举单一真相源）──
    workers = await mission_worker_sessions(session, mission.id)
    if all(w.id != sid for w in workers):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "该会话不是本团队任务的分身子会话，无法调用 worker_done",
        )

    # ── 首 run 锚（缺失 = 派发链路异常，fail-loud 零写入）──
    first_run = await _worker_first_run(session, sid, mission.id)
    if first_run is None:
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            "分身首 run 不存在（派发链路异常），worker_done 拒绝写入",
        )

    # ── 置位 + summary 挂首 run（可重复置位取最新）──
    old_done_at = worker.worker_done_at
    now = datetime.now(UTC)
    worker.worker_done_at = now
    artifact = AgentArtifact(run_id=first_run.id, kind="summary", content_ref=payload.summary)
    session.add(worker)
    session.add(artifact)
    await session.commit()
    await session.refresh(worker)
    await session.refresh(artifact)

    # ── 全分身完成迁移唤醒（is_worker_complete 单源，design §5.C.3）──
    from app.modules.agent.mission import is_worker_complete

    all_done = all([await is_worker_complete(session, w) for w in workers])
    notified = False
    if all_done and mission.session_id is not None:
        # 本调用构成新完成信号的判定（false→true 迁移的完整覆盖）：
        # - 首信号：old_done_at 为 None（多分身首波 = 最后完成分身恰好一次触发）；
        # - 重开工周期：上一 done 置位后本会话出现更新的 run（追问轮），本轮
        #   done 是对新 turn 的完成信号——DEL 后 SETNX 支持重复完成周期再唤醒；
        # - 冗余重复调用（无新 turn）不重复唤醒（防烧主控 token）。
        is_new_signal = old_done_at is None
        if not is_new_signal:
            newer_stmt = (
                select(AgentRun.id)
                .where(AgentRun.agent_session_id == sid, AgentRun.created_at > old_done_at)
                .limit(1)
            )
            is_new_signal = (await session.execute(newer_stmt)).first() is not None
        if is_new_signal:
            # 成败统计口径同 is_worker_complete 词表：会话终态 failed/ended =
            # 失败，其余（done 且无活跃 turn，全完成判定已保证）= 成功。
            from app.modules.agent.mission import _WORKER_SESSION_TERMINAL
            from app.modules.agent.mission_context import (
                clear_workers_done_notify_key,
                notify_orchestrator_workers_done,
            )

            failed = sum(1 for w in workers if w.status in _WORKER_SESSION_TERMINAL)
            completed = len(workers) - failed
            await clear_workers_done_notify_key(mission.id)
            notified = await notify_orchestrator_workers_done(
                mission.id,
                mission.session_id,
                completed=completed,
                failed=failed,
            )

    return WorkerDoneResponse(
        mission_id=mission.id,
        session_id=sid,
        run_id=first_run.id,
        artifact_id=artifact.id,
        worker_done_at=worker.worker_done_at or now,
        all_workers_done=all_done,
        orchestrator_notified=notified,
    )


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
    """会话维度 list_workers——按会话活跃 mission 列分身（``_list_workers_core`` 双形态）。"""
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


@router.post(
    "/sessions/{session_id}/missions/worker_done",
    response_model=WorkerDoneResponse,
)
async def worker_done_for_session(
    session_id: uuid.UUID,
    payload: WorkerDoneRequest,
    request: Request,
    session: SessionDep,
    user: SessionMcpUser,
) -> WorkerDoneResponse:
    """会话维度 worker_done——X-Session-Id（header > 路径）承载分身子会话身份
    （design §5.C.2；task-07 分身受限 server 缺参调用形态的主路由）。"""
    return await _worker_done_core(
        session,
        request,
        user,
        payload,
        path_session_id=session_id,
        enforce_workspace_permission=True,
    )


# ---------------------------------------------------------------------------
# task-10 对齐路由族（2026-08-22-team-session-unify）：``/missions/{action}``
# （header-only）与 ``/missions/{mid}/{action}``（仅 mid）——daemon hub-client
# `_missionActionPath` 的两种缺参 URL 形态（ws/mid 可选化后 ws 缺省即落此二族），
# 与上方 /sessions/{sid}/missions/... 族共享同一批 core。三族差异只在身份来源：
# 本族无任何路径锚 → 会话身份完全由 X-Session-Id header 承载（缺失 → 400）；
# 仅 mid 族 header 缺席时按 mission 反解 + 锚工作区权限复核。
#
# 路由冲突说明（task-03 / 2026-08-24 修正）：mcp_tools include（router.py:940）
# **先于** ``GET /missions/{mission_id}``（router.py:946）注册——单段 GET
# （``/missions/workers``、``/missions/status``）按 Starlette 先注册先匹配，
# 在 mcp_tools 内命中，不会被 uuid 校验截走 422（旧注释所述「截走不可达 /
# include 于 :1451 之后」已随 include 顺序调整过时；见 test_mission_status.py
# 的单段可达性断言与 test_mcp_tools.py 原 xfail 用例转 XPASS）。
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
    # 单段 GET 可达：mcp_tools include（router.py:940）先于 GET /missions/{mission_id}
    # （:946）注册，先注册先匹配（task-03 注释修正，详见上方路由族说明）。
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


@router.post("/missions/worker_done", response_model=WorkerDoneResponse)
async def worker_done_scoped(
    payload: WorkerDoneRequest,
    request: Request,
    session: SessionDep,
    user: SessionMcpUser,
) -> WorkerDoneResponse:
    """header-only worker_done（``POST /missions/worker_done``）——会话身份完全由
    X-Session-Id header 承载（缺失 → 400）；payload 显式参数仅作越权校验锚。"""
    return await _worker_done_core(
        session, request, user, payload, enforce_workspace_permission=True
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


@router.post(
    "/missions/{mission_id}/worker_done",
    response_model=WorkerDoneResponse,
)
async def worker_done_by_mission(
    mission_id: uuid.UUID,
    payload: WorkerDoneRequest,
    request: Request,
    session: SessionDep,
    user: SessionMcpUser,
) -> WorkerDoneResponse:
    """仅 mid worker_done（``/missions/{mid}/worker_done``）——mid 为越权校验锚，
    分身会话身份仍由 X-Session-Id 承载（缺失 → 400）。"""
    return await _worker_done_core(
        session,
        request,
        user,
        payload,
        mission_id=mission_id,
        enforce_workspace_permission=True,
    )


# ---------------------------------------------------------------------------
# task-03（2026-08-24-session-team-mission-context / FR-02 / D-005@v1 / D-012@v1）：
# mission_status 常驻查询端点——GET /missions/status（header-only，对齐 daemon
# hub-client ``_missionActionPath`` 的 missionId 缺省形态，实际 URL
# /api/missions/status）+ GET /sessions/{sid}/missions/status（三族同构变体）。
# daemon 侧 mcp-server 工具注册归 task-11，本模块只提供 backend 路由。
#
# 定位**不走** _resolve_session_mission（其对无活跃 mission 抛 404，语义不符）：
# session.get(AgentSession)（缺失 404）+ get_active_mission_for_session；无活跃 →
# 200 active=false + hint（不泄露 scope/binding 信息，非 dispatch 端点不懒建）；
# 有活跃 → _check_workspace_write 按锚工作区复核后组装 MissionStatusResponse。
# ---------------------------------------------------------------------------

# 无活跃 mission 的引导文案（D-005：优雅返回不报错；不含任何 scope/binding 信息）
_NO_ACTIVE_MISSION_HINT = (
    "该会话当前没有活跃团队任务：可经派团队弹层预建，或直接 dispatch_worker 派发"
    "（将按会话绑定工作区懒建）。"
)


async def _mission_status_core(
    session: AsyncSession, sid: uuid.UUID, user: User
) -> MissionStatusResponse:
    """mission_status 共用主体（header-only / 会话路由同构，task-03）。

    组装口径（design §5.B / §7）：

    - ``mission_id/objective/budget_usd`` 直取 mission 列（objective 占位符原样）。
    - ``status`` 复用 task-08 包装 ``mission_derive_status``（design §5.C.4：
      分身子会话映射虚拟 run 后合并喂 ``derive_status``，子会话形态不被主控轮
      run 状态遮蔽；不新造状态机）——口径同 ``agent/router._mission_to_response``
      消费的派生家族。
    - ``scope_workspaces`` 经 task-01 ``collect_scope_workspace_statuses`` + task-02
      ``probe_workspace_git_mode`` 探测回调**每次调用实时探测**（不缓存，R-02；
      探测不可判定归 unknown，不向 caller 抛）；``anchor_workspace`` 取条目中
      ``id == mission.workspace_id`` 者（会话 mission 的 anchor 恒 ∈ scope——
      预建/懒建路径均自 scope 选锚，防御性缺失时为 None）。
    - ``workers`` 复用 ``_list_workers_core`` 返回的 ``.workers``（同源零漂移）。
    """
    agent_session = await session.get(AgentSession, sid)
    if agent_session is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "session not found")

    # task-09（FR-05）：status 源换 task-08 单一真相源 mission_derive_status——
    # 分身子会话经虚拟 run 映射（idle 未 done → running），子会话形态不再被
    # 主控轮 run 状态遮蔽；cancelled/converged/has_session/session_active_turn
    # 由包装内部查明（对齐 finalizer 口径：session_id 查无会话行 → 永不
    # awaiting_input）。
    from app.modules.agent.mission import get_active_mission_for_session, mission_derive_status

    mission = await get_active_mission_for_session(session, sid)
    if mission is None:
        # D-012：优雅返回 active=false（不走 _resolve_session_mission 的 404 语义）
        return MissionStatusResponse(active=False, hint=_NO_ACTIVE_MISSION_HINT)

    await _check_workspace_write(session, user, mission.workspace_id)

    status_value = await mission_derive_status(session, mission.id)

    # git 三态探测回调（task-02 helper 注入 task-01 收集器；delegate per-request
    # 构造，probe 内部把 transport 失败收敛为 "unknown" 不抛）
    delegate = new_host_fs_delegate(session)
    from app.modules.agent.orchestrator import collect_scope_workspace_statuses

    entries = await collect_scope_workspace_statuses(
        mission, session, git_probe=delegate.probe_workspace_git_mode
    )
    scope_items = [ScopeWorkspaceStatus.model_validate(entry) for entry in entries]
    anchor_workspace = next(
        (item for item in scope_items if item.id == str(mission.workspace_id)), None
    )

    worker_list = await _list_workers_core(session, mission)
    return MissionStatusResponse(
        active=True,
        mission_id=str(mission.id),
        status=status_value,
        objective=mission.objective,
        anchor_workspace=anchor_workspace,
        scope_workspaces=scope_items,
        workers=worker_list.workers,
        budget_usd=mission.budget_usd,
    )


@router.get("/missions/status", response_model=MissionStatusResponse)
async def missions_status_route(
    request: Request,
    session: SessionDep,
    user: SessionMcpUser,
) -> MissionStatusResponse:
    """header-only mission_status（``GET /missions/status``）——X-Session-Id 定位。

    本路由无任何路径锚，header 缺失 → 400（区别于仅 mid 族的显式回退路径）。
    """
    sid = _request_session_id(request, None)
    if sid is None:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "缺少 X-Session-Id 会话头：mission_status 查询必须携带该头",
        )
    return await _mission_status_core(session, sid, user)


@router.get(
    "/sessions/{session_id}/missions/status",
    response_model=MissionStatusResponse,
)
async def missions_status_for_session(
    session_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    user: SessionMcpUser,
) -> MissionStatusResponse:
    """会话维度 mission_status（``GET /sessions/{sid}/missions/status``，三族同构）。

    ``_request_session_id`` 既有 header>path 优先级（不一致 → 400 防歧义）。
    """
    sid = _request_session_id(request, session_id)
    if sid is None:
        # 防御分支：路径参数必在，正常流不可达
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "缺少 X-Session-Id 会话头：mission_status 查询必须携带该头",
        )
    return await _mission_status_core(session, sid, user)
