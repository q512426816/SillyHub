"""Tests for placement target_provider — profile.provider 优先（task-05 / D-014）。

Change ``2026-08-02-agent-profile-layer`` task-05 / design §5（dispatch 数据流）+
D-014（target_provider 不反向选 daemon）。

覆盖：
  - ``dispatch_to_daemon(agent_profile_id=...)``：profile.provider 优先作 target_provider，
    匹配 daemon 上对应 provider 的 runtime（而非 workspace.default_agent 指向的 runtime）。
  - profile=None：target_provider 回退 caller provider → workspace.default_agent，
    行为与今天一致。
  - **C-07 null 路径零新增查询**：agent_profile_id 为空时，dispatch 不发任何查
    ``agent_profiles`` 表的 SQL（断言 SQL 捕获）。
  - provider 归一化：profile.provider='claude_code' 归一为 'claude'，匹配 daemon 上
    provider='claude' 的 runtime。
  - profile 被删 / 不存在：回退 workspace.default_agent，不阻断 dispatch。

测试范式照抄 ``test_dispatch_metadata.py`` / ``test_borrow_resolver.py``：hermetic
per-test SQLite（``db_session`` fixture），手工 seed user/daemon/runtime/workspace/
binding。binding（workspace×user→daemon_id）仍是 daemon 选择的唯一真相源——profile.provider
只影响 runtime 匹配，不改 daemon 选择顺序（D-014）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentRun
from app.modules.agent.placement import RunPlacementService
from app.modules.agent.profile.model import AgentProfile, AgentProfileVisibility
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease
from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime
from app.modules.workspace.model import Workspace

pytestmark = pytest.mark.asyncio


# ────────────────────────────────────────────────────────────────────────────
# Seed helpers（自包含，每 test 独立 db_session）
# ────────────────────────────────────────────────────────────────────────────


async def _seed_user(session: AsyncSession, *, is_platform_admin: bool = False) -> uuid.UUID:
    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"u-{uid.hex[:8]}@example.com",
            password_hash="x",
            display_name="U",
            status="active",
            is_platform_admin=is_platform_admin,
        )
    )
    await session.commit()
    return uid


async def _seed_daemon(
    session: AsyncSession, *, owner_id: uuid.UUID, status: str = "online"
) -> DaemonInstance:
    di = DaemonInstance(
        id=uuid.uuid4(),
        user_id=owner_id,
        hostname="host-" + uuid.uuid4().hex[:6],
        server_url="http://test.local",
        status=status,
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(di)
    await session.commit()
    await session.refresh(di)
    return di


async def _seed_runtime(
    session: AsyncSession,
    *,
    daemon_id: uuid.UUID,
    owner_id: uuid.UUID,
    provider: str,
) -> DaemonRuntime:
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        daemon_instance_id=daemon_id,
        user_id=owner_id,
        provider=provider,
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.commit()
    await session.refresh(rt)
    return rt


async def _seed_workspace(
    session: AsyncSession, *, owner_id: uuid.UUID, default_agent: str
) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="W-" + uuid.uuid4().hex[:6],
        slug="slug-" + uuid.uuid4().hex[:8],
        root_path="/tmp/" + uuid.uuid4().hex[:8],
        default_agent=default_agent,
        status="active",
        created_by=owner_id,
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _seed_binding(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    user_id: uuid.UUID,
    daemon_id: uuid.UUID,
) -> None:
    session.add(
        WorkspaceMemberRuntime(
            workspace_id=workspace_id,
            user_id=user_id,
            daemon_id=daemon_id,
            root_path="/tmp/binding",
            path_source="daemon_client",
        )
    )
    await session.commit()


async def _seed_agent_run(session: AsyncSession) -> AgentRun:
    run = AgentRun(id=uuid.uuid4(), agent_type="claude_code", status="pending")
    session.add(run)
    await session.commit()
    await session.refresh(run)
    return run


async def _seed_profile(
    session: AsyncSession,
    *,
    owner_id: uuid.UUID,
    provider: str,
    name: str | None = None,
) -> AgentProfile:
    """种一个 private 可见档案（visibility 校验在 task-06 绑定时做，此处仅 provider 生效）。"""
    profile = AgentProfile(
        id=uuid.uuid4(),
        name=name or f"P-{uuid.uuid4().hex[:6]}",
        owner_user_id=owner_id,
        visibility=AgentProfileVisibility.PRIVATE,
        provider=provider,
    )
    session.add(profile)
    await session.commit()
    await session.refresh(profile)
    return profile


async def _bootstrap(
    session: AsyncSession,
    *,
    default_agent: str = "claude",
    runtime_providers: tuple[str, ...] = ("claude",),
) -> tuple[uuid.UUID, uuid.UUID, DaemonInstance, dict[str, DaemonRuntime]]:
    """搭完整 daemon-client dispatch 栈：user + daemon_instance + N runtime +
    workspace(default_agent) + member binding。

    Returns:
        (workspace_id, user_id, daemon_instance, {provider: runtime})。
    """
    user_id = await _seed_user(session)
    di = await _seed_daemon(session, owner_id=user_id, status="online")
    runtimes: dict[str, DaemonRuntime] = {}
    for prov in runtime_providers:
        rt = await _seed_runtime(session, daemon_id=di.id, owner_id=user_id, provider=prov)
        runtimes[prov] = rt
    ws = await _seed_workspace(session, owner_id=user_id, default_agent=default_agent)
    await _seed_binding(session, workspace_id=ws.id, user_id=user_id, daemon_id=di.id)
    return ws.id, user_id, di, runtimes


async def _lease_runtime_id(session: AsyncSession, lease_id: uuid.UUID) -> uuid.UUID:
    lease = await session.get(DaemonTaskLease, lease_id)
    assert lease is not None
    assert lease.runtime_id is not None
    return lease.runtime_id


# ────────────────────────────────────────────────────────────────────────────
# profile.provider 优先匹配对应 runtime（D-014 核心契约）
# ────────────────────────────────────────────────────────────────────────────


async def test_profile_provider_matches_profile_runtime_not_default(db_session) -> None:
    """profile.provider='codex' 优先于 workspace.default_agent='claude'：
    dispatch 命中 codex runtime（而非 default_agent 指向的 claude runtime）。

    证明 profile.provider 只影响 runtime 匹配，不改 daemon 选择（同一 daemon 上两个
    runtime，binding 仍指向这台 daemon，D-014 不变量）。
    """
    ws_id, user_id, _di, runtimes = await _bootstrap(
        db_session, default_agent="claude", runtime_providers=("claude", "codex")
    )
    profile = await _seed_profile(db_session, owner_id=user_id, provider="codex")
    run = await _seed_agent_run(db_session)

    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(
        run.id, user_id, workspace_id=ws_id, agent_profile_id=profile.id
    )

    assert lease_id is not None
    matched_rt = await _lease_runtime_id(db_session, lease_id)
    # 命中 codex runtime（profile.provider 驱动），不是 claude（default_agent）。
    assert matched_rt == runtimes["codex"].id
    assert matched_rt != runtimes["claude"].id


async def test_profile_provider_claude_matches_claude_runtime(db_session) -> None:
    """profile.provider='claude' + default_agent='codex'：命中 claude runtime。"""
    ws_id, user_id, _di, runtimes = await _bootstrap(
        db_session, default_agent="codex", runtime_providers=("claude", "codex")
    )
    profile = await _seed_profile(db_session, owner_id=user_id, provider="claude")
    run = await _seed_agent_run(db_session)

    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(
        run.id, user_id, workspace_id=ws_id, agent_profile_id=profile.id
    )

    assert lease_id is not None
    matched_rt = await _lease_runtime_id(db_session, lease_id)
    assert matched_rt == runtimes["claude"].id


# ────────────────────────────────────────────────────────────────────────────
# profile=None 回退 workspace.default_agent（行为同今天）
# ────────────────────────────────────────────────────────────────────────────


async def test_no_profile_falls_back_to_default_agent(db_session) -> None:
    """agent_profile_id=None：target_provider 回退 workspace.default_agent='claude'，
    命中 claude runtime（与今天行为一致）。"""
    ws_id, user_id, _di, runtimes = await _bootstrap(
        db_session, default_agent="claude", runtime_providers=("claude", "codex")
    )
    run = await _seed_agent_run(db_session)

    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(
        run.id, user_id, workspace_id=ws_id, agent_profile_id=None
    )

    assert lease_id is not None
    matched_rt = await _lease_runtime_id(db_session, lease_id)
    assert matched_rt == runtimes["claude"].id


async def test_no_profile_backward_compatible_no_arg(db_session) -> None:
    """不传 agent_profile_id（默认 None）：与今天调用完全兼容，dispatch 成功。"""
    ws_id, user_id, _di, _runtimes = await _bootstrap(
        db_session, default_agent="claude", runtime_providers=("claude",)
    )
    run = await _seed_agent_run(db_session)

    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(run.id, user_id, workspace_id=ws_id)

    assert lease_id is not None


# ────────────────────────────────────────────────────────────────────────────
# C-07：null 路径零新增查询（断言不发 agent_profiles SQL）
# ────────────────────────────────────────────────────────────────────────────


class _SqlRecorder:
    """包装 AsyncSession.execute，记录每条 SQL 文本（含参数已绑定的字面串）。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._orig = session.execute
        self.statements: list[str] = []

    def install(self) -> None:
        recorder = self

        async def _wrapped(stmt: Any, *args: Any, **kwargs: Any) -> Any:
            try:
                recorder.statements.append(str(stmt))
            except Exception:
                recorder.statements.append("")
            return await recorder._orig(stmt, *args, **kwargs)

        self._session.execute = _wrapped

    @property
    def agent_profile_queries(self) -> list[str]:
        return [s for s in self.statements if "agent_profiles" in s]


