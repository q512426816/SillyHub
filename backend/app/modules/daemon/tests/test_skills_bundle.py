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
    """按顶层目录聚合：name=目录名、description 来自 SKILL.md、file_count 计数。"""
    from app.modules.agent.skills_bundle_service import _summarize_skills

    files = [
        (Path("sillyspec-a/SKILL.md"), b"---\nname: a\ndescription: A skill\n---\n\nbody"),
        (Path("sillyspec-a/helper.ts"), b"helper"),
        (Path("sillyspec-b/SKILL.md"), b"---\ndescription: B\n---\n"),
    ]
    assert _summarize_skills(files) == [
        {"name": "sillyspec-a", "description": "A skill", "file_count": 2},
        {"name": "sillyspec-b", "description": "B", "file_count": 1},
    ]


async def test_manifest_includes_skill_descriptions(
    client: AsyncClient,
    auth_headers: dict[str, str],
    skills_dir_with_descriptions: Path,
) -> None:
    """manifest.skills 含每个 skill 的 description（有 frontmatter 提取，无则空兜底）。"""
    resp = await client.get("/api/daemon/skills/latest/manifest", headers=auth_headers)
    assert resp.status_code == 200

    payload = resp.json()
    assert "skills" in payload
    skills = {s["name"]: s for s in payload["skills"]}

    # 有 frontmatter 的技能：description 被提取；file_count = SKILL.md + helper.md
    archive = skills["sillyspec-archive"]
    assert archive["description"] == "用于归档已验证完成的变更"
    assert archive["file_count"] == 2

    # 无 frontmatter 的技能：description 空串兜底，不报错
    plain = skills["sillyspec-plain"]
    assert plain["description"] == ""
    assert plain["file_count"] == 1


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
