"""QUICKLOG 条目级解析器（design FR-01 / §5.2 / D-007）。

扫描 ``<spec_root>/quicklog/QUICKLOG-*.md`` 全目录（聚合 + 按天轮转文件条目独立，
实测零重叠，文件名日期=轮转日非条目日——必须全目录扫描），按 ``## ql-`` 块切分
条目并解析字段。真实样本形态（2026-08-16 实查 10 文件 ~500 条）：

- 全部 CRLF 行尾——统一剥 ``\\r``，不剥则标签匹配恒失败（Grill 修正项）。
- 标签冒号全角/半角混用（``根因：`` 与 ``方案:`` 并存）→ ``[：:]`` 兼容。
- 状态行 4 形态：``已完成`` / ``已完成（…带括注）`` / ``已暂存（…）`` / ``进行中``；
  块内多条状态行取**最后一条**（历史 bug 残留，实测 4 例）。
- 文件行两形态：单行逗号/顿号/加号/分号分隔，或多行 ``- path（括注）`` bullet。
  bullet 括注全角为主，半角样本 path 内含 ``(dashboard)``（嵌套陷阱：括注只认
  行尾配对段，半角额外要求前置空白）。
- 空壳占位条目（标题=``(quick 任务)``）→ ``placeholder=True``（D-007 独立标记）。
- ``关联变更`` 值含自由文本（``backend-monitoring`` / ``（无）`` 等），白名单正则
  ``^\\d{4}-\\d{2}-\\d{2}-`` 过滤后才进列表（防反向区块跳转 404）。
- 未知行归 ``body_sections["_free"]``（宽松解析不丢数据，R-01）。

stale（进行中>24h）依赖当前时间，**查询时**在 service 层派生（D-005 不入库/不固化），
本解析器只输出 3 原始态：completed / partial_done / in_progress。

进程级缓存对齐 ``parser._MODULE_MAP_CACHE`` 模式：键=(目录 resolved 路径, 全部文件
(name, mtime) 指纹)，值不可变，命中回 deepcopy（调用方 mutate 不污染缓存）。
"""

from __future__ import annotations

import copy
import re
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from app.modules.knowledge.parser import MAX_CONTENT_BYTES

# 文件名 → author_raw：QUICKLOG-qinyi.md → qinyi；QUICKLOG-qinyi-2026-08-12.md → qinyi
_AUTHOR_RE = re.compile(r"^QUICKLOG-(.+?)(?:-\d{4}-\d{2}-\d{2})?\.md$", re.IGNORECASE)
# 块头：## ql-20260812-007-d086 | 2026-08-12 20:43:59 | 标题
_HEADER_RE = re.compile(r"^##\s+(ql-[^\s|]+)\s*\|\s*([0-9:\- ]+?)\s*\|\s*(.+)$")
# 标签行（全半角冒号兼容）
_LABEL_RE = re.compile(r"^(状态|关联变更|文件|需求|根因|方案|结果)\s*[：:]\s*(.*)$")
# 单行文件分隔符：逗号(全半角)/顿号/加号/分号(全半角)——实测 5 种形态
_PATH_SEP_RE = re.compile(r"[，,、+；;]")
# linked_changes 白名单：日期前缀 change 名（2026-08-16-change-owner-from-token）
_CHANGE_NAME_RE = re.compile(r"^\d{4}-\d{2}-\d{2}-")
# 行尾全角括注（贪婪，容忍内嵌半角括号：补7个安全分支测试(revoked...)）
_NOTE_FULLWIDTH_RE = re.compile(r"（(.+)）$")
# 行尾半角括注：要求前置空白，避免把路径中间的 (dashboard) 误判为括注
_NOTE_HALFWIDTH_RE = re.compile(r"\s\((.+)\)$")
_PLACEHOLDER_TITLE = "(quick 任务)"
# 状态前缀 → 3 原始态（stale 查询时派生）
_STATUS_PREFIXES = (
    ("已完成", "completed"),
    ("已暂存", "partial_done"),
    ("进行中", "in_progress"),
)

_QUICKLOG_CACHE: dict[tuple[str, tuple[tuple[str, float], ...]], list[QuicklogFileEntry]] = {}


@dataclass(frozen=True)
class QuicklogFileRef:
    """文件行条目：path + 可选括注（design §5.1 ``files: list[{path, note|None}]``）。"""

    path: str
    note: str | None = None


