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
- :func:`build_worker_briefing`——分身（worker）子会话首 prompt 任务简报渲染
  （2026-08-25-team-subsession-governance task-04 / FR-02，供 task-05 三元组派发
  消费）：objective + 工作区协作约束（git/direct 双变体，文案对齐
  ``render_worker_prompt`` 既有口径）+ worker_done 工具用法；纯渲染函数不查 DB。

⚠️ 口径区分：本模块的「已消耗」集合 ``_BRIEFING_CONSUMED_RUN_STATUSES`` 是**简报
一次性语义专用**（含 completed、不含 pending_approval），与 ``agent.model.
ACTIVE_RUN_STATUSES`` 的会话活跃轮口径（含 pending_approval、不含 completed）
语义不同，勿混用。

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
# 注意与 ACTIVE_RUN_STATUSES（活跃轮口径，含 pending_approval 不含 completed）
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


def build_worker_briefing(
    *,
    objective: str,
    role: str | None = None,
    mode: str | None = None,
) -> str:
    """渲染分身子会话首 prompt 任务简报（task-04 / FR-02 / design §5.B、§5.C）。

    纯渲染函数——objective / role / mode 全部入参传入，不查 DB 不写行（对齐
    ``render_worker_prompt``（execution.py）的纯函数形态），供 task-05
    dispatch_worker 三元组派发作子会话首 prompt。三段结构（验收口径）：

    ① 角色与目标——``objective`` 必传（空值回落「(未指定目标)」占位，同
      ``render_worker_prompt``）；``role`` 缺省 "worker"。
    ② 工作区协作约束——``mode="git"`` 渲染 worktree 隔离约束、``mode="direct"``
      渲染直通约束，两变体文案复用 ``render_worker_prompt`` 的既有双变体口径
      （本模块不另造句式，仅把「收尾消息」交叉引用替换为 worker_done 用法——
      分身收尾信号从收尾消息迁移到 worker_done 工具，design §5.C.2）；
      ``mode`` 为 None/"unknown"（git 探测未知）时整体省略该段不抛（对齐
      ``render_scope_brief`` 对 git_probe=None 省略模式字段、不渲染「未知」
      的既定口径）。
    ③ worker_done 工具用法——干完即调（分身完成的唯一显式信号，summary 作
      产物挂首 run 供主控读取）、追问重开工后可再调（子会话在收敛前保持
      可追问，支持重复完成周期，design §5.F）。
    """
    worker_role = role or "worker"
    parts = [
        "【分身任务简报（系统注入）】",
        f"你是多 Agent 团队中的一个分身（角色：{worker_role}），由主控会话派发执行以下任务。",
        f"你的目标：{objective or '(未指定目标)'}",
    ]
    if mode == "git":
        parts.append(
            "【worktree 协作约束（必须遵守）】\n"
            "1. 只写代码，不跑测试、不跑构建：你当前在自己的 git worktree 副本中，"
            "副本没有 node_modules / .venv 等依赖，跑测试或构建必然失败；所有验证"
            "（测试、lint、build）留给主 agent 合并（converge）后在工作区统一执行。\n"
            '2. 完成后必须提交：写完代码务必执行 `git add -A && git commit -m "<简述>"`，'
            "你的产出以 commit 形式存在，主 agent 会把你的分支 merge 回工作区——"
            "没有 commit 就没有可合并的产物。提交后调用 worker_done 工具报告完成"
            "（见下方完成信号约束）。\n"
            "3. 按文件分工，不要越界：主 agent 派发任务时已指示你负责的文件/模块范围，"
            "严格在该范围内修改，不要动其他 worker 负责的文件，"
            "以减少 converge 合并时的冲突。"
        )
    elif mode == "direct":
        parts.append(
            "【直通工作区约束（必须遵守）】\n"
            "你直接在工作区目录内工作，改动立即生效、无隔离副本"
            "（没有待合并的分支副本，改动直接落在工作区）；"
            "同目录可能有其它分身并行工作，避免并行写同一文件——"
            "严格在主 agent 指示你负责的文件/模块范围内修改，"
            "不要动其他 worker 负责的文件。完成后调用 worker_done 工具报告完成"
            "（见下方完成信号约束）。"
        )
    parts.append(
        "【完成信号 worker_done（必须遵守）】\n"
        "- 干完即调：目标完成后立即调用 worker_done 工具提交结构化 summary"
        "（发现/结论/产出文件路径/风险）——它是你完成任务的唯一显式信号，"
        "summary 会作为产物供主控读取；只在对话里说「做完了」不算完成。\n"
        "- 追问重开工后可再调：本会话在任务收敛前保持可追问——任务发起人可能"
        "追问或要求返工，回答/返工完成后再次调用 worker_done 报告新一轮完成。"
    )
    return "\n\n".join(parts)


