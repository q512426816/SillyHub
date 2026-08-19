"""Tests for placement representative_fallback flag (task-03).

Covers change 2026-08-19-cross-workspace-team-mission task-03 acceptance：
- AC-01: 旗标开调代表查询（resolve_representative_binding 被调用）。
- AC-02: owner 优先（resolve_representative_binding 返回 owner runtime）。
- AC-03: 任意在线兜底（owner 无在线，返回任意 member runtime）。
- AC-04: 全离线抛 NoOnlineDaemonError（无在线 binding，抛错带 no_binding_for_workspace 语义）。
- AC-05: 旗标关走 borrow 不变（调用原 _resolve_borrowed_or_own_runtime 链，零回归）。

测试策略：用 monkeypatch mock resolve_representative_binding 与
_resolve_borrowed_or_own_runtime，聚焦 placement 分支逻辑验证，不依赖真实 binding 数据。
"""

from __future__ import annotations

import uuid
from unittest.mock import AsyncMock

import pytest

from app.modules.agent.placement import NoOnlineDaemonError, RunPlacementService

# ---- helpers -----------------------------------------------------------------


def _fake_runtime_dict(
    runtime_id: uuid.UUID,
    user_id: uuid.UUID,
    provider: str,
) -> dict:
    """构造与 query_runtime_by_daemon_and_provider 同 shape 的 runtime dict。"""
    return {
        "id": runtime_id,
        "user_id": user_id,
        "provider": provider,
        "status": "online",
        "daemon_instance_id": uuid.uuid4(),
    }


# ---- AC-01: 旗标开调代表查询 -------------------------------------------------


@pytest.mark.asyncio
async def test_representative_fallback_calls_resolve_function(db_session, monkeypatch):
    """旗标=True 时调用 resolve_representative_binding（代表查询函数被调用）。"""
    workspace_id = uuid.uuid4()
    user_id = uuid.uuid4()
    provider = "claude"
    runtime_id = uuid.uuid4()

    # mock resolve_representative_binding 返回代表 runtime
    fake_repr = AsyncMock(return_value=_fake_runtime_dict(runtime_id, user_id, provider))
    monkeypatch.setattr(
        "app.modules.workspace.member_runtimes.queries.resolve_representative_binding",
        fake_repr,
    )

    # mock MemberBindingResolver 返回 None（本人无 binding）
    from app.modules.workspace.member_runtimes.resolver import MemberBindingResolver

    fake_binding = AsyncMock(return_value=None)
    monkeypatch.setattr(MemberBindingResolver, "resolve_member_binding_or_none", fake_binding)

    # mock resolve_profile_provider 返回 None（不走 profile）
    svc = RunPlacementService(db_session)
    fake_profile = AsyncMock(return_value=None)
    monkeypatch.setattr(svc, "_resolve_profile_provider", fake_profile)

    # mock resolve_workspace_default_agent 返回 provider
    fake_workspace = AsyncMock(return_value=provider)
    monkeypatch.setattr(svc, "_resolve_workspace_default_agent", fake_workspace)

    # 调用 _resolve_dispatch_runtime，旗标=True
    rt = await svc._resolve_dispatch_runtime(
        workspace_id=workspace_id,
        user_id=user_id,
        provider=provider,
        representative_fallback=True,
    )

    # 验证：resolve_representative_binding 被调用且返回 runtime
    fake_repr.assert_called_once()
    assert rt is not None
    assert rt["id"] == runtime_id
    assert rt["provider"] == provider


# ---- AC-02: owner 优先 -------------------------------------------------------


@pytest.mark.asyncio
async def test_representative_owner_priority_hit(db_session, monkeypatch):
    """owner 优先：resolve_representative_binding 返回 owner runtime（owner 在线）。"""
    workspace_id = uuid.uuid4()
    owner_id = uuid.uuid4()
    provider = "claude"
    runtime_id = uuid.uuid4()

    # mock resolve_representative_binding 返回 owner runtime（user_id = owner）
    fake_repr = AsyncMock(return_value=_fake_runtime_dict(runtime_id, owner_id, provider))
    monkeypatch.setattr(
        "app.modules.workspace.member_runtimes.queries.resolve_representative_binding",
        fake_repr,
    )

    # mock 本人无 binding
    from app.modules.workspace.member_runtimes.resolver import MemberBindingResolver

    fake_binding = AsyncMock(return_value=None)
    monkeypatch.setattr(MemberBindingResolver, "resolve_member_binding_or_none", fake_binding)

    svc = RunPlacementService(db_session)
    fake_profile = AsyncMock(return_value=None)
    monkeypatch.setattr(svc, "_resolve_profile_provider", fake_profile)
    fake_workspace = AsyncMock(return_value=provider)
    monkeypatch.setattr(svc, "_resolve_workspace_default_agent", fake_workspace)

    rt = await svc._resolve_dispatch_runtime(
        workspace_id=workspace_id,
        user_id=owner_id,
        provider=provider,
        representative_fallback=True,
    )

    assert rt is not None
    assert rt["id"] == runtime_id
    assert rt["user_id"] == owner_id  # owner 优先实证


