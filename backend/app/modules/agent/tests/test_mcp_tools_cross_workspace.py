"""链路A MCP 跨工作区组合流测试（task-16 backend 部分）。

change ``2026-08-19-cross-workspace-team-mission`` task-16 / design §7.2 链路A
（agent/mcp_tools.py，daemon apiKey 驱动主 agent）。

与 ``test_mcp_tools.py`` ``TestCrossWorkspaceDispatch``（单点校验：_get_mission
scope 放行 / target 越界 400 / profile 归属，均止步于 503 fail-loud 证明校验
通过）互补——本文件覆盖**组合流**，一次请求内同时穿过 ``_get_mission`` scope
放宽 + ``dispatch_worker`` target 透传到 execution 的完整链路：

1. member workspace 上下文（URL 用 scope 内非 anchor ws）驱动 dispatch_worker
   + list_workers（_get_mission 放宽 × MCP 工具同一入口的组合）；
2. target ∈ scope 时 dispatch 成功（假 delegate + 假 placement）：worktree 按
   target 建、lease root_path 落 target root 的 .worktrees 副本、placement 收
   ``representative_fallback=True``——target 参数真正透传到 execution 的实证
   （既有用例只到 503，未证明透传）；
3. target ∉ scope 拒绝时**不落 run**（400 先于建 run 的组合断言）；
4. profile 归属放宽（P2-1）：profile 属 anchor ws 也能被 scope 内 target 派发
   使用（组合：anchor profile × target=member ws；既有用例只测 profile@target
   不带 target 的组合）。

已知实现缺口（task-16 verify 报告，本文件不修）：dispatch 链路未把 target 落
``run.target_workspace_id`` 列（design §4.1/§4.3 converge 分组键），见
test_integration_cross_workspace.py 文件头注释与主流程报告。
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentMission, AgentRun
from app.modules.agent.profile.model import AgentProfile, AgentProfileVisibility
from app.modules.workspace.model import Workspace

_PLACEMENT_PATH = "app.modules.agent.placement.RunPlacementService.dispatch_to_daemon"


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
    """HostFsDelegate mock：git_worktree_add 恒 ok（dispatch 成功路径）。"""
    delegate: MagicMock = MagicMock()
    delegate.git_worktree_add = AsyncMock(
        return_value={"ok": True, "worktree_path": None, "error": None}
    )
    return delegate


async def _stub_representative_binding(session: AsyncSession, ws_id: uuid.UUID) -> None:
    """给工作区造一条在线机器绑定（ql-20260822-008 派发前在线绑定预检用例）。

    与 test_mcp_tools._stub_representative_binding 同款：daemon_instances(online)
    + daemon_runtimes(online) + workspace_member_runtimes（member 绑定行，命中
    resolve_representative_binding 分支2「任意在线」）。raw SQL 注意 SQLite
    兼容：无 ::json 转换、显式 created_at/updated_at 字符串。本文件派发目标
    均为 member ws（显式 target），stub 的 ws 须与 target_workspace_id 一致。
    """
    from sqlalchemy import text

    di_id = uuid.uuid4()
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
        {"id": uuid.uuid4().hex, "uid": member_uid.hex, "di": di_id.hex, "ts": ts},
    )
    await session.execute(
        text(
            "INSERT INTO workspace_member_runtimes (workspace_id, user_id, root_path, path_source, daemon_id, shared, created_at, updated_at)"
            " VALUES (:wid, :uid, '/tmp/w', 'manual', :di, false, :ts, :ts)"
        ),
        {"wid": ws_id.hex, "uid": member_uid.hex, "di": di_id.hex, "ts": ts},
    )
    await session.commit()


async def _fetch_mission_run(session: AsyncSession, mission_id: uuid.UUID) -> AgentRun:
    """mission 下（唯一）worker run，从 DB 现查。"""
    stmt = select(AgentRun).where(AgentRun.mission_id == mission_id)
    return (await session.execute(stmt)).scalars().one()


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
        await _stub_representative_binding(db_session, member.id)

        fake = _fake_delegate()
        placement: AsyncMock = AsyncMock(return_value=uuid.uuid4())
        with (
            patch("app.modules.agent.mcp_tools.new_host_fs_delegate", return_value=fake),
            patch(_PLACEMENT_PATH, new=placement),
        ):
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

        # run 落库 + 派发链路真实走通（placement 被调，非 503/400 短路）
        placement.assert_awaited_once()
        run = await _fetch_mission_run(db_session, mission.id)
        assert run.status == "pending"
        assert run.error_code is None
        assert run.worktree_branch == f"workers/{str(run.id)[:8]}"


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
        await _stub_representative_binding(db_session, member.id)

        fake = _fake_delegate()
        placement: AsyncMock = AsyncMock(return_value=uuid.uuid4())
        with (
            patch("app.modules.agent.mcp_tools.new_host_fs_delegate", return_value=fake),
            patch(_PLACEMENT_PATH, new=placement),
        ):
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

        # 透传实证 1：worktree 按目标 ws 建（execution git_worktree_add 收 member）
        fake.git_worktree_add.assert_awaited_once()
        assert fake.git_worktree_add.await_args.args[0].id == member.id
        # 透传实证 2：lease root_path 落 target root 的 .worktrees 副本（worker cwd）
        wk = placement.call_args.kwargs
        assert wk["root_path"] == f"{member.root_path}/.worktrees/{str(run.id)[:8]}"
        # 透传实证 3：placement 按目标 ws 路由 + representative 旗标开（代表 binding）
        assert wk["workspace_id"] == member.id
        assert wk["representative_fallback"] is True
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
