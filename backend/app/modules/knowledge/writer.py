"""Knowledge write-side service (change 2026-09-17-knowledge-precipitation task-04).

所有知识写操作（手工录入 / 条目编辑 / 审核合并 / 拒绝）的唯一落盘通道是
``SpecWorkspaceService.apply_ops``（D-005@v1 单写者语义：manifest 行版本乐观锁、
spec_version bump、delete 进 spec-backups 30 天备份区）。本 service 只负责：

- 构造 FileOp（op ∈ add/update/delete，path 限定 ``knowledge/`` 前缀，content
  base64，base_version 取 manifest 当前行版本）；
- merge 的 INDEX.md 路由行 / 追加段落**逐字复刻** sillyspec CLI
  ``knowledge-classify.js`` 的输出（R-03：格式漂移会让 CLI 检索失效）；
- merge 两段式（R-02）：段一 [update(目标), update(INDEX)] 确认无 conflict 才
  执行段二 [delete(proposed/<slug>.md)]——apply_ops 冲突是逐 op 跳过而非整批
  中止，混装 update+delete 会出现「候选已删但 INDEX 缺行」半态；两段式把 delete
  隔离到段二，段间失败 = 候选残留、幂等可重试（合并内容已生效不丢知识）；
- dupRe 幂等守卫：目标已含同名 ``##`` 小节 / INDEX 已含同锚点路由行时跳过对应
  动作（防段 1 已生效后的重试重复追加）；
- apply_ops 返回 conflict 时统一翻译 ``KnowledgeWriteConflict``（HTTP 409 +
  ``{message, conflict, server_versions}`` 冲突契约，R-01）。
"""

from __future__ import annotations

import base64
import re
import uuid
from datetime import UTC, datetime
from pathlib import Path, PurePosixPath
from typing import Any

from fastapi import status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError, WorkspaceNotFound
from app.core.logging import get_logger
from app.modules.agent.model import AgentRun
from app.modules.auth.model import User
from app.modules.knowledge.distill import DISTILL_RUN_KIND
from app.modules.knowledge.schema import (
    KnowledgeEntry,
    KnowledgeMergeResult,
    MergePreviewOut,
)
from app.modules.knowledge.service import KnowledgeService
from app.modules.spec_workspace.model import SpecFileManifest
from app.modules.spec_workspace.schema import FileOp
from app.modules.spec_workspace.service import SpecWorkspaceService
from app.modules.workspace.model import AgentRunWorkspace

# ── 常量（对齐 CLI knowledge-classify.js / design D-007@v1）─────────────────────

#: FileOp 路径前缀（相对 spec_root）。
KNOWLEDGE_PREFIX = "knowledge/"

#: merge 目标白名单：三类 INDEX 映射文件（CLI categoryForTarget 之外无路由落点）。
MERGE_TARGET_WHITELIST: frozenset[str] = frozenset(
    {"known-issues.md", "patterns.md", "conventions.md"}
)

#: INDEX.md 路由文件（FileOp 路径）。
INDEX_OP_PATH = "knowledge/INDEX.md"

#: CLI knowledge-classify.js CATEGORY_SECTIONS 逐字复刻：目标文件 → INDEX 分类段标题。
CATEGORY_SECTIONS: dict[str, str] = {
    "known-issues.md": "Known Issues",
    "patterns.md": "Patterns",
    "conventions.md": "Conventions",
}

#: CLI propose 落盘尾注块（合并时剥除，不进正式知识文件）。
_PROPOSED_FOOTER = (
    "> This is a proposed knowledge entry. Review and merge into manual/ or generated/."
)

log = get_logger(__name__)


# ── 领域错误（事件命名 + 中文文案，沿用 AppError 体系）────────────────────────


class KnowledgeEditForbidden(AppError):
    """决策库条目不可网页编辑（D-006@v1：由归档流程幂等维护）。"""

    code = "HTTP_422_KNOWLEDGE_EDIT_FORBIDDEN"
    http_status = status.HTTP_422_UNPROCESSABLE_ENTITY


class KnowledgeZoneNotAllowed(AppError):
    """操作对象不在允许的 zone（merge/reject 仅限待审核候选）。"""

    code = "HTTP_422_KNOWLEDGE_ZONE_NOT_ALLOWED"
    http_status = status.HTTP_422_UNPROCESSABLE_ENTITY


