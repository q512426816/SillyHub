"""Build the full workspace topology graph."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.modules.workspace.model import Workspace, WorkspaceRelation
from app.modules.workspace.relation_schema import (
    TopologyEdge,
    TopologyNode,
    TopologyResponse,
)


class TopologyBuilder:
    """Build the full workspace topology graph."""

    @staticmethod
    async def build(session: AsyncSession) -> TopologyResponse:
        """
        1. SELECT all active workspaces (deleted_at IS NULL)
        2. SELECT all workspace_relations
        3. Assemble TopologyResponse with nodes + edges
        """
        # Fetch active workspaces
        ws_stmt = select(Workspace).where(col(Workspace.deleted_at).is_(None))
        workspaces = list((await session.execute(ws_stmt)).scalars().all())
        active_ids = {ws.id for ws in workspaces}

        nodes = [
            TopologyNode(
                id=ws.id,
                name=ws.name,
                slug=ws.slug,
                component_key=ws.component_key,
            )
            for ws in workspaces
        ]

        # Fetch all relations and filter to only those with both ends active
        rel_stmt = select(WorkspaceRelation)
        all_relations = list((await session.execute(rel_stmt)).scalars().all())

        edges = [
            TopologyEdge(
                id=rel.id,
                source_id=rel.source_id,
                target_id=rel.target_id,
                relation_type=rel.relation_type,
                description=rel.description,
            )
            for rel in all_relations
            if rel.source_id in active_ids and rel.target_id in active_ids
        ]

        return TopologyResponse(nodes=nodes, edges=edges)
