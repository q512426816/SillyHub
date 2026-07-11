"""start_scan_dispatch 校验 daemon-client root_path 经 HostFsDelegate（task-10）。

task-10（2026-07-06-daemon-host-fs-delegate）：root_path 存在性 + 资产保护检测
改经 HostFsDelegate——daemon-client 走 WS RPC 委托 daemon 宿主 stat，不再因
``server_root is None`` 静默跳过。本测试 mock delegate.stat/list_dir 模拟 RPC
可达（宿主确认 root_path 存在且无资产），守护 dispatch 不会被错误拒绝。
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.service import AgentService
from app.modules.workspace.model import Workspace


def _make_pass_delegate() -> MagicMock:
    """mock HostFsDelegate：root_path 放行 + .sillyspec 子路径不存在（资产保护不命中）。"""
    delegate = MagicMock()

    async def _stat(workspace, path):
        if ".sillyspec" in path:
            return {"exists": False, "is_dir": False, "size": 0}
        return {"exists": True, "is_dir": True, "size": 0}

    delegate.stat = AsyncMock(side_effect=_stat)
    delegate.list_dir = AsyncMock(return_value=[])
    return delegate


@pytest.mark.asyncio
async def test_start_scan_dispatch_skips_root_path_check_for_daemon_client(
    db_session: AsyncSession,
) -> None:
    workspace = Workspace(
        id=uuid.uuid4(),
        name="Client",
        slug=f"client-{uuid.uuid4().hex[:8]}",
        root_path=r"C:\Users\qinyi\IdeaProjects\happy",
        status="pending",
    )
    db_session.add(workspace)
    await db_session.commit()

    service = AgentService(db_session)

    with (
        patch.object(service, "_mark_no_online_daemon", new=AsyncMock()),
        patch(
            "app.modules.agent.placement.RunPlacementService.dispatch_to_daemon",
            new=AsyncMock(return_value=uuid.uuid4()),
        ),
        patch(
            "app.modules.agent.placement.RunPlacementService.decide_backend",
            new=AsyncMock(),
        ),
        patch(
            "app.modules.agent.context_builder.build_scan_bundle",
            new=AsyncMock(),
        ),
        patch.object(
            AgentService,
            "_get_host_fs_delegate",
            return_value=_make_pass_delegate(),
        ),
    ):
        run = await service.start_scan_dispatch(
            workspace_id=workspace.id,
            user_id=uuid.uuid4(),
            root_path=workspace.root_path,
            spec_root="/data/spec-workspaces/demo",
        )

    assert run.status == "pending"


@pytest.mark.asyncio
async def test_start_scan_dispatch_daemon_client_rpc_failure_raises(
    db_session: AsyncSession,
) -> None:
    """task-10 行为变化：daemon-client delegate RPC 失败 → 降级 exists:False → raise。

    task-04 D-006：daemon-client RPC 失败时 delegate.stat 降级返回
    {exists:False,...}。task-10 前 daemon-client 整块校验被静默跳过；task-10 后
    校验经 delegate，RPC 不可达时 root_path 校验 raise（等价 daemon 断线 scan
    不能 dispatch）。本测试 mock 一个 RPC 失败 delegate，守护此失败语义。
    """
    from app.modules.agent.service import AgentRunError

    workspace = Workspace(
        id=uuid.uuid4(),
        name="Client-Offline",
        slug=f"client-off-{uuid.uuid4().hex[:8]}",
        root_path=r"C:\Users\qinyi\IdeaProjects\happy",
        status="pending",
    )
    db_session.add(workspace)
    await db_session.commit()

    service = AgentService(db_session)

    fail_delegate = MagicMock()
    fail_delegate.stat = AsyncMock(return_value={"exists": False, "is_dir": False, "size": 0})
    fail_delegate.list_dir = AsyncMock(return_value=[])

    with patch.object(
        AgentService,
        "_get_host_fs_delegate",
        return_value=fail_delegate,
    ):
        with pytest.raises(AgentRunError) as exc_info:
            await service.start_scan_dispatch(
                workspace_id=workspace.id,
                user_id=uuid.uuid4(),
                root_path=workspace.root_path,
                spec_root="/data/spec-workspaces/demo",
            )

    assert "root_path does not exist or is not a directory" in str(exc_info.value)
