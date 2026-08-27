"""ql-20260827-018: GET /sessions/{id}/logs 响应 gzip 压缩.

长会话 logs（5000 行 × 50KB 文本列）明文 JSON 传输是会话回显慢的主因；
本端点按 Accept-Encoding 协商 gzip。覆盖：大载荷 gzip 生效且内容等价、
小载荷跳过压缩、?after= 增量游标与压缩正交、不支持 gzip 的客户端回退明文。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonRuntime

# 超过端点压缩阈值（1KB）的载荷。
BIG_CONTENT = "[ASSISTANT] " + "会话日志压缩测试行。".ljust(2048, "×")


async def _seed_session_with_logs(
    db_session: AsyncSession, *, content: str = BIG_CONTENT, log_count: int = 1
) -> AgentSession:
    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=admin.id,
        name="daemon-gzip-test",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)
    await db_session.commit()
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=admin.id,
        runtime_id=rt.id,
        lease_id=None,
        provider="claude",
        status="ended",
        agent_session_id=None,
        config=None,
        turn_count=1,
        created_at=datetime.now(UTC),
        last_active_at=datetime.now(UTC),
        ended_at=datetime.now(UTC),
    )
    db_session.add(sess)
    await db_session.commit()
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status="completed",
        agent_session_id=sess.id,
        session_id=None,
        started_at=datetime.now(UTC),
    )
    db_session.add(run)
    await db_session.commit()
    base = datetime.now(UTC) - timedelta(minutes=1)
    for i in range(log_count):
        db_session.add(
            AgentRunLog(
                id=uuid.uuid4(),
                run_id=run.id,
                timestamp=base + timedelta(seconds=i),
                channel="stdout",
                content_redacted=f"{content} #{i}",
            )
        )
    await db_session.commit()
    return sess


class TestSessionLogsGzip:
    async def test_gzip_applied_when_accepted_and_large(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """Accept-Encoding: gzip + 大载荷 → Content-Encoding: gzip，内容与明文等价。"""
        sess = await _seed_session_with_logs(db_session)

        identity_resp = await client.get(
            f"/api/daemon/sessions/{sess.id}/logs",
            headers={**auth_headers, "accept-encoding": "identity"},
        )
        assert identity_resp.status_code == 200, identity_resp.text
        assert "content-encoding" not in identity_resp.headers

        gzip_resp = await client.get(
            f"/api/daemon/sessions/{sess.id}/logs",
            headers={**auth_headers, "accept-encoding": "gzip"},
        )
        assert gzip_resp.status_code == 200, gzip_resp.text
        assert gzip_resp.headers.get("content-encoding") == "gzip"
        assert gzip_resp.headers.get("vary") == "Accept-Encoding"
        # httpx 自动解压 resp.content；语义等价断言走 json 对比。
        assert gzip_resp.json() == identity_resp.json()

    async def test_gzip_stream_read_body_intact(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """流式读取 gzip 响应（浏览器 fetch 逐块消费路径）内容完整不截断。

        httpx 读流时自动解压，wire 层 gzip 事实由 content-encoding 头断言承载
        （上一用例）；本用例补大载荷在流式消费下端到端完整。
        """
        sess = await _seed_session_with_logs(db_session, log_count=8)

        identity_resp = await client.get(
            f"/api/daemon/sessions/{sess.id}/logs",
            headers={**auth_headers, "accept-encoding": "identity"},
        )
        assert identity_resp.status_code == 200, identity_resp.text

        raw_req = client.build_request(
            "GET",
            f"/api/daemon/sessions/{sess.id}/logs",
            headers={**auth_headers, "accept-encoding": "gzip"},
        )
        raw_resp = await client.send(raw_req, stream=True)
        try:
            raw_bytes = await raw_resp.aread()
        finally:
            await raw_resp.aclose()
        assert raw_resp.headers.get("content-encoding") == "gzip"
        payload = json.loads(raw_bytes.decode("utf-8"))
        assert payload == identity_resp.json()
        assert len(payload) == 8

    async def test_small_payload_skips_gzip(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """小载荷（≤1KB）即使接受 gzip 也回明文（压缩编码不值得开销）。"""
        sess = await _seed_session_with_logs(db_session, content="tiny", log_count=1)

        resp = await client.get(
            f"/api/daemon/sessions/{sess.id}/logs",
            headers={**auth_headers, "accept-encoding": "gzip"},
        )
        assert resp.status_code == 200, resp.text
        assert "content-encoding" not in resp.headers
        body = resp.json()
        assert len(body) == 1
        assert body[0]["content_redacted"].startswith("tiny")

    async def test_after_cursor_works_with_gzip(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """?after= 增量游标与压缩正交：gzip 路径同样只回 timestamp 严格更新的行。"""
        sess = await _seed_session_with_logs(db_session, log_count=3)
        all_resp = await client.get(
            f"/api/daemon/sessions/{sess.id}/logs",
            headers={**auth_headers, "accept-encoding": "gzip"},
        )
        assert all_resp.status_code == 200, all_resp.text
        entries = all_resp.json()
        assert len(entries) == 3
        after = entries[1]["timestamp"]
        inc_resp = await client.get(
            f"/api/daemon/sessions/{sess.id}/logs",
            headers={**auth_headers, "accept-encoding": "gzip"},
            params={"after": after},
        )
        assert inc_resp.status_code == 200, inc_resp.text
        assert [e["content_redacted"] for e in inc_resp.json()] == [entries[2]["content_redacted"]]

    async def test_no_gzip_accepted_returns_plain(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """客户端不接受 gzip（identity）→ 大载荷也回明文（兼容旧客户端）。"""
        sess = await _seed_session_with_logs(db_session)

        resp = await client.get(
            f"/api/daemon/sessions/{sess.id}/logs",
            headers={**auth_headers, "accept-encoding": "identity"},
        )
        assert resp.status_code == 200, resp.text
        assert "content-encoding" not in resp.headers
        assert len(resp.json()) == 1
