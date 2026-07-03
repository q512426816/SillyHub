"""HTTP-level tests for the runtime router."""

from __future__ import annotations

import shutil
import sqlite3
import uuid
from datetime import UTC, datetime
from pathlib import Path

import pytest

from app.modules.runtime.service import RuntimeService
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace

COMPONENT_FIXTURES = Path(__file__).parent.parent.parent / "change" / "tests" / "fixtures" / "valid"


def _copy_fixture(src: Path, tmp_path: Path, name: str = "ws") -> Path:
    dst = tmp_path / name
    shutil.copytree(src, dst)
    return dst


def _create_test_db(db_path: Path) -> None:
    """Create a test sillyspec.db with sample progress data."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    try:
        # Create tables
        conn.execute(
            """
            CREATE TABLE project (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL
            )
        """
        )
        conn.execute("INSERT INTO project (id, name) VALUES (1, 'test-project')")

        conn.execute(
            """
            CREATE TABLE changes (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL,
                current_stage TEXT,
                status TEXT,
                last_active TEXT,
                created_at TEXT
            )
        """
        )
        now = datetime.now(UTC).isoformat()
        conn.execute(
            """
            INSERT INTO changes (name, current_stage, status, last_active, created_at)
            VALUES ('change-001', 'execute', 'in_progress', ?, ?)
        """,
            (now, now),
        )

        conn.execute(
            """
            CREATE TABLE stages (
                id INTEGER PRIMARY KEY,
                change_id INTEGER,
                stage TEXT NOT NULL,
                status TEXT,
                started_at TEXT,
                completed_at TEXT,
                FOREIGN KEY (change_id) REFERENCES changes(id)
            )
        """
        )
        conn.execute(
            """
            INSERT INTO stages (change_id, stage, status, started_at, completed_at)
            VALUES (
                (SELECT id FROM changes WHERE name = 'change-001'),
                'scan',
                'completed',
                '2026-01-01T00:00:00Z',
                '2026-01-01T00:01:00Z'
            )
        """
        )
        conn.execute(
            """
            INSERT INTO stages (change_id, stage, status, started_at, completed_at)
            VALUES (
                (SELECT id FROM changes WHERE name = 'change-001'),
                'execute',
                'in_progress',
                '2026-01-01T00:02:00Z',
                NULL
            )
        """
        )

        conn.execute(
            """
            CREATE TABLE steps (
                id INTEGER PRIMARY KEY,
                stage_id INTEGER,
                ordering INTEGER,
                name TEXT NOT NULL,
                status TEXT,
                output TEXT,
                completed_at TEXT,
                FOREIGN KEY (stage_id) REFERENCES stages(id)
            )
        """
        )
        conn.execute(
            """
            INSERT INTO steps (stage_id, ordering, name, status, completed_at)
            VALUES (
                (SELECT id FROM stages WHERE stage = 'execute'),
                1,
                'step-1',
                'completed',
                '2026-01-01T00:02:30Z'
            )
        """
        )

        conn.commit()
    finally:
        conn.close()


@pytest.fixture()
async def workspace_with_runtime(client, tmp_path: Path, auth_headers: dict[str, str]) -> dict:
    from app.core.config import get_settings

    root = _copy_fixture(COMPONENT_FIXTURES, tmp_path)

    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "runtime-test", "root_path": str(root)},
        headers=auth_headers,
    )
    assert ws_resp.status_code == 201, ws_resp.text
    ws_id = ws_resp.json()["id"]

    # Create sillyspec.db in platform storage
    # Use the same spec_data_root as configured in Settings
    settings = get_settings()
    platform_runtime_dir = Path(settings.spec_data_root) / ws_id / ".sillyspec" / ".runtime"
    platform_runtime_dir.mkdir(parents=True, exist_ok=True)
    _create_test_db(platform_runtime_dir / "sillyspec.db")

    return {"ws_id": ws_id}


async def test_get_runtime_progress(
    client, workspace_with_runtime: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = workspace_with_runtime["ws_id"]
    resp = await client.get(
        f"/api/workspaces/{ws_id}/runtime",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    body = resp.json()
    # SQLite (_version: 4) uses different field names than legacy progress.json
    assert body["version"] == 4
    assert body["project"] == "test-project"
    assert body["current_stage"] == "execute"
    assert body["current_change"] == "change-001"
    assert "scan" in body["stages"]
    assert body["stages"]["scan"]["status"] == "completed"
    assert "execute" in body["stages"]
    assert body["stages"]["execute"]["status"] == "in_progress"


async def test_get_runtime_missing_file(
    client, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    root = _copy_fixture(COMPONENT_FIXTURES, tmp_path, "no-runtime")
    runtime_dir = root / ".sillyspec" / ".runtime"
    runtime_dir.mkdir(parents=True, exist_ok=True)

    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "no-runtime", "root_path": str(root)},
        headers=auth_headers,
    )
    assert ws_resp.status_code == 201
    ws_id = ws_resp.json()["id"]

    resp = await client.get(
        f"/api/workspaces/{ws_id}/runtime",
        headers=auth_headers,
    )
    assert resp.status_code == 200
    assert resp.json() is None


async def test_no_auth_returns_401(client, tmp_path: Path, auth_headers: dict[str, str]) -> None:
    root = _copy_fixture(COMPONENT_FIXTURES, tmp_path)
    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "auth-test", "root_path": str(root)},
        headers=auth_headers,
    )
    ws_id = ws_resp.json()["id"]

    resp = await client.get(f"/api/workspaces/{ws_id}/runtime")
    assert resp.status_code == 401


async def test_unknown_workspace_returns_404(client, auth_headers: dict[str, str]) -> None:
    resp = await client.get(
        "/api/workspaces/00000000-0000-0000-0000-000000000000/runtime",
        headers=auth_headers,
    )
    assert resp.status_code == 404


async def test_daemon_client_reads_flat_platform_runtime_dir(db_session, tmp_path: Path) -> None:
    spec_root = tmp_path / "platform-spec"
    _create_test_db(spec_root / ".runtime" / "sillyspec.db")

    # A wrapped runtime DB with different contents must be ignored for daemon-client mode.
    wrapped_db = spec_root / ".sillyspec" / ".runtime" / "sillyspec.db"
    _create_test_db(wrapped_db)
    conn = sqlite3.connect(str(wrapped_db))
    try:
        conn.execute("UPDATE changes SET name = 'wrong-wrapped-change'")
        conn.commit()
    finally:
        conn.close()

    ws = Workspace(
        id=uuid.uuid4(),
        name="daemon-client-runtime",
        slug=f"daemon-client-runtime-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "client-machine-path"),
        path_source="daemon-client",
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

    progress = await RuntimeService(db_session).get_progress(ws.id)

    assert progress is not None
    assert progress.current_change == "change-001"


async def test_daemon_client_repo_native_uses_spec_root(db_session, tmp_path: Path) -> None:
    """daemon-client + repo-native 组合验证：root 强制走 spec_root 而非 workspace.root_path。

    修复 task-16: daemon-client workspace 无视 strategy 强制走 spec_root，
    避免 fallback 到 workspace.root_path（宿主机路径，后端容器访问不到）。
    """
    spec_root = tmp_path / "server-spec-root"
    _create_test_db(spec_root / ".runtime" / "sillyspec.db")

    ws = Workspace(
        id=uuid.uuid4(),
        name="dc-repo-native",
        slug=f"dc-repo-native-{uuid.uuid4().hex[:8]}",
        # root_path 设为不存在的路径，模拟 Windows 宿主路径不可访问
        root_path=str(tmp_path / "nonexistent-host-path"),
        path_source="daemon-client",
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)

    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        spec_root=str(spec_root),
        strategy="repo-native",
        sync_status="clean",
    )
    db_session.add(spec_ws)
    await db_session.commit()

    progress = await RuntimeService(db_session).get_progress(ws.id)

    assert progress is not None
    assert progress.current_change == "change-001"
    assert progress.project == "test-project"


async def test_non_daemon_client_without_spec_root_uses_root_path(
    db_session, tmp_path: Path
) -> None:
    """非 daemon-client + 无 spec_ws 时回退到 workspace.root_path（向后兼容）。"""
    sillyspec_dir = tmp_path / "workspace-root" / ".sillyspec" / ".runtime"
    _create_test_db(sillyspec_dir / "sillyspec.db")

    ws = Workspace(
        id=uuid.uuid4(),
        name="local-ws",
        slug=f"local-ws-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "workspace-root"),
        path_source="server-local",
        status="active",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)

    # No SpecWorkspace row — simulate pre-scan state
    progress = await RuntimeService(db_session).get_progress(ws.id)

    assert progress is not None
    assert progress.current_change == "change-001"
