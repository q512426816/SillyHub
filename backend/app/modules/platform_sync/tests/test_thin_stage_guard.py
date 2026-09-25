"""thin 变更守卫 B 与事件归属对账（2026-09-25-change-center-thin-flow task-05）。

守卫 B（platform_sync ``_sync_change_stage_status``）三态——与守卫 A
（change/dispatch.sync_stage_status）同一谓词，CLI 红线：thin（轻量变更）进度落
flow-state.yaml 不落 sillyspec.db，CLI 上行 current_stage 全程 'scan' 停留态：

- thin×active：CLI 'scan' 不覆盖平台 'thin'（status/时间戳类照常落）；
- thin×archived（flow done 后）：放行既有归档翻转链（current_stage='archived'
  + archived_at 首填；读侧三源并集承接，change/service.py:221-243）；
- 主线阶段：零作用（现状覆盖行为回归锁定，brownfield 铁律）。

watcher 事件归属两前提对账（R-06）：事件行挂到变更详情的两个前提——
①事件 ``change_name`` 与平台 ``change_key`` 逐字一致（读侧字符串 join，变体
名字是孤儿不展示在正确变更下）；②workspace 归属一致（token 派生 ws 不符的
事件不进本 ws 查询面）。

范式对齐 test_stage_status_ingest.py / test_change_events.py（conftest
shpsync_headers + client + db_session）。

author: qinyi
created_at: 2026-09-25
"""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

THIN_NAME = "2026-09-25-thin-guard-demo"


def _progress_body(name: str, stage: str | None, status: str | None) -> dict:
    entry: dict[str, Any] = {"name": name}
    if stage is not None:
        entry["current_stage"] = stage
    if status is not None:
        entry["status"] = status
    return {
        "project": {"name": "demo"},
        "changes": [entry],
        "stages": [],
        "steps": [],
        "batch_progress": [],
        "approvals": [],
    }


async def _seed_change_row(
    db_session: AsyncSession, ws_id: Any, name: str, *, current_stage: str
) -> None:
    """建平台 Change 行（占位行后续被 progress 覆盖的既有语义）。"""
    import uuid as _uuid

    from app.modules.change.model import Change

    db_session.add(
        Change(
            id=_uuid.uuid4(),
            workspace_id=ws_id,
            change_key=name,
            title=name,
            status="in_progress",
            location="active",
            path=f"changes/{name}",
            current_stage=current_stage,
            stages={},
        )
    )
    await db_session.commit()


async def _get_change_row(db_session: AsyncSession, ws_id: Any, name: str):
    from sqlalchemy import select

    from app.modules.change.model import Change

    return (
        (
            await db_session.execute(
                select(Change).where(
                    Change.workspace_id == ws_id,
                    Change.change_key == name,
                )
            )
        )
        .scalars()
        .one_or_none()
    )


# ── 守卫 B 三态 ───────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_thin_active_cli_scan_not_overwriting_platform_thin(
    client: AsyncClient, db_session: AsyncSession, shpsync_headers: tuple[Any, dict[str, str]]
) -> None:
    """thin×active：CLI current_stage='scan' 不覆盖平台 'thin'，status 照常映射落库。"""
    ws_id, headers = shpsync_headers
    await _seed_change_row(db_session, ws_id, THIN_NAME, current_stage="thin")
    resp = await client.post(
        f"/api/changes/{THIN_NAME}/progress",
        json=_progress_body(THIN_NAME, stage="scan", status="active"),
        headers={**headers, "X-SillySpec-Pushed-At": "2026-09-25T08:00:00.000Z"},
    )
    assert resp.status_code == 200
    row = await _get_change_row(db_session, ws_id, THIN_NAME)
    assert row is not None
    # 守卫 B 命中：current_stage 恒显 thin（CLI scan 停留态被拦）
    assert row.current_stage == "thin"
    # status/时间戳类照常（CLI active → in_progress 映射落库不受守卫影响）
    assert row.status == "in_progress"


@pytest.mark.asyncio
async def test_thin_archived_flips_through_archive_chain(
    client: AsyncClient, db_session: AsyncSession, shpsync_headers: tuple[Any, dict[str, str]]
) -> None:
    """thin×archived：DB 行 archived → 放行既有归档翻转（current_stage/archived_at）。"""
    ws_id, headers = shpsync_headers
    await _seed_change_row(db_session, ws_id, THIN_NAME, current_stage="thin")
    resp = await client.post(
        f"/api/changes/{THIN_NAME}/progress",
        json=_progress_body(THIN_NAME, stage="scan", status="archived"),
        headers={**headers, "X-SillySpec-Pushed-At": "2026-09-25T08:01:00.000Z"},
    )
    assert resp.status_code == 200
    row = await _get_change_row(db_session, ws_id, THIN_NAME)
    assert row is not None
    # 归档翻转链放行：current_stage 翻 'archived' + archived_at 首填
    assert row.current_stage == "archived"
    assert row.status == "archived"
    assert row.archived_at is not None


