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
- runtime 解析（2026-08-28-fix-cross-machine-worker-dispatch task-04 重写）——
  目标工作区代表绑定机器唯一钉定（FR-01/D-001@v1：anchor 自有 runtime 在线
  抢占分支已删，owner 机器仅在恰为绑定机器时使用）；两段式 provider 预检
  （FR-02）与 allowed_roots 可判定越界 400 预检（FR-04）另设用例。
- 路由族同构——显式路由（ws+mid）与 header 会话族（/sessions/{sid}/...）
  三元组同构。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.execution import MISSION_WORKER_STAGE
from app.modules.agent.model import AgentMission, AgentRun, AgentSession
from app.modules.daemon.model import DaemonTaskLease
from app.modules.workspace.model import Workspace

_TS = "2026-08-25T00:00:00+00:00"


@pytest.fixture(autouse=True)
def _ws_alive_hub(monkeypatch: pytest.MonkeyPatch) -> None:
    """task-02 placement 实连接过滤：测试只灌 DB online，fake hub 使候选行视为实连。

    ``placement._runtime_row_ws_alive`` 对候选行联查 ws_hub 单例的
    ``is_connected``，测试环境无真 WS 连接会把 DB-online 候选行全剔除（派发
    runtime 解析返 None → run failed）。照 test_worker_subsession_lifecycle
    ``_recording_ws_hub`` 先例 patch 模块级 ``get_daemon_ws_hub`` 返恒在线假
    hub（placement 为函数级 lazy import，patch 模块属性即生效）。
    """
    from app.modules.daemon import ws_hub as ws_hub_mod

    class _AliveHub:
        def is_connected(self, daemon_id):
            return True  # DB-online 候选行一律视为 WS 实连

        async def send_wakeup(self, daemon_id, **kwargs):
            return True

        async def send_session_control(self, daemon_id, msg_type, payload):
            return True

        async def send_to_runtime(self, daemon_id, message):
            return True

        async def send_rpc(self, daemon_id, method, params, *, timeout=None):
            # 测试环境无真 socket：host_fs RPC 实发按真实 hub 离线语义抛
            # DaemonRuntimeOffline（delegate._via_rpc_or_degrade 捕获降级——
            # 真 delegate 用例维持「worktree 阶段失败」形态）。
            from app.modules.daemon.service import DaemonRuntimeOffline

            raise DaemonRuntimeOffline(
                f"daemon '{daemon_id}' WS send failed (offline).",
                details={"daemon_id": str(daemon_id)},
            )

    monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: _AliveHub())


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
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    provider: str = "claude",
    heartbeat: str | None = None,
    allowed_roots: list[str] | None = None,
    runtime_allowed_roots: list[str] | None = None,
) -> dict:
    """造一台在线机器（instance online + runtime online，归 user）。

    task-04（2026-08-28-fix-cross-machine-worker-dispatch）：新增三处可控项——

    - ``heartbeat``：daemon_instances.last_heartbeat_at（缺省 None=保持旧行为
      NULL；双源全序 D-005@v1 以实例心跳为主序，多机形态必须显式设心跳消除
      daemon_id 随机 tie-break 的 flaky）；
    - ``allowed_roots`` / ``runtime_allowed_roots``：instance 行与 runtime 行的
      allowed_roots JSON 列（A3 预检形态用；缺省 None=旧行为 instance
      ``["~/.sillyhub"]`` 单根 + runtime 行 NULL，raw INSERT 漏列即 NULL）。
    """
    di_id = uuid.uuid4()
    rt_id = uuid.uuid4()
    roots_json = json.dumps(allowed_roots) if allowed_roots is not None else '["~/.sillyhub"]'
    rt_roots_json = json.dumps(runtime_allowed_roots) if runtime_allowed_roots is not None else None
    await db.execute(
        text(
            "INSERT INTO daemon_instances (id, user_id, hostname, server_url, allowed_roots, status, last_heartbeat_at, created_at, updated_at)"
            " VALUES (:id, :uid, 'h1', 'http://t', :roots, 'online', :hb, :ts, :ts)"
        ),
        {"id": di_id.hex, "uid": user_id.hex, "roots": roots_json, "hb": heartbeat, "ts": _TS},
    )
    await db.execute(
        text(
            "INSERT INTO daemon_runtimes (id, user_id, daemon_instance_id, provider, allowed_roots, status, last_heartbeat_at, created_at, updated_at)"
            " VALUES (:id, :uid, :di, :prov, :rt_roots, 'online', :ts, :ts, :ts)"
        ),
        {
            "id": rt_id.hex,
            "uid": user_id.hex,
            "di": di_id.hex,
            "prov": provider,
            "rt_roots": rt_roots_json,
            "ts": _TS,
        },
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
    db: AsyncSession,
    *,
    with_own_runtime: bool = True,
    bind_own_runtime: bool = True,
    ws_created_by: uuid.UUID | None = None,
) -> tuple[Workspace, AgentSession, AgentMission, uuid.UUID, dict | None]:
    """主控会话 + mission（session 锚 + created_by）+（可选）创建者自有在线 runtime。

    task-04（2026-08-28-fix-cross-machine-worker-dispatch）夹具微调（仅解耦所需）：

    - ``bind_own_runtime=False``：owner 在线机器**不建** workspace_member_runtimes
      绑定行——解耦「自有 online runtime」与「owner 绑定」（FR-01 QM 场景：
      owner 机器在线但未绑目标工作区，旧 own_rt 抢占分支的翻案复刻）；
    - ``ws_created_by``：设 workspaces.created_by（分支1 预检走 created_by 匹配、
      分支2 走心跳序，design 风险登记明示两分支需可独立构造）。
    """
    owner_id = await _make_user(db)
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:8]}",
        slug=f"ws-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/{uuid.uuid4().hex[:8]}",
        default_branch="main",
        default_agent="claude",
        status="active",
        created_by=ws_created_by,
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
        if bind_own_runtime:
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


