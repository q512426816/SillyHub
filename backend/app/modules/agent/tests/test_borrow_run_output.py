"""task-10 + task-11 单测：借用 agent run 完成落文件中心 + 借用审计写入。

Change 2026-07-25-daemon-borrow-for-business。

覆盖：
  - **task-10 / FR-06 / D-001/D-009/D-010**：``AgentService.persist_borrow_run_output``
    - borrowed + completed run → 方案落 file（owner_type=workspace, uploaded_by=borrower,
      mime=text/markdown）+ 补审计 usage_summary。
    - 普通 lease（无 borrowed 标记）→ 不落 file（零回归）。
    - 失败 run → 不落 file（零回归）。
  - **task-10 钩子**：close_interactive_run 对 borrowed lease 触发落 file（端到端接线）。
  - **task-11 / FR-07 / D-004@v1**：借用 lease 创建（dispatch_to_daemon）→ 写 daemon_borrow_audit 行。
  - **task-11 审计完成补字段**：persist_borrow_run_output 把 usage_summary 写入审计行。
  - **spike-02 / R-04**：``text/markdown`` 在 ``settings.file_allowed_type_set`` 白名单。

测试范式照抄 ``test_placement_borrow_integration.py``：hermetic per-test SQLite，
手工 seed role/user/workspace/daemon/binding。落 file 用本地 MockStorage（不依赖真实 MinIO，
对齐 file/tests/conftest.MockStorage）。
"""

from __future__ import annotations

import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from typing import Any
from unittest.mock import patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

# grants 模型注册（task-06）：db_engine create_all 前挂到 BaseModel.metadata，
# 单独跑本文件/单用例时 daemon_runtime_grants 表也存在（对齐根 conftest 注册范式）。
from app.modules.daemon.grants import model as _grants_model  # noqa: F401
from app.modules.storage.base import ObjectStat, StorageBackend

pytestmark = pytest.mark.asyncio


# ────────────────────────────────────────────────────────────────────────────
# MockStorage（内存实现，对齐 file/tests/conftest.MockStorage）
# ────────────────────────────────────────────────────────────────────────────


class _MockStorage(StorageBackend):
    """内存存储后端：record put 调用、回放 get 内容，供断言。"""

    def __init__(self) -> None:
        self.objects: dict[str, tuple[bytes, str]] = {}

    async def put_object(self, key: str, data: bytes, content_type: str) -> None:
        self.objects[key] = (data, content_type)

    async def get_object_stream(self, key: str) -> AsyncIterator[bytes]:
        data, _ = self.objects[key]
        yield data

    async def delete_object(self, key: str) -> None:
        self.objects.pop(key, None)

    async def head_object(self, key: str) -> ObjectStat:
        data, ctype = self.objects[key]
        return ObjectStat(size=len(data), content_type=ctype)


# ────────────────────────────────────────────────────────────────────────────
# Seed helpers（mirror test_placement_borrow_integration.py）
# ────────────────────────────────────────────────────────────────────────────


async def _seed_user(db_session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"u-{uid.hex[:8]}@example.com",
            password_hash="x",
            display_name="U",
            status="active",
        )
    )
    await db_session.commit()
    return uid


async def _seed_workspace(db_session: AsyncSession, tmp_path: Any) -> uuid.UUID:
    from app.modules.workspace.model import Workspace

    ws = Workspace(
        id=uuid.uuid4(),
        name="W",
        slug=f"ws-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path),
        status="active",
        default_agent="claude",
    )
    db_session.add(ws)
    await db_session.commit()
    return ws.id


async def _seed_daemon_and_runtime(
    db_session: AsyncSession, *, owner_id: uuid.UUID
) -> tuple[uuid.UUID, uuid.UUID]:
    from app.modules.daemon.model import DaemonInstance, DaemonRuntime

    inst = DaemonInstance(
        id=uuid.uuid4(),
        user_id=owner_id,
        hostname="host-" + uuid.uuid4().hex[:6],
        server_url="http://test.local",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(inst)
    await db_session.flush()
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        daemon_instance_id=inst.id,
        user_id=owner_id,
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)
    await db_session.commit()
    return inst.id, rt.id


