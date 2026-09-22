"""POST/GET /api/changes/{name}/events 端点测试（task-04 / design 五组：收/取/去重/鉴权/上限）。

覆盖：收（批量 2 条 shpsync_ 200 + 落库字段核对 + 伪造 provisional=False 仍存
True / 批量>200 422 / ts 秒级值域 422）、取（乱序推入 GET ts ASC 正序 / since
严格大于不含边界 / limit 生效且 total 不含截断 / 无事件 200 空列表）、去重
（同批重放 / 带 id 事件按 id 去重 / 批内同 dedup_key 只插一条）、鉴权矩阵
（无凭据 401 / shk_live_ 403 / JWT 403，shpsync_ 200 见收组；跨 workspace
scope 隔离）、5000 上限修剪（最旧被删，FR-03 / D-005@v1）。

范式逐字对齐 test_quicklog_push.py（fixture 复用 conftest shpsync_headers /
apikey_headers / auth_headers + db_session 落库断言）；时间毫秒用递增基准
（BASE_TS_MS + i*1000），不依赖真实时钟。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.platform_sync.model import PlatformChangeEventORM

CHANGE_NAME = "2026-09-23-change-events-channel"

#: 递增基准毫秒（≈2025-09-22，值域 ≥1e12 满足 schema 校验）。
BASE_TS_MS = 1758566000000


def _event(i: int, **overrides: Any) -> dict[str, Any]:
    """第 i 条事件载荷（ts 递增 +1s，全部字段显式便于落库核对）。"""
    event: dict[str, Any] = {
        "kind": "file_changed",
        "ts": BASE_TS_MS + i * 1000,
        "stage": "execute",
        "detail": f"事件 {i}",
        "rule": "watcher:fs",
        "severity": "info",
    }
    event.update(overrides)
    return event


def _ts_dt(i: int) -> datetime:
    """第 i 条事件的期望落库 datetime（epoch 毫秒 ÷1000 归一，D-003@v1）。"""
    return datetime.fromtimestamp((BASE_TS_MS + i * 1000) / 1000, tz=UTC)


def _as_utc(dt: datetime) -> datetime:
    """SQLite 读回 naive datetime 统一按 UTC 解释（X-07 方言防御同源）。"""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


def _iso_to_dt(raw: str) -> datetime:
    """GET 响应 ts（ISO 字符串，SQLite 行可能 naive 无后缀）→ UTC aware datetime。"""
    return _as_utc(datetime.fromisoformat(raw.replace("Z", "+00:00")))


async def _push(
    client: AsyncClient, headers: dict[str, str], events: list[dict[str, Any]]
) -> dict[str, Any]:
    """POST 批量事件并断言 200，返回 ``{accepted, deduplicated}``。"""
    resp = await client.post(
        f"/api/changes/{CHANGE_NAME}/events", json={"events": events}, headers=headers
    )
    assert resp.status_code == 200
    return resp.json()


async def _mint_shpsync_token(
    db_session: AsyncSession,
) -> tuple[uuid.UUID, dict[str, str]]:
    """铸第二个 workspace 的 shpsync_ token（conftest fixture 单 token，跨 workspace
    用例在文件内自铸同款，不扩散改 conftest）。"""
    from app.core.config import get_settings
    from app.core.security import password_hasher
    from app.modules.auth.model import User
    from app.modules.platform_sync.token_service import PlatformSyncTokenService
    from app.modules.workspace.model import Workspace

    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-evt-{uuid.uuid4().hex[:8]}",
        slug=f"ws-evt-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/ws-evt-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    db_session.add(ws)
    user = User(
        id=uuid.uuid4(),
        email=f"evt-{uuid.uuid4().hex[:6]}@example.com",
        password_hash=password_hasher.hash("x"),
        status="active",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(ws)

    _row, plaintext = await PlatformSyncTokenService(db_session, settings=get_settings()).create(
        workspace_id=ws.id,
        name="events-cross-ws",
        created_by=user.id,
    )
    return ws.id, {"Authorization": f"Bearer {plaintext}"}


# ── 收（FR-01：批量上行 + 落库字段核对 + 值域/批量防线）──


@pytest.mark.asyncio
async def test_push_batch_ok_and_persisted(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """批量 2 条 shpsync_ 200（accepted=2 deduplicated=0）+ 落库字段核对。

    ts 归一毫秒→datetime、dedup_key 无 id 时 ``{ts_ms}|{kind}|{stage}`` 拼接、
    provisional 恒 True——含伪造 ``provisional=False`` 入参仍存 True 的红线反例
    （D-004@v1：请求值丢弃，平台只展示不消费）。
    """
    ws_id, headers = shpsync_headers
    events = [
        _event(0),
        _event(1, kind="stage_completed", stage="verify", provisional=False),
    ]
    resp = await client.post(
        f"/api/changes/{CHANGE_NAME}/events", json={"events": events}, headers=headers
    )
    assert resp.status_code == 200
    assert resp.json() == {"accepted": 2, "deduplicated": 0}

    stmt = (
        select(PlatformChangeEventORM)
        .where(PlatformChangeEventORM.workspace_id == ws_id)
        .order_by(PlatformChangeEventORM.ts.asc())
    )
    rows = (await db_session.execute(stmt)).scalars().all()
    assert len(rows) == 2
    first, second = rows
    assert first.change_name == CHANGE_NAME
    assert first.kind == "file_changed"
    assert first.stage == "execute"
    assert first.detail == "事件 0"
    assert first.rule == "watcher:fs"
    assert first.severity == "info"
    assert _as_utc(first.ts) == _ts_dt(0)
    assert first.dedup_key == f"{BASE_TS_MS}|file_changed|execute"
    assert first.provisional is True
    assert second.kind == "stage_completed"
    assert second.stage == "verify"
    assert _as_utc(second.ts) == _ts_dt(1)
    assert second.provisional is True  # 红线反例：伪造 False 仍存 True


@pytest.mark.asyncio
async def test_push_batch_over_200_rejected_422(
    client: AsyncClient, shpsync_headers: tuple[Any, dict[str, str]]
) -> None:
    """批量 201 条 422（schema 层 max_length=200，FR-01 批量上限）。"""
    _ws_id, headers = shpsync_headers
    resp = await client.post(
        f"/api/changes/{CHANGE_NAME}/events",
        json={"events": [_event(i) for i in range(201)]},
        headers=headers,
    )
    assert resp.status_code == 422


@pytest.mark.asyncio
async def test_push_seconds_epoch_rejected_422(
    client: AsyncClient, shpsync_headers: tuple[Any, dict[str, str]]
) -> None:
    """ts=1e9 秒级值域 422（schema ge=1e12 毫秒下限，D-003@v1 毫秒/秒混淆防线）。"""
    _ws_id, headers = shpsync_headers
    resp = await client.post(
        f"/api/changes/{CHANGE_NAME}/events",
        json={"events": [_event(0, ts=1_000_000_000)]},
        headers=headers,
    )
    assert resp.status_code == 422


# ── 取（FR-04：ts ASC 正序 / since 增量 / limit / 空列表）──


@pytest.mark.asyncio
async def test_list_returns_ts_ascending(
    client: AsyncClient, shpsync_headers: tuple[Any, dict[str, str]]
) -> None:
    """乱序推 3 条 → GET 按 ts ASC 正序（FR-04 稳定正序）。"""
    _ws_id, headers = shpsync_headers
    await _push(client, headers, [_event(2), _event(0), _event(1)])

    resp = await client.get(f"/api/changes/{CHANGE_NAME}/events", headers=headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 3
    assert [_iso_to_dt(item["ts"]) for item in body["items"]] == [_ts_dt(0), _ts_dt(1), _ts_dt(2)]


@pytest.mark.asyncio
async def test_list_since_strictly_greater_excludes_boundary(
    client: AsyncClient, shpsync_headers: tuple[Any, dict[str, str]]
) -> None:
    """since=<第 2 条 ts 的 ISO> → 只回第 3 条（严格大于，增量不含边界行，FR-04）。"""
    _ws_id, headers = shpsync_headers
    await _push(client, headers, [_event(0), _event(1), _event(2)])

    resp = await client.get(
        f"/api/changes/{CHANGE_NAME}/events",
        params={"since": _ts_dt(1).isoformat()},
        headers=headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert len(body["items"]) == 1
    assert _iso_to_dt(body["items"][0]["ts"]) == _ts_dt(2)


@pytest.mark.asyncio
async def test_list_limit_applies_and_total_excludes_truncation(
    client: AsyncClient, shpsync_headers: tuple[Any, dict[str, str]]
) -> None:
    """limit=2 生效（截断从最旧端起）且 total=3 不含 limit 截断。"""
    _ws_id, headers = shpsync_headers
    await _push(client, headers, [_event(i) for i in range(3)])

    resp = await client.get(
        f"/api/changes/{CHANGE_NAME}/events", params={"limit": 2}, headers=headers
    )
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["items"]) == 2
    assert body["total"] == 3
    assert [_iso_to_dt(item["ts"]) for item in body["items"]] == [_ts_dt(0), _ts_dt(1)]


@pytest.mark.asyncio
async def test_list_empty_change_returns_200_empty(
    client: AsyncClient, shpsync_headers: tuple[Any, dict[str, str]]
) -> None:
    """无事件 change GET 200 空列表（事件表独立于 change 行存在，观测面宽松）。"""
    _ws_id, headers = shpsync_headers
    resp = await client.get(f"/api/changes/{CHANGE_NAME}/events", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == {"items": [], "total": 0}


@pytest.mark.asyncio
async def test_list_invalid_since_returns_422(
    client: AsyncClient, shpsync_headers: tuple[Any, dict[str, str]]
) -> None:
    """since 非法 ISO 格式 422（execute 阶段独立审查补充用例，e2e curl 已实测）。"""
    _ws_id, headers = shpsync_headers
    resp = await client.get(
        f"/api/changes/{CHANGE_NAME}/events", headers=headers, params={"since": "not-a-date"}
    )
    assert resp.status_code == 422


# ── 去重（D-002：dedup 语义是跳过不是覆盖）──


@pytest.mark.asyncio
async def test_replay_same_batch_deduplicated(
    client: AsyncClient, shpsync_headers: tuple[Any, dict[str, str]]
) -> None:
    """同批重放：二次响应 deduplicated=N accepted=0，GET 行数不变（watcher 重跑幂等）。"""
    _ws_id, headers = shpsync_headers
    batch = [_event(i) for i in range(3)]
    assert await _push(client, headers, batch) == {"accepted": 3, "deduplicated": 0}
    assert await _push(client, headers, batch) == {"accepted": 0, "deduplicated": 3}

    resp = await client.get(f"/api/changes/{CHANGE_NAME}/events", headers=headers)
    assert resp.json()["total"] == 3


@pytest.mark.asyncio
async def test_repush_with_cli_id_dedup_by_id(
    client: AsyncClient, shpsync_headers: tuple[Any, dict[str, str]]
) -> None:
    """带 id 事件重推按 id 去重（dedup_key 优先源是 CLI id），原行不被更新。"""
    _ws_id, headers = shpsync_headers
    event = _event(0, id="evt-abc-001")
    assert await _push(client, headers, [event]) == {"accepted": 1, "deduplicated": 0}

    # 同 id 不同 ts/kind 重推：按 id 去重跳过（跳过不是覆盖）。
    replay = {**event, "ts": BASE_TS_MS + 999000, "kind": "stage_completed"}
    assert await _push(client, headers, [replay]) == {"accepted": 0, "deduplicated": 1}

    resp = await client.get(f"/api/changes/{CHANGE_NAME}/events", headers=headers)
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["kind"] == "file_changed"
    assert _iso_to_dt(body["items"][0]["ts"]) == _ts_dt(0)


@pytest.mark.asyncio
async def test_intra_batch_same_dedup_key_inserts_once(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """批内同 dedup_key 两条只插一条（deduplicated=1，dict 保序留首条，防撞唯一约束）。"""
    ws_id, headers = shpsync_headers
    duplicate = _event(0)
    result = await _push(client, headers, [duplicate, {**duplicate, "detail": "重复条"}])
    assert result == {"accepted": 1, "deduplicated": 1}

    stmt = select(PlatformChangeEventORM).where(PlatformChangeEventORM.workspace_id == ws_id)
    rows = (await db_session.execute(stmt)).scalars().all()
    assert len(rows) == 1
    assert rows[0].detail == "事件 0"  # 首条胜出，第二条被丢


# ── 鉴权（写通道仅 shpsync_；shpsync_ 200 见收组）──


@pytest.mark.asyncio
async def test_events_push_no_auth_returns_401(client: AsyncClient) -> None:
    resp = await client.post(f"/api/changes/{CHANGE_NAME}/events", json={"events": [_event(0)]})
    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_events_push_apikey_auth_403(
    client: AsyncClient, apikey_headers: dict[str, str]
) -> None:
    """shk_live_ 凭据有效也 403——写通道仅 shpsync_（D-004@v1 收紧口径）。"""
    resp = await client.post(
        f"/api/changes/{CHANGE_NAME}/events",
        json={"events": [_event(0)]},
        headers=apikey_headers,
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_events_push_jwt_auth_403(client: AsyncClient, auth_headers: dict[str, str]) -> None:
    resp = await client.post(
        f"/api/changes/{CHANGE_NAME}/events",
        json={"events": [_event(0)]},
        headers=auth_headers,
    )
    assert resp.status_code == 403


@pytest.mark.asyncio
async def test_cross_workspace_scope_isolation(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """两个 shpsync_ token：A 推的事件 B 的 GET 看不到（token 派生 workspace 隔离）。"""
    _ws_a, headers_a = shpsync_headers
    await _push(client, headers_a, [_event(0), _event(1)])

    _ws_b, headers_b = await _mint_shpsync_token(db_session)
    resp_b = await client.get(f"/api/changes/{CHANGE_NAME}/events", headers=headers_b)
    assert resp_b.status_code == 200
    assert resp_b.json() == {"items": [], "total": 0}

    # 对照：A 自己仍读得满（防「谁也读不到」的假阴性）。
    resp_a = await client.get(f"/api/changes/{CHANGE_NAME}/events", headers=headers_a)
    assert resp_a.json()["total"] == 2


# ── 上限（FR-03 / D-005@v1：单 (workspace, change) 5000 行修剪最旧）──


@pytest.mark.asyncio
async def test_cap_5000_trims_oldest(
    client: AsyncClient,
    shpsync_headers: tuple[Any, dict[str, str]],
    db_session: AsyncSession,
) -> None:
    """推 5005 条（26 批：25×200 + 1×5）→ 最终 count=5000 且被删的是最旧 5 条。"""
    from app.modules.platform_sync.service import CHANGE_EVENTS_MAX_ROWS

    ws_id, headers = shpsync_headers
    total = CHANGE_EVENTS_MAX_ROWS + 5
    pushed = 0
    while pushed < total:
        batch = [_event(pushed + i) for i in range(min(200, total - pushed))]
        assert await _push(client, headers, batch) == {
            "accepted": len(batch),
            "deduplicated": 0,
        }
        pushed += len(batch)

    count_stmt = (
        select(func.count())
        .select_from(PlatformChangeEventORM)
        .where(
            PlatformChangeEventORM.workspace_id == ws_id,
            PlatformChangeEventORM.change_name == CHANGE_NAME,
        )
    )
    assert (await db_session.execute(count_stmt)).scalar_one() == CHANGE_EVENTS_MAX_ROWS

    resp = await client.get(
        f"/api/changes/{CHANGE_NAME}/events", params={"limit": 1}, headers=headers
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == CHANGE_EVENTS_MAX_ROWS
    # 最旧 5 条（i=0..4）被修剪，最老存活行是第 6 条（i=5）。
    assert _iso_to_dt(body["items"][0]["ts"]) == _ts_dt(5)
