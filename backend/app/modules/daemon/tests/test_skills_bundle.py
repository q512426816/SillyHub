"""Tests for the skills bundle packaging and distribution endpoints (task-06).

Covers:
* ``GET /api/daemon/skills/latest/manifest`` — manifest fields, sha256 per file
* ``GET /api/daemon/skills/latest/bundle`` — tar.gz binary stream, content match
* 404 responses when the skills source directory does not exist or is empty

The bundled files are redirected to a ``tmp_path`` by patching the
``skills_bundle_service.get_settings`` module reference (robust against the
autouse ``_reset_settings_cache`` fixture which clears the lru_cache between
tests in the full suite).
"""

from __future__ import annotations

import hashlib
import io
import tarfile
import uuid
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# skill_source 两表须在本模块 import 期注册进 BaseModel.metadata——根 conftest 的
# db_engine 建表清单未含 skill_source（task-03 不能改 conftest，allowed_paths 限），
# 函数内延迟 import 会晚于 create_all 导致 no such table。test_source_crud.py:35 同款。
# Workspace 同理（bridges task-01 直插 ws 行；根 conftest 的 _ws_model 亦已注册）。
from app.modules.skill_source.model import SkillSource, UserSkillEnable
from app.modules.skill_source.service import source_cache_dir
from app.modules.workspace.model import Workspace


def _patch_skills_dir(monkeypatch: pytest.MonkeyPatch, src: Path) -> None:
    """Patch the skills_bundle_service module's get_settings to return a fake
    settings object whose ``skills_bundle_dir`` points at *src*.

    Patching the module-level ``get_settings`` reference (rather than the
    singleton attribute via ``get_settings()``) avoids flakes caused by the
    autouse ``_reset_settings_cache`` fixture clearing the lru_cache between
    tests in the full suite.
    """

    class _FakeSettings:
        skills_bundle_dir = src

    from app.modules.agent import skills_bundle_service

    monkeypatch.setattr(skills_bundle_service, "get_settings", lambda: _FakeSettings())


@pytest.fixture()
def skills_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Create a fake skills directory with a few sillyspec-* skill files."""
    src = tmp_path / "skills"
    src.mkdir()

    verify = src / "sillyspec-verify"
    verify.mkdir()
    (verify / "index.ts").write_bytes(b'export async function verify() { return "pass"; }\n')
    (verify / "config.json").write_bytes(b'{"name": "sillyspec-verify"}\n')

    execute = src / "sillyspec-execute"
    execute.mkdir()
    (execute / "index.ts").write_bytes(b'export async function execute() { return "done"; }\n')

    brainstorm = src / "sillyspec-brainstorm"
    brainstorm.mkdir()
    (brainstorm / "main.ts").write_bytes(b"// brainstorm skill\n")
    nested = brainstorm / "templates"
    nested.mkdir()
    (nested / "design.hbs").write_bytes(b"## Design\n{{content}}\n")

    _patch_skills_dir(monkeypatch, src)
    return src


@pytest.fixture()
def empty_skills_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point ``skills_bundle_dir`` at an empty temp directory (no sillyspec-*)."""
    src = tmp_path / "empty-skills"
    src.mkdir()
    _patch_skills_dir(monkeypatch, src)
    return src


@pytest.fixture()
def missing_skills_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point ``skills_bundle_dir`` at a non-existent directory."""
    src = tmp_path / "no-skills-here"
    _patch_skills_dir(monkeypatch, src)
    return src


async def test_manifest_fields(
    client: AsyncClient, auth_headers: dict[str, str], skills_dir: Path
) -> None:
    """Manifest returns correct version, file list, and sha256 per file."""
    resp = await client.get("/api/daemon/skills/latest/manifest", headers=auth_headers)
    assert resp.status_code == 200

    payload = resp.json()
    assert "version" in payload
    assert payload["version"] != ""
    assert len(payload["version"]) == 12

    files = payload["files"]
    assert len(files) >= 4

    for entry in files:
        assert "path" in entry
        assert "sha256" in entry
        assert len(entry["sha256"]) == 64

    verify_index = [f for f in files if f["path"].startswith("sillyspec-verify/index")]
    assert len(verify_index) == 1
    verify_path = skills_dir / verify_index[0]["path"]
    expected_hash = hashlib.sha256(verify_path.read_bytes()).hexdigest()
    assert verify_index[0]["sha256"] == expected_hash


async def test_bundle_content(
    client: AsyncClient, auth_headers: dict[str, str], skills_dir: Path
) -> None:
    """Bundle extracts to tar.gz and contains all files from skills_dir."""
    resp = await client.get("/api/daemon/skills/latest/bundle", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/gzip")
    assert "sillyspec-skills.tar.gz" in resp.headers.get("content-disposition", "")

    buf = io.BytesIO(resp.content)
    extracted: dict[str, bytes] = {}
    with tarfile.open(fileobj=buf, mode="r:gz") as tar:
        for member in tar.getmembers():
            f = tar.extractfile(member)
            if f is not None:
                extracted[member.name] = f.read()

    assert any(p.startswith("sillyspec-verify/") for p in extracted)
    assert any(p.startswith("sillyspec-execute/") for p in extracted)
    assert any(p.startswith("sillyspec-brainstorm/") for p in extracted)

    verify_path = skills_dir / "sillyspec-verify" / "index.ts"
    expected_bytes = verify_path.read_bytes()
    verify_tar_entry = [p for p in extracted if p.endswith("sillyspec-verify/index.ts")]
    assert verify_tar_entry
    assert extracted[verify_tar_entry[0]] == expected_bytes


async def test_sha256_match(
    client: AsyncClient, auth_headers: dict[str, str], skills_dir: Path
) -> None:
    """sha256 of files in the bundle match the manifest's sha256."""
    manifest_resp = await client.get("/api/daemon/skills/latest/manifest", headers=auth_headers)
    assert manifest_resp.status_code == 200
    manifest = manifest_resp.json()

    bundle_resp = await client.get("/api/daemon/skills/latest/bundle", headers=auth_headers)
    assert bundle_resp.status_code == 200

    buf = io.BytesIO(bundle_resp.content)
    with tarfile.open(fileobj=buf, mode="r:gz") as tar:
        for member in tar.getmembers():
            if not member.isfile():
                continue
            f = tar.extractfile(member)
            if f is None:
                continue
            data = f.read()
            computed_sha = hashlib.sha256(data).hexdigest()

            manifest_entry = next((e for e in manifest["files"] if e["path"] == member.name), None)
            assert manifest_entry is not None, f"File {member.name} missing from manifest"
            assert manifest_entry["sha256"] == computed_sha


