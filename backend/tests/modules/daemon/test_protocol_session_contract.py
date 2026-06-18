"""Contract tests (task-03) for session/permission control WS messages.

Asserts that the 5 new ``DAEMON_MSG_*`` constants and 4 pydantic payload
models in ``backend/app/modules/daemon/protocol.py`` align **verbatim**
with the TypeScript counterpart ``sillyhub-daemon/src/protocol.ts``.

Any character drift (case / underscore / colon prefix / hyphen / camelCase)
fails this test on either side (design.md R-02 + NFR-05).

The expected literal strings below are duplicated verbatim in the TS
contract test ``sillyhub-daemon/tests/protocol-session-contract.test.ts``
(EXPECTED map). Drift on either side → test red.
"""

from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from app.modules.daemon.protocol import (
    DAEMON_MSG_PERMISSION_REQUEST,
    DAEMON_MSG_PERMISSION_RESPONSE,
    DAEMON_MSG_SESSION_END,
    DAEMON_MSG_SESSION_INJECT,
    DAEMON_MSG_SESSION_INTERRUPT,
    DaemonMessage,
    PermissionRequestPayload,
    PermissionResponsePayload,
    SessionControlPayload,
    SessionInjectPayload,
)

# ── Cross-language alignment table (mirrors TS EXPECTED map verbatim) ─────────
EXPECTED = {
    "SESSION_INJECT": "daemon:session_inject",
    "SESSION_INTERRUPT": "daemon:session_interrupt",
    "SESSION_END": "daemon:session_end",
    "PERMISSION_REQUEST": "daemon:permission_request",
    "PERMISSION_RESPONSE": "daemon:permission_response",
}

# Fixed UUIDs for deterministic assertions.
SESSION_UUID = "11111111-1111-1111-1111-111111111111"
LEASE_UUID = "22222222-2222-2222-2222-222222222222"
RUN_UUID = "33333333-3333-3333-3333-333333333333"


class TestSessionPermissionConstants:
    """5 个新常量字符串值逐字对齐 backend protocol.py DAEMON_MSG_* (AC-01, AC-02)."""

    def test_session_inject_value(self) -> None:
        assert EXPECTED["SESSION_INJECT"] == DAEMON_MSG_SESSION_INJECT

    def test_session_interrupt_value(self) -> None:
        assert EXPECTED["SESSION_INTERRUPT"] == DAEMON_MSG_SESSION_INTERRUPT

    def test_session_end_value(self) -> None:
        assert EXPECTED["SESSION_END"] == DAEMON_MSG_SESSION_END

    def test_permission_request_value(self) -> None:
        assert EXPECTED["PERMISSION_REQUEST"] == DAEMON_MSG_PERMISSION_REQUEST

    def test_permission_response_value(self) -> None:
        assert EXPECTED["PERMISSION_RESPONSE"] == DAEMON_MSG_PERMISSION_RESPONSE

    def test_all_prefixed_with_daemon_colon(self) -> None:
        """与 batch 协议风格一致（前缀 ``daemon:`` 不可漏）."""
        for v in (
            DAEMON_MSG_SESSION_INJECT,
            DAEMON_MSG_SESSION_INTERRUPT,
            DAEMON_MSG_SESSION_END,
            DAEMON_MSG_PERMISSION_REQUEST,
            DAEMON_MSG_PERMISSION_RESPONSE,
        ):
            assert v.startswith("daemon:")

    def test_all_lowercase_underscore_no_drift(self) -> None:
        """去前缀后必须全小写 + 下划线（禁止连字符/驼峰漂移）."""
        import re

        for v in (
            DAEMON_MSG_SESSION_INJECT,
            DAEMON_MSG_SESSION_INTERRUPT,
            DAEMON_MSG_SESSION_END,
            DAEMON_MSG_PERMISSION_REQUEST,
            DAEMON_MSG_PERMISSION_RESPONSE,
        ):
            tail = v[len("daemon:") :]
            assert re.fullmatch(r"[a-z][a-z_]*", tail), f"drift in {v}"

    def test_all_five_values_distinct(self) -> None:
        values = {
            DAEMON_MSG_SESSION_INJECT,
            DAEMON_MSG_SESSION_INTERRUPT,
            DAEMON_MSG_SESSION_END,
            DAEMON_MSG_PERMISSION_REQUEST,
            DAEMON_MSG_PERMISSION_RESPONSE,
        }
        assert len(values) == 5


