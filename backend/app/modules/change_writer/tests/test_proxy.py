"""change_writer proxy 直接函数测试（task-10, FR-08/FR-09/D-004@v1 遗留）。

task-07（2026-08-14-change-center-conversation-driven）：``/changes/proxy-create``
HTTP 端点已随前端去表单删除，指向该端点的用例一并删除。保留仍有效的直接函数用例：

- 等回执时强制 refresh（外部 session complete 后不能卡在 identity map）。
- ``service.create_change``（daemon-client 离线）→ ``DaemonClientNoActiveSession``。
- ``_build_change_key`` 中文 / 纯标点兜底 / 英文小写。
"""

from __future__ import annotations

import asyncio
import uuid
from unittest.mock import patch

import pytest


async def _setup_daemon_client_workspace(db_session, *, online: bool = True) -> dict:
    """Create a daemon-client workspace + bound runtime + admin user + token.

    2026-07-10-remove-server-local-workspace-mode：Workspace 模型删了
    ``daemon_runtime_id`` / ``path_source`` 列，绑定真相源改走
    ``WorkspaceMemberRuntime.daemon_id`` → ``DaemonInstance``（D-005 / D-002）。
    本 fixture 复用 task-07 落地的 ``make_daemon_client_workspace_with_binding``
    构造新链路（DaemonInstance + per-member binding 行 + workspace.default_agent），
    让 ``resolve_runtime_for_writeback`` 命中。

    ``online=False`` 时 DaemonInstance + DaemonRuntime 都置 offline → resolver
    在 daemon 实体阶段即返回 ``reason=daemon_offline``。
    """
    from app.core.config import get_settings
    from app.core.security import create_access_token, password_hasher
    from app.modules.auth.model import User
    from app.modules.workspace.member_runtimes.tests.helpers_writeback import (
        make_daemon_client_workspace_with_binding,
    )

    user_id = uuid.uuid4()
    user = User(
        id=user_id,
        email=f"proxy-{user_id.hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="Proxy",
        status="active",
        is_platform_admin=True,
    )
    db_session.add(user)

    binding_refs = await make_daemon_client_workspace_with_binding(
        db_session,
        user_id=user_id,
        default_agent="claude",
        daemon_online=online,
        runtime_online=online,
    )

    settings = get_settings()
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=True,
        settings=settings,
    )
    return {
        "ws_id": binding_refs["ws_id"],
        "user_id": user_id,
        "runtime_id": binding_refs["runtime_id"],
        "daemon_id": binding_refs["daemon_id"],
        "token": token,
    }


async def _simulate_daemon_complete(db_session, change_write_id: uuid.UUID) -> None:
    """模拟 daemon claim+complete 回执：把 pending 行翻 done（跳过 claim 中间态）。"""
    from app.modules.daemon.model import DaemonChangeWrite

    cw = await db_session.get(DaemonChangeWrite, change_write_id)
    assert cw is not None
    cw.status = "done"
    db_session.add(cw)
    await db_session.commit()


async def test_await_change_write_receipt_refreshes_external_update(db_session):
    """等待回执时强制 refresh：另一个 session complete 后不能卡在 identity map。"""
    from app.core.db import get_session_factory
    from app.modules.change_writer import proxy as proxy_mod
    from app.modules.daemon.model import DaemonChangeWrite

    refs = await _setup_daemon_client_workspace(db_session, online=True)
    cw = DaemonChangeWrite(
        workspace_id=refs["ws_id"],
        runtime_id=refs["runtime_id"],
        change_key="2026-06-26-refresh",
        files=[{"path": "changes/2026-06-26-refresh/MASTER.md", "content": "# x\n"}],
        status="pending",
    )
    db_session.add(cw)
    await db_session.commit()

    # Keep a stale pending instance in db_session's identity map.
    cached = await db_session.get(DaemonChangeWrite, cw.id)
    assert cached is not None
    assert cached.status == "pending"

    factory = get_session_factory()
    async with factory() as other_session:
        external = await other_session.get(DaemonChangeWrite, cw.id)
        assert external is not None
        external.status = "done"
        other_session.add(external)
        await other_session.commit()

    with (
        patch.object(proxy_mod, "PROXY_CHANGE_WRITE_TIMEOUT_SECONDS", 1.0),
        patch.object(proxy_mod, "PROXY_POLL_INTERVAL_SECONDS", 0.0),
    ):
        result = await asyncio.wait_for(
            proxy_mod._await_change_write_receipt(db_session, cw.id),
            timeout=1.0,
        )

    assert result.status == "done"


async def test_service_create_change_daemon_client_offline_raises(client, db_session):
    """service.create_change(daemon-client, daemon 离线) → DaemonClientNoActiveSession。

    D-002@v1（2026-07-05-daemon-client-change-binding-fix）：create_change 签名删
    runtime_id（写回始终现算）。替代旧 test_service_create_change_daemon_client_no_runtime_raises
    （测旧 runtime_id=None 入参，入参删后场景不存在）。daemon 离线时 resolver 抛
    DaemonClientNoActiveSession(reason=daemon_offline)。
    """
    from app.modules.change_writer.proxy import DaemonClientNoActiveSession
    from app.modules.change_writer.service import ChangeWriterService

    refs = await _setup_daemon_client_workspace(db_session, online=False)
    service = ChangeWriterService(db_session)

    with pytest.raises(DaemonClientNoActiveSession):
        await service.create_change(
            refs["ws_id"],
            refs["user_id"],
            title="Offline Daemon",
        )


def test_build_change_key_preserves_chinese():
    """AC-01：中文标题 change_key 保留中文（D-003@v1 unicode 正则）。"""
    from app.modules.change_writer.proxy import _build_change_key

    key = _build_change_key("测试")
    assert key.startswith("20")  # YYYY-MM-DD 前缀
    assert "测试" in key
    # 末尾 uuid hex 后缀（6 位）
    assert len(key.rsplit("-", 1)[-1]) == 6


def test_build_change_key_falls_back_to_untitled_for_punctuation():
    """AC-01：纯标点标题兜底 untitled。"""
    from app.modules.change_writer.proxy import _build_change_key

    key = _build_change_key("！！！？？？")
    assert "untitled" in key


def test_build_change_key_lowercases_english():
    """AC-01：英文标题统一小写（与 worktree lease 分支一致）。"""
    from app.modules.change_writer.proxy import _build_change_key

    key = _build_change_key("My Change")
    assert "my-change" in key
    assert "My" not in key
