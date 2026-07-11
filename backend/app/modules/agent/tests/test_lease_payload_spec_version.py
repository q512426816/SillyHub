"""task-10（2026-07-02-workspace-config-flow）D-010：lease claim payload
统一带 ``latest_spec_version`` 单测。

守护 ``build_claim_payload``（``daemon/lease/context.py``）按 workspace 读
``SpecWorkspace.spec_version`` 并双写 ``latestSpecVersion`` / ``latest_spec_version``
到 claim payload——daemon 任务执行前比对本地 ``.sillyspec-platform.json.spec_version``
做保鲜（旧了触发 pullSpecBundle）。

向前兼容（task-09 未合前）：``SpecWorkspace`` 行无 ``spec_version`` 列 → ``getattr``
默认 0。本组用例验证：
  - AC-I1: interactive lease + workspace_id + SpecWorkspace 行 → payload.latestSpecVersion == 0
           （task-09 合入加列后自动读真实值，本断言届时改为真实值——本任务只锁字段存在 + 默认值）
  - AC-I2: interactive lease quick-chat（无 workspace_id）→ payload.latestSpecVersion == 0
           （无 spec 同步语义，默认 0）
  - AC-I3: interactive lease tar 模式（daemon-client path_source）同样透传 latestSpecVersion
           （tar 与 shared 两分支共用同一 version 查询）
  - AC-B1: batch lease + workspace 关联 → payload.latestSpecVersion == 0
           （batch agent 任务也走保鲜比对）
  - AC-B2: batch lease 无 workspace 关联 → payload.latestSpecVersion == 0
  - AC-X:  双写一致（camelCase latestSpecVersion == snake_case latest_spec_version）

设计来源：design.md §8 W3（lease payload 加 latest_spec_version）/ §10 W3 验收。
复用 test_lease_service 的 _create_user / _create_runtime / _create_interactive_lease helper。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.daemon.lease.context import build_claim_payload
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.tests.test_lease_service import (
    _create_interactive_lease,
    _create_runtime,
    _create_user,
)
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import AgentRunWorkspace, Workspace


def _patch_transport(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    """Patch ``app.modules.daemon.lease.context.get_settings`` 返回
    spec_transport=value 的 mock settings（同 test_lease_claim_transport）。
    """
    from app.modules.daemon.lease import context as ctx_module

    monkeypatch.setattr(
        ctx_module,
        "get_settings",
        lambda: SimpleNamespace(spec_transport=value),
    )


async def _make_batch_lease(
    session: AsyncSession,
    runtime_id: uuid.UUID,
    *,
    agent_run_id: uuid.UUID,
    metadata: dict | None = None,
) -> DaemonTaskLease:
    """构造 batch lease 行（kind 默认 batch，agent_run_id 非空）。

    与 _create_interactive_lease 对偶：batch lease agent_run_id 列必填，
    build_claim_payload 走 batch 分支。
    """
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=agent_run_id,
        status="claimed",
        kind="batch",
        claimed_at=now,
        metadata_=metadata or {},
        created_at=now,
        updated_at=now,
    )
    session.add(lease)
    await session.commit()
    await session.refresh(lease)
    return lease


class TestLeasePayloadLatestSpecVersion:
    """task-10 D-010：claim payload latest_spec_version 透传单测。"""

    @pytest.mark.asyncio
    async def test_interactive_lease_payload_includes_latest_spec_version(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """AC-I1 + AC-X：interactive lease + workspace + SpecWorkspace 行 →
        payload 双写 latestSpecVersion / latest_spec_version，值默认 0
        （task-09 未合前 getattr 兜底；合入后自动读 SpecWorkspace.spec_version）。
        """
        _patch_transport(monkeypatch, "shared")

        user_id = await _create_user(db_session)
        rt: DaemonRuntime = await _create_runtime(db_session, user_id)

        ws_id = uuid.uuid4()
        db_session.add(
            Workspace(
                id=ws_id,
                name="t10-ws",
                slug="t10-ws",
                root_path="/repos/t10",
                status="active",
            )
        )
        db_session.add(
            SpecWorkspace(
                id=uuid.uuid4(),
                workspace_id=ws_id,
                spec_root="/data/spec-workspaces/t10",
                strategy="platform-managed",
            )
        )
        await db_session.commit()

        lease = await _create_interactive_lease(
            db_session,
            rt.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(uuid.uuid4()),
                "prompt": "scan",
                "provider": "claude_code",
                "claim_token": "tok",
                "workspace_id": str(ws_id),
            },
        )

        payload = await build_claim_payload(db_session, lease)

        # AC-I1：字段存在且默认 0（task-09 合入后会变为真实 spec_version）
        assert "latestSpecVersion" in payload, (
            f"latestSpecVersion missing from interactive payload: {sorted(payload)}"
        )
        assert payload["latestSpecVersion"] == 0
        # AC-X：snake_case 双写同值
        assert "latest_spec_version" in payload
        assert payload["latest_spec_version"] == payload["latestSpecVersion"]

    @pytest.mark.asyncio
    async def test_interactive_quick_chat_lease_defaults_latest_spec_version_zero(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """AC-I2：quick-chat（无 workspace_id）→ latestSpecVersion 默认 0（无 spec 同步语义）。"""
        _patch_transport(monkeypatch, "shared")

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        lease = await _create_interactive_lease(
            db_session,
            rt.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(uuid.uuid4()),
                "prompt": "quick chat",
                "provider": "claude_code",
                "claim_token": "tok",
                # 无 workspace_id（quick-chat）
            },
        )

        payload = await build_claim_payload(db_session, lease)

        assert payload["latestSpecVersion"] == 0
        assert payload["latest_spec_version"] == 0

    @pytest.mark.asyncio
    async def test_interactive_tar_mode_also_includes_latest_spec_version(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """AC-I3：tar 模式（daemon-client path_source）同样透传 latestSpecVersion。

        守护 tar 与 shared 两分支共用同一 version 解析——tar 分支虽提前 return，
        latest_spec_version 在分支前已写入 payload。
        """
        _patch_transport(monkeypatch, "tar")

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)

        ws_id = uuid.uuid4()
        db_session.add(
            Workspace(
                id=ws_id,
                name="t10-tar-ws",
                slug="t10-tar-ws",
                root_path="/repos/t10-tar",
                status="active",
            )
        )
        db_session.add(
            SpecWorkspace(
                id=uuid.uuid4(),
                workspace_id=ws_id,
                spec_root="/data/spec-workspaces/t10-tar",
                strategy="platform-managed",
            )
        )
        await db_session.commit()

        lease = await _create_interactive_lease(
            db_session,
            rt.id,
            metadata={
                "session_id": str(uuid.uuid4()),
                "run_id": str(uuid.uuid4()),
                "prompt": "scan",
                "provider": "claude_code",
                "claim_token": "tok",
                "workspace_id": str(ws_id),
            },
        )

        payload = await build_claim_payload(db_session, lease)

        # tar 模式确实走了
        assert payload["transport"] == "tar"
        # latest_spec_version 仍在（tar 分支前已写）
        assert payload["latestSpecVersion"] == 0
        assert payload["latest_spec_version"] == 0

    @pytest.mark.asyncio
    async def test_batch_lease_payload_includes_latest_spec_version(
        self, db_session: AsyncSession
    ) -> None:
        """AC-B1：batch lease + workspace 关联 → payload.latestSpecVersion 默认 0。

        batch agent 任务执行前 daemon 同样做保鲜比对（D-010 W3）。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)

        ws_id = uuid.uuid4()
        db_session.add(
            Workspace(
                id=ws_id,
                name="t10-batch-ws",
                slug="t10-batch-ws",
                root_path="/repos/t10-batch",
                status="active",
            )
        )
        db_session.add(
            SpecWorkspace(
                id=uuid.uuid4(),
                workspace_id=ws_id,
                spec_root="/data/spec-workspaces/t10-batch",
                strategy="platform-managed",
            )
        )
        run_id = uuid.uuid4()
        db_session.add(
            AgentRun(
                id=run_id,
                agent_type="claude_code",
                status="pending",
            )
        )
        db_session.add(AgentRunWorkspace(agent_run_id=run_id, workspace_id=ws_id))
        await db_session.commit()

        lease = await _make_batch_lease(db_session, rt.id, agent_run_id=run_id)

        payload = await build_claim_payload(db_session, lease)

        # AC-B1：batch 分支同样带字段
        assert "latestSpecVersion" in payload, (
            f"latestSpecVersion missing from batch payload: {sorted(payload)}"
        )
        assert payload["latestSpecVersion"] == 0
        assert payload["latest_spec_version"] == 0
        # 守护确实走了 batch 分支（agent_run_id 透传）
        assert payload["agent_run_id"] == str(run_id)

    @pytest.mark.asyncio
    async def test_batch_lease_no_workspace_defaults_zero(self, db_session: AsyncSession) -> None:
        """AC-B2：batch lease 无 workspace 关联 → latestSpecVersion 默认 0。

        AgentRun 无 AgentRunWorkspace 行 → workspace_id=None → 默认 0。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)

        run_id = uuid.uuid4()
        db_session.add(
            AgentRun(
                id=run_id,
                agent_type="claude_code",
                status="pending",
            )
        )
        # 故意不建 AgentRunWorkspace → workspace_id=None
        await db_session.commit()

        lease = await _make_batch_lease(db_session, rt.id, agent_run_id=run_id)

        payload = await build_claim_payload(db_session, lease)

        assert payload["latestSpecVersion"] == 0
        assert payload["latest_spec_version"] == 0
