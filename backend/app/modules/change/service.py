"""Change use cases.

Coordinates the filesystem parser with DB persistence. List/get queries read
from the DB; reparse re-reads the filesystem and reconciles rows. Document
content is read from the filesystem on-demand (not stored in DB).
"""

from __future__ import annotations

import asyncio
import copy
import json
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import func, or_, select, tuple_
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import ChangeDocNotFound, ChangeNotFound, InvalidTransition, PermissionDenied
from app.core.logging import get_logger
from app.modules.agent.model import AgentSession
from app.modules.change.model import (
    TRANSITIONS,
    Change,
    ChangeDocument,
    ChangeSessionLink,
    StageEnum,
)
from app.modules.change.parser import ChangeParser, ChangeParserResult, ParsedChange
from app.modules.change.projection import StageProjectionService
from app.modules.change.schema import (
    ArchiveCheckItem,
    ArchiveGateResponse,
    ChangeRead,
    ChangeSummary,
    PendingReview,
)
from app.modules.platform_sync.model import PlatformChangeProgressORM
from app.modules.workspace.model import Workspace
from app.modules.workspace.service import WorkspaceService

log = get_logger(__name__)

MAX_CONTENT_BYTES = 1_000_000  # 1 MB


@dataclass
class CompleteStageResult:
    """complete_stage 的返回值。"""

    change: Change
    dispatch_target: str | None
    gate: str


@dataclass
class RerunStageResult:
    """rerun_stage 的返回值。"""

    change: Change
    dispatched: bool
    agent_dispatch: dict


