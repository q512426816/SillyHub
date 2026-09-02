"""dispatch_worker per-worker worktree 接线单测（task-03）。

change ``2026-07-12-worker-worktree-isolation`` task-03 / D-001@v2 / D-005@v2：

- AC-01 正常创建：``MissionExecutionService`` 注入 ``HostFsDelegate`` 后，
  ``dispatch_worker`` 算 workspace 内 ``.worktrees/<run.id 短8>`` sibling 路径
  + 调 ``git_worktree_add`` → 把副本路径作 ``root_path`` 传 ``dispatch_to_daemon``
  （非 ``ws.root_path``）+ 填 ``AgentRun.worktree_branch``。
- AC-02 base_ref 兜底：``ws.default_branch`` 为 None → ``git_worktree_add`` 收到
  ``base_ref="HEAD"``（X-001 空值兜底）。
- AC-03 创建失败：``git_worktree_add`` 返回 ``ok=False`` → worker run 标
  ``failed``，``dispatch_to_daemon`` 不调用，``dispatch_worker`` 返回 None
  （不抛，主 agent 决策补派，design §9 兼容策略）。
- AC-04 向后兼容：未注入 ``HostFsDelegate`` → 保留原行为（``root_path=ws.root_path``，
  不填 ``worktree_branch``），single mode / 既有调用零回归（design §9）。

路径策略 D-001@v2：worktree 放 ``ws.root_path/.worktrees/<run.id 短8>/``（workspace
内，非父目录 sibling）——daemon ``allowed_roots`` 只含 ``ws.root_path``，父目录
sibling 会被 ``assertWithinAllowedRoots`` 拒绝（design §7）。
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.execution import MissionExecutionService
from app.modules.agent.model import AgentMission, AgentRun
from app.modules.workspace.model import Workspace


async def _make_workspace(
    session: AsyncSession, *, root_path: str = "/tmp/repo", default_branch: str | None = "main"
) -> uuid.UUID:
    ws = Workspace(
        id=uuid.uuid4(),
        name="t",
        slug="t",
        root_path=root_path,
        default_branch=default_branch,
        default_agent="claude_code",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws.id


async def _make_worker(session: AsyncSession, *, mission_id: uuid.UUID) -> AgentRun:
    run = AgentRun(
        mission_id=mission_id,
        agent_type="claude_code",
        status="pending",
        role="arch",
        objective="scan arch",
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


def _make_delegate_mock(
    *,
    ok: bool,
    worktree_path: str | None = None,
    error: str | None = None,
    rev_parse_commit: str | None = "sha-abc123",
):
    """Build a fake HostFsDelegate with git_worktree_add as a recording AsyncMock.

    task-05（2026-08-24-session-team-mission-context）：本文件用例均验「探测=git
    → 照旧 worktree」链路，probe 固定返 "git"（direct/unknown 分支见
    test_dispatch_worker_direct_mode.py）。仅 mock 补齐，断言零改动。

    ql-20260831-007：git_rev_parse 补 mock——default_branch 真实性探测默认
    「可解析」（返回 commit 串，既有用例 base_ref=='main' 断言保持）；传
    ``rev_parse_commit=None`` 可模拟「仓库无该分支」触发 HEAD 兜底。
    """
    delegate = MagicMock()
    delegate.probe_workspace_git_mode = AsyncMock(return_value="git")
    delegate.git_rev_parse = AsyncMock(return_value=rev_parse_commit)
    # ql-20260902-001：创建失败路径会 best-effort git_worktree_remove 收残
    # （删残缺 worktree + workers/<id> 分支），mock 补齐供断言。
    delegate.git_worktree_remove = AsyncMock(return_value={"ok": True, "branch_deleted": True})
    delegate.git_worktree_add = AsyncMock(
        return_value={
            "ok": ok,
            "worktree_path": worktree_path,
            "error": error,
        }
    )
    return delegate


# ---------------------------------------------------------------------------
# AC-01 正常创建：root_path=sibling + worktree_branch 填值
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_worker_creates_worktree_and_passes_sibling_as_root(
    db_session: AsyncSession,
) -> None:
    ws_id = await _make_workspace(db_session, root_path="/tmp/repo", default_branch="main")
    mission = AgentMission(workspace_id=ws_id, objective="o")
    db_session.add(mission)
    await db_session.commit()
    await db_session.refresh(mission)
    run = await _make_worker(db_session, mission_id=mission.id)

    delegate = _make_delegate_mock(ok=True, worktree_path="/tmp/repo/.worktrees/abcd1234")
    fake_placement = MagicMock()
    fake_placement.dispatch_to_daemon = AsyncMock(return_value=uuid.uuid4())
    svc = MissionExecutionService(db_session, placement=fake_placement, host_fs_delegate=delegate)

    lease_id = await svc.dispatch_worker(
        run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=False
    )

    # dispatch_to_daemon 被调用，且 root_path 是 sibling 副本（非 ws.root_path）
    assert lease_id is not None
    fake_placement.dispatch_to_daemon.assert_awaited_once()
    kwargs = fake_placement.dispatch_to_daemon.call_args.kwargs
    expected_sibling = "/tmp/repo/.worktrees/" + str(run.id)[:8]
    assert kwargs["root_path"] == expected_sibling
    assert kwargs["root_path"] != "/tmp/repo"

    # git_worktree_add 被调用，sibling/branch/base_ref 正确
    delegate.git_worktree_add.assert_awaited_once()
    wt_kwargs = delegate.git_worktree_add.call_args.kwargs
    assert wt_kwargs["sibling_path"] == expected_sibling
    assert wt_kwargs["branch"] == "workers/" + str(run.id)[:8]
    assert wt_kwargs["base_ref"] == "main"

    # AgentRun.worktree_branch 填值（converge 时读取）
    await db_session.refresh(run)
    assert run.worktree_branch == "workers/" + str(run.id)[:8]
    # dispatch 后 run.status 由 lease 推进，dispatch_worker 不在此改 status
    assert run.status == "pending"


# ---------------------------------------------------------------------------
# AC-02 base_ref 空（ws.default_branch=None）→ 兜底 "HEAD"
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_worker_base_ref_defaults_to_head_when_branch_none(
    db_session: AsyncSession,
) -> None:
    ws_id = await _make_workspace(db_session, root_path="/tmp/repo", default_branch=None)
    mission = AgentMission(workspace_id=ws_id, objective="o")
    db_session.add(mission)
    await db_session.commit()
    await db_session.refresh(mission)
    run = await _make_worker(db_session, mission_id=mission.id)

    delegate = _make_delegate_mock(ok=True, worktree_path="/tmp/repo/.worktrees/x")
    fake_placement = MagicMock()
    fake_placement.dispatch_to_daemon = AsyncMock(return_value=uuid.uuid4())
    svc = MissionExecutionService(db_session, placement=fake_placement, host_fs_delegate=delegate)

    await svc.dispatch_worker(run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=True)

    wt_kwargs = delegate.git_worktree_add.call_args.kwargs
    # X-001 空值兜底：default_branch None → base_ref="HEAD"
    assert wt_kwargs["base_ref"] == "HEAD"
    # placement branch 参数也应为 None（与既有语义一致，不因 worktree 改变 lease branch）
    placement_kwargs = fake_placement.dispatch_to_daemon.call_args.kwargs
    assert placement_kwargs["branch"] is None


# ---------------------------------------------------------------------------
# AC-03 git_worktree_add 失败 → run failed + return None + 不调 dispatch_to_daemon
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_worker_marks_run_failed_when_worktree_add_fails(
    db_session: AsyncSession,
) -> None:
    ws_id = await _make_workspace(db_session, root_path="/tmp/repo", default_branch="main")
    mission = AgentMission(workspace_id=ws_id, objective="o")
    db_session.add(mission)
    await db_session.commit()
    await db_session.refresh(mission)
    run = await _make_worker(db_session, mission_id=mission.id)

    delegate = _make_delegate_mock(ok=False, error="rpc unavailable")
    fake_placement = MagicMock()
    fake_placement.dispatch_to_daemon = AsyncMock(return_value=uuid.uuid4())
    svc = MissionExecutionService(db_session, placement=fake_placement, host_fs_delegate=delegate)

    lease_id = await svc.dispatch_worker(
        run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=False
    )

    # 失败：return None，不抛（主 agent 决策补派，design §9）
    assert lease_id is None
    # dispatch_to_daemon 绝不调用（worker 没拿到副本 cwd 就不该派 lease）
    fake_placement.dispatch_to_daemon.assert_not_awaited()
    # run 标 failed + worktree_branch 未填（无副本）
    await db_session.refresh(run)
    assert run.status == "failed"
    assert run.worktree_branch is None
    # 诊断 36b9b475：失败必须可观测——error_code + finished_at + output_redacted 全写，
    # 杜绝 failed run 无原因（worker 1c6b126f 即此 bug：failed 但 error_code/finished_at 空）。
    assert run.error_code == "worktree_create_failed"
    assert run.finished_at is not None
    assert run.output_redacted is not None
    assert "rpc unavailable" in (run.output_redacted or "")
    # ql-20260902-001：创建失败必须收残——git worktree add 被 timeout 杀掉时
    # 分支与 worktree 注册元数据已落而 run.worktree_branch 为 None，finalizer
    # 清理 SQL 永远漏掉它；此处断言 best-effort remove 连带删 workers/<id> 分支。
    delegate.git_worktree_remove.assert_awaited_once()
    _, remove_kwargs = delegate.git_worktree_remove.await_args
    assert remove_kwargs["sibling_path"] == f"/tmp/repo/.worktrees/{str(run.id)[:8]}"
    assert remove_kwargs["branch"] == f"workers/{str(run.id)[:8]}"


# ---------------------------------------------------------------------------
# AC-04 向后兼容：未注入 HostFsDelegate → 原行为（root_path=ws.root_path，不建 worktree）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_worker_without_delegate_keeps_legacy_root_path(
    db_session: AsyncSession,
) -> None:
    """未注入 delegate（single mode / 既有调用方未接线）→ 保留原行为。

    design §9 兼容策略：未配置 team 的既有 workspace 行为完全不变。
    生产接线（router/mcp_tools 传 delegate）由 task-05 完成。
    """
    ws_id = await _make_workspace(db_session, root_path="/tmp/repo", default_branch="main")
    mission = AgentMission(workspace_id=ws_id, objective="o")
    db_session.add(mission)
    await db_session.commit()
    await db_session.refresh(mission)
    run = await _make_worker(db_session, mission_id=mission.id)

    fake_placement = MagicMock()
    fake_placement.dispatch_to_daemon = AsyncMock(return_value=uuid.uuid4())
    # 不传 host_fs_delegate
    svc = MissionExecutionService(db_session, placement=fake_placement)

    lease_id = await svc.dispatch_worker(
        run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=True
    )

    assert lease_id is not None
    placement_kwargs = fake_placement.dispatch_to_daemon.call_args.kwargs
    # root_path 保持 ws.root_path（resolve_root_path_for_daemon 改写后的宿主机路径）
    assert placement_kwargs["root_path"] == "/tmp/repo"
    # worktree_branch 不填
    await db_session.refresh(run)
    assert run.worktree_branch is None


# ---------------------------------------------------------------------------
# AC-05 daemon 离线（dispatch_to_daemon 抛 NoOnlineDaemonError）→ execution 内部
# 统一收敛 failed + error_code=no_online_daemon + finished_at，不冒泡调用方
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_worker_marks_failed_when_daemon_offline(
    db_session: AsyncSession,
) -> None:
    """dispatch_to_daemon 抛 NoOnlineDaemonError → execution 内部捕获统一收敛。

    诊断 36b9b475：原 execution.dispatch_worker 不捕获 NoOnlineDaemonError，冒泡到
    mcp_tools（设 pending 语义错）/ router / bootstrap（吞异常不写 error_code），导致
    failed run 不可诊断 + mission 永不收敛。修复后 execution 内部对齐 service.py:531
    ``_mark_no_online_daemon``（failed + error_code + finished_at + output）。
    """
    from app.modules.agent.placement import NoOnlineDaemonError

    ws_id = await _make_workspace(db_session, root_path="/tmp/repo", default_branch="main")
    mission = AgentMission(workspace_id=ws_id, objective="o")
    db_session.add(mission)
    await db_session.commit()
    await db_session.refresh(mission)
    run = await _make_worker(db_session, mission_id=mission.id)

    fake_placement = MagicMock()
    fake_placement.dispatch_to_daemon = AsyncMock(
        side_effect=NoOnlineDaemonError(user_id=uuid.uuid4(), message="未检测到在线 daemon")
    )
    # 不注入 delegate：走兼容路径（root_path=ws.root_path），专注测 dispatch 失败收敛
    svc = MissionExecutionService(db_session, placement=fake_placement)

    lease_id = await svc.dispatch_worker(
        run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=False
    )

    assert lease_id is None
    await db_session.refresh(run)
    assert run.status == "failed"
    assert run.error_code == "no_online_daemon"
    assert run.finished_at is not None
    assert run.output_redacted is not None


# ---------------------------------------------------------------------------
# AC-06 dispatch_to_daemon 返回 None（runtime 派发瞬间离线的 race）→ failed
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_worker_marks_failed_when_dispatch_returns_none(
    db_session: AsyncSession,
) -> None:
    """dispatch_to_daemon 返回 None（resolve 后、claim 前 runtime 离线的 race）→
    failed + error_code=no_online_daemon，对齐 service.py:518 race 兜底。
    """
    ws_id = await _make_workspace(db_session, root_path="/tmp/repo", default_branch="main")
    mission = AgentMission(workspace_id=ws_id, objective="o")
    db_session.add(mission)
    await db_session.commit()
    await db_session.refresh(mission)
    run = await _make_worker(db_session, mission_id=mission.id)

    fake_placement = MagicMock()
    fake_placement.dispatch_to_daemon = AsyncMock(return_value=None)
    svc = MissionExecutionService(db_session, placement=fake_placement)

    lease_id = await svc.dispatch_worker(
        run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=False
    )

    assert lease_id is None
    await db_session.refresh(run)
    assert run.status == "failed"
    assert run.error_code == "no_online_daemon"
    assert run.finished_at is not None


# ---------------------------------------------------------------------------
# ql-20260831-007：default_branch 真实性探测兜底
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_worker_base_ref_falls_back_to_head_when_branch_missing(
    db_session: AsyncSession,
) -> None:
    """default_branch 在仓库不可解析（如建档缺省 'main' 而仓库用 master）→ 回退 HEAD。

    生产实证（crrcdt-hubin pmp-web-ui）：仓库无 main 分支，worktree add 报
    "fatal: Not a valid object name: 'main'"，run 标 worktree_create_failed
    连续 4 次断派发链。探测不可解析 → base_ref 改传 HEAD（当前 checkout 基准）。
    """
    ws_id = await _make_workspace(db_session, root_path="/tmp/repo", default_branch="main")
    mission = AgentMission(workspace_id=ws_id, objective="o")
    db_session.add(mission)
    await db_session.commit()
    await db_session.refresh(mission)
    run = await _make_worker(db_session, mission_id=mission.id)

    # rev-parse 'main' 不可解析（仓库实际无该分支）。
    delegate = _make_delegate_mock(
        ok=True, worktree_path="/tmp/repo/.worktrees/abcd1234", rev_parse_commit=None
    )
    fake_placement = MagicMock()
    fake_placement.dispatch_to_daemon = AsyncMock(return_value=uuid.uuid4())
    svc = MissionExecutionService(db_session, placement=fake_placement, host_fs_delegate=delegate)

    lease_id = await svc.dispatch_worker(
        run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=False
    )

    assert lease_id is not None
    delegate.git_worktree_add.assert_awaited_once()
    wt_kwargs = delegate.git_worktree_add.call_args.kwargs
    assert wt_kwargs["base_ref"] == "HEAD"
    # 探测调用本身携带原 default_branch（可观测性：日志与 mock 双证）。
    rev_kwargs = delegate.git_rev_parse.call_args.kwargs
    assert rev_kwargs["ref"] == "main"


@pytest.mark.asyncio
async def test_dispatch_worker_base_ref_falls_back_to_head_when_probe_raises(
    db_session: AsyncSession,
) -> None:
    """探测异常（RPC 抛错，防御路径）→ 同样回退 HEAD，不阻断派发。"""
    ws_id = await _make_workspace(db_session, root_path="/tmp/repo", default_branch="main")
    mission = AgentMission(workspace_id=ws_id, objective="o")
    db_session.add(mission)
    await db_session.commit()
    await db_session.refresh(mission)
    run = await _make_worker(db_session, mission_id=mission.id)

    delegate = _make_delegate_mock(ok=True, worktree_path="/tmp/repo/.worktrees/abcd1234")
    delegate.git_rev_parse = AsyncMock(side_effect=RuntimeError("rpc boom"))
    fake_placement = MagicMock()
    fake_placement.dispatch_to_daemon = AsyncMock(return_value=uuid.uuid4())
    svc = MissionExecutionService(db_session, placement=fake_placement, host_fs_delegate=delegate)

    lease_id = await svc.dispatch_worker(
        run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=False
    )

    assert lease_id is not None
    delegate.git_worktree_add.assert_awaited_once()
    wt_kwargs = delegate.git_worktree_add.call_args.kwargs
    assert wt_kwargs["base_ref"] == "HEAD"


@pytest.mark.asyncio
async def test_dispatch_worker_base_ref_keeps_configured_branch_when_resolvable(
    db_session: AsyncSession,
) -> None:
    """default_branch 可解析 → 配置照常生效（存在时行为零变化）。"""
    ws_id = await _make_workspace(db_session, root_path="/tmp/repo", default_branch="release")
    mission = AgentMission(workspace_id=ws_id, objective="o")
    db_session.add(mission)
    await db_session.commit()
    await db_session.refresh(mission)
    run = await _make_worker(db_session, mission_id=mission.id)

    delegate = _make_delegate_mock(
        ok=True, worktree_path="/tmp/repo/.worktrees/abcd1234", rev_parse_commit="sha-xyz"
    )
    fake_placement = MagicMock()
    fake_placement.dispatch_to_daemon = AsyncMock(return_value=uuid.uuid4())
    svc = MissionExecutionService(db_session, placement=fake_placement, host_fs_delegate=delegate)

    lease_id = await svc.dispatch_worker(
        run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=False
    )

    assert lease_id is not None
    wt_kwargs = delegate.git_worktree_add.call_args.kwargs
    assert wt_kwargs["base_ref"] == "release"
