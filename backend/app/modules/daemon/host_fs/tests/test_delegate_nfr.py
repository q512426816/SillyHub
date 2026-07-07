"""NFR-01 fault-tolerance tests for HostFsDelegate (task-04 / D-006 + D-008).

Four-quadrant coverage of the async fault tolerance the task adds on top of
task-01's call-structure contract:

* **timeout** — ws_rpc raises ``DaemonRpcTimeout`` → HostFsDelegate returns the
  method's documented degraded value and never re-raises (D-006).
* **offline / reconnect** — ws_rpc raises ``DaemonRuntimeOffline`` once then
  succeeds on the next call → the failed call degrades, the next call returns
  the daemon's real result (rpc_id is single-use, no replay ambiguity).
* **remote_error** — ws_rpc raises ``DaemonRpcRemoteError`` → degraded return.
* **conflict** — ws_rpc raises ``DaemonRpcConflict`` → degraded return.
* **idempotence (D-008 backend line)** — same ``agent_run_id`` + same
  ``patch_data`` returns ``{skipped: True}`` on the second call without a
  second RPC round-trip.
* **HOST_FS_RPC_TIMEOUT env override** — the timeout constant reads from the
  env at import time and defaults to 30.0.

The existing ``test_delegate.py`` already covers the success-path call
structure for all eight methods; these tests assert the failure-path policy
on a representative subset (the degrade mapping is uniform — exercised once
per method shape rather than 8×).
"""

from __future__ import annotations

import os
from typing import Any
from uuid import uuid4

import pytest

from app.modules.daemon.host_fs import HostFsDelegate
from app.modules.daemon.host_fs.ws_rpc import HOST_FS_RPC_TIMEOUT
from app.modules.daemon.service import (
    DaemonRpcConflict,
    DaemonRpcRemoteError,
    DaemonRpcTimeout,
    DaemonRuntimeOffline,
)
from app.modules.workspace.model import Workspace

# ── helpers ───────────────────────────────────────────────────────────────────────


class _ScriptedWsRpc:
    """Mock ws_rpc that pops scripted outcomes off a queue.

    Each entry is either:
    * ``{"raise": <Exception>}`` — raise that exception on send_rpc.
    * ``{"return": <dict>}`` — return that dict.

    Records every call so the idempotence tests can assert RPC count.
    """

    def __init__(self, outcomes: list[dict[str, Any]]) -> None:
        self._outcomes = list(outcomes)
        self.calls: list[dict[str, Any]] = []

    async def send_rpc(
        self,
        *,
        method: str,
        workspace_id: str,
        daemon_id: str,
        args: dict[str, Any],
    ) -> dict[str, Any]:
        self.calls.append(
            {
                "method": method,
                "workspace_id": workspace_id,
                "daemon_id": daemon_id,
                "args": args,
            }
        )
        if not self._outcomes:
            # Default to empty dict once the script is exhausted — callers
            # that need a richer return populate the queue themselves.
            return {}
        outcome = self._outcomes.pop(0)
        if "raise" in outcome:
            raise outcome["raise"]
        return outcome["return"]


def _daemon_client_workspace() -> Workspace:
    ws_id = uuid4()
    return Workspace(
        id=ws_id,
        name=f"nfr-ws-{ws_id.hex[:8]}",
        slug=f"nfr-ws-{ws_id.hex[:8]}",
        root_path="/host/remote",
        path_source="daemon-client",
        daemon_runtime_id=uuid4(),
        status="active",
    )


async def _fake_daemon_id_resolver(session: Any, workspace_id: Any) -> Any:
    """Stub resolver — NFR tests focus on timeout/degrade policy, not routing."""
    return uuid4()


def _delegate_with(rpc: _ScriptedWsRpc) -> HostFsDelegate:
    # daemon_id_resolver 注入 fake（session=None 不能跑真 DB 解析）；NFR 测试聚焦
    # 超时/降级/幂等策略，daemon_id 解析的真路径由 test_delegate_integration 覆盖。
    return HostFsDelegate(
        session=None,
        ws_hub=None,
        ws_rpc=rpc,
        daemon_id_resolver=_fake_daemon_id_resolver,
    )