async def _seed_agent_run(
    db_session: AsyncSession,
    *,
    status: str = "completed",
    output_redacted: str | None = "# 方案\n读源码后建议...",
    agent_session_id: uuid.UUID | None = None,
    num_turns: int | None = 3,
    input_tokens: int | None = 1200,
    output_tokens: int | None = 800,
) -> uuid.UUID:
    from app.modules.agent.model import AgentRun

    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status=status,
        output_redacted=output_redacted,
        agent_session_id=agent_session_id,
        num_turns=num_turns,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )
    db_session.add(run)
    await db_session.commit()
    return run.id


async def _seed_agent_session(
    db_session: AsyncSession,
    *,
    user_id: uuid.UUID,
    workspace_id: uuid.UUID,
    runtime_id: uuid.UUID | None = None,
) -> uuid.UUID:
    from app.modules.agent.model import AgentSession

    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        workspace_id=workspace_id,
        runtime_id=runtime_id,
        provider="claude",
        status="active",
        config={},
        turn_count=1,
        last_active_at=datetime.now(UTC),
        created_at=datetime.now(UTC),
    )
    db_session.add(sess)
    await db_session.commit()
    return sess.id


async def _seed_borrow_audit(
    db_session: AsyncSession,
    *,
    borrower_user_id: uuid.UUID,
    lender_user_id: uuid.UUID,
    daemon_instance_id: uuid.UUID,
    workspace_id: uuid.UUID,
    agent_run_id: uuid.UUID,
) -> uuid.UUID:
    from app.modules.agent.model import DaemonBorrowAudit

    audit = DaemonBorrowAudit(
        id=uuid.uuid4(),
        borrower_user_id=borrower_user_id,
        lender_user_id=lender_user_id,
        daemon_instance_id=daemon_instance_id,
        workspace_id=workspace_id,
        agent_run_id=agent_run_id,
        borrowed_at=datetime.now(UTC),
    )
    db_session.add(audit)
    await db_session.commit()
    return audit.id


