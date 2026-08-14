"""变更-会话绑定测试（task-02 / design §8 D-007）。

Change 2026-08-14-change-center-conversation-driven task-02：reparse 发现新变更
（created）时按 §8 绑定查询写 ``change_session_links``：

.. code-block:: sql

    SELECT s.id FROM agent_sessions s
    WHERE s.workspace_id = :wid AND s.deleted_at IS NULL
    ORDER BY coalesce(s.last_active_at, s.created_at) DESC
    LIMIT 1

覆盖：最近活跃会话绑定 / coalesce 兜底 / 软删会话跳过 / 跨 workspace 隔离 /
更新不重复建 link / 绑定失败不阻断 reparse / scoped reparse 同样绑定。

author: qinyi
created_at: 2026-08-14
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


async def test_reparse_created_binds_most_recent_session(db_session, tmp_path):
    """created 新变更绑定最近活跃会话（last_active_at desc）。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    _seed_change(spec_root, "2026-08-14-foo", "Foo")
    user = await _make_user(db_session)

    old = await _make_session(
        db_session,
        workspace_id=ws.id,
        user_id=user.id,
        created_at=datetime(2026, 8, 1, 10, 0, tzinfo=UTC),
        last_active_at=datetime(2026, 8, 1, 10, 0, tzinfo=UTC),
    )
    new = await _make_session(
        db_session,
        workspace_id=ws.id,
        user_id=user.id,
        created_at=datetime(2026, 8, 2, 10, 0, tzinfo=UTC),
        last_active_at=datetime(2026, 8, 2, 10, 0, tzinfo=UTC),
    )
    assert new.last_active_at > old.last_active_at

    stats, _ = await ChangeService(db_session).reparse(ws.id)
    assert stats["created"] == 1

    change = (
        (
            await db_session.execute(
                select(Change).where(
                    Change.workspace_id == ws.id,
                    Change.change_key == "2026-08-14-foo",
                )
            )
        )
        .scalars()
        .first()
    )
    assert change is not None
    links = await _fetch_links(db_session, change.id)
    assert len(links) == 1
    assert links[0].session_id == new.id


async def test_binding_coalesces_last_active_at_null_to_created_at(db_session, tmp_path):
    """last_active_at 为 NULL → 按 created_at 兜底（coalesce 语义）。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    _seed_change(spec_root, "2026-08-14-bar", "Bar")
    user = await _make_user(db_session)

    # 旧会话有 last_active_at；新会话 last_active_at=None 但 created_at 更晚
    await _make_session(
        db_session,
        workspace_id=ws.id,
        user_id=user.id,
        created_at=datetime(2026, 8, 1, 10, 0, tzinfo=UTC),
        last_active_at=datetime(2026, 8, 1, 11, 0, tzinfo=UTC),
    )
    newer_no_active = await _make_session(
        db_session,
        workspace_id=ws.id,
        user_id=user.id,
        created_at=datetime(2026, 8, 3, 10, 0, tzinfo=UTC),
        last_active_at=None,
    )

    await ChangeService(db_session).reparse(ws.id)
    change = (
        (
            await db_session.execute(
                select(Change).where(
                    Change.workspace_id == ws.id,
                    Change.change_key == "2026-08-14-bar",
                )
            )
        )
        .scalars()
        .first()
    )
    links = await _fetch_links(db_session, change.id)
    assert len(links) == 1
    assert links[0].session_id == newer_no_active.id


async def test_binding_skips_deleted_session(db_session, tmp_path):
    """deleted_at 非空的会话跳过（软删不可绑），回退到最近活跃非删会话。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    _seed_change(spec_root, "2026-08-14-baz", "Baz")
    user = await _make_user(db_session)

    await _make_session(
        db_session,
        workspace_id=ws.id,
        user_id=user.id,
        created_at=datetime(2026, 8, 2, 10, 0, tzinfo=UTC),
        last_active_at=datetime(2026, 8, 2, 11, 0, tzinfo=UTC),
        deleted_at=datetime(2026, 8, 2, 12, 0, tzinfo=UTC),  # 已软删（最新）
    )
    active_old = await _make_session(
        db_session,
        workspace_id=ws.id,
        user_id=user.id,
        created_at=datetime(2026, 8, 1, 10, 0, tzinfo=UTC),
        last_active_at=datetime(2026, 8, 1, 11, 0, tzinfo=UTC),
    )

    await ChangeService(db_session).reparse(ws.id)
    change = (
        (
            await db_session.execute(
                select(Change).where(
                    Change.workspace_id == ws.id,
                    Change.change_key == "2026-08-14-baz",
                )
            )
        )
        .scalars()
        .first()
    )
    links = await _fetch_links(db_session, change.id)
    assert len(links) == 1
    assert links[0].session_id == active_old.id