async def test_404_when_skills_dir_missing(
    client: AsyncClient, auth_headers: dict[str, str], missing_skills_dir: Path
) -> None:
    """Both endpoints return 404 when the skills directory does not exist."""
    resp_manifest = await client.get("/api/daemon/skills/latest/manifest", headers=auth_headers)
    assert resp_manifest.status_code == 404

    resp_bundle = await client.get("/api/daemon/skills/latest/bundle", headers=auth_headers)
    assert resp_bundle.status_code == 404


async def test_404_when_skills_dir_empty(
    client: AsyncClient, auth_headers: dict[str, str], empty_skills_dir: Path
) -> None:
    """Both endpoints return 404 when the skills directory has no sillyspec-* dirs."""
    resp_manifest = await client.get("/api/daemon/skills/latest/manifest", headers=auth_headers)
    assert resp_manifest.status_code == 404

    resp_bundle = await client.get("/api/daemon/skills/latest/bundle", headers=auth_headers)
    assert resp_bundle.status_code == 404


# ---------------------------------------------------------------------------
# task-03: DB CustomSkill 合并进 manifest/bundle（D-001 单文件 DB）。
# 每个 CustomSkill → <name>/SKILL.md；version hash 含 DB content；空 DB 兼容。
# ---------------------------------------------------------------------------


def _add_custom_skill(
    db_session: AsyncSession, name: str, content: str, created_by: uuid.UUID
) -> None:
    """Insert a CustomSkill row (commit handled by caller fixture).

    task-01 D-001：``CustomSkill.created_by`` NOT NULL + ON DELETE CASCADE——
    per-user 强归属，调用方必须显式传 user_id（不再允许隐式全局共享的旧用法）。
    """
    from app.modules.skills.model import CustomSkill

    db_session.add(
        CustomSkill(
            name=name,
            description=f"custom skill {name}",
            content=content,
            created_by=created_by,
        )
    )


@pytest.fixture()
async def default_user_id(db_session: AsyncSession, auth_headers: dict[str, str]) -> uuid.UUID:
    """``auth_headers`` 对应的 admin 用户 id（``auth_admin_token`` fixture 建的
    ``admin@example.com``）。

    ``_add_custom_skill`` 的 ``created_by`` 归属键——CustomSkill 已 NOT NULL
    （task-01 D-001），造数据必须传。这里依赖 ``auth_headers`` 保证用户已落库，
    再按 email 反查 id（``auth_admin_token`` 用随机 uuid，无法直接拿到）。
    """
    from app.modules.auth.model import User

    row = (
        await db_session.execute(select(User).where(User.email == "admin@example.com"))
    ).scalar_one()
    return row.id


async def test_manifest_includes_custom_skills(
    client: AsyncClient,
    auth_headers: dict[str, str],
    skills_dir: Path,
    db_session: AsyncSession,
    default_user_id: uuid.UUID,
) -> None:
    """验收 A：manifest 含代码库 sillyspec-* + DB CustomSkill 的 <name>/SKILL.md。"""
    _add_custom_skill(db_session, "my-custom", "# my custom skill\nbody line", default_user_id)
    _add_custom_skill(db_session, "another-one", "# another\ncontent here", default_user_id)
    await db_session.commit()

    resp = await client.get("/api/daemon/skills/latest/manifest", headers=auth_headers)
    assert resp.status_code == 200
    files = resp.json()["files"]

    # DB custom skills 以 <name>/SKILL.md 出现
    paths = {f["path"] for f in files}
    assert "my-custom/SKILL.md" in paths
    assert "another-one/SKILL.md" in paths
    # 代码库 sillyspec-* 仍在（零回归）
    assert any(p.startswith("sillyspec-verify/") for p in paths)

    # sha256 与打包层拼装的 frontmatter+body 一致（D-001：_build_skill_md 拼 frontmatter）
    expected_my = (
        "---\nname: my-custom\ndescription: custom skill my-custom\n---\n\n"
        "# my custom skill\nbody line"
    )
    custom_entry = next(f for f in files if f["path"] == "my-custom/SKILL.md")
    assert custom_entry["sha256"] == hashlib.sha256(expected_my.encode("utf-8")).hexdigest()


async def test_bundle_includes_custom_skills(
    client: AsyncClient,
    auth_headers: dict[str, str],
    skills_dir: Path,
    db_session: AsyncSession,
    default_user_id: uuid.UUID,
) -> None:
    """验收 A：bundle 含 DB CustomSkill 的 <name>/SKILL.md，内容匹配。"""
    _add_custom_skill(db_session, "bundled-skill", "## hello\nworld", default_user_id)
    await db_session.commit()

    resp = await client.get("/api/daemon/skills/latest/bundle", headers=auth_headers)
    assert resp.status_code == 200

    extracted: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:gz") as tar:
        for member in tar.getmembers():
            f = tar.extractfile(member)
            if f is not None:
                extracted[member.name] = f.read()

    expected_bundle = (
        b"---\nname: bundled-skill\ndescription: custom skill bundled-skill\n---\n\n## hello\nworld"
    )
    assert "bundled-skill/SKILL.md" in extracted
    assert extracted["bundled-skill/SKILL.md"] == expected_bundle
    # 代码库文件仍在
    assert any(p.startswith("sillyspec-verify/") for p in extracted)


async def test_version_changes_on_custom_skill_mutation(
    client: AsyncClient,
    auth_headers: dict[str, str],
    skills_dir: Path,
    db_session: AsyncSession,
    default_user_id: uuid.UUID,
) -> None:
    """验收 B：增/删/改 CustomSkill → version hash 变化。"""
    # 基线：纯代码库（DB 空）
    base = (await client.get("/api/daemon/skills/latest/manifest", headers=auth_headers)).json()
    base_version = base["version"]
    assert base_version != ""

    # 增 → version 变
    _add_custom_skill(db_session, "new-skill", "# v1", default_user_id)
    await db_session.commit()
    after_add = (
        await client.get("/api/daemon/skills/latest/manifest", headers=auth_headers)
    ).json()
    assert after_add["version"] != base_version

    # 改 content → version 变
    from sqlalchemy import select

    from app.modules.skills.model import CustomSkill

    row = (
        await db_session.execute(select(CustomSkill).where(CustomSkill.name == "new-skill"))
    ).scalar_one()
    row.content = "# v2 changed"
    await db_session.commit()
    after_edit = (
        await client.get("/api/daemon/skills/latest/manifest", headers=auth_headers)
    ).json()
    assert after_edit["version"] != after_add["version"]

    # 删 → version 变（回到基线）
    await db_session.delete(row)
    await db_session.commit()
    after_delete = (
        await client.get("/api/daemon/skills/latest/manifest", headers=auth_headers)
    ).json()
    assert after_delete["version"] == base_version


