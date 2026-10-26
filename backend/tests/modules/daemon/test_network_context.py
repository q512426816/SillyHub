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
from app.modules.daemon.session.network_context import (
    MachineNetworkInfo,
    network_context_for_turn,
    render_network_env,
)


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


# ── FR-05/FR-06：判定引擎纯函数（render_network_env）─────────────────────────


class _FakeRedis:
    """快照去重测试假件：内存 dict + 可注入故障。"""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.fail = False

    async def get(self, key: str) -> str | None:
        if self.fail:
            raise ConnectionError("fake redis down")
        return self.store.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> bool:
        if self.fail:
            raise ConnectionError("fake redis down")
        self.store[key] = value
        return True


def _machine(
    name: str = "pc1",
    observed: str | None = "192.168.1.10",
    ips: tuple[str, ...] = ("192.168.1.10",),
    online: bool = True,
) -> "MachineNetworkInfo":
    from app.modules.daemon.session.network_context import MachineNetworkInfo

    return MachineNetworkInfo(
        daemon_id=f"d-{name}",
        name=name,
        online=online,
        observed_ip=observed,
        interfaces=[
            {"name": f"eth{i}", "ip": ip, "cidr": f"{ip}/24", "family": "IPv4"}
            for i, ip in enumerate(ips)
        ],
    )


def _render(user_ip: str | None, machines: list, has_xff: bool = True) -> str:

    return render_network_env(user_ip, has_xff, machines)


def test_render_same_subnet_verdict():
    """FR-05 同段：用户 192.168.1.23 vs 机器 192.168.1.10/24 → 同网段大概率可直连。"""
    text = _render("192.168.1.23", [_machine(observed="192.168.1.10")])
    assert "同网段，大概率可直连" in text
    assert "192.168.1.10" in text


def test_render_cross_subnet_verdict():
    """FR-05 跨段：10.0.3.5 → 不同网段无法直连。"""
    text = _render("192.168.1.23", [_machine(name="build", observed="10.0.3.5", ips=("10.0.3.5",))])
    assert "不同网段" in text and "无法直连" in text


def test_render_degradation_user_ip_missing():
    """FR-05 降级①：user_ip 缺失 → 无法判定 + 禁止猜测指引。"""
    text = _render(None, [_machine()])
    assert "无法判定" in text and "禁止猜测" in text


def test_render_degradation_ipv6_user():
    """FR-05 降级④：纯 IPv6 用户 → 未参与判定。"""
    text = _render("fd00::1", [_machine()])
    assert "IPv6" in text and "未参与" in text


def test_render_degradation_docker_bridge_no_xff():
    """FR-05 降级②：无 XFF 且 172.16/12 网桥特征 → 无法判定真实网段。"""
    text = _render("172.18.0.5", [_machine()], has_xff=False)
    assert "容器网桥" in text and "无法判定真实用户网段" in text
    # 有 XFF（经 nginx 转发）时同一 IP 正常判定（最右段是可信来源）。
    text2 = _render(
        "172.18.0.5", [_machine(observed="172.18.0.9", ips=("172.18.0.9",))], has_xff=True
    )
    assert "同网段，大概率可直连" in text2


def test_render_degradation_all_offline():
    """FR-05 降级③：全部机器离线 → 无在线机器。"""
    text = _render("192.168.1.23", [_machine(online=False)])
    assert "无在线机器" in text or "均离线" in text


def test_render_same_subnet_uses_nic_cidr_not_fixed_24():
    """P1-3 回归锁：/16 局域网（同段但不同 /24）必须判同段。

    旧实现固定 /24：10.1.5.7 与 10.1.9.200 会被误判「不同网段、无法直连」；
    按网卡 cidr（/16）精确判定后应为同段。
    """
    from app.modules.daemon.session.network_context import MachineNetworkInfo

    machine = MachineNetworkInfo(
        daemon_id="d-big",
        name="big-lan",
        online=True,
        observed_ip="10.1.9.200",
        interfaces=[
            {"name": "eth0", "ip": "10.1.9.200", "cidr": "10.1.9.200/16", "family": "IPv4"}
        ],
    )
    text = _render("10.1.5.7", [machine])
    assert "同网段，大概率可直连" in text
    assert "低置信" not in text  # 有 cidr 走精确判定，不应打低置信标注


