"""group 子域 @解析与互@协作检测（task-09 拆分，task-03/04 design §4.1/§4.4）。

@提及解析（``_parse_group_mentions`` 候选提取 + 边界标点匹配 + 广播保留词）、
互@检测编排（``run_cross_mention_detection``：载体 run 投影行聚合 →
detect_cross_mentions → Redis 深度/去重/限频三护栏 → 与用户 @ 同管线触发）
与协作链/限频 Redis key 命名。护栏默认常量在 settings；限频/typing 发布
通知经 typing_presence。

D-007：get_redis（patch 目标）与触发编排末尾构造的 GroupChatService 一律经
``_gsvc.`` 延迟解析。
"""

from __future__ import annotations

import re
import uuid
from collections.abc import Sequence

from redis.asyncio import Redis
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.modules.daemon.group.service as _gsvc
from app.core.errors import AppError
from app.modules.agent.model import (
    AgentGroupChat,
    AgentGroupMember,
    AgentRun,
    AgentRunLog,
)

from .helpers import ROLE_PROMPT_AGENT_DM, SHADOW_DIRECT_SOURCE, GroupMemberTriggerRead
from .settings import (
    GROUP_CHAIN_DEPTH_FIELD,
    GROUP_CHAIN_TTL_SECONDS,
    GROUP_RATE_WINDOW_SECONDS,
    _group_guardrail_settings,
)
from .typing_presence import _publish_agent_typing_event, _publish_rate_limit_notice

# @路由广播保留词（与 task-02 RESERVED_DISPLAY_NAMES 同源；@全体/@all 触发
# 全部 agent 成员）。
BROADCAST_MENTION_WORDS = ("全体", "all")
# 提及候选正则（§4.1：全/半角 @，候选词到空白截断；标点边界见 _mention_match）。
_MENTION_TOKEN_RE = re.compile(r"[@＠](\S+)")
# 提及词边界字符集：候选 token 内昵称后继字符为标点/符号 → 提及在昵称处
# 截断（「@小码，帮我」命中「小码」；「@小码二号」的后继「二」非边界 → 不
# 误命中「小码」）。ASCII + CJK 常用标点/符号（显示名本身可为中英数与空格外
# 任意字符，昵称含空格不支持——display_name 侧建群时 strip，@词天然无空格）。
_MENTION_BOUNDARY_CHARS = frozenset(
    "，。！？；：、·…—～“”‘’（）《》〈〉【】〔〕「」『』,.!?;:()[]{}<>/'\"\\|@#%^&*+=~`$_"
)


def group_chain_key(carrier_run_id: uuid.UUID) -> str:
    """协作链 Redis key（``group_chain:{载体run_id}``，design §4.4）。

    链 id = 触发该协作链的用户消息载体 run id——互@触发沿用原链不新建。
    """
    return f"group_chain:{carrier_run_id}"


def group_rate_key(group_id: uuid.UUID, member_id: uuid.UUID) -> str:
    """成员限频 Redis key（``group_rate:{群id}:{成员id}``，INCR+EXPIRE 滑窗）。"""
    return f"group_rate:{group_id}:{member_id}"


# ── @解析（design §4.1，task-03）────────────────────────────────────────────


def _mention_match(token: str, names: Sequence[str]) -> bool:
    """候选 token 是否命中任一提及词（精确命中，或前缀命中且后继为边界标点）。"""
    for name in names:
        if not name:
            continue
        if token == name:
            return True
        if (
            len(token) > len(name)
            and token.startswith(name)
            and token[len(name)] in _MENTION_BOUNDARY_CHARS
        ):
            return True
    return False


