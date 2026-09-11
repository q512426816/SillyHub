"""git_fetcher 拉取 + 技能发现 + service 接线测试（task-02）——本地 git init 假仓全链路，零外网。

Change: 2026-09-11-skills-central-library

Covers（taskcard acceptance）:
- clone：浅形态三参生效（``.git/shallow`` 标记 + config 的
  ``partialclonefilter = blob:none`` / ``tagopt = --no-tags`` 均为可验证副作用）、
  FetchResult.ok + commit 等于假仓 HEAD。
- 更新：远端二次 commit 后 ``fetch --prune`` + ``reset --hard`` 到新 commit；
  未跟踪哨兵文件保留证明走增量更新而非重建目录。
- 失败路径：坏分支/不存在的远端 → ok=False + error 非空 + 半成品目录清理
  （同目录可重试）；fetcher 永不抛。
- 双上限（D-007 二防线）：>200 文件 / >10MB 目录跳过 + log warn，其它技能
  与主流程不受影响；恰好边界（200 文件）保留。
- subdir：发现限定在缓存根下 subdir。
- frontmatter 解析（复用 skills_bundle_service._parse_skill_frontmatter）+
  坏 SKILL.md 容错 + ``.git`` 目录排除。
- service 接线：refresh 真拉取回写 last_commit/last_fetched_at；create 拉取
  失败不阻塞（HTTP 仍 201 + last_error 回写）。

离线性：真 git 用例统一 ``requires_git`` skipif 分流（无 git 环境只跑纯 fs
发现/探测 mock 用例）；假仓走 ``file://``（``Path.as_uri()``）——SSRF 在
create 已拦（D-007 首防线），fetcher 不重复拦，本地 URL 可直达 fetch_source。
"""

from __future__ import annotations

import shutil
import subprocess
import uuid
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import User
from app.modules.skill_source.git_fetcher import (
    FetchResult,
    discover_skills,
    fetch_source,
    probe_git_binary,
)
from app.modules.skill_source.model import SkillSource
from app.modules.skill_source.service import SkillSourceService, source_cache_dir

GIT_AVAILABLE = shutil.which("git") is not None
requires_git = pytest.mark.skipif(not GIT_AVAILABLE, reason="宿主环境无 git 二进制（R-01）")

SOURCES_PATH = "/api/skill-sources"
# 公网 IP 字面量（离线 getaddrinfo 无 DNS）——test_source_crud.py 先例。
PUBLIC_URL = "https://8.8.8.8/skills.git"


# ─── 铺底：本地 git init 假仓（不访问外网）──────────────────────────────


def _git(args: list[str], cwd: Path) -> None:
    """同步跑 git（仅测试铺底；生产链路在 git_fetcher 是 asyncio 子进程）。"""
    subprocess.run(["git", *args], cwd=cwd, capture_output=True, check=True)


def _fake_repo(root: Path) -> Path:
    """本地假仓：main 分支，skills/ 下两个技能目录（SKILL.md + 辅助文件）+ docs/ 杂项。"""
    repo = root / "fake-repo"
    (repo / "skills" / "alpha-skill").mkdir(parents=True)
    (repo / "skills" / "beta-skill").mkdir(parents=True)
    (repo / "docs").mkdir()
    _git(["init", "-b", "main"], repo)
    _git(["config", "user.email", "t@example.com"], repo)
    _git(["config", "user.name", "tester"], repo)
    (repo / "skills" / "alpha-skill" / "SKILL.md").write_text(
        "---\nname: alpha\ndescription: Alpha 技能，用于演示\n---\n\n# alpha\n", encoding="utf-8"
    )
    (repo / "skills" / "alpha-skill" / "run.py").write_text("x = 1\n", encoding="utf-8")
    (repo / "skills" / "beta-skill" / "SKILL.md").write_text(
        "---\nname: beta\ndescription: Beta 技能\n---\n\n# beta\n", encoding="utf-8"
    )
    (repo / "docs" / "readme.md").write_text("杂项非技能\n", encoding="utf-8")
    _git(["add", "-A"], repo)
    _git(["commit", "-m", "init"], repo)
    return repo


