"""inject 空 prompt 422 拒绝单测（task-08 / FR-08 / D-004@v1）。

变更 2026-08-27-background-subagent-progress task-07：空 prompt（含全空白）
注入产出 50ms 零输出空轮（生产实证 run c78044c8）。判空收口 service 层
``DaemonService.inject_session`` 入口（``SessionEmptyPrompt`` 422 + 中文文案
「消息内容不能为空」），校验位于取锁 / 附件预读 / 忙轮入队（queue_when_busy）
之前——空消息不进队列、不建 run、不写 user_input 行。豁免口径同入口单一来源：
静默切换轮（ql-20260817-010）/ 附件看图说话轮（D-7）允许空 prompt。

两层覆盖：

- HTTP 层（对齐 ``test_session_router.py`` 的 client + fresh_ws_hub harness）：
  空串 / 全空白 → 422 + code=SESSION_EMPTY_PROMPT + 中文 message；无新
  AgentRun / user_input 行；忙轮（首 run 未终态）也先判空不入队；非空照常。
- service 层（对齐 ``test_session_switch_config.py`` / 附件测试 harness，
  回归保护）：prompt="" + 切换字段（静默切换）、prompt="" + attachment_ids
  （附件豁免）**不**被 SessionEmptyPrompt 拒。

Production code is not modified.
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun, AgentRunLog
from app.modules.daemon.model import DaemonRuntime
from app.modules.daemon.ws_hub import DaemonWsHub

from .test_session_create_attachments import _seed_attachment
from .test_session_switch_config import (
    _create_profile,
    _create_runtime,
    _create_user,
    _finish_first_turn,
    _mock_hub,
)

# ── HTTP 层 helpers（对齐 test_session_router.py） ────────────────────────────


@pytest.fixture()
def fresh_ws_hub(monkeypatch: pytest.MonkeyPatch) -> DaemonWsHub:
    """Replace the process-wide ws_hub singleton with a fresh, wired hub."""
    from app.modules.daemon import ws_hub as ws_hub_module

    hub = DaemonWsHub()
    monkeypatch.setattr(ws_hub_module, "_ws_hub", hub)
    return hub


async def _connect_mock(hub: DaemonWsHub, runtime_id: uuid.UUID) -> AsyncMock:
    """挂一个记录 sent_messages 的 mock WS 到 hub（create 需在线 runtime）。"""
    ws = AsyncMock()
    ws.sent_messages: list[dict[str, Any]] = []

    async def _send_json(message: dict[str, Any]) -> None:
        ws.sent_messages.append(message)

    ws.send_json = AsyncMock(side_effect=_send_json)
    ws.close = AsyncMock()
    await hub.connect(runtime_id, ws)
    return ws


async def _seed_active_session_http(
    db_session: AsyncSession,
    client: AsyncClient,
    auth_headers: dict[str, str],
    fresh_ws_hub: DaemonWsHub,
) -> dict[str, str]:
    """HTTP 建 runtime + mock WS + 会话（provider=claude，首轮 pending 即忙轮）。

    返回 create 响应体（session_id / run_id / lease_id）。首轮不置终态——
    inject 落 queue_when_busy 路径（HTTP 端点恒 True），恰好覆盖「判空先于入队」。
    """
    from app.modules.auth.model import User

    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=admin.id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)
    await db_session.commit()
    await _connect_mock(fresh_ws_hub, rt.id)

    resp = await client.post(
        "/api/daemon/sessions",
        json={"provider": "claude", "prompt": "first"},
        headers=auth_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


async def _session_run_count(db_session: AsyncSession, session_id: uuid.UUID) -> int:
    rows = (
        (
            await db_session.execute(
                select(AgentRun.id).where(AgentRun.agent_session_id == session_id)
            )
        )
        .scalars()
        .all()
    )
    return len(rows)


async def _session_user_input_rows(
    db_session: AsyncSession, session_id: uuid.UUID
) -> list[AgentRunLog]:
    """会话全部 run 的 channel='user_input' 日志行（每轮 prompt 落一条）。"""
    run_ids = (
        (
            await db_session.execute(
                select(AgentRun.id).where(AgentRun.agent_session_id == session_id)
            )
        )
        .scalars()
        .all()
    )
    if not run_ids:
        return []
    return list(
        (
            await db_session.execute(
                select(AgentRunLog)
                .where(AgentRunLog.run_id.in_(run_ids), AgentRunLog.channel == "user_input")
                .order_by(AgentRunLog.timestamp, AgentRunLog.id)
            )
        )
        .scalars()
        .all()
    )


# ── HTTP 层：422 拒绝 + 无副作用 ─────────────────────────────────────────────


class TestInjectEmptyPromptRejected422:
    """task-07 / FR-08：空串 / 全空白 prompt → 422 + code + 中文文案。"""

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "prompt_value", ["", "   ", "\n\t  \n"], ids=["empty", "spaces", "mixed_ws"]
    )
    async def test_empty_or_whitespace_prompt_422(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
        prompt_value: str,
    ) -> None:
        """空串 / 全空白 → 422，code=SESSION_EMPTY_PROMPT，message 为中文
        「消息内容不能为空」（l10n 守护口径）。"""
        created = await _seed_active_session_http(db_session, client, auth_headers, fresh_ws_hub)
        sid = uuid.UUID(created["session_id"])

        resp = await client.post(
            f"/api/daemon/sessions/{sid}/inject",
            json={"prompt": prompt_value},
            headers=auth_headers,
        )

        assert resp.status_code == 422, resp.text
        body = resp.json()
        assert body["code"] == "SESSION_EMPTY_PROMPT"
        assert body["message"] == "消息内容不能为空"
        assert body["details"] == {"reason": "empty_prompt"}

    @pytest.mark.asyncio
    async def test_no_agent_run_or_user_input_rows_created(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """422 后零副作用：不创建 AgentRun（仍只有首轮 1 条）、不写 user_input
        行（仍只有首轮 prompt 1 条）、忙轮不入队（queue 端点空）。"""
        created = await _seed_active_session_http(db_session, client, auth_headers, fresh_ws_hub)
        sid = uuid.UUID(created["session_id"])
        assert await _session_run_count(db_session, sid) == 1
        assert len(await _session_user_input_rows(db_session, sid)) == 1

        resp = await client.post(
            f"/api/daemon/sessions/{sid}/inject",
            json={"prompt": ""},
            headers=auth_headers,
        )
        assert resp.status_code == 422

        # 判空在取锁 / 入队之前：无新 run、无新 user_input 行、队列空。
        assert await _session_run_count(db_session, sid) == 1
        rows = await _session_user_input_rows(db_session, sid)
        assert len(rows) == 1, "空 prompt 不得写 user_input 行"
        assert rows[0].content_redacted == "first"
        qresp = await client.get(f"/api/daemon/sessions/{sid}/queue", headers=auth_headers)
        assert qresp.status_code == 200, qresp.text
        assert qresp.json()["items"] == [], "空 prompt 不进忙轮队列（先校验后入队）"

    @pytest.mark.asyncio
    async def test_nonempty_prompt_still_works(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """非空 prompt 照常：忙轮（首 run pending）→ 201 queued（判空不拦非空，
        queue_when_busy 语义不变）。"""
        created = await _seed_active_session_http(db_session, client, auth_headers, fresh_ws_hub)
        sid = uuid.UUID(created["session_id"])

        resp = await client.post(
            f"/api/daemon/sessions/{sid}/inject",
            json={"prompt": "继续排查"},
            headers=auth_headers,
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["queued"] is True
        assert body["queue_entry_id"]


# ── service 层：豁免轮回归保护（不被 SessionEmptyPrompt 拒） ─────────────────


class TestExemptTurnsNotRejected:
    """task-07 豁免口径回归：静默切换轮 / 附件看图说话轮允许空 prompt。"""

    @pytest.fixture()
    def mocked_hub(self):
        hub = _mock_hub()
        with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
            yield hub

    @pytest.fixture()
    def mocked_redis(self):
        redis = AsyncMock()
        redis.publish = AsyncMock()
        with patch("app.modules.daemon.session.service.get_redis", return_value=redis):
            yield redis

    @pytest.fixture()
    def mocked_storage(self):
        """附件对象存储读打桩（多模态块组装读 bytes，不打桩会打真 MinIO）。"""
        backend = MagicMock()
        backend.read_bytes = AsyncMock(return_value=b"x" * 16)
        with patch("app.modules.storage.factory.get_storage_backend", return_value=backend):
            yield backend

    async def _seed_session(
        self, db_session: AsyncSession, *, finish_first: bool = True
    ) -> tuple[uuid.UUID, object]:
        """建 user/runtime + 会话（provider=claude，附件引擎门控要求）。

        finish_first=True 把首轮置 completed（空闲轮 inject 场景）；
        False 保持首轮 pending（忙轮 queue_when_busy 入队场景）。
        """
        uid = await _create_user(db_session)
        rt = await _create_runtime(db_session, uid)
        from app.modules.daemon.service import DaemonService

        svc = DaemonService(db_session)
        created = await svc.create_session(
            uid, provider="claude", prompt="first", runtime_id=str(rt.id)
        )
        if finish_first:
            await _finish_first_turn(db_session, created)
        return uid, created

    @pytest.mark.asyncio
    async def test_empty_prompt_with_switch_fields_exempt(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """回归保护：prompt="" + 切换字段（ql-20260817-010 静默切换轮）不被
        SessionEmptyPrompt 拒——照常走切换分支，run 直接落 completed。"""
        from app.modules.daemon.service import DaemonService

        uid, created = await self._seed_session(db_session)
        profile_b = await _create_profile(db_session, uid, name="新人格", system_prompt="b")

        svc = DaemonService(db_session)
        result = await svc.inject_session(
            created.agent_session.id, uid, prompt="", agent_profile_id=str(profile_b.id)
        )

        # 静默切换轮语义不变：无 LLM turn、run 直接终态 completed、切换生效。
        assert result.agent_run.status == "completed"
        assert result.agent_run.agent_profile_id == profile_b.id

    @pytest.mark.asyncio
    async def test_empty_prompt_with_attachments_not_empty_prompt_422(
        self, db_session, mocked_hub, mocked_redis, mocked_storage
    ) -> None:
        """回归保护：prompt="" + attachment_ids（D-7 看图说话轮）不被
        SessionEmptyPrompt 422 拒——入口空判豁免附件（``not attachment_ids``
        条件），请求继续走附件预读。

        注意现状：锁内 ql-20260818-002 旧判空（防等值切换空轮卡死）不豁免
        附件，空闲轮纯附件轮最终仍 409 ``DaemonSessionNotActive``——该行为
        task-07 之前即如此、task-07 未改变。本用例锁定的回归点：附件轮的
        错误**不得**变成 SESSION_EMPTY_PROMPT 422（入口豁免条件被改坏时会
        422，立刻抓到）。
        """
        from app.modules.daemon.service import DaemonService
        from app.modules.daemon.session.service import DaemonSessionNotActive

        uid, created = await self._seed_session(db_session)
        att = await _seed_attachment(
            db_session, uid, kind="image", name="截图.png", sess_id=created.agent_session.id
        )

        svc = DaemonService(db_session)
        # 不是 SessionEmptyPrompt（422）：入口附件豁免放行，走到锁内旧判空。
        with pytest.raises(DaemonSessionNotActive, match="prompt must not be empty"):
            await svc.inject_session(
                created.agent_session.id, uid, prompt="", attachment_ids=[att.id]
            )

    @pytest.mark.asyncio
    async def test_empty_prompt_with_attachments_enqueued_when_busy(
        self, db_session, mocked_hub, mocked_redis, mocked_storage
    ) -> None:
        """附件轮真实可发路径：忙轮（首轮 pending）+ queue_when_busy=True +
        prompt="" + attachment_ids → 不被任何空判拒绝，成功入队（queued=True、
        队列条目携带附件引用）——D-7 看图说话轮经由排队路径端到端可达。"""
        from app.modules.daemon.service import DaemonService

        uid, created = await self._seed_session(db_session, finish_first=False)
        att = await _seed_attachment(
            db_session, uid, kind="image", name="架构图.png", sess_id=created.agent_session.id
        )

        svc = DaemonService(db_session)
        result = await svc.inject_session(
            created.agent_session.id,
            uid,
            prompt="",
            attachment_ids=[att.id],
            queue_when_busy=True,
        )

        assert result.queued is True
        assert result.agent_run is None
        assert result.queue_entry_id is not None
