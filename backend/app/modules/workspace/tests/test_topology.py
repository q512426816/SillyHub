"""TopologyBuilder 退化测试（D-004@V1，变更 2026-07-06-component-readonly-split）。

关系层已砍：topology 只返回项目组节点（component_key IS NULL），edges 恒空。
"""

import uuid

import pytest

from app.modules.workspace.model import Workspace
from app.modules.workspace.topology import TopologyBuilder


@pytest.mark.asyncio
async def test_topology_returns_only_project_group_nodes_no_edges(db_session) -> None:
    """topology 只返回项目组节点（component_key IS NULL），edges 恒空。"""
    pg = Workspace(
        id=uuid.uuid4(),
        name="SillyHub",
        slug="sillyhub",
        root_path="/sh",
        status="active",
    )
    # brownfield：W3 migration 前残留的 component 行应被排除
    comp = Workspace(
        id=uuid.uuid4(),
        name="backend",
        slug="backend",
        root_path="/sh/backend",
        status="active",
        component_key="backend",
    )
    db_session.add_all([pg, comp])
    await db_session.flush()

    result = await TopologyBuilder.build(db_session)
    assert {n.id for n in result.nodes} == {pg.id}
    assert result.edges == []
