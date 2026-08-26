"""ql-20260826-012：GET /changes/{change_id}/sessions 固定取最新 N 条（上限裁剪）。

原查询无界全量（变更挂的会话随使用无限增长）。常量 ``_CHANGE_SESSIONS_MAX``
降到 3，种 5 个 last_active_at 递增的关联会话 → 只返回最新 3 个且按
last_active_at desc 排序（端点排序契约不变）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import password_hasher
from app.modules.agent.model import AgentSession
from app.modules.auth.model import User
from app.modules.change.model import Change, ChangeSessionLink
from app.modules.workspace.model import Workspace


async def _seed(db_session: AsyncSession, tmp_path: Path) -> tuple[uuid.UUID, uuid.UUID, str]:
    """建 admin 用户 + workspace + change + 5 个 last_active_at 递增的关联会话。"""
    from app.modules.daemon.model import DaemonRuntime

    user = User(
        id=uuid.uuid4(),
        email=f"cap-{uuid.uuid4().hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="cap-admin",
        status="active",
        is_platform_admin=True,
    )
    ws = Workspace(
        id=uuid.uuid4(),
        name="cap-ws",
        slug=f"cap-ws-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path),
        status="active",
    )
    runtime = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user.id,
        name="cap-rt",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    change = Change(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        change_key="cap-change",
        title="上限裁剪测试变更",
        location="active",
        path=str(tmp_path / "cap-change"),
    )
    db_session.add_all([user, ws, runtime, change])

    base = datetime.now(UTC) - timedelta(minutes=10)
    for i in range(5):
        sess = AgentSession(
            id=uuid.uuid4(),
            user_id=user.id,
            runtime_id=runtime.id,
            provider="claude",
            status="ended",
            last_active_at=base + timedelta(seconds=i),
        )
        db_session.add_all(
            [
                sess,
                ChangeSessionLink(change_id=change.id, session_id=sess.id),
            ]
        )
    await db_session.commit()

    from app.core.config import get_settings
    from app.core.security import create_access_token

    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=True,
        settings=get_settings(),
    )
    return ws.id, change.id, token


@pytest.mark.asyncio
async def test_change_sessions_capped_to_latest(
    client, db_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """常量降到 3：5 个会话只返回最新 3 个，按 last_active_at desc。"""
    from sqlalchemy import select

    from app.modules.change import router as change_router

    monkeypatch.setattr(change_router, "_CHANGE_SESSIONS_MAX", 3)
    ws_id, change_id, token = await _seed(db_session, tmp_path)

    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes/{change_id}/sessions",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    items = resp.json()
    assert len(items) == 3

    # 只保留最新 3 个（last_active_at 最大的）：按会话 id 对比库内期望集
    # （不比时间戳字符串——SQLite/PG 对 timestamptz 往返的 isoformat 表述有方言差）。
    expected_ids = [
        str(sid)
        for sid in (
            (
                await db_session.execute(
                    select(AgentSession.id)
                    .join(ChangeSessionLink, ChangeSessionLink.session_id == AgentSession.id)
                    .where(ChangeSessionLink.change_id == change_id)
                    .order_by(AgentSession.last_active_at.desc())
                    .limit(3)
                )
            )
            .scalars()
            .all()
        )
    ]
    assert [it["id"] for it in items] == expected_ids, "应返回 last_active_at 最新的 3 个会话"