def _head(repo: Path) -> str:
    out = subprocess.run(["git", "rev-parse", "HEAD"], cwd=repo, capture_output=True, check=True)
    return out.stdout.decode("utf-8").strip()


def _source(url: str, *, branch: str = "main", subdir: str | None = None) -> SkillSource:
    """内存态源对象（不落库——fetch_source 纯函数消费 url/branch/subdir）。"""
    return SkillSource(id=uuid.uuid4(), url=url, branch=branch, subdir=subdir)


# ─── probe_git_binary（R-01 探测）───────────────────────────────────────


async def test_probe_missing(monkeypatch: pytest.MonkeyPatch):
    """which 找不到 git → False（不触子进程）。"""
    monkeypatch.setattr(shutil, "which", lambda _name: None)
    assert await probe_git_binary() is False


async def test_probe_version_confirm_fails(monkeypatch: pytest.MonkeyPatch):
    """which 命中但 git --version 子进程起不来（无 git 环境）→ False。"""
    import asyncio

    monkeypatch.setattr(shutil, "which", lambda _name: "/fake/git")

    async def _boom(*_args, **_kwargs):
        raise FileNotFoundError("no git")

    monkeypatch.setattr(asyncio, "create_subprocess_exec", _boom)
    assert await probe_git_binary() is False


@requires_git
async def test_probe_real():
    """宿主有 git：which + git --version 双确认 → True。"""
    assert await probe_git_binary() is True


# ─── fetch_source：首次 clone（浅形态三参）─────────────────────────────


@requires_git
async def test_fetch_clone_shallow(tmp_path: Path):
    """首次 clone 成功：ok + commit=远端 HEAD，且浅形态三参副作用可验证（D-006）。"""
    repo = _fake_repo(tmp_path)
    cache = tmp_path / "cache" / "src-1"

    result = await fetch_source(_source(repo.as_uri()), cache)

    assert result.ok is True, result.error
    assert result.commit == _head(repo)
    assert (cache / "skills" / "alpha-skill" / "SKILL.md").is_file()
    # 浅形态三参证据（D-006：--depth 1 / --filter=blob:none / --no-tags）
    assert (cache / ".git" / "shallow").is_file(), "--depth 1 应留下 shallow 标记"
    config = (cache / ".git" / "config").read_text(encoding="utf-8").lower()
    assert "partialclonefilter = blob:none" in config, "--filter=blob:none 应写入 promisor 配置"
    assert "tagopt = --no-tags" in config, "--no-tags 应写入 tagOpt（git 大小写不定，比较前 lower）"


@requires_git
async def test_fetch_update_incremental(tmp_path: Path):
    """二次调用走 fetch --prune + reset --hard 增量更新到新 commit，不重建目录。"""
    repo = _fake_repo(tmp_path)
    cache = tmp_path / "cache" / "src-1"
    src = _source(repo.as_uri())

    first = await fetch_source(src, cache)
    assert first.ok is True, first.error
    assert first.commit == _head(repo)

    # 未跟踪哨兵：reset --hard 不删未跟踪文件；重建目录会删——区分两条路径。
    sentinel = cache / "untracked-marker.txt"
    sentinel.write_text("keep me", encoding="utf-8")

    # 远端二次提交：新增 gamma 技能 + 改 beta 内容
    (repo / "skills" / "gamma-skill").mkdir()
    (repo / "skills" / "gamma-skill" / "SKILL.md").write_text(
        "---\nname: gamma\ndescription: Gamma 新技能\n---\n", encoding="utf-8"
    )
    (repo / "skills" / "beta-skill" / "SKILL.md").write_text(
        "---\nname: beta\ndescription: Beta 第二版\n---\n", encoding="utf-8"
    )
    _git(["add", "-A"], repo)
    _git(["commit", "-m", "second"], repo)

    second = await fetch_source(src, cache)

    assert second.ok is True, second.error
    assert second.commit == _head(repo)
    assert second.commit != first.commit
    assert sentinel.is_file(), "未跟踪文件应保留（fetch+reset 增量更新而非重建目录）"
    assert (cache / "skills" / "gamma-skill" / "SKILL.md").is_file(), (
        "reset --hard 后新 commit 内容落地"
    )
    assert "Beta 第二版" in (cache / "skills" / "beta-skill" / "SKILL.md").read_text(
        encoding="utf-8"
    )