# ---- AC-03: 任意在线兜底 -----------------------------------------------------


@pytest.mark.asyncio
async def test_representative_any_online_fallback(db_session, monkeypatch):
    """任意在线兜底：owner 无在线，resolve_representative_binding 返回任意 member runtime。"""
    workspace_id = uuid.uuid4()
    owner_id = uuid.uuid4()
    other_member_id = uuid.uuid4()
    provider = "claude"
    runtime_id = uuid.uuid4()

    # mock 返回非 owner 的 member runtime
    fake_repr = AsyncMock(return_value=_fake_runtime_dict(runtime_id, other_member_id, provider))
    monkeypatch.setattr(
        "app.modules.workspace.member_runtimes.queries.resolve_representative_binding",
        fake_repr,
    )

    from app.modules.workspace.member_runtimes.resolver import MemberBindingResolver

    fake_binding = AsyncMock(return_value=None)
    monkeypatch.setattr(MemberBindingResolver, "resolve_member_binding_or_none", fake_binding)

    svc = RunPlacementService(db_session)
    fake_profile = AsyncMock(return_value=None)
    monkeypatch.setattr(svc, "_resolve_profile_provider", fake_profile)
    fake_workspace = AsyncMock(return_value=provider)
    monkeypatch.setattr(svc, "_resolve_workspace_default_agent", fake_workspace)

    rt = await svc._resolve_dispatch_runtime(
        workspace_id=workspace_id,
        user_id=owner_id,
        provider=provider,
        representative_fallback=True,
    )

    assert rt is not None
    assert rt["id"] == runtime_id
    assert rt["user_id"] == other_member_id  # 任意在线兜底实证


# ---- AC-04: 全离线抛 NoOnlineDaemonError --------------------------------------


@pytest.mark.asyncio
async def test_representative_none_online_raises_error(db_session, monkeypatch):
    """全离线抛 NoOnlineDaemonError：resolve_representative_binding 返回 None 时抛错（no_binding_for_workspace 语义）。"""
    workspace_id = uuid.uuid4()
    user_id = uuid.uuid4()
    provider = "claude"

    # mock resolve_representative_binding 返回 None（无在线 binding）
    fake_repr = AsyncMock(return_value=None)
    monkeypatch.setattr(
        "app.modules.workspace.member_runtimes.queries.resolve_representative_binding",
        fake_repr,
    )

    from app.modules.workspace.member_runtimes.resolver import MemberBindingResolver

    fake_binding = AsyncMock(return_value=None)
    monkeypatch.setattr(MemberBindingResolver, "resolve_member_binding_or_none", fake_binding)

    svc = RunPlacementService(db_session)
    fake_profile = AsyncMock(return_value=None)
    monkeypatch.setattr(svc, "_resolve_profile_provider", fake_profile)
    fake_workspace = AsyncMock(return_value=provider)
    monkeypatch.setattr(svc, "_resolve_workspace_default_agent", fake_workspace)

    # 调用应抛 NoOnlineDaemonError，message 含"无在线绑定（代表 binding 未命中）"
    with pytest.raises(NoOnlineDaemonError) as exc_info:
        await svc._resolve_dispatch_runtime(
            workspace_id=workspace_id,
            user_id=user_id,
            provider=provider,
            representative_fallback=True,
        )

    assert "无在线绑定" in str(exc_info.value.message)


# ---- AC-05: 旗标关走 borrow 不变 ---------------------------------------------


