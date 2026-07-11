"""task-11（2026-06-23-spec-transport-tar-sync）：start_stage_dispatch platform_args
transport 分支测试 + stage lease kind=interactive 契约守护（bfaa9256 起设计方向）。

覆盖：
- design §7.1（resolve_prompt_spec_root helper，task-10 复用）
- design §7.4 契约表（run sillyspec stage 事件 --spec-root 本地路径）
- bfaa9256 起 stage 路径方向：stage 走 dispatch_to_daemon 的 interactive lease
  （kind='interactive' + agent_run_id 非 NULL），让 daemon 走 SessionManager 实时转发；
  区别于 prepare_interactive_dispatch 对话 lease（agent_run_id=NULL）。

守护对象：
- task-10（start_stage_dispatch platform_args tar/shared 分支，service.py:1006-1034）
- 设计契约：stage 必须经 dispatch_to_daemon（interactive + agent_run_id 非 NULL），
  防 service.py:start_stage_dispatch 被改为 prepare_interactive_dispatch —— 后者
  agent_run_id=NULL 会让 close_interactive_run 无法按 run_id 定位、stage 回写失效。

铁律：
- 只测不改产品代码（task-10 已实现 platform_args 分支，本任务守护）
- 复用 test_start_scan_dispatch_daemon_client.py 的 mock 下游模式
  （_mark_no_online_daemon + dispatch_to_daemon + decide_backend）
- D 组真实走 start_stage_dispatch 捕获 prompt（经 dispatch_to_daemon 的 prompt kwarg）
- F 组真实走 start_stage_dispatch + 真实 INSERT lease（让 _resolve_dispatch_runtime
  返回在线 runtime），查 daemon_task_leases 表断言 kind=interactive
"""

from __future__ import annotations

import tempfile
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.service import AgentService
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease

# workspace root 必须真实存在（resolve_work_dir 会 stat 校验）。测试用一个
# 进程级稳定目录（pytest tmp_path 是函数级，跨用例不复用），这里用 tempfile
# 在模块导入时创建一次，所有用例共享（read_only=True 不写，无污染）。
_STAGE_WS_ROOT = tempfile.mkdtemp(prefix="stage-ws-root-")


# ── Helpers ──────────────────────────────────────────────────────────────────


async def _create_user(session: AsyncSession) -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"test-{uid}@example.com",
            password_hash="x",
            display_name="T",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _create_runtime(session: AsyncSession, user_id: uuid.UUID) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="daemon",
        provider="claude",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


