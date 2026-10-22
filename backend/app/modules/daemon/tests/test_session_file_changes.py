"""1b 轮次快照：侧表落库 + 读模型投影（task-08 / FR-13..16 / D-023@v1）单测。

钉死契约：
- **full**：daemon 上报 ``TurnFileChangesSnapshot`` + ``TurnTimingSnapshot`` →
  ``GET /sessions/{id}/runs`` 的 ``file_changes`` / ``timing`` 原样透传（字段名
  camelCase 与 design 逐字一致），``file_changes_capability="full"``。
- **tool_only**：无侧表行 / 无 file_changes → ``file_changes=None`` +
  ``file_changes_capability="tool_only"`` + ``timing=None``（不伪造「无改动」）。
- **幂等**：同一 ``run_id`` 连写两次 → 侧表 1 行，字段取最后一次。
- **partial 透传**：``status="partial"`` + ``reason="timeout"`` +
  ``truncated=true`` 原样出现（partial 不是错误态）。
- **不 N+1**：多 run 投影只发 1 条 ``daemon_run_snapshots`` 查询（SQL 事件计数）。
- **interactive 接线**：``close_interactive_run``（daemon notifyRunResult 真实
  路径）落侧表；缺字段 → capability="tool_only"。

参照 test_session_model_usage.py 的 client + auth_headers + db_session 范式与
test_close_interactive_run_model_error.py 的 interactive run 夹具范式。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import event, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.agent.placement import RunPlacementService
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonRunSnapshot, DaemonRuntime
from app.modules.daemon.schema import TurnFileChangesSnapshot, TurnTimingSnapshot
from app.modules.daemon.service import DaemonService

_BASELINE = "a" * 40


# ── 构造器 ───────────────────────────────────────────────────────────────────


def _file_changes(run_id: uuid.UUID, **overrides: Any) -> TurnFileChangesSnapshot:
    """构造 full 快照（design「文件变更卡 DTO」全字段，含可选项）。"""
    raw: dict[str, Any] = {
        "runId": str(run_id),
        "baselineHead": _BASELINE,
        "collectedAt": "2026-10-21T12:00:00Z",
        "collectMs": 123,
        "status": "ok",
        "truncated": False,
        "files": [
            {
                "path": "backend/app/modules/daemon/model.py",
                "status": "modified",
                "added": 3,
                "deleted": 1,
                "attribution": "edit_patch",
                "editToolNames": ["Edit"],
                "source": "git",
            },
            {
                "path": "docs/new.md",
                "status": "added",
                "added": 10,
                "deleted": 0,
                "attribution": "command",
            },
            {
                "path": "bin/blob.dat",
                "status": "modified",
                "added": 0,
                "deleted": 0,
                "binary": True,
                "attribution": "command",
            },
        ],
        "concurrentSessionsHint": True,
    }
    raw.update(overrides)
    return TurnFileChangesSnapshot.model_validate(raw)


def _timing(run_id: uuid.UUID) -> TurnTimingSnapshot:
    return TurnTimingSnapshot.model_validate(
        {
            "runId": str(run_id),
            "basis": "observed",
            "ttftMs": 420,
            "totalMs": 1800,
            "attempts": [
                {
                    "index": 0,
                    "startedAt": "2026-10-21T12:00:00Z",
                    "firstTokenAt": "2026-10-21T12:00:00.420Z",
                    "endedAt": "2026-10-21T12:00:01.800Z",
                    "model": "claude-sonnet-4",
                    "inputTokens": 100,
                    "outputTokens": 20,
                }
            ],
        }
    )


# ── 基础夹具（复刻 test_session_model_usage.py）─────────────────────────────


async def _admin_id(db_session: AsyncSession) -> uuid.UUID:
    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None
    return admin.id


async def _seed_session(db_session: AsyncSession, *, owner_id: uuid.UUID) -> uuid.UUID:
    sid = uuid.uuid4()
    db_session.add(
        AgentSession(
            id=sid,
            user_id=owner_id,
            provider="claude",
            status="active",
        )
    )
    await db_session.commit()
    return sid


def _run(
    sid: uuid.UUID,
    *,
    created_at: datetime | None = None,
    status: str = "completed",
) -> AgentRun:
    base = created_at or (datetime.now(UTC) - timedelta(minutes=10))
    return AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        status=status,
        agent_session_id=sid,
        created_at=base,
        started_at=base,
        finished_at=base,
    )


async def _write_snapshot(
    db_session: AsyncSession,
    run: AgentRun,
    *,
    file_changes: TurnFileChangesSnapshot | None,
    timing: TurnTimingSnapshot | None = None,
    daemon_version: str | None = "0.2.0",
) -> None:
    """直接调 lease 域 helper（batch 路径的落库函数本身）。"""
    await DaemonService(db_session)._lease._upsert_run_snapshot(
        run,
        {
            "file_changes": file_changes,
            "timing": timing,
            "daemon_version": daemon_version,
        },
    )
    await db_session.commit()


async def _runs_by_id(client: AsyncClient, auth_headers: dict[str, str], sid: uuid.UUID):
    resp = await client.get(f"/api/daemon/sessions/{sid}/runs", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    return {item["id"]: item for item in resp.json()}


# ── interactive close 夹具（复刻 test_close_interactive_run_model_error.py）──


async def _create_user(session: AsyncSession) -> uuid.UUID:
    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"task08-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _create_runtime(session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


@pytest.fixture()
def mocked_redis():
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with (
        patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
        patch("app.modules.daemon.session.service.get_redis", return_value=redis),
    ):
        yield redis


async def _seed_interactive_run(
    db_session: AsyncSession,
    *,
    owner_id: uuid.UUID,
    runtime_id: uuid.UUID | None = None,
) -> tuple[uuid.UUID, uuid.UUID, str, uuid.UUID]:
    """构造 quick-chat session + interactive lease + running run。"""
    if runtime_id is None:
        runtime = await _create_runtime(db_session, owner_id)
        runtime_id = runtime.id
    placement = RunPlacementService(db_session)
    session_id = uuid.uuid4()
    run_id = uuid.uuid4()
    dispatch = await placement.prepare_interactive_dispatch(
        agent_session_id=session_id,
        agent_run_id=run_id,
        user_id=owner_id,
        provider="claude",
        prompt="hi",
        model=None,
    )
    session = AgentSession(
        id=session_id,
        user_id=owner_id,
        provider="claude",
        status="active",
        config={},
        turn_count=1,
        runtime_id=runtime_id,
        lease_id=dispatch.lease_id,
        last_active_at=datetime.now(UTC),
        created_at=datetime.now(UTC),
    )
    run = AgentRun(
        id=run_id,
        agent_type="claude_code",
        provider="claude",
        status="running",
        spec_strategy="quick-chat",
        agent_session_id=session_id,
        change_id=None,
    )
    db_session.add_all([session, run])
    await db_session.commit()
    return dispatch.lease_id, run_id, dispatch.claim_token, session_id


# ── 用例 ────────────────────────────────────────────────────────────────────


class TestSessionFileChanges:
    async def test_full_snapshot_serialized_verbatim(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """full：files 全字段 + capability="full" + timing 原样（camelCase 契约名）。"""
        admin = await _admin_id(db_session)
        sid = await _seed_session(db_session, owner_id=admin)
        run = _run(sid)
        db_session.add(run)
        await db_session.commit()
        await _write_snapshot(
            db_session,
            run,
            file_changes=_file_changes(run.id),
            timing=_timing(run.id),
        )

        item = (await _runs_by_id(client, auth_headers, sid))[str(run.id)]
        assert item["file_changes_capability"] == "full"

        fc = item["file_changes"]
        assert fc["runId"] == str(run.id)
        assert fc["baselineHead"] == _BASELINE
        assert fc["collectedAt"] == "2026-10-21T12:00:00Z"
        assert fc["collectMs"] == 123
        assert fc["status"] == "ok"
        assert fc["truncated"] is False
        assert fc["concurrentSessionsHint"] is True
        assert [f["path"] for f in fc["files"]] == [
            "backend/app/modules/daemon/model.py",
            "docs/new.md",
            "bin/blob.dat",
        ]
        first = fc["files"][0]
        assert first["status"] == "modified"
        assert first["added"] == 3
        assert first["deleted"] == 1
        assert first["attribution"] == "edit_patch"
        assert first["editToolNames"] == ["Edit"]  # 线名逐字：camelCase
        assert first["source"] == "git"
        assert "edit_tool_names" not in first  # Python 属性名不得漏到响应
        # 二进制：0/0 + binary=true 原样。
        assert fc["files"][2]["binary"] is True
        assert fc["files"][2]["added"] == 0
        # 可选字段缺省不伪造（attribution=command 行无 editToolNames/source）。
        assert "editToolNames" not in fc["files"][1]
        assert "source" not in fc["files"][1]

        timing = item["timing"]
        assert timing["runId"] == str(run.id)
        assert timing["basis"] == "observed"
        assert timing["ttftMs"] == 420
        assert timing["totalMs"] == 1800
        assert timing["attempts"][0]["model"] == "claude-sonnet-4"
        assert timing["attempts"][0]["inputTokens"] == 100

    async def test_tool_only_when_no_snapshot_row(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """tool_only：无侧表行 → null + "tool_only"，不伪造「无改动」。"""
        admin = await _admin_id(db_session)
        sid = await _seed_session(db_session, owner_id=admin)
        run = _run(sid)
        db_session.add(run)
        await db_session.commit()

        raw = await client.get(f"/api/daemon/sessions/{sid}/runs", headers=auth_headers)
        assert raw.status_code == 200, raw.text
        assert "无改动" not in raw.text
        item = (await _runs_by_id(client, auth_headers, sid))[str(run.id)]
        assert item["file_changes"] is None
        assert item["file_changes_capability"] == "tool_only"
        assert item["timing"] is None
        # 空值就是 null，不是空对象 / 空数组占位。
        assert "file_changes" in item and item["file_changes"] is None
        assert not isinstance(item["timing"], dict)

    async def test_same_run_id_upsert_twice_keeps_one_row_last_wins(
        self, db_session: AsyncSession
    ) -> None:
        """幂等：同一 run_id 连写两次 → 1 行，字段取最后一次（禁追加）。"""
        owner = await _create_user(db_session)
        sid = await _seed_session(db_session, owner_id=owner)
        run = _run(sid)
        db_session.add(run)
        await db_session.commit()

        await _write_snapshot(
            db_session,
            run,
            file_changes=_file_changes(run.id, status="ok", collectMs=11),
            timing=_timing(run.id),
        )
        await _write_snapshot(
            db_session,
            run,
            file_changes=_file_changes(
                run.id,
                status="partial",
                reason="queue_overflow",
                collectMs=22,
            ),
            timing=None,
            daemon_version="0.3.0",
        )

        rows = (
            (
                await db_session.execute(
                    select(DaemonRunSnapshot).where(DaemonRunSnapshot.run_id == run.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
        row = rows[0]
        assert row.collect_ms == 22
        assert row.status == "partial"
        assert row.reason == "queue_overflow"
        assert row.capability == "full"
        assert row.daemon_version == "0.3.0"
        assert row.timing is None  # 最后一次未上报 timing → 覆盖为 null（不残留旧值）
        assert (row.file_changes or {}).get("collectMs") == 22

        count = (
            await db_session.execute(
                select(func.count())
                .select_from(DaemonRunSnapshot)
                .where(DaemonRunSnapshot.run_id == run.id)
            )
        ).scalar_one()
        assert count == 1

    async def test_partial_timeout_truncated_passthrough(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """partial/timeout/truncated 原样透传（partial 不是错误态，不改成 failed）。"""
        admin = await _admin_id(db_session)
        sid = await _seed_session(db_session, owner_id=admin)
        run = _run(sid)
        db_session.add(run)
        await db_session.commit()
        await _write_snapshot(
            db_session,
            run,
            file_changes=_file_changes(
                run.id,
                status="partial",
                reason="timeout",
                truncated=True,
                files=[],
            ),
        )

        fc = (await _runs_by_id(client, auth_headers, sid))[str(run.id)]["file_changes"]
        assert fc["status"] == "partial"
        assert fc["reason"] == "timeout"
        assert fc["truncated"] is True
        assert fc["files"] == []
        # capability 只由「是否带快照字段」裁决，partial 仍是 full（数据可信度由
        # status/truncated 表达，两者正交）。
        item = (await _runs_by_id(client, auth_headers, sid))[str(run.id)]
        assert item["file_changes_capability"] == "full"

    async def test_projection_uses_single_in_query_no_n_plus_1(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        db_engine: Any,
    ) -> None:
        """多 run 投影只发 1 条 daemon_run_snapshots 查询（一次 IN，禁 N+1）。"""
        admin = await _admin_id(db_session)
        sid = await _seed_session(db_session, owner_id=admin)
        base = datetime.now(UTC) - timedelta(minutes=10)
        runs = [_run(sid, created_at=base + timedelta(seconds=i)) for i in range(3)]
        db_session.add_all(runs)
        await db_session.commit()
        for run in runs:
            await _write_snapshot(
                db_session,
                run,
                file_changes=_file_changes(run.id),
                timing=_timing(run.id),
            )

        snapshot_statements: list[str] = []

        def _capture(
            _conn: Any,
            _cursor: Any,
            statement: str,
            _parameters: Any,
            _context: Any,
            _executemany: bool,
        ) -> None:
            if "daemon_run_snapshots" in statement:
                snapshot_statements.append(statement)

        event.listen(db_engine.sync_engine, "before_cursor_execute", _capture)
        try:
            items = await _runs_by_id(client, auth_headers, sid)
        finally:
            event.remove(db_engine.sync_engine, "before_cursor_execute", _capture)

        assert len(snapshot_statements) == 1, snapshot_statements
        assert " IN " in snapshot_statements[0].upper()
        # 三 run 各自拿到自己的快照（批量映射没串行）。
        for run in runs:
            item = items[str(run.id)]
            assert item["file_changes"]["runId"] == str(run.id)
            assert item["timing"]["runId"] == str(run.id)

    async def test_interactive_close_persists_snapshot_and_tool_only_fallback(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_redis,
    ) -> None:
        """interactive 真实路径（close_interactive_run）落侧表；缺字段 → tool_only。

        mocked_redis 由夹具提供（close 收口会 publish 终态事件）。
        """
        svc = DaemonService(db_session)
        admin = await _admin_id(db_session)

        # ── run1：带完整快照 → full ──
        lease_id, run_id, token, sid = await _seed_interactive_run(db_session, owner_id=admin)
        run1 = await db_session.get(AgentRun, run_id)
        assert run1 is not None
        await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="success",
            is_error=False,
            result_summary="done",
            file_changes=_file_changes(run_id),
            timing=_timing(run_id),
            daemon_version="0.2.0",
        )

        # ── run2：同一会话再开一轮，缺字段 → tool_only + null ──
        uid = (
            await db_session.execute(select(AgentSession.user_id).where(AgentSession.id == sid))
        ).scalar_one()
        rt_id = (
            await db_session.execute(select(AgentSession.runtime_id).where(AgentSession.id == sid))
        ).scalar_one()
        assert rt_id is not None
        placement = RunPlacementService(db_session)
        run_id2 = uuid.uuid4()
        dispatch2 = await placement.prepare_interactive_dispatch(
            agent_session_id=sid,
            agent_run_id=run_id2,
            user_id=uid,
            provider="claude",
            prompt="again",
            model=None,
        )
        db_session.add(
            AgentRun(
                id=run_id2,
                agent_type="claude_code",
                provider="claude",
                status="running",
                spec_strategy="quick-chat",
                agent_session_id=sid,
                change_id=None,
            )
        )
        await db_session.commit()
        await svc.close_interactive_run(
            dispatch2.lease_id,
            run_id2,
            dispatch2.claim_token,
            status="success",
            is_error=False,
        )

        items = await _runs_by_id(client, auth_headers, sid)
        first = items[str(run_id)]
        assert first["file_changes_capability"] == "full"
        assert first["file_changes"]["collectMs"] == 123
        assert first["timing"]["ttftMs"] == 420

        second = items[str(run_id2)]
        assert second["file_changes"] is None
        assert second["file_changes_capability"] == "tool_only"
        assert second["timing"] is None

        # 侧表 run2 行 capability 落的是 tool_only（不是缺行——终态总写一行）。
        rows = (
            (
                await db_session.execute(
                    select(DaemonRunSnapshot).where(DaemonRunSnapshot.run_id == run_id2)
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1
        assert rows[0].capability == "tool_only"
        assert rows[0].file_changes is None
        assert rows[0].timing is None

    async def test_late_snapshot_after_terminal_close_still_persists(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_redis,
    ) -> None:
        """D-030：run 已终态时的**二次上报**仍落侧表（daemon E2 采集必然晚于 close）。

        daemon 时序＝先 ``notifyRunResult`` 收口 run，再异步采集（最长 1500ms）后
        补报 ``file_changes`` / ``timing``，即这两个字段几乎总是走「run 已终态」的
        二次上报。若终态 no-op 分支整条丢弃，侧表永远写不进去 → 轮级卡一律退
        ``tool_only``，1b 对 interactive 全废。本用例锁死：终态不被改写、侧表被补写。
        """
        svc = DaemonService(db_session)
        admin = await _admin_id(db_session)
        lease_id, run_id, token, sid = await _seed_interactive_run(db_session, owner_id=admin)

        # 首报（daemon 首报：尚未采集，不带快照）→ run 收口 + 侧表 tool_only
        await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="success",
            is_error=False,
            result_summary="done",
        )
        items = await _runs_by_id(client, auth_headers, sid)
        assert items[str(run_id)]["file_changes_capability"] == "tool_only"
        assert items[str(run_id)]["file_changes"] is None

        # 后到快照：同一端点二次上报，此时 run 已是终态（进入 no-op 分支）
        refreshed = await svc.close_interactive_run(
            lease_id,
            run_id,
            token,
            status="success",
            is_error=False,
            file_changes=_file_changes(run_id),
            timing=_timing(run_id),
            daemon_version="0.2.0",
        )
        # 终态语义不变（幂等），但侧表被补写
        assert refreshed.status == "completed"

        items = await _runs_by_id(client, auth_headers, sid)
        item = items[str(run_id)]
        assert item["file_changes_capability"] == "full"
        assert item["file_changes"]["collectMs"] == 123
        assert item["timing"]["runId"] == str(run_id)

        rows = (
            (
                await db_session.execute(
                    select(DaemonRunSnapshot).where(DaemonRunSnapshot.run_id == run_id)
                )
            )
            .scalars()
            .all()
        )
        assert len(rows) == 1, "后到快照必须覆盖写同一行，不得追加"
        assert rows[0].capability == "full"
        assert rows[0].daemon_version == "0.2.0"
