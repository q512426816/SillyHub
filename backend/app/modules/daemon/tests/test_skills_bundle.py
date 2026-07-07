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
