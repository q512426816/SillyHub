"""Tests for ``HostFsDelegate.probe_workspace_git_mode`` — 三态 git 模式探测.

Change ``2026-08-24-session-team-mission-context`` task-02（FR-04 / D-006@v2 /
design §5.D）：dispatch_worker 分流（task-05）、mission_status（task-03）与
probe 端点（task-10）共用的统一 git 模式判定口径。

探测必须走**非降级** RPC 通道（:meth:`HostFsDelegate._via_rpc` —— 走
:meth:`HostFsDelegate._via_rpc_or_degrade` 会把 transport 故障静默降级成
``exists=False``，把故障工作区误判 direct），对
``resolve_root_path_for_daemon(ws.root_path) + "/.git"`` 绝对路径发
``host_fs.stat``（daemon 侧 assertWithinAllowedRoots 先于 pathResolve，
相对路径必被拒，CC-06 / R-05）：

- daemon 真答 ``exists=True`` → ``git``（.git 目录或文件均可——worktree
  检出的 .git 是文件，lstat 语义仍可见）。
- daemon 真答 ``exists=False`` → ``direct``。
- transport 异常（``_RPC_DEGRADED_EXC`` 四成员）与
  :class:`HostFsDelegateUnavailable`（ws_rpc 未接线 / daemon 未绑）一律归
  ``unknown`` 且不向 caller 抛——``unknown`` 只报状态不决策。

Mock 模式仿 ``test_delegate.py`` 的 ``_MockWsRpc``（脚本化 send_rpc + 调用
记录）；settings 前缀改写用 singleton 属性 monkeypatch（先例：
``runtime/tests/test_live_service.py`` / ``daemon/tests/test_lease_service.py``）。
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest

from app.modules.daemon.host_fs import HostFsDelegate
from app.modules.daemon.service import DaemonRpcTimeout
from app.modules.workspace.model import Workspace

# ── fixtures（仿 test_delegate.py）──────────────────────────────────────────────


class _MockWsRpc:
    """Duck-typed HostFsWsRpc stand-in — 脚本化 send_rpc + 调用记录.

    签名刻意不带 ``timeout`` 参数：探测走默认 30s 传输预算（任务卡约束），
    若实现误透传自定义 timeout，本 mock 会 TypeError 直接红。
    """

    def __init__(
        self,
        result: dict[str, Any] | None = None,
        exc: Exception | None = None,
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


# 固定 daemon **instance** id（WS 路由键）——与 test_delegate.py 同款注入，
# 免 DB 断言调用结构；真实 resolver → ws_hub 集成路径归
# test_delegate_integration.py。
_INSTANCE_ID = uuid4()


async def _fake_daemon_id_resolver(session: Any, workspace_id: Any) -> Any:
    return _INSTANCE_ID


async def _null_daemon_id_resolver(session: Any, workspace_id: Any) -> Any:
    return None


def _make_workspace(*, root_path: str = "") -> Workspace:
    """Construct a Workspace instance for unit tests (no DB persistence)."""
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
    exc: Exception | None = None,
) -> tuple[HostFsDelegate, _MockWsRpc]:
    rpc = _MockWsRpc(result=result, exc=exc)
    delegate = HostFsDelegate(
        session=None,
        ws_hub=None,
        ws_rpc=rpc,
        daemon_id_resolver=_fake_daemon_id_resolver,
    )
    return delegate, rpc


# ── 1. 三态映射：daemon 真答 ────────────────────────────────────────────────────


class TestProbeTriState:
    async def test_exists_true_dir_returns_git(self, daemon_client_workspace):
        delegate, rpc = _make_delegate_with_rpc(result={"exists": True, "is_dir": True, "size": 0})
        out = await delegate.probe_workspace_git_mode(daemon_client_workspace)
        assert out == "git"
        assert len(rpc.calls) == 1
        call = rpc.calls[0]
        assert call["method"] == "stat"
        assert call["workspace_id"] == str(daemon_client_workspace.id)
        # daemon_id 必须是解析出的 daemon_instances.id（WS 路由键）。
        assert call["daemon_id"] == str(_INSTANCE_ID)
        # stat path 必须为 root 下 .git 绝对路径（未配置前缀 → 原样拼接）。
        assert call["args"] == {"path": daemon_client_workspace.root_path + "/.git"}

    async def test_exists_true_git_file_returns_git(self, daemon_client_workspace):
        # worktree 检出：.git 是文件而非目录——exists=True 仍判 git
        # （design §5.D：lstat 语义可用，不区分目录/文件）。
        delegate, _ = _make_delegate_with_rpc(result={"exists": True, "is_dir": False, "size": 15})
        out = await delegate.probe_workspace_git_mode(daemon_client_workspace)
        assert out == "git"

    async def test_exists_false_returns_direct(self, daemon_client_workspace):
        delegate, _ = _make_delegate_with_rpc(result={"exists": False, "is_dir": False, "size": 0})
        out = await delegate.probe_workspace_git_mode(daemon_client_workspace)
        assert out == "direct"

    async def test_missing_exists_key_returns_unknown(self, daemon_client_workspace):
        # daemon 答非约定形状（缺 exists 键）——按不可判定归 unknown，
        # 绝不猜测成 direct（unknown 只报状态不决策）。
        delegate, _ = _make_delegate_with_rpc(result={})
        out = await delegate.probe_workspace_git_mode(daemon_client_workspace)
        assert out == "unknown"


# ── 2. 探测不可判定：异常/未接线/未绑 → unknown 且不抛 ──────────────────────────


class TestProbeUnavailable:
    async def test_rpc_timeout_returns_unknown(self, daemon_client_workspace):
        # transport 异常（至少覆盖 DaemonRpcTimeout）→ unknown，不向 caller 抛
        # （走 _via_rpc 非降级通道，异常在本方法内捕获）。
        delegate, rpc = _make_delegate_with_rpc(exc=DaemonRpcTimeout("rpc timed out"))
        out = await delegate.probe_workspace_git_mode(daemon_client_workspace)
        assert out == "unknown"
        # 确实发起过一次探测（异常来自 send_rpc，而非前置短路）。
        assert len(rpc.calls) == 1
        assert rpc.calls[0]["method"] == "stat"

    async def test_ws_rpc_not_wired_returns_unknown(self, daemon_client_workspace):
        # HostFsDelegateUnavailable 路一：ws_rpc=None（task-02 未接线）。
        delegate = HostFsDelegate(session=None, ws_hub=None, ws_rpc=None)
        out = await delegate.probe_workspace_git_mode(daemon_client_workspace)
        assert out == "unknown"

    async def test_daemon_unbound_returns_unknown(self):
        # HostFsDelegateUnavailable 路二：daemon_id_resolver 返回 None
        # （workspace 无 member binding → genuinely unbound）。
        ws = _make_workspace(root_path="/host/proj")
        delegate = HostFsDelegate(
            session=None,
            ws_hub=None,
            ws_rpc=_MockWsRpc(),
            daemon_id_resolver=_null_daemon_id_resolver,
        )
        out = await delegate.probe_workspace_git_mode(ws)
        assert out == "unknown"


# ── 3. stat path 必须为 resolve_root_path_for_daemon 改写后的绝对路径 ───────────


class TestProbeAbsolutePath:
    async def test_path_rewritten_with_prefix_config(self, monkeypatch, daemon_client_workspace):
        # 容器→宿主前缀配置生效：root_path 命中容器前缀 → 下发宿主绝对路径
        # （settings 单例属性 patch 对齐 test_live_service.py 既有先例）。
        from app.core.config import get_settings

        settings = get_settings()
        monkeypatch.setattr(settings, "container_path_prefix", "/host-projects")
        monkeypatch.setattr(settings, "host_path_prefix", "C:/Users/qinyi/IdeaProjects")

        ws = _make_workspace(root_path="/host-projects/my-repo")
        delegate, rpc = _make_delegate_with_rpc(result={"exists": True, "is_dir": True, "size": 0})
        out = await delegate.probe_workspace_git_mode(ws)
        assert out == "git"
        assert rpc.calls[0]["args"] == {"path": "C:/Users/qinyi/IdeaProjects/my-repo/.git"}

    async def test_path_passthrough_without_prefix_config(self, monkeypatch):
        # 未配置前缀（裸机部署，容器=宿主机）→ root_path 原样拼接 /.git。
        # 显式 patch 成空串保证确定性（不依赖运行环境 env 是否设前缀）。
        from app.core.config import get_settings

        settings = get_settings()
        monkeypatch.setattr(settings, "container_path_prefix", "")
        monkeypatch.setattr(settings, "host_path_prefix", "")

        ws = _make_workspace(root_path="/srv/proj")
        delegate, rpc = _make_delegate_with_rpc(
            result={"exists": False, "is_dir": False, "size": 0}
        )
        out = await delegate.probe_workspace_git_mode(ws)
        assert out == "direct"
        assert rpc.calls[0]["args"] == {"path": "/srv/proj/.git"}
