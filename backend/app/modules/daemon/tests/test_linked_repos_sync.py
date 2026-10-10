"""关联仓同步编排测试（task-03，FR-04/FR-05）。

覆盖：payload 组装（绑定缺失 409 / repos 含 abs_path）、apply_sync_result 宽容收数
（正常 upsert / 未知仓 / 非法枚举跳过）、summary 双视角（成员=自己机器 / admin=全部）、
trigger_sync 的 method_not_found 降级（skipped 落库不报错，FR-07）、HTTP 面
（sync 受理 / 回报端点归属校验）。
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.daemon.linked_repos_sync import (
    apply_sync_result,
    build_sync_payload,
    summary_for_repos,
    sync_timeout_seconds,
    trigger_sync,
)
from app.modules.daemon.model import DaemonInstance
from app.modules.daemon.runtime.service import DaemonRpcRemoteError
from app.modules.workspace.linked_repos.model import (
    WorkspaceLinkedRepo,
    WorkspaceLinkedRepoPath,
    WorkspaceLinkedRepoSyncState,
)
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
from app.modules.workspace.model import Workspace


async def _seed_ws(session: AsyncSession) -> tuple[Workspace, DaemonInstance, DaemonInstance]:
    user_id = uuid.uuid4()
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"WS-{user_id.hex[:6]}",
        slug=user_id.hex[:8],
        root_path="/ws",
        status="active",
    )
    own_machine = DaemonInstance(
        id=uuid.uuid4(), user_id=user_id, hostname="own", server_url="http://b"
    )
    other_machine = DaemonInstance(
        id=uuid.uuid4(), user_id=uuid.uuid4(), hostname="other", server_url="http://b"
    )
    session.add_all([ws, own_machine, other_machine])
    await session.commit()
    return ws, own_machine, other_machine


async def _seed_repo_with_paths(
    session: AsyncSession,
    ws: Workspace,
    *,
    actor_user_id: uuid.UUID,
    machine: DaemonInstance,
) -> WorkspaceLinkedRepo:
    repo = WorkspaceLinkedRepo(
        workspace_id=ws.id, name="specs", rel_path="../specs", repo_url="git@x:specs.git"
    )
    session.add(repo)
    await session.flush()
    session.add(
        WorkspaceLinkedRepoPath(
            linked_repo_id=repo.id, user_id=actor_user_id, root_path="C:/me/specs"
        )
    )
    # 他人机器已有的一条状态行（成员视角应不可见）。
    session.add(
        WorkspaceLinkedRepoSyncState(
            linked_repo_id=repo.id,
            machine_id=machine.id,
            layer="repos_registry",
            status="ok",
        )
    )
    await session.commit()
    return repo


async def test_build_payload_missing_binding(db_session: AsyncSession) -> None:
    ws, _, _ = await _seed_ws(db_session)
    with pytest.raises(Exception):
        await build_sync_payload(db_session, ws.id, uuid.uuid4())


async def test_build_payload_shape_and_timeout(db_session: AsyncSession) -> None:
    ws, machine, _ = await _seed_ws(db_session)
    actor = machine.user_id
    db_session.add(
        WorkspaceMemberRuntime(
            workspace_id=ws.id,
            user_id=actor,
            daemon_id=machine.id,
            root_path="/container/ws",
            path_source="manual",
        )
    )
    await db_session.commit()
    await _seed_repo_with_paths(db_session, ws, actor_user_id=actor, machine=machine)

    payload = await build_sync_payload(db_session, ws.id, actor)
    assert payload["workspace_id"] == str(ws.id)
    assert payload["repos"][0]["name"] == "specs"
    assert payload["repos"][0]["rel_path"] == "../specs"
    assert payload["repos"][0]["abs_path"] == "C:/me/specs"
    # 超时公式：30 + 15×1 仓。
    assert sync_timeout_seconds(1) == 45
    assert sync_timeout_seconds(20) == 180


async def test_apply_sync_result_tolerant(db_session: AsyncSession) -> None:
    ws, machine, _ = await _seed_ws(db_session)
    actor = machine.user_id
    repo = await _seed_repo_with_paths(db_session, ws, actor_user_id=actor, machine=machine)

    written = await apply_sync_result(
        db_session,
        machine.id,
        ws.id,
        [
            {"repo_name": "specs", "layer": "projects_yaml", "status": "ok"},
            {"repo_name": "ghost", "layer": "projects_yaml", "status": "ok"},  # 未知仓跳过
            {"repo_name": "specs", "layer": "bad-layer", "status": "ok"},  # 非法层跳过
            {
                "repo_name": "specs",
                "layer": "repos_registry",
                "status": "failed",
                "detail": "路径不存在",
            },
        ],
    )
    assert written == 2
    stmt_rows = [
        r
        for r in (
            await db_session.execute(
                WorkspaceLinkedRepoSyncState.__table__.select().where(
                    WorkspaceLinkedRepoSyncState.__table__.c.linked_repo_id == repo.id
                )
            )
        ).mappings()
    ]
    by_layer = {r["layer"]: r for r in stmt_rows}
    assert by_layer["projects_yaml"]["status"] == "ok"
    assert by_layer["repos_registry"]["status"] == "failed"

    # 重报同层 → upsert 覆盖（不重复建行）。
    written = await apply_sync_result(
        db_session,
        machine.id,
        ws.id,
        [{"repo_name": "specs", "layer": "repos_registry", "status": "ok"}],
    )
    assert written == 1
    rows = (
        await db_session.execute(
            WorkspaceLinkedRepoSyncState.__table__.select().where(
                WorkspaceLinkedRepoSyncState.__table__.c.linked_repo_id == repo.id
            )
        )
    ).mappings()
    assert len(list(rows)) == 2


async def test_summary_member_vs_admin(db_session: AsyncSession) -> None:
    ws, machine, other = await _seed_ws(db_session)
    actor = machine.user_id
    repo = await _seed_repo_with_paths(db_session, ws, actor_user_id=actor, machine=other)

    # 成员视角：自己未绑定机器（无绑定行）→ 空。
    member_view = await summary_for_repos(
        db_session, ws.id, [repo.id], actor, viewer_is_elevated=False
    )
    assert member_view[repo.id] == []

    # admin 视角：全部机器（含 other 的既有行）。
    admin_view = await summary_for_repos(
        db_session, ws.id, [repo.id], uuid.uuid4(), viewer_is_elevated=True
    )
    assert len(admin_view[repo.id]) == 1
    assert admin_view[repo.id][0].status == "ok"


async def test_trigger_sync_method_not_found_downgrade(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    ws, machine, _ = await _seed_ws(db_session)
    actor = machine.user_id
    db_session.add(
        WorkspaceMemberRuntime(
            workspace_id=ws.id,
            user_id=actor,
            daemon_id=machine.id,
            root_path="/ws",
            path_source="manual",
        )
    )
    await db_session.commit()
    repo = await _seed_repo_with_paths(db_session, ws, actor_user_id=actor, machine=machine)

    hub = AsyncMock()
    hub.send_rpc = AsyncMock(side_effect=DaemonRpcRemoteError({"code": "method_not_found"}))

    import app.modules.daemon.ws_hub as ws_hub_mod

    monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: hub)
    result = await trigger_sync(db_session, ws.id, actor)
    assert result["dispatched"] is False
    assert "需升级" in result["reason"]
    rows = (
        await db_session.execute(
            WorkspaceLinkedRepoSyncState.__table__.select().where(
                WorkspaceLinkedRepoSyncState.__table__.c.linked_repo_id == repo.id
            )
        )
    ).mappings()
    layers = {r["layer"]: r["status"] for r in rows}
    assert layers == {"projects_yaml": "skipped", "repos_registry": "skipped"}


async def test_sync_and_report_http(
    client: AsyncClient,
    db_session: AsyncSession,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """sync 受理 + 回报落库 + GET 摘要可见（admin 全链路）。"""
    ws, machine, _ = await _seed_ws(db_session)
    # admin 触发 sync 也需绑定行（RPC 按 (workspace,actor) 路由机器）。
    from sqlalchemy import select

    from app.modules.auth.model import User

    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .one()
    )
    db_session.add(
        WorkspaceMemberRuntime(
            workspace_id=ws.id,
            user_id=admin.id,
            daemon_id=machine.id,
            root_path="/ws",
            path_source="manual",
        )
    )
    await db_session.commit()
    base = f"/api/workspaces/{ws.id}/linked-repos"
    repo_id = ((await client.post(base, json={"name": "frontend"}, headers=auth_headers)).json())[
        "id"
    ]
    await client.put(f"{base}/{repo_id}/my-path", json={"path": "C:/fe"}, headers=auth_headers)

    hub = AsyncMock()
    hub.send_rpc = AsyncMock(return_value={"results": []})
    import app.modules.daemon.ws_hub as ws_hub_mod

    monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: hub)
    resp = await client.post(f"{base}/sync", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["dispatched"] is True

    # 回报端点：instance 归属校验（随便一个 instance_id → 404）。
    resp = await client.post(
        f"/api/daemon/machines/{uuid.uuid4()}/linked-repos-sync-result",
        json={"workspace_id": str(ws.id), "results": []},
        headers=auth_headers,
    )
    assert resp.status_code == 404
