"""task-11（2026-06-23-spec-transport-tar-sync）：start_stage_dispatch platform_args
transport 分支测试 + stage lease kind=batch 契约守护（§0 修正结论）。

覆盖：
- design §7.1（resolve_prompt_spec_root helper，task-10 复用）
- design §7.4 契约表（run sillyspec stage 事件 --spec-root 本地路径）
- 蓝图 §0 stage 路径修正表（stage 走 batch lease，非 interactive）

守护对象：
- task-10（start_stage_dispatch platform_args tar/shared 分支，service.py:1006-1034）
- §0 结论（stage batch lease kind=batch，防 service.py:1114 被误改为
  prepare_interactive_dispatch —— 那样 task-05 的 batch spec-sync 覆盖会失效）

铁律：
- 只测不改产品代码（task-10 已实现 platform_args 分支，本任务守护）
- 复用 test_start_scan_dispatch_daemon_client.py 的 mock 下游模式
  （_mark_no_online_daemon + dispatch_to_daemon + decide_backend）
- D 组真实走 start_stage_dispatch 捕获 prompt（经 dispatch_to_daemon 的 prompt kwarg）
- F 组真实走 start_stage_dispatch + 真实 INSERT lease（让 _resolve_dispatch_runtime
  返回在线 runtime），查 daemon_task_leases 表断言 kind=batch
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
) -> tuple[uuid.UUID, uuid.UUID, uuid.UUID]:
    """构造 Workspace + SpecWorkspace + Change，返回 (workspace_id, change_id, user_id)。

    参考 test_e2e_stage_dispatch.py 的 Workspace/Change 构造模式 + daemon-client
    workspace 绑定 runtime（让 _resolve_dispatch_runtime 找到在线 runtime）。

    ws_root 必须真实存在（resolve_work_dir 会 stat 校验），默认用模块级
    _STAGE_WS_ROOT（tempfile.mkdtemp 创建，read_only=True 不写无污染）。
    """
    from app.modules.change.model import Change
    from app.modules.spec_workspace.model import SpecWorkspace
    from app.modules.workspace.model import Workspace

    uid = await _create_user(session)
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"stage-ws-{uuid.uuid4().hex[:6]}",
        slug=f"stage-ws-{uuid.uuid4().hex[:6]}",
        root_path=ws_root,
        status="active",
        # daemon-client: 强绑 runtime，让 _resolve_dispatch_runtime 直接命中（避免
        # 走 _has_online_runtime 的 ws_hub 查询路径）。
        daemon_runtime_id=runtime_id,
        path_source="daemon-client" if runtime_id else None,
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

    change = Change(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        change_key=f"stage-change-{uuid.uuid4().hex[:6]}",
        title="Stage dispatch transport test",
        status="in-progress",
        location="active",
        path=".sillyspec/changes/stage-test",
        current_stage="propose",
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
    """D1: tar 模式 platform_args 含 daemon 本地路径 ~/.sillyhub/daemon/specs/{ws}。

    守护 task-10 复用 task-02 resolve_prompt_spec_root helper，tar 分支返回
    daemon 本地约定路径（与 daemon spec-sync.resolveSpecDir 输出一致）。
    """
    _patch_transport(monkeypatch, "tar")
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
    ):
        service = AgentService(db_session)
        await service.start_stage_dispatch(
            workspace_id=ws_id,
            change_id=change_id,
            user_id=uid,
            stage="propose",
            prompt_template="propose.md",
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
    """D2: tar 模式 platform_args 同时含 --runtime-root + --workspace-id。

    与 scan bundle 对齐（task-10 service.py:1029-1034）：runtime-root 在 spec-root
    下加 /runtime，workspace-id 是 ws_id（str(UUID)）。
    """
    _patch_transport(monkeypatch, "tar")
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
    ):
        service = AgentService(db_session)
        await service.start_stage_dispatch(
            workspace_id=ws_id,
            change_id=change_id,
            user_id=uid,
            stage="propose",
            prompt_template="propose.md",
            requires_worktree=False,
            read_only=True,
        )

    prompt = captured["prompt"]
    assert f"--runtime-root ~/.sillyhub/daemon/specs/{ws_id}/runtime" in prompt
    assert f"--workspace-id {ws_id}" in prompt


@pytest.mark.asyncio
async def test_d3_shared_mode_platform_args_contains_host_path(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """D3: shared 模式 platform_args 含宿主路径 spec_data_host_dir/{ws}（D-004 现状）。

    shared（默认）→ resolve_prompt_spec_root 返回宿主路径，daemon 与 backend
    同机 + Docker bind mount 共享同一物理盘，零改动（D-004 向后兼容）。
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
    ):
        service = AgentService(db_session)
        await service.start_stage_dispatch(
            workspace_id=ws_id,
            change_id=change_id,
            user_id=uid,
            stage="propose",
            prompt_template="propose.md",
            requires_worktree=False,
            read_only=True,
        )

    prompt = captured["prompt"]
    assert f"--spec-root /data/spec-workspaces/{ws_id}" in prompt
    # tar 路径不应出现（守护 shared 不被 tar 污染）
    assert "~/.sillyhub/daemon/specs/" not in prompt


