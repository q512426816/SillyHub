"""Tests for ChangeService enrich 实时投影 current_stage（D-002@v1 / D-003@v1 / D-004@v2）。

Change 2026-08-11-change-progress-projection task-08 acceptance 覆盖：
- enrich_with_workspace_ids：命中 platform_change_progress 行 → current_stage 被工具上行
  值覆盖；未命中 → 保留 change 现有值（fallback）。
- enrich_summaries：批量 IN join（禁 N+1），多 change 一次查询；同名异 workspace 不串值。
- 异常 latest_progress（缺 changes 键 / 类型错）→ 不崩，fallback 现有值。
- 全程不写 changes 表（read-only），status 不被投影。

change/tests/conftest.py（task-08）注册 platform_change_progress + platform_sync_tokens 表，
让 enrich join 在测试库可执行。

文件名避开既有 test_projection.py（StageProjectionService 单测，task-07 D-004@v2）。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.change.model import Change
from app.modules.change.schema import ChangeRead
from app.modules.change.service import ChangeService
from app.modules.platform_sync.model import PlatformChangeProgressORM
from app.modules.workspace.model import Workspace


async def _make_workspace(session: AsyncSession) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"ws-{uuid.uuid4().hex[:6]}",
        root_path=f"/tmp/ws-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _make_change(
    session: AsyncSession, workspace_id: uuid.UUID, change_key: str, stage: str = "plan"
) -> Change:
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key=change_key,
        title=change_key,
        status="active",
        location="changes",
        path=f"changes/{change_key}",
        current_stage=stage,
        owner_id=None,
    )
    session.add(change)
    await session.commit()
    await session.refresh(change)
    return change


def _progress_payload(stage: str) -> dict:
    return {
        "project": {"name": "demo"},
        "changes": [{"name": "x", "current_stage": stage, "status": "in_progress"}],
        "stages": [],
        "steps": [],
        "batch_progress": [],
        "approvals": [],
    }


@pytest.mark.asyncio
async def test_enrich_single_hit_overwrites_current_stage(db_session: AsyncSession) -> None:
    """命中 platform_change_progress 行 → current_stage 被工具上行权威值覆盖（D-002@v1）。"""
    ws = await _make_workspace(db_session)
    change = await _make_change(db_session, ws.id, "c-hit", stage="plan")
    db_session.add(
        PlatformChangeProgressORM(
            workspace_id=ws.id,
            change_name="c-hit",
            latest_progress=_progress_payload("execute"),
            last_pushed_at="2026-08-11T00:00:00Z",
            last_pusher="agent",
        )
    )
    await db_session.commit()

    read = await ChangeService(db_session).enrich_with_workspace_ids(change)
    assert isinstance(read, ChangeRead)
    assert read.current_stage == "execute"


@pytest.mark.asyncio
async def test_enrich_single_miss_falls_back_to_existing(db_session: AsyncSession) -> None:
    """未命中（工具未上行）→ 保留 change 现有 current_stage（D-003 fallback）。"""
    ws = await _make_workspace(db_session)
    change = await _make_change(db_session, ws.id, "c-miss", stage="verify")

    read = await ChangeService(db_session).enrich_with_workspace_ids(change)
    assert read.current_stage == "verify"


@pytest.mark.asyncio
async def test_enrich_list_batch_in_covers_hits_and_misses(db_session: AsyncSession) -> None:
    """批量 IN join：命中覆盖、未命中 fallback（R-03 禁 N+1）。"""
    ws = await _make_workspace(db_session)
    c1 = await _make_change(db_session, ws.id, "list-1", stage="plan")
    c2 = await _make_change(db_session, ws.id, "list-2", stage="plan")
    c3 = await _make_change(db_session, ws.id, "list-3", stage="plan")
    db_session.add(
        PlatformChangeProgressORM(
            workspace_id=ws.id,
            change_name="list-1",
            latest_progress=_progress_payload("execute"),
            last_pushed_at=None,
            last_pusher=None,
        )
    )
    await db_session.commit()

    summaries = await ChangeService(db_session).enrich_summaries([c1, c2, c3])
    by_key = {s.change_key: s for s in summaries}
    assert by_key["list-1"].current_stage == "execute"
    assert by_key["list-2"].current_stage == "plan"
    assert by_key["list-3"].current_stage == "plan"


@pytest.mark.asyncio
async def test_enrich_workspace_isolation_no_cross_talk(db_session: AsyncSession) -> None:
    """同名异 workspace 不串值：ws-A 上行不投影到 ws-B 同名 change（D-001 隔离）。"""
    ws_a = await _make_workspace(db_session)
    ws_b = await _make_workspace(db_session)
    change_b = await _make_change(db_session, ws_b.id, "shared-name", stage="plan")
    db_session.add(
        PlatformChangeProgressORM(
            workspace_id=ws_a.id,
            change_name="shared-name",
            latest_progress=_progress_payload("execute"),
            last_pushed_at=None,
            last_pusher=None,
        )
    )
    await db_session.commit()

    read = await ChangeService(db_session).enrich_with_workspace_ids(change_b)
    assert read.current_stage == "plan"


@pytest.mark.asyncio
async def test_enrich_malformed_latest_progress_falls_back(db_session: AsyncSession) -> None:
    """latest_progress 结构异常（缺 changes / 类型错）→ _extract_current_stage 返 None 不崩。

    用 ChangeService._extract_current_stage 直接验证各种畸形 payload 均返 None（调用方
    fallback 现有值）。
    """
    svc = ChangeService(db_session)
    malformed_payloads: list[dict[str, object] | None] = [
        None,
        {"no_changes_key": True},
        {"changes": "not-a-list"},
        {"changes": []},
        {"changes": [{"no_stage": True}]},
        {"changes": [{"current_stage": 123}]},
    ]
    for malformed in malformed_payloads:
        assert svc._extract_current_stage(malformed) is None


@pytest.mark.asyncio
async def test_enrich_does_not_write_changes_table(db_session: AsyncSession) -> None:
    """enrich read-only：不改 Change ORM 对象的 current_stage；status 不被投影（D-002 / D-004@v2）。

    enrich 返回独立 DTO（model_validate），不 mutate 传入的 Change ORM 对象、不写库。
    断言调用前后 change.current_stage / status 不变（投影只在返回的 DTO 层生效）。
    """
    ws = await _make_workspace(db_session)
    change = await _make_change(db_session, ws.id, "c-readonly", stage="plan")
    db_session.add(
        PlatformChangeProgressORM(
            workspace_id=ws.id,
            change_name="c-readonly",
            latest_progress=_progress_payload("execute"),
            last_pushed_at=None,
            last_pusher=None,
        )
    )
    await db_session.commit()

    read = await ChangeService(db_session).enrich_with_workspace_ids(change)
    assert read.current_stage == "execute"  # DTO 被投影覆盖
    # ORM 对象本身不被 enrich 改写（read-only，D-002）
    assert change.current_stage == "plan"
    assert change.status == "active"  # status 不被投影（D-004@v2）
