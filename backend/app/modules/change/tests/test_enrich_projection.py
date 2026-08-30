"""Tests for ChangeService enrich 实时投影 current_stage（D-002@v1 / D-003@v1 / D-004@v2）。

Change 2026-08-11-change-progress-projection task-08 acceptance 覆盖：
- enrich_with_workspace_ids：命中 platform_change_progress 行 → current_stage 被工具上行
  值覆盖；未命中 → 保留 change 现有值（fallback）。
- enrich_summaries：批量 IN join（禁 N+1），多 change 一次查询；同名异 workspace 不串值。
- 异常 latest_progress（缺 changes 键 / 类型错）→ 不崩，fallback 现有值。
- 全程不写 changes 表（read-only），status 不被投影。

2026-08-21 quick（归档终态渲染）：D-004@v2"不投 status"收窄为仅终态——
``changes[0].status == "archived"``（CLI ``unregisterChange`` 上行）时读时覆盖
ChangeRead/ChangeSummary 的 status + current_stage='archived'（与平台内
complete_stage 终态同形，D-007），其余 status 值（active/in_progress）仍不投；
read-only 语义不变（DTO 层覆盖，ORM/库表不动）。

change/tests/conftest.py（task-08）注册 platform_change_progress + platform_sync_tokens 表，
让 enrich join 在测试库可执行。

文件名避开既有 test_projection.py（StageProjectionService 单测，task-07 D-004@v2）。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.change.model import Change
from app.modules.change.schema import ChangeRead, PendingReview
from app.modules.change.service import ChangeService
from app.modules.platform_sync.model import PlatformChangeProgressORM
from app.modules.workspace.model import Workspace


async def _make_workspace(session: AsyncSession) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"ws-{uuid.uuid4().hex[:6]}",
        root_path=f"/tmp/ws-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _make_change(
    session: AsyncSession, workspace_id: uuid.UUID, change_key: str, stage: str = "plan"
) -> Change:
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key=change_key,
        title=change_key,
        status="active",
        location="active",
        path=f"changes/{change_key}",
        current_stage=stage,
        owner_id=None,
    )
    session.add(change)
    await session.commit()
    await session.refresh(change)
    return change


def _progress_payload(stage: str, status: str = "in_progress") -> dict:
    return {
        "project": {"name": "demo"},
        "changes": [{"name": "x", "current_stage": stage, "status": status}],
        "stages": [],
        "steps": [],
        "batch_progress": [],
        "approvals": [],
    }


def _progress_with_stages(
    stage: str, completed_stages: set[str], status: str = "in_progress"
) -> dict:
    """带 stages 表行的 latest_progress（spike-01 实证：stages=顶层数组，元素字段 stage+status）。

    对齐 platform_sync serializeForSync 六表 + projection._read_stage_progress_sync 的
    ``SELECT stage FROM stages WHERE status='completed'`` 语义（D-008 task-01）。
    """
    return {
        "project": {"name": "demo"},
        "changes": [{"name": "x", "current_stage": stage, "status": status}],
        "stages": [{"stage": s, "status": "completed"} for s in sorted(completed_stages)],
        "steps": [],
        "batch_progress": [],
        "approvals": [],
    }


async def _make_progress_row(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    change_name: str,
    latest_progress: dict,
    last_pushed_at: str | None = "2026-08-13T00:00:00Z",
) -> None:
    """插入一条 platform_change_progress 行（latest_progress 镜像）。

    ``last_pushed_at`` 缺省给固定 ISO 原文（task-11 起被 ChangeSummary 投影消费）；
    显式传 None 可构造「progress 行存在但列值为 NULL」的降级态。
    """
    session.add(
        PlatformChangeProgressORM(
            workspace_id=workspace_id,
            change_name=change_name,
            latest_progress=latest_progress,
            last_pushed_at=last_pushed_at,
            last_pusher="agent",
        )
    )
    await session.commit()


@pytest.mark.asyncio
async def test_enrich_single_hit_overwrites_current_stage(db_session: AsyncSession) -> None:
    """命中 platform_change_progress 行 → current_stage 被工具上行权威值覆盖（D-002@v1）。"""
    ws = await _make_workspace(db_session)
    change = await _make_change(db_session, ws.id, "c-hit", stage="plan")
    db_session.add(
        PlatformChangeProgressORM(
            workspace_id=ws.id,
            change_name="c-hit",
            latest_progress=_progress_payload("execute"),
            last_pushed_at="2026-08-11T00:00:00Z",
            last_pusher="agent",
        )
    )
    await db_session.commit()

    read = await ChangeService(db_session).enrich_with_workspace_ids(change)
    assert isinstance(read, ChangeRead)
    assert read.current_stage == "execute"


@pytest.mark.asyncio
async def test_enrich_single_miss_falls_back_to_existing(db_session: AsyncSession) -> None:
    """未命中（工具未上行）→ 保留 change 现有 current_stage（D-003 fallback）。"""
    ws = await _make_workspace(db_session)
    change = await _make_change(db_session, ws.id, "c-miss", stage="verify")

    read = await ChangeService(db_session).enrich_with_workspace_ids(change)
    assert read.current_stage == "verify"


@pytest.mark.asyncio
async def test_enrich_list_batch_in_covers_hits_and_misses(db_session: AsyncSession) -> None:
    """批量 IN join：命中覆盖、未命中 fallback（R-03 禁 N+1）。"""
    ws = await _make_workspace(db_session)
    c1 = await _make_change(db_session, ws.id, "list-1", stage="plan")
    c2 = await _make_change(db_session, ws.id, "list-2", stage="plan")
    c3 = await _make_change(db_session, ws.id, "list-3", stage="plan")
    db_session.add(
        PlatformChangeProgressORM(
            workspace_id=ws.id,
            change_name="list-1",
            latest_progress=_progress_payload("execute"),
            last_pushed_at=None,
            last_pusher=None,
        )
    )
    await db_session.commit()

    summaries = await ChangeService(db_session).enrich_summaries([c1, c2, c3])
    by_key = {s.change_key: s for s in summaries}
    assert by_key["list-1"].current_stage == "execute"
    assert by_key["list-2"].current_stage == "plan"
    assert by_key["list-3"].current_stage == "plan"


@pytest.mark.asyncio
async def test_enrich_workspace_isolation_no_cross_talk(db_session: AsyncSession) -> None:
    """同名异 workspace 不串值：ws-A 上行不投影到 ws-B 同名 change（D-001 隔离）。"""
    ws_a = await _make_workspace(db_session)
    ws_b = await _make_workspace(db_session)
    change_b = await _make_change(db_session, ws_b.id, "shared-name", stage="plan")
    db_session.add(
        PlatformChangeProgressORM(
            workspace_id=ws_a.id,
            change_name="shared-name",
            latest_progress=_progress_payload("execute"),
            last_pushed_at=None,
            last_pusher=None,
        )
    )
    await db_session.commit()

    read = await ChangeService(db_session).enrich_with_workspace_ids(change_b)
    assert read.current_stage == "plan"


@pytest.mark.asyncio
async def test_enrich_malformed_latest_progress_falls_back(db_session: AsyncSession) -> None:
    """latest_progress 结构异常（缺 changes / 类型错）→ _extract_current_stage 返 None 不崩。

    用 ChangeService._extract_current_stage 直接验证各种畸形 payload 均返 None（调用方
    fallback 现有值）。
    """
    svc = ChangeService(db_session)
    malformed_payloads: list[dict[str, object] | None] = [
        None,
        {"no_changes_key": True},
        {"changes": "not-a-list"},
        {"changes": []},
        {"changes": [{"no_stage": True}]},
        {"changes": [{"current_stage": 123}]},
    ]
    for malformed in malformed_payloads:
        assert svc._extract_current_stage(malformed) is None


@pytest.mark.asyncio
async def test_enrich_does_not_write_changes_table(db_session: AsyncSession) -> None:
    """enrich read-only：不改 Change ORM 对象的 current_stage；非终态 status 不被投影。

    enrich 返回独立 DTO（model_validate），不 mutate 传入的 Change ORM 对象、不写库。
    断言调用前后 change.current_stage / status 不变（投影只在返回的 DTO 层生效）。
    payload 的 status='in_progress' 非终态 → DTO status 也不投影（D-004@v2 收窄后
    仅 'archived' 终态投影，见本文件头部 2026-08-21 quick 说明）。
    """
    ws = await _make_workspace(db_session)
    change = await _make_change(db_session, ws.id, "c-readonly", stage="plan")
    db_session.add(
        PlatformChangeProgressORM(
            workspace_id=ws.id,
            change_name="c-readonly",
            latest_progress=_progress_payload("execute"),
            last_pushed_at=None,
            last_pusher=None,
        )
    )
    await db_session.commit()

    read = await ChangeService(db_session).enrich_with_workspace_ids(change)
    assert read.current_stage == "execute"  # DTO 被投影覆盖
    assert read.status == "active"  # 非 archived status 不投影（D-004@v2 收窄语义）
    # ORM 对象本身不被 enrich 改写（read-only，D-002）
    assert change.current_stage == "plan"
    assert change.status == "active"


# ── 2026-08-21 quick（归档终态渲染）：CLI 上行 status='archived' 的读侧终态投影 ──


@pytest.mark.asyncio
async def test_enrich_detail_archived_terminal_projection(db_session: AsyncSession) -> None:
    """详情命中 status='archived'（CLI unregisterChange 上行）→ status/current_stage 读时
    覆盖 'archived'，与平台内 complete_stage 终态（D-007）同形；ORM 不动（read-only）。
    """
    ws = await _make_workspace(db_session)
    change = await _make_change(db_session, ws.id, "arch-detail", stage="execute")
    await _make_progress_row(
        db_session, ws.id, "arch-detail", _progress_payload("execute", status="archived")
    )

    read = await ChangeService(db_session).enrich_with_workspace_ids(change)
    assert read.status == "archived"
    assert read.current_stage == "archived"
    # ORM 对象与库表不动（D-002 read-only：只投 DTO）
    assert change.status == "active"
    assert change.current_stage == "execute"


@pytest.mark.asyncio
async def test_enrich_list_archived_terminal_projection(db_session: AsyncSession) -> None:
    """列表 enrich_summaries 同范式：status='archived' → summary.status/current_stage
    覆盖 'archived'，pending_review 归 None（已归档不可能待审）。
    """
    ws = await _make_workspace(db_session)
    change = await _make_change(db_session, ws.id, "arch-list", stage="execute")
    await _make_progress_row(
        db_session, ws.id, "arch-list", _progress_payload("execute", status="archived")
    )

    summaries = await ChangeService(db_session).enrich_summaries([change])
    assert summaries[0].status == "archived"
    assert summaries[0].current_stage == "archived"
    assert summaries[0].pending_review is None


@pytest.mark.asyncio
async def test_enrich_list_archived_suppresses_stale_pending_review(
    db_session: AsyncSession,
) -> None:
    """archived 终态压掉陈旧审核门：current_stage='verify'+verify completed 的归档推送
    （正规 CLI 归档的典型形态，_map 本会算 HUMAN_TEST）→ pending_review 仍 None，
    已归档变更不出现在"待我处理"。
    """
    ws = await _make_workspace(db_session)
    change = await _make_change(db_session, ws.id, "arch-stale", stage="verify")
    await _make_progress_row(
        db_session,
        ws.id,
        "arch-stale",
        _progress_with_stages("verify", {"verify"}, status="archived"),
    )

    summaries = await ChangeService(db_session).enrich_summaries([change])
    assert summaries[0].status == "archived"
    assert summaries[0].current_stage == "archived"
    assert summaries[0].pending_review is None


@pytest.mark.asyncio
async def test_enrich_active_status_not_projected(db_session: AsyncSession) -> None:
    """status='active'（CLI 正常态上行）→ 不触发终态投影，current_stage 照常覆盖、
    status 保留 changes 表原值（D-004@v2 收窄：仅 'archived' 终态投影）。
    """
    ws = await _make_workspace(db_session)
    change = await _make_change(db_session, ws.id, "act-keep", stage="plan")
    await _make_progress_row(
        db_session, ws.id, "act-keep", _progress_payload("execute", status="active")
    )

    read = await ChangeService(db_session).enrich_with_workspace_ids(change)
    assert read.current_stage == "execute"
    assert read.status == "active"


@pytest.mark.asyncio
async def test_extract_change_status_malformed_falls_back(db_session: AsyncSession) -> None:
    """_extract_change_status 畸形 payload 表驱动：结构缺失/类型异常一律返 None 不抛
    （对齐 _extract_current_stage 的防御范式；status 非 str 也返 None）。
    """
    svc = ChangeService(db_session)
    malformed_payloads: list[dict[str, object] | None] = [
        None,
        {"no_changes_key": True},
        {"changes": "not-a-list"},
        {"changes": []},
        {"changes": [None]},
        {"changes": [{"no_status": True}]},
        {"changes": [{"status": 123}]},
    ]
    for malformed in malformed_payloads:
        assert svc._extract_change_status(malformed) is None
    assert svc._extract_change_status({"changes": [{"status": "archived"}]}) == "archived"


# ── task-01（2026-08-13-change-center-rework）：_extract_completed_stages +
#    enrich_summaries pending_review（D-008 走 PG 镜像 + _map，不读 sillyspec.db）──


def test_extract_completed_stages_normal() -> None:
    """正常：stages 中 status='completed' 的 stage 名收集成集合，其余过滤。"""
    payload = {
        "stages": [
            {"stage": "brainstorm", "status": "completed"},
            {"stage": "plan", "status": "in_progress"},
            {"stage": "execute", "status": "completed"},
        ]
    }
    assert ChangeService._extract_completed_stages(payload) == {"brainstorm", "execute"}


def test_extract_completed_stages_missing_key() -> None:
    """缺 stages 键 → 空 set（不抛）。"""
    assert ChangeService._extract_completed_stages({"changes": []}) == set()


def test_extract_completed_stages_non_list() -> None:
    """stages 非 list（None / str / dict）→ 空 set（不抛）。"""
    assert ChangeService._extract_completed_stages({"stages": None}) == set()
    assert ChangeService._extract_completed_stages({"stages": "brainstorm"}) == set()
    assert ChangeService._extract_completed_stages({"stages": {"stage": "x"}}) == set()


def test_extract_completed_stages_element_not_dict() -> None:
    """stages 元素非 dict（None/str/int）→ 跳过不崩。"""
    payload = {"stages": [None, "brainstorm", 123, {"stage": "plan", "status": "completed"}]}
    assert ChangeService._extract_completed_stages(payload) == {"plan"}


def test_extract_completed_stages_status_not_completed_filtered() -> None:
    """status 非 'completed'（in_progress/pending/缺失）一律过滤。"""
    payload = {
        "stages": [
            {"stage": "brainstorm", "status": "completed"},
            {"stage": "plan", "status": "in_progress"},
            {"stage": "verify", "status": "pending"},
            {"stage": "archive"},  # 无 status 键
        ]
    }
    assert ChangeService._extract_completed_stages(payload) == {"brainstorm"}


def test_extract_completed_stages_stage_value_not_str() -> None:
    """stage 字段值非 str（int/dict/None）→ 跳过。"""
    payload = {
        "stages": [
            {"stage": 123, "status": "completed"},
            {"stage": None, "status": "completed"},
            {"stage": "plan", "status": "completed"},
        ]
    }
    assert ChangeService._extract_completed_stages(payload) == {"plan"}


def test_extract_completed_stages_none_payload() -> None:
    """latest_progress=None → 空 set（不抛）。"""
    assert ChangeService._extract_completed_stages(None) == set()


def test_extract_completed_stages_non_dict_payload() -> None:
    """latest_progress 非 dict（str/list/None）→ 空 set（不抛）。"""
    assert ChangeService._extract_completed_stages("not-a-dict") == set()
    assert ChangeService._extract_completed_stages(["a", "b"]) == set()


@pytest.mark.asyncio
async def test_enrich_summaries_pending_review_proposal(db_session: AsyncSession) -> None:
    """current_stage=brainstorm + completed={brainstorm} → proposal_review（_map D-004@v2）。"""
    ws = await _make_workspace(db_session)
    change = await _make_change(db_session, ws.id, "pr-proposal", stage="brainstorm")
    await _make_progress_row(
        db_session, ws.id, "pr-proposal", _progress_with_stages("brainstorm", {"brainstorm"})
    )
    summaries = await ChangeService(db_session).enrich_summaries([change])
    assert summaries[0].current_stage == "brainstorm"
    assert summaries[0].pending_review == PendingReview.PROPOSAL_REVIEW


@pytest.mark.asyncio
async def test_enrich_summaries_pending_review_plan(db_session: AsyncSession) -> None:
    """current_stage=plan + completed={plan} → plan_review。"""
    ws = await _make_workspace(db_session)
    change = await _make_change(db_session, ws.id, "pr-plan", stage="plan")
    await _make_progress_row(db_session, ws.id, "pr-plan", _progress_with_stages("plan", {"plan"}))
    summaries = await ChangeService(db_session).enrich_summaries([change])
    assert summaries[0].pending_review == PendingReview.PLAN_REVIEW


@pytest.mark.asyncio
async def test_enrich_summaries_pending_review_human_test(db_session: AsyncSession) -> None:
    """current_stage=verify + completed={verify} → human_test。"""
    ws = await _make_workspace(db_session)
    change = await _make_change(db_session, ws.id, "pr-verify", stage="verify")
    await _make_progress_row(
        db_session, ws.id, "pr-verify", _progress_with_stages("verify", {"verify"})
    )
    summaries = await ChangeService(db_session).enrich_summaries([change])
    assert summaries[0].pending_review == PendingReview.HUMAN_TEST


@pytest.mark.asyncio
async def test_enrich_summaries_pending_review_archive_confirm(db_session: AsyncSession) -> None:
    """current_stage=archive + completed={}（archive 未完成）→ archive_confirm。"""
    ws = await _make_workspace(db_session)
    change = await _make_change(db_session, ws.id, "pr-archive", stage="archive")
    await _make_progress_row(
        db_session, ws.id, "pr-archive", _progress_with_stages("archive", set())
    )
    summaries = await ChangeService(db_session).enrich_summaries([change])
    assert summaries[0].pending_review == PendingReview.ARCHIVE_CONFIRM


@pytest.mark.asyncio
async def test_enrich_summaries_pending_review_none_when_execute(
    db_session: AsyncSession,
) -> None:
    """current_stage=execute + completed={brainstorm,plan,execute} → None（执行中无审核门）。"""
    ws = await _make_workspace(db_session)
    change = await _make_change(db_session, ws.id, "pr-execute", stage="execute")
    await _make_progress_row(
        db_session,
        ws.id,
        "pr-execute",
        _progress_with_stages("execute", {"brainstorm", "plan", "execute"}),
    )
    summaries = await ChangeService(db_session).enrich_summaries([change])
    assert summaries[0].pending_review is None


@pytest.mark.asyncio
async def test_enrich_summaries_pending_review_none_when_no_progress_row(
    db_session: AsyncSession,
) -> None:
    """无 latest_progress 行（join 不命中）→ pending_review=None（fallback，D-008 降级）。"""
    ws = await _make_workspace(db_session)
    change = await _make_change(db_session, ws.id, "pr-noprogress", stage="plan")
    summaries = await ChangeService(db_session).enrich_summaries([change])
    # current_stage 保留 change 现有值（fallback），pending_review 无镜像源 → None
    assert summaries[0].current_stage == "plan"
    assert summaries[0].pending_review is None


@pytest.mark.asyncio
async def test_enrich_summaries_pending_review_batch_mixed(db_session: AsyncSession) -> None:
    """批量投影：多 change 各自 pending_review 独立（复用同一次 PG join，R-01）。"""
    ws = await _make_workspace(db_session)
    c_plan = await _make_change(db_session, ws.id, "batch-plan", stage="plan")
    c_execute = await _make_change(db_session, ws.id, "batch-execute", stage="execute")
    c_miss = await _make_change(db_session, ws.id, "batch-miss", stage="verify")
    await _make_progress_row(
        db_session, ws.id, "batch-plan", _progress_with_stages("plan", {"plan"})
    )
    await _make_progress_row(
        db_session,
        ws.id,
        "batch-execute",
        _progress_with_stages("execute", {"brainstorm", "plan", "execute"}),
    )
    summaries = await ChangeService(db_session).enrich_summaries([c_plan, c_execute, c_miss])
    by_key = {s.change_key: s for s in summaries}
    assert by_key["batch-plan"].pending_review == PendingReview.PLAN_REVIEW
    assert by_key["batch-execute"].pending_review is None
    assert by_key["batch-miss"].pending_review is None  # join 不命中 → None


@pytest.mark.asyncio
async def test_enrich_detail_read_pending_review_stays_none(db_session: AsyncSession) -> None:
    """详情 READ（enrich_with_workspace_ids）不改 pending_review（NG-03 不改详情页）。

    ChangeRead.pending_review 恒 None，即便 latest_progress 能算出 pending_review，
    详情路径也只投影 current_stage（D-008 / NG-03）。
    """
    ws = await _make_workspace(db_session)
    change = await _make_change(db_session, ws.id, "detail-ng03", stage="plan")
    await _make_progress_row(
        db_session, ws.id, "detail-ng03", _progress_with_stages("plan", {"plan"})
    )
    read = await ChangeService(db_session).enrich_with_workspace_ids(change)
    assert read.current_stage == "plan"  # current_stage 仍投影
    assert read.pending_review is None  # 详情路径 pending_review 不动（NG-03）


# ── task-03（2026-08-13-change-center-rework）：_map 纯函数补漏分支 ──
# task-01 经 enrich_summaries 集成路径覆盖 5 个主映射（proposal/plan/human_test/
# archive_confirm/None-when-execute）；此处直接调 _map 静态方法（纯函数，无 DB 依赖），
# 补 task-01 集成路径未触达的两个分支 + 一个 guard：
# ① brainstorm completed + current_stage=plan + plan 未完成 → 仍 PROPOSAL_REVIEW
#    （projection.py:204-207「刚切到 plan 但 plan 审核门尚未到来」窗口）
# ② current_stage=None → None（_map 入口 guard，projection.py:185）
# ③ archive 已 completed → None（archive_confirm 门已过落穿，projection.py:189 边界）


def test_map_brainstorm_completed_plan_window_returns_proposal_review() -> None:
    """brainstorm completed + current_stage=plan + plan 未完成 → PROPOSAL_REVIEW。

    覆盖 projection.py:204-207「刚切到 plan 但 plan 审核门尚未到来」分支：brainstorm
    末步刚过、stage 已切到 plan，但 plan 尚未完成时，仍属 proposal 审核窗口（不是
    plan_review，因为 plan 还没跑完）。task-01 的 proposal 测试只覆盖
    current_stage=brainstorm，未覆盖 stage 已推进到 plan 的边界。
    """
    from app.modules.change.projection import StageProjectionService

    result = StageProjectionService._map("plan", {"brainstorm"})
    assert result == PendingReview.PROPOSAL_REVIEW


def test_map_current_stage_none_returns_none() -> None:
    """current_stage=None → None（_map 入口 guard，projection.py:185）。

    task-01 的 None 测试走「无 progress 行」集成路径（根本不调 _map）；此处直接命中
    _map 的 None 入口 guard，保证 current_stage 缺失时绝不误报 pending_review。
    """
    from app.modules.change.projection import StageProjectionService

    assert StageProjectionService._map(None, {"brainstorm", "plan"}) is None


def test_map_archive_already_completed_returns_none() -> None:
    """current_stage=archive + archive 已完成 → None（archive_confirm 门已过落穿）。

    projection.py:189 要求 archive NOT in completed 才返 ARCHIVE_CONFIRM；archive 已
    completed 说明归档门已过（change 实际归档完成），应落穿到 None，不应再提示
    archive_confirm。task-01 的 archive_confirm 测试只覆盖 completed={}（archive 未完成）。
    """
    from app.modules.change.projection import StageProjectionService

    assert (
        StageProjectionService._map("archive", {"brainstorm", "plan", "verify", "archive"}) is None
    )


# ── task-11（2026-08-29-change-delete-closure-and-spec-pull design §8.1）：
#    ChangeSummary.last_pushed_at 活动投影（纯 CLI 模式进行中可见性 Layer 1，
#    前端活动徽标「最后信号」数据源；零 migration、零新增查询）──


@pytest.mark.asyncio
async def test_enrich_summaries_last_pushed_at_projected_from_progress_row(
    db_session: AsyncSession,
) -> None:
    """progress 行带 last_pushed_at → summary.last_pushed_at 投影该值（ISO 原文透传）。

    服务端零解析：客户端时区偏移原文（+08:00）原样透传，畸形串防御解析归 task-12
    前端；与 current_stage 同一次复合 IN join 的 SELECT 顺带取值（R-03 零新增查询）。
    """
    ws = await _make_workspace(db_session)
    change = await _make_change(db_session, ws.id, "lp-hit", stage="execute")
    await _make_progress_row(
        db_session,
        ws.id,
        "lp-hit",
        _progress_with_stages("execute", {"brainstorm", "plan", "execute"}),
        last_pushed_at="2026-08-29T12:34:56+08:00",
    )

    summaries = await ChangeService(db_session).enrich_summaries([change])
    assert summaries[0].current_stage == "execute"
    assert summaries[0].last_pushed_at == "2026-08-29T12:34:56+08:00"


@pytest.mark.asyncio
async def test_enrich_summaries_last_pushed_at_none_when_no_row_or_null(
    db_session: AsyncSession,
) -> None:
    """两态降级：①无 progress 行（join 不命中）②行存在但列值 NULL → 均保持 None。

    D-003 fallback 范式（与 current_stage / pending_review 同款）：miss 不赋值，
    ChangeSummary 字段缺省 None。
    """
    ws = await _make_workspace(db_session)
    c_norow = await _make_change(db_session, ws.id, "lp-norow", stage="plan")
    c_nullcol = await _make_change(db_session, ws.id, "lp-nullcol", stage="plan")
    await _make_progress_row(
        db_session,
        ws.id,
        "lp-nullcol",
        _progress_with_stages("plan", {"plan"}),
        last_pushed_at=None,
    )

    summaries = await ChangeService(db_session).enrich_summaries([c_norow, c_nullcol])
    by_key = {s.change_key: s for s in summaries}
    # join 不命中：current_stage fallback 现值 + last_pushed_at None
    assert by_key["lp-norow"].current_stage == "plan"
    assert by_key["lp-norow"].last_pushed_at is None
    # join 命中但列值 NULL：投影路径走通，last_pushed_at 仍 None（不造值）
    assert by_key["lp-nullcol"].current_stage == "plan"
    assert by_key["lp-nullcol"].last_pushed_at is None
