"""用户自助头像端点测试（PATCH /api/auth/me/avatar）。

覆盖 change ``2026-09-10-account-avatar-upload`` task-03 四态 + 边界/辅助断言：
- 设置：值 → 200，响应与 users.avatar 列同值
- 清除：'' → 200，列置 NULL（永不存空串，审查 C-08，区别于群成员 PATCH 存 ''）
- 未带 token → 401
- 513 字符 → 422；恰好 512（列宽上限）→ 200 落库
- avatar 缺省（None）→ 不改库值
- GET /api/auth/me 带出 avatar（UserRead.from_attributes）
"""

from __future__ import annotations

import uuid
from datetime import datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import User

PASSWORD = "Avatar1!"
AVATAR_URL = "/api/file/00000000-0000-0000-0000-000000000000"


@pytest.fixture
async def user_with_token(db_session):
    """建一个 active user + 其 access token（供 /me/avatar 鉴权）。"""
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        email="avatar@example.com",
        username="avatarer",
        password_hash=password_hasher.hash(PASSWORD),
        status="active",
        login_enabled=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=False,
        settings=settings,
    )
    return user, token


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _avatar_col(db_session: AsyncSession, user_id: uuid.UUID) -> str | None:
    """直查 users.avatar 列值（选列而非实体，绕开 db_session 身份映射缓存，
    确保读到 HTTP 事务提交后的新值）。"""
    return (await db_session.execute(select(User.avatar).where(User.id == user_id))).scalar_one()


async def _set_avatar(client: AsyncClient, token: str, avatar: str | None) -> int:
    """PATCH /me/avatar 并返回状态码（测试内复用的设置/清除原语）。"""
    resp = await client.patch(
        "/api/auth/me/avatar",
        json={"avatar": avatar} if avatar is not None else {},
        headers=_auth(token),
    )
    return resp.status_code


