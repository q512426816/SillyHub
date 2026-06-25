"""Refresh token grace window 行为测试(TDD 红阶段)。

本文件驱动 :class:`AuthService` 的并发/重复刷新在 grace 窗口内外的行为差异,
并守护 ``_consume_refresh_token`` 三元返回改造后 ``logout_session_by_refresh``
调用点不崩。直接构造 service 调用,**不**经 HTTP 层。

覆盖来源
--------
- 需求:
  - ``FR-01``(后端 grace window):grace 内旧 token 重签、不误杀;超 grace 仍吊销
    (用例 1 ↔ GWT-1,用例 2 ↔ GWT-2)。
  - ``FR-07``(logout 调用点适配三元返回):用例 3 守护。
- 决策:
  - ``D-001@v1``(grace 窗口内被 rotate 的旧 refresh token 重新签发新对)。
  - ``D-002@v1``(grace=60s 可配置,``auth_refresh_grace_seconds`` 注入)。
- 设计:
  - ``design.md`` §7(``_consume_refresh_token`` 返回 ``(User, Session, is_grace)``;
    ``refresh()`` 的 ``is_grace`` 分支;``logout_session_by_refresh`` 三元解包)。
  - ``design.md`` §7.5 生命周期契约表。
  - ``design.md`` §10 风险 R-01(grace 内旧 token 可多次换新,接受残余风险)。
  - ``design.md`` §10 风险 R-03(二元改三元可能漏改调用点——用例 3 守护)。

TDD 顺序
--------
- **本任务(task-04)= 红**:此时 service 尚未实现 grace 分支与三元返回,用例 1
  应当 FAIL;用例 2/3 行为可能碰巧接近(见各用例 ``xfail`` 标注)。
- **task-05 = 绿**:service 改造后用例 1/2 转 PASS,用例 3 移除 xfail 后 PASS。

约束
----
- 只测 service 层,不用 ``client`` fixture 发 HTTP 请求。
- 复用根 ``backend/conftest.py`` 的 ``db_session`` fixture(内存 SQLite)。
- 时间模拟直接设 ``session.rotated_at`` 字段,**不**引入 ``freezegun``/``time-machine``。
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
    password_hasher,
)
from app.modules.auth.model import Session as SessionRow
from app.modules.auth.model import User
from app.modules.auth.service import AuthService

# 测试用密码(满足强度规则即可,无业务含义)。
_TEST_PASSWORD = "Xx1!abcd"
# 登录元信息占位值。
_UA = "pytest-ua"
_IP = "1.1.1.1"


async def _make_user(db: AsyncSession, *, email: str) -> User:
    """建一个 active user(bcrypt rounds 已由 AuthService 构造时 configure)。"""
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


async def _make_other_active_session(db: AsyncSession, *, user_id: uuid.UUID) -> SessionRow:
    """插入一行同 user 的 active session(refresh token 不可被被测 token 匹配)。

    用于断言"未误触发 revoke_all"——若 service 误吊销,本行 revoked_at 会变非空。
    """
    row = SessionRow(
        id=uuid.uuid4(),
        user_id=user_id,
        refresh_token_hash=hash_refresh_token(generate_refresh_token()),
        created_at=datetime.now(UTC),
        expires_at=datetime.now(UTC) + timedelta(days=7),
    )
    db.add(row)
    await db.commit()
    return row


async def _login_for_refresh_token(service: AuthService, *, account: str) -> str:
    """login 并返回 refresh token(T1)。"""
    _user, pair = await service.login(
        account=account, password=_TEST_PASSWORD, user_agent=_UA, ip=_IP
    )
    return pair.refresh_token


async def _count_active_sessions(db: AsyncSession, *, user_id: uuid.UUID) -> int:
    stmt = (
        select(func.count())
        .select_from(SessionRow)
        .where(SessionRow.user_id == user_id, SessionRow.revoked_at.is_(None))
    )
    return int((await db.execute(stmt)).scalar_one())


async def _set_rotated_at(db: AsyncSession, *, user_id: uuid.UUID, rotated_at: datetime) -> None:
    """把该 user 下最近一次被 revoke(已 rotate)的 session 行的 rotated_at 摆到指定时刻。

    service 现状的 ``_mark_session_revoked`` 不写 rotated_at(由 task-05 的
    ``_mark_session_rotated`` 补写),故测试手动覆盖该字段以精确控制 grace 窗口内外。
    """
    stmt = (
        select(SessionRow)
        .where(SessionRow.user_id == user_id, SessionRow.revoked_at.is_not(None))
        .order_by(SessionRow.revoked_at.desc())
        .limit(1)
    )
    row = (await db.execute(stmt)).scalars().first()
    assert row is not None, "rotate 后应存在一行 revoked session"
    row.rotated_at = rotated_at
    await db.commit()


# ── 用例 1:grace 内不误杀其它 active session(FR-01 GWT-1) ──────────────────


async def test_refresh_within_grace_does_not_revoke_other_sessions(db_session: AsyncSession):
    """T1 已 rotate(rotated_at=now),60s grace 窗口内再用 T1 refresh。

    RED(service 无 grace 分支):第二次 refresh 走 reuse 路径,抛 ``AuthRefreshReused``
    并触发 ``revoke_all_user_sessions`` → 用例 FAIL(期望返回新对 + Sx 仍 active)。

    GREEN(task-05 后):返回新 TokenPair,T1 对应旧行的 ``is_grace`` 命中,
    Sx 仍 active,active session 数量增加。
    """
    settings = get_settings()
    settings.auth_refresh_grace_seconds = 60
    service = AuthService(db_session, settings=settings)

    user = await _make_user(db_session, email="u1@example.com")
    t1 = await _login_for_refresh_token(service, account="u1")
    sx = await _make_other_active_session(db_session, user_id=user.id)

    # 正常 rotate T1 → 旧行 revoked_at 被写(但 service 现状不写 rotated_at)。
    await service.refresh(refresh_token=t1, user_agent=_UA, ip=_IP)
    # 手动把 rotated_at 摆到 now(grace 窗口内)。
    await _set_rotated_at(db_session, user_id=user.id, rotated_at=datetime.now(UTC))

    # grace 内再用 T1 refresh —— 期望:不抛异常,返回新对。
    _user2, pair2 = await service.refresh(refresh_token=t1, user_agent=_UA, ip=_IP)

    assert pair2.access_token
    assert pair2.refresh_token != t1

    # 断言未误杀:Sx 仍 active。
    await db_session.refresh(sx)
    assert sx.revoked_at is None, "grace 内重复刷新不应吊销其它 active session"
    # 该 user 至少有 Sx + grace 新签发的行 两条 active。
    active_count = await _count_active_sessions(db_session, user_id=user.id)
    assert active_count >= 2, f"grace 续期应新增 active session,实际 {active_count}"


# ── 用例 2:超 grace 仍吊销该用户全部 session(FR-01 GWT-2) ──────────────────


@pytest.mark.xfail(
    reason=(
        "RED 阶段 service 无 grace 判定,但 reuse 路径行为碰巧接近(同样抛 "
        "AuthRefreshReused + revoke_all),本用例可能意外 PASS;task-05 实现 "
        "rotated_at 判定后转确定 PASS。"
    ),
    strict=False,
)
async def test_refresh_beyond_grace_revokes_all_user_sessions(db_session: AsyncSession):
    """T1 已 rotate(rotated_at=now-61s,超 60s grace),再用 T1 refresh。

    期望:``AuthRefreshReused`` + ``revoke_all_user_sessions``(Sx 被吊销)。

    RED 处理:task-05 前 service 无 ``rotated_at`` 判定,但走 reuse 路径行为碰巧
    接近(同样抛 AuthRefreshReused 且 revoke_all 吊销 Sx),故本用例在红阶段可能
    意外 PASS,用 ``xfail(strict=False)`` 标注(参见 task-04.md 边界 5/AC-04-3)。
    """
    settings = get_settings()
    settings.auth_refresh_grace_seconds = 60
    service = AuthService(db_session, settings=settings)

    user = await _make_user(db_session, email="u2@example.com")
    t1 = await _login_for_refresh_token(service, account="u2@example.com")
    sx = await _make_other_active_session(db_session, user_id=user.id)

    await service.refresh(refresh_token=t1, user_agent=_UA, ip=_IP)
    # 手动把 rotated_at 摆到 now-61s(明确超 grace 窗口)。
    await _set_rotated_at(
        db_session, user_id=user.id, rotated_at=datetime.now(UTC) - timedelta(seconds=61)
    )

    # 期望:AuthRefreshReused + revoke_all(Sx 被吊销)。
    with pytest.raises(AuthRefreshReused):
        await service.refresh(refresh_token=t1, user_agent=_UA, ip=_IP)

    await db_session.refresh(sx)
    assert sx.revoked_at is not None, "超 grace 重放应吊销该用户全部 session"


# ── 用例 3:logout 三元解包不抛(FR-07 调用点守护) ──────────────────────────


@pytest.mark.xfail(
    reason=(
        "RED 阶段 service 仍二元返回,_consume_refresh_token 二元解包在 logout 处"
        "恰好成立,用例碰巧 PASS;task-05 改三元返回后,若漏改 logout 解包会暴露"
        "回归,届时本用例稳定 PASS 并移除 xfail。"
    ),
    strict=False,
)
async def test_logout_unpacks_three_tuple_without_error(db_session: AsyncSession):
    """logout_session_by_refresh 守护 ``_consume_refresh_token`` 三元返回改造。

    FR-07:``logout_session_by_refresh`` 内部调 ``_consume_refresh_token`` 返回三元组
    后应解包 ``_, session, _``;若 task-05 漏改仍二元,此处会抛
    ``ValueError: too many values to unpack``——本用例守护该回归。

    断言:logout 不抛 unpack 错误,且 logout 命中已 rotate 的 session 时**不**签发
    新对(DB 中 active session 数量只减不增)。

    RED 处理:task-05 前 service 仍二元,logout 二元解包二元成立,用例意外 PASS,
    用 ``xfail(strict=False)`` 标注(参见 task-04.md 边界 5/AC-04-4)。
    """
    settings = get_settings()
    service = AuthService(db_session, settings=settings)

    user = await _make_user(db_session, email="u3@example.com")
    t1 = await _login_for_refresh_token(service, account="u3@example.com")

    active_before = await _count_active_sessions(db_session, user_id=user.id)

    # 不应抛 ValueError(too many/few values to unpack)。
    await service.logout_session_by_refresh(refresh_token=t1)

    # logout 不签发新对:active 数量只减不增(原 T1 session 被 revoke)。
    active_after = await _count_active_sessions(db_session, user_id=user.id)
    assert active_after <= active_before, "logout 不应签发新 token 对"
