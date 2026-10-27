"""会话关联变更列表端点单测（2026-10-13-session-change-files-hover / task-01）。

覆盖 ``GET /api/workspaces/{wid}/changes/-/by-session/{session_id}``（FR-01 /
D-001@v2 反向查询 / D-003@v1 纯前端拼凑否决的证据性对立面）：

1. 多变更排序——未归档（active）优先、组内 created_at desc，归档沉底；
2. 无关联变更返回空列表（不 404——会话刚建、尚未跑变更是常态）；
3. 软删变更（location='deleted'）排除，与变更中心读侧口径一致；
4. 归档变更正常返回（沉底，不丢——前端「已归档折叠可展开」数据源）；
5. 会话不存在 / 不属于该工作空间 → 404 中文文案；
6. 跨工作空间隔离——ws_b 的 link 不串到 ws_a；
7. is_thin 投影——change_type='quick' 且建行在分流时间窗内 → True（悬浮面板
   轻量/全量徽标数据源，三分支②口径）。

复用 backend/conftest.py 的 in-memory SQLite + AsyncClient + admin auth
fixture，构造真实 Workspace / User / DaemonRuntime / AgentSession（带
workspace_id 归属）/ Change / ChangeSessionLink 行（不 mock model，避免遮蔽
真实 FK 路径；fixture 模式参照 test_quicklog_sessions_api.py）。

Author: SillySpec change 2026-10-13-session-change-files-hover (W1 task-01)
Created: 2026-10-13
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentSession
from app.modules.auth.model import User
from app.modules.change.model import Change, ChangeDocument, ChangeSessionLink
from app.modules.daemon.model import DaemonRuntime
from app.modules.workspace.model import Workspace

# ── Fixtures / helpers（模式对齐 test_quicklog_sessions_api.py）──────────────


async def _make_admin(db_session: AsyncSession) -> User:
    """取根 conftest ``auth_headers`` fixture 已建好的平台管理员。"""
    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None
    return admin


async def _make_workspace(db_session: AsyncSession, *, root_path: str) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="t-ws",
        slug=f"t-ws-{uuid.uuid4().hex[:8]}",
        root_path=root_path,
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _make_runtime(db_session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)
    await db_session.commit()
    await db_session.refresh(rt)
    return rt


async def _make_session(
    db_session: AsyncSession,
    *,
    user_id: uuid.UUID,
    runtime_id: uuid.UUID,
    workspace_id: uuid.UUID,
) -> AgentSession:
    """造会话行——本端点校验 ``AgentSession.workspace_id`` 归属，必传。"""
    now = datetime.now(UTC)
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime_id,
        workspace_id=workspace_id,
        provider="claude",
        status="ended",
        turn_count=1,
        created_at=now,
        last_active_at=now,
        ended_at=now,
    )
    db_session.add(sess)
    await db_session.commit()
    await db_session.refresh(sess)
    return sess


async def _make_change(
    db_session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    change_key: str,
    location: str = "active",
    created_at: datetime | None = None,
    change_type: str | None = None,
    status: str | None = None,
) -> Change:
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key=change_key,
        title=f"变更 {change_key}",
        location=location,
        path=f".sillyspec/changes/{change_key}",
        change_type=change_type,
        status=status,  # None 走模型默认 draft（placeholder 出身形态）
        created_at=created_at or datetime.now(UTC),
    )
    db_session.add(change)
    await db_session.commit()
    await db_session.refresh(change)
    return change


async def _make_doc(
    db_session: AsyncSession,
    *,
    change_id: uuid.UUID,
    doc_type: str = "design",
) -> None:
    """造 change_documents 行（幽灵判定「无文档」条件的对照组）。"""
    db_session.add(
        ChangeDocument(
            id=uuid.uuid4(),
            change_id=change_id,
            doc_type=doc_type,
            path=f"changes/{change_id}/{doc_type}.md",
        )
    )
    await db_session.commit()


async def _make_link(
    db_session: AsyncSession,
    *,
    change_id: uuid.UUID,
    session_id: uuid.UUID,
) -> ChangeSessionLink:
    """造 change_session_links 绑定行（本端点唯一数据源，D-001@v2）。"""
    link = ChangeSessionLink(
        id=uuid.uuid4(),
        change_id=change_id,
        session_id=session_id,
    )
    db_session.add(link)
    await db_session.commit()
    await db_session.refresh(link)
    return link


# ── GET /workspaces/{wid}/changes/-/by-session/{session_id} ─────────────────


class TestListSessionChanges:
    """task-01（FR-01）：会话关联变更反向列表。"""

    async def test_sorted_unarchived_first_then_created_desc(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        tmp_path: Path,
    ) -> None:
        """排序：未归档优先、组内 created_at desc、归档沉底（FR-01 主路径）。"""
        admin = await _make_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        ws = await _make_workspace(db_session, root_path=str(tmp_path))
        sess = await _make_session(
            db_session, user_id=admin.id, runtime_id=rt.id, workspace_id=ws.id
        )

        base = datetime.now(UTC) - timedelta(hours=3)
        # 造序：归档最新 → active 较旧 → active 最旧。期望返回序反转 active 在前。
        # status="active"（非 draft）：造数不踩幽灵占位判定（FR-04 滤 draft+无文档
        # +超龄行）——本用例测排序，不测幽灵形态（2026-10-27-ghost-spec-binding-fix）。
        c_active_old = await _make_change(
            db_session,
            workspace_id=ws.id,
            change_key="active-old",
            created_at=base,
            status="active",
        )
        c_active_new = await _make_change(
            db_session,
            workspace_id=ws.id,
            change_key="active-new",
            created_at=base + timedelta(minutes=10),
            change_type="quick",  # 分流窗内 quick → is_thin True（三分支②）
            status="active",
        )
        c_archived = await _make_change(
            db_session,
            workspace_id=ws.id,
            change_key="archived-1",
            location="archive",
            created_at=base + timedelta(minutes=20),
        )
        for c in (c_active_old, c_active_new, c_archived):
            await _make_link(db_session, change_id=c.id, session_id=sess.id)

        resp = await client.get(
            f"/api/workspaces/{ws.id}/changes/-/by-session/{sess.id}",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        items = resp.json()
        assert [i["change_key"] for i in items] == [
            "active-new",
            "active-old",
            "archived-1",
        ]
        # 投影字段在位：轻量出身徽标数据源（quick 分流窗内 → True；其余 False）。
        by_key = {i["change_key"]: i for i in items}
        assert by_key["active-new"]["is_thin"] is True
        assert by_key["active-old"]["is_thin"] is False
        assert by_key["archived-1"]["location"] == "archive"

    async def test_empty_when_no_links(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        tmp_path: Path,
    ) -> None:
        """会话存在但无关联变更 → 200 空列表（不 404，FR-01 场景约束）。"""
        admin = await _make_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        ws = await _make_workspace(db_session, root_path=str(tmp_path))
        sess = await _make_session(
            db_session, user_id=admin.id, runtime_id=rt.id, workspace_id=ws.id
        )

        resp = await client.get(
            f"/api/workspaces/{ws.id}/changes/-/by-session/{sess.id}",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == []

    async def test_deleted_change_excluded(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        tmp_path: Path,
    ) -> None:
        """软删变更（location='deleted'）排除——读侧防复活口径对齐变更中心。"""
        admin = await _make_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        ws = await _make_workspace(db_session, root_path=str(tmp_path))
        sess = await _make_session(
            db_session, user_id=admin.id, runtime_id=rt.id, workspace_id=ws.id
        )
        c_alive = await _make_change(db_session, workspace_id=ws.id, change_key="alive")
        c_deleted = await _make_change(
            db_session, workspace_id=ws.id, change_key="tombstone", location="deleted"
        )
        await _make_link(db_session, change_id=c_alive.id, session_id=sess.id)
        await _make_link(db_session, change_id=c_deleted.id, session_id=sess.id)

        resp = await client.get(
            f"/api/workspaces/{ws.id}/changes/-/by-session/{sess.id}",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        items = resp.json()
        assert [i["change_key"] for i in items] == ["alive"]

    async def test_404_when_session_missing(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        tmp_path: Path,
    ) -> None:
        """会话不存在 → 404 中文文案（l10n 守护口径）。"""
        ws = await _make_workspace(db_session, root_path=str(tmp_path))
        resp = await client.get(
            f"/api/workspaces/{ws.id}/changes/-/by-session/{uuid.uuid4()}",
            headers=auth_headers,
        )
        assert resp.status_code == 404, resp.text
        # AppError 统一错误体为 {code, message}（core/errors.py §契约），非 FastAPI detail。
        assert "会话不存在" in resp.json()["message"]

    async def test_404_cross_workspace_session(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        tmp_path: Path,
    ) -> None:
        """会话属于 ws_b、用 ws_a 查 → 404（工作空间归属校验，防跨空间枚举）。"""
        admin = await _make_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        ws_a = await _make_workspace(db_session, root_path=str(tmp_path / "a"))
        ws_b = await _make_workspace(db_session, root_path=str(tmp_path / "b"))
        sess_b = await _make_session(
            db_session, user_id=admin.id, runtime_id=rt.id, workspace_id=ws_b.id
        )

        resp = await client.get(
            f"/api/workspaces/{ws_a.id}/changes/-/by-session/{sess_b.id}",
            headers=auth_headers,
        )
        assert resp.status_code == 404, resp.text

    async def test_cross_workspace_links_not_leaked(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        tmp_path: Path,
    ) -> None:
        """ws_b 的变更 link 不串到 ws_a 的会话（link JOIN 带 workspace 过滤）。"""
        admin = await _make_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        ws_a = await _make_workspace(db_session, root_path=str(tmp_path / "a"))
        ws_b = await _make_workspace(db_session, root_path=str(tmp_path / "b"))
        sess_a = await _make_session(
            db_session, user_id=admin.id, runtime_id=rt.id, workspace_id=ws_a.id
        )
        # 变更挂在 ws_b 名下，但 link 指向 ws_a 的会话——workspace 过滤应拦下。
        c_b = await _make_change(db_session, workspace_id=ws_b.id, change_key="ws-b-only")
        await _make_link(db_session, change_id=c_b.id, session_id=sess_a.id)

        resp = await client.get(
            f"/api/workspaces/{ws_a.id}/changes/-/by-session/{sess_a.id}",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json() == []

    # ── 幽灵占位过滤（2026-10-27-ghost-spec-binding-fix FR-04/05/06）─────────

    async def test_ghost_placeholder_filtered_after_ttl(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        tmp_path: Path,
    ) -> None:
        """FR-04：draft + active + 无文档 + created_at 超 30 分钟 → 幽灵占位行
        不出现（失败命令占位残留，2026-10-27 会话 9d190177/5f088f10 实证形态）。"""
        admin = await _make_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        ws = await _make_workspace(db_session, root_path=str(tmp_path))
        sess = await _make_session(
            db_session, user_id=admin.id, runtime_id=rt.id, workspace_id=ws.id
        )
        ghost = await _make_change(
            db_session,
            workspace_id=ws.id,
            change_key="task-wakeup-precision-fix",
            created_at=datetime.now(UTC) - timedelta(minutes=41),
        )
        real = await _make_change(
            db_session,
            workspace_id=ws.id,
            change_key="2026-10-27-real-change",
            created_at=datetime.now(UTC) - timedelta(minutes=40),
        )
        # 真实变更超龄后必已被 reparse 接管（文档在库）——不满足幽灵「无文档」条件。
        await _make_doc(db_session, change_id=real.id)
        for c in (ghost, real):
            await _make_link(db_session, change_id=c.id, session_id=sess.id)

        resp = await client.get(
            f"/api/workspaces/{ws.id}/changes/-/by-session/{sess.id}",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        assert [i["change_key"] for i in resp.json()] == ["2026-10-27-real-change"]

    async def test_fresh_placeholder_not_filtered(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        tmp_path: Path,
    ) -> None:
        """FR-05：draft + active + 无文档但 created_at 在 30 分钟窗口内 → 保留
        （真实 flow start 命令解析先于镜像文档同步的延迟窗口，不得提前过滤）。"""
        admin = await _make_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        ws = await _make_workspace(db_session, root_path=str(tmp_path))
        sess = await _make_session(
            db_session, user_id=admin.id, runtime_id=rt.id, workspace_id=ws.id
        )
        fresh = await _make_change(
            db_session,
            workspace_id=ws.id,
            change_key="2026-10-27-fresh-flow",
            created_at=datetime.now(UTC) - timedelta(minutes=5),
        )
        await _make_link(db_session, change_id=fresh.id, session_id=sess.id)

        resp = await client.get(
            f"/api/workspaces/{ws.id}/changes/-/by-session/{sess.id}",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        assert [i["change_key"] for i in resp.json()] == ["2026-10-27-fresh-flow"]

    async def test_documented_archived_non_draft_rows_not_filtered(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        tmp_path: Path,
    ) -> None:
        """FR-06：幽灵四条件缺一均保留——①有文档的超龄 draft 行（正常在建）；
        ②归档无文档超龄行（终态）；③status=active 无文档超龄行（真实生命周期
        态）。三变体全部原样返回（零误伤）。"""
        admin = await _make_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        ws = await _make_workspace(db_session, root_path=str(tmp_path))
        sess = await _make_session(
            db_session, user_id=admin.id, runtime_id=rt.id, workspace_id=ws.id
        )
        old = datetime.now(UTC) - timedelta(minutes=60)
        c_documented = await _make_change(
            db_session, workspace_id=ws.id, change_key="drafted-with-docs", created_at=old
        )
        await _make_doc(db_session, change_id=c_documented.id)
        c_archived = await _make_change(
            db_session,
            workspace_id=ws.id,
            change_key="archived-no-docs",
            location="archive",
            created_at=old,
        )
        c_active_status = await _make_change(
            db_session,
            workspace_id=ws.id,
            change_key="active-status-no-docs",
            status="active",
            created_at=old,
        )
        for c in (c_documented, c_archived, c_active_status):
            await _make_link(db_session, change_id=c.id, session_id=sess.id)

        resp = await client.get(
            f"/api/workspaces/{ws.id}/changes/-/by-session/{sess.id}",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        keys = {i["change_key"] for i in resp.json()}
        assert keys == {"drafted-with-docs", "archived-no-docs", "active-status-no-docs"}
