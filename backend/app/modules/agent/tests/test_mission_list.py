"""GET /workspaces/{id}/missions 列表端点测试（quick: mission 历史列表）。

守护 quick 变更：backend 加 list missions 端点（按 created_at 倒序 + limit/offset 分页），
让前端 Agent 团队页能浏览历史 mission 执行记录（之前只能 URL ?mission=<id> 看单个）。

设计依据：CONVENTIONS.md「执行顺序」先写测试用例 + test_team_mode_dispatch.py 的
随机 ws_id 模式（SQLite 测试不强制 FK，AgentMission.workspace_id 虽 FK→workspaces.id）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.modules.agent.model import AgentMission


async def _seed(db_session, ws_id: uuid.UUID, objective: str, hours: int) -> None:
    """直接建 AgentMission（绕过 create_mission + GLM mock）。

    created_at 手动设（base + hours）保证倒序稳定——server_default=text("now()")
    在 INSERT 带显式值时不覆盖，故可控制时序。
    """
    db_session.add(
        AgentMission(
            workspace_id=ws_id,
            objective=objective,
            created_at=datetime(2026, 1, 1, tzinfo=UTC) + timedelta(hours=hours),
        )
    )


class TestListMissions:
    @pytest.mark.asyncio
    async def test_returns_missions_desc_by_created_at(
        self, client, auth_headers, db_session
    ) -> None:
        """同 workspace 多 mission，按 created_at 倒序（最新在前）。"""
        ws = uuid.uuid4()
        await _seed(db_session, ws, "old", hours=0)
        await _seed(db_session, ws, "new", hours=1)
        await db_session.commit()

        resp = await client.get(f"/api/workspaces/{ws}/missions", headers=auth_headers)

        assert resp.status_code == 200
        items = resp.json()
        assert [i["objective"] for i in items] == ["new", "old"]

    @pytest.mark.asyncio
    async def test_empty_workspace_returns_empty_list(self, client, auth_headers) -> None:
        """无 mission 的 workspace 返回 []（非 404）。"""
        resp = await client.get(f"/api/workspaces/{uuid.uuid4()}/missions", headers=auth_headers)
        assert resp.status_code == 200
        assert resp.json() == []

    @pytest.mark.asyncio
    async def test_isolated_per_workspace(self, client, auth_headers, db_session) -> None:
        """列表按 workspace 隔离，A 的 mission 不出现在 B。"""
        ws_a = uuid.uuid4()
        ws_b = uuid.uuid4()
        await _seed(db_session, ws_a, "a-1", hours=0)
        await _seed(db_session, ws_b, "b-1", hours=0)
        await db_session.commit()

        resp = await client.get(f"/api/workspaces/{ws_a}/missions", headers=auth_headers)

        items = resp.json()
        assert len(items) == 1
        assert items[0]["objective"] == "a-1"

    @pytest.mark.asyncio
    async def test_pagination_limit_offset(self, client, auth_headers, db_session) -> None:
        """limit/offset 分页，倒序偏移。"""
        ws = uuid.uuid4()
        for i in range(5):
            await _seed(db_session, ws, f"obj-{i}", hours=i)
        await db_session.commit()

        resp = await client.get(
            f"/api/workspaces/{ws}/missions?limit=2&offset=1", headers=auth_headers
        )

        assert resp.status_code == 200
        items = resp.json()
        assert len(items) == 2
        # 倒序：obj-4(最新)→obj-0；offset=1 limit=2 → obj-3, obj-2
        assert [i["objective"] for i in items] == ["obj-3", "obj-2"]

    @pytest.mark.asyncio
    async def test_default_limit_20_and_upper_cap_50(
        self, client, auth_headers, db_session
    ) -> None:
        """默认 limit=20；limit 超过 50 被 cap 到 50（防滥用，不报 422）。"""
        ws = uuid.uuid4()
        for i in range(60):
            await _seed(db_session, ws, f"obj-{i}", hours=i)
        await db_session.commit()

        resp = await client.get(f"/api/workspaces/{ws}/missions", headers=auth_headers)
        assert resp.status_code == 200
        assert len(resp.json()) == 20

        resp = await client.get(f"/api/workspaces/{ws}/missions?limit=200", headers=auth_headers)
        assert resp.status_code == 200
        assert len(resp.json()) == 50
