#!/usr/bin/env python3
"""回填变更的 git conventional 提交类型（2026-10-18-change-type-git-conventional）。

平台变更详情页「类型」行想要 git 惯用前缀式语义分类（feat/fix/docs/...），但语义
类型只存在于本机 git 提交信息（平台无 git 历史）。本脚本把每个变更的主提交类型
写入其 flow-state.yaml 顶层 ``commit_type:`` 字段——平台 reparse 将其作为权威类型源
（backend parser._read_flow_state_commit_type，允许覆盖库中旧值）。

归属规则（防跨变更引用误判）：
- 提交信息里常引用其它变更 key（如评审出处），因此按「信息中**最后一个**形如
  YYYY-MM-DD-<slug> 的 key」归属，不按「出现过即归属」；
- chore(archive)（归档留档提交）不参与主类型判定；
- 主类型按优先级取：feat/fix > perf/refactor/test > docs/style > build/ci/chore
  > 其它（一个变更常有 docs(spec)/chore(archive) 工件提交，功能提交优先）。

写入规则（幂等、最小 diff）：
- 顶层已有 ``commit_type:`` 行 → 原位替换；值相同则不写（防 mtime churn）；
- 无该行 → 文件末尾追加一行；
- 仅**归档**变更允许新建最小 flow-state.yaml（只含该字段）——active 变更新建该
  文件会被 parser._infer_current_stage 误判 thin，绝对禁止。

用法（主仓库根目录）：
  python scripts/backfill_commit_type.py            # 回填（含统计输出）
  python scripts/backfill_commit_type.py --dry-run  # 只看会写什么，不落盘

写入后需等 sillyspec 自动同步（或手动触发）+ 平台「重新扫描」reparse 方在界面生效。
"""

from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

# conventional 前缀：type 或 type(scope)，后接可选 ! 与冒号
_TYPE_RE = re.compile(r"^\s*([A-Za-z]+)(?:\([^)]*\))?!?:\s")
# 类型白名单：非 conventional「伪前缀」不认（实证坑：CLI 基线检查点提交
# 「sillyspec: baseline checkpoint for <key> …」的 sillyspec: 会撞前缀正则）
_KNOWN_TYPES = {
    "feat",
    "fix",
    "perf",
    "refactor",
    "test",
    "docs",
    "style",
    "build",
    "ci",
    "chore",
    "revert",
}
# 变更 key 形态：YYYY-MM-DD-slug
_KEY_RE = re.compile(r"\d{4}-\d{2}-\d{2}-[A-Za-z0-9][A-Za-z0-9.-]*")
# 主类型优先级（未知类型不进优先级表——白名单外直接不参与归属）
_TYPE_PRIORITY = [
    "feat",
    "fix",
    "perf",
    "refactor",
    "test",
    "docs",
    "style",
    "build",
    "ci",
    "chore",
    "revert",
]
# 归档留档提交（chore(archive): <key> 归档留档）不参与主类型
_ARCHIVE_PREFIX = "chore(archive)"


def git_subjects(repo_root: Path) -> list[str]:
    """一次取全量提交 subject（--all 含已归档分支历史）。"""
    out = subprocess.run(
        ["git", "-C", str(repo_root), "log", "--all", "--format=%s"],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=True,
    )
    return [line for line in out.stdout.splitlines() if line.strip()]


def subject_main_key(subject: str) -> str | None:
    """提交归属的变更 key = 信息中最后一个 key 形态 token（跨变更引用出现在正文前部）。"""
    keys = _KEY_RE.findall(subject)
    return keys[-1] if keys else None


def subject_type(subject: str) -> str | None:
    m = _TYPE_RE.match(subject)
    if m is None:
        return None
    t = m.group(1).lower()
    return t if t in _KNOWN_TYPES else None


def type_rank(t: str) -> tuple[int, int]:
    """白名单内按优先级表排序键（min() 消费；表外值不会进入——白名单前置过滤）。"""
    return (0, _TYPE_PRIORITY.index(t))


