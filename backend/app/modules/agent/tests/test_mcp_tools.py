"""Tests for MCP tool endpoints（2026-07-12-team-main-agent-orchestration task-03 / D-007@v2）。

覆盖 5 endpoint 各返回正确结构：
- POST dispatch_worker：建 worker run + 派 lease（daemon 离线时 error_code）。
- GET workers/{id}/result：读 worker AgentArtifact。
- GET workers：列 mission 下所有 run 状态。
- POST converge：触发 FinalizerService 收敛（全终态 → done）。
- POST progress：落主 agent 决策日志（AgentRunLog）。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentArtifact, AgentMission, AgentRun, AgentRunLog
from app.modules.workspace.model import Workspace


async def _seed_workspace_and_mission(
    session: AsyncSession,
    *,
    with_main_run: bool = True,
    main_run_status: str = "completed",
) -> tuple[uuid.UUID, uuid.UUID, AgentRun | None]:
    """建 workspace + mission（含 worker_preset/main_agent_config）+ 主 agent run。"""
    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name=f"ws-{ws_id.hex[:8]}",
        slug=f"ws-{ws_id.hex[:8]}",
        root_path=f"/tmp/{ws_id.hex}",
    )
    session.add(ws)
    await session.commit()

    mission = AgentMission(
        workspace_id=ws_id,
        objective="团队目标",
        constraints={"mode": "team"},
        worker_preset=[{"role": "arch", "agent_type": "claude_code", "objective": "扫描"}],
        main_agent_config={"agent_type": "claude_code", "provider": "claude"},
    )
    session.add(mission)
    await session.commit()
    await session.refresh(mission)

    main_run: AgentRun | None = None
    if with_main_run:
        main_run = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            provider="claude",
            status=main_run_status,
            role="orchestrator",
            objective="团队目标",
        )
        session.add(main_run)
        await session.commit()
        await session.refresh(main_run)
    return ws_id, mission.id, main_run


class TestDispatchWorker:
    @pytest.mark.asyncio
    async def test_dispatch_creates_worker_run(self, client, db_session, auth_headers) -> None:
        """POST dispatch_worker → 建 worker run（daemon 离线 → error_code=no_online_daemon）。"""
        ws_id, mission_id, _ = await _seed_workspace_and_mission(db_session)
        resp = await client.post(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/dispatch_worker",
            json={"objective": "扫描架构", "role": "arch", "read_only": True},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["role"] == "arch"
        assert data["status"] == "pending"
        assert data["objective"] == "扫描架构"
        assert data["agent_type"] == "claude_code"
        # 无 daemon binding → dispatch 抛 NoOnlineDaemonError 被捕获
        assert data["error_code"] == "no_online_daemon"

    @pytest.mark.asyncio
    async def test_dispatch_missing_role_uses_default(
        self, client, db_session, auth_headers
    ) -> None:
        """role 缺省 → 默认 worker。"""
        ws_id, mission_id, _ = await _seed_workspace_and_mission(db_session)
        resp = await client.post(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/dispatch_worker",
            json={"objective": "做事"},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["role"] == "worker"


class TestGetWorkerResult:
    @pytest.mark.asyncio
    async def test_get_result_reads_artifacts(self, client, db_session, auth_headers) -> None:
        """GET workers/{id}/result → 读 worker AgentArtifact。"""
        ws_id, mission_id, _ = await _seed_workspace_and_mission(db_session)
        worker = AgentRun(
            mission_id=mission_id,
            agent_type="claude_code",
            status="completed",
            role="arch",
            objective="扫描",
        )
        db_session.add(worker)
        await db_session.commit()
        await db_session.refresh(worker)
        art = AgentArtifact(
            run_id=worker.id,
            kind="summary",
            content_ref="架构摘要内容",
        )
        db_session.add(art)
        await db_session.commit()

        resp = await client.get(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/workers/{worker.id}/result",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["worker_id"] == str(worker.id)
        assert data["status"] == "completed"
        assert len(data["artifacts"]) == 1
        assert data["artifacts"][0]["kind"] == "summary"
        assert data["artifacts"][0]["content_ref"] == "架构摘要内容"

    @pytest.mark.asyncio
    async def test_get_result_404_for_wrong_mission(self, client, db_session, auth_headers) -> None:
        """worker 不属于该 mission → 404。"""
        ws_id, mission_id, _ = await _seed_workspace_and_mission(db_session)
        other_run = AgentRun(
            mission_id=None,
            agent_type="claude_code",
            status="completed",
        )
        db_session.add(other_run)
        await db_session.commit()
        await db_session.refresh(other_run)
        resp = await client.get(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/workers/{other_run.id}/result",
            headers=auth_headers,
        )
        assert resp.status_code == 404


class TestListWorkers:
    @pytest.mark.asyncio
    async def test_list_returns_all_runs(self, client, db_session, auth_headers) -> None:
        """GET workers → 列 mission 下所有 run（含主 agent + worker）。"""
        ws_id, mission_id, _main_run = await _seed_workspace_and_mission(db_session)
        worker = AgentRun(
            mission_id=mission_id,
            agent_type="claude_code",
            status="completed",
            role="arch",
            objective="扫描",
            total_cost_usd=0.5,
        )
        db_session.add(worker)
        await db_session.commit()

        resp = await client.get(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/workers",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["mission_id"] == str(mission_id)
        roles = {w["role"] for w in data["workers"]}
        assert "orchestrator" in roles
        assert "arch" in roles
        assert len(data["workers"]) == 2


class TestConvergeMission:
    @pytest.mark.asyncio
    async def test_converge_all_completed(self, client, db_session, auth_headers) -> None:
        """POST converge → 全终态（completed）→ done → converged=True。"""
        ws_id, mission_id, _main_run = await _seed_workspace_and_mission(
            db_session, main_run_status="completed"
        )
        worker = AgentRun(
            mission_id=mission_id,
            agent_type="claude_code",
            status="completed",
            role="arch",
            objective="扫描",
        )
        db_session.add(worker)
        await db_session.commit()
        await db_session.refresh(worker)
        art = AgentArtifact(run_id=worker.id, kind="summary", content_ref="摘要")
        db_session.add(art)
        await db_session.commit()

        resp = await client.post(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/converge",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["mission_id"] == str(mission_id)
        assert data["status"] == "done"
        assert data["converged"] is True
        assert data["artifact_id"] is not None

    @pytest.mark.asyncio
    async def test_converge_running_when_worker_pending(
        self, client, db_session, auth_headers
    ) -> None:
        """POST converge → 有 pending worker → status=running → converged=False。"""
        ws_id, mission_id, _ = await _seed_workspace_and_mission(
            db_session, main_run_status="completed"
        )
        worker = AgentRun(
            mission_id=mission_id,
            agent_type="claude_code",
            status="pending",
            role="arch",
            objective="扫描",
        )
        db_session.add(worker)
        await db_session.commit()

        resp = await client.post(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/converge",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["converged"] is False
        assert data["status"] == "running"


class TestReportProgress:
    @pytest.mark.asyncio
    async def test_progress_writes_log(self, client, db_session, auth_headers) -> None:
        """POST progress → 落 AgentRunLog（channel=tool_call, tool_kind=other）。"""
        ws_id, mission_id, main_run = await _seed_workspace_and_mission(db_session)
        resp = await client.post(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/progress",
            json={
                "run_id": str(main_run.id),
                "message": "已派 arch worker",
                "decision": "dispatch",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["run_id"] == str(main_run.id)
        assert data["log_id"] is not None

        # 从 DB 重查确认日志落库
        from sqlalchemy import select

        log = (
            (
                await db_session.execute(
                    select(AgentRunLog).where(AgentRunLog.id == uuid.UUID(data["log_id"]))
                )
            )
            .scalars()
            .first()
        )
        assert log is not None
        assert log.channel == "tool_call"
        assert log.tool_kind == "other"
        assert "[dispatch]" in (log.content_redacted or "")
        assert "已派 arch worker" in (log.content_redacted or "")

    @pytest.mark.asyncio
    async def test_progress_404_for_run_outside_mission(
        self, client, db_session, auth_headers
    ) -> None:
        """run 不属于该 mission → 404。"""
        ws_id, mission_id, _ = await _seed_workspace_and_mission(db_session)
        other = AgentRun(
            mission_id=None,
            agent_type="claude_code",
            status="completed",
        )
        db_session.add(other)
        await db_session.commit()
        await db_session.refresh(other)
        resp = await client.post(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/progress",
            json={"run_id": str(other.id), "message": "x"},
            headers=auth_headers,
        )
        assert resp.status_code == 404