class TestBatchProtocolNoRegression:
    """现有 8+2 batch/RPC 常量值零变化 (AC-08 / FR-09)."""

    def test_batch_constants_unchanged(self) -> None:
        from app.modules.daemon.protocol import (
            DAEMON_MSG_HEARTBEAT,
            DAEMON_MSG_HEARTBEAT_ACK,
            DAEMON_MSG_LEASE_CLAIM,
            DAEMON_MSG_LEASE_COMPLETE,
            DAEMON_MSG_LEASE_MESSAGES,
            DAEMON_MSG_LEASE_START,
            DAEMON_MSG_REGISTER,
            DAEMON_MSG_RPC,
            DAEMON_MSG_RPC_RESULT,
            DAEMON_MSG_TASK_AVAILABLE,
        )

        assert DAEMON_MSG_TASK_AVAILABLE == "daemon:task_available"
        assert DAEMON_MSG_HEARTBEAT == "daemon:heartbeat"
        assert DAEMON_MSG_REGISTER == "daemon:register"
        assert DAEMON_MSG_HEARTBEAT_ACK == "daemon:heartbeat_ack"
        assert DAEMON_MSG_LEASE_CLAIM == "daemon:lease_claim"
        assert DAEMON_MSG_LEASE_START == "daemon:lease_start"
        assert DAEMON_MSG_LEASE_COMPLETE == "daemon:lease_complete"
        assert DAEMON_MSG_LEASE_MESSAGES == "daemon:lease_messages"
        assert DAEMON_MSG_RPC == "daemon:rpc"
        assert DAEMON_MSG_RPC_RESULT == "daemon:rpc_result"


class TestSessionInjectPayload:
    """SESSION_INJECT payload schema (AC-03, AC-05)."""

    def test_valid_with_uuid_strings(self) -> None:
        p = SessionInjectPayload(
            session_id=SESSION_UUID,
            lease_id=LEASE_UUID,
            run_id=RUN_UUID,
            prompt="请把这段代码再优化一下",
        )
        assert p.session_id == uuid.UUID(SESSION_UUID)
        assert p.lease_id == uuid.UUID(LEASE_UUID)
        assert p.run_id == uuid.UUID(RUN_UUID)
        assert p.prompt == "请把这段代码再优化一下"

    def test_valid_with_uuid_objects(self) -> None:
        p = SessionInjectPayload(
            session_id=uuid.UUID(SESSION_UUID),
            lease_id=uuid.UUID(LEASE_UUID),
            run_id=uuid.UUID(RUN_UUID),
            prompt="hello",
        )
        assert isinstance(p.session_id, uuid.UUID)

    def test_missing_required_field_raises(self) -> None:
        with pytest.raises(ValidationError):
            SessionInjectPayload(  # type: ignore[call-arg]
                session_id=SESSION_UUID,
                lease_id=LEASE_UUID,
                run_id=RUN_UUID,
            )
        with pytest.raises(ValidationError):
            SessionInjectPayload(  # type: ignore[call-arg]
                session_id=SESSION_UUID,
                lease_id=LEASE_UUID,
                prompt="p",
            )

    def test_invalid_uuid_string_raises(self) -> None:
        with pytest.raises(ValidationError):
            SessionInjectPayload(
                session_id="not-a-uuid",
                lease_id=LEASE_UUID,
                run_id=RUN_UUID,
                prompt="p",
            )

    def test_prompt_empty_allowed_at_protocol_layer(self) -> None:
        """FR-02 语义要求非空，但协议层模型只声明 ``str``。

        非空校验归属 task-05 backend service 层（inject 入口校验）。
        本任务单测文档化此分工边界（蓝图 §5 边界 9）。
        """
        p = SessionInjectPayload(
            session_id=SESSION_UUID,
            lease_id=LEASE_UUID,
            run_id=RUN_UUID,
            prompt="",
        )
        assert p.prompt == ""  # 模型层不拒绝空字符串