async def test_binding_skips_other_workspace_sessions(db_session, tmp_path):
    """绑定查询跨成员但按 workspace 隔离：其它 workspace 的更新会话不参与。"""
    ws = await _make_ws(db_session)
    other_ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    _seed_change(spec_root, "2026-08-14-qux", "Qux")
    user = await _make_user(db_session)

    # 其它 workspace 的会话更新（不应被绑）
    await _make_session(
        db_session,
        workspace_id=other_ws.id,
        user_id=user.id,
        created_at=datetime(2026, 8, 5, 10, 0, tzinfo=UTC),
        last_active_at=datetime(2026, 8, 5, 11, 0, tzinfo=UTC),
    )
    # 本 workspace 的会话（较旧，应被绑）
    mine = await _make_session(
        db_session,
        workspace_id=ws.id,
        user_id=user.id,
        created_at=datetime(2026, 8, 1, 10, 0, tzinfo=UTC),
        last_active_at=datetime(2026, 8, 1, 11, 0, tzinfo=UTC),
    )

    await ChangeService(db_session).reparse(ws.id)
    change = (
        (
            await db_session.execute(
                select(Change).where(
                    Change.workspace_id == ws.id,
                    Change.change_key == "2026-08-14-qux",
                )
            )
        )
        .scalars()
        .first()
    )
    links = await _fetch_links(db_session, change.id)
    assert len(links) == 1
    assert links[0].session_id == mine.id


async def test_no_session_hit_writes_no_link(db_session, tmp_path):
    """无任何会话 → 不写 link 行（reparse 正常完成）。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    _seed_change(spec_root, "2026-08-14-solo", "Solo")

    stats, _ = await ChangeService(db_session).reparse(ws.id)
    assert stats["created"] == 1
    change = (
        (
            await db_session.execute(
                select(Change).where(
                    Change.workspace_id == ws.id,
                    Change.change_key == "2026-08-14-solo",
                )
            )
        )
        .scalars()
        .first()
    )
    assert await _fetch_links(db_session, change.id) == []


async def test_reparse_updated_does_not_create_second_link(db_session, tmp_path):
    """重复 reparse：首次 created 写 link，二次 updated 不重复写（unique 兜底）。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    _seed_change(spec_root, "2026-08-14-twice", "Twice")
    user = await _make_user(db_session)
    s = await _make_session(
        db_session,
        workspace_id=ws.id,
        user_id=user.id,
        created_at=datetime(2026, 8, 1, 10, 0, tzinfo=UTC),
        last_active_at=datetime(2026, 8, 1, 11, 0, tzinfo=UTC),
    )

    service = ChangeService(db_session)
    stats, _ = await service.reparse(ws.id)
    assert stats["created"] == 1

    # 二次 reparse：updated 不绑新 link
    stats, _ = await service.reparse(ws.id)
    assert stats["updated"] == 1

    change = (
        (
            await db_session.execute(
                select(Change).where(
                    Change.workspace_id == ws.id,
                    Change.change_key == "2026-08-14-twice",
                )
            )
        )
        .scalars()
        .first()
    )
    links = await _fetch_links(db_session, change.id)
    assert len(links) == 1
    assert links[0].session_id == s.id


