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

task-03（2026-08-29-batch-session-inherit / FR-05 / D-005@v1）追加：interactive 分支
resume_session_id 白名单透传守护——重派 worker 的 lease metadata 已带该键但
interactive 分支原本不透传，daemon claim 拿不到续会话 id。断言矩阵：
  - R1/R2: metadata 含 resume_session_id → tar 与 shared 两路 payload 透传值一致；
  - R3: metadata 无该键（存量 quick-chat / 主控）→ payload 无该键（缺省不下发）；
  - B1: batch 分支既有 resume_session_id 透传（context.py batch 段先例）回归不变。

ql-20260904-030-45d1 追加：specStrategy 回退源守护——普通工作区会话 /
orchestrator 主控 lease 不写 metadata.spec_strategy（只有 scan 写），context
原只读 lease_meta → daemon pull 按 platform-managed 兜底，version 变化的覆盖
拉取会拆 repo-native junction。修复后来源优先级 = lease_meta.spec_strategy >
SpecWorkspace.strategy（latestSpecVersion 同一查询带出，零新增查询）。断言矩阵：
  - S1: metadata 带 workspace_id + SpecWorkspace 行 strategy=repo-native、无
    metadata.spec_strategy → tar payload 双写 specStrategy/spec_strategy（源 DB 行）；
  - S2: metadata.spec_strategy 显式（scan 形态）→ 优先于 DB 行值；
  - S3: metadata 带 workspace_id 但无 SpecWorkspace 行 → 不下发任一策略键
    （daemon 维持 platform-managed 兜底，防御不伪造默认值）。

2026-09-10-mcp-central-registry task-06（D-008@v2 / FR-05）追加：claim payload
user_id/userId 双键下发守护——daemon 会话创建预取 MCP 三件套时作 user_id
查询参数（platform ∪ user 注入集，端点 task-05）。断言矩阵 U1-U4（runtime
主路径 / session 兜底 / 两路皆失不下发键 / batch 路同样携带）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentMission, AgentRun, AgentSession
from app.modules.daemon.lease.context import build_claim_payload
from app.modules.daemon.model import DaemonTaskLease
from app.modules.daemon.tests.test_lease_service import (
    _create_runtime,
    _create_user,
)

# build_claim_payload → _inject_provider_config 查 llm_providers 表；import 模型
# 注册到 BaseModel.metadata 让 db_engine 建表（镜像 test_lease_budget_dispatch 惯例）。
from app.modules.llm_provider.model import LlmProvider  # noqa: F401

# ql-20260904-030-45d1：S1-S3 需要 SpecWorkspace 行（表注册 + 构造）。
from app.modules.spec_workspace.model import SpecWorkspace
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
    kind: str = "interactive",
) -> DaemonTaskLease:
    """构造 dispatch_to_daemon 形态 lease（agent_run_id 列非空）。

    与 placement.dispatch_to_daemon 的 INSERT（placement.py:485-503）同构：
    kind='interactive' + agent_run_id 绑定 + metadata 带 session_id/run_id/
    prompt/provider/stage 等。区别于 _create_interactive_lease（prepare_
    interactive_dispatch 形态，agent_run_id 列恒 NULL，D-005@v1）。
    task-03（2026-08-29-batch-session-inherit）：kind 参数化（默认 interactive
    保持既有用例不变），batch 回归用例复用同一构造器。
    """
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=run_id,
        status="claimed",
        kind=kind,
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


