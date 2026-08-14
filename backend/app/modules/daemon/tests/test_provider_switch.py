"""task-04（2026-08-06-provider-switch-live-session）：notify_provider_switch 单测。

覆盖 design §5 Wave1 step 3-4 + 蓝图 acceptance：
  1. 有 active session 分布多 daemon → 按 owning daemon 各推一次 PROVIDER_CONFIG_CHANGED,
     payload 带 session_id + provider_config;返回成功投递计数。
  2. 无 active session（无行 / 全 ended/failed/pending）→ 推 0 次,no-op 不抛,返回 0
     （brownfield 零回归,design §9）。
  3. 启动场景推新 config dict;停止场景推 None（daemon reloadWithProvider(null) 回退本机）。
  4. 单个 daemon 离线（send_session_control 返回 False）不影响其余 daemon 推送
     （best-effort,design §9 / 参考 _send_interactive_cancel）。

mock 策略（不真实 WS）：
  - ``get_daemon_ws_hub`` → 录制型 FakeHub（capture send_session_control 入参 + 可控返回值）。
  - ``_resolve_daemon_id_for_runtime`` 不 mock：用真实 DB + DaemonRuntime 行（daemon_instance_id
    留 None 走 D-007 回退分支 → daemon_id = runtime_id 本身）,多个 runtime 即多个 daemon_id,
    守护真实 join + 解析链路。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentSession
from app.modules.daemon.lease.provider_switch import notify_provider_switch
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.protocol import DAEMON_MSG_PROVIDER_CONFIG_CHANGED

# ── Helpers ──────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    """Insert a User row so FK constraints on agent_sessions/daemon_runtimes hold."""
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"task04-ps-{uid}@example.com",
            password_hash="irrelevant",
            display_name="T",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _create_runtime(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    name_suffix: str = "d1",
) -> DaemonRuntime:
    """创建 DaemonRuntime 行（daemon_instance_id=None → 走 D-007 runtime_id 回退）。

    多个 runtime = 多个 daemon_id（回退分支 daemon_id=runtime_id 本身）,用于测试
    「分布多 daemon 各推一次」。
    """
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name=f"task04-ps-rt-{name_suffix}",
        provider="claude_code",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


async def _create_interactive_session(
    session: AsyncSession,
    *,
    runtime_id: uuid.UUID,
    user_id: uuid.UUID,
    session_status: str = "active",
) -> uuid.UUID:
    """构造 interactive lease + AgentSession（绑 lease.runtime_id）,返回 session_id。

    只建 lease + session 两行（notify_provider_switch 的查询只 join 这两张表,
    不触碰 AgentRun,故无需创建 run）。lease.kind='interactive' 守 query 过滤分支。
    """
    now = datetime.now(UTC)
    sess_id = uuid.uuid4()

    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=None,  # D-005@v1 interactive lease 绑 session 不绑 run
        status="claimed",
        kind="interactive",
        claimed_at=now,
        lease_expires_at=None,  # interactive lease 不过期
        metadata_={"claim_token": "tok", "session_id": str(sess_id)},
        created_at=now,
        updated_at=now,
    )
    agent_session = AgentSession(
        id=sess_id,
        user_id=user_id,
        provider="claude",
        status=session_status,
        config={},
        turn_count=1,
        runtime_id=runtime_id,
        lease_id=lease.id,
        last_active_at=now,
        created_at=now,
    )
    session.add_all([lease, agent_session])
    await session.commit()
    return sess_id


class _RecordingHub:
    """录制型 FakeHub：capture send_session_control 入参,可控返回值模拟在线/离线。

    ``offline_daemon_ids`` 内的 daemon_id → 返回 False（模拟无 WS 连接）;
    其余 → 返回 True。未抛异常（best-effort 异常路径单独用 _ExplodingHub 测）。
    """

    def __init__(self, *, offline_daemon_ids: set[uuid.UUID] | None = None) -> None:
        self.calls: list[tuple[uuid.UUID, str, dict]] = []
        self._offline = offline_daemon_ids or set()

    async def send_session_control(
        self,
        daemon_id: uuid.UUID,
        msg_type: str,
        payload: dict,
    ) -> bool:
        self.calls.append((daemon_id, msg_type, payload))
        return daemon_id not in self._offline


def _patch_hub(
    monkeypatch: pytest.MonkeyPatch,
    *,
    offline_daemon_ids: set[uuid.UUID] | None = None,
) -> _RecordingHub:
    """monkeypatch get_daemon_ws_hub 返回录制型 hub,避免真连 daemon WS。"""
    from app.modules.daemon import ws_hub as ws_hub_mod

    hub = _RecordingHub(offline_daemon_ids=offline_daemon_ids)
    monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: hub)
    return hub


# ── Tests ────────────────────────────────────────────────────────────────────


class TestNotifyProviderSwitchMultiDaemon:
    """有 active session 分布多 daemon → 按 owning daemon 各推一次,返回投递计数。"""

    @pytest.mark.asyncio
    async def test_multi_daemon_each_pushed_once(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """2 个 active session 各挂不同 runtime（= 不同 daemon_id,D-007 回退）→
        send_session_control 被调 2 次,每次 daemon_id 不同,返回 2。
        """
        user_id = await _create_user(db_session)
        rt1 = await _create_runtime(db_session, user_id, name_suffix="d1")
        rt2 = await _create_runtime(db_session, user_id, name_suffix="d2")
        await _create_interactive_session(db_session, runtime_id=rt1.id, user_id=user_id)
        await _create_interactive_session(db_session, runtime_id=rt2.id, user_id=user_id)

        hub = _patch_hub(monkeypatch)
        config = {"agent_kind": "claude", "base_url": "https://x", "api_key": "k"}

        result = await notify_provider_switch(db_session, user_id, config)

        assert result == 2
        assert len(hub.calls) == 2
        pushed_daemon_ids = {call[0] for call in hub.calls}
        # D-007 回退：daemon_id = runtime_id 本身;两个 runtime → 两个 daemon_id
        assert pushed_daemon_ids == {rt1.id, rt2.id}
        # 消息类型契约
        for _did, msg_type, _payload in hub.calls:
            assert msg_type == DAEMON_MSG_PROVIDER_CONFIG_CHANGED

    @pytest.mark.asyncio
    async def test_payload_carries_session_id_and_config(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """payload 必须带 session_id + provider_config（对齐 ProviderConfigChangedPayload）。
        每个 session 各收到一条带自身 session_id 的推送。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        sess1 = await _create_interactive_session(db_session, runtime_id=rt.id, user_id=user_id)
        sess2 = await _create_interactive_session(db_session, runtime_id=rt.id, user_id=user_id)

        hub = _patch_hub(monkeypatch)
        config = {"agent_kind": "claude", "api_key": "secret", "model": "m1"}

        await notify_provider_switch(db_session, user_id, config)

        assert len(hub.calls) == 2
        pushed_session_ids = {call[2]["session_id"] for call in hub.calls}
        assert pushed_session_ids == {str(sess1), str(sess2)}
        for _did, _msg, payload in hub.calls:
            assert payload["provider_config"] == config


