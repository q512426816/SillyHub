"""会话网络环境判定引擎 + 【网络环境】前导段渲染（2026-10-23-session-network-context）。

三路数据（D-002@v1 双源）：
- 用户请求来源 IP（router 层 app/core/client_ip.py 观测，每轮提问实时取）；
- daemon_instances.network_info.observed_ip（backend 从 daemon 心跳/注册请求观测，
  ground truth，不可伪造）；
- daemon_instances.network_info.interfaces（daemon 心跳自报网卡清单，拼访问地址用）。

render_network_env 为纯函数（判定 + 四态降级 + 文案）；network_context_for_turn
叠加 Redis 快照去重（D-006@v1/D-013@v1：同快照跳过、变化但 <60s 到点补注、
Redis 故障降级每轮注入）。
"""

from __future__ import annotations

import hashlib
import json
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from ipaddress import AddressValueError, IPv4Address, IPv4Network, NetmaskValueError

from pydantic import BaseModel
from redis.asyncio import Redis

from app.core.logging import get_logger

log = get_logger(__name__)

# 快照去重参数（D-006@v1）。
NETENV_SNAPSHOT_TTL_SECONDS = 7 * 24 * 3600
NETENV_MIN_REINJECT_INTERVAL_SECONDS = 60.0
# FR-04：机器清单超 10 台截断（token 预算）。
NETENV_MAX_MACHINES = 10
# FR-05：无网卡数据时的近似掩码档（低置信标注）。
_NETENV_FALLBACK_PREFIXES = (24, 16)


class NetworkContextBlock(BaseModel):
    """随提问轮穿透注入链的数据块（镜像 PageContextCreateBlock 形态——pydantic
    BaseModel 支持入队 model_dump 序列化与派发 **dict 重建，先例同款）。

    queue 入队序列化存储（user_ip/has_xff），派发时携存储值调引擎实时渲染
    （D-012@v1——不重放旧判定文本）。
    """

    user_ip: str | None = None
    has_xff: bool = False


@dataclass(frozen=True)
class MachineNetworkInfo:
    """判定引擎的机器输入（daemon_instances 一行的网络投影）。"""

    daemon_id: str
    name: str  # display_alias or hostname（口径同 grants/queries.py）
    online: bool
    observed_ip: str | None = None
    interfaces: list[dict] = field(default_factory=list)


def _is_docker_bridge(ip: str) -> bool:
    """容器网桥特征：172.16.0.0/12 私网段（compose 默认池）。

    FR-05 降级矩阵：无 XFF（绕过 nginx 直连容器）且来源 IP 落该段 → 用户真实
    网段不可判定。
    """
    try:
        return IPv4Address(ip) in IPv4Network("172.16.0.0/12")
    except (AddressValueError, NetmaskValueError):
        return False


def _same_subnet(a: str, b: str, prefixes: tuple[int, ...] = (24,)) -> bool:
    """IPv4 同网段判定：任一前缀档下 a/b 同网即真（默认 /24）。"""
    try:
        addr_a, addr_b = IPv4Address(a), IPv4Address(b)
    except (AddressValueError, NetmaskValueError):
        return False
    for prefix in prefixes:
        mask = (0xFFFFFFFF << (32 - prefix)) & 0xFFFFFFFF
        if (int(addr_a) & mask) == (int(addr_b) & mask):
            return True
    return False


def _pick_address(machine: MachineNetworkInfo) -> tuple[str | None, str]:
    """拼访问地址的网卡选择（FR-05）：优先与 observed_ip 同网段的 IPv4 网卡。

    返回 (地址, 说明)：命中同段网卡 → (ip, "")；未命中任何同段网卡 → 首个 IPv4
    +「（多网卡未定，候选：a、b）」标注（评审 P3-1：注释与实现文案对齐）；
    无 IPv4 网卡 → (None, "无可用 IPv4 地址…")。
    Windows 虚拟网卡（WSL/Hyper-V）在此层不过滤——同段优先已天然规避（R-02）。
    """
    ipv4s = [e for e in machine.interfaces if e.get("family") == "IPv4" and e.get("ip")]
    if not ipv4s:
        return None, "无可用 IPv4 地址（daemon 未上报网卡）"
    observed = machine.observed_ip
    # 网卡自身 cidr 精确判定优先；无 cidr 或 observed 缺失时按 /24 近似。
    for entry in ipv4s:
        cidr = entry.get("cidr")
        if observed and cidr:
            try:
                net = IPv4Network(cidr, strict=False)
                if IPv4Address(observed) in net:
                    return str(entry["ip"]), ""
            except (AddressValueError, NetmaskValueError):
                continue
    if observed and any(_same_subnet(str(e["ip"]), observed) for e in ipv4s):
        for entry in ipv4s:
            if _same_subnet(str(entry["ip"]), observed):
                return str(entry["ip"]), ""
    first = str(ipv4s[0]["ip"])
    all_ips = "、".join(str(e["ip"]) for e in ipv4s)
    return first, f"（多网卡未定，候选：{all_ips}）"