class TestInteractiveResumeSessionIdPassthrough:
    """task-03（2026-08-29-batch-session-inherit / FR-05 / D-005@v1）：
    interactive claim payload resume_session_id 白名单透传守护单测。

    重派 worker 的 lease metadata 携带 resume_session_id（原会话 SDK resume id），
    build_claim_payload interactive 分支须透传进 claim payload → daemon
    execPayload.resumeSessionId 归一化 → CreateSessionInput.resume 续原会话
    （daemon 端消费归 task-04）。缺键短路不加 payload 键（不伪造默认值）。
    """

    @pytest.mark.asyncio
    async def test_r1_tar_resume_session_id_passthrough(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """R1: tar 模式 metadata 含 resume_session_id → payload 携带且值一致。

        注入点在 transport tar 分支 return 之前（对齐 stage/worker_depth 先例），
        tar 路 claim payload 同样携带续会话 id。
        """
        _patch_transport(monkeypatch, "tar")
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        run = await _create_run(db_session, mission_id=None)
        resume_key = f"sess-{uuid.uuid4().hex[:24]}"
        lease = await _create_dispatch_style_lease(
            db_session,
            rt.id,
            run.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(run.id),
                "prompt": "continue work",
                "provider": "claude_code",
                "claim_token": "tok",
                "stage": "mission_worker",
                "resume_session_id": resume_key,
            },
        )

        payload = await build_claim_payload(db_session, lease)

        assert payload["transport"] == "tar"
        assert payload["resume_session_id"] == resume_key
        # 既有白名单键不受影响（stage 透传先例同在）
        assert payload["stage"] == "mission_worker"

    @pytest.mark.asyncio
    async def test_r2_shared_resume_session_id_passthrough(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """R2: shared 模式（默认 transport）metadata 含 resume_session_id → 同样携带。

        注入点在 shared 分支 return 之前，两路 claim payload 都带续会话 id。
        """
        _patch_transport(monkeypatch, "shared")
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        run = await _create_run(db_session, mission_id=None)
        resume_key = f"sess-{uuid.uuid4().hex[:24]}"
        lease = await _create_dispatch_style_lease(
            db_session,
            rt.id,
            run.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(run.id),
                "prompt": "continue work",
                "provider": "claude_code",
                "claim_token": "tok",
                "resume_session_id": resume_key,
            },
        )

        payload = await build_claim_payload(db_session, lease)

        assert payload["transport"] == "shared"
        assert payload["resume_session_id"] == resume_key

    @pytest.mark.asyncio
    async def test_r3_missing_resume_session_id_no_key(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """R3: metadata 无 resume_session_id（存量 quick-chat / 主控 / 旧 lease）
        → payload 不含该键（缺省不下发，undefined 穿透零回归）。"""
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

        assert "resume_session_id" not in payload

    @pytest.mark.asyncio
    async def test_b1_batch_resume_session_id_regression(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """B1: batch 分支既有 resume_session_id 透传（context.py batch 段先例）
        行为回归不变——本 task 只补 interactive 分支，batch 键值照旧透传。"""
        _patch_transport(monkeypatch, "tar")
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        run = await _create_run(db_session, mission_id=None)
        resume_key = f"sess-{uuid.uuid4().hex[:24]}"
        lease = await _create_dispatch_style_lease(
            db_session,
            rt.id,
            run.id,
            kind="batch",
            metadata={
                "run_id": str(run.id),
                "prompt": "batch job",
                "claim_token": "tok",
                "resume_session_id": resume_key,
            },
        )

        payload = await build_claim_payload(db_session, lease)

        assert payload["kind"] == "batch"
        assert payload["agent_run_id"] == str(run.id)
        assert payload["resume_session_id"] == resume_key


# ---------------------------------------------------------------------------
# ql-20260904-030-45d1：specStrategy 回退源（lease_meta > SpecWorkspace.strategy）
# ---------------------------------------------------------------------------


async def _create_spec_ws(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    *,
    strategy: str,
    spec_version: int = 0,
) -> SpecWorkspace:
    """构造 SpecWorkspace 行（spec_root nullable=False 必须给值；值无消费方随便填）。"""
    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        spec_root=f"/tmp/spec-ws-{uuid.uuid4().hex[:8]}",
        strategy=strategy,
        spec_version=spec_version,
    )
    session.add(spec_ws)
    await session.commit()
    await session.refresh(spec_ws)
    return spec_ws


class TestBuildClaimPayloadSpecStrategyFallback:
    """ql-20260904-030-45d1：specStrategy 回退源单测（断言矩阵 S1-S3）。"""

    @pytest.mark.asyncio
    async def test_s1_workspace_lease_falls_back_to_spec_ws_strategy(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """S1: 普通工作区会话 lease（写 workspace_id 不写策略键）→ 回退 SpecWorkspace.strategy。

        prepare_interactive_dispatch 形态 metadata（session_id/run_id/workspace_id，
        无 stage 无 spec_strategy）。修复前 specStrategy 缺失 → daemon pull 按
        platform-managed 兜底；修复后回退读 DB 行 strategy 双写透传。
        """
        _patch_transport(monkeypatch, "tar")
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session)
        await _create_spec_ws(db_session, ws.id, strategy="repo-native", spec_version=7)
        run = await _create_run(db_session, mission_id=None)
        lease = await _create_dispatch_style_lease(
            db_session,
            rt.id,
            run.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(run.id),
                "prompt": "workspace session",
                "provider": "claude_code",
                "claim_token": "tok",
                "workspace_id": str(ws.id),
            },
        )

        payload = await build_claim_payload(db_session, lease)

        assert payload["transport"] == "tar"
        assert payload["workspaceId"] == str(ws.id)
        # 回退源命中：DB 行 strategy 双写（camelCase + snake_case）
        assert payload["specStrategy"] == "repo-native"
        assert payload["spec_strategy"] == "repo-native"
        # 同一查询带出的 latestSpecVersion 顺带断言（无额外 DB 往返）
        assert payload["latestSpecVersion"] == 7

    @pytest.mark.asyncio
    async def test_s2_explicit_lease_meta_strategy_wins(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """S2: metadata.spec_strategy 显式（scan 形态）→ 优先于 DB 行值。

        scan lease 同时写 workspace_id + spec_strategy，优先级保证既有行为不变。
        """
        _patch_transport(monkeypatch, "tar")
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session)
        await _create_spec_ws(db_session, ws.id, strategy="repo-native")
        run = await _create_run(db_session, mission_id=None)
        lease = await _create_dispatch_style_lease(
            db_session,
            rt.id,
            run.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(run.id),
                "prompt": "scan",
                "provider": "claude_code",
                "claim_token": "tok",
                "workspace_id": str(ws.id),
                "spec_strategy": "repo-mirrored",
            },
        )

        payload = await build_claim_payload(db_session, lease)

        assert payload["specStrategy"] == "repo-mirrored"
        assert payload["spec_strategy"] == "repo-mirrored"

    @pytest.mark.asyncio
    async def test_s3_no_spec_ws_row_no_strategy_keys(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """S3: workspace_id 有值但查无 SpecWorkspace 行 → 不下发任一策略键。

        防御不伪造默认值——daemon 维持 platform-managed 兜底（与 latestSpecVersion
        归 0 同语义，context.py quick-chat/无行注释先例）。
        """
        _patch_transport(monkeypatch, "tar")
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session)  # 有 Workspace 无 SpecWorkspace 行
        run = await _create_run(db_session, mission_id=None)
        lease = await _create_dispatch_style_lease(
            db_session,
            rt.id,
            run.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(run.id),
                "prompt": "workspace session",
                "provider": "claude_code",
                "claim_token": "tok",
                "workspace_id": str(ws.id),
            },
        )

        payload = await build_claim_payload(db_session, lease)

        assert payload["workspaceId"] == str(ws.id)
        assert "specStrategy" not in payload
        assert "spec_strategy" not in payload
        assert payload["latestSpecVersion"] == 0


