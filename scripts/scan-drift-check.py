#!/usr/bin/env python3
"""scan 文档漂移双信号检测脚本（warn-only）。

检测 `.sillyspec/docs/SillyHub/scan/*.md` 两类漂移（设计 §4，D-001@v1）：

* 信号 1 · source_commit 时效：scan 文档 frontmatter 的 source_commit 落后 HEAD
  超过阈值（默认 50，env ``SCAN_DRIFT_COMMIT_THRESHOLD`` 可配）即漂移；
  source_commit 缺失 / 不是 HEAD 祖先（被 rebase 掉）/ git 报错也按漂移处理（R-03）。
* 信号 2 · 文件路径存在性：正则提取文档 body 引用的四端前缀路径
  （backend / frontend / sillyhub-daemon / deploy），逐个校验文件/目录是否仍存在，
  缺失即漂移（R-02 白名单 + 完整扩展名长在前匹配；R-05 剥行号 + 目录路径 isdir）。

退出码：始终 0（warn-only，不阻塞 PR，D-002@v1）；仅脚本自身异常才非 0。
输出：GitHub ``::warning file=<doc>::<msg>`` 注解 + 人类可读汇总。

仅依赖 stdlib，兼容 Python 3.12，跨平台 Windows/Linux/macOS（CLAUDE.md 规则 13）。

用法（仓库根目录跑）::

    python scripts/scan-drift-check.py
    SCAN_DRIFT_COMMIT_THRESHOLD=100 python scripts/scan-drift-check.py
"""

from __future__ import annotations

import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

# ---------------------------------------------------------------------------
# 常量
# ---------------------------------------------------------------------------

#: 四端源码目录前缀（白名单，R-02：仅这些前缀的路径才算 scan 锚点）。
_PREFIXES = ("backend", "frontend", "sillyhub-daemon", "deploy")
_PREFIX_RE = f"(?:{'|'.join(_PREFIXES)})"

#: 扩展名：长在前排列，避免 ``js`` 吃掉 ``json``、``ts`` 吃掉 ``tsx``（R-02 铁律）。
_EXT_RE = r"(?:json|yaml|yml|tsx|mjs|py|ts|js|md)"

# 文件路径片段字符集（允许字母数字、下划线、点、斜杠、连字符；非贪婪）。
_PATH_CHARS = r"[A-Za-z0-9_./-]+?"

#: 文件引用：prefix + 路径 + .ext，扩展名后负向前瞻防止 ``.tsx`` 被当 ``.ts``+x。
#: 仅提文件（带扩展名），不提裸目录路径——避免 ``backend/.venv/Scripts/`` 这类环境相关
#: 目录污染信号 2（R-02）。目录路径在 check_drift 用 ``isfile or isdir`` 校验时天然认。
_FILE_REF_RE = rf"{_PREFIX_RE}/{_PATH_CHARS}\.{_EXT_RE}(?![A-Za-z0-9])"

_REF_RE = re.compile(_FILE_REF_RE)

#: frontmatter source_commit 字段。
_SOURCE_COMMIT_RE = re.compile(r"^source_commit:\s*(.+?)\s*$", re.MULTILINE)

#: 默认 commit 阈值。
_DEFAULT_THRESHOLD = 50


# ---------------------------------------------------------------------------
# 数据模型
# ---------------------------------------------------------------------------


@dataclass
class DocDrift:
    """单篇 scan 文档的漂移信息。"""

    doc: Path
    source_commit: str | None = None
    behind: int | None = None
    missing_paths: list[str] = field(default_factory=list)
    reasons: list[str] = field(default_factory=list)

    @property
    def drifted(self) -> bool:
        """是否漂移（信号 1 或信号 2 任一命中）。"""
        return bool(self.reasons)


@dataclass
class DriftReport:
    """scan 目录的漂移汇总报告。"""

    scan_dir: Path
    threshold: int
    repo_root: Path
    docs: list[DocDrift] = field(default_factory=list)

    @property
    def total_docs(self) -> int:
        return len(self.docs)

    @property
    def drifted_docs(self) -> list[DocDrift]:
        return [d for d in self.docs if d.drifted]

    @property
    def total_drifted(self) -> int:
        return len(self.drifted_docs)

    @property
    def total_missing_paths(self) -> int:
        return sum(len(d.missing_paths) for d in self.docs)


# ---------------------------------------------------------------------------
# 核心函数
# ---------------------------------------------------------------------------