class ChangeService:
    """List, fetch, and reparse changes for a workspace."""

    def __init__(
        self,
        session: AsyncSession,
        *,
        parser: ChangeParser | None = None,
        workspace_service: WorkspaceService | None = None,
    ) -> None:
        self._session = session
        self._parser = parser or ChangeParser()
        self._workspace_service = workspace_service or WorkspaceService(session)

    # ── Queries ───────────────────────────────────────────────────────────

    async def _resolve_change_dir(self, workspace: Workspace, change: Change) -> Path:
        """解析单个变更目录的绝对路径（task-01 / D-006@v1）。

        ``change.path`` 是 reparse 时存的相对 sillyspec_root 路径（已含 archive/
        段与扁平布局前缀，对齐 parser rel_prefix），故直接 ``sillyspec_root
        / change.path`` 即可，覆盖 active/archive 全组合。sillyspec_root 解析
        对齐 ``reparse``（service.py:696-708）。
        """
        sillyspec_root = Path(workspace.root_path)
        try:
            from app.modules.spec_workspace.service import SpecWorkspaceService

            spec_ws = await SpecWorkspaceService(self._session).get(workspace.id)
            if spec_ws and spec_ws.spec_root:
                sillyspec_root = Path(spec_ws.spec_root)
        except Exception as exc:
            log.warning(
                "change.resolve_change_dir_failed",
                workspace_id=str(workspace.id),
                error=str(exc),
            )
        return sillyspec_root / change.path

    async def list_(
        self,
        workspace_id: uuid.UUID,
        *,
        location: str | None = None,
        status: str | None = None,
        owner: str | None = None,
        search: str | None = None,
        current_stage: str | None = None,
        sort: str = "updated_at_desc",
        pending_review_only: bool = False,
        page: int = 1,
        page_size: int = 20,
    ) -> tuple[list[Change], int]:
        """List changes for a workspace, with pagination + search (ql-20260701-005).

        ``search`` ILIKE-matches change_key or title. Returns ``(items, total)``
        where total is the count **before** pagination (matching admin/roles 分页
        查询模式).

        ``sort``（2026-08-13-change-center-rework task-02 / D-004）：白名单映射到
        SQLAlchemy 列表达式，**不直接拼接 SQL 字符串**（防注入）。默认
        ``updated_at_desc``（最近活动优先，取代旧 change_key asc，R-05 有意行为变化）；
        未知值 fallback 默认（不抛）。

        ``pending_review_only``（ql-20260813-005 / gap②）：True 时先算全局 pending
        change_key 集合再 SQL ``WHERE change_key IN`` 分页，``total``=全局真实 N
        （非本页过滤后数）。pending_review 是计算字段（latest_progress + _map），
        SQL 无法直接 WHERE，故走「复用 _map 算集合 → SQL IN」两阶段（跨库稳定，
        不翻译 _map 到 JSON 展开语法）。
        """
        await self._workspace_service.get(workspace_id)

        # 方案B（ql-20260813-005 / gap②）：先算全局 pending 集合（复用 _map），
        # 再叠加 SQL WHERE IN。total 在 IN 过滤后计数 = 全局真实 N。
        pending_keys: set[str] | None = None
        if pending_review_only:
            pending_keys = await self._resolve_pending_change_keys(workspace_id, location)
            if not pending_keys:
                return [], 0

        # Base: changes whose primary workspace matches（D-005@V1，M:N 投影表已废，
        # 一个变更只属单一项目组 workspace）。
        base = select(Change).where(col(Change.workspace_id) == workspace_id)

        if location:
            base = base.where(col(Change.location) == location)
        if status:
            base = base.where(col(Change.status) == status)
        if owner:
            try:
                owner_uuid = uuid.UUID(owner)
                base = base.where(col(Change.owner_id) == owner_uuid)
            except ValueError:
                pass
        if current_stage:
            base = base.where(col(Change.current_stage) == current_stage)
        if search:
            pattern = f"%{search}%"
            base = base.where(
                or_(
                    col(Change.change_key).ilike(pattern),
                    col(Change.title).ilike(pattern),
                )
            )
        if pending_keys is not None:
            base = base.where(col(Change.change_key).in_(pending_keys))

        # Count total
        count_stmt = select(func.count()).select_from(base.subquery())
        total = (await self._session.execute(count_stmt)).scalar() or 0

        # task-02（D-004 / R-05）：默认排序 change_key asc → updated_at desc（最近活动
        # 优先）。sort 经白名单映射为列表达式，未知值 fallback 默认（不抛、不注入）。
        base = base.order_by(self._resolve_order_by(sort))
        if page_size > 0:
            base = base.offset((page - 1) * page_size).limit(page_size)

        items = list((await self._session.execute(base)).scalars().all())
        return items, total

    async def get_by_key(self, workspace_id: uuid.UUID, change_key: str) -> Change:
        """Look up a change by its *change_key* within the workspace."""
        await self._workspace_service.get(workspace_id)

        # Primary workspace match
        stmt = select(Change).where(
            col(Change.workspace_id) == workspace_id,
            col(Change.change_key) == change_key,
        )
        change = (await self._session.execute(stmt)).scalars().first()

        if change is None:
            raise ChangeNotFound(
                f"Change '{change_key}' not found.",
                details={
                    "workspace_id": str(workspace_id),
                    "change_key": change_key,
                },
            )
        return change

    async def get(self, workspace_id: uuid.UUID, change_id: uuid.UUID) -> Change:
        await self._workspace_service.get(workspace_id)

        # Primary workspace match
        stmt = select(Change).where(
            col(Change.id) == change_id,
            col(Change.workspace_id) == workspace_id,
        )
        change = (await self._session.execute(stmt)).scalars().first()

        if change is None:
            raise ChangeNotFound(
                f"Change '{change_id}' not found.",
                details={
                    "workspace_id": str(workspace_id),
                    "change_id": str(change_id),
                },
            )
        return change

    async def get_documents(
        self, workspace_id: uuid.UUID, change_id: uuid.UUID
    ) -> tuple[list[ChangeDocument], list[str], list[str]]:
        change = await self.get(workspace_id, change_id)
        stmt = select(ChangeDocument).where(col(ChangeDocument.change_id) == change.id)
        docs = list((await self._session.execute(stmt)).scalars().all())
        prototypes = [Path(d.path).name for d in docs if d.doc_type == "prototype" and d.exists]
        references = [Path(d.path).name for d in docs if d.doc_type == "reference" and d.exists]
        return docs, prototypes, references

    # ── File tree (task-03/04/05/07, 2026-07-02-change-detail-file-tree-editor) ──

    # is_text 判定的文本扩展名（编辑器对非文本只读，D-007）
    _TEXT_SUFFIXES = frozenset(
        {
            ".md",
            ".mdx",
            ".html",
            ".htm",
            ".yaml",
            ".yml",
            ".json",
            ".txt",
        }
    )

    @staticmethod
    def _is_text_file(name: str) -> bool:
        suffix = Path(name).suffix.lower()
        return suffix in ChangeService._TEXT_SUFFIXES

    @staticmethod
    def _list_files_sync(change_dir: Path) -> list[dict]:
        """``list_files`` 同步遍历段（Wave C 续：移出事件循环，对齐 tool_gateway 范式）。"""
        if not change_dir.is_dir():
            return []
        items: list[dict] = []
        for entry in sorted(change_dir.rglob("*")):
            if not entry.is_file():
                continue
            name = entry.name
            if name.startswith("."):
                continue
            # 排除 __pycache__ 段
            if "__pycache__" in entry.parts:
                continue
            try:
                rel = entry.relative_to(change_dir)
            except ValueError:
                continue
            stat = entry.stat()
            items.append(
                {
                    "path": rel.as_posix(),
                    "name": name,
                    "size": stat.st_size,
                    "last_modified_at": datetime.fromtimestamp(stat.st_mtime, tz=UTC),
                    "is_text": ChangeService._is_text_file(name),
                }
            )
        return items

    @staticmethod
    def _read_file_sync(full_path: Path, rel_path: str) -> tuple[str, str | None, bool]:
        """``read_file`` 同步读段（Wave C 续：移出事件循环）。"""
        if not full_path.is_file():
            return rel_path, None, False
        size = full_path.stat().st_size
        content = full_path.read_text(encoding="utf-8", errors="replace")
        if size > MAX_CONTENT_BYTES:
            content = content[: MAX_CONTENT_BYTES // 4]
        return rel_path, content, True

    @staticmethod
    def _write_text_sync(full_path: Path, content: str) -> None:
        """写 UTF-8 文本（Wave C 续：``write_file`` / ``sync_documents`` 共用，移出事件循环）。"""
        full_path.parent.mkdir(parents=True, exist_ok=True)
        full_path.write_text(content, encoding="utf-8")

    async def list_files(self, workspace_id: uuid.UUID, change_id: uuid.UUID) -> list[dict]:
        """遍历变更目录全部文件，返回扁平清单（task-03 / FR-03）。

        每项 ``{path, name, size, last_modified_at, is_text}``，path 相对变更目录
        （posix 风格，如 ``tasks/task-01.md``）。排除目录、``.`` 开头隐藏文件、
        ``__pycache__``。目录不存在返回空列表（不抛）。
        """
        change = await self.get(workspace_id, change_id)
        workspace = await self._workspace_service.get(workspace_id)
        change_dir = await self._resolve_change_dir(workspace, change)
        return await asyncio.to_thread(self._list_files_sync, change_dir)

    async def read_file(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        rel_path: str,
    ) -> tuple[str, str | None, bool]:
        """按相对 path 读单文件（task-04 / FR-04 / D-004）。

        路径穿越守卫：resolve 后必须落在变更目录内（覆盖 ../ 、绝对路径、符号链接）。
        返回 ``(path, content, exists)``，content > MAX_CONTENT_BYTES 截断。
        """
        change = await self.get(workspace_id, change_id)
        workspace = await self._workspace_service.get(workspace_id)
        change_dir = (await self._resolve_change_dir(workspace, change)).resolve()
        full_path = (change_dir / rel_path).resolve()
        try:
            full_path.relative_to(change_dir)
        except ValueError:
            raise ChangeDocNotFound(
                "Path traversal detected.",
                details={"path": rel_path},
            ) from None

        return await asyncio.to_thread(self._read_file_sync, full_path, rel_path)

    async def write_file(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        rel_path: str,
        content: str,
        user_id: uuid.UUID,
    ) -> dict:
        """编辑保存（task-05 / FR-05/06 / D-001/002/006）。

        task-08：工作区路径来源分流已删（FR-2），唯一路径直写平台镜像 + 建/合并同
        change_key+path 的 pending DaemonChangeWrite 行（kind=edit，D-002 合并），
        **不 await**（D-001 离线续传），resync，返 ``{status:"pending", task_id}``。
        runtime 由 ``_enqueue_edit_write`` 内部 ``resolve_runtime_for_writeback``
        现算（D-001@v1），失败抛 ``DaemonClientNoActiveSession``。

        path resolve 必须落变更目录内（守卫，D-004）；content ≤ 1MB。
        """
        if len(content.encode("utf-8")) > MAX_CONTENT_BYTES:
            raise ChangeDocNotFound(
                "File content exceeds size limit.",
                details={"path": rel_path, "limit": MAX_CONTENT_BYTES},
            )
        change = await self.get(workspace_id, change_id)
        workspace = await self._workspace_service.get(workspace_id)
        change_dir = (await self._resolve_change_dir(workspace, change)).resolve()
        full_path = (change_dir / rel_path).resolve()
        try:
            full_path.relative_to(change_dir)
        except ValueError:
            raise ChangeDocNotFound(
                "Path traversal detected.",
                details={"path": rel_path},
            ) from None

        # 写盘（直写镜像，spike-01 验证可写）—— Wave C 续：移出事件循环
        await asyncio.to_thread(self._write_text_sync, full_path, content)

        # 同文件 pending 合并 + 离线续传 outbox
        task_id = await self._enqueue_edit_write(
            workspace=workspace,
            change=change,
            rel_path=rel_path,
            content=content,
            user_id=user_id,
        )

        # resync（镜像已新鲜，POST 时即刷新，D-005）
        try:
            await self._resync_change_docs(workspace_id, change.id)
        except Exception as exc:
            log.warning("change.write_file_resync_failed", change_id=str(change.id), error=str(exc))

        return {"status": "pending", "task_id": task_id}

    async def _enqueue_edit_write(
        self,
        *,
        workspace: Workspace,
        change: Change,
        rel_path: str,
        content: str,
        user_id: uuid.UUID,
    ) -> uuid.UUID:
        """建/合并同 change_key+path 的 pending DaemonChangeWrite 行（D-002）。

        files 项 path 用扁平 ``changes/{key}/{rel_path}``（对齐 _build_files 范式，
        daemon runChangeWrite 通用消费）。命中 pending 行则 UPDATE content（last-write-wins）。

        D-001@v1（2026-07-05-daemon-client-change-binding-fix）：runtime_id 改由
        ``resolve_runtime_for_writeback`` 现算（per-member binding 解析），需
        ``user_id`` 校验 daemon 归属。失败抛 ``DaemonClientNoActiveSession``。
        """
        from app.modules.daemon.model import DaemonChangeWrite
        from app.modules.workspace.member_runtimes.resolver import (
            resolve_runtime_for_writeback,
        )

        files_payload = [
            {
                "path": f"changes/{change.change_key}/{rel_path}",
                "content": content,
                "doc_type": "edit",
            }
        ]
        # runtime_id：写回时现算（D-001@v1）。失败抛 DaemonClientNoActiveSession
        # （reason 区分 not_bound / daemon_offline / default_agent_unset / provider_unavailable）。
        resolved = await resolve_runtime_for_writeback(self._session, workspace.id, user_id)
        rid_raw = resolved["id"]
        runtime_id: uuid.UUID = uuid.UUID(rid_raw) if isinstance(rid_raw, str) else rid_raw

        existing = (
            (
                await self._session.execute(
                    select(DaemonChangeWrite).where(
                        col(DaemonChangeWrite.workspace_id) == workspace.id,
                        col(DaemonChangeWrite.change_key) == change.change_key,
                        col(DaemonChangeWrite.status) == "pending",
                        col(DaemonChangeWrite.kind) == "edit",
                    )
                )
            )
            .scalars()
            .all()
        )
        # 匹配同 path 的 pending 行（files[0].path 相同）
        match = next(
            (
                cw
                for cw in existing
                if cw.files and cw.files[0].get("path") == files_payload[0]["path"]
            ),
            None,
        )
        if match is not None:
            match.files = files_payload
            match.created_at = datetime.now(UTC)
            self._session.add(match)
            await self._session.commit()
            return match.id

        new_row = DaemonChangeWrite(
            id=uuid.uuid4(),
            workspace_id=workspace.id,
            runtime_id=runtime_id,
            change_key=change.change_key,
            files=files_payload,
            kind="edit",
            status="pending",
        )
        self._session.add(new_row)
        await self._session.commit()
        return new_row.id

    async def _resync_change_docs(self, workspace_id: uuid.UUID, change_id: uuid.UUID) -> None:
        """per-change 文档刷新（task-06 / FR-07 / D-005）。

        复用 ChangeParser._parse_change 单目录解析 + _apply_parsed + _sync_docs
        刷 ChangeDocument 行 + title（编辑 proposal.md heading 后跟上）。
        best-effort：失败仅 log 不抛（R-05）。非全量 reparse。
        """
        change = await self.get(workspace_id, change_id)
        workspace = await self._workspace_service.get(workspace_id)
        change_dir = await self._resolve_change_dir(workspace, change)
        if not change_dir.is_dir():
            return

        sillyspec_root = Path(workspace.root_path)
        try:
            from app.modules.spec_workspace.service import SpecWorkspaceService

            spec_ws = await SpecWorkspaceService(self._session).get(workspace.id)
            if spec_ws and spec_ws.spec_root:
                sillyspec_root = Path(spec_ws.spec_root)
        except Exception:
            pass

        # rel_prefix 用 change.path（已含 archive 段 + .sillyspec 包裹，与 _resolve_change_dir
        # 一致），避免重建 rel_prefix 漏掉 archive 段破坏 change.path。
        rel_prefix = change.path
        parsed = self._parser._parse_change(
            sillyspec_root,
            change_dir,
            location=change.location or "active",
            rel_prefix=rel_prefix,
        )
        self._apply_parsed(change, parsed, workspace_id=workspace_id)
        await self._sync_docs(
            change=parsed,
            workspace_id=workspace_id,
            existing_change=change,
            stats={"parsed": 0, "created": 0, "updated": 0, "deleted": 0, "renamed": 0},
        )
        change.updated_at = datetime.now(UTC)
        self._session.add(change)
        await self._session.commit()

    async def list_pending_files(self, workspace_id: uuid.UUID, change_id: uuid.UUID) -> list[dict]:
        """查询该变更 pending/claimed edit 行（task-07 / FR-08）。"""
        change = await self.get(workspace_id, change_id)
        from app.modules.daemon.model import DaemonChangeWrite

        rows = (
            (
                await self._session.execute(
                    select(DaemonChangeWrite)
                    .where(
                        col(DaemonChangeWrite.workspace_id) == workspace_id,
                        col(DaemonChangeWrite.change_key) == change.change_key,
                        col(DaemonChangeWrite.status).in_(["pending", "claimed"]),
                        col(DaemonChangeWrite.kind) == "edit",
                    )
                    .order_by(col(DaemonChangeWrite.created_at))
                )
            )
            .scalars()
            .all()
        )
        prefix = f"changes/{change.change_key}/"
        items: list[dict] = []
        for cw in rows:
            files = cw.files or []
            fpath = files[0].get("path") if files else None
            rel = fpath[len(prefix) :] if fpath and fpath.startswith(prefix) else fpath or ""
            items.append(
                {
                    "path": rel,
                    "status": cw.status,
                    "created_at": cw.created_at,
                }
            )
        return items

    # ── Progress / Approval / Documents ─────────────────────────────────

    async def update_progress(
        self,
        workspace_id: uuid.UUID,
        change_key: str,
        *,
        current_stage: str,
        stages: dict,
        last_active: str,
    ) -> None:
        change = await self.get_by_key(workspace_id, change_key)
        change.current_stage = current_stage
        change.stages = stages
        change.updated_at = datetime.now(UTC)
        self._session.add(change)
        await self._session.commit()

    async def get_approval(
        self, workspace_id: uuid.UUID, change_key: str
    ) -> tuple[str, str | None]:
        change = await self.get_by_key(workspace_id, change_key)
        return change.approval_status, change.rejection_reason

    async def approve(
        self,
        workspace_id: uuid.UUID,
        change_key: str,
        *,
        approved_by: str,
    ) -> None:
        change = await self.get_by_key(workspace_id, change_key)
        change.approval_status = "approved"
        change.approved_by = approved_by
        change.approved_at = datetime.now(UTC)
        change.updated_at = datetime.now(UTC)
        self._session.add(change)
        await self._session.commit()

    async def reject(
        self,
        workspace_id: uuid.UUID,
        change_key: str,
        *,
        reason: str,
    ) -> None:
        change = await self.get_by_key(workspace_id, change_key)
        change.approval_status = "rejected"
        change.rejection_reason = reason
        change.updated_at = datetime.now(UTC)
        self._session.add(change)
        await self._session.commit()

    async def sync_documents(
        self,
        workspace_id: uuid.UUID,
        change_key: str,
        documents: list[tuple[str, str]],
    ) -> int:
        """Write document files to disk and upsert ChangeDocument rows.

        Returns the number of documents synced.
        """
        change = await self.get_by_key(workspace_id, change_key)
        workspace = await self._workspace_service.get(workspace_id)
        root = Path(workspace.root_path)

        # 第六批：批量取已存在 ChangeDocument（原逐文档 SELECT → N+1 upsert）。
        # 单请求内无并发写入，循环前一次性 IN 查询与原逐条语义等价。
        doc_items = list(documents)
        existing_docs: dict[str, ChangeDocument] = (
            {
                doc.doc_type: doc
                for doc in (
                    await self._session.execute(
                        select(ChangeDocument).where(
                            col(ChangeDocument.change_id) == change.id,
                            col(ChangeDocument.doc_type).in_(
                                [filename for filename, _ in doc_items]
                            ),
                        )
                    )
                )
                .scalars()
                .all()
            }
            if doc_items
            else {}
        )

        synced = 0
        for filename, content in doc_items:
            # Write file to .sillyspec/changes/{change_key}/{filename}
            relative = f".sillyspec/changes/{change_key}/{filename}"
            full_path = root / relative
            resolved = full_path.resolve()
            if not str(resolved).startswith(str(root.resolve())):
                raise ChangeDocNotFound("Path traversal detected.")
            await asyncio.to_thread(self._write_text_sync, full_path, content)
            now = datetime.now(UTC)

            # Upsert ChangeDocument row
            doc = existing_docs.get(filename)
            if doc is None:
                doc = ChangeDocument(
                    id=uuid.uuid4(),
                    change_id=change.id,
                    doc_type=filename,
                    path=relative,
                    exists=True,
                    last_modified_at=now,
                )
                self._session.add(doc)
            else:
                doc.exists = True
                doc.last_modified_at = now
            synced += 1

        await self._session.commit()
        return synced

    # ── Workflow ────────────────────────────────────────────────────────

    async def transition(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        target_stage: str,
        user_role: str,
        *,
        reason: str | None = None,
    ) -> Change:
        """执行状态流转。"""
        change = await self.get(workspace_id, change_id)
        # 源阶段完成度前置校验（必须在下方 draft 重映射之前用原始 current_stage 判首次启动）。
        self._check_source_stage_completion(change)
        current = change.current_stage
        if not current or current == "draft":
            current = "brainstorm"

        # Validate current stage exists in TRANSITIONS
        current_key = StageEnum(current)  # convert to StageEnum
        if current_key not in TRANSITIONS:
            raise InvalidTransition(f"未知阶段: {current_key}")

        # Find the target transition
        transitions_from_current = TRANSITIONS[current_key]
        try:
            target_key = StageEnum(target_stage)
        except ValueError:
            raise InvalidTransition(f"无效的目标阶段: {target_stage}") from None
        if target_key not in transitions_from_current:
            raise InvalidTransition(f"不允许从 {current_key.value} 流转到 {target_stage}")

        # Check role permission (admin bypasses all)
        allowed_roles = transitions_from_current[target_key]
        if user_role != "admin" and user_role not in allowed_roles:
            raise PermissionDenied(
                f"角色 '{user_role}' 无权执行 {current_key.value} → {target_stage} 流转"
            )

        # Log transition to stages JSON
        stages = dict(change.stages or {})
        transitions_log = stages.get("transitions", [])
        transitions_log.append(
            {
                "from": current,
                "to": target_stage,
                "by_role": user_role,
                "reason": reason,
                "at": datetime.now(UTC).isoformat(),
            }
        )
        stages["transitions"] = transitions_log

        # Update change
        change.current_stage = target_stage
        change.stages = stages
        change.updated_at = datetime.now(UTC)
        self._session.add(change)

        # Record audit log
        from app.modules.workflow.model import AuditLog

        audit_entry = AuditLog(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            actor_id=None,
            action="change.transition",
            resource_type="change",
            resource_id=change.id,
            details_json=json.dumps({"from": current, "to": target_stage}),
        )
        self._session.add(audit_entry)

        await self._session.commit()
        return change

    async def transition_with_dispatch(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        target_stage: str,
        user_role: str,
        *,
        reason: str | None = None,
        user_id: uuid.UUID | None = None,
        provider: str | None = None,
        model: str | None = None,
        agent_profile_id: uuid.UUID | None = None,
        team_mode: bool = False,
        worker_preset: list[dict] | None = None,
        main_agent_config: dict | None = None,
    ) -> dict:
        """Execute transition and optionally dispatch an agent for the target stage.

        Returns a dict with the change data and agent dispatch info.

        When ``team_mode=True`` and the target stage is ``execute``/``verify``, the
        change's ``stages`` JSON is marked with ``team_mode=True`` so the dispatch
        layer routes to the team execution path (D-004@v2, dispatch.py:810 /
        dispatch_next_step Step 2.5)。``worker_preset`` / ``main_agent_config``
        一并写入 ``stages.team_worker_preset`` / ``stages.team_main_agent_config``，
        供 :func:`_dispatch_execute_team` 传给 ``OrchestratorService.team_mission_entry``。

        ``agent_profile_id``（2026-08-12-dispatch-bind-agent-profile）：单次 dispatch
        入参，透传给 :func:`dispatch` → ``start_stage_dispatch``（形参已存在），None=
        跟随工作区默认（不选档案，D-001@v1）。
        """
        change = await self.transition(
            workspace_id=workspace_id,
            change_id=change_id,
            target_stage=target_stage,
            user_role=user_role,
            reason=reason,
        )

        # team_mode opt-in：写 change.stages.team_mode=True 触发 dispatch 分流（D-004@v2）。
        # 必须 dict copy 再赋值——SQLAlchemy JSON 列原地改不 dirty 不落库（反复踩过的坑，
        # 参照 dispatch.py:835 同模式）。team_mode=False 不写键，保持 single 零回归。
        # 必须显式 commit：dispatch 用独立 factory session 读 change（见下方 :725），
        # 跨 session 看不到本 session 未提交的改动，不 commit 则 team_mode 不可见 → 分流失效。
        # task-09：worker_preset / main_agent_config 一并落 stages（供
        # _dispatch_execute_team → OrchestratorService.team_mission_entry 读取）。
        if team_mode:
            stages = dict(change.stages or {})
            stages["team_mode"] = True
            if worker_preset is not None:
                stages["team_worker_preset"] = worker_preset
            if main_agent_config is not None:
                stages["team_main_agent_config"] = main_agent_config
            change.stages = stages
            self._session.add(change)
            await self._session.commit()

        # Attempt agent dispatch after commit (best-effort, non-blocking)
        dispatch_result: dict = {}
        if user_id is not None:
            try:
                from app.core.db import get_session_factory
                from app.modules.change.dispatch import dispatch

                # Use a fresh session to avoid conflicts with transition's session
                factory = get_session_factory()
                async with factory() as dispatch_session:
                    dispatch_result = await dispatch(
                        session=dispatch_session,
                        workspace_id=workspace_id,
                        change_id=change_id,
                        target_stage=target_stage,
                        user_id=user_id,
                        provider=provider,
                        model=model,
                        agent_profile_id=agent_profile_id,
                    )
            except Exception as exc:
                log.warning(
                    "dispatch_after_transition_failed",
                    change_id=str(change_id),
                    target_stage=target_stage,
                    error=str(exc),
                )
                dispatch_result = {
                    "dispatched": False,
                    "reason": "dispatch_exception",
                    "error": str(exc),
                }

        return {
            "change": change,
            "agent_dispatch": dispatch_result,
        }

    async def submit_feedback(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        category: str,
        text: str,
        user_id: uuid.UUID,
        *,
        target_stage: str | None = None,
    ) -> Change:
        """提交反馈并流转至 blocked（human_gate）阶段。"""
        # Validate category
        if category not in ("A", "B", "C", "D"):
            raise InvalidTransition(f"无效的反馈类别: {category}")

        FEEDBACK_TARGETS = {  # noqa: N806
            "A": "execute",
            "B": "propose",
            "C": "brainstorm",
            "D": "archive",
        }
        rework_target = target_stage or FEEDBACK_TARGETS[category]

        change = await self.get(workspace_id, change_id)

        # Validate current stage allows feedback
        current = change.current_stage or "draft"
        if current not in ("verify", "archive"):
            raise InvalidTransition("当前阶段不允许提交反馈，仅限 verify 和 archive")

        # Save feedback info
        change.feedback_category = category
        change.feedback_text = text
        # reviewer info stored in stages JSON

        # Update stages JSON
        stages = dict(change.stages or {})
        stages["last_feedback"] = {
            "category": category,
            "text": text,
            "rework_target": rework_target,
            "submitted_by": str(user_id),
            "submitted_at": datetime.now(UTC).isoformat(),
        }
        change.stages = stages

        if category == "D":
            # D: accept as-is, move to archive stage
            change.current_stage = "archive"
            # Log the special transition
            transitions_log = stages.get("transitions", [])
            transitions_log.append(
                {
                    "from": current,
                    "to": "archive",
                    "by_role": "reviewer",
                    "reason": f"反馈类别 D（衍生新 change）: {text[:100]}",
                    "at": datetime.now(UTC).isoformat(),
                }
            )
            stages["transitions"] = transitions_log
            change.stages = stages
        else:
            # A/B/C: transition to blocked (human_gate mechanism)
            change.current_stage = "blocked"
            transitions_log = stages.get("transitions", [])
            transitions_log.append(
                {
                    "from": current,
                    "to": "blocked",
                    "by_role": "reviewer",
                    "reason": f"反馈类别 {category}: {text[:100]}",
                    "at": datetime.now(UTC).isoformat(),
                }
            )
            stages["transitions"] = transitions_log
            stages["rework_target"] = rework_target
            change.stages = stages

        change.updated_at = datetime.now(UTC)
        self._session.add(change)
        await self._session.commit()
        return change

    async def check_archive_gate(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
    ) -> ArchiveGateResponse:
        """归档门禁检查。"""
        change = await self.get(workspace_id, change_id)
        checks: list[ArchiveCheckItem] = []

        current = change.current_stage or "draft"
        if current != "archive":
            # Not in archive stage - all checks fail
            for name in [
                "no_unresolved_feedback",
                "ac_confirmed",
                "tech_verification_passed",
                "business_review_passed",
                "feedback_categorized",
                "documents_complete",
            ]:
                checks.append(
                    ArchiveCheckItem(
                        name=name,
                        passed=False,
                        detail=f"当前阶段非 archive（{current}），无法归档",
                    )
                )
            return ArchiveGateResponse(can_archive=False, checks=checks)

        # Check 1: no unresolved feedback
        checks.append(
            ArchiveCheckItem(
                name="no_unresolved_feedback",
                passed=change.feedback_category is None,
                detail=""
                if change.feedback_category is None
                else f"存在未解决反馈，类别: {change.feedback_category}",
            )
        )

        stages = dict(change.stages or {})

        # Check 2: AC confirmed
        ac_confirmed = stages.get("ac_confirmed", False)
        checks.append(
            ArchiveCheckItem(
                name="ac_confirmed",
                passed=bool(ac_confirmed),
                detail="" if ac_confirmed else "验收标准尚未确认",
            )
        )

        # Check 3: tech verification passed
        tech_passed = stages.get("tech_verification_passed", False)
        checks.append(
            ArchiveCheckItem(
                name="tech_verification_passed",
                passed=bool(tech_passed),
                detail="" if tech_passed else "技术验证未通过",
            )
        )

        # Check 4: business review passed
        biz_passed = stages.get("business_review_passed", False)
        checks.append(
            ArchiveCheckItem(
                name="business_review_passed",
                passed=bool(biz_passed),
                detail="" if biz_passed else "业务评审未通过",
            )
        )

        # Check 5: feedback categorized
        feedback_records = stages.get("feedback_history", [])
        uncategorized = [f for f in feedback_records if not f.get("category")]
        checks.append(
            ArchiveCheckItem(
                name="feedback_categorized",
                passed=len(uncategorized) == 0,
                detail="" if not uncategorized else f"{len(uncategorized)} 条反馈未分类",
            )
        )

        # Check 6: documents complete — 四件套必须齐全（exists）
        REQUIRED_DOC_TYPES = {"proposal", "design", "requirements", "tasks"}  # noqa: N806
        docs, _, _ = await self.get_documents(workspace_id, change_id)
        existing_types = {d.doc_type for d in docs if d.exists}
        missing = REQUIRED_DOC_TYPES - existing_types
        checks.append(
            ArchiveCheckItem(
                name="documents_complete",
                passed=len(missing) == 0,
                detail="" if not missing else f"缺少必需文档: {', '.join(sorted(missing))}",
            )
        )

        can_archive = all(check.passed for check in checks)
        return ArchiveGateResponse(can_archive=can_archive, checks=checks)

    # ── Reparse ───────────────────────────────────────────────────────────

    async def reparse(
        self,
        workspace_id: uuid.UUID,
        scope: list[str] | None = None,
    ) -> tuple[dict[str, int], ChangeParserResult]:
        """Reconcile ``ux_changes`` rows against the filesystem change tree.

        ``scope``（change 2026-08-14-change-center-conversation-driven / D-005@v1，
        design §5 P1）：
        - ``None``：全量 reparse（含 delete，现状语义不变，删除磁盘消失的变更行）。
        - ``[...]``：scoped reparse，**零 delete 红线（R-08）**——只对 scope 内 key
          create/update；scope 外变更不进 parsed 集合也不判删除；scope 内 key 磁盘
          确认消失也不删（留全量/手动重扫描收敛）。rename 检测同样只在全量模式下
          进行（scoped 是部分视图，跑 rename 匹配会把范围外变更误判为 orphaned）。
        - reparse 发现新变更（created）时按 design §8 绑定查询自动绑定该 workspace
          最近活跃会话（change_session_links 行，best-effort 失败不阻断 reparse）。
        """
        workspace = await self._workspace_service.get(workspace_id)
        # 平台 specRoot 有镜像数据就读（任意 strategy：platform-managed/repo-native/repo-mirrored）。
        # 旧逻辑只 platform-managed 读 spec_root，repo-native/repo-mirrored 读 root_path
        # （daemon-client 客户端路径容器内不可达）→ 扫不到 changes → 变更中心不显示。
        sillyspec_root = Path(workspace.root_path)
        try:
            from app.modules.spec_workspace.service import SpecWorkspaceService

            spec_ws = await SpecWorkspaceService(self._session).get(workspace.id)
            if spec_ws and spec_ws.spec_root:
                sillyspec_root = Path(spec_ws.spec_root)
        except Exception as exc:
            log.warning(
                "change.reparse_spec_root_resolve_failed",
                workspace_id=str(workspace_id),
                error=str(exc),
            )

        # task-08：工作区路径来源分流已删（FR-2）。daemon-client 同步产出扁平布局
        # （无 .sillyspec 包裹），parser 需 platform_managed=True 才能读到
        # specRoot/changes/。
        result = self._parser.parse_workspace(sillyspec_root, platform_managed=True, scope=scope)
        stats = {"parsed": 0, "created": 0, "updated": 0, "deleted": 0, "renamed": 0}

        # Fetch existing changes
        existing_changes = await self._fetch_existing_changes(workspace_id)
        existing_by_key = {c.change_key: c for c in existing_changes}

        # Detect directory renames before processing（仅全量模式；scoped 是部分视图，
        # 范围外变更的目录"消失"会被误判为 orphaned 而错配 rename）。
        parsed_key_set = {p.change_key for p in result.changes}
        rename_map: dict[str, Change] = {}
        if scope is None:
            rename_map = self._detect_renames(existing_by_key, parsed_key_set, sillyspec_root)

            # Update existing_by_key for renamed entries: old_key → new_key
            for new_key, old_row in rename_map.items():
                old_key = old_row.change_key
                existing_by_key.pop(old_key, None)
                existing_by_key[new_key] = old_row

        # Wave B（2026-07-25）：批量预取所有 existing change 的 docs（原 _sync_docs
        # 每 change 一次 _fetch_existing_docs = N+1）。新建 change 无 existing docs（[]）。
        existing_change_ids = [c.id for c in existing_by_key.values()]
        docs_by_change: dict[uuid.UUID, list[ChangeDocument]] = {}
        if existing_change_ids:
            for d in (
                (
                    await self._session.execute(
                        select(ChangeDocument).where(
                            ChangeDocument.change_id.in_(existing_change_ids)
                        )
                    )
                )
                .scalars()
                .all()
            ):
                docs_by_change.setdefault(d.change_id, []).append(d)

        seen_keys: set[str] = set()

        for parsed in result.changes:
            seen_keys.add(parsed.change_key)
            stats["parsed"] += 1

            if parsed.change_key in existing_by_key:
                row = existing_by_key[parsed.change_key]
                self._apply_parsed(row, parsed, workspace_id=workspace_id)
                if parsed.change_key in rename_map:
                    stats["renamed"] += 1
                else:
                    stats["updated"] += 1
            else:
                row = self._build_change(parsed, workspace_id=workspace_id)
                # D-004@v1（2026-08-01-proxy-create-race-fix）：极端并发撞
                # ux_changes_workspace_key（占坑 commit 与 reparse created 几乎同时）
                # 的兜底——用 savepoint 包 add+flush 即时检测唯一键冲突，撞键则回滚
                # savepoint（不影响外层 session 已累积的改动）、重查 existing 转走
                # _apply_parsed(update)，不抛 500。物理上几乎不可能（task-01 占坑让
                # reparse 走 update 而非 created），belt-and-suspenders（design §5
                # Phase 2b / R-02）。
                try:
                    async with self._session.begin_nested():
                        self._session.add(row)
                        await self._session.flush()
                except IntegrityError:
                    existing = await self._fetch_existing_changes(workspace_id)
                    hit = next(
                        (c for c in existing if c.change_key == parsed.change_key),
                        None,
                    )
                    if hit is None:
                        raise
                    row = hit
                    self._apply_parsed(row, parsed, workspace_id=workspace_id)
                    existing_by_key[parsed.change_key] = row
                    stats["updated"] += 1
                else:
                    stats["created"] += 1
                    # D-007（design §5 P1 / §8）：新变更自动绑定最近活跃会话。
                    # best-effort：绑定失败不阻断 reparse 主流程。
                    await self._bind_change_to_session(workspace_id, row.id)

            # Sync documents for this change
            _existing = existing_by_key.get(parsed.change_key, row)
            await self._sync_docs(
                change=parsed,
                workspace_id=workspace_id,
                existing_change=_existing,
                stats=stats,
                existing_docs=docs_by_change.get(_existing.id, []),
            )

            # D-005@V1：M:N change_workspaces 投影已废，变更只属单一 workspace，无需 sync。

        # Delete changes whose keys disappeared and were not renamed。
        # **scoped 零删除红线（R-08）**：scope 模式跳过整个删除循环——scope 外变更
        # 不进 parsed 集合也不判删除；scope 内 key 磁盘消失也不删（留全量/手动重扫描
        # 收敛）。删除仅发生在全量 reparse（scope=None，现状语义不变）。
        if scope is None:
            # ql-20260815-002 镜像滞后保护：CLI 最近一次上行仍报 status=active 且
            # 行内无任何文档（= platform_sync 首推占位行，spec tar 未跟上）的 key 不删，
            # 否则占位行「刚被进度上行建出、又被下一次全量 reparse 删掉」，变更中心
            # 先出现后消失。保护只覆盖从未同步过文档的占位行：有文档的行仍以镜像
            # 磁盘为权威（避免 stale progress 行让本地已删变更永生）。
            progress_active_keys = await self._progress_reported_active_keys(workspace_id)
            for key, row in existing_by_key.items():
                if key in seen_keys:
                    continue
                if key in progress_active_keys and not docs_by_change.get(row.id):
                    log.info(
                        "change.reparse_placeholder_kept",
                        workspace_id=str(workspace_id),
                        change_key=key,
                    )
                    continue
                await self._session.delete(row)
                stats["deleted"] += 1

        await self._session.commit()
        log.info("changes.reparsed", workspace_id=str(workspace_id), **stats)
        return stats, result

    async def _progress_reported_active_keys(self, workspace_id: uuid.UUID) -> set[str]:
        """ql-20260815-002：platform_change_progress 最近一次上行仍报 active 的 key 集合。

        读 ``(workspace_id, change_name)`` 收件箱行的 ``latest_progress.changes[]``，
        收 status=="active" 的 name。查询失败（表缺失等）按空集处理——best-effort，
        不阻断删除环（回退到无保护的现状语义）。
        """
        try:
            from app.modules.platform_sync.model import PlatformChangeProgressORM

            rows = (
                (
                    await self._session.execute(
                        select(PlatformChangeProgressORM).where(
                            col(PlatformChangeProgressORM.workspace_id) == workspace_id
                        )
                    )
                )
                .scalars()
                .all()
            )
        except Exception as exc:  # best-effort 守卫，任何 DB 异常降级空集
            log.warning(
                "change.reparse_progress_lookup_failed",
                workspace_id=str(workspace_id),
                error=str(exc),
            )
            return set()
        keys: set[str] = set()
        for r in rows:
            payload = r.latest_progress if isinstance(r.latest_progress, dict) else {}
            for c in payload.get("changes") or []:
                if isinstance(c, dict) and c.get("name") and c.get("status") == "active":
                    keys.add(str(c["name"]))
        return keys

    async def _bind_change_to_session(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
    ) -> None:
        """新变更自动绑定最近活跃会话（D-007 / design §8 绑定查询）。

        绑定查询语义固定（§8 SQL）：``deleted_at IS NULL``、``coalesce(last_active_at,
        created_at) DESC``、跨成员（变更属 workspace 不属个人）、不限 status（已结束
        会话也可绑，注入时按非 active 降级）。无会话命中不写 link。用 ORM
        ``select(AgentSession.id)`` 表达该 SQL——UUID 列类型转换 SQLite/PG 统一
        （raw text 绑定 uuid 在 SQLite 不可用，且 str(uuid) 带横线与 CHAR(32)
        十六进制存储不匹配）。

        best-effort：写入失败仅告警（savepoint 内，只回滚 link，不丢 change 行，
        不阻断 reparse 主流程）。
        """
        try:
            async with self._session.begin_nested():
                stmt = (
                    select(AgentSession.id)
                    .where(AgentSession.workspace_id == workspace_id)
                    .where(AgentSession.deleted_at.is_(None))
                    .order_by(
                        func.coalesce(
                            AgentSession.last_active_at,
                            AgentSession.created_at,
                        ).desc()
                    )
                    .limit(1)
                )
                session_id = (await self._session.execute(stmt)).scalar()
                if session_id is None:
                    return
                self._session.add(
                    ChangeSessionLink(
                        id=uuid.uuid4(),
                        change_id=change_id,
                        session_id=session_id,
                    )
                )
                await self._session.flush()
        except Exception as exc:
            log.warning(
                "change.session_bind_failed",
                change_id=str(change_id),
                workspace_id=str(workspace_id),
                error=str(exc),
            )

    @staticmethod
    def _detect_renames(
        existing_by_key: dict[str, Change],
        parsed_keys: set[str],
        sillyspec_root: Path,
    ) -> dict[str, Change]:
        """Detect directory renames by matching date prefix + directory absence.

        When sillyspec CLI renames a change directory, the old key disappears
        and a new key appears. This method matches them so the existing DB row
        keeps its workflow state (current_stage, human_gate, stages JSON).

        Returns a map of new_key → existing Change row for detected renames.
        """
        if not existing_by_key or not parsed_keys:
            return {}

        changes_dir = sillyspec_root / ".sillyspec" / "changes"

        # Find orphaned DB rows whose directories no longer exist on disk
        orphaned: dict[str, Change] = {}
        for key, row in existing_by_key.items():
            if key not in parsed_keys:
                dir_path = changes_dir / key
                if not dir_path.is_dir():
                    orphaned[key] = row

        new_keys = parsed_keys - set(existing_by_key.keys())
        if not orphaned or not new_keys:
            return {}

        result: dict[str, Change] = {}
        matched_old_keys: set[str] = set()

        for new_key in new_keys:
            new_prefix = new_key[:11]  # "YYYY-MM-DD-"
            candidates = [
                (old_key, row)
                for old_key, row in orphaned.items()
                if old_key[:11] == new_prefix and old_key not in matched_old_keys
            ]
            # Only match when unambiguous (exactly one candidate with same date)
            if len(candidates) == 1:
                result[new_key] = candidates[0][1]
                matched_old_keys.add(candidates[0][0])
                log.info(
                    "reparse.rename_detected",
                    old_key=candidates[0][0],
                    new_key=new_key,
                )

        return result

    # ── Helpers ───────────────────────────────────────────────────────────

    async def _fetch_existing_changes(self, workspace_id: uuid.UUID) -> list[Change]:
        stmt = select(Change).where(col(Change.workspace_id) == workspace_id)
        return list((await self._session.execute(stmt)).scalars().all())

    async def _sync_docs(
        self,
        *,
        change: ParsedChange,
        workspace_id: uuid.UUID,
        existing_change: Change,
        stats: dict[str, int],
        existing_docs: list[ChangeDocument] | None = None,
    ) -> None:
        # Wave B：existing_docs 由 reparse 批量预取传入；None 兜底单查（保留旧调用方）。
        if existing_docs is None:
            existing_docs = await self._fetch_existing_docs(existing_change.id)
        existing_by_key = {(d.doc_type, d.path): d for d in existing_docs}

        seen_keys: set[tuple[str, str]] = set()
        for parsed_doc in change.docs:
            key = (parsed_doc.doc_type, parsed_doc.path)
            seen_keys.add(key)

            if key in existing_by_key:
                row = existing_by_key[key]
                row.exists = parsed_doc.exists
                row.last_modified_at = parsed_doc.last_modified_at
            else:
                row = ChangeDocument(
                    id=uuid.uuid4(),
                    change_id=existing_change.id,
                    doc_type=parsed_doc.doc_type,
                    path=parsed_doc.path,
                    exists=parsed_doc.exists,
                    last_modified_at=parsed_doc.last_modified_at,
                )
                self._session.add(row)

        for key, row in existing_by_key.items():
            if key not in seen_keys:
                await self._session.delete(row)

    async def _fetch_existing_docs(self, change_id: uuid.UUID) -> list[ChangeDocument]:
        stmt = select(ChangeDocument).where(col(ChangeDocument.change_id) == change_id)
        return list((await self._session.execute(stmt)).scalars().all())

    # ── M:N Enrichment ──────────────────────────────────────────────────

    async def enrich_with_workspace_ids(self, change: Change) -> ChangeRead:
        """Build ChangeRead from the change row + 实时投影 current_stage（D-002@v1）。

        D-005@V1（变更 2026-07-06-component-readonly-split）：M:N 投影表已废，变更只属
        单一项目组 workspace（``Change.workspace_id``），不再追加 workspace_ids。方法名保留
        以避免 router 多处调用方连锁改动。

        Change 2026-08-11-change-progress-projection task-08：read-only 等值 join
        ``platform_change_progress``（按 ``(change.workspace_id, change.change_key)`` 复合键），
        命中且 ``latest_progress`` 解析出 ``current_stage`` 则覆盖 ChangeRead.current_stage
        （工具上行权威值），否则保留 change 现有值（D-003 fallback）。不投 status（D-004@v2）、
        不写 changes 表（D-002 read-only）。
        """
        change_read = ChangeRead.model_validate(change)
        projected = await self._project_current_stage([(change.workspace_id, change.change_key)])
        stage_info = projected.get((change.workspace_id, change.change_key))
        if stage_info is not None:
            # 仅投影 current_stage（NG-03：详情 READ 不改 pending_review，恒 None）。
            change_read.current_stage = stage_info[0]
        return change_read

    async def enrich_summaries(self, changes: list[Change]) -> list[ChangeSummary]:
        """Build ChangeSummary list + 批量投影 current_stage（D-002@v1 / R-03 禁 N+1）。

        D-005@V1 后不再查 M:N，直接 validate。task-08 加批量 IN join：从 changes 收集
        ``(workspace_id, change_key)`` 对集合一次 select 查询（复合 ``tuple_.in_``），
        构建 ``(workspace_id, change_key) → current_stage`` 映射逐条覆盖。join 不命中
        （工具未上行 / quick-uuid8 / workspace_id 为 NULL 过渡行）fallback 现有值（D-003）。
        """
        if not changes:
            return []
        pairs = [(c.workspace_id, c.change_key) for c in changes]
        projected = await self._project_current_stage(pairs)
        summaries: list[ChangeSummary] = []
        for c in changes:
            summary = ChangeSummary.model_validate(c)
            stage_info = projected.get((c.workspace_id, c.change_key))
            if stage_info is not None:
                stage, completed = stage_info
                summary.current_stage = stage
                # task-01（D-008）：pending_review 与 current_stage 同源（latest_progress
                # 镜像），复用 _map 纯函数（projection.py staticmethod，不读 sillyspec.db）。
                summary.pending_review = StageProjectionService._map(stage, completed)
            summaries.append(summary)
        return summaries

    async def _resolve_pending_change_keys(
        self, workspace_id: uuid.UUID, location: str | None
    ) -> set[str]:
        """算 pending_review 非空的 change_key 集合（ql-20260813-005 / gap②）。

        查 workspace（+location）全部 change_key → ``_project_current_stage`` 批量取
        latest_progress → ``StageProjectionService._map`` 算 pending_review 非空集合。
        复用 ``_map``（不翻译 SQL、不碰 JSON 数组展开语法），跨库稳定（PG/SQLite 均可）。
        返回全局真实待处理集合；空集合由调用方 ``list_`` 短路 ``([], 0)``。
        """
        stmt = select(Change.change_key).where(col(Change.workspace_id) == workspace_id)
        if location:
            stmt = stmt.where(col(Change.location) == location)
        keys = list((await self._session.execute(stmt)).scalars().all())
        if not keys:
            return set()
        projected = await self._project_current_stage([(workspace_id, k) for k in keys])
        pending: set[str] = set()
        for k in keys:
            info = projected.get((workspace_id, k))
            if info is None:
                continue
            stage, completed = info
            if StageProjectionService._map(stage, completed) is not None:
                pending.add(k)
        return pending

    async def _project_current_stage(
        self, pairs: list[tuple[uuid.UUID, str]]
    ) -> dict[tuple[uuid.UUID, str], tuple[str, set[str]]]:
        """批量 read-only join ``platform_change_progress`` 取权威 current_stage。

        一次 ``select where (workspace_id, change_name) in (pairs)``（复合 IN，R-03 禁 N+1）。
        返回 ``(workspace_id, change_name) → current_stage`` 映射；未命中/解析失败/异常一律
        不进映射（调用方 fallback 现有值，D-003）。latest_progress 结构异常不抛（防御性
        isinstance）。shk_live_ 过渡期 workspace_id=NULL 行不匹配任何 change.workspace_id
        （change.workspace_id 非 None）→ 自然 fallback。
        """
        if not pairs:
            return {}
        stmt = select(
            PlatformChangeProgressORM.workspace_id,
            PlatformChangeProgressORM.change_name,
            PlatformChangeProgressORM.latest_progress,
        ).where(
            tuple_(
                PlatformChangeProgressORM.workspace_id,
                PlatformChangeProgressORM.change_name,
            ).in_(pairs)
        )
        rows = (await self._session.execute(stmt)).all()
        mapping: dict[tuple[uuid.UUID, str], tuple[str, set[str]]] = {}
        for ws_id, change_name, latest_progress in rows:
            stage = self._extract_current_stage(latest_progress)
            if stage is not None and ws_id is not None:
                completed = self._extract_completed_stages(latest_progress)
                mapping[(ws_id, change_name)] = (stage, completed)
        return mapping

    @staticmethod
    def _resolve_order_by(sort: str):
        """sort 白名单 → SQLAlchemy 列表达式（task-02 / D-004，防 SQL 注入）。

        **禁止直接拼接 sort 到 SQL 字符串**：仅接受白名单内的键，每个键硬编码对应
        一个列表达式。未知值 fallback ``updated_at_desc``（默认，不抛），与 §9 兼容
        策略一致（旧客户端 / 误传值不报错）。返回值直接喂 ``query.order_by(...)``。
        """
        if sort == "updated_at_asc":
            return col(Change.updated_at).asc()
        if sort == "change_key":
            return col(Change.change_key).asc()
        # 默认 + 未知值 fallback：最近活动优先（updated_at desc）。
        return col(Change.updated_at).desc()

    @staticmethod
    def _extract_current_stage(latest_progress: dict | None) -> str | None:
        """从 ``latest_progress.changes[0].current_stage`` 解析权威 stage。

        裸 JSON 透传 serializeForSync 六表（NG-6 不强类型化），结构缺失/类型异常一律
        返 None（调用方 fallback 现有值，不抛）。
        """
        if not isinstance(latest_progress, dict):
            return None
        changes = latest_progress.get("changes")
        if not isinstance(changes, list) or not changes:
            return None
        first = changes[0]
        if not isinstance(first, dict):
            return None
        stage = first.get("current_stage")
        return stage if isinstance(stage, str) else None

    @staticmethod
    def _extract_completed_stages(latest_progress: dict | None) -> set[str]:
        """从 ``latest_progress.stages``（顶层数组）解析 ``status='completed'`` 的 stage 集合。

        task-01（D-008）：与 ``_extract_current_stage`` 同源同范式——裸 JSON 透传
        serializeForSync 六表（NG-6 不强类型化），结构缺失/类型异常一律返空 set
        （调用方 fallback，不抛）。spike-01 实证：``stages`` = 顶层 ``latest_progress["stages"]``
        数组（非 ``changes[0].stages``），元素 = sillyspec.db stages 表行序列化，字段
        ``stage``（stage 名）+ ``status``（'completed' 判定）；对齐
        ``projection._read_stage_progress_sync`` 的 ``SELECT stage FROM stages
        WHERE status='completed'`` 语义。
        """
        if not isinstance(latest_progress, dict):
            return set()
        stages = latest_progress.get("stages")
        if not isinstance(stages, list):
            return set()
        completed: set[str] = set()
        for item in stages:
            if not isinstance(item, dict):
                continue
            if item.get("status") != "completed":
                continue
            stage_name = item.get("stage")
            if isinstance(stage_name, str):
                completed.add(stage_name)
        return completed

    @staticmethod
    def _build_change(
        parsed: ParsedChange,
        *,
        workspace_id: uuid.UUID,
    ) -> Change:
        # ql-20260702-001：同步推断的 current_stage（fallback；dispatch 读
        # sillyspec.db 时覆盖）。新建行也必须存，否则 manual_dispatch 读
        # ``change.current_stage or "draft"`` 永远落到 draft（无 agent config）。
        return Change(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            change_key=parsed.change_key,
            title=parsed.title,
            status=parsed.status,
            location=parsed.location,
            path=parsed.path,
            affected_components=parsed.affected_components,
            change_type=parsed.change_type,
            current_stage=parsed.current_stage,
            # ql-20260813-008：新建行用文件 mtime 作 updated_at（反映真实活动而非写入时刻）。
            # or now fallback：空目录（last_modified_at=None）显式传 None 会绕过
            # default_factory 直接写 None 违反 NOT NULL，必须 fallback。
            updated_at=parsed.last_modified_at or datetime.now(UTC),
            owner_id=None,
        )

    @staticmethod
    def _apply_parsed(
        row: Change,
        parsed: ParsedChange,
        *,
        workspace_id: uuid.UUID,
    ) -> None:
        row.title = parsed.title
        # change_type: only overwrite when DB value is None (protect user-set values)
        if row.change_type is None and parsed.change_type is not None:
            row.change_type = parsed.change_type
        # affected_components: always overwrite (inferred value is more accurate)
        if parsed.affected_components:
            row.affected_components = parsed.affected_components
        row.change_key = parsed.change_key
        row.location = parsed.location
        row.path = parsed.path
        # ql-20260702-001：同步推断的 current_stage（fallback；dispatch 读 sillyspec.db 时覆盖）
        # D-002@v1（2026-08-01-proxy-create-race-fix）：仅扫描历史行（owner_id=None）才用
        # 文件推断覆盖；proxy/worktree-lease 创建行（owner_id 非空）stage 由 dispatch/transition
        # 权威，不被 reparse 覆盖（design §9 显式承认 worktree lease 行为收紧）。
        if parsed.current_stage is not None and row.owner_id is None:
            row.current_stage = parsed.current_stage
        # ql-20260813-008：updated_at 取较大值（文件 mtime vs 现值），不倒退——让"更新时间"
        # 反映变更目录文件真实活动。不按 owner_id 区分（展示字段，proxy 行也该反映）；
        # 手动操作（transition/review/dispatch 刷 now）一定 > 旧 mtime，自然保留。is not None
        # 守卫空目录（避免 None > datetime 抛 TypeError）。两边均 tz-aware 可直接比较。
        if parsed.last_modified_at is not None and row.updated_at is not None:
            # SQLite 返回 naive datetime，parsed mtime 带 UTC tzinfo，直接比较抛 TypeError。
            # 归一化：naive 视作 UTC（DB 列语义即 UTC），对齐 spec_workspace 同范式（646 行）。
            cur = row.updated_at
            if cur.tzinfo is None:
                cur = cur.replace(tzinfo=UTC)
            if parsed.last_modified_at > cur:
                row.updated_at = parsed.last_modified_at

    # ── Review Gate methods ────────────────────────────────────────────
    #
    # D-004@v2: 4 审核面板 = stage 完成事件投影（非 waiting step）。
    # 提交审核 = 先用 StageProjectionService.compute_pending_review 校验
    # 当前变更确实处于该面板（否则 InvalidTransition），再推进下一 stage
    # （复用 transition / rerun 语义），不再读写 change.human_gate。
    #
    # task-03（D-004 / 2026-08-14-change-center-conversation-driven design §5 P2）：
    # 通过/打回只落审批记录 + 阶段状态，**不再自动派发 agent**。通过类走
    # ``transition``（不派发）+ ``_upsert_projection_progress``（投影收敛）；
    # 打回类走 ``_record_stage_rework``（只记录回退，不派发）。``rerun_stage`` /
    # ``transition_with_dispatch`` 仍保留供 MCP advance_change_stage /
    # submit_stage_review 等外部显式调用方使用。

    async def _record_stage_rework(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        stage: str,
        *,
        comment: str | None = None,
        user_id: uuid.UUID | None = None,
    ) -> Change:
        """打回类审批：记录回退到 ``stage`` 的 rework 信息（不派发 agent，D-004 task-03）。

        语义与 ``rerun_stage`` 的落库段（review_history rerun 条目 + ``last_review``
        + audit log）保持一致，但**不派发 agent**——审批打回只落状态，agent 由
        会话驱动继续（design §2 闭环）。``rerun_stage`` 保留原样供 MCP 等外部
        显式调用方使用（task-08 / tools.py:submit_stage_review）。

        不改 ``current_stage``：打回目标/回退语义与既有 ``rerun_stage`` 一致
        （constraint：只删派发，不改回退目标）。
        """
        change = await self.get(workspace_id, change_id)

        # 1. Record comment to stages.review_history（对齐 rerun_stage:1861 同段）
        stages = dict(change.stages or {})
        review_history = stages.get("review_history", [])
        review_history.append(
            {
                "action": "rerun",
                "stage": stage,
                "comment": comment,
                "at": datetime.now(UTC).isoformat(),
            }
        )
        stages["review_history"] = review_history

        # 2. Update stages.last_review
        stages["last_review"] = {
            "action": "rerun",
            "stage": stage,
            "comment": comment,
            "at": datetime.now(UTC).isoformat(),
        }
        change.stages = stages
        change.updated_at = datetime.now(UTC)
        self._session.add(change)

        # 3. Write audit log
        from app.modules.workflow.model import AuditLog

        audit_entry = AuditLog(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            actor_id=user_id,
            action="change.rerun_stage",
            resource_type="change",
            resource_id=change.id,
            details_json=json.dumps({"stage": stage, "comment": comment}),
        )
        self._session.add(audit_entry)

        # 4. Commit DB changes（不派发）
        await self._session.commit()
        return change

    async def _upsert_projection_progress(self, change: Change, new_stage: str) -> None:
        """审批推进阶段后同步 upsert ``platform_change_progress`` 使读时投影收敛（R-09）。

        D-004（design §5 P2 / §7.5）：审批通过推进 ``current_stage`` 时，同步写
        平台进度镜像（source=platform，stage=新阶段，change_name=change 的 key，
        workspace 隔离按 ``PlatformChangeProgressORM`` 复合键），使读侧
        ``enrich_*``（latest_progress 覆盖，:1259-1271）立即投影新阶段，消除
        「回显旧阶段/重复审批」窗口。

        latest_progress 形状对齐 platform_sync serializeForSync 六表
        （``changes[0].current_stage`` 即读侧投影源，``_extract_current_stage``）。
        已有行（agent 上行过）→ 深拷贝原 latest_progress 仅更新 current_stage，
        不覆盖丢失其它结构；无行 → 构造最小六表 payload。

        best-effort（constraint）：失败仅告警，不阻断审批主流程。
        """
        try:
            stmt = select(PlatformChangeProgressORM).where(
                col(PlatformChangeProgressORM.workspace_id) == change.workspace_id,
                col(PlatformChangeProgressORM.change_name) == change.change_key,
            )
            row = (await self._session.execute(stmt)).scalar_one_or_none()

            if row is not None and isinstance(row.latest_progress, dict):
                payload = copy.deepcopy(row.latest_progress)
                changes = payload.get("changes")
                if isinstance(changes, list) and changes and isinstance(changes[0], dict):
                    changes[0]["current_stage"] = new_stage
                else:
                    payload["changes"] = [
                        {
                            "name": change.change_key,
                            "current_stage": new_stage,
                            "status": "in_progress",
                        }
                    ]
                row.latest_progress = payload
                await self._session.commit()
                return

            self._session.add(
                PlatformChangeProgressORM(
                    id=uuid.uuid4(),
                    workspace_id=change.workspace_id,
                    change_name=change.change_key,
                    latest_progress={
                        "project": {"name": change.change_key},
                        "changes": [
                            {
                                "name": change.change_key,
                                "current_stage": new_stage,
                                "status": "in_progress",
                            }
                        ],
                        "stages": [],
                        "steps": [],
                        "batch_progress": [],
                        "approvals": [],
                    },
                    last_pushed_at=None,
                    last_pusher="platform",
                )
            )
            await self._session.commit()
        except Exception as exc:
            await self._session.rollback()
            log.warning(
                "review_projection_upsert_failed",
                change_id=str(change.id),
                change_key=change.change_key,
                error=str(exc),
            )

    async def _assert_pending_review(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        expected: PendingReview,
    ) -> Change:
        """校验变更当前 pending_review == expected，不匹配抛 InvalidTransition。

        D-004@v2：审核端点提交前的前置校验，对应 sillyspec stage 完成事件
        投影。投影降级（db 缺失/读失败）返回 None 时也按不匹配处理。
        """
        change = await self.get(workspace_id, change_id)
        actual = await StageProjectionService(self._session).compute_pending_review(
            self._session, change_id
        )
        if actual != expected:
            raise InvalidTransition(
                f"当前状态不允许该审核提交: 期望 pending_review={expected.value}, "
                f"实际={actual.value if actual else None}",
                details={"expected": expected.value, "actual": actual.value if actual else None},
            )
        return change

    @staticmethod
    def _build_review_notify_message(
        change_key: str,
        stage_label: str,
        *,
        passed: bool,
        decision: str,
        comment: str | None,
    ) -> str:
        """组装审批注入消息（D-006@v2 / design §5 P5 固定格式）。

        格式：``[平台审批] 变更 <change_key> 的 <阶段> 审批已<通过/打回（decision）>。<意见>。请继续推进。``
        ``passed=True`` → 「通过」；``passed=False`` → 「打回（<decision>）」。comment 为
        None 时省略意见段（不留双句号）。消息固定由后端拼，前端不拼（constraint）。
        """
        outcome = "通过" if passed else f"打回（{decision}）"
        opinion = f"{comment}。" if comment else ""
        return (
            f"[平台审批] 变更 {change_key} 的 {stage_label} 审批已{outcome}。{opinion}请继续推进。"
        )

    async def _maybe_notify_session(
        self,
        workspace_id: uuid.UUID,
        change: Change,
        stage_label: str,
        *,
        passed: bool,
        decision: str,
        comment: str | None,
        notify_session: bool,
    ) -> dict[str, str | bool | None]:
        """审批落库后按需向绑定会话注入审批消息（D-006@v2）。

        ``notify_session=False``（请求显式关闭）→ 不注入，返回
        ``{"notified_session": False, "notify_error": None}``。否则组装固定格式
        消息并交给 :meth:`_notify_bound_session`（服务身份，best-effort 三类降级）。
        返回 ``notified_session`` / ``notify_error`` 供审批响应透传。
        """
        if not notify_session:
            return {"notified_session": False, "notify_error": None}
        message = self._build_review_notify_message(
            change.change_key,
            stage_label,
            passed=passed,
            decision=decision,
            comment=comment,
        )
        notified, notify_error = await self._notify_bound_session(workspace_id, change, message)
        return {"notified_session": notified, "notify_error": notify_error}

    async def _notify_bound_session(
        self,
        workspace_id: uuid.UUID,
        change: Change,
        message: str,
    ) -> tuple[bool, str | None]:
        """以服务身份向 change_session_links 最新绑定会话注入审批消息（D-006@v2）。

        取该 change 最新一条 link 的 session（design §8：``created_at DESC LIMIT 1``）；
        无绑定 → ``(False, None)``（不注入，前端按 notified_session=false 处理）。

        有绑定 → 复用 ``SessionService.inject_session_as_service``（服务身份，绕过
        ``_get_owned_session_for_update`` 用户归属校验——多成员工作区审批人可≠会话
        创建人）。best-effort（R-03）：三类降级映射——
          ``DaemonSessionTurnConflict`` → ``"turn_conflict"``（agent 忙）
          ``DaemonSessionNotActive`` → ``"session_inactive"``
          其它异常 → ``"inject_failed"``
        注入失败**不回滚审批**（审批记录/阶段状态已落库）。

        Args:
            workspace_id: 工作区 id（仅日志）。
            change: 已落库的 Change（取 change_key / id）。
            message: 固定格式注入消息（后端拼，前端不拼）。

        Returns:
            ``(notified_session, notify_error)``。
        """
        try:
            stmt = (
                select(ChangeSessionLink)
                .where(col(ChangeSessionLink.change_id) == change.id)
                .order_by(col(ChangeSessionLink.created_at).desc())
                .limit(1)
            )
            link = (await self._session.execute(stmt)).scalars().first()
            if link is None:
                return False, None
        except Exception as exc:
            log.warning(
                "change.notify_session_lookup_failed",
                workspace_id=str(workspace_id),
                change_id=str(change.id),
                error=str(exc),
            )
            return False, "inject_failed"

        from app.modules.daemon.session.service import (
            DaemonSessionNotActive,
            DaemonSessionTurnConflict,
            SessionService,
        )

        try:
            await SessionService(self._session).inject_session_as_service(
                link.session_id, prompt=message
            )
            return True, None
        except DaemonSessionTurnConflict:
            return False, "turn_conflict"
        except DaemonSessionNotActive:
            return False, "session_inactive"
        except Exception as exc:
            log.warning(
                "change.notify_session_inject_failed",
                workspace_id=str(workspace_id),
                change_id=str(change.id),
                change_key=change.change_key,
                session_id=str(link.session_id),
                error=str(exc),
            )
            return False, "inject_failed"

    async def proposal_review(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        decision: str,
        comment: str | None,
        user_id: uuid.UUID,
        *,
        notify_session: bool = True,
    ) -> dict:
        change = await self._assert_pending_review(
            workspace_id, change_id, PendingReview.PROPOSAL_REVIEW
        )

        # Record review_history before executing the action
        target_action_map = {
            "approve": "transition:plan",
            "revise": "rerun:brainstorm",
            "unclear": "rerun:brainstorm",
        }
        stages = dict(change.stages or {})
        review_history = stages.get("review_history", [])
        review_history.append(
            {
                "decision": decision,
                "comment": comment,
                "user_id": str(user_id),
                "submitted_at": datetime.now(UTC).isoformat(),
                "from_stage": change.current_stage,
                "target_action": target_action_map[decision],
            }
        )
        stages["review_history"] = review_history
        change.stages = stages
        self._session.add(change)
        await self._session.commit()

        if decision == "approve":
            # D-004（task-03）：审批通过只推进阶段（落 current_stage + 投影收敛），
            # 不自动派发 agent——agent 由会话驱动继续（design §2 / §5 P2）。
            change = await self.transition(
                workspace_id=workspace_id,
                change_id=change_id,
                target_stage="plan",
                user_role="admin",
                reason=comment or "proposal approved",
            )
            await self._upsert_projection_progress(change, "plan")
            notify = await self._maybe_notify_session(
                workspace_id,
                change,
                "proposal_review",
                passed=True,
                decision=decision,
                comment=comment,
                notify_session=notify_session,
            )
            return {"change": change, "agent_dispatch": None, **notify}
        # revise / unclear → 回退到 brainstorm 重跑（保持 brainstorm stage，只记录不派发）
        r = await self._record_stage_rework(
            workspace_id=workspace_id,
            change_id=change_id,
            stage="brainstorm",
            comment=comment,
            user_id=user_id,
        )
        notify = await self._maybe_notify_session(
            workspace_id,
            r,
            "proposal_review",
            passed=False,
            decision=decision,
            comment=comment,
            notify_session=notify_session,
        )
        return {
            "change": r,
            "agent_dispatch": None,
            **notify,
        }

    async def plan_review(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        decision: str,
        comment: str | None,
        user_id: uuid.UUID,
        *,
        notify_session: bool = True,
    ) -> dict:
        change = await self._assert_pending_review(
            workspace_id, change_id, PendingReview.PLAN_REVIEW
        )

        # Record review_history
        target_action_map = {
            "approve": "transition:execute",
            "replan": "rerun:plan",
            "back_to_propose": "rerun:brainstorm",
            "back_to_brainstorm": "rerun:brainstorm",
        }
        stages = dict(change.stages or {})
        review_history = stages.get("review_history", [])
        review_history.append(
            {
                "decision": decision,
                "comment": comment,
                "user_id": str(user_id),
                "submitted_at": datetime.now(UTC).isoformat(),
                "from_stage": change.current_stage,
                "target_action": target_action_map[decision],
            }
        )
        stages["review_history"] = review_history
        change.stages = stages
        self._session.add(change)
        await self._session.commit()

        if decision == "approve":
            # D-004（task-03）：审批通过只推进阶段，不自动派发 agent。
            change = await self.transition(
                workspace_id=workspace_id,
                change_id=change_id,
                target_stage="execute",
                user_role="admin",
                reason=comment or "plan approved",
            )
            await self._upsert_projection_progress(change, "execute")
            notify = await self._maybe_notify_session(
                workspace_id,
                change,
                "plan_review",
                passed=True,
                decision=decision,
                comment=comment,
                notify_session=notify_session,
            )
            return {"change": change, "agent_dispatch": None, **notify}
        if decision == "replan":
            # 保持 plan stage，重新跑 plan agent（只记录，不派发）
            r = await self._record_stage_rework(
                workspace_id=workspace_id,
                change_id=change_id,
                stage="plan",
                comment=comment,
                user_id=user_id,
            )
            notify = await self._maybe_notify_session(
                workspace_id,
                r,
                "plan_review",
                passed=False,
                decision=decision,
                comment=comment,
                notify_session=notify_session,
            )
            return {
                "change": r,
                "agent_dispatch": None,
                **notify,
            }
        # back_to_propose / back_to_brainstorm → 回到 brainstorm 重跑（只记录，不派发）
        r = await self._record_stage_rework(
            workspace_id=workspace_id,
            change_id=change_id,
            stage="brainstorm",
            comment=comment,
            user_id=user_id,
        )
        notify = await self._maybe_notify_session(
            workspace_id,
            r,
            "plan_review",
            passed=False,
            decision=decision,
            comment=comment,
            notify_session=notify_session,
        )
        return {
            "change": r,
            "agent_dispatch": None,
            **notify,
        }

    async def human_test(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        result: str,
        comment: str | None,
        user_id: uuid.UUID,
        *,
        notify_session: bool = True,
    ) -> dict:
        change = await self._assert_pending_review(
            workspace_id, change_id, PendingReview.HUMAN_TEST
        )

        # Record review_history
        target_action_map = {
            "pass": "transition:archive",
            "bug": "rerun:execute",
            "doc_mismatch": "rerun:brainstorm",
        }
        stages = dict(change.stages or {})
        review_history = stages.get("review_history", [])
        review_history.append(
            {
                "decision": result,
                "comment": comment,
                "user_id": str(user_id),
                "submitted_at": datetime.now(UTC).isoformat(),
                "from_stage": change.current_stage,
                "target_action": target_action_map[result],
            }
        )
        stages["review_history"] = review_history
        change.stages = stages
        self._session.add(change)
        await self._session.commit()

        if result == "pass":
            # D-004（task-03）：验收通过只推进阶段，不自动派发 agent。
            change = await self.transition(
                workspace_id=workspace_id,
                change_id=change_id,
                target_stage="archive",
                user_role="admin",
                reason=comment or "human test passed",
            )
            await self._upsert_projection_progress(change, "archive")
            notify = await self._maybe_notify_session(
                workspace_id,
                change,
                "human_test",
                passed=True,
                decision=result,
                comment=comment,
                notify_session=notify_session,
            )
            return {"change": change, "agent_dispatch": None, **notify}
        if result == "bug":
            # 回到 execute 重跑（只记录，不派发）
            r = await self._record_stage_rework(
                workspace_id=workspace_id,
                change_id=change_id,
                stage="execute",
                comment=comment,
                user_id=user_id,
            )
            notify = await self._maybe_notify_session(
                workspace_id,
                r,
                "human_test",
                passed=False,
                decision=result,
                comment=comment,
                notify_session=notify_session,
            )
            return {
                "change": r,
                "agent_dispatch": None,
                **notify,
            }
        # doc_mismatch → 回到 brainstorm 重跑（只记录，不派发）
        r = await self._record_stage_rework(
            workspace_id=workspace_id,
            change_id=change_id,
            stage="brainstorm",
            comment=comment,
            user_id=user_id,
        )
        notify = await self._maybe_notify_session(
            workspace_id,
            r,
            "human_test",
            passed=False,
            decision=result,
            comment=comment,
            notify_session=notify_session,
        )
        return {
            "change": r,
            "agent_dispatch": None,
            **notify,
        }

    # ── Stage completion ────────────────────────────────────────────────

    @staticmethod
    def _check_source_stage_completion(change: Change) -> None:
        """推进前置校验：源阶段（current_stage）必须已完成，否则拒绝推进。

        仅作用于 single 模式推进（``transition``）：手动点推进按钮（/transition、
        /advance-stage、MCP advance_change_stage、review approve 分支）前，强制源阶段
        用 CLI 客观进度证明"干完了"，堵住"没干活就推进"。team 模式推进走
        ``complete_stage``（不经 ``transition``，``daemon/run_sync/service.py:1762``
        直接调），team mission 收敛本就是强证据，不触达本函数。

        判据（用户决策 b + 缺失 fail-closed + 首次放行）：
        1. 首次启动（raw current_stage 为 draft / None / 空）→ 放行。
        2. 源阶段不在 stages JSON（``stages.get(source)`` 非 dict）→ 拒绝（fail-closed）。
        3. ``stages[source]["status"] == "completed"`` 且 ``steps.pending`` 为空 → 放行。
        4. 否则 → 拒绝。

        stages JSON 的源阶段结构由 single 模式 ``_sync_stage_status_daemon_client``
        写入（dispatch.py:1767）：``{status, steps:{completed, pending}, ...}``。
        复用 ``InvalidTransition``（errors.py，HTTP 422）带 message + details（前端读
        ``details.reason`` 做 UI）。

        Args:
            change: 待推进的 Change（只读，不改 stages）。

        Raises:
            InvalidTransition: 源阶段未完成或缺少完成度数据。
        """
        raw_current = change.current_stage
        if not raw_current or raw_current == "draft":  # 首次启动放行
            return

        stages = change.stages or {}
        source_block = stages.get(raw_current)
        if not isinstance(source_block, dict):  # 缺失 fail-closed
            raise InvalidTransition(
                f"源阶段 '{raw_current}' 未完成，无法推进（缺少完成度数据）",
                details={"source_stage": raw_current, "reason": "missing_stage_block"},
            )

        status = source_block.get("status")
        pending_steps = (source_block.get("steps") or {}).get("pending") or []

        if status == "completed" and len(pending_steps) == 0:  # 完成 → 放行
            return

        raise InvalidTransition(  # 未完成 → 拒绝
            f"源阶段 '{raw_current}' 未完成（status={status}, "
            f"pending_steps={len(pending_steps)}），无法推进",
            details={
                "source_stage": raw_current,
                "status": status,
                "pending_steps_count": len(pending_steps),
                "reason": "stage_not_completed",
            },
        )

    @staticmethod
    def _resolve_stage_completion(stage: str, result: str | None) -> tuple[str, str | None]:
        """Map stage + result to (new_current_stage, dispatch_target).

        See design.md "complete_stage 阶段映射".
        """
        if stage == "brainstorm":
            if result == "clear" or result is None:
                return ("plan", "plan")
            return ("brainstorm", None)

        if stage == "plan":
            return ("execute", "execute")

        if stage == "execute":
            return ("verify", "verify")

        if stage == "verify":
            if result == "passed":
                return ("archive", "archive")
            return ("verify", None)

        if stage == "archive":
            return ("archived", None)

        # Unknown stage — no change
        return (stage, None)

    async def complete_stage(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        stage: str,
        result: str | None = None,
        summary: str | None = None,
    ) -> CompleteStageResult:
        """Agent 完成某一阶段后，统一设置 current_stage。

        AD-01: 此方法只更新 DB 状态，不执行 agent dispatch。
        形态A：dispatch 交 advance_change_stage MCP tool 显式触发。
        """
        change = await self.get(workspace_id, change_id)
        new_stage, dispatch_target = self._resolve_stage_completion(stage, result)

        change.current_stage = new_stage
        change.updated_at = datetime.now(UTC)

        # D-007: archive stage 完成 → 投影 sillyspec archived 态到 change.status。
        # 删 archive_change 端点（task-01）后无人写 status，前端"已归档"筛选依赖此投影。
        # change.path 由 sillyspec run archive 移动目录后经 reparse 同步。
        if new_stage == "archived":
            change.status = "archived"
            change.location = "archive"
            change.archived_at = datetime.now(UTC)

        # dict() 浅拷贝：stages 是普通 Column(JSON) 非 MutableDict.as_mutable（model.py），
        # 直接 ``change.stages or {}`` 取引用原地改 + 回赋同对象，SQLAlchemy set 事件见
        # ``new is old`` 不标记 dirty → flush 不带 stages 列 → last_stage_completion 丢失。
        # 拷贝成新对象再回赋才能被检测为变更而落库（与 transition_with_dispatch 同源范式）。
        stages = dict(change.stages or {})
        stages["last_stage_completion"] = {
            "stage": stage,
            "result": result,
            "summary": summary,
            "new_stage": new_stage,
            "completed_at": datetime.now(UTC).isoformat(),
        }
        change.stages = stages

        from app.modules.workflow.model import AuditLog

        audit = AuditLog(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            actor_id=None,
            action="change.complete_stage",
            resource_type="change",
            resource_id=change.id,
            details_json=json.dumps({"stage": stage, "result": result, "new_stage": new_stage}),
        )
        self._session.add(audit)
        self._session.add(change)
        await self._session.commit()

        return CompleteStageResult(
            change=change,
            dispatch_target=dispatch_target,
            gate="none",
        )

    async def rerun_stage(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        stage: str,
        *,
        comment: str | None = None,
        user_id: uuid.UUID | None = None,
    ) -> RerunStageResult:
        """Re-run a stage by dispatching its agent after reviewer feedback.

        D-004@v2: 由 review 端点（proposal/plan/human-test 的 revise / replan /
        bug / back_to_* 分支）驱动。不再依赖 ``human_gate`` —— 是否允许 rerun
        已由调用方（review 端点）通过 ``_assert_pending_review`` 校验。stage
        可与 current_stage 不同（reviewer 要求回到更早 stage 重跑）。
        """
        change = await self.get(workspace_id, change_id)

        # 1. Record comment to stages.review_history
        stages = dict(change.stages or {})
        review_history = stages.get("review_history", [])
        review_history.append(
            {
                "action": "rerun",
                "stage": stage,
                "comment": comment,
                "at": datetime.now(UTC).isoformat(),
            }
        )
        stages["review_history"] = review_history

        # 2. Update stages.last_review
        stages["last_review"] = {
            "action": "rerun",
            "stage": stage,
            "comment": comment,
            "at": datetime.now(UTC).isoformat(),
        }
        change.stages = stages
        change.updated_at = datetime.now(UTC)
        self._session.add(change)

        # 3. Write audit log
        from app.modules.workflow.model import AuditLog

        audit_entry = AuditLog(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            actor_id=user_id,
            action="change.rerun_stage",
            resource_type="change",
            resource_id=change.id,
            details_json=json.dumps({"stage": stage, "comment": comment}),
        )
        self._session.add(audit_entry)

        # 4. Commit DB changes
        await self._session.commit()

        # 5. Dispatch agent for the target stage (best-effort, independent session)
        dispatched = False
        agent_dispatch: dict = {}
        if user_id is not None:
            try:
                from app.core.db import get_session_factory
                from app.modules.change.dispatch import dispatch

                factory = get_session_factory()
                async with factory() as dispatch_session:
                    agent_dispatch = await dispatch(
                        session=dispatch_session,
                        workspace_id=workspace_id,
                        change_id=change_id,
                        target_stage=stage,
                        user_id=user_id,
                    )
                    dispatched = True
            except Exception as exc:
                log.warning(
                    "rerun_stage_dispatch_failed",
                    change_id=str(change_id),
                    stage=stage,
                    error=str(exc),
                )
                agent_dispatch = {
                    "dispatched": False,
                    "reason": "dispatch_exception",
                    "error": str(exc),
                }

        return RerunStageResult(
            change=change,
            dispatched=dispatched,
            agent_dispatch=agent_dispatch,
        )

    async def archive_confirm(
        self,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
        comment: str | None,
        user_id: uuid.UUID,
        *,
        notify_session: bool = True,
    ) -> dict:
        """归档确认（D-004@v2 / D-007）。

        平台语义：用户在 archive stage 确认归档。本端点仅做 Hub 侧状态推进/
        记录（写 stages.archive_confirmed + review_history），不再写
        ``human_gate``，也不直接 dispatch / subprocess 跑 sillyspec CLI ——
        ``sillyspec run archive --done --confirm`` 由 daemon agent 在 archive
        stage 执行（design §5 P3、§7.5）。
        """
        change = await self._assert_pending_review(
            workspace_id, change_id, PendingReview.ARCHIVE_CONFIRM
        )

        # Record review_history + archive_confirmed flag（业务投影字段）
        stages = dict(change.stages or {})
        review_history = stages.get("review_history", [])
        review_history.append(
            {
                "decision": "archive_confirm",
                "comment": comment,
                "user_id": str(user_id),
                "submitted_at": datetime.now(UTC).isoformat(),
                "from_stage": change.current_stage,
                "target_action": "confirm:archive",
            }
        )
        stages["review_history"] = review_history
        stages["archive_confirmed"] = {
            "confirmed": True,
            "comment": comment,
            "user_id": str(user_id),
            "at": datetime.now(UTC).isoformat(),
        }
        change.stages = stages
        change.updated_at = datetime.now(UTC)
        self._session.add(change)
        await self._session.commit()

        # Hub 侧仅记录确认状态，不 dispatch、不写 human_gate（D-007：archive
        # 的 sillyspec CLI --confirm 由 daemon agent 执行）。
        # task-03（D-004）：返回 agent_dispatch 置空（null），与其它审批方法一致。
        notify = await self._maybe_notify_session(
            workspace_id,
            change,
            "archive_confirm",
            passed=True,
            decision="archive_confirm",
            comment=comment,
            notify_session=notify_session,
        )
        return {
            "change": change,
            "agent_dispatch": None,
            **notify,
        }
