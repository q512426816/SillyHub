"""群桥接投影簇（task-10 拆分）：影子会话 → 群时间线双写投影。

_GroupBridgeContext（落库时刻快照）/ resolve_group_member_identity（影子 →
成员身份反查；submit 投影解析与 close 群收口共用）/ is_group_projectable_
reply + [[GROUP]] 标记段抽取（投影口径）/ 兜底行模板与摘要常量 / 类方法体
下沉（_resolve_group_bridge_context / _build_group_projection_row / 兜底行
_emit_group_mention_projection_fallback / 摘要 _build_group_fallback_summary）
+ close_interactive_run 的群收口簇（_close_group_hooks：群频道 turn_completed
+ 无标记兜底 + typing 止息 + 互@检测挂接）。D-007：get_redis 经 ``_rsvc.``
延迟解析；log 经 ``_rsvc.log`` 保持原模块 logger 身份。
"""

from __future__ import annotations

import json
import re
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.modules.daemon.run_sync.service as _rsvc
from app.modules.agent.model import AgentGroupMember, AgentRun, AgentRunLog, AgentSession

# ── task-05（2026-09-01-session-group-chat / design §5.2）：桥接投影 ─────────────
# 群成员影子会话（AgentSession.session_kind='group_member'）的 agent 回复在落库
# 影子 run 的同时，**同事务双写**一行「投影行」到群载体 run（新 PK；dedup_key
# 复用原值；身份进 metadata_ 列）——刷新/重连回放走 get_agent_session_logs 按
# agent_session_id=群会话 聚合天然覆盖；实时群频道事件（publish_submitted_messages
# 群分支）log_id=投影行 id，实时与回放读库同 id，前端 seenLogIds 去重两端对齐。
# 判定铁律：session_kind=='group_member' 精确命中——单聊（chat）/ worker 回流 /
# quick-chat 会话零行为变化（constraints）。


@dataclass(frozen=True)
class _GroupBridgeContext:
    """submit_messages 事务内解析出的群桥接上下文（落库时刻快照，publish 阶段不查库）。

    - ``group_id``：群 id == 群会话 id（design §3.2 不变式；群频道
      ``agent_session:{group_id}`` 与回放聚合共用该 id）；
    - ``member_name``：身份按落库时刻快照（成员改名不回填历史投影行）；
    - ``carrier_run_id``：触发本轮的群消息载体 run（投影行 run_id 指向；
      从本 run 最近一条 user_input 日志 metadata_.source_carrier_run_id 解析，
      task-03 注入时落、§4.4 链 id 透传同源）；
    - ``shadow_direct``（quick 2026-09-02 影子直聊）：本 run 最近 user_input
      metadata.source=="shadow_direct" 命中——直聊轮标记。投影已统一标记制
      （@轮与直聊轮同款：完整 assistant 文本仅 ``[[GROUP]]`` 标记段投影，见
      extract_group_broadcast_segments）；本标志仅区分轮型供消费方判定
      （互@检测直聊轮早退、@轮无标记兜底行仅对非直聊轮生效）。
    """

    group_id: uuid.UUID
    member_id: uuid.UUID
    member_name: str
    member_session_id: uuid.UUID
    carrier_run_id: uuid.UUID
    shadow_direct: bool = False


async def resolve_group_member_identity(
    db: AsyncSession, *, shadow_session_id: uuid.UUID
) -> tuple[uuid.UUID, uuid.UUID, str] | None:
    """影子会话 → ``(group_id, member_id, member_name)``；非群影子返回 None。

    kind 判定（'group_member' 精确）+ 成员表反向指针（§5.1：群↔影子唯一关联
    通道）。submit_messages 的投影上下文解析与 close_interactive_run 的群
    turn_completed 共用。
    """
    kind = (
        await db.execute(
            select(AgentSession.session_kind).where(AgentSession.id == shadow_session_id)
        )
    ).scalar_one_or_none()
    if kind != "group_member":
        return None
    member = (
        await db.execute(
            select(AgentGroupMember).where(AgentGroupMember.shadow_session_id == shadow_session_id)
        )
    ).scalar_one_or_none()
    if member is None:
        return None
    return member.group_id, member.id, member.display_name


