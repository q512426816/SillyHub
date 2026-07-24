"""Thin WS RPC wrapper for backend → daemon ``host_fs.*`` calls.

Implements task-02 of change ``2026-07-06-daemon-host-fs-delegate``.

This module is a *thin wrapper* over :meth:`DaemonWsHub.send_rpc` — it does
NOT re-implement the rpc_id correlation, timeout handling, or envelope
construction. spike-01 verified the existing per-daemon WS RPC channel is
already complete (``send_rpc`` + ``resolve_rpc`` + the ``daemon:rpc`` /
``daemon:rpc_result`` envelope); this module only:

* Hard-codes the 30s timeout (D-006 — host_fs ops like ``git apply`` on large
  patches need more headroom than the 10s ``RPC_DEFAULT_TIMEOUT``). The
  timeout constant is intentionally inlined as ``30.0`` here; task-04 will
  extract ``HOST_FS_RPC_TIMEOUT`` when it unifies timeout / idempotency
  policy across all host_fs callers.
* Namespaces the method as ``host_fs.<op>`` to avoid colliding with the
  existing ``list_dir`` / ``get_spec_bundle`` handlers registered on the
  daemon side (``ws-client.ts`` ``registerRpcHandler``).
* Packs ``workspace_id`` + the method-specific ``args`` into the RPC
  ``params`` dict (envelope-nested form, see CONTRACT_GAP note below).

The daemon-side handler is wired in task-03 (``host-fs-handler.ts``); this
module is backend-only and can be unit-tested with a mock ``ws_hub`` before
task-03 lands.

CONTRACT_GAP (design §7 vs implementation): the design doc describes a flat
top-level envelope ``{type, method, workspace_id, daemon_id, args, rpc_id}``.
The *actual* ``daemon:rpc`` envelope implemented by ``ws_hub.send_rpc`` is
nested: ``{type:"daemon:rpc", payload:{rpc_id, method, params}}`` where
``workspace_id`` / ``daemon_id`` / ``args`` live INSIDE ``params``. Per
spike-01 + D-005 (reuse per-daemon WS, no new HTTP server), this module
adopts the nested form. design §7 will be revised to match.
"""

from __future__ import annotations

import os
import uuid
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from app.modules.daemon.ws_hub import DaemonWsHub

# Per-call timeout for host_fs RPCs (D-006 — git apply on a large patch / 3-way
# merge needs more headroom than the 10s ``RPC_DEFAULT_TIMEOUT``). task-04 extracts
# the literal into a named module-level constant that is env-overridable so ops can
# widen the budget without a code change (blueprint task-04 implementation bullet 1 /
# constraints bullet 2). The 30.0 default aligns with design §11 risk headroom.
HOST_FS_RPC_TIMEOUT = float(os.getenv("HOST_FS_RPC_TIMEOUT", "30.0"))


