#!/usr/bin/env python3
"""scripts/scan-drift-check.py 单元测试。

覆盖 parse_source_commit / commits_behind / extract_file_refs / check_drift
四函数关键分支（AC-08）。

跑法（worktree 根目录）::

    python -m pytest scripts/test_scan_drift_check.py -q
"""

from __future__ import annotations

import importlib.util
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

# 被测脚本文件名带连字符（scan-drift-check.py），非合法模块名，
# 用 importlib 按文件路径加载为 sdk（不依赖包结构、不改 sys.path）。
_SCRIPTS_DIR = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location(
    "scan_drift_check", _SCRIPTS_DIR / "scan-drift-check.py"
)
assert _spec is not None and _spec.loader is not None
sdk = importlib.util.module_from_spec(_spec)
sys.modules["scan_drift_check"] = sdk
_spec.loader.exec_module(sdk)


# ---------------------------------------------------------------------------
# 辅助：迷你 git 仓库
# ---------------------------------------------------------------------------


def _git(args: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    """在 cwd 跑 git，check=True 失败抛错。"""
    return subprocess.run(
        ["git", *args], cwd=str(cwd), capture_output=True, text=True, check=True
    )


def _make_git_repo(root: Path) -> str:
    """在 root 初始化一个迷你 git 仓库（两次 commit），返回第一次 commit 的哈希。"""
    root.mkdir(parents=True, exist_ok=True)
    # Windows 下 git init 默认 master 分支无妨；禁用 commit 签名避免环境干扰。
    _git(["init", "-q"], root)
    _git(["config", "user.email", "test@example.com"], root)
    _git(["config", "user.name", "test"], root)
    _git(["config", "commit.gpgsign", "false"], root)

    (root / "a.txt").write_text("a", encoding="utf-8")
    _git(["add", "."], root)
    _git(["commit", "-m", "c1", "-q"], root)
    first = _git(["rev-parse", "HEAD"], root).stdout.strip()

    (root / "b.txt").write_text("b", encoding="utf-8")
    _git(["add", "."], root)
    _git(["commit", "-m", "c2", "-q"], root)
    return first


# ---------------------------------------------------------------------------
# parse_source_commit
# ---------------------------------------------------------------------------


def test_parse_source_commit_with_value(tmp_path: Path) -> None:
    doc = tmp_path / "D.md"
    doc.write_text(
        textwrap.dedent(
            """\
            ---
            author: tester
            source_commit: abc1234
            updated_at: 2026-08-06
            ---
            # 正文
            """
        ),
        encoding="utf-8",
    )
    assert sdk.parse_source_commit(doc) == "abc1234"


def test_parse_source_commit_quoted_value(tmp_path: Path) -> None:
    doc = tmp_path / "D.md"
    doc.write_text('---\nsource_commit: "deadbeef"\n---\nbody\n', encoding="utf-8")
    assert sdk.parse_source_commit(doc) == "deadbeef"


def test_parse_source_commit_missing_field(tmp_path: Path) -> None:
    doc = tmp_path / "D.md"
    doc.write_text("---\nauthor: tester\n---\nbody\n", encoding="utf-8")
    assert sdk.parse_source_commit(doc) is None


def test_parse_source_commit_no_frontmatter(tmp_path: Path) -> None:
    doc = tmp_path / "D.md"
    doc.write_text("# 标题\n\nbackend/app/main.py\n", encoding="utf-8")
    assert sdk.parse_source_commit(doc) is None


def test_parse_source_commit_empty_value(tmp_path: Path) -> None:
    """格式异常：source_commit 字段值为空 → None。"""
    doc = tmp_path / "D.md"
    doc.write_text('---\nsource_commit: ""\n---\nbody\n', encoding="utf-8")
    assert sdk.parse_source_commit(doc) is None


def test_parse_source_commit_unclosed_frontmatter(tmp_path: Path) -> None:
    """格式异常：frontmatter 没有结束分隔符 → None（不会把正文里的误当 frontmatter）。"""
    doc = tmp_path / "D.md"
    doc.write_text(
        "---\nsource_commit: abc1234\nbody without closer\n", encoding="utf-8"
    )
    assert sdk.parse_source_commit(doc) is None


def test_parse_source_commit_title_before_frontmatter(tmp_path: Path) -> None:
    """lenient：frontmatter 前有标题行（CONVENTIONS.md 实际布局）仍能取到 source_commit。"""
    doc = tmp_path / "D.md"
    doc.write_text(
        "# 代码约定(Conventions)\n\n---\nauthor: qinyi\nsource_commit: 5a00fc7e\n---\n\n正文\n",
        encoding="utf-8",
    )
    assert sdk.parse_source_commit(doc) == "5a00fc7e"


def test_parse_source_commit_body_horizontal_rule_ignored(tmp_path: Path) -> None:
    """正文里的 --- 横线规则不干扰：取首个 ---...--- 块，且其后正文 --- 不误判。"""
    doc = tmp_path / "D.md"
    doc.write_text(
        "---\nsource_commit: abc1234\n---\n\n标题\n\n---\n\n正文后的横线\n",
        encoding="utf-8",
    )
    assert sdk.parse_source_commit(doc) == "abc1234"


def test_parse_source_commit_read_error(tmp_path: Path) -> None:
    """读失败（路径不存在）→ None，不抛异常。"""
    assert sdk.parse_source_commit(tmp_path / "nope.md") is None


# ---------------------------------------------------------------------------
# commits_behind
# ---------------------------------------------------------------------------


def test_commits_behind_valid_ancestor(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    first = _make_git_repo(tmp_path)
    monkeypatch.chdir(tmp_path)
    # first 是 HEAD 的祖先，HEAD 比 first 多 1 个 commit。
    assert sdk.commits_behind(first, "HEAD") == 1


def test_commits_behind_equal_returns_zero(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _make_git_repo(tmp_path)
    monkeypatch.chdir(tmp_path)
    head = _git(["rev-parse", "HEAD"], tmp_path).stdout.strip()
    assert sdk.commits_behind(head, "HEAD") == 0


def test_commits_behind_non_ancestor(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """非祖先（source 在另一条分叉）→ None。"""
    _make_git_repo(tmp_path)
    monkeypatch.chdir(tmp_path)
    # 创建一个不在 HEAD 祖先链上的分支 commit。
    _git(["checkout", "-q", "-b", "side", "HEAD~1"], tmp_path)
    (tmp_path / "c.txt").write_text("c", encoding="utf-8")
    _git(["add", "."], tmp_path)
    _git(["commit", "-m", "side", "-q"], tmp_path)
    side = _git(["rev-parse", "HEAD"], tmp_path).stdout.strip()
    _git(["checkout", "-q", "master"], tmp_path)  # 回主线（可能叫 master/main）
    # side 存在但不是 HEAD 的祖先 → None。
    assert sdk.commits_behind(side, "HEAD") is None


def test_commits_behind_bad_hash(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """哈希不存在 → None（不崩，R-03）。"""
    _make_git_repo(tmp_path)
    monkeypatch.chdir(tmp_path)
    assert sdk.commits_behind("0" * 40, "HEAD") is None


def test_commits_behind_no_git_repo(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """不在 git 仓库里 → None（不崩）。"""
    monkeypatch.chdir(tmp_path)
    assert sdk.commits_behind("abc1234", "HEAD") is None


# ---------------------------------------------------------------------------
# extract_file_refs
# ---------------------------------------------------------------------------


def test_extract_file_refs_four_prefixes(tmp_path: Path) -> None:
    doc = tmp_path / "D.md"
    doc.write_text(
        "代码在 backend/app/main.py、frontend/src/lib/agent.ts、"
        "sillyhub-daemon/src/mcp-server.ts、deploy/docker-compose.yml。\n",
        encoding="utf-8",
    )
    refs = sdk.extract_file_refs(doc)
    assert "backend/app/main.py" in refs
    assert "frontend/src/lib/agent.ts" in refs
    assert "sillyhub-daemon/src/mcp-server.ts" in refs
    assert "deploy/docker-compose.yml" in refs


def test_extract_file_refs_strip_line_number(tmp_path: Path) -> None:
    """带行号路径剥行号后取文件（R-05）。"""
    doc = tmp_path / "D.md"
    doc.write_text(
        "见 backend/app/modules/daemon/router.py:1958 与 frontend/src/lib/agent.ts:24。\n",
        encoding="utf-8",
    )
    refs = sdk.extract_file_refs(doc)
    assert "backend/app/modules/daemon/router.py" in refs
    assert "frontend/src/lib/agent.ts" in refs
    # 带行号的原始形态不应出现。
    assert not any(r.endswith(":1958") or r.endswith(":24") for r in refs)


def test_extract_file_refs_bare_directory_not_extracted(tmp_path: Path) -> None:
    """裸目录路径（结尾斜杠、无扩展名）不提取（design §4：仅提带扩展名的文件路径）。

    这避免 backend/.venv/Scripts/ 这类环境相关目录污染信号 2（R-02）。
    """
    doc = tmp_path / "D.md"
    doc.write_text(
        "分层在 backend/app/core/ 与 frontend/src/components/ 下；"
        "venv 在 backend/.venv/Scripts/。\n",
        encoding="utf-8",
    )
    refs = sdk.extract_file_refs(doc)
    # 裸目录路径一律不提取（含 .venv 这类环境目录）。
    assert not any(r.endswith("/") for r in refs), refs
    assert "backend/.venv/Scripts/" not in refs


def test_extract_file_refs_tsx_not_eaten_by_ts(tmp_path: Path) -> None:
    """.tsx 不被 .ts 吃（R-02 铁律：长在前 + 负向前瞻）。"""
    doc = tmp_path / "D.md"
    doc.write_text(
        "组件 frontend/src/components/ppm-resource-table.tsx 在。\n", encoding="utf-8"
    )
    refs = sdk.extract_file_refs(doc)
    assert "frontend/src/components/ppm-resource-table.tsx" in refs
    assert not any(r.endswith(".ts") and r.endswith("table.ts") for r in refs), refs


def test_extract_file_refs_json_not_eaten_by_js(tmp_path: Path) -> None:
    """package.json 不被截断为 package.js（R-02 铁律）。"""
    doc = tmp_path / "D.md"
    doc.write_text(
        "依赖见 frontend/package.json 与 sillyhub-daemon/package.json。\n",
        encoding="utf-8",
    )
    refs = sdk.extract_file_refs(doc)
    assert "frontend/package.json" in refs
    assert "sillyhub-daemon/package.json" in refs
    assert not any(r.endswith("package.js") for r in refs), refs


def test_extract_file_refs_dedup(tmp_path: Path) -> None:
    """同一路径多次出现只保留一份（保序）。"""
    doc = tmp_path / "D.md"
    doc.write_text(
        "backend/app/main.py 一处；backend/app/main.py 二处；backend/app/main.py:10 三处。\n",
        encoding="utf-8",
    )
    refs = sdk.extract_file_refs(doc)
    assert refs == ["backend/app/main.py"]


def test_extract_file_refs_negative_outside_prefix(tmp_path: Path) -> None:
    """白名单外前缀（docs/、node_modules/、裸路径）不命中（R-02）。"""
    doc = tmp_path / "D.md"
    doc.write_text(
        "见 docs/guide.py 与 node_modules/x/index.js 与 some/other.ts 与 app/main.py。\n",
        encoding="utf-8",
    )
    refs = sdk.extract_file_refs(doc)
    assert refs == [], f"应无命中，实际：{refs}"


def test_extract_file_refs_negative_example_path(tmp_path: Path) -> None:
    """示例/截断路径不命中：不带前缀的 package.js 不在白名单，不报。"""
    doc = tmp_path / "D.md"
    doc.write_text(
        "例如 package.js 是一个示例文件名（无四端前缀）。\n", encoding="utf-8"
    )
    refs = sdk.extract_file_refs(doc)
    assert refs == [], f"应无命中，实际：{refs}"


def test_extract_file_refs_all_extensions(tmp_path: Path) -> None:
    """覆盖全部 9 个扩展名都能命中。"""
    doc = tmp_path / "D.md"
    cases = [
        "backend/a.json",
        "backend/a.yaml",
        "backend/a.yml",
        "frontend/a.tsx",
        "sillyhub-daemon/a.mjs",
        "backend/a.py",
        "frontend/a.ts",
        "frontend/a.js",
        "backend/a.md",
    ]
    doc.write_text(" ".join(cases) + "\n", encoding="utf-8")
    refs = sdk.extract_file_refs(doc)
    assert sorted(refs) == sorted(cases)


# ---------------------------------------------------------------------------
# check_drift
# ---------------------------------------------------------------------------


def _write_scan_doc(
    scan_dir: Path, name: str, source_commit: str | None, body: str
) -> Path:
    scan_dir.mkdir(parents=True, exist_ok=True)
    doc = scan_dir / name
    if source_commit is None:
        doc.write_text(f"# {name}\n\n{body}\n", encoding="utf-8")
    else:
        doc.write_text(
            f"---\nsource_commit: {source_commit}\n---\n\n{body}\n", encoding="utf-8"
        )
    return doc


def test_check_drift_fresh(tmp_path: Path) -> None:
    """全新文档（source_commit == HEAD，路径全在）→ 0 漂移。"""
    _make_git_repo(tmp_path)
    head = _git(["rev-parse", "HEAD"], tmp_path).stdout.strip()
    # 造一个真实存在的被引用文件。
    (tmp_path / "backend" / "app").mkdir(parents=True)
    (tmp_path / "backend" / "app" / "main.py").write_text("", encoding="utf-8")
    _git(["add", "."], tmp_path)
    _git(["commit", "-m", "add file", "-q"], tmp_path)
    head = _git(["rev-parse", "HEAD"], tmp_path).stdout.strip()

    scan = tmp_path / "scan"
    _write_scan_doc(scan, "FRESH.md", head, "ref backend/app/main.py")

    report = sdk.check_drift(scan, threshold=50)
    assert report.total_docs == 1
    assert report.total_drifted == 0
    assert report.docs[0].behind == 0
    assert report.docs[0].missing_paths == []


def test_check_drift_stale_source_commit(tmp_path: Path) -> None:
    """source_commit 过期（落后超阈值）→ 漂移。"""
    first = _make_git_repo(tmp_path)
    scan = tmp_path / "scan"
    _write_scan_doc(scan, "STALE.md", first, "正文无路径引用。")

    # threshold=0：落后 1 即超阈值 → 漂移。
    report = sdk.check_drift(scan, threshold=0)
    assert report.total_drifted == 1
    dd = report.docs[0]
    assert dd.behind == 1
    assert dd.drifted
    assert any("落后 HEAD" in r for r in dd.reasons)

    # threshold=50：落后 1 未超阈值 → 不漂移（信号 1）。
    report2 = sdk.check_drift(scan, threshold=50)
    assert report2.total_drifted == 0


def test_check_drift_missing_source_commit(tmp_path: Path) -> None:
    """缺 source_commit → 漂移。"""
    _make_git_repo(tmp_path)
    scan = tmp_path / "scan"
    _write_scan_doc(scan, "NOSRC.md", None, "正文。")
    report = sdk.check_drift(scan, threshold=50)
    assert report.total_drifted == 1
    assert report.docs[0].source_commit is None
    assert report.docs[0].behind is None
    assert any("source_commit 缺失" in r for r in report.docs[0].reasons)


def test_check_drift_non_ancestor_source_commit(tmp_path: Path) -> None:
    """source_commit 不是 HEAD 祖先 → 漂移（R-03）。"""
    _make_git_repo(tmp_path)
    scan = tmp_path / "scan"
    _write_scan_doc(scan, "REBASED.md", "1" * 40, "正文。")
    report = sdk.check_drift(scan, threshold=50)
    assert report.total_drifted == 1
    assert report.docs[0].behind is None
    assert any("祖先" in r for r in report.docs[0].reasons)


def test_check_drift_missing_path(tmp_path: Path) -> None:
    """引用路径不存在 → 漂移（信号 2）。"""
    _make_git_repo(tmp_path)
    head = _git(["rev-parse", "HEAD"], tmp_path).stdout.strip()
    scan = tmp_path / "scan"
    _write_scan_doc(scan, "MISSING.md", head, "引用 backend/app/nonexistent.py 已删。")
    report = sdk.check_drift(scan, threshold=50)
    assert report.total_drifted == 1
    dd = report.docs[0]
    assert "backend/app/nonexistent.py" in dd.missing_paths
    assert report.total_missing_paths == 1


def test_check_drift_directory_path_validated(tmp_path: Path) -> None:
    """「目录路径 isdir 也认」：带扩展名的引用路径在磁盘上是目录时，isdir 兜底不算缺失。

    extract_file_refs 只提带扩展名的文件路径（design §4）；check_drift 校验时
    isfile or isdir，若该路径恰是目录（如有人把 tools.py 建成目录）也认，不误报漂移。
    """
    _make_git_repo(tmp_path)
    head = _git(["rev-parse", "HEAD"], tmp_path).stdout.strip()
    # 磁盘上把 backend/app/tools.py 建成一个目录（名字带扩展名）。
    (tmp_path / "backend" / "app" / "tools.py").mkdir(parents=True)

    scan = tmp_path / "scan"
    _write_scan_doc(scan, "ISDIR.md", head, "引用 backend/app/tools.py（实为目录）。")
    report = sdk.check_drift(scan, threshold=50)
    dd = report.docs[0]
    assert "backend/app/tools.py" not in dd.missing_paths
    assert report.total_drifted == 0


def test_check_drift_threshold_from_env(tmp_path: Path) -> None:
    """env 阈值生效：_threshold_from_env 解析 SCAN_DRIFT_COMMIT_THRESHOLD。"""
    assert sdk._threshold_from_env({}) == 50
    assert sdk._threshold_from_env({"SCAN_DRIFT_COMMIT_THRESHOLD": "0"}) == 0
    assert sdk._threshold_from_env({"SCAN_DRIFT_COMMIT_THRESHOLD": "100"}) == 100
    # 非法值回退默认。
    assert sdk._threshold_from_env({"SCAN_DRIFT_COMMIT_THRESHOLD": "abc"}) == 50
    # 负值回退默认。
    assert sdk._threshold_from_env({"SCAN_DRIFT_COMMIT_THRESHOLD": "-5"}) == 50


def test_check_drift_empty_dir(tmp_path: Path) -> None:
    """scan_dir 无 *.md → 空报告，不崩。"""
    _make_git_repo(tmp_path)
    scan = tmp_path / "scan"
    scan.mkdir()
    report = sdk.check_drift(scan, threshold=50)
    assert report.total_docs == 0
    assert report.total_drifted == 0


def test_check_drift_nonexistent_dir(tmp_path: Path) -> None:
    """scan_dir 不存在 → 空报告，不崩。"""
    _make_git_repo(tmp_path)
    report = sdk.check_drift(tmp_path / "nope", threshold=50)
    assert report.total_docs == 0
