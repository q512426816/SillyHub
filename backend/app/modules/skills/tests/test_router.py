"""Tests for ``/api/custom-skills`` admin CRUD (task-02).

Change: 2026-07-07-skills-mcp-management-ui

Covers:
- 5 endpoints (list/create/get/update/delete) under SETTINGS_ADMIN
- name unique → 409; charset [a-z0-9-]{2,40} / sillyspec- prefix → 422
- non-admin → 403
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import User

CUSTOM_SKILLS_PATH = "/api/custom-skills"


async def _make_user(session: AsyncSession, *, admin: bool) -> tuple[User, str]:
    """Create user + token. admin=True short-circuits SETTINGS_ADMIN permission."""
    user = User(
        id=uuid.uuid4(),
        email=f"skill-{uuid.uuid4().hex[:6]}@example.com",
        username=f"skill-{uuid.uuid4().hex[:6]}",
        password_hash=password_hasher.hash("x"),
        status="active",
        is_platform_admin=admin,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return user, token


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


PAYLOAD = {
    "name": "my-skill",
    "description": "a custom skill",
    "content": "# My Skill\n\ndoes things",
}


@pytest.mark.asyncio
async def test_create_and_list_and_get(client: AsyncClient, db_session: AsyncSession):
    """admin: create → list → get detail 全链路通。"""
    _, token = await _make_user(db_session, admin=True)
    h = _headers(token)

    # create
    resp = await client.post(CUSTOM_SKILLS_PATH, json=PAYLOAD, headers=h)
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["name"] == "my-skill"
    assert created["content"] == PAYLOAD["content"]
    skill_id = created["id"]

    # list（不含 content，含 content_preview）
    resp = await client.get(CUSTOM_SKILLS_PATH, headers=h)
    assert resp.status_code == 200
    items = resp.json()
    assert len(items) == 1
    assert items[0]["id"] == skill_id
    assert "content" not in items[0]
    assert "content_preview" in items[0]

    # get detail（含 content）
    resp = await client.get(f"{CUSTOM_SKILLS_PATH}/{skill_id}", headers=h)
    assert resp.status_code == 200
    detail = resp.json()
    assert detail["content"] == PAYLOAD["content"]


@pytest.mark.asyncio
async def test_create_name_unique_conflict_409(client: AsyncClient, db_session: AsyncSession):
    """name 重复 → 409。"""
    _, token = await _make_user(db_session, admin=True)
    h = _headers(token)
    resp = await client.post(CUSTOM_SKILLS_PATH, json=PAYLOAD, headers=h)
    assert resp.status_code == 201
    resp = await client.post(CUSTOM_SKILLS_PATH, json=PAYLOAD, headers=h)
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_create_bad_charset_422(client: AsyncClient, db_session: AsyncSession):
    """name 字符集非法（大写/下划线/空格）→ 422。"""
    _, token = await _make_user(db_session, admin=True)
    h = _headers(token)
    for bad_name in ["My-Skill", "my_skill", "my skill", "x", "a" * 41]:
        resp = await client.post(
            CUSTOM_SKILLS_PATH,
            json={**PAYLOAD, "name": bad_name},
            headers=h,
        )
        assert resp.status_code == 422, f"{bad_name} should be 422, got {resp.status_code}"


@pytest.mark.asyncio
async def test_create_sillyspec_prefix_422(client: AsyncClient, db_session: AsyncSession):
    """name 含 sillyspec- 前缀（与平台代码库 skills 命名空间冲突）→ 422。"""
    _, token = await _make_user(db_session, admin=True)
    h = _headers(token)
    resp = await client.post(
        CUSTOM_SKILLS_PATH,
        json={**PAYLOAD, "name": "sillyspec-evil"},
        headers=h,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_update_and_delete(client: AsyncClient, db_session: AsyncSession):
    """admin: update 改 description → delete 204。"""
    _, token = await _make_user(db_session, admin=True)
    h = _headers(token)
    resp = await client.post(CUSTOM_SKILLS_PATH, json=PAYLOAD, headers=h)
    skill_id = resp.json()["id"]

    # update
    resp = await client.put(
        f"{CUSTOM_SKILLS_PATH}/{skill_id}",
        json={"description": "updated desc"},
        headers=h,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["description"] == "updated desc"

    # delete
    resp = await client.delete(f"{CUSTOM_SKILLS_PATH}/{skill_id}", headers=h)
    assert resp.status_code == 204

    # 再 list 为空
    resp = await client.get(CUSTOM_SKILLS_PATH, headers=h)
    assert resp.json() == []


@pytest.mark.asyncio
async def test_non_admin_403(client: AsyncClient, db_session: AsyncSession):
    """非 admin → 所有 CRUD 端点 403。"""
    _, token = await _make_user(db_session, admin=False)
    h = _headers(token)

    assert (await client.get(CUSTOM_SKILLS_PATH, headers=h)).status_code == 403
    assert (await client.post(CUSTOM_SKILLS_PATH, json=PAYLOAD, headers=h)).status_code == 403
    assert (await client.get(f"{CUSTOM_SKILLS_PATH}/{uuid.uuid4()}", headers=h)).status_code == 403
    assert (
        await client.put(
            f"{CUSTOM_SKILLS_PATH}/{uuid.uuid4()}", json={"description": "x"}, headers=h
        )
    ).status_code == 403
    assert (
        await client.delete(f"{CUSTOM_SKILLS_PATH}/{uuid.uuid4()}", headers=h)
    ).status_code == 403
