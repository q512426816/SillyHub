"""sillyspec 平台命令两端点 + 心跳结果链路（task-04 / FR-02~05 / D-001 D-003 D-004@v1）.

fixture 与命名照 ``test_machine_sillyspec.py`` 惯例（root ``db_session``/``client``、
``_seed_user`` 手签 JWT、``fresh_ws_hub`` 替换进程级单例、``_create_machine`` 直插行、
``_reload_instance`` expire 直读库），ws_hub mock 范式照 ``test_machines_router.py``
既有 self-update/cleanup 用例。覆盖（design §5 Phase 1 / §7 / §7.5）：

* WS 通道契约——send_sillyspec_resolve / send_sillyspec_ghost_cleanup 消息封包
  （type + payload 原样，strategy 下划线字面量不映射——中划线 flag 归 daemon 侧）；
* 端点权限四态（D-003@v1）——owner 200 / 平台 admin 200 / 持 RUNTIME_ADMIN 的
  他人 404（code HTTP_404_DAEMON_RUNTIME_NOT_FOUND，防存在性泄漏）/ 无权限 403，
  resolve 与 ghost-cleanup 两端点各覆盖；
* change 白名单——``a..b`` / ``../x`` / 非法首字符 / 129 超长 → 422 且 ws_hub
  零调用；strategy 非法值 → 422；128 字符边界值放行；
* 离线 504——send_* 返回 False / 底层 ws.send_json 抛出（send_to_runtime 兜住
  转 False）→ 504 DaemonRuntimeOffline + details 含 daemon_instance_id；
* 心跳两态（D-004@v1，X-04 修订）——对象=整包直写七键（无 since 注入，latest-wins
  只留最新一条 R-07）；键不出现（缺省与显式 null 同置 NULL，pydantic 不可区分）
  → 列置 NULL 而非保持旧值；register（new 与 else 两分支）恒清；
* GET /machines 透出——sillyspec_command_result 为 MachineSillySpecCommandResultRead
  嵌套类型化七键形态，无结果机为 null；
* OpenAPI——两端点路径 + 读视图/心跳载荷 schema 引用（task-08 gen:types 输入可再生产）。
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.model import Role, RolePermission, User
from app.modules.auth.permissions import Permission
from app.modules.daemon import ws_hub as ws_hub_module
from app.modules.daemon.model import DaemonInstance
from app.modules.daemon.protocol import (
    DAEMON_MSG_SILLYSPEC_GHOST_CLEANUP,
    DAEMON_MSG_SILLYSPEC_RESOLVE,
)
from app.modules.daemon.runtime.service import RuntimeService
from app.modules.daemon.ws_hub import DaemonWsHub

# 七键结果槽：design §7 心跳结果字段（全字段宽松可选；executed_at 机器本地钟 ISO）。
_COMMAND_RESULT_KEYS = {
    "action",
    "change",
    "strategy",
    "state",
    "exit_code",
    "error",
    "executed_at",
}

_RESULT_RESOLVE_SUCCESS: dict[str, Any] = {
    "action": "resolve",
    "change": "2026-09-02-changes-overview-card",
    "strategy": "keep_local",
    "state": "success",
    "exit_code": 0,
    "error": None,
    "executed_at": "2026-09-04T13:20:00+08:00",
}

_RESULT_GHOST_FAILED: dict[str, Any] = {
    "action": "ghost_cleanup",
    "change": None,
    "strategy": None,
    "state": "failed",
    "exit_code": 1,
    "error": "执行失败（exit 1）：doctor --cleanup-ghosts 退出非零",
    "executed_at": "2026-09-04T13:25:00+08:00",
}

_VALID_CHANGE = "2026-09-04-conflict-resolve-entry"

# 两端点路径（含 /api 前缀，照 test_machine_sillyspec.py HTTP 断言形态）。
_RESOLVE_PATH = "/api/daemon/machines/{instance_id}/sillyspec-resolve"
_GHOST_PATH = "/api/daemon/machines/{instance_id}/sillyspec-ghost-cleanup"


# ── helpers（照 test_machine_sillyspec.py 惯例就近私有复刻，不新建 conftest）────


async def _seed_user(
    db_session: AsyncSession, *, name: str, is_platform_admin: bool = False
) -> tuple[User, str]:
    """插入用户并手签 15min JWT（get_current_principal Bearer 路径）。"""
    from app.core.config import get_settings
    from app.core.security import create_access_token

    user = User(
        id=uuid.uuid4(),
        email=f"sscmd-{name}-{uuid.uuid4()}@example.com",
        password_hash="irrelevant",
        display_name=name,
        status="active",
        is_platform_admin=is_platform_admin,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)

    settings = get_settings()
    token, _payload = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=bool(user.is_platform_admin),
        settings=settings,
    )
    return user, token


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _grant_runtime_admin(db_session: AsyncSession, user_id: uuid.UUID) -> None:
    """授予 RUNTIME_ADMIN 平台权限（复刻 test_machines_router._grant_platform_permission）。"""
    from app.modules.admin.model import UserRole

    role = Role(
        id=uuid.uuid4(),
        key=f"test-sscmd-admin-{uuid.uuid4().hex[:6]}",
        name="test runtime_admin",
    )
    db_session.add(role)
    await db_session.flush()
    db_session.add(RolePermission(role_id=role.id, permission=Permission.RUNTIME_ADMIN.value))
    db_session.add(UserRole(user_id=user_id, role_id=role.id))
    await db_session.commit()


async def _create_machine(
    db_session: AsyncSession,
    user_id: uuid.UUID,
    *,
    hostname: str,
    sillyspec_command_result: dict | None = None,
) -> DaemonInstance:
    """直插 daemon_instance 行（仿 test_machines_router._create_instance，额外带
    sillyspec_command_result 列——不走 register，锁定读视图直读列）。"""
    from datetime import UTC, datetime

    inst = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname=hostname,
        server_url="http://localhost:8001",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
        sillyspec_command_result=sillyspec_command_result,
    )
    db_session.add(inst)
    await db_session.commit()
    await db_session.refresh(inst)
    return inst


async def _register_daemon(
    db_session: AsyncSession,
    user_id: uuid.UUID,
    *,
    hostname: str = "sscmd-host",
) -> uuid.UUID:
    """register 一个 daemon 实体 + 单 provider runtime（heartbeat 的前置，§9.1）。"""
    daemon_local_id = uuid.uuid4()
    await RuntimeService(db_session).register_daemon(
        user_id,
        daemon_local_id=daemon_local_id,
        server_url="http://localhost:8001",
        hostname=hostname,
        os="linux",
        arch="x86_64",
        allowed_roots=["~/.sillyhub"],
        providers=[{"provider": "claude", "status": "online", "version": "1.0"}],
    )
    return daemon_local_id


async def _reload_instance(db_session: AsyncSession, instance_id: uuid.UUID) -> DaemonInstance:
    """expire 后重查（绕过 identity map），直读库验证落库真值。"""
    db_session.expire_all()
    row = (
        await db_session.execute(select(DaemonInstance).where(DaemonInstance.id == instance_id))
    ).scalar_one()
    assert row is not None
    return row


@pytest.fixture()
def fresh_ws_hub(monkeypatch: pytest.MonkeyPatch) -> DaemonWsHub:
    """用全新 DaemonWsHub 替换进程级单例（仿 test_ws_rpc.py / test_machines_router.py）。"""
    hub = DaemonWsHub()
    monkeypatch.setattr(ws_hub_module, "_ws_hub", hub)
    return hub


class _FakeWs:
    """占位 WS 连接：send_json 捕获消息（或按需抛出，模拟断连）。"""

    def __init__(self, *, raise_on_send: bool = False) -> None:
        self.messages: list[dict[str, Any]] = []
        self.raise_on_send = raise_on_send

    async def send_json(self, message: dict[str, Any]) -> None:
        if self.raise_on_send:
            raise RuntimeError("simulated broken pipe")
        self.messages.append(message)


class _SendRecorder:
    """monkeypatch 两个 send_* 方法：记录调用并按 ``result`` 返回（True/False）。"""

    def __init__(self, *, result: bool = True) -> None:
        self.result = result
        self.calls: list[tuple[str, dict[str, Any]]] = []

    def install(self, monkeypatch: pytest.MonkeyPatch) -> None:
        recorder = self

        async def _fake_resolve(
            self_hub: DaemonWsHub,
            daemon_id: uuid.UUID,
            change: str,
            strategy: str,
        ) -> bool:
            recorder.calls.append(
                ("resolve", {"daemon_id": daemon_id, "change": change, "strategy": strategy})
            )
            return recorder.result

        async def _fake_ghost(
            self_hub: DaemonWsHub,
            daemon_id: uuid.UUID,
        ) -> bool:
            recorder.calls.append(("ghost_cleanup", {"daemon_id": daemon_id}))
            return recorder.result

        monkeypatch.setattr(DaemonWsHub, "send_sillyspec_resolve", _fake_resolve)
        monkeypatch.setattr(DaemonWsHub, "send_sillyspec_ghost_cleanup", _fake_ghost)


def _resolve_url(instance_id: uuid.UUID) -> str:
    return _RESOLVE_PATH.format(instance_id=instance_id)


def _ghost_url(instance_id: uuid.UUID) -> str:
    return _GHOST_PATH.format(instance_id=instance_id)


_ENDPOINT_IDS = ["resolve", "ghost_cleanup"]


def _endpoint_url(kind: str, instance_id: uuid.UUID) -> str:
    return _resolve_url(instance_id) if kind == "resolve" else _ghost_url(instance_id)


async def _post_endpoint(
    client: AsyncClient, kind: str, instance_id: uuid.UUID, headers: dict[str, str]
):
    """两端点统一 POST——resolve 携带合法 body，ghost-cleanup 无 body。"""
    url = _endpoint_url(kind, instance_id)
    if kind == "resolve":
        return await client.post(
            url, json={"change": _VALID_CHANGE, "strategy": "keep_local"}, headers=headers
        )
    return await client.post(url, headers=headers)


# ── WS 通道契约：消息封包（protocol 常量 + payload 原样，design §7）──────────


@pytest.mark.asyncio
async def test_ws_hub_send_sillyspec_resolve_envelope(fresh_ws_hub: DaemonWsHub) -> None:
    """send_sillyspec_resolve → ``daemon:sillyspec_resolve`` 封包：payload 两键原样，
    strategy 下划线字面量不映射（--keep-local 中划线 flag 归 daemon 侧单点）。"""
    daemon_id = uuid.uuid4()
    fake_ws = _FakeWs()
    await fresh_ws_hub.connect(daemon_id, fake_ws)

    sent = await fresh_ws_hub.send_sillyspec_resolve(daemon_id, _VALID_CHANGE, "take_platform")
    assert sent is True
    assert fake_ws.messages == [
        {
            "type": DAEMON_MSG_SILLYSPEC_RESOLVE,
            "payload": {"change": _VALID_CHANGE, "strategy": "take_platform"},
        }
    ]


@pytest.mark.asyncio
async def test_ws_hub_send_sillyspec_ghost_cleanup_envelope(fresh_ws_hub: DaemonWsHub) -> None:
    """send_sillyspec_ghost_cleanup → ``daemon:sillyspec_ghost_cleanup`` 封包：空 payload。"""
    daemon_id = uuid.uuid4()
    fake_ws = _FakeWs()
    await fresh_ws_hub.connect(daemon_id, fake_ws)

    sent = await fresh_ws_hub.send_sillyspec_ghost_cleanup(daemon_id)
    assert sent is True
    assert fake_ws.messages == [{"type": DAEMON_MSG_SILLYSPEC_GHOST_CLEANUP, "payload": {}}]


@pytest.mark.asyncio
async def test_ws_hub_send_without_connection_returns_false(fresh_ws_hub: DaemonWsHub) -> None:
    """无连接（daemon 离线）→ 两 send 均返回 False（调用方端点转 504，不在 hub 抛）。"""
    assert (
        await fresh_ws_hub.send_sillyspec_resolve(uuid.uuid4(), _VALID_CHANGE, "keep_local")
        is False
    )
    assert await fresh_ws_hub.send_sillyspec_ghost_cleanup(uuid.uuid4()) is False


# ── 端点权限四态（D-003@v1：owner + 平台 admin 放行，其余 404/403）────────────


@pytest.mark.parametrize("kind", _ENDPOINT_IDS)
@pytest.mark.asyncio
async def test_endpoint_owner_returns_200(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
    monkeypatch: pytest.MonkeyPatch,
    kind: str,
) -> None:
    """机器所有者（持 RUNTIME_ADMIN、非平台 admin）→ 200 ``{"sent": true}``，
    且以 instance_id 作 daemon_id 路由 WS。"""
    owner, owner_token = await _seed_user(db_session, name=f"owner-{kind}")
    await _grant_runtime_admin(db_session, owner.id)
    inst = await _create_machine(db_session, owner.id, hostname=f"sscmd-owner-{kind}")
    recorder = _SendRecorder(result=True)
    recorder.install(monkeypatch)

    resp = await _post_endpoint(client, kind, inst.id, _headers(owner_token))
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"sent": True}
    assert len(recorder.calls) == 1
    sent_kind, call = recorder.calls[0]
    assert sent_kind == kind
    assert call["daemon_id"] == inst.id


@pytest.mark.parametrize("kind", _ENDPOINT_IDS)
@pytest.mark.asyncio
async def test_endpoint_platform_admin_returns_200(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
    monkeypatch: pytest.MonkeyPatch,
    kind: str,
) -> None:
    """平台管理员（非 owner）→ 200（has_permission 短路 + _get_owned_instance 全局放行）。"""
    owner, _owner_token = await _seed_user(db_session, name=f"pa-owner-{kind}")
    _admin, admin_token = await _seed_user(
        db_session, name=f"pa-admin-{kind}", is_platform_admin=True
    )
    inst = await _create_machine(db_session, owner.id, hostname=f"sscmd-pa-{kind}")
    recorder = _SendRecorder(result=True)
    recorder.install(monkeypatch)

    resp = await _post_endpoint(client, kind, inst.id, _headers(admin_token))
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"sent": True}
    assert len(recorder.calls) == 1


@pytest.mark.parametrize("kind", _ENDPOINT_IDS)
@pytest.mark.asyncio
async def test_endpoint_runtime_admin_stranger_returns_404(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
    monkeypatch: pytest.MonkeyPatch,
    kind: str,
) -> None:
    """持 RUNTIME_ADMIN 但非 owner 且非平台 admin → 404（code
    HTTP_404_DAEMON_RUNTIME_NOT_FOUND，越权与不存在合并防存在性泄漏），hub 零调用。"""
    owner, _owner_token = await _seed_user(db_session, name=f"str-owner-{kind}")
    stranger, stranger_token = await _seed_user(db_session, name=f"str-stranger-{kind}")
    await _grant_runtime_admin(db_session, stranger.id)
    inst = await _create_machine(db_session, owner.id, hostname=f"sscmd-str-{kind}")
    recorder = _SendRecorder(result=True)
    recorder.install(monkeypatch)

    resp = await _post_endpoint(client, kind, inst.id, _headers(stranger_token))
    assert resp.status_code == 404, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_404_DAEMON_RUNTIME_NOT_FOUND"
    assert recorder.calls == [], "越权请求不得触达 ws_hub"


@pytest.mark.parametrize("kind", _ENDPOINT_IDS)
@pytest.mark.asyncio
async def test_endpoint_plain_user_returns_403(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
    monkeypatch: pytest.MonkeyPatch,
    kind: str,
) -> None:
    """无 RUNTIME_ADMIN 权限的普通用户 → 403（RuntimeAdminUser 权限闸，早于归属校验）。"""
    owner, _owner_token = await _seed_user(db_session, name=f"plain-owner-{kind}")
    _nobody, nobody_token = await _seed_user(db_session, name=f"plain-nobody-{kind}")
    inst = await _create_machine(db_session, owner.id, hostname=f"sscmd-plain-{kind}")
    recorder = _SendRecorder(result=True)
    recorder.install(monkeypatch)

    resp = await _post_endpoint(client, kind, inst.id, _headers(nobody_token))
    assert resp.status_code == 403, resp.text
    assert recorder.calls == []


@pytest.mark.parametrize("kind", _ENDPOINT_IDS)
@pytest.mark.asyncio
async def test_endpoint_nonexistent_instance_returns_404(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
    monkeypatch: pytest.MonkeyPatch,
    kind: str,
) -> None:
    """不存在 instance_id → 404（平台 admin 请求同样 404）。"""
    _admin, admin_token = await _seed_user(
        db_session, name=f"miss-admin-{kind}", is_platform_admin=True
    )
    recorder = _SendRecorder(result=True)
    recorder.install(monkeypatch)

    resp = await _post_endpoint(client, kind, uuid.uuid4(), _headers(admin_token))
    assert resp.status_code == 404, resp.text
    assert recorder.calls == []


# ── change 白名单 + strategy 值域（R-04 三重防线第一道，422 早于任何发送）──────


@pytest.mark.parametrize(
    "bad_change",
    [
        "a..b",  # 显式禁 ..（即使正则可过）
        "../x",  # 穿越形态（含 .. 与非法 /）
        "-bad",  # 首字符非字母数字
        ".dotted-start",  # 首字符点号（隐藏目录形态）
        "a" * 129,  # 超长（上限 128）
        "has space",  # 含空格（shell 元字符面）
        "",
    ],
    ids=["dotdot", "traversal", "bad-first-char", "dot-first", "too-long-129", "space", "empty"],
)
@pytest.mark.asyncio
async def test_resolve_rejects_bad_change_without_touching_hub(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
    monkeypatch: pytest.MonkeyPatch,
    bad_change: str,
) -> None:
    """非法 change → 422 且 ws_hub 零调用（pydantic 层拒绝，请求进不了 handler）。"""
    admin, admin_token = await _seed_user(db_session, name="wl-admin", is_platform_admin=True)
    inst = await _create_machine(db_session, admin.id, hostname="sscmd-whitelist-host")
    recorder = _SendRecorder(result=True)
    recorder.install(monkeypatch)

    resp = await client.post(
        _resolve_url(inst.id),
        json={"change": bad_change, "strategy": "keep_local"},
        headers=_headers(admin_token),
    )
    assert resp.status_code == 422, resp.text
    assert recorder.calls == [], "422 请求不得触达 ws_hub"


@pytest.mark.parametrize(
    "bad_strategy",
    ["keep-local", "take-platform", "abort", "", "KEEP_LOCAL"],
    ids=["dash-form", "dash-form-2", "abort-value", "empty", "upper-case"],
)
@pytest.mark.asyncio
async def test_resolve_rejects_bad_strategy_without_touching_hub(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
    monkeypatch: pytest.MonkeyPatch,
    bad_strategy: str,
) -> None:
    """非法 strategy → 422 且 ws_hub 零调用（Literal 限定 keep_local/take_platform；
    keep-local 中划线形态也拒——backend 契约是下划线字面量，中划线归 daemon 映射）。"""
    admin, admin_token = await _seed_user(db_session, name="st-admin", is_platform_admin=True)
    inst = await _create_machine(db_session, admin.id, hostname="sscmd-strategy-host")
    recorder = _SendRecorder(result=True)
    recorder.install(monkeypatch)

    resp = await client.post(
        _resolve_url(inst.id),
        json={"change": _VALID_CHANGE, "strategy": bad_strategy},
        headers=_headers(admin_token),
    )
    assert resp.status_code == 422, resp.text
    assert recorder.calls == []


@pytest.mark.asyncio
async def test_resolve_accepts_128_char_change_boundary(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """长度上限含 128（``[A-Za-z0-9][A-Za-z0-9._-]{0,127}`` 恰 128 字符）→ 200——
    钉住边界，防白名单被误收紧成 127。"""
    admin, admin_token = await _seed_user(db_session, name="b128-admin", is_platform_admin=True)
    inst = await _create_machine(db_session, admin.id, hostname="sscmd-b128-host")
    recorder = _SendRecorder(result=True)
    recorder.install(monkeypatch)

    resp = await client.post(
        _resolve_url(inst.id),
        json={"change": "a" * 128, "strategy": "keep_local"},
        headers=_headers(admin_token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"sent": True}
    assert recorder.calls[0][1]["change"] == "a" * 128


@pytest.mark.parametrize("strategy", ["keep_local", "take_platform"])
@pytest.mark.asyncio
async def test_resolve_passes_both_strategies_verbatim(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
    monkeypatch: pytest.MonkeyPatch,
    strategy: str,
) -> None:
    """两合法 strategy 各 200，change/strategy 原样到达 ws_hub（backend 不做映射）。"""
    admin, admin_token = await _seed_user(db_session, name=f"st2-admin-{strategy}")
    await _grant_runtime_admin(db_session, admin.id)
    inst = await _create_machine(db_session, admin.id, hostname=f"sscmd-st2-{strategy}")
    recorder = _SendRecorder(result=True)
    recorder.install(monkeypatch)

    resp = await client.post(
        _resolve_url(inst.id),
        json={"change": _VALID_CHANGE, "strategy": strategy},
        headers=_headers(admin_token),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"sent": True}
    _kind, call = recorder.calls[0]
    assert call["change"] == _VALID_CHANGE
    assert call["strategy"] == strategy


# ── 离线 / 发送失败 → 504（与机器级 self-update/cleanup/sillyspec-update 同款）──


@pytest.mark.parametrize("kind", _ENDPOINT_IDS)
@pytest.mark.asyncio
async def test_endpoint_send_returns_false_yields_504(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
    monkeypatch: pytest.MonkeyPatch,
    kind: str,
) -> None:
    """send_* 返回 False（无连接/发送失败）→ 504 DaemonRuntimeOffline，details 含
    daemon_instance_id。"""
    admin, admin_token = await _seed_user(
        db_session, name=f"off-admin-{kind}", is_platform_admin=True
    )
    inst = await _create_machine(db_session, admin.id, hostname=f"sscmd-off-{kind}")
    _SendRecorder(result=False).install(monkeypatch)

    resp = await _post_endpoint(client, kind, inst.id, _headers(admin_token))
    assert resp.status_code == 504, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_504_DAEMON_RUNTIME_OFFLINE"
    assert body["details"] == {"daemon_instance_id": str(inst.id)}


@pytest.mark.parametrize("kind", _ENDPOINT_IDS)
@pytest.mark.asyncio
async def test_endpoint_ws_send_raises_yields_504(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
    kind: str,
) -> None:
    """底层 ws.send_json 抛出（连接中途断开）→ send_to_runtime 兜异常转 False →
    端点同样 504 + details（真实 hub 路径，非 mock）。"""
    admin, admin_token = await _seed_user(
        db_session, name=f"brk-admin-{kind}", is_platform_admin=True
    )
    inst = await _create_machine(db_session, admin.id, hostname=f"sscmd-brk-{kind}")
    await fresh_ws_hub.connect(inst.id, _FakeWs(raise_on_send=True))

    resp = await _post_endpoint(client, kind, inst.id, _headers(admin_token))
    assert resp.status_code == 504, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_504_DAEMON_RUNTIME_OFFLINE"
    assert body["details"] == {"daemon_instance_id": str(inst.id)}
    # 异常路径逐出坏连接（_evict_stale），后续请求不再命中同一 ws。
    assert fresh_ws_hub.is_connected(inst.id) is False


# ── 心跳两态落库（D-004@v1：对象=整包直写 / 键不出现=置 NULL，X-04 修订）──────


@pytest.mark.asyncio
async def test_heartbeat_command_result_writes_seven_keys_verbatim(
    db_session: AsyncSession,
) -> None:
    """两态①（服务层直调）：带对象 → 整包直写七键原样——无 since 注入、无键增删
    改写（latest-wins 结果槽非状态机，design §7「落库形态=上报形态」）。"""
    user, _token = await _seed_user(db_session, name="hb-u1")
    daemon_local_id = await _register_daemon(db_session, user.id)

    await RuntimeService(db_session).heartbeat_daemon(
        daemon_local_id, sillyspec_command_result=dict(_RESULT_RESOLVE_SUCCESS)
    )
    row = await _reload_instance(db_session, daemon_local_id)
    assert row.sillyspec_command_result == _RESULT_RESOLVE_SUCCESS
    assert set(row.sillyspec_command_result) == _COMMAND_RESULT_KEYS
    assert "since" not in row.sillyspec_command_result, "结果槽非状态机，不注入 since"


@pytest.mark.asyncio
async def test_heartbeat_command_result_latest_wins(
    db_session: AsyncSession,
) -> None:
    """latest-wins（R-07）：daemon 只保留最新一条——第二次心跳的对象整包覆盖前一条。"""
    user, _token = await _seed_user(db_session, name="hb-u2")
    daemon_local_id = await _register_daemon(db_session, user.id)
    svc = RuntimeService(db_session)

    await svc.heartbeat_daemon(
        daemon_local_id, sillyspec_command_result=dict(_RESULT_RESOLVE_SUCCESS)
    )
    await svc.heartbeat_daemon(daemon_local_id, sillyspec_command_result=dict(_RESULT_GHOST_FAILED))
    row = await _reload_instance(db_session, daemon_local_id)
    assert row.sillyspec_command_result == _RESULT_GHOST_FAILED


@pytest.mark.asyncio
async def test_heartbeat_without_command_result_clears_to_null(
    db_session: AsyncSession,
) -> None:
    """两态②（服务层直调）：键不出现（缺省 None）→ 列置 NULL——**不是**保持旧值
    （无「保留」三态分支，X-04；与兄弟字段 sillyspec_version 的「缺省保留」反向）。"""
    user, _token = await _seed_user(db_session, name="hb-u3")
    daemon_local_id = await _register_daemon(db_session, user.id)
    svc = RuntimeService(db_session)

    await svc.heartbeat_daemon(
        daemon_local_id, sillyspec_command_result=dict(_RESULT_RESOLVE_SUCCESS)
    )
    assert (
        await _reload_instance(db_session, daemon_local_id)
    ).sillyspec_command_result is not None

    await svc.heartbeat_daemon(daemon_local_id)
    assert (await _reload_instance(db_session, daemon_local_id)).sillyspec_command_result is None


# ── register 恒清（new 与 else 两分支——结果槽在 daemon 内存，进程重启即失）────


@pytest.mark.asyncio
async def test_register_new_branch_leaves_command_result_null(
    db_session: AsyncSession,
) -> None:
    """new 分支：全新 daemon_local_id register → 列为 NULL（显式落 None，非依赖列缺省）。"""
    user, _token = await _seed_user(db_session, name="reg-u1")
    daemon_local_id = await _register_daemon(db_session, user.id)

    row = await _reload_instance(db_session, daemon_local_id)
    assert row.sillyspec_command_result is None


@pytest.mark.asyncio
async def test_register_else_branch_clears_stale_command_result(
    db_session: AsyncSession,
) -> None:
    """else 分支：心跳落了结果后 daemon 重启 register → 置 NULL（清除上一进程遗留，
    design §7.5 register 行恒清）。"""
    user, _token = await _seed_user(db_session, name="reg-u2")
    user_id = user.id
    daemon_local_id = await _register_daemon(db_session, user_id)
    svc = RuntimeService(db_session)

    await svc.heartbeat_daemon(daemon_local_id, sillyspec_command_result=dict(_RESULT_GHOST_FAILED))
    assert (
        await _reload_instance(db_session, daemon_local_id)
    ).sillyspec_command_result is not None

    await svc.register_daemon(
        user_id,
        daemon_local_id=daemon_local_id,
        server_url="http://localhost:8001",
        hostname="sscmd-host",
        providers=[{"provider": "claude", "status": "online", "version": "1.0"}],
    )
    assert (await _reload_instance(db_session, daemon_local_id)).sillyspec_command_result is None


# ── HTTP 全链路：心跳 DTO 接收新字段并落库（缺省与显式 null 同置 NULL）────────


@pytest.mark.asyncio
async def test_http_heartbeat_accepts_and_clears_command_result(
    db_session: AsyncSession,
    client: AsyncClient,
) -> None:
    """HTTP 全链路：带对象 → DTO model_dump 落库（七键齐、无 since）；显式 null 与
    缺省（旧 daemon 无该键）→ 同置 NULL（pydantic 缺省与显式 null 不可区分）。"""
    owner, token = await _seed_user(db_session, name="hb-http-owner")
    daemon_local_id = await _register_daemon(db_session, owner.id)
    headers = _headers(token)

    resp = await client.post(
        "/api/daemon/heartbeat",
        json={
            "daemon_local_id": str(daemon_local_id),
            "sillyspec_command_result": _RESULT_RESOLVE_SUCCESS,
        },
        headers=headers,
    )
    assert resp.status_code == 200, resp.text
    row = await _reload_instance(db_session, daemon_local_id)
    assert row.sillyspec_command_result is not None
    assert set(row.sillyspec_command_result) == _COMMAND_RESULT_KEYS
    assert row.sillyspec_command_result == _RESULT_RESOLVE_SUCCESS
    assert "since" not in row.sillyspec_command_result

    # 显式 null → 置 NULL。
    resp2 = await client.post(
        "/api/daemon/heartbeat",
        json={"daemon_local_id": str(daemon_local_id), "sillyspec_command_result": None},
        headers=headers,
    )
    assert resp2.status_code == 200, resp2.text
    assert (await _reload_instance(db_session, daemon_local_id)).sillyspec_command_result is None

    # 再写一次后缺省（旧 daemon 无该键）→ 同置 NULL（区别于兄弟字段保留语义）。
    resp3 = await client.post(
        "/api/daemon/heartbeat",
        json={
            "daemon_local_id": str(daemon_local_id),
            "sillyspec_command_result": _RESULT_GHOST_FAILED,
        },
        headers=headers,
    )
    assert resp3.status_code == 200, resp3.text
    assert (
        await _reload_instance(db_session, daemon_local_id)
    ).sillyspec_command_result is not None

    resp4 = await client.post(
        "/api/daemon/heartbeat",
        json={"daemon_local_id": str(daemon_local_id)},
        headers=headers,
    )
    assert resp4.status_code == 200, resp4.text
    assert (await _reload_instance(db_session, daemon_local_id)).sillyspec_command_result is None


# ── GET /machines 透出（MachineSillySpecCommandResultRead 嵌套类型化七键形态）──


@pytest.mark.asyncio
async def test_machines_view_exposes_command_result_typed(
    client: AsyncClient,
    db_session: AsyncSession,
) -> None:
    """FR-05：GET /machines items[] 含 sillyspec_command_result——上报机为嵌套类型化
    七键形态（非裸 dict 透传）；NULL 机（终态窗口过期 / register 恒清）为 null。"""
    admin, token = await _seed_user(db_session, name="view-admin", is_platform_admin=True)
    await _create_machine(
        db_session,
        admin.id,
        hostname="sscmd-view-host",
        sillyspec_command_result=_RESULT_RESOLVE_SUCCESS,
    )
    await _create_machine(db_session, admin.id, hostname="sscmd-legacy-host")

    resp = await client.get("/api/daemon/machines", headers=_headers(token))
    assert resp.status_code == 200, resp.text
    items = {it["hostname"]: it for it in resp.json()["items"]}

    result = items["sscmd-view-host"]["sillyspec_command_result"]
    assert set(result) == _COMMAND_RESULT_KEYS
    assert result["action"] == "resolve"
    assert result["change"] == "2026-09-02-changes-overview-card"
    assert result["strategy"] == "keep_local"
    assert result["state"] == "success"
    assert result["exit_code"] == 0
    assert result["error"] is None
    assert result["executed_at"] == "2026-09-04T13:20:00+08:00"

    assert items["sscmd-legacy-host"]["sillyspec_command_result"] is None


def test_openapi_contains_endpoints_and_command_result_refs() -> None:
    """验收：OpenAPI 含两端点路径 + sillyspec_command_result 双引用（读视图
    MachineSillySpecCommandResultRead / 心跳载荷 DaemonHeartbeatSillySpecCommandResult，
    task-08 gen:types 的输入可再生产）。app.openapi() 直出（同源 dump_openapi.py）。"""
    from app.main import app

    spec = app.openapi()
    assert "/api/daemon/machines/{instance_id}/sillyspec-resolve" in spec["paths"]
    assert "/api/daemon/machines/{instance_id}/sillyspec-ghost-cleanup" in spec["paths"]

    machine_schema = spec["components"]["schemas"]["DaemonMachineReadWithPending"]
    assert "sillyspec_command_result" in machine_schema["properties"]
    assert (
        machine_schema["properties"]["sillyspec_command_result"]["anyOf"][0]["$ref"]
        == "#/components/schemas/MachineSillySpecCommandResultRead"
    )
    # 心跳载荷模型同入 components（DaemonHeartbeatRequest 引用链完整）。
    assert "DaemonHeartbeatSillySpecCommandResult" in spec["components"]["schemas"]
    assert "MachineSillySpecCommandResultRead" in spec["components"]["schemas"]
