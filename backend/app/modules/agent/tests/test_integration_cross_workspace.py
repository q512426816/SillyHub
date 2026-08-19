"""跨工作区团队执行端到端集成冒烟（task-16 backend 部分）。

change ``2026-08-19-cross-workspace-team-mission`` task-16 / design §4（派发与收敛
链路）+ §10 验收 1 / 3 / 5。与单点单测互补（test_execution_target_routing 只测
execution 路由、test_finalize_execute_mission_merge / test_finalizer_cleanup 只测
finalizer 分组、test_router_project_missions 只测项目端点校验），本文件把
「创建 → 派发 → 收敛」串成一次 HTTP 全链路：service 级用假 delegate / 假
placement / GLM 隔离，不打真 daemon、不建真 worktree、零网络。

用例组 A（验收 1 单 ws 零回归）``TestSingleWorkspaceZeroRegression``：
- 既有端点 ``POST /api/workspaces/{id}/missions``（mode=team，不传 scope/target）
  → mission 落库 project_id/scope NULL，主 agent run 派发按 anchor 且不带
  representative 旗标（design §4.2 B-04：主 agent 维持 borrow 兜底链）；
- MCP ``dispatch_worker`` 不带 target → ``AgentRun.target_workspace_id`` NULL、
  worktree 建 anchor root、provider/model 按 anchor、placement
  ``representative_fallback=False``（旧行为逐点对齐）；
- converge 全 completed → merge / cleanup 单组（git_merge 与
  git_worktree_remove 都只收 anchor workspace）。

用例组 B（验收 3/5 跨 ws 冒烟）``TestCrossWorkspaceSmoke``：
- ``POST /api/projects/{pid}/missions`` 建 scope 两 ws mission（anchor 缺省
  type=backend-code 优先——词表真值，非 "backend"）；
- dispatch_worker target=member（∈ scope）→ worktree/provider/placement 全按
  target 路由 + placement ``representative_fallback=True``（走代表 binding）；
- 不带 target 的 worker 维持 anchor 路由（旗标 False，零回归）；
- target ∉ scope → 400 ``mission_target_out_of_scope`` 且不落 run（拒绝先于建 run）；
- converge 全 completed → merge 按 (target, branch) 分组各 ws 调 git_merge、
  cleanup 分组各调 git_worktree_remove（D-011）；
- A 组（anchor）merge 冲突不挡 B 组（member ws）合并，conflicts 携带
  ``target_workspace_id`` 供分组辨认（design §4.3）。

已知实现缺口（task-16 verify 报告，不在本文件修）：dispatch 链路
（mcp_tools.dispatch_worker / execution.dispatch_worker / mcp_gateway 链路B）
均未把 target 落 ``run.target_workspace_id`` 列——design §4.1/§4.3 要求 converge
按 ``(target_workspace_id or anchor, worktree_branch)`` 分组，列空则跨 ws worker
全部折到 anchor 组。converge 用例在完成模拟步骤按 design 语义补齐该列（与
test_finalizer.py task-11/12 分组单测同款手法），钉住 converge 分组行为本身；
dispatch 落列缺口报告回主流程处理。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import password_hasher
from app.modules.agent.model import AgentRun
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance, DaemonRuntime
from app.modules.ppm.project.model import PpmProjectMaintenance
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
from app.modules.workspace.model import PpmProjectWorkspace, Workspace

# ---------------------------------------------------------------------------
# 公共 fixture：路径前缀裸化 + GLM 隔离
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def _bare_path_prefix(monkeypatch: pytest.MonkeyPatch) -> None:
    """resolve_root_path_for_daemon 无 prefix 配置时原样返回（对齐
    test_finalizer_cleanup 同款做法），sibling 断言可直接用裸 root_path 拼接。"""
    monkeypatch.setenv("HOST_PATH_PREFIX", "")
    monkeypatch.setenv("CONTAINER_PATH_PREFIX", "")


@pytest.fixture(autouse=True)
def _isolate_glm(monkeypatch: pytest.MonkeyPatch) -> None:
    """GLM 隔离（对齐 test_mcp_tools.TestConvergeMission._isolate_glm）。

    converge endpoint 的 ``GLMConfig.from_env`` 读 ANTHROPIC_* 环境变量——宿主
    shell 设有这两项时 ``_glm_merge`` 会向真实 LLM 网关发 HTTP（实测单用例 +18s
    且烧 token）。patch 源 module 使 from_env 返 None，finalize 走确定性 concat
    回退，测试零网络。
    """
    from app.modules.agent import delegation

    class _FakeGLMConfig:
        @staticmethod
        def from_env():
            return None

    monkeypatch.setattr(delegation, "GLMConfig", _FakeGLMConfig)


# ---------------------------------------------------------------------------
# 假件与数据构造
# ---------------------------------------------------------------------------


def _fake_delegate(
    merge_results: dict[tuple[uuid.UUID, str], dict[str, Any]] | None = None,
) -> Any:
    """HostFsDelegate mock。

    - ``git_worktree_add`` / ``git_worktree_remove`` 恒 ok；
    - ``git_merge`` 按 ``(ws.id, worker_branch)`` 派发结果（未命中默认 ok），
      调用记录挂 ``merge_calls`` 供分组断言。
    """
    mock: Any = MagicMock()
    mock.git_worktree_add = AsyncMock(
        return_value={"ok": True, "worktree_path": None, "error": None}
    )
    mock.git_worktree_remove = AsyncMock(return_value={"ok": True, "error": None})
    results = merge_results or {}

    async def _git_merge(workspace, *, worker_branch):
        mock.merge_calls.append((workspace.id, worker_branch))
        return results.get(
            (workspace.id, worker_branch),
            {"ok": True, "conflicts": [], "merged_files": [], "error": None},
        )

    mock.git_merge = _git_merge
    mock.merge_calls = []
    return mock


async def _make_workspace(
    db_session: AsyncSession,
    *,
    name: str,
    ws_type: str,
    root_path: str,
    default_agent: str = "claude_code",
    default_model: str = "claude-model",
) -> Workspace:
    uid = uuid.uuid4()
    ws = Workspace(
        id=uid,
        name=name,
        slug=f"{name}-{uid.hex[:8]}",
        root_path=root_path,
        default_branch="main",
        default_agent=default_agent,
        default_model=default_model,
        status="active",
        type=ws_type,
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _setup_cross_ws_project(db_session: AsyncSession, tmp_path) -> dict[str, Any]:
    """项目 + anchor(backend-code) + target(frontend-code) + 双 binding。

    打法对齐 test_router_project_missions._setup_project_env：PPM 项目关联两个
    workspace（PpmProjectWorkspace M:N）+ 一台 daemon 上两条 member binding，
    anchor 的 default_agent/model 与 target 不同——用于断言派发按目标 ws 取
    provider/model（design §4.2）。
    """
    owner_id = uuid.uuid4()
    db_session.add(
        User(
            id=owner_id,
            email=f"owner-{owner_id.hex[:8]}@example.com",
            password_hash=password_hasher.hash("Pass123!"),
            display_name="Binding Owner",
            status="active",
            is_platform_admin=False,
        )
    )

    anchor = await _make_workspace(
        db_session,
        name="后端工作区",
        ws_type="backend-code",
        root_path=str(tmp_path / "anchor"),
        default_agent="claude_anchor",
        default_model="model_anchor",
    )
    target = await _make_workspace(
        db_session,
        name="前端工作区",
        ws_type="frontend-code",
        root_path=str(tmp_path / "target"),
        default_agent="claude_target",
        default_model="model_target",
    )

    project_id = uuid.uuid4()
    db_session.add(
        PpmProjectMaintenance(
            id=project_id,
            project_name="跨工作区集成测试项目",
            project_code="XWS001",
            project_status="进行中",
            project_type="研发",
            created_by=owner_id,
        )
    )
    db_session.add(PpmProjectWorkspace(ppm_project_id=project_id, workspace_id=anchor.id))
    db_session.add(PpmProjectWorkspace(ppm_project_id=project_id, workspace_id=target.id))

    daemon_id = uuid.uuid4()
    db_session.add(
        DaemonInstance(
            id=daemon_id,
            user_id=owner_id,
            hostname="test-host",
            server_url="http://localhost:8001",
            status="online",
            last_heartbeat_at=datetime.now(UTC),
        )
    )
    runtime_id = uuid.uuid4()
    db_session.add(
        DaemonRuntime(
            id=runtime_id,
            daemon_instance_id=daemon_id,
            user_id=owner_id,
            name=f"runtime-{runtime_id.hex[:8]}",
            provider="claude",
            status="online",
            last_heartbeat_at=datetime.now(UTC),
        )
    )
    for ws in (anchor, target):
        db_session.add(
            WorkspaceMemberRuntime(
                workspace_id=ws.id,
                user_id=owner_id,
                runtime_id=runtime_id,
                daemon_id=daemon_id,
                root_path=ws.root_path,
                path_source="daemon-client",
            )
        )
    await db_session.commit()

    return {
        "project_id": project_id,
        "anchor_id": anchor.id,
        "target_id": target.id,
        "anchor_root": anchor.root_path,
        "target_root": target.root_path,
    }


# ---------------------------------------------------------------------------
# HTTP 动作 helper（统一 mock placement / delegate）
# ---------------------------------------------------------------------------

_PLACEMENT_PATH = "app.modules.agent.placement.RunPlacementService.dispatch_to_daemon"


async def _create_team_mission(
    client, headers: dict[str, str], ws_id: uuid.UUID, body: dict[str, Any]
) -> tuple[dict[str, Any], AsyncMock]:
    """POST /api/workspaces/{id}/missions（mode=team）→ (mission, placement mock)。"""
    placement: AsyncMock = AsyncMock(return_value=uuid.uuid4())
    with patch(_PLACEMENT_PATH, new=placement):
        resp = await client.post(f"/api/workspaces/{ws_id}/missions", json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json(), placement


async def _create_project_mission(
    client, headers: dict[str, str], project_id: uuid.UUID, body: dict[str, Any]
) -> tuple[dict[str, Any], AsyncMock]:
    """POST /api/projects/{pid}/missions → (mission, placement mock)。"""
    placement: AsyncMock = AsyncMock(return_value=uuid.uuid4())
    with patch(_PLACEMENT_PATH, new=placement):
        resp = await client.post(f"/api/projects/{project_id}/missions", json=body, headers=headers)
    assert resp.status_code == 201, resp.text
    return resp.json(), placement


async def _dispatch_worker(
    client,
    headers: dict[str, str],
    ws_id: uuid.UUID,
    mission_id: str,
    *,
    objective: str,
    target: uuid.UUID | None = None,
    extra: dict[str, Any] | None = None,
):
    """MCP dispatch_worker（假 delegate + 假 placement）→ (resp, fake, placement)。"""
    fake = _fake_delegate()
    placement: AsyncMock = AsyncMock(return_value=uuid.uuid4())
    body: dict[str, Any] = {"objective": objective, "role": "impl"}
    if target is not None:
        body["target_workspace_id"] = str(target)
    if extra:
        body.update(extra)
    with (
        patch("app.modules.agent.mcp_tools.new_host_fs_delegate", return_value=fake),
        patch(_PLACEMENT_PATH, new=placement),
    ):
        resp = await client.post(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/dispatch_worker",
            json=body,
            headers=headers,
        )
    return resp, fake, placement


async def _converge(
    client, headers: dict[str, str], ws_id: uuid.UUID, mission_id: str, fake
) -> dict[str, Any]:
    """POST converge（finalizer + mcp_tools 两处 delegate 都指向同一 fake）。"""
    with (
        patch("app.modules.agent.finalizer.new_host_fs_delegate", return_value=fake),
        patch("app.modules.agent.mcp_tools.new_host_fs_delegate", return_value=fake),
    ):
        resp = await client.post(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/converge", headers=headers
        )
    assert resp.status_code == 200, resp.text
    return resp.json()


async def _fetch_worker_runs(db_session: AsyncSession, mission_id: uuid.UUID) -> list[AgentRun]:
    """mission 下 worker runs（排除主 agent run），从 DB 现查。"""
    stmt = select(AgentRun).where(
        AgentRun.mission_id == mission_id, AgentRun.role != "orchestrator"
    )
    return list((await db_session.execute(stmt)).scalars().all())


async def _complete_all_runs(
    db_session: AsyncSession,
    mission_id: uuid.UUID,
    *,
    target_by_objective: dict[str, uuid.UUID] | None = None,
) -> None:
    """模拟 worker 完成（daemon 回报终态）：全部 run 标 completed + worker 落
    diff_summary/output（converge 采 patch artifact 的触发字段）。

    ``target_by_objective``：按 design §4.1/§4.3 语义补齐 worker 的
    ``target_workspace_id``（converge 分组键）。⚠️ 这是已知实现缺口的 harness
    侧补齐——dispatch 链路当前未落该列（见文件头注释），修复 dispatch 落列后
    此参数可移除。
    """
    stmt = select(AgentRun).where(AgentRun.mission_id == mission_id)
    runs = list((await db_session.execute(stmt)).scalars().all())
    for run in runs:
        run.status = "completed"
        run.finished_at = datetime.now(UTC)
        if run.role != "orchestrator":
            run.diff_summary = "diff --git a/x b/x\n+pass"
            run.output_redacted = "worker impl 摘要"
            if target_by_objective and run.objective in target_by_objective:
                run.target_workspace_id = target_by_objective[run.objective]
    await db_session.commit()


# ---------------------------------------------------------------------------
# 用例组 A：单 workspace mission 全链路零回归（验收 1）
# ---------------------------------------------------------------------------


class TestSingleWorkspaceZeroRegression:
    async def test_single_ws_mission_full_flow_unchanged(
        self, client, db_session, tmp_path, auth_headers
    ) -> None:
        """不传 scope/target：创建 → 主 agent 派发 → worker 派发 → converge，
        每一跳都与单 ws 旧行为一致（target_workspace_id NULL / borrow 维持 /
        merge+cleanup 单组）。"""
        ws = await _make_workspace(
            db_session,
            name="单ws",
            ws_type="backend-code",
            root_path=str(tmp_path / "single"),
            default_agent="claude_single",
            default_model="model_single",
        )

        # 1) 既有端点创建（mode=team，不传 scope/target）
        mission, placement = await _create_team_mission(
            client, auth_headers, ws.id, {"objective": "单工作区零回归", "mode": "team"}
        )
        assert mission["workspace_id"] == str(ws.id)
        assert mission["project_id"] is None
        assert mission["scope_workspace_ids"] is None
        assert (mission["constraints"] or {}).get("mode") == "team"
        # 主 agent run 派发按 anchor；team_mission_entry 不传 representative 旗标
        # （默认 False，主 agent 维持 borrow 兜底链——design §4.2 B-04）
        assert placement.await_count == 1
        main_kwargs = placement.call_args.kwargs
        assert main_kwargs["workspace_id"] == ws.id
        assert "representative_fallback" not in main_kwargs

        mission_id = mission["id"]
        mid = uuid.UUID(mission_id)

        # 主 agent run 落库
        main_run = (
            (await db_session.execute(select(AgentRun).where(AgentRun.mission_id == mid)))
            .scalars()
            .one()
        )
        assert main_run.role == "orchestrator"

        # 2) worker 派发不带 target
        resp, fake, placement = await _dispatch_worker(
            client, auth_headers, ws.id, mission_id, objective="改按钮文案"
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["status"] == "pending"
        assert resp.json()["error_code"] is None

        # worktree 建 anchor root（旧路径一致）
        fake.git_worktree_add.assert_awaited_once()
        assert fake.git_worktree_add.await_args.args[0].id == ws.id
        # placement 按 anchor 路由 + representative_fallback=False（borrow 维持）
        placement.assert_awaited_once()
        wk = placement.call_args.kwargs
        assert wk["workspace_id"] == ws.id
        assert wk["representative_fallback"] is False
        assert wk["provider"] == "claude_single"
        assert wk["model"] == "model_single"

        # DB：target_workspace_id NULL（旧行为）+ worktree_branch 按 task-03 公式填值
        workers = await _fetch_worker_runs(db_session, mid)
        assert len(workers) == 1
        worker = workers[0]
        assert worker.target_workspace_id is None
        assert worker.worktree_branch == f"workers/{str(worker.id)[:8]}"

        # 3) converge：全 completed → 单组 merge + 单组 cleanup
        await _complete_all_runs(db_session, mid)
        conv = await _converge(client, auth_headers, ws.id, mission_id, fake)
        assert conv["status"] == "merged"
        assert conv["converged"] is True
        assert conv["merged_branches"] == [worker.worktree_branch]

        # merge 单组：只 anchor ws 收到 git_merge（两次调用 = converge 内部
        # converge_mission_for_completed_run 与 endpoint _finalize_merge_for_mission
        # 各跑一遍 finalize，幂等重试，均落 anchor 组）
        merge_ws_ids = {ws_id for ws_id, _ in fake.merge_calls}
        assert merge_ws_ids == {ws.id}
        assert all(b == worker.worktree_branch for _, b in fake.merge_calls)

        # cleanup 单组：git_worktree_remove 收 anchor ws + task-03 sibling 公式
        fake.git_worktree_remove.assert_awaited_once()
        rm_args = fake.git_worktree_remove.await_args
        assert rm_args.args[0].id == ws.id
        assert rm_args.kwargs["sibling_path"] == f"{ws.root_path}/.worktrees/{str(worker.id)[:8]}"


# ---------------------------------------------------------------------------
# 用例组 B：跨工作区 mission 冒烟（验收 3 / 5）
# ---------------------------------------------------------------------------


class TestCrossWorkspaceSmoke:
    async def test_cross_ws_dispatch_target_routed_and_out_of_scope_rejected(
        self, client, db_session, tmp_path, auth_headers
    ) -> None:
        """项目维度建 scope 两 ws mission；target ∈ scope 放行且全链路按 target
        路由（worktree/provider/placement + representative 旗标开）；不带 target
        维持 anchor 路由；target ∉ scope 拒 400 且不落 run。"""
        env = await _setup_cross_ws_project(db_session, tmp_path)
        anchor_id: uuid.UUID = env["anchor_id"]
        target_id: uuid.UUID = env["target_id"]
        # 与项目无关的第三工作区（∉ scope）
        ws3 = await _make_workspace(
            db_session,
            name="无关ws",
            ws_type="business-doc",
            root_path=str(tmp_path / "ws3"),
        )

        # 1) 项目维度创建（不带 anchor → backend-code 优先，词表真值）
        mission, placement = await _create_project_mission(
            client,
            auth_headers,
            env["project_id"],
            {
                "objective": "跨工作区团队执行",
                "scope_workspace_ids": [str(anchor_id), str(target_id)],
            },
        )
        assert mission["project_id"] == str(env["project_id"])
        assert set(mission["scope_workspace_ids"]) == {str(anchor_id), str(target_id)}
        assert mission["workspace_id"] == str(anchor_id)
        assert (mission["constraints"] or {}).get("mode") == "team"
        # 主 agent 派发走 anchor 且不带 representative 旗标（B-04 维持 borrow）
        assert placement.await_count == 1
        assert placement.call_args.kwargs["workspace_id"] == anchor_id
        assert "representative_fallback" not in placement.call_args.kwargs

        mission_id = mission["id"]
        mid = uuid.UUID(mission_id)

        # 2) 主 agent 派 worker 到 target ws（∈ scope 放行）
        resp, fake, placement = await _dispatch_worker(
            client,
            auth_headers,
            anchor_id,
            mission_id,
            objective="前端任务",
            target=target_id,
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["status"] == "pending"
        assert resp.json()["error_code"] is None
        # worktree 落 target root（非 anchor）
        fake.git_worktree_add.assert_awaited_once()
        assert fake.git_worktree_add.await_args.args[0].id == target_id
        # placement 按 target 路由 + representative_fallback=True（代表 binding）
        placement.assert_awaited_once()
        wk = placement.call_args.kwargs
        assert wk["workspace_id"] == target_id
        assert wk["representative_fallback"] is True
        assert wk["provider"] == "claude_target"
        assert wk["model"] == "model_target"

        # task-16 review 追补：dispatch_worker 已把显式 target 落 run.target_workspace_id，
        # 供 finalizer converge/cleanup 按 (target or anchor) 分组读取。
        fe_run = (
            (
                await db_session.execute(
                    select(AgentRun).where(
                        AgentRun.mission_id == mid, AgentRun.objective == "前端任务"
                    )
                )
            )
            .scalars()
            .one()
        )
        assert fe_run.target_workspace_id == target_id
        assert fe_run.worktree_branch == f"workers/{str(fe_run.id)[:8]}"

        # 3) 不带 target 的 worker 维持 anchor 路由（旗标 False，零回归）
        resp2, _fake2, placement2 = await _dispatch_worker(
            client, auth_headers, anchor_id, mission_id, objective="后端任务"
        )
        assert resp2.status_code == 201, resp2.text
        placement2.assert_awaited_once()
        wk2 = placement2.call_args.kwargs
        assert wk2["workspace_id"] == anchor_id
        assert wk2["representative_fallback"] is False
        assert wk2["provider"] == "claude_anchor"

        # 4) target=ws3 ∉ scope → 400 mission_target_out_of_scope 且不落 run
        resp3 = await client.post(
            f"/api/workspaces/{anchor_id}/missions/{mission_id}/dispatch_worker",
            json={"objective": "越界任务", "target_workspace_id": str(ws3.id)},
            headers=auth_headers,
        )
        assert resp3.status_code == 400, resp3.text
        assert "mission_target_out_of_scope" in resp3.json().get("message", "")
        workers = await _fetch_worker_runs(db_session, mid)
        assert len(workers) == 2  # 越界派发不落 run（拒绝先于建 run）

    async def test_cross_ws_converge_merges_and_cleans_per_target_group(
        self, client, db_session, tmp_path, auth_headers
    ) -> None:
        """两个 worker（anchor 组 + target 组）全 completed → converge 按
        (target, branch) 分组：git_merge 各 ws 各分支、git_worktree_remove 分组
        清各自副本（D-011 cleanup 分组）。"""
        env = await _setup_cross_ws_project(db_session, tmp_path)
        anchor_id: uuid.UUID = env["anchor_id"]
        target_id: uuid.UUID = env["target_id"]

        mission, _placement = await _create_project_mission(
            client,
            auth_headers,
            env["project_id"],
            {
                "objective": "跨工作区收敛冒烟",
                "scope_workspace_ids": [str(anchor_id), str(target_id)],
            },
        )
        mission_id = mission["id"]
        mid = uuid.UUID(mission_id)

        resp_fe, _fake_fe, placement_fe = await _dispatch_worker(
            client,
            auth_headers,
            anchor_id,
            mission_id,
            objective="前端任务",
            target=target_id,
        )
        assert resp_fe.status_code == 201, resp_fe.text
        resp_be, _fake_be, placement_be = await _dispatch_worker(
            client, auth_headers, anchor_id, mission_id, objective="后端任务"
        )
        assert resp_be.status_code == 201, resp_be.text
        # 派发路由抽检：FE→target 旗标开、BE→anchor 旗标关
        assert placement_fe.call_args.kwargs["workspace_id"] == target_id
        assert placement_fe.call_args.kwargs["representative_fallback"] is True
        assert placement_be.call_args.kwargs["workspace_id"] == anchor_id
        assert placement_be.call_args.kwargs["representative_fallback"] is False

        # task-16 review 追补：dispatch 已落 target_workspace_id，无需 harness 侧补齐；
        # 仅模拟完成 worker，终态保持 design 语义（FE 显式 target，BE 单 ws 模式 NULL）。
        await _complete_all_runs(db_session, mid)
        workers = await _fetch_worker_runs(db_session, mid)
        by_objective = {w.objective: w for w in workers}
        fe, be = by_objective["前端任务"], by_objective["后端任务"]
        assert fe.target_workspace_id == target_id
        assert be.target_workspace_id is None

        fake = _fake_delegate()
        conv = await _converge(client, auth_headers, anchor_id, mission_id, fake)
        assert conv["status"] == "merged"
        assert conv["converged"] is True
        assert fe.worktree_branch is not None and be.worktree_branch is not None
        assert sorted(conv["merged_branches"]) == sorted([fe.worktree_branch, be.worktree_branch])

        # merge 分组：target 组收 FE 分支、anchor 组收 BE 分支（各 ws 各 daemon RPC）
        assert set(fake.merge_calls) == {
            (target_id, fe.worktree_branch),
            (anchor_id, be.worktree_branch),
        }

        # cleanup 分组：git_worktree_remove 各组各 ws，sibling 按 D-001@v2 公式
        assert fake.git_worktree_remove.await_count == 2
        rm_calls = {
            (c.args[0].id, c.kwargs["sibling_path"])
            for c in fake.git_worktree_remove.await_args_list
        }
        assert rm_calls == {
            (target_id, f"{env['target_root']}/.worktrees/{str(fe.id)[:8]}"),
            (anchor_id, f"{env['anchor_root']}/.worktrees/{str(be.id)[:8]}"),
        }

    async def test_cross_ws_converge_conflict_in_one_group_does_not_block_other(
        self, client, db_session, tmp_path, auth_headers
    ) -> None:
        """anchor 组 merge 冲突：B 组（target ws）照常合并、conflicts 携带
        target_workspace_id 分组辨认、冲突路径不清副本（X-003 保留供重入）。"""
        env = await _setup_cross_ws_project(db_session, tmp_path)
        anchor_id: uuid.UUID = env["anchor_id"]
        target_id: uuid.UUID = env["target_id"]

        mission, _placement = await _create_project_mission(
            client,
            auth_headers,
            env["project_id"],
            {
                "objective": "跨工作区冲突隔离冒烟",
                "scope_workspace_ids": [str(anchor_id), str(target_id)],
            },
        )
        mission_id = mission["id"]
        mid = uuid.UUID(mission_id)

        resp_fe, _, _ = await _dispatch_worker(
            client,
            auth_headers,
            anchor_id,
            mission_id,
            objective="前端任务",
            target=target_id,
        )
        assert resp_fe.status_code == 201, resp_fe.text
        resp_be, _, _ = await _dispatch_worker(
            client, auth_headers, anchor_id, mission_id, objective="后端任务"
        )
        assert resp_be.status_code == 201, resp_be.text

        await _complete_all_runs(db_session, mid)
        workers = await _fetch_worker_runs(db_session, mid)
        by_objective = {w.objective: w for w in workers}
        fe, be = by_objective["前端任务"], by_objective["后端任务"]

        # anchor 组（BE 分支）merge 返回冲突；target 组（FE 分支）ok
        assert fe.worktree_branch is not None and be.worktree_branch is not None
        fake = _fake_delegate(
            merge_results={
                (anchor_id, be.worktree_branch): {
                    "ok": False,
                    "conflicts": [{"file": "shared.py", "marker_lines": [10, 20]}],
                    "merged_files": [],
                    "error": None,
                },
            }
        )
        conv = await _converge(client, auth_headers, anchor_id, mission_id, fake)

        # A 组冲突不挡 B 组：两组分支都被实际尝试合并，FE 分支照常计入 merged
        assert set(fake.merge_calls) == {
            (anchor_id, be.worktree_branch),
            (target_id, fe.worktree_branch),
        }
        assert conv["status"] == "conflict"
        assert conv["converged"] is False
        assert conv["merged_branches"] == [fe.worktree_branch]
        # 冲突携带 target_workspace_id（design §4.3 分组可辨）
        assert len(conv["conflicts"]) == 1
        assert conv["conflicts"][0]["target_workspace_id"] == str(anchor_id)
        # 冲突路径不清副本（X-003：保留供主 agent 解决后重入 converge）
        fake.git_worktree_remove.assert_not_awaited()
