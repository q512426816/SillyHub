"""会话主控首轮任务简报的判定 + 组装 helper（2026-08-24-session-team-mission-context task-06 / FR-01）。

判定层落点（D-013@v1 一次性语义 / D-002@v1 简报仅首轮一次 / D-003@v1 懒建不补简报），
供 task-08（inject 路径）与 task-09（create 路径）共用：

- :func:`should_inject_first_turn_briefing`——首主控轮判定，三条件全真才命中：
  ① mission 非 None（活跃 mission，口径=``get_active_mission_for_session``，由调用方
  传入或经 :func:`resolve_first_turn_briefing` 组合入口内查）；② 本轮 prompt strip 后
  非空（纯配置切换轮不注入不消耗一次性名额，CC-12）；③ 该 mission 不存在
  role='orchestrator' 且 status∈{pending, running, completed} 的 AgentRun（「已消耗」
  集合——failed/killed 落集合外不烧断，首轮派发失败后下一条带文本消息重新注入；
  懒建回填的 orchestrator run 为 pending → 判定天然短路，懒建轮不补简报）。
- :func:`build_orchestrator_briefing`——简报组装：复用 task-01
  ``render_session_orchestrator_briefing``（文案单一来源，本模块不重复实现），把
  task-02 ``probe_workspace_git_mode`` 作 git 探测回调接进 scope 条目模式字段。
- :func:`resolve_first_turn_briefing`——组合入口：查活跃 mission → 判定 → 命中返回
  简报文本；任一不命中 / 无活跃 mission 返回 ``None``（调用方零注入）。

⚠️ 口径区分：本模块的「已消耗」集合 ``_BRIEFING_CONSUMED_RUN_STATUSES`` 是**简报
一次性语义专用**（含 completed、不含 interrupting），与 ``mcp_tools._ACTIVE_RUN_STATUSES``
的会话活跃轮口径（含 interrupting、不含 completed）语义不同，勿混用。

纯查询语义：DB 访问全经传入 AsyncSession，不自行开事务 / 不 commit / 不写任何行。
"""

from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.modules.agent.mission import get_active_mission_for_session
from app.modules.agent.model import AgentMission, AgentRun, AgentSession
from app.modules.agent.orchestrator import (
    GitModeProbe,
    render_session_orchestrator_briefing,
)
from app.modules.daemon.host_fs import HostFsDelegateUnavailable, new_host_fs_delegate

log = get_logger(__name__)

# 主 agent run 的 role 标记：与 orchestrator.py:36 / control.py:40 各自持有同值常量
# 的既有模式一致（converge 链路仅要求 mission_id 非空，role 是语义标记）。
_ORCHESTRATOR_ROLE = "orchestrator"

# 简报一次性语义的「已消耗」run 状态集合（D-013@v1 / D-002@v1）：
# - pending / running / completed：简报已（或正在）随某个主控轮注入——一次性名额烧断；
# - failed / killed 落集合外：首轮派发失败后下一条带文本消息重新注入（不烧断）；
# - 懒建回填的 orchestrator run 落库即 pending → 判定天然短路（D-003@v1）。
# 注意与 mcp_tools._ACTIVE_RUN_STATUSES（活跃轮口径，含 interrupting 不含 completed）
# 语义不同，勿混用。
_BRIEFING_CONSUMED_RUN_STATUSES = ("pending", "running", "completed")


async def should_inject_first_turn_briefing(
    db: AsyncSession,
    mission: AgentMission | None,
    prompt: str | None,
) -> bool:
    """首主控轮简报注入判定（FR-01 / D-013@v1，三条件全真才命中）。

    ① ``mission`` 非 None——调用方应传 ``get_active_mission_for_session`` 口径的
    活跃 mission（converged/cancelled 均空的会话锚点 mission）；② ``prompt`` strip
    后非空——纯配置切换轮（模型/引擎切换等空文本轮）不注入也不消耗一次性名额；③
    该 mission 不存在 role='orchestrator' 且 status∈{pending, running, completed}
    的 AgentRun——存在即「已消耗」，简报一次性（D-002@v1）；failed/killed 不烧断
    （D-013 边界二）；懒建回填的 pending orchestrator run 天然短路（D-003@v1）。

    纯查询无副作用：空白轮不命中本身即「不消耗」（不落任何 run 行），后续第一条
    带文本消息重新走本判定仍可命中。
    """
    if mission is None:
        return False
    if prompt is None or not prompt.strip():
        return False
    stmt = (
        select(AgentRun.id)
        .where(
            AgentRun.mission_id == mission.id,
            AgentRun.role == _ORCHESTRATOR_ROLE,
            AgentRun.status.in_(_BRIEFING_CONSUMED_RUN_STATUSES),
        )
        .limit(1)
    )
    consumed = (await db.execute(stmt)).first() is not None
    return not consumed


