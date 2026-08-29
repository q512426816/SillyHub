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


# ── HTTP：存量会话只读（inject / interrupt 409，ql-20260829-011）─────────────


async def _seed_session(
    db_session: AsyncSession,
    *,
    user_id: uuid.UUID,
    workspace_id: uuid.UUID | None,
    origin: str = "chat",
    status: str = "active",
) -> uuid.UUID:
    from app.modules.agent.model import AgentSession

    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=None,
        lease_id=None,
        workspace_id=workspace_id,
        provider="claude",
        status=status,
        origin=origin,
    )
    db_session.add(sess)
    await db_session.commit()
    return sess.id


@pytest.mark.asyncio
async def test_session_inject_on_archived_workspace_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """归档区存量会话注入（继续对话）→ 409（守卫先于 status/lease 判定）。"""
    user = await _create_user(db_session)
    await _grant_platform_permission(db_session, user.id, Permission.TASK_RUN_AGENT)
    ws = await _create_workspace(db_session, status="archived")
    session_id = await _seed_session(db_session, user_id=user.id, workspace_id=ws.id)

    resp = await client.post(
        f"/api/daemon/sessions/{session_id}/inject",
        json={"prompt": "继续"},
        headers=_headers(_token_for(user)),
    )
    assert resp.status_code == 409, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_409_WORKSPACE_ARCHIVED"