@dataclass(frozen=True)
class QuicklogFileEntry:
    """单条 quicklog 条目（文件解析源；PG 推送源同构，见 design §5.1 DTO）。

    ``source`` 由合并层标记（pushed/file），解析器恒产 file 源字段之外的结构。
    """

    ql_id: str
    timestamp: datetime | None
    title: str
    status: str  # completed | partial_done | in_progress（stale 查询时派生）
    status_note: str | None = None
    placeholder: bool = False
    author_raw: str = ""
    linked_changes: list[str] = field(default_factory=list)
    files: list[QuicklogFileRef] = field(default_factory=list)
    body_sections: dict[str, str] = field(default_factory=dict)  # 需求/根因/方案/结果/_free
    raw_block: str = ""
    source_file: str = ""
    truncated: bool = False  # 来源文件超 1MB 截断（design §7）


def parse_quicklog_directory(quicklog_dir: Path) -> list[QuicklogFileEntry]:
    """解析 quicklog 目录全部 ``QUICKLOG-*.md``（缺目录返回空列表，design §7）。

    带 (name, mtime) 指纹进程缓存；目录不可读按空处理（不抛——展示链路兜底语义）。
    """
    quicklog_dir = quicklog_dir.resolve()
    if not quicklog_dir.is_dir():
        return []

    try:
        fingerprint = tuple(
            sorted((f.name, f.stat().st_mtime) for f in quicklog_dir.iterdir() if f.is_file())
        )
    except OSError:
        return []

    cache_key = (str(quicklog_dir), fingerprint)
    cached = _QUICKLOG_CACHE.get(cache_key)
    if cached is not None:
        return copy.deepcopy(cached)

    entries: list[QuicklogFileEntry] = []
    for name, _mtime in fingerprint:
        if not re.match(r"^QUICKLOG-.*\.md$", name, re.IGNORECASE):
            continue
        author_match = _AUTHOR_RE.match(name)
        author_raw = author_match.group(1) if author_match else name
        entries.extend(_parse_file(quicklog_dir / name, author_raw))

    _QUICKLOG_CACHE[cache_key] = entries
    # 清同目录旧指纹条目，防缓存无界增长（对齐 _MODULE_MAP_CACHE 收敛策略）
    stale_keys = [k for k in _QUICKLOG_CACHE if k[0] == cache_key[0] and k[1] != cache_key[1]]
    for k in stale_keys:
        _QUICKLOG_CACHE.pop(k, None)
    return copy.deepcopy(entries)


