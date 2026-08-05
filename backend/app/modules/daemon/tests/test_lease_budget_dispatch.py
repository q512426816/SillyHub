"""task-09 / FR-05 / D-005@v1 / D-009：``build_claim_payload`` 下发 ``AgentMission.budget_tokens``
到 daemon claim payload 的单测（backend execution dispatch 端）。

守护 task-07 实现的 ``_inject_mission_budget``（``daemon/lease/context.py``）：
``AgentMission.budget_tokens``（``agent/model.py:595``，``int | None``）→ claim payload
双写（snake_case ``budget_tokens`` + camelCase ``budgetTokens``），供 daemon 执行循环
检查点消费（task-08 累计 input+output ≥ budget → 软切断，D-006）。

断言矩阵（interactive + batch 两分支 × 含 / 不含 budget）：
  - 含（mission.budget_tokens = N）→ payload 双写齐整，值原样透传（snake + camel）；
  - mission.budget_tokens = None（用户未配预算）→ payload 不得出现任一 budget 键
    （FR-07 / design §9 brownfield：daemon ``ctx.budget_tokens`` undefined → 检查点
    不触发，现有 dispatch 行为零变化）；
  - mission_id = None（非 mission run：quick-chat / scan / 无 mission 的 batch）
    → payload 不加任一 budget 键（``_inject_mission_budget`` mission_id None 短路）。

双写覆盖 task-07 双写惯例（对齐 daemon ``execPayload`` 归一化两端字段名，与
``latestSpecVersion``/``latest_spec_version``、``profileVersion``/``profile_version``
同款），断言 snake + camel 两侧都命中，防 daemon 端任一归一化分支读到 undefined。

夹具范式镜像 ``test_lease_context.py``：import ``test_lease_service.py`` 的
``_create_user`` / ``_create_runtime`` / ``_create_interactive_lease`` helper；
batch 路（AgentRun + AgentRunWorkspace + AgentMission + batch lease）本地构造。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentMission, AgentRun
from app.modules.daemon.lease.context import build_claim_payload
from app.modules.daemon.model import DaemonTaskLease
from app.modules.daemon.tests.test_lease_service import (
    _create_interactive_lease,
    _create_runtime,
    _create_user,
)

# build_claim_payload → _inject_provider_config 查 llm_providers 表；import 模型
# 注册到 BaseModel.metadata 让 db_engine 建表（镜像 test_lease_context 惯例）。
from app.modules.llm_provider.model import LlmProvider  # noqa: F401
from app.modules.workspace.model import AgentRunWorkspace, Workspace

# task-07 双写契约（snake_case, camelCase），严格守护防字段漂移。
_BUDGET_KEYS: tuple[tuple[str, str], ...] = (("budget_tokens", "budgetTokens"),)


# ---------------------------------------------------------------------------
# Helpers — workspace / mission / run / batch lease
# ---------------------------------------------------------------------------


async def _create_workspace(session: AsyncSession) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"bgt-ws-{uuid.uuid4().hex[:6]}",
        slug=f"bgt-ws-{uuid.uuid4().hex[:6]}",
        root_path="/tmp/bgt-test-workspace",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _create_mission(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    *,
    budget_tokens: int | None,
) -> AgentMission:
    """构造 AgentMission（objective 必填非空，budget_tokens 可 None）。"""
    mission = AgentMission(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        objective="bgt-test-objective",
        budget_tokens=budget_tokens,
    )
    session.add(mission)
    await session.commit()
    await session.refresh(mission)
    return mission


async def _create_run(
    session: AsyncSession,
    *,
    mission_id: uuid.UUID | None = None,
    agent_type: str = "claude_code",
) -> AgentRun:
    """构造 AgentRun（mission_id 可 None：None 表示非 mission run）。"""
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type=agent_type,
        provider="claude_code",
        status="running",
        mission_id=mission_id,
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


async def _create_batch_lease(
    session: AsyncSession,
    runtime_id: uuid.UUID,
    run_id: uuid.UUID,
    *,
    metadata: dict,
) -> DaemonTaskLease:
    """构造 batch lease（kind='batch'），带任意 metadata。"""
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=run_id,
        status="claimed",
        kind="batch",
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


def _assert_no_budget_keys(payload: dict) -> None:
    """payload 不得出现任一 budget 键（snake + camel 双向）。"""
    for snake, camel in _BUDGET_KEYS:
        assert snake not in payload, f"unexpected {snake} in payload (budget=None)"
        assert camel not in payload, f"unexpected {camel} in payload (budget=None)"


# ---------------------------------------------------------------------------
# 用例组 A：interactive 分支（lease_meta.run_id → AgentRun.mission_id → mission.budget_tokens）
# ---------------------------------------------------------------------------


class TestBuildClaimPayloadBudgetInteractive:
    """task-09 / FR-05：interactive claim payload 下发 ``AgentMission.budget_tokens``。

    interactive 分支 ``_inject_mission_budget`` 调用（context.py:315）置于 transport
    分支之前，tar / shared 两 return 路径均携带；测试环境默认 transport=tar 也覆盖。
    budget 注入不依赖 transport，故不需 patch settings。
    """

    @pytest.mark.asyncio
    async def test_interactive_payload_contains_budget_when_mission_has_budget(
        self, db_session: AsyncSession
    ) -> None:
        """含：mission.budget_tokens=5000 → payload 双写齐整，值原样透传。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session)
        mission = await _create_mission(db_session, ws.id, budget_tokens=5000)
        run = await _create_run(db_session, mission_id=mission.id)

        lease = await _create_interactive_lease(
            db_session,
            rt.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(run.id),  # interactive 路 budget 源：lease_meta.run_id
                "prompt": "hi",
                "provider": "claude_code",
                "claim_token": "tok",
            },
        )

        payload = await build_claim_payload(db_session, lease)

        # task-07 双写：snake + camel 两侧都命中（防 daemon 任一归一化分支读 undefined）。
        assert payload["budget_tokens"] == 5000
        assert payload["budgetTokens"] == 5000

    @pytest.mark.asyncio
    async def test_interactive_payload_omits_budget_when_mission_budget_none(
        self, db_session: AsyncSession
    ) -> None:
        """mission.budget_tokens=None（用户未配预算）→ payload 不出现任一 budget 键（FR-07）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session)
        mission = await _create_mission(db_session, ws.id, budget_tokens=None)
        run = await _create_run(db_session, mission_id=mission.id)

        lease = await _create_interactive_lease(
            db_session,
            rt.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(run.id),
                "prompt": "hi",
                "provider": "claude_code",
                "claim_token": "tok",
            },
        )

        payload = await build_claim_payload(db_session, lease)

        _assert_no_budget_keys(payload)

    @pytest.mark.asyncio
    async def test_interactive_payload_omits_budget_when_run_has_no_mission(
        self, db_session: AsyncSession
    ) -> None:
        """run.mission_id=None（非 mission interactive run）→ 不加 budget 键
        （``_inject_mission_budget`` mission_id None 短路）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        run = await _create_run(db_session, mission_id=None)

        lease = await _create_interactive_lease(
            db_session,
            rt.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(run.id),
                "prompt": "hi",
                "provider": "claude_code",
                "claim_token": "tok",
            },
        )

        payload = await build_claim_payload(db_session, lease)

        _assert_no_budget_keys(payload)

    @pytest.mark.asyncio
    async def test_interactive_payload_omits_budget_when_no_run_id_in_meta(
        self, db_session: AsyncSession
    ) -> None:
        """quick-chat：lease_meta 无 run_id → mission_id 解析为 None → 不加 budget 键。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)

        lease = await _create_interactive_lease(
            db_session,
            rt.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                # 故意不写 run_id（quick-chat 场景）
                "prompt": "hi",
                "provider": "claude_code",
                "claim_token": "tok",
            },
        )

        payload = await build_claim_payload(db_session, lease)

        _assert_no_budget_keys(payload)


# ---------------------------------------------------------------------------
# 用例组 B：batch 分支（agent_run.mission_id → mission.budget_tokens）
# ---------------------------------------------------------------------------


class TestBuildClaimPayloadBudgetBatch:
    """task-09 / FR-05：batch claim payload 下发 ``AgentMission.budget_tokens``。

    batch 分支 ``_inject_mission_budget`` 调用（context.py:585）读已加载的
    ``agent_run.mission_id``。无 mission 的 batch run（mission_id=None）→ 不加键，零回归。
    """

    @pytest.mark.asyncio
    async def test_batch_payload_contains_budget_when_mission_has_budget(
        self, db_session: AsyncSession
    ) -> None:
        """含：mission.budget_tokens=9999 → payload 双写齐整，值原样透传。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session)
        mission = await _create_mission(db_session, ws.id, budget_tokens=9999)
        run = await _create_run(db_session, mission_id=mission.id)
        db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws.id))
        await db_session.commit()

        lease = await _create_batch_lease(
            db_session,
            rt.id,
            run.id,
            metadata={"claim_token": "tok"},
        )

        payload = await build_claim_payload(db_session, lease)

        assert payload["budget_tokens"] == 9999
        assert payload["budgetTokens"] == 9999

    @pytest.mark.asyncio
    async def test_batch_payload_omits_budget_when_mission_budget_none(
        self, db_session: AsyncSession
    ) -> None:
        """mission.budget_tokens=None → payload 不出现任一 budget 键（FR-07）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session)
        mission = await _create_mission(db_session, ws.id, budget_tokens=None)
        run = await _create_run(db_session, mission_id=mission.id)
        db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws.id))
        await db_session.commit()

        lease = await _create_batch_lease(
            db_session,
            rt.id,
            run.id,
            metadata={"claim_token": "tok"},
        )

        payload = await build_claim_payload(db_session, lease)

        _assert_no_budget_keys(payload)

    @pytest.mark.asyncio
    async def test_batch_payload_omits_budget_when_run_has_no_mission(
        self, db_session: AsyncSession
    ) -> None:
        """run.mission_id=None（非 mission batch run）→ 不加 budget 键（mission_id 短路）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session)
        run = await _create_run(db_session, mission_id=None)
        db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws.id))
        await db_session.commit()

        lease = await _create_batch_lease(
            db_session,
            rt.id,
            run.id,
            metadata={"claim_token": "tok"},
        )

        payload = await build_claim_payload(db_session, lease)

        _assert_no_budget_keys(payload)
