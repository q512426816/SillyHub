"""stats 聚合口径测试：覆盖率两级 / 陈旧边界 / 密度 / 新鲜 / 趋势 / 榜 / 注入频次。

change 2026-09-21-scan-docs-ops-panel task-01 / design D-001@v1 + D-003@v1。

fixture 口径：双项目直接构造 ScanDocument 行（mtime 用 datetime 精确控制，
不依赖文件系统 reparse）——项目 A 走包裹布局（``.sillyspec/docs/...``）、项目 B
走扁平布局（``docs/...``），覆盖 _strip_docs_prefix 双前缀口径；模块登记数来自
A 的 _module-map.yaml content，B 无 map 验证「无 map 退化为实有」。
"""

from __future__ import annotations

import itertools
import uuid
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.knowledge.hits import HitsService, KnowledgeHit
from app.modules.scan_docs.model import ScanDocument
from app.modules.scan_docs.schema import ScanDocsInjectionOut
from app.modules.scan_docs.service import ScanDocsService
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace

#: parser.STANDARD_DOC_TYPES 的七件套展开（与常量同源逐字对齐，断言用）。
STD_TYPES = (
    "ARCHITECTURE",
    "CONVENTIONS",
    "CONCERNS",
    "INTEGRATIONS",
    "PROJECT",
    "STRUCTURE",
    "TESTING",
)


async def _create_workspace(
    session: AsyncSession,
    *,
    root_path: str = "/tmp/test-ws",
    component_key: str | None = None,
) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="Test Workspace",
        slug=f"test-ws-{uuid.uuid4().hex[:8]}",
        root_path=root_path,
        component_key=component_key,
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _create_spec_workspace(
    session: AsyncSession,
    workspace: Workspace,
    spec_root: str,
    strategy: str = "platform-managed",
) -> SpecWorkspace:
    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=workspace.id,
        spec_root=spec_root,
        strategy=strategy,
        sync_status="clean",
    )
    session.add(spec_ws)
    await session.commit()
    return spec_ws


def _doc(
    ws_id: uuid.UUID,
    path: str,
    *,
    mtime: datetime | None,
    content: str | None = None,
) -> ScanDocument:
    """单行 ScanDocument（doc_type 对齐 parser 口径：md=stem 大写、yaml=stem）。"""
    name = path.rsplit("/", 1)[-1]
    doc_type = name.rsplit(".", 1)[0].upper() if name.endswith(".md") else name.rsplit(".", 1)[0]
    return ScanDocument(
        id=uuid.uuid4(),
        workspace_id=ws_id,
        doc_type=doc_type,
        path=path,
        title=None,
        exists=True,
        content=content,
        last_modified_at=mtime,
    )


async def _insert_hit(
    session: AsyncSession,
    ws_id: uuid.UUID,
    *,
    hit_type: str,
    matched: list[str],
    occurred_at: datetime,
) -> None:
    """直插 knowledge_hits 行（line_hash 用随机 hex，绕开 uq 幂等去重）。"""
    session.add(
        KnowledgeHit(
            id=uuid.uuid4(),
            workspace_id=ws_id,
            line_hash=uuid.uuid4().hex,
            type=hit_type,
            matched_anchors=matched,
            occurred_at=occurred_at,
        )
    )
    await session.commit()


async def _seed_two_project_docs(
    session: AsyncSession,
    ws_id: uuid.UUID,
    *,
    now: datetime,
) -> dict:
    """双项目 docs 树（直接构造行，mtime 精确控制）：

    - 项目 A（包裹布局）：scan/ 七件套齐全（ARCHITECTURE=91 天前陈旧，其余
      10 天前）+ modules/_module-map.yaml 登记 3 模块 + modules/ 3 篇 md
      （core=5 天前，auth/billing=10 天前）；
    - 项目 B（扁平布局）：scan/ 5 件（缺 2，ARCHITECTURE mtime=None）+
      modules/ 无 map 2 篇 md（10 天前）。

    手算：total=18；std 12/14；module 5/5；fresh=16；stale=2（None + 91d）。
    """
    rows: list[ScanDocument] = []
    for std in STD_TYPES:
        mtime = now - timedelta(days=91) if std == "ARCHITECTURE" else now - timedelta(days=10)
        rows.append(_doc(ws_id, f".sillyspec/docs/proj-a/scan/{std}.md", mtime=mtime))
    rows.append(
        _doc(
            ws_id,
            ".sillyspec/docs/proj-a/modules/_module-map.yaml",
            mtime=now - timedelta(days=10),
            content="modules:\n  core: {}\n  auth: {}\n  billing: {}\n",
        )
    )
    rows.append(
        _doc(ws_id, ".sillyspec/docs/proj-a/modules/core.md", mtime=now - timedelta(days=5))
    )
    rows.append(
        _doc(ws_id, ".sillyspec/docs/proj-a/modules/auth.md", mtime=now - timedelta(days=10))
    )
    rows.append(
        _doc(ws_id, ".sillyspec/docs/proj-a/modules/billing.md", mtime=now - timedelta(days=10))
    )
    for std in STD_TYPES[:5]:
        mtime = None if std == "ARCHITECTURE" else now - timedelta(days=10)
        rows.append(_doc(ws_id, f"docs/proj-b/scan/{std}.md", mtime=mtime))
    rows.append(_doc(ws_id, "docs/proj-b/modules/agent.md", mtime=now - timedelta(days=10)))
    rows.append(_doc(ws_id, "docs/proj-b/modules/tools.md", mtime=now - timedelta(days=10)))
    session.add_all(rows)
    await session.commit()
    return {"total": len(rows)}


