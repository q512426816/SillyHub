"""Workspace use cases.

This module is the single place that talks to both the filesystem (via
:class:`WorkspaceScanner`) and the DB. Routers stay thin and only translate
HTTP <-> service calls.
"""

from __future__ import annotations

import os
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.modules.agent.service import AgentService

from sqlalchemy import or_, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.config import get_settings
from app.core.errors import (
    WorkspaceNotFound,
    WorkspaceNotSillyspec,
    WorkspacePathDuplicate,
    WorkspacePathNotDir,
    WorkspacePathNotFound,
    WorkspacePermissionDenied,
    WorkspaceSlugDuplicate,
)
from app.core.logging import get_logger
from app.modules.agent.model import AgentRun
from app.modules.workspace.model import (
    AgentRunWorkspace,
    Workspace,
    WorkspaceRelation,
)
from app.modules.workspace.parser import (
    ParsedWorkspace,
    ParseResult,
    WorkspaceParser,
)
from app.modules.workspace.scanner import ScanResult, WorkspaceScanner
from app.modules.workspace.schema import WorkspaceCreate, WorkspaceUpdate, slugify

log = get_logger(__name__)


def _rewrite_path(root_path: str) -> str:
    """Rewrite a host-style path to the container mount if configured.

    When running inside Docker the host filesystem is not directly accessible.
    If ``host_path_prefix`` and ``container_path_prefix`` are set (via env vars),
    paths starting with the host prefix are rewritten to the container prefix.
    """
    settings = get_settings()
    host_prefix = settings.host_path_prefix
    container_prefix = settings.container_path_prefix
    if not host_prefix or not container_prefix:
        return root_path
    # Normalize both to forward-slash, ensure prefix ends with /
    normalized = root_path.replace("\\", "/").rstrip("/")
    host_norm = host_prefix.replace("\\", "/").rstrip("/") + "/"
    if normalized.startswith(host_norm) or normalized + "/" == host_norm:
        remainder = normalized[len(host_norm.rstrip("/")) :]
        # Ensure remainder starts with /
        if not remainder.startswith("/"):
            remainder = "/" + remainder
        return container_prefix.rstrip("/") + remainder
    return root_path


def is_daemon_client_path_source(path_source: str | None) -> bool:
    """True when root_path lives on a bound daemon machine (backend cannot stat it)."""
    return path_source == "daemon-client"


def resolve_root_path_for_server(
    root_path: str,
    path_source: str | None = "server-local",
) -> str | None:
    """Map root_path to a path the backend process can access.

    Returns ``None`` for daemon-client workspaces — callers must skip server-side
    filesystem checks and dispatch to the bound daemon instead.
    """
    if is_daemon_client_path_source(path_source):
        return None
    return _rewrite_path(root_path)


