"""群聊管理服务（2026-09-01-session-group-chat task-02/03/04/06，design §3/§4/§5/§6.1/§8）。

群 CRUD / 成员管理 / 参与者制权限（``_require_group_member`` 两段式：群成员表
命中 → workspace admin → 404 统一 AppError 不泄露存在性，照
``file_artifacts._check_session_permission`` 先例）。task-03 落群消息与 @触发
管线（design §4.1-4.3）：

- 建群 = 群时间线会话 ``AgentSession(kind='group', status='active')``（无
  lease，design §8 group.created）+ ``AgentGroupChat`` 聚合根行 + 初始成员
  （建群者自身也落用户成员行——§5.3 参与者制的成员判定覆盖群主）；
- ``AgentGroupChat.id == AgentGroupChat.session_id == 群会话 id``（design
  §3.2「id 即群会话的 session_id」不变式；端点 ``/group-chats/{id}`` 的 ``id``
  即群会话 id，群 SSE 复用现有 ``/sessions/{id}/stream`` 天然同 id）；
- 解散 / 移除 agent 成员：对 ``shadow_session_id`` 非空成员走既有会话 end 链
  （服务身份=群主 user_id）+ 影子队列 pending 行删除（design §8
  group.member.removed「防终态后静默丢弃」）；
- 群消息（task-03，§4.1）：载体 run（``status='completed'`` + ``started_at``
  + ``spec_strategy='group_carrier'``）+ ``user_input`` 原文落库 + 群频道
  ``log`` 事件（sender 身份字段，payload 形态照 run_sync session channel log
  事件扩展）→ ``_parse_group_mentions`` @解析 → 命中 agent 成员触发；
- 影子懒建（task-03，§4.3）：成员首次被触发时照 worker 三件套（``_dispatch_
  worker_core`` 先例）——直接 ORM 建行（不走 create_session，审批开关生效位
  在 ``AgentSession.config`` 列）+ ``prepare_interactive_dispatch``（pinned
  runtime + grants 授权分支 ``skip_owner_check=False``，**不照抄 worker 的
  豁免**——群成员机器是群主任意选择的，必须走授权校验，design D-010）+ 回填
  成员表 ``shadow_session_id``/``shadow_status='active'``；``parent_session_id``
  恒 NULL（D-007，§5.1 硬约束：影子挂 parent 会被 5 处 worker 判定链路误杀）；
- 注入（§4.3）：首轮 = 成员简报 + 群背景摘要（§4.2）+ 当前消息，经 lease
  metadata prompt + SESSION_INJECT 控制指令下发（照 create_session 尾段）；
  复用轮走 ``inject_session_as_service``（忙轮排队 queue_when_busy——排队
  快照按入队时刻冻结，design §9.7）；run 挂群主 user_id（§9.2 计量归属），
  群链路 metadata（source_group_id/source_member_id/source_carrier_run_id/
  chain_depth/sender_user_id）写本轮 user_input 日志 ``metadata_`` 列（task-04
  互@检测读取）。

权限模型（design §5.3，单聊 kind='chat' 零改动铁律）：

- 任意用户成员：读群（列表/详情/消息/SSE）+ 发消息（§6.1）；
- 群主（+workspace admin）：改设置 / 加删成员 / 解散（§6.1 权限表）；
- 非成员（含普通 workspace 成员）：一律 404，不泄露群存在性。

跨模块权限分支的共享入口：``get_group_accessible_session`` 供
daemon/session/service.py 四处改造点与 daemon/router.py SSE 内联校验懒加载
复用（chat 形态返回 None → 调用方保持原属主路径逐字节不变）。

task-06（design §5.4 实时通道，纯 ephemeral 纪律——不落库不进 AI 上下文不进
群背景摘要）：

- typing：``publish_typing``（端点 ``POST /{id}/typing`` 体）与 agent typing
  自动事件（``_publish_agent_typing_event``，影子 run 开始时发）都 publish 到
  ``group_typing:{group_id}`` 频道——Redis pub/sub 即发即忘，无 key 无存储；
  群 SSE 生成器双订阅本频道合流（订阅侧在 agent/service.py）；
- presence：``group_presence_key`` 单源命名 + ``get_online_member_ids`` 读
  ``group_presence:{gid}:*`` 活跃集（群列表/详情 online_member_ids 消费）；
  touch（SET EX 60 续期）挂在 SSE 生成器循环（agent/service.py，间隔 45s）；
- audience：群操作（建/改/解散/成员变更）经 ``_publish_group_sessions_changed``
  广播 ``agent_sessions:changed``，payload 内嵌全部未移除用户成员 id
  （``audience_user_ids``），订阅侧过滤免每事件查库。

@全体并行触发说明：design §4.1 写「并行」，但单请求 AsyncSession 不可并发
使用（SQLAlchemy asyncio 约束；成员触发全程复用请求 session 的行锁/事务），
本实现按成员序（joined_at）顺序触发——成员间无共享可变状态（各自独立影子
会话），顺序执行语义等价；真并行需按 ``dispatch_next_queued_message`` 的
独立 session 工厂模式重构，留待出现实际吞吐需求时再做。

task-04（design §4.4 互@协作 / §4.5 配置热切换 / §8 member.config.switched）：

- 互@检测（``run_cross_mention_detection``）：run_sync ``close_interactive_run``
  群 turn_completed 后挂接（该文件不在本卡 allowed_paths——挂接为最小连带
  调用，编排/护栏全在本模块）。读群开关 ``agent_cross_mention`` → 载体 run
  投影行聚合为本轮最终回复文本 → ``detect_cross_mentions`` 复用 @解析（不
  自我 + 仅 agent 成员）→ 命中成员走与用户 @ 相同的 ``_trigger_group_member``
  管线（注入 prompt 当前消息标注「来自 Agent 成员的协作请求」）；
- Redis 防环护栏（全带 TTL 自清理，不建表）：``group_chain:{载体run_id}``
  Hash=链内成员去重集 + ``depth`` 计数（TTL 30min，触发即刷新；用户 @ 直
  触发成员入链深度 0，互@触发沿用原链深度 +1）；``group_rate:{群id}:{成员id}``
  INCR+EXPIRE 60s 滑窗限频（每分钟 6 次，超限群频道系统提示行）。Redis 不可
  用时互@侧 fail-closed（跳过全部触发防环），用户 @ 主链路不受影响；
- 热切换（``update_member`` 六要素 diff）：模型组（provider/llm_provider/
  agent_profile）→ 影子三列同步 + ``inject_session_as_service`` 空 prompt
  静默切换轮（SESSION_SWITCH_CONFIG 下轮边界生效，SDK resume id 不变记忆
  延续）；机器组（runtime/workspace）→ end 影子 + ``pending`` + 指针置空
  （下次触发懒重建，记忆重置）。
"""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from pydantic import BaseModel, Field
from redis.asyncio import Redis
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.modules.agent.model import (
    AgentGroupChat,
    AgentGroupMember,
    AgentRun,
    AgentRunLog,
    AgentSession,
    AgentSessionQueuedMessage,
)
from app.modules.agent.schema import (
    GroupChatCreate,
    GroupChatRead,
    GroupChatUpdate,
    GroupMemberCreate,
    GroupMemberRead,
    GroupMemberUpdate,
)
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import has_permission
from app.modules.daemon.model import DaemonInstance, DaemonRuntime
from app.modules.daemon.session.service import SessionService
from app.modules.daemon.session_events import SessionChangeEvent, publish_sessions_changed

log = get_logger(__name__)

# ── 护栏常量（design §9.3：首版保守值，execute 后按实测调）──────────────────
# 每群 agent 成员上限（会话闸共享同一机器，防群内扇出打满 SILLYHUB_MAX_
# ACTIVE_SESSIONS）。
GROUP_AGENT_MEMBER_LIMIT = 8
# 每群用户成员上限（同时防 agent_sessions:changed audience payload 膨胀，
# task-06 消费）。
GROUP_USER_MEMBER_LIMIT = 50
# @路由保留词（design §4.1：@全体/@all 广播触发词，成员昵称不可占用——
# 否则 @解析对「是成员还是广播」产生歧义）。
RESERVED_DISPLAY_NAMES = {"全体", "all"}

# 群会话 provider 占位值（AgentSession.provider NOT NULL；群时间线会话自身
# 不派发 daemon，仅作载体标记——影子会话才落成员真实 provider，task-03）。
GROUP_SESSION_PROVIDER = "group"

# ── 群消息与 @触发管线常量（task-03，design §4.1-4.3）────────────────────────

# 载体 run 的 spec_strategy 标记（§2：纯载体，无执行语义——区分影子轮的
# 'interactive' 与批量派发策略）。
GROUP_CARRIER_SPEC_STRATEGY = "group_carrier"
# 影子会话 interactive lease 的 stage（§4.3：prepare_interactive_dispatch
# stage 形参 → lease metadata.stage → claim payload → daemon 谓词）。
GROUP_MEMBER_STAGE = "group_member"
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
# 群背景摘要单条截断 / 总长上限（design §4.2）。
GROUP_CONTEXT_ENTRY_MAX_CHARS = 500
GROUP_CONTEXT_TOTAL_MAX_CHARS = 6000
# 群列表最后消息摘要长度（task-03 接通 task-02 占位字段）。
GROUP_LAST_MESSAGE_PREVIEW_CHARS = 60

# ── 互@协作护栏常量（task-04，design §4.4——状态只存 Redis 带 TTL，不建表）──
# 协作链 Hash TTL（30min：链跨多轮互@，超时自清理不留死键）。
GROUP_CHAIN_TTL_SECONDS = 30 * 60
# 限频滑动窗口（60s）与窗口内被触发上限（design §9.3 首版保守值 6）。
GROUP_RATE_WINDOW_SECONDS = 60
GROUP_RATE_LIMIT_PER_MINUTE = 6
# 链 Hash 内深度计数字段名（其余 field=成员 id → 1，链内已触发成员去重集）。
GROUP_CHAIN_DEPTH_FIELD = "depth"


def group_chain_key(carrier_run_id: uuid.UUID) -> str:
    """协作链 Redis key（``group_chain:{载体run_id}``，design §4.4）。

    链 id = 触发该协作链的用户消息载体 run id——互@触发沿用原链不新建。
    """
    return f"group_chain:{carrier_run_id}"


def group_rate_key(group_id: uuid.UUID, member_id: uuid.UUID) -> str:
    """成员限频 Redis key（``group_rate:{群id}:{成员id}``，INCR+EXPIRE 滑窗）。"""
    return f"group_rate:{group_id}:{member_id}"


# ── 错误族（AppError 惯例：中文用户可见文案，UUID 进 details）────────────────


class GroupChatNotFound(AppError):
    """群不存在或无权访问（404 统一不泄露存在性，design §5.3 / constraints）。"""

    code = "HTTP_404_GROUP_CHAT_NOT_FOUND"
    http_status = 404


class GroupChatMemberNotFound(AppError):
    """群成员行不存在（或已移除/跨群，404 不泄露）。"""

    code = "HTTP_404_GROUP_MEMBER_NOT_FOUND"
    http_status = 404


class GroupChatForbidden(AppError):
    """群主专属操作越权（成员可见群但非群主且非 workspace admin → 403）。

    与 404 的分工：请求者已是群成员（群存在性对其已知），改设置/加删成员/
    解散的越权用 403 明确「看得到但动不了」；非成员一律 404。
    """

    code = "HTTP_403_GROUP_CHAT_FORBIDDEN"
    http_status = 403


