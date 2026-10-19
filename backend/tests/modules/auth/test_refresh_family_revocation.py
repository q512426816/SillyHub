"""会话族（family）语义测试（TDD 红阶段）——2026-10-16-fix-auth-random-logout task-02。

覆盖来源
--------
- 需求：
  - ``FR-01``（会话族建模）：login 开新族（uuid4）、refresh rotate/grace 续期继承族、
    存量 NULL 行自成一族（``family_id or id`` 兜底两形态）。
  - ``FR-02``（复用检测族级吊销）：旧 token 超 grace 复用只灭本族，同用户异族存活。
  - ``FR-03``（宽限窗默认 300s）。
- 决策：``D-001@v1``（family_id 列）/ ``D-002@v1``（族级吊销 + 文案）/ ``D-003@v1``（默认 300）。
- 设计：``design.md`` §总体方案 Phase 1、§数据模型（谓词 ``user_id=? AND revoked_at IS NULL
  AND (family_id=? OR (family_id IS NULL AND id=?))``）、§生命周期契约表 reuse 行。
- Grill：B-001（调用处 ``revoked.family_id or revoked.id`` 兜底不得省——T3 专测）。

TDD 顺序
--------
- **本任务 = 红**：service 尚未写族（login/refresh 产出的行 family_id 全为 NULL、复用分支
  仍 revoke_all）→ 用例 1/2/3 应 FAIL。
- 实现后转绿。

约束
----
- 只测 service 层（直接构造 AuthService），不经 HTTP。
- 复用根 ``backend/conftest.py`` 的 ``db_session`` fixture（内存 SQLite）。
- grace 窗显式设 60s（用例内 settings.auth_refresh_grace_seconds），与默认值变更解耦。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import AuthRefreshReused
from app.core.security import (
    generate_refresh_token,
    hash_refresh_token,
    hmac_token_id,
    password_hasher,
)
from app.modules.auth.model import Session as SessionRow
from app.modules.auth.model import User
from app.modules.auth.service import AuthService

_TEST_PASSWORD = "Xx1!abcd"
_UA = "pytest-ua"
_IP = "1.1.1.1"


async def _make_user(db: AsyncSession, *, username: str) -> User:
    """建一个 active user（bcrypt rounds 已由 AuthService 构造时 configure）。"""
    user = User(
        id=uuid.uuid4(),
        email=f"{username}@example.com",
        username=username,
        password_hash=password_hasher.hash(_TEST_PASSWORD),
        status="active",
        login_enabled=True,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


def _svc(db: AsyncSession) -> AuthService:
    settings = get_settings()
    # grace 窗显式 60s：与默认值（300）解耦，超窗判定用 now-61s 稳定复现。
    settings.auth_refresh_grace_seconds = 60
    return AuthService(db, settings=settings)


async def _login(service: AuthService, *, account: str) -> str:
    """login 并返回 refresh token。"""
    _user, pair = await service.login(
        account=account, password=_TEST_PASSWORD, user_agent=_UA, ip=_IP
    )
    return pair.refresh_token


async def _make_legacy_session(db: AsyncSession, *, user_id: uuid.UUID) -> tuple[str, SessionRow]:
    """插入一行**存量形态**（family_id=NULL）的 live session，返回 (refresh_token, row)。

    对齐 D-001 兜底语义：NULL 行自成一族（读取侧 ``family_id or id``）。
    """
    token, token_id = generate_refresh_token()
    row = SessionRow(
        id=uuid.uuid4(),
        user_id=user_id,
        refresh_token_hash=hash_refresh_token(token),
        token_id_hmac=hmac_token_id(token_id, get_settings()),
        family_id=None,
        created_at=datetime.now(UTC),
        expires_at=datetime.now(UTC) + timedelta(days=7),
    )
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return token, row


async def _active_count(db: AsyncSession, *, user_id: uuid.UUID) -> int:
    stmt = (
        select(func.count())
        .select_from(SessionRow)
        .where(SessionRow.user_id == user_id, SessionRow.revoked_at.is_(None))
    )
    return int((await db.execute(stmt)).scalar_one())


async def _mature_rotation(db: AsyncSession, *, session_id: uuid.UUID, seconds: int) -> None:
    """把指定行的 rotated_at 摆到 now-seconds（seconds>grace 即超窗）。"""
    row = (await db.execute(select(SessionRow).where(SessionRow.id == session_id))).scalar_one()
    row.rotated_at = datetime.now(UTC) - timedelta(seconds=seconds)
    await db.commit()


async def _latest_session(db: AsyncSession, *, user_id: uuid.UUID) -> SessionRow:
    stmt = (
        select(SessionRow)
        .where(SessionRow.user_id == user_id)
        .order_by(SessionRow.created_at.desc(), SessionRow.id.desc())
        .limit(1)
    )
    return (await db.execute(stmt)).scalar_one()


# ── 用例 1：族隔离——超窗复用只灭本族，异族（另一次登录）存活（FR-02 核心） ──


async def test_reuse_beyond_grace_revokes_only_hit_family(db_session: AsyncSession):
    """设备 A 族旧 token 超窗复用 → A 族全灭；设备 B 族（另一次 login）不受牵连。"""
    service = _svc(db_session)
    user = await _make_user(db_session, username="fam1")

    # 设备 A：t1 login（族 F1）→ rotate → 旧 t1 超窗复用。
    t1 = await _login(service, account="fam1")
    # 设备 B：第二次 login（族 F2；token 本身不参与后续步骤，仅建立异族会话）。
    await _login(service, account="fam1")

    # 记录两族 id。
    rows = (
        (await db_session.execute(select(SessionRow).where(SessionRow.user_id == user.id)))
        .scalars()
        .all()
    )
    fam_a = [r for r in rows if r.family_id is not None]
    assert len(fam_a) >= 2, "login 应产出非空 family_id（红阶段此断言失败）"
    # t1/t2 两行 family 不同（两次登录两族）。
    assert len({r.family_id for r in fam_a}) == 2

    # rotate t1 → S1 revoked+rotated，child S3 同族。
    await service.refresh(refresh_token=t1, user_agent=_UA, ip=_IP)
    # 找到被 rotate 的行（revoked 非空且 family=F1）。
    rotated = (
        (
            await db_session.execute(
                select(SessionRow).where(
                    SessionRow.user_id == user.id, SessionRow.revoked_at.is_not(None)
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rotated) == 1
    s1 = rotated[0]
    await _mature_rotation(db_session, session_id=s1.id, seconds=61)

    # 超窗复用 → AuthRefreshReused。
    with pytest.raises(AuthRefreshReused):
        await service.refresh(refresh_token=t1, user_agent=_UA, ip=_IP)

    # 断言：F1 族全灭（S1 + child），F2（t2 登录）存活。
    f1_rows = (
        (
            await db_session.execute(
                select(SessionRow).where(
                    SessionRow.user_id == user.id,
                    (SessionRow.family_id == s1.family_id) | (SessionRow.id == s1.id),
                )
            )
        )
        .scalars()
        .all()
    )
    assert all(r.revoked_at is not None for r in f1_rows), "命中族应全部吊销"
    # t2 的行仍 active。
    t2_row = next(r for r in rows if r.id != s1.id and r.family_id != s1.family_id)
    await db_session.refresh(t2_row)
    assert t2_row.revoked_at is None, "同用户异族 session 不应被牵连"
    # 活跃数：t2 + child？——child 属 F1 已被灭；只剩 t2 登录族 1 条。
    assert await _active_count(db_session, user_id=user.id) == 1


# ── 用例 2：grace 续期继承族（FR-01） ──


async def test_grace_reissue_inherits_family(db_session: AsyncSession):
    """rotate 后 grace 窗内旧 token 重签新对：新行继承被消费族，且不吊销任何行。"""
    service = _svc(db_session)
    user = await _make_user(db_session, username="fam2")

    t1 = await _login(service, account="fam2")
    login_row = (
        (await db_session.execute(select(SessionRow).where(SessionRow.user_id == user.id)))
        .scalars()
        .one()
    )
    assert login_row.family_id is not None, "login 应开新族（红阶段失败）"

    # 正常 rotate。
    await service.refresh(refresh_token=t1, user_agent=_UA, ip=_IP)
    rotated = (
        (
            await db_session.execute(
                select(SessionRow).where(
                    SessionRow.user_id == user.id, SessionRow.revoked_at.is_not(None)
                )
            )
        )
        .scalars()
        .one()
    )
    assert rotated.family_id == login_row.family_id, "rotate child 应继承族"

    # rotated_at 摆到 now（窗内）→ grace 续期。
    await _mature_rotation(db_session, session_id=rotated.id, seconds=0)
    _user2, pair2 = await service.refresh(refresh_token=t1, user_agent=_UA, ip=_IP)
    assert pair2.access_token

    # grace 新签发的行也继承族；且无新增吊销波及（窗内不灭族）。
    newest = await _latest_session(db_session, user_id=user.id)
    assert newest.family_id == login_row.family_id, "grace 新行应继承族"
    assert newest.revoked_at is None


# ── 用例 3：存量 NULL 行自成一族，子代同族；超窗复用只灭本族（D-001 兜底 + B-001） ──


async def test_legacy_null_session_self_family_and_children(db_session: AsyncSession):
    """family_id=NULL 旧行：自身按 id 兜底命中，子代继承其 id；异族（新登录）不牵连。"""
    service = _svc(db_session)
    user = await _make_user(db_session, username="fam3")

    legacy_token, legacy_row = await _make_legacy_session(db_session, user_id=user.id)
    await _login(service, account="fam3")  # 异族（新格式登录；token 不参与后续步骤）

    # rotate 存量行 → child 应继承 family = legacy_row.id。
    await service.refresh(refresh_token=legacy_token, user_agent=_UA, ip=_IP)
    await db_session.refresh(legacy_row)
    assert legacy_row.revoked_at is not None and legacy_row.rotated_at is not None
    child = (
        (
            await db_session.execute(
                select(SessionRow).where(
                    SessionRow.user_id == user.id, SessionRow.family_id == legacy_row.id
                )
            )
        )
        .scalars()
        .one()
    )  # 红阶段：无任何行 family=legacy.id → NoResultFound（即 FAIL）
    assert child.family_id == legacy_row.id, "child 应继承存量行 id 作为族（红阶段失败）"

    # 超窗复用存量 token → 只灭 legacy 族（含 child）；异族存活。
    await _mature_rotation(db_session, session_id=legacy_row.id, seconds=61)
    with pytest.raises(AuthRefreshReused):
        await service.refresh(refresh_token=legacy_token, user_agent=_UA, ip=_IP)

    await db_session.refresh(child)
    assert child.revoked_at is not None, "子代（family=legacy.id）应被族吊销命中"

    other_row = (
        (
            await db_session.execute(
                select(SessionRow).where(
                    SessionRow.user_id == user.id,
                    SessionRow.family_id.is_not(None),
                    SessionRow.revoked_at.is_(None),
                )
            )
        )
        .scalars()
        .one()
    )
    assert other_row.revoked_at is None, "异族登录不应被牵连"


# ── 用例 4：每次 login 开新族（FR-01） ──


async def test_each_login_opens_new_family(db_session: AsyncSession):
    service = _svc(db_session)
    user = await _make_user(db_session, username="fam4")

    t1 = await _login(service, account="fam4")
    t2 = await _login(service, account="fam4")
    assert t1 != t2

    rows = (
        (await db_session.execute(select(SessionRow).where(SessionRow.user_id == user.id)))
        .scalars()
        .all()
    )
    fams = [r.family_id for r in rows]
    assert all(f is not None for f in fams), "login 行 family_id 应非空（红阶段失败）"
    assert len(set(fams)) == 2, "两次登录应为两个不同族"
