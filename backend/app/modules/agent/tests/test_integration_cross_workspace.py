"""跨工作区团队执行端到端集成冒烟（task-16 backend 部分）。

change ``2026-08-19-cross-workspace-team-mission`` task-16 / design §4（派发与收敛
链路）+ §10 验收 1 / 3 / 5。与单点单测互补（test_execution_target_routing 只测
execution 路由、test_finalize_execute_mission_merge / test_finalizer_cleanup 只测
finalizer 分组），本文件把「建 mission → 派发 → 收敛」串起来：service 级用假
delegate / 假 placement / GLM 隔离，不打真 daemon、不建真 worktree、零网络。

task-13（2026-08-22-team-session-unify / D-011）：``POST /api/workspaces/{id}/missions``
与 ``POST /api/projects/{pid}/missions`` create 端点删除后，mission 改
``_create_mission_direct`` 直建 DB（+ role='orchestrator' 主控 run 供 converge
锚定 ``_get_main_run``）；派发/收敛走保留的 MCP 端点（dispatch_worker /
converge），本文件继续钉住这两段的跨 ws 路由与分组行为。

task-15（2026-08-25-team-subsession-governance）：task-05 后 dispatch_worker
执行段整体换子会话三元组（AgentSession + interactive lease + 首 run，不再建
batch run / 不再调 ``placement.dispatch_to_daemon``）。本文件的派发路由断言
从「mock dispatch_to_daemon kwargs」机械迁移到新形态——派发走真实
``prepare_interactive_dispatch``（lease 落库，零网络），路由证据改从 interactive
lease 行断言：``metadata.workspace_id``（按 target/anchor 路由）、
``metadata.model``（按目标 ws 默认值）、``runtime_id``（钉定代表机器）、
``metadata.stage=mission_worker``、``metadata.cwd``（worktree 副本路径）。
旧 ``representative_fallback`` 旗标已随 batch 路径退场——新形态 runtime 解析
固定「自有在线优先 → 代表 binding 钉定」（D-004@v1），本文件两形态均落代表
机器。收敛断言不动：external mission（session_id NULL）分身不进
``mission_worker_sessions`` 枚举，derive/converge/cleanup 判据维持 run 维度。

用例组 A（验收 1 单 ws 零回归）``TestSingleWorkspaceZeroRegression``：
- 直建单 ws mission（不传 scope/target）→ mission 落库 project_id/scope NULL；
- MCP ``dispatch_worker`` 不带 target → ``AgentRun.target_workspace_id`` NULL、
  worktree 建 anchor root、lease metadata 按 anchor 路由（workspace_id/model）
  且 runtime 钉定 anchor 代表机器（旧行为逐点对齐到子会话形态）；
- converge 全 completed → merge / cleanup 单组（git_merge 与
  git_worktree_remove 都只收 anchor workspace）。

用例组 B（验收 3/5 跨 ws 冒烟）``TestCrossWorkspaceSmoke``：
- 直建 scope 两 ws mission（project 维度，anchor 显式落 backend-code）；
- dispatch_worker target=member（∈ scope）→ worktree/lease metadata 全按
  target 路由 + runtime 钉定代表机器；
- 不带 target 的 worker 维持 anchor 路由（lease metadata workspace_id=anchor，
  零回归）；
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

import json
import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import password_hasher
from app.modules.agent.execution import MISSION_WORKER_STAGE
from app.modules.agent.model import AgentMission, AgentRun, AgentSession
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease
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

    - ``probe_workspace_git_mode`` 恒 git（task-05 后派发段三态探测的确定性桩）；
    - ``git_worktree_add`` / ``git_worktree_remove`` 恒 ok；
    - ``git_merge`` 按 ``(ws.id, worker_branch)`` 派发结果（未命中默认 ok），
      调用记录挂 ``merge_calls`` 供分组断言。
    """
    mock: Any = MagicMock()
    mock.probe_workspace_git_mode = AsyncMock(return_value="git")
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


