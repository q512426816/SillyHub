"""group 子域读模型（task-09 拆分，ql-20260903-024 批量口径）。

群列表三连读模型（最后消息摘要 / 未读数 / 最近 @我，窗口函数批量）——行源
``user_input + 投影行`` 单源（``_timeline_row_source``）。``GROUP_LAST_MENTION_
SCAN_ROWS`` 定义于此并经包 ``__init__`` 重导出；**读取点经 ``_gsvc.`` 延迟
解析**（D-007：test_group_p2.py 别名 setattr 本命名空间常量继续生效）。
"""

from __future__ import annotations

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import (
    DateTime,
    Uuid,
    and_,
    func,
    literal,
    or_,
    select,
    union_all,
)
from sqlalchemy.ext.asyncio import AsyncSession

import app.modules.daemon.group.service as _gsvc
from app.modules.agent.model import AgentGroupMember, AgentRun, AgentRunLog

from .mentions import _MENTION_TOKEN_RE, _mention_match

# 群列表最后消息摘要长度（task-03 接通 task-02 占位字段）。
GROUP_LAST_MESSAGE_PREVIEW_CHARS = 60
# 群列表「最近 @我」扫描行数（群聊体验 quick 2026-09-02：最近时间线内找最新 @）。
# quick 群 P2（2026-09-02）20 → 200：活跃群消息很快把 @ 挤出 20 行窗口（被 @ 后
# 群里聊几十条，列表侧「最近 @我」就丢了）——扩到 200 行覆盖日常活跃度；查询
# limit 与本常量同源联动（get_last_mention_previews 单处消费）。
GROUP_LAST_MENTION_SCAN_ROWS = 200


def _timeline_row_source():
    """群时间线行源（user_input + 投影行，design §4.2）——三个列表数据族共用。"""
    return or_(
        AgentRunLog.channel == "user_input",
        and_(
            AgentRunLog.channel == "stdout",
            AgentRunLog.metadata_.is_not(None),
        ),
    )


async def _get_active_memberships(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    group_ids: Sequence[uuid.UUID],
) -> dict[uuid.UUID, AgentGroupMember]:
    """批量取用户在各群的未移除用户成员行（ql-20260903-024，IN 单查）。"""
    if not group_ids:
        return {}
    rows = (
        (
            await db.execute(
                select(AgentGroupMember).where(
                    AgentGroupMember.group_id.in_(group_ids),
                    AgentGroupMember.member_type == "user",
                    AgentGroupMember.user_id == user_id,
                    AgentGroupMember.removed_at.is_(None),
                )
            )
        )
        .scalars()
        .all()
    )
    return {row.group_id: row for row in rows}


async def get_last_message_previews(
    db: AsyncSession, group_ids: Sequence[uuid.UUID]
) -> dict[uuid.UUID, tuple[str | None, datetime | None]]:
    """群列表最后消息摘要 + 最新消息时间（task-02 占位字段接通，task-03）。

    每群时间线最新一行（user_input / 投影行同 §4.2 行源），取内容前 60 字
    与行 ts（群 P2 第二波：``last_message_at`` 未读排序数据源，无消息 None）。
    群 id == 群会话 id（§3.2 不变式）。

    ql-20260903-024：原逐群 LIMIT 1 查询改**窗口函数批量**——
    ``row_number() over (partition by 会话 order by ts desc, id desc) = 1``
    一查取全部群的首行（SQLite ≥3.25 / PG 均支持）。ts 统一 UTC 感知
    （SQLite 方言往返丢 tz、PG 保留——归一后跨方言一致）。
    """
    if not group_ids:
        return {}
    ranked = (
        select(
            AgentRun.agent_session_id.label("session_id"),
            AgentRunLog.content_redacted.label("content"),
            AgentRunLog.timestamp.label("ts"),
            func.row_number()
            .over(
                partition_by=AgentRun.agent_session_id,
                order_by=(AgentRunLog.timestamp.desc(), AgentRunLog.id.desc()),
            )
            .label("rn"),
        )
        .join(AgentRun, AgentRunLog.run_id == AgentRun.id)
        .where(
            AgentRun.agent_session_id.in_(group_ids),
            _timeline_row_source(),
        )
        .subquery()
    )
    rows = (
        await db.execute(
            select(ranked.c.session_id, ranked.c.content, ranked.c.ts).where(ranked.c.rn == 1)
        )
    ).all()
    previews: dict[uuid.UUID, tuple[str | None, datetime | None]] = {
        gid: (None, None) for gid in group_ids
    }
    for session_id, content, ts in rows:
        text = (content or "").strip()
        if ts is not None and ts.tzinfo is None:
            ts = ts.replace(tzinfo=UTC)
        previews[session_id] = (text[:GROUP_LAST_MESSAGE_PREVIEW_CHARS] or None, ts)
    return previews


