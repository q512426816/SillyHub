"""POLICY_UPDATE 消息类型 + payload 单元测试（task-06 / D-004 policy 热更新）。

对齐 design.md §7.2 PolicyUpdatePayload 字段语义：
  - runtime_id：目标 daemon runtime（uuid.UUID，自动从 string 解析）
  - allowed_roots：新 allowed_roots 列表（全量替换，daemon 侧 PolicyCache 去并集）
  - version：单调递增（daemon 收旧 version 忽略 R-07，与 RuntimePolicy.version 对齐）
"""

from __future__ import annotations

import uuid

import pytest
from pydantic import ValidationError

from app.modules.daemon.protocol import (
    DAEMON_MSG_POLICY_UPDATE,
    PolicyUpdatePayload,
)


class TestPolicyUpdateConstant:
    """消息类型常量值正确（与 design §7.2 `daemon:policy_update` 逐字符对齐）。"""

    def test_constant_value(self) -> None:
        assert DAEMON_MSG_POLICY_UPDATE == "daemon:policy_update"


class TestPolicyUpdatePayload:
    """PolicyUpdatePayload 字段类型 + 构造行为。"""

    def test_construct_from_dict_uuid_string_parsed(self) -> None:
        """runtime_id 字符串自动转 uuid.UUID（与 TaskAvailablePayload 一致）。"""
        rid = uuid.uuid4()
        payload = PolicyUpdatePayload(
            runtime_id=str(rid),
            allowed_roots=["D:/work", "E:/data"],
            version=3,
        )
        assert payload.runtime_id == rid
        assert isinstance(payload.runtime_id, uuid.UUID)
        assert payload.allowed_roots == ["D:/work", "E:/data"]
        assert payload.version == 3

    def test_runtime_id_accepts_uuid_directly(self) -> None:
        rid = uuid.uuid4()
        payload = PolicyUpdatePayload(
            runtime_id=rid,
            allowed_roots=[],
            version=1,
        )
        assert payload.runtime_id == rid

    def test_version_field_type_is_int(self) -> None:
        payload = PolicyUpdatePayload(
            runtime_id=uuid.uuid4(),
            allowed_roots=[],
            version=5,
        )
        assert isinstance(payload.version, int)
        assert payload.version == 5

    def test_version_zero_allowed(self) -> None:
        """version 单调递增，0 是合法 int 值（daemon 侧去重逻辑负责忽略旧值）。"""
        payload = PolicyUpdatePayload(
            runtime_id=uuid.uuid4(),
            allowed_roots=["D:/work"],
            version=0,
        )
        assert payload.version == 0

    def test_missing_runtime_id_raises(self) -> None:
        with pytest.raises(ValidationError):
            PolicyUpdatePayload(  # type: ignore[call-arg]
                allowed_roots=[],
                version=1,
            )

    def test_missing_allowed_roots_raises(self) -> None:
        with pytest.raises(ValidationError):
            PolicyUpdatePayload(  # type: ignore[call-arg]
                runtime_id=uuid.uuid4(),
                version=1,
            )

    def test_missing_version_raises(self) -> None:
        with pytest.raises(ValidationError):
            PolicyUpdatePayload(  # type: ignore[call-arg]
                runtime_id=uuid.uuid4(),
                allowed_roots=[],
            )

    def test_invalid_runtime_id_string_raises(self) -> None:
        with pytest.raises(ValidationError):
            PolicyUpdatePayload(
                runtime_id="not-a-uuid",
                allowed_roots=[],
                version=1,
            )

    def test_invalid_version_type_raises(self) -> None:
        with pytest.raises(ValidationError):
            PolicyUpdatePayload(
                runtime_id=uuid.uuid4(),
                allowed_roots=[],
                version="three",  # type: ignore[arg-type]
            )