async def test_null_path_zero_agent_profile_queries(db_session) -> None:
    """C-07：agent_profile_id=None 时，dispatch 全程不发任何查 agent_profiles 表的 SQL。

    用 SQL 捕获断言——null 路径与今天 100% 一致（零新增查询，保护 PPM 已上线模块）。
    """
    ws_id, user_id, _di, _runtimes = await _bootstrap(
        db_session, default_agent="claude", runtime_providers=("claude",)
    )
    run = await _seed_agent_run(db_session)

    recorder = _SqlRecorder(db_session)
    recorder.install()

    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(
        run.id, user_id, workspace_id=ws_id, agent_profile_id=None
    )

    assert lease_id is not None
    # 核心断言：null 路径不发任何 agent_profiles 查询。
    assert recorder.agent_profile_queries == []


async def test_profile_path_emits_one_agent_profile_query(db_session) -> None:
    """对照：agent_profile_id 非空时，发且仅发一条 agent_profiles 查询（取 provider）。"""
    ws_id, user_id, _di, _runtimes = await _bootstrap(
        db_session, default_agent="claude", runtime_providers=("claude",)
    )
    profile = await _seed_profile(db_session, owner_id=user_id, provider="claude")
    run = await _seed_agent_run(db_session)

    recorder = _SqlRecorder(db_session)
    recorder.install()

    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(
        run.id, user_id, workspace_id=ws_id, agent_profile_id=profile.id
    )

    assert lease_id is not None
    # 非空路径发且仅发一条 agent_profiles 查询（_resolve_profile_provider 单次取 provider）。
    assert len(recorder.agent_profile_queries) == 1