# ── 覆盖率两级 + 密度 + 新鲜 + 趋势 + 榜（主口径复算）──────────────────────


class TestStatsMainRecomputation:
    """双项目 fixture 全指标手算复算（design Wave 1 口径）。"""

    async def test_coverage_density_freshness(self, db_session: AsyncSession) -> None:
        now = datetime.now(UTC)
        ws = await _create_workspace(db_session)
        seeded = await _seed_two_project_docs(db_session, ws.id, now=now)

        out = await ScanDocsService(db_session).stats(ws.id)

        # 覆盖率两级：七件套 A 7/7 + B 5/7 → 12/14；模块层 A 3（map 登记）+
        # B 2（无 map 退化为实有）→ 5/5
        assert out.coverage.std_have == 12
        assert out.coverage.std_expected == 14
        assert out.coverage.module_have == 5
        assert out.coverage.module_expected == 5
        # 综合分子分母：(12+5)/(14+5)
        assert (out.coverage.std_have + out.coverage.module_have) == 17
        assert (out.coverage.std_expected + out.coverage.module_expected) == 19

        # 密度：18 ÷ 2 项目
        assert out.density.per_project_avg == pytest.approx(seeded["total"] / 2)

        # 新鲜：16 行 mtime≥now-30d（91 天前与 None 两行除外）/ total 18
        assert out.freshness.recent_updated == 16
        assert out.freshness.total == 18

    async def test_trend_eight_weeks_all_mondays(self, db_session: AsyncSession) -> None:
        now = datetime.now(UTC)
        ws = await _create_workspace(db_session)
        await _seed_two_project_docs(db_session, ws.id, now=now)

        out = await ScanDocsService(db_session).stats(ws.id)

        trend = out.coverage.trend
        assert len(trend) == 8
        weeks = [date.fromisoformat(p.week) for p in trend]
        # 周一为界 + 升序等距（近 8 个自然周）
        assert all(w.weekday() == 0 for w in weeks)
        assert all((b - a).days == 7 for a, b in itertools.pairwise(weeks))
        # 5d/10d 的 16 行都落在 8 周窗内（91 天前=13 周前在窗外）
        assert sum(p.updated for p in trend) == 16
        # 最新桶右端覆盖 now（当前周的周一 ≤ now）
        assert weeks[-1] <= now.date()

    async def test_recent_board_desc_top10(self, db_session: AsyncSession) -> None:
        now = datetime.now(UTC)
        ws = await _create_workspace(db_session)
        await _seed_two_project_docs(db_session, ws.id, now=now)

        out = await ScanDocsService(db_session).stats(ws.id)

        board = out.recent_board
        assert len(board) == 10  # 16 行有 mtime，Top 10 截断
        # 降序（非严格——同刻并列）
        mtimes = [b.last_modified_at for b in board]
        assert all(a >= b for a, b in itertools.pairwise(mtimes))
        # 唯一的 5 天前行（proj-a/modules/core.md）排榜首
        assert board[0].path == ".sillyspec/docs/proj-a/modules/core.md"
        assert board[0].doc_type == "CORE"

    async def test_stale_only_boundary_rows_none_first(self, db_session: AsyncSession) -> None:
        """陈旧只含 91 天前与 None 行；None 排最前；清单字段齐全。"""
        now = datetime.now(UTC)
        ws = await _create_workspace(db_session)
        await _seed_two_project_docs(db_session, ws.id, now=now)

        out = await ScanDocsService(db_session).stats(ws.id)

        stale = out.stale_docs
        assert len(stale) == 2
        # None 最前，91 天前其后
        assert stale[0].last_modified_at is None
        assert stale[0].path == "docs/proj-b/scan/ARCHITECTURE.md"
        assert stale[1].last_modified_at is not None
        assert stale[1].path == ".sillyspec/docs/proj-a/scan/ARCHITECTURE.md"
        expected_old = (now - timedelta(days=91)).replace(tzinfo=UTC)
        got_old = stale[1].last_modified_at
        assert got_old.replace(tzinfo=UTC) == expected_old.replace(microsecond=got_old.microsecond)