async def test_scoped_reparse_created_binds_session(db_session, tmp_path):
    """scoped reparse 创建新变更同样触发绑定（scope 不跳过绑定逻辑）。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    _seed_change(spec_root, "2026-08-14-scope", "Scope")
    user = await _make_user(db_session)
    s = await _make_session(
        db_session,
        workspace_id=ws.id,
        user_id=user.id,
        created_at=datetime(2026, 8, 1, 10, 0, tzinfo=UTC),
        last_active_at=datetime(2026, 8, 1, 11, 0, tzinfo=UTC),
    )

    stats, _ = await ChangeService(db_session).reparse(ws.id, scope=["2026-08-14-scope"])
    assert stats["created"] == 1
    change = (
        (
            await db_session.execute(
                select(Change).where(
                    Change.workspace_id == ws.id,
                    Change.change_key == "2026-08-14-scope",
                )
            )
        )
        .scalars()
        .first()
    )
    links = await _fetch_links(db_session, change.id)
    assert len(links) == 1
    assert links[0].session_id == s.id


# ===========================================================================
# 绑定失败不阻断 reparse（best-effort）
# ===========================================================================


async def test_binding_failure_does_not_block_reparse(db_session, tmp_path, monkeypatch):
    """ChangeSessionLink 实例化失败 → 绑定失败仅告警，reparse 主流程完成、变更仍落行。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    _seed_change(spec_root, "2026-08-14-fail", "Fail")
    user = await _make_user(db_session)
    await _make_session(
        db_session,
        workspace_id=ws.id,
        user_id=user.id,
        created_at=datetime(2026, 8, 1, 10, 0, tzinfo=UTC),
        last_active_at=datetime(2026, 8, 1, 11, 0, tzinfo=UTC),
    )

    def _boom(*_a, **_k):
        raise RuntimeError("link insert failed")

    monkeypatch.setattr("app.modules.change.service.ChangeSessionLink", _boom)

    stats, _ = await ChangeService(db_session).reparse(ws.id)
    assert stats["created"] == 1  # reparse 不阻断
    change = (
        (
            await db_session.execute(
                select(Change).where(
                    Change.workspace_id == ws.id,
                    Change.change_key == "2026-08-14-fail",
                )
            )
        )
        .scalars()
        .first()
    )
    assert change is not None
    assert await _fetch_links(db_session, change.id) == []


async def test_bind_change_to_session_duplicate_link_is_rolled_back(db_session, tmp_path) -> None:
    """_bind_change_to_session 幂等兜底：重复插入同对 (change_id, session_id) →
    unique 冲突在 savepoint 内回滚，方法不抛、仅保留一行（防御唯一约束）。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    _seed_change(spec_root, "2026-08-14-dedup", "Dedup")
    user = await _make_user(db_session)
    await _make_session(
        db_session,
        workspace_id=ws.id,
        user_id=user.id,
        created_at=datetime(2026, 8, 1, 10, 0, tzinfo=UTC),
        last_active_at=datetime(2026, 8, 1, 11, 0, tzinfo=UTC),
    )

    # 第一次 created reparse 建行 + 绑 link
    await ChangeService(db_session).reparse(ws.id)
    change = (
        (
            await db_session.execute(
                select(Change).where(
                    Change.workspace_id == ws.id,
                    Change.change_key == "2026-08-14-dedup",
                )
            )
        )
        .scalars()
        .first()
    )
    assert len(await _fetch_links(db_session, change.id)) == 1

    # 直接再调一次绑定 → 唯一冲突回滚，不抛异常、link 数不变
    service = ChangeService(db_session)
    await service._bind_change_to_session(ws.id, change.id)
    assert len(await _fetch_links(db_session, change.id)) == 1


# Suppress unused-import warning for pytest fixture discovery.
pytestmark = pytest.mark.asyncio
