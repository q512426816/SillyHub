"""DistillDispatchService 单测（task-07 + D-009 续接分流 + D-010 闭环增强）。

覆盖（卡片 verify 契约）：
1. 源校验分支：无记录会话（turn_count=0）422 / 未归档变更 422 / ql 文件缺失
   422（D-010②）/ session、change 多来源 422 /
   不存在的会话、变更沿既有 404 语义（DaemonSessionNotFound / ChangeNotFound）
2. fresh 派发（默认，零回归）：复用 create_session——离线环境
   NoOnlineDaemonError/DaemonRuntimeOffline 收敛为 failed/no_online_daemon
   蒸馏任务条（R-05），metadata_ 落 kind/source_type/source_ref/focus/mode
3. mode=resume（D-009）：已结束会话 reopen+inject、进行中会话仅 inject、
   provider 无 resume 能力 / 状态不可 reopen / 非会话来源 → 自动降级 fresh
   并记 degraded_reason
4. fresh 复用 create_session 完整形态（D-010③）：origin=DISTILL_SESSION_ORIGIN
   落档、runtime_id/agent_type/agent_profile_id/model 透传
5. 蒸馏会话隔离（D-010④）：list_agent_sessions 默认排除 origin=k-distill，
   存量 chat 行零回归，exclude_origin=None 显式不过滤
6. 任务列表：仅 knowledge-distill 类、created_at 倒序、DistillTaskRead 新字段
   （mode/agent_session_id/merged_to/degraded_reason）投影
7. prompt 模板（R-05）：会话/变更/快速修复三式 + resume 式 + focus 嵌入

service 层直测（HTTP 权限/路由序用例见 test_router.py task-07 段）。
"""

from __future__ import annotations

import uuid
from pathlib import Path

import pytest
from sqlalchemy import select

from app.modules.agent.model import AgentRun, AgentSession
from app.modules.auth.model import User
from app.modules.change.model import Change
from app.modules.daemon.schema import DISTILL_SESSION_ORIGIN, SessionReopenResponse
from app.modules.daemon.session.service import SessionService
from app.modules.daemon.session.service.results import SessionDispatchResult
from app.modules.knowledge import distill as distill_module
from app.modules.knowledge.distill import (
    DEGRADE_NOT_SESSION,
    DEGRADE_PROVIDER_NO_RESUME,
    DEGRADE_STATUS_NOT_REOPENABLE,
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
    ws = Workspace(
        id=uuid.uuid4(),
        name="knowledge-distill",
        slug=f"kd-{uuid.uuid4().hex[:8]}",
        root_path=str(tmp_path / "client-machine-path"),
        status="active",
    )
    db_session.add(ws)
    spec_root = tmp_path / "distill-spec"
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
    await db_session.refresh(ws)

    user = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert user is not None, "auth_admin_token fixture 应已建好平台管理员用户"
    return ws, user


async def _make_session_record(
    db_session,
    user_id: uuid.UUID,
    *,
    turn_count: int,
    status: str = "ended",
    provider: str = "claude",
) -> AgentSession:
    session = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        provider=provider,
        status=status,
        turn_count=turn_count,
    )
    db_session.add(session)
    await db_session.commit()
    return session


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


def _make_run(db_session, *, metadata_: dict | None = None, status: str = "pending") -> AgentRun:
    run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        provider="claude",
        status=status,
        metadata_=metadata_,
    )
    db_session.add(run)
    return run


# ---------------------------------------------------------------------------
# 源校验分支
# ---------------------------------------------------------------------------