# ── 退化口径：map 损坏 / 根级文件 ─────────────────────────────────────────


async def test_module_map_broken_falls_back_to_have(db_session: AsyncSession) -> None:
    """_module-map.yaml 内容损坏 → 该项目模块 expected 退化为实有（不抛 500）。"""
    now = datetime.now(UTC)
    ws = await _create_workspace(db_session)
    db_session.add_all(
        [
            _doc(
                ws.id,
                "docs/proj-c/modules/_module-map.yaml",
                mtime=now,
                content="{broken yaml :: not parseable",
            ),
            _doc(ws.id, "docs/proj-c/modules/x.md", mtime=now),
            _doc(ws.id, "docs/proj-c/modules/y.md", mtime=now),
        ]
    )
    await db_session.commit()

    out = await ScanDocsService(db_session).stats(ws.id)

    assert out.coverage.module_have == 2
    assert out.coverage.module_expected == 2  # map 解析失败 → 无 map 退化
    assert out.coverage.std_expected == 7  # 单项目仍摊七件套分母
    assert out.coverage.std_have == 0


async def test_root_level_files_do_not_create_project(db_session: AsyncSession) -> None:
    """剥前缀后无项目段的根级文件：计入 total，但不建项目（不虚摊 7 件分母）。"""
    now = datetime.now(UTC)
    ws = await _create_workspace(db_session)
    db_session.add(_doc(ws.id, "docs/README.md", mtime=now - timedelta(days=10)))
    await db_session.commit()

    out = await ScanDocsService(db_session).stats(ws.id)

    assert out.coverage.std_expected == 0
    assert out.freshness.total == 1
    assert out.freshness.recent_updated == 1
    assert out.density.per_project_avg == pytest.approx(1.0)  # 1 ÷ max(0, 1)


# ── 注入频次（D-003@v1）──────────────────────────────────────────────────


async def test_injection_aggregation_30d_window(db_session: AsyncSession) -> None:
    """docs-inject 行聚合：total_30d 行数 / docs_hit_30d 剥前缀去重 / board 降序；
    40 天前老行不计；双布局前缀（.sillyspec/docs 与 docs）都剥齐。"""
    now = datetime.now(UTC)
    ws = await _create_workspace(db_session)
    await _insert_hit(
        db_session,
        ws.id,
        hit_type="docs-inject",
        matched=[".sillyspec/docs/proj-a/modules/core.md", "docs/proj-a/scan/ARCHITECTURE.md"],
        occurred_at=now,
    )
    await _insert_hit(
        db_session,
        ws.id,
        hit_type="docs-inject",
        matched=["docs/proj-a/modules/core.md"],
        occurred_at=now - timedelta(days=1),
    )
    await _insert_hit(  # 40 天前：窗外不计
        db_session,
        ws.id,
        hit_type="docs-inject",
        matched=["docs/proj-a/legacy.md"],
        occurred_at=now - timedelta(days=40),
    )

    out = await ScanDocsService(db_session).stats(ws.id)

    assert out.injection.total_30d == 2
    assert out.injection.docs_hit_30d == 2
    assert [(b.path, b.hits_30d) for b in out.injection.board] == [
        ("proj-a/modules/core.md", 2),  # 双前缀形态剥齐后聚合
        ("proj-a/scan/ARCHITECTURE.md", 1),
    ]


