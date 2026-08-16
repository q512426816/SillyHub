"""task-09（2026-06-26-daemon-client-spec-sync-fix）：daemon change-write
任务队列回执三端点单测。

覆盖 FR-08 / D-004@v1 / NFR-03：
  - pending：daemon 轮询拿到 pending 行（按 created_at 排序）。
  - claim 幂等：同 id 二次 claim 拒（409）；并发两 daemon 抢同一行仅一方得手。
  - complete：ok 落 done / 失败落 failed；token 错或状态不符 → 409。
  - gc（NFR-03）：claimed 行超 60s 被置 failed。

直接调端点 async 函数（函数即端点），user 形参传 mock User，聚焦状态机逻辑，
不纠缠 HTTP 鉴权（鉴权由 get_current_principal 在路由层处理，单测不复测）。
SQLite 测库无 FOR UPDATE SKIP LOCKED，走退化分支（事务内状态校验），断言只看
终态行数/状态，不绑死 SQL 方言。
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.daemon.change_write_router import (
    DaemonChangeWriteNotClaimed,
    DaemonChangeWriteNotPending,
    DaemonChangeWriteTokenMismatch,
    _gc_expired_change_writes,
    claim_change_write,
    complete_change_write,
    get_pending_change_writes,
    report_change_write_progress,
)
from app.modules.daemon.model import DaemonChangeWrite
from app.modules.daemon.tests.test_lease_service import (
    _create_runtime,
    _create_user,
)
from app.modules.workspace.model import Workspace


async def _create_workspace(session: AsyncSession, owner_id: uuid.UUID) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="test-ws",
        slug=f"ws-{uuid.uuid4().hex[:8]}",
        root_path="/tmp/test-ws",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _create_change_write(
    session: AsyncSession,
    *,
    runtime_id: uuid.UUID,
    workspace_id: uuid.UUID,
    change_key: str = "2026-06-26-x",
    status: str = "pending",
    claim_token: str | None = None,
    claimed_at: datetime | None = None,
    created_at: datetime | None = None,
    kind: str = "create",
) -> DaemonChangeWrite:
    cw = DaemonChangeWrite(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        runtime_id=runtime_id,
        change_key=change_key,
        files=[{"path": "proposal.md", "content": "x"}],
        status=status,
        claim_token=claim_token,
        claimed_at=claimed_at,
        created_at=created_at or datetime.now(UTC),
        kind=kind,
    )
    session.add(cw)
    await session.commit()
    await session.refresh(cw)
    return cw


def _mock_user() -> Any:
    """端点 user 形参占位（鉴权在路由层完成，函数层只接收已鉴权 principal）。"""
    return SimpleNamespace(id=uuid.uuid4())


class TestPendingChangeWrites:
    @pytest.mark.asyncio
    async def test_pending_returns_only_pending_ordered_by_created_at(
        self, db_session: AsyncSession
    ) -> None:
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session, user_id)
        base = datetime.now(UTC) - timedelta(minutes=5)
        # 3 行：2 pending（顺序颠倒插入，验证 ORDER BY）+ 1 done（应被过滤）
        await _create_change_write(
            db_session,
            runtime_id=rt.id,
            workspace_id=ws.id,
            change_key="late",
            created_at=base + timedelta(seconds=10),
        )
        await _create_change_write(
            db_session,
            runtime_id=rt.id,
            workspace_id=ws.id,
            change_key="early",
            created_at=base,
        )
        await _create_change_write(
            db_session,
            runtime_id=rt.id,
            workspace_id=ws.id,
            change_key="done-one",
            status="done",
            created_at=base,
        )

        items = await get_pending_change_writes(rt.id, db_session, _mock_user())
        assert [i.change_key for i in items] == ["early", "late"]
        assert all(i.workspace_id == ws.id for i in items)
        assert all(i.files == [{"path": "proposal.md", "content": "x"}] for i in items)

    @pytest.mark.asyncio
    async def test_pending_filters_other_runtime(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session)
        rt_a = await _create_runtime(db_session, user_id)
        rt_b = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session, user_id)
        await _create_change_write(
            db_session, runtime_id=rt_a.id, workspace_id=ws.id, change_key="a"
        )
        await _create_change_write(
            db_session, runtime_id=rt_b.id, workspace_id=ws.id, change_key="b"
        )

        items = await get_pending_change_writes(rt_a.id, db_session, _mock_user())
        assert [i.change_key for i in items] == ["a"]


class TestClaim:
    @pytest.mark.asyncio
    async def test_claim_pending_returns_token_and_flips_status(
        self, db_session: AsyncSession
    ) -> None:
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session, user_id)
        cw = await _create_change_write(db_session, runtime_id=rt.id, workspace_id=ws.id)

        resp = await claim_change_write(cw.id, db_session, _mock_user())
        assert resp.task_id == cw.id
        assert len(resp.claim_token) >= 32
        assert resp.change_key == cw.change_key
        assert resp.files == [{"path": "proposal.md", "content": "x"}]

        await db_session.refresh(cw)
        assert cw.status == "claimed"
        assert cw.claim_token == resp.claim_token
        assert cw.claimed_at is not None

    @pytest.mark.asyncio
    async def test_claim_already_claimed_rejected_409(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session, user_id)
        cw = await _create_change_write(
            db_session,
            runtime_id=rt.id,
            workspace_id=ws.id,
            status="claimed",
            claim_token="existing",
        )

        with pytest.raises(DaemonChangeWriteNotPending) as exc:
            await claim_change_write(cw.id, db_session, _mock_user())
        assert exc.value.http_status == 409

    @pytest.mark.asyncio
    async def test_claim_concurrent_only_one_wins(self, db_session: AsyncSession) -> None:
        """两 daemon 并发抢同一 pending 行：仅一方得手，另一方 409。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session, user_id)
        cw = await _create_change_write(db_session, runtime_id=rt.id, workspace_id=ws.id)

        # SQLite 单连接写串行化：两任务在事件循环里交替，第一个 commit 落 claimed
        # 后第二个读到 claimed 状态 → 拒。终态断言：恰好一方得手。
        results = await asyncio.gather(
            claim_change_write(cw.id, db_session, _mock_user()),
            claim_change_write(cw.id, db_session, _mock_user()),
            return_exceptions=True,
        )
        wins = [r for r in results if not isinstance(r, Exception)]
        rejects = [r for r in results if isinstance(r, DaemonChangeWriteNotPending)]
        assert len(wins) == 1
        assert len(rejects) == 1


