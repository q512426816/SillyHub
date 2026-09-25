"""变更沉淀资产聚合只读服务（2026-09-25-change-precipitated-assets FR-01/02）。

按变更名聚合「本变更经归档沉淀的项目资产」（D-001@v1 方案 a——服务端解析
spec 树镜像；CLI 侧无结构化查询命令、前端自行解析有 N+1 与契约双端漂移，
两路均经核对证伪排除）：

- FR 索引条目：``knowledge/fr/*.md`` 节头 ``## FR-<域>-NNN 标题`` 分条，
  节内 ``变更：<change_key>`` 行命中才收录（fr/decisions 均可能散落多个
  域文件，全扫聚合，量级 40+20 个小文件无压力）；
- 决策蒸馏条目：``knowledge/decisions/*.md`` 同构（``## D-NNN@N 标题``；
  无「变更：」行的条目跳过——CLI 容错面）；
- 测试绑定：归档变更目录 ``test-trace.json`` 直读（文件本身 per-change）；
- patch 留档：``change-patch.json`` 存在才读（存量归档无此件 → None 容错，
  该留档是 CLI 晚于多数归档的新功能）；
- delta 摘要：``delta.md`` 标题行 + ``## Before``/``## Delta`` 段行数。

镜像根获取对齐 ``knowledge/service.py::_spec_content_root`` 先例、变更目录
解析复用 ``ChangeService._resolve_change_dir``（含 archive 段，对齐
reparse 的 sillyspec_root 解析）；文件读全部经 ``asyncio.to_thread``。
逐项 fail-open：单项解析失败降级为空（展示面，不影响变更详情主功能）；
在途变更（未归档）跳过目录件读取（design R-03）。
"""

from __future__ import annotations

import asyncio
import json
import re
import uuid
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ChangeNotFound
from app.core.logging import get_logger
from app.modules.change.model import Change
from app.modules.change.schema import (
    ChangeAssetsRead,
    ChangeDecisionEntry,
    ChangeDeltaMeta,
    ChangeFrEntry,
    ChangePatchMeta,
    ChangeTestRow,
)

log = get_logger(__name__)

# CLI fr-index / decision-distill 机械契约的最小子集（只读，勿在此扩语义——
# 上游格式演进时本层同步，D-001@v1 故障面；未知行一律跳过）。
_ENTRY_HEAD_RE = re.compile(r"^##\s+(FR-\S+|D-\d+@v\d+)\s+(.+)$")
_OWNER_LINE_RE = re.compile(r"^变更：(.+)$")
_STATUS_LINE_RE = re.compile(r"^状态：(\S+)")


def _parse_entries_owned_by(text: str, change_key: str) -> list[tuple[str, str, str | None]]:
    """解析域文件条目（节头分条 + ``变更：`` 行归属过滤）。

    返回 ``(id, title, status)`` 三元组列表；status 行缺省 None（fr 条目
    恒有、decisions 个别条目无——对齐 CLI 两文件的现实容差）。
    """
    entries: list[tuple[str, str, str | None]] = []
    cur_id: str | None = None
    cur_title = ""
    owned = False
    cur_status: str | None = None
    for line in text.splitlines():
        head = _ENTRY_HEAD_RE.match(line)
        if head:
            if cur_id is not None and owned:
                entries.append((cur_id, cur_title, cur_status))
            cur_id = head.group(1)
            cur_title = head.group(2).strip()
            owned = False
            cur_status = None
            continue
        if cur_id is None:
            continue
        owner = _OWNER_LINE_RE.match(line)
        if owner:
            owned = owner.group(1).strip() == change_key
            continue
        if cur_status is None:
            status_match = _STATUS_LINE_RE.match(line)
            if status_match:
                cur_status = status_match.group(1)
    if cur_id is not None and owned:
        entries.append((cur_id, cur_title, cur_status))
    return entries


def _scan_domain_files(
    spec_root: Path, domain: str, change_key: str
) -> list[tuple[str, str, str | None, str]]:
    """扫 ``spec_root/knowledge/<domain>/*.md``，返回归属条目 ``(id,title,status,rel_file)``。"""
    out: list[tuple[str, str, str | None, str]] = []
    domain_dir = spec_root / "knowledge" / domain
    if not domain_dir.is_dir():
        return out
    for md in sorted(domain_dir.glob("*.md")):
        try:
            text = md.read_text(encoding="utf-8")
        except OSError as exc:
            log.warning("change.assets_read_domain_file_failed", file=str(md), error=str(exc))
            continue
        for entry_id, title, status in _parse_entries_owned_by(text, change_key):
            out.append((entry_id, title, status, md.relative_to(spec_root).as_posix()))
    return out