async def _create_platform_workspace(
    session: AsyncSession,
    *,
    strategy: str = "platform-managed",
    spec_root: str | None = "/data/spec-workspaces/ws",
    runtime_id: uuid.UUID | None = None,
    ws_root: str = _STAGE_WS_ROOT,
    user_id: uuid.UUID | None = None,
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """构造 Workspace + SpecWorkspace + Change + per-member binding，返回
    (workspace_id, change_id, user_id)。

    参考 test_e2e_stage_dispatch.py 的 Workspace/Change 构造模式。task-01 后
    Workspace 无 path_source / daemon_runtime_id 列（单一 daemon-client 模式），
    dispatch 经 ``MemberBindingResolver`` 解析 (workspace_id, user_id) → daemon_id。
    本 helper 始终建一条在线绑定（DaemonInstance + online DaemonRuntime +
    WorkspaceMemberRuntime），让 ``_resolve_dispatch_runtime`` 能命中。

    ``user_id`` 可选：传入则复用已建 user（F1 路径，runtime 已绑该 user），
    否则内部建新 user。``runtime_id`` 传入则链接已存在的 DaemonRuntime 到新
    DaemonInstance（F1），否则建新 DaemonRuntime。

    ws_root 必须真实存在（resolve_work_dir 会 stat 校验），默认用模块级
    _STAGE_WS_ROOT（tempfile.mkdtemp 创建，read_only=True 不写无污染）。
    """
    from app.modules.change.model import Change
    from app.modules.daemon.model import DaemonInstance
    from app.modules.spec_workspace.model import SpecWorkspace
    from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
    from app.modules.workspace.model import Workspace

    uid = user_id if user_id is not None else await _create_user(session)
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"stage-ws-{uuid.uuid4().hex[:6]}",
        slug=f"stage-ws-{uuid.uuid4().hex[:6]}",
        root_path=ws_root,
        status="active",
    )
    session.add(ws)

    if spec_root is not None:
        session.add(
            SpecWorkspace(
                workspace_id=ws.id,
                spec_root=spec_root,
                strategy=strategy,
            )
        )

    # per-member binding：DaemonInstance（online）+ online DaemonRuntime +
    # WorkspaceMemberRuntime。dispatch 经 binding → daemon_id → runtime 解析。
    daemon = DaemonInstance(
        id=uuid.uuid4(),
        user_id=uid,
        hostname="stage-test-host",
        server_url="http://localhost:8000",
        status="online",
    )
    session.add(daemon)
    if runtime_id is not None:
        # F1 路径：runtime 已由 _create_runtime 创建，链接到 DaemonInstance 即可
        # （不重复 INSERT，避免主键冲突）。_resolve_dispatch_runtime 经 binding
        # daemon_id → query_runtime_by_daemon_and_provider 命中此 runtime。
        existing_rt = await session.get(DaemonRuntime, runtime_id)
        if existing_rt is not None:
            existing_rt.daemon_instance_id = daemon.id
            existing_rt.status = "online"
            session.add(existing_rt)
    else:
        session.add(
            DaemonRuntime(
                id=uuid.uuid4(),
                user_id=uid,
                name="stage-daemon",
                provider="claude",
                status="online",
                last_heartbeat_at=datetime.now(UTC),
                daemon_instance_id=daemon.id,
            )
        )
    session.add(
        WorkspaceMemberRuntime(
            workspace_id=ws.id,
            user_id=uid,
            daemon_id=daemon.id,
            root_path=ws_root,
            path_source="daemon-client",
        )
    )

    change = Change(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        change_key=f"stage-change-{uuid.uuid4().hex[:6]}",
        title="Stage dispatch transport test",
        status="in-progress",
        location="active",
        path=".sillyspec/changes/stage-test",
        current_stage="brainstorm",
        stages={},
    )
    session.add(change)
    await session.commit()
    await session.refresh(change)
    await session.refresh(ws)
    return ws.id, change.id, uid


def _patch_transport(monkeypatch: pytest.MonkeyPatch, value: str) -> None:
    """patch app.core.config.get_settings 返回带指定 spec_transport 的 mock。

    service.py:1014 局部 `from app.core.config import get_settings`，每次
    start_stage_dispatch 都重新 import 并调用，故 patch 模块属性即可。

    spec_data_host_dir 用一个稳定的测试常量，便于 D3/D4 断言宿主路径前缀。
    """
    fake_settings = SimpleNamespace(
        spec_transport=value,
        spec_data_host_dir="/data/spec-workspaces",
    )
    monkeypatch.setattr(
        "app.core.config.get_settings",
        lambda: fake_settings,
    )


def _make_pass_delegate() -> MagicMock:
    """构造一个 mock HostFsDelegate，stat/list_dir 一律放行（task-09/10 接线后必须）。

    task-09（resolve_work_dir）+ task-10（start_scan_dispatch 入口校验）改经
    HostFsDelegate 做 workspace_root 存在性 + 资产保护判定。transport/lease-kind
    类测试聚焦下游行为，root_path 校验不是它们的职责——这里 mock delegate 让校验
    一律通过（stat.exists=True/is_dir=True，list_dir=[] 表示无 .sillyspec 资产）。
    用 side_effect 区分：root_path 自身放行；.sillyspec 子路径返回不存在（避免
    资产保护误命中——start_scan_dispatch 会 stat sillyspec.db）。
    """
    delegate = MagicMock()

    async def _stat(workspace, path):
        if ".sillyspec" in str(path):
            return {"exists": False, "is_dir": False, "size": 0}
        return {"exists": True, "is_dir": True, "size": 0}

    delegate.stat = AsyncMock(side_effect=_stat)
    delegate.list_dir = AsyncMock(return_value=[])
    return delegate