class TestComplete:
    @pytest.mark.asyncio
    async def test_complete_ok_lands_done(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session, user_id)
        cw = await _create_change_write(
            db_session,
            runtime_id=rt.id,
            workspace_id=ws.id,
            status="claimed",
            claim_token="tok-1",
        )

        resp = await complete_change_write(
            cw.id,
            SimpleNamespace(
                claim_token="tok-1",
                ok=True,
                files=[{"path": "proposal.md", "content": "done"}],
                error=None,
            ),
            db_session,
            _mock_user(),
        )
        assert resp["status"] == "done"
        await db_session.refresh(cw)
        assert cw.status == "done"
        assert cw.completed_at is not None
        assert cw.files == [{"path": "proposal.md", "content": "done"}]

    @pytest.mark.asyncio
    async def test_complete_failed_lands_failed_with_error(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session, user_id)
        cw = await _create_change_write(
            db_session,
            runtime_id=rt.id,
            workspace_id=ws.id,
            status="claimed",
            claim_token="tok-1",
        )

        resp = await complete_change_write(
            cw.id,
            SimpleNamespace(claim_token="tok-1", ok=False, files=None, error="boom"),
            db_session,
            _mock_user(),
        )
        assert resp["status"] == "failed"
        await db_session.refresh(cw)
        assert cw.status == "failed"
        assert cw.error == "boom"

    @pytest.mark.asyncio
    async def test_complete_wrong_token_rejected_409(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session, user_id)
        cw = await _create_change_write(
            db_session,
            runtime_id=rt.id,
            workspace_id=ws.id,
            status="claimed",
            claim_token="tok-1",
        )

        with pytest.raises(DaemonChangeWriteTokenMismatch) as exc:
            await complete_change_write(
                cw.id,
                SimpleNamespace(claim_token="wrong", ok=True, files=None, error=None),
                db_session,
                _mock_user(),
            )
        assert exc.value.http_status == 409

    @pytest.mark.asyncio
    async def test_complete_not_claimed_rejected_409(self, db_session: AsyncSession) -> None:
        """状态不符（仍 pending 或已 done）→ 409。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session, user_id)
        cw = await _create_change_write(
            db_session,
            runtime_id=rt.id,
            workspace_id=ws.id,
            status="pending",  # 没 claim 就直接 complete
        )

        with pytest.raises(DaemonChangeWriteNotClaimed):
            await complete_change_write(
                cw.id,
                SimpleNamespace(claim_token="whatever", ok=True, files=None, error=None),
                db_session,
                _mock_user(),
            )


class TestReportChangeWriteProgress:
    """ql-20260813-spec-sync-visibility task-11：progress 端点单测。

    覆盖 BL-3（status==claimed 才允许写，pending/done/failed 一律 409）+ D-004
    （单一写者——progress 只写 files_total/processed，不改 status/completed_at）+
    claim_token 校验 + 部分字段写入。
    """

    @pytest.mark.asyncio
    async def test_progress_claimed_writes_counts_no_status_change(
        self, db_session: AsyncSession
    ) -> None:
        """claimed + token 匹配 → 写 files_total/processed，不改 status/completed_at（D-004）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session, user_id)
        cw = await _create_change_write(
            db_session,
            runtime_id=rt.id,
            workspace_id=ws.id,
            status="claimed",
            claim_token="tok-1",
        )

        resp = await report_change_write_progress(
            cw.id,
            SimpleNamespace(claim_token="tok-1", files_total=20, files_processed=8),
            db_session,
            _mock_user(),
        )
        assert resp["files_total"] == 20
        assert resp["files_processed"] == 8
        await db_session.refresh(cw)
        assert cw.files_total == 20
        assert cw.files_processed == 8
        # D-004：progress 不改 status / completed_at（终态仍由 complete 置）
        assert cw.status == "claimed"
        assert cw.completed_at is None

    @pytest.mark.asyncio
    async def test_progress_partial_fields_write(self, db_session: AsyncSession) -> None:
        """只传 files_total（files_processed=None）→ 仅写 files_total。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session, user_id)
        cw = await _create_change_write(
            db_session,
            runtime_id=rt.id,
            workspace_id=ws.id,
            status="claimed",
            claim_token="tok-1",
        )

        await report_change_write_progress(
            cw.id,
            SimpleNamespace(claim_token="tok-1", files_total=15, files_processed=None),
            db_session,
            _mock_user(),
        )
        await db_session.refresh(cw)
        assert cw.files_total == 15
        assert cw.files_processed is None

    @pytest.mark.asyncio
    @pytest.mark.parametrize("status", ["pending", "done", "failed"])
    async def test_progress_non_claimed_rejected_409(
        self, db_session: AsyncSession, status: str
    ) -> None:
        """BL-3：status != claimed 一律 409（pending/done/failed 全拒，防重放/篡改）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session, user_id)
        cw = await _create_change_write(
            db_session,
            runtime_id=rt.id,
            workspace_id=ws.id,
            status=status,
            claim_token="tok-1" if status != "pending" else None,
        )

        with pytest.raises(DaemonChangeWriteNotClaimed):
            await report_change_write_progress(
                cw.id,
                SimpleNamespace(claim_token="tok-1", files_total=10, files_processed=5),
                db_session,
                _mock_user(),
            )

    @pytest.mark.asyncio
    async def test_progress_wrong_token_rejected_409(self, db_session: AsyncSession) -> None:
        """claimed 但 token 不匹配 → 409（DaemonChangeWriteTokenMismatch）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session, user_id)
        cw = await _create_change_write(
            db_session,
            runtime_id=rt.id,
            workspace_id=ws.id,
            status="claimed",
            claim_token="tok-1",
        )

        with pytest.raises(DaemonChangeWriteTokenMismatch):
            await report_change_write_progress(
                cw.id,
                SimpleNamespace(claim_token="wrong", files_total=10, files_processed=5),
                db_session,
                _mock_user(),
            )


class TestGcExpiredChangeWrites:
    @pytest.mark.asyncio
    async def test_gc_times_out_claimed_over_60s(self, db_session: AsyncSession) -> None:
        """claimed_at 早于 now-60s 的行被回灌 pending（ql-20260816-004 自动重试），非 failed。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session, user_id)
        stale = datetime.now(UTC) - timedelta(seconds=90)
        fresh = datetime.now(UTC) - timedelta(seconds=10)
        cw_stale = await _create_change_write(
            db_session,
            runtime_id=rt.id,
            workspace_id=ws.id,
            status="claimed",
            claim_token="t1",
            claimed_at=stale,
        )
        cw_fresh = await _create_change_write(
            db_session,
            runtime_id=rt.id,
            workspace_id=ws.id,
            change_key="fresh",
            status="claimed",
            claim_token="t2",
            claimed_at=fresh,
        )

        count = await _gc_expired_change_writes(db_session)
        assert count == 1

        await db_session.refresh(cw_stale)
        await db_session.refresh(cw_fresh)
        # 回灌 pending 供下轮重 claim；清空 claim 态（token/claimed_at/error）。
        assert cw_stale.status == "pending"
        assert cw_stale.claim_token is None
        assert cw_stale.claimed_at is None
        assert cw_stale.error is None
        assert cw_fresh.status == "claimed"  # 未超时，保持

    @pytest.mark.asyncio
    async def test_gc_reclaimed_row_is_reclaimable(self, db_session: AsyncSession) -> None:
        """回灌 pending 的行可再次 claim（daemon 重启后自动重做，ql-20260816-004）。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session, user_id)
        stale = datetime.now(UTC) - timedelta(seconds=90)
        cw = await _create_change_write(
            db_session,
            runtime_id=rt.id,
            workspace_id=ws.id,
            status="claimed",
            claim_token="old-token",
            claimed_at=stale,
        )
        await _gc_expired_change_writes(db_session)

        resp = await claim_change_write(cw.id, db_session, _mock_user())
        assert resp.task_id == cw.id
        assert resp.claim_token != "old-token"  # 新 claim 生成新 token
        await db_session.refresh(cw)
        assert cw.status == "claimed"
        assert cw.claim_token == resp.claim_token

    @pytest.mark.asyncio
    async def test_gc_no_claimed_rows_is_noop(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session, user_id)
        await _create_change_write(
            db_session, runtime_id=rt.id, workspace_id=ws.id, status="pending"
        )
        count = await _gc_expired_change_writes(db_session)
        assert count == 0

    @pytest.mark.asyncio
    async def test_gc_spec_sync_uses_longer_window(self, db_session: AsyncSession) -> None:
        """ql-20260816-002：kind=spec-sync 用 600s 长窗；普通 create 仍 60s。

        90s 旧的 spec-sync claimed 行不被回收（长 apply 途中），同年龄的 create
        行被回收（回归守卫）。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session, user_id)
        stale90 = datetime.now(UTC) - timedelta(seconds=90)
        cw_spec = await _create_change_write(
            db_session,
            runtime_id=rt.id,
            workspace_id=ws.id,
            change_key="spec-sync",
            status="claimed",
            claim_token="t1",
            claimed_at=stale90,
            kind="spec-sync",
        )
        cw_create = await _create_change_write(
            db_session,
            runtime_id=rt.id,
            workspace_id=ws.id,
            change_key="2026-06-26-other",
            status="claimed",
            claim_token="t2",
            claimed_at=stale90,
            kind="create",
        )

        count = await _gc_expired_change_writes(db_session)
        assert count == 1  # 只有 create 行被回收

        await db_session.refresh(cw_spec)
        await db_session.refresh(cw_create)
        assert cw_spec.status == "claimed"  # spec-sync 长窗内保留
        assert cw_create.status == "pending"  # 回灌 pending 供重试（ql-20260816-004）

    @pytest.mark.asyncio
    async def test_pending_endpoint_triggers_gc(self, db_session: AsyncSession) -> None:
        """pending 端点顺带 gc：超时 claimed 行回灌 pending（ql-20260816-004），
        且回灌行被同一请求返回供 daemon 立即重 claim。"""
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        ws = await _create_workspace(db_session, user_id)
        stale = datetime.now(UTC) - timedelta(seconds=120)
        cw_stale = await _create_change_write(
            db_session,
            runtime_id=rt.id,
            workspace_id=ws.id,
            status="claimed",
            claim_token="t1",
            claimed_at=stale,
            # 显式早于 cw_pending，保证回灌后 pending 查询的顺序确定
            created_at=datetime.now(UTC) - timedelta(seconds=5),
        )
        cw_pending = await _create_change_write(
            db_session,
            runtime_id=rt.id,
            workspace_id=ws.id,
            change_key="pending-one",
            status="pending",
        )

        items = await get_pending_change_writes(rt.id, db_session, _mock_user())
        # 回灌行（默认 key 2026-06-26-x，created_at 更早）排在 pending-one 前
        assert [i.change_key for i in items] == ["2026-06-26-x", "pending-one"]

        await db_session.refresh(cw_stale)
        assert cw_stale.status == "pending"
        await db_session.refresh(cw_pending)
        assert cw_pending.status == "pending"
