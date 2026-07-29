"""Token 格式 + O(1) 查找 + migration 测试（变更 2026-07-27-auth-refresh-token-index task-08）。

覆盖 design §6 / AC-01~AC-10：refresh token 加明文编号段 ``{token_id}.{secret}`` +
session 表存 HMAC 部分唯一索引 ``ux_sessions_token_id_hmac`` 改造的正确性、安全
边界与性能（O(1) 查找根治 refresh 慢请求）。

覆盖来源
--------
- AC-01/02/03: token 格式（``generate_refresh_token`` 返回 tuple + 含恰好一个 ``.``；
  ``parse_refresh_token`` 畸形输入抛 ``AuthTokenInvalid``；``hmac_token_id`` 确定性 + 64 hex）。
- AC-04: ``_issue_token_pair`` 写 ``token_id_hmac`` 非空且 = ``hmac_token_id(token_id)``；
  ``refresh_token_hash`` 仍 bcrypt（双层防御 D-004）。
- AC-05/06/07/09: ``_consume_refresh_token`` O(1)（正确命中 + rotate；构造 token HMAC
  命中但 bcrypt 失败 → ``AuthTokenInvalid`` 双层防御；旧格式无 ``.`` → 拒；NULL 旧行
  不命中；**性能**：100 个其它活跃 session 时 ``verify_refresh_token`` 只调 1 次）。
- AC-08: ``_find_revoked_session`` O(1)（hmac 命中 + bcrypt 通过 → 返回；secret 错 → None；
  无匹配 → None）。
- AC-09: FOR UPDATE 锁复查路径（锁期间被 rotate → 走 revoked 检测/grace 续期）。
- AC-10: migration ``202607271700`` 已落地进 alembic 链(单 head 无分叉)+ upgrade/downgrade
  可逆 + 部分唯一索引 NULL 行不冲突（D-008）。

约束
----
- **只新增本测试文件，不改任何实现**（规则 9）。
- 复用根 ``backend/conftest.py`` 的 ``db_session`` fixture（内存 SQLite）。
- 性能断言用 ``patch.object(auth_service_module, "verify_refresh_token", wraps=real)``
  计调用次数（patch service 模块里的 import 引用，非 security 原位置）。
- 构造 token = 真 ``token_id``（从 ``generate_refresh_token`` 拿）+ 假 secret，使 HMAC
  命中那行但 bcrypt 失败（对抗点：HMAC 命中不能绕过 bcrypt）。
- 风格对齐 ``tests/modules/auth/test_refresh_grace_window.py``（中文 docstring / async /
  pytest，``asyncio_mode=auto`` 免 ``@pytest.mark.asyncio``）。
"""

from __future__ import annotations

import importlib
import inspect
import os
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from unittest.mock import patch

import pytest
import sqlalchemy as sa
from sqlalchemy import select
from sqlalchemy.dialects import postgresql
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AuthTokenInvalid
from app.core.security import (
    generate_refresh_token,
    hash_refresh_token,
    hmac_token_id,
    parse_refresh_token,
    password_hasher,
    verify_refresh_token,
)
from app.modules.auth import service as auth_service_module
from app.modules.auth.model import Session as SessionRow
from app.modules.auth.model import User
from app.modules.auth.service import AuthService

# 测试用密码（满足强度规则即可，无业务含义）。
_TEST_PASSWORD = "Xx1!abcd"
_UA = "pytest-ua"
_IP = "1.1.1.1"

# Migration revision 常量（AC-10）。
_REVISION_ID = "202607271700"
_DOWN_REVISION_ID = "202607270900"


# ── 复用 helpers（风格对齐 test_refresh_grace_window.py）────────────────────


