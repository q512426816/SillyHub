"""task-11（2026-08-06-provider-switch-live-session）：端到端集成测试 4 场景。

照 design §5 + 蓝图 acceptance 验「运行中会话热切换」全链路（service → probe →
resolve_default_provider_config → notify_provider_switch → ws_hub.send_session_control）。

四场景（蓝图 task-11.md）：
  1. **启动切换生效**：set_default(新供应商) → probe 通过 → 推 PROVIDER_CONFIG_CHANGED(新 config)
     → send_session_control 被调（新 config）；老默认互斥清成 False。
  2. **停止回退本机**：unset_default → 推 provider_config=None → daemon 据此回退本机 claude 凭证
     （D-004）。
  3. **生成中等待 turn 边界**：set_default 时 active + reconnecting session 均被推，
     affected_sessions 计数含生成中会话（前端文案区分）。daemon 侧 turn 边界已由 task-07
     单测覆盖，本场景后端侧只验推送 + 计数。
  4. **凭证失败保留原供应商**：set_default probe 失败 → is_default 不变 + 不推送 + 返回
     switched=False+error（D-003 回滚，原供应商继续服务运行中会话）。

mock 策略（不真实 WS / 不真实网络）：
  - ``app.modules.llm_provider.probe.probe_provider`` → ``ProviderProbeResult(ok=True/False)``
    （spike-01：探测形态未实测，网络全 mock）。
  - ``app.modules.daemon.ws_hub.get_daemon_ws_hub`` → 录制型 FakeHub（capture
    send_session_control 入参 + 可控返回值）。
  - ``notify_provider_switch`` / ``resolve_default_provider_config`` **走真实路径**（含真实
    DB JOIN agent_sessions × daemon_task_leases、真实 cipher 解密 api_key），守护全链路联通。
  - 用真实 ``CredentialCipher``（conftest 已注 ``SILLYSPEC_MASTER_KEY``）落 ``LlmProvider``
    加密行，set_default 走完整加解密链路（不 mock cipher）。

范式参考：
  - ``test_provider_switch.py``：_RecordingHub / _patch_hub / _create_interactive_session。
  - ``test_wave5_integration.py``：_create_user / _create_runtime（集成先例）。
  - ``test_llm_provider.py``：_seed_provider_row / mock_probe_notify。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import get_cipher
from app.modules.agent.model import AgentSession
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.protocol import DAEMON_MSG_PROVIDER_CONFIG_CHANGED
from app.modules.llm_provider.model import LlmProvider
from app.modules.llm_provider.probe import ProviderProbeResult
from app.modules.llm_provider.service import LlmProviderService

# ── Helpers ──────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession, *, label: str = "ps-int") -> uuid.UUID:
    """插入 User 行（FK 兼容；与 test_provider_switch.py 同范式）。"""
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"ps-int-{label}-{uid}@example.com",
            password_hash="irrelevant",
            display_name="PS-INT",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _create_runtime(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    name_suffix: str = "rt",
) -> DaemonRuntime:
    """DaemonRuntime 行（daemon_instance_id=None → D-007 回退 daemon_id=runtime_id）。"""
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name=f"ps-int-rt-{name_suffix}-{uuid.uuid4().hex[:6]}",
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
    """构造 interactive lease + AgentSession（绑 lease.runtime_id），返回 session_id。

    与 test_provider_switch.py 同范式：lease.kind='interactive' 守 notify_provider_switch
    query 过滤分支；session.runtime_id 用于解析 owning daemon_id。
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