async def test_dispatch_session_without_records_returns_422(
    db_session, tmp_path, auth_admin_token
) -> None:
    """无记录会话（turn_count=0）→ 422，不创建 AgentRun。"""
    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    session = await _make_session_record(db_session, user.id, turn_count=0)

    with pytest.raises(DistillSourceInvalid) as exc_info:
        await DistillDispatchService(db_session).dispatch(
            ws.id, user, source_type="session", source_ref=str(session.id)
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


async def test_dispatch_quick_missing_file_returns_422(
    db_session, tmp_path, auth_admin_token
) -> None:
    """ql 文件缺失（D-010②）→ 422；多条时任一缺失即 422。"""
    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    spec_root = tmp_path / "distill-spec"
    (spec_root / "quicklog").mkdir(parents=True)
    (spec_root / "quicklog" / "ql-20260917-001-demo.md").write_text("# ql\n", encoding="utf-8")

    service = DistillDispatchService(db_session)
    with pytest.raises(DistillSourceInvalid) as exc_info:
        await service.dispatch(
            ws.id,
            user,
            source_type="quick",
            source_ref=["ql-20260917-001-demo", "ql-20260917-002-absent"],
        )
    assert "ql-20260917-002-absent" in exc_info.value.message

    with pytest.raises(DistillSourceInvalid) as exc_info2:
        await service.dispatch(
            ws.id, user, source_type="quick", source_ref="ql-20260917-099-no-such"
        )
    assert "不存在" in exc_info2.value.message


async def test_dispatch_session_multi_ref_returns_422(
    db_session, tmp_path, auth_admin_token
) -> None:
    """会话/变更来源仅支持单条；多来源仅 quick 合法（D-010②）。"""
    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    session = await _make_session_record(db_session, user.id, turn_count=1)
    change_key = await _make_change(db_session, ws.id, status="archived")

    service = DistillDispatchService(db_session)
    with pytest.raises(DistillSourceInvalid):
        await service.dispatch(
            ws.id, user, source_type="session", source_ref=[str(session.id), str(uuid.uuid4())]
        )
    with pytest.raises(DistillSourceInvalid):
        await service.dispatch(
            ws.id, user, source_type="change", source_ref=[change_key, "another-change"]
        )


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
# fresh 派发（默认）+ daemon 离线立即 failed
# ---------------------------------------------------------------------------


async def test_dispatch_fresh_offline_daemon_creates_failed_run_with_metadata(
    db_session, tmp_path, auth_admin_token, monkeypatch
) -> None:
    """fresh 默认路径：create_session 离线（NoOnlineDaemonError）→ 补建
    failed/no_online_daemon 蒸馏任务条（R-05），metadata_ 六键齐全。"""
    from app.modules.agent.placement import NoOnlineDaemonError

    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    session = await _make_session_record(db_session, user.id, turn_count=5)

    async def _fake_create_session(*args, **kwargs):
        raise NoOnlineDaemonError(user_id=uuid.uuid4())

    monkeypatch.setattr(distill_module, "_create_session", _fake_create_session)

    task_read = await DistillDispatchService(db_session).dispatch(
        ws.id,
        user,
        source_type="session",
        source_ref=str(session.id),
        focus="只提取踩坑与解法",
    )
    assert task_read.status == "failed"
    assert task_read.source_type == "session"
    assert task_read.source_ref == str(session.id)
    assert task_read.mode == "fresh"
    assert task_read.agent_session_id is None
    assert task_read.merged_to is None
    assert task_read.degraded_reason is None

    run = await db_session.get(AgentRun, task_read.agent_run_id)
    assert run is not None
    assert run.status == "failed"
    assert run.error_code == "no_online_daemon"
    assert run.exit_code == 1
    assert run.finished_at is not None
    # metadata_ 五键形状（kind/source_type/source_ref/focus/mode）
    assert run.metadata_ == {
        "kind": DISTILL_RUN_KIND,
        "source_type": "session",
        "source_ref": str(session.id),
        "focus": "只提取踩坑与解法",
        "mode": "fresh",
    }
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


async def test_dispatch_quick_source_multi_select_offline_daemon(
    db_session, tmp_path, auth_admin_token, monkeypatch
) -> None:
    """quick 多选（D-010②）：source_ref 以 list 落 metadata_，DistillTaskRead
    以逗号连接投影；离线同样立即 failed。"""
    from app.modules.agent.placement import NoOnlineDaemonError

    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    spec_root = tmp_path / "distill-spec"
    (spec_root / "quicklog").mkdir(parents=True)
    (spec_root / "quicklog" / "ql-20260917-001-demo.md").write_text("# ql1\n", encoding="utf-8")
    (spec_root / "quicklog" / "ql-20260917-002-demo.md").write_text("# ql2\n", encoding="utf-8")

    async def _fake_create_session(*args, **kwargs):
        raise NoOnlineDaemonError(user_id=uuid.uuid4())

    monkeypatch.setattr(distill_module, "_create_session", _fake_create_session)

    task_read = await DistillDispatchService(db_session).dispatch(
        ws.id,
        user,
        source_type="quick",
        source_ref=["ql-20260917-001-demo", "ql-20260917-002-demo"],
    )
    assert task_read.status == "failed"
    assert task_read.source_type == "quick"
    assert task_read.source_ref == "ql-20260917-001-demo,ql-20260917-002-demo"

    run = await db_session.get(AgentRun, task_read.agent_run_id)
    assert run.metadata_["source_ref"] == ["ql-20260917-001-demo", "ql-20260917-002-demo"]
    assert run.metadata_["focus"] is None


async def test_dispatch_fresh_create_session_full_shape(
    db_session, tmp_path, auth_admin_token, monkeypatch
) -> None:
    """fresh 复用 create_session 完整形态（D-010③）：origin/runtime_id/provider/
    agent_profile_id/model 全透传，prompt 首行带「提炼」前缀。"""
    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    change_key = await _make_change(db_session, ws.id, status="archived")
    captured: dict = {}

    async def _fake_create_session(svc, user_id, **kwargs):
        captured.update(kwargs)
        agent_session = AgentSession(
            id=uuid.uuid4(),
            user_id=user_id,
            provider=kwargs.get("provider") or "claude",
            status="active",
            turn_count=1,
            origin=kwargs.get("origin") or "chat",
        )
        db_session.add(agent_session)
        run = _make_run(db_session)
        await db_session.commit()
        return SessionDispatchResult(
            agent_session=agent_session, agent_run=run, lease_id=uuid.uuid4()
        )

    monkeypatch.setattr(distill_module, "_create_session", _fake_create_session)

    task_read = await DistillDispatchService(db_session).dispatch(
        ws.id,
        user,
        source_type="change",
        source_ref=change_key,
        runtime_id=str(uuid.uuid4()),
        agent_type="codex",
        agent_profile_id=str(uuid.uuid4()),
        model="gpt-5",
    )

    # create_session 完整形态透传
    assert captured["origin"] == DISTILL_SESSION_ORIGIN
    assert captured["provider"] == "codex"
    assert captured["model"] == "gpt-5"
    assert captured["runtime_id"] is not None
    assert captured["agent_profile_id"] is not None
    assert captured["workspace_id"] == ws.id
    assert captured["prompt"].startswith("【提炼】")
    assert "change_key：2026-09-17-demo-change" in captured["prompt"]

    # 任务条落档：真实 run 复用 + metadata_ 合并 + 关联建立
    assert task_read.mode == "fresh"
    assert task_read.agent_session_id is not None
    run = await db_session.get(AgentRun, task_read.agent_run_id)
    assert run.metadata_["kind"] == DISTILL_RUN_KIND
    assert run.metadata_["source_type"] == "change"
    assert run.metadata_["agent_session_id"] == str(task_read.agent_session_id)
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


# ---------------------------------------------------------------------------
# mode=resume（D-009）：reopen+inject / 降级守卫
# ---------------------------------------------------------------------------


async def test_dispatch_resume_ended_session_reopens_then_injects(
    db_session, tmp_path, auth_admin_token, monkeypatch
) -> None:
    """已结束会话续接：reopen_session 后 inject_session（prompt=提炼指令）。"""
    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    session = await _make_session_record(db_session, user.id, turn_count=5, status="ended")
    calls: dict[str, object] = {}

    async def _fake_reopen(self, session_id, user_id):
        calls["reopen"] = (session_id, user_id)
        return SessionReopenResponse(session_id=str(session_id), status="reconnecting")

    async def _fake_inject(self, session_id, user_id, *, prompt, **kwargs):
        calls["inject"] = (session_id, prompt)
        run = _make_run(db_session)
        await db_session.commit()
        return SessionDispatchResult(agent_session=session, agent_run=run, lease_id=uuid.uuid4())

    monkeypatch.setattr(SessionService, "reopen_session", _fake_reopen)
    monkeypatch.setattr(SessionService, "inject_session", _fake_inject)

    task_read = await DistillDispatchService(db_session).dispatch(
        ws.id,
        user,
        source_type="session",
        source_ref=str(session.id),
        mode="resume",
        focus="只提取踩坑",
    )

    assert calls["reopen"] == (session.id, user.id)
    assert calls["inject"][0] == session.id
    prompt = calls["inject"][1]
    assert "本会话本身的完整对话记录" in prompt  # resume 式 prompt（D-009）
    assert "只提取踩坑" in prompt

    assert task_read.mode == "resume"
    assert task_read.agent_session_id == session.id
    assert task_read.degraded_reason is None
    run = await db_session.get(AgentRun, task_read.agent_run_id)
    assert run.metadata_["mode"] == "resume"
    assert run.metadata_["agent_session_id"] == str(session.id)


async def test_dispatch_resume_active_session_injects_without_reopen(
    db_session, tmp_path, auth_admin_token, monkeypatch
) -> None:
    """进行中会话：跳过 reopen 直接 inject（D-009 降级守卫正面分支）。"""
    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    session = await _make_session_record(db_session, user.id, turn_count=3, status="active")
    calls: dict[str, object] = {}

    async def _fake_reopen(self, session_id, user_id):
        pytest.fail("进行中会话不应调用 reopen_session")

    async def _fake_inject(self, session_id, user_id, *, prompt, **kwargs):
        calls["inject"] = session_id
        run = _make_run(db_session)
        await db_session.commit()
        return SessionDispatchResult(agent_session=session, agent_run=run, lease_id=uuid.uuid4())

    monkeypatch.setattr(SessionService, "reopen_session", _fake_reopen)
    monkeypatch.setattr(SessionService, "inject_session", _fake_inject)

    task_read = await DistillDispatchService(db_session).dispatch(
        ws.id, user, source_type="session", source_ref=str(session.id), mode="resume"
    )

    assert calls["inject"] == session.id
    assert task_read.mode == "resume"
    assert task_read.agent_session_id == session.id


@pytest.mark.parametrize(
    ("provider", "status", "expected_reason"),
    [
        ("weird_engine", "ended", DEGRADE_PROVIDER_NO_RESUME),
        ("claude", "suspended", DEGRADE_STATUS_NOT_REOPENABLE),
    ],
)
async def test_dispatch_resume_degrades_to_fresh_with_reason(
    db_session, tmp_path, auth_admin_token, monkeypatch, provider, status, expected_reason
) -> None:
    """降级守卫：provider 无 resume 能力 / 状态不可 reopen → 自动降级 fresh
    并在任务条记 degraded_reason（D-009）。"""
    from app.modules.agent.placement import NoOnlineDaemonError

    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    session = await _make_session_record(
        db_session, user.id, turn_count=5, status=status, provider=provider
    )

    async def _fake_create_session(*args, **kwargs):
        raise NoOnlineDaemonError(user_id=uuid.uuid4())

    monkeypatch.setattr(distill_module, "_create_session", _fake_create_session)

    task_read = await DistillDispatchService(db_session).dispatch(
        ws.id, user, source_type="session", source_ref=str(session.id), mode="resume"
    )
    assert task_read.mode == "fresh"
    assert task_read.degraded_reason == expected_reason
    run = await db_session.get(AgentRun, task_read.agent_run_id)
    assert run.metadata_["mode"] == "fresh"
    assert run.metadata_["degraded_reason"] == expected_reason


async def test_dispatch_resume_non_session_source_degrades_to_fresh(
    db_session, tmp_path, auth_admin_token, monkeypatch
) -> None:
    """mode=resume 仅会话源合法：change/quick 强制 fresh 并记降级原因。"""
    from app.modules.agent.placement import NoOnlineDaemonError

    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    change_key = await _make_change(db_session, ws.id, status="archived")

    async def _fake_create_session(*args, **kwargs):
        raise NoOnlineDaemonError(user_id=uuid.uuid4())

    monkeypatch.setattr(distill_module, "_create_session", _fake_create_session)

    task_read = await DistillDispatchService(db_session).dispatch(
        ws.id, user, source_type="change", source_ref=change_key, mode="resume"
    )
    assert task_read.mode == "fresh"
    assert task_read.degraded_reason == DEGRADE_NOT_SESSION


# ---------------------------------------------------------------------------
# 蒸馏会话隔离（D-010④）：list_agent_sessions origin 排除
# ---------------------------------------------------------------------------


async def test_list_agent_sessions_excludes_distill_sessions_by_default(
    db_session, tmp_path, auth_admin_token
) -> None:
    """常规会话列表默认排除 origin=k-distill；存量 chat 行零回归；
    exclude_origin=None 显式不过滤（admin debug）。"""
    _ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    chat_session = await _make_session_record(db_session, user.id, turn_count=1)
    distill_session = AgentSession(
        id=uuid.uuid4(),
        user_id=user.id,
        provider="claude",
        status="active",
        turn_count=1,
        origin=DISTILL_SESSION_ORIGIN,
    )
    db_session.add(distill_session)
    await db_session.commit()

    svc = SessionService(db_session)
    items, total = await svc.list_agent_sessions(user.id, limit=50, offset=0)
    assert total == 1
    assert [s.id for s in items] == [chat_session.id]

    # 显式不过滤（None）→ 蒸馏会话也可见。exclude_origin 为 read_model 层
    # 参数（SessionService 类壳签名 task-08 冻结，不经包装器透传）。
    from app.modules.daemon.session.service import read_model as session_read_model

    items_all, total_all = await session_read_model.list_agent_sessions(
        svc, user.id, limit=50, offset=0, exclude_origin=None
    )
    assert total_all == 2
    assert {s.id for s in items_all} == {chat_session.id, distill_session.id}


# ---------------------------------------------------------------------------
# 任务列表过滤
# ---------------------------------------------------------------------------


async def test_list_tasks_filters_distill_kind_and_sorts_desc(
    db_session, tmp_path, auth_admin_token, monkeypatch
) -> None:
    """列表只含 knowledge-distill 类任务（普通 AgentRun 不混入）且 created_at 倒序。"""
    from datetime import UTC, datetime, timedelta

    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    session = await _make_session_record(db_session, user.id, turn_count=1)
    change_key = await _make_change(db_session, ws.id, status="archived")

    async def _fake_create_session(svc, user_id, **kwargs):
        agent_session = AgentSession(
            id=uuid.uuid4(), user_id=user_id, provider="claude", status="active", turn_count=1
        )
        db_session.add(agent_session)
        run = _make_run(db_session)
        await db_session.commit()
        return SessionDispatchResult(agent_session=agent_session, agent_run=run)

    monkeypatch.setattr(distill_module, "_create_session", _fake_create_session)

    service = DistillDispatchService(db_session)
    first = await service.dispatch(ws.id, user, source_type="session", source_ref=str(session.id))
    second = await service.dispatch(ws.id, user, source_type="change", source_ref=change_key)

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
    assert tasks[0].source_type == "change"
    assert tasks[0].source_ref == change_key
    assert tasks[0].status == "pending"
    assert tasks[0].mode == "fresh"
    assert tasks[0].agent_session_id is not None
    assert tasks[0].created_at is not None


# ---------------------------------------------------------------------------
# prompt 模板（R-05 固化 + D-009 resume 式 + D-010② quick 式）
# ---------------------------------------------------------------------------


def test_build_distill_prompt_three_variants() -> None:
    """会话/变更/快速修复三式 + focus 可选嵌入 + propose 命令用法固化。"""
    session_prompt = build_distill_prompt("session", "024a9fc2", "只提取踩坑")
    assert "session_id：024a9fc2" in session_prompt
    assert "只提取踩坑" in session_prompt
    assert "sillyspec knowledge propose --title" in session_prompt
    assert "--category" in session_prompt and "--body" in session_prompt

    change_prompt = build_distill_prompt("change", "2026-09-17-demo", None)
    assert "change_key：2026-09-17-demo" in change_prompt
    assert "关注点" not in change_prompt
    assert "sillyspec knowledge propose" in change_prompt

    quick_prompt = build_distill_prompt("quick", ["ql-20260917-001-a", "ql-20260917-002-b"], None)
    assert ".sillyspec/quicklog/ql-20260917-001-a.md" in quick_prompt
    assert ".sillyspec/quicklog/ql-20260917-002-b.md" in quick_prompt
    assert "共 2 条" in quick_prompt
    assert "sillyspec knowledge propose" in quick_prompt


def test_build_distill_prompt_resume_variant() -> None:
    """resume 式（D-009）：来源改写为本会话自身上下文（化解 R-08 洞一）。"""
    resume_prompt = build_distill_prompt("session", "024a9fc2", None, for_resume=True)
    assert "本会话本身的完整对话记录" in resume_prompt
    assert "session_id" not in resume_prompt
