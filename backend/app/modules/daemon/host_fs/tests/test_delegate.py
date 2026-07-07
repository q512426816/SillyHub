"""Tests for HostFsDelegate — double-path × eight-method coverage.

server-local branch: real local tempdir, asserts byte-for-byte behavior parity
with the original scattered logic (NFR-02 zero-regression, D-004).

daemon-client branch: mock ws_rpc (duck-typed, satisfies the structural
protocol — only ``send_rpc`` consumed). Asserts the call structure (method
name + workspace_id + daemon_id + args) rather than any real RPC result,
since the transport is task-02's responsibility.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from uuid import uuid4

import pytest
import yaml

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
# INSTANCE id, deliberately distinct from any daemon_runtime_id the workspace
# fixture carries, so a regression that routes on runtime_id would fail loudly.
_INSTANCE_ID = uuid4()


async def _fake_daemon_id_resolver(session: Any, workspace_id: Any) -> Any:
    return _INSTANCE_ID


async def _null_daemon_id_resolver(session: Any, workspace_id: Any) -> Any:
    return None


def _make_workspace(
    *,
    path_source: str = "server-local",
    root_path: str = "",
    daemon_runtime_id: Any = None,
) -> Workspace:
    """Construct a Workspace instance for unit tests (no DB persistence).

    Uses the normal SQLModel constructor (the previous ``__new__`` shortcut
    skipped pydantic init and broke ``__getattr__`` resolution).
    """
    ws_id = uuid4()
    return Workspace(
        id=ws_id,
        name=f"test-ws-{ws_id.hex[:8]}",
        slug=f"test-ws-{ws_id.hex[:8]}",
        root_path=root_path,
        path_source=path_source,
        daemon_runtime_id=daemon_runtime_id,
        status="active",
    )


@pytest.fixture
def server_local_workspace(tmp_path: Path) -> Workspace:
    return _make_workspace(
        path_source="server-local",
        root_path=str(tmp_path),
        daemon_runtime_id=None,
    )


@pytest.fixture
def daemon_client_workspace() -> Workspace:
    return _make_workspace(
        path_source="daemon-client",
        root_path="/host/path/that/backend/cannot/see",
        daemon_runtime_id=uuid4(),
    )


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
    async def test_server_local_file(self, delegate_no_rpc, server_local_workspace, tmp_path):
        f = tmp_path / "a.txt"
        f.write_text("hello", encoding="utf-8")
        result = await delegate_no_rpc.stat(server_local_workspace, str(f))
        assert result == {"exists": True, "is_dir": False, "size": 5}

    async def test_server_local_dir(self, delegate_no_rpc, server_local_workspace, tmp_path):
        d = tmp_path / "sub"
        d.mkdir()
        result = await delegate_no_rpc.stat(server_local_workspace, str(d))
        assert result == {"exists": True, "is_dir": True, "size": 0}

    async def test_server_local_missing(self, delegate_no_rpc, server_local_workspace, tmp_path):
        result = await delegate_no_rpc.stat(server_local_workspace, str(tmp_path / "nope.txt"))
        assert result == {"exists": False, "is_dir": False, "size": 0}

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
        # workspace.daemon_runtime_id（daemon_runtimes.id）——后者会导致 RPC 找不到
        # 连接（钉死 runtime_id vs instance_id 回归，见 test_delegate_integration）。
        assert call["daemon_id"] == str(_INSTANCE_ID)
        assert call["daemon_id"] != str(daemon_client_workspace.daemon_runtime_id)
        assert call["args"] == {"path": "/host/a.txt"}

    async def test_daemon_client_no_rpc_raises(self, daemon_client_workspace):
        delegate = HostFsDelegate(session=None, ws_hub=None, ws_rpc=None)
        with pytest.raises(HostFsDelegateUnavailable):
            await delegate.stat(daemon_client_workspace, "/host/a.txt")


# ── 2. read_file ────────────────────────────────────────────────────────────────────


class TestReadFile:
    async def test_server_local(self, delegate_no_rpc, server_local_workspace, tmp_path):
        f = tmp_path / "x.txt"
        f.write_text("contents", encoding="utf-8")
        out = await delegate_no_rpc.read_file(server_local_workspace, str(f))
        assert out == "contents"

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
    async def test_server_local(self, delegate_no_rpc, server_local_workspace, tmp_path):
        (tmp_path / "b").mkdir()
        (tmp_path / "a").write_text("x", encoding="utf-8")
        out = await delegate_no_rpc.list_dir(server_local_workspace, str(tmp_path))
        assert out == ["a", "b"]  # sorted

    async def test_server_local_not_dir(self, delegate_no_rpc, server_local_workspace, tmp_path):
        f = tmp_path / "file.txt"
        f.write_text("x", encoding="utf-8")
        out = await delegate_no_rpc.list_dir(server_local_workspace, str(f))
        assert out == []

    async def test_daemon_client_calls_send_rpc(self, daemon_client_workspace):
        delegate, rpc = _make_delegate_with_rpc(result={"entries": ["a", "b", "c"]})
        out = await delegate.list_dir(daemon_client_workspace, "/host/dir")
        assert out == ["a", "b", "c"]
        assert rpc.calls[0]["method"] == "list_dir"
        assert rpc.calls[0]["args"] == {"path": "/host/dir"}


# ── 4. git_apply ────────────────────────────────────────────────────────────────────


def _init_git_repo(root: Path) -> None:
    """Create a real git repo with one committed file so patches can apply."""
    import os
    import subprocess

    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "t",
        "GIT_AUTHOR_EMAIL": "t@t",
        "GIT_COMMITTER_NAME": "t",
        "GIT_COMMITTER_EMAIL": "t@t",
    }
    subprocess.run(["git", "init"], cwd=str(root), check=True, capture_output=True, env=env)
    subprocess.run(
        ["git", "config", "user.email", "t@t"], cwd=str(root), check=True, capture_output=True
    )
    subprocess.run(
        ["git", "config", "user.name", "t"], cwd=str(root), check=True, capture_output=True
    )
    (root / "file.txt").write_text("line1\n", encoding="utf-8")
    subprocess.run(["git", "add", "file.txt"], cwd=str(root), check=True, capture_output=True)
    subprocess.run(
        ["git", "commit", "-m", "init"], cwd=str(root), check=True, capture_output=True, env=env
    )


class TestGitApply:
    async def test_server_local_applies_clean(
        self, delegate_no_rpc, server_local_workspace, tmp_path
    ):
        _init_git_repo(tmp_path)
        # Add a new file — clean apply, no conflict path.
        patch = (
            "diff --git a/new.txt b/new.txt\n"
            "new file mode 100644\n"
            "index 0000000..0123456\n"
            "--- /dev/null\n"
            "+++ b/new.txt\n"
            "@@ -0,0 +1 @@\n"
            "+added\n"
        )
        out = await delegate_no_rpc.git_apply(server_local_workspace, patch, use_3way=False)
        assert out == {"ok": True, "conflict_detail": None}
        assert (tmp_path / "new.txt").read_text(encoding="utf-8") == "added\n"

    async def test_server_local_conflict(self, delegate_no_rpc, server_local_workspace, tmp_path):
        _init_git_repo(tmp_path)
        # Modify file.txt with a context line that does not exist → check fails,
        # use_3way=False → structured failure (not raise).
        patch = (
            "diff --git a/file.txt b/file.txt\n"
            "index e69de29..0123456 100644\n"
            "--- a/file.txt\n"
            "+++ b/file.txt\n"
            "@@ -1 +1 @@\n"
            "-this-line-does-not-exist\n"
            "+replacement\n"
        )
        out = await delegate_no_rpc.git_apply(server_local_workspace, patch, use_3way=False)
        assert out["ok"] is False
        assert out["conflict_detail"]

    async def test_daemon_client_calls_send_rpc(self, daemon_client_workspace):
        delegate, rpc = _make_delegate_with_rpc(result={"ok": True, "conflict_detail": None})
        out = await delegate.git_apply(daemon_client_workspace, "PATCH", use_3way=True)
        assert out == {"ok": True, "conflict_detail": None}
        assert rpc.calls[0]["method"] == "git_apply"
        assert rpc.calls[0]["args"] == {"patch_data": "PATCH", "use_3way": True}


# ── 5. git_rev_parse ────────────────────────────────────────────────────────────────


class TestGitRevParse:
    async def test_server_local_git_repo(self, delegate_no_rpc, server_local_workspace, tmp_path):
        _init_git_repo(tmp_path)
        out = await delegate_no_rpc.git_rev_parse(server_local_workspace, "HEAD")
        assert isinstance(out, str)
        assert len(out) == 40  # SHA-1 hex

    async def test_server_local_not_git(self, delegate_no_rpc, server_local_workspace, tmp_path):
        out = await delegate_no_rpc.git_rev_parse(server_local_workspace, "HEAD")
        assert out is None

    async def test_daemon_client_calls_send_rpc(self, daemon_client_workspace):
        delegate, rpc = _make_delegate_with_rpc(result={"commit": "abc123def456"})
        out = await delegate.git_rev_parse(daemon_client_workspace, "HEAD")
        assert out == "abc123def456"
        assert rpc.calls[0]["method"] == "git_rev_parse"
        assert rpc.calls[0]["args"] == {"ref": "HEAD"}

    async def test_daemon_client_returns_none_when_no_commit(self, daemon_client_workspace):
        delegate, _ = _make_delegate_with_rpc(result={})
        out = await delegate.git_rev_parse(daemon_client_workspace, "HEAD")
        assert out is None


# ── 6. pollution_archive ────────────────────────────────────────────────────────────


class TestPollutionArchive:
    async def test_server_local_no_pollution(
        self, delegate_no_rpc, server_local_workspace, tmp_path
    ):
        out = await delegate_no_rpc.pollution_archive(server_local_workspace, str(tmp_path))
        assert out == {"archived": False, "detail": None}

    async def test_server_local_archives_pollution(
        self, delegate_no_rpc, server_local_workspace, tmp_path
    ):
        sillyspec = tmp_path / ".sillyspec"
        sillyspec.mkdir()
        (sillyspec / "docs").mkdir()
        (sillyspec / "docs" / "x.md").write_text("polluted", encoding="utf-8")
        out = await delegate_no_rpc.pollution_archive(server_local_workspace, str(tmp_path))
        assert out["archived"] is True
        assert out["detail"]["file_count"] == 1
        # Source .sillyspec moved out
        assert not sillyspec.exists()
        # Archive exists with the moved tree
        archives = list(tmp_path.glob(".pollution-archive-*"))
        assert len(archives) == 1
        assert (archives[0] / ".sillyspec" / "docs" / "x.md").exists()

    async def test_server_local_empty_sillyspec_not_archived(
        self, delegate_no_rpc, server_local_workspace, tmp_path
    ):
        (tmp_path / ".sillyspec").mkdir()
        out = await delegate_no_rpc.pollution_archive(server_local_workspace, str(tmp_path))
        assert out == {"archived": False, "detail": None}

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
    async def test_server_local_present(self, delegate_no_rpc, server_local_workspace, tmp_path):
        pkg = {"name": "demo", "scripts": {"build": "tsc"}}
        (tmp_path / "package.json").write_text(json.dumps(pkg), encoding="utf-8")
        out = await delegate_no_rpc.read_package_json(server_local_workspace)
        assert out == pkg

    async def test_server_local_absent(self, delegate_no_rpc, server_local_workspace, tmp_path):
        out = await delegate_no_rpc.read_package_json(server_local_workspace)
        assert out is None

    async def test_server_local_invalid(self, delegate_no_rpc, server_local_workspace, tmp_path):
        (tmp_path / "package.json").write_text("{not json", encoding="utf-8")
        out = await delegate_no_rpc.read_package_json(server_local_workspace)
        assert out is None

    async def test_daemon_client_calls_send_rpc(self, daemon_client_workspace):
        delegate, rpc = _make_delegate_with_rpc(result={"data": {"name": "remote"}})
        out = await delegate.read_package_json(daemon_client_workspace)
        assert out == {"name": "remote"}
        assert rpc.calls[0]["method"] == "read_package_json"
        assert rpc.calls[0]["args"] == {}


# ── 8. read_local_yaml ──────────────────────────────────────────────────────────────


class TestReadLocalYaml:
    async def test_server_local_present(self, delegate_no_rpc, server_local_workspace, tmp_path):
        sillyspec = tmp_path / ".sillyspec"
        sillyspec.mkdir()
        config = {"build": "npm run build", "test": "npm test"}
        (sillyspec / "local.yaml").write_text(yaml.safe_dump(config), encoding="utf-8")
        out = await delegate_no_rpc.read_local_yaml(server_local_workspace)
        assert out == config

    async def test_server_local_absent(self, delegate_no_rpc, server_local_workspace, tmp_path):
        out = await delegate_no_rpc.read_local_yaml(server_local_workspace)
        assert out is None

    async def test_server_local_invalid(self, delegate_no_rpc, server_local_workspace, tmp_path):
        sillyspec = tmp_path / ".sillyspec"
        sillyspec.mkdir()
        (sillyspec / "local.yaml").write_text(": not: valid: yaml: [", encoding="utf-8")
        out = await delegate_no_rpc.read_local_yaml(server_local_workspace)
        assert out is None

    async def test_daemon_client_calls_send_rpc(self, daemon_client_workspace):
        delegate, rpc = _make_delegate_with_rpc(result={"data": {"build": "remote build"}})
        out = await delegate.read_local_yaml(daemon_client_workspace)
        assert out == {"build": "remote build"}
        assert rpc.calls[0]["method"] == "read_local_yaml"
        assert rpc.calls[0]["args"] == {}


# ── daemon_id resolution edge cases ─────────────────────────────────────────────────


class TestDaemonIdResolution:
    async def test_daemon_client_null_daemon_id_raises(self):
        # resolver 返回 None（workspace 既无 member binding 又无 legacy runtime→instance
        # 解析结果）= genuinely unbound → _via_rpc 必须抛 HostFsDelegateUnavailable。
        ws = _make_workspace(path_source="daemon-client", daemon_runtime_id=None)
        delegate = HostFsDelegate(
            session=None,
            ws_hub=None,
            ws_rpc=_MockWsRpc(),
            daemon_id_resolver=_null_daemon_id_resolver,
        )
        with pytest.raises(HostFsDelegateUnavailable) as exc:
            await delegate.stat(ws, "/host/x")
        assert "no bound daemon" in str(exc.value)
