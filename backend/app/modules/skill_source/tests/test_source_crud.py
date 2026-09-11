"""Tests for ``/api/skill-sources`` admin CRUD 五端点（task-01）。

Change: 2026-09-11-skills-central-library

Covers（task-01 acceptance + design REST 清单）:
- CRUD 回环：create(201 默认 branch=main/enabled=True) → list → PATCH →
  refresh(200) → DELETE(204) → list 空；未知 id PATCH/DELETE/refresh → 404。
- 权限矩阵：五端点全 ``require_permission_any(SETTINGS_ADMIN)``——非 admin
  （is_platform_admin=False 无角色授权）→ 403；未登录 → 401。
- SSRF（D-007/R-02）：私网 URL（127.0.0.1/云元数据）→ 400；非法 scheme
  （ftp/file）→ 400（taskcard 权威：SSRF 拒绝为 400，与 assert_public_url
  原生 UnsafeRepoUrl/SsrfBlocked 状态码一致）。
- git 二进制探测（R-01）：monkeypatch shutil.which → None，create/refresh
  → 422；探测存在（mock 返回路径）→ 正常 201/200。
- url 重复 → 409；update 改 url 重过 SSRF（改私网 → 400）。
- 删除连带：user_skill_enables 前缀匹配清理（他源绑定保留）+ 缓存目录
  best-effort 删除（目录不存在不报错）。

离线性：happy-path URL 用公网 IP 字面量（getaddrinfo 本地解析无 DNS，
tool_gateway/tests/test_ssrf.py 先例）；git 探测全程 mock，不依赖宿主 git。
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import User
from app.modules.skill_source.model import UserSkillEnable
from app.modules.skill_source.service import source_cache_dir

SOURCES_PATH = "/api/skill-sources"
# 公网 IP 字面量（离线 getaddrinfo，无 DNS）——tool_gateway/tests/test_ssrf.py:58 先例。
PUBLIC_URL = "https://8.8.8.8/skills.git"
PUBLIC_URL_2 = "https://8.8.8.8/other-skills.git"


def _mock_git_present(monkeypatch: pytest.MonkeyPatch) -> None:
    """git 探测恒「存在」+ 保存即拉取触发 no-op。

    测试不依赖宿主环境是否装 git/外网（R-01 缺失用例另 mock；拉取真仓
    全链路用例归 test_git_fetcher.py 的本地假仓——CRUD 用例的 URL 是
    不可达占位地址，必须把触发桩掉防真实 clone 挂网络）。
    """

    async def _probe() -> bool:
        return True

    async def _noop_trigger(session, source) -> None:
        return None

    monkeypatch.setattr("app.modules.skill_source.git_fetcher.probe_git_binary", _probe)
    monkeypatch.setattr("app.modules.skill_source.service._trigger_fetch", _noop_trigger)


def _mock_git_missing(monkeypatch: pytest.MonkeyPatch) -> None:
    """git 探测恒「缺失」（模拟部署容器无 git 二进制，R-01）。"""

    async def _probe() -> bool:
        return False

    monkeypatch.setattr("app.modules.skill_source.git_fetcher.probe_git_binary", _probe)


async def _make_user(session: AsyncSession, *, admin: bool) -> tuple[User, str]:
    """Create user + token（skills/tests/test_router.py 同款）。"""
    user = User(
        id=uuid.uuid4(),
        email=f"src-{uuid.uuid4().hex[:6]}@example.com",
        username=f"src-{uuid.uuid4().hex[:6]}",
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


async def _create_source(
    client: AsyncClient,
    token: str,
    *,
    url: str = PUBLIC_URL,
) -> dict:
    """admin POST 一个源，断言 201 返回 JSON（git 探测须先 mock 存在）。"""
    resp = await client.post(SOURCES_PATH, json={"url": url}, headers=_headers(token))
    assert resp.status_code == 201, resp.text
    return resp.json()


# ─── CRUD 回环（admin 全通）─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_crud_roundtrip(client: AsyncClient, db_session: AsyncSession, monkeypatch):
    """admin：create(201 默认值) → list → PATCH → refresh → DELETE(204) → list 空。"""
    _mock_git_present(monkeypatch)
    _, token = await _make_user(db_session, admin=True)
    h = _headers(token)

    # create——默认 branch=main / subdir=None / enabled=True / 拉取回写字段空
    resp = await client.post(
        SOURCES_PATH,
        json={"url": PUBLIC_URL, "subdir": "agent-skills"},
        headers=h,
    )
    assert resp.status_code == 201, resp.text
    created = resp.json()
    assert created["url"] == PUBLIC_URL
    assert created["branch"] == "main"
    assert created["subdir"] == "agent-skills"
    assert created["enabled"] is True
    assert created["last_commit"] is None
    assert created["last_fetched_at"] is None
    assert created["last_error"] is None
    source_id = created["id"]

    # list 含新建源
    resp = await client.get(SOURCES_PATH, headers=h)
    assert resp.status_code == 200
    items = resp.json()
    assert [it["id"] for it in items] == [source_id]

    # PATCH：branch + enabled（task-02 前无真实拉取，回写字段仍空）
    resp = await client.patch(
        f"{SOURCES_PATH}/{source_id}",
        json={"branch": "develop", "enabled": False},
        headers=h,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["branch"] == "develop"
    assert resp.json()["enabled"] is False

    # refresh（git mock 存在 → 200）
    resp = await client.post(f"{SOURCES_PATH}/{source_id}/refresh", headers=h)
    assert resp.status_code == 200, resp.text
    assert resp.json()["id"] == source_id

    # DELETE → 204；再 list 为空
    resp = await client.delete(f"{SOURCES_PATH}/{source_id}", headers=h)
    assert resp.status_code == 204
    resp = await client.get(SOURCES_PATH, headers=h)
    assert resp.json() == []


@pytest.mark.asyncio
async def test_unknown_id_404(client: AsyncClient, db_session: AsyncSession, monkeypatch):
    """admin 对未知 id PATCH/DELETE/refresh → 404（SkillSourceNotFound）。"""
    _mock_git_present(monkeypatch)
    _, token = await _make_user(db_session, admin=True)
    h = _headers(token)
    unknown = str(uuid.uuid4())

    resp = await client.patch(f"{SOURCES_PATH}/{unknown}", json={"branch": "x"}, headers=h)
    assert resp.status_code == 404
    resp = await client.delete(f"{SOURCES_PATH}/{unknown}", headers=h)
    assert resp.status_code == 404
    resp = await client.post(f"{SOURCES_PATH}/{unknown}/refresh", headers=h)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_url_conflict_409(client: AsyncClient, db_session: AsyncSession, monkeypatch):
    """同 url 重复创建 → 409（url 全局 UNIQUE）。"""
    _mock_git_present(monkeypatch)
    _, token = await _make_user(db_session, admin=True)
    h = _headers(token)
    await _create_source(client, token)
    resp = await client.post(SOURCES_PATH, json={"url": PUBLIC_URL}, headers=h)
    assert resp.status_code == 409


# ─── 权限矩阵（全 admin 门）─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_non_admin_403_all_endpoints(client: AsyncClient, db_session: AsyncSession):
    """非 admin（无角色授权）五端点全 403（SETTINGS_ADMIN 门）。"""
    _, token = await _make_user(db_session, admin=False)
    h = _headers(token)
    some_id = str(uuid.uuid4())

    resp = await client.get(SOURCES_PATH, headers=h)
    assert resp.status_code == 403
    resp = await client.post(SOURCES_PATH, json={"url": PUBLIC_URL}, headers=h)
    assert resp.status_code == 403
    resp = await client.patch(f"{SOURCES_PATH}/{some_id}", json={"branch": "x"}, headers=h)
    assert resp.status_code == 403
    resp = await client.delete(f"{SOURCES_PATH}/{some_id}", headers=h)
    assert resp.status_code == 403
    resp = await client.post(f"{SOURCES_PATH}/{some_id}/refresh", headers=h)
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_unauthenticated_401(client: AsyncClient):
    """未登录（无 Bearer）→ 401。"""
    resp = await client.get(SOURCES_PATH)
    assert resp.status_code == 401
    resp = await client.post(SOURCES_PATH, json={"url": PUBLIC_URL})
    assert resp.status_code == 401


# ─── SSRF（私网/非法 scheme → 400）─────────────────────────────────────


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad_url",
    [
        "http://127.0.0.1/skills.git",  # 回环
        "http://10.0.0.1/skills.git",  # RFC1918
        "http://169.254.169.254/latest/meta-data/",  # 云元数据
        "ftp://8.8.8.8/skills.git",  # 非法 scheme
        "file:///etc/passwd",  # 非法 scheme
        "no-scheme-url",  # 空 scheme
    ],
)
async def test_create_ssrf_rejected_400(
    client: AsyncClient, db_session: AsyncSession, monkeypatch, bad_url: str
):
    """SSRF 拒私网/非法 scheme → 400（assert_public_url 原生状态码）。"""
    _mock_git_present(monkeypatch)
    _, token = await _make_user(db_session, admin=True)
    resp = await client.post(SOURCES_PATH, json={"url": bad_url}, headers=_headers(token))
    assert resp.status_code == 400, f"{bad_url} should be 400, got {resp.status_code}: {resp.text}"
    # 拒绝后不落库
    resp = await client.get(SOURCES_PATH, headers=_headers(token))
    assert resp.json() == []


@pytest.mark.asyncio
async def test_update_url_to_private_400(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
):
    """update 改 url 到私网 → 400（改 url 重过 SSRF 校验）。"""
    _mock_git_present(monkeypatch)
    _, token = await _make_user(db_session, admin=True)
    h = _headers(token)
    created = await _create_source(client, token)

    resp = await client.patch(
        f"{SOURCES_PATH}/{created['id']}",
        json={"url": "http://192.168.1.1/skills.git"},
        headers=h,
    )
    assert resp.status_code == 400
    # 原 url 未被改动
    resp = await client.get(SOURCES_PATH, headers=h)
    assert resp.json()[0]["url"] == PUBLIC_URL


@pytest.mark.asyncio
async def test_update_url_to_new_public_200(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
):
    """update 改 url 到另一公网地址 → 200。"""
    _mock_git_present(monkeypatch)
    _, token = await _make_user(db_session, admin=True)
    h = _headers(token)
    created = await _create_source(client, token)

    resp = await client.patch(
        f"{SOURCES_PATH}/{created['id']}",
        json={"url": PUBLIC_URL_2},
        headers=h,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["url"] == PUBLIC_URL_2


# ─── git 二进制探测（R-01 → 422）────────────────────────────────────────


@pytest.mark.asyncio
async def test_create_git_missing_422(client: AsyncClient, db_session: AsyncSession, monkeypatch):
    """git 缺失环境（shutil.which → None）创建 → 422 明确提示。"""
    _mock_git_missing(monkeypatch)
    _, token = await _make_user(db_session, admin=True)
    h = _headers(token)

    resp = await client.post(SOURCES_PATH, json={"url": PUBLIC_URL}, headers=h)
    assert resp.status_code == 422, resp.text
    # 拒绝后不落库
    resp = await client.get(SOURCES_PATH, headers=h)
    assert resp.json() == []


@pytest.mark.asyncio
async def test_refresh_git_missing_422(client: AsyncClient, db_session: AsyncSession, monkeypatch):
    """git 缺失环境刷新既有源 → 422。"""
    _mock_git_present(monkeypatch)
    _, token = await _make_user(db_session, admin=True)
    h = _headers(token)
    created = await _create_source(client, token)

    _mock_git_missing(monkeypatch)
    resp = await client.post(f"{SOURCES_PATH}/{created['id']}/refresh", headers=h)
    assert resp.status_code == 422, resp.text


# ─── 删除连带（绑定前缀清理 + 缓存目录 best-effort）─────────────────────


@pytest.mark.asyncio
async def test_delete_cascades_enables_and_cache_dir(
    client: AsyncClient, db_session: AsyncSession, monkeypatch, tmp_path
):
    """删除源：该源 skill_key 前缀绑定连带清、他源绑定保留、缓存目录删除。"""
    _mock_git_present(monkeypatch)
    user, token = await _make_user(db_session, admin=True)
    h = _headers(token)
    created = await _create_source(client, token)
    source_id = created["id"]

    # 两条绑定：本源前缀 + 他源前缀对照
    own_key = f"{source_id}:my-skill"
    other_key = f"{uuid.uuid4()}:other-skill"
    db_session.add(UserSkillEnable(user_id=user.id, skill_key=own_key))
    db_session.add(UserSkillEnable(user_id=user.id, skill_key=other_key))
    await db_session.commit()

    # 造缓存目录（task-02 前真实拉取不存在，手工造验证删除连带）——
    # spec_data_root 指到 tmp_path 让缓存根落测试沙箱（对缓存实例 setattr，
    # daemon/host_fs/tests/test_delegate_probe.py:203 先例；根 conftest 会对
    # Settings.__init__ 注入 spec_data_root，setenv 环境变量会被 init kwarg
    # 覆盖，故不走 env）。
    monkeypatch.setattr(get_settings(), "spec_data_root", str(tmp_path))
    cache_dir = source_cache_dir(uuid.UUID(source_id))
    cache_dir.mkdir(parents=True)
    (cache_dir / "SKILL.md").write_text("# x", encoding="utf-8")

    resp = await client.delete(f"{SOURCES_PATH}/{source_id}", headers=h)
    assert resp.status_code == 204

    assert not cache_dir.exists(), "缓存目录应被 best-effort 删除"

    remaining = (await db_session.execute(select(UserSkillEnable))).scalars().all()
    keys = {row.skill_key for row in remaining}
    assert own_key not in keys, "该源前缀绑定应连带清理"
    assert other_key in keys, "他源绑定应保留"


@pytest.mark.asyncio
async def test_delete_missing_cache_dir_ok(
    client: AsyncClient, db_session: AsyncSession, monkeypatch
):
    """缓存目录不存在（从未拉取）时删除源仍 204（best-effort 不报错）。"""
    _mock_git_present(monkeypatch)
    _, token = await _make_user(db_session, admin=True)
    h = _headers(token)
    created = await _create_source(client, token)

    resp = await client.delete(f"{SOURCES_PATH}/{created['id']}", headers=h)
    assert resp.status_code == 204