def test_render_no_network_data_wording():
    """P2-2 回归锁：network_info 为 NULL（无观测 IP）→ 明确「无网络数据」文案，
    不得输出任何可达性推断。"""
    text = _render("192.168.1.23", [_machine(observed=None, ips=())])
    assert "无网络数据" in text
    assert "大概率可直连" not in text  # 无数据不得输出可达性推断（指引行不算）


def test_render_nat_form_no_unavailable_claim():
    """2026-10-26-turn-phase-prod-fix FR-04 回归锁（生产实证形态）：
    observed=公网出口 IP、网卡全内网（NAT）→ 低置信标注与地址候选并存，
    禁止出现「拼地址信息不可用」（与地址建议自相矛盾）。"""
    from app.modules.daemon.session.network_context import MachineNetworkInfo

    machine = MachineNetworkInfo(
        daemon_id="d-nat",
        name="平台源码本地服务器",
        online=True,
        observed_ip="112.2.37.34",  # 公网出口（NAT 后）
        interfaces=[
            {"name": "eth0", "ip": "10.10.128.145", "cidr": "10.10.128.145/16", "family": "IPv4"},
            {
                "name": "vEthernet",
                "ip": "172.23.144.1",
                "cidr": "172.23.144.1/20",
                "family": "IPv4",
            },
        ],
    )
    text = _render("112.2.37.34", [machine])  # 用户同 NAT 出口
    assert "低置信" in text  # 观测 IP 不在任何网卡段 → 近似判定保留低置信
    assert "疑似经路由器 NAT 出口" in text
    assert "访问地址建议用 10.10.128.145" in text  # 候选照常给
    assert "拼地址信息不可用" not in text  # FR-04：与建议并存时禁止断言不可用


def test_render_no_nics_keeps_unavailable_claim():
    """FR-04 反向锁：interfaces 为空（真无网卡数据）→ 「拼地址信息不可用」保留。"""
    text = _render("192.168.1.23", [_machine(observed="192.168.1.10", ips=())])
    assert "拼地址信息不可用" in text


def test_render_low_confidence_without_interfaces():
    """FR-05：机器无网卡数据 → /24 与 /16 双档近似 + 低置信标注。"""
    text = _render("192.168.0.7", [_machine(observed="192.168.1.10", ips=())])
    # /24 不同段、/16 同段 → 近似判同段且带低置信标注。
    assert "低置信" in text
    text2 = _render("10.99.0.7", [_machine(observed="192.168.1.10", ips=())])
    assert "低置信" in text2  # 双档都不同段也走低置信观测 IP 缺网卡数据路径


def test_render_address_prefers_same_subnet_nic():
    """FR-05 地址选择：多网卡时优先与观测 IP 同段的那个（规避虚拟网卡，R-02）。"""
    text = _render(
        "192.168.1.23",
        [_machine(name="win", observed="192.168.1.10", ips=("172.22.1.2", "192.168.1.10"))],
    )
    assert "建议用 192.168.1.10" in text


def test_render_machine_truncation_over_ten():
    """FR-04：机器清单超 10 台截断为「等 N 台」。"""
    machines = [_machine(name=f"m{i:02d}", observed=f"192.168.1.{i:02d}") for i in range(1, 13)]
    text = _render("192.168.1.23", machines)
    assert "等 2 台" in text
    assert "m12" not in text


def test_render_guidance_wording():
    """FR-06 文案断言：指引措辞含端口口径/禁止猜公网/事实陈述边界。"""
    text = _render("192.168.1.23", [_machine()])
    assert "端口按服务实际监听" in text
    assert "禁止猜测公网地址" in text
    assert "事实陈述" in text


# ── FR-01/FR-05：快照去重（network_context_for_turn，D-006@v1/D-013@v1）──────


@pytest.mark.asyncio
async def test_snapshot_same_text_skips_reinject():
    """同快照 → None 不重注。"""

    redis = _FakeRedis()
    sid = uuid.uuid4()
    kwargs = dict(session_id=sid, user_ip="192.168.1.23", has_xff=True, machines=[_machine()])
    first = await network_context_for_turn(**kwargs, first_turn=True, redis=redis)
    assert first is not None
    again = await network_context_for_turn(**kwargs, redis=redis)
    assert again is None  # 同快照跳过。


