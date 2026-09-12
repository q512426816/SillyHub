"""群聊汇总收口任务状态机（2026-09-10-group-agent-direct-chat design §5.2/§5.6）。

首版（task-03）：建任务（``create_consensus_task``）+ 协调状态卡（channel='system'
落库行，挂任务载体 run——回放走群会话 logs 聚合天然覆盖，与投影行同机制；
更新=UPDATE 同 log 行 + 同 log_id 重发群频道 log 事件）。状态机扩展（成员登记/
收口判定/收口指令注入，task-07）与超时扫描循环（task-09）在本文件增量。

设计要点（D-008）：本表是汇总任务唯一状态源——崩溃重启后未超时任务由收口
钩子继续推进、超时任务被 sweeper 扫到，协调链不悬挂。
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from sqlalchemy import select

import app.modules.daemon.group.service as _gsvc
from app.core.errors import AppError
from app.modules.agent.model import (
    AgentGroupChat,
    AgentGroupConsensusTask,
    AgentGroupMember,
    AgentRunLog,
    AgentSession,
)

from .helpers import (
    CONSENSUS_OPINION_MAX_CHARS,
    CONVERGE_DIRECTIVE,
    OPINION_TRANSFER_HEADER,
)

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

# 任务状态词表（design §5.2）：open → closing（收口指令已注入）/ timeout（超时
# 收口指令已注入）→ closed（收口轮完成）；异常终态 aborted（coordinator 触发
# 失败/影子不可用/群解散/零意见超时，design §12）。
CONSENSUS_TASK_OPEN = "open"
CONSENSUS_TASK_CLOSING = "closing"
CONSENSUS_TASK_CLOSED = "closed"
CONSENSUS_TASK_TIMEOUT = "timeout"
CONSENSUS_TASK_ABORTED = "aborted"

# 成员明细状态词表：pending（已触发待回复）/ delivered（意见已转交汇总人）/
# failed（触发失败或回复失败）/ timeout（超时未响应）。
CONSENSUS_MEMBER_PENDING = "pending"
CONSENSUS_MEMBER_DELIVERED = "delivered"
CONSENSUS_MEMBER_FAILED = "failed"
CONSENSUS_MEMBER_TIMEOUT = "timeout"

# 状态卡 phase 词表（design §5.6）：collecting（意见收集）→ converging（收口
# 中）→ closed/timeout/aborted（终态，复用任务状态常量语义，别名分层）。
CONSENSUS_PHASE_COLLECTING = "collecting"
CONSENSUS_PHASE_CONVERGING = "converging"
CONSENSUS_PHASE_CLOSED = CONSENSUS_TASK_CLOSED
CONSENSUS_PHASE_TIMEOUT = CONSENSUS_TASK_TIMEOUT
CONSENSUS_PHASE_ABORTED = CONSENSUS_TASK_ABORTED

# 状态卡 content 单行摘要截断（成员名单过长时省略号收口）。
_CONSENSUS_CARD_CONTENT_MAX_CHARS = 200


async def create_consensus_task(
    db: "AsyncSession",
    *,
    group: AgentGroupChat,
    carrier_run_id: uuid.UUID,
    coordinator: AgentGroupMember,
    collaborators: list[AgentGroupMember],
    created_by: uuid.UUID,
    timeout_seconds: int | None = None,
    source_summary: str = "",
) -> AgentGroupConsensusTask:
    """建汇总任务 + 落协调状态卡（design §5.3 步 4，发送侧汇总分支调用）。

    - 幂等：``carrier_run_id`` 唯一约束防同消息重复建任务——冲突时查既有
      任务返回（不重复落状态卡）；
    - members 明细初始化 pending（不含汇总人，design §5.2 JSONB 快照）；
    - deadline = 触发时刻 + 群 ``consensus_timeout_seconds``（sweeper 扫描
      谓词锚点，D-004）；
    - 状态卡（``_write_consensus_card``）随任务同 session 落库，phase=
      collecting。
    """
    now = datetime.now(UTC)
    existing = (
        (
            await db.execute(
                select(AgentGroupConsensusTask).where(
                    AgentGroupConsensusTask.carrier_run_id == carrier_run_id
                )
            )
        )
        .scalars()
        .first()
    )
    if existing is not None:
        return existing

    task = AgentGroupConsensusTask(
        group_id=group.id,
        carrier_run_id=carrier_run_id,
        coordinator_member_id=coordinator.id,
        status=CONSENSUS_TASK_OPEN,
        members=[
            {
                "member_id": str(m.id),
                "member_name": m.display_name,
                "state": CONSENSUS_MEMBER_PENDING,
                "delivered_at": None,
            }
            for m in collaborators
        ],
        deadline_at=now
        + timedelta(
            seconds=timeout_seconds
            if timeout_seconds is not None
            else group.consensus_timeout_seconds
        ),
        created_by=created_by,
        created_at=now,
        # 触发消息摘要（收口指令 prompt 复用；状态卡不含——卡片只显成员态）。
        # 注意：AgentGroupConsensusTask 无独立列，摘要经状态卡 metadata 透出
        # 由调用方组装收口 prompt 时重查原消息（design §5.4 第 4 步）。
    )
    db.add(task)
    await db.flush()

    await write_consensus_card(
        db,
        group=group,
        task=task,
        coordinator_name=coordinator.display_name,
        phase=CONSENSUS_PHASE_COLLECTING,
        source_summary=source_summary,
    )
    return task


def consensus_member_states(task: AgentGroupConsensusTask) -> list[dict]:
    """任务成员明细（JSONB 快照）安全读取——异常形态归一空列表。

    返回**深拷贝**（逐行 ``dict(m)``）：调用方原地改行后重新赋 ``task.members``
    时，新旧值不得 ``==`` 相等——否则 SQLAlchemy History 判定未变不生成
    UPDATE（同 dict 引用修改即踩坑，单测诊断实录）。
    """
    raw = task.members or []
    return [dict(m) for m in raw if isinstance(m, dict)]


def _card_content(
    coordinator_name: str,
    phase: str,
    members: list[dict],
) -> str:
    """状态卡人类可读单行摘要（design §5.6：content 列，回放直显）。

    形态对照原型 prototype-consensus-mode.html：进行中=「⏳ 汇总收集中：
    {汇总人} 收口 · 已交 {n}/{total}」；converging=「🔄 汇总收口中…」；
    终态按 task.status 渲染（closed=✅/timeout=⌛/aborted=⛔）。
    """
    total = len(members)
    delivered = sum(1 for m in members if m.get("state") == CONSENSUS_MEMBER_DELIVERED)
    if phase == CONSENSUS_PHASE_COLLECTING:
        return f"⏳ 汇总收集中：「{coordinator_name}」负责收口 · 已交意见 {delivered}/{total}"
    if phase == CONSENSUS_PHASE_CONVERGING:
        return f"🔄 汇总收口中：「{coordinator_name}」正在整合 {delivered} 份意见并输出群内总结"
    if phase == CONSENSUS_TASK_TIMEOUT:
        return (
            f"⌛ 汇总已超时收口：「{coordinator_name}」基于已收意见收口（未响应成员已在总结中标注）"
        )
    if phase == CONSENSUS_TASK_ABORTED:
        return f"⛔ 汇总协作中止：汇总人「{coordinator_name}」未能参与本轮协作"
    return f"✅ 汇总已完成：「{coordinator_name}」已输出群内总结（{delivered}/{total} 份意见）"


async def write_consensus_card(
    db: "AsyncSession",
    *,
    group: AgentGroupChat,
    task: AgentGroupConsensusTask,
    coordinator_name: str,
    phase: str,
    source_summary: str = "",
) -> AgentRunLog | None:
    """写/更新协调状态卡（design §5.6：UPDATE 单行模式 + 同 log_id 重发）。

    - 定位：任务载体 run 下唯一 ``channel='system'`` 行（一条消息一个任务
      一张卡，run_id+channel 唯一定位，免 JSON 谓词跨方言）；
    - 首写 INSERT、后续 UPDATE 同行 content/metadata_；timestamp 不动（保留
      卡片首现时刻，排序稳定）；
    - 实时推送：同 log_id 重发群频道 log 事件（前端按 log_id 内容替换，
      prototype 状态卡两态）——publish 容错语义同 _publish_group_channel_event。

    返回状态卡 log 行（None=落库失败防御口径，不阻断主流程）。
    """
    now = datetime.now(UTC)
    members = consensus_member_states(task)
    card_meta = {
        "consensus_task_id": str(task.id),
        "consensus_card": {
            "coordinator_name": coordinator_name,
            "phase": phase,
            "members": [
                {"name": m.get("member_name", "?"), "state": m.get("state", "?")} for m in members
            ],
            "updated_at": now.isoformat(),
        },
    }
    if source_summary:
        card_meta["consensus_source_summary"] = source_summary[:200]
    content = _card_content(coordinator_name, phase, members)[:_CONSENSUS_CARD_CONTENT_MAX_CHARS]

    card = (
        (
            await db.execute(
                select(AgentRunLog).where(
                    AgentRunLog.run_id == task.carrier_run_id,
                    AgentRunLog.channel == "system",
                )
            )
        )
        .scalars()
        .first()
    )
    if card is None:
        card = AgentRunLog(
            run_id=task.carrier_run_id,
            channel="system",
            content_redacted=content,
            metadata_=card_meta,
            timestamp=now,
        )
        db.add(card)
        await db.flush()
    else:
        card.content_redacted = content
        card.metadata_ = card_meta
        await db.flush()

    # 同 log_id 重发（SSE 内容替换）：channel='system' 形态照 typing_presence
    # 系统行（ephemeral 版不落库；本卡落库可回放——重发 payload 带 log_id 供
    # 前端去重定位）。
    await _gsvc._publish_group_channel_event(
        group.session_id,
        {
            "event": "log",
            "session_id": str(group.session_id),
            "run_id": str(task.carrier_run_id),
            "log_id": str(card.id),
            "channel": "system",
            "content": content,
            "metadata": card_meta,
            "timestamp": now.isoformat(),
        },
    )
    return card


# ── 状态机扩展（task-07，design §5.4 / §7）────────────────────────────────


async def collect_collaborator_opinion(db: "AsyncSession", *, run_id: uuid.UUID) -> str | None:
    """聚合影子 run 全量 assistant 文本为单成员意见（design §5.4 步 1）。

    口径照 ``_build_group_fallback_summary``：``is_group_projectable_reply``
    同源过滤（thinking/tool/stderr/系统行不进意见）+ 剥 ``[ASSISTANT]`` 前缀，
    **全段拼接**（协作轮无投影行——投影层已拦截，意见以影子 run 为唯一
    源）；末段截 ``CONSENSUS_OPINION_MAX_CHARS``（收口 prompt 预算）。
    整轮无可取文本（纯工具轮）返回 None——调用方登记 failed（无意见可交）。
    """
    from app.modules.daemon.run_sync.service.group_bridge import is_group_projectable_reply

    rows = (
        await db.execute(
            select(AgentRunLog.channel, AgentRunLog.content_redacted)
            .where(AgentRunLog.run_id == run_id)
            .order_by(AgentRunLog.timestamp, AgentRunLog.id)
        )
    ).all()
    parts: list[str] = []
    for channel, content in rows:
        if not is_group_projectable_reply(channel, content):
            continue
        text = (content or "").strip()
        if text.startswith("[ASSISTANT]"):
            text = text[len("[ASSISTANT]") :].strip()
        if text:
            parts.append(text)
    if not parts:
        return None
    return "\n".join(parts)[:CONSENSUS_OPINION_MAX_CHARS]


async def deliver_collaborator_opinion(
    db: "AsyncSession",
    *,
    group: AgentGroupChat,
    target_member: AgentGroupMember,
    source_member_name: str,
    opinion_text: str,
    task: AgentGroupConsensusTask | None = None,
    source_summary: str = "",
) -> None:
    """意见定向注入目标成员影子会话（design §5.4 步 2，收口钩子调用）。

    - 注入 prompt = ``OPINION_TRANSFER_HEADER``（意见转交 preamble，多任务
      并行时 source_summary 标注来源消息摘要）+ 意见全文（常量已含正文槽）；
    - 注入轮 metadata：consensus 上下文（task 非 None）→ coordinator 角色
      （消化意见轮不进群，D-007）；互@私聊（task=None）→ agent_dm 直达
      （无任务推进，仅转交）；
    - busy_strategy="inject" 忙轮中途注入 + 409 竞态降级排队（与群消息/
      直聊同机制）；注入失败 AppError 上抛——调用方（收口钩子）决定登记
      failed 还是忽略（互@私聊转交失败仅记日志）。

    独立短 session 注入（对齐 ``_trigger_member_isolated``：钩子在收口事务
    外调用，注入自持事务边界；``db`` 形参保留 §7 签名兼容，仅用于日志上下文）。
    """
    from app.core.db import get_session_factory
    from app.modules.daemon.session.service import DaemonSessionTurnConflict

    turn_metadata: dict = {"source": "shadow_direct"}
    if task is not None:
        turn_metadata.update(
            {
                "source_carrier_run_id": str(task.carrier_run_id),
                "consensus_task_id": str(task.id),
                "consensus_role": "coordinator",
                "dm_kind": "consensus",
            }
        )
    prompt = OPINION_TRANSFER_HEADER.format(
        source_name=source_member_name,
        source_summary=source_summary or "（无摘要）",
        opinion_text=opinion_text,
    )
    async with get_session_factory()() as inj_db:
        try:
            await _gsvc.SessionService(inj_db).inject_session_as_service(
                target_member.shadow_session_id,
                prompt=prompt,
                busy_strategy="inject",
                queue_when_busy=True,
                queue_sender_user_id=group.created_by,
                turn_metadata=turn_metadata,
            )
        except DaemonSessionTurnConflict:
            await _gsvc.SessionService(inj_db).inject_session_as_service(
                target_member.shadow_session_id,
                prompt=prompt,
                queue_when_busy=True,
                queue_sender_user_id=group.created_by,
                turn_metadata=turn_metadata,
            )


async def record_collaborator_outcome(
    db: "AsyncSession",
    *,
    task_id: uuid.UUID,
    member_id: uuid.UUID,
    state: str,
    opinion_text: str | None = None,
) -> None:
    """登记协作成员终态 + 状态卡 + 收口判定（design §5.4 步 3，内聚）。

    行锁读任务行（``FOR UPDATE``——并发钩子/超时 sweeper 互斥；SQLite 测试
    环境静默忽略锁）→ 更新成员明细（state + delivered_at + opinion 快照
    落 JSONB——收口指令的意见全文源，崩溃安全）→ 状态卡 UPDATE 重发 →
    收口判定：全员终态（delivered|failed|timeout）且 ≥1 delivered 且任务
    仍 open → ``inject_converge_directive``（等齐版）；零 delivered 全终态
    → aborted（无意见可收，design §12.1 语义）。

    幂等：成员已是终态时跳过（重复钩子/重放安全）；任务非 open（closing/
    closed/timeout/aborted）仅补登记不动状态机。
    """
    task = (
        (
            await db.execute(
                select(AgentGroupConsensusTask)
                .where(AgentGroupConsensusTask.id == task_id)
                .with_for_update()
            )
        )
        .scalars()
        .first()
    )
    if task is None:
        _gsvc.log.warning("consensus_task_missing_on_outcome", task_id=str(task_id))
        return
    group = await db.get(AgentGroupChat, task.group_id)
    coordinator = await db.get(AgentGroupMember, task.coordinator_member_id)
    if group is None or coordinator is None:
        return
    states = consensus_member_states(task)
    row = next((r for r in states if r.get("member_id") == str(member_id)), None)
    if row is None:
        return
    if row.get("state") in (
        CONSENSUS_MEMBER_DELIVERED,
        CONSENSUS_MEMBER_FAILED,
        CONSENSUS_MEMBER_TIMEOUT,
    ):
        return  # 幂等：终态不可逆
    row["state"] = state
    if state == CONSENSUS_MEMBER_DELIVERED:
        row["delivered_at"] = datetime.now(UTC).isoformat()
        if opinion_text:
            row["opinion"] = opinion_text
    task.members = states
    await db.flush()
    if task.status != CONSENSUS_TASK_OPEN:
        await db.commit()
        return
    delivered = [r for r in states if r.get("state") == CONSENSUS_MEMBER_DELIVERED]
    terminal = all(
        r.get("state")
        in (CONSENSUS_MEMBER_DELIVERED, CONSENSUS_MEMBER_FAILED, CONSENSUS_MEMBER_TIMEOUT)
        for r in states
    )
    if not terminal:
        await write_consensus_card(
            db,
            group=group,
            task=task,
            coordinator_name=coordinator.display_name,
            phase=CONSENSUS_PHASE_COLLECTING,
        )
        await db.commit()
        return
    if not delivered:
        task.status = CONSENSUS_TASK_ABORTED
        task.converged_at = datetime.now(UTC)
        await write_consensus_card(
            db,
            group=group,
            task=task,
            coordinator_name=coordinator.display_name,
            phase=CONSENSUS_PHASE_ABORTED,
        )
        await db.commit()
        return
    await inject_converge_directive(db, task=task, timed_out=False)
    await db.commit()


async def inject_converge_directive(
    db: "AsyncSession",
    *,
    task: AgentGroupConsensusTask,
    timed_out: bool,
) -> None:
    """收口指令注入 coordinator 影子会话（design §5.4 步 4，等齐/超时两版）。

    - prompt = ``CONVERGE_DIRECTIVE``：触发消息摘要 + 各 delivered 成员
      意见全文（members JSONB 快照）+ 未响应名单（timeout/failed 成员）；
    - 轮 metadata：``{consensus_task_id, consensus_role: "converge",
      source_carrier_run_id}``——**无 dm_target**，投影放行（``[[GROUP]]``
      总结段进群，D-007 唯一例外）；
    - 健康检查（§12.2）：注入前查 coordinator 影子会话——ended/缺失 →
      任务 aborted + 状态卡终态（不再注入）；注入 AppError 失败（机器
      不可用/队列满等）同 aborted 路径（超时版由 sweeper 幂等跳过——
      status 已非 open 不会二次注入）；
    - timed_out：超时版未响应成员标注 timeout；status → timeout（非
      closing——语义可区分回放审计）。
    """
    group = await db.get(AgentGroupChat, task.group_id)
    coordinator = await db.get(AgentGroupMember, task.coordinator_member_id)
    if group is None or coordinator is None:
        return
    shadow = await db.get(AgentSession, coordinator.shadow_session_id)
    if shadow is None or shadow.ended_at is not None:
        _gsvc.log.warning(
            "consensus_converge_coordinator_unhealthy",
            task_id=str(task.id),
            shadow_session_id=str(coordinator.shadow_session_id),
        )
        task.status = CONSENSUS_TASK_ABORTED
        task.converged_at = datetime.now(UTC)
        await write_consensus_card(
            db,
            group=group,
            task=task,
            coordinator_name=coordinator.display_name,
            phase=CONSENSUS_PHASE_ABORTED,
        )
        return

    states = consensus_member_states(task)
    delivered = [r for r in states if r.get("state") == CONSENSUS_MEMBER_DELIVERED]
    non_responders = [
        str(r.get("member_name", "?"))
        for r in states
        if r.get("state") in (CONSENSUS_MEMBER_TIMEOUT, CONSENSUS_MEMBER_FAILED)
    ]
    if timed_out:
        for r in states:
            if r.get("state") == CONSENSUS_MEMBER_PENDING:
                r["state"] = CONSENSUS_MEMBER_TIMEOUT
        task.members = states
        non_responders = [
            str(r.get("member_name", "?"))
            for r in states
            if r.get("state") in (CONSENSUS_MEMBER_TIMEOUT, CONSENSUS_MEMBER_FAILED)
        ]
    opinions = "\n\n".join(
        f"── 「{r.get('member_name', '?')}」的意见 ──\n{r.get('opinion', '（无文本）')}"
        for r in delivered
    )
    # 触发消息摘要源=载体 run 的 user_input 原文（非 metadata 键——发送侧
    # user_input metadata 不带 consensus 键，卡面摘要仅落状态卡 metadata）。
    carrier_content = (
        (
            await db.execute(
                select(AgentRunLog.content_redacted).where(
                    AgentRunLog.run_id == task.carrier_run_id,
                    AgentRunLog.channel == "user_input",
                )
            )
        )
        .scalars()
        .first()
    )
    source_summary = (carrier_content or "").strip()[:120]

    from app.core.db import get_session_factory
    from app.modules.daemon.session.service import DaemonSessionTurnConflict

    prompt = CONVERGE_DIRECTIVE.format(
        source_summary=source_summary or "（见前文触发消息）",
        opinions=opinions or "（无）",
        non_responders="、".join(non_responders) or "无",
    )
    turn_metadata = {
        "consensus_task_id": str(task.id),
        "consensus_role": "converge",
        "source_carrier_run_id": str(task.carrier_run_id),
    }
    task.status = CONSENSUS_TASK_TIMEOUT if timed_out else CONSENSUS_TASK_CLOSING
    await write_consensus_card(
        db,
        group=group,
        task=task,
        coordinator_name=coordinator.display_name,
        phase=CONSENSUS_PHASE_CONVERGING,
    )
    try:
        async with get_session_factory()() as inj_db:
            try:
                await _gsvc.SessionService(inj_db).inject_session_as_service(
                    coordinator.shadow_session_id,
                    prompt=prompt,
                    busy_strategy="inject",
                    queue_when_busy=True,
                    queue_sender_user_id=group.created_by,
                    turn_metadata=turn_metadata,
                )
            except DaemonSessionTurnConflict:
                await _gsvc.SessionService(inj_db).inject_session_as_service(
                    coordinator.shadow_session_id,
                    prompt=prompt,
                    queue_when_busy=True,
                    queue_sender_user_id=group.created_by,
                    turn_metadata=turn_metadata,
                )
    except AppError as exc:
        _gsvc.log.warning(
            "consensus_converge_inject_failed",
            task_id=str(task.id),
            code=exc.code,
        )
        task.status = CONSENSUS_TASK_ABORTED
        task.converged_at = datetime.now(UTC)
        await write_consensus_card(
            db,
            group=group,
            task=task,
            coordinator_name=coordinator.display_name,
            phase=CONSENSUS_PHASE_ABORTED,
        )


CONSENSUS_SWEEP_INTERVAL_SEC = 30.0


async def consensus_sweep_once(db: "AsyncSession") -> int:
    """超时任务巡检单轮（task-09，design §12）：返回本轮处理条数.

    - 扫 ``status=open 且 deadline_at < now``：行锁 ``FOR UPDATE
      SKIP LOCKED``（docker-compose 单 worker 之外的兜底，多实例不连坐）；
    - 群已解散/删除（AgentGroupChat 缺失或 ended）→ 任务静默 aborted
      （§12.3，不发群内行——群没了无处发）；
    - 有 delivered 意见 → ``inject_converge_directive(timed_out=True)``
      （内部 pending→timeout、status→timeout、健康检查失败→aborted）；
    - 零 delivered → 直接 aborted（无人响应无从收口）+ 状态卡终态。

    单条异常（AppError 等）只 ``log.warning`` 吞掉——不连坐同批其余任务。
    """
    now = datetime.now(UTC)
    tasks = (
        (
            await db.execute(
                select(AgentGroupConsensusTask)
                .where(
                    AgentGroupConsensusTask.status == CONSENSUS_TASK_OPEN,
                    AgentGroupConsensusTask.deadline_at < now,
                )
                .with_for_update(skip_locked=True)
            )
        )
        .scalars()
        .all()
    )
    if not tasks:
        return 0
    processed = 0
    for task in tasks:
        try:
            group = await db.get(AgentGroupChat, task.group_id)
            coordinator = await db.get(AgentGroupMember, task.coordinator_member_id)
            if group is None or group.ended_at is not None or coordinator is None:
                task.status = CONSENSUS_TASK_ABORTED
                task.converged_at = datetime.now(UTC)
                await db.commit()
                processed += 1
                continue
            states = consensus_member_states(task)
            delivered = [r for r in states if r.get("state") == CONSENSUS_MEMBER_DELIVERED]
            if delivered:
                await inject_converge_directive(db, task=task, timed_out=True)
                # 真实集成修正（2026-09-12 E2E 抓获）：inject/write_consensus_card
                # 只 flush 不 commit——sweep 独立 session 收口时无调用方兜底
                # commit，aborted/timeout 改动随会话关闭回滚（processed 计数
                # 与库内终态脱节）。单测同 session 内存态断言掩盖（identity
                # map 未过期）；真实独立连接重读复现。
                await db.commit()
            else:
                task.status = CONSENSUS_TASK_ABORTED
                task.converged_at = datetime.now(UTC)
                await write_consensus_card(
                    db,
                    group=group,
                    task=task,
                    coordinator_name=coordinator.display_name,
                    phase=CONSENSUS_PHASE_ABORTED,
                )
                await db.commit()
            processed += 1
        except Exception:
            _gsvc.log.warning(
                "consensus_sweep_task_failed",
                task_id=str(task.id),
                exc_info=True,
            )
            await db.rollback()
    return processed


async def consensus_sweeper_loop(
    interval: float = CONSENSUS_SWEEP_INTERVAL_SEC,
) -> None:
    """常驻巡检循环（main.py lifespan ``create_task`` 消费，task-09）.

    模式与关停契约同 ``scheduled_send_sweeper``（scheduled_send.py）：
    每轮经 ``get_session_factory()`` 开短 session、轮间不占连接池；单轮
    异常 ``except Exception`` 只 ``log.exception`` 吞掉不崩循环；
    ``asyncio.sleep`` 处 ``CancelledError`` 透传保证 shutdown cancel
    干净落地。
    """
    from app.core.db import get_session_factory

    while True:
        try:
            async with get_session_factory()() as db_session:
                processed = await consensus_sweep_once(db_session)
            if processed:
                _gsvc.log.info("consensus_sweep_round", processed=processed)
        except Exception:
            _gsvc.log.exception("consensus_sweep_round_failed")
        try:
            await asyncio.sleep(interval)
        except asyncio.CancelledError:
            raise
