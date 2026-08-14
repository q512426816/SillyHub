"""Tests for per-key audit logs on platform settings upsert paths.

Covers change ``2026-08-14-audit-system-completion`` task-04:
- ``PUT /api/settings`` per-key 审计：新 key → CREATE（from=null）；已存在 key →
  UPDATE（from/to 齐全）；批量多 key → 每 key 各一条
- ``PUT /api/platform-settings/mcp-whitelist``（``_write_setting_json`` 写路径）
  同样产生 per-key 审计
- actor_id = 路由认证用户 id
"""

from __future__ import annotations

import json
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import User
from app.modules.settings.model import PlatformSetting
from app.modules.workflow.model import PLATFORM_SETTING_CREATE, PLATFORM_SETTING_UPDATE, AuditLog

SETTINGS_PATH = "/api/settings"
MCP_WL_PATH = "/api/platform-settings/mcp-whitelist"


async def _make_admin(session: AsyncSession) -> tuple[User, str]:
    from app.core.config import get_settings

    user = User(
        id=uuid.uuid4(),
        email=f"admin-{uuid.uuid4().hex[:6]}@example.com",
        password_hash=password_hasher.hash("x"),
        status="active",
        is_platform_admin=True,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)

    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return user, token


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _setting_audits(db_session: AsyncSession) -> list[AuditLog]:
    rows = await db_session.execute(
        select(AuditLog).where(AuditLog.resource_type == "platform_setting")
    )
    return list(rows.scalars().all())


# ── PUT /api/settings：per-key 审计 ─────────────────────────────────────


@pytest.mark.asyncio
async def test_put_settings_new_key_audits_create(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, token = await _make_admin(db_session)
    resp = await client.put(
        SETTINGS_PATH,
        headers=_headers(token),
        json={"settings": {"feature.x.enabled": "true"}},
    )
    assert resp.status_code == 200, resp.text

    audits = await _setting_audits(db_session)
    assert len(audits) == 1
    log = audits[0]
    assert log.action == PLATFORM_SETTING_CREATE
    assert log.actor_id == user.id
    assert log.workspace_id is None
    details = json.loads(log.details_json or "{}")
    assert details["key"] == "feature.x.enabled"
    assert details["from"] is None
    assert details["to"] == "true"


@pytest.mark.asyncio
async def test_put_settings_existing_key_audits_update(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, token = await _make_admin(db_session)
    db_session.add(
        PlatformSetting(
            key="feature.y.limit",
            value="10",
            updated_by=user.id,
        )
    )
    await db_session.commit()

    resp = await client.put(
        SETTINGS_PATH,
        headers=_headers(token),
        json={"settings": {"feature.y.limit": "20"}},
    )
    assert resp.status_code == 200, resp.text

    audits = await _setting_audits(db_session)
    assert len(audits) == 1
    log = audits[0]
    assert log.action == PLATFORM_SETTING_UPDATE
    assert log.actor_id == user.id
    details = json.loads(log.details_json or "{}")
    assert details["key"] == "feature.y.limit"
    assert details["from"] == "10"
    assert details["to"] == "20"


@pytest.mark.asyncio
async def test_put_settings_batch_one_audit_per_key(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, token = await _make_admin(db_session)
    # a 预先存在 → UPDATE；b/c 为新 key → CREATE
    db_session.add(
        PlatformSetting(
            key="batch.a",
            value="old-a",
            updated_by=user.id,
        )
    )
    await db_session.commit()

    resp = await client.put(
        SETTINGS_PATH,
        headers=_headers(token),
        json={"settings": {"batch.a": "new-a", "batch.b": "new-b", "batch.c": "new-c"}},
    )
    assert resp.status_code == 200, resp.text

    audits = await _setting_audits(db_session)
    assert len(audits) == 3
    by_key = {json.loads(entry.details_json or "{}")["key"]: entry for entry in audits}
    assert set(by_key) == {"batch.a", "batch.b", "batch.c"}

    assert by_key["batch.a"].action == PLATFORM_SETTING_UPDATE
    assert json.loads(by_key["batch.a"].details_json or "{}")["from"] == "old-a"

    for key in ("batch.b", "batch.c"):
        assert by_key[key].action == PLATFORM_SETTING_CREATE
        assert json.loads(by_key[key].details_json or "{}")["from"] is None

    assert all(entry.actor_id == user.id for entry in audits)


# ── _write_setting_json 写路径（mcp-whitelist PUT）同样审计 ─────────────


@pytest.mark.asyncio
async def test_put_mcp_whitelist_audits_upsert(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    user, token = await _make_admin(db_session)
    # 第一次写 → CREATE
    resp = await client.put(MCP_WL_PATH, headers=_headers(token), json=["github"])
    assert resp.status_code == 200, resp.text
    # 第二次写 → UPDATE（from 为旧 JSON）
    resp2 = await client.put(MCP_WL_PATH, headers=_headers(token), json=["github", "fs"])
    assert resp2.status_code == 200, resp2.text

    audits = await _setting_audits(db_session)
    assert len(audits) == 2
    create_log, update_log = audits  # 按写入顺序
    assert create_log.action == PLATFORM_SETTING_CREATE
    update_details = json.loads(update_log.details_json or "{}")
    assert update_log.action == PLATFORM_SETTING_UPDATE
    assert update_details["key"] == "mcp.whitelist"
    assert json.loads(update_details["from"]) == ["github"]
    assert json.loads(update_details["to"]) == ["github", "fs"]
    assert all(entry.actor_id == user.id for entry in audits)
