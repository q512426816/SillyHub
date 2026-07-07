"""scan 真阻塞（generic-wibbling-whisper.md 改造点 B）单元测试。

验证 start_scan_dispatch 切到 interactive session：
  - 建 AgentSession（config manual_approval=True + ask_user_only=True）—— backend
    permission_service 放行 PERMISSION_REQUEST 的硬门控 + daemon 只 AskUserQuestion 阻塞。
  - 走 prepare_scan_interactive_dispatch（kind=interactive lease），不再走 batch
    dispatch_to_daemon。
  - notify_interactive_dispatch + SESSION_INJECT 首 turn 注入。
"""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.modules.agent.base import AgentSpecBundle
from app.modules.agent.model import AgentSession
from app.modules.agent.placement import RunPlacementService
from app.modules.agent.service import AgentService
from app.modules.workspace.model import AgentRunWorkspace


def _scan_bundle() -> AgentSpecBundle:
    return AgentSpecBundle(
        change_summary="Scan workspace project structure",
        task_key="stage:scan",
        task_title="Stage dispatch: scan",
        allowed_paths=["/data/specs/ws"],
        denied_paths=[],
        available_tools=["sillyspec", "AskUserQuestion"],
        platform_metadata={"workspace_id": str(uuid.uuid4()), "mode": "scan"},
        stage_dispatch=True,
        change_key=None,
        stage="scan",
        spec_root="/data/specs/ws",
        runtime_root="/data/specs/runtime",
        step_prompt="test scan prompt with AskUserQuestion guidance",
        read_only=True,
    )


def _mock_workspace() -> MagicMock:
    """daemon-client workspace（path_source 触发跳过 server-side root_path 校验）。"""
    ws = MagicMock()
    ws.path_source = "daemon-client"
    ws.default_agent = None
    ws.default_model = None
    ws.repo_url = None
    ws.default_branch = None
    ws.name = "ws-test"
    ws.slug = "ws-test"
    return ws


def _mock_session(workspace: MagicMock) -> MagicMock:
    s = MagicMock()
    s.get = AsyncMock(return_value=workspace)
    s.add = MagicMock()
    s.commit = AsyncMock()
    s.refresh = AsyncMock()
    s.flush = AsyncMock()
    s.rollback = AsyncMock()
    return s


def _make_pass_delegate() -> MagicMock:
    """mock HostFsDelegate 让 start_scan_dispatch 入口校验一律放行（task-10 接线后必须）。

    task-10 把 root_path 校验 + 资产保护检测改经 HostFsDelegate（daemon-client 走
    WS RPC）。这些测试聚焦 interactive session 行为，不验证 root_path 校验——mock
    delegate.stat 区分路径：root_path 本身放行（exists:True/is_dir:True），任何
    .sillyspec 子路径都返回不存在（资产保护不命中）；list_dir 返回 []（无资产）。
    """
    delegate = MagicMock()

    async def _stat(workspace, path):
        # root_path 自身放行；任何 .sillyspec 子路径（sillyspec.db 等）都返回不存在
        # → 资产保护检测 _has_assets=False。
        if ".sillyspec" in path:
            return {"exists": False, "is_dir": False, "size": 0}
        return {"exists": True, "is_dir": True, "size": 0}

    delegate.stat = AsyncMock(side_effect=_stat)
    delegate.list_dir = AsyncMock(return_value=[])
    return delegate


@pytest.mark.asyncio
async def test_start_scan_dispatch_uses_interactive_session(monkeypatch):
    """start_scan_dispatch 走 interactive session（prepare_scan_interactive_dispatch），
    不再走 batch dispatch_to_daemon；AgentSession config manual_approval=True。"""
    workspace = _mock_workspace()
    mock_session = _mock_session(workspace)
    svc = AgentService(mock_session)

    # patch build_scan_bundle（start_scan_dispatch 函数内 import context_builder.build_scan_bundle）
    monkeypatch.setattr(
        "app.modules.agent.context_builder.build_scan_bundle",
        AsyncMock(return_value=_scan_bundle()),
    )

    # patch placement：interactive dispatch + notify delivered
    dispatch = MagicMock()
    dispatch.lease_id = uuid.uuid4()
    dispatch.runtime_id = uuid.uuid4()
    dispatch.run_id = uuid.uuid4()
    dispatch.claim_token = "claim-tok"
    prepare_mock = AsyncMock(return_value=dispatch)
    notify_mock = AsyncMock(return_value=True)
    monkeypatch.setattr(RunPlacementService, "prepare_scan_interactive_dispatch", prepare_mock)
    monkeypatch.setattr(RunPlacementService, "notify_interactive_dispatch", notify_mock)
    # batch 路径不应再被调用：监控 dispatch_to_daemon
    batch_mock = AsyncMock(return_value=None)
    monkeypatch.setattr(RunPlacementService, "dispatch_to_daemon", batch_mock)

    # patch ws_hub（SESSION_INJECT）
    hub = MagicMock()
    hub.send_session_control = AsyncMock()
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    # task-10：入口校验经 HostFsDelegate（daemon-client workspace mock 不走真实 RPC）
    monkeypatch.setattr(AgentService, "_get_host_fs_delegate", lambda self: _make_pass_delegate())

    await svc.start_scan_dispatch(
        workspace_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        root_path="/home/user/project",
        spec_root="/data/specs/ws",
    )

    # 1) 走 interactive：prepare_scan_interactive_dispatch 被调。
    prepare_mock.assert_awaited_once()
    # 2) 不再走 batch：dispatch_to_daemon 未被调。
    batch_mock.assert_not_awaited()
    # 3) AgentSession 建且 config 开启 manual_approval + ask_user_only。
    added_sessions = [
        c.args[0]
        for c in mock_session.add.call_args_list
        if c.args and isinstance(c.args[0], AgentSession)
    ]
    assert len(added_sessions) == 1
    cfg = added_sessions[0].config
    assert cfg["manual_approval"] is True
    assert cfg["ask_user_only"] is True
    assert cfg["mode"] == "scan"
    # 4) notify + SESSION_INJECT 首 turn 注入。
    notify_mock.assert_awaited_once()
    hub.send_session_control.assert_awaited_once()
    # SESSION_INJECT payload 带 scan prompt（首 turn）。
    inject_call = hub.send_session_control.call_args
    assert "prompt" in inject_call.args[2]
    # 5) AgentRunWorkspace M:N 关联仍建立。
    added_links = [
        c.args[0]
        for c in mock_session.add.call_args_list
        if c.args and isinstance(c.args[0], AgentRunWorkspace)
    ]
    assert len(added_links) == 1


