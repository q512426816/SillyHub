"""pending 集缓存（pending_cache）读穿 + epoch 失效测试（ql-20260909-016）。

``_resolve_pending_change_keys``（pending_review_only 过滤）原每次拉全
workspace 的 latest_progress 肥 JSON。本测试用进程内 FakeRedis（替换
pending_cache.get_redis）锁定：

- 读穿：首次现算回填，二次命中不再查 DB（_project_current_stage 计数器不增）；
- epoch 失效：bump 后缓存条目作废，重新现算；
- 降级：Redis 抛错时回退现算且不抛（best-effort）；
- location 维度隔离：不同 location 各自条目互不串。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

import app.modules.change.pending_cache as pending_cache
from app.modules.change.model import Change
from app.modules.change.service import ChangeService
from app.modules.platform_sync.model import PlatformChangeProgressORM


class FakeRedis:
    """进程内最小 Redis 替身（get/set/incr/expire/raise 开关）。"""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.broken = False

    def _check(self) -> None:
        if self.broken:
            raise ConnectionError("redis down")

    async def get(self, key: str) -> str | None:
        self._check()
        return self.store.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self._check()
        self.store[key] = value

    async def incr(self, key: str) -> int:
        self._check()
        cur = int(self.store.get(key, "0")) + 1
        self.store[key] = str(cur)
        return cur

    async def expire(self, key: str, ttl: int) -> None:
        self._check()


@pytest.fixture()
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> FakeRedis:
    fake = FakeRedis()
    monkeypatch.setattr(pending_cache, "get_redis", lambda: fake)
    return fake


async def _seed_change_with_progress(
    session: AsyncSession, workspace_id: uuid.UUID, key: str, stage: str
) -> None:
    session.add(
        Change(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            change_key=key,
            location="active",
            path=f"changes/{key}",
        )
    )
    session.add(
        PlatformChangeProgressORM(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            change_name=key,
            latest_progress={
                "changes": [{"name": key, "current_stage": stage}],
                "stages": [{"stage": "brainstorm", "status": "completed"}],
            },
        )
    )
    await session.commit()


async def test_read_through_cache_hits_on_second_call(
    db_session: AsyncSession, fake_redis: FakeRedis, monkeypatch: pytest.MonkeyPatch
) -> None:
    ws = uuid.uuid4()
    await _seed_change_with_progress(db_session, ws, "2026-09-09-cached", "brainstorm")

    calls = {"n": 0}
    orig = ChangeService._project_current_stage

    async def counting(self, pairs):  # type: ignore[no-untyped-def]
        calls["n"] += 1
        return await orig(self, pairs)

    monkeypatch.setattr(ChangeService, "_project_current_stage", counting)

    svc = ChangeService(db_session)
    first = await svc._resolve_pending_change_keys(ws, None)
    assert "2026-09-09-cached" in first
    assert calls["n"] == 1

    second = await svc._resolve_pending_change_keys(ws, None)
    assert second == first
    assert calls["n"] == 1  # 命中缓存，未再查 progress 表


async def test_epoch_bump_invalidates(db_session: AsyncSession, fake_redis: FakeRedis) -> None:
    ws = uuid.uuid4()
    await _seed_change_with_progress(db_session, ws, "2026-09-09-epoch", "brainstorm")
    svc = ChangeService(db_session)

    before = await svc._resolve_pending_change_keys(ws, None)
    assert "2026-09-09-epoch" in before

    # 模拟写入方：数据翻转（stage → archived 不再 pending）+ commit 后 bump
    row = (
        await db_session.execute(
            PlatformChangeProgressORM.__table__.select().where(
                PlatformChangeProgressORM.change_name == "2026-09-09-epoch"
            )
        )
    ).first()
    assert row is not None
    await db_session.execute(
        PlatformChangeProgressORM.__table__.update()
        .where(PlatformChangeProgressORM.change_name == "2026-09-09-epoch")
        .values(
            latest_progress={
                "changes": [{"name": "2026-09-09-epoch", "current_stage": "archived"}],
                "stages": [{"stage": "archive", "status": "completed"}],
            }
        )
    )
    await db_session.commit()
    await pending_cache.bump_pending_epoch(ws)

    after = await svc._resolve_pending_change_keys(ws, None)
    assert "2026-09-09-epoch" not in after


async def test_redis_down_falls_back_to_compute(
    db_session: AsyncSession, fake_redis: FakeRedis
) -> None:
    ws = uuid.uuid4()
    await _seed_change_with_progress(db_session, ws, "2026-09-09-degraded", "brainstorm")
    fake_redis.broken = True
    svc = ChangeService(db_session)
    # get/set/bump 全部抛错 → 回退现算，不向上抛
    result = await svc._resolve_pending_change_keys(ws, None)
    assert "2026-09-09-degraded" in result
    await pending_cache.bump_pending_epoch(ws)  # 静默吞


async def test_location_dimensions_isolated(
    db_session: AsyncSession, fake_redis: FakeRedis
) -> None:
    ws = uuid.uuid4()
    await _seed_change_with_progress(db_session, ws, "2026-09-09-active", "brainstorm")
    session_add = Change(
        id=uuid.uuid4(),
        workspace_id=ws,
        change_key="2026-09-09-archived",
        location="archive",
        path="changes/archive/2026-09-09-archived",
    )
    db_session.add(session_add)
    await db_session.commit()

    svc = ChangeService(db_session)
    active_set = await svc._resolve_pending_change_keys(ws, "active")
    assert "2026-09-09-active" in active_set
    # archive location 无 progress 行 → 不 pending；两 location 条目互不串
    archive_set = await svc._resolve_pending_change_keys(ws, "archive")
    assert archive_set == set()
    assert await svc._resolve_pending_change_keys(ws, "active") == active_set
