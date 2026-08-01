"""Tests for ``/api/custom-skills`` per-user CRUD.

Change: 2026-07-31-custom-skill-per-user (task-11)

Covers（design FR-02/04/05 + Grill gap#3）:
- 5 endpoints (list/create/get/update/delete)，任意登录用户即可（D-003，
  不再要求 SETTINGS_ADMIN）。
- name 字符集 [a-z0-9-]{2,40} / sillyspec- prefix → 422。
- per-user 内 name 重复 → 409（联合唯一 ``(created_by, name)``）。
- **Grill gap#3（核心）**：跨用户同名不冲突——A 建 name=x 后，B 也建
  name=x → 201（不报 409，验证 per-user 联合唯一而非全局唯一）。
- per-user 隔离（FR-04）：A 的 list 不含 B 的技能；B get A 的 skill_id → 404。
- 越权（FR-05）：B 对 A 的 skill PUT/DELETE → 404（SkillNotFound，不泄露存在、不返 403）。
- 权限放宽：非管理员（is_platform_admin=False）登录用户能 CRUD 自己的技能（不再 403）。

错误断言用真实 HTTP 状态码（201/404/409/422），不直接断 service 内部异常类型。
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
    """Create user + token. admin=True short-circuits SETTINGS_ADMIN permission.

    task-11：端点权限已放宽到任意登录用户（D-003），本工具 admin=False
    即可造普通登录用户（is_platform_admin=False）覆盖权限放宽场景。
    """
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


async def _create_skill(
    client: AsyncClient,
    token: str,
    *,
    name: str = "my-skill",
) -> dict:
    """用给定 token POST 一个 skill，返回 detail JSON（含 id）。断言 201。"""
    resp = await client.post(
        CUSTOM_SKILLS_PATH,
        json={**PAYLOAD, "name": name},
        headers=_headers(token),
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


# ─── 既有用例：admin 改成任意登录用户（D-003）─────────────────────────


@pytest.mark.asyncio
async def test_create_and_list_and_get(client: AsyncClient, db_session: AsyncSession):
    """任意登录用户: create → list → get detail 全链路通。"""
    _, token = await _make_user(db_session, admin=False)
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
    """同一用户内 name 重复 → 409（per-user 联合唯一）。"""
    _, token = await _make_user(db_session, admin=False)
    h = _headers(token)
    resp = await client.post(CUSTOM_SKILLS_PATH, json=PAYLOAD, headers=h)
    assert resp.status_code == 201
    # 同用户再次用同名 → 409
    resp = await client.post(CUSTOM_SKILLS_PATH, json=PAYLOAD, headers=h)
    assert resp.status_code == 409


@pytest.mark.asyncio
async def test_create_bad_charset_422(client: AsyncClient, db_session: AsyncSession):
    """name 字符集非法（大写/下划线/空格/过短/过长）→ 422。"""
    _, token = await _make_user(db_session, admin=False)
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
    _, token = await _make_user(db_session, admin=False)
    h = _headers(token)
    resp = await client.post(
        CUSTOM_SKILLS_PATH,
        json={**PAYLOAD, "name": "sillyspec-evil"},
        headers=h,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_update_and_delete(client: AsyncClient, db_session: AsyncSession):
    """任意登录用户: update 改 description → delete 204。"""
    _, token = await _make_user(db_session, admin=False)
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


# ─── 权限放宽（D-003：non-admin 可 CRUD 自己的技能）───────────────────


@pytest.mark.asyncio
async def test_non_admin_can_crud_own_skills(client: AsyncClient, db_session: AsyncSession):
    """D-003 权限放宽：is_platform_admin=False 的登录用户也能完整 CRUD（不再 403）。"""
    _, token = await _make_user(db_session, admin=False)
    h = _headers(token)

    # list 空列表 → 200（非 403）
    resp = await client.get(CUSTOM_SKILLS_PATH, headers=h)
    assert resp.status_code == 200
    assert resp.json() == []

    # create → 201（非 403）
    resp = await client.post(CUSTOM_SKILLS_PATH, json=PAYLOAD, headers=h)
    assert resp.status_code == 201, resp.text
    skill_id = resp.json()["id"]

    # get → 200（非 403）
    resp = await client.get(f"{CUSTOM_SKILLS_PATH}/{skill_id}", headers=h)
    assert resp.status_code == 200

    # update → 200（非 403）
    resp = await client.put(
        f"{CUSTOM_SKILLS_PATH}/{skill_id}",
        json={"description": "x"},
        headers=h,
    )
    assert resp.status_code == 200

    # delete → 204（非 403）
    resp = await client.delete(f"{CUSTOM_SKILLS_PATH}/{skill_id}", headers=h)
    assert resp.status_code == 204


# ─── per-user 隔离（FR-04）─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_list_isolated_per_user(client: AsyncClient, db_session: AsyncSession):
    """FR-04 隔离：A 建 skill → A list 含、B list 不含（per-user 过滤）。"""
    _, token_a = await _make_user(db_session, admin=False)
    _, token_b = await _make_user(db_session, admin=False)

    # A 建一个 skill
    await _create_skill(client, token_a, name="a-skill")

    # A list → 1 条
    resp = await client.get(CUSTOM_SKILLS_PATH, headers=_headers(token_a))
    assert resp.status_code == 200
    items_a = resp.json()
    assert len(items_a) == 1
    assert items_a[0]["name"] == "a-skill"

    # B list → 0 条（看不到 A 的）
    resp = await client.get(CUSTOM_SKILLS_PATH, headers=_headers(token_b))
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_get_other_users_skill_returns_404(client: AsyncClient, db_session: AsyncSession):
    """FR-04 隔离：B 直接 GET A 的 skill_id → 404（不泄露存在）。"""
    _, token_a = await _make_user(db_session, admin=False)
    _, token_b = await _make_user(db_session, admin=False)

    created = await _create_skill(client, token_a, name="a-skill")
    skill_id = created["id"]

    # B 用 A 的 skill_id get → 404（非 403，非 200）
    resp = await client.get(
        f"{CUSTOM_SKILLS_PATH}/{skill_id}",
        headers=_headers(token_b),
    )
    assert resp.status_code == 404


# ─── Grill gap#3：跨用户同名（FR-02，联合唯一核心保证）────────────────


@pytest.mark.asyncio
async def test_cross_user_same_name_not_conflict(client: AsyncClient, db_session: AsyncSession):
    """**Grill gap#3 核心**：A POST name=x → 201；B 也 POST name=x → 201（不报 409）。

    验证 ``(created_by, name)`` 联合唯一而非 ``name`` 全局唯一——不同用户可同名。
    """
    _, token_a = await _make_user(db_session, admin=False)
    _, token_b = await _make_user(db_session, admin=False)

    # A 建同名 skill → 201
    resp_a = await client.post(
        CUSTOM_SKILLS_PATH,
        json={**PAYLOAD, "name": "shared-name"},
        headers=_headers(token_a),
    )
    assert resp_a.status_code == 201, resp_a.text

    # B 也建同名 skill → 201（**不是 409**，per-user 联合唯一核心保证）
    resp_b = await client.post(
        CUSTOM_SKILLS_PATH,
        json={**PAYLOAD, "name": "shared-name"},
        headers=_headers(token_b),
    )
    assert resp_b.status_code == 201, (
        f"gap#3: 跨用户同名应 201 不报 409，实际 {resp_b.status_code}: {resp_b.text}"
    )

    # 两条记录 id 不同，各自归属不同用户
    assert resp_a.json()["id"] != resp_b.json()["id"]
    assert resp_a.json()["created_by"] != resp_b.json()["created_by"]

    # A/B 各自 list 仍只看到自己那条（同名但隔离）
    list_a = await client.get(CUSTOM_SKILLS_PATH, headers=_headers(token_a))
    list_b = await client.get(CUSTOM_SKILLS_PATH, headers=_headers(token_b))
    assert len(list_a.json()) == 1
    assert len(list_b.json()) == 1
    assert list_a.json()[0]["name"] == "shared-name"
    assert list_b.json()[0]["name"] == "shared-name"


@pytest.mark.asyncio
async def test_same_user_same_name_still_409(client: AsyncClient, db_session: AsyncSession):
    """对照组：同一用户内同名仍 → 409（per-user 联合唯一的「per-user」面）。"""
    _, token_a = await _make_user(db_session, admin=False)
    h_a = _headers(token_a)

    resp1 = await client.post(
        CUSTOM_SKILLS_PATH,
        json={**PAYLOAD, "name": "dup-name"},
        headers=h_a,
    )
    assert resp1.status_code == 201
    # 同用户再用同名 → 409
    resp2 = await client.post(
        CUSTOM_SKILLS_PATH,
        json={**PAYLOAD, "name": "dup-name"},
        headers=h_a,
    )
    assert resp2.status_code == 409


# ─── 越权（FR-05：跨用户 update/delete 返 404 不泄露）──────────────────


@pytest.mark.asyncio
async def test_cross_user_update_returns_404(client: AsyncClient, db_session: AsyncSession):
    """FR-05 越权：B PUT A 的 skill_id → 404（service.get 校验归属不符，不返 403）。"""
    _, token_a = await _make_user(db_session, admin=False)
    _, token_b = await _make_user(db_session, admin=False)

    created = await _create_skill(client, token_a, name="a-skill")
    skill_id = created["id"]

    # B 试图改 A 的 skill → 404（不泄露存在）
    resp = await client.put(
        f"{CUSTOM_SKILLS_PATH}/{skill_id}",
        json={"description": "hijacked"},
        headers=_headers(token_b),
    )
    assert resp.status_code == 404, f"越权 update 应 404（不泄露存在），实际 {resp.status_code}"

    # 原 skill 未被改（A 视角仍可读，description 不变）
    resp_a = await client.get(
        f"{CUSTOM_SKILLS_PATH}/{skill_id}",
        headers=_headers(token_a),
    )
    assert resp_a.status_code == 200
    assert resp_a.json()["description"] == PAYLOAD["description"]


@pytest.mark.asyncio
async def test_cross_user_delete_returns_404(client: AsyncClient, db_session: AsyncSession):
    """FR-05 越权：B DELETE A 的 skill_id → 404（不泄露存在）。"""
    _, token_a = await _make_user(db_session, admin=False)
    _, token_b = await _make_user(db_session, admin=False)

    created = await _create_skill(client, token_a, name="a-skill")
    skill_id = created["id"]

    # B 试图删 A 的 skill → 404
    resp = await client.delete(
        f"{CUSTOM_SKILLS_PATH}/{skill_id}",
        headers=_headers(token_b),
    )
    assert resp.status_code == 404, f"越权 delete 应 404（不泄露存在），实际 {resp.status_code}"

    # 原 skill 仍在（A 视角可读）
    resp_a = await client.get(
        f"{CUSTOM_SKILLS_PATH}/{skill_id}",
        headers=_headers(token_a),
    )
    assert resp_a.status_code == 200


@pytest.mark.asyncio
async def test_unauthenticated_request_401(client: AsyncClient):
    """对照：未登录（无 Bearer）→ 401（区别于越权 404）。"""
    # 不带 Authorization 头
    resp = await client.get(CUSTOM_SKILLS_PATH)
    assert resp.status_code == 401

    resp = await client.post(CUSTOM_SKILLS_PATH, json=PAYLOAD)
    assert resp.status_code == 401
