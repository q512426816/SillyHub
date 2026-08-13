"""HTTP-level tests for the change router."""

from __future__ import annotations

import shutil
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

COMPONENT_FIXTURES = Path(__file__).parent / "fixtures" / "valid"
CHANGE_FIXTURES = Path(__file__).parent / "fixtures" / "changes"


def _copy_fixtures(src: Path, tmp_path: Path, name: str = "ws") -> Path:
    dst = tmp_path / name
    shutil.copytree(src, dst)
    return dst


@pytest.fixture()
async def workspace_with_changes(
    client, tmp_path: Path, auth_headers: dict[str, str], seed_spec_root_fn
) -> dict:
    """Create a workspace with components and change fixtures.

    2026-07-10-remove-server-local-workspace-mode: backend 读不到 client
    root_path（daemon-client 唯一模式），fixture 文件必须落到服务器 spec_root
    （``{spec_data_root}/{ws_id}/``，扁平布局），reparse 才能解析出 changes。
    """
    import shutil
    from pathlib import Path

    from app.core.config import get_settings

    root = _copy_fixtures(COMPONENT_FIXTURES, tmp_path)

    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "change-test", "root_path": str(root)},
        headers=auth_headers,
    )
    assert ws_resp.status_code == 201, ws_resp.text
    ws_id = ws_resp.json()["id"]

    # COMPONENT_FIXTURES（包裹式 .sillyspec/）展平到 spec_root
    seed_spec_root_fn(ws_id, COMPONENT_FIXTURES)
    # CHANGE_FIXTURES 是裸 changes 树，直接覆盖到 spec_root/changes/
    spec_changes = Path(get_settings().spec_data_root) / ws_id / "changes"
    spec_changes.mkdir(parents=True, exist_ok=True)
    shutil.copytree(CHANGE_FIXTURES, spec_changes, dirs_exist_ok=True)

    # 手动 reparse（create 时 spec_root 空，auto-reparse 无产出）
    await client.post(
        f"/api/workspaces/{ws_id}/changes/reparse",
        headers=auth_headers,
    )

    return {"ws_id": ws_id}