@pytest.mark.asyncio
async def test_d4_shared_mode_platform_args_contains_host_runtime(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """D4: shared 模式 platform_args 含宿主 runtime-root（task-10 行 1029 host_runtime_root）。

    shared 分支 runtime-root = {host_spec_root}/runtime，宿主路径前缀。
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
    ):
        service = AgentService(db_session)
        await service.start_stage_dispatch(
            workspace_id=ws_id,
            change_id=change_id,
            user_id=uid,
            stage="propose",
            prompt_template="propose.md",
            requires_worktree=False,
            read_only=True,
        )

    prompt = captured["prompt"]
    assert f"--runtime-root /data/spec-workspaces/{ws_id}/runtime" in prompt


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
    ):
        service = AgentService(db_session)
        await service.start_stage_dispatch(
            workspace_id=ws_id,
            change_id=change_id,
            user_id=uid,
            stage="propose",
            prompt_template="propose.md",
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
    ):
        service = AgentService(db_session)
        await service.start_stage_dispatch(
            workspace_id=ws_id,
            change_id=change_id,
            user_id=uid,
            stage="propose",
            prompt_template="propose.md",
            requires_worktree=False,
            read_only=True,
        )

    prompt = captured["prompt"]
    assert "--spec-root" not in prompt


@pytest.mark.asyncio
async def test_d7_transport_orthogonal_to_strategy(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """D7: 同 workspace（platform-managed）仅 transport 不同 → 路径前缀不同。

    守护 D-001 transport 正交 strategy（D-006 双轨语义）：切换 transport 只改
    prompt 路径前缀，不改 strategy 判定。
    """
    ws_id, change_id, uid = await _create_platform_workspace(db_session)

    # tar 路径
    _patch_transport(monkeypatch, "tar")
    tar_mock, tar_captured = _capture_dispatch_prompt()
    with (
        patch.object(AgentService, "_mark_no_online_daemon", new=AsyncMock()),
        patch(
            "app.modules.agent.placement.RunPlacementService.dispatch_to_daemon",
            new=tar_mock,
        ),
        patch(
            "app.modules.agent.placement.RunPlacementService.decide_backend",
            new=AsyncMock(),
        ),
    ):
        service = AgentService(db_session)
        await service.start_stage_dispatch(
            workspace_id=ws_id,
            change_id=change_id,
            user_id=uid,
            stage="propose",
            prompt_template="plan.md",  # 换模板避免与 shared 复用
            requires_worktree=False,
            read_only=True,
        )
    tar_prompt = tar_captured["prompt"]

    # shared 路径（同 workspace）
    _patch_transport(monkeypatch, "shared")
    shared_mock, shared_captured = _capture_dispatch_prompt()
    with (
        patch.object(AgentService, "_mark_no_online_daemon", new=AsyncMock()),
        patch(
            "app.modules.agent.placement.RunPlacementService.dispatch_to_daemon",
            new=shared_mock,
        ),
        patch(
            "app.modules.agent.placement.RunPlacementService.decide_backend",
            new=AsyncMock(),
        ),
    ):
        service = AgentService(db_session)
        await service.start_stage_dispatch(
            workspace_id=ws_id,
            change_id=change_id,
            user_id=uid,
            stage="plan",  # 换 stage 避免并发保护
            prompt_template="execute.md",
            requires_worktree=False,
            read_only=True,
        )
    shared_prompt = shared_captured["prompt"]

    # 同 workspace，路径前缀不同（正交）
    assert f"~/.sillyhub/daemon/specs/{ws_id}" in tar_prompt
    assert f"/data/spec-workspaces/{ws_id}" in shared_prompt
    # 反向断言：tar 不含宿主路径，shared 不含 daemon 本地路径
    assert "/data/spec-workspaces/" not in tar_prompt
    assert "~/.sillyhub/" not in shared_prompt


# ── F 组：stage lease kind=batch 契约守护（§0 修正结论防回归） ────────────────


@pytest.mark.asyncio
async def test_f1_start_stage_dispatch_produces_batch_lease(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """F1: start_stage_dispatch 产生 kind='batch' lease（§0 修正结论守护）。

    真实走 start_stage_dispatch → dispatch_to_daemon 真实 INSERT lease（让
    _resolve_dispatch_runtime 命中在线 runtime），查 daemon_task_leases 表
    断言 kind='batch' + agent_run_id=run.id（非 NULL）。

    守护：若未来有人把 service.py:1114 从 dispatch_to_daemon 误改为
    prepare_interactive_dispatch（kind='interactive' + agent_run_id=NULL），
    task-05 的 batch spec-sync 覆盖会失效 —— 本用例 fail 暴露。
    """
    _patch_transport(monkeypatch, "tar")
    uid = await _create_user(db_session)
    rt = await _create_runtime(db_session, uid)
    ws_id, change_id, _ = await _create_platform_workspace(db_session, runtime_id=rt.id)

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
    ):
        service = AgentService(db_session)
        run = await service.start_stage_dispatch(
            workspace_id=ws_id,
            change_id=change_id,
            user_id=uid,
            stage="propose",
            prompt_template="propose.md",
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
    # §0 修正结论核心断言：stage 走 batch lease
    assert lease_row[1] == "batch", (
        f"stage lease must be kind='batch' (§0), got kind={lease_row[1]!r}. "
        "If this fails, service.py start_stage_dispatch likely dispatches via "
        "prepare_interactive_dispatch (interactive) instead of dispatch_to_daemon "
        "(batch) — that breaks task-05 batch spec-sync coverage."
    )
    # batch 特征：agent_run_id 非 NULL（绑定 run.id）—— 与 interactive 的 NULL 对照
    assert lease_row[2] is not None, "batch lease must bind agent_run_id (non-NULL)"
    # agent_run_id 列存的是 run.id（SQLite CHAR(32) hex 形式）
    assert str(lease_row[2]).replace("-", "") == run.id.hex.replace("-", "")

    # 交叉验证：用 ORM 读 DaemonTaskLease，确认 ORM 层也读到 kind=batch
    # （F1 用例的 lease_id 从 raw row 取，因为 run.lease_id 是 worktree lease）
    lease_id_hex = lease_row[0]
    lease = await db_session.get(DaemonTaskLease, uuid.UUID(lease_id_hex))
    assert lease is not None
    assert lease.kind == "batch"
    assert lease.agent_run_id == run.id