async def test_injection_anchor_hash_suffix_splits_to_file(db_session: AsyncSession) -> None:
    """ql-20260922-001：「文件#锚」形态拆 # 后按文件去重聚合（对齐 knowledge/hits 先例）。

    旧口径不拆 #锚：同文件多锚在榜上拆成多行、docs_hit_30d 按 (文件,锚)
    去重——与 DTO 注释「被注入文档去重数」语义矛盾且数值虚高。
    """
    now = datetime.now(UTC)
    ws = await _create_workspace(db_session)
    await _insert_hit(
        db_session,
        ws.id,
        hit_type="docs-inject",
        matched=[
            "docs/proj-a/modules/core.md#anchor-1",
            "docs/proj-a/modules/core.md#anchor-2",
            ".sillyspec/docs/proj-a/modules/core.md#anchor-1",
        ],
        occurred_at=now,
    )
    await _insert_hit(
        db_session,
        ws.id,
        hit_type="docs-inject",
        matched=["docs/proj-a/modules/core.md"],
        occurred_at=now - timedelta(days=1),
    )

    out = await ScanDocsService(db_session).stats(ws.id)

    assert out.injection.total_30d == 2
    # 全部命中同一文件（旧口径按 (文件,锚) 去重会得 4）
    assert out.injection.docs_hit_30d == 1
    assert [(b.path, b.hits_30d) for b in out.injection.board] == [
        ("proj-a/modules/core.md", 4),  # 三锚形态 + 裸文件，拆锚后聚到同一行
    ]


async def test_knowledge_stats_not_polluted_by_docs_inject(
    db_session: AsyncSession, tmp_path: Path
) -> None:
    """R-07：docs-inject 行存在时知识库 stats（USAGE_TYPES 白名单排除）数值不变。

    前后对照同一棵知识树调 HitsService.stats，插入 docs-inject 行后全量相等。
    """
    spec_root = tmp_path / "k-spec"
    knowledge = spec_root / "knowledge"
    (knowledge / "decisions").mkdir(parents=True)
    (knowledge / "fr").mkdir()
    (knowledge / "generated").mkdir()
    (knowledge / "INDEX.md").write_text(
        "# Knowledge Index\n\n## Patterns\n\n- k|关键词 → [conventions.md#提交规范](x)\n",
        encoding="utf-8",
    )
    (knowledge / "conventions.md").write_text(
        "# Conventions\n\n## 提交规范\n正文。\n", encoding="utf-8"
    )
    ws = await _create_workspace(db_session, root_path=str(tmp_path / "client"))
    await _create_spec_workspace(db_session, ws, str(spec_root))

    before = await HitsService(db_session).stats(ws.id)

    now = datetime.now(UTC)
    for days in (0, 1, 2):
        await _insert_hit(
            db_session,
            ws.id,
            hit_type="docs-inject",
            matched=["docs/k/modules/core.md"],
            occurred_at=now - timedelta(days=days),
        )

    after = await HitsService(db_session).stats(ws.id)
    assert after == before  # docs-inject 不进任何知识使用计数
    assert after.coverage.used_entries == 0
    assert after.usage_board == []
    assert after.entry_counts == []


# ── HTTP 路由序（R-03）+ 空表 ─────────────────────────────────────────────


async def test_stats_endpoint_literal_route_not_swallowed(
    client, tmp_path: Path, auth_headers: dict[str, str]
) -> None:
    """GET /scan-docs/stats 字面量命中（未被 /scan-docs/{doc_id} 通配吞成 422）。"""
    base = tmp_path / "ws"
    sillyspec = base / ".sillyspec"
    (sillyspec / "projects").mkdir(parents=True)
    (sillyspec / "changes" / "change").mkdir(parents=True)
    (sillyspec / "changes" / "archive").mkdir(parents=True)
    ws_resp = await client.post(
        "/api/workspaces",
        json={"name": "scan-docs-stats-test", "root_path": str(base), "type": "other"},
        headers=auth_headers,
    )
    assert ws_resp.status_code == 201, ws_resp.text
    ws_id = ws_resp.json()["id"]

    resp = await client.get(f"/api/workspaces/{ws_id}/scan-docs/stats", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body) == {
        "coverage",
        "stale_docs",
        "density",
        "freshness",
        "recent_board",
        "injection",
    }
    assert set(body["coverage"]) == {
        "std_have",
        "std_expected",
        "module_have",
        "module_expected",
        "trend",
    }


async def test_stats_empty_workspace_all_zero(db_session: AsyncSession) -> None:
    """空表：无任何文档/遥测行时全零不抛错（前端空态）。"""
    ws = await _create_workspace(db_session)

    out = await ScanDocsService(db_session).stats(ws.id)

    assert out.coverage.std_have == 0
    assert out.coverage.std_expected == 0
    assert out.coverage.module_have == 0
    assert out.coverage.module_expected == 0
    assert len(out.coverage.trend) == 8
    assert all(p.updated == 0 for p in out.coverage.trend)
    assert out.stale_docs == []
    assert out.density.per_project_avg == 0.0
    assert out.freshness.recent_updated == 0
    assert out.freshness.total == 0
    assert out.recent_board == []
    assert out.injection == ScanDocsInjectionOut(total_30d=0, docs_hit_30d=0, board=[])