@pytest.mark.asyncio
async def test_start_scan_dispatch_no_online_daemon_marks_failed(monkeypatch):
    """runtime 离线（prepare_scan_interactive_dispatch 抛 NoOnlineDaemonError）→
    _mark_no_online_daemon 收敛，不抛。"""
    from app.modules.agent.placement import NoOnlineDaemonError

    workspace = _mock_workspace()
    mock_session = _mock_session(workspace)
    svc = AgentService(mock_session)

    monkeypatch.setattr(
        "app.modules.agent.context_builder.build_scan_bundle",
        AsyncMock(return_value=_scan_bundle()),
    )
    monkeypatch.setattr(
        RunPlacementService,
        "prepare_scan_interactive_dispatch",
        AsyncMock(side_effect=NoOnlineDaemonError(user_id=uuid.uuid4())),
    )
    mark_mock = AsyncMock()
    monkeypatch.setattr(svc, "_mark_no_online_daemon", mark_mock)

    # task-10：入口校验经 HostFsDelegate（daemon-client workspace mock 不走真实 RPC）
    monkeypatch.setattr(AgentService, "_get_host_fs_delegate", lambda self: _make_pass_delegate())

    run = await svc.start_scan_dispatch(
        workspace_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        root_path="/home/user/project",
        spec_root="/data/specs/ws",
    )

    # 收敛为 no-online-daemon（run 返回，_mark 被调）。
    mark_mock.assert_awaited_once()
    assert run is not None
    # 回归（ql-20260706-001）：失败路径禁止 rollback——prepare_scan_interactive_dispatch
    # 抛 NoOnlineDaemonError 前无任何 DB 写操作，事务里只有本函数 add+flush 的
    # AgentSession/AgentRun。rollback 会把 AgentSession 冲掉，_mark_no_online_daemon 的
    # commit 插入 agent_runs 时 agent_session_id 外键违约 → 500。原实现（d16e13c7）即此
    # 500 根因。
    mock_session.rollback.assert_not_called()


@pytest.mark.asyncio
async def test_start_scan_dispatch_provider_fallback_is_claude_not_claude_code(monkeypatch):
    """回归（ql-20260706-001）：default_agent=NULL 且请求未传 provider 时，dispatch
    provider 兜底必须是 "claude"（合法 provider），不能是 "claude_code"（agent_type，
    daemon 上永不启用，会触发 NoOnlineDaemonError）。AgentSession.provider NOT NULL，故
    不能传 None——"claude" 是通行默认值（DB default_agent='claude' 的工作区均派发成功）。"""
    workspace = _mock_workspace()  # default_agent=None
    mock_session = _mock_session(workspace)
    svc = AgentService(mock_session)

    monkeypatch.setattr(
        "app.modules.agent.context_builder.build_scan_bundle",
        AsyncMock(return_value=_scan_bundle()),
    )

    dispatch = MagicMock()
    dispatch.lease_id = uuid.uuid4()
    dispatch.runtime_id = uuid.uuid4()
    dispatch.run_id = uuid.uuid4()
    dispatch.claim_token = "claim-tok"
    prepare_mock = AsyncMock(return_value=dispatch)
    monkeypatch.setattr(RunPlacementService, "prepare_scan_interactive_dispatch", prepare_mock)
    monkeypatch.setattr(
        RunPlacementService, "notify_interactive_dispatch", AsyncMock(return_value=True)
    )
    hub = MagicMock()
    hub.send_session_control = AsyncMock()
    monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)

    # task-10：入口校验经 HostFsDelegate（daemon-client workspace mock 不走真实 RPC）
    monkeypatch.setattr(AgentService, "_get_host_fs_delegate", lambda self: _make_pass_delegate())

    # 不传 provider，workspace.default_agent=None → 兜底 "claude"。
    await svc.start_scan_dispatch(
        workspace_id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        root_path="/home/user/project",
        spec_root="/data/specs/ws",
    )

    prepare_mock.assert_awaited_once()
    dispatched_provider = prepare_mock.call_args.kwargs.get("provider")
    assert dispatched_provider == "claude"
    # AgentSession.provider 也应是 "claude"（NOT NULL，且与 dispatch 一致）。
    added_sessions = [
        c.args[0]
        for c in mock_session.add.call_args_list
        if c.args and isinstance(c.args[0], AgentSession)
    ]
    assert len(added_sessions) == 1
    assert added_sessions[0].provider == "claude"