@requires_git
async def test_fetch_bad_branch_fails(tmp_path: Path):
    """坏分支：clone 失败 ok=False + error 非空，半成品目录清理。"""
    repo = _fake_repo(tmp_path)
    cache = tmp_path / "cache" / "src-1"

    result = await fetch_source(_source(repo.as_uri(), branch="no-such-branch"), cache)

    assert result.ok is False
    assert result.commit is None
    assert result.error
    assert not (cache / ".git").exists(), "失败半成品应清理，下次可重 clone"


@requires_git
async def test_fetch_missing_remote_then_retry(tmp_path: Path):
    """远端不存在：失败不抛 + error 非空；同目录换真仓重试成功（半成品已清）。"""
    cache = tmp_path / "cache" / "src-1"

    missing = await fetch_source(_source((tmp_path / "nope-repo").as_uri()), cache)
    assert missing.ok is False
    assert missing.error

    repo = _fake_repo(tmp_path)
    ok_again = await fetch_source(_source(repo.as_uri()), cache)
    assert ok_again.ok is True, ok_again.error
    assert ok_again.commit == _head(repo)


# ─── discover_skills：subdir / frontmatter / 容错 / 排除 ────────────────


@requires_git
async def test_discover_after_fetch_with_subdir(tmp_path: Path):
    """clone 后发现限定在缓存根下 subdir：只命中 skills/ 两个技能，docs 不进发现根。"""
    repo = _fake_repo(tmp_path)
    cache = tmp_path / "cache" / "src-1"
    result = await fetch_source(_source(repo.as_uri(), subdir="skills"), cache)
    assert result.ok is True, result.error

    found = discover_skills(cache / "skills")

    assert [s.name for s in found] == ["alpha-skill", "beta-skill"]
    alpha = found[0]
    assert alpha.description == "Alpha 技能，用于演示"  # frontmatter 解析复用
    assert alpha.rel_dir == "alpha-skill"
    assert alpha.file_count == 2  # SKILL.md + run.py
    assert alpha.total_bytes > 0


def _write_skill(root: Path, name: str, body: str) -> Path:
    d = root / name
    d.mkdir(parents=True)
    (d / "SKILL.md").write_text(body, encoding="utf-8")
    return d


def test_discover_empty_and_missing(tmp_path: Path):
    """空目录/不存在目录 → 空列表（不抛）。"""
    assert discover_skills(tmp_path / "not-exist") == []
    assert discover_skills(tmp_path) == []


def test_discover_file_count_limit(tmp_path: Path):
    """>200 文件跳过；恰好 200 文件（含 SKILL.md）边界保留。"""
    over = _write_skill(tmp_path, "over-skill", "---\nname: over\ndescription: 超限\n---\n")
    for i in range(200):  # SKILL.md + 200 = 201 个
        (over / f"f{i}.txt").write_text("x", encoding="utf-8")
    edge = _write_skill(tmp_path, "edge-skill", "---\nname: edge\ndescription: 边界\n---\n")
    for i in range(199):  # SKILL.md + 199 = 200 个
        (edge / f"f{i}.txt").write_text("x", encoding="utf-8")

    found = discover_skills(tmp_path)

    assert [s.name for s in found] == ["edge-skill"]
    assert found[0].file_count == 200


def test_discover_size_limit(tmp_path: Path):
    """累计 >10MB 跳过，正常技能不受影响。"""
    huge = _write_skill(tmp_path, "huge-skill", "---\nname: huge\n---\n")
    (huge / "blob.bin").write_bytes(b"\0" * (10 * 1024 * 1024 + 1))
    ok = _write_skill(tmp_path, "ok-skill", "---\nname: ok\ndescription: 正常\n---\n")
    (ok / "small.bin").write_bytes(b"\0" * 1024)

    found = discover_skills(tmp_path)

    assert [s.name for s in found] == ["ok-skill"]
    assert found[0].total_bytes > 1024


