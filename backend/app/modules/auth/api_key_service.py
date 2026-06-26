"""API Key use cases.

Long-lived credentials for daemon processes. Mirrors the refresh-token
pattern in :mod:`app.modules.auth.service`: plaintext is generated with
``secrets.token_urlsafe``, persisted as ``bcrypt(plaintext)``.

The ``shk_live_`` prefix is prepended to the plaintext so GitHub secret
scanning custom rules can match leaked keys, and so the UI can render a
friendlier "SillyHub Live Key" label. The prefix is *not* stored
separately — ``key_prefix`` is the first 12 plaintext chars (including
the prefix), giving admins a stable visual fingerprint.
"""

from __future__ import annotations

import asyncio
import hashlib
import secrets
import uuid
from datetime import UTC, datetime

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.config import Settings
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.core.security import hash_refresh_token, password_hasher, verify_refresh_token
from app.modules.auth.model import ApiKey, User

log = get_logger(__name__)

API_KEY_PREFIX = "shk_live_"
_KEY_PREFIX_DISPLAY_LEN = 12


def _utc_now() -> datetime:
    return datetime.now(UTC)


def _as_utc(dt: datetime) -> datetime:
    """Normalise a possibly-naive datetime (SQLite drops tzinfo) to UTC."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt.astimezone(UTC)


def _generate_plaintext() -> str:
    """Generate a new plaintext API key (``shk_live_`` + 32 random bytes)."""
    return API_KEY_PREFIX + secrets.token_urlsafe(32)


def _display_prefix(plaintext: str) -> str:
    """First ~12 chars of the plaintext, used for UI display only."""
    return plaintext[:_KEY_PREFIX_DISPLAY_LEN]


def _key_digest(plaintext: str) -> str:
    """SHA-256 of the plaintext — a fast, stable cache identifier.

    bcrypt cannot be inverted, so the auth cache is keyed on a cheap SHA-256
    of the plaintext (microseconds) rather than the bcrypt hash (cost-12 ≈
    250ms). The digest uniquely identifies a plaintext; positive cache keys
    also embed the DB-stored ``key_prefix`` so :meth:`ApiKeyService.revoke`
    can sweep entries by prefix without knowing the plaintext.
    """
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


def _pos_cache_key(plaintext: str, key_prefix: str) -> str:
    """Positive cache key: ``auth:apikey:{key_prefix}:{sha256}``."""
    return f"auth:apikey:{key_prefix}:{_key_digest(plaintext)}"


def _neg_cache_key(plaintext: str) -> str:
    """Negative cache key: ``auth:apikey:neg:{sha256}``."""
    return f"auth:apikey:neg:{_key_digest(plaintext)}"


class ApiKeyService:
    """CRUD + authenticate for long-lived API keys."""

    def __init__(self, db: AsyncSession, *, settings: Settings) -> None:
        self._db = db
        self._settings = settings
        password_hasher.configure(settings.auth_bcrypt_rounds)

    # ── Create / list / revoke ────────────────────────────────────────────

    async def create(
        self,
        *,
        user_id: uuid.UUID,
        name: str,
        expires_at: datetime | None,
    ) -> tuple[ApiKey, str]:
        """Issue a new key. Returns ``(row, plaintext)`` — plaintext must be
        returned to the caller *now* and is never recoverable later."""
        plaintext = _generate_plaintext()
        row = ApiKey(
            id=uuid.uuid4(),
            user_id=user_id,
            name=name.strip(),
            key_prefix=_display_prefix(plaintext),
            key_hash=hash_refresh_token(plaintext),
            last_used_at=None,
            expires_at=expires_at,
            created_at=_utc_now(),
            revoked_at=None,
        )
        self._db.add(row)
        await self._db.commit()
        await self._db.refresh(row)
        log.info(
            "api_key.created",
            api_key_id=str(row.id),
            user_id=str(user_id),
            name=row.name,
        )
        return row, plaintext

    async def list_for_user(self, *, user_id: uuid.UUID) -> list[ApiKey]:
        """All keys for ``user_id``, newest first (including revoked)."""
        stmt = (
            select(ApiKey)
            .where(col(ApiKey.user_id) == user_id)
            .order_by(col(ApiKey.created_at).desc())
        )
        return list((await self._db.execute(stmt)).scalars().all())

    async def revoke(self, *, api_key_id: uuid.UUID, user_id: uuid.UUID) -> bool:
        """Set ``revoked_at = now`` if the key belongs to ``user_id`` and is
        currently active. Returns ``True`` if a row was updated.

        Idempotent: revoking an already-revoked or non-existent key returns
        ``False`` (no error) so DELETE endpoints can return 404 uniformly.

        P0 缓存一致性:revoke 后必须清除该 key 的正缓存
        (``auth:apikey:{key_prefix}:*``),否则被吊销的 key 在缓存 TTL
        (默认 60s)内仍可认证成功(安全漏洞)。revoke 只知 api_key_id,无法
        重建明文 sha256,故先查 ``key_prefix``(DB 存储的明文前12字符)再按
        前缀 SCAN 删除。
        """
        now = _utc_now()
        # 先查 key_prefix(用于清缓存),同时携带原 UPDATE 的三个 WHERE 条件
        # (id + user_id + revoked_at IS NULL)保证 idempotent 语义不变。
        key_prefix = (
            await self._db.execute(
                select(ApiKey.key_prefix)
                .where(col(ApiKey.id) == api_key_id)
                .where(col(ApiKey.user_id) == user_id)
                .where(col(ApiKey.revoked_at).is_(None))
            )
        ).scalar_one_or_none()
        if key_prefix is None:
            return False

        result = await self._db.execute(
            update(ApiKey)
            .where(col(ApiKey.id) == api_key_id)
            .where(col(ApiKey.user_id) == user_id)
            .where(col(ApiKey.revoked_at).is_(None))
            .values(revoked_at=now)
        )
        rowcount = int(getattr(result, "rowcount", 0) or 0)
        if rowcount:
            await self._db.commit()
            await self._invalidate_prefix_cache(key_prefix)
            log.info(
                "api_key.revoked",
                api_key_id=str(api_key_id),
                user_id=str(user_id),
            )
        return bool(rowcount)

    # ── Authenticate ──────────────────────────────────────────────────────

    async def authenticate(self, *, plaintext: str) -> User | None:
        """Resolve ``plaintext`` to an active :class:`User`, or ``None``.

        ``None`` covers every failure mode (unknown, revoked, expired,
        owner-disabled) — callers should raise ``AuthTokenInvalid`` to
        avoid leaking which case applied.

        缓存策略(P0 性能优化,生产根因:cost12 同步 bcrypt 阻塞单事件循环,
        2核1.6G 单用户即卡):

        - 负缓存 ``auth:apikey:neg:{sha256}``(TTL=
          ``auth_api_key_negative_cache_ttl``,默认 30s):完全无 bcrypt 匹配
          的明文秒回 None,防止无效 key 探测穿透到 O(n) bcrypt 扫描。
        - 正缓存 ``auth:apikey:{key_prefix}:{sha256}``(TTL=
          ``auth_api_key_cache_ttl``,默认 60s)存 user_id。命中后仍查 DB
          实时校验 user active/未删除——缓存只跳过最贵的 bcrypt O(n) 扫描,
          绝不放行已禁用/删除的用户。
        - bcrypt ``verify_refresh_token`` 放 ``asyncio.to_thread`` 不阻塞
          事件循环,其他协程(请求)可继续调度。
        - 所有缓存读写 try/except 降级:redis 不可用时回退原 bcrypt 路径,
          认证永不因缓存层故障而失败。
        """
        if not plaintext:
            return None

        # Sanity check: a real key always carries our prefix. Skip DB scan
        # entirely for clearly-wrong inputs (e.g. someone sent a JWT here).
        if not plaintext.startswith(API_KEY_PREFIX):
            return None

        key_prefix = _display_prefix(plaintext)

        # 负缓存:该明文最近完全无 bcrypt 匹配 → 秒回 None
        if await self._cache_get(_neg_cache_key(plaintext)) == "1":
            return None

        # 正缓存:该明文最近认证成功 → 取 user_id 查 DB 实时校验状态
        cached_uid = await self._cache_get(_pos_cache_key(plaintext, key_prefix))
        if cached_uid:
            try:
                user = await self._db.get(User, uuid.UUID(cached_uid))
            except (ValueError, TypeError):
                user = None
            if user is not None and user.deleted_at is None and user.status == "active":
                return user
            # user 已失效 → 清正缓存,继续 bcrypt 兜底
            await self._cache_delete(_pos_cache_key(plaintext, key_prefix))

        # bcrypt 路径:O(n) 扫描未吊销 key,verify 放 to_thread 不阻塞事件循环
        stmt = (
            select(ApiKey)
            .where(col(ApiKey.revoked_at).is_(None))
            .order_by(col(ApiKey.created_at).desc())
        )
        candidates = (await self._db.execute(stmt)).scalars().all()
        now = _utc_now()
        matched_but_invalid = False
        for key in candidates:
            if not await asyncio.to_thread(verify_refresh_token, plaintext, key.key_hash):
                continue
            # bcrypt 匹配成功 → 明文唯一对应这个 key(bcrypt 碰撞可忽略)
            if key.expires_at is not None and _as_utc(key.expires_at) <= now:
                matched_but_invalid = True
                break
            user = await self._db.get(User, key.user_id)
            if user is None or user.deleted_at is not None or user.status != "active":
                matched_but_invalid = True
                break
            # 成功:写正缓存(key_prefix 维度,revoke 时可按前缀清)
            await self._cache_set(
                _pos_cache_key(plaintext, key_prefix),
                str(user.id),
                ttl=self._settings.auth_api_key_cache_ttl,
            )
            await self._mark_used(key)
            return user

        if matched_but_invalid:
            # 命中真实 key 但过期/owner 失效:不设负缓存,避免 owner 恢复后误拒
            return None

        # 完全无 bcrypt 匹配 → 负缓存防探测
        await self._cache_set(
            _neg_cache_key(plaintext),
            "1",
            ttl=self._settings.auth_api_key_negative_cache_ttl,
        )
        return None

    # ── Cache helpers (best-effort; any Redis failure degrades to no-op) ──

    async def _cache_get(self, key: str) -> str | None:
        """Redis GET; any failure → cache miss (returns ``None``).

        Cache is a best-effort acceleration layer: if Redis is down (or the
        test harness has no Redis), authentication must still work via the
        bcrypt path. We therefore swallow any exception and degrade.
        """
        try:
            return await get_redis().get(key)
        except Exception as exc:  # 缓存层降级:任何 Redis 故障都回退原路径
            log.warning("api_key.cache_read_failed", key=key, error=str(exc))
            return None

    async def _cache_set(self, key: str, value: str, *, ttl: int) -> None:
        """Redis SET EX; ``ttl <= 0`` disables. Failures are non-fatal."""
        if ttl <= 0:
            return
        try:
            await get_redis().set(key, value, ex=ttl)
        except Exception as exc:  # 缓存层降级
            log.warning("api_key.cache_write_failed", key=key, error=str(exc))

    async def _cache_delete(self, key: str) -> None:
        try:
            await get_redis().delete(key)
        except Exception as exc:  # 缓存层降级
            log.warning("api_key.cache_delete_failed", key=key, error=str(exc))

    async def _invalidate_prefix_cache(self, key_prefix: str) -> None:
        """Sweep every positive cache entry for ``key_prefix`` (revoke path).

        ``revoke`` only knows ``api_key_id``, not the plaintext, so it cannot
        rebuild the sha256 digest. We SCAN by the DB-stored ``key_prefix``
        (first 12 plaintext chars); the full digest suffix keeps entries
        unique, so the prefix scan only ever deletes this key's own entries.
        """
        pattern = f"auth:apikey:{key_prefix}:*"
        try:
            redis = get_redis()
            async for cached_key in redis.scan_iter(match=pattern, count=100):
                await redis.delete(cached_key)
        except Exception as exc:  # 缓存层降级:revoke 仍成功(只差缓存清理)
            log.warning("api_key.cache_invalidate_failed", prefix=key_prefix, error=str(exc))

    async def _mark_used(self, key: ApiKey) -> None:
        """Update ``last_used_at`` on a successful authenticate.

        Throttled by ``settings.auth_api_key_last_used_throttle_seconds``
        (default 60s): if the stored value is newer than the threshold, the
        UPDATE is skipped entirely. Without this, every request carrying the
        same long-lived daemon key UPDATEs the same row and serialises on its
        row lock — under load this exhausts the connection pool (生产雪崩:
        38/39 连接等同一行锁 40-55s)。``last_used_at`` 仅供管理 UI 展示,
        秒级精度无业务价值,60s 节流可接受。阈值=0 退化为每次都写。
        """
        now = _utc_now()
        last = key.last_used_at
        threshold = self._settings.auth_api_key_last_used_throttle_seconds
        if last is not None and (now - _as_utc(last)).total_seconds() < threshold:
            return
        key.last_used_at = now
        self._db.add(key)
        await self._db.commit()
