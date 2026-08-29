"""Tests for per-member binding routing in RunPlacementService (task-08).

Covers change ``2026-07-03-daemon-entity-binding`` task-08 (D-007 后更新)：
per-member binding (WorkspaceMemberRuntime) 是唯一绑定真相源，经 daemon_id
(D-004) + workspace.default_agent / provider override (D-005) 路由，provider
未启用时抛 D-008。server-local / 全局列回退路径已随 D-007 删除。

Scenarios:
- T1: Member binding with daemon_id + default_agent matching an online runtime → dispatch uses that runtime.
- T2: Member binding with daemon online but default_agent not enabled → NoOnlineDaemonError (D-008).
- T3: Member binding with daemon_id belonging to another user → NoOnlineDaemonError.
- T6: decide_backend with member binding (daemon online) → DAEMON.
- T8: prepare_scan_interactive_dispatch uses member binding (daemon_id + provider).
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import text

from app.modules.agent.model import AgentRun
from app.modules.agent.placement import (
    NoOnlineDaemonError,
    RunPlacementService,
    fetch_daemon_allowed_roots,
    path_definitively_outside_roots,
)
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance, DaemonRuntime

# Import to register workspace_member_runtimes table in BaseModel.metadata.
from app.modules.workspace.member_runtimes import model as _wmr_model  # noqa: F401
from app.modules.workspace.member_runtimes.queries import (
    resolve_daemon_instance_for_workspace,
    resolve_representative_binding,
)
from app.modules.workspace.model import Workspace

# ---- Test helpers ------------------------------------------------------------


async def _create_user(session, suffix: str = "u") -> uuid.UUID:
    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"test-{suffix}-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _create_daemon_instance(
    session,
    user_id: uuid.UUID,
    *,
    status: str = "online",
    heartbeat: datetime | None = None,
) -> DaemonInstance:
    di = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname=f"host-{uuid.uuid4().hex[:6]}",
        server_url="http://localhost:8000",
        status=status,
        # task-04：heartbeat 可显式设（D-005@v1 双源全序主序 = 实例心跳，
        # 多机形态须显式设值消除插入顺序依赖；缺省 None=旧行为 now()）。
        last_heartbeat_at=heartbeat if heartbeat is not None else datetime.now(UTC),
    )
    session.add(di)
    await session.commit()
    await session.refresh(di)
    return di


async def _create_runtime(
    session,
    user_id: uuid.UUID,
    *,
    provider: str = "claude_code",
    status: str = "online",
    daemon_instance_id: uuid.UUID | None = None,
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        daemon_instance_id=daemon_instance_id,
        name=f"daemon-{uuid.uuid4().hex[:6]}",
        provider=provider,
        status=status,
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


async def _create_workspace(
    session,
    *,
    user_id: uuid.UUID | None = None,
    default_agent: str | None = None,
) -> Workspace:
    """Build a workspace. D-007：path_source/daemon_runtime_id 列已删除，
    绑定完全由 WorkspaceMemberRuntime 行承载。"""
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"slug-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{uuid.uuid4().hex[:8]}",
        default_agent=default_agent,
        status="active",
        created_by=user_id,
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _create_member_binding(
    session,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    runtime_id: uuid.UUID | None = None,
    daemon_id: uuid.UUID | None = None,
    root_path: str = "/tmp/binding-path",
) -> None:
    from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

    binding = WorkspaceMemberRuntime(
        workspace_id=workspace_id,
        user_id=user_id,
        runtime_id=runtime_id,
        daemon_id=daemon_id,
        root_path=root_path,
        path_source="daemon-client",
    )
    session.add(binding)
    await session.commit()


async def _create_agent_run(session) -> AgentRun:
    run = AgentRun(id=uuid.uuid4(), agent_type="claude_code", status="pending")
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


async def _lease_runtime_id(session, lease_id: uuid.UUID) -> uuid.UUID | None:
    result = await session.execute(
        text("SELECT runtime_id FROM daemon_task_leases WHERE id = :id"),
        {"id": lease_id.hex},
    )
    row = result.mappings().first()
    if not row or row["runtime_id"] is None:
        return None
    raw = row["runtime_id"]
    return uuid.UUID(raw) if isinstance(raw, str) else raw


# ---- T1: Member binding routes to binding's runtime (happy path) -------------


@pytest.mark.asyncio
async def test_t1_member_binding_routes_to_binding_runtime(db_session):
    """Per-member binding's daemon_id + default_agent resolves the correct runtime."""
    user_id = await _create_user(db_session)
    di = await _create_daemon_instance(db_session, user_id)
    # Create a stray online runtime that should NOT be selected.
    _stray_rt = await _create_runtime(
        db_session, user_id, provider="claude_code", daemon_instance_id=di.id
    )
    # Create the runtime the binding points to.
    target_rt = await _create_runtime(
        db_session, user_id, provider="codex", daemon_instance_id=di.id
    )
    ws = await _create_workspace(
        db_session,
        user_id=user_id,
        default_agent="codex",  # Tells dispatch to route to codex provider.
    )
    # Create per-member binding pointing to the daemon (not a specific runtime).
    await _create_member_binding(
        db_session,
        workspace_id=ws.id,
        user_id=user_id,
        daemon_id=di.id,  # D-004: bind to daemon entity.
    )
    run = await _create_agent_run(db_session)

    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(run.id, user_id, workspace_id=ws.id)

    assert lease_id is not None
    # Should have used the runtime matching default_agent ("codex") on the bound daemon.
    actual = await _lease_runtime_id(db_session, lease_id)
    assert actual == target_rt.id, f"Expected default_agent runtime {target_rt.id}, got {actual}"


