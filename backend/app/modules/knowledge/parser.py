"""Filesystem parser for ``.sillyspec/knowledge/`` and ``.sillyspec/quicklog/`` directories."""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

MAX_CONTENT_BYTES = 1_000_000

# knowledge zone 子目录段（sillyspec CLI zone 口径）。filename 首段命中其一即归
# 对应 zone，其余（含顶层裸文件名）一律归 ``top``。见 change
# 2026-09-17-knowledge-precipitation design D-004@v1。
ZONE_SUBDIRS: frozenset[str] = frozenset({"decisions", "generated", "proposed"})

#: 顶层 zone 值（非 decisions/generated/proposed 子目录的条目统一归此）。
ZONE_TOP: str = "top"


def _derive_zone(filename: str) -> str:
    """由（可含子目录段的）filename 首段派生 zone。

    ``decisions/daemon.md`` → ``decisions``；``INDEX.md`` → ``top``。
    """
    first = filename.split("/", 1)[0]
    return first if first in ZONE_SUBDIRS else ZONE_TOP


@dataclass
class ParsedEntry:
    filename: str
    path: str
    title: str | None = None
    content: str | None = None
    last_modified_at: datetime | None = None
    # "top" | "decisions" | "generated" | "proposed"（knowledge 递归解析时由
    # filename 首段派生；quicklog 恒为 top，DTO 不透出）。
    zone: str = ZONE_TOP


def _extract_title(content: str) -> str | None:
    for line in content.splitlines():
        stripped = line.strip()
        if stripped.startswith("#"):
            return stripped.lstrip("# ").strip() or None
    return None


def _read_file_safe(path: Path) -> tuple[str, bool]:
    size = path.stat().st_size
    if size > MAX_CONTENT_BYTES:
        # 超大文件只读取前 MAX_CONTENT_BYTES // 4 字节，避免整文件读入内存（OOM 防护）。
        limit = MAX_CONTENT_BYTES // 4
        with path.open("rb") as f:
            raw = f.read(limit)
        return raw.decode("utf-8", errors="replace"), True
    return path.read_text(encoding="utf-8", errors="replace"), False


def parse_md_directory(
    directory: Path,
    sillyspec_root: Path,
    rel_prefix: str,
    *,
    recursive: bool = False,
) -> list[ParsedEntry]:
    """Parse all ``*.md`` files in a directory, sorted by name.

    change 2026-09-17-knowledge-precipitation task-01 / D-004@v1：
    ``recursive=True`` 时改用 ``rglob`` 递归扫子目录（knowledge zone 化），
    ``filename`` 扩展为相对 ``directory`` 的正斜杠路径（含子目录段，如
    ``decisions/daemon.md``，顶层条目值不变），``path`` 以 ``rel_prefix`` 拼
    完整相对路径；默认 ``False`` 维持 quicklog 的顶层非递归语义（零改动）。
    """
    if not directory.is_dir():
        return []

    md_files = sorted(directory.rglob("*.md") if recursive else directory.glob("*.md"))
    entries: list[ParsedEntry] = []
    for md_file in md_files:
        try:
            resolved = md_file.resolve()
            if not str(resolved).startswith(str(sillyspec_root.resolve())):
                continue
        except (OSError, ValueError):
            continue

        if not md_file.is_file():
            continue

        try:
            content, _ = _read_file_safe(md_file)
        except OSError:
            continue

        rel_name = md_file.relative_to(directory).as_posix() if recursive else md_file.name
        rel_path = f"{rel_prefix}/{rel_name}"
        title = _extract_title(content)
        try:
            mtime = datetime.fromtimestamp(md_file.stat().st_mtime, tz=UTC)
        except OSError:
            mtime = None

        entries.append(
            ParsedEntry(
                filename=rel_name,
                path=rel_path,
                title=title,
                content=content,
                last_modified_at=mtime,
                zone=_derive_zone(rel_name),
            )
        )

    return entries