def _resolve_git_probe(db: AsyncSession) -> GitModeProbe | None:
    """构造 scope git 模式探测回调（延迟构造 HostFsDelegate，最小侵入形态）。

    delegate 经共享工厂 ``new_host_fs_delegate`` 按需构造（与 task-03
    mission_status 路由 / finalizer 等 agent 模块调用点同款接线——per-request
    实例，daemon-client RPC 真等由探测方法内部收敛为 "unknown" 不抛）。构造
    不可得（``HostFsDelegateUnavailable``）→ 降级返回 ``None``：简报 scope 条目
    整体省略模式字段（render_scope_brief 对 git_probe=None 的既定口径），不抛——
    简报注入主链路不能因探测接线失败而断。

    顶层 import host_fs 工厂与 finalizer.py:37 同款（agent 模块已验证无环）；
    测试经 monkeypatch 本模块 ``new_host_fs_delegate`` 名字即可模拟不可得分支。
    """
    try:
        delegate = new_host_fs_delegate(db)
    except HostFsDelegateUnavailable as exc:
        log.warning(
            "mission_briefing_git_probe_unavailable",
            error=type(exc).__name__,
            detail=str(exc),
        )
        return None
    return delegate.probe_workspace_git_mode


async def build_orchestrator_briefing(db: AsyncSession, mission: AgentMission) -> str:
    """组装会话主控首轮任务简报（task-08 inject / task-09 create 共用）。

    会话行防御校验 + 复用 task-01 ``render_session_orchestrator_briefing`` 渲染
    （mission_id / 目标 / 锚点工作区 / 派发范围 scope 条目 / dispatch_worker 用法 /
    mission_status 提示 / 禁越权约束——文案单一来源，本模块不重复实现）。scope
    条目的 git 模式字段经 :func:`_resolve_git_probe` 接 task-02
    ``probe_workspace_git_mode`` 探测；delegate 不可得时降级省略模式字段不抛。

    ``mission.session_id`` 对应的 AgentSession 行缺失（防御分支——含 external
    mission 的 session_id=None 场景）→ 抛 ``ValueError`` 显式暴露数据不一致，
    不静默返回空串（调用方零注入会伪装成「已消耗」，掩盖锚点断裂）。
    """
    agent_session = await db.get(AgentSession, mission.session_id)
    if agent_session is None:
        raise ValueError(
            f"mission {mission.id} 的会话锚点缺失：session_id={mission.session_id} "
            "无对应 AgentSession 行，无法组装主控简报（数据不一致，需排查而非静默跳过）"
        )
    return await render_session_orchestrator_briefing(mission, db, git_probe=_resolve_git_probe(db))


async def resolve_first_turn_briefing(
    db: AsyncSession,
    session_id: uuid.UUID,
    prompt: str | None,
) -> str | None:
    """组合入口：活跃 mission 查询 + 判定 + 简报组装（task-08/09 共用契约）。

    ``get_active_mission_for_session``（R-07 单活跃约束，命中至多一条）→
    :func:`should_inject_first_turn_briefing` 判定 → 命中返回
    :func:`build_orchestrator_briefing` 简报文本；任一条件不命中 / 无活跃
    mission → 返回 ``None``（调用方零注入，prompt 原样透传，无 mission 普通
    会话行为不变）。
    """
    mission = await get_active_mission_for_session(db, session_id)
    if not await should_inject_first_turn_briefing(db, mission, prompt):
        return None
    assert mission is not None  # 判定通过蕴含 mission 非 None（条件①），助 mypy 收窄
    return await build_orchestrator_briefing(db, mission)
