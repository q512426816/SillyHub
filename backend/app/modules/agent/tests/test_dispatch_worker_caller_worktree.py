"""dispatch_worker caller-worktree 路径A 单测（task-08）。

change ``2026-08-08-dispatch-worker-caller-worktree`` task-08 / D-001@v1 /
D-008@v1 / D-009@v1 / FR-01/02/03/10：

- **AC-01 路径A 分支**：caller（SillySpec execute）传 ``worktree_path`` →
  ``MissionExecutionService.dispatch_worker`` **跳过** ``git_worktree_add`` 自建
  （``and not worktree_path`` 短路），caller worktree 直接作 daemon ``root_path``
  / worker cwd（``root_path != ws.root_path``）；caller ``worker_prompt`` 完全替代
  ``render_worker_prompt``（D-001 方案A）；caller ``branch`` 仅入 lease metadata
  透传 ``dispatch_to_daemon``（D-009 字段名对齐跨仓契约）；路径A **不写**
  ``run.worktree_branch``（D-008 双保险：该列是 team converge finalize merge 触发
  字段，路径A 保持 None 防误 merge 污染 caller 主仓，R-01 防御②）。
- **AC-01 回归对照**：不传三参（None）+ 注入 delegate → 原 team 模式自建 worktree
  路径不变（``git_worktree_add assert_awaited_once`` + ``run.worktree_branch`` 填值），
  确认 ``and not worktree_path`` 短路是真分叉（design §9 零回归）。
- **AC-03 mcp_gateway 入口透传**（链路B）：``tools.dispatch_worker`` 三参原样透传
  ``execution.dispatch_worker``（design §7.3 / R-06）；用 monkeypatch spy 验透传，
  不真起 daemon/worktree。

fixture 复刻自：
- ``test_dispatch_worker_worktree.py``：``_make_workspace``（含 default_branch /
  default_agent，execution 构造所需）+ ``_make_worker`` + ``_make_delegate_mock``
  （HostFsDelegate MagicMock，``git_worktree_add`` AsyncMock）+
  ``MissionExecutionService(db_session, placement=fake_placement, host_fs_delegate=delegate)``。
- ``test_tools_new.py``：``_make_ctx``（FastMCP Context + mcp_auth state）+
  ``_make_token`` + ``_make_user`` + ``_auth``（scope=[MCP_SCOPE_DISPATCH]）。
"""

from __future__ import annotations

import uuid
from typing import Any, cast
from unittest.mock import AsyncMock, MagicMock

import pytest
from mcp.server.fastmcp import Context
from mcp.shared.context import RequestContext
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.requests import Request

from app.core.security import password_hasher
from app.modules.agent.execution import MissionExecutionService
from app.modules.agent.model import AgentMission, AgentRun
from app.modules.auth.model import User
from app.modules.mcp_gateway import tools
from app.modules.mcp_gateway.auth import (
    MCP_AUTH_STATE_KEY,
    MCP_SCOPE_DISPATCH,
    McpAuthContext,
)
from app.modules.mcp_gateway.model import McpTokenORM
from app.modules.workspace.model import Workspace

# ── execution-level helpers（复刻 test_dispatch_worker_worktree.py）─────────────


async def _make_workspace(
    session: AsyncSession,
    *,
    root_path: str = "/tmp/repo",
    default_branch: str | None = "main",
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
        role="worker",
        objective="do path A work",
    )
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


def _make_delegate_mock(*, ok: bool, worktree_path: str | None = None, error: str | None = None):
    """Build a fake HostFsDelegate with git_worktree_add as a recording AsyncMock."""
    delegate = MagicMock()
    delegate.git_worktree_add = AsyncMock(
        return_value={
            "ok": ok,
            "worktree_path": worktree_path,
            "error": error,
        }
    )
    return delegate


# ── mcp_gateway-level helpers（复刻 test_tools_new.py）─────────────────────────


def _make_ctx(auth: McpAuthContext) -> Context:
    """构造带 mcp_auth 的 FastMCP Context（对齐 task-03 middleware 注入键）。"""
    req = Request({"type": "http", "headers": []})
    setattr(req.state, MCP_AUTH_STATE_KEY, auth)
    rc = RequestContext(
        request_id=1,
        meta=None,
        session=cast(Any, None),
        lifespan_context=cast(Any, None),
        request=req,
    )
    return Context(request_context=rc)


