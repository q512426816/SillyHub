"""4 路派发 resolver 借用兜底一致性测试（task-06 + task-07 + task-08 / D-008@v1 / FR-04）。

Change 2026-07-25-daemon-borrow-for-business。验证 4 路派发解析**同语义**接入
``_resolve_borrowed_or_own_runtime``（D-008），杜绝 R-01「decide 通过但 dispatch
报错」割裂：

  1. ``RunPlacementService._resolve_dispatch_runtime``（主派发 → dispatch_to_daemon）
  2. ``RunPlacementService._resolve_decide_runtime``（决策预检 → decide_backend）
  3. ``RunPlacementService.prepare_interactive_dispatch``（业务 quick-chat interactive）
  4. ``resolve_runtime_for_writeback``（写回链路）

三组核心一致性用例（每组 4 路）：
  - **AC1 自有零回归**：actor 有自有在线 daemon → 4 路都走自有，无 borrowed 标记。
  - **AC2 借用命中**：actor 无自有 + DAEMON_BORROW + shared lender → 4 路都借用。
  - **AC3 借用不满足**：actor 无自有 + 无 DAEMON_BORROW → 4 路都抛**原错误文案**。

外加：
  - AC4 interactive quick-chat 借用走通 + borrowed lease metadata 写入。
  - AC5 自有 daemon 在线但缺 default_agent provider → 不借用另一台（D-008 no-fallback），
    抛 provider-mismatch 原文案。
  - AC6 borrowed lease metadata 字段（borrowed + lender_user_id）。

测试范式照抄 ``test_borrow_resolver.py``：hermetic per-test SQLite，手工 seed
role/user/workspace/daemon/binding。RBAC 走真实 ``has_permission``。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

pytestmark = pytest.mark.asyncio


# ────────────────────────────────────────────────────────────────────────────
# Seed helpers — mirror test_borrow_resolver.py（inline 闭包，每 test 独立 session）
# ────────────────────────────────────────────────────────────────────────────


async def _seed_role(db_session: AsyncSession, key: str, perms: list[str]) -> uuid.UUID:
    from app.modules.auth.model import Role, RolePermission

    role = Role(id=uuid.uuid4(), key=key, name=key, description=key, is_system=True)
    db_session.add(role)
    await db_session.flush()
    for p in perms:
        db_session.add(RolePermission(role_id=role.id, permission=p))
    await db_session.commit()
    return role.id


async def _seed_user(db_session: AsyncSession, *, is_platform_admin: bool = False) -> uuid.UUID:
    from app.modules.auth.model import User

    user = User(
        id=uuid.uuid4(),
        email=f"u-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="x",
        display_name="U",
        status="active",
        is_platform_admin=is_platform_admin,
    )
    db_session.add(user)
    await db_session.commit()
    return user.id


async def _seed_workspace(
    db_session: AsyncSession,
    tmp_path: Any,
    *,
    default_agent: str | None = "claude",
) -> uuid.UUID:
    from app.modules.workspace.model import Workspace

    ws = Workspace(
        id=uuid.uuid4(),
        name="W",
        slug=f"ws-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path),
        status="active",
        default_agent=default_agent,
    )
    db_session.add(ws)
    await db_session.commit()
    return ws.id


async def _grant_role(
    db_session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    role_id: uuid.UUID,
) -> None:
    from app.modules.auth.model import UserWorkspaceRole

    db_session.add(
        UserWorkspaceRole(
            user_id=user_id,
            workspace_id=workspace_id,
            role_id=role_id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )
    await db_session.commit()


async def _seed_daemon(
    db_session: AsyncSession,
    *,
    owner_id: uuid.UUID,
    status: str = "online",
) -> uuid.UUID:
    from app.modules.daemon.model import DaemonInstance

    inst = DaemonInstance(
        id=uuid.uuid4(),
        user_id=owner_id,
        hostname="host-" + uuid.uuid4().hex[:6],
        server_url="http://test.local",
        status=status,
        last_heartbeat_at=datetime.now(UTC) if status == "online" else None,
    )
    db_session.add(inst)
    await db_session.commit()
    return inst.id


async def _seed_runtime(
    db_session: AsyncSession,
    *,
    daemon_id: uuid.UUID,
    owner_id: uuid.UUID,
    provider: str = "claude",
    status: str = "online",
) -> uuid.UUID:
    from app.modules.daemon.model import DaemonRuntime

    rt = DaemonRuntime(
        id=uuid.uuid4(),
        daemon_instance_id=daemon_id,
        user_id=owner_id,
        provider=provider,
        status=status,
        last_heartbeat_at=datetime.now(UTC) if status == "online" else None,
    )
    db_session.add(rt)
    await db_session.commit()
    return rt.id


async def _seed_binding(
    db_session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    daemon_id: uuid.UUID | None,
    shared: bool = False,
    root_path: str = "/home/u/repo",
) -> None:
    from app.modules.workspace.member_runtimes.model import (
        WorkspaceMemberRuntime,
    )

    db_session.add(
        WorkspaceMemberRuntime(
            workspace_id=workspace_id,
            user_id=user_id,
            daemon_id=daemon_id,
            shared=shared,
            root_path=root_path,
            path_source="daemon_client",
        )
    )
    await db_session.commit()


async def _seed_borrow_role(db_session: AsyncSession) -> uuid.UUID:
    """business_member：TASK_RUN_AGENT + DAEMON_BORROW + WORKSPACE_READ。"""
    from app.modules.auth.permissions import Permission

    return await _seed_role(
        db_session,
        "business_member",
        [
            Permission.TASK_RUN_AGENT.value,
            Permission.DAEMON_BORROW.value,
            Permission.WORKSPACE_READ.value,
        ],
    )


async def _seed_viewer_role(db_session: AsyncSession) -> uuid.UUID:
    """viewer：只 WORKSPACE_READ（无 DAEMON_BORROW）。"""
    from app.modules.auth.permissions import Permission

    return await _seed_role(db_session, "viewer", [Permission.WORKSPACE_READ.value])


async def _seed_agent_run(db_session: AsyncSession) -> uuid.UUID:
    from app.modules.agent.model import AgentRun

    run = AgentRun(id=uuid.uuid4(), agent_type="claude_code", status="pending")
    db_session.add(run)
    await db_session.commit()
    return run.id


async def _lease_metadata(db_session: AsyncSession, lease_id: uuid.UUID) -> dict:
    """读 daemon_task_leases.metadata JSON 列为 dict。"""
    from sqlalchemy import text

    row = (
        await db_session.execute(
            text("SELECT metadata FROM daemon_task_leases WHERE id = :id"),
            {"id": lease_id.hex},
        )
    ).first()
    if row is None or row[0] is None:
        return {}
    raw = row[0]
    return json.loads(raw) if isinstance(raw, str) else dict(raw)


# ────────────────────────────────────────────────────────────────────────────
# 场景构造器
# ────────────────────────────────────────────────────────────────────────────


async def _setup_own_daemon(
    db_session: AsyncSession,
    tmp_path: Any,
    *,
    actor_role: str = "business",  # 'business' or 'developer'
    provider: str = "claude",
    default_agent: str = "claude",
) -> dict[str, uuid.UUID]:
    """actor 有自有在线 daemon（+ 可选 business 角色）→ 4 路都应走自有。"""
    ws = await _seed_workspace(db_session, tmp_path, default_agent=default_agent)
    actor = await _seed_user(db_session)
    if actor_role == "business":
        role_id = await _seed_borrow_role(db_session)
        await _grant_role(db_session, workspace_id=ws, user_id=actor, role_id=role_id)
    did = await _seed_daemon(db_session, owner_id=actor)
    rt = await _seed_runtime(db_session, daemon_id=did, owner_id=actor, provider=provider)
    await _seed_binding(db_session, workspace_id=ws, user_id=actor, daemon_id=did, shared=False)
    return {"ws": ws, "actor": actor, "daemon": did, "runtime": rt}


async def _setup_borrow(
    db_session: AsyncSession,
    tmp_path: Any,
    *,
    actor_has_borrow_perm: bool = True,
    lender_shared: bool = True,
    lender_online: bool = True,
    lender_provider: str = "claude",
    default_agent: str = "claude",
) -> dict[str, uuid.UUID | None]:
    """actor 无自有 daemon；lender shared+online 可借用。返回 ws/actor/lender/daemon/runtime。"""
    ws = await _seed_workspace(db_session, tmp_path, default_agent=default_agent)
    lender = await _seed_user(db_session)
    actor = await _seed_user(db_session)
    if actor_has_borrow_perm:
        role_id = await _seed_borrow_role(db_session)
        await _grant_role(db_session, workspace_id=ws, user_id=actor, role_id=role_id)
    else:
        role_id = await _seed_viewer_role(db_session)
        await _grant_role(db_session, workspace_id=ws, user_id=actor, role_id=role_id)
    did = await _seed_daemon(
        db_session, owner_id=lender, status="online" if lender_online else "offline"
    )
    rt = await _seed_runtime(
        db_session,
        daemon_id=did,
        owner_id=lender,
        provider=lender_provider,
        status="online" if lender_online else "offline",
    )
    await _seed_binding(
        db_session,
        workspace_id=ws,
        user_id=lender,
        daemon_id=did,
        shared=lender_shared,
    )
    return {
        "ws": ws,
        "actor": actor,
        "lender": lender,
        "daemon": did,
        "runtime": rt,
    }


# ────────────────────────────────────────────────────────────────────────────
# AC1: 自有 daemon → 4 路零回归
# ────────────────────────────────────────────────────────────────────────────


async def test_ac1_dispatch_own_daemon_zero_regression(db_session, tmp_path) -> None:
    """dispatch_to_daemon：actor 有自有 daemon → lease runtime_id=自有，无 borrowed 标记。"""
    from app.modules.agent.placement import RunPlacementService

    refs = await _setup_own_daemon(db_session, tmp_path, actor_role="business")
    run = await _seed_agent_run(db_session)

    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(
        run, refs["actor"], workspace_id=refs["ws"], provider="claude"
    )
    assert lease_id is not None
    meta = await _lease_metadata(db_session, lease_id)
    assert "borrowed" not in meta  # 自有路径不写 borrowed 标记
    assert "lender_user_id" not in meta


async def test_ac1_decide_own_daemon_zero_regression(db_session, tmp_path) -> None:
    """decide_backend：actor 有自有 daemon → 返回 DAEMON（无异常）。"""
    from app.modules.agent.placement import ExecutionBackend, RunPlacementService

    refs = await _setup_own_daemon(db_session, tmp_path, actor_role="business")
    placement = RunPlacementService(db_session)
    backend = await placement.decide_backend(workspace_id=refs["ws"], user_id=refs["actor"])
    assert backend == ExecutionBackend.DAEMON


async def test_ac1_interactive_own_daemon_zero_regression(db_session, tmp_path) -> None:
    """prepare_interactive_dispatch：actor 有自有 daemon → lease 用自有 runtime，无 borrowed。"""
    from app.modules.agent.placement import RunPlacementService

    refs = await _setup_own_daemon(db_session, tmp_path, actor_role="business")
    placement = RunPlacementService(db_session)
    dispatch = await placement.prepare_interactive_dispatch(
        agent_session_id=uuid.uuid4(),
        agent_run_id=uuid.uuid4(),
        user_id=refs["actor"],
        provider="claude",
        prompt="hi",
        model=None,
        workspace_id=refs["ws"],
    )
    assert dispatch.runtime_id == refs["runtime"]
    meta = await _lease_metadata(db_session, dispatch.lease_id)
    assert "borrowed" not in meta


async def test_ac1_writeback_own_daemon_zero_regression(db_session, tmp_path) -> None:
    """resolve_runtime_for_writeback：actor 有自有 daemon → 返回自有 runtime dict。"""
    from app.modules.workspace.member_runtimes.resolver import (
        resolve_runtime_for_writeback,
    )

    refs = await _setup_own_daemon(db_session, tmp_path, actor_role="developer")
    rt = await resolve_runtime_for_writeback(db_session, refs["ws"], refs["actor"])
    assert uuid.UUID(str(rt["id"])) == refs["runtime"]


# ────────────────────────────────────────────────────────────────────────────
# AC2: 无自有 + 借用条件满足 → 4 路都借用
# ────────────────────────────────────────────────────────────────────────────


async def test_ac2_dispatch_borrows_lender_runtime(db_session, tmp_path) -> None:
    """dispatch_to_daemon：actor 无自有 + 借用满足 → lease runtime_id=lender，borrowed=True。"""
    from app.modules.agent.placement import RunPlacementService

    refs = await _setup_borrow(db_session, tmp_path)
    run = await _seed_agent_run(db_session)

    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(
        run, refs["actor"], workspace_id=refs["ws"], provider="claude"
    )
    assert lease_id is not None
    meta = await _lease_metadata(db_session, lease_id)
    assert meta.get("borrowed") is True
    assert meta.get("lender_user_id") == str(refs["lender"])


async def test_ac2_decide_borrows_and_passes(db_session, tmp_path) -> None:
    """decide_backend：actor 无自有 + 借用满足 → 返回 DAEMON（不抛）。

    关键反割裂断言：与 dispatch 同条件必须都通过（D-008 / R-01）。
    """
    from app.modules.agent.placement import ExecutionBackend, RunPlacementService

    refs = await _setup_borrow(db_session, tmp_path)
    placement = RunPlacementService(db_session)
    backend = await placement.decide_backend(workspace_id=refs["ws"], user_id=refs["actor"])
    assert backend == ExecutionBackend.DAEMON


async def test_ac2_interactive_borrows_for_quick_chat(db_session, tmp_path) -> None:
    """prepare_interactive_dispatch：业务 quick-chat（带 workspace_id）借用走通。

    AC4：lease runtime_id=lender runtime，borrowed=True + lender_user_id 写入。
    """
    from app.modules.agent.placement import RunPlacementService

    refs = await _setup_borrow(db_session, tmp_path)
    placement = RunPlacementService(db_session)
    dispatch = await placement.prepare_interactive_dispatch(
        agent_session_id=uuid.uuid4(),
        agent_run_id=uuid.uuid4(),
        user_id=refs["actor"],
        provider="claude",
        prompt="帮我写个方案",
        model=None,
        workspace_id=refs["ws"],
    )
    assert dispatch.runtime_id == refs["runtime"]  # lender 的 runtime
    meta = await _lease_metadata(db_session, dispatch.lease_id)
    assert meta.get("borrowed") is True
    assert meta.get("lender_user_id") == str(refs["lender"])


async def test_ac2_writeback_borrows_lender_runtime(db_session, tmp_path) -> None:
    """resolve_runtime_for_writeback：actor 无自有 + 借用满足 → 返回 lender runtime dict。"""
    from app.modules.workspace.member_runtimes.resolver import (
        resolve_runtime_for_writeback,
    )

    refs = await _setup_borrow(db_session, tmp_path)
    rt = await resolve_runtime_for_writeback(db_session, refs["ws"], refs["actor"])
    assert uuid.UUID(str(rt["id"])) == refs["runtime"]  # lender runtime
    # runtime.user_id 即 lender（daemon 归属人）。
    assert uuid.UUID(str(rt["user_id"])) == refs["lender"]


# ────────────────────────────────────────────────────────────────────────────
# AC3: 无自有 + 借用条件不满足（无 DAEMON_BORROW）→ 4 路都抛原错误文案
# ────────────────────────────────────────────────────────────────────────────


async def test_ac3_dispatch_raises_original_text_no_perm(db_session, tmp_path) -> None:
    """dispatch_to_daemon：无 DAEMON_BORROW → NoOnlineDaemonError '工作区未绑定守护进程'。"""
    from app.modules.agent.placement import NoOnlineDaemonError, RunPlacementService

    refs = await _setup_borrow(db_session, tmp_path, actor_has_borrow_perm=False)
    run = await _seed_agent_run(db_session)

    placement = RunPlacementService(db_session)
    with pytest.raises(NoOnlineDaemonError) as ei:
        await placement.dispatch_to_daemon(
            run, refs["actor"], workspace_id=refs["ws"], provider="claude"
        )
    assert ei.value.message == "工作区未绑定守护进程"


async def test_ac3_decide_raises_original_text_no_perm(db_session, tmp_path) -> None:
    """decide_backend：无 DAEMON_BORROW → NoOnlineDaemonError '工作区未绑定守护进程'。

    反割裂：与 dispatch 同条件必须都抛同一文案。
    """
    from app.modules.agent.placement import NoOnlineDaemonError, RunPlacementService

    refs = await _setup_borrow(db_session, tmp_path, actor_has_borrow_perm=False)
    placement = RunPlacementService(db_session)
    with pytest.raises(NoOnlineDaemonError) as ei:
        await placement.decide_backend(workspace_id=refs["ws"], user_id=refs["actor"])
    assert ei.value.message == "工作区未绑定守护进程"


async def test_ac3_interactive_raises_no_online(db_session, tmp_path) -> None:
    """prepare_interactive_dispatch：无 DAEMON_BORROW → NoOnlineDaemonError（默认文案）。"""
    from app.modules.agent.placement import NoOnlineDaemonError, RunPlacementService

    refs = await _setup_borrow(db_session, tmp_path, actor_has_borrow_perm=False)
    placement = RunPlacementService(db_session)
    with pytest.raises(NoOnlineDaemonError):
        await placement.prepare_interactive_dispatch(
            agent_session_id=uuid.uuid4(),
            agent_run_id=uuid.uuid4(),
            user_id=refs["actor"],
            provider="claude",
            prompt="hi",
            model=None,
            workspace_id=refs["ws"],
        )


async def test_ac3_writeback_raises_not_bound_no_perm(db_session, tmp_path) -> None:
    """resolve_runtime_for_writeback：无 DAEMON_BORROW → DaemonClientNoActiveSession not_bound。"""
    from app.modules.change_writer.proxy import DaemonClientNoActiveSession
    from app.modules.workspace.member_runtimes.resolver import (
        resolve_runtime_for_writeback,
    )

    refs = await _setup_borrow(db_session, tmp_path, actor_has_borrow_perm=False)
    with pytest.raises(DaemonClientNoActiveSession) as ei:
        await resolve_runtime_for_writeback(db_session, refs["ws"], refs["actor"])
    assert ei.value.details is not None
    assert ei.value.details["reason"] == "not_bound"


# ────────────────────────────────────────────────────────────────────────────
# AC3 变体：有 DAEMON_BORROW 但 lender 离线 / 未 shared → 4 路都抛原错误
# ────────────────────────────────────────────────────────────────────────────


async def test_ac3_dispatch_raises_when_lender_offline(db_session, tmp_path) -> None:
    """有 DAEMON_BORROW 但 lender daemon 离线 → dispatch 抛原 '工作区未绑定守护进程'。"""
    from app.modules.agent.placement import NoOnlineDaemonError, RunPlacementService

    refs = await _setup_borrow(db_session, tmp_path, lender_online=False)
    run = await _seed_agent_run(db_session)
    placement = RunPlacementService(db_session)
    with pytest.raises(NoOnlineDaemonError) as ei:
        await placement.dispatch_to_daemon(
            run, refs["actor"], workspace_id=refs["ws"], provider="claude"
        )
    # 无自有 binding → binding-None 分支原文案。
    assert ei.value.message == "工作区未绑定守护进程"


async def test_ac3_decide_raises_when_lender_offline(db_session, tmp_path) -> None:
    """有 DAEMON_BORROW 但 lender 离线 → decide 同条件也抛（反割裂）。"""
    from app.modules.agent.placement import NoOnlineDaemonError, RunPlacementService

    refs = await _setup_borrow(db_session, tmp_path, lender_online=False)
    placement = RunPlacementService(db_session)
    with pytest.raises(NoOnlineDaemonError):
        await placement.decide_backend(workspace_id=refs["ws"], user_id=refs["actor"])


# ────────────────────────────────────────────────────────────────────────────
# AC5: 自有 daemon 在线但缺 default_agent provider → 不借用另一台（D-008 no-fallback）
# ────────────────────────────────────────────────────────────────────────────


async def test_ac5_dispatch_own_daemon_wrong_provider_no_borrow(db_session, tmp_path) -> None:
    """actor 自有 daemon 在线但无 default_agent provider → 抛 provider-mismatch（不借用）。

     D-008：自有 daemon 在线时永远不借用另一台（避免 silent fallback）。即便工作空间
    里有 shared lender 也不偷借。
    """
    from app.modules.agent.placement import NoOnlineDaemonError, RunPlacementService

    # actor 自有 daemon 只有 codex，但 default_agent=claude。
    refs = await _setup_own_daemon(
        db_session,
        tmp_path,
        actor_role="business",
        provider="codex",
        default_agent="claude",
    )
    # 额外种一个 shared lender（claude）—— 验证 dispatch 不偷借。
    lender = await _seed_user(db_session)
    lender_did = await _seed_daemon(db_session, owner_id=lender)
    await _seed_runtime(db_session, daemon_id=lender_did, owner_id=lender, provider="claude")
    await _seed_binding(
        db_session,
        workspace_id=refs["ws"],
        user_id=lender,
        daemon_id=lender_did,
        shared=True,
    )
    run = await _seed_agent_run(db_session)

    placement = RunPlacementService(db_session)
    with pytest.raises(NoOnlineDaemonError) as ei:
        await placement.dispatch_to_daemon(
            run, refs["actor"], workspace_id=refs["ws"], provider="claude"
        )
    # 自有 daemon 在线但缺 claude → D-008 provider-mismatch 原文案。
    assert "claude" in ei.value.message
    assert "codex" in ei.value.message


# ────────────────────────────────────────────────────────────────────────────
# AC6: borrowed lease metadata 字段（task-06 provides BorrowedLeaseFlag）
# ────────────────────────────────────────────────────────────────────────────


async def test_ac6_borrowed_lease_metadata_fields(db_session, tmp_path) -> None:
    """借用 lease metadata 含 borrowed=True + lender_user_id=<str(lender)>。"""
    from app.modules.agent.placement import RunPlacementService

    refs = await _setup_borrow(db_session, tmp_path)
    run = await _seed_agent_run(db_session)
    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(
        run, refs["actor"], workspace_id=refs["ws"], provider="claude"
    )
    assert lease_id is not None
    meta = await _lease_metadata(db_session, lease_id)
    # task-06.provides BorrowedLeaseFlag 字段名。
    assert meta["borrowed"] is True
    assert meta["lender_user_id"] == str(refs["lender"])


async def test_ac6_scan_interactive_borrowed_metadata(db_session, tmp_path) -> None:
    """prepare_scan_interactive_dispatch 借用路同样写 borrowed lease metadata。

    第二个 _resolve_dispatch_runtime 消费方（scan 路）也必须读 borrowed 标记，
    与 dispatch_to_daemon 同语义（D-008 4 路一致）。
    """
    from app.modules.agent.placement import RunPlacementService

    refs = await _setup_borrow(db_session, tmp_path)
    placement = RunPlacementService(db_session)
    dispatch = await placement.prepare_scan_interactive_dispatch(
        agent_session_id=uuid.uuid4(),
        agent_run_id=uuid.uuid4(),
        user_id=refs["actor"],
        provider="claude",
        prompt="scan",
        model=None,
        root_path="/home/lender/repo",
        spec_root="/home/lender/repo/.sillyspec",
        workspace_id=refs["ws"],
    )
    assert dispatch.runtime_id == refs["runtime"]  # lender runtime
    meta = await _lease_metadata(db_session, dispatch.lease_id)
    assert meta["borrowed"] is True
    assert meta["lender_user_id"] == str(refs["lender"])


# ────────────────────────────────────────────────────────────────────────────
# AC7: interactive 无 workspace_id → 不借用（零回归，借用是 workspace-scoped）
# ────────────────────────────────────────────────────────────────────────────


async def test_ac7_interactive_no_workspace_no_borrow(db_session, tmp_path) -> None:
    """prepare_interactive_dispatch 无 workspace_id + 无自有 daemon → 抛原错误（不借用）。

    借用边界 = 工作空间成员资格（design §3 非目标）。无 workspace 上下文不能借用。
    """
    from app.modules.agent.placement import NoOnlineDaemonError, RunPlacementService

    # actor 无自有 runtime（不建 runtime），无 workspace_id。
    actor = await _seed_user(db_session)
    placement = RunPlacementService(db_session)
    with pytest.raises(NoOnlineDaemonError):
        await placement.prepare_interactive_dispatch(
            agent_session_id=uuid.uuid4(),
            agent_run_id=uuid.uuid4(),
            user_id=actor,
            provider="claude",
            prompt="hi",
            model=None,
            workspace_id=None,  # 无 workspace 上下文
        )


# ────────────────────────────────────────────────────────────────────────────
# AC8: task-09 / D-007@v2 借用沙箱 slug + cwd marker（daemon 沙箱隔离契约）
# ────────────────────────────────────────────────────────────────────────────


async def test_ac8_dispatch_borrow_writes_sandbox_marker(db_session, tmp_path) -> None:
    """dispatch_to_daemon 借用 → metadata 含 borrow_sandbox_slug + cwd marker。

    task-09 借用 lease 必须把 cwd 设为 ``borrow-sandbox:<slug>`` marker，daemon
    ``_startInteractiveSession`` 检测 marker 后创建独立沙箱作 cwd（不复用 lender 代码）。
    marker 借 build_claim_payload 既有 cwd→root_path 透传链路带给 daemon，无需改 context.py。
    """
    from app.modules.agent.placement import RunPlacementService

    refs = await _setup_borrow(db_session, tmp_path)
    run = await _seed_agent_run(db_session)
    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(
        run, refs["actor"], workspace_id=refs["ws"], provider="claude"
    )
    assert lease_id is not None
    meta = await _lease_metadata(db_session, lease_id)
    # 干净 slug 字段（task-10 / 审计可读）。
    assert "borrow_sandbox_slug" in meta
    slug: str = meta["borrow_sandbox_slug"]
    assert slug.startswith("borrow-")
    # slug 含 actor + run_id hex 片段（borrow-<actor>-<run>）。
    assert refs["actor"].hex[:8] in slug
    assert run.hex[:8] in slug
    # cwd marker（daemon 检测用）：borrow-sandbox:<slug>。
    assert meta["cwd"] == f"borrow-sandbox:{slug}"
    # borrowed / lender 字段仍在（W3 + task-09 共存）。
    assert meta["borrowed"] is True
    assert meta["lender_user_id"] == str(refs["lender"])


async def test_ac8_interactive_borrow_writes_sandbox_marker(db_session, tmp_path) -> None:
    """prepare_interactive_dispatch 借用 → metadata cwd marker 覆盖 caller cwd。

    业务 quick-chat 场景：caller 可能传 cwd=lender 代码路径；借用时必须覆盖为沙箱 marker，
    否则 daemon 用 lender 代码作 cwd → PolicyEngine 按 lease 隔离失效。
    """
    from app.modules.agent.placement import RunPlacementService

    refs = await _setup_borrow(db_session, tmp_path)
    placement = RunPlacementService(db_session)
    dispatch = await placement.prepare_interactive_dispatch(
        agent_session_id=uuid.uuid4(),
        agent_run_id=uuid.uuid4(),
        user_id=refs["actor"],
        provider="claude",
        prompt="帮我读源码出方案",
        model=None,
        workspace_id=refs["ws"],
        # 显式传 lender 代码路径作 cwd → 借用时必须被 marker 覆盖。
        cwd="/home/lender/code-repo",
    )
    meta = await _lease_metadata(db_session, dispatch.lease_id)
    slug = meta["borrow_sandbox_slug"]
    # cwd 被 marker 覆盖（不是 caller 传的 lender 路径）。
    assert meta["cwd"] == f"borrow-sandbox:{slug}"
    assert meta["cwd"] != "/home/lender/code-repo"


async def test_ac8_scan_interactive_borrow_writes_sandbox_marker(db_session, tmp_path) -> None:
    """prepare_scan_interactive_dispatch 借用 → cwd marker 覆盖 root_path 优先透传。

    scan 路的 root_path 是 lender 代码（build_claim_payload cwd 优先于 root_path）。
    借用时 cwd=marker → daemon 收到 marker 作 root_path → 切沙箱 cwd。scan 语义字段
    （root_path/spec_root）仍留 metadata，仅 cwd 透传优先级覆盖。
    """
    from app.modules.agent.placement import RunPlacementService

    refs = await _setup_borrow(db_session, tmp_path)
    placement = RunPlacementService(db_session)
    dispatch = await placement.prepare_scan_interactive_dispatch(
        agent_session_id=uuid.uuid4(),
        agent_run_id=uuid.uuid4(),
        user_id=refs["actor"],
        provider="claude",
        prompt="scan",
        model=None,
        root_path="/home/lender/repo",
        spec_root="/home/lender/repo/.sillyspec",
        workspace_id=refs["ws"],
    )
    meta = await _lease_metadata(db_session, dispatch.lease_id)
    slug = meta["borrow_sandbox_slug"]
    assert meta["cwd"] == f"borrow-sandbox:{slug}"
    # scan 语义字段保留（root_path 仍指 lender 代码，供 daemon 读；cwd 优先作 cwd 透传）。
    assert meta["root_path"] == "/home/lender/repo"


async def test_ac8_own_daemon_no_sandbox_marker_zero_regression(db_session, tmp_path) -> None:
    """自有 daemon 路径 → 不写 borrow_sandbox_slug / cwd marker（零回归）。

    开发人员自有任务走原 cwd（无 marker），daemon 不触发沙箱创建，runtime policy 不变。
    """
    from app.modules.agent.placement import RunPlacementService

    refs = await _setup_own_daemon(db_session, tmp_path, actor_role="business")
    run = await _seed_agent_run(db_session)
    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(
        run, refs["actor"], workspace_id=refs["ws"], provider="claude"
    )
    meta = await _lease_metadata(db_session, lease_id)
    assert "borrow_sandbox_slug" not in meta
    # 自有路径不写 marker（cwd 若有则原样，不前缀 borrow-sandbox:）。
    if "cwd" in meta:
        assert not meta["cwd"].startswith("borrow-sandbox:")