def _parse_group_mentions(
    content: str,
    members: Sequence[AgentGroupMember],
    *,
    split_broadcast: bool = False,
) -> list[AgentGroupMember] | tuple[list[AgentGroupMember], list[AgentGroupMember]]:
    """解析消息中的 @提及（design §4.1 步 4）。

    - 正则 ``[@＠]\\S+`` 提取候选词（到空白截断），再与 agent 成员
      ``display_name`` 精确匹配（边界：标点/符号截断——``@小码，`` 命中
      ``小码``，``@小码二号`` 不误命中 ``小码``）；
    - ``@全体`` / ``@all``（保留词，同边界规则）→ 全部**未移除** agent 成员；
    - 用户成员昵称不触发（仅 agent 成员有独立记忆可触发）；
    - 返回命中成员列表（按 id 去重，保首次命中序；SQLModel 实例不可哈希，
      集合语义以 list 承载）。

    ``split_broadcast=True``（2026-09-10-group-agent-direct-chat task-03，D-003）：
    汇总模式专用两段拆分——返回 ``(explicit_hits, broadcast_expanded)``：
    explicit = 单 @ 命中按**文本出现序**（去重保首序，汇总人选择基准）；
    broadcast = 含 @全体/@all 时按**成员表序**（agent_members 列表序 =
    joined_at 序）展开的全部 agent 成员。两段独立收集互不掺序，调用方
    （发送侧汇总分支）自行做并集去重与汇总人选取。
    """
    agent_members = [m for m in members if m.member_type == "agent" and m.removed_at is None]
    by_name = {m.display_name: m for m in agent_members}
    explicit: dict[uuid.UUID, AgentGroupMember] = {}
    broadcast_hit = False
    merged: dict[uuid.UUID, AgentGroupMember] = {}
    for match in _MENTION_TOKEN_RE.finditer(content):
        token = match.group(1)
        if _mention_match(token, BROADCAST_MENTION_WORDS):
            broadcast_hit = True
            for member in agent_members:
                merged.setdefault(member.id, member)
            continue
        for name in by_name:
            if _mention_match(token, (name,)):
                member = by_name[name]
                explicit.setdefault(member.id, member)
                merged.setdefault(member.id, member)
    if split_broadcast:
        broadcast_expanded = list(agent_members) if broadcast_hit else []
        return list(explicit.values()), broadcast_expanded
    return list(merged.values())


def _has_broadcast_mention(content: str) -> bool:
    """消息是否含 @全体/@all（响应体 mention_all 标记用）。"""
    return any(
        _mention_match(match.group(1), BROADCAST_MENTION_WORDS)
        for match in _MENTION_TOKEN_RE.finditer(content)
    )


# ── 互@协作检测与 Redis 护栏（task-04，design §4.4）──────────────────────────


def detect_cross_mentions(
    reply_text: str,
    members: Sequence[AgentGroupMember],
    *,
    source_member_id: uuid.UUID,
) -> list[AgentGroupMember]:
    """解析 agent 回复最终文本中的 @提及（纯函数，design §4.4）。

    复用用户消息同款 ``_parse_group_mentions``；差异仅两处——

    - **不自我触发**：命中来源成员自身（回复 @自己）一律忽略；
    - 用户成员昵称照旧不触发（与用户 @ 同口径，仅 agent 成员可被触发）。
    """
    parsed = _parse_group_mentions(reply_text, members)
    # 真实集成修正（2026-09-12 verify mypy 硬门）：split_broadcast 未启用时返回 list 分支，
    # 联合类型显式收窄（运行时恒真），否则推导式类型不符。
    assert not isinstance(parsed, tuple)
    return [m for m in parsed if m.id != source_member_id]


async def _load_run_reply_text(
    db: AsyncSession,
    *,
    carrier_run_id: uuid.UUID,
    member_id: uuid.UUID,
) -> str:
    """聚合载体 run 上**该成员**的投影行 = 其本轮在群内的最终回复文本。

    行源（design §5.2 投影范围）：task-05 桥接在影子 run 落库时同事务双写到
    载体 run 的 ``channel='stdout'`` 且带成员身份 metadata 的行——**只有真正
    进群时间线的 assistant 文本段**（thinking/tool/stderr 已被投影过滤），互@
    检测口径与用户看到的一致。partial 半截行按时间序拼接。

    按 ``metadata_.member_id`` 过滤：同一条用户消息 @ 多成员时多个成员的投影
    行落在同一载体 run 上——检测只解析**本轮收口成员**的回复，不混入他人。
    """
    rows = (
        await db.execute(
            select(AgentRunLog.content_redacted, AgentRunLog.metadata_)
            .where(
                AgentRunLog.run_id == carrier_run_id,
                AgentRunLog.channel == "stdout",
                AgentRunLog.metadata_.is_not(None),
            )
            .order_by(AgentRunLog.timestamp, AgentRunLog.id)
        )
    ).all()
    parts: list[str] = []
    for content, meta in rows:
        if not isinstance(meta, dict) or meta.get("member_id") != str(member_id):
            continue
        text = (content or "").strip()
        if text:
            parts.append(text)
    return "\n".join(parts)


