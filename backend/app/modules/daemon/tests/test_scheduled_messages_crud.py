"""task-06（2026-09-07-session-pin-rename-scheduled-send）：定时消息 CRUD 三端点测试.

覆盖 FR-04 / D-001@v1（design §接口定义·测试清单）：

- 创建：成功 201（status=pending、快照字段原样落库、sender_user_id=当前用户）；
  ``dispatch_at`` 过去 / 早于 now+60s → 422；prompt 与附件全空 → 422（附件非空
  豁免，D-7 口径）；终态（ended/failed）/ 软删会话 → 409；非归属 / 不存在 → 404
  同形不泄露；
- 列表：返回该会话**全部状态**条目（dispatched/cancelled/failed 审计留档），
  按 ``dispatch_at`` 升序；
- 取消：pending → 204 置 cancelled + cancelled_at；非 pending（dispatched/
  cancelled/failed）→ 409；跨会话条目 / 非归属 → 404。

HTTP 层范式镜像 test_sessions_list_filters.py（in-memory SQLite + httpx client）；
造数时间一律 UTC tz-aware，落库读回 naive（SQLite 惯例，比较侧归一）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.engine import Row
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentSession, AgentSessionScheduledMessage
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonRuntime

# ── Helpers ─────────────────────────────────────────────────────────────────


async def _get_admin(db_session: AsyncSession) -> User:
    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None
    return admin


async def _make_user(db: AsyncSession, email: str) -> User:
    user = User(
        id=uuid.uuid4(),
        email=email,
        password_hash="x",
        display_name=email.split("@")[0],
        status="active",
    )
    db.add(user)
    await db.commit()
    return user


async def _make_runtime(db: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db.add(rt)
    await db.commit()
    return rt


async def _make_session(
    db: AsyncSession,
    user_id: uuid.UUID,
    runtime_id: uuid.UUID | None,
    *,
    status: str = "active",
    deleted_at: datetime | None = None,
) -> AgentSession:
    now = datetime.now(UTC)
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime_id,
        lease_id=None,
        provider="claude",
        status=status,
        agent_session_id=None,
        turn_count=1,
        created_at=now,
        last_active_at=now,
        ended_at=now if status in ("ended", "failed") else None,
        deleted_at=deleted_at,
    )
    db.add(sess)
    await db.commit()
    return sess


async def _make_scheduled(
    db: AsyncSession,
    session_id: uuid.UUID,
    sender_user_id: uuid.UUID,
    *,
    prompt: str = "定时消息",
    dispatch_at: datetime,
    status: str = "pending",
) -> AgentSessionScheduledMessage:
    """直接落一行定时条目（状态/时间可控，列表与取消用例造数）。"""
    row = AgentSessionScheduledMessage(
        agent_session_id=session_id,
        sender_user_id=sender_user_id,
        prompt=prompt,
        dispatch_at=dispatch_at,
        status=status,
        cancelled_at=datetime.now(UTC) if status == "cancelled" else None,
        dispatched_at=datetime.now(UTC) if status == "dispatched" else None,
    )
    db.add(row)
    await db.commit()
    return row


async def _row(db: AsyncSession, message_id: uuid.UUID) -> Row:
    """列级直查（绕开 identity map）：(status, error_code, cancelled_at, dispatched_at)。"""
    return (
        await db.execute(
            select(
                AgentSessionScheduledMessage.status,
                AgentSessionScheduledMessage.error_code,
                AgentSessionScheduledMessage.cancelled_at,
                AgentSessionScheduledMessage.dispatched_at,
            ).where(AgentSessionScheduledMessage.id == message_id)
        )
    ).one()


def _future_iso(seconds: int) -> str:
    return (datetime.now(UTC) + timedelta(seconds=seconds)).isoformat()


# ── 创建（POST /sessions/{id}/scheduled）───────────────────────────────────


class TestCreateScheduled:
    async def test_create_success_201_pending_snapshot(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """成功：201 + status=pending；快照字段原样落库（附件转 str），sender=当前用户。"""
        admin = await _get_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(db_session, admin.id, rt.id)
        attachment = uuid.uuid4()

        resp = await client.post(
            f"/api/daemon/sessions/{sess.id}/scheduled",
            json={
                "prompt": "明早九点继续重构",
                "dispatch_at": _future_iso(30 * 60),
                "attachment_ids": [str(attachment)],
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["status"] == "pending"
        assert body["agent_session_id"] == str(sess.id)
        assert body["prompt"] == "明早九点继续重构"
        assert body["attachment_ids"] == [str(attachment)]
        assert body["error_code"] is None and body["error_message"] is None
        assert body["dispatched_at"] is None and body["cancelled_at"] is None

        stored = (
            await db_session.execute(
                select(
                    AgentSessionScheduledMessage.status,
                    AgentSessionScheduledMessage.sender_user_id,
                    AgentSessionScheduledMessage.attachment_ids,
                ).where(AgentSessionScheduledMessage.id == uuid.UUID(body["id"]))
            )
        ).one()
        assert stored.status == "pending"
        assert stored.sender_user_id == admin.id
        assert stored.attachment_ids == [str(attachment)]

    async def test_create_dispatch_too_soon_422_not_persisted(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """过去时间 / now+60s 以内（30s 档）→ 422 不落库（防「刚建即过期」竞态）。"""
        admin = await _get_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(db_session, admin.id, rt.id)

        for bad_at in (_future_iso(-3600), _future_iso(30)):
            resp = await client.post(
                f"/api/daemon/sessions/{sess.id}/scheduled",
                json={"prompt": "过期条目", "dispatch_at": bad_at},
                headers=auth_headers,
            )
            assert resp.status_code == 422, f"dispatch_at={bad_at}: {resp.text}"

        count = (
            await db_session.execute(
                select(AgentSessionScheduledMessage.id).where(
                    AgentSessionScheduledMessage.agent_session_id == sess.id
                )
            )
        ).all()
        assert count == []

    async def test_create_empty_prompt_without_attachments_422(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """prompt 空串 / 全空白且无附件 → 422（与 inject 空内容拒绝同口径）。"""
        admin = await _get_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(db_session, admin.id, rt.id)

        for bad_prompt in ("", "   "):
            resp = await client.post(
                f"/api/daemon/sessions/{sess.id}/scheduled",
                json={"prompt": bad_prompt, "dispatch_at": _future_iso(30 * 60)},
                headers=auth_headers,
            )
            assert resp.status_code == 422, f"prompt={bad_prompt!r}: {resp.text}"

    async def test_create_attachments_exempt_empty_prompt(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """附件非空豁免空 prompt（D-7 看图说话口径）→ 201 正常落库。"""
        admin = await _get_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(db_session, admin.id, rt.id)

        resp = await client.post(
            f"/api/daemon/sessions/{sess.id}/scheduled",
            json={
                "prompt": "",
                "dispatch_at": _future_iso(30 * 60),
                "attachment_ids": [str(uuid.uuid4())],
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201, resp.text
        assert resp.json()["status"] == "pending"

    async def test_create_terminal_or_deleted_session_409(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """终态（ended/failed）与软删（active + deleted_at）会话 → 409 不落库。"""
        admin = await _get_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        ended = await _make_session(db_session, admin.id, rt.id, status="ended")
        failed = await _make_session(db_session, admin.id, rt.id, status="failed")
        deleted = await _make_session(db_session, admin.id, rt.id, deleted_at=datetime.now(UTC))

        for target in (ended, failed, deleted):
            resp = await client.post(
                f"/api/daemon/sessions/{target.id}/scheduled",
                json={"prompt": "终态会话定时", "dispatch_at": _future_iso(30 * 60)},
                headers=auth_headers,
            )
            assert resp.status_code == 409, resp.text

        total = (await db_session.execute(select(AgentSessionScheduledMessage.id))).all()
        assert total == []

    async def test_create_not_owner_and_missing_404_no_leak(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """非归属 / 不存在会话 → 404 同形（不泄露存在性），不落库。"""
        other = await _make_user(db_session, f"other-{uuid.uuid4()}@example.com")
        rt_other = await _make_runtime(db_session, other.id)
        others_sess = await _make_session(db_session, other.id, rt_other.id)

        resp_other = await client.post(
            f"/api/daemon/sessions/{others_sess.id}/scheduled",
            json={"prompt": "越权定时", "dispatch_at": _future_iso(30 * 60)},
            headers=auth_headers,
        )
        resp_missing = await client.post(
            f"/api/daemon/sessions/{uuid.uuid4()}/scheduled",
            json={"prompt": "定时", "dispatch_at": _future_iso(30 * 60)},
            headers=auth_headers,
        )
        assert resp_other.status_code == 404, resp_other.text
        assert resp_missing.status_code == 404, resp_missing.text

        rows = (await db_session.execute(select(AgentSessionScheduledMessage.id))).all()
        assert rows == []


# ── 列表（GET /sessions/{id}/scheduled）───────────────────────────────────


class TestListScheduled:
    async def test_list_all_statuses_dispatch_at_asc(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """全部状态一并返回（审计留档），按 dispatch_at 升序；他会话条目不串扰。"""
        admin = await _get_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(db_session, admin.id, rt.id)
        # 故意乱序落库（12:00 pending / 09:00 dispatched / 15:00 cancelled / 08:00 failed）
        pending = await _make_scheduled(
            db_session,
            sess.id,
            admin.id,
            prompt="中午的",
            dispatch_at=datetime(2030, 1, 1, 12, 0, 0),
        )
        dispatched = await _make_scheduled(
            db_session,
            sess.id,
            admin.id,
            prompt="早上的",
            dispatch_at=datetime(2030, 1, 1, 9, 0, 0),
            status="dispatched",
        )
        cancelled = await _make_scheduled(
            db_session,
            sess.id,
            admin.id,
            prompt="下午的",
            dispatch_at=datetime(2030, 1, 1, 15, 0, 0),
            status="cancelled",
        )
        failed = await _make_scheduled(
            db_session,
            sess.id,
            admin.id,
            prompt="清晨的",
            dispatch_at=datetime(2030, 1, 1, 8, 0, 0),
            status="failed",
        )
        # 同属主另一会话的条目不得泄入本会话列表
        other_sess = await _make_session(db_session, admin.id, rt.id)
        await _make_scheduled(
            db_session,
            other_sess.id,
            admin.id,
            prompt="别的会话",
            dispatch_at=datetime(2030, 1, 1, 7, 0, 0),
        )

        resp = await client.get(f"/api/daemon/sessions/{sess.id}/scheduled", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert [i["id"] for i in body] == [
            str(failed.id),
            str(dispatched.id),
            str(pending.id),
            str(cancelled.id),
        ]
        status_by_id = {i["id"]: i["status"] for i in body}
        assert status_by_id[str(pending.id)] == "pending"
        assert status_by_id[str(dispatched.id)] == "dispatched"
        assert status_by_id[str(cancelled.id)] == "cancelled"
        assert status_by_id[str(failed.id)] == "failed"

    async def test_list_not_owner_and_missing_404(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """非归属 / 不存在会话 → 404 同形（归属校验先于列表查询）。"""
        other = await _make_user(db_session, f"other-{uuid.uuid4()}@example.com")
        rt_other = await _make_runtime(db_session, other.id)
        others_sess = await _make_session(db_session, other.id, rt_other.id)

        resp_other = await client.get(
            f"/api/daemon/sessions/{others_sess.id}/scheduled", headers=auth_headers
        )
        resp_missing = await client.get(
            f"/api/daemon/sessions/{uuid.uuid4()}/scheduled", headers=auth_headers
        )
        assert resp_other.status_code == 404, resp_other.text
        assert resp_missing.status_code == 404, resp_missing.text


# ── 取消（DELETE /sessions/{id}/scheduled/{mid}）───────────────────────────


class TestCancelScheduled:
    async def test_cancel_pending_204_sets_cancelled_at(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """pending 条目取消 → 204；行置 cancelled + cancelled_at 留档。"""
        admin = await _get_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(db_session, admin.id, rt.id)
        created = await client.post(
            f"/api/daemon/sessions/{sess.id}/scheduled",
            json={"prompt": "待取消", "dispatch_at": _future_iso(2 * 3600)},
            headers=auth_headers,
        )
        assert created.status_code == 201, created.text
        message_id = created.json()["id"]

        resp = await client.delete(
            f"/api/daemon/sessions/{sess.id}/scheduled/{message_id}", headers=auth_headers
        )
        assert resp.status_code == 204, resp.text

        status, _err, cancelled_at, _disp = await _row(db_session, uuid.UUID(message_id))
        assert status == "cancelled"
        assert cancelled_at is not None

    async def test_cancel_non_pending_409(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """dispatched / cancelled / failed 均终态不回退 → 409，状态原样。"""
        admin = await _get_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess = await _make_session(db_session, admin.id, rt.id)
        at = datetime(2030, 1, 1, 10, 0, 0)
        rows = {
            status: await _make_scheduled(
                db_session, sess.id, admin.id, dispatch_at=at, status=status
            )
            for status in ("dispatched", "cancelled", "failed")
        }

        for status, row in rows.items():
            resp = await client.delete(
                f"/api/daemon/sessions/{sess.id}/scheduled/{row.id}", headers=auth_headers
            )
            assert resp.status_code == 409, f"status={status}: {resp.text}"
            after, _err, _cat, _dat = await _row(db_session, row.id)
            assert after == status  # 终态不被取消改写

    async def test_cancel_cross_session_entry_404(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """条目挂在同属主另一会话上 → 经本会话路径取消 404（条目仍 pending）。"""
        admin = await _get_admin(db_session)
        rt = await _make_runtime(db_session, admin.id)
        sess_a = await _make_session(db_session, admin.id, rt.id)
        sess_b = await _make_session(db_session, admin.id, rt.id)
        entry = await _make_scheduled(
            db_session, sess_b.id, admin.id, dispatch_at=datetime(2030, 1, 1, 10, 0, 0)
        )

        resp = await client.delete(
            f"/api/daemon/sessions/{sess_a.id}/scheduled/{entry.id}", headers=auth_headers
        )
        assert resp.status_code == 404, resp.text
        status, _err, cancelled_at, _disp = await _row(db_session, entry.id)
        assert status == "pending"
        assert cancelled_at is None

    async def test_cancel_not_owner_404(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """他人会话的条目 → 404 不泄露（条目不动）。"""
        other = await _make_user(db_session, f"other-{uuid.uuid4()}@example.com")
        rt_other = await _make_runtime(db_session, other.id)
        others_sess = await _make_session(db_session, other.id, rt_other.id)
        entry = await _make_scheduled(
            db_session,
            others_sess.id,
            other.id,
            dispatch_at=datetime(2030, 1, 1, 10, 0, 0),
        )

        resp = await client.delete(
            f"/api/daemon/sessions/{others_sess.id}/scheduled/{entry.id}", headers=auth_headers
        )
        assert resp.status_code == 404, resp.text
        status, _err, _cat, _disp = await _row(db_session, entry.id)
        assert status == "pending"
