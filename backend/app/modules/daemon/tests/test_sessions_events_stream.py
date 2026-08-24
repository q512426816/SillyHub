"""Tests for GET /api/daemon/sessions/events（task-04，会话列表 SSE 信号流）。

覆盖：
  * 单频道 + 服务端过滤（D-005）：他人 ``user_id`` 的信号被静默丢弃不下发；
    本人信号原样 ``data:`` 帧透传（发布侧 JSON 零漂移）。
  * 帧协议：``: connected`` 初始注释；静默约 30s（get_message timeout 返回
    None）产出 ``: keepalive``；get_message 调用参数为
    ``ignore_subscribe_messages=True, timeout=30.0``。
  * 断开清理：消费方断开后（aclose → GeneratorExit）finally 兜底
    unsubscribe(SESSIONS_CHANGED_CHANNEL) + close，无订阅连接泄漏。
  * 端点包装层：StreamingResponse 的 media_type / SSE headers（对齐
    /sessions/{id}/stream）；未登录 401。
  * 路由可达性回归（2026-08-24 verify 真实运行时冒烟补）：带鉴权请求必须
    命中本端点，而非被 ``GET /sessions/{session_id}`` 遮蔽成 422。

Redis 全程 mock（AsyncMock / MagicMock 假 pubsub，可控消息序列）——照
``test_session_sse.py`` 先例，不需要真实 broker。端点级 200 流不通过 HTTP
client 消费（信号流无终止事件，HTTP 读全量 body 会永久挂起——ASGITransport
会收完整个 body 才返回，``client.stream()`` 也逃不掉），改为直接调路由函数并
驱动 ``StreamingResponse.body_iterator``。路由可达性回归走 app 路由表断言
（首个 GET 匹配必须是本端点），同样不消费响应 body。
"""

from __future__ import annotations

import json
import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select

from app.modules.auth.model import User
from app.modules.daemon.router import _stream_sessions_events, stream_sessions_events
from app.modules.daemon.session_events import SESSIONS_CHANGED_CHANNEL

# ── Helpers ──────────────────────────────────────────────────────────────────


def _signal(user_id: str, event: str = "status_changed") -> str:
    """构造一条与 task-01 publish_sessions_changed 同构的信号 JSON。"""
    return json.dumps(
        {
            "event": event,
            "session_id": str(uuid.uuid4()),
            "user_id": user_id,
            "at": "2026-08-24T08:00:00+00:00",
        }
    )


def _build_mock_pubsub(messages: list[dict[str, Any] | None]) -> tuple[MagicMock, list[dict]]:
    """构造假 pubsub：get_message 依序吐出 ``messages``，耗尽后永远返回 None。

    ``None`` 条目建模静默（timeout 路径）；dict 条目为真实 Redis pub/sub 消息
    形态（``{"type": "message", "data": raw}``）。同时记录每次 get_message 的
    调用参数，供帧协议断言使用。
    """
    state = {"remaining": list(messages)}
    get_message_calls: list[dict] = []

    pubsub = MagicMock()
    pubsub.subscribe = AsyncMock()
    pubsub.unsubscribe = AsyncMock()
    pubsub.close = AsyncMock()

    async def fake_get_message(**kwargs: Any) -> dict[str, Any] | None:
        get_message_calls.append(kwargs)
        if state["remaining"]:
            return state["remaining"].pop(0)
        return None  # 耗尽 → 永久静默（消费方 break + aclose 收尾）

    pubsub.get_message = fake_get_message
    return pubsub, get_message_calls


def _mock_redis(pubsub: MagicMock) -> MagicMock:
    redis = MagicMock()
    redis.pubsub.return_value = pubsub
    return redis


async def _collect(gen: Any, limit: int) -> list[str]:
    """驱动生成器收集前 ``limit`` 帧，然后显式 aclose（触发 finally 清理）。"""
    collected: list[str] = []
    async for ev in gen:
        collected.append(ev)
        if len(collected) >= limit:
            break
    # 消费方 break 只挂起 GeneratorExit 的投递；显式 aclose 让 finally
    # （unsubscribe + close）确定性执行（先例 test_session_sse.py 同款）。
    await gen.aclose()
    return collected


# ── 生成器：过滤 + 下发 + 帧协议 ─────────────────────────────────────────────