class GroupChatInvalid(AppError):
    """群管理写操作校验失败（上限超出/昵称重复/引用不存在等，400）。"""

    code = "HTTP_400_GROUP_CHAT_INVALID"
    http_status = 400


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
    content: str, members: Sequence[AgentGroupMember]
) -> list[AgentGroupMember]:
    """解析消息中的 @提及（design §4.1 步 4）。

    - 正则 ``[@＠]\\S+`` 提取候选词（到空白截断），再与 agent 成员
      ``display_name`` 精确匹配（边界：标点/符号截断——``@小码，`` 命中
      ``小码``，``@小码二号`` 不误命中 ``小码``）；
    - ``@全体`` / ``@all``（保留词，同边界规则）→ 全部**未移除** agent 成员；
    - 用户成员昵称不触发（仅 agent 成员有独立记忆可触发）；
    - 返回命中成员列表（按 id 去重，保首次命中序；SQLModel 实例不可哈希，
      集合语义以 list 承载）。
    """
    agent_members = [m for m in members if m.member_type == "agent" and m.removed_at is None]
    by_name = {m.display_name: m for m in agent_members}
    hits: dict[uuid.UUID, AgentGroupMember] = {}
    for match in _MENTION_TOKEN_RE.finditer(content):
        token = match.group(1)
        if _mention_match(token, BROADCAST_MENTION_WORDS):
            for member in agent_members:
                hits.setdefault(member.id, member)
            continue
        for name in by_name:
            if _mention_match(token, (name,)):
                member = by_name[name]
                hits.setdefault(member.id, member)
    return list(hits.values())


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
    return [m for m in _parse_group_mentions(reply_text, members) if m.id != source_member_id]


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


async def _register_chain_members(
    redis: Redis, carrier_run_id: uuid.UUID, member_ids: Sequence[uuid.UUID]
) -> None:
    """用户 @ 直接触发的成员入链登记（链去重集 + TTL，深度仍 0）。

    链语义（design §4.4）：链 id=触发该协作的用户消息载体 run id，用户 @ 触发
    的成员即链内首批成员（chain_depth=0 轮）；后续互@命中同链成员即跳过。
    best-effort：Redis 抖动仅 warning 不阻断消息发送主链路。
    """
    try:
        key = group_chain_key(carrier_run_id)
        for member_id in member_ids:
            # redis-py 7.x stubs 对部分命令返回 Awaitable|T union（运行时恒为
            # coroutine），逐调用精确 ignore misc。
            await redis.hsetnx(key, str(member_id), "1")  # type: ignore[misc]
        await redis.expire(key, GROUP_CHAIN_TTL_SECONDS)
    except Exception:
        log.warning(
            "group_chain_register_failed",
            carrier_run_id=str(carrier_run_id),
            exc_info=True,
        )


