"""task-02（2026-08-29-daemon-platform-resilience）/ D-007@v1：
WS 断开 10s 延迟降级 + placement 派发实连接检查。

锁定验收四场景：
  1. 断开后延迟窗口内重连 → 延迟任务执行时复查 is_connected 取消，instance 与
     runtimes 不被标 offline（防网络抖动误离线）。
  2. 断开超延迟窗口仍未连 → 默认回调把 instance + runtimes 的 DB 状态标 offline
     （disabled runtime 保留管理员意图）。
  3. 降级后心跳到达 → heartbeat_daemon 把 instance + runtimes 拉回 online。
  4. placement 候选行联查 ws_hub.is_connected(daemon_instance_id)——DB 在线但
     WS 不实连的行剔除（fake ws_hub 状态注入 + 真实 hub 两形态）。

延迟窗口常量可注入（WS_DISCONNECT_OFFLINE_DELAY_SECONDS 运行时动态读取，
对齐 RPC_DEFAULT_TIMEOUT 惯例），测试缩短到毫秒级避免真实 sleep 10s。
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

import app.modules.daemon.ws_hub as ws_hub_module
from app.modules.agent.placement import RunPlacementService
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance, DaemonRuntime
from app.modules.daemon.runtime.service import RuntimeService
from app.modules.daemon.ws_hub import DaemonWsHub

pytestmark = pytest.mark.asyncio

# 测试注入的缩短延迟窗口（生产值 10s，见 ws_hub.WS_DISCONNECT_OFFLINE_DELAY_SECONDS）。
DELAY = 0.05


# ── Seed helpers（惯例照 test_register_heartbeat_daemon.py / test_ws_hub.py）──


async def _seed_user(db_session: AsyncSession, *, name: str = "u") -> uuid.UUID:
    user = User(
        id=uuid.uuid4(),
        email=f"{name}-{uuid.uuid4()}@example.com",
        password_hash="x",
        display_name=name,
        status="active",
    )
    db_session.add(user)
    await db_session.commit()
    return user.id


async def _seed_instance(
    db_session: AsyncSession,
    user_id: uuid.UUID,
    *,
    status: str = "online",
) -> DaemonInstance:
    inst = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname="host-" + uuid.uuid4().hex[:6],
        server_url="http://test.local",
        status=status,
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(inst)
    await db_session.commit()
    await db_session.refresh(inst)
    return inst


async def _seed_runtime(
    db_session: AsyncSession,
    instance_id: uuid.UUID,
    user_id: uuid.UUID,
    *,
    provider: str = "claude",
    status: str = "online",
    heartbeat_offset_seconds: int = 0,
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        daemon_instance_id=instance_id,
        user_id=user_id,
        name=f"{provider}-daemon",
        provider=provider,
        status=status,
        # 秒级截断对齐 SQLite 存储精度，避免同秒内两行心跳排序不稳定。
        last_heartbeat_at=datetime.now(UTC).replace(microsecond=0)
        - timedelta(seconds=heartbeat_offset_seconds),
    )
    db_session.add(rt)
    await db_session.commit()
    await db_session.refresh(rt)
    return rt


def _make_mock_ws() -> AsyncMock:
    """照 test_ws_hub.py：记录 send_json 消息的 mock WebSocket。"""
    ws = AsyncMock()
    ws.sent_messages = []

    async def _send_json(message: dict[str, Any]) -> None:
        ws.sent_messages.append(message)

    ws.send_json = AsyncMock(side_effect=_send_json)
    ws.close = AsyncMock()
    return ws


def _fresh_ws_hub(monkeypatch: pytest.MonkeyPatch) -> DaemonWsHub:
    """照 test_session_router.py 的 fresh_ws_hub 惯例：替换进程级 ws_hub 单例。

    placement 的实连接复查经 ``get_daemon_ws_hub()`` 取单例，必须替换模块级
    ``_ws_hub`` 才能被 ``_runtime_row_ws_alive`` 观察到。
    """
    hub = DaemonWsHub()
    monkeypatch.setattr(ws_hub_module, "_ws_hub", hub)
    return hub


async def _get_status(db_session: AsyncSession, model: Any, pk: uuid.UUID) -> str | None:
    """重新读取行 status。

    显式 SELECT（绕开 identity map；``expire_all + get`` 对已过期对象会在同步
    上下文触发 lazy refresh → MissingGreenlet，不可用）。
    """
    row = (await db_session.execute(select(model).where(col(model.id) == pk))).scalars().first()
    return row.status if row is not None else None


# ── 场景 1+2：断开延迟降级（取消判定 = 任务执行时复查实连接）──────────────────


class TestWsDisconnectDelayedOffline:
    async def test_disconnect_beyond_delay_marks_instance_and_runtimes_offline(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """断开超延迟窗口仍未连 → 回调触发，instance+runtimes DB 标 offline。"""
        monkeypatch.setattr(ws_hub_module, "WS_DISCONNECT_OFFLINE_DELAY_SECONDS", DELAY)
        uid = await _seed_user(db_session)
        inst = await _seed_instance(db_session, uid)
        rt = await _seed_runtime(db_session, inst.id, uid)

        calls: list[uuid.UUID] = []

        async def spy_callback(daemon_id: uuid.UUID) -> None:
            calls.append(daemon_id)
            await RuntimeService(db_session).mark_instance_offline_delayed(daemon_id)

        hub = DaemonWsHub()
        hub.set_offline_callback(spy_callback)
        await hub.connect(inst.id, _make_mock_ws())
        await hub.disconnect(inst.id)

        # 延迟内不触发
        await asyncio.sleep(DELAY / 2)
        assert calls == []

        await asyncio.sleep(DELAY * 8)
        assert calls == [inst.id]
        assert await _get_status(db_session, DaemonInstance, inst.id) == "offline"
        assert await _get_status(db_session, DaemonRuntime, rt.id) == "offline"

    async def test_disconnect_then_default_callback_writes_db(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """生产默认回调（_default_offline_downgrade，get_daemon_ws_hub 装配）端到端：
        经 get_session_factory 短命 session 写库（conftest 重定向到 in-memory 测试引擎）。"""
        monkeypatch.setattr(ws_hub_module, "WS_DISCONNECT_OFFLINE_DELAY_SECONDS", DELAY)
        uid = await _seed_user(db_session)
        inst = await _seed_instance(db_session, uid)
        rt = await _seed_runtime(db_session, inst.id, uid)

        hub = DaemonWsHub()
        hub.set_offline_callback(ws_hub_module._default_offline_downgrade)
        await hub.connect(inst.id, _make_mock_ws())
        await hub.disconnect(inst.id)
        await asyncio.sleep(DELAY * 8)

        # 断言用回调同源的工厂开新 session：db_session 自身可能持有种子期的读事务
        # 快照（SQLite 事务内看不到回调 session 的后续提交），新 session 必见 committed。
        from app.core.db import get_session_factory

        factory = get_session_factory()
        async with factory() as verify_session:
            inst_row = await verify_session.get(DaemonInstance, inst.id)
            rt_row = await verify_session.get(DaemonRuntime, rt.id)
            assert inst_row is not None and inst_row.status == "offline"
            assert rt_row is not None and rt_row.status == "offline"

    async def test_reconnect_within_delay_cancels_downgrade(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """断开后延迟窗口内重连 → 任务执行时复查 is_connected 取消，不降级。"""
        monkeypatch.setattr(ws_hub_module, "WS_DISCONNECT_OFFLINE_DELAY_SECONDS", DELAY)
        uid = await _seed_user(db_session)
        inst = await _seed_instance(db_session, uid)
        rt = await _seed_runtime(db_session, inst.id, uid)

        calls: list[uuid.UUID] = []

        async def spy_callback(daemon_id: uuid.UUID) -> None:
            calls.append(daemon_id)

        hub = DaemonWsHub()
        hub.set_offline_callback(spy_callback)
        await hub.connect(inst.id, _make_mock_ws())
        await hub.disconnect(inst.id)
        # 窗口内同 daemon 重连（新 ws 注册回 registry）
        await asyncio.sleep(DELAY / 2)
        await hub.connect(inst.id, _make_mock_ws())

        await asyncio.sleep(DELAY * 8)
        assert calls == []
        assert await _get_status(db_session, DaemonInstance, inst.id) == "online"
        assert await _get_status(db_session, DaemonRuntime, rt.id) == "online"

    async def test_no_callback_configured_is_noop(self, monkeypatch: pytest.MonkeyPatch) -> None:
        """未装配回调（直接实例化 DaemonWsHub 的旧路径）→ 断开不挂任务零回归。"""
        monkeypatch.setattr(ws_hub_module, "WS_DISCONNECT_OFFLINE_DELAY_SECONDS", DELAY)
        hub = DaemonWsHub()
        did = uuid.uuid4()
        await hub.connect(did, _make_mock_ws())
        await hub.disconnect(did)
        assert hub._offline_tasks == {}
        assert hub.is_connected(did) is False

    async def test_disabled_runtime_preserved_on_downgrade(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """降级联动跳过 disabled runtime（管理员禁用意图不被覆盖，同 stale 清理语义）。"""
        monkeypatch.setattr(ws_hub_module, "WS_DISCONNECT_OFFLINE_DELAY_SECONDS", DELAY)
        uid = await _seed_user(db_session)
        inst = await _seed_instance(db_session, uid)
        rt = await _seed_runtime(db_session, inst.id, uid, status="disabled")

        hub = DaemonWsHub()
        await hub.connect(inst.id, _make_mock_ws())
        await hub.disconnect(inst.id)

        # 直接调用服务层方法验证语义（时序路径已由前两用例覆盖）
        assert await RuntimeService(db_session).mark_instance_offline_delayed(inst.id) == 1
        assert await _get_status(db_session, DaemonRuntime, rt.id) == "disabled"

    async def test_mark_unknown_or_not_online_instance_returns_zero(
        self, db_session: AsyncSession
    ) -> None:
        """实体不存在 / 非 online → 幂等返回 0 不写库。"""
        svc = RuntimeService(db_session)
        assert await svc.mark_instance_offline_delayed(uuid.uuid4()) == 0

        uid = await _seed_user(db_session)
        inst = await _seed_instance(db_session, uid, status="disabled")
        assert await svc.mark_instance_offline_delayed(inst.id) == 0
        assert await _get_status(db_session, DaemonInstance, inst.id) == "disabled"


# ── 场景 3：心跳恢复 online ───────────────────────────────────────────────────


class TestHeartbeatRestoresOnline:
    async def test_heartbeat_overwrites_offline_mark(self, db_session: AsyncSession) -> None:
        """降级 offline 后心跳到达 → instance + runtimes 拉回 online（覆盖离线标记）。"""
        uid = await _seed_user(db_session)
        inst = await _seed_instance(db_session, uid)
        rt = await _seed_runtime(db_session, inst.id, uid)

        # 先降级
        assert await RuntimeService(db_session).mark_instance_offline_delayed(inst.id) == 1
        assert await _get_status(db_session, DaemonInstance, inst.id) == "offline"
        assert await _get_status(db_session, DaemonRuntime, rt.id) == "offline"

        # 心跳到达（daemon 重连后立即拍心跳，providers 上报 online）
        await RuntimeService(db_session).heartbeat_daemon(
            inst.id,
            providers=[{"provider": "claude", "status": "online"}],
        )
        assert await _get_status(db_session, DaemonInstance, inst.id) == "online"
        assert await _get_status(db_session, DaemonRuntime, rt.id) == "online"


# ── 场景 4：placement 候选实连接过滤 ─────────────────────────────────────────


class _FakeHub:
    """fake ws_hub 状态注入（task 要求的 mock 形态）：仅 is_connected。"""

    def __init__(self, connected: set[uuid.UUID]) -> None:
        self._connected = connected

    def is_connected(self, daemon_id: uuid.UUID) -> bool:
        return daemon_id in self._connected


class TestPlacementLivenessFilter:
    async def test_query_online_skips_ws_dead_candidate(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """DB 均在线时按心跳序取候选，WS 不实连的行剔除、命中下一实连行
        （死行心跳更新也只跳过不选中——假在线不再派发）。"""
        uid = await _seed_user(db_session)
        dead_inst = await _seed_instance(db_session, uid)
        live_inst = await _seed_instance(db_session, uid)
        dead_rt = await _seed_runtime(db_session, dead_inst.id, uid, heartbeat_offset_seconds=0)
        live_rt = await _seed_runtime(db_session, live_inst.id, uid, heartbeat_offset_seconds=30)

        hub = _fresh_ws_hub(monkeypatch)
        await hub.connect(live_inst.id, _make_mock_ws())

        svc = RunPlacementService(db_session)
        row = await svc._get_online_runtime(uid, provider=None)

        assert row is not None
        # raw SQL 的 UUID 列以 hex32 字符串返回，归一后比较。
        assert uuid.UUID(str(row["id"])) == live_rt.id
        assert uuid.UUID(str(row["id"])) != dead_rt.id

    async def test_query_online_all_dead_returns_none(self, db_session: AsyncSession) -> None:
        """全部候选不实连 → None（上层 NoOnlineDaemonError，宁可不派发）。"""
        uid = await _seed_user(db_session)
        inst = await _seed_instance(db_session, uid)
        await _seed_runtime(db_session, inst.id, uid)

        # 无任何 WS 连接
        svc = RunPlacementService(db_session)
        assert await svc._get_online_runtime(uid, provider=None) is None

    async def test_query_online_legacy_null_instance_row_tolerated(
        self, db_session: AsyncSession
    ) -> None:
        """daemon_instance_id IS NULL 的迁移窗口旧行无 WS 键可查 → 容忍放行
        （锁定兼容决策：不因缺键拒绝派发）。"""
        uid = await _seed_user(db_session)
        legacy_rt = DaemonRuntime(
            id=uuid.uuid4(),
            daemon_instance_id=None,
            user_id=uid,
            name="legacy-daemon",
            provider="claude",
            status="online",
            last_heartbeat_at=datetime.now(UTC),
        )
        db_session.add(legacy_rt)
        await db_session.commit()

        svc = RunPlacementService(db_session)
        row = await svc._get_online_runtime(uid, provider=None)
        assert row is not None
        assert uuid.UUID(str(row["id"])) == legacy_rt.id

    async def test_pinned_query_returns_none_when_ws_dead(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """钉定复查：DB online 但 WS 不实连 → None（fake ws_hub 状态注入）。
        同一 daemon 的实连行不受影响。"""
        uid = await _seed_user(db_session)
        inst = await _seed_instance(db_session, uid)
        rt = await _seed_runtime(db_session, inst.id, uid)

        monkeypatch.setattr(
            "app.modules.daemon.ws_hub.get_daemon_ws_hub",
            lambda: _FakeHub(set()),  # 状态注入：无人实连
        )
        svc = RunPlacementService(db_session)
        assert await svc._query_pinned_online_runtime(uid, rt.id) is None

        # 注入实连状态后同一行放行
        monkeypatch.setattr(
            "app.modules.daemon.ws_hub.get_daemon_ws_hub",
            lambda: _FakeHub({inst.id}),
        )
        row = await svc._query_pinned_online_runtime(uid, rt.id)
        assert row is not None
        assert uuid.UUID(str(row["id"])) == rt.id

    async def test_pinned_query_returns_none_before_grant_branch_when_ws_dead(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """owner 命中但不实连 → 直接 None，不落入「钉定他人 runtime」的授权分支
        （防绕过属主语义借用兜底）。"""
        uid = await _seed_user(db_session)
        inst = await _seed_instance(db_session, uid)
        rt = await _seed_runtime(db_session, inst.id, uid)

        # 替换单例且无任何 WS 连接
        _fresh_ws_hub(monkeypatch)
        svc = RunPlacementService(db_session)
        assert await svc._query_pinned_online_runtime(uid, rt.id) is None