async def _make_mcp_workspace(session: AsyncSession) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"ws-{uuid.uuid4().hex[:6]}",
        root_path=f"/tmp/ws-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _make_user(session: AsyncSession) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"user-{uuid.uuid4().hex[:6]}@example.com",
        password_hash=password_hasher.hash("x"),
        status="active",
        is_platform_admin=False,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _make_token(
    session: AsyncSession, *, workspace_id: uuid.UUID, created_by: uuid.UUID, scope: list[str]
) -> McpTokenORM:
    token = McpTokenORM(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        name="ci",
        token_hash=f"hash-{uuid.uuid4().hex}",
        scope=scope,
        created_by=created_by,
    )
    session.add(token)
    await session.commit()
    await session.refresh(token)
    return token


def _auth(token: McpTokenORM, scope: frozenset[str]) -> McpAuthContext:
    return McpAuthContext(workspace_id=token.workspace_id, scope=scope, token_id=token.id)


# ════════════════════════════════════════════════════════════════════════════
# AC-01 路径A：caller 传 worktree_path → 跳过自建 + root_path 透传 +
#              worker_prompt 覆写 + 不写 run.worktree_branch（D-008）
# ════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_dispatch_worker_caller_worktree_skips_self_create_and_passes_through(
    db_session: AsyncSession,
) -> None:
    """路径A：caller 传 worktree_path → 跳过 git_worktree_add + root_path=worktree_path
    + worker_prompt 完全替代 render + branch 入 lease metadata + 不写 run.worktree_branch。

    覆盖 design §7.2（dispatch_worker 新签名）+ §7.4（worker_prompt 覆写）+ §11 D-008
    （路径A 不写 worktree_branch，R-01 防御②）+ D-009（字段名 branch）。
    """
    ws_id = await _make_workspace(db_session, root_path="/tmp/repo", default_branch="main")
    mission = AgentMission(workspace_id=ws_id, objective="o")
    db_session.add(mission)
    await db_session.commit()
    await db_session.refresh(mission)
    run = await _make_worker(db_session, mission_id=mission.id)

    delegate = _make_delegate_mock(ok=True, worktree_path="/tmp/repo/.worktrees/ignored")
    fake_placement = MagicMock()
    fake_placement.dispatch_to_daemon = AsyncMock(return_value=uuid.uuid4())
    svc = MissionExecutionService(db_session, placement=fake_placement, host_fs_delegate=delegate)

    caller_worktree_path = "/tmp/repo/.sillyspec/.runtime/worktrees/abc12345"
    caller_branch = "sillyspec/2026-08-08-x"
    caller_worker_prompt = "绝不 commit 不越界 allowedPaths 内"
    lease_id = await svc.dispatch_worker(
        run,
        workspace_id=ws_id,
        user_id=uuid.uuid4(),
        read_only=False,
        worktree_path=caller_worktree_path,
        branch=caller_branch,
        worker_prompt=caller_worker_prompt,
    )

    # 路径A 短路（execution.py:221 ``and not worktree_path``）：caller 已提供 worktree，
    # 绝不调 git_worktree_add（R-01 防御③：worker_prompt 不 commit + 不建副本）。
    assert lease_id is not None
    delegate.git_worktree_add.assert_not_awaited()

    # dispatch_to_daemon 的 root_path = caller worktree（≠ ws.root_path）。
    fake_placement.dispatch_to_daemon.assert_awaited_once()
    kwargs = fake_placement.dispatch_to_daemon.call_args.kwargs
    assert kwargs["root_path"] == caller_worktree_path
    assert kwargs["root_path"] != "/tmp/repo"

    # D-001 方案A：worker_prompt 完全替代 render_worker_prompt（原 render 含
    # ``git add -A && git commit`` 协作约束，绝不会产出此 caller 文本）。
    assert kwargs["prompt"] == caller_worker_prompt

    # D-009：caller branch 透传 lease metadata（dispatch_to_daemon branch=）；⚠️ 不绑死
    # kwarg 名之外的字段，仅断言 caller 传入的 branch 原值进了 placement 调用。
    assert kwargs["branch"] == caller_branch

    # D-008 红线：路径A 不写 run.worktree_branch（保持 None，防 converge finalize 误
    # merge 污染 caller 主仓，R-01 防御②）。
    await db_session.refresh(run)
    assert run.worktree_branch is None
    # dispatch 后 status 仍 pending（lease 推进由 daemon claim 负责，dispatch_worker 不改）。
    assert run.status == "pending"


