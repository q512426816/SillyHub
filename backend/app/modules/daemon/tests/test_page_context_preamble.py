"""2026-08-25-unified-floating-session：页面上下文前导（FR-5 / D-005）。

覆盖三层：
- A. ``build_page_context_preamble`` 纯逻辑单测（镜像 test_change_session.py
  §A 范式）：None 入参 / 查无项目 → None；命中 → 【页面上下文】含项目名/
  编码/状态，单值 120 截断。
- B. schema 校验：非法 page_key → ValidationError（422 同源）。
- C. create 路径拼接（镜像 test_session_team_mission.py t09 范式）：lease
  metadata prompt 含【页面上下文】且在用户消息之前；AgentRunLog(user_input)
  保持干净用户原文（展示层干净）；不传 page_context 逐字节零回归。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRunLog
from app.modules.daemon.model import DaemonTaskLease
from app.modules.daemon.schema import PageContextCreateBlock
from app.modules.ppm.project.model import PpmProjectMaintenance

# ── helpers（t09 同款：mock hub/redis + user/runtime 种子）────────────────────


def _mock_hub(*, connected: bool = True):
    from unittest.mock import AsyncMock, MagicMock

    hub = MagicMock()
    hub.is_connected.return_value = connected
    hub.connected_runtime_ids = []
    hub.connected_daemon_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=connected)
    return hub


@pytest.fixture()
def mocked_hub():
    from unittest.mock import patch

    hub = _mock_hub()
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        yield hub


@pytest.fixture()
def mocked_redis():
    from unittest.mock import AsyncMock, patch

    redis = AsyncMock()
    redis.publish = AsyncMock()
    with patch("app.modules.daemon.session.service.get_redis", return_value=redis):
        yield redis


async def _create_user(db_session) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"uf-{uid}@example.com",
            password_hash="x",
            display_name="UF",
            status="active",
        )
    )
    await db_session.commit()
    return uid


async def _create_runtime(db_session, user_id: uuid.UUID):
    from app.modules.daemon.model import DaemonRuntime

    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon-claude",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)
    await db_session.commit()
    return rt


async def _make_project(db_session, **overrides) -> PpmProjectMaintenance:
    kw = dict(
        id=uuid.uuid4(),
        project_name="智慧园区一期",
        project_code="PM-2026-001",
        project_status="进行中",
    )
    kw.update(overrides)
    p = PpmProjectMaintenance(**kw)
    db_session.add(p)
    await db_session.commit()
    return p


# ── A. build_page_context_preamble 单测 ──────────────────────────────────────


class TestBuildPageContextPreamble:
    @pytest.mark.asyncio
    async def test_none_inputs_return_none(self, db_session: AsyncSession) -> None:
        from app.modules.daemon.session.context import build_page_context_preamble

        assert await build_page_context_preamble(db_session, None, None) is None
        assert await build_page_context_preamble(db_session, "ppm_project", None) is None
        # 未知枚举（服务层 Literal 已挡，构建器兜底同语义）。
        assert await build_page_context_preamble(db_session, "other_page", uuid.uuid4()) is None

    @pytest.mark.asyncio
    async def test_unknown_project_returns_none(self, db_session) -> None:
        from app.modules.daemon.session.context import build_page_context_preamble

        assert await build_page_context_preamble(db_session, "ppm_project", uuid.uuid4()) is None

    @pytest.mark.asyncio
    async def test_valid_project_produces_preamble(self, db_session) -> None:
        from app.modules.daemon.session.context import build_page_context_preamble

        project = await _make_project(db_session)
        preamble = await build_page_context_preamble(db_session, "ppm_project", project.id)
        assert preamble is not None
        assert "【页面上下文】" in preamble
        assert "PPM · 项目详情" in preamble
        assert "智慧园区一期" in preamble
        assert "PM-2026-001" in preamble
        assert "进行中" in preamble

    @pytest.mark.asyncio
    async def test_long_values_truncated_to_120(self, db_session) -> None:
        from app.modules.daemon.session.context import build_page_context_preamble

        project = await _make_project(db_session, project_name="超" * 300, project_code="C" * 200)
        preamble = await build_page_context_preamble(db_session, "ppm_project", project.id)
        assert preamble is not None
        assert "超" * 120 in preamble
        assert "超" * 121 not in preamble
        assert "C" * 120 in preamble
        assert "C" * 121 not in preamble


# ── B. schema 校验 ────────────────────────────────────────────────────────────


class TestPageContextSchema:
    def test_valid_block_accepted(self) -> None:
        from app.modules.daemon.schema import PageContextCreateBlock

        blk = PageContextCreateBlock(page_key="ppm_project", project_id=uuid.uuid4())
        assert blk.page_key == "ppm_project"

    def test_invalid_page_key_rejected(self) -> None:
        from app.modules.daemon.schema import PageContextCreateBlock

        with pytest.raises(ValidationError):
            PageContextCreateBlock(page_key="workspace_overview", project_id=uuid.uuid4())

    def test_project_id_required(self) -> None:
        from app.modules.daemon.schema import PageContextCreateBlock

        with pytest.raises(ValidationError):
            PageContextCreateBlock(page_key="ppm_project")


# ── C. create 路径拼接（t09 范式）────────────────────────────────────────────


class TestCreatePathInjection:
    @pytest.mark.asyncio
    async def test_lease_prompt_carries_preamble_user_log_clean(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        from app.modules.daemon.service import DaemonService

        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)
        project = await _make_project(db_session)

        user_prompt = "这个项目本周有什么风险？"
        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid,
            provider="claude",
            prompt=user_prompt,
            page_context=PageContextCreateBlock(page_key="ppm_project", project_id=project.id),
        )

        lease = await db_session.get(DaemonTaskLease, result.lease_id)
        assert lease is not None
        meta_prompt = (lease.metadata_ or {}).get("prompt", "")
        assert "【页面上下文】" in meta_prompt
        assert "智慧园区一期" in meta_prompt
        assert meta_prompt.index("【页面上下文】") < meta_prompt.index(user_prompt)
        assert "\n\n---\n\n" in meta_prompt

        # 展示层干净：AgentRunLog(user_input) 只写用户原文。
        log = (
            (
                await db_session.execute(
                    select(AgentRunLog).where(AgentRunLog.run_id == result.agent_run.id)
                )
            )
            .scalars()
            .first()
        )
        assert log is not None
        assert "【页面上下文】" not in (log.content_redacted or "")
        assert user_prompt in (log.content_redacted or "")

    @pytest.mark.asyncio
    async def test_without_page_context_regression_free(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        from app.modules.daemon.service import DaemonService

        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)

        user_prompt = "普通对话"
        svc = DaemonService(db_session)
        result = await svc.create_session(uid, provider="claude", prompt=user_prompt)

        lease = await db_session.get(DaemonTaskLease, result.lease_id)
        assert lease is not None
        assert (lease.metadata_ or {}).get("prompt") == user_prompt

    @pytest.mark.asyncio
    async def test_unknown_project_id_creates_session_without_preamble(
        self, db_session, mocked_hub, mocked_redis
    ) -> None:
        """查无项目：会话正常创建、前导静默不注入（不 4xx 不阻断）。"""
        from app.modules.daemon.service import DaemonService

        uid = await _create_user(db_session)
        await _create_runtime(db_session, uid)

        user_prompt = "继续聊"
        svc = DaemonService(db_session)
        result = await svc.create_session(
            uid,
            provider="claude",
            prompt=user_prompt,
            page_context=PageContextCreateBlock(page_key="ppm_project", project_id=uuid.uuid4()),
        )

        lease = await db_session.get(DaemonTaskLease, result.lease_id)
        assert lease is not None
        assert (lease.metadata_ or {}).get("prompt") == user_prompt