class TestNotifyProviderSwitchStartStop:
    """启动推新 config dict;停止推 None（daemon reloadWithProvider(null) 回退本机）。"""

    @pytest.mark.asyncio
    async def test_start_pushes_new_config(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """启动场景：provider_config 为 resolve_default_provider_config 构造的 dict →
        payload 原样透传（含解密 api_key,design D-006 单一真相源）。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        await _create_interactive_session(db_session, runtime_id=rt.id, user_id=user_id)

        hub = _patch_hub(monkeypatch)
        config: dict = {
            "agent_kind": "claude",
            "base_url": "https://api.example.com",
            "api_key": "sk-secret",
            "auth_field": "x-api-key",
            "model": "claude-sonnet",
            "model_role_mappings": {},
            "default_fallback_model": "claude-haiku",
            "extra_env": {},
            "settings_config": None,
        }

        result = await notify_provider_switch(db_session, user_id, config)

        assert result == 1
        assert len(hub.calls) == 1
        _did, _msg, payload = hub.calls[0]
        assert payload["provider_config"] == config
        assert payload["provider_config"] is not None

    @pytest.mark.asyncio
    async def test_stop_pushes_null_config(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """停止场景（unset_default）：provider_config=None → daemon 按 design §5
        reloadWithProvider(null) 回退本机 claude 凭证（D-004@v1）。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        await _create_interactive_session(db_session, runtime_id=rt.id, user_id=user_id)

        hub = _patch_hub(monkeypatch)

        result = await notify_provider_switch(db_session, user_id, None)

        assert result == 1
        assert len(hub.calls) == 1
        _did, _msg, payload = hub.calls[0]
        assert payload["provider_config"] is None
        # session_id 仍必带（daemon 据此定位 SessionState）
        assert "session_id" in payload


class TestNotifyProviderSwitchNoActive:
    """无 active session → 推 0 次,no-op 不抛,返回 0（brownfield 零回归,design §9）。"""

    @pytest.mark.asyncio
    async def test_no_sessions_at_all(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """用户无任何 agent_sessions 行 → 0 推送,返回 0,不抛异常。"""
        user_id = await _create_user(db_session)
        hub = _patch_hub(monkeypatch)

        result = await notify_provider_switch(db_session, user_id, {"api_key": "k"})

        assert result == 0
        assert hub.calls == []

    @pytest.mark.asyncio
    async def test_ended_sessions_not_pushed(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """session status=ended/failed/pending → 不在 active/reconnecting 白名单,
        不推送（ended/failed 是终态;pending 未与 daemon 握手,推过去也无 SessionState）。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        for status in ("ended", "failed", "pending"):
            await _create_interactive_session(
                db_session,
                runtime_id=rt.id,
                user_id=user_id,
                session_status=status,
            )

        hub = _patch_hub(monkeypatch)

        result = await notify_provider_switch(db_session, user_id, None)

        assert result == 0
        assert hub.calls == []

    @pytest.mark.asyncio
    async def test_reconnecting_session_is_pushed(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """status=reconnecting 与 active 同等处理（daemon 仍持有 SessionState,
        重连后立即生效热切换）。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        await _create_interactive_session(
            db_session,
            runtime_id=rt.id,
            user_id=user_id,
            session_status="reconnecting",
        )

        hub = _patch_hub(monkeypatch)

        result = await notify_provider_switch(db_session, user_id, None)

        assert result == 1
        assert len(hub.calls) == 1

    @pytest.mark.asyncio
    async def test_batch_lease_sessions_not_pushed(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """lease.kind != interactive（batch）的 session 不推送（design N2：batch 是独立
        新 lease + 新进程,不受「旧会话锁死」影响）。守护 query 的 lease.kind 过滤。
        """
        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        now = datetime.now(UTC)
        sess_id = uuid.uuid4()
        # batch lease + active session（status 合法但 lease kind 不符）
        lease = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=rt.id,
            agent_run_id=None,
            status="claimed",
            kind="batch",
            claimed_at=now,
            # minute+5 的 replace 在分钟 >54 时越界（ValueError），用 timedelta 稳定 +5min
            lease_expires_at=now + timedelta(minutes=5),
            metadata_={},
            created_at=now,
            updated_at=now,
        )
        agent_session = AgentSession(
            id=sess_id,
            user_id=user_id,
            provider="claude",
            status="active",
            config={},
            turn_count=0,
            runtime_id=rt.id,
            lease_id=lease.id,
            created_at=now,
        )
        db_session.add_all([lease, agent_session])
        await db_session.commit()

        hub = _patch_hub(monkeypatch)

        result = await notify_provider_switch(db_session, user_id, None)

        assert result == 0
        assert hub.calls == []


class TestNotifyProviderSwitchBestEffort:
    """best-effort（design §9）：单个 daemon 离线/异常不影响其余推送,不抛异常。"""

    @pytest.mark.asyncio
    async def test_offline_daemon_does_not_block_others(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """2 session 各挂不同 daemon,daemon A 离线（send 返回 False）、daemon B 在线 →
        B 仍被推送,函数不抛,返回成功投递数（仅在线那条）。
        """
        user_id = await _create_user(db_session)
        rt1 = await _create_runtime(db_session, user_id, name_suffix="off")
        rt2 = await _create_runtime(db_session, user_id, name_suffix="on")
        await _create_interactive_session(db_session, runtime_id=rt1.id, user_id=user_id)
        await _create_interactive_session(db_session, runtime_id=rt2.id, user_id=user_id)

        # rt1 离线（D-007 回退 daemon_id=rt1.id）
        hub = _patch_hub(monkeypatch, offline_daemon_ids={rt1.id})

        result = await notify_provider_switch(db_session, user_id, {"api_key": "k"})

        # 两条都尝试推送（按 session 各一次）,仅在线那条 delivered=True
        assert len(hub.calls) == 2
        assert result == 1
        pushed_daemon_ids = {call[0] for call in hub.calls}
        assert pushed_daemon_ids == {rt1.id, rt2.id}

    @pytest.mark.asyncio
    async def test_send_exception_does_not_raise(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """send_session_control 抛异常（WS transport 故障）→ 仅告警,不传播,
        不影响其余 session,返回 0（均未 delivered）。
        """
        from app.modules.daemon import ws_hub as ws_hub_mod

        class _ExplodingHub:
            async def send_session_control(self, daemon_id, msg_type, payload):
                raise RuntimeError("simulated WS transport failure")

        monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: _ExplodingHub())

        user_id = await _create_user(db_session)
        rt = await _create_runtime(db_session, user_id)
        await _create_interactive_session(db_session, runtime_id=rt.id, user_id=user_id)

        # 不抛异常,返回 0（异常路径不计数）
        result = await notify_provider_switch(db_session, user_id, None)
        assert result == 0


class TestNotifyProviderSwitchRuntimeNull:
    """session.runtime_id=None（无绑定 daemon）→ 跳过不推,不阻塞其余。"""

    @pytest.mark.asyncio
    async def test_session_without_runtime_skipped(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """session.runtime_id=None（极端：runtime CASCADE 删除后 session 残留）→
        无法解析 daemon_id,跳过并告警,不推送;其余正常 session 仍推。
        """
        user_id = await _create_user(db_session)
        # 正常 session（有 runtime）
        rt = await _create_runtime(db_session, user_id, name_suffix="ok")
        await _create_interactive_session(db_session, runtime_id=rt.id, user_id=user_id)
        # 无 runtime 的 session（lease.runtime_id=None + session.runtime_id=None）
        now = datetime.now(UTC)
        sess_null_id = uuid.uuid4()
        lease_null = DaemonTaskLease(
            id=uuid.uuid4(),
            runtime_id=None,
            agent_run_id=None,
            status="claimed",
            kind="interactive",
            claimed_at=now,
            lease_expires_at=None,
            metadata_={"session_id": str(sess_null_id)},
            created_at=now,
            updated_at=now,
        )
        sess_null = AgentSession(
            id=sess_null_id,
            user_id=user_id,
            provider="claude",
            status="active",
            config={},
            turn_count=0,
            runtime_id=None,
            lease_id=lease_null.id,
            created_at=now,
        )
        db_session.add_all([lease_null, sess_null])
        await db_session.commit()

        hub = _patch_hub(monkeypatch)

        result = await notify_provider_switch(db_session, user_id, None)

        # 仅正常 session 被推（无 runtime 那条跳过）
        assert result == 1
        assert len(hub.calls) == 1