@pytest.mark.asyncio
async def test_snapshot_change_within_60s_defers_and_catches_up():
    """D-013：变化但 <60s → 不注入不更新；下一轮（模拟到点）仍不同 → 补注。"""

    redis = _FakeRedis()
    sid = uuid.uuid4()
    first = await network_context_for_turn(
        session_id=sid,
        user_ip="192.168.1.23",
        has_xff=True,
        machines=[_machine()],
        first_turn=True,
        redis=redis,
    )
    assert first is not None
    # 用户切网（IP 变化）但仍在 60s 窗口内 → None 且快照不更新。
    deferred = await network_context_for_turn(
        session_id=sid, user_ip="10.0.0.8", has_xff=True, machines=[_machine()], redis=redis
    )
    assert deferred is None
    # 模拟到点：把快照时间戳拨回 61s 前。
    import json as _json

    state = _json.loads(redis.store[f"session:netenv:{sid}"])
    state["ts"] -= 61.0
    redis.store[f"session:netenv:{sid}"] = _json.dumps(state)
    caught_up = await network_context_for_turn(
        session_id=sid, user_ip="10.0.0.8", has_xff=True, machines=[_machine()], redis=redis
    )
    assert caught_up is not None and "10.0.0.8" in caught_up


# ── FR-04：机器清单装配（collect_session_machines）─────────────────────────


@pytest.mark.asyncio
async def test_collect_session_machines_projects_runtime_owner(
    db_session: AsyncSession,
) -> None:
    """会话 runtime 所属机器排首位，网络投影（名/在线/观测IP/网卡）正确。

    绑定与共享分支复用既有查询函数（grants/queries.list_machines_shared_to_me
    与 member_runtimes，各自测试已覆盖可见性口径）；本用例锁装配层：runtime →
    daemon_instance → MachineNetworkInfo 投影。
    """
    from app.modules.daemon.model import DaemonRuntime
    from app.modules.daemon.session.network_context import collect_session_machines

    user = await _seed_user(db_session)
    daemon_id = uuid.uuid4()
    db_session.add(
        DaemonInstance(
            id=daemon_id,
            user_id=user.id,
            hostname="build-host",
            display_alias="构建机",
            server_url="http://backend",
            status="online",
            network_info={"observed_ip": "192.168.1.10", "interfaces": _nics("192.168.1.10")},
        )
    )
    runtime_id = uuid.uuid4()
    db_session.add(
        DaemonRuntime(
            id=runtime_id,
            daemon_instance_id=daemon_id,
            user_id=user.id,
            provider="claude",
            status="online",
        )
    )
    await db_session.commit()

    machines = await collect_session_machines(
        db_session, user_id=user.id, runtime_id=runtime_id, workspace_id=None
    )
    assert len(machines) == 1
    m = machines[0]
    assert m.daemon_id == str(daemon_id)
    assert m.name == "构建机"  # display_alias 优先于 hostname（口径同 grants/queries）
    assert m.online is True
    assert m.observed_ip == "192.168.1.10"
    assert [e["ip"] for e in m.interfaces] == ["192.168.1.10"]


@pytest.mark.asyncio
async def test_collect_session_machines_empty_when_no_binding(
    db_session: AsyncSession,
) -> None:
    """无 runtime 绑定且无工作区绑定 → 空清单（渲染层降级为无在线机器）。"""
    from app.modules.daemon.session.network_context import collect_session_machines

    user = await _seed_user(db_session)
    assert (
        await collect_session_machines(
            db_session, user_id=user.id, runtime_id=None, workspace_id=None
        )
        == []
    )


# ── FR-01：注入链路（后续轮 SESSION_INJECT prompt 含网络段）──────────────


def _mock_ws_hub():
    from unittest.mock import AsyncMock, MagicMock

    hub = MagicMock()
    hub.is_connected.return_value = True
    hub.connected_runtime_ids = []
    hub.connected_daemon_ids = []
    hub.send_wakeup = AsyncMock(return_value=True)
    hub.send_session_control = AsyncMock(return_value=True)
    return hub


def _inject_prompt_for_run(hub, run) -> str:
    from app.modules.daemon.protocol import DAEMON_MSG_SESSION_INJECT

    for call in hub.send_session_control.call_args_list:
        args = call.args
        if (
            len(args) >= 3
            and args[1] == DAEMON_MSG_SESSION_INJECT
            and args[2].get("run_id") == str(run.id)
        ):
            return args[2]["prompt"]
    raise AssertionError(f"no SESSION_INJECT payload for run {run.id}")


