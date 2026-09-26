"""变更合成时间线聚合测试（2026-09-26-change-real-timeline FR-01/04）。

覆盖：
- 金样本聚合：events 表（多 kind 正序）+ tasks.md 任务行 + requirements
  created_at 诞生锚 + git 窗口标题匹配（monkeypatch GitLogService.list_commits）
  + 任务面「消息含 task token」提交锚推断 + 脚注统计；
- 空 events 容错（无事件行 → 事件轴空、任务面仍可从 tasks.md 出）；
- git 通道降级（list_commits 抛错 → commit_title=None、聚合不炸）；
- 跨工作区/不存在 → ``ChangeNotFound``。

author: qinyi
created_at: 2026-09-26
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest

from app.core.errors import ChangeNotFound
from app.modules.change.model import Change
from app.modules.change.timeline import ChangeTimelineQueryService
from app.modules.platform_sync.model import PlatformChangeEventORM
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace

KEY = "2026-09-26-timeline-golden"


async def _make_ws(db_session, spec_root: Path) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="timeline ws",
        slug=f"timeline-{uuid.uuid4().hex[:8]}",
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


async def _make_change(db_session, ws: Workspace) -> Change:
    change = Change(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        change_key=KEY,
        title=KEY,
        status="archived",
        location="archive",
        path=f"changes/archive/{KEY}",
        current_stage="archive",
    )
    db_session.add(change)
    await db_session.commit()
    return change


def _seed_change_dir(spec_root: Path, *, with_tasks: bool = True) -> None:
    change_dir = spec_root / "changes" / "archive" / KEY
    change_dir.mkdir(parents=True)
    (change_dir / "requirements.md").write_text(
        "---\nauthor: flow-machine-draft\ncreated_at: 2026-09-26T07:00:00.000Z\n---\n# 需求\n",
        encoding="utf-8",
    )
    if with_tasks:
        (change_dir / "tasks.md").write_text(
            "- [x] task-01: 后端聚合服务落盘\n"
            "- [x] task-02: 前端组件三段渲染\n"
            "- [ ] task-03: 部署验证\n",
            encoding="utf-8",
        )


async def _add_event(
    db_session, ws_id: uuid.UUID, ts: str, kind: str, detail: str | None = None, **kw
) -> None:
    db_session.add(
        PlatformChangeEventORM(
            workspace_id=ws_id,
            change_name=KEY,
            dedup_key=f"{ts}|{kind}|{detail}",
            kind=kind,
            rule=kw.get("rule", "watcher"),
            severity=kw.get("severity", "info"),
            provisional=True,
            detail=detail,
            ts=ts,
        )
    )


async def test_timeline_golden_aggregation(db_session, tmp_path: Path, monkeypatch) -> None:
    """金样本：事件轴正序 + 诞生锚 + 任务行×提交锚推断 + 统计。"""
    spec_root = tmp_path / "spec-root"
    _seed_change_dir(spec_root)
    ws = await _make_ws(db_session, spec_root)
    change = await _make_change(db_session, ws)
    await _add_event(
        db_session, ws.id, "2026-09-26T07:01:00Z", "file-update", "requirements.md 内容变更"
    )
    await _add_event(db_session, ws.id, "2026-09-26T07:02:00Z", "task-done", "checked 0→2")
    await _add_event(
        db_session,
        ws.id,
        "2026-09-26T07:02:01Z",
        "warning",
        "fake-check 告警",
        rule="fake-check",
        severity="warning",
    )
    await _add_event(db_session, ws.id, "2026-09-26T07:03:00Z", "commit", "4aed0e824")
    await _add_event(
        db_session, ws.id, "2026-09-26T07:05:00Z", "archived", "change 目录已移入 archive"
    )
    await db_session.commit()

    # git 窗口 monkeypatch：单提交命中短哈希，message 含 task-01/task-02 token。
    # 响应用鸭子类型轻对象——服务只访问 commits[].short/hash/message，构造真
    # pydantic GitLogCommitsResponse 反而会因裸元素校验失败进降级分支。
    class _FakeCommit:
        def __init__(self, sha: str, short: str, message: str):
            self.hash, self.short, self.message = sha, short, message

    class _FakeResponse:
        def __init__(self, commits):
            self.commits = commits

    class _FakeGitLogService:
        def __init__(self, session):
            pass

        async def list_commits(
            self, workspace_id, user_id, *, skip=0, limit=100, branch="", author=""
        ):
            return _FakeResponse(
                [_FakeCommit("4aed0e824full", "4aed0e824", "feat: 落地（task-01 task-02）")]
            )

    monkeypatch.setattr("app.modules.change.timeline.GitLogService", _FakeGitLogService)

    result = await ChangeTimelineQueryService(db_session).get_change_timeline(
        ws.id, change.id, uuid.uuid4()
    )
    assert result.change_key == KEY
    assert result.born_at == "2026-09-26T07:00:00.000Z"
    assert [e.kind for e in result.events] == [
        "file-update",
        "task-done",
        "warning",
        "commit",
        "archived",
    ]
    commit_ev = result.events[3]
    assert commit_ev.commit_title == "feat: 落地（task-01 task-02）"
    # 任务面：勾选态 + 提交锚按 message 含 task token 推断（task-03 无锚）。
    assert [(t.id, t.checked) for t in result.tasks] == [
        ("task-01", True),
        ("task-02", True),
        ("task-03", False),
    ]
    assert result.tasks[0].commit_sha == "4aed0e824"
    assert result.tasks[2].commit_sha is None
    # token 边界（评审 P3 收口）：消息含 task-012 不得被 task-01 误锚。
    # 金样本 message 只含 task-01/task-02——task-01 的锚存在已证边界正确
    # （若用子串匹配，task-012 形态会误锚；此处由下方专项用例钉住）。
    # 统计：5 事件（1 commit）/ 勾选 2/3 / 墙钟 07:01→07:05 = 240s。
    assert result.stats.event_count == 5
    assert result.stats.commit_count == 1
    assert (result.stats.checked, result.stats.total) == (2, 3)
    assert result.stats.wall_clock_s == 240


async def test_timeline_empty_events_still_yields_tasks(db_session, tmp_path: Path) -> None:
    """空 events 容错：事件轴空、任务面照常出自 tasks.md、born 锚仍在。"""
    spec_root = tmp_path / "spec-root2"
    _seed_change_dir(spec_root)
    ws = await _make_ws(db_session, spec_root)
    change = await _make_change(db_session, ws)

    result = await ChangeTimelineQueryService(db_session).get_change_timeline(
        ws.id, change.id, uuid.uuid4()
    )
    assert result.events == []
    assert len(result.tasks) == 3
    assert result.born_at == "2026-09-26T07:00:00.000Z"
    assert result.stats.wall_clock_s is None


async def test_timeline_git_degraded_to_hash_only(db_session, tmp_path: Path, monkeypatch) -> None:
    """git 通道降级：list_commits 抛错 → commit_title=None、聚合不炸。"""
    spec_root = tmp_path / "spec-root3"
    _seed_change_dir(spec_root, with_tasks=False)
    ws = await _make_ws(db_session, spec_root)
    change = await _make_change(db_session, ws)
    await _add_event(db_session, ws.id, "2026-09-26T07:01:00Z", "commit", "4aed0e824")
    await db_session.commit()

    class _BoomGitLogService:
        def __init__(self, session):
            pass

        async def list_commits(self, *a, **kw):
            raise RuntimeError("daemon offline")

    monkeypatch.setattr("app.modules.change.timeline.GitLogService", _BoomGitLogService)

    result = await ChangeTimelineQueryService(db_session).get_change_timeline(
        ws.id, change.id, uuid.uuid4()
    )
    assert result.events[0].commit_title is None
    assert result.events[0].label == "4aed0e824"


async def test_timeline_not_found_reraises(db_session, tmp_path: Path) -> None:
    """不存在 → ChangeNotFound（对齐 assets 端点口径）。"""
    spec_root = tmp_path / "spec-root4"
    spec_root.mkdir()
    ws = await _make_ws(db_session, spec_root)
    with pytest.raises(ChangeNotFound):
        await ChangeTimelineQueryService(db_session).get_change_timeline(
            ws.id, uuid.uuid4(), uuid.uuid4()
        )


async def test_timeline_task_token_boundary_no_cross_match(
    db_session, tmp_path: Path, monkeypatch
) -> None:
    """token 边界：task-01 不误锚含 task-012 的消息（评审 P3 收口）。"""
    spec_root = tmp_path / "spec-root5"
    _seed_change_dir(spec_root)
    ws = await _make_ws(db_session, spec_root)
    change = await _make_change(db_session, ws)
    await _add_event(db_session, ws.id, "2026-09-26T07:01:00Z", "commit", "aaa000111")
    await db_session.commit()

    class _C:
        def __init__(self, sha, short, message):
            self.hash, self.short, self.message = sha, short, message

    class _R:
        def __init__(self, commits):
            self.commits = commits

    class _Fake:
        def __init__(self, session):
            pass

        async def list_commits(self, *a, **kw):
            return _R([_C("f" * 20, "aaa000111", "feat: 未来的 task-012 落地")])

    monkeypatch.setattr("app.modules.change.timeline.GitLogService", _Fake)

    result = await ChangeTimelineQueryService(db_session).get_change_timeline(
        ws.id, change.id, uuid.uuid4()
    )
    # task-01 未被 task-012 的消息误锚；无锚 None。
    task01 = next(t for t in result.tasks if t.id == "task-01")
    assert task01.commit_sha is None
