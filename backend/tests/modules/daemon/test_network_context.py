"""Tests for 会话网络环境感知（2026-10-23-session-network-context）.

FR-03 落库语义（task-06）：daemon_instances.network_info 的 observed_ip 每跳
直写 / network_interfaces 出现即整写、缺席保留（老 daemon 兼容，D-008）。
判定引擎（FR-04/FR-05/FR-06，task-07）见下方 TestNetworkEnvRender 等节。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import password_hasher
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance
from app.modules.daemon.service import DaemonService


async def _seed_user(session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"u-{uuid.uuid4().hex[:6]}@example.com",
        password_hash=password_hasher.hash("x"),
        status="active",
        is_platform_admin=True,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


def _nics(*ips: str) -> list[dict]:
    return [
        {"name": f"eth{i}", "ip": ip, "cidr": f"{ip}/24", "family": "IPv4"}
        for i, ip in enumerate(ips)
    ]


# ── FR-03：register 观测 IP 首写 ─────────────────────────────────────────────


@pytest.mark.asyncio
async def test_register_records_observed_ip(db_session: AsyncSession) -> None:
    """register 携观测 IP → 新实例 network_info.observed_ip 首写，interfaces 无。"""
    from app.modules.daemon.runtime.service import RuntimeService

    user = await _seed_user(db_session)
    daemon_local_id = uuid.uuid4()
    svc = DaemonService(db_session)
    await svc.register_daemon(
        user.id,
        daemon_local_id=daemon_local_id,
        server_url="http://backend",
        hostname="host1",
        providers=[{"provider": "claude"}],
        observed_ip="192.168.1.50",
    )
    inst = await db_session.get(DaemonInstance, daemon_local_id)
    assert inst is not None
    assert inst.network_info == {"observed_ip": "192.168.1.50"}
    # observed_ip 缺省（None）不动 network_info（测试/内部直调零影响）。
    await RuntimeService(db_session).heartbeat_daemon(daemon_local_id, providers=[])
    await db_session.refresh(inst)
    assert inst.network_info == {"observed_ip": "192.168.1.50"}


@pytest.mark.asyncio
async def test_register_preserves_existing_interfaces(db_session: AsyncSession) -> None:
    """再 register 合并写：observed_ip 更新、既有 interfaces 保留（daemon 重启网卡不变）。"""
    from app.modules.daemon.runtime.service import RuntimeService

    user = await _seed_user(db_session)
    daemon_local_id = uuid.uuid4()
    svc = DaemonService(db_session)
    await svc.register_daemon(
        user.id,
        daemon_local_id=daemon_local_id,
        server_url="http://backend",
        hostname="host1",
        providers=[{"provider": "claude"}],
        observed_ip="10.0.0.9",
    )
    await RuntimeService(db_session).heartbeat_daemon(
        daemon_local_id,
        providers=[],
        network_interfaces=_nics("10.0.0.9", "172.22.1.2"),
        observed_ip="10.0.0.9",
    )
    # daemon 重启 → 再 register（新观测 IP），interfaces 应保留。
    await svc.register_daemon(
        user.id,
        daemon_local_id=daemon_local_id,
        server_url="http://backend",
        hostname="host1",
        providers=[{"provider": "claude"}],
        observed_ip="10.0.0.10",
    )
    inst = await db_session.get(DaemonInstance, daemon_local_id)
    assert inst is not None
    assert inst.network_info is not None
    assert inst.network_info["observed_ip"] == "10.0.0.10"
    assert [e["ip"] for e in inst.network_info["interfaces"]] == ["10.0.0.9", "172.22.1.2"]


# ── FR-03：heartbeat 落库语义（observed_ip 直写 / interfaces 整写·缺席保留）──


@pytest.mark.asyncio
async def test_heartbeat_writes_observed_ip_and_interfaces(db_session: AsyncSession) -> None:
    """新 daemon 心跳：observed_ip 直写 + interfaces 整包直写。"""
    from app.modules.daemon.runtime.service import RuntimeService

    user = await _seed_user(db_session)
    daemon_local_id = uuid.uuid4()
    svc = DaemonService(db_session)
    await svc.register_daemon(
        user.id,
        daemon_local_id=daemon_local_id,
        server_url="http://backend",
        hostname="host1",
        providers=[{"provider": "claude"}],
    )
    await RuntimeService(db_session).heartbeat_daemon(
        daemon_local_id,
        providers=[],
        observed_ip="192.168.1.60",
        network_interfaces=_nics("192.168.1.60"),
    )
    inst = await db_session.get(DaemonInstance, daemon_local_id)
    assert inst is not None
    assert inst.network_info == {
        "observed_ip": "192.168.1.60",
        "interfaces": _nics("192.168.1.60"),
    }


@pytest.mark.asyncio
async def test_heartbeat_old_daemon_keeps_old_values(db_session: AsyncSession) -> None:
    """FR-02 老 daemon 兼容场景：心跳不带 network_interfaces（None）→ 旧值保留不清。"""
    from app.modules.daemon.runtime.service import RuntimeService

    user = await _seed_user(db_session)
    daemon_local_id = uuid.uuid4()
    svc = DaemonService(db_session)
    await svc.register_daemon(
        user.id,
        daemon_local_id=daemon_local_id,
        server_url="http://backend",
        hostname="host1",
        providers=[{"provider": "claude"}],
        observed_ip="192.168.1.60",
    )
    await RuntimeService(db_session).heartbeat_daemon(
        daemon_local_id,
        providers=[],
        network_interfaces=_nics("192.168.1.60", "172.22.1.2"),
    )
    # 老 daemon：两参均缺席（None=保留语义）。
    await RuntimeService(db_session).heartbeat_daemon(
        daemon_local_id,
        providers=[],
        observed_ip="192.168.1.61",  # 观测 IP 仍每跳刷新（平台侧观测，与 daemon 版本无关）
        network_interfaces=None,
    )
    inst = await db_session.get(DaemonInstance, daemon_local_id)
    assert inst is not None
    assert inst.network_info is not None
    assert inst.network_info["observed_ip"] == "192.168.1.61"
    assert [e["ip"] for e in inst.network_info["interfaces"]] == ["192.168.1.60", "172.22.1.2"]


@pytest.mark.asyncio
async def test_heartbeat_interfaces_replaces_wholesale(db_session: AsyncSession) -> None:
    """interfaces 出现即整写：旧 2 条 → 新 1 条，结果恰为新清单（不合并）。"""
    from app.modules.daemon.runtime.service import RuntimeService

    user = await _seed_user(db_session)
    daemon_local_id = uuid.uuid4()
    svc = DaemonService(db_session)
    await svc.register_daemon(
        user.id,
        daemon_local_id=daemon_local_id,
        server_url="http://backend",
        hostname="host1",
        providers=[{"provider": "claude"}],
    )
    rt = RuntimeService(db_session)
    await rt.heartbeat_daemon(
        daemon_local_id,
        providers=[],
        network_interfaces=_nics("192.168.1.60", "172.22.1.2"),
        observed_ip="192.168.1.60",
    )
    # 空列表=机器确无可用网卡，整写清空（非 None 语义）。
    await rt.heartbeat_daemon(
        daemon_local_id,
        providers=[],
        network_interfaces=[],
        observed_ip="192.168.1.60",
    )
    inst = await db_session.get(DaemonInstance, daemon_local_id)
    assert inst is not None
    assert inst.network_info == {"observed_ip": "192.168.1.60", "interfaces": []}
