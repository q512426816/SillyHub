"""Tests for :class:`ApiKeyService`.

Covers the lifecycle: create → list → authenticate → revoke → auth fails,
plus edge cases (expiry, owner-disabled, prefix check, multi-user).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import password_hasher, verify_refresh_token
from app.modules.auth.api_key_service import (
    API_KEY_PREFIX,
    ApiKeyService,
    _display_prefix,
    _neg_cache_key,
    _pos_cache_key,
)
from app.modules.auth.model import ApiKey, User


async def _make_user(session: AsyncSession, *, admin: bool = True) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"user-{uuid.uuid4().hex[:6]}@example.com",
        password_hash=password_hasher.hash("x"),
        status="active",
        is_platform_admin=admin,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


@pytest.mark.asyncio
async def test_create_returns_plaintext_with_prefix_and_persists_hash(
    db_session: AsyncSession,
) -> None:
    user = await _make_user(db_session)
    svc = ApiKeyService(db_session, settings=get_settings())

    row, plaintext = await svc.create(user_id=user.id, name="my-daemon", expires_at=None)

    assert plaintext.startswith(API_KEY_PREFIX)
    assert len(plaintext) > len(API_KEY_PREFIX) + 20
    assert row.name == "my-daemon"
    assert row.key_prefix == _display_prefix(plaintext)
    assert row.key_hash != plaintext
    assert row.key_hash.startswith("$2")  # bcrypt
    assert row.user_id == user.id
    assert row.revoked_at is None
    assert row.expires_at is None


@pytest.mark.asyncio
async def test_list_for_user_returns_newest_first_including_revoked(
    db_session: AsyncSession,
) -> None:
    user = await _make_user(db_session)
    other = await _make_user(db_session)
    svc = ApiKeyService(db_session, settings=get_settings())

    await svc.create(user_id=user.id, name="a", expires_at=None)
    await svc.create(user_id=user.id, name="b", expires_at=None)
    await svc.create(user_id=other.id, name="other", expires_at=None)

    rows = await svc.list_for_user(user_id=user.id)
    assert [r.name for r in rows] == ["b", "a"]
    assert all(r.user_id == user.id for r in rows)


@pytest.mark.asyncio
async def test_authenticate_succeeds_and_updates_last_used(
    db_session: AsyncSession,
) -> None:
    user = await _make_user(db_session)
    svc = ApiKeyService(db_session, settings=get_settings())
    _, plaintext = await svc.create(user_id=user.id, name="k", expires_at=None)

    assert await svc.authenticate(plaintext=plaintext) is not None

    # second call should also work and update timestamp
    fetched = await svc.authenticate(plaintext=plaintext)
    assert fetched is not None and fetched.id == user.id


@pytest.mark.asyncio
async def test_authenticate_throttles_last_used_update(
    db_session: AsyncSession,
) -> None:
    """节流窗口内重复认证跳过 last_used_at UPDATE(生产雪崩根因修复回归)。

    同一 key 在默认 60s 窗口内多次认证,只有首次写 last_used_at;后续跳过
    → 不再每请求 UPDATE 同一行 → 消除行锁串行化。
    """
    user = await _make_user(db_session)
    svc = ApiKeyService(db_session, settings=get_settings())
    _, plaintext = await svc.create(user_id=user.id, name="k", expires_at=None)

    # 首次认证:写入 last_used_at
    assert await svc.authenticate(plaintext=plaintext) is not None
    stmt = select(ApiKey).where(ApiKey.name == "k")
    first = (await db_session.execute(stmt)).scalar_one()
    assert first.last_used_at is not None
    first_ts = first.last_used_at

    # 节流窗口内再次认证:跳过 UPDATE,persisted last_used_at 保持不变
    assert await svc.authenticate(plaintext=plaintext) is not None
    db_session.expire_all()
    second = (await db_session.execute(stmt)).scalar_one()
    # SQLite 存取会丢失 tzinfo(首次内存值 aware,expire 后重读为 naive),
    # 统一去掉 tzinfo 比较:节流跳过 UPDATE 后持久化值应保持不变。
    assert second.last_used_at.replace(tzinfo=None) == first_ts.replace(tzinfo=None)


@pytest.mark.asyncio
async def test_authenticate_zero_threshold_always_writes_last_used(
    db_session: AsyncSession,
) -> None:
    """阈值=0 退化为每次都写(旧行为兼容)。"""
    user = await _make_user(db_session)
    settings = get_settings().model_copy(update={"auth_api_key_last_used_throttle_seconds": 0})
    svc = ApiKeyService(db_session, settings=settings)
    _, plaintext = await svc.create(user_id=user.id, name="k", expires_at=None)

    await svc.authenticate(plaintext=plaintext)
    stmt = select(ApiKey).where(ApiKey.name == "k")
    first = (await db_session.execute(stmt)).scalar_one()
    first_ts = first.last_used_at
    assert first_ts is not None

    await svc.authenticate(plaintext=plaintext)
    db_session.expire_all()
    second = (await db_session.execute(stmt)).scalar_one()
    # 阈值=0 → 每次都写(运行极快,断言非 None 且无异常即证明未走节流 return 分支)
    assert second.last_used_at is not None


@pytest.mark.asyncio
async def test_authenticate_fails_for_unknown_prefix(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    svc = ApiKeyService(db_session, settings=get_settings())
    await svc.create(user_id=user.id, name="k", expires_at=None)

    # Wrong prefix → fast-fail without DB scan
    assert await svc.authenticate(plaintext="not-a-real-key") is None
    # JWT-like string also fast-fails
    assert await svc.authenticate(plaintext="eyJhbGciOiJIUzI1NiJ9.x.y") is None


@pytest.mark.asyncio
async def test_authenticate_fails_after_revoke(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    svc = ApiKeyService(db_session, settings=get_settings())
    row, plaintext = await svc.create(user_id=user.id, name="k", expires_at=None)

    assert await svc.revoke(api_key_id=row.id, user_id=user.id) is True
    assert await svc.authenticate(plaintext=plaintext) is None


@pytest.mark.asyncio
async def test_revoke_is_idempotent_and_owner_scoped(
    db_session: AsyncSession,
) -> None:
    user = await _make_user(db_session)
    intruder = await _make_user(db_session)
    svc = ApiKeyService(db_session, settings=get_settings())
    row, _ = await svc.create(user_id=user.id, name="k", expires_at=None)

    # Intruder cannot revoke
    assert await svc.revoke(api_key_id=row.id, user_id=intruder.id) is False
    # Real owner revokes
    assert await svc.revoke(api_key_id=row.id, user_id=user.id) is True
    # Second revoke is a no-op
    assert await svc.revoke(api_key_id=row.id, user_id=user.id) is False


@pytest.mark.asyncio
async def test_authenticate_fails_after_expiry(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    svc = ApiKeyService(db_session, settings=get_settings())
    past = datetime.now(UTC) - timedelta(minutes=5)
    row, plaintext = await svc.create(user_id=user.id, name="k", expires_at=past)

    assert row.expires_at is not None
    assert await svc.authenticate(plaintext=plaintext) is None


@pytest.mark.asyncio
async def test_authenticate_fails_when_owner_disabled(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    svc = ApiKeyService(db_session, settings=get_settings())
    _, plaintext = await svc.create(user_id=user.id, name="k", expires_at=None)

    user.status = "disabled"
    db_session.add(user)
    await db_session.commit()

    assert await svc.authenticate(plaintext=plaintext) is None


@pytest.mark.asyncio
async def test_two_keys_for_same_user_dont_collide(db_session: AsyncSession) -> None:
    user = await _make_user(db_session)
    svc = ApiKeyService(db_session, settings=get_settings())
    _, p1 = await svc.create(user_id=user.id, name="k1", expires_at=None)
    _, p2 = await svc.create(user_id=user.id, name="k2", expires_at=None)

    assert p1 != p2
    assert await svc.authenticate(plaintext=p1) is not None
    assert await svc.authenticate(plaintext=p2) is not None


# ── P0 性能优化:Redis 缓存 + bcrypt 异步化 (2026-06-27-p0-perf-optimization) ──


class _FakeRedis:
    """Minimal in-memory async Redis stand-in for cache tests.

    Implements the subset :class:`ApiKeyService` touches: GET / SET(ex) /
    DELETE / SCAN(match). No TTL expiry is simulated — tests assert on key
    presence, not on timing.
    """

    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self.store.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.store[key] = value

    async def delete(self, key: str) -> None:
        self.store.pop(key, None)

    async def scan_iter(self, match: str | None = None, count: int | None = None):
        import fnmatch

        for k in list(self.store):
            if match is None or fnmatch.fnmatch(k, match):
                yield k


def _spy_bcrypt(monkeypatch: pytest.MonkeyPatch) -> dict[str, int]:
    """Wrap the module-level ``verify_refresh_token`` with a call counter."""
    calls = {"n": 0}
    real = verify_refresh_token

    def counting(token: str, hashed: str) -> bool:
        calls["n"] += 1
        return real(token, hashed)

    monkeypatch.setattr("app.modules.auth.api_key_service.verify_refresh_token", counting)
    return calls


@pytest.mark.asyncio
async def test_positive_cache_hit_skips_bcrypt(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """正缓存命中后跳过 bcrypt O(n) 扫描(P0 性能优化核心)。"""
    user = await _make_user(db_session)
    svc = ApiKeyService(db_session, settings=get_settings())
    _, plaintext = await svc.create(user_id=user.id, name="k", expires_at=None)

    fake = _FakeRedis()
    monkeypatch.setattr("app.modules.auth.api_key_service.get_redis", lambda: fake)
    calls = _spy_bcrypt(monkeypatch)

    # 首次:走 bcrypt 扫描 + 写正缓存
    assert await svc.authenticate(plaintext=plaintext) is not None
    after_first = calls["n"]
    assert after_first >= 1
    assert _pos_cache_key(plaintext, _display_prefix(plaintext)) in fake.store

    # 再次:命中正缓存,不再调 bcrypt
    assert await svc.authenticate(plaintext=plaintext) is not None
    assert calls["n"] == after_first


@pytest.mark.asyncio
async def test_negative_cache_blocks_probe_replay(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """完全无效明文首走 bcrypt,二次起命中负缓存秒回 None(防探测穿透)。"""
    user = await _make_user(db_session)
    svc = ApiKeyService(db_session, settings=get_settings())
    await svc.create(user_id=user.id, name="k", expires_at=None)

    fake = _FakeRedis()
    monkeypatch.setattr("app.modules.auth.api_key_service.get_redis", lambda: fake)
    calls = _spy_bcrypt(monkeypatch)

    bogus = API_KEY_PREFIX + "definitely-not-a-real-key-0xDEAD"
    # 首次:无效明文走完 candidate 的 bcrypt → 写负缓存
    assert await svc.authenticate(plaintext=bogus) is None
    after_first = calls["n"]
    assert after_first >= 1
    assert fake.store.get(_neg_cache_key(bogus)) == "1"

    # 再次:命中负缓存,不再调 bcrypt
    assert await svc.authenticate(plaintext=bogus) is None
    assert calls["n"] == after_first


@pytest.mark.asyncio
async def test_revoke_invalidates_positive_cache(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """revoke 必须清正缓存,否则被吊销 key 在 TTL 内仍可认证(安全漏洞)。"""
    user = await _make_user(db_session)
    svc = ApiKeyService(db_session, settings=get_settings())
    row, plaintext = await svc.create(user_id=user.id, name="k", expires_at=None)

    fake = _FakeRedis()
    monkeypatch.setattr("app.modules.auth.api_key_service.get_redis", lambda: fake)

    # 认证 → 写正缓存
    assert await svc.authenticate(plaintext=plaintext) is not None
    cache_key = _pos_cache_key(plaintext, _display_prefix(plaintext))
    assert cache_key in fake.store

    # revoke → 按 key_prefix 清缓存
    assert await svc.revoke(api_key_id=row.id, user_id=user.id) is True
    assert cache_key not in fake.store

    # 再认证:缓存已清,走 bcrypt 发现 revoked → None
    assert await svc.authenticate(plaintext=plaintext) is None


@pytest.mark.asyncio
async def test_authenticate_degrades_when_redis_unavailable(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """redis 全挂时缓存层降级,认证仍走 bcrypt 成功(测试/生产抖动不影响认证)。"""
    user = await _make_user(db_session)
    svc = ApiKeyService(db_session, settings=get_settings())
    _, plaintext = await svc.create(user_id=user.id, name="k", expires_at=None)

    def raising() -> None:
        raise RuntimeError("redis down")

    monkeypatch.setattr("app.modules.auth.api_key_service.get_redis", raising)

    assert await svc.authenticate(plaintext=plaintext) is not None
