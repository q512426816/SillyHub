"""spec-sync 自动连动任务表重解析测试（2026-10-07-spec-sync-task-reparse）。

背景（hide-quicklog 实证）：``_run_reparse_once`` 只调 ``ChangeService.reparse``（变更表），
任务表（``TaskService``，厚档 ``tasks/task-*.md`` 任务卡面）全后端唯一刷新入口是手动
reparse 端点——spec-sync 增量落盘新任务卡后任务板停留初版解析。本变更在 reparse 执行体
里按同一 scope 连动 ``TaskService.reparse``（best-effort，失败仅告警不阻断）。

覆盖：
- 增量同步改写 ``tasks/`` 任务卡（增卡/改题）→ drain 后任务表跟随新内容
- 连动失败（monkeypatch TaskService.reparse 抛错）→ 同步主流程 200、变更表照常重建

author: qinyi
created_at: 2026-10-07
"""

from __future__ import annotations

import base64
import uuid
from pathlib import Path
from unittest.mock import AsyncMock

from httpx import AsyncClient
from sqlalchemy import select

from app.modules.change.model import Change
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.spec_workspace.service import drain_reparse_workers
from app.modules.task.model import Task
from app.modules.workspace.model import Workspace


def _b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def _op(op: str, path: str, base_version: int = 0, **extra: object) -> dict[str, object]:
    d: dict[str, object] = {"op": op, "path": path, "base_version": base_version}
    d.update(extra)
    return d


def _card(task_key: str, title: str) -> str:
    return f"---\nid: {task_key}\ntitle: '{title}'\nstatus: draft\npriority: P1\n---\n"


async def _make_workspace(db_session) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="task-reparse-on-sync ws",
        slug=f"trs-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/task-reparse-test-{uuid.uuid4().hex[:12]}",
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


async def _tasks_of(db_session, ws_id: uuid.UUID, change_id: uuid.UUID) -> list[Task]:
    stmt = select(Task).where(
        Task.workspace_id == ws_id,
        Task.change_id == change_id,
    )
    return list((await db_session.execute(stmt)).scalars().all())


async def _change_row(db_session, ws_id: uuid.UUID, key: str) -> Change | None:
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


