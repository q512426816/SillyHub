"""Tests for ``GET /api/daemon/mcp/config`` (task-05, design D-004).

daemon skill-manager / mcp-config 启动时拉 MCP 注入集 + server 白名单，
注入 claude 启动 env。关键差异：本端点返**原值不脱敏**（daemon 需真实 env），
区别 admin 详情 ``GET /api/mcp-servers/{id}`` 的遮蔽视图。

2026-09-10-mcp-central-registry task-05 换源重写：platform 位数据源从 KV
``mcp.platform_default`` 切到 registry 渲染（``render_injection_set``，D-003
KV 弃用不读），七个 KV-seed 用例改 registry-seed（McpServer + binding 行，
经 service 真实写路径——secret env 走真 CredentialCipher 加密）。覆盖：

* daemon token 认证通（200，Bearer JWT 经 get_current_principal）
* 无 token → 401
* registry 空库 → 200 空结构 ``{"platform_default": {"mcpServers": {}}, "whitelist": []}``
* platform binding 渲染输出：``encrypted_env`` 解密回填 env 真值**不遮蔽**
* whitelist 脏数据归一 / 残留 ``mcp.platform_default`` 脏 KV 不再读（D-003）
* admin 详情遮蔽 secret vs daemon 视图原值（D-004 对照）
* ``user_id`` 维度（D-010 授权三态）：合法 lease → platform ∪ user 注入集；
  无活跃 lease / 跨 daemon 归属不匹配 → 404（不泄露存在性）
* 渲染抛错 → 503（daemon 本地 mcp.json 回落链保持可达；空集 200 与故障 503 分开）

2026-08-26-workspace-mcp-edit task-03 扩展（design §7.2）：可选 query
``workspace_id`` 追加 workspace 维度——
* 带 workspace_id 且 specDir/.mcp.json 存在 → ``workspace.mcpServers`` 明文不脱敏
* 带 workspace_id 但文件缺失/无 spec_ws → 空 ``{mcpServers: {}}`` 不报错
* 不带 workspace_id → 响应无 workspace key，结构与旧版完全一致（R-07 回归）
* workspace 不存在 → 404 中文；非法 UUID → 422
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance, DaemonRuntime, DaemonTaskLease
from app.modules.mcp_registry.model import McpServer
from app.modules.mcp_registry.schema import McpServerCreate
from app.modules.mcp_registry.service import McpRegistryService
from app.modules.settings.model import PlatformSetting
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace

# secret 类 env key（token/key/secret/password 子串，_SECRET_KEY_MARKERS 同源）
# ——service 写路径抽列进 encrypted_env，daemon 视图解密回填真值不遮蔽。
_SECRET_ENV = {
    "GITHUB_TOKEN": "ghp_super_secret_value",
    "API_KEY": "sk-real-key-123",
    "DB_PASSWORD": "p@ssw0rd",
    "CLIENT_SECRET": "secret-xyz",
    "NORMAL_VAR": "visible-anyway",
}


async def _put_setting(db_session: AsyncSession, key: str, value: Any) -> None:
    """直接写一行 PlatformSetting（绕过 admin PUT 端点的权限门）。"""
    existing = await db_session.get(PlatformSetting, key)
    payload = json.dumps(value, ensure_ascii=False)
    if existing is not None:
        existing.value = payload
        db_session.add(existing)
    else:
        db_session.add(PlatformSetting(key=key, value=payload))
    await db_session.commit()


async def _create_user(db_session: AsyncSession, *, label: str, admin: bool = False) -> User:
    """插入真实 User 行（service 收 User 对象；admin=is_platform_admin 短路 rbac）。"""
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=f"mcp-ep-{uid.hex[:8]}-{label}@example.com",
        username=f"mcp-ep-{uid.hex[:8]}",
        password_hash="irrelevant",
        display_name=f"MCP EP {label}",
        status="active",
        is_platform_admin=admin,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _create_principal_with_token(db_session: AsyncSession, *, label: str) -> tuple[User, str]:
    """插入普通用户并手签 15min JWT（get_current_principal Bearer 路径）。

    照 test_lease_ownership 的 daemon principal 认证 fixture 惯例——lease
    归属校验用例需要"非共享 admin 的独立认证主体"做跨主体拒绝态。
    """
    from app.core.config import get_settings
    from app.core.security import create_access_token

    user = await _create_user(db_session, label=label)
    token, _payload = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=bool(user.is_platform_admin),
        settings=get_settings(),
    )
    return user, token


async def _seed_platform_server(
    db_session: AsyncSession,
    admin: User,
    *,
    name: str,
    server_config: dict[str, Any],
    bind: bool = True,
) -> McpServer:
    """经 service 真实写路径建平台共享 server（secret env 走真 CredentialCipher）。"""
    svc = McpRegistryService(db_session)
    detail = await svc.create_server(
        McpServerCreate(name=name, server_config=dict(server_config), scope="platform"),
        admin,
    )
    if bind:
        await svc.add_binding(detail.id, "platform", admin)
    row = await db_session.get(McpServer, detail.id)
    assert row is not None
    return row


async def _seed_user_server(
    db_session: AsyncSession,
    owner: User,
    *,
    name: str,
    server_config: dict[str, Any],
) -> McpServer:
    """经 service 真实写路径建用户私有 server 并绑 user binding。"""
    svc = McpRegistryService(db_session)
    detail = await svc.create_server(
        McpServerCreate(name=name, server_config=dict(server_config)), owner
    )
    await svc.add_binding(detail.id, "user", owner)
    row = await db_session.get(McpServer, detail.id)
    assert row is not None
    return row


async def _seed_runtime(
    db_session: AsyncSession, user_id: uuid.UUID, *, hostname: str = "owner-host"
) -> DaemonRuntime:
    """创建 instance + 挂其下的单 runtime（镜像 test_lease_ownership 惯例）。"""
    instance = DaemonInstance(
        id=uuid.uuid4(),
        user_id=user_id,
        hostname=hostname,
        server_url="http://test.local",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(instance)
    rt = DaemonRuntime(
        id=uuid.uuid4(),
        daemon_instance_id=instance.id,
        user_id=user_id,
        name=hostname,
        provider="claude_code",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    db_session.add(rt)
    await db_session.commit()
    await db_session.refresh(rt)
    return rt


async def _seed_lease(
    db_session: AsyncSession, runtime_id: uuid.UUID, *, status: str = "pending"
) -> DaemonTaskLease:
    """创建挂该 runtime 的 lease（本端点只看 runtime_id+status，无需 AgentRun）。"""
    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=runtime_id,
        agent_run_id=None,
        kind="batch",
        status=status,
        metadata_={},
        created_at=now,
        updated_at=now,
    )
    db_session.add(lease)
    await db_session.commit()
    await db_session.refresh(lease)
    return lease


async def _create_workspace_row(db_session: AsyncSession, *, root_path: str) -> Workspace:
    """直接插 Workspace 行（绕开 scan），created_by 挂测试 admin。"""
    user = await _create_user(db_session, label="ws-owner")
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"slug-{uuid.uuid4().hex[:8]}",
        root_path=root_path,
        status="active",
        created_by=user.id,
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _create_spec_workspace_row(
    db_session: AsyncSession, *, workspace_id: uuid.UUID, spec_root: str
) -> SpecWorkspace:
    """直接插 SpecWorkspace 行定位 specDir（照 test_workspace_skills_view 模式）。"""
    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        spec_root=spec_root,
        strategy="platform-managed",
        sync_status="synced",
    )
    db_session.add(spec_ws)
    await db_session.commit()
    return spec_ws


@pytest.mark.parametrize("with_auth", [True, False], ids=["authed", "no_auth"])
async def test_auth_gate(
    client: AsyncClient, auth_headers: dict[str, str], with_auth: bool
) -> None:
    """无 Authorization 头 → 401；有 daemon/admin token → 200。"""
    headers = auth_headers if with_auth else {}
    resp = await client.get("/api/daemon/mcp/config", headers=headers)
    if with_auth:
        assert resp.status_code == 200
        body = resp.json()
        assert body == {"platform_default": {"mcpServers": {}}, "whitelist": []}
    else:
        assert resp.status_code in (401, 403)


# ── registry-seed 用例（task-05：原七个 KV-seed 用例换源重写）────────────────


async def test_empty_when_no_settings(client: AsyncClient, auth_headers: dict[str, str]) -> None:
    """registry 空库 + 无 whitelist KV → 200 空结构不报错（空集回落语义）。"""
    resp = await client.get("/api/daemon/mcp/config", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == {"platform_default": {"mcpServers": {}}, "whitelist": []}


async def test_returns_unredacted_env(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
) -> None:
    """encrypted_env 解密回填真值原样返回，不遮蔽（D-004；区别 admin 视图脱敏）。"""
    admin = await _create_user(db_session, label="adm", admin=True)
    await _seed_platform_server(
        db_session,
        admin,
        name="github",
        server_config={
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-github"],
            "env": dict(_SECRET_ENV),
        },
    )
    await _seed_platform_server(
        db_session,
        admin,
        name="filesystem",
        server_config={
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
        },
    )
    await _put_setting(db_session, "mcp.whitelist", ["github", "filesystem"])

    resp = await client.get("/api/daemon/mcp/config", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()

    platform_default = body["platform_default"]
    servers = platform_default["mcpServers"]
    assert set(servers.keys()) == {"github", "filesystem"}

    github_env = servers["github"]["env"]
    # 关键断言：四个 secret 类 key 都是解密回填的真值，不是 "<set>" 遮蔽占位。
    assert github_env["GITHUB_TOKEN"] == "ghp_super_secret_value"
    assert github_env["API_KEY"] == "sk-real-key-123"
    assert github_env["DB_PASSWORD"] == "p@ssw0rd"
    assert github_env["CLIENT_SECRET"] == "secret-xyz"
    assert github_env["NORMAL_VAR"] == "visible-anyway"
    # 非 env 字段原样透传。
    assert servers["filesystem"]["command"] == "npx"
    assert servers["filesystem"]["args"] == [
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/tmp",
    ]

    assert body["whitelist"] == ["github", "filesystem"]


async def test_partial_config_platform_default_only(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
) -> None:
    """registry 有 platform binding 但 whitelist KV 缺失 → whitelist 归一为 []。"""
    admin = await _create_user(db_session, label="adm", admin=True)
    await _seed_platform_server(
        db_session,
        admin,
        name="time",
        server_config={"command": "uvx", "args": ["mcp-server-time"]},
    )

    resp = await client.get("/api/daemon/mcp/config", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["platform_default"]["mcpServers"]["time"]["command"] == "uvx"
    assert body["whitelist"] == []


async def test_partial_config_whitelist_only(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
) -> None:
    """只配 whitelist KV、registry 空库 → platform 位空 mcpServers 结构。"""
    await _put_setting(db_session, "mcp.whitelist", ["time", "fetch"])

    resp = await client.get("/api/daemon/mcp/config", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["platform_default"] == {"mcpServers": {}}
    assert body["whitelist"] == ["time", "fetch"]


async def test_dirty_data_normalized(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
) -> None:
    """脏数据归一不报错：whitelist 非 list → []；残留 mcp.platform_default 脏 KV
    （D-003 弃用不读）不进响应——platform 位只来自 registry 渲染。"""
    await _put_setting(db_session, "mcp.platform_default", ["not", "a", "dict"])
    await _put_setting(db_session, "mcp.whitelist", {"oops": "object"})

    resp = await client.get("/api/daemon/mcp/config", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    # 残留脏 KV 不读 → platform 恒为合法空结构；whitelist 非列表 → []。
    assert body == {"platform_default": {"mcpServers": {}}, "whitelist": []}


async def test_platform_default_missing_mcp_servers_key(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
) -> None:
    """server 存在但无 binding → 不进注入集，platform 位仍输出 {mcpServers:{}}
    包装键（原"缺 mcpServers key 补空"语义的 registry 版）。"""
    admin = await _create_user(db_session, label="adm", admin=True)
    await _seed_platform_server(
        db_session,
        admin,
        name="orphan",
        server_config={"command": "uvx", "args": ["mcp-server-time"]},
        bind=False,
    )

    resp = await client.get("/api/daemon/mcp/config", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["platform_default"] == {"mcpServers": {}}


async def test_admin_view_redacts_but_daemon_view_does_not(
    client: AsyncClient,
    auth_headers: dict[str, str],
    db_session: AsyncSession,
) -> None:
    """对照断言：admin 详情（/api/mcp-servers/{id}）遮蔽 secret，daemon GET 返
    解密真值（D-004）。"""
    admin = await _create_user(db_session, label="adm", admin=True)
    row = await _seed_platform_server(
        db_session,
        admin,
        name="secret-server",
        server_config={"command": "run", "env": {"API_TOKEN": "real-token-xyz"}},
    )

    # daemon 视图（本端点）：解密真值
    daemon_resp = await client.get("/api/daemon/mcp/config", headers=auth_headers)
    assert daemon_resp.status_code == 200
    daemon_env = daemon_resp.json()["platform_default"]["mcpServers"]["secret-server"]["env"]
    assert daemon_env["API_TOKEN"] == "real-token-xyz"

    # admin 视图（mcp_registry 详情端点）：secret 键已被写路径抽列（server_config.env
    # 不含明文），encrypted_env 密文 ct 遮蔽为 <set>——真值只走 daemon 渲染解密。
    admin_resp = await client.get(f"/api/mcp-servers/{row.id}", headers=auth_headers)
    assert admin_resp.status_code == 200
    admin_body = admin_resp.json()
    assert "API_TOKEN" not in admin_body["server_config"].get("env", {})
    assert admin_body["encrypted_env"]["API_TOKEN"]["ct"] == "<set>"


# ── user_id 维度（task-05，D-010 授权三态 + 渲染 503）────────────────────────


async def test_user_id_with_valid_lease_returns_union(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """合法 lease 归属的 user_id → 200 + platform ∪ user 注入集（D-010 通过态）。"""
    principal, token = await _create_principal_with_token(db_session, label="daemon-owner")
    headers = {"Authorization": f"Bearer {token}"}
    admin = await _create_user(db_session, label="adm", admin=True)
    await _seed_platform_server(
        db_session,
        admin,
        name="plat-fetch",
        server_config={"command": "uvx", "args": ["mcp-server-fetch"]},
    )
    await _seed_user_server(
        db_session,
        principal,
        name="mine-github",
        server_config={
            "command": "npx",
            "args": ["-y", "server-github"],
            "env": {"API_TOKEN": "user-private-token"},
        },
    )
    rt = await _seed_runtime(db_session, principal.id)
    await _seed_lease(db_session, rt.id, status="claimed")

    resp = await client.get(
        "/api/daemon/mcp/config", headers=headers, params={"user_id": str(principal.id)}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    servers = body["platform_default"]["mcpServers"]
    assert set(servers.keys()) == {"plat-fetch", "mine-github"}
    # user 私有 secret 解密回填真值（授权后才可见）。
    assert servers["mine-github"]["env"]["API_TOKEN"] == "user-private-token"
    # 响应形状不变：不带 workspace_id 两键。
    assert set(body.keys()) == {"platform_default", "whitelist"}
    assert body["whitelist"] == []


@pytest.mark.parametrize(
    "lease_status",
    [None, "completed"],
    ids=["no_lease", "terminal_lease"],
)
async def test_user_id_without_active_lease_404(
    client: AsyncClient, db_session: AsyncSession, lease_status: str | None
) -> None:
    """user_id 无活跃 lease 背书（不存在 / 终态）→ 404 不泄露存在性（D-010）。"""
    principal, token = await _create_principal_with_token(db_session, label="daemon-owner")
    headers = {"Authorization": f"Bearer {token}"}
    rt = await _seed_runtime(db_session, principal.id)
    if lease_status is not None:
        await _seed_lease(db_session, rt.id, status=lease_status)

    resp = await client.get(
        "/api/daemon/mcp/config", headers=headers, params={"user_id": str(principal.id)}
    )
    assert resp.status_code == 404, resp.text
    assert "活跃任务租约" in resp.json()["message"]


async def test_user_id_cross_daemon_404(client: AsyncClient, db_session: AsyncSession) -> None:
    """lease 挂在他人 runtime（跨 daemon 归属）→ 404（D-010 跨主体拒绝态）。"""
    _principal, token = await _create_principal_with_token(db_session, label="daemon-owner")
    headers = {"Authorization": f"Bearer {token}"}
    other = await _create_user(db_session, label="other-owner")
    rt_other = await _seed_runtime(db_session, other.id, hostname="other-host")
    await _seed_lease(db_session, rt_other.id, status="claimed")

    # 他人 runtime 确有活跃 lease，但认证主体不是该 runtime 的归属人 → 404。
    resp = await client.get(
        "/api/daemon/mcp/config", headers=headers, params={"user_id": str(other.id)}
    )
    assert resp.status_code == 404, resp.text
    assert "活跃任务租约" in resp.json()["message"]


async def test_render_error_returns_503(
    client: AsyncClient, auth_headers: dict[str, str], monkeypatch: pytest.MonkeyPatch
) -> None:
    """render_injection_set 抛错 → 503（daemon fetch 非 200 回落本地 mcp.json
    链路保持可达；空库 200 空集与渲染故障 503 语义分开，兼容策略 CC-14）。"""
    from app.modules.mcp_registry import render as render_mod

    async def _boom(session: Any, user_id: uuid.UUID | None) -> dict[str, Any]:
        raise RuntimeError("registry db down")

    monkeypatch.setattr(render_mod, "render_injection_set", _boom)
    resp = await client.get("/api/daemon/mcp/config", headers=auth_headers)
    assert resp.status_code == 503, resp.text
    assert "渲染" in resp.json()["message"]


# ── workspace_id 维度（2026-08-26-workspace-mcp-edit task-03，design §7.2）────


async def test_workspace_param_returns_unredacted_config(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession, tmp_path: Path
) -> None:
    """带 workspace_id 且 .mcp.json 存在 → workspace.mcpServers 明文不脱敏（§7.2）。"""
    spec_root = tmp_path / "spec"
    spec_root.mkdir()
    mcp = {
        "mcpServers": {
            "db_local": {
                "command": "postgres",
                "args": ["--port", "5433"],
                "env": {"DB_PASSWORD": "plain-secret-123", "POOL": "10"},
            }
        }
    }
    (spec_root / ".mcp.json").write_text(json.dumps(mcp), encoding="utf-8")

    ws = await _create_workspace_row(db_session, root_path=str(spec_root))
    await _create_spec_workspace_row(db_session, workspace_id=ws.id, spec_root=str(spec_root))

    resp = await client.get(
        "/api/daemon/mcp/config", headers=auth_headers, params={"workspace_id": str(ws.id)}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()

    # workspace 键存在且为明文真值（不脱敏，区别 workspace mcp-config GET 视图）。
    db_env = body["workspace"]["mcpServers"]["db_local"]["env"]
    assert db_env["DB_PASSWORD"] == "plain-secret-123"
    assert db_env["POOL"] == "10"
    assert body["workspace"]["mcpServers"]["db_local"]["command"] == "postgres"
    # 三件套其余两件照常返回。
    assert body["platform_default"] == {"mcpServers": {}}
    assert body["whitelist"] == []


async def test_workspace_param_no_file_returns_empty(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession, tmp_path: Path
) -> None:
    """带 workspace_id 但 specDir 无 .mcp.json → workspace 空 mcpServers 不报错。"""
    spec_root = tmp_path / "spec"
    spec_root.mkdir()

    ws = await _create_workspace_row(db_session, root_path=str(spec_root))
    await _create_spec_workspace_row(db_session, workspace_id=ws.id, spec_root=str(spec_root))

    resp = await client.get(
        "/api/daemon/mcp/config", headers=auth_headers, params={"workspace_id": str(ws.id)}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["workspace"] == {"mcpServers": {}}


async def test_workspace_param_no_spec_ws_returns_empty(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession, tmp_path: Path
) -> None:
    """带 workspace_id 但 workspace 无 spec_ws 绑定 → 空配置不报错（容错集）。"""
    ws = await _create_workspace_row(db_session, root_path=str(tmp_path))

    resp = await client.get(
        "/api/daemon/mcp/config", headers=auth_headers, params={"workspace_id": str(ws.id)}
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["workspace"] == {"mcpServers": {}}


async def test_without_workspace_param_no_workspace_key(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
) -> None:
    """不带 workspace_id → 响应无 workspace key，与旧版结构完全一致（R-07 回归）。"""
    await _put_setting(db_session, "mcp.whitelist", ["github"])

    resp = await client.get("/api/daemon/mcp/config", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert set(body.keys()) == {"platform_default", "whitelist"}
    assert body == {"platform_default": {"mcpServers": {}}, "whitelist": ["github"]}


async def test_workspace_param_workspace_not_found(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """带 workspace_id 但 workspace 不存在 → 404 中文报错。"""
    missing_id = uuid.uuid4()
    resp = await client.get(
        "/api/daemon/mcp/config", headers=auth_headers, params={"workspace_id": str(missing_id)}
    )
    assert resp.status_code == 404, resp.text
    body = resp.json()
    assert "工作区不存在" in body["message"]


async def test_workspace_param_invalid_uuid_422(
    client: AsyncClient, auth_headers: dict[str, str]
) -> None:
    """workspace_id 非 UUID → 422（全局校验处理器中文报错）。"""
    resp = await client.get(
        "/api/daemon/mcp/config", headers=auth_headers, params={"workspace_id": "not-a-uuid"}
    )
    assert resp.status_code == 422, resp.text
    body = resp.json()
    assert "请求参数校验失败" in body["message"]