async def _load_shadow_reply_text(db: AsyncSession, *, run_id: uuid.UUID) -> str:
    """聚合影子 run 本轮自身 assistant 文本（私聊轮互@检测源，D-005）。

    私聊轮（汇总协作/成员私聊）被投影层硬拦截（D-007）——载体 run 无投影
    行，互@检测改读影子 run 全量行：``is_group_projectable_reply`` 同口径
    过滤（thinking/tool/stderr 不进检测）+ 剥 ``[ASSISTANT]`` 前缀，全段
    拼接（口径照 ``_build_group_fallback_summary``，不截断——检测需完整文本
    才能 @ 后缀成员）。
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
    return "\n".join(parts)


async def _register_chain_members(
    redis: Redis,
    carrier_run_id: uuid.UUID,
    member_ids: Sequence[uuid.UUID],
    *,
    ttl_seconds: int = GROUP_CHAIN_TTL_SECONDS,
) -> None:
    """用户 @ 直接触发的成员入链登记（链去重集 + TTL，深度仍 0）。

    链语义（design §4.4）：链 id=触发该协作的用户消息载体 run id，用户 @ 触发
    的成员即链内首批成员（chain_depth=0 轮）；后续互@命中同链成员即跳过。
    ``ttl_seconds`` quick 群 P1（2026-09-02）群级可配（默认模块常量）——与
    互@侧 TTL 刷新同一取值源（``_group_guardrail_settings``），避免登记用默认
    30min、互@刷新才对齐群配置的窗口错位。best-effort：Redis 抖动仅 warning
    不阻断消息发送主链路。
    """
    try:
        key = group_chain_key(carrier_run_id)
        for member_id in member_ids:
            # redis-py 7.x stubs 对部分命令返回 Awaitable|T union（运行时恒为
            # coroutine），逐调用精确 ignore misc。
            # 直接触发仅占位计数 0（ql-20260902 讨论场景修复：用户 @ 的成员是
            # "链内首批"，不占互@去重名额——否则"你们俩讨论下"这类同时 @ 多人
            # 的消息会让后续互@全被去重、讨论一轮即断）。
            await redis.hsetnx(key, str(member_id), "0")  # type: ignore[misc]
        await redis.expire(key, ttl_seconds)
    except Exception:
        _gsvc.log.warning(
            "group_chain_register_failed",
            carrier_run_id=str(carrier_run_id),
            exc_info=True,
        )


async def run_cross_mention_detection(
    db: AsyncSession,
    *,
    group_id: uuid.UUID,
    member_id: uuid.UUID,
    member_name: str,
    run: AgentRun,
) -> list[GroupMemberTriggerRead]:
    """turn_completed 后的互@检测编排（design §4.4，task-04 挂接 run_sync 收口）。

    判定链（任一环不命中即零触发，@作纯文本）：

    1. 群开关 ``agent_cross_mention``（默认开；关闭=严格 openclaw 模式）+ 群未
       解散；
    2. 链上下文：本 run 最近一条 user_input 日志 metadata（task-03 注入 /
       task-04 排队透传写入的 ``source_carrier_run_id``/``chain_depth``）——
       缺失（非群链路轮）零触发；
    3. 回复文本 = 载体 run 投影行聚合（``_load_run_reply_text``）；
    4. ``detect_cross_mentions`` 纯解析（不自我 + 仅 agent 成员）；
    5. Redis 护栏（全带 TTL）：深度达 ``cross_mention_depth`` 跳过 → 同链同
       成员 HSETNX 去重跳过 → 限频 INCR 超限跳过 + 群内系统提示；
    6. 命中成员走 ``_trigger_group_member`` 同管线（注入 prompt 当前消息标注
       为来自 Agent 成员的协作请求；链沿用原链、深度 +1）。

    fail-open 边界：Redis 不可用时**跳过全部互@触发**（fail-closed 防环优先
    ——护栏状态只存 Redis，Redis 缺席时无从判深/去重，放行即可能无限互@）；
    单成员触发失败（机器离线 400 等）记 warning 继续其余成员，不阻断 run 收口。
    """
    group = await db.get(AgentGroupChat, group_id)
    if group is None or group.ended_at is not None or not group.agent_cross_mention:
        return []

    # ── 链上下文（与 run_sync._resolve_group_bridge_context 同源读取）─────────
    turn_meta = (
        (
            await db.execute(
                select(AgentRunLog.metadata_)
                .where(
                    AgentRunLog.run_id == run.id,
                    AgentRunLog.channel == "user_input",
                )
                .order_by(AgentRunLog.timestamp.desc(), AgentRunLog.id.desc())
                .limit(1)
            )
        )
        .scalars()
        .first()
    )
    if not isinstance(turn_meta, dict):
        return []
    # quick 影子直聊（2026-09-02）：直聊轮不参与互@协作——直聊内容默认不进群，
    # [[GROUP]] 转发段虽落群时间线，但独立会话不应自动触发其他成员（保持直聊
    # 私密 + 零自动化副作用）。
    if turn_meta.get("source") == SHADOW_DIRECT_SOURCE:
        return []
    # 2026-09-10-group-agent-direct-chat（D-005）：converge 收口轮不开新互@
    # （收口阶段再开讨论链会破坏收口时序；其余轮型照旧/私聊轮可用）。
    if turn_meta.get("consensus_role") == "converge":
        return []
    carrier_raw = turn_meta.get("source_carrier_run_id")
    if not isinstance(carrier_raw, str) or not carrier_raw:
        return []
    try:
        carrier_run_id = uuid.UUID(carrier_raw)
    except ValueError:
        _gsvc.log.warning(
            "group_cross_mention_invalid_carrier",
            group_id=str(group_id),
            run_id=str(run.id),
        )
        return []

    # 2026-09-10-group-agent-direct-chat（D-005/D-007）：轮型分源——私聊轮
    # （汇总协作/成员互私聊，dm_target 非空）被投影层硬拦截，载体 run 无投影
    # 行，互@检测改读影子 run 自身文本；普通 @轮照旧读载体 run 投影行。
    # 源轮 consensus 上下文透传（见下方 turn_overrides）：collaborator 发起的
    # 分歧讨论回复仍属意见链（终轮由收口钩子全量聚合）。且互@默认改私聊：
    # 被@成员的回复注入发起方会话不进群（D-005）。
    turn_dm_target = turn_meta.get("dm_target_member_id")
    turn_consensus_task = turn_meta.get("consensus_task_id")
    if isinstance(turn_dm_target, str) and turn_dm_target:
        reply_text = await _load_shadow_reply_text(db, run_id=run.id)
    else:
        reply_text = await _load_run_reply_text(
            db, carrier_run_id=carrier_run_id, member_id=member_id
        )
    if not reply_text:
        return []

    members = (
        (
            await db.execute(
                select(AgentGroupMember)
                .where(
                    AgentGroupMember.group_id == group.id,
                    AgentGroupMember.removed_at.is_(None),
                )
                .order_by(AgentGroupMember.joined_at, AgentGroupMember.id)
            )
        )
        .scalars()
        .all()
    )
    hits = detect_cross_mentions(reply_text, list(members), source_member_id=member_id)
    if not hits:
        return []

    try:
        redis = _gsvc.get_redis()
        await redis.ping()  # type: ignore[misc]  # redis-py stubs union 返回
    except Exception:
        # fail-closed：Redis 缺席不判护栏 → 全部跳过（防无限互@），仅记日志。
        _gsvc.log.warning(
            "group_cross_mention_redis_unavailable",
            group_id=str(group.id),
            run_id=str(run.id),
        )
        return []

    chain_key = group_chain_key(carrier_run_id)
    member_lines = [
        f"{m.display_name}({'用户' if m.member_type == 'user' else 'Agent'})" for m in members
    ]
    depth_limit = max(int(group.cross_mention_depth or 0), 0)
    # quick 群 P1（2026-09-02）护栏参数群级可配：settings_json.guardrails 覆盖，
    # 缺省回落模块常量（默认 6/2/1800——存量群零行为变化）。
    rate_limit_per_minute, member_trigger_limit, chain_ttl_seconds = _group_guardrail_settings(
        group
    )
    # 双轨一致（design §4.4）：DB run metadata 的 chain_depth 与 Redis depth 互为
    # 校验——取 max 为判定基线（链 TTL 30min 过期后 DB 侧深度仍是防环下限，
    # 不会因 Redis 清键而复活长链）。
    metadata_depth = turn_meta.get("chain_depth")
    try:
        metadata_depth_int = int(metadata_depth) if metadata_depth is not None else 0
    except (TypeError, ValueError):
        metadata_depth_int = 0
    triggered: list[GroupMemberTriggerRead] = []
    for target in hits:
        # ── 护栏 1：深度到顶（≥cross_mention_depth 不再触发，@作纯文本）─────
        depth_raw = await redis.hget(chain_key, GROUP_CHAIN_DEPTH_FIELD)  # type: ignore[misc]
        redis_depth = int(depth_raw) if depth_raw else 0
        base_depth = max(redis_depth, metadata_depth_int)
        if base_depth >= depth_limit:
            _gsvc.log.info(
                "group_cross_mention_depth_capped",
                group_id=str(group.id),
                carrier_run_id=str(carrier_run_id),
                depth=base_depth,
                target_member_id=str(target.id),
            )
            continue
        # ── 护栏 3（先于去重：超限跳过不烧链内名额）：限频滑窗 ─────────────────
        rate_key = group_rate_key(group.id, target.id)
        rate_count = int(await redis.incr(rate_key))
        # quick 群 P1（2026-09-02 限频原子化）：incr 后**无条件** expire——原先
        # 只在 count==1 时 expire，进程恰在 incr 与 expire 间崩溃会留下无 TTL
        # 的永久计数键（计数只增不清，该成员后续窗口全部误判超限）。代价是
        # 窗口锚点随每次触发后移（滑窗化）：持续互@风暴下锁止更保守，对
        # 防环护栏语义可接受；多一次 expire 调用换崩溃窗口闭合，最简可靠。
        await redis.expire(rate_key, GROUP_RATE_WINDOW_SECONDS)
        if rate_count > rate_limit_per_minute:
            await _publish_rate_limit_notice(group, target.display_name)
            _gsvc.log.info(
                "group_cross_mention_rate_limited",
                group_id=str(group.id),
                target_member_id=str(target.id),
                count=rate_count,
            )
            continue
        # ── 护栏 2：同链同成员互@次数上限（HINCRBY 计数，超上限跳过）────────
        # ql-20260902 讨论场景修复：直接触发占位 0 不占名额，互@每次 +1；
        # 同一成员最多被互@触发 member_trigger_limit 次（群级可配，默认
        # GROUP_CROSS_MEMBER_TRIGGER_LIMIT）。
        member_triggers = int(await redis.hincrby(chain_key, str(target.id), 1))  # type: ignore[misc]
        if member_triggers > member_trigger_limit:
            _gsvc.log.info(
                "group_cross_mention_member_capped",
                group_id=str(group.id),
                carrier_run_id=str(carrier_run_id),
                target_member_id=str(target.id),
                triggers=member_triggers,
            )
            continue
        # 深度 +1（本次互@跳数；DB 侧领先时先对齐再计数）并刷新链 TTL。
        if redis_depth < base_depth:
            await redis.hset(chain_key, GROUP_CHAIN_DEPTH_FIELD, str(base_depth))  # type: ignore[misc]
        new_depth = int(await redis.hincrby(chain_key, GROUP_CHAIN_DEPTH_FIELD, 1))  # type: ignore[misc]
        await redis.expire(chain_key, chain_ttl_seconds)

        # ── 与用户 @ 同管线触发（链沿用原链，链 id 不新建）────────────────────
        # 2026-09-10-group-agent-direct-chat（D-005）：互@默认改私聊——
        # role_prompt 私聊指令 + turn_overrides 带 dm_target（回复注入发起方
        # 会话不进群，D-007 投影谓词拦截）；源轮带 consensus 上下文时新轮
        # 同任务意见链（collaborator，意见终由收口钩子全量聚合）。
        dm_overrides: dict = {
            "dm_target_member_id": str(member_id),
            "dm_kind": (
                "consensus"
                if isinstance(turn_consensus_task, str) and turn_consensus_task
                else "agent_dm"
            ),
        }
        if isinstance(turn_consensus_task, str) and turn_consensus_task:
            dm_overrides["consensus_task_id"] = turn_consensus_task
            dm_overrides["consensus_role"] = "collaborator"
        try:
            trigger = await _gsvc.GroupChatService(db)._trigger_group_member(
                group=group,
                member=target,
                members=list(members),
                member_lines=member_lines,
                sender_user_id=group.created_by,  # 服务身份=群主（§9.2 计量归属）
                sender_member_name=member_name,
                content=reply_text,
                carrier_run_id=carrier_run_id,
                exclude_log_id=None,
                source_member_name=member_name,
                chain_depth=new_depth,
                role_prompt=ROLE_PROMPT_AGENT_DM.format(sender_name=member_name),
                turn_overrides=dm_overrides,
            )
        except AppError as exc:
            _gsvc.log.warning(
                "group_cross_mention_trigger_failed",
                group_id=str(group.id),
                target_member_id=str(target.id),
                code=exc.code,
            )
            continue
        triggered.append(trigger)
        if not trigger.queued:
            # 运行态可见 quick（2026-09-02）：补 member_id；reply_to_log_id 不传
            # ——互@触发源是 agent 投影行（非 user_input 行），无「正在响应的用户
            # 消息」锚点（排队轮照旧不发 typing）。
            await _publish_agent_typing_event(
                group.id,
                target.display_name,
                member_id=str(target.id),
            )
    return triggered
