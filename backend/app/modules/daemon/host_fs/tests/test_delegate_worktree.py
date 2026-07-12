"""Tests for HostFsDelegate worktree/merge/remove methods (task-01).

Change ``2026-07-12-worker-worktree-isolation`` adds three HostFsDelegate
methods that the worker-isolation flow needs:

* :meth:`HostFsDelegate.git_worktree_add` — dispatch_worker 创建 per-worker
  sibling worktree（D-001@v1）。
* :meth:`HostFsDelegate.git_merge` — finalizer 把 worker 分支合并回
  workspace root（D-003@v1 方案A）。
* :meth:`HostFsDelegate.git_worktree_remove` — 合并成功后清理 worker 副本
  （D-006@v1 轻量路径）。

三方法都仿 :meth:`HostFsDelegate.git_apply` 走
:meth:`HostFsDelegate._via_rpc_or_degrade`（method 用裸名，``host_fs.`` 前缀
在 daemon WS 路由层加）—— daemon 离线/超时降级返回 dict，不崩调用方
（D-006 warn-and-degrade）。

测试模式对齐 ``test_delegate.py``：duck-typed ``_MockWsRpc`` 钉死 call
structure（method + workspace_id + daemon_id + args）+ 覆盖 ok / error /
conflict（仅 git_merge）/ degraded 四返回路径。
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest

from app.modules.daemon.host_fs import (
    HostFsDelegate,
    HostFsDelegateUnavailable,
)
from app.modules.daemon.runtime.service import DaemonRuntimeOffline
from app.modules.workspace.model import Workspace

# ── fixtures（对齐 test_delegate.py，便于未来合并） ────────────────────────────────


class _MockWsRpc:
    """Duck-typed HostFsWsRpc stand-in（task-02 未实装前的钉死 mock）。

    记录每次 ``send_rpc`` 调用，按 script 返回结果或抛预设异常（用于
    degraded 路径：抛 :class:`DaemonRuntimeOffline` 触发 D-006 降级）。
    """

    def __init__(
        self,
        result: dict[str, Any] | None = None,
        exc: BaseException | None = None,
    ) -> None:
        self.calls: list[dict[str, Any]] = []
        self._result = result if result is not None else {}
        self._exc = exc

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
        if self._exc is not None:
            raise self._exc
        return self._result


_INSTANCE_ID = uuid4()


async def _fake_daemon_id_resolver(session: Any, workspace_id: Any) -> Any:
    return _INSTANCE_ID


def _make_workspace(*, root_path: str = "") -> Workspace:
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


def _make_delegate_with_rpc(
    result: dict[str, Any] | None = None,
    exc: BaseException | None = None,
) -> tuple[HostFsDelegate, _MockWsRpc]:
    rpc = _MockWsRpc(result=result, exc=exc)
    delegate = HostFsDelegate(
        session=None,
        ws_hub=None,
        ws_rpc=rpc,
        daemon_id_resolver=_fake_daemon_id_resolver,
    )
    return delegate, rpc


# ── git_worktree_add ──────────────────────────────────────────────────────────────


class TestGitWorktreeAdd:
    async def test_ok_returns_daemon_payload_and_routes_call(self, daemon_client_workspace):
        delegate, rpc = _make_delegate_with_rpc(
            result={
                "ok": True,
                "worktree_path": "/host/ws-workers/abc12345",
                "error": None,
            }
        )
        out = await delegate.git_worktree_add(
            daemon_client_workspace,
            sibling_path="/host/ws-workers/abc12345",
            branch="workers/abc12345",
            base_ref="main",
        )
        assert out == {
            "ok": True,
            "worktree_path": "/host/ws-workers/abc12345",
            "error": None,
        }
        # method 用裸名（host_fs. 前缀在 daemon WS 路由层加），对齐 git_apply。
        assert len(rpc.calls) == 1
        call = rpc.calls[0]
        assert call["method"] == "git_worktree_add"
        assert call["workspace_id"] == str(daemon_client_workspace.id)
        assert call["daemon_id"] == str(_INSTANCE_ID)
        # args 必须含 workdir（= workspace.root_path）+ sibling_path + branch + base_ref
        # —— daemon handler 据此跑 `git -C <workdir> worktree add <sibling> -b <branch> <base>`。
        assert call["args"] == {
            "workdir": daemon_client_workspace.root_path,
            "sibling_path": "/host/ws-workers/abc12345",
            "branch": "workers/abc12345",
            "base_ref": "main",
        }

    async def test_error_propagates_daemon_ok_false(self, daemon_client_workspace):
        delegate, _ = _make_delegate_with_rpc(
            result={"ok": False, "worktree_path": None, "error": "branch exists"}
        )
        out = await delegate.git_worktree_add(
            daemon_client_workspace,
            sibling_path="/host/ws-workers/abc12345",
            branch="workers/abc12345",
            base_ref="main",
        )
        assert out == {"ok": False, "worktree_path": None, "error": "branch exists"}

    async def test_degraded_returns_rpc_unavailable_dict(self, daemon_client_workspace):
        # daemon 离线（send_rpc 抛 DaemonRuntimeOffline）→ D-006 降级返回 dict，
        # 不抛给调用方（dispatch_worker 能继续走兜底）。
        delegate, rpc = _make_delegate_with_rpc(
            exc=DaemonRuntimeOffline("daemon offline"),
        )
        out = await delegate.git_worktree_add(
            daemon_client_workspace,
            sibling_path="/host/ws-workers/abc12345",
            branch="workers/abc12345",
            base_ref="main",
        )
        assert out == {"ok": False, "worktree_path": None, "error": "rpc unavailable"}
        # 仍发起了一次 RPC 尝试（降级发生在抛异常后）。
        assert len(rpc.calls) == 1
        assert rpc.calls[0]["method"] == "git_worktree_add"

    async def test_no_rpc_raises_unavailable(self, daemon_client_workspace):
        # ws_rpc 未装（task-02 未接线）= wiring bug，非传输故障，必须抛。
        delegate = HostFsDelegate(session=None, ws_hub=None, ws_rpc=None)
        with pytest.raises(HostFsDelegateUnavailable):
            await delegate.git_worktree_add(
                daemon_client_workspace,
                sibling_path="/host/ws-workers/abc12345",
                branch="workers/abc12345",
                base_ref="main",
            )


# ── git_merge ─────────────────────────────────────────────────────────────────────


class TestGitMerge:
    async def test_ok_returns_merged_files_and_routes_call(self, daemon_client_workspace):
        delegate, rpc = _make_delegate_with_rpc(
            result={
                "ok": True,
                "conflicts": [],
                "merged_files": ["backend/app/foo.py", "backend/app/bar.py"],
                "error": None,
            }
        )
        out = await delegate.git_merge(daemon_client_workspace, worker_branch="workers/abc12345")
        assert out == {
            "ok": True,
            "conflicts": [],
            "merged_files": ["backend/app/foo.py", "backend/app/bar.py"],
            "error": None,
        }
        assert len(rpc.calls) == 1
        call = rpc.calls[0]
        assert call["method"] == "git_merge"
        assert call["workspace_id"] == str(daemon_client_workspace.id)
        assert call["daemon_id"] == str(_INSTANCE_ID)
        # args 只含 workdir + worker_branch（daemon handler 跑 git merge --no-ff）。
        assert call["args"] == {
            "workdir": daemon_client_workspace.root_path,
            "worker_branch": "workers/abc12345",
        }

    async def test_conflict_returns_conflicts_list_for_llm_resolution(
        self, daemon_client_workspace
    ):
        # 冲突：ok=False + conflicts 非空 → finalizer 喂主 agent LLM 解冲突（D-004@v1）。
        conflicts = [
            {"file": "backend/app/foo.py", "marker_lines": [10, 25]},
            {"file": "backend/app/bar.py", "marker_lines": [3]},
        ]
        delegate, _ = _make_delegate_with_rpc(
            result={
                "ok": False,
                "conflicts": conflicts,
                "merged_files": [],
                "error": "merge conflict",
            }
        )
        out = await delegate.git_merge(daemon_client_workspace, worker_branch="workers/abc12345")
        assert out["ok"] is False
        assert out["conflicts"] == conflicts
        assert out["merged_files"] == []
        assert out["error"] == "merge conflict"

    async def test_degraded_returns_rpc_unavailable_dict(self, daemon_client_workspace):
        delegate, rpc = _make_delegate_with_rpc(
            exc=DaemonRuntimeOffline("daemon offline"),
        )
        out = await delegate.git_merge(daemon_client_workspace, worker_branch="workers/abc12345")
        # 降级：空 conflicts + merged_files（caller 视作失败但结构完整）。
        assert out == {
            "ok": False,
            "conflicts": [],
            "merged_files": [],
            "error": "rpc unavailable",
        }
        assert len(rpc.calls) == 1
        assert rpc.calls[0]["method"] == "git_merge"


# ── git_worktree_remove ───────────────────────────────────────────────────────────


class TestGitWorktreeRemove:
    async def test_ok_returns_daemon_payload_and_routes_call(self, daemon_client_workspace):
        delegate, rpc = _make_delegate_with_rpc(result={"ok": True, "error": None})
        out = await delegate.git_worktree_remove(
            daemon_client_workspace,
            sibling_path="/host/ws-workers/abc12345",
        )
        assert out == {"ok": True, "error": None}
        assert len(rpc.calls) == 1
        call = rpc.calls[0]
        assert call["method"] == "git_worktree_remove"
        assert call["workspace_id"] == str(daemon_client_workspace.id)
        assert call["daemon_id"] == str(_INSTANCE_ID)
        assert call["args"] == {
            "workdir": daemon_client_workspace.root_path,
            "sibling_path": "/host/ws-workers/abc12345",
        }

    async def test_error_propagates_daemon_ok_false(self, daemon_client_workspace):
        delegate, _ = _make_delegate_with_rpc(result={"ok": False, "error": "worktree busy"})
        out = await delegate.git_worktree_remove(
            daemon_client_workspace,
            sibling_path="/host/ws-workers/abc12345",
        )
        assert out == {"ok": False, "error": "worktree busy"}

    async def test_degraded_returns_rpc_unavailable_dict(self, daemon_client_workspace):
        delegate, rpc = _make_delegate_with_rpc(
            exc=DaemonRuntimeOffline("daemon offline"),
        )
        out = await delegate.git_worktree_remove(
            daemon_client_workspace,
            sibling_path="/host/ws-workers/abc12345",
        )
        assert out == {"ok": False, "error": "rpc unavailable"}
        assert len(rpc.calls) == 1
        assert rpc.calls[0]["method"] == "git_worktree_remove"
