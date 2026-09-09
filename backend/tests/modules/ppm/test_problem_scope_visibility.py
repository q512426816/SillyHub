"""``problem_scope_clause`` 可见性等价性测试（ql-20260909-010-a318）。

``now_handle_user`` 分支原实现是对 ``concat(',', coalesce(col, ''), ',')``
表达式做 ``'%,uid,%'`` 前导通配 LIKE——表达式不可走列索引，OR 中存在该分支
导致非超管问题列表全表顺序扫描。本 quick 改写为裸列 4 分支 OR
（``%,uid,%`` / ``uid,%`` / ``%,uid`` / ``== uid``），语义与原 wrapped 形式
严格等价。本测试锁定等价性：

- uid 在 CSV 中 4 种位置（唯一/开头/结尾/中间）均命中；
- NULL / 空串不命中；
- UUID 子串误匹配防护（uid 是同列另一 UUID 的前缀/后缀）不命中；
- 其余 3 个等值分支（created_by / duty_user_id / audit_user_id）回归覆盖。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import password_hasher
from app.modules.auth.model import User
from app.modules.ppm.common.data_scope import problem_scope_clause
from app.modules.ppm.problem.model import PpmProblemList

_UID = "<UID>"  # parametrize 占位符，运行前替换为真实 uid


async def _mk_user(session: AsyncSession) -> User:
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        id=uuid.uuid4(),
        email=f"scope-{uuid.uuid4().hex[:8]}@test.local",
        password_hash=password_hasher.hash("Xx1!aaaa"),
        display_name="范围用户",
        status="active",
        is_platform_admin=False,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _mk_problem(
    session: AsyncSession,
    *,
    now_handle_user: str | None,
    created_by: uuid.UUID | None = None,
    duty_user_id: uuid.UUID | None = None,
    audit_user_id: uuid.UUID | None = None,
) -> PpmProblemList:
    p = PpmProblemList(
        id=uuid.uuid4(),
        project_id=uuid.uuid4(),
        now_handle_user=now_handle_user,
        created_by=created_by,
        duty_user_id=duty_user_id,
        audit_user_id=audit_user_id,
    )
    session.add(p)
    await session.commit()
    return p


async def _visible_ids(session: AsyncSession, user: User) -> set[uuid.UUID]:
    clause = await problem_scope_clause(session, user)
    rows = (await session.execute(select(PpmProblemList).where(clause))).scalars().all()
    return {row.id for row in rows}


@pytest.mark.parametrize(
    ("now_handle_user", "expect_visible"),
    [
        # uid 在 CSV 4 种位置——与原 wrapped '%,uid,%' 形式等价命中
        (_UID, True),  # 唯一
        (f"{_UID},11111111-1111-1111-1111-111111111111", True),  # 开头
        (f"11111111-1111-1111-1111-111111111111,{_UID}", True),  # 结尾
        (
            f"11111111-1111-1111-1111-111111111111,{_UID},22222222-2222-2222-2222-222222222222",
            True,
        ),  # 中间
        # 不命中：NULL / 空串（原 coalesce→",," 不匹配）
        (None, False),
        ("", False),
        # 不命中：UUID 子串误匹配防护——uid 仅是同列另一 UUID 的前缀/后缀
        (f"{_UID}-33333333", False),
        (f"33333333{_UID}", False),
        # 不命中：完全不相关
        ("11111111-1111-1111-1111-111111111111", False),
    ],
)
async def test_now_handle_user_positions(
    db_session: AsyncSession, now_handle_user: str | None, expect_visible: bool
) -> None:
    user = await _mk_user(db_session)
    problem = await _mk_problem(
        db_session,
        now_handle_user=now_handle_user.replace(_UID, str(user.id)) if now_handle_user else None,
    )
    visible = await _visible_ids(db_session, user)
    assert (problem.id in visible) is expect_visible


async def test_other_branches_visibility(db_session: AsyncSession) -> None:
    """created_by / duty_user_id / audit_user_id 等值分支 + 全不沾不可见。"""
    user = await _mk_user(db_session)
    by_created = await _mk_problem(db_session, now_handle_user=None, created_by=user.id)
    by_duty = await _mk_problem(db_session, now_handle_user=None, duty_user_id=user.id)
    by_audit = await _mk_problem(db_session, now_handle_user=None, audit_user_id=user.id)
    stranger = uuid.uuid4()
    unrelated = await _mk_problem(
        db_session,
        now_handle_user=str(stranger),
        created_by=stranger,
        duty_user_id=stranger,
        audit_user_id=stranger,
    )
    visible = await _visible_ids(db_session, user)
    assert {by_created.id, by_duty.id, by_audit.id} <= visible
    assert unrelated.id not in visible