class TestTaskReparseOnSync:
    async def test_tasks_md_rewrite_updates_task_rows(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """增量同步改写任务卡 → 任务表跟随（旧 4 卡 → 改题 + 增第 5 卡）。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        key = "2026-10-07-card-change"

        # 初版：4 张任务卡（hide-quicklog 同型——初版解析后 agent 重写）
        first_ops = []
        for i in range(1, 5):
            first_ops.append(
                _op(
                    "add",
                    f"changes/{key}/tasks/task-{i:02d}.md",
                    content=_b64(_card(f"task-{i:02d}", f"初版任务 {i}")),
                )
            )
        first_ops.append(_op("add", f"changes/{key}/proposal.md", content=_b64("# Card Change")))
        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": first_ops, "change_dirs": [key]},
        )
        assert resp.status_code == 200, resp.text
        await drain_reparse_workers()

        change = await _change_row(db_session, ws.id, key)
        assert change is not None, "变更行已建（scoped reparse）"
        # 纯量 id 即取（后续请求会 expire 会话对象，ORM 属性惰性 IO 在 greenlet 外炸）
        ws_id, change_id = ws.id, change.id
        rows = await _tasks_of(db_session, ws_id, change_id)
        assert len(rows) == 4, f"初版任务卡入任务表（实际 {len(rows)}）"

        # agent 重写：task-01 改题 + 增 task-05 → 增量同步 → 任务表跟随
        rewrite_ops = [
            _op(
                "update",
                f"changes/{key}/tasks/task-01.md",
                base_version=1,
                content=_b64(_card("task-01", "重写后的真实工作步骤")),
            ),
            _op(
                "add",
                f"changes/{key}/tasks/task-05.md",
                content=_b64(_card("task-05", "追加的第 5 步")),
            ),
        ]
        resp2 = await client.post(
            f"/api/workspaces/{ws_id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={"ops": rewrite_ops, "change_dirs": [key]},
        )
        assert resp2.status_code == 200, resp2.text
        await drain_reparse_workers()

        # 后台 reparse 用独立会话提交——刷新本会话身份映射后再断言
        db_session.expire_all()
        rows2 = await _tasks_of(db_session, ws_id, change_id)
        assert len(rows2) == 5, f"任务表跟随重写（4→5，实际 {len(rows2)}）"
        by_key = {t.task_key: t for t in rows2}
        assert by_key["task-01"].title == "重写后的真实工作步骤"
        assert by_key["task-05"].title == "追加的第 5 步"

    async def test_task_reparse_failure_does_not_block_sync(
        self, db_session, client: AsyncClient, auth_headers, tmp_path, monkeypatch
    ) -> None:
        """连动失败仅告警：TaskService.reparse 抛错 → 同步仍 200、变更表照常重建。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        key = "2026-10-07-fail-change"

        from app.modules.task.service import TaskService

        monkeypatch.setattr(
            TaskService,
            "reparse",
            AsyncMock(side_effect=RuntimeError("task reparse boom")),
        )

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={
                "ops": [
                    _op(
                        "add",
                        f"changes/{key}/proposal.md",
                        content=_b64("# Fail Change"),
                    )
                ],
                "change_dirs": [key],
            },
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["ok"] is True
        await drain_reparse_workers()

        change = await _change_row(db_session, ws.id, key)
        assert change is not None, "连动失败不阻断：变更表照常重建"

    async def test_thin_tasks_md_registry_reaches_task_board(
        self, db_session, client: AsyncClient, auth_headers, tmp_path
    ) -> None:
        """thin tasks.md 注册表行进任务板（2026-10-07-taskboard-tasks-md）：
        增量同步 tasks.md → 连动 reparse → 任务表按勾选态建行；改写跟随。"""
        ws = await _make_workspace(db_session)
        spec_root = tmp_path / "spec-root"
        await _make_spec_workspace(db_session, ws, spec_root)
        key = "2026-10-07-thin-registry"

        resp = await client.post(
            f"/api/workspaces/{ws.id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={
                "ops": [
                    _op("add", f"changes/{key}/proposal.md", content=_b64("# Thin Registry")),
                    _op(
                        "add",
                        f"changes/{key}/tasks.md",
                        content=_b64(
                            "# 任务注册表\n\n"
                            "- [x] task-01: 实现 A + 用例\n"
                            "- [ ] task-02: 全量复跑绿\n"
                        ),
                    ),
                ],
                "change_dirs": [key],
            },
        )
        assert resp.status_code == 200, resp.text
        await drain_reparse_workers()

        change = await _change_row(db_session, ws.id, key)
        assert change is not None
        ws_id, change_id = ws.id, change.id
        rows = await _tasks_of(db_session, ws_id, change_id)
        assert {t.task_key: t.status for t in rows} == {"task-01": "done", "task-02": "draft"}

        # 改写：勾 task-02 → 两行全 done
        resp2 = await client.post(
            f"/api/workspaces/{ws_id}/spec-workspace/sync-incremental",
            headers=auth_headers,
            json={
                "ops": [
                    _op(
                        "update",
                        f"changes/{key}/tasks.md",
                        base_version=1,
                        content=_b64(
                            "# 任务注册表\n\n"
                            "- [x] task-01: 实现 A + 用例\n"
                            "- [x] task-02: 全量复跑绿\n"
                        ),
                    )
                ],
                "change_dirs": [key],
            },
        )
        assert resp2.status_code == 200, resp2.text
        await drain_reparse_workers()

        db_session.expire_all()
        rows2 = await _tasks_of(db_session, ws_id, change_id)
        assert {t.task_key: t.status for t in rows2} == {
            "task-01": "done",
            "task-02": "done",
        }, "任务板跟随 tasks.md 勾选态"
