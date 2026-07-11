"""Tests for ``HostFsDelegate.run_command`` — the 9th public method (gate path).

Change 2026-07-10-p3-driver-gate-pilot (FR-08 / design §5.3 / R3 命令白名单).

run_command 破 §5.1 锁死契约（design §5.3 授权破例），专供 gate 决策任务在
daemon 侧跑 ``sillyspec gate verify --change <name> --json``。与现有 8 方法
（stat/read_file/.../read_local_yaml）的差异：

* **命令白名单安全层**（R3，新抽象）：方法入口第一步校验 command == "sillyspec"
  且 args 头部匹配 ``["gate", "verify", "--change", <changeName>, "--json"]``
  （允许尾部追加如 ``--stage``）；违例 raise :class:`HostFsDelegateError`。现有 8
  方法靠 daemon 侧 assertWithinAllowedRoots 路径白名单，run_command 跑命令需命令
  白名单拒任意命令注入。
* **fail-loud 不降级**：daemon-client 分支走 ``_via_rpc``（非
  ``_via_rpc_or_degrade``），RPC 异常直接抛给 gate 任务（gate 任务 catch 后置
  gate_status=failed，区别 git_apply 的 D-006 warn-and-degrade）。
* **server-local 分支 raise**：容器够不到源代码（design §5.3）。
* **M5 send_rpc timeout 透传**：run_command 把 timeout 透传给
  ``rpc.send_rpc(timeout=timeout)``；现有 8 方法不传 timeout（None）走默认 30s。

关键回归保护：现有 ``_MockWsRpc.send_rpc`` 签名无 timeout 参数（test_delegate.py
:42），timeout=None 时 ``_via_rpc`` 必须不传 timeout kwarg 才能兼容——这是
M5 向下兼容设计的钉死测试。
"""

from __future__ import annotations

from typing import Any
from uuid import uuid4

import pytest

from app.modules.daemon.host_fs import (
    HostFsDelegate,
    HostFsDelegateError,
)
from app.modules.workspace.model import Workspace

# ── fixtures（复用 test_delegate.py 的 mock 模式，独立文件避免 import 耦合）────