# ── 1. timeout quadrant ────────────────────────────────────────────────────────────


class TestTimeoutDegrade:
    async def test_stat_timeout_returns_missing(self) -> None:
        rpc = _ScriptedWsRpc([{"raise": DaemonRpcTimeout("t", details={})}])
        delegate = _delegate_with(rpc)
        out = await delegate.stat(_daemon_client_workspace(), "/host/x")
        assert out == {"exists": False, "is_dir": False, "size": 0}
        assert len(rpc.calls) == 1

    async def test_read_file_timeout_returns_empty(self) -> None:
        rpc = _ScriptedWsRpc([{"raise": DaemonRpcTimeout("t", details={})}])
        delegate = _delegate_with(rpc)
        out = await delegate.read_file(_daemon_client_workspace(), "/host/x")
        assert out == ""

    async def test_list_dir_timeout_returns_empty(self) -> None:
        rpc = _ScriptedWsRpc([{"raise": DaemonRpcTimeout("t", details={})}])
        delegate = _delegate_with(rpc)
        out = await delegate.list_dir(_daemon_client_workspace(), "/host/x")
        assert out == []

    async def test_git_apply_timeout_returns_degraded(self) -> None:
        rpc = _ScriptedWsRpc([{"raise": DaemonRpcTimeout("t", details={})}])
        delegate = _delegate_with(rpc)
        out = await delegate.git_apply(_daemon_client_workspace(), "PATCH", use_3way=False)
        assert out == {
            "ok": False,
            "conflict_detail": "rpc unavailable",
            "skipped": False,
        }

    async def test_git_rev_parse_timeout_returns_none(self) -> None:
        rpc = _ScriptedWsRpc([{"raise": DaemonRpcTimeout("t", details={})}])
        delegate = _delegate_with(rpc)
        out = await delegate.git_rev_parse(_daemon_client_workspace(), "HEAD")
        assert out is None

    async def test_pollution_archive_timeout_returns_unarchived(self) -> None:
        rpc = _ScriptedWsRpc([{"raise": DaemonRpcTimeout("t", details={})}])
        delegate = _delegate_with(rpc)
        out = await delegate.pollution_archive(_daemon_client_workspace(), "/host/src")
        assert out == {"archived": False, "detail": "rpc unavailable"}

    async def test_read_package_json_timeout_returns_none(self) -> None:
        rpc = _ScriptedWsRpc([{"raise": DaemonRpcTimeout("t", details={})}])
        delegate = _delegate_with(rpc)
        out = await delegate.read_package_json(_daemon_client_workspace())
        assert out is None

    async def test_read_local_yaml_timeout_returns_none(self) -> None:
        rpc = _ScriptedWsRpc([{"raise": DaemonRpcTimeout("t", details={})}])
        delegate = _delegate_with(rpc)
        out = await delegate.read_local_yaml(_daemon_client_workspace())
        assert out is None


# ── 2. offline quadrant ────────────────────────────────────────────────────────────


class TestOfflineDegrade:
    async def test_stat_offline_returns_missing(self) -> None:
        rpc = _ScriptedWsRpc([{"raise": DaemonRuntimeOffline("down", details={})}])
        delegate = _delegate_with(rpc)
        out = await delegate.stat(_daemon_client_workspace(), "/host/x")
        assert out == {"exists": False, "is_dir": False, "size": 0}


# ── 3. remote_error + conflict quadrants ───────────────────────────────────────────


