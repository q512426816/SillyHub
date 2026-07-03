"""Per-daemon register / heartbeat 契约测试（task-15 / design §11 AC1-3, §9.1, §9.2）.

锁定 design §11 全局验收前 3 条与 heartbeat/stale 清理语义：

* AC1: 注册后 ``daemon_instances`` 恰 1 行，``daemon_runtimes`` N 行（N=上报
  provider 数），所有 runtime 挂同一 ``daemon_instance_id``。
* AC2: 同一 ``daemon_local_id`` 换 hostname 重启 → ``daemon_instances.id`` 不变
  （复用身份），workspace 绑定不断（不产生新 instance 行）。
* AC3: 同一 ``daemon_local_id`` 配不同 ``server_url`` 视为同一实体（按 id 复用，
  server_url 覆盖更新），不同 ``daemon_local_id`` 则两条 ``daemon_instances``。
* heartbeat_daemon：刷新 instance + 各 provider runtime 状态；disabled runtime
  不被心跳拉回 online（保留管理员禁用意图）。
* stale 清理：register 时本次未上报的 provider runtime 被删除。
* 归属校验：``daemon_local_id`` 已被其他用户注册 → 403
  DaemonInstanceOwnershipMismatch。

设计参见 ``design.md`` §5.2 / §9.1 / §9.2 / §11。SQLite in-memory 行为对齐生产 PG
（backend-test-sqlite-vs-pg：断言行数 + 字段值，不绑死 SQL 方言函数名）。
"""

from __future__ import annotations

import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance, DaemonRuntime
from app.modules.daemon.runtime.service import (
    DaemonInstanceOwnershipMismatch,
    DaemonRuntimeNotFound,
    RuntimeService,
)


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


def _providers(*names: str) -> list[dict]:
    return [{"provider": n, "status": "online", "version": "1.0"} for n in names]


class TestRegisterDaemon:
    """AC1 / AC2 / AC3 + stale 清理 + 归属校验。"""

    @pytest.mark.asyncio
    async def test_register_creates_one_instance_and_n_runtimes(
        self, db_session: AsyncSession
    ) -> None:
        """AC1: 1 daemon_instance + N runtimes，同 daemon_instance_id。"""
        uid = await _seed_user(db_session)
        svc = RuntimeService(db_session)
        daemon_local_id = uuid.uuid4()

        result = await svc.register_daemon(
            uid,
            daemon_local_id=daemon_local_id,
            server_url="http://localhost:8001",
            hostname="host-A",
            os="linux",
            arch="x86_64",
            allowed_roots=["~/.sillyhub"],
            providers=_providers("claude", "codex"),
        )

        # 返回契约：daemon_instance_id + 各 provider runtime_id
        assert result.daemon_instance_id == daemon_local_id
        assert {r.provider for r in result.runtimes} == {"claude", "codex"}

        # AC1: 恰 1 instance + 2 runtime，全部挂同一 instance
        instances = (await db_session.execute(select(DaemonInstance))).scalars().all()
        assert len(instances) == 1
        assert instances[0].id == daemon_local_id

        runtimes = (
            (
                await db_session.execute(
                    select(DaemonRuntime).where(DaemonRuntime.daemon_instance_id == daemon_local_id)
                )
            )
            .scalars()
            .all()
        )
        assert len(runtimes) == 2
        assert {r.provider for r in runtimes} == {"claude", "codex"}
        assert all(r.daemon_instance_id == daemon_local_id for r in runtimes)
        # runtime.name 取 hostname（design §9.2，runtime 退化从属）
        assert all(r.name == "host-A" for r in runtimes)

    @pytest.mark.asyncio
    async def test_reregister_same_local_id_reuses_instance_updates_hostname(
        self, db_session: AsyncSession
    ) -> None:
        """AC2: 同 daemon_local_id 换 hostname → instance.id 不变，不新增行。"""
        uid = await _seed_user(db_session)
        svc = RuntimeService(db_session)
        daemon_local_id = uuid.uuid4()

        await svc.register_daemon(
            uid,
            daemon_local_id=daemon_local_id,
            server_url="http://localhost:8001",
            hostname="old-host",
            providers=_providers("claude"),
        )

        # 换 hostname 重启
        result = await svc.register_daemon(
            uid,
            daemon_local_id=daemon_local_id,
            server_url="http://localhost:8001",
            hostname="new-host",
            providers=_providers("claude"),
        )

        # AC2: id 不变，instance 仍 1 行，hostname 已更新
        assert result.daemon_instance_id == daemon_local_id
        instances = (await db_session.execute(select(DaemonInstance))).scalars().all()
        assert len(instances) == 1
        assert instances[0].id == daemon_local_id
        assert instances[0].hostname == "new-host"
        # runtime 仍是 1 条，未重复创建（id 复用，不新增 runtime 行）
        runtimes = (
            (
                await db_session.execute(
                    select(DaemonRuntime).where(DaemonRuntime.daemon_instance_id == daemon_local_id)
                )
            )
            .scalars()
            .all()
        )
        assert len(runtimes) == 1
        # 注：runtime.name 在创建时落 hostname，reregister 不回填（runtime 退化从属，
        # design §9.2；machine-level identity 已上提到 daemon_instance.hostname）。
        assert instances[0].hostname == "new-host"

    @pytest.mark.asyncio
    async def test_two_different_local_ids_produce_two_instances(
        self, db_session: AsyncSession
    ) -> None:
        """AC3: 不同 daemon_local_id → 两条 daemon_instances（不同 server_url）。"""
        uid = await _seed_user(db_session)
        svc = RuntimeService(db_session)

        await svc.register_daemon(
            uid,
            daemon_local_id=uuid.uuid4(),
            server_url="http://backend-A:8001",
            hostname="host-A",
            providers=_providers("claude"),
        )
        await svc.register_daemon(
            uid,
            daemon_local_id=uuid.uuid4(),
            server_url="http://backend-B:8001",
            hostname="host-B",
            providers=_providers("codex"),
        )

        instances = (await db_session.execute(select(DaemonInstance))).scalars().all()
        assert len(instances) == 2
        assert {i.server_url for i in instances} == {
            "http://backend-A:8001",
            "http://backend-B:8001",
        }

    @pytest.mark.asyncio
    async def test_register_stale_provider_runtime_removed(self, db_session: AsyncSession) -> None:
        """design §9.2 stale 清理：本次未上报的 provider runtime 被删除。"""
        uid = await _seed_user(db_session)
        svc = RuntimeService(db_session)
        daemon_local_id = uuid.uuid4()

        # 首次注册两个 provider
        await svc.register_daemon(
            uid,
            daemon_local_id=daemon_local_id,
            server_url="http://localhost:8001",
            hostname="host",
            providers=_providers("claude", "codex"),
        )
        before = (
            (
                await db_session.execute(
                    select(DaemonRuntime).where(DaemonRuntime.daemon_instance_id == daemon_local_id)
                )
            )
            .scalars()
            .all()
        )
        assert len(before) == 2

        # 再次注册仅上报 claude（codex 卸载）→ 应被清理
        await svc.register_daemon(
            uid,
            daemon_local_id=daemon_local_id,
            server_url="http://localhost:8001",
            hostname="host",
            providers=_providers("claude"),
        )
        after = (
            (
                await db_session.execute(
                    select(DaemonRuntime).where(DaemonRuntime.daemon_instance_id == daemon_local_id)
                )
            )
            .scalars()
            .all()
        )
        assert {r.provider for r in after} == {"claude"}

    @pytest.mark.asyncio
    async def test_register_cross_user_local_id_reuse_raises(
        self, db_session: AsyncSession
    ) -> None:
        """归属校验：daemon_local_id 跨用户复用 → 403 DaemonInstanceOwnershipMismatch。"""
        uid_a = await _seed_user(db_session, name="a")
        uid_b = await _seed_user(db_session, name="b")
        svc = RuntimeService(db_session)
        daemon_local_id = uuid.uuid4()

        await svc.register_daemon(
            uid_a,
            daemon_local_id=daemon_local_id,
            server_url="http://localhost:8001",
            hostname="host",
            providers=_providers("claude"),
        )

        with pytest.raises(DaemonInstanceOwnershipMismatch):
            await svc.register_daemon(
                uid_b,
                daemon_local_id=daemon_local_id,
                server_url="http://localhost:8001",
                hostname="host",
                providers=_providers("claude"),
            )


