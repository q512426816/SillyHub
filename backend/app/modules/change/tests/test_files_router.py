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
    root = _copy_fixtures(COMPONENT_FIXTURES, tmp_path)
    sillyspec_changes = root / ".sillyspec" / "changes"
    shutil.copytree(CHANGE_FIXTURES, sillyspec_changes)
    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "files-test", "root_path": str(root)},
        headers=auth_headers,
    )
    assert ws_resp.status_code == 201, ws_resp.text
    ws_id = ws_resp.json()["id"]
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


async def test_write_file_server_local(
    client, workspace_with_changes: dict, auth_headers: dict[str, str]
) -> None:
    """server-local 分支：POST 返 done + 内容可经 API 回读（写到平台镜像）。"""
    ws_id = workspace_with_changes["ws_id"]
    change_id = workspace_with_changes["change_id"]
    resp = await client.post(
        f"/api/workspaces/{ws_id}/changes/{change_id}/files/content",
        json={"path": "MASTER.md", "content": "# Edited\n\n新内容"},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["status"] == "done"  # server-local 同步返 done
    assert body["task_id"] is None
    # 列文件确认 MASTER.md 在树中
    list_resp = await client.get(
        f"/api/workspaces/{ws_id}/changes/{change_id}/files",
        headers=auth_headers,
    )
    paths = [it["path"] for it in list_resp.json()["items"]]
    assert "MASTER.md" in paths
    # 经 API 回读验证内容已落盘到镜像
    read_resp = await client.get(
        f"/api/workspaces/{ws_id}/changes/{change_id}/files/content",
        params={"path": "MASTER.md"},
        headers=auth_headers,
    )
    assert read_resp.status_code == 200
    assert "新内容" in (read_resp.json()["content"] or ""), read_resp.json()


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
    from app.modules.daemon.model import DaemonChangeWrite, DaemonRuntime

    # 构造 user + daemon runtime + daemon-client workspace + change
    user = (await db_session.execute(select(User).limit(1))).scalar_one()
    runtime = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user.id,
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
        path_source="daemon-client",
        daemon_runtime_id=runtime.id,
    )
    db_session.add(ws)
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
        workspace=ws, change=change, rel_path="proposal.md", content="v1"
    )
    tid2 = await svc._enqueue_edit_write(
        workspace=ws, change=change, rel_path="proposal.md", content="v2"
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
        workspace=ws, change=change, rel_path="design.md", content="d"
    )
    assert tid3 != tid1
    rows = list((await db_session.execute(select(DaemonChangeWrite))).scalars().all())
    assert len(rows) == 2