@pytest.mark.asyncio
async def test_later_turn_prompt_contains_network_env(db_session: AsyncSession) -> None:
    """P1-1 回归锁：**后续轮**（非首轮）注入链也必须带【网络环境】段。

    首轮走 create 路径、后续轮走 inject→_dispatch_inject_turn 路径；评审发现
    后者曾漏传 network_context，只测首轮会漏掉该缺陷。
    """
    from datetime import UTC, datetime
    from unittest.mock import patch

    from app.modules.daemon.model import DaemonRuntime
    from app.modules.daemon.session.network_context import NetworkContextBlock

    user = await _seed_user(db_session)
    # 与 test_inject_first_turn_briefing 先例同形：runtime 不绑 daemon_instance
    # （避免 placement 的 ws-connected 候选校验影响 create）。
    db_session.add(
        DaemonRuntime(
            id=uuid.uuid4(),
            user_id=user.id,
            name="daemon",
            provider="claude",
            status="online",
            last_heartbeat_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    svc = DaemonService(db_session)
    hub = _mock_ws_hub()
    # patch 必须覆盖 create——create 也经 WS 派发首轮（先例 fixture 全程 patch）。
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        created = await svc.create_session(user.id, provider="claude", prompt="first")
        # 会话首轮完结，才能注入后续轮（单会话单活跃 run 不变式）。
        created.agent_run.status = "completed"
        created.agent_run.finished_at = datetime.now(UTC)
        await db_session.commit()

        result = await svc.inject_session(
            created.agent_session.id,
            user.id,
            prompt="怎么访问项目地址",
            network_context=NetworkContextBlock(user_ip="192.168.1.23", has_xff=True),
        )

    dispatched = _inject_prompt_for_run(hub, result.agent_run)
    assert "【网络环境】" in dispatched
    assert "192.168.1.23" in dispatched
    # 无在线机器（本用例未绑机器）→ 走「在线机器：无」降级，仍须给出指引。
    assert "在线机器：无" in dispatched
    assert dispatched.endswith("怎么访问项目地址")  # 用户原文在段后（展示层干净不变）


# ── FR-04：grants 借用集按会话工作区过滤（P1-2 回归锁）──────────────────────


@pytest.mark.asyncio
async def test_collect_machines_excludes_other_workspace_grants(
    db_session: AsyncSession,
) -> None:
    """P1-2 回归锁：他工作区授予的借用机器不得进入本会话机器清单。

    构造：机器 A 由 workspace_a 共享、机器 B 由 workspace_b 共享，查询
    workspace_a → 只应含 A。此用例锁 collect_session_machines 的
    source_workspace_id 过滤分支（查询函数本身返回全部工作区借用集）。
    """
    from app.modules.daemon.session.network_context import collect_session_machines

    user = await _seed_user(db_session)
    ws_a, ws_b = uuid.uuid4(), uuid.uuid4()
    machines = {}
    for key, _ws in (("a", ws_a), ("b", ws_b)):
        did = uuid.uuid4()
        db_session.add(
            DaemonInstance(
                id=did,
                user_id=user.id,
                hostname=f"m-{key}",
                server_url="http://backend",
                status="online",
                network_info={"observed_ip": f"192.168.1.{(key == 'a' and 10) or 20}"},
            )
        )
        machines[key] = did
    await db_session.commit()

    class _Shared:
        def __init__(self, machine_id, ws):
            self.machine_id = machine_id
            self.source_workspace_id = ws

    async def _fake_shared(_db, *, actor_user_id):
        return [
            _Shared(machines["a"], ws_a),
            _Shared(machines["b"], ws_b),
        ]

    from unittest.mock import patch

    with patch("app.modules.daemon.grants.queries.list_machines_shared_to_me", new=_fake_shared):
        result = await collect_session_machines(
            db_session, user_id=user.id, runtime_id=None, workspace_id=ws_a
        )
    assert [m.daemon_id for m in result] == [str(machines["a"])]
    # 无工作区会话 → 不注入任何借用机器。
    with patch("app.modules.daemon.grants.queries.list_machines_shared_to_me", new=_fake_shared):
        none_ws = await collect_session_machines(
            db_session, user_id=user.id, runtime_id=None, workspace_id=None
        )
    assert none_ws == []


@pytest.mark.asyncio
async def test_snapshot_redis_failure_degrades_to_every_turn():
    """Redis 故障 → 每轮注入（可失去重不失功能）。"""

    redis = _FakeRedis()
    redis.fail = True
    sid = uuid.uuid4()
    kwargs = dict(
        session_id=sid, user_ip="192.168.1.23", has_xff=True, machines=[_machine()], redis=redis
    )
    first = await network_context_for_turn(**kwargs, first_turn=True)
    again = await network_context_for_turn(**kwargs)
    assert first is not None and again is not None  # 故障降级恒注入。
