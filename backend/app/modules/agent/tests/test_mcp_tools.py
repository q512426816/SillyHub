"""Tests for MCP tool endpoints（2026-07-12-team-main-agent-orchestration task-03 / D-007@v2）。

覆盖 5 endpoint 各返回正确结构：
- POST dispatch_worker：建 worker run + 派 lease（daemon 离线时 error_code）。
- GET workers/{id}/result：读 worker AgentArtifact。
- GET workers：列 mission 下所有 run 状态。
- POST converge：触发 FinalizerService 收敛（全终态 → done）。
- POST progress：落主 agent 决策日志（AgentRunLog）。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentArtifact, AgentMission, AgentRun, AgentRunLog
from app.modules.agent.profile.model import AgentProfile
from app.modules.workspace.model import Workspace


async def _seed_workspace_and_mission(
    session: AsyncSession,
    *,
    with_main_run: bool = True,
    main_run_status: str = "completed",
) -> tuple[uuid.UUID, uuid.UUID, AgentRun | None]:
    """建 workspace + mission（含 worker_preset/main_agent_config）+ 主 agent run。"""
    ws_id = uuid.uuid4()
    ws = Workspace(
        id=ws_id,
        name=f"ws-{ws_id.hex[:8]}",
        slug=f"ws-{ws_id.hex[:8]}",
        root_path=f"/tmp/{ws_id.hex}",
    )
    session.add(ws)
    await session.commit()

    mission = AgentMission(
        workspace_id=ws_id,
        objective="团队目标",
        constraints={"mode": "team"},
        worker_preset=[{"role": "arch", "agent_type": "claude_code", "objective": "扫描"}],
        main_agent_config={"agent_type": "claude_code", "provider": "claude"},
    )
    session.add(mission)
    await session.commit()
    await session.refresh(mission)

    main_run: AgentRun | None = None
    if with_main_run:
        main_run = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            provider="claude",
            status=main_run_status,
            role="orchestrator",
            objective="团队目标",
        )
        session.add(main_run)
        await session.commit()
        await session.refresh(main_run)
    return ws_id, mission.id, main_run


class TestDispatchWorker:
    @pytest.mark.asyncio
    async def test_dispatch_creates_worker_run(self, client, db_session, auth_headers) -> None:
        """POST dispatch_worker → 建 worker run（无 binding → failed + hostfs_unavailable）。

        BE-P1-2（2026-08-21 审查）契约：workspace 无 bound daemon 时
        ``git_worktree_add`` 抛 ``HostFsDelegateUnavailable``，execution 内部收敛为
        ``failed + error_code=hostfs_unavailable``（201 响应携带终态 run）。旧契约
        （503 fail-loud，ql-20260713-002）的缺陷：异常冒泡后 run 已落库 pending 且
        无终态化路径 → derive_status 永远 running、mission 挂死。
        """
        ws_id, mission_id, _ = await _seed_workspace_and_mission(db_session)
        resp = await client.post(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/dispatch_worker",
            json={"objective": "扫描架构", "role": "arch", "read_only": True},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["status"] == "failed"
        assert data["error_code"] == "hostfs_unavailable"

    @pytest.mark.asyncio
    async def test_dispatch_missing_role_uses_default(
        self, client, db_session, auth_headers
    ) -> None:
        """role 缺省 → 默认 worker（无 binding → failed + hostfs_unavailable）。

        BE-P1-2 后无 binding 走 201 + failed（见 test_dispatch_creates_worker_run），
        本测校验建 run 时 role 兜底为 ``worker``：直接查 DB 校验。
        """
        ws_id, mission_id, _ = await _seed_workspace_and_mission(db_session)
        resp = await client.post(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/dispatch_worker",
            json={"objective": "做事"},
            headers=auth_headers,
        )
        # 无 binding → 201 + failed（BE-P1-2 契约）
        assert resp.status_code == 201, resp.text
        assert resp.json()["status"] == "failed"
        # run 在 dispatch_worker 前置已建（mcp_tools.py:316-328 commit），role 兜底 worker
        from sqlalchemy import select

        stmt = (
            select(AgentRun)
            .where(AgentRun.mission_id == mission_id)
            .order_by(AgentRun.created_at.desc())
        )
        run = (await db_session.execute(stmt)).scalars().first()
        assert run is not None
        assert run.role == "worker"


class TestGetWorkerResult:
    @pytest.mark.asyncio
    async def test_get_result_reads_artifacts(self, client, db_session, auth_headers) -> None:
        """GET workers/{id}/result → 读 worker AgentArtifact。"""
        ws_id, mission_id, _ = await _seed_workspace_and_mission(db_session)
        worker = AgentRun(
            mission_id=mission_id,
            agent_type="claude_code",
            status="completed",
            role="arch",
            objective="扫描",
        )
        db_session.add(worker)
        await db_session.commit()
        await db_session.refresh(worker)
        art = AgentArtifact(
            run_id=worker.id,
            kind="summary",
            content_ref="架构摘要内容",
        )
        db_session.add(art)
        await db_session.commit()

        resp = await client.get(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/workers/{worker.id}/result",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["worker_id"] == str(worker.id)
        assert data["status"] == "completed"
        assert len(data["artifacts"]) == 1
        assert data["artifacts"][0]["kind"] == "summary"
        assert data["artifacts"][0]["content_ref"] == "架构摘要内容"

    @pytest.mark.asyncio
    async def test_get_result_404_for_wrong_mission(self, client, db_session, auth_headers) -> None:
        """worker 不属于该 mission → 404。"""
        ws_id, mission_id, _ = await _seed_workspace_and_mission(db_session)
        other_run = AgentRun(
            mission_id=None,
            agent_type="claude_code",
            status="completed",
        )
        db_session.add(other_run)
        await db_session.commit()
        await db_session.refresh(other_run)
        resp = await client.get(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/workers/{other_run.id}/result",
            headers=auth_headers,
        )
        assert resp.status_code == 404


class TestListWorkers:
    @pytest.mark.asyncio
    async def test_list_returns_all_runs(self, client, db_session, auth_headers) -> None:
        """GET workers → 列 mission 下所有 run（含主 agent + worker）。"""
        ws_id, mission_id, _main_run = await _seed_workspace_and_mission(db_session)
        worker = AgentRun(
            mission_id=mission_id,
            agent_type="claude_code",
            status="completed",
            role="arch",
            objective="扫描",
            total_cost_usd=0.5,
        )
        db_session.add(worker)
        await db_session.commit()

        resp = await client.get(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/workers",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["mission_id"] == str(mission_id)
        roles = {w["role"] for w in data["workers"]}
        assert "orchestrator" in roles
        assert "arch" in roles
        assert len(data["workers"]) == 2


class TestConvergeMission:
    @pytest.fixture(autouse=True)
    def _isolate_glm(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """GLM 隔离（对齐 test_converge_mission_reentrant.py 同款做法）。

        converge endpoint 的 ``GLMConfig.from_env`` 读 ANTHROPIC_BASE_URL /
        ANTHROPIC_AUTH_TOKEN 环境变量——宿主 shell（如 Claude Code 网关配置）
        设有这两项时 ``_glm_merge`` 会向真实 LLM 网关发 HTTP（实测单用例
        +18s 且烧 token）。patch 源 module delegation 使 from_env 返 None，
        finalize 走确定性 concat 回退，测试零网络。
        """
        from app.modules.agent import delegation

        class _FakeGLMConfig:
            @staticmethod
            def from_env():
                return None

        monkeypatch.setattr(delegation, "GLMConfig", _FakeGLMConfig)

    @pytest.mark.asyncio
    async def test_converge_all_completed(self, client, db_session, auth_headers) -> None:
        """POST converge → 全终态（completed）→ done → converged=True。"""
        ws_id, mission_id, _main_run = await _seed_workspace_and_mission(
            db_session, main_run_status="completed"
        )
        worker = AgentRun(
            mission_id=mission_id,
            agent_type="claude_code",
            status="completed",
            role="arch",
            objective="扫描",
        )
        db_session.add(worker)
        await db_session.commit()
        await db_session.refresh(worker)
        art = AgentArtifact(run_id=worker.id, kind="summary", content_ref="摘要")
        db_session.add(art)
        await db_session.commit()

        resp = await client.post(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/converge",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["mission_id"] == str(mission_id)
        assert data["status"] == "done"
        assert data["converged"] is True
        assert data["artifact_id"] is not None

    @pytest.mark.asyncio
    async def test_converge_running_when_worker_pending(
        self, client, db_session, auth_headers
    ) -> None:
        """POST converge → 有 pending worker → status=running → converged=False。"""
        ws_id, mission_id, _ = await _seed_workspace_and_mission(
            db_session, main_run_status="completed"
        )
        worker = AgentRun(
            mission_id=mission_id,
            agent_type="claude_code",
            status="pending",
            role="arch",
            objective="扫描",
        )
        db_session.add(worker)
        await db_session.commit()

        resp = await client.post(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/converge",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["converged"] is False
        assert data["status"] == "running"


class TestReportProgress:
    @pytest.mark.asyncio
    async def test_progress_writes_log(self, client, db_session, auth_headers) -> None:
        """POST progress → 落 AgentRunLog（channel=tool_call, tool_kind=other）。"""
        ws_id, mission_id, main_run = await _seed_workspace_and_mission(db_session)
        resp = await client.post(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/progress",
            json={
                "run_id": str(main_run.id),
                "message": "已派 arch worker",
                "decision": "dispatch",
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        data = resp.json()
        assert data["run_id"] == str(main_run.id)
        assert data["log_id"] is not None

        # 从 DB 重查确认日志落库
        from sqlalchemy import select

        log = (
            (
                await db_session.execute(
                    select(AgentRunLog).where(AgentRunLog.id == uuid.UUID(data["log_id"]))
                )
            )
            .scalars()
            .first()
        )
        assert log is not None
        assert log.channel == "tool_call"
        assert log.tool_kind == "other"
        assert "[dispatch]" in (log.content_redacted or "")
        assert "已派 arch worker" in (log.content_redacted or "")

    @pytest.mark.asyncio
    async def test_progress_404_for_run_outside_mission(
        self, client, db_session, auth_headers
    ) -> None:
        """run 不属于该 mission → 404。"""
        ws_id, mission_id, _ = await _seed_workspace_and_mission(db_session)
        other = AgentRun(
            mission_id=None,
            agent_type="claude_code",
            status="completed",
        )
        db_session.add(other)
        await db_session.commit()
        await db_session.refresh(other)
        resp = await client.post(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/progress",
            json={"run_id": str(other.id), "message": "x"},
            headers=auth_headers,
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# task-08：跨工作区派发测试（2026-08-19-cross-workspace-team-mission §7.2 链路A）
# ---------------------------------------------------------------------------


class TestCrossWorkspaceDispatch:
    """task-08：MCP 链路A scope 放宽与 target 参数测试。

    覆盖 acceptance 五条：
    - scope 包含 workspace_id 或 workspace_id ∈ scope_workspace_ids 时通过校验
    - target_workspace_id ∈ scope 时 dispatch_worker 成功派发
    - target_workspace_id ∉ scope 时返回 400 错误码 mission_target_out_of_scope
    - profile.workspace_id ∈ {anchor} ∪ scope 时通过校验，否则 400
    - 单 workspace mission（scope 为 NULL 或 [workspace_id]）行为零回归
    """

    async def _seed_cross_ws_mission(
        self,
        session: AsyncSession,
        *,
        with_target_in_scope: bool = False,
    ) -> tuple[uuid.UUID, uuid.UUID | None, uuid.UUID, AgentMission]:
        """建跨工作区 mission：anchor（ws1）+ target（ws2 可选）。

        with_target_in_scope=True：创建 target ws 并加入 scope（跨 ws 场景）
        with_target_in_scope=False：不创建 target ws（单 ws 场景）

        返回 (anchor_ws_id, target_ws_id|None, mission_id, mission)。
        """
        anchor_ws_id = uuid.uuid4()
        anchor_ws = Workspace(
            id=anchor_ws_id,
            name=f"anchor-{anchor_ws_id.hex[:8]}",
            slug=f"anchor-{anchor_ws_id.hex[:8]}",
            root_path=f"/tmp/anchor-{anchor_ws_id.hex}",
        )
        session.add(anchor_ws)

        target_ws_id: uuid.UUID | None = None
        scope_ids: list[str] | None = None

        if with_target_in_scope:
            target_ws_id = uuid.uuid4()
            target_ws = Workspace(
                id=target_ws_id,
                name=f"target-{target_ws_id.hex[:8]}",
                slug=f"target-{target_ws_id.hex[:8]}",
                root_path=f"/tmp/target-{target_ws_id.hex}",
            )
            session.add(target_ws)
            scope_ids = [str(target_ws_id)]
            await session.commit()

        mission = AgentMission(
            workspace_id=anchor_ws_id,
            objective="跨工作区任务",
            constraints={"mode": "team"},
            worker_preset=[{"role": "worker", "agent_type": "claude_code"}],
            main_agent_config={"agent_type": "claude_code"},
            scope_workspace_ids=scope_ids,
        )
        session.add(mission)
        await session.commit()
        await session.refresh(mission)

        return anchor_ws_id, target_ws_id, mission.id, mission

    @pytest.mark.asyncio
    async def test_get_mission_accepts_anchor_in_scope(
        self, client, db_session, auth_headers
    ) -> None:
        """_get_mission 校验放宽：anchor 匹配放行（快速路径）。"""
        anchor_ws_id, _target_ws_id, mission_id, _mission = await self._seed_cross_ws_mission(
            db_session, with_target_in_scope=True
        )
        # 用 anchor workspace 调 endpoint → 404（不在 scope 中）
        resp = await client.get(
            f"/api/workspaces/{anchor_ws_id}/missions/{mission_id}/workers",
            headers=auth_headers,
        )
        # anchor 是 workspace_id 本身，应该放行
        assert resp.status_code == 200, resp.text

    @pytest.mark.asyncio
    async def test_get_mission_accepts_workspace_in_scope(
        self, client, db_session, auth_headers
    ) -> None:
        """_get_mission 校验放宽：workspace_id ∈ scope_workspace_ids 放行。"""
        _anchor_ws_id, target_ws_id, mission_id, _mission = await self._seed_cross_ws_mission(
            db_session, with_target_in_scope=True
        )
        # 用 target workspace 调 endpoint → 应该放行（target 在 scope 中）
        resp = await client.get(
            f"/api/workspaces/{target_ws_id}/missions/{mission_id}/workers",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text

    @pytest.mark.asyncio
    async def test_get_mission_null_scope_treated_as_anchor(
        self, client, db_session, auth_headers
    ) -> None:
        """_get_mission：scope 为 NULL 按 [workspace_id] 处理（P2-2）。"""
        ws_id, mission_id, _ = await _seed_workspace_and_mission(db_session)
        # scope 为 NULL，只有 anchor 可访问
        other_ws_id = uuid.uuid4()
        other_ws = Workspace(
            id=other_ws_id,
            name=f"other-{other_ws_id.hex[:8]}",
            slug=f"other-{other_ws_id.hex[:8]}",
            root_path=f"/tmp/other-{other_ws_id.hex}",
        )
        db_session.add(other_ws)
        await db_session.commit()

        # 其他 workspace 访问 → 404
        resp = await client.get(
            f"/api/workspaces/{other_ws_id}/missions/{mission_id}/workers",
            headers=auth_headers,
        )
        assert resp.status_code == 404, resp.text

        # anchor 访问 → 200
        resp = await client.get(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/workers",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text

    @pytest.mark.asyncio
    async def test_dispatch_target_in_scope_accepted(
        self, client, db_session, auth_headers
    ) -> None:
        """dispatch_worker：target_workspace_id ∈ scope → 派发成功（503 因无 binding）。"""
        anchor_ws_id, target_ws_id, mission_id, _mission = await self._seed_cross_ws_mission(
            db_session, with_target_in_scope=True
        )
        # 派发到 target（在 scope 中）
        resp = await client.post(
            f"/api/workspaces/{anchor_ws_id}/missions/{mission_id}/dispatch_worker",
            json={
                "objective": "跨工作区任务",
                "target_workspace_id": str(target_ws_id),
            },
            headers=auth_headers,
        )
        # 无 binding → 201 + failed（BE-P1-2 契约，证明 scope 校验通过）
        assert resp.status_code == 201, resp.text
        assert resp.json()["error_code"] == "hostfs_unavailable"

    @pytest.mark.asyncio
    async def test_dispatch_target_out_of_scope_400(self, client, db_session, auth_headers) -> None:
        """dispatch_worker：target_workspace_id ∉ scope → 400 mission_target_out_of_scope。"""
        anchor_ws_id, _target_ws_id, mission_id, _mission = await self._seed_cross_ws_mission(
            db_session, with_target_in_scope=True
        )
        unrelated_ws_id = uuid.uuid4()
        unrelated_ws = Workspace(
            id=unrelated_ws_id,
            name=f"unrelated-{unrelated_ws_id.hex[:8]}",
            slug=f"unrelated-{unrelated_ws_id.hex[:8]}",
            root_path=f"/tmp/unrelated-{unrelated_ws_id.hex}",
        )
        db_session.add(unrelated_ws)
        await db_session.commit()

        # 派发到 unrelated workspace（不在 scope 中）
        resp = await client.post(
            f"/api/workspaces/{anchor_ws_id}/missions/{mission_id}/dispatch_worker",
            json={
                "objective": "跨工作区任务",
                "target_workspace_id": str(unrelated_ws_id),
            },
            headers=auth_headers,
        )
        assert resp.status_code == 400, resp.text
        data = resp.json()
        # 错误在 message 字段（AppError 统一格式）
        assert "mission_target_out_of_scope" in data.get("message", "")

    @pytest.mark.asyncio
    async def test_dispatch_target_null_fallback_to_anchor(
        self, client, db_session, auth_headers
    ) -> None:
        """dispatch_worker：target_workspace_id 为 NULL → fallback 到 anchor（零回归）。"""
        anchor_ws_id, _target_ws_id, mission_id, _mission = await self._seed_cross_ws_mission(
            db_session, with_target_in_scope=True
        )
        # 不传 target_workspace_id → fallback 到 anchor
        resp = await client.post(
            f"/api/workspaces/{anchor_ws_id}/missions/{mission_id}/dispatch_worker",
            json={"objective": "单工作区任务"},
            headers=auth_headers,
        )
        # 无 binding → 201 + failed（BE-P1-2 契约，证明 target=anchor 校验通过）
        assert resp.status_code == 201, resp.text
        assert resp.json()["error_code"] == "hostfs_unavailable"

    @pytest.mark.asyncio
    async def test_profile_in_scope_accepted(self, client, db_session, auth_headers) -> None:
        """_resolve_dispatch_agent_profile：profile.workspace_id ∈ {anchor} ∪ scope 放行（P2-1）。"""
        anchor_ws_id, target_ws_id, mission_id, _mission = await self._seed_cross_ws_mission(
            db_session, with_target_in_scope=True
        )
        # 建 target workspace 的 profile
        from app.modules.agent.profile.model import AgentProfileVisibility

        profile = AgentProfile(
            id=uuid.uuid4(),
            workspace_id=target_ws_id,
            name="target-profile",
            visibility=AgentProfileVisibility.WORKSPACE.value,
            provider="claude",
            created_by=uuid.uuid4(),
        )
        db_session.add(profile)
        await db_session.commit()
        await db_session.refresh(profile)

        # 绑 target workspace 的 profile（在 scope 中）→ 应该通过校验（503 因无 binding）
        resp = await client.post(
            f"/api/workspaces/{anchor_ws_id}/missions/{mission_id}/dispatch_worker",
            json={
                "objective": "跨工作区任务",
                "agent_profile_id": str(profile.id),
            },
            headers=auth_headers,
        )
        # 无 binding → 201 + failed（BE-P1-2 契约，证明 profile 校验通过）
        assert resp.status_code == 201, resp.text
        assert resp.json()["error_code"] == "hostfs_unavailable"

    @pytest.mark.asyncio
    async def test_profile_out_of_scope_400(self, client, db_session, auth_headers) -> None:
        """_resolve_dispatch_agent_profile：profile.workspace_id ∉ {anchor} ∪ scope → 400。"""
        # 建 anchor mission（scope 不含 target）
        anchor_ws_id, mission_id, _ = await _seed_workspace_and_mission(db_session)

        # 建 target workspace 和 profile
        target_ws_id = uuid.uuid4()
        target_ws = Workspace(
            id=target_ws_id,
            name=f"target-{target_ws_id.hex[:8]}",
            slug=f"target-{target_ws_id.hex[:8]}",
            root_path=f"/tmp/target-{target_ws_id.hex}",
        )
        db_session.add(target_ws)
        await db_session.commit()

        from app.modules.agent.profile.model import AgentProfileVisibility

        profile = AgentProfile(
            id=uuid.uuid4(),
            workspace_id=target_ws_id,
            name="target-profile",
            visibility=AgentProfileVisibility.WORKSPACE.value,
            provider="claude",
            created_by=uuid.uuid4(),
        )
        db_session.add(profile)
        await db_session.commit()
        await db_session.refresh(profile)

        # 绑 target workspace 的 profile（不在 scope 中）→ 400
        resp = await client.post(
            f"/api/workspaces/{anchor_ws_id}/missions/{mission_id}/dispatch_worker",
            json={
                "objective": "跨工作区任务",
                "agent_profile_id": str(profile.id),
            },
            headers=auth_headers,
        )
        assert resp.status_code == 400, resp.text
        data = resp.json()
        # 错误在 message 字段（AppError 统一格式）
        assert "其它 workspace" in data.get("message", "")