# ── ql-20260825-003：分身全部完成 → 系统通知唤醒主控（反 list_workers 轮询）──
# 语义：主控派发分身后应结束本轮等待；全部分身进入终态时由平台注入一条系统
# 通知轮唤醒主控去读产出/收敛，取代主控在单轮内反复调 list_workers 烧 token。
# 双触发点（lease complete_lease 即时 + patrol awaiting_input 巡检兜底）共用本
# 助手；Redis SETNX 幂等（每 mission 至多通知一次），投递失败不抛不重试风暴。

_WORKERS_DONE_NOTIFY_TTL_SECONDS = 6 * 3600
_WORKERS_DONE_NOTIFY_KEY = "mission:workers_done_notified:{mission_id}"


async def workers_all_terminal_with_stats(
    db: AsyncSession,
    mission: AgentMission,
) -> tuple[bool, int, int]:
    """分身维度全完成判定 + 成败统计（不含主控轮；planning 空集=未全完成）。

    task-09（FR-05 / design §5.C.5）：判据换 task-08 单一真相源
    ``is_worker_complete``——分身枚举 = 分身子会话行 + 存量 batch 分身 run
    （``non_orchestrator_runs`` 剔除 ``agent_session_id ∈ 分身子会话`` 的首
    run，同分身不双计，对齐 ``mission_derive_status`` 剔除口径）；子会话按
    会话判定（idle 未 done / 追问重开工中 = 未完成——子会话首 run 终态不再
    误发「全部终态请收敛」，worker_done 成为唯一正确唤醒源），存量 run 形态
    按 run 终态（FR-09 零回归）。成败统计：子会话 ``worker_done_at`` 非空
    （且已完成）= 成功、其余完成形态（failed / ended 未 done）= 失败；存量
    run ``completed`` = 成功、failed/killed = 失败（原口径保留）。

    纯查询：经传入 session 读取（lease 调用方在自身事务内可见本轮未提交的
    终态翻转——即时通知不漏当轮完成事件）。
    """
    from app.modules.agent.control import MissionControlService
    from app.modules.agent.mission import is_worker_complete
    from app.modules.agent.model import mission_worker_sessions

    worker_sessions = await mission_worker_sessions(db, mission.id)
    worker_session_ids = {s.id for s in worker_sessions}
    legacy_runs = [
        r
        for r in await MissionControlService(db).non_orchestrator_runs(mission.id)
        if r.agent_session_id not in worker_session_ids
    ]
    workers: list[AgentSession | AgentRun] = [*worker_sessions, *legacy_runs]
    if not workers:
        # planning 空集=未全完成（语义保留）。
        return False, 0, 0
    if not all([await is_worker_complete(db, w) for w in workers]):
        return False, 0, 0
    ok = sum(
        1
        for w in workers
        if (
            w.worker_done_at is not None if isinstance(w, AgentSession) else w.status == "completed"
        )
    )
    return True, ok, len(workers) - ok