def _mcp_tools_log_spy(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    """替换 ``mcp_tools.log`` 为 spy 捕获 ``placement_provider_fallback`` 等事件。

    structlog 经 ``PrintLoggerFactory`` 直写 stderr，pytest ``caplog`` 抓不到
    （同 ``test_terminating_at_lifecycle._patch_logger_spy`` 既有注释）；替换模块级
    ``log`` 符号是最稳健的捕获方式（方法调用时按模块 globals 解析，monkeypatch
    生效）。A1 用例以此断言「严格命中无回退日志 / 回退命中打点可观测」。
    """
    import app.modules.agent.mcp_tools as mcp_tools_mod

    spy = MagicMock()
    monkeypatch.setattr(mcp_tools_mod, "log", spy)
    return spy


def _fallback_warning_calls(spy: MagicMock) -> list:
    """从 log spy 中筛出 ``placement_provider_fallback`` warning 调用。"""
    return [
        call
        for call in spy.warning.call_args_list
        if call.args and call.args[0] == "placement_provider_fallback"
    ]


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


async def _sub_session_lease_id(db: AsyncSession, parent_id: uuid.UUID) -> uuid.UUID:
    """获取最新子会话的 lease_id（dispatch 后验证 lease 细节用）。

    agent_runs.lease_id FK → worktree_leases（不写 daemon lease id），
    需通过 sub_session.lease_id（FK → daemon_task_leases）获取。
    """
    sub = (
        (await db.execute(select(AgentSession).where(AgentSession.parent_session_id == parent_id)))
        .scalars()
        .all()
    )[-1]
    assert sub.lease_id is not None, "子会话 lease_id 不应为 None"
    return sub.lease_id


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
        # agent_runs.lease_id FK → worktree_leases（非 daemon_task_leases），
        # 分身 run 不写 lease_id——锚点走 sub_session.lease_id。
        assert data.get("lease_id") is None

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
        assert sub.lease_id is not None
        assert sub.runtime_id == own_rt["runtime_id"]
        assert sub.worker_done_at is None

        # interactive lease：kind/stage/role/prompt（分身简报）
        lease = await _lease(db_session, sub.lease_id)
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
        lease = await _lease(db_session, await _sub_session_lease_id(db_session, main_session.id))
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
        lease = await _lease(db_session, await _sub_session_lease_id(db_session, _main.id))
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
        lease = await _lease(db_session, await _sub_session_lease_id(db_session, _main.id))
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
# runtime 解析：绑定机器唯一钉定 + 两段式 provider 预检（FR-01 / FR-02）
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
        lease = await _lease(db_session, await _sub_session_lease_id(db_session, _main.id))
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
    async def test_binding_machine_pinned_over_own_runtime(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        """QM小程序→crrcdt-hubin 跨机派发场景复刻（FR-01 / D-001@v1）。

        **语义翻转（需求变更，非测试放水——CLAUDE.md 规则9）**：本用例原为
        ``test_own_runtime_preferred_over_representative``（旧行为：anchor 本机
        自有 runtime 在线时优先于代表 binding）。2026-08-28-fix-cross-machine-
        worker-dispatch FR-01 删除该抢占分支：owner 自有机器在线但未绑定目标
        工作区时，会话必须钉定目标工作区的代表绑定机器（第三方用户绑定该区且
        在线，其绑定机器实例心跳设为更新），绝不落 owner 机器——否则两机分裂
        后错机 daemon 无差别 mkdir 空目录、分身在空目录里静默"成功"（QM 场景
        实证，详见 mcp_tools._dispatch_worker_core 注释）。

        owner 绑定自己机器的常态等价回归由 :283/:317 覆盖（owner 机器恰为
        唯一绑定机器时钉定结果与旧行为一致），此处不重复。
        """
        # owner 在线 runtime 但不绑目标区（bind_own_runtime=False 解耦自有
        # runtime 与 owner 绑定——旧行为下该在线机器会被抢占选中）。
        ws, _main, mission, _owner, own_rt = await _seed_context(
            db_session, with_own_runtime=True, bind_own_runtime=False
        )
        assert own_rt is not None
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

        # 第三方用户绑定目标工作区且在线（实例心跳设为更新——显式设值消除
        # daemon_id 随机 tie-break 的不确定性）。
        third_party = await _make_user(db_session)
        third_rt = await _stub_online_runtime(
            db_session,
            user_id=third_party,
            heartbeat="2026-08-28T12:00:00+00:00",
        )
        await _stub_member_binding(db_session, target.id, third_party, third_rt["daemon_id"])

        _mock_worktree_delegate(monkeypatch)
        _mock_wake_delivered(monkeypatch)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/missions/{mission.id}/dispatch_worker",
            json={"objective": "o", "target_workspace_id": str(target.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        lease = await _lease(db_session, await _sub_session_lease_id(db_session, _main.id))
        assert lease.runtime_id == third_rt["runtime_id"], (
            "跨机工作区钉定应落目标工作区代表绑定机器"
        )
        assert lease.runtime_id != own_rt["runtime_id"], "绝不回落 owner 自有在线机器"

    @pytest.mark.asyncio
    async def test_same_workspace_newer_heartbeat_binding_wins(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        """同区多绑定变体（FR-01 涟漪 / D-005@v1 全序）：owner 绑定自己机器、
        第三方绑定同工作区且其实例心跳更新 → 绑定候选集内按心跳全序第三方胜出。

        旧 :736 同形用例断言「owner 自有优先」；新语义下同工作区多绑定时统一
        全序（实例心跳 DESC, daemon_id ASC）在候选内选行——owner 行并非硬优先。
        owner 绑定机器实例心跳 NULL（NULLS LAST 恒排后），第三方显式设心跳，
        结果确定不 flaky。「owner 机器即唯一绑定机器」的常态回归归 :283/:317。
        """
        ws, _main, mission, _owner, own_rt = await _seed_context(db_session)
        assert own_rt is not None
        rep_owner = await _make_user(db_session)
        rep_rt = await _stub_online_runtime(
            db_session,
            user_id=rep_owner,
            heartbeat="2026-08-28T12:00:00+00:00",
        )
        await _stub_member_binding(db_session, ws.id, rep_owner, rep_rt["daemon_id"])

        _mock_worktree_delegate(monkeypatch)
        _mock_wake_delivered(monkeypatch)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/missions/{mission.id}/dispatch_worker",
            json={"objective": "o"},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        lease = await _lease(db_session, await _sub_session_lease_id(db_session, _main.id))
        assert lease.runtime_id == rep_rt["runtime_id"], (
            "同区多绑定时实例心跳更新的绑定机器应胜出（D-005@v1 全序）"
        )
        assert lease.runtime_id != own_rt["runtime_id"]

    @pytest.mark.asyncio
    async def test_provider_strict_hit_no_fallback_warning(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        """A1 严格命中（FR-02 / D-002@v1）：绑定机器有 provider=ws.default_agent
        的在线 runtime → 第一段严格解析命中，无 placement_provider_fallback 回退日志。"""
        # _seed_context：ws.default_agent="claude"、绑定机器 runtime provider=claude。
        ws, _main, mission, _owner, own_rt = await _seed_context(db_session)
        assert own_rt is not None
        spy = _mcp_tools_log_spy(monkeypatch)
        _mock_worktree_delegate(monkeypatch)
        _mock_wake_delivered(monkeypatch)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/missions/{mission.id}/dispatch_worker",
            json={"objective": "o"},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        # 严格命中：预检不走第二段回退，无 fallback warning（可观测性验收）。
        assert _fallback_warning_calls(spy) == []
        lease = await _lease(db_session, await _sub_session_lease_id(db_session, _main.id))
        assert lease.runtime_id == own_rt["runtime_id"]

    @pytest.mark.asyncio
    async def test_provider_fallback_resolves_heterogeneous_runtime(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        """A1 回退命中（FR-02 / D-002@v1 验收）：绑定机器仅有 codex runtime 而
        ws.default_agent=claude → 严格段无果、provider=None 回退段解析成功，
        打 placement_provider_fallback warning，钉定 codex runtime（lease 侧
        provider 实际值 = codex——子会话/首 run provider 同源）。"""
        # owner 不建自有机器；绑定机器（binder 名下）只有 codex runtime。
        ws, _main, mission, _owner, _no_rt = await _seed_context(db_session, with_own_runtime=False)
        binder = await _make_user(db_session)
        codex_rt = await _stub_online_runtime(
            db_session,
            user_id=binder,
            provider="codex",
            heartbeat="2026-08-28T12:00:00+00:00",
        )
        await _stub_member_binding(db_session, ws.id, binder, codex_rt["daemon_id"])
        spy = _mcp_tools_log_spy(monkeypatch)
        _mock_worktree_delegate(monkeypatch)
        _mock_wake_delivered(monkeypatch)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/missions/{mission.id}/dispatch_worker",
            json={"objective": "o"},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text

        # 回退解析成功：钉定绑定机器上的 codex runtime（绝不 422）。
        lease = await _lease(db_session, await _sub_session_lease_id(db_session, _main.id))
        assert lease.runtime_id == codex_rt["runtime_id"]
        sub_sessions = (
            (
                await db_session.execute(
                    select(AgentSession).where(AgentSession.parent_session_id == _main.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(sub_sessions) == 1
        # lease_provider = binding.provider（回退命中后的实际 provider）。
        assert sub_sessions[0].provider == "codex"
        runs = await _worker_runs(db_session, mission.id)
        assert runs[0].provider == "codex"

        # 回退命中打点可观测：事件名 + wanted/actual 字段（对齐 placement 同款语义）。
        fallback_calls = _fallback_warning_calls(spy)
        assert len(fallback_calls) == 1
        assert fallback_calls[0].kwargs["wanted"] == "claude"
        assert fallback_calls[0].kwargs["actual"] == "codex"


# ---------------------------------------------------------------------------
# allowed_roots 预检三形态（FR-04 / D-003@v2）：可判定越界 400 / 全 ~ 放行 /
# 空并集放行（边界包含子句由 test_placement_member_binding.py
# TestPathDefinitivelyOutsideRoots 纯函数用例覆盖，此处不重复）
# ---------------------------------------------------------------------------


class TestAllowedRootsPrecheck:
    async def _dispatch(self, client, auth_headers, ws_id, mission_id):
        return await client.post(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/dispatch_worker",
            json={"objective": "o"},
            headers=auth_headers,
        )

    @pytest.mark.asyncio
    async def test_definitively_outside_absolute_roots_400_creates_nothing(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        """可判定越界 400（FR-04 验收）：绑定机器 allowed_roots 为绝对路径根
        /secured-area，ws.root_path=/tmp/xxx 不命中 → 400 中文引导（含
        「allowed_roots 白名单」），且该 mission 无新 run 行落库、无子会话无 lease。"""
        ws, main_session, mission, _owner, own_rt = await _seed_context(db_session)
        assert own_rt is not None
        await db_session.execute(
            text("UPDATE daemon_instances SET allowed_roots = :roots WHERE id = :di"),
            {"roots": json.dumps(["/secured-area"]), "di": own_rt["daemon_id"].hex},
        )
        await db_session.commit()
        _mock_worktree_delegate(monkeypatch)  # 即便误入执行段也不碰真 delegate

        resp = await self._dispatch(client, auth_headers, ws.id, mission.id)
        assert resp.status_code == 400, resp.text
        assert "allowed_roots 白名单" in resp.json()["message"]
        assert "目标工作区路径" in resp.json()["message"]
        # 零垃圾行：预检先于建 sub_session/run/lease（fail-loud 前置拦截）。
        assert await _count_subsessions(db_session, main_session.id) == 0
        assert await _worker_runs(db_session, mission.id) == []
        assert (await db_session.execute(select(DaemonTaskLease))).scalars().first() is None

    @pytest.mark.asyncio
    async def test_all_tilde_roots_passthrough_201(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        """全 ~ 根放行（FR-04 验收）：backend 无法展开 ``~`` 前缀根 → 不可判定，
        放行交 daemon 认领终检权威裁决（现状默认形态，显式设根排除歧义）。"""
        ws, _main, mission, _owner, own_rt = await _seed_context(db_session)
        assert own_rt is not None
        await db_session.execute(
            text("UPDATE daemon_instances SET allowed_roots = :roots WHERE id = :di"),
            {"roots": json.dumps(["~/.sillyhub", "~/work"]), "di": own_rt["daemon_id"].hex},
        )
        await db_session.commit()
        _mock_worktree_delegate(monkeypatch)
        _mock_wake_delivered(monkeypatch)

        resp = await self._dispatch(client, auth_headers, ws.id, mission.id)
        assert resp.status_code == 201, resp.text

    @pytest.mark.asyncio
    async def test_empty_roots_union_passthrough_201(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        """空并集放行（FR-04 验收）：instance 行 allowed_roots 置空 JSON（[]）、
        名下 runtime 行 allowed_roots 为 NULL（无根贡献）→ 并集为空不可判定 →
        放行（daemon 终检权威）。"""
        ws, _main, mission, _owner, own_rt = await _seed_context(db_session)
        assert own_rt is not None
        await db_session.execute(
            text("UPDATE daemon_instances SET allowed_roots = :roots WHERE id = :di"),
            {"roots": json.dumps([]), "di": own_rt["daemon_id"].hex},
        )
        await db_session.commit()
        _mock_worktree_delegate(monkeypatch)
        _mock_wake_delivered(monkeypatch)

        resp = await self._dispatch(client, auth_headers, ws.id, mission.id)
        assert resp.status_code == 201, resp.text
