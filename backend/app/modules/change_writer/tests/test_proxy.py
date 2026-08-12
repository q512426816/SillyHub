"""proxy_create_change + proxy-create 端点测试 (task-10, FR-08/FR-09/D-004@v1)。

覆盖四例：
- 在线 runtime：落 Change + daemon_change_writes status='done'。
- 离线 runtime：400 DAEMON_CLIENT_NO_SESSION（runtime 不绑定 / 不在线）。
- 超时：daemon_change_writes status='failed' + ChangeWriteError（mock 加速）。
- 无 runtime：service.create_change(daemon-client, runtime_id=None) → DaemonClientNoActiveSession。
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest


def _auth(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


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


async def _collect_change_write_id(db_session, runtime_id: uuid.UUID) -> uuid.UUID:
    from sqlalchemy import select

    from app.modules.daemon.model import DaemonChangeWrite

    stmt = (
        select(DaemonChangeWrite)
        .where(DaemonChangeWrite.runtime_id == runtime_id)
        .order_by(DaemonChangeWrite.created_at.desc())
    )
    cw = (await db_session.execute(stmt)).scalars().first()
    assert cw is not None
    return cw.id


async def test_proxy_create_change_online(client, db_session):
    """在线 runtime：proxy-create 返回 201 + Change 落库 + daemon_change_writes done."""
    refs = await _setup_daemon_client_workspace(db_session, online=True)

    # 用 mock 在下发后立即模拟 daemon 回执（避免轮询阻塞测试）。
    from app.modules.change_writer import proxy as proxy_mod

    async def fake_await(session, cw_id):
        await _simulate_daemon_complete(session, cw_id)
        from app.modules.daemon.model import DaemonChangeWrite

        return await session.get(DaemonChangeWrite, cw_id)

    with patch.object(proxy_mod, "_await_change_write_receipt", side_effect=fake_await):
        resp = await client.post(
            f"/api/workspaces/{refs['ws_id']}/changes/proxy-create",
            json={
                "title": "Daemon Change",
                "description": "需要支持 daemon 代写",
                "change_type": "feature",
            },
            headers=_auth(refs["token"]),
        )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["title"] == "Daemon Change"
    assert body["status"] == "active"
    assert body["path"].startswith("changes/")
    assert ".sillyspec" not in body["path"]
    assert body["agent_dispatch"] is None
    assert "daemon-change" in body["change_key"]

    # 落库校验：Change + ChangeDocument + daemon_change_writes 收尾 done。
    from sqlalchemy import select

    from app.modules.change.model import Change, ChangeDocument
    from app.modules.daemon.model import DaemonChangeWrite

    changes = list(
        (await db_session.execute(select(Change).where(Change.workspace_id == refs["ws_id"])))
        .scalars()
        .all()
    )
    assert len(changes) == 1
    assert changes[0].path == f"changes/{changes[0].change_key}"

    docs = list(
        (
            await db_session.execute(
                select(ChangeDocument).where(ChangeDocument.change_id == changes[0].id)
            )
        )
        .scalars()
        .all()
    )
    doc_types = {d.doc_type for d in docs}
    assert {"master", "proposal", "request"} <= doc_types
    for d in docs:
        assert d.path.startswith("changes/")

    cw = (
        (
            await db_session.execute(
                select(DaemonChangeWrite).where(DaemonChangeWrite.workspace_id == refs["ws_id"])
            )
        )
        .scalars()
        .first()
    )
    assert cw is not None
    assert cw.status == "done"
    # files 扁平路径（无 .sillyspec 包裹，D-005@v1）
    assert any(f["path"].startswith("changes/") for f in cw.files)
    assert not any(".sillyspec" in f["path"] for f in cw.files)


async def test_proxy_create_change_runtime_offline(client, db_session):
    """离线 runtime：400 DAEMON_CLIENT_NO_SESSION + reason=daemon_offline。"""
    refs = await _setup_daemon_client_workspace(db_session, online=False)

    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/proxy-create",
        json={
            "title": "Should Fail",
        },
        headers=_auth(refs["token"]),
    )
    assert resp.status_code == 400
    body = resp.json()
    assert body["code"] == "DAEMON_CLIENT_NO_SESSION"
    # D-001@v1：reason 区分场景（legacy fallback 走 daemon_offline）。
    assert body["details"]["reason"] == "daemon_offline"


async def test_proxy_create_change_runtime_stale_heartbeat_marks_offline(client, db_session):
    """status 仍 online 但 heartbeat stale：直接 API 也应返回 DAEMON_CLIENT_NO_SESSION。"""
    from app.modules.daemon.model import DaemonRuntime

    refs = await _setup_daemon_client_workspace(db_session, online=True)
    runtime = await db_session.get(DaemonRuntime, refs["runtime_id"])
    assert runtime is not None
    runtime.last_heartbeat_at = datetime.now(UTC) - timedelta(seconds=120)
    db_session.add(runtime)
    await db_session.commit()

    resp = await client.post(
        f"/api/workspaces/{refs['ws_id']}/changes/proxy-create",
        json={
            "title": "Stale Runtime",
        },
        headers=_auth(refs["token"]),
    )

    assert resp.status_code == 400
    body = resp.json()
    assert body["code"] == "DAEMON_CLIENT_NO_SESSION"
    assert body["details"]["reason"] == "runtime_offline"
    await db_session.refresh(runtime)
    assert runtime.status == "offline"


async def test_proxy_create_change_unbound_daemon_client_returns_400(client, db_session):
    """daemon-client workspace 无 WorkspaceMemberRuntime binding 行 → 400 not_bound。

    D-002@v1 / 2026-07-10-remove-server-local-workspace-mode：Workspace 删了
    ``daemon_runtime_id`` 列，绑定真相源改走 ``WorkspaceMemberRuntime.daemon_id``。
    resolver 经 ``resolve_runtime_for_writeback`` 解析，无 binding 行即真未绑定，
    抛 ``DaemonClientNoActiveSession(reason=not_bound)``（legacy
    ``workspaces.daemon_runtime_id`` fallback 已删 D-005，不再回退）。
    替代旧 test_proxy_create_change_runtime_not_bound（测旧 runtime_id mismatch 语义，
    入参删 runtime_id 后场景不存在）。
    """
    from app.core.config import get_settings
    from app.core.security import create_access_token, password_hasher
    from app.modules.auth.model import User
    from app.modules.workspace.model import Workspace

    # 建一个**无** WorkspaceMemberRuntime 行的 workspace（只 user + workspace）。
    user_id = uuid.uuid4()
    user = User(
        id=user_id,
        email=f"unbound-{user_id.hex[:8]}@example.com",
        password_hash=password_hasher.hash("Pass123!"),
        display_name="Unbound",
        status="active",
        is_platform_admin=True,
    )
    db_session.add(user)

    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name="Unbound WS",
        slug=f"unbound-{ws_id.hex[:8]}",
        root_path=f"/home/user/proj-{ws_id.hex[:8]}",
        status="active",
        component_key="backend",
        default_agent="claude",
        created_by=user_id,
        last_scanned_at=datetime.now(UTC),
    )
    db_session.add(ws)
    await db_session.commit()

    settings = get_settings()
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=True,
        settings=settings,
    )

    resp = await client.post(
        f"/api/workspaces/{ws_id}/changes/proxy-create",
        json={"title": "Unbound"},
        headers=_auth(token),
    )
    assert resp.status_code == 400
    body = resp.json()
    assert body["code"] == "DAEMON_CLIENT_NO_SESSION"
    assert body["details"]["reason"] == "not_bound"


async def test_proxy_create_change_binding_path_online(client, db_session):
    """新链路 fixture（binding + DaemonInstance + default_agent）：proxy-create 201。

    task-07 AC-01：daemon_runtime_id=None + per-member binding 行 → resolve_runtime_for_writeback
    命中 → 下发 change-write → 落库 Change。覆盖现有 fixture（非空 daemon_runtime_id）的盲区。
    """
    from app.modules.workspace.member_runtimes.tests.helpers_writeback import (
        make_daemon_client_workspace_with_binding,
    )

    # 复用 _setup_daemon_client_workspace 的 user/token 创建逻辑（admin token）。
    refs = await _setup_daemon_client_workspace(db_session, online=True)
    # 用 admin user 起新链路 workspace（独立 ws_id）。
    binding_refs = await make_daemon_client_workspace_with_binding(
        db_session, user_id=refs["user_id"], default_agent="claude"
    )

    from app.modules.change_writer import proxy as proxy_mod

    async def fake_await(session, cw_id):
        await _simulate_daemon_complete(session, cw_id)
        from app.modules.daemon.model import DaemonChangeWrite

        return await session.get(DaemonChangeWrite, cw_id)

    with patch.object(proxy_mod, "_await_change_write_receipt", side_effect=fake_await):
        resp = await client.post(
            f"/api/workspaces/{binding_refs['ws_id']}/changes/proxy-create",
            json={"title": "Binding Path", "description": "新链路", "change_type": "feature"},
            headers=_auth(refs["token"]),
        )

    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["title"] == "Binding Path"

    # DaemonChangeWrite.runtime_id 为 resolver 现算值（= binding_refs["runtime_id"]）。
    from sqlalchemy import select

    from app.modules.daemon.model import DaemonChangeWrite

    cw = (
        (
            await db_session.execute(
                select(DaemonChangeWrite).where(
                    DaemonChangeWrite.workspace_id == binding_refs["ws_id"]
                )
            )
        )
        .scalars()
        .first()
    )
    assert cw is not None
    assert cw.runtime_id == binding_refs["runtime_id"]


async def test_proxy_create_change_timeout(client, db_session):
    """超时（无回执）：daemon_change_writes status='failed' + 400 ChangeWriteError。"""
    refs = await _setup_daemon_client_workspace(db_session, online=True)

    from app.modules.change_writer import proxy as proxy_mod

    # 真实 _await_change_write_receipt 会等 60s；这里用极短超时 + 无 daemon 回执触发 failed。
    with (
        patch.object(proxy_mod, "PROXY_CHANGE_WRITE_TIMEOUT_SECONDS", 0.0),
        patch.object(proxy_mod, "PROXY_POLL_INTERVAL_SECONDS", 0.0),
    ):
        resp = await client.post(
            f"/api/workspaces/{refs['ws_id']}/changes/proxy-create",
            json={
                "title": "Timeout Change",
            },
            headers=_auth(refs["token"]),
        )

    assert resp.status_code == 400
    assert resp.json()["code"] == "CHANGE_WRITE_ERROR"

    from sqlalchemy import select

    from app.modules.daemon.model import DaemonChangeWrite

    cw = (
        (
            await db_session.execute(
                select(DaemonChangeWrite).where(DaemonChangeWrite.workspace_id == refs["ws_id"])
            )
        )
        .scalars()
        .first()
    )
    assert cw is not None
    assert cw.status == "failed"


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


# server-local create_change(lease_id) 路径零回归：由 test_router.py::test_create_change_success
# 及其余 7 个 server-local 用例持续守护（proxy 改动未触碰 lease_id 分支）。


# ── task-05（2026-08-01-proxy-create-race-fix）：占坑时序 + 回滚 + 中文 key ──────


async def test_proxy_create_change_preempts_change_before_dispatch(client, db_session):
    """AC-02：占坑 Change + docs 先于 daemon_change_write 下发 commit 存在。

    D-001@v2：proxy 下发前先占坑 Change(owner_id 非空, current_stage=draft) + 全部
    ChangeDocument，占住双表唯一键；回执 done 后 proxy 路不再 INSERT docs。
    """
    refs = await _setup_daemon_client_workspace(db_session, online=True)

    from sqlalchemy import select

    from app.modules.change.model import Change, ChangeDocument
    from app.modules.change_writer import proxy as proxy_mod
    from app.modules.daemon.model import DaemonChangeWrite

    preempt: dict[str, int] = {}

    async def fake_await(session, cw_id):
        # 下发后、回执前：占坑 Change + docs 应已先于 daemon_change_write 落库。
        changes = list(
            (await session.execute(select(Change).where(Change.workspace_id == refs["ws_id"])))
            .scalars()
            .all()
        )
        docs = list(
            (
                await session.execute(
                    select(ChangeDocument).where(
                        ChangeDocument.change_id.in_([c.id for c in changes])
                    )
                )
            )
            .scalars()
            .all()
        )
        preempt["changes"] = len(changes)
        preempt["docs"] = len(docs)
        assert changes, "占坑 Change 应在下发后、回执前已存在"
        assert changes[0].owner_id == refs["user_id"]
        assert (
            changes[0].current_stage == "brainstorm"
        )  # ql-20260812-006: draft→brainstorm（对齐 SillySpec 标准流程）
        await _simulate_daemon_complete(session, cw_id)
        return await session.get(DaemonChangeWrite, cw_id)

    with patch.object(proxy_mod, "_await_change_write_receipt", side_effect=fake_await):
        resp = await client.post(
            f"/api/workspaces/{refs['ws_id']}/changes/proxy-create",
            json={
                "title": "Preempt Before Dispatch",
                "description": "占坑先于下发",
                "change_type": "feature",
            },
            headers=_auth(refs["token"]),
        )

    assert resp.status_code == 201, resp.text
    assert preempt["changes"] == 1
    # master + proposal + request（有 description → 3 个 docs）
    assert preempt["docs"] == 3


async def test_proxy_create_change_failed_rolls_back_preempt(client, db_session):
    """AC-05：daemon 回执 failed → 占坑 Change + docs 回滚（显式删 docs，无孤儿）。

    D-005@v1 + SQLite FK 关闭细化：回滚用独立 session 显式删 docs 再删 Change，
    不依赖 PRAGMA foreign_keys（backend conftest SQLite 默认关闭）。
    """
    refs = await _setup_daemon_client_workspace(db_session, online=True)

    from sqlalchemy import select

    from app.modules.change.model import Change, ChangeDocument
    from app.modules.change_writer import proxy as proxy_mod
    from app.modules.daemon.model import DaemonChangeWrite

    async def fake_await(session, cw_id):
        cw = await session.get(DaemonChangeWrite, cw_id)
        assert cw is not None
        cw.status = "failed"
        cw.error = "daemon write failed"
        session.add(cw)
        await session.commit()
        return cw

    with patch.object(proxy_mod, "_await_change_write_receipt", side_effect=fake_await):
        resp = await client.post(
            f"/api/workspaces/{refs['ws_id']}/changes/proxy-create",
            json={"title": "Will Fail", "description": "回滚占坑"},
            headers=_auth(refs["token"]),
        )

    assert resp.status_code == 400
    assert resp.json()["code"] == "CHANGE_WRITE_ERROR"

    # 占坑 Change + docs 都已回滚删除（无孤儿）。
    changes = list(
        (await db_session.execute(select(Change).where(Change.workspace_id == refs["ws_id"])))
        .scalars()
        .all()
    )
    assert changes == []
    docs = list(
        (
            await db_session.execute(
                select(ChangeDocument).where(ChangeDocument.change_id.in_([c.id for c in changes]))
            )
        )
        .scalars()
        .all()
    )
    assert docs == []


async def test_proxy_create_change_timeout_rolls_back_preempt(client, db_session):
    """AC-05：等回执超时 → 占坑 Change + docs 回滚（无孤儿）。

    复用现有 timeout 加速模式（PROXY_CHANGE_WRITE_TIMEOUT_SECONDS=0），新增占坑回滚断言。
    """
    refs = await _setup_daemon_client_workspace(db_session, online=True)

    from sqlalchemy import select

    from app.modules.change.model import Change, ChangeDocument
    from app.modules.change_writer import proxy as proxy_mod

    with (
        patch.object(proxy_mod, "PROXY_CHANGE_WRITE_TIMEOUT_SECONDS", 0.0),
        patch.object(proxy_mod, "PROXY_POLL_INTERVAL_SECONDS", 0.0),
    ):
        resp = await client.post(
            f"/api/workspaces/{refs['ws_id']}/changes/proxy-create",
            json={"title": "Timeout Rollback", "description": "超时回滚"},
            headers=_auth(refs["token"]),
        )

    assert resp.status_code == 400
    assert resp.json()["code"] == "CHANGE_WRITE_ERROR"

    changes = list(
        (await db_session.execute(select(Change).where(Change.workspace_id == refs["ws_id"])))
        .scalars()
        .all()
    )
    assert changes == []
    docs = list(
        (
            await db_session.execute(
                select(ChangeDocument).where(ChangeDocument.change_id.in_([c.id for c in changes]))
            )
        )
        .scalars()
        .all()
    )
    assert docs == []


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
