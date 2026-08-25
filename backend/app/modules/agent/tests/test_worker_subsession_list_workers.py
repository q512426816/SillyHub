"""list_workers 子会话行化单测（FR-09 验收补漏 / design §1 痛点 1 / §5.C.5 / §5.E）。

change ``2026-08-25-team-subsession-governance`` 验收补漏：``mcp_tools.
_list_workers_core`` workers 数据源从「全量 mission run 行」改双形态，与
``daemon/router._team_mission_summary``（task-13）同口径——

- 新形态子会话行：``mission_worker_sessions``（task-01）一层枚举，每分身一行，
  行 ``id`` = 首 run id（双标记锚，供 ``get_worker_result`` 连续消费）、
  role/objective 取首 run、status 按 ``is_worker_complete``（task-08 单一
  真相源）映射三值 completed/failed/running；
- 存量回落 batch run 行：主控轮剔除（``role != 'orchestrator'`，NULL role
  天然保留）+ 子会话 run 剔除防双计，run 原始 status 透传；
- 主控轮与追问轮次 run（无 mission_id）不混入（design §1 痛点 1）。

测试均直接 DB 种子（不跑派发链），断言走显式路由
``GET /api/workspaces/{ws}/missions/{mid}/workers``（四路由族共用
``_list_workers_core``）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentMission, AgentRun, AgentSession
from app.modules.workspace.model import Workspace

# 种子时间基点（显式 created_at 保证「首 run=最早双标记 run」排序可断言）。
_TS0 = datetime(2026, 8, 25, 0, 0, 0, tzinfo=UTC)
_TS1 = datetime(2026, 8, 25, 0, 0, 1, tzinfo=UTC)
_TS2 = datetime(2026, 8, 25, 0, 0, 2, tzinfo=UTC)


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------


async def _seed_tree(db: AsyncSession) -> tuple[Workspace, AgentSession, AgentMission]:
    """建 workspace + 主控根会话 + 会话 mission（session_id 落根，无子会话）。"""
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:8]}",
        slug=f"ws-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{uuid.uuid4().hex}",
    )
    db.add(ws)
    await db.commit()
    root = AgentSession(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        provider="claude",
        status="active",
        workspace_id=ws.id,
    )
    db.add(root)
    await db.commit()
    mission = AgentMission(
        workspace_id=ws.id,
        objective="团队目标",
        session_id=root.id,
    )
    db.add(mission)
    await db.commit()
    await db.refresh(mission)
    return ws, root, mission


async def _add_worker(
    db: AsyncSession,
    root: AgentSession,
    *,
    status: str = "active",
    worker_done_at: datetime | None = None,
) -> AgentSession:
    """建分身子会话（parent 挂根，design §5.A 一层枚举）。"""
    w = AgentSession(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        provider="claude",
        status=status,
        workspace_id=root.workspace_id,
        parent_session_id=root.id,
        worker_done_at=worker_done_at,
    )
    db.add(w)
    await db.commit()
    await db.refresh(w)
    return w


async def _add_run(
    db: AsyncSession,
    *,
    status: str,
    mission_id: uuid.UUID | None = None,
    role: str | None = None,
    agent_session_id: uuid.UUID | None = None,
    objective: str | None = None,
    created_at: datetime | None = None,
) -> AgentRun:
    r = AgentRun(
        mission_id=mission_id,
        agent_type="claude_code",
        status=status,
        role=role,
        objective=objective,
        agent_session_id=agent_session_id,
        created_at=created_at,
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return r


# ---------------------------------------------------------------------------
# 1. 新形态子会话行
# ---------------------------------------------------------------------------


class TestSubsessionRows:
    @pytest.mark.asyncio
    async def test_new_form_rows_anchor_first_run_and_map_status(
        self, client, db_session, auth_headers
    ) -> None:
        """新形态行正确：每分身一行、id=最早双标记 run、role/objective 取首 run、
        done 分身 completed / 未 done 分身 running（不被首 run 终态遮蔽）。"""
        ws, root, mission = await _seed_tree(db_session)
        done_worker = await _add_worker(db_session, root, worker_done_at=_TS2)
        idle_worker = await _add_worker(db_session, root)
        # done 分身：首 run（最早双标记）completed；防御性第二双标记 run 不换锚
        anchor_run = await _add_run(
            db_session,
            status="completed",
            mission_id=mission.id,
            role="arch",
            agent_session_id=done_worker.id,
            objective="扫描架构",
            created_at=_TS0,
        )
        await _add_run(
            db_session,
            status="completed",
            mission_id=mission.id,
            role="arch",
            agent_session_id=done_worker.id,
            objective="扫描架构-重复标记",
            created_at=_TS1,
        )
        # 未 done 分身：首 run 已 completed（turn 说完话）但 worker_done_at NULL
        idle_run = await _add_run(
            db_session,
            status="completed",
            mission_id=mission.id,
            role="impl",
            agent_session_id=idle_worker.id,
            objective="改代码",
            created_at=_TS1,
        )

        resp = await client.get(
            f"/api/workspaces/{ws.id}/missions/{mission.id}/workers",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        workers = resp.json()["workers"]
        assert len(workers) == 2
        by_role = {w["role"]: w for w in workers}
        # done 分身：completed；id = 最早双标记 run（供 get_worker_result 消费）
        assert by_role["arch"]["id"] == str(anchor_run.id)
        assert by_role["arch"]["status"] == "completed"
        assert by_role["arch"]["objective"] == "扫描架构"
        # 未 done 分身：running——不被首 run 终态（completed）遮蔽
        assert by_role["impl"]["id"] == str(idle_run.id)
        assert by_role["impl"]["status"] == "running"
        assert by_role["impl"]["objective"] == "改代码"

    @pytest.mark.asyncio
    async def test_failed_session_maps_failed(self, client, db_session, auth_headers) -> None:
        """会话终态 failed 分身 → 行 status=failed（三值映射中档）。"""
        ws, root, mission = await _seed_tree(db_session)
        failed_worker = await _add_worker(db_session, root, status="failed")
        await _add_run(
            db_session,
            status="failed",
            mission_id=mission.id,
            role="arch",
            agent_session_id=failed_worker.id,
            created_at=_TS0,
        )

        workers = (
            await client.get(
                f"/api/workspaces/{ws.id}/missions/{mission.id}/workers",
                headers=auth_headers,
            )
        ).json()["workers"]
        assert len(workers) == 1
        assert workers[0]["status"] == "failed"

    @pytest.mark.asyncio
    async def test_running_first_run_not_done_shows_running(
        self, client, db_session, auth_headers
    ) -> None:
        """未 done 且首 turn 仍在跑（pending/running）→ running。"""
        ws, root, mission = await _seed_tree(db_session)
        worker = await _add_worker(db_session, root)
        await _add_run(
            db_session,
            status="running",
            mission_id=mission.id,
            role="impl",
            agent_session_id=worker.id,
            created_at=_TS0,
        )

        workers = (
            await client.get(
                f"/api/workspaces/{ws.id}/missions/{mission.id}/workers",
                headers=auth_headers,
            )
        ).json()["workers"]
        assert [w["status"] for w in workers] == ["running"]


# ---------------------------------------------------------------------------
# 2. 主控轮 / 轮次 run 不混入
# ---------------------------------------------------------------------------


class TestExclusions:
    @pytest.mark.asyncio
    async def test_orchestrator_and_round_runs_excluded(
        self, client, db_session, auth_headers
    ) -> None:
        """主控轮（role='orchestrator'）与追问轮次 run（无 mission_id）不进
        workers；分身首 run 不双计（恰好一行）。"""
        ws, root, mission = await _seed_tree(db_session)
        worker = await _add_worker(db_session, root)
        first_run = await _add_run(
            db_session,
            status="completed",
            mission_id=mission.id,
            role="arch",
            agent_session_id=worker.id,
            created_at=_TS0,
        )
        # 主控轮：root 会话自己的 run（mission_id 回填 + role=orchestrator）
        await _add_run(
            db_session,
            status="running",
            mission_id=mission.id,
            role="orchestrator",
            agent_session_id=root.id,
            created_at=_TS0,
        )
        # 追问轮次 run：分身会话后续轮，无 mission_id 天然不进
        await _add_run(
            db_session,
            status="running",
            agent_session_id=worker.id,
            created_at=_TS1,
        )

        workers = (
            await client.get(
                f"/api/workspaces/{ws.id}/missions/{mission.id}/workers",
                headers=auth_headers,
            )
        ).json()["workers"]
        assert [w["id"] for w in workers] == [str(first_run.id)]
        assert workers[0]["role"] == "arch"

    @pytest.mark.asyncio
    async def test_subsession_without_first_run_skipped(
        self, client, db_session, auth_headers
    ) -> None:
        """同根上一场已收敛 mission 的子会话（无本场首 run）不是本场分身，不进行。"""
        ws, root, mission = await _seed_tree(db_session)
        # 上一场遗留子会话：parent 挂根但本场无首 run
        await _add_worker(db_session, root)
        # 本场真实分身
        current_worker = await _add_worker(db_session, root)
        first_run = await _add_run(
            db_session,
            status="running",
            mission_id=mission.id,
            role="impl",
            agent_session_id=current_worker.id,
            created_at=_TS0,
        )

        workers = (
            await client.get(
                f"/api/workspaces/{ws.id}/missions/{mission.id}/workers",
                headers=auth_headers,
            )
        ).json()["workers"]
        assert [w["id"] for w in workers] == [str(first_run.id)]


# ---------------------------------------------------------------------------
# 3. 存量回落（FR-09）
# ---------------------------------------------------------------------------


class TestLegacyBatchFallback:
    @pytest.mark.asyncio
    async def test_legacy_batch_rows_raw_status(self, client, db_session, auth_headers) -> None:
        """无子会话 mission：回落 batch run 行（run 原始 status 透传）；主控轮
        剔除、NULL role 存量分身保留。"""
        ws, root, mission = await _seed_tree(db_session)
        arch_run = await _add_run(
            db_session,
            status="running",
            mission_id=mission.id,
            role="arch",
            objective="扫描",
            created_at=_TS0,
        )
        null_role_run = await _add_run(
            db_session,
            status="completed",
            mission_id=mission.id,
            created_at=_TS1,
        )
        await _add_run(
            db_session,
            status="completed",
            mission_id=mission.id,
            role="orchestrator",
            agent_session_id=root.id,
            created_at=_TS0,
        )

        workers = (
            await client.get(
                f"/api/workspaces/{ws.id}/missions/{mission.id}/workers",
                headers=auth_headers,
            )
        ).json()["workers"]
        assert [w["id"] for w in workers] == [str(arch_run.id), str(null_role_run.id)]
        assert workers[0]["status"] == "running"
        assert workers[0]["objective"] == "扫描"
        assert workers[1]["role"] is None
        assert workers[1]["status"] == "completed"

    @pytest.mark.asyncio
    async def test_mixed_forms_coexist(self, client, db_session, auth_headers) -> None:
        """混跑：子会话行 + 存量 batch run 行并存；子会话首 run 从存量侧剔除
        不双计（对齐 _split_worker_forms / mission_derive_status 剔除口径）。"""
        ws, root, mission = await _seed_tree(db_session)
        worker = await _add_worker(db_session, root, worker_done_at=_TS2)
        first_run = await _add_run(
            db_session,
            status="completed",
            mission_id=mission.id,
            role="impl",
            agent_session_id=worker.id,
            objective="改代码",
            created_at=_TS0,
        )
        legacy_run = await _add_run(
            db_session,
            status="running",
            mission_id=mission.id,
            role="arch",
            created_at=_TS1,
        )

        workers = (
            await client.get(
                f"/api/workspaces/{ws.id}/missions/{mission.id}/workers",
                headers=auth_headers,
            )
        ).json()["workers"]
        # 子会话行在前（mission_worker_sessions created_at 升序）、存量行在后
        assert [w["id"] for w in workers] == [str(first_run.id), str(legacy_run.id)]
        assert workers[0]["status"] == "completed"
        assert workers[1]["status"] == "running"