async def test_empty_db_equals_codebase_only(
    client: AsyncClient,
    auth_headers: dict[str, str],
    skills_dir: Path,
) -> None:
    """验收 C：空 DB 时 manifest = 纯代码库（兼容，无 <name>/SKILL.md 项）。"""
    resp = await client.get("/api/daemon/skills/latest/manifest", headers=auth_headers)
    assert resp.status_code == 200
    files = resp.json()["files"]
    # 无任何 CustomSkill 落库 → 不应有 <name>/SKILL.md 形态条目
    assert not any(f["path"].endswith("/SKILL.md") for f in files)
    # 代码库文件齐全
    assert any(f["path"].startswith("sillyspec-verify/") for f in files)


async def test_build_manifest_without_session_skips_db(
    skills_dir: Path,
) -> None:
    """session=None 向后兼容：不查 DB，输出 = 纯代码库扫描结果。

    直接调 service 层（不经 router），验证 session 可选参数的旧行为契约。
    """
    from app.modules.agent.skills_bundle_service import build_skills_manifest

    manifest = await build_skills_manifest()
    assert manifest["version"] != ""
    # 仅代码库文件，无 /SKILL.md（代码库 sillyspec-* 不含 SKILL.md 文件）
    assert not any(f["path"].endswith("/SKILL.md") for f in manifest["files"])
    assert any(f["path"].startswith("sillyspec-verify/") for f in manifest["files"])


async def test_custom_skill_name_no_sillyspec_prefix_collision(
    client: AsyncClient,
    auth_headers: dict[str, str],
    skills_dir: Path,
    db_session: AsyncSession,
    default_user_id: uuid.UUID,
) -> None:
    """D-002 边界：custom name 不带 sillyspec- 前缀，与代码库命名空间独立。

    即使 custom name 恰好与 sillyspec-verify 同名（custom 名 'sillyspec-verify'
    在业务层被禁止，但 bundle 层应显式按 D-001 处理：custom → <name>/SKILL.md，
    代码库 → sillyspec-verify/<file>，二者路径形态不同不冲突）。这里只验证
    bundle 层路径形态分离（业务层 name 校验在 task-02 service）。
    """
    _add_custom_skill(db_session, "plain-name", "# plain", default_user_id)
    await db_session.commit()

    resp = await client.get("/api/daemon/skills/latest/manifest", headers=auth_headers)
    paths = {f["path"] for f in resp.json()["files"]}
    assert "plain-name/SKILL.md" in paths
    # 代码库 sillyspec-verify/index.ts 仍在（custom 不抢占其命名空间）
    assert any(p.startswith("sillyspec-verify/index") for p in paths)


# ---------------------------------------------------------------------------
# ql-20260731-001-3abf：manifest.skills 字段（展示用，每个 skill 的 description）。
# 从 SKILL.md frontmatter 提取 description，供平台技能清单页显示每个技能「干什么」。
# ---------------------------------------------------------------------------