class TestHeartbeatDaemon:
    """per-daemon heartbeat 契约（design §5.4 / §9.1 / §9.2）。"""

    @pytest.mark.asyncio
    async def test_heartbeat_refreshes_instance_and_provider_status(
        self, db_session: AsyncSession
    ) -> None:
        uid = await _seed_user(db_session)
        svc = RuntimeService(db_session)
        daemon_local_id = uuid.uuid4()

        await svc.register_daemon(
            uid,
            daemon_local_id=daemon_local_id,
            server_url="http://localhost:8001",
            hostname="host",
            providers=_providers("claude"),
        )

        # 把 instance 挂 offline，runtime 挂 degraded，心跳应刷新为 online
        inst = await db_session.get(DaemonInstance, daemon_local_id)
        assert inst is not None
        inst.status = "offline"
        rt = (
            await db_session.execute(
                select(DaemonRuntime).where(DaemonRuntime.daemon_instance_id == daemon_local_id)
            )
        ).scalar_one()
        rt.status = "degraded"
        await db_session.commit()

        updated = await svc.heartbeat_daemon(
            daemon_local_id,
            providers=[{"provider": "claude", "status": "online"}],
        )
        assert updated.id == daemon_local_id
        assert updated.status == "online"
        # runtime status 跟随上报值
        await db_session.refresh(rt)
        assert rt.status == "online"

    @pytest.mark.asyncio
    async def test_heartbeat_unknown_instance_raises(self, db_session: AsyncSession) -> None:
        """design §9.1: 未注册实体先于心跳 → 404 DaemonRuntimeNotFound。"""
        svc = RuntimeService(db_session)
        with pytest.raises(DaemonRuntimeNotFound):
            await svc.heartbeat_daemon(uuid.uuid4())

    @pytest.mark.asyncio
    async def test_heartbeat_preserves_disabled_runtime(self, db_session: AsyncSession) -> None:
        """disabled runtime 不被心跳拉回 online（保留管理员禁用意图）。"""
        uid = await _seed_user(db_session)
        svc = RuntimeService(db_session)
        daemon_local_id = uuid.uuid4()

        await svc.register_daemon(
            uid,
            daemon_local_id=daemon_local_id,
            server_url="http://localhost:8001",
            hostname="host",
            providers=_providers("claude"),
        )
        rt = (
            await db_session.execute(
                select(DaemonRuntime).where(DaemonRuntime.daemon_instance_id == daemon_local_id)
            )
        ).scalar_one()
        rt.status = "disabled"
        await db_session.commit()

        await svc.heartbeat_daemon(
            daemon_local_id,
            providers=[{"provider": "claude", "status": "online"}],
        )
        await db_session.refresh(rt)
        assert rt.status == "disabled"
