"""工作区维度关联接口 HTTP 测试(link_router)。

change ``2026-07-28-ppm-project-link-workspace`` task-08 / AC-2/AC-3。
覆盖 GET/POST/DELETE happy path(platform admin 绕过成员校验)、重复 409、
存在性 404、非工作区成员 403。seed 走 db_session(共享 in-memory 引擎),
client 走 HTTP。
"""

from __future__ import annotations

import uuid

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import User

# 显式注册 incident/release 模型表(同 test_link_service,规避 pre-existing
# NoReferencedTableError 时序缺口)。
from app.modules.incident import model as _incident_model  # noqa: F401
from app.modules.ppm.project.model import PpmProjectMaintenance
from app.modules.release import model as _release_model  # noqa: F401
from app.modules.workspace.model import Workspace


async def _seed_workspace(session: AsyncSession, name: str = "WS1") -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=name,
        slug=name.lower(),
        root_path=f"/{name.lower()}",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _seed_project(session: AsyncSession, code: str = "P-001") -> PpmProjectMaintenance:
    p = PpmProjectMaintenance(
        id=uuid.uuid4(),
        project_name="项目A",
        project_code=code,
        project_status="进行中",
    )
    session.add(p)
    await session.commit()
    await session.refresh(p)
    return p


async def _regular_user_token(session: AsyncSession, email: str = "regular@example.com") -> str:
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        id=uuid.uuid4(),
        email=email,
        password_hash=password_hasher.hash("Xx1!aaaa"),
        display_name="Reg",
        status="active",
        is_platform_admin=False,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=settings,
    )
    return token


async def test_workspace_link_lifecycle_admin(
    client: AsyncClient,
    db_session: AsyncSession,
    auth_headers: dict[str, str],
) -> None:
    ws = await _seed_workspace(db_session)
    proj = await _seed_project(db_session)

    # bind -> 201
    resp = await client.post(
        f"/api/workspaces/{ws.id}/ppm-projects",
        json={"ppm_project_id": str(proj.id)},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    assert resp.json()["project_id"] == str(proj.id)

    # list -> 1
    resp = await client.get(f"/api/workspaces/{ws.id}/ppm-projects", headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    # duplicate -> 409
    resp = await client.post(
        f"/api/workspaces/{ws.id}/ppm-projects",
        json={"ppm_project_id": str(proj.id)},
        headers=auth_headers,
    )
    assert resp.status_code == 409

    # unbind -> 204
    resp = await client.delete(
        f"/api/workspaces/{ws.id}/ppm-projects/{proj.id}", headers=auth_headers
    )
    assert resp.status_code == 204

    # list -> empty
    resp = await client.get(f"/api/workspaces/{ws.id}/ppm-projects", headers=auth_headers)
    assert resp.json() == []


async def test_workspace_bind_nonexistent_project_404(
    client: AsyncClient,
    db_session: AsyncSession,
    auth_headers: dict[str, str],
) -> None:
    ws = await _seed_workspace(db_session)
    resp = await client.post(
        f"/api/workspaces/{ws.id}/ppm-projects",
        json={"ppm_project_id": str(uuid.uuid4())},
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_workspace_bind_non_member_403(client: AsyncClient, db_session: AsyncSession) -> None:
    ws = await _seed_workspace(db_session)
    proj = await _seed_project(db_session)
    token = await _regular_user_token(db_session)
    headers = {"Authorization": f"Bearer {token}"}
    resp = await client.post(
        f"/api/workspaces/{ws.id}/ppm-projects",
        json={"ppm_project_id": str(proj.id)},
        headers=headers,
    )
    assert resp.status_code == 403
