"""Tests for step 级进度提取（2026-08-15-change-step-visibility task-01，design §5 Phase 1）。

覆盖 acceptance：
- _extract_step_progress：正常 steps（多 stage STAGE_ORDER 排序/摘要三态/waiting 判定）；
  steps 缺失 / 空数组 / 元素非 dict / latest_progress 非 dict → (None, None) 不抛（D-003@v1）。
- completed_at 归一化：``2026/8/15 23:44:08`` → ISO 8601 UTC；解析失败保留原串（Grill #18）。
- 明细 status 七值透传 CLI 原值（model.py StepStatus：completed/pending/in-progress/
  failed/blocked/waiting/stale）。
- output 两层分离（2026-08-16-change-owner-from-token task-04 / D-004@v1）：明细全量
  透传；列表摘要 current_step_desc 仍截 200（~200B/行契约）。
- enrich_summaries / enrich_with_workspace_ids 填充 step_progress / steps（集成）。
- _resolve_pending_change_keys 三元组解包适配后行为不变守护（Grill P0-1）。
- owner_name 两路径批量填充 + 查询次数锚定（task-04 / R-03/R-06 禁 N+1）。
- 时间线合成 owner_change 事件条目（task-04 / D-003@v1）：字段转换 / detail 非法跳过 /
  stage 近似归属 / 混合重编 ordering key 唯一。

fixture 范式参照 test_enrich_projection.py（conftest 注册 platform_change_progress 表）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.modules.change.dispatch import STAGE_ORDER
from app.modules.change.model import Change, ChangeEventORM
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
    """completed_at CLI 本地格式 → ISO 8601 UTC；解析失败保留原串；非 str → None。

    解释时区固定为 settings.cli_progress_timezone（默认 Asia/Shanghai），与后端
    进程时区无关——旧行为 ``astimezone()`` 随进程走，Docker 容器 UTC 下把东八区
    墙钟当 UTC，前端转浏览器本地后整体偏 8 小时（ql-20260822-006 回归锚定）。
    """
    steps = [
        _step("verify", "v1", status="completed", ordering=1, completed_at="2026/8/15 23:44:08")
    ]
    _, timeline = ChangeService._extract_step_progress(_payload("verify", steps))
    assert timeline is not None
    # 北京时间 2026/8/15 23:44:08 == UTC 15:44:08（不再随进程时区漂移）
    assert timeline[0].completed_at == "2026-08-15T15:44:08+00:00"

    steps_bad = [_step("verify", "v2", status="completed", ordering=1, completed_at="15/8/2026")]
    _, timeline_bad = ChangeService._extract_step_progress(_payload("verify", steps_bad))
    assert timeline_bad is not None
    assert timeline_bad[0].completed_at == "15/8/2026"  # 非法串原样保留

    steps_none = [_step("verify", "v3", status="in-progress", ordering=1, completed_at=None)]
    _, timeline_none = ChangeService._extract_step_progress(_payload("verify", steps_none))
    assert timeline_none is not None
    assert timeline_none[0].completed_at is None


def test_normalize_completed_at_tz_from_settings_not_process(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """归一化解释时区来自 settings 配置，与进程本地时区无关（ql-20260822-006）。

    同一墙钟串在 CLI_PROGRESS_TIMEZONE=UTC 与 +05:30 下产出各自配置的 UTC
    时刻——后端跑在任意进程时区（含容器 UTC）都不影响结果。IANA 名与固定
    偏移两种配置形态都走 resolve_cli_tzinfo。
    """
    from types import SimpleNamespace

    import app.modules.change.service as service_module

    monkeypatch.setattr(
        service_module, "get_settings", lambda: SimpleNamespace(cli_progress_timezone="UTC")
    )
    assert ChangeService._normalize_completed_at("2026/8/15 23:44:08") == (
        "2026-08-15T23:44:08+00:00"
    )
    monkeypatch.setattr(
        service_module, "get_settings", lambda: SimpleNamespace(cli_progress_timezone="+05:30")
    )
    assert ChangeService._normalize_completed_at("2026/8/15 23:44:08") == (
        "2026-08-15T18:14:08+00:00"
    )


def test_normalize_completed_at_unit() -> None:
    """_normalize_completed_at 单测：非 str → None；ISO 输出可被 fromisoformat 回读。"""
    assert ChangeService._normalize_completed_at(None) is None
    assert ChangeService._normalize_completed_at(123) is None
    assert ChangeService._normalize_completed_at("not a date") == "not a date"
    iso = ChangeService._normalize_completed_at("2026/08/15 23:44:08")
    assert isinstance(iso, str)
    assert datetime.fromisoformat(iso).tzinfo == UTC  # 回读即 UTC aware


def test_extract_output_two_layer_truncation_split() -> None:
    """Phase 2.4 两层分离（D-004@v1 有意行为变更，非修测试凑绿）：

    明细 output 全量透传（500 字原样）；列表摘要 current_step_desc 仍截 200
    （~200B/行契约不动）。非 str → None；摘要无当前步（全完成）→ None。
    """
    long_output = "x" * 500
    steps = [
        _step("execute", "t1", status="completed", ordering=1, output=long_output),
        _step("execute", "t2", status="in-progress", ordering=2, output="y" * 250),
        _step("execute", "t3", status="pending", ordering=3, output=123),
    ]
    summary, timeline = ChangeService._extract_step_progress(_payload("execute", steps))
    assert timeline is not None
    # 明细全量透传（截断已移除）
    assert timeline[0].output == "x" * 500
    assert timeline[1].output == "y" * 250
    assert timeline[2].output is None  # 非 str → None
    # 摘要层截断保留：当前步 = t2（第一个非 completed），250 → 200
    assert summary is not None
    assert summary.current_step_desc == "y" * 200

    # 全完成 → 无当前步 → 摘要 desc None（None 保持 None，不截不抛）
    done = [_step("plan", "p1", status="completed", ordering=1, output=long_output)]
    summary_done, _ = ChangeService._extract_step_progress(_payload("archive", done))
    assert summary_done is not None
    assert summary_done.current_step_desc is None


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
    """摘要五字段 + 明细九字段形状守护（task-03 加 kind/event_type，对齐 design §7）。"""
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
        "kind",
        "event_type",
    }


# ── owner_name 批量投影 + 时间线事件合成（2026-08-16-change-owner-from-token
#    task-04，design §5 Phase 2.1/2.2/2.4；R-03/R-06 两次批量 IN 禁 N+1）──


async def _make_user(
    db_session: AsyncSession,
    *,
    display_name: str | None = None,
    username: str | None = None,
) -> Any:
    """建 User 行（password_hash NOT NULL 兜底占位值，非真实登录用途）。"""
    from app.modules.auth.model import User

    tag = uuid.uuid4().hex[:8]
    user = User(
        id=uuid.uuid4(),
        email=f"sp-user-{tag}@example.com",
        username=username or f"sp-user-{tag}",
        password_hash="not-a-real-hash",
        display_name=display_name,
        status="active",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _set_owner(db_session: AsyncSession, change: Change, owner_id: uuid.UUID) -> Change:
    change.owner_id = owner_id
    db_session.add(change)
    await db_session.commit()
    return change


async def _make_owner_event(
    db_session: AsyncSession,
    ws_id: uuid.UUID,
    change_id: uuid.UUID,
    from_id: uuid.UUID,
    to_id: uuid.UUID,
    created_at: datetime,
) -> ChangeEventORM:
    """写一条 owner_change 事件行（detail 落 str UUID，对齐 task-02 写入侧口径）。"""
    event = ChangeEventORM(
        id=uuid.uuid4(),
        workspace_id=ws_id,
        change_id=change_id,
        event_type="owner_change",
        detail={"from_user_id": str(from_id), "to_user_id": str(to_id)},
        created_by=to_id,
        created_at=created_at,
    )
    db_session.add(event)
    await db_session.commit()
    return event


def _make_event_obj(
    from_id: uuid.UUID, to_id: uuid.UUID, created_at: datetime, detail: Any = None
) -> ChangeEventORM:
    """纯内存事件对象（不落库，纯函数单测用）。"""
    if detail is None:
        detail = {"from_user_id": str(from_id), "to_user_id": str(to_id)}
    return ChangeEventORM(
        id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        change_id=uuid.uuid4(),
        event_type="owner_change",
        detail=detail,
        created_by=to_id,
        created_at=created_at,
    )


# ── ① owner_name 两路径填充 ───────────────────────────────────────────


@pytest.mark.asyncio
async def test_owner_name_display_name_preferred_username_fallback(
    db_session: AsyncSession,
) -> None:
    """两路径 owner_name：display_name 优先；缺 display 用 username；owner_id None → None。"""
    ws = await _make_workspace(db_session)
    u_display = await _make_user(db_session, display_name="展示名A")
    u_username = await _make_user(db_session, display_name=None)
    c1 = await _make_change(db_session, ws.id, "own-1")
    c2 = await _make_change(db_session, ws.id, "own-2")
    c3 = await _make_change(db_session, ws.id, "own-3")
    await _set_owner(db_session, c1, u_display.id)
    await _set_owner(db_session, c2, u_username.id)
    # c3 owner_id=None（默认）→ owner_name None（前端降级）

    # 详情路径
    read = await ChangeService(db_session).enrich_with_workspace_ids(c1)
    read2 = await ChangeService(db_session).enrich_with_workspace_ids(c2)
    read3 = await ChangeService(db_session).enrich_with_workspace_ids(c3)
    assert read.owner_name == "展示名A"  # display_name 优先
    assert read2.owner_name == u_username.username  # username fallback
    assert read3.owner_name is None  # owner_id None → None

    # 列表路径（一次批量 IN 覆盖多 change）
    summaries = await ChangeService(db_session).enrich_summaries([c1, c2, c3])
    by_key = {s.change_key: s for s in summaries}
    assert by_key["own-1"].owner_name == "展示名A"
    assert by_key["own-2"].owner_name == u_username.username
    assert by_key["own-3"].owner_name is None


@pytest.mark.asyncio
async def test_owner_name_missing_user_degrades_to_none(db_session: AsyncSession) -> None:
    """owner_id 脏引用（用户已删/查不到）→ owner_name None（不进映射，不抛）。"""
    ws = await _make_workspace(db_session)
    ghost_id = uuid.uuid4()
    change = await _make_change(db_session, ws.id, "own-ghost")
    await _set_owner(db_session, change, ghost_id)

    read = await ChangeService(db_session).enrich_with_workspace_ids(change)
    assert read.owner_name is None
    (summary,) = await ChangeService(db_session).enrich_summaries([change])
    assert summary.owner_name is None


# ── ② 事件条目转换（纯函数） ──────────────────────────────────────────


def test_event_to_entry_field_mapping() -> None:
    """owner_change → StepTimelineEntry 逐字段：kind/event_type/name/output/status/时间。"""
    uid_a, uid_b = uuid.uuid4(), uuid.uuid4()
    event_dt = datetime(2026, 8, 16, 6, 30, 0, tzinfo=UTC)
    event = _make_event_obj(uid_a, uid_b, event_dt)
    names = {uid_a: "甲", uid_b: "乙"}
    entry, returned_dt = ChangeService._event_to_entry(event, names, "plan", [])
    assert entry is not None and returned_dt == event_dt
    assert entry.kind == "event"
    assert entry.event_type == "owner_change"
    assert entry.name == "责任人变更"
    assert entry.output == "甲 → 乙"
    assert entry.status == "completed"
    assert entry.completed_at == event_dt.isoformat()
    assert entry.wait_reason is None

    # 用户查不到（已删/脏引用）→ UUID 前 8 位占位（对齐前端降级），不抛
    entry2, _ = ChangeService._event_to_entry(event, {}, "plan", [])
    assert entry2 is not None
    assert entry2.output == f"{str(uid_a)[:8]} → {str(uid_b)[:8]}"


def test_event_to_entry_illegal_detail_skipped() -> None:
    """detail 非法（缺 from/to、非 UUID 串、detail 非 dict）→ (None, None) 不抛（R-01）。"""
    event_dt = datetime(2026, 8, 16, 6, 30, 0, tzinfo=UTC)
    uid = uuid.uuid4()
    for bad_detail in (
        {"to_user_id": str(uid)},  # 缺 from
        {"from_user_id": str(uid)},  # 缺 to
        {"from_user_id": "not-a-uuid", "to_user_id": str(uid)},  # 非法 UUID
        "not-a-dict",  # detail 非 dict
    ):
        event = _make_event_obj(uid, uid, event_dt, detail=bad_detail)
        assert ChangeService._event_to_entry(event, {}, "plan", []) == (None, None)


def test_event_stage_attribution_started_at_vs_fallback() -> None:
    """stage 近似归属两分支：started_at 命中最近已开始 stage / 无法判定 fallback current_stage。

    事件时刻从归一化后的 stage started_at 派生（本地时区无关，跨环境稳定）。
    """
    uid = uuid.uuid4()
    names = {uid: "甲"}

    # 分支 1：stages[].started_at 可解析（CLI 本地格式，经 _normalize_completed_at
    # 归一化）→ 落最近一个 started_at ≤ 事件时刻的 stage（plan 已开始，execute 未）
    latest_progress = _payload(
        "execute",
        [],
        completed_stages=[
            {"stage": "brainstorm", "status": "completed", "started_at": "2026/8/16 09:00:00"},
            {"stage": "plan", "status": "completed", "started_at": "2026/8/16 10:00:00"},
            {"stage": "execute", "status": "in-progress", "started_at": "2026/8/16 18:00:00"},
        ],
    )
    starts = ChangeService._extract_stage_starts(latest_progress)
    assert len(starts) == 3
    event_dt = starts[1][0] + (starts[2][0] - starts[1][0]) / 2  # plan 与 execute 之间
    event = _make_event_obj(uid, uid, event_dt)
    entry, _ = ChangeService._event_to_entry(event, names, "execute", starts)
    assert entry is not None
    assert entry.stage == "plan"

    # 分支 2：无可解析 started_at（空）→ fallback 投影 current_stage
    entry_fb, _ = ChangeService._event_to_entry(event, names, "verify", [])
    assert entry_fb is not None
    assert entry_fb.stage == "verify"

    # 分支 2b：事件早于全部 started_at → 仍 fallback current_stage
    early_dt = starts[0][0] - timedelta(hours=1)
    early_event = _make_event_obj(uid, uid, early_dt)
    entry_early, _ = ChangeService._event_to_entry(early_event, names, "brainstorm", starts)
    assert entry_early is not None
    assert entry_early.stage == "brainstorm"


def test_extract_stage_starts_defensive() -> None:
    """_extract_stage_starts 防御判型：非 dict / stages 非 list / started_at 缺失或非法 → 跳过。"""
    assert ChangeService._extract_stage_starts(None) == []
    assert ChangeService._extract_stage_starts("x") == []
    assert ChangeService._extract_stage_starts({"stages": "x"}) == []
    # started_at 非法串（保留原串 → fromisoformat 失败）/ 非 str → 跳过
    assert ChangeService._extract_stage_starts({"stages": [{"stage": "plan"}]}) == []
    assert (
        ChangeService._extract_stage_starts(
            {"stages": [{"stage": "plan", "started_at": "15/8/2026"}]}
        )
        == []
    )
    # 合法：本地格式归一化后可回读 datetime（本地时区动态，只断言可解析 + stage 名）
    starts = ChangeService._extract_stage_starts(
        {"stages": [{"stage": "plan", "started_at": "2026/8/16 10:00:00"}]}
    )
    assert len(starts) == 1
    assert starts[0][1] == "plan"
    assert isinstance(starts[0][0], datetime)


# ── ③ 混合排序 / 重编 ordering（纯函数） ──────────────────────────────


def _local_dt(cli_str: str) -> datetime:
    """CLI 本地格式串 → UTC datetime（经 _normalize_completed_at 同款往返，跨时区环境稳）。"""
    normalized = ChangeService._normalize_completed_at(cli_str)
    assert isinstance(normalized, str)
    return datetime.fromisoformat(normalized)


def test_merge_event_entries_insert_position_and_renumber() -> None:
    """事件按时间序插组内正确位 + 混合重编 ordering 0..n-1 + key 集合无重复（Grill P1-1）。"""
    uid_a, uid_b = uuid.uuid4(), uuid.uuid4()
    names = {uid_a: "甲", uid_b: "乙"}
    # 时间线：plan 3 步（10:00 完 / 11:00 完 / 进行中无 completed_at）
    steps = [
        _step("plan", "p1", status="completed", ordering=1, completed_at="2026/8/16 10:00:00"),
        _step("plan", "p2", status="completed", ordering=2, completed_at="2026/8/16 11:00:00"),
        _step("plan", "p3", status="in-progress", ordering=3),
    ]
    _, timeline = ChangeService._extract_step_progress(_payload("plan", steps))
    assert timeline is not None
    # 事件在 10:00 与 11:00 之间 → 插在 p1 后、p2 前
    ev1 = _make_event_obj(uid_a, uid_b, _local_dt("2026/8/16 10:30:00"))
    # 事件 12:00 → 晚于组内全部可解析 completed_at；p3（None 视为最晚）天然晚于
    # 历史事件 → 事件落在 p2 后、p3 前（最后一条可解析 ≤ 者紧后）
    ev2 = _make_event_obj(uid_b, uid_a, _local_dt("2026/8/16 12:00:00"))
    merged = ChangeService._merge_event_entries(
        timeline, [ev1, ev2], _payload("plan", steps), "plan", names
    )
    assert merged is not None
    assert [e.name for e in merged] == ["p1", "责任人变更", "p2", "责任人变更", "p3"]
    assert [e.kind for e in merged] == ["step", "event", "step", "event", "step"]
    # 统一重编 0..n-1
    assert [e.ordering for e in merged] == [0, 1, 2, 3, 4]
    # 前端 key `${stage}-${ordering}` 集合无重复（Grill P1-1）
    keys = [f"{e.stage}-{e.ordering}" for e in merged]
    assert len(keys) == len(set(keys))
    # 明细 output = "A → B"（用户名 join）
    events_in = [e for e in merged if e.kind == "event"]
    assert events_in[0].output == "甲 → 乙"
    assert events_in[1].output == "乙 → 甲"


def test_merge_event_entries_none_timeline_or_no_events() -> None:
    """steps None → 不合成整体 None；无事件 / 全部非法 → 原样返回（纯 steps 零变化）。"""
    uid = uuid.uuid4()
    names = {uid: "甲"}
    assert ChangeService._merge_event_entries(None, [], {}, "plan", names) is None
    assert (
        ChangeService._merge_event_entries(
            None, [_make_event_obj(uid, uid, datetime.now(UTC))], {}, "plan", names
        )
        is None
    )

    steps = [
        _step("plan", "p1", status="completed", ordering=1, completed_at="2026/8/16 10:00:00"),
        _step("plan", "p2", status="pending", ordering=2),
    ]
    _, timeline = ChangeService._extract_step_progress(_payload("plan", steps))
    assert timeline is not None
    # 无事件 → 原对象原样返回
    assert ChangeService._merge_event_entries(timeline, [], {}, "plan", names) is timeline
    # 全部事件非法（detail 缺 to）→ 零插入原样返回（ordering 不重编）
    bad = _make_event_obj(uid, uid, datetime.now(UTC), detail={"from_user_id": str(uid)})
    assert ChangeService._merge_event_entries(timeline, [bad], {}, "plan", names) is timeline


def test_merge_event_entries_group_head_insert_and_stage_group_order() -> None:
    """组内全无 ≤ 者 → 插组首；事件 stage 无对应组 → 按阶段组序插入（不 append 尾）。"""
    uid = uuid.uuid4()
    names = {uid: "甲"}
    # plan 组步骤全部晚于事件（不可解析 None 视最晚；可解析 11:00 > 事件 10:30 本地）
    steps = [
        _step(
            "brainstorm", "b1", status="completed", ordering=1, completed_at="2026/8/16 09:00:00"
        ),
        _step("plan", "p1", status="completed", ordering=1, completed_at="2026/8/16 11:00:00"),
        _step("plan", "p2", status="in-progress", ordering=2),
    ]
    _, timeline = ChangeService._extract_step_progress(_payload("plan", steps))
    assert timeline is not None
    ev = _make_event_obj(uid, uid, _local_dt("2026/8/16 10:30:00"))
    merged = ChangeService._merge_event_entries(
        timeline, [ev], _payload("plan", steps), "plan", names
    )
    assert merged is not None
    # plan 组内无可解析 ≤ 者（11:00 > 10:30；p2 None 视最晚）→ 插 plan 组首
    assert [e.name for e in merged] == ["b1", "责任人变更", "p1", "p2"]
    assert merged[1].stage == "plan"

    # 事件归到 verify（无 verify 组）→ 按阶段组序插入；本时间线无更后组 → 落最后
    steps2 = [_step("plan", "p1", status="in-progress", ordering=1)]
    _, timeline2 = ChangeService._extract_step_progress(_payload("verify", steps2))
    assert timeline2 is not None
    merged2 = ChangeService._merge_event_entries(
        timeline2, [ev], _payload("verify", steps2), "verify", names
    )
    assert merged2 is not None
    assert [e.name for e in merged2] == ["p1", "责任人变更"]
    assert merged2[1].stage == "verify"


# ── ④ 时间线合成集成（DB，详情路径） ──────────────────────────────────


@pytest.mark.asyncio
async def test_enrich_detail_synthesizes_owner_events(db_session: AsyncSession) -> None:
    """详情路径集成：steps + events → 混合时间线（事件条目 + 重编 ordering + key 唯一）。"""
    ws = await _make_workspace(db_session)
    u1 = await _make_user(db_session, display_name="甲")
    u2 = await _make_user(db_session, display_name="乙")
    change = await _make_change(db_session, ws.id, "own-tl")
    await _set_owner(db_session, change, u2.id)
    await _make_progress_row(db_session, ws.id, "own-tl", _full_steps_payload("plan"))
    # 事件 12:30（CLI 本地时刻，在「拆任务」12:00 完成后、「写 plan.md」进行中前）
    event_dt = _local_dt("2026/8/15 12:30:00")
    await _make_owner_event(db_session, ws.id, change.id, u1.id, u2.id, event_dt)

    read = await ChangeService(db_session).enrich_with_workspace_ids(change)
    assert read.owner_name == "乙"
    assert read.steps is not None
    kinds = [e.kind for e in read.steps]
    assert kinds.count("event") == 1
    event_entry = next(e for e in read.steps if e.kind == "event")
    assert event_entry.event_type == "owner_change"
    assert event_entry.name == "责任人变更"
    assert event_entry.output == "甲 → 乙"
    assert event_entry.stage == "plan"
    assert event_entry.status == "completed"
    assert event_entry.completed_at == event_dt.isoformat()
    assert event_entry.wait_reason is None
    # 位置：拆任务（12:00 完成）后、写 plan.md 前；重编 ordering 0..n-1
    names_order = [e.name for e in read.steps]
    assert names_order == ["调研", "产出方案", "拆任务", "责任人变更", "写 plan.md"]
    assert [e.ordering for e in read.steps] == [0, 1, 2, 3, 4]
    keys = [f"{e.stage}-{e.ordering}" for e in read.steps]
    assert len(keys) == len(set(keys))


@pytest.mark.asyncio
async def test_enrich_detail_steps_none_events_not_synthesized(db_session: AsyncSession) -> None:
    """steps None（有事件但无 steps 可挂载）→ 时间线整体 None（D-003 降级语义）。"""
    ws = await _make_workspace(db_session)
    u1 = await _make_user(db_session, display_name="甲")
    u2 = await _make_user(db_session, display_name="乙")
    change = await _make_change(db_session, ws.id, "own-tl-none")
    await _set_owner(db_session, change, u2.id)
    await _make_progress_row(db_session, ws.id, "own-tl-none", _payload("execute", steps=[]))
    await _make_owner_event(
        db_session, ws.id, change.id, u1.id, u2.id, _local_dt("2026/8/15 12:30:00")
    )

    read = await ChangeService(db_session).enrich_with_workspace_ids(change)
    assert read.owner_name == "乙"  # owner_name 与时间线合成解耦
    assert read.step_progress is None
    assert read.steps is None


@pytest.mark.asyncio
async def test_enrich_detail_owner_name_two_names_users_in_merged(db_session: AsyncSession) -> None:
    """事件 A/B 用户名与 owner_name 共用一次 users IN（R-06）：owner 是第三方也一次查齐。"""
    ws = await _make_workspace(db_session)
    u1 = await _make_user(db_session, display_name="甲")
    u2 = await _make_user(db_session, display_name="乙")
    u3 = await _make_user(db_session, display_name="丙")
    change = await _make_change(db_session, ws.id, "own-merge")
    await _set_owner(db_session, change, u3.id)
    await _make_progress_row(db_session, ws.id, "own-merge", _full_steps_payload("plan"))
    await _make_owner_event(
        db_session, ws.id, change.id, u1.id, u2.id, _local_dt("2026/8/15 12:30:00")
    )

    read = await ChangeService(db_session).enrich_with_workspace_ids(change)
    assert read.owner_name == "丙"  # owner 独立于事件 A/B
    assert read.steps is not None
    event_entry = next(e for e in read.steps if e.kind == "event")
    assert event_entry.output == "甲 → 乙"


# ── ⑥ 查询次数锚定（R-03/R-06 防 N+1 回归） ──────────────────────────


class _ExecuteCounter:
    """monkeypatch 计数 session.execute，按语句包含的表名归类（users/events/其它）。"""

    def __init__(self, session: AsyncSession) -> None:
        self.counts = {"users": 0, "change_events": 0}
        self._real = session.execute

    async def __call__(self, *args: Any, **kwargs: Any) -> Any:
        stmt = args[0] if args else kwargs.get("statement")
        sql = str(stmt)
        if "FROM users" in sql or "users.id IN" in sql:
            self.counts["users"] += 1
        if "change_events" in sql:
            self.counts["change_events"] += 1
        return await self._real(*args, **kwargs)


@pytest.mark.asyncio
async def test_query_counts_list_users_once_events_zero(db_session: AsyncSession) -> None:
    """列表路径：N change 一次批量 → users IN 恒 1 次 + events 0 次（零成本）。"""
    ws = await _make_workspace(db_session)
    u1 = await _make_user(db_session, display_name="甲")
    u2 = await _make_user(db_session, display_name="乙")
    changes = []
    for i in range(3):
        c = await _make_change(db_session, ws.id, f"qc-list-{i}")
        await _set_owner(db_session, c, u1.id if i % 2 == 0 else u2.id)
        await _make_progress_row(db_session, ws.id, f"qc-list-{i}", _full_steps_payload("plan"))
        # 列表路径即使有事件也不该查 events
        await _make_owner_event(
            db_session, ws.id, c.id, u1.id, u2.id, _local_dt("2026/8/15 12:30:00")
        )
        changes.append(c)

    counter = _ExecuteCounter(db_session)
    monkey = pytest.MonkeyPatch()
    monkey.setattr(db_session, "execute", counter)
    try:
        summaries = await ChangeService(db_session).enrich_summaries(changes)
    finally:
        monkey.undo()
    assert len(summaries) == 3
    assert all(s.owner_name is not None for s in summaries)
    assert counter.counts["users"] == 1  # R-03：N change 恒 1 次
    assert counter.counts["change_events"] == 0  # 列表零 events 查询


@pytest.mark.asyncio
async def test_query_counts_detail_users_once_events_once(db_session: AsyncSession) -> None:
    """详情路径（含事件合成）：users IN 1 次（owner+A/B 合并 R-06）+ events IN 1 次。"""
    ws = await _make_workspace(db_session)
    u1 = await _make_user(db_session, display_name="甲")
    u2 = await _make_user(db_session, display_name="乙")
    u3 = await _make_user(db_session, display_name="丙")
    change = await _make_change(db_session, ws.id, "qc-detail")
    await _set_owner(db_session, change, u3.id)
    await _make_progress_row(db_session, ws.id, "qc-detail", _full_steps_payload("plan"))
    # 两条事件（A→B、B→C）+ owner 是第三方：users id 集合 = owner ∪ 事件 A/B
    await _make_owner_event(
        db_session, ws.id, change.id, u1.id, u2.id, _local_dt("2026/8/15 12:10:00")
    )
    await _make_owner_event(
        db_session, ws.id, change.id, u2.id, u3.id, _local_dt("2026/8/15 12:20:00")
    )

    counter = _ExecuteCounter(db_session)
    monkey = pytest.MonkeyPatch()
    monkey.setattr(db_session, "execute", counter)
    try:
        read = await ChangeService(db_session).enrich_with_workspace_ids(change)
    finally:
        monkey.undo()
    assert read.owner_name == "丙"
    assert read.steps is not None
    assert sum(1 for e in read.steps if e.kind == "event") == 2
    assert counter.counts["users"] == 1  # R-06：owner+事件 A/B 一次查齐
    assert counter.counts["change_events"] == 1  # events 一次 IN
