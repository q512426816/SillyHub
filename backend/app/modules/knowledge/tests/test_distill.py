"""DistillDispatchService 单测（task-07 + D-009 续接分流 + D-010 闭环增强 +
D-008 取数通道/回流指引/体量护栏）。

覆盖（卡片 verify 契约）：
1. 源校验分支：无记录会话（turn_count=0）422 / 未归档变更 422 / quick 源按
   条目校验（QUICKLOG-*.md 中无该 ``## <ql-id>`` 节 → 422，quick-2dba0118）/
   session、change 多来源 422 /
   不存在的会话、变更沿既有 404 语义（DaemonSessionNotFound / ChangeNotFound）
2. fresh 派发（默认）：复用 create_session——离线环境
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
8. D-008：fresh 会话源导出附件取数通道（attachment_ids 透传 + prompt 指读
   附件文件）；导出渲染（轮分节/噪声排除/单条截断/行数保最早）；体量护栏
   （turn 预检 422 / 导出字节超限 422 / 非多模态引擎 422）；prompt 的
   --spec-dir 回流指引（洞二）

service 层直测（HTTP 权限/路由序用例见 test_router.py task-07 段）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.auth.model import User
from app.modules.change.model import Change
from app.modules.daemon.schema import DISTILL_SESSION_ORIGIN, SessionReopenResponse
from app.modules.daemon.session.service import SessionService
from app.modules.daemon.session.service.errors import DaemonSessionNotActive
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


def _fake_distill_attachment(source_session_id: uuid.UUID) -> SimpleNamespace:
    """上传 patch 的假附件（duck-type id/name——dispatch 只取这两属性）。"""
    return SimpleNamespace(id=uuid.uuid4(), name=f"distill-source-{str(source_session_id)[:8]}.md")


def _patch_upload(monkeypatch, uploaded: dict | None = None) -> None:
    """把 _upload_distill_source 换成假上传（单测无 MinIO；记录入参供断言）。"""

    async def _fake_upload(db, user_id, source_session_id, data):
        if uploaded is not None:
            uploaded["user_id"] = user_id
            uploaded["source_session_id"] = source_session_id
            uploaded["data"] = data
        return _fake_distill_attachment(source_session_id)

    monkeypatch.setattr(distill_module, "_upload_distill_source", _fake_upload)


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


async def _seed_session_logs(
    db_session,
    agent_session_id: uuid.UUID,
    turns: list[list[tuple[str, str]]],
    *,
    base_time: datetime | None = None,
) -> None:
    """按轮播种会话日志：turns[i] = 第 i 轮 (channel, content) 列表（每轮一个 run）。

    started_at / 逐条 timestamp 递增，保证导出的跨 run 时序确定（锚排序可复现）。
    """
    base = base_time or datetime(2026, 9, 17, 12, 0, 0, tzinfo=UTC)
    for turn_index, messages in enumerate(turns):
        run = AgentRun(
            id=uuid.uuid4(),
            agent_session_id=agent_session_id,
            agent_type="claude_code",
            provider="claude",
            status="completed",
            model="test-model",
            started_at=base + timedelta(minutes=turn_index),
        )
        db_session.add(run)
        for seq, (channel, content) in enumerate(messages):
            db_session.add(
                AgentRunLog(
                    run_id=run.id,
                    channel=channel,
                    content_redacted=content,
                    timestamp=base + timedelta(minutes=turn_index, seconds=seq),
                )
            )
    await db_session.commit()


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


async def test_dispatch_quick_missing_entry_returns_422(
    db_session, tmp_path, auth_admin_token
) -> None:
    """quick 源按**条目**校验（quick-2dba0118）：ref 不在 QUICKLOG-*.md 的
    ``## <ql-id>`` 节集合 → 422；多条时任一缺失即 422。"""
    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    spec_root = tmp_path / "distill-spec"
    quicklog_dir = spec_root / "quicklog"
    quicklog_dir.mkdir(parents=True)
    (quicklog_dir / "QUICKLOG-demo.md").write_text(
        "## ql-20260917-001-demo | 2026-09-17 08:00:00 | 第一修\n状态：已完成\n",
        encoding="utf-8",
    )

    service = DistillDispatchService(db_session)
    with pytest.raises(DistillSourceInvalid) as exc_info:
        await service.dispatch(
            ws.id,
            user,
            source_type="quick",
            source_ref=["ql-20260917-001-demo", "ql-20260917-002-absent"],
        )
    assert "ql-20260917-002-absent" in exc_info.value.message
    assert "QUICKLOG 中无此条目" in exc_info.value.message

    with pytest.raises(DistillSourceInvalid) as exc_info2:
        await service.dispatch(
            ws.id, user, source_type="quick", source_ref="ql-20260917-099-no-such"
        )
    assert "QUICKLOG 中无此条目" in exc_info2.value.message


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
    failed/no_online_daemon 蒸馏任务条（R-05），metadata_ 六键齐全。
    D-008：fresh 会话源先走导出+附件上传（patch 假上传，单测无 MinIO）。"""
    from app.modules.agent.placement import NoOnlineDaemonError

    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    session = await _make_session_record(db_session, user.id, turn_count=5)
    _patch_upload(monkeypatch)

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
    以逗号连接投影；离线同样立即 failed。quick-2dba0118：quicklog 单文件
    多条目，两 ref 同在 QUICKLOG-demo.md 的两个 ``##`` 节里。"""
    from app.modules.agent.placement import NoOnlineDaemonError

    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    spec_root = tmp_path / "distill-spec"
    quicklog_dir = spec_root / "quicklog"
    quicklog_dir.mkdir(parents=True)
    (quicklog_dir / "QUICKLOG-demo.md").write_text(
        "## ql-20260917-001-demo | 2026-09-17 08:00:00 | 第一修\n状态：已完成\n"
        "\n## ql-20260917-002-demo | 2026-09-17 09:00:00 | 第二修\n状态：已完成\n",
        encoding="utf-8",
    )

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
        llm_provider_id=uuid.UUID("5f0c9fc2-1111-4222-8333-444455556666"),
    )

    # create_session 完整形态透传
    assert captured["origin"] == DISTILL_SESSION_ORIGIN
    assert captured["provider"] == "codex"
    assert captured["model"] == "gpt-5"
    assert captured["runtime_id"] is not None
    assert captured["agent_profile_id"] is not None
    # quick-2dba0118：llm_provider_id 透传（UUID 入参转 create_session 的 str 形参；
    # 此前漏传 → 显式选供应商的蒸馏会话静默回落本机默认）。
    assert captured["llm_provider_id"] == "5f0c9fc2-1111-4222-8333-444455556666"
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
    # ql-20260918-006（mypy 债）：dict[str, object] 取值先 isinstance 收窄再索引
    inject_call = calls["inject"]
    assert isinstance(inject_call, tuple)
    assert inject_call[0] == session.id
    prompt = inject_call[1]
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
    并在任务条记 degraded_reason（D-009）。降级后走 fresh 会话源导出链
    （D-008：patch 假上传）。"""
    from app.modules.agent.placement import NoOnlineDaemonError

    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    session = await _make_session_record(
        db_session, user.id, turn_count=5, status=status, provider=provider
    )
    _patch_upload(monkeypatch)

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
    _patch_upload(monkeypatch)

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
    """会话/变更/快速修复三式 + focus 可选嵌入 + propose 命令用法固化。

    D-008：fresh 会话式必须指读导出附件（不再指裸 session_id 读取通道——
    DB 指针 agent 不可读）；change/quick 式带 spec_dir 时来源路径指平台同步树。"""
    session_prompt = build_distill_prompt(
        "session", "024a9fc2", "只提取踩坑", export_name="distill-source-024a9fc2.md"
    )
    assert "distill-source-024a9fc2.md" in session_prompt
    assert "attachments/" in session_prompt
    assert "session_id：024a9fc2" in session_prompt  # 仅背景参考保留
    assert "只提取踩坑" in session_prompt
    assert "sillyspec knowledge propose --title" in session_prompt
    assert "--category" in session_prompt and "--body" in session_prompt

    change_prompt = build_distill_prompt(
        "change", "2026-09-17-demo", None, spec_dir="~/.sillyhub/daemon/specs/ws-1"
    )
    assert "change_key：2026-09-17-demo" in change_prompt
    assert "~/.sillyhub/daemon/specs/ws-1/changes/archive/2026-09-17-demo/" in change_prompt
    assert "关注点" not in change_prompt
    assert "sillyspec knowledge propose" in change_prompt

    quick_prompt = build_distill_prompt(
        "quick",
        ["ql-20260917-001-a", "ql-20260917-002-b"],
        None,
        spec_dir="~/.sillyhub/daemon/specs/ws-1",
    )
    # quick-2dba0118：条目级指引——不再指 `<ql>.md` 独立文件（实际不存在），
    # 改指 quicklog/QUICKLOG-*.md 内的 `## <ql-id>` 节（grep 定位到下一个 ## 前）。
    assert "~/.sillyhub/daemon/specs/ws-1/quicklog/" in quick_prompt
    assert "QUICKLOG-*.md" in quick_prompt
    assert "`ql-20260917-001-a`" in quick_prompt
    assert "`ql-20260917-002-b`" in quick_prompt
    assert "grep" in quick_prompt
    assert "下一个 `## `" in quick_prompt
    assert "ql-20260917-001-a.md" not in quick_prompt
    assert "共 2 条" in quick_prompt
    assert "sillyspec knowledge propose" in quick_prompt

    # 无 spec_dir 的旧形（直调兼容）：quick 路径回落 cwd 相对 .sillyspec。
    quick_legacy = build_distill_prompt("quick", ["ql-20260917-001-a"], None)
    assert ".sillyspec/quicklog/" in quick_legacy
    assert "QUICKLOG-*.md" in quick_legacy


def test_build_distill_prompt_session_fresh_requires_export_name() -> None:
    """fresh 会话式缺 export_name → ValueError（防回归裸 session_id 断链 prompt）。"""
    with pytest.raises(ValueError, match="export_name"):
        build_distill_prompt("session", "024a9fc2", None)


def test_build_distill_prompt_spec_dir_propose_guidance() -> None:
    """洞二回流指引：全来源（含 resume 式）propose 命令带 --spec-dir 平台同步树。"""
    spec_dir = "~/.sillyhub/daemon/specs/ws-1"
    fresh_session = build_distill_prompt(
        "session", "sid-1", None, export_name="distill-source-sid-1.md", spec_dir=spec_dir
    )
    resume_session = build_distill_prompt(
        "session", "sid-1", None, for_resume=True, spec_dir=spec_dir
    )
    change = build_distill_prompt("change", "key-1", None, spec_dir=spec_dir)
    quick = build_distill_prompt("quick", "ql-a", None, spec_dir=spec_dir)
    for label, prompt in (
        ("fresh_session", fresh_session),
        ("resume_session", resume_session),
        ("change", change),
        ("quick", quick),
    ):
        assert f"--spec-dir {spec_dir}" in prompt, label
        assert "上行回流" in prompt, label
    # 无 spec_dir 旧形不带该参数（零回归直调路径）。
    legacy = build_distill_prompt("change", "key-1", None)
    assert "--spec-dir" not in legacy


def test_build_distill_prompt_resume_variant() -> None:
    """resume 式（D-009）：来源改写为本会话自身上下文（化解 R-08 洞一）。"""
    resume_prompt = build_distill_prompt("session", "024a9fc2", None, for_resume=True)
    assert "本会话本身的完整对话记录" in resume_prompt
    assert "session_id" not in resume_prompt


# ---------------------------------------------------------------------------
# D-008 洞一：导出渲染 + 附件取数通道 / 洞三：体量护栏
# ---------------------------------------------------------------------------


async def test_export_session_transcript_renders_turns_noise_and_clip(
    db_session, tmp_path, auth_admin_token
) -> None:
    """导出渲染：run 分轮 + 用户/助手正文 + 噪声排除（与导出档同源）+ 单条 8KB 截断。"""
    _ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    session = await _make_session_record(db_session, user.id, turn_count=2)
    # 超长单条：逐行可区分（首尾行不同），断言截断保留头部、丢弃尾部。
    long_body = "\n".join(
        f"行{i}：" + "坑" * 80
        for i in range(distill_module.DISTILL_EXPORT_MESSAGE_CHARS // 60 + 20)
    )
    await _seed_session_logs(
        db_session,
        session.id,
        [
            [
                ("user_input", "帮我修登录超时的问题"),
                ("stdout", "[TOOL_USE] Bash(cd /tmp)"),  # 噪声：工具双发文本行
                ("stdout", "[ASSISTANT] 已定位：刷新请求缺超时"),
                ("stderr", "some noise"),  # 非 chat channel 不进正文
            ],
            [
                ("user_input", "继续"),
                ("stdout", f"[ASSISTANT] {long_body}"),  # 超长单条 → 截断
            ],
        ],
    )

    markdown, total_rows = await distill_module._export_session_transcript(db_session, session.id)
    assert total_rows == 6
    assert "## 第 1 轮" in markdown and "## 第 2 轮" in markdown
    assert "帮我修登录超时的问题" in markdown
    assert "已定位：刷新请求缺超时" in markdown
    assert "刷新请求缺超时" in markdown
    # 噪声排除：TOOL_USE 文本行 / stderr / [ASSISTANT] 发言方前缀都不出现。
    assert "[TOOL_USE]" not in markdown
    assert "some noise" not in markdown
    assert "[ASSISTANT]" not in markdown
    # 单条截断标注（洞三）：保留截断头部、丢弃尾部、标注原文长度。
    assert "已截断" in markdown
    assert "行0：" in markdown
    assert f"行{len(long_body.splitlines()) - 1}：" not in markdown
    # 头部含来源会话与收录口径说明。
    assert str(session.id) in markdown
    assert "知识蒸馏源" in markdown


async def test_export_session_transcript_row_limit_keeps_earliest(
    db_session, tmp_path, auth_admin_token, monkeypatch
) -> None:
    """洞三行数护栏：超上限保最早 + 尾注丢弃行数（阈值缩到 3 便测）。"""
    _ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    session = await _make_session_record(db_session, user.id, turn_count=2)
    await _seed_session_logs(
        db_session,
        session.id,
        [
            [("user_input", "第一条-最早"), ("stdout", "[ASSISTANT] 第二条")],
            [
                ("user_input", "第三条"),
                ("user_input", "第四条-被丢弃"),
                ("user_input", "第五条-被丢弃"),
            ],
        ],
    )
    monkeypatch.setattr(distill_module, "DISTILL_EXPORT_ROW_LIMIT", 3)

    markdown, total_rows = await distill_module._export_session_transcript(db_session, session.id)
    assert total_rows == 5
    assert "第一条-最早" in markdown
    assert "第三条" in markdown
    assert "第四条-被丢弃" not in markdown
    assert "第五条-被丢弃" not in markdown
    assert "已保留最早" in markdown and "丢弃 2 行" in markdown


async def test_dispatch_fresh_session_exports_and_attaches_transcript(
    db_session, tmp_path, auth_admin_token, monkeypatch
) -> None:
    """洞一取数通道端到端（逻辑级）：导出 → 假上传 → create_session 带
    attachment_ids；prompt 指读附件文件 + propose 带 --spec-dir（洞二）。"""
    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    session = await _make_session_record(db_session, user.id, turn_count=1)
    await _seed_session_logs(
        db_session,
        session.id,
        [[("user_input", "帮我修登录超时的问题"), ("stdout", "[ASSISTANT] 修好了")]],
    )
    uploaded: dict = {}
    _patch_upload(monkeypatch, uploaded)
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
        ws.id, user, source_type="session", source_ref=str(session.id)
    )
    assert task_read.mode == "fresh"

    # 上传的是来源会话的导出 Markdown（含对话正文）。
    assert uploaded["source_session_id"] == session.id
    transcript = uploaded["data"].decode("utf-8")
    assert "帮我修登录超时的问题" in transcript
    assert "修好了" in transcript

    # create_session 收到附件 id（daemon deliver=disk 落盘 {cwd}/attachments/）。
    assert captured["attachment_ids"] is not None and len(captured["attachment_ids"]) == 1

    # prompt：指读附件文件（附件名 + attachments/ 路径指引）+ --spec-dir 回流。
    prompt = captured["prompt"]
    assert f"distill-source-{str(session.id)[:8]}.md" in prompt
    assert "attachments/" in prompt
    assert "附件已落盘" in prompt
    assert f"--spec-dir ~/.sillyhub/daemon/specs/{ws.id}" in prompt


async def test_dispatch_fresh_runtime_derived_engine_unsupported_converts_422(
    db_session, tmp_path, auth_admin_token, monkeypatch
) -> None:
    """洞一引擎门控兜底：runtime_id 派生引擎非多模态（dispatch 预检覆盖不到）
    → create_session 附件校验抛 DaemonSessionAttachmentsUnsupported，转蒸馏源
    422 并给 resume 引导。"""
    from app.modules.daemon.session.service.errors import (
        DaemonSessionAttachmentsUnsupported,
    )

    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    session = await _make_session_record(db_session, user.id, turn_count=5)
    _patch_upload(monkeypatch)

    async def _fake_create_session(*args, **kwargs):
        raise DaemonSessionAttachmentsUnsupported(
            "此引擎不支持会话附件（仅 Claude 支持多模态与文件注入）。",
            details={"provider": "codex"},
        )

    monkeypatch.setattr(distill_module, "_create_session", _fake_create_session)

    with pytest.raises(DistillSourceInvalid) as exc_info:
        await DistillDispatchService(db_session).dispatch(
            ws.id,
            user,
            source_type="session",
            source_ref=str(session.id),
            runtime_id=str(uuid.uuid4()),  # 预检覆盖不到的路径
        )
    assert "不支持会话附件" in exc_info.value.message
    assert "mode=resume" in exc_info.value.message


async def test_dispatch_session_too_many_turns_returns_422(
    db_session, tmp_path, auth_admin_token, monkeypatch
) -> None:
    """洞三 turn 预检：超过阈值 → 422 引导 resume，且不触导出/上传/建会话。"""
    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    session = await _make_session_record(
        db_session, user.id, turn_count=distill_module.DISTILL_MAX_SESSION_TURNS + 1
    )

    async def _fail_upload(*args, **kwargs):
        pytest.fail("turn 超限应在上传前 422")

    monkeypatch.setattr(distill_module, "_upload_distill_source", _fail_upload)

    with pytest.raises(DistillSourceInvalid) as exc_info:
        await DistillDispatchService(db_session).dispatch(
            ws.id, user, source_type="session", source_ref=str(session.id)
        )
    assert "轮数过多" in exc_info.value.message
    assert "mode=resume" in exc_info.value.message

    runs = (await db_session.execute(select(AgentRun))).scalars().all()
    assert runs == []


async def test_dispatch_fresh_session_export_over_byte_cap_returns_422(
    db_session, tmp_path, auth_admin_token, monkeypatch
) -> None:
    """洞三字节护栏：导出超总字节上限 → 422（引导 resume），且不触上传。"""
    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    session = await _make_session_record(db_session, user.id, turn_count=1)
    await _seed_session_logs(
        db_session, session.id, [[("user_input", "内容足够超过 10 字节的上限")]]
    )
    monkeypatch.setattr(distill_module, "DISTILL_EXPORT_MAX_BYTES", 10)

    async def _fail_upload(*args, **kwargs):
        pytest.fail("导出超限应在上传前 422")

    monkeypatch.setattr(distill_module, "_upload_distill_source", _fail_upload)

    with pytest.raises(DistillSourceInvalid) as exc_info:
        await DistillDispatchService(db_session).dispatch(
            ws.id, user, source_type="session", source_ref=str(session.id)
        )
    assert "导出超过" in exc_info.value.message
    assert "mode=resume" in exc_info.value.message


async def test_dispatch_fresh_session_non_multimodal_provider_returns_422(
    db_session, tmp_path, auth_admin_token, monkeypatch
) -> None:
    """洞一引擎门控：非多模态引擎（codex）fresh 会话源 → 422 引导 resume/换引擎。"""
    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    session = await _make_session_record(db_session, user.id, turn_count=5)

    async def _fail_upload(*args, **kwargs):
        pytest.fail("引擎门控应在导出/上传前 422")

    monkeypatch.setattr(distill_module, "_upload_distill_source", _fail_upload)

    with pytest.raises(DistillSourceInvalid) as exc_info:
        await DistillDispatchService(db_session).dispatch(
            ws.id,
            user,
            source_type="session",
            source_ref=str(session.id),
            agent_type="codex",
        )
    assert "不支持会话附件" in exc_info.value.message
    assert "mode=resume" in exc_info.value.message


# ---------------------------------------------------------------------------
# ql-20260918-006：quick ref 白名单校验（M4）+ fresh 失败分支附件回收（M5）
# ---------------------------------------------------------------------------


async def test_dispatch_quick_ref_illegal_shape_rejected_422(
    db_session, tmp_path, auth_admin_token
) -> None:
    """ql-20260918-006（M4）：quick ref 白名单校验先于存在性检查——"../" / 绝对
    路径 / 盘符 / 反斜杠 / 子目录形态拒 422，不得把 agent 读取路径指到
    quicklog 目录外（存在性检查对 .. 不设防）。"""
    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    spec_root = tmp_path / "distill-spec"
    (spec_root / "quicklog").mkdir(parents=True)
    # quicklog 外的同内容文件：若存在性检查不设防，"../escape" 形态可命中
    (spec_root / "escape.md").write_text("# escaped\n", encoding="utf-8")

    service = DistillDispatchService(db_session)
    for bad_ref in ("../escape", "..\escape", "/etc/hosts", "C:/win", ".hidden", "a/b"):
        with pytest.raises(DistillSourceInvalid) as exc_info:
            await service.dispatch(ws.id, user, source_type="quick", source_ref=bad_ref)
        assert "不合法" in exc_info.value.message, bad_ref


@pytest.mark.parametrize(
    ("create_exc", "expect_status"),
    [
        ("offline", "failed"),
        ("unsupported", None),
    ],
)
async def test_dispatch_fresh_failure_recycles_draft_attachment_row(
    db_session, tmp_path, auth_admin_token, monkeypatch, create_exc, expect_status
) -> None:
    """ql-20260918-006（M5）：fresh 派发失败分支回收导出附件草稿行——上传先于
    create_session（洞一取数通道），引擎不支持 / 离线两失败分支此前不清理，
    附件行成孤儿（对象回收是 D-5 accepted risk，行应即时回收）。"""
    from app.modules.agent.placement import NoOnlineDaemonError
    from app.modules.daemon.session.service.errors import (
        DaemonSessionAttachmentsUnsupported,
    )
    from app.modules.session_attachment.model import SessionAttachment

    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    session = await _make_session_record(db_session, user.id, turn_count=5)

    created_ids: list[uuid.UUID] = []

    async def _fake_upload(db, user_id, source_session_id, data):
        row = SessionAttachment(
            id=uuid.uuid4(),
            user_id=user_id,
            session_id=None,
            kind="file",
            media_type="text/markdown",
            bytes=len(data),
            name=f"distill-source-{str(source_session_id)[:8]}.md",
            object_key=f"attachments/{user_id}/{'0' * 64}.md",
            sha256="0" * 64,
        )
        db.add(row)
        await db.commit()
        created_ids.append(row.id)
        return row

    monkeypatch.setattr(distill_module, "_upload_distill_source", _fake_upload)

    async def _fake_create_session(*args, **kwargs):
        if create_exc == "offline":
            raise NoOnlineDaemonError(user_id=uuid.uuid4())
        raise DaemonSessionAttachmentsUnsupported(
            "此引擎不支持会话附件。",
            details={"provider": "codex"},
        )

    monkeypatch.setattr(distill_module, "_create_session", _fake_create_session)

    if expect_status == "failed":
        task_read = await DistillDispatchService(db_session).dispatch(
            ws.id, user, source_type="session", source_ref=str(session.id)
        )
        assert task_read.status == "failed"
    else:
        with pytest.raises(DistillSourceInvalid):
            await DistillDispatchService(db_session).dispatch(
                ws.id,
                user,
                source_type="session",
                source_ref=str(session.id),
                runtime_id=str(uuid.uuid4()),
            )

    assert created_ids, "前置自检：上传确实发生"
    row = await db_session.get(SessionAttachment, created_ids[0])
    assert row is None, "失败分支应回收附件草稿行"


# ql-20260918-001：reconnecting 恢复窗口重试（一次点击报 not active 需二连点）
async def test_dispatch_resume_reconnecting_recovers_then_injects(
    db_session, tmp_path, auth_admin_token, monkeypatch
) -> None:
    """inject 撞 reconnecting → 窗口轮询翻回 active → 重试 inject 成功。"""
    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    session = await _make_session_record(db_session, user.id, turn_count=3, status="reconnecting")
    inject_calls = {"n": 0}

    async def _fake_inject(self, session_id, user_id, *, prompt, **kwargs):
        inject_calls["n"] += 1
        if inject_calls["n"] == 1:
            raise DaemonSessionNotActive(
                f"AgentSession '{session_id}' is not active (status=reconnecting)."
            )
        run = _make_run(db_session)
        await db_session.commit()
        return SessionDispatchResult(agent_session=session, agent_run=run, lease_id=uuid.uuid4())

    async def _fast_wait(self, svc, session_id, user_id, **kwargs):
        session.status = "active"
        db_session.add(session)
        await db_session.commit()
        return True

    monkeypatch.setattr(SessionService, "inject_session", _fake_inject)
    monkeypatch.setattr(DistillDispatchService, "_wait_session_reconnect", _fast_wait)

    task_read = await DistillDispatchService(db_session).dispatch(
        ws.id, user, source_type="session", source_ref=str(session.id), mode="resume"
    )
    assert inject_calls["n"] == 2
    assert task_read.mode == "resume"


async def test_dispatch_resume_reconnecting_timeout_raises_friendly(
    db_session, tmp_path, auth_admin_token, monkeypatch
) -> None:
    """窗口耗尽仍 reconnecting → 语义化 DistillSourceInvalid（引导稍后重试/切新建）。"""
    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    session = await _make_session_record(db_session, user.id, turn_count=3, status="reconnecting")

    async def _fake_inject(self, session_id, user_id, *, prompt, **kwargs):
        raise DaemonSessionNotActive(
            f"AgentSession '{session_id}' is not active (status=reconnecting)."
        )

    async def _no_wait(self, svc, session_id, user_id, **kwargs):
        return False

    monkeypatch.setattr(SessionService, "inject_session", _fake_inject)
    monkeypatch.setattr(DistillDispatchService, "_wait_session_reconnect", _no_wait)

    with pytest.raises(DistillSourceInvalid) as exc_info:
        await DistillDispatchService(db_session).dispatch(
            ws.id, user, source_type="session", source_ref=str(session.id), mode="resume"
        )
    assert "正在恢复中" in str(exc_info.value)


async def test_dispatch_resume_not_active_other_status_reraises(
    db_session, tmp_path, auth_admin_token, monkeypatch
) -> None:
    """非 reconnecting 的 NotActive（如 suspended 竞态）原样上抛，不进重试。"""
    ws, user = await _make_distill_env(db_session, tmp_path, auth_admin_token)
    session = await _make_session_record(db_session, user.id, turn_count=3, status="ended")
    # ended → plan=reopen；reopen 后状态竞态变 suspended → inject 抛 NotActive
    session2 = session
    waited = {"n": 0}

    async def _fake_reopen(self, session_id, user_id):
        return SessionReopenResponse(session_id=str(session_id), status="reconnecting")

    async def _fake_inject(self, session_id, user_id, *, prompt, **kwargs):
        session2.status = "suspended"
        db_session.add(session2)
        await db_session.commit()
        raise DaemonSessionNotActive(
            f"AgentSession '{session_id}' is not active (status=suspended)."
        )

    monkeypatch.setattr(SessionService, "reopen_session", _fake_reopen)
    monkeypatch.setattr(SessionService, "inject_session", _fake_inject)

    with pytest.raises(DaemonSessionNotActive):
        await DistillDispatchService(db_session).dispatch(
            ws.id, user, source_type="session", source_ref=str(session.id), mode="resume"
        )
    assert waited == {"n": 0}