class TestRemoteAndConflictDegrade:
    async def test_stat_remote_error_degrades(self) -> None:
        rpc = _ScriptedWsRpc(
            [
                {
                    "raise": DaemonRpcRemoteError(
                        {"code": "forbidden", "message": "outside allowed_roots"}
                    )
                }
            ]
        )
        delegate = _delegate_with(rpc)
        out = await delegate.stat(_daemon_client_workspace(), "/host/x")
        assert out == {"exists": False, "is_dir": False, "size": 0}

    async def test_stat_conflict_degrades(self) -> None:
        rpc = _ScriptedWsRpc([{"raise": DaemonRpcConflict("c", details={})}])
        delegate = _delegate_with(rpc)
        out = await delegate.stat(_daemon_client_workspace(), "/host/x")
        assert out == {"exists": False, "is_dir": False, "size": 0}


# ── 4. reconnect quadrant — offline then success ───────────────────────────────────


class TestReconnectRecovers:
    """D-006: a one-off transport failure does NOT poison subsequent calls.

    rpc_id is single-use (ws_hub uuid4), so there is no replay ambiguity: the
    failed call's rpc_id is cancelled on disconnect and the next call uses a
    fresh rpc_id. HostFsDelegate just needs to NOT cache the failure.
    """

    async def test_offline_then_success(self) -> None:
        rpc = _ScriptedWsRpc(
            [
                {"raise": DaemonRuntimeOffline("down", details={})},
                {"return": {"exists": True, "is_dir": False, "size": 99}},
            ]
        )
        delegate = _delegate_with(rpc)

        first = await delegate.stat(_daemon_client_workspace(), "/host/x")
        assert first == {"exists": False, "is_dir": False, "size": 0}

        # Second call hits a healthy daemon and returns the real result — the
        # delegate does not memoise the prior failure.
        second = await delegate.stat(_daemon_client_workspace(), "/host/x")
        assert second == {"exists": True, "is_dir": False, "size": 99}
        assert len(rpc.calls) == 2


# ── 5. idempotence (D-008 backend line) ────────────────────────────────────────────


