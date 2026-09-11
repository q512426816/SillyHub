"""Tests for ``GET /api/skills/library`` + ``POST/DELETE /api/skills/{key}/enable``（task-03）。

Change: 2026-09-11-skills-central-library

Covers（taskcard acceptance）:
- enable 回环：POST 建（204）幂等（重复 POST 仍 204 且仅一行）；DELETE 删幂等
  （无绑定也 204）；library 启用态回读一致。
- 非法 skill_key 格式 → 422（无冒号/坏 UUID/空目录段/含路径分隔符/超长）。
- 未命中启用源发现结果 → 404（源不存在/目录未拉取/源停用统一口径）。
- library 三源聚合：sillyspec-*（skills_bundle_dir 扫描 description）+ 我的
  CustomSkill + enabled 源实时发现（disabled 源不参与）；git 技能默认未启用
  （D-003）；启用态 per-user 隔离（A 启用不影响 B 视图）。
- 权限：三端点任意登录用户（非 admin 可 enable，无 admin 代写面）；未登录 401。
- 源删除连带：enable 后删除源 → 绑定连带清（task-01 delete 路径联动回环）。

离线性：SkillSource 行直插 DB + 缓存目录手工构造（tmp spec_data_root），全程
不触 git 二进制/外网（enable 只消费 discover_skills 的文件系统扫描）。
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import User
from app.modules.skill_source.model import SkillSource, UserSkillEnable
from app.modules.skill_source.service import source_cache_dir
from app.modules.skills.model import CustomSkill

LIBRARY_PATH = "/api/skills/library"
SOURCES_PATH = "/api/skill-sources"


# ─── 铺底 helpers（test_source_crud.py 同款用户构造）─────────────────────


async def _make_user(session: AsyncSession, *, admin: bool = False) -> tuple[User, str]:
    """Create user + token（test_source_crud._make_user 同款）。"""
    user = User(
        id=uuid.uuid4(),
        email=f"lib-{uuid.uuid4().hex[:6]}@example.com",
        username=f"lib-{uuid.uuid4().hex[:6]}",
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


def _patch_spec_data_root(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """spec_data_root → tmp（git 缓存根落测试沙箱；test_source_crud.py:346 先例）。"""
    monkeypatch.setattr(get_settings(), "spec_data_root", str(tmp_path))


async def _add_source(
    db_session: AsyncSession,
    *,
    enabled: bool = True,
    subdir: str | None = None,
) -> SkillSource:
    """直插源行（绕过 create 端点：无须 git mock，缓存目录手工构造）。"""
    source = SkillSource(
        url=f"https://8.8.8.8/{uuid.uuid4().hex}.git",
        branch="main",
        subdir=subdir,
        enabled=enabled,
    )
    db_session.add(source)
    await db_session.commit()
    await db_session.refresh(source)
    return source


def _make_cached_skill(source_id: uuid.UUID, dir_name: str, *, subdir: str | None = None) -> None:
    """缓存根造技能目录（带 frontmatter 的 SKILL.md + 辅助文件）。"""
    root = source_cache_dir(source_id)
    skill_dir = root / subdir if subdir else root
    skill_dir = skill_dir / dir_name
    skill_dir.mkdir(parents=True, exist_ok=True)
    (skill_dir / "SKILL.md").write_bytes(
        (f"---\nname: {dir_name}\ndescription: {dir_name} 的演示技能\n---\n\n# body\n").encode()
    )
    (skill_dir / "run.py").write_bytes(b"x = 1\n")


async def _enable_rows(db_session: AsyncSession) -> set[tuple[uuid.UUID, str]]:
    rows = (await db_session.execute(select(UserSkillEnable))).scalars().all()
    return {(row.user_id, row.skill_key) for row in rows}


# ─── enable 回环（幂等建/删）────────────────────────────────────────────


@pytest.mark.asyncio
async def test_enable_disable_roundtrip_idempotent(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path, monkeypatch
):
    """POST 建（幂等一行）→ library 回读 enabled=True → DELETE 删（幂等零行）。"""
    _patch_spec_data_root(monkeypatch, tmp_path)
    user, token = await _make_user(db_session)
    h = _headers(token)
    source = await _add_source(db_session)
    _make_cached_skill(source.id, "alpha-skill")
    key = f"{source.id}:alpha-skill"

    # POST 启用 → 204，绑定恰一行
    resp = await client.post(f"/api/skills/{key}/enable", json={"enabled": True}, headers=h)
    assert resp.status_code == 204, resp.text
    assert await _enable_rows(db_session) == {(user.id, key)}

    # 重复 POST → 仍 204，幂等不重复建
    resp = await client.post(f"/api/skills/{key}/enable", json={"enabled": True}, headers=h)
    assert resp.status_code == 204
    assert await _enable_rows(db_session) == {(user.id, key)}

    # library 回读启用态
    resp = await client.get(LIBRARY_PATH, headers=h)
    assert resp.status_code == 200
    item = next(s for s in resp.json()["skills"] if s["skill_key"] == key)
    assert item["enabled"] is True
    assert item["source"] == "git"
    assert item["description"] == "alpha-skill 的演示技能"

    # POST enabled=False（与 DELETE 等价）→ 204 零行
    resp = await client.post(f"/api/skills/{key}/enable", json={"enabled": False}, headers=h)
    assert resp.status_code == 204
    assert await _enable_rows(db_session) == set()

    # DELETE 无绑定 → 仍 204（幂等）
    resp = await client.delete(f"/api/skills/{key}/enable", headers=h)
    assert resp.status_code == 204
    assert await _enable_rows(db_session) == set()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "bad_key",
    [
        "no-colon-key",  # 无冒号
        "not-a-uuid:dir",  # source_id 段非 UUID
        f"{uuid.uuid4()}",  # 只有 UUID 无目录段
        f"{uuid.uuid4()}:",  # 空目录段
        f"{uuid.uuid4()}:dir\\slash",  # Windows 分隔符
        "x" * 201,  # 超列宽
    ],
)
async def test_enable_invalid_skill_key_422(
    client: AsyncClient, db_session: AsyncSession, bad_key: str
):
    """非法 skill_key 格式 → 422（parse_skill_key 契约）。"""
    _, token = await _make_user(db_session)
    resp = await client.post(
        f"/api/skills/{bad_key}/enable", json={"enabled": True}, headers=_headers(token)
    )
    assert resp.status_code == 422, f"{bad_key!r} should be 422: {resp.text}"
    assert await _enable_rows(db_session) == set()


def test_parse_skill_key_rejects_path_separator() -> None:
    """目录段含 ``/`` 的 key：URL 层天然不可达（路由匹配不到 → 404），
    parse_skill_key 单元级兜底断言（防穿越，非路由入口仍被拦）。"""
    from app.modules.skill_source.service import InvalidSkillKey, parse_skill_key

    with pytest.raises(InvalidSkillKey):
        parse_skill_key(f"{uuid.uuid4()}:a/b")


@pytest.mark.asyncio
async def test_enable_not_discoverable_404(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path, monkeypatch
):
    """未命中启用源发现结果 → 404：源不存在 / 目录未拉取 / 源停用。"""
    _patch_spec_data_root(monkeypatch, tmp_path)
    _, token = await _make_user(db_session)
    h = _headers(token)

    # 源不存在（随机 UUID）
    resp = await client.post(
        f"/api/skills/{uuid.uuid4()}:ghost/enable", json={"enabled": True}, headers=h
    )
    assert resp.status_code == 404

    # 源在但缓存目录从未拉取（discover 空）
    unfetched = await _add_source(db_session)
    resp = await client.post(
        f"/api/skills/{unfetched.id}:nothing/enable", json={"enabled": True}, headers=h
    )
    assert resp.status_code == 404

    # 源停用（目录在但 enabled=False 不参与发现/收集）
    disabled = await _add_source(db_session, enabled=False)
    _make_cached_skill(disabled.id, "off-skill")
    resp = await client.post(
        f"/api/skills/{disabled.id}:off-skill/enable", json={"enabled": True}, headers=h
    )
    assert resp.status_code == 404
    assert await _enable_rows(db_session) == set()


# ─── library 三源聚合 ───────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_library_aggregates_three_sources(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path, monkeypatch
):
    """三源聚合：sillyspec-*（含 description）+ 我的 CustomSkill + enabled 源发现。"""
    _patch_spec_data_root(monkeypatch, tmp_path)
    user, token = await _make_user(db_session)
    h = _headers(token)

    # 平台 sillyspec-*：临时 skills_bundle_dir + 带描述的 SKILL.md
    fake_bundle_dir = tmp_path / "platform-skills"
    platform = fake_bundle_dir / "sillyspec-demo"
    platform.mkdir(parents=True)
    (platform / "SKILL.md").write_bytes(
        "---\nname: sillyspec:demo\ndescription: 平台演示技能\n---\n\nbody".encode()
    )
    monkeypatch.setattr(get_settings(), "skills_bundle_dir", fake_bundle_dir)

    # 我的 CustomSkill
    db_session.add(
        CustomSkill(
            name="my-custom",
            description="我的自定义技能",
            content="# body",
            created_by=user.id,
        )
    )
    await db_session.commit()

    # git：一启用源（2 技能）+ 一停用源（1 技能，不得出现）
    enabled_src = await _add_source(db_session)
    _make_cached_skill(enabled_src.id, "alpha-skill")
    _make_cached_skill(enabled_src.id, "beta-skill")
    disabled_src = await _add_source(db_session, enabled=False)
    _make_cached_skill(disabled_src.id, "hidden-skill")

    resp = await client.get(LIBRARY_PATH, headers=h)
    assert resp.status_code == 200
    payload = resp.json()

    # sources：全部已配置源（含停用，enabled 字段供前端区分）
    assert {s["id"] for s in payload["sources"]} == {str(enabled_src.id), str(disabled_src.id)}

    skills = {s["skill_key"]: s for s in payload["skills"]}
    # sillyspec-*：恒启用、description 来自 frontmatter
    demo = skills["sillyspec-demo"]
    assert demo["source"] == "sillyspec"
    assert demo["enabled"] is True
    assert demo["description"] == "平台演示技能"
    assert demo["source_id"] is None

    # 我的 CustomSkill：恒启用
    custom = skills["my-custom"]
    assert custom["source"] == "custom"
    assert custom["enabled"] is True
    assert custom["description"] == "我的自定义技能"

    # git：enabled 源实时发现、默认未启用（D-003）、带源信息
    for name in ("alpha-skill", "beta-skill"):
        key = f"{enabled_src.id}:{name}"
        item = skills[key]
        assert item["source"] == "git"
        assert item["enabled"] is False
        assert item["source_id"] == str(enabled_src.id)
        assert item["description"] == f"{name} 的演示技能"
    # 停用源技能不参与
    assert f"{disabled_src.id}:hidden-skill" not in skills


@pytest.mark.asyncio
async def test_library_git_default_off_and_per_user(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path, monkeypatch
):
    """启用态 per-user：A 启用后 B 视图仍默认关；B（非 admin）可自行启用。"""
    _patch_spec_data_root(monkeypatch, tmp_path)
    user_a, token_a = await _make_user(db_session)
    user_b, token_b = await _make_user(db_session)
    source = await _add_source(db_session)
    _make_cached_skill(source.id, "shared-skill")
    key = f"{source.id}:shared-skill"

    # A 启用（非 admin 也可——任意登录用户本人写）
    resp = await client.post(
        f"/api/skills/{key}/enable", json={"enabled": True}, headers=_headers(token_a)
    )
    assert resp.status_code == 204

    # B 视图默认关（D-003，启用绑定 per-user 隔离）
    resp = await client.get(LIBRARY_PATH, headers=_headers(token_b))
    item = next(s for s in resp.json()["skills"] if s["skill_key"] == key)
    assert item["enabled"] is False

    # A 视图开
    resp = await client.get(LIBRARY_PATH, headers=_headers(token_a))
    item = next(s for s in resp.json()["skills"] if s["skill_key"] == key)
    assert item["enabled"] is True

    # B 自行启用成功（本人写，无须 admin）
    resp = await client.post(
        f"/api/skills/{key}/enable", json={"enabled": True}, headers=_headers(token_b)
    )
    assert resp.status_code == 204
    assert await _enable_rows(db_session) == {(user_a.id, key), (user_b.id, key)}


# ─── 权限（登录即可）────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_library_and_enable_unauthenticated_401(client: AsyncClient):
    """未登录：GET library / POST enable / DELETE enable 全 401。"""
    resp = await client.get(LIBRARY_PATH)
    assert resp.status_code == 401
    resp = await client.post(
        "/api/skills/00000000-0000-0000-0000-000000000001:x/enable",
        json={"enabled": True},
    )
    assert resp.status_code == 401
    resp = await client.delete("/api/skills/00000000-0000-0000-0000-000000000001:x/enable")
    assert resp.status_code == 401


# ─── 源删除连带（task-01 delete 路径联动回环）──────────────────────────


@pytest.mark.asyncio
async def test_delete_source_cascades_endpoint_created_binding(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path, monkeypatch
):
    """经 enable 端点建的绑定：删除源后连带清（前缀匹配），他源绑定保留。"""
    _patch_spec_data_root(monkeypatch, tmp_path)
    user, token = await _make_user(db_session, admin=True)
    h = _headers(token)
    source = await _add_source(db_session)
    other = await _add_source(db_session)
    _make_cached_skill(source.id, "doomed-skill")
    key = f"{source.id}:doomed-skill"

    resp = await client.post(f"/api/skills/{key}/enable", json={"enabled": True}, headers=h)
    assert resp.status_code == 204
    # 他源对照绑定（直插，删除只清本源前缀）
    db_session.add(UserSkillEnable(user_id=user.id, skill_key=f"{other.id}:kept-skill"))
    await db_session.commit()

    resp = await client.delete(f"{SOURCES_PATH}/{source.id}", headers=h)
    assert resp.status_code == 204

    rows = await _enable_rows(db_session)
    assert (user.id, key) not in rows, "本源绑定应连带清理"
    assert (user.id, f"{other.id}:kept-skill") in rows, "他源绑定应保留"