async def test_list_after_auto_reparse(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_changes["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    # create() auto-reparses changes, so they already exist
    assert body["total"] > 0
    assert len(body["items"]) > 0


async def test_reparse_updates_existing_changes(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_changes["ws_id"]
    resp = await client.post(
        f"/api/workspaces/{ws_id}/changes/reparse",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    # create() auto-reparses changes, so second reparse sees updates
    assert body["stats"]["updated"] > 0
    assert body["stats"]["parsed"] > 0


async def test_list_after_reparse(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_changes["ws_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/changes/reparse",
        headers=auth_headers,
    )

    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 3  # demo-feature, demo-archived, conflict-status

    # Filter by location
    resp_active = await client.get(
        f"/api/workspaces/{ws_id}/changes",
        params={"location": "active"},
        headers=auth_headers,
    )
    assert resp_active.status_code == 200
    assert resp_active.json()["total"] == 2  # demo-feature + conflict-status

    resp_archive = await client.get(
        f"/api/workspaces/{ws_id}/changes",
        params={"location": "archive"},
        headers=auth_headers,
    )
    assert resp_archive.status_code == 200
    assert resp_archive.json()["total"] == 1  # demo-archived


async def test_get_change_detail(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_changes["ws_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/changes/reparse",
        headers=auth_headers,
    )

    # List to get an ID
    list_resp = await client.get(
        f"/api/workspaces/{ws_id}/changes",
        params={"location": "active"},
        headers=auth_headers,
    )
    items = list_resp.json()["items"]
    demo = next(i for i in items if i["change_key"] == "2026-05-25-demo-feature")

    # Get detail
    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes/{demo['id']}",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    # Title comes from proposal.md's first heading ("# Proposal"); metadata
    # fields are DB-owned and no longer read from MASTER frontmatter.
    assert body["title"] == "Proposal"
    assert body["status"] == "draft"
    assert body["change_type"] == "feature"
    assert body["location"] == "active"
    assert body["affected_components"] == []


async def test_get_document_matrix(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_changes["ws_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/changes/reparse",
        headers=auth_headers,
    )

    # Get change ID
    list_resp = await client.get(
        f"/api/workspaces/{ws_id}/changes",
        params={"location": "active"},
        headers=auth_headers,
    )
    demo = next(
        i for i in list_resp.json()["items"] if i["change_key"] == "2026-05-25-demo-feature"
    )

    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes/{demo['id']}/documents",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["change_id"] == demo["id"]
    existing_types = {d["doc_type"] for d in body["documents"] if d["exists"]}
    assert "MASTER" in existing_types
    assert "proposal" in existing_types
    assert "requirements" in existing_types
    assert "design" in existing_types


async def test_cross_workspace_isolation(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    """AC-08: Changes from one workspace not visible in another."""
    ws_id = workspace_with_changes["ws_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/changes/reparse",
        headers=auth_headers,
    )

    # Fake workspace ID
    resp = await client.get(
        "/api/workspaces/00000000-0000-0000-0000-000000000000/changes",
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_no_auth_returns_401(client, workspace_with_changes: dict) -> None:
    ws_id = workspace_with_changes["ws_id"]
    resp = await client.get(f"/api/workspaces/{ws_id}/changes")
    assert resp.status_code == 401


async def test_unknown_workspace_returns_404(client, auth_headers: dict[str, str]) -> None:
    resp = await client.get(
        "/api/workspaces/00000000-0000-0000-0000-000000000000/changes",
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_reparse_idempotent(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_changes["ws_id"]

    resp1 = await client.post(
        f"/api/workspaces/{ws_id}/changes/reparse",
        headers=auth_headers,
    )
    assert resp1.status_code == 200

    resp2 = await client.post(
        f"/api/workspaces/{ws_id}/changes/reparse",
        headers=auth_headers,
    )
    assert resp2.status_code == 200

    # Second reparse should have 0 created, all updated
    assert resp2.json()["stats"]["created"] == 0
    assert resp2.json()["stats"]["updated"] > 0


async def test_list_changes_no_duplicate_items(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    """Test-04: list 去重 — 同一 change 不重复出现。"""
    ws_id = workspace_with_changes["ws_id"]

    await client.post(
        f"/api/workspaces/{ws_id}/changes/reparse",
        headers=auth_headers,
    )

    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    ids = [i["id"] for i in body["items"]]
    assert len(ids) == len(set(ids)), "Duplicate change IDs found in list"
    assert body["total"] == len(body["items"])


# ── task-02（2026-08-13-change-center-rework）：list 排序 + pending_review_only 筛选 ──
# 直接经 db_session 播种 Change（可控 updated_at）+ PlatformChangeProgressORM（可控
# pending_review），再经 client GET 端点验证。db_session 与 client 共享同一 db_engine
# 连接池（根 conftest），提交后的行对 client 可见（agent 模块测试同款模式）。


def _progress_with(stage: str, completed: set[str]) -> dict:
    """带 stages 表行的 latest_progress（对齐 platform_sync serializeForSync 六表，
    projection._read_stage_progress_sync 的 stages 表行语义；D-008 task-01 同款）。"""
    return {
        "project": {"name": "demo"},
        "changes": [{"name": "x", "current_stage": stage, "status": "in_progress"}],
        "stages": [{"stage": s, "status": "completed"} for s in sorted(completed)],
        "steps": [],
        "batch_progress": [],
        "approvals": [],
    }


async def _seed_sortable_workspace(db_session) -> dict:
    """建 workspace + 3 条 change（updated_at 严格递增，change_key 字母序与时间序相反）。

    updated_at: alpha(1/1) < beta(1/2) < gamma(1/3)；
    change_key 字母序: alpha < beta < gamma（与时间序相同，便于区分排序键）。
    不挂 PlatformChangeProgressORM（pending_review=None，纯粹排序用）。
    """
    from app.modules.change.model import Change
    from app.modules.workspace.model import Workspace

    ws = Workspace(
        id=uuid.uuid4(),
        name=f"sort-ws-{uuid.uuid4().hex[:6]}",
        slug=f"sort-ws-{uuid.uuid4().hex[:6]}",
        root_path=f"/tmp/sort-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    db_session.add(ws)
    base = datetime(2026, 1, 1, tzinfo=UTC)
    keys_days = [("alpha-sort", 0), ("beta-sort", 1), ("gamma-sort", 2)]
    by_key: dict[str, uuid.UUID] = {}
    for key, day in keys_days:
        change = Change(
            id=uuid.uuid4(),
            workspace_id=ws.id,
            change_key=key,
            title=key,
            status="active",
            location="active",
            path=f"changes/{key}",
            current_stage="execute",
            updated_at=base + timedelta(days=day),
        )
        db_session.add(change)
        by_key[key] = change.id
    await db_session.commit()
    return {"ws_id": ws.id, "by_key": by_key}


async def _seed_review_workspace(db_session) -> dict:
    """建 workspace + 4 条 change：2 条 pending_review 非空、2 条 None。

    - rev-plan：progress → plan + {plan} → plan_review
    - rev-verify：progress → verify + {verify} → human_test
    - norev-execute：progress → execute + 全 completed → None（执行中无审核门）
    - norev-miss：无 progress 行 → None（join 不命中 fallback）
    updated_at 各异（避免排序影响 filter 计数断言）。
    """
    from app.modules.change.model import Change
    from app.modules.platform_sync.model import PlatformChangeProgressORM
    from app.modules.workspace.model import Workspace

    ws = Workspace(
        id=uuid.uuid4(),
        name=f"rev-ws-{uuid.uuid4().hex[:6]}",
        slug=f"rev-ws-{uuid.uuid4().hex[:6]}",
        root_path=f"/tmp/rev-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    db_session.add(ws)
    base = datetime(2026, 2, 1, tzinfo=UTC)
    specs = [
        ("rev-plan", 0, "plan", {"plan"}, True),
        ("rev-verify", 1, "verify", {"verify"}, True),
        ("norev-execute", 2, "execute", {"brainstorm", "plan", "execute"}, True),
        ("norev-miss", 3, "plan", set(), False),
    ]
    by_key: dict[str, uuid.UUID] = {}
    for key, day, stage, completed, has_progress in specs:
        change = Change(
            id=uuid.uuid4(),
            workspace_id=ws.id,
            change_key=key,
            title=key,
            status="active",
            location="active",
            path=f"changes/{key}",
            current_stage=stage,
            updated_at=base + timedelta(days=day),
        )
        db_session.add(change)
        by_key[key] = change.id
        if has_progress:
            db_session.add(
                PlatformChangeProgressORM(
                    workspace_id=ws.id,
                    change_name=key,
                    latest_progress=_progress_with(stage, completed),
                    last_pushed_at="2026-08-13T00:00:00Z",
                    last_pusher="agent",
                )
            )
    await db_session.commit()
    return {"ws_id": ws.id, "by_key": by_key}


async def test_list_default_sort_is_updated_at_desc(
    client, db_session, auth_headers: dict[str, str]
) -> None:
    """默认排序 = updated_at desc（R-05 有意行为变化，取代旧 change_key asc）。"""
    seeded = await _seed_sortable_workspace(db_session)
    resp = await client.get(
        f"/api/workspaces/{seeded['ws_id']}/changes",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    keys = [i["change_key"] for i in resp.json()["items"]]
    assert keys == ["gamma-sort", "beta-sort", "alpha-sort"]  # 最近活动优先


async def test_list_sort_updated_at_asc(client, db_session, auth_headers: dict[str, str]) -> None:
    """sort=updated_at_asc → 升序（最早活动优先）。"""
    seeded = await _seed_sortable_workspace(db_session)
    resp = await client.get(
        f"/api/workspaces/{seeded['ws_id']}/changes",
        params={"sort": "updated_at_asc"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    keys = [i["change_key"] for i in resp.json()["items"]]
    assert keys == ["alpha-sort", "beta-sort", "gamma-sort"]


async def test_list_sort_change_key(client, db_session, auth_headers: dict[str, str]) -> None:
    """sort=change_key → 字母序（兼容旧排序）。"""
    seeded = await _seed_sortable_workspace(db_session)
    resp = await client.get(
        f"/api/workspaces/{seeded['ws_id']}/changes",
        params={"sort": "change_key"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    keys = [i["change_key"] for i in resp.json()["items"]]
    assert keys == ["alpha-sort", "beta-sort", "gamma-sort"]


async def test_list_sort_unknown_value_falls_back_to_default(
    client, db_session, auth_headers: dict[str, str]
) -> None:
    """sort=未知值 → fallback 默认 updated_at desc（§9 不抛、不注入）。"""
    seeded = await _seed_sortable_workspace(db_session)
    resp = await client.get(
        f"/api/workspaces/{seeded['ws_id']}/changes",
        params={"sort": "DROP TABLE users;--"},
        headers=auth_headers,
    )
    assert resp.status_code == 200  # 不报错
    keys = [i["change_key"] for i in resp.json()["items"]]
    assert keys == ["gamma-sort", "beta-sort", "alpha-sort"]  # fallback desc


async def test_list_pending_review_only_filters(
    client, db_session, auth_headers: dict[str, str]
) -> None:
    """pending_review_only=true → 只返 pending_review 非空；total=过滤后数量（D-002）。"""
    seeded = await _seed_review_workspace(db_session)
    resp = await client.get(
        f"/api/workspaces/{seeded['ws_id']}/changes",
        params={"pending_review_only": "true"},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    keys = {i["change_key"] for i in body["items"]}
    assert keys == {"rev-plan", "rev-verify"}  # 只剩 pending_review 非空两条
    assert body["total"] == 2
    # 每条 pending_review 字段非空
    for item in body["items"]:
        assert item["pending_review"] is not None


async def test_list_pending_review_only_default_false_returns_all(
    client, db_session, auth_headers: dict[str, str]
) -> None:
    """pending_review_only 默认 False（兼容旧调用方）→ 返全部，total=全部。"""
    seeded = await _seed_review_workspace(db_session)
    resp = await client.get(
        f"/api/workspaces/{seeded['ws_id']}/changes",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 4  # 全部 4 条
    keys = {i["change_key"] for i in body["items"]}
    assert keys == {"rev-plan", "rev-verify", "norev-execute", "norev-miss"}


async def test_list_response_items_contain_pending_review_field(
    client, db_session, auth_headers: dict[str, str]
) -> None:
    """ChangeSummary 响应体含 pending_review 字段（task-01 schema + task-02 透传验证）。"""
    seeded = await _seed_review_workspace(db_session)
    resp = await client.get(
        f"/api/workspaces/{seeded['ws_id']}/changes",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    items = resp.json()["items"]
    by_key = {i["change_key"]: i for i in items}
    # rev-plan：plan + {plan} → plan_review（_map D-004@v2）
    assert by_key["rev-plan"]["pending_review"] == "plan_review"
    # rev-verify：verify + {verify} → human_test
    assert by_key["rev-verify"]["pending_review"] == "human_test"
    # norev-* → None
    assert by_key["norev-execute"]["pending_review"] is None
    assert by_key["norev-miss"]["pending_review"] is None
