"""变更会话后端单测（2026-07-09-change-detail-session / task-10）。

覆盖三组：
- A. ``build_change_context_preamble`` 纯逻辑单测（FR-03 / D-004@v1）
- B. ``GET /workspaces/{wid}/changes/{cid}/sessions`` 列表端点（task-09 / D-005@v1
  跨成员可见 + 标题取首条 user_input + 旧 session 不出现）
- C. ``POST /api/daemon/sessions`` 带 change_id 的绑定 + 前导注入（task-04/08）
  及未带 change_id 零回归

复用 backend/conftest.py 的 in-memory SQLite + AsyncClient + admin auth fixture，
构造真实 Workspace / Change / ChangeDocument / AgentSession / AgentRun / AgentRunLog
行（不 mock model，避免遮蔽真实 FK 路径 —— 见 memory scan-generate-failure-chain）。

Author: SillySpec change 2026-07-09-change-detail-session (Wave 2 task-10)
Created: 2026-07-09
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.auth.model import User
from app.modules.change.model import Change, ChangeDocument
from app.modules.daemon import ws_hub as ws_hub_module
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.ws_hub import DaemonWsHub
from app.modules.workspace.model import Workspace

# ── Fixtures / helpers ───────────────────────────────────────────────────────


@pytest.fixture()
def fresh_ws_hub(monkeypatch: pytest.MonkeyPatch) -> DaemonWsHub:
    """Replace the process-wide ws_hub singleton with a fresh, wired hub.

    同 test_session_router.py：create_session 端点要 wake daemon + 发 SESSION_INJECT，
    必须替换进程级 ws_hub 单例并连接一个 mock WS，否则会因 daemon 离线而 converge 失败。
    """
    hub = DaemonWsHub()
    monkeypatch.setattr(ws_hub_module, "_ws_hub", hub)
    return hub


async def _make_user(session: AsyncSession, *, email: str, display: str | None = None) -> User:
    from app.core.config import get_settings
    from app.core.security import password_hasher

    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        id=uuid.uuid4(),
        email=email,
        password_hash=password_hasher.hash("Admin123!@#"),
        display_name=display or email.split("@")[0],
        status="active",
        is_platform_admin=True,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _make_workspace(session: AsyncSession, *, root_path: str) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="t-ws",
        slug=f"t-ws-{uuid.uuid4().hex[:8]}",
        root_path=root_path,
        path_source="server-local",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _make_change(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    title: str | None = "变更详情页内嵌会话",
    current_stage: str | None = "execute",
    change_key: str | None = None,
) -> Change:
    ck = change_key or f"2026-07-09-test-{uuid.uuid4().hex[:6]}"
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key=ck,
        title=title,
        status="active",
        location="active",
        path=f"changes/{ck}",
        current_stage=current_stage,
    )
    session.add(change)
    await session.commit()
    await session.refresh(change)
    return change


async def _make_doc(
    session: AsyncSession,
    *,
    change_id: uuid.UUID,
    doc_type: str,
    path: str,
    exists: bool = True,
) -> ChangeDocument:
    doc = ChangeDocument(
        id=uuid.uuid4(),
        change_id=change_id,
        doc_type=doc_type,
        path=path,
        exists=exists,
    )
    session.add(doc)
    await session.commit()
    await session.refresh(doc)
    return doc


async def _make_runtime(session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


async def _make_session(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    runtime_id: uuid.UUID,
    change_id: uuid.UUID | None,
    provider: str = "claude",
    status: str = "ended",
    turn_count: int = 1,
    last_active_at: datetime | None = None,
) -> AgentSession:
    now = datetime.now(UTC)
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime_id,
        lease_id=None,
        provider=provider,
        status=status,
        turn_count=turn_count,
        change_id=change_id,
        created_at=now,
        last_active_at=last_active_at or now,
        ended_at=now if status in ("ended", "failed") else None,
    )
    session.add(sess)
    await session.commit()
    await session.refresh(sess)
    return sess


async def _make_run(session: AsyncSession, *, agent_session_id: uuid.UUID) -> AgentRun:
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status="completed",
        agent_session_id=agent_session_id,
        session_id=None,
        started_at=datetime.now(UTC),
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


async def _make_log(
    session: AsyncSession,
    *,
    run_id: uuid.UUID,
    content: str,
    channel: str = "user_input",
    timestamp: datetime | None = None,
) -> AgentRunLog:
    log = AgentRunLog(
        id=uuid.uuid4(),
        run_id=run_id,
        channel=channel,
        content_redacted=content,
        timestamp=timestamp or datetime.now(UTC),
    )
    session.add(log)
    await session.commit()
    await session.refresh(log)
    return log


# ── A. build_change_context_preamble 单测 ────────────────────────────────────


class TestBuildChangeContextPreamble:
    """FR-03 / D-004@v1：前导拼装纯逻辑测试。"""

    async def test_preamble_contains_all_sections(self, db_session: AsyncSession) -> None:
        """标题/阶段/工作目录/design/plan/tasks 路径 + 已变更文件清单全出现。"""
        from app.modules.daemon.session.context import build_change_context_preamble

        ws = await _make_workspace(db_session, root_path="/home/user/proj/foo")
        change = await _make_change(
            db_session,
            workspace_id=ws.id,
            title="变更详情页内嵌会话",
            current_stage="execute",
        )
        for dt in ("proposal", "requirements", "design", "plan", "tasks"):
            await _make_doc(
                db_session,
                change_id=change.id,
                doc_type=dt,
                path=f"changes/{change.change_key}/{dt}.md",
            )
        # mock list_files 返回固定清单（避免文件系统依赖，且隔离 ChangeService 内部解析）
        fake_files = [
            {"path": "design.md"},
            {"path": "plan.md"},
            {"path": "tasks/task-01.md"},
        ]
        with patch(
            "app.modules.change.service.ChangeService.list_files",
            new=AsyncMock(return_value=fake_files),
        ):
            preamble = await build_change_context_preamble(db_session, change.id)

        assert preamble is not None
        assert "【变更上下文】" in preamble
        assert "标题：变更详情页内嵌会话" in preamble
        assert "当前阶段：execute" in preamble
        assert "工作目录：/home/user/proj/foo" in preamble
        # 文档路径按固定顺序、全部出现
        assert "design: changes/" in preamble and "design.md" in preamble
        assert "plan: changes/" in preamble and "plan.md" in preamble
        assert "tasks: changes/" in preamble
        # 已变更文件清单
        assert "已变更文件：" in preamble
        assert "- design.md" in preamble
        assert "- tasks/task-01.md" in preamble

    async def test_preamble_change_id_none_returns_none(self, db_session: AsyncSession) -> None:
        from app.modules.daemon.session.context import build_change_context_preamble

        assert await build_change_context_preamble(db_session, None) is None

    async def test_preamble_unknown_change_returns_none(self, db_session: AsyncSession) -> None:
        from app.modules.daemon.session.context import build_change_context_preamble

        # 传入一个库里不存在的 change_id → 返回 None（查无变更）
        assert await build_change_context_preamble(db_session, uuid.uuid4()) is None

    async def test_preamble_list_files_failure_omits_file_block(
        self, db_session: AsyncSession
    ) -> None:
        """list_files 抛异常时已变更文件块省略但其余信息正常（不崩）。"""
        from app.modules.daemon.session.context import build_change_context_preamble

        ws = await _make_workspace(db_session, root_path="/tmp/proj")
        change = await _make_change(db_session, workspace_id=ws.id, title="T", current_stage="plan")
        await _make_doc(
            db_session,
            change_id=change.id,
            doc_type="design",
            path=f"changes/{change.change_key}/design.md",
        )
        with patch(
            "app.modules.change.service.ChangeService.list_files",
            new=AsyncMock(side_effect=OSError("disk gone")),
        ):
            preamble = await build_change_context_preamble(db_session, change.id)

        assert preamble is not None
        # 标题/阶段/工作目录/design 仍正常
        assert "标题：T" in preamble
        assert "当前阶段：plan" in preamble
        assert "design:" in preamble
        # 已变更文件块被省略
        assert "已变更文件" not in preamble

    async def test_preamble_skips_nonexistent_docs(self, db_session: AsyncSession) -> None:
        """doc_type 在固定顺序里但 exists=False → 该行不出现。"""
        from app.modules.daemon.session.context import build_change_context_preamble

        ws = await _make_workspace(db_session, root_path="/tmp/proj2")
        change = await _make_change(db_session, workspace_id=ws.id, title=None, current_stage=None)
        # 只有 design exists；plan 标 exists=False
        await _make_doc(
            db_session,
            change_id=change.id,
            doc_type="design",
            path="changes/x/design.md",
            exists=True,
        )
        await _make_doc(
            db_session,
            change_id=change.id,
            doc_type="plan",
            path="changes/x/plan.md",
            exists=False,
        )
        with patch(
            "app.modules.change.service.ChangeService.list_files",
            new=AsyncMock(return_value=[]),
        ):
            preamble = await build_change_context_preamble(db_session, change.id)
        assert preamble is not None
        assert "design:" in preamble
        assert "plan:" not in preamble


# ── B. GET /workspaces/{wid}/changes/{cid}/sessions 列表端点 ─────────────────


class TestListChangeSessions:
    """task-09 / D-005@v1：变更级会话列表，跨成员可见 + 标题取首条 user_input。"""

    async def test_filters_by_change_id_cross_member(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """只返回 change_id=该变更 的会话；旧会话(change_id=None)与另一变更不出。"""
        admin = (
            (await db_session.execute(select(User).where(User.email == "admin@example.com")))
            .scalars()
            .first()
        )
        assert admin is not None
        member2 = await _make_user(
            db_session, email=f"m2-{uuid.uuid4()}@example.com", display="Mem2"
        )
        rt_a = await _make_runtime(db_session, admin.id)
        rt_b = await _make_runtime(db_session, member2.id)

        ws = await _make_workspace(db_session, root_path=f"/tmp/ws-{uuid.uuid4()}")
        change = await _make_change(db_session, workspace_id=ws.id)
        other_change = await _make_change(
            db_session, workspace_id=ws.id, change_key=f"other-{uuid.uuid4().hex[:6]}"
        )

        # 该变更：admin + member2 各一会话（跨成员可见 D-005）
        s_admin = await _make_session(
            db_session, user_id=admin.id, runtime_id=rt_a.id, change_id=change.id
        )
        s_mem = await _make_session(
            db_session, user_id=member2.id, runtime_id=rt_b.id, change_id=change.id
        )
        # 噪声：旧会话 change_id=None + 另一变更的会话
        await _make_session(db_session, user_id=admin.id, runtime_id=rt_a.id, change_id=None)
        await _make_session(
            db_session, user_id=admin.id, runtime_id=rt_a.id, change_id=other_change.id
        )

        resp = await client.get(
            f"/api/workspaces/{ws.id}/changes/{change.id}/sessions",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        items = resp.json()
        ids = {i["id"] for i in items}
        assert ids == {str(s_admin.id), str(s_mem.id)}

    async def test_author_display_name(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        admin = (
            (await db_session.execute(select(User).where(User.email == "admin@example.com")))
            .scalars()
            .first()
        )
        assert admin is not None
        member2 = await _make_user(
            db_session, email=f"dn-{uuid.uuid4()}@example.com", display="DisplayName2"
        )
        rt_a = await _make_runtime(db_session, admin.id)
        rt_b = await _make_runtime(db_session, member2.id)
        ws = await _make_workspace(db_session, root_path=f"/tmp/ws-{uuid.uuid4()}")
        change = await _make_change(db_session, workspace_id=ws.id)
        await _make_session(db_session, user_id=admin.id, runtime_id=rt_a.id, change_id=change.id)
        await _make_session(db_session, user_id=member2.id, runtime_id=rt_b.id, change_id=change.id)

        resp = await client.get(
            f"/api/workspaces/{ws.id}/changes/{change.id}/sessions",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        names = {i["author"]["display_name"] for i in resp.json()}
        assert "DisplayName2" in names

    async def test_title_from_first_user_input(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """标题取该会话最早一条 channel=user_input 的 AgentRunLog 摘要（前30字）。"""
        admin = (
            (await db_session.execute(select(User).where(User.email == "admin@example.com")))
            .scalars()
            .first()
        )
        assert admin is not None
        rt = await _make_runtime(db_session, admin.id)
        ws = await _make_workspace(db_session, root_path=f"/tmp/ws-{uuid.uuid4()}")
        change = await _make_change(db_session, workspace_id=ws.id)

        sess = await _make_session(
            db_session, user_id=admin.id, runtime_id=rt.id, change_id=change.id
        )
        run = await _make_run(db_session, agent_session_id=sess.id)
        # 较早的 user_input 应作为标题来源
        await _make_log(
            db_session,
            run_id=run.id,
            content="帮我实现变更详情页的内嵌会话功能",
            timestamp=datetime.now(UTC) - timedelta(minutes=5),
        )
        # 较晚的另一条 user_input 不应作为标题
        await _make_log(
            db_session,
            run_id=run.id,
            content="后面这条不该当标题",
            timestamp=datetime.now(UTC),
        )

        resp = await client.get(
            f"/api/workspaces/{ws.id}/changes/{change.id}/sessions",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        items = resp.json()
        target = next(i for i in items if i["id"] == str(sess.id))
        assert target["title"] is not None
        assert target["title"].startswith("帮我实现变更详情页")
        assert len(target["title"]) <= 30

    async def test_title_none_when_no_user_input(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """无 user_input 日志时 title=None。"""
        admin = (
            (await db_session.execute(select(User).where(User.email == "admin@example.com")))
            .scalars()
            .first()
        )
        assert admin is not None
        rt = await _make_runtime(db_session, admin.id)
        ws = await _make_workspace(db_session, root_path=f"/tmp/ws-{uuid.uuid4()}")
        change = await _make_change(db_session, workspace_id=ws.id)
        sess = await _make_session(
            db_session, user_id=admin.id, runtime_id=rt.id, change_id=change.id
        )
        # 只有 stdout 日志
        run = await _make_run(db_session, agent_session_id=sess.id)
        await _make_log(db_session, run_id=run.id, content="some output", channel="stdout")

        resp = await client.get(
            f"/api/workspaces/{ws.id}/changes/{change.id}/sessions",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        target = next(i for i in resp.json() if i["id"] == str(sess.id))
        assert target["title"] is None

    async def test_sorted_by_last_active_desc(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        admin = (
            (await db_session.execute(select(User).where(User.email == "admin@example.com")))
            .scalars()
            .first()
        )
        assert admin is not None
        rt = await _make_runtime(db_session, admin.id)
        ws = await _make_workspace(db_session, root_path=f"/tmp/ws-{uuid.uuid4()}")
        change = await _make_change(db_session, workspace_id=ws.id)
        base = datetime.now(UTC)
        s_old = await _make_session(
            db_session,
            user_id=admin.id,
            runtime_id=rt.id,
            change_id=change.id,
            last_active_at=base - timedelta(hours=2),
        )
        s_new = await _make_session(
            db_session,
            user_id=admin.id,
            runtime_id=rt.id,
            change_id=change.id,
            last_active_at=base,
        )

        resp = await client.get(
            f"/api/workspaces/{ws.id}/changes/{change.id}/sessions",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        ids = [i["id"] for i in resp.json()]
        assert ids == [str(s_new.id), str(s_old.id)]

    async def test_empty_when_no_sessions(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        ws = await _make_workspace(db_session, root_path=f"/tmp/ws-{uuid.uuid4()}")
        change = await _make_change(db_session, workspace_id=ws.id)
        resp = await client.get(
            f"/api/workspaces/{ws.id}/changes/{change.id}/sessions",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json() == []


# ── C. POST /api/daemon/sessions 绑定 + 前导注入 ─────────────────────────────


def _connect_mock_ws(hub: DaemonWsHub, runtime_id: uuid.UUID) -> AsyncMock:
    """Build a mock WS that records sent messages (parity with test_session_router).

    返回值是 AsyncMock（非 coroutine），调用方直接用其结果接 ``hub.connect``。
    """
    ws = AsyncMock()
    ws.sent_messages = []

    async def _send_json(message: dict) -> None:
        ws.sent_messages.append(message)

    ws.send_json = AsyncMock(side_effect=_send_json)
    ws.close = AsyncMock()
    return ws


async def _admin(db_session: AsyncSession) -> User:
    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None
    return admin


class TestCreateSessionChangeBinding:
    """task-04/08：带 change_id 创建 → 绑定 + 前导注入；未带 → 零回归。"""

    async def test_create_with_change_binds_and_injects_preamble(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """带 change_id+workspace_id → AgentSession 绑定 + cwd=workspace.root_path
        + AgentRun.change_id 一致；lease.metadata.prompt 含【变更上下文】前导；
        AgentRunLog(user_input).content_redacted 是干净 prompt（不含前导）。"""
        from app.modules.daemon.model import DaemonTaskLease

        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        ws = _connect_mock_ws(fresh_ws_hub, rt.id)
        await fresh_ws_hub.connect(rt.id, ws)

        ws_row = await _make_workspace(db_session, root_path="/tmp/change-proj")
        change = await _make_change(
            db_session, workspace_id=ws_row.id, title="绑定测试变更", current_stage="execute"
        )
        await _make_doc(
            db_session,
            change_id=change.id,
            doc_type="design",
            path=f"changes/{change.change_key}/design.md",
        )

        user_prompt = "开始实现吧"
        resp = await client.post(
            "/api/daemon/sessions",
            json={
                "provider": "claude",
                "prompt": user_prompt,
                "model": None,
                "change_id": str(change.id),
                "workspace_id": str(ws_row.id),
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        session_id = body["session_id"]
        run_id = body["run_id"]
        lease_id = body["lease_id"]

        # 1. AgentSession 绑定
        sess = await db_session.get(AgentSession, uuid.UUID(session_id))
        assert sess is not None
        assert sess.change_id == change.id
        assert sess.workspace_id == ws_row.id
        assert sess.cwd == "/tmp/change-proj"

        # 2. AgentRun.change_id 一致
        run = await db_session.get(AgentRun, uuid.UUID(run_id))
        assert run is not None
        assert run.change_id == change.id

        # 3. lease.metadata.prompt 含【变更上下文】前导
        lease = await db_session.get(DaemonTaskLease, uuid.UUID(lease_id))
        assert lease is not None
        meta = lease.metadata_ or {}
        assert "【变更上下文】" in meta.get("prompt", "")
        assert user_prompt in meta.get("prompt", "")

        # 4. AgentRunLog(user_input) 干净 prompt（不含前导）
        log_row = (
            (
                await db_session.execute(
                    select(AgentRunLog).where(
                        AgentRunLog.run_id == uuid.UUID(run_id),
                        AgentRunLog.channel == "user_input",
                    )
                )
            )
            .scalars()
            .first()
        )
        assert log_row is not None
        assert log_row.content_redacted == user_prompt
        assert "【变更上下文】" not in (log_row.content_redacted or "")

    async def test_create_without_change_is_regression_free(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """未带 change_id → AgentSession.change_id/workspace_id 为 None（零回归）。"""
        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        ws = _connect_mock_ws(fresh_ws_hub, rt.id)
        await fresh_ws_hub.connect(rt.id, ws)

        resp = await client.post(
            "/api/daemon/sessions",
            json={"provider": "claude", "prompt": "普通对话", "model": None},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        session_id = resp.json()["session_id"]
        sess = await db_session.get(AgentSession, uuid.UUID(session_id))
        assert sess is not None
        assert sess.change_id is None
        assert sess.workspace_id is None
        assert sess.cwd is None
