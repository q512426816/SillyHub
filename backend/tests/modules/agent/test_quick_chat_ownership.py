"""task-08（security-audit-remediation）：quick-chat 四端点归属过滤测试。

归属链（D-005@v1 修正实现）：``daemon_task_leases.agent_run_id → agent_runs.id`` +
lease ``metadata.actor_user_id``。D-005 字面的 ``agent_runs.lease_id`` 锚点不可实现
（该列 FK 指向 worktree_leases，service.py:1729 / bootstrap.py:554 注释明确禁止写
daemon lease id，写了 ForeignKeyViolation），故走反向链。

覆盖：
- 他人 GET result / kill / logs / stream → 404（D-001 与不存在同语义）
- 本人四端点回归 200（stream 为 SSE done 事件流）
- lease metadata 缺 actor_user_id（存量 run）→ 本人也 404（兼容策略）
- run 无 lease 行 → 404
- POST prev_run_id 他人 run → resume_session_id 置 None（不泄探，经 stub
  placement 捕获 dispatch kwargs 断言；quick-chat dispatch 在无 workspace 绑定时
  本就 NoOnlineDaemonError，stub 只隔离该层，不掩盖归属逻辑）
- dispatch_to_daemon 真 SQL 路径写 metadata["actor_user_id"] + lease.agent_run_id
  锚点（对齐 test_dispatch_metadata 的 _bootstrap 播种范式）

测试基建：根 conftest 的 ``client``（ASGITransport + get_session override 指向
每测试 :memory: SQLite）+ ``_redirect_session_factory``（stream 端点短 session 同
引擎）。用户均为 platform admin（绕过 RBAC 权限层，聚焦归属判定——admin 不豁免
归属，404 断言因此更强）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token
from app.modules.agent.model import AgentRun
from app.modules.agent.placement import RunPlacementService
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
from app.modules.workspace.model import Workspace

pytestmark = pytest.mark.asyncio


# ── seed helpers ─────────────────────────────────────────────────────────────


async def _mk_admin(db_session: AsyncSession, name: str) -> tuple[User, str]:
    u = User(
        id=uuid.uuid4(),
        email=f"{name}-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="irrelevant",
        display_name=name,
        status="active",
        is_platform_admin=True,
    )
    db_session.add(u)
    await db_session.commit()
    token, _ = create_access_token(
        user_id=u.id,
        email=u.email,
        is_admin=u.is_platform_admin,
        settings=get_settings(),
    )
    return u, token


async def _seed_quick_chat_run(
    db_session: AsyncSession,
    owner_id: uuid.UUID,
    *,
    status: str = "completed",
    session_id: str | None = None,
    lease_metadata: dict[str, Any] | None = None,
    with_lease: bool = True,
) -> AgentRun:
    """播一条 quick-chat run；默认带 actor_user_id 归属 lease。"""
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        status=status,
        spec_strategy="quick-chat",
        session_id=session_id,
    )
    db_session.add(run)
    await db_session.commit()
    await db_session.refresh(run)
    if with_lease:
        if lease_metadata is None:
            lease_metadata = {"actor_user_id": str(owner_id)}
        db_session.add(
            DaemonTaskLease(
                id=uuid.uuid4(),
                agent_run_id=run.id,
                runtime_id=None,
                status="pending",
                kind="interactive",
                metadata_=lease_metadata,
                created_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        await db_session.commit()
    return run


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture()
async def users(db_session: AsyncSession):
    """用户 A（run 属主）+ 用户 B（他人）。"""
    a, a_tok = await _mk_admin(db_session, "alice")
    b, b_tok = await _mk_admin(db_session, "bob")
    return a, a_tok, b, b_tok


# ── GET /api/daemon-chat/{run_id} ───────────────────────────────────────────


async def test_get_result_owner_200(client: AsyncClient, db_session, users):
    a, a_tok, _b, _b_tok = users
    run = await _seed_quick_chat_run(db_session, a.id)
    resp = await client.get(f"/api/daemon-chat/{run.id}", headers=_bearer(a_tok))
    assert resp.status_code == 200
    assert resp.json()["id"] == str(run.id)


async def test_get_result_other_user_404(client: AsyncClient, db_session, users):
    a, _a_tok, _b, b_tok = users
    run = await _seed_quick_chat_run(db_session, a.id)
    resp = await client.get(f"/api/daemon-chat/{run.id}", headers=_bearer(b_tok))
    assert resp.status_code == 404


async def test_get_result_legacy_run_without_actor_404(client: AsyncClient, db_session, users):
    """存量 lease 无 actor_user_id → 属主也 404（兼容策略，未上线可接受）。"""
    a, a_tok, _b, _b_tok = users
    run = await _seed_quick_chat_run(db_session, a.id, lease_metadata={"prompt": "old"})
    resp = await client.get(f"/api/daemon-chat/{run.id}", headers=_bearer(a_tok))
    assert resp.status_code == 404


async def test_get_result_run_without_lease_404(client: AsyncClient, db_session, users):
    a, a_tok, _b, _b_tok = users
    run = await _seed_quick_chat_run(db_session, a.id, with_lease=False)
    resp = await client.get(f"/api/daemon-chat/{run.id}", headers=_bearer(a_tok))
    assert resp.status_code == 404


async def test_get_result_nonexistent_404(client: AsyncClient, users):
    _a, a_tok, _b, _b_tok = users
    resp = await client.get(f"/api/daemon-chat/{uuid.uuid4()}", headers=_bearer(a_tok))
    assert resp.status_code == 404


# ── POST /api/daemon-chat/{run_id}/kill ─────────────────────────────────────


async def test_kill_other_user_404(client: AsyncClient, db_session, users):
    a, _a_tok, _b, b_tok = users
    run = await _seed_quick_chat_run(db_session, a.id, status="pending")
    resp = await client.post(f"/api/daemon-chat/{run.id}/kill", headers=_bearer(b_tok))
    assert resp.status_code == 404


async def test_kill_owner_pending_200_killed(client: AsyncClient, db_session, users):
    a, a_tok, _b, _b_tok = users
    run = await _seed_quick_chat_run(db_session, a.id, status="pending")
    resp = await client.post(f"/api/daemon-chat/{run.id}/kill", headers=_bearer(a_tok))
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == str(run.id)
    assert body["status"] == "killed"


async def test_kill_owner_terminal_idempotent(client: AsyncClient, db_session, users):
    a, a_tok, _b, _b_tok = users
    run = await _seed_quick_chat_run(db_session, a.id, status="completed")
    resp = await client.post(f"/api/daemon-chat/{run.id}/kill", headers=_bearer(a_tok))
    assert resp.status_code == 200
    assert resp.json()["status"] == "completed"


# ── GET /api/daemon-chat/{run_id}/logs ──────────────────────────────────────


async def test_logs_other_user_404(client: AsyncClient, db_session, users):
    a, _a_tok, _b, b_tok = users
    run = await _seed_quick_chat_run(db_session, a.id)
    resp = await client.get(f"/api/daemon-chat/{run.id}/logs", headers=_bearer(b_tok))
    assert resp.status_code == 404


async def test_logs_owner_200(client: AsyncClient, db_session, users):
    a, a_tok, _b, _b_tok = users
    run = await _seed_quick_chat_run(db_session, a.id)
    resp = await client.get(f"/api/daemon-chat/{run.id}/logs", headers=_bearer(a_tok))
    assert resp.status_code == 200
    assert resp.json() == []


# ── GET /api/daemon-chat/{run_id}/stream ────────────────────────────────────


async def test_stream_other_user_404(client: AsyncClient, db_session, users):
    a, _a_tok, _b, b_tok = users
    run = await _seed_quick_chat_run(db_session, a.id)
    resp = await client.get(f"/api/daemon-chat/{run.id}/stream", headers=_bearer(b_tok))
    assert resp.status_code == 404


async def test_stream_owner_terminal_200_sse(client: AsyncClient, db_session, users):
    """本人 + 终态 run → 200 text/event-stream，done 事件立即下发（不触 Redis）。"""
    a, a_tok, _b, _b_tok = users
    run = await _seed_quick_chat_run(db_session, a.id, status="completed")
    resp = await client.get(f"/api/daemon-chat/{run.id}/stream", headers=_bearer(a_tok))
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("text/event-stream")
    assert "event: done" in resp.text


# ── POST /api/daemon-chat?prev_run_id=…（resume 归属校验）──────────────────


class _StubPlacement:
    """捕获 dispatch_to_daemon kwargs 的替身。

    quick-chat dispatch 无 workspace 绑定本就 NoOnlineDaemonError（D-007 后
    daemon-only 单一路由），POST 归属过滤与 dispatch 可达性正交，stub 只隔离
    dispatch 层；resume_session_id 由端点在 dispatch 之前解析并传入 kwargs。
    """

    captured: dict[str, Any] = {}

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def dispatch_to_daemon(
        self, run_id: uuid.UUID, user_id: uuid.UUID, **kwargs: Any
    ) -> uuid.UUID:
        type(self).captured = dict(kwargs)
        return uuid.uuid4()


@pytest.fixture()
def stub_placement(monkeypatch: pytest.MonkeyPatch):
    _StubPlacement.captured = {}
    monkeypatch.setattr("app.modules.agent.placement.RunPlacementService", _StubPlacement)
    return _StubPlacement


async def _mk_membership(db_session: AsyncSession, user_id, workspace_id=None):
    """ql-20260904-014：quick-chat 现按用户首个 workspace 成员关系解析派发上下文
    （此前 workspace 缺失时 dispatch Branch 0 直接失败）——stub 用例补最小成员行。"""
    from app.modules.auth.model import UserWorkspaceRole

    db_session.add(
        UserWorkspaceRole(
            user_id=user_id,
            workspace_id=workspace_id or uuid.uuid4(),
            role_id=uuid.uuid4(),
        )
    )
    await db_session.commit()


async def test_post_prev_run_owner_resumes_session(
    client: AsyncClient, db_session, users, stub_placement
):
    a, a_tok, _b, _b_tok = users
    await _mk_membership(db_session, a.id)
    prev = await _seed_quick_chat_run(db_session, a.id, session_id="sess-alice-123")
    resp = await client.post(
        "/api/daemon-chat",
        params={"prompt": "hi", "prev_run_id": str(prev.id)},
        headers=_bearer(a_tok),
    )
    assert resp.status_code == 201
    assert stub_placement.captured.get("resume_session_id") == "sess-alice-123"


async def test_post_prev_run_other_user_resume_none(
    client: AsyncClient, db_session, users, stub_placement
):
    """他人 prev_run_id 视为不存在：resume_session_id 置 None，不泄探（D-001）。"""
    a, _a_tok, _b, b_tok = users
    await _mk_membership(db_session, _b.id)
    prev = await _seed_quick_chat_run(db_session, a.id, session_id="sess-alice-123")
    resp = await client.post(
        "/api/daemon-chat",
        params={"prompt": "hi", "prev_run_id": str(prev.id)},
        headers=_bearer(b_tok),
    )
    assert resp.status_code == 201
    assert stub_placement.captured.get("resume_session_id") is None


# ── dispatch_to_daemon 真 SQL 路径：归属锚点落盘 ───────────────────────────


async def _bootstrap_dispatch_stack(db_session: AsyncSession):
    """user + daemon_instance + runtime + workspace + member binding（对齐
    test_dispatch_metadata._bootstrap，_resolve_dispatch_runtime 走 per-member
    binding 路由）。"""
    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"own-{uid.hex[:8]}@example.com",
            password_hash="irrelevant",
            display_name="Owner",
            status="active",
        )
    )
    di = DaemonInstance(
        id=uuid.uuid4(),
        user_id=uid,
        hostname=f"host-{uid.hex[:6]}",
        server_url="http://localhost:8000",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(di)
    await db_session.flush()
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=uid,
        daemon_instance_id=di.id,
        provider="claude_code",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uid.hex[:6]}",
        slug=f"slug-{uid.hex[:8]}",
        root_path=f"/tmp/{uid.hex[:8]}",
        default_agent="claude_code",
        status="active",
        created_by=uid,
    )
    db_session.add(ws)
    await db_session.flush()
    db_session.add(
        WorkspaceMemberRuntime(
            workspace_id=ws.id,
            user_id=uid,
            daemon_id=di.id,
            runtime_id=rt.id,
            root_path="/tmp/binding",
            path_source="daemon-client",
        )
    )
    await db_session.commit()
    await db_session.refresh(ws)
    return ws.id, uid


async def test_dispatch_to_daemon_writes_actor_user_id(db_session: AsyncSession):
    """D-005@v1 归属锚点：lease metadata 含 actor_user_id；agent_run_id 列回链。

    agent_runs.lease_id 不写（FK→worktree_leases，写 daemon lease id 即
    ForeignKeyViolation，见 service.py:1729 注释）——链锚点是 lease.agent_run_id。
    """
    ws_id, uid = await _bootstrap_dispatch_stack(db_session)
    run = AgentRun(id=uuid.uuid4(), agent_type="claude_code", status="pending")
    db_session.add(run)
    await db_session.commit()
    await db_session.refresh(run)

    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(run.id, uid, workspace_id=ws_id, prompt="hello")

    assert lease_id is not None
    lease = await db_session.get(DaemonTaskLease, lease_id)
    assert lease is not None
    meta = lease.metadata_ or {}
    assert meta.get("actor_user_id") == str(uid)
    # 反向链锚点：lease 行自身带 agent_run_id（quick-chat 归属过滤 join 依据）。
    assert lease.agent_run_id == run.id
