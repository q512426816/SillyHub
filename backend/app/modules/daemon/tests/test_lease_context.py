"""task-07 / C-13：``build_claim_payload`` profile 字段透传单测。

覆盖 design §6（生命周期契约表）+ Grill C-13：task-06 ``_apply_profile_to_lease``
写入 ``lease.metadata`` 的四键（mcp_refs / skill_refs / effective_allowed_roots /
profile_version）必须经 ``build_claim_payload`` 双写（camelCase + snake_case）进
claim payload，供 daemon 消费（task-09 batch / task-10 interactive）。

断言矩阵（interactive + batch 两分支 × 含 / 不含 profile 字段）：
  - 含：四键双写齐整，值原样透传；
  - 不含：payload 不得出现任一 profile 键（profile=None 零回归，design §5 关键不变量）；
  - 部分键：逐键 ``in`` 守护——只透传存在的键（防御未来部分写入 / 半迁移 lease）。

system_prompt 注入走 task-06 的 claudeMd prepend（design §7 / D-012@v2），不经
context.py，本测试不涉及。

夹具范式镜像 ``test_lease_claim_transport.py``：import ``test_lease_service.py`` 的
``_create_user`` / ``_create_runtime`` / ``_create_interactive_lease`` helper；
batch 路（AgentRun + AgentRunWorkspace + batch lease）本地构造，因 test_lease_service
未暴露带任意 metadata 的 batch lease helper。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.daemon.lease.context import build_claim_payload
from app.modules.daemon.model import DaemonTaskLease
from app.modules.daemon.tests.test_lease_service import (
    _create_interactive_lease,
    _create_runtime,
    _create_user,
)

# build_claim_payload → _inject_provider_config 查 llm_providers 表；import 模型
# 注册到 BaseModel.metadata 让 db_engine 建表（镜像 test_provider_config_payload 惯例）。
from app.modules.llm_provider.model import LlmProvider  # noqa: F401
from app.modules.workspace.model import AgentRunWorkspace, Workspace

# task-07 透传契约的四字段（snake_case, camelCase），严格守护防字段漂移。
_PROFILE_FIELDS: tuple[tuple[str, str], ...] = (
    ("mcp_refs", "mcpRefs"),
    ("skill_refs", "skillRefs"),
    ("effective_allowed_roots", "effectiveAllowedRoots"),
    ("profile_version", "profileVersion"),
)


# ---------------------------------------------------------------------------
# Helpers — batch 路（AgentRun + AgentRunWorkspace + batch lease with metadata）
# ---------------------------------------------------------------------------


async def _create_workspace(session: AsyncSession) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ctx-ws-{uuid.uuid4().hex[:6]}",
        slug=f"ctx-ws-{uuid.uuid4().hex[:6]}",
        root_path="/tmp/ctx-test-workspace",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _create_batch_run(
    session: AsyncSession,
    *,
    agent_type: str = "claude_code",
) -> AgentRun:
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type=agent_type,
        provider="claude_code",
        status="running",
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


def _profile_meta() -> dict:
    """task-06 ``_apply_profile_to_lease`` 写入 lease.metadata 的四键样本值。"""
    return {
        "mcp_refs": ["git", "fs"],
        "skill_refs": ["sillyspec-quick"],
        "effective_allowed_roots": ["/repo/src", "/repo/tests"],
        "profile_version": 7,
    }


def _assert_no_profile_keys(payload: dict) -> None:
    """payload 不得出现任一 profile 键（snake + camel 双向）。"""
    for snake, camel in _PROFILE_FIELDS:
        assert snake not in payload, f"unexpected {snake} in payload (profile=None)"
        assert camel not in payload, f"unexpected {camel} in payload (profile=None)"


# ---------------------------------------------------------------------------
# 用例组 A：interactive 分支（含 transport tar/shared 两 return 路径）
# ---------------------------------------------------------------------------


class TestBuildClaimPayloadProfileInteractive:
    """task-07 / C-13：interactive claim payload 透传 profile 字段。

    interactive 分支有 tar / shared 两个 return 点（context.py），profile 透传调用
    置于 transport 分支之前，两路均应携带。default settings.spec_transport 在测试环境
    下走向量无关——profile 字段不依赖 transport。
    """

    @pytest.mark.asyncio
    async def test_interactive_payload_contains_profile_fields(
        self, db_session: AsyncSession
    ) -> None:
        """含：lease.metadata 四键 → payload 双写齐整，值原样透传。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        meta = {
            "session_id": str(uuid.uuid4()),
            "run_id": str(uuid.uuid4()),
            "prompt": "hi",
            "provider": "claude_code",
            "claim_token": "tok",
            **_profile_meta(),
        }
        lease = await _create_interactive_lease(db_session, rt.id, metadata=meta)

        payload = await build_claim_payload(db_session, lease)

        for snake, camel in _PROFILE_FIELDS:
            assert payload[snake] == meta[snake], f"{snake} mismatch"
            assert payload[camel] == meta[snake], f"{camel} mismatch"
        # 值类型守护：profile_version 是 int（task-06 int(profile.version)）
        assert payload["profile_version"] == 7
        assert payload["profileVersion"] == 7
        assert payload["mcp_refs"] == ["git", "fs"]
        assert payload["effective_allowed_roots"] == ["/repo/src", "/repo/tests"]

    @pytest.mark.asyncio
    async def test_interactive_payload_omits_profile_keys_when_absent(
        self, db_session: AsyncSession
    ) -> None:
        """不含：lease.metadata 无 profile 键 → payload 不出现任一 profile 键（零回归）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease = await _create_interactive_lease(
            db_session,
            rt.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(uuid.uuid4()),
                "prompt": "hi",
                "provider": "claude_code",
                "claim_token": "tok",
            },
        )

        payload = await build_claim_payload(db_session, lease)

        _assert_no_profile_keys(payload)

    @pytest.mark.asyncio
    async def test_interactive_payload_partial_keys_pass_through_per_key(
        self, db_session: AsyncSession
    ) -> None:
        """部分键：仅 mcp_refs + profile_version 存在 → 只透传这两键，其余不含。

        逐键 ``in`` 守护的防御性测试（task-06 当前成组写四键，但 per-key 守护让未来
        部分写入 / 半迁移 lease 不致把 None 写进 payload）。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        partial_meta = {
            "session_id": str(uuid.uuid4()),
            "run_id": str(uuid.uuid4()),
            "prompt": "hi",
            "provider": "claude_code",
            "claim_token": "tok",
            "mcp_refs": ["git"],
            "profile_version": 2,
        }
        lease = await _create_interactive_lease(db_session, rt.id, metadata=partial_meta)

        payload = await build_claim_payload(db_session, lease)

        # 存在的两键双写
        assert payload["mcp_refs"] == ["git"]
        assert payload["mcpRefs"] == ["git"]
        assert payload["profile_version"] == 2
        assert payload["profileVersion"] == 2
        # 不存在的两键不含
        assert "skill_refs" not in payload and "skillRefs" not in payload
        assert "effective_allowed_roots" not in payload and "effectiveAllowedRoots" not in payload


