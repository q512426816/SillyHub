"""worktree clone repo_url 协议白名单（design §5 B3 / D-004 / R-03）。

覆盖：
- assert_safe_repo_url 放行 https/ssh/git + scp-like（含带端口、内网 git）；
- assert_safe_repo_url 拒 ext::（RCE）/ file:// / 裸路径 / Windows 盘符 / 空；
- clone_bare 在拉起 git 子进程**之前**完成协议校验（非法抛 UnsafeRepoUrl，不触子进程）。
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.core.ssrf import assert_safe_repo_url
from app.modules.worktree.git_runner import GitRunner


@pytest.mark.parametrize(
    "url",
    [
        "https://github.com/org/repo.git",
        "https://git.example.internal/scm/r.git",  # 内网 https
        "ssh://git@gitlab.com:22/org/repo.git",  # ssh 带端口
        "ssh://host:2222/path/to/repo",
        "git://host/org/repo.git",
        "git@github.com:org/repo.git",  # scp-like
        "user@host.example.com:path/repo.git",  # scp-like
        "host:path/repo.git",  # scp-like（无 user@）
    ],
)
def test_safe_repo_url_allows_normal_remotes(url: str):
    assert_safe_repo_url(url)  # 不抛即放行


@pytest.mark.parametrize(
    "url",
    [
        "ext::git-remote-ext evil-cmd",  # remote helper → RCE
        "file:///etc/passwd",  # 读本地文件
        "file:///srv/git/repo.git",
        "/abs/local/path",  # 裸绝对路径（git 视同本地）
        "./relative/repo",  # 相对路径
        "..",
        "",  # 空
        "C:\\Users\\repo",  # Windows 盘符
        "C:/Users/repo",
        "http://insecure.example.com/r.git",  # 明文 http 不在白名单（design §7：{https,ssh,git}）
        "gopher://host/x",  # 其它协议
    ],
)
def test_safe_repo_url_rejects_dangerous_forms(url: str):
    from app.core.ssrf import UnsafeRepoUrl

    with pytest.raises(UnsafeRepoUrl):
        assert_safe_repo_url(url)


async def test_clone_bare_rejects_before_subprocess(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    """协议校验在 git clone 子进程之前：非法 repo_url 抛 UnsafeRepoUrl，_run 不被调用。"""
    invoked: list[list[str]] = []

    async def _spy_run(self, args: list[str], **kwargs):
        invoked.append(list(args))

    monkeypatch.setattr(GitRunner, "_run", _spy_run)

    runner = GitRunner()
    from app.core.ssrf import UnsafeRepoUrl

    with pytest.raises(UnsafeRepoUrl):
        await runner.clone_bare("ext::evil-cmd", tmp_path / "bare", env={})
    assert invoked == [], "协议校验必须先于 git clone 子进程"


async def test_clone_bare_allows_https_then_runs_clone(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    """合法 repo_url 通过协议校验后正常进入 clone（_run 被以 clone --bare 调用）。"""
    invoked: list[list[str]] = []

    async def _spy_run(self, args: list[str], **kwargs):
        invoked.append(list(args))

    monkeypatch.setattr(GitRunner, "_run", _spy_run)

    runner = GitRunner()
    await runner.clone_bare("https://example.com/r.git", tmp_path / "bare", env={})
    assert invoked and invoked[0][:2] == ["clone", "--bare"]
