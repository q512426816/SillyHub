"""deploy_records 只读扫描服务。

change 2026-10-14-deploy-release-notes（D-004@v1 / FR-02/03/04）：
遍历全部 workspace 的 root_path 下 ``docs/releases/*.md``，解析 YAML
frontmatter 元数据 + md 正文，聚合为列表/详情。容器内读宿主文件经
``workspace/service.py::_rewrite_path`` 的 host→container 路径改写
（与 WorkspaceService.scan 同款机制）。

frontmatter 契约（skill 侧写入，三端共同遵守，见 design.md）：
必填 ``seq/deployed_at/status/summary/agent/commits``、可选
``commit_from/commit_to``；解析失败或必填缺失 → ``status=invalid``
容错条目（不炸列表）。
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from pathlib import Path

import yaml
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.modules.deploy_records.schema import DeployRecordDetail, DeployRecordSummary
from app.modules.workspace.model import Workspace
from app.modules.workspace.service import _rewrite_path

# 发布记录 md 在仓库内的固定目录（相对 workspace root_path）。
RELEASES_DIR = "docs/releases"

# frontmatter status 合法值（invalid 为服务端容错态，不出现在文件契约里）。
_VALID_STATUS = {"success", "failed"}

# 必填字段（缺失任一 → invalid）。
_REQUIRED_KEYS = ("seq", "deployed_at", "status", "summary", "agent", "commits")

# invalid 条目的固定摘要（用户链路中文文案）。
_INVALID_SUMMARY = "记录文件格式异常（frontmatter 缺失或不合规）"


class DeployRecordNotFound(AppError):
    """发布记录不存在（record_id 无匹配文件）。"""

    code = "deploy_record_not_found"
    http_status = 404


@dataclass
class _ParsedRecord:
    """单个 md 文件的解析产物（valid 与 invalid 统一形态）。"""

    file_name: str
    meta: dict | None
    content: str
    invalid: bool = False
    parse_error: str = ""
    # 解析期顺手校验的字段错误说明（invalid 时给前端/日志一个原因）
    notes: list[str] = field(default_factory=list)


def _parse_frontmatter(text: str) -> _ParsedRecord:
    """解析单个 md 文件：首个 ``---`` 对之间的 YAML 为元数据，其余为正文。

    契约校验失败（yaml 语法错 / 必填缺失 / 类型不符 / status 非法值）
    一律降级为 invalid——文件是 agent 手写的，坏文件不能炸整表（FR-04）。
    """
    lines = text.splitlines()
    file_name = ""
    # 由调用方补 file_name（dataclass 先建骨架）
    if not lines or lines[0].strip() != "---":
        return _ParsedRecord(
            file_name=file_name,
            meta=None,
            content=text,
            invalid=True,
            parse_error="missing frontmatter fence",
        )
    end = None
    for i in range(1, len(lines)):
        if lines[i].strip() == "---":
            end = i
            break
    if end is None:
        return _ParsedRecord(
            file_name=file_name,
            meta=None,
            content=text,
            invalid=True,
            parse_error="unterminated frontmatter fence",
        )
    raw_meta = "\n".join(lines[1:end])
    content = "\n".join(lines[end + 1 :]).lstrip("\n")
    try:
        meta = yaml.safe_load(raw_meta)
    except yaml.YAMLError as exc:
        return _ParsedRecord(
            file_name=file_name,
            meta=None,
            content=content,
            invalid=True,
            parse_error=f"yaml parse error: {exc.__class__.__name__}",
        )
    if not isinstance(meta, dict):
        return _ParsedRecord(
            file_name=file_name,
            meta=None,
            content=content,
            invalid=True,
            parse_error="frontmatter is not a mapping",
        )
    notes: list[str] = []
    for key in _REQUIRED_KEYS:
        if key not in meta:
            notes.append(f"missing key: {key}")
    if isinstance(meta.get("seq"), bool) or not isinstance(meta.get("seq"), int):
        notes.append("seq is not int")
    if meta.get("status") not in _VALID_STATUS:
        notes.append("status not in {success, failed}")
    if not isinstance(meta.get("commits"), list):
        notes.append("commits is not a list")
    for key in ("deployed_at", "summary", "agent"):
        if not isinstance(meta.get(key), str):
            notes.append(f"{key} is not str")
    if notes:
        return _ParsedRecord(
            file_name=file_name,
            meta=meta,
            content=content,
            invalid=True,
            parse_error="; ".join(notes),
        )
    return _ParsedRecord(file_name=file_name, meta=meta, content=content)


def _summary_from(
    ws_id: uuid.UUID, ws_name: str, file_name: str, parsed: _ParsedRecord
) -> DeployRecordSummary:
    """_ParsedRecord → DeployRecordSummary（invalid 态字段降级）。"""
    if parsed.invalid or parsed.meta is None:
        return DeployRecordSummary(
            record_id=f"{ws_id}/{Path(file_name).stem}",
            workspace_id=ws_id,
            workspace_name=ws_name,
            file_name=file_name,
            status="invalid",
            summary=_INVALID_SUMMARY,
        )
    meta = parsed.meta
    commits = meta.get("commits") or []
    return DeployRecordSummary(
        record_id=f"{ws_id}/{Path(file_name).stem}",
        workspace_id=ws_id,
        workspace_name=ws_name,
        file_name=file_name,
        seq=int(meta["seq"]),
        status=str(meta["status"]),
        deployed_at=str(meta["deployed_at"]),
        summary=str(meta["summary"]),
        commit_from=meta.get("commit_from"),
        commit_to=meta.get("commit_to"),
        commits_count=len(commits),
        agent=str(meta["agent"]),
    )


class DeployRecordService:
    """聚合全部 workspace 的部署发布记录（每次请求实时扫描，无缓存 v1）。"""

    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def list_records(self) -> list[DeployRecordSummary]:
        """全部 workspace 的记录摘要，按 deployed_at 倒序；invalid 排最后。"""
        rows = (
            await self.session.execute(select(Workspace.id, Workspace.name, Workspace.root_path))
        ).all()
        summaries: list[DeployRecordSummary] = []
        for ws_id, ws_name, root_path in rows:
            summaries.extend(self._scan_workspace(ws_id, ws_name, root_path))
        # 排序规则（design 写死）：deployed_at 字符串倒序；None（invalid）排最后，
        # 组内按 file_name 倒序次级排序。reverse=True 会把 None 标志一起翻转，
        # 故两段式：valid 段倒序在前、invalid 段按 file_name 倒序殿后。
        valid = [s for s in summaries if s.deployed_at is not None]
        invalid = [s for s in summaries if s.deployed_at is None]
        valid.sort(key=lambda s: (s.deployed_at or "", s.file_name), reverse=True)
        invalid.sort(key=lambda s: s.file_name, reverse=True)
        return valid + invalid

    async def get_record(self, record_id: str) -> DeployRecordDetail:
        """单条记录详情（元数据 + md 正文原文）。

        record_id 形如 ``<workspace_id>/<file_stem>``（workspace_id 保证跨
        工作区同名文件不冲突）。invalid 记录同样可读（FR-04：返回原文供
        人工排查，元数据字段降级）。
        """
        ws_id_str, _, file_stem = record_id.partition("/")
        if not ws_id_str or not file_stem:
            raise DeployRecordNotFound(f"未找到发布记录：{record_id}")
        try:
            ws_id = uuid.UUID(ws_id_str)
        except ValueError as exc:
            raise DeployRecordNotFound(f"未找到发布记录：{record_id}") from exc
        row = (
            await self.session.execute(
                select(Workspace.id, Workspace.name, Workspace.root_path).where(
                    Workspace.id == ws_id
                )
            )
        ).first()
        if row is None:
            raise DeployRecordNotFound(f"未找到发布记录：{record_id}")
        ws_id, ws_name, root_path = row
        for parsed in self._iter_files(root_path):
            if parsed.file_name == f"{file_stem}.md":
                summary = _summary_from(ws_id, ws_name, parsed.file_name, parsed)
                return DeployRecordDetail(**summary.model_dump(), content=parsed.content)
        raise DeployRecordNotFound(f"未找到发布记录：{record_id}")

    # ── 内部：文件系统扫描 ──────────────────────────────────────────

    def _scan_workspace(
        self, ws_id: uuid.UUID, ws_name: str, root_path: str
    ) -> list[DeployRecordSummary]:
        """单 workspace 扫描；目录不存在/为空 → 空列表（FR-02 静默降级）。"""
        return [
            _summary_from(ws_id, ws_name, parsed.file_name, parsed)
            for parsed in self._iter_files(root_path)
        ]

    def _iter_files(self, root_path: str) -> list[_ParsedRecord]:
        if not root_path:
            return []
        releases_dir = Path(_rewrite_path(root_path)) / RELEASES_DIR
        if not releases_dir.is_dir():
            return []
        parsed_list: list[_ParsedRecord] = []
        for entry in sorted(releases_dir.iterdir()):
            if not entry.is_file() or entry.suffix.lower() != ".md":
                continue
            try:
                text = entry.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                # 读失败（权限等 IO 错）与解码失败（非 UTF-8 字节，如 Windows 侧
                # GBK 手写文件）都按 invalid 容错，不炸扫描（FR-04 同口径）。
                # UnicodeDecodeError 是 ValueError 子类而非 OSError，须显式列捕
                # （2026-10-15-deploy-records-unicode-tolerance：原 except OSError
                # 漏接致单个坏编码文件把整个列表打成 500）。
                parsed_list.append(
                    _ParsedRecord(
                        file_name=entry.name,
                        meta=None,
                        content="",
                        invalid=True,
                        parse_error="file read error",
                    )
                )
                continue
            parsed = _parse_frontmatter(text)
            parsed.file_name = entry.name
            parsed_list.append(parsed)
        return parsed_list
