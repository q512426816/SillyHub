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

from .delegate import (
    HostFsDelegate,
    HostFsDelegateError,
    HostFsDelegateUnavailable,
)
from .ws_rpc import HostFsWsRpc, send_host_fs_rpc

__all__ = [
    "HostFsDelegate",
    "HostFsDelegateError",
    "HostFsDelegateUnavailable",
    "HostFsWsRpc",
    "send_host_fs_rpc",
]