# ---- T2: Member binding exists but runtime offline ---------------------------


@pytest.mark.asyncio
async def test_t2_member_binding_daemon_online_provider_missing_raises(db_session):
    """Daemon online but target provider not enabled → D-008 NoOnlineDaemonError."""
    user_id = await _create_user(db_session)
    di = await _create_daemon_instance(db_session, user_id)
    # Create a runtime for "codex" but not for "claude_code".
    _enabled_rt = await _create_runtime(
        db_session, user_id, provider="codex", daemon_instance_id=di.id, status="online"
    )
    ws = await _create_workspace(
        db_session,
        user_id=user_id,
        default_agent="claude_code",  # default_agent not enabled on the daemon.
    )
    await _create_member_binding(
        db_session,
        workspace_id=ws.id,
        user_id=user_id,
        daemon_id=di.id,
    )
    run = await _create_agent_run(db_session)

    placement = RunPlacementService(db_session)
    with pytest.raises(NoOnlineDaemonError) as ei:
        await placement.dispatch_to_daemon(run.id, user_id, workspace_id=ws.id)
    # D-008: message should mention both the requested provider and the enabled ones.
    assert "claude_code" in ei.value.message
    assert "codex" in ei.value.message


# ---- T3: Member binding exists but runtime belongs to another user -----------


@pytest.mark.asyncio
async def test_t3_member_binding_cross_user_daemon_rejected(db_session):
    """Cross-user daemon raises NoOnlineDaemonError."""
    user_id = await _create_user(db_session, suffix="owner")
    other_id = await _create_user(db_session, suffix="other")
    other_di = await _create_daemon_instance(db_session, other_id)
    await _create_runtime(db_session, other_id, daemon_instance_id=other_di.id)
    ws = await _create_workspace(
        db_session,
        user_id=user_id,
        default_agent="claude_code",
    )
    await _create_member_binding(
        db_session,
        workspace_id=ws.id,
        user_id=user_id,
        daemon_id=other_di.id,  # daemon belongs to another user
    )
    run = await _create_agent_run(db_session)

    placement = RunPlacementService(db_session)
    with pytest.raises(NoOnlineDaemonError) as ei:
        await placement.dispatch_to_daemon(run.id, user_id, workspace_id=ws.id)
    assert "离线或不存在" in ei.value.message


