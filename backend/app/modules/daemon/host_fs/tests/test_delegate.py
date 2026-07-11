"""Tests for HostFsDelegate — daemon-client RPC dispatch.

Change ``2026-07-10-remove-server-local-workspace-mode`` dropped the legacy
server-local branch (task-09): every method now forwards over the daemon WS
RPC via :meth:`HostFsDelegate._via_rpc` / :meth:`HostFsDelegate._via_rpc_or_degrade`.
The server-local local-FS test cases (real tempdir, asserts byte-for-byte
behaviour parity with the original scattered logic, D-004) were deleted with
the branch — the local behaviour no longer exists to assert against.

What remains: daemon-client branch coverage. A mock ws_rpc (duck-typed,
satisfies the structural protocol — only ``send_rpc`` consumed) asserts the
call structure (method name + workspace_id + daemon_id + args) rather than any
real RPC result, since the transport is task-02's responsibility. The
real-resolver → ws_hub integration path is covered by
``test_delegate_integration.py`` (no-mock钉死测试).
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest

from app.modules.daemon.host_fs import (
    HostFsDelegate,
    HostFsDelegateUnavailable,
)
from app.modules.workspace.model import Workspace

# ── fixtures ───────────────────────────────────────────────────────────────────────


class _MockWsRpc:
    """Duck-typed HostFsWsRpc stand-in (task-02 not implemented yet).

    Records every send_rpc call and returns a scripted result. Verifies the
    daemon-client branch's call structure without a real transport.
    """

    def __init__(self, result: dict[str, Any] | None = None) -> None:
        self.calls: list[dict[str, Any]] = []
        self._result = result if result is not None else {}

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
        return self._result


# Fixed daemon **instance** id for unit tests (the WS routing key). Injected as
# the daemon_id_resolver so daemon-client call-structure assertions can verify
# routing without a DB session — the real resolver → ws_hub integration path is
# covered by test_delegate_integration.py (no-mock钉死测试). Note this is the
# INSTANCE id, deliberately distinct from any historical daemon_runtime_id the
# workspace fixture used to carry, so a regression that routes on runtime_id
# would fail loudly.
_INSTANCE_ID = uuid4()


async def _fake_daemon_id_resolver(session: Any, workspace_id: Any) -> Any:
    return _INSTANCE_ID


async def _null_daemon_id_resolver(session: Any, workspace_id: Any) -> Any:
    return None


def _make_workspace(*, root_path: str = "") -> Workspace:
    """Construct a Workspace instance for unit tests (no DB persistence).

    Uses the normal SQLModel constructor (the previous ``__new__`` shortcut
    skipped pydantic init and broke ``__getattr__`` resolution).

    Note: ``path_source`` / ``daemon_runtime_id`` were removed from the
    Workspace model in change ``2026-07-10-remove-server-local-workspace-mode``
    task-01 — the delegate now keys purely on ``workspace.id`` for RPC routing.
    """
    ws_id = uuid4()
    return Workspace(
        id=ws_id,
        name=f"test-ws-{ws_id.hex[:8]}",
        slug=f"test-ws-{ws_id.hex[:8]}",
        root_path=root_path,
        status="active",
    )


@pytest.fixture
def daemon_client_workspace() -> Workspace:
    return _make_workspace(root_path="/host/path/that/backend/cannot/see")


@pytest.fixture
def delegate_no_rpc() -> HostFsDelegate:
    """Delegate with ws_rpc=None — daemon-client branch must raise."""
    return HostFsDelegate(session=None, ws_hub=None, ws_rpc=None)


def _make_delegate_with_rpc(
    result: dict[str, Any] | None = None,
) -> tuple[HostFsDelegate, _MockWsRpc]:
    rpc = _MockWsRpc(result=result)
    delegate = HostFsDelegate(
        session=None,
        ws_hub=None,
        ws_rpc=rpc,
        daemon_id_resolver=_fake_daemon_id_resolver,
    )
    return delegate, rpc


# ── 1. stat ─────────────────────────────────────────────────────────────────────────


class TestStat:
    async def test_daemon_client_calls_send_rpc(self, daemon_client_workspace):
        delegate, rpc = _make_delegate_with_rpc(
            result={"exists": True, "is_dir": False, "size": 42}
        )
        out = await delegate.stat(daemon_client_workspace, "/host/a.txt")
        assert out == {"exists": True, "is_dir": False, "size": 42}
        assert len(rpc.calls) == 1
        call = rpc.calls[0]
        assert call["method"] == "stat"
        assert call["workspace_id"] == str(daemon_client_workspace.id)
        # daemon_id 必须是解析出的 daemon_instances.id（WS 路由键），而非
        # 历史 workspace.daemon_runtime_id（daemon_runtimes.id）——后者会导致 RPC 找不到
        # 连接（钉死 runtime_id vs instance_id 回归，见 test_delegate_integration）。
        assert call["daemon_id"] == str(_INSTANCE_ID)
        assert call["args"] == {"path": "/host/a.txt"}

    async def test_daemon_client_no_rpc_raises(self, daemon_client_workspace):
        delegate = HostFsDelegate(session=None, ws_hub=None, ws_rpc=None)
        with pytest.raises(HostFsDelegateUnavailable):
            await delegate.stat(daemon_client_workspace, "/host/a.txt")


# ── 2. read_file ────────────────────────────────────────────────────────────────────


class TestReadFile:
    async def test_daemon_client_calls_send_rpc(self, daemon_client_workspace):
        delegate, rpc = _make_delegate_with_rpc(result={"content": "remote bytes"})
        out = await delegate.read_file(daemon_client_workspace, "/host/x.txt")
        assert out == "remote bytes"
        assert rpc.calls[0]["method"] == "read_file"
        assert rpc.calls[0]["args"] == {"path": "/host/x.txt"}

    async def test_daemon_client_no_rpc_raises(self, daemon_client_workspace):
        delegate = HostFsDelegate(session=None, ws_hub=None, ws_rpc=None)
        with pytest.raises(HostFsDelegateUnavailable):
            await delegate.read_file(daemon_client_workspace, "/host/x.txt")


# ── 3. list_dir ─────────────────────────────────────────────────────────────────────


class TestListDir:
    async def test_daemon_client_calls_send_rpc(self, daemon_client_workspace):
        delegate, rpc = _make_delegate_with_rpc(result={"entries": ["a", "b", "c"]})
        out = await delegate.list_dir(daemon_client_workspace, "/host/dir")
        assert out == ["a", "b", "c"]
        assert rpc.calls[0]["method"] == "list_dir"
        assert rpc.calls[0]["args"] == {"path": "/host/dir"}


# ── 4. git_apply ────────────────────────────────────────────────────────────────────


class TestGitApply:
    async def test_daemon_client_calls_send_rpc(self, daemon_client_workspace):
        delegate, rpc = _make_delegate_with_rpc(result={"ok": True, "conflict_detail": None})
        out = await delegate.git_apply(daemon_client_workspace, "PATCH", use_3way=True)
        assert out == {"ok": True, "conflict_detail": None}
        assert rpc.calls[0]["method"] == "git_apply"
        # args 必须含 workdir（= workspace.root_path，daemon handler 据此在宿主 git apply）
        # —— 钉死 args 契约回归（e2e 2026-07-07 暴露）。
        assert rpc.calls[0]["args"] == {
            "workdir": daemon_client_workspace.root_path,
            "patch_data": "PATCH",
            "use_3way": True,
        }


# ── 5. git_rev_parse ────────────────────────────────────────────────────────────────


class TestGitRevParse:
    async def test_daemon_client_calls_send_rpc(self, daemon_client_workspace):
        delegate, rpc = _make_delegate_with_rpc(result={"commit": "abc123def456"})
        out = await delegate.git_rev_parse(daemon_client_workspace, "HEAD")
        assert out == "abc123def456"
        assert rpc.calls[0]["method"] == "git_rev_parse"
        # args 含 root（= workspace.root_path）+ ref —— daemon handler runGitRevParse(root, ref)。
        assert rpc.calls[0]["args"] == {
            "root": daemon_client_workspace.root_path,
            "ref": "HEAD",
        }

    async def test_daemon_client_returns_none_when_no_commit(self, daemon_client_workspace):
        delegate, _ = _make_delegate_with_rpc(result={})
        out = await delegate.git_rev_parse(daemon_client_workspace, "HEAD")
        assert out is None


# ── 6. pollution_archive ────────────────────────────────────────────────────────────


class TestPollutionArchive:
    async def test_daemon_client_calls_send_rpc(self, daemon_client_workspace):
        delegate, rpc = _make_delegate_with_rpc(
            result={"archived": True, "detail": {"file_count": 3}}
        )
        out = await delegate.pollution_archive(daemon_client_workspace, "/host/src")
        assert out == {"archived": True, "detail": {"file_count": 3}}
        assert rpc.calls[0]["method"] == "pollution_archive"
        assert rpc.calls[0]["args"] == {"source_root": "/host/src"}


# ── 7. read_package_json ────────────────────────────────────────────────────────────


class TestReadPackageJson:
    async def test_daemon_client_calls_send_rpc(self, daemon_client_workspace):
        delegate, rpc = _make_delegate_with_rpc(result={"data": {"name": "remote"}})
        out = await delegate.read_package_json(daemon_client_workspace)
        assert out == {"name": "remote"}
        assert rpc.calls[0]["method"] == "read_package_json"
        assert rpc.calls[0]["args"] == {"root": daemon_client_workspace.root_path}


# ── 8. read_local_yaml ──────────────────────────────────────────────────────────────


class TestReadLocalYaml:
    async def test_daemon_client_calls_send_rpc(self, daemon_client_workspace):
        delegate, rpc = _make_delegate_with_rpc(result={"data": {"build": "remote build"}})
        out = await delegate.read_local_yaml(daemon_client_workspace)
        assert out == {"build": "remote build"}
        assert rpc.calls[0]["method"] == "read_local_yaml"
        assert rpc.calls[0]["args"] == {"root": daemon_client_workspace.root_path}


# ── daemon_id resolution edge cases ─────────────────────────────────────────────────


class TestDaemonIdResolution:
    async def test_daemon_client_null_daemon_id_raises(self):
        # resolver 返回 None（workspace 既无 member binding 又无 legacy runtime→instance
        # 解析结果）= genuinely unbound → _via_rpc 必须抛 HostFsDelegateUnavailable。
        ws = _make_workspace()
        delegate = HostFsDelegate(
            session=None,
            ws_hub=None,
            ws_rpc=_MockWsRpc(),
            daemon_id_resolver=_null_daemon_id_resolver,
        )
        with pytest.raises(HostFsDelegateUnavailable) as exc:
            await delegate.stat(ws, "/host/x")
        assert "no bound daemon" in str(exc.value)