async def send_host_fs_rpc(
    ws_hub: "DaemonWsHub",
    daemon_id: uuid.UUID,
    method: str,
    workspace_id: uuid.UUID,
    args: dict[str, Any],
    *,
    timeout: float = HOST_FS_RPC_TIMEOUT,
) -> dict[str, Any]:
    """Send a ``host_fs.<op>`` RPC to the daemon and await its result.

    Parameters
    ----------
    ws_hub:
        The :class:`DaemonWsHub` singleton (or any object exposing a compatible
        ``send_rpc`` coroutine). The caller (HostFsDelegate, task-01) injects
        the process-wide hub.
    daemon_id:
        Target daemon instance id — the per-daemon WS routing key (D-005).
    method:
        The host_fs operation name WITHOUT the ``host_fs.`` prefix, e.g.
        ``"git_apply"`` / ``"stat"`` / ``"read_file"``. The prefix is added
        here to keep callers free of stringly-typed namespace noise and to
        guarantee no collision with ``list_dir`` / ``get_spec_bundle``.
    workspace_id:
        Workspace the operation targets. Packed into ``params`` so the
        daemon-side handler (task-03) can resolve ``allowed_roots`` from the
        bound workspace before touching the host filesystem.
    args:
        Method-specific business arguments (e.g. ``{"patch_data": "...",
        "use_3way": True}`` for ``git_apply``). Merged into ``params``
        alongside ``workspace_id``.
    timeout:
        Per-call timeout in seconds. Defaults to 30.0 (D-006) — well above
        the 10s ``RPC_DEFAULT_TIMEOUT`` because ``git apply`` on a large
        patch / 3-way merge can legitimately take longer.

    Returns
    -------
    dict
        The daemon's ``result`` payload (e.g. ``{"ok": True, ...}`` for
        ``git_apply``). ``send_rpc`` already unpacks the
        ``daemon:rpc_result`` envelope and returns the inner ``result`` dict.

    Raises
    ------
    DaemonRuntimeOffline
        Daemon has no active WS connection, or the WS send failed. Re-raised
        verbatim from ``ws_hub.send_rpc`` (no new exception classes — spike-01
        decision: reuse the existing RPC exception taxonomy).
    DaemonRpcTimeout
        No reply within ``timeout`` seconds. task-04's HostFsDelegate layer
        catches this and downgrades to a warning so ``complete_lease`` is not
        blocked (D-006 async fault tolerance).
    DaemonRpcRemoteError
        Daemon handler returned an ``error`` dict (e.g. ``forbidden`` for an
        ``allowed_roots`` violation, or ``internal`` for an unexpected fs
        failure). Carries ``.code`` / ``.message`` from the daemon.
    """
    # Namespace the method to avoid colliding with the existing list_dir /
    # get_spec_bundle handlers (spike-01 §"协议形态决策").
    full_method = f"host_fs.{method}" if not method.startswith("host_fs.") else method

    # Envelope-nested params: workspace_id + method args packed together.
    # spike-01 §"协议形态决策" + CONTRACT_GAP note in module docstring.
    params: dict[str, Any] = {"workspace_id": str(workspace_id), **args}

    return await ws_hub.send_rpc(
        daemon_id,
        method=full_method,
        params=params,
        timeout=timeout,
    )


class HostFsWsRpc:
    """Bind a :class:`DaemonWsHub` to the ``send_rpc`` method shape task-01 consumes.

    task-01's :class:`HostFsDelegate` holds a single injected rpc object and
    calls ``rpc.send_rpc(method=..., workspace_id=..., daemon_id=..., args=...)``
    (contract-field-injection locks ``send_rpc`` as the only consumed field).
    This class wraps the module-level :func:`send_host_fs_rpc` so HostFsDelegate
    doesn't have to re-pass ``ws_hub`` on every call.

    W2 consumers (task-05~08) construct ``HostFsWsRpc(ws_hub)`` and inject it
    into ``HostFsDelegate(session, ws_hub, ws_rpc=...)`` for daemon-client
    workspaces.
    """

    def __init__(self, ws_hub: "DaemonWsHub") -> None:
        self._ws_hub = ws_hub

    async def send_rpc(
        self,
        *,
        method: str,
        workspace_id: str | uuid.UUID,
        daemon_id: str | uuid.UUID,
        args: dict[str, Any],
        timeout: float = HOST_FS_RPC_TIMEOUT,
    ) -> dict[str, Any]:
        """Forward to :func:`send_host_fs_rpc`, coercing ids to ``uuid.UUID``.

        task-01 passes ``str`` ids (``str(workspace.id)`` / ``str(daemon_id)``)
        where ``daemon_id`` is the daemon **instance** id resolved by
        :func:`resolve_daemon_instance_for_workspace` (the WS routing key).
        :func:`send_host_fs_rpc` types them as ``uuid.UUID``. Coerce here so
        both str and UUID callers work — the underlying ``ws_hub.send_rpc``
        routes on the UUID value (its internal pending-rpc map keys on the
        daemon_id object).
        """
        return await send_host_fs_rpc(
            self._ws_hub,
            uuid.UUID(str(daemon_id)),
            method,
            uuid.UUID(str(workspace_id)),
            args,
            timeout=timeout,
        )


__all__ = ["HOST_FS_RPC_TIMEOUT", "HostFsWsRpc", "send_host_fs_rpc"]
