"""Team-mode dispatch 测试（2026-07-12-team-mode-platform-wide 起，task-13 收敛）。

task-13（2026-08-22-team-session-unify / D-011）：``POST /api/workspaces/{id}/missions``
创建端点删除后，本文件原「mode/session_id 透传」用例（Wave 1，测 router create_mission
把 body 落 ``constraints``）随之删除——创建入口已归一会话触发（daemon
``POST /sessions/{id}/team-mission`` + MCP 懒建，各自有专属测试）。保留部分：

- task-09（design §5 Phase 2 / Grill NEW-2）：分身派发 lease stage 常量化
  ``MISSION_WORKER_STAGE`` + run.role 移 lease metadata。
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.execution import MISSION_WORKER_STAGE, MissionExecutionService
from app.modules.agent.model import AgentMission, AgentRun
from app.modules.daemon.model import DaemonTaskLease
from app.modules.workspace.model import Workspace

# ════════════════════════════════════════════════════════════════════════════
# task-09（2026-08-22-team-session-unify / design §5 Phase 2 / Grill NEW-2）：
# 分身派发 lease stage 常量化 MISSION_WORKER_STAGE + run.role 移 lease metadata。
#
# 原 ``stage=run.role or "mission_worker"`` 把 role 塞进 stage，daemon 谓词无法
# 可判定排除分身；改为 stage 恒 'mission_worker'（daemon isMainAgentSession 据此
# 不注入主控 5 工具，防 worker 递归派发，审查 CC-12），role 语义由 lease
# metadata["role"] 保留（execution._apply_worker_role_to_lease 补写）。
# ════════════════════════════════════════════════════════════════════════════


async def _make_worker_workspace(session: AsyncSession) -> uuid.UUID:
    """建一个最小 workspace（dispatch_worker 的 ws.root_path/default_agent 依赖）。"""
    ws = Workspace(
        id=uuid.uuid4(),
        name="t",
        slug="t",
        root_path="/tmp/repo",
        default_branch="main",
        default_agent="claude_code",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws.id


async def _make_worker_run(
    session: AsyncSession, mission_id: uuid.UUID, *, role: str | None
) -> AgentRun:
    run = AgentRun(
        mission_id=mission_id,
        agent_type="claude_code",
        status="pending",
        role=role,
        objective="scan arch",
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


def _make_lease_writing_placement(session: AsyncSession) -> MagicMock:
    """fake RunPlacementService：dispatch_to_daemon 把 kwargs 落成真实 DaemonTaskLease 行。

    模拟 placement.py:421 的 ``metadata["stage"] = stage`` 写入（真 placement 需
    在线 runtime，测试内以 side_effect 直接落 lease 行 + 返回 lease id），让
    execution 的 role 补写（raw SQL 读-合并-写回）有真实 metadata 可读。
    """

    async def _write_lease(*args: object, **kwargs: object) -> uuid.UUID:
        # 前两参（agent_run_id / user_id）为位置传参，*args 吸收。
        lease_id = uuid.uuid4()
        session.add(
            DaemonTaskLease(
                id=lease_id,
                status="pending",
                metadata_={
                    "stage": kwargs.get("stage"),
                    "prompt": kwargs.get("prompt"),
                },
            )
        )
        await session.commit()
        return lease_id

    placement = MagicMock()
    placement.dispatch_to_daemon = AsyncMock(side_effect=_write_lease)
    return placement


async def _fetch_lease_meta(session: AsyncSession, lease_id: uuid.UUID) -> dict | None:
    lease = (
        (await session.execute(select(DaemonTaskLease).where(DaemonTaskLease.id == lease_id)))
        .scalars()
        .first()
    )
    if lease is None:
        return None
    # role 补写走 raw SQL UPDATE（对齐 _apply_profile_to_lease），须 refresh 刷
    # ORM 身份映射缓存再读（同 test_dispatch_profile.py:478 模式）。
    await session.refresh(lease)
    return lease.metadata_ or {}


class TestWorkerLeaseStageConstant:
    """task-09：dispatch_worker 派发 lease stage 恒 MISSION_WORKER_STAGE。"""

    @pytest.mark.asyncio
    async def test_dispatch_stage_is_mission_worker_constant(
        self, db_session: AsyncSession
    ) -> None:
        """run.role='arch' → dispatch_to_daemon(stage=MISSION_WORKER_STAGE)，非 role 值。

        谓词可判定前提：stage 不再携带 role 语义（原 ``run.role or "mission_worker"``
        会产生 stage='arch' 等任意值）。
        """
        ws_id = await _make_worker_workspace(db_session)
        mission = AgentMission(workspace_id=ws_id, objective="o")
        db_session.add(mission)
        await db_session.commit()
        await db_session.refresh(mission)
        run = await _make_worker_run(db_session, mission.id, role="arch")

        placement = _make_lease_writing_placement(db_session)
        svc = MissionExecutionService(db_session, placement=placement)

        lease_id = await svc.dispatch_worker(
            run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=False
        )

        assert lease_id is not None
        kwargs = placement.dispatch_to_daemon.call_args.kwargs
        assert kwargs["stage"] == MISSION_WORKER_STAGE == "mission_worker"
        assert kwargs["stage"] != run.role

    @pytest.mark.asyncio
    async def test_lease_metadata_keeps_role_and_constant_stage(
        self, db_session: AsyncSession
    ) -> None:
        """派发后 lease metadata：stage 恒 'mission_worker' + role 键含原 run.role。"""
        ws_id = await _make_worker_workspace(db_session)
        mission = AgentMission(workspace_id=ws_id, objective="o")
        db_session.add(mission)
        await db_session.commit()
        await db_session.refresh(mission)
        run = await _make_worker_run(db_session, mission.id, role="arch")

        placement = _make_lease_writing_placement(db_session)
        svc = MissionExecutionService(db_session, placement=placement)

        lease_id = await svc.dispatch_worker(
            run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=False
        )

        assert lease_id is not None
        meta = await _fetch_lease_meta(db_session, lease_id)
        assert meta is not None
        assert meta["stage"] == "mission_worker"
        assert meta["role"] == "arch"

    @pytest.mark.asyncio
    async def test_role_empty_writes_no_role_key(self, db_session: AsyncSession) -> None:
        """run.role=None → metadata 只含常量 stage，不写 role 键（空值不写）。"""
        ws_id = await _make_worker_workspace(db_session)
        mission = AgentMission(workspace_id=ws_id, objective="o")
        db_session.add(mission)
        await db_session.commit()
        await db_session.refresh(mission)
        run = await _make_worker_run(db_session, mission.id, role=None)

        placement = _make_lease_writing_placement(db_session)
        svc = MissionExecutionService(db_session, placement=placement)

        lease_id = await svc.dispatch_worker(
            run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=True
        )

        assert lease_id is not None
        meta = await _fetch_lease_meta(db_session, lease_id)
        assert meta is not None
        assert meta["stage"] == "mission_worker"
        assert "role" not in meta
