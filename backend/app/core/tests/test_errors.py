"""Unit tests for core error helpers (_request_id)."""

from __future__ import annotations

import types
import uuid

from app.core.errors import _request_id


def _make_request(*, state_rid: str | None = None, header_rid: str | None = None):
    """构造一个最小化的 request 替身：state（SimpleNamespace）+ headers（dict）。"""
    state = types.SimpleNamespace()
    if state_rid is not None:
        state.request_id = state_rid
    headers: dict[str, str] = {}
    if header_rid is not None:
        headers["x-request-id"] = header_rid
    return types.SimpleNamespace(state=state, headers=headers)


def test_request_id_prefers_state() -> None:
    """中间件写入 request.state.request_id 时优先用，与 x-request-id 响应头/慢请求日志对齐。"""
    request = _make_request(state_rid="rid-from-middleware", header_rid="rid-from-header")
    assert _request_id(request) == "rid-from-middleware"


def test_request_id_falls_back_to_header() -> None:
    request = _make_request(state_rid=None, header_rid="rid-from-header")
    assert _request_id(request) == "rid-from-header"


def test_request_id_generates_uuid_when_absent() -> None:
    request = _make_request(state_rid=None, header_rid=None)
    rid = _request_id(request)
    uuid.UUID(rid)  # 合法 uuid 即可