# ---- T4 / T5 / T7 已删除 (D-007) ---------------------------------------------
# 旧 t4 (无 binding 回退 workspace.daemon_runtime_id 全局列) / t5 (server-local
# 用 user 级在线 runtime) / t7 (decide_backend 无 binding 回退全局列) —— 全部依赖
# server-local / 全局列兜底路径，这些路径在 2026-07-10-remove-server-local-
# workspace-mode (D-007) 中已删除：所有 workspace 永远 daemon-client，无 binding
# 行即未绑定，直接抛 NoOnlineDaemonError。


# ---- T6: decide_backend with member binding (online) → DAEMON ---------------


@pytest.mark.asyncio
async def test_t6_decide_backend_member_binding_online(db_session):
    """decide_backend uses member binding's daemon_id for daemon-client ws."""
    user_id = await _create_user(db_session)
    di = await _create_daemon_instance(db_session, user_id)
    await _create_runtime(db_session, user_id, status="online", daemon_instance_id=di.id)
    ws = await _create_workspace(
        db_session,
        user_id=user_id,
    )
    await _create_member_binding(
        db_session,
        workspace_id=ws.id,
        user_id=user_id,
        daemon_id=di.id,
    )

    placement = RunPlacementService(db_session)
    backend = await placement.decide_backend(workspace_id=ws.id, user_id=user_id)
    assert backend.value == "daemon"


# ---- T7 已删除 (D-007) -------------------------------------------------------
# 旧 t7 (decide_backend 无 binding 回退全局列) —— 依赖全局列回退路径，
# D-007 删除后无 binding 行即抛 NoOnlineDaemonError，case 语义不复存在。


# ---- T8: prepare_scan_interactive_dispatch uses member binding ---------------


@pytest.mark.asyncio
async def test_t8_scan_interactive_dispatch_uses_member_binding(db_session):
    """scan interactive dispatch routes via per-member binding (daemon_id)."""
    user_id = await _create_user(db_session)
    di = await _create_daemon_instance(db_session, user_id)
    # A stray runtime on the same daemon that should NOT be selected (provider mismatch).
    _stray_rt = await _create_runtime(
        db_session, user_id, provider="claude_code", daemon_instance_id=di.id
    )
    target_rt = await _create_runtime(
        db_session, user_id, provider="codex", daemon_instance_id=di.id
    )
    ws = await _create_workspace(
        db_session,
        user_id=user_id,
    )
    await _create_member_binding(
        db_session,
        workspace_id=ws.id,
        user_id=user_id,
        daemon_id=di.id,
    )

    placement = RunPlacementService(db_session)

    # We cannot fully execute prepare_scan_interactive_dispatch in a unit test
    # because it creates a full interactive lease with workspace metadata.
    # Instead, test that _resolve_dispatch_runtime (internal helper) returns the
    # runtime matching provider="codex" via the daemon_id binding.
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    dispatch = await placement.prepare_scan_interactive_dispatch(
        agent_session_id=session_id,
        agent_run_id=run_id,
        user_id=user_id,
        provider="codex",
        prompt="scan test prompt",
        model=None,
        root_path="/tmp/scan-path",
        spec_root="/tmp/spec-root",
        workspace_id=ws.id,
    )

    assert dispatch.runtime_id == target_rt.id, (
        f"Expected runtime matching provider=codex on bound daemon, got {dispatch.runtime_id}"
    )


# ---- allowed_roots 预检 helper（task-02 / FR-04 / D-003@v2）--------------------


