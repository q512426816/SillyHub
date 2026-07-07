"""task-05：complete_lease 入口反查 workspace.path_source 并透传 3 回调单测。

覆盖：
- daemon-client lease complete → 3 facade 回调拿到 path_source="daemon-client" kwarg
- server-local lease complete → path_source="server-local" 透传
- 缺 binding → 降级 server-local + warn 不抛
- 缺 agent_run_id → 降级 server-local
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.service import DaemonService
from app.modules.workspace.model import AgentRunWorkspace, Workspace


async def _setup_lease_with_workspace(
    db_session: AsyncSession,
    *,
    path_source: str | None,
    with_binding: bool = True,
) -> tuple[uuid.UUID, str]:
    """构造 runtime + lease + run + workspace(+binding)，返回 (lease_id, claim_token)。"""
    from app.modules.auth.model import User

    now = datetime.now(UTC)
    user = User(
        id=uuid.uuid4(),
        email=f"ps-{uuid.uuid4().hex[:6]}@x.com",
        password_hash="x",
        display_name="t",
        status="active",
    )
    db_session.add(user)
    await db_session.commit()

    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user.id,
        name="rt",
        provider="claude_code",
        status="online",
        last_heartbeat_at=now,
    )
    db_session.add(rt)
    await db_session.commit()

    run_id = uuid.uuid4()
    claim_token = "tok-" + uuid.uuid4().hex[:8]
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=rt.id,
        agent_run_id=run_id,
        status="claimed",
        kind="interactive",
        claimed_at=now,
        lease_expires_at=None,
        metadata_={"claim_token": claim_token, "session_id": str(uuid.uuid4())},
        created_at=now,
        updated_at=now,
    )
    run = AgentRun(
        id=run_id,
        agent_type="claude_code",
        provider="claude",
        status="running",
        spec_strategy="interactive",
        change_id=None,
        agent_session_id=uuid.uuid4(),
    )
    db_session.add_all([lease, run])
    await db_session.commit()

    if with_binding:
        ws = Workspace(
            id=uuid.uuid4(),
            name=f"ws-{uuid.uuid4().hex[:6]}",
            slug=f"ws-{uuid.uuid4().hex[:6]}",
            root_path="/tmp/daemon-client-ws",
            status="active",
            path_source=path_source if path_source is not None else "server-local",
        )
        db_session.add(ws)
        await db_session.commit()
        await db_session.refresh(ws)
        db_session.add(AgentRunWorkspace(agent_run_id=run_id, workspace_id=ws.id))
        await db_session.commit()

    return lease.id, claim_token


@pytest.mark.asyncio
async def test_daemon_client_lease_passes_path_source_to_apply_patch(
    db_session: AsyncSession,
) -> None:
    """daemon-client lease complete → _apply_patch_to_worktree 拿到 path_source=daemon-client。"""
    lease_id, claim_token = await _setup_lease_with_workspace(
        db_session, path_source="daemon-client"
    )
    svc = DaemonService(db_session)

    captured: dict = {}

    async def spy_apply_patch(*, agent_run_id, patch_data, use_3way, path_source=None):
        captured["path_source"] = path_source
        return None

    svc._apply_patch_to_worktree = spy_apply_patch  # 其余 2 回调也可能触发，stub 掉防副作用
    svc._trigger_stage_completion_callback = AsyncMock(return_value=None)
    svc._run_post_scan_validation = AsyncMock(return_value=None)
    await svc.complete_lease(
        lease_id, claim_token, {"status": "completed", "patch": "diff --git a/f b/f\n"}
    )
    assert captured.get("path_source") == "daemon-client"


@pytest.mark.asyncio
async def test_server_local_lease_passes_path_source_to_apply_patch(
    db_session: AsyncSession,
) -> None:
    """server-local lease complete → path_source=server-local 透传（零回归）。"""
    lease_id, claim_token = await _setup_lease_with_workspace(
        db_session, path_source="server-local"
    )
    svc = DaemonService(db_session)

    captured: dict = {}

    async def spy_apply_patch(*, agent_run_id, patch_data, use_3way, path_source=None):
        captured["path_source"] = path_source
        return None

    svc._apply_patch_to_worktree = spy_apply_patch
    svc._trigger_stage_completion_callback = AsyncMock(return_value=None)
    svc._run_post_scan_validation = AsyncMock(return_value=None)
    await svc.complete_lease(lease_id, claim_token, {"status": "completed", "patch": "diff"})
    assert captured.get("path_source") == "server-local"


@pytest.mark.asyncio
async def test_daemon_client_lease_passes_path_source_to_stage_and_post_scan(
    db_session: AsyncSession,
) -> None:
    """daemon-client lease complete → stage_callback + post_scan 拿到 path_source kwarg。"""
    lease_id, claim_token = await _setup_lease_with_workspace(
        db_session, path_source="daemon-client"
    )
    svc = DaemonService(db_session)

    stage_captured: dict = {}
    post_captured: dict = {}

    async def spy_stage(agent_run_id, path_source=None):
        stage_captured["path_source"] = path_source
        return None

    async def spy_post(lease, path_source=None):
        post_captured["path_source"] = path_source
        return None

    svc._apply_patch_to_worktree = AsyncMock(return_value=None)
    svc._trigger_stage_completion_callback = spy_stage
    svc._run_post_scan_validation = spy_post
    await svc.complete_lease(lease_id, claim_token, {"status": "completed", "patch": "diff"})
    assert stage_captured.get("path_source") == "daemon-client"
    assert post_captured.get("path_source") == "daemon-client"


@pytest.mark.asyncio
async def test_no_binding_degrades_to_server_local(db_session: AsyncSession) -> None:
    """缺 workspace binding → 降级 server-local，不抛。"""
    lease_id, claim_token = await _setup_lease_with_workspace(
        db_session, path_source="daemon-client", with_binding=False
    )
    svc = DaemonService(db_session)

    captured: dict = {}

    async def spy_apply_patch(*, agent_run_id, patch_data, use_3way, path_source=None):
        captured["path_source"] = path_source
        return None

    svc._apply_patch_to_worktree = spy_apply_patch
    svc._trigger_stage_completion_callback = AsyncMock(return_value=None)
    svc._run_post_scan_validation = AsyncMock(return_value=None)
    # 不抛（降级 server-local）
    await svc.complete_lease(lease_id, claim_token, {"status": "completed", "patch": "diff"})
    assert captured.get("path_source") == "server-local"


@pytest.mark.asyncio
async def test_resolve_helper_no_agent_run_returns_server_local(
    db_session: AsyncSession,
) -> None:
    """_resolve_lease_workspace_path_source: agent_run_id=None → (None, 'server-local')。"""
    from app.modules.auth.model import User

    now = datetime.now(UTC)
    user = User(
        id=uuid.uuid4(),
        email=f"r-{uuid.uuid4().hex[:6]}@x.com",
        password_hash="x",
        display_name="t",
        status="active",
    )
    db_session.add(user)
    await db_session.commit()
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user.id,
        name="rt",
        provider="claude_code",
        status="online",
        last_heartbeat_at=now,
    )
    db_session.add(rt)
    await db_session.commit()
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=rt.id,
        agent_run_id=None,  # 关键：无 agent_run
        status="claimed",
        kind="interactive",
        claimed_at=now,
        metadata_={"claim_token": "tok"},
    )
    db_session.add(lease)
    await db_session.commit()

    svc = DaemonService(db_session)
    ws, path_source = await svc._lease._resolve_lease_workspace_path_source(lease)
    assert ws is None
    assert path_source == "server-local"
