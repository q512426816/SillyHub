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
async def workspace_with_changes(
    client, tmp_path: Path, auth_headers: dict[str, str], seed_spec_root_fn
) -> dict:
    """2026-07-10-remove-server-local-workspace-mode: fixture 落到服务器 spec_root
    （扁平布局），backend 才能读 change 文件树。"""
    root = _copy_fixtures(COMPONENT_FIXTURES, tmp_path)
    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "files-test", "root_path": str(root)},
        headers=auth_headers,
    )
    assert ws_resp.status_code == 201, ws_resp.text
    ws_id = ws_resp.json()["id"]
    # COMPONENT_FIXTURES（包裹式）展平到 spec_root
    spec_root = seed_spec_root_fn(ws_id, COMPONENT_FIXTURES)
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
    # 间歇兜底:copytree 刚写入的新文件首扫 reparse 偶发 parsed=0（fs 时序/锁，全量低 worker
    # 并发下更易触发）。对齐 task/test_router.py 的既定模式：items 空则重扫一次再取。
    if not items:
        await client.post(f"/api/workspaces/{ws_id}/changes/reparse", headers=auth_headers)
        list_resp = await client.get(f"/api/workspaces/{ws_id}/changes", headers=auth_headers)
        items = list_resp.json()["items"]
    assert len(items) > 0
    return {
        "ws_id": ws_id,
        "change_id": items[0]["id"],
        "change_key": items[0]["change_key"],
        "root": root,
        "spec_root": str(spec_root),
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


async def test_resync_change_docs_refreshes_title_and_documents(
    client,
    db_session,
    workspace_with_changes: dict,
    auth_headers: dict[str, str],
) -> None:
    """task-01（perf-remediation）行为保持锚点：_resync_change_docs 解析移入线程后，
    仍刷新 change.title（proposal.md 首个 ``# `` heading）与 ChangeDocument 行。

    service 级直调（绕过 write_file 的 runtime 解析——daemon-client 绑定链路
    与本 task 无关，200 拉起成本不成比例）。db_session 与 client 同库
    （test_enqueue_edit_write_merges_same_path 同款范式）。
    """
    from app.modules.change.service import ChangeService

    ws_id = workspace_with_changes["ws_id"]
    change_id = workspace_with_changes["change_id"]
    detail = await client.get(f"/api/workspaces/{ws_id}/changes/{change_id}", headers=auth_headers)
    assert detail.status_code == 200, detail.text
    body = detail.json()
    # change.path 是相对 spec_root 的真实路径（active 含 changes/ 前缀，archive 含
    # archive/ 段），用它拼 proposal.md（对齐 service._resolve_change_dir）。
    change_rel_path = body["path"]
    assert change_rel_path, body

    # 改盘上 proposal.md 的 heading（fixture 初始标题 → 改后标题）
    spec_root = workspace_with_changes["spec_root"]
    proposal = Path(spec_root) / change_rel_path / "proposal.md"
    assert proposal.is_file(), proposal
    proposal.write_text("# 线程化后的新标题\n\n正文\n", encoding="utf-8")

    svc = ChangeService(db_session)
    await svc._resync_change_docs(uuid.UUID(ws_id), uuid.UUID(change_id))

    # title 跟上 heading；documents 端点返回刷新后的 doc 矩阵（proposal 行存在）
    detail2 = await client.get(f"/api/workspaces/{ws_id}/changes/{change_id}", headers=auth_headers)
    assert detail2.status_code == 200, detail2.text
    assert detail2.json()["title"] == "线程化后的新标题"

    docs_resp = await client.get(
        f"/api/workspaces/{ws_id}/changes/{change_id}/documents", headers=auth_headers
    )
    assert docs_resp.status_code == 200, docs_resp.text
    doc_paths = [d["path"] for d in docs_resp.json()["documents"]]
    assert any(p.endswith("proposal.md") for p in doc_paths)


# ── task-06（perf-remediation）：_list_files_sync scandir 单遍 + _safe_mtime ──


class TestListFilesSyncScandir:
    """_list_files_sync 改 os.scandir 单遍（照 ql-008 范式）后的行为保持。"""

    def _make_tree(self, base: Path) -> Path:
        change_dir = base / "changes" / "demo"
        (change_dir / "tasks").mkdir(parents=True)
        (change_dir / "proposal.md").write_text("# Demo", encoding="utf-8")
        (change_dir / "design.md").write_text("# Design", encoding="utf-8")
        (change_dir / "tasks" / "task-01.md").write_text("- [ ] t1", encoding="utf-8")
        # 排除项：隐藏文件、隐藏目录、__pycache__、子目录里各一个
        (change_dir / ".hidden.md").write_text("hidden", encoding="utf-8")
        hidden_dir = change_dir / ".runtime"
        hidden_dir.mkdir()
        (hidden_dir / "x.md").write_text("x", encoding="utf-8")
        pycache = change_dir / "__pycache__"
        pycache.mkdir()
        (pycache / "m.pyc").write_text("", encoding="utf-8")
        return change_dir

    def test_tree_equivalence(self, tmp_path: Path) -> None:
        """同目录树结果与 rglob 版等价：路径集合 / 排序 / 字段完整 / 排除项生效。"""
        import os

        from app.modules.change.service import ChangeService

        change_dir = self._make_tree(tmp_path)
        # 钉死 mtime 便于断言（scandir follow_symlinks=False 与 rglob（跟随）在
        # 无 symlink 场景行为等价——树里没有 symlink）
        for p in change_dir.rglob("*"):
            if p.is_file():
                os.utime(p, (1_700_000_000, 1_700_000_000))

        items = ChangeService._list_files_sync(change_dir)

        # 排序与 rglob+sorted 等价：posix 路径字典序。注意排除语义是**文件名**级：
        # 隐藏目录（.runtime/）里的非隐藏文件（x.md）原实现同样包含——锚定该行为
        assert [it["path"] for it in items] == [
            ".runtime/x.md",
            "design.md",
            "proposal.md",
            "tasks/task-01.md",
        ]
        # 字段完整
        assert all(
            {"path", "name", "size", "last_modified_at", "is_text"} == set(it) for it in items
        )
        # is_text / size / mtime 取值正确（mtime 来自钉死的 utime）
        from datetime import UTC, datetime

        by_path = {it["path"]: it for it in items}
        assert by_path["design.md"]["is_text"] is True
        assert by_path["design.md"]["size"] == 8  # "# Design"
        assert by_path["design.md"]["last_modified_at"] == datetime.fromtimestamp(
            1_700_000_000, tz=UTC
        )
        # 隐藏文件本体与 __pycache__（含子目录里的）排除
        assert not any(it["name"].startswith(".") or "__pycache__" in it["path"] for it in items)

    def test_missing_dir_returns_empty(self, tmp_path: Path) -> None:
        from app.modules.change.service import ChangeService

        assert ChangeService._list_files_sync(tmp_path / "nope") == []

    def test_dirty_mtime_falls_back(self, tmp_path: Path) -> None:
        """mtime 脏值（os.utime 造 year 30828 级真实脏 mtime）不炸，走 _safe_mtime 兜底。"""
        import os
        from datetime import UTC, datetime

        from app.modules.change.service import ChangeService

        change_dir = tmp_path / "changes" / "dirty"
        change_dir.mkdir(parents=True)
        target = change_dir / "proposal.md"
        target.write_text("# Dirty", encoding="utf-8")
        dirty = 9.1e11  # 两平台 fromtimestamp 均越界（ql-20260814-006 实测量级）
        os.utime(target, (dirty, dirty))
        on_disk = target.stat().st_mtime
        if on_disk != dirty:
            # Linux ext4 / macOS APFS 内核时间戳上限（公元 2446/2554 年）低于
            # datetime 越界点（year 9999），越界值被钳制为合法 mtime 落盘——
            # 护栏分支在本文件系统上无法用真实文件触发，只 NTFS 可真实落脏值
            pytest.skip(
                f"filesystem clamps out-of-range mtime ({dirty} -> {on_disk}); "
                "dirty-mtime fallback untestable on this platform"
            )
        assert target.stat().st_mtime == dirty

        with pytest.raises((ValueError, OverflowError, OSError)):
            datetime.fromtimestamp(target.stat().st_mtime, tz=UTC)  # 旧实现在此炸

        items = ChangeService._list_files_sync(change_dir)
        assert len(items) == 1
        assert items[0]["last_modified_at"] == datetime(1970, 1, 1, tzinfo=UTC)