def _read_test_rows(change_dir: Path) -> list[ChangeTestRow]:
    """读 ``test-trace.json``（损坏/缺失 → 空列表，fail-open）。"""
    path = change_dir / "test-trace.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        log.info("change.assets_test_trace_unavailable", path=str(path), error=str(exc))
        return []
    rows: list[ChangeTestRow] = []
    for row in data.get("rows", []) if isinstance(data, dict) else []:
        if not isinstance(row, dict) or not row.get("row_id"):
            continue
        rows.append(
            ChangeTestRow(
                row_id=str(row["row_id"]),
                anchor=row.get("anchor"),
                tests=[str(t) for t in row.get("tests", []) if t],
                state=row.get("state"),
            )
        )
    return rows


def _read_patch_meta(change_dir: Path) -> ChangePatchMeta | None:
    """读 ``change-patch.json`` 的 totals 投影（存在才读 → 无此件 None）。"""
    path = change_dir / "change-patch.json"
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        log.info("change.assets_patch_unavailable", path=str(path), error=str(exc))
        return None
    if not isinstance(data, dict):
        return None
    totals = data.get("totals") or {}
    return ChangePatchMeta(
        files=totals.get("files"),
        additions=totals.get("additions"),
        deletions=totals.get("deletions"),
        patch_status=data.get("patchStatus"),
        saved_at=data.get("savedAt"),
    )


def _read_delta_meta(change_dir: Path) -> ChangeDeltaMeta | None:
    """读 ``delta.md`` 标题行 + Before/Delta 段行数（缺失 → None）。"""
    path = change_dir / "delta.md"
    try:
        text = path.read_text(encoding="utf-8")
    except OSError as exc:
        log.info("change.assets_delta_unavailable", path=str(path), error=str(exc))
        return None
    headline: str | None = None
    section: str | None = None
    before_lines = 0
    delta_lines = 0
    for line in text.splitlines():
        if line.startswith("# ") and headline is None:
            headline = line[2:].strip()
            continue
        if line.startswith("## "):
            name = line[3:].strip().lower()
            section = name if name in ("before", "delta") else None
            continue
        if section == "before" and line.strip():
            before_lines += 1
        elif section == "delta" and line.strip():
            delta_lines += 1
    if headline is None:
        return None
    return ChangeDeltaMeta(headline=headline, before_lines=before_lines, delta_lines=delta_lines)


class ChangeAssetsQueryService:
    """变更沉淀资产只读聚合服务（唯一数据源，对接 assets 端点）。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def get_change_assets(
        self, workspace_id: uuid.UUID, change_id: uuid.UUID
    ) -> ChangeAssetsRead:
        change = await self._get_change(workspace_id, change_id)
        spec_root = await self._spec_root(workspace_id)
        archived = change.location == "archive" or change.status == "archived"

        fr_rows, dec_rows = await asyncio.gather(
            asyncio.to_thread(_scan_domain_files, spec_root, "fr", change.change_key),
            asyncio.to_thread(_scan_domain_files, spec_root, "decisions", change.change_key),
        )
        result = ChangeAssetsRead(
            change_key=change.change_key,
            archived=archived,
            fr_entries=[ChangeFrEntry(id=i, title=t, status=s, file=f) for i, t, s, f in fr_rows],
            decisions=[
                ChangeDecisionEntry(id=i, title=t, status=s, file=f) for i, t, s, f in dec_rows
            ],
        )
        if not archived:
            # 在途变更：目录件尚不存在，跳过读取（design R-03）。
            return result

        change_dir = await self._resolve_change_dir(workspace_id, change)
        test_rows, patch, delta = await asyncio.gather(
            asyncio.to_thread(_read_test_rows, change_dir),
            asyncio.to_thread(_read_patch_meta, change_dir),
            asyncio.to_thread(_read_delta_meta, change_dir),
        )
        result.test_rows = test_rows
        result.patch = patch
        result.delta = delta
        return result

    async def _get_change(self, workspace_id: uuid.UUID, change_id: uuid.UUID) -> Change:
        res = await self._session.execute(
            select(Change).where(Change.id == change_id, Change.workspace_id == workspace_id)
        )
        change = res.scalar_one_or_none()
        if change is None:
            raise ChangeNotFound("变更不存在或不属于该工作区")
        return change

    async def _spec_root(self, workspace_id: uuid.UUID) -> Path:
        """镜像根解析（对齐 ``knowledge/service.py::_spec_content_root`` 先例）。"""
        try:
            from app.modules.spec_workspace.service import SpecWorkspaceService

            spec_ws = await SpecWorkspaceService(self._session).get(workspace_id)
            if spec_ws and spec_ws.spec_root:
                return Path(spec_ws.spec_root)
        except Exception as exc:
            log.warning(
                "change.assets_resolve_spec_root_failed",
                workspace_id=str(workspace_id),
                error=str(exc),
            )
        from app.modules.workspace.service import WorkspaceService

        workspace = await WorkspaceService(self._session).get(workspace_id)
        return Path(workspace.root_path) / ".sillyspec"

    async def _resolve_change_dir(self, workspace_id: uuid.UUID, change: Change) -> Path:
        """变更目录解析（对齐 ``ChangeService._resolve_change_dir`` 语义：spec_root / change.path）。"""
        spec_root = await self._spec_root(workspace_id)
        return spec_root / change.path
