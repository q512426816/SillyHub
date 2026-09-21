"""hits 数据底座测试：ingest 幂等/白名单宽容 + stats 四指标手算复算 + 路由。

change 2026-09-20-knowledge-effect-panel task-01 / D-007 / D-008@v3 / D-009。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest

from app.modules.knowledge.hits import HitsService
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace

# 手册小节标题样本（与真实知识树同构）：slug 锚点断言复用 parser 单测校准的
# CLI anchor 规则——空白转 -、括号/箭头/斜杠去除、不折叠不截断。
_CONV_SEC_1 = "Backend 模块分层与基类异常约定（Router/Service/Schema → BaseModel → AppError）"
_CONV_SEC_1_ANCHOR = (
    "conventions.md#backend-模块分层与基类异常约定routerserviceschema--basemodel--apperror"
)
_CONV_SEC_2 = "提交规范"
_CONV_SEC_2_ANCHOR = "conventions.md#提交规范"
_KNOWN_SEC = "🟡 Docker backend 容器不热重载（挂载非 /app、无 --reload）"
_KNOWN_ANCHOR = "known-issues.md#-docker-backend-容器不热重载挂载非-app无---reload"


def _iso(dt: datetime) -> str:
    return dt.isoformat().replace("+00:00", "Z")


@pytest.fixture()
async def hits_ws(db_session, tmp_path: Path) -> dict:
    """条目全集工作区：手册/decisions/fr/generated 四类知识树 + spec_root 指向。

    时间基准动态取 now（测试不依赖绝对日期）：
    - conventions.md frontmatter created_at=2026-01-01（静态旧值，安全：任何
      测试运行日都在 30 天窗外）；
    - fr/host-fs-handler.md created_at=now-1d（近 30 天新增）。
    """
    now = datetime.now(UTC)
    spec_root = tmp_path / "hits-spec"
    knowledge = spec_root / "knowledge"
    (knowledge / "decisions").mkdir(parents=True)
    (knowledge / "fr").mkdir()
    (knowledge / "generated").mkdir()
    (knowledge / "proposed").mkdir()

    (knowledge / "INDEX.md").write_text(
        "# Knowledge Index\n\n## Patterns\n\n- k|关键词 → [conventions.md#提交规范](x)\n",
        encoding="utf-8",
    )
    (knowledge / "conventions.md").write_text(
        "---\n"
        "created_at: 2026-01-01T00:00:00Z\n"
        "---\n"
        "# Conventions\n"
        "\n"
        f"## {_CONV_SEC_1}\n\n分层正文。\n"
        "\n"
        f"## {_CONV_SEC_2}\n\n提交正文。\n",
        encoding="utf-8",
    )
    (knowledge / "known-issues.md").write_text(
        f"# Known Issues\n\n## {_KNOWN_SEC}\n\n坑正文。\n", encoding="utf-8"
    )
    (knowledge / "decisions" / "backend.md").write_text(
        "# 决策 — backend\n"
        "\n"
        "## D-001@v1 用 links 表\n状态：implemented\n"
        "\n"
        "## D-002@v1 播种存量\n状态：implemented\n",
        encoding="utf-8",
    )
    (knowledge / "fr" / "host-fs-handler.md").write_text(
        "---\n"
        f"created_at: {_iso(now - timedelta(days=1))}\n"
        "---\n"
        "# FR 索引\n"
        "\n"
        "## FR-host-fs-handler-001 会话样式回放主体\n状态：superseded\n",
        encoding="utf-8",
    )
    (knowledge / "generated" / "runtime.md").write_text(
        "---\ngenerated_at: 2026-07-11T16:26:25Z\n---\n# Runtime\n正文。\n",
        encoding="utf-8",
    )
    # proposed 候选不入条目全集
    (knowledge / "proposed" / "pending.md").write_text("# 候选\n正文。\n", encoding="utf-8")

    ws = Workspace(
        id=uuid.uuid4(),
        name="hits-ws",
        slug=f"hits-ws-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "client-machine-path"),
        status="active",
    )
    db_session.add(ws)
    await db_session.flush()
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
    return {"ws_id": ws.id, "spec_root": spec_root, "now": now}


def _hit_line(
    *,
    hit_type: str = "inject",
    change: str | None = "chg-a",
    matched: list[str] | None = None,
    at: datetime | None = None,
) -> str:
    obj: dict = {"type": hit_type, "at": _iso(at or datetime.now(UTC))}
    if change is not None:
        obj["change"] = change
    if matched is not None:
        obj["matchedFiles"] = matched
    if hit_type == "inject":
        obj["query"] = "测试任务描述"
    return json.dumps(obj, ensure_ascii=False)


def test_type_whitelist_contract_matches_real_data() -> None:
    """HIT_TYPES 白名单与本仓 knowledge-hits.jsonl 实测六型逐字对齐（Grill
    CLK-03：design 记五型但实数据另有 classify——classify 是 knowledge-
    classify.js 归类审计行，一并入白名单）；使用计数口径恒为两型。"""
    from app.modules.knowledge.hits import HIT_TYPES, USAGE_TYPES

    assert {
        "inject",
        "fr-inject",
        "fr-duplicate-warning",
        "fr-supersede",
        "fr-unreferenced",
        "classify",
    } == HIT_TYPES
    assert {"inject", "fr-inject"} == USAGE_TYPES
    assert USAGE_TYPES < HIT_TYPES


def _scenario_lines(now: datetime) -> list[str]:
    """stats 手算场景行（与下方 test_stats_* 断言的手算口径一一对应）。

    - L1 inject chg-a [conv#分层锚, known-issues锚] @T-40d
    - L2 inject chg-a [conv#分层锚]                  @T-40d+1h
    - L3 inject chg-b [decisions/backend.md]         @T-10d
    - L4 fr-inject chg-c [fr/host-fs-handler.md]     @T-2d（不进任务分母）
    """
    return [
        _hit_line(
            change="chg-a",
            matched=[_CONV_SEC_1_ANCHOR, _KNOWN_ANCHOR],
            at=now - timedelta(days=40),
        ),
        _hit_line(
            change="chg-a", matched=[_CONV_SEC_1_ANCHOR], at=now - timedelta(days=40, hours=-1)
        ),
        _hit_line(change="chg-b", matched=["decisions/backend.md"], at=now - timedelta(days=10)),
        _hit_line(
            hit_type="fr-inject",
            change="chg-c",
            matched=["fr/host-fs-handler.md"],
            at=now - timedelta(days=2),
        ),
    ]


# ---------------------------------------------------------------------------
# ingest：幂等 / 坏行 / 白名单宽容
# ---------------------------------------------------------------------------


async def test_ingest_idempotent_same_batch_twice(db_session, hits_ws: dict) -> None:
    """同批两次：第一次全落，第二次 ingested=0 且 duplicates=全量（行 hash 幂等）。"""
    service = HitsService(db_session)
    lines = _scenario_lines(hits_ws["now"]) + [_hit_line(hit_type="fr-supersede", change="chg-d")]

    first = await service.ingest_batch(hits_ws["ws_id"], lines, daemon_local_id="daemon-1")
    assert first.ingested == 5
    assert first.skipped_bad == 0
    assert first.duplicates == 0

    second = await service.ingest_batch(hits_ws["ws_id"], lines, daemon_local_id="daemon-1")
    assert second.ingested == 0
    assert second.duplicates == 5
    assert second.skipped_bad == 0


async def test_ingest_in_batch_duplicate_lines_counted(db_session, hits_ws: dict) -> None:
    """同批内重复行（SELECT 判存看不到的未提交重复）→ duplicates。"""
    service = HitsService(db_session)
    line = _hit_line(matched=[])
    out = await service.ingest_batch(hits_ws["ws_id"], [line, line, line])
    assert out.ingested == 1
    assert out.duplicates == 2


async def test_ingest_skips_bad_lines_and_counts(db_session, hits_ws: dict) -> None:
    """坏行（非法 JSON / 非对象 JSON）跳过并计数，好行照常落库。"""
    service = HitsService(db_session)
    good = _hit_line(matched=[])
    out = await service.ingest_batch(hits_ws["ws_id"], ["not json", "[1,2]", good, ""])
    assert out.ingested == 1
    assert out.skipped_bad == 3
    assert out.duplicates == 0


async def test_ingest_type_whitelist_tolerant_out_of_band(db_session, hits_ws: dict) -> None:
    """六型白名单全落库；白名单外型（CLI 前向新增）仍落库存原值；行内字段
    映射（change→change_name / matchedFiles→matched_anchors / at→occurred_at /
    daemon_local_id 原样 / 缺 type 存空串）。"""
    from sqlalchemy import select

    from app.modules.knowledge.hits import KnowledgeHit

    service = HitsService(db_session)
    lines = [
        _hit_line(hit_type=t, matched=[_CONV_SEC_1_ANCHOR])
        for t in (
            "inject",
            "fr-inject",
            "fr-duplicate-warning",
            "fr-supersede",
            "fr-unreferenced",
            "classify",
            "future-new-type",  # 白名单外：宽容落库
        )
    ] + [json.dumps({"at": _iso(hits_ws["now"])}), json.dumps({"type": "inject"})]
    out = await service.ingest_batch(hits_ws["ws_id"], lines, daemon_local_id="daemon-x")
    assert out.ingested == 9

    all_rows = list(
        (
            await db_session.execute(
                select(KnowledgeHit).where(KnowledgeHit.workspace_id == hits_ws["ws_id"])
            )
        ).scalars()
    )
    # 六型 + 外型 + 空串（缺 type 行）全落库（9 行，inject 两行）
    assert {r.type for r in all_rows} == {
        "inject",
        "fr-inject",
        "fr-duplicate-warning",
        "fr-supersede",
        "fr-unreferenced",
        "classify",
        "future-new-type",
        "",
    }
    assert len(all_rows) == 9
    inject_row = next(r for r in all_rows if r.type == "inject" and r.change_name == "chg-a")
    assert inject_row.matched_anchors == [_CONV_SEC_1_ANCHOR]
    assert inject_row.query_text == "测试任务描述"
    assert inject_row.daemon_local_id == "daemon-x"
    # 行内 at（aware）→ occurred_at 同刻；缺 at 行回退接收时刻（不炸即可）
    assert inject_row.occurred_at is not None


async def test_ingest_type_truncated_to_column_width(db_session, hits_ws: dict) -> None:
    """type 超列宽（String(32)）截断落库——PG 对超长 varchar 抛 DataError（非
    IntegrityError）会穿透 _insert_all 并发兜底整批 500，且 daemon 上行按批推进
    无按行跳过，单条毒行会永久卡死该工作区遥测；SQLite 测试不检列宽，故在写入
    侧截断并用本用例锁定（对齐 change_name[:255] 口径）。"""
    from sqlalchemy import select

    from app.modules.knowledge.hits import KnowledgeHit

    service = HitsService(db_session)
    long_type = "x" * 40
    lines = [
        _hit_line(hit_type=long_type, matched=[]),
        _hit_line(hit_type="inject", matched=[]),
    ]
    out = await service.ingest_batch(hits_ws["ws_id"], lines)
    assert out.ingested == 2
    assert out.skipped_bad == 0

    types = set(
        (
            await db_session.execute(
                select(KnowledgeHit.type).where(KnowledgeHit.workspace_id == hits_ws["ws_id"])
            )
        ).scalars()
    )
    assert types == {"x" * 32, "inject"}


async def test_ingest_unknown_workspace_404(db_session) -> None:
    """未知 workspace → WorkspaceNotFound（与模块内其它端点同语义，不落悬空行）。"""
    from app.core.errors import WorkspaceNotFound

    with pytest.raises(WorkspaceNotFound):
        await HitsService(db_session).ingest_batch(uuid.uuid4(), [_hit_line(matched=[])])


# ---------------------------------------------------------------------------
# stats：手算复算（四指标 + usage_board per_task + entry_counts）
# ---------------------------------------------------------------------------


async def test_stats_full_recomputation(db_session, hits_ws: dict) -> None:
    """构造已知 hits，断言四指标/榜/文件计数与手算一致（slug 锚点+裸文件两形态）。

    手算（T=now，条目全集 7 条：conv×2 + known×1 + decisions×2 + fr×1 + generated×1）：
    - 任务（inject 行 change 去重）={chg-a, chg-b}；inject 锚点总数=2+1+1=4 → 密度 4/2=2.0；
    - 命中锚点：conv#分层 2 次 / known 1 次 / decisions 1 次 / fr 1 次（fr-inject）；
    - used_entries=5（decisions 两条目共享文件级锚点都算命中）→ 覆盖 5/7；
    - 死条目=conv#提交规范（从未命中）1 条；
    - freshness：first_seen>=T-30d 的条目=decisions×2（hits 首见 T-10d 兜底）+fr×1
      （frontmatter T-1d）=3，全被命中 → recent_used=3；
    - per_task：conv#分层=2/2、decisions=1/1、fr=1/0→退化 total、known=1/2。
    """
    service = HitsService(db_session)
    await service.ingest_batch(hits_ws["ws_id"], _scenario_lines(hits_ws["now"]))

    out = await service.stats(hits_ws["ws_id"])

    # coverage
    assert out.coverage.total_entries == 7
    assert out.coverage.used_entries == 5
    # 趋势末点=当前覆盖率；40d/10d/2d 命中分落 8 周网格（手算见每档注释）
    pcts = [p.pct for p in out.coverage.trend]
    assert len(pcts) == 8
    assert pcts == [0.0, 0.0, 0.2857, 0.2857, 0.2857, 0.2857, 0.5714, 0.7143]

    # dead_entries：conv#提交规范 与 generated/runtime.md（均从未命中，锚点序）
    assert [(d.anchor, d.last_hit_at) for d in out.dead_entries] == [
        (_CONV_SEC_2_ANCHOR, None),
        ("generated/runtime.md", None),
    ]

    # density（ql-20260921-002 去重口径）：chg-a 注入过的去重锚点={conv#分层锚,
    # known-issues锚}（2 条），chg-b={decisions/backend.md}（1 条）→ (2+1)/2=1.5
    assert out.density.per_task_avg == 1.5
    # 周窗口（去重口径）：T-40d 两行落 (T-42d,T-35d] 窗 → chg-a 去重 2 锚点/1 任务；
    # T-10d 行落 (T-14d,T-7d] → 1/1
    assert [p.per_task_avg for p in out.density.trend] == [0.0, 0.0, 2.0, 0.0, 0.0, 0.0, 1.0, 0.0]

    # freshness
    assert out.freshness.recent_new == 3
    assert out.freshness.recent_used == 3

    # usage_board：全量按 per_task（任务渗透率，ql-20260921-001）降序（同率按 total 降序、再锚点字典序）
    board = [(b.anchor, b.per_task, b.total, b.task_count) for b in out.usage_board]
    assert board == [
        ("decisions/backend.md", 1.0, 1, 1),  # 首见 T-10d 后仅 chg-b，渗透 1/1
        ("fr/host-fs-handler.md", 1.0, 1, 1),  # 分母 0（fr-inject 不进分母）→ 渗透率退化 1.0
        (_CONV_SEC_1_ANCHOR, 0.5, 2, 1),  # 存在期任务 2，命中过它的任务 1 → 渗透 50%
        (_KNOWN_ANCHOR, 0.5, 1, 1),  # 首见 T-40d 后 2 任务，命中任务 1 → 渗透 50%
    ]
    by_anchor = {b.anchor: b for b in out.usage_board}
    assert by_anchor[_CONV_SEC_1_ANCHOR].first_hit is not None
    assert by_anchor[_CONV_SEC_1_ANCHOR].last_hit is not None

    # entry_counts：文件前缀计数和，全量降序
    assert [(e.file, e.count) for e in out.entry_counts] == [
        ("conventions.md", 2),
        ("decisions/backend.md", 1),
        ("fr/host-fs-handler.md", 1),
        ("known-issues.md", 1),
    ]


async def test_stats_zero_hits_all_zero_metrics(db_session, hits_ws: dict) -> None:
    """零命中端：指标全零/空榜（design 兼容策略——前端显示「暂无使用数据」态）。"""
    out = await HitsService(db_session).stats(hits_ws["ws_id"])
    assert out.coverage.used_entries == 0
    assert out.coverage.total_entries == 7
    assert all(p.pct == 0.0 for p in out.coverage.trend)
    assert out.density.per_task_avg == 0.0
    # freshness：无命中下 fr 条目（frontmatter created_at=T-1d）仍算近 30 天新增；
    # decisions 无 frontmatter 且无 hits 首见 → 不算。
    assert out.freshness.recent_new == 1
    assert out.freshness.recent_used == 0
    assert out.usage_board == []
    assert out.entry_counts == []
    # 死条目=全部 7 条（从未命中）
    assert len(out.dead_entries) == 7


async def test_stats_archive_types_not_counted(db_session, hits_ws: dict) -> None:
    """存档型（fr-supersede 等 + 白名单外型）不进任何使用计数。"""
    service = HitsService(db_session)
    lines = [
        _hit_line(hit_type="fr-supersede", change="chg-x", matched=[_CONV_SEC_1_ANCHOR]),
        _hit_line(hit_type="future-type", change="chg-x", matched=[_CONV_SEC_1_ANCHOR]),
    ]
    await service.ingest_batch(hits_ws["ws_id"], lines)
    out = await service.stats(hits_ws["ws_id"])
    assert out.coverage.used_entries == 0
    assert out.usage_board == []
    assert out.entry_counts == []


# ---------------------------------------------------------------------------
# HTTP 路由：batch 接收 / stats 读 / 401 / 422 / 字面量不被通配吞
# ---------------------------------------------------------------------------


async def test_hits_batch_endpoint_roundtrip(
    client, hits_ws: dict, auth_headers: dict[str, str]
) -> None:
    ws_id = hits_ws["ws_id"]
    lines = _scenario_lines(hits_ws["now"]) + ["broken{"]
    resp = await client.post(
        f"/api/workspaces/{ws_id}/knowledge/hits/batch",
        headers=auth_headers,
        json={"daemon_local_id": "daemon-http", "lines": lines},
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"ingested": 4, "skipped_bad": 1, "duplicates": 0}

    # 重报幂等（HTTP 面）
    resp = await client.post(
        f"/api/workspaces/{ws_id}/knowledge/hits/batch",
        headers=auth_headers,
        json={"daemon_local_id": "daemon-http", "lines": lines},
    )
    assert resp.json() == {"ingested": 0, "skipped_bad": 1, "duplicates": 4}


async def test_stats_endpoint_literal_route_not_swallowed(
    client, hits_ws: dict, auth_headers: dict[str, str]
) -> None:
    """GET /knowledge/stats 字面量命中（未被 {filename:path} 通配吞成 404）+ 形状。"""
    ws_id = hits_ws["ws_id"]
    await client.post(
        f"/api/workspaces/{ws_id}/knowledge/hits/batch",
        headers=auth_headers,
        json={"lines": _scenario_lines(hits_ws["now"])},
    )
    resp = await client.get(f"/api/workspaces/{ws_id}/knowledge/stats", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert set(body) == {
        "coverage",
        "dead_entries",
        "density",
        "freshness",
        "usage_board",
        "entry_counts",
    }
    assert set(body["coverage"]) == {"used_entries", "total_entries", "trend"}
    assert body["coverage"]["used_entries"] == 5


async def test_hits_endpoints_no_auth_return_401(client, hits_ws: dict) -> None:
    """两字面量端点未认证 401（不被通配吞成 404/200）。"""
    ws_id = hits_ws["ws_id"]
    resp = await client.post(f"/api/workspaces/{ws_id}/knowledge/hits/batch", json={"lines": []})
    assert resp.status_code == 401
    resp = await client.get(f"/api/workspaces/{ws_id}/knowledge/stats")
    assert resp.status_code == 401


async def test_hits_batch_body_bounds_return_422(
    client, hits_ws: dict, auth_headers: dict[str, str]
) -> None:
    """行数 >2000 / 单行 >100KB → 422（R-06 分批协议边界校验）。"""
    ws_id = hits_ws["ws_id"]
    resp = await client.post(
        f"/api/workspaces/{ws_id}/knowledge/hits/batch",
        headers=auth_headers,
        json={"lines": ["{}"] * 2001},
    )
    assert resp.status_code == 422

    resp = await client.post(
        f"/api/workspaces/{ws_id}/knowledge/hits/batch",
        headers=auth_headers,
        json={"lines": ["x" * (100 * 1024 + 1)]},
    )
    assert resp.status_code == 422

    # 边界内合法：2000 行短串 / 100KB 整行
    resp = await client.post(
        f"/api/workspaces/{ws_id}/knowledge/hits/batch",
        headers=auth_headers,
        json={"lines": ["{}"] * 2000},
    )
    assert resp.status_code == 200