def parse_source_commit(doc_path: Path) -> str | None:
    """读 markdown frontmatter（首个 ``---``...``---`` 块）里的 source_commit 值。

    取文件里首个 ``---``...``---`` 块作为 frontmatter（允许块前有标题行，
    兼容 CONVENTIONS.md 这类 ``# 标题`` 在 frontmatter 之前的非标准布局）。

    缺失字段 / 无 frontmatter / 读失败 / 空值 → 返回 None。
    """
    try:
        text = doc_path.read_text(encoding="utf-8")
    except OSError:
        return None

    lines = text.splitlines()
    start_idx: int | None = None
    end_idx: int | None = None
    for i, line in enumerate(lines):
        if line.strip() == "---":
            if start_idx is None:
                start_idx = i
            else:
                end_idx = i
                break
    if start_idx is None or end_idx is None:
        return None

    frontmatter = "\n".join(lines[start_idx + 1 : end_idx])
    m = _SOURCE_COMMIT_RE.search(frontmatter)
    if not m:
        return None

    val = m.group(1).strip().strip("\"'")
    return val or None


def _run_git(
    args: list[str], cwd: Path | None = None
) -> subprocess.CompletedProcess[str] | None:
    """跑 git 子进程（list 参数，不开 shell，跨平台）。失败返回 None。"""
    try:
        return subprocess.run(
            ["git", *args],
            capture_output=True,
            text=True,
            cwd=str(cwd) if cwd else None,
        )
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        return None


def _commits_behind(source_commit: str, head: str, cwd: Path | None) -> int | None:
    """算 source_commit 落后 head 的 commit 数（内部实现，可指定 cwd）。

    source_commit 不是 head 的祖先 / git 报错 / 哈希不存在 → None（R-03，不崩）。
    """
    # 先确认祖先关系（同时校验哈希是否存在）。
    anc = _run_git(["merge-base", "--is-ancestor", source_commit, head], cwd=cwd)
    if anc is None or anc.returncode != 0:
        return None

    rev = _run_git(["rev-list", "--count", f"{source_commit}..{head}"], cwd=cwd)
    if rev is None or rev.returncode != 0:
        return None
    try:
        return int(rev.stdout.strip())
    except ValueError:
        return None


def commits_behind(source_commit: str, head: str = "HEAD") -> int | None:
    """算 source_commit 落后 head 的 commit 数（在当前工作目录的 git 仓库里）。

    source_commit 不是 head 的祖先 / git 报错 / 哈希不存在 → 返回 None（不崩，R-03）。
    """
    return _commits_behind(source_commit, head, cwd=None)


def extract_file_refs(doc_path: Path) -> list[str]:
    """正则提取文档 body 里四端前缀的文件路径，剥行号，去重保序。

    * 命中 ``backend|frontend|sillyhub-daemon|deploy`` 四端前缀；
    * 文件路径带完整扩展名（长在前排列 + 负向前瞻，R-02 铁律）；
    * 不提裸目录路径（结尾斜杠、无扩展名）——避免 ``backend/.venv/Scripts/`` 这类
      环境相关目录污染信号 2（R-02）；目录路径在 check_drift 用 ``isfile or isdir`` 校验时天然认；
    * 带行号路径（``a/b.py:123``）剥行号后取文件；
    * 返回去重后的路径列表（保留出现顺序）。
    """
    try:
        text = doc_path.read_text(encoding="utf-8")
    except OSError:
        return []

    seen: dict[str, None] = {}
    for m in _REF_RE.finditer(text):
        ref = m.group(0)
        # 防御性剥行号（正则字符集不含 ':'，正常不会带上，此处兜底）。
        ref = re.sub(r":\d+$", "", ref)
        if ref and ref not in seen:
            seen[ref] = None
    return list(seen.keys())


def _find_repo_root(start: Path) -> Path:
    """从 start 往上找 git 仓库根（含 .git 的目录）；找不到则回退到含 backend/+frontend/ 的目录。"""
    p = start.resolve()
    for cand in [p, *p.parents]:
        if (cand / ".git").exists():
            return cand
    for cand in [p, *p.parents]:
        if (cand / "backend").is_dir() and (cand / "frontend").is_dir():
            return cand
    return p


def check_drift(scan_dir: Path, threshold: int = _DEFAULT_THRESHOLD) -> DriftReport:
    """遍历 scan_dir 下每个 ``*.md``，汇总双信号漂移。

    * 信号 1：commits_behind > threshold，或 source_commit 缺失/非祖先（None）→ 漂移；
    * 信号 2：每个 extract 出的路径用 isfile/isdir 校验，不存在 → 缺失（漂移）。
    """
    repo_root = _find_repo_root(scan_dir)
    report = DriftReport(scan_dir=scan_dir, threshold=threshold, repo_root=repo_root)

    if not scan_dir.is_dir():
        return report

    for doc in sorted(scan_dir.glob("*.md")):
        dd = DocDrift(doc=doc)

        # 信号 1 · source_commit 时效。
        source = parse_source_commit(doc)
        dd.source_commit = source
        if source is None:
            dd.behind = None
            dd.reasons.append("source_commit 缺失（frontmatter 无 source_commit 字段）")
        else:
            behind = _commits_behind(source, "HEAD", cwd=repo_root)
            dd.behind = behind
            if behind is None:
                dd.reasons.append(
                    f"source_commit {source} 不是 HEAD 祖先或 git 无法解析（可能被 rebase 掉）"
                )
            elif behind > threshold:
                dd.reasons.append(
                    f"source_commit {source} 落后 HEAD {behind} commit（阈值 {threshold}）"
                )

        # 信号 2 · 文件路径存在性。
        for ref in extract_file_refs(doc):
            full = repo_root / ref
            if not (os.path.isfile(full) or os.path.isdir(full)):
                dd.missing_paths.append(ref)

        if dd.missing_paths:
            dd.reasons.append("引用路径缺失：" + "、".join(dd.missing_paths))

        report.docs.append(dd)

    return report


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _threshold_from_env(env: dict[str, str] | None = None) -> int:
    """从 env 读 SCAN_DRIFT_COMMIT_THRESHOLD（默认 50）。非法/负值回退默认。"""
    src = env if env is not None else os.environ
    raw = src.get("SCAN_DRIFT_COMMIT_THRESHOLD", str(_DEFAULT_THRESHOLD))
    try:
        val = int(raw)
    except (TypeError, ValueError):
        return _DEFAULT_THRESHOLD
    return val if val >= 0 else _DEFAULT_THRESHOLD


