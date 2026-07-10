"""task-06 测试：_run_gate_via_delegate + _read_gate_result（gate 执行与结果解析）。

P3 driver-gate-pilot design §5.6（Z1 合并探测）/ §7（接口）/ §9（fail-loud）。

Z1 偏差说明（Reverse Sync）：TaskCard 原写「用 run_command(args=["gate","--help"])
探测子命令存在性」，但 task-01 白名单 ``_enforce_command_whitelist`` 只允许头部
``["gate","verify","--change",<name>,"--json"]`` + 尾部 ``--stage``——
``["gate","--help"]`` 不匹配会被白名单 raise。故 Z1 合并到正式 gate 执行结果
分析（跑一次 gate verify，stdout 非法 + stderr 含子命令缺失信号 → exit 2 诊断），
保持 design §5.6「子命令缺失 fail-loud exit 2」意图，不破坏 task-01 白名单契约。
"""

from __future__ import annotations

import json
import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.modules.change.dispatch import (
    _GATE_RPC_TIMEOUT_SECONDS,
    _GATE_SUBCOMMAND_MISSING_HINTS,
    _read_gate_result,
    _run_gate_via_delegate,
)

# ── _read_gate_result：纯函数解析 gate JSON ────────────────────────────────


class TestReadGateResult:
    """覆盖 ok=true→0 / ok=false→1 / errors 透传 / raw_envelope 保留 /
    JSON 解析失败→2 / 字段缺失→2 / 类型异常→2。"""

    def test_ok_true_returns_exit_zero(self) -> None:
        envelope = {
            "schema_version": 1,
            "command": "gate",
            "change": "demo",
            "ok": True,
            "errors": [],
            "warnings": [],
            "generated_at": "2026-07-10T07:58:52.000Z",
            "stage": "verify",
        }
        result = _read_gate_result(json.dumps(envelope))
        assert result["exit_code"] == 0
        assert result["errors"] == []
        assert result["raw_envelope"] == envelope

    def test_ok_false_returns_exit_one_and_errors_passed_through(self) -> None:
        envelope = {
            "schema_version": 1,
            "command": "gate",
            "change": "demo",
            "ok": False,
            "errors": ["verify-result.md 不存在", "核心文档缺失: design.md"],
            "warnings": [],
            "generated_at": "2026-07-10T07:58:52.000Z",
            "stage": "verify",
        }
        result = _read_gate_result(json.dumps(envelope))
        assert result["exit_code"] == 1
        assert result["errors"] == ["verify-result.md 不存在", "核心文档缺失: design.md"]
        assert result["raw_envelope"] == envelope

    def test_raw_envelope_preserved_full_dict(self) -> None:
        """raw_envelope 必须保留完整 envelope（落 AgentRun.gate_result 审计）。"""
        envelope = {
            "schema_version": 1,
            "command": "gate",
            "change": "demo",
            "ok": True,
            "errors": [],
            "warnings": [],
            "generated_at": "2026-07-10T07:58:52.000Z",
            "stage": "verify",
            "checks": [
                {"id": "artifacts", "ok": True, "errors": []},
                {"id": "verify-test", "ok": True, "errors": [], "data": {"status": "passed"}},
            ],
        }
        result = _read_gate_result(json.dumps(envelope))
        assert result["raw_envelope"]["checks"] == envelope["checks"]

    def test_invalid_json_returns_exit_two(self) -> None:
        result = _read_gate_result("not a json at all")
        assert result["exit_code"] == 2
        assert len(result["errors"]) == 1
        assert "JSON 解析失败" in result["errors"][0]
        assert result["raw_envelope"] == {}

    def test_empty_stdout_returns_exit_two(self) -> None:
        result = _read_gate_result("")
        assert result["exit_code"] == 2
        assert "JSON 解析失败" in result["errors"][0]
        assert result["raw_envelope"] == {}

    def test_missing_ok_field_returns_exit_two(self) -> None:
        """字段缺失（无 ok 键）→ exit 2（防御）。"""
        result = _read_gate_result(json.dumps({"command": "gate", "errors": []}))
        assert result["exit_code"] == 2

    def test_ok_wrong_type_returns_exit_two(self) -> None:
        """ok 字段类型异常（字符串非 bool）→ exit 2（防御）。"""
        result = _read_gate_result(json.dumps({"ok": "true", "errors": []}))
        assert result["exit_code"] == 2

    def test_errors_missing_defaults_empty_list(self) -> None:
        """errors 字段缺失 → []（保证 list[str]）。"""
        result = _read_gate_result(json.dumps({"ok": True}))
        assert result["exit_code"] == 0
        assert result["errors"] == []

    def test_errors_null_defaults_empty_list(self) -> None:
        """errors 为 null → []。"""
        result = _read_gate_result(json.dumps({"ok": True, "errors": None}))
        assert result["errors"] == []