async def notify_orchestrator_workers_done(
    mission_id: uuid.UUID,
    session_id: uuid.UUID,
    *,
    completed: int,
    failed: int,
) -> bool:
    """向主控会话注入「分身全部完成」系统通知（幂等，独立事务，失败只记日志）。

    Redis SETNX 抢占 ``_WORKERS_DONE_NOTIFY_KEY``（TTL 6h）——双触发点并发 /
    patrol 兜底重入至多投递一次；抢不到返回 False（已通知过）。注入走
    ``inject_session_as_service``（独立 session 工厂，不搭调用方事务）：turn
    冲突（主控轮仍在跑）/ 会话非活跃等 AppError 视为主控自会收敛，记 info
    不视为失败、不释放锁。返回 True = 通知轮已派发。

    ⚠️ 本方法内部自开事务（get_session_factory），调用方事务状态无关——
    判定请先用 :func:`workers_all_terminal_with_stats`（调用方事务内）完成。
    """
    from app.core.db import get_session_factory
    from app.core.errors import AppError
    from app.core.redis import get_redis
    from app.modules.daemon.session.service import SessionService

    try:
        redis = get_redis()
        acquired = await redis.set(
            _WORKERS_DONE_NOTIFY_KEY.format(mission_id=mission_id),
            "1",
            nx=True,
            ex=_WORKERS_DONE_NOTIFY_TTL_SECONDS,
        )
    except Exception as exc:  # Redis 不可用：退化为「可能重复通知」，不阻断
        log.warning("workers_done_notify_redis_failed", mission_id=str(mission_id), error=str(exc))
        acquired = True

    if not acquired:
        return False

    prompt = (
        "【系统通知·团队任务】全部分身已进入终态："
        f"成功 {completed} 个、失败 {failed} 个。\n"
        "这是平台在分身完成时自动注入的通知轮（非用户消息）——无需再轮询 "
        "list_workers 等待。请用 list_workers 核对明细、get_worker_result 读取"
        "产出，然后 converge_mission 收敛，并向用户汇报结果。"
    )
    try:
        async with get_session_factory()() as ndb:
            await SessionService(ndb).inject_session_as_service(session_id, prompt=prompt)
    except AppError as exc:
        # 主控轮进行中（turn 冲突）/ 会话已结束等：主控醒着或已不可唤醒，
        # 通知缺失由 patrol awaiting_input 超时自动收敛兜底（§7.5）。
        log.info(
            "workers_done_notify_inject_skipped",
            mission_id=str(mission_id),
            session_id=str(session_id),
            reason=str(exc),
        )
        return False
    except Exception as exc:
        log.warning(
            "workers_done_notify_inject_failed",
            mission_id=str(mission_id),
            session_id=str(session_id),
            error=str(exc),
        )
        return False
    log.info(
        "workers_done_notified",
        mission_id=str(mission_id),
        session_id=str(session_id),
        completed=completed,
        failed=failed,
    )
    return True


async def clear_workers_done_notify_key(mission_id: uuid.UUID) -> None:
    """DEL「分身全部完成」唤醒幂等键（task-07 重复完成周期重置，design §5.C.2）。

    ``notify_orchestrator_workers_done`` 的 Redis SETNX 键（TTL 6h）只防**同一
    完成波次**内双触发点重复投递；「追问重开工 → 再次完成」的重复完成周期
    （D-002@v1）需要重新唤醒主控——新一轮 worker_done 触发迁移唤醒前先 DEL
    再走 notify 内部 SETNX 重新抢占，第二个周期能再次投递。key 与
    ``_WORKERS_DONE_NOTIFY_KEY`` 单源（防格式漂移）。

    Redis 不可用退化不阻断（既有语义）：DEL 失败只记 warning，notify 的 SETNX
    同样走「视为抢占成功」降级路径。
    """
    from app.core.redis import get_redis

    try:
        redis = get_redis()
        await redis.delete(_WORKERS_DONE_NOTIFY_KEY.format(mission_id=mission_id))
    except Exception as exc:  # Redis 不可用：退化不阻断（调用方继续 SETNX 唤醒）
        log.warning(
            "workers_done_notify_key_clear_failed",
            mission_id=str(mission_id),
            error=str(exc),
        )
