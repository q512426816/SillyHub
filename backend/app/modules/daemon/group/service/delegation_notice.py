"""公开委派结果轻通知回流（2026-10-15-group-cross-mention-visibility task-03）。

D-004@v2：被委派成员轮（``dm_kind='agent_public'``）收口、投影行进群后，
向**发起方**成员的影子会话追加一条轻通知日志行——

- **纯写日志**：只追加 ``AgentRunLog(channel='user_input')`` 到发起方影子
  会话最近 run，**不建 run、不入会话队列、不派发、不走 prepare_interactive
  _dispatch**（评审 UB-1 定论：``send_direct_message`` 为触发语义，无「只插
  行不触发」对应物，故独立本 helper）；
- **同链通知上限**：同链（载体 run）同发起方成员最多
  ``DELEGATION_NOTICE_LIMIT`` 条（沿同链同成员互@护栏 2 次口径）。计数
  Redis 主轨（链 hash ``notice_count`` 字段，HINCRBY）+ DB 双轨（发起方影子
  会话 user_input 行中 ``metadata.delegation_notice`` 且 ``chain_run_id``
  相同的条数——方言无关的 Python 侧过滤，防 Redis TTL 过期归零，沿链深
  护栏 mentions.py 双轨先例）；Redis 不可用 **fail-open** 放行——通知上限
  是防膨胀软约束非防环红线，与互@护栏的 fail-closed 语义刻意相反；
- **失败静默降级**：任何异常不上抛（投影已达成可见性主目标），仅 structlog
  warning——挂接方（run_sync group_bridge._close_group_hooks）无需再兜。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

import app.modules.daemon.run_sync.service as _rsvc
from app.modules.agent.model import AgentGroupMember, AgentRun, AgentRunLog

from .typing_presence import _publish_group_channel_event

# 同链同发起方成员的通知上限（与互@同链同成员护栏同口径默认 2）。
DELEGATION_NOTICE_LIMIT = 2
# Redis 链 hash 中的通知计数字段（group_chain:{carrier_run_id}）。
DELEGATION_NOTICE_FIELD = "notice_count"


def _log():
    return _rsvc.log


async def _publish_delegation_limit_notice(group_id: uuid.UUID, delegated_member_name: str) -> None:
    """委派回执超限群内系统提示行（FR-04：超限丢弃并出群内系统行）。

    形态照 ``typing_presence._publish_rate_limit_notice`` 先例（channel='system'
    ephemeral 不落库，实时流提示）；publish 容错由 ``_publish_group_channel_event``
    自吞（Redis 抖动仅 warning），本函数不上抛。
    """
    await _publish_group_channel_event(
        group_id,
        {
            "event": "log",
            "session_id": str(group_id),
            "channel": "system",
            "content": (
                f"「{delegated_member_name}」的委派回执本链已达上限，不再重复推送（结果仍见群内）。"
            ),
            "timestamp": datetime.now(UTC).isoformat(),
        },
    )


async def _count_prior_notices(
    db: AsyncSession, *, shadow_session_id: uuid.UUID, carrier_run_id: uuid.UUID
) -> int:
    """DB 双轨计数：发起方影子会话 user_input 行中同链 delegation_notice 条数。

    Python 侧过滤（metadata JSON 内容查询方言差异大；每轮一行 user_input，
    行数小，全取后过滤可接受）。
    """
    rows = (
        await db.execute(
            select(AgentRunLog.metadata_)
            .join(AgentRun, AgentRunLog.run_id == AgentRun.id)
            .where(
                AgentRun.agent_session_id == shadow_session_id,
                AgentRunLog.channel == "user_input",
            )
            .order_by(AgentRunLog.timestamp.desc(), AgentRunLog.id.desc())
            .limit(50)
        )
    ).scalars()
    count = 0
    for meta in rows:
        if not isinstance(meta, dict):
            continue
        if meta.get("delegation_notice") and meta.get("chain_run_id") == str(carrier_run_id):
            count += 1
    return count


async def inject_delegation_notice(
    db: AsyncSession,
    *,
    group_id: uuid.UUID,
    carrier_run_id: uuid.UUID,
    asked_by_member_id: str,
    delegated_member_name: str,
    summary: str | None,
) -> bool:
    """向发起方影子会话追加一条委派回执轻通知行；返回是否落库。

    上限命中（Redis 或 DB 任一双轨达 ``DELEGATION_NOTICE_LIMIT``）、发起方
    成员/影子/最近 run 缺失 → 返回 False；上限命中时补发一条群内系统行
    （FR-04「超限丢弃并出群内系统行」——形态照 ``_publish_rate_limit_notice``
    先例 channel='system' ephemeral；成员缺失静默返回不发）；落库与 Redis
    publish 异常均静默降级（warning），不向调用方上抛。
    """
    try:
        member_uuid = uuid.UUID(asked_by_member_id)
        member_row = (
            await db.execute(select(AgentGroupMember).where(AgentGroupMember.id == member_uuid))
        ).scalar_one_or_none()
        if member_row is None or member_row.shadow_session_id is None:
            return False
        shadow_session_id = member_row.shadow_session_id
        last_run_id = (
            await db.execute(
                select(AgentRun.id)
                .where(AgentRun.agent_session_id == shadow_session_id)
                .order_by(AgentRun.started_at.desc(), AgentRun.id.desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if last_run_id is None:
            return False

        # ── 同链通知上限（Redis 主轨 + DB 双轨）────────────────────────────
        redis_chain_key = f"group_chain:{carrier_run_id}"
        redis_count: int | None = None
        try:
            redis = _rsvc.get_redis()
            redis_count = int(await redis.hincrby(redis_chain_key, DELEGATION_NOTICE_FIELD, 1))
            await redis.expire(redis_chain_key, 30 * 60)
        except Exception:
            redis_count = None  # fail-open：软约束不因 Redis 缺席而阻断
        if redis_count is not None and redis_count > DELEGATION_NOTICE_LIMIT:
            await _publish_delegation_limit_notice(group_id, delegated_member_name)
            return False
        db_count = await _count_prior_notices(
            db, shadow_session_id=shadow_session_id, carrier_run_id=carrier_run_id
        )
        if db_count >= DELEGATION_NOTICE_LIMIT:
            await _publish_delegation_limit_notice(group_id, delegated_member_name)
            return False

        now = datetime.now(UTC)
        notice_text = f"【委派回执】你委派「{delegated_member_name}」的任务已完成，结果已发到群里。"
        if summary:
            notice_text += f"结果摘要：{summary[:120]}"
        notice_id = uuid.uuid4()
        db.add(
            AgentRunLog(
                id=notice_id,
                run_id=last_run_id,
                timestamp=now,
                channel="user_input",
                content_redacted=notice_text,
                dedup_key=None,
                metadata_={
                    "delegation_notice": True,
                    "delegated_member_name": delegated_member_name,
                    "chain_run_id": str(carrier_run_id),
                    "asked_by_member_id": asked_by_member_id,
                },
            )
        )
        await db.commit()
        # 发起方成员会话实时可见（log 事件；失败仅 warning——行已落库可回放）。
        try:
            redis2 = _rsvc.get_redis()
            await redis2.publish(
                f"agent_session:{shadow_session_id}",
                json.dumps(
                    {
                        "event": "log",
                        "session_id": str(shadow_session_id),
                        "run_id": str(last_run_id),
                        "log_id": str(notice_id),
                        "channel": "user_input",
                        "content": notice_text,
                        "timestamp": now.isoformat().replace("+00:00", "Z"),
                        "segment_id": None,
                        "stale": None,
                    },
                    default=str,
                ),
            )
        except Exception:
            _log().warning(
                "delegation_notice_publish_failed",
                shadow_session_id=str(shadow_session_id),
                carrier_run_id=str(carrier_run_id),
            )
        return True
    except Exception:
        _log().warning(
            "delegation_notice_inject_failed",
            carrier_run_id=str(carrier_run_id),
            asked_by_member_id=asked_by_member_id,
            exc_info=True,
        )
        return False