@pytest.fixture()
def skills_dir_with_descriptions(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """skills 目录，每个 skill 含带 frontmatter 的 SKILL.md（模拟真实 ``.claude/skills``）。"""
    src = tmp_path / "skills-with-md"
    src.mkdir()

    archive = src / "sillyspec-archive"
    archive.mkdir()
    (archive / "SKILL.md").write_bytes(
        (
            "---\nname: sillyspec:archive\n"
            "description: 用于归档已验证完成的变更\n"
            "---\n\n## 何时使用\nbody\n"
        ).encode()
    )
    (archive / "helper.md").write_bytes(b"helper file\n")

    plain = src / "sillyspec-plain"
    plain.mkdir()
    # 无 frontmatter 围栏的 SKILL.md（只有 body）→ description 兜底空串
    (plain / "SKILL.md").write_bytes(b"## plain skill\nno frontmatter here\n")

    _patch_skills_dir(monkeypatch, src)
    return src


def test_parse_skill_frontmatter_extracts_description() -> None:
    """_parse_skill_frontmatter 取出 name + description。"""
    from app.modules.agent.skills_bundle_service import _parse_skill_frontmatter

    md = (
        "---\nname: sillyspec:archive\ndescription: 用于归档已验证完成的变更\n---\n\n## body\n"
    ).encode()
    fm = _parse_skill_frontmatter(md)
    assert fm["name"] == "sillyspec:archive"
    assert fm["description"] == "用于归档已验证完成的变更"


def test_parse_skill_frontmatter_no_fence_returns_empty() -> None:
    """无 frontmatter 围栏 → 空 dict（不抛异常）。"""
    from app.modules.agent.skills_bundle_service import _parse_skill_frontmatter

    assert _parse_skill_frontmatter(b"## plain\nbody\n") == {}


def test_summarize_skills_aggregates_by_top_dir() -> None:
    """按顶层目录聚合：name=目录名、description 来自 SKILL.md、file_count 计数。

    task-06（2026-08-26-session-input-mention）：每项新增 ``invoke_name`` 键——
    透传 SKILL.md frontmatter ``name`` 原值（冒号名原样保留），缺失为 None。
    """
    from app.modules.agent.skills_bundle_service import _summarize_skills

    files = [
        (Path("sillyspec-a/SKILL.md"), b"---\nname: a\ndescription: A skill\n---\n\nbody"),
        (Path("sillyspec-a/helper.ts"), b"helper"),
        (Path("sillyspec-b/SKILL.md"), b"---\ndescription: B\n---\n"),
    ]
    assert _summarize_skills(files) == [
        {
            "name": "sillyspec-a",
            "description": "A skill",
            "invoke_name": "a",
            "file_count": 2,
        },
        {
            "name": "sillyspec-b",
            "description": "B",
            "invoke_name": None,
            "file_count": 1,
        },
    ]


def test_summarize_skills_invoke_name_passthrough() -> None:
    """task-06（FR-07/D-002）：invoke_name 透传 frontmatter name 原值。

    * 有 frontmatter name 的技能（含冒号名）→ 原样保留（目录名兜底由前端完成）；
    * frontmatter 缺 name、无 SKILL.md → None（不是目录名，也不是空串）。
    """
    from app.modules.agent.skills_bundle_service import _summarize_skills

    files = [
        # 冒号名原样透传（与目录名 sillyspec-archive 不同）
        (
            Path("sillyspec-archive/SKILL.md"),
            b"---\nname: sillyspec:archive\ndescription: archive\n---\n\nbody",
        ),
        # 有 frontmatter 但缺 name → None
        (Path("sillyspec-noname/SKILL.md"), b"---\ndescription: no name\n---\n"),
        # 完全没有 SKILL.md → None
        (Path("sillyspec-nomd/helper.ts"), b"helper"),
    ]
    summaries = {s["name"]: s for s in _summarize_skills(files)}
    assert summaries["sillyspec-archive"]["invoke_name"] == "sillyspec:archive"
    assert summaries["sillyspec-noname"]["invoke_name"] is None
    assert summaries["sillyspec-nomd"]["invoke_name"] is None


async def test_manifest_includes_skill_descriptions(
    client: AsyncClient,
    auth_headers: dict[str, str],
    skills_dir_with_descriptions: Path,
) -> None:
    """manifest.skills 含每个 skill 的 description 与 invoke_name（端点透传可见）。

    有 frontmatter 提取（description 原值 / invoke_name 冒号名原样），无则兜底
    （description 空串 / invoke_name None）。
    """
    resp = await client.get("/api/daemon/skills/latest/manifest", headers=auth_headers)
    assert resp.status_code == 200

    payload = resp.json()
    assert "skills" in payload
    skills = {s["name"]: s for s in payload["skills"]}

    # 有 frontmatter 的技能：description 被提取；file_count = SKILL.md + helper.md
    archive = skills["sillyspec-archive"]
    assert archive["description"] == "用于归档已验证完成的变更"
    assert archive["file_count"] == 2
    # task-06（FR-07）：invoke_name 透传 frontmatter name 冒号名原值
    assert archive["invoke_name"] == "sillyspec:archive"

    # 无 frontmatter 的技能：description 空串兜底，invoke_name None，不报错
    plain = skills["sillyspec-plain"]
    assert plain["description"] == ""
    assert plain["invoke_name"] is None
    assert plain["file_count"] == 1

    # 契约：skills 数组每项 invoke_name 取值为 str 或 None
    assert all(
        isinstance(s["invoke_name"], str) or s["invoke_name"] is None for s in payload["skills"]
    )


# ---------------------------------------------------------------------------
# task-12（2026-07-31-custom-skill-per-user）：manifest/bundle 按 user 过滤。
# FR-06 / D-004：user A 的自定义技能进 A 的 manifest，不进 B 的；系统 sillyspec-*
# 文件系统扫描全局共享（D-006），A/B 都能看到。越权隔离回归。
# ---------------------------------------------------------------------------


async def test_manifest_filters_custom_skills_per_user(
    client: AsyncClient,
    auth_headers: dict[str, str],
    skills_dir: Path,
    db_session: AsyncSession,
    default_user_id: uuid.UUID,
) -> None:
    """验收 D（FR-06 / D-004）：manifest 按 ``created_by`` 过滤自定义技能。

    * user A（``auth_headers``，admin）建 ``skill-a``；user B（非 admin）建 ``skill-b``。
    * A 的 manifest 含 ``skill-a``、不含 ``skill-b``；B 的 manifest 含 ``skill-b``、
      不含 ``skill-a``（越权隔离，不再全局聚合）。
    * 系统 sillyspec-* 在两人 manifest 中都在（D-006：文件系统扫描与 user 无关）。
    """
    from app.core.config import get_settings
    from app.core.security import create_access_token, password_hasher
    from app.modules.auth.model import User

    # 建 user B（非 admin）+ token
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user_b = User(
        id=uuid.uuid4(),
        email="other@example.com",
        username="other-user",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="Other",
        status="active",
        is_platform_admin=False,
    )
    db_session.add(user_b)
    await db_session.commit()
    token_b, _ = create_access_token(
        user_id=user_b.id,
        email=user_b.email,
        is_admin=user_b.is_platform_admin,
        settings=settings,
    )
    headers_b = {"Authorization": f"Bearer {token_b}"}

    # A、B 各建一个私有技能
    _add_custom_skill(db_session, "skill-a", "# A only", default_user_id)
    _add_custom_skill(db_session, "skill-b", "# B only", user_b.id)
    await db_session.commit()

    # A 的 manifest：见 A 不见 B；系统 sillyspec-* 都在
    resp_a = await client.get("/api/daemon/skills/latest/manifest", headers=auth_headers)
    assert resp_a.status_code == 200
    paths_a = {f["path"] for f in resp_a.json()["files"]}
    assert "skill-a/SKILL.md" in paths_a
    assert "skill-b/SKILL.md" not in paths_a
    assert any(p.startswith("sillyspec-verify/") for p in paths_a)

    # B 的 manifest：见 B 不见 A；系统 sillyspec-* 都在
    resp_b = await client.get("/api/daemon/skills/latest/manifest", headers=headers_b)
    assert resp_b.status_code == 200
    paths_b = {f["path"] for f in resp_b.json()["files"]}
    assert "skill-b/SKILL.md" in paths_b
    assert "skill-a/SKILL.md" not in paths_b
    assert any(p.startswith("sillyspec-verify/") for p in paths_b)


# ---------------------------------------------------------------------------
# 2026-09-11-skills-central-library task-03：第三源（user_skill_enables 命中的
# git 缓存技能）+ D-010 同名优先级去重 + 三零回归。
#
# 零回归断言口径（taskcard constraints）：version hash + files 集合比对，不逐
# 字节比 tar（gzip mtime，Grill 修正）；既有用例断言禁改，本段只追加。
# log warn 断言不可行：structlog 直写 stderr，caplog 抓不到（本文件
# test_terminating_at_lifecycle 注释同款结论）——跳过行为以「输家条目缺席」断言。
# ---------------------------------------------------------------------------


def _patch_spec_data_root(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    """把 spec_data_root 指到 tmp（git 缓存根 skills_git_cache 落测试沙箱）。

    对缓存实例 setattr（test_source_crud.py:346 / daemon host_fs 先例）；
    skill_source.service 的 get_settings 与本测试共用该缓存实例。
    """
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "spec_data_root", str(tmp_path))


async def _add_skill_source(
    db_session: AsyncSession,
    *,
    enabled: bool = True,
    subdir: str | None = None,
    source_id: uuid.UUID | None = None,
) -> SkillSource:
    """直插 SkillSource 行（绕过 create 端点——无须 git mock/网络）。"""
    source = SkillSource(
        id=source_id if source_id is not None else uuid.uuid4(),
        url=f"https://8.8.8.8/{uuid.uuid4().hex}.git",
        branch="main",
        subdir=subdir,
        enabled=enabled,
    )
    db_session.add(source)
    await db_session.commit()
    await db_session.refresh(source)
    return source


def _make_cached_skill(
    source_id: uuid.UUID,
    dir_name: str,
    files: dict[str, bytes],
    *,
    subdir: str | None = None,
) -> Path:
    """在缓存根造一个技能目录：``skills_git_cache/<src>/[subdir/]<dir>/<files>``。"""
    root = source_cache_dir(source_id)
    skill_dir = root / subdir if subdir else root
    skill_dir = skill_dir / dir_name
    skill_dir.mkdir(parents=True, exist_ok=True)
    for rel, content in files.items():
        target = skill_dir / rel
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    return skill_dir


async def _add_enable(
    db_session: AsyncSession,
    user_id: uuid.UUID,
    skill_key: str,
    *,
    workspace_id: uuid.UUID | None = None,
) -> None:
    """直插启用绑定行（收集链路只读绑定表，无须走 enable 端点）。

    ``workspace_id=None`` = user 维度行；非 None = workspace 维度行（user_id
    此时仅操作者审计，bridges task-01 单表双 scope）。
    """
    db_session.add(UserSkillEnable(user_id=user_id, skill_key=skill_key, workspace_id=workspace_id))
    await db_session.commit()


async def _add_workspace(db_session: AsyncSession) -> Workspace:
    """直插 workspace 行（test_profile_service.py:50 同款最小字段）。"""
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"slug-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{uuid.uuid4().hex[:8]}",
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _get_manifest(client: AsyncClient, auth_headers: dict[str, str]) -> dict:
    resp = await client.get("/api/daemon/skills/latest/manifest", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


def _manifest_entries(manifest: dict) -> dict[str, dict]:
    return {f["path"]: f for f in manifest["files"]}


def _extract_tar_files(bundle: bytes) -> dict[str, bytes]:
    """解 tar.gz → {member_name: content}（只取文件成员）。"""
    extracted: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(bundle), mode="r:gz") as tar:
        for member in tar.getmembers():
            f = tar.extractfile(member)
            if f is not None:
                extracted[member.name] = f.read()
    return extracted


async def test_zero_regression_no_source_no_binding(
    client: AsyncClient,
    auth_headers: dict[str, str],
    skills_dir: Path,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """三零回归 1：无源/无绑定时 version hash 与 files 与现状（纯代码库）一致。"""
    from app.modules.agent.skills_bundle_service import build_skills_manifest

    _patch_spec_data_root(monkeypatch, tmp_path)
    endpoint_manifest = await _get_manifest(client, auth_headers)
    # 「现状」基准 = session=None 的纯代码库扫描（task-03 前行为，D-005）
    pure = await build_skills_manifest()

    assert endpoint_manifest["version"] == pure["version"]
    assert [f["path"] for f in endpoint_manifest["files"]] == [f["path"] for f in pure["files"]]
    assert [f["sha256"] for f in endpoint_manifest["files"]] == [f["sha256"] for f in pure["files"]]
    # 新增 source 标记：无源无绑定时全量为 sillyspec
    assert {f["source"] for f in endpoint_manifest["files"]} == {"sillyspec"}


async def test_not_enabled_git_skill_zero_collection(
    client: AsyncClient,
    auth_headers: dict[str, str],
    skills_dir: Path,
    db_session: AsyncSession,
    default_user_id: uuid.UUID,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """三零回归 2：源已配置、缓存已有技能，但用户未启用 → 零入 manifest/bundle。"""
    _patch_spec_data_root(monkeypatch, tmp_path)
    baseline = await _get_manifest(client, auth_headers)

    source = await _add_skill_source(db_session)
    _make_cached_skill(
        source.id,
        "alpha-git",
        {"SKILL.md": b"---\nname: alpha-git\ndescription: a\n---\n\nbody"},
    )

    after = await _get_manifest(client, auth_headers)
    assert after["version"] == baseline["version"], "未启用的 git 技能不得改变 version"
    paths = {f["path"] for f in after["files"]}
    assert not any(p.startswith("alpha-git/") for p in paths)


async def test_enabled_git_skill_collected_into_bundle(
    client: AsyncClient,
    auth_headers: dict[str, str],
    skills_dir: Path,
    db_session: AsyncSession,
    default_user_id: uuid.UUID,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """启用命中后：文件全集（排除 .git）入 tar、version 变化、source=git 标记。"""
    _patch_spec_data_root(monkeypatch, tmp_path)
    baseline = await _get_manifest(client, auth_headers)

    source = await _add_skill_source(db_session)
    skill_files = {
        "SKILL.md": b"---\nname: alpha-git\ndescription: Alpha git skill\n---\n\n# alpha",
        "helper.py": b"x = 1\n",
        "templates/tpl.txt": b"template\n",
    }
    skill_dir = _make_cached_skill(source.id, "alpha-git", skill_files)
    # .git 目录必须被收集排除（浅克隆缓存含 .git）
    git_dir = skill_dir / ".git"
    git_dir.mkdir()
    (git_dir / "HEAD").write_bytes(b"ref: refs/heads/main\n")
    await _add_enable(db_session, default_user_id, f"{source.id}:alpha-git")

    manifest = await _get_manifest(client, auth_headers)
    assert manifest["version"] != baseline["version"]

    entries = _manifest_entries(manifest)
    for rel in skill_files:
        path = f"alpha-git/{rel}"
        assert path in entries, f"{path} 应入 manifest"
        assert entries[path]["sha256"] == hashlib.sha256(skill_files[rel]).hexdigest()
        assert entries[path]["source"] == "git"
    assert not any(p.startswith("alpha-git/.git/") for p in entries)

    # skills 摘要含 git 技能（description 从 SKILL.md frontmatter 解析）
    summary = {s["name"]: s for s in manifest["skills"]}
    assert summary["alpha-git"]["description"] == "Alpha git skill"

    # tar 同步：文件齐全、.git 排除、成员路径唯一
    resp = await client.get("/api/daemon/skills/latest/bundle", headers=auth_headers)
    assert resp.status_code == 200
    member_names: list[str] = []
    with tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:gz") as tar:
        member_names = [m.name for m in tar.getmembers() if m.isfile()]
    extracted = set(member_names)
    assert {f"alpha-git/{rel}" for rel in skill_files} <= extracted
    assert not any(p.startswith("alpha-git/.git/") for p in extracted)
    # tar 成员路径唯一（同一文件不被多源重复打包；同目录多文件共享顶层名属正常）
    assert len(member_names) == len(extracted), "tar 成员路径必须唯一（D-010）"


async def test_subdir_source_skill_collected(
    client: AsyncClient,
    auth_headers: dict[str, str],
    skills_dir: Path,
    db_session: AsyncSession,
    default_user_id: uuid.UUID,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """subdir 源的技能：发现根=缓存根/<subdir>，启用后照常收集（D-006 同口径）。"""
    _patch_spec_data_root(monkeypatch, tmp_path)
    source = await _add_skill_source(db_session, subdir="agent-skills")
    _make_cached_skill(
        source.id,
        "beta-git",
        {"SKILL.md": b"---\nname: beta-git\ndescription: b\n---\n\nbody"},
        subdir="agent-skills",
    )
    await _add_enable(db_session, default_user_id, f"{source.id}:beta-git")

    manifest = await _get_manifest(client, auth_headers)
    entries = _manifest_entries(manifest)
    assert "beta-git/SKILL.md" in entries
    assert entries["beta-git/SKILL.md"]["source"] == "git"


async def test_dangling_binding_and_disabled_source_skipped(
    client: AsyncClient,
    auth_headers: dict[str, str],
    skills_dir: Path,
    db_session: AsyncSession,
    default_user_id: uuid.UUID,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """悬空绑定（目录不存在）与停用源的绑定：收集跳过，version 不变，绑定行保留。"""
    _patch_spec_data_root(monkeypatch, tmp_path)
    baseline = await _get_manifest(client, auth_headers)

    # 悬空：源启用但技能目录不存在（刷新后技能目录消失的等价态）
    dangling_source = await _add_skill_source(db_session)
    await _add_enable(db_session, default_user_id, f"{dangling_source.id}:vanished-skill")
    # 停用源：目录在、绑定在，但 source.enabled=False（收集只认启用源）
    disabled_source = await _add_skill_source(db_session, enabled=False)
    _make_cached_skill(
        disabled_source.id,
        "off-skill",
        {"SKILL.md": b"---\nname: off-skill\n---\n\nbody"},
    )
    await _add_enable(db_session, default_user_id, f"{disabled_source.id}:off-skill")

    after = await _get_manifest(client, auth_headers)
    assert after["version"] == baseline["version"]
    paths = {f["path"] for f in after["files"]}
    assert not any(p.startswith(("vanished-skill/", "off-skill/")) for p in paths)

    # 绑定行保留（悬空不清理——技能回来自动恢复，design 兼容策略）
    keys = {
        row.skill_key for row in (await db_session.execute(select(UserSkillEnable))).scalars().all()
    }
    assert f"{dangling_source.id}:vanished-skill" in keys
    assert f"{disabled_source.id}:off-skill" in keys


async def test_name_priority_matrix(
    client: AsyncClient,
    auth_headers: dict[str, str],
    skills_dir: Path,
    db_session: AsyncSession,
    default_user_id: uuid.UUID,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-010 同名优先级矩阵：sillyspec-* > CustomSkill > git 源（source_id 升序）。

    后到者整目录跳过（先到先得）；warn 日志不可 caplog 断言（structlog 直写
    stderr，见本文件上方注释），以输家条目缺席断言。
    """
    _patch_spec_data_root(monkeypatch, tmp_path)

    # 固定 source_id 保证 git 源间次序确定（str 升序：…0001 < …0002）
    src_low = await _add_skill_source(
        db_session, source_id=uuid.UUID("00000000-0000-0000-0000-000000000001")
    )
    src_high = await _add_skill_source(
        db_session, source_id=uuid.UUID("00000000-0000-0000-0000-000000000002")
    )

    # (a) sillyspec-* vs CustomSkill vs git 三方撞名（名字须带 sillyspec- 前缀）
    clash = skills_dir / "sillyspec-clash"
    clash.mkdir()
    fs_content = b"fs wins\n"
    (clash / "who.txt").write_bytes(fs_content)
    _add_custom_skill(db_session, "sillyspec-clash", "# custom body", default_user_id)
    _make_cached_skill(src_low.id, "sillyspec-clash", {"SKILL.md": b"---\n---\n\ngit body"})
    await _add_enable(db_session, default_user_id, f"{src_low.id}:sillyspec-clash")

    # (b) CustomSkill vs git 撞名（无 sillyspec- 前缀，业务层合法名空间）
    _add_custom_skill(db_session, "clash-cg", "# custom wins", default_user_id)
    _make_cached_skill(
        src_low.id, "clash-cg", {"SKILL.md": b"---\n---\n\ngit loses", "extra.txt": b"extra"}
    )
    await _add_enable(db_session, default_user_id, f"{src_low.id}:clash-cg")

    # (c) git × git 两源撞名：source_id 升序，低者胜
    _make_cached_skill(src_low.id, "clash-gg", {"SKILL.md": b"gg from low"})
    _make_cached_skill(src_high.id, "clash-gg", {"SKILL.md": b"gg from high"})
    await _add_enable(db_session, default_user_id, f"{src_low.id}:clash-gg")
    await _add_enable(db_session, default_user_id, f"{src_high.id}:clash-gg")
    await db_session.commit()

    manifest = await _get_manifest(client, auth_headers)
    entries = _manifest_entries(manifest)
    paths = set(entries)

    # (a) sillyspec-* 胜：fs 文件在，custom/git 的 SKILL.md 均缺席
    assert entries["sillyspec-clash/who.txt"]["sha256"] == hashlib.sha256(fs_content).hexdigest()
    assert entries["sillyspec-clash/who.txt"]["source"] == "sillyspec"
    assert "sillyspec-clash/SKILL.md" not in paths

    # (b) CustomSkill 胜：拼装 frontmatter 的 SKILL.md 在，git 文件缺席
    expected_custom = (
        "---\nname: clash-cg\ndescription: custom skill clash-cg\n---\n\n# custom wins"
    )
    assert (
        entries["clash-cg/SKILL.md"]["sha256"]
        == hashlib.sha256(expected_custom.encode()).hexdigest()
    )
    assert entries["clash-cg/SKILL.md"]["source"] == "custom"
    assert "clash-cg/extra.txt" not in paths

    # (c) git 低 source_id 胜：内容可区分（高者的 sha256 不出现）
    assert entries["clash-gg/SKILL.md"]["sha256"] == hashlib.sha256(b"gg from low").hexdigest()
    assert entries["clash-gg/SKILL.md"]["source"] == "git"
    assert entries["clash-gg/SKILL.md"]["sha256"] != hashlib.sha256(b"gg from high").hexdigest()

    # tar 成员路径唯一 + 撞名目录单源（输家整目录缺席，赢家内容唯一）
    resp = await client.get("/api/daemon/skills/latest/bundle", headers=auth_headers)
    assert resp.status_code == 200
    with tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:gz") as tar:
        member_paths = [m.name for m in tar.getmembers() if m.isfile()]
    assert len(member_paths) == len(set(member_paths)), "tar 成员路径必须唯一（D-010）"
    # 撞名目录的文件全部来自单一赢家（同目录多文件共享顶层名属正常）
    clash_files = [
        p for p in member_paths if p.split("/")[0] in ("sillyspec-clash", "clash-cg", "clash-gg")
    ]
    assert clash_files, "撞名目录应有赢家文件存在"
    clash_content = _extract_tar_files(resp.content)
    assert clash_content["clash-gg/SKILL.md"] == b"gg from low"
    assert clash_content["sillyspec-clash/who.txt"] == fs_content


# ---------------------------------------------------------------------------
# 2026-09-11-workspace-asset-bridges task-01：user_skill_enables 单表双 scope。
# D-010 None 谓词零回归（ws 行不进 user-only manifest——version hash 显式断言）
# + D-002 并集直测（user ∪ workspace 双边启用都入 manifest）。
# 注：daemon 端点接 workspace_id 参数归 task-04——本段用 service 层直测并集，
# 端点零改（不带参 = user-only，行为逐字不变）。
# ---------------------------------------------------------------------------


async def test_ws_rows_do_not_leak_into_user_only_manifest(
    client: AsyncClient,
    auth_headers: dict[str, str],
    skills_dir: Path,
    db_session: AsyncSession,
    default_user_id: uuid.UUID,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-010 None 谓词零回归：ws 维度行存在时，不带参 manifest 逐字不变。

    基线 = 仅有 user 维度绑定的 version hash；随后直插 ws 维度绑定（另一
    workspace、另一技能）→ 端点 manifest（不带 workspace 上下文）version
    hash 必须不变、ws 技能文件缺席——显式 ``workspace_id IS NULL`` 谓词的
    直接效果（user bundle version hash 零变化）。
    """
    _patch_spec_data_root(monkeypatch, tmp_path)

    user_source = await _add_skill_source(db_session)
    _make_cached_skill(
        user_source.id,
        "user-scope-git",
        {"SKILL.md": b"---\nname: user-scope-git\ndescription: u\n---\n\nbody"},
    )
    await _add_enable(db_session, default_user_id, f"{user_source.id}:user-scope-git")

    baseline = await _get_manifest(client, auth_headers)
    assert "user-scope-git/SKILL.md" in _manifest_entries(baseline)

    # 直插 ws 维度行（操作者同为 default_user，但 scope 是 workspace）
    ws = await _add_workspace(db_session)
    ws_source = await _add_skill_source(db_session)
    _make_cached_skill(
        ws_source.id,
        "ws-scope-git",
        {"SKILL.md": b"---\nname: ws-scope-git\ndescription: w\n---\n\nbody"},
    )
    await _add_enable(
        db_session, default_user_id, f"{ws_source.id}:ws-scope-git", workspace_id=ws.id
    )

    after = await _get_manifest(client, auth_headers)
    assert after["version"] == baseline["version"], "ws 维度行不得改变 user-only version hash"
    assert [f["path"] for f in after["files"]] == [f["path"] for f in baseline["files"]]
    assert [f["sha256"] for f in after["files"]] == [f["sha256"] for f in baseline["files"]]
    assert not any(p.startswith("ws-scope-git/") for p in _manifest_entries(after))


async def test_union_manifest_includes_user_and_workspace_scopes(
    client: AsyncClient,
    auth_headers: dict[str, str],
    skills_dir: Path,
    db_session: AsyncSession,
    default_user_id: uuid.UUID,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """D-002 并集直测：``workspace_id`` 传参时 user 与 ws 双边启用都入 manifest。

    service 层直调 ``build_skills_manifest(session, user_id, workspace_id=ws)``
    （端点接参归 task-04）：user 维度技能（user-scope-git）与 ws 维度技能
    （ws-scope-git）同时出现；version 严格大于（≠）user-only 基线。并集 OR
    分支不限 user_id——他操作者建的 ws 行也进（shared 绑定语义）。
    """
    from app.modules.agent.skills_bundle_service import build_skills_manifest

    _patch_spec_data_root(monkeypatch, tmp_path)
    ws = await _add_workspace(db_session)

    user_source = await _add_skill_source(db_session)
    _make_cached_skill(
        user_source.id,
        "user-scope-git",
        {"SKILL.md": b"---\nname: user-scope-git\ndescription: u\n---\n\nbody"},
    )
    await _add_enable(db_session, default_user_id, f"{user_source.id}:user-scope-git")

    # ws 维度行：操作者是另一个用户（并集 OR 分支不限 user_id 的对照）
    other_operator = uuid.uuid4()
    ws_source = await _add_skill_source(db_session)
    _make_cached_skill(
        ws_source.id,
        "ws-scope-git",
        {"SKILL.md": b"---\nname: ws-scope-git\ndescription: w\n---\n\nbody"},
    )
    await _add_enable(
        db_session, other_operator, f"{ws_source.id}:ws-scope-git", workspace_id=ws.id
    )

    user_only = await build_skills_manifest(session=db_session, user_id=default_user_id)
    union = await build_skills_manifest(
        session=db_session, user_id=default_user_id, workspace_id=ws.id
    )

    user_only_paths = {f["path"] for f in user_only["files"]}
    union_paths = {f["path"] for f in union["files"]}
    assert "user-scope-git/SKILL.md" in user_only_paths
    assert "ws-scope-git/SKILL.md" not in user_only_paths, "user-only 基线不含 ws 行"

    assert "user-scope-git/SKILL.md" in union_paths, "并集须含 user 维度启用"
    assert "ws-scope-git/SKILL.md" in union_paths, "并集须含 ws 维度启用（他操作者行也进）"
    assert union["version"] != user_only["version"]
    for entry in union["files"]:
        if entry["path"].startswith(("user-scope-git/", "ws-scope-git/")):
            assert entry["source"] == "git"


# ---------------------------------------------------------------------------
# 2026-09-11-workspace-asset-bridges task-04（D-007）：daemon 端点 ?workspace_id
# 两态。缺省 = user-only（上方全部既有用例即回归面，行为逐字不变）；带参 =
# 授权（workspace 不存在 404 / 非成员 403）后 user ∪ workspace 并集渲染。
# ---------------------------------------------------------------------------


async def _make_member(db_session: AsyncSession, ws: Workspace, user_id: uuid.UUID) -> None:
    """给 user 授 ws 成员角色（Role + UserWorkspaceRole；任意角色行即成员——
    skill_source tests ``_make_member`` 同款）。"""
    from app.modules.auth.model import Role, UserWorkspaceRole

    role = Role(id=uuid.uuid4(), key=f"developer-{uuid.uuid4().hex[:6]}", name="Developer")
    db_session.add(role)
    await db_session.flush()
    db_session.add(UserWorkspaceRole(user_id=user_id, workspace_id=ws.id, role_id=role.id))
    await db_session.commit()


async def test_manifest_workspace_id_two_states_and_auth(
    client: AsyncClient,
    auth_headers: dict[str, str],
    skills_dir: Path,
    db_session: AsyncSession,
    default_user_id: uuid.UUID,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """端点两态一体的主用例：授权门（404/403）→ 并集 → 缺省 user-only 不变。

    * workspace 不存在 → 404（存在性校验，对齐 _read_mcp_config_raw 拒绝形态）
    * 非成员带参 → 403（RBAC 存在性，防越权拉他人并集）
    * 成员带参 → user ∪ workspace 并集（他操作者建的 ws 行也进），version ≠
      user-only 基线
    * 不带参 → ws 技能缺席（缺省兼容语义，与 task-01 零回归断言同口径）
    """
    _patch_spec_data_root(monkeypatch, tmp_path)
    ws = await _add_workspace(db_session)

    user_source = await _add_skill_source(db_session)
    _make_cached_skill(
        user_source.id,
        "user-scope-git",
        {"SKILL.md": b"---\nname: user-scope-git\ndescription: u\n---\n\nbody"},
    )
    await _add_enable(db_session, default_user_id, f"{user_source.id}:user-scope-git")

    # ws 维度行：操作者是另一个用户（并集 OR 分支不限 user_id 的对照）
    other_operator = uuid.uuid4()
    ws_source = await _add_skill_source(db_session)
    _make_cached_skill(
        ws_source.id,
        "ws-scope-git",
        {"SKILL.md": b"---\nname: ws-scope-git\ndescription: w\n---\n\nbody"},
    )
    await _add_enable(
        db_session, other_operator, f"{ws_source.id}:ws-scope-git", workspace_id=ws.id
    )

    # 授权门 1：workspace 不存在 → 404
    resp = await client.get(
        f"/api/daemon/skills/latest/manifest?workspace_id={uuid.uuid4()}",
        headers=auth_headers,
    )
    assert resp.status_code == 404, resp.text

    # 授权门 2：存在但非成员 → 403
    resp = await client.get(
        f"/api/daemon/skills/latest/manifest?workspace_id={ws.id}", headers=auth_headers
    )
    assert resp.status_code == 403, resp.text

    # 成员后带参 → 并集
    await _make_member(db_session, ws, default_user_id)
    resp = await client.get(
        f"/api/daemon/skills/latest/manifest?workspace_id={ws.id}", headers=auth_headers
    )
    assert resp.status_code == 200, resp.text
    union = resp.json()
    union_paths = {f["path"] for f in union["files"]}
    assert "user-scope-git/SKILL.md" in union_paths, "并集须含 user 维度启用"
    assert "ws-scope-git/SKILL.md" in union_paths, "并集须含 ws 维度启用"

    # 缺省：同一数据面不带参 → user-only（ws 技能缺席）
    plain = await _get_manifest(client, auth_headers)
    plain_paths = {f["path"] for f in plain["files"]}
    assert "user-scope-git/SKILL.md" in plain_paths
    assert "ws-scope-git/SKILL.md" not in plain_paths
    assert union["version"] != plain["version"], "并集 version 必须区别于 user-only"


async def test_bundle_workspace_id_union_and_auth(
    client: AsyncClient,
    auth_headers: dict[str, str],
    skills_dir: Path,
    db_session: AsyncSession,
    default_user_id: uuid.UUID,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """bundle 端点同款两态：非成员 403；成员带参 tar 含 ws git 技能、缺省不含。"""
    _patch_spec_data_root(monkeypatch, tmp_path)
    ws = await _add_workspace(db_session)

    other_operator = uuid.uuid4()
    ws_source = await _add_skill_source(db_session)
    _make_cached_skill(
        ws_source.id,
        "ws-scope-git",
        {"SKILL.md": b"---\nname: ws-scope-git\ndescription: w\n---\n\nbody"},
    )
    await _add_enable(
        db_session, other_operator, f"{ws_source.id}:ws-scope-git", workspace_id=ws.id
    )

    # 非成员 → 403
    resp = await client.get(
        f"/api/daemon/skills/latest/bundle?workspace_id={ws.id}", headers=auth_headers
    )
    assert resp.status_code == 403, resp.text

    await _make_member(db_session, ws, default_user_id)
    # 成员带参 → tar 含 ws 技能
    resp = await client.get(
        f"/api/daemon/skills/latest/bundle?workspace_id={ws.id}", headers=auth_headers
    )
    assert resp.status_code == 200, resp.text
    union_files = _extract_tar_files(resp.content)
    assert any(p.startswith("ws-scope-git/") for p in union_files)

    # 缺省 → 不含（user-only）
    resp = await client.get("/api/daemon/skills/latest/bundle", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    plain_files = _extract_tar_files(resp.content)
    assert not any(p.startswith("ws-scope-git/") for p in plain_files)
