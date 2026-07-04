"""Change Writer Service.

Creates change packages inside worktree lease directories and
syncs the DB accordingly. All file I/O is scoped to the lease root.

v4 layout: ``.sillyspec/changes/<change_key>/`` (no intermediate ``change/`` dir).
All generated .md files include YAML frontmatter with ``author`` and ``created_at``.
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import AppError, WorkspaceNotFound, WorktreeLeaseNotFound
from app.core.logging import get_logger
from app.core.spec_paths import SpecPathResolver
from app.modules.change.model import Change, ChangeDocument
from app.modules.change_writer.markdown_builder import (
    build_master_md,
)
from app.modules.workspace.model import Workspace
from app.modules.workspace.service import _rewrite_path, is_daemon_client_path_source
from app.modules.worktree.exec_env import ExecEnvBuilder
from app.modules.worktree.model import WorktreeLease

log = get_logger(__name__)


class ChangeWriteError(AppError):
    code = "CHANGE_WRITE_ERROR"
    http_status = 400


class ChangeWriterService:
    """Create changes and write markdown documents inside lease directories."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create_change(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        title: str,
        change_type: str | None = None,
        affected_components: list[str] | None = None,
        lease_id: uuid.UUID | None = None,
        description: str = "",
    ) -> Change:
        """Create a change directory + MASTER.md + proposal.md inside the lease worktree or workspace root.

        分流（design §5.3 Phase 3 / D-001@v1 / D-002@v1）：
        - ``lease_id is not None`` → server-local worktree 直写（原路径，零回归）。
        - ``lease_id is None`` + daemon-client workspace → 委托 ``proxy_create_change``
          经 lease-polling 代写队列下发 daemon。runtime 由 ``proxy_create_change`` 内部
          ``resolve_runtime_for_writeback`` 现算（D-001@v1），失败抛
          ``DaemonClientNoActiveSession``（结构化 code 渲染 toast）。
        - ``lease_id is None`` + server-local/repo-native → 原 ``_repo_dir_for_workspace``
          直写路径不变。

        D-002@v1（2026-07-05-daemon-client-change-binding-fix）：删 ``runtime_id``
        入参——写回始终用 binding + workspace.default_agent 现算，不再由 caller 传。
        """
        # 门禁（D-004@V1 / FR-05）：未扫描 workspace 不允许新建变更。
        # scan 从变更流程移除后，brainstorm 需要项目地图（scan_docs），
        # 未扫描 workspace 直接进 brainstorm 会缺地图 → 拒绝并引导先扫描。
        ws_for_gate = await self._session.get(Workspace, workspace_id)
        if ws_for_gate is None or ws_for_gate.deleted_at is not None:
            raise WorkspaceNotFound(
                "Workspace not found.",
                details={"workspace_id": str(workspace_id)},
            )
        if ws_for_gate.last_scanned_at is None:
            raise ChangeWriteError(
                "请先扫描工作区后再创建变更。",
                details={
                    "workspace_id": str(workspace_id),
                    "reason": "workspace_not_scanned",
                },
            )

        if lease_id is not None:
            lease = await self._get_active_lease(lease_id, user_id)
            if lease.workspace_id != workspace_id:
                raise ChangeWriteError(
                    "Lease does not belong to this workspace.",
                    details={"lease_id": str(lease_id), "workspace_id": str(workspace_id)},
                )
            repo_dir = ExecEnvBuilder().repo_dir(Path(lease.path))
        else:
            # No lease — server-local 直写 or daemon-client 经 proxy 代写。
            workspace = await self._session.get(Workspace, workspace_id)
            if workspace is None or workspace.deleted_at is not None:
                raise WorkspaceNotFound(
                    "Workspace not found.",
                    details={"workspace_id": str(workspace_id)},
                )
            if is_daemon_client_path_source(workspace.path_source):
                # daemon-client：必须经 proxy 代写（runtime 现算 + lease-polling 下发）。
                # runtime 解析失败由 proxy_create_change 内部抛 DaemonClientNoActiveSession
                # （替代旧 _repo_dir_for_workspace 的裸抛 'requires an active lease'）。
                from app.modules.change_writer.proxy import (
                    proxy_create_change,
                )

                return await proxy_create_change(
                    self._session,
                    workspace_id=workspace_id,
                    user_id=user_id,
                    title=title,
                    description=description,
                    change_type=change_type,
                )
            repo_dir = self._repo_dir_for_workspace(workspace)

        # Compute change_key from date + slugified title
        date_prefix = datetime.now(UTC).strftime("%Y-%m-%d")
        slug = re.sub(r"[^a-z0-9]+", "-", title.lower()).strip("-")[:40] or "untitled"
        change_key = f"{date_prefix}-{slug}-{uuid.uuid4().hex[:6]}"

        # v4 layout: .sillyspec/changes/<change_key>/  (no intermediate change/ dir)
        resolver = SpecPathResolver(repo_dir)
        change_dir = resolver.change_dir(change_key)
        change_dir.mkdir(parents=True, exist_ok=True)

        now = datetime.now(UTC)
        author = str(user_id)

        # Write MASTER.md with frontmatter
        master_content = build_master_md(
            title=title,
            change_type=change_type,
            affected_components=affected_components,
        )
        master_content = self._ensure_frontmatter(master_content, author, now)
        (change_dir / "MASTER.md").write_text(master_content, encoding="utf-8")

        # Write proposal.md with user description (with frontmatter)
        if description:
            proposal_content = f"# {title}\n\n## 需求描述\n\n{description}\n"
            proposal_content = self._ensure_frontmatter(proposal_content, author, now)
            (change_dir / "proposal.md").write_text(proposal_content, encoding="utf-8")

        # Write request.md with user's original requirement (with frontmatter)
        if description:
            request_content = f"# {title}\n\n{description}\n"
            request_content = self._ensure_frontmatter(request_content, author, now)
            (change_dir / "request.md").write_text(request_content, encoding="utf-8")

        # Create DB record
        change = Change(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            change_key=change_key,
            title=title,
            status="active",
            location="active",
            path=str(change_dir.relative_to(repo_dir)),
            affected_components=affected_components or [],
            change_type=change_type,
            owner_id=user_id,
            current_stage="draft",
            stages={"draft": {"status": "done", "at": now.isoformat()}},
        )
        self._session.add(change)

        # Add MASTER.md as a document
        doc = ChangeDocument(
            id=uuid.uuid4(),
            change_id=change.id,
            doc_type="master",
            path=str(change_dir.relative_to(repo_dir) / "MASTER.md"),
            exists=True,
            last_modified_at=now,
        )
        self._session.add(doc)

        # Add proposal.md as a document (if description was provided)
        if description:
            proposal_doc = ChangeDocument(
                id=uuid.uuid4(),
                change_id=change.id,
                doc_type="proposal",
                path=str(change_dir.relative_to(repo_dir) / "proposal.md"),
                exists=True,
                last_modified_at=now,
            )
            self._session.add(proposal_doc)

        # Add request.md as a document (if description was provided)
        if description:
            request_doc = ChangeDocument(
                id=uuid.uuid4(),
                change_id=change.id,
                doc_type="request",
                path=str(change_dir.relative_to(repo_dir) / "request.md"),
                exists=True,
                last_modified_at=now,
            )
            self._session.add(request_doc)

        await self._session.commit()
        await self._session.refresh(change)

        log.info(
            "change_created",
            change_id=str(change.id),
            change_key=change_key,
            lease_id=str(lease_id),
            current_stage="draft",
        )
        return change

    async def generate_document(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        change_id: uuid.UUID,
        doc_type: str,
        content: str,
        lease_id: uuid.UUID,
    ) -> tuple[str, int]:
        """Write a document (proposal/requirements/design/plan) into the change dir."""
        lease = await self._get_active_lease(lease_id, user_id)
        if lease.workspace_id != workspace_id:
            raise ChangeWriteError(
                "Lease does not belong to this workspace.",
                details={"lease_id": str(lease_id)},
            )

        # Resolve change
        change = await self._get_change(change_id, workspace_id)

        repo_dir = ExecEnvBuilder().repo_dir(Path(lease.path))
        change_dir = repo_dir / change.path
        if not change_dir.is_dir():
            raise ChangeWriteError(
                "Change directory does not exist in worktree.",
                details={"path": str(change_dir)},
            )

        # Use canonical filename from SpecPathResolver when available
        filename = SpecPathResolver.STANDARD_FILENAMES.get(doc_type, f"{doc_type}.md")
        file_path = change_dir / filename

        # Ensure frontmatter
        now = datetime.now(UTC)
        author = str(user_id)
        content = self._ensure_frontmatter(content, author, now)

        file_path.write_text(content, encoding="utf-8")
        size = file_path.stat().st_size

        # Upsert document record
        rel_path = str(file_path.relative_to(repo_dir))
        stmt = select(ChangeDocument).where(
            col(ChangeDocument.change_id) == change.id,
            col(ChangeDocument.doc_type) == doc_type,
        )
        existing = (await self._session.execute(stmt)).scalars().first()
        if existing:
            existing.exists = True
            existing.path = rel_path
            existing.last_modified_at = now
        else:
            doc = ChangeDocument(
                id=uuid.uuid4(),
                change_id=change.id,
                doc_type=doc_type,
                path=rel_path,
                exists=True,
                last_modified_at=now,
            )
            self._session.add(doc)

        await self._session.commit()

        log.info(
            "change_doc_generated",
            change_id=str(change_id),
            doc_type=doc_type,
            size=size,
        )
        return rel_path, size

    async def batch_generate_templates(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        change_id: uuid.UUID,
        doc_types: list[str],
        lease_id: uuid.UUID | None = None,
    ) -> list[str]:
        """Generate multiple template documents for a change.

        Returns list of generated doc types.
        """
        from app.modules.change_writer.markdown_builder import DOCUMENT_BUILDERS

        change = await self._get_change(change_id, workspace_id)

        if lease_id is not None:
            lease = await self._get_active_lease(lease_id, user_id)
            repo_dir = ExecEnvBuilder().repo_dir(Path(lease.path))
        else:
            workspace = await self._session.get(Workspace, workspace_id)
            if workspace is None or workspace.deleted_at is not None:
                raise WorkspaceNotFound(
                    "Workspace not found.",
                    details={"workspace_id": str(workspace_id)},
                )
            repo_dir = self._repo_dir_for_workspace(workspace)

        change_dir = repo_dir / change.path
        if not change_dir.is_dir():
            raise ChangeWriteError(
                "Change directory does not exist.",
                details={"path": str(change_dir)},
            )

        generated: list[str] = []
        now = datetime.now(UTC)
        author = str(user_id)

        for doc_type in doc_types:
            builder = DOCUMENT_BUILDERS.get(doc_type)
            if builder is None:
                continue
            content = builder(title=change.title or change.change_key)
            content = self._ensure_frontmatter(content, author, now)

            # Use canonical filename from SpecPathResolver when available
            filename = SpecPathResolver.STANDARD_FILENAMES.get(doc_type, f"{doc_type}.md")
            file_path = change_dir / filename
            file_path.write_text(content, encoding="utf-8")
            _size = file_path.stat().st_size
            rel_path = str(file_path.relative_to(repo_dir))

            stmt = select(ChangeDocument).where(
                col(ChangeDocument.change_id) == change.id,
                col(ChangeDocument.doc_type) == doc_type,
            )
            existing = (await self._session.execute(stmt)).scalars().first()
            if existing:
                existing.exists = True
                existing.path = rel_path
                existing.last_modified_at = now
            else:
                doc = ChangeDocument(
                    id=uuid.uuid4(),
                    change_id=change.id,
                    doc_type=doc_type,
                    path=rel_path,
                    exists=True,
                    last_modified_at=now,
                )
                self._session.add(doc)
            generated.append(doc_type)

        await self._session.commit()
        log.info(
            "change_docs_batch_generated",
            change_id=str(change_id),
            generated=generated,
        )
        return generated

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _repo_dir_for_workspace(workspace: Workspace) -> Path:
        """Resolve server-local workspace root for direct file writes."""
        if is_daemon_client_path_source(workspace.path_source):
            raise ChangeWriteError(
                "daemon-client workspace requires an active lease to write changes.",
                details={"workspace_id": str(workspace.id)},
            )
        return Path(_rewrite_path(workspace.root_path))

    @staticmethod
    def _ensure_frontmatter(content: str, author: str, created_at: datetime) -> str:
        """Ensure the markdown content starts with YAML frontmatter containing author + created_at.

        If content already starts with ``---``, leave it as-is (assume it has frontmatter).
        """
        if content.startswith("---"):
            return content

        frontmatter_block = (
            f'---\nauthor: "{author}"\ncreated_at: "{created_at.isoformat()}"\n---\n\n'
        )
        return frontmatter_block + content

    async def _get_active_lease(
        self,
        lease_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> WorktreeLease:
        stmt = select(WorktreeLease).where(col(WorktreeLease.id) == lease_id)
        lease = (await self._session.execute(stmt)).scalars().first()
        if lease is None:
            raise WorktreeLeaseNotFound(
                f"Worktree lease '{lease_id}' not found.",
                details={"lease_id": str(lease_id)},
            )
        if lease.user_id != user_id:
            raise WorktreeLeaseNotFound(
                "Not your worktree lease.",
                details={"lease_id": str(lease_id)},
            )
        if lease.status != "locked":
            raise ChangeWriteError(
                "Lease is not active.",
                details={"lease_id": str(lease_id), "status": lease.status},
            )
        return lease

    async def _get_change(
        self,
        change_id: uuid.UUID,
        workspace_id: uuid.UUID,
    ) -> Change:
        stmt = select(Change).where(
            col(Change.id) == change_id,
            col(Change.workspace_id) == workspace_id,
        )
        change = (await self._session.execute(stmt)).scalars().first()
        if change is None:
            raise ChangeWriteError(
                f"Change '{change_id}' not found.",
                details={"change_id": str(change_id)},
            )
        return change
