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

    async def set(self, key: str, value: str, ex: int | None = None, nx: bool = False) -> None:
        self._check()
        if nx and key in self.store:
            return
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

    async def counting(self, pairs):
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


async def test_set_reuses_read_time_epoch_no_poisoning(fake_redis: FakeRedis) -> None:
    """ql-20260910-002：读侧捕获 epoch → 现算期间写入方 bump → 回填带旧 epoch。

    set 若重读当前 epoch（旧实现），旧集合被盖上 bump 后的新值，下一位读者
    校验通过 → 过期 pending 集最长存活 TTL 300s（中毒）。修复后条目按读时
    epoch 盖章，下一位读者失配重算。
    """
    ws = uuid.uuid4()
    # 播种 epoch 键（=0，无条目）后读侧捕获——读时未命中
    fake_redis.store[f"change_pending_epoch:{ws}"] = "0"
    epoch, cached = await pending_cache.get_cached_pending_keys(ws, None)
    assert cached is None
    assert epoch == 0

    # 现算期间写入方 commit + bump（0 → 1），回填的集合是 bump 前的旧数据
    await pending_cache.bump_pending_epoch(ws)
    await pending_cache.set_cached_pending_keys(ws, None, {"stale-key"}, epoch=epoch)

    # 下一位读者：条目 epoch 0 ≠ 当前 1 → 失配重算，无中毒
    cur_epoch, cached2 = await pending_cache.get_cached_pending_keys(ws, None)
    assert cached2 is None
    assert cur_epoch == 1


async def test_set_init_branch_does_not_roll_back_bumped_epoch(
    fake_redis: FakeRedis,
) -> None:
    """ql-20260910-002：读时 epoch 键不存在（None）时回填走 NX 初始化。

    若初始化用裸 SET 覆盖，会把现算期间写入方 INCR 出的 epoch 拉回 0——
    已 stamp 0 的条目重新匹配（另一形态中毒）。NX 后条目 0 ≠ 当前 1，失配。
    """
    ws = uuid.uuid4()
    epoch, cached = await pending_cache.get_cached_pending_keys(ws, None)
    assert cached is None
    assert epoch is None

    # 现算期间写入方 bump（键 0→1），回填带 epoch=None 走初始化分支
    await pending_cache.bump_pending_epoch(ws)
    await pending_cache.set_cached_pending_keys(ws, None, {"stale-key"}, epoch=epoch)

    # epoch 键不被拉回（仍 1）；条目 stamp 0 失配 → 下一位读者重算
    assert fake_redis.store[f"change_pending_epoch:{ws}"] == "1"
    cur_epoch, cached2 = await pending_cache.get_cached_pending_keys(ws, None)
    assert cached2 is None
    assert cur_epoch == 1


async def test_read_hit_returns_same_epoch_roundtrip(fake_redis: FakeRedis) -> None:
    """常规路径回归：无并发 bump 时读→写→读闭环命中（修复不破坏读穿）。"""
    ws = uuid.uuid4()
    epoch, _ = await pending_cache.get_cached_pending_keys(ws, None)
    await pending_cache.set_cached_pending_keys(ws, None, {"a", "b"}, epoch=epoch)
    cur_epoch, cached = await pending_cache.get_cached_pending_keys(ws, None)
    assert cached == {"a", "b"}
    assert cur_epoch == 0  # NX 初始化后的 0，条目同 0 匹配
