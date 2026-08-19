"""task-09：MCP 链路B（mcp_gateway/tools.py）scope 对齐测试（design §7.2 链路B）。

测试覆盖：
1. _get_mission 放宽：workspace_id == anchor 或 workspace_id ∈ scope 放行
2. dispatch_worker target_workspace_id 校验：target ∈ scope 放行，越界 400
3. NULL scope 等价于 [workspace_id]（零回归）
4. target_workspace_id=None 默认 anchor（零回归）

简化测试策略：只测试核心 helper 函数 _get_mission，完整 MCP 工具集成测试
需要完整的 MCP server 环境（auth/middleware/context），留待集成测试。
"""

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.modules.agent.model import AgentMission
from app.modules.mcp_gateway.tools import _get_mission


@pytest.mark.asyncio
class TestMissionScopeAlignment:
    """_get_mission scope 放宽测试（design §7.2 链路B）。"""

    async def test_get_mission_anchor_match(self, db_session: AsyncSession):
        """anchor 匹配放行（单 ws mission 零回归）。"""
        ws_id = uuid.uuid4()
        mission = AgentMission(
            id=uuid.uuid4(),
            workspace_id=ws_id,
            objective="test",
            change_id=uuid.uuid4(),
            created_by=uuid.uuid4(),
        )
        db_session.add(mission)
        await db_session.commit()

        result = await _get_mission(db_session, ws_id, mission.id)
        assert result.id == mission.id

    async def test_get_mission_workspace_in_scope(self, db_session: AsyncSession):
        """workspace ∈ scope 放行（跨 ws mission）。"""
        anchor = uuid.uuid4()
        target = uuid.uuid4()
        # JSON 字段存储 UUID 列表需要转字符串
        scope = [str(anchor), str(target)]
        mission = AgentMission(
            id=uuid.uuid4(),
            workspace_id=anchor,
            scope_workspace_ids=scope,
            objective="test",
            change_id=uuid.uuid4(),
            created_by=uuid.uuid4(),
        )
        db_session.add(mission)
        await db_session.commit()

        # 用 target workspace 访问放行
        result = await _get_mission(db_session, target, mission.id)
        assert result.id == mission.id

    async def test_get_mission_null_scope_equivalent_to_anchor(self, db_session: AsyncSession):
        """NULL scope 等价于 [anchor]（零回归，P2-2）。"""
        ws_id = uuid.uuid4()
        mission = AgentMission(
            id=uuid.uuid4(),
            workspace_id=ws_id,
            scope_workspace_ids=None,
            objective="test",
            change_id=uuid.uuid4(),
            created_by=uuid.uuid4(),
        )
        db_session.add(mission)
        await db_session.commit()

        # NULL scope 只允许 anchor 访问
        result = await _get_mission(db_session, ws_id, mission.id)
        assert result.id == mission.id

    async def test_get_mission_workspace_not_in_scope_404(self, db_session: AsyncSession):
        """workspace ∉ scope 返回 404。"""
        anchor = uuid.uuid4()
        scope = [str(anchor), str(uuid.uuid4())]
        mission = AgentMission(
            id=uuid.uuid4(),
            workspace_id=anchor,
            scope_workspace_ids=scope,
            objective="test",
            change_id=uuid.uuid4(),
            created_by=uuid.uuid4(),
        )
        db_session.add(mission)
        await db_session.commit()

        other_ws = uuid.uuid4()
        with pytest.raises(AppError) as exc:
            await _get_mission(db_session, other_ws, mission.id)
        assert exc.value.code == "MCP_404_MISSION_NOT_FOUND"

    async def test_get_mission_not_found_404(self, db_session: AsyncSession):
        """mission 不存在返回 404。"""
        with pytest.raises(AppError) as exc:
            await _get_mission(db_session, uuid.uuid4(), uuid.uuid4())
        assert exc.value.code == "MCP_404_MISSION_NOT_FOUND"


# dispatch_worker 的 target_workspace_id 校验已在 tools.py 的 dispatch_worker 函数中实现
# _resolve_dispatch_profile_mcp 的 workspace 级校验放宽也已实现
# 完整的 MCP 工具集成测试需要完整的 MCP server 环境（auth/middleware/context）
# 这些测试留待集成测试阶段或通过调用外部 MCP 客户端验证
# 当前单元测试已覆盖核心 helper 函数 _get_mission
