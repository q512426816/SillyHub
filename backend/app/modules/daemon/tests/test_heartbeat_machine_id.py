"""心跳 machine_id → daemon_runtimes.metadata 落库单测（2026-09-30-tool-report-
activation-wrong-machine task-02 / FR-01）。

钉死三组行为：

1. 落库组——请求携带 ``machine_id`` → 该 daemon 全部 runtime 行
   ``metadata.machine_id`` 合并写入（不覆盖既有其它键）。
2. 兼容组——旧 daemon 不带键 → runtime metadata 原样保留（零破坏）；
   同值重报幂等、新值覆盖。
3. 归属组——非 owner 心跳仍走既有 404（machine_id 不旁路归属校验）。

HTTP 侧复用 test_machine_sillyspec.py harness（client + 手签 JWT +
RuntimeService.register_daemon 前置），对齐 test_heartbeat_spec_cache.py 先例。
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.daemon.model import DaemonRuntime

from .test_machine_sillyspec import _headers, _register_daemon, _seed_user


def _heartbeat_body(daemon_local_id: uuid.UUID, machine_id: str | None = None) -> dict:
    body: dict = {"daemon_local_id": str(daemon_local_id)}
    if machine_id is not None:
        body["machine_id"] = machine_id
    return body


async def _prime_heartbeat(client: AsyncClient, token: str, daemon_local_id: uuid.UUID) -> None:
    """register 后先打一次基础心跳——把 providers 绑成 runtime 行并挂
    daemon_instance_id（register 只建 instance，runtime 绑定发生在首次
    heartbeat_daemon），对齐 daemon.md 心跳链路语义。"""
    resp = await client.post(
        "/api/daemon/heartbeat",
        json=_heartbeat_body(daemon_local_id),
        headers=_headers(token),
    )
    assert resp.status_code == 200, resp.text


async def _runtime_metadata_map(
    db_session: AsyncSession, daemon_local_id: uuid.UUID
) -> dict[uuid.UUID, dict | None]:
    # expire 后重查：端点（client session）commit 的 metadata 更新对 db_session
    # 的 identity map 不可见（对齐 test_machine_sillyspec._reload_instance 惯例）。
    db_session.expire_all()
    rows = (
        (
            await db_session.execute(
                select(DaemonRuntime).where(DaemonRuntime.daemon_instance_id == daemon_local_id)
            )
        )
        .scalars()
        .all()
    )
    return {rt.id: dict(rt.metadata_ or {}) for rt in rows}


class TestHeartbeatMachineId:
    @pytest.mark.asyncio
    async def test_machine_id_written_to_all_runtimes(
        self, db_session: AsyncSession, client: AsyncClient
    ) -> None:
        """带 machine_id → 该 daemon 全部 runtime metadata 合并写入且不覆盖既有键。"""
        owner, token = await _seed_user(db_session, name="owner-mid")
        daemon_local_id = await _register_daemon(db_session, owner.id)
        # 预置既有 metadata 键（验证合并不清除）。
        rt_rows = (
            (
                await db_session.execute(
                    select(DaemonRuntime).where(DaemonRuntime.daemon_instance_id == daemon_local_id)
                )
            )
            .scalars()
            .all()
        )
        assert rt_rows, "register_daemon 应至少建一个 runtime"
        first_rt = rt_rows[0]
        first_rt.metadata_ = {"borrow_policy": "shared"}
        db_session.add(first_rt)
        await db_session.commit()

        mid = str(uuid.uuid4())
        resp = await client.post(
            "/api/daemon/heartbeat",
            json=_heartbeat_body(daemon_local_id, machine_id=mid),
            headers=_headers(token),
        )
        assert resp.status_code == 200, resp.text

        meta_map = await _runtime_metadata_map(db_session, daemon_local_id)
        assert len(meta_map) == len(rt_rows)
        for meta in meta_map.values():
            assert meta.get("machine_id") == mid
        # 预置键保留（合并非替换）。
        assert meta_map[first_rt.id].get("borrow_policy") == "shared"

    @pytest.mark.asyncio
    async def test_no_machine_id_field_keeps_metadata(
        self, db_session: AsyncSession, client: AsyncClient
    ) -> None:
        """旧 daemon 不带键 → metadata 原样（零破坏）；带新值覆盖（兄弟语义）。"""
        owner, token = await _seed_user(db_session, name="owner-legacy-mid")
        daemon_local_id = await _register_daemon(db_session, owner.id)

        # 第一次心跳带值。
        mid_a = str(uuid.uuid4())
        resp = await client.post(
            "/api/daemon/heartbeat",
            json=_heartbeat_body(daemon_local_id, machine_id=mid_a),
            headers=_headers(token),
        )
        assert resp.status_code == 200, resp.text

        # 第二次心跳不带键（旧 daemon 形态）→ 保留旧值。
        resp = await client.post(
            "/api/daemon/heartbeat",
            json=_heartbeat_body(daemon_local_id),
            headers=_headers(token),
        )
        assert resp.status_code == 200, resp.text
        meta_map = await _runtime_metadata_map(db_session, daemon_local_id)
        for meta in meta_map.values():
            assert meta.get("machine_id") == mid_a

        # 第三次心跳带新值 → 覆盖（同机重装 machine-id 文件后收敛）。
        mid_b = str(uuid.uuid4())
        resp = await client.post(
            "/api/daemon/heartbeat",
            json=_heartbeat_body(daemon_local_id, machine_id=mid_b),
            headers=_headers(token),
        )
        assert resp.status_code == 200, resp.text
        meta_map = await _runtime_metadata_map(db_session, daemon_local_id)
        for meta in meta_map.values():
            assert meta.get("machine_id") == mid_b

    @pytest.mark.asyncio
    async def test_ownership_guard_still_applies(
        self, db_session: AsyncSession, client: AsyncClient
    ) -> None:
        """非 owner 心跳仍 404（machine_id 不旁路归属校验）。"""
        owner, _owner_token = await _seed_user(db_session, name="owner-guard")
        _other, other_token = await _seed_user(db_session, name="other-guard")
        daemon_local_id = await _register_daemon(db_session, owner.id)

        resp = await client.post(
            "/api/daemon/heartbeat",
            json=_heartbeat_body(daemon_local_id, machine_id=str(uuid.uuid4())),
            headers=_headers(other_token),
        )
        assert resp.status_code == 404, resp.text
