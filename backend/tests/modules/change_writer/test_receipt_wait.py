"""change_writer 回执等待（pubsub 唤醒 + DB 兜底）测试（ql-20260909-014-e462）。

原实现 0.5s×120 次用请求 session refresh 长轮询，等待全程占请求级连接池槽
（最长 60s）。改 Redis pubsub 即时唤醒 + 短会话低频兜底后，本测试锁定：

- 回执到达（DB 翻终态 + publish）→ 等待方及时返回该行（pubsub 路径）；
- Redis 不可用（subscribe 抛错）→ 退化为 DB 兜底轮询，仍能等到终态；
- 超时 → 翻 failed + error='proxy await timeout' + 抛 ChangeWriteError。

Redis 探测失败的测试环境自动退化为兜底轮询路径覆盖（两条路径代码同构，
pubsub 分支在有 Redis 的环境验证）。
"""

from __future__ import annotations

import asyncio
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.change_writer import proxy
from app.modules.change_writer.service import ChangeWriteError
from app.modules.daemon.model import DaemonChangeWrite


async def _seed_pending(
    session: AsyncSession, *, runtime_id: uuid.UUID | None = None
) -> DaemonChangeWrite:
    cw = DaemonChangeWrite(
        id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        runtime_id=runtime_id or uuid.uuid4(),
        change_key=f"test-{uuid.uuid4().hex[:8]}",
        files=[],
        status="pending",
    )
    session.add(cw)
    await session.commit()
    return cw


async def _flip_terminal(cw_id: uuid.UUID, status: str) -> None:
    """模拟 daemon complete：独立短会话翻终态 + publish（对齐 complete 端点）。"""
    from app.core.db import get_session_factory

    async with get_session_factory()() as db:
        row = await db.get(DaemonChangeWrite, cw_id)
        assert row is not None
        row.status = status
        row.completed_at = None
        db.add(row)
        await db.commit()
    await proxy.publish_change_write_receipt(cw_id, status)


async def test_receipt_done_wakes_waiter(db_session: AsyncSession) -> None:
    cw = await _seed_pending(db_session)
    # 0.1s 后模拟 daemon 回执 done（publish 唤醒；Redis 不可用则兜底窗口触发）
    asyncio.get_running_loop().call_later(
        0.1, lambda: asyncio.ensure_future(_flip_terminal(cw.id, "done"))
    )
    result = await asyncio.wait_for(
        proxy._await_change_write_receipt(db_session, cw.id), timeout=10
    )
    assert result.status == "done"
    assert result.id == cw.id


async def test_receipt_failed_wakes_waiter(db_session: AsyncSession) -> None:
    cw = await _seed_pending(db_session)
    asyncio.get_running_loop().call_later(
        0.1, lambda: asyncio.ensure_future(_flip_terminal(cw.id, "failed"))
    )
    result = await asyncio.wait_for(
        proxy._await_change_write_receipt(db_session, cw.id), timeout=10
    )
    assert result.status == "failed"


async def test_timeout_flips_failed_and_raises(db_session: AsyncSession) -> None:
    cw = await _seed_pending(db_session)
    monkeypatch = pytest.MonkeyPatch()
    # 缩短超时常量（函数体内读取模块全局，monkeypatch 生效）；兜底窗缩到最小档。
    monkeypatch.setattr(proxy, "PROXY_CHANGE_WRITE_TIMEOUT_SECONDS", 0.2)
    monkeypatch.setattr(proxy, "PROXY_RECEIPT_DB_CHECK_SECONDS", 0.05)
    monkeypatch.setattr(proxy, "PROXY_RECEIPT_PUBSUB_WINDOW_SECONDS", 0.05)
    try:
        with pytest.raises(ChangeWriteError):
            await proxy._await_change_write_receipt(db_session, cw.id)
    finally:
        monkeypatch.undo()
    await db_session.rollback()
    row = await db_session.get(DaemonChangeWrite, cw.id)
    await db_session.refresh(row)
    assert row.status == "failed"
    assert row.error == "proxy await timeout"
