"""daemon_instances.pending_update 心跳 upsert + 机器视图透出（task-06 / FR-04 / D-004@v1）.

服务层（``RuntimeService.heartbeat_daemon`` 直调，root ``db_session`` SQLite in-memory，
风格对齐 test_register_heartbeat_daemon.py）：

* 首次携带 pending_update 心跳 → 落库 ``{reason, current_version, target_version,
  since}`` 四键，since=心跳时刻（design S4「首落库盖 since=now」）；
* 同内容（三元组相等）重放心跳 → 原 dict（含 since）保留，不退化成最后心跳时间
  （design S4 / Grill M11）；
* 内容变化（reason / 两版本任一）→ 整对象重写 + since 刷新；
* 心跳无该字段（pending_update=None）→ 置 NULL 清除——与兄弟字段 daemon_version/
  build_id「非 None 才覆盖」**刻意反向**（D-004@v1：pydantic 请求模型缺省与显式
  null 不可区分，单机单 daemon 无新旧进程交错，靠「无字段」显式清除才收敛）。

HTTP 层（root ``client`` fixture + 手签 JWT，风格对齐 test_lease_ownership.py）：

* POST /heartbeat 带 pending_update → 200 且响应体**不含** pending_update（本卡
  约束：该字段仅请求方向 + 机器视图方向，心跳响应体不动）；
* GET /machines 与 GET /runtimes/page 均透出机器级 pending_update（四键含 since；
  从未携带 / 清除后为 null）。

since「保留 vs 刷新」断言用哨兵值改写 DB 后再心跳验证（两次 ``datetime.now`` 在
Windows 低分辨率时钟下可能取到同一时刻，不依赖真实时钟推进，确定性断言）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance
from app.modules.daemon.runtime.service import RuntimeService

# 哨兵 since：绝无可能等于 datetime.now(UTC).isoformat() 的固定历史时刻。
_SENTINEL_SINCE = "2000-01-01T00:00:00+00:00"

_PENDING_V1 = {
    "reason": "server_command",
    "current_version": "0.9.0",
    "target_version": "0.9.1",
}


# ── helpers ──────────────────────────────────────────────────────────────────


async def _seed_user(
    db_session: AsyncSession, *, name: str, is_platform_admin: bool = False
) -> tuple[User, str]:
    """插入用户并手签 15min JWT（get_current_principal Bearer 路径）。

    HTTP 用例用 platform admin 单人分饰两角：既过心跳归属校验
    （actor_user_id == instance.user_id），又直通 /machines 与 /runtimes/page 的
    RuntimeAdminUser 权限（平台管理员 bypass，免角色授予）。
    """
    from app.core.config import get_settings
    from app.core.security import create_access_token

    user = User(
        id=uuid.uuid4(),
        email=f"pending-{name}-{uuid.uuid4()}@example.com",
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


async def _register_daemon(
    db_session: AsyncSession, user_id: uuid.UUID, *, hostname: str = "pending-host"
) -> uuid.UUID:
    """register 一个 daemon 实体 + 单 provider runtime（heartbeat 的前置，§9.1）。"""
    daemon_local_id = uuid.uuid4()
    svc = RuntimeService(db_session)
    await svc.register_daemon(
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


async def _rewrite_since(db_session: AsyncSession, instance_id: uuid.UUID, since: str) -> None:
    """把已落库 pending_update 的 since 改写为哨兵值（新 dict 整体赋值，JSON 变更可见）。"""
    row = await _reload_instance(db_session, instance_id)
    assert row.pending_update is not None, "改写 since 前提：pending_update 已落库"
    row.pending_update = {**row.pending_update, "since": since}
    db_session.add(row)
    await db_session.commit()


def _parse_since(value: object) -> datetime:
    """断言 since 可解析为 aware ISO 时刻（落库侧 ``datetime.now(UTC).isoformat()``）。"""
    assert isinstance(value, str)
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    assert parsed.tzinfo is not None
    return parsed


# ── 服务层：upsert 语义（首落 / 保留 / 刷新 / 清除）────────────────────────────


@pytest.mark.asyncio
async def test_first_pending_heartbeat_writes_full_dict_with_since(
    db_session: AsyncSession,
) -> None:
    """首落库：三元组原样 + since 盖心跳时刻 now（design S4）。"""
    user, _token = await _seed_user(db_session, name="u1")
    daemon_local_id = await _register_daemon(db_session, user.id)

    started = datetime.now(UTC)
    await RuntimeService(db_session).heartbeat_daemon(
        daemon_local_id,
        providers=[{"provider": "claude", "status": "online"}],
        pending_update=dict(_PENDING_V1),
    )
    finished = datetime.now(UTC)

    row = await _reload_instance(db_session, daemon_local_id)
    assert row.pending_update is not None
    assert row.pending_update["reason"] == "server_command"
    assert row.pending_update["current_version"] == "0.9.0"
    assert row.pending_update["target_version"] == "0.9.1"
    since = _parse_since(row.pending_update["since"])
    assert started <= since <= finished, "since 应为本次心跳时刻（首落库盖 now）"


@pytest.mark.asyncio
async def test_same_content_heartbeat_keeps_original_since(db_session: AsyncSession) -> None:
    """同内容重放心跳：整 dict（含 since）保留——since 是 pending 首现时刻，不随
    每轮心跳退化（design S4 / Grill M11）。"""
    user, _token = await _seed_user(db_session, name="u2")
    daemon_local_id = await _register_daemon(db_session, user.id)
    svc = RuntimeService(db_session)

    await svc.heartbeat_daemon(daemon_local_id, pending_update=dict(_PENDING_V1))
    await _rewrite_since(db_session, daemon_local_id, _SENTINEL_SINCE)

    # 同内容（reason+两版本三元组相等）再心跳：since 哨兵原样保留。
    await svc.heartbeat_daemon(daemon_local_id, pending_update=dict(_PENDING_V1))
    row = await _reload_instance(db_session, daemon_local_id)
    assert row.pending_update is not None
    assert row.pending_update["since"] == _SENTINEL_SINCE
    assert row.pending_update["reason"] == "server_command"
    assert row.pending_update["current_version"] == "0.9.0"
    assert row.pending_update["target_version"] == "0.9.1"


@pytest.mark.asyncio
async def test_content_change_rewrites_dict_and_refreshes_since(
    db_session: AsyncSession,
) -> None:
    """内容变化（target_version 变）：整对象重写 + since 刷新（≠哨兵历史值）。"""
    user, _token = await _seed_user(db_session, name="u3")
    daemon_local_id = await _register_daemon(db_session, user.id)
    svc = RuntimeService(db_session)

    await svc.heartbeat_daemon(daemon_local_id, pending_update=dict(_PENDING_V1))
    await _rewrite_since(db_session, daemon_local_id, _SENTINEL_SINCE)

    await svc.heartbeat_daemon(
        daemon_local_id,
        pending_update={**_PENDING_V1, "target_version": "0.9.2"},
    )
    row = await _reload_instance(db_session, daemon_local_id)
    assert row.pending_update is not None
    assert row.pending_update["target_version"] == "0.9.2"
    assert row.pending_update["reason"] == "server_command"
    assert row.pending_update["current_version"] == "0.9.0"
    assert row.pending_update["since"] != _SENTINEL_SINCE, "内容变化应盖 since=now（新时刻）"
    _parse_since(row.pending_update["since"])


@pytest.mark.asyncio
async def test_heartbeat_without_field_clears_pending(db_session: AsyncSession) -> None:
    """无该字段心跳 → 置 NULL 清除（D-004@v1 反向语义：旧 daemon 不带字段即走清除路径）。"""
    user, _token = await _seed_user(db_session, name="u4")
    daemon_local_id = await _register_daemon(db_session, user.id)
    svc = RuntimeService(db_session)

    await svc.heartbeat_daemon(daemon_local_id, pending_update=dict(_PENDING_V1))
    assert (await _reload_instance(db_session, daemon_local_id)).pending_update is not None

    # 不带 pending_update（默认 None）——升级已执行/取消后 daemon 停止携带的路径。
    await svc.heartbeat_daemon(
        daemon_local_id, providers=[{"provider": "claude", "status": "online"}]
    )
    assert (await _reload_instance(db_session, daemon_local_id)).pending_update is None


# ── HTTP 层：心跳接收 + 两机器视图端点透出 ────────────────────────────────────


@pytest.mark.asyncio
async def test_heartbeat_and_machine_views_expose_pending_update(
    db_session: AsyncSession, client: AsyncClient
) -> None:
    """全链路：心跳携带 → /machines 与 /runtimes/page 透出四键；无字段心跳 → 两端 null。

    同时锁定约束「心跳响应体不含 pending_update」（本卡不改 DaemonHeartbeatResponse）。
    """
    owner, token = await _seed_user(db_session, name="owner", is_platform_admin=True)
    daemon_local_id = await _register_daemon(db_session, owner.id, hostname="http-host")

    def _heartbeat_body(pending: dict | None) -> dict:
        body: dict = {
            "daemon_local_id": str(daemon_local_id),
            "providers": [{"provider": "claude", "status": "online"}],
        }
        if pending is not None:
            body["pending_update"] = pending
        return body

    # 从未携带 → 机器视图两态之一：pending_update 键存在且为 null。
    machines = (await client.get("/api/daemon/machines", headers=_headers(token))).json()
    machine = next(it for it in machines["items"] if it["id"] == str(daemon_local_id))
    assert "pending_update" in machine and machine["pending_update"] is None

    # 携带 pending_update 心跳 → 200；响应体不含该字段（仅请求方向）。
    resp = await client.post(
        "/api/daemon/heartbeat",
        json=_heartbeat_body(
            {"reason": "disk_change", "current_version": "b-old", "target_version": "b-new"}
        ),
        headers=_headers(token),
    )
    assert resp.status_code == 200, resp.text
    assert "pending_update" not in resp.json(), "心跳响应体不动（本卡约束）"

    # GET /machines：机器级透出四键（含 since）。
    machines2 = (await client.get("/api/daemon/machines", headers=_headers(token))).json()
    machine2 = next(it for it in machines2["items"] if it["id"] == str(daemon_local_id))
    assert machine2["pending_update"] is not None
    assert machine2["pending_update"]["reason"] == "disk_change"
    assert machine2["pending_update"]["current_version"] == "b-old"
    assert machine2["pending_update"]["target_version"] == "b-new"
    _parse_since(machine2["pending_update"]["since"])

    # GET /runtimes/page：机器级注入同款字段（照 daemon_version 注入先例）。
    page = (await client.get("/api/daemon/runtimes/page?limit=50", headers=_headers(token))).json()
    page_item = next(
        it for it in page["items"] if it.get("daemon_instance_id") == str(daemon_local_id)
    )
    assert page_item["pending_update"] == machine2["pending_update"]

    # 无字段心跳 → 清除；两端点 pending_update 均为 null。
    resp2 = await client.post(
        "/api/daemon/heartbeat", json=_heartbeat_body(None), headers=_headers(token)
    )
    assert resp2.status_code == 200, resp2.text

    machines3 = (await client.get("/api/daemon/machines", headers=_headers(token))).json()
    machine3 = next(it for it in machines3["items"] if it["id"] == str(daemon_local_id))
    assert "pending_update" in machine3 and machine3["pending_update"] is None

    page2 = (await client.get("/api/daemon/runtimes/page?limit=50", headers=_headers(token))).json()
    page_item2 = next(
        it for it in page2["items"] if it.get("daemon_instance_id") == str(daemon_local_id)
    )
    assert "pending_update" in page_item2 and page_item2["pending_update"] is None
