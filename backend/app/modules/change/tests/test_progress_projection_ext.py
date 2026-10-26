"""Tests for 阶段进度投影扩展（2026-10-26-session-change-progress-hover task-02）。

覆盖 acceptance：
- _extract_stage_progress 主路径：5 阶段 stages[]×steps[] 分组计数 + 起止时间
  zh-CN→ISO UTC 归一化 + 耗时秒数（固定 now 注入断言，R-04）+ revision 透传；
- 盲区#1：stages 行在而 steps 空/缺失 → steps_total=0 计数字段照常输出（不除零）；
- 畸形样本 fail-open（R-01）：latest_progress 非 dict / stages 缺失/非 list / 行
  非 dict / 身份字段缺失 → None 或丢行不抛；zh-CN 旧格式时间戳归一化、缺
  started_at / 坏时间戳串 → duration_seconds=None；
- enrich_summaries 挂载：命中投影 → stage_progress 填充；未命中 / deleted 行 →
  None（防复活口径）；platform_change_progress 查询恒 1 次（零新增查询锚定）。

fixture 范式参照 test_step_progress.py（conftest 注册 platform_change_progress 表）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

import app.modules.change.service as service_module
from app.modules.change.model import Change
from app.modules.change.schema import ChangeSummary, StageProgressEntry
from app.modules.change.service import ChangeService
from app.modules.platform_sync.model import PlatformChangeProgressORM
from app.modules.workspace.model import Workspace

# 固定注入时钟（R-04：提取器纯函数不取全局时钟，测试确定性由注入保证）。
_NOW = datetime(2026, 10, 26, 12, 0, 0, tzinfo=UTC)


def _fix_cli_tz(monkeypatch: pytest.MonkeyPatch, tz: str = "Asia/Shanghai") -> None:
    """固定 _normalize_completed_at 的解释时区（默认 Asia/Shanghai 与生产一致）。"""
    monkeypatch.setattr(
        service_module, "get_settings", lambda: SimpleNamespace(cli_progress_timezone=tz)
    )


def _stage_row(
    stage: str,
    status: str,
    *,
    started_at: str | None = None,
    completed_at: str | None = None,
    revision: Any = None,
) -> dict:
    """stages 表行镜像（CLI serializeForSync 六表；started/completed 为 zh-CN 墙钟）。"""
    return {
        "change_name": "demo",
        "stage": stage,
        "status": status,
        "started_at": started_at,
        "completed_at": completed_at,
        "revision": revision,
    }


def _step_row(stage: str, name: str, *, status: str = "completed", ordering: int = 0) -> dict:
    return {
        "change_name": "demo",
        "stage": stage,
        "name": name,
        "status": status,
        "output": None,
        "completed_at": None,
        "ordering": ordering,
        "wait_reason": None,
    }


def _payload(
    stages: list[dict] | Any,
    steps: list[dict] | Any | None = None,
    *,
    current_stage: str = "execute",
) -> dict:
    """latest_progress 镜像（对齐 CLI serializeForSync 六表：stages/steps 均顶层数组）。"""
    return {
        "project": {"name": "demo"},
        "changes": [{"name": "demo", "current_stage": current_stage, "status": "in_progress"}],
        "stages": stages,
        "steps": steps if steps is not None else [],
        "batch_progress": [],
        "approvals": [],
    }


def _full_stage_payload() -> dict:
    """主线 5 阶段乱序 stages + 分组 steps：brainstorm 2/2 全完、plan 3/2（blocked 计
    total 不计 completed）、execute 2/1 进行中（revising+revision）、verify/archive
    未启动（无 steps 行 → 0/0 空圈）；另含 ghost 未知 stage 行与非 dict 畸形行。"""
    stages = [
        _stage_row("verify", "pending"),
        _stage_row(
            "brainstorm",
            "completed",
            started_at="2026/10/26 08:00:00",
            completed_at="2026/10/26 09:00:00",
        ),
        _stage_row("archive", "pending"),
        _stage_row(
            "plan",
            "completed",
            started_at="2026/10/26 09:00:00",
            completed_at="2026/10/26 10:30:00",
        ),
        _stage_row("execute", "revising", started_at="2026/10/26 11:00:00", revision=1),
    ]
    steps = [
        _step_row("brainstorm", "b1", ordering=1),
        _step_row("brainstorm", "b2", ordering=2),
        _step_row("plan", "p1", ordering=1),
        _step_row("plan", "p2", ordering=2),
        _step_row("plan", "p3", status="blocked", ordering=3),
        _step_row("execute", "e1", ordering=1),
        _step_row("execute", "e2", status="in-progress", ordering=2),
        _step_row("ghost", "x", ordering=1),  # 无对应 stages 行 → 不映射任何阶段不崩
        "not-a-dict",  # 畸形 steps 行 → 跳过
    ]
    return _payload(stages, steps)


# ── 提取器单测（纯函数，无 DB 依赖）──


def test_extract_full_five_stages_counts_duration_revision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """主路径：stages+steps 明细 → 5 阶段 entries（STAGE_ORDER 定序 / 分组计数 /
    zh-CN→ISO UTC 起止 / 固定 now 耗时 / revision 透传，acceptance 条 1）。"""
    _fix_cli_tz(monkeypatch)
    entries = ChangeService._extract_stage_progress(_full_stage_payload(), now=_NOW)
    assert entries is not None
    assert [e.stage for e in entries] == ["brainstorm", "plan", "execute", "verify", "archive"]

    brainstorm, plan, execute, verify, archive = entries
    # 已完成阶段：起止归一化（北京 08:00→UTC 00:00）+ 耗时=completed−started。
    assert brainstorm.status == "completed"
    assert brainstorm.steps_total == 2
    assert brainstorm.steps_completed == 2
    assert brainstorm.started_at == "2026-10-26T00:00:00+00:00"
    assert brainstorm.completed_at == "2026-10-26T01:00:00+00:00"
    assert brainstorm.duration_seconds == 3600
    assert brainstorm.revision is None
    # blocked 计 total 不计 completed（steps_total 含 waiting/blocked 全计数）。
    assert (plan.steps_total, plan.steps_completed) == (3, 2)
    assert plan.duration_seconds == 5400  # 09:00→10:30 CST = 01:00Z→02:30Z
    # 进行中（revising）：CLI 原值 status 透传不归一 + revision + now−started 耗时。
    assert execute.status == "revising"
    assert (execute.steps_total, execute.steps_completed) == (2, 1)
    assert execute.completed_at is None
    assert execute.duration_seconds == 32400  # 11:00 CST=03:00Z → now 12:00Z 共 9h
    assert execute.revision == 1
    # 未启动阶段：无 steps 行 0/0 空圈不除零；无 started_at → duration None。
    for pending in (verify, archive):
        assert (pending.steps_total, pending.steps_completed) == (0, 0)
        assert pending.started_at is None
        assert pending.duration_seconds is None
        assert pending.revision is None


def test_extract_iso_timestamps_passthrough(monkeypatch: pytest.MonkeyPatch) -> None:
    """ISO 原串（带时区）与 zh-CN 墙钟双格式兼容：ISO 直接可用，耗时照算。"""
    _fix_cli_tz(monkeypatch)
    payload = _payload(
        [
            _stage_row(
                "execute",
                "in-progress",
                started_at="2026-10-26T04:00:00+00:00",
                completed_at="2026-10-26T05:30:00+00:00",
            )
        ]
    )
    entries = ChangeService._extract_stage_progress(payload, now=_NOW)
    assert entries is not None and len(entries) == 1
    assert entries[0].started_at == "2026-10-26T04:00:00+00:00"
    assert entries[0].duration_seconds == 5400


def test_extract_steps_missing_zero_counts_not_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """盲区#1：stages 行在而 steps 空/键缺失 → 各阶段 0/0 计数照常输出（entries 非
    None，前端空圈不除零）；steps 非 list → 同样不崩。"""
    _fix_cli_tz(monkeypatch)
    stages = [
        _stage_row(
            "brainstorm",
            "completed",
            started_at="2026/10/26 08:00:00",
            completed_at="2026/10/26 09:00:00",
        ),
        _stage_row("execute", "in-progress", started_at="2026/10/26 11:00:00"),
    ]
    for steps in list[list | str | None]([[], None, "not-a-list"]):
        payload = _payload(stages, steps)
        if steps is None:
            del payload["steps"]  # 键整缺失（存量无 steps 明细）
        entries = ChangeService._extract_stage_progress(payload, now=_NOW)
        assert entries is not None and len(entries) == 2
        assert all(e.steps_total == 0 and e.steps_completed == 0 for e in entries)
        # 计数缺位不影响耗时口径（completed 阶段 completed−started 仍可算）。
        assert entries[0].duration_seconds == 3600


def test_extract_malformed_fail_open_to_none(monkeypatch: pytest.MonkeyPatch) -> None:
    """畸形样本 fail-open（R-01 / acceptance 条 2）：latest_progress 非 dict /
    stages 缺失 / 非 list / 无一有效行 → None 不抛。"""
    _fix_cli_tz(monkeypatch)
    assert ChangeService._extract_stage_progress(None, now=_NOW) is None
    assert ChangeService._extract_stage_progress("junk", now=_NOW) is None
    assert (
        ChangeService._extract_stage_progress(_payload(None, []), now=_NOW) is None
    )  # stages=None
    no_stages = _payload([], [])
    del no_stages["stages"]
    assert ChangeService._extract_stage_progress(no_stages, now=_NOW) is None
    assert ChangeService._extract_stage_progress(_payload("not-a-list", []), now=_NOW) is None
    # 行全无效（非 dict / 缺身份字段）→ None。
    assert ChangeService._extract_stage_progress(_payload(["junk", 123], []), now=_NOW) is None
    # stage/status 任一缺失均丢行 → 无一有效行 → None。
    all_invalid = _payload([{"stage": "plan"}, {"status": "in-progress"}], [])
    assert ChangeService._extract_stage_progress(all_invalid, now=_NOW) is None


def test_extract_mixed_rows_drop_invalid_keep_valid(monkeypatch: pytest.MonkeyPatch) -> None:
    """行级畸形混排：非 dict 行 / 身份字段缺失行丢弃，有效行保留（对齐
    _extract_step_progress 丢行口径，不因单行畸形整体失败）。"""
    _fix_cli_tz(monkeypatch)
    payload = _payload(
        [
            "not-a-dict",  # 跳过
            {"stage": "plan"},  # 缺 status → 跳过
            _stage_row(
                "brainstorm",
                "completed",
                started_at="2026/10/26 08:00:00",
                completed_at="2026/10/26 09:00:00",
            ),
            {"stage": "execute", "status": None},  # status 非 str → 跳过
        ],
        [_step_row("brainstorm", "b1")],
    )
    entries = ChangeService._extract_stage_progress(payload, now=_NOW)
    assert entries is not None
    assert [e.stage for e in entries] == ["brainstorm"]
    assert (entries[0].steps_total, entries[0].steps_completed) == (1, 1)


def test_extract_bad_timestamps_and_revision_degrade(monkeypatch: pytest.MonkeyPatch) -> None:
    """时间戳/revision 畸形降级不抛：坏串原样保留且 duration=None（缺 started_at 同）；
    revision 非 int（str/bool）→ None；zh-CN 墙钟与 naive ISO 混型不抛。"""
    _fix_cli_tz(monkeypatch)
    payload = _payload(
        [
            # started_at 坏串：归一化保留原串 → 不可解析 → duration None。
            _stage_row(
                "plan", "completed", started_at="15/8/2026", completed_at="2026/10/26 09:00:00"
            ),
            # 缺 started_at（未启动/数据缺列）→ duration None。
            _stage_row("verify", "pending", completed_at="2026/10/26 09:00:00"),
            # revision 畸形（str / bool 伪 int）→ None。
            _stage_row("archive", "revising", started_at="2026/10/26 11:00:00", revision="2"),
            _stage_row("execute", "revising", started_at="2026/10/26 11:00:00", revision=True),
        ]
    )
    entries = ChangeService._extract_stage_progress(payload, now=_NOW)
    assert entries is not None
    by_stage = {e.stage: e for e in entries}
    assert by_stage["plan"].started_at == "15/8/2026"  # 非法串原样保留（Grill #18 口径）
    assert by_stage["plan"].duration_seconds is None
    assert by_stage["verify"].duration_seconds is None  # 无 started_at → 不算耗时
    assert by_stage["archive"].revision is None
    assert by_stage["execute"].revision is None
    # naive ISO（无时区标记）与注入 aware now 混型相减 TypeError → None 不抛。
    naive = _payload([_stage_row("brainstorm", "in-progress", started_at="2026-10-26T03:00:00")])
    entries_naive = ChangeService._extract_stage_progress(naive, now=_NOW)
    assert entries_naive is not None
    assert entries_naive[0].duration_seconds is None


# ── enrich_summaries 集成（DB）──


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
    session: AsyncSession,
    workspace_id: uuid.UUID,
    change_key: str,
    *,
    stage: str = "plan",
    location: str = "active",
) -> Change:
    change = Change(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        change_key=change_key,
        title=change_key,
        status="active",
        location=location,
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
            last_pushed_at="2026-10-26T00:00:00Z",
            last_pusher="agent",
        )
    )
    await session.commit()


@pytest.mark.asyncio
async def test_enrich_summaries_fills_stage_progress(
    db_session: AsyncSession,
) -> None:
    """列表路径：命中投影 → stage_progress 填充（计数/revision 与纯函数一致）；
    未命中行（无 progress 行）→ None（fallback 前端降级）。"""
    ws = await _make_workspace(db_session)
    c_hit = await _make_change(db_session, ws.id, "sp2-hit")
    c_miss = await _make_change(db_session, ws.id, "sp2-miss")
    await _make_progress_row(db_session, ws.id, "sp2-hit", _full_stage_payload())

    summaries = await ChangeService(db_session).enrich_summaries([c_hit, c_miss])
    by_key = {s.change_key: s for s in summaries}
    hit = by_key["sp2-hit"]
    assert isinstance(hit, ChangeSummary)
    assert hit.stage_progress is not None
    assert [e.stage for e in hit.stage_progress] == [
        "brainstorm",
        "plan",
        "execute",
        "verify",
        "archive",
    ]
    execute = next(e for e in hit.stage_progress if e.stage == "execute")
    assert isinstance(execute, StageProgressEntry)
    assert (execute.steps_total, execute.steps_completed) == (2, 1)
    assert execute.revision == 1
    assert execute.duration_seconds is not None and execute.duration_seconds >= 0  # 真时钟注入
    assert by_key["sp2-miss"].stage_progress is None


@pytest.mark.asyncio
async def test_enrich_summaries_deleted_row_no_stage_projection(
    db_session: AsyncSession,
) -> None:
    """deleted 行不投影 stage_progress（对齐 task-06 防复活口径：残留 progress 行
    不得把已删行投影回显）——即使 progress 行仍在。"""
    ws = await _make_workspace(db_session)
    c_del = await _make_change(db_session, ws.id, "sp2-del", location="deleted")
    await _make_progress_row(db_session, ws.id, "sp2-del", _full_stage_payload())

    (summary,) = await ChangeService(db_session).enrich_summaries([c_del])
    assert summary.stage_progress is None
    assert summary.current_stage == "plan"  # row 现值原样返回不被覆盖


@pytest.mark.asyncio
async def test_enrich_summaries_progress_query_anchored_single(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """零新增查询锚定（constraints）：stage_progress 挂载只消费 in-手
    latest_progress——N change 命中投影，platform_change_progress 表查询恒 1 次
    （projection 批量 IN），提取器自身零 SQL。"""
    _fix_cli_tz(monkeypatch)
    ws = await _make_workspace(db_session)
    changes = []
    for i in range(3):
        key = f"sp2-qc-{i}"
        changes.append(await _make_change(db_session, ws.id, key))
        await _make_progress_row(db_session, ws.id, key, _full_stage_payload())

    counts = {"platform_change_progress": 0}
    real_execute = db_session.execute

    async def counting_execute(*args: Any, **kwargs: Any) -> Any:
        sql = str(args[0] if args else kwargs.get("statement"))
        if "platform_change_progress" in sql:
            counts["platform_change_progress"] += 1
        return await real_execute(*args, **kwargs)

    monkeypatch.setattr(db_session, "execute", counting_execute)
    summaries = await ChangeService(db_session).enrich_summaries(changes)
    monkeypatch.undo()

    assert counts["platform_change_progress"] == 1
    assert all(s.stage_progress is not None for s in summaries)


# ── task-03：task_progress 批量聚合（FR-02 / D-005@v1）────────────────────────


async def _make_task_row(
    session: AsyncSession,
    change_id: uuid.UUID,
    workspace_id: uuid.UUID,
    task_key: str,
    *,
    status: str = "draft",
) -> None:
    """最小 tasks 行（Task 表 status 6 值：draft/ready/in_progress/review/done/cancelled）。"""
    from app.modules.task.model import Task as TaskRow

    session.add(
        TaskRow(
            workspace_id=workspace_id,
            change_id=change_id,
            task_key=task_key,
            title=task_key,
            status=status,
        )
    )


@pytest.mark.asyncio
async def test_task_progress_aggregate_excludes_cancelled(
    db_session: AsyncSession,
) -> None:
    """主路径：12 行 task（8 done / 1 cancelled / 3 draft）→ {total: 11, done: 8}。"""
    ws = await _make_workspace(db_session)
    change = await _make_change(db_session, ws.id, "tp-agg-a")
    # 8 done + 3 draft + 1 cancelled = 12 行；cancelled 不计分母 → total 11
    for i in range(8):
        await _make_task_row(db_session, change.id, ws.id, f"task-{i:02d}", status="done")
    for i in range(3):
        await _make_task_row(db_session, change.id, ws.id, f"task-1{i}", status="draft")
    await _make_task_row(db_session, change.id, ws.id, "task-cancelled", status="cancelled")
    await db_session.commit()

    summaries = await ChangeService(db_session).enrich_summaries([change])
    assert summaries[0].task_progress is not None
    assert summaries[0].task_progress.total == 11
    assert summaries[0].task_progress.done == 8


@pytest.mark.asyncio
async def test_task_progress_all_cancelled_total_zero(
    db_session: AsyncSession,
) -> None:
    """盲区#2：全 cancelled → total=0（显示面 — 不除零，归前端处理）。"""
    ws = await _make_workspace(db_session)
    change = await _make_change(db_session, ws.id, "tp-agg-b")
    for i in range(3):
        await _make_task_row(db_session, change.id, ws.id, f"task-{i}", status="cancelled")
    await db_session.commit()

    summaries = await ChangeService(db_session).enrich_summaries([change])
    assert summaries[0].task_progress is not None
    assert summaries[0].task_progress.total == 0
    assert summaries[0].task_progress.done == 0


