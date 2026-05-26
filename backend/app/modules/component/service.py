"""Component use cases.

The service is the only place that talks to both the filesystem (through
:class:`ComponentParser`) and the DB. Reparse is implemented as a full
diff-based UPSERT keyed by ``(workspace_id, component_key)``: rows that
disappeared from disk are removed, and ``component_relations`` is rebuilt
from scratch each run since relations have no stable id of their own.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import ComponentNotFound
from app.core.logging import get_logger
from app.modules.component.model import ComponentRelation, ProjectComponent
from app.modules.component.parser import (
    ComponentParser,
    ParsedComponent,
    ParsedRelation,
    ParseResult,
)
from app.modules.workspace.model import Workspace
from app.modules.workspace.service import WorkspaceService

log = get_logger(__name__)


class ComponentService:
    """List, fetch, reparse, and build topology for project components."""

    def __init__(
        self,
        session: AsyncSession,
        *,
        parser: ComponentParser | None = None,
        workspace_service: WorkspaceService | None = None,
    ) -> None:
        self._session = session
        self._parser = parser or ComponentParser()
        self._workspace_service = workspace_service or WorkspaceService(session)

    # ── Queries ───────────────────────────────────────────────────────────

    async def list_(self, workspace_id: uuid.UUID) -> tuple[list[ProjectComponent], int]:
        await self._workspace_service.get(workspace_id)
        stmt = (
            select(ProjectComponent)
            .where(col(ProjectComponent.workspace_id) == workspace_id)
            .order_by(col(ProjectComponent.component_key).asc())
        )
        items = list((await self._session.execute(stmt)).scalars().all())
        return items, len(items)

    async def get(self, workspace_id: uuid.UUID, component_id: uuid.UUID) -> ProjectComponent:
        await self._workspace_service.get(workspace_id)
        component = await self._session.get(ProjectComponent, component_id)
        if component is None or component.workspace_id != workspace_id:
            raise ComponentNotFound(
                "Component not found in this workspace.",
                details={
                    "workspace_id": str(workspace_id),
                    "component_id": str(component_id),
                },
            )
        return component

    async def topology(
        self, workspace_id: uuid.UUID
    ) -> tuple[list[ProjectComponent], list[ComponentRelation]]:
        components, _ = await self.list_(workspace_id)
        rel_stmt = select(ComponentRelation).where(
            col(ComponentRelation.workspace_id) == workspace_id
        )
        relations = list((await self._session.execute(rel_stmt)).scalars().all())
        return components, relations

    # ── Reparse ───────────────────────────────────────────────────────────

    async def reparse(
        self, workspace_id: uuid.UUID
    ) -> tuple[ParseResult, dict[str, int], list[ProjectComponent], list[ComponentRelation]]:
        """Parse ``.sillyspec/projects/*.yaml`` and reconcile into the DB.

        Returns ``(parse_result, stats, components, relations)`` so the router
        can surface warnings/errors alongside the persisted state.
        """
        workspace = await self._workspace_service.get(workspace_id)
        result = self._parser.parse(workspace.root_path)

        existing = await self._fetch_existing(workspace_id)
        existing_by_key = {c.component_key: c for c in existing}
        parsed_keys = {c.component_key for c in result.components}
        now = datetime.utcnow()

        stats = {
            "parsed": len(result.components),
            "created": 0,
            "updated": 0,
            "deleted": 0,
            "relations_created": 0,
            "relations_deleted": 0,
        }

        key_to_component: dict[str, ProjectComponent] = {}

        for parsed in result.components:
            if parsed.component_key in existing_by_key:
                row = existing_by_key[parsed.component_key]
                self._apply_parsed(row, parsed, workspace, now=now)
                stats["updated"] += 1
            else:
                row = self._build_row(parsed, workspace=workspace, now=now)
                self._session.add(row)
                stats["created"] += 1
            key_to_component[parsed.component_key] = row

        for key, row in existing_by_key.items():
            if key not in parsed_keys:
                await self._session.delete(row)
                stats["deleted"] += 1

        await self._session.flush()

        # Relations are stateless: drop & rebuild keeps logic trivial and
        # avoids hashing edges in two places.
        stats["relations_deleted"] = await self._purge_relations(workspace_id)
        new_relations = self._build_relations(
            workspace_id=workspace_id,
            relations=result.relations,
            key_to_component=key_to_component,
        )
        for rel in new_relations:
            self._session.add(rel)
        stats["relations_created"] = len(new_relations)

        await self._session.commit()

        components_out, _ = await self.list_(workspace_id)
        rel_stmt = select(ComponentRelation).where(
            col(ComponentRelation.workspace_id) == workspace_id
        )
        relations_out = list((await self._session.execute(rel_stmt)).scalars().all())
        log.info(
            "component.reparsed",
            workspace_id=str(workspace_id),
            **stats,
        )
        return result, stats, components_out, relations_out

    # ── Helpers ───────────────────────────────────────────────────────────

    async def _fetch_existing(self, workspace_id: uuid.UUID) -> list[ProjectComponent]:
        stmt = select(ProjectComponent).where(col(ProjectComponent.workspace_id) == workspace_id)
        return list((await self._session.execute(stmt)).scalars().all())

    async def _purge_relations(self, workspace_id: uuid.UUID) -> int:
        count_stmt = select(ComponentRelation).where(
            col(ComponentRelation.workspace_id) == workspace_id
        )
        count = len((await self._session.execute(count_stmt)).scalars().all())
        await self._session.execute(
            delete(ComponentRelation).where(col(ComponentRelation.workspace_id) == workspace_id)
        )
        return count

    @staticmethod
    def _build_row(
        parsed: ParsedComponent,
        *,
        workspace: Workspace,
        now: datetime,
    ) -> ProjectComponent:
        return ProjectComponent(
            id=uuid.uuid4(),
            workspace_id=workspace.id,
            component_key=parsed.component_key,
            name=parsed.name,
            type=parsed.type,
            role=parsed.role,
            path=parsed.path,
            repo_url=parsed.repo_url,
            default_branch=parsed.default_branch,
            tech_stack=parsed.tech_stack,
            build_command=parsed.build_command,
            test_command=parsed.test_command,
            source_yaml_path=parsed.source_yaml_path,
            status=parsed.status,
            extra=parsed.extra,
            created_at=now,
            updated_at=now,
        )

    @staticmethod
    def _apply_parsed(
        row: ProjectComponent,
        parsed: ParsedComponent,
        workspace: Workspace,
        *,
        now: datetime,
    ) -> None:
        row.name = parsed.name
        row.type = parsed.type
        row.role = parsed.role
        row.path = parsed.path
        row.repo_url = parsed.repo_url
        row.default_branch = parsed.default_branch
        row.tech_stack = parsed.tech_stack
        row.build_command = parsed.build_command
        row.test_command = parsed.test_command
        row.source_yaml_path = parsed.source_yaml_path
        row.status = parsed.status
        row.extra = parsed.extra
        row.updated_at = now

    @staticmethod
    def _build_relations(
        *,
        workspace_id: uuid.UUID,
        relations: list[ParsedRelation],
        key_to_component: dict[str, ProjectComponent],
    ) -> list[ComponentRelation]:
        seen: set[tuple[uuid.UUID, uuid.UUID, str]] = set()
        out: list[ComponentRelation] = []
        for rel in relations:
            source = key_to_component.get(rel.source_key)
            target = key_to_component.get(rel.target_key)
            if source is None or target is None:
                # Both sides must exist after reconciliation; otherwise the
                # parser would have warned and dropped the edge already.
                continue
            triplet = (source.id, target.id, rel.relation_type)
            if triplet in seen:
                continue
            seen.add(triplet)
            out.append(
                ComponentRelation(
                    id=uuid.uuid4(),
                    workspace_id=workspace_id,
                    source_component_id=source.id,
                    target_component_id=target.id,
                    relation_type=rel.relation_type,
                    description=rel.description,
                )
            )
        return out