class KnowledgeMergeTargetNotAllowed(AppError):
    """merge 目标文件不在白名单（三类 INDEX 映射文件之外）。"""

    code = "HTTP_422_KNOWLEDGE_MERGE_TARGET_NOT_ALLOWED"
    http_status = status.HTTP_422_UNPROCESSABLE_ENTITY


class KnowledgePathInvalid(AppError):
    """知识条目路径不合法（越界 / 绝对路径 / 盘符）。"""

    code = "HTTP_400_KNOWLEDGE_PATH_INVALID"
    http_status = status.HTTP_400_BAD_REQUEST


class KnowledgeWriteConflict(AppError):
    """apply_ops 检测到 base_version 冲突（R-01 冲突响应契约）。

    响应契约：HTTP 409 + ``message``（提示刷新重试）+ ``details.conflict`` +
    ``details.server_versions``（冲突路径的服务器当前版本，供前端对齐基线）。
    """

    code = "HTTP_409_KNOWLEDGE_WRITE_CONFLICT"
    http_status = status.HTTP_409_CONFLICT

    def __init__(
        self,
        message: str | None = None,
        *,
        server_versions: dict[str, int] | None = None,
        details: dict[str, Any] | None = None,
    ) -> None:
        merged = {"conflict": True, "server_versions": server_versions or {}}
        if details:
            merged.update(details)
        super().__init__(
            message or "文件在别处被修改，请刷新后重试",
            details=merged,
        )


# ── CLI 语义复刻工具（与 knowledge-classify.js 逐字对齐，R-03）────────────────


def _detect_eol(content: str) -> str:
    """CLI detectEol：含 CRLF 即按 CRLF 回写。"""
    return "\r\n" if "\r\n" in content else "\n"


def _normalize_target_file(target_file: str) -> str:
    """CLI normalizeTargetFile：反斜杠转 POSIX、剥 './' 与冗余 'knowledge/' 前缀。"""
    f = (target_file or "").strip().replace("\\", "/")
    if f.startswith("./"):
        f = f[2:]
    if f.startswith("knowledge/"):
        f = f[len("knowledge/") :]
    return f


def _kebab_slug(title: str) -> str:
    r"""CLI propose 的 slug 生成：小写 + 非[\w 中文]段折叠为 '-'，截 60。

    Python ``\w`` 对 str 自带 Unicode 语义（含 CJK），与 JS ``[\w\u4e00-\u9fff]``
    对中英文标题行为一致。
    """
    slug = re.sub(r"[^\w\u4e00-\u9fff]+", "-", title.lower())
    slug = re.sub(r"^-|-$", "", slug)[:60]
    return slug or "untitled"


def build_route_line(target_file: str, section_title: str, keywords: list[str]) -> str:
    """INDEX.md 路由行，逐字复刻 CLI classify 输出。

    ``- 关键词|关键词 → [文件.md#锚点](文件.md#锚点)``，锚点 = 条目标题机械生成
    （knowledge-classify.js:251-252，anchor=finalTitle，X-005 / R-03）。
    """
    display = f"{target_file}#{section_title}"
    return f"- {'|'.join(keywords)} → [{display}]({display})"


def _insert_route_line(index_norm: str, category: str, route_line: str) -> str:
    """CLI insertRouteLine 复刻：分类段内末尾非空行后插入；段缺失时 EOF 追加新段。

    入参 / 返回均为 ``\\n`` 归一正文（调用方负责按 INDEX 既有 EOL 回写）。
    """
    lines = index_norm.split("\n")
    section_re = re.compile(rf"^##\s+{re.escape(category)}\s*$", re.IGNORECASE)
    sect_start = next((i for i, line in enumerate(lines) if section_re.match(line)), -1)
    if sect_start < 0:
        return re.sub(r"\n+$", "", index_norm) + f"\n\n## {category}\n{route_line}\n"
    last_content = sect_start
    for i in range(sect_start + 1, len(lines)):
        if re.match(r"^##\s+\S", lines[i]):
            break
        if lines[i].strip() != "":
            last_content = i
    lines.insert(last_content + 1, route_line)
    return "\n".join(lines)