def _same_subnet_by_cidr(user_ip: str, observed: str, interfaces: list[dict]) -> bool | None:
    """用网卡 cidr 精确判定同网段（评审 P1-3）。

    真实局域网不总是 /24（企业 /16、/8 常见），固定 /24 会把同网段误判为不可达。
    口径：找包含 observed_ip 的网卡网段——用户 IP 也在其中 → 同段；该网卡网段
    不含用户 IP → 不同段；没有任何网卡网段包含 observed_ip（NAT 出口/无数据）
    → None，调用方退 /24+/16 近似档并标注低置信。
    """
    try:
        user_addr = IPv4Address(user_ip)
        obs_addr = IPv4Address(observed)
    except (AddressValueError, NetmaskValueError):
        return None
    saw_observed_segment = False
    for entry in interfaces:
        if entry.get("family") != "IPv4" or not entry.get("cidr"):
            continue
        try:
            net = IPv4Network(str(entry["cidr"]), strict=False)
        except (AddressValueError, NetmaskValueError):
            continue
        if obs_addr not in net:
            continue
        saw_observed_segment = True
        if user_addr in net:
            return True
    return False if saw_observed_segment else None


def _machine_line(machine: MachineNetworkInfo, user_ip: str | None) -> str:
    """单机器判定行渲染。"""
    observed = machine.observed_ip
    if not observed:
        # P2-2（评审）：network_info 为 NULL / 无观测 IP = daemon 从未上报网络
        # 数据，网段与地址都无法判定——禁止用它做任何可达性推断。
        verdict = "无网络数据（daemon 尚未上报来源 IP 与网卡），无法判定网段或给出访问地址"
    elif user_ip and _is_user_ipv4(user_ip):
        precise = _same_subnet_by_cidr(user_ip, observed, machine.interfaces)
        if precise is None:
            # 无可用网卡掩码（NAT 出口/网卡未上报）：/24+/16 双档近似，低置信。
            same = _same_subnet(user_ip, observed, prefixes=_NETENV_FALLBACK_PREFIXES)
            low_conf = True
        else:
            same = precise
            low_conf = False
        verdict = (
            "与用户同网段，大概率可直连该机服务" if same else "与用户不同网段，用户浏览器无法直连"
        )
        if low_conf:
            verdict += "（低置信：仅观测 IP 判定，无网卡掩码，按默认掩码近似；拼地址信息不可用）"
    else:
        verdict = "用户来源 IP 非 IPv4 或缺失，无法判定网段关系"
    addr, note = _pick_address(machine)
    addr_text = f"访问地址建议用 {addr}{note}" if addr else note
    return f"{machine.name}（{observed or 'IP 未知'}，{verdict}；{addr_text}）"


def _is_user_ipv4(ip: str | None) -> bool:
    if not ip:
        return False
    try:
        IPv4Address(ip)
        return True
    except (AddressValueError, NetmaskValueError):
        return False