def test_discover_bad_skill_md_tolerated(tmp_path: Path):
    """坏 SKILL.md（二进制垃圾/无围栏）容错：技能仍返回，description 空串。"""
    garbage = tmp_path / "garbage-skill"
    garbage.mkdir()
    (garbage / "SKILL.md").write_bytes(b"\xff\xfe\x00garbage\xff")
    _write_skill(tmp_path, "nofm-skill", "# 没有 frontmatter 围栏\n正文\n")
    _write_skill(tmp_path, "good-skill", "---\nname: good\ndescription: 正常解析\n---\n")

    found = discover_skills(tmp_path)

    by_name = {s.name: s for s in found}
    assert set(by_name) == {"garbage-skill", "nofm-skill", "good-skill"}
    assert by_name["garbage-skill"].description == ""
    assert by_name["nofm-skill"].description == ""
    assert by_name["good-skill"].description == "正常解析"


def test_discover_excludes_git_dir(tmp_path: Path):
    """.git 目录剪枝：里面的伪 SKILL.md 不算技能。"""
    _write_skill(tmp_path, "real-skill", "---\ndescription: 真\n---\n")
    fake = tmp_path / ".git" / "hooks-skill"
    fake.mkdir(parents=True)
    (fake / "SKILL.md").write_text("---\ndescription: 假\n---\n", encoding="utf-8")

    found = discover_skills(tmp_path)

    assert [s.name for s in found] == ["real-skill"]


# ─── service 接线（保存/refresh 即拉取 + 回写）─────────────────────────


@requires_git
async def test_refresh_fetch_writes_back(
    tmp_path: Path, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
):
    """refresh 真拉取本地假仓：last_commit/last_fetched_at 回写、last_error 空、缓存落盘。"""
    repo = _fake_repo(tmp_path)
    # 缓存根进测试沙箱：对 Settings 实例 setattr（init kwarg 注入坑，先例
    # test_source_crud.py test_delete_cascades——setenv 会被 init kwarg 覆盖）。
    monkeypatch.setattr(get_settings(), "spec_data_root", str(tmp_path))

    src = SkillSource(url=repo.as_uri(), branch="main", subdir="skills")
    db_session.add(src)
    await db_session.commit()
    await db_session.refresh(src)

    updated = await SkillSourceService(db_session).refresh(src.id)

    assert updated.last_error is None
    assert updated.last_commit == _head(repo)
    assert updated.last_fetched_at is not None
    assert (source_cache_dir(src.id) / ".git").is_dir(), "真实 clone 应落缓存目录"


async def test_create_fetch_failure_not_blocking(
    client: AsyncClient, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
):
    """create 保存即拉取失败：HTTP 仍 201 + last_error 回写、成功回写字段保持 None。"""

    async def _probe() -> bool:
        return True

    async def _fail(source: SkillSource, cache_root: Path) -> FetchResult:
        return FetchResult(ok=False, commit=None, error="仓库不可达（测试注入失败）")

    monkeypatch.setattr("app.modules.skill_source.git_fetcher.probe_git_binary", _probe)
    monkeypatch.setattr("app.modules.skill_source.git_fetcher.fetch_source", _fail)

    user = User(
        id=uuid.uuid4(),
        email=f"gf-{uuid.uuid4().hex[:6]}@example.com",
        username=f"gf-{uuid.uuid4().hex[:6]}",
        password_hash=password_hasher.hash("x"),
        status="active",
        is_platform_admin=True,
    )
    db_session.add(user)
    await db_session.commit()
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )

    resp = await client.post(
        SOURCES_PATH,
        json={"url": PUBLIC_URL},
        headers={"Authorization": f"Bearer {token}"},
    )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["last_error"] == "仓库不可达（测试注入失败）"
    assert body["last_commit"] is None
    assert body["last_fetched_at"] is None
