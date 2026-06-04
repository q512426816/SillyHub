"""Tests for backfill logic and ScanDocsService spec_root reading.

Covers:
- backfill_spec_workspaces migration 的幂等性：
  对已有的 active workspace 创建 spec_workspaces 行，跳过已存在的。
- ScanDocsService.reparse 使用 spec_root：
  当 workspace 配置为 platform-managed 时，reparse 应从 spec_root 读取文件。

author: qinyi
created_at: 2026-06-04
"""

from __future__ import annotations

import uuid
from pathlib import Path
from unittest.mock import patch

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _create_workspace(session: AsyncSession, **overrides) -> Workspace:
    """创建一个活跃的 workspace 行，用于测试。"""
    defaults = dict(
        id=uuid.uuid4(),
        name="Test Workspace",
        slug=f"test-ws-{uuid.uuid4().hex[:8]}",
        root_path="/tmp/test-ws-backfill",
        status="active",
    )
    defaults.update(overrides)
    ws = Workspace(**defaults)
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _create_spec_workspace(
    session: AsyncSession,
    workspace: Workspace,
    spec_root: str,
    **overrides,
) -> SpecWorkspace:
    """创建一个 spec_workspace 行。"""
    defaults = dict(
        id=uuid.uuid4(),
        workspace_id=workspace.id,
        spec_root=spec_root,
        strategy="platform-managed",
        sync_status="clean",
    )
    defaults.update(overrides)
    spec_ws = SpecWorkspace(**defaults)
    session.add(spec_ws)
    await session.commit()
    await session.refresh(spec_ws)
    return spec_ws


# ===========================================================================
# 测试 1：backfill 幂等性
# ===========================================================================