@pytest.mark.asyncio
async def test_task_progress_no_rows_none_and_single_query(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """无 task 行 → None 降级；多变更聚合单条 IN 查询（R-03 无 N+1 断言）。"""
    _fix_cli_tz(monkeypatch)
    ws = await _make_workspace(db_session)
    changes = []
    for i in range(3):
        key = f"tp-agg-q-{i}"
        changes.append(await _make_change(db_session, ws.id, key))
        await _make_progress_row(db_session, ws.id, key, _full_stage_payload())
    await _make_task_row(db_session, changes[0].id, ws.id, "task-00", status="done")
    await db_session.commit()

    counts = {"tasks": 0}
    real_execute = db_session.execute

    async def counting_execute(*args: Any, **kwargs: Any) -> Any:
        sql = str(args[0] if args else kwargs.get("statement"))
        if "FROM tasks" in sql:
            counts["tasks"] += 1
        return await real_execute(*args, **kwargs)

    monkeypatch.setattr(db_session, "execute", counting_execute)
    summaries = await ChangeService(db_session).enrich_summaries(changes)
    monkeypatch.undo()

    # 无 task 行的变更 → None；有行的 → {total:1, done:1}
    assert summaries[0].task_progress is not None
    assert summaries[1].task_progress is None
    assert summaries[2].task_progress is None
    # tasks 表聚合恒 1 查询（批量 IN，R-03）
    assert counts["tasks"] == 1


# ── task-04：thin_flow 读侧投影（FR-03/FR-07 / D-008@v2）──────────────────────


@pytest.mark.asyncio
async def test_thin_flow_projection_passthrough(db_session: AsyncSession) -> None:
    """主路径：stages.thin_flow 在场且结构合法 → 逐字段透传。"""
    ws = await _make_workspace(db_session)
    thin_payload = {
        "phase": "executing",
        "approved": True,
        "autopilot": False,
        "tasks_total": 12,
        "tasks_done": 4,
        "substeps_done": 0,
        "substeps_total": 8,
        "upgraded": False,
        "adopted_from": None,
    }
    change = await _make_change(db_session, ws.id, "tf-proj-a", stage="thin")
    change.stages = {"thin_flow": thin_payload, "other_key": 1}
    db_session.add(change)
    await db_session.commit()

    summaries = await ChangeService(db_session).enrich_summaries([change])
    tf = summaries[0].thin_flow
    assert tf is not None
    assert tf.phase == "executing"
    assert tf.approved is True
    assert tf.tasks_done == 4
    assert tf.substeps_total == 8
    assert tf.upgraded is False


@pytest.mark.asyncio
async def test_thin_flow_projection_fail_open(db_session: AsyncSession) -> None:
    """缺键 / 坏 JSON 结构 / stages 非 dict → None 不抛（R-01 / 盲区#5）。"""
    ws = await _make_workspace(db_session)
    missing = await _make_change(db_session, ws.id, "tf-proj-b", stage="thin")
    missing.stages = {"team_worker_preset": {"workers": 2}}  # 无 thin_flow 键
    bad = await _make_change(db_session, ws.id, "tf-proj-c", stage="thin")
    bad.stages = {"thin_flow": {"phase": 123, "tasks_total": "not-int"}}  # 坏结构
    db_session.add_all([missing, bad])
    await db_session.commit()

    summaries = await ChangeService(db_session).enrich_summaries([missing, bad])
    assert summaries[0].thin_flow is None
    assert summaries[1].thin_flow is None
