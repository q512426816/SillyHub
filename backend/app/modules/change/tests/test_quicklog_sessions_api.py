"""快速修复-会话列表端点单测（2026-08-25-session-spec-binding / task-07）。

覆盖 ``GET /api/workspaces/{wid}/quicklog-entries/{ql_id}/sessions``
（FR-04 数据源 / D-001@v1 自然键 link / D-006@v1 门户数据面）：

1. 绑定命中返回列表——含 title（首条 user_input 前 30 字）与 author 展示名；
2. 无绑定返回空列表（不 404——快速修复刚建、尚无会话是常态，design §5.W3.2）；
3. 软删会话（deleted_at 非空）过滤；
4. 跨 workspace 隔离——ws_b 的同 ql_id 绑定不串到 ws_a；
5. 跨成员可见——非 owner、具备 CHANGE_READ 的工作区成员可读（对齐
   ``list_change_sessions`` 现状：列表跨成员、不加 user_id 过滤）；
6. 同一 ql_id 绑定多会话按 last_active_at 倒序。

复用 backend/conftest.py 的 in-memory SQLite + AsyncClient + admin auth
fixture，构造真实 Workspace / User / DaemonRuntime / AgentSession / AgentRun /
AgentRunLog / QuicklogSessionLink 行（不 mock model，避免遮蔽真实 FK 路径；
fixture 模式参照 daemon/tests/test_change_session.py——QuicklogSessionLink
模型在 app.modules.change.model）。

Author: SillySpec change 2026-08-25-session-spec-binding (W3 task-07)
Created: 2026-08-25
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.change.model import QuicklogSessionLink
from app.modules.daemon.model import DaemonRuntime
from app.modules.workspace.model import Workspace

# ── Fixtures / helpers（模式对齐 daemon/tests/test_change_session.py）──────


async def _make_user(session: AsyncSession, *, email: str, display: str | None = None) -> User:
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        id=uuid.uuid4(),
        email=email,
        password_hash=password_hasher.hash("Admin123!@#"),
        display_name=display or email.split("@")[0],
        status="active",
        # 默认非平台管理员：跨成员用例要验证的是工作区成员路径而非 admin 短路。
        is_platform_admin=False,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _make_admin(db_session: AsyncSession) -> User:
    """取根 conftest ``auth_headers`` fixture 已建好的平台管理员。"""
    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None
    return admin


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
        # quicklog 绑定与 AgentSession.change_id 单 FK 无关（D-002@v1 冻结语义），
        # 此处恒 None 以锁定端点只读 quicklog_session_links。
        change_id=None,
        created_at=now,
        last_active_at=last_active_at or now,
        ended_at=now if status in ("ended", "failed") else None,
        deleted_at=deleted_at,
    )
    session.add(sess)
    await session.commit()
    await session.refresh(sess)
    return sess


async def _make_quicklog_link(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    ql_id: str,
    session_id: uuid.UUID,
) -> QuicklogSessionLink:
    """造 quicklog_session_links 绑定行（本端点唯一数据源，D-001@v1）。"""
    link = QuicklogSessionLink(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        ql_id=ql_id,
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


def _token(user: User) -> str:
    """为非 admin 用户签 access token（模式对齐 agent/tests/test_execution_context.py）。"""
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return token


async def _grant_change_read(
    session: AsyncSession, *, user_id: uuid.UUID, workspace_id: uuid.UUID
) -> None:
    """给业务用户授工作区级 change:read（Role + RolePermission + UserWorkspaceRole）。

    测试 DB 不跑 alembic 没有 seed 角色，手工建（模式对齐
    agent/tests/test_execution_context.py 的 workspace_owner 手工建法）。
    """
    role_id = uuid.uuid4()
    session.add(Role(id=role_id, key="ws_member", name="WS Member", description="test role"))
    session.add(RolePermission(role_id=role_id, permission="change:read"))
    session.add(
        UserWorkspaceRole(
            user_id=user_id,
            workspace_id=workspace_id,
            role_id=role_id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )
    await session.commit()


def _unique_ql_id() -> str:
    """每测试独立 ql_id（自然键格式 ql-YYYYMMDD-NNN-后缀，D-001@v1）。"""
    return f"ql-20260825-{uuid.uuid4().hex[:8]}"


# ── GET /workspaces/{wid}/quicklog-entries/{ql_id}/sessions ─────────────────


class TestListQuicklogSessions:
    """task-07（FR-04 / D-001@v1 / D-006@v1）：快速修复级会话列表。"""

    async def test_bound_session_with_title_and_author(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """绑定命中：返回 AgentSessionListItem，title=首条 user_input 前 30 字、
        author 含展示名。"""
        admin = await _make_admin(db_session)
        owner = await _make_user(
            db_session, email=f"owner-{uuid.uuid4()}@example.com", display="QuickOwner"
        )
        rt = await _make_runtime(db_session, owner.id)
        ws = await _make_workspace(db_session, root_path=f"/tmp/ws-{uuid.uuid4()}")
        ql_id = _unique_ql_id()

        sess = await _make_session(db_session, user_id=owner.id, runtime_id=rt.id)
        await _make_quicklog_link(db_session, workspace_id=ws.id, ql_id=ql_id, session_id=sess.id)
        run = await _make_run(db_session, agent_session_id=sess.id)
        # 最早一条 user_input 是标题来源；内容 >30 字验证截断（前 30 字）。
        first_input = "帮我修复快速修复抽屉里会话卡片不显示的这一段超长的问题描述文本"
        await _make_log(
            db_session,
            run_id=run.id,
            content=first_input,
            timestamp=datetime.now(UTC) - timedelta(minutes=5),
        )
        await _make_log(
            db_session,
            run_id=run.id,
            content="后面这条不该当标题",
            timestamp=datetime.now(UTC),
        )

        resp = await client.get(
            f"/api/workspaces/{ws.id}/quicklog-entries/{ql_id}/sessions",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        items = resp.json()
        assert len(items) == 1
        item = items[0]
        assert item["id"] == str(sess.id)
        assert item["provider"] == "claude"
        assert item["title"] == first_input[:30]
        assert item["author"]["user_id"] == str(owner.id)
        assert item["author"]["display_name"] == "QuickOwner"
        # 噪声：admin 名下未绑定的会话（同 workspace）不出现——命中只认 link 行。
        s_noise = await _make_session(db_session, user_id=admin.id, runtime_id=rt.id)
        assert s_noise.id not in {i["id"] for i in items}

    async def test_empty_when_no_links(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """无绑定返回空列表（不 404）——快速修复先无会话是常态（design §5.W3.2）。"""
        ws = await _make_workspace(db_session, root_path=f"/tmp/ws-{uuid.uuid4()}")
        ql_id = _unique_ql_id()

        resp = await client.get(
            f"/api/workspaces/{ws.id}/quicklog-entries/{ql_id}/sessions",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == []

    async def test_deleted_session_filtered(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """软删会话（deleted_at 非空）即使有 link 也不出现（对齐变更侧 FR-07）。"""
        admin = await _make_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        ws = await _make_workspace(db_session, root_path=f"/tmp/ws-{uuid.uuid4()}")
        ql_id = _unique_ql_id()

        s_live = await _make_session(db_session, user_id=admin.id, runtime_id=rt.id)
        s_deleted = await _make_session(
            db_session,
            user_id=admin.id,
            runtime_id=rt.id,
            deleted_at=datetime.now(UTC),
        )
        await _make_quicklog_link(db_session, workspace_id=ws.id, ql_id=ql_id, session_id=s_live.id)
        await _make_quicklog_link(
            db_session, workspace_id=ws.id, ql_id=ql_id, session_id=s_deleted.id
        )

        resp = await client.get(
            f"/api/workspaces/{ws.id}/quicklog-entries/{ql_id}/sessions",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        ids = {i["id"] for i in resp.json()}
        assert ids == {str(s_live.id)}

    async def test_workspace_isolation(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """跨 workspace 隔离：ws_b 的同 ql_id 绑定不串到 ws_a（隔离在 link 行
        workspace_id，非 ql_id 全局匹配）。"""
        admin = await _make_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        ws_a = await _make_workspace(db_session, root_path=f"/tmp/wsa-{uuid.uuid4()}")
        ws_b = await _make_workspace(db_session, root_path=f"/tmp/wsb-{uuid.uuid4()}")
        ql_id = _unique_ql_id()

        # 同一 ql_id 只绑在 ws_b；ws_a 无绑定行。
        s_b = await _make_session(db_session, user_id=admin.id, runtime_id=rt.id)
        await _make_quicklog_link(db_session, workspace_id=ws_b.id, ql_id=ql_id, session_id=s_b.id)

        resp_a = await client.get(
            f"/api/workspaces/{ws_a.id}/quicklog-entries/{ql_id}/sessions",
            headers=auth_headers,
        )
        assert resp_a.status_code == 200, resp_a.text
        assert resp_a.json() == []

        resp_b = await client.get(
            f"/api/workspaces/{ws_b.id}/quicklog-entries/{ql_id}/sessions",
            headers=auth_headers,
        )
        assert resp_b.status_code == 200, resp_b.text
        ids = {i["id"] for i in resp_b.json()}
        assert ids == {str(s_b.id)}

    async def test_cross_member_visible(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """跨成员可见：非 owner、具备 CHANGE_READ 的工作区成员（非平台管理员，
        走工作区角色授权路径而非 admin 短路）可读到他人会话。"""
        owner = await _make_user(
            db_session, email=f"qo-{uuid.uuid4()}@example.com", display="QOwner"
        )
        rt = await _make_runtime(db_session, owner.id)
        ws = await _make_workspace(db_session, root_path=f"/tmp/ws-{uuid.uuid4()}")
        ql_id = _unique_ql_id()

        sess = await _make_session(db_session, user_id=owner.id, runtime_id=rt.id)
        await _make_quicklog_link(db_session, workspace_id=ws.id, ql_id=ql_id, session_id=sess.id)

        # 另一成员：非 admin、非会话 owner，被授工作区级 change:read。
        member = await _make_user(
            db_session, email=f"qm-{uuid.uuid4()}@example.com", display="QMember"
        )
        await _grant_change_read(db_session, user_id=member.id, workspace_id=ws.id)

        resp = await client.get(
            f"/api/workspaces/{ws.id}/quicklog-entries/{ql_id}/sessions",
            headers={"Authorization": f"Bearer {_token(member)}"},
        )
        assert resp.status_code == 200, resp.text
        items = resp.json()
        assert len(items) == 1
        assert items[0]["id"] == str(sess.id)
        assert items[0]["author"]["display_name"] == "QOwner"

    async def test_sorted_by_last_active_desc(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """同一 ql_id 绑定多个会话按 last_active_at 倒序（最近活跃优先）。"""
        admin = await _make_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        ws = await _make_workspace(db_session, root_path=f"/tmp/ws-{uuid.uuid4()}")
        ql_id = _unique_ql_id()
        base = datetime.now(UTC)

        # 造行顺序刻意与活跃度错开（旧→新），验证排序非插入序。
        s_old = await _make_session(
            db_session,
            user_id=admin.id,
            runtime_id=rt.id,
            last_active_at=base - timedelta(hours=2),
        )
        s_new = await _make_session(
            db_session, user_id=admin.id, runtime_id=rt.id, last_active_at=base
        )
        s_mid = await _make_session(
            db_session,
            user_id=admin.id,
            runtime_id=rt.id,
            last_active_at=base - timedelta(hours=1),
        )
        for s in (s_old, s_new, s_mid):
            await _make_quicklog_link(db_session, workspace_id=ws.id, ql_id=ql_id, session_id=s.id)

        resp = await client.get(
            f"/api/workspaces/{ws.id}/quicklog-entries/{ql_id}/sessions",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        ids = [i["id"] for i in resp.json()]
        assert ids == [str(s_new.id), str(s_mid.id), str(s_old.id)]
