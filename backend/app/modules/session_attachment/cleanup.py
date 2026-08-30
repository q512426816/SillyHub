"""会话附件草稿清理（task-08，FR-8 / D-5）。

48h 未发送的草稿（session_id NULL）行定期删除；**只删行不删对象**（D-5：
内容寻址对象可能被多行共享，V1 孤儿对象由存储配额兜底——accepted risk）。

挂载：main.py lifespan（启动先跑一次 + 每小时循环，对齐 event_loop_watchdog
后台任务先例；lease expiry batch 无生产周期调用方，故不挂 DaemonService）。
"""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from sqlmodel import col

from app.core.logging import get_logger
from app.modules.session_attachment.model import SessionAttachment

log = get_logger(__name__)

DRAFT_TTL = timedelta(hours=48)
CLEANUP_INTERVAL_S = 3600  # 每小时一轮
_BATCH_LIMIT = 200  # 单轮有界（对齐 lease expire limit 模式）


async def cleanup_expired_draft_attachments(
    session_factory: async_sessionmaker[AsyncSession],
) -> int:
    """删除过期草稿行，返回删除数（session_factory = get_session_factory()）。

    批量上限经 ``id IN (SELECT ... LIMIT n)`` 子查询实现（2026-08-24 会话审查
    P3）：SQLAlchemy Core ``Delete`` 无 ``.limit()``（且 PG 无 DELETE LIMIT），
    旧写法每小时必抛 AttributeError 被 ``_run_forever`` 吞掉，草稿从未清过。

    形参注解为 async_sessionmaker（工厂实例）——修前 main.py 传了
    get_session_factory 函数本身，``async with session_factory()`` 拿到
    async_sessionmaker 抛 TypeError，清理每轮必败（11c17b36 引入）。
    """
    cutoff = datetime.now(UTC) - DRAFT_TTL
    async with session_factory() as session:
        result = await session.execute(
            delete(SessionAttachment).where(
                col(SessionAttachment.id).in_(
                    select(SessionAttachment.id)
                    .where(
                        SessionAttachment.session_id.is_(None),
                        SessionAttachment.created_at < cutoff,
                    )
                    .limit(_BATCH_LIMIT)
                )
            )
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


async def _run_forever(session_factory: async_sessionmaker[AsyncSession]) -> None:
    while True:
        try:
            await cleanup_expired_draft_attachments(session_factory)
        except Exception as exc:
            log.warning("session_attachment.cleanup_failed", error=str(exc))
        await asyncio.sleep(CLEANUP_INTERVAL_S)


def start_draft_cleanup_task(
    session_factory: async_sessionmaker[AsyncSession],
) -> asyncio.Task:
    """lifespan startup 调：启动先跑一轮再进入小时循环（watchdog 同款）。"""
    if not isinstance(session_factory, async_sessionmaker):
        # 错型 fail-fast：修前 main.py 传 get_session_factory 函数本身，清理
        # 每轮必抛 TypeError 被 _run_forever 吞成 hourly warning，10 天无人觉
        # 察（11c17b36 引入）。mypy arg-type 全局禁用拦不住，此处启动即拒。
        raise TypeError(
            "session_factory 须为 get_session_factory() 返回的 "
            f"async_sessionmaker 实例，got {type(session_factory).__name__!r}"
        )
    return asyncio.create_task(_run_forever(session_factory))
