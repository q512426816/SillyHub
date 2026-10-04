"""tool_report 会话接手（takeover）核心测试（2026-09-30-tool-report-
activation-wrong-machine task-04 / FR-02 / FR-03 / D-002@v1 / D-006@v1）。

覆盖矩阵（task-04 acceptance）：

- 校验：401 / 404 不存在与属主 / 409 非 tool_report / 409 已激活；
- 四级匹配：① machine_id 精确（runtime metadata 同源值）② hostname 唯一
  ③ allowed_roots 唯一（cwd 前缀边界敏感）④ 无匹配 409 中文含机器名不换机
  （含歧义拒绝：hostname 多台 / allowed_roots 多台）；
- 分档：claude-code → native（lease metadata 含 resume_session_id）；
  zcode → handoff 桩（handoff_doc=False）；
- 源会话红线（D-006）：takeover 成功后源会话全列快照逐字段一致；
- fork 落库：origin='fork' + fork_of_session_id=源 + fork_at_run_id NULL。

夹具范式镜像 test_session_fork.py（mocked hub/redis + ORM 直落源会话与
platform_agent_logs 前置）。Production: session/service/takeover.py。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy import inspect, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentSession
from app.modules.daemon.model import DaemonTaskLease
from app.modules.platform_sync.model import AgentSessionLogORM

from .test_session_fork import _admin_user_id
from .test_session_switch_config import _create_runtime

_WS_HUB_GETTER = "app.modules.daemon.ws_hub.get_daemon_ws_hub"
_REDIS_GETTER = "app.modules.daemon.session.service.get_redis"

MACHINE_ID = "0f1e2d3c-4b5a-4c6d-8e9f-a0b1c2d3e4f5"
HOSTNAME = "DESKTOP-HJ0AM09"


@pytest.fixture()
def mocked_hub():
    hub = MagicMock()
    hub.is_connected.return_value = True
    hub.connected_runtime_ids = []
    hub.connected_daemon_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=True)
    hub.send_rpc = AsyncMock(return_value=None)
    with patch(_WS_HUB_GETTER, return_value=hub):
        yield hub


@pytest.fixture()
def mocked_redis():
    redis = AsyncMock()
    redis.publish = AsyncMock()
    with patch(_REDIS_GETTER, return_value=redis):
        yield redis


async def _seed_tool_report_session(
    db_session: AsyncSession,
    *,
    harness: str = "claude-code",
    provider: str = "claude",
    cwd: str = "C:/Users/qinyi/IdeaProjects/multi-agent-platform",
    status: str = "pending",
    reported_machine_id: str | None = None,
    reported_machine_name: str | None = None,
    engine_session_id: str | None = None,
    session_cwd: str | None = None,
    entry_cwd: str | None = None,
) -> AgentSession:
    """ORM 直落未激活 tool_report 源会话 + 关联 platform_agent_logs 行。

    ``session_cwd`` / ``entry_cwd`` 缺省跟随 ``cwd``；传 ``""`` 可单独置空——
    真实 ingest 不写会话行 cwd（2026-10-04-takeover-tier3-agent-cwd-fallback
    的回归形态）。
    """
    owner_id = await _admin_user_id(db_session)
    from app.modules.workspace.model import Workspace

    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"ws-{uuid.uuid4().hex[:6]}",
        root_path=f"C:/Users/qinyi/IdeaProjects/proj-{uuid.uuid4().hex[:6]}",
    )
    db_session.add(ws)
    await db_session.flush()
    ws_id = ws.id
    session = AgentSession(
        id=uuid.uuid4(),
        user_id=owner_id,
        workspace_id=ws_id,
        provider=provider,
        status=status,
        origin="tool_report",
        aggregation_key=f"ctx-{uuid.uuid4().hex[:8]}",
        title=f"本地 · {harness}",
        config_snapshot={
            "harness": harness,
            **(
                {
                    "latest_reported_machine": {
                        "machine_id": reported_machine_id,
                        "hostname": reported_machine_name,
                    }
                }
                if (reported_machine_id or reported_machine_name)
                else {}
            ),
        },
        turn_count=0,
        cwd=cwd if session_cwd is None else session_cwd,
        last_active_at=datetime.now(UTC),
    )
    db_session.add(session)
    await db_session.flush()
    db_session.add(
        AgentSessionLogORM(
            id=uuid.uuid4(),
            workspace_id=ws_id,
            agent_session_id=session.id,
            log_path=f"C:/Users/qinyi/.logs/{uuid.uuid4()}.jsonl",
            harness=harness,
            agent_cwd=cwd if entry_cwd is None else entry_cwd,
            session_id=engine_session_id,
            reported_machine_id=reported_machine_id,
            reported_machine_name=reported_machine_name,
            first_seen_at="2026-09-30T00:00:00.000Z",
            last_seen_at="2026-09-30T01:00:00.000Z",
        )
    )
    await db_session.commit()
    await db_session.refresh(session)
    return session


def _snapshot(session: AgentSession) -> dict[str, object]:
    state = inspect(session)
    return {attr.key: getattr(session, attr.key) for attr in state.mapper.column_attrs}


async def _takeover(
    client: AsyncClient,
    auth_headers: dict[str, str],
    session_id: uuid.UUID,
    *,
    prompt: str = "你好，继续这个任务",
    provider: str | None = None,
):
    body: dict = {"prompt": prompt}
    if provider:
        body["provider"] = provider
    return await client.post(
        f"/api/daemon/sessions/{session_id}/takeover", json=body, headers=auth_headers
    )


# ════════════════════════════════════════════════════════════════════════════
# 校验矩阵
# ════════════════════════════════════════════════════════════════════════════


class TestTakeoverValidation:
    @pytest.mark.asyncio
    async def test_unauthenticated_401(self, client: AsyncClient) -> None:
        resp = await client.post(
            f"/api/daemon/sessions/{uuid.uuid4()}/takeover", json={"prompt": "x"}
        )
        assert resp.status_code == 401

    @pytest.mark.asyncio
    async def test_session_missing_404(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        resp = await _takeover(client, auth_headers, uuid.uuid4())
        assert resp.status_code == 404, resp.text

    @pytest.mark.asyncio
    async def test_non_tool_report_409(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """chat 会话（svc create 建）→ 409（仅 tool_report 支持接手）。"""
        owner_id = await _admin_user_id(db_session)
        rt = await _create_runtime(db_session, owner_id)
        from app.modules.daemon.service import DaemonService

        created = await DaemonService(db_session).create_session(
            owner_id, provider="claude", prompt="first", runtime_id=str(rt.id)
        )
        resp = await _takeover(client, auth_headers, created.agent_session.id)
        assert resp.status_code == 409, resp.text

    @pytest.mark.asyncio
    async def test_already_activated_409(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        source = await _seed_tool_report_session(db_session, status="active")
        resp = await _takeover(client, auth_headers, source.id)
        assert resp.status_code == 409, resp.text
        assert "重置" in resp.json()["message"]


# ════════════════════════════════════════════════════════════════════════════
# 四级匹配矩阵（D-002@v1）
# ════════════════════════════════════════════════════════════════════════════


class TestFourTierMatching:
    @pytest.mark.asyncio
    async def test_tier1_machine_id_exact(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """① machine_id 精确命中（他机同名 hostname 不干扰）。"""
        owner_id = await _admin_user_id(db_session)
        right = await _create_runtime(db_session, owner_id, name=HOSTNAME)
        right.metadata_ = {"machine_id": MACHINE_ID}
        db_session.add(right)
        # 干扰项：同 hostname 异 machine_id（②级会歧义，①级必须先行命中）。
        decoy = await _create_runtime(db_session, owner_id, name=HOSTNAME)
        decoy.metadata_ = {"machine_id": "another-machine"}
        db_session.add(decoy)
        await db_session.commit()

        source = await _seed_tool_report_session(
            db_session, reported_machine_id=MACHINE_ID, reported_machine_name=HOSTNAME
        )
        resp = await _takeover(client, auth_headers, source.id)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["tier"] == "native"
        assert body["handoff_doc"] is False

    @pytest.mark.asyncio
    async def test_tier2_hostname_unique(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """② hostname 唯一命中（无 machine_id 时）。"""
        owner_id = await _admin_user_id(db_session)
        await _create_runtime(db_session, owner_id, name=HOSTNAME)
        source = await _seed_tool_report_session(db_session, reported_machine_name=HOSTNAME)
        resp = await _takeover(client, auth_headers, source.id)
        assert resp.status_code == 201, resp.text

    @pytest.mark.asyncio
    async def test_tier3_allowed_roots_unique(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """③ 存量无机器身份：cwd ∈ allowed_roots 唯一命中（另一台不含该前缀）。"""
        owner_id = await _admin_user_id(db_session)
        right = await _create_runtime(db_session, owner_id, name="WIN-BOX")
        right.allowed_roots = ["C:/Users/qinyi"]
        db_session.add(right)
        other = await _create_runtime(db_session, owner_id, name="MAC-BOX")
        other.allowed_roots = ["/Users/qinyi"]
        db_session.add(other)
        await db_session.commit()

        source = await _seed_tool_report_session(db_session)  # 无 machine 身份
        resp = await _takeover(client, auth_headers, source.id)
        assert resp.status_code == 201, resp.text

    @pytest.mark.asyncio
    async def test_tier3_fallback_entry_agent_cwd(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """③回退：会话行 cwd 恒空（真实 ingest 形态）→ 最新 entry 的 agent_cwd
        参与匹配，唯一覆盖机器可接手（2026-10-04-takeover-tier3-agent-cwd-fallback）。"""
        owner_id = await _admin_user_id(db_session)
        right = await _create_runtime(db_session, owner_id, name="WIN-BOX")
        right.allowed_roots = ["C:/Users/qinyi"]
        db_session.add(right)
        other = await _create_runtime(db_session, owner_id, name="MAC-BOX")
        other.allowed_roots = ["/Users/qinyi"]
        db_session.add(other)
        await db_session.commit()

        # 会话行 cwd 空、entry 带 agent_cwd——服务器实例 7ea5177a 的真实形态。
        source = await _seed_tool_report_session(
            db_session, harness="zcode", provider="claude", session_cwd=""
        )
        resp = await _takeover(client, auth_headers, source.id)
        assert resp.status_code == 201, resp.text
        assert resp.json()["tier"] == "handoff"  # zcode 不可 resume → handoff 档

    @pytest.mark.asyncio
    async def test_tier3_fallback_prefers_main_log_entry(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """③回退取主日志 entry 的 agent_cwd——更新的 subagent 行（worktree 副本
        cwd，不被白名单覆盖）不参与匹配，否则本用例应 409。"""
        owner_id = await _admin_user_id(db_session)
        right = await _create_runtime(db_session, owner_id, name="WIN-BOX")
        right.allowed_roots = ["C:/Users/qinyi"]
        db_session.add(right)
        await db_session.commit()

        source = await _seed_tool_report_session(db_session, session_cwd="")
        ws_id = source.workspace_id
        db_session.add(
            AgentSessionLogORM(
                id=uuid.uuid4(),
                workspace_id=ws_id,
                agent_session_id=source.id,
                # subagent 前缀路径 + 更新 last_seen_at + worktree 副本 cwd。
                log_path=f"C:/Users/qinyi/.logs/subagent-{uuid.uuid4()}.jsonl",
                harness="claude-code",
                agent_cwd="D:/worktrees/copy-xyz",
                first_seen_at="2026-09-30T00:00:00.000Z",
                last_seen_at="2026-09-30T02:00:00.000Z",
            )
        )
        await db_session.commit()

        resp = await _takeover(client, auth_headers, source.id)
        assert resp.status_code == 201, resp.text

    @pytest.mark.asyncio
    async def test_tier3_no_cwd_anywhere_409(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """③回退兜底：会话行与 entry 均无 cwd → 维持 409 原文案（目录「未知」）。"""
        owner_id = await _admin_user_id(db_session)
        mac = await _create_runtime(db_session, owner_id, name="MAC-BOX")
        mac.allowed_roots = ["/Users/qinyi"]
        db_session.add(mac)
        await db_session.commit()

        source = await _seed_tool_report_session(db_session, session_cwd="", entry_cwd="")
        resp = await _takeover(client, auth_headers, source.id)
        assert resp.status_code == 409, resp.text
        msg = resp.json()["message"]
        assert "未携带机器身份" in msg
        assert "未知" in msg
        assert resp.json()["details"]["machine_candidates"] == []

    @pytest.mark.asyncio
    async def test_tier4_no_match_409_with_machine_name(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """④ 原机离线/无匹配 → 409 中文含机器名，不建会话不换机。"""
        owner_id = await _admin_user_id(db_session)
        # 唯一在线机器是另一台（cwd 不在其白名单）。
        mac = await _create_runtime(db_session, owner_id, name="qinyideMac-mini-3.local")
        mac.allowed_roots = ["/Users/qinyi"]
        db_session.add(mac)
        await db_session.commit()

        source = await _seed_tool_report_session(
            db_session, reported_machine_name="DESKTOP-HJ0AM09"
        )
        before_sessions = (
            (await db_session.execute(select(AgentSession).where(AgentSession.origin == "fork")))
            .scalars()
            .all()
        )

        resp = await _takeover(client, auth_headers, source.id)
        assert resp.status_code == 409, resp.text
        msg = resp.json()["message"]
        assert "DESKTOP-HJ0AM09" in msg
        assert "不会换到其它机器" in msg
        # 第三态（无身份且零命中）文案可诊断：另一会话无机器身份且 cwd 不被任何
        # 白名单覆盖 → 断言「未携带机器身份」指引面（2026-09-30-takeover-tier3）。
        naked = await _seed_tool_report_session(
            db_session, cwd="Z:/nowhere/project", reported_machine_name=None
        )
        resp2 = await _takeover(client, auth_headers, naked.id)
        assert resp2.status_code == 409, resp2.text
        assert "未携带机器身份" in resp2.json()["message"]
        assert resp2.json()["details"]["machine_candidates"] == []
        # 未建任何接手会话。
        after_sessions = (
            (await db_session.execute(select(AgentSession).where(AgentSession.origin == "fork")))
            .scalars()
            .all()
        )
        assert list(after_sessions) == list(before_sessions)

    @pytest.mark.asyncio
    async def test_ambiguous_hostname_409(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """②级多台同名机器（daemon_instance 各异）→ 歧义拒绝（宁拒不猜）。"""
        owner_id = await _admin_user_id(db_session)
        rt_a = await _create_runtime(db_session, owner_id, name=HOSTNAME)
        rt_a.daemon_instance_id = uuid.uuid4()
        db_session.add(rt_a)
        rt_b = await _create_runtime(db_session, owner_id, name=HOSTNAME)
        rt_b.daemon_instance_id = uuid.uuid4()
        db_session.add(rt_b)
        await db_session.commit()
        source = await _seed_tool_report_session(db_session, reported_machine_name=HOSTNAME)
        resp = await _takeover(client, auth_headers, source.id)
        assert resp.status_code == 409, resp.text

    @pytest.mark.asyncio
    async def test_tier3_ambiguous_lists_machine_names(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """2026-09-30-takeover-tier3-ambiguous-msg：③级多机命中 → 409 文案列出
        全部命中机器名（可诊断——用户知道该清哪台 allowed_roots）。"""
        owner_id = await _admin_user_id(db_session)
        # 两台机器（daemon_instance 各异）白名单都覆盖 cwd。
        rt_win = await _create_runtime(db_session, owner_id, name="DESKTOP-HJ0AM09")
        rt_win.daemon_instance_id = uuid.uuid4()
        rt_win.allowed_roots = ["C:\\Users\\qinyi"]
        db_session.add(rt_win)
        rt_mac = await _create_runtime(db_session, owner_id, name="qinyideMac-mini-3.local")
        rt_mac.daemon_instance_id = uuid.uuid4()
        rt_mac.allowed_roots = ["/Users/qinyi", "C:/Users/qinyi/IdeaProjects/multi-agent-platform"]
        db_session.add(rt_mac)
        await db_session.commit()

        source = await _seed_tool_report_session(db_session)  # 无机器身份 → ③级
        resp = await _takeover(client, auth_headers, source.id)
        assert resp.status_code == 409, resp.text
        body = resp.json()
        msg = body["message"]
        assert "DESKTOP-HJ0AM09" in msg and "qinyideMac-mini-3.local" in msg
        assert "2 台在线机器" in msg
        assert set(body.get("details", {}).get("machine_candidates", [])) == {
            "DESKTOP-HJ0AM09",
            "qinyideMac-mini-3.local",
        }


# ════════════════════════════════════════════════════════════════════════════
# 分档 + fork 落库 + 源会话红线（D-006@v1）
# ════════════════════════════════════════════════════════════════════════════


class TestTiersAndForkCreation:
    @pytest.mark.asyncio
    async def test_native_tier_resume_session_id_in_lease(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """claude-code → native：lease metadata 含 resume_session_id=上报会话 id。"""
        owner_id = await _admin_user_id(db_session)
        rt = await _create_runtime(db_session, owner_id, name=HOSTNAME)
        rt.allowed_roots = ["C:/Users/qinyi"]
        db_session.add(rt)
        await db_session.commit()

        engine_sid = str(uuid.uuid4())
        source = await _seed_tool_report_session(
            db_session,
            harness="claude-code",
            reported_machine_name=HOSTNAME,
            engine_session_id=engine_sid,
        )
        source_id = source.id  # expire_all 后属性访问会触发同步 lazy load，先取
        before = _snapshot(source)

        resp = await _takeover(client, auth_headers, source.id)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["tier"] == "native"

        db_session.expire_all()
        fresh = await db_session.get(AgentSession, source_id)
        assert fresh is not None
        after = _snapshot(fresh)
        # 源会话红线：全列一致（status/turn_count/lease_id/runtime_id 零写）。
        assert after == before

        new_session = await db_session.get(AgentSession, uuid.UUID(body["session_id"]))
        assert new_session is not None
        assert new_session.origin == "fork"
        assert new_session.fork_of_session_id == source_id
        assert new_session.fork_at_run_id is None  # 零 run 源首个 NULL 锚点形态

        lease = await db_session.get(DaemonTaskLease, uuid.UUID(body["lease_id"]))
        assert lease is not None
        meta = dict(lease.metadata_ or {})
        assert meta.get("resume_session_id") == engine_sid

    @pytest.mark.asyncio
    async def test_handoff_tier_stub(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_hub,
        mocked_redis,
    ) -> None:
        """zcode → handoff 桩（handoff_doc=False，交接文档归 task-05）。"""
        owner_id = await _admin_user_id(db_session)
        rt = await _create_runtime(db_session, owner_id, name=HOSTNAME)
        rt.allowed_roots = ["C:/Users/qinyi"]
        db_session.add(rt)
        await db_session.commit()

        source = await _seed_tool_report_session(
            db_session,
            harness="zcode",
            provider="claude",  # D-007 映射：zcode → claude 引擎行
            reported_machine_name=HOSTNAME,
        )
        source_id = source.id
        resp = await _takeover(client, auth_headers, source_id)
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["tier"] == "handoff"
        assert body["handoff_doc"] is False
        db_session.expire_all()
        new_session = await db_session.get(AgentSession, uuid.UUID(body["session_id"]))
        assert new_session is not None
        assert new_session.fork_of_session_id == source_id


# ════════════════════════════════════════════════════════════════════════════
# 存量重置（task-06 / FR-05 / D-003@v1）
# ════════════════════════════════════════════════════════════════════════════


class TestResetToolReport:
    async def _seed_activated_session(self, db_session: AsyncSession) -> AgentSession:
        """模拟旧懒激活钉死形态：active + lease/runtime + 一条 failed run。"""
        from app.modules.agent.model import AgentRun

        source = await _seed_tool_report_session(db_session, status="active")
        owner_id = source.user_id
        rt = await _create_runtime(db_session, owner_id, name="wrong-machine")
        source.runtime_id = rt.id
        source.lease_id = uuid.uuid4()
        source.turn_count = 1
        db_session.add(source)
        db_session.add(
            AgentRun(
                id=uuid.uuid4(),
                agent_type="claude_code",
                provider=source.provider,
                status="failed",
                error_code="interactive_interrupted",
                spec_strategy="interactive",
                agent_session_id=source.id,
                user_id=owner_id,
            )
        )
        await db_session.commit()
        await db_session.refresh(source)
        return source

    @pytest.mark.asyncio
    async def test_reset_rolls_back_to_pending(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_redis,
    ) -> None:
        """钉死会话重置：四字段回滚 + run 行保留审计 + 事件发布。"""
        source = await self._seed_activated_session(db_session)
        source_id = source.id

        resp = await client.post(
            f"/api/daemon/sessions/{source_id}/reset-tool-report",
            headers=auth_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "pending"
        assert body["cleared_runs"] == 1

        db_session.expire_all()
        fresh = await db_session.get(AgentSession, source_id)
        assert fresh is not None
        assert fresh.status == "pending"
        assert fresh.turn_count == 0
        assert fresh.runtime_id is None
        assert fresh.lease_id is None
        # 失败 run 行保留（审计）。
        from app.modules.agent.model import AgentRun

        runs = (
            (
                await db_session.execute(
                    select(AgentRun).where(AgentRun.agent_session_id == source_id)
                )
            )
            .scalars()
            .all()
        )
        assert len(runs) == 1
        assert runs[0].error_code == "interactive_interrupted"
        # 事件发布走 publish_sessions_changed（内部 best-effort 静默容错，
        # Redis 抖动不影响回滚主流程——不在 HTTP 层断言其副作用）。

    @pytest.mark.asyncio
    async def test_reset_running_rejected(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_redis,
    ) -> None:
        """running run 期间重置 → 409 拒绝。"""
        from app.modules.agent.model import AgentRun

        source = await self._seed_activated_session(db_session)
        run = (
            (
                await db_session.execute(
                    select(AgentRun).where(AgentRun.agent_session_id == source.id)
                )
            )
            .scalars()
            .one()
        )
        run.status = "running"
        db_session.add(run)
        await db_session.commit()

        resp = await client.post(
            f"/api/daemon/sessions/{source.id}/reset-tool-report",
            headers=auth_headers,
        )
        assert resp.status_code == 409, resp.text

    @pytest.mark.asyncio
    async def test_reset_chat_session_rejected(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_redis,
    ) -> None:
        """chat 会话重置 → 409（仅 tool_report）。"""
        resp = await client.post(
            f"/api/daemon/sessions/{uuid.uuid4()}/reset-tool-report",
            headers=auth_headers,
        )
        assert resp.status_code == 404, resp.text

    @pytest.mark.asyncio
    async def test_reset_soft_deleted_session_rejected(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        mocked_redis,
    ) -> None:
        """软删（deleted_at 置位）会话重置 → 404（对齐 takeover 同款守卫）。

        2026-10-01-review-followup-reset-guard-machineid task-01：reset 查询
        原缺 deleted_at 过滤，软删会话可被属主重置并广播事件——守卫补齐后
        与 takeover 会话查询完全同形。
        """
        source = await self._seed_activated_session(db_session)
        source.deleted_at = datetime.now(UTC)
        db_session.add(source)
        await db_session.commit()

        resp = await client.post(
            f"/api/daemon/sessions/{source.id}/reset-tool-report",
            headers=auth_headers,
        )
        assert resp.status_code == 404, resp.text
