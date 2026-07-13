"""Host filesystem delegate — single entry point for backend to touch host paths.

Change 2026-07-06-daemon-host-fs-delegate (FR-01 / D-001@V1 / D-004@V1 / D-005@V1).

Backend container must not directly stat / git / read host paths. All host
operations funnel through :class:`HostFsDelegate`. Change
``2026-07-10-remove-server-local-workspace-mode`` dropped the legacy
``workspaces.path_source`` column the old ``server-local`` branch keyed on,
so the delegate is now a pure daemon-client RPC dispatcher (every method
forwards over the per-daemon WS RPC via the injected ``ws_rpc``). The actual
RPC transport is provided by :class:`HostFsWsRpc`.

Method signatures are locked to design §5.1 verbatim (W2/W3 consumers + the
cross-task contract table depend on every name / parameter / return type).
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from .delegate import (
    HostFsDelegate,
    HostFsDelegateError,
    HostFsDelegateUnavailable,
)
from .ws_rpc import HostFsWsRpc, send_host_fs_rpc

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncSession

__all__ = [
    "HostFsDelegate",
    "HostFsDelegateError",
    "HostFsDelegateUnavailable",
    "HostFsWsRpc",
    "new_host_fs_delegate",
    "send_host_fs_rpc",
]


def new_host_fs_delegate(session: AsyncSession) -> HostFsDelegate:
    """Lazy-construct a :class:`HostFsDelegate` bound to the process ws_hub.

    共享工厂（ql-20260713-002），接通 agent 模块 5 个调用点的 delegate 注入：
    与 ``change/dispatch.py::_new_host_fs_delegate``（:1294）及
    ``DaemonService.host_fs_delegate`` lazy property（daemon/service.py:111）等价
    ——``HostFsDelegate(session, ws_hub=get_daemon_ws_hub(), ws_rpc=HostFsWsRpc(hub))``。

    函数内 lazy import ``get_daemon_ws_hub`` / ``HostFsWsRpc`` 避顶层循环
    （host_fs 依赖 daemon.service 异常类）。失败抛 :class:`HostFsDelegateUnavailable`
    由 caller catch 转 fail-loud。
    """
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    hub = get_daemon_ws_hub()
    return HostFsDelegate(session, ws_hub=hub, ws_rpc=HostFsWsRpc(hub))