# ---------------------------------------------------------------------------
# 用例组 B：batch 分支
# ---------------------------------------------------------------------------


class TestBuildClaimPayloadProfileBatch:
    """task-07 / C-13：batch claim payload 透传 profile 字段。"""

    @pytest.mark.asyncio
    async def test_batch_payload_contains_profile_fields(self, db_session: AsyncSession) -> None:
        """含：lease.metadata 四键 → payload 双写齐整，值原样透传。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session)
        run = await _create_batch_run(db_session)
        db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws.id))
        await db_session.commit()
        lease = await _create_batch_lease(
            db_session,
            rt.id,
            run.id,
            metadata={"claim_token": "tok", **_profile_meta()},
        )

        payload = await build_claim_payload(db_session, lease)

        for snake, camel in _PROFILE_FIELDS:
            assert payload[snake] == _profile_meta()[snake], f"{snake} mismatch"
            assert payload[camel] == _profile_meta()[snake], f"{camel} mismatch"
        assert payload["profile_version"] == 7
        assert payload["skill_refs"] == ["sillyspec-quick"]
        assert payload["effectiveAllowedRoots"] == ["/repo/src", "/repo/tests"]

    @pytest.mark.asyncio
    async def test_batch_payload_omits_profile_keys_when_absent(
        self, db_session: AsyncSession
    ) -> None:
        """不含：lease.metadata 无 profile 键 → payload 不出现任一 profile 键（零回归）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session)
        run = await _create_batch_run(db_session)
        db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws.id))
        await db_session.commit()
        lease = await _create_batch_lease(
            db_session,
            rt.id,
            run.id,
            metadata={"claim_token": "tok"},
        )

        payload = await build_claim_payload(db_session, lease)

        _assert_no_profile_keys(payload)

    @pytest.mark.asyncio
    async def test_batch_payload_partial_keys_pass_through_per_key(
        self, db_session: AsyncSession
    ) -> None:
        """部分键：仅 skill_refs + effective_allowed_roots 存在 → 只透传这两键。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session)
        run = await _create_batch_run(db_session)
        db_session.add(AgentRunWorkspace(agent_run_id=run.id, workspace_id=ws.id))
        await db_session.commit()
        lease = await _create_batch_lease(
            db_session,
            rt.id,
            run.id,
            metadata={
                "claim_token": "tok",
                "skill_refs": ["sk"],
                "effective_allowed_roots": ["/a"],
            },
        )

        payload = await build_claim_payload(db_session, lease)

        assert payload["skill_refs"] == ["sk"]
        assert payload["skillRefs"] == ["sk"]
        assert payload["effective_allowed_roots"] == ["/a"]
        assert payload["effectiveAllowedRoots"] == ["/a"]
        assert "mcp_refs" not in payload and "mcpRefs" not in payload
        assert "profile_version" not in payload and "profileVersion" not in payload


# ---------------------------------------------------------------------------
# task-04（2026-08-26-team-subsession-recursion / design §5.C / FR-04）：
# worker_depth claim payload 白名单透传
# ---------------------------------------------------------------------------


class TestBuildClaimPayloadWorkerDepth:
    """task-04：interactive claim payload 透传 ``lease.metadata.worker_depth``。

    白名单位置在 stage 先例旁（context.py build_claim_payload interactive 分支）。
    缺键短路不加 payload 键——存量 quick-chat / 主控 / 普通会话 / 旧 lease 全链
    undefined 穿透（零回归，不伪造默认值）。单键 snake_case，对齐 stage 先例
    （daemon 侧归一化 worker_depth ?? workerDepth 双兜底）。
    """

    @pytest.mark.asyncio
    async def test_interactive_payload_contains_worker_depth(
        self, db_session: AsyncSession
    ) -> None:
        """含：lease.metadata.worker_depth=1 → payload["worker_depth"] == 1。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease = await _create_interactive_lease(
            db_session,
            rt.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(uuid.uuid4()),
                "prompt": "hi",
                "provider": "claude_code",
                "claim_token": "tok",
                "worker_depth": 1,
            },
        )

        payload = await build_claim_payload(db_session, lease)

        assert payload["worker_depth"] == 1

    @pytest.mark.asyncio
    async def test_interactive_payload_worker_depth_zero_passthrough(
        self, db_session: AsyncSession
    ) -> None:
        """0 是合法深度值：``is not None`` 守护下照样透传（不被真值判断吞）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease = await _create_interactive_lease(
            db_session,
            rt.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(uuid.uuid4()),
                "prompt": "hi",
                "provider": "claude_code",
                "claim_token": "tok",
                "worker_depth": 0,
            },
        )

        payload = await build_claim_payload(db_session, lease)

        assert payload["worker_depth"] == 0

    @pytest.mark.asyncio
    async def test_interactive_payload_omits_worker_depth_when_absent(
        self, db_session: AsyncSession
    ) -> None:
        """缺键：payload 不出现 worker_depth（存量 lease 零回归）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease = await _create_interactive_lease(
            db_session,
            rt.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(uuid.uuid4()),
                "prompt": "hi",
                "provider": "claude_code",
                "claim_token": "tok",
            },
        )

        payload = await build_claim_payload(db_session, lease)

        assert "worker_depth" not in payload
