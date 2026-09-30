"""tool_report 会话「inject 懒激活退役」单测（2026-09-30-tool-report-
activation-wrong-machine task-06 / D-006@v1）。

懒激活分支已退役（原路径错机派发且钉死源会话——设计裁决见 design 背景），
本文件钉死退役后语义：

- 未激活 tool_report 会话调 ``inject_session`` → 409 ToolReportTakeoverInvalid
  中文指引 takeover（原会话零写：status/turn_count/lease/runs 不变）；
- 已激活（lease 存在）直通既有 inject 原路（turn_count 递增）零回归；
- chat 会话（origin 缺省）pending 无 lease 仍走既有 DaemonSessionNotActive 守卫；
- 列表/详情 origin 下发与标题派生（原 task-05 存量语义保留段）。

夹具范式镜像 ``test_inject_orchestrator_tagging.py``（in-memory SQLite + mock hub
/ redis）。``platform_agent_logs`` 表未在根 conftest 的 db_engine import 列表 →
本文件 autouse fixture 单独建表（范式同 platform_sync/tests/conftest.py）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.service import DaemonService
from app.modules.daemon.session.service import (
    DaemonSessionNotActive,
)
from app.modules.platform_sync.model import AgentSessionLogORM
from app.modules.workspace.model import Workspace

# ── 表基座（platform_agent_logs 未在根 conftest 注册，单独 create）──────────


@pytest.fixture(autouse=True)
async def _ensure_agent_log_table(db_engine) -> None:
    """单独建 ``platform_agent_logs`` 表（root conftest import 列表不含本 model）。"""
    from app.models.base import BaseModel
    from app.modules.platform_sync import model as _ps_model

    async with db_engine.begin() as conn:
        await conn.run_sync(
            BaseModel.metadata.create_all,
            tables=[_ps_model.AgentSessionLogORM.__table__],
        )


# ── Helpers（镜像 test_inject_orchestrator_tagging.py）───────────────────────


async def _create_user(session: AsyncSession, email: str | None = None) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=email or f"t05-{uid}@example.com",
            password_hash="x",
            display_name="T05",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _create_runtime(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    status: str = "online",
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status=status,
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


async def _make_workspace(session: AsyncSession, root_path: str = "/ws/root") -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-t05-{uuid.uuid4().hex[:8]}",
        slug=f"ws-t05-{uuid.uuid4().hex[:8]}",
        root_path=root_path,
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _make_tool_report_session(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    workspace_id: uuid.UUID | None = None,
    provider: str = "claude",
    lease_id: uuid.UUID | None = None,
    runtime_id: uuid.UUID | None = None,
    status: str = "pending",
    turn_count: int = 0,
) -> AgentSession:
    """按 platform_sync task-04 find-or-create 的落库形态造 tool_report 会话。"""
    now = datetime.now(UTC)
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        workspace_id=workspace_id,
        provider=provider,
        status=status,
        origin="tool_report",
        aggregation_key="claude-code|",
        title="claude-code · 本地活动",
        config_snapshot={"harness": "claude-code"},
        turn_count=turn_count,
        lease_id=lease_id,
        runtime_id=runtime_id,
        created_at=now,
        last_active_at=now,
    )
    session.add(sess)
    await session.commit()
    await session.refresh(sess)
    return sess


async def _make_agent_log_entry(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    agent_session_id: uuid.UUID,
    agent_cwd: str | None,
    last_seen_at: str | None = "2026-08-23T01:00:00.000Z",
    log_path: str = "C:/Users/t05/.claude/projects/x/abc.jsonl",
) -> AgentSessionLogORM:
    row = AgentSessionLogORM(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        log_path=log_path,
        harness="claude-code",
        format="claude-code-transcript-jsonl",
        agent_cwd=agent_cwd,
        exists=True,
        last_seen_at=last_seen_at,
        agent_session_id=agent_session_id,
    )
    session.add(row)
    await session.commit()
    return row


def _mock_hub(*, connected: bool = True) -> MagicMock:
    hub = MagicMock()
    hub.is_connected.return_value = connected
    hub.connected_runtime_ids = []
    hub.connected_daemon_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=connected)
    return hub


@pytest.fixture()
def mocked_hub():
    hub = _mock_hub()
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        yield hub


@pytest.fixture()
def mocked_redis():
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with patch("app.modules.daemon.session.service.get_redis", return_value=redis):
        yield redis


# ── 1. 激活成功路径 ─────────────────────────────────────────────────────────


class TestActivationSuccess:
    @pytest.mark.asyncio
    @pytest.mark.asyncio
    async def test_pending_tool_report_inject_409_takeover_guide(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """未激活 tool_report 会话调 inject → 409 中文指引 takeover，原会话零写。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        sess = await _make_tool_report_session(db_session, uid, runtime_id=rt.id)

        svc = DaemonService(db_session)
        with pytest.raises(Exception) as exc_info:
            await svc.inject_session(sess.id, uid, prompt="你好")

        err = exc_info.value
        assert getattr(err, "code", "") == "HTTP_409_TOOL_REPORT_TAKEOVER_INVALID"
        assert "接手" in str(err)

        await db_session.refresh(sess)
        assert sess.status == "pending"
        assert sess.turn_count == 0
        assert sess.lease_id is None
        runs = (
            (await db_session.execute(select(AgentRun).where(AgentRun.agent_session_id == sess.id)))
            .scalars()
            .all()
        )
        assert runs == []

    async def test_already_activated_goes_normal_inject(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """lease 已存在的 tool_report 会话走既有 inject 原路：turn_count 递增、
        新建第二个 run（design §3.3.4 第 5 点）。"""
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        lease_id = uuid.uuid4()
        sess = await _make_tool_report_session(
            db_session,
            uid,
            lease_id=lease_id,
            runtime_id=rt.id,
            status="active",
            turn_count=1,
        )
        # 已激活会话存在历史首轮 run（已完成）。
        db_session.add(
            AgentRun(
                id=uuid.uuid4(),
                agent_type="claude_code",
                provider="claude",
                status="completed",
                spec_strategy="interactive",
                agent_session_id=sess.id,
                user_id=uid,
            )
        )
        await db_session.commit()

        svc = DaemonService(db_session)
        result = await svc.inject_session(sess.id, uid, prompt="第二轮")

        await db_session.refresh(sess)
        # 激活分支未触发（lease 不变）；turn_count 由 1 起步注入路径递增为 2。
        assert sess.lease_id == lease_id
        assert sess.turn_count == 2
        runs = (
            (await db_session.execute(select(AgentRun).where(AgentRun.agent_session_id == sess.id)))
            .scalars()
            .all()
        )
        assert len(runs) == 2
        assert result.agent_run.id in {r.id for r in runs}

    @pytest.mark.asyncio
    async def test_chat_session_pending_without_lease_keeps_guard(self, db_session) -> None:
        """origin 缺省（chat）的 pending 无 lease 会话不进激活分支：既有守卫
        DaemonSessionNotActive 照抛（零回归）。"""
        uid = await _create_user(db_session)
        now = datetime.now(UTC)
        sess = AgentSession(
            id=uuid.uuid4(),
            user_id=uid,
            provider="claude",
            status="pending",
            turn_count=0,
            created_at=now,
            last_active_at=now,
        )
        db_session.add(sess)
        await db_session.commit()

        svc = DaemonService(db_session)
        with pytest.raises(DaemonSessionNotActive):
            await svc.inject_session(sess.id, uid, prompt="hi")


# ── 4. 列表 origin 下发 + 标题派生 session.title 优先（design §3.3.2）──────


class TestListOriginAndTitle:
    @pytest.mark.asyncio
    async def test_list_returns_origin_and_prefers_session_title(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """列表下发 origin 列；title 派生改 session.title 优先（tool_report 自动
        标题直出），chat 会话（title 列 NULL）回落首条 user_input 派生不变。"""
        from app.modules.auth.model import User

        admin = (
            (await db_session.execute(select(User).where(User.email == "admin@example.com")))
            .scalars()
            .first()
        )
        assert admin is not None
        now = datetime.now(UTC)

        # tool_report 会话：有持久化 title、无任何 run（纯日志主体）。
        tr = AgentSession(
            id=uuid.uuid4(),
            user_id=admin.id,
            provider="claude",
            status="pending",
            origin="tool_report",
            aggregation_key="claude-code|change-x",
            title="claude-code · change-x",
            turn_count=0,
            created_at=now,
            last_active_at=now,
        )
        # chat 会话：title NULL，靠首条 user_input 派生（既有路径）。
        chat = AgentSession(
            id=uuid.uuid4(),
            user_id=admin.id,
            provider="claude",
            status="ended",
            turn_count=1,
            created_at=now - timedelta(minutes=1),
            last_active_at=now - timedelta(minutes=1),
            ended_at=now,
        )
        db_session.add_all([tr, chat])
        await db_session.flush()
        run = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider="claude",
            status="completed",
            spec_strategy="interactive",
            agent_session_id=chat.id,
            user_id=admin.id,
        )
        db_session.add(run)
        await db_session.flush()
        db_session.add(
            AgentRunLog(
                run_id=run.id,
                channel="user_input",
                content_redacted="帮我看看这个报错怎么修",
                timestamp=now,
            )
        )
        await db_session.commit()

        resp = await client.get("/api/daemon/sessions", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        items = {i["id"]: i for i in resp.json()["items"]}

        tr_item = items[str(tr.id)]
        assert tr_item["origin"] == "tool_report"
        # title 优先取 session.title 列（无 user_input 可派生也不再是 None）。
        assert tr_item["title"] == "claude-code · change-x"

        chat_item = items[str(chat.id)]
        assert chat_item["origin"] == "chat"
        # chat 会话 title 列 NULL → 回落既有首条 user_input 前 30 字派生。
        assert chat_item["title"] == "帮我看看这个报错怎么修"

        # total 断言防串台（两行都在）。
        assert resp.json()["total"] == 2

    @pytest.mark.asyncio
    async def test_detail_returns_origin(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """详情端点 from_attributes 自动带 origin/title 列。"""
        from app.modules.auth.model import User

        admin = (
            (await db_session.execute(select(User).where(User.email == "admin@example.com")))
            .scalars()
            .first()
        )
        assert admin is not None
        now = datetime.now(UTC)
        tr = AgentSession(
            id=uuid.uuid4(),
            user_id=admin.id,
            provider="claude",
            status="pending",
            origin="tool_report",
            title="codex · 本地活动",
            turn_count=0,
            created_at=now,
            last_active_at=now,
        )
        db_session.add(tr)
        await db_session.commit()

        resp = await client.get(f"/api/daemon/sessions/{tr.id}", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["origin"] == "tool_report"
        assert body["title"] == "codex · 本地活动"
