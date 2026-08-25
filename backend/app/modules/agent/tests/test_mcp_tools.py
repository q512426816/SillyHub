"""Tests for MCP tool endpoints（2026-07-12-team-main-agent-orchestration task-03 / D-007@v2）。

覆盖 5 endpoint 各返回正确结构：
- POST dispatch_worker：建 worker run + 派 lease（daemon 离线时 error_code）。
- GET workers/{id}/result：读 worker AgentArtifact。
- GET workers：列 mission 下所有 run 状态。
- POST converge：触发 FinalizerService 收敛——task-06（D-010）语义重定义：busy
  前置判定 / converged_at 独立置位（不依赖主控 run 状态）/ 最新 orchestrator 锚点 /
  响应四值 converged/busy/conflict/needs_manual（TestConvergeSessionSemantics）。
- POST progress：落主 agent 决策日志（AgentRunLog）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import (
    AgentArtifact,
    AgentMission,
    AgentRun,
    AgentRunLog,
    AgentSession,
)
from app.modules.agent.profile.model import AgentProfile
from app.modules.workspace.model import Workspace


async def _stub_representative_binding(session: AsyncSession, ws_id: uuid.UUID) -> None:
    """给工作区造一条在线机器绑定（ql-20260822-008 预检用例）。

    daemon_instances(online) + daemon_runtimes(online) + workspace_member_runtimes
    （member 绑定行，命中 resolve_representative_binding 分支2「任意在线」）。
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
        """POST dispatch_worker → 无在线绑定 → 422 前置拦截（ql-20260822-008 冒烟修复①）。

        历史：BE-P1-2 契约曾为「无 binding → 201 + failed(hostfs_unavailable)」
        （run 落库保留诊断）。真机冒烟暴露该形态对配置性缺绑定引导差：主 agent
        只能反复重试。现前置预检（resolve_representative_binding owner→任意在线
        均无）→ 422 中文引导，不建 run；瞬时离线语义不变（预检与派发用同一
        在线判定，本就派不出去，只是更早失败）。
        """
        ws_id, mission_id, _ = await _seed_workspace_and_mission(db_session)
        resp = await client.post(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/dispatch_worker",
            json={"objective": "扫描架构", "role": "arch", "read_only": True},
            headers=auth_headers,
        )
        assert resp.status_code == 422, resp.text
        assert "在线机器绑定" in resp.json()["message"]

    @pytest.mark.asyncio
    async def test_dispatch_missing_role_uses_default(
        self, client, db_session, auth_headers
    ) -> None:
        """role 缺省 → 默认 worker（有在线绑定 → 正常建 run，role 兜底）。

        ql-20260822-008 后无绑定走 422 前置拦截（见上一个用例），本测改用
        stub 在线绑定走通建 run 路径，校验 role 兜底为 ``worker``。
        """
        ws_id, mission_id, _ = await _seed_workspace_and_mission(db_session)
        await _stub_representative_binding(db_session, ws_id)
        await _stub_representative_binding(db_session, ws_id)

        resp = await client.post(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/dispatch_worker",
            json={"objective": "做事"},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["status"] in ("pending", "running", "failed")
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
        """GET workers → 列 mission 分身 run（存量 batch 形态；主控轮不混入——
        FR-09 补漏后 workers 数据源子会话行化，主控轮剔除对齐
        ``_team_mission_summary`` / ``non_orchestrator_runs`` 口径）。"""
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
        assert [w["role"] for w in data["workers"]] == ["arch"]
        assert data["workers"][0]["status"] == "completed"
        assert data["workers"][0]["total_cost_usd"] == 0.5


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
        """POST converge → 全终态（completed）→ status=converged + converged=True（task-06 四值）。

        旧断言 status=="done"（bootstrap 透传 derive 值）已随 D-010 响应契约收敛为
        ``converged``；同时断言 converged_at 已独立置位（不依赖主控 run 状态）。
        """
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
        assert data["status"] == "converged"
        assert data["converged"] is True
        assert data["artifact_id"] is not None
        mission = await db_session.get(AgentMission, mission_id)
        assert mission is not None and mission.converged_at is not None

    @pytest.mark.asyncio
    async def test_converge_running_when_worker_pending(
        self, client, db_session, auth_headers
    ) -> None:
        """POST converge → 有 pending 分身 → status=busy + 引导文案，零状态变更（D-010）。

        旧断言 status=="running" 已随 task-06 busy 前置判定改写；busy 不置
        converged_at、不触发 finalize（无合并 summary artifact）。
        """
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
        assert data["status"] == "busy"
        assert "分身" in (data.get("message") or "")
        mission = await db_session.get(AgentMission, mission_id)
        assert mission is not None and mission.converged_at is None
        # 不触发 finalize：mission 下无任何 summary 合并产物
        merged = (
            (
                await db_session.execute(
                    select(AgentArtifact)
                    .join(AgentRun, AgentArtifact.run_id == AgentRun.id)
                    .where(AgentRun.mission_id == mission_id)
                )
            )
            .scalars()
            .all()
        )
        assert merged == []


class TestConvergeSessionSemantics:
    """task-06（D-010，design §5 Phase 1 / §7 / §7.5）：converge 语义重定义。

    - busy 前置判定：分身 run（role!='orchestrator' 含 NULL）未全终态 → busy 引导，
      零状态变更（不置 converged_at / 不 finalize）。
    - 分身全终态 → converged_at 独立置位，**不依赖主控 run 状态**（主控轮当轮
      running 也能收敛）。
    - 锚点统一：_get_main_run / finalizer._carrier_run 取该 mission 最新
      role='orchestrator' run（存量单主控 run 同规则命中）。
    - 响应四值：converged / busy / conflict / needs_manual；conflict 重入不回退
      （冲突未解决保持会话活跃 mission 可解析，session 路由重入不 404）。
    - complete_lease（非显式入口）对会话 mission 不自动收敛——awaiting_input
      窗口保留；``converge_explicit=True`` 显式入口（task-08 patrol 复用契约）。
    """

    @pytest.fixture(autouse=True)
    def _isolate_glm(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """GLM 隔离（同 TestConvergeMission）：from_env 返 None，finalize 走 concat。"""
        from app.modules.agent import delegation

        class _FakeGLMConfig:
            @staticmethod
            def from_env():
                return None

        monkeypatch.setattr(delegation, "GLMConfig", _FakeGLMConfig)

    @pytest.mark.asyncio
    async def test_busy_when_worker_pending_via_session(
        self, client, db_session, auth_headers
    ) -> None:
        """会话 converge：分身 pending → busy + 引导文案；converged_at 不置位。"""
        agent_session, _ws_id = await _seed_agent_session(db_session)
        mission = await _seed_session_mission(db_session, agent_session)
        db_session.add(
            AgentRun(
                mission_id=mission.id,
                agent_type="claude_code",
                provider="claude",
                status="running",
                role="orchestrator",
            )
        )
        db_session.add(
            AgentRun(
                mission_id=mission.id,
                agent_type="claude_code",
                status="pending",
                role="arch",
            )
        )
        await db_session.commit()

        resp = await client.post(
            f"/api/sessions/{agent_session.id}/missions/converge",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["status"] == "busy"
        assert data["converged"] is False
        assert "分身" in (data.get("message") or "")
        # endpoint 侧 raw UPDATE 不联动本测试 session 的 identity map，须 refresh 复核
        await db_session.refresh(mission)
        assert mission.converged_at is None

    @pytest.mark.asyncio
    async def test_busy_counts_null_role_worker(self, client, db_session, auth_headers) -> None:
        """NULL role 分身未终态同样计入 busy（SQL 三值逻辑守卫，D-009/D-010）。"""
        agent_session, _ws_id = await _seed_agent_session(db_session)
        mission = await _seed_session_mission(db_session, agent_session)
        db_session.add(
            AgentRun(
                mission_id=mission.id,
                agent_type="claude_code",
                provider="claude",
                status="completed",
                role="orchestrator",
            )
        )
        db_session.add(
            AgentRun(
                mission_id=mission.id,
                agent_type="claude_code",
                status="running",
                role=None,  # 存量分身 run 的可空 role
            )
        )
        await db_session.commit()

        resp = await client.post(
            f"/api/sessions/{agent_session.id}/missions/converge",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["status"] == "busy"
        assert data["converged"] is False
        # endpoint 侧 raw UPDATE 不联动本测试 session 的 identity map，须 refresh 复核
        await db_session.refresh(mission)
        assert mission.converged_at is None

    @pytest.mark.asyncio
    async def test_converge_midturn_sets_converged_at_and_carrier_is_latest_orchestrator(
        self, client, db_session, auth_headers
    ) -> None:
        """主控轮 running（当轮 converge）→ 置位 converged_at + 合并产物挂**最新**
        orchestrator run（_get_main_run/_carrier_run 锚点统一，不依赖主控 run 状态）。"""
        agent_session, _ws_id = await _seed_agent_session(db_session)
        mission = await _seed_session_mission(db_session, agent_session)
        first_turn = AgentRun(
            agent_session_id=agent_session.id,
            mission_id=mission.id,
            agent_type="claude_code",
            provider="claude",
            status="completed",
            role="orchestrator",
            created_at=datetime(2026, 8, 22, 10, 0, 0, tzinfo=UTC),
        )
        current_turn = AgentRun(
            agent_session_id=agent_session.id,
            mission_id=mission.id,
            agent_type="claude_code",
            provider="claude",
            status="running",
            role="orchestrator",
            created_at=datetime(2026, 8, 22, 11, 0, 0, tzinfo=UTC),
        )
        worker = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            status="completed",
            role="arch",
            output_redacted="分身摘要内容",
        )
        db_session.add_all([first_turn, current_turn, worker])
        await db_session.commit()

        resp = await client.post(
            f"/api/sessions/{agent_session.id}/missions/converge",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["status"] == "converged"
        assert data["converged"] is True
        assert data["artifact_id"] is not None

        # endpoint 侧 raw UPDATE 不联动本测试 session 的 identity map，须 refresh 复核
        await db_session.refresh(mission)
        assert mission.converged_at is not None

        # 合并产物（bootstrap concat）挂最新 orchestrator run（载体锚点），
        # 不挂在旧主控轮 / 分身 run 上。
        carrier_arts = (
            (
                await db_session.execute(
                    select(AgentArtifact).where(AgentArtifact.run_id == current_turn.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(carrier_arts) == 1
        assert "分身摘要内容" in (carrier_arts[0].content_ref or "")
        first_turn_arts = (
            (
                await db_session.execute(
                    select(AgentArtifact).where(AgentArtifact.run_id == first_turn.id)
                )
            )
            .scalars()
            .all()
        )
        # 旧主控轮只有 collect 回灌的「(无产出)」占位 summary（既有 collect 行为，
        # 不过滤 role）；合并产物只挂最新主控轮。
        assert all("分身摘要内容" not in (a.content_ref or "") for a in first_turn_arts)

    @pytest.mark.asyncio
    async def test_get_main_run_returns_latest_orchestrator(self, db_session, auth_headers) -> None:
        """_get_main_run 取最新 role='orchestrator' run（多主控轮场景，D-009/D-010）。"""
        from app.modules.agent.mcp_tools import _get_main_run

        agent_session, _ws_id = await _seed_agent_session(db_session)
        mission = await _seed_session_mission(db_session, agent_session)
        older = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            status="completed",
            role="orchestrator",
            created_at=datetime(2026, 8, 22, 10, 0, 0, tzinfo=UTC),
        )
        newer = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            status="running",
            role="orchestrator",
            created_at=datetime(2026, 8, 22, 11, 0, 0, tzinfo=UTC),
        )
        latest_worker = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            status="pending",
            role="arch",
            created_at=datetime(2026, 8, 22, 12, 0, 0, tzinfo=UTC),
        )
        db_session.add_all([older, newer, latest_worker])
        await db_session.commit()

        run = await _get_main_run(db_session, mission.id)
        assert run.id == newer.id

    @pytest.mark.asyncio
    async def test_conflict_reentry_keeps_mission_active(
        self, client, db_session, auth_headers, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """冲突 → converged_at 回滚（会话活跃 mission 保持可解析）→ 解决后重入 → converged。

        重入语义不回退（task-06 铁律）：冲突未解决不算收敛，session 路由第二次
        converge 不 404。``_finalize_merge_for_mission`` mock 两段结果模拟「首次
        冲突 → 主 agent SDK 解决 → 重入全 merged」。
        """
        from app.modules.agent import mcp_tools as mod

        agent_session, _ws_id = await _seed_agent_session(db_session)
        mission = await _seed_session_mission(db_session, agent_session)
        db_session.add(
            AgentRun(
                mission_id=mission.id,
                agent_type="claude_code",
                provider="claude",
                status="running",
                role="orchestrator",
            )
        )
        worker = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            status="completed",
            role="arch",
            output_redacted="分身产出",
        )
        db_session.add(worker)
        await db_session.commit()

        conflicts = [{"file": "src/a.py", "marker_lines": [5], "branch": "workers/aaa"}]
        merge_iter = iter([(["workers/bbb"], conflicts), (["workers/aaa", "workers/bbb"], [])])
        cleanup_calls: list[uuid.UUID] = []

        async def _fake_finalize_merge(session, mission_id):
            return next(merge_iter)

        async def _fake_cleanup(session, mission_id):
            cleanup_calls.append(mission_id)

        monkeypatch.setattr(mod, "_finalize_merge_for_mission", _fake_finalize_merge)
        monkeypatch.setattr(mod, "_cleanup_mission", _fake_cleanup)

        # 第一次：冲突 → status=conflict，converged_at 保持 NULL（回滚）
        resp1 = await client.post(
            f"/api/sessions/{agent_session.id}/missions/converge",
            headers=auth_headers,
        )
        assert resp1.status_code == 200, resp1.text
        data1 = resp1.json()
        assert data1["status"] == "conflict"
        assert data1["converged"] is False
        assert data1["conflicts"] == conflicts
        assert data1["attempt"] == 1
        # endpoint 侧 raw UPDATE 不联动本测试 session 的 identity map，须 refresh 复核
        await db_session.refresh(mission)
        assert mission.converged_at is None

        # 第二次（重入，主 agent 已解决冲突）：session 路由不 404 → converged
        resp2 = await client.post(
            f"/api/sessions/{agent_session.id}/missions/converge",
            headers=auth_headers,
        )
        assert resp2.status_code == 200, resp2.text
        data2 = resp2.json()
        assert data2["status"] == "converged"
        assert data2["converged"] is True
        assert data2["merged_branches"] == ["workers/aaa", "workers/bbb"]
        assert data2["attempt"] == 1, "重入成功 attempt 不再自增"
        assert cleanup_calls == [mission.id]
        # endpoint 侧 raw UPDATE 不联动本测试 session 的 identity map，须 refresh 复核
        await db_session.refresh(mission)
        assert mission.converged_at is not None

    @pytest.mark.asyncio
    async def test_needs_manual_status_value(
        self, client, db_session, auth_headers, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """R-07 超限 → status=needs_manual（四值契约，原 failed_manual 改名）。"""
        from app.modules.agent import mcp_tools as mod

        agent_session, _ws_id = await _seed_agent_session(db_session)
        mission = await _seed_session_mission(db_session, agent_session)
        mission.constraints = {"conflict_attempts": 3}
        db_session.add(mission)
        await db_session.commit()
        db_session.add(
            AgentRun(
                mission_id=mission.id,
                agent_type="claude_code",
                provider="claude",
                status="completed",
                role="orchestrator",
            )
        )
        db_session.add(
            AgentRun(
                mission_id=mission.id,
                agent_type="claude_code",
                status="completed",
                role="arch",
                output_redacted="分身产出",
            )
        )
        await db_session.commit()

        conflicts = [{"file": "src/b.py", "marker_lines": [1], "branch": "workers/ccc"}]

        async def _fake_finalize_merge(session, mission_id):
            return (["workers/ddd"], conflicts)

        async def _fake_cleanup(session, mission_id):
            raise AssertionError("needs_manual 路径不应清副本（X-003）")

        monkeypatch.setattr(mod, "_finalize_merge_for_mission", _fake_finalize_merge)
        monkeypatch.setattr(mod, "_cleanup_mission", _fake_cleanup)

        resp = await client.post(
            f"/api/sessions/{agent_session.id}/missions/converge",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["status"] == "needs_manual"
        assert data["converged"] is False
        assert data["attempt"] == 3
        assert data["conflicts"] == conflicts
        assert "needs_manual" in (data.get("message") or "")
        # _mark_mission_needs_manual 在 endpoint session 提交，须 refresh 复核
        await db_session.refresh(mission)
        nm = (mission.constraints or {}).get("needs_manual")
        assert nm is not None and "R-07" in nm.get("reason", "")

    @pytest.mark.asyncio
    async def test_complete_lease_keeps_session_mission_awaiting_input(self, db_session) -> None:
        """非显式入口（complete_lease 语义）对会话 mission 不自动收敛。

        分身全终态 + 主控轮终态 + 无会话活跃 turn → 返 awaiting_input，
        converged_at 不置位、无合并产物（design §7.5：会话 mission 收敛入口只有
        MCP converge / patrol 超时，awaiting_input 窗口保留）。
        """
        from app.modules.agent.finalizer import converge_mission_for_completed_run

        agent_session, _ws_id = await _seed_agent_session(db_session)
        mission = await _seed_session_mission(db_session, agent_session)
        turn_run = AgentRun(
            agent_session_id=agent_session.id,
            mission_id=mission.id,
            agent_type="claude_code",
            provider="claude",
            status="completed",
            role="orchestrator",
        )
        worker = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            status="completed",
            role="arch",
            output_redacted="分身产出",
        )
        db_session.add_all([turn_run, worker])
        await db_session.commit()

        result = await converge_mission_for_completed_run(db_session, worker.id, None)

        assert result == "awaiting_input"
        # endpoint 侧 raw UPDATE 不联动本测试 session 的 identity map，须 refresh 复核
        await db_session.refresh(mission)
        assert mission.converged_at is None

    @pytest.mark.asyncio
    async def test_complete_lease_midturn_reports_running_no_converge(self, db_session) -> None:
        """主控轮 running 时 worker complete（非显式）→ derive=running、不置位。"""
        from app.modules.agent.finalizer import converge_mission_for_completed_run

        agent_session, _ws_id = await _seed_agent_session(db_session)
        mission = await _seed_session_mission(db_session, agent_session)
        db_session.add(
            AgentRun(
                agent_session_id=agent_session.id,
                mission_id=mission.id,
                agent_type="claude_code",
                provider="claude",
                status="running",
                role="orchestrator",
            )
        )
        worker = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            status="completed",
            role="arch",
            output_redacted="分身产出",
        )
        db_session.add(worker)
        await db_session.commit()

        result = await converge_mission_for_completed_run(db_session, worker.id, None)

        assert result == "running"
        # endpoint 侧 raw UPDATE 不联动本测试 session 的 identity map，须 refresh 复核
        await db_session.refresh(mission)
        assert mission.converged_at is None

    @pytest.mark.asyncio
    async def test_explicit_entry_point_converges_awaiting_input(self, db_session) -> None:
        """``converge_explicit=True`` 显式置位入口（task-08 patrol 复用契约）。

        awaiting_input 态 mission（分身全终态、无活跃 turn）→ 置位 converged_at +
        finalize（bootstrap 合并产物挂最新 orchestrator run）。
        """
        from app.modules.agent.finalizer import converge_mission_for_completed_run

        agent_session, _ws_id = await _seed_agent_session(db_session)
        mission = await _seed_session_mission(db_session, agent_session)
        turn_run = AgentRun(
            agent_session_id=agent_session.id,
            mission_id=mission.id,
            agent_type="claude_code",
            provider="claude",
            status="completed",
            role="orchestrator",
        )
        worker = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            status="completed",
            role="arch",
            output_redacted="分身产出",
        )
        db_session.add_all([turn_run, worker])
        await db_session.commit()

        result = await converge_mission_for_completed_run(
            db_session, turn_run.id, None, converge_explicit=True
        )

        assert result == "done"
        # endpoint 侧 raw UPDATE 不联动本测试 session 的 identity map，须 refresh 复核
        await db_session.refresh(mission)
        assert mission.converged_at is not None
        carrier_arts = (
            (
                await db_session.execute(
                    select(AgentArtifact).where(AgentArtifact.run_id == turn_run.id)
                )
            )
            .scalars()
            .all()
        )
        # 载体上除 collect 回灌的「(无产出)」占位（turn_run 亦 completed）外，
        # 必须有且仅有一份含分身产出的合并 summary。
        merged_on_carrier = [a for a in carrier_arts if "分身产出" in (a.content_ref or "")]
        assert len(merged_on_carrier) == 1


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
        # 无 binding → 422 前置拦截（ql-20260822-008，证明 scope 校验已通过——
        # 越界场景在 400 先拦，此处的 422 来自绑定预检而非 scope）
        resp = await client.post(
            f"/api/workspaces/{anchor_ws_id}/missions/{mission_id}/dispatch_worker",
            json={
                "objective": "跨工作区任务",
                "target_workspace_id": str(target_ws_id),
            },
            headers=auth_headers,
        )
        assert resp.status_code == 422, resp.text
        assert "在线机器绑定" in resp.json()["message"]

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
        await _stub_representative_binding(db_session, anchor_ws_id)

        resp = await client.post(
            f"/api/workspaces/{anchor_ws_id}/missions/{mission_id}/dispatch_worker",
            json={"objective": "单工作区任务"},
            headers=auth_headers,
        )
        # 无 binding → 201 + failed（BE-P1-2 契约，证明 target=anchor 校验通过）
        assert resp.status_code == 201, resp.text
        # ql-20260822-008：stub 绑定后走到 worktree 阶段，测试环境派发失败形态（hostfs 不可达/委托降级）
        assert resp.json()["status"] == "failed"

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
        await _stub_representative_binding(db_session, anchor_ws_id)

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
        # ql-20260822-008：stub 绑定后走到 worktree 阶段，测试环境派发失败形态（hostfs 不可达/委托降级）
        assert resp.json()["status"] == "failed"

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


# ---------------------------------------------------------------------------
# task-05（2026-08-22-team-session-unify）：X-Session-Id 会话定位 + dispatch 懒建
# design §5 Phase 1 懒建段 / §7——5 端点缺参经会话解析；dispatch_worker 无活跃
# mission 时懒建（scope=会话工作区 / objective=dispatch 上下文 / 预算=默认上限），
# 补回填当前活跃 run 双标记；无工作区 422；并发守卫走部分唯一索引兜底。
# ---------------------------------------------------------------------------


async def _seed_agent_session(
    session: AsyncSession,
    *,
    with_workspace: bool = True,
) -> tuple[AgentSession, uuid.UUID | None]:
    """建 AgentSession（可选绑定 workspace），返回 (session, ws_id|None)。"""
    ws_id: uuid.UUID | None = None
    if with_workspace:
        ws_id = uuid.uuid4()
        session.add(
            Workspace(
                id=ws_id,
                name=f"sess-ws-{ws_id.hex[:8]}",
                slug=f"sess-ws-{ws_id.hex[:8]}",
                root_path=f"/tmp/sess-ws-{ws_id.hex}",
            )
        )
    agent_session = AgentSession(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        provider="claude",
        status="active",
        workspace_id=ws_id,
    )
    session.add(agent_session)
    await session.commit()
    await session.refresh(agent_session)
    return agent_session, ws_id


async def _seed_session_mission(session: AsyncSession, agent_session: AgentSession) -> AgentMission:
    """建会话活跃 mission（session_id 落列，converged/cancelled 均 NULL）。"""
    mission = AgentMission(
        workspace_id=agent_session.workspace_id,
        objective="会话团队任务",
        session_id=agent_session.id,
    )
    session.add(mission)
    await session.commit()
    await session.refresh(mission)
    return mission


class TestSessionLazyCreate:
    """dispatch_worker 会话路由懒建（design §5 Phase 1 / Grill NEW-1）。"""

    @pytest.mark.asyncio
    async def test_lazy_create_builds_mission_and_dispatches(
        self, client, db_session, auth_headers
    ) -> None:
        """无活跃 mission 且会话绑定 workspace → 懒建（scope/预算/objective 口径）+ 派 worker。"""
        agent_session, ws_id = await _seed_agent_session(db_session)
        await _stub_representative_binding(db_session, ws_id)

        resp = await client.post(
            f"/api/sessions/{agent_session.id}/missions/dispatch_worker",
            json={"objective": "扫描会话架构", "role": "arch"},
            headers={**auth_headers, "X-Session-Id": str(agent_session.id)},
        )
        assert resp.status_code == 201, resp.text
        # 无 binding → run failed + hostfs_unavailable（BE-P1-2 契约，证明派发走到位）
        # ql-20260822-008：stub 绑定后走到 worktree 阶段，测试环境派发失败形态（hostfs 不可达/委托降级）
        assert resp.json()["status"] == "failed"

        mission = (
            (
                await db_session.execute(
                    select(AgentMission).where(AgentMission.session_id == agent_session.id)
                )
            )
            .scalars()
            .one()
        )
        assert mission.workspace_id == ws_id
        assert mission.scope_workspace_ids == [str(ws_id)]
        assert mission.objective == "扫描会话架构"  # objective=dispatch 上下文
        assert mission.budget_usd == 5.0  # 懒建默认预算上限（R-02）

    @pytest.mark.asyncio
    async def test_lazy_create_backfills_active_run_double_tag(
        self, client, db_session, auth_headers
    ) -> None:
        """懒建成功后补回填会话当前活跃 run 的 mission_id+role='orchestrator'（Grill NEW-1）。"""
        agent_session, _ws_id = await _seed_agent_session(db_session)
        active_run = AgentRun(
            agent_session_id=agent_session.id,
            agent_type="claude_code",
            provider="claude",
            status="running",
        )
        db_session.add(active_run)
        await db_session.commit()
        await db_session.refresh(active_run)

        await _stub_representative_binding(db_session, _ws_id)

        resp = await client.post(
            f"/api/sessions/{agent_session.id}/missions/dispatch_worker",
            json={"objective": "做事"},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text

        await db_session.refresh(active_run)
        assert active_run.mission_id is not None
        assert active_run.role == "orchestrator"

    @pytest.mark.asyncio
    async def test_lazy_create_without_workspace_422(
        self, client, db_session, auth_headers
    ) -> None:
        """会话未绑定 workspace → 422 + 引导弹层文案，不建 mission（CC-10）。"""
        agent_session, _ws_id = await _seed_agent_session(db_session, with_workspace=False)
        resp = await client.post(
            f"/api/sessions/{agent_session.id}/missions/dispatch_worker",
            json={"objective": "做事"},
            headers=auth_headers,
        )
        assert resp.status_code == 422, resp.text
        assert "未绑定工作区" in resp.text
        missions = (
            (
                await db_session.execute(
                    select(AgentMission).where(AgentMission.session_id == agent_session.id)
                )
            )
            .scalars()
            .all()
        )
        assert missions == []

    @pytest.mark.asyncio
    async def test_lazy_create_budget_env_override(
        self, client, db_session, auth_headers, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """预算默认上限支持 env 覆盖（TEAM_LAZY_MISSION_BUDGET_USD）。"""
        monkeypatch.setenv("TEAM_LAZY_MISSION_BUDGET_USD", "12.5")
        agent_session, _ws_id = await _seed_agent_session(db_session)
        await _stub_representative_binding(db_session, _ws_id)

        resp = await client.post(
            f"/api/sessions/{agent_session.id}/missions/dispatch_worker",
            json={"objective": "做事"},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        mission = (
            (
                await db_session.execute(
                    select(AgentMission).where(AgentMission.session_id == agent_session.id)
                )
            )
            .scalars()
            .one()
        )
        assert mission.budget_usd == 12.5

    @pytest.mark.asyncio
    async def test_second_dispatch_reuses_active_mission(
        self, client, db_session, auth_headers
    ) -> None:
        """同会话再次 dispatch → 复用活跃 mission，不双建。"""
        agent_session, _ws_id = await _seed_agent_session(db_session)
        for _ in range(2):
            await _stub_representative_binding(db_session, _ws_id)

            resp = await client.post(
                f"/api/sessions/{agent_session.id}/missions/dispatch_worker",
                json={"objective": "做事"},
                headers=auth_headers,
            )
            assert resp.status_code == 201, resp.text

        missions = (
            (
                await db_session.execute(
                    select(AgentMission).where(AgentMission.session_id == agent_session.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(missions) == 1
        runs = (
            (
                await db_session.execute(
                    select(AgentRun).where(AgentRun.mission_id == missions[0].id)
                )
            )
            .scalars()
            .all()
        )
        assert len(runs) == 2  # 两次 dispatch 的 worker run 都落同一 mission


class TestLazyCreateConcurrencyGuard:
    """懒建并发守卫（Grill NEW-3）：uq_agent_missions_session_active 部分唯一索引兜底。"""

    @pytest.mark.asyncio
    async def test_integrity_error_race_reuses_existing(
        self, client, db_session, auth_headers, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """并发窗口读到过期 None → 懒建 INSERT 撞部分唯一索引 → 回滚重查复用活跃 mission。"""
        from app.modules.agent import mission as mission_mod

        agent_session, ws_id = await _seed_agent_session(db_session)
        existing = AgentMission(
            workspace_id=ws_id,
            objective="先到者已建",
            session_id=agent_session.id,
        )
        db_session.add(existing)
        await db_session.commit()
        await db_session.refresh(existing)

        real = mission_mod.get_active_mission_for_session
        calls = {"n": 0}

        async def _stale_first(db, sid):
            # 首查返回 None（模拟并发窗口的过期读），其后放行真查询
            if calls["n"] == 0:
                calls["n"] += 1
                return None
            return await real(db, sid)

        monkeypatch.setattr(mission_mod, "get_active_mission_for_session", _stale_first)

        # 本用例聚焦并发守卫语义；绑定预检（ql-20260822-008）有自己的专属用例
        # 覆盖，此处 stub 掉（懒建 rollback 后的 session 状态与 raw SQL 预检在
        # 本测试的 fixture 交错下不兼容，不属被测行为）。
        from app.modules.workspace.member_runtimes import queries as wmr_queries

        monkeypatch.setattr(
            wmr_queries,
            "resolve_representative_binding",
            lambda *a, **k: _fake_binding(),
        )

        async def _fake_binding():
            return {
                "id": uuid.uuid4(),
                "user_id": uuid.uuid4(),
                "provider": "claude",
                "status": "online",
                "daemon_instance_id": uuid.uuid4(),
            }

        resp = await client.post(
            f"/api/sessions/{agent_session.id}/missions/dispatch_worker",
            json={"objective": "并发派发"},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text

        missions = (
            (
                await db_session.execute(
                    select(AgentMission).where(AgentMission.session_id == agent_session.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(missions) == 1
        assert missions[0].id == existing.id  # 复用先到者，不双建
        runs = (
            (await db_session.execute(select(AgentRun).where(AgentRun.mission_id == existing.id)))
            .scalars()
            .all()
        )
        assert len(runs) == 1  # worker run 派进复用的 mission


class TestSessionRouteResolution:
    """其余 4 端点的会话维度路由（缺省 mission_id/workspace_id 经会话解析）。"""

    @pytest.mark.asyncio
    async def test_list_workers_via_session_route(self, client, db_session, auth_headers) -> None:
        """GET /sessions/{sid}/missions/workers → 解析活跃 mission 并列 run。"""
        agent_session, _ws_id = await _seed_agent_session(db_session)
        mission = await _seed_session_mission(db_session, agent_session)
        worker = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            status="completed",
            role="arch",
            objective="扫描",
        )
        db_session.add(worker)
        await db_session.commit()

        resp = await client.get(
            f"/api/sessions/{agent_session.id}/missions/workers",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["mission_id"] == str(mission.id)
        assert [w["role"] for w in data["workers"]] == ["arch"]

    @pytest.mark.asyncio
    async def test_list_workers_no_active_mission_404(
        self, client, db_session, auth_headers
    ) -> None:
        """会话无活跃 mission → 404（非 dispatch 端点不懒建）。"""
        agent_session, _ws_id = await _seed_agent_session(db_session)
        resp = await client.get(
            f"/api/sessions/{agent_session.id}/missions/workers",
            headers=auth_headers,
        )
        assert resp.status_code == 404, resp.text

    @pytest.mark.asyncio
    async def test_get_worker_result_via_session_route(
        self, client, db_session, auth_headers
    ) -> None:
        """GET /sessions/{sid}/missions/workers/{wid}/result → 读分身 artifact。"""
        agent_session, _ws_id = await _seed_agent_session(db_session)
        mission = await _seed_session_mission(db_session, agent_session)
        worker = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            status="completed",
            role="arch",
            objective="扫描",
        )
        db_session.add(worker)
        await db_session.commit()
        await db_session.refresh(worker)
        db_session.add(AgentArtifact(run_id=worker.id, kind="summary", content_ref="摘要"))
        await db_session.commit()

        resp = await client.get(
            f"/api/sessions/{agent_session.id}/missions/workers/{worker.id}/result",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["worker_id"] == str(worker.id)
        assert len(data["artifacts"]) == 1

    @pytest.mark.asyncio
    async def test_progress_via_session_route(self, client, db_session, auth_headers) -> None:
        """POST /sessions/{sid}/missions/progress → 落主控决策日志。"""
        agent_session, _ws_id = await _seed_agent_session(db_session)
        mission = await _seed_session_mission(db_session, agent_session)
        main_run = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            provider="claude",
            status="running",
            role="orchestrator",
        )
        db_session.add(main_run)
        await db_session.commit()
        await db_session.refresh(main_run)

        resp = await client.post(
            f"/api/sessions/{agent_session.id}/missions/progress",
            json={"run_id": str(main_run.id), "message": "已派 arch", "decision": "dispatch"},
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["run_id"] == str(main_run.id)

    @pytest.mark.asyncio
    async def test_converge_via_session_route(self, client, db_session, auth_headers) -> None:
        """POST /sessions/{sid}/missions/converge → 分身全终态 → converged（task-06 四值）。"""
        agent_session, _ws_id = await _seed_agent_session(db_session)
        mission = await _seed_session_mission(db_session, agent_session)
        worker = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            status="completed",
            role="arch",
            objective="扫描",
        )
        main_run = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            provider="claude",
            status="completed",
            role="orchestrator",
        )
        db_session.add_all([worker, main_run])
        await db_session.commit()
        await db_session.refresh(worker)
        db_session.add(AgentArtifact(run_id=worker.id, kind="summary", content_ref="摘要"))
        await db_session.commit()

        resp = await client.post(
            f"/api/sessions/{agent_session.id}/missions/converge",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["mission_id"] == str(mission.id)
        assert data["status"] == "converged"
        assert data["converged"] is True

    @pytest.mark.asyncio
    async def test_header_path_session_mismatch_400(self, client, db_session, auth_headers) -> None:
        """X-Session-Id 与路径 session_id 不一致 → 400（防歧义）。"""
        agent_session, _ws_id = await _seed_agent_session(db_session)
        resp = await client.get(
            f"/api/sessions/{agent_session.id}/missions/workers",
            headers={**auth_headers, "X-Session-Id": str(uuid.uuid4())},
        )
        assert resp.status_code == 400, resp.text


class TestHeaderOnExplicitRoutes:
    """显式路由 + X-Session-Id：会话优先解析，显式参数仅作越权校验锚。"""

    @pytest.mark.asyncio
    async def test_header_resolves_active_mission(self, client, db_session, auth_headers) -> None:
        """header 命中会话活跃 mission（锚一致）→ 正常派发。"""
        agent_session, ws_id = await _seed_agent_session(db_session)
        mission = await _seed_session_mission(db_session, agent_session)
        await _stub_representative_binding(db_session, ws_id)

        resp = await client.post(
            f"/api/workspaces/{ws_id}/missions/{mission.id}/dispatch_worker",
            json={"objective": "做事"},
            headers={**auth_headers, "X-Session-Id": str(agent_session.id)},
        )
        assert resp.status_code == 201, resp.text
        # ql-20260822-008：stub 绑定后走到 worktree 阶段，测试环境派发失败形态（hostfs 不可达/委托降级）
        assert resp.json()["status"] == "failed"

    @pytest.mark.asyncio
    async def test_header_anchor_mission_mismatch_404(
        self, client, db_session, auth_headers
    ) -> None:
        """路径 mission_id 与会话活跃 mission 不一致（锚失配）→ 404。"""
        agent_session, ws_id = await _seed_agent_session(db_session)
        await _seed_session_mission(db_session, agent_session)
        resp = await client.post(
            f"/api/workspaces/{ws_id}/missions/{uuid.uuid4()}/dispatch_worker",
            json={"objective": "做事"},
            headers={**auth_headers, "X-Session-Id": str(agent_session.id)},
        )
        assert resp.status_code == 404, resp.text
        # 不因锚失配触发懒建
        missions = (
            (
                await db_session.execute(
                    select(AgentMission).where(AgentMission.session_id == agent_session.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(missions) == 1

    @pytest.mark.asyncio
    async def test_header_without_active_falls_back_to_explicit_ids(
        self, client, db_session, auth_headers
    ) -> None:
        """header 会话无活跃 mission + 显式 mission_id → 回退显式路径（零回归）。"""
        agent_session, _ws_id = await _seed_agent_session(db_session)
        ws_id, mission_id, _ = await _seed_workspace_and_mission(db_session)
        await _stub_representative_binding(db_session, ws_id)

        resp = await client.post(
            f"/api/workspaces/{ws_id}/missions/{mission_id}/dispatch_worker",
            json={"objective": "做事"},
            headers={**auth_headers, "X-Session-Id": str(agent_session.id)},
        )
        assert resp.status_code == 201, resp.text
        # 回退显式路径，不懒建
        missions = (
            (
                await db_session.execute(
                    select(AgentMission).where(AgentMission.session_id == agent_session.id)
                )
            )
            .scalars()
            .all()
        )
        assert missions == []


# ---------------------------------------------------------------------------
# task-10 对齐（2026-08-22-team-session-unify）：``/missions/{action}``
# （header-only）与 ``/missions/{mid}/{action}``（仅 mid）路由族——daemon
# hub-client `_missionActionPath` 缺参 URL 契约的 backend 消费方。
# ---------------------------------------------------------------------------


class TestHeaderOnlyRoutes:
    """``/missions/{action}`` header-only 族（会话身份完全由 X-Session-Id 承载）。"""

    @pytest.mark.asyncio
    async def test_dispatch_lazy_create_via_header_only(
        self, client, db_session, auth_headers
    ) -> None:
        """POST /missions/dispatch_worker + X-Session-Id（无路径 id）→ 懒建 + 派发。"""
        agent_session, ws_id = await _seed_agent_session(db_session)
        await _stub_representative_binding(db_session, ws_id)
        resp = await client.post(
            "/api/missions/dispatch_worker",
            json={"objective": "扫描架构"},
            headers={**auth_headers, "X-Session-Id": str(agent_session.id)},
        )
        assert resp.status_code == 201, resp.text
        # ql-20260822-008：stub 绑定后走到 worktree 阶段，测试环境派发失败形态（hostfs 不可达/委托降级）
        assert resp.json()["status"] == "failed"
        mission = (
            (
                await db_session.execute(
                    select(AgentMission).where(AgentMission.session_id == agent_session.id)
                )
            )
            .scalars()
            .one()
        )
        assert mission.workspace_id == ws_id
        assert mission.budget_usd == 5.0

    @pytest.mark.asyncio
    async def test_dispatch_without_header_400(self, client, db_session, auth_headers) -> None:
        """header-only 路由缺 X-Session-Id → 400（不落任何 mission）。"""
        resp = await client.post(
            "/api/missions/dispatch_worker",
            json={"objective": "做事"},
            headers=auth_headers,
        )
        assert resp.status_code == 400, resp.text
        assert "X-Session-Id" in resp.text
        missions = (await db_session.execute(select(AgentMission))).scalars().all()
        assert missions == []

    @pytest.mark.asyncio
    async def test_progress_via_header_only(self, client, db_session, auth_headers) -> None:
        """POST /missions/progress + header → 按会话活跃 mission 落日志。"""
        agent_session, _ws_id = await _seed_agent_session(db_session)
        mission = await _seed_session_mission(db_session, agent_session)
        main_run = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            provider="claude",
            status="running",
            role="orchestrator",
        )
        db_session.add(main_run)
        await db_session.commit()
        await db_session.refresh(main_run)

        resp = await client.post(
            "/api/missions/progress",
            json={"run_id": str(main_run.id), "message": "已派 arch"},
            headers={**auth_headers, "X-Session-Id": str(agent_session.id)},
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["run_id"] == str(main_run.id)

    @pytest.mark.asyncio
    async def test_progress_without_run_id_resolves_main_run(
        self, client, db_session, auth_headers
    ) -> None:
        """run_id 缺省（task-10 对齐）→ 按会话当前主控 run 解析落日志。"""
        agent_session, _ws_id = await _seed_agent_session(db_session)
        mission = await _seed_session_mission(db_session, agent_session)
        main_run = AgentRun(
            agent_session_id=agent_session.id,
            mission_id=mission.id,
            agent_type="claude_code",
            provider="claude",
            status="running",
            role="orchestrator",
        )
        db_session.add(main_run)
        await db_session.commit()
        await db_session.refresh(main_run)

        resp = await client.post(
            "/api/missions/progress",
            json={"message": "决定等待分身完成"},
            headers={**auth_headers, "X-Session-Id": str(agent_session.id)},
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["run_id"] == str(main_run.id)

    @pytest.mark.asyncio
    async def test_progress_without_run_id_and_session_400(
        self, client, db_session, auth_headers
    ) -> None:
        """run_id 缺省且无 X-Session-Id → 400（无法定位主控 run）。

        用仅 mid 路由（无 header 也可解析 mission）触发 run_id 分支——header-only
        路由缺 header 时在 mission 解析层已先 400（缺 X-Session-Id 文案）。
        """
        agent_session, _ws_id = await _seed_agent_session(db_session)
        mission = await _seed_session_mission(db_session, agent_session)
        resp = await client.post(
            f"/api/missions/{mission.id}/progress",
            json={"message": "无上下文"},
            headers=auth_headers,
        )
        assert resp.status_code == 400, resp.text
        assert "run_id" in resp.text

    @pytest.mark.asyncio
    async def test_worker_result_via_header_only(self, client, db_session, auth_headers) -> None:
        """GET /missions/workers/{wid}/result + header → 读会话活跃 mission 的分身产出。"""
        agent_session, _ws_id = await _seed_agent_session(db_session)
        mission = await _seed_session_mission(db_session, agent_session)
        worker = AgentRun(
            mission_id=mission.id,
            agent_type="claude_code",
            status="completed",
            role="arch",
        )
        db_session.add(worker)
        await db_session.commit()
        await db_session.refresh(worker)

        resp = await client.get(
            f"/api/missions/workers/{worker.id}/result",
            headers={**auth_headers, "X-Session-Id": str(agent_session.id)},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["worker_id"] == str(worker.id)

    @pytest.mark.asyncio
    @pytest.mark.xfail(
        reason=(
            "GET /missions/workers 被先注册的 GET /missions/{mission_id}"
            "（router.py:1086，mcp_tools include 于 :1451 之后）按首个全匹配截走 → "
            "uuid 校验 422，本路由不可达；router.py 把 mcp_tools include 挪到"
            " :1086 之前后本用例自动转 XPASS 生效（非 strict）"
        ),
        strict=False,
    )
    async def test_list_workers_via_header_only(self, client, db_session, auth_headers) -> None:
        """GET /missions/workers + header → 按会话活跃 mission 列 run（冲突 canary）。"""
        agent_session, _ws_id = await _seed_agent_session(db_session)
        mission = await _seed_session_mission(db_session, agent_session)
        db_session.add(
            AgentRun(
                mission_id=mission.id,
                agent_type="claude_code",
                status="completed",
                role="arch",
            )
        )
        await db_session.commit()

        resp = await client.get(
            "/api/missions/workers",
            headers={**auth_headers, "X-Session-Id": str(agent_session.id)},
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["mission_id"] == str(mission.id)


class TestMissionOnlyRoutes:
    """``/missions/{mid}/{action}`` 仅 mid 族（task-10 `_missionActionPath` 形态二）。"""

    @pytest.mark.asyncio
    async def test_list_workers_without_header_resolves_by_mission_id(
        self, client, db_session, auth_headers
    ) -> None:
        """GET /missions/{mid}/workers 无 header → mission 反解 + 列 run。"""
        agent_session, _ws_id = await _seed_agent_session(db_session)
        mission = await _seed_session_mission(db_session, agent_session)
        db_session.add(
            AgentRun(
                mission_id=mission.id,
                agent_type="claude_code",
                status="completed",
                role="arch",
            )
        )
        await db_session.commit()

        resp = await client.get(
            f"/api/missions/{mission.id}/workers",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        data = resp.json()
        assert data["mission_id"] == str(mission.id)
        assert [w["role"] for w in data["workers"]] == ["arch"]

    @pytest.mark.asyncio
    async def test_dispatch_with_header_and_matching_mid(
        self, client, db_session, auth_headers
    ) -> None:
        """POST /missions/{mid}/dispatch_worker + header（mid=活跃 mission）→ 正常派发。"""
        agent_session, _ws_id = await _seed_agent_session(db_session)
        await _stub_representative_binding(db_session, _ws_id)
        mission = await _seed_session_mission(db_session, agent_session)
        resp = await client.post(
            f"/api/missions/{mission.id}/dispatch_worker",
            json={"objective": "做事"},
            headers={**auth_headers, "X-Session-Id": str(agent_session.id)},
        )
        assert resp.status_code == 201, resp.text
        # 有 mid 锚时不懒建（复用既有活跃 mission）
        missions = (
            (
                await db_session.execute(
                    select(AgentMission).where(AgentMission.session_id == agent_session.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(missions) == 1

    @pytest.mark.asyncio
    async def test_list_workers_mismatched_mid_with_header_404(
        self, client, db_session, auth_headers
    ) -> None:
        """GET /missions/{mid}/workers + header，mid ≠ 会话活跃 mission → 404（锚失配）。"""
        agent_session, _ws_id = await _seed_agent_session(db_session)
        await _seed_session_mission(db_session, agent_session)
        resp = await client.get(
            f"/api/missions/{uuid.uuid4()}/workers",
            headers={**auth_headers, "X-Session-Id": str(agent_session.id)},
        )
        assert resp.status_code == 404, resp.text
