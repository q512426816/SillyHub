"""Host filesystem delegate — single entry point for backend to touch host paths.

Change 2026-07-06-daemon-host-fs-delegate (FR-01 / D-001@V1 / D-004@V1 / D-005@V1).

Backend container must not directly stat / git / read host paths. All eight
host-filesystem operations funnel through :class:`HostFsDelegate`, which branches
on ``workspace.path_source``:

* ``server-local`` — local container implementation, byte-for-byte identical to
  the existing scattered logic (NFR-02 zero-regression, D-004).
* ``daemon-client`` — delegate to per-daemon WS RPC via the injected
  ``ws_rpc`` (D-005). The actual RPC transport is provided by task-02
  (:class:`HostFsWsRpc`); this task only declares ``expects_from`` and verifies
  the call structure with a mock.

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
