"""Runtime 端点版本可见测试（2026-08-04-daemon-version task-09）。

验证 task-07/08 已让 6 个 runtime 端点经 ``_runtime_read`` 把
``daemon_instances.version`` / ``build_id`` 透传到响应字段
``daemon_version`` / ``daemon_build_id``，并覆盖旧 daemon（instance.version=None）
NULL 兼容路径（design §5.B + §9 / plan 全局验收「旧 daemon 兼容」）。

覆盖端点：
- GET  /api/daemon/runtimes/page          （list 分页）
- GET  /api/daemon/runtimes/{id}          （read）
- PATCH /api/daemon/runtimes/{id}         （update display_alias）
- POST /api/daemon/runtimes/{id}/disable
- POST /api/daemon/runtimes/{id}/enable
- POST /api/daemon/runtimes/{id}/offline

用例 A（fr-01-happy）：register 上报 version=0.1.0 / build_id=<sha>-<ts>，
6 端点响应 daemon_version == "0.1.0" / daemon_build_id 非 None。
用例 B（legacy-null-compat）：instance.version=None / build_id=None（旧 daemon
不上报），6 端点响应 daemon_version is None / daemon_build_id is None，且不报 500。

helper 风格对齐 ``test_machines_router.py``（私有复刻 _create_user / _token_for /
_headers / _grant_platform_permission / _create_instance / _create_runtime，不新建
conftest）。SQLite in-memory 行为对齐生产 PG（断字段值不绑死方言）。
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.admin.model import UserRole
from app.modules.auth.model import Role, RolePermission, User
from app.modules.auth.permissions import Permission
from app.modules.daemon.model import DaemonInstance, DaemonRuntime

# 6 个被测端点的相对路径（router 已挂 /api/daemon 前缀，client base_url=http://test）。
# offline 端点 auth 走 get_current_principal（非 RuntimeAdminUser），但仍校验 runtime
# 归属（service.mark_offline(runtime_id, user.id)），故 owner token 即可。

# ── helpers（私有复刻 test_machines_router.py 同款风格）─────────────────────


async def _create_user(
    session: AsyncSession,
    *,
    is_platform_admin: bool = False,
    email: str | None = None,
) -> User:
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=email or f"vv-{uid}@example.com",
        password_hash="irrelevant",
        display_name=f"VV-{str(uid)[:4]}",
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


async def _grant_runtime_admin(session: AsyncSession, user_id: uuid.UUID) -> None:
    """授予平台级 RUNTIME_ADMIN 权限（复刻 test_machines_router.py:80 做法）。"""
    role = Role(
        id=uuid.uuid4(),
        key=f"test-vv-runtime-admin-{uuid.uuid4().hex[:6]}",
        name="test vv runtime admin",
    )
    session.add(role)
    await session.flush()
    session.add(RolePermission(role_id=role.id, permission=Permission.RUNTIME_ADMIN.value))
    session.add(UserRole(user_id=user_id, role_id=role.id))
    await session.commit()


async def _seed_instance(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    version: str | None,
    build_id: str | None,
    hostname: str = "vv-host",
) -> DaemonInstance:
    """构造已注册 daemon_instance（直接写 DB，等价 register 落库后的形态）。"""
    inst = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname=hostname,
        server_url="http://localhost:8001",
        status="online",
        version=version,
        build_id=build_id,
        last_heartbeat_at=None,
    )
    session.add(inst)
    await session.commit()
    await session.refresh(inst)
    return inst


async def _seed_runtime(
    session: AsyncSession,
    user_id: uuid.UUID,
    instance_id: uuid.UUID,
    *,
    name: str = "vv-rt",
    provider: str = "claude",
    status: str = "online",
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name=name,
        provider=provider,
        status=status,
        daemon_instance_id=instance_id,
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


# ── 用例 A：register 上报版本 → 6 端点 daemon_version/daemon_build_id 非 null ──


@pytest.mark.asyncio
async def test_list_runtimes_page_exposes_daemon_version(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """GET /runtimes/page：每行 daemon_version == "0.1.0"、daemon_build_id 非 None。"""
    user = await _create_user(db_session, is_platform_admin=True, email="vv-list@example.com")
    await _grant_runtime_admin(db_session, user.id)
    inst = await _seed_instance(db_session, user.id, version="0.1.0", build_id="abc123-ts")
    await _seed_runtime(db_session, user.id, inst.id)

    resp = await client.get(
        "/api/daemon/runtimes/page?limit=10&offset=0",
        headers=_headers(_token_for(user)),
    )
    assert resp.status_code == 200, resp.text
    items = resp.json()["items"]
    assert len(items) == 1
    row = items[0]
    assert row["daemon_version"] == "0.1.0"
    assert row["daemon_build_id"] == "abc123-ts"


@pytest.mark.asyncio
async def test_get_runtime_exposes_daemon_version(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """GET /runtimes/{id}：daemon_version/daemon_build_id 非 null。"""
    user = await _create_user(db_session, is_platform_admin=True, email="vv-read@example.com")
    await _grant_runtime_admin(db_session, user.id)
    inst = await _seed_instance(db_session, user.id, version="0.1.0", build_id="def456-ts")
    rt = await _seed_runtime(db_session, user.id, inst.id)

    resp = await client.get(
        f"/api/daemon/runtimes/{rt.id}",
        headers=_headers(_token_for(user)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["daemon_version"] == "0.1.0"
    assert body["daemon_build_id"] == "def456-ts"


@pytest.mark.asyncio
async def test_patch_runtime_exposes_daemon_version(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """PATCH /runtimes/{id}：响应 daemon_version/daemon_build_id 非 null。"""
    user = await _create_user(db_session, is_platform_admin=True, email="vv-patch@example.com")
    await _grant_runtime_admin(db_session, user.id)
    inst = await _seed_instance(db_session, user.id, version="0.1.0", build_id="ghi789-ts")
    rt = await _seed_runtime(db_session, user.id, inst.id)

    resp = await client.patch(
        f"/api/daemon/runtimes/{rt.id}",
        json={"display_alias": "vv 别名"},
        headers=_headers(_token_for(user)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["daemon_version"] == "0.1.0"
    assert body["daemon_build_id"] == "ghi789-ts"


@pytest.mark.asyncio
async def test_disable_runtime_exposes_daemon_version(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """POST /runtimes/{id}/disable：响应 daemon_version/daemon_build_id 非 null。"""
    user = await _create_user(db_session, is_platform_admin=True, email="vv-dis@example.com")
    await _grant_runtime_admin(db_session, user.id)
    inst = await _seed_instance(db_session, user.id, version="0.1.0", build_id="jkl012-ts")
    rt = await _seed_runtime(db_session, user.id, inst.id)

    resp = await client.post(
        f"/api/daemon/runtimes/{rt.id}/disable",
        headers=_headers(_token_for(user)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["daemon_version"] == "0.1.0"
    assert body["daemon_build_id"] == "jkl012-ts"


@pytest.mark.asyncio
async def test_enable_runtime_exposes_daemon_version(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """POST /runtimes/{id}/enable：响应 daemon_version/daemon_build_id 非 null。

    先 disable（enable 仅对 disabled runtime 把状态拉回，对 online runtime 仍是
    online 但不报错）；本测断言的是版本透传，不依赖状态翻转。
    """
    user = await _create_user(db_session, is_platform_admin=True, email="vv-ena@example.com")
    await _grant_runtime_admin(db_session, user.id)
    inst = await _seed_instance(db_session, user.id, version="0.1.0", build_id="mno345-ts")
    rt = await _seed_runtime(db_session, user.id, inst.id, status="disabled")

    resp = await client.post(
        f"/api/daemon/runtimes/{rt.id}/enable",
        headers=_headers(_token_for(user)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["daemon_version"] == "0.1.0"
    assert body["daemon_build_id"] == "mno345-ts"


@pytest.mark.asyncio
async def test_offline_runtime_exposes_daemon_version(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """POST /runtimes/{id}/offline：响应 daemon_version/daemon_build_id 非 null。

    offline 端点 auth 走 get_current_principal（owner token 即可），仍校验 runtime
    归属（service.mark_offline(runtime_id, user.id)）。
    """
    user = await _create_user(db_session, is_platform_admin=False, email="vv-off@example.com")
    inst = await _seed_instance(db_session, user.id, version="0.1.0", build_id="pqr678-ts")
    rt = await _seed_runtime(db_session, user.id, inst.id)

    resp = await client.post(
        f"/api/daemon/runtimes/{rt.id}/offline",
        headers=_headers(_token_for(user)),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["daemon_version"] == "0.1.0"
    assert body["daemon_build_id"] == "pqr678-ts"


# ── 用例 B：旧 daemon NULL 兼容（design §9）──────────────────────────────────
# 旧 daemon 不上报版本 → instance.version/build_id 保持 None。6 端点透传 None，
# 不报 500（_runtime_read getattr 默认 None + DaemonRuntimeRead 字段 default=None）。


@pytest.mark.asyncio
async def test_legacy_null_compat_list_and_get(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """旧 daemon NULL 兼容：list / read 两端点 daemon_version/daemon_build_id 为 None，不 500。"""
    user = await _create_user(db_session, is_platform_admin=True, email="vv-legacy-lg@example.com")
    await _grant_runtime_admin(db_session, user.id)
    inst = await _seed_instance(
        db_session, user.id, version=None, build_id=None, hostname="legacy-lg"
    )
    rt = await _seed_runtime(db_session, user.id, inst.id)

    # list
    resp_list = await client.get(
        "/api/daemon/runtimes/page?limit=10&offset=0",
        headers=_headers(_token_for(user)),
    )
    assert resp_list.status_code == 200, resp_list.text
    items = resp_list.json()["items"]
    assert len(items) == 1
    assert items[0]["daemon_version"] is None
    assert items[0]["daemon_build_id"] is None

    # read
    resp_get = await client.get(
        f"/api/daemon/runtimes/{rt.id}",
        headers=_headers(_token_for(user)),
    )
    assert resp_get.status_code == 200, resp_get.text
    body = resp_get.json()
    assert body["daemon_version"] is None
    assert body["daemon_build_id"] is None


@pytest.mark.asyncio
async def test_legacy_null_compat_mutations(client: AsyncClient, db_session: AsyncSession) -> None:
    """旧 daemon NULL 兼容：update/disable/enable/offline 四端点 daemon_version/build_id 为 None，不 500。"""
    user = await _create_user(db_session, is_platform_admin=True, email="vv-legacy-mut@example.com")
    await _grant_runtime_admin(db_session, user.id)

    # PATCH（update display_alias）
    inst_p = await _seed_instance(
        db_session, user.id, version=None, build_id=None, hostname="legacy-patch"
    )
    rt_p = await _seed_runtime(db_session, user.id, inst_p.id, name="rt-patch")
    resp_p = await client.patch(
        f"/api/daemon/runtimes/{rt_p.id}",
        json={"display_alias": "legacy 别名"},
        headers=_headers(_token_for(user)),
    )
    assert resp_p.status_code == 200, resp_p.text
    body_p = resp_p.json()
    assert body_p["daemon_version"] is None
    assert body_p["daemon_build_id"] is None

    # disable
    inst_d = await _seed_instance(
        db_session, user.id, version=None, build_id=None, hostname="legacy-dis"
    )
    rt_d = await _seed_runtime(db_session, user.id, inst_d.id, name="rt-dis")
    resp_d = await client.post(
        f"/api/daemon/runtimes/{rt_d.id}/disable",
        headers=_headers(_token_for(user)),
    )
    assert resp_d.status_code == 200, resp_d.text
    body_d = resp_d.json()
    assert body_d["daemon_version"] is None
    assert body_d["daemon_build_id"] is None

    # enable（先 disabled）
    inst_e = await _seed_instance(
        db_session, user.id, version=None, build_id=None, hostname="legacy-ena"
    )
    rt_e = await _seed_runtime(db_session, user.id, inst_e.id, name="rt-ena", status="disabled")
    resp_e = await client.post(
        f"/api/daemon/runtimes/{rt_e.id}/enable",
        headers=_headers(_token_for(user)),
    )
    assert resp_e.status_code == 200, resp_e.text
    body_e = resp_e.json()
    assert body_e["daemon_version"] is None
    assert body_e["daemon_build_id"] is None

    # offline（get_current_principal auth，owner token）
    inst_o = await _seed_instance(
        db_session, user.id, version=None, build_id=None, hostname="legacy-off"
    )
    rt_o = await _seed_runtime(db_session, user.id, inst_o.id, name="rt-off")
    resp_o = await client.post(
        f"/api/daemon/runtimes/{rt_o.id}/offline",
        headers=_headers(_token_for(user)),
    )
    assert resp_o.status_code == 200, resp_o.text
    body_o = resp_o.json()
    assert body_o["daemon_version"] is None
    assert body_o["daemon_build_id"] is None