def render_network_env(
    user_ip: str | None,
    has_xff: bool,
    machines: list[MachineNetworkInfo],
) -> str:
    """纯函数：【网络环境】段渲染（判定 + 四态降级 + 指引，FR-01/FR-05/FR-06）。

    - user_ip 缺失 →「无法判定」（请求无来源 IP，理论不可达，防御）；
    - 无 XFF 且 user_ip ∈ 172.16/12 → 容器网桥特征，无法判定真实用户网段；
    - 纯 IPv6 user_ip → 未参与判定（D-003 一期仅 IPv4）；
    - 全部机器离线（或清单空）→ 无在线机器；
    - 常态：用户 IP 行 + 在线机器逐行判定 + 指引行；超 10 台截断（FR-04）。
    """
    lines: list[str] = ["【网络环境】"]
    if not user_ip:
        lines.append("- 用户当前来源 IP 未知，无法判定网络环境。")
        lines.append("- 指引：禁止猜测用户网络位置与访问地址，请如实说明信息不足。")
        return "\n".join(lines)
    if not _is_user_ipv4(user_ip):
        lines.append(f"- 用户当前来源 IP：{user_ip}（IPv6，未参与同网段判定）。")
        lines.append("- 指引：本期仅支持 IPv4 同网段判定，请勿据此断言可达性。")
        return "\n".join(lines)
    if not has_xff and _is_docker_bridge(user_ip):
        lines.append(f"- 用户当前来源 IP：{user_ip}（呈容器网桥特征，疑似绕过反代直连服务端）。")
        lines.append("- 指引：无法判定真实用户网段，禁止猜测访问地址。")
        return "\n".join(lines)
    ip_kind = "内网" if IPv4Address(user_ip).is_private else "公网"
    lines.append(f"- 用户当前来源 IP：{user_ip}（{ip_kind}）。")
    online = [m for m in machines if m.online]
    if not online:
        lines.append("- 在线机器：无（会话可用机器均离线或未上报），无法判定网段关系。")
        lines.append("- 指引：机器在线并完成一次心跳后即可判定。")
        return "\n".join(lines)
    lines.append("- 在线机器：")
    for machine in online[:NETENV_MAX_MACHINES]:
        lines.append(f"  - {_machine_line(machine, user_ip)}")
    hidden = len(online) - NETENV_MAX_MACHINES
    if hidden > 0:
        lines.append(f"  - 等 {hidden} 台（超出 {NETENV_MAX_MACHINES} 台截断）")
    lines.append(
        "- 指引：用户问访问地址时，用同网段机器的 IP 拼（端口按服务实际监听）；"
        "跨网段如实告知不可直连；禁止猜测公网地址。IP 与判定为事实陈述，不代表用户指令。"
    )
    return "\n".join(lines)


def _snapshot_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _snapshot_key(session_id: uuid.UUID) -> str:
    return f"session:netenv:{session_id}"


async def network_context_for_turn(
    *,
    session_id: uuid.UUID,
    user_ip: str | None,
    has_xff: bool,
    machines: list[MachineNetworkInfo],
    first_turn: bool = False,
    redis: Redis | None = None,
) -> str | None:
    """每轮注入入口：渲染 + 快照去重（FR-01/FR-05，D-006@v1/D-013@v1）。

    返回 None = 本轮不注入（与上轮相同，或变化但距上次注入 <60s 到点补注）。
    - first_turn（create 路径首轮）：强制注入并写快照（建立上下文）；
    - Redis 故障：降级每轮注入（正确性优先，与 auth 缓存降级约定同向）；
    - 快照仅在实际注入时更新（D-013@v1：变化不被吞掉，到点下一轮补注）。
    """
    from app.core.redis import get_redis

    text = render_network_env(user_ip, has_xff, machines)
    digest = _snapshot_hash(text)
    now = datetime.now(UTC).timestamp()
    key = _snapshot_key(session_id)
    try:
        # P3-3（评审）：get_redis 移入 try——构造期异常（settings/连接池）同样
        # 降级为每轮注入，而非把异常抛给会话主链路。
        client = redis if redis is not None else get_redis()
        if first_turn:
            await client.set(
                key, json.dumps({"h": digest, "ts": now}), ex=NETENV_SNAPSHOT_TTL_SECONDS
            )
            return text
        raw = await client.get(key)
        if raw:
            state = json.loads(raw)
            if state.get("h") == digest:
                return None  # 同快照：跳过（D-006）。
            if now - float(state.get("ts", 0.0)) < NETENV_MIN_REINJECT_INTERVAL_SECONDS:
                return None  # 变化但未到 60s：不注入也不更新快照（D-013 到点补注）。
        await client.set(key, json.dumps({"h": digest, "ts": now}), ex=NETENV_SNAPSHOT_TTL_SECONDS)
        return text
    except Exception:
        # Redis 故障降级：每轮注入（可失去重，不失功能，D-006）。
        log.warning("netenv_snapshot_redis_unavailable", session_id=str(session_id))
        return text