async def _stub_representative_binding(session: AsyncSession, ws_id: uuid.UUID) -> uuid.UUID:
    """给工作区造一条在线机器绑定（ql-20260822-008 派发前在线绑定预检用例）。

    与 test_mcp_tools._stub_representative_binding 同款：daemon_instances(online)
    + daemon_runtimes(online) + workspace_member_runtimes（member 绑定行，命中
    resolve_representative_binding 分支2「任意在线」）。raw SQL 注意 SQLite
    兼容：无 ::json 转换、显式 created_at/updated_at 字符串。跨 ws 项目用例
    （_setup_cross_ws_project）自带双 binding，仅单 ws 用例需要本 helper。

    task-15：返回绑定 runtime id——子会话派发（task-05）后路由证据从
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
        # task-15：双 ws 共享的代表 runtime（子会话派发钉定断言用）
        "runtime_id": runtime_id,
    }


# ---------------------------------------------------------------------------
# HTTP 动作 helper（统一 mock delegate；lease 行为真实落库）
# ---------------------------------------------------------------------------


async def _fetch_worker_lease(db_session: AsyncSession, run: AgentRun) -> DaemonTaskLease:
    """取分身首 run 绑定的 interactive lease（task-05 子会话派发形态）。

    agent_runs.lease_id FK → worktree_leases（不写 daemon lease id），
    需通过 sub_session.lease_id（FK → daemon_task_leases）获取。
    """
    assert run.agent_session_id is not None
    sub = await db_session.get(AgentSession, run.agent_session_id)
    assert sub is not None and sub.lease_id is not None, "子会话 lease_id 不应为 None"
    lease = await db_session.get(DaemonTaskLease, sub.lease_id)
    assert lease is not None
    return lease


def _lease_meta(lease: DaemonTaskLease) -> dict[str, Any]:
    raw = lease.metadata_
    return json.loads(raw) if isinstance(raw, str) else dict(raw or {})


async def _create_mission_direct(
    db_session: AsyncSession,
    ws_id: uuid.UUID,
    *,
    objective: str,
    project_id: uuid.UUID | None = None,
    scope_workspace_ids: list[uuid.UUID] | None = None,
) -> AgentMission:
    """直建 AgentMission + 主控 run（task-13 / D-011：create 端点已删）。

    落库形状对齐原 create 端点 ``team_mission_entry``：``constraints["mode"]="team"``、
    project/scope 列（scope 为 JSON 列，存 uuid-hex 字符串）、外加
    ``role='orchestrator'`` 主控 run——converge 的 ``_get_main_run`` 锚点
    （无主控 run 会 404）。主控 run 置 running（旧链路创建后即派发运行）。
    """
    mission = AgentMission(
        workspace_id=ws_id,
        objective=objective,
        constraints={"mode": "team"},
        project_id=project_id,
        scope_workspace_ids=(
            [str(s) for s in scope_workspace_ids] if scope_workspace_ids else None
        ),
    )
    db_session.add(mission)
    await db_session.commit()
    await db_session.refresh(mission)
    db_session.add(
        AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            status="running",
            role="orchestrator",
            objective=objective,
        )
    )
    await db_session.commit()
    return mission


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
    """MCP dispatch_worker（假 delegate；lease 真实落库）→ (resp, fake)。

    task-15：不再 mock ``dispatch_to_daemon``（task-05 后子会话派发不调它），
    派发链路走真实 ``prepare_interactive_dispatch``——lease 落库供路由断言，
    唤醒段无 WS 连接仅告警（零网络）。
    """
    fake = _fake_delegate()
    body: dict[str, Any] = {"objective": objective, "role": "impl"}
    if target is not None:
        body["target_workspace_id"] = str(target)
    if extra:
        body.update(extra)
    with patch("app.modules.agent.mcp_tools.new_host_fs_delegate", return_value=fake):
        resp = await client.post(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/dispatch_worker",
            json=body,
            headers=headers,
        )
    return resp, fake


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

        # 1) 直建 mission（mode=team，不传 scope/target；task-13/D-011 后创建入口
        #    归一会话触发，本链路只钉派发/收敛行为）
        mission = await _create_mission_direct(db_session, ws.id, objective="单工作区零回归")
        assert mission.workspace_id == ws.id
        assert mission.project_id is None
        assert mission.scope_workspace_ids is None
        assert (mission.constraints or {}).get("mode") == "team"

        mission_id = str(mission.id)
        mid = mission.id

        # 主 agent run 落库
        main_run = (
            (await db_session.execute(select(AgentRun).where(AgentRun.mission_id == mid)))
            .scalars()
            .one()
        )
        assert main_run.role == "orchestrator"

        # 2) worker 派发不带 target
        # ql-20260822-008：派发前在线绑定预检——单 ws 用例无 binding 会被 422
        # 前置拦截，给 anchor 造在线绑定（delegate 仍 mock，零网络）
        rep_rt_id = await _stub_representative_binding(db_session, ws.id)
        resp, fake = await _dispatch_worker(
            client, auth_headers, ws.id, mission_id, objective="改按钮文案"
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["status"] == "pending"
        assert resp.json()["error_code"] is None

        # worktree 建 anchor root（旧路径一致）
        fake.git_worktree_add.assert_awaited_once()
        assert fake.git_worktree_add.await_args.args[0].id == ws.id

        # task-15 断言迁移：不再 mock dispatch_to_daemon，路由证据改从子会话
        # interactive lease 断言——按 anchor 路由（metadata.workspace_id）、
        # model 按 anchor ws 默认值、runtime 钉定到 anchor 代表机器、
        # stage=mission_worker、cwd=worktree 副本路径。
        workers = await _fetch_worker_runs(db_session, mid)
        assert len(workers) == 1
        worker = workers[0]
        lease = await _fetch_worker_lease(db_session, worker)
        assert lease.kind == "interactive"
        assert lease.runtime_id == rep_rt_id
        meta = _lease_meta(lease)
        assert meta["stage"] == MISSION_WORKER_STAGE
        assert uuid.UUID(meta["workspace_id"]) == ws.id
        assert meta["model"] == "model_single"
        # D-004@v1 解析序：lease provider 取代表 binding runtime 的 provider
        assert meta["provider"] == "claude"
        assert meta["cwd"] == f"{ws.root_path}/.worktrees/{str(worker.id)[:8]}"

        # DB：target_workspace_id NULL（旧行为）+ worktree_branch 按 task-03 公式填值
        assert worker.target_workspace_id is None
        assert worker.worktree_branch == f"workers/{str(worker.id)[:8]}"

        # 3) converge：全 completed → 单组 merge + 单组 cleanup
        await _complete_all_runs(db_session, mid)
        conv = await _converge(client, auth_headers, ws.id, mission_id, fake)
        # task-06 四值改名：converge 响应 status=converged（原 merged）
        assert conv["status"] == "converged"
        assert conv["converged"] is True
        assert conv["merged_branches"] == [worker.worktree_branch]

        # merge 单组：只 anchor ws 收到 git_merge（两次调用 = converge 内部
        # converge_mission_for_completed_run 与 endpoint _finalize_merge_for_mission
        # 各跑一遍 finalize，幂等重试，均落 anchor 组）
        merge_ws_ids = {ws_id for ws_id, _ in fake.merge_calls}
        assert merge_ws_ids == {ws.id}
        assert all(b == worker.worktree_branch for _, b in fake.merge_calls)

        # cleanup 单组：git_worktree_remove 收 anchor ws + task-03 sibling 公式。
        # BE-P1-4b 后双路径各清一遍（converge_mission_for_completed_run 自动收敛 +
        # 端点 merged 分支 _cleanup_mission），幂等重试（第二遍 worktree 已不存在，
        # daemon 端快速返回），均落 anchor 组。
        assert fake.git_worktree_remove.await_count == 2
        rm_args_list = fake.git_worktree_remove.await_args_list
        assert all(
            c.args[0].id == ws.id
            and c.kwargs["sibling_path"] == f"{ws.root_path}/.worktrees/{str(worker.id)[:8]}"
            for c in rm_args_list
        )


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

        # 1) 直建项目维度 mission（scope 两 ws，anchor 显式落 backend-code——
        #    原 create 端点的 anchor 缺省派生随端点删除，直建不再覆盖该逻辑）
        mission = await _create_mission_direct(
            db_session,
            anchor_id,
            objective="跨工作区团队执行",
            project_id=env["project_id"],
            scope_workspace_ids=[anchor_id, target_id],
        )
        assert mission.project_id == env["project_id"]
        assert set(mission.scope_workspace_ids or []) == {str(anchor_id), str(target_id)}
        assert mission.workspace_id == anchor_id
        assert (mission.constraints or {}).get("mode") == "team"

        mission_id = str(mission.id)
        mid = mission.id

        # 2) 主 agent 派 worker 到 target ws（∈ scope 放行）
        resp, fake = await _dispatch_worker(
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

        # task-15 断言迁移：路由证据改从子会话 interactive lease 断言——按
        # target 路由（metadata.workspace_id=target）、model 按 target ws 默认值、
        # runtime 钉定代表机器（D-004@v1，创建者无自有在线 runtime）。
        fe_lease = await _fetch_worker_lease(db_session, fe_run)
        assert fe_lease.kind == "interactive"
        assert fe_lease.runtime_id == env["runtime_id"]
        fe_meta = _lease_meta(fe_lease)
        assert fe_meta["stage"] == MISSION_WORKER_STAGE
        assert uuid.UUID(fe_meta["workspace_id"]) == target_id
        assert fe_meta["model"] == "model_target"
        assert fe_meta["cwd"] == f"{env['target_root']}/.worktrees/{str(fe_run.id)[:8]}"

        # 3) 不带 target 的 worker 维持 anchor 路由（零回归）
        resp2, _fake2 = await _dispatch_worker(
            client, auth_headers, anchor_id, mission_id, objective="后端任务"
        )
        assert resp2.status_code == 201, resp2.text
        be_run = (
            (
                await db_session.execute(
                    select(AgentRun).where(
                        AgentRun.mission_id == mid, AgentRun.objective == "后端任务"
                    )
                )
            )
            .scalars()
            .one()
        )
        assert be_run.target_workspace_id is None
        be_lease = await _fetch_worker_lease(db_session, be_run)
        be_meta = _lease_meta(be_lease)
        assert uuid.UUID(be_meta["workspace_id"]) == anchor_id
        assert be_meta["model"] == "model_anchor"
        assert be_lease.runtime_id == env["runtime_id"]

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

        mission = await _create_mission_direct(
            db_session,
            anchor_id,
            objective="跨工作区收敛冒烟",
            project_id=env["project_id"],
            scope_workspace_ids=[anchor_id, target_id],
        )
        mission_id = str(mission.id)
        mid = mission.id

        resp_fe, _fake_fe = await _dispatch_worker(
            client,
            auth_headers,
            anchor_id,
            mission_id,
            objective="前端任务",
            target=target_id,
        )
        assert resp_fe.status_code == 201, resp_fe.text
        resp_be, _fake_be = await _dispatch_worker(
            client, auth_headers, anchor_id, mission_id, objective="后端任务"
        )
        assert resp_be.status_code == 201, resp_be.text
        # 派发路由抽检（task-15 断言迁移）：FE→target、BE→anchor（lease metadata
        # workspace_id；旧 representative_fallback 旗标随 batch 路径退场）
        _workers_probe = await _fetch_worker_runs(db_session, mid)
        _by_obj_probe = {w.objective: w for w in _workers_probe}
        fe_meta_probe = _lease_meta(
            await _fetch_worker_lease(db_session, _by_obj_probe["前端任务"])
        )
        be_meta_probe = _lease_meta(
            await _fetch_worker_lease(db_session, _by_obj_probe["后端任务"])
        )
        assert uuid.UUID(fe_meta_probe["workspace_id"]) == target_id
        assert uuid.UUID(be_meta_probe["workspace_id"]) == anchor_id

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
        # task-06 四值改名：converge 响应 status=converged（原 merged）
        assert conv["status"] == "converged"
        assert conv["converged"] is True
        assert fe.worktree_branch is not None and be.worktree_branch is not None
        assert sorted(conv["merged_branches"]) == sorted([fe.worktree_branch, be.worktree_branch])

        # merge 分组：target 组收 FE 分支、anchor 组收 BE 分支（各 ws 各 daemon RPC）
        assert set(fake.merge_calls) == {
            (target_id, fe.worktree_branch),
            (anchor_id, be.worktree_branch),
        }

        # cleanup 分组：git_worktree_remove 各组各 ws，sibling 按 D-001@v2 公式。
        # BE-P1-4b 后双路径各清一遍（自动收敛 + 端点 merged 分支），幂等重试，
        # 每组恰好 2 次。
        assert fake.git_worktree_remove.await_count == 4
        rm_calls = [
            (c.args[0].id, c.kwargs["sibling_path"])
            for c in fake.git_worktree_remove.await_args_list
        ]
        expected = [
            (target_id, f"{env['target_root']}/.worktrees/{str(fe.id)[:8]}"),
            (anchor_id, f"{env['anchor_root']}/.worktrees/{str(be.id)[:8]}"),
        ]
        assert set(rm_calls) == set(expected)
        assert all(rm_calls.count(e) == 2 for e in expected)

    async def test_cross_ws_converge_conflict_in_one_group_does_not_block_other(
        self, client, db_session, tmp_path, auth_headers
    ) -> None:
        """anchor 组 merge 冲突：B 组（target ws）照常合并、conflicts 携带
        target_workspace_id 分组辨认、冲突路径不清副本（X-003 保留供重入）。"""
        env = await _setup_cross_ws_project(db_session, tmp_path)
        anchor_id: uuid.UUID = env["anchor_id"]
        target_id: uuid.UUID = env["target_id"]

        mission = await _create_mission_direct(
            db_session,
            anchor_id,
            objective="跨工作区冲突隔离冒烟",
            project_id=env["project_id"],
            scope_workspace_ids=[anchor_id, target_id],
        )
        mission_id = str(mission.id)
        mid = mission.id

        resp_fe, _ = await _dispatch_worker(
            client,
            auth_headers,
            anchor_id,
            mission_id,
            objective="前端任务",
            target=target_id,
        )
        assert resp_fe.status_code == 201, resp_fe.text
        resp_be, _ = await _dispatch_worker(
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
