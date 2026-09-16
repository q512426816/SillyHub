"""P1 ingest 权威落库回归（2026-09-16-platform-progress-ingest-persist task-06）。

生产实证根因：progress POST 到达且 latest_progress 落库正确，但 ux_changes 行
current_stage/status 永不更新（``_ensure_change_row`` 行存在即返回 + reparse 的
owner_id 守卫）。本文件锚定 ``_sync_change_stage_status`` 的落库行为面：

- 落库断言（current_stage 覆盖 / status 映射 / archived 终态 + archived_at 首填）
- 幂等重放无漂移
- 未知枚举告警不写列（log spy 断言，structlog 不进 caplog——同
  ``test_worker_subsession_dispatch._mcp_tools_log_spy`` 既有范式）
- 旧 CLI 无 header（分支 1）/ 缺 current_stage 字段（FR-06）
- 409 冲突 / change_deleted 拒收分支不落库（FR-03）
- ingest 落库后 reparse 不回翻（R-01：owner 守卫 + ``_apply_parsed`` 直测）
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import select


async def _get_change_row(db_session: Any, ws_id: Any, name: str):
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


# ── FR-01 落库断言 ────────────────────────────────────────────────────────────


async def test_progress_push_persists_stage_and_status(client, db_session, shpsync_headers):
    """首推（无 base_ts，分支 1）→ changes 行 current_stage 覆盖、status 映射落库。

    生产缺陷形态：payload status='active'/current_stage='verify'，表行停留
    status='draft'/current_stage=NULL。修复后 active→in_progress（D-002@v1）。
    """
    ws_id, headers = shpsync_headers
    name = "2026-09-15-ehs-reward-punishment"
    resp = await client.post(
        f"/api/changes/{name}/progress",
        json=_progress_body(name, stage="verify", status="active"),
        headers={**headers, "X-SillySpec-Pushed-At": "2026-09-15T15:00:00.000Z"},
    )
    assert resp.status_code == 200
    row = await _get_change_row(db_session, ws_id, name)
    assert row is not None, "首推应建 ux_changes 占位行"
    assert row.current_stage == "verify"
    assert row.status == "in_progress"
    assert row.archived_at is None


async def test_progress_push_existing_row_overwritten(client, db_session, shpsync_headers):
    """行已存在（占位行/扫描行）→ 后续接受推送同样覆盖（核心缺陷场景）。

    生产里行由 reparse 先建（current_stage 猜值为空），此后全流程推进永不更新。
    """
    from datetime import UTC, datetime

    from app.modules.change.model import Change

    ws_id, headers = shpsync_headers
    name = "2026-09-15-existing-row"
    # 模拟 reparse 先建的扫描行：current_stage 猜值 None、status 默认 draft。
    db_session.add(
        Change(
            id=uuid.uuid4(),
            workspace_id=ws_id,
            change_key=name,
            title=name,
            status="draft",
            location="active",
            path=f"changes/{name}",
            updated_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    resp = await client.post(
        f"/api/changes/{name}/progress",
        json=_progress_body(name, stage="design", status="in_progress"),
        headers={**headers, "X-SillySpec-Pushed-At": "2026-09-15T16:00:00.000Z"},
    )
    assert resp.status_code == 200
    row = await _get_change_row(db_session, ws_id, name)
    assert row.current_stage == "design"
    assert row.status == "in_progress"


async def test_progress_push_idempotent_replay(client, db_session, shpsync_headers):
    """同载荷二次推送（base_ts 取 ack 服务器钟走分支 3）→ 无状态漂移。"""
    ws_id, headers = shpsync_headers
    name = "2026-09-15-idempotent"
    first = await client.post(
        f"/api/changes/{name}/progress",
        json=_progress_body(name, stage="plan", status="active"),
        headers={**headers, "X-SillySpec-Pushed-At": "2026-09-15T17:00:00.000Z"},
    )
    assert first.status_code == 200
    stamp = first.json()["last_pushed_at"]
    second = await client.post(
        f"/api/changes/{name}/progress",
        json=_progress_body(name, stage="plan", status="active"),
        headers={
            **headers,
            "X-SillySpec-Base-Ts": stamp,
            "X-SillySpec-Pushed-At": "2026-09-15T17:05:00.000Z",
        },
    )
    assert second.status_code == 200
    row = await _get_change_row(db_session, ws_id, name)
    assert row.current_stage == "plan"
    assert row.status == "in_progress"
    assert row.archived_at is None


async def test_archived_terminal_persists(client, db_session, shpsync_headers):
    """status='archived' → status/current_stage='archived' + archived_at 首填；location 不动。"""
    ws_id, headers = shpsync_headers
    name = "2026-09-15-archived"
    first = await client.post(
        f"/api/changes/{name}/progress",
        json=_progress_body(name, stage="archive", status="archived"),
        headers={**headers, "X-SillySpec-Pushed-At": "2026-09-15T18:00:00.000Z"},
    )
    assert first.status_code == 200
    stamp = first.json()["last_pushed_at"]
    row = await _get_change_row(db_session, ws_id, name)
    assert row.status == "archived"
    assert row.current_stage == "archived"
    assert row.archived_at is not None
    assert row.location == "active", "location 由文件移动 + reparse 收敛，ingest 不动"
    archived_at_first = row.archived_at

    # 重放 archived：archived_at 不漂移（首填判据）。
    second = await client.post(
        f"/api/changes/{name}/progress",
        json=_progress_body(name, stage="archive", status="archived"),
        headers={
            **headers,
            "X-SillySpec-Base-Ts": stamp,
            "X-SillySpec-Pushed-At": "2026-09-15T18:05:00.000Z",
        },
    )
    assert second.status_code == 200
    await db_session.refresh(row)
    assert row.archived_at == archived_at_first


# ── FR-02 未知枚举 / FR-06 旧 CLI 兼容 ────────────────────────────────────────


async def test_unknown_status_warns_and_not_written(
    client, db_session, shpsync_headers, monkeypatch
):
    """status 未知值 → 告警（platform_sync.change_status_unknown）+ status 列不写、
    current_stage 照写（不静默丢也不写脏值）。"""
    from unittest.mock import MagicMock

    import app.modules.platform_sync.service as ps_service_mod

    spy = MagicMock()
    monkeypatch.setattr(ps_service_mod, "log", spy)

    ws_id, headers = shpsync_headers
    name = "2026-09-15-weird-status"
    resp = await client.post(
        f"/api/changes/{name}/progress",
        json=_progress_body(name, stage="verify", status="mysterious"),
        headers={**headers, "X-SillySpec-Pushed-At": "2026-09-15T19:00:00.000Z"},
    )
    assert resp.status_code == 200
    row = await _get_change_row(db_session, ws_id, name)
    assert row.status == "draft", "未知枚举不写 status 列（保持占位默认）"
    assert row.current_stage == "verify", "current_stage 不受未知枚举影响照写"
    unknown_calls = [
        c
        for c in spy.warning.call_args_list
        if c.args and c.args[0] == "platform_sync.change_status_unknown"
    ]
    assert unknown_calls, "未知枚举必须有告警（FR-02 不静默丢）"


async def test_deleted_tombstone_no_unknown_warning(
    client, db_session, shpsync_headers, monkeypatch
):
    """代码审查 P2-1：status='deleted' 是合法墓碑载荷（_apply_cli_tombstone 通道），
    不得触发 change_status_unknown 告警；墓碑照常落 location='deleted'。"""
    from unittest.mock import MagicMock

    import app.modules.platform_sync.service as ps_service_mod

    spy = MagicMock()
    monkeypatch.setattr(ps_service_mod, "log", spy)

    from datetime import UTC, datetime

    from app.modules.change.model import Change

    ws_id, headers = shpsync_headers
    name = "2026-09-15-tombstone-push"
    db_session.add(
        Change(
            id=uuid.uuid4(),
            workspace_id=ws_id,
            change_key=name,
            title=name,
            status="draft",
            location="active",
            path=f"changes/{name}",
            current_stage="verify",
            updated_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    resp = await client.post(
        f"/api/changes/{name}/progress",
        json=_progress_body(name, stage="verify", status="deleted"),
        headers={**headers, "X-SillySpec-Pushed-At": "2026-09-15T19:30:00.000Z"},
    )
    assert resp.status_code == 200
    row = await _get_change_row(db_session, ws_id, name)
    assert row.location == "deleted", "墓碑照常落 _apply_cli_tombstone 通道"
    assert row.status == "draft", "deleted 不写 status 列"
    unknown_calls = [
        c
        for c in spy.warning.call_args_list
        if c.args and c.args[0] == "platform_sync.change_status_unknown"
    ]
    assert not unknown_calls, "deleted 是合法通道载荷，不得打未知枚举告警（FR-02）"


async def test_missing_stage_and_status_fields_no_overwrite(client, db_session, shpsync_headers):
    """旧 CLI 载荷缺 current_stage/status 字段 → 对应列不动（FR-06 缺省不覆盖）。"""
    from datetime import UTC, datetime

    from app.modules.change.model import Change

    ws_id, headers = shpsync_headers
    name = "2026-09-15-sparse-payload"
    db_session.add(
        Change(
            id=uuid.uuid4(),
            workspace_id=ws_id,
            change_key=name,
            title=name,
            status="draft",
            location="active",
            path=f"changes/{name}",
            current_stage="design",
            updated_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    resp = await client.post(
        f"/api/changes/{name}/progress",
        json=_progress_body(name, stage=None, status=None),
        headers={**headers, "X-SillySpec-Pushed-At": "2026-09-15T20:00:00.000Z"},
    )
    assert resp.status_code == 200
    row = await _get_change_row(db_session, ws_id, name)
    assert row.current_stage == "design", "缺 current_stage 不覆盖现值"
    assert row.status == "draft", "缺 status 不覆盖现值"


# ── FR-03 冲突/拒收分支不落库 ─────────────────────────────────────────────────


async def test_conflict_409_does_not_write(client, db_session, shpsync_headers):
    """base_ts 落后（stored > base_ts）→ 409，行值不被旧载荷覆盖。"""
    ws_id, headers = shpsync_headers
    name = "2026-09-15-conflict"
    first = await client.post(
        f"/api/changes/{name}/progress",
        json=_progress_body(name, stage="verify", status="active"),
        headers={**headers, "X-SillySpec-Pushed-At": "2026-09-15T21:00:00.000Z"},
    )
    assert first.status_code == 200
    # base_ts 用远旧固定值：服务器钟（now）> 2026-08-10 → 冲突分支。
    stale = await client.post(
        f"/api/changes/{name}/progress",
        json=_progress_body(name, stage="proposal", status="active"),
        headers={
            **headers,
            "X-SillySpec-Base-Ts": "2026-08-10T13:00:00.000Z",
            "X-SillySpec-Pushed-At": "2026-09-15T21:05:00.000Z",
        },
    )
    assert stale.status_code == 409
    row = await _get_change_row(db_session, ws_id, name)
    assert row.current_stage == "verify", "409 冲突不落库"
    assert row.status == "in_progress"


async def test_change_deleted_rejected_not_written(client, db_session, shpsync_headers):
    """已删 key（location='deleted'）→ 409 change_deleted，不建行不落库。"""
    from datetime import UTC, datetime

    from app.modules.change.model import Change

    ws_id, headers = shpsync_headers
    name = "2026-09-15-deleted-key"
    db_session.add(
        Change(
            id=uuid.uuid4(),
            workspace_id=ws_id,
            change_key=name,
            title=name,
            status="draft",
            location="deleted",
            path=f"changes/{name}",
            current_stage="verify",
            updated_at=datetime.now(UTC),
        )
    )
    await db_session.commit()

    resp = await client.post(
        f"/api/changes/{name}/progress",
        json=_progress_body(name, stage="verify", status="active"),
        headers={**headers, "X-SillySpec-Pushed-At": "2026-09-15T22:00:00.000Z"},
    )
    assert resp.status_code == 409
    assert resp.json().get("code") == "change_deleted"
    row = await _get_change_row(db_session, ws_id, name)
    assert row.status == "draft", "拒收分支不写 status"
    assert row.current_stage == "verify", "拒收分支不覆盖 current_stage"


# ── R-01 ingest 落库后 reparse 不回翻 ────────────────────────────────────────


async def test_reparse_does_not_overwrite_cli_stage(client, db_session, shpsync_headers):
    """R-01 锚定：ingest 落库 + owner 设置后，reparse（``_apply_parsed``）不回翻。

    回翻防线 = ``_apply_parsed`` 的 owner_id 守卫（文件猜值仅对扫描历史行生效）；
    进度推送链 ``_sync_change_owner`` 必设 owner → CLI 权威值保持。本用例直测
    守卫机制（构造 parsed 文件猜值 current_stage='proposal'），无需文件系统脚手架。
    """
    from app.modules.change.parser import ParsedChange
    from app.modules.change.service import ChangeService

    ws_id, headers = shpsync_headers
    name = "2026-09-15-reparse-guard"
    resp = await client.post(
        f"/api/changes/{name}/progress",
        json=_progress_body(name, stage="verify", status="active"),
        headers={**headers, "X-SillySpec-Pushed-At": "2026-09-15T23:00:00.000Z"},
    )
    assert resp.status_code == 200
    row = await _get_change_row(db_session, ws_id, name)
    assert row.current_stage == "verify"
    assert row.owner_id is not None, "进度推送链应已设置 owner（回翻防线前提）"

    # 模拟 reparse 拿到文件猜值（owner 守卫应拦下）。
    parsed = ParsedChange(
        change_key=name,
        location="active",
        path=f"changes/{name}",
        current_stage="proposal",
        last_modified_at=None,
    )
    ChangeService._apply_parsed(row, parsed, workspace_id=ws_id)
    await db_session.refresh(row)
    assert row.current_stage == "verify", "reparse 文件猜值不得回翻 CLI 权威 stage"
