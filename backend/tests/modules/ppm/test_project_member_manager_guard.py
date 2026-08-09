"""项目成员 create/update/delete 经理支配权校验测试(ppm/project/router.py)。

quick 安全加固:成员写操作须「该项目经理或超管」,堵成员自提权/越权改删他人成员。
- 超管(is_platform_admin / super_admin)→ 放行
- 该项目经理(成员 role_name 含 MANAGER_ROLE_NAMES)→ 放行
- 非经理非超管 → 403

复用 test_project_workspace_link.py 的 _require_project_manager 测试范式。
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import User

# 显式注册 incident/release 模型表(同 test_project_workspace_link,规避
# pre-existing NoReferencedTableError 时序缺口)。
from app.modules.incident import model as _incident_model  # noqa: F401
from app.modules.ppm.project.model import PpmProjectMaintenance, PpmProjectMember
from app.modules.release import model as _release_model  # noqa: F401

MEMBER_BASE = "/api/ppm/project-member"


async def _seed_project(session: AsyncSession, code: str = "MG-001") -> PpmProjectMaintenance:
    p = PpmProjectMaintenance(
        id=uuid.uuid4(),
        project_name="成员管理项目",
        project_code=code,
        project_status="进行中",
    )
    session.add(p)
    await session.commit()
    await session.refresh(p)
    return p


async def _mk_user(session: AsyncSession, email: str) -> User:
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        id=uuid.uuid4(),
        email=email,
        password_hash=password_hasher.hash("Xx1!aaaa"),
        display_name="成员用户",
        status="active",
        is_platform_admin=False,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


def _token(user: User) -> str:
    settings = get_settings()
    token, _ = create_access_token(
        user_id=user.id, email=user.email, is_admin=user.is_platform_admin, settings=settings
    )
    return token


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _make_manager(session: AsyncSession, proj: PpmProjectMaintenance, user: User) -> None:
    """把 user 置为该项目经理(role_name 含「项目经理」,命中 MANAGER_ROLE_NAMES)。"""
    session.add(
        PpmProjectMember(
            id=uuid.uuid4(),
            pm_project_id=proj.id,
            user_id=user.id,
            user_name=user.display_name or "项目经理",
            create_name="seed",
            role_name="项目经理",
        )
    )
    await session.commit()


async def _seed_member(
    session: AsyncSession, proj: PpmProjectMaintenance, user: User
) -> PpmProjectMember:
    """为另一普通用户造一条待改/删的成员记录(普通开发角色,非经理)。"""
    member = PpmProjectMember(
        id=uuid.uuid4(),
        pm_project_id=proj.id,
        user_id=user.id,
        user_name=user.display_name or "开发",
        create_name="seed",
        role_name="开发",
    )
    session.add(member)
    await session.commit()
    await session.refresh(member)
    return member


# ── create ───────────────────────────────────────────────────────────────────


async def test_member_create_non_manager_403(client: AsyncClient, db_session: AsyncSession) -> None:
    proj = await _seed_project(db_session)
    outsider = await _mk_user(db_session, "outsider@example.com")
    resp = await client.post(
        MEMBER_BASE,
        json={
            "pm_project_id": str(proj.id),
            "user_id": str(uuid.uuid4()),
            "user_name": "新人",
            "role_name": "开发",
        },
        headers=_headers(_token(outsider)),
    )
    assert resp.status_code == 403


async def test_member_create_manager_201(client: AsyncClient, db_session: AsyncSession) -> None:
    proj = await _seed_project(db_session)
    manager = await _mk_user(db_session, "pm@example.com")
    await _make_manager(db_session, proj, manager)
    resp = await client.post(
        MEMBER_BASE,
        json={
            "pm_project_id": str(proj.id),
            "user_id": str(uuid.uuid4()),
            "user_name": "新人",
            "role_name": "开发",
        },
        headers=_headers(_token(manager)),
    )
    assert resp.status_code == 201, resp.text


async def test_member_create_super_admin_201(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict[str, str]
) -> None:
    """超管(auth_headers=is_platform_admin)无需经理成员即可加人。"""
    proj = await _seed_project(db_session)
    resp = await client.post(
        MEMBER_BASE,
        json={
            "pm_project_id": str(proj.id),
            "user_id": str(uuid.uuid4()),
            "user_name": "新人",
            "role_name": "开发",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text


# ── update ───────────────────────────────────────────────────────────────────


async def test_member_update_non_manager_403(client: AsyncClient, db_session: AsyncSession) -> None:
    proj = await _seed_project(db_session)
    target_user = await _mk_user(db_session, "target@example.com")
    member = await _seed_member(db_session, proj, target_user)
    outsider = await _mk_user(db_session, "outsider2@example.com")
    resp = await client.put(
        f"{MEMBER_BASE}/{member.id}",
        json={"role_name": "项目经理"},
        headers=_headers(_token(outsider)),
    )
    assert resp.status_code == 403


async def test_member_update_manager_200(client: AsyncClient, db_session: AsyncSession) -> None:
    proj = await _seed_project(db_session)
    manager = await _mk_user(db_session, "pm2@example.com")
    await _make_manager(db_session, proj, manager)
    target_user = await _mk_user(db_session, "target2@example.com")
    member = await _seed_member(db_session, proj, target_user)
    resp = await client.put(
        f"{MEMBER_BASE}/{member.id}",
        json={"role_name": "测试经理"},
        headers=_headers(_token(manager)),
    )
    assert resp.status_code == 200, resp.text


# ── delete ───────────────────────────────────────────────────────────────────


async def test_member_delete_non_manager_403(client: AsyncClient, db_session: AsyncSession) -> None:
    proj = await _seed_project(db_session)
    target_user = await _mk_user(db_session, "target3@example.com")
    member = await _seed_member(db_session, proj, target_user)
    outsider = await _mk_user(db_session, "outsider3@example.com")
    resp = await client.delete(f"{MEMBER_BASE}/{member.id}", headers=_headers(_token(outsider)))
    assert resp.status_code == 403


async def test_member_delete_manager_204(client: AsyncClient, db_session: AsyncSession) -> None:
    proj = await _seed_project(db_session)
    manager = await _mk_user(db_session, "pm3@example.com")
    await _make_manager(db_session, proj, manager)
    target_user = await _mk_user(db_session, "target4@example.com")
    member = await _seed_member(db_session, proj, target_user)
    resp = await client.delete(f"{MEMBER_BASE}/{member.id}", headers=_headers(_token(manager)))
    assert resp.status_code == 204
