"""Terminal uplink idempotency tests（2026-08-29-daemon-platform-resilience task-07 / design A3）.

锁定 daemon 终态重放幂等——outbox 落箱的 run_result / session_end 由对账 /
心跳 drain 重放，backend 两端点对重复提交返回 200 no-op、无重复副作用与终态翻转：

* ``POST /leases/{id}/runs/{run_id}/result``（notifyRunResult 对应端点）：
  重复提交同 payload → 200 no-op（status 不变）；已 completed 的 run 被重放
  failed payload 也不翻转（终态守卫）；
* ``POST /sessions/{id}/end``（notifySessionEnd 对应端点）：重复提交同 payload
  → 200 no-op（status 保持 ended）；已 failed 的会话被重放 end 也不翻成 ended。

幂等实现现状（本 task 用例锁定）：close_interactive_run 的 TERMINAL_TURN_STATUSES
守卫 + end_session 的 ended/failed 终态早退，均为「首次提交语义不变，重放 200
no-op」——daemon 侧无需特殊处理（D-007@v1 选型）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease

# ── Seed helpers ─────────────────────────────────────────────────────────────


async def _seed_user(db_session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"term-idem-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await db_session.commit()
    return uid


async def _admin_id(db_session: AsyncSession) -> uuid.UUID:
    """auth_headers（admin Bearer）对应的用户 id——end 端点归属校验用。"""
    from app.modules.auth.model import User

    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None
    return admin.id


async def _seed_interactive(
    db_session: AsyncSession,
    *,
    user_id: uuid.UUID,
    session_status: str = "active",
    run_status: str = "running",
) -> tuple[AgentSession, AgentRun, DaemonTaskLease]:
    """runtime + interactive lease（claim_token）+ session + run 全链。"""
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
        lease_expires_at=now,
        metadata_={"claim_token": "tok-idem", "session_id": str(sess_id)},
    )
    db_session.add(lease)
    await db_session.flush()

    sess = AgentSession(
        id=sess_id,
        user_id=user_id,
        provider="claude",
        status=session_status,
        config={"manual_approval": False, "model": "claude"},
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
        status=run_status,
        spec_strategy="interactive",
        agent_session_id=sess.id,
    )
    db_session.add(run)
    await db_session.commit()
    await db_session.refresh(sess)
    await db_session.refresh(run)
    return sess, run, lease


def _result_body() -> dict:
    """notifyRunResult 的 body 形状（InteractiveRunResultRequest）。"""
    return {
        "status": "success",
        "is_error": False,
        "subtype": "success",
        "result_summary": "done",
    }


# ── runs/result 幂等 ─────────────────────────────────────────────────────────


class TestRunResultIdempotent:
    """POST /leases/{id}/runs/{run_id}/result 重复提交 → 200 no-op。"""

    @pytest.mark.asyncio
    async def test_same_payload_replay_200_noop(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """同 payload 重复提交：第二次 200 + status 保持 completed。"""
        uid = await _seed_user(db_session)
        _sess, run, lease = await _seed_interactive(db_session, user_id=uid)
        headers = {**auth_headers, "X-Claim-Token": "tok-idem"}
        url = f"/api/daemon/leases/{lease.id}/runs/{run.id}/result"

        first = await client.post(url, json=_result_body(), headers=headers)
        assert first.status_code == 200, first.text
        assert first.json()["status"] == "completed"

        # daemon outbox 重放（同 payload）。
        second = await client.post(url, json=_result_body(), headers=headers)
        assert second.status_code == 200, second.text
        assert second.json()["status"] == "completed"

        refreshed = (
            (
                await db_session.execute(
                    select(AgentRun)
                    .where(AgentRun.id == run.id)
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .one_or_none()
        )
        assert refreshed is not None
        assert refreshed.status == "completed"
        # 无重复副作用：finished_at 已写入（重放 no-op 不清空）。
        assert refreshed.finished_at is not None

    @pytest.mark.asyncio
    async def test_completed_run_not_flipped_by_failed_replay(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """已 completed 的 run 被重放 failed payload → 200 no-op 不翻转终态。"""
        uid = await _seed_user(db_session)
        _sess, run, lease = await _seed_interactive(db_session, user_id=uid)
        headers = {**auth_headers, "X-Claim-Token": "tok-idem"}
        url = f"/api/daemon/leases/{lease.id}/runs/{run.id}/result"

        ok = await client.post(url, json=_result_body(), headers=headers)
        assert ok.status_code == 200 and ok.json()["status"] == "completed"

        # 迟到的失败上报（乱序 / 旧 entry 重放）不得把 completed 翻成 failed。
        flipped = await client.post(
            url,
            json={"status": "error_during_execution", "is_error": True},
            headers=headers,
        )
        assert flipped.status_code == 200, flipped.text
        refreshed = (
            (
                await db_session.execute(
                    select(AgentRun)
                    .where(AgentRun.id == run.id)
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .one_or_none()
        )
        assert refreshed is not None
        assert refreshed.status == "completed"
        assert refreshed.exit_code == 0

    @pytest.mark.asyncio
    async def test_wrong_claim_token_403(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """claim_token 不匹配 → 403（鉴权链不变，幂等化不放松鉴权）。"""
        uid = await _seed_user(db_session)
        _sess, run, lease = await _seed_interactive(db_session, user_id=uid)
        resp = await client.post(
            f"/api/daemon/leases/{lease.id}/runs/{run.id}/result",
            json=_result_body(),
            headers={**auth_headers, "X-Claim-Token": "wrong"},
        )
        assert resp.status_code == 403, resp.text


# ── session end 幂等 ─────────────────────────────────────────────────────────


class TestSessionEndIdempotent:
    """POST /sessions/{id}/end 重复提交 → 200 no-op（终态不翻转）。"""

    @pytest.mark.asyncio
    async def test_same_payload_replay_200_noop(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """daemon notifySessionEnd 同 payload 重放：第二次 200 + 保持 ended。"""
        # Bearer 前端身份走 user_id 归属校验——会话须属当前 admin 用户。
        uid = await _admin_id(db_session)
        sess, run, _lease = await _seed_interactive(db_session, user_id=uid)
        url = f"/api/daemon/sessions/{sess.id}/end"
        body = {"status": "ended", "reason": "manual"}

        first = await client.post(url, json=body, headers=auth_headers)
        assert first.status_code == 200, first.text
        assert first.json()["status"] == "ended"

        second = await client.post(url, json=body, headers=auth_headers)
        assert second.status_code == 200, second.text
        assert second.json()["status"] == "ended"

        refreshed = (
            (
                await db_session.execute(
                    select(AgentSession)
                    .where(AgentSession.id == sess.id)
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .one_or_none()
        )
        assert refreshed is not None
        assert refreshed.status == "ended"
        # 挂起 run 首次 end 已收口 killed；重放不重复改写（幂等无副作用）。
        refreshed_run = (
            (
                await db_session.execute(
                    select(AgentRun)
                    .where(AgentRun.id == run.id)
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .one_or_none()
        )
        assert refreshed_run is not None
        assert refreshed_run.status == "killed"

    @pytest.mark.asyncio
    async def test_failed_session_not_flipped_to_ended(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """已 failed 的会话被重放 end（status=ended payload）→ no-op 保持 failed。"""
        uid = await _admin_id(db_session)
        sess, _run, _lease = await _seed_interactive(
            db_session, user_id=uid, session_status="failed"
        )

        resp = await client.post(
            f"/api/daemon/sessions/{sess.id}/end",
            json={"status": "ended", "reason": "manual"},
            headers=auth_headers,
        )

        assert resp.status_code == 200, resp.text
        refreshed = (
            (
                await db_session.execute(
                    select(AgentSession)
                    .where(AgentSession.id == sess.id)
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .one_or_none()
        )
        assert refreshed is not None
        # 终态覆写防护（P2）：failed 不被 end 翻成 ended。
        assert refreshed.status == "failed"
