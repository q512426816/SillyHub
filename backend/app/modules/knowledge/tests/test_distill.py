"""DistillDispatchService 单测（task-07 / 2026-09-17-knowledge-precipitation）。

覆盖（卡片 verify 契约）：
1. 源校验分支：无记录会话（turn_count=0）422 / 未归档变更 422 /
   不存在的会话、变更沿既有 404 语义（DaemonSessionNotFound / ChangeNotFound）
2. 正常派发（daemon 离线环境）：AgentRun 创建 + metadata_ 四键
   （kind=knowledge-distill/source_type/source_ref/focus）+ AgentRunWorkspace
   关联；后台任务收敛为 failed/no_online_daemon 且失败态立即可查
3. 任务列表：仅 knowledge-distill 类（其它 AgentRun 不混入）、created_at 倒序
4. prompt 模板（R-05）：会话/变更两式 + focus 可选嵌入 + propose 用法固化

service 层直测（HTTP 权限/路由序用例见 test_router.py task-07 段）。
"""

from __future__ import annotations

import asyncio
import uuid
from pathlib import Path

import pytest
from sqlalchemy import select

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.auth.model import User
from app.modules.change.model import Change
from app.modules.knowledge.distill import (
    DISTILL_RUN_KIND,
    DistillDispatchService,
    DistillSourceInvalid,
    build_distill_prompt,
)
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import AgentRunWorkspace, Workspace


async def _make_distill_env(
    db_session, tmp_path: Path, auth_admin_token: str
) -> tuple[Workspace, User]:
    """建 workspace + spec_ws，返回 (workspace, 平台管理员用户)。

    依赖 ``auth_admin_token`` fixture 先建好 admin@example.com 用户（派发归属者）。
    """
    from sqlalchemy import select as _select

    ws = Workspace(
        id=uuid.uuid4(),
        name="knowledge-distill",
        slug=f"kd-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "client-machine-path"),
        status="active",
    )
    db_session.add(ws)
    db_session.add(
        SpecWorkspace(
            id=uuid.uuid4(),
            workspace_id=ws.id,
            spec_root=str(tmp_path / "distill-spec"),
            strategy="platform-managed",
            sync_status="clean",
        )
    )
    await db_session.commit()
    await db_session.refresh(ws)

    user = (
        (await db_session.execute(_select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert user is not None, "auth_admin_token fixture 应已建好平台管理员用户"
    return ws, user


async def _make_session_record(db_session, user_id: uuid.UUID, *, turn_count: int) -> uuid.UUID:
    session = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        provider="claude_code",
        status="ended",
        turn_count=turn_count,
    )
    db_session.add(session)
    await db_session.commit()
    return session.id


async def _make_change(db_session, ws_id: uuid.UUID, *, status: str) -> str:
    change = Change(
        id=uuid.uuid4(),
        workspace_id=ws_id,
        change_key="2026-09-17-demo-change",
        status=status,
        location="archive" if status == "archived" else "active",
        path="changes/archive/2026-09-17-demo-change",
    )
    db_session.add(change)
    await db_session.commit()
    return change.change_key


async def _drain_distill_tasks() -> None:
    """等全部 distill 后台任务跑完（fire-and-forget 的确定性收口）。"""
    from app.modules.knowledge.distill import _BACKGROUND_DISTILL_TASKS

    tasks = list(_BACKGROUND_DISTILL_TASKS)
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)


# ---------------------------------------------------------------------------
# 源校验分支
# ---------------------------------------------------------------------------


async def test_dispatch_session_without_records_returns_422(
    db_session, tmp_path, auth_admin_token
) -> None:
    """无记录会话（turn_count=0）→ 422，不创建 AgentRun。"""
    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    session_id = await _make_session_record(db_session, user.id, turn_count=0)

    with pytest.raises(DistillSourceInvalid) as exc_info:
        await DistillDispatchService(db_session).dispatch(
            ws.id, user, source_type="session", source_ref=str(session_id)
        )
    assert "无内容可提炼" in exc_info.value.message

    runs = (await db_session.execute(select(AgentRun))).scalars().all()
    assert runs == []


async def test_dispatch_active_change_returns_422(db_session, tmp_path, auth_admin_token) -> None:
    """未归档变更（status=active）→ 422。"""
    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    change_key = await _make_change(db_session, ws.id, status="active")

    with pytest.raises(DistillSourceInvalid) as exc_info:
        await DistillDispatchService(db_session).dispatch(
            ws.id, user, source_type="change", source_ref=change_key
        )
    assert "已归档" in exc_info.value.message


async def test_dispatch_missing_session_returns_404_semantics(
    db_session, tmp_path, auth_admin_token
) -> None:
    """不存在的会话沿 DaemonSessionNotFound（404）语义。"""
    from app.core.errors import AppError

    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)

    with pytest.raises(AppError) as exc_info:
        await DistillDispatchService(db_session).dispatch(
            ws.id, user, source_type="session", source_ref=str(uuid.uuid4())
        )
    assert exc_info.value.http_status == 404


async def test_dispatch_missing_change_returns_404_semantics(
    db_session, tmp_path, auth_admin_token
) -> None:
    """不存在的变更沿 ChangeNotFound（404）语义。"""
    from app.core.errors import AppError

    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)

    with pytest.raises(AppError) as exc_info:
        await DistillDispatchService(db_session).dispatch(
            ws.id, user, source_type="change", source_ref="2099-01-01-no-such-change"
        )
    assert exc_info.value.http_status == 404