# 未读数显示上限（群 P2 第二波：``unread_count`` cap 99，前端「99+」展示）。
GROUP_UNREAD_DISPLAY_CAP = 99


async def get_group_unread_counts(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    group_ids: Sequence[uuid.UUID],
) -> dict[uuid.UUID, int]:
    """群未读数（请求成员视角，群 P2 第二波未读位点）。

    本成员 ``last_read_at`` 为 NULL（从未标记已读）→ 全部时间线行数；否则
    ``ts > last_read_at`` 的行数。行源同 ``get_last_message_previews``
    （user_input + 投影行，design §4.2）；发送即已读由 ``send_group_message``
    推进发送者位点保证（自己发的不计未读）。非成员群不出现在请求者列表，
    admin 兜底视角（无成员行）无位点语义 → 0。计数 cap
    ``GROUP_UNREAD_DISPLAY_CAP``（99+ 展示语义）。

    ql-20260903-024：原逐群两查（成员行 + count）改两步批量——成员行
    ``_get_active_memberships`` 单查；计数走阈值表 JOIN
    （``ts IS NULL（未读位） OR _gsvc.log.timestamp > 阈值``）+ GROUP BY 一查取
    全部群。阈值表用 UNION ALL 子查询构造（``VALUES ... AS t (a, b)`` 的
    列名列表是 PG 语法，SQLite 不支持——UNION ALL 双方言可移植）。
    """
    if not group_ids:
        return {}
    memberships = await _get_active_memberships(db, user_id=user_id, group_ids=group_ids)
    counts: dict[uuid.UUID, int] = {gid: 0 for gid in group_ids}
    threshold_rows = []
    for gid, membership in memberships.items():
        last_read = membership.last_read_at
        if last_read is not None and last_read.tzinfo is None:
            # SQLite 方言往返丢 tz（与读侧归一同款），补 UTC 后再比较。
            last_read = last_read.replace(tzinfo=UTC)
        threshold_rows.append((gid, last_read))
    if not threshold_rows:
        return counts
    selects = [
        select(
            literal(gid, Uuid(as_uuid=True)).label("sid"),
            literal(ts, DateTime(timezone=True)).label("ts"),
        )
        for gid, ts in threshold_rows
    ]
    threshold_cte = selects[0] if len(selects) == 1 else union_all(*selects)
    threshold_table = threshold_cte.subquery()
    stmt = (
        select(AgentRun.agent_session_id, func.count())
        .select_from(AgentRunLog)
        .join(AgentRun, AgentRunLog.run_id == AgentRun.id)
        .join(
            threshold_table,
            AgentRun.agent_session_id == threshold_table.c.sid,
        )
        .where(
            _timeline_row_source(),
            or_(
                threshold_table.c.ts.is_(None),
                AgentRunLog.timestamp > threshold_table.c.ts,
            ),
        )
        .group_by(AgentRun.agent_session_id)
    )
    rows = (await db.execute(stmt)).all()
    for session_id, total in rows:
        counts[session_id] = min(int(total), GROUP_UNREAD_DISPLAY_CAP)
    return counts


