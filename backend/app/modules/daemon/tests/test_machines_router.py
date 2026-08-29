"""``/api/daemon/machines`` 三端点全维度单测 + 既有 daemon 端点回归冒烟。

变更 ``2026-07-07-daemon-machine-runtime-hierarchy`` task-04。
覆盖 FR-1 / FR-2 / FR-3 / FR-8 + D-001 / D-002 / D-003 / D-007：

- GET /machines：机器级分页（D-007）、``q``/``status``/``provider``/``user_id`` 筛选、
  online 优先 → last_heartbeat_at DESC 排序、admin 全局 / 普通用户仅自己、派生字段
  ``runtime_count``/``online_runtime_count``、0-runtime 机器边界（D-003）。
- PATCH /machines/{id}：display_alias set/clear/省略、越权→404、不存在→404、0-runtime
  机器可改（D-001）。
- POST /machines/{id}/self-update：路由正确（mock ws_hub）、离线/失败→504、越权/不存在→404。
- shared_to_me 共享区块（2026-08-28-daemon-agent-share task-07 / design §5 Phase 2.2）：
  ``/machines`` 与 ``/runtimes/page`` 附加「共享给我的」机器块（成员+daemon:borrow
  双条件授权（D-013@v1）、在线/离线透传、五字段装配、不混入 items）；无授权/
  停用 grant/成员无 borrow 权限空数组；admin 视图 items 全局且块空；
  grants router 挂载冒烟（active 200/401、管理端 200/403）。task-13：行附加
  ``runtimes`` 明细（runtime_id/provider/online，多 provider/离线/0-runtime 空）。
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
from sqlmodel import col, select

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.agent.model import AgentRun, DaemonBorrowAudit
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.daemon import ws_hub as ws_hub_module
from app.modules.daemon.grants.model import DaemonRuntimeGrant
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease
from app.modules.daemon.ws_hub import DaemonWsHub
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
from app.modules.workspace.model import Workspace

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
    started_at: datetime | None = None,
) -> DaemonInstance:
    inst = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname=hostname,
        server_url="http://localhost:8001",
        status=status,
        display_alias=display_alias,
        last_heartbeat_at=last_heartbeat_at or datetime.now(UTC),
        # 2026-08-05-daemon-start-time task-06：仿 daemon_version 参数模式，
        # 默认 None（旧 daemon），测试显式传值时落库。
        started_at=started_at,
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


# ── shared_to_me 装配 helpers（2026-08-28-daemon-agent-share task-07）─────────
# 范式照 grants/tests/test_grants_authorization.py 的 _seed_* 系列（本文件不共享
# conftest，就近私有复刻最小三件：workspace / 成员资格 / grant 行）。


async def _create_workspace(session: AsyncSession, *, name: str = "共享工作区") -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=name,
        slug=f"ws-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/ws-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _add_workspace_member(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    permissions: list[str] | None = None,
) -> None:
    """把用户加进工作区（默认角色带 daemon:borrow——shared_to_me 是「成员资格 +
    daemon:borrow」双条件判定源，D-013@v1 验收审查 gap-1 后权限位参与过滤；
    传 ``permissions`` 显式控制，如仅 WORKSPACE_READ 构造「成员无权限」负例）。"""
    role = Role(id=uuid.uuid4(), key=f"test-ws-member-{uuid.uuid4().hex[:6]}", name="member")
    session.add(role)
    await session.flush()
    for p in permissions if permissions is not None else [Permission.DAEMON_BORROW.value]:
        session.add(RolePermission(role_id=role.id, permission=p))
    session.add(
        UserWorkspaceRole(
            user_id=user_id,
            workspace_id=workspace_id,
            role_id=role.id,
            granted_by=None,
            granted_at=datetime.now(UTC),
        )
    )
    await session.commit()


async def _create_grant(
    session: AsyncSession,
    *,
    daemon_id: uuid.UUID,
    granted_by: uuid.UUID,
    grantee_id: uuid.UUID,
    enabled: bool = True,
) -> DaemonRuntimeGrant:
    """workspace 级共享授权行（grantee_id=工作区，lender=granted_by）。"""
    grant = DaemonRuntimeGrant(
        id=uuid.uuid4(),
        daemon_instance_id=daemon_id,
        grantee_type="workspace",
        grantee_id=grantee_id,
        granted_by_user_id=granted_by,
        enabled=enabled,
    )
    session.add(grant)
    await session.commit()
    return grant


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


# ── GET /machines started_at 链路（2026-08-05-daemon-start-time task-06 / FR-02）──


@pytest.mark.asyncio
async def test_machines_started_at_returned_when_reported(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """FR-02 / D-002@v1：daemon 上报 started_at 后 GET machines 返回非 null 等于上报值。"""
    admin, user_a, _ = await _bootstrap(db_session)
    started = datetime.now(UTC) - timedelta(minutes=15)
    inst = await _create_instance(
        db_session, user_a.id, hostname="started-host", started_at=started
    )
    await _create_runtime(db_session, user_a.id, daemon_instance_id=inst.id)

    resp = await client.get("/api/daemon/machines", headers=_headers(_token_for(admin)))
    assert resp.status_code == 200, resp.text
    items = {it["hostname"]: it for it in resp.json()["items"]}
    machine = items["started-host"]
    # 非 null + 等于上报值（HTTP 序列化为 ISO 字符串，解析回 datetime 比较）
    assert machine["started_at"] is not None
    returned = datetime.fromisoformat(machine["started_at"])
    # SQLite aiosqlite 写入 aware datetime 会丢 tz（conftest 已知行为），归一比较：
    returned_utc = returned.replace(tzinfo=UTC) if returned.tzinfo is None else returned
    started_utc = started.replace(tzinfo=UTC) if started.tzinfo is None else started
    assert returned_utc == started_utc


@pytest.mark.asyncio
async def test_machines_started_at_null_for_legacy_daemon(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """FR-02：旧 daemon（不上报 started_at）→ GET machines 返回 None。"""
    admin, user_a, _ = await _bootstrap(db_session)
    # 不传 started_at（默认 None），模拟旧 daemon
    inst = await _create_instance(db_session, user_a.id, hostname="legacy-host")
    await _create_runtime(db_session, user_a.id, daemon_instance_id=inst.id)

    resp = await client.get("/api/daemon/machines", headers=_headers(_token_for(admin)))
    assert resp.status_code == 200, resp.text
    items = {it["hostname"]: it for it in resp.json()["items"]}
    machine = items["legacy-host"]
    assert machine["started_at"] is None


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


# ── POST /machines/{instance_id}/cleanup ──────────────────────────────────────


@pytest.mark.asyncio
async def test_machine_cleanup_routes_to_ws_hub(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """cleanup：mock ws_hub，``send_cleanup`` 返回 True，断言响应 shape + 以
    instance_id 路由（与 self-update 同款）。"""
    admin, user_a, _ = await _bootstrap(db_session)
    inst = await _create_instance(db_session, user_a.id, hostname="cu-host")
    await _create_runtime(db_session, user_a.id, daemon_instance_id=inst.id)

    captured: dict[str, Any] = {}

    async def _fake_send_cleanup(
        self_hub: DaemonWsHub,
        daemon_id: uuid.UUID,
    ) -> bool:
        captured["daemon_id"] = daemon_id
        return True

    monkeypatch.setattr(DaemonWsHub, "send_cleanup", _fake_send_cleanup)

    resp = await client.post(
        f"/api/daemon/machines/{inst.id}/cleanup", headers=_headers(_token_for(admin))
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body == {"sent": True}
    assert captured["daemon_id"] == inst.id


@pytest.mark.asyncio
async def test_machine_cleanup_offline_or_send_fail_returns_504(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """cleanup：离线 / 发送失败 → 504 DaemonRuntimeOffline。"""
    admin, user_a, _ = await _bootstrap(db_session)
    inst = await _create_instance(db_session, user_a.id, hostname="offline-cu-host")

    async def _always_false(
        self_hub: DaemonWsHub,
        daemon_id: uuid.UUID,
    ) -> bool:
        return False

    monkeypatch.setattr(DaemonWsHub, "send_cleanup", _always_false)

    resp = await client.post(
        f"/api/daemon/machines/{inst.id}/cleanup", headers=_headers(_token_for(admin))
    )
    assert resp.status_code == 504, resp.text


@pytest.mark.asyncio
async def test_machine_cleanup_cross_owner_returns_404(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
) -> None:
    """cleanup：越权 → 404（_get_owned_instance，与 self-update 同）。"""
    _admin, user_a, user_b = await _bootstrap(db_session)
    inst = await _create_instance(db_session, user_b.id, hostname="other-cu-host")

    resp = await client.post(
        f"/api/daemon/machines/{inst.id}/cleanup", headers=_headers(_token_for(user_a))
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "HTTP_404_DAEMON_RUNTIME_NOT_FOUND"


@pytest.mark.asyncio
async def test_machine_cleanup_nonexistent_returns_404(
    client: AsyncClient,
    db_session: AsyncSession,
    fresh_ws_hub: DaemonWsHub,
) -> None:
    """cleanup：不存在 instance_id → 404。"""
    admin, _u_a, _u_b = await _bootstrap(db_session)

    resp = await client.post(
        f"/api/daemon/machines/{uuid.uuid4()}/cleanup",
        headers=_headers(_token_for(admin)),
    )
    assert resp.status_code == 404, resp.text


# ── DELETE /machines/{instance_id}（ql-20260829-006-6a9e 机器级删除）────────────


async def _create_stale_machine(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    hostname: str,
    status: str = "offline",
) -> DaemonInstance:
    """离线且心跳过期（>45s stale 窗口）的机器——delete_machine 可删除态。"""
    return await _create_instance(
        session,
        user_id,
        hostname=hostname,
        status=status,
        last_heartbeat_at=datetime.now(UTC) - timedelta(minutes=10),
    )


@pytest.mark.asyncio
async def test_delete_machine_success_removes_instance(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """删除主路径：离线 + 无引用 → 204 + instance 行消失（级联清 runtimes 为 PG
    生产 FK 保证，SQLite 测试库不启用 FK PRAGMA 不断言）。"""
    admin, user_a, _ = await _bootstrap(db_session)
    inst = await _create_stale_machine(db_session, user_a.id, hostname="del-host")
    inst_id = inst.id
    # 带 1 个 runtime 的真实机器形态（删除不因有 runtime 而受影响）。
    await _create_runtime(db_session, user_a.id, daemon_instance_id=inst.id, status="offline")

    resp = await client.delete(
        f"/api/daemon/machines/{inst_id}", headers=_headers(_token_for(admin))
    )
    assert resp.status_code == 204, resp.text
    # db_session 与 router session 不同对象：expire_all 驱逐 identity-map 缓存，
    # 让 get 走 DB 真查（否则返回创建时缓存的 Python 对象，删了也读得到）；
    # id 须在 expire 前捕获（行已删，事后访问 inst.id 会触发刷新抛 ObjectDeletedError）。
    db_session.expire_all()
    refreshed = await db_session.get(DaemonInstance, inst_id)
    assert refreshed is None
    # 级联清 runtimes 为 PG 生产 FK 保证（ondelete=CASCADE），SQLite 测试库
    # 不启用 FK PRAGMA，不断言 runtime 行删除。


@pytest.mark.asyncio
async def test_delete_machine_fresh_heartbeat_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """心跳守卫：``last_heartbeat_at`` 在 45s 窗口内 → 409（即使 status 已被标
    offline，心跳新鲜即 daemon 还在跑；删了会产生僵尸心跳）。"""
    admin, user_a, _ = await _bootstrap(db_session)
    # status=online + 心跳 now：典型在线机器
    inst_on = await _create_instance(db_session, user_a.id, hostname="hb-on-host")
    # status=offline 但心跳刚到（sweeper 尚未收敛的边缘态）：仍按心跳真值拦
    inst_off = await _create_instance(
        db_session, user_a.id, hostname="hb-off-host", status="offline"
    )

    for inst in (inst_on, inst_off):
        resp = await client.delete(
            f"/api/daemon/machines/{inst.id}", headers=_headers(_token_for(admin))
        )
        assert resp.status_code == 409, resp.text
        body = resp.json()
        assert body["code"] == "HTTP_409_DAEMON_MACHINE_IN_USE"
        assert body["details"]["guard"] == "heartbeat_fresh"


@pytest.mark.asyncio
async def test_delete_machine_cross_owner_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """越权 → 404（_get_owned_instance，与 PATCH/self-update/cleanup 同语义）。"""
    _admin, user_a, user_b = await _bootstrap(db_session)
    inst = await _create_stale_machine(db_session, user_b.id, hostname="victim-del-host")

    resp = await client.delete(
        f"/api/daemon/machines/{inst.id}", headers=_headers(_token_for(user_a))
    )
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "HTTP_404_DAEMON_RUNTIME_NOT_FOUND"


@pytest.mark.asyncio
async def test_delete_machine_nonexistent_returns_404(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """不存在 instance_id → 404。"""
    admin, _u_a, _u_b = await _bootstrap(db_session)

    resp = await client.delete(
        f"/api/daemon/machines/{uuid.uuid4()}", headers=_headers(_token_for(admin))
    )
    assert resp.status_code == 404, resp.text


@pytest.mark.asyncio
async def test_delete_machine_workspace_binding_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """RESTRICT 守卫 ①：workspace_member_runtimes 绑定（daemon_id 直绑或旧
    runtime_id 列）→ 409，提示先解绑。"""
    admin, user_a, _ = await _bootstrap(db_session)
    inst = await _create_stale_machine(db_session, user_a.id, hostname="wmr-host")
    rt = await _create_runtime(db_session, user_a.id, daemon_instance_id=inst.id, status="offline")
    ws = await _create_workspace(db_session)

    # daemon_id 直绑（现行链路）
    db_session.add(
        WorkspaceMemberRuntime(
            workspace_id=ws.id,
            user_id=user_a.id,
            daemon_id=inst.id,
            shared=False,
            root_path="/tmp/wmr-daemon",
            path_source="daemon_client",
        )
    )
    await db_session.commit()

    resp = await client.delete(
        f"/api/daemon/machines/{inst.id}", headers=_headers(_token_for(admin))
    )
    assert resp.status_code == 409, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_409_DAEMON_MACHINE_IN_USE"
    assert body["details"]["workspace_bindings"] == 1

    # 解绑 daemon_id 后改用旧 runtime_id 列遗留绑定 → 同样拦截
    wmr = (
        await db_session.execute(
            select(WorkspaceMemberRuntime).where(
                col(WorkspaceMemberRuntime.workspace_id) == ws.id,
                col(WorkspaceMemberRuntime.user_id) == user_a.id,
            )
        )
    ).scalar_one()
    wmr.daemon_id = None
    wmr.runtime_id = rt.id
    await db_session.commit()

    resp2 = await client.delete(
        f"/api/daemon/machines/{inst.id}", headers=_headers(_token_for(admin))
    )
    assert resp2.status_code == 409, resp2.text
    assert resp2.json()["details"]["workspace_bindings"] == 1


@pytest.mark.asyncio
async def test_delete_machine_grant_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """RESTRICT 守卫 ②：daemon_runtime_grants 行存在（含停用行）→ 409。"""
    admin, user_a, _ = await _bootstrap(db_session)
    inst = await _create_stale_machine(db_session, user_a.id, hostname="grant-host")
    ws = await _create_workspace(db_session)
    await _create_grant(
        db_session,
        daemon_id=inst.id,
        granted_by=user_a.id,
        grantee_id=ws.id,
        enabled=False,  # 停用行同样拦截：行即共享事实，RESTRICT 不区分 enabled
    )

    resp = await client.delete(
        f"/api/daemon/machines/{inst.id}", headers=_headers(_token_for(admin))
    )
    assert resp.status_code == 409, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_409_DAEMON_MACHINE_IN_USE"
    assert body["details"]["grant_rows"] == 1


@pytest.mark.asyncio
async def test_delete_machine_borrow_audit_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """RESTRICT 守卫 ③：daemon_borrow_audit 审计红线 → 409（无解绑路径，不可删）。"""
    admin, user_a, user_b = await _bootstrap(db_session)
    inst = await _create_stale_machine(db_session, user_a.id, hostname="audit-host")
    ws = await _create_workspace(db_session)
    run = AgentRun(agent_type="claude_code", status="completed")
    db_session.add(run)
    await db_session.flush()
    db_session.add(
        DaemonBorrowAudit(
            borrower_user_id=user_b.id,
            lender_user_id=user_a.id,
            daemon_instance_id=inst.id,
            workspace_id=ws.id,
            agent_run_id=run.id,
        )
    )
    await db_session.commit()

    resp = await client.delete(
        f"/api/daemon/machines/{inst.id}", headers=_headers(_token_for(admin))
    )
    assert resp.status_code == 409, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_409_DAEMON_MACHINE_IN_USE"
    assert body["details"]["borrow_audit_rows"] == 1


@pytest.mark.asyncio
async def test_delete_machine_inflight_lease_returns_409(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """in-flight 守卫：本机 runtime 名下 pending/claimed lease → 409（对齐
    delete_runtime 的 D-003@v1 语义，机器级聚合本机全部 runtimes）。"""
    admin, user_a, _ = await _bootstrap(db_session)
    inst = await _create_stale_machine(db_session, user_a.id, hostname="lease-host")
    rt = await _create_runtime(db_session, user_a.id, daemon_instance_id=inst.id, status="offline")
    db_session.add(DaemonTaskLease(id=uuid.uuid4(), runtime_id=rt.id, status="claimed"))
    await db_session.commit()

    resp = await client.delete(
        f"/api/daemon/machines/{inst.id}", headers=_headers(_token_for(admin))
    )
    assert resp.status_code == 409, resp.text
    body = resp.json()
    assert body["code"] == "HTTP_409_DAEMON_MACHINE_IN_USE"
    assert body["details"]["inflight_leases"] == 1


# ── shared_to_me 共享区块（2026-08-28-daemon-agent-share task-07 / design §5 Phase 2.2）──


async def _seed_shared_machine(
    db_session: AsyncSession,
    *,
    lender: User,
    workspace_id: uuid.UUID,
    hostname: str,
    status: str = "online",
    display_alias: str | None = None,
    enabled: bool = True,
) -> DaemonInstance:
    """造一台 lender 机器 + workspace 级 grant（lender 不需自证，grant 行即共享事实）。"""
    inst = await _create_instance(
        db_session, lender.id, hostname=hostname, status=status, display_alias=display_alias
    )
    await _create_grant(
        db_session,
        daemon_id=inst.id,
        granted_by=lender.id,
        grantee_id=workspace_id,
        enabled=enabled,
    )
    return inst


@pytest.mark.asyncio
async def test_machines_shared_to_me_block_fields_passthrough(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """task-07 / FR-01：成员 + 生效 grant → /machines 出现 shared_to_me 块，五字段
    透传（别名优先、lender 显示名、来源工作区、在线/离线如实现状），且不混入 items。"""
    _admin, user_a, user_b = await _bootstrap(db_session)
    ws = await _create_workspace(db_session)
    await _add_workspace_member(db_session, workspace_id=ws.id, user_id=user_a.id)
    # user_a 自己也有一台机器（items 维度），验证共享块与 items 互不混排。
    own = await _create_instance(db_session, user_a.id, hostname="own-host")
    await _create_runtime(db_session, user_a.id, daemon_instance_id=own.id)
    # lender 在线机（带别名）+ 离线机（别名回退 hostname），在线状态如实透传。
    inst_on = await _seed_shared_machine(
        db_session,
        lender=user_b,
        workspace_id=ws.id,
        hostname="lender-online-host",
        display_alias="生产共享机",
    )
    inst_off = await _seed_shared_machine(
        db_session,
        lender=user_b,
        workspace_id=ws.id,
        hostname="lender-offline-host",
        status="offline",
    )
    rt_claude = await _create_runtime(
        db_session, user_b.id, daemon_instance_id=inst_on.id, name="rt-claude"
    )
    rt_codex = await _create_runtime(
        db_session,
        user_b.id,
        daemon_instance_id=inst_on.id,
        name="rt-codex",
        provider="codex",
        status="offline",
    )

    resp = await client.get("/api/daemon/machines", headers=_headers(_token_for(user_a)))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # items 仍只含自己的机器（owner 收窄不变，FR-03 边界）
    assert {it["hostname"] for it in body["items"]} == {"own-host"}
    # shared_to_me 独立成块，两台共享机都在（排序 hostname 升序：offline 在前）
    shared = {row["machine_id"]: row for row in body["shared_to_me"]}
    assert set(shared) == {str(inst_on.id), str(inst_off.id)}
    row_on, row_off = shared[str(inst_on.id)], shared[str(inst_off.id)]
    # 字段透传：display_name 别名优先 / 回退 hostname；lender 显示名；来源工作区；在线态
    assert row_on["display_name"] == "生产共享机"
    assert row_off["display_name"] == "lender-offline-host"
    for row in (row_on, row_off):
        assert row["lender_display_name"] == "Mach B"
        assert row["source_workspace_id"] == str(ws.id)
    assert row_on["online"] is True
    assert row_off["online"] is False
    # task-13：runtime 明细透传——多 provider（provider 升序）+ 离线行如实；
    # 0-runtime 离线机为空列表（会话创建按 runtime 粒度的数据源）。
    assert row_on["runtimes"] == [
        {"runtime_id": str(rt_claude.id), "provider": "claude", "online": True},
        {"runtime_id": str(rt_codex.id), "provider": "codex", "online": False},
    ]
    assert row_off["runtimes"] == []


@pytest.mark.asyncio
async def test_machines_shared_to_me_empty_without_membership_or_enabled(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """task-07：无授权 → shared_to_me 空数组；非成员 / 停用 grant / 成员但无
    daemon:borrow（D-013@v1 双条件）同样不可见。"""
    _admin, user_a, user_b = await _bootstrap(db_session)
    ws = await _create_workspace(db_session)
    # 停用 grant（enabled=False）——行存在但不生效
    inst = await _seed_shared_machine(
        db_session,
        lender=user_b,
        workspace_id=ws.id,
        hostname="disabled-grant-host",
        enabled=False,
    )
    # 另一工作区的生效 grant，但 user_a 非成员
    ws_other = await _create_workspace(db_session, name="别的工作区")
    await _add_workspace_member(db_session, workspace_id=ws_other.id, user_id=user_b.id)
    await _seed_shared_machine(
        db_session, lender=user_b, workspace_id=ws_other.id, hostname="other-ws-host"
    )
    # 第三工作区：user_a 是成员但角色仅 WORKSPACE_READ（无 daemon:borrow，
    # D-013 权限过滤）——生效 grant 仍不可见。
    ws_plain = await _create_workspace(db_session, name="无权限区")
    await _add_workspace_member(
        db_session,
        workspace_id=ws_plain.id,
        user_id=user_a.id,
        permissions=[Permission.WORKSPACE_READ.value],
    )
    await _seed_shared_machine(
        db_session, lender=user_b, workspace_id=ws_plain.id, hostname="no-borrow-perm-host"
    )
    await _create_runtime(db_session, user_b.id, daemon_instance_id=inst.id)
    own = await _create_instance(db_session, user_a.id, hostname="own-quiet-host")
    await _create_runtime(db_session, user_a.id, daemon_instance_id=own.id)

    resp = await client.get("/api/daemon/machines", headers=_headers(_token_for(user_a)))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["shared_to_me"] == []
    # 无共享不放大 items：只有自己的机器
    assert {it["hostname"] for it in body["items"]} == {"own-quiet-host"}


@pytest.mark.asyncio
async def test_machines_admin_view_items_global_shared_block_empty(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """task-07：admin 视图 items 仍全局（含他人机器），非 grantee 成员 → 块为空。"""
    admin, user_a, user_b = await _bootstrap(db_session)
    ws = await _create_workspace(db_session)
    await _add_workspace_member(db_session, workspace_id=ws.id, user_id=user_a.id)
    await _seed_shared_machine(
        db_session, lender=user_b, workspace_id=ws.id, hostname="lender-host"
    )
    own = await _create_instance(db_session, user_a.id, hostname="a-own-host")
    await _create_runtime(db_session, user_a.id, daemon_instance_id=own.id)

    resp = await client.get("/api/daemon/machines", headers=_headers(_token_for(admin)))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # admin 非 grantee 工作区成员 → 共享块为空
    assert body["shared_to_me"] == []
    # items 全局视角不受共享块影响（他人机器仍在 items）
    assert {"lender-host", "a-own-host"} <= {it["hostname"] for it in body["items"]}


@pytest.mark.asyncio
async def test_runtimes_page_shared_to_me_block(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """task-07 / FR-01：/runtimes/page 同样附加 shared_to_me 块（字段透传，items 仍
    只含自己的 runtime——owner 收窄零变化）。"""
    _admin, user_a, user_b = await _bootstrap(db_session)
    ws = await _create_workspace(db_session)
    await _add_workspace_member(db_session, workspace_id=ws.id, user_id=user_a.id)
    inst = await _seed_shared_machine(
        db_session,
        lender=user_b,
        workspace_id=ws.id,
        hostname="page-lender-host",
        display_alias="共享页机",
    )
    lender_rt = await _create_runtime(
        db_session, user_b.id, name="lender-rt", daemon_instance_id=inst.id
    )
    mine = await _create_runtime(db_session, user_a.id, name="page-mine-rt")

    resp = await client.get(
        "/api/daemon/runtimes/page?limit=10&offset=0", headers=_headers(_token_for(user_a))
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # items 仍只含自己的 runtime（共享机器的 runtime 不进 items）
    assert {it["id"] for it in body["items"]} == {str(mine.id)}
    assert len(body["shared_to_me"]) == 1
    row = body["shared_to_me"][0]
    # task-13：行新增 runtimes 明细（其余五字段零变化；快照断言同步带上明细）。
    assert row == {
        "machine_id": str(inst.id),
        "display_name": "共享页机",
        "lender_display_name": "Mach B",
        "source_workspace_id": str(ws.id),
        "online": True,
        "runtimes": [
            {"runtime_id": str(lender_rt.id), "provider": "claude", "online": True},
        ],
    }


@pytest.mark.asyncio
async def test_runtimes_page_shared_to_me_empty_by_default(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """task-07：无共享 → /runtimes/page shared_to_me 空数组（既有 shape 断言零失败）。"""
    _admin, user_a, _u_b = await _bootstrap(db_session)
    await _create_runtime(db_session, user_a.id, name="plain-rt")

    resp = await client.get(
        "/api/daemon/runtimes/page?limit=10&offset=0", headers=_headers(_token_for(user_a))
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["shared_to_me"] == []


# ── grants router 挂载冒烟（task-07：include 后 /api/daemon/shared-agents 可路由）──


@pytest.mark.asyncio
async def test_shared_agents_router_mounted_smoke(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """task-07：grants router 挂载后端点可达——active 登录用户 200 / 未认证 401；
    管理端点非 admin 403、admin 200（端点语义归 task-04，此处只验路由与鉴权闸）。"""
    admin, user_a, _u_b = await _bootstrap(db_session)

    # active 公共端点：任意登录用户 200（空列表也合法）
    resp = await client.get(
        "/api/daemon/shared-agents/active", headers=_headers(_token_for(user_a))
    )
    assert resp.status_code == 200, resp.text
    assert isinstance(resp.json(), list)

    # 未认证 → 401（get_current_user）
    resp_anon = await client.get("/api/daemon/shared-agents/active")
    assert resp_anon.status_code == 401, resp_anon.text

    # 管理端点：非 admin 403（require_platform_admin）
    resp_non_admin = await client.get(
        "/api/daemon/shared-agents", headers=_headers(_token_for(user_a))
    )
    assert resp_non_admin.status_code == 403, resp_non_admin.text

    # admin 200
    resp_admin = await client.get("/api/daemon/shared-agents", headers=_headers(_token_for(admin)))
    assert resp_admin.status_code == 200, resp_admin.text
    assert isinstance(resp_admin.json(), list)


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
