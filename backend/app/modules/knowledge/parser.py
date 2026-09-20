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
# 2026-09-20-knowledge-effect-panel task-01 / D-005@v1：增 ``fr``（fr-index 归档
# 产物，随归档持续增长，独立「需求规则」zone）。
ZONE_SUBDIRS: frozenset[str] = frozenset({"decisions", "generated", "proposed", "fr"})

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
    # "top" | "decisions" | "generated" | "proposed" | "fr"（knowledge 递归解析时
    # 由 filename 首段派生；quicklog 恒为 top，DTO 不透出）。
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


# ── 条目全集 + 锚点 slug 归一化（2026-09-20-knowledge-effect-panel task-01）────
#
# stats 聚合的「条目全集」数据源：三类知识资产按各自天然粒度提取条目——
#   - 手册（顶层 *.md，**含 gotchas/uncategorized，INDEX.md 排除**——自带 ##
#     分类段防误计，design Wave 1 明确排除）：每 ``## 小节`` 一条；
#   - decisions/ 与 fr/：每 ``## D-xxx@vN <标题>`` / ``## FR-…-NNN <标题>``
#     条目一条（title=标题行去 ID 段；hits 实测决策/FR 命中为文件级锚点，
#     anchor=裸文件名，同文件全部条目共享一个锚——口径二分：有 # 为小节级、
#     无 # 为文件级，design 自审钉死）；
#   - generated/：文件级一条（anchor=裸文件名）。
# proposed/（待审候选）不计入条目全集。


#: 锚点 slug 归一化：保留小写字母/数字/下划线/中文/连字符，其余全去。
#: 与 :func:`slugify_anchor` 配套（空白先转 ``-`` 再去符号）。
_SLUG_DROP_RE = re.compile(r"[^0-9a-z_\u4e00-\u9fff-]+")
_WHITESPACE_RE = re.compile(r"\s")

#: decisions / fr 条目头的 ID 段（``## D-002@v1 标题`` / ``## FR-host-fs-handler-001
#: 标题``——FR 域名可含多段连字符，按段重复匹配到末尾 ``-NNN`` 序号）。
_ENTRY_ID_PREFIX_RE = re.compile(r"^(?:D-\d+@v\d+|FR-[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*-\d+)\s+")

#: ``## `` 小节头（恰两级：``### `` 因第三字符非空白天然不匹配）。
_H2_HEADING_RE = re.compile(r"^##\s+(.+?)\s*$")

#: frontmatter 围栏首行。
_FM_FENCE = "---"


def slugify_anchor(title: str) -> str:
    """手册小节标题 → CLI 注入侧 INDEX 锚点 slug（双端归一，救命项 Grill CLK-02）。

    复刻 sillyspec CLI 落盘锚点形态（hits ``matchedFiles`` 实测 62 锚点自校准）：

    1. 小写；
    2. **每个空白字符 → ``-``（不折叠 run、不去首尾）**——``无 --reload``
       实测锚 ``无---reload``（空格一个 ``-`` + 原文两个 ``-``）；
    3. 其余符号（括号/书名号/箭头/斜杠/点/emoji 等）**直接去除**——
       ``（Router/Service/Schema → BaseModel → AppError）`` 实测锚
       ``routerserviceschema--basemodel--apperror``（斜杠点无痕消失、
       `` → `` 去掉后两侧空格转的 ``-`` 留下成 ``--``）；
    4. 保留字母/数字/下划线（``item_id``）/中文/连字符；
    5. **不截断**（实测 72 字符锚 ``-frontend-react-query-…-29b3c86b`` 超 60）。

    注意与 ``stages/knowledge.js`` 的**文件名** slug（``[^\w\u4e00-\u9fff]+`` 折叠
    为单 ``-`` + 去首尾 + 截 60，writer._kebab_slug 同款）是两套规则——那套管
    generated/proposed 文件名，本函数管 INDEX/hits 锚点，勿混用。
    """
    s = title.strip().lower()
    s = _WHITESPACE_RE.sub("-", s)
    return _SLUG_DROP_RE.sub("", s)


def _iter_h2_titles(content: str) -> list[str]:
    """提取全部 ``##`` 小节标题原文（按出现序； fenced code block 内的假节头容忍——
    统计口径 R-03 容忍计数 misses，不做块级状态机）。"""
    return [m.group(1) for line in content.splitlines() if (m := _H2_HEADING_RE.match(line))]


