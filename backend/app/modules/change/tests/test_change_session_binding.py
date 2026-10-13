"""变更-会话绑定测试（reparse 不自动绑定）。

2026-08-14-change-center-conversation-driven task-02 曾引入 D-007：reparse 发现
新变更（created）时自动绑定该 workspace 最近活跃会话。2026-10-13-change-
reparse-autobind-remove 将其整体移除——绑定唯一自动来源为命令解析通道
（``change/binding.py``，会话内实际执行 ``sillyspec run/flow --change``），
起因：阿里云实测归档目录镜像同步触发建行，自动绑上「你好」闲聊会话。

本文件断言新行为：工作区存在最近活跃会话时，全量 reparse created / 重复
reparse（updated）/ scoped reparse created 均零 link；并守卫已删方法不复活。

author: qinyi
created_at: 2026-10-13
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlalchemy import select

from app.modules.agent.model import AgentSession
from app.modules.auth.model import User
from app.modules.change.model import Change, ChangeSessionLink
from app.modules.change.service import ChangeService
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace


async def _make_user(db_session, email: str | None = None) -> User:
    user = User(
        id=uuid.uuid4(),
        email=email or f"bind-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="x",
        display_name="Bind",
        status="active",
        is_platform_admin=False,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _make_ws(db_session) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="binding ws",
        slug=f"bnd-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/binding-test-{uuid.uuid4().hex[:12]}",
        status="active",
        component_key="comp",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _make_spec_ws(db_session, ws: Workspace, spec_root: Path) -> SpecWorkspace:
    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        spec_root=str(spec_root),
        strategy="platform-managed",
        sync_status="clean",
    )
    db_session.add(spec_ws)
    await db_session.commit()
    await db_session.refresh(spec_ws)
    return spec_ws


def _seed_change(spec_root: Path, key: str, title: str) -> None:
    d = spec_root / "changes" / key
    d.mkdir(parents=True, exist_ok=True)
    (d / "proposal.md").write_text(f"# {title}\n", encoding="utf-8")


async def _make_session(
    db_session,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    created_at: datetime,
    last_active_at: datetime | None,
    deleted_at: datetime | None = None,
) -> AgentSession:
    s = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        workspace_id=workspace_id,
        provider="claude",
        status="active",
        created_at=created_at,
        last_active_at=last_active_at,
        deleted_at=deleted_at,
    )
    db_session.add(s)
    await db_session.commit()
    await db_session.refresh(s)
    return s


async def _fetch_links(db_session, change_id: uuid.UUID) -> list[ChangeSessionLink]:
    return list(
        (
            await db_session.execute(
                select(ChangeSessionLink).where(ChangeSessionLink.change_id == change_id)
            )
        )
        .scalars()
        .all()
    )


async def _get_change(db_session, ws_id: uuid.UUID, key: str) -> Change:
    change = (
        (
            await db_session.execute(
                select(Change).where(
                    Change.workspace_id == ws_id,
                    Change.change_key == key,
                )
            )
        )
        .scalars()
        .first()
    )
    assert change is not None
    return change


async def test_reparse_created_writes_no_session_link(db_session, tmp_path):
    """FR-01：workspace 存在最近活跃会话，reparse created 仍零 link（D-007 已移除）。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    _seed_change(spec_root, "2026-10-13-foo", "Foo")
    user = await _make_user(db_session)

    # 最近活跃会话（含更旧的次新会话，制造「有明确唯一最新」的旧断言语境）
    await _make_session(
        db_session,
        workspace_id=ws.id,
        user_id=user.id,
        created_at=datetime(2026, 8, 1, 10, 0, tzinfo=UTC),
        last_active_at=datetime(2026, 8, 1, 10, 0, tzinfo=UTC),
    )
    await _make_session(
        db_session,
        workspace_id=ws.id,
        user_id=user.id,
        created_at=datetime(2026, 8, 2, 10, 0, tzinfo=UTC),
        last_active_at=datetime(2026, 8, 2, 10, 0, tzinfo=UTC),
    )

    stats, _ = await ChangeService(db_session).reparse(ws.id)
    assert stats["created"] == 1

    change = await _get_change(db_session, ws.id, "2026-10-13-foo")
    assert await _fetch_links(db_session, change.id) == []


async def test_reparse_repeat_and_scoped_still_no_link(db_session, tmp_path):
    """FR-05：重复 reparse（updated）与 scoped reparse created 同样零 link。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    _seed_change(spec_root, "2026-10-13-bar", "Bar")
    user = await _make_user(db_session)
    await _make_session(
        db_session,
        workspace_id=ws.id,
        user_id=user.id,
        created_at=datetime(2026, 8, 1, 10, 0, tzinfo=UTC),
        last_active_at=datetime(2026, 8, 1, 11, 0, tzinfo=UTC),
    )

    service = ChangeService(db_session)
    stats, _ = await service.reparse(ws.id)
    assert stats["created"] == 1
    change = await _get_change(db_session, ws.id, "2026-10-13-bar")
    assert await _fetch_links(db_session, change.id) == []

    # 二次全量 reparse：updated 不产生 link
    stats, _ = await service.reparse(ws.id)
    assert stats["updated"] == 1
    assert await _fetch_links(db_session, change.id) == []

    # scoped reparse 首建新变更：同样零 link
    _seed_change(spec_root, "2026-10-13-scoped", "Scoped")
    stats, _ = await service.reparse(ws.id, scope=["2026-10-13-scoped"])
    assert stats["created"] == 1
    scoped_change = await _get_change(db_session, ws.id, "2026-10-13-scoped")
    assert await _fetch_links(db_session, scoped_change.id) == []


async def test_bind_change_to_session_removed() -> None:
    """FR-02：已删方法防复活守卫——ChangeService 不得再拥有 _bind_change_to_session。"""
    assert not hasattr(ChangeService, "_bind_change_to_session")


# Suppress unused-import warning for pytest fixture discovery.
pytestmark = pytest.mark.asyncio