class TestPatchIdIdempotence:
    async def test_same_agent_run_same_patch_second_call_skipped(self) -> None:
        """D-008 first line: replayed patch returns skipped without RPC."""
        rpc = _ScriptedWsRpc([{"return": {"ok": True, "conflict_detail": None, "skipped": False}}])
        delegate = _delegate_with(rpc)
        ws = _daemon_client_workspace()
        run_id = "run-abc"

        first = await delegate.git_apply(ws, "PATCH-BODY", use_3way=False, agent_run_id=run_id)
        assert first == {"ok": True, "conflict_detail": None, "skipped": False}

        second = await delegate.git_apply(ws, "PATCH-BODY", use_3way=False, agent_run_id=run_id)
        # Second call is short-circuited at the cache — no second RPC, and the
        # returned shape carries the skipped + patch_id signal.
        assert second["ok"] is True
        assert second["skipped"] is True
        assert "patch_id" in second
        assert len(rpc.calls) == 1  # only the first call hit the wire

    async def test_different_patch_not_deduped(self) -> None:
        """A different patch body under the same agent_run_id still applies."""
        rpc = _ScriptedWsRpc(
            [
                {"return": {"ok": True, "conflict_detail": None, "skipped": False}},
                {"return": {"ok": True, "conflict_detail": None, "skipped": False}},
            ]
        )
        delegate = _delegate_with(rpc)
        ws = _daemon_client_workspace()
        run_id = "run-xyz"

        await delegate.git_apply(ws, "PATCH-ONE", use_3way=False, agent_run_id=run_id)
        await delegate.git_apply(ws, "PATCH-TWO", use_3way=False, agent_run_id=run_id)
        assert len(rpc.calls) == 2  # both round-tripped (different content hashes)

    async def test_different_agent_run_not_deduped(self) -> None:
        """Same patch body under a different agent_run_id is NOT a hit."""
        rpc = _ScriptedWsRpc(
            [
                {"return": {"ok": True, "conflict_detail": None, "skipped": False}},
                {"return": {"ok": True, "conflict_detail": None, "skipped": False}},
            ]
        )
        delegate = _delegate_with(rpc)
        ws = _daemon_client_workspace()

        await delegate.git_apply(ws, "SAME-PATCH", use_3way=False, agent_run_id="run-1")
        await delegate.git_apply(ws, "SAME-PATCH", use_3way=False, agent_run_id="run-2")
        assert len(rpc.calls) == 2

    async def test_no_agent_run_skips_dedupe(self) -> None:
        """agent_run_id=None (task-01 back-compat) disables backend dedupe."""
        rpc = _ScriptedWsRpc(
            [
                {"return": {"ok": True, "conflict_detail": None, "skipped": False}},
                {"return": {"ok": True, "conflict_detail": None, "skipped": False}},
            ]
        )
        delegate = _delegate_with(rpc)
        ws = _daemon_client_workspace()

        # Both calls omit agent_run_id → no cache → both round-trip; the
        # daemon --check guard (D-008 second line) owns idempotency here.
        await delegate.git_apply(ws, "SAME-PATCH", use_3way=False)
        await delegate.git_apply(ws, "SAME-PATCH", use_3way=False)
        assert len(rpc.calls) == 2

    async def test_failed_apply_not_cached(self) -> None:
        """A failed apply (ok:False) must NOT be memoised — retry can succeed."""
        rpc = _ScriptedWsRpc(
            [
                # First attempt: RPC fails (timeout) → degraded ok:False.
                {"raise": DaemonRpcTimeout("t", details={})},
                # Second attempt: daemon recovers → real ok:True.
                {"return": {"ok": True, "conflict_detail": None, "skipped": False}},
            ]
        )
        delegate = _delegate_with(rpc)
        ws = _daemon_client_workspace()
        run_id = "run-retry"

        first = await delegate.git_apply(ws, "PATCH", use_3way=False, agent_run_id=run_id)
        assert first["ok"] is False

        second = await delegate.git_apply(ws, "PATCH", use_3way=False, agent_run_id=run_id)
        assert second["ok"] is True
        assert second.get("skipped") is not True  # real apply, not a cache hit
        assert len(rpc.calls) == 2  # both round-tripped — failure was not cached


# ── 6. timeout constant env override ───────────────────────────────────────────────


class TestTimeoutConstantEnvOverride:
    def test_default_is_30s(self) -> None:
        """Without an env override the constant is 30.0 (D-006 headroom)."""
        # The module reads the env at import time. Re-import under a clean env
        # to verify the default regardless of whatever the test runner set.
        import importlib

        original = os.environ.pop("HOST_FS_RPC_TIMEOUT", None)
        try:
            mod = importlib.import_module("app.modules.daemon.host_fs.ws_rpc")
            importlib.reload(mod)
            assert mod.HOST_FS_RPC_TIMEOUT == 30.0
        finally:
            if original is not None:
                os.environ["HOST_FS_RPC_TIMEOUT"] = original
                importlib.import_module("app.modules.daemon.host_fs.ws_rpc")
                importlib.reload(mod)

    def test_env_override_changes_default(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """HOST_FS_RPC_TIMEOUT=60 halves the budget without a code change."""
        import importlib

        monkeypatch.setenv("HOST_FS_RPC_TIMEOUT", "60.0")
        mod = importlib.import_module("app.modules.daemon.host_fs.ws_rpc")
        importlib.reload(mod)
        assert mod.HOST_FS_RPC_TIMEOUT == 60.0
        # Restore the module so downstream tests see the real default again.
        monkeypatch.delenv("HOST_FS_RPC_TIMEOUT", raising=False)
        importlib.import_module("app.modules.daemon.host_fs.ws_rpc")
        importlib.reload(mod)
        assert mod.HOST_FS_RPC_TIMEOUT == 30.0


# Sanity: the imported constant (post any reloads above) is the expected 30.0.
def test_module_constant_imported_is_default() -> None:
    assert HOST_FS_RPC_TIMEOUT == 30.0
