"""bootstrap_admin_and_seed_rbac 按 email OR username 双键查重单测（2026-08-14 quick）。

钉死缺陷修复：库里已有同 username（不同 email）的用户时，仅按 email 查重会漏判 →
INSERT 撞 ``ux_users_username`` 唯一约束阻断启动（2026-08-14 platform-sync-docs-approval
E2E 起 8002 实证）。修复后按 email OR username 查重，命中即复用不重建。
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.modules.auth.model import User
from app.modules.auth.service import bootstrap_admin_and_seed_rbac

_REQUIRED: dict[str, str] = {
    "database_url": "postgresql+asyncpg://u:p@localhost:5432/db",
    "secret_key": "x" * 32,
}


def _settings(email: str) -> Settings:
    return Settings(
        **_REQUIRED,
        platform_bootstrap_admin_email=email,
        platform_bootstrap_admin_password="SillyHub#Boot2026!xK9",
        platform_bootstrap_admin_display_name="Admin",
    )


async def test_existing_same_username_different_email_reused(db_session: AsyncSession) -> None:
    """库里已有同 username（不同 email）admin → 复用该用户，不 INSERT 撞唯一约束。"""
    # 预置：username=admin（历史上 seed 用的 email 与当前配置不同）
    db_session.add(
        User(
            email="old-admin@sillyhub.local",
            username="admin",
            password_hash="x",
            display_name="Old Admin",
            status="active",
            is_platform_admin=True,
        )
    )
    await db_session.commit()

    # 当前配置 email=admin@example.com（本地段仍是 admin）→ 应复用旧行不重建
    await bootstrap_admin_and_seed_rbac(db_session, settings=_settings("admin@example.com"))

    rows = (await db_session.execute(User.__table__.select())).all()
    admin_rows = [r for r in rows if r.username == "admin"]
    assert len(admin_rows) == 1, "同 username 用户必须复用，不得 INSERT 第二行"
    assert admin_rows[0].email == "old-admin@sillyhub.local"


async def test_existing_same_email_reused(db_session: AsyncSession) -> None:
    """库里已有同 email 用户 → 复用（原语义保持，幂等 bootstrap）。"""
    db_session.add(
        User(
            email="admin@example.com",
            username="someoneelse",
            password_hash="x",
            display_name="Some One",
            status="active",
        )
    )
    await db_session.commit()

    await bootstrap_admin_and_seed_rbac(db_session, settings=_settings("admin@example.com"))

    rows = (await db_session.execute(User.__table__.select())).all()
    email_rows = [r for r in rows if r.email == "admin@example.com"]
    assert len(email_rows) == 1, "同 email 用户必须复用"


async def test_fresh_db_creates_admin(db_session: AsyncSession) -> None:
    """空库 → 正常建 admin（email 本地段作 username）。"""
    await bootstrap_admin_and_seed_rbac(db_session, settings=_settings("boot@sillyhub.local"))
    rows = (await db_session.execute(User.__table__.select())).all()
    assert len(rows) == 1
    assert rows[0].username == "boot"
    assert rows[0].email == "boot@sillyhub.local"
