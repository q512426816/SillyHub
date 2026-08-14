"""file 模块 IDOR 归属断言测试（security-audit-remediation task-05 / FR-04）。

覆盖五端点归属收紧（D-001 无权与不存在同为 404 / D-002 可见域）：
  - 他人下载 / meta / 软删 非本人且非 workspace 归属文件 → 404
  - 他人 batch-meta：无权行静默剔除，不整批 404
  - list 可见域：本人上传 OR workspace 归属且有 WORKSPACE_READ；admin 全量
  - owner_id=workspace 过滤：成员可见（R-04 借用方案回归），非成员 404

测试用户 / workspace / 角色（workspace:read）直接落 SQLite in-memory，
经真实 has_permission / allowed_workspace_ids 解析（rbac.py），不 mock 权限层。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.file.tests.conftest import make_id
from app.modules.workspace.model import Workspace


def _token(user: User) -> str:
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return token


def _headers(user: User) -> dict[str, str]:
    return {"Authorization": f"Bearer {_token(user)}"}


async def _make_user(db_session: AsyncSession, *, is_admin: bool = False) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"idor-{uuid.uuid4().hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="IDOR",
        status="active",
        is_platform_admin=is_admin,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _make_workspace_with_read_role(db_session: AsyncSession) -> tuple[Workspace, Role]:
    """建 workspace + 带 workspace:read 的角色（测试 DB 无 seed 角色）。"""
    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name=f"IDOR WS {ws_id.hex[:6]}",
        slug=f"idor-ws-{ws_id.hex[:6]}",
        root_path=f"/tmp/idor-{ws_id.hex}",
        status="active",
    )
    db_session.add(ws)
    role = Role(
        id=uuid.uuid4(),
        key=f"idor_member_{ws_id.hex[:6]}",
        name="IDOR Member",
        description="test role with workspace:read",
    )
    db_session.add(role)
    db_session.add(RolePermission(role_id=role.id, permission=Permission.WORKSPACE_READ.value))
    await db_session.commit()
    await db_session.refresh(ws)
    return ws, role


def _bind_member(db_session: AsyncSession, *, user: User, ws: Workspace, role: Role) -> None:
    db_session.add(
        UserWorkspaceRole(
            user_id=user.id,
            workspace_id=ws.id,
            role_id=role.id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )


async def _upload(
    file_client: AsyncClient,
    user: User,
    *,
    name: str = "a.png",
    data: bytes = b"\x89PNG\r\n\x1a\n-fake",
    owner_type: str = "",
    owner_id: uuid.UUID | None = None,
) -> str:
    """以 user 身份上传一个文件，返回 file id。"""
    params: dict[str, Any] = {"owner_type": owner_type}
    if owner_id is not None:
        params["owner_id"] = str(owner_id)
    resp = await file_client.post(
        "/api/file/upload",
        headers=_headers(user),
        params=params,
        files={"file": (name, data, "image/png")},
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


# ── 他人访问非共享归属文件：统一 404（D-001）────────────────────────────────


async def test_other_user_download_404(file_client: AsyncClient, db_session: AsyncSession) -> None:
    """用户 B 下载 A 上传的私有归属（无 owner）文件 → 404，A 本人 200。"""
    a = await _make_user(db_session)
    b = await _make_user(db_session)
    fid = await _upload(file_client, a)
    resp_b = await file_client.get(f"/api/file/{fid}", headers=_headers(b))
    assert resp_b.status_code == 404, resp_b.text
    resp_a = await file_client.get(f"/api/file/{fid}", headers=_headers(a))
    assert resp_a.status_code == 200


async def test_other_user_meta_404(file_client: AsyncClient, db_session: AsyncSession) -> None:
    """用户 B 取 A 私有文件 meta → 404。"""
    a = await _make_user(db_session)
    b = await _make_user(db_session)
    fid = await _upload(file_client, a)
    resp = await file_client.get(f"/api/file/{fid}/meta", headers=_headers(b))
    assert resp.status_code == 404, resp.text


async def test_other_user_batch_meta_excludes_private_rows(
    file_client: AsyncClient, db_session: AsyncSession
) -> None:
    """B 的 batch-meta 混入 A 的私有文件 id：无权行静默剔除，不整批报错。"""
    a = await _make_user(db_session)
    b = await _make_user(db_session)
    a_fid = await _upload(file_client, a, name="a-private.md", data=b"a")
    b_fid = await _upload(file_client, b, name="b-own.md", data=b"b")
    resp = await file_client.post(
        "/api/file/batch-meta",
        headers=_headers(b),
        json={"ids": [a_fid, b_fid]},
    )
    assert resp.status_code == 200, resp.text
    ids = [row["id"] for row in resp.json()]
    assert ids == [b_fid]


async def test_other_user_soft_delete_404(
    file_client: AsyncClient, db_session: AsyncSession
) -> None:
    """用户 B 软删 A 的私有文件 → 404，且文件未被删（A 仍可下载）。"""
    a = await _make_user(db_session)
    b = await _make_user(db_session)
    fid = await _upload(file_client, a)
    dele = await file_client.delete(f"/api/file/{fid}", headers=_headers(b))
    assert dele.status_code == 404, dele.text
    resp_a = await file_client.get(f"/api/file/{fid}", headers=_headers(a))
    assert resp_a.status_code == 200


# ── workspace 成员可见（R-04 借用方案回归）─────────────────────────────────


async def test_workspace_member_can_access_workspace_files(
    file_client: AsyncClient, db_session: AsyncSession
) -> None:
    """A 上传 owner_type=workspace 文件；有 workspace:read 的成员 B 可下载/meta。"""
    a = await _make_user(db_session)
    b = await _make_user(db_session)
    ws, role = await _make_workspace_with_read_role(db_session)
    _bind_member(db_session, user=b, ws=ws, role=role)
    await db_session.commit()
    fid = await _upload(file_client, a, owner_type="workspace", owner_id=ws.id)

    dl = await file_client.get(f"/api/file/{fid}", headers=_headers(b))
    assert dl.status_code == 200, dl.text
    meta = await file_client.get(f"/api/file/{fid}/meta", headers=_headers(b))
    assert meta.status_code == 200, meta.text
    # 成员的 batch-meta 也能回显 workspace 归属文件
    batch = await file_client.post("/api/file/batch-meta", headers=_headers(b), json={"ids": [fid]})
    assert batch.status_code == 200
    assert [row["id"] for row in batch.json()] == [fid]


async def test_non_member_cannot_access_workspace_files(
    file_client: AsyncClient, db_session: AsyncSession
) -> None:
    """非成员 C 访问 workspace 归属文件（哪怕知道 id）→ 404。"""
    a = await _make_user(db_session)
    c = await _make_user(db_session)
    ws, _role = await _make_workspace_with_read_role(db_session)
    fid = await _upload(file_client, a, owner_type="workspace", owner_id=ws.id)
    resp = await file_client.get(f"/api/file/{fid}", headers=_headers(c))
    assert resp.status_code == 404, resp.text


# ── list 可见域（D-002）────────────────────────────────────────────────────


async def test_list_visibility_domain(file_client: AsyncClient, db_session: AsyncSession) -> None:
    """无参 list：B 只见自己上传 + 有 workspace:read 的 workspace 归属文件。"""
    a = await _make_user(db_session)
    b = await _make_user(db_session)
    ws, role = await _make_workspace_with_read_role(db_session)
    _bind_member(db_session, user=b, ws=ws, role=role)
    await db_session.commit()

    # A 的三条：私有 / ppm_problem 归属 / ws 归属（前两条对 B 不可见）
    await _upload(file_client, a, name="private.md", data=b"p")
    await _upload(
        file_client,
        a,
        name="ppm.md",
        data=b"q",
        owner_type="ppm_problem",
        owner_id=make_id(),
    )
    a_ws = await _upload(
        file_client,
        a,
        name="ws-plan.md",
        data=b"w",
        owner_type="workspace",
        owner_id=ws.id,
    )
    # B 自己一条
    b_own = await _upload(file_client, b, name="b.md", data=b"b")

    listed = await file_client.get("/api/file/list", headers=_headers(b))
    assert listed.status_code == 200, listed.text
    ids = {row["id"] for row in listed.json()}
    assert ids == {a_ws, b_own}, f"expected member-visible set, got {ids}"


async def test_list_owner_filter_member_sees_workspace_files(
    file_client: AsyncClient, db_session: AsyncSession
) -> None:
    """成员按 owner_type=workspace&owner_id 过滤能列出该 ws 的方案文件（R-04）。"""
    a = await _make_user(db_session)
    b = await _make_user(db_session)
    ws, role = await _make_workspace_with_read_role(db_session)
    _bind_member(db_session, user=b, ws=ws, role=role)
    await db_session.commit()
    a_ws_1 = await _upload(
        file_client,
        a,
        name="plan-a.md",
        data=b"1",
        owner_type="workspace",
        owner_id=ws.id,
    )
    a_ws_2 = await _upload(
        file_client,
        a,
        name="plan-b.md",
        data=b"2",
        owner_type="workspace",
        owner_id=ws.id,
    )
    await _upload(file_client, a, name="private.md", data=b"p")  # 非本 ws，不应出现

    listed = await file_client.get(
        "/api/file/list",
        headers=_headers(b),
        params={"owner_type": "workspace", "owner_id": str(ws.id)},
    )
    assert listed.status_code == 200, listed.text
    ids = {row["id"] for row in listed.json()}
    assert ids == {a_ws_1, a_ws_2}


async def test_list_owner_filter_non_member_404(
    file_client: AsyncClient, db_session: AsyncSession
) -> None:
    """非成员按 owner_id 过滤他人 workspace → 404（与不存在同语义 D-001）。"""
    a = await _make_user(db_session)
    c = await _make_user(db_session)
    ws, _role = await _make_workspace_with_read_role(db_session)
    await _upload(file_client, a, owner_type="workspace", owner_id=ws.id)
    resp = await file_client.get(
        "/api/file/list",
        headers=_headers(c),
        params={"owner_type": "workspace", "owner_id": str(ws.id)},
    )
    assert resp.status_code == 404, resp.text


async def test_platform_admin_list_sees_all(
    file_client: AsyncClient, db_session: AsyncSession
) -> None:
    """platform_admin 无参 list 全量可见（含他人私有归属）。"""
    a = await _make_user(db_session)
    admin = await _make_user(db_session, is_admin=True)
    a_private = await _upload(file_client, a, name="private.md", data=b"p")
    a_ppm = await _upload(
        file_client,
        a,
        name="ppm.md",
        data=b"q",
        owner_type="ppm_problem",
        owner_id=make_id(),
    )
    listed = await file_client.get("/api/file/list", headers=_headers(admin))
    assert listed.status_code == 200, listed.text
    ids = {row["id"] for row in listed.json()}
    assert {a_private, a_ppm} <= ids