def _parse_frontmatter_datetime(content: str) -> datetime | None:
    """frontmatter 里首个时间字段（``created_at`` 优先，``generated_at`` 兜底——
    generated/ 文件用 ``generated_at`` 键，2026-07 实测落盘形态）。

    值按 ISO 8601 解析（``2026-09-19T15:24:52.781Z`` 等）；无 frontmatter /
    无该键 / 值不可解析 → None（stats 侧落 hits 首见兜底）。手写解析不引
    python-frontmatter——只需要单键，避免 YAML 类型映射的不确定行为。
    """
    lines = content.splitlines()
    if not lines or lines[0].strip() != _FM_FENCE:
        return None
    found: str | None = None
    for line in lines[1:]:
        if line.strip() == _FM_FENCE:
            break
        key, sep, value = line.partition(":")
        if not sep:
            continue
        key = key.strip()
        if (key == "created_at" and found is None) or (key == "generated_at" and found is None):
            found = value.strip().strip("\"'")
    if not found:
        return None
    try:
        # fromisoformat 自 3.11 起认 ``Z`` 后缀；无时区字面量按 naive 拒绝转
        # aware 的需要——统一补 UTC，stats 侧与 occurred_at 同域比较。
        parsed = datetime.fromisoformat(found)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed


@dataclass
class KnowledgeEntryInfo:
    """stats 条目全集的单条知识条目（parser → HitsService.stats 消费）。

    ``anchor``：与 hits ``matchedFiles`` 同域的匹配键——手册为
    ``文件#slug``（:func:`slugify_anchor` 归一），decisions/fr/generated 为
    裸文件名（文件级命中，实测零跨形态混存）。
    """

    anchor: str
    file: str
    zone: str
    title: str
    created_at: datetime | None = None


def _strip_entry_id(heading: str) -> str:
    """decisions/fr 条目标题去 ID 段（``D-002@v1 标题`` → ``标题``）。

    纯 ID 无标题（``## D-002@v1``）时标题回落为 ID 本身（条目仍可数）。
    """
    stripped = _ENTRY_ID_PREFIX_RE.sub("", heading)
    return stripped or heading


def parse_knowledge_entries(sillyspec_root: Path) -> list[KnowledgeEntryInfo]:
    """扫 ``knowledge/`` 提取 stats 条目全集（三类资产、各自天然粒度）。

    目录不存在 / 文件不可读（OSError）静默跳过（对齐 parse_md_directory
    口径）；symlink 逃逸目录树同样拒收。INDEX.md 在**任何 zone** 都排除
    （导航页自带 ## 段，防误计——top 的路由目录与 generated/INDEX.md 同理）。
    """
    knowledge_dir = sillyspec_root / "knowledge"
    if not knowledge_dir.is_dir():
        return []

    entries: list[KnowledgeEntryInfo] = []
    for md_file in sorted(knowledge_dir.rglob("*.md")):
        if md_file.name == "INDEX.md":
            continue
        try:
            resolved = md_file.resolve()
            if not str(resolved).startswith(str(knowledge_dir.resolve())):
                continue
        except (OSError, ValueError):
            continue
        if not md_file.is_file():
            continue
        try:
            content, _ = _read_file_safe(md_file)
        except OSError:
            continue

        rel = md_file.relative_to(knowledge_dir).as_posix()
        zone = _derive_zone(rel)
        created_at = _parse_frontmatter_datetime(content)

        if zone == ZONE_TOP:
            # 手册：每 ## 小节一条，anchor=文件#slug。
            for title in _iter_h2_titles(content):
                entries.append(
                    KnowledgeEntryInfo(
                        anchor=f"{rel}#{slugify_anchor(title)}",
                        file=rel,
                        zone=zone,
                        title=title,
                        created_at=created_at,
                    )
                )
        elif zone in ("decisions", "fr"):
            # 决策/FR：每 ## 条目一条，anchor=裸文件名（文件级命中形态）。
            for heading in _iter_h2_titles(content):
                entries.append(
                    KnowledgeEntryInfo(
                        anchor=rel,
                        file=rel,
                        zone=zone,
                        title=_strip_entry_id(heading),
                        created_at=created_at,
                    )
                )
        elif zone == "generated":
            # 生成物：文件级一条。
            entries.append(
                KnowledgeEntryInfo(
                    anchor=rel,
                    file=rel,
                    zone=zone,
                    title=_extract_title(content) or rel,
                    created_at=created_at,
                )
            )
        # proposed/（待审候选）不入条目全集。
    return entries