async def _setup_borrow_topology(db_session: AsyncSession, tmp_path: Any) -> dict[str, uuid.UUID]:
    """种借用拓扑：workspace + lender(自有 daemon) + borrower + enabled grant。

    返回 ws/lender/borrower/daemon/runtime/grant ids。borrower 无自有 daemon，
    lender 把 daemon 通过 workspace grant 共享给工作区（task-06 借用数据源切
    grants——binding shared 列只是开关双写的 UI 缓存侧，命中以 grant 行为准）。
    """
    ws = await _seed_workspace(db_session, tmp_path)
    lender = await _seed_user(db_session)
    borrower = await _seed_user(db_session)
    did, rt = await _seed_daemon_and_runtime(db_session, owner_id=lender)

    from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

    db_session.add(
        WorkspaceMemberRuntime(
            workspace_id=ws,
            user_id=lender,
            daemon_id=did,
            shared=True,
            root_path="/home/lender/repo",
            path_source="daemon_client",
        )
    )
    from app.modules.daemon.grants.model import DaemonRuntimeGrant

    grant = DaemonRuntimeGrant(
        daemon_instance_id=did,
        grantee_type="workspace",
        grantee_id=ws,
        granted_by_user_id=lender,
        enabled=True,
    )
    db_session.add(grant)
    # business_member 角色 + DAEMON_BORROW 权限给 borrower
    from app.modules.auth.model import Role, RolePermission, UserWorkspaceRole
    from app.modules.auth.permissions import Permission

    role = Role(
        id=uuid.uuid4(),
        key="business_member",
        name="business_member",
        description="business",
        is_system=True,
    )
    db_session.add(role)
    await db_session.flush()
    for p in (
        Permission.TASK_RUN_AGENT.value,
        Permission.DAEMON_BORROW.value,
        Permission.WORKSPACE_READ.value,
    ):
        db_session.add(RolePermission(role_id=role.id, permission=p))
    db_session.add(
        UserWorkspaceRole(
            user_id=borrower,
            workspace_id=ws,
            role_id=role.id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )
    await db_session.commit()
    return {
        "ws": ws,
        "lender": lender,
        "borrower": borrower,
        "daemon": did,
        "runtime": rt,
        "grant": grant.id,
    }


@pytest.fixture()
def _mock_storage(monkeypatch: pytest.MonkeyPatch) -> _MockStorage:
    """Patch get_storage_backend 单例为内存 MockStorage（NFR-4，不依赖真实 MinIO）。"""
    storage = _MockStorage()
    # AgentService.persist_borrow_run_output lazy import 取 factory.get_storage_backend。
    monkeypatch.setattr("app.modules.storage.factory.get_storage_backend", lambda: storage)
    return storage


# ────────────────────────────────────────────────────────────────────────────
# task-10：persist_borrow_run_output — borrowed + completed → 落 file
# ────────────────────────────────────────────────────────────────────────────


async def test_borrow_completed_run_drops_file_to_workspace(
    db_session: AsyncSession, tmp_path: Any, _mock_storage: _MockStorage
) -> None:
    """borrowed + completed run → 方案落 file（owner_type=workspace, uploaded_by=borrower,
    mime=text/markdown）+ 补审计 usage_summary。"""
    from app.modules.agent.model import AgentRun, DaemonBorrowAudit
    from app.modules.agent.service import AgentService
    from app.modules.file.model import File

    topo = await _setup_borrow_topology(db_session, tmp_path)
    session_id = await _seed_agent_session(
        db_session,
        user_id=topo["borrower"],
        workspace_id=topo["ws"],
        runtime_id=topo["runtime"],
    )
    run_id = await _seed_agent_run(
        db_session,
        status="completed",
        output_redacted="# 业务方案\n建议把 X 改成 Y。",
        agent_session_id=session_id,
    )
    await _seed_borrow_audit(
        db_session,
        borrower_user_id=topo["borrower"],
        lender_user_id=topo["lender"],
        daemon_instance_id=topo["daemon"],
        workspace_id=topo["ws"],
        agent_run_id=run_id,
    )

    run = await db_session.get(AgentRun, run_id)
    assert run is not None
    svc = AgentService(db_session)
    await svc.persist_borrow_run_output(
        run, {"borrowed": True, "lender_user_id": str(topo["lender"])}
    )

    # 断言 file 行：owner_type=workspace / owner_id=ws / uploaded_by=borrower / markdown。
    files = (await db_session.execute(select(File))).scalars().all()
    assert len(files) == 1
    f = files[0]
    assert f.owner_type == "workspace"
    assert f.owner_id == topo["ws"]
    assert f.uploaded_by == topo["borrower"]
    assert f.mime_type == "text/markdown"
    assert f.original_name == f"方案-{run_id}.md"
    # 存储对象已写。
    assert len(_mock_storage.objects) == 1
    stored = next(iter(_mock_storage.objects.values()))
    assert stored[1] == "text/markdown"
    assert "# 业务方案" in stored[0].decode("utf-8")

    # 审计 usage_summary 已补基础字段。
    audit = (
        (
            await db_session.execute(
                select(DaemonBorrowAudit).where(DaemonBorrowAudit.agent_run_id == run_id)
            )
        )
        .scalars()
        .first()
    )
    assert audit is not None
    assert audit.usage_summary is not None
    assert audit.usage_summary["status"] == "completed"
    assert audit.usage_summary["input_tokens"] == 1200
    assert audit.usage_summary["output_tokens"] == 800


async def test_normal_lease_not_drops_file_zero_regression(
    db_session: AsyncSession, tmp_path: Any, _mock_storage: _MockStorage
) -> None:
    """普通 lease（无 borrowed 标记）→ persist_borrow_run_output 直接返回，不落 file。"""
    from app.modules.agent.model import AgentRun
    from app.modules.agent.service import AgentService
    from app.modules.file.model import File

    topo = await _setup_borrow_topology(db_session, tmp_path)
    session_id = await _seed_agent_session(
        db_session, user_id=topo["borrower"], workspace_id=topo["ws"]
    )
    run_id = await _seed_agent_run(db_session, agent_session_id=session_id)
    run = await db_session.get(AgentRun, run_id)
    assert run is not None

    svc = AgentService(db_session)
    # 普通 lease：metadata 无 borrowed 标记。
    await svc.persist_borrow_run_output(run, {})

    files = (await db_session.execute(select(File))).scalars().all()
    assert len(files) == 0
    assert len(_mock_storage.objects) == 0


async def test_borrowed_failed_run_not_drops_file(
    db_session: AsyncSession, tmp_path: Any, _mock_storage: _MockStorage
) -> None:
    """borrowed 但 run failed → 不落 file（无可用方案文本，零回归语义）。"""
    from app.modules.agent.model import AgentRun
    from app.modules.agent.service import AgentService
    from app.modules.file.model import File

    topo = await _setup_borrow_topology(db_session, tmp_path)
    session_id = await _seed_agent_session(
        db_session, user_id=topo["borrower"], workspace_id=topo["ws"]
    )
    run_id = await _seed_agent_run(
        db_session, status="failed", output_redacted=None, agent_session_id=session_id
    )
    run = await db_session.get(AgentRun, run_id)
    assert run is not None

    svc = AgentService(db_session)
    await svc.persist_borrow_run_output(run, {"borrowed": True})

    files = (await db_session.execute(select(File))).scalars().all()
    assert len(files) == 0


async def test_borrowed_completed_no_output_not_drops_file(
    db_session: AsyncSession, tmp_path: Any, _mock_storage: _MockStorage
) -> None:
    """borrowed + completed 但 output_redacted 空 → 无方案文本，不落 file。"""
    from app.modules.agent.model import AgentRun
    from app.modules.agent.service import AgentService
    from app.modules.file.model import File

    topo = await _setup_borrow_topology(db_session, tmp_path)
    session_id = await _seed_agent_session(
        db_session, user_id=topo["borrower"], workspace_id=topo["ws"]
    )
    run_id = await _seed_agent_run(
        db_session, status="completed", output_redacted="", agent_session_id=session_id
    )
    run = await db_session.get(AgentRun, run_id)
    assert run is not None

    svc = AgentService(db_session)
    await svc.persist_borrow_run_output(run, {"borrowed": True})

    files = (await db_session.execute(select(File))).scalars().all()
    assert len(files) == 0


# ────────────────────────────────────────────────────────────────────────────
# task-10 钩子：close_interactive_run 对 borrowed lease 触发落 file（端到端）
# ────────────────────────────────────────────────────────────────────────────


async def test_close_interactive_run_hooks_borrowed_file_drop(
    db_session: AsyncSession, tmp_path: Any, _mock_storage: _MockStorage
) -> None:
    """close_interactive_run 对 borrowed lease completed → 端到端落 file。

    验证 D-010 钩子接线：daemon run_sync.service.close_interactive_run 调用
    AgentService.persist_borrow_run_output（task-10 钩子点）。borrowed lease 走
    prepare_interactive_dispatch 创建（带 claim_token，task-11 同时验证审计行写入）。
    范式照抄 test_close_interactive_run_session_status._seed_session_and_run。
    """
    from app.modules.agent.model import AgentRun, AgentSession
    from app.modules.agent.placement import RunPlacementService
    from app.modules.daemon.service import DaemonService
    from app.modules.file.model import File

    topo = await _setup_borrow_topology(db_session, tmp_path)

    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    placement = RunPlacementService(db_session)
    dispatch = await placement.prepare_interactive_dispatch(
        agent_session_id=session_id,
        agent_run_id=run_id,
        user_id=topo["borrower"],
        provider="claude",
        prompt="帮我读源码出方案",
        model=None,
        workspace_id=topo["ws"],
    )
    assert dispatch.runtime_id == topo["runtime"]  # lender runtime（借用命中）

    sess = AgentSession(
        id=session_id,
        user_id=topo["borrower"],
        workspace_id=topo["ws"],
        provider="claude",
        status="active",
        config={},
        turn_count=1,
        runtime_id=topo["runtime"],
        lease_id=dispatch.lease_id,
        last_active_at=datetime.now(UTC),
        created_at=datetime.now(UTC),
    )
    run = AgentRun(
        id=run_id,
        agent_type="claude_code",
        provider="claude",
        status="running",
        spec_strategy="interactive",
        agent_session_id=session_id,
    )
    db_session.add_all([sess, run])
    await db_session.commit()

    # task-11：审计行已在借用 lease 创建时写入。
    from app.modules.agent.model import DaemonBorrowAudit

    audit = (
        (
            await db_session.execute(
                select(DaemonBorrowAudit).where(DaemonBorrowAudit.agent_run_id == run_id)
            )
        )
        .scalars()
        .first()
    )
    assert audit is not None
    assert audit.borrower_user_id == topo["borrower"]
    assert audit.lender_user_id == topo["lender"]
    assert audit.workspace_id == topo["ws"]
    assert audit.daemon_instance_id == topo["daemon"]

    svc = DaemonService(db_session)
    # patch redis（close_interactive_run 会 publish 终态事件 + session event）。
    from unittest.mock import AsyncMock

    with (
        patch("app.modules.daemon.run_sync.service.get_redis") as gr,
        patch("app.modules.daemon.session.service.get_redis") as gs,
    ):
        rmock = AsyncMock()
        rmock.publish = AsyncMock()
        gr.return_value = rmock
        gs.return_value = rmock
        closed = await svc.close_interactive_run(
            dispatch.lease_id,
            run_id,
            dispatch.claim_token,
            status="success",
            is_error=False,
            subtype="success",
            result_summary="# 方案\n建议改造模块 A。",
        )
    assert closed.status == "completed"

    # 端到端断言：方案 file 落库（owner_type=workspace, uploaded_by=borrower）。
    files = (await db_session.execute(select(File))).scalars().all()
    assert len(files) == 1
    assert files[0].owner_type == "workspace"
    assert files[0].owner_id == topo["ws"]
    assert files[0].uploaded_by == topo["borrower"]
    assert files[0].mime_type == "text/markdown"

    # 审计 usage_summary 已补。
    audit2 = (
        (
            await db_session.execute(
                select(DaemonBorrowAudit).where(DaemonBorrowAudit.agent_run_id == run_id)
            )
        )
        .scalars()
        .first()
    )
    assert audit2 is not None
    assert audit2.usage_summary is not None
    assert audit2.usage_summary["status"] == "completed"


async def test_close_interactive_run_normal_lease_no_file_zero_regression(
    db_session: AsyncSession, tmp_path: Any, _mock_storage: _MockStorage
) -> None:
    """close_interactive_run 对普通（自有 daemon）lease → 不落 file（零回归）。

    构造一个自有 daemon 的 lease（非借用），close 后不应产生 file 行。
    """
    from app.modules.agent.model import AgentRun, AgentSession
    from app.modules.agent.placement import RunPlacementService
    from app.modules.daemon.service import DaemonService
    from app.modules.file.model import File
    from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

    # actor 自有 daemon（非借用）。
    actor = await _seed_user(db_session)
    ws = await _seed_workspace(db_session, tmp_path)
    did, rt = await _seed_daemon_and_runtime(db_session, owner_id=actor)
    db_session.add(
        WorkspaceMemberRuntime(
            workspace_id=ws,
            user_id=actor,
            daemon_id=did,
            shared=False,
            root_path="/home/actor/repo",
            path_source="daemon_client",
        )
    )
    await db_session.commit()

    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    placement = RunPlacementService(db_session)
    dispatch = await placement.prepare_interactive_dispatch(
        agent_session_id=session_id,
        agent_run_id=run_id,
        user_id=actor,
        provider="claude",
        prompt="跑",
        model=None,
        workspace_id=ws,
    )
    sess = AgentSession(
        id=session_id,
        user_id=actor,
        workspace_id=ws,
        provider="claude",
        status="active",
        config={},
        turn_count=1,
        runtime_id=rt,
        lease_id=dispatch.lease_id,
        last_active_at=datetime.now(UTC),
        created_at=datetime.now(UTC),
    )
    run = AgentRun(
        id=run_id,
        agent_type="claude_code",
        provider="claude",
        status="running",
        spec_strategy="interactive",
        agent_session_id=session_id,
    )
    db_session.add_all([sess, run])
    await db_session.commit()

    svc = DaemonService(db_session)
    from unittest.mock import AsyncMock

    with (
        patch("app.modules.daemon.run_sync.service.get_redis") as gr,
        patch("app.modules.daemon.session.service.get_redis") as gs,
    ):
        rmock = AsyncMock()
        rmock.publish = AsyncMock()
        gr.return_value = rmock
        gs.return_value = rmock
        await svc.close_interactive_run(
            dispatch.lease_id,
            run_id,
            dispatch.claim_token,
            status="success",
            is_error=False,
            subtype="success",
            result_summary="自有 run 结果",
        )

    # 零回归：自有 lease 不落 file。
    files = (await db_session.execute(select(File))).scalars().all()
    assert len(files) == 0


# ────────────────────────────────────────────────────────────────────────────
# task-11：借用 lease 创建写 daemon_borrow_audit（dispatch_to_daemon 借用路）
# ────────────────────────────────────────────────────────────────────────────


async def test_dispatch_borrow_creates_audit_row(db_session: AsyncSession, tmp_path: Any) -> None:
    """借用 dispatch_to_daemon → 写一条 daemon_borrow_audit（字段完整）。"""
    from app.modules.agent.model import DaemonBorrowAudit
    from app.modules.agent.placement import RunPlacementService

    topo = await _setup_borrow_topology(db_session, tmp_path)
    run_id = await _seed_agent_run(db_session, status="pending")

    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(
        run_id, topo["borrower"], workspace_id=topo["ws"], provider="claude"
    )
    assert lease_id is not None

    audits = (await db_session.execute(select(DaemonBorrowAudit))).scalars().all()
    assert len(audits) == 1
    a = audits[0]
    assert a.borrower_user_id == topo["borrower"]
    assert a.lender_user_id == topo["lender"]
    assert a.daemon_instance_id == topo["daemon"]
    assert a.workspace_id == topo["ws"]
    assert a.agent_run_id == run_id
    assert a.borrowed_at is not None
    # usage_summary 创建时为 NULL，run 完成回调补。
    assert a.usage_summary is None


async def test_dispatch_own_daemon_no_audit_zero_regression(
    db_session: AsyncSession, tmp_path: Any
) -> None:
    """自有 daemon dispatch → 不写审计行（零回归，仅借用写审计）。"""
    from app.modules.agent.model import DaemonBorrowAudit
    from app.modules.agent.placement import RunPlacementService
    from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

    actor = await _seed_user(db_session)
    ws = await _seed_workspace(db_session, tmp_path)
    did, _ = await _seed_daemon_and_runtime(db_session, owner_id=actor)
    db_session.add(
        WorkspaceMemberRuntime(
            workspace_id=ws,
            user_id=actor,
            daemon_id=did,
            shared=False,
            root_path="/home/actor/repo",
            path_source="daemon_client",
        )
    )
    await db_session.commit()
    run_id = await _seed_agent_run(db_session)

    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(run_id, actor, workspace_id=ws, provider="claude")
    assert lease_id is not None

    audits = (await db_session.execute(select(DaemonBorrowAudit))).scalars().all()
    assert len(audits) == 0


async def test_interactive_dispatch_borrow_creates_audit_row(
    db_session: AsyncSession, tmp_path: Any
) -> None:
    """借用 prepare_interactive_dispatch → 同样写审计行（业务 quick-chat 路径）。"""
    from app.modules.agent.model import DaemonBorrowAudit
    from app.modules.agent.placement import RunPlacementService

    topo = await _setup_borrow_topology(db_session, tmp_path)
    placement = RunPlacementService(db_session)
    dispatch = await placement.prepare_interactive_dispatch(
        agent_session_id=uuid.uuid4(),
        agent_run_id=uuid.uuid4(),
        user_id=topo["borrower"],
        provider="claude",
        prompt="帮我读源码出方案",
        model=None,
        workspace_id=topo["ws"],
    )
    assert dispatch.runtime_id == topo["runtime"]

    audits = (await db_session.execute(select(DaemonBorrowAudit))).scalars().all()
    assert len(audits) == 1
    a = audits[0]
    assert a.borrower_user_id == topo["borrower"]
    assert a.lender_user_id == topo["lender"]
    assert a.daemon_instance_id == topo["daemon"]
    assert a.workspace_id == topo["ws"]


# ────────────────────────────────────────────────────────────────────────────
# spike-02 / R-04：text/markdown 在 file_allowed_type_set 白名单
# ────────────────────────────────────────────────────────────────────────────


async def test_text_markdown_in_whitelist() -> None:
    """spike-02：默认 settings.file_allowed_type_set 含 text/markdown。

    D-001/FR-06 落方案依赖 markdown 在白名单，否则 FileService.validate_upload 抛 415。
    """
    from app.core.config import get_settings

    settings = get_settings()
    assert "text/markdown" in settings.file_allowed_type_set
    assert "text/plain" in settings.file_allowed_type_set


async def test_file_service_accepts_markdown_via_borrow_path(
    db_session: AsyncSession, _mock_storage: _MockStorage
) -> None:
    """FileService 直接收 text/markdown bytes（spike-02 + D-009 复用 upload_file 验证）。"""
    from app.core.config import get_settings
    from app.modules.file.service import FileService

    user_id = await _seed_user(db_session)
    file_svc = FileService(db_session, _mock_storage, get_settings())
    resp = await file_svc.upload_file(
        original_name="方案-test.md",
        data="# 方案\n内容".encode(),
        mime_type="text/markdown",
        uploaded_by=user_id,
        owner_type="workspace",
        owner_id=uuid.uuid4(),
    )
    assert resp.mime_type == "text/markdown"
    assert resp.size > 0
