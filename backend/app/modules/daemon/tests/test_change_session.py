"""变更会话后端单测（2026-07-09-change-detail-session / task-10）。

覆盖三组：
- A. ``build_change_context_preamble`` 纯逻辑单测（FR-03 / D-004@v1）
- B. ``GET /workspaces/{wid}/changes/{cid}/sessions`` 列表端点（task-09 / D-005@v1
  跨成员可见 + 标题取首条 user_input + 旧 session 不出现；2026-08-25-
  session-spec-binding task-03 起数据源为 change_session_links M:N——D-002@v1
  links 为唯一关联真相，建数据须造 link 行）
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
from app.modules.change.model import (
    Change,
    ChangeDocument,
    ChangeSessionLink,
    QuicklogSessionLink,
)
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
    deleted_at: datetime | None = None,
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
        deleted_at=deleted_at,
    )
    session.add(sess)
    await session.commit()
    await session.refresh(sess)
    return sess


async def _make_change_session_link(
    session: AsyncSession,
    *,
    change_id: uuid.UUID,
    session_id: uuid.UUID,
) -> ChangeSessionLink:
    """造 change_session_links 绑定行（task-03 起列表端点数据源为 links M:N）。

    D-002@v1：单 FK ``AgentSession.change_id`` 冻结为冗余提示，读取一律走
    links——测试里出现在列表中的会话必须经本 helper（或等价 link 行）绑定。
    """
    link = ChangeSessionLink(
        id=uuid.uuid4(),
        change_id=change_id,
        session_id=session_id,
    )
    session.add(link)
    await session.commit()
    await session.refresh(link)
    return link


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

        # 该变更：admin + member2 各一会话（跨成员可见 D-005）。task-03 起数据源
        # 为 change_session_links（D-002@v1），会话须造 link 行才命中（单 FK 照写
        # 模拟迁移播种后的存量行）。
        s_admin = await _make_session(
            db_session, user_id=admin.id, runtime_id=rt_a.id, change_id=change.id
        )
        s_mem = await _make_session(
            db_session, user_id=member2.id, runtime_id=rt_b.id, change_id=change.id
        )
        await _make_change_session_link(db_session, change_id=change.id, session_id=s_admin.id)
        await _make_change_session_link(db_session, change_id=change.id, session_id=s_mem.id)
        # 噪声：旧会话 change_id=None（无 link）+ 另一变更的会话（link 绑到
        # other_change——link 级隔离，证明过滤发生在 links 而非单 FK）。
        await _make_session(db_session, user_id=admin.id, runtime_id=rt_a.id, change_id=None)
        s_other = await _make_session(
            db_session, user_id=admin.id, runtime_id=rt_a.id, change_id=other_change.id
        )
        await _make_change_session_link(
            db_session, change_id=other_change.id, session_id=s_other.id
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
        s_a = await _make_session(
            db_session, user_id=admin.id, runtime_id=rt_a.id, change_id=change.id
        )
        s_b = await _make_session(
            db_session, user_id=member2.id, runtime_id=rt_b.id, change_id=change.id
        )
        await _make_change_session_link(db_session, change_id=change.id, session_id=s_a.id)
        await _make_change_session_link(db_session, change_id=change.id, session_id=s_b.id)

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
        await _make_change_session_link(db_session, change_id=change.id, session_id=sess.id)
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
        await _make_change_session_link(db_session, change_id=change.id, session_id=sess.id)
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
        await _make_change_session_link(db_session, change_id=change.id, session_id=s_old.id)
        await _make_change_session_link(db_session, change_id=change.id, session_id=s_new.id)

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

    async def test_link_only_session_listed_others_excluded(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """task-03 M:N 语义（FR-03 / D-002@v1）：

        - 仅 link 绑定（无单 FK）的会话**出现在**结果中——M:N 命中是新数据源的
          核心语义（一会话可关联多变更，本端点只认 links）；
        - 单 FK 无 link（迁移播种前的裸 FK 行）**不出现**——锁定数据源已从
          ``AgentSession.change_id`` 切到 links，防止实现回退到单 FK 过滤；
        - 软删会话（deleted_at 非空）即使有 link **不出现**（FR-07 软删过滤）。

        「FK+link 双写行命中」由本组其余用例覆盖（均按播种后形态建数据）。
        """
        admin = (
            (await db_session.execute(select(User).where(User.email == "admin@example.com")))
            .scalars()
            .first()
        )
        assert admin is not None
        rt = await _make_runtime(db_session, admin.id)
        ws = await _make_workspace(db_session, root_path=f"/tmp/ws-{uuid.uuid4()}")
        change = await _make_change(db_session, workspace_id=ws.id)

        # 仅 link 无单 FK：会话 change_id=None，但 link 绑到本变更 → 应命中
        s_link_only = await _make_session(
            db_session, user_id=admin.id, runtime_id=rt.id, change_id=None
        )
        await _make_change_session_link(db_session, change_id=change.id, session_id=s_link_only.id)
        # 单 FK 无 link：裸 FK 行（播种迁移前的存量形态）→ 不出现
        await _make_session(db_session, user_id=admin.id, runtime_id=rt.id, change_id=change.id)
        # 软删：有 link 但 deleted_at 非空 → 不出现
        s_deleted = await _make_session(
            db_session,
            user_id=admin.id,
            runtime_id=rt.id,
            change_id=change.id,
            deleted_at=datetime.now(UTC),
        )
        await _make_change_session_link(db_session, change_id=change.id, session_id=s_deleted.id)

        resp = await client.get(
            f"/api/workspaces/{ws.id}/changes/{change.id}/sessions",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        ids = {i["id"] for i in resp.json()}
        assert ids == {str(s_link_only.id)}

    async def test_mode_from_session_config(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """AgentSessionListItem.mode 取自 AgentSession.config['mode']（D-005@v1 组装）。"""
        admin = (
            (await db_session.execute(select(User).where(User.email == "admin@example.com")))
            .scalars()
            .first()
        )
        assert admin is not None
        rt = await _make_runtime(db_session, admin.id)
        ws = await _make_workspace(db_session, root_path=f"/tmp/ws-{uuid.uuid4()}")
        change = await _make_change(db_session, workspace_id=ws.id)

        # 会话 A：config 含 mode="plan"
        sess_a = await _make_session(
            db_session, user_id=admin.id, runtime_id=rt.id, change_id=change.id
        )
        sess_a.config = {"mode": "plan", "manual_approval": True}
        db_session.add(sess_a)
        await db_session.commit()

        # 会话 B：config 无 mode（mode 应为 None）
        sess_b = await _make_session(
            db_session, user_id=admin.id, runtime_id=rt.id, change_id=change.id
        )
        await _make_change_session_link(db_session, change_id=change.id, session_id=sess_a.id)
        await _make_change_session_link(db_session, change_id=change.id, session_id=sess_b.id)

        resp = await client.get(
            f"/api/workspaces/{ws.id}/changes/{change.id}/sessions",
            headers=auth_headers,
        )
        assert resp.status_code == 200
        items = resp.json()
        item_a = next(i for i in items if i["id"] == str(sess_a.id))
        item_b = next(i for i in items if i["id"] == str(sess_b.id))
        assert item_a["mode"] == "plan"
        assert item_b["mode"] is None


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

        # 1. AgentSession 绑定（单 FK 照写，D-002@v1 冻结语义）
        sess = await db_session.get(AgentSession, uuid.UUID(session_id))
        assert sess is not None
        assert sess.change_id == change.id
        assert sess.workspace_id == ws_row.id
        assert sess.cwd == "/tmp/change-proj"

        # 1b. task-08 / D-002@v1 双写：change_session_links 同步出现绑定行
        # （创建落库点补写；links 是关联唯一真相，单 FK 仅为冗余提示）。
        c_link = (
            (
                await db_session.execute(
                    select(ChangeSessionLink).where(
                        ChangeSessionLink.change_id == change.id,
                        ChangeSessionLink.session_id == uuid.UUID(session_id),
                    )
                )
            )
            .scalars()
            .first()
        )
        assert c_link is not None

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
        """未带 change_id → AgentSession.change_id/workspace_id 为 None（零回归）；
        task-08：change_id/quicklog_id 两参都空 → 零 link 副作用（既有行为）。"""
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

        # task-08 零 link 副作用：无 change_session_links / quicklog_session_links 行。
        sid = uuid.UUID(session_id)
        c_links = (
            (
                await db_session.execute(
                    select(ChangeSessionLink).where(ChangeSessionLink.session_id == sid)
                )
            )
            .scalars()
            .all()
        )
        assert c_links == []
        q_links = (
            (
                await db_session.execute(
                    select(QuicklogSessionLink).where(QuicklogSessionLink.session_id == sid)
                )
            )
            .scalars()
            .all()
        )
        assert q_links == []

    async def test_create_with_change_and_team_mission_double_preamble_order(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """change_id + team_mission 同携（task-09 / R-06）：dispatch prompt 顺序
        定死——变更前导（既有，在前）→ 团队简报 → ``\\n\\n---\\n\\n`` → 用户消息；
        mission 行落库、首 run 双标记；AgentRunLog(user_input) 仍干净原文。"""
        from app.modules.agent.model import AgentMission, AgentRun
        from app.modules.daemon.model import DaemonTaskLease

        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        ws = _connect_mock_ws(fresh_ws_hub, rt.id)
        await fresh_ws_hub.connect(rt.id, ws)

        ws_row = await _make_workspace(db_session, root_path="/tmp/double-preamble")
        change = await _make_change(
            db_session, workspace_id=ws_row.id, title="双前导变更", current_stage="execute"
        )
        await _make_doc(
            db_session,
            change_id=change.id,
            doc_type="design",
            path=f"changes/{change.change_key}/design.md",
        )

        user_prompt = "按简报开工"
        resp = await client.post(
            "/api/daemon/sessions",
            json={
                "provider": "claude",
                "prompt": user_prompt,
                "model": None,
                "change_id": str(change.id),
                "workspace_id": str(ws_row.id),
                "team_mission": {
                    "objective": "双前导目标",
                    "scope_workspace_ids": [str(ws_row.id)],
                },
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        session_id = uuid.UUID(body["session_id"])
        run_id = uuid.UUID(body["run_id"])

        # 1. mission 行落库 + 首 run 双标记。
        missions = (await db_session.execute(select(AgentMission))).scalars().all()
        assert len(missions) == 1
        assert missions[0].session_id == session_id
        assert missions[0].objective == "双前导目标"
        run = await db_session.get(AgentRun, run_id)
        assert run is not None
        assert run.mission_id == missions[0].id
        assert run.role == "orchestrator"

        # 2. lease metadata prompt：变更前导 → 团队简报 → --- → 用户消息（顺序定死）。
        lease = await db_session.get(DaemonTaskLease, uuid.UUID(body["lease_id"]))
        assert lease is not None
        meta_prompt = (lease.metadata_ or {}).get("prompt", "")
        assert "【变更上下文】" in meta_prompt
        assert "【团队任务简报" in meta_prompt
        assert str(missions[0].id) in meta_prompt
        i_change = meta_prompt.index("【变更上下文】")
        i_brief = meta_prompt.index("【团队任务简报")
        i_user = meta_prompt.index(user_prompt)
        assert i_change < i_brief < i_user
        assert "\n\n---\n\n" in meta_prompt

        # 3. AgentRunLog(user_input) 干净用户原文。
        log_row = (
            (
                await db_session.execute(
                    select(AgentRunLog).where(
                        AgentRunLog.run_id == run_id,
                        AgentRunLog.channel == "user_input",
                    )
                )
            )
            .scalars()
            .first()
        )
        assert log_row is not None
        assert log_row.content_redacted == user_prompt
        assert "【团队任务简报" not in (log_row.content_redacted or "")
        assert "【变更上下文】" not in (log_row.content_redacted or "")


# ── D. DTO 具名化（2026-08-14-sessions-portal task-02 / FR-01 / D-010@v1）────
# SessionCreateRequest/SessionInjectRequest 迁 schema.py 后的契约回归：
# 老请求体（provider+prompt）零回归、新字段可选、双入口二选一校验、
# AgentSessionRead 新增配置三列序列化。


class TestSessionCreateRequestDto:
    """task-02：具名 DTO 校验语义与双入口契约。"""

    async def test_old_body_provider_prompt_only_regression_free(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """/runtimes 弹窗老请求体（provider+prompt+多余 model 字段）→ 201 零回归。

        model 字段已随 design §5 移除：pydantic 默认忽略多余字段，继续上送不 422，
        仅不再写入 config/run。manual_approval/ask_user_only 默认值按 design §5
        调整为 True（现有前端弹窗均显式传 true，实际行为不变）。
        """
        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        ws = _connect_mock_ws(fresh_ws_hub, rt.id)
        await fresh_ws_hub.connect(rt.id, ws)

        resp = await client.post(
            "/api/daemon/sessions",
            json={"provider": "claude", "prompt": "老路径", "model": None},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        sess = await db_session.get(AgentSession, uuid.UUID(resp.json()["session_id"]))
        assert sess is not None
        assert sess.provider == "claude"
        assert (sess.config or {}).get("manual_approval") is True
        assert "model" not in (sess.config or {})

    async def test_new_optional_fields_accepted_passthrough(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """新字段（agent_profile_id/llm_provider_id）可选，真实 id 传了不 422。

        task-03 落地解析后占位语义升级：随机 id 不再静默透传（profile 不存在 →
        404，见 test_session_create_config.py），本测试改种子真实档案 + 供应商
        （admin 属主，agent_kind=claude 匹配 provider 老入口），验证字段被
        接受且会话照常创建。
        """
        from app.core.crypto import get_cipher
        from app.modules.agent.profile.model import AgentProfile
        from app.modules.llm_provider.model import LlmProvider

        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        ws = _connect_mock_ws(fresh_ws_hub, rt.id)
        await fresh_ws_hub.connect(rt.id, ws)

        profile = AgentProfile(
            id=uuid.uuid4(),
            name="t02-profile",
            owner_user_id=admin.id,
            provider="claude",
            system_prompt="t02-prompt",
        )
        cipher = get_cipher()
        ct, key_id = cipher.encrypt("sk-t02")
        provider_row = LlmProvider(
            id=uuid.uuid4(),
            user_id=admin.id,
            name="t02-provider",
            agent_kind="claude",
            encrypted_api_key=ct,
            key_id=key_id,
            model="t02-model",
            api_format="anthropic",
        )
        db_session.add_all([profile, provider_row])
        await db_session.commit()

        resp = await client.post(
            "/api/daemon/sessions",
            json={
                "provider": "claude",
                "prompt": "带配置字段",
                "agent_profile_id": str(profile.id),
                "llm_provider_id": str(provider_row.id),
                "manual_approval": False,
                "ask_user_only": False,
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        sess = await db_session.get(AgentSession, uuid.UUID(resp.json()["session_id"]))
        assert sess is not None
        assert sess.agent_profile_id == profile.id
        assert sess.llm_provider_id == provider_row.id

    async def test_missing_both_runtime_and_provider_422(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        """design §5 双入口二选一：runtime_id 与 provider 都缺 → 422。"""
        resp = await client.post(
            "/api/daemon/sessions",
            json={"prompt": "没有入口"},
            headers=auth_headers,
        )
        assert resp.status_code == 422

    async def test_bad_provider_value_still_422(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        """provider Literal 校验保留：非 claude/codex → 422。"""
        resp = await client.post(
            "/api/daemon/sessions",
            json={"provider": "gemini", "prompt": "hi"},
            headers=auth_headers,
        )
        assert resp.status_code == 422

    async def test_session_read_serializes_new_config_columns(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """AgentSessionRead 新增 agent_profile_id/llm_provider_id/config_snapshot
        三字段（task-01 ORM 列，未写入时序列化为 null）。"""
        admin = await _admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        await _make_session(db_session, user_id=admin.id, runtime_id=rt.id, change_id=None)

        resp = await client.get("/api/daemon/sessions", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        items = resp.json()["items"]
        assert items, "应至少有一条会话"
        for item in items:
            assert "agent_profile_id" in item
            assert "llm_provider_id" in item
            assert "config_snapshot" in item
