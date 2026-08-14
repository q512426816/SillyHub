"""platform_sync 鉴权收紧测试（security-audit-remediation task-06 / D-004@v1 / FR-05）。

三路径分流语义变更（design §3 段3）：

- **写端点**（POST progress/documents/approval）：仅 ``shpsync_`` token 可写（token
  派生 workspace_id 是唯一写归属通道）；``shk_live_`` / JWT 凭据**有效也 403**——
  401 仍保留给无/坏凭据（constraints：403 只用于「有效凭据但写通道关闭」）。
- **读端点**（GET changes / progress / approval）：``shk_live_`` / JWT 从全局桶
  （workspace_id=None）改为按 ``allowed_workspace_ids(user, CHANGE_READ)``（rbac.py）
  工作区**并集聚合**，NULL 桶存量行并入只读兼容；platform_admin 视角 = 全 workspace
  并集。``shpsync_`` 读路径行为逐字节回归（收件箱隔离不变，acceptance）。

先写失败用例（TDD）：本文件在实现改动前全部红（写端点 200 → 期望 403；JWT 读全局
→ 期望只见自己有权限的 workspace）。
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.platform_sync.model import PlatformChangeProgressORM
from app.modules.workspace.model import Workspace

T1 = "2026-08-10T13:00:00.000Z"
T2 = "2026-08-10T13:45:00.000Z"

SAMPLE_PROGRESS: dict = {
    "project": {"name": "demo"},
    "changes": [
        {"name": "sec-tighten-change", "current_stage": "execute", "status": "in_progress"}
    ],
    "stages": [],
    "steps": [],
    "batch_progress": [],
    "approvals": [],
}

DOCS: dict = {
    "proposal.md": "# proposal 收紧测试",
    "design.md": "# design 收紧测试",
    "tasks.md": "# tasks 收紧测试",
}


# ── 测试数据 helpers ───────────────────────────────────────────────────────────


async def _make_workspace(session: AsyncSession, tag: str) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{tag}-{uuid.uuid4().hex[:6]}",
        slug=f"ws-{tag}-{uuid.uuid4().hex[:6]}",
        root_path=f"/tmp/ws-{tag}-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _make_user(session: AsyncSession, *, admin: bool) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"sec-{uuid.uuid4().hex[:6]}@example.com",
        password_hash=password_hasher.hash("x"),
        status="active",
        is_platform_admin=admin,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


def _jwt_headers(user: User) -> dict[str, str]:
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return {"Authorization": f"Bearer {token}"}


async def _grant_change_read(session: AsyncSession, *, user: User, ws: Workspace) -> None:
    """建带 change:read 的 Role + workspace 绑定（allowed_workspace_ids 可命中的最小角色）。"""
    role = Role(
        id=uuid.uuid4(),
        key=f"reader-{uuid.uuid4().hex[:8]}",
        name="Change Reader",
        is_system=False,
        is_active=True,
    )
    session.add(role)
    session.add(RolePermission(role_id=role.id, permission="change:read"))
    session.add(UserWorkspaceRole(user_id=user.id, workspace_id=ws.id, role_id=role.id))
    await session.commit()


async def _seed_progress_row(
    session: AsyncSession,
    workspace_id: uuid.UUID | None,
    name: str,
    pushed_at: str = T1,
) -> None:
    """直插 platform_change_progress 行（读端点聚合可见性的种子数据，不走被测端点）。"""
    body = {
        "project": {"name": name},
        "changes": [{"name": name, "current_stage": "execute", "status": "in_progress"}],
        "stages": [],
        "steps": [],
        "batch_progress": [],
        "approvals": [],
    }
    session.add(
        PlatformChangeProgressORM(
            id=uuid.uuid4(),
            workspace_id=workspace_id,
            change_name=name,
            latest_progress=body,
            last_pushed_at=pushed_at,
            last_pusher="seed",
        )
    )
    await session.commit()


# ── 写端点 403（D-004@v1：仅 shpsync_ 可写）────────────────────────────────────


async def test_jwt_post_progress_403(client: Any, auth_headers: dict[str, str]) -> None:
    """合法 JWT（平台 admin 签发）POST progress → 403（全局桶写通道关闭，FR-05）。"""
    resp = await client.post(
        "/api/changes/sec-c/progress",
        json=SAMPLE_PROGRESS,
        headers={**auth_headers, "X-SillySpec-Pushed-At": T1},
    )
    assert resp.status_code == 403


async def test_jwt_post_documents_403(client: Any, auth_headers: dict[str, str]) -> None:
    """合法 JWT POST documents → 403。"""
    resp = await client.post("/api/changes/sec-c/documents", json=DOCS, headers=auth_headers)
    assert resp.status_code == 403


async def test_jwt_post_approval_403(client: Any, auth_headers: dict[str, str]) -> None:
    """合法 JWT POST approval → 403。"""
    resp = await client.post(
        "/api/changes/sec-c/approval",
        json={"decision": "approved"},
        headers=auth_headers,
    )
    assert resp.status_code == 403


async def test_apikey_post_documents_403(client: Any, apikey_headers: dict[str, str]) -> None:
    """合法 shk_live_ API Key POST documents → 403（任务卡：shk_live_ POST documents 403）。"""
    resp = await client.post("/api/changes/sec-c/documents", json=DOCS, headers=apikey_headers)
    assert resp.status_code == 403


async def test_apikey_post_progress_403(client: Any, apikey_headers: dict[str, str]) -> None:
    """合法 shk_live_ API Key POST progress → 403。"""
    resp = await client.post(
        "/api/changes/sec-c/progress",
        json=SAMPLE_PROGRESS,
        headers=apikey_headers,
    )
    assert resp.status_code == 403


async def test_apikey_post_approval_403(client: Any, apikey_headers: dict[str, str]) -> None:
    """合法 shk_live_ API Key POST approval → 403。"""
    resp = await client.post(
        "/api/changes/sec-c/approval",
        json={"decision": "approved"},
        headers=apikey_headers,
    )
    assert resp.status_code == 403


async def test_bad_token_post_progress_still_401(client: Any) -> None:
    """401 语义不变：坏 token（前缀合法但内容错）→ 401 而非 403（constraints）。"""
    resp = await client.post(
        "/api/changes/sec-c/progress",
        json=SAMPLE_PROGRESS,
        headers={"Authorization": "Bearer shpsync_not-a-real-token"},
    )
    assert resp.status_code == 401


# ── shpsync_ 三写端点回归绿（acceptance：200/409 冲突语义保持）─────────────────


async def test_shpsync_post_progress_ok(client: Any, shpsync_headers: Any) -> None:
    """shpsync_ POST progress → 200（唯一写通道保持，CLI 契约不破坏）。"""
    _ws_id, headers = shpsync_headers
    resp = await client.post(
        "/api/changes/sec-c/progress",
        json=SAMPLE_PROGRESS,
        headers={**headers, "X-SillySpec-Pushed-At": T1},
    )
    assert resp.status_code == 200


async def test_shpsync_post_documents_ok(client: Any, shpsync_headers: Any) -> None:
    """shpsync_ POST documents → 200 {synced, change_name}。"""
    _ws_id, headers = shpsync_headers
    resp = await client.post("/api/changes/sec-doc-c/documents", json=DOCS, headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {"synced": 3, "change_name": "sec-doc-c"}


async def test_shpsync_post_approval_ok(client: Any, shpsync_headers: Any) -> None:
    """shpsync_ POST approval → 200（rejected 可写回，CLI execute 硬阻断链路保持）。"""
    _ws_id, headers = shpsync_headers
    resp = await client.post(
        "/api/changes/sec-ap-c/approval",
        json={"decision": "rejected", "reason": "安全收紧回归"},
        headers=headers,
    )
    assert resp.status_code == 200
    got = await client.get("/api/changes/sec-ap-c/approval", headers=headers)
    assert got.status_code == 200
    assert got.json()["status"] == "rejected"


async def test_shpsync_conflict_409_semantics_kept(client: Any, shpsync_headers: Any) -> None:
    """shpsync_ 写路径 §4.2 冲突语义回归：stored(T2) > base(T1) → 409。"""
    _ws_id, headers = shpsync_headers
    first = await client.post(
        "/api/changes/sec-conf-c/progress",
        json=SAMPLE_PROGRESS,
        headers={**headers, "X-SillySpec-Pushed-At": T2},
    )
    assert first.status_code == 200
    resp = await client.post(
        "/api/changes/sec-conf-c/progress",
        json=SAMPLE_PROGRESS,
        headers={**headers, "X-SillySpec-Base-Ts": T1, "X-SillySpec-Pushed-At": T2},
    )
    assert resp.status_code == 409


async def test_shpsync_read_inbox_isolation_unchanged(
    client: Any, db_session: AsyncSession, shpsync_headers: Any
) -> None:
    """shpsync_ GET /changes 只见 token 绑定 workspace 行（NULL 桶 / 他人 ws 不可见）。"""
    ws_id, headers = shpsync_headers
    await _seed_progress_row(db_session, ws_id, "own-c")
    await _seed_progress_row(db_session, None, "null-bucket-c")
    other_ws = await _make_workspace(db_session, "other")
    await _seed_progress_row(db_session, other_ws.id, "other-c")

    lst = await client.get("/api/changes", headers=headers)
    assert lst.status_code == 200
    names = [it["name"] for it in lst.json()]
    assert names == ["own-c"]


# ── 读端点并集聚合（JWT：CHANGE_READ workspace 并集 + NULL 桶）──────────────────


async def test_jwt_read_union_scoped_to_change_read_workspaces(
    client: Any, db_session: AsyncSession
) -> None:
    """JWT GET /changes 只见自己有 CHANGE_READ 权限的 ws 的 change（acceptance 核心）。

    造两个 workspace：ws-granted（授 change:read）与 ws-denied（无任何角色），
    各 seeded 一行 progress；再种一行 NULL 桶（存量只读兼容，并入可见）。
    断言：列表含 granted + NULL 两行、不含 denied 行。
    """
    user = await _make_user(db_session, admin=False)
    ws_granted = await _make_workspace(db_session, "granted")
    ws_denied = await _make_workspace(db_session, "denied")
    await _grant_change_read(db_session, user=user, ws=ws_granted)

    await _seed_progress_row(db_session, ws_granted.id, "granted-c")
    await _seed_progress_row(db_session, ws_denied.id, "denied-c")
    await _seed_progress_row(db_session, None, "null-bucket-c")

    lst = await client.get("/api/changes", headers=_jwt_headers(user))
    assert lst.status_code == 200
    names = {it["name"] for it in lst.json()}
    assert "granted-c" in names  # 有 CHANGE_READ 的 ws 可见
    assert "null-bucket-c" in names  # NULL 桶存量只读兼容并入（design §3 兼容策略）
    assert "denied-c" not in names  # 无权限 ws 不可见（改前全局聚合泄漏）


async def test_jwt_read_union_empty_roles_sees_only_null_bucket(
    client: Any, db_session: AsyncSession
) -> None:
    """无任何 workspace 角色的普通 JWT：只见 NULL 桶，不见任何 workspace 行。"""
    user = await _make_user(db_session, admin=False)
    ws = await _make_workspace(db_session, "norole")
    await _seed_progress_row(db_session, ws.id, "norole-c")
    await _seed_progress_row(db_session, None, "null-only-c")

    lst = await client.get("/api/changes", headers=_jwt_headers(user))
    assert lst.status_code == 200
    names = {it["name"] for it in lst.json()}
    assert names == {"null-only-c"}


async def test_jwt_get_progress_cross_workspace_404(client: Any, db_session: AsyncSession) -> None:
    """JWT GET progress 他人 workspace 的 change → 404（不存在与无权统一，D-001@v1）。"""
    user = await _make_user(db_session, admin=False)
    ws_denied = await _make_workspace(db_session, "denied2")
    await _seed_progress_row(db_session, ws_denied.id, "denied-c2")

    resp = await client.get("/api/changes/denied-c2/progress", headers=_jwt_headers(user))
    assert resp.status_code == 404


async def test_jwt_get_progress_own_union_200(client: Any, db_session: AsyncSession) -> None:
    """JWT GET progress 自己有 CHANGE_READ 的 ws 的 change → 200（并集聚合正向路径）。"""
    user = await _make_user(db_session, admin=False)
    ws = await _make_workspace(db_session, "granted2")
    await _grant_change_read(db_session, user=user, ws=ws)
    await _seed_progress_row(db_session, ws.id, "granted-c2", pushed_at=T2)

    resp = await client.get("/api/changes/granted-c2/progress", headers=_jwt_headers(user))
    assert resp.status_code == 200
    body = resp.json()
    assert body["project"] == {"name": "granted-c2"}
    assert body["last_pushed_at"] == T2


async def test_jwt_get_progress_null_bucket_200(client: Any, db_session: AsyncSession) -> None:
    """JWT GET progress NULL 桶存量行 → 200（NULL 行并入读并集，design §3 兼容策略）。"""
    user = await _make_user(db_session, admin=False)
    await _seed_progress_row(db_session, None, "legacy-null-c")

    resp = await client.get("/api/changes/legacy-null-c/progress", headers=_jwt_headers(user))
    assert resp.status_code == 200
    assert resp.json()["project"] == {"name": "legacy-null-c"}


async def test_jwt_get_approval_cross_workspace_invisible(
    client: Any, db_session: AsyncSession
) -> None:
    """JWT GET approval 他人 ws 的 rejected → 不读跨 workspace 记录（默认 approved 放行）。

    任务卡：「GET approval 读端点同样按并集聚合判定可见性（跨 workspace 的 change
    名不可读）」。语义上：行不可见 → 回落「无记录默认 approved」（不 404，CLI
    门控契约不破坏）；行可见（NULL 桶 / 有权限 ws）→ 真实 status。
    """
    user = await _make_user(db_session, admin=False)
    ws_denied = await _make_workspace(db_session, "denied3")
    denied_row = PlatformChangeProgressORM(
        id=uuid.uuid4(),
        workspace_id=ws_denied.id,
        change_name="denied-rejected-c",
        approval={"status": "rejected", "reason": "x"},
    )
    db_session.add(denied_row)
    await db_session.commit()

    resp = await client.get("/api/changes/denied-rejected-c/approval", headers=_jwt_headers(user))
    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"  # 不可见 → 默认放行，不泄漏 rejected

    # NULL 桶 rejected 存量行对读并集可见 → 真实 status
    null_row = PlatformChangeProgressORM(
        id=uuid.uuid4(),
        workspace_id=None,
        change_name="null-rejected-c",
        approval={"status": "rejected", "reason": "y"},
    )
    db_session.add(null_row)
    await db_session.commit()
    resp2 = await client.get("/api/changes/null-rejected-c/approval", headers=_jwt_headers(user))
    assert resp2.status_code == 200
    assert resp2.json()["status"] == "rejected"


async def test_admin_jwt_read_union_is_all_workspaces(
    client: Any, db_session: AsyncSession
) -> None:
    """platform_admin JWT：读并集 = 全 workspace（豁免语义与 RBAC 约定一致）。"""
    user = await _make_user(db_session, admin=True)
    ws = await _make_workspace(db_session, "adminsee")
    await _seed_progress_row(db_session, ws.id, "admin-c")
    await _seed_progress_row(db_session, None, "null-c")

    lst = await client.get("/api/changes", headers=_jwt_headers(user))
    assert lst.status_code == 200
    names = {it["name"] for it in lst.json()}
    assert "admin-c" in names
    assert "null-c" in names