async def _seed_provider_row(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    name: str,
    base_url: str,
    api_key: str,
    agent_kind: str = "claude",
    is_default: bool = False,
    model: str | None = "claude-sonnet-4",
    auth_field: str = "ANTHROPIC_AUTH_TOKEN",
) -> LlmProvider:
    """直插 LlmProvider ORM 行（真实 cipher 加密），用于预置「老默认」/「新候选」。

    与 test_llm_provider.py._seed_provider_row 同范式，保证落盘格式与 service.create 一致。
    """
    cipher = get_cipher()
    ct, key_id = cipher.encrypt(api_key)
    row = LlmProvider(
        id=uuid.uuid4(),
        user_id=user_id,
        name=name,
        agent_kind=agent_kind,
        base_url=base_url,
        encrypted_api_key=ct,
        key_id=key_id,
        model=model,
        auth_field=auth_field,
        is_default=is_default,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


class _RecordingHub:
    """录制型 FakeHub：capture send_session_control 入参，默认全部在线返回 True。

    与 test_provider_switch.py._RecordingHub 同范式（集成测试默认全部在线，
    ``offline_daemon_ids`` 仅在需要模拟离线场景时传入）。
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
    """monkeypatch get_daemon_ws_hub 返回录制型 hub，避免真连 daemon WS。"""
    from app.modules.daemon import ws_hub as ws_hub_mod

    hub = _RecordingHub(offline_daemon_ids=offline_daemon_ids)
    monkeypatch.setattr(ws_hub_mod, "get_daemon_ws_hub", lambda: hub)
    return hub


def _patch_probe(
    monkeypatch: pytest.MonkeyPatch,
    *,
    ok: bool,
    error: str | None = None,
) -> None:
    """monkeypatch probe_provider 返回固定结果（spike-01：探测形态未实测，网络全 mock）。

    patch 目标是源模块 ``app.modules.llm_provider.probe.probe_provider``（service.set_default
    内 lazy ``from ...probe import probe_provider`` 按属性查找源模块当前绑定 → patch 生效，
    与 test_llm_provider.mock_probe_notify 同范式）。
    """

    async def _fake_probe(*_args: object, **_kwargs: object) -> ProviderProbeResult:
        return ProviderProbeResult(ok=ok, error=error)

    monkeypatch.setattr("app.modules.llm_provider.probe.probe_provider", _fake_probe)


# ── 场景一：启动切换生效 ─────────────────────────────────────────────────────


class TestProviderSwitchStartSwitchesActiveSession:
    """set_default(新供应商) → probe 通过 → 推 PROVIDER_CONFIG_CHANGED(新 config)。

    守护 design §5 Wave1 step 1-4 全链路联通：
      service.set_default → probe → _clear_sibling_defaults + is_default=True →
      resolve_default_provider_config（D-006 单一真相源，解密 api_key）→
      notify_provider_switch → ws_hub.send_session_control。
    """

    @pytest.mark.asyncio
    async def test_start_pushes_new_config_and_clears_old_default(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        user_id = await _create_user(db_session, label="start")
        rt = await _create_runtime(db_session, user_id, name_suffix="start")
        sess_id = await _create_interactive_session(
            db_session, runtime_id=rt.id, user_id=user_id
        )

        # 老默认（将被互斥清成 False）+ 新候选（将被置成 True）
        old_row = await _seed_provider_row(
            db_session,
            user_id,
            name="old-default",
            base_url="https://old.example.com",
            api_key="sk-old-secret-1234",
            is_default=True,
        )
        new_row = await _seed_provider_row(
            db_session,
            user_id,
            name="new-candidate",
            base_url="https://new.example.com",
            api_key="sk-new-secret-5678",
            is_default=False,
        )

        _patch_probe(monkeypatch, ok=True)
        hub = _patch_hub(monkeypatch)

        svc = LlmProviderService(db_session)
        result = await svc.set_default(new_row.id, user_id)

        # 蓝图 acceptance：set_default 成功变更 + 推送计数 = active session 数
        assert result.switched is True
        assert result.affected_sessions == 1
        assert result.error is None

        # R-05 互斥：老默认被清，新候选置位
        await db_session.refresh(old_row)
        await db_session.refresh(new_row)
        assert old_row.is_default is False
        assert new_row.is_default is True

        # 推送契约：msg_type + payload 内容
        assert len(hub.calls) == 1
        _daemon_id, msg_type, payload = hub.calls[0]
        assert msg_type == DAEMON_MSG_PROVIDER_CONFIG_CHANGED
        assert payload["session_id"] == str(sess_id)

        # provider_config 含新供应商字段（D-006 单一真相源：base_url + 解密后明文 api_key）
        config = payload["provider_config"]
        assert config is not None
        assert config["base_url"] == "https://new.example.com"
        assert config["api_key"] == "sk-new-secret-5678"  # 解密后明文
        assert config["agent_kind"] == "claude"
        assert config["auth_field"] == "ANTHROPIC_AUTH_TOKEN"
        assert config["model"] == "claude-sonnet-4"


# ── 场景二：停止回退本机 ──────────────────────────────────────────────────────


class TestProviderSwitchStopFallsBackToLocal:
    """unset_default → 推 provider_config=None → daemon 据此回退本机 claude 凭证。

    守护 D-004@v1：unset_default 不探测、不清兄弟，仅置本行 False + 推 null config
    让 daemon reloadWithProvider(null) 回退宿主机本机 ~/.claude 路径。
    """

    @pytest.mark.asyncio
    async def test_stop_pushes_null_config(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        user_id = await _create_user(db_session, label="stop")
        rt = await _create_runtime(db_session, user_id, name_suffix="stop")
        sess_id = await _create_interactive_session(
            db_session, runtime_id=rt.id, user_id=user_id
        )

        row = await _seed_provider_row(
            db_session,
            user_id,
            name="will-stop",
            base_url="https://running.example.com",
            api_key="sk-running-secret-1234",
            is_default=True,
        )

        # unset 不调 probe（停止无新凭证可验），无需 _patch_probe
        hub = _patch_hub(monkeypatch)

        svc = LlmProviderService(db_session)
        result = await svc.unset_default(row.id, user_id)

        # 蓝图 acceptance：switched 恒 True（unset 不探测、不会失败）
        assert result.switched is True
        assert result.affected_sessions == 1
        assert result.error is None

        await db_session.refresh(row)
        assert row.is_default is False

        # 推送契约：provider_config=None（daemon 回退本机）
        assert len(hub.calls) == 1
        _daemon_id, msg_type, payload = hub.calls[0]
        assert msg_type == DAEMON_MSG_PROVIDER_CONFIG_CHANGED
        assert payload["session_id"] == str(sess_id)
        assert payload["provider_config"] is None


# ── 场景三：生成中等待 turn 边界（后端侧验证） ────────────────────────────────


class TestProviderSwitchGeneratingSessionsPendingSwitch:
    """set_default 时 active + reconnecting session 均被推（affected_sessions 计数含生成中）。

    蓝图 task-11 场景三说明：daemon 侧 turn 边界（pendingSwitch → _onResult reload）已由
    task-07 单测覆盖；本场景后端侧只验：
      1. active + reconnecting session 均命中 notify_provider_switch 查询；
      2. 每个 session 各推一条（payload.session_id 不同）；
      3. affected_sessions = 在线投递计数 = 2。

    「生成中」语义在 daemon 侧：daemon 收到 PROVIDER_CONFIG_CHANGED 后会 markPendingSwitch
    等当前 turn 收尾再 reload；后端不感知 turn 状态，统一以 session.status='active'
    表示「与 daemon 有握手、正在使用」。
    """

    @pytest.mark.asyncio
    async def test_multiple_active_sessions_all_pushed(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        user_id = await _create_user(db_session, label="gen")
        rt = await _create_runtime(db_session, user_id, name_suffix="gen")

        # 2 个 session 挂同一 runtime（同 daemon_id，按 (daemon_id, session_id) 各推一次）
        sess1 = await _create_interactive_session(
            db_session, runtime_id=rt.id, user_id=user_id, session_status="active"
        )
        # reconnecting 与 active 同等处理（daemon 仍持有 SessionState）
        sess2 = await _create_interactive_session(
            db_session, runtime_id=rt.id, user_id=user_id, session_status="reconnecting"
        )

        new_row = await _seed_provider_row(
            db_session,
            user_id,
            name="new-gen",
            base_url="https://gen.example.com",
            api_key="sk-gen-secret-9012",
            is_default=False,
        )

        _patch_probe(monkeypatch, ok=True)
        hub = _patch_hub(monkeypatch)

        svc = LlmProviderService(db_session)
        result = await svc.set_default(new_row.id, user_id)

        # affected_sessions = 2（两个 session 各推一次，全部在线）
        assert result.switched is True
        assert result.affected_sessions == 2

        # 推送契约：每个 session 各收到一条带自身 session_id 的推送
        assert len(hub.calls) == 2
        pushed_session_ids = {call[2]["session_id"] for call in hub.calls}
        assert pushed_session_ids == {str(sess1), str(sess2)}

        for _did, msg_type, payload in hub.calls:
            assert msg_type == DAEMON_MSG_PROVIDER_CONFIG_CHANGED
            # 新 config 内容一致（同一 daemon_id 的两个 session 共用一份 provider_config）
            config = payload["provider_config"]
            assert config is not None
            assert config["base_url"] == "https://gen.example.com"


# ── 场景四：凭证失败保留原供应商 ──────────────────────────────────────────────


class TestProviderSwitchProbeFailKeepsOriginal:
    """set_default probe 失败 → is_default 不变 + 不推送 + 返回 switched=False+error。

    守护 D-003 回滚契约：probe 失败时 service 不改 is_default、不推送，原供应商继续
    服务运行中会话（不破坏 G4 / brownfield 零回归）。事务内仅 SELECT 无 write，
    「回滚」即「不写入」。
    """

    @pytest.mark.asyncio
    async def test_probe_fail_no_switch_no_push(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        user_id = await _create_user(db_session, label="fail")
        rt = await _create_runtime(db_session, user_id, name_suffix="fail")
        # 运行中 active session（应完全不受影响）
        await _create_interactive_session(db_session, runtime_id=rt.id, user_id=user_id)

        # 老默认（保持 True）+ 新候选（probe 会失败，不应被置位）
        old_row = await _seed_provider_row(
            db_session,
            user_id,
            name="old-still-default",
            base_url="https://old.example.com",
            api_key="sk-old-secret-1234",
            is_default=True,
        )
        new_row = await _seed_provider_row(
            db_session,
            user_id,
            name="new-bad-credentials",
            base_url="https://new.example.com",
            api_key="sk-bad-credentials",
            is_default=False,
        )

        _patch_probe(monkeypatch, ok=False, error="鉴权失败（HTTP 401）")
        hub = _patch_hub(monkeypatch)

        svc = LlmProviderService(db_session)
        result = await svc.set_default(new_row.id, user_id)

        # 蓝图 acceptance：switched=False + affected_sessions=0 + error 含探测失败原因
        assert result.switched is False
        assert result.affected_sessions == 0
        assert result.error is not None
        assert "401" in result.error or "鉴权" in result.error

        # D-003：原供应商继续服务运行中会话，is_default 完全不变
        await db_session.refresh(old_row)
        await db_session.refresh(new_row)
        assert old_row.is_default is True
        assert new_row.is_default is False

        # 蓝图 acceptance：未推送任何 PROVIDER_CONFIG_CHANGED 消息
        assert hub.calls == []