def _parse_file(path: Path, author_raw: str) -> list[QuicklogFileEntry]:
    """解析单个 QUICKLOG 文件：剥 CRLF → 按 ``## ql-`` 块切分 → 逐块解析字段。"""
    try:
        size = path.stat().st_size
        with path.open("rb") as fh:
            raw = fh.read(MAX_CONTENT_BYTES)
    except OSError:
        return []
    truncated = size > len(raw)
    # 对齐 knowledge parser：超限只保留前 1/4，防整文件读入内存（OOM 防护）
    if truncated:
        raw = raw[: MAX_CONTENT_BYTES // 4]
    text = raw.decode("utf-8", errors="replace")

    entries: list[QuicklogFileEntry] = []
    blocks = _split_blocks(text)
    for header, block_lines in blocks:
        entry = _parse_block(header, block_lines, author_raw, path.name, truncated)
        if entry is not None:
            entries.append(entry)
    return entries


def _split_blocks(text: str) -> list[tuple[str, list[str]]]:
    """按 ``## ql-`` 行切块，返回 (块头行, 块内行列表)；剥 ``\\r`` 统一 LF 语义。"""
    blocks: list[tuple[str, list[str]]] = []
    current_header: str | None = None
    current_lines: list[str] = []
    for line in text.split("\n"):
        line = line.rstrip("\r")
        if line.startswith("## ") and _HEADER_RE.match(line):
            if current_header is not None:
                blocks.append((current_header, current_lines))
            current_header = line
            current_lines = []
        elif current_header is not None:
            current_lines.append(line)
    if current_header is not None:
        blocks.append((current_header, current_lines))
    return blocks


def _parse_block(
    header: str, lines: list[str], author_raw: str, source_file: str, truncated: bool
) -> QuicklogFileEntry | None:
    header_match = _HEADER_RE.match(header)
    if header_match is None:
        return None
    ql_id, ts_raw, title = header_match.group(1), header_match.group(2), header_match.group(3)

    timestamp: datetime | None = None
    try:
        timestamp = datetime.strptime(ts_raw.strip(), "%Y-%m-%d %H:%M:%S")
    except ValueError:
        timestamp = None

    status = "in_progress"  # 缺状态行的块保守视为进行中（查询层可据时间派生 stale）
    status_note: str | None = None
    linked_raw: list[str] = []
    files_raw: list[str] = []
    files_bullet: list[str] = []
    body: dict[str, list[str]] = {}
    free_lines: list[str] = []
    current_section: str | None = None  # 文件标签后连续 bullet 归文件清单
    last_body_label: str | None = None  # 最近一次命中的正文标签（接续行归属）
    last_status_value: str | None = None

    for line in lines:
        stripped = line.strip()
        if not stripped:
            current_section = None
            continue
        label_match = _LABEL_RE.match(stripped)
        if label_match is not None:
            label, value = label_match.group(1), label_match.group(2).strip()
            if label == "状态":
                # 多条状态行取最后一条（历史 bug 残留形态，design §5.2）
                last_status_value = value
            elif label == "关联变更":
                linked_raw.append(value)
                current_section = "linked"
            elif label == "文件":
                if value:
                    files_raw.append(value)
                current_section = "files"
            else:
                body.setdefault(label, []).append(value)
                last_body_label = label
                current_section = "body"
            continue
        if stripped.startswith("- ") and current_section == "files":
            files_bullet.append(stripped[2:].strip())
            continue
        if stripped.startswith("- ") and current_section == "linked":
            linked_raw.append(stripped[2:].strip())
            continue
        # 未匹配行归正文自由段（design §5.2 宽松解析）；接续段落保持段归属
        if current_section == "body" and last_body_label is not None:
            body[last_body_label].append(stripped)
        else:
            free_lines.append(stripped)
            current_section = None

    if last_status_value is not None:
        status, status_note = _parse_status(last_status_value)

    files = _parse_files(files_raw, files_bullet)
    linked_changes = _parse_linked_changes(linked_raw)

    sections = {k: "\n".join(v).strip() for k, v in body.items() if v}
    if free_lines:
        sections["_free"] = "\n".join(free_lines).strip()

    return QuicklogFileEntry(
        ql_id=ql_id,
        timestamp=timestamp,
        title=title.strip(),
        status=status,
        status_note=status_note,
        placeholder=title.strip() == _PLACEHOLDER_TITLE,
        author_raw=author_raw,
        linked_changes=linked_changes,
        files=files,
        body_sections=sections,
        raw_block=header + "\n" + "\n".join(lines),
        source_file=source_file,
        truncated=truncated,
    )


def _parse_status(value: str) -> tuple[str, str | None]:
    """状态值前缀匹配再提括注（FR-08）：``已完成（commit x）`` → (completed, "commit x")。"""
    for prefix, status in _STATUS_PREFIXES:
        if value.startswith(prefix):
            rest = value[len(prefix) :].strip()
            _, note = _extract_note(rest) if rest else ("", None)
            return status, note
    # 未知状态值保守视为进行中（原文在 raw_block 可查）
    return "in_progress", None


def _parse_files(single_line_values: list[str], bullets: list[str]) -> list[QuicklogFileRef]:
    """文件清单：单行多分隔符 + 多行 bullet 两形态合并（design §5.2）。

    单行样本分隔符 5 种：``,``/``，``/``、``/``+``/``；``/``;``（实测
    ``task/schema.py+service.py+router.py`` 等）。每项再提行尾括注。
    """
    refs: list[QuicklogFileRef] = []
    for value in single_line_values:
        for part in _PATH_SEP_RE.split(value):
            part = part.strip()
            if not part:
                continue
            refs.append(_make_file_ref(part))
    for bullet in bullets:
        refs.append(_make_file_ref(bullet))
    return refs


def _make_file_ref(part: str) -> QuicklogFileRef:
    path, note = _extract_note(part)
    return QuicklogFileRef(path=path, note=note)


def _extract_note(s: str) -> tuple[str, str | None]:
    """提取行尾括注：全角 ``path（note）`` 贪婪配对；半角 ``path (note)`` 需前置空白。

    半角前置空白要求防误判：真实路径含 ``.../(dashboard)/...`` 段（嵌套陷阱），
    括注段与路径之间有书写空格，路径内部括号紧贴 ``/``。
    """
    m = _NOTE_FULLWIDTH_RE.search(s)
    if m:
        return s[: m.start()].strip(), m.group(1).strip()
    m = _NOTE_HALFWIDTH_RE.search(s)
    if m:
        return s[: m.start()].strip(), m.group(1).strip()
    return s.strip(), None


def _parse_linked_changes(values: list[str]) -> list[str]:
    """白名单正则过滤关联变更（design §5.2）：日期前缀 change 名才进列表。"""
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        for part in _PATH_SEP_RE.split(value):
            part = part.strip()
            if not part or _CHANGE_NAME_RE.match(part) is None:
                continue
            if part not in seen:
                seen.add(part)
                result.append(part)
    return result