def _rel_posix(repo_root: Path, path: Path) -> str:
    """返回 path 相对 repo_root 的 posix 风格路径（GitHub 注解用）；失败回退绝对。"""
    try:
        return path.resolve().relative_to(repo_root.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def _emit_warnings(report: DriftReport, stream=sys.stdout) -> None:
    """打印 GitHub ::warning 注解（每个漂移文档一条）。"""
    for dd in report.drifted_docs:
        rel = _rel_posix(report.repo_root, dd.doc)
        msg = "；".join(dd.reasons)
        print(f"::warning file={rel}::scan 文档漂移：{msg}", file=stream)


def _emit_summary(report: DriftReport, stream=sys.stdout) -> None:
    """打印人类可读汇总报告。"""
    print("", file=stream)
    print("scan 文档漂移检查", file=stream)
    print(f"  扫描目录：{_rel_posix(report.repo_root, report.scan_dir)}", file=stream)
    print(f"  仓库根：{report.repo_root.as_posix()}", file=stream)
    print(f"  commit 阈值：{report.threshold}", file=stream)
    print(f"  扫描文档：{report.total_docs} 篇", file=stream)
    print(f"  漂移文档：{report.total_drifted} 篇", file=stream)
    print(f"  缺失路径：{report.total_missing_paths} 条", file=stream)
    print("", file=stream)

    if not report.docs:
        print("  （扫描目录下无 *.md 文档）", file=stream)
        return

    print("逐篇状态：", file=stream)
    for dd in report.docs:
        name = dd.doc.name
        if not dd.drifted:
            behind_str = f"落后 {dd.behind} commit" if dd.behind is not None else "未知"
            print(f"  [OK]    {name} — {behind_str}，正常", file=stream)
        else:
            for reason in dd.reasons:
                print(f"  [DRIFT] {name} — {reason}", file=stream)

    print("", file=stream)
    if report.total_drifted:
        print(
            f"发现 {report.total_drifted} 篇 scan 文档漂移（warn-only，exit 0，不阻塞）。"
            "请重跑 sillyspec scan 刷新 source_commit 并修复失效路径。",
            file=stream,
        )
    else:
        print("全部 scan 文档正常，无漂移。", file=stream)


def _safe_reconfigure() -> None:
    """让 stdout/stderr 用 UTF-8 输出（errors=replace 兜底）。

    Windows 默认控制台编码（GBK/cp936）无法编码部分字符会抛 UnicodeEncodeError，
    违反「始终 exit 0」（D-002）。强制 UTF-8 + replace：CI（ubuntu UTF-8）完美；
    本地旧版 GBK 控制台即便中文乱码也不崩，结构信息（ASCII 标记）仍可读。
    """
    for stream in (sys.stdout, sys.stderr):
        reconfigure = getattr(stream, "reconfigure", None)
        if callable(reconfigure):
            try:
                reconfigure(encoding="utf-8", errors="replace")
            except (TypeError, ValueError, OSError):
                pass


def main(argv: list[str] | None = None) -> int:
    """CLI 入口。读 env 阈值，扫描默认 scan 目录，输出 ::warning + 汇总，始终 exit 0。"""
    _safe_reconfigure()
    repo_root = Path(__file__).resolve().parent.parent
    scan_dir = repo_root / ".sillyspec" / "docs" / "SillyHub" / "scan"
    threshold = _threshold_from_env()

    try:
        report = check_drift(scan_dir, threshold=threshold)
    except Exception as exc:  # 脚本自身异常才非 0（D-002）。
        print(f"ERROR: scan-drift-check 脚本异常：{exc}", file=sys.stderr)
        return 1

    _emit_warnings(report)
    _emit_summary(report)
    return 0


if __name__ == "__main__":
    sys.exit(main())
