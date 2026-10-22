"""2026-10-20-session-awaiting-answer-status ``GET /sessions`` pending_dialog_kind 注入单测.

覆盖（用户需求：等待用户回答时左侧状态显示问号）：

- 有 status='pending' 的 SessionDialogRequest → 列表项 ``pending_dialog_kind``
  返回该 dialog_kind（窗口函数取每会话 created_at 最新一条）。
- answered/cancelled 行不注入（回答后问号消失）。
- 无对话行 / 无 run 的会话 → None（brownfield 不崩）。
- 每会话仅取最新 pending 行（连续提问取最新）。
- 批查零 N+1：多会话场景下 session_dialog_requests 只发一条 SELECT。
- OpenAPI schema 反映 pending_dialog_kind 新字段（gen:types 消费面）。

夹具范式镜像 ``test_sessions_list_run_status.py``（in-memory SQLite + httpx
client；SessionDialogRequest.run_id 非空 FK，故每会话建一条 run 行）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.auth.model import User
from app.modules.daemon.model import SessionDialogRequest

# ── Helpers（范式照抄 test_sessions_list_run_status.py）──────────────────────


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
    status: str = "running",
) -> AgentRun:
    run = AgentRun(
        id=uuid.uuid4(),
        agent_session_id=agent_session_id,
        agent_type="claude_code",
        status=status,
        created_at=datetime.now(UTC),
    )
    session.add(run)
    await session.commit()
    return run


async def _make_dialog(
    session: AsyncSession,
    *,
    agent_session_id: uuid.UUID,
    run_id: uuid.UUID,
    dialog_kind: str | None = "AskUserQuestion",
    status: str = "pending",
    created_at: datetime | None = None,
) -> SessionDialogRequest:
    row = SessionDialogRequest(
        id=uuid.uuid4(),
        session_id=agent_session_id,
        run_id=run_id,
        request_id=f"req-{uuid.uuid4().hex[:12]}",
        tool_name=dialog_kind or "Bash",
        dialog_kind=dialog_kind,
        status=status,
        created_at=created_at or datetime.now(UTC),
    )
    session.add(row)
    await session.commit()
    return row


# ── pending_dialog_kind 注入 ────────────────────────────────────────────────


class TestPendingDialogKind:
    async def test_pending_dialog_injected(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """pending AskUserQuestion 对话 → pending_dialog_kind='AskUserQuestion'。"""
        admin = await _get_admin(db_session)
        s = await _make_session(db_session, admin.id)
        run = await _make_run(db_session, s.id)
        await _make_dialog(db_session, agent_session_id=s.id, run_id=run.id)

        resp = await client.get("/api/daemon/sessions", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        item = next(it for it in resp.json()["items"] if it["id"] == str(s.id))
        assert item["pending_dialog_kind"] == "AskUserQuestion"

    async def test_answered_dialog_not_injected(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """answered 行不注入（回答后问号消失）。"""
        admin = await _get_admin(db_session)
        s = await _make_session(db_session, admin.id)
        run = await _make_run(db_session, s.id)
        await _make_dialog(
            db_session,
            agent_session_id=s.id,
            run_id=run.id,
            status="answered",
        )

        resp = await client.get("/api/daemon/sessions", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        item = next(it for it in resp.json()["items"] if it["id"] == str(s.id))
        assert item["pending_dialog_kind"] is None

    async def test_session_without_dialog_yields_null(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """无对话行（本地 CLI 会话 / 普通审批不落行）→ None，列表不崩。"""
        admin = await _get_admin(db_session)
        s = await _make_session(db_session, admin.id)

        resp = await client.get("/api/daemon/sessions", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        item = next(it for it in resp.json()["items"] if it["id"] == str(s.id))
        assert item["pending_dialog_kind"] is None

    async def test_latest_pending_dialog_wins(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """连续提问两条 pending → 取 created_at 最新一条的 kind（窗口函数排序语义）。"""
        admin = await _get_admin(db_session)
        s = await _make_session(db_session, admin.id)
        run = await _make_run(db_session, s.id)
        base = datetime.now(UTC)
        await _make_dialog(
            db_session,
            agent_session_id=s.id,
            run_id=run.id,
            dialog_kind="plan_approval",
            created_at=base - timedelta(minutes=5),
        )
        await _make_dialog(
            db_session,
            agent_session_id=s.id,
            run_id=run.id,
            dialog_kind="AskUserQuestion",
            created_at=base,
        )

        resp = await client.get("/api/daemon/sessions", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        item = next(it for it in resp.json()["items"] if it["id"] == str(s.id))
        assert item["pending_dialog_kind"] == "AskUserQuestion"

    async def test_other_session_dialog_not_leaked(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """别的会话的 pending 对话不串到本会话（IN 限定本页 id 集合）。"""
        admin = await _get_admin(db_session)
        s1 = await _make_session(db_session, admin.id)
        s2 = await _make_session(db_session, admin.id)
        run2 = await _make_run(db_session, s2.id)
        await _make_dialog(db_session, agent_session_id=s2.id, run_id=run2.id)

        resp = await client.get("/api/daemon/sessions", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        items = {it["id"]: it for it in resp.json()["items"]}
        assert items[str(s1.id)]["pending_dialog_kind"] is None
        assert items[str(s2.id)]["pending_dialog_kind"] == "AskUserQuestion"

    async def test_dialog_query_batched_single_select(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        db_engine,
    ) -> None:
        """批查零 N+1：3 个会话各有 pending 对话 → session_dialog_requests 恰一条 SELECT。"""
        from sqlalchemy import event

        admin = await _get_admin(db_session)
        for _ in range(3):
            s = await _make_session(db_session, admin.id)
            run = await _make_run(db_session, s.id)
            await _make_dialog(db_session, agent_session_id=s.id, run_id=run.id)

        statements: list[str] = []

        def _capture(conn, cursor, statement, parameters, context, executemany):
            if "session_dialog_requests" in statement:
                statements.append(statement)

        sync_engine = db_engine.sync_engine
        event.listen(sync_engine, "before_cursor_execute", _capture)
        try:
            resp = await client.get("/api/daemon/sessions", headers=auth_headers)
        finally:
            event.remove(sync_engine, "before_cursor_execute", _capture)

        assert resp.status_code == 200, resp.text
        # 3 个会话 3 条 pending 行，仍只发一条 IN 批查（逐会话查询会 ≥3 条）。
        assert len(statements) == 1, statements


# ── OpenAPI 反映新字段（gen:types 消费面）───────────────────────────────────


class TestOpenApiSchema:
    async def test_openapi_exposes_pending_dialog_kind(self) -> None:
        """非 dev 环境 openapi.json 端点关闭（main.py BS-5），直接经 app.openapi()
        断言 schema——与 pnpm gen:types 消费的 OpenAPI 产物同源。"""
        from app.main import app

        props = app.openapi()["components"]["schemas"]["AgentSessionRead"]["properties"]
        assert "pending_dialog_kind" in props