# ---------------------------------------------------------------------------
# task-06（2026-09-10-mcp-central-registry / D-008@v2 / FR-05）：user_id 双键下发
# ---------------------------------------------------------------------------


async def _create_agent_session(
    session: AsyncSession,
    user_id: uuid.UUID,
) -> AgentSession:
    """构造 AgentSession 行（interactive 兜底解析的 user 来源）。

    provider/status 皆有默认或非空占位，user_id 为唯一关键列（nullable=False）。
    """
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        provider="claude_code",
    )
    session.add(sess)
    await session.commit()
    await session.refresh(sess)
    return sess


class TestBuildClaimPayloadUserId:
    """claim payload user_id/userId 双写守护单测（2026-09-10-mcp-central-registry）。

    daemon 会话创建预取 MCP 三件套时把 user_id 作
    ``GET /api/daemon/mcp/config`` 查询参数（platform ∪ user 注入集，端点 task-05）。
    断言矩阵：
      - U1: runtime 在（主路径 ``lease.runtime_id → DaemonRuntime.user_id``）→
        payload 双写 user_id/userId（str 形态，与 workspaceId 惯例一致）；
      - U2: runtime 缺失 + interactive 兜底 session（``lease_meta.session_id →
        AgentSession.user_id``）→ 双写命中 session 归属用户；
      - U3: runtime 缺失 + 无 session_id → 两键均不下发（None 不下发键，
        daemon 全链 undefined 穿透，旧 lease 零回归）；
      - U4: batch lease 同样携带（注入点在所有 kind 分支之前，batch 回归补断言）。
    """

    @pytest.mark.asyncio
    async def test_u1_runtime_main_path_double_write(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """U1: 主路径命中——payload 双写 user_id/userId == str(runtime.user_id)。"""
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
                "prompt": "hi",
                "provider": "claude_code",
                "claim_token": "tok",
            },
        )

        payload = await build_claim_payload(db_session, lease)

        assert payload["user_id"] == str(user_id)
        assert payload["userId"] == str(user_id)

    @pytest.mark.asyncio
    async def test_u2_runtime_missing_session_fallback(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """U2: runtime 缺失 → 兜底 lease_meta.session_id → AgentSession.user_id。"""
        _patch_transport(monkeypatch, "tar")
        sess_user_id = await _create_user(db_session)
        sess = await _create_agent_session(db_session, sess_user_id)
        run = await _create_run(db_session, mission_id=None)
        lease = await _create_dispatch_style_lease(
            db_session,
            None,  # runtime 缺失（防御形态）→ 走 interactive session 兜底
            run.id,
            metadata={
                "session_id": str(sess.id),
                "run_id": str(run.id),
                "prompt": "hi",
                "provider": "claude_code",
                "claim_token": "tok",
            },
        )

        payload = await build_claim_payload(db_session, lease)

        assert payload["user_id"] == str(sess_user_id)
        assert payload["userId"] == str(sess_user_id)

    @pytest.mark.asyncio
    async def test_u3_unresolvable_no_keys(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """U3: runtime 缺失 + 无 session_id → 两键均不下发（不伪造默认值）。"""
        _patch_transport(monkeypatch, "tar")
        await _create_user(db_session)  # 无 runtime / 无 session 关联
        run = await _create_run(db_session, mission_id=None)
        lease = await _create_dispatch_style_lease(
            db_session,
            None,
            run.id,
            metadata={
                "run_id": str(run.id),
                "prompt": "hi",
                "provider": "claude_code",
                "claim_token": "tok",
            },
        )

        payload = await build_claim_payload(db_session, lease)

        assert "user_id" not in payload
        assert "userId" not in payload

    @pytest.mark.asyncio
    async def test_u4_batch_lease_carries_user_id(
        self,
        db_session: AsyncSession,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """U4: batch 路同样携带（注入点在 kind 分支之前，全路径覆盖）。"""
        _patch_transport(monkeypatch, "tar")
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        run = await _create_run(db_session, mission_id=None)
        lease = await _create_dispatch_style_lease(
            db_session,
            rt.id,
            run.id,
            kind="batch",
            metadata={
                "run_id": str(run.id),
                "prompt": "batch job",
                "claim_token": "tok",
            },
        )

        payload = await build_claim_payload(db_session, lease)

        assert payload["kind"] == "batch"
        assert payload["user_id"] == str(user_id)
        assert payload["userId"] == str(user_id)
