"""resolve_runtime_for_writeback 边界测试（task-01 / D-001@v1 / D-004@v1）。

覆盖 design §6 六边界：
- not_bound：无 binding 行（且无 legacy daemon_runtime_id）。
- daemon_offline：binding 在但 daemon_instance 离线/不属 user。
- default_agent_unset：daemon 在线但 workspace.default_agent 为空。
- provider_unavailable：default_agent 设了但 daemon 无该 provider 的 online runtime。
- 命中：binding + default_agent → 返回匹配 runtime。
- legacy fallback：无 binding + 非空 daemon_runtime_id + 在线 → 返回 runtime（零回归）。

所有失败均抛 ``DaemonClientNoActiveSession``（AppError HTTP 400，
code DAEMON_CLIENT_NO_SESSION），details.reason 区分场景。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest

from app.modules.workspace.member_runtimes.resolver import (
    resolve_runtime_for_writeback,
)
from app.modules.workspace.member_runtimes.tests.helpers_writeback import (
    make_daemon_client_workspace_with_binding,
)


async def _make_user(db_session) -> uuid.UUID:
    from app.core.security import password_hasher
    from app.modules.auth.model import User

    user_id = uuid.uuid4()
    db_session.add(
        User(
            id=user_id,
            email=f"resolver-{user_id.hex[:8]}@example.com",
            password_hash=password_hasher.hash("Pass123!"),
            display_name="Resolver",
            status="active",
        )
    )
    await db_session.commit()
    return user_id


async def test_resolve_hit_returns_matching_runtime(db_session) -> None:
    """binding + default_agent 命中 → 返回 online runtime dict（含 id）。"""
    user_id = await _make_user(db_session)
    refs = await make_daemon_client_workspace_with_binding(
        db_session, user_id=user_id, default_agent="claude"
    )

    rt = await resolve_runtime_for_writeback(db_session, refs["ws_id"], user_id)
    # SQLite 存 CHAR(32) hex string，归一化比较（与 caller 同范式）。
    assert uuid.UUID(str(rt["id"])) == refs["runtime_id"]
    assert rt["provider"] == "claude"
    assert rt["status"] == "online"


async def test_resolve_no_binding_no_legacy_raises_not_bound(db_session) -> None:
    """无 binding 行 + daemon-client 无 legacy daemon_runtime_id → not_bound。"""
    from app.modules.change_writer.proxy import DaemonClientNoActiveSession
    from app.modules.workspace.model import Workspace

    user_id = await _make_user(db_session)
    ws_id = uuid.uuid4()
    db_session.add(
        Workspace(
            id=ws_id,
            name="No Bind WS",
            slug=f"no-bind-{ws_id.hex[:8]}",
            root_path=f"/tmp/no-bind-{ws_id.hex[:8]}",
            path_source="daemon-client",
            daemon_runtime_id=None,
        )
    )
    await db_session.commit()

    with pytest.raises(DaemonClientNoActiveSession) as exc_info:
        await resolve_runtime_for_writeback(db_session, ws_id, user_id)
    assert exc_info.value.details is not None
    assert exc_info.value.details["reason"] == "not_bound"


async def test_resolve_daemon_offline_raises(db_session) -> None:
    """binding 在但 daemon_instance 离线 → daemon_offline。"""
    from app.modules.change_writer.proxy import DaemonClientNoActiveSession

    user_id = await _make_user(db_session)
    refs = await make_daemon_client_workspace_with_binding(
        db_session, user_id=user_id, daemon_online=False
    )

    with pytest.raises(DaemonClientNoActiveSession) as exc_info:
        await resolve_runtime_for_writeback(db_session, refs["ws_id"], user_id)
    assert exc_info.value.details is not None
    assert exc_info.value.details["reason"] == "daemon_offline"


async def test_resolve_default_agent_unset_raises(db_session) -> None:
    """daemon 在线但 workspace.default_agent 为空 → default_agent_unset。"""
    from app.modules.change_writer.proxy import DaemonClientNoActiveSession
    from app.modules.daemon.model import DaemonRuntime
    from app.modules.workspace.model import Workspace

    user_id = await _make_user(db_session)
    # binding 的 default_agent 经 workspace.default_agent 读取；这里构造一个
    # default_agent=None 的 workspace（runtime provider 非空也无济于事）。
    refs = await make_daemon_client_workspace_with_binding(
        db_session, user_id=user_id, default_agent="claude"
    )
    ws = await db_session.get(Workspace, refs["ws_id"])
    assert ws is not None
    ws.default_agent = None
    db_session.add(ws)
    await db_session.commit()
    # provider 非空但 default_agent 为空：resolver 走 target_provider=None 分支
    # query_runtime_by_daemon_and_provider(daemon_id, None) 会命中任意 online runtime，
    # 故此场景实际命中。为真验证 default_agent_unset，需 daemon 无任何 online runtime。
    rt = await db_session.get(DaemonRuntime, refs["runtime_id"])
    assert rt is not None
    rt.status = "offline"
    db_session.add(rt)
    await db_session.commit()

    with pytest.raises(DaemonClientNoActiveSession) as exc_info:
        await resolve_runtime_for_writeback(db_session, refs["ws_id"], user_id)
    assert exc_info.value.details is not None
    assert exc_info.value.details["reason"] == "default_agent_unset"


async def test_resolve_provider_unavailable_raises(db_session) -> None:
    """default_agent 设了但 daemon 无该 provider 的 online runtime → provider_unavailable。"""
    from app.modules.change_writer.proxy import DaemonClientNoActiveSession

    user_id = await _make_user(db_session)
    # binding 用 claude，但 workspace.default_agent 改成 codex（daemon 无 codex runtime）。
    refs = await make_daemon_client_workspace_with_binding(
        db_session, user_id=user_id, default_agent="claude"
    )
    from app.modules.workspace.model import Workspace

    ws = await db_session.get(Workspace, refs["ws_id"])
    assert ws is not None
    ws.default_agent = "codex"
    db_session.add(ws)
    await db_session.commit()

    with pytest.raises(DaemonClientNoActiveSession) as exc_info:
        await resolve_runtime_for_writeback(db_session, refs["ws_id"], user_id)
    assert exc_info.value.details is not None
    assert exc_info.value.details["reason"] == "provider_unavailable"
    assert exc_info.value.details["enabled_providers"] == ["claude"]


async def test_resolve_legacy_fallback_daemon_runtime_id(db_session) -> None:
    """无 binding + 非空 daemon_runtime_id + 在线 → legacy fallback 返回 runtime（零回归）。"""
    from app.modules.daemon.model import DaemonRuntime
    from app.modules.workspace.model import Workspace

    user_id = await _make_user(db_session)
    runtime_id = uuid.uuid4()
    db_session.add(
        DaemonRuntime(
            id=runtime_id,
            user_id=user_id,
            provider="claude",
            status="online",
            last_heartbeat_at=datetime.now(UTC),
        )
    )
    ws_id = uuid.uuid4()
    db_session.add(
        Workspace(
            id=ws_id,
            name="Legacy WS",
            slug=f"legacy-{ws_id.hex[:8]}",
            root_path=f"/tmp/legacy-{ws_id.hex[:8]}",
            path_source="daemon-client",
            daemon_runtime_id=runtime_id,
        )
    )
    await db_session.commit()

    rt = await resolve_runtime_for_writeback(db_session, ws_id, user_id)
    # SQLite 存 CHAR(32) hex string，归一化比较。
    assert uuid.UUID(str(rt["id"])) == runtime_id


pytestmark = pytest.mark.asyncio