# 群时间线投影过滤（design §5.2「投影范围」）：仅 assistant 文本回复——前端
# classifySessionLog 的 reply 口径服务端复刻（session-log-assembler.ts），thinking /
# tool_use / tool_result / stderr / 系统行 / 任务生命周期行 / override 令箭 / 技能
# 装载行一律不投影（保持群聊干净）。partial 半截行照常投影（segment_id 语义
# 保留），override 到达时按 (载体 run, segment_id) DELETE 撤回——与单聊同机制。
_GROUP_SYSTEM_LINE_RE = re.compile(r"^\[(?:SYSTEM|RESULT)[^\]]*\]")
_GROUP_TASK_LINE_RE = re.compile(r"^\[TASK_(?:STARTED|PROGRESS|NOTIFICATION)\b")
_GROUP_OVERRIDE_LINE_RE = re.compile(r"^\[(?:ASSISTANT_OVERRIDE|THINKING_OVERRIDE)\]\s")
_GROUP_SKILL_LINE_RE = re.compile(r"^\[ASSISTANT\]\s*Base directory for this skill:", re.IGNORECASE)


def is_group_projectable_reply(channel: str | None, content: object) -> bool:
    """日志行是否为可投影进群时间线的 assistant 文本段（reply 口径）。"""
    if channel != "stdout":
        # tool_call（工具 JSON 卡）/ stderr / user_input（注入 prompt）不投影。
        return False
    if not isinstance(content, str):
        return False
    text = content.strip()
    if not text:
        return False
    if "AskUserQuestion" in text:
        return False  # 审批卡片协议行（前端丢弃口径）
    if text.startswith("[TOOL_RESULT] User answered"):
        return False
    if _GROUP_SYSTEM_LINE_RE.match(text) or _GROUP_TASK_LINE_RE.match(text):
        return False
    if _GROUP_OVERRIDE_LINE_RE.match(text):
        return False  # 撤回令箭非正文（stale 信封另行发群频道）
    if text.startswith(("[TOOL_USE]", "[TOOL_RESULT]", "[THINKING]")):
        return False  # 工具回显 / thinking 不进群时间线
    # 技能装载协议载荷（非用户答复）不投影；其余即 assistant 文本段（reply）。
    return _GROUP_SKILL_LINE_RE.match(text) is None


# ── quick 影子直聊（2026-09-02）：[[GROUP]] 选择性转发标记（投影统一标记制）──
# 直聊轮（user_input metadata.source=="shadow_direct"）与群 @ 轮（无 source）
# 投影同款标记制：agent 按 prompt 指引（直聊头 / 群回应要求行）在回复中用
# [[GROUP]]...[[/GROUP]] 包裹要转发的段落——投影层仅抽该段生成投影行（标记
# 剥离只投内容；同轮多段各成一行、保序）。标记原文保留在影子会话 stdout
# 原文（会话内显示完整含标记）；未闭合标记不匹配（不转发半截）。@轮整轮
# 无标记时由 close_interactive_run 补一行兜底行（quick 群 P1 起为回复首段
# 摘要 + 「完整内容见成员会话」，防群里死寂，见
# _emit_group_mention_projection_fallback）。标记词与 daemon/group/service.py
# _SHADOW_DIRECT_HEADER / _GROUP_REPLY_MARKER_REQUIREMENT 中的说明逐字节一致
# （[[GROUP]] / [[/GROUP]]，大小写敏感）。
_GROUP_BROADCAST_MARKER_RE = re.compile(r"\[\[GROUP\]\](.*?)\[\[/GROUP\]\]", re.DOTALL)


def extract_group_broadcast_segments(text: str) -> list[str]:
    """抽 assistant 文本中的 ``[[GROUP]]...[[/GROUP]]`` 转发段（保序、去空白）。"""
    return [m.strip() for m in _GROUP_BROADCAST_MARKER_RE.findall(text) if m.strip()]


