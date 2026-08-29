"""task-02（2026-08-26-team-subsession-recursion）：mcp_tools 递归派发链路单测。

design §5.B / §5.E（Grill B2/B3 修正）+ FR-02 / FR-03 / FR-07：

- **递归派发**——分身（tree_depth=1）调 dispatch_worker：新子会话
  ``parent=分身``、``tree_depth=2``（树形展开，孙层）；owner=mission.created_by
  与首 run 双标记沿用；lease metadata.worker_depth=2（task-04 形参接线）；
- **深度门**——孙（tree_depth=2）调 dispatch_worker → 400 中文
  「已达最大派发深度 3 层，孙分身不能再派工」且零子会话 / 零 run / 零 lease
  写入（MAX_DISPATCH_DEPTH=2，D-001@v1 总深 3 层）；
- **五端点统一解析**（Grill B2）——分身调 list_workers / get_worker_result /
  mission_status 沿 parent 链爬根命中 mission 不 404；根上无活跃 mission →
  404（禁懒建——分身 dispatch 不在分身误锚新 mission）；
- **converge 层 0 收口**（D-007@v1，鉴权通道 header 嗅探）——分身
  （apiKey+X-Session-Id）调 converge 403；主控（tree_depth=0）正常；Bearer
  JWT 通道豁免（人工干预口）；apiKey 无 Bearer 无 X-Session-Id 裸调 403；
- **worker_done 全树**（Grill B3）——孙 worker_done 经
  ``mission_worker_sessions_tree`` 成员校验通过（一层枚举会 422）且全完成
  唤醒枚举含孙（分身+孙全 done → 唤醒主控恰好一次）；
- **worktree_path 忽略**——分身调用的 payload.worktree_path 一律忽略置
  None（孙 cwd 一律自建副本路径 .worktrees/<run8>）。
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

_TS = "2026-08-26T00:00:00+00:00"


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
# Seed helpers（同 test_worker_subsession_dispatch / test_worker_subsession_done 模式）
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
            granted_at=datetime.now(UTC),
        )
    )


async def _make_api_key(db: AsyncSession, user_id: uuid.UUID) -> str:
    """给 user 签长期 API Key（daemon apiKey 通道用，test_mission_access_control 同款）。"""
    from app.core.config import get_settings
    from app.modules.auth.api_key_service import ApiKeyService

    settings = get_settings()
    svc = ApiKeyService(db, settings=settings)
    _, plaintext = await svc.create(
        user_id=user_id, name=f"key-{uuid.uuid4().hex[:8]}", expires_at=None
    )
    await db.commit()
    return plaintext


async def _seed_context(
    db: AsyncSession, *, with_own_runtime: bool = True
) -> tuple[Workspace, AgentSession, AgentMission, uuid.UUID, dict | None]:
    """主控会话 + 会话锚 mission +（可选）创建者自有在线 runtime + 成员绑定。"""
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
        workspace_id=ws.id,
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


async def _add_tree_session(
    db: AsyncSession,
    parent: AgentSession,
    *,
    tree_depth: int,
    workspace_id: uuid.UUID | None = None,
    worker_done_at: datetime | None = None,
) -> AgentSession:
    """手工造树节点（分身 depth=1 / 孙 depth=2，design §5.A 派发落库口径）。"""
    s = AgentSession(
        user_id=parent.user_id,
        provider="claude",
        status="active",
        parent_session_id=parent.id,
        tree_depth=tree_depth,
        workspace_id=workspace_id or parent.workspace_id,
        worker_done_at=worker_done_at,
    )
    db.add(s)
    await db.commit()
    await db.refresh(s)
    return s


async def _add_first_run(
    db: AsyncSession,
    *,
    mission_id: uuid.UUID,
    agent_session_id: uuid.UUID,
    role: str = "impl",
    status: str = "completed",
) -> AgentRun:
    """子会话首 run（mission_id+role 双标记锚，design §5.A）。"""
    r = AgentRun(
        mission_id=mission_id,
        agent_type="claude_code",
        status=status,
        role=role,
        objective="树节点任务",
        agent_session_id=agent_session_id,
    )
    db.add(r)
    await db.commit()
    await db.refresh(r)
    return r


def _mock_worktree_delegate(
    monkeypatch: pytest.MonkeyPatch, *, probe: str = "git", worktree_ok: bool = True
) -> MagicMock:
    delegate = MagicMock()
    delegate.probe_workspace_git_mode = AsyncMock(return_value=probe)
    delegate.git_worktree_add = AsyncMock(
        return_value={"ok": worktree_ok, "worktree_path": None, "error": None}
    )
    monkeypatch.setattr("app.modules.agent.mcp_tools.new_host_fs_delegate", lambda _s: delegate)
    return delegate


def _mock_wake_delivered(monkeypatch: pytest.MonkeyPatch) -> AsyncMock:
    from app.modules.agent.placement import RunPlacementService

    mock = AsyncMock(return_value=True)
    monkeypatch.setattr(RunPlacementService, "notify_interactive_dispatch", mock)
    return mock


def _mock_converge_flow(monkeypatch: pytest.MonkeyPatch) -> None:
    """converge 主流程桩（守卫测试只关心是否被 403 拦截，不跑真实收敛链）。

    ``converge_mission_for_completed_run`` 返 planning（未置位、零副作用），
    ``_finalize_merge_for_mission`` 返空 merge（bootstrap 路径不进 conflict
    状态机）——响应 200 status=planning 即证明层 0 守卫放行。
    """
    from app.modules.agent import mcp_tools as mod

    monkeypatch.setattr(
        "app.modules.agent.finalizer.converge_mission_for_completed_run",
        AsyncMock(return_value="planning"),
    )
    monkeypatch.setattr(mod, "_finalize_merge_for_mission", AsyncMock(return_value=([], [])))


async def _lease(db: AsyncSession, lease_id: uuid.UUID) -> DaemonTaskLease:
    lease = await db.get(DaemonTaskLease, lease_id)
    assert lease is not None
    return lease


def _lease_meta(lease: DaemonTaskLease) -> dict:
    raw = lease.metadata_
    if isinstance(raw, str):
        return json.loads(raw)
    return dict(raw or {})


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


async def _lease_count(db: AsyncSession) -> int:
    rows = (await db.execute(select(DaemonTaskLease))).scalars().all()
    return len(list(rows))


class _FakeRedis:
    """记录操作序列的 Redis 假体（SETNX / DELETE），DEL→SETNX 顺序断言用。"""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.ops: list[tuple[str, str]] = []

    async def set(self, key, val, nx=None, ex=None):
        self.ops.append(("set_nx", key))
        if nx and key in self.store:
            return None
        self.store[key] = val
        return True

    async def delete(self, *keys):
        for key in keys:
            self.ops.append(("delete", key))
            self.store.pop(key, None)
        return len(keys)


@pytest.fixture()
def notify_env(monkeypatch: pytest.MonkeyPatch):
    """隔离唤醒链：FakeRedis + FakeSessionService（记录注入），同 done 测试模式。"""
    fake_redis = _FakeRedis()
    injected: list[tuple[uuid.UUID, str]] = []

    import app.core.redis as _redis_mod

    monkeypatch.setattr(_redis_mod, "get_redis", lambda: fake_redis)

    import app.modules.daemon.session.service as _svc_mod

    class _FakeSessionService:
        def __init__(self, db) -> None:
            pass

        async def inject_session_as_service(self, session_id, *, prompt):
            injected.append((session_id, prompt))

    monkeypatch.setattr(_svc_mod, "SessionService", _FakeSessionService)
    return fake_redis, injected


# ---------------------------------------------------------------------------
# 1. 递归派发：分身派孙（parent 挂分身、depth=2 落库）
# ---------------------------------------------------------------------------


class TestRecursiveDispatch:
    @pytest.mark.asyncio
    async def test_worker_dispatches_grandchild_session(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        """分身（depth=1）派孙——新子会话 parent=分身 id、tree_depth=2；owner
        与首 run 双标记沿用；lease metadata.worker_depth=2（task-04 接线）。"""
        _ws, main_session, mission, owner_id, own_rt = await _seed_context(db_session)
        assert own_rt is not None
        worker = await _add_tree_session(db_session, main_session, tree_depth=1)
        _mock_worktree_delegate(monkeypatch)
        _mock_wake_delivered(monkeypatch)

        resp = await client.post(
            f"/api/sessions/{worker.id}/missions/dispatch_worker",
            json={"objective": "孙层任务", "role": "leaf"},
            headers={**auth_headers, "X-Session-Id": str(worker.id)},
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()

        # 新子会话：parent=分身（不再固定 mission 根）、tree_depth=2、owner 沿用
        grandchild_rows = (
            (
                await db_session.execute(
                    select(AgentSession).where(AgentSession.parent_session_id == worker.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(grandchild_rows) == 1
        grandchild = grandchild_rows[0]
        assert grandchild.tree_depth == 2
        assert grandchild.parent_session_id == worker.id
        assert grandchild.user_id == owner_id  # D-004@v1：owner=mission.created_by
        assert grandchild.lease_id is not None

        # 首 run 双标记（mission_id + role）+ 子会话锚
        runs = await _worker_runs(db_session, mission.id)
        assert len(runs) == 1
        assert runs[0].id == uuid.UUID(data["id"])
        assert runs[0].agent_session_id == grandchild.id
        assert runs[0].mission_id == mission.id
        assert runs[0].role == "leaf"

        # interactive lease：stage + worker_depth=2（task-04 形参接线）
        lease = await _lease(db_session, grandchild.lease_id)
        meta = _lease_meta(lease)
        assert meta["stage"] == MISSION_WORKER_STAGE
        assert meta["role"] == "leaf"
        assert meta["worker_depth"] == 2
        # 孙 cwd 一律自建副本路径
        assert meta["cwd"].endswith(f".worktrees/{data['id'][:8]}")

    @pytest.mark.asyncio
    async def test_main_session_dispatch_still_depth1_parent_root(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        """主控（header 会话族）派分身零回归——parent=mission 根、tree_depth=1。"""
        _ws, main_session, _mission, _owner, _rt = await _seed_context(db_session)
        _mock_worktree_delegate(monkeypatch)
        _mock_wake_delivered(monkeypatch)

        resp = await client.post(
            f"/api/sessions/{main_session.id}/missions/dispatch_worker",
            json={"objective": "一层任务"},
            headers={**auth_headers, "X-Session-Id": str(main_session.id)},
        )
        assert resp.status_code == 201, resp.text
        sub_rows = (
            (
                await db_session.execute(
                    select(AgentSession).where(AgentSession.parent_session_id == main_session.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(sub_rows) == 1
        assert sub_rows[0].tree_depth == 1
        lease = await _lease(db_session, sub_rows[0].lease_id)
        assert _lease_meta(lease)["worker_depth"] == 1

    @pytest.mark.asyncio
    async def test_grandchild_dispatch_depth_gate_400_zero_writes(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        """孙（depth=2）dispatch → 400 中文，零子会话 / 零 run / 零 lease 写入。"""
        _ws, main_session, mission, _owner, _rt = await _seed_context(db_session)
        worker = await _add_tree_session(db_session, main_session, tree_depth=1)
        grandchild = await _add_tree_session(db_session, worker, tree_depth=2)
        delegate = _mock_worktree_delegate(monkeypatch)  # 误入执行段也不碰真 delegate
        _mock_wake_delivered(monkeypatch)

        resp = await client.post(
            f"/api/sessions/{grandchild.id}/missions/dispatch_worker",
            json={"objective": "超深任务"},
            headers={**auth_headers, "X-Session-Id": str(grandchild.id)},
        )
        assert resp.status_code == 400, resp.text
        assert "已达最大派发深度 3 层" in resp.json()["message"]

        children = (
            (
                await db_session.execute(
                    select(AgentSession).where(AgentSession.parent_session_id == grandchild.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(list(children)) == 0, "深度拒绝不得创建孙的子会话"
        assert await _worker_runs(db_session, mission.id) == [], "深度拒绝不得创建 run"
        assert await _lease_count(db_session) == 0, "深度拒绝不得创建 lease"
        delegate.git_worktree_add.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_worker_payload_worktree_path_ignored(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        """分身调用的 payload.worktree_path 一律忽略——孙 cwd 自建副本，
        不透传 caller worktree（递归派发禁 caller worktree 透传）。"""
        _ws, main_session, _mission, _owner, _rt = await _seed_context(db_session)
        worker = await _add_tree_session(db_session, main_session, tree_depth=1)
        delegate = _mock_worktree_delegate(monkeypatch)
        _mock_wake_delivered(monkeypatch)

        resp = await client.post(
            f"/api/sessions/{worker.id}/missions/dispatch_worker",
            json={"objective": "o", "worktree_path": "/tmp/caller-wt"},
            headers={**auth_headers, "X-Session-Id": str(worker.id)},
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()

        # 自建副本被触发（caller worktree 短路未生效）
        delegate.git_worktree_add.assert_awaited_once()
        # WorkerRunResponse.lease_id 为 None（FK→worktree_leases 不写 daemon lease），
        # 通过子会话获取 lease_id。
        child_rows = (
            (
                await db_session.execute(
                    select(AgentSession).where(AgentSession.parent_session_id == worker.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(child_rows) == 1
        child_session = child_rows[0]
        lease = await _lease(db_session, child_session.lease_id)
        meta = _lease_meta(lease)
        assert meta["cwd"] != "/tmp/caller-wt"
        assert meta["cwd"].endswith(f".worktrees/{data['id'][:8]}")
        run = await db_session.get(AgentRun, uuid.UUID(data["id"]))
        assert run is not None
        assert run.worktree_branch == f"workers/{data['id'][:8]}"  # 自建分支非 None


# ---------------------------------------------------------------------------
# 2. 五端点统一解析：分身爬根命中（Grill B2）/ 禁懒建 miss=404
# ---------------------------------------------------------------------------


class TestUnifiedResolution:
    @pytest.mark.asyncio
    async def test_worker_read_tools_resolve_via_root(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        """分身调 list_workers / get_worker_result / mission_status——沿爬根
        命中 mission，不 404（原「只读工具口径不变」作废，design §5.B）。"""
        _ws, main_session, mission, _owner, _rt = await _seed_context(db_session)
        worker = await _add_tree_session(db_session, main_session, tree_depth=1)
        _mock_worktree_delegate(monkeypatch)
        _mock_wake_delivered(monkeypatch)

        dispatch = await client.post(
            f"/api/sessions/{worker.id}/missions/dispatch_worker",
            json={"objective": "孙任务"},
            headers={**auth_headers, "X-Session-Id": str(worker.id)},
        )
        assert dispatch.status_code == 201, dispatch.text
        grandchild_run_id = dispatch.json()["id"]

        # list_workers：爬根命中（分身自身无首 run 不进行；孙首 run 经存量回落行化）
        lst = await client.get(
            f"/api/sessions/{worker.id}/missions/workers",
            headers={**auth_headers, "X-Session-Id": str(worker.id)},
        )
        assert lst.status_code == 200, lst.text
        body = lst.json()
        assert body["mission_id"] == str(mission.id)
        assert [w["id"] for w in body["workers"]] == [grandchild_run_id]

        # get_worker_result：孙首 run 产出可读
        res = await client.get(
            f"/api/sessions/{worker.id}/missions/workers/{grandchild_run_id}/result",
            headers={**auth_headers, "X-Session-Id": str(worker.id)},
        )
        assert res.status_code == 200, res.text
        assert res.json()["worker_id"] == grandchild_run_id

        # mission_status：爬根命中，active=true + 正确 mission_id
        st = await client.get(
            f"/api/sessions/{worker.id}/missions/status",
            headers={**auth_headers, "X-Session-Id": str(worker.id)},
        )
        assert st.status_code == 200, st.text
        st_body = st.json()
        assert st_body["active"] is True
        assert st_body["mission_id"] == str(mission.id)

    @pytest.mark.asyncio
    async def test_worker_dispatch_no_root_mission_no_lazy_404(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        """分身调用禁懒建——根上无活跃 mission 时 dispatch（allow_lazy 端点）
        同样 404，不在分身误锚新 mission。"""
        _ws, main_session, _mission, _owner, _rt = await _seed_context(db_session)
        # 撤掉 mission（_seed_context 建的活跃 mission）：收敛置位即不再活跃
        _mission.converged_at = datetime.now(UTC)
        db_session.add(_mission)
        await db_session.commit()
        worker = await _add_tree_session(db_session, main_session, tree_depth=1)
        _mock_worktree_delegate(monkeypatch)

        resp = await client.post(
            f"/api/sessions/{worker.id}/missions/dispatch_worker",
            json={"objective": "o"},
            headers={**auth_headers, "X-Session-Id": str(worker.id)},
        )
        assert resp.status_code == 404, resp.text
        missions = (await db_session.execute(select(AgentMission))).scalars().all()
        assert len(list(missions)) == 1, "分身调用不得懒建新 mission（仍是原 1 条）"

    @pytest.mark.asyncio
    async def test_worker_read_tools_root_mission_missing_404(
        self, client, db_session, auth_headers
    ) -> None:
        """分身调只读端点（list_workers / mission_status）根上无活跃 mission →
        404（爬根 miss，禁懒建）。"""
        _ws, main_session, _mission, _owner, _rt = await _seed_context(db_session)
        _mission.converged_at = datetime.now(UTC)
        db_session.add(_mission)
        await db_session.commit()
        worker = await _add_tree_session(db_session, main_session, tree_depth=1)

        lst = await client.get(
            f"/api/sessions/{worker.id}/missions/workers",
            headers={**auth_headers, "X-Session-Id": str(worker.id)},
        )
        assert lst.status_code == 404, lst.text

        st = await client.get(
            f"/api/sessions/{worker.id}/missions/status",
            headers={**auth_headers, "X-Session-Id": str(worker.id)},
        )
        assert st.status_code == 404, st.text


# ---------------------------------------------------------------------------
# 3. converge 层 0 收口（D-007@v1，鉴权通道 header 嗅探）
# ---------------------------------------------------------------------------


class TestConvergeLayer0Guard:
    @pytest.mark.asyncio
    async def test_worker_converge_403_via_api_key_session_channel(
        self, client, db_session
    ) -> None:
        """分身（daemon apiKey + X-Session-Id 通道）调 converge → 403
        「只有主控会话可以收敛任务」。"""
        ws, main_session, _mission, _owner, _rt = await _seed_context(db_session)
        worker = await _add_tree_session(db_session, main_session, tree_depth=1)

        key_user = await _make_user(db_session)
        await _grant_ws_permission(db_session, user_id=key_user, workspace_id=ws.id)
        await db_session.commit()
        api_key = await _make_api_key(db_session, key_user)

        resp = await client.post(
            f"/api/sessions/{worker.id}/missions/converge",
            headers={"X-API-Key": api_key, "X-Session-Id": str(worker.id)},
        )
        assert resp.status_code == 403, resp.text
        assert resp.json()["message"] == "只有主控会话可以收敛任务"

    @pytest.mark.asyncio
    async def test_main_session_converge_passes_guard(
        self, client, db_session, monkeypatch
    ) -> None:
        """主控（tree_depth=0，apiKey + X-Session-Id）调 converge——守卫放行
        （响应 200 planning 桩值，非 403）。"""
        ws, main_session, mission, _owner, _rt = await _seed_context(db_session)
        # converge 主流程桩需要 _get_main_run 命中：补一条 orchestrator 锚 run
        db_session.add(
            AgentRun(
                mission_id=mission.id,
                agent_type="claude_code",
                provider="claude",
                status="completed",
                role="orchestrator",
                agent_session_id=main_session.id,
                objective="主控",
            )
        )
        await db_session.commit()
        _mock_converge_flow(monkeypatch)

        key_user = await _make_user(db_session)
        await _grant_ws_permission(db_session, user_id=key_user, workspace_id=ws.id)
        await db_session.commit()
        api_key = await _make_api_key(db_session, key_user)

        resp = await client.post(
            f"/api/sessions/{main_session.id}/missions/converge",
            headers={"X-API-Key": api_key, "X-Session-Id": str(main_session.id)},
        )
        assert resp.status_code == 200, resp.text
        # 守卫放行 + 主流程桩透传 planning（未置位零副作用）
        assert resp.json()["status"] == "planning"

    @pytest.mark.asyncio
    async def test_bearer_jwt_channel_exempt_even_for_worker_session(
        self, client, db_session, auth_headers, monkeypatch
    ) -> None:
        """Bearer JWT 通道豁免（人工干预口）——即使 X-Session-Id 指向分身，
        converge 也不被层 0 守卫 403。"""
        _ws, main_session, mission, _owner, _rt = await _seed_context(db_session)
        worker = await _add_tree_session(db_session, main_session, tree_depth=1)
        db_session.add(
            AgentRun(
                mission_id=mission.id,
                agent_type="claude_code",
                provider="claude",
                status="completed",
                role="orchestrator",
                agent_session_id=main_session.id,
                objective="主控",
            )
        )
        await db_session.commit()
        _mock_converge_flow(monkeypatch)

        resp = await client.post(
            f"/api/sessions/{worker.id}/missions/converge",
            headers={**auth_headers, "X-Session-Id": str(worker.id)},
        )
        assert resp.status_code == 200, resp.text

    @pytest.mark.asyncio
    async def test_api_key_bare_converge_403(self, client, db_session) -> None:
        """apiKey 无 Bearer 无 X-Session-Id 裸调（显式 mission 路径回退）→ 403
        防绕过。"""
        ws, _main, mission, _owner, _rt = await _seed_context(db_session)

        key_user = await _make_user(db_session)
        await _grant_ws_permission(db_session, user_id=key_user, workspace_id=ws.id)
        await db_session.commit()
        api_key = await _make_api_key(db_session, key_user)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/missions/{mission.id}/converge",
            headers={"X-API-Key": api_key},
        )
        assert resp.status_code == 403, resp.text
        assert resp.json()["message"] == "只有主控会话可以收敛任务"


# ---------------------------------------------------------------------------
# 4. worker_done 全树（Grill B3）：孙可达 + 全完成唤醒枚举含孙
# ---------------------------------------------------------------------------


class TestGrandchildWorkerDone:
    @pytest.mark.asyncio
    async def test_grandchild_worker_done_full_tree_membership_and_wakeup(
        self, client, db_session, auth_headers, notify_env
    ) -> None:
        """孙 worker_done 经全树成员校验通过（一层枚举会 422）+ 全完成唤醒
        枚举含孙——分身+孙全 done → 恰好一次主控唤醒。"""
        _fake_redis, injected = notify_env
        _ws, main_session, mission, _owner, _rt = await _seed_context(
            db_session, with_own_runtime=False
        )
        # 分身已 done（完成态），孙活跃待收尾
        worker = await _add_tree_session(
            db_session, main_session, tree_depth=1, worker_done_at=datetime.now(UTC)
        )
        grandchild = await _add_tree_session(db_session, worker, tree_depth=2)
        worker_run = await _add_first_run(
            db_session, mission_id=mission.id, agent_session_id=worker.id, role="impl"
        )
        _ = worker_run
        grandchild_run = await _add_first_run(
            db_session, mission_id=mission.id, agent_session_id=grandchild.id, role="leaf"
        )

        resp = await client.post(
            f"/api/sessions/{grandchild.id}/missions/worker_done",
            json={"summary": "孙层完成：产出 backend/app/bar.py"},
            headers={**auth_headers, "X-Session-Id": str(grandchild.id)},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["mission_id"] == str(mission.id)
        assert body["session_id"] == str(grandchild.id)
        assert body["run_id"] == str(grandchild_run.id)
        # 全树（分身+孙）全完成 → 迁移 + 唤醒主控（枚举含孙，Grill B3）
        assert body["all_workers_done"] is True
        assert body["orchestrator_notified"] is True

        await db_session.refresh(grandchild)
        assert grandchild.worker_done_at is not None
        assert len(injected) == 1 and injected[0][0] == main_session.id

    @pytest.mark.asyncio
    async def test_grandchild_worker_done_keeps_mission_busy_when_worker_pending(
        self, client, db_session, auth_headers, notify_env
    ) -> None:
        """孙 done 但分身未 done——all_workers_done False、不唤醒（全树判定）。"""
        _fake_redis, injected = notify_env
        _ws, main_session, mission, _owner, _rt = await _seed_context(
            db_session, with_own_runtime=False
        )
        worker = await _add_tree_session(db_session, main_session, tree_depth=1)
        grandchild = await _add_tree_session(db_session, worker, tree_depth=2)
        await _add_first_run(
            db_session, mission_id=mission.id, agent_session_id=worker.id, role="impl"
        )
        await _add_first_run(
            db_session, mission_id=mission.id, agent_session_id=grandchild.id, role="leaf"
        )

        resp = await client.post(
            f"/api/sessions/{grandchild.id}/missions/worker_done",
            json={"summary": "孙层先完成"},
            headers={**auth_headers, "X-Session-Id": str(grandchild.id)},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["all_workers_done"] is False
        assert body["orchestrator_notified"] is False
        assert injected == []
