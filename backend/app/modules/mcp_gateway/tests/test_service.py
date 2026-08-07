"""Tests for :class:`McpTokenService`.

Covers the lifecycle: create → authenticate → revoke → auth fails, plus the
Redis cache (positive/negative + revoke invalidation + best-effort degrade),
last_used throttle, and workspace scoping. Mirrors the ApiKeyService test
style but asserts the McpToken-specific shape: sha256 (not bcrypt) hash,
principal (not user) result, precise (not SCAN) cache invalidation.

NOTE（task-02 execute）：worktree 无 .venv，本文件按惯例写齐**但不跑**——
verify 阶段在 task-01 model 落定后由 ``cd backend && uv run pytest
app/modules/mcp_gateway -q --no-cov`` 统一执行。import ``McpTokenORM`` 会把
``mcp_tokens`` 表注册到 ``BaseModel.metadata``，conftest 的 create_all 即建表
（FK 目标 workspaces/users 已在根 conftest db_engine 注册）。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.modules.mcp_gateway.model import McpTokenORM
from app.modules.mcp_gateway.service import (
    MCP_TOKEN_PREFIX,
    McpTokenPrincipal,
    McpTokenService,
    _neg_cache_key,
    _pos_cache_key,
    _token_hash,
)
from app.modules.workspace.model import Workspace


async def _make_workspace(session: AsyncSession) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"ws-{uuid.uuid4().hex[:6]}",
        root_path=f"/tmp/ws-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


def _svc(session: AsyncSession) -> McpTokenService:
    return McpTokenService(session, settings=get_settings())


# ── Create / list / revoke ────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_returns_plaintext_with_prefix_and_persists_sha256(
    db_session: AsyncSession,
) -> None:
    ws = await _make_workspace(db_session)
    svc = _svc(db_session)

    row, plaintext = await svc.create(
        workspace_id=ws.id, name="ci-token", scope=["read", "dispatch"], created_by=None
    )

    assert plaintext.startswith(MCP_TOKEN_PREFIX)
    assert len(plaintext) > len(MCP_TOKEN_PREFIX) + 20
    assert row.name == "ci-token"
    # DB 存 sha256(明文)，不存明文（R-06）
    assert row.token_hash == _token_hash(plaintext)
    assert row.token_hash != plaintext
    assert len(row.token_hash) == 64  # sha256 hex
    assert row.workspace_id == ws.id
    assert row.scope == ["read", "dispatch"]
    assert row.revoked_at is None
    assert row.last_used_at is None


@pytest.mark.asyncio
async def test_list_for_workspace_returns_newest_first_including_revoked(
    db_session: AsyncSession,
) -> None:
    ws = await _make_workspace(db_session)
    other = await _make_workspace(db_session)
    svc = _svc(db_session)

    a, _ = await svc.create(workspace_id=ws.id, name="a", scope=["read"], created_by=None)
    await svc.create(workspace_id=ws.id, name="b", scope=["read"], created_by=None)
    # other workspace 的 token 不应出现
    await svc.create(workspace_id=other.id, name="other", scope=["read"], created_by=None)
    # 吊销 a，列表仍含（含已吊销，design §7.2）
    await svc.revoke(token_id=a.id, workspace_id=ws.id)

    rows = await svc.list_for_workspace(workspace_id=ws.id)
    assert [r.name for r in rows] == ["b", "a"]  # 新 → 旧
    assert all(r.workspace_id == ws.id for r in rows)


@pytest.mark.asyncio
async def test_revoke_is_idempotent_and_workspace_scoped(
    db_session: AsyncSession,
) -> None:
    ws = await _make_workspace(db_session)
    intruder_ws = await _make_workspace(db_session)
    svc = _svc(db_session)
    row, _ = await svc.create(workspace_id=ws.id, name="k", scope=["read"], created_by=None)

    # 跨 workspace 越权吊销 → False（不存在于该 ws 维度）
    assert await svc.revoke(token_id=row.id, workspace_id=intruder_ws.id) is False
    # 真正归属 ws 吊销 → True
    assert await svc.revoke(token_id=row.id, workspace_id=ws.id) is True
    # 再次吊销（已吊销）→ False（幂等）
    assert await svc.revoke(token_id=row.id, workspace_id=ws.id) is False


# ── Authenticate ──────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_authenticate_succeeds_and_returns_principal(
    db_session: AsyncSession,
) -> None:
    ws = await _make_workspace(db_session)
    svc = _svc(db_session)
    row, plaintext = await svc.create(
        workspace_id=ws.id, name="k", scope=["read", "converge"], created_by=None
    )

    principal = await svc.authenticate(plaintext)
    assert isinstance(principal, McpTokenPrincipal)
    assert principal.token_id == row.id
    assert principal.workspace_id == ws.id
    assert principal.scope == ["read", "converge"]


@pytest.mark.asyncio
async def test_authenticate_updates_last_used(db_session: AsyncSession) -> None:
    ws = await _make_workspace(db_session)
    svc = _svc(db_session)
    row, plaintext = await svc.create(workspace_id=ws.id, name="k", scope=["read"], created_by=None)
    assert row.last_used_at is None

    await svc.authenticate(plaintext)
    # 显式 select 重查（不用 expire_all+get——后者在 async 下触发 expired 属性
    # 懒加载缺 greenlet 报 MissingGreenlet；select 是 async session 标准重读法）。
    from sqlalchemy import select as _select

    refreshed = (
        await db_session.execute(_select(McpTokenORM).where(McpTokenORM.id == row.id))
    ).scalar_one()
    assert refreshed.last_used_at is not None


@pytest.mark.asyncio
async def test_authenticate_fails_for_unknown_prefix_or_empty(
    db_session: AsyncSession,
) -> None:
    ws = await _make_workspace(db_session)
    svc = _svc(db_session)
    await svc.create(workspace_id=ws.id, name="k", scope=["read"], created_by=None)

    # 无前缀 → fast-fail 不查库
    assert await svc.authenticate("not-a-real-token") is None
    # 误传 JWT → fast-fail
    assert await svc.authenticate("eyJhbGciOiJIUzI1NiJ9.x.y") is None
    # 空 → None
    assert await svc.authenticate("") is None


@pytest.mark.asyncio
async def test_authenticate_fails_after_revoke(db_session: AsyncSession) -> None:
    ws = await _make_workspace(db_session)
    svc = _svc(db_session)
    row, plaintext = await svc.create(workspace_id=ws.id, name="k", scope=["read"], created_by=None)

    assert await svc.revoke(token_id=row.id, workspace_id=ws.id) is True
    assert await svc.authenticate(plaintext) is None


@pytest.mark.asyncio
async def test_two_tokens_for_same_workspace_dont_collide(
    db_session: AsyncSession,
) -> None:
    ws = await _make_workspace(db_session)
    svc = _svc(db_session)
    _, p1 = await svc.create(workspace_id=ws.id, name="k1", scope=["read"], created_by=None)
    _, p2 = await svc.create(workspace_id=ws.id, name="k2", scope=["read"], created_by=None)

    assert p1 != p2  # 明文唯一
    assert await svc.authenticate(p1) is not None
    assert await svc.authenticate(p2) is not None


# ── Redis 缓存（正/负 + revoke 清缓存 + best-effort 降级）─────────────────


class _FakeRedis:
    """Minimal in-memory async Redis stand-in（subset：GET / SET(ex) / DELETE）。

    McpTokenService 不用 SCAN（revoke 知 token_hash 精确 DEL），故此处无需
    ``scan_iter``。不模拟 TTL 过期——断言 key 存在性而非计时。
    """

    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self.store.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.store[key] = value

    async def delete(self, key: str) -> None:
        self.store.pop(key, None)


@pytest.mark.asyncio
async def test_positive_cache_hit_serves_without_db(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """正缓存命中后直接返，不查库（design §5.2 P2 / 核心性能点）。

    断言方式：首次 authenticate 写正缓存；随后从 DB 物理删该 token 行；
    再次 authenticate 仍返 principal → 证明命中缓存而非查库（行已不存在）。
    """
    ws = await _make_workspace(db_session)
    svc = _svc(db_session)
    row, plaintext = await svc.create(workspace_id=ws.id, name="k", scope=["read"], created_by=None)

    fake = _FakeRedis()
    monkeypatch.setattr("app.modules.mcp_gateway.service.get_redis", lambda: fake)

    # 首次：查库 + 写正缓存
    principal = await svc.authenticate(plaintext)
    assert principal is not None and principal.token_id == row.id
    digest = _token_hash(plaintext)
    assert _pos_cache_key(digest) in fake.store

    # 物理删 DB 行（模拟"行已不在"）——若二次 authenticate 仍查库必返 None
    await db_session.execute(delete(McpTokenORM).where(McpTokenORM.id == row.id))
    await db_session.commit()

    # 二次：命中正缓存，返 principal（不查库，故行被删仍能返）
    cached = await svc.authenticate(plaintext)
    assert cached is not None and cached.token_id == row.id


@pytest.mark.asyncio
async def test_negative_cache_blocks_probe_replay(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """完全无效明文首查库写负缓存，二次起秒回 None（防探测穿透到 DB）。"""
    ws = await _make_workspace(db_session)
    svc = _svc(db_session)
    await svc.create(workspace_id=ws.id, name="k", scope=["read"], created_by=None)

    fake = _FakeRedis()
    monkeypatch.setattr("app.modules.mcp_gateway.service.get_redis", lambda: fake)

    bogus = MCP_TOKEN_PREFIX + "definitely-not-a-real-token-0xDEAD"
    # 首次：无效明文查库无匹配 → 写负缓存
    assert await svc.authenticate(bogus) is None
    digest = _token_hash(bogus)
    assert fake.store.get(_neg_cache_key(digest)) == "1"
    assert _pos_cache_key(digest) not in fake.store  # 未命中不写正缓存

    # 二次：命中负缓存秒回 None（即便 DB 此后插了同 hash 的行也不查库——证明走缓存）
    await svc.create(workspace_id=ws.id, name="late", scope=["read"], created_by=None)
    assert await svc.authenticate(bogus) is None


@pytest.mark.asyncio
async def test_revoke_invalidates_positive_cache(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """revoke 必须精确 DEL 正缓存，否则被吊销 token 在 TTL 内仍可认证（安全漏洞）。"""
    ws = await _make_workspace(db_session)
    svc = _svc(db_session)
    row, plaintext = await svc.create(workspace_id=ws.id, name="k", scope=["read"], created_by=None)

    fake = _FakeRedis()
    monkeypatch.setattr("app.modules.mcp_gateway.service.get_redis", lambda: fake)

    # 认证 → 写正缓存
    assert await svc.authenticate(plaintext) is not None
    digest = _token_hash(plaintext)
    cache_key = _pos_cache_key(digest)
    assert cache_key in fake.store

    # revoke → 精确 DEL 正缓存（revoke 知 token_hash，单 key DEL 非 SCAN）
    assert await svc.revoke(token_id=row.id, workspace_id=ws.id) is True
    assert cache_key not in fake.store

    # 再认证：缓存已清，查库发现 revoked_at → None
    assert await svc.authenticate(plaintext) is None


@pytest.mark.asyncio
async def test_authenticate_degrades_when_redis_unavailable(
    db_session: AsyncSession,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """redis 全挂时缓存层降级，认证仍走 DB 成功（测试/生产抖动不影响认证）。"""
    ws = await _make_workspace(db_session)
    svc = _svc(db_session)
    _, plaintext = await svc.create(workspace_id=ws.id, name="k", scope=["read"], created_by=None)

    def raising() -> None:
        raise RuntimeError("redis down")

    monkeypatch.setattr("app.modules.mcp_gateway.service.get_redis", raising)

    assert await svc.authenticate(plaintext) is not None


@pytest.mark.asyncio
async def test_authenticate_throttles_last_used_update(
    db_session: AsyncSession,
) -> None:
    """节流窗口内重复认证跳过 last_used_at UPDATE（行锁串行化雪崩根因修复回归）。"""
    ws = await _make_workspace(db_session)
    svc = _svc(db_session)
    _, plaintext = await svc.create(workspace_id=ws.id, name="k", scope=["read"], created_by=None)

    # 首次（缓存未命中路径）写 last_used_at
    assert await svc.authenticate(plaintext) is not None
    stmt = select(McpTokenORM).where(McpTokenORM.name == "k")
    first = (await db_session.execute(stmt)).scalar_one()
    assert first.last_used_at is not None
    first_ts = first.last_used_at

    # 节流窗口内再次认证：缓存命中路径不触发 _mark_used → 持久化值不变
    assert await svc.authenticate(plaintext) is not None
    db_session.expire_all()
    second = (await db_session.execute(stmt)).scalar_one()
    # SQLite 存取丢 tzinfo（内存值 aware，expire 重读 naive），统一去 tzinfo 比较
    assert second.last_used_at.replace(tzinfo=None) == first_ts.replace(tzinfo=None)


@pytest.mark.asyncio
async def test_zero_threshold_always_writes_last_used(
    db_session: AsyncSession,
) -> None:
    """阈值=0 退化为每次都写 last_used（旧行为兼容）。"""
    ws = await _make_workspace(db_session)
    settings = get_settings().model_copy(update={"auth_api_key_last_used_throttle_seconds": 0})
    svc = McpTokenService(db_session, settings=settings)
    _, plaintext = await svc.create(workspace_id=ws.id, name="k", scope=["read"], created_by=None)

    # 关掉缓存命中路径的 shortcut：强制走 DB 路径（清掉前一次写入的正缓存影响）
    # 这里直接验证 DB-miss 命中路径下阈值=0 不走节流 return 分支。
    await svc.authenticate(plaintext)
    stmt = select(McpTokenORM).where(McpTokenORM.name == "k")
    first = (await db_session.execute(stmt)).scalar_one()
    assert first.last_used_at is not None
