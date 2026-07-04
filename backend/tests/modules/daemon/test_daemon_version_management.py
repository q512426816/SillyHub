"""Tests for daemon version management (2026-07-04-daemon-version-management).

Covers:
- GET /api/daemon/version 返回 latest_version + latest_build_id + 旧字段（D-004）
- register 写入 daemon_version/build_id 到 daemon_instances（service 层，D-001/003）
- 旧 daemon 不上报 → NULL 兼容（D-008）
- heartbeat 刷新版本（仅非 None，D-002/008）
- migration 202607041800 metadata + build_id 列 SQLite smoke（D-003）
"""

from __future__ import annotations

import importlib
import os
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
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


# ── GET /api/daemon/version（公开端点，D-004）────────────────────────────────


@pytest.mark.asyncio
async def test_get_daemon_version_returns_dual_fields(client: AsyncClient) -> None:
    """GET /version 返回 latest_version + latest_build_id，保留旧字段（install.sh 兼容）。"""
    resp = await client.get("/api/daemon/version")
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert "latest_version" in body
    assert "latest_build_id" in body
    assert "latest" in body  # 旧字段保留
    assert "minRequired" in body
    assert "downloadUrl" in body
    # latest 与 latest_build_id 同源（均为 SHA，D-009）
    assert isinstance(body["latest_version"], str)
    assert isinstance(body["latest_build_id"], str)


# ── register 写入 version/build_id（service 层，D-001/003）───────────────────


@pytest.mark.asyncio
async def test_register_writes_version_and_build_id(db_session: AsyncSession) -> None:
    user = await _seed_user(db_session)
    daemon_local_id = uuid.uuid4()
    svc = DaemonService(db_session)
    await svc.register_daemon(
        user.id,
        daemon_local_id=daemon_local_id,
        server_url="http://backend",
        hostname="host1",
        providers=[{"provider": "claude", "version": "2.1.0"}],
        daemon_version="1.4.2",
        daemon_build_id="a1b2c3d",
    )
    inst = await db_session.get(DaemonInstance, daemon_local_id)
    assert inst is not None
    assert inst.version == "1.4.2"
    assert inst.build_id == "a1b2c3d"


@pytest.mark.asyncio
async def test_register_without_version_keeps_null(db_session: AsyncSession) -> None:
    """旧 daemon 不上报版本 → version/build_id 保持 NULL（D-008 兼容）。"""
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
    inst = await db_session.get(DaemonInstance, daemon_local_id)
    assert inst is not None
    assert inst.version is None
    assert inst.build_id is None


# ── heartbeat 刷新版本（D-002，仅非 None 刷新）──────────────────────────────


@pytest.mark.asyncio
async def test_heartbeat_refreshes_version(db_session: AsyncSession) -> None:
    user = await _seed_user(db_session)
    daemon_local_id = uuid.uuid4()
    svc = DaemonService(db_session)
    await svc.register_daemon(
        user.id,
        daemon_local_id=daemon_local_id,
        server_url="http://backend",
        hostname="host1",
        providers=[{"provider": "claude"}],
        daemon_version="1.4.2",
        daemon_build_id="a1b2c3d",
    )
    await svc.heartbeat_daemon(
        daemon_local_id,
        providers=[{"provider": "claude", "status": "online"}],
        daemon_version="1.5.0",
        daemon_build_id="e5f6g7h",
    )
    inst = await db_session.get(DaemonInstance, daemon_local_id)
    assert inst is not None
    assert inst.version == "1.5.0"
    assert inst.build_id == "e5f6g7h"


@pytest.mark.asyncio
async def test_heartbeat_without_version_keeps_existing(
    db_session: AsyncSession,
) -> None:
    """旧 daemon heartbeat 不带版本 → 保留 register 时的原值（D-008 仅非 None 刷新）。"""
    user = await _seed_user(db_session)
    daemon_local_id = uuid.uuid4()
    svc = DaemonService(db_session)
    await svc.register_daemon(
        user.id,
        daemon_local_id=daemon_local_id,
        server_url="http://backend",
        hostname="host1",
        providers=[{"provider": "claude"}],
        daemon_version="1.4.2",
        daemon_build_id="a1b2c3d",
    )
    await svc.heartbeat_daemon(
        daemon_local_id,
        providers=[{"provider": "claude", "status": "online"}],
    )
    inst = await db_session.get(DaemonInstance, daemon_local_id)
    assert inst is not None
    assert inst.version == "1.4.2"
    assert inst.build_id == "a1b2c3d"


# ── Migration 202607041800（D-003）────────────────────────────────────────────


def _load_migration(revision_id: str):
    """按 revision id 片段匹配加载 migration 模块。"""
    backend_root = Path(__file__).resolve().parent.parent.parent.parent
    versions_dir = backend_root / "migrations" / "versions"
    for f in os.listdir(str(versions_dir)):
        if f.endswith(".py") and revision_id in f and f != "__init__.py":
            return importlib.import_module(f"migrations.versions.{f[:-3]}")
    raise ImportError(f"No migration found for revision {revision_id}")


def test_migration_202607041800_metadata() -> None:
    mod = _load_migration("202607041800")
    assert mod.revision == "202607041800"
    assert mod.down_revision == "b16bf63a5d05"
    assert mod.branch_labels is None
    assert mod.depends_on is None
    assert callable(mod.upgrade)
    assert callable(mod.downgrade)


def test_migration_202607041800_build_id_column_sqlite() -> None:
    """upgrade 加 build_id 列（SQLite smoke，replay add_column DDL）。"""
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                "CREATE TABLE daemon_instances ("
                "id CHAR(32) PRIMARY KEY NOT NULL, version VARCHAR(50))"
            )
        )
        conn.execute(sa.text("ALTER TABLE daemon_instances ADD COLUMN build_id VARCHAR(50)"))
        cols = [r[1] for r in conn.execute(sa.text("PRAGMA table_info(daemon_instances)"))]
    assert "version" in cols
    assert "build_id" in cols