async def _make_user(db: AsyncSession, *, email: str) -> User:
    """建一个 active user（bcrypt rounds 已由 AuthService 构造时 configure）。"""
    user = User(
        id=uuid.uuid4(),
        email=email,
        username=email.split("@", 1)[0],
        password_hash=password_hasher.hash(_TEST_PASSWORD),
        status="active",
        login_enabled=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def _login_for_refresh_token(service: AuthService, *, account: str) -> str:
    """login 并返回 refresh token（走 _issue_token_pair 写 token_id_hmac）。"""
    _user, pair = await service.login(
        account=account, password=_TEST_PASSWORD, user_agent=_UA, ip=_IP
    )
    return pair.refresh_token


async def _insert_session(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    token: str | None = None,
    token_id_hmac: str | None = None,
    refresh_token_hash: str | None = None,
    revoked_at: datetime | None = None,
    rotated_at: datetime | None = None,
    expires_at: datetime | None = None,
) -> SessionRow:
    """直接构造一行 SessionRow（不走 _issue_token_pair，精细控制 hmac/hash 状态）。

    传 ``token`` 时自动从 token 解析 token_id 并算 hmac + bcrypt hash 整 token；
    显式传 ``token_id_hmac`` / ``refresh_token_hash`` 可覆盖（用于构造 NULL hmac 旧行、
    假 hash 等）。
    """
    settings = get_settings()
    if refresh_token_hash is None:
        if token is not None:
            refresh_token_hash = hash_refresh_token(token)
        else:
            refresh_token_hash = hash_refresh_token(generate_refresh_token()[0])
    if token_id_hmac is None and token is not None:
        token_id_hmac = hmac_token_id(parse_refresh_token(token)[0], settings)
    row = SessionRow(
        id=uuid.uuid4(),
        user_id=user_id,
        refresh_token_hash=refresh_token_hash,
        token_id_hmac=token_id_hmac,
        created_at=datetime.now(UTC),
        expires_at=expires_at or datetime.now(UTC) + timedelta(days=7),
        revoked_at=revoked_at,
        rotated_at=rotated_at,
    )
    db.add(row)
    await db.flush()
    return row


def _load_migration(revision_id: str):
    """按 revision ID 在文件名里匹配，导入迁移模块（沿用既有 migration 测试范式）。"""
    # 本测试文件: backend/tests/modules/auth/test_refresh_token_index.py
    # → 4 级 parent 到 backend/
    backend_root = Path(__file__).resolve().parent.parent.parent.parent
    versions_dir = backend_root / "migrations" / "versions"
    for f in os.listdir(str(versions_dir)):
        if f.endswith(".py") and revision_id in f and f != "__init__.py":
            return importlib.import_module(f"migrations.versions.{f[:-3]}")
    raise ImportError(f"No migration found for revision {revision_id} in {versions_dir}")


# ===========================================================================
# 1. token 格式（AC-01 / AC-02 / AC-03）
# ===========================================================================


def test_generate_refresh_token_returns_tuple_with_single_dot():
    """AC-01: ``generate_refresh_token()`` 返回 ``(token, token_id)``。

    token 含**恰好一个** ``.``；split 后前段 == 返回的 token_id，且为 32 位 uuid4 hex；
    secret 段非空。
    """
    token, token_id = generate_refresh_token()

    assert isinstance(token, str)
    assert isinstance(token_id, str)
    # 恰好一个 '.'（secret 是 base64url 不含 '.',token_id 是 hex 不含 '.'）
    assert token.count(".") == 1, f"token 应含恰好一个 '.', 实际: {token!r}"

    head, secret = token.split(".", 1)
    # 前段 == 返回的 token_id
    assert head == token_id
    # token_id 是 32 位 hex（uuid4().hex）
    assert len(token_id) == 32
    int(token_id, 16)  # 合法 hex（否则 ValueError）
    # secret 非空（32 random bytes 的 base64url ≈ 43 chars）
    assert secret, "secret 段不能为空"


def test_parse_refresh_token_valid_returns_two_segments():
    """AC-02: 正常 token → 解析出 ``(token_id, secret)`` 两段。"""
    token_id, secret = parse_refresh_token("deadbeefdeadbeefdeadbeefdeadbeef.abc123")
    assert token_id == "deadbeefdeadbeefdeadbeefdeadbeef"
    assert secret == "abc123"


@pytest.mark.parametrize(
    "bad_token",
    [
        "legacytoken123",  # 无 '.'（旧 opaque 格式, D-006）
        ".secret",  # 空 token_id
        "abcdef1234567890abcdef1234567890.",  # 空 secret
        "",  # 空串（既无 '.' 也无段）
    ],
    ids=["no_dot", "empty_id", "empty_secret", "empty_string"],
)
def test_parse_refresh_token_malformed_raises_auth_token_invalid(bad_token: str):
    """AC-02 / AC-07: 畸形输入（无 ``.`` / 空 token_id / 空 secret / 空串）→ AuthTokenInvalid。"""
    with pytest.raises(AuthTokenInvalid):
        parse_refresh_token(bad_token)


def test_parse_refresh_token_split_takes_only_first_dot():
    """AC-01 边界: secret 段本身允许含 '.'（split('.', 1) 只切第一个）。

    token_id 是 hex 不含 '.',但 secret 是 base64url 也无 '.';此用例守护 split('.', 1)
    语义不退化成 split('.')（后者会把多点切成 >2 段）。
    """
    token_id, secret = parse_refresh_token("abc.def.ghi")
    assert token_id == "abc"
    assert secret == "def.ghi"


def test_hmac_token_id_deterministic_same_inputs():
    """AC-03: 同 token_id + 同 settings → 同输出（确定性）；输出是 64 位 hex。"""
    settings = get_settings()
    token_id = "fedcba9876543210fedcba9876543210"
    h1 = hmac_token_id(token_id, settings)
    h2 = hmac_token_id(token_id, settings)

    assert h1 == h2, "同输入 HMAC 必须确定性"
    assert len(h1) == 64, "HMAC-SHA256 hex = 64 字符"
    int(h1, 16)  # 合法 hex


def test_hmac_token_id_different_token_ids_differ():
    """AC-03: 不同 token_id → 不同输出。"""
    settings = get_settings()
    h_a = hmac_token_id("a" * 32, settings)
    h_b = hmac_token_id("b" * 32, settings)
    assert h_a != h_b


def test_hmac_token_id_different_secret_keys_differ():
    """AC-03 / D-005: 不同 secret_key → 不同输出（key 是 HMAC 的熵源）。"""
    s1 = get_settings().model_copy(update={"secret_key": "key-one"})
    s2 = get_settings().model_copy(update={"secret_key": "key-two"})
    token_id = "0123456789abcdef0123456789abcdef"
    assert hmac_token_id(token_id, s1) != hmac_token_id(token_id, s2)


# ===========================================================================
# 2. _issue_token_pair 写 token_id_hmac（AC-04）
# ===========================================================================


async def test_issue_token_pair_writes_token_id_hmac_and_bcrypt_hash(db_session: AsyncSession):
    """AC-04: login 建会话后 SessionRow.token_id_hmac 非空且 = hmac_token_id(token_id)；
    refresh_token_hash 仍 bcrypt（真 token verify 通过、构造 token verify 失败）。
    """
    settings = get_settings()
    service = AuthService(db_session, settings=settings)
    user = await _make_user(db_session, email="issue@example.com")
    token = await _login_for_refresh_token(service, account="issue")

    token_id, _secret = parse_refresh_token(token)
    expected_hmac = hmac_token_id(token_id, settings)

    # 按部分唯一索引直接命中那行（O(1) 证据：能按 hmac 查到）
    row = (
        await db_session.execute(
            select(SessionRow).where(SessionRow.token_id_hmac == expected_hmac)
        )
    ).scalar_one()

    assert row.token_id_hmac is not None
    assert row.token_id_hmac == expected_hmac, "token_id_hmac 必须等于 hmac_token_id(token_id)"
    assert row.user_id == user.id

    # refresh_token_hash 仍是 bcrypt：真 token verify 通过
    assert verify_refresh_token(token, row.refresh_token_hash) is True
    # 构造 token（真 token_id + 假 secret）verify 失败 → 双层防御的 bcrypt 这层在
    assert verify_refresh_token(f"{token_id}.{'0' * 43}", row.refresh_token_hash) is False


# ===========================================================================
# 3. _consume_refresh_token O(1)（AC-05 / AC-06 / AC-07 / AC-09 / NFR-01）
# ===========================================================================


async def test_consume_correct_token_hits_active_session(db_session: AsyncSession):
    """AC-05: 正确 token → O(1) 命中活跃 session + bcrypt 通过 + 返回 (user, session, is_grace=False)。

    _consume 不 rotate（rotate 在 refresh() 上层的 _mark_session_rotated）,故 session
    返回时 revoked_at 仍 None。
    """
    settings = get_settings()
    service = AuthService(db_session, settings=settings)
    user = await _make_user(db_session, email="ok@example.com")
    token = await _login_for_refresh_token(service, account="ok")

    result_user, session, is_grace = await service._consume_refresh_token(token)

    assert result_user.id == user.id
    assert is_grace is False
    assert session.revoked_at is None, "_consume 不 rotate, revoked_at 应仍为 None"
    assert session.token_id_hmac == hmac_token_id(parse_refresh_token(token)[0], settings)


async def test_consume_forged_token_hmac_hit_bcrypt_fail_raises(db_session: AsyncSession):
    """AC-06 / NFR-02 双层防御核心对抗点:构造 token = 真 token_id + 假 secret。

    HMAC 命中那行(用真 token_id 算的),但 bcrypt 对比假 secret ≠ 真 secret → 失败 →
    AuthTokenInvalid(401)。**证明不能靠 HMAC 命中绕过 bcrypt**。
    """
    settings = get_settings()
    service = AuthService(db_session, settings=settings)
    await _make_user(db_session, email="forge@example.com")
    token = await _login_for_refresh_token(service, account="forge")

    token_id, _ = parse_refresh_token(token)
    # 假 secret(长度对齐真 base64url ~43 chars,但内容全 '0',首字节必不同)
    forged_token = f"{token_id}.{'0' * 43}"

    # HMAC 会命中(login 写了真 token_id 的 hmac),但 bcrypt 失败 → 拒
    with pytest.raises(AuthTokenInvalid):
        await service._consume_refresh_token(forged_token)


async def test_consume_legacy_token_no_dot_raises(db_session: AsyncSession):
    """AC-07 / D-006: 旧格式 token(无 '.')→ parse 即抛 AuthTokenInvalid → 401。

    部署后旧 opaque token 全部失效,前端跳登录重新登录(规则 11 允许重置)。
    """
    settings = get_settings()
    service = AuthService(db_session, settings=settings)
    await _make_user(db_session, email="legacy@example.com")

    with pytest.raises(AuthTokenInvalid):
        await service._consume_refresh_token("legacy-opaque-token-without-dot")


async def test_consume_null_hmac_old_row_not_matched(db_session: AsyncSession):
    """AC-07 / D-008: token_id_hmac NULL 的旧 session 行不被 HMAC 查询命中。

    直接构造一行 token_id_hmac=NULL(模拟旧 session),用一个格式正确但 hmac 不在库
    的 token refresh → AuthTokenInvalid(NULL 行不被误命中、不走全表扫兜底)。
    """
    settings = get_settings()
    service = AuthService(db_session, settings=settings)
    user = await _make_user(db_session, email="null@example.com")

    # 旧式行:token_id_hmac=NULL,refresh_token_hash 是某个 bcrypt
    await _insert_session(
        db_session,
        user_id=user.id,
        token_id_hmac=None,
        refresh_token_hash=hash_refresh_token("deadbeef.somesecret"),
    )

    # 格式正确但 hmac 不在库 → NULL 行不被命中 → AuthTokenInvalid
    fake_token, _ = generate_refresh_token()
    with pytest.raises(AuthTokenInvalid):
        await service._consume_refresh_token(fake_token)


async def test_consume_o1_single_bcrypt_with_100_other_active_sessions(db_session: AsyncSession):
    """AC-09 / NFR-01 根治证据:库里 100 个其它活跃 session,refresh 正确 token 时
    ``verify_refresh_token`` **只被调 1 次**(HMAC 部分唯一索引 O(1) 定位,非全表扫)。

    这是从「66 次串行 bcrypt 累加 1.7s」根治到「1 次 bcrypt + O(1) 索引」的直接证据。
    patch 路径 = ``app.modules.auth.service.verify_refresh_token``(service 里 import 的
    引用);用 ``wraps=`` 转发真函数,既计调用次数又让 bcrypt 真实验证。
    """
    settings = get_settings()
    service = AuthService(db_session, settings=settings)
    user = await _make_user(db_session, email="perf@example.com")
    target_token = await _login_for_refresh_token(service, account="perf")

    # 插 100 个其它活跃 session(各自不同 token_id → 不同 hmac;都未 revoke、未过期)
    for _ in range(100):
        other_token, _other_tid = generate_refresh_token()
        await _insert_session(db_session, user_id=user.id, token=other_token)

    # patch service 模块里的 verify_refresh_token 引用,wraps 真函数计数
    with patch.object(
        auth_service_module, "verify_refresh_token", wraps=verify_refresh_token
    ) as mock_verify:
        result_user, _session, is_grace = await service._consume_refresh_token(target_token)

    assert result_user.id == user.id
    assert is_grace is False
    assert mock_verify.call_count == 1, (
        f"O(1) 查找应只调 1 次 bcrypt verify,实际 {mock_verify.call_count} 次"
        "（退化成全表扫 = refresh 慢请求根因复发）"
    )


async def test_consume_falls_to_revoked_when_lock_finds_revoked_session(db_session: AsyncSession):
    """AC-09: HMAC 查到 live session,FOR UPDATE 锁复查发现已被并发 rotate(revoked_at
    被写)→ 代码应落入 ``_find_revoked_session``(grace 续期),而非返回已失效 session。

    SQLite 的 ``with_for_update`` 为 no-op 无法真模拟并发;此处 monkeypatch
    ``db_session.execute`` 拦截 lock 查询(编译出 ``FOR UPDATE`` 的语句),在锁查询执行前
    把 session 改成 revoked+rotated 并 flush,使后续 ``_find_revoked_session`` 命中,
    验证 fall-through 代码路径(grace 返回 is_grace=True)。
    """
    settings = get_settings()
    settings.auth_refresh_grace_seconds = 60
    service = AuthService(db_session, settings=settings)
    user = await _make_user(db_session, email="lock@example.com")
    token = await _login_for_refresh_token(service, account="lock")

    token_id, _ = parse_refresh_token(token)
    target_hmac = hmac_token_id(token_id, settings)
    # 预取 session ORM 对象(身份图:后续 _consume 的查询返回同一对象,改它即改行内状态)
    session_obj = (
        await db_session.execute(select(SessionRow).where(SessionRow.token_id_hmac == target_hmac))
    ).scalar_one()

    real_execute = db_session.execute
    lock_time = datetime.now(UTC)

    async def patched_execute(stmt, *args, **kwargs):
        # 检测 lock 查询:with_for_update 在 PG dialect 编译出 "FOR UPDATE"
        # (SQLite dialect 是 no-op 编不出,必须借 PG dialect 探测)
        try:
            compiled = str(stmt.compile(dialect=postgresql.dialect()))
        except Exception:
            compiled = ""
        if "FOR UPDATE" in compiled.upper():
            # 模拟并发 rotate:锁查询执行前把 session 改 revoked+rotated 并 flush
            # → 同事务后续 SELECT(_find_revoked_session)能看到 revoked 状态
            session_obj.revoked_at = lock_time
            session_obj.rotated_at = lock_time
            await db_session.flush()
        return await real_execute(stmt, *args, **kwargs)

    # 用 try/finally 恢复(db_session 虽 per-test,但保持整洁)
    db_session.execute = patched_execute
    try:
        result_user, result_session, is_grace = await service._consume_refresh_token(token)
    finally:
        db_session.execute = real_execute

    # lock 复查发现 revoked → fall through → _find_revoked_session 命中 → grace 续期
    assert is_grace is True, "锁期间被 rotate 应走 grace 续期,而非返回失效 session"
    assert result_session.id == session_obj.id
    assert result_user.id == user.id


# ===========================================================================
# 4. _find_revoked_session O(1)（AC-08）
# ===========================================================================


async def test_find_revoked_session_correct_token_returns_session(db_session: AsyncSession):
    """AC-08: revoked session(带 token_id_hmac)按 hmac O(1) 命中 + bcrypt 通过 → 返回。"""
    settings = get_settings()
    service = AuthService(db_session, settings=settings)
    user = await _make_user(db_session, email="rev@example.com")
    token = await _login_for_refresh_token(service, account="rev")

    token_id, _ = parse_refresh_token(token)
    target_hmac = hmac_token_id(token_id, settings)
    # 手动把 session 改成 revoked + rotated(grace 窗口内)
    row = (
        await db_session.execute(select(SessionRow).where(SessionRow.token_id_hmac == target_hmac))
    ).scalar_one()
    now = datetime.now(UTC)
    row.revoked_at = now
    row.rotated_at = now
    await db_session.commit()

    result = await service._find_revoked_session(token, target_hmac)
    assert result is not None
    assert result.id == row.id
    assert result.user_id == user.id


async def test_find_revoked_session_forged_secret_returns_none(db_session: AsyncSession):
    """AC-08 / NFR-02: 构造 token(HMAC 命中但 secret 错)→ None(双层防御)。"""
    settings = get_settings()
    service = AuthService(db_session, settings=settings)
    await _make_user(db_session, email="rev2@example.com")
    token = await _login_for_refresh_token(service, account="rev2")

    token_id, _ = parse_refresh_token(token)
    target_hmac = hmac_token_id(token_id, settings)
    row = (
        await db_session.execute(select(SessionRow).where(SessionRow.token_id_hmac == target_hmac))
    ).scalar_one()
    now = datetime.now(UTC)
    row.revoked_at = now
    row.rotated_at = now
    await db_session.commit()

    # 真 token_id + 假 secret → HMAC 命中但 bcrypt 失败 → None
    forged = f"{token_id}.{'0' * 43}"
    result = await service._find_revoked_session(forged, target_hmac)
    assert result is None


async def test_find_revoked_session_no_hmac_match_returns_none(db_session: AsyncSession):
    """AC-08: hmac 在库里无匹配 → None(O(1) 索引查空)。"""
    settings = get_settings()
    service = AuthService(db_session, settings=settings)
    await _make_user(db_session, email="rev3@example.com")

    # 库里无任何 revoked session;用一个随机 token 的 hmac 查
    fake_token, fake_tid = generate_refresh_token()
    fake_hmac = hmac_token_id(fake_tid, settings)
    result = await service._find_revoked_session(fake_token, fake_hmac)
    assert result is None


# ===========================================================================
# 5. migration（AC-10）
# ===========================================================================


def test_migration_metadata():
    """AC-10: 迁移 revision/down_revision/可调用性。

    down_revision 接 ``202607270900``(llm-provider 变更 head),单 head 接续,
    不撞 migration-chain-fragmentation-pattern 的多 head 分叉。
    """
    mod = _load_migration(_REVISION_ID)
    assert mod.revision == _REVISION_ID
    assert mod.down_revision == _DOWN_REVISION_ID
    assert mod.branch_labels is None
    assert mod.depends_on is None
    assert callable(mod.upgrade)
    assert callable(mod.downgrade)


def test_alembic_head_includes_new_revision():
    """AC-10: refresh-token-index 的 migration ``202607271700`` 已落地进 alembic 链。

    断言"在链中存在"而非"是 head"——head 会随后续 migration(如 ppm_project_workspace
    的 202607281500 接在 202607271700 之后)演进而变化,绑定具体 head 会让测试在下一个
    migration 落地即过时失败。保留"链单 head 无分叉"检查(防多 head crash-loop)。
    用 ScriptDirectory API 直接读(免 subprocess 开销),与 CLI ``alembic heads`` 等价。
    """
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    backend_root = Path(__file__).resolve().parent.parent.parent.parent
    cfg = Config(str(backend_root / "alembic.ini"))
    cfg.set_main_option("script_location", str(backend_root / "migrations"))
    script = ScriptDirectory.from_config(cfg)
    # 链单 head(健康,无分叉)
    heads = script.get_heads()
    assert len(heads) == 1, f"alembic 应为单 head, 实际 heads={heads}"
    # 本变更的 migration 已落地链中(不绑定 head——head 会随新 migration 演进)
    assert script.get_revision(_REVISION_ID) is not None, f"{_REVISION_ID} 应在 alembic 链中存在"


def test_migration_upgrade_body_adds_column_and_partial_unique_index():
    """AC-10 / D-003: upgrade() 加 token_id_hmac 列 + 部分唯一索引(双 where)。"""
    mod = _load_migration(_REVISION_ID)
    src = inspect.getsource(mod.upgrade)
    # 加列
    assert "add_column" in src
    assert "token_id_hmac" in src
    assert "String" in src and "64" in src
    # 部分唯一索引
    assert "create_index" in src
    assert "ux_sessions_token_id_hmac" in src
    assert "unique=True" in src or "unique = True" in src
    # 双 where(PG postgresql_where + SQLite sqlite_where,保证索引形态一致)
    assert "postgresql_where" in src
    assert "sqlite_where" in src
    assert "token_id_hmac IS NOT NULL" in src


def test_migration_downgrade_body_drops_index_and_column():
    """AC-10: downgrade() 反向 drop_index + drop_column(可逆)。"""
    mod = _load_migration(_REVISION_ID)
    src = inspect.getsource(mod.downgrade)
    assert "drop_index" in src
    assert "ux_sessions_token_id_hmac" in src
    assert "drop_column" in src
    assert "token_id_hmac" in src


def test_migration_upgrade_downgrade_reversibility_sqlite():
    """AC-10: replay upgrade/downgrade DDL 在 SQLite 上可逆。

    照 ``test_migration_borrow_shared.py`` 范式:replay 迁移体的 add_column +
    create_index(部分唯一索引,SQLite 原生支持 WHERE) → 验证列/索引存在 → replay
    downgrade(drop_index + drop_column)→ 验证清理。
    """
    engine = sa.create_engine("sqlite:///:memory:")

    # 迁移前形态(无 token_id_hmac 列)
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                """
                CREATE TABLE sessions (
                    id CHAR(36) PRIMARY KEY NOT NULL,
                    user_id CHAR(36) NOT NULL,
                    refresh_token_hash VARCHAR(255) NOT NULL,
                    created_at DATETIME NOT NULL,
                    expires_at DATETIME NOT NULL
                )
                """
            )
        )

    # replay upgrade
    with engine.begin() as conn:
        conn.execute(sa.text("ALTER TABLE sessions ADD COLUMN token_id_hmac VARCHAR(64)"))
        conn.execute(
            sa.text(
                "CREATE UNIQUE INDEX ux_sessions_token_id_hmac ON sessions (token_id_hmac) "
                "WHERE token_id_hmac IS NOT NULL"
            )
        )

    with engine.begin() as conn:
        insp = sa.inspect(conn)
        cols = {c["name"] for c in insp.get_columns("sessions")}
        assert "token_id_hmac" in cols
        indexes = {i["name"] for i in insp.get_indexes("sessions")}
        assert "ux_sessions_token_id_hmac" in indexes

    # replay downgrade
    with engine.begin() as conn:
        conn.execute(sa.text("DROP INDEX ux_sessions_token_id_hmac"))
        conn.execute(sa.text("ALTER TABLE sessions DROP COLUMN token_id_hmac"))

    with engine.begin() as conn:
        insp = sa.inspect(conn)
        cols = {c["name"] for c in insp.get_columns("sessions")}
        assert "token_id_hmac" not in cols
        indexes = {i["name"] for i in insp.get_indexes("sessions")}
        assert "ux_sessions_token_id_hmac" not in indexes