def collect_change_types(subjects: list[str]) -> dict[str, list[str]]:
    """key → 按出现顺序的 conventional 类型列表（已排除归档留档提交）。"""
    by_key: dict[str, list[str]] = {}
    for subject in subjects:
        if subject.startswith(_ARCHIVE_PREFIX):
            continue
        key = subject_main_key(subject)
        t = subject_type(subject)
        if key is None or t is None:
            continue
        by_key.setdefault(key, []).append(t)
    return by_key


def pick_main_type(types: list[str]) -> str | None:
    """优先级取主类型（feat/fix 优先于 docs/chore 工件提交）。"""
    if not types:
        return None
    return min(types, key=type_rank)


def write_commit_type(change_dir: Path, value: str, *, dry_run: bool) -> str:
    """幂等写入 flow-state.yaml 顶层 commit_type（行存在替换 / 缺则末尾追加）。

    Returns:
        动作描述：wrote / replaced / unchanged / created（dry_run 时前缀 [dry]）。
    """
    path = change_dir / "flow-state.yaml"
    line = f"commit_type: {value}"
    if path.is_file():
        # newline=''：原样保留行尾（LF/CRLF），防整文件行尾翻转造成同步 diff 噪音
        with open(path, "r", encoding="utf-8", newline="") as f:
            raw = f.read()
        lines = raw.splitlines(keepends=True)
        for i, existing in enumerate(lines):
            if existing.startswith("commit_type:"):
                if existing.rstrip("\r\n") == line:
                    return "unchanged"
                if not dry_run:
                    eol = existing[len(existing.rstrip("\r\n")) :] or "\n"
                    lines[i] = line + eol
                    with open(path, "w", encoding="utf-8", newline="") as f:
                        f.write("".join(lines))
                return "replaced"
        if not dry_run:
            with_sep = raw if raw.endswith("\n") or raw == "" else raw + "\n"
            with open(path, "w", encoding="utf-8", newline="") as f:
                f.write(with_sep + line + "\n")
        return "appended"
    if not dry_run:
        with open(path, "w", encoding="utf-8", newline="") as f:
            f.write(line + "\n")
    return "created"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--dry-run", action="store_true", help="只打印计划写入，不落盘")
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    changes_root = repo_root / ".sillyspec" / "changes"

    subjects = git_subjects(repo_root)
    by_key = collect_change_types(subjects)

    stats: dict[str, int] = {}
    rows: list[tuple[str, str, str]] = []  # (change_key, main_type, action)

    # 候选 = 归档区 + 活跃区全部变更目录
    candidates: list[Path] = []
    archive_root = changes_root / "archive"
    if archive_root.is_dir():
        candidates.extend(sorted(p for p in archive_root.iterdir() if p.is_dir()))
    if changes_root.is_dir():
        candidates.extend(
            sorted(
                p for p in changes_root.iterdir() if p.is_dir() and p.name != "archive"
            )
        )

    for change_dir in candidates:
        key = change_dir.name
        types = by_key.get(key, [])
        main_type = pick_main_type(types)
        if main_type is None:
            stats["no_match"] = stats.get("no_match", 0) + 1
            continue
        is_archived = archive_root in change_dir.parents
        has_flow_state = (change_dir / "flow-state.yaml").is_file()
        # 守卫：active 变更禁止新建 flow-state.yaml（_infer_current_stage 会误判 thin）
        if not has_flow_state and not is_archived:
            stats["skipped_active_no_flowstate"] = (
                stats.get("skipped_active_no_flowstate", 0) + 1
            )
            continue
        action = write_commit_type(change_dir, main_type, dry_run=args.dry_run)
        stats[action if action != "unchanged" else "unchanged"] = (
            stats.get(action if action != "unchanged" else "unchanged", 0) + 1
        )
        if action != "unchanged":
            rows.append((key, main_type, action))

    prefix = "[dry] " if args.dry_run else ""
    for key, t, action in rows:
        print(f"{prefix}{action:9s} {key} -> {t}")
    print(
        f"\n汇总：提交 {len(subjects)} 条，变更候选 {len(candidates)} 个，"
        + "，".join(f"{k}={v}" for k, v in sorted(stats.items()))
    )
    print("提示：写入后需 sillyspec 同步 + 平台「重新扫描」reparse 方在界面生效。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