# ── D 组：start_stage_dispatch platform_args tar/shared 分支 ─────────────────


def _capture_dispatch_prompt() -> tuple[AsyncMock, dict[str, str]]:
    """返回 (mock, capture_dict)：mock 捕获 dispatch_to_daemon 的 prompt kwarg。

    dispatch_to_daemon 是 AsyncMock，side_effect 把 prompt 写入 capture_dict 并
    返回一个 lease_id（start_stage_dispatch 据此 return run，不再往下走 race 分支）。
    """
    captured: dict[str, str] = {}

    async def _capture(*args, **kwargs):
        captured["prompt"] = kwargs.get("prompt", "")
        # self 参数是 args[0]，真实签名 lease_id 在末尾 return
        return uuid.uuid4()

    mock = AsyncMock(side_effect=_capture)
    return mock, captured


@pytest.mark.asyncio
async def test_d1_tar_mode_platform_args_contains_daemon_local_path(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """D1（方案 A）：daemon-client workspace → platform_args 含 daemon 本地 tar 路径。

    path_source='daemon-client' 锁 transport='tar'，忽略全局 SPEC_TRANSPORT（此处
    patch 'shared' 验证锁定——daemon-client 即便全局 shared 也走 tar）。守护
    resolve_prompt_spec_root per-workspace 决策覆盖全局的核心规则。
    """
    _patch_transport(monkeypatch, "shared")
    ws_id, change_id, uid = await _create_platform_workspace(db_session)
    dispatch_mock, captured = _capture_dispatch_prompt()

    with (
        patch.object(AgentService, "_mark_no_online_daemon", new=AsyncMock()),
        patch(
            "app.modules.agent.placement.RunPlacementService.dispatch_to_daemon",
            new=dispatch_mock,
        ),
        patch(
            "app.modules.agent.placement.RunPlacementService.decide_backend",
            new=AsyncMock(),
        ),
        patch.object(
            AgentService,
            "_get_host_fs_delegate",
            return_value=_make_pass_delegate(),
        ),
    ):
        service = AgentService(db_session)
        await service.start_stage_dispatch(
            workspace_id=ws_id,
            change_id=change_id,
            user_id=uid,
            stage="brainstorm",
            prompt_template="brainstorm.md",
            requires_worktree=False,
            read_only=True,
        )

    assert dispatch_mock.await_count == 1
    prompt = captured["prompt"]
    assert f"--spec-root ~/.sillyhub/daemon/specs/{ws_id}" in prompt


@pytest.mark.asyncio
async def test_d2_tar_mode_platform_args_contains_runtime_and_workspace_id(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """D2（方案 A）：daemon-client workspace → platform_args 含 tar runtime-root + workspace-id。

    与 scan bundle 对齐：runtime-root 在 spec-root 下加 /runtime，workspace-id 是 ws_id。
    path_source='daemon-client' 锁 tar（patch 'shared' 验证锁定覆盖全局）。
    """
    _patch_transport(monkeypatch, "shared")
    ws_id, change_id, uid = await _create_platform_workspace(db_session)
    dispatch_mock, captured = _capture_dispatch_prompt()

    with (
        patch.object(AgentService, "_mark_no_online_daemon", new=AsyncMock()),
        patch(
            "app.modules.agent.placement.RunPlacementService.dispatch_to_daemon",
            new=dispatch_mock,
        ),
        patch(
            "app.modules.agent.placement.RunPlacementService.decide_backend",
            new=AsyncMock(),
        ),
        patch.object(
            AgentService,
            "_get_host_fs_delegate",
            return_value=_make_pass_delegate(),
        ),
    ):
        service = AgentService(db_session)
        await service.start_stage_dispatch(
            workspace_id=ws_id,
            change_id=change_id,
            user_id=uid,
            stage="brainstorm",
            prompt_template="brainstorm.md",
            requires_worktree=False,
            read_only=True,
        )

    prompt = captured["prompt"]
    assert f"--runtime-root ~/.sillyhub/daemon/specs/{ws_id}/runtime" in prompt
    assert f"--workspace-id {ws_id}" in prompt


@pytest.mark.asyncio
async def test_d5_non_platform_managed_no_platform_args(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """D5: 非 platform-managed workspace → platform_args 为空（task-10 行 1011 条件）。

    strategy='repo-native'（或无 SpecWorkspace）→ 不注入 --spec-root，stage 仍写
    本地 .sillyspec（行为不变）。守护降级不被误改成对所有 strategy 都注入。
    """
    _patch_transport(monkeypatch, "tar")  # 即便 tar，非 platform-managed 也不注入
    ws_id, change_id, uid = await _create_platform_workspace(db_session, strategy="repo-native")
    dispatch_mock, captured = _capture_dispatch_prompt()

    with (
        patch.object(AgentService, "_mark_no_online_daemon", new=AsyncMock()),
        patch(
            "app.modules.agent.placement.RunPlacementService.dispatch_to_daemon",
            new=dispatch_mock,
        ),
        patch(
            "app.modules.agent.placement.RunPlacementService.decide_backend",
            new=AsyncMock(),
        ),
        patch.object(
            AgentService,
            "_get_host_fs_delegate",
            return_value=_make_pass_delegate(),
        ),
    ):
        service = AgentService(db_session)
        await service.start_stage_dispatch(
            workspace_id=ws_id,
            change_id=change_id,
            user_id=uid,
            stage="brainstorm",
            prompt_template="brainstorm.md",
            requires_worktree=False,
            read_only=True,
        )

    prompt = captured["prompt"]
    assert "--spec-root" not in prompt
    assert "--runtime-root" not in prompt
    assert "--workspace-id" not in prompt


@pytest.mark.asyncio
async def test_d6_platform_managed_but_spec_root_empty_no_platform_args(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """D6: platform-managed 但 spec_root=None → platform_args 为空（task-10 行 1011 条件）。

    strategy='platform-managed' 但 spec_root=None → 条件 `and spec_ws.spec_root`
    失败 → 降级不注入。守护 spec_root 空判据不被误删。
    """
    _patch_transport(monkeypatch, "tar")
    # spec_root=None → _create_platform_workspace 不创建 SpecWorkspace 行
    ws_id, change_id, uid = await _create_platform_workspace(
        db_session, strategy="platform-managed", spec_root=None
    )
    dispatch_mock, captured = _capture_dispatch_prompt()

    with (
        patch.object(AgentService, "_mark_no_online_daemon", new=AsyncMock()),
        patch(
            "app.modules.agent.placement.RunPlacementService.dispatch_to_daemon",
            new=dispatch_mock,
        ),
        patch(
            "app.modules.agent.placement.RunPlacementService.decide_backend",
            new=AsyncMock(),
        ),
        patch.object(
            AgentService,
            "_get_host_fs_delegate",
            return_value=_make_pass_delegate(),
        ),
    ):
        service = AgentService(db_session)
        await service.start_stage_dispatch(
            workspace_id=ws_id,
            change_id=change_id,
            user_id=uid,
            stage="brainstorm",
            prompt_template="brainstorm.md",
            requires_worktree=False,
            read_only=True,
        )

    prompt = captured["prompt"]
    assert "--spec-root" not in prompt


# ── F 组：stage lease kind=interactive 契约守护（bfaa9256 起设计方向防回归） ────


@pytest.mark.asyncio
async def test_f1_start_stage_dispatch_produces_interactive_lease(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """F1: start_stage_dispatch 产生 kind='interactive' lease（bfaa9256 起的设计方向）。

    真实走 start_stage_dispatch → dispatch_to_daemon 真实 INSERT lease（让
    _resolve_dispatch_runtime 命中在线 runtime），查 daemon_task_leases 表
    断言 kind='interactive' + agent_run_id=run.id（非 NULL）。

    守护：stage 必须经 dispatch_to_daemon（interactive lease + agent_run_id 非 NULL），
    不能走 prepare_interactive_dispatch（对话 lease，agent_run_id=NULL）—— 后者会让
    close_interactive_run 无法按 run_id 定位 agent_run、stage 回写（change_id）失效。
    agent_run_id 非 NULL 是 stage interactive lease 区别于对话 lease 的关键特征。
    """
    _patch_transport(monkeypatch, "tar")
    uid = await _create_user(db_session)
    rt = await _create_runtime(db_session, uid)
    ws_id, change_id, _ = await _create_platform_workspace(
        db_session, runtime_id=rt.id, user_id=uid
    )

    # 不 mock dispatch_to_daemon —— 让真实 INSERT 发生。但 mock ws_hub 的
    # send_wakeup（dispatch_to_daemon:298 _send_ws_wakeup 会查 ws_hub），
    # 避免 ws_hub 未初始化抛错。
    mock_hub = MagicMock()
    mock_hub.is_connected.return_value = True
    mock_hub.send_wakeup = AsyncMock()

    with (
        patch.object(AgentService, "_mark_no_online_daemon", new=AsyncMock()),
        patch(
            "app.modules.agent.placement.RunPlacementService.decide_backend",
            new=AsyncMock(),
        ),
        patch("app.modules.daemon.ws_hub.get_daemon_ws_hub", return_value=mock_hub),
        patch.object(
            AgentService,
            "_get_host_fs_delegate",
            return_value=_make_pass_delegate(),
        ),
    ):
        service = AgentService(db_session)
        run = await service.start_stage_dispatch(
            workspace_id=ws_id,
            change_id=change_id,
            user_id=uid,
            stage="brainstorm",
            prompt_template="brainstorm.md",
            requires_worktree=False,
            read_only=True,
        )

    # 查 daemon_task_leases 表：run.lease_id 是 worktree lease（None，因为
    # read_only=True 不 acquire），daemon lease 通过 agent_run_id 反查。
    from sqlalchemy import text

    rows = (
        await db_session.execute(
            text("SELECT id, kind, agent_run_id FROM daemon_task_leases WHERE agent_run_id = :rid"),
            {"rid": run.id.hex},
        )
    ).fetchall()
    assert len(rows) == 1, f"expected exactly 1 stage lease, got {len(rows)}"
    lease_row = rows[0]
    # 设计契约核心断言（bfaa9256 起 stage 改 interactive；2026-07-09 确认为正式方向）：
    # stage 走 dispatch_to_daemon 创建的 interactive lease —— kind='interactive' 且
    # agent_run_id 非 NULL（绑定 run.id）。区别于 prepare_interactive_dispatch 创建的
    # 对话 lease（同样 kind='interactive' 但 agent_run_id=NULL）。agent_run_id 非 NULL
    # 是 close_interactive_run 按 run_id 定位 agent_run + stage 回写（change_id）的前提。
    assert lease_row[1] == "interactive", (
        f"stage lease must be kind='interactive' (bfaa9256 起), got kind={lease_row[1]!r}. "
        "If this fails, service.py start_stage_dispatch likely no longer uses "
        "dispatch_to_daemon — stage must NOT go through prepare_interactive_dispatch "
        "(its agent_run_id=NULL would break close_interactive_run stage writeback)."
    )
    # stage interactive lease 特征：agent_run_id 非 NULL（绑定 run.id）—— 区别于
    # prepare_interactive_dispatch 对话 lease 的 agent_run_id=NULL。
    assert lease_row[2] is not None, "stage lease must bind agent_run_id (non-NULL)"
    # agent_run_id 列存的是 run.id（SQLite CHAR(32) hex 形式）
    assert str(lease_row[2]).replace("-", "") == run.id.hex.replace("-", "")

    # 交叉验证：用 ORM 读 DaemonTaskLease，确认 ORM 层也读到 kind=interactive
    # （F1 用例的 lease_id 从 raw row 取，因为 run.lease_id 是 worktree lease）
    lease_id_hex = lease_row[0]
    lease = await db_session.get(DaemonTaskLease, uuid.UUID(lease_id_hex))
    assert lease is not None
    assert lease.kind == "interactive"
    assert lease.agent_run_id == run.id