@pytest.mark.asyncio
async def test_flag_false_calls_borrow_chain(db_session, monkeypatch):
    """旗标=False（默认）：调用原 _resolve_borrowed_or_own_runtime 链（borrow 兜底，零回归）。"""
    workspace_id = uuid.uuid4()
    user_id = uuid.uuid4()
    provider = "claude"
    runtime_id = uuid.uuid4()

    # mock _resolve_borrowed_or_own_runtime 返回借用 runtime
    borrowed_rt = (_fake_runtime_dict(runtime_id, user_id, provider), True, user_id)
    fake_borrow = AsyncMock(return_value=borrowed_rt)
    monkeypatch.setattr(
        "app.modules.agent.placement._resolve_borrowed_or_own_runtime",
        fake_borrow,
    )

    from app.modules.workspace.member_runtimes.resolver import MemberBindingResolver

    fake_binding = AsyncMock(return_value=None)
    monkeypatch.setattr(MemberBindingResolver, "resolve_member_binding_or_none", fake_binding)

    svc = RunPlacementService(db_session)
    fake_profile = AsyncMock(return_value=None)
    monkeypatch.setattr(svc, "_resolve_profile_provider", fake_profile)
    fake_workspace = AsyncMock(return_value=provider)
    monkeypatch.setattr(svc, "_resolve_workspace_default_agent", fake_workspace)

    # 调用 _resolve_dispatch_runtime，旗标=False（默认）
    rt = await svc._resolve_dispatch_runtime(
        workspace_id=workspace_id,
        user_id=user_id,
        provider=provider,
        representative_fallback=False,  # 显式传 False（默认值）
    )

    # 验证：_resolve_borrowed_or_own_runtime 被调用，返回带 borrowed 标记的 runtime
    fake_borrow.assert_called_once()
    assert rt is not None
    assert rt["id"] == runtime_id
    assert rt.get("_borrowed") is True  # borrowed 标记实证
    assert rt.get("_lender_user_id") == str(user_id)


# ---- 验收9：字节级零回归（不调用代表查询）-----------------------------------


@pytest.mark.asyncio
async def test_flag_false_no_representative_call(db_session, monkeypatch):
    """旗标=False 时 resolve_representative_binding 不被调用（字节级零回归）。"""
    workspace_id = uuid.uuid4()
    user_id = uuid.uuid4()
    provider = "claude"

    # mock resolve_representative_binding（应不被调用）
    fake_repr = AsyncMock(return_value=None)
    monkeypatch.setattr(
        "app.modules.workspace.member_runtimes.queries.resolve_representative_binding",
        fake_repr,
    )

    from app.modules.workspace.member_runtimes.resolver import MemberBindingResolver

    fake_binding = AsyncMock(return_value=None)
    monkeypatch.setattr(MemberBindingResolver, "resolve_member_binding_or_none", fake_binding)

    # mock borrow 链返回结果（避免抛错）
    borrowed_rt = (_fake_runtime_dict(uuid.uuid4(), user_id, provider), False, None)
    fake_borrow = AsyncMock(return_value=borrowed_rt)
    monkeypatch.setattr(
        "app.modules.agent.placement._resolve_borrowed_or_own_runtime",
        fake_borrow,
    )

    svc = RunPlacementService(db_session)
    fake_profile = AsyncMock(return_value=None)
    monkeypatch.setattr(svc, "_resolve_profile_provider", fake_profile)
    fake_workspace = AsyncMock(return_value=provider)
    monkeypatch.setattr(svc, "_resolve_workspace_default_agent", fake_workspace)

    # 调用旗标=False
    await svc._resolve_dispatch_runtime(
        workspace_id=workspace_id,
        user_id=user_id,
        provider=provider,
        representative_fallback=False,
    )

    # 验证：resolve_representative_binding 未被调用（零回归实证）
    fake_repr.assert_not_called()
    fake_borrow.assert_called_once()


# ---- dispatch_to_daemon 透传旗标 ---------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_to_daemon_forwards_representative_flag(db_session, monkeypatch):
    """dispatch_to_daemon 正确透传 representative_fallback 到 _resolve_dispatch_runtime。"""
    workspace_id = uuid.uuid4()
    user_id = uuid.uuid4()
    agent_run_id = uuid.uuid4()
    provider = "claude"
    runtime_id = uuid.uuid4()

    # mock _resolve_dispatch_runtime 捕获调用参数
    captured_kwargs = {}

    async def _fake_resolve(**kwargs):
        captured_kwargs.update(kwargs)
        return _fake_runtime_dict(runtime_id, user_id, provider)

    svc = RunPlacementService(db_session)
    fake_resolve = AsyncMock(side_effect=_fake_resolve)
    monkeypatch.setattr(svc, "_resolve_dispatch_runtime", fake_resolve)

    # mock resolve_workspace_default_agent 返回 provider
    fake_workspace = AsyncMock(return_value=provider)
    monkeypatch.setattr(svc, "_resolve_workspace_default_agent", fake_workspace)

    # 调用 dispatch_to_daemon，传入 representative_fallback=True
    await svc.dispatch_to_daemon(
        agent_run_id=agent_run_id,
        user_id=user_id,
        workspace_id=workspace_id,
        provider=provider,
        representative_fallback=True,
    )

    # 验证：_resolve_dispatch_runtime 被调用且 representative_fallback=True 被传递
    fake_resolve.assert_called_once()
    assert captured_kwargs.get("representative_fallback") is True
