"""Team 主 agent 动态编排服务（2026-07-12-team-main-agent-orchestration D-001@v2）。

主 agent = 真 agent（走 daemon interactive lease + MCP tool），像项目经理：
读 worker 实际产出再决策（派/补/收敛）。本模块建主 agent run + 调度循环骨架，
完整三重收敛逻辑留 task-11，MCP tool 转发留 task-05/06。

旁路 GLM ``CoordinatorPlanner``：mode=team 时 ``create_mission`` 不调
``planner.plan``，改走 ``OrchestratorService.team_mission_entry`` 建主 agent run。
worker 由主 agent 通过 ``mcp_tools`` endpoint 动态 dispatch（不预先拆，D-002@v2）。

零回归：mode=single / None 仍走 ``MissionService.start_mission`` + GLM planner，
本模块完全不被触达。
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.modules.agent.model import AgentMission, AgentRun, AgentSession
from app.modules.agent.placement import NoOnlineDaemonError, RunPlacementService
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

if TYPE_CHECKING:
    from app.modules.workspace.model import Workspace

log = get_logger(__name__)

# 主 agent run 的 role 标记（model.role 自由字符串，task-02 已注释）。converge 链路
# （finalizer.py:206）要求 run.mission_id 非空才能触发收敛——主 agent run 必须写
# mission_id，role 仅作语义标记。
_ORCHESTRATOR_ROLE = "orchestrator"

# 会话预建 mission 的 objective 占位文案（2026-08-22-team-session-unify task-03 /
# design §8 CC-09）：objective 列 NOT NULL，预建时 objective 可空——落此占位，
# 首次 inject 后以首条团队指令文本回填（task-04 回填检测 import 本常量，勿重复定义）。
SESSION_OBJECTIVE_PLACEHOLDER = "（由会话首条团队指令定义）"

# Worker Run 终态集合（mission.py:26 _FAILED + completed）。schedule_loop 三重收敛
# 信号 1 用：所有 worker run（role != orchestrator）全终态 = 收敛条件之一。
_WORKER_TERMINAL = ("completed", "failed", "killed")

# 主 run 僵尸判死标记（2026-08-21-mission-converge-patrol design §2.3）：patrol 判死
# （task-05）写 run.error_code + mission.constraints 时间戳；复活（task-06）清标记。
# 全库新引入值——既有路径（no_online_daemon 等）不触发 schedule_loop 豁免分支。
_ZOMBIE_ERROR_CODE = "orchestrator_zombie"
_ZOMBIE_MARKED_AT_KEY = "zombie_marked_at"


def _zombie_exemption_active(mission: AgentMission) -> bool:
    """zombie 复活窗口是否未耗尽（task-08 豁免判定，D-006 纯 DB 时间窗）。

    ``constraints.zombie_marked_at``（ISO 字符串，patrol 判死写入）距今 <
    ``settings.mission_patrol_revive_window_minutes`` → True（信号 1 暂不收敛，等
    patrol 复活）。缺失 / constraints 为 None / 非法 ISO / 无时区锚点 → False——
    不猜时间，豁免不成立（对齐判死链路断链跳过语义），走原收敛逻辑。
    """
    raw = (mission.constraints or {}).get(_ZOMBIE_MARKED_AT_KEY)
    if not raw:
        return False
    try:
        marked_at = datetime.fromisoformat(str(raw))
    except ValueError:
        return False
    if marked_at.tzinfo is None:
        return False
    revive_window = timedelta(minutes=get_settings().mission_patrol_revive_window_minutes)
    return datetime.now(UTC) - marked_at < revive_window


# 默认主 agent 配置（main_agent_config 缺省时兜底）。agent_type 必须是 daemon 已知
# provider 名（"claude_code" 是 agent_type 不是 provider，placement.dispatch_to_daemon
# 会把 provider 落到 lease metadata，daemon 按 provider 路由；缺失时 daemon 兜底）。
_DEFAULT_AGENT_TYPE = "claude_code"
_DEFAULT_PROVIDER = "claude"


def _resolve_main_agent_config(
    main_agent_config: dict[str, Any] | None,
) -> dict[str, Any]:
    """从 main_agent_config 抽出 agent_type / provider / model / agent_profile_id，缺省兜底。

     main_agent_config 形如 ``{agent_type, provider, model, agent_profile_id}``
    （D-003@v2 + 2026-08-02-agent-profile-layer task-12）。agent_type/provider/model
     任一缺失走默认值，保证主 agent run 永远有可执行的 agent_type（NOT NULL 约束）。
     agent_profile_id 缺失/非法 → None（软约束兜底，design §8）。
    """
    cfg = main_agent_config or {}
    raw_profile_id = cfg.get("agent_profile_id")
    resolved_profile_id: uuid.UUID | None = None
    if raw_profile_id:
        try:
            resolved_profile_id = uuid.UUID(str(raw_profile_id))
        except (ValueError, AttributeError, TypeError):
            resolved_profile_id = None
    return {
        "agent_type": str(cfg.get("agent_type") or _DEFAULT_AGENT_TYPE),
        "provider": str(cfg.get("provider") or _DEFAULT_PROVIDER),
        "model": str(cfg.get("model")) if cfg.get("model") else "",
        "agent_profile_id": resolved_profile_id,
    }


# 禁越权约束文案（2026-08-24-session-team-mission-context task-01 抽出）：
# render_orchestrator_prompt 与 render_session_orchestrator_briefing 共用同一原文，
# 收敛到单一常量避免两处漂移（task 卡要求复用 :215-224 既有文案，改文案须同步两消费方）。
_ORCHESTRATOR_CONSTRAINTS_TEXT = (
    "【硬性约束 — 禁止越权下场（必须遵守，违反即任务失败）】\n"
    "你是项目经理（orchestrator），不是实现者。严禁自己用 Edit/Write/Bash 修改任何实现源码"
    "（backend / frontend / sillyhub-daemon 的业务代码、测试、配置、迁移脚本）。需要写代码 → "
    "必须 dispatch_worker 派 worker 去写（worker 在独立工作间产出 commit，由 converge 合并）。\n"
    "唯一例外：当 converge_mission 返回 status=conflict（合并冲突）时，才允许用 Edit 修改冲突"
    "文件解决冲突，且只动冲突标记涉及的行。\n"
    "若 list_workers 发现 worker 全部 failed（如 worktree_create_failed / no_online_daemon，"
    "说明无在线 daemon 承接 worker）→ 不要自己下场写代码！先 report_progress 说明失败原因，"
    "再调 converge_mission 结束 mission，把决策交还用户处理 daemon。\n"
    "Read / Glob / Grep 与只读 Bash（git log / ls / grep 等查询命令）仅用于调研，允许。\n"
)

# scope git 模式探测回调签名（task-01）：接收 Workspace 行、返回 "git"|"direct"|"unknown"。
# 探测本身由 task-02 helper（host_fs/delegate.probe_workspace_git_mode）提供，task-03/06
# 接线注入——本模块只消费回调结果，不引入 host_fs 依赖（patrol 路径永远不传）。
GitModeProbe = Callable[[Any], Awaitable[str]]

# git 模式三态 → 简报展示文案（design §5.D）。仅当调用方传入探测回调才渲染模式字段；
# 未传时字段整体省略（不渲染「模式=未知」，CC-08 patrol 等价口径）。
_GIT_MODE_LABELS = {"git": "git隔离", "direct": "直通", "unknown": "未知"}


async def collect_single_workspace_status(
    session: AsyncSession,
    ws: Workspace,
    *,
    git_probe: GitModeProbe | None = None,
) -> dict[str, Any]:
    """收集单个工作区的结构化状态条目（task-01 收集口径的单一来源）。

    ``collect_scope_workspace_statuses``（mission scope 循环）与 workspace
    probe 端点（task-10，无 mission 上下文、直接对传入 workspace_ids 收集）
    共用本函数——机器名/在线/git 模式三字段口径单一来源，禁两处复制粘贴
    漂移（UB-2 / D-008@v2：probe 与简报/mission_status 完全同源）。

    条目字段（与 collect_scope_workspace_statuses 文档一致）：

    - ``id/name/type/description``：Workspace 行原样（id 转 str，JSON 友好）。
    - ``daemon_online``：任一成员 WorkspaceMemberRuntime（daemon_id 非空首行）+
      ``query_daemon_online_by_id`` + binding 属主 user_id（BE-P1-5 修正口径，
      禁回退全零 UUID 占位）。
    - ``daemon_name``：该 binding daemon 的 ``display_alias or hostname``（未绑 /
      daemon 行缺失 → None）。「任一成员 binding，不限本人」与 §5.C probe 端点
      同一口径（UB-2）。
    - ``git_mode``：仅当调用方传入 ``git_probe`` 探测回调时存在（"git"|"direct"|
      "unknown" 原始三态）——本模块不实现探测本身（task-02 helper，task-03/06
      接线）。
    """
    from app.modules.daemon.model import DaemonInstance
    from app.modules.workspace.member_runtimes.queries import query_daemon_online_by_id

    # 任一成员 binding（daemon_id 非空首行）→ 该工作区源码宿主 daemon。
    runtime = (
        (
            await session.execute(
                select(WorkspaceMemberRuntime).where(
                    WorkspaceMemberRuntime.workspace_id == ws.id,
                    WorkspaceMemberRuntime.daemon_id.isnot(None),
                )
            )
        )
        .scalars()
        .first()
    )
    daemon_online = False
    daemon_name: str | None = None
    if runtime is not None and runtime.daemon_id is not None:
        # BE-P1-5（2026-08-21 审查）：query_daemon_online_by_id 的 SQL 含
        # ``AND user_id = :uid``，必须传 binding 属主的 user_id——原全零 UUID
        # 占位会恒 None，scope 清单一律误显示「离线」。
        online_daemon = await query_daemon_online_by_id(session, runtime.daemon_id, runtime.user_id)
        daemon_online = online_daemon is not None
        daemon_row = await session.get(DaemonInstance, runtime.daemon_id)
        if daemon_row is not None:
            # 机器名口径：display_alias 优先，缺省回退 hostname（弹层/简报/probe 同源）。
            daemon_name = daemon_row.display_alias or daemon_row.hostname
    entry: dict[str, Any] = {
        "id": str(ws.id),
        "name": ws.name,
        "type": ws.type,
        "description": ws.description,
        "root_path": ws.root_path,
        "daemon_online": daemon_online,
        "daemon_name": daemon_name,
    }
    if git_probe is not None:
        entry["git_mode"] = await git_probe(ws)
    return entry


async def collect_scope_workspace_statuses(
    mission: AgentMission,
    session: AsyncSession,
    *,
    git_probe: GitModeProbe | None = None,
) -> list[dict[str, Any]]:
    """收集 mission 派发范围工作区的结构化状态（task-01 / FR-01 / design §5.A、§5.C）。

    遍历 ``mission.scope_workspace_ids``（无效 uuid 跳过，沿用原
    render_orchestrator_prompt scope 段语义），逐工作区经
    :func:`collect_single_workspace_status` 收集（口径单一来源，task-10 probe
    端点共用同一函数）：

    - ``id/name/type/description``：Workspace 行原样（id 转 str，JSON 友好）。
    - ``daemon_online``：任一成员 binding 解析在线态（详见共享函数）。
    - ``daemon_name``：binding daemon 的 ``display_alias or hostname``（任一
      成员 binding，不限本人，UB-2）。
    - ``git_mode``：仅当调用方传入 ``git_probe`` 探测回调时存在（"git"|"direct"|
      "unknown" 原始三态）。

    消费方：render_scope_brief / render_session_orchestrator_briefing（本文件）、
    mission_status 路由（task-03）、probe 端点（task-10）。
    """
    from app.modules.workspace.model import Workspace

    entries: list[dict[str, Any]] = []
    if not mission.scope_workspace_ids:
        return entries
    for ws_id_str in mission.scope_workspace_ids:
        try:
            ws_id = uuid.UUID(ws_id_str)
        except (ValueError, TypeError):
            # 忽略无效的 workspace id（沿用原实现语义）
            continue
        ws = await session.get(Workspace, ws_id)
        if ws is None:
            continue
        entries.append(await collect_single_workspace_status(session, ws, git_probe=git_probe))
    return entries


async def render_scope_brief(
    mission: AgentMission,
    session: AsyncSession,
    *,
    git_probe: GitModeProbe | None = None,
) -> str:
    """渲染派发范围工作区清单（每工作区一行，task-01 / design §5.A）。

    行格式：``- <name>（id=..., path=<root_path>, type=..., desc=..., 机器=<display_alias||hostname>,
    daemon=在线|离线[, 模式=git隔离|直通|未知]）``——type/description 为空时省略；
    未绑机器显示「未绑机器」；``git_probe`` 未传时模式字段整体省略（不渲染
    「模式=未知」）。返回值只含工作区行（无标题/尾注，调用方自行组装），
    无有效工作区时返回空串。

    render_orchestrator_prompt（patrol 路径）不传 git_probe——输出与改前结构等价，
    仅新增机器名字段（design §9 CC-08 口径）。
    """
    entries = await collect_scope_workspace_statuses(mission, session, git_probe=git_probe)
    lines: list[str] = []
    for entry in entries:
        line = f"- {entry['name']}（id={entry['id']}, path={entry['root_path']}"
        if entry["type"]:
            line += f", type={entry['type']}"
        if entry["description"]:
            line += f", desc={entry['description']}"
        line += f", 机器={entry['daemon_name'] or '未绑机器'}"
        line += f", daemon={'在线' if entry['daemon_online'] else '离线'}"
        git_mode = entry.get("git_mode")
        if git_mode is not None:
            line += f", 模式={_GIT_MODE_LABELS.get(git_mode, str(git_mode))}"
        lines.append(line + "）")
    return "\n".join(lines)


async def render_session_orchestrator_briefing(
    mission: AgentMission,
    session: AsyncSession,
    *,
    git_probe: GitModeProbe | None = None,
) -> str:
    """渲染会话主控首轮任务简报（task-01 / FR-01 / D-004@v1，design §5.A、§7）。

    预建 mission 后首个主控轮的 prompt 前缀（inject/create 两路径共用，task-06/08
    接线组装 ``简报 + "\\n\\n---\\n\\n" + 用户消息``）：主控角色说明 + mission_id +
    目标 + 锚点工作区（mission.workspace_id 对应 ws 名与 id）+ 派发范围（调
    render_scope_brief，scope 行缩进两格）+ dispatch_worker 用法（跨工作区必传
    target_workspace_id）+ mission_status 工具提示 + 禁越权约束（复用
    ``_ORCHESTRATOR_CONSTRAINTS_TEXT``，与 render_orchestrator_prompt 同一原文）。
    """
    from app.modules.workspace.model import Workspace

    anchor_ws = await session.get(Workspace, mission.workspace_id)
    if anchor_ws is not None and anchor_ws.name:
        anchor_line = f"{anchor_ws.name}（{mission.workspace_id}, 路径: {anchor_ws.root_path}）"
    else:
        anchor_line = str(mission.workspace_id)

    parts = [
        "【团队任务简报（系统注入，仅此一次）】",
        "你是本会话团队任务的主控（orchestrator/项目经理）。",
        f"- mission_id: {mission.id}",
        f"- 目标: {mission.objective}",
        f"- 锚点工作区: {anchor_line}",
    ]
    scope_brief = await render_scope_brief(mission, session, git_probe=git_probe)
    if scope_brief:
        parts.append("- 派发范围:")
        parts.extend(f"  {line}" for line in scope_brief.splitlines())
    parts.append(
        "派发: dispatch_worker(objective, role?, target_workspace_id=…)；跨工作区必传 target_workspace_id。"
    )
    parts.append("最新机器状态随时可查: mission_status 工具。")
    return "\n".join(parts) + "\n" + _ORCHESTRATOR_CONSTRAINTS_TEXT


async def render_orchestrator_prompt(
    mission: AgentMission,
    orchestrator_run: AgentRun,
    session: AsyncSession,
) -> str:
    """渲染主 agent 首轮 prompt（关键标识 + objective + worker_preset + 项目上下文 + 工具用法）。

    主 agent 是真 agent，首轮拿到 mission 目标 + 用户预设 worker 列表 + 关键标识
    （workspace_id / mission_id / orchestrator run_id），自主决定派哪些 worker /
    何时收敛。MCP tool（task-05/06）让主 agent 通过反向 endpoint 派 worker / 读产出 /
    收敛；5 个 tool 的 inputSchema 都要 workspace_id + mission_id（report_progress
    还要 run_id），主 agent 必须从 prompt 拿到这些 id（环境变量里没有，e2e 发现）。

    项目上下文注入（task-06 / design §4.4）：
    - 项目名：mission.project_id → PpmProjectMaintenance.project_name
    - scope 清单：各 workspace 的 id/name/type/description/在线状态
    - dispatch_worker 用法：target_workspace_id 参数说明
    """
    preset_hint = ""
    if mission.worker_preset:
        roles = [
            str(w.get("role") or w.get("agent_type") or "worker") for w in mission.worker_preset
        ]
        preset_hint = (
            f"\n用户预设 worker 角色：{', '.join(roles)}\n按需通过 dispatch_worker MCP 工具派发。"
        )

    # 项目名上下文（task-06）
    project_context = ""
    if mission.project_id is not None:
        from app.modules.ppm.project.model import PpmProjectMaintenance

        result = await session.execute(
            select(PpmProjectMaintenance.project_name).where(
                PpmProjectMaintenance.id == mission.project_id
            )
        )
        row = result.first()
        if row and row[0]:
            project_context = f"\n项目名：{row[0]}"

    # scope 清单（task-06；task-01 抽共享渲染——本路径不传 git_probe，模式字段省略，
    # 输出与改前结构等价+新增机器名字段，patrol 调用零影响 / design §9 CC-08 口径）
    scope_context = ""
    if mission.scope_workspace_ids:
        scope_brief = await render_scope_brief(mission, session)
        if scope_brief:
            scope_context = "\n派发范围（可落地的工作区）：\n" + scope_brief
            scope_context += "\n按任务性质选工作区：前端任务传前端工作区 id，后端任务传后端工作区 id（通过 dispatch_worker 的 target_workspace_id 参数）。"

    return (
        f"你是多 Agent 团队的主 agent（项目经理，role=orchestrator）。\n"
        f"关键标识（调用下方 MCP 工具时按需传入）：\n"
        f"- workspace_id：`{mission.workspace_id}`\n"
        f"- mission_id：`{mission.id}`\n"
        f"- 主 agent run_id（report_progress 的 run_id 参数）：`{orchestrator_run.id}`\n"
        f"{project_context}\n"
        f"团队目标：{mission.objective}\n"
        f"{preset_hint}"
        f"{scope_context}\n\n"
        "你的职责：拆解目标 → 派 worker → 读 worker 产出 → 判断是否达成 → 收敛。\n"
        "可用 MCP 工具（stdio 注入）：\n"
        "- dispatch_worker(workspace_id, mission_id, objective, role?, target_workspace_id?, ...)：派一个 worker（target_workspace_id 指定落地工作区，跨 ws 派发必传）\n"
        "- get_worker_result(workspace_id, mission_id, worker_id)：读指定 worker 产出\n"
        "- list_workers(workspace_id, mission_id)：列 mission 所有 worker 状态\n"
        "- converge_mission(workspace_id, mission_id)：全部 worker 终态后收敛\n"
        "- report_progress(workspace_id, mission_id, run_id, message, decision?)：落决策日志\n\n"
        f"{_ORCHESTRATOR_CONSTRAINTS_TEXT}"
    )


class OrchestratorService:
    """Team 主 agent 编排服务（D-001@v2）。

    职责：
    - ``team_mission_entry``：建 AgentMission（含 worker_preset/main_agent_config 落库）；
      team 模式另建主 agent AgentRun（role=orchestrator, mission_id 非空）+ 派
      daemon lease；external / session 模式只建 mission 不 spawn（见方法 docstring）。
    - ``_precreate_mission_flush``（task-04 / D-009@v2）：flush-only 预建 helper
      （add+flush 不 commit），``team_mission_entry`` 与 task-09 create 路径共用。
    - ``schedule_loop``：主 agent 调度循环骨架（三重收敛骨架，完整逻辑 task-11）。

    与 GLM planner 链路互斥：mode=team 走本服务，mode=single/None 走
    ``MissionService.start_mission``。
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def _precreate_mission_flush(
        self,
        *,
        workspace_id: uuid.UUID,
        objective: str,
        created_by: uuid.UUID | None,
        change_id: uuid.UUID | None,
        constraints: dict[str, Any] | None,
        budget_usd: float | None,
        worker_preset: list[dict] | None,
        main_agent_config: dict[str, Any] | None,
        orchestration_mode: str = "team",
        scope_workspace_ids: list[uuid.UUID] | None = None,
        project_id: uuid.UUID | None = None,
        session_id: uuid.UUID | None = None,
    ) -> AgentMission:
        """flush-only 预建 mission：校验 + 构造 + ``add + flush``，**不 commit 不 refresh**。

        task-04（2026-08-24-session-team-mission-context / D-009@v2 / Grill UB-1）：
        从 ``team_mission_entry`` 抽出的预建 helper。承载原校验与构造——session
        预建模式必传 session_id 的 ValueError、external 模式 constraints 合并
        ``orchestration_mode``、session 模式空 objective 落
        ``SESSION_OBJECTIVE_PLACEHOLDER``、scope_workspace_ids uuid→str——事务边界
        收窄为 flush（PK 已可用），把 commit 决策权交还调用方：

        - ``team_mission_entry``（本体 = helper + commit + refresh）：既有
          trigger 端点 / 懒建 / external 调用方零回归；
        - task-09 create 路径：在首 run 创建前调用，共用 ``create_session``
          唯一 commit（service.py:1008 commit / :1011 rollback）——失败整体
          回滚，无孤儿 session/mission（R-04 闭案）。

        只做预建：不建主控 run、不派 lease、不渲染 prompt（orchestration_mode
        分支逻辑留在 ``team_mission_entry`` 本体）。
        """
        if orchestration_mode == "session" and session_id is None:
            raise ValueError("session 预建模式必须传 session_id（mission.session_id 锚点）")

        merged = dict(constraints or {})
        # external 模式（路径A / SillySpec 外部调度）：把 mode 落进 mission.constraints
        # 供 converge 检测（task-03 finalizer 查 orchestration_mode=="external" 跳过
        # finalize/cleanup）。team 模式不落——merged 与改动前字节一致（零回归）。
        if orchestration_mode == "external":
            merged["orchestration_mode"] = "external"

        # session 预建模式（task-03 / CC-09）：objective 可空 → 落占位常量（首条
        # inject 回填，task-04）。旧模式 objective 由 DTO 强制非空，不受影响。
        effective_objective = objective
        if orchestration_mode == "session" and not (objective and objective.strip()):
            effective_objective = SESSION_OBJECTIVE_PLACEHOLDER

        # 转换 scope_workspace_ids（uuid → str 存 JSON 列）
        scope_workspace_ids_str: list[str] | None = None
        if scope_workspace_ids:
            scope_workspace_ids_str = [str(sid) for sid in scope_workspace_ids]

        mission = AgentMission(
            workspace_id=workspace_id,
            # session 预建模式传会话锚点；team/external 模式 None 透传
            # （验收返工 QA P1：session_id 已改 nullable，external mission
            # 无会话，随机 uuid 会违反 FK 压断 PG 上的存量创建链路）。
            session_id=session_id,
            change_id=change_id,
            objective=effective_objective,
            constraints=merged or None,
            budget_usd=budget_usd,
            worker_preset=worker_preset,
            main_agent_config=main_agent_config,
            created_by=created_by,
            scope_workspace_ids=scope_workspace_ids_str,
            project_id=project_id,  # task-07：跨 workspace mission 项目关联
        )
        self._session.add(mission)
        # flush-only（D-009@v2）：flush 后 PK 已可用；commit/refresh 留给调用方
        # ——插入 create_session 单 commit 事务时不提前提交（无孤儿数据）。
        await self._session.flush()
        return mission

    async def team_mission_entry(
        self,
        *,
        workspace_id: uuid.UUID,
        objective: str,
        created_by: uuid.UUID | None,
        change_id: uuid.UUID | None,
        constraints: dict[str, Any] | None,
        budget_usd: float | None,
        worker_preset: list[dict] | None,
        main_agent_config: dict[str, Any] | None,
        orchestration_mode: str = "team",
        scope_workspace_ids: list[uuid.UUID] | None = None,
        project_id: uuid.UUID | None = None,
        session_id: uuid.UUID | None = None,
    ) -> tuple[AgentMission, AgentRun | None]:
        """建 mission；team 模式还建主 agent run + 派 daemon lease。

        ``project_id``（task-07，2026-08-19-cross-workspace-team-mission）：项目维度 mission
        关联项目 ID，单 workspace mission 可空（零回归）。跨 ws mission 必填。

        ``session_id``（2026-08-22-team-session-unify task-03）：发起会话锚点
        （mission.session_id 列，D-006@v1）。仅 ``"session"`` 预建模式必传；
        team/external 旧模式不传 → 列 default_factory 兜底随机 uuid（零回归）。

        ``orchestration_mode`` 取值：
        - ``"team"``（默认，零回归）：复用 ``MissionService.start_mission`` 的持久化
          模式（mission.py:98-125），但不调 GLM planner，主 agent run 单条
          role=orchestrator + 派 daemon lease，返回 ``(mission, main_run)``。
        - ``"external"``（路径A / SillySpec 外部调度，design §7.1 D-007@v1）：只建
          mission（constraints 落 ``{"orchestration_mode": "external"}``），**跳过**
          主 agent run + daemon lease——caller 在自己的 worktree 用 dispatch_worker
          自主派 worker，返回 ``(mission, None)``。不加 DB 列，constraints JSON 复用
          （model.py:601）。
        - ``"session"``（task-03 会话预建，design §5 Phase 1）：只建 mission
          （session_id 落列 + scope/project/budget/preset/main_agent_config 冻结
          快照），objective 空落 ``SESSION_OBJECTIVE_PLACEHOLDER``（CC-09）；**跳过**
          主 agent run + daemon lease + render_orchestrator_prompt——主控轮由会话
          inject 当轮回填 mission_id+role='orchestrator'（task-04 双标记），返回
          ``(mission, None)``。

        team 模式 daemon 离线 / workspace 未绑定时，``dispatch_to_daemon`` 抛
        ``NoOnlineDaemonError``——本方法捕获并把主 agent run 标记 ``pending``
        + ``error_code="no_online_daemon"``，不抛错（mission 仍建，后续靠
        ``redispatch_pending_main_runs`` 启动重派兜底——BE-P1-6，2026-08-21 审查
        接线，main.py lifespan startup 调用）。这与 single 模式 dispatch_worker
        失败语义一致（router.py:783-784）。external 模式不调 dispatch_to_daemon，
        不存在该异常路径。

        task-04（D-009@v2）：mission 预建（校验+构造）抽到 flush-only helper
        ``_precreate_mission_flush``，本体 = helper + commit + refresh——既有
        调用方（trigger 端点 / mcp_tools 懒建 / external）零回归。
        """
        mission = await self._precreate_mission_flush(
            workspace_id=workspace_id,
            objective=objective,
            created_by=created_by,
            change_id=change_id,
            constraints=constraints,
            budget_usd=budget_usd,
            worker_preset=worker_preset,
            main_agent_config=main_agent_config,
            orchestration_mode=orchestration_mode,
            scope_workspace_ids=scope_workspace_ids,
            project_id=project_id,
            session_id=session_id,
        )
        await self._session.commit()
        await self._session.refresh(mission)

        # session 预建模式（task-03 / design §5 Phase 1）：只建 mission——不建主控
        # AgentRun、不派 daemon lease、不渲染 prompt。主控轮 = 会话 inject 当轮回填
        # 双标记（task-04），worker 由常驻 MCP 工具动态派（task-05）。约束键不写入
        # constraints（design §8：constraints 的 session_id 死参数废弃）。
        if orchestration_mode == "session":
            log.info(
                "orchestrator_mission_session_prebuilt",
                mission_id=str(mission.id),
                session_id=str(session_id),
                scope_workspace_ids=mission.scope_workspace_ids,
                project_id=str(project_id) if project_id else None,
                worker_preset_len=len(worker_preset) if worker_preset else 0,
            )
            return mission, None

        # external 模式：只建 mission，**跳过 orchestrator run + daemon lease**——
        # caller（SillySpec execute）在自己的 worktree 用 dispatch_worker 派 worker
        # 自主驱动，不需要 SillyHub spawn 无人驱动的僵尸 orchestrator（design §7.1
        # D-007@v1，解 P0-2）。team 模式不进此分支，仍走原 spawn + lease 逻辑零回归。
        if orchestration_mode == "external":
            log.info(
                "orchestrator_mission_external_started",
                mission_id=str(mission.id),
                orchestration_mode=orchestration_mode,
                worker_preset_len=len(worker_preset) if worker_preset else 0,
            )
            return mission, None

        cfg = _resolve_main_agent_config(main_agent_config)
        main_run = AgentRun(
            mission_id=mission.id,
            change_id=change_id,
            agent_type=cfg["agent_type"],
            provider=cfg["provider"] or None,
            model=cfg["model"] or None,
            status="pending",
            role=_ORCHESTRATOR_ROLE,
            objective=objective,
            # task-12 / 2026-08-02-agent-profile-layer：主 agent run 绑定用户指定的
            # AgentProfile（来自 main_agent_config.agent_profile_id，软约束兜底 §8）。
            # None → 不绑定，dispatch 走 workspace.default_agent_profile_id 兜底链。
            agent_profile_id=cfg["agent_profile_id"],
        )
        self._session.add(main_run)
        await self._session.commit()
        await self._session.refresh(main_run)

        # 派 daemon lease（interactive 永不过期，lease/service.py:186）。主 agent run
        # 派 lease 仿 execution.dispatch_worker（调 dispatch_to_daemon，传 prompt +
        # workspace 上下文）。daemon 离线 / 未绑定时捕获，run 留 pending 待重派。
        lease_id: uuid.UUID | None = None
        try:
            placement = RunPlacementService(self._session)
            lease_id = await placement.dispatch_to_daemon(
                main_run.id,
                created_by,
                workspace_id=workspace_id,
                provider=cfg["provider"] or None,
                model=cfg["model"] or None,
                prompt=await render_orchestrator_prompt(mission, main_run, self._session),
                stage=_ORCHESTRATOR_ROLE,
                read_only=False,
                # task-12：透传主 agent profile id（task-05 dispatch_to_daemon 已接参，
                # 用于 target_provider 解析 + lease metadata 透传）。None 走原路径零回归。
                agent_profile_id=cfg["agent_profile_id"],
            )
        except NoOnlineDaemonError as exc:
            main_run.error_code = "no_online_daemon"
            main_run.output_redacted = exc.message
            self._session.add(main_run)
            await self._session.commit()
            await self._session.refresh(main_run)
            log.warning(
                "orchestrator_dispatch_no_online_daemon",
                mission_id=str(mission.id),
                run_id=str(main_run.id),
                message=exc.message,
            )
        else:
            if lease_id is None:
                log.warning(
                    "orchestrator_dispatch_returned_none",
                    mission_id=str(mission.id),
                    run_id=str(main_run.id),
                )

        log.info(
            "orchestrator_mission_started",
            mission_id=str(mission.id),
            main_run_id=str(main_run.id),
            role=_ORCHESTRATOR_ROLE,
            worker_preset_len=len(worker_preset) if worker_preset else 0,
            lease_id=str(lease_id) if lease_id else None,
        )
        return mission, main_run

    async def redispatch_pending_main_runs(self) -> int:
        """启动兜底：重派 ``pending + no_online_daemon`` 的主 agent run（BE-P1-6）。

        2026-08-21 审查发现：daemon 离线时创建的 mission 主 run 标 pending +
        error_code=no_online_daemon 后无任何重派触发点 → derive_status 永远
        running、mission 挂死。本方法由 main.py lifespan startup 调用（对齐
        cleanup_stale_runs / gate reconcile 的启动 reconcile 模式），对 daemon
        已恢复的场景重派一次；daemon 仍离线的 run 保持 pending 留待下次启动。
        常驻轮询重派不在本次范围（需评估 dispatch 频控，留后续变更）。

        task-08（2026-08-22-team-session-unify）：会话 mission 不进重派候选
        （新链路无 pending 主控 run，显式 no-op），存量 external 保留——见下方
        候选查询注释。

        Returns:
            成功重派的 run 数。
        """
        # task-08（2026-08-22-team-session-unify / design §5 Phase 1）：候选 join
        # AgentMission 并过滤会话 mission——session_id 指向真实 AgentSession 行的
        # mission 不进重派（显式 no-op：会话链路主控轮由会话 lease 逐 turn 驱动，
        # 无「pending 主控 run + no_online_daemon」重派语义；新链路主控轮也不会
        # 写该 error_code）。存量 external/team mission（session_id 为 NULL）重派
        # 行为保留；join 同时排除 mission 缺失的孤儿 run（原
        # ``run.mission_id is None`` / ``mission is None`` 跳过语义上移到 SQL）。
        stmt = (
            select(AgentRun)
            .join(AgentMission, AgentRun.mission_id == AgentMission.id)
            .where(
                AgentRun.role == _ORCHESTRATOR_ROLE,
                AgentRun.status == "pending",
                AgentRun.error_code == "no_online_daemon",
                ~select(AgentSession.id).where(AgentSession.id == AgentMission.session_id).exists(),
            )
        )
        runs = (await self._session.execute(stmt)).scalars().all()
        redispatched = 0
        for run in runs:
            mission = await self._session.get(AgentMission, run.mission_id)
            if (
                mission is None
                or mission.cancelled_at is not None
                or mission.converged_at is not None
            ):
                continue
            cfg = _resolve_main_agent_config(mission.main_agent_config)
            try:
                placement = RunPlacementService(self._session)
                lease_id = await placement.dispatch_to_daemon(
                    run.id,
                    mission.created_by,
                    workspace_id=mission.workspace_id,
                    provider=cfg["provider"] or None,
                    model=cfg["model"] or None,
                    prompt=await render_orchestrator_prompt(mission, run, self._session),
                    stage=_ORCHESTRATOR_ROLE,
                    read_only=False,
                    agent_profile_id=cfg["agent_profile_id"],
                )
            except NoOnlineDaemonError:
                continue
            run.error_code = None
            run.output_redacted = None
            self._session.add(run)
            await self._session.commit()
            redispatched += 1
            log.info(
                "orchestrator_pending_main_run_redispatched",
                mission_id=str(mission.id),
                run_id=str(run.id),
                lease_id=str(lease_id) if lease_id else None,
            )
        if redispatched:
            log.info("orchestrator_pending_main_runs_redispatched", count=redispatched)
        return redispatched

    async def schedule_loop(self, mission_id: uuid.UUID) -> str | None:
        """主 agent 调度循环兜底巡检（D-001@v2 三重收敛，task-11 完整实现）。

        三重收敛信号（design §7，OR——任一触发即 converge）：
        1. **worker 全部终态**（completed/failed/killed）→ converge。主 agent 可能
           卡住没主动收敛（daemon 离线 / MCP tool 未调），backend 巡检兜底触发。
        2. **主 agent 判断目标达成**：主 agent 通过 MCP tool ``converge_mission``
           主动收敛（mcp_tools.py:293，task-05 建）。schedule_loop 不重复触发——
           巡检主 agent run 终态时若 worker 已全终态，归并到信号 1 一起 converge。
        3. **预算/超时硬截断**：``mission.budget_usd`` 触顶（cost_so_far >= budget）
           → 强制 converge（标记 degraded，design §7 信号 3）。budget 拒新 worker
           dispatch 已由 ``control.can_dispatch_worker`` 复用（D-008@v1，零重写），
           本方法只补「已超支 → 强制收尾」兜底。

        信号 1 带 zombie 豁免（2026-08-21-mission-converge-patrol task-08，D-004
        两阶段复活）：主 run 被判死（error_code=orchestrator_zombie）且复活窗口
        未耗尽 → 信号 1 暂不收敛（return None 等 patrol 复活）；信号 3 不豁免。

        会话 mission 分流（2026-08-22-team-session-unify task-08 / D-008）：会话
        mission（session_id 指向真实 AgentSession）主控轮为短生命周期 turn run，
        主控存续按「会话活跃 turn」判定——本方法对其整体 no-op（不强改主控轮
        状态 / 不触发 converge），收敛入口仅 MCP converge 与 patrol awaiting_input
        超时（task-06 契约）；存量 external/team mission 走原三重信号链路零回归。

        重要：``derive_status``（mission.py）把 mission 下**所有** AgentRun
        （含主 agent run 自己）算进状态。主 agent run 通常 long-lived running，
        若直接喂 derive_status 永远返回 ``running``——本方法信号 1 只按分身维度
        判收敛（task-09 起 = ``mission_derive_status(workers_only=True)`` 单一
        真相源），再用 ``converge_mission_for_completed_run`` 以主 agent run 为
        锚点触发（finalizer 内部仍按全 run derive，主 agent 此时已 completed/
        被收敛路径标记终态，derive 一致）。

        本方法是 backend **兜底巡检入口**——主 agent 实际驱动靠 daemon MCP tool
        （task-05/06）反向调 backend endpoint，循环主体在 daemon 端。调用方
        （reconcile / 定时任务，task-11 暂未接线，留 task-12/13）按节奏调本方法即可。

        Returns:
            收敛后的 mission status（``done``/``degraded``/...），或 None 表示本次
            巡检未触发收敛（mission 仍在 running / planning / 已 cancelled）。
        """
        mission = await self._session.get(AgentMission, mission_id)
        if mission is None:
            log.warning("orchestrator_schedule_loop_mission_missing", mission_id=str(mission_id))
            return None
        # cancelled mission 不再收敛（control.cancel 已终态化）。
        if mission.cancelled_at is not None:
            return None

        # ── 会话 mission 分流（task-08 / 2026-08-22-team-session-unify，design
        #    §5 Phase 1 patrol 适配 / D-008）──
        # 会话 mission（session_id 指向真实 AgentSession 行，查表判别与
        # finalizer 同款口径）主控轮为短生命周期 turn run，主控存续按「会话
        # 活跃 turn」判定，不再以主 run 常驻 running 为存续依据。schedule_loop
        # 对会话 mission 整体 no-op：
        # - 不强改主控轮状态（终态后不被重写、running 轮不受巡检干扰）；
        # - 不 kill 分身 / 不触发 converge——finalizer 非显式路径对会话 mission
        #   已不自动收敛（task-06），置位入口仅 MCP converge 与 patrol
        #   awaiting_input 超时（design §7.5）。
        # 存量 external/team mission（session_id 为 NULL）走下方原三重
        # 收敛信号链路，行为零回归。
        if mission.session_id is not None and (
            await self._session.get(AgentSession, mission.session_id) is not None
        ):
            log.debug(
                "orchestrator_schedule_loop_session_mission_skip",
                mission_id=str(mission_id),
            )
            return None

        # 延迟 import 避免与 control/mission/finalizer 的循环 import 风险（与
        # finalizer.converge_mission_for_completed_run 同款）。
        from app.modules.agent.control import MissionControlService
        from app.modules.agent.finalizer import converge_mission_for_completed_run
        from app.modules.agent.mission import derive_status, mission_derive_status

        ctrl = MissionControlService(self._session)
        all_runs = await ctrl.worker_runs(mission_id)
        worker_runs = [r for r in all_runs if r.role != _ORCHESTRATOR_ROLE]

        # 找主 agent run 作 converge 锚点（converge_mission_for_completed_run 需 run_id）。
        # 主 agent run 不存在（mission 损坏 / single 模式误调）→ 无法走标准收敛锚点，
        # 巡检跳过（single 零回归：single mission 本就不该走 schedule_loop）。
        # task-08：锚点取 created_at 最新一条 role='orchestrator' run——与 task-06
        # 锚点（mcp_tools._get_main_run / finalizer）一致；会话 mission 主控轮逐
        # turn 多条（本方法对会话 mission 已上方分流跳过，此处锚点统一不动语义），
        # 存量 external 单主控 run（首条即唯一）同规则命中零回归。
        main_run = max(
            (r for r in all_runs if r.role == _ORCHESTRATOR_ROLE),
            key=lambda r: r.created_at,
            default=None,
        )
        if main_run is None:
            log.info(
                "orchestrator_schedule_loop_no_main_run",
                mission_id=str(mission_id),
                run_count=len(all_runs),
            )
            return None

        # 信号 3（budget 硬截断）：cost_so_far >= budget_usd → 强制 converge（degraded）。
        # budget_usd=None 视为无预算约束（不触发）。复用 control.cost_so_far，与
        # can_dispatch_worker 同一数据源（避免双源不一致）。
        forced_degraded = False
        if mission.budget_usd is not None:
            cost = MissionControlService.cost_from_runs(all_runs)
            if cost >= mission.budget_usd:
                forced_degraded = True
                log.warning(
                    "orchestrator_budget_exceeded_force_converge",
                    mission_id=str(mission_id),
                    cost=cost,
                    budget_usd=mission.budget_usd,
                )

        # 信号 1（worker 全终态）：task-09 判据换 task-08 单一真相源
        # mission_derive_status(workers_only=True)——全完成派生 done/degraded/
        # failed；空 worker 集（主 agent 还没派任何 worker）派生 planning 不算，
        # 否则 mission 刚建就空收敛（语义保留）；有分身未完成派生 running。
        # 本方法对会话 mission 已上方分流跳过，此处仅存量 mission（无分身子
        # 会话），包装对存量输入与 run 终态集合判定逐字节等价（FR-09）。
        all_workers_terminal = await mission_derive_status(
            self._session, mission_id, workers_only=True
        ) in ("done", "degraded", "failed")

        if not forced_degraded and not all_workers_terminal:
            # 三重信号本次巡检均未达成，不收敛。budget「未触顶 + worker 未全终态」
            # 是 mission 正常推进态，schedule_loop 静默返回（log debug 级）。
            log.debug(
                "orchestrator_schedule_loop_no_converge",
                mission_id=str(mission_id),
                worker_terminal=all_workers_terminal,
                forced_degraded=forced_degraded,
            )
            return None

        # 信号 1 zombie 豁免（2026-08-21-mission-converge-patrol task-08，D-004/D-006）：
        # 主 run 被 patrol 判死（error_code=orchestrator_zombie + constraints.
        # zombie_marked_at，task-05 写入）且复活窗口未耗尽 → 信号 1 本次不收敛，
        # 不强标 main_run 终态 / 不 merge worker 产物，等 patrol 职责③复活（daemon
        # 恢复清 error_code 后豁免条件自然失谐）。只挡信号 1——forced_degraded
        # （信号 3 预算触顶）是治理强收，优先级高于复活等待，不豁免（短路顺序
        # 保证 forced_degraded 时豁免检查直接跳过）。判定纯 DB 时间窗（D-006），
        # 不查 daemon 在线。
        if (
            all_workers_terminal
            and not forced_degraded
            and main_run.error_code == _ZOMBIE_ERROR_CODE
            and _zombie_exemption_active(mission)
        ):
            log.info(
                "orchestrator_schedule_loop_zombie_exemption",
                mission_id=str(mission_id),
                main_run_id=str(main_run.id),
                zombie_marked_at=(mission.constraints or {}).get(_ZOMBIE_MARKED_AT_KEY),
                revive_window_minutes=get_settings().mission_patrol_revive_window_minutes,
            )
            return None

        # 信号 2（主 agent 自主收敛）不在 schedule_loop 触发——主 agent 调 MCP
        # ``converge_mission`` endpoint 直接走 converge_mission_for_completed_run。
        # 这里信号 1 / 3 触发时，需让 mission 的 run 全终态，否则
        # converge_mission_for_completed_run 内 derive_status（mission.py:29 把 mission
        # 下所有 run 含主 agent / 活跃 worker 算进去）返回 running、Finalizer 不合并：
        # - 主 agent run 还在 running → 标 completed（信号 1）/ failed（信号 3 强收）。
        # - 信号 3 budget 触顶时仍有 running worker → 标 killed（预算已停，worker 烧钱
        #   必须停，与 control.cancel 同语义但走巡检路径无 lease 上下文，纯标记终态；
        #   不设 cancelled_at——cancel 是用户主动，budget 强收是治理兜底，derive 出
        #   degraded 而非 cancelled）。
        mutated = False
        if forced_degraded:
            for w in worker_runs:
                if w.status not in _WORKER_TERMINAL:
                    w.status = "killed"
                    self._session.add(w)
                    mutated = True
        if main_run.status not in _WORKER_TERMINAL:
            main_run.status = "completed" if all_workers_terminal else "failed"
            self._session.add(main_run)
            mutated = True
        if mutated:
            await self._session.commit()
            await self._session.refresh(main_run)
            log.info(
                "orchestrator_force_terminal_runs",
                mission_id=str(mission_id),
                main_run_id=str(main_run.id),
                main_new_status=main_run.status,
                reason="budget_exceeded" if forced_degraded else "workers_terminal",
            )

        # 触发收敛：复用 complete_lease 末尾同款入口（D-007@v1 单锚点）。GLM 配置
        # 由 converge_mission_for_completed_run 内部按 patch/summary 分流处理。
        from app.modules.agent.delegation import GLMConfig

        try:
            result_status = await converge_mission_for_completed_run(
                self._session, main_run.id, GLMConfig.from_env()
            )
        except Exception as exc:
            # 与 complete_lease 容错一致（lease/service.py:609）：converge 失败不抛，
            # 兜底巡检下次再来。derive_status 纯函数计算终态供调用方。
            log.warning(
                "orchestrator_schedule_loop_converge_failed",
                mission_id=str(mission_id),
                main_run_id=str(main_run.id),
                error=str(exc),
            )
            runs_recheck = await ctrl.worker_runs(mission_id)
            result_status = derive_status(runs_recheck, cancelled=False)

        # forced_degraded 时无论 derive 算出什么（done/failed/degraded），都覆盖为
        # degraded——表达「预算触顶强收」语义（design §7 信号 3 标 degraded）。budget
        # 强收是治理兜底，derive 此刻可能因 worker 被 kill 而出 failed，但 mission
        # 已正常收敛合并产物，用 degraded 表达「收尾但不圆满」比 failed 更准确。
        if forced_degraded:
            result_status = "degraded"

        log.info(
            "orchestrator_schedule_loop_converged",
            mission_id=str(mission_id),
            status=result_status,
            forced_degraded=forced_degraded,
            workers_terminal=all_workers_terminal,
        )
        return result_status