class TestSessionControlPayload:
    """SESSION_INTERRUPT / SESSION_END 公共 payload schema (AC-03, AC-05)."""

    def test_valid(self) -> None:
        p = SessionControlPayload(session_id=SESSION_UUID, lease_id=LEASE_UUID)
        assert p.session_id == uuid.UUID(SESSION_UUID)
        assert p.lease_id == uuid.UUID(LEASE_UUID)

    def test_missing_lease_id_raises(self) -> None:
        with pytest.raises(ValidationError):
            SessionControlPayload(session_id=SESSION_UUID)  # type: ignore[call-arg]

    def test_missing_session_id_raises(self) -> None:
        with pytest.raises(ValidationError):
            SessionControlPayload(lease_id=LEASE_UUID)  # type: ignore[call-arg]


class TestPermissionRequestPayload:
    """PERMISSION_REQUEST payload schema (AC-03, AC-05). Daemon → Server."""

    def test_valid_with_optional_tool_use_id(self) -> None:
        p = PermissionRequestPayload(
            session_id=SESSION_UUID,
            run_id=RUN_UUID,
            request_id="req-1",
            tool_name="Write",
            input={"file_path": "/tmp/x.txt", "content": "hi"},
            tool_use_id="toolu_abc123",
        )
        assert p.tool_name == "Write"
        assert p.input["file_path"] == "/tmp/x.txt"
        assert p.tool_use_id == "toolu_abc123"

    def test_valid_without_optional_tool_use_id(self) -> None:
        p = PermissionRequestPayload(
            session_id=SESSION_UUID,
            run_id=RUN_UUID,
            request_id="req-1",
            tool_name="Bash",
            input={"command": "ls"},
        )
        assert p.tool_use_id is None

    def test_missing_tool_name_raises(self) -> None:
        with pytest.raises(ValidationError):
            PermissionRequestPayload(  # type: ignore[call-arg]
                session_id=SESSION_UUID,
                run_id=RUN_UUID,
                request_id="req-1",
                input={},
            )

    def test_missing_input_raises(self) -> None:
        with pytest.raises(ValidationError):
            PermissionRequestPayload(  # type: ignore[call-arg]
                session_id=SESSION_UUID,
                run_id=RUN_UUID,
                request_id="req-1",
                tool_name="Write",
            )


class TestPermissionResponsePayload:
    """PERMISSION_RESPONSE payload schema (AC-03, AC-04, AC-05). Server → Daemon."""

    def test_valid_allow(self) -> None:
        p = PermissionResponsePayload(
            session_id=SESSION_UUID,
            request_id="req-1",
            decision="allow",
        )
        assert p.decision == "allow"
        assert p.message is None

    def test_valid_deny_with_message(self) -> None:
        p = PermissionResponsePayload(
            session_id=SESSION_UUID,
            request_id="req-1",
            decision="deny",
            message="5min 超时未响应，自动拒绝",
        )
        assert p.decision == "deny"
        assert "超时" in (p.message or "")

    def test_decision_literal_rejects_unknown(self) -> None:
        """AC-04: decision=Literal['allow','deny']，其它值 ValidationError."""
        with pytest.raises(ValidationError):
            PermissionResponsePayload(
                session_id=SESSION_UUID,
                request_id="req-1",
                decision="maybe",  # type: ignore[arg-type]
            )

    def test_decision_literal_rejects_uppercase(self) -> None:
        with pytest.raises(ValidationError):
            PermissionResponsePayload(
                session_id=SESSION_UUID,
                request_id="req-1",
                decision="Allow",  # type: ignore[arg-type]
            )

    def test_missing_decision_raises(self) -> None:
        with pytest.raises(ValidationError):
            PermissionResponsePayload(  # type: ignore[call-arg]
                session_id=SESSION_UUID,
                request_id="req-1",
            )