class KnowledgeParser:
    """Parses ``.sillyspec/knowledge/`` and ``.sillyspec/quicklog/`` directories."""

    def parse_knowledge(self, sillyspec_root: Path) -> list[ParsedEntry]:
        # task-01 / D-004@v1：knowledge 递归扫子目录（decisions/generated/proposed
        # zone 对网页可见），filename/path 含子目录段、顶层条目值逐字不变。
        return parse_md_directory(
            sillyspec_root / "knowledge", sillyspec_root, ".sillyspec/knowledge", recursive=True
        )

    def parse_quicklog(self, sillyspec_root: Path) -> list[ParsedEntry]:
        # quicklog 解析零改动（顶层非递归）。
        return parse_md_directory(
            sillyspec_root / "quicklog", sillyspec_root, ".sillyspec/quicklog"
        )


# ── quicklog 条目级解析（quick-2dba0118 沉淀弹层三修之一）─────────────────────
#
# quicklog 的真实形态是**单文件多条目**：QUICKLOG-*.md 内以 ``## ql-YYYYMMDD-NNN-
# <suffix> | 日期 | 标题`` 节头逐条追加（服务器实证，CLI sillyspec run quick 的
# 落盘形态）。既有 parse_quicklog 按「一文件一条目」返回文件列表（GET /quicklog
# 的消费者零改动），蒸馏多选/校验需要的**条目级**视图由本节提供。


#: ql 条目节头正则（sillyspec CLI 固定形态）：三段 `## <ref> | <日期> | <标题>`。
#: 旧式无后缀（``ql-20260706-003``）/ 两段头 / 非 ql 节头一律不匹配（自然跳过）。
QUICK_ENTRY_HEADER_RE = re.compile(r"^## (ql-\d{8}-\d{3}-[a-z0-9]+) \| ([^|]+) \| (.+)$")


@dataclass
class QuickEntry:
    """quicklog 单文件内的一条 ql 条目（蒸馏 quick 源多选/校验的单位）。"""

    #: 条目自然键短码（``ql-YYYYMMDD-NNN-<suffix>``），即 DistillDispatchIn.source_ref 元素。
    ref: str
    #: 节头第三段的条目标题。
    title: str
    #: 节头第二段的记录时间（原样字符串，如 ``2026-09-20 18:30:19``）。
    date: str


def parse_quick_entries(sillyspec_root: Path) -> list[QuickEntry]:
    """扫 ``quicklog/QUICKLOG-*.md`` 提取条目级 ql 列表（最新在前）。

    - 文件名匹配**大小写容忍**（``QUICKLOG-*.md`` / ``quicklog-*.md`` 同收），
      仅顶层（不递归子目录，与 parse_quicklog 顶层语义一致）；
    - 按 ref 去重——同一 ql-id 可能同时出现在轮转文件与当前文件（复制留档），
      保留文件名倒序（较新文件）先见到的副本；
    - ref 形如 ``ql-YYYYMMDD-NNN-<suffix>``，字典序即时间序，结果按 ref 倒序
      = 最新条目在前（弹层选择器默认最新置顶）。

    目录不存在 / 文件不可读（OSError）静默跳过（对齐 parse_md_directory 口径）。
    """
    quicklog_dir = sillyspec_root / "quicklog"
    if not quicklog_dir.is_dir():
        return []

    md_files = sorted(
        (
            p
            for p in quicklog_dir.iterdir()
            if p.name.lower().startswith("quicklog-") and p.name.lower().endswith(".md")
        ),
        key=lambda p: p.name,
        reverse=True,
    )
    entries: list[QuickEntry] = []
    seen: set[str] = set()
    for md_file in md_files:
        if not md_file.is_file():
            continue
        try:
            content, _ = _read_file_safe(md_file)
        except OSError:
            continue
        for line in content.splitlines():
            match = QUICK_ENTRY_HEADER_RE.match(line)
            if match is None:
                continue
            ref = match.group(1)
            if ref in seen:
                continue
            seen.add(ref)
            entries.append(
                QuickEntry(ref=ref, title=match.group(3).strip(), date=match.group(2).strip())
            )
    entries.sort(key=lambda e: e.ref, reverse=True)
    return entries
