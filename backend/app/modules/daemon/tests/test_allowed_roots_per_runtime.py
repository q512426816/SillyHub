"""allowed_roots per-runtime 隔离测试（2026-07-06-allowed-roots-per-runtime）。

验证核心 per-runtime 行为：
- FR-02/D-003：register 新 runtime copy instance.default
- FR-01/D-002：update_allowed_roots 写 runtime 级，CC 变 Hermes 不变，instance 不变
- FR-06/D-005：空 allowed_roots ValueError（fail-closed）
- FR-03/D-004：register 已存在 runtime 不覆盖独立演化值
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance, DaemonRuntime
from app.modules.daemon.runtime.service import RuntimeService


async def _seed_user(db_session: AsyncSession, *, name: str = "u") -> uuid.UUID:
    user = User(
        id=uuid.uuid4(),
        email=f"{name}-{uuid.uuid4()}@example.com",
        password_hash="x",
        display_name=name,
        status="active",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user.id


async def _register(
    db_session: AsyncSession,
    *,
    user_id: uuid.UUID,
    daemon_local_id: uuid.UUID,
    providers: list[dict],
    allowed_roots: list[str],
):
    svc = RuntimeService(db_session)
    return await svc.register_daemon(
        user_id,
        daemon_local_id=daemon_local_id,
        server_url="http://test",
        hostname="h",
        allowed_roots=allowed_roots,
        providers=providers,
    )


async def _list_runtimes(db_session: AsyncSession, daemon_local_id: uuid.UUID) -> dict:
    rows = (
        (
            await db_session.execute(
                select(DaemonRuntime).where(DaemonRuntime.daemon_instance_id == daemon_local_id)
            )
        )
        .scalars()
        .all()
    )
    return {r.provider: r for r in rows}


@pytest.mark.asyncio
async def test_register_new_runtime_copies_instance_default(db_session: AsyncSession):
    """FR-02/D-003：新 runtime 注册 copy instance.default。"""
    user_id = await _seed_user(db_session)
    daemon_local_id = uuid.uuid4()
    await _register(
        db_session,
        user_id=user_id,
        daemon_local_id=daemon_local_id,
        providers=[{"provider": "claude"}, {"provider": "hermes"}],
        allowed_roots=["D:/proj", "~/.sillyhub"],
    )
    instance = await db_session.get(DaemonInstance, daemon_local_id)
    assert list(instance.allowed_roots) == ["D:/proj", "~/.sillyhub"]
    runtimes = await _list_runtimes(db_session, daemon_local_id)
    assert list(runtimes["claude"].allowed_roots) == ["D:/proj", "~/.sillyhub"]
    assert list(runtimes["hermes"].allowed_roots) == ["D:/proj", "~/.sillyhub"]


@pytest.mark.asyncio
async def test_update_writes_runtime_only_cc_not_hermes(db_session: AsyncSession):
    """FR-01/D-002：PUT CC 写 runtime，Hermes 不变，instance 不变。"""
    user_id = await _seed_user(db_session)
    daemon_local_id = uuid.uuid4()
    result = await _register(
        db_session,
        user_id=user_id,
        daemon_local_id=daemon_local_id,
        providers=[{"provider": "claude"}, {"provider": "hermes"}],
        allowed_roots=["~/.sillyhub"],
    )
    claude_rt = next(r for r in result.runtimes if r.provider == "claude")
    hermes_rt = next(r for r in result.runtimes if r.provider == "hermes")
    svc = RuntimeService(db_session)
    await svc.update_allowed_roots(claude_rt.runtime_id, user_id, allowed_roots=["D:/cc"])
    claude = await db_session.get(DaemonRuntime, claude_rt.runtime_id)
    hermes = await db_session.get(DaemonRuntime, hermes_rt.runtime_id)
    instance = await db_session.get(DaemonInstance, daemon_local_id)
    assert list(claude.allowed_roots) == ["D:/cc"]
    assert list(hermes.allowed_roots) == ["~/.sillyhub"]
    assert list(instance.allowed_roots) == ["~/.sillyhub"]


@pytest.mark.asyncio
async def test_update_empty_allowed_roots_raises(db_session: AsyncSession):
    """FR-06/D-005：空 allowed_roots ValueError（fail-closed）。"""
    user_id = await _seed_user(db_session)
    daemon_local_id = uuid.uuid4()
    result = await _register(
        db_session,
        user_id=user_id,
        daemon_local_id=daemon_local_id,
        providers=[{"provider": "claude"}],
        allowed_roots=["~/.sillyhub"],
    )
    svc = RuntimeService(db_session)
    with pytest.raises(ValueError):
        await svc.update_allowed_roots(result.runtimes[0].runtime_id, user_id, allowed_roots=[])


@pytest.mark.asyncio
async def test_reregister_does_not_overwrite_evolved_runtime(db_session: AsyncSession):
    """FR-03/D-004：daemon 重注册（instance.default 变）不覆盖已演化 runtime。"""
    user_id = await _seed_user(db_session)
    daemon_local_id = uuid.uuid4()
    result = await _register(
        db_session,
        user_id=user_id,
        daemon_local_id=daemon_local_id,
        providers=[{"provider": "claude"}],
        allowed_roots=["~/.sillyhub"],
    )
    claude_rt = result.runtimes[0]
    svc = RuntimeService(db_session)
    await svc.update_allowed_roots(claude_rt.runtime_id, user_id, allowed_roots=["D:/cc"])
    # daemon 重注册，instance.default 改为 E:/
    await _register(
        db_session,
        user_id=user_id,
        daemon_local_id=daemon_local_id,
        providers=[{"provider": "claude"}],
        allowed_roots=["E:/new"],
    )
    claude = await db_session.get(DaemonRuntime, claude_rt.runtime_id)
    assert list(claude.allowed_roots) == ["D:/cc"]
    instance = await db_session.get(DaemonInstance, daemon_local_id)
    assert list(instance.allowed_roots) == ["E:/new"]
