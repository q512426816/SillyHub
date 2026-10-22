"""reparse 物理删 change 时保留锚定 run / 日志 / turn_count（FR-01 回归）。

历史事故（2026-10-22 会话 bbdbecc9）：reparse 判定 change 目录消失后物理删除
``changes`` 行，``agent_runs.change_id`` 的 ``ON DELETE CASCADE`` 级联删除 13 轮
会话 run 与日志；``turn_count`` 未回退。本测试锁死两遍式删除环的行为：
删 change 前先把锚定 run 的 ``change_id`` 置 NULL，删行后 run/日志/计数原样保留。
"""

from __future__ import annotations

import shutil
import uuid
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.change.model import Change
from app.modules.change.service import ChangeService
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace


async def _make_ws(db_session) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="cascade-protection ws",
        slug=f"cascade-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/cascade-protection-{uuid.uuid4().hex[:12]}",
        status="active",
        component_key="comp",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _make_spec_ws(db_session, ws: Workspace, spec_root: Path) -> SpecWorkspace:
    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        spec_root=str(spec_root),
        strategy="platform-managed",
        sync_status="clean",
    )
    db_session.add(spec_ws)
    await db_session.commit()
    await db_session.refresh(spec_ws)
    return spec_ws


def _seed_change(spec_root: Path, key: str, title: str) -> None:
    d = spec_root / "changes" / key
    d.mkdir(parents=True, exist_ok=True)
    (d / "proposal.md").write_text(f"# {title}\n", encoding="utf-8")


async def _fetch_change(db_session, ws_id: uuid.UUID, key: str) -> Change | None:
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


async def test_reparse_physical_delete_keeps_anchored_runs(db_session, tmp_path):
    """删除磁盘消失的 change：run/日志保留，change_id 置 NULL，turn_count 不变。"""
    ws = await _make_ws(db_session)
    spec_root = tmp_path / "spec-root"
    await _make_spec_ws(db_session, ws, spec_root)
    key = "2026-10-22-cascade-gone"
    _seed_change(spec_root, key, "Gone")

    service = ChangeService(db_session)
    stats, _ = await service.reparse(ws.id)
    assert stats["created"] == 1
    change = await _fetch_change(db_session, ws.id, key)
    assert change is not None

    session = AgentSession(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        provider="claude",
        status="active",
        origin="chat",
        turn_count=2,
    )
    db_session.add(session)
    run_ids = [uuid.uuid4(), uuid.uuid4()]
    for run_id in run_ids:
        db_session.add(
            AgentRun(
                id=run_id,
                agent_type="claude_code",
                provider="claude",
                status="completed",
                agent_session_id=session.id,
                change_id=change.id,
            )
        )
        db_session.add(
            AgentRunLog(
                id=uuid.uuid4(),
                run_id=run_id,
                timestamp=datetime.now(UTC),
                channel="user_input",
                content_redacted="历史用户消息",
            )
        )
    await db_session.commit()

    # 磁盘目录消失 → scoped reparse 物理删除该 change 行
    shutil.rmtree(spec_root / "changes" / key)
    stats, _ = await service.reparse(ws.id, scope=[key])
    assert stats["deleted"] == 1
    assert await _fetch_change(db_session, ws.id, key) is None

    # run 与日志必须保留；change_id 解绑为 NULL
    runs = (
        (await db_session.execute(select(AgentRun).where(AgentRun.id.in_(run_ids)))).scalars().all()
    )
    assert len(runs) == 2
    assert all(run.change_id is None for run in runs)
    logs = (
        (await db_session.execute(select(AgentRunLog).where(AgentRunLog.run_id.in_(run_ids))))
        .scalars()
        .all()
    )
    assert len(logs) == 2

    refreshed = await db_session.get(AgentSession, session.id)
    assert refreshed is not None
    assert refreshed.turn_count == 2