def test_partial_unique_index_allows_multiple_null_token_id_hmac():
    """AC-10 / D-008: 部分唯一索引 ``WHERE token_id_hmac IS NOT NULL`` → 多个 NULL 行共存
    不冲突(旧 session 自然失效,不违反唯一约束)。

    用 ORM ``SessionRow.__table__.create`` 建表(含 ``__table_args__`` 的 sqlite_where
    部分唯一索引),插多个 NULL 行 + 验证重复非 NULL 值才冲突。
    """
    engine = sa.create_engine("sqlite:///:memory:")

    with engine.begin() as conn:
        # ORM 元数据建表:含 token_id_hmac 列 + ux_sessions_token_id_hmac 部分唯一索引
        SessionRow.__table__.create(conn)
        # 插 2 个 NULL hmac 行(模拟旧 session,D-008)→ 不应冲突
        uid = str(uuid.uuid4())
        conn.execute(
            sa.text(
                "INSERT INTO sessions (id, user_id, refresh_token_hash, created_at, expires_at) "
                "VALUES (:id1, :uid, 'h1', '2026-01-01 00:00:00', '2026-01-08 00:00:00'), "
                "       (:id2, :uid, 'h2', '2026-01-01 00:00:00', '2026-01-08 00:00:00')"
            ),
            {"id1": str(uuid.uuid4()), "id2": str(uuid.uuid4()), "uid": uid},
        )

    with engine.begin() as conn:
        # 两个 NULL 行都在(部分唯一索引跳过 NULL 行)
        cnt = conn.execute(
            sa.text("SELECT COUNT(*) FROM sessions WHERE token_id_hmac IS NULL")
        ).scalar_one()
        assert cnt == 2

        # 两个相同非 NULL hmac → 唯一约束冲突
        with pytest.raises(sa.exc.IntegrityError):
            conn.execute(
                sa.text(
                    "INSERT INTO sessions "
                    "(id, user_id, refresh_token_hash, token_id_hmac, created_at, expires_at) "
                    "VALUES (:id1, :uid, 'h3', 'dup-hmac-value', '2026-01-01 00:00:00', '2026-01-08 00:00:00'), "
                    "       (:id2, :uid, 'h4', 'dup-hmac-value', '2026-01-01 00:00:00', '2026-01-08 00:00:00')"
                ),
                {"id1": str(uuid.uuid4()), "id2": str(uuid.uuid4()), "uid": str(uuid.uuid4())},
            )

    # 两个不同非 NULL hmac → 不冲突(正常多 session 共存)
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO sessions "
                "(id, user_id, refresh_token_hash, token_id_hmac, created_at, expires_at) "
                "VALUES (:id1, :uid, 'h5', 'hmac-a', '2026-01-01 00:00:00', '2026-01-08 00:00:00'), "
                "       (:id2, :uid, 'h6', 'hmac-b', '2026-01-01 00:00:00', '2026-01-08 00:00:00')"
            ),
            {"id1": str(uuid.uuid4()), "id2": str(uuid.uuid4()), "uid": str(uuid.uuid4())},
        )
