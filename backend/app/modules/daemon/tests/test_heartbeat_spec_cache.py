"""心跳 spec_cache → spec_versions 版本对答单测（ql-20260907-010：spec 拉取工作区级化）.

钉死三组行为：

1. 对答组——请求携带 ``spec_cache``（workspace_id + 本地版本）→ 响应
   ``spec_versions`` 按服务器权威 ``spec_workspaces.spec_version`` 回填
   （键 = workspace_id 字符串）；服务器无行的工作区键**缺席**（非 0 值——
   daemon 据键缺席判定「无缓存语义」不预取）。
2. 兼容组——旧 daemon 不带 ``spec_cache`` 键 → 200 且 ``spec_versions`` 恒 {}
   （心跳保活通道零破坏）。
3. 归属组——非 owner 用户心跳仍走既有 404 归属校验（spec_cache 不旁路）。

HTTP 侧对齐 test_machine_sillyspec.py 的 harness（client + 手签 JWT +
RuntimeService.register_daemon 前置）。SQLite 内存库不强制 FK，
SpecWorkspace 直接以随机 workspace_id 落行（无需 Workspace 实体）。
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.model import User
from app.modules.daemon.runtime.service import RuntimeService
from app.modules.spec_workspace.model import SpecWorkspace

from .test_machine_sillyspec import _headers, _register_daemon, _seed_user


def _heartbeat_body(daemon_local_id: uuid.UUID, spec_cache: list[dict] | None) -> dict:
    body: dict = {"daemon_local_id": str(daemon_local_id)}
    if spec_cache is not None:
        body["spec_cache"] = spec_cache
    return body


async def _seed_spec_workspace(
    db_session: AsyncSession, *, version: int
) -> uuid.UUID:
    """插入一条 spec_workspaces 行（随机 workspace_id，SQLite 不强制 FK）。"""
    ws_id = uuid.uuid4()
    db_session.add(
        SpecWorkspace(
            workspace_id=ws_id,
            strategy="platform-managed",
            sync_status="clean",
            spec_version=version,
        )
    )
    await db_session.commit()
    return ws_id


class TestHeartbeatSpecVersions:
    @pytest.mark.asyncio
    async def test_spec_cache_round_trip(
        self, db_session: AsyncSession, client: AsyncClient
    ) -> None:
        """带 spec_cache → 响应按服务器权威版本回填；无行工作区键缺席。"""
        owner, token = await _seed_user(db_session, name="owner-spec-cache")
        daemon_local_id = await _register_daemon(db_session, owner.id)
        ws_a = await _seed_spec_workspace(db_session, version=33)
        ws_missing = uuid.uuid4()  # 服务器无此工作区行

        resp = await client.post(
            "/api/daemon/heartbeat",
            json=_heartbeat_body(
                daemon_local_id,
                [
                    {"workspace_id": str(ws_a), "spec_version": 26},
                    {"workspace_id": str(ws_missing), "spec_version": 3},
                ],
            ),
            headers=_headers(token),
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        # 服务器权威版本回填（与请求里的本地版本无关）
        assert body["spec_versions"] == {str(ws_a): 33}

    @pytest.mark.asyncio
    async def test_no_spec_cache_field_returns_empty_map(
        self, db_session: AsyncSession, client: AsyncClient
    ) -> None:
        """旧 daemon 无 spec_cache 键 → 200 且 spec_versions 恒 {}（零破坏）。"""
        owner, token = await _seed_user(db_session, name="owner-legacy")
        daemon_local_id = await _register_daemon(db_session, owner.id)
        await _seed_spec_workspace(db_session, version=7)  # 有行也不回（未请求）

        resp = await client.post(
            "/api/daemon/heartbeat",
            json=_heartbeat_body(daemon_local_id, None),
            headers=_headers(token),
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["spec_versions"] == {}

    @pytest.mark.asyncio
    async def test_ownership_guard_still_applies(
        self, db_session: AsyncSession, client: AsyncClient
    ) -> None:
        """非 owner 心跳仍 404（spec_cache 不旁路归属校验）。"""
        owner, _owner_token = await _seed_user(db_session, name="owner-guard")
        daemon_local_id = await _register_daemon(db_session, owner.id)
        intruder: User
        intruder, intruder_token = await _seed_user(db_session, name="intruder")

        resp = await client.post(
            "/api/daemon/heartbeat",
            json=_heartbeat_body(
                daemon_local_id,
                [{"workspace_id": str(uuid.uuid4()), "spec_version": 1}],
            ),
            headers=_headers(intruder_token),
        )
        assert resp.status_code == 404, resp.text