@pytest.mark.asyncio
async def test_set_avatar(client: AsyncClient, db_session, user_with_token):
    """设置：值 → 200，响应与 users.avatar 列同值。"""
    user, token = user_with_token
    resp = await client.patch(
        "/api/auth/me/avatar",
        json={"avatar": AVATAR_URL},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["avatar"] == AVATAR_URL
    assert await _avatar_col(db_session, user.id) == AVATAR_URL


@pytest.mark.asyncio
async def test_clear_avatar_sets_null(client: AsyncClient, db_session, user_with_token):
    """清除：'' → 200，列置 NULL（不是空串，审查 C-08 语义铁律）。"""
    user, token = user_with_token
    assert await _set_avatar(client, token, AVATAR_URL) == 200
    resp = await client.patch(
        "/api/auth/me/avatar",
        json={"avatar": ""},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["avatar"] is None
    # 列必须为 NULL：`is None` 同时排除了存空串 '' 的错误实现
    assert await _avatar_col(db_session, user.id) is None


@pytest.mark.asyncio
async def test_avatar_no_token(client: AsyncClient):
    """未带 token → 401。"""
    resp = await client.patch(
        "/api/auth/me/avatar",
        json={"avatar": AVATAR_URL},
    )
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_avatar_too_long_rejected(client: AsyncClient, user_with_token):
    """513 字符（超 max_length=512 / 列宽）→ 422。"""
    _user, token = user_with_token
    resp = await client.patch(
        "/api/auth/me/avatar",
        json={"avatar": "x" * 513},
        headers=_auth(token),
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_avatar_boundary_512_ok(client: AsyncClient, db_session, user_with_token):
    """边界：恰好 512 字符（列宽上限）→ 200 落库（合法 http 链接形态）。"""
    user, token = user_with_token
    url = "https://example.com/" + "y" * (512 - len("https://example.com/"))
    resp = await client.patch(
        "/api/auth/me/avatar",
        json={"avatar": url},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["avatar"] == url
    assert await _avatar_col(db_session, user.id) == url


async def test_avatar_rejects_non_http_schemes(client: AsyncClient, db_session, user_with_token):
    """ql-20260911-003-355a P2：javascript:/data:/file: 与裸串 → 422 不落库。"""
    user, token = user_with_token
    for bad in (
        "javascript:alert(1)",
        "data:image/svg+xml;base64,PHN2Zy8+",
        "file:///C:/win.ini",
        "not-a-url",
    ):
        resp = await client.patch(
            "/api/auth/me/avatar",
            json={"avatar": bad},
            headers=_auth(token),
        )
        assert resp.status_code == 422, f"{bad!r} 应被拒绝：{resp.text}"
        assert await _avatar_col(db_session, user.id) is None


async def test_avatar_accepts_file_center_path_and_https(
    client: AsyncClient, db_session, user_with_token
):
    """合法形态：文件中心 /api/file/{id} 与 http(s) 外链 → 200。"""
    user, token = user_with_token
    for good in ("/api/file/0e2b4d8e-1111-4222-8333-444455556666", "https://cdn.example.com/a.png"):
        resp = await client.patch(
            "/api/auth/me/avatar",
            json={"avatar": good},
            headers=_auth(token),
        )
        assert resp.status_code == 200, f"{good!r} 应被接受：{resp.text}"
        assert await _avatar_col(db_session, user.id) == good


@pytest.mark.asyncio
async def test_avatar_missing_keeps_value(client: AsyncClient, db_session, user_with_token):
    """avatar 缺省（None）→ 不改库值（响应仍带当前值）。"""
    user, token = user_with_token
    assert await _set_avatar(client, token, AVATAR_URL) == 200
    resp = await client.patch(
        "/api/auth/me/avatar",
        json={},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["avatar"] == AVATAR_URL
    assert await _avatar_col(db_session, user.id) == AVATAR_URL


@pytest.mark.asyncio
async def test_me_returns_avatar(client: AsyncClient, user_with_token):
    """GET /api/auth/me 带出 avatar（UserRead.from_attributes）。"""
    _user, token = user_with_token
    assert await _set_avatar(client, token, AVATAR_URL) == 200
    me = await client.get("/api/auth/me", headers=_auth(token))
    assert me.status_code == 200, me.text
    assert me.json()["user"]["avatar"] == AVATAR_URL


# ── 孤儿文件回收（ql-20260911-019-1f01）──────────────────────────────────────


async def _insert_file_row(db_session: AsyncSession, *, uploaded_by: uuid.UUID) -> uuid.UUID:
    """插一行文件中心 File（头像引用形态），返回其 file id。"""
    from datetime import UTC, datetime

    from app.modules.file.model import File

    file_id = uuid.uuid4()
    db_session.add(
        File(
            id=file_id,
            owner_type="user_avatar",
            owner_id=None,
            original_name="a.png",
            stored_key=f"avatars/{file_id}.png",
            mime_type="image/png",
            size=100,
            uploaded_by=uploaded_by,
            created_at=datetime.now(UTC),
        )
    )
    await db_session.commit()
    return file_id


async def _file_deleted_at(db_session: AsyncSession, file_id: uuid.UUID) -> datetime | None:
    from app.modules.file.model import File

    row = await db_session.get(File, file_id)
    assert row is not None
    await db_session.refresh(row)
    return row.deleted_at


@pytest.mark.asyncio
async def test_avatar_replace_reclaims_old_file_center_file(
    client: AsyncClient, db_session: AsyncSession, user_with_token
):
    """换绑：旧值 /api/file/{id} → 新文件 URL 落库成功后旧 File 行软删。"""
    user, token = user_with_token
    old_id = await _insert_file_row(db_session, uploaded_by=user.id)
    new_id = await _insert_file_row(db_session, uploaded_by=user.id)
    resp = await client.patch(
        "/api/auth/me/avatar",
        json={"avatar": f"/api/file/{old_id}"},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text

    resp = await client.patch(
        "/api/auth/me/avatar",
        json={"avatar": f"/api/file/{new_id}"},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text

    assert await _file_deleted_at(db_session, old_id) is not None  # 旧文件回收
    assert await _file_deleted_at(db_session, new_id) is None  # 新文件存活


@pytest.mark.asyncio
async def test_avatar_clear_reclaims_old_file(
    client: AsyncClient, db_session: AsyncSession, user_with_token
):
    """清除（''）：旧文件中心文件同样回收。"""
    user, token = user_with_token
    old_id = await _insert_file_row(db_session, uploaded_by=user.id)
    resp = await client.patch(
        "/api/auth/me/avatar",
        json={"avatar": f"/api/file/{old_id}"},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text

    resp = await client.patch("/api/auth/me/avatar", json={"avatar": ""}, headers=_auth(token))
    assert resp.status_code == 200, resp.text

    assert await _avatar_col(db_session, user.id) is None
    assert await _file_deleted_at(db_session, old_id) is not None


@pytest.mark.asyncio
async def test_avatar_external_url_not_touched(
    client: AsyncClient, db_session: AsyncSession, user_with_token
):
    """旧值为外链 → 无文件可回收，PATCH 正常（无 File 行存在即无副作用）。"""
    _user, token = user_with_token
    resp = await client.patch(
        "/api/auth/me/avatar",
        json={"avatar": "https://cdn.example.com/a.png"},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    resp = await client.patch(
        "/api/auth/me/avatar",
        json={"avatar": "https://cdn.example.com/b.png"},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text


@pytest.mark.asyncio
async def test_avatar_reclaim_skips_foreign_owned_file(
    client: AsyncClient, db_session: AsyncSession, user_with_token
):
    """旧文件属他人（uploaded_by != 操作者）→ 回收静默跳过，PATCH 不受影响。"""
    _user, token = user_with_token
    stranger_id = uuid.uuid4()
    foreign_id = await _insert_file_row(db_session, uploaded_by=stranger_id)
    resp = await client.patch(
        "/api/auth/me/avatar",
        json={"avatar": f"/api/file/{foreign_id}"},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text  # 引用他人文件 URL 本身不拦

    resp = await client.patch(
        "/api/auth/me/avatar",
        json={"avatar": ""},
        headers=_auth(token),
    )
    assert resp.status_code == 200, resp.text
    # 归属断言拒删（best-effort 静默）：文件仍在
    assert await _file_deleted_at(db_session, foreign_id) is None