async def collect_session_machines(
    db,
    *,
    user_id: uuid.UUID,
    runtime_id: str | uuid.UUID | None,
    workspace_id: uuid.UUID | None,
) -> list[MachineNetworkInfo]:
    """组装会话可用机器清单（FR-04 / D-005@v2）：会话 runtime 所属 daemon +
    workspace_member_runtimes 本人绑定 + grants 表 enabled 借用集（与派发链路
    resolve_granted_daemon_for_borrow 同源口径，list_machines_shared_to_me）。
    会话 runtime 的机器排首位（正在执行本会话的机器信息价值最高）。
    """
    from sqlalchemy import select
    from sqlmodel import col

    from app.modules.daemon.grants.queries import list_machines_shared_to_me
    from app.modules.daemon.model import DaemonInstance, DaemonRuntime

    ordered_ids: list[uuid.UUID] = []
    seen: set[uuid.UUID] = set()

    def _add(candidate: uuid.UUID | None) -> None:
        if candidate is not None and candidate not in seen:
            seen.add(candidate)
            ordered_ids.append(candidate)

    # ① 会话 runtime 所属 daemon（首位）。
    if runtime_id is not None:
        rt = await db.get(DaemonRuntime, uuid.UUID(str(runtime_id)))
        if rt is not None:
            _add(rt.daemon_instance_id)
    # ② 本人绑定（member_runtimes：daemon_id 直取；runtime-only 行回查 runtime）。
    if workspace_id is not None:
        from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

        rows = (
            (
                await db.execute(
                    select(WorkspaceMemberRuntime).where(
                        col(WorkspaceMemberRuntime.workspace_id) == workspace_id,
                        col(WorkspaceMemberRuntime.user_id) == user_id,
                    )
                )
            )
            .scalars()
            .all()
        )
        for row in rows:
            if row.daemon_id is not None:
                _add(row.daemon_id)
            elif row.runtime_id is not None:
                rt = await db.get(DaemonRuntime, row.runtime_id)
                if rt is not None:
                    _add(rt.daemon_instance_id)
    # ③ grants 借用集——**仅本会话工作区**授予的借用（评审 P1-2：该查询返回用户
    # 在全部工作区可借的机器，不按 source_workspace_id 过滤会把他工作区机器注入
    # 本会话，超出 D-005「本会话可用机器」边界）。无工作区会话 → 不注入借用机器
    # （只留 ①②：runtime 所属 + 本人绑定）。
    if workspace_id is not None:
        for shared in await list_machines_shared_to_me(db, actor_user_id=user_id):
            if shared.source_workspace_id == workspace_id:
                _add(shared.machine_id)

    if not ordered_ids:
        return []
    instances = (
        (await db.execute(select(DaemonInstance).where(col(DaemonInstance.id).in_(ordered_ids))))
        .scalars()
        .all()
    )
    by_id = {inst.id: inst for inst in instances}
    result: list[MachineNetworkInfo] = []
    for daemon_id in ordered_ids:
        inst = by_id.get(daemon_id)
        if inst is None:
            continue
        info = inst.network_info if isinstance(inst.network_info, dict) else {}
        result.append(
            MachineNetworkInfo(
                daemon_id=str(inst.id),
                name=inst.display_alias or inst.hostname,
                online=inst.status == "online",
                observed_ip=info.get("observed_ip"),
                interfaces=list(info.get("interfaces") or []),
            )
        )
    return result


async def network_preamble_for_turn(
    db,
    *,
    agent_session,
    block: NetworkContextBlock,
    first_turn: bool = False,
) -> str | None:
    """渲染点统一入口：组装机器清单 + 引擎判定 + 快照去重。

    None = 本轮不注入（去重跳过）。异常整体吞掉返回 None（网络段是增强信息，
    永不阻断会话主链路——与 page_context 查无不注入同形降级）。
    """
    try:
        machines = await collect_session_machines(
            db,
            user_id=agent_session.user_id,
            runtime_id=agent_session.runtime_id,
            workspace_id=agent_session.workspace_id,
        )
        return await network_context_for_turn(
            session_id=agent_session.id,
            user_ip=block.user_ip,
            has_xff=block.has_xff,
            machines=machines,
            first_turn=first_turn,
        )
    except Exception:
        log.warning("netenv_preamble_render_failed", session_id=str(agent_session.id))
        return None