# ── _run_gate_via_delegate：经 HostFsDelegate.run_command 执行 gate ─────────


def _make_workspace() -> MagicMock:
    ws = MagicMock()
    ws.id = uuid.uuid4()
    ws.path_source = "daemon-client"
    return ws


def _make_delegate_mock(stdout: str, stderr: str = "", exit_code: int = 0) -> MagicMock:
    """构造一个已 mock run_command 的 HostFsDelegate 替身。

    _run_gate_via_delegate 通过 lazy 构造 HostFsDelegate；测试 patch 构造函数
    使其返回本 mock，从而隔离真实 RPC。
    """
    delegate = MagicMock()
    delegate.run_command = AsyncMock(
        return_value={
            "exit_code": exit_code,
            "stdout": stdout,
            "stderr": stderr,
            "duration_ms": 1234,
        }
    )
    return delegate


@pytest.mark.asyncio
async def test_run_gate_via_delegate_ok_true(monkeypatch: pytest.MonkeyPatch) -> None:
    """正式执行 → stdout 合法 envelope ok=true → exit 0。"""
    envelope = {"ok": True, "errors": [], "stage": "verify"}
    delegate = _make_delegate_mock(stdout=json.dumps(envelope), exit_code=0)

    captured: dict = {}

    def fake_ctor(session, *, ws_hub=None, ws_rpc=None):
        captured["called"] = True
        return delegate

    monkeypatch.setattr("app.modules.change.dispatch.HostFsDelegate", fake_ctor, raising=False)
    # HostFsDelegate 是函数内 lazy import，patch 目标须是实际引用点
    import app.modules.change.dispatch as dispatch_mod

    monkeypatch.setattr(dispatch_mod, "_new_host_fs_delegate", lambda session: delegate)

    session = MagicMock()
    workspace = _make_workspace()
    result = await _run_gate_via_delegate(
        session=session,
        workspace=workspace,
        change_name="demo-change",
        spec_root="/spec/root",
    )
    assert result["exit_code"] == 0
    assert result["errors"] == []
    assert result["raw_envelope"]["ok"] is True
    # run_command 被调用，参数走白名单模板
    delegate.run_command.assert_awaited_once()
    call_kwargs = delegate.run_command.call_args.kwargs
    assert call_kwargs["command"] == "sillyspec"
    assert call_kwargs["args"] == ["gate", "verify", "--change", "demo-change", "--json"]
    assert call_kwargs["cwd"] == "/spec/root"
    assert call_kwargs["timeout"] == _GATE_RPC_TIMEOUT_SECONDS


@pytest.mark.asyncio
async def test_run_gate_via_delegate_ok_false(monkeypatch: pytest.MonkeyPatch) -> None:
    """正式执行 → stdout ok=false → exit 1 + errors 透传。"""
    envelope = {"ok": False, "errors": ["verify-test 失败"], "stage": "verify"}
    delegate = _make_delegate_mock(stdout=json.dumps(envelope), exit_code=1)
    import app.modules.change.dispatch as dispatch_mod

    monkeypatch.setattr(dispatch_mod, "_new_host_fs_delegate", lambda session: delegate)

    result = await _run_gate_via_delegate(
        session=MagicMock(),
        workspace=_make_workspace(),
        change_name="demo",
        spec_root="/spec/root",
    )
    assert result["exit_code"] == 1
    assert result["errors"] == ["verify-test 失败"]