# ════════════════════════════════════════════════════════════════════════════
# AC-01 回归对照：不传 worktree_path（None）+ 注入 delegate → 原自建 worktree 路径
# 不变（git_worktree_add 调一次 + run.worktree_branch 填值），确认短路是真分叉。
# ════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_dispatch_worker_without_worktree_path_still_self_creates_worktree(
    db_session: AsyncSession,
) -> None:
    """回归对照：三参默认 None + 注入 delegate → 原 team 模式自建 worktree 路径不变。

    确认 ``and not worktree_path`` 短路只在 caller 传 worktree_path 时分叉；None 走
    原自建（git_worktree_add 调用一次 + 填 run.worktree_branch，对齐
    ``test_dispatch_worker_worktree`` AC-01）。design §9 零回归。
    """
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

    # 不传 worktree_path/branch/worker_prompt → 走原 team 模式自建逻辑。
    lease_id = await svc.dispatch_worker(
        run, workspace_id=ws_id, user_id=uuid.uuid4(), read_only=False
    )

    assert lease_id is not None
    # 自建路径：git_worktree_add 调用一次（与上面路径A 的 assert_not_awaited 形成对照）。
    delegate.git_worktree_add.assert_awaited_once()
    # run.worktree_branch 填值（team 模式 converge finalize 读此列触发 merge）。
    await db_session.refresh(run)
    assert run.worktree_branch is not None
    assert run.worktree_branch == "workers/" + str(run.id)[:8]
    # root_path 走 sibling 副本（非 ws.root_path）。
    placement_kwargs = fake_placement.dispatch_to_daemon.call_args.kwargs
    assert placement_kwargs["root_path"] != "/tmp/repo"


# ════════════════════════════════════════════════════════════════════════════
# AC-03 mcp_gateway 入口透传（链路B）：tools.dispatch_worker 三参原样透传
#              execution.dispatch_worker（不真起 daemon/worktree，monkeypatch spy 验）
# ════════════════════════════════════════════════════════════════════════════


@pytest.mark.asyncio
async def test_mcp_dispatch_worker_passes_through_caller_worktree_params(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """AC-03：mcp_gateway tools.dispatch_worker 把 worktree_path/branch/worker_prompt
    三参原样透传 execution.dispatch_worker（design §7.3 / R-06 两入口同构）。

    用 monkeypatch 把 ``MissionExecutionService.dispatch_worker`` 替成 AsyncMock spy，
    替换后既不走真 daemon 也不建真 worktree；只验入口透传契约（spy 收到三键原值）。
    """
    ws = await _make_mcp_workspace(db_session)
    user = await _make_user(db_session)
    mission = AgentMission(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        objective="o",
    )
    db_session.add(mission)
    await db_session.commit()
    await db_session.refresh(mission)

    token = await _make_token(
        db_session, workspace_id=ws.id, created_by=user.id, scope=[MCP_SCOPE_DISPATCH]
    )
    ctx = _make_ctx(_auth(token, frozenset({MCP_SCOPE_DISPATCH})))

    # spy 替真 dispatch_worker：返回一个 lease id（不被 tools 用于响应体，仅避免
    # mark_worker_run_failed 兜底）。替换后 tools.dispatch_worker 内部的
    # ``new_host_fs_delegate(session)`` 仍构造（无 I/O，仅建 Python 对象），但 delegate
    # 任何方法都不被调（spy 接管 exec_svc.dispatch_worker）。
    spy_dispatch_worker = AsyncMock(return_value=uuid.uuid4())
    monkeypatch.setattr(MissionExecutionService, "dispatch_worker", spy_dispatch_worker)

    result = await tools.dispatch_worker(
        mission_id=mission.id,
        objective="o",
        worktree_path="/tmp/wt",
        branch="sillyspec/x",
        worker_prompt="不 commit",
        ctx=ctx,
    )

    # 入口正常返回响应体（run 已落 + spy 接管，无 daemon 异常）。
    assert result["id"]
    # spy 被 awaited 一次（can_dispatch_worker 默认放行 fresh mission → 走到 exec）。
    spy_dispatch_worker.assert_awaited_once()
    kwargs = spy_dispatch_worker.call_args.kwargs
    # 三参原样透传 execution.dispatch_worker（字段名 branch 对齐跨仓契约 D-009）。
    assert kwargs["worktree_path"] == "/tmp/wt"
    assert kwargs["branch"] == "sillyspec/x"
    assert kwargs["worker_prompt"] == "不 commit"