class TestPathDefinitivelyOutsideRoots:
    """path_definitively_outside_roots 纯函数直测（无 DB / 无 IO）。

    FR-04 边界敏感前缀包含 + D-003@v2「仅可判定越界才 True」+ NFR-01 双 OS
    路径形态。用例名含 allowed_roots 关键字，命中 verify 的
    ``-k "allowed_roots or precheck"`` 过滤。
    """

    def test_allowed_roots_path_inside_root_boundary(self):
        # /ws/root 命中根 /ws：相等或 startswith(root + sep) 才算在内（放行）
        assert path_definitively_outside_roots("/ws/root", ["/ws"]) is False

    def test_allowed_roots_exact_root_equality_allowed(self):
        # 路径与根完全相等 → 命中放行（== 分支）
        assert path_definitively_outside_roots("/ws", ["/ws"]) is False

    def test_allowed_roots_sibling_path_definitively_outside(self):
        # /ws-other/x 不在 /ws 内 → 可判定越界（True）
        assert path_definitively_outside_roots("/ws-other/x", ["/ws"]) is True

    def test_allowed_roots_sibling_prefix_string_trap(self):
        # 边界敏感："/ws-other" 不因朴素字符串前缀包含 "/ws" 被误判命中
        assert path_definitively_outside_roots("/ws-other", ["/ws"]) is True

    def test_allowed_roots_all_tilde_undecidable_passthrough(self):
        # 全 ~ 根：backend 无法展开 → 不可判定放行（daemon 终检权威，D-003@v2）
        assert path_definitively_outside_roots("/any/path", ["~/.sillyhub"]) is False

    def test_allowed_roots_empty_union_undecidable_passthrough(self):
        # 空并集 → 不可判定放行（D-003@v2）
        assert path_definitively_outside_roots("/any/path", []) is False

    def test_allowed_roots_windows_drive_case_insensitive(self):
        # Windows 形态（盘符/反斜杠）大小写不敏感命中（NFR-01）
        assert path_definitively_outside_roots("c:\\worknew\\SillyHub", ["C:\\WorkNew"]) is False

    def test_allowed_roots_windows_other_drive_rejected(self):
        # Windows 形态：不同盘 → 可判定越界（True）
        assert path_definitively_outside_roots("D:\\elsewhere", ["C:\\WorkNew"]) is True

    def test_allowed_roots_posix_case_sensitive(self):
        # POSIX 形态大小写敏感：/WS/ROOT 不算在 /ws 内（与 Windows 形态相反）
        assert path_definitively_outside_roots("/WS/ROOT", ["/ws"]) is True

    def test_allowed_roots_mixed_tilde_skipped_absolute_judged(self):
        # ~ 根跳过判定，绝对根 /ws 仍生效：越 /ws 可判定越界、命中放行
        assert path_definitively_outside_roots("/outside/x", ["~/.sillyhub", "/ws"]) is True
        assert path_definitively_outside_roots("/ws/x", ["~/.sillyhub", "/ws"]) is False


@pytest.mark.asyncio
async def test_fetch_daemon_allowed_roots_union_instance_and_runtimes(db_session):
    """instance.allowed_roots ∪ 名下全部 runtimes.allowed_roots 并集（FR-04 / D-003@v2）。"""
    user_id = await _create_user(db_session, suffix="roots")
    di = await _create_daemon_instance(db_session, user_id)
    # instance 根行内赋值（覆盖默认 ["~/.sillyhub"]）。
    di.allowed_roots = ["/ws/instance"]
    db_session.add(di)
    # 同 instance 多 runtime 全收 + 跨 runtime 去重保序（instance 根在前）。
    rt1 = await _create_runtime(db_session, user_id, daemon_instance_id=di.id)
    rt1.allowed_roots = ["/ws/rt1", "/ws/shared"]
    db_session.add(rt1)
    rt2 = await _create_runtime(db_session, user_id, provider="codex", daemon_instance_id=di.id)
    rt2.allowed_roots = ["/ws/shared"]
    db_session.add(rt2)
    # nullable 列 NULL 行 → 容忍跳过不崩。
    rt_null = await _create_runtime(
        db_session, user_id, provider="hermes", daemon_instance_id=di.id
    )
    rt_null.allowed_roots = None
    db_session.add(rt_null)
    # 其它 instance 名下的 runtime → 不并入（WHERE daemon_instance_id 过滤）。
    stray_di = await _create_daemon_instance(db_session, user_id)
    stray_rt = await _create_runtime(db_session, user_id, daemon_instance_id=stray_di.id)
    stray_rt.allowed_roots = ["/ws/other-instance"]
    db_session.add(stray_rt)
    await db_session.commit()

    roots = await fetch_daemon_allowed_roots(db_session, di.id)

    assert roots == ["/ws/instance", "/ws/rt1", "/ws/shared"]