# ────────────────────────────────────────────────────────────────────────────
# provider 归一化（_normalize_provider）
# ────────────────────────────────────────────────────────────────────────────


async def test_profile_provider_normalized_claude_code_to_claude(db_session) -> None:
    """profile.provider='claude_code'（agent_type 误写）归一为 'claude'，匹配 daemon 上
    provider='claude' 的 runtime（daemon 上永不启用 'claude_code'，见 orchestrator.py:38）。

    daemon runtime 用规范值 'claude' seed；profile 写 'claude_code'，归一后命中。
    """
    ws_id, user_id, _di, runtimes = await _bootstrap(
        db_session, default_agent="codex", runtime_providers=("claude", "codex")
    )
    # profile 写 agent_type 形式 'claude_code'，default_agent='codex'（不同）。
    profile = await _seed_profile(db_session, owner_id=user_id, provider="claude_code")
    run = await _seed_agent_run(db_session)

    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(
        run.id, user_id, workspace_id=ws_id, agent_profile_id=profile.id
    )

    assert lease_id is not None
    matched_rt = await _lease_runtime_id(db_session, lease_id)
    # 归一后 'claude_code' → 'claude'，命中 claude runtime（而非 default_agent=codex）。
    assert matched_rt == runtimes["claude"].id


# ────────────────────────────────────────────────────────────────────────────
# profile 被删 / 不存在 → 回退 workspace.default_agent（软约束不阻断）
# ────────────────────────────────────────────────────────────────────────────


async def test_deleted_profile_falls_back_to_default_agent(db_session) -> None:
    """agent_profile_id 指向已删档案：_resolve_profile_provider 返回 None → 回退
    workspace.default_agent='claude'，dispatch 不阻断（design §8 软约束）。"""
    ws_id, user_id, _di, runtimes = await _bootstrap(
        db_session, default_agent="claude", runtime_providers=("claude", "codex")
    )
    ghost_id = uuid.uuid4()  # 不存在
    run = await _seed_agent_run(db_session)

    placement = RunPlacementService(db_session)
    lease_id = await placement.dispatch_to_daemon(
        run.id, user_id, workspace_id=ws_id, agent_profile_id=ghost_id
    )

    assert lease_id is not None
    matched_rt = await _lease_runtime_id(db_session, lease_id)
    # 回退 default_agent='claude'。
    assert matched_rt == runtimes["claude"].id


# ────────────────────────────────────────────────────────────────────────────
# profile.provider 无匹配 runtime → NoOnlineDaemonError（不反向选 daemon，D-014）
# ────────────────────────────────────────────────────────────────────────────


async def test_profile_provider_no_matching_runtime_raises(db_session) -> None:
    """profile.provider='codex' 但 daemon 上只有 claude runtime：不反向选别的 daemon /
    不静默回退 default_agent——抛 NoOnlineDaemonError（D-014：binding 是唯一真相源，
    profile.provider 只影响 runtime 匹配，匹配不上即报错指引用户配置）。"""
    from app.modules.agent.placement import NoOnlineDaemonError

    ws_id, user_id, _di, _runtimes = await _bootstrap(
        db_session, default_agent="claude", runtime_providers=("claude",)
    )
    profile = await _seed_profile(db_session, owner_id=user_id, provider="codex")
    run = await _seed_agent_run(db_session)

    placement = RunPlacementService(db_session)
    with pytest.raises(NoOnlineDaemonError):
        await placement.dispatch_to_daemon(
            run.id, user_id, workspace_id=ws_id, agent_profile_id=profile.id
        )