class TestBackfillIdempotent:
    """backfill_spec_workspaces migration 的核心逻辑测试。

    模拟 migration upgrade() 中的逻辑：
    - 对没有 spec_workspaces 行的 active workspace 插入新行。
    - 对已有 spec_workspaces 行的 workspace 跳过（幂等）。
    """

    async def test_inserts_for_workspaces_without_spec_row(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """backfill 应为没有 spec_workspaces 行的 active workspace 创建新行。"""
        # 创建两个 active workspace，各自使用不同的 root_path
        ws1 = await _create_workspace(
            db_session,
            name="ws1",
            slug="ws1-backfill",
            root_path=f"/tmp/test-ws-backfill-{uuid.uuid4().hex[:8]}",
        )
        ws2 = await _create_workspace(
            db_session,
            name="ws2",
            slug="ws2-backfill",
            root_path=f"/tmp/test-ws-backfill-{uuid.uuid4().hex[:8]}",
        )

        # 为 ws1 预先创建 spec_workspace 行
        spec_root_1 = str(tmp_path / "specs" / str(ws1.id))
        await _create_spec_workspace(db_session, ws1, spec_root_1)

        # 模拟 backfill 逻辑：为所有没有 spec_workspaces 的 active workspace 插入
        spec_data_root = str(tmp_path / "sillyspec-data")
        existing = (await db_session.execute(select(SpecWorkspace.workspace_id))).scalars().all()
        existing_ids = set(existing)

        # 查询所有 active workspace
        active_wss = (
            (await db_session.execute(select(Workspace.id).where(Workspace.status == "active")))
            .scalars()
            .all()
        )

        inserted = 0
        for ws_id in active_wss:
            if ws_id in existing_ids:
                continue
            spec_root = f"{spec_data_root}/{ws_id}"
            spec_ws = SpecWorkspace(
                id=uuid.uuid4(),
                workspace_id=ws_id,
                spec_root=spec_root,
                strategy="platform-managed",
                profile_version="0.1.0",
                sync_status="clean",
            )
            db_session.add(spec_ws)
            inserted += 1

        await db_session.commit()

        # 只插入了 1 行（ws2），ws1 被跳过
        assert inserted == 1

        # 验证两个 workspace 都有 spec_workspaces 行
        all_spec_ws = (await db_session.execute(select(SpecWorkspace))).scalars().all()
        assert len(all_spec_ws) == 2

        # ws2 的 spec_root 指向正确路径
        ws2_spec = (
            (
                await db_session.execute(
                    select(SpecWorkspace).where(SpecWorkspace.workspace_id == ws2.id)
                )
            )
            .scalars()
            .first()
        )
        assert ws2_spec is not None
        assert ws2_spec.strategy == "platform-managed"
        assert ws2_spec.spec_root == f"{spec_data_root}/{ws2.id}"

    async def test_skips_already_existing_spec_rows(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """backfill 跳过已有 spec_workspaces 行的 workspace（幂等性）。"""
        ws = await _create_workspace(db_session, slug="ws-idempotent")
        spec_root = str(tmp_path / "specs" / str(ws.id))
        original_spec_ws = await _create_spec_workspace(db_session, ws, spec_root)

        # 模拟再次运行 backfill
        existing = (await db_session.execute(select(SpecWorkspace.workspace_id))).scalars().all()
        existing_ids = set(existing)

        active_wss = (
            (await db_session.execute(select(Workspace.id).where(Workspace.status == "active")))
            .scalars()
            .all()
        )

        inserted = 0
        for ws_id in active_wss:
            if ws_id in existing_ids:
                continue
            db_session.add(
                SpecWorkspace(
                    id=uuid.uuid4(),
                    workspace_id=ws_id,
                    spec_root=f"/data/{ws_id}",
                    strategy="platform-managed",
                    profile_version="0.1.0",
                    sync_status="clean",
                )
            )
            inserted += 1

        # 不应插入任何新行
        assert inserted == 0

        # 原始 spec_workspace 行未被修改
        all_spec_ws = (
            (
                await db_session.execute(
                    select(SpecWorkspace).where(SpecWorkspace.workspace_id == ws.id)
                )
            )
            .scalars()
            .all()
        )
        assert len(all_spec_ws) == 1
        assert all_spec_ws[0].id == original_spec_ws.id
        assert all_spec_ws[0].spec_root == spec_root


# ===========================================================================
# 测试 2：ScanDocsService.reparse 使用 spec_root
# ===========================================================================


class TestScanDocsReparseUsesSpecRoot:
    """ScanDocsService.reparse 在 platform-managed 策略下应从 spec_root 读取。

    验证 scan_docs/service.py reparse() 方法中的逻辑：
    当 spec_workspace 存在且 strategy 为 platform-managed 时，
    sillyspec_root 应从 workspace.root_path 替换为 spec_workspace.spec_root。
    """

    async def test_uses_spec_root_for_platform_managed(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """reparse 应把 parser.parse_component 的根路径设为 spec_root。"""
        from app.modules.scan_docs.parser import ScanDocsParser, ScanDocsResult
        from app.modules.scan_docs.service import ScanDocsService

        # 创建 workspace，设置 component_key（reparse 需要）
        ws = await _create_workspace(
            db_session,
            slug="ws-scan-spec-root",
            root_path=str(tmp_path / "original-root"),
            component_key="test-component",
        )

        # spec_root 不同于 root_path
        spec_root_path = tmp_path / "managed-spec-root"
        spec_root_path.mkdir(parents=True, exist_ok=True)
        await _create_spec_workspace(
            db_session, ws, str(spec_root_path), strategy="platform-managed"
        )

        # mock parser，捕获传入的 sillyspec_root 参数
        captured_root = None

        def fake_parse_component(self_parser, root: Path, component_key: str):
            nonlocal captured_root
            captured_root = root
            return ScanDocsResult(component_key=component_key)

        mock_parser = ScanDocsParser()
        with patch.object(type(mock_parser), "parse_component", fake_parse_component):
            svc = ScanDocsService(db_session, parser=mock_parser)
            _, _ = await svc.reparse(ws.id)

        # 验证 parse_component 收到的根路径是 spec_root 而非 root_path
        assert captured_root == spec_root_path
        assert captured_root != Path(ws.root_path)