class TestStreamSessionsEventsGenerator:
    @pytest.mark.asyncio
    async def test_own_signal_delivered_other_user_filtered(self) -> None:
        """本人信号原样 data 帧下发；他人信号静默丢弃（D-005 服务端过滤）。"""
        me = str(uuid.uuid4())
        other = str(uuid.uuid4())
        own_raw = _signal(me)
        other_raw = _signal(other)
        pubsub, _ = _build_mock_pubsub(
            [
                {"type": "message", "data": other_raw},  # 他人信号先到
                {"type": "message", "data": own_raw},  # 本人信号后到
            ]
        )
        redis = _mock_redis(pubsub)

        gen = _stream_sessions_events(me)
        with patch("app.modules.daemon.router.get_redis", return_value=redis):
            collected = await _collect(gen, limit=3)

        assert collected[0] == ": connected\n\n"
        # 他人信号被消费但未产出帧 → 第 2 帧直接是本人的 data 帧
        assert collected[1] == f"data: {own_raw}\n\n"
        # 静默路径补一条 keepalive（凑满 limit=3）
        assert collected[2] == ": keepalive\n\n"
        assert other_raw not in "".join(collected)
        pubsub.subscribe.assert_called_once_with(SESSIONS_CHANGED_CHANNEL)
        # 断开清理：finally 兜底 unsubscribe + close 各一次
        pubsub.unsubscribe.assert_called_once_with(SESSIONS_CHANGED_CHANNEL)
        pubsub.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_keepalive_on_silence(self) -> None:
        """静默（get_message timeout 返回 None）→ ``: keepalive`` 注释帧。"""
        me = str(uuid.uuid4())
        pubsub, _ = _build_mock_pubsub([])  # 永远无消息
        redis = _mock_redis(pubsub)

        gen = _stream_sessions_events(me)
        with patch("app.modules.daemon.router.get_redis", return_value=redis):
            collected = await _collect(gen, limit=3)

        assert collected[0] == ": connected\n\n"
        assert collected[1] == ": keepalive\n\n"
        assert collected[2] == ": keepalive\n\n"
        pubsub.unsubscribe.assert_called_once_with(SESSIONS_CHANGED_CHANNEL)
        pubsub.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_message_polling_contract(self) -> None:
        """轮询参数钉死：ignore_subscribe_messages=True + timeout=30.0（约 30s keepalive）。"""
        me = str(uuid.uuid4())
        pubsub, calls = _build_mock_pubsub([])
        redis = _mock_redis(pubsub)

        gen = _stream_sessions_events(me)
        with patch("app.modules.daemon.router.get_redis", return_value=redis):
            await _collect(gen, limit=2)

        assert calls, "get_message 应至少被轮询一次"
        for kwargs in calls:
            assert kwargs.get("ignore_subscribe_messages") is True
            assert kwargs.get("timeout") == 30.0

    @pytest.mark.asyncio
    async def test_malformed_payload_silently_skipped(self) -> None:
        """非 JSON payload 不炸流：既不下发也不 keepalive，跳过继续轮询。"""
        me = str(uuid.uuid4())
        own_raw = _signal(me)
        pubsub, _ = _build_mock_pubsub(
            [
                {"type": "message", "data": "not-json{"},
                {"type": "message", "data": own_raw},
            ]
        )
        redis = _mock_redis(pubsub)

        gen = _stream_sessions_events(me)
        with patch("app.modules.daemon.router.get_redis", return_value=redis):
            collected = await _collect(gen, limit=2)

        assert collected == [": connected\n\n", f"data: {own_raw}\n\n"]
        assert "not-json{" not in "".join(collected)
        pubsub.close.assert_called_once()


# ── 端点包装层 ────────────────────────────────────────────────────────────────


class TestSessionsEventsEndpoint:
    @pytest.mark.asyncio
    async def test_streaming_response_metadata_and_frames(
        self, auth_headers: dict[str, str], db_session: Any
    ) -> None:
        """路由函数返回 SSE StreamingResponse：media_type / headers 对齐既有
        /sessions/{id}/stream，body_iterator 帧按当前用户过滤下发。"""
        admin = (
            (await db_session.execute(select(User).where(User.email == "admin@example.com")))
            .scalars()
            .first()
        )
        assert admin is not None

        own_raw = _signal(str(admin.id))
        pubsub, _ = _build_mock_pubsub(
            [
                {"type": "message", "data": _signal(str(uuid.uuid4()))},  # 他人
                {"type": "message", "data": own_raw},  # 本人
            ]
        )
        redis = _mock_redis(pubsub)

        with patch("app.modules.daemon.router.get_redis", return_value=redis):
            resp = await stream_sessions_events(user=admin)
            # 生成器体在首个 __anext__ 才执行，redis patch 需覆盖消费窗口
            it = resp.body_iterator
            frames = [await it.__anext__(), await it.__anext__()]
            await it.aclose()

        assert resp.media_type == "text/event-stream"
        assert resp.headers["content-type"].startswith("text/event-stream")
        assert resp.headers["cache-control"] == "no-cache, no-transform"
        assert resp.headers["connection"] == "keep-alive"
        assert resp.headers["x-accel-buffering"] == "no"
        assert frames[0] == ": connected\n\n"
        assert frames[1] == f"data: {own_raw}\n\n"
        pubsub.unsubscribe.assert_called_once_with(SESSIONS_CHANGED_CHANNEL)
        pubsub.close.assert_called_once()

    @pytest.mark.asyncio
    async def test_endpoint_401_unauthenticated(self, client: Any) -> None:
        """未登录 → 401，不进入流（鉴权依赖与 list_sessions 同款）。"""
        resp = await client.get("/api/daemon/sessions/events")
        assert resp.status_code == 401

    def test_route_registered_before_session_detail_param(self) -> None:
        """路由表级回归：GET /api/daemon/sessions/events 的首个匹配必须是本端点。

        2026-08-24 verify 真实运行时冒烟发现：本路由曾注册在两段式参数路由
        ``GET /sessions/{session_id}``（get_session_detail）之后，鉴权请求被
        遮蔽成 422 uuid_parsing——"events" 被当作 {session_id}。此前两个测试
        盲区：直接调路由函数绕过路由表；未登录 401 探针测不出遮蔽（auth 依赖
        先于路径参数校验触发）。本断言按注册序在 app 路由表找首个 GET 匹配，
        不消费响应 body（ASGITransport 会收全量 body，无限 SSE 流会挂死）。
        """
        from app.main import app

        target = "/api/daemon/sessions/events"
        first_match = None
        for route in app.routes:
            methods = getattr(route, "methods", None)
            regex = getattr(route, "path_regex", None)
            if methods and regex and "GET" in methods and regex.match(target):
                first_match = route
                break
        assert first_match is not None, "SSE 端点路由未注册"
        assert first_match.endpoint is stream_sessions_events, (
            f"首个 GET 匹配被 {getattr(first_match.endpoint, '__name__', first_match)} "
            "遮蔽——/sessions/events 必须注册在 GET /sessions/{session_id} 之前"
        )
