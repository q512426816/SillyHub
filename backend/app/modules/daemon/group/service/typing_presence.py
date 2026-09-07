"""group 子域实时通道与群频道发布层（task-09 拆分，task-06 design §5.4）。

typing / presence 纯 ephemeral Redis 层（频道命名单源 / payload 组装 / SCAN
在线集批量读取）+ 群频道 publish helper 收敛点（``_publish_group_channel_event``
与 typing/presence 五个发布入口——task-11 event_publish 统一的收敛基线）+
群频道系统提示行（限频 / 打断 / 触发失败通知）+ ``publish_typing`` 服务
方法体下沉。

D-007：get_redis 为本命名空间 patch 目标（18 处），一律 ``_gsvc.get_redis()``
延迟解析；log 经 ``_gsvc.log`` 保持原模块 logger 身份。
"""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from redis.asyncio import Redis

import app.modules.daemon.group.service as _gsvc
from app.core.errors import AppError
from app.modules.agent.model import AgentGroupChat
from app.modules.auth.model import User
from app.modules.daemon.session_events import (
    SessionChangeEvent,
    publish_sessions_changed,
)

from .helpers import _user_display_name
from .settings import _group_typing_preview_enabled

# 触发失败原因摘要截断长度（triggered[].error + 群频道系统行共用——异常 message
# 可能很长，系统行保持一行可读）。
GROUP_TRIGGER_FAIL_REASON_MAX_CHARS = 120


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


async def _publish_member_interrupted_notice(
    group: AgentGroupChat, *, member_name: str, interrupter_name: str
) -> None:
    """成员任务被打断的群内系统提示行（quick 群 P1 member.interrupted）。

    形态照 ``_publish_rate_limit_notice`` 先例（``channel='system'`` ephemeral，
    不落库——时间线正文只承载对话内容，打断信号走频道实时流 + 响应 DTO）。
    """
    await _publish_group_channel_event(
        group.session_id,
        {
            "event": "log",
            "session_id": str(group.session_id),
            "channel": "system",
            "content": f"{member_name} 的当前任务已被 {interrupter_name} 打断",
            "timestamp": datetime.now(UTC).isoformat(),
        },
    )


def _trigger_failure_reason(exc: AppError) -> str:
    """触发失败异常 → 中文原因摘要（quick 群 P2：系统行 + ``triggered[].error``）。

    code 优先映射机器可判的失败族（会话闸满/队列满/机器离线——这类异常的
    message 面向 HTTP 错误响应，直接进系统行过长且带操作指引重复）；未命中
    映射的（如群错误族 GroupChatInvalid 的引擎门控/机器不可用）message 本就
    是中文用户文案，剥掉头部的「成员「X」的」身份前缀（系统行/DTO 已携带
    成员身份，重复啰嗦）后截 ``GROUP_TRIGGER_FAIL_REASON_MAX_CHARS`` 直用。
    """
    code = (exc.code or "").upper()
    if "SESSION_LIMIT" in code:
        return "机器会话数已达上限，请稍后再试"
    if code == "HTTP_409_DAEMON_SESSION_QUEUE_FULL":
        return "成员排队消息已满，请稍后再试"
    if code == "HTTP_504_DAEMON_RUNTIME_OFFLINE":
        return "执行机器当前不在线"
    message = (getattr(exc, "message", "") or "").strip()
    if message:
        message = re.sub(r"^成员「[^」]*」的?", "", message).strip()
    if message:
        return message[:GROUP_TRIGGER_FAIL_REASON_MAX_CHARS]
    return "触发失败，请稍后再试"


