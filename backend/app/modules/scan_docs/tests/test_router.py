"""HTTP-level tests for the scan docs router."""

from __future__ import annotations

from pathlib import Path

import pytest


def _make_sillyspec_workspace(tmp_path: Path, name: str = "ws") -> Path:
    """Create a minimal sillyspec workspace structure."""
    base = tmp_path / name
    sillyspec = base / ".sillyspec"
    (sillyspec / "projects").mkdir(parents=True)
    (sillyspec / "changes" / "change").mkdir(parents=True)
    (sillyspec / "changes" / "archive").mkdir(parents=True)
    return base


@pytest.fixture()
async def workspace_for_scan_docs(client, tmp_path: Path, auth_headers: dict[str, str]) -> dict:
    """Create a workspace suitable for scan docs testing."""
    root = _make_sillyspec_workspace(tmp_path)

    # Create workspace
    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "scan-docs-test", "root_path": str(root)},
        headers=auth_headers,
    )
    assert ws_resp.status_code == 201, ws_resp.text
    ws_id = ws_resp.json()["id"]

    return {"ws_id": ws_id}


async def test_list_empty_before_reparse(
    client, workspace_for_scan_docs: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_for_scan_docs["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/scan-docs",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["total"] == 0
    assert body["items"] == []


async def test_reparse_returns_ok(
    client, workspace_for_scan_docs: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_for_scan_docs["ws_id"]
    resp = await client.post(
        f"/api/workspaces/{ws_id}/scan-docs/reparse",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text


async def test_no_auth_returns_401(client, workspace_for_scan_docs: dict) -> None:
    ws_id = workspace_for_scan_docs["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/scan-docs",
    )
    assert resp.status_code == 401


async def test_unknown_workspace_returns_404(client, auth_headers: dict[str, str]) -> None:
    resp = await client.get(
        "/api/workspaces/00000000-0000-0000-0000-000000000000/scan-docs",
        headers=auth_headers,
    )
    assert resp.status_code == 404


# ── GET /scan-docs/{doc_id}/conflicts（task-04）──────────────────────────


async def _seed_scan_doc_with_conflict(
    client,
    db_session,
    tmp_path: Path,
    auth_headers: dict[str, str],
    *,
    n: int = 2,
) -> dict:
    """建一个工作区并直接往 scan_document + scan_doc_conflict_history 写数据。

    复用测试的 ``db_session``（与 ``client`` 共享同一 ``db_engine``）。
    """
    import uuid
    from datetime import UTC, datetime

    from app.modules.scan_docs.conflict_model import ScanDocConflictHistory
    from app.modules.scan_docs.model import ScanDocument

    base = tmp_path / "ws"
    sillyspec = base / ".sillyspec"
    (sillyspec / "projects").mkdir(parents=True)
    (sillyspec / "changes" / "change").mkdir(parents=True)
    (sillyspec / "changes" / "archive").mkdir(parents=True)

    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "scan-docs-conflict-test", "root_path": str(base)},
        headers=auth_headers,
    )
    assert ws_resp.status_code == 201, ws_resp.text
    ws_id = ws_resp.json()["id"]

    doc = ScanDocument(
        id=uuid.uuid4(),
        workspace_id=uuid.UUID(ws_id),
        doc_type="ARCH",
        path="docs/silly/scan/ARCH.md",
        title="t",
        exists=True,
        content="c",
    )
    db_session.add(doc)
    await db_session.flush()
    for i in range(n):
        db_session.add(
            ScanDocConflictHistory(
                id=uuid.uuid4(),
                workspace_id=uuid.UUID(ws_id),
                path=doc.path,
                old_content=f"old{i}",
                created_at=datetime.now(UTC),
            )
        )
    await db_session.commit()
    doc_id = doc.id

    return {"ws_id": ws_id, "doc_id": str(doc_id), "n": n}


async def test_list_conflicts_returns_history(
    client, db_session, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    seeded = await _seed_scan_doc_with_conflict(client, db_session, tmp_path, auth_headers, n=2)
    resp = await client.get(
        f"/api/workspaces/{seeded['ws_id']}/scan-docs/{seeded['doc_id']}/conflicts",
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert isinstance(body, list)
    assert len(body) == 2
    # 每条都有必要字段
    assert {"id", "old_content", "created_at"} <= set(body[0].keys())


async def test_list_conflicts_doc_not_found_404(
    client, db_session, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    seeded = await _seed_scan_doc_with_conflict(client, db_session, tmp_path, auth_headers, n=0)
    bogus = "00000000-0000-0000-0000-000000000000"
    resp = await client.get(
        f"/api/workspaces/{seeded['ws_id']}/scan-docs/{bogus}/conflicts",
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_list_conflicts_workspace_not_found_404(client, auth_headers: dict[str, str]) -> None:
    bogus_ws = "00000000-0000-0000-0000-000000000000"
    bogus_doc = "00000000-0000-0000-0000-000000000001"
    resp = await client.get(
        f"/api/workspaces/{bogus_ws}/scan-docs/{bogus_doc}/conflicts",
        headers=auth_headers,
    )
    assert resp.status_code == 404
