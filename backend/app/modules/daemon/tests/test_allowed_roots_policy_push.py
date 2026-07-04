"""task-08: PUT /runtimes/{rid}/allowed-roots triggers WS ``policy_update`` push.

design §5.3 (hot-reload chain) + §7.5 lifecycle. After the DB write succeeds
the router must best-effort push the new allowed_roots to the online daemon so
its PolicyCache reloads sub-second. Push failure (runtime offline / send
error) MUST NOT block the PUT response — the heartbeat full-resync (R-07)
reconciles on the next 15s tick.

version is derived from ``DaemonRuntime.updated_at`` (epoch millis, monotonic
across successive writes) so the daemon can drop stale, reordered pushes.
"""

from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import Role, RolePermission, User
from app.modules.auth.permissions import Permission
from app.modules.daemon.model import DaemonInstance, DaemonRuntime

# ── helpers ─────────────────────────────────────────────────────────────────


async def _create_user(
    session: AsyncSession, *, is_platform_admin: bool = False, email: str | None = None
) -> User:
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=email or f"user-{uid}@example.com",
        password_hash="irrelevant",
        display_name=f"User-{str(uid)[:4]}",
        status="active",
        is_platform_admin=is_platform_admin,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _grant_platform_permission(
    session: AsyncSession, user_id: uuid.UUID, permission: Permission
) -> None:
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


async def _create_runtime(
    session: AsyncSession, user_id: uuid.UUID, *, name: str = "test-daemon"
) -> tuple[DaemonRuntime, DaemonInstance]:
    """Create a daemon_instance + its runtime row (HEAD architecture, design §4.2).

    allowed_roots live on daemon_instances; runtime just references it.
    """
    instance = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname="test-host",
        server_url="http://test.example",
        allowed_roots=["~/.sillyhub"],
        status="online",
    )
    session.add(instance)
    await session.flush()
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        daemon_instance_id=instance.id,
        name=name,
        provider="claude",
        status="online",
        version="0.1.0",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    await session.refresh(instance)
    return rt, instance


def _mock_hub(*, send_result: bool = True) -> MagicMock:
    """Mock DaemonWsHub whose ``send_policy_update`` returns ``send_result``."""
    hub = MagicMock()
    hub.send_policy_update = AsyncMock(return_value=send_result)
    return hub


# ── PUT allowed-roots triggers WS push ──────────────────────────────────────


@pytest.mark.asyncio
async def test_put_allowed_roots_pushes_policy_update(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """DB updated + send_policy_update called with new roots + monotonic version."""
    admin = await _create_user(db_session, is_platform_admin=True)
    await _grant_platform_permission(db_session, admin.id, Permission.RUNTIME_ADMIN)
    rt, instance = await _create_runtime(db_session, admin.id)
    new_roots = ["/home/admin/projects", "/data"]

    hub = _mock_hub(send_result=True)
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        resp = await client.put(
            f"/api/daemon/runtimes/{rt.id}/allowed-roots",
            json={"allowed_roots": new_roots},
            headers=_headers(_token_for(admin)),
        )

    assert resp.status_code == 200, resp.text

    # send_policy_update invoked exactly once. HEAD: routing by daemon_id
    # (= daemon_instance.id), roots read from daemon_instance, payload_runtime_id
    # carries the provider runtime_id (design §5.3).
    hub.send_policy_update.assert_awaited_once()
    call_args = hub.send_policy_update.await_args.args
    call_kwargs = hub.send_policy_update.await_args.kwargs
    assert call_args[0] == instance.id  # daemon_id routing key
    assert call_args[1] == new_roots  # roots from daemon_instance.allowed_roots
    version = call_args[2]
    assert isinstance(version, int)
    assert version >= 1
    assert call_kwargs["payload_runtime_id"] == rt.id  # provider discriminator

    # DB actually persisted on daemon_instance (allowed_roots lives there now).
    await db_session.refresh(instance)
    assert list(instance.allowed_roots) == new_roots


@pytest.mark.asyncio
async def test_put_allowed_roots_offline_runtime_still_returns_200(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """send_policy_update False (offline) / raising must NOT block the PUT (R-07)."""
    admin = await _create_user(db_session, is_platform_admin=True)
    await _grant_platform_permission(db_session, admin.id, Permission.RUNTIME_ADMIN)
    rt, _instance = await _create_runtime(db_session, admin.id)
    new_roots = ["/srv/app"]

    # Case A: send returns False (daemon offline / send failed).
    hub_false = _mock_hub(send_result=False)
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub_false):
        resp = await client.put(
            f"/api/daemon/runtimes/{rt.id}/allowed-roots",
            json={"allowed_roots": new_roots},
            headers=_headers(_token_for(admin)),
        )
    assert resp.status_code == 200, resp.text
    hub_false.send_policy_update.assert_awaited_once()

    # Case B: send raises (unexpected transport error) — PUT still succeeds.
    hub_raise = MagicMock()
    hub_raise.send_policy_update = AsyncMock(side_effect=RuntimeError("boom"))
    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub_raise):
        resp2 = await client.put(
            f"/api/daemon/runtimes/{rt.id}/allowed-roots",
            json={"allowed_roots": ["/srv/other"]},
            headers=_headers(_token_for(admin)),
        )
    assert resp2.status_code == 200, resp2.text


@pytest.mark.asyncio
async def test_put_allowed_roots_version_monotonic_across_writes(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """Two successive PUTs yield strictly increasing version numbers.

    Version derives from daemon_instance.updated_at (the row actually bumped by
    update_allowed_roots), so successive writes are monotonic.
    """
    admin = await _create_user(db_session, is_platform_admin=True)
    await _grant_platform_permission(db_session, admin.id, Permission.RUNTIME_ADMIN)
    rt, _instance = await _create_runtime(db_session, admin.id)

    captured: list[int] = []

    async def _capture(*args: object, **_kwargs: object) -> bool:
        captured.append(args[2])
        return True

    hub = MagicMock()
    hub.send_policy_update = AsyncMock(side_effect=_capture)

    with patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=hub):
        await client.put(
            f"/api/daemon/runtimes/{rt.id}/allowed-roots",
            json={"allowed_roots": ["/first"]},
            headers=_headers(_token_for(admin)),
        )
        # Force a different updated_at wall-clock bucket so the epoch-millis
        # derivation cannot collide on a sub-millisecond pair (CI clocks may
        # advance too slowly otherwise).
        time.sleep(0.005)
        await client.put(
            f"/api/daemon/runtimes/{rt.id}/allowed-roots",
            json={"allowed_roots": ["/second"]},
            headers=_headers(_token_for(admin)),
        )

    assert len(captured) == 2
    assert captured[1] > captured[0], f"version must be monotonic: {captured}"
