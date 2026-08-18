"""Tests for the incremental sync → change reparse trigger (task-02, D-005@v1).

Change 2026-08-14-change-center-conversation-driven task-02 / design §5 P1 / §7.5：
daemon 增量同步（``apply_ops``）落盘提交成功后，事务外 best-effort 触发 change
reparse，使 agent 会话新建的变更自动出现在 ``ux_changes`` 列表（命门链路）。覆盖：

- 有 ``change_dirs`` 标注 → scoped reparse（scope=非归档 name）
- 无标注（旧 daemon）→ ops 路径 ``changes/`` 前缀检测兜底
- **archive 路径的 op 为 delete/rename（目录跨根移动）→ 全量 reparse（scope=None）**
- 纯 add/update archive 文件 → scoped（归档 name；ql-20260818-009 收窄，不再全量）
- 非 changes 路径 → 零触发（R-01）
- reparse 失败仅告警，不阻断同步主流程（R-04）
- scoped 触发下范围外变更零删除（端到端，配合 change 模块 scoped 零删除守卫）

author: qinyi
created_at: 2026-08-14
"""

from __future__ import annotations

import base64
import shutil
import uuid
from pathlib import Path
from unittest.mock import AsyncMock

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.modules.change.model import Change
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.spec_workspace.schema import FileOp
from app.modules.workspace.model import Workspace


def _b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def _op(op: str, path: str, base_version: int = 0, **extra: object) -> dict[str, object]:
    d: dict[str, object] = {"op": op, "path": path, "base_version": base_version}
    d.update(extra)
    return d


async def _make_workspace(db_session) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="incremental-trigger ws",
        slug=f"itr-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/incremental-trigger-test-{uuid.uuid4().hex[:12]}",
        status="active",
        component_key="comp",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _make_spec_workspace(db_session, workspace: Workspace, spec_root: Path) -> SpecWorkspace:
    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=workspace.id,
        spec_root=str(spec_root),
        strategy="platform-managed",
        sync_status="clean",
    )
    db_session.add(spec_ws)
    await db_session.commit()
    await db_session.refresh(spec_ws)
    return spec_ws


def _seed_change(spec_root: Path, key: str, title: str = "# Change") -> None:
    """spec_root 下建一个最小变更目录（扁平布局，platform_managed=True）。"""
    d = spec_root / "changes" / key
    d.mkdir(parents=True, exist_ok=True)
    (d / "proposal.md").write_text(f"{title}\n", encoding="utf-8")


async def _fetch_change(db_session, ws_id: uuid.UUID, key: str) -> Change | None:
    return (
        (
            await db_session.execute(
                select(Change).where(
                    Change.workspace_id == ws_id,
                    Change.change_key == key,
                )
            )
        )
        .scalars()
        .first()
    )


async def _fetch_all_changes(db_session, ws_id: uuid.UUID) -> list[Change]:
    return list(
        (await db_session.execute(select(Change).where(Change.workspace_id == ws_id)))
        .scalars()
        .all()
    )


# ===========================================================================
# 有 change_dirs 标注 → scoped reparse（真实 reparse，变更自动出现）
# ===========================================================================


