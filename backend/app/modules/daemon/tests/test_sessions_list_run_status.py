"""2026-10-16-session-run-status-realtime ``GET /sessions`` current_run_status 注入单测.

覆盖（用户确认方案：run 状态第一优先实时信号，日志活性降兜底基线）：

- 活跃 run 注入：会话有 pending/running/pending_approval run → 列表项
  ``current_run_status`` 返回该状态（窗口函数取每会话 created_at 最新一条
  活跃 run——多活跃 run 并存挑最新，对齐 get_session_detail 的
  ql-20260910-011-3d42 排序语义）。
- 无活跃 run（终态 run / 从未有 run）→ null（brownfield 不崩不丢行）。
- OpenAPI schema 反映 current_run_status 新字段（gen:types 消费面）。

夹具范式镜像 ``test_sessions_list_owner_name.py``（in-memory SQLite + httpx
client），AgentRun 建行参数照其模型必填列。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.auth.model import User

# ── Helpers（范式照抄 test_sessions_list_owner_name.py）────────────────────────


async def _get_admin(db_session: AsyncSession) -> User:
    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None
    return admin


async def _make_session(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    status: str = "active",
) -> AgentSession:
    now = datetime.now(UTC)
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=None,
        lease_id=None,
        provider="claude",
        status=status,
        agent_session_id=None,
        turn_count=1,
        created_at=now,
        last_active_at=now,
    )
    session.add(sess)
    await session.commit()
    return sess


async def _make_run(
    session: AsyncSession,
    agent_session_id: uuid.UUID,
    *,
    status: str,
    created_at: datetime | None = None,
) -> AgentRun:
    run = AgentRun(
        id=uuid.uuid4(),
        agent_session_id=agent_session_id,
        agent_type="claude_code",
        status=status,
        created_at=created_at or datetime.now(UTC),
    )
    session.add(run)
    await session.commit()
    return run


# ── current_run_status 注入 ─────────────────────────────────────────────────


class TestCurrentRunStatus:
    async def test_active_run_status_injected(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """会话有 running run → 列表项 current_run_status="running"。"""
        admin = await _get_admin(db_session)
        s = await _make_session(db_session, admin.id)
        await _make_run(db_session, s.id, status="running")

        resp = await client.get("/api/daemon/sessions", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        item = next(it for it in resp.json()["items"] if it["id"] == str(s.id))
        assert item["current_run_status"] == "running"

    async def test_pending_approval_injected(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """等审批 run（pending_approval）同样注入——前端琥珀「在等你」信号源。"""
        admin = await _get_admin(db_session)
        s = await _make_session(db_session, admin.id)
        await _make_run(db_session, s.id, status="pending_approval")

        resp = await client.get("/api/daemon/sessions", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        item = next(it for it in resp.json()["items"] if it["id"] == str(s.id))
        assert item["current_run_status"] == "pending_approval"

    async def test_latest_active_run_wins_when_multiple(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """多活跃 run 并存 → created_at 最新一条胜出（窗口函数排序语义）。"""
        admin = await _get_admin(db_session)
        s = await _make_session(db_session, admin.id)
        base = datetime.now(UTC)
        await _make_run(db_session, s.id, status="running", created_at=base - timedelta(minutes=5))
        await _make_run(db_session, s.id, status="pending_approval", created_at=base)

        resp = await client.get("/api/daemon/sessions", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        item = next(it for it in resp.json()["items"] if it["id"] == str(s.id))
        assert item["current_run_status"] == "pending_approval"

    async def test_terminal_run_yields_null(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """只有终态 run（completed/failed/killed 不在 ACTIVE_RUN_STATUSES）→ null。"""
        admin = await _get_admin(db_session)
        s = await _make_session(db_session, admin.id, status="active")
        await _make_run(db_session, s.id, status="completed")

        resp = await client.get("/api/daemon/sessions", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        item = next(it for it in resp.json()["items"] if it["id"] == str(s.id))
        assert item["current_run_status"] is None

    async def test_no_run_at_all_yields_null(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """从没有 run 的会话（本地 CLI 上报 / 旧数据）→ null，列表不崩。"""
        admin = await _get_admin(db_session)
        s = await _make_session(db_session, admin.id)

        resp = await client.get("/api/daemon/sessions", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        item = next(it for it in resp.json()["items"] if it["id"] == str(s.id))
        assert item["current_run_status"] is None


# ── OpenAPI 反映新字段（gen:types 消费面）───────────────────────────────────


class TestOpenApiSchema:
    async def test_openapi_exposes_current_run_status(self) -> None:
        """非 dev 环境 openapi.json 端点关闭（main.py BS-5），直接经 app.openapi()
        断言 schema——与 pnpm gen:types 消费的 OpenAPI 产物同源。"""
        from app.main import app

        props = app.openapi()["components"]["schemas"]["AgentSessionRead"]["properties"]
        assert "current_run_status" in props
