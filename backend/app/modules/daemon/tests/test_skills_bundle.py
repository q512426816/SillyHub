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
from pathlib import Path

import pytest
from httpx import AsyncClient
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


def _add_custom_skill(db_session: AsyncSession, name: str, content: str) -> None:
    """Insert a CustomSkill row synchronously-ish (commit handled by fixture)."""
    from app.modules.skills.model import CustomSkill

    db_session.add(
        CustomSkill(
            name=name,
            description=f"custom skill {name}",
            content=content,
        )
    )


async def test_manifest_includes_custom_skills(
    client: AsyncClient,
    auth_headers: dict[str, str],
    skills_dir: Path,
    db_session: AsyncSession,
) -> None:
    """验收 A：manifest 含代码库 sillyspec-* + DB CustomSkill 的 <name>/SKILL.md。"""
    _add_custom_skill(db_session, "my-custom", "# my custom skill\nbody line")
    _add_custom_skill(db_session, "another-one", "# another\ncontent here")
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

    # sha256 与 DB content 一致
    custom_entry = next(f for f in files if f["path"] == "my-custom/SKILL.md")
    assert custom_entry["sha256"] == hashlib.sha256(b"# my custom skill\nbody line").hexdigest()


async def test_bundle_includes_custom_skills(
    client: AsyncClient,
    auth_headers: dict[str, str],
    skills_dir: Path,
    db_session: AsyncSession,
) -> None:
    """验收 A：bundle 含 DB CustomSkill 的 <name>/SKILL.md，内容匹配。"""
    _add_custom_skill(db_session, "bundled-skill", "## hello\nworld")
    await db_session.commit()

    resp = await client.get("/api/daemon/skills/latest/bundle", headers=auth_headers)
    assert resp.status_code == 200

    extracted: dict[str, bytes] = {}
    with tarfile.open(fileobj=io.BytesIO(resp.content), mode="r:gz") as tar:
        for member in tar.getmembers():
            f = tar.extractfile(member)
            if f is not None:
                extracted[member.name] = f.read()

    assert "bundled-skill/SKILL.md" in extracted
    assert extracted["bundled-skill/SKILL.md"] == b"## hello\nworld"
    # 代码库文件仍在
    assert any(p.startswith("sillyspec-verify/") for p in extracted)


async def test_version_changes_on_custom_skill_mutation(
    client: AsyncClient,
    auth_headers: dict[str, str],
    skills_dir: Path,
    db_session: AsyncSession,
) -> None:
    """验收 B：增/删/改 CustomSkill → version hash 变化。"""
    # 基线：纯代码库（DB 空）
    base = (await client.get("/api/daemon/skills/latest/manifest", headers=auth_headers)).json()
    base_version = base["version"]
    assert base_version != ""

    # 增 → version 变
    _add_custom_skill(db_session, "new-skill", "# v1")
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
) -> None:
    """D-002 边界：custom name 不带 sillyspec- 前缀，与代码库命名空间独立。

    即使 custom name 恰好与 sillyspec-verify 同名（custom 名 'sillyspec-verify'
    在业务层被禁止，但 bundle 层应显式按 D-001 处理：custom → <name>/SKILL.md，
    代码库 → sillyspec-verify/<file>，二者路径形态不同不冲突）。这里只验证
    bundle 层路径形态分离（业务层 name 校验在 task-02 service）。
    """
    _add_custom_skill(db_session, "plain-name", "# plain")
    await db_session.commit()

    resp = await client.get("/api/daemon/skills/latest/manifest", headers=auth_headers)
    paths = {f["path"] for f in resp.json()["files"]}
    assert "plain-name/SKILL.md" in paths
    # 代码库 sillyspec-verify/index.ts 仍在（custom 不抢占其命名空间）
    assert any(p.startswith("sillyspec-verify/index") for p in paths)