class TestAnnotatedScopedTrigger:
    async def test_change_dirs_creates_change_in_ux_changes(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """标注路径：增量同步带 change_dirs → 落盘后触发 scoped reparse → 变更自动出现。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={
                "ops": [
                    _op(
                        "add",
                        "changes/2026-08-15-foo/proposal.md",
                        base_version=0,
                        content=_b64("# Foo"),
                    )
                ],
                "change_dirs": ["2026-08-15-foo"],
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["ok"] is True

        change = await _fetch_change(db_session, ws.id, "2026-08-15-foo")
        assert change is not None
        assert change.title == "Foo"

    async def test_change_dirs_scoped_does_not_delete_out_of_scope(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """端到端零删除红线（R-08）：scoped 触发只扫 scope 内变更，范围外变更不删。

        预置 A/B 两变更（全量 reparse 建行）→ 删 B 目录 → 带 change_dirs=["A"] 增量
        同步 → 触发 scoped reparse（scope=["A"]）→ B 行保留、A 行更新。
        """
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        _seed_change(spec_root, "2026-08-14-keep", "# Keep")
        _seed_change(spec_root, "2026-08-14-remove", "# Remove")

        # 全量 reparse 建 A/B 两行
        from app.modules.change.service import ChangeService

        stats, _ = await ChangeService(db_session).reparse(ws.id)
        assert stats["created"] == 2
        assert await _fetch_change(db_session, ws.id, "2026-08-14-remove") is not None

        # 删除 B 目录（磁盘消失）→ 触发 scoped reparse 只扫 A
        shutil.rmtree(spec_root / "changes" / "2026-08-14-remove")

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={
                "ops": [
                    _op(
                        "update",
                        "changes/2026-08-14-keep/proposal.md",
                        base_version=0,
                        content=_b64("# Keep v2"),
                    )
                ],
                "change_dirs": ["2026-08-14-keep"],
            },
        )
        assert resp.status_code == 200, resp.text

        # B 行保留（scoped 零删除红线）；A 行更新
        assert await _fetch_change(db_session, ws.id, "2026-08-14-remove") is not None
        keep = await _fetch_change(db_session, ws.id, "2026-08-14-keep")
        assert keep is not None and keep.title == "Keep v2"


# ===========================================================================
# 无标注（旧 daemon）→ ops 路径 changes/ 前缀检测兜底
# ===========================================================================


class TestFallbackPathDetection:
    async def test_no_change_dirs_falls_back_to_path_detection(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """兜底路径：请求体无 change_dirs（旧 daemon）→ apply_ops 扫 ops 路径
        ``changes/`` 前缀取 name → scoped reparse，变更自动出现。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={
                "ops": [
                    _op(
                        "add",
                        "changes/2026-08-16-bar/proposal.md",
                        base_version=0,
                        content=_b64("# Bar"),
                    )
                ]
            },
        )
        assert resp.status_code == 200, resp.text

        change = await _fetch_change(db_session, ws.id, "2026-08-16-bar")
        assert change is not None
        assert change.title == "Bar"

    async def test_non_change_ops_zero_trigger(
        self, db_session, client: AsyncClient, auth_headers, tmp_path, monkeypatch
    ) -> None:
        """R-01 零触发：ops 只涉及非 changes 路径（docs/）→ 不触发 reparse。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        mock = AsyncMock(
            return_value=({"parsed": 0, "created": 0, "updated": 0, "deleted": 0}, None)
        )
        monkeypatch.setattr("app.modules.change.service.ChangeService.reparse", mock)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": [_op("add", "docs/A.md", base_version=0, content=_b64("# A"))]},
        )
        assert resp.status_code == 200, resp.text
        mock.assert_not_awaited()


# ===========================================================================
# 归档路径分流（ql-20260818-009 收窄）：delete/rename → 全量；纯 add/update → scoped
# ===========================================================================


class TestArchivePathScoping:
    async def test_archive_add_op_goes_scoped(
        self, db_session, client: AsyncClient, auth_headers, tmp_path, monkeypatch
    ) -> None:
        """ql-20260818-009：纯 add 于 ``changes/archive/`` → scoped（归档 name），不再全量。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        mock = AsyncMock(
            return_value=({"parsed": 0, "created": 0, "updated": 0, "deleted": 0}, None)
        )
        monkeypatch.setattr("app.modules.change.service.ChangeService.reparse", mock)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={
                "ops": [
                    _op(
                        "add",
                        "changes/archive/2026-08-13-old/proposal.md",
                        base_version=0,
                        content=_b64("# Old"),
                    )
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        mock.assert_awaited_once()
        # scoped：scope 为归档 name 列表，非 None（全量）
        assert mock.await_args.kwargs.get("scope") == ["2026-08-13-old"]

    async def test_archive_rename_op_triggers_full_reparse(
        self, db_session, client: AsyncClient, auth_headers, tmp_path, monkeypatch
    ) -> None:
        """rename 跨根移动入 ``changes/archive/``（真归档形态）→ 全量 reparse（scope=None）。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        mock = AsyncMock(
            return_value=({"parsed": 0, "created": 0, "updated": 0, "deleted": 0}, None)
        )
        monkeypatch.setattr("app.modules.change.service.ChangeService.reparse", mock)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={
                "ops": [
                    {
                        "op": "rename",
                        "path": "changes/2026-08-13-old/proposal.md",
                        "new_path": "changes/archive/2026-08-13-old/proposal.md",
                        "base_version": 0,
                        "content": _b64("# Old"),
                    }
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        mock.assert_awaited_once()
        assert mock.await_args.kwargs.get("scope") is None

    async def test_archive_delete_op_triggers_full_reparse(
        self, db_session, client: AsyncClient, auth_headers, tmp_path, monkeypatch
    ) -> None:
        """delete 于 ``changes/archive/``（归档区变更树形状变化）→ 全量 reparse（scope=None）。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        mock = AsyncMock(
            return_value=({"parsed": 0, "created": 0, "updated": 0, "deleted": 0}, None)
        )
        monkeypatch.setattr("app.modules.change.service.ChangeService.reparse", mock)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={
                "ops": [
                    _op(
                        "delete",
                        "changes/archive/2026-08-13-old/proposal.md",
                        base_version=0,
                    )
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        mock.assert_awaited_once()
        assert mock.await_args.kwargs.get("scope") is None

    async def test_archive_change_dirs_entry_goes_scoped(
        self, db_session, client: AsyncClient, auth_headers, tmp_path, monkeypatch
    ) -> None:
        """ql-20260818-009：change_dirs 含 ``changes/archive/<name>`` 前缀 → 剥前缀进
        scoped（标注不带 op 类型，是否全量由 ops 裁决），不再强制全量。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        mock = AsyncMock(
            return_value=({"parsed": 0, "created": 0, "updated": 0, "deleted": 0}, None)
        )
        monkeypatch.setattr("app.modules.change.service.ChangeService.reparse", mock)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={
                "ops": [
                    _op(
                        "add",
                        "changes/2026-08-14-live/proposal.md",
                        base_version=0,
                        content=_b64("# Live"),
                    )
                ],
                "change_dirs": ["changes/archive/2026-08-13-old"],
            },
        )
        assert resp.status_code == 200, resp.text
        mock.assert_awaited_once()
        assert mock.await_args.kwargs.get("scope") == ["2026-08-13-old", "2026-08-14-live"]

    async def test_archive_full_reparse_still_deletes(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """rename 入归档触发全量 reparse → 磁盘消失的变更被删（删除仅全量/手动，R-08 语义）。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        _seed_change(spec_root, "2026-08-14-gone", "# Gone")

        from app.modules.change.service import ChangeService

        stats, _ = await ChangeService(db_session).reparse(ws.id)
        assert stats["created"] == 1
        assert await _fetch_change(db_session, ws.id, "2026-08-14-gone") is not None

        # 磁盘删除 + rename 入归档 ops 触发全量 → 变更行被删
        shutil.rmtree(spec_root / "changes" / "2026-08-14-gone")
        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={
                "ops": [
                    {
                        "op": "rename",
                        "path": "changes/2026-08-14-gone/proposal.md",
                        "new_path": "changes/archive/2026-08-13-old/proposal.md",
                        "base_version": 0,
                        "content": _b64("# Old"),
                    }
                ]
            },
        )
        assert resp.status_code == 200, resp.text
        assert await _fetch_change(db_session, ws.id, "2026-08-14-gone") is None
        # 归档变更经全量 reparse 落行
        assert await _fetch_change(db_session, ws.id, "2026-08-13-old") is not None


# ===========================================================================
# reparse 失败不阻断同步（R-04）
# ===========================================================================


class TestReparseFailureBestEffort:
    async def test_reparse_failure_does_not_block_sync(
        self, db_session, client: AsyncClient, auth_headers, tmp_path, monkeypatch
    ) -> None:
        """R-04：ChangeService.reparse 抛异常 → 同步主流程仍成功（best-effort 仅告警）。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)

        async def _boom(*_a, **_k):
            raise RuntimeError("reparse exploded")

        monkeypatch.setattr("app.modules.change.service.ChangeService.reparse", _boom)

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={
                "ops": [
                    _op(
                        "add",
                        "changes/2026-08-17-fail/proposal.md",
                        base_version=0,
                        content=_b64("# Fail"),
                    )
                ],
                "change_dirs": ["2026-08-17-fail"],
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["ok"] is True
        # 文件已落盘（同步主流程完成）
        assert (spec_root / "changes" / "2026-08-17-fail" / "proposal.md").exists()


# ===========================================================================
# _compute_reparse_scope 纯函数边界（标注/兜底/归档/零触发）
# ===========================================================================


class TestComputeReparseScope:
    async def test_scope_from_plain_change_dirs(self) -> None:
        """纯 name 标注 → scoped（非归档）。"""
        from app.modules.spec_workspace.service import SpecWorkspaceService

        scope, archive_hit = SpecWorkspaceService._compute_reparse_scope(["2026-08-14-foo"], [])
        assert archive_hit is False
        assert scope == ["2026-08-14-foo"]

    async def test_scope_fallback_from_ops_paths(self) -> None:
        """无标注 → ops 路径 changes/ 前缀检测兜底取 name。"""
        from app.modules.spec_workspace.service import SpecWorkspaceService

        scope, archive_hit = SpecWorkspaceService._compute_reparse_scope(
            [],
            [
                FileOp(op="add", path="changes/2026-08-14-bar/design.md", base_version=0),
                FileOp(op="add", path="docs/a.md", base_version=0),
            ],
        )
        assert archive_hit is False
        assert scope == ["2026-08-14-bar"]

    async def test_archive_add_op_scoped(self) -> None:
        """ql-20260818-009：纯 add 于 changes/archive/ → scoped（归档 name）。"""
        from app.modules.spec_workspace.service import SpecWorkspaceService

        scope, archive_hit = SpecWorkspaceService._compute_reparse_scope(
            [],
            [FileOp(op="add", path="changes/archive/2026-08-13-old/design.md", base_version=0)],
        )
        assert archive_hit is False
        assert scope == ["2026-08-13-old"]

    async def test_archive_rename_op_full(self) -> None:
        """rename 跨根移动入 changes/archive/ → 全量（scope=None）。"""
        from app.modules.spec_workspace.service import SpecWorkspaceService

        scope, archive_hit = SpecWorkspaceService._compute_reparse_scope(
            [],
            [
                FileOp(
                    op="rename",
                    path="changes/2026-08-13-old/design.md",
                    new_path="changes/archive/2026-08-13-old/design.md",
                    base_version=0,
                )
            ],
        )
        assert archive_hit is True
        assert scope is None

    async def test_archive_delete_op_full(self) -> None:
        """delete 于 changes/archive/ → 全量（scope=None）。"""
        from app.modules.spec_workspace.service import SpecWorkspaceService

        scope, archive_hit = SpecWorkspaceService._compute_reparse_scope(
            [],
            [FileOp(op="delete", path="changes/archive/2026-08-13-old/design.md", base_version=0)],
        )
        assert archive_hit is True
        assert scope is None

    async def test_archive_change_dirs_entry_scoped(self) -> None:
        """ql-20260818-009：change_dirs 含 changes/archive/ 前缀 name → 剥前缀进 scoped。"""
        from app.modules.spec_workspace.service import SpecWorkspaceService

        scope, archive_hit = SpecWorkspaceService._compute_reparse_scope(
            ["changes/archive/2026-08-13-old"], []
        )
        assert archive_hit is False
        assert scope == ["2026-08-13-old"]

    async def test_archive_dir_exact_full(self) -> None:
        """路径恰为 changes/archive（无尾斜杠）仍判定为全量（保守：整根不可名化）。"""
        from app.modules.spec_workspace.service import SpecWorkspaceService

        scope, archive_hit = SpecWorkspaceService._compute_reparse_scope(
            [], [FileOp(op="delete", path="changes/archive", base_version=0)]
        )
        assert archive_hit is True
        assert scope is None

    async def test_non_change_ops_zero_trigger(self) -> None:
        """无 changes 相关路径 → (None, False) 零触发。"""
        from app.modules.spec_workspace.service import SpecWorkspaceService

        scope, archive_hit = SpecWorkspaceService._compute_reparse_scope(
            [], [FileOp(op="add", path="docs/a.md", base_version=0)]
        )
        assert archive_hit is False
        assert scope == []

    async def test_mixed_scope_and_archive_dedup(self) -> None:
        """标注 + 兜底去重保序；归档命中时忽略 scoped 集。"""
        from app.modules.spec_workspace.service import SpecWorkspaceService

        scope, archive_hit = SpecWorkspaceService._compute_reparse_scope(
            ["2026-08-14-a"],
            [
                FileOp(op="add", path="changes/2026-08-14-a/design.md", base_version=0),
                FileOp(op="add", path="changes/2026-08-14-b/design.md", base_version=0),
            ],
        )
        assert archive_hit is False
        assert scope == ["2026-08-14-a", "2026-08-14-b"]


# Suppress unused-import warning for pytest fixture discovery.
pytestmark = pytest.mark.asyncio
