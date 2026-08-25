"""dispatch_worker 子会话三元组派发单测（task-05 / FR-02 / D-001@v1 / D-004@v1）。

change ``2026-08-25-team-subsession-governance`` task-05 / design §5.B：

``mcp_tools._dispatch_worker_core`` 执行段从「建 batch AgentRun +
MissionExecutionService.dispatch_worker」整体切换为子会话三元组——
AgentSession(parent_session_id=主控会话, user_id=mission.created_by) +
interactive lease(kind=interactive, metadata.stage=mission_worker, metadata.role) +
首 run(mission_id+role 双标记) 同事务原子提交；前置治理段逐项保留。

覆盖（TaskCard acceptance）：

- 三元组落库——parent/owner/stage/双标记/AgentRunWorkspace 关联行齐；
  首 prompt = build_worker_briefing（含 worker_done 用法）；worker_prompt
  显式覆写优先；worktree 副本路径进 lease metadata cwd。
- 拒绝路径——scope 越界 400 / 跨 ws 无权限 403 / 治理门 400 / 无在线绑定 422，
  均不建子会话不建 run。
- worktree 失败——分身首 run failed(worktree_create_failed) + finished_at +
  error_code，子会话收口终态，mission 不崩可继续派发。
- runtime 解析——anchor 自有 runtime 在线优先；无自有时跨 ws 代表 binding
  钉定（pinned_skip_owner_check，落代表机器）。
- 路由族同构——显式路由（ws+mid）与 header 会话族（/sessions/{sid}/...）
  三元组同构。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.execution import MISSION_WORKER_STAGE
from app.modules.agent.model import AgentMission, AgentRun, AgentSession
from app.modules.daemon.model import DaemonTaskLease
from app.modules.workspace.model import Workspace

_TS = "2026-08-25T00:00:00+00:00"


# ---------------------------------------------------------------------------
# Seed helpers
# ---------------------------------------------------------------------------


async def _make_user(db: AsyncSession, *, admin: bool = False) -> uuid.UUID:
    from app.modules.auth.model import User

    user = User(
        id=uuid.uuid4(),
        email=f"u-{uuid.uuid4().hex[:10]}@example.com",
        password_hash="x",
        display_name="u",
        status="active",
        is_platform_admin=admin,
    )
    db.add(user)
    await db.commit()
    return user.id


async def _stub_online_runtime(
    db: AsyncSession, *, user_id: uuid.UUID, provider: str = "claude"
) -> dict:
    """造一台在线机器（instance online + runtime online，归 user）。"""
    di_id = uuid.uuid4()
    rt_id = uuid.uuid4()
    await db.execute(
        text(
            "INSERT INTO daemon_instances (id, user_id, hostname, server_url, allowed_roots, status, created_at, updated_at)"
            " VALUES (:id, :uid, 'h1', 'http://t', '[\"~/.sillyhub\"]', 'online', :ts, :ts)"
        ),
        {"id": di_id.hex, "uid": user_id.hex, "ts": _TS},
    )
    await db.execute(
        text(
            "INSERT INTO daemon_runtimes (id, user_id, daemon_instance_id, provider, status, last_heartbeat_at, created_at, updated_at)"
            " VALUES (:id, :uid, :di, :prov, 'online', :ts, :ts, :ts)"
        ),
        {"id": rt_id.hex, "uid": user_id.hex, "di": di_id.hex, "prov": provider, "ts": _TS},
    )
    await db.commit()
    return {"runtime_id": rt_id, "daemon_id": di_id}


async def _stub_member_binding(
    db: AsyncSession, ws_id: uuid.UUID, user_id: uuid.UUID, daemon_id: uuid.UUID
) -> None:
    """工作区成员机器绑定行（resolve_representative_binding 命中用）。"""
    await db.execute(
        text(
            "INSERT INTO workspace_member_runtimes (workspace_id, user_id, root_path, path_source, daemon_id, shared, created_at, updated_at)"
            " VALUES (:wid, :uid, '/tmp/w', 'manual', :di, false, :ts, :ts)"
        ),
        {"wid": ws_id.hex, "uid": user_id.hex, "di": daemon_id.hex, "ts": _TS},
    )
    await db.commit()


async def _grant_ws_permission(
    db: AsyncSession, *, user_id: uuid.UUID, workspace_id: uuid.UUID
) -> None:
    """给用户在指定 workspace 授 WORKSPACE_WRITE（RBAC 三行，test_mission_access_control 同款）。"""
    from datetime import datetime as _dt

    from app.modules.auth.model import Role, RolePermission, UserWorkspaceRole

    role_id = uuid.uuid4()
    db.add(
        Role(
            id=role_id,
            key=f"role-{role_id.hex[:8]}",
            name=f"Role {role_id.hex[:8]}",
            description="test role",
        )
    )
    db.add(RolePermission(role_id=role_id, permission="workspace:write"))
    db.add(
        UserWorkspaceRole(
            user_id=user_id,
            workspace_id=workspace_id,
            role_id=role_id,
            granted_by=None,
            granted_at=_dt.now(UTC),
        )
    )


async def _seed_context(
    db: AsyncSession, *, with_own_runtime: bool = True
) -> tuple[Workspace, AgentSession, AgentMission, uuid.UUID, dict | None]:
    """主控会话 + mission（session 锚 + created_by）+（可选）创建者自有在线 runtime。"""
    owner_id = await _make_user(db)
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:8]}",
        slug=f"ws-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{uuid.uuid4().hex[:8]}",
        default_branch="main",
        default_agent="claude",
        status="active",
    )
    db.add(ws)
    main_session = AgentSession(
        user_id=owner_id,
        provider="claude",
        status="active",
        turn_count=1,
    )
    db.add(main_session)
    await db.flush()
    mission = AgentMission(
        workspace_id=ws.id,
        objective="团队目标",
        session_id=main_session.id,
        created_by=owner_id,
        constraints={"mode": "team"},
    )
    db.add(mission)
    await db.commit()
    await db.refresh(main_session)
    await db.refresh(mission)

    own_rt: dict | None = None
    if with_own_runtime:
        own_rt = await _stub_online_runtime(db, user_id=owner_id)
        await _stub_member_binding(db, ws.id, owner_id, own_rt["daemon_id"])
    return ws, main_session, mission, owner_id, own_rt


def _mock_worktree_delegate(
    monkeypatch: pytest.MonkeyPatch, *, probe: str = "git", worktree_ok: bool = True
) -> MagicMock:
    """接管 mcp_tools 的 host_fs delegate（三态探测 + git_worktree_add 均 mock）。"""
    delegate = MagicMock()
    delegate.probe_workspace_git_mode = AsyncMock(return_value=probe)
    delegate.git_worktree_add = AsyncMock(
        return_value={"ok": worktree_ok, "worktree_path": None, "error": None}
    )
    monkeypatch.setattr("app.modules.agent.mcp_tools.new_host_fs_delegate", lambda _s: delegate)
    return delegate


def _mock_wake_delivered(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    """notify_interactive_dispatch 固定 True（测试环境无 WS 连接）。"""
    from app.modules.agent.placement import RunPlacementService

    mock = AsyncMock(return_value=True)
    monkeypatch.setattr(RunPlacementService, "notify_interactive_dispatch", mock)
    return mock


def _auth_bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _token_for(user_id: uuid.UUID, *, admin: bool = False) -> str:
    from app.core.config import get_settings
    from app.core.security import create_access_token
    from app.modules.auth.model import User

    _ = User  # 仅示意 import 路径可达
    token, _ = create_access_token(
        user_id=user_id,
        email=f"{user_id.hex[:8]}@example.com",
        is_admin=admin,
        settings=get_settings(),
    )
    return token


async def _lease(db: AsyncSession, lease_id: uuid.UUID) -> DaemonTaskLease:
    lease = await db.get(DaemonTaskLease, lease_id)
    assert lease is not None
    return lease


def _lease_meta(lease: DaemonTaskLease) -> dict:
    raw = lease.metadata_
    if isinstance(raw, str):
        return json.loads(raw)
    return dict(raw or {})


async def _count_subsessions(db: AsyncSession, main_session_id: uuid.UUID) -> int:
    rows = (
        (
            await db.execute(
                select(AgentSession).where(AgentSession.parent_session_id == main_session_id)
            )
        )
        .scalars()
        .all()
    )
    return len(list(rows))


async def _worker_runs(db: AsyncSession, mission_id: uuid.UUID) -> list[AgentRun]:
    rows = (
        (
            await db.execute(
                select(AgentRun).where(
                    AgentRun.mission_id == mission_id, AgentRun.role != "orchestrator"
                )
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


# ---------------------------------------------------------------------------
# 三元组落库（成功路径）
# ---------------------------------------------------------------------------


class TestSubsessionTriple:
    @pytest.mark.asyncio
    async def test_dispatch_creates_subsession_triple(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        """显式路由派发 → 子会话三元组齐：parent/owner/lease stage+role/首 run 双标记/关联行。"""
        ws, main_session, mission, owner_id, own_rt = await _seed_context(db_session)
        assert own_rt is not None
        delegate = _mock_worktree_delegate(monkeypatch)
        _mock_wake_delivered(monkeypatch)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/missions/{mission.id}/dispatch_worker",
            json={"objective": "扫描架构", "role": "arch"},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["role"] == "arch"
        assert data["objective"] == "扫描架构"
        assert data["status"] == "pending"
        assert data["lease_id"]

        # 子会话行：parent=主控会话、owner=mission.created_by、三元组绑定字段已回填
        sub_sessions = (
            (
                await db_session.execute(
                    select(AgentSession).where(AgentSession.parent_session_id == main_session.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(sub_sessions) == 1
        sub = sub_sessions[0]
        assert sub.user_id == owner_id
        assert sub.status == "active"
        assert sub.lease_id == uuid.UUID(data["lease_id"])
        assert sub.runtime_id == own_rt["runtime_id"]
        assert sub.worker_done_at is None

        # interactive lease：kind/stage/role/prompt（分身简报）
        lease = await _lease(db_session, uuid.UUID(data["lease_id"]))
        assert lease.kind == "interactive"
        assert lease.runtime_id == own_rt["runtime_id"]
        meta = _lease_meta(lease)
        assert meta["stage"] == MISSION_WORKER_STAGE
        assert meta["role"] == "arch"
        assert "worker_done" in meta["prompt"]
        assert "扫描架构" in meta["prompt"]
        # git 模式：worktree 副本路径进 lease metadata（claim payload root_path 源）
        delegate.git_worktree_add.assert_awaited_once()
        assert meta["cwd"], "worktree 副本路径应写入 lease metadata cwd"
        assert meta["cwd"].endswith(f".worktrees/{data['id'][:8]}")

        # 首 run：mission_id + role 双标记 + 子会话锚 + worktree_branch（git 自建副本）
        runs = await _worker_runs(db_session, mission.id)
        assert len(runs) == 1
        run = runs[0]
        assert run.id == uuid.UUID(data["id"])
        assert run.agent_session_id == sub.id
        assert run.objective == "扫描架构"
        assert run.worktree_branch == f"workers/{str(run.id)[:8]}"

        # AgentRunWorkspace 关联行（anchor）
        from app.modules.workspace.model import AgentRunWorkspace

        links = (
            (
                await db_session.execute(
                    select(AgentRunWorkspace).where(AgentRunWorkspace.agent_run_id == run.id)
                )
            )
            .scalars()
            .all()
        )
        assert {ln.workspace_id for ln in links} == {ws.id}

    @pytest.mark.asyncio
    async def test_dispatch_header_session_route_family_isomorphic(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        """header 会话族（/sessions/{sid}/missions/dispatch_worker + X-Session-Id）三元组同构。"""
        _ws, main_session, mission, _owner, own_rt = await _seed_context(db_session)
        assert own_rt is not None
        _mock_worktree_delegate(monkeypatch)
        _mock_wake_delivered(monkeypatch)

        resp = await client.post(
            f"/api/sessions/{main_session.id}/missions/dispatch_worker",
            json={"objective": "做事"},
            headers={**auth_headers, "X-Session-Id": str(main_session.id)},
        )
        assert resp.status_code == 201, resp.text
        assert await _count_subsessions(db_session, main_session.id) == 1
        runs = await _worker_runs(db_session, mission.id)
        assert len(runs) == 1
        assert runs[0].role == "worker"  # role 缺省兜底 _DEFAULT_WORKER_ROLE
        assert runs[0].mission_id == mission.id
        lease = await _lease(db_session, uuid.UUID(resp.json()["lease_id"]))
        assert _lease_meta(lease)["stage"] == MISSION_WORKER_STAGE

    @pytest.mark.asyncio
    async def test_dispatch_worker_prompt_override_wins(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        """payload.worker_prompt 显式覆写优先（caller 注入约束，D-001 方案A）。"""
        ws, _main, mission, _owner, _rt = await _seed_context(db_session)
        _mock_worktree_delegate(monkeypatch)
        _mock_wake_delivered(monkeypatch)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/missions/{mission.id}/dispatch_worker",
            json={
                "objective": "o",
                "worktree_path": "/tmp/caller-wt",
                "worker_prompt": "不 commit",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        lease = await _lease(db_session, uuid.UUID(resp.json()["lease_id"]))
        meta = _lease_meta(lease)
        assert meta["prompt"] == "不 commit"
        # 路径A：caller worktree 直接作子会话 cwd（lease metadata cwd）
        assert meta["cwd"] == "/tmp/caller-wt"

    @pytest.mark.asyncio
    async def test_dispatch_direct_mode_skips_worktree(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        """探测=direct → 不建副本、briefing 渲染直通约束变体。"""
        from app.modules.agent.mission_context import build_worker_briefing

        ws, _main, mission, _owner, _rt = await _seed_context(db_session)
        delegate = _mock_worktree_delegate(monkeypatch, probe="direct")
        _mock_wake_delivered(monkeypatch)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/missions/{mission.id}/dispatch_worker",
            json={"objective": "直通任务"},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        delegate.git_worktree_add.assert_not_awaited()
        lease = await _lease(db_session, uuid.UUID(resp.json()["lease_id"]))
        meta = _lease_meta(lease)
        # task-09（can_dispatch 接线）：一层分身（new_tree_depth=1 < 2）非叶，
        # 简报追加「可派工到下一层」段（task-08 契约，D-002@v1 非叶五件工具）。
        assert "可派工到下一层" in meta["prompt"]
        assert meta["prompt"] == build_worker_briefing(
            objective="直通任务", role="worker", mode="direct", can_dispatch=True
        )
        runs = await _worker_runs(db_session, mission.id)
        assert runs[0].worktree_branch is None  # direct 旁路不写 branch（D-007@v1）


# ---------------------------------------------------------------------------
# 拒绝路径：不建会话不建 run
# ---------------------------------------------------------------------------


class TestRejectPaths:
    @pytest.mark.asyncio
    async def test_scope_violation_400_creates_nothing(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        ws, main_session, mission, _owner, _rt = await _seed_context(db_session)
        outsider_ws = uuid.uuid4()
        resp = await client.post(
            f"/api/workspaces/{ws.id}/missions/{mission.id}/dispatch_worker",
            json={"objective": "o", "target_workspace_id": str(outsider_ws)},
            headers=auth_headers,
        )
        assert resp.status_code == 400, resp.text
        assert "mission_target_out_of_scope" in resp.text
        assert await _count_subsessions(db_session, main_session.id) == 0
        assert await _worker_runs(db_session, mission.id) == []

    @pytest.mark.asyncio
    async def test_cross_ws_without_permission_403_creates_nothing(
        self, client, db_session, monkeypatch
    ) -> None:
        """BE-P0-2：JWT 用户对 target 无 WORKSPACE_WRITE → 403，不建子会话。"""
        owner_id = await _make_user(db_session)  # 非 admin，只授 anchor 写权限
        anchor = Workspace(
            id=uuid.uuid4(),
            name="a",
            slug=f"a-{uuid.uuid4().hex[:8]}",
            root_path="/tmp/a",
            status="active",
        )
        target = Workspace(
            id=uuid.uuid4(),
            name="t",
            slug=f"t-{uuid.uuid4().hex[:8]}",
            root_path="/tmp/t",
            status="active",
        )
        db_session.add_all([anchor, target])
        await db_session.flush()
        await _grant_ws_permission(db_session, user_id=owner_id, workspace_id=anchor.id)
        main_session = AgentSession(
            user_id=owner_id, provider="claude", status="active", turn_count=1
        )
        db_session.add(main_session)
        await db_session.flush()
        mission = AgentMission(
            workspace_id=anchor.id,
            objective="o",
            session_id=main_session.id,
            created_by=owner_id,
            scope_workspace_ids=[str(anchor.id), str(target.id)],
        )
        db_session.add(mission)
        await db_session.commit()

        _mock_worktree_delegate(monkeypatch)  # 即便误入执行段也不碰真 delegate
        resp = await client.post(
            f"/api/workspaces/{anchor.id}/missions/{mission.id}/dispatch_worker",
            json={"objective": "o", "target_workspace_id": str(target.id)},
            headers=_auth_bearer(_token_for(owner_id)),
        )
        assert resp.status_code == 403, resp.text
        assert "mission_target_forbidden" in resp.text
        assert await _count_subsessions(db_session, main_session.id) == 0
        assert await _worker_runs(db_session, mission.id) == []

    @pytest.mark.asyncio
    async def test_governance_gate_400_creates_nothing(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        ws, main_session, mission, _owner, _rt = await _seed_context(db_session)
        from app.modules.agent.control import MissionControlService

        monkeypatch.setattr(
            MissionControlService,
            "can_dispatch_worker",
            AsyncMock(return_value=(False, "max_workers_reached")),
        )
        resp = await client.post(
            f"/api/workspaces/{ws.id}/missions/{mission.id}/dispatch_worker",
            json={"objective": "o"},
            headers=auth_headers,
        )
        assert resp.status_code == 400, resp.text
        assert "mcp_dispatch_worker_rejected" in resp.text
        assert await _count_subsessions(db_session, main_session.id) == 0
        assert await _worker_runs(db_session, mission.id) == []

    @pytest.mark.asyncio
    async def test_no_online_binding_422_creates_nothing(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        ws, main_session, mission, _owner, _own = await _seed_context(
            db_session, with_own_runtime=False
        )
        _mock_worktree_delegate(monkeypatch)
        resp = await client.post(
            f"/api/workspaces/{ws.id}/missions/{mission.id}/dispatch_worker",
            json={"objective": "o"},
            headers=auth_headers,
        )
        assert resp.status_code == 422, resp.text
        assert "在线机器绑定" in resp.json()["message"]
        assert await _count_subsessions(db_session, main_session.id) == 0
        assert await _worker_runs(db_session, mission.id) == []


# ---------------------------------------------------------------------------
# worktree 失败语义
# ---------------------------------------------------------------------------


class TestWorktreeFailure:
    @pytest.mark.asyncio
    async def test_worktree_failure_marks_first_run_failed_and_session_terminal(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        ws, main_session, mission, _owner, _rt = await _seed_context(db_session)
        _mock_worktree_delegate(monkeypatch, worktree_ok=False)
        _mock_wake_delivered(monkeypatch)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/missions/{mission.id}/dispatch_worker",
            json={"objective": "o", "role": "arch"},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["status"] == "failed"
        assert data["error_code"] == "worktree_create_failed"

        runs = await _worker_runs(db_session, mission.id)
        assert len(runs) == 1
        run = runs[0]
        assert run.status == "failed"
        assert run.error_code == "worktree_create_failed"
        assert run.finished_at is not None

        # 子会话不残留活跃态（failed + ended）
        sub_sessions = (
            (
                await db_session.execute(
                    select(AgentSession).where(AgentSession.parent_session_id == main_session.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(sub_sessions) == 1
        assert sub_sessions[0].status == "failed"
        assert sub_sessions[0].ended_at is not None

        # mission 不崩（仍活跃未收敛），可继续派发
        await db_session.refresh(mission)
        assert mission.converged_at is None
        assert mission.cancelled_at is None

        # 无 interactive lease 残留（worktree 失败先于 lease 创建）
        assert (await db_session.execute(select(DaemonTaskLease))).scalars().first() is None


# ---------------------------------------------------------------------------
# 2026-08-26 审计修复 F06（docs/qa/subsession-backend-audit-2026-08-26.md §A.9）：
# commit#1 之后的元数据合并 / 绑定回填 / 末次 commit 段异常 → 收敛终态，
# 不残留「pending session + run 无 lease」半孤儿。
# ---------------------------------------------------------------------------


class TestDispatchFinalizeFailure:
    @pytest.mark.asyncio
    async def test_finalize_exception_converges_terminal_no_half_orphan(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        """``_merge_lease_metadata`` 抛异常（commit#1 之后）→ rollback 掉未提交
        lease/metadata 后按 ``_fail_worker_subsession`` 收敛：run failed
        （dispatch_finalize_exception）+ session failed 终态，无 lease 行、无首
        prompt user_input 日志行——不占 MAX_WORKERS、不阻塞 converge。"""
        import app.modules.daemon.session.service as _lease_svc_mod

        async def _boom(*_args, **_kwargs):
            raise RuntimeError("lease metadata merge exploded")

        monkeypatch.setattr(_lease_svc_mod, "_merge_lease_metadata", _boom)
        ws, main_session, mission, _owner, _rt = await _seed_context(db_session)
        _mock_worktree_delegate(monkeypatch)
        _mock_wake_delivered(monkeypatch)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/missions/{mission.id}/dispatch_worker",
            json={"objective": "o", "role": "arch"},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["status"] == "failed"
        assert data["error_code"] == "dispatch_finalize_exception"

        # 首 run：failed 终态 + error_code + finished_at（不残留 pending 占额度）
        runs = await _worker_runs(db_session, mission.id)
        assert len(runs) == 1
        run = runs[0]
        assert run.status == "failed"
        assert run.error_code == "dispatch_finalize_exception"
        assert run.finished_at is not None

        # 子会话：failed + ended_at（不残留活跃/待定态）
        sub_sessions = (
            (
                await db_session.execute(
                    select(AgentSession).where(AgentSession.parent_session_id == main_session.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(sub_sessions) == 1
        assert sub_sessions[0].status == "failed"
        assert sub_sessions[0].ended_at is not None
        assert sub_sessions[0].lease_id is None

        # lease（flush-only 未提交）随 rollback 消失——无「pending 无 lease」孤儿
        assert (await db_session.execute(select(DaemonTaskLease))).scalars().first() is None

        # 首 prompt 的 user_input 日志行未提交（无残留半成品）
        from app.modules.agent.model import AgentRunLog

        assert (
            await db_session.execute(select(AgentRunLog).where(AgentRunLog.run_id == run.id))
        ).scalars().first() is None

        # mission 不崩（仍活跃未收敛），可继续派发
        await db_session.refresh(mission)
        assert mission.converged_at is None
        assert mission.cancelled_at is None


# ---------------------------------------------------------------------------
# runtime 解析：anchor 自有优先 / 跨 ws 代表钉定
# ---------------------------------------------------------------------------


class TestRuntimePinning:
    @pytest.mark.asyncio
    async def test_cross_ws_target_pinned_to_representative_machine(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        """无自有 runtime → 跨 ws target 经代表 binding 钉定落代表机器（跳属主校验）。"""
        ws, _main, mission, _owner, _ = await _seed_context(db_session, with_own_runtime=False)
        target = Workspace(
            id=uuid.uuid4(),
            name="target",
            slug=f"t-{uuid.uuid4().hex[:8]}",
            root_path="/tmp/target",
            status="active",
        )
        db_session.add(target)
        await db_session.flush()
        mission.scope_workspace_ids = [str(ws.id), str(target.id)]
        db_session.add(mission)
        await db_session.commit()

        # target ws 的代表机器：第三方用户的在线 runtime + 成员绑定
        rep_owner = await _make_user(db_session)
        rep_rt = await _stub_online_runtime(db_session, user_id=rep_owner)
        await _stub_member_binding(db_session, target.id, rep_owner, rep_rt["daemon_id"])

        _mock_worktree_delegate(monkeypatch)
        _mock_wake_delivered(monkeypatch)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/missions/{mission.id}/dispatch_worker",
            json={"objective": "跨区任务", "target_workspace_id": str(target.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        lease = await _lease(db_session, uuid.UUID(resp.json()["lease_id"]))
        assert lease.runtime_id == rep_rt["runtime_id"], "代表钉定应落目标工作区代表机器"

        # 首 run 落 target 列 + anchor/target 双关联行
        runs = await _worker_runs(db_session, mission.id)
        assert runs[0].target_workspace_id == target.id
        from app.modules.workspace.model import AgentRunWorkspace

        links = (
            (
                await db_session.execute(
                    select(AgentRunWorkspace).where(AgentRunWorkspace.agent_run_id == runs[0].id)
                )
            )
            .scalars()
            .all()
        )
        assert {ln.workspace_id for ln in links} == {ws.id, target.id}

    @pytest.mark.asyncio
    async def test_own_runtime_preferred_over_representative(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        """anchor 本机自有 runtime 在线时优先于代表 binding。"""
        ws, _main, mission, _owner, own_rt = await _seed_context(db_session)
        # 同工作区再造一台第三方代表机器（heartbeat 更新），自有仍应优先
        rep_owner = await _make_user(db_session)
        rep_rt = await _stub_online_runtime(db_session, user_id=rep_owner)
        await _stub_member_binding(db_session, ws.id, rep_owner, rep_rt["daemon_id"])
        await db_session.execute(
            text("UPDATE daemon_runtimes SET last_heartbeat_at = :ts WHERE id = :rid"),
            {"ts": datetime.now(UTC).isoformat(), "rid": rep_rt["runtime_id"].hex},
        )
        await db_session.commit()

        _mock_worktree_delegate(monkeypatch)
        _mock_wake_delivered(monkeypatch)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/missions/{mission.id}/dispatch_worker",
            json={"objective": "o"},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        assert own_rt is not None
        lease = await _lease(db_session, uuid.UUID(resp.json()["lease_id"]))
        assert lease.runtime_id == own_rt["runtime_id"]
