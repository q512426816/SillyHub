"""会话附件草稿清理（task-08，FR-8 / D-5）。

48h 未发送的草稿（session_id NULL）行定期删除；**只删行不删对象**（D-5：
内容寻址对象可能被多行共享，V1 孤儿对象由存储配额兜底——accepted risk）。

挂载：main.py lifespan（启动先跑一次 + 每小时循环，对齐 event_loop_watchdog
后台任务先例；lease expiry batch 无生产周期调用方，故不挂 DaemonService）。
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete

from app.core.logging import get_logger
from app.modules.session_attachment.model import SessionAttachment

log = get_logger(__name__)

DRAFT_TTL = timedelta(hours=48)
CLEANUP_INTERVAL_S = 3600  # 每小时一轮
_BATCH_LIMIT = 200  # 单轮有界（对齐 lease expire limit 模式）


async def cleanup_expired_draft_attachments(session_factory) -> int:
    """删除过期草稿行，返回删除数（session_factory = get_session_factory()）。"""
    cutoff = datetime.now(UTC) - DRAFT_TTL
    async with session_factory() as session:
        result = await session.execute(
            delete(SessionAttachment)
            .where(
                SessionAttachment.session_id.is_(None),
                SessionAttachment.created_at < cutoff,
            )
            .limit(_BATCH_LIMIT)
        )
        await session.commit()
        deleted = int(getattr(result, "rowcount", 0) or 0)
        if deleted:
            log.info(
                "session_attachment.drafts_cleaned",
                deleted=deleted,
                cutoff=cutoff.isoformat(),
            )
        return deleted


async def _run_forever(session_factory) -> None:
    while True:
        try:
            await cleanup_expired_draft_attachments(session_factory)
        except Exception as exc:
            log.warning("session_attachment.cleanup_failed", error=str(exc))
        await asyncio.sleep(CLEANUP_INTERVAL_S)


def start_draft_cleanup_task(session_factory) -> asyncio.Task:
    """lifespan startup 调：启动先跑一轮再进入小时循环（watchdog 同款）。"""
    return asyncio.create_task(_run_forever(session_factory))