# quick 投影统一标记制（2026-09-02）：@轮无标记兜底行——见
# RunSyncService._emit_group_mention_projection_fallback。quick 群 P1（2026-09-02）
# 兜底升级：优先投影本轮回复首段摘要（前 ``GROUP_FALLBACK_SUMMARY_CHARS`` 字），
# 无文本可取时回退本模板行（保底不变）。
GROUP_PROJECTION_FALLBACK_TEMPLATE = "（{member_name} 已在会话内处理，点击成员卡查看）"
# 兜底摘要截断长度（首段前缀）。
GROUP_FALLBACK_SUMMARY_CHARS = 200


async def _resolve_group_bridge_context(
    svc, agent_run: AgentRun | None
) -> _GroupBridgeContext | None:
    """解析影子 run 的群桥接上下文（design §5.2 改动点①，task-05）。

    判定链：run → 影子会话（``session_kind=='group_member'`` 精确判定，单聊/
    worker/quick-chat 零进入）→ 成员表反向指针（群/成员身份 + 快照昵称）→
    本 run 最近一条 user_input 日志 ``metadata_.source_carrier_run_id``
    （task-03 注入时落；排队派发 run 的链 metadata 透传在 task-04 接线）。
    任一环缺失（含排队派发未透传）返回 None，本调用零投影——fail-open：
    消息照常落影子 run，不因桥接缺环阻塞上报。
    """
    if agent_run is None or agent_run.agent_session_id is None:
        return None
    identity = await resolve_group_member_identity(
        svc._session, shadow_session_id=agent_run.agent_session_id
    )
    if identity is None:
        return None
    group_id, member_id, member_name = identity
    turn_meta = (
        (
            await svc._session.execute(
                select(AgentRunLog.metadata_)
                .where(
                    AgentRunLog.run_id == agent_run.id,
                    AgentRunLog.channel == "user_input",
                )
                .order_by(AgentRunLog.timestamp.desc(), AgentRunLog.id.desc())
                .limit(1)
            )
        )
        .scalars()
        .first()
    )
    carrier_raw = turn_meta.get("source_carrier_run_id") if isinstance(turn_meta, dict) else None
    if not isinstance(carrier_raw, str) or not carrier_raw:
        return None
    try:
        carrier_run_id = uuid.UUID(carrier_raw)
    except ValueError:
        _rsvc.log.warning(
            "group_bridge_invalid_carrier_run_id",
            agent_run_id=str(agent_run.id),
            shadow_session_id=str(agent_run.agent_session_id),
        )
        return None
    # quick 影子直聊（2026-09-02）：source=="shadow_direct" 标记直聊轮——
    # 投影已统一标记制（@轮与直聊轮均仅 [[GROUP]] 段投影），本标志供
    # 互@检测（直聊轮早退）与 @轮无标记兜底行（仅非直聊轮）区分轮型。
    shadow_direct = (
        turn_meta.get("source") == "shadow_direct" if isinstance(turn_meta, dict) else False
    )
    return _GroupBridgeContext(
        group_id=group_id,
        member_id=member_id,
        member_name=member_name,
        member_session_id=agent_run.agent_session_id,
        carrier_run_id=carrier_run_id,
        shadow_direct=shadow_direct,
    )


