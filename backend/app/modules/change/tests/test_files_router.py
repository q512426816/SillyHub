"""Tests for change file tree endpoints (task-13/14, 2026-07-02-change-detail-file-tree-editor)."""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pytest

COMPONENT_FIXTURES = Path(__file__).parent / "fixtures" / "valid"
CHANGE_FIXTURES = Path(__file__).parent / "fixtures" / "changes"


def _copy_fixtures(src: Path, tmp_path: Path, name: str = "ws") -> Path:
    dst = tmp_path / name
    shutil.copytree(src, dst)
    return dst


@pytest.fixture()
async def workspace_with_changes(client, tmp_path: Path, auth_headers: dict[str, str]) -> dict:
    """2026-07-10-remove-server-local-workspace-mode: fixture 落到服务器 spec_root
    （扁平布局），backend 才能读 change 文件树。"""
    from conftest import seed_spec_root

    root = _copy_fixtures(COMPONENT_FIXTURES, tmp_path)
    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "files-test", "root_path": str(root)},
        headers=auth_headers,
    )
    assert ws_resp.status_code == 201, ws_resp.text
    ws_id = ws_resp.json()["id"]
    # COMPONENT_FIXTURES（包裹式）展平到 spec_root
    spec_root = seed_spec_root(ws_id, COMPONENT_FIXTURES)
    # CHANGE_FIXTURES 覆盖到 spec_root/changes/
    changes_root = Path(spec_root) / "changes"
    changes_root.mkdir(parents=True, exist_ok=True)
    shutil.copytree(CHANGE_FIXTURES, changes_root, dirs_exist_ok=True)
    # 手动 reparse（auto-reparse 时 spec_root 空）
    await client.post(f"/api/workspaces/{ws_id}/changes/reparse", headers=auth_headers)
    # 取第一个 change id
    list_resp = await client.get(f"/api/workspaces/{ws_id}/changes", headers=auth_headers)
    assert list_resp.status_code == 200
    items = list_resp.json()["items"]
    assert len(items) > 0
    return {
        "ws_id": ws_id,
        "change_id": items[0]["id"],
        "change_key": items[0]["change_key"],
        "root": root,
    }


async def test_list_files(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_changes["ws_id"]
    change_id = workspace_with_changes["change_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes/{change_id}/files",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["change_id"] == change_id
    paths = [it["path"] for it in body["items"]]
    # fixtures 含 .md 文件
    assert any(p.endswith(".md") for p in paths)
    # 排除隐藏文件
    assert not any(p.startswith(".") for p in paths)
    # is_text 标记正确
    md = next(it for it in body["items"] if it["path"].endswith(".md"))
    assert md["is_text"] is True


async def test_read_file_content(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_changes["ws_id"]
    change_id = workspace_with_changes["change_id"]
    list_resp = await client.get(
        f"/api/workspaces/{ws_id}/changes/{change_id}/files",
        headers=auth_headers,
    )
    md_path = next(it["path"] for it in list_resp.json()["items"] if it["path"].endswith(".md"))
    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes/{change_id}/files/content",
        params={"path": md_path},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["exists"] is True
    assert body["path"] == md_path
    assert isinstance(body["content"], str) and len(body["content"]) > 0


async def test_read_file_traversal_rejected(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_changes["ws_id"]
    change_id = workspace_with_changes["change_id"]
    for evil in ["../../../etc/passwd", "/etc/passwd"]:
        resp = await client.get(
            f"/api/workspaces/{ws_id}/changes/{change_id}/files/content",
            params={"path": evil},
            headers=auth_headers,
        )
        assert resp.status_code == 404, f"{evil} should be rejected"


async def test_write_file_traversal_rejected(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_changes["ws_id"]
    change_id = workspace_with_changes["change_id"]
    resp = await client.post(
        f"/api/workspaces/{ws_id}/changes/{change_id}/files/content",
        json={"path": "../../escape.md", "content": "x"},
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_pending_files_empty_server_local(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    """server-local 无 outbox，pending 列表为空。"""
    ws_id = workspace_with_changes["ws_id"]
    change_id = workspace_with_changes["change_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/changes/{change_id}/files/pending",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["items"] == []


# ── outbox 合并 + 离线续传（task-14 / D-001/002）service 级 ──────────────


async def test_enqueue_edit_write_merges_same_path(
    client, db_session, auth_headers: dict[str, str], tmp_path: Path
) -> None:
    """D-002：同 change_key+path 二次入队合并为单条 pending 行（更新 content）。

    直接构造 daemon-client workspace + Change，调 ChangeService._enqueue_edit_write。
    """
    from sqlalchemy import select

    from app.modules.auth.model import User
    from app.modules.change.model import Change
    from app.modules.change.service import ChangeService
    from app.modules.daemon.model import DaemonChangeWrite, DaemonInstance, DaemonRuntime
    from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

    # 构造 user + daemon_instance + runtime + daemon-client workspace + binding + change
    user = (await db_session.execute(select(User).limit(1))).scalar_one()
    di = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user.id,
        hostname="dc-host",
        server_url="http://localhost:8000",
        status="online",
    )
    db_session.add(di)
    await db_session.flush()
    runtime = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user.id,
        daemon_instance_id=di.id,
        provider="claude",
        status="online",
    )
    db_session.add(runtime)
    from app.modules.workspace.model import Workspace

    ws = Workspace(
        id=uuid.uuid4(),
        name="dc-ws",
        slug="dc-ws",
        root_path=str(tmp_path),
    )
    db_session.add(ws)
    await db_session.flush()
    db_session.add(
        WorkspaceMemberRuntime(
            workspace_id=ws.id,
            user_id=user.id,
            daemon_id=di.id,
            runtime_id=runtime.id,
            root_path=str(tmp_path),
            path_source="daemon-client",
        )
    )
    change = Change(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        change_key="2026-07-02-test",
        title="t",
        status="active",
        location="active",
        path="changes/2026-07-02-test",
    )
    db_session.add(change)
    await db_session.commit()

    svc = ChangeService(db_session)
    tid1 = await svc._enqueue_edit_write(
        workspace=ws, change=change, rel_path="proposal.md", content="v1", user_id=user.id
    )
    tid2 = await svc._enqueue_edit_write(
        workspace=ws, change=change, rel_path="proposal.md", content="v2", user_id=user.id
    )
    # D-002：合并 → 同一行 id，content=v2（last-write-wins）
    assert tid1 == tid2
    rows = list((await db_session.execute(select(DaemonChangeWrite))).scalars().all())
    assert len(rows) == 1
    assert rows[0].kind == "edit"
    assert rows[0].status == "pending"  # D-001 不 await 不翻 failed
    assert rows[0].files[0]["content"] == "v2"

    # 不同 path → 新建行
    tid3 = await svc._enqueue_edit_write(
        workspace=ws, change=change, rel_path="design.md", content="d", user_id=user.id
    )
    assert tid3 != tid1
    rows = list((await db_session.execute(select(DaemonChangeWrite))).scalars().all())
    assert len(rows) == 2