async def _publish_trigger_failed_notice(
    group_session_id: uuid.UUID, *, member_name: str, reason: str
) -> None:
    """成员触发失败的群内系统提示行（quick 群 P2）。

    只对「消息已落时间线但成员没跑起来」的用户可感沉默场景发（``send_group_
    message`` 逐成员触发捕获 AppError 的调用点）——形态照 ``_publish_rate_
    limit_notice`` 先例（``channel='system'`` ephemeral 不落库，实时流提示 +
    响应 DTO ``triggered[].error`` 双通道）。传**群会话 id 标量**而非群行：
    调用点处于触发失败子链 rollback 之后，群 ORM 行已 expire（过期属性 lazy
    IO 在 greenlet 外炸 MissingGreenlet——update_member「先取标量」先例）。
    """
    await _publish_group_channel_event(
        group_session_id,
        {
            "event": "log",
            "session_id": str(group_session_id),
            "channel": "system",
            "content": f"成员「{member_name}」触发失败：{reason}",
            "timestamp": datetime.now(UTC).isoformat(),
        },
    )


async def _publish_group_channel_event(session_id: uuid.UUID, payload: dict[str, object]) -> None:
    """publish 群频道 ``agent_session:{session_id}``（复用现有 SSE 频道，§5.4）。

    容错语义对齐 ``session/service._publish_session_event``：Redis 抖动仅
    warning，不阻断消息落库/触发主链路。
    """
    try:
        redis = _gsvc.get_redis()
        await redis.publish(f"agent_session:{session_id}", json.dumps(payload, default=str))
    except Exception:
        _gsvc.log.warning(
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


def group_presence_key(
    group_id: uuid.UUID,
    user_id: uuid.UUID,
    conn_token: str | None = None,
) -> str:
    """群在线 presence key（``group_presence:{group_id}:{user_id}[:{conn}]``，§5.4）。

    命名单源：daemon/router.py 群 SSE 分支与测试都经本函数构造；TTL/续期间隔
    常量在 agent/service.py（touch 执行方）。连接级后缀（群在线实时化 quick，
    2026-09-04）：同用户多标签页/多端各连一条 SSE、各自 touch 自己的连接 key
    ——断连即删本连接 key（``release_member_presence``），互不误伤；在线判定 =
    该用户任一连接 key 存活。旧两段 key（无 conn）由 bulk 读取兼容解析（部署
    窗口残留 ≤60s 由 TTL 自愈）。
    """
    key = f"group_presence:{group_id}:{user_id}"
    return f"{key}:{conn_token}" if conn_token else key


async def _publish_group_typing_event(group_id: uuid.UUID, payload: dict[str, object]) -> None:
    """publish typing 频道 ``group_typing:{group_id}``（即发即忘，无存储）。

    容错语义同 ``_publish_group_channel_event``：Redis 抖动仅 warning——
    typing 是纯增益信号（前端 TTL 自动过期），不阻断调用方主链路。
    """
    try:
        redis = _gsvc.get_redis()
        await redis.publish(group_typing_channel(group_id), json.dumps(payload, default=str))
    except Exception:
        _gsvc.log.warning(
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
    member_id: str | None = None,
    reply_to_log_id: str | None = None,
) -> dict[str, object]:
    """typing 事件 payload 组装（design §5.4 / §8 typing.ping，单一形态）。

    ``member_id``（群聊运行态可见 quick，2026-09-02）：成员行 id——前端 typing
    指示器按成员身份聚合/去重（agent 自动事件与终态止息恒携带）；用户手动
    typing 心跳不携带（payload 形态与历史一致，前端按 member_kind 区分）。
    ``reply_to_log_id``：触发消息的群时间线 ``user_input`` 行 id——即
    「agent 正在响应哪句话」的回复锚点（前端可高亮对应消息气泡）；仅 None
    缺省，两字段都按需附加（用户 typing 事件零形态漂移）。
    """
    payload: dict[str, object] = {
        "event": "typing",
        "member_name": member_name,
        "member_kind": member_kind,
        "typing": typing,
        "preview": preview[:GROUP_TYPING_PREVIEW_MAX_CHARS] if preview else None,
        "ts": datetime.now(UTC).isoformat(),
    }
    if member_id is not None:
        payload["member_id"] = member_id
    if reply_to_log_id is not None:
        payload["reply_to_log_id"] = reply_to_log_id
    return payload


async def _publish_agent_typing_event(
    group_id: uuid.UUID,
    member_name: str,
    *,
    member_id: str | None = None,
    reply_to_log_id: str | None = None,
) -> None:
    """agent 成员 typing 自动事件（「{member_name}」正在输入…，design §5.4）。

    影子 run 开始路径（``send_group_message`` 触发编排尾部 / 互@触发命中）调用
    ——成员昵称即面板/气泡展示名；preview 恒 None（后端不产草稿）。
    ``member_id``/``reply_to_log_id`` 见 ``_typing_payload``（触发消息行 id 即
    回复锚点；互@路径触发源是 agent 投影行而非 user_input 行，锚点传 None）。
    """
    await _publish_group_typing_event(
        group_id,
        _typing_payload(
            member_name=member_name,
            member_kind="agent",
            typing=True,
            preview=None,
            member_id=member_id,
            reply_to_log_id=reply_to_log_id,
        ),
    )


def _presence_payload(*, user_id: uuid.UUID, online: bool) -> dict[str, object]:
    """presence 事件 payload 组装（群在线实时化 quick，2026-09-04）。

    ``event='presence'`` 与 typing 帧同走群实时频道（``group_typing:{gid}``）
    合流下发；前端按 ``user_id`` 即时覆盖在线绿点。pub/sub 即发即忘不回放
    ——断线重连端靠列表快照重拉对账（前端覆盖层同点作废）。
    """
    return {
        "event": "presence",
        "user_id": str(user_id),
        "online": online,
        "ts": datetime.now(UTC).isoformat(),
    }


async def publish_member_presence(
    group_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    online: bool,
) -> None:
    """publish 群实时频道 presence 事件（上/下线即时通知）。

    容错语义同 ``_publish_group_typing_event``：Redis 抖动仅 warning，不阻断
    调用方（presence 是纯增益信号，列表快照 + 60s TTL 心跳兜底）。
    """
    await _publish_group_typing_event(group_id, _presence_payload(user_id=user_id, online=online))


async def _scan_matching_keys(redis: Redis, match: str) -> list[str]:
    """SCAN 游标分批收集匹配 key（presence 剩余连接探测；count=100 批扫）。"""
    out: list[str] = []
    cursor: int | str = 0
    while True:
        cursor, batch = await redis.scan(cursor=cursor, match=match, count=100)
        out.extend(batch or [])
        if int(cursor) == 0:
            return out


async def release_member_presence(
    group_id: uuid.UUID,
    user_id: uuid.UUID,
    conn_key: str,
) -> None:
    """SSE 连接退出收口（群在线实时化 quick，2026-09-04）。

    删本连接 presence key（**即时**熄灯——不等 60s TTL 自然过期）；再 SCAN 该
    用户剩余连接级 key：还有其它标签页/端在群 → 不发 offline（多连接互不
    误伤）；全部退出 → publish offline 事件。Redis 故障降级：key 由 TTL 60s
    自愈、事件丢失由列表快照刷新兜底（绿点容忍）。
    """
    try:
        redis = _gsvc.get_redis()
        await redis.delete(conn_key)
        remaining = await _scan_matching_keys(redis, f"group_presence:{group_id}:{user_id}:*")
        if not remaining:
            await _publish_group_typing_event(
                group_id, _presence_payload(user_id=user_id, online=False)
            )
    except Exception:
        _gsvc.log.warning(
            "group_presence_release_failed",
            group_id=str(group_id),
            user_id=str(user_id),
            exc_info=True,
        )


async def get_online_member_ids_bulk(
    group_ids: Sequence[uuid.UUID],
) -> dict[uuid.UUID, list[uuid.UUID]]:
    """批量读群在线用户成员集（ql-20260903-024）。

    原 ``get_online_member_ids`` 逐群各跑一次 ``SCAN``——SCAN 的 MATCH 只是
    服务端过滤，游标仍要遍历整个键空间，N 群 = N 次全库扫描（群列表端点
    50 群即 50 次）。本函数一次 ``SCAN group_presence:*`` 按
    ``group_presence:{gid}:{uid}`` 分桶回填，仅返回请求集合内的群。

    key 契约/降级语义同单群版：SCAN 期间键集变化由下轮 presence 刷新 + 60s
    TTL 心跳自愈（在线绿点容忍）；Redis 不可用返回各组空列表（降级全灰）。
    """
    online_sets: dict[uuid.UUID, set[uuid.UUID]] = {gid: set() for gid in group_ids}
    if not group_ids:
        return {gid: [] for gid in group_ids}
    wanted = set(group_ids)
    prefix = "group_presence:"
    try:
        redis = _gsvc.get_redis()
        cursor: int | str = 0
        while True:
            cursor, batch = await redis.scan(cursor=cursor, match=f"{prefix}*", count=100)
            for key in batch or []:
                raw = key[len(prefix) :] if isinstance(key, str) else ""
                gid_str, sep, rest = raw.partition(":")
                if not sep:
                    continue
                # 连接级 key（群在线实时化 quick）：group_presence:{gid}:{uid}:{conn}
                # ——第三段是连接 token，剥掉取 uid；旧两段 key（无 conn）rest 即
                # uid。同用户多连接（多标签页）只计一次（set 去重）。
                uid_str = rest.partition(":")[0]
                try:
                    gid = uuid.UUID(gid_str)
                    uid = uuid.UUID(uid_str)
                except (ValueError, AttributeError):
                    continue  # 脏 key（截断/残留）跳过，不炸列表
                if gid in wanted:
                    online_sets[gid].add(uid)
            if int(cursor) == 0:
                break
    except Exception:
        _gsvc.log.warning("group_presence_bulk_read_failed", exc_info=True)
    return {gid: sorted(uids) for gid, uids in online_sets.items()}


async def get_online_member_ids(group_id: uuid.UUID) -> list[uuid.UUID]:
    """读群在线用户成员 id 集（``group_presence:{group_id}:*`` keys，§5.4）。

    key 由群 SSE 生成器循环 touch（TTL 60s）——活跃 key 即在线成员。规模上界
    = 用户成员上限 50（design §9.3）。quick 群 P1 审计（2026-09-02）：原
    ``KEYS`` 前缀扫是 O(全库) 阻塞命令（单线程 Redis 上会卡住所有其它命令），
    换 ``SCAN`` 游标分批（每批 100）增量迭代——SCAN 期间键集可能变化（漏报/
    重报由下一轮 presence 刷新 + 60s TTL 心跳自愈，在线绿点容忍）。
    Redis 不可用返回空列表（在线绿点降级为全灰，不阻断列表/详情）。
    ql-20260903-024：单群详情路径委托 bulk 版（单群成本等价）。
    """
    return (await get_online_member_ids_bulk([group_id])).get(group_id, [])


# ── GroupChatService 方法体下沉（第一参数 svc = service 实例，self→svc）───

# ── typing / 列表信号（task-06，design §5.4 / §5.3）──────────────────────


async def publish_typing(
    svc,
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

    quick 群 P2（2026-09-02）草稿预览默认关：群级 ``settings_json.
    typing_preview``（默认 False）关闭时入参 ``preview`` 强制丢弃（payload
    preview=None——只显示「正在输入」不发草稿，隐私从简）；显式 True 才
    透传（仍走 400 字裁剪）。
    """
    group = await svc._get_group(group_id)
    membership = await svc._require_group_member(group, user)
    sender_member_name = (
        membership.display_name if membership is not None else _user_display_name(user)
    )
    if not _group_typing_preview_enabled(group):
        preview = None  # 群级默认关：入参草稿丢弃（只显示「正在输入」）。
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
    svc, group: AgentGroupChat, event: SessionChangeEvent
) -> None:
    """群事件广播（task-06，design §5.3 audience 投影）。

    payload 内嵌全部**未移除**用户成员 id（``audience_user_ids``，订阅侧
    ``_stream_sessions_events`` 过滤「user_id 命中或 in audience」免查库）；
    ``user_id`` 位填群主（群会话属主，群事件对其恒可见）。发布失败由
    ``publish_sessions_changed`` 自吞（warning 不抛）。
    """
    rows = await svc._list_active_member_rows(group.id)
    audience = [m.user_id for m in rows if m.member_type == "user" and m.user_id is not None]
    await publish_sessions_changed(
        event, group.session_id, group.created_by, audience_user_ids=audience
    )