class _MockWsRpc:
    """Duck-typed HostFsWsRpc stand-in（钉死 send_rpc **无 timeout 参数**）。

    刻意不收 timeout kwarg：验证 M5 向下兼容契约——``_via_rpc`` 在 timeout=None
    时**不得**给 send_rpc 传 timeout，否则此 mock 因接受意外 kwarg 而
    TypeError，测试 fail-loud。timeout 非空时单独走 :class:`_MockWsRpcTimeout`
    断言透传。
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


class _MockWsRpcTimeout:
    """收 timeout kwarg 的 mock——专测 run_command 的 timeout 透传。"""

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
        timeout: float | None = None,
    ) -> dict[str, Any]:
        self.calls.append(
            {
                "method": method,
                "workspace_id": workspace_id,
                "daemon_id": daemon_id,
                "args": args,
                "timeout": timeout,
            }
        )
        return self._result


_INSTANCE_ID = uuid4()


async def _fake_daemon_id_resolver(session: Any, workspace_id: Any) -> Any:
    return _INSTANCE_ID


def _make_daemon_client_workspace() -> Workspace:
    ws_id = uuid4()
    return Workspace(
        id=ws_id,
        name=f"gate-ws-{ws_id.hex[:8]}",
        slug=f"gate-ws-{ws_id.hex[:8]}",
        root_path="/host/path/backend/cannot/see",
        status="active",
    )


def _gate_args(change: str, *, extra: list[str] | None = None) -> list[str]:
    """合成合法 gate verify 参数序列（允许尾部追加）。"""
    base = ["gate", "verify", "--change", change, "--json"]
    if extra:
        base.extend(extra)
    return base


# ── 1. 命令白名单安全层（R3，入口校验）──────────────────────────────────────────


class TestWhitelistReject:
    """非 gate 命令 / gate 模板不匹配 → raise HostFsDelegateError。"""

    async def test_reject_arbitrary_command(self):
        # command != "sillyspec" → 拒（防 rm/ls/git 等任意命令注入）
        ws = _make_daemon_client_workspace()
        delegate = HostFsDelegate(
            session=None,
            ws_hub=None,
            ws_rpc=_MockWsRpc(),
            daemon_id_resolver=_fake_daemon_id_resolver,
        )
        with pytest.raises(HostFsDelegateError) as exc:
            await delegate.run_command(
                ws,
                command="rm",
                args=["-rf", "/"],
                cwd=ws.root_path,
                timeout=60.0,
            )
        assert "not whitelisted" in str(exc.value)

    async def test_reject_sillyspec_wrong_subcommand(self):
        # command 对但 args 非 gate verify（sillyspec db reset）→ 拒
        ws = _make_daemon_client_workspace()
        delegate = HostFsDelegate(
            session=None,
            ws_hub=None,
            ws_rpc=_MockWsRpc(),
            daemon_id_resolver=_fake_daemon_id_resolver,
        )
        with pytest.raises(HostFsDelegateError):
            await delegate.run_command(
                ws,
                command="sillyspec",
                args=["db", "reset"],
                cwd=ws.root_path,
                timeout=60.0,
            )

    async def test_reject_sillyspec_gate_without_verify(self):
        # gate 但非 verify（sillyspec gate other）→ 拒
        ws = _make_daemon_client_workspace()
        delegate = HostFsDelegate(
            session=None,
            ws_hub=None,
            ws_rpc=_MockWsRpc(),
            daemon_id_resolver=_fake_daemon_id_resolver,
        )
        with pytest.raises(HostFsDelegateError):
            await delegate.run_command(
                ws,
                command="sillyspec",
                args=["gate", "other", "--change", "foo", "--json"],
                cwd=ws.root_path,
                timeout=60.0,
            )

    async def test_reject_missing_change_flag(self):
        # gate verify --json 缺 --change → 模板不匹配 → 拒
        ws = _make_daemon_client_workspace()
        delegate = HostFsDelegate(
            session=None,
            ws_hub=None,
            ws_rpc=_MockWsRpc(),
            daemon_id_resolver=_fake_daemon_id_resolver,
        )
        with pytest.raises(HostFsDelegateError):
            await delegate.run_command(
                ws,
                command="sillyspec",
                args=["gate", "verify", "--json"],
                cwd=ws.root_path,
                timeout=60.0,
            )

    async def test_reject_missing_json_flag(self):
        # gate verify --change foo 缺 --json → 拒（gate 机器接口契约要求 --json）
        ws = _make_daemon_client_workspace()
        delegate = HostFsDelegate(
            session=None,
            ws_hub=None,
            ws_rpc=_MockWsRpc(),
            daemon_id_resolver=_fake_daemon_id_resolver,
        )
        with pytest.raises(HostFsDelegateError):
            await delegate.run_command(
                ws,
                command="sillyspec",
                args=["gate", "verify", "--change", "foo"],
                cwd=ws.root_path,
                timeout=60.0,
            )

    async def test_reject_injection_after_change(self):
        # --change 后接 shell 注入（; rm -rf）→ 头部匹配但 changeName 含危险字符
        # 白名单只校验结构，不校验 changeName 内容；但 args 尾部追加也仅限
        # 已知 flag。此 case 验证尾部未知 flag 被拒（防 --change foo;rm --json
        # 这类经 cwd/args 之外的注入向量）。
        ws = _make_daemon_client_workspace()
        delegate = HostFsDelegate(
            session=None,
            ws_hub=None,
            ws_rpc=_MockWsRpc(),
            daemon_id_resolver=_fake_daemon_id_resolver,
        )
        # 尾部追加未知 flag（非 --stage 等）→ 拒
        with pytest.raises(HostFsDelegateError):
            await delegate.run_command(
                ws,
                command="sillyspec",
                args=_gate_args("foo", extra=["--eval", "process.exit()"]),
                cwd=ws.root_path,
                timeout=60.0,
            )

    async def test_reject_runs_before_rpc(self):
        # 白名单必须在 RPC 之前拒绝——rpc 不应被调用
        ws = _make_daemon_client_workspace()
        rpc = _MockWsRpc()
        delegate = HostFsDelegate(
            session=None,
            ws_hub=None,
            ws_rpc=rpc,
            daemon_id_resolver=_fake_daemon_id_resolver,
        )
        with pytest.raises(HostFsDelegateError):
            await delegate.run_command(
                ws,
                command="curl",
                args=["http://evil"],
                cwd=ws.root_path,
                timeout=60.0,
            )
        assert rpc.calls == [], "白名单拒必须在 send_rpc 之前"


# ── 2. 合法 gate 模板通过 → 进入 RPC 分支 ────────────────────────────────────────


class TestWhitelistPass:
    """合法 gate 模板 → 进入 RPC 分支。

    注：run_command 必传 timeout（gate 12-min），经 _via_rpc 透传给
    send_rpc(timeout=)。故这些测试用收 timeout 的 :class:`_MockWsRpcTimeout`
    （合法路径）；:class:`_MockWsRpc`（无 timeout 参数）专用于白名单拒绝 +
    零回归钉死（见 TestZeroRegression / TestWhitelistReject）。
    """

    async def test_minimal_gate_template_calls_rpc(self):
        ws = _make_daemon_client_workspace()
        rpc = _MockWsRpcTimeout(
            result={
                "exit_code": 0,
                "stdout": "{}",
                "stderr": "",
                "duration_ms": 1234,
            }
        )
        delegate = HostFsDelegate(
            session=None,
            ws_hub=None,
            ws_rpc=rpc,
            daemon_id_resolver=_fake_daemon_id_resolver,
        )
        out = await delegate.run_command(
            ws,
            command="sillyspec",
            args=_gate_args("my-change"),
            cwd=ws.root_path,
            timeout=720.0,
        )
        assert out["exit_code"] == 0
        assert out["duration_ms"] == 1234
        assert len(rpc.calls) == 1
        call = rpc.calls[0]
        assert call["method"] == "run_command"
        assert call["workspace_id"] == str(ws.id)
        assert call["daemon_id"] == str(_INSTANCE_ID)
        # args 透传全字段
        assert call["args"]["command"] == "sillyspec"
        assert call["args"]["args"] == _gate_args("my-change")
        assert call["args"]["cwd"] == ws.root_path
        assert call["args"]["timeout"] == 720.0

    async def test_gate_template_with_stage_extra(self):
        # 尾部追加 --stage brainstorm 被允许（design §5.3：stage 枚举 + changeName）
        ws = _make_daemon_client_workspace()
        rpc = _MockWsRpcTimeout(
            result={"exit_code": 0, "stdout": "", "stderr": "", "duration_ms": 0}
        )
        delegate = HostFsDelegate(
            session=None,
            ws_hub=None,
            ws_rpc=rpc,
            daemon_id_resolver=_fake_daemon_id_resolver,
        )
        out = await delegate.run_command(
            ws,
            command="sillyspec",
            args=_gate_args("c1", extra=["--stage", "brainstorm"]),
            cwd=ws.root_path,
            timeout=720.0,
        )
        assert out["exit_code"] == 0
        assert rpc.calls[0]["args"]["args"] == _gate_args("c1", extra=["--stage", "brainstorm"])

    async def test_env_passed_through(self):
        # env 透传到 args（gate 任务可注入 SILLYSPEC_* 环境变量）
        ws = _make_daemon_client_workspace()
        rpc = _MockWsRpcTimeout(
            result={"exit_code": 0, "stdout": "", "stderr": "", "duration_ms": 0}
        )
        delegate = HostFsDelegate(
            session=None,
            ws_hub=None,
            ws_rpc=rpc,
            daemon_id_resolver=_fake_daemon_id_resolver,
        )
        await delegate.run_command(
            ws,
            command="sillyspec",
            args=_gate_args("c1"),
            cwd=ws.root_path,
            timeout=720.0,
            env={"SILLYSPEC_DEBUG": "1"},
        )
        assert rpc.calls[0]["args"]["env"] == {"SILLYSPEC_DEBUG": "1"}

    async def test_env_none_omitted(self):
        # env=None → args 仍含 env 键但为 None（契约稳定，daemon handler 决定如何处理）
        ws = _make_daemon_client_workspace()
        rpc = _MockWsRpcTimeout(
            result={"exit_code": 0, "stdout": "", "stderr": "", "duration_ms": 0}
        )
        delegate = HostFsDelegate(
            session=None,
            ws_hub=None,
            ws_rpc=rpc,
            daemon_id_resolver=_fake_daemon_id_resolver,
        )
        await delegate.run_command(
            ws,
            command="sillyspec",
            args=_gate_args("c1"),
            cwd=ws.root_path,
            timeout=720.0,
        )
        assert rpc.calls[0]["args"]["env"] is None


# ── 3. M5 timeout 透传 ────────────────────────────────────────────────────────────


class TestTimeoutPassthrough:
    async def test_timeout_forwarded_to_send_rpc(self):
        # run_command 的 timeout 必须透传到 send_rpc(timeout=...)（M5 契约）
        ws = _make_daemon_client_workspace()
        rpc = _MockWsRpcTimeout(
            result={"exit_code": 0, "stdout": "", "stderr": "", "duration_ms": 0}
        )
        delegate = HostFsDelegate(
            session=None,
            ws_hub=None,
            ws_rpc=rpc,
            daemon_id_resolver=_fake_daemon_id_resolver,
        )
        await delegate.run_command(
            ws,
            command="sillyspec",
            args=_gate_args("c1"),
            cwd=ws.root_path,
            timeout=720.0,
        )
        assert rpc.calls[0]["timeout"] == 720.0

    async def test_timeout_carried_in_args_too(self):
        # timeout 同时进 args（daemon handler 需知道本次命令的超时阈值）
        ws = _make_daemon_client_workspace()
        rpc = _MockWsRpcTimeout(
            result={"exit_code": 0, "stdout": "", "stderr": "", "duration_ms": 0}
        )
        delegate = HostFsDelegate(
            session=None,
            ws_hub=None,
            ws_rpc=rpc,
            daemon_id_resolver=_fake_daemon_id_resolver,
        )
        await delegate.run_command(
            ws,
            command="sillyspec",
            args=_gate_args("c1"),
            cwd=ws.root_path,
            timeout=300.0,
        )
        assert rpc.calls[0]["args"]["timeout"] == 300.0
        assert rpc.calls[0]["timeout"] == 300.0


# ── 4. fail-loud：run_command 不降级（区别 git_apply D-006）─────────────────────


class TestFailLoudNoDegrade:
    async def test_daemon_client_no_rpc_raises_unavailable(self):
        # ws_rpc=None（未接线）→ raise HostFsDelegateUnavailable（与现有 8 方法一致）
        from app.modules.daemon.host_fs import HostFsDelegateUnavailable

        ws = _make_daemon_client_workspace()
        delegate = HostFsDelegate(
            session=None,
            ws_hub=None,
            ws_rpc=None,
            daemon_id_resolver=_fake_daemon_id_resolver,
        )
        with pytest.raises(HostFsDelegateUnavailable):
            await delegate.run_command(
                ws,
                command="sillyspec",
                args=_gate_args("c1"),
                cwd=ws.root_path,
                timeout=720.0,
            )

    async def test_daemon_client_no_bound_daemon_raises(self):
        # resolver 返回 None（genuinely unbound）→ raise（不降级）
        from app.modules.daemon.host_fs import HostFsDelegateUnavailable

        async def _null_resolver(session: Any, workspace_id: Any) -> Any:
            return None

        ws = _make_daemon_client_workspace()
        delegate = HostFsDelegate(
            session=None,
            ws_hub=None,
            ws_rpc=_MockWsRpc(),
            daemon_id_resolver=_null_resolver,
        )
        with pytest.raises(HostFsDelegateUnavailable):
            await delegate.run_command(
                ws,
                command="sillyspec",
                args=_gate_args("c1"),
                cwd=ws.root_path,
                timeout=720.0,
            )


# ── 6. 现有 8 方法零回归（timeout=None 时不传 timeout）──────────────────────────


class TestZeroRegression:
    """现有 _MockWsRpc.send_rpc 无 timeout 参数（test_delegate.py:42）。

    timeout=None（现有 8 方法默认）时 _via_rpc 必须不传 timeout kwarg，
    否则 _MockWsRpc.send_rpc 因接受意外 kwarg 而 TypeError。用 stat（现有 8
    方法之一）钉死此契约。
    """

    async def test_stat_with_old_mock_no_timeout_kwarg(self):
        # stat（现有方法）经 _via_rpc_or_degrade → _via_rpc(timeout=None 默认）
        # → 不给 send_rpc 传 timeout → _MockWsRpc（无 timeout 参数）仍兼容
        ws = _make_daemon_client_workspace()
        rpc = _MockWsRpc(result={"exists": True, "is_dir": False, "size": 42})
        delegate = HostFsDelegate(
            session=None,
            ws_hub=None,
            ws_rpc=rpc,
            daemon_id_resolver=_fake_daemon_id_resolver,
        )
        out = await delegate.stat(ws, "/host/a.txt")
        assert out == {"exists": True, "is_dir": False, "size": 42}
        assert len(rpc.calls) == 1
        # call 字典无 timeout 键（mock 没收 timeout）= 证明 _via_rpc 没传
        assert "timeout" not in rpc.calls[0]

    async def test_run_command_with_old_mock_fails_loud(self):
        # 反向钉死：run_command 传 timeout=720 给 _via_rpc，若 _via_rpc 把
        # timeout 透传给无 timeout 参数的 _MockWsRpc.send_rpc → TypeError。
        # 这证明 timeout=None 不传是**有条件**的（非 None 时必须传）。
        ws = _make_daemon_client_workspace()
        rpc = _MockWsRpc(result={"exit_code": 0, "stdout": "", "stderr": "", "duration_ms": 0})
        delegate = HostFsDelegate(
            session=None,
            ws_hub=None,
            ws_rpc=rpc,
            daemon_id_resolver=_fake_daemon_id_resolver,
        )
        with pytest.raises(TypeError):
            await delegate.run_command(
                ws,
                command="sillyspec",
                args=_gate_args("c1"),
                cwd=ws.root_path,
                timeout=720.0,
            )


# ── task-06 gate-cwd-specdir-fix：--spec-dir 白名单注入拒（R3）────────────────
class TestGateSpecDirWhitelist:
    """--spec-dir flag 白名单（task-06）：拒路径遍历注入 + 缺值。"""

    @pytest.mark.asyncio
    async def test_spec_dir_path_traversal_rejected(self) -> None:
        """--spec-dir 值含 ``..`` 路径遍历 → raise HostFsDelegateError（R3 防注入）。"""
        delegate = HostFsDelegate(
            session=None,
            ws_rpc=_MockWsRpcTimeout(),
            daemon_id_resolver=_fake_daemon_id_resolver,
        )
        ws = _make_daemon_client_workspace()
        with pytest.raises(HostFsDelegateError):
            await delegate.run_command(
                workspace=ws,
                command="sillyspec",
                args=_gate_args("demo", extra=["--spec-dir", "../../../etc/passwd"]),
                cwd="/code/root",
                timeout=30,
            )

    @pytest.mark.asyncio
    async def test_spec_dir_empty_value_rejected(self) -> None:
        """--spec-dir 缺值（尾部无 value）→ raise HostFsDelegateError（成对消费校验）。"""
        delegate = HostFsDelegate(
            session=None,
            ws_rpc=_MockWsRpcTimeout(),
            daemon_id_resolver=_fake_daemon_id_resolver,
        )
        ws = _make_daemon_client_workspace()
        with pytest.raises(HostFsDelegateError):
            await delegate.run_command(
                workspace=ws,
                command="sillyspec",
                args=_gate_args("demo", extra=["--spec-dir"]),
                cwd="/code/root",
                timeout=30,
            )
