"""task-06（2026-08-26-workspace-mcp-edit / D-008 前置）：interactive claim payload
workspaceId 下发覆盖率守护单测。

守护 ``build_claim_payload`` interactive 分支的 team 模式主控 ws 兜底（本 task 补齐，
``daemon/lease/context.py``）：主 agent run 经 ``dispatch_to_daemon`` 派发（lease
形态 = kind='interactive' + ``agent_run_id`` 列非空 + ``metadata.stage='orchestrator'``
+ metadata **无** workspace_id——placement.dispatch_to_daemon 不写该键），tar 模式下
execPayload.workspaceId 原本缺失 → daemon 端 D-008 三件套预取对主控回落空配置。
兜底源 = ``AgentMission.workspace_id``（anchor，NOT NULL，语义 = 主 agent 运行的工作区）。

断言矩阵：
  - O1: stage='orchestrator' + run 挂 mission → tar 模式 payload 双写
    workspaceId/workspace_id（源 mission anchor）；
  - O2: stage='orchestrator' 但 run 无 mission → 不兜底（无任一 workspaceId 键）；
  - O3: stage='mission_worker'（分身，D-008@v1 明确不补）→ 即便 run 挂 mission
    也不兜底；
  - O4: quick-chat 形态（无 stage + 无 workspace_id）→ 不兜底（边界 E4 语义保持）。

夹具范式镜像 ``test_lease_budget_dispatch.py``：import ``test_lease_service.py`` 的
``_create_user`` / ``_create_runtime`` helper；dispatch 形态 interactive lease（带
agent_run_id 列）本地构造（``_create_interactive_lease`` 恒 NULL 不适用）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentMission, AgentRun
from app.modules.daemon.lease.context import build_claim_payload
from app.modules.daemon.model import DaemonTaskLease
from app.modules.daemon.tests.test_lease_service import (
    _create_runtime,
    _create_user,
)

# build_claim_payload → _inject_provider_config 查 llm_providers 表；import 模型
# 注册到 BaseModel.metadata 让 db_engine 建表（镜像 test_lease_budget_dispatch 惯例）。
from app.modules.llm_provider.model import LlmProvider  # noqa: F401
from app.modules.workspace.model import Workspace


def _patch_transport(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    """Patch ``context.get_settings`` 返回 spec_transport=value 的 mock settings。

    镜像 test_lease_claim_transport._patch_transport：直接替换模块内 import 的
    get_settings 符号（duck-type SimpleNamespace），互不影响真 Settings cache。
    """
    from app.modules.daemon.lease import context as ctx_module

    fake_settings = SimpleNamespace(spec_transport=value)
    monkeypatch.setattr(ctx_module, "get_settings", lambda: fake_settings)


# ---------------------------------------------------------------------------
# Helpers — workspace / mission / run / dispatch 形态 interactive lease
# ---------------------------------------------------------------------------


async def _create_workspace(session: AsyncSession) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"wid-ws-{uuid.uuid4().hex[:6]}",
        slug=f"wid-ws-{uuid.uuid4().hex[:6]}",
        root_path="/tmp/wid-test-workspace",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _create_mission(
    session: AsyncSession,
    workspace_id: uuid.UUID,
) -> AgentMission:
    """构造 AgentMission（objective 必填非空；budget_tokens None 不进 payload）。"""
    mission = AgentMission(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        objective="wid-test-objective",
    )
    session.add(mission)
    await session.commit()
    await session.refresh(mission)
    return mission


async def _create_run(
    session: AsyncSession,
    *,
    mission_id: uuid.UUID | None = None,
) -> AgentRun:
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude_code",
        status="pending",
        mission_id=mission_id,
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


async def _create_dispatch_style_lease(
    session: AsyncSession,
    runtime_id: uuid.UUID,
    run_id: uuid.UUID,
    *,
    metadata: dict,
) -> DaemonTaskLease:
    """构造 dispatch_to_daemon 形态 interactive lease（agent_run_id 列非空）。

    与 placement.dispatch_to_daemon 的 INSERT（placement.py:485-503）同构：
    kind='interactive' + agent_run_id 绑定 + metadata 带 session_id/run_id/
    prompt/provider/stage 等。区别于 _create_interactive_lease（prepare_
    interactive_dispatch 形态，agent_run_id 列恒 NULL，D-005@v1）。
    """
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=run_id,
        status="claimed",
        kind="interactive",
        claimed_at=now,
        lease_expires_at=None,
        metadata_=metadata,
        created_at=now,
        updated_at=now,
    )
    session.add(lease)
    await session.commit()
    await session.refresh(lease)
    return lease


class TestBuildClaimPayloadOrchestratorWorkspaceFallback:
    """task-06（D-008 前置）：team 模式主控 lease 的 workspaceId 兜底单测。"""

    @pytest.mark.asyncio
    async def test_o1_tar_orchestrator_lease_resolves_mission_anchor(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """O1: stage='orchestrator' + mission run → tar 模式带 workspaceId（anchor 源）。

        dispatch_to_daemon 主控 lease（metadata 无 workspace_id）经兜底解析
        AgentMission.workspace_id → payload 双写 workspaceId/workspace_id，
        daemon _startInteractiveSession 的 D-008 三件套预取拿到 wsId。
        """
        _patch_transport(monkeypatch, "tar")
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session)
        mission = await _create_mission(db_session, ws.id)
        run = await _create_run(db_session, mission_id=mission.id)
        lease = await _create_dispatch_style_lease(
            db_session,
            rt.id,
            run.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(run.id),
                "prompt": "orchestrate",
                "provider": "claude_code",
                "claim_token": "tok",
                "stage": "orchestrator",
            },
        )

        payload = await build_claim_payload(db_session, lease)

        assert payload["transport"] == "tar"
        # 兜底命中：mission anchor 双写（camelCase + snake_case）
        assert payload["workspaceId"] == str(ws.id)
        assert payload["workspace_id"] == str(ws.id)
        # stage 既有透传不受影响（daemon isMainAgentSession 判定源）
        assert payload["stage"] == "orchestrator"
        # tar 边界 E6 保持：不透传 specRoot
        assert "specRoot" not in payload
        assert "spec_root" not in payload
        # latestSpecVersion 与 session 模式主控同口径解析（无 SpecWorkspace 行 → 0）
        assert payload["latestSpecVersion"] == 0

    @pytest.mark.asyncio
    async def test_o2_tar_orchestrator_without_mission_no_fallback(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """O2: stage='orchestrator' 但 run 无 mission → 不兜底（防御：无 anchor 源）。"""
        _patch_transport(monkeypatch, "tar")
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        run = await _create_run(db_session, mission_id=None)
        lease = await _create_dispatch_style_lease(
            db_session,
            rt.id,
            run.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(run.id),
                "prompt": "hello",
                "provider": "claude_code",
                "claim_token": "tok",
                "stage": "orchestrator",
            },
        )

        payload = await build_claim_payload(db_session, lease)

        assert payload["transport"] == "tar"
        assert "workspaceId" not in payload
        assert payload.get("workspace_id") is None

    @pytest.mark.asyncio
    async def test_o3_tar_mission_worker_stage_not_filled(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """O3: stage='mission_worker'（分身）→ 即便 run 挂 mission 也不兜底。

        D-008@v1 明确不补：分身维持 2026-08-25-team-subsession-governance 的
        治理受限注入（v1 dispatch_worker 走 dispatch_to_daemon 无 workspace_id，
        保持现状不补发）。
        """
        _patch_transport(monkeypatch, "tar")
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session)
        mission = await _create_mission(db_session, ws.id)
        run = await _create_run(db_session, mission_id=mission.id)
        lease = await _create_dispatch_style_lease(
            db_session,
            rt.id,
            run.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(run.id),
                "prompt": "work",
                "provider": "claude_code",
                "claim_token": "tok",
                "stage": "mission_worker",
            },
        )

        payload = await build_claim_payload(db_session, lease)

        assert payload["transport"] == "tar"
        assert "workspaceId" not in payload
        assert payload.get("workspace_id") is None

    @pytest.mark.asyncio
    async def test_o4_tar_quick_chat_no_stage_no_fallback(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """O4: quick-chat 形态（无 stage + 无 workspace_id）→ 不兜底（边界 E4 保持）。

        quick-chat 无工作区归属（D-008 豁免），daemon 端回落空 workspace 配置。
        """
        _patch_transport(monkeypatch, "tar")
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        run = await _create_run(db_session, mission_id=None)
        lease = await _create_dispatch_style_lease(
            db_session,
            rt.id,
            run.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(run.id),
                "prompt": "quick chat",
                "provider": "claude_code",
                "claim_token": "tok",
            },
        )

        payload = await build_claim_payload(db_session, lease)

        assert payload["transport"] == "tar"
        assert "workspaceId" not in payload
        assert payload.get("workspace_id") is None
