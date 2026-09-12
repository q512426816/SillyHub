"""git 技能源拉取器 + SKILL.md 技能发现（D-006 subprocess git / D-007 安全三防线）。

Change: 2026-09-11-skills-central-library (task-02)

职责（design §接口定义 git_fetcher / task-02 taskcard）:
- :func:`probe_git_binary`——git 二进制探测（``shutil.which`` 初判 + ``git --version``
  子进程确认，R-01）；service 层 create/refresh 门用它给 422。
- :func:`assert_source_url`——SSRF 首防线封装（D-007）：委托
  ``core/ssrf.assert_public_url``，由 service 在 create/update 改 url 时调用。
  **fetcher 自身不拦**——create 已拦，refresh/触发走缓存无须重复 DNS 解析，
  也让本地假仓（file://）测试可直达 :func:`fetch_source`。
- :func:`fetch_source`——缓存目录无 ``.git`` 时 ``git clone --depth 1
  --filter=blob:none --no-tags [-b branch]``；已有则先做 **origin URL 漂移
  修正**（``remote get-url`` 与 ``source.url`` 不一致 → ``set-url``/``add``，
  防 update 换 url 后永远拉旧仓库），再 ``git fetch --prune origin <branch>``
  + ``git reset --hard FETCH_HEAD`` 增量更新；commit 取 ``git rev-parse HEAD``。
  子进程一律 ``asyncio.create_subprocess_exec``（worktree/git_runner.py 先例）
  + env 注入 ``GIT_TERMINAL_PROMPT=0``（禁凭据交互挂死）+ 每步 300s 超时
  **杀进程树**（POSIX killpg / Windows taskkill /T）。半成品/删除清理走
  :func:`rmtree_force`（Windows git 只读对象兼容）。**永不抛异常**——失败
  原因进 :class:`FetchResult.error`（调用方写 last_error，不阻塞保存请求）。
- :func:`discover_skills`——扫含 ``SKILL.md`` 的目录（剪枝 ``.git``）；单技能
  >200 文件或 >10MB 跳过 + log warn（D-007 二防线，不影响其它技能）；description
  复用 ``skills_bundle_service._parse_skill_frontmatter`` 解析（坏 SKILL.md
  容错为空串，单个坏文件不炸发现）。

纯函数无状态（编码铁律）：不落库、不缓存探测结果；路径一律 pathlib，
Windows/Linux/macOS 三平台可跑（CLAUDE.md 规则 13）。
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import shutil
import signal
import stat
import sys
from dataclasses import dataclass
from pathlib import Path

from app.core.logging import get_logger
from app.core.ssrf import assert_public_url
from app.modules.agent.skills_bundle_service import _parse_skill_frontmatter
from app.modules.skill_source.model import SkillSource

log = get_logger(__name__)

# 单条 git 命令超时秒数（design §接口定义：300s，clone 大仓/慢网络的宽松上限）。
GIT_STEP_TIMEOUT_SECONDS = 300
# D-007 二防线：单技能目录上限——超限跳过该技能（不抛异常，不影响其它技能）。
MAX_SKILL_FILE_COUNT = 200
MAX_SKILL_TOTAL_BYTES = 10 * 1024 * 1024
# FetchResult.error 里 stderr 截断长度（worktree/git_gateway.service redact 先例）。
_STDERR_CLIP = 500


@dataclass(frozen=True, slots=True)
class FetchResult:
    """单次拉取结果——``ok=False`` 时 ``error`` 带原因（commit 为 None）。"""

    ok: bool
    commit: str | None = None
    error: str | None = None


@dataclass(frozen=True, slots=True)
class DiscoveredSkill:
    """发现的单个技能目录（相对发现根定位）。

    ``name`` 为技能目录名（与 skill_key 的目录段、bundle rel_path 同口径）；
    ``rel_dir`` 为相对发现根的 posix 路径（如 ``"skills/alpha-skill"``）。
    """

    name: str
    description: str
    rel_dir: str
    file_count: int
    total_bytes: int


def _git_env() -> dict[str, str]:
    """子进程 env：继承宿主（PATH/SYSTEMROOT 等）+ ``GIT_TERMINAL_PROMPT=0``。"""
    return {**os.environ, "GIT_TERMINAL_PROMPT": "0"}


async def _kill_process_tree(proc: asyncio.subprocess.Process) -> None:
    """杀掉整棵子进程树（git fetch/clone 会派生 git-remote-https helper，只杀
    父进程会留孤儿持有网络连接与 ``.git`` 句柄）。

    - POSIX：spawn 侧 ``start_new_session=True`` 建独立进程组，此处 ``killpg``
      一次清组（进程已死时 ProcessLookupError 回退单杀）；
    - Windows：``taskkill /PID <pid> /T /F``（/T = 进程树）；taskkill 不可用
      （OSError）回退单杀。
    """
    if sys.platform == "win32":
        try:
            killer = await asyncio.create_subprocess_exec(
                "taskkill",
                "/PID",
                str(proc.pid),
                "/T",
                "/F",
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL,
            )
            await killer.wait()
        except OSError:
            with contextlib.suppress(ProcessLookupError):
                proc.kill()
    else:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            with contextlib.suppress(ProcessLookupError):
                proc.kill()
    with contextlib.suppress(ProcessLookupError):
        await proc.wait()


def rmtree_force(path: Path) -> None:
    """尽力强删目录：Windows 上 git 把 pack/loose object 设为只读，裸
    ``rmtree(ignore_errors=True)`` 会 PermissionError 静默跳过 → 残留非空目录
    → 下次 clone 到非空目标 fatal，源陷入永久失败循环。此处对失败项去只读
    （``stat.S_IWRITE``）重试一次；仍失败则放过（保持 best-effort 语义）。
    """
    if not path.exists():
        return

    def _chmod_retry(func, target, _exc) -> None:  # onexc 签名（3.12+）
        try:
            os.chmod(target, stat.S_IWRITE)
            func(target)
        except OSError:
            pass

    try:
        # requires-python >= 3.12，直接用 onexc（onerror 已废弃、3.14 移除）。
        shutil.rmtree(path, onexc=_chmod_retry)
    except OSError:
        pass


async def assert_source_url(url: str) -> None:
    """SSRF 首防线封装（D-007）：私网/非法 scheme 抛 UnsafeRepoUrl/SsrfBlocked（400）。"""
    await assert_public_url(url)


async def probe_git_binary() -> bool:
    """git 二进制探测（R-01）：``shutil.which`` 初判 + ``git --version`` 子进程确认。"""
    if shutil.which("git") is None:
        return False
    proc: asyncio.subprocess.Process | None = None
    try:
        proc = await asyncio.create_subprocess_exec(
            "git",
            "--version",
            env=_git_env(),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        await asyncio.wait_for(proc.communicate(), timeout=GIT_STEP_TIMEOUT_SECONDS)
    except TimeoutError:
        # 超时补杀（此前裸 return 会留孤儿 git 进程，与 _run_git 行为不一致）。
        if proc is not None:
            await _kill_process_tree(proc)
        return False
    except (FileNotFoundError, OSError):
        return False
    return proc.returncode == 0


async def _run_git(args: list[str], *, cwd: Path | None = None) -> tuple[int, str, str]:
    """跑一条 git 命令（无 shell、env 注入、300s 超时），返回 (rc, stdout, stderr)。

    超时杀**整棵进程树**（POSIX 独立进程组 killpg / Windows taskkill /T）后按
    rc=124 返回（不抛）；spawn 失败（无 git 等）交由 :func:`fetch_source` 的
    兜底 except 收敛成 FetchResult。
    """
    spawn_kwargs: dict = {}
    if sys.platform != "win32":
        # 独立进程组：超时可 killpg 一次清掉 git-remote-https 等派生 helper。
        spawn_kwargs["start_new_session"] = True
    proc = await asyncio.create_subprocess_exec(
        "git",
        *args,
        cwd=str(cwd) if cwd is not None else None,
        env=_git_env(),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        **spawn_kwargs,
    )
    try:
        stdout_b, stderr_b = await asyncio.wait_for(
            proc.communicate(), timeout=GIT_STEP_TIMEOUT_SECONDS
        )
    except TimeoutError:
        await _kill_process_tree(proc)
        arg_head = " ".join(args[:3])
        return 124, "", f"git {arg_head} 超时（{GIT_STEP_TIMEOUT_SECONDS}s），进程已终止"
    return (
        proc.returncode if proc.returncode is not None else -1,
        stdout_b.decode("utf-8", errors="replace").strip(),
        stderr_b.decode("utf-8", errors="replace").strip(),
    )


async def fetch_source(source: SkillSource, cache_root: Path) -> FetchResult:
    """拉取/更新源仓库到 ``cache_root``（浅形态三参固定，D-006）。永不抛异常。

    首次（无 ``.git``）走 clone；已有 ``.git`` 走 ``fetch --prune`` +
    ``reset --hard FETCH_HEAD`` 增量更新（不重建目录，保留未跟踪文件）。
    """
    try:
        if (cache_root / ".git").exists():
            return await _update_repo(source, cache_root)
        return await _clone_repo(source, cache_root)
    except Exception as exc:  # 契约：失败只进 FetchResult.error，不阻塞保存
        log.warning("skill_source_fetch_crashed", source_id=str(source.id), error=str(exc))
        return FetchResult(ok=False, error=f"git 拉取异常：{exc}")


async def _clone_repo(source: SkillSource, repo_dir: Path) -> FetchResult:
    # clone 目标须不存在/为空：清掉无 .git 的残留目录（上次失败的半成品）。
    if repo_dir.exists():
        rmtree_force(repo_dir)
    repo_dir.parent.mkdir(parents=True, exist_ok=True)
    rc, _stdout, stderr = await _run_git(
        [
            "clone",
            "--depth",
            "1",
            "--filter=blob:none",
            "--no-tags",
            "--branch",
            source.branch,
            source.url,
            str(repo_dir),
        ]
    )
    if rc != 0:
        # 失败半成品清掉，下次保存/刷新可重 clone（不留只含 .git 碎片的目录）。
        rmtree_force(repo_dir)
        return FetchResult(ok=False, error=f"git clone 失败（exit {rc}）：{stderr[:_STDERR_CLIP]}")
    return await _resolve_head(repo_dir)


async def _update_repo(source: SkillSource, repo_dir: Path) -> FetchResult:
    # URL 漂移修正：update 改 url 只写 DB，origin 仍是首次 clone 时写进
    # .git/config 的旧地址——不修正则后续 fetch 永远拉旧仓库（M-1）。
    rc, stdout, _stderr = await _run_git(["remote", "get-url", "origin"], cwd=repo_dir)
    if rc != 0:
        rc_fix, _out, stderr = await _run_git(["remote", "add", "origin", source.url], cwd=repo_dir)
        if rc_fix != 0:
            return FetchResult(
                ok=False, error=f"git remote add 失败（exit {rc_fix}）：{stderr[:_STDERR_CLIP]}"
            )
    elif stdout != source.url:
        rc_fix, _out, stderr = await _run_git(
            ["remote", "set-url", "origin", source.url], cwd=repo_dir
        )
        if rc_fix != 0:
            return FetchResult(
                ok=False,
                error=f"git remote set-url 失败（exit {rc_fix}）：{stderr[:_STDERR_CLIP]}",
            )
    rc, _stdout, stderr = await _run_git(
        ["fetch", "--prune", "origin", source.branch], cwd=repo_dir
    )
    if rc != 0:
        return FetchResult(ok=False, error=f"git fetch 失败（exit {rc}）：{stderr[:_STDERR_CLIP]}")
    rc, _stdout, stderr = await _run_git(["reset", "--hard", "FETCH_HEAD"], cwd=repo_dir)
    if rc != 0:
        return FetchResult(ok=False, error=f"git reset 失败（exit {rc}）：{stderr[:_STDERR_CLIP]}")
    return await _resolve_head(repo_dir)


async def _resolve_head(repo_dir: Path) -> FetchResult:
    rc, stdout, stderr = await _run_git(["rev-parse", "HEAD"], cwd=repo_dir)
    if rc != 0:
        return FetchResult(
            ok=False, error=f"git rev-parse 失败（exit {rc}）：{stderr[:_STDERR_CLIP]}"
        )
    return FetchResult(ok=True, commit=stdout)


def discover_skills(cache_dir: Path) -> list[DiscoveredSkill]:
    """扫描 ``cache_dir`` 下含 ``SKILL.md`` 的技能目录（剪枝 ``.git``，双上限）。

    - 上限（D-007 二防线）：单技能 >:data:`MAX_SKILL_FILE_COUNT` 个文件或累计
      >:data:`MAX_SKILL_TOTAL_BYTES` 字节 → 跳过该目录 + log warn，不抛异常、
      不影响其它技能。
    - 坏 SKILL.md（二进制垃圾/无 frontmatter/YAML 语法错）容错：description
      为空串，技能仍返回。
    - 嵌套技能目录（foo/SKILL.md 与 foo/bar/SKILL.md 并存）各自成技能，
      父目录文件计数含子目录——按目录名独立启用，重复计数无害。
    - 结果按 rel_dir 排序，确定序。
    """
    if not cache_dir.is_dir():
        return []
    skill_dirs: list[Path] = []
    for root, dirs, files in os.walk(cache_dir):
        dirs[:] = [d for d in dirs if d != ".git"]
        # SKILL.md 本身是 symlink 的目录不算技能目录（POSIX 恶意仓可用链接
        # 指向缓存外文件借 description 泄露内容；Windows git 默认物化链接无此面）。
        if "SKILL.md" in files and not (Path(root) / "SKILL.md").is_symlink():
            skill_dirs.append(Path(root))

    results: list[DiscoveredSkill] = []
    for skill_dir in sorted(skill_dirs):
        file_count, total_bytes = _count_tree(skill_dir)
        if file_count > MAX_SKILL_FILE_COUNT:
            log.warning(
                "skill_file_limit_exceeded",
                dir=str(skill_dir),
                file_count=file_count,
                limit=MAX_SKILL_FILE_COUNT,
            )
            continue
        if total_bytes > MAX_SKILL_TOTAL_BYTES:
            log.warning(
                "skill_size_limit_exceeded",
                dir=str(skill_dir),
                total_bytes=total_bytes,
                limit=MAX_SKILL_TOTAL_BYTES,
            )
            continue
        results.append(
            DiscoveredSkill(
                name=skill_dir.name,
                description=_read_description(skill_dir / "SKILL.md"),
                rel_dir=skill_dir.relative_to(cache_dir).as_posix(),
                file_count=file_count,
                total_bytes=total_bytes,
            )
        )
    return results


def _count_tree(root: Path) -> tuple[int, int]:
    """单技能目录的文件数/总字节数（排除 ``.git``；stat 失败按 0 字节计）。"""
    file_count = 0
    total_bytes = 0
    for cur, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d != ".git"]
        for name in files:
            file_count += 1
            try:
                total_bytes += (Path(cur) / name).stat().st_size
            except OSError:
                continue
    return file_count, total_bytes


def _read_description(skill_md: Path) -> str:
    """读 SKILL.md frontmatter 的 description（坏文件容错为空串，不抛）。"""
    try:
        frontmatter = _parse_skill_frontmatter(skill_md.read_bytes())
    except OSError:
        return ""
    return frontmatter.get("description", "")