class WorkspaceService:
    """Coordinates filesystem scans and DB persistence for workspaces."""

    def __init__(self, session: AsyncSession, scanner: WorkspaceScanner | None = None) -> None:
        self._session = session
        self._scanner = scanner or WorkspaceScanner()

    # -- Scanning ---

    def scan(self, root_path: str) -> ScanResult:
        """Run a dry-run scan and translate filesystem problems to AppError."""
        resolved = _rewrite_path(root_path)
        path = Path(resolved)
        self._guard_path(path)
        return self._scanner.scan(path)

    # -- Create / list / get ---

    async def create(
        self,
        payload: WorkspaceCreate,
        *,
        created_by: uuid.UUID | None,
    ) -> Workspace:
        slug = payload.slug or slugify(payload.name)
        now = datetime.now(UTC)

        # If an active/pending workspace already exists for this root_path,
        # activate it instead of creating a new one.
        existing = await self._find_active_by_root_path(payload.root_path)
        if existing:
            if existing.status == "active":
                return existing
            # Pending workspace (e.g. from a previous scan-generate): activate it.
            existing.name = payload.name
            existing.slug = await self._ensure_unique_slug(slug)
            existing.status = "active"
            existing.default_agent = payload.default_agent
            existing.default_model = payload.default_model
            existing.updated_at = now
            existing.last_scanned_at = now
            await self._session.flush()
            # Check if platform storage already has .sillyspec (scan-generate case)
            await self._ensure_spec_workspace_from_platform(existing)
            await self.session.commit()
            await self.session.refresh(existing)
            log.info("workspace.activated_from_create", workspace_id=str(existing.id))
            return existing

        # ── FR-06 / D-003@v1：daemon-client 分支（backend 读不到客户端 root_path）──
        if self._is_daemon_client_payload(payload):
            workspace = Workspace(
                id=uuid.uuid4(),
                name=payload.name,
                slug=slug,
                root_path=payload.root_path,
                status="active",
                path_source="daemon-client",
                daemon_runtime_id=payload.daemon_runtime_id,
                component_key=payload.component_key,
                type=payload.type,
                role=payload.role,
                repo_url=payload.repo_url,
                default_branch=payload.default_branch,
                default_agent=payload.default_agent,
                default_model=payload.default_model,
                tech_stack=payload.tech_stack,
                build_command=payload.build_command,
                test_command=payload.test_command,
                source_yaml_path=payload.source_yaml_path,
                created_by=created_by,
                created_at=now,
                updated_at=now,
                last_scanned_at=now,
            )
            self._session.add(workspace)
            await self._session.flush()
            # 空 SpecWorkspace 占位（strategy=platform-managed），内容由后续 scan lease 填充
            await self._ensure_empty_spec_workspace(workspace.id)
            await self._session.commit()
            await self._session.refresh(workspace)
            log.info(
                "workspace.created.daemon_client",
                workspace_id=str(workspace.id),
                daemon_runtime_id=str(workspace.daemon_runtime_id),
            )
            return workspace

        # For new workspaces, scan local path for .sillyspec
        scan = self.scan(payload.root_path)
        if not scan.is_sillyspec:
            raise WorkspaceNotSillyspec(
                "Provided root_path is not a SillySpec workspace.",
                details={"root_path": payload.root_path, "warnings": scan.warnings},
            )

        # Soft-deleted rows keep the same root_path, so before inserting a
        # fresh row we look for a tombstone we can resurrect. This is the
        # natural user expectation: "I removed it, now I want it back".
        revived = await self._resurrect_soft_deleted(
            root_path=payload.root_path,
            payload=payload,
            slug=slug,
            created_by=created_by,
            now=now,
        )
        if revived is not None:
            return revived

        workspace = Workspace(
            id=uuid.uuid4(),
            name=payload.name,
            slug=slug,
            root_path=payload.root_path,
            status="active",
            component_key=payload.component_key,
            type=payload.type,
            role=payload.role,
            repo_url=payload.repo_url,
            default_branch=payload.default_branch,
            default_agent=payload.default_agent,
            default_model=payload.default_model,
            tech_stack=payload.tech_stack,
            build_command=payload.build_command,
            test_command=payload.test_command,
            source_yaml_path=payload.source_yaml_path,
            created_by=created_by,
            created_at=now,
            updated_at=now,
            last_scanned_at=now,
        )

        self._session.add(workspace)
        try:
            await self._session.flush()
        except IntegrityError as exc:
            await self._session.rollback()
            self._translate_integrity_error(exc, slug=slug, root_path=scan.root_path)
            raise  # _translate_integrity_error always raises; this is unreachable

        # Create SpecWorkspace with repo-native strategy
        await self._ensure_spec_workspace(workspace.id, scan.sillyspec_path)

        await self._session.commit()
        await self._session.refresh(workspace)
        log.info(
            "workspace.created",
            workspace_id=str(workspace.id),
            slug=workspace.slug,
            root_path=workspace.root_path,
        )
        return workspace

    async def _resurrect_soft_deleted(
        self,
        *,
        root_path: str,
        payload: WorkspaceCreate,
        slug: str,
        created_by: uuid.UUID | None,
        now: datetime,
    ) -> Workspace | None:
        """Reactivate a soft-deleted workspace that has the same root_path.

        Returns the revived row on success or ``None`` if no tombstone exists.
        Raises :class:`WorkspaceSlugDuplicate` when the desired slug is already
        taken by another active workspace.
        """
        stmt = (
            select(Workspace)
            .where(col(Workspace.root_path) == root_path)
            .where(col(Workspace.deleted_at).is_not(None))
            .order_by(col(Workspace.deleted_at).desc())
            .limit(1)
        )
        result = (await self._session.execute(stmt)).scalars().first()
        if result is None:
            return None

        result.name = payload.name
        result.slug = await self._ensure_unique_slug(slug)
        result.status = "active"
        result.deleted_at = None
        result.created_by = created_by
        result.last_scanned_at = now
        result.updated_at = now
        # Update component metadata fields if provided
        result.component_key = payload.component_key
        result.type = payload.type
        result.role = payload.role
        result.repo_url = payload.repo_url
        result.default_branch = payload.default_branch
        result.default_agent = payload.default_agent
        result.default_model = payload.default_model
        result.tech_stack = payload.tech_stack
        result.build_command = payload.build_command
        result.test_command = payload.test_command
        result.source_yaml_path = payload.source_yaml_path

        try:
            await self._session.flush()
        except IntegrityError as exc:
            await self._session.rollback()
            self._translate_integrity_error(exc, slug=slug, root_path=root_path)
            raise

        # Ensure SpecWorkspace exists for resurrected workspace
        # FR-06 / D-003@v1：daemon-client 跳过本地 copytree（backend 读不到客户端路径）
        if self._is_daemon_client_payload(payload):
            result.path_source = "daemon-client"
            result.daemon_runtime_id = payload.daemon_runtime_id
            await self._ensure_empty_spec_workspace(result.id)
        else:
            scan = self.scan(root_path)
            if scan.is_sillyspec:
                await self._ensure_spec_workspace(result.id, scan.sillyspec_path)

        await self._session.commit()
        await self._session.refresh(result)
        log.info(
            "workspace.resurrected",
            workspace_id=str(result.id),
            slug=result.slug,
            root_path=result.root_path,
        )
        return result

    async def list_(
        self,
        *,
        include_deleted: bool = False,
        limit: int = 100,
        offset: int = 0,
    ) -> tuple[list[Workspace], int]:
        stmt = select(Workspace)
        if not include_deleted:
            stmt = stmt.where(col(Workspace.deleted_at).is_(None))
        stmt = stmt.order_by(col(Workspace.created_at).desc()).limit(limit).offset(offset)

        items = list((await self._session.execute(stmt)).scalars().all())

        count_stmt = select(Workspace)
        if not include_deleted:
            count_stmt = count_stmt.where(col(Workspace.deleted_at).is_(None))
        total = len((await self._session.execute(count_stmt)).scalars().all())
        return items, total

    async def get(self, workspace_id: uuid.UUID) -> Workspace:
        workspace = await self._session.get(Workspace, workspace_id)
        if workspace is None or workspace.deleted_at is not None:
            raise WorkspaceNotFound(
                "Workspace not found.",
                details={"workspace_id": str(workspace_id)},
            )
        return workspace

    # -- Mutate ---

    async def rescan(self, workspace_id: uuid.UUID) -> tuple[Workspace, ScanResult]:
        workspace = await self.get(workspace_id)

        # For platform-managed workspaces, scan from spec_root instead of root_path
        from app.modules.spec_workspace.service import SpecWorkspaceService

        try:
            spec_ws_svc = SpecWorkspaceService(self._session)
            spec_ws = await spec_ws_svc.get(workspace.id)
            if workspace.path_source == "daemon-client":
                # Client root_path is not on the backend host; rescan platform spec only.
                scan_path = spec_ws.spec_root
            else:
                scan_path = (
                    spec_ws.spec_root
                    if spec_ws.strategy == "platform-managed"
                    else workspace.root_path
                )
        except Exception:
            if workspace.path_source == "daemon-client":
                raise WorkspaceNotSillyspec(
                    "daemon-client workspace has no platform spec to rescan.",
                    details={"workspace_id": str(workspace.id)},
                ) from None
            scan_path = workspace.root_path

        scan = self.scan(scan_path)
        workspace.last_scanned_at = datetime.now(UTC)
        workspace.updated_at = workspace.last_scanned_at

        if scan.is_sillyspec and scan.structure.has_projects_dir:
            try:
                await self.reparse(workspace_id)
                log.info("workspace.rescan.projects_imported", workspace_id=str(workspace.id))
            except Exception as exc:
                log.warning(
                    "workspace.rescan.projects_import_failed",
                    workspace_id=str(workspace.id),
                    error=str(exc),
                )

        await self._session.commit()
        await self._session.refresh(workspace)
        log.info(
            "workspace.rescanned",
            workspace_id=str(workspace.id),
            is_sillyspec=scan.is_sillyspec,
        )
        return workspace, scan

    async def soft_delete(self, workspace_id: uuid.UUID) -> Workspace:
        workspace = await self.get(workspace_id)
        now = datetime.now(UTC)
        workspace.deleted_at = now
        workspace.updated_at = now
        workspace.status = "deleted"
        await self._session.commit()
        await self._session.refresh(workspace)
        log.info("workspace.soft_deleted", workspace_id=str(workspace.id))
        return workspace

    async def update(
        self,
        workspace_id: uuid.UUID,
        payload: WorkspaceUpdate,
    ) -> Workspace:
        """Update an existing workspace with only the fields provided by the caller.

        Uses ``exclude_unset=True`` so omitted fields are left untouched.
        """
        ws = await self.get(workspace_id)
        changes = payload.model_dump(exclude_unset=True)
        if changes:
            # Pre-check slug uniqueness before mutating to avoid rollback issues
            # with SQLite sessions.
            new_slug = changes.get("slug")
            if new_slug is not None and new_slug != ws.slug:
                slug_stmt = (
                    select(Workspace)
                    .where(col(Workspace.slug) == new_slug)
                    .where(col(Workspace.deleted_at).is_(None))
                )
                existing = (await self._session.execute(slug_stmt)).scalars().first()
                if existing is not None:
                    raise WorkspaceSlugDuplicate(
                        "Another workspace already uses this slug.",
                        details={"slug": new_slug},
                    )

            for field, value in changes.items():
                setattr(ws, field, value)
            ws.updated_at = datetime.now(UTC)
            await self._session.commit()
            await self._session.refresh(ws)
            log.info(
                "workspace.updated",
                workspace_id=str(ws.id),
                updated_fields=list(changes.keys()),
            )
        return ws

    # -- Generate projects from module-map ---

    async def generate_projects(
        self,
        workspace_id: uuid.UUID,
    ) -> dict:
        """Read _module-map.yaml, generate projects/*.yaml grouped by prefix, then reparse.

        Returns stats dict from reparse.
        """
        import yaml

        ws = await self.get(workspace_id)

        # Determine spec_root
        from app.modules.spec_workspace.service import SpecWorkspaceService

        spec_ws_svc = SpecWorkspaceService(self._session)
        spec_root: str | None = None
        try:
            spec_ws = await spec_ws_svc.get(ws.id)
            if spec_ws.strategy == "platform-managed" and spec_ws.spec_root:
                spec_root = spec_ws.spec_root
        except Exception:
            pass
        if not spec_root:
            spec_root = _rewrite_path(ws.root_path)

        module_map_path = (
            Path(spec_root) / ".sillyspec" / "docs" / ws.name / "modules" / "_module-map.yaml"
        )
        if not module_map_path.is_file():
            raise WorkspaceNotSillyspec(f"No _module-map.yaml found at {module_map_path}")

        with module_map_path.open("r", encoding="utf-8") as f:
            module_map = yaml.safe_load(f)

        modules = module_map.get("modules", {})
        if not modules:
            return {
                "generated_files": 0,
                "reparse": {"parsed": 0, "created": 0, "updated": 0, "deleted": 0},
            }

        # Group modules by prefix (e.g. "backend-agent" -> "backend", "core-config" -> "core")
        groups: dict[str, list[tuple[str, dict]]] = {}
        for key, info in modules.items():
            if not isinstance(info, dict):
                continue
            prefix = key.split("-")[0] if "-" in key else key
            groups.setdefault(prefix, []).append((key, info))

        # Generate projects/*.yaml
        projects_dir = Path(spec_root) / ".sillyspec" / "projects"
        projects_dir.mkdir(parents=True, exist_ok=True)

        # Collect all paths to detect tech_stack and build commands
        tech_stack_map = {
            "backend": ["Python", "FastAPI", "SQLAlchemy", "Pydantic"],
            "frontend": ["TypeScript", "Next.js", "React", "Tailwind CSS"],
            "core": ["Python", "SQLAlchemy", "Redis"],
        }

        generated_files = 0
        all_relations: list[dict] = []
        component_keys: set[str] = set()

        for prefix, members in sorted(groups.items()):
            component_key = prefix
            component_keys.add(component_key)

            # Collect paths
            paths = set()
            for _key, info in members:
                for p in info.get("paths", []):
                    paths.add(p)

            # Determine relative path from workspace root
            rel_path = paths.pop() if len(paths) == 1 else None
            if rel_path:
                # Make it relative
                root_path = _rewrite_path(ws.root_path)
                if rel_path.startswith(root_path):
                    rel_path = os.path.relpath(rel_path, root_path).replace("\\", "/")

            # Collect depends_on across members for relations
            for _key, info in members:
                for dep in info.get("depends_on", []):
                    dep_prefix = dep.split("-")[0] if "-" in dep else dep
                    if dep_prefix != prefix and dep_prefix in groups:
                        all_relations.append(
                            {
                                "target": dep_prefix,
                                "type": "depends_on",
                            }
                        )

            name_map = {
                "backend": "Backend API",
                "frontend": "Frontend App",
                "core": "Core Infrastructure",
            }

            project_def: dict = {
                "id": component_key,
                "name": name_map.get(prefix, prefix.capitalize()),
                "type": "component",
                "role": "service" if prefix in ("backend", "frontend") else "library",
                "tech_stack": tech_stack_map.get(prefix, []),
            }
            if rel_path:
                project_def["path"] = rel_path
            if all_relations:
                # Deduplicate
                seen = set()
                unique = []
                for r in all_relations:
                    k = (r["target"], r["type"])
                    if k not in seen:
                        seen.add(k)
                        unique.append(r)
                project_def["relations"] = unique

            out_path = projects_dir / f"{component_key}.yaml"
            with out_path.open("w", encoding="utf-8") as f:
                yaml.dump(
                    project_def, f, default_flow_style=False, allow_unicode=True, sort_keys=False
                )
            generated_files += 1

        # Now reparse to create child workspaces
        _parse_result, stats, children, _relations = await self.reparse(workspace_id)

        return {
            "generated_files": generated_files,
            "reparse": stats,
            "children": [
                {"id": str(c.id), "name": c.name, "component_key": c.component_key, "slug": c.slug}
                for c in children
            ],
        }

    # -- Reparse ---

    async def reparse(
        self,
        workspace_id: uuid.UUID,
    ) -> tuple[ParseResult, dict[str, int], list[Workspace], list[WorkspaceRelation]]:
        """Parse projects/*.yaml under a parent Workspace and create child
        Workspaces + WorkspaceRelations.

        Args:
            workspace_id: Parent Workspace UUID.

        Returns:
            tuple of (ParseResult, stats, children, relations).

        Raises:
            WorkspaceNotFound: if workspace_id is missing or soft-deleted.
        """
        # 1. Verify parent workspace
        ws = await self.get(workspace_id)

        # 2. Determine parse root — prefer spec_root for platform-managed
        from app.modules.spec_workspace.service import SpecWorkspaceService

        spec_ws_svc = SpecWorkspaceService(self._session)
        parse_root: str | None = None
        try:
            spec_ws = await spec_ws_svc.get(ws.id)
            if spec_ws.strategy == "platform-managed" and spec_ws.spec_root:
                parse_root = spec_ws.spec_root
        except Exception:
            pass
        root_path = parse_root or _rewrite_path(ws.root_path)
        # For building child root_paths, always use the original host root
        host_root = _rewrite_path(ws.root_path)

        # 3. Call parser (reads YAML from parse root)
        parser = WorkspaceParser()
        parse_result = parser.parse(root_path)

        # 4. path_missing re-validation
        for pw in parse_result.workspaces:
            if pw.status == "path_missing" and pw.path:
                resolved = Path(host_root) / pw.path
                if resolved.exists():
                    pw.status = "active"

        # 5. Query existing child workspaces
        # Children have root_path under host_root/ (constructed by _build_child_root_path).
        normalized_host = host_root.replace("\\", "/")
        stmt = select(Workspace).where(
            col(Workspace.root_path).like(normalized_host + "/%"),
            col(Workspace.deleted_at).is_(None),
        )
        existing_rows = list((await self._session.execute(stmt)).scalars().all())
        # Also find orphaned children from previous parse_root-based paths
        if parse_root and parse_root != host_root:
            normalized_parse = parse_root.replace("\\", "/")
            orphan_stmt = select(Workspace).where(
                col(Workspace.root_path).like(normalized_parse + "/%"),
                col(Workspace.deleted_at).is_(None),
            )
            for row in (await self._session.execute(orphan_stmt)).scalars().all():
                if row not in existing_rows:
                    existing_rows.append(row)
        existing_children: dict[str, Workspace] = {
            ws.source_yaml_path: ws for ws in existing_rows if ws.source_yaml_path
        }
        existing_by_key: dict[str, Workspace] = {
            ws.component_key: ws for ws in existing_rows if ws.component_key
        }

        # 6. Iterate parsed workspaces — UPSERT
        stats: dict[str, int] = {
            "parsed": 0,
            "created": 0,
            "updated": 0,
            "deleted": 0,
            "relations_created": 0,
            "relations_deleted": 0,
        }
        seen_child_ids: set[uuid.UUID] = set()

        for pw in parse_result.workspaces:
            stats["parsed"] += 1
            child_root = self._build_child_root_path(host_root, pw)

            # Skip if child root_path would collide with parent
            if os.path.normpath(child_root) == os.path.normpath(host_root):
                stats["parsed"] -= 1
                continue

            # Match existing row
            existing = existing_children.get(pw.source_yaml_path) or existing_by_key.get(
                pw.component_key
            )

            if existing:
                # UPDATE
                existing.name = pw.name
                existing.type = pw.type
                existing.role = pw.role
                existing.repo_url = pw.repo_url
                existing.default_branch = pw.default_branch
                existing.tech_stack = pw.tech_stack
                existing.build_command = pw.build_command
                existing.test_command = pw.test_command
                existing.source_yaml_path = pw.source_yaml_path
                existing.component_key = pw.component_key
                existing.root_path = child_root
                existing.updated_at = datetime.now(UTC)
                stats["updated"] += 1
                seen_child_ids.add(existing.id)
            else:
                # CREATE
                slug = (slugify(pw.name)[:78] + "-" + pw.component_key[:20])[:100]
                child = Workspace(
                    id=uuid.uuid4(),
                    name=pw.name,
                    slug=slug,
                    root_path=child_root,
                    status="active",
                    component_key=pw.component_key,
                    type=pw.type,
                    role=pw.role,
                    repo_url=pw.repo_url,
                    default_branch=pw.default_branch,
                    tech_stack=pw.tech_stack,
                    build_command=pw.build_command,
                    test_command=pw.test_command,
                    source_yaml_path=pw.source_yaml_path,
                    created_by=None,
                    created_at=datetime.now(UTC),
                    updated_at=datetime.now(UTC),
                )
                self._session.add(child)
                stats["created"] += 1
                seen_child_ids.add(child.id)

        await self._session.flush()

        # 7. Soft-delete removed children
        for _source_path, child in existing_children.items():
            if child.id not in seen_child_ids:
                child.deleted_at = datetime.now(UTC)
                child.status = "deleted"
                child.updated_at = datetime.now(UTC)
                stats["deleted"] += 1

        await self._session.flush()

        # 8. Delete old relations + create new relations
        # Collect key -> id mapping from all children (including newly created)
        all_children_stmt = select(Workspace).where(col(Workspace.id).in_(seen_child_ids))
        all_children = list((await self._session.execute(all_children_stmt)).scalars().all())
        key_to_id: dict[str, uuid.UUID] = {
            ws.component_key: ws.id for ws in all_children if ws.component_key
        }

        # Delete old relations where source or target is in seen_child_ids
        old_rels_stmt = select(WorkspaceRelation).where(
            or_(
                col(WorkspaceRelation.source_id).in_(seen_child_ids),
                col(WorkspaceRelation.target_id).in_(seen_child_ids),
            )
        )

        deleted_rel_ids: set[uuid.UUID] = set()
        for rel in (await self._session.execute(old_rels_stmt)).scalars().all():
            if rel.id not in deleted_rel_ids:
                await self._session.delete(rel)
                deleted_rel_ids.add(rel.id)
                stats["relations_deleted"] += 1

        await self._session.flush()

        # Create new relations with in-memory dedup
        seen_edges: set[tuple[uuid.UUID, uuid.UUID, str]] = set()
        for pr in parse_result.relations:
            src_id = key_to_id.get(pr.source_key)
            tgt_id = key_to_id.get(pr.target_key)
            if not src_id or not tgt_id:
                continue
            edge = (src_id, tgt_id, pr.relation_type)
            if edge in seen_edges:
                continue
            seen_edges.add(edge)
            rel = WorkspaceRelation(
                id=uuid.uuid4(),
                source_id=src_id,
                target_id=tgt_id,
                relation_type=pr.relation_type,
                description=pr.description,
            )
            self._session.add(rel)
            stats["relations_created"] += 1

        # 9. Commit + return
        await self._session.commit()

        # Re-query final state
        final_children = list(
            (
                await self._session.execute(
                    select(Workspace).where(col(Workspace.id).in_(seen_child_ids))
                )
            )
            .scalars()
            .all()
        )
        final_rels = list(
            (
                await self._session.execute(
                    select(WorkspaceRelation).where(
                        or_(
                            col(WorkspaceRelation.source_id).in_(seen_child_ids),
                            col(WorkspaceRelation.target_id).in_(seen_child_ids),
                        )
                    )
                )
            )
            .scalars()
            .all()
        )

        return parse_result, stats, final_children, final_rels

    @staticmethod
    def _build_child_root_path(parent_root: str, parsed: ParsedWorkspace) -> str:
        """Construct the root_path for a child Workspace.

        Rules:
        1. parsed.path is absolute (host path) -> rewrite via _rewrite_path
        2. parsed.path is relative -> os.path.join(parent_root, parsed.path)
        3. parsed.path is None or empty -> parent_root + "/" + component_key

        Returns forward-slash normalized path.
        """
        if parsed.path:
            p = parsed.path.replace("\\", "/")
            # Detect absolute Windows (C:/...) or Posix (/...) paths
            is_absolute = (len(p) >= 2 and p[1] == ":") or p.startswith("/")
            if is_absolute:
                return _rewrite_path(parsed.path)
            joined = os.path.join(parent_root, parsed.path)
            return os.path.normpath(joined).replace("\\", "/")
        return os.path.normpath(parent_root).replace("\\", "/") + "/" + parsed.component_key

    # -- Scan-generate ---

    async def scan_generate(
        self,
        *,
        root_path: str,
        user_id: uuid.UUID,
        agent_service: "AgentService",
        provider: str | None = None,
        model: str | None = None,
    ) -> tuple[uuid.UUID, uuid.UUID]:
        """Create workspace + spec_workspace and trigger scan agent.

        Args:
            root_path: Absolute path to the user's project directory.
            user_id: User who initiated the scan request.
            agent_service: AgentService instance (injected by caller).

        Returns:
            (workspace_id, agent_run_id) tuple.

        Raises:
            WorkspacePathNotFound: root_path does not exist.
            WorkspacePathNotDir: root_path is not a directory.
            WorkspacePermissionDenied: Insufficient path permissions.
        """
        # 1. Validate root_path
        resolved = _rewrite_path(root_path)
        path = Path(resolved)
        self._guard_path(path)

        # 2. Idempotency: check if active workspace already exists for this root_path
        workspace = await self._find_active_by_root_path(root_path)

        if workspace is None:
            # 3. Create Workspace record
            name = Path(root_path).name
            slug = slugify(name)

            # 2b. Check slug uniqueness, append suffix if taken
            existing_slug = await self._find_active_by_slug(slug)
            if existing_slug is not None:
                suffix = uuid.uuid4().hex[:8]
                slug = f"{slugify(name)[:90]}-{suffix}"

            now = datetime.now(UTC)
            workspace = Workspace(
                id=uuid.uuid4(),
                name=name,
                slug=slug,
                root_path=root_path,
                status="pending",
                created_by=user_id,
                created_at=now,
                updated_at=now,
                last_scanned_at=now,
            )
            self._session.add(workspace)
            await self._session.flush()  # obtain workspace.id

            # 4. Create SpecWorkspace record
            from app.modules.spec_workspace.schema import SpecWorkspaceCreate
            from app.modules.spec_workspace.service import SpecWorkspaceService

            spec_ws_svc = SpecWorkspaceService(self._session)
            await spec_ws_svc.create(
                workspace_id=workspace.id,
                payload=SpecWorkspaceCreate(
                    strategy="platform-managed",
                ),
            )

        # 5a. Idempotency: reuse in-progress scan run if one exists
        existing_run = await self._find_active_scan_run(workspace.id)
        if existing_run is not None:
            log.info(
                "workspace.scan_generate.idempotent_hit",
                workspace_id=str(workspace.id),
                agent_run_id=str(existing_run.id),
                status=existing_run.status,
            )
            return (workspace.id, existing_run.id)

        # 5. Get spec_root from SpecWorkspace
        from app.modules.spec_workspace.service import SpecWorkspaceService

        spec_ws_svc = SpecWorkspaceService(self._session)
        spec_ws = await spec_ws_svc.get(workspace.id)
        spec_root = spec_ws.spec_root

        # 6. Trigger agent scan dispatch
        agent_run = await agent_service.start_scan_dispatch(
            workspace_id=workspace.id,
            user_id=user_id,
            root_path=root_path,
            spec_root=spec_root,
            provider=provider,
            model=model,
        )

        # 7. Return
        log.info(
            "workspace.scan_generated",
            workspace_id=str(workspace.id),
            agent_run_id=str(agent_run.id),
            root_path=root_path,
        )
        return (workspace.id, agent_run.id)

    async def scan_generate_daemon_client(
        self,
        *,
        root_path: str,
        user_id: uuid.UUID,
        daemon_runtime_id: uuid.UUID,
        agent_service: "AgentService",
        provider: str | None = None,
        model: str | None = None,
    ) -> tuple[uuid.UUID, uuid.UUID]:
        """daemon-client scan-generate：创建 pending workspace + 派 scan lease 给绑定 daemon。

        FR-06 / D-003@v1：backend 读不到客户端 root_path，跳过 _guard_path 本地校验；
        workspace.path_source='daemon-client' + daemon_runtime_id 绑定；dispatch 经
        task-03 强绑到 daemon_runtime_id。scan 产出由 daemon 端 sillyspec scan 生成 →
        task-09 postSpecSync 回传 → backend spec_root 覆盖（真理源在服务器）。
        """
        workspace = await self._find_active_by_root_path(root_path)
        if workspace is None:
            name = Path(root_path).name
            slug = slugify(name)
            existing_slug = await self._find_active_by_slug(slug)
            if existing_slug is not None:
                suffix = uuid.uuid4().hex[:8]
                slug = f"{slugify(name)[:90]}-{suffix}"
            now = datetime.now(UTC)
            workspace = Workspace(
                id=uuid.uuid4(),
                name=name,
                slug=slug,
                root_path=root_path,
                status="pending",
                path_source="daemon-client",
                daemon_runtime_id=daemon_runtime_id,
                created_by=user_id,
                created_at=now,
                updated_at=now,
                last_scanned_at=now,
            )
            self._session.add(workspace)
            await self._session.flush()
            await self._ensure_empty_spec_workspace(workspace.id)

        existing_run = await self._find_active_scan_run(workspace.id)
        if existing_run is not None:
            return (workspace.id, existing_run.id)

        from app.modules.spec_workspace.service import SpecWorkspaceService

        spec_ws_svc = SpecWorkspaceService(self._session)
        spec_ws = await spec_ws_svc.get(workspace.id)
        spec_root = spec_ws.spec_root

        agent_run = await agent_service.start_scan_dispatch(
            workspace_id=workspace.id,
            user_id=user_id,
            root_path=root_path,
            spec_root=spec_root,
            provider=provider,
            model=model,
        )
        log.info(
            "workspace.scan_generated.daemon_client",
            workspace_id=str(workspace.id),
            agent_run_id=str(agent_run.id),
            daemon_runtime_id=str(daemon_runtime_id),
        )
        return (workspace.id, agent_run.id)

    @staticmethod
    def _is_daemon_client_payload(payload: object) -> bool:
        """判断创建/扫描请求是否为 daemon-client 路径来源（FR-06 / D-003@v1）。

        task-01 schema validator 已保证 path_source='daemon-client' 时
        daemon_runtime_id 非空，此处只读字段不做二次校验。
        """
        return getattr(payload, "path_source", "server-local") == "daemon-client"

    async def _ensure_empty_spec_workspace(self, workspace_id: uuid.UUID) -> None:
        """为 daemon-client workspace 创建空 SpecWorkspace 占位（无 .sillyspec 内容）。

         与 _ensure_spec_workspace 区别：不 copytree，只建记录（strategy=platform-managed，
         spec_root 由 SpecWorkspaceService 内部生成 {SPEC_DATA_ROOT}/{ws_id}），
        内容由后续 scan lease 产出经 task-09 sync 回传覆盖。
        """
        from app.modules.spec_workspace.schema import SpecWorkspaceCreate
        from app.modules.spec_workspace.service import SpecWorkspaceService

        spec_ws_svc = SpecWorkspaceService(self._session)
        try:
            await spec_ws_svc.get(workspace_id)
        except Exception:
            await spec_ws_svc.create(
                workspace_id=workspace_id,
                payload=SpecWorkspaceCreate(strategy="platform-managed"),
            )

    async def _find_active_by_root_path(self, root_path: str) -> Workspace | None:
        """Find active (non-soft-deleted) workspace by root_path.

        Returns:
            Workspace record or None.
        """
        stmt = (
            select(Workspace)
            .where(col(Workspace.root_path) == root_path)
            .where(col(Workspace.deleted_at).is_(None))
            .limit(1)
        )
        return (await self._session.execute(stmt)).scalars().first()

    async def _find_active_scan_run(self, workspace_id: uuid.UUID) -> AgentRun | None:
        """Find the most recent in-progress (pending/running) scan run
        associated with the given workspace.

        A scan run is identified by change_id IS NULL (it is not tied to a
        change execution). Returns None if no in-progress scan run exists.
        """
        arw_subq = select(AgentRunWorkspace.agent_run_id).where(
            col(AgentRunWorkspace.workspace_id) == workspace_id,
        )
        stmt = (
            select(AgentRun)
            .where(col(AgentRun.id).in_(arw_subq))
            .where(col(AgentRun.change_id).is_(None))
            .where(col(AgentRun.status).in_(["pending", "running"]))
            .order_by(col(AgentRun.started_at).desc())
            .limit(1)
        )
        return (await self._session.execute(stmt)).scalars().first()

    async def _find_active_by_slug(self, slug: str) -> Workspace | None:
        """Find active (non-soft-deleted) workspace by slug.

        Returns:
            Workspace record or None.
        """
        stmt = (
            select(Workspace)
            .where(col(Workspace.slug) == slug)
            .where(col(Workspace.deleted_at).is_(None))
            .limit(1)
        )
        return (await self._session.execute(stmt)).scalars().first()

    async def _ensure_unique_slug(self, slug: str) -> str:
        """Return a unique slug, appending a short suffix if the slug is taken."""
        existing = await self._find_active_by_slug(slug)
        if existing is None:
            return slug
        suffix = uuid.uuid4().hex[:8]
        return f"{slug[:90]}-{suffix}"

    async def activate(self, workspace_id: uuid.UUID) -> Workspace:
        """Activate a pending workspace: copy .sillyspec, set status='active'."""
        workspace = await self.get(workspace_id)
        if workspace.status != "pending":
            return workspace

        workspace.status = "active"
        workspace.updated_at = datetime.now(UTC)
        workspace.last_scanned_at = datetime.now(UTC)

        # Scan and copy .sillyspec to platform storage
        # FR-06 / D-003@v1：daemon-client 跳过本地扫描（backend 读不到客户端路径）
        if workspace.path_source == "daemon-client":
            await self._ensure_empty_spec_workspace(workspace.id)
        else:
            scan = self.scan(workspace.root_path)
            if scan.is_sillyspec:
                await self._ensure_spec_workspace(workspace.id, scan.sillyspec_path)

        await self._session.commit()
        await self._session.refresh(workspace)
        log.info("workspace.activated", workspace_id=str(workspace.id))
        return workspace

    # -- Helpers ---

    async def _ensure_spec_workspace_from_platform(
        self,
        workspace: Workspace,
    ) -> None:
        """Ensure spec workspace exists — prefer platform storage if already present."""
        from app.modules.spec_workspace.service import SpecWorkspaceService

        spec_ws_svc = SpecWorkspaceService(self._session)
        try:
            spec_ws = await spec_ws_svc.get(workspace.id)
            if spec_ws.strategy == "platform-managed" and spec_ws.spec_root:
                platform_sillyspec = Path(spec_ws.spec_root) / ".sillyspec"
                if platform_sillyspec.is_dir():
                    # Platform storage already has .sillyspec — just reimport children
                    try:
                        await self.reparse(workspace.id)
                        log.info("spec_workspace.projects_imported", workspace_id=str(workspace.id))
                    except Exception as exc:
                        log.warning(
                            "spec_workspace.projects_import_failed",
                            workspace_id=str(workspace.id),
                            error=str(exc),
                        )
                    try:
                        from app.modules.change.service import ChangeService

                        change_svc = ChangeService(self._session)
                        await change_svc.reparse(workspace.id)
                        log.info("spec_workspace.changes_imported", workspace_id=str(workspace.id))
                    except Exception as exc:
                        log.warning(
                            "spec_workspace.changes_import_failed",
                            workspace_id=str(workspace.id),
                            error=str(exc),
                        )
                    return
        except Exception:
            pass
        # No spec_workspace or no .sillyspec on platform — try local scan (server-local only)
        if workspace.path_source != "daemon-client":
            scan = self.scan(workspace.root_path)
            if scan.is_sillyspec:
                await self._ensure_spec_workspace(workspace.id, scan.sillyspec_path)

    async def _ensure_spec_workspace(
        self,
        workspace_id: uuid.UUID,
        sillyspec_path: str,
    ) -> None:
        """Copy .sillyspec to platform storage and import projects + changes."""
        import shutil

        from app.modules.spec_workspace.schema import SpecWorkspaceCreate
        from app.modules.spec_workspace.service import SpecWorkspaceService

        settings = get_settings()
        platform_root = f"{settings.spec_data_root}/{workspace_id}"
        platform_sillyspec = Path(platform_root) / ".sillyspec"

        # Copy .sillyspec tree from source to platform directory,
        # excluding .runtime/ (worktrees/artifacts — large, not needed on platform)
        source = Path(sillyspec_path)
        if source.is_dir():
            try:
                if platform_sillyspec.exists():
                    shutil.rmtree(platform_sillyspec)
                shutil.copytree(
                    str(source),
                    str(platform_sillyspec),
                    ignore=shutil.ignore_patterns(".runtime"),
                    ignore_dangling_symlinks=True,
                )
                log.info(
                    "spec_workspace.sillyspec_copied",
                    workspace_id=str(workspace_id),
                    source=str(source),
                    dest=str(platform_sillyspec),
                )
            except Exception as exc:
                log.warning(
                    "spec_workspace.sillyspec_copy_failed",
                    workspace_id=str(workspace_id),
                    source=str(source),
                    error=str(exc),
                )

        spec_ws_svc = SpecWorkspaceService(self._session)
        try:
            await spec_ws_svc.get(workspace_id)
        except Exception:
            await spec_ws_svc.create(
                workspace_id=workspace_id,
                payload=SpecWorkspaceCreate(
                    spec_root=platform_root,
                    strategy="platform-managed",
                    repo_sillyspec_path=sillyspec_path,
                ),
            )

        # Import projects and changes from .sillyspec into DB
        try:
            await self.reparse(workspace_id)
            log.info("spec_workspace.projects_imported", workspace_id=str(workspace_id))
        except Exception as exc:
            log.warning(
                "spec_workspace.projects_import_failed",
                workspace_id=str(workspace_id),
                error=str(exc),
            )

        try:
            from app.modules.change.service import ChangeService

            change_svc = ChangeService(self._session)
            await change_svc.reparse(workspace_id)
            log.info("spec_workspace.changes_imported", workspace_id=str(workspace_id))
        except Exception as exc:
            log.warning(
                "spec_workspace.changes_import_failed",
                workspace_id=str(workspace_id),
                error=str(exc),
            )

    @staticmethod
    def _guard_path(path: Path) -> None:
        """Translate filesystem problems into structured AppErrors."""
        try:
            if not path.exists():
                raise WorkspacePathNotFound(
                    "The given root_path does not exist.",
                    details={"root_path": str(path)},
                )
            if not path.is_dir():
                raise WorkspacePathNotDir(
                    "The given root_path is not a directory.",
                    details={"root_path": str(path)},
                )
        except PermissionError as exc:
            raise WorkspacePermissionDenied(
                "Permission denied while inspecting root_path.",
                details={"root_path": str(path), "error": str(exc)},
            ) from exc

    @staticmethod
    def _translate_integrity_error(
        exc: IntegrityError,
        *,
        slug: str,
        root_path: str,
    ) -> None:
        """Map Postgres UNIQUE violations onto specific AppError subclasses."""
        msg = str(exc.orig or exc).lower()
        if "uq_workspaces_root_path" in msg or "root_path" in msg:
            raise WorkspacePathDuplicate(
                "Another workspace is already registered for this root_path.",
                details={"root_path": root_path},
            ) from exc
        if "uq_workspaces_slug" in msg or "slug" in msg:
            raise WorkspaceSlugDuplicate(
                "Another workspace already uses this slug.",
                details={"slug": slug},
            ) from exc
        # Fallback: re-raise as duplicate path which is the most common case.
        raise WorkspacePathDuplicate(
            "Workspace uniqueness constraint violated.",
            details={"root_path": root_path, "slug": slug},
        ) from exc
