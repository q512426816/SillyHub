"""2026-08-05-skill-content-viewer task-03：平台 skill 内容只读端点测试。

验证 ``GET /api/daemon/skills/{skill_name}/content``：
- 白名单内 sillyspec-* + SKILL.md → 200 + content
- 非 sillyspec- 前缀 / 不存在 → 404（非白名单）
- 白名单内但 SKILL.md 缺失 → 404（message 区分「has no SKILL.md」）
- SKILL.md > 1 MiB → 413（不截断）
- 路径穿越免疫（skill_name 含 ../ 等 → 非白名单 404，read_skill_md 不拼 path）

用 conftest ``client`` + ``auth_headers`` + ``monkeypatch`` 临时 ``skills_bundle_dir``。
"""

from __future__ import annotations

from pathlib import Path


def _seed_skill(tmp_path: Path, skill_name: str, content: str | None) -> Path:
    """在 tmp_path 下建临时 skills_bundle_dir/<skill_name>/[SKILL.md]，返回 skills_dir。"""
    skills_dir = tmp_path / "sillyspec-skills"
    skill_dir = skills_dir / skill_name
    skill_dir.mkdir(parents=True, exist_ok=True)
    if content is not None:
        (skill_dir / "SKILL.md").write_text(content, encoding="utf-8")
    return skills_dir


def _patch_skills_dir(monkeypatch, skills_dir: Path) -> None:
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "skills_bundle_dir", skills_dir)


async def test_get_skill_content_success(client, auth_headers, tmp_path, monkeypatch) -> None:
    skills_dir = _seed_skill(tmp_path, "sillyspec-test", "# test skill\nhello world")
    _patch_skills_dir(monkeypatch, skills_dir)

    resp = await client.get("/api/daemon/skills/sillyspec-test/content", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["skill_name"] == "sillyspec-test"
    assert data["content"] == "# test skill\nhello world"


async def test_get_skill_content_non_whitelist_404(
    client, auth_headers, tmp_path, monkeypatch
) -> None:
    # 目录里只有 sillyspec-test，请求 notspec-foo（非 sillyspec- 前缀）→ 非白名单 404
    skills_dir = _seed_skill(tmp_path, "sillyspec-test", "# test")
    _patch_skills_dir(monkeypatch, skills_dir)

    resp = await client.get("/api/daemon/skills/notspec-foo/content", headers=auth_headers)
    assert resp.status_code == 404
    assert "not in sillyspec-* whitelist" in resp.json()["message"]


async def test_get_skill_content_missing_skill_md_404(
    client, auth_headers, tmp_path, monkeypatch
) -> None:
    # 白名单内目录但无 SKILL.md → 404（message 区分「has no SKILL.md」）
    skills_dir = _seed_skill(tmp_path, "sillyspec-empty", content=None)
    _patch_skills_dir(monkeypatch, skills_dir)

    resp = await client.get("/api/daemon/skills/sillyspec-empty/content", headers=auth_headers)
    assert resp.status_code == 404
    assert "has no SKILL.md" in resp.json()["message"]


async def test_get_skill_content_too_large_413(client, auth_headers, tmp_path, monkeypatch) -> None:
    big = "x" * (1024 * 1024 + 10)  # > 1 MiB
    skills_dir = _seed_skill(tmp_path, "sillyspec-big", big)
    _patch_skills_dir(monkeypatch, skills_dir)

    resp = await client.get("/api/daemon/skills/sillyspec-big/content", headers=auth_headers)
    assert resp.status_code == 413
    assert "exceeds 1 MiB" in resp.json()["message"]


async def test_get_skill_content_traversal_immune(
    client, auth_headers, tmp_path, monkeypatch
) -> None:
    # skill_name 含穿越片段 → glob sillyspec-* 不匹配 → 非白名单 404（read_skill_md
    # 不拼 path，{skill_name} 路由层不含 /，双层防御）。
    skills_dir = _seed_skill(tmp_path, "sillyspec-test", "# test")
    _patch_skills_dir(monkeypatch, skills_dir)

    # 单段恶意名（路由层 {skill_name} 不含 /）：均非 sillyspec-* 白名单 → 404
    for malicious in ["..", "secret", "%2e%2e"]:
        resp = await client.get(f"/api/daemon/skills/{malicious}/content", headers=auth_headers)
        assert resp.status_code == 404, f"traversal-like {malicious!r} should be 404"
