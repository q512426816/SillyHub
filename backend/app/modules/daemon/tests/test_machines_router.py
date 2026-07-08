"""``/api/daemon/machines`` 三端点全维度单测 + 既有 daemon 端点回归冒烟。

变更 ``2026-07-07-daemon-machine-runtime-hierarchy`` task-04。
覆盖 FR-1 / FR-2 / FR-3 / FR-8 + D-001 / D-002 / D-003 / D-007：

- GET /machines：机器级分页（D-007）、``q``/``status``/``provider``/``user_id`` 筛选、
  online 优先 → last_heartbeat_at DESC 排序、admin 全局 / 普通用户仅自己、派生字段
  ``runtime_count``/``online_runtime_count``、0-runtime 机器边界（D-003）。
- PATCH /machines/{id}：display_alias set/clear/省略、越权→404、不存在→404、0-runtime
  机器可改（D-001）。
- POST /machines/{id}/self-update：路由正确（mock ws_hub）、离线/失败→504、越权/不存在→404。
- 既有端点回归冒烟（FR-8）：``/runtimes/page``、``/runtimes``、``/instances``、
  ``PATCH /runtimes/{id}``、``PUT /runtimes/{id}/allowed-roots``、
  ``POST /runtimes/{id}/self-update`` 行为不破。

helper 风格与 ``test_runtime_admin_management.py`` 对齐（私有复刻同款 helper，不新建
conftest）。ws_hub 注入受控 hub 仿 ``test_ws_rpc.py`` 的 ``fresh_ws_hub`` + monkeypatch
``DaemonWsHub.send_self_update``。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import Role, RolePermission, User
from app.modules.auth.permissions import Permission
from app.modules.daemon import ws_hub as ws_hub_module
from app.modules.daemon.model import DaemonInstance, DaemonRuntime
from app.modules.daemon.ws_hub import DaemonWsHub

# ── helpers（私有复刻 test_runtime_admin_management.py 同款风格）─────────────


async def _create_user(
    session: AsyncSession,
    *,
    is_platform_admin: bool = False,
    email: str | None = None,
    display_name: str | None = None,
) -> User:
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=email or f"user-{uid}@example.com",
        password_hash="irrelevant",
        display_name=display_name or f"User-{str(uid)[:4]}",
        status="active",
        is_platform_admin=is_platform_admin,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


def _token_for(user: User) -> str:
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=settings,
    )
    return token


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _grant_platform_permission(
    session: AsyncSession, user_id: uuid.UUID, permission: Permission
) -> None:
    """授予平台级权限（复刻 test_runtime_admin_management.py:79 同款做法）。"""
    from app.modules.admin.model import UserRole

    role = Role(
        id=uuid.uuid4(),
        key=f"test-plat-{permission.value}-{uuid.uuid4().hex[:6]}",
        name=f"test {permission.value}",
    )
    session.add(role)
    await session.flush()
    session.add(RolePermission(role_id=role.id, permission=permission.value))
    session.add(UserRole(user_id=user_id, role_id=role.id))
    await session.commit()


async def _bootstrap(
    session: AsyncSession,
) -> tuple[User, User, User]:
    """(platform_admin, normal_a, normal_b)。

    两个普通用户都拿到 RUNTIME_ADMIN 平台权限，以便测试断言的是 owner 归属而非 403。
    """
    admin = await _create_user(
        session,
        is_platform_admin=True,
        email="machine-admin@example.com",
        display_name="MAdmin",
    )
    user_a = await _create_user(session, email="machine-a@example.com", display_name="Mach A")
    user_b = await _create_user(session, email="machine-b@example.com", display_name="Mach B")
    await _grant_platform_permission(session, user_a.id, Permission.RUNTIME_ADMIN)
    await _grant_platform_permission(session, user_b.id, Permission.RUNTIME_ADMIN)
    return admin, user_a, user_b


async def _create_instance(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    hostname: str = "host-x",
    status: str = "online",
    display_alias: str | None = None,
    last_heartbeat_at: datetime | None = None,
) -> DaemonInstance:
    inst = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname=hostname,
        server_url="http://localhost:8001",
        status=status,
        display_alias=display_alias,
        last_heartbeat_at=last_heartbeat_at or datetime.now(UTC),
    )
    session.add(inst)
    await session.commit()
    await session.refresh(inst)
    return inst


async def _create_runtime(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    name: str = "rt-x",
    provider: str = "claude",
    status: str = "online",
    version: str | None = None,
    allowed_roots: list[str] | None = None,
    daemon_instance_id: uuid.UUID | None = None,
    last_heartbeat_at: datetime | None = None,
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name=name,
        provider=provider,
        status=status,
        version=version,
        allowed_roots=allowed_roots,
        daemon_instance_id=daemon_instance_id,
        last_heartbeat_at=last_heartbeat_at or datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


@pytest.fixture()
def fresh_ws_hub(monkeypatch: pytest.MonkeyPatch) -> DaemonWsHub:
    """用全新 DaemonWsHub 替换进程级单例（仿 test_ws_rpc.py:328）。"""
    hub = DaemonWsHub()
    monkeypatch.setattr(ws_hub_module, "_ws_hub", hub)
    return hub


# ── GET /machines ────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_machines_pagination_total_not_equal_page_size(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """FR-1 / D-007：机器级分页。造 >limit 台机器，total != len(items)，翻页连续。"""
    admin, user_a, _ = await _bootstrap(db_session)
    # 3 台机器，limit=2 验证翻页（total=3, page0=2, page1=1）。
    for i in range(3):
        suffix = f"-{i:02d}"
        inst = await _create_instance(db_session, user_a.id, hostname=f"pag{suffix}")
        await _create_runtime(db_session, user_a.id, name=f"rt{suffix}", daemon_instance_id=inst.id)

    resp = await client.get(
        "/api/daemon/machines?limit=2&offset=0", headers=_headers(_token_for(admin))
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 3
    assert body["limit"] == 2
    assert body["offset"] == 0
    assert len(body["items"]) == 2

    resp2 = await client.get(
        "/api/daemon/machines?limit=2&offset=2", headers=_headers(_token_for(admin))
    )
    body2 = resp2.json()
    assert body2["total"] == 3
    assert len(body2["items"]) == 1
    # 两页 id 无重叠
    ids_p0 = {it["id"] for it in body["items"]}
    ids_p1 = {it["id"] for it in body2["items"]}
    assert ids_p0.isdisjoint(ids_p1)


@pytest.mark.asyncio
async def test_machines_q_filter_matches_hostname_alias_provider(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """FR-1 / D-002：``q`` 大小写不敏感 ILIKE 命中 hostname / display_alias / 子 runtime provider。"""
    admin, user_a, _ = await _bootstrap(db_session)
    # hostname 含 UNIQUE_HOST
    inst_h = await _create_instance(db_session, user_a.id, hostname="alpha-host-xyz")
    await _create_runtime(db_session, user_a.id, provider="claude", daemon_instance_id=inst_h.id)
    # display_alias 含 UNIQUE_ALIAS
    inst_a = await _create_instance(
        db_session, user_a.id, hostname="bravo-host", display_alias="生产机-xyz-别名"
    )
    await _create_runtime(db_session, user_a.id, provider="codex", daemon_instance_id=inst_a.id)
    # 子 runtime provider 含 UNIQUE_PROVIDER（unique slug 避免命中其他用例 noise）
    inst_p = await _create_instance(db_session, user_a.id, hostname="charlie-host")
    await _create_runtime(
        db_session, user_a.id, provider="unique-prov-xyz", daemon_instance_id=inst_p.id
    )
    # 一台完全不命中的机器
    inst_n = await _create_instance(db_session, user_a.id, hostname="delta-quiet")
    await _create_runtime(db_session, user_a.id, provider="claude", daemon_instance_id=inst_n.id)

    # 大写 q 命中 hostname（ILIKE 大小写不敏感）
    resp = await client.get(
        "/api/daemon/machines?q=ALPHA-HOST-XYZ", headers=_headers(_token_for(admin))
    )
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["hostname"] == "alpha-host-xyz"

    # q 命中 display_alias
    resp = await client.get(
        "/api/daemon/machines?q=生产机-xyz", headers=_headers(_token_for(admin))
    )
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["hostname"] == "bravo-host"

    # q 命中子 runtime provider
    resp = await client.get(
        "/api/daemon/machines?q=UNIQUE-PROV", headers=_headers(_token_for(admin))
    )
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["hostname"] == "charlie-host"


@pytest.mark.asyncio
async def test_machines_status_exact_match(client: AsyncClient, db_session: AsyncSession) -> None:
    """FR-1 / D-002：``status`` 精确匹配 ``daemon_instance.status``。"""
    admin, user_a, _ = await _bootstrap(db_session)
    inst_online = await _create_instance(
        db_session, user_a.id, hostname="h-online", status="online"
    )
    await _create_runtime(db_session, user_a.id, daemon_instance_id=inst_online.id)
    inst_offline = await _create_instance(
        db_session, user_a.id, hostname="h-offline", status="offline"
    )
    await _create_runtime(db_session, user_a.id, daemon_instance_id=inst_offline.id)

    resp = await client.get(
        "/api/daemon/machines?status=offline", headers=_headers(_token_for(admin))
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["status"] == "offline"


@pytest.mark.asyncio
async def test_machines_provider_exists_subquery(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """FR-1：``provider`` 筛选 = 含该 provider 的机器（EXISTS 子查询）。"""
    admin, user_a, _ = await _bootstrap(db_session)
    # 含 codex
    inst_codex = await _create_instance(db_session, user_a.id, hostname="has-codex")
    await _create_runtime(db_session, user_a.id, provider="codex", daemon_instance_id=inst_codex.id)
    # 仅 claude
    inst_claude = await _create_instance(db_session, user_a.id, hostname="only-claude")
    await _create_runtime(
        db_session, user_a.id, provider="claude", daemon_instance_id=inst_claude.id
    )

    resp = await client.get(
        "/api/daemon/machines?provider=codex", headers=_headers(_token_for(admin))
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    hostnames = {it["hostname"] for it in body["items"]}
    assert hostnames == {"has-codex"}


@pytest.mark.asyncio
async def test_machines_user_id_admin_filters_by_owner(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """FR-1：admin 按 ``user_id`` 精确过滤 owner。"""
    admin, user_a, user_b = await _bootstrap(db_session)
    inst_a = await _create_instance(db_session, user_a.id, hostname="owner-a")
    await _create_runtime(db_session, user_a.id, daemon_instance_id=inst_a.id)
    inst_b = await _create_instance(db_session, user_b.id, hostname="owner-b")
    await _create_runtime(db_session, user_b.id, daemon_instance_id=inst_b.id)

    resp = await client.get(
        f"/api/daemon/machines?user_id={user_b.id}", headers=_headers(_token_for(admin))
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    hostnames = {it["hostname"] for it in body["items"]}
    assert hostnames == {"owner-b"}


@pytest.mark.asyncio
async def test_machines_sort_online_first_then_heartbeat_desc(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """FR-1 / D-002：排序 online 优先 → last_heartbeat_at DESC。"""
    admin, user_a, _ = await _bootstrap(db_session)
    now = datetime.now(UTC)
    # offline 但心跳最新（应排在所有 online 之后）
    inst_off_fresh = await _create_instance(
        db_session,
        user_a.id,
        hostname="off-fresh",
        status="offline",
        last_heartbeat_at=now,
    )
    await _create_runtime(db_session, user_a.id, daemon_instance_id=inst_off_fresh.id)
    # online 心跳较旧
    inst_on_old = await _create_instance(
        db_session,
        user_a.id,
        hostname="on-old",
        status="online",
        # <45s：cleanup_stale_runtimes（list_machines 进入先收敛 stale）不会改 offline；
        # 仍比 on-new(now-1s) 旧，用于验证 online 组内 last_heartbeat_at DESC。
        last_heartbeat_at=now - timedelta(seconds=30),
    )
    await _create_runtime(db_session, user_a.id, daemon_instance_id=inst_on_old.id)
    # online 心跳最新（应排第一）
    inst_on_new = await _create_instance(
        db_session,
        user_a.id,
        hostname="on-new",
        status="online",
        last_heartbeat_at=now - timedelta(seconds=1),
    )
    await _create_runtime(db_session, user_a.id, daemon_instance_id=inst_on_new.id)

    resp = await client.get("/api/daemon/machines?limit=10", headers=_headers(_token_for(admin)))
    assert resp.status_code == 200, resp.text
    hostnames = [it["hostname"] for it in resp.json()["items"]]
    # online 两台在前（new 在 old 前），offline 在最后
    assert hostnames == ["on-new", "on-old", "off-fresh"]


@pytest.mark.asyncio
async def test_machines_normal_user_scoped_to_self_user_id_ignored(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """FR-1：普通用户仅见自己；请求 ``user_id`` 被忽略，scope 不放大（区别于 403）。"""
    _admin, user_a, user_b = await _bootstrap(db_session)
    inst_a = await _create_instance(db_session, user_a.id, hostname="self-owner")
    await _create_runtime(db_session, user_a.id, daemon_instance_id=inst_a.id)
    inst_b = await _create_instance(db_session, user_b.id, hostname="other-owner")
    await _create_runtime(db_session, user_b.id, daemon_instance_id=inst_b.id)

    # user_a 传 user_b 的 user_id，仍只应看到自己的机器
    resp = await client.get(
        f"/api/daemon/machines?user_id={user_b.id}", headers=_headers(_token_for(user_a))
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    hostnames = {it["hostname"] for it in body["items"]}
    assert hostnames == {"self-owner"}, "普通用户 user_id 不得放大 scope"


@pytest.mark.asyncio
async def test_machines_derived_fields_runtime_count_online_count_nested_runtimes(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """FR-1：派生字段 ``runtime_count`` / ``online_runtime_count`` + 嵌套 ``runtimes[]``
    含 provider / version / allowed_roots。"""
    admin, user_a, _ = await _bootstrap(db_session)
    inst = await _create_instance(db_session, user_a.id, hostname="rich-host")
    await _create_runtime(
        db_session,
        user_a.id,
        provider="claude",
        status="online",
        version="1.2.3",
        allowed_roots=["/home/a", "/tmp/b"],
        daemon_instance_id=inst.id,
    )
    await _create_runtime(
        db_session,
        user_a.id,
        provider="codex",
        status="offline",
        version="2.0.0",
        daemon_instance_id=inst.id,
    )

    resp = await client.get("/api/daemon/machines", headers=_headers(_token_for(admin)))
    assert resp.status_code == 200, resp.text
    items = {it["hostname"]: it for it in resp.json()["items"]}
    machine = items["rich-host"]
    assert machine["runtime_count"] == 2
    assert machine["online_runtime_count"] == 1
    providers = sorted(r["provider"] for r in machine["runtimes"])
    assert providers == ["claude", "codex"]
    # 嵌套 runtime 含 version / allowed_roots
    by_prov = {r["provider"]: r for r in machine["runtimes"]}
    assert by_prov["claude"]["version"] == "1.2.3"
    assert by_prov["claude"]["allowed_roots"] == ["/home/a", "/tmp/b"]


@pytest.mark.asyncio
async def test_machines_zero_runtime_machine_returns_empty_runtimes(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """FR-1 / D-003：0-runtime 机器返回 ``runtimes=[]`` + 计数 0。"""
    admin, user_a, _ = await _bootstrap(db_session)
    await _create_instance(db_session, user_a.id, hostname="bare-host")

    resp = await client.get("/api/daemon/machines", headers=_headers(_token_for(admin)))
    assert resp.status_code == 200, resp.text
    items = {it["hostname"]: it for it in resp.json()["items"]}
    machine = items["bare-host"]
    assert machine["runtime_count"] == 0
    assert machine["online_runtime_count"] == 0
    assert machine["runtimes"] == []


# ── PATCH /machines/{instance_id} ────────────────────────────────────────────


@pytest.mark.asyncio
async def test_patch_machine_display_alias_set_stripped(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """FR-2 / D-001：正常更新 display_alias（strip 去空格）。"""
    admin, user_a, _ = await _bootstrap(db_session)
    inst = await _create_instance(db_session, user_a.id, hostname="alias-host")

    resp = await client.patch(
        f"/api/daemon/machines/{inst.id}",
        json={"display_alias": "  生产机器-01  "},
        headers=_headers(_token_for(admin)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["display_alias"] == "生产机器-01"
    # ⚠️ db_session 与 router session 不同对象，refresh 读 DB 最新值
    refreshed = await db_session.get(DaemonInstance, inst.id)
    assert refreshed is not None
    await db_session.refresh(refreshed)
    assert refreshed.display_alias == "生产机器-01"


@pytest.mark.asyncio
async def test_patch_machine_display_alias_null_clears(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """FR-2 / D-001：显式 null 清空 display_alias。"""
    admin, user_a, _ = await _bootstrap(db_session)
    inst = await _create_instance(
        db_session, user_a.id, hostname="clear-host", display_alias="原别名"
    )

    resp = await client.patch(
        f"/api/daemon/machines/{inst.id}",
        json={"display_alias": None},
        headers=_headers(_token_for(admin)),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["display_alias"] is None
    refreshed = await db_session.get(DaemonInstance, inst.id)
    assert refreshed is not None
    await db_session.refresh(refreshed)
    assert refreshed.display_alias is None


@pytest.mark.asyncio
async def test_patch_machine_display_alias_omitted_unchanged(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """FR-2 / D-001：body 省略 display_alias = 不变。"""
    admin, user_a, _ = await _bootstrap(db_session)
    inst = await _create_instance(
        db_session, user_a.id, hostname="keep-host", display_alias="保留别名"
    )

    resp = await client.patch(
        f"/api/daemon/machines/{inst.id}",
        json={},
        headers=_headers(_token_for(admin)),
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["display_alias"] == "保留别名"
    refreshed = await db_session.get(DaemonInstance, inst.id)
    assert refreshed is not None
    await db_session.refresh(refreshed)
    assert refreshed.display_alias == "保留别名"


@pytest.mark.asyncio
async def test_patch_machine_cross_owner_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """FR-2 / D-001：普通用户改他人机器 → 404（_get_owned_instance 越权合并 404，
    不区分不存在与无权，避免存在性泄漏）。"""
    _admin, user_a, user_b = await _bootstrap(db_session)
    inst = await _create_instance(db_session, user_b.id, hostname="victim-host")

    resp = await client.patch(
        f"/api/daemon/machines/{inst.id}",
        json={"display_alias": "hijack"},
        headers=_headers(_token_for(user_a)),
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "HTTP_404_DAEMON_RUNTIME_NOT_FOUND"


@pytest.mark.asyncio
async def test_patch_machine_nonexistent_instance_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """FR-2：不存在 instance_id → 404。"""
    admin, _u_a, _u_b = await _bootstrap(db_session)
    bogus = uuid.uuid4()

    resp = await client.patch(
        f"/api/daemon/machines/{bogus}",
        json={"display_alias": "x"},
        headers=_headers(_token_for(admin)),
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "HTTP_404_DAEMON_RUNTIME_NOT_FOUND"


@pytest.mark.asyncio
async def test_patch_machine_zero_runtime_machine_alias_works(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """FR-2 / D-001：0-runtime 机器亦可改别名（区别于 runtime 级 PATCH 需先有 runtime）。"""
    admin, user_a, _ = await _bootstrap(db_session)
    inst = await _create_instance(db_session, user_a.id, hostname="bare-patch-host")
    # 不挂任何 runtime

    resp = await client.patch(
        f"/api/daemon/machines/{inst.id}",
        json={"display_alias": "空机器别名"},
        headers=_headers(_token_for(admin)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["display_alias"] == "空机器别名"
    assert body["runtime_count"] == 0
    assert body["runtimes"] == []


# ── POST /machines/{instance_id}/self-update ─────────────────────────────────


@pytest.mark.asyncio
async def test_machine_self_update_routes_to_ws_hub(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """FR-3：mock ws_hub，``send_self_update`` 返回 True，断言响应 shape + 调用参数含
    instance_id。"""
    admin, user_a, _ = await _bootstrap(db_session)
    inst = await _create_instance(db_session, user_a.id, hostname="su-host")
    await _create_runtime(db_session, user_a.id, daemon_instance_id=inst.id)

    captured: dict[str, Any] = {}

    async def _fake_send_self_update(
        self_hub: DaemonWsHub,
        daemon_id: uuid.UUID,
        version: str | None = None,
    ) -> bool:
        captured["daemon_id"] = daemon_id
        captured["version"] = version
        return True

    monkeypatch.setattr(DaemonWsHub, "send_self_update", _fake_send_self_update)

    resp = await client.post(
        f"/api/daemon/machines/{inst.id}/self-update", headers=_headers(_token_for(admin))
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["sent"] is True
    assert isinstance(body["latest_version"], str)
    # 机器级直接以 instance_id 作 daemon_id 路由（router.py:779）。
    assert captured["daemon_id"] == inst.id


@pytest.mark.asyncio
async def test_machine_self_update_offline_or_send_fail_returns_504(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """FR-3：离线 / 发送失败 → 504 DaemonRuntimeOffline。"""
    admin, user_a, _ = await _bootstrap(db_session)
    inst = await _create_instance(db_session, user_a.id, hostname="offline-su-host")

    async def _always_false(
        self_hub: DaemonWsHub,
        daemon_id: uuid.UUID,
        version: str | None = None,
    ) -> bool:
        return False

    monkeypatch.setattr(DaemonWsHub, "send_self_update", _always_false)

    resp = await client.post(
        f"/api/daemon/machines/{inst.id}/self-update", headers=_headers(_token_for(admin))
    )
    assert resp.status_code == 504, resp.text


@pytest.mark.asyncio
async def test_machine_self_update_cross_owner_returns_404(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
) -> None:
    """FR-3：越权 → 404（_get_owned_instance，与 PATCH 同）。"""
    _admin, user_a, user_b = await _bootstrap(db_session)
    inst = await _create_instance(db_session, user_b.id, hostname="other-su-host")

    resp = await client.post(
        f"/api/daemon/machines/{inst.id}/self-update", headers=_headers(_token_for(user_a))
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "HTTP_404_DAEMON_RUNTIME_NOT_FOUND"


@pytest.mark.asyncio
async def test_machine_self_update_nonexistent_returns_404(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
) -> None:
    """FR-3：不存在 instance_id → 404。"""
    admin, _u_a, _u_b = await _bootstrap(db_session)

    resp = await client.post(
        f"/api/daemon/machines/{uuid.uuid4()}/self-update",
        headers=_headers(_token_for(admin)),
    )
    assert resp.status_code == 404, resp.text


# ── 既有端点回归冒烟（FR-8，只确认 200 + shape，不断言全量）────────────────


@pytest.mark.asyncio
async def test_regression_runtimes_page_shape(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """FR-8：GET /runtimes/page 不破（shape + 200）。"""
    admin, user_a, _ = await _bootstrap(db_session)
    await _create_runtime(db_session, user_a.id, name="reg-rt")

    resp = await client.get(
        "/api/daemon/runtimes/page?limit=10&offset=0", headers=_headers(_token_for(admin))
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert {"items", "total", "limit", "offset"} <= set(body.keys())


@pytest.mark.asyncio
async def test_regression_runtimes_array_shape(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """FR-8：GET /runtimes 保持数组 shape。"""
    admin, user_a, _ = await _bootstrap(db_session)
    await _create_runtime(db_session, user_a.id, name="reg-arr-rt")

    resp = await client.get("/api/daemon/runtimes", headers=_headers(_token_for(admin)))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert isinstance(body, list)
    assert all("id" in item for item in body)


@pytest.mark.asyncio
async def test_regression_instances_shape(client: AsyncClient, db_session: AsyncSession) -> None:
    """FR-8：GET /instances 不破（数组 + 含 id/hostname）。"""
    admin, _u_a, _u_b = await _bootstrap(db_session)

    resp = await client.get("/api/daemon/instances", headers=_headers(_token_for(admin)))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert isinstance(body, list)
    assert all("id" in item and "hostname" in item for item in body)


@pytest.mark.asyncio
async def test_regression_patch_runtime_display_alias(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """FR-8：PATCH /runtimes/{id} 不破（display_alias 写到 daemon_instance）。"""
    admin, user_a, _ = await _bootstrap(db_session)
    inst = await _create_instance(db_session, user_a.id, hostname="reg-patch-host")
    rt = await _create_runtime(db_session, user_a.id, daemon_instance_id=inst.id)

    resp = await client.patch(
        f"/api/daemon/runtimes/{rt.id}",
        json={"display_alias": "reg-alias"},
        headers=_headers(_token_for(admin)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == str(rt.id)


@pytest.mark.asyncio
async def test_regression_put_runtime_allowed_roots(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
) -> None:
    """FR-8：PUT /runtimes/{id}/allowed-roots 不破（写入 + best-effort WS push 不阻断）。"""
    admin, user_a, _ = await _bootstrap(db_session)
    inst = await _create_instance(db_session, user_a.id, hostname="reg-roots-host")
    rt = await _create_runtime(db_session, user_a.id, daemon_instance_id=inst.id)

    resp = await client.put(
        f"/api/daemon/runtimes/{rt.id}/allowed-roots",
        json={"allowed_roots": ["/tmp/x"]},
        headers=_headers(_token_for(admin)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["id"] == str(rt.id)


@pytest.mark.asyncio
async def test_regression_runtime_self_update(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """FR-8：POST /runtimes/{id}/self-update 不破（路由 + sent=True）。"""
    admin, user_a, _ = await _bootstrap(db_session)
    inst = await _create_instance(db_session, user_a.id, hostname="reg-rt-su-host")
    rt = await _create_runtime(db_session, user_a.id, daemon_instance_id=inst.id)

    async def _ok(
        self_hub: DaemonWsHub,
        daemon_id: uuid.UUID,
        version: str | None = None,
    ) -> bool:
        return True

    monkeypatch.setattr(DaemonWsHub, "send_self_update", _ok)

    resp = await client.post(
        f"/api/daemon/runtimes/{rt.id}/self-update", headers=_headers(_token_for(admin))
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["sent"] is True
    assert isinstance(body["latest_version"], str)