def _build_group_projection_row(
    ctx: _GroupBridgeContext,
    *,
    source_row: AgentRunLog,
    dedup_key: str | None,
    content_override: str | None = None,
    timestamp_override: datetime | None = None,
) -> AgentRunLog:
    """构造群时间线投影行（调用方 add 进同一事务；design §5.2 双写细则）。

    - ``id=新 uuid``：原 log_id 已被影子行占用，复用必 PK 冲突（D-008 Grill P0）；
    - ``run_id=载体 run``：回放走 get_agent_session_logs 按群会话聚合天然覆盖；
    - ``dedup_key`` 复用原值——载体 run 与影子 run 不同 run，(run_id, dedup_key)
      部分唯一索引不冲突；daemon 重试去重仍按影子 run 判定，投影不重复产生；
    - ``segment_id`` 原值透传（partial 半截行语义保留，override 按此列 DELETE）；
    - ``metadata_``：成员身份快照（member_name 按落库时刻，改名不回填）+
      source_log_id（溯源影子行）+ projection 标记（群摘要/回放行源判别，
      §4.2 ``channel='stdout' AND metadata IS NOT NULL`` 同口径）；
    - ``content_override``（quick 投影统一标记制 2026-09-02）：[[GROUP]]
      转发段的投影正文（标记剥离只投内容；影子行原文含标记不受影响；@轮
      与直聊轮同款）。携带时 ``dedup_key`` 必须传 None——同源多段共享
      dedup_key 会撞载体 run 的 (run_id, dedup_key) 部分唯一索引；
    - ``timestamp_override``：多段投影的保序微调（同源多段同 timestamp 下
      时间线排序退化到随机 id——逐段 +1µs 保证段序稳定）。
    """
    return AgentRunLog(
        id=uuid.uuid4(),
        run_id=ctx.carrier_run_id,
        timestamp=timestamp_override if timestamp_override is not None else source_row.timestamp,
        channel="stdout",
        content_redacted=content_override
        if content_override is not None
        else source_row.content_redacted,
        dedup_key=dedup_key,
        segment_id=source_row.segment_id,
        metadata_={
            "member_id": str(ctx.member_id),
            "member_name": ctx.member_name,
            "source_log_id": str(source_row.id),
            "projection": True,
        },
    )


# quick 投影统一标记制（2026-09-02）：@轮无标记兜底行——群 @ 轮改为
# 仅 [[GROUP]] 段投影后，agent 忘记打标记 → 群里整轮死寂（用户不知成员
# 已处理）。收口时补一行简短系统行防死寂（群前端现有渲染显示为普通
# agent 气泡，可接受）。
# quick 群 P1（2026-09-02）兜底升级：模板行 → 回复首段摘要——查影子 run
# 本轮完整 assistant 文本（``is_group_projectable_reply`` 同口径过滤，
# 剥 ``[ASSISTANT]`` 前缀），取首个非空文本段前
# ``GROUP_FALLBACK_SUMMARY_CHARS`` 字投影；无文本可取（整轮纯工具/thinking）
# 回退原模板行（保底不变）。
async def _emit_group_mention_projection_fallback(svc, agent_run: AgentRun) -> None:
    """群 @ 轮收口时的无标记兜底行（quick 投影统一标记制 2026-09-02）。

    判定：本 run 为群 @ 轮（非 shadow_direct——直聊轮群内静默是设计语义，
    不兜底）且载体 run 上**本成员**无任何投影行（[[GROUP]] 段已投影 / 兜底
    已发过均算「有」）→ 补一行 stdout 投影行到载体 run + publish 群频道
    log 事件（log_id=投影行 id，实时与回放读库同 id）。metadata 携带成员
    身份 + ``projection_fallback: True``（前端/回放可辨识兜底行）。幂等：
    兜底行本身带成员身份 metadata，重复收口（终态守卫后不会发生）或并发
    下二次进入时按「已有本成员投影行」跳过。

    兜底内容（quick 群 P1）：影子 run 本轮首个非空 assistant 文本段前
    200 字 + 「…（完整内容见成员会话）」；无文本可取回退模板行。

    独立小事务（close 主 commit 之后追加），fail-open：异常不阻断
    turn_completed / 互@检测 / 排队派发（调用方 try/except 包裹）。
    """
    ctx = await svc._resolve_group_bridge_context(agent_run)
    if ctx is None or ctx.shadow_direct:
        return
    carrier_rows = (
        (
            await svc._session.execute(
                select(AgentRunLog.metadata_).where(
                    AgentRunLog.run_id == ctx.carrier_run_id,
                    AgentRunLog.channel == "stdout",
                )
            )
        )
        .scalars()
        .all()
    )
    for meta in carrier_rows:
        if isinstance(meta, dict) and meta.get("member_id") == str(ctx.member_id):
            return
    now = datetime.now(UTC)
    fallback_id = uuid.uuid4()
    # quick 群 P1 兜底升级：优先投影回复首段摘要；无文本可取回退模板行。
    summary = await svc._build_group_fallback_summary(agent_run)
    if summary is not None:
        fallback_content = f"{summary}…（完整内容见成员会话）"
    else:
        fallback_content = GROUP_PROJECTION_FALLBACK_TEMPLATE.format(member_name=ctx.member_name)
    svc._session.add(
        AgentRunLog(
            id=fallback_id,
            run_id=ctx.carrier_run_id,
            timestamp=now,
            channel="stdout",
            content_redacted=fallback_content,
            dedup_key=None,
            metadata_={
                "member_id": str(ctx.member_id),
                "member_name": ctx.member_name,
                "projection": True,
                "projection_fallback": True,
            },
        )
    )
    await svc._session.commit()
    try:
        redis = _rsvc.get_redis()
        await redis.publish(
            f"agent_session:{ctx.group_id}",
            json.dumps(
                {
                    "event": "log",
                    "session_id": str(ctx.group_id),
                    "run_id": str(agent_run.id),
                    "log_id": str(fallback_id),
                    "channel": "stdout",
                    "content": fallback_content,
                    "timestamp": now.isoformat().replace("+00:00", "Z"),
                    "segment_id": None,
                    "stale": None,
                    # 成员身份（design §6.2 envelope 扩展）——群 UI 据此分色/归属。
                    "member_id": str(ctx.member_id),
                    "member_name": ctx.member_name,
                    "member_session_id": str(ctx.member_session_id),
                },
                default=str,
            ),
        )
    except Exception:
        _rsvc.log.warning(
            "group_projection_fallback_redis_publish_failed",
            agent_run_id=str(agent_run.id),
            group_id=str(ctx.group_id),
        )