async def _publish_rate_limit_notice(group: AgentGroupChat, member_name: str) -> None:
    """限频超限群内系统提示（design §4.4：群频道系统提示行）。

    复用群频道 ``log`` 事件形态（``channel='system'`` 与用户/投影行区分），
    publish 容错语义同 ``_publish_group_channel_event``（Redis 抖动仅 warning）。
    """
    await _publish_group_channel_event(
        group.session_id,
        {
            "event": "log",
            "session_id": str(group.session_id),
            "channel": "system",
            "content": f"「{member_name}」触发频率已达上限，请稍候再 @。",
            "timestamp": datetime.now(UTC).isoformat(),
        },
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
    carrier_raw = turn_meta.get("source_carrier_run_id")
    if not isinstance(carrier_raw, str) or not carrier_raw:
        return []
    try:
        carrier_run_id = uuid.UUID(carrier_raw)
    except ValueError:
        log.warning(
            "group_cross_mention_invalid_carrier",
            group_id=str(group_id),
            run_id=str(run.id),
        )
        return []

    reply_text = await _load_run_reply_text(db, carrier_run_id=carrier_run_id, member_id=member_id)
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
        redis = get_redis()
        await redis.ping()  # type: ignore[misc]  # redis-py stubs union 返回
    except Exception:
        # fail-closed：Redis 缺席不判护栏 → 全部跳过（防无限互@），仅记日志。
        log.warning(
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
            log.info(
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
        if rate_count == 1:
            await redis.expire(rate_key, GROUP_RATE_WINDOW_SECONDS)
        if rate_count > GROUP_RATE_LIMIT_PER_MINUTE:
            await _publish_rate_limit_notice(group, target.display_name)
            log.info(
                "group_cross_mention_rate_limited",
                group_id=str(group.id),
                target_member_id=str(target.id),
                count=rate_count,
            )
            continue
        # ── 护栏 2：同链同成员去重（HSETNX=0 即已触发过）─────────────────────
        added = await redis.hsetnx(chain_key, str(target.id), "1")  # type: ignore[misc]
        if not added:
            continue
        # 深度 +1（本次互@跳数；DB 侧领先时先对齐再计数）并刷新链 TTL。
        if redis_depth < base_depth:
            await redis.hset(chain_key, GROUP_CHAIN_DEPTH_FIELD, str(base_depth))  # type: ignore[misc]
        new_depth = int(await redis.hincrby(chain_key, GROUP_CHAIN_DEPTH_FIELD, 1))  # type: ignore[misc]
        await redis.expire(chain_key, GROUP_CHAIN_TTL_SECONDS)

        # ── 与用户 @ 同管线触发（链沿用原链，链 id 不新建）────────────────────
        try:
            trigger = await GroupChatService(db)._trigger_group_member(
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
            )
        except AppError as exc:
            log.warning(
                "group_cross_mention_trigger_failed",
                group_id=str(group.id),
                target_member_id=str(target.id),
                code=exc.code,
            )
            continue
        triggered.append(trigger)
        if not trigger.queued:
            await _publish_agent_typing_event(group.id, target.display_name)
    return triggered


# ── 群背景摘要（design §4.2，task-03）───────────────────────────────────────


async def _load_group_context_lines(
    db: AsyncSession,
    *,
    group_session_id: uuid.UUID,
    context_window: int,
    members: Sequence[AgentGroupMember],
    exclude_log_id: uuid.UUID | None = None,
) -> list[str]:
    """查群时间线最近 ``context_window`` 条并组装摘要行（时间正序返回）。

    行源（§4.2）：``user_input`` 行（用户消息）+ 投影行（``channel='stdout'``
    且 ``metadata`` 含成员身份——task-05 桥接投影双写，本查询先兼容）。

    - 身份标签：用户行 = 发送者昵称（``metadata_.sender_member_name`` 优先，
      回退 ``run.user_id`` 查成员表）+ ``(用户)``；投影行 =
      ``metadata_.member_name`` + ``(Agent)``；
    - 单条截断 500 字、总长上限 6000 字符（超限**丢最旧**保最新）；
    - ``exclude_log_id``：当前消息行排除（它进「当前消息」段，不重复出现在
      背景里）。
    """
    from sqlalchemy import and_

    stmt = (
        select(AgentRunLog, AgentRun.user_id)
        .join(AgentRun, AgentRunLog.run_id == AgentRun.id)
        .where(
            AgentRun.agent_session_id == group_session_id,
            or_(
                AgentRunLog.channel == "user_input",
                and_(
                    AgentRunLog.channel == "stdout",
                    AgentRunLog.metadata_.is_not(None),
                ),
            ),
        )
        .order_by(AgentRunLog.timestamp.desc(), AgentRunLog.id.desc())
        .limit(max(context_window, 1))
    )
    rows = (await db.execute(stmt)).all()

    user_members_by_user: dict[uuid.UUID, AgentGroupMember] = {
        m.user_id: m for m in members if m.member_type == "user" and m.user_id is not None
    }
    # 时间倒序逐条组装；总长超限即停（丢弃的是更旧的行），最后反转回正序。
    kept_newest_first: list[str] = []
    total = 0
    for log_row, run_user_id in rows:
        if exclude_log_id is not None and log_row.id == exclude_log_id:
            continue
        meta = log_row.metadata_ or {}
        if log_row.channel == "user_input":
            name = meta.get("sender_member_name")
            if not name and run_user_id is not None:
                member = user_members_by_user.get(run_user_id)
                name = member.display_name if member is not None else None
            label = f"{name or '成员'}(用户)"
        else:
            label = f"{meta.get('member_name') or '成员'}(Agent)"
        content = (log_row.content_redacted or "").strip()
        if not content:
            continue
        line = f"{label}: {content[:GROUP_CONTEXT_ENTRY_MAX_CHARS]}"
        if kept_newest_first and total + len(line) > GROUP_CONTEXT_TOTAL_MAX_CHARS:
            break
        kept_newest_first.append(line)
        total += len(line)
    kept_newest_first.reverse()
    return kept_newest_first


def _build_group_prompt(
    *,
    group: AgentGroupChat,
    member: AgentGroupMember,
    member_lines: Sequence[str],
    context_lines: Sequence[str],
    sender_member_name: str,
    content: str,
    source_member_name: str | None = None,
) -> str:
    """影子会话注入 prompt 组装（design §4.3：简报 + 群背景摘要 + 当前消息）。

    ``source_member_name``（task-04 互@协作消费）：非 None 表示当前消息来自
    Agent 成员的协作请求——当前消息行身份标签用 ``{source}(Agent)`` 且段头
    标注「来自 Agent 成员的协作请求」（design §4.4），否则 ``{sender}(用户)``。
    """
    briefing = (
        f"你是群聊「{group.title}」中的 Agent 成员「{member.display_name}」。"
        f"成员：{'、'.join(member_lines)}。"
        "仅当消息 @你 或 @全体 时回应；回应简洁如聊天；"
        f"你的发言会以「{member.display_name}」身份出现在群里。"
    )
    parts = [briefing]
    if context_lines:
        parts.append("[群聊记录 · 背景，仅供了解上下文]\n" + "\n".join(context_lines))
    sender_label = (
        f"{source_member_name}(Agent)"
        if source_member_name is not None
        else f"{sender_member_name}(用户)"
    )
    current_header = (
        "[当前消息 · 来自 Agent 成员的协作请求，需要你回应]"
        if source_member_name is not None
        else "[当前消息 · 需要你回应]"
    )
    parts.append(current_header + "\n" + f"{sender_label}: {content}")
    return "\n\n".join(parts)


async def _publish_group_channel_event(session_id: uuid.UUID, payload: dict[str, object]) -> None:
    """publish 群频道 ``agent_session:{session_id}``（复用现有 SSE 频道，§5.4）。

    容错语义对齐 ``session/service._publish_session_event``：Redis 抖动仅
    warning，不阻断消息落库/触发主链路。
    """
    try:
        redis = get_redis()
        await redis.publish(f"agent_session:{session_id}", json.dumps(payload, default=str))
    except Exception:
        log.warning(
            "publish_group_channel_event_failed",
            session_id=str(session_id),
            redis_event=payload.get("event") if isinstance(payload, dict) else None,
        )


# ── typing / presence（task-06，design §5.4——纯 ephemeral，不落库）───────────

# typing 草稿预览截断长度（design §5.4：preview ≤400 字；服务端再裁一道防
# 超长 payload 进 pub/sub 帧）。
GROUP_TYPING_PREVIEW_MAX_CHARS = 400


def group_typing_channel(group_id: uuid.UUID) -> str:
    """群 typing pub/sub 频道名（``group_typing:{group_id}``，task-06 §5.4）。

    群 SSE 生成器双订阅本频道，typing 事件与日志事件合流进同一 SSE 流。
    """
    return f"group_typing:{group_id}"


def group_presence_key(group_id: uuid.UUID, user_id: uuid.UUID) -> str:
    """群在线 presence key（``group_presence:{group_id}:{user_id}``，§5.4）。

    命名单源：daemon/router.py 群 SSE 分支与测试都经本函数构造；TTL/续期间隔
    常量在 agent/service.py（touch 执行方）。
    """
    return f"group_presence:{group_id}:{user_id}"


async def _publish_group_typing_event(group_id: uuid.UUID, payload: dict[str, object]) -> None:
    """publish typing 频道 ``group_typing:{group_id}``（即发即忘，无存储）。

    容错语义同 ``_publish_group_channel_event``：Redis 抖动仅 warning——
    typing 是纯增益信号（前端 TTL 自动过期），不阻断调用方主链路。
    """
    try:
        redis = get_redis()
        await redis.publish(group_typing_channel(group_id), json.dumps(payload, default=str))
    except Exception:
        log.warning(
            "publish_group_typing_event_failed",
            group_id=str(group_id),
            redis_event=payload.get("event") if isinstance(payload, dict) else None,
        )


def _typing_payload(
    *,
    member_name: str,
    member_kind: str,
    typing: bool,
    preview: str | None,
) -> dict[str, object]:
    """typing 事件 payload 组装（design §5.4 / §8 typing.ping，单一形态）。"""
    return {
        "event": "typing",
        "member_name": member_name,
        "member_kind": member_kind,
        "typing": typing,
        "preview": preview[:GROUP_TYPING_PREVIEW_MAX_CHARS] if preview else None,
        "ts": datetime.now(UTC).isoformat(),
    }


async def _publish_agent_typing_event(group_id: uuid.UUID, member_name: str) -> None:
    """agent 成员 typing 自动事件（「{member_name}」正在输入…，design §5.4）。

    影子 run 开始路径（``send_group_message`` 触发编排尾部）调用——成员昵称
    即面板/气泡展示名；preview 恒 None（后端不产草稿）。
    """
    await _publish_group_typing_event(
        group_id,
        _typing_payload(member_name=member_name, member_kind="agent", typing=True, preview=None),
    )


async def get_online_member_ids(group_id: uuid.UUID) -> list[uuid.UUID]:
    """读群在线用户成员 id 集（``group_presence:{group_id}:*`` keys，§5.4）。

    key 由群 SSE 生成器循环 touch（TTL 60s）——活跃 key 即在线成员。规模上界
    = 用户成员上限 50（design §9.3），KEYS 前缀扫可接受（群列表本身小基数据）。
    Redis 不可用返回空列表（在线绿点降级为全灰，不阻断列表/详情）。
    """
    prefix = f"group_presence:{group_id}:"
    try:
        redis = get_redis()
        keys = await redis.keys(f"{prefix}*")
    except Exception:
        log.warning("group_presence_read_failed", group_id=str(group_id), exc_info=True)
        return []
    online: list[uuid.UUID] = []
    for key in keys or []:
        raw = key[len(prefix) :] if isinstance(key, str) else ""
        try:
            online.append(uuid.UUID(raw))
        except (ValueError, AttributeError):
            continue  # 脏 key（截断/残留）跳过，不炸列表
    return online


async def get_last_message_previews(
    db: AsyncSession, group_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, str | None]:
    """群列表最后消息摘要（task-02 占位字段接通，task-03）。

    每群查时间线最新一行（user_input / 投影行同 §4.2 行源），取内容前 60 字。
    群 id == 群会话 id（§3.2 不变式）。用户群列表规模小（成员上限 50），逐群
    LIMIT 1 查询可接受。
    """
    from sqlalchemy import and_

    previews: dict[uuid.UUID, str | None] = {}
    for group_id in group_ids:
        row = (
            await db.execute(
                select(AgentRunLog.content_redacted)
                .join(AgentRun, AgentRunLog.run_id == AgentRun.id)
                .where(
                    AgentRun.agent_session_id == group_id,
                    or_(
                        AgentRunLog.channel == "user_input",
                        and_(
                            AgentRunLog.channel == "stdout",
                            AgentRunLog.metadata_.is_not(None),
                        ),
                    ),
                )
                .order_by(AgentRunLog.timestamp.desc(), AgentRunLog.id.desc())
                .limit(1)
            )
        ).first()
        content = (row[0] or "").strip() if row is not None else ""
        previews[group_id] = content[:GROUP_LAST_MESSAGE_PREVIEW_CHARS] or None
    return previews


# ── 群消息 DTO（task-03；schema.py 不在本卡 allowed_paths，随服务落本模块——
#    路由层自带轻量 DTO 与 task-02 GroupChatListItemRead 同先例）────────────


class GroupMemberTriggerRead(BaseModel):
    """单成员触发结果（design §8 member.injected / member.mentioned）。"""

    member_id: uuid.UUID
    member_name: str
    shadow_session_id: uuid.UUID
    run_id: uuid.UUID | None = None  # 即时注入轮的 run；排队轮为 None
    queued: bool = False  # 忙轮排队（AgentSessionQueuedMessage）


class GroupMessageSendRead(BaseModel):
    """``POST /group-chats/{id}/messages`` 响应（design §8 group.message.sent）。"""

    carrier_run_id: uuid.UUID
    log_id: uuid.UUID
    mentioned_member_ids: list[uuid.UUID] = Field(default_factory=list)
    mention_all: bool = False
    triggered: list[GroupMemberTriggerRead] = Field(default_factory=list)


# ── 跨模块共享的参与者判定 helper（session/file_artifacts/router 懒加载复用）──


async def get_group_chat_by_session(
    db: AsyncSession,
    session_id: uuid.UUID,
) -> AgentGroupChat | None:
    """按群会话 id 取未软删的群聚合根（id==session_id 不变式下按权威 FK 列查）。"""
    stmt = select(AgentGroupChat).where(
        AgentGroupChat.session_id == session_id,
        AgentGroupChat.deleted_at.is_(None),
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def get_active_user_membership(
    db: AsyncSession,
    *,
    group_id: uuid.UUID,
    user_id: uuid.UUID,
) -> AgentGroupMember | None:
    """取用户在该群的**未移除**用户成员行（design §5.3 成员表命中判定）。"""
    stmt = select(AgentGroupMember).where(
        AgentGroupMember.group_id == group_id,
        AgentGroupMember.member_type == "user",
        AgentGroupMember.user_id == user_id,
        AgentGroupMember.removed_at.is_(None),
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def resolve_shadow_member(
    db: AsyncSession,
    *,
    shadow_session_id: uuid.UUID,
) -> AgentGroupMember | None:
    """按影子会话反向指针定位成员行（§5.1：群↔影子唯一关联通道）。"""
    stmt = select(AgentGroupMember).where(AgentGroupMember.shadow_session_id == shadow_session_id)
    return (await db.execute(stmt)).scalar_one_or_none()


async def get_group_accessible_session(
    db: AsyncSession,
    *,
    session_id: uuid.UUID,
    user_id: uuid.UUID,
    for_update: bool = False,
) -> AgentSession | None:
    """群会话（kind='group'）/ 影子会话（kind='group_member'）参与者判定。

    非群形态（kind='chat'）返回 None——调用方保持原属主校验路径**零改动**
    （design §5.3「单聊零改动铁律」的实现口径：本 helper 只在首查未命中时
    被调用，chat 热路径单查询不变）。

    判定（§5.3）：

    - ``group``：群成员表命中（user 成员未移除）→ 放行；否则 workspace
      admin（``has_permission`` 现有惯例，含 platform admin 短路）→ 放行；
      否则拒（调用方统一 404 不泄露存在性）。
    - ``group_member``（影子，§5.3「影子会话 API 不对外暴露——仅群桥接内部
      +admin debug」）：属主（群主，影子 user_id 同源）→ 放行；否则 workspace
      admin → 放行；否则拒。用户成员**不**经本判定触达影子会话。
    """
    kind = (
        await db.execute(select(AgentSession.session_kind).where(AgentSession.id == session_id))
    ).scalar_one_or_none()
    if kind not in ("group", "group_member"):
        return None
    stmt = select(AgentSession).where(AgentSession.id == session_id)
    if for_update:
        stmt = stmt.with_for_update()
    agent_session = (await db.execute(stmt)).scalar_one_or_none()
    if agent_session is None:
        return None

    if kind == "group":
        group = await get_group_chat_by_session(db, session_id)
        if group is None:
            return None
        if await get_active_user_membership(db, group_id=group.id, user_id=user_id) is not None:
            return agent_session
        user = await db.get(User, user_id)
        if user is not None and await has_permission(
            db,
            user=user,
            permission=Permission.WORKSPACE_ADMIN,
            workspace_id=group.workspace_id,
        ):
            return agent_session
        return None

    # 影子会话：属主（群主）或 workspace admin（admin debug）。
    if agent_session.user_id == user_id:
        return agent_session
    shadow_member = await resolve_shadow_member(db, shadow_session_id=session_id)
    if shadow_member is None:
        return None
    shadow_group = await db.get(AgentGroupChat, shadow_member.group_id)
    if shadow_group is None:
        return None
    user = await db.get(User, user_id)
    if user is not None and await has_permission(
        db,
        user=user,
        permission=Permission.WORKSPACE_ADMIN,
        workspace_id=shadow_group.workspace_id,
    ):
        return agent_session
    return None


def _user_display_name(user: User) -> str:
    """用户成员默认昵称：display_name → username → 用户{id 前缀} 兜底。"""
    return (user.display_name or user.username or f"用户{user.id.hex[:8]}").strip()[:40]


def _validate_display_name(name: str) -> str:
    """昵称规范化 + 保留词校验（@路由无歧义，design §4.1）。"""
    normalized = name.strip()
    if not normalized:
        raise GroupChatInvalid("成员昵称不能为空。")
    if normalized in RESERVED_DISPLAY_NAMES:
        raise GroupChatInvalid(
            f"昵称「{normalized}」是群内保留词（@全体/@all 广播触发词），请换一个昵称。",
        )
    return normalized


class GroupChatService:
    """群管理面业务逻辑（router 薄壳，全部逻辑与权限在此）。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── 权限（design §5.3）───────────────────────────────────────────────────

    async def _require_group_member(
        self, group: AgentGroupChat, user: User
    ) -> AgentGroupMember | None:
        """两段式参与者判定：成员表命中 → workspace admin → 404（不泄露存在性）。

        返回成员行；admin 兜底放行时无成员行，返回 None（仅表达「有权」）。
        """
        membership = await get_active_user_membership(
            self._session, group_id=group.id, user_id=user.id
        )
        if membership is not None:
            return membership
        if await has_permission(
            self._session,
            user=user,
            permission=Permission.WORKSPACE_ADMIN,
            workspace_id=group.workspace_id,
        ):
            return None
        raise GroupChatNotFound(
            "群不存在或无权访问。",
            details={"group_id": str(group.id)},
        )

    async def _require_group_owner(self, group: AgentGroupChat, user: User) -> None:
        """群主专属操作门（§6.1：改设置/加删成员/解散=群主+workspace admin）。

        前置：调用方已过 ``_require_group_member``（非成员 404 先行）。
        """
        if group.created_by == user.id:
            return
        if await has_permission(
            self._session,
            user=user,
            permission=Permission.WORKSPACE_ADMIN,
            workspace_id=group.workspace_id,
        ):
            return
        raise GroupChatForbidden(
            "只有群主或工作区管理员可以执行该操作。",
            details={"group_id": str(group.id)},
        )

    async def _get_group(self, group_id: uuid.UUID) -> AgentGroupChat:
        """取未软删的群聚合根（含已解散——解散群对成员仍可读，end 幂等）。"""
        group = (
            await self._session.execute(
                select(AgentGroupChat).where(
                    AgentGroupChat.id == group_id,
                    AgentGroupChat.deleted_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        if group is None:
            raise GroupChatNotFound(
                "群不存在或无权访问。",
                details={"group_id": str(group_id)},
            )
        return group

    # ── 查询 helper ──────────────────────────────────────────────────────────

    async def _list_members(self, group_id: uuid.UUID) -> list[AgentGroupMember]:
        """群成员全量（含已移除行——详情展示移除态；排序：在群优先，joined_at 升序）。"""
        stmt = (
            select(AgentGroupMember)
            .where(AgentGroupMember.group_id == group_id)
            .order_by(
                AgentGroupMember.removed_at.is_not(None),
                AgentGroupMember.joined_at,
                AgentGroupMember.id,
            )
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def _list_active_member_rows(self, group_id: uuid.UUID) -> list[AgentGroupMember]:
        stmt = (
            select(AgentGroupMember)
            .where(
                AgentGroupMember.group_id == group_id,
                AgentGroupMember.removed_at.is_(None),
            )
            .order_by(AgentGroupMember.joined_at, AgentGroupMember.id)
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def _get_member(self, group_id: uuid.UUID, member_id: uuid.UUID) -> AgentGroupMember:
        member = (
            await self._session.execute(
                select(AgentGroupMember).where(
                    AgentGroupMember.id == member_id,
                    AgentGroupMember.group_id == group_id,
                )
            )
        ).scalar_one_or_none()
        if member is None or member.removed_at is not None:
            raise GroupChatMemberNotFound(
                "群成员不存在或已移除。",
                details={"group_id": str(group_id), "member_id": str(member_id)},
            )
        return member

    def _to_read(self, group: AgentGroupChat, members: list[AgentGroupMember]) -> GroupChatRead:
        read = GroupChatRead.model_validate(group)
        read.members = [GroupMemberRead.model_validate(m) for m in members]
        return read

    # ── 影子会话 end 子链（解散/移除 agent 成员/reset-memory 共用）────────────

    async def _end_member_shadow(
        self,
        member: AgentGroupMember,
        *,
        owner_user_id: uuid.UUID,
        reason: str,
    ) -> None:
        """end 成员影子会话 + 清理影子队列 pending 行（design §8）。

        本卡（task-02）影子会话尚未存在（task-03 懒建）：``shadow_session_id``
        为空直接跳过（幂等）；非空则先删影子队列 pending 行（design §8
        group.member.removed「防终态后静默丢弃」——先删保证 end 链异常时队列
        也不残留），再走既有 ``end_session`` 链（user_id=群主，影子 user_id
        同源——服务身份路径先例）。end 失败 best-effort 降级（warning +
        继续，解散/移除不被单个影子的不变式异常阻断）。
        """
        if member.shadow_session_id is None:
            return
        shadow_session_id = member.shadow_session_id
        await self._session.execute(
            delete(AgentSessionQueuedMessage).where(
                AgentSessionQueuedMessage.agent_session_id == shadow_session_id,
                AgentSessionQueuedMessage.status == "pending",
            )
        )
        await self._session.commit()
        try:
            await SessionService(self._session).end_session(
                shadow_session_id,
                owner_user_id,
                reason=reason,
            )
        except AppError as exc:
            log.warning(
                "group_member_shadow_end_failed",
                group_id=str(member.group_id),
                member_id=str(member.id),
                shadow_session_id=str(shadow_session_id),
                code=exc.code,
            )

    # ── 建群 / 列表 / 详情 / 改设置 / 解散 ────────────────────────────────────

    async def create_group(self, user: User, payload: GroupChatCreate) -> GroupChatRead:
        """建群（design §8 group.created）：群会话 + 群行 + 初始成员（单事务）。

        校验（全部前置，无半成品落库）：workspace 存在且未归档；上限（用户
        50 含建群者 / agent 8）；用户成员存在；agent 成员六要素引用存在；
        昵称唯一（用户与 agent 共用命名空间）+ 保留词。
        """
        from app.modules.agent.profile.model import AgentProfile
        from app.modules.llm_provider.model import LlmProvider
        from app.modules.workspace.model import Workspace
        from app.modules.workspace.service import WorkspaceService

        workspace = await self._session.get(Workspace, payload.workspace_id)
        if workspace is None:
            raise GroupChatInvalid(
                "目标工作区不存在，无法在该工作区下建群。",
                details={"workspace_id": str(payload.workspace_id)},
            )
        WorkspaceService.ensure_writable(workspace)

        # ── 上限（design §9.3）───────────────────────────────────────────────
        if len(payload.user_members) + 1 > GROUP_USER_MEMBER_LIMIT:
            raise GroupChatInvalid(
                f"群用户成员上限为 {GROUP_USER_MEMBER_LIMIT}（含建群者），当前邀请数已超出。",
                details={"user_members": len(payload.user_members)},
            )
        if len(payload.agent_members) > GROUP_AGENT_MEMBER_LIMIT:
            raise GroupChatInvalid(
                f"群 agent 成员上限为 {GROUP_AGENT_MEMBER_LIMIT}，当前配置数已超出。",
                details={"agent_members": len(payload.agent_members)},
            )

        # ── 引用存在性（批量 IN 查，免逐个 N+1）──────────────────────────────
        invited_ids = [m.user_id for m in payload.user_members]
        invited_users: dict[uuid.UUID, User] = {}
        if invited_ids:
            rows = (
                (await self._session.execute(select(User).where(User.id.in_(invited_ids))))
                .scalars()
                .all()
            )
            invited_users = {row.id: row for row in rows}
            missing = [str(uid) for uid in invited_ids if uid not in invited_users]
            if missing:
                raise GroupChatInvalid(
                    "邀请的用户不存在，无法加入群聊。",
                    details={"missing_user_ids": missing},
                )

        runtime_ids = [m.runtime_id for m in payload.agent_members]
        runtimes: dict[uuid.UUID, tuple[DaemonRuntime, DaemonInstance | None]] = {}
        if runtime_ids:
            rt_rows = (
                await self._session.execute(
                    select(DaemonRuntime, DaemonInstance)
                    .join(
                        DaemonInstance,
                        DaemonRuntime.daemon_instance_id == DaemonInstance.id,
                        isouter=True,
                    )
                    .where(DaemonRuntime.id.in_(runtime_ids))
                )
            ).all()
            runtimes = {rt.id: (rt, inst) for rt, inst in rt_rows}
            missing_rt = [str(rid) for rid in runtime_ids if rid not in runtimes]
            if missing_rt:
                raise GroupChatInvalid(
                    "agent 成员绑定的机器不存在，请检查六要素配置。",
                    details={"missing_runtime_ids": missing_rt},
                )

        profile_ids = [m.agent_profile_id for m in payload.agent_members if m.agent_profile_id]
        profiles: dict[uuid.UUID, AgentProfile] = {}
        if profile_ids:
            profile_rows = (
                (
                    await self._session.execute(
                        select(AgentProfile).where(AgentProfile.id.in_(profile_ids))
                    )
                )
                .scalars()
                .all()
            )
            profiles = {p.id: p for p in profile_rows}
            missing_p = [str(pid) for pid in profile_ids if pid not in profiles]
            if missing_p:
                raise GroupChatInvalid(
                    "agent 成员绑定的智能体方案不存在。",
                    details={"missing_agent_profile_ids": missing_p},
                )

        llm_ids = [m.llm_provider_id for m in payload.agent_members if m.llm_provider_id]
        llms: dict[uuid.UUID, LlmProvider] = {}
        if llm_ids:
            llm_rows = (
                (
                    await self._session.execute(
                        select(LlmProvider).where(LlmProvider.id.in_(llm_ids))
                    )
                )
                .scalars()
                .all()
            )
            llms = {row.id: row for row in llm_rows}
            missing_l = [str(lid) for lid in llm_ids if lid not in llms]
            if missing_l:
                raise GroupChatInvalid(
                    "agent 成员绑定的模型（LLM 供应商）不存在。",
                    details={"missing_llm_provider_ids": missing_l},
                )

        # ── 昵称解析 + 唯一性（用户与 agent 共用命名空间，design §3.3）────────
        names: dict[str, str] = {}
        resolved_user_members: list[tuple[User, str]] = []
        owner_name = _validate_display_name(_user_display_name(user))
        names[owner_name] = str(user.id)
        for invite in payload.user_members:
            target = invited_users[invite.user_id]
            name = _validate_display_name(invite.display_name or _user_display_name(target))
            if name in names:
                raise GroupChatInvalid(
                    f"群内昵称「{name}」已被使用（用户与 agent 成员共用同一命名空间）。",
                    details={"display_name": name},
                )
            names[name] = str(target.id)
            resolved_user_members.append((target, name))
        for cfg in payload.agent_members:
            name = _validate_display_name(cfg.display_name)
            if name in names:
                raise GroupChatInvalid(
                    f"群内昵称「{name}」已被使用（用户与 agent 成员共用同一命名空间）。",
                    details={"display_name": name},
                )
            names[name] = cfg.runtime_id.hex

        # ── 落库：群会话（kind='group'，无 lease）+ 群行 + 成员行 ─────────────
        now = datetime.now(UTC)
        group_session = AgentSession(
            id=uuid.uuid4(),
            user_id=user.id,  # 计量归属=群主（design §9.2）
            runtime_id=None,
            lease_id=None,
            provider=GROUP_SESSION_PROVIDER,
            status="active",  # design §8 group.created：无 daemon 握手，直接活跃
            title=payload.title,
            workspace_id=workspace.id,
            turn_count=0,
            created_at=now,
            session_kind="group",
        )
        self._session.add(group_session)
        await self._session.flush()

        group = AgentGroupChat(
            id=group_session.id,  # id==session_id 不变式（design §3.2）
            session_id=group_session.id,
            workspace_id=workspace.id,
            title=payload.title,
            created_by=user.id,
            agent_cross_mention=payload.agent_cross_mention,
            cross_mention_depth=payload.cross_mention_depth,
            context_window=payload.context_window,
            created_at=now,
        )
        self._session.add(group)
        await self._session.flush()

        members: list[AgentGroupMember] = [
            # 建群者自身落用户成员行（§5.3 参与者制：群主=成员）。
            AgentGroupMember(
                group_id=group.id,
                member_type="user",
                display_name=owner_name,
                user_id=user.id,
                invited_by=user.id,
                joined_at=now,
            )
        ]
        for target, name in resolved_user_members:
            members.append(
                AgentGroupMember(
                    group_id=group.id,
                    member_type="user",
                    display_name=name,
                    user_id=target.id,
                    invited_by=user.id,
                    joined_at=now,
                )
            )
        for cfg in payload.agent_members:
            rt, inst = runtimes[cfg.runtime_id]
            profile = profiles.get(cfg.agent_profile_id) if cfg.agent_profile_id else None
            llm = llms.get(cfg.llm_provider_id) if cfg.llm_provider_id else None
            members.append(
                AgentGroupMember(
                    group_id=group.id,
                    member_type="agent",
                    display_name=cfg.display_name.strip(),
                    runtime_id=cfg.runtime_id,
                    workspace_id=cfg.workspace_id or workspace.id,
                    provider=cfg.provider,
                    llm_provider_id=cfg.llm_provider_id,
                    agent_profile_id=cfg.agent_profile_id,
                    shadow_status="none",  # design §8 group.member.added
                    invited_by=user.id,
                    joined_at=now,
                    config_snapshot=_build_config_snapshot(
                        runtime=rt,
                        instance=inst,
                        provider=cfg.provider,
                        profile=profile,
                        llm=llm,
                    ),
                )
            )
        for m in members:
            self._session.add(m)

        await self._session.commit()
        await self._session.refresh(group)
        refreshed = await self._list_members(group.id)
        # task-06（§5.3 audience）：建群信号带全部用户成员 id（邀请者即时收到
        # 列表刷新——群会话不进其 /sessions 列表，刷新信号是唯一入口）。
        await self._publish_group_sessions_changed(group, "created")
        return self._to_read(group, refreshed)

    async def list_groups(self, user: User) -> list[GroupChatRead]:
        """当前用户=群成员（未移除用户成员行）的群列表（design §6.1）。

        成员摘要经成员行 + ``config_snapshot`` 冗余直出（免 N+1：按群 IN
        批量取成员）。``online_member_ids``/最后消息摘要由 router 层占位
        （task-06 填充）。
        """
        stmt = (
            select(AgentGroupChat)
            .join(
                AgentGroupMember,
                (AgentGroupMember.group_id == AgentGroupChat.id)
                & (AgentGroupMember.member_type == "user")
                & (AgentGroupMember.user_id == user.id)
                & AgentGroupMember.removed_at.is_(None),
            )
            .where(AgentGroupChat.deleted_at.is_(None))
            .order_by(AgentGroupChat.created_at.desc(), AgentGroupChat.id.desc())
        )
        groups = list((await self._session.execute(stmt)).scalars().all())
        if not groups:
            return []
        group_ids = [g.id for g in groups]
        member_rows = (
            (
                await self._session.execute(
                    select(AgentGroupMember)
                    .where(
                        AgentGroupMember.group_id.in_(group_ids),
                        AgentGroupMember.removed_at.is_(None),
                    )
                    .order_by(AgentGroupMember.joined_at, AgentGroupMember.id)
                )
            )
            .scalars()
            .all()
        )
        by_group: dict[uuid.UUID, list[AgentGroupMember]] = {}
        for row in member_rows:
            by_group.setdefault(row.group_id, []).append(row)
        return [self._to_read(g, by_group.get(g.id, [])) for g in groups]

    async def get_group(self, group_id: uuid.UUID, user: User) -> GroupChatRead:
        """群详情（成员完整列表含六要素 + shadow_status，design §6.1）。"""
        group = await self._get_group(group_id)
        await self._require_group_member(group, user)
        members = await self._list_members(group.id)
        return self._to_read(group, members)

    async def update_group(
        self,
        group_id: uuid.UUID,
        user: User,
        payload: GroupChatUpdate,
    ) -> GroupChatRead:
        """改群设置（群主/workspace admin；None=不改，design §6.1）。"""
        group = await self._get_group(group_id)
        await self._require_group_member(group, user)
        await self._require_group_owner(group, user)
        if group.ended_at is not None:
            raise GroupChatInvalid(
                "群已解散，无法修改设置。",
                details={"group_id": str(group.id)},
            )
        if payload.title is not None:
            group.title = payload.title
        if payload.agent_cross_mention is not None:
            group.agent_cross_mention = payload.agent_cross_mention
        if payload.cross_mention_depth is not None:
            group.cross_mention_depth = payload.cross_mention_depth
        if payload.context_window is not None:
            group.context_window = payload.context_window
        self._session.add(group)
        await self._session.commit()
        await self._session.refresh(group)
        members = await self._list_members(group.id)
        # task-06（§5.3 audience）：设置变更信号（群列表标题/开关投影刷新）。
        await self._publish_group_sessions_changed(group, "status_changed")
        return self._to_read(group, members)

    async def end_group(self, group_id: uuid.UUID, user: User) -> GroupChatRead:
        """解散群（design §8 group.ended，幂等）。

        收口链：全部有影子的成员 end 影子（既有 end_session 链 + 影子队列
        pending 行删除）→ 群会话置 ended（无 lease，直接 ORM 收口）→ 群行
        ended_at + agent 成员 shadow_status='ended'。
        """
        group = await self._get_group(group_id)
        await self._require_group_member(group, user)
        await self._require_group_owner(group, user)
        if group.ended_at is not None:
            # 幂等：重复解散直接回读。
            members = await self._list_members(group.id)
            return self._to_read(group, members)

        active_members = await self._list_active_member_rows(group.id)
        for member in active_members:
            if member.member_type == "agent":
                await self._end_member_shadow(
                    member, owner_user_id=group.created_by, reason="group_ended"
                )

        now = datetime.now(UTC)
        group_session = await self._session.get(AgentSession, group.session_id)
        if group_session is not None and group_session.status not in ("ended", "failed"):
            group_session.status = "ended"
            group_session.ended_at = now
            group_session.last_active_at = now
            self._session.add(group_session)
        group.ended_at = now
        self._session.add(group)
        for member in active_members:
            if member.member_type == "agent" and member.shadow_session_id is not None:
                member.shadow_status = "ended"  # design §8 group.ended
                self._session.add(member)
        await self._session.commit()
        await self._session.refresh(group)
        members = await self._list_members(group.id)
        # task-06（§5.3 audience / §8 group.ended）：解散信号全员可见（列表把
        # 已解散群折叠/移出）。
        await self._publish_group_sessions_changed(group, "status_changed")
        return self._to_read(group, members)

    # ── 成员管理（design §6.1 / §8）─────────────────────────────────────────

    async def add_member(
        self,
        group_id: uuid.UUID,
        user: User,
        payload: GroupMemberCreate,
    ) -> GroupMemberRead:
        """加成员（群主/workspace admin）：用户邀请或 agent 成员六要素配置。"""
        from app.modules.agent.profile.model import AgentProfile
        from app.modules.llm_provider.model import LlmProvider

        if (payload.user is None) == (payload.agent is None):
            raise GroupChatInvalid(
                "成员写体二选一：user（邀请用户）或 agent（六要素配置）。",
            )
        group = await self._get_group(group_id)
        await self._require_group_member(group, user)
        await self._require_group_owner(group, user)
        if group.ended_at is not None:
            raise GroupChatInvalid(
                "群已解散，无法添加成员。",
                details={"group_id": str(group.id)},
            )
        active_members = await self._list_active_member_rows(group.id)
        active_user_count = sum(1 for m in active_members if m.member_type == "user")
        active_agent_count = sum(1 for m in active_members if m.member_type == "agent")
        taken_names = {m.display_name for m in active_members}

        now = datetime.now(UTC)
        if payload.user is not None:
            if active_user_count + 1 > GROUP_USER_MEMBER_LIMIT:
                raise GroupChatInvalid(
                    f"群用户成员上限为 {GROUP_USER_MEMBER_LIMIT}，无法继续添加。",
                )
            target = await self._session.get(User, payload.user.user_id)
            if target is None:
                raise GroupChatInvalid(
                    "邀请的用户不存在，无法加入群聊。",
                    details={"user_id": str(payload.user.user_id)},
                )
            # 复活语义先行（部分唯一索引 uq_agent_group_members_group_user 按
            # (group_id, user_id) 恒占位）：已移除用户再次邀请走原行复活，不撞
            # 索引（design §3.3 UNIQUE(group_id, user_id)）；在群用户重复邀请
            # 的 400 语义先于昵称冲突判定（昵称常与本人现名相同，先查成员行
            # 才能给出准确文案）。
            revived = (
                await self._session.execute(
                    select(AgentGroupMember).where(
                        AgentGroupMember.group_id == group.id,
                        AgentGroupMember.user_id == target.id,
                    )
                )
            ).scalar_one_or_none()
            if revived is not None and revived.removed_at is None:
                raise GroupChatInvalid(
                    "该用户已是群成员，无法重复邀请。",
                    details={"user_id": str(target.id)},
                )
            name = _validate_display_name(payload.user.display_name or _user_display_name(target))
            if name in taken_names:
                raise GroupChatInvalid(
                    f"群内昵称「{name}」已被使用（用户与 agent 成员共用同一命名空间）。",
                    details={"display_name": name},
                )
            if revived is not None:
                revived.removed_at = None
                revived.display_name = name
                revived.invited_by = user.id
                revived.joined_at = now
                self._session.add(revived)
                await self._session.commit()
                await self._session.refresh(revived)
                # task-06（§5.3 audience / §8 group.member.added）。
                await self._publish_group_sessions_changed(group, "status_changed")
                return GroupMemberRead.model_validate(revived)
            member = AgentGroupMember(
                group_id=group.id,
                member_type="user",
                display_name=name,
                user_id=target.id,
                invited_by=user.id,
                joined_at=now,
            )
            self._session.add(member)
            await self._session.commit()
            await self._session.refresh(member)
            # task-06（§5.3 audience / §8 group.member.added）：新成员即时进
            # 自己的刷新受众（否则要等下一次任意群事件才看到群）。
            await self._publish_group_sessions_changed(group, "status_changed")
            return GroupMemberRead.model_validate(member)

        assert payload.agent is not None
        cfg = payload.agent
        if active_agent_count + 1 > GROUP_AGENT_MEMBER_LIMIT:
            raise GroupChatInvalid(
                f"群 agent 成员上限为 {GROUP_AGENT_MEMBER_LIMIT}，无法继续添加。",
            )
        rt_row = (
            await self._session.execute(
                select(DaemonRuntime, DaemonInstance)
                .join(
                    DaemonInstance,
                    DaemonRuntime.daemon_instance_id == DaemonInstance.id,
                    isouter=True,
                )
                .where(DaemonRuntime.id == cfg.runtime_id)
            )
        ).first()
        if rt_row is None:
            raise GroupChatInvalid(
                "agent 成员绑定的机器不存在，请检查六要素配置。",
                details={"runtime_id": str(cfg.runtime_id)},
            )
        runtime, instance = rt_row[0], rt_row[1]
        profile: AgentProfile | None = None
        if cfg.agent_profile_id is not None:
            profile = await self._session.get(AgentProfile, cfg.agent_profile_id)
            if profile is None:
                raise GroupChatInvalid(
                    "agent 成员绑定的智能体方案不存在。",
                    details={"agent_profile_id": str(cfg.agent_profile_id)},
                )
        llm: LlmProvider | None = None
        if cfg.llm_provider_id is not None:
            llm = await self._session.get(LlmProvider, cfg.llm_provider_id)
            if llm is None:
                raise GroupChatInvalid(
                    "agent 成员绑定的模型（LLM 供应商）不存在。",
                    details={"llm_provider_id": str(cfg.llm_provider_id)},
                )
        name = _validate_display_name(cfg.display_name)
        if name in taken_names:
            raise GroupChatInvalid(
                f"群内昵称「{name}」已被使用（用户与 agent 成员共用同一命名空间）。",
                details={"display_name": name},
            )
        member = AgentGroupMember(
            group_id=group.id,
            member_type="agent",
            display_name=name,
            runtime_id=cfg.runtime_id,
            workspace_id=cfg.workspace_id or group.workspace_id,
            provider=cfg.provider,
            llm_provider_id=cfg.llm_provider_id,
            agent_profile_id=cfg.agent_profile_id,
            shadow_status="none",
            invited_by=user.id,
            joined_at=now,
            config_snapshot=_build_config_snapshot(
                runtime=runtime,
                instance=instance,
                provider=cfg.provider,
                profile=profile,
                llm=llm,
            ),
        )
        self._session.add(member)
        await self._session.commit()
        await self._session.refresh(member)
        # task-06（§5.3 audience）：agent 成员变更同样广播（成员 chips 刷新）。
        await self._publish_group_sessions_changed(group, "status_changed")
        return GroupMemberRead.model_validate(member)

    async def update_member(
        self,
        group_id: uuid.UUID,
        member_id: uuid.UUID,
        user: User,
        payload: GroupMemberUpdate,
    ) -> GroupMemberRead:
        """改成员（群主/workspace admin）：改昵称 / agent 成员六要素。

        六要素热切换（task-04，design §4.5）：模型组（provider/llm_provider/
        agent_profile）变更且影子存在 → 影子三列同步 + SESSION_SWITCH_CONFIG
        服务身份下发（下轮边界生效）；机器组（runtime/workspace）变更且影子
        存在 → end 影子 + ``shadow_status='pending'``（下次触发懒重建，记忆
        重置）。config_snapshot 同步更新（§3.3 冗余）。
        """
        from app.modules.agent.profile.model import AgentProfile
        from app.modules.llm_provider.model import LlmProvider

        group = await self._get_group(group_id)
        await self._require_group_member(group, user)
        await self._require_group_owner(group, user)
        if group.ended_at is not None:
            raise GroupChatInvalid(
                "群已解散，无法修改成员。",
                details={"group_id": str(group.id)},
            )
        member = await self._get_member(group.id, member_id)

        if member.member_type != "agent" and (
            payload.runtime_id is not None
            or payload.workspace_id is not None
            or payload.provider is not None
            or payload.llm_provider_id is not None
            or payload.agent_profile_id is not None
        ):
            raise GroupChatInvalid(
                "用户成员不支持修改六要素配置（仅 agent 成员可配置）。",
                details={"member_id": str(member.id)},
            )

        # task-04（design §4.5）：六要素 diff 基线——变更前的三组维度值
        # （模型组 provider/llm_provider_id/agent_profile_id 走热切换；机器组
        # runtime_id/workspace_id 走影子重建）。
        old_config = {
            "runtime_id": member.runtime_id,
            "workspace_id": member.workspace_id,
            "provider": member.provider,
            "llm_provider_id": member.llm_provider_id,
            "agent_profile_id": member.agent_profile_id,
        }

        if payload.display_name is not None:
            name = _validate_display_name(payload.display_name)
            if name != member.display_name:
                taken = {
                    m.display_name
                    for m in await self._list_active_member_rows(group.id)
                    if m.id != member.id
                }
                if name in taken:
                    raise GroupChatInvalid(
                        f"群内昵称「{name}」已被使用（用户与 agent 成员共用同一命名空间）。",
                        details={"display_name": name},
                    )
                member.display_name = name

        snapshot_dirty = False
        if member.member_type == "agent":
            if payload.runtime_id is not None and payload.runtime_id != member.runtime_id:
                if await self._session.get(DaemonRuntime, payload.runtime_id) is None:
                    raise GroupChatInvalid(
                        "agent 成员绑定的机器不存在，请检查六要素配置。",
                        details={"runtime_id": str(payload.runtime_id)},
                    )
                member.runtime_id = payload.runtime_id
                snapshot_dirty = True
            if payload.workspace_id is not None and payload.workspace_id != member.workspace_id:
                member.workspace_id = payload.workspace_id
                snapshot_dirty = True
            if payload.provider is not None and payload.provider != member.provider:
                member.provider = payload.provider
                snapshot_dirty = True
            if (
                payload.llm_provider_id is not None
                and payload.llm_provider_id != member.llm_provider_id
            ):
                if await self._session.get(LlmProvider, payload.llm_provider_id) is None:
                    raise GroupChatInvalid(
                        "agent 成员绑定的模型（LLM 供应商）不存在。",
                        details={"llm_provider_id": str(payload.llm_provider_id)},
                    )
                member.llm_provider_id = payload.llm_provider_id
                snapshot_dirty = True
            if (
                payload.agent_profile_id is not None
                and payload.agent_profile_id != member.agent_profile_id
            ):
                if await self._session.get(AgentProfile, payload.agent_profile_id) is None:
                    raise GroupChatInvalid(
                        "agent 成员绑定的智能体方案不存在。",
                        details={"agent_profile_id": str(payload.agent_profile_id)},
                    )
                member.agent_profile_id = payload.agent_profile_id
                snapshot_dirty = True
            if snapshot_dirty:
                member.config_snapshot = await _rebuild_config_snapshot(self._session, member)

        self._session.add(member)
        await self._session.commit()
        await self._session.refresh(member)

        # ── task-04（design §4.5 / §8 member.config.switched）：六要素热切换──
        # 成员表已提交（六要素真相源）；影子存在时按 diff 分组执行 daemon 侧。
        # 子链内部的 rollback 会 expire 会话对象——先取标量，分支后重取行。
        group_id_val = group.id
        if member.member_type == "agent" and member.shadow_session_id is not None:
            machine_changed = (
                old_config["runtime_id"] != member.runtime_id
                or old_config["workspace_id"] != member.workspace_id
            )
            model_changed = (
                old_config["provider"] != member.provider
                or old_config["llm_provider_id"] != member.llm_provider_id
                or old_config["agent_profile_id"] != member.agent_profile_id
            )
            if machine_changed:
                # 机器/工作区切换：end 旧影子 + pending + 指针置空——下次被 @ 按
                # 新六要素懒重建（记忆重置，接口层已提示确认）。
                await self._end_member_shadow(
                    member,
                    owner_user_id=group.created_by,
                    reason="member_reconfigured",
                )
                member = await self._get_member(group_id_val, member_id)
                member.shadow_status = "pending"
                member.shadow_session_id = None
                self._session.add(member)
                await self._session.commit()
                await self._session.refresh(member)
            elif model_changed:
                await self._hot_switch_shadow_config(member, old_config=old_config)

        # 热切换子链（rollback）可能 expire 群/成员行——重取后再收口（防
        # expired 属性 lazy IO 炸 MissingGreenlet）。
        member = await self._get_member(group_id_val, member_id)
        group = await self._get_group(group_id_val)
        # task-06（§5.3 audience）：昵称/六要素变更 → 成员 chips 快照刷新。
        await self._publish_group_sessions_changed(group, "status_changed")
        return GroupMemberRead.model_validate(member)

    async def _hot_switch_shadow_config(
        self,
        member: AgentGroupMember,
        *,
        old_config: dict,
    ) -> bool:
        """模型组六要素热切换（design §4.5：下轮边界生效，独立记忆延续）。

        步骤与顺序（顺序敏感——切换轮靠新旧值 diff 判定，先同步列会让 diff
        消失变成空 prompt 拒绝）：

        1. 经 ``inject_session_as_service`` 服务身份下发**静默切换轮**（空
           prompt + 实际变更维度）：``_inject_into_session`` 的 config_switch
           分支刷新影子 ``agent_profile_id``/``llm_provider_id`` 两列 + 快照 +
           SESSION_SWITCH_CONFIG（daemon 当前轮结束边界 reload，下一轮生效；
           忙轮则排队条目携带切换参数，turn 终态派发时同样走切换分支）。SDK
           resume id 不变，独立记忆延续；
        2. 引擎列（``provider``）inject 分支不覆盖——切换轮后手动补同步；
        3. 纯引擎 diff（profile/llm 未变）无原生切换维度可注入：仅同步三列
           （daemon driver 无法会话中热换引擎，效果落在下次影子重建/快照）。

        失败语义：切换轮失败（供应商归属/引擎不匹配/daemon 离线）记 warning
        后**兜底同步三列**——成员表是六要素真相源，下次触发按新列快照执行，
        PATCH 不因 daemon 侧失败回滚。子链内部 rollback 会 expire 会话对象
        （工厂 expire_on_commit=False，仅 rollback 过期）——所需标量先取局部。
        """
        shadow_id = member.shadow_session_id
        target_provider = member.provider
        target_llm_id = member.llm_provider_id
        target_profile_id = member.agent_profile_id
        shadow = await self._session.get(AgentSession, shadow_id)
        if shadow is None or shadow.status in ("ended", "failed"):
            return False

        # 仅把**实际变更**的维度传给切换分支（等值传入=不构成切换，空 prompt
        # 会被守卫拒；None→"" 语义=清空回本机默认/无人格）。
        switch_profile: str | None = None
        if old_config["agent_profile_id"] != target_profile_id:
            switch_profile = str(target_profile_id) if target_profile_id is not None else ""
        switch_llm: str | None = None
        if old_config["llm_provider_id"] != target_llm_id:
            switch_llm = str(target_llm_id) if target_llm_id is not None else ""

        if switch_profile is None and switch_llm is None:
            shadow.provider = target_provider or shadow.provider
            shadow.llm_provider_id = target_llm_id
            shadow.agent_profile_id = target_profile_id
            self._session.add(shadow)
            await self._session.commit()
            log.info(
                "group_member_switch_engine_only_columns_synced",
                member_id=str(member.id),
                shadow_session_id=str(shadow_id),
                provider=shadow.provider,
            )
            return True

        try:
            await SessionService(self._session).inject_session_as_service(
                shadow.id,
                prompt="",
                agent_profile_id=switch_profile,
                llm_provider_id=switch_llm,
                queue_when_busy=True,
            )
        except AppError as exc:
            log.warning(
                "group_member_switch_dispatch_failed",
                member_id=str(member.id),
                shadow_session_id=str(shadow_id),
                code=exc.code,
            )
            switched = False
        else:
            switched = True

        # 切换轮（成功与否）后补齐三列：成功路径 profile/llm 已由切换分支刷新，
        # 引擎列恒需手动；失败路径全列兜底同步（真相源跟随，rollforward）。
        fresh_shadow = await self._session.get(AgentSession, shadow_id)
        if fresh_shadow is not None and fresh_shadow.status not in ("ended", "failed"):
            fresh_shadow.provider = target_provider or fresh_shadow.provider
            fresh_shadow.llm_provider_id = target_llm_id
            fresh_shadow.agent_profile_id = target_profile_id
            self._session.add(fresh_shadow)
            await self._session.commit()
        return switched

    async def remove_member(
        self,
        group_id: uuid.UUID,
        member_id: uuid.UUID,
        user: User,
    ) -> None:
        """移除成员（群主/workspace admin，design §8 group.member.removed）。

        用户成员：removed_at 置位（群主本人不可移除——解散才是退出路径）；
        agent 成员：额外 end 影子会话 + 影子队列 pending 行删除 +
        shadow_status='none'。群内系统提示行由 task-03 消息管线补（本卡无
        群消息端点）。
        """
        group = await self._get_group(group_id)
        await self._require_group_member(group, user)
        await self._require_group_owner(group, user)
        if group.ended_at is not None:
            raise GroupChatInvalid(
                "群已解散，无需移除成员。",
                details={"group_id": str(group.id)},
            )
        member = await self._get_member(group.id, member_id)
        if member.member_type == "user" and member.user_id == group.created_by:
            raise GroupChatInvalid(
                "群主不能被移除；如需结束群聊请使用解散操作。",
                details={"group_id": str(group.id)},
            )
        if member.member_type == "agent":
            await self._end_member_shadow(
                member, owner_user_id=group.created_by, reason="member_removed"
            )
            # _end_member_shadow 已 commit；重新取行防 expire 后丢状态。
            member = await self._get_member(group.id, member_id)
            member.shadow_status = "none"  # design §8 group.member.removed
        member.removed_at = datetime.now(UTC)
        self._session.add(member)
        await self._session.commit()
        # task-06（§5.3 audience）：移除后广播（受众=剩余成员；被移除者不再
        # 命中 audience，其列表刷新信号自然停发）。
        await self._publish_group_sessions_changed(group, "status_changed")

    async def reset_member_memory(
        self,
        group_id: uuid.UUID,
        member_id: uuid.UUID,
        user: User,
    ) -> GroupMemberRead:
        """重置 agent 成员记忆（design §6.1：end 影子置 pending，下次触发懒重建）。

        本卡影子会话尚不存在：实现为幂等置位（shadow_status='pending' +
        shadow_session_id 置 NULL）；已有影子时先走 end 影子链再置位
        （task-03 懒建消费本语义）。
        """
        group = await self._get_group(group_id)
        await self._require_group_member(group, user)
        await self._require_group_owner(group, user)
        member = await self._get_member(group.id, member_id)
        if member.member_type != "agent":
            raise GroupChatInvalid(
                "仅 agent 成员支持重置记忆。",
                details={"member_id": str(member.id)},
            )
        await self._end_member_shadow(member, owner_user_id=group.created_by, reason="memory_reset")
        member = await self._get_member(group.id, member_id)
        member.shadow_status = "pending"
        member.shadow_session_id = None
        self._session.add(member)
        await self._session.commit()
        await self._session.refresh(member)
        return GroupMemberRead.model_validate(member)

    # ── 群消息与 @触发管线（task-03，design §4.1-4.3 / §8）──────────────────

    async def send_group_message(
        self, group_id: uuid.UUID, user: User, content: str
    ) -> GroupMessageSendRead:
        """发群消息（design §4.1 步 1-6 / §8 group.message.sent）。

        成员校验 → 载体 run + user_input 原文落库 → 群频道 log 事件（sender
        身份）→ @解析 → 逐命中 agent 成员触发（懒建/注入/排队见
        ``_trigger_group_member``）。未 @ 消息仅落时间线（进后续群背景摘要），
        不触发任何成员。

        失败语义：载体 run 与触发是两个事务——触发失败（如机器未授权 400 /
        队列满 409）时消息已在时间线，错误照常抛出（前端可提示重发仅触发）。
        """
        group = await self._get_group(group_id)
        membership = await self._require_group_member(group, user)
        if group.ended_at is not None:
            raise GroupChatInvalid(
                "群已解散，无法发送消息。",
                details={"group_id": str(group.id)},
            )
        if not (content or "").strip():
            raise GroupChatInvalid("消息内容不能为空。", details={"reason": "empty_prompt"})
        # admin 兜底放行无成员行——昵称回落用户显示名。
        sender_member_name = (
            membership.display_name if membership is not None else _user_display_name(user)
        )

        members = await self._list_active_member_rows(group.id)

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
        self._session.add(carrier)
        await self._session.flush()
        log_row = AgentRunLog(
            id=uuid.uuid4(),
            run_id=carrier.id,
            channel="user_input",
            content_redacted=content[:5000],  # 沿用 user_input 既有截断口径
            timestamp=now,
            # 发送者身份（§5.2：实时事件与回放同源；摘要组装/回放还原消费）。
            metadata_={
                "sender_user_id": str(user.id),
                "sender_member_name": sender_member_name,
            },
        )
        self._session.add(log_row)
        await self._session.commit()

        # ── 群频道 log 事件（§4.1 步 3；payload 形态照 run_sync session channel
        #    log 事件扩展 sender 字段，前端 SessionStreamEnvelope 消费）。
        await _publish_group_channel_event(
            group.session_id,
            {
                "event": "log",
                "session_id": str(group.session_id),
                "run_id": str(carrier.id),
                "log_id": str(log_row.id),
                "channel": "user_input",
                "content": content,
                "timestamp": now.isoformat(),
                "sender_user_id": str(user.id),
                "sender_member_name": sender_member_name,
            },
        )

        # ── @解析 + 触发编排（§4.1 步 4-6）。
        mentioned = _parse_group_mentions(content, members)
        triggered: list[GroupMemberTriggerRead] = []
        if mentioned:
            member_lines = [
                f"{m.display_name}({'用户' if m.member_type == 'user' else 'Agent'})"
                for m in members
            ]
            # task-04（design §4.4）：用户 @ 直接触发的成员入协作链（链 id=本
            # 载体 run；深度 0；后续互@沿用原链去重/判深）——best-effort，Redis
            # 抖动不阻断发送（互@侧 fail-closed 自兜底）。
            try:
                redis = get_redis()
                await redis.ping()  # type: ignore[misc]  # redis-py stubs union 返回
                await _register_chain_members(redis, carrier.id, [m.id for m in mentioned])
            except Exception:
                log.warning(
                    "group_chain_register_unavailable",
                    carrier_run_id=str(carrier.id),
                    exc_info=True,
                )
            for member in sorted(mentioned, key=lambda m: (m.joined_at, m.id)):
                trigger = await self._trigger_group_member(
                    group=group,
                    member=member,
                    members=members,
                    member_lines=member_lines,
                    sender_user_id=user.id,
                    sender_member_name=sender_member_name,
                    content=content,
                    carrier_run_id=carrier.id,
                    exclude_log_id=log_row.id,
                )
                triggered.append(trigger)
                # task-06（design §5.4）：影子 run 开始（即时注入/懒建首轮，非
                # 排队）→ 自动发一条 agent typing（「昵称」正在输入…）。排队轮
                # run 尚未开始不发（typing 指示器语义=正在生成回复）。
                if not trigger.queued:
                    await _publish_agent_typing_event(group.id, member.display_name)
        return GroupMessageSendRead(
            carrier_run_id=carrier.id,
            log_id=log_row.id,
            mentioned_member_ids=[m.id for m in mentioned],
            mention_all=_has_broadcast_mention(content),
            triggered=triggered,
        )

    async def _trigger_group_member(
        self,
        *,
        group: AgentGroupChat,
        member: AgentGroupMember,
        members: list[AgentGroupMember],
        member_lines: list[str],
        sender_user_id: uuid.UUID,
        sender_member_name: str,
        content: str,
        carrier_run_id: uuid.UUID,
        exclude_log_id: uuid.UUID | None,
        source_member_name: str | None = None,
        chain_depth: int = 0,
    ) -> GroupMemberTriggerRead:
        """触发单个 agent 成员（design §4.1 步 6 / §8 member.injected）。

        prompt 先组装（即时注入与忙轮排队共用同一文本——排队快照按入队时刻
        冻结，design §9.7）；随后影子懒建（首次）或复用注入（忙轮排队由
        ``inject_session_as_service`` 的 queue_when_busy 分支承接：满 5 → 409
        DaemonSessionQueueFull）。

        ``sender_user_id``：触发方用户 id——用户 @ 路径=实际发送者，互@路径
        （task-04）=群主（服务身份，§9.2 计量归属）；``source_member_name``/
        ``chain_depth`` 为互@协作参数（链沿用原载体 run、深度 +1）。
        """
        context_lines = await _load_group_context_lines(
            self._session,
            group_session_id=group.session_id,
            context_window=group.context_window,
            members=members,
            exclude_log_id=exclude_log_id,
        )
        prompt = _build_group_prompt(
            group=group,
            member=member,
            member_lines=member_lines,
            context_lines=context_lines,
            sender_member_name=sender_member_name,
            content=content,
            source_member_name=source_member_name,
        )
        # 群链路 metadata（§4.3 注入 / §4.4 链 id 透传）：写本轮 user_input 日志
        # metadata_ 列——task-04 turn_completed 互@检测读取（排队派发的透传
        # 见 dispatch_next_queued_message 侧 task-04 接线）。
        turn_metadata = {
            "source_group_id": str(group.id),
            "source_member_id": str(member.id),
            "source_carrier_run_id": str(carrier_run_id),
            "chain_depth": chain_depth,
            "sender_user_id": str(sender_user_id),
        }
        if source_member_name is not None:
            # 互@轮：来源是 Agent 成员（无 user 行）——记成员身份供审计/展示。
            turn_metadata["sender_member_name"] = source_member_name
            turn_metadata["sender_member_kind"] = "agent"

        shadow, first_run_id = await self._ensure_shadow_session(
            group, member, first_prompt=prompt, first_turn_metadata=turn_metadata
        )
        if first_run_id is not None:
            # 首次触发：懒建事务内已落首轮 run + SESSION_INJECT。
            return GroupMemberTriggerRead(
                member_id=member.id,
                member_name=member.display_name,
                shadow_session_id=shadow.id,
                run_id=first_run_id,
                queued=False,
            )

        # 复用轮：注入共享核心（run user_id=影子属主=群主，§9.2；忙轮 → 排队，
        # entry.sender_user_id=实际发送者）。
        result = await SessionService(self._session).inject_session_as_service(
            shadow.id,
            prompt=prompt,
            queue_when_busy=True,
            queue_sender_user_id=sender_user_id,
            turn_metadata=turn_metadata,
        )
        return GroupMemberTriggerRead(
            member_id=member.id,
            member_name=member.display_name,
            shadow_session_id=shadow.id,
            run_id=result.agent_run.id if result.agent_run is not None else None,
            queued=result.queued,
        )

    async def _ensure_shadow_session(
        self,
        group: AgentGroupChat,
        member: AgentGroupMember,
        *,
        first_prompt: str,
        first_turn_metadata: dict,
    ) -> tuple[AgentSession, uuid.UUID | None]:
        """影子会话懒建（design §4.3 / §8 shadow.created，照 worker 三件套）。

        返回 ``(影子会话, 首轮 run id)``——**首轮 run id 非 None 表示本次为
        懒建**（首轮 run + lease + SESSION_INJECT 已在事务内完成）；None 表示
        复用既有影子（调用方走 inject 排队/注入路径）。

        三件套（``_dispatch_worker_core`` mcp_tools.py 先例）：

        1. 直接 ORM 建行（不走 create_session——审批开关生效位在
           ``AgentSession.config`` 列，permission_service 按其门控；影子
           ``manual_approval=False``，§9.1 审批不进群）；
        2. ``prepare_interactive_dispatch``（flush-only）：pinned_runtime_id=
           成员机器、cwd=成员工作区根、stage='group_member'；**机器授权走
           grants 分支**（``skip_owner_check=False`` + ``workspace_id=群工作区``
           ——属主命中或 workspace grant 授权才放行；**不照抄 worker 的
           ``skip_owner_check=True``**，D-010：群成员机器是群主任意选择的，
           无授权 → 400 fail-loud 零残留）；
        3. 回填成员表 ``shadow_session_id`` / ``shadow_status='active'``。

        首轮下发照 ``create_session`` 尾段：lease metadata prompt 作 daemon 建
        会话兜底 + readiness 后 SESSION_INJECT 控制指令发完整组装 prompt
        （daemon inject() 清 pendingFirstPrompt，无双重轮次——create_session
        P0 修复注释口径）。``parent_session_id`` 恒 NULL（D-007/§5.1）。
        """
        # 幂等复用：指针非空且影子非终态 → 直接复用（懒建只在首次触发发生）。
        if member.shadow_session_id is not None:
            existing = await self._session.get(AgentSession, member.shadow_session_id)
            if existing is not None and existing.status not in ("ended", "failed"):
                return existing, None
            # 指针悬挂（reset-memory 后重建 / 派发失败残留）→ 走下方新建，
            # 旧行留史，成员指针更新到新影子。

        from app.modules.agent.placement import (
            NoOnlineDaemonError,
            RunPlacementService,
        )

        if member.runtime_id is None:
            raise GroupChatInvalid(
                f"成员「{member.display_name}」缺少机器配置，无法触发。",
                details={"member_id": str(member.id)},
            )
        provider = member.provider or "claude"

        # cwd = 成员工作区根（六要素②；缺省建群时已落群工作区）。
        cwd: str | None = None
        if member.workspace_id is not None:
            from app.modules.workspace.model import Workspace
            from app.modules.workspace.service import resolve_root_path_for_daemon

            member_ws = await self._session.get(Workspace, member.workspace_id)
            if member_ws is not None and member_ws.root_path:
                cwd = resolve_root_path_for_daemon(member_ws.root_path)

        # 档案行（快照 + lease 提示词维度下推用；缺省 None 零分支）。
        profile = None
        if member.agent_profile_id is not None:
            from app.modules.agent.profile.model import AgentProfile

            profile = await self._session.get(AgentProfile, member.agent_profile_id)

        now = datetime.now(UTC)
        # ① 影子会话行（parent 恒 NULL——群↔影子唯一关联通道是成员表反向指针）。
        shadow = AgentSession(
            id=uuid.uuid4(),
            user_id=group.created_by,  # 计量归属=群主（§9.2；影子 user_id 同源）
            runtime_id=None,  # 派发后回填（dispatch.runtime_id==钉定机器）
            lease_id=None,  # 同上
            provider=provider,
            status="pending",  # 事务内随 lease 回填激活为 active
            config={"manual_approval": False},  # §9.1：审批不进群（worker 先例）
            turn_count=0,
            created_at=now,
            workspace_id=member.workspace_id,
            title=f"群「{group.title}」·{member.display_name}",
            session_kind="group_member",
            parent_session_id=None,  # D-007：恒 NULL（§5.1 硬约束）
            agent_profile_id=member.agent_profile_id,
            llm_provider_id=member.llm_provider_id,
        )
        self._session.add(shadow)
        await self._session.flush()

        # 首轮 run（interactive 驱动；挂影子会话、user_id=群主）——lease
        # metadata.run_id 必须指向真实 run（daemon claim/上报按 run 对账，
        # 假 id 会让 daemon 上报打到不存在的 run 上）。
        from app.modules.agent.service import _build_agent_profile_snapshot

        first_run = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider=provider,
            status="pending",
            spec_strategy="interactive",
            agent_session_id=shadow.id,
            user_id=group.created_by,
            agent_profile_id=member.agent_profile_id,
            agent_profile_snapshot=(
                _build_agent_profile_snapshot(profile) if profile is not None else None
            ),
            llm_provider_id=member.llm_provider_id,
        )
        self._session.add(first_run)
        await self._session.flush()
        # 首轮 user_input 日志：完整组装 prompt（与排队快照同口径）+ 群链路
        # metadata（含发送者——run.user_id 是群主，真实发送者只在此处）。
        self._session.add(
            AgentRunLog(
                id=uuid.uuid4(),
                run_id=first_run.id,
                channel="user_input",
                content_redacted=first_prompt[:5000],
                timestamp=now,
                metadata_=dict(first_turn_metadata),
            )
        )

        # ② interactive lease（flush-only；grants 授权分支见 docstring）。
        # 失败分支的 message/details 值先取局部（rollback 会 expire 会话内全部
        # 对象，过期属性访问在 greenlet 外炸 MissingGreenlet——worker 预检先例）。
        member_name = member.display_name
        member_id_str = str(member.id)
        runtime_id_str = str(member.runtime_id)
        placement = RunPlacementService(self._session)
        try:
            dispatch = await placement.prepare_interactive_dispatch(
                agent_session_id=shadow.id,
                agent_run_id=first_run.id,
                user_id=group.created_by,
                provider=provider,
                prompt=first_prompt,
                model=None,  # 模型走 llm_provider_id → lease metadata（下方）
                workspace_id=group.workspace_id,  # grants 授权作用域=群工作区
                cwd=cwd,
                pinned_runtime_id=member.runtime_id,
                pinned_skip_owner_check=False,  # D-010：不照抄 worker 豁免
                stage=GROUP_MEMBER_STAGE,
            )
        except NoOnlineDaemonError as exc:
            # 无授权/离线/掉线 → 400 fail-loud，事务回滚零残留（不建孤儿影子）。
            await self._session.rollback()
            raise GroupChatInvalid(
                f"成员「{member_name}」的机器当前不可用或未授权，无法触发。",
                details={
                    "member_id": member_id_str,
                    "runtime_id": runtime_id_str,
                    "reason": str(exc),
                },
            ) from exc

        # 档案提示词维度 / 会话级供应商下推（照 create_session :1867-1914）。
        if profile is not None:
            from app.modules.agent.service import AgentService

            await AgentService(self._session).apply_session_profile_to_lease(
                dispatch.lease_id, profile
            )
        if member.llm_provider_id is not None:
            from app.modules.daemon.session.service import _merge_lease_metadata

            await _merge_lease_metadata(
                self._session,
                dispatch.lease_id,
                {"session_llm_provider_id": str(member.llm_provider_id)},
            )

        # ③ 回填 + 激活 + 成员表指针（单 commit 收口三元组）。
        shadow.runtime_id = dispatch.runtime_id
        shadow.lease_id = dispatch.lease_id
        shadow.status = "active"
        self._session.add(shadow)
        member.shadow_session_id = shadow.id
        member.shadow_status = "active"
        self._session.add(member)
        await self._session.commit()

        # 唤醒 daemon（lease pending 等 daemon 轮询自领取；不可达仅告警——
        # worker 路径同口径，lease 不作废）。
        delivered = await placement.notify_interactive_dispatch(dispatch)
        shadow_id = shadow.id
        if not delivered:
            # WS 完全不可达：收口影子终态（照 create_session 失败收敛语义），
            # 成员置 failed——下次触发按重建路径重试（上方幂等分支放行重建）。
            log.warning(
                "group_shadow_dispatch_wake_failed",
                group_id=str(group.id),
                member_id=str(member.id),
                shadow_session_id=str(shadow_id),
            )
            try:
                fresh_shadow = await self._session.get(AgentSession, shadow_id)
                fresh_run = await self._session.get(AgentRun, first_run.id)
                fresh_member = await self._session.get(AgentGroupMember, member.id)
                if fresh_shadow is not None:
                    fresh_shadow.status = "failed"
                    fresh_shadow.ended_at = datetime.now(UTC)
                    self._session.add(fresh_shadow)
                if fresh_run is not None:
                    fresh_run.status = "failed"
                    fresh_run.finished_at = datetime.now(UTC)
                    fresh_run.error_code = "no_online_daemon"
                    self._session.add(fresh_run)
                if fresh_member is not None:
                    fresh_member.shadow_status = "failed"
                    self._session.add(fresh_member)
                await self._session.commit()
            except Exception:
                await self._session.rollback()
                log.warning(
                    "group_shadow_failed_convergence_error", shadow_session_id=str(shadow_id)
                )
            from app.modules.daemon.session.service import DaemonRuntimeOffline

            raise DaemonRuntimeOffline(
                f"成员「{member.display_name}」的执行机器当前不在线，本轮未能触发；"
                "消息已进群时间线，请稍后重试。",
                details={
                    "runtime_id": str(dispatch.runtime_id),
                    "session_id": str(shadow_id),
                    "member_id": str(member.id),
                },
            )

        # 首轮 SESSION_INJECT（照 create_session :2080-2127）：readiness 等待后
        # 控制指令三段式下发（WS 失败落库 pending 待补拉；lease metadata prompt
        # 为 daemon 侧兜底，不失败）。
        await self._send_shadow_first_inject(
            shadow_id=shadow_id,
            lease_id=dispatch.lease_id,
            run_id=first_run.id,
            prompt=first_prompt,
            claim_token=dispatch.claim_token,
            runtime_id=dispatch.runtime_id,
        )
        await _publish_group_channel_event(
            shadow_id,
            {"event": "turn_injected", "session_id": str(shadow_id), "run_id": str(first_run.id)},
        )
        return shadow, first_run.id

    async def _send_shadow_first_inject(
        self,
        *,
        shadow_id: uuid.UUID,
        lease_id: uuid.UUID,
        run_id: uuid.UUID,
        prompt: str,
        claim_token: str,
        runtime_id: uuid.UUID,
    ) -> None:
        """首轮 SESSION_INJECT 控制指令下发（照 ``create_session`` 尾段）。

        readiness 等待（daemon 建会话完成再注入，防 ``session_not_found`` 丢
        指令；超时 fallback 仍发——兼容不上报 ready 的旧 daemon）→ 控制指令
        三段式（落库 pending + WS 推送 + delivered 标记）：WS 失败保留 pending
        待 daemon 补拉，**不让首轮触发整体失败**（lease metadata prompt 是
        daemon 侧兜底）。函数级 import 保持 patch 面与 session/service 一致
        （测试 mock ``get_session_readiness`` 于源模块生效）。
        """
        from app.modules.daemon.control_commands import (
            KIND_SESSION_INJECT,
            ControlCommandService,
        )
        from app.modules.daemon.session.service import (
            _resolve_daemon_id_for_runtime,
            get_session_readiness,
        )

        ready = await get_session_readiness().wait(shadow_id, timeout=8)
        if not ready:
            log.warning("group_shadow_ready_timeout", shadow_session_id=str(shadow_id))
        daemon_id = await _resolve_daemon_id_for_runtime(self._session, runtime_id)
        if daemon_id is None:
            log.warning(
                "group_shadow_inject_no_daemon",
                shadow_session_id=str(shadow_id),
                runtime_id=str(runtime_id),
            )
            return
        _row, control_ok = await ControlCommandService(self._session).enqueue_and_push(
            daemon_id=daemon_id,
            runtime_id=runtime_id,
            kind=KIND_SESSION_INJECT,
            payload={
                "session_id": str(shadow_id),
                "lease_id": str(lease_id),
                "run_id": str(run_id),
                "prompt": prompt,
                "claim_token": claim_token,
                "runtime_id": str(runtime_id),  # design §5.3 provider discriminator
            },
        )
        if not control_ok:
            log.warning(
                "group_shadow_inject_control_pending",
                shadow_session_id=str(shadow_id),
                run_id=str(run_id),
            )

    # ── typing / 列表信号（task-06，design §5.4 / §5.3）──────────────────────

    async def publish_typing(
        self,
        group_id: uuid.UUID,
        user: User,
        *,
        typing: bool,
        preview: str | None,
    ) -> None:
        """typing 心跳（``POST /group-chats/{id}/typing``，design §5.4 typing.ping）。

        成员校验后直接 publish（节流由前端做——250ms 间隔 + 前端 TTL 2.5s
        自动过期）；**不落库、不进 AI 上下文、不进群背景摘要**（纯 ephemeral，
        Redis pub/sub 即发即忘，无 key 无 TTL 无存储）。preview 服务端再裁
        400 字（DTO 侧已限长，双保险防超长帧）。
        """
        group = await self._get_group(group_id)
        membership = await self._require_group_member(group, user)
        sender_member_name = (
            membership.display_name if membership is not None else _user_display_name(user)
        )
        await _publish_group_typing_event(
            group.id,
            _typing_payload(
                member_name=sender_member_name,
                member_kind="user",
                typing=typing,
                preview=preview,
            ),
        )

    async def _publish_group_sessions_changed(
        self, group: AgentGroupChat, event: SessionChangeEvent
    ) -> None:
        """群事件广播（task-06，design §5.3 audience 投影）。

        payload 内嵌全部**未移除**用户成员 id（``audience_user_ids``，订阅侧
        ``_stream_sessions_events`` 过滤「user_id 命中或 in audience」免查库）；
        ``user_id`` 位填群主（群会话属主，群事件对其恒可见）。发布失败由
        ``publish_sessions_changed`` 自吞（warning 不抛）。
        """
        rows = await self._list_active_member_rows(group.id)
        audience = [m.user_id for m in rows if m.member_type == "user" and m.user_id is not None]
        await publish_sessions_changed(
            event, group.session_id, group.created_by, audience_user_ids=audience
        )


# ── config_snapshot 组装（成员列表 chips 免 N+1，design §3.3）─────────────────


def _build_config_snapshot(
    *,
    runtime: DaemonRuntime,
    instance: DaemonInstance | None,
    provider: str,
    profile: object | None,
    llm: object | None,
) -> dict:
    """agent 成员六要素冗余快照（machine_name/engine/model/profile_name 等）。

    ``profile`` / ``llm`` 参数化 object 防循环 import（调用方就近 import 的
    AgentProfile/LlmProvider 行）；仅取 name 展示字段。
    """
    machine_name = None
    if instance is not None:
        machine_name = instance.display_alias or instance.hostname
    if machine_name is None:
        machine_name = runtime.name or None
    snapshot: dict = {
        "machine_name": machine_name,
        "engine": provider,
        "runtime_id": str(runtime.id),
    }
    if profile is not None:
        snapshot["profile_name"] = getattr(profile, "name", None)
    if llm is not None:
        snapshot["model"] = getattr(llm, "name", None)
    return snapshot


async def _rebuild_config_snapshot(db: AsyncSession, member: AgentGroupMember) -> dict:
    """六要素变更后按成员行当前值重建快照（update_member 消费）。"""
    from app.modules.agent.profile.model import AgentProfile
    from app.modules.llm_provider.model import LlmProvider

    runtime: DaemonRuntime | None = None
    instance: DaemonInstance | None = None
    if member.runtime_id is not None:
        row = (
            await db.execute(
                select(DaemonRuntime, DaemonInstance)
                .join(
                    DaemonInstance,
                    DaemonRuntime.daemon_instance_id == DaemonInstance.id,
                    isouter=True,
                )
                .where(DaemonRuntime.id == member.runtime_id)
            )
        ).first()
        if row is not None:
            runtime, instance = row[0], row[1]
    profile = (
        await db.get(AgentProfile, member.agent_profile_id)
        if member.agent_profile_id is not None
        else None
    )
    llm = (
        await db.get(LlmProvider, member.llm_provider_id)
        if member.llm_provider_id is not None
        else None
    )
    base = (member.config_snapshot or {}).copy()
    if runtime is None:
        base.pop("machine_name", None)
        base.pop("runtime_id", None)
        base["engine"] = member.provider
        return base
    fresh = _build_config_snapshot(
        runtime=runtime,
        instance=instance,
        provider=member.provider or (member.config_snapshot or {}).get("engine") or "",
        profile=profile,
        llm=llm,
    )
    # workspace 锚变更同步进快照（chips 展示「工作区」维度时免查库）。
    if member.workspace_id is not None:
        fresh["workspace_id"] = str(member.workspace_id)
    return fresh