def _has_section(content_norm: str, title: str) -> bool:
    """CLI dupRe 守卫：目标（\\n 归一）已含同名 ``##`` 二级标题小节。"""
    return bool(re.search(rf"^##\s+{re.escape(title)}\s*$", content_norm, re.MULTILINE))


def _route_line_exists(index_norm: str, display: str) -> bool:
    """CLI routeExists：INDEX（\\n 归一）已含指向同 file#anchor 的路由行。"""
    return any(f"]({display})" in line for line in index_norm.split("\n"))


def _build_append_block(target_raw: str, section_title: str, body: str) -> str:
    """CLI appendBlock 复刻：空行 + ``## <标题>`` + 空行 + 原文 + 收尾空行。

    按目标文件既有 EOL 追加；目标未以换行收尾时补一个 EOL（既有字节不动，
    append-only）。返回**将要追加的块**（调用方拼接原内容得到整文件新文本）。
    """
    eol = _detect_eol(target_raw)
    body_eol = body.replace("\n", eol) if body else ""
    parts = ["", f"## {section_title}", ""] + ([body_eol] if body_eol else []) + [""]
    block = eol.join(parts)
    if target_raw and not target_raw.endswith("\n"):
        block = eol + block
    return block


def _extract_proposed_source(content: str) -> str | None:
    """从候选文件 frontmatter 提取 ``source`` 字段（蒸馏反链载体，D-010①）。

    取值形态：``manual`` / ``session:<id>`` / ``change:<key>`` / ``quick:<id>``
    （quick 多选蒸馏时可为逗号分隔多个 ql id）。
    """
    norm = content.replace("\r\n", "\n")
    lines = norm.split("\n")
    if not lines or lines[0].strip() != "---":
        return None
    for line in lines[1:]:
        if line.strip() == "---":
            return None
        m = re.match(r"^source:\s*(.+?)\s*$", line)
        if m:
            return m.group(1)
    return None


def _backlink_targets(source: str | None) -> tuple[str, list[str]] | None:
    """frontmatter source → (source_type, refs)；manual / 无法识别 → None。"""
    if not source or source == "manual" or ":" not in source:
        return None
    source_type, _, ref = source.partition(":")
    if source_type not in ("session", "change", "quick") or not ref.strip():
        return None
    refs = [r.strip() for r in ref.split(",") if r.strip()]
    return source_type, refs


def _extract_proposed_body(content: str) -> str:
    """从候选文件正文提取合并段落体：剥 YAML frontmatter、首个 h1 标题行、CLI 尾注块。"""
    norm = content.replace("\r\n", "\n")
    lines = norm.split("\n")
    start = 0
    if lines and lines[0].strip() == "---":
        for i in range(1, len(lines)):
            if lines[i].strip() == "---":
                start = i + 1
                break
    body_lines = lines[start:]
    for i, line in enumerate(body_lines):
        if line.startswith("# "):
            body_lines = body_lines[i + 1 :]
            break
    text = "\n".join(body_lines).strip()
    # 剥 CLI propose 尾注块（--- + 提示 blockquote），避免提示语混入正式知识文件。
    stripped = text.rstrip().split("\n")
    while stripped and stripped[-1].strip() == "":
        stripped.pop()
    if (
        len(stripped) >= 2
        and stripped[-1].strip() == _PROPOSED_FOOTER
        and stripped[-2].strip() == "---"
    ):
        stripped = stripped[:-2]
    return "\n".join(stripped).strip()


def _validate_knowledge_filename(filename: str) -> None:
    """filename（knowledge/ 下相对路径）合法性校验：拒绝绝对路径 / 盘符 / ``..`` 逃逸。"""
    p = PurePosixPath(filename.replace("\\", "/"))
    if (
        not filename
        or p.is_absolute()
        or ".." in p.parts
        or (len(filename) > 1 and filename[1] == ":")
    ):
        raise KnowledgePathInvalid(
            "知识条目路径不合法。",
            details={"filename": filename},
        )


def _b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


# ── Service ───────────────────────────────────────────────────────────────────