async def _build_group_fallback_summary(svc, agent_run: AgentRun) -> str | None:
    """兜底行摘要（quick 群 P1）：影子 run 本轮首个非空 assistant 文本段。

    过滤口径与投影判定同源（``is_group_projectable_reply``——thinking/tool/
    系统行不进摘要），剥 ``[ASSISTANT]`` 前缀后取前
    ``GROUP_FALLBACK_SUMMARY_CHARS`` 字；整轮无可取文本（纯工具/thinking 轮）
    返回 None（调用方回退模板行）。
    """
    rows = (
        await svc._session.execute(
            select(AgentRunLog.channel, AgentRunLog.content_redacted)
            .where(AgentRunLog.run_id == agent_run.id)
            .order_by(AgentRunLog.timestamp, AgentRunLog.id)
        )
    ).all()
    for channel, content in rows:
        if not is_group_projectable_reply(channel, content):
            continue
        text = content.strip()
        if text.startswith("[ASSISTANT]"):
            text = text[len("[ASSISTANT]") :].strip()
        if text:
            return text[:GROUP_FALLBACK_SUMMARY_CHARS]
    return None


async def _close_group_hooks(
    svc, agent_run: AgentRun, *, lease_id: uuid.UUID, now: datetime
) -> None:
    """close_interactive_run 的群收口簇（task-10 自 close 方法体搬移）。

    影子 run 收口 → 群频道 turn_completed + @轮无标记兜底行 + typing
    止息 + 互@检测最小挂接（编排与护栏在 group/service，此处 lazy
    import 避循环依赖，语义与拆分前逐字节一致）。
    """
    # task-05（2026-09-01-session-group-chat / design §5.2 改动点②）：影子 run
    # 收口 → 群频道 turn_completed。现 session 频道事件只有 run_id/session_id，
    # 群 UI 无法判「哪个成员说完了」——本事件补 member_id/member_name/
    # member_session_id（design §6.2 envelope 扩展），status/exit_code/词元字段
    # 照原事件。session_id 用群会话 id（频道自身 id，对齐 group/service
    # _publish_group_channel_event 惯例），影子会话 id 走 member_session_id。
    # 非 group_member 会话（单聊/worker/quick-chat）解析为 None 零行为变化。
    # ── 互@检测挂接点（design §4.4，task-04 接线，本卡不实现）──
    # 本事件发布后，应对该 run 本轮的最终回复文本（载体 run 最新投影行 /
    # AgentRun.output_redacted）执行与用户消息相同的 @解析（群开关
    # agent_cross_mention + Redis 链护栏 group_chain:{载体run_id} 深度/去重/
    # 限频），命中的其他 agent 成员走 §4.1-4.3 触发管线（注入 prompt 的
    # 「当前消息」标注为来自 Agent 成员的协作请求）。
    if agent_run.agent_session_id is not None:
        group_identity = await resolve_group_member_identity(
            svc._session, shadow_session_id=agent_run.agent_session_id
        )
        if group_identity is not None:
            group_id, group_member_id, group_member_name = group_identity
            # quick 投影统一标记制（2026-09-02）：@轮无标记兜底行——completed
            # 的群 @ 轮若载体 run 上无本成员任何投影行（整轮没打 [[GROUP]]
            # 标记），补一行简短系统行防群里死寂（fail-open：异常不阻断
            # turn_completed / 互@检测 / 排队派发）。直聊轮不兜底（群内静默
            # 是直聊的设计语义）。
            if agent_run.status == "completed":
                try:
                    await svc._emit_group_mention_projection_fallback(agent_run)
                except Exception:
                    _rsvc.log.warning(
                        "group_projection_fallback_failed",
                        agent_run_id=str(agent_run.id),
                        group_id=str(group_id),
                        exc_info=True,
                    )
            try:
                redis = _rsvc.get_redis()
                await redis.publish(
                    f"agent_session:{group_id}",
                    json.dumps(
                        {
                            "event": "turn_completed",
                            "session_id": str(group_id),
                            "run_id": str(agent_run.id),
                            "status": agent_run.status,
                            "exit_code": agent_run.exit_code,
                            "input_tokens": agent_run.input_tokens,
                            "output_tokens": agent_run.output_tokens,
                            "timestamp": now.isoformat().replace("+00:00", "Z"),
                            "member_id": str(group_member_id),
                            "member_name": group_member_name,
                            "member_session_id": str(agent_run.agent_session_id),
                        },
                        default=str,
                    ),
                )
            except Exception:
                _rsvc.log.warning(
                    "group_turn_completed_redis_publish_failed",
                    lease_id=str(lease_id),
                    agent_run_id=str(agent_run.id),
                    group_id=str(group_id),
                )
            # 群聊运行态可见 quick（2026-09-02）：终态 typing 止息——run 收口
            # 即冲掉该成员的 typing 指示器（completed/failed/killed 全发：
            # 无论成败，成员都不再「正在输入」；前端 TTL 过期之外的服务端
            # 确定性信号）。延迟 import 同下方互@挂接先例（run_sync ↔ group
            # 循环依赖）；_publish_group_typing_event 自吞 Redis 抖动，外层
            # try 兜 import 级异常——失败仅 warning 不阻断已 commit 的收口。
            try:
                from app.modules.daemon.group.service import (
                    _publish_group_typing_event,
                    _typing_payload,
                )

                await _publish_group_typing_event(
                    group_id,
                    _typing_payload(
                        member_name=group_member_name,
                        member_kind="agent",
                        typing=False,
                        preview=None,
                        member_id=str(group_member_id),
                    ),
                )
            except Exception:
                _rsvc.log.warning(
                    "group_typing_stop_publish_failed",
                    lease_id=str(lease_id),
                    agent_run_id=str(agent_run.id),
                    group_id=str(group_id),
                )
            # task-04（design §4.4）：互@检测——编排与 Redis 护栏全在
            # group/service.py，此处仅最小挂接（completed 轮；fail-open：
            # 异常不阻断已 commit 的 run 终态收口与后续排队派发）。
            if agent_run.status == "completed":
                try:
                    from app.modules.daemon.group.service import (
                        run_cross_mention_detection,
                    )

                    await run_cross_mention_detection(
                        svc._session,
                        group_id=group_id,
                        member_id=group_member_id,
                        member_name=group_member_name,
                        run=agent_run,
                    )
                except Exception:
                    _rsvc.log.warning(
                        "group_cross_mention_detection_failed",
                        agent_run_id=str(agent_run.id),
                        group_id=str(group_id),
                        exc_info=True,
                    )