@pytest.mark.asyncio
async def test_run_gate_via_delegate_z1_subcommand_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Z1 合并分支：stdout 空 + stderr 含子命令缺失信号 → exit 2 诊断。

    design §5.6 Z1 意图：sillyspec 未发版（旧版无 gate 子命令）时 fail-loud
    exit 2 + 明确诊断（非 fallback 声明态）。
    """
    delegate = _make_delegate_mock(
        stdout="",
        stderr="error: unknown command 'gate'. See 'sillyspec --help'.",
        exit_code=2,
    )
    import app.modules.change.dispatch as dispatch_mod

    monkeypatch.setattr(dispatch_mod, "_new_host_fs_delegate", lambda session: delegate)

    result = await _run_gate_via_delegate(
        session=MagicMock(),
        workspace=_make_workspace(),
        change_name="demo",
        spec_root="/spec/root",
    )
    assert result["exit_code"] == 2
    assert any("gate 子命令缺失" in e for e in result["errors"])
    assert result["raw_envelope"] == {}


@pytest.mark.asyncio
async def test_run_gate_via_delegate_z1_subcommand_missing_no_such_command(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Z1 另一种 stderr 信号变体（No such command）。"""
    delegate = _make_delegate_mock(
        stdout="  ",
        stderr="Error: No such command 'gate'.",
        exit_code=2,
    )
    import app.modules.change.dispatch as dispatch_mod

    monkeypatch.setattr(dispatch_mod, "_new_host_fs_delegate", lambda session: delegate)

    result = await _run_gate_via_delegate(
        session=MagicMock(),
        workspace=_make_workspace(),
        change_name="demo",
        spec_root="/spec/root",
    )
    assert result["exit_code"] == 2
    assert any("gate 子命令缺失" in e for e in result["errors"])


@pytest.mark.asyncio
async def test_run_gate_via_delegate_json_parse_failure_no_subcmd_signal(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """stdout 非法 JSON 但 stderr 无子命令缺失信号 → exit 2 解析失败诊断。"""
    delegate = _make_delegate_mock(
        stdout="garbled output not json",
        stderr="some unrelated error",
        exit_code=2,
    )
    import app.modules.change.dispatch as dispatch_mod

    monkeypatch.setattr(dispatch_mod, "_new_host_fs_delegate", lambda session: delegate)

    result = await _run_gate_via_delegate(
        session=MagicMock(),
        workspace=_make_workspace(),
        change_name="demo",
        spec_root="/spec/root",
    )
    assert result["exit_code"] == 2
    assert any("JSON 解析失败" in e for e in result["errors"])


@pytest.mark.asyncio
async def test_run_gate_via_delegate_rpc_exception_returns_exit_two(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """RPC 异常（HostFsDelegateError/DaemonRpcTimeout/断线）→ catch exit 2。

    design §5.3 / §7 fail-loud：不抛崩 gate 任务，交 task-07 置 gate_status=failed。
    """
    from app.modules.daemon.host_fs.delegate import HostFsDelegateError

    delegate = MagicMock()
    delegate.run_command = AsyncMock(side_effect=HostFsDelegateError("daemon offline"))
    import app.modules.change.dispatch as dispatch_mod

    monkeypatch.setattr(dispatch_mod, "_new_host_fs_delegate", lambda session: delegate)

    result = await _run_gate_via_delegate(
        session=MagicMock(),
        workspace=_make_workspace(),
        change_name="demo",
        spec_root="/spec/root",
    )
    assert result["exit_code"] == 2
    assert any("gate 执行异常" in e for e in result["errors"])
    assert result["raw_envelope"] == {}


@pytest.mark.asyncio
async def test_run_gate_via_delegate_stage_parameterized(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """stage 参数化：当前 verify，前瞻 P4 execute（design §5.4）。

    注意：task-01 白名单当前只锁 stage='verify'（args[1]=='verify'），其他值
    会被白名单拒——本测试验证参数透传到 args[1]，stage='verify' 通过白名单。
    """
    envelope = {"ok": True, "errors": []}
    delegate = _make_delegate_mock(stdout=json.dumps(envelope), exit_code=0)
    import app.modules.change.dispatch as dispatch_mod

    monkeypatch.setattr(dispatch_mod, "_new_host_fs_delegate", lambda session: delegate)

    await _run_gate_via_delegate(
        session=MagicMock(),
        workspace=_make_workspace(),
        change_name="demo",
        spec_root="/spec/root",
        stage="verify",
    )
    call_args = delegate.run_command.call_args.kwargs["args"]
    assert call_args[1] == "verify"


def test_subcommand_missing_hints_cover_known_signals() -> None:
    """Z1 信号集合覆盖 sillyspec/oclif 两种 CLI 框架的子命令缺失报错。

    实现里对 stderr 做 ``.lower()`` 后匹配（大小写不敏感），本测试镜像
    同样逻辑，验证常见子命令缺失信号都能命中。
    """
    hints = _GATE_SUBCOMMAND_MISSING_HINTS
    sample_signals = [
        "error: unknown command 'gate'. See 'sillyspec --help'.",
        "Error: gate is not a sillyspec command.",
        "Error: No such command 'gate'.",
    ]
    for signal in sample_signals:
        signal_lower = signal.lower()
        assert any(hint in signal_lower for hint in hints), f"missed signal: {signal}"
