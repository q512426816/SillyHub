"""关联仓三表模型级测试（task-01，FR-01/FR-02 数据面）。

覆盖：三表建行、(workspace_id,name) 与 (linked_repo_id,user_id) 唯一约束、
(linked_repo_id,machine_id,layer) 唯一 upsert 语义、删除 linked_repo 行后
paths/sync_states 级联清理、无 relation_kind 字段（D-006）。
HTTP/权限面用例随 task-02 追加（同文件）。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance
from app.modules.workspace.linked_repos.model import (
    WorkspaceLinkedRepo,
    WorkspaceLinkedRepoPath,
    WorkspaceLinkedRepoSyncState,
)
from app.modules.workspace.model import Workspace


async def _seed(session: AsyncSession, tag: str = "a") -> tuple[Workspace, User, DaemonInstance]:
    """seed 一组 workspace/user/machine；tag 区分多次调用（email/slug 唯一）。"""
    ws = Workspace(
        id=uuid.uuid4(), name=f"WS-{tag}", slug=f"ws-{tag}", root_path=f"/ws-{tag}", status="active"
    )
    user = User(
        id=uuid.uuid4(),
        email=f"owner-{tag}@example.com",
        password_hash="x",
        display_name="Owner",
        status="active",
        is_platform_admin=False,
    )
    session.add_all([ws, user])
    await session.flush()
    machine = DaemonInstance(
        id=uuid.uuid4(), user_id=user.id, hostname="host-a", server_url="http://backend:8000"
    )
    session.add(machine)
    await session.commit()
    return ws, user, machine


async def test_three_tables_basic_rows(db_session: AsyncSession) -> None:
    ws, user, machine = await _seed(db_session)
    repo = WorkspaceLinkedRepo(
        workspace_id=ws.id,
        name="platform-specs",
        repo_url="git@example:specs.git",
        description="spec 规范仓",
        rel_path="../platform-specs",
        created_by=user.id,
    )
    db_session.add(repo)
    await db_session.flush()
    path = WorkspaceLinkedRepoPath(linked_repo_id=repo.id, user_id=user.id, root_path="C:/x/specs")
    state = WorkspaceLinkedRepoSyncState(
        linked_repo_id=repo.id,
        machine_id=machine.id,
        layer="repos_registry",
        status="ok",
        detail=None,
    )
    db_session.add_all([path, state])
    await db_session.commit()

    # 直接按主键取回验证字段（D-006：无 relation_kind 列）。
    again = await db_session.get(WorkspaceLinkedRepo, repo.id)
    assert again is not None
    assert again.name == "platform-specs"
    assert again.rel_path == "../platform-specs"
    assert not hasattr(again, "relation_kind")


async def test_unique_workspace_name(db_session: AsyncSession) -> None:
    ws, _user, _ = await _seed(db_session)
    db_session.add(WorkspaceLinkedRepo(workspace_id=ws.id, name="dup"))
    await db_session.flush()
    db_session.add(WorkspaceLinkedRepo(workspace_id=ws.id, name="dup"))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


async def test_unique_repo_user_path(db_session: AsyncSession) -> None:
    ws, user, _ = await _seed(db_session)
    repo = WorkspaceLinkedRepo(workspace_id=ws.id, name="frontend")
    db_session.add(repo)
    await db_session.flush()
    db_session.add(WorkspaceLinkedRepoPath(linked_repo_id=repo.id, user_id=user.id, root_path="a"))
    await db_session.flush()
    db_session.add(WorkspaceLinkedRepoPath(linked_repo_id=repo.id, user_id=user.id, root_path="b"))
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


async def test_unique_sync_state_rml(db_session: AsyncSession) -> None:
    ws, _, machine = await _seed(db_session)
    repo = WorkspaceLinkedRepo(workspace_id=ws.id, name="specs")
    db_session.add(repo)
    await db_session.flush()
    for status in ("ok", "failed"):
        db_session.add(
            WorkspaceLinkedRepoSyncState(
                linked_repo_id=repo.id,
                machine_id=machine.id,
                layer="projects_yaml",
                status=status,
            )
        )
    with pytest.raises(IntegrityError):
        await db_session.flush()
    await db_session.rollback()


async def test_delete_cascades(db_session: AsyncSession) -> None:
    ws, user, machine = await _seed(db_session)
    repo = WorkspaceLinkedRepo(workspace_id=ws.id, name="peer")
    db_session.add(repo)
    await db_session.flush()
    db_session.add_all(
        [
            WorkspaceLinkedRepoPath(linked_repo_id=repo.id, user_id=user.id, root_path="p"),
            WorkspaceLinkedRepoSyncState(
                linked_repo_id=repo.id,
                machine_id=machine.id,
                layer="projects_yaml",
                status="ok",
            ),
        ]
    )
    await db_session.commit()
    repo_id = repo.id

    await db_session.delete(repo)
    await db_session.commit()

    assert await db_session.get(WorkspaceLinkedRepo, repo_id) is None
    # conftest 引擎已开 SQLite FK pragma：ondelete=CASCADE 与 PostgreSQL 行为一致。
    import sqlalchemy as sa

    paths_left = await db_session.execute(
        sa.select(sa.func.count()).select_from(WorkspaceLinkedRepoPath.__table__)
    )
    states_left = await db_session.execute(
        sa.select(sa.func.count()).select_from(WorkspaceLinkedRepoSyncState.__table__)
    )
    assert paths_left.scalar_one() == 0
    assert states_left.scalar_one() == 0


# ────────────────────────────────────────────────────────────────────────────
# HTTP 层（task-02，FR-01/FR-02）：client/auth_headers 来自根 conftest（platform
# admin 短路 RBAC）；普通用户 token 自建（无角色 → 403，仿 test_link_router）。
# ────────────────────────────────────────────────────────────────────────────

from unittest.mock import AsyncMock

import sqlalchemy as sa
from httpx import AsyncClient

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher


async def _regular_user_token(session: AsyncSession, email: str = "member@example.com") -> str:
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        id=uuid.uuid4(),
        email=email,
        password_hash=password_hasher.hash("Xx1!aaaa"),
        display_name="Member",
        status="active",
        is_platform_admin=False,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=settings,
    )
    return token


async def test_linked_repos_crud_http(
    client: AsyncClient,
    db_session: AsyncSession,
    auth_headers: dict[str, str],
) -> None:
    ws, _, _ = await _seed(db_session)
    base = f"/api/workspaces/{ws.id}/linked-repos"

    # create -> 201
    resp = await client.post(
        base,
        json={
            "name": "platform-specs",
            "repo_url": "git@example:specs.git",
            "description": "spec 规范仓",
            "rel_path": "../platform-specs",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    item = resp.json()
    assert item["name"] == "platform-specs"
    assert item["rel_path"] == "../platform-specs"
    assert item["my_path"] is None
    assert item["sync_status_summary"] == []
    repo_id = item["id"]

    # duplicate name -> 409
    resp = await client.post(base, json={"name": "platform-specs"}, headers=auth_headers)
    assert resp.status_code == 409

    # list -> 1
    resp = await client.get(base, headers=auth_headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1

    # patch -> 200（name 不可改：payload 无 name 字段）
    resp = await client.patch(f"{base}/{repo_id}", json={"description": "改"}, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json()["description"] == "改"

    # patch 不存在 -> 404
    resp = await client.patch(
        f"{base}/{uuid.uuid4()}", json={"description": "x"}, headers=auth_headers
    )
    assert resp.status_code == 404

    # delete -> 204；再 list 空
    resp = await client.delete(f"{base}/{repo_id}", headers=auth_headers)
    assert resp.status_code == 204
    resp = await client.get(base, headers=auth_headers)
    assert resp.json() == []


async def test_my_path_upsert_and_clear(
    client: AsyncClient,
    db_session: AsyncSession,
    auth_headers: dict[str, str],
) -> None:
    ws, _, _ = await _seed(db_session)
    base = f"/api/workspaces/{ws.id}/linked-repos"
    resp = await client.post(base, json={"name": "frontend"}, headers=auth_headers)
    repo_id = resp.json()["id"]

    # upsert
    resp = await client.put(
        f"{base}/{repo_id}/my-path",
        json={"path": "C:/Users/me/works/frontend"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["my_path"] == "C:/Users/me/works/frontend"

    # 覆盖更新
    resp = await client.put(
        f"{base}/{repo_id}/my-path", json={"path": "D:/fe"}, headers=auth_headers
    )
    assert resp.json()["my_path"] == "D:/fe"

    # null 清除
    resp = await client.put(f"{base}/{repo_id}/my-path", json={"path": None}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["my_path"] is None

    # repo 不存在 -> 404
    resp = await client.put(
        f"{base}/{uuid.uuid4()}/my-path", json={"path": "x"}, headers=auth_headers
    )
    assert resp.status_code == 404


async def test_delete_cascades_my_path_rows_http(
    client: AsyncClient,
    db_session: AsyncSession,
    auth_headers: dict[str, str],
) -> None:
    ws, _, _ = await _seed(db_session)
    base = f"/api/workspaces/{ws.id}/linked-repos"
    repo_id = (await client.post(base, json={"name": "peer"}, headers=auth_headers)).json()["id"]
    await client.put(f"{base}/{repo_id}/my-path", json={"path": "p"}, headers=auth_headers)

    await client.delete(f"{base}/{repo_id}", headers=auth_headers)
    left = await db_session.execute(
        sa.select(sa.func.count()).select_from(WorkspaceLinkedRepoPath.__table__)
    )
    assert left.scalar_one() == 0


async def test_regular_user_forbidden(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    ws, _, _ = await _seed(db_session)
    token = await _regular_user_token(db_session)
    headers = {"Authorization": f"Bearer {token}"}
    base = f"/api/workspaces/{ws.id}/linked-repos"

    # 非成员（无 WORKSPACE_READ）读 -> 403
    resp = await client.get(base, headers=headers)
    assert resp.status_code == 403

    # 非成员写共享字段 -> 403
    resp = await client.post(base, json={"name": "x"}, headers=headers)
    assert resp.status_code == 403


# ────────────────────────────────────────────────────────────────────────────
# 验收审查返工用例（execute Stage Review）：跨工作区越权 404 / PATCH 显式清除 /
# best-effort 推送（含 abs_path 与不阻塞）。
# ────────────────────────────────────────────────────────────────────────────


async def test_cross_workspace_repo_404(
    client: AsyncClient,
    db_session: AsyncSession,
    auth_headers: dict[str, str],
) -> None:
    """A 工作区前缀操作 B 工作区的关联仓 → 404（IDOR 修复回归）。"""
    ws_a, _, _ = await _seed(db_session, tag="a")
    ws_b, _, _ = await _seed(db_session, tag="b")
    base_a = f"/api/workspaces/{ws_a.id}/linked-repos"
    base_b = f"/api/workspaces/{ws_b.id}/linked-repos"
    repo_b = ((await client.post(base_b, json={"name": "b-repo"}, headers=auth_headers)).json())[
        "id"
    ]

    resp = await client.patch(f"{base_a}/{repo_b}", json={"description": "x"}, headers=auth_headers)
    assert resp.status_code == 404
    resp = await client.delete(f"{base_a}/{repo_b}", headers=auth_headers)
    assert resp.status_code == 404
    resp = await client.put(f"{base_a}/{repo_b}/my-path", json={"path": "x"}, headers=auth_headers)
    assert resp.status_code == 404
    # B 仓原样未被破坏
    resp = await client.get(base_b, headers=auth_headers)
    assert resp.json()[0]["name"] == "b-repo"


async def test_patch_explicit_null_clears(
    client: AsyncClient,
    db_session: AsyncSession,
    auth_headers: dict[str, str],
) -> None:
    """PATCH JSON null=显式清除；缺省键=不动（exclude_unset 语义）。"""
    ws, _, _ = await _seed(db_session)
    base = f"/api/workspaces/{ws.id}/linked-repos"
    repo_id = (
        (
            await client.post(
                base,
                json={"name": "n", "description": "保留", "rel_path": "../n"},
                headers=auth_headers,
            )
        ).json()
    )["id"]

    resp = await client.patch(f"{base}/{repo_id}", json={"description": None}, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["description"] is None  # 显式 null → 清除
    assert body["rel_path"] == "../n"  # 缺省 → 不动


async def test_best_effort_push_after_create(
    client: AsyncClient,
    db_session: AsyncSession,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """create 成功后向绑定机器 best-effort 推送（payload 含该成员 abs_path），
    且不阻塞 CRUD 响应。"""
    import app.modules.daemon.ws_hub as ws_hub_mod
    from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

    ws, user, machine = await _seed(db_session)
    actor = user.id
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

    hub = AsyncMock()
    hub.send_rpc = AsyncMock(return_value={})
    monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: hub)

    base = f"/api/workspaces/{ws.id}/linked-repos"
    resp = await client.post(base, json={"name": "fe"}, headers=auth_headers)
    assert resp.status_code == 201  # 不被推送阻塞

    # fire-and-forget 任务由事件循环调度——让步后断言被调且 payload 带 abs_path 通道。
    import asyncio

    await asyncio.sleep(0.05)
    assert hub.send_rpc.await_count >= 1
    payload = hub.send_rpc.await_args.args[2]
    assert payload["repos"][0]["name"] == "fe"
    assert "abs_path" in payload["repos"][0]


# ────────────────────────────────────────────────────────────────────────────
# task-02/03（2026-10-10-linked-repos-local-echo）：快照端点 + 导入端点 HTTP 面。
# ────────────────────────────────────────────────────────────────────────────


async def test_local_snapshot_http_binding_missing(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict[str, str]
) -> None:
    ws, _, _ = await _seed(db_session, tag="snap")
    resp = await client.get(
        f"/api/workspaces/{ws.id}/linked-repos/local-snapshot", headers=auth_headers
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "binding_missing"


async def test_local_snapshot_http_offline_degrade(
    client: AsyncClient,
    db_session: AsyncSession,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """daemon 离线 → 结构化 daemon_offline（200 非 5xx，FR-02）。"""
    import app.modules.daemon.linked_repos_sync as sync_mod

    async def boom(*args, **kwargs):
        raise RuntimeError("offline")

    monkeypatch.setattr(sync_mod, "fetch_local_snapshot", boom)
    ws, _, _ = await _seed(db_session, tag="snap2")
    resp = await client.get(
        f"/api/workspaces/{ws.id}/linked-repos/local-snapshot", headers=auth_headers
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "daemon_offline"


async def test_import_http_double_landing_and_idempotent(
    client: AsyncClient,
    db_session: AsyncSession,
    auth_headers: dict[str, str],
) -> None:
    """Gap A 合并条目一次导入双落地（rel_path+my_path）；二次导入全 skipped（幂等）。"""
    ws, _user, _ = await _seed(db_session, tag="imp")
    base = f"/api/workspaces/{ws.id}/linked-repos"
    resp = await client.post(
        f"{base}/import",
        json={"entries": [{"name": "demo", "rel_path": "../demo", "abs_path": "C:/works/demo"}]},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["results"] == [{"name": "demo", "result": "imported", "detail": None}]

    items = (await client.get(base, headers=auth_headers)).json()
    demo = next(i for i in items if i["name"] == "demo")
    assert demo["rel_path"] == "../demo"
    assert demo["my_path"] == "C:/works/demo"  # admin=导入者=本人 my_path

    resp = await client.post(
        f"{base}/import",
        json={"entries": [{"name": "demo", "rel_path": "../demo", "abs_path": "C:/works/demo"}]},
        headers=auth_headers,
    )
    assert resp.json()["results"][0]["result"] == "skipped"


async def test_import_http_per_entry_independent(
    client: AsyncClient, db_session: AsyncSession, auth_headers: dict[str, str]
) -> None:
    """逐条独立成败：合法+非法名混合，非法条 failed 不影响合法条。"""
    ws, _, _ = await _seed(db_session, tag="imp2")
    base = f"/api/workspaces/{ws.id}/linked-repos"
    resp = await client.post(
        f"{base}/import",
        json={"entries": [{"name": "ok-repo"}, {"name": "bad name!"}]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    results = {r["name"]: r["result"] for r in resp.json()["results"]}
    assert results["ok-repo"] == "imported"
    assert results["bad name!"] == "failed"


async def test_import_http_member_forbidden(client: AsyncClient, db_session: AsyncSession) -> None:
    token = await _regular_user_token(db_session, email="snap-member@example.com")
    ws, _, _ = await _seed(db_session, tag="imp3")
    resp = await client.post(
        f"/api/workspaces/{ws.id}/linked-repos/import",
        json={"entries": [{"name": "x"}]},
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 403


async def test_import_triggers_best_effort_push(
    client: AsyncClient,
    db_session: AsyncSession,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """G1：导入成功触发 best-effort 推送（复用 create 先例断言）。"""
    import asyncio

    import app.modules.daemon.ws_hub as ws_hub_mod
    from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

    ws, _user, machine = await _seed(db_session, tag="impp")
    db_session.add(
        WorkspaceMemberRuntime(
            workspace_id=ws.id,
            user_id=_user.id,
            daemon_id=machine.id,
            root_path="/ws",
            path_source="manual",
        )
    )
    await db_session.commit()
    hub = AsyncMock()
    hub.send_rpc = AsyncMock(return_value={})
    monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: hub)

    resp = await client.post(
        f"/api/workspaces/{ws.id}/linked-repos/import",
        json={"entries": [{"name": "pushed", "rel_path": "../pushed"}]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    await asyncio.sleep(0.05)
    assert hub.send_rpc.await_count >= 1


async def test_local_snapshot_http_unsupported(
    client: AsyncClient,
    db_session: AsyncSession,
    auth_headers: dict[str, str],
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """G2：daemon_unsupported 的 HTTP 层穿透（method_not_found → 200 结构化）。"""
    from sqlalchemy import select as _select

    from app.modules.auth.model import User
    from app.modules.daemon.runtime.service import DaemonRpcRemoteError
    from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

    ws, _, machine = await _seed(db_session, tag="unsup")
    # binding 挂到请求者（admin token 用户）——fetch_local_snapshot 按 actor 路由机器
    admin = (
        (await db_session.execute(_select(User).where(User.email == "admin@example.com")))
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

    hub = AsyncMock()
    hub.send_rpc = AsyncMock(side_effect=DaemonRpcRemoteError({"code": "method_not_found"}))
    import app.modules.daemon.ws_hub as ws_hub_mod

    monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: hub)

    resp = await client.get(
        f"/api/workspaces/{ws.id}/linked-repos/local-snapshot", headers=auth_headers
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "daemon_unsupported"
