"""HTTP-level tests for the workspace router.

2026-08-18-workspace-role-type task-08：``WorkspaceCreate.type`` 收 8 值受控词表
必填（D-002@v1），本文件 POST /api/workspaces 请求体统一补 ``type: "other"``
入参；PATCH 的 ``type: "service"`` 旧值换 ``backend-code``（YAML_TYPE_NORMALIZE_MAP
语义等价迁移）。均为设计内破坏面如实登记，非为通过而改断言语义。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select

# Import to register workspace_member_runtimes in BaseModel.metadata.
from app.modules.workspace.member_runtimes import model as _wmr_model  # noqa: F401


def _make_workspace(tmp_path: Path, name: str = "workspace") -> Path:
    base = tmp_path / name / ".sillyspec"
    (base / "projects").mkdir(parents=True)
    (base / "changes" / "change").mkdir(parents=True)
    (base / "changes" / "archive").mkdir(parents=True)
    return tmp_path / name


@pytest.fixture()
def workspace_root(tmp_path: Path) -> Path:
    return _make_workspace(tmp_path)


async def test_scan_endpoint_minimal_fixture(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    fixture = Path(__file__).parent / "fixtures" / "minimal-sillyspec"
    resp = await client.post(
        "/api/workspaces/scan",
        json={"root_path": str(fixture)},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["is_sillyspec"] is True
    assert body["warnings"] == []


async def test_scan_endpoint_path_not_found(
    client: AsyncClient, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    resp = await client.post(
        "/api/workspaces/scan",
        json={"root_path": str(tmp_path / "no-such")},
        headers=auth_headers,
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "HTTP_400_WORKSPACE_PATH_NOT_FOUND"


async def test_scan_strips_invisible_unicode(
    client: AsyncClient, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    """Path with U+202A (Left-to-Right Embedding) prefix should be stripped."""
    fixture = Path(__file__).parent / "fixtures" / "minimal-sillyspec"
    dirty_path = "‪" + str(fixture)
    resp = await client.post(
        "/api/workspaces/scan",
        json={"root_path": dirty_path},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text


async def test_scan_strips_trailing_whitespace(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """Trailing spaces/newlines in root_path should be stripped."""
    fixture = Path(__file__).parent / "fixtures" / "minimal-sillyspec"
    dirty_path = str(fixture) + "  \n"
    resp = await client.post(
        "/api/workspaces/scan",
        json={"root_path": dirty_path},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text


async def test_scan_endpoint_returns_no_sillyspec_for_plain_dir(
    client: AsyncClient, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    resp = await client.post(
        "/api/workspaces/scan",
        json={"root_path": str(tmp_path)},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["is_sillyspec"] is False
    assert "no_sillyspec_dir" in body["warnings"]


async def test_create_then_list(
    client: AsyncClient, workspace_root: Path, auth_headers: dict[str, str]
) -> None:
    create = await client.post(
        "/api/workspaces",
        json={"name": "Test Space", "root_path": str(workspace_root), "type": "other"},
        headers=auth_headers,
    )
    assert create.status_code == 201, create.text
    created = create.json()
    assert created["slug"] == "test-space"
    assert created["status"] == "active"

    listing = await client.get("/api/workspaces", headers=auth_headers)
    assert listing.status_code == 200
    payload = listing.json()
    assert payload["total"] == 1
    assert payload["items"][0]["id"] == created["id"]


async def test_create_duplicate_returns_existing(
    client: AsyncClient, workspace_root: Path, auth_headers: dict[str, str]
) -> None:
    first = await client.post(
        "/api/workspaces",
        json={"name": "A", "root_path": str(workspace_root), "type": "other"},
        headers=auth_headers,
    )
    assert first.status_code == 201
    # quick ql-20260803-003-cb34：新建无复用提示。
    assert first.json().get("creation_notice") is None
    # Same root_path returns the existing workspace
    second = await client.post(
        "/api/workspaces",
        json={"name": "B", "root_path": str(workspace_root), "type": "other"},
        headers=auth_headers,
    )
    assert second.status_code == 201
    assert second.json()["id"] == first.json()["id"]
    # quick ql-20260803-003-cb34：复用必须带用户可读提示，不能静默返回。
    assert "复用" in second.json().get("creation_notice", "")


async def test_rescan_updates_last_scanned_at(
    client: AsyncClient, workspace_root: Path, auth_headers: dict[str, str]
) -> None:

    create = await client.post(
        "/api/workspaces",
        json={"name": "Rescan Target", "root_path": str(workspace_root), "type": "other"},
        headers=auth_headers,
    )
    workspace_id = create.json()["id"]
    original_ts = create.json()["last_scanned_at"]
    assert original_ts is not None

    # D-005: rescan 读服务器 spec_root（扁平根，无 .sillyspec 包裹）。
    # WorkspaceScanner 判定 spec_root 下 projects/ 或 changes/ 存在 → is_sillyspec=True。
    from pathlib import Path

    from app.core.config import get_settings

    spec_root = Path(get_settings().spec_data_root) / workspace_id
    (spec_root / "projects").mkdir(parents=True, exist_ok=True)
    (spec_root / "changes").mkdir(parents=True, exist_ok=True)

    rescan = await client.post(
        f"/api/workspaces/{workspace_id}/rescan",
        headers=auth_headers,
    )
    assert rescan.status_code == 200
    body = rescan.json()
    assert body["is_sillyspec"] is True

    detail = await client.get(f"/api/workspaces/{workspace_id}", headers=auth_headers)
    assert detail.status_code == 200
    assert detail.json()["last_scanned_at"] >= original_ts


async def test_soft_delete_hides_from_default_list(
    client: AsyncClient, workspace_root: Path, auth_headers: dict[str, str]
) -> None:
    create = await client.post(
        "/api/workspaces",
        json={"name": "Doomed", "root_path": str(workspace_root), "type": "other"},
        headers=auth_headers,
    )
    workspace_id = create.json()["id"]

    del_resp = await client.delete(
        f"/api/workspaces/{workspace_id}",
        headers=auth_headers,
    )
    assert del_resp.status_code == 200
    assert del_resp.json()["status"] == "deleted"

    default_list = await client.get("/api/workspaces", headers=auth_headers)
    assert default_list.json()["total"] == 0

    admin_list = await client.get(
        "/api/workspaces?include_deleted=true",
        headers=auth_headers,
    )
    assert admin_list.json()["total"] == 1

    detail = await client.get(f"/api/workspaces/{workspace_id}", headers=auth_headers)
    assert detail.status_code == 404


async def test_create_validates_slug_format(
    client: AsyncClient, workspace_root: Path, auth_headers: dict[str, str]
) -> None:
    resp = await client.post(
        "/api/workspaces",
        json={"name": "x", "slug": "Bad Slug!", "root_path": str(workspace_root), "type": "other"},
        headers=auth_headers,
    )
    assert resp.status_code == 422


# ── PATCH tests (task-09) ───────────────────────────────────────────────


async def _create_workspace(
    client: AsyncClient, workspace_root: Path, auth_headers: dict[str, str]
) -> dict:
    """Helper: create a workspace and return the JSON body."""
    resp = await client.post(
        "/api/workspaces",
        json={"name": "Patch Target", "root_path": str(workspace_root), "type": "other"},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def test_patch_updates_name(
    client: AsyncClient, workspace_root: Path, auth_headers: dict[str, str]
) -> None:
    """AC-01: PATCH updates name, returns 200 with new name."""
    created = await _create_workspace(client, workspace_root, auth_headers)
    ws_id = created["id"]

    resp = await client.patch(
        f"/api/workspaces/{ws_id}",
        json={"name": "New Name"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "New Name"
    assert body["id"] == ws_id


async def test_patch_updates_multiple_fields(
    client: AsyncClient, workspace_root: Path, auth_headers: dict[str, str]
) -> None:
    """AC-02: PATCH updates several metadata fields at once."""
    created = await _create_workspace(client, workspace_root, auth_headers)
    ws_id = created["id"]

    resp = await client.patch(
        f"/api/workspaces/{ws_id}",
        json={
            "name": "Multi Update",
            "component_key": "backend-api",
            # 2026-08-18-workspace-role-type：type 收 8 值词表，原 "service" 旧值
            # 经 YAML_TYPE_NORMALIZE_MAP 语义对应 backend-code（破坏面改写）。
            "type": "backend-code",
            "role": "api-gateway",
            "tech_stack": ["python", "fastapi", "postgresql"],
            "build_command": "make build",
            "test_command": "make test",
        },
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == "Multi Update"
    assert body["component_key"] == "backend-api"
    assert body["type"] == "backend-code"
    assert body["role"] == "api-gateway"
    assert body["tech_stack"] == ["python", "fastapi", "postgresql"]
    assert body["build_command"] == "make build"
    assert body["test_command"] == "make test"


async def test_patch_not_found(client: AsyncClient, auth_headers: dict[str, str]) -> None:
    """AC-03: PATCH a non-existent workspace returns 404."""
    import uuid

    fake_id = str(uuid.uuid4())
    resp = await client.patch(
        f"/api/workspaces/{fake_id}",
        json={"name": "Does Not Matter"},
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_patch_no_auth(
    client: AsyncClient, workspace_root: Path, auth_headers: dict[str, str]
) -> None:
    """AC-04: PATCH without authentication returns 401."""
    created = await _create_workspace(client, workspace_root, auth_headers)
    ws_id = created["id"]

    resp = await client.patch(
        f"/api/workspaces/{ws_id}",
        json={"name": "Should Fail"},
    )
    assert resp.status_code == 401


async def test_patch_empty_body_is_idempotent(
    client: AsyncClient, workspace_root: Path, auth_headers: dict[str, str]
) -> None:
    """AC-05: PATCH with no fields returns 200 with original values."""
    created = await _create_workspace(client, workspace_root, auth_headers)
    ws_id = created["id"]

    resp = await client.patch(
        f"/api/workspaces/{ws_id}",
        json={},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["name"] == created["name"]
    assert body["slug"] == created["slug"]
    assert body["root_path"] == created["root_path"]


async def test_patch_rejects_empty_name(
    client: AsyncClient, workspace_root: Path, auth_headers: dict[str, str]
) -> None:
    """Boundary: name as empty string should be rejected with 422."""
    created = await _create_workspace(client, workspace_root, auth_headers)
    ws_id = created["id"]

    resp = await client.patch(
        f"/api/workspaces/{ws_id}",
        json={"name": ""},
        headers=auth_headers,
    )
    assert resp.status_code == 422


async def test_patch_validates_slug_format(
    client: AsyncClient, workspace_root: Path, auth_headers: dict[str, str]
) -> None:
    """Boundary: invalid slug format should be rejected with 422."""
    created = await _create_workspace(client, workspace_root, auth_headers)
    ws_id = created["id"]

    resp = await client.patch(
        f"/api/workspaces/{ws_id}",
        json={"slug": "Bad Slug!"},
        headers=auth_headers,
    )
    assert resp.status_code == 422


async def test_patch_slug_immutable_returns_400(
    client: AsyncClient, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    """Boundary: slug 创建后不可修改——改不同值返回 400（ql-20260826-007-8666）。

    旧语义（改 slug 撞他人占用返 409）随不可变语义废弃：现在无论目标 slug
    是否被占用，只要是「不同值」一律 400 slug_immutable。
    """
    root1 = _make_workspace(tmp_path, "ws-a")
    resp1 = await client.post(
        "/api/workspaces",
        json={"name": "WS A", "root_path": str(root1), "type": "other"},
        headers=auth_headers,
    )
    assert resp1.status_code == 201
    ws_a_slug = resp1.json()["slug"]  # "ws-a"

    root2 = _make_workspace(tmp_path, "ws-b")
    resp2 = await client.post(
        "/api/workspaces",
        json={"name": "WS B", "root_path": str(root2), "type": "other"},
        headers=auth_headers,
    )
    assert resp2.status_code == 201
    ws_b_id = resp2.json()["id"]

    # Try to update WS B's slug to WS A's slug → immutable 400（不是 409）
    resp = await client.patch(
        f"/api/workspaces/{ws_b_id}",
        json={"slug": ws_a_slug},
        headers=auth_headers,
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "HTTP_400_WORKSPACE_SLUG_IMMUTABLE"

    # 改成未被占用的全新 slug 同样拒绝
    resp_free = await client.patch(
        f"/api/workspaces/{ws_b_id}",
        json={"slug": "totally-free-slug"},
        headers=auth_headers,
    )
    assert resp_free.status_code == 400
    assert resp_free.json()["code"] == "HTTP_400_WORKSPACE_SLUG_IMMUTABLE"


async def test_patch_slug_same_value_is_noop(
    client: AsyncClient, workspace_root: Path, auth_headers: dict[str, str]
) -> None:
    """Boundary: 显式重传当前 slug 视为幂等 no-op，200 放行不误伤。"""
    created = await _create_workspace(client, workspace_root, auth_headers)
    ws_id = created["id"]

    resp = await client.patch(
        f"/api/workspaces/{ws_id}",
        json={"slug": created["slug"]},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["slug"] == created["slug"]


# ── PATCH status 状态维护（ql-20260829-008）──────────────────────────────


async def test_patch_status_archive_and_restore(
    client: AsyncClient, workspace_root: Path, auth_headers: dict[str, str]
) -> None:
    """active→archived→active 日常维护主路径；归档后 ?status=archived 可检索。"""
    created = await _create_workspace(client, workspace_root, auth_headers)
    ws_id = created["id"]
    assert created["status"] == "active"

    resp = await client.patch(
        f"/api/workspaces/{ws_id}",
        json={"status": "archived"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["status"] == "archived"

    listed = await client.get(
        "/api/workspaces", params={"status": "archived"}, headers=auth_headers
    )
    assert listed.status_code == 200, listed.text
    assert ws_id in {item["id"] for item in listed.json()["items"]}

    restore = await client.patch(
        f"/api/workspaces/{ws_id}",
        json={"status": "active"},
        headers=auth_headers,
    )
    assert restore.status_code == 200, restore.text
    assert restore.json()["status"] == "active"


async def test_patch_status_rejects_non_maintainable_values(
    client: AsyncClient, workspace_root: Path, auth_headers: dict[str, str]
) -> None:
    """pending/deleted/乱值 → 422：pending 走激活流程、deleted 走软删端点，不开放 PATCH。"""
    created = await _create_workspace(client, workspace_root, auth_headers)
    ws_id = created["id"]

    for bad in ("pending", "deleted", "bogus"):
        resp = await client.patch(
            f"/api/workspaces/{ws_id}",
            json={"status": bad},
            headers=auth_headers,
        )
        assert resp.status_code == 422, f"status={bad} 应 422，实际 {resp.status_code}"


async def test_patch_status_pending_to_active_runs_activate_bootstrap(
    db_session,
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    """pending→active 经 PATCH 传入时委托 activate 引导语义——last_scanned_at 被
    置值（裸写 status 列不会碰它），防 PATCH 直改绕过 spec bootstrap。"""
    from app.modules.workspace.model import Workspace

    ws = Workspace(
        id=uuid.uuid4(),
        name="pending-patch-ws",
        slug=f"pending-{uuid.uuid4().hex[:8]}",
        root_path="/tmp/pending-patch",
        status="pending",
    )
    db_session.add(ws)
    await db_session.commit()

    resp = await client.patch(
        f"/api/workspaces/{ws.id}",
        json={"status": "active"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "active"
    assert body["last_scanned_at"] is not None, (
        "pending→active 应走 activate 引导（置 last_scanned_at），而非裸写列"
    )


# ── Init endpoint (POST /{workspace_id}/init) ──────────────────────────────


async def test_init_endpoint_returns_lease(
    db_session,
    client: AsyncClient,
    auth_headers: dict[str, str],
) -> None:
    """POST /api/workspaces/{workspace_id}/init creates an init-mode batch lease
    (kind='batch', metadata.mode='init') and returns lease_id / runtime_id / claim_token.

    This is the HTTP-level integration test complementing the service-level
    coverage in test_start_init_dispatch.py.
    """
    from app.modules.auth.model import User
    from app.modules.daemon.model import DaemonInstance, DaemonRuntime
    from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
    from app.modules.workspace.model import Workspace

    # ── seed data ───────────────────────────────────────────────────────
    ws = Workspace(
        id=uuid.uuid4(),
        name="init-test-ws",
        slug=f"init-{uuid.uuid4().hex[:8]}",
        root_path="/tmp/init-test",
        status="active",
    )
    db_session.add(ws)

    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None, "admin user must exist (auth_admin_token fixture)"

    # Create DaemonInstance first (task-09: binding target)
    di = DaemonInstance(
        id=uuid.uuid4(),
        user_id=admin.id,
        hostname="test-host",
        server_url="http://localhost:8000",
        status="online",
    )
    db_session.add(di)

    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=admin.id,
        daemon_instance_id=di.id,
        name="init-test-daemon",
        provider="claude_code",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)

    db_session.add(
        WorkspaceMemberRuntime(
            workspace_id=ws.id,
            user_id=admin.id,
            daemon_id=di.id,
            runtime_id=rt.id,
            root_path="/Users/admin/project",
            path_source="daemon-client",
        )
    )
    await db_session.commit()

    # ── act ─────────────────────────────────────────────────────────────
    resp = await client.post(
        f"/api/workspaces/{ws.id}/init",
        headers=auth_headers,
    )

    # ── assert ──────────────────────────────────────────────────────────
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "lease_id" in body, f"Missing lease_id in {body}"
    assert "runtime_id" in body, f"Missing runtime_id in {body}"
    assert "claim_token" in body, f"Missing claim_token in {body}"
    # Validate UUIDs
    assert uuid.UUID(body["lease_id"])
    assert uuid.UUID(body["runtime_id"])
    # claim_token is secrets.token_hex(32) → 64 hex chars
    assert len(body["claim_token"]) == 64, f"claim_token length: {len(body['claim_token'])}"
    # lease is pending, kind='batch'（daemon 端 init lease 走 task-runner batch
    # runLease 探测 mode='init'；kind='interactive' 会被 interactive handler 拒，
    # 见 b5dda23f8 + daemon task-runner.ts:378）。
    from app.modules.daemon.model import DaemonTaskLease

    lease = (
        (
            await db_session.execute(
                select(DaemonTaskLease).where(DaemonTaskLease.id == uuid.UUID(body["lease_id"]))
            )
        )
        .scalars()
        .first()
    )
    assert lease is not None
    assert lease.status == "pending"
    assert lease.kind == "batch"
    assert lease.runtime_id == rt.id