class KnowledgeWriterService:
    """知识写侧 service：propose / update / preview-merge / merge / reject。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._spec_ws = SpecWorkspaceService(session)
        self._reader = KnowledgeService(session)

    # ── 内部工具 ──────────────────────────────────────────────────────────

    async def _manifest_version(self, workspace_id: uuid.UUID, op_path: str) -> int:
        """manifest 当前行版本（无行 → 0，apply_ops R-07 hash 兜底按新建处理）。"""
        row = (
            await self._session.execute(
                select(SpecFileManifest).where(
                    SpecFileManifest.workspace_id == workspace_id,
                    SpecFileManifest.path == op_path,
                )
            )
        ).scalar_one_or_none()
        return row.version if row is not None else 0

    async def _apply_ops(self, workspace_id: uuid.UUID, ops: list[FileOp]) -> dict[str, Any]:
        """apply_ops 包装：conflict 统一翻译 KnowledgeWriteConflict（409 契约）。"""
        result = await self._spec_ws.apply_ops(workspace_id, ops)
        if result.get("conflict"):
            server_versions = result.get("server_versions") or {}
            raise KnowledgeWriteConflict(
                "文件在别处被修改，请刷新后重试",
                server_versions={str(k): int(v) for k, v in dict(server_versions).items()},
            )
        return result

    async def _read_raw(self, workspace_id: uuid.UUID, filename: str) -> str:
        """原样读 knowledge/ 下文件（不经 parser——保留 CRLF/LF 原始字节，R-03）。"""
        _validate_knowledge_filename(filename)
        spec_ws = await self._spec_ws.get(workspace_id)
        target = Path(spec_ws.spec_root) / "knowledge" / filename.replace("\\", "/")
        if not target.is_file():
            raise WorkspaceNotFound(
                "知识库文件不存在，请刷新文件列表后重试。",
                details={"workspace_id": str(workspace_id), "filename": filename},
            )
        return target.read_bytes().decode("utf-8", errors="replace")

    def _frontmatter_author(self, user: User) -> str:
        return user.display_name or user.email or "unknown"

    # ── 写操作 ────────────────────────────────────────────────────────────

    async def propose_manual(
        self,
        workspace_id: uuid.UUID,
        user: User,
        *,
        title: str,
        body: str = "",
        category: str = "uncategorized",
        tags: list[str] | None = None,
    ) -> KnowledgeEntry:
        """手工录入候选：写 ``knowledge/proposed/<slug>.md``。

        slug = kebab(title)，与既有文件冲突时追加 -2/-3 序号（CLI propose 是直接
        覆盖，平台侧改为唯一化防误覆盖他人候选）。frontmatter 含
        author/created_at/proposed_at/source=manual（design Wave 2 契约）。
        """
        tags = tags or []
        listing = await self._reader.list_knowledge(workspace_id)
        existing = {e.filename for e in listing.items}
        slug = _kebab_slug(title)
        filename = f"proposed/{slug}.md"
        n = 2
        while filename in existing:
            filename = f"proposed/{slug}-{n}.md"
            n += 1

        now = datetime.now(UTC).isoformat()
        frontmatter = [
            "---",
            f"author: {self._frontmatter_author(user)}",
            f"created_at: {now}",
            f"proposed_at: {now}",
            f"category: {category}",
        ]
        if tags:
            frontmatter.append(f"tags: {', '.join(tags)}")
        frontmatter.append("source: manual")
        frontmatter.append("---")
        content = "\n".join([*frontmatter, "", f"# {title}", "", body or "(no body provided)", ""])

        op_path = f"{KNOWLEDGE_PREFIX}{filename}"
        ops = [
            FileOp(
                op="add",
                path=op_path,
                content=_b64(content),
                base_version=await self._manifest_version(workspace_id, op_path),
            )
        ]
        await self._apply_ops(workspace_id, ops)
        return await self._reader.get_knowledge(workspace_id, filename)

    async def update_entry(
        self,
        workspace_id: uuid.UUID,
        user: User,
        *,
        filename: str,
        content: str,
    ) -> KnowledgeEntry:
        """编辑条目正文（整文件替换）。

        zone 限定 top/generated/proposed；decisions 由归档流程幂等维护（D-006@v1），
        网页编辑返回 422。
        """
        _validate_knowledge_filename(filename)
        entry = await self._reader.get_knowledge(workspace_id, filename)
        if entry.zone == "decisions":
            raise KnowledgeEditForbidden(
                "决策库条目由归档流程维护，不支持网页编辑。",
                details={"filename": filename, "zone": entry.zone},
            )

        op_path = f"{KNOWLEDGE_PREFIX}{filename}"
        ops = [
            FileOp(
                op="update",
                path=op_path,
                content=_b64(content),
                base_version=await self._manifest_version(workspace_id, op_path),
            )
        ]
        await self._apply_ops(workspace_id, ops)
        return await self._reader.get_knowledge(workspace_id, filename)

    async def preview_merge(
        self,
        workspace_id: uuid.UUID,
        *,
        filename: str,
        target_file: str,
        section_title: str,
        keywords: list[str],
    ) -> MergePreviewOut:
        """合并预览（dry-run 不落盘）：将追加的段落文本 + INDEX 路由行。"""
        target = self._normalize_and_validate_target(target_file, filename)
        entry = await self._reader.get_knowledge(workspace_id, filename)
        if entry.zone != "proposed":
            raise KnowledgeZoneNotAllowed(
                "仅待审核（proposed）候选支持合并预览。",
                details={"filename": filename, "zone": entry.zone},
            )
        body = _extract_proposed_body(entry.content or "")

        target_raw = await self._read_raw(workspace_id, target)
        index_raw = await self._read_raw(workspace_id, "INDEX.md")
        section_skipped = _has_section(target_raw.replace("\r\n", "\n"), section_title)
        route_line = build_route_line(target, section_title, keywords)
        index_line_skipped = _route_line_exists(
            index_raw.replace("\r\n", "\n"), f"{target}#{section_title}"
        )
        return MergePreviewOut(
            section_text=""
            if section_skipped
            else _build_append_block(target_raw, section_title, body),
            index_line=route_line,
            section_skipped=section_skipped,
            index_line_skipped=index_line_skipped,
        )

    async def merge(
        self,
        workspace_id: uuid.UUID,
        user: User,
        *,
        filename: str,
        target_file: str,
        section_title: str,
        keywords: list[str],
    ) -> KnowledgeMergeResult:
        """两段式合并候选进目标知识文件（R-02 / D-007@v1）。

        段一 [update(目标), update(INDEX)] —— 确认无 conflict 才进入段二；段二
        [delete(proposed/<slug>.md)] 入备份区。段间失败 = 候选残留、幂等可重试
        （dupRe 守卫保证重试不重复追加）。冲突（任一段）抛 KnowledgeWriteConflict
        （409），候选保留未删。
        """
        target = self._normalize_and_validate_target(target_file, filename)
        entry = await self._reader.get_knowledge(workspace_id, filename)
        if entry.zone != "proposed":
            raise KnowledgeZoneNotAllowed(
                "仅待审核（proposed）候选支持合并操作。",
                details={"filename": filename, "zone": entry.zone},
            )
        body = _extract_proposed_body(entry.content or "")

        target_raw = await self._read_raw(workspace_id, target)
        index_raw = await self._read_raw(workspace_id, "INDEX.md")
        target_norm = target_raw.replace("\r\n", "\n")
        index_norm = index_raw.replace("\r\n", "\n")
        display = f"{target}#{section_title}"
        section_appended = not _has_section(target_norm, section_title)
        index_updated = not _route_line_exists(index_norm, display)
        route_line = build_route_line(target, section_title, keywords)

        # ── 段一：updates（append-only 追加小节 + INDEX 补路由行）─────────
        stage1: list[FileOp] = []
        if section_appended:
            new_target = target_raw + _build_append_block(target_raw, section_title, body)
            target_op = f"{KNOWLEDGE_PREFIX}{target}"
            stage1.append(
                FileOp(
                    op="update",
                    path=target_op,
                    content=_b64(new_target),
                    base_version=await self._manifest_version(workspace_id, target_op),
                )
            )
        if index_updated:
            index_eol = _detect_eol(index_raw)
            new_index = index_eol.join(
                _insert_route_line(index_norm, CATEGORY_SECTIONS[target], route_line).split("\n")
            )
            stage1.append(
                FileOp(
                    op="update",
                    path=INDEX_OP_PATH,
                    content=_b64(new_index),
                    base_version=await self._manifest_version(workspace_id, INDEX_OP_PATH),
                )
            )
        if stage1:
            await self._apply_ops(workspace_id, stage1)

        # ── 段二：删除候选（入 spec-backups 备份区）───────────────────────
        candidate_op = f"{KNOWLEDGE_PREFIX}{filename}"
        await self._apply_ops(
            workspace_id,
            [
                FileOp(
                    op="delete",
                    path=candidate_op,
                    base_version=await self._manifest_version(workspace_id, candidate_op),
                )
            ],
        )
        # ── D-010① 反链：合并后候选即入备份区，须把「目标文件#小节标题」双键
        # （非裸锚点，防重命名漂移）写回来源对应蒸馏任务条的 metadata_.merged_to，
        # 供来源侧「已沉淀」标签跳转到合并后的正式知识点。反链失败不阻断合并
        # 主流程（知识已落盘），仅 warning。
        try:
            await self._record_merge_backlink(workspace_id, entry, f"{target}#{section_title}")
        except Exception as exc:
            log.warning(
                "knowledge_merge_backlink_failed",
                workspace_id=str(workspace_id),
                filename=filename,
                error=str(exc),
            )
        return KnowledgeMergeResult(
            merged=True,
            target_file=target,
            section_title=section_title,
            index_line=route_line,
            section_appended=section_appended,
            index_updated=index_updated,
        )

    async def reject(self, workspace_id: uuid.UUID, user: User, *, filename: str) -> None:
        """拒绝候选：单段 apply_ops delete（入备份区，可回滚）。"""
        _validate_knowledge_filename(filename)
        entry = await self._reader.get_knowledge(workspace_id, filename)
        if entry.zone != "proposed":
            raise KnowledgeZoneNotAllowed(
                "仅待审核（proposed）候选支持拒绝操作。",
                details={"filename": filename, "zone": entry.zone},
            )
        candidate_op = f"{KNOWLEDGE_PREFIX}{filename}"
        await self._apply_ops(
            workspace_id,
            [
                FileOp(
                    op="delete",
                    path=candidate_op,
                    base_version=await self._manifest_version(workspace_id, candidate_op),
                )
            ],
        )

    # ── 反链（D-010①）───────────────────────────────────────────────────

    async def _record_merge_backlink(
        self,
        workspace_id: uuid.UUID,
        entry: KnowledgeEntry,
        merged_to: str,
    ) -> None:
        """把合并落点（``目标文件#小节标题``）写回来源对应蒸馏任务条。

        匹配口径 = AgentRunWorkspace 关联 + ``metadata_.kind=knowledge-distill``
        + ``metadata_.source_type/source_ref`` 与候选 frontmatter ``source``
        字段一致（``session:<id>`` / ``change:<key>`` / ``quick:<id>``，quick
        多选蒸馏的 list 形态逐条命中）。命中 run 的 ``metadata_.merged_to``
        即被更新（DistillTaskRead 投影透出，供来源侧跳转）。
        """
        mapped = _backlink_targets(_extract_proposed_source(entry.content or ""))
        if mapped is None:
            return
        source_type, refs = mapped
        stmt = (
            select(AgentRun)
            .join(
                AgentRunWorkspace,
                AgentRunWorkspace.agent_run_id == AgentRun.id,
            )
            .where(AgentRunWorkspace.workspace_id == workspace_id)
        )
        runs = list((await self._session.execute(stmt)).scalars().all())
        updated = False
        for run in runs:
            meta = run.metadata_ or {}
            if meta.get("kind") != DISTILL_RUN_KIND or meta.get("source_type") != source_type:
                continue
            raw_ref = meta.get("source_ref")
            run_refs = raw_ref if isinstance(raw_ref, list) else [str(raw_ref)]
            if not any(ref in run_refs for ref in refs):
                continue
            new_meta = dict(meta)
            new_meta["merged_to"] = merged_to
            run.metadata_ = new_meta
            self._session.add(run)
            updated = True
        if updated:
            await self._session.commit()

    # ── 校验 ──────────────────────────────────────────────────────────────

    def _normalize_and_validate_target(self, target_file: str, filename: str) -> str:
        """目标文件归一 + 白名单校验 + 候选 filename 合法性校验。"""
        _validate_knowledge_filename(filename)
        target = _normalize_target_file(target_file)
        if target not in MERGE_TARGET_WHITELIST:
            raise KnowledgeMergeTargetNotAllowed(
                "合并目标仅支持 known-issues.md / patterns.md / conventions.md。",
                details={"target_file": target},
            )
        return target
