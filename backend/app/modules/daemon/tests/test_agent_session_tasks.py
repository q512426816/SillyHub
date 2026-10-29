"""agent_session_task 持久化行为单测（task-04 / FR-05 / FR-06 / D-006@v1）。

变更 2026-09-04-session-task-execution-panel：``agent_task_status`` 事件经
``upsert_agent_task``（agent_task_store.py，task-03）落库
``agent_session_task``（task-01 表），``GET /sessions/{id}/tasks``（task-02）
按 updated_at desc 输出最近 200 条快照。本文件钉死四组行为：

1. upsert 语义组——首事件建行（started_at 置位且此后不变；首见即终态
   补记 finished_at）；Optional 契约字段 None 保旧 / 非 None 覆盖；
   终态定格（终态后再收 running 整行跳过）；后到异种终态覆盖置
   finished_at；同 (session_id, task_id) 多事件仅 1 行；
2. 快照端点组——owner 200（AgentSessionTaskRead 18 字段 snake_case
   形状 + updated_at desc 排序 + 超 200 条截断）/ 空会话返回 [] /
   不存在 / 跨用户 / 软删会话 404 / 无 TASK_RUN_AGENT 权限 403；
3. 上报端点旁路组——upsert 抛异常时端点仍 200 且 publish 已发生
   （FR-05 非功能「可回退」）+ 正常链路落行；
4. 会话删除级联组——删 agent_sessions 行后其 agent_session_task 行级联
   清理（内存 SQLite 默认不强制 FK，用例内对共享连接显式开
   PRAGMA foreign_keys=ON 后按模型 ondelete 声明验证级联）。

HTTP 侧对齐 test_session_plan_bash_events.py 的 harness（client +
auth_headers + mocked Redis），helpers 照 test_agent_task_status_payload.py
的复用先例。Redis is mocked (AsyncMock); no live broker.

Production code is not modified.
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from httpx import AsyncClient
from sqlalchemy import delete, func, select, text, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentSession
from app.modules.daemon.agent_task_store import RUN_CLOSE_SWEEP_REASON, upsert_agent_task
from app.modules.daemon.model import AgentSessionTask
from app.modules.daemon.schema import AgentTaskStatusEvent

from .test_session_plan_bash_events import (
    _admin_id,
    _create_runtime,
    _create_session_with_run,
    _decode_publishes,
    _mock_redis,
)

# AgentSessionTaskRead 的 18 个响应键（snake_case，D-006@v1；created_at 不外露）。
_EXPECTED_READ_KEYS = {
    "id",
    "session_id",
    "run_id",
    "task_id",
    "task_name",
    "status",
    "progress",
    "summary",
    "message",
    "last_tool_name",
    "tool_use_id",
    "elapsed_ms",
    "total_tokens",
    "tool_uses",
    "is_async",
    "started_at",
    "finished_at",
    "updated_at",
}

# ── Helpers ──────────────────────────────────────────────────────────────────


def _event(
    session_id: uuid.UUID,
    run_id: uuid.UUID,
    task_id: str,
    *,
    status: str = "running",
    task_name: str = "子代理任务",
    **extra: object,
) -> AgentTaskStatusEvent:
    """构造一个 agent_task_status 事件（extra 直传可选契约字段）。"""
    return AgentTaskStatusEvent(
        session_id=session_id,
        run_id=run_id,
        task_id=task_id,
        task_name=task_name,
        status=status,
        **extra,
    )


async def _task_rows(db_session: AsyncSession, session_id: uuid.UUID) -> list[AgentSessionTask]:
    """查某会话的全部 agent_session_task 行（断言真实落库内容用）。"""
    rows = (
        (
            await db_session.execute(
                select(AgentSessionTask).where(AgentSessionTask.session_id == session_id)
            )
        )
        .scalars()
        .all()
    )
    return list(rows)


async def _seed_plain_user(db_session: AsyncSession) -> tuple[uuid.UUID, str]:
    """建一个无任何角色 / 非平台管理员的普通用户并签发 JWT（403 用例口径）。"""
    from app.core.config import get_settings
    from app.core.security import create_access_token
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    email = f"plain-{uid}@example.com"
    db_session.add(
        User(
            id=uid,
            email=email,
            password_hash="x",
            display_name="plain",
            status="active",
        )
    )
    await db_session.commit()
    token, _payload = create_access_token(
        user_id=uid, email=email, is_admin=False, settings=get_settings()
    )
    return uid, token


def _parse_ts(value: str) -> datetime:
    """端点 JSON 时间戳（Z 或 +00:00 后缀或无偏移）→ 归一为 aware UTC datetime。"""
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return _as_utc(parsed)


def _as_utc(dt: datetime) -> datetime:
    """datetime 比较统一归一到 aware UTC。

    内存 SQLite 读回的时间戳无 tzinfo（naive），而 upsert 内存对象是
    aware（datetime.now(UTC)）——两侧直接比较会 TypeError/失配，统一
    把 naive 视为 UTC 再比较。
    """
    return dt.replace(tzinfo=UTC) if dt.tzinfo is None else dt


# ── 1. upsert 语义组 ─────────────────────────────────────────────────────────


class TestUpsertAgentTaskSemantics:
    """upsert_agent_task（agent_task_store.py）：建行 / 字段归约 / 终态定格。"""

    @pytest.mark.asyncio
    async def test_first_running_event_inserts_row_with_started_at_frozen(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """首事件（running）建行：started_at/updated_at 置位、finished_at 为 None、
        status 取事件值、Optional 字段落列默认（is_async=False）。"""
        # Arrange
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, run = await _create_session_with_run(db_session, user_id, rt.id)
        from app.modules.daemon.agent_task_store import upsert_agent_task

        # Act
        row = await upsert_agent_task(
            db_session,
            _event(
                ag_session.id,
                run.id,
                "t-first",
                summary="首轮扫描",
                progress=10,
            ),
        )

        # Assert
        assert row.session_id == ag_session.id
        assert row.run_id == run.id
        assert row.task_id == "t-first"
        assert row.task_name == "子代理任务"
        assert row.status == "running"
        assert row.started_at is not None
        assert row.finished_at is None
        assert row.updated_at is not None
        assert row.summary == "首轮扫描"
        assert row.progress == 10
        assert row.is_async is False  # 事件 async_=None → 列默认 False
        rows = await _task_rows(db_session, ag_session.id)
        assert len(rows) == 1 and rows[0].task_id == "t-first"

    @pytest.mark.asyncio
    async def test_first_event_terminal_backfills_finished_at(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """首见即终态（无前置 running 心跳）：started_at 与 finished_at 同时置位。"""
        # Arrange
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, run = await _create_session_with_run(db_session, user_id, rt.id)
        from app.modules.daemon.agent_task_store import upsert_agent_task

        # Act
        row = await upsert_agent_task(
            db_session, _event(ag_session.id, run.id, "t-term", status="completed")
        )

        # Assert
        assert row.status == "completed"
        assert row.started_at is not None
        assert row.finished_at is not None

    @pytest.mark.asyncio
    async def test_optional_fields_none_preserved_non_none_overridden(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """九个 Optional 契约字段：事件值 None 保留行内旧值，非 None 逐次覆盖。"""
        # Arrange
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, run = await _create_session_with_run(db_session, user_id, rt.id)
        from app.modules.daemon.agent_task_store import upsert_agent_task

        # Act 1：首事件九字段全给非 None 值
        await upsert_agent_task(
            db_session,
            _event(
                ag_session.id,
                run.id,
                "t-optional",
                progress=10,
                summary="第一段摘要",
                message="进行中",
                last_tool_name="Grep",
                tool_use_id="toolu_01",
                elapsed_ms=1_000,
                total_tokens=100,
                tool_uses=3,
                async_=True,
            ),
        )
        # Act 2：后续事件九字段全缺省（None）→ 全部保旧
        await upsert_agent_task(
            db_session, _event(ag_session.id, run.id, "t-optional", status="running")
        )
        (row_after_none,) = await _task_rows(db_session, ag_session.id)
        # Assert（None 保旧）
        assert row_after_none.progress == 10
        assert row_after_none.summary == "第一段摘要"
        assert row_after_none.message == "进行中"
        assert row_after_none.last_tool_name == "Grep"
        assert row_after_none.tool_use_id == "toolu_01"
        assert row_after_none.elapsed_ms == 1_000
        assert row_after_none.total_tokens == 100
        assert row_after_none.tool_uses == 3
        assert row_after_none.is_async is True

        # Act 3：再后事件九字段全给新非 None 值 → 全部覆盖（is_async 可翻 False）
        await upsert_agent_task(
            db_session,
            _event(
                ag_session.id,
                run.id,
                "t-optional",
                status="running",
                progress=90,
                summary="第二段摘要",
                message="即将完成",
                last_tool_name="Read",
                tool_use_id="toolu_02",
                elapsed_ms=2_000,
                total_tokens=200,
                tool_uses=5,
                async_=False,
            ),
        )
        (row_after_override,) = await _task_rows(db_session, ag_session.id)
        # Assert（非 None 覆盖）
        assert row_after_override.progress == 90
        assert row_after_override.summary == "第二段摘要"
        assert row_after_override.message == "即将完成"
        assert row_after_override.last_tool_name == "Read"
        assert row_after_override.tool_use_id == "toolu_02"
        assert row_after_override.elapsed_ms == 2_000
        assert row_after_override.total_tokens == 200
        assert row_after_override.tool_uses == 5
        assert row_after_override.is_async is False

    @pytest.mark.asyncio
    async def test_terminal_event_sets_finished_at_and_keeps_started_at(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """running → completed：finished_at 置位、started_at 保持首插值不变。"""
        # Arrange
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, run = await _create_session_with_run(db_session, user_id, rt.id)
        from app.modules.daemon.agent_task_store import upsert_agent_task

        row = await upsert_agent_task(db_session, _event(ag_session.id, run.id, "t-life"))
        assert row.finished_at is None
        started_at_first = row.started_at
        await asyncio.sleep(0.01)

        # Act
        await upsert_agent_task(
            db_session,
            _event(ag_session.id, run.id, "t-life", status="completed", summary="已完成"),
        )
        (row_after,) = await _task_rows(db_session, ag_session.id)

        # Assert
        assert row_after.status == "completed"
        assert row_after.finished_at is not None
        # started_at 定格（naive/aware 归一后比较）
        assert _as_utc(row_after.started_at) == _as_utc(started_at_first)
        assert row_after.summary == "已完成"

    @pytest.mark.asyncio
    async def test_running_after_terminal_absorbed_whole_row(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """终态后再收 running：整行跳过——status 保持终态、finished_at 不清除、
        字段不刷新（含 updated_at），迟到心跳不复活任务。"""
        # Arrange
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, run = await _create_session_with_run(db_session, user_id, rt.id)
        from app.modules.daemon.agent_task_store import upsert_agent_task

        await upsert_agent_task(db_session, _event(ag_session.id, run.id, "t-absorb", progress=50))
        await upsert_agent_task(
            db_session,
            _event(ag_session.id, run.id, "t-absorb", status="failed", message="超时"),
        )
        (terminal_row,) = await _task_rows(db_session, ag_session.id)
        assert terminal_row.status == "failed"
        snapshot = {
            "status": terminal_row.status,
            "finished_at": terminal_row.finished_at,
            "updated_at": terminal_row.updated_at,
            "progress": terminal_row.progress,
            "message": terminal_row.message,
        }
        assert snapshot["finished_at"] is not None
        await asyncio.sleep(0.02)

        # Act：终态后迟到的 running 心跳（带新 progress / summary）
        returned = await upsert_agent_task(
            db_session,
            _event(
                ag_session.id,
                run.id,
                "t-absorb",
                status="running",
                progress=99,
                summary="迟到心跳",
            ),
        )
        (row_after,) = await _task_rows(db_session, ag_session.id)

        # Assert：返回原行且库内整行未动
        assert returned.id == terminal_row.id
        assert row_after.status == "failed"  # 不回退
        assert _as_utc(row_after.finished_at) == _as_utc(snapshot["finished_at"])  # 不清除
        assert _as_utc(row_after.updated_at) == _as_utc(snapshot["updated_at"])  # 不刷新
        assert row_after.progress == 50  # 字段不刷新
        assert row_after.message == "超时"
        assert row_after.summary is None  # 迟到事件的 summary 未写入

    @pytest.mark.asyncio
    async def test_resumed_running_revives_terminal_row(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """2026-10-30-task-resume-revive-notify-retry：终态行收 resumed=True 的
        running → 放行复活（status 回 running、finished_at/message 清空、
        started_at 保持首插值）——task-notification「本轮停止」后主代理续唤
        重跑（daemon 注册表终态注销后同 task_id 重开）的显式复活信号。"""
        # Arrange
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, run = await _create_session_with_run(db_session, user_id, rt.id)
        from app.modules.daemon.agent_task_store import upsert_agent_task

        await upsert_agent_task(db_session, _event(ag_session.id, run.id, "t-resume", progress=10))
        (started_row,) = await _task_rows(db_session, ag_session.id)
        assert started_row.started_at is not None
        # identity map 下同名行是同一 ORM 实例（后续 setattr 就地更新）——
        # 快照拍照后比较（同 test_later_different_terminal_overrides 先例）。
        started_snapshot = {
            "started_at": started_row.started_at,
            "updated_at": started_row.updated_at,
        }
        await upsert_agent_task(
            db_session,
            _event(ag_session.id, run.id, "t-resume", status="completed", message="本轮完成"),
        )
        await asyncio.sleep(0.02)

        # Act：续唤重跑的 running 首帧（daemon 打标 resumed=True）
        await upsert_agent_task(
            db_session,
            _event(
                ag_session.id,
                run.id,
                "t-resume",
                status="running",
                progress=60,
                resumed=True,
            ),
        )
        (row_after,) = await _task_rows(db_session, ag_session.id)

        # Assert：复活——在途形态（finished_at/message 清空），身份字段保旧
        assert row_after.status == "running"
        assert row_after.finished_at is None
        assert row_after.message is None  # 终态遗留文案随复活清除
        assert row_after.progress == 60  # 事件字段照常 latest-wins
        assert _as_utc(row_after.started_at) == _as_utc(started_snapshot["started_at"])
        assert _as_utc(row_after.updated_at) > _as_utc(started_snapshot["updated_at"])

    @pytest.mark.asyncio
    async def test_resumed_false_explicit_still_absorbed(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """resumed=False（显式否定，等价缺省）不复活——吸收判据必须是
        ``is True``，防实现漂移为「非 None 即复活」误放大迟到心跳面。"""
        # Arrange
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, run = await _create_session_with_run(db_session, user_id, rt.id)
        from app.modules.daemon.agent_task_store import upsert_agent_task

        await upsert_agent_task(
            db_session,
            _event(ag_session.id, run.id, "t-resume-f", status="completed"),
        )
        (terminal_row,) = await _task_rows(db_session, ag_session.id)
        assert terminal_row.finished_at is not None
        snapshot_updated = terminal_row.updated_at
        await asyncio.sleep(0.02)

        # Act：显式 resumed=False 的 running 心跳
        await upsert_agent_task(
            db_session,
            _event(ag_session.id, run.id, "t-resume-f", status="running", resumed=False),
        )
        (row_after,) = await _task_rows(db_session, ag_session.id)

        # Assert：维持吸收（整行未动）
        assert row_after.status == "completed"
        assert row_after.finished_at is not None
        assert _as_utc(row_after.updated_at) == _as_utc(snapshot_updated)

    @pytest.mark.asyncio
    async def test_later_different_terminal_overrides_with_new_finished_at(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """completed 后到 failed：异种终态允许覆盖，finished_at 重置为最新终态时刻。"""
        # Arrange
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, run = await _create_session_with_run(db_session, user_id, rt.id)
        from app.modules.daemon.agent_task_store import upsert_agent_task

        await upsert_agent_task(
            db_session, _event(ag_session.id, run.id, "t-override", status="completed")
        )
        (completed_row,) = await _task_rows(db_session, ag_session.id)
        finished_first = completed_row.finished_at
        updated_first = completed_row.updated_at
        assert finished_first is not None
        await asyncio.sleep(0.02)

        # Act
        await upsert_agent_task(
            db_session,
            _event(ag_session.id, run.id, "t-override", status="failed", message="后续校验失败"),
        )
        (row_after,) = await _task_rows(db_session, ag_session.id)

        # Assert：最新终态为准，时间戳推进
        assert row_after.status == "failed"
        assert row_after.message == "后续校验失败"
        assert row_after.finished_at is not None
        assert _as_utc(row_after.finished_at) > _as_utc(finished_first)
        assert _as_utc(row_after.updated_at) > _as_utc(updated_first)

    @pytest.mark.asyncio
    async def test_five_events_same_key_single_row(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """同 (session_id, task_id) 五个事件（running→running→completed→running 吸收
        →failed）仅 1 行，最终 status 取最后有效事件、started_at 全程不变。"""
        # Arrange
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, run = await _create_session_with_run(db_session, user_id, rt.id)
        from app.modules.daemon.agent_task_store import upsert_agent_task

        # Act
        row1 = await upsert_agent_task(
            db_session, _event(ag_session.id, run.id, "t-5", task_name="任务A")
        )
        await upsert_agent_task(
            db_session, _event(ag_session.id, run.id, "t-5", task_name="任务A改", progress=30)
        )
        await upsert_agent_task(
            db_session,
            _event(ag_session.id, run.id, "t-5", status="completed", task_name="任务A完成"),
        )
        await upsert_agent_task(
            db_session,
            _event(
                ag_session.id, run.id, "t-5", status="running", task_name="迟到心跳", progress=77
            ),
        )
        await upsert_agent_task(
            db_session,
            _event(ag_session.id, run.id, "t-5", status="failed", task_name="任务A终", message="x"),
        )

        # Assert
        rows = await _task_rows(db_session, ag_session.id)
        assert len(rows) == 1
        only = rows[0]
        assert only.id == row1.id
        assert only.status == "failed"  # 最新终态
        assert only.task_name == "任务A终"  # 必填字段 latest-wins（吸收事件「迟到心跳」未回写）
        assert only.progress == 30  # 迟到 running 的 77 被整行吸收
        assert _as_utc(only.started_at) == _as_utc(row1.started_at)  # 首插定格


# ── 2. 快照端点组 ─────────────────────────────────────────────────────────────


class TestSessionTasksSnapshotEndpoint:
    """GET /sessions/{session_id}/tasks：鉴权 / 形状 / 排序 / 限条 / 空态。"""

    async def _seed_session(self, db_session: AsyncSession, *, owner_id: uuid.UUID) -> AgentSession:
        sid = uuid.uuid4()
        ag_session = AgentSession(id=sid, user_id=owner_id, provider="claude", status="active")
        db_session.add(ag_session)
        await db_session.commit()
        return ag_session

    @pytest.mark.asyncio
    async def test_owner_200_returns_18_field_read_shape(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """owner 请求 200：list[AgentSessionTaskRead] 18 字段 snake_case 形状，
        逐字段断言值（含 is_async 契约名、started_at/finished_at 时间戳）。"""
        # Arrange
        admin = await _admin_id(db_session)
        ag_session = await self._seed_session(db_session, owner_id=admin)
        started = datetime(2026, 9, 4, 10, 0, 0, tzinfo=UTC)
        finished = datetime(2026, 9, 4, 10, 3, 30, tzinfo=UTC)
        updated = datetime(2026, 9, 4, 10, 3, 31, tzinfo=UTC)
        seeded = AgentSessionTask(
            session_id=ag_session.id,
            run_id=uuid.uuid4(),
            task_id="t-shape",
            task_name="形状校验任务",
            status="completed",
            progress=100,
            summary="全部完成",
            message="成功",
            last_tool_name="Grep",
            tool_use_id="toolu_shape",
            elapsed_ms=210_000,
            total_tokens=4_096,
            tool_uses=17,
            is_async=True,
            started_at=started,
            finished_at=finished,
            updated_at=updated,
        )
        db_session.add(seeded)
        await db_session.commit()

        # Act
        resp = await client.get(f"/api/daemon/sessions/{ag_session.id}/tasks", headers=auth_headers)

        # Assert
        assert resp.status_code == 200, resp.text
        items = resp.json()
        assert isinstance(items, list) and len(items) == 1
        item = items[0]
        assert set(item.keys()) == _EXPECTED_READ_KEYS
        assert item["id"] == str(seeded.id)
        assert item["session_id"] == str(ag_session.id)
        assert item["run_id"] == str(seeded.run_id)
        assert item["task_id"] == "t-shape"
        assert item["task_name"] == "形状校验任务"
        assert item["status"] == "completed"
        assert item["progress"] == 100
        assert item["summary"] == "全部完成"
        assert item["message"] == "成功"
        assert item["last_tool_name"] == "Grep"
        assert item["tool_use_id"] == "toolu_shape"
        assert item["elapsed_ms"] == 210_000
        assert item["total_tokens"] == 4_096
        assert item["tool_uses"] == 17
        assert item["is_async"] is True
        assert _parse_ts(item["started_at"]) == _as_utc(started)
        assert _parse_ts(item["finished_at"]) == _as_utc(finished)
        assert _parse_ts(item["updated_at"]) == _as_utc(updated)

    @pytest.mark.asyncio
    async def test_rows_ordered_by_updated_at_desc(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """多行按 updated_at desc 排序（最近活跃在前，前端首屏增量合并的锚点）。"""
        # Arrange
        admin = await _admin_id(db_session)
        ag_session = await self._seed_session(db_session, owner_id=admin)
        base = datetime(2026, 9, 4, 12, 0, 0, tzinfo=UTC)
        for i in range(3):
            db_session.add(
                AgentSessionTask(
                    session_id=ag_session.id,
                    run_id=uuid.uuid4(),
                    task_id=f"t-order-{i}",
                    task_name=f"排序任务{i}",
                    status="running",
                    started_at=base,
                    updated_at=base + timedelta(seconds=i),
                )
            )
        await db_session.commit()

        # Act
        resp = await client.get(f"/api/daemon/sessions/{ag_session.id}/tasks", headers=auth_headers)

        # Assert
        assert resp.status_code == 200, resp.text
        task_ids = [it["task_id"] for it in resp.json()]
        assert task_ids == ["t-order-2", "t-order-1", "t-order-0"]

    @pytest.mark.asyncio
    async def test_more_than_200_rows_capped_to_200_newest(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """超 200 行（造 205 行）→ 最多返回 200 条，裁掉 updated_at 最旧的 5 条。"""
        # Arrange
        admin = await _admin_id(db_session)
        ag_session = await self._seed_session(db_session, owner_id=admin)
        base = datetime(2026, 9, 4, 8, 0, 0, tzinfo=UTC)
        db_session.add_all(
            AgentSessionTask(
                session_id=ag_session.id,
                run_id=uuid.uuid4(),
                task_id=f"t-cap-{i:03d}",
                task_name=f"截断任务{i}",
                status="running",
                started_at=base,
                updated_at=base + timedelta(seconds=i),
            )
            for i in range(205)
        )
        await db_session.commit()

        # Act
        resp = await client.get(f"/api/daemon/sessions/{ag_session.id}/tasks", headers=auth_headers)

        # Assert
        assert resp.status_code == 200, resp.text
        items = resp.json()
        assert len(items) == 200
        returned_ids = {it["task_id"] for it in items}
        assert items[0]["task_id"] == "t-cap-204"  # 最新在前
        assert "t-cap-000" not in returned_ids  # 最旧 5 条被裁
        assert "t-cap-004" not in returned_ids
        assert {"t-cap-005", "t-cap-204"} <= returned_ids

    @pytest.mark.asyncio
    async def test_empty_session_returns_empty_list(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """有会话但无任务上报 → 200 且 []（D-003 空态，不报错）。"""
        # Arrange
        admin = await _admin_id(db_session)
        ag_session = await self._seed_session(db_session, owner_id=admin)

        # Act
        resp = await client.get(f"/api/daemon/sessions/{ag_session.id}/tasks", headers=auth_headers)

        # Assert
        assert resp.status_code == 200, resp.text
        assert resp.json() == []

    @pytest.mark.asyncio
    async def test_404_missing_session(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        """会话不存在 → 404（资源隐藏，不泄露存在性）。"""
        # Act
        resp = await client.get(f"/api/daemon/sessions/{uuid.uuid4()}/tasks", headers=auth_headers)

        # Assert
        assert resp.status_code == 404, resp.text
        assert resp.json()["code"] == "HTTP_404_DAEMON_SESSION_NOT_FOUND"

    @pytest.mark.asyncio
    async def test_404_cross_user_session(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """他人的会话（调用方非 owner 非群成员）→ 404，与不存在同码。"""
        # Arrange：建一个属于「他人」的 runtime + 会话（照 _seed_foreign_session 先例）
        from app.modules.auth.model import User

        other_id = uuid.uuid4()
        db_session.add(
            User(
                id=other_id,
                email=f"foreign-{other_id}@example.com",
                password_hash="x",
                display_name="foreign",
                status="active",
            )
        )
        await db_session.commit()
        rt = await _create_runtime(db_session, other_id)
        foreign_session, _run = await _create_session_with_run(db_session, other_id, rt.id)
        db_session.add(
            AgentSessionTask(
                session_id=foreign_session.id,
                run_id=uuid.uuid4(),
                task_id="t-foreign",
                task_name="他人任务",
                status="running",
                started_at=datetime.now(UTC),
                updated_at=datetime.now(UTC),
            )
        )
        await db_session.commit()

        # Act：admin（非 owner）请求
        resp = await client.get(
            f"/api/daemon/sessions/{foreign_session.id}/tasks", headers=auth_headers
        )

        # Assert
        assert resp.status_code == 404, resp.text
        assert resp.json()["code"] == "HTTP_404_DAEMON_SESSION_NOT_FOUND"

    @pytest.mark.asyncio
    async def test_404_soft_deleted_session(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """软删会话（deleted_at 置位）→ 404（软删视为不存在）。"""
        # Arrange
        admin = await _admin_id(db_session)
        ag_session = AgentSession(
            id=uuid.uuid4(),
            user_id=admin,
            provider="claude",
            status="active",
            deleted_at=datetime.now(UTC),
        )
        db_session.add(ag_session)
        await db_session.commit()

        # Act
        resp = await client.get(f"/api/daemon/sessions/{ag_session.id}/tasks", headers=auth_headers)

        # Assert
        assert resp.status_code == 404, resp.text
        assert resp.json()["code"] == "HTTP_404_DAEMON_SESSION_NOT_FOUND"

    @pytest.mark.asyncio
    async def test_403_without_task_run_agent_permission(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """无 TASK_RUN_AGENT 权限的普通用户（TaskRunAgentUser 口径：无平台角色
        且非 platform admin）→ 403，即便是本人会话（权限闸门先于归属查询）。"""
        # Arrange
        plain_id, plain_token = await _seed_plain_user(db_session)
        ag_session = await self._seed_session(db_session, owner_id=plain_id)
        headers = {"Authorization": f"Bearer {plain_token}"}

        # Act
        resp = await client.get(f"/api/daemon/sessions/{ag_session.id}/tasks", headers=headers)

        # Assert
        assert resp.status_code == 403, resp.text
        assert resp.json()["code"] == "HTTP_403_PERMISSION_DENIED"
        assert resp.json()["details"]["permission"] == "task:run_agent"


# ── 3. 上报端点旁路组 ─────────────────────────────────────────────────────────


class TestNotifyPersistsAndBypasses:
    """POST /sessions/{id}/agent-task-status 的落库接线与持久化旁路（FR-05）。"""

    @pytest.mark.asyncio
    async def test_notify_persists_row_via_upsert(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """正常链路：端点 200 之外事件真实落库（status/summary/started_at 置位）。"""
        # Arrange
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, run = await _create_session_with_run(db_session, user_id, rt.id)
        redis = _mock_redis()

        # Act
        with patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis):
            resp = await client.post(
                f"/api/daemon/sessions/{ag_session.id}/agent-task-status",
                json={
                    "event": "agent_task_status",
                    "session_id": str(ag_session.id),
                    "run_id": str(run.id),
                    "task_id": "t-persist",
                    "task_name": "落库任务",
                    "status": "running",
                    "summary": "正在扫描",
                },
                headers=auth_headers,
            )

        # Assert
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"ok": True}
        rows = await _task_rows(db_session, ag_session.id)
        assert len(rows) == 1
        assert rows[0].task_id == "t-persist"
        assert rows[0].status == "running"
        assert rows[0].summary == "正在扫描"
        assert rows[0].started_at is not None

    @pytest.mark.asyncio
    async def test_upsert_failure_bypassed_still_200_and_published(
        self, client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """upsert 抛异常（模拟落库故障）→ 端点仍 200 且 publish_session_event 已
        执行（mock 证明）：SSE 主链路优先，持久化旁路失败零影响（可回退）。"""
        # Arrange
        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, run = await _create_session_with_run(db_session, user_id, rt.id)
        redis = _mock_redis()

        # Act：router 已 by-name 导入 upsert_agent_task，在 router 命名空间打桩
        with (
            patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis),
            patch(
                "app.modules.daemon.router.upsert_agent_task",
                side_effect=RuntimeError("db down"),
            ) as mock_upsert,
        ):
            resp = await client.post(
                f"/api/daemon/sessions/{ag_session.id}/agent-task-status",
                json={
                    "event": "agent_task_status",
                    "session_id": str(ag_session.id),
                    "run_id": str(run.id),
                    "task_id": "t-bypass",
                    "task_name": "旁路任务",
                    "status": "running",
                },
                headers=auth_headers,
            )

        # Assert
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"ok": True}
        mock_upsert.assert_awaited_once()  # 确实尝试过落库而非被跳过
        publishes = _decode_publishes(redis)
        assert len(publishes) == 1  # 转发先于落库，不受故障影响
        assert publishes[0][0] == f"agent_session:{ag_session.id}"
        assert publishes[0][1]["task_id"] == "t-bypass"
        rows = await _task_rows(db_session, ag_session.id)
        assert rows == []  # 落库失败零残留


# ── 4. 会话删除级联组 ─────────────────────────────────────────────────────────


class TestSessionDeleteCascade:
    """删除 agent_sessions 行 → agent_session_task 行级联清理（FK ondelete）。"""

    @pytest.mark.asyncio
    async def test_delete_session_cascades_task_rows(self, db_session: AsyncSession) -> None:
        """删会话行后其任务行全部级联消失（模型 ondelete=CASCADE 真实生效）。

        conftest 的内存 SQLite 默认不强制 FK：在共享连接上显式开
        PRAGMA foreign_keys=ON 再删行（读回校验开启成功，防静默失效）。
        """
        # Arrange：建普通用户（FK 强制下 user_id 必须真实存在）
        from app.modules.auth.model import User

        uid = uuid.uuid4()
        db_session.add(
            User(
                id=uid,
                email=f"cascade-{uid}@example.com",
                password_hash="x",
                display_name="cascade",
                status="active",
            )
        )
        await db_session.commit()
        ag_session = AgentSession(id=uuid.uuid4(), user_id=uid, provider="claude", status="active")
        db_session.add(ag_session)
        now = datetime.now(UTC)
        db_session.add_all(
            AgentSessionTask(
                session_id=ag_session.id,
                run_id=uuid.uuid4(),
                task_id=f"t-cascade-{i}",
                task_name=f"级联任务{i}",
                status="running",
                started_at=now,
                updated_at=now,
            )
            for i in range(2)
        )
        await db_session.commit()

        # 开 FK 强制（首条语句在驱动隐式事务开启前执行，读回校验生效）
        await db_session.execute(text("PRAGMA foreign_keys = ON"))
        fk_on = (await db_session.execute(text("PRAGMA foreign_keys"))).scalar()
        assert fk_on == 1, "SQLite FK 强制未开启，级联断言将失效"

        count_before = (
            await db_session.execute(
                select(func.count())
                .select_from(AgentSessionTask)
                .where(AgentSessionTask.session_id == ag_session.id)
            )
        ).scalar_one()
        assert count_before == 2

        # Act：删除会话行
        await db_session.execute(delete(AgentSession).where(AgentSession.id == ag_session.id))
        await db_session.commit()

        # Assert：任务行随会话级联清理，无孤儿残留
        count_after = (
            await db_session.execute(
                select(func.count())
                .select_from(AgentSessionTask)
                .where(AgentSessionTask.session_id == ag_session.id)
            )
        ).scalar_one()
        assert count_after == 0


# ── 2026-10-11-task-sweep-daemon-truth：确认制任务清扫 ────────────────────────


class _StubHub:
    """send_rpc 桩——按 (runtime_id, session_id) 脚本化返回活跃集或抛离线。"""

    def __init__(self, responses: dict):
        # key: (runtime_id, session_id_str) -> list[str] 活跃 task_id 或 Exception
        self.responses = responses
        self.calls: list = []

    async def send_rpc(self, daemon_id, method, params, timeout=None):
        self.calls.append((daemon_id, method, dict(params)))
        value = self.responses.get((daemon_id, params["session_id"]))
        if isinstance(value, Exception):
            raise value
        return {"session_id": params["session_id"], "live_task_ids": value or []}


class TestRunCloseTaskSweep:
    """确认制清扫（daemon 注册表 = 唯一真相源）行为钉死。

    演进：run 终态即收（v1）→ 5 分钟心跳宽限（v2）均被用户指正误判（后台任务
    跨轮存活 / 长耗时任务静默）。v3：会话终态直接收（daemon 语义背书：会话
    end/fail 时 SDK 进程 kill、任务随进程消亡）；活跃会话逐 runtime 问
    session_live_tasks RPC，不在活跃集才收；daemon 离线跳过（fail-open 保活）。
    """

    @pytest.mark.asyncio
    async def test_sweep_daemon_confirmed_dead_only(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """daemon 确认不在活跃集 → 收口；确认在活跃集（静默但仍活）→ 保留。"""
        from app.modules.daemon.agent_task_store import (
            sweep_confirmed_dead_tasks,
            upsert_agent_task,
        )

        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, run = await _create_session_with_run(db_session, user_id, rt.id)
        await upsert_agent_task(db_session, _event(ag_session.id, run.id, "t-dead"))
        await upsert_agent_task(db_session, _event(ag_session.id, run.id, "t-alive"))

        hub = _StubHub({(rt.id, str(ag_session.id)): ["t-alive"]})
        swept = await sweep_confirmed_dead_tasks(db_session, hub=hub)

        assert swept == 1
        rows = {r.task_id: r for r in await _task_rows(db_session, ag_session.id)}
        assert rows["t-dead"].status == "stopped"
        assert "轮次已结束" in (rows["t-dead"].message or "")
        # daemon 说活着的（哪怕长时间静默）永不误收——无时间启发式。
        assert rows["t-alive"].status == "running"
        # RPC 按会话问询一次。
        assert hub.calls == [(rt.id, "session_live_tasks", {"session_id": str(ag_session.id)})]

    @pytest.mark.asyncio
    async def test_sweep_daemon_offline_skips(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """daemon 离线/超时 → 该批跳过不误收（fail-open 保活）。"""
        from app.modules.daemon.agent_task_store import (
            sweep_confirmed_dead_tasks,
            upsert_agent_task,
        )
        from app.modules.daemon.ws_hub import DaemonRuntimeOffline

        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, run = await _create_session_with_run(db_session, user_id, rt.id)
        await upsert_agent_task(db_session, _event(ag_session.id, run.id, "t-maybe"))

        hub = _StubHub({(rt.id, str(ag_session.id)): DaemonRuntimeOffline("offline")})
        swept = await sweep_confirmed_dead_tasks(db_session, hub=hub)

        assert swept == 0
        rows = {r.task_id: r for r in await _task_rows(db_session, ag_session.id)}
        assert rows["t-maybe"].status == "running"

    @pytest.mark.asyncio
    async def test_sweep_terminal_session_direct_no_rpc(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """会话终态（ended）与无 runtime 行直接收口——不经 RPC。"""
        from app.modules.agent.model import AgentRun
        from app.modules.agent.model import AgentSession as AgSessionModel
        from app.modules.daemon.agent_task_store import (
            sweep_confirmed_dead_tasks,
            upsert_agent_task,
        )

        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, run = await _create_session_with_run(db_session, user_id, rt.id)
        ended_session = AgSessionModel(
            id=uuid.uuid4(),
            user_id=user_id,
            runtime_id=rt.id,
            provider="claude",
            status="ended",
        )
        noruntime_session = AgSessionModel(
            id=uuid.uuid4(),
            user_id=user_id,
            runtime_id=None,
            provider="claude",
            status="active",
        )
        db_session.add_all([ended_session, noruntime_session])
        await db_session.commit()
        for sess in (ended_session, noruntime_session):
            r = AgentRun(
                id=uuid.uuid4(),
                task_id=uuid.uuid4(),
                agent_type="claude_code",
                agent_session_id=sess.id,
                status="completed",
            )
            db_session.add(r)
            await db_session.commit()
            await upsert_agent_task(db_session, _event(sess.id, r.id, f"t-{str(sess.id)[:4]}"))
        # 对照组：活跃会话 + 在线 daemon 说活 → 保留。
        await upsert_agent_task(db_session, _event(ag_session.id, run.id, "t-live"))
        hub = _StubHub({(rt.id, str(ag_session.id)): ["t-live"]})

        swept = await sweep_confirmed_dead_tasks(db_session, hub=hub)

        assert swept == 2
        rows = {r.task_id: r for r in await _task_rows(db_session, ended_session.id)}
        assert all(r.status == "stopped" for r in rows.values())
        rows2 = {r.task_id: r for r in await _task_rows(db_session, noruntime_session.id)}
        assert all(r.status == "stopped" for r in rows2.values())
        live_rows = {r.task_id: r for r in await _task_rows(db_session, ag_session.id)}
        assert live_rows["t-live"].status == "running"
        # 终态/无 runtime 会话零 RPC（只有活跃会话问了一次）。
        assert len(hub.calls) == 1

    @pytest.mark.asyncio
    async def test_sweep_run_scoped_filter(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """run_id 限定：只扫该 run 的候选（run 收口延迟确认清扫口径）。"""
        from app.modules.agent.model import AgentRun
        from app.modules.daemon.agent_task_store import (
            sweep_confirmed_dead_tasks,
            upsert_agent_task,
        )

        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, run = await _create_session_with_run(db_session, user_id, rt.id)
        other_run = AgentRun(
            id=uuid.uuid4(),
            task_id=uuid.uuid4(),
            agent_type="claude_code",
            agent_session_id=ag_session.id,
            status="completed",
        )
        db_session.add(other_run)
        await db_session.commit()
        await upsert_agent_task(db_session, _event(ag_session.id, run.id, "t-in-run"))
        await upsert_agent_task(db_session, _event(ag_session.id, other_run.id, "t-other"))

        hub = _StubHub({(rt.id, str(ag_session.id)): []})  # daemon：全部不在活跃集
        swept = await sweep_confirmed_dead_tasks(db_session, hub=hub, run_id=run.id)

        assert swept == 1
        rows = {r.task_id: r for r in await _task_rows(db_session, ag_session.id)}
        assert rows["t-in-run"].status == "stopped"
        assert rows["t-other"].status == "running"

    @pytest.mark.asyncio
    async def test_sweep_terminal_race_not_overwritten(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """评审 F1（P2）：SELECT→UPDATE 窗口内到达的真实终态不被覆写。

        构造：候选 SELECT 后、最终 UPDATE 前（RPC 回调即该窗口的确定性钩子点），
        任务行被 task_notification 终态事件写成 completed——UPDATE 的非终态守卫
        必须放它过去（终态定格，语义①），不得覆写为 stopped+清扫标记。
        """
        from app.modules.daemon.agent_task_store import (
            sweep_confirmed_dead_tasks,
            upsert_agent_task,
        )

        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, run = await _create_session_with_run(db_session, user_id, rt.id)
        await upsert_agent_task(db_session, _event(ag_session.id, run.id, "t-race"))

        class _RacingHub(_StubHub):
            async def send_rpc(self, daemon_id, method, params, timeout=None):
                # 窗口钩子：RPC 在途时终态事件先到达并提交。
                await upsert_agent_task(
                    db_session,
                    _event(ag_session.id, run.id, "t-race", status="completed"),
                )
                return await super().send_rpc(daemon_id, method, params, timeout)

        hub = _RacingHub({(rt.id, str(ag_session.id)): []})  # daemon：不在活跃集
        swept = await sweep_confirmed_dead_tasks(db_session, hub=hub)

        assert swept == 0  # 唯一候选已终态 → 守卫放行，零收口
        rows = {r.task_id: r for r in await _task_rows(db_session, ag_session.id)}
        assert rows["t-race"].status == "completed"
        assert rows["t-race"].message is None  # 未被清扫标记污染

    @pytest.mark.asyncio
    async def test_sweep_stopped_row_revives_on_running_heartbeat(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """清扫收口行（message=清扫原因）收 running 心跳 → 复活自愈。"""
        from sqlalchemy import update as sa_update

        from app.modules.daemon.agent_task_store import (
            RUN_CLOSE_SWEEP_REASON,
            upsert_agent_task,
        )

        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, run = await _create_session_with_run(db_session, user_id, rt.id)
        await upsert_agent_task(db_session, _event(ag_session.id, run.id, "t-x"))
        # 直接种入清扫态（stopped + 标记）——复活分支只认标记。
        await db_session.execute(
            sa_update(AgentSessionTask)
            .where(AgentSessionTask.task_id == "t-x")
            .values(status="stopped", message=RUN_CLOSE_SWEEP_REASON, finished_at=datetime.now(UTC))
        )
        await db_session.commit()

        await upsert_agent_task(
            db_session,
            _event(ag_session.id, run.id, "t-x", status="running", progress=42),
        )

        rows = {r.task_id: r for r in await _task_rows(db_session, ag_session.id)}
        assert rows["t-x"].status == "running"
        assert rows["t-x"].finished_at is None
        assert rows["t-x"].message is None
        assert rows["t-x"].progress == 42

    @pytest.mark.asyncio
    async def test_genuine_stopped_absorbs_running_heartbeat(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """事件驱动的真实 stopped 行（message 非清扫标记）维持终态吸收。"""
        from app.modules.daemon.agent_task_store import upsert_agent_task

        user_id = await _admin_id(db_session)
        rt = await _create_runtime(db_session, user_id)
        ag_session, run = await _create_session_with_run(db_session, user_id, rt.id)
        await upsert_agent_task(
            db_session,
            _event(ag_session.id, run.id, "t-s", status="stopped", message="用户停止"),
        )

        await upsert_agent_task(db_session, _event(ag_session.id, run.id, "t-s", status="running"))

        rows = {r.task_id: r for r in await _task_rows(db_session, ag_session.id)}
        assert rows["t-s"].status == "stopped"
        assert (rows["t-s"].message or "") == "用户停止"

    @pytest.mark.asyncio
    async def test_sweep_routes_rpc_by_daemon_instance_id(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """2026-10-12-task-sweep-rpc-route-key：RPC 路由键必须是 daemon_instance_id。

        WS Hub 连接表按 daemon_instance_id 注册（ws_hub._connections），runtime
        主键是注册时随机 uuid4 的独立 UUID 空间——此前直接拿 runtime_id 发
        session_live_tasks 恒 is_connected 失败被当「离线」跳过，确认制不可达。
        """
        from app.modules.daemon.agent_task_store import (
            sweep_confirmed_dead_tasks,
            upsert_agent_task,
        )
        from app.modules.daemon.model import DaemonInstance

        user_id = await _admin_id(db_session)
        instance = DaemonInstance(
            id=uuid.uuid4(),
            user_id=user_id,
            hostname="route-key-host",
            server_url="http://route-key.example",
            status="online",
        )
        db_session.add(instance)
        await db_session.flush()
        rt = await _create_runtime(db_session, user_id)
        rt.daemon_instance_id = instance.id
        db_session.add(rt)
        await db_session.commit()
        await db_session.refresh(rt)
        assert rt.daemon_instance_id == instance.id

        ag_session, run = await _create_session_with_run(db_session, user_id, rt.id)
        await upsert_agent_task(db_session, _event(ag_session.id, run.id, "t-live"))

        hub = _StubHub({(instance.id, str(ag_session.id)): ["t-live"]})
        swept = await sweep_confirmed_dead_tasks(db_session, hub=hub)

        # daemon 报活 → 零收口；且 RPC 按映射键问询，而非 runtime 原键。
        assert swept == 0
        assert hub.calls == [
            (instance.id, "session_live_tasks", {"session_id": str(ag_session.id)})
        ]

    @pytest.mark.asyncio
    async def test_sweep_skips_missing_runtime_row_without_rpc(
        self, auth_headers: dict[str, str], db_session: AsyncSession
    ) -> None:
        """runtime 行缺失（悬空引用）→ 无路由键可解析，fail-open 跳过不发 RPC。"""
        from app.modules.agent.model import AgentRun
        from app.modules.agent.model import AgentSession as AgSessionModel
        from app.modules.daemon.agent_task_store import (
            sweep_confirmed_dead_tasks,
            upsert_agent_task,
        )

        user_id = await _admin_id(db_session)
        dangling = AgSessionModel(
            id=uuid.uuid4(),
            user_id=user_id,
            runtime_id=uuid.uuid4(),  # 不存在对应 daemon_runtimes 行
            provider="claude",
            status="active",
        )
        db_session.add(dangling)
        await db_session.commit()
        r = AgentRun(
            id=uuid.uuid4(),
            task_id=uuid.uuid4(),
            agent_type="claude_code",
            agent_session_id=dangling.id,
            status="completed",
        )
        db_session.add(r)
        await db_session.commit()
        await upsert_agent_task(db_session, _event(dangling.id, r.id, "t-dangling"))

        hub = _StubHub({})
        swept = await sweep_confirmed_dead_tasks(db_session, hub=hub)

        assert swept == 0  # fail-open 保活，不误收
        assert hub.calls == []  # 无路由键，不发 RPC
        rows = {r.task_id: r for r in await _task_rows(db_session, dangling.id)}
        assert rows["t-dangling"].status == "running"

    @pytest.mark.asyncio
    async def test_startup_orphan_task_sweep_deferred_on_own_session(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """启动清扫延迟任务：独立 session 执行（非调用方 lifespan session）。"""
        from app.modules.agent import service as agent_service

        captured: dict = {}

        class _FakeCtx:
            async def __aenter__(self) -> object:
                captured["marker"] = object()
                return captured["marker"]

            async def __aexit__(self, *args: object) -> bool:
                return False

        async def _fake_sweep(session, *, hub, run_id=None, rpc_timeout=5.0):
            captured["session"] = session
            return 3

        monkeypatch.setattr(agent_service, "_STARTUP_TASK_SWEEP_DELAY_SECONDS", 0)
        monkeypatch.setattr(agent_service, "get_session_factory", lambda: _FakeCtx)
        monkeypatch.setattr(
            "app.modules.daemon.agent_task_store.sweep_confirmed_dead_tasks",
            _fake_sweep,
        )

        await agent_service._startup_orphan_task_sweep()

        assert captured["session"] is captured["marker"]  # factory 新开的独立 session
        assert captured["session"] is not db_session

    @pytest.mark.asyncio
    async def test_startup_orphan_task_sweep_swallows_errors(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """清扫异常不冒泡——启动兜底失败只记日志，不阻断 lifespan。"""
        from app.modules.agent import service as agent_service

        class _FakeCtx:
            async def __aenter__(self) -> None:
                return None

            async def __aexit__(self, *args: object) -> bool:
                return False

        async def _boom(session, *, hub, run_id=None, rpc_timeout=5.0):
            raise RuntimeError("sweep exploded")

        monkeypatch.setattr(agent_service, "_STARTUP_TASK_SWEEP_DELAY_SECONDS", 0)
        monkeypatch.setattr(agent_service, "get_session_factory", lambda: _FakeCtx)
        monkeypatch.setattr("app.modules.daemon.agent_task_store.sweep_confirmed_dead_tasks", _boom)

        await agent_service._startup_orphan_task_sweep()  # 不抛即过


# ── 6. 幽灵成对行根治组（2026-10-12-session-defects task-03 / FR-04 / D-005） ──


class TestGhostPairToolUseIdReconciliation:
    """生产幽灵成对行复现与根治（会话 47e2ff1a 实证 21 组同名
    stopped(空摘要)+completed(真摘要) 成对行）。

    根因：tool_use 派生的 running 事件以 tool-use call id 冒充 task_id
    （claude-events.ts `strOf(toolInput?.['task_id']) || tId`——Agent 工具
    入参无 task_id，回落 call id），而 SDK 帧携带真实 harness task_id。
    同一任务两个 id 在 (session_id, task_id) 定位键下各落一行：call-id 行
    永收不到终态事件、被 sweep_confirmed_dead_tasks 清扫成 stopped(空摘要)，
    harness 行正常 completed(真摘要)——成对行成形。

    修复口径（D-005 不变量「一逻辑任务至多一行真实终态」）：事件携带
    tool_use_id 且异于 task_id 时，把同会话内 task_id==tool_use_id 的冒名行
    重映射到真实 task_id（无真实行）或吸收删除（真实行已并存）。
    """

    @pytest.mark.asyncio
    async def test_call_id_row_remapped_not_duplicated(self, db_session: AsyncSession) -> None:
        """复现主路径：冒名行先落（tool_use 派生），真帧后到（带 tool_use_id）
        → 重映射而非新插，全程单行。修复前此断言失败（两行成对）。"""
        sid, rid = uuid.uuid4(), uuid.uuid4()
        # ① tool_use 派生 running（call id 冒充 task_id）
        await upsert_agent_task(
            db_session, _event(sid, rid, "callu_01ABC", task_name="独立评审 VO 改名修复")
        )
        # ② SDK task_started 真帧（harness id + tool_use_id 关联键）
        await upsert_agent_task(
            db_session,
            _event(
                sid,
                rid,
                "adc8e182d947f76bc",
                task_name="独立评审 VO 改名修复",
                tool_use_id="callu_01ABC",
            ),
        )
        rows = await _task_rows(db_session, sid)
        assert len(rows) == 1, f"幽灵成对行复现：期望 1 行，实际 {len(rows)} 行"
        assert rows[0].task_id == "adc8e182d947f76bc"
        assert rows[0].status == "running"
        # ③ 真帧 completed → 单行收终态
        await upsert_agent_task(
            db_session,
            _event(
                sid,
                rid,
                "adc8e182d947f76bc",
                task_name="独立评审 VO 改名修复",
                status="completed",
                summary="评审完成，review.json 已写入",
                tool_use_id="callu_01ABC",
            ),
        )
        rows = await _task_rows(db_session, sid)
        assert len(rows) == 1
        assert rows[0].status == "completed"
        assert rows[0].summary == "评审完成，review.json 已写入"

    @pytest.mark.asyncio
    async def test_pre_existing_pair_absorbed_on_later_event(
        self, db_session: AsyncSession
    ) -> None:
        """存量成对行补救：冒名行已被清扫 stopped(清扫标记)、真实行已
        completed——迟到的带 tool_use_id 事件到达时吸收冒名行，恢复单行。"""
        sid, rid = uuid.uuid4(), uuid.uuid4()
        await upsert_agent_task(
            db_session, _event(sid, rid, "callu_02DEF", task_name="task-02 设计文档 v0.3")
        )
        await upsert_agent_task(
            db_session,
            _event(sid, rid, "abdfdbcd944eee7f4", task_name="task-02 设计文档 v0.3"),
        )
        # 模拟历史态：call-id 行被清扫 stopped（写 RUN_CLOSE_SWEEP_REASON 标记），
        # 真实行 completed。
        await db_session.execute(
            update(AgentSessionTask)
            .where(AgentSessionTask.task_id == "callu_02DEF")
            .values(status="stopped", message=RUN_CLOSE_SWEEP_REASON)
        )
        await upsert_agent_task(
            db_session,
            _event(
                sid,
                rid,
                "abdfdbcd944eee7f4",
                task_name="task-02 设计文档 v0.3",
                status="completed",
                summary="task-02 完成",
            ),
        )
        rows = await _task_rows(db_session, sid)
        assert len(rows) == 2  # 吸收前的存量成对行（历史数据）
        # 迟到事件（带 tool_use_id 关联键）触发吸收 → 恢复单行
        await upsert_agent_task(
            db_session,
            _event(
                sid,
                rid,
                "abdfdbcd944eee7f4",
                task_name="task-02 设计文档 v0.3",
                status="completed",
                summary="task-02 完成",
                tool_use_id="callu_02DEF",
            ),
        )
        rows = await _task_rows(db_session, sid)
        assert len(rows) == 1, f"存量成对行未吸收：仍 {len(rows)} 行"
        assert rows[0].task_id == "abdfdbcd944eee7f4"
        assert rows[0].status == "completed"

    @pytest.mark.asyncio
    async def test_tool_use_id_self_match_no_remap(self, db_session: AsyncSession) -> None:
        """task_id == tool_use_id（正常关联）不触发重映射，行为与现状一致。"""
        sid, rid = uuid.uuid4(), uuid.uuid4()
        await upsert_agent_task(
            db_session,
            _event(sid, rid, "harness_x", task_name="任务甲", tool_use_id="harness_x"),
        )
        await upsert_agent_task(
            db_session,
            _event(sid, rid, "harness_x", task_name="任务甲", tool_use_id="harness_x"),
        )
        rows = await _task_rows(db_session, sid)
        assert len(rows) == 1
        assert rows[0].task_id == "harness_x"

    @pytest.mark.asyncio
    async def test_no_tool_use_id_insert_path_unchanged(self, db_session: AsyncSession) -> None:
        """无 tool_use_id 的异 task_id 事件（合法重试重生成，如「评审后断点续跑
        收口」×6 生产实证）照旧各落一行——合并仅限 tool_use_id 关联键证据。"""
        sid, rid = uuid.uuid4(), uuid.uuid4()
        await upsert_agent_task(
            db_session, _event(sid, rid, "id_a", task_name="评审后断点续跑收口")
        )
        await upsert_agent_task(
            db_session, _event(sid, rid, "id_b", task_name="评审后断点续跑收口")
        )
        rows = await _task_rows(db_session, sid)
        assert len(rows) == 2  # 合法重试：不同实例各一行