class TestDaemonMessageEnvelopeCompat:
    """5 个新 type 复用现有 DaemonMessage 信封，不新增结构 (AC-06)."""

    def test_session_inject_envelope_roundtrip(self) -> None:
        msg = DaemonMessage(
            type=DAEMON_MSG_SESSION_INJECT,
            payload={
                "session_id": SESSION_UUID,
                "lease_id": LEASE_UUID,
                "run_id": RUN_UUID,
                "prompt": "p",
            },
        )
        serialized = msg.model_dump_json()
        restored = DaemonMessage.model_validate_json(serialized)
        assert restored.type == DAEMON_MSG_SESSION_INJECT
        assert restored.payload is not None
        assert restored.payload["run_id"] == RUN_UUID

    def test_session_end_envelope_roundtrip(self) -> None:
        msg = DaemonMessage(
            type=DAEMON_MSG_SESSION_END,
            payload={"session_id": SESSION_UUID, "lease_id": LEASE_UUID},
        )
        restored = DaemonMessage.model_validate_json(msg.model_dump_json())
        assert restored.type == DAEMON_MSG_SESSION_END
        assert restored.payload["session_id"] == SESSION_UUID

    def test_permission_request_envelope(self) -> None:
        msg = DaemonMessage(
            type=DAEMON_MSG_PERMISSION_REQUEST,
            payload={
                "session_id": SESSION_UUID,
                "run_id": RUN_UUID,
                "request_id": "req-1",
                "tool_name": "Write",
                "input": {"file_path": "/tmp/x"},
            },
        )
        restored = DaemonMessage.model_validate_json(msg.model_dump_json())
        assert restored.type == DAEMON_MSG_PERMISSION_REQUEST
        assert restored.payload["tool_name"] == "Write"

    def test_payload_none_allowed_for_envelope(self) -> None:
        """DaemonMessage.payload: dict | None（信封允许 None）.

        SESSION_INTERRUPT/END 业务上要求 payload 必填，但若 daemon 收到
        payload=None 的控制消息应静默丢弃（NFR-05），落地由 task-04 路由层
        try/except；本任务断言信封层不抛 KeyError。
        """
        msg = DaemonMessage(type=DAEMON_MSG_SESSION_INTERRUPT, payload=None)
        assert msg.payload is None  # 不抛 KeyError


class TestNfr05SilentDrop:
    """NFR-05: 未识别 type 静默丢弃不崩溃（路由层落地归属 task-04）.

    本任务单测锁定协议契约层的语义：未知 type 不在已知集合内，且
    DaemonMessage 信封层接受任意 type 字符串（不校验枚举），
    将"未识别不抛"的语义验证前置到契约层。
    """

    KNOWN_TYPES = frozenset(
        {
            "daemon:task_available",
            "daemon:heartbeat",
            "daemon:rpc",
            "daemon:register",
            "daemon:heartbeat_ack",
            "daemon:lease_claim",
            "daemon:lease_start",
            "daemon:lease_complete",
            "daemon:lease_messages",
            "daemon:rpc_result",
            EXPECTED["SESSION_INJECT"],
            EXPECTED["SESSION_INTERRUPT"],
            EXPECTED["SESSION_END"],
            EXPECTED["PERMISSION_REQUEST"],
            EXPECTED["PERMISSION_RESPONSE"],
        }
    )

    @pytest.mark.parametrize(
        "unknown_type",
        [
            "daemon:unknown_future_type",
            "daemon:typo_session_inject",  # 拼写错误
            "daemon:SESSION_INJECT",  # 大小写漂移
            "daemon:session-inject",  # 连字符漂移
            "daemon:sessionInject",  # 驼峰漂移
            "malicious:not_daemon_prefix",
            "",
        ],
    )
    def test_unknown_type_not_in_known_set(self, unknown_type: str) -> None:
        assert unknown_type not in self.KNOWN_TYPES

    def test_envelope_accepts_unknown_type_without_validation_error(self) -> None:
        """DaemonMessage 信封不校验 type 枚举，未知 type 可正常构造（不抛）.

        task-04 在路由层对未知 type 默认分支 return + warn，不抛异常。
        本任务断言契约层不抛 KeyError / ValidationError。
        """
        msg = DaemonMessage(type="daemon:unknown_future_type", payload=None)
        assert msg.type == "daemon:unknown_future_type"
        # 已知 batch 类型分发不受影响（信封层一视同仁）
        assert DaemonMessage(type="daemon:rpc", payload=None).type == "daemon:rpc"
