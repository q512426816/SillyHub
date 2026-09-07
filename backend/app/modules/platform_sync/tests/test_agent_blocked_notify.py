"""agent_blocked 通知触发测试（task-09 / design §5.3 / FR-04）。

触发点＝states 端点 upsert 后的段龄检查（tailer 10s 周期推送天然充当调度：
段龄 ≥120s 的那次推送即触发——验收「阈值 +10s 内到达」）。覆盖：阈值内不触发、
超阈值触发并落库 agent_blocked、同段重推不重复（段级 dedupe + unresolved 幂等）、
消解后再进入视为新段可再触发（读后放行）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.notification.model import Notification
from app.modules.platform_sync.service import BLOCKED_SEGMENTS, LAST_BLOCKED_SEGMENT_SEQ

REG_ENTRY: dict[str, Any] = {
    "harness": "claude-code",
    "log_path": "C:/Users/qinyi/.claude/projects/p/sess-block.jsonl",
    "format": "claude-code-jsonl",
    "agent_cwd": "C:/Users/qinyi/IdeaProjects/demo",
    "session_id": "sess-block-0001",
    "originator": "sillyhub-daemon",
    "exists": True,
    "size_bytes": 100,
    "mtime_ms": 1787446398096.99,
    "first_seen_at": "2026-09-07T00:40:11.000Z",
    "last_seen_at": "2026-09-07T01:53:22.000Z",
    "invocations": 1,
    "last_command": "scan",
}

BASE = datetime(2026, 9, 7, 10, 0, tzinfo=UTC)


def _blocked(path: str, at: datetime) -> dict[str, Any]:
    return {
        "log_path": path,
        "state": "blocked",
        "evidence": "PERMISSION_REQUEST(write)",
        "derived_at": at.isoformat(),
    }


async def _seed_member(db_session: AsyncSession, ws_id: uuid.UUID) -> None:
    """给 shpsync workspace 补一个持 WORKSPACE_READ 的成员（广播收件人）。"""
    user = User(
        id=uuid.uuid4(),
        email=f"user-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="x",
        display_name="u",
        status="active",
    )
    role = Role(id=uuid.uuid4(), key=f"role-{uuid.uuid4().hex[:8]}", name="t")
    db_session.add_all([user, role])
    await db_session.flush()
    db_session.add(RolePermission(role_id=role.id, permission=Permission.WORKSPACE_READ.value))
    db_session.add(UserWorkspaceRole(user_id=user.id, workspace_id=ws_id, role_id=role.id))
    await db_session.commit()


async def _seed_row(client: AsyncClient, headers: dict[str, str]) -> None:
    resp = await client.post(
        "/api/agent-logs",
        json={"schema_version": 1, "pushed_at": "2026-09-07T01:53:22.000Z", "entries": [REG_ENTRY]},
        headers=headers,
    )
    assert resp.status_code == 200


async def _count_notifications(db_session: AsyncSession) -> int:
    return len(list((await db_session.execute(select(Notification))).scalars().all()))


@pytest.mark.asyncio
async def test_blocked_below_threshold_no_notify(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    ws_id, headers = shpsync_headers
    await _seed_member(db_session, ws_id)
    await _seed_row(client, headers)
    BLOCKED_SEGMENTS.clear()
    # 段龄 60s（< 120s 阈值）——进入段但未超阈值
    r = await client.post(
        "/api/agent-logs/states",
        json={"entries": [_blocked(REG_ENTRY["log_path"], BASE)]},
        headers=headers,
    )
    assert r.status_code == 200
    r = await client.post(
        "/api/agent-logs/states",
        json={"entries": [_blocked(REG_ENTRY["log_path"], BASE + timedelta(seconds=60))]},
        headers=headers,
    )
    assert r.status_code == 200
    assert await _count_notifications(db_session) == 0


@pytest.mark.asyncio
async def test_blocked_over_threshold_notifies_and_dedupes(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    ws_id, headers = shpsync_headers
    await _seed_member(db_session, ws_id)
    await _seed_row(client, headers)
    BLOCKED_SEGMENTS.clear()
    # 段龄 130s ≥ 120s → 触发
    await client.post(
        "/api/agent-logs/states",
        json={"entries": [_blocked(REG_ENTRY["log_path"], BASE)]},
        headers=headers,
    )
    await client.post(
        "/api/agent-logs/states",
        json={"entries": [_blocked(REG_ENTRY["log_path"], BASE + timedelta(seconds=130))]},
        headers=headers,
    )
    rows = list((await db_session.execute(select(Notification))).scalars().all())
    assert len(rows) == 1
    assert rows[0].type == "agent_blocked"
    assert "blocked:1" in (rows[0].dedupe_key or "")
    # 同段再推（140s）——不重复
    await client.post(
        "/api/agent-logs/states",
        json={"entries": [_blocked(REG_ENTRY["log_path"], BASE + timedelta(seconds=140))]},
        headers=headers,
    )
    assert await _count_notifications(db_session) == 1


@pytest.mark.asyncio
async def test_blocked_resolved_then_new_segment_notifies_again(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """消解后再次进入 = 新段（序号 2，dedupe_key 变化）→ 已读放行后可再触发。"""
    ws_id, headers = shpsync_headers
    await _seed_member(db_session, ws_id)
    await _seed_row(client, headers)
    BLOCKED_SEGMENTS.clear()
    path = REG_ENTRY["log_path"]
    await client.post(
        "/api/agent-logs/states", json={"entries": [_blocked(path, BASE)]}, headers=headers
    )
    await client.post(
        "/api/agent-logs/states",
        json={"entries": [_blocked(path, BASE + timedelta(seconds=130))]},
        headers=headers,
    )
    assert await _count_notifications(db_session) == 1
    # 已读（消解 unresolved 幂等）
    for n in (await db_session.execute(select(Notification))).scalars().all():
        n.read_at = datetime.now(UTC)
    await db_session.commit()
    # 消解 → 新段（120s 后）
    await client.post(
        "/api/agent-logs/states",
        json={
            "entries": [
                {
                    "log_path": path,
                    "state": "working",
                    "evidence": "e",
                    "derived_at": (BASE + timedelta(seconds=150)).isoformat(),
                }
            ]
        },
        headers=headers,
    )
    assert BLOCKED_SEGMENTS == {}
    assert LAST_BLOCKED_SEGMENT_SEQ[(ws_id, path)] == 1
    t2 = BASE + timedelta(seconds=300)
    await client.post(
        "/api/agent-logs/states", json={"entries": [_blocked(path, t2)]}, headers=headers
    )
    await client.post(
        "/api/agent-logs/states",
        json={"entries": [_blocked(path, t2 + timedelta(seconds=130))]},
        headers=headers,
    )
    rows = list((await db_session.execute(select(Notification))).scalars().all())
    assert len(rows) == 2
    assert rows[1].dedupe_key and "blocked:2" in rows[1].dedupe_key
