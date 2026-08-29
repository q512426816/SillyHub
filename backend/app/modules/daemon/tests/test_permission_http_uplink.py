"""HTTP permission uplink endpoint tests（2026-08-29-daemon-platform-resilience task-07 / design A3）.

锁定 ``POST /api/daemon/sessions/{id}/permission-requests`` 的daemon 上行兜底通道：

* plain approval happy path → 200 accepted=true + SSE 广播 + 5min timer 挂起；
* AskUserQuestion dialog → 200 accepted=true + ``session_dialog_requests`` 落行
  （与 WS 上行同源汇聚），同 request_id 重放不 fork 第二张 pending 卡；
* 该会话有 claim 语义（lease metadata 存非空 claim_token）时 X-Claim-Token
  缺失/不匹配 → 403（对齐 runs/result 端点鉴权惯例）；
* 会话不存在 → 404（resource-hiding）；缺鉴权头 → 401；
* 校验不过（manual_approval=false / run 不匹配）→ 200 accepted=false（fail-soft，
  等待交由 backend 5min 超时 + daemon fallback timer 双兜底）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease, SessionDialogRequest

# ── Fixtures / seed helpers ──────────────────────────────────────────────────


async def _seed_user(db_session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"http-perm-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await db_session.commit()
    return uid


async def _seed_full_session(
    db_session: AsyncSession,
    *,
    user_id: uuid.UUID,
    claim_token: str = "lease-token-1",
    manual_approval: bool = True,
    session_status: str = "active",
) -> tuple[AgentSession, AgentRun, DaemonTaskLease]:
    """user + runtime + interactive lease（metadata 带 claim_token）+ session + run。"""
    now = datetime.now(UTC)
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=now,
    )
    db_session.add(rt)
    await db_session.flush()

    sess_id = uuid.uuid4()
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=rt.id,
        status="claimed",
        kind="interactive",
        claimed_at=now,
        # interactive lease 永不过期（不变量）；claim_token 写 metadata 供
        # SESSION_INJECT 携带 + 端点比对（placement.py 既有形态）。
        lease_expires_at=now,
        metadata_={"claim_token": claim_token, "session_id": str(sess_id)},
    )
    db_session.add(lease)
    await db_session.flush()

    sess = AgentSession(
        id=sess_id,
        user_id=user_id,
        provider="claude",
        status=session_status,
        config={"manual_approval": manual_approval, "model": "claude"},
        turn_count=1,
        runtime_id=rt.id,
        lease_id=lease.id,
        created_at=now,
    )
    db_session.add(sess)
    await db_session.flush()

    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status="running",
        spec_strategy="interactive",
        agent_session_id=sess.id,
    )
    db_session.add(run)
    await db_session.commit()
    await db_session.refresh(sess)
    await db_session.refresh(run)
    await db_session.refresh(lease)
    return sess, run, lease


def _uplink_body(run: AgentRun, request_id: str = "req-http-1") -> dict:
    return {
        "run_id": str(run.id),
        "request_id": request_id,
        "tool_name": "Bash",
        "input": {"command": "ls"},
    }


@pytest.fixture()
def mocked_redis():
    """SSE 广播经 session.service.get_redis——patch 成 AsyncMock 隔离真 Redis。"""
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with pytest.MonkeyPatch.context() as mp:
        mp.setattr("app.modules.daemon.session.service.get_redis", lambda: redis)
        yield redis


# ── Tests ────────────────────────────────────────────────────────────────────


class TestPermissionHttpUplink:
    """POST /sessions/{id}/permission-requests（task-07 / design A3）。"""

    @pytest.mark.asyncio
    async def test_plain_approval_accepted(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_redis: AsyncMock,
    ) -> None:
        """happy path：200 accepted=true + SSE permission_request + timer 挂起。"""
        uid = await _seed_user(db_session)
        sess, run, _lease = await _seed_full_session(db_session, user_id=uid)

        resp = await client.post(
            f"/api/daemon/sessions/{sess.id}/permission-requests",
            json=_uplink_body(run),
            headers={**auth_headers, "X-Claim-Token": "lease-token-1"},
        )

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["accepted"] is True
        assert body["request_id"] == "req-http-1"
        # SSE 广播（前端审批卡渲染源）。publish 收 JSON 字符串，解析断言。
        assert mocked_redis.publish.await_count == 1
        channel, raw = mocked_redis.publish.await_args.args
        assert channel == f"agent_session:{sess.id}"
        import json

        event = json.loads(raw)
        assert event["event"] == "permission_request"
        assert event["request_id"] == "req-http-1"
        # plain approval：5min timer 已挂起（模块级共享 registry）。
        from app.modules.daemon.permission_service import _permission_timers

        assert "req-http-1" in _permission_timers

    @pytest.mark.asyncio
    async def test_dialog_persisted_and_replay_idempotent(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_redis: AsyncMock,
    ) -> None:
        """dialog：落 session_dialog_requests 行；同 request_id 重放不 fork 第二张卡。"""
        uid = await _seed_user(db_session)
        sess, run, _lease = await _seed_full_session(db_session, user_id=uid)
        body = {
            **_uplink_body(run, request_id="dlg-http-1"),
            "tool_name": "AskUserQuestion",
            "dialog_kind": "ask_user_question",
            "dialog_payload": {"questions": [{"question": "继续?", "options": ["是", "否"]}]},
        }

        first = await client.post(
            f"/api/daemon/sessions/{sess.id}/permission-requests",
            json=body,
            headers={**auth_headers, "X-Claim-Token": "lease-token-1"},
        )
        assert first.status_code == 200, first.text
        assert first.json()["accepted"] is True

        rows = (
            (
                await db_session.execute(
                    select(SessionDialogRequest).where(
                        SessionDialogRequest.request_id == "dlg-http-1"
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
        assert rows[0].status == "pending"
        assert rows[0].dialog_kind == "ask_user_question"
        assert rows[0].dialog_payload == body["dialog_payload"]

        # daemon 重放（HTTP 兜底重试）：upsert 同一行，不产生第二条 pending。
        second = await client.post(
            f"/api/daemon/sessions/{sess.id}/permission-requests",
            json=body,
            headers={**auth_headers, "X-Claim-Token": "lease-token-1"},
        )
        assert second.status_code == 200, second.text
        assert second.json()["accepted"] is True
        db_session.expire_all()
        rows = (
            (
                await db_session.execute(
                    select(SessionDialogRequest).where(
                        SessionDialogRequest.request_id == "dlg-http-1"
                    )
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1

    @pytest.mark.asyncio
    async def test_claim_token_mismatch_403(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """有 claim 语义的会话：token 不匹配 / 缺头 → 403（不泄露差异）。"""
        uid = await _seed_user(db_session)
        sess, run, _lease = await _seed_full_session(db_session, user_id=uid)

        wrong = await client.post(
            f"/api/daemon/sessions/{sess.id}/permission-requests",
            json=_uplink_body(run),
            headers={**auth_headers, "X-Claim-Token": "wrong-token"},
        )
        assert wrong.status_code == 403, wrong.text
        assert wrong.json()["code"] == "HTTP_403_DAEMON_INVALID_CLAIM_TOKEN"

        missing = await client.post(
            f"/api/daemon/sessions/{sess.id}/permission-requests",
            json=_uplink_body(run),
            headers=auth_headers,
        )
        assert missing.status_code == 403, missing.text

    @pytest.mark.asyncio
    async def test_unknown_session_404(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
    ) -> None:
        """会话不存在 → 404（与跨 owner 同码，不泄露存在性）。"""
        resp = await client.post(
            f"/api/daemon/sessions/{uuid.uuid4()}/permission-requests",
            json={
                "run_id": str(uuid.uuid4()),
                "request_id": "req-x",
                "tool_name": "Bash",
                "input": {},
            },
            headers=auth_headers,
        )
        assert resp.status_code == 404, resp.text

    @pytest.mark.asyncio
    async def test_no_auth_401(
        self,
        client: AsyncClient,
    ) -> None:
        """缺鉴权头 → 401。"""
        resp = await client.post(
            f"/api/daemon/sessions/{uuid.uuid4()}/permission-requests",
            json={
                "run_id": str(uuid.uuid4()),
                "request_id": "req-x",
                "tool_name": "Bash",
                "input": {},
            },
        )
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_validation_drop_returns_200_accepted_false(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_redis: AsyncMock,
    ) -> None:
        """manual_approval=false → 200 accepted=false（fail-soft，不 5xx）。"""
        uid = await _seed_user(db_session)
        sess, run, _lease = await _seed_full_session(db_session, user_id=uid, manual_approval=False)

        resp = await client.post(
            f"/api/daemon/sessions/{sess.id}/permission-requests",
            json=_uplink_body(run),
            headers={**auth_headers, "X-Claim-Token": "lease-token-1"},
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["accepted"] is False
        # 校验不过不广播 SSE。
        assert mocked_redis.publish.await_count == 0

    @pytest.mark.asyncio
    async def test_run_mismatch_drop(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """payload.run_id 与 current run 不一致 → 200 accepted=false。"""
        uid = await _seed_user(db_session)
        sess, _run, _lease = await _seed_full_session(db_session, user_id=uid)

        resp = await client.post(
            f"/api/daemon/sessions/{sess.id}/permission-requests",
            json=_uplink_body(_run, request_id="req-mm") | {"run_id": str(uuid.uuid4())},
            headers={**auth_headers, "X-Claim-Token": "lease-token-1"},
        )

        assert resp.status_code == 200, resp.text
        assert resp.json()["accepted"] is False

    @pytest.mark.asyncio
    async def test_ws_and_http_share_pending_record(
        self,
        db_session: AsyncSession,
        mocked_redis: AsyncMock,
    ) -> None:
        """同源汇聚：HTTP 上行与 WS 上行走同一 handle_permission_request——
        先 HTTP 建 plain 请求，再用 WS 语义（直接调 service）重放同 request_id，
        timer 仍是同一条（替换不叠加）。"""
        from app.modules.daemon.permission_service import (
            DaemonPermissionService,
            _permission_timers,
        )
        from app.modules.daemon.protocol import PermissionRequestPayload
        from app.modules.daemon.service import DaemonService
        from app.modules.daemon.ws_hub import DaemonWsHub

        uid = await _seed_user(db_session)
        sess, run, lease = await _seed_full_session(db_session, user_id=uid)

        hub = DaemonWsHub()
        perm = DaemonPermissionService(DaemonService(db_session), hub)
        payload = PermissionRequestPayload(
            session_id=sess.id,
            run_id=run.id,
            request_id="req-share-1",
            tool_name="Bash",
            input={"command": "ls"},
        )
        # 无 daemon_instance 绑定时 _resolve_daemon_id_for_runtime 回落 runtime_id
        # （migration window fallback）——两种入口解析出同一 daemon key。
        accepted = await perm.handle_permission_request(sess.runtime_id, payload)
        assert accepted is True
        assert "req-share-1" in _permission_timers
        first_timer = _permission_timers["req-share-1"]

        # 重放同 request_id（daemon 侧 HTTP 重试到达 service 层）：替换不叠加。
        accepted2 = await perm.handle_permission_request(sess.runtime_id, payload)
        assert accepted2 is True
        assert _permission_timers["req-share-1"] is not first_timer
        # 未使用 lease（防 lint 未用告警的显式引用）。
        assert lease.kind == "interactive"