@pytest.mark.asyncio
async def test_session_interrupt_on_archived_workspace_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """归档区存量会话中断 → 409（与 inject 同口径只读）。"""
    user = await _create_user(db_session)
    await _grant_platform_permission(db_session, user.id, Permission.TASK_RUN_AGENT)
    ws = await _create_workspace(db_session, status="archived")
    session_id = await _seed_session(db_session, user_id=user.id, workspace_id=ws.id)

    resp = await client.post(
        f"/api/daemon/sessions/{session_id}/interrupt",
        headers=_headers(_token_for(user)),
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["code"] == "HTTP_409_WORKSPACE_ARCHIVED"


# ── 2026-08-30 审计④ 补口轮：激活分支 / plan-response / 文件写 API / 派发链 ────


@pytest.mark.asyncio
async def test_tool_report_activation_on_archived_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """归档区 tool_report 预会话首条消息（懒激活分支）→ 409（审计④-1）。

    激活分支在 inject_session 内先于 _inject_into_session（守卫原所在）提前
    return——4d64cb28 提交信息声称覆盖激活分支但实际未拦（新测试的会话 origin
    缺省 chat，从未测到该分支），本用例坐实收口。
    """
    user = await _create_user(db_session)
    await _grant_platform_permission(db_session, user.id, Permission.TASK_RUN_AGENT)
    ws = await _create_workspace(db_session, status="archived")
    session_id = await _seed_session(
        db_session, user_id=user.id, workspace_id=ws.id, origin="tool_report", status="pending"
    )

    resp = await client.post(
        f"/api/daemon/sessions/{session_id}/inject",
        json={"prompt": "首条消息"},
        headers=_headers(_token_for(user)),
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["code"] == "HTTP_409_WORKSPACE_ARCHIVED"


@pytest.mark.asyncio
async def test_plan_response_on_archived_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """归档区存量会话 plan 确认 → 409（审计④-7，不持久化 decision 不推送）。

    守卫位于会话归属校验之后、run 校验之前——dummy run_id 即可命中（无需种子 run）。
    """
    user = await _create_user(db_session)
    await _grant_platform_permission(db_session, user.id, Permission.TASK_RUN_AGENT)
    ws = await _create_workspace(db_session, status="archived")
    session_id = await _seed_session(db_session, user_id=user.id, workspace_id=ws.id)

    resp = await client.post(
        f"/api/daemon/sessions/{session_id}/plan-response",
        json={
            "session_id": str(session_id),
            "run_id": str(uuid.uuid4()),
            "decision": "confirm",
        },
        headers=_headers(_token_for(user)),
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["code"] == "HTTP_409_WORKSPACE_ARCHIVED"


@pytest.mark.asyncio
async def test_skill_create_on_archived_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """归档工作区新建 skill → 409（审计④-5，守卫在 _skills_root 内统一挂）。"""
    user = await _create_user(db_session)
    await _grant_platform_permission(db_session, user.id, Permission.WORKSPACE_WRITE)
    ws = await _create_workspace(db_session, status="archived")

    resp = await client.post(
        f"/api/workspaces/{ws.id}/skills",
        json={"name": "demo", "description": "d"},
        headers=_headers(_token_for(user)),
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["code"] == "HTTP_409_WORKSPACE_ARCHIVED"


@pytest.mark.asyncio
async def test_mcp_config_update_on_archived_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """归档工作区写 .mcp.json → 409（审计④-5）。"""
    user = await _create_user(db_session)
    await _grant_platform_permission(db_session, user.id, Permission.WORKSPACE_WRITE)
    ws = await _create_workspace(db_session, status="archived")

    resp = await client.put(
        f"/api/workspaces/{ws.id}/mcp-config",
        json={"mcpServers": {}},
        headers=_headers(_token_for(user)),
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["code"] == "HTTP_409_WORKSPACE_ARCHIVED"


@pytest.mark.asyncio
async def test_generate_projects_on_archived_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """归档工作区 generate-projects（写 projects/*.yaml）→ 409（审计④-5）。"""
    user = await _create_user(db_session)
    await _grant_platform_permission(db_session, user.id, Permission.WORKSPACE_ADMIN)
    ws = await _create_workspace(db_session, status="archived")

    resp = await client.post(
        f"/api/workspaces/{ws.id}/generate-projects",
        headers=_headers(_token_for(user)),
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["code"] == "HTTP_409_WORKSPACE_ARCHIVED"


async def test_dispatch_execute_team_on_archived_raises(db_session: AsyncSession) -> None:
    """归档工作区 team 模式阶段推进 → WorkspaceArchived（审计④-4，service 级）。

    single 模式已由 start_stage_dispatch 守卫，team 分流漏拦——守卫在函数首，
    无需 change/mission 种子即命中。
    """
    ws = await _create_workspace(db_session, status="archived")
    from app.modules.change.dispatch import _dispatch_execute_team

    with pytest.raises(WorkspaceArchived):
        await _dispatch_execute_team(db_session, ws.id, uuid.uuid4(), uuid.uuid4())


async def test_mcp_dispatch_worker_core_on_archived_raises(db_session: AsyncSession) -> None:
    """归档目标工作区 MCP dispatch_worker 共用主体 → WorkspaceArchived（审计④-2）。

    链路A 四入口（dispatch_worker / _for_session / _scoped / _by_mission）共用
    _dispatch_worker_core；守卫位于两段式 binding 预检前——mission 仅需内存对象
    （守卫前只读 workspace_id/session_id/scope_workspace_ids）。
    """
    from types import SimpleNamespace

    from app.modules.agent.mcp_tools import DispatchWorkerRequest, _dispatch_worker_core
    from app.modules.agent.model import AgentMission

    ws = await _create_workspace(db_session, status="archived")
    user = await _create_user(db_session)
    mission = AgentMission(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        session_id=None,
        objective="demo",
        created_by=user.id,
    )
    request = SimpleNamespace(headers={})

    with pytest.raises(WorkspaceArchived):
        await _dispatch_worker_core(
            db_session,
            request,
            user,
            mission,
            DispatchWorkerRequest(objective="demo"),
            anchor_workspace_id=ws.id,
        )


@pytest.mark.asyncio
async def test_session_reopen_on_archived_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """归档区存量会话 reopen（复活会话句柄 + SESSION_RESUME）→ 409（审计R8）。

    reopen 建 lease 并让 daemon 恢复在归档工作区执行——与 inject/interrupt/
    plan-response 同拦；守卫先于 provider/cwd 前置校验（归档语义优先）。
    """
    user = await _create_user(db_session)
    await _grant_platform_permission(db_session, user.id, Permission.TASK_RUN_AGENT)
    ws = await _create_workspace(db_session, status="archived")
    session_id = await _seed_session(db_session, user_id=user.id, workspace_id=ws.id)

    resp = await client.post(
        f"/api/daemon/sessions/{session_id}/reopen",
        headers=_headers(_token_for(user)),
    )
    assert resp.status_code == 409, resp.text
    assert resp.json()["code"] == "HTTP_409_WORKSPACE_ARCHIVED"
