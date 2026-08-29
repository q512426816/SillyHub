"""链路A MCP 跨工作区组合流测试（task-16 backend 部分）。

change ``2026-08-19-cross-workspace-team-mission`` task-16 / design §7.2 链路A
（agent/mcp_tools.py，daemon apiKey 驱动主 agent）。

与 ``test_mcp_tools.py`` ``TestCrossWorkspaceDispatch``（单点校验：_get_mission
scope 放行 / target 越界 400 / profile 归属，均止步于 503 fail-loud 证明校验
通过）互补——本文件覆盖**组合流**，一次请求内同时穿过 ``_get_mission`` scope
放宽 + ``dispatch_worker`` target 透传到 execution 的完整链路：

task-15（2026-08-25-team-subsession-governance）：task-05 后 dispatch_worker
执行段整体换子会话三元组（AgentSession + interactive lease + 首 run，不再调
batch ``placement.dispatch_to_daemon``）。本文件的「target 透传到 execution」
实证断言从 mock dispatch_to_daemon kwargs 机械迁移到新形态——派发走真实
``prepare_interactive_dispatch``（lease 落库，零网络），透传证据改从 interactive
lease 断言：``metadata.cwd``（worktree 副本路径）、``metadata.workspace_id``
（按目标 ws 路由）、``runtime_id``（代表机器钉定）、``metadata.stage``。
旧 ``representative_fallback`` 旗标随 batch 路径退场（D-004@v1 runtime 解析
固定「自有在线优先 → 代表 binding 钉定」）。

1. member workspace 上下文（URL 用 scope 内非 anchor ws）驱动 dispatch_worker
   + list_workers（_get_mission 放宽 × MCP 工具同一入口的组合）；
2. target ∈ scope 时 dispatch 成功（假 delegate；lease 真实落库）：worktree 按
   target 建、lease metadata cwd 落 target root 的 .worktrees 副本、lease
   workspace_id 按目标 ws 路由 + runtime 钉定代表机器——target 参数真正
   透传到派发执行段的实证（既有用例只到 503，未证明透传）；
3. target ∉ scope 拒绝时**不落 run**（400 先于建 run 的组合断言）；
4. profile 归属放宽（P2-1）：profile 属 anchor ws 也能被 scope 内 target 派发
   使用（组合：anchor profile × target=member ws；既有用例只测 profile@target
   不带 target 的组合）。

已知实现缺口（task-16 verify 报告，本文件不修）：dispatch 链路未把 target 落
``run.target_workspace_id`` 列（design §4.1/§4.3 converge 分组键），见
test_integration_cross_workspace.py 文件头注释与主流程报告。
"""

from __future__ import annotations

import json
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.execution import MISSION_WORKER_STAGE
from app.modules.agent.model import AgentMission, AgentRun
from app.modules.agent.profile.model import AgentProfile, AgentProfileVisibility
from app.modules.daemon.model import DaemonTaskLease
from app.modules.workspace.model import Workspace


