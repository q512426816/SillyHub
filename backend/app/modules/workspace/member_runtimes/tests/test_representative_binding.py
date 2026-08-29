"""Tests for resolve_representative_binding query function.

Change 2026-08-19-cross-workspace-team-mission task-02 (design 4.2):
Three-branch coverage: owner online priority -> any online (heartbeat sorted) -> None (all offline).

2026-08-28-fix-cross-machine-worker-dispatch task-01 涟漪（D-005@v1）：两分支
daemon 选择统一全序 ``ORDER BY 实例心跳 DESC, daemon_id ASC``——分支1 候选集 =
owner 所建工作区全部成员绑定（含他人行），全序在候选内选行，owner 行并非硬
优先；分支1/分支2 与 resolve_daemon_instance_for_workspace 相同候选集收敛同机
（双源同序用例见 test_placement_member_binding.py）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import password_hasher
from app.modules.daemon.model import DaemonInstance, DaemonRuntime
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
from app.modules.workspace.member_runtimes.queries import (
    resolve_representative_binding,
)
from app.modules.workspace.model import Workspace


async def _make_user(db_session: AsyncSession) -> uuid.UUID:
    """Create a test user and return its ID."""
    from app.modules.auth.model import User

    user_id = uuid.uuid4()
    db_session.add(
        User(
            id=user_id,
            email=f"rep-binding-{user_id.hex[:8]}@example.com",
            password_hash=password_hasher.hash("Pass123!"),
            display_name="RepBinding",
            status="active",
        )
    )
    await db_session.commit()
    return user_id


async def _make_workspace(
    db_session: AsyncSession,
    owner_id: uuid.UUID,
) -> uuid.UUID:
    """Create a test workspace and return its ID."""
    ws_id = uuid.uuid4()
    db_session.add(
        Workspace(
            id=ws_id,
            name=f"RepBinding WS {ws_id.hex[:8]}",
            slug=f"rep-binding-{ws_id.hex[:8]}",
            root_path=f"/tmp/rep-binding-{ws_id.hex[:8]}",
            status="active",
            created_by=owner_id,
            last_scanned_at=datetime.now(UTC),
        )
    )
    await db_session.commit()
    return ws_id


async def _make_daemon_with_runtime(
    db_session: AsyncSession,
    user_id: uuid.UUID,
    provider: str = "claude",
    daemon_online: bool = True,
    runtime_online: bool = True,
    existing_daemon_id: uuid.UUID | None = None,
    heartbeat: datetime | None = None,
) -> tuple[uuid.UUID, uuid.UUID]:
    """Create a daemon instance and runtime, return (daemon_id, runtime_id).

    If existing_daemon_id provided, reuse that daemon and only create a new runtime.

    task-04（2026-08-28-fix-cross-machine-worker-dispatch）：新增 ``heartbeat``
    显式设 daemon_instances.last_heartbeat_at（缺省 None=旧行为 now()）。D-005@v1
    双源全序以实例心跳为主序，多机形态必须显式设值消除插入顺序依赖的 flaky。
    """
    daemon_id = existing_daemon_id or uuid.uuid4()
    if not existing_daemon_id:
        effective_heartbeat = (
            heartbeat if heartbeat is not None else (datetime.now(UTC) if daemon_online else None)
        )
        db_session.add(
            DaemonInstance(
                id=daemon_id,
                user_id=user_id,
                hostname=f"host-{daemon_id.hex[:8]}",
                server_url="http://test-server",
                status="online" if daemon_online else "offline",
                last_heartbeat_at=effective_heartbeat,
            )
        )

    runtime_id = uuid.uuid4()
    db_session.add(
        DaemonRuntime(
            id=runtime_id,
            daemon_instance_id=daemon_id,
            user_id=user_id,
            provider=provider,
            status="online" if runtime_online else "offline",
            last_heartbeat_at=datetime.now(UTC) if runtime_online else None,
        )
    )
    await db_session.commit()
    return daemon_id, runtime_id


async def _make_binding(
    db_session: AsyncSession,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    daemon_id: uuid.UUID,
) -> None:
    """Create a workspace member runtime binding."""
    db_session.add(
        WorkspaceMemberRuntime(
            workspace_id=workspace_id,
            user_id=user_id,
            runtime_id=None,
            daemon_id=daemon_id,
            root_path=f"/tmp/ws-{workspace_id.hex[:8]}",
            path_source="daemon-client",
        )
    )
    await db_session.commit()


@pytest.mark.asyncio
async def test_representative_binding_owner_ws_owner_newest_heartbeat_hit(
    db_session: AsyncSession,
) -> None:
    """分支1（task-01 全序涟漪更新 / D-005@v1 真实语义）。

    分支1 候选集 = owner 所建工作区（w.created_by=dispatch user）的**全部成员
    绑定**（含他人绑定行），统一全序 ``ORDER BY 实例心跳 DESC, daemon_id ASC``
    在候选内选行——owner 行并非硬优先，仅在其绑定机器实例心跳最新时胜出。

    旧用例 ``test_representative_binding_owner_online_priority`` 断言「owner
    在线绑定先返」（无 ORDER BY，靠插入顺序碰巧先返 owner）；task-01 补全序后
    候选含全部成员绑定、user2 后插入心跳更新反而胜出（翻红）。本用例按实现
    真实语义重写：显式设 owner 心跳最新 → 断言 owner 行胜出（需求变更非放水，
    CLAUDE.md 规则9）。
    """
    older = datetime(2026, 8, 28, 10, 0, 0, tzinfo=UTC)
    newer = datetime(2026, 8, 28, 11, 0, 0, tzinfo=UTC)

    owner = await _make_user(db_session)
    ws_id = await _make_workspace(db_session, owner_id=owner)

    # Owner's online daemon + runtime（实例心跳最新 → 全序内胜出）
    daemon1, runtime1 = await _make_daemon_with_runtime(
        db_session,
        owner,
        provider="claude",
        daemon_online=True,
        runtime_online=True,
        heartbeat=newer,
    )
    await _make_binding(db_session, ws_id, owner, daemon1)

    # Another user's online binding（同在分支1候选集内，实例心跳更旧）
    user2 = await _make_user(db_session)
    daemon2, _ = await _make_daemon_with_runtime(
        db_session,
        user2,
        provider="claude",
        daemon_online=True,
        runtime_online=True,
        heartbeat=older,
    )
    await _make_binding(db_session, ws_id, user2, daemon2)

    # Call resolve_representative_binding (user_id = owner)
    result = await resolve_representative_binding(db_session, ws_id, owner, "claude")

    # Assert: owner's binding wins on the newest instance heartbeat
    assert result is not None
    assert uuid.UUID(str(result["id"])) == runtime1
    # SQLite stores UUID as CHAR(32) hex string, convert back for comparison
    assert uuid.UUID(str(result["user_id"])) == owner
    assert result["provider"] == "claude"
    assert uuid.UUID(str(result["daemon_instance_id"])) == daemon1


@pytest.mark.asyncio
async def test_representative_binding_owner_ws_other_member_newer_heartbeat_wins(
    db_session: AsyncSession,
) -> None:
    """分支1 对照（D-005@v1）：他人绑定机器实例心跳更新时他人行胜出——owner 行
    并非硬优先，全序在候选内选（分支1 owner 优先语义 = 「owner 建区时进入分支1
    候选集」，非「owner 行越过心跳全序」）。"""
    older = datetime(2026, 8, 28, 10, 0, 0, tzinfo=UTC)
    newer = datetime(2026, 8, 28, 11, 0, 0, tzinfo=UTC)

    owner = await _make_user(db_session)
    ws_id = await _make_workspace(db_session, owner_id=owner)

    daemon1, _ = await _make_daemon_with_runtime(
        db_session, owner, provider="claude", heartbeat=older
    )
    await _make_binding(db_session, ws_id, owner, daemon1)

    user2 = await _make_user(db_session)
    daemon2, runtime2 = await _make_daemon_with_runtime(
        db_session, user2, provider="claude", heartbeat=newer
    )
    await _make_binding(db_session, ws_id, user2, daemon2)

    result = await resolve_representative_binding(db_session, ws_id, owner, "claude")

    # 心跳全序在分支1候选集内选行：user2 绑定机器心跳更新 → user2 runtime 胜出。
    assert result is not None
    assert uuid.UUID(str(result["id"])) == runtime2
    assert uuid.UUID(str(result["user_id"])) == user2
    assert uuid.UUID(str(result["daemon_instance_id"])) == daemon2


@pytest.mark.asyncio
async def test_representative_binding_fallback_to_any_online(db_session: AsyncSession) -> None:
    """Branch 2: owner offline, return any online binding (heartbeat sorted, task-02 acceptance)."""
    owner = await _make_user(db_session)
    ws_id = await _make_workspace(db_session, owner_id=owner)

    # Owner's daemon offline (no hit)
    daemon_offline, _ = await _make_daemon_with_runtime(
        db_session, owner, daemon_online=False, runtime_online=False
    )
    await _make_binding(db_session, ws_id, owner, daemon_offline)

    # User2's online binding
    user2 = await _make_user(db_session)
    daemon2, _ = await _make_daemon_with_runtime(
        db_session, user2, provider="claude", daemon_online=True, runtime_online=True
    )
    await _make_binding(db_session, ws_id, user2, daemon2)

    # User3's online binding (more recent heartbeat, should hit)
    user3 = await _make_user(db_session)
    daemon3, _ = await _make_daemon_with_runtime(
        db_session, user3, provider="claude", daemon_online=True, runtime_online=True
    )
    await _make_binding(db_session, ws_id, user3, daemon3)

    # Call (user_id = owner, but owner offline)
    result = await resolve_representative_binding(db_session, ws_id, owner, "claude")

    # Assert: hit most recent heartbeat online binding (user3, inserted later)
    assert result is not None
    assert result["provider"] == "claude"
    # Should be one of user2 or user3 (heartbeat order dependent on insertion)
    # Convert UUID string back for comparison
    assert uuid.UUID(str(result["user_id"])) in {user2, user3}


@pytest.mark.asyncio
async def test_representative_binding_all_offline_returns_none(db_session: AsyncSession) -> None:
    """Branch 3: all offline return None (task-02 acceptance)."""
    owner = await _make_user(db_session)
    ws_id = await _make_workspace(db_session, owner_id=owner)

    # Owner's daemon offline
    daemon_offline, _ = await _make_daemon_with_runtime(
        db_session, owner, daemon_online=False, runtime_online=False
    )
    await _make_binding(db_session, ws_id, owner, daemon_offline)

    # User2's daemon also offline
    user2 = await _make_user(db_session)
    daemon2_offline, _ = await _make_daemon_with_runtime(
        db_session, user2, daemon_online=False, runtime_online=False
    )
    await _make_binding(db_session, ws_id, user2, daemon2_offline)

    # Call
    result = await resolve_representative_binding(db_session, ws_id, owner, "claude")

    # Assert: return None
    assert result is None


@pytest.mark.asyncio
async def test_representative_binding_provider_filter(db_session: AsyncSession) -> None:
    """Provider non-empty filters matching runtime (compatible with placement consumer)."""
    owner = await _make_user(db_session)
    ws_id = await _make_workspace(db_session, owner_id=owner)

    # Owner's online daemon has two runtimes (claude + codex)
    daemon, runtime_claude = await _make_daemon_with_runtime(
        db_session, owner, provider="claude", daemon_online=True, runtime_online=True
    )
    # Reuse same daemon for codex runtime
    await _make_daemon_with_runtime(
        db_session,
        owner,
        provider="codex",
        daemon_online=True,
        runtime_online=True,
        existing_daemon_id=daemon,
    )
    await _make_binding(db_session, ws_id, owner, daemon)

    # Call (provider="claude")
    result_claude = await resolve_representative_binding(db_session, ws_id, owner, "claude")
    assert result_claude is not None
    assert uuid.UUID(str(result_claude["id"])) == runtime_claude
    assert result_claude["provider"] == "claude"

    # Call (provider="codex")
    result_codex = await resolve_representative_binding(db_session, ws_id, owner, "codex")
    assert result_codex is not None
    assert result_codex["provider"] == "codex"
    assert uuid.UUID(str(result_codex["id"])) != runtime_claude

    # Call (provider=None, should take any online)
    result_any = await resolve_representative_binding(db_session, ws_id, owner, None)
    assert result_any is not None
    # provider=None takes most recent heartbeat online runtime (uncertain which)
    assert result_any["provider"] in {"claude", "codex"}


@pytest.mark.asyncio
async def test_representative_binding_no_bindings_returns_none(db_session: AsyncSession) -> None:
    """No binding rows at all -> return None."""
    owner = await _make_user(db_session)
    ws_id = await _make_workspace(db_session, owner_id=owner)

    # No bindings created

    # Call
    result = await resolve_representative_binding(db_session, ws_id, owner, "claude")

    # Assert: return None
    assert result is None


pytestmark = pytest.mark.asyncio
