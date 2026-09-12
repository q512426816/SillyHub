"""group 子域消息发送（task-09 拆分，task-03 design §4.1 / quick 影子直聊）。

发群消息（``send_group_message``：载体 run + user_input 原文 + 群频道 log 事件
+ @解析 + @全体并行触发编排）、单成员触发独立 session 协程体
（``_trigger_member_isolated``）、群附件校验、影子直聊（``send_direct_message``
+ ``prepare_shadow_direct_turn``——session 侧标准 inject 端点的直通准备）与
成员打断（``interrupt_member``）。方法体下沉自 GroupChatService，第一参数
传 service 实例（svc）。

D-007：get_redis / SessionService（patch 目标）与 ``_trigger_member_isolated``
内构造的 GroupChatService 一律经 ``_gsvc.`` 延迟解析。
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import AsyncSession

import app.modules.daemon.group.service as _gsvc
from app.core.errors import AppError
from app.modules.agent.model import (
    USER_INPUT_LOG_MAX_CHARS,
    AgentGroupChat,
    AgentGroupMember,
    AgentRun,
    AgentRunLog,
    AgentSession,
)
from app.modules.auth.model import User
from app.modules.daemon import attachment_pipeline
from app.modules.daemon.session.service import DaemonSessionTurnConflict

from .consensus import (
    CONSENSUS_MEMBER_FAILED,
    CONSENSUS_PHASE_ABORTED,
    CONSENSUS_PHASE_COLLECTING,
    CONSENSUS_PHASE_CONVERGING,
    CONSENSUS_TASK_ABORTED,
    CONSENSUS_TASK_CLOSING,
    CONSENSUS_TASK_OPEN,
    consensus_member_states,
    create_consensus_task,
    write_consensus_card,
)
from .helpers import (
    CONVERGE_DIRECTIVE,
    GROUP_CARRIER_SPEC_STRATEGY,
    GROUP_SESSION_PROVIDER,
    ROLE_PROMPT_COLLABORATOR,
    ROLE_PROMPT_COORDINATOR,
    SHADOW_DIRECT_SOURCE,
    GroupChatInvalid,
    GroupDirectMessageRead,
    GroupMemberInterruptRead,
    GroupMemberNoActiveRun,
    GroupMemberTriggerRead,
    GroupMessageSendRead,
    _attachment_prompt_lines,
    _attachment_summary_rows,
    _user_display_name,
)
from .mentions import (
    _has_broadcast_mention,
    _parse_group_mentions,
    _register_chain_members,
)
from .settings import _group_guardrail_settings
from .shadow import _MID_TURN_NOTICE, _is_member_lock_wait_timeout
from .timeline_reads import GROUP_LAST_MESSAGE_PREVIEW_CHARS
from .typing_presence import (
    _publish_agent_typing_event,
    _publish_group_channel_event,
    _publish_member_interrupted_notice,
    _publish_trigger_failed_notice,
    _trigger_failure_reason,
)

# quick 影子直聊（2026-09-02）：直聊注入 prompt 头（写在用户 content 前）。
# 不套 _build_group_prompt 群简报——直聊是影子会话内的独立对话，告知 agent
# 可见性语义 + [[GROUP]]...[[/GROUP]] 选择性转发标记用法（投影侧
# run_sync.extract_group_broadcast_segments 按同款标记抽段，标记文本保留在
# 影子会话原文、投影时剥离）。
# ql-20260903-002：可见性承诺对齐实际行为——「只在会话内可见」言过其实：
# 影子会话详情/日志对全体群成员开放（8dcc562f4 有测试锁定，群定位协作群、
# 跨成员可见性是需求）。如实表述为「不出现在群时间线 + 群成员可查会话」，
# 让 agent 据真实可见性把握表述分寸。
# quick-8170ca59（2026-09-03 修订）：直聊头改为 preamble 统一格式（【影子直聊】
# 头 + 换行分隔符切出真实消息）——前端 extractPreambleText 剥离（对话视图
# 只显示用户真实消息，注入说明进「进度」视图 preamble 段），与群 @ 轮
# 【群聊上下文】前导同款展示语义。
_SHADOW_DIRECT_HEADER = (
    "【影子直聊】\n"
    "用户正在群聊「{group_title}」成员「{member_name}」的独立会话中与你单独对话——"
    "此对话不会出现在群里（不投影到群时间线），但群成员可以在你的会话时间线中"
    "查看本对话内容，请据此把握表述分寸。如果你判断本轮内容对群内其他成员有价值，"
    "可在回复末尾用 [[GROUP]] 和 [[/GROUP]] 包裹要转发的段落，"
    "该段落会以你的群身份发到群里；无需转发则不要添加标记。\n\n---\n\n"
)


async def prepare_shadow_direct_turn(
    db: AsyncSession,
    *,
    shadow_session_id: uuid.UUID,
    sender_user_id: uuid.UUID,
) -> tuple[str, dict[str, object]] | None:
    """标准 inject 端点的影子直聊自动直通（quick 投影统一标记制 2026-09-02）。

    群主在 SessionPanel 对群成员影子会话发消息（标准 inject 端点，无群链路
    turn_metadata）时由 session/service 调用（函数内延迟 import 防循环）：
    解析直聊 prompt 头 + 直聊轮 metadata（``source=shadow_direct`` + 群/成员/
    直聊载体 run/发送者——投影过滤判定锚），并在**调用方事务内**落一个零日志
    的直聊载体 run（``[[GROUP]]`` 转发段投影行挂点，语义对齐
    send_direct_message 的载体：群时间线对直聊轮零可见 user_input 行）。
    返回 ``(直聊 prompt 头, 直聊轮 metadata)``。

    非群成员影子会话（成员行缺失）/ 群行缺失 → None（调用方零行为变化）。
    群 @ 触发 / 直聊端点 / 排队派发等服务路径自带 turn_metadata，不经本函数。
    """
    member = (
        (
            await db.execute(
                select(AgentGroupMember).where(
                    AgentGroupMember.shadow_session_id == shadow_session_id
                )
            )
        )
        .scalars()
        .one_or_none()
    )
    if member is None:
        return None
    group = await db.get(AgentGroupChat, member.group_id)
    if group is None:
        return None
    now = datetime.now(UTC)
    carrier = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider=GROUP_SESSION_PROVIDER,
        status="completed",
        started_at=now,
        finished_at=now,
        spec_strategy=GROUP_CARRIER_SPEC_STRATEGY,
        agent_session_id=group.session_id,
        user_id=sender_user_id,  # 直聊发起者归属（回放身份回退源）
    )
    db.add(carrier)
    header = _SHADOW_DIRECT_HEADER.format(group_title=group.title, member_name=member.display_name)
    return header, {
        "source": SHADOW_DIRECT_SOURCE,
        "source_group_id": str(group.id),
        "source_member_id": str(member.id),
        "source_carrier_run_id": str(carrier.id),
        "sender_user_id": str(sender_user_id),
    }


# ── GroupChatService 方法体下沉（第一参数 svc = service 实例，self→svc）───

# ── 群消息与 @触发管线（task-03，design §4.1-4.3 / §8）──────────────────


async def send_group_message(
    svc,
    group_id: uuid.UUID,
    user: User,
    content: str,
    attachment_ids: list[uuid.UUID] | None = None,
    reply_to_log_id: uuid.UUID | None = None,
) -> GroupMessageSendRead:
    """发群消息（design §4.1 步 1-6 / §8 group.message.sent；FR-05 补遗附件）。

    成员校验 → 附件校验（发送者归属 + 数量，照单聊管线口径）→ 载体 run +
    user_input 原文落库（metadata 带附件摘要；附件行绑定群会话防 48h 草稿
    清理）→ 群频道 log 事件（sender 身份 + 附件摘要）→ @解析 → 逐命中
    agent 成员触发（懒建/注入/排队见 ``_trigger_group_member``）。未 @ 消息
    仅落时间线（进后续群背景摘要），不触发任何成员；附件随触发成员注入
    下发（D-7 看图说话：附件非空豁免空 content）。

    引用回复（群 P2 第二波）：``reply_to_log_id`` 校验属本群时间线
    （``_get_timeline_row``，跨群/不存在 404）后落 ``reply_to`` 快照进
    user_input metadata 与群频道 log 事件 payload（同结构：
    ``{log_id, member_name, content_head}``）——回放侧走 logs DTO metadata
    透出，前端据此高亮「回复的是哪句话」。

    失败语义（quick 群 P2 部分失败收集）：载体 run 与触发是两个事务——消息
    先落时间线；**逐成员触发失败（机器未授权 / 队列满 / 会话闸满 / 成员引擎
    不支持附件等 AppError）不再整条抛**：该成员 ``triggered`` 项带 ``error``
    中文摘要 + 群频道系统行「成员「X」触发失败：{原因}」，其余成员照常触发
    （响应恒 200，前端按 ``error`` 非空提示「消息已发送，部分成员触发失败」）。
    """
    group = await svc._get_group(group_id)
    membership = await svc._require_group_member(group, user)
    if group.ended_at is not None:
        raise GroupChatInvalid(
            "群已解散，无法发送消息。",
            details={"group_id": str(group.id)},
        )
    if not (content or "").strip() and not attachment_ids:
        raise GroupChatInvalid("消息内容不能为空。", details={"reason": "empty_prompt"})
    # admin 兜底放行无成员行——昵称回落用户显示名。
    sender_member_name = (
        membership.display_name if membership is not None else _user_display_name(user)
    )

    # ── 引用回复校验（先于落库：跨群/不存在的 log 整条 404，不产生半截消息）。
    reply_to_snapshot: dict[str, str] | None = None
    if reply_to_log_id is not None:
        reply_row, reply_member_name = await svc._get_timeline_row(group, reply_to_log_id)
        reply_to_snapshot = {
            "log_id": str(reply_row.id),
            "member_name": reply_member_name,
            "content_head": (reply_row.content_redacted or "").strip()[
                :GROUP_LAST_MESSAGE_PREVIEW_CHARS
            ],
        }

    # ── 附件校验（发送侧：归属按发送者 + 数量；引擎门控下沉到逐成员触发）
    #    口径照单聊 _validate_inject_attachment_rows 的归属/数量段，错误族
    #    用群 GroupChatInvalid（400，中文文案）。
    attachment_rows: list = []
    if attachment_ids:
        attachment_rows = await svc._validate_group_attachments(user.id, attachment_ids)

    members = await svc._list_active_member_rows(group.id)

    # ── 载体 run + user_input 原文（§4.1 步 2；design §2「纯载体无执行
    #    语义」——status='completed' 满足 AgentRunLog.run_id NOT NULL FK 的
    #    承载，started_at 落值供时间线排序/审计）。
    now = datetime.now(UTC)
    carrier = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider=GROUP_SESSION_PROVIDER,
        status="completed",
        started_at=now,
        finished_at=now,
        spec_strategy=GROUP_CARRIER_SPEC_STRATEGY,
        agent_session_id=group.session_id,
        user_id=user.id,  # 发送者归属（回放身份回退源）
    )
    svc._session.add(carrier)
    await svc._session.flush()
    # 发送者身份（§5.2）+ 附件摘要（FR-05 补遗：回放行/前端附件条数据源）。
    user_input_metadata: dict[str, object] = {
        "sender_user_id": str(user.id),
        "sender_member_name": sender_member_name,
    }
    if reply_to_snapshot is not None:
        user_input_metadata["reply_to"] = reply_to_snapshot
    attachment_summary: list[dict[str, object]] = []
    if attachment_rows:
        # 物化：附件行绑定群载体会话（draft→bound）——群附件被多成员/时间线
        # 共享不绑单一影子；session_id 非 NULL 即免 48h 草稿清理（cleanup.py
        # 只删 session_id IS NULL 行），与单聊 inject 回填同一前进方向。
        for att_row in attachment_rows:
            if att_row.session_id is None:
                att_row.session_id = group.session_id
                svc._session.add(att_row)
        attachment_summary = _attachment_summary_rows(attachment_rows)
        user_input_metadata["attachments"] = attachment_summary
    log_row = AgentRunLog(
        id=uuid.uuid4(),
        run_id=carrier.id,
        channel="user_input",
        content_redacted=content[
            :USER_INPUT_LOG_MAX_CHARS
        ],  # user_input 统一截断口径（ql-20260910-016）
        timestamp=now,
        metadata_=user_input_metadata,
    )
    svc._session.add(log_row)
    # 未读位点（群 P2 第二波）：发送即已读——发送者位点推进到本条消息时间戳
    # （ts > 位点判定下自己这条不计未读；admin 兜底无成员行则无位点可置）。
    if membership is not None:
        membership.last_read_at = now
        svc._session.add(membership)
    await svc._session.commit()

    # ── 群频道 log 事件（§4.1 步 3；payload 形态照 run_sync session channel
    #    log 事件扩展 sender 字段，前端 SessionStreamEnvelope 消费；附件
    #    摘要与 metadata 同形态（FR-05 补遗）。
    log_payload: dict[str, object] = {
        "event": "log",
        "session_id": str(group.session_id),
        "run_id": str(carrier.id),
        "log_id": str(log_row.id),
        "channel": "user_input",
        "content": content,
        "timestamp": now.isoformat(),
        "sender_user_id": str(user.id),
        "sender_member_name": sender_member_name,
    }
    if attachment_summary:
        log_payload["attachments"] = attachment_summary
    if reply_to_snapshot is not None:
        log_payload["reply_to"] = reply_to_snapshot
    await _publish_group_channel_event(group.session_id, log_payload)

    # ── @解析 + 触发编排（§4.1 步 4-6）。
    mentioned = _parse_group_mentions(content, members)
    mentioned_ids = [m.id for m in mentioned]
    # ── 汇总模式分支（2026-09-10-group-agent-direct-chat design §5.3，D-003）：
    #    开关开启且去重后 agent 目标 ≥2 → 汇总收口编排（不满足则原路径
    #    零变化，D-002 回归底线）。汇总人 = 单@首个（文本出现序）优先，纯
    #    @全体 取成员表序首个；目标集 = 单@ ∪ 广播展开去重。
    consensus_task = None
    consensus_coordinator = None
    use_consensus = bool(mentioned) and group.consensus_mode and len(mentioned) >= 2
    if use_consensus:
        explicit_hits, broadcast_expanded = _parse_group_mentions(
            content, members, split_broadcast=True
        )
        ordered: list = []
        seen_ids: set[uuid.UUID] = set()
        for m in [*explicit_hits, *broadcast_expanded]:
            if m.id not in seen_ids:
                seen_ids.add(m.id)
                ordered.append(m)
        consensus_coordinator = ordered[0]
        collaborators = ordered[1:]
        try:
            consensus_task = await create_consensus_task(
                svc._session,
                group=group,
                carrier_run_id=carrier.id,
                coordinator=consensus_coordinator,
                collaborators=collaborators,
                created_by=user.id,
                source_summary=content[:GROUP_LAST_MESSAGE_PREVIEW_CHARS],
            )
        except DBAPIError as exc:
            # FK 撞锁降级（真实复验补盲，2026-09-12 design §2.2）：任务行
            # INSERT 的外键（coordinator_member_id → agent_group_members）
            # 在 PG 内需对父行取 KEY SHARE 锁——与成员行 FOR UPDATE 持锁方
            # （触发链懒建/外部事务）互斥，同样吃 lock_timeout 55P03。
            # 降级：rollback（消息已上方 commit 落时间线不丢）→ 无任务继续
            # ——本轮退化为普通多 @ 消息（无共识卡，触发照常、各自部分
            # 失败收集）；比 500 整条回滚丢任务/4xx 撕裂（客户端重发重复
            # 消息）均优。非 55P03 的 DBAPIError 原样冒泡（非锁语义不降级）。
            if not _is_member_lock_wait_timeout(exc):
                raise
            await svc._session.rollback()
            consensus_task = None
            consensus_coordinator = None
            # rollback 过期恢复：group/members 若在本事务内有 pending 修改
            # 会被过期（gather 段续用炸 lazy load）——重查恢复（identity map
            # 同对象；无锁 SELECT 不撞锁）。user 来自 auth 依赖（detached
            # 带属性，不属本 session），rollback 不影响，直接续用。
            await svc._session.refresh(group)
            await svc._session.refresh(carrier)
            await svc._session.refresh(log_row)
            members = await svc._list_active_member_rows(group.id)
            mentioned = _parse_group_mentions(content, members)
            _gsvc.log.warning(
                "group_consensus_task_lock_busy_degraded",
                group_id=str(group.id),
                coordinator_member_id=str(ordered[0].id),
                detail="consensus INSERT blocked by member-row lock (55P03); degraded to plain multi-mention message",
            )
        if consensus_task is not None:
            _gsvc.log.info(
                "group_consensus_task_created",
                group_id=str(group.id),
                consensus_task_id=str(consensus_task.id),
                coordinator_member_id=str(consensus_coordinator.id),
                collaborator_count=len(collaborators),
            )
            # 任务行先行提交（2026-09-12-group-trigger-lock-graceful design §2.2）：
            # create_consensus_task 是 flush-only——挂在主事务的任务行在并行
            # 触发失败（含成员行锁超时报忙）时会被整条回滚，产生「消息已落
            # 时间线（上方先 commit）但任务蒸发」的不一致，sweeper 无从兜底
            # （任务行不存在）。gather 前显式 commit：任务与消息同生，触发
            # 全失败由 sweeper 超时收口 aborted（D-006 兜底闭环按设计意图
            # 生效，非数据残留）。sessionmaker expire_on_commit=False（core/
            # db.py）——commit 后 consensus_task/group 等对象属性保持可用，
            # gather 段/收口段读写不受影响。普通路径（use_consensus=False）
            # 零变化，不新增 commit。
            # 降级路径无任务行可 commit，不进本分支。
            await svc._session.commit()
    # 返回体用标量（PK 不过期；并行触发子链 rollback 已隔离在各自独立
    # session，不再触碰请求 session 的对象状态——防御性口径保留）。
    carrier_run_id_val = carrier.id
    log_row_id_val = log_row.id
    triggered: list[GroupMemberTriggerRead] = []
    if mentioned:
        member_lines = [
            f"{m.display_name}({'用户' if m.member_type == 'user' else 'Agent'})" for m in members
        ]
        # task-04（design §4.4）：用户 @ 直接触发的成员入协作链（链 id=本
        # 载体 run；深度 0；后续互@沿用原链去重/判深）——best-effort，Redis
        # 抖动不阻断发送（互@侧 fail-closed 自兜底）。链 TTL quick 群 P1
        # 群级可配（与互@侧刷新同源，默认模块常量）。
        _, _, chain_ttl_seconds = _group_guardrail_settings(group)
        try:
            redis = _gsvc.get_redis()
            await redis.ping()  # type: ignore[misc]  # redis-py stubs union 返回
            await _register_chain_members(
                redis,
                carrier.id,
                [m.id for m in mentioned],
                ttl_seconds=chain_ttl_seconds,
            )
        except Exception:
            _gsvc.log.warning(
                "group_chain_register_unavailable",
                carrier_run_id=str(carrier.id),
                exc_info=True,
            )
        # ── 并行触发（群 P2 第二波，模块 docstring「@全体并行触发」段）：每
        #    成员一协程，协程内经 ``get_session_factory()`` 开**独立短
        #    session**（单请求 AsyncSession 不可并发使用，照
        #    ``dispatch_next_queued_message`` 的独立 session 工厂模式）重取
        #    group/member/members/附件行后调同一 ``_trigger_group_member``
        #    （单成员触发路径零变化）。懒建 + readiness wait 在各协程内并行
        #    等待（总耗时 = max 而非 sum）；触发子链的 rollback 发生在各自
        #    独立 session——不再 expire 请求 session 内对象（原预取标量/失败
        #    后重取行的刷新链随之移除，仅保留返回体标量预取的防御口径）。
        group_id_val = group.id
        group_session_id_val = group.session_id
        sender_user_id_val = user.id
        attachment_ids_val = [r.id for r in attachment_rows] if attachment_rows else None
        targets = sorted(mentioned, key=lambda m: (m.joined_at, m.id))

        # 汇总模式角色参数（design §5.3 步 5）：coordinator/collaborator 分别
        # 带角色段与 metadata 标记（D-007 投影拦截链路锚点）；普通路径 None
        # 零变化。
        def _consensus_trigger_kwargs(member) -> dict:
            if consensus_task is None or consensus_coordinator is None:
                return {}
            if member.id == consensus_coordinator.id:
                return {
                    "role_prompt": ROLE_PROMPT_COORDINATOR,
                    "turn_overrides": {
                        "consensus_task_id": str(consensus_task.id),
                        "consensus_role": "coordinator",
                    },
                }
            return {
                "role_prompt": ROLE_PROMPT_COLLABORATOR.format(
                    coordinator_name=consensus_coordinator.display_name
                ),
                "turn_overrides": {
                    "consensus_task_id": str(consensus_task.id),
                    "consensus_role": "collaborator",
                    "dm_target_member_id": str(consensus_coordinator.id),
                    "dm_kind": "consensus",
                },
            }

        results = await asyncio.gather(
            *(
                svc._trigger_member_isolated(
                    group_id=group_id_val,
                    member_id=member.id,
                    member_lines=member_lines,
                    sender_user_id=sender_user_id_val,
                    sender_member_name=sender_member_name,
                    content=content,
                    carrier_run_id=carrier_run_id_val,
                    exclude_log_id=log_row_id_val,
                    attachment_ids=attachment_ids_val,
                    **_consensus_trigger_kwargs(member),
                )
                for member in targets
            ),
            return_exceptions=True,
        )
        # gather 保序：results 与 targets 按成员序（joined_at）一一对应。
        for member, result in zip(targets, results, strict=True):
            if isinstance(result, BaseException):
                # quick 群 P2 部分失败收集：单成员触发失败（引擎门控 400 /
                # 机器不可用 / 队列满 / 会话闸满等 AppError）不整条抛——该
                # 成员 triggered 项带 error 摘要 + 群频道系统行（用户可感
                # 沉默场景：消息已落时间线但成员没跑起来）。非 AppError 的
                # 意外异常（含 CancelledError）fail-loud 上抛，但注意并行
                # 语义（ql-20260904-M2 注记）：gather 收口时全部成员已被
                # 触发（影子已建/轮已注入），上抛只把响应变 500、不阻止
                # 任何成员——与串行版「异常即中断后续成员」不同，属并行化
                # 的已知取舍（意外异常是编程错误信号，上抛保可见性）。
                if not isinstance(result, AppError):
                    raise result
                reason = _trigger_failure_reason(result)
                _gsvc.log.warning(
                    "group_member_trigger_failed",
                    group_id=str(group_id_val),
                    member_id=str(member.id),
                    code=result.code,
                    reason=reason,
                )
                # 汇总模式失败登记（design §5.3 步 6 + §12.1）：coordinator
                # 失败 → 任务立即 aborted（意见转交失去目的地，不等待其余
                # 成员）+ 状态卡终态；collaborator 失败 → 明细 state=failed +
                # 状态卡更新（收口判定在钩子/超时路径，task-07/08/09）。
                if consensus_task is not None and consensus_coordinator is not None:
                    member_states = consensus_member_states(consensus_task)
                    if member.id == consensus_coordinator.id:
                        consensus_task.status = CONSENSUS_TASK_ABORTED
                        consensus_task.converged_at = datetime.now(UTC)
                        await write_consensus_card(
                            svc._session,
                            group=group,
                            task=consensus_task,
                            coordinator_name=consensus_coordinator.display_name,
                            phase=CONSENSUS_PHASE_ABORTED,
                        )
                    else:
                        for row in member_states:
                            if row.get("member_id") == str(member.id):
                                row["state"] = CONSENSUS_MEMBER_FAILED
                        consensus_task.members = member_states
                        await write_consensus_card(
                            svc._session,
                            group=group,
                            task=consensus_task,
                            coordinator_name=consensus_coordinator.display_name,
                            phase=CONSENSUS_PHASE_COLLECTING,
                        )
                await _publish_trigger_failed_notice(
                    group_session_id_val, member_name=member.display_name, reason=reason
                )
                triggered.append(
                    GroupMemberTriggerRead(
                        member_id=member.id,
                        member_name=member.display_name,
                        shadow_session_id=member.shadow_session_id,
                        error=reason,
                    )
                )
                continue
            triggered.append(result)
            # task-06（design §5.4）：影子 run 开始（即时注入/懒建首轮，非
            # 排队）→ 自动发一条 agent typing（「昵称」正在输入…）。排队轮
            # run 尚未开始不发（typing 指示器语义=正在生成回复）。
            # 运行态可见 quick（2026-09-02）：payload 补 member_id + 回复
            # 锚点 reply_to_log_id=本轮触发消息的群时间线 user_input 行 id
            # （载体 run 下的 log_row，前端据此高亮「正在响应哪句话」）。
            # 并行化后按成员序在 gather 收口统一补发（成员间触发已并行，
            # typing 事件相对 run 开始最多延迟到最慢成员返回，纯增益信号
            # 容忍）。
            if not result.queued:
                await _publish_agent_typing_event(
                    group_id_val,
                    member.display_name,
                    member_id=str(member.id),
                    reply_to_log_id=str(log_row_id_val),
                )
        # ── 汇总模式立即收口（design §12.1）：coordinator 触发成功而全部
        #    collaborator 触发失败——零意见等待无意义（无钩子会来、超时要等
        #    全程），直接注入收口指令让汇总人说明情况收口。收口触发本身失败
        #    → 任务 aborted + 状态卡终态（不再重试，设计同 coordinator 失败
        #    语义）。非全败场景的等齐收口在钩子路径（task-08）/超时 sweeper
        #    （task-09）。
        if (
            use_consensus
            and consensus_task is not None
            and consensus_coordinator is not None
            and consensus_task.status == CONSENSUS_TASK_OPEN
        ):
            states = consensus_member_states(consensus_task)
            if states and all(r.get("state") == CONSENSUS_MEMBER_FAILED for r in states):
                non_responders = "、".join(str(r.get("member_name", "?")) for r in states)
                try:
                    await svc._trigger_member_isolated(
                        group_id=group_id_val,
                        member_id=consensus_coordinator.id,
                        member_lines=member_lines,
                        sender_user_id=sender_user_id_val,
                        sender_member_name=sender_member_name,
                        content=content,
                        carrier_run_id=carrier_run_id_val,
                        exclude_log_id=log_row_id_val,
                        attachment_ids=attachment_ids_val,
                        role_prompt=CONVERGE_DIRECTIVE.format(
                            source_summary=content[:GROUP_LAST_MESSAGE_PREVIEW_CHARS],
                            opinions="（无——全部被咨询成员触发失败）",
                            non_responders=non_responders,
                        ),
                        turn_overrides={
                            "consensus_task_id": str(consensus_task.id),
                            "consensus_role": "converge",
                        },
                    )
                    consensus_task.status = CONSENSUS_TASK_CLOSING
                    await write_consensus_card(
                        svc._session,
                        group=group,
                        task=consensus_task,
                        coordinator_name=consensus_coordinator.display_name,
                        phase=CONSENSUS_PHASE_CONVERGING,
                    )
                except AppError as exc:
                    _gsvc.log.warning(
                        "group_consensus_immediate_converge_failed",
                        consensus_task_id=str(consensus_task.id),
                        code=exc.code,
                        reason=_trigger_failure_reason(exc),
                    )
                    consensus_task.status = CONSENSUS_TASK_ABORTED
                    consensus_task.converged_at = datetime.now(UTC)
                    await write_consensus_card(
                        svc._session,
                        group=group,
                        task=consensus_task,
                        coordinator_name=consensus_coordinator.display_name,
                        phase=CONSENSUS_PHASE_ABORTED,
                    )
    return GroupMessageSendRead(
        carrier_run_id=carrier_run_id_val,
        log_id=log_row_id_val,
        mentioned_member_ids=mentioned_ids,
        mention_all=_has_broadcast_mention(content),
        triggered=triggered,
        consensus_task_id=(consensus_task.id if consensus_task is not None else None),
    )


async def _trigger_member_isolated(
    svc,
    *,
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    member_lines: list[str],
    sender_user_id: uuid.UUID,
    sender_member_name: str,
    content: str,
    carrier_run_id: uuid.UUID,
    exclude_log_id: uuid.UUID | None,
    attachment_ids: list[uuid.UUID] | None = None,
    role_prompt: str | None = None,
    turn_overrides: dict | None = None,
) -> GroupMemberTriggerRead:
    """单成员触发的独立 session 协程体（群 P2 第二波并行编排）。

    ``send_group_message`` 的 gather 每成员调一次本方法：协程内经
    ``get_session_factory()`` 开独立短 session（对齐 ``dispatch_next_
    queued_message`` 后台派发模式——请求级 AsyncSession 不可并发使用），
    在本 session 内**重取** group / member / members / 附件行（跨 session
    共享 ORM 实例不安全：``_ensure_shadow_session`` 要 ``add(member)``
    回填指针，实例必须归属本 session）后调 ``_trigger_group_member``。

    附件行按 id 重走 ``_validate_group_attachments``（归属=发送者，发送侧
    已过同一校验——幂等重查，只多两条 SELECT/成员）。session 随 async with
    收口归还连接池；``_trigger_group_member`` 内部各事务边界（懒建 commit /
    注入 commit / 失败 rollback）自持。

    ``role_prompt`` / ``turn_overrides``（2026-09-10-group-agent-direct-chat
    task-04 扩展）：汇总模式角色段与 metadata 标记透传（task-03 发送侧
    fan-out / 收口指令注入消费）；默认 None 时单成员触发路径零变化。
    """
    from app.core.db import get_session_factory

    async with get_session_factory()() as db:
        svc = _gsvc.GroupChatService(db)
        group = await svc._get_group(group_id)
        member = await svc._get_member(group_id, member_id)
        members = await svc._list_active_member_rows(group_id)
        attachment_rows = None
        if attachment_ids:
            attachment_rows = await svc._validate_group_attachments(sender_user_id, attachment_ids)
        return await svc._trigger_group_member(
            group=group,
            member=member,
            members=members,
            member_lines=member_lines,
            sender_user_id=sender_user_id,
            sender_member_name=sender_member_name,
            content=content,
            carrier_run_id=carrier_run_id,
            exclude_log_id=exclude_log_id,
            attachment_rows=attachment_rows,
            role_prompt=role_prompt,
            turn_overrides=turn_overrides,
        )


async def _validate_group_attachments(
    svc, sender_user_id: uuid.UUID, attachment_ids: list[uuid.UUID]
) -> list:
    """群消息附件校验（归属/数量，口径照单聊 ``_validate_inject_attachment_rows``）。

    与单聊差异：①引擎门控不在发送侧——群成员引擎各异，门控下沉到逐成员
    触发时判定（``_trigger_group_member``，非 Claude 成员 → 400 群错误族）；
    ②缺失/跨用户归一 400 GroupChatInvalid（群链路错误族语义；单聊是 404
    资源隐藏——群侧消息整体拒绝即可，无逐会话资源语义）。保序同单聊。

    task-11 轻重构⑤：归属/数量/保序核心收敛到
    ``daemon/attachment_pipeline.validate_owned_attachments``（与单聊 inject/
    create 校验单源；错误族经工厂回调保留群链路 GroupChatInvalid 语义）。
    """
    from app.modules.session_attachment.service import (
        MAX_FILES_PER_MESSAGE,
        MAX_IMAGES_PER_MESSAGE,
    )

    def _not_found() -> AppError:
        return GroupChatInvalid(
            "部分附件不存在或无权访问。",
            details={"reason": "attachment_not_found"},
        )

    def _invalid_count(image_n: int, file_n: int) -> AppError:
        return GroupChatInvalid(
            f"附件数量超限（图片≤{MAX_IMAGES_PER_MESSAGE}、"
            f"文件≤{MAX_FILES_PER_MESSAGE}）或类型非法。",
            details={"image_count": image_n, "file_count": file_n},
        )

    return await attachment_pipeline.validate_owned_attachments(
        svc._session,
        user_id=sender_user_id,
        attachment_ids=attachment_ids,
        not_found_error=_not_found,
        invalid_count_error=_invalid_count,
    )


async def send_direct_message(
    svc,
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    user: User,
    content: str,
    attachment_ids: list[uuid.UUID] | None = None,
) -> GroupDirectMessageRead:
    """群主对成员影子会话直聊（quick 2026-09-02 影子直聊+选择性回群投影）。

    语义：对影子会话的一次**纯会话注入**（非群消息）——不走群 @ 触发链：
    零群频道 log 事件、零 @ 解析、零群背景简报（``_build_group_prompt``
    不适用），直聊内容只落影子会话时间线；agent 回复中的 ``[[GROUP]]``
    段经 run_sync 桥接投影层选择性发群（本方法只负责标记说明进 prompt）。

    - 权限：``_require_group_member``（非成员 404 不泄露存在性）→
      ``_require_group_owner``（成员可见但**写=群主/workspace admin**，
      照 management 端点 owner 门）；
    - 影子未建 → 400（先在群内 @ 成员触发懒建；直聊不承担建会话职责）；
    - 载体 run：照群消息同款空载体（spec_strategy='group_carrier'）但
      **零日志行**——群时间线/背景摘要对直聊轮零可见；轮 metadata
      ``source="shadow_direct"`` + ``source_carrier_run_id``=本载体
      （投影过滤判定锚 + [[GROUP]] 段投影行挂点）；
    - 注入：复用 inject 通道同群消息忙轮策略——``busy_strategy="inject"``
      中途注入活跃轮（直聊也应尽快可见），409 竞态降级排队兜底；
    - 附件：同群消息口径（发送者归属 + Claude 引擎门控 + D-7 空内容豁免）。
    """
    group = await svc._get_group(group_id)
    membership = await svc._require_group_member(group, user)
    await svc._require_group_owner(group, user)
    if group.ended_at is not None:
        raise GroupChatInvalid(
            "群已解散，无法发送直聊消息。",
            details={"group_id": str(group.id)},
        )
    member = await svc._get_member(group.id, member_id)
    if member.member_type != "agent":
        raise GroupChatInvalid(
            "仅 agent 成员支持独立会话直聊。",
            details={"member_id": str(member.id)},
        )
    if not (content or "").strip() and not attachment_ids:
        raise GroupChatInvalid("消息内容不能为空。", details={"reason": "empty_prompt"})
    if member.shadow_session_id is None:
        raise GroupChatInvalid(
            f"成员「{member.display_name}」的独立会话尚未创建，"
            "请先在群内 @ 该成员完成一次触发后再直聊。",
            details={"member_id": str(member.id)},
        )
    shadow = await svc._session.get(AgentSession, member.shadow_session_id)
    if shadow is None or shadow.status in ("ended", "failed"):
        raise GroupChatInvalid(
            f"成员「{member.display_name}」的独立会话当前不可用，请先在群内重新 @ 该成员触发。",
            details={"member_id": str(member.id)},
        )

    attachment_rows: list = []
    if attachment_ids:
        attachment_rows = await svc._validate_group_attachments(user.id, attachment_ids)
        # 引擎门控（同 _trigger_group_member 口径：仅 Claude 支持附件）。
        if (member.provider or "claude") != "claude":
            raise GroupChatInvalid(
                f"成员「{member.display_name}」的引擎不支持附件"
                "（仅 Claude 支持多模态与文件注入）。",
                details={"member_id": str(member.id), "provider": member.provider},
            )

    # admin 兜底放行无成员行——昵称回落用户显示名（同 send_group_message）。
    sender_member_name = (
        membership.display_name if membership is not None else _user_display_name(user)
    )

    # ── 直聊载体 run（空载体：不落 user_input 行——直聊内容不进群时间线；
    #    [[GROUP]] 转发段投影行在 run_sync 桥接层挂本 run）。
    now = datetime.now(UTC)
    carrier = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider=GROUP_SESSION_PROVIDER,
        status="completed",
        started_at=now,
        finished_at=now,
        spec_strategy=GROUP_CARRIER_SPEC_STRATEGY,
        agent_session_id=group.session_id,
        user_id=user.id,  # 直聊发起者归属（回放身份回退源）
    )
    svc._session.add(carrier)
    await svc._session.commit()

    # prompt：直聊头（preamble 格式——【影子直聊】头 + 分隔符）+ 用户内容
    # （+附件行，附件随内容之后属消息体参考）。展示层经 extractPreambleText
    # 剥离前导（对话视图只显示真实用户消息，注入说明进「进度」视图折叠）。
    prompt = _SHADOW_DIRECT_HEADER.format(group_title=group.title, member_name=member.display_name)
    if (content or "").strip():
        # header 尾部已带 "\n\n---\n\n" 分隔符——用户内容直接衔接。
        prompt = f"{prompt}{content}"
    if attachment_rows:
        prompt += "\n\n[当前消息附件 · 用户随消息发送，可直接读取参考]\n" + "\n".join(
            _attachment_prompt_lines(attachment_rows)
        )

    # 本轮 user_input metadata（投影过滤判定锚）：source="shadow_direct" +
    # 直聊载体 run + 发送者。排队兜底轮经 _prepend_group_chain_marker 的
    # source 段透传（session/service.py），派发后判定不回退成全投影。
    turn_metadata: dict[str, object] = {
        "source": SHADOW_DIRECT_SOURCE,
        "source_group_id": str(group.id),
        "source_member_id": str(member.id),
        "source_carrier_run_id": str(carrier.id),
        "sender_user_id": str(user.id),
        "sender_member_name": sender_member_name,
        # quick-6966fcee 注入分离展示（同群 @ 轮语义）。
        "user_message": content,
    }

    # 忙轮中途注入同群消息（busy_strategy="inject"：直聊也应尽快可见；
    # 409 竞态降级回排队，消息不丢）。
    active_run = await svc._get_shadow_active_run(shadow.id)
    inject_prompt = prompt
    if active_run is not None:
        inject_prompt = f"{_MID_TURN_NOTICE}\n{prompt}"
    try:
        result = await _gsvc.SessionService(svc._session).inject_session_as_service(
            shadow.id,
            prompt=inject_prompt,
            busy_strategy="inject",
            queue_when_busy=True,
            queue_sender_user_id=user.id,
            turn_metadata=turn_metadata,
            attachment_ids=[r.id for r in attachment_rows] if attachment_rows else None,
            attachment_owner_user_id=user.id if attachment_rows else None,
        )
    except DaemonSessionTurnConflict:
        result = await _gsvc.SessionService(svc._session).inject_session_as_service(
            shadow.id,
            prompt=inject_prompt,
            queue_when_busy=True,
            queue_sender_user_id=user.id,
            turn_metadata=turn_metadata,
            attachment_ids=[r.id for r in attachment_rows] if attachment_rows else None,
            attachment_owner_user_id=user.id if attachment_rows else None,
        )
    return GroupDirectMessageRead(
        shadow_session_id=shadow.id,
        run_id=result.agent_run.id if result.agent_run is not None else None,
        queued=result.queued,
        mid_turn=result.mid_turn,
        carrier_run_id=carrier.id,
    )


async def interrupt_member(
    svc,
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    user: User,
) -> GroupMemberInterruptRead:
    """群内打断成员当前运行任务（quick 群 P1，design §8 member.interrupted）。

    失控 agent 人人可停——权限刻意宽于群主专属操作：**任意群成员**可打断
    （``_require_group_member`` 即可，无 owner 门；群主/workspace admin 天然
    含在成员判定内），这是打断功能的存在意义。

    - 目标仅 agent 成员（用户成员无运行任务，400）；影子未建 / 无活跃
      run → 409「该成员当前没有运行中的任务」；
    - 打断执行**零改动复用**单聊 interrupt 服务路径
      （``SessionService.interrupt_session``）——服务身份传群主 user_id
      （影子属主恒为群主，§9.2；照 ``_end_member_shadow`` 传 owner 先例，
      普通成员无需是影子会话属主）；run 状态不预置，daemon 侧打断结果
      驱动收口（单聊 FR-04 语义原样）；
    - 成功后群频道发 ``channel='system'`` 系统行（照限频提示
      ``_publish_rate_limit_notice`` 先例，ephemeral 不落库）。
    """
    group = await svc._get_group(group_id)
    membership = await svc._require_group_member(group, user)
    if group.ended_at is not None:
        raise GroupChatInvalid(
            "群已解散，无法打断成员任务。",
            details={"group_id": str(group.id)},
        )
    member = await svc._get_member(group.id, member_id)
    if member.member_type != "agent":
        raise GroupChatInvalid(
            "仅 agent 成员支持打断任务。",
            details={"member_id": str(member.id)},
        )
    if member.shadow_session_id is None:
        raise GroupMemberNoActiveRun(
            "该成员当前没有运行中的任务。",
            details={"group_id": str(group.id), "member_id": str(member.id)},
        )
    active_run = await svc._get_shadow_active_run(member.shadow_session_id)
    if active_run is None:
        raise GroupMemberNoActiveRun(
            "该成员当前没有运行中的任务。",
            details={"group_id": str(group.id), "member_id": str(member.id)},
        )

    # 打断者昵称（admin 兜底放行无成员行 → 回落用户显示名，同 send_direct_message）。
    interrupter_name = (
        membership.display_name if membership is not None else _user_display_name(user)
    )

    # 单聊 interrupt 服务路径零改动（user_id=群主=影子属主，服务身份先例）。
    result = await _gsvc.SessionService(svc._session).interrupt_session(
        member.shadow_session_id,
        group.created_by,
    )

    await _publish_member_interrupted_notice(
        group, member_name=member.display_name, interrupter_name=interrupter_name
    )
    return GroupMemberInterruptRead(
        member_id=member.id,
        display_name=member.display_name,
        run_id=result.current_run_id or active_run.id,
        interrupted_by_name=interrupter_name,
    )


async def mark_group_read(svc, group_id: uuid.UUID, user: User) -> None:
    """标记群已读至此（群 P2 第二波未读位点；``PUT /{group_id}/read``）。

    成员校验（非成员 404 不泄露存在性）后服务端直接置 ``now()``——无 body
    无客户端时间戳（时钟信任单一源=服务端）。已解散群照常可标记（成员仍
    可读历史，位点语义不变）。admin 兜底放行无成员行 → 幂等收口（无位点
    可置，未读视角恒 0 不受影响）。幂等：重复 PUT 只是位点前移，无系统行
    无群频道事件（纯位点写，无副作用广播）。
    """
    group = await svc._get_group(group_id)
    membership = await svc._require_group_member(group, user)
    if membership is None:
        return
    membership.last_read_at = datetime.now(UTC)
    svc._session.add(membership)
    await svc._session.commit()
