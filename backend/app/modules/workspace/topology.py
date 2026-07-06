"""构建工作区拓扑图（D-004@V1，变更 2026-07-06-component-readonly-split）。

关系层已砍：``workspace_relations`` 表 + ``WorkspaceRelation`` 模型 + relation_service/schema
全部移除。topology 退化为只返回**项目组节点**（``component_key IS NULL`` 的活跃 workspace），
``edges`` 恒为空数组。Topology* schema 从 ``relation_schema.py``（已删）搬入本模块，保持
``GET /workspaces/topology`` 响应契约不变（前端类型无需改）。
"""

from __future__ import annotations

import uuid

from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.modules.workspace.model import Workspace


class TopologyNode(BaseModel):
    """拓扑图中的工作区节点（项目组）。"""

    id: uuid.UUID
    name: str
    slug: str
    component_key: str | None


class TopologyEdge(BaseModel):
    """拓扑图中的有向边（关系层已砍，保留类型以维持响应契约，恒不实例化）。"""

    id: uuid.UUID
    source_id: uuid.UUID
    target_id: uuid.UUID
    relation_type: str
    description: str | None


class TopologyResponse(BaseModel):
    """``GET /workspaces/topology`` 响应（D-004@V1 后 edges 恒空）。"""

    nodes: list[TopologyNode]
    edges: list[TopologyEdge]


class TopologyBuilder:
    """构建工作区拓扑图（退化：只项目组节点，无边）。"""

    @staticmethod
    async def build(session: AsyncSession) -> TopologyResponse:
        """返回所有活跃项目组节点（``component_key IS NULL``），edges 恒空。

        组件不再是 workspace 行（D-001@V1），项目组 = ``component_key`` 为空的活跃 workspace；
        过滤 ``component_key IS NULL`` 兼容 W3 migration 前的 brownfield（残留 component 行）。
        """
        ws_stmt = select(Workspace).where(
            col(Workspace.deleted_at).is_(None),
            col(Workspace.component_key).is_(None),
        )
        workspaces = list((await session.execute(ws_stmt)).scalars().all())

        nodes = [
            TopologyNode(
                id=ws.id,
                name=ws.name,
                slug=ws.slug,
                component_key=ws.component_key,
            )
            for ws in workspaces
        ]
        return TopologyResponse(nodes=nodes, edges=[])