async def get_last_mention_previews(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    group_ids: Sequence[uuid.UUID],
) -> dict[uuid.UUID, dict[str, str] | None]:
    """群列表「最近 @我」摘要（群聊体验 quick，2026-09-02）。

    每群取时间线最近 ``GROUP_LAST_MENTION_SCAN_ROWS`` 条（行源同
    ``get_last_message_previews``：user_input + 投影行，design §4.2），按
    ``_parse_group_mentions`` 同口径（``_MENTION_TOKEN_RE`` 候选提取 +
    ``_mention_match`` 边界匹配——``@小码，`` 命中、``@小码二号`` 不误命中
    ``小码``）判定是否 @请求用户：匹配词 = 请求用户在该群成员表的
    ``display_name``（非成员/已移除跳过，返回 None）。取最新命中一条，返回
    ``{content(截 60 字), ts, member_name}``——member_name 为 @ 发起者身份
    标签（用户行 = ``metadata_.sender_member_name``，投影行 =
    ``metadata_.member_name``，缺失回退「成员」）。

    ql-20260903-024：原逐群两查（成员昵称 + 时间线扫描）改批量——昵称
    ``_get_active_memberships`` 单查；时间线窗口函数
    ``row_number() over (partition by 会话 order by ts desc, id desc) <= N``
    一查取全部群的扫描窗口，Python 侧按组内新→旧序找首个 @命中。
    """
    if not group_ids:
        return {}
    memberships = await _get_active_memberships(db, user_id=user_id, group_ids=group_ids)
    previews: dict[uuid.UUID, dict[str, str] | None] = {gid: None for gid in group_ids}
    if not memberships:
        return previews
    names_by_group = {gid: m.display_name for gid, m in memberships.items()}
    ranked = (
        select(
            AgentRun.agent_session_id.label("session_id"),
            AgentRunLog.content_redacted.label("content"),
            AgentRunLog.metadata_.label("meta"),
            AgentRunLog.channel.label("channel"),
            AgentRunLog.timestamp.label("ts"),
            func.row_number()
            .over(
                partition_by=AgentRun.agent_session_id,
                order_by=(AgentRunLog.timestamp.desc(), AgentRunLog.id.desc()),
            )
            .label("rn"),
        )
        .join(AgentRun, AgentRunLog.run_id == AgentRun.id)
        .where(
            AgentRun.agent_session_id.in_(list(names_by_group.keys())),
            _timeline_row_source(),
        )
        .subquery()
    )
    rows = (
        await db.execute(
            select(
                ranked.c.session_id,
                ranked.c.content,
                ranked.c.meta,
                ranked.c.channel,
                ranked.c.ts,
            )
            .where(ranked.c.rn <= _gsvc.GROUP_LAST_MENTION_SCAN_ROWS)
            .order_by(ranked.c.session_id, ranked.c.rn)
        )
    ).all()
    # 按组聚合（组内 rn 升序 = 新→旧，与原逐群 desc 扫描序一致）。
    by_group: dict[uuid.UUID, list[tuple[object, object, str, datetime]]] = {}
    for session_id, content, meta, channel, ts in rows:
        by_group.setdefault(session_id, []).append((content, meta, channel, ts))
    for gid, name in names_by_group.items():
        hit = None
        for content, meta, channel, ts in by_group.get(gid, []):
            text = (content or "").strip()
            # 同口径 @判定：只认请求用户自己的昵称（广播词/agent 昵称与「@我」无关）。
            if text and any(
                _mention_match(m.group(1), (name,)) for m in _MENTION_TOKEN_RE.finditer(text)
            ):
                hit = (content, meta or {}, channel, ts)
                break
        if hit is None:
            continue
        content, meta, channel, hit_ts = hit
        member_name = (
            meta.get("sender_member_name") if channel == "user_input" else meta.get("member_name")
        )
        # ts 统一 UTC 感知格式（SQLite 方言往返丢 tz、PG 保留——归一后跨方言一致）。
        if hit_ts is not None and hit_ts.tzinfo is None:
            hit_ts = hit_ts.replace(tzinfo=UTC)
        previews[gid] = {
            "content": (content or "").strip()[:GROUP_LAST_MESSAGE_PREVIEW_CHARS],
            "ts": hit_ts.isoformat(),
            "member_name": member_name or "成员",
        }
    return previews