@pytest.fixture(autouse=True)
def _ws_alive_hub(monkeypatch: pytest.MonkeyPatch) -> None:
    """task-02 placement 实连接过滤：测试只灌 DB online，fake hub 使候选行视为实连。

    ``placement._runtime_row_ws_alive`` 对候选行联查 ws_hub 单例的
    ``is_connected``，测试环境无真 WS 连接会把 DB-online 候选行全剔除（派发
    runtime 解析返 None → run failed / 422）。照 test_worker_subsession_lifecycle
    ``_recording_ws_hub`` 先例 patch 模块级 ``get_daemon_ws_hub`` 返恒在线假
    hub（placement 为函数级 lazy import，patch 模块属性即生效）；派发链路走
    真实 ``notify_interactive_dispatch``，假 hub 的 send_* 同步吞掉唤醒下发。
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


async def _make_ws(session: AsyncSession, *, name: str, ws_type: str, root_path: str) -> Workspace:
    uid = uuid.uuid4()
    ws = Workspace(
        id=uid,
        name=name,
        slug=f"{name}-{uid.hex[:8]}",
        root_path=root_path,
        status="active",
        type=ws_type,
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _seed_cross_ws_pair(session: AsyncSession) -> tuple[Workspace, Workspace, AgentMission]:
    """anchor(backend-code) + member(frontend-code) + scope 含两者的 mission。

    scope 同时含 anchor 与 member（对齐创建端不变式 scope ⊇ {anchor}；既有
    TestCrossWorkspaceDispatch._seed_cross_ws_mission 的 scope 只含 target，属
    绕过创建端校验的造数捷径，本文件用真实形态）。
    """
    anchor = await _make_ws(
        session, name="anchor", ws_type="backend-code", root_path="/tmp/cwa-anchor"
    )
    member = await _make_ws(
        session, name="member", ws_type="frontend-code", root_path="/tmp/cwa-member"
    )
    mission = AgentMission(
        workspace_id=anchor.id,
        objective="跨工作区组合流",
        constraints={"mode": "team"},
        scope_workspace_ids=[str(anchor.id), str(member.id)],
    )
    session.add(mission)
    await session.commit()
    await session.refresh(mission)
    return anchor, member, mission


def _fake_delegate() -> MagicMock:
    """HostFsDelegate mock：probe 恒 git + git_worktree_add 恒 ok（dispatch 成功路径）。"""
    delegate: MagicMock = MagicMock()
    delegate.probe_workspace_git_mode = AsyncMock(return_value="git")
    delegate.git_worktree_add = AsyncMock(
        return_value={"ok": True, "worktree_path": None, "error": None}
    )
    return delegate


async def _stub_representative_binding(session: AsyncSession, ws_id: uuid.UUID) -> uuid.UUID:
    """给工作区造一条在线机器绑定（ql-20260822-008 派发前在线绑定预检用例）。

    与 test_mcp_tools._stub_representative_binding 同款：daemon_instances(online)
    + daemon_runtimes(online) + workspace_member_runtimes（member 绑定行，命中
    resolve_representative_binding 分支2「任意在线」）。raw SQL 注意 SQLite
    兼容：无 ::json 转换、显式 created_at/updated_at 字符串。本文件派发目标
    均为 member ws（显式 target），stub 的 ws 须与 target_workspace_id 一致。

    task-15：返回绑定 runtime id——子会话派发（task-05）后透传证据从
    dispatch_to_daemon kwargs 迁到 interactive lease（runtime 钉定断言用）。
    """
    from sqlalchemy import text

    di_id = uuid.uuid4()
    rt_id = uuid.uuid4()
    member_uid = uuid.uuid4()
    ts = "2026-08-22T00:00:00+00:00"
    await session.execute(
        text(
            "INSERT INTO daemon_instances (id, user_id, hostname, server_url, allowed_roots, status, created_at, updated_at)"
            " VALUES (:id, :uid, 'h1', 'http://t', '[\"~/.sillyhub\"]', 'online', :ts, :ts)"
        ),
        {"id": di_id.hex, "uid": member_uid.hex, "ts": ts},
    )
    await session.execute(
        text(
            "INSERT INTO daemon_runtimes (id, user_id, daemon_instance_id, provider, status, created_at, updated_at)"
            " VALUES (:id, :uid, :di, 'claude', 'online', :ts, :ts)"
        ),
        {"id": rt_id.hex, "uid": member_uid.hex, "di": di_id.hex, "ts": ts},
    )
    await session.execute(
        text(
            "INSERT INTO workspace_member_runtimes (workspace_id, user_id, root_path, path_source, daemon_id, shared, created_at, updated_at)"
            " VALUES (:wid, :uid, '/tmp/w', 'manual', :di, false, :ts, :ts)"
        ),
        {"wid": ws_id.hex, "uid": member_uid.hex, "di": di_id.hex, "ts": ts},
    )
    await session.commit()
    return rt_id


async def _fetch_mission_run(session: AsyncSession, mission_id: uuid.UUID) -> AgentRun:
    """mission 下（唯一）worker run，从 DB 现查。"""
    stmt = select(AgentRun).where(AgentRun.mission_id == mission_id)
    return (await session.execute(stmt)).scalars().one()


async def _fetch_worker_lease(session: AsyncSession, run: AgentRun) -> DaemonTaskLease:
    """取分身首 run 绑定的 interactive lease（task-05 子会话派发形态）。

    agent_runs.lease_id FK → worktree_leases（不写 daemon lease id），
    需通过 sub_session.lease_id（FK → daemon_task_leases）获取。
    """
    from app.modules.agent.model import AgentSession

    assert run.agent_session_id is not None
    sub = await session.get(AgentSession, run.agent_session_id)
    assert sub is not None and sub.lease_id is not None, "子会话 lease_id 不应为 None"
    lease = await session.get(DaemonTaskLease, sub.lease_id)
    assert lease is not None
    return lease


def _lease_meta(lease: DaemonTaskLease) -> dict[str, Any]:
    raw = lease.metadata_
    return json.loads(raw) if isinstance(raw, str) else dict(raw or {})


# ---------------------------------------------------------------------------
# 1. member workspace 上下文组合流
# ---------------------------------------------------------------------------


class TestMemberContextDispatchFlow:
    async def test_member_ws_context_dispatch_and_list(
        self, client, db_session, auth_headers
    ) -> None:
        """URL 用 scope 内 member ws：dispatch_worker 放行建 run，list_workers
        同一 member 上下文可读（_get_mission 放宽 × 工具入口的组合）。"""
        _anchor, member, mission = await _seed_cross_ws_pair(db_session)
        # ql-20260822-008：派发前在线绑定预检查派发目标（target=member）的绑定
        rep_rt_id = await _stub_representative_binding(db_session, member.id)

        fake = _fake_delegate()
        with patch("app.modules.agent.mcp_tools.new_host_fs_delegate", return_value=fake):
            resp = await client.post(
                f"/api/workspaces/{member.id}/missions/{mission.id}/dispatch_worker",
                json={"objective": "前端改动", "target_workspace_id": str(member.id)},
                headers=auth_headers,
            )
            assert resp.status_code == 201, resp.text
            list_resp = await client.get(
                f"/api/workspaces/{member.id}/missions/{mission.id}/workers",
                headers=auth_headers,
            )

        assert list_resp.status_code == 200, list_resp.text
        workers = list_resp.json()["workers"]
        assert len(workers) == 1
        assert workers[0]["objective"] == "前端改动"

        # run 落库 + 派发链路真实走通（task-15：interactive lease 落库 +
        # runtime 钉定代表机器，非 503/400 短路）
        run = await _fetch_mission_run(db_session, mission.id)
        assert run.status == "pending"
        assert run.error_code is None
        assert run.worktree_branch == f"workers/{str(run.id)[:8]}"
        lease = await _fetch_worker_lease(db_session, run)
        assert lease.kind == "interactive"
        assert lease.runtime_id == rep_rt_id
        assert _lease_meta(lease)["stage"] == MISSION_WORKER_STAGE


# ---------------------------------------------------------------------------
# 2. target ∈ scope 透传到 execution 的实证
# ---------------------------------------------------------------------------


class TestTargetTransparentForwarding:
    async def test_target_in_scope_forwarded_to_execution(
        self, client, db_session, auth_headers
    ) -> None:
        """anchor 上下文派发 target=member（∈ scope）→ 三重透传实证：
        worktree 按 member 建、lease root_path 落 member 的 .worktrees 副本、
        placement 收 member 路由 + representative_fallback=True。"""
        anchor, member, mission = await _seed_cross_ws_pair(db_session)
        # ql-20260822-008：派发前在线绑定预检查派发目标（target=member）的绑定
        rep_rt_id = await _stub_representative_binding(db_session, member.id)

        fake = _fake_delegate()
        with patch("app.modules.agent.mcp_tools.new_host_fs_delegate", return_value=fake):
            resp = await client.post(
                f"/api/workspaces/{anchor.id}/missions/{mission.id}/dispatch_worker",
                json={
                    "objective": "跨 ws 改动",
                    "target_workspace_id": str(member.id),
                },
                headers=auth_headers,
            )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["status"] == "pending"
        assert data["error_code"] is None

        run = await _fetch_mission_run(db_session, mission.id)

        # 透传实证 1：worktree 按目标 ws 建（git_worktree_add 收 member）
        fake.git_worktree_add.assert_awaited_once()
        assert fake.git_worktree_add.await_args.args[0].id == member.id
        # 透传实证 2（task-15 迁移）：lease metadata cwd 落 target root 的
        # .worktrees 副本（worker cwd，claim payload root_path 源）
        lease = await _fetch_worker_lease(db_session, run)
        meta = _lease_meta(lease)
        assert meta["cwd"] == f"{member.root_path}/.worktrees/{str(run.id)[:8]}"
        # 透传实证 3（task-15 迁移）：lease 按目标 ws 路由 + runtime 钉定代表机器
        # （D-004@v1：创建者无自有在线 runtime → 代表 binding 钉定）
        assert uuid.UUID(meta["workspace_id"]) == member.id
        assert lease.runtime_id == rep_rt_id
        assert meta["stage"] == MISSION_WORKER_STAGE
        # team 模式自建 worktree 分支按 task-03 公式落 run（converge 分组键的 branch 半边）
        assert run.worktree_branch == f"workers/{str(run.id)[:8]}"


# ---------------------------------------------------------------------------
# 3. target ∉ scope：拒绝先于建 run
# ---------------------------------------------------------------------------


class TestTargetOutOfScope:
    async def test_target_out_of_scope_rejected_without_run(
        self, client, db_session, auth_headers
    ) -> None:
        """target=scope 外 ws → 400 mission_target_out_of_scope，且 mission 下
        不新增任何 AgentRun（校验先于建 run 的组合断言，既有用例只测 400）。"""
        anchor, _member, mission = await _seed_cross_ws_pair(db_session)
        outsider = await _make_ws(
            db_session, name="outsider", ws_type="business-doc", root_path="/tmp/cwa-outsider"
        )

        resp = await client.post(
            f"/api/workspaces/{anchor.id}/missions/{mission.id}/dispatch_worker",
            json={"objective": "越界任务", "target_workspace_id": str(outsider.id)},
            headers=auth_headers,
        )
        assert resp.status_code == 400, resp.text
        assert "mission_target_out_of_scope" in resp.json().get("message", "")

        runs = list(
            (await db_session.execute(select(AgentRun).where(AgentRun.mission_id == mission.id)))
            .scalars()
            .all()
        )
        assert runs == [], "越界派发应在校验层拒绝，不应落任何 run"


# ---------------------------------------------------------------------------
# 4. profile 归属放宽：anchor ws 的 profile 服务 scope 内 target 派发
# ---------------------------------------------------------------------------


class TestAnchorProfileForScopeTarget:
    async def test_anchor_ws_profile_usable_for_member_target(
        self, client, db_session, auth_headers
    ) -> None:
        """workspace 级 profile 属 anchor ws，target=member（∈ scope）派发使用
        → 归属校验放行（P2-1：profile.workspace_id ∈ {anchor} ∪ scope）。

        不 patch delegate：run 上冻结的 agent_profile_id / snapshot 是归属校验
        放行（校验失败是 400 且不建 run）后落库的组合证据；ql-20260822-008
        预检通过 stub 在线绑定（target=member）过检，真 delegate 派发在测试
        环境落到 worktree 阶段失败（run 终态 failed，形态不锁死）。
        """
        anchor, member, mission = await _seed_cross_ws_pair(db_session)
        # ql-20260822-008：预检查派发目标（target=member）的在线绑定
        await _stub_representative_binding(db_session, member.id)

        profile = AgentProfile(
            id=uuid.uuid4(),
            workspace_id=anchor.id,
            name="anchor-profile",
            visibility=AgentProfileVisibility.WORKSPACE.value,
            provider="claude",
            created_by=uuid.uuid4(),
        )
        db_session.add(profile)
        await db_session.commit()
        await db_session.refresh(profile)

        resp = await client.post(
            f"/api/workspaces/{anchor.id}/missions/{mission.id}/dispatch_worker",
            json={
                "objective": "绑定 anchor 档案跨 ws 派发",
                "agent_profile_id": str(profile.id),
                "target_workspace_id": str(member.id),
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        # ql-20260822-008：stub 绑定后走到 worktree 阶段，测试环境派发失败形态
        # （hostfs 不可达/委托降级），证明 profile 归属校验通过且 run 已建
        assert resp.json()["status"] == "failed"

        run = await _fetch_mission_run(db_session, mission.id)
        assert run.agent_profile_id == profile.id
        assert run.agent_profile_snapshot is not None
        # 派发已按 target 走到 delegate 层（无 binding → run 终态 failed，BE-P1-2 契约）
        assert run.status == "failed"
