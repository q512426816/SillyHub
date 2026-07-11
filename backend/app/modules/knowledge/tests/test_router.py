"""HTTP-level tests for the knowledge / quicklog router."""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path

import pytest

from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace

COMPONENT_FIXTURES = Path(__file__).parent.parent.parent / "change" / "tests" / "fixtures" / "valid"


def _copy_fixture(src: Path, tmp_path: Path, name: str = "ws") -> Path:
    dst = tmp_path / name
    shutil.copytree(src, dst)
    return dst


@pytest.fixture()
async def workspace_with_knowledge(
    client, db_session, tmp_path: Path, auth_headers: dict[str, str]
) -> dict:
    root = _copy_fixture(COMPONENT_FIXTURES, tmp_path)

    # task-09（2026-07-10-remove-server-local-workspace-mode）：扁平布局——knowledge/
    # quicklog/ 直接在 spec_root 下（daemon-client 同步产出，无 .sillyspec 包裹）。
    knowledge_dir = root / "knowledge"
    knowledge_dir.mkdir(parents=True, exist_ok=True)
    (knowledge_dir / "INDEX.md").write_text(
        "# Knowledge Index\n\n> Reference document.\n",
        encoding="utf-8",
    )
    (knowledge_dir / "uncategorized.md").write_text(
        "# Uncategorized\n\nSome uncategorized knowledge.\n",
        encoding="utf-8",
    )

    quicklog_dir = root / "quicklog"
    quicklog_dir.mkdir(parents=True, exist_ok=True)
    (quicklog_dir / "2026-01-15.md").write_text(
        "# Quicklog 2026-01-15\n\n- Fixed bug X\n- Added feature Y\n",
        encoding="utf-8",
    )

    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "knowledge-test", "root_path": str(root)},
        headers=auth_headers,
    )
    assert ws_resp.status_code == 201, ws_resp.text
    ws_id = ws_resp.json()["id"]

    # task-09：HTTP 创建会 bootstrap spec_ws.spec_root = {spec_data_root}/{ws_id}（非
    # root_path）。扁平布局下 parser 读 spec_ws.spec_root/knowledge/，故把 spec_root
    # 重定向到固件写入的 root（测试隔离，不影响生产语义）。
    from sqlmodel import select

    spec_ws = (
        await db_session.execute(
            select(SpecWorkspace).where(SpecWorkspace.workspace_id == uuid.UUID(ws_id))
        )
    ).scalar_one()
    spec_ws.spec_root = str(root)
    await db_session.commit()

    return {"ws_id": ws_id}


async def test_list_knowledge(
    client, workspace_with_knowledge: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/knowledge",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 2
    filenames = [item["filename"] for item in body["items"]]
    assert "INDEX.md" in filenames
    assert "uncategorized.md" in filenames


async def test_get_knowledge_detail(
    client, workspace_with_knowledge: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/knowledge/INDEX.md",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["filename"] == "INDEX.md"
    assert body["title"] == "Knowledge Index"
    assert body["content"] is not None
    assert "Reference document" in body["content"]


async def test_get_knowledge_not_found(
    client, workspace_with_knowledge: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/knowledge/nonexistent.md",
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_list_knowledge_no_content_in_list(
    client, workspace_with_knowledge: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/knowledge",
        headers=auth_headers,
    )
    body = resp.json()
    for item in body["items"]:
        assert item["content"] is None


async def test_list_quicklog(
    client, workspace_with_knowledge: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/quicklog",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["filename"] == "2026-01-15.md"


async def test_get_quicklog_detail(
    client, workspace_with_knowledge: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/quicklog/2026-01-15.md",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["title"] == "Quicklog 2026-01-15"
    assert "Fixed bug X" in body["content"]


async def test_get_quicklog_not_found(
    client, workspace_with_knowledge: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/quicklog/nonexistent.md",
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_knowledge_no_auth_returns_401(client, workspace_with_knowledge: dict) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(f"/api/workspaces/{ws_id}/knowledge")
    assert resp.status_code == 401


async def test_quicklog_no_auth_returns_401(client, workspace_with_knowledge: dict) -> None:
    ws_id = workspace_with_knowledge["ws_id"]
    resp = await client.get(f"/api/workspaces/{ws_id}/quicklog")
    assert resp.status_code == 401


async def test_unknown_workspace_knowledge_returns_404(
    client, auth_headers: dict[str, str]
) -> None:
    resp = await client.get(
        "/api/workspaces/00000000-0000-0000-0000-000000000000/knowledge",
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_empty_knowledge_directory(
    client, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    root = _copy_fixture(COMPONENT_FIXTURES, tmp_path, "empty-k")
    knowledge_dir = root / ".sillyspec" / "knowledge"
    knowledge_dir.mkdir(parents=True, exist_ok=True)

    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "empty-k", "root_path": str(root)},
        headers=auth_headers,
    )
    ws_id = ws_resp.json()["id"]

    resp = await client.get(
        f"/api/workspaces/{ws_id}/knowledge",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json()["total"] == 0


async def test_daemon_client_knowledge_reads_platform_spec_root(
    client,
    db_session,
    tmp_path: Path,
    auth_headers: dict[str, str],
) -> None:
    spec_root = tmp_path / "platform-spec"
    knowledge_dir = spec_root / "knowledge"
    knowledge_dir.mkdir(parents=True, exist_ok=True)
    (knowledge_dir / "INDEX.md").write_text(
        "# Platform Knowledge\n\nDaemon-client content.",
        encoding="utf-8",
    )

    ws = Workspace(
        id=uuid.uuid4(),
        name="daemon-client-knowledge",
        slug=f"daemon-client-knowledge-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "client-machine-path"),
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)

    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        spec_root=str(spec_root),
        strategy="platform-managed",
        sync_status="clean",
    )
    db_session.add(spec_ws)
    await db_session.commit()

    resp = await client.get(
        f"/api/workspaces/{ws.id}/knowledge",
        headers=auth_headers,
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["total"] == 1
    assert body["items"][0]["filename"] == "INDEX.md"
    assert body["items"][0]["title"] == "Platform Knowledge"
