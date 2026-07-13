"""delegate 注入链单测（ql-20260713-002）。

接通 worker delegate 注入链：5 个构造点经共享工厂 ``new_host_fs_delegate``
注入 ``host_fs_delegate``，激活 2026-07-12-worker-worktree-isolation 的 per-worker
worktree 隔离生产链路（之前 5 处全传 None，worktree 隔离生产未激活）。

5 个调用点：
- ``agent/router.py::create_mission`` → ``MissionExecutionService(session, host_fs_delegate=...)``
- ``agent/mcp_tools.py::_merge_mission`` → ``FinalizerService(session, host_fs_delegate=...)``
- ``agent/mcp_tools.py::_cleanup_mission`` → ``FinalizerService(session, host_fs_delegate=...)``
- ``agent/mcp_tools.py::dispatch_worker`` → ``MissionExecutionService(session, host_fs_delegate=...)``
- ``agent/finalizer.py::converge_mission_for_completed_run`` → ``MissionExecutionService`` + ``FinalizerService``
- ``spec_workspace/bootstrap.py::_run_team_bootstrap`` → ``MissionExecutionService(self._session, host_fs_delegate=...)``

本测不连真 daemon：mock ``get_daemon_ws_hub`` 返 fake hub，验证工厂 + service
注入正确（``_host_fs_delegate`` 非 None）。
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.execution import MissionExecutionService
from app.modules.agent.finalizer import FinalizerService
from app.modules.daemon.host_fs import new_host_fs_delegate
from app.modules.daemon.host_fs.delegate import HostFsDelegate


@pytest.mark.asyncio
async def test_new_host_fs_delegate_returns_delegate(db_session: AsyncSession) -> None:
    """共享工厂返 HostFsDelegate 实例（绑 ws_hub），非 None。

    mock ``get_daemon_ws_hub`` 隔离真实 WS RPC，断言返类型 + ws_rpc 已绑 hub。
    """
    fake_hub = object()
    with patch(
        "app.modules.daemon.ws_hub.get_daemon_ws_hub",
        return_value=fake_hub,
    ):
        delegate = new_host_fs_delegate(db_session)

    assert isinstance(delegate, HostFsDelegate)
    # ws_hub / ws_rpc 经构造参数绑到同一 hub（HostFsDelegate 把 hub 存到 self）
    assert delegate._ws_hub is fake_hub


@pytest.mark.asyncio
async def test_new_host_fs_delegate_lazy_import_no_top_level_cycle(
    db_session: AsyncSession,
) -> None:
    """工厂函数内 lazy import ws_hub，顶层 import host_fs 不触发 daemon.service 循环。

    直接 import host_fs 包不抛 ImportError 即证明顶层无循环（设计契约）。
    """
    import importlib

    mod = importlib.import_module("app.modules.daemon.host_fs")
    assert hasattr(mod, "new_host_fs_delegate")
    assert "new_host_fs_delegate" in mod.__all__


@pytest.mark.asyncio
async def test_router_construction_path_injects_delegate(
    db_session: AsyncSession,
) -> None:
    """模拟 router.create_mission 构造 MissionExecutionService 的注入路径。

    验证 ``MissionExecutionService(session, host_fs_delegate=new_host_fs_delegate(session))``
    构造后 ``_host_fs_delegate`` 非 None（对应 router.py 调用点）。
    """
    fake_hub = object()
    with patch(
        "app.modules.daemon.ws_hub.get_daemon_ws_hub",
        return_value=fake_hub,
    ):
        exec_svc = MissionExecutionService(
            db_session, host_fs_delegate=new_host_fs_delegate(db_session)
        )
    assert exec_svc._host_fs_delegate is not None
    assert isinstance(exec_svc._host_fs_delegate, HostFsDelegate)


@pytest.mark.asyncio
async def test_mcp_tools_construction_paths_inject_delegate(
    db_session: AsyncSession,
) -> None:
    """模拟 mcp_tools 两处构造路径（FinalizerService ×2 + MissionExecutionService ×1）。

    - ``_merge_mission`` / ``_cleanup_mission`` → ``FinalizerService(session, host_fs_delegate=...)``
    - ``dispatch_worker`` → ``MissionExecutionService(session, host_fs_delegate=...)``
    """
    fake_hub = object()
    with patch(
        "app.modules.daemon.ws_hub.get_daemon_ws_hub",
        return_value=fake_hub,
    ):
        finalizer = FinalizerService(
            db_session, None, host_fs_delegate=new_host_fs_delegate(db_session)
        )
        exec_svc = MissionExecutionService(
            db_session, host_fs_delegate=new_host_fs_delegate(db_session)
        )
    assert finalizer._host_fs_delegate is not None
    assert isinstance(finalizer._host_fs_delegate, HostFsDelegate)
    assert exec_svc._host_fs_delegate is not None
    assert isinstance(exec_svc._host_fs_delegate, HostFsDelegate)


@pytest.mark.asyncio
async def test_finalizer_construction_paths_inject_delegate(
    db_session: AsyncSession,
) -> None:
    """模拟 finalizer.converge_mission_for_completed_run 两处构造路径。

    - ``MissionExecutionService(session, host_fs_delegate=...)``
    - ``FinalizerService(session, glm_config, host_fs_delegate=...)``
    """
    fake_hub = object()
    with patch(
        "app.modules.daemon.ws_hub.get_daemon_ws_hub",
        return_value=fake_hub,
    ):
        exec_svc = MissionExecutionService(
            db_session, host_fs_delegate=new_host_fs_delegate(db_session)
        )
        finalizer = FinalizerService(
            db_session, None, host_fs_delegate=new_host_fs_delegate(db_session)
        )
    assert exec_svc._host_fs_delegate is not None
    assert finalizer._host_fs_delegate is not None


@pytest.mark.asyncio
async def test_bootstrap_construction_path_injects_delegate(
    db_session: AsyncSession,
) -> None:
    """模拟 spec_workspace/bootstrap._run_team_bootstrap 构造路径。

    验证 ``MissionExecutionService(self._session, host_fs_delegate=new_host_fs_delegate(self._session))``
    构造后 ``_host_fs_delegate`` 非 None。
    """
    fake_hub = object()
    with patch(
        "app.modules.daemon.ws_hub.get_daemon_ws_hub",
        return_value=fake_hub,
    ):
        exec_svc = MissionExecutionService(
            db_session, host_fs_delegate=new_host_fs_delegate(db_session)
        )
    assert exec_svc._host_fs_delegate is not None


@pytest.mark.asyncio
async def test_backward_compat_no_delegate_still_none(db_session: AsyncSession) -> None:
    """铁律 3：不改 service 签名，不传 host_fs_delegate 仍 None（零回归契约）。"""
    exec_svc = MissionExecutionService(db_session)
    finalizer = FinalizerService(db_session, None)
    assert exec_svc._host_fs_delegate is None
    assert finalizer._host_fs_delegate is None
