"""external 模式 report_progress / mission_status 冒烟用例（防回归锚）。

docs/sillyspec/external-mode-no-root-session-resolution.md「待补（建议）」的正式落地
（2026-09-16 巡检注记转登记，2026-09-17 定时收口实现）：走 resolve 链的端点已被
``resolve_mission_for_session`` run 归属回退源头修复覆盖（d879ea247），本文件是
端点级防回归锚——external 形态（无根会话 / mission.session_id=NULL / worker
parent=NULL）下两个常用端点的真实行为锁定：

- **report_progress（会话路由）**：external worker 上报 → ``_resolve_session_mission``
  爬根 miss → run 归属回退（首 run 带 mission_id）解析成功 → 200 进度落库。
  若回退链回归（重演 2026-09-10 worker_done 404 形态），此用例先红。
- **mission_status（header-only）**：external worker（parent NULL）走
  ``get_active_mission_for_session``（session_id 直查，external mission 恒 NULL-miss）
  → D-12 优雅 ``active=false``（无 404/500）。锁定现状口径：external worker 的
  mission 视图应走 daemon 代报（worker_done / status 汇聚），status 端点的
  graceful-miss 是设计语义非回归。

fixture 复刻 ``test_worker_subsession_done.py::TestExternalModeWorkerDone._seed_external``
（同款 Workspace / mission(session_id=NULL) / worker(parent=NULL) / 首 run 双标记）。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentMission, AgentRun, AgentSession
from app.modules.workspace.model import Workspace


async def _seed_external(
    db: AsyncSession,
) -> tuple[Workspace, AgentSession, AgentMission, AgentRun]:
    """external 形态：无根会话、mission.session_id=NULL、worker 挂 NULL parent + 首任务 run。"""
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:8]}",
        slug=f"ws-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{uuid.uuid4().hex}",
    )
    db.add(ws)
    await db.commit()

    mission = AgentMission(
        workspace_id=ws.id,
        objective="external 冒烟目标",
        session_id=None,
    )
    db.add(mission)
    await db.commit()
    await db.refresh(mission)

    worker = AgentSession(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        provider="pi",
        status="active",
        workspace_id=ws.id,
        parent_session_id=None,
    )
    db.add(worker)
    await db.commit()
    await db.refresh(worker)

    first_run = AgentRun(
        mission_id=mission.id,
        agent_type="claude_code",
        status="running",
        role="worker",
        objective="external 冒烟 run",
        agent_session_id=worker.id,
    )
    db.add(first_run)
    await db.commit()
    await db.refresh(first_run)
    return ws, worker, mission, first_run


@pytest.mark.asyncio
class TestExternalModeProgressSmoke:
    async def test_report_progress_resolves_via_run_fallback(
        self, client, db_session, auth_headers
    ) -> None:
        """external worker report_progress：爬根 miss → 首 run 归属回退解析 → 200。"""
        _ws, worker, _mission, _run = await _seed_external(db_session)

        resp = await client.post(
            f"/api/sessions/{worker.id}/missions/progress",
            json={"message": "external worker 进度 42%"},
            headers=auth_headers,
        )
        assert resp.status_code in (200, 201), (
            f"run 归属回退应解析成功（实际 {resp.status_code}: {resp.text[:200]}）"
        )
        body = resp.json()
        assert body.get("log_id"), "进度日志落库（run_id/log_id 双回执）"

    async def test_mission_status_resolves_external_worker_mission(
        self, client, db_session, auth_headers
    ) -> None:
        """external worker mission_status：session 直查 miss → run 归属回退解析活跃 mission。

        修复后口径（2026-09-17 与 report_progress 同款补齐）：external worker 对自己
        活跃 mission 的 status 查询应解析成功（active=True），不再被 D-12 graceful
        误报成 active=false；普通会话无 mission run → 仍 graceful miss（回归锚见
        下一用例）。
        """
        _ws, worker, mission, _run = await _seed_external(db_session)

        resp = await client.get(
            "/api/missions/status",
            headers={**auth_headers, "X-Session-Id": str(worker.id)},
        )
        assert resp.status_code == 200, (
            f"status 应 200（实际 {resp.status_code}: {resp.text[:200]}）"
        )
        body = resp.json()
        assert body.get("active") is True, "external worker 经 run 回退解析到活跃 mission"
        assert body.get("mission_id") == str(mission.id)

    async def test_mission_status_graceful_for_plain_session_without_mission(
        self, client, db_session, auth_headers
    ) -> None:
        """普通会话（无 mission run）→ D-12 优雅 active=False（回退不放宽 404 语义）。"""
        from app.modules.workspace.model import Workspace as Ws

        ws = Ws(
            id=uuid.uuid4(),
            name=f"ws-{uuid.uuid4().hex[:8]}",
            slug=f"ws-{uuid.uuid4().hex[:8]}",
            root_path=f"/tmp/{uuid.uuid4().hex}",
        )
        db_session.add(ws)
        await db_session.commit()
        plain = AgentSession(
            id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            provider="pi",
            status="active",
            workspace_id=ws.id,
            parent_session_id=None,
        )
        db_session.add(plain)
        await db_session.commit()

        resp = await client.get(
            "/api/missions/status",
            headers={**auth_headers, "X-Session-Id": str(plain.id)},
        )
        assert resp.status_code == 200
        assert resp.json().get("active") is False, "无 mission run 的普通会话维持 D-12 优雅 miss"