@pytest.mark.asyncio
async def test_mainline_stage_unchanged_by_guard(
    client: AsyncClient, db_session: AsyncSession, shpsync_headers: tuple[Any, dict[str, str]]
) -> None:
    """主线阶段（execute）：守卫零作用——CLI 权威值照常覆盖（现状回归锁定）。"""
    ws_id, headers = shpsync_headers
    await _seed_change_row(db_session, ws_id, THIN_NAME, current_stage="execute")
    resp = await client.post(
        f"/api/changes/{THIN_NAME}/progress",
        json=_progress_body(THIN_NAME, stage="verify", status="active"),
        headers={**headers, "X-SillySpec-Pushed-At": "2026-09-25T08:02:00.000Z"},
    )
    assert resp.status_code == 200
    row = await _get_change_row(db_session, ws_id, THIN_NAME)
    assert row is not None
    assert row.current_stage == "verify"


# ── watcher 事件归属两前提对账（R-06；本变更不动事件通道，仅锁定归属语义）──

#: 值域内基准毫秒（schema 校验 ≥1e12）。
_EVT_TS = 1_758_566_000_000


async def _mint_second_ws_token(
    db_session: AsyncSession,
) -> tuple[Any, dict[str, str]]:
    """铸第二个 workspace 的 shpsync_ token（conftest fixture 单 token，跨 workspace
    用例在文件内自铸同款，范式对齐 test_change_events._mint_shpsync_token）。"""
    import uuid as _uuid

    from app.core.config import get_settings
    from app.core.security import password_hasher
    from app.modules.auth.model import User
    from app.modules.platform_sync.token_service import PlatformSyncTokenService
    from app.modules.workspace.model import Workspace

    ws = Workspace(
        id=_uuid.uuid4(),
        name=f"ws-thin-guard-{_uuid.uuid4().hex[:8]}",
        slug=f"ws-thin-guard-{_uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/ws-thin-guard-{_uuid.uuid4().hex[:8]}",
        status="active",
    )
    db_session.add(ws)
    user = User(
        id=_uuid.uuid4(),
        email=f"thin-guard-{_uuid.uuid4().hex[:6]}@example.com",
        password_hash=password_hasher.hash("x"),
        status="active",
    )
    db_session.add(user)
    await db_session.commit()
    _row, plaintext = await PlatformSyncTokenService(db_session, settings=get_settings()).create(
        workspace_id=ws.id,
        name="thin-guard-cross-ws",
        created_by=user.id,
    )
    return ws.id, {"Authorization": f"Bearer {plaintext}"}


@pytest.mark.asyncio
async def test_event_attribution_requires_exact_change_key(
    client: AsyncClient, db_session: AsyncSession, shpsync_headers: tuple[Any, dict[str, str]]
) -> None:
    """前提①：事件 change_name 与平台 change_key 逐字一致才挂上；变体名是孤儿。"""
    ws_id, headers = shpsync_headers
    await _seed_change_row(db_session, ws_id, THIN_NAME, current_stage="thin")
    variant_name = f"{THIN_NAME}x"  # 一字之差的变体（非逐字一致）
    events = [
        {"kind": "file_changed", "ts": _EVT_TS, "stage": "thin", "detail": "exact"},
        {"kind": "file_changed", "ts": _EVT_TS + 1000, "stage": "thin", "detail": "variant"},
    ]
    resp_exact = await client.post(
        f"/api/changes/{THIN_NAME}/events",
        json={"events": [events[0]]},
        headers=headers,
    )
    resp_variant = await client.post(
        f"/api/changes/{variant_name}/events",
        json={"events": [events[1]]},
        headers=headers,
    )
    assert resp_exact.status_code == 200
    assert resp_variant.status_code == 200  # 写通道无归属校验，孤儿照落库

    # 读侧：thin 变更详情只挂逐字一致的事件；变体名不混入
    got = await client.get(f"/api/changes/{THIN_NAME}/events", headers=headers)
    assert got.status_code == 200
    details = [e["detail"] for e in got.json()["items"]]
    assert details == ["exact"]
    # 孤儿事件只能从变体名自己的查询面读到（平台无该变更行，落库不丢）
    got_variant = await client.get(f"/api/changes/{variant_name}/events", headers=headers)
    assert got_variant.status_code == 200
    assert [e["detail"] for e in got_variant.json()["items"]] == ["variant"]


@pytest.mark.asyncio
async def test_event_attribution_requires_same_workspace(
    client: AsyncClient,
    db_session: AsyncSession,
    shpsync_headers: tuple[Any, dict[str, str]],
) -> None:
    """前提②：workspace 归属一致——他 ws token 推的同名事件不进本 ws 查询面。"""
    ws_id, headers = shpsync_headers
    other_ws_id, other_headers = await _mint_second_ws_token(db_session)
    await _seed_change_row(db_session, ws_id, THIN_NAME, current_stage="thin")
    event = {"kind": "stage_started", "ts": _EVT_TS, "stage": "thin", "detail": "cross-ws"}
    resp = await client.post(
        f"/api/changes/{THIN_NAME}/events",
        json={"events": [event]},
        headers=other_headers,  # 他 ws 的 shpsync_ token（合法写凭据）
    )
    assert resp.status_code == 200

    # 本 ws 查询面不含他 ws 事件（token 派生 workspace_id 隔离）
    got = await client.get(f"/api/changes/{THIN_NAME}/events", headers=headers)
    assert got.status_code == 200
    assert got.json()["items"] == []
    # 他 ws 自己的查询面能读到（归属=token ws，非 thin 变更所在 ws）
    got_other = await client.get(f"/api/changes/{THIN_NAME}/events", headers=other_headers)
    assert got_other.status_code == 200
    assert [e["detail"] for e in got_other.json()["items"]] == ["cross-ws"]
    assert other_ws_id != ws_id