# ---------------------------------------------------------------------------
# 派发创建 + daemon 离线立即 failed
# ---------------------------------------------------------------------------


async def test_dispatch_offline_daemon_creates_failed_run_with_metadata(
    db_session, tmp_path, auth_admin_token
) -> None:
    """离线派发：创建成功 + metadata_ 四键 + AgentRunWorkspace 关联 + 立即 failed。"""
    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    session_id = await _make_session_record(db_session, user.id, turn_count=5)

    task_read = await DistillDispatchService(db_session).dispatch(
        ws.id,
        user,
        source_type="session",
        source_ref=str(session_id),
        focus="只提取踩坑与解法",
    )
    assert task_read.status == "pending"
    assert task_read.source_type == "session"
    assert task_read.source_ref == str(session_id)

    # 等后台任务收敛（测试环境无在线 daemon → failed/no_online_daemon）。
    await _drain_distill_tasks()

    run = await db_session.get(AgentRun, task_read.agent_run_id)
    assert run is not None
    assert run.status == "failed"
    assert run.error_code == "no_online_daemon"
    assert run.exit_code == 1
    # finished_at 已落（SQLite 存 naive datetime，不做跨 tz 比较）
    assert run.finished_at is not None
    # metadata_ 四键形状
    assert run.metadata_ == {
        "kind": DISTILL_RUN_KIND,
        "source_type": "session",
        "source_ref": str(session_id),
        "focus": "只提取踩坑与解法",
    }
    # AgentRunWorkspace 关联建立
    link = (
        (
            await db_session.execute(
                select(AgentRunWorkspace).where(
                    AgentRunWorkspace.agent_run_id == run.id,
                    AgentRunWorkspace.workspace_id == ws.id,
                )
            )
        )
        .scalars()
        .first()
    )
    assert link is not None


async def test_dispatch_change_source_offline_daemon(
    db_session, tmp_path, auth_admin_token
) -> None:
    """变更源（archived）离线派发同样立即 failed。"""
    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    change_key = await _make_change(db_session, ws.id, status="archived")

    task_read = await DistillDispatchService(db_session).dispatch(
        ws.id, user, source_type="change", source_ref=change_key
    )
    await _drain_distill_tasks()

    run = await db_session.get(AgentRun, task_read.agent_run_id)
    assert run is not None
    assert run.status == "failed"
    assert run.error_code == "no_online_daemon"
    assert run.metadata_["source_type"] == "change"
    assert run.metadata_["source_ref"] == change_key
    assert run.metadata_["focus"] is None


# ---------------------------------------------------------------------------
# 任务列表过滤
# ---------------------------------------------------------------------------


async def test_list_tasks_filters_distill_kind_and_sorts_desc(
    db_session, tmp_path, auth_admin_token
) -> None:
    """列表只含 knowledge-distill 类任务（普通 AgentRun 不混入）且 created_at 倒序。"""
    from datetime import UTC, datetime, timedelta

    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    session_id = await _make_session_record(db_session, user.id, turn_count=1)
    change_key = await _make_change(db_session, ws.id, status="archived")

    service = DistillDispatchService(db_session)
    first = await service.dispatch(ws.id, user, source_type="session", source_ref=str(session_id))
    await _drain_distill_tasks()
    second = await service.dispatch(ws.id, user, source_type="change", source_ref=change_key)
    await _drain_distill_tasks()

    # 混入一个普通 AgentRun（挂同 workspace 关联、created_at 更晚，但无 distill metadata）。
    plain_run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status="completed",
        created_at=datetime.now(UTC) + timedelta(seconds=1),
    )
    db_session.add(plain_run)
    db_session.add(AgentRunWorkspace(agent_run_id=plain_run.id, workspace_id=ws.id))
    # 再混一个 metadata kind 不是 knowledge-distill 的 run。
    other_meta_run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status="pending",
        metadata_={"kind": "auto_resume", "auto_resume_of": "x"},
    )
    db_session.add(other_meta_run)
    db_session.add(AgentRunWorkspace(agent_run_id=other_meta_run.id, workspace_id=ws.id))
    await db_session.commit()

    tasks = await service.list_tasks(ws.id)
    assert [t.agent_run_id for t in tasks] == [second.agent_run_id, first.agent_run_id]
    # DistillTaskRead 字段齐全（source_* 自 metadata_ 投影，status/created_at 自 AgentRun）
    assert tasks[0].source_type == "change"
    assert tasks[0].source_ref == change_key
    assert tasks[0].status == "failed"  # 离线收敛终态
    assert tasks[0].created_at is not None


# ---------------------------------------------------------------------------
# prompt 模板（R-05 固化）
# ---------------------------------------------------------------------------


def test_build_distill_prompt_two_variants() -> None:
    """会话/变更两式 + focus 可选嵌入 + propose 命令用法固化。"""
    session_prompt = build_distill_prompt("session", "024a9fc2", "只提取踩坑")
    assert "session_id：024a9fc2" in session_prompt
    assert "只提取踩坑" in session_prompt
    assert "sillyspec knowledge propose --title" in session_prompt
    assert "--category" in session_prompt and "--body" in session_prompt

    change_prompt = build_distill_prompt("change", "2026-09-17-demo", None)
    assert "change_key：2026-09-17-demo" in change_prompt
    assert "关注点" not in change_prompt
    assert "sillyspec knowledge propose" in change_prompt
