"""Tests for step 级进度提取（2026-08-15-change-step-visibility task-01，design §5 Phase 1）。

覆盖 acceptance：
- _extract_step_progress：正常 steps（多 stage STAGE_ORDER 排序/摘要三态/waiting 判定）；
  steps 缺失 / 空数组 / 元素非 dict / latest_progress 非 dict → (None, None) 不抛（D-003@v1）。
- completed_at 归一化：``2026/8/15 23:44:08`` → ISO 8601 UTC；解析失败保留原串（Grill #18）。
- 明细 status 七值透传 CLI 原值（model.py StepStatus：completed/pending/in-progress/
  failed/blocked/waiting/stale）。
- output 截断 200 字。
- enrich_summaries / enrich_with_workspace_ids 填充 step_progress / steps（集成）。
- _resolve_pending_change_keys 三元组解包适配后行为不变守护（Grill P0-1）。

fixture 范式参照 test_enrich_projection.py（conftest 注册 platform_change_progress 表）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.modules.change.dispatch import STAGE_ORDER
from app.modules.change.model import Change
from app.modules.change.schema import (
    ChangeRead,
    ChangeSummary,
    PendingReview,
    StepProgressSummary,
    StepTimelineEntry,
)
from app.modules.change.service import ChangeService
from app.modules.platform_sync.model import PlatformChangeProgressORM
from app.modules.workspace.model import Workspace

# ── payload 构造 ──────────────────────────────────────────────────────


def _step(
    stage: str,
    name: str,
    *,
    status: str = "completed",
    ordering: int = 0,
    output: str | None = None,
    completed_at: str | None = None,
    wait_reason: str | None = None,
) -> dict:
    return {
        "change_name": "demo",
        "stage": stage,
        "name": name,
        "status": status,
        "output": output,
        "completed_at": completed_at,
        "ordering": ordering,
        "wait_reason": wait_reason,
    }


def _payload(
    stage: str,
    steps: list[dict],
    *,
    completed_stages: list[dict[str, str]] | None = None,
) -> dict:
    """latest_progress 镜像（对齐 CLI serializeForSync 六表：steps=顶层数组）。"""
    return {
        "project": {"name": "demo"},
        "changes": [{"name": "demo", "current_stage": stage, "status": "in_progress"}],
        "stages": completed_stages or [],
        "steps": steps,
        "batch_progress": [],
        "approvals": [],
    }


# ── 提取器单测（纯函数，无 DB 依赖）──


def test_extract_normal_multi_stage_sorted_by_stage_order() -> None:
    """正常 steps：多 stage 跨组按 STAGE_ORDER 定序（乱序输入→有序输出），组内按 ordering。"""
    steps = [
        _step("verify", "v2", status="pending", ordering=2),
        _step("plan", "p1", status="completed", ordering=1, completed_at="2026/8/15 10:00:00"),
        _step("brainstorm", "b1", status="completed", ordering=1),
        _step("verify", "v1", status="in-progress", ordering=1),
        _step("plan", "p2", status="completed", ordering=2),
    ]
    summary, timeline = ChangeService._extract_step_progress(_payload("verify", steps))
    assert summary is not None and timeline is not None
    assert [(e.stage, e.name) for e in timeline] == [
        ("brainstorm", "b1"),
        ("plan", "p1"),
        ("plan", "p2"),
        ("verify", "v1"),
        ("verify", "v2"),
    ]
    # 摘要跨全部 stage 累计（R-06：体现总进度）
    assert summary.step_total == 5
    assert summary.steps_completed == 3
    # 当前步=排序后第一个非 completed（跨 stage，非本 stage 内）
    assert summary.current_step_name == "v1"
    assert summary.current_step_status == "active"
    assert summary.current_step_desc is None  # v1 无 output


def test_extract_quick_and_unknown_stage_after_known_order() -> None:
    """quick 及未知 stage 追加在 STAGE_ORDER 已知序之后，组内按 stage 名稳定排序。"""
    steps = [
        _step("zz-custom", "z1", status="pending", ordering=1),
        _step("quick", "q1", status="completed", ordering=1),
        _step("execute", "e1", status="completed", ordering=1),
        _step("aa-custom", "a1", status="pending", ordering=1),
    ]
    summary, timeline = ChangeService._extract_step_progress(_payload("quick", steps))
    assert timeline is not None
    # 追加组（quick+未知）按 stage 名稳定排序：aa-custom < quick < zz-custom
    assert [e.stage for e in timeline] == ["execute", "aa-custom", "quick", "zz-custom"]
    assert summary is not None
    assert summary.current_step_name == "a1"  # execute/quick completed 后第一个非 completed


def test_extract_summary_all_done_state() -> None:
    """全完成：current_step_name/status/desc 均 None（摘要三态之 done）。"""
    steps = [
        _step("brainstorm", "b1", status="completed", ordering=1),
        _step("plan", "p1", status="completed", ordering=1),
    ]
    summary, timeline = ChangeService._extract_step_progress(_payload("archive", steps))
    assert summary is not None and timeline is not None
    assert summary.steps_completed == summary.step_total == 2
    assert summary.current_step_name is None
    assert summary.current_step_status is None
    assert summary.current_step_desc is None


def test_extract_waiting_when_wait_reason_non_empty() -> None:
    """当前步 wait_reason 非空 → current_step_status=waiting（等待用户决策可见性，FR-02）。"""
    steps = [
        _step("plan", "p1", status="completed", ordering=1),
        _step(
            "plan",
            "p2",
            status="waiting",
            ordering=2,
            wait_reason="等待用户确认方案",
            output="方案产出已就绪",
        ),
        _step("plan", "p3", status="pending", ordering=3),
    ]
    summary, _ = ChangeService._extract_step_progress(_payload("plan", steps))
    assert summary is not None
    assert summary.current_step_name == "p2"
    assert summary.current_step_status == "waiting"
    assert summary.current_step_desc == "方案产出已就绪"


def test_extract_active_when_wait_reason_empty_even_status_waiting() -> None:
    """wait_reason 空（status=waiting 但未给原因）→ 仍 active（判定只看 wait_reason）。"""
    steps = [_step("execute", "t1", status="waiting", ordering=1, wait_reason="")]
    summary, _ = ChangeService._extract_step_progress(_payload("execute", steps))
    assert summary is not None
    assert summary.current_step_status == "active"


def test_extract_missing_or_malformed_returns_none_none() -> None:
    """steps 缺失 / 非数组 / 空数组 / 全无效元素 / latest_progress 非 dict → (None, None) 不抛。"""
    assert ChangeService._extract_step_progress(None) == (None, None)
    assert ChangeService._extract_step_progress("not-a-dict") == (None, None)
    assert ChangeService._extract_step_progress(["a", "b"]) == (None, None)
    assert ChangeService._extract_step_progress({"no_steps_key": True}) == (None, None)
    assert ChangeService._extract_step_progress({"steps": None}) == (None, None)
    assert ChangeService._extract_step_progress({"steps": "not-a-list"}) == (None, None)
    assert ChangeService._extract_step_progress({"steps": []}) == (None, None)
    # 元素非 dict → 丢弃；无一有效 → (None, None)
    assert ChangeService._extract_step_progress({"steps": [None, "s", 123]}) == (None, None)
    # 身份字段（name/stage/status）缺失或类型异常的行被丢弃，有效行保留
    partial = _payload(
        "plan",
        [
            {"stage": "plan", "status": "pending"},  # 缺 name
            {"name": "n", "status": "pending"},  # 缺 stage
            {"name": "n", "stage": "plan"},  # 缺 status
            {"name": "", "stage": "plan", "status": "pending"},  # name 空串
            {"name": 1, "stage": "plan", "status": "pending"},  # name 非 str
            _step("plan", "ok", status="completed", ordering=1),
        ],
    )
    summary, timeline = ChangeService._extract_step_progress(partial)
    assert timeline is not None and len(timeline) == 1
    assert timeline[0].name == "ok"
    assert summary is not None and summary.step_total == 1


def test_extract_status_seven_values_pass_through() -> None:
    """明细 status 七值透传 CLI 原值（model.py StepStatus），不改写不改名。"""
    seven = ["completed", "pending", "in-progress", "failed", "blocked", "waiting", "stale"]
    steps = [_step("execute", f"s-{i}", status=s, ordering=i) for i, s in enumerate(seven)]
    _, timeline = ChangeService._extract_step_progress(_payload("execute", steps))
    assert timeline is not None
    assert [e.status for e in timeline] == seven


def test_extract_completed_at_normalized_to_iso_utc() -> None:
    """completed_at CLI 本地格式 → ISO 8601 UTC；解析失败保留原串；非 str → None。"""
    # 本地时区往返：输入本地墙钟 2026/8/15 23:44:08，输出同一时刻的 UTC ISO 串。
    local_tz = datetime.now().astimezone().tzinfo
    expected_utc = datetime(2026, 8, 15, 23, 44, 8, tzinfo=local_tz).astimezone(UTC).isoformat()
    steps = [
        _step("verify", "v1", status="completed", ordering=1, completed_at="2026/8/15 23:44:08")
    ]
    _, timeline = ChangeService._extract_step_progress(_payload("verify", steps))
    assert timeline is not None
    assert timeline[0].completed_at == expected_utc
    # UTC+8 主开发环境语义验证：北京时间 20:00 == UTC 12:00（动态本地时区，跨环境稳）
    if getattr(local_tz, "utcoffset", None) and local_tz.utcoffset(None) == timedelta(hours=8):
        assert expected_utc == "2026-08-15T15:44:08+00:00"

    steps_bad = [_step("verify", "v2", status="completed", ordering=1, completed_at="15/8/2026")]
    _, timeline_bad = ChangeService._extract_step_progress(_payload("verify", steps_bad))
    assert timeline_bad is not None
    assert timeline_bad[0].completed_at == "15/8/2026"  # 非法串原样保留

    steps_none = [_step("verify", "v3", status="in-progress", ordering=1, completed_at=None)]
    _, timeline_none = ChangeService._extract_step_progress(_payload("verify", steps_none))
    assert timeline_none is not None
    assert timeline_none[0].completed_at is None


def test_normalize_completed_at_unit() -> None:
    """_normalize_completed_at 单测：非 str → None；ISO 输出可被 fromisoformat 回读。"""
    assert ChangeService._normalize_completed_at(None) is None
    assert ChangeService._normalize_completed_at(123) is None
    assert ChangeService._normalize_completed_at("not a date") == "not a date"
    iso = ChangeService._normalize_completed_at("2026/08/15 23:44:08")
    assert isinstance(iso, str)
    assert datetime.fromisoformat(iso).tzinfo == UTC  # 回读即 UTC aware


def test_extract_output_truncated_to_200_chars() -> None:
    """output 截断 200 字：恰好 200 保留、201 截为 200、非 str → None。"""
    long_output = "x" * 500
    steps = [
        _step("execute", "t1", status="completed", ordering=1, output=long_output),
        _step("execute", "t2", status="completed", ordering=2, output="y" * 200),
        _step("execute", "t3", status="completed", ordering=3, output=123),
    ]
    _, timeline = ChangeService._extract_step_progress(_payload("execute", steps))
    assert timeline is not None
    assert timeline[0].output == "x" * 200
    assert timeline[1].output == "y" * 200
    assert timeline[2].output is None


def test_extract_ordering_missing_or_invalid_defaults_zero() -> None:
    """ordering 缺失/非 int/bool → 按 0 兜底，不抛；同键稳定排序保输入相对序。"""
    steps = [
        {"stage": "plan", "name": "s2", "status": "pending", "ordering": "high"},
        {"stage": "plan", "name": "s1", "status": "pending"},  # 缺 ordering → 0
        {"stage": "plan", "name": "s3", "status": "pending", "ordering": 2},
        {"stage": "plan", "name": "s4", "status": "pending", "ordering": 1},
    ]
    _, timeline = ChangeService._extract_step_progress(_payload("plan", steps))
    assert timeline is not None
    # s1/s2 键同为 (plan,0) → 稳定排序保输入相对序 s2 先出现则 s2 在前
    assert [e.name for e in timeline] == ["s2", "s1", "s4", "s3"]
    assert [e.ordering for e in timeline] == [0, 0, 1, 2]


def test_extract_wait_reason_invalid_type_becomes_none() -> None:
    """wait_reason 非 str（int/dict）→ None（waiting 判定不受影响，不抛）。"""
    steps = [{"stage": "plan", "name": "w1", "status": "waiting", "wait_reason": 5, "ordering": 1}]
    summary, timeline = ChangeService._extract_step_progress(_payload("plan", steps))
    assert timeline is not None
    assert timeline[0].wait_reason is None
    assert summary is not None
    assert summary.current_step_status == "active"  # wait_reason 归 None 后非空判定不成立


# ── enrich 集成（DB，参照 test_enrich_projection.py 范式）──


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
        location="changes",
        path=f"changes/{change_key}",
        current_stage=stage,
        owner_id=None,
    )
    session.add(change)
    await session.commit()
    await session.refresh(change)
    return change


async def _make_progress_row(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    change_name: str,
    latest_progress: dict,
) -> None:
    session.add(
        PlatformChangeProgressORM(
            workspace_id=workspace_id,
            change_name=change_name,
            latest_progress=latest_progress,
            last_pushed_at="2026-08-15T00:00:00Z",
            last_pusher="agent",
        )
    )
    await session.commit()


def _full_steps_payload(stage: str) -> dict:
    """带完整 steps 的 latest_progress：brainstorm 2 步全完 + plan 2 步（1 完成在跑）。"""
    steps = [
        _step(
            "brainstorm",
            "调研",
            status="completed",
            ordering=1,
            output="调研完成",
            completed_at="2026/8/15 10:00:00",
        ),
        _step(
            "brainstorm",
            "产出方案",
            status="completed",
            ordering=2,
            completed_at="2026/8/15 11:00:00",
        ),
        _step(
            "plan",
            "拆任务",
            status="completed",
            ordering=1,
            output="任务已拆",
            completed_at="2026/8/15 12:00:00",
        ),
        _step("plan", "写 plan.md", status="in-progress", ordering=2, output="正在写文档"),
    ]
    return _payload(stage, steps, completed_stages=[{"stage": "brainstorm", "status": "completed"}])


@pytest.mark.asyncio
async def test_enrich_detail_fills_step_progress_and_steps(db_session: AsyncSession) -> None:
    """详情路径：命中投影 → read.step_progress 摘要 + read.steps 明细（含归一化/排序）。"""
    ws = await _make_workspace(db_session)
    change = await _make_change(db_session, ws.id, "sp-detail", stage="brainstorm")
    await _make_progress_row(db_session, ws.id, "sp-detail", _full_steps_payload("plan"))

    read = await ChangeService(db_session).enrich_with_workspace_ids(change)
    assert isinstance(read, ChangeRead)
    assert read.current_stage == "plan"
    assert read.step_progress is not None
    assert read.step_progress.step_total == 4
    assert read.step_progress.steps_completed == 3
    assert read.step_progress.current_step_name == "写 plan.md"
    assert read.step_progress.current_step_status == "active"
    assert read.step_progress.current_step_desc == "正在写文档"
    assert read.steps is not None and len(read.steps) == 4
    # 明细按 STAGE_ORDER 定序 + completed_at 归一化
    assert [e.name for e in read.steps] == ["调研", "产出方案", "拆任务", "写 plan.md"]
    assert read.steps[0].completed_at is not None
    assert read.steps[0].completed_at.startswith("2026-08-15T")
    assert read.steps[0].completed_at.endswith(("+00:00", "Z"))


@pytest.mark.asyncio
async def test_enrich_detail_steps_missing_degrades_to_none(db_session: AsyncSession) -> None:
    """steps 缺失（有投影行但无 steps）→ step_progress/steps 保持 None，current_stage 正常（D-003@v1）。"""
    ws = await _make_workspace(db_session)
    change = await _make_change(db_session, ws.id, "sp-miss-steps", stage="plan")
    await _make_progress_row(db_session, ws.id, "sp-miss-steps", _payload("execute", steps=[]))

    read = await ChangeService(db_session).enrich_with_workspace_ids(change)
    assert read.current_stage == "execute"
    assert read.step_progress is None
    assert read.steps is None


@pytest.mark.asyncio
async def test_enrich_detail_no_progress_row_degrades_to_none(db_session: AsyncSession) -> None:
    """join 不命中 → current_stage fallback 现有值，step_progress/steps None（D-003）。"""
    ws = await _make_workspace(db_session)
    change = await _make_change(db_session, ws.id, "sp-norow", stage="verify")

    read = await ChangeService(db_session).enrich_with_workspace_ids(change)
    assert read.current_stage == "verify"
    assert read.step_progress is None
    assert read.steps is None


@pytest.mark.asyncio
async def test_enrich_summaries_fills_step_progress_summary_only(
    db_session: AsyncSession,
) -> None:
    """列表路径：命中投影 → summary.step_progress 摘要（ChangeSummary 无 steps 明细字段，R-02）。"""
    ws = await _make_workspace(db_session)
    c_hit = await _make_change(db_session, ws.id, "sp-list-hit", stage="brainstorm")
    c_miss = await _make_change(db_session, ws.id, "sp-list-miss", stage="plan")
    await _make_progress_row(db_session, ws.id, "sp-list-hit", _full_steps_payload("plan"))

    summaries = await ChangeService(db_session).enrich_summaries([c_hit, c_miss])
    assert len(summaries) == 2
    assert all(isinstance(s, ChangeSummary) for s in summaries)
    assert "steps" not in ChangeSummary.model_fields  # 列表不带明细（R-02）
    by_key = {s.change_key: s for s in summaries}
    hit = by_key["sp-list-hit"]
    assert hit.step_progress is not None
    assert hit.step_progress == StepProgressSummary(
        step_total=4,
        steps_completed=3,
        current_step_name="写 plan.md",
        current_step_status="active",
        current_step_desc="正在写文档",
    )
    # 未命中行 step_progress None（fallback，前端降级）
    assert by_key["sp-list-miss"].step_progress is None


# ── _resolve_pending_change_keys 三元组解包守护（Grill P0-1）──


@pytest.mark.asyncio
async def test_resolve_pending_change_keys_guard_after_tuple_change(
    db_session: AsyncSession,
) -> None:
    """三元组扩展后行为不变守护：pending 集合仍只由 (stage, completed) 经 _map 决定。

    构造 4 条 change（3 命中投影 + 1 无行）：plan_review / human_test / None 各就各位；
    steps 字段存在与否不影响 pending 判定（本函数不消费 steps）。
    """
    ws = await _make_workspace(db_session)
    keys = ["g-plan", "g-verify", "g-exec", "g-norow"]
    await _make_change(db_session, ws.id, "g-plan", stage="plan")
    await _make_change(db_session, ws.id, "g-verify", stage="verify")
    await _make_change(db_session, ws.id, "g-exec", stage="execute")
    await _make_change(db_session, ws.id, "g-norow", stage="plan")

    await _make_progress_row(
        db_session,
        ws.id,
        "g-plan",
        _payload(
            "plan",
            [_step("plan", "p1", status="completed", ordering=1)],
            completed_stages=[{"stage": "plan", "status": "completed"}],
        ),
    )
    await _make_progress_row(
        db_session,
        ws.id,
        "g-verify",
        _payload(
            "verify",
            [_step("verify", "v1", status="in-progress", ordering=1)],
            completed_stages=[{"stage": "verify", "status": "completed"}],
        ),
    )
    await _make_progress_row(
        db_session,
        ws.id,
        "g-exec",
        _payload(
            "execute",
            [],
            completed_stages=[
                {"stage": "brainstorm", "status": "completed"},
                {"stage": "plan", "status": "completed"},
                {"stage": "execute", "status": "completed"},
            ],
        ),
    )

    svc = ChangeService(db_session)
    pending = await svc._resolve_pending_change_keys(ws.id, location="changes")
    # plan completed + current_stage=plan → PLAN_REVIEW；verify completed → HUMAN_TEST；
    # execute 全完 → None；无行 → 不进集合
    assert pending == {"g-plan", "g-verify"}

    # pending_review_only 集成联动：经 enrich_summaries 算出的 pending_review 与集合一致
    changes = [await _get_change_by_key(db_session, ws.id, k) for k in keys]
    summaries = await svc.enrich_summaries(changes)
    by_key = {s.change_key: s for s in summaries}
    assert by_key["g-plan"].pending_review == PendingReview.PLAN_REVIEW
    assert by_key["g-verify"].pending_review == PendingReview.HUMAN_TEST
    assert by_key["g-exec"].pending_review is None
    assert by_key["g-norow"].pending_review is None


async def _get_change_by_key(session: AsyncSession, workspace_id: uuid.UUID, key: str) -> Change:
    stmt = select(Change).where(
        col(Change.change_key) == key, col(Change.workspace_id) == workspace_id
    )
    return (await session.execute(stmt)).scalars().one()


# ── _project_current_stage 三元组形状守护 ──


@pytest.mark.asyncio
async def test_project_current_stage_returns_triple(db_session: AsyncSession) -> None:
    """_project_current_stage 映射值为 (stage, completed, latest_progress) 三元组（D-002@v1）。"""
    ws = await _make_workspace(db_session)
    payload = _payload(
        "plan",
        [_step("plan", "p1", status="completed", ordering=1)],
        completed_stages=[{"stage": "brainstorm", "status": "completed"}],
    )
    await _make_progress_row(db_session, ws.id, "triple", payload)

    svc = ChangeService(db_session)
    projected = await svc._project_current_stage([(ws.id, "triple")])
    info = projected[(ws.id, "triple")]
    assert isinstance(info, tuple) and len(info) == 3
    assert info[0] == "plan"
    assert info[1] == {"brainstorm"}
    # 第三元=SELECT 返回的 latest_progress 原文（SQLite JSON 列经 DB 往返是拷贝，
    # 断言内容等值而非对象同一，语义=数据本来就在 SELECT 结果里、零新增查询）
    assert info[2] == payload


def test_stage_group_order_matches_design() -> None:
    """排序键单测：已知 stage 按 STAGE_ORDER 序号；quick/未知并列追加在后按名稳定。"""
    assert STAGE_ORDER == ["brainstorm", "plan", "execute", "verify", "archive"]
    assert ChangeService._stage_group_order("brainstorm") == (0, "brainstorm")
    assert ChangeService._stage_group_order("archive") == (4, "archive")
    assert ChangeService._stage_group_order("quick") == (5, "quick")
    assert ChangeService._stage_group_order("zz-unknown") == (5, "zz-unknown")
    assert ChangeService._stage_group_order("aa-unknown") == (5, "aa-unknown")
    # 已知序永远先于未知序
    assert ChangeService._stage_group_order("archive") < ChangeService._stage_group_order("quick")


def test_extract_summary_fields_shape() -> None:
    """摘要五字段形状守护（StepProgressSummary contract，对齐 design §7）。"""
    assert set(StepProgressSummary.model_fields) == {
        "step_total",
        "steps_completed",
        "current_step_name",
        "current_step_status",
        "current_step_desc",
    }
    assert set(StepTimelineEntry.model_fields) == {
        "name",
        "stage",
        "status",
        "output",
        "completed_at",
        "ordering",
        "wait_reason",
    }
