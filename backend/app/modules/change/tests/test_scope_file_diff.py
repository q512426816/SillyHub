"""单文件变化比对端点测试（ql-20260910-017-2006）。

覆盖（fixture 范式复刻 git_log/tests/test_router.py：FakeHub 按
``ws_hub.get_daemon_ws_hub`` 访问器 monkeypatch + 直插绑定行）：

  1. 成功路径：200 + RPC 参数契约（workspace_id/change/file 透传、file 反斜杠
     归一 POSIX）+ 响应 DTO 逐字段
  2. 参数校验：change 白名单（``..`` / 非法字符）与 file 形态（``..`` 段 /
     绝对路径 / pathspec magic）→ 422
  3. 错误族映射：sillyspec_capability_missing → 422 升级引导；
     method_not_found（旧 daemon）→ 422；offline → 502；timeout → 504；
     其余远端 code → 502；未绑定 → 404
  4. 契约缺口：daemon 回缺 ok 键的畸形结构 → 502 contract gap
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

import pytest
from httpx import AsyncClient

from app.modules.daemon.runtime.service import (
    DaemonRpcRemoteError,
    DaemonRpcTimeout,
    DaemonRuntimeOffline,
)


class FakeHub:
    """DaemonWsHub 测试替身——按 method 分发预设 result / 异常并记录调用。"""

    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []
        self._handlers: dict[str, tuple[Any, BaseException | None]] = {}

    def on(self, method: str, *, result: Any = None, exc: BaseException | None = None) -> None:
        self._handlers[method] = (result, exc)

    async def send_rpc(
        self,
        daemon_id: uuid.UUID,
        method: str,
        params: dict[str, Any],
        *,
        timeout: float | None = None,
    ) -> dict[str, Any]:
        self.calls.append(
            {"daemon_id": daemon_id, "method": method, "params": params, "timeout": timeout}
        )
        handler = self._handlers.get(method)
        if handler is None:
            return {}
        result, exc = handler
        if exc is not None:
            raise exc
        return result


@dataclass
class ScopeFileDiffEnv:
    user_id: uuid.UUID
    token: str
    workspace_id: uuid.UUID
    daemon_id: uuid.UUID
    hub: FakeHub


@pytest.fixture()
async def role_seeder(db_session):
    from app.modules.auth.model import Role, RolePermission
    from app.modules.auth.permissions import Permission

    roles_spec = {
        "workspace_owner": (
            "Workspace Owner",
            [Permission.WORKSPACE_READ, Permission.WORKSPACE_WRITE],
        ),
    }
    ids: dict[str, uuid.UUID] = {}
    for key, (name, perms) in roles_spec.items():
        role = Role(id=uuid.uuid4(), key=key, name=name, description=name, is_system=True)
        db_session.add(role)
        await db_session.flush()
        ids[key] = role.id
        for p in perms:
            db_session.add(RolePermission(role_id=role.id, permission=p.value))
    await db_session.commit()
    return ids


@pytest.fixture()
async def user_factory(db_session):
    from app.core.config import get_settings
    from app.core.security import create_access_token, password_hasher
    from app.modules.auth.model import User

    async def _make() -> tuple[Any, str]:
        u = User(
            id=uuid.uuid4(),
            email=f"u-{uuid.uuid4().hex[:8]}@example.com",
            password_hash=password_hasher.hash("Pass123!"),
            display_name="U",
            status="active",
            is_platform_admin=False,
        )
        db_session.add(u)
        await db_session.commit()
        await db_session.refresh(u)
        token, _ = create_access_token(
            user_id=u.id,
            email=u.email,
            is_admin=u.is_platform_admin,
            settings=get_settings(),
        )
        return u, token

    return _make


@pytest.fixture()
async def ws_factory(db_session):
    from app.modules.workspace.model import Workspace

    async def _make(owner_id: uuid.UUID):
        ws = Workspace(
            id=uuid.uuid4(),
            name=f"W-{uuid.uuid4().hex[:6]}",
            slug=f"ws-{uuid.uuid4().hex[:8]}",
            # root_path 有唯一约束——每工作区唯一假路径（同测试多 env 场景不撞）
            root_path=f"/tmp/filediff-{uuid.uuid4().hex[:8]}",
            status="active",
            created_by=owner_id,
        )
        db_session.add(ws)
        await db_session.commit()
        await db_session.refresh(ws)
        return ws

    return _make


@pytest.fixture()
async def member_factory(db_session, role_seeder):
    from app.modules.auth.model import UserWorkspaceRole

    async def _bind(ws_id: uuid.UUID, user_id: uuid.UUID) -> None:
        db_session.add(
            UserWorkspaceRole(
                user_id=user_id,
                workspace_id=ws_id,
                role_id=role_seeder["workspace_owner"],
                granted_at=datetime.now(UTC),
            )
        )
        await db_session.commit()

    return _bind


@pytest.fixture()
async def binding_factory(db_session):
    from sqlalchemy import text

    from app.modules.workspace.member_runtimes.model import WorkspaceMemberRuntime

    async def _bind(ws_id: uuid.UUID, user_id: uuid.UUID, *, daemon_id: uuid.UUID | None) -> None:
        if daemon_id is not None:
            hb = datetime.now(UTC)
            await db_session.execute(
                text(
                    "INSERT INTO daemon_instances (id, user_id, hostname, server_url,"
                    " allowed_roots, status, last_heartbeat_at, created_at, updated_at)"
                    " VALUES (:id, :uid, 'filediff-test-host', 'http://t',"
                    " '[\"~/.sillyhub\"]', 'online', :hb, :hb, :hb)"
                ),
                {"id": daemon_id.hex, "uid": user_id.hex, "hb": hb},
            )
        db_session.add(
            WorkspaceMemberRuntime(
                workspace_id=ws_id,
                user_id=user_id,
                daemon_id=daemon_id,
                root_path=r"C:\repo",
                path_source="daemon-client",
            )
        )
        await db_session.commit()

    return _bind


@pytest.fixture()
async def setup_env(
    role_seeder, user_factory, ws_factory, member_factory, binding_factory, monkeypatch
):
    """一键搭场景：用户（workspace_owner 成员）+ 工作区 + 绑定行 + 假 hub。"""

    async def _make(*, with_binding: bool = True) -> ScopeFileDiffEnv:
        user, token = await user_factory()
        ws = await ws_factory(owner_id=user.id)
        await member_factory(ws.id, user.id)
        daemon_id = uuid.uuid4()
        if with_binding:
            await binding_factory(ws.id, user.id, daemon_id=daemon_id)
        hub = FakeHub()
        monkeypatch.setattr("app.modules.daemon.ws_hub.get_daemon_ws_hub", lambda: hub)
        return ScopeFileDiffEnv(
            user_id=user.id,
            token=token,
            workspace_id=ws.id,
            daemon_id=daemon_id,
            hub=hub,
        )

    return _make


def _base(env: ScopeFileDiffEnv) -> str:
    return f"/api/workspaces/{env.workspace_id}/sillyspec/file-diff"


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


_RESULT_OK = {
    "change": "2026-09-10-mcp-central-registry",
    "file": "src/a.ts",
    "ok": True,
    "mode": "full-flow",
    "base_ref": "3f22d6b",
    "anchor_label": "3f22d6b",
    "diff": "diff --git a/src/a.ts b/src/a.ts\n@@ -1 +1 @@\n-x\n+y\n",
    "note": None,
    "truncated": False,
}


@pytest.mark.asyncio
async def test_file_diff_200_rpc_contract_and_dto(client: AsyncClient, setup_env):
    """成功路径：RPC 参数（workspace_id/change/file、file 反斜杠归一）+ DTO 逐字段。"""
    env = await setup_env()
    env.hub.on("sillyspec_file_diff", result=_RESULT_OK)

    resp = await client.get(
        f"{_base(env)}",
        params={"change": "2026-09-10-mcp-central-registry", "file": "src\\a.ts"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["change"] == "2026-09-10-mcp-central-registry"
    assert body["file"] == "src/a.ts"
    assert body["ok"] is True
    assert body["mode"] == "full-flow"
    assert body["base_ref"] == "3f22d6b"
    assert body["anchor_label"] == "3f22d6b"
    assert body["diff"].startswith("diff --git a/src/a.ts")
    assert body["note"] is None
    assert body["truncated"] is False

    # RPC 参数契约：workspace_id 字符串化 + change + 归一后 file；显式 35s 超时
    call = env.hub.calls[0]
    assert call["method"] == "sillyspec_file_diff"
    assert call["params"] == {
        "workspace_id": str(env.workspace_id),
        "change": "2026-09-10-mcp-central-registry",
        "file": "src/a.ts",
    }
    assert call["timeout"] == 135.0  # ≥ daemon 命令超时 120s + 余量
    assert call["daemon_id"] == env.daemon_id


@pytest.mark.asyncio
async def test_file_diff_param_validation_422(client: AsyncClient, setup_env):
    """参数校验：change 白名单（.. / 非法字符）与 file 形态（.. 段 / 绝对路径 /
    pathspec magic）→ 422，且不打 RPC。"""
    env = await setup_env()
    cases = [
        {"change": "2026-09-10-x", "file": "../outside.ts"},
        {"change": "../../etc", "file": "src/a.ts"},
        {"change": "2026-09-10-x", "file": "/abs/path.ts"},
        {"change": "2026-09-10-x", "file": ":(icase)src"},
    ]
    for params in cases:
        resp = await client.get(f"{_base(env)}", params=params, headers=_bearer(env.token))
        assert resp.status_code == 422, (params, resp.text)
    assert env.hub.calls == [], "422 静态预检不发 RPC"


@pytest.mark.asyncio
async def test_file_diff_sillyspec_capability_422(client: AsyncClient, setup_env):
    """旧 sillyspec（capability_missing）→ 422 升级引导（前端据此出提示）。"""
    env = await setup_env()
    env.hub.on(
        "sillyspec_file_diff",
        exc=DaemonRpcRemoteError(
            {"code": "sillyspec_capability_missing", "message": "old sillyspec"}
        ),
    )
    resp = await client.get(
        f"{_base(env)}",
        params={"change": "c1", "file": "src/a.ts"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 422, resp.text
    assert "sillyspec" in resp.json()["message"]


@pytest.mark.asyncio
async def test_file_diff_old_daemon_method_not_found_422(client: AsyncClient, setup_env):
    """旧 daemon 未注册 RPC（method_not_found）→ 422 daemon 升级引导。"""
    env = await setup_env()
    env.hub.on(
        "sillyspec_file_diff",
        exc=DaemonRpcRemoteError({"code": "method_not_found", "message": "no handler"}),
    )
    resp = await client.get(
        f"{_base(env)}",
        params={"change": "c1", "file": "src/a.ts"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 422, resp.text


@pytest.mark.asyncio
async def test_file_diff_offline_502_and_timeout_504(client: AsyncClient, setup_env):
    """offline → 502（含 mid-rpc 变体）；RPC 超时 → 504。"""
    env = await setup_env()
    env.hub.on(
        "sillyspec_file_diff",
        exc=DaemonRuntimeOffline("daemon 'x' is offline (no WS connection)."),
    )
    resp = await client.get(
        f"{_base(env)}",
        params={"change": "c1", "file": "src/a.ts"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 502, resp.text

    env2 = await setup_env()
    env2.hub.on("sillyspec_file_diff", exc=DaemonRpcTimeout("rpc timed out"))
    resp2 = await client2_get(client, env2)
    assert resp2.status_code == 504, resp2.text


async def client2_get(client: AsyncClient, env: ScopeFileDiffEnv):
    return await client.get(
        f"{_base(env)}",
        params={"change": "c1", "file": "src/a.ts"},
        headers=_bearer(env.token),
    )


@pytest.mark.asyncio
async def test_file_diff_remote_other_502_and_contract_gap(client: AsyncClient, setup_env):
    """其余远端 code（变更不存在等）→ 502；daemon 回畸形结构（缺 ok）→ 502。"""
    env = await setup_env()
    env.hub.on(
        "sillyspec_file_diff",
        exc=DaemonRpcRemoteError({"code": "scope_audit_failed", "message": "exit 1"}),
    )
    resp = await client.get(
        f"{_base(env)}",
        params={"change": "2099-01-01-none", "file": "src/a.ts"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 502, resp.text

    env2 = await setup_env()
    env2.hub.on("sillyspec_file_diff", result={"change": "c1", "diff": "x"})
    resp2 = await client2_get(client, env2)
    assert resp2.status_code == 502, resp2.text


@pytest.mark.asyncio
async def test_file_diff_not_bound_404(client: AsyncClient, setup_env):
    """无绑定行（resolver miss）→ 404 引导。"""
    env = await setup_env(with_binding=False)
    resp = await client.get(
        f"{_base(env)}",
        params={"change": "c1", "file": "src/a.ts"},
        headers=_bearer(env.token),
    )
    assert resp.status_code == 404, resp.text