@pytest.mark.asyncio
async def test_fetch_daemon_allowed_roots_instance_row_missing_returns_runtime_union(db_session):
    """instance 行缺失不视为空整体：返回 runtime 并集（task-02 / FR-04）。"""
    user_id = await _create_user(db_session, suffix="miss")
    # 无 instance 行的孤儿 runtime（SQLite 测试库不强制 FK，可直接挂随机 id）。
    missing_id = uuid.uuid4()
    rt = await _create_runtime(db_session, user_id, daemon_instance_id=missing_id)
    rt.allowed_roots = ["/ws/rt-only"]
    db_session.add(rt)
    await db_session.commit()

    roots = await fetch_daemon_allowed_roots(db_session, missing_id)

    assert roots == ["/ws/rt-only"]


# ---- 双源同序（task-04 / FR-03 / D-005@v1）--------------------------------------


async def _seed_two_member_two_machine_ws(db_session, *, heartbeat_a, heartbeat_b):
    """同工作区两成员各绑一台在线机器（心跳可控），返回解析所需句柄。"""
    user_a = await _create_user(db_session, suffix="duo-a")
    user_b = await _create_user(db_session, suffix="duo-b")
    di_a = await _create_daemon_instance(db_session, user_a, heartbeat=heartbeat_a)
    di_b = await _create_daemon_instance(db_session, user_b, heartbeat=heartbeat_b)
    await _create_runtime(db_session, user_a, daemon_instance_id=di_a.id)
    await _create_runtime(db_session, user_b, daemon_instance_id=di_b.id)
    ws = await _create_workspace(db_session, user_id=user_a, default_agent="claude_code")
    await _create_member_binding(db_session, ws.id, user_a, daemon_id=di_a.id)
    await _create_member_binding(db_session, ws.id, user_b, daemon_id=di_b.id)
    return user_a, di_a, di_b, ws


@pytest.mark.asyncio
async def test_dual_source_resolution_converges_same_daemon(db_session):
    """双源同序（FR-03 / D-005@v1）：多成员多机绑定均在线时，
    resolve_representative_binding（钉定链路）与 resolve_daemon_instance_for_workspace
    （host_fs worktree 路由）返回同一 daemon_instance_id——统一全序
    ``ORDER BY 实例心跳 DESC, daemon_id ASC`` 下实例心跳较新的机器（di_b）双源同选。"""
    older = datetime(2026, 8, 28, 10, 0, 0, tzinfo=UTC)
    newer = datetime(2026, 8, 28, 11, 0, 0, tzinfo=UTC)
    user_a, di_a, di_b, ws = await _seed_two_member_two_machine_ws(
        db_session, heartbeat_a=older, heartbeat_b=newer
    )

    rep = await resolve_representative_binding(db_session, ws.id, user_a, "claude_code")
    routed = await resolve_daemon_instance_for_workspace(db_session, ws.id)

    # 心跳全序：di_b（较新）在两源中均胜出，且两源收敛同机。
    assert rep is not None
    assert uuid.UUID(str(rep["daemon_instance_id"])) == di_b.id
    assert routed == di_b.id
    assert routed == uuid.UUID(str(rep["daemon_instance_id"]))
    assert routed != di_a.id


@pytest.mark.asyncio
async def test_dual_source_tie_heartbeat_daemon_id_asc_tiebreak(db_session):
    """心跳并列 tie-break（FR-03 验收）：两台绑定机器实例心跳完全相同时，
    ``daemon_id ASC`` 升序取 id 较小者——两解析源同取同一行，结果确定。"""
    tied = datetime(2026, 8, 28, 12, 0, 0, tzinfo=UTC)
    user_a, di_a, di_b, ws = await _seed_two_member_two_machine_ws(
        db_session, heartbeat_a=tied, heartbeat_b=tied
    )
    # CHAR(32) hex 字典升序 == 等宽小写 hex 的数值序，与 SQL ASC 一致。
    expected = min(di_a.id, di_b.id)

    rep = await resolve_representative_binding(db_session, ws.id, user_a, "claude_code")
    routed = await resolve_daemon_instance_for_workspace(db_session, ws.id)

    assert rep is not None
    assert uuid.UUID(str(rep["daemon_instance_id"])) == expected
    assert routed == expected
