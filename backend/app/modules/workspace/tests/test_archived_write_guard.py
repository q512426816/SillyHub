"""归档工作区禁写守卫（ql-20260829-010）。

三写入口对 archived 工作区一律 409 ``HTTP_409_WORKSPACE_ARCHIVED``（中文提示 +
恢复路径指向详情页状态改回「活跃」，守卫统一收敛在 ``WorkspaceService.ensure_writable``）：

- 创建会话：POST /api/daemon/sessions（workspace 解析点，daemon/session/service.py）；
- 派发批量 agent run：POST /api/agent/workspaces/{id}/agent/runs（start_run，
  task/lease 校验之后、run 落库之前）；
- 发起变更：``ChangeWriterService.create_change`` 门禁（不存在 → 404 之后的
  第二道，先于 not-scanned 检查）。

unit 维度：``ensure_writable`` 对 active/pending 放行（pending 是激活前过渡态，
激活引导本身可经 PATCH status 触发，ql-20260829-008）；仅 archived 拦截。

helper 风格对齐 test_machines_router.py（私有复刻 user/token/权限三件）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.errors import WorkspaceArchived
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import Role, RolePermission, User
from app.modules.auth.permissions import Permission
from app.modules.workspace.model import Workspace
from app.modules.workspace.service import WorkspaceService

# ── helpers（复刻 test_machines_router.py 同款风格）──────────────────────────


async def _create_user(
    session: AsyncSession,
    *,
    email: str | None = None,
) -> User:
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=email or f"user-{uid}@example.com",
        password_hash="irrelevant",
        display_name=f"User-{str(uid)[:4]}",
        status="active",
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


def _token_for(user: User) -> str:
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=settings,
    )
    return token


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _grant_platform_permission(
    session: AsyncSession, user_id: uuid.UUID, permission: Permission
) -> None:
    from app.modules.admin.model import UserRole

    role = Role(
        id=uuid.uuid4(),
        key=f"test-plat-{permission.value}-{uuid.uuid4().hex[:6]}",
        name=f"test {permission.value}",
    )
    session.add(role)
    await session.flush()
    session.add(RolePermission(role_id=role.id, permission=permission.value))
    session.add(UserRole(user_id=user_id, role_id=role.id))
    await session.commit()


async def _create_workspace(
    session: AsyncSession,
    *,
    status: str = "active",
    scanned: bool = True,
) -> Workspace:
    from datetime import UTC, datetime

    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"ws-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/ws-{uuid.uuid4().hex[:8]}",
        status=status,
        last_scanned_at=datetime.now(UTC) if scanned else None,
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


# ── unit：ensure_writable ------------------------------------------------------


def _mk_ws(status: str) -> Workspace:
    return Workspace(
        id=uuid.uuid4(),
        name="x",
        slug="x",
        root_path="/tmp/x",
        status=status,
    )


def test_ensure_writable_archived_raises_409() -> None:
    """archived → WorkspaceArchived（409，中文提示含恢复路径）。"""
    with pytest.raises(WorkspaceArchived) as exc_info:
        WorkspaceService.ensure_writable(_mk_ws("archived"))
    assert exc_info.value.http_status == 409
    assert "已归档" in exc_info.value.message
    assert "活跃" in exc_info.value.message


def test_ensure_writable_active_and_pending_pass() -> None:
    """active / pending 放行（pending 为激活前过渡态，不拦——ql-20260829-008）。"""
    WorkspaceService.ensure_writable(_mk_ws("active"))
    WorkspaceService.ensure_writable(_mk_ws("pending"))


# ── HTTP：创建会话 409 ---------------------------------------------------------


@pytest.mark.asyncio
async def test_session_create_on_archived_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    # 平台管理员旁路工作区可见性判定（仍要求 ws 行真实存在），直达归档守卫。
    user = await _create_user(db_session)
    user.is_platform_admin = True
    await db_session.commit()
    await _grant_platform_permission(db_session, user.id, Permission.TASK_RUN_AGENT)
    ws = await _create_workspace(db_session, status="archived")

    resp = await client.post(
        "/api/daemon/sessions",
        json={
            "provider": "claude",
            "prompt": "你好",
            "workspace_id": str(ws.id),
        },
        headers=_headers(_token_for(user)),
    )
    assert resp.status_code == 409, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_409_WORKSPACE_ARCHIVED"
    assert "已归档" in body["message"]


# ── HTTP：派发批量 agent run 409 -----------------------------------------------


@pytest.mark.asyncio
async def test_agent_run_create_on_archived_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    from app.modules.task.model import Task
    from app.modules.worktree.model import WorktreeLease

    user = await _create_user(db_session)
    await _grant_platform_permission(db_session, user.id, Permission.TASK_RUN_AGENT)
    ws = await _create_workspace(db_session, status="archived")
    task = Task(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        change_id=uuid.uuid4(),
        task_key="task-01",
        title="归档区任务",
    )
    db_session.add(task)
    lease = WorktreeLease(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        component_id=uuid.uuid4(),
        change_id=task.change_id,
        task_id=task.id,
        user_id=user.id,
        git_identity_id=uuid.uuid4(),
        path=f"/tmp/lease-{uuid.uuid4().hex[:8]}",
        branch_name="wt-test",
        status="locked",
        expires_at=datetime.now(UTC) + timedelta(hours=1),
    )
    db_session.add(lease)
    await db_session.commit()

    resp = await client.post(
        f"/api/workspaces/{ws.id}/agent/runs",
        json={"task_id": str(task.id), "lease_id": str(lease.id)},
        headers=_headers(_token_for(user)),
    )
    assert resp.status_code == 409, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_409_WORKSPACE_ARCHIVED"


# ── service：发起变更 409 ------------------------------------------------------


@pytest.mark.asyncio
async def test_change_create_on_archived_returns_409(
    db_session: AsyncSession,
) -> None:
    from app.modules.change_writer.service import ChangeWriterService

    user = await _create_user(db_session)
    # 归档 + 未扫描：守卫先于 not-scanned 检查（顺序断言——若顺序反了会报
    # CHANGE_WRITE_ERROR 而非 WORKSPACE_ARCHIVED）。
    ws = await _create_workspace(db_session, status="archived", scanned=False)

    with pytest.raises(WorkspaceArchived) as exc_info:
        await ChangeWriterService(db_session).create_change(
            ws.id,
            user.id,
            title="归档区变更",
        )
    assert exc_info.value.http_status == 409
