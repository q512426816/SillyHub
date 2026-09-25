"""沉淀资产聚合测试（2026-09-25-change-precipitated-assets FR-01/02）。

覆盖（design §测试面 + Grill 两条非阻塞建议吸收——损坏 JSON 用例在内）：
- ``_parse_entries_owned_by`` 纯函数：节头分条 + 「变更：」行归属过滤 + status 提取；
- 金样本式聚合：tmp 镜像（fr 两条目一归属一他属 + decisions 一归属一无主条目 +
  归档目录 test-trace/delta，无 change-patch.json → patch=None 容错）；
- 在途变更（未归档）跳过目录件读取（design R-03）；
- 损坏 JSON fail-open（Grill 建议：test-trace 非法 → test_rows=[]）；
- 跨工作区/不存在 → ``ChangeNotFound``。

author: qinyi
created_at: 2026-09-25
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest

from app.core.errors import ChangeNotFound
from app.modules.change.assets import (
    ChangeAssetsQueryService,
    _parse_entries_owned_by,
)
from app.modules.change.model import Change
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace

KEY = "2026-09-25-assets-golden"


# ===========================================================================
# 纯函数：条目归属解析
# ===========================================================================


def test_parse_entries_owned_by_filters_and_extracts() -> None:
    """节头分条 + 「变更：」行过滤 + status 行提取；无主条目与他属条目跳过。"""
    text = (
        "# FR 索引\n\n"
        f"## FR-auto-test-001 归属条目\n变更：{KEY}\n状态：active\n摘要：x\n\n"
        "## FR-auto-test-002 他属条目\n变更：other-change\n状态：active\n\n"
        "## FR-auto-test-003 无主条目\n状态：active\n\n"
        f"## D-001@v1 决策归属\n变更：{KEY}\n理由：y\n"
    )
    entries = _parse_entries_owned_by(text, KEY)
    assert [(e[0], e[2]) for e in entries] == [
        ("FR-auto-test-001", "active"),
        ("D-001@v1", None),  # 决策条目无「状态：」行 → None 容差
    ]
    assert entries[0][1] == "归属条目"


# ===========================================================================
# fixture：tmp 镜像 + DB 行
# ===========================================================================


async def _make_ws_spec(db_session, spec_root: Path) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="assets ws",
        slug=f"assets-{uuid.uuid4().hex[:8]}",
        root_path=str(spec_root.parent),
        status="active",
        component_key="comp",
    )
    db_session.add(ws)
    db_session.add(
        SpecWorkspace(
            id=uuid.uuid4(),
            workspace_id=ws.id,
            spec_root=str(spec_root),
            strategy="platform-managed",
            sync_status="clean",
        )
    )
    await db_session.commit()
    return ws


async def _make_change(db_session, ws: Workspace, *, archived: bool) -> Change:
    rel = f"changes/archive/{KEY}" if archived else f"changes/{KEY}"
    change = Change(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        change_key=KEY,
        title=KEY,
        status="archived" if archived else "in_progress",
        location="archive" if archived else "active",
        path=rel,
        current_stage="archive" if archived else "brainstorm",
    )
    db_session.add(change)
    await db_session.commit()
    return change


def _seed_mirror(spec_root: Path, *, with_trace: bool = True) -> None:
    """tmp 镜像：fr/decisions 归属条目 + 归档目录三件（patch 刻意缺席）。"""
    fr_dir = spec_root / "knowledge" / "fr"
    dec_dir = spec_root / "knowledge" / "decisions"
    fr_dir.mkdir(parents=True)
    dec_dir.mkdir(parents=True)
    (fr_dir / "auto-test.md").write_text(
        f"# FR\n\n## FR-auto-test-001 金样本条目\n变更：{KEY}\n状态：active\n全文：x#FR-01\n\n"
        "## FR-auto-test-002 他属\n变更：someone-else\n状态：active\n",
        encoding="utf-8",
    )
    (dec_dir / "backend.md").write_text(
        f"# 决策\n\n## D-001@v1 金样本决策\n变更：{KEY}\n理由：z\n\n## D-009@v1 无主\n理由：w\n",
        encoding="utf-8",
    )
    change_dir = spec_root / "changes" / "archive" / KEY
    change_dir.mkdir(parents=True)
    if with_trace:
        (change_dir / "test-trace.json").write_text(
            json.dumps(
                {
                    "schemaVersion": 1,
                    "change": KEY,
                    "rows": [
                        {
                            "row_id": f"{KEY}:task-01:acc-0",
                            "anchor": "FR-01",
                            "tests": ["backend/app/modules/change/tests/test_assets.py"],
                            "reason": "spec",
                            "state": "candidate",
                            "status": "active",
                        }
                    ],
                }
            ),
            encoding="utf-8",
        )
    (change_dir / "delta.md").write_text(
        f"# 变更 Delta — {KEY}\n\n## Before\n行一\n行二\n\n## Delta\n行三\n",
        encoding="utf-8",
    )


# ===========================================================================
# 聚合服务
# ===========================================================================


async def test_golden_aggregation(db_session, tmp_path: Path) -> None:
    """金样本：fr/决策只收归属条目；trace 行投影；patch 缺席 → None；delta 摘要。"""
    spec_root = tmp_path / "spec-root"
    _seed_mirror(spec_root)
    ws = await _make_ws_spec(db_session, spec_root)
    change = await _make_change(db_session, ws, archived=True)

    result = await ChangeAssetsQueryService(db_session).get_change_assets(ws.id, change.id)
    assert result.change_key == KEY
    assert result.archived is True
    assert [e.id for e in result.fr_entries] == ["FR-auto-test-001"]
    assert result.fr_entries[0].file == "knowledge/fr/auto-test.md"
    assert result.fr_entries[0].status == "active"
    assert [d.id for d in result.decisions] == ["D-001@v1"]
    assert [r.row_id for r in result.test_rows] == [f"{KEY}:task-01:acc-0"]
    assert result.test_rows[0].state == "candidate"
    assert result.patch is None  # 无 change-patch.json → 容错 None
    assert result.delta is not None
    assert result.delta.before_lines == 2
    assert result.delta.delta_lines == 1


async def test_inflight_change_skips_dir_files(db_session, tmp_path: Path) -> None:
    """在途变更（design R-03）：archived=False，目录件不读取（空/None）。"""
    spec_root = tmp_path / "spec-root2"
    _seed_mirror(spec_root)  # 归档目录件在场也应被跳过
    ws = await _make_ws_spec(db_session, spec_root)
    change = await _make_change(db_session, ws, archived=False)

    result = await ChangeAssetsQueryService(db_session).get_change_assets(ws.id, change.id)
    assert result.archived is False
    assert result.test_rows == []
    assert result.patch is None
    assert result.delta is None


async def test_corrupt_json_fail_open(db_session, tmp_path: Path) -> None:
    """损坏 test-trace.json → 空列表（fail-open，Grill 建议用例）。"""
    spec_root = tmp_path / "spec-root3"
    _seed_mirror(spec_root, with_trace=False)
    change_dir = spec_root / "changes" / "archive" / KEY
    change_dir.mkdir(parents=True, exist_ok=True)
    (change_dir / "test-trace.json").write_text("{broken", encoding="utf-8")
    ws = await _make_ws_spec(db_session, spec_root)
    change = await _make_change(db_session, ws, archived=True)

    result = await ChangeAssetsQueryService(db_session).get_change_assets(ws.id, change.id)
    assert result.test_rows == []


async def test_not_found_reraises(db_session, tmp_path: Path) -> None:
    """不存在/跨工作区 → ChangeNotFound（对齐 usage 端点 404 口径）。"""
    spec_root = tmp_path / "spec-root4"
    spec_root.mkdir()
    ws = await _make_ws_spec(db_session, spec_root)
    with pytest.raises(ChangeNotFound):
        await ChangeAssetsQueryService(db_session).get_change_assets(ws.id, uuid.uuid4())
