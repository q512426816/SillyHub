"""Tests for ``GET /api/daemon/mcp/config`` (task-05, design D-004).

daemon skill-manager / mcp-config 启动时拉平台默认 MCP 配置 + server 白名单，
注入 claude 启动 env。关键差异：本端点返**原值不脱敏**（daemon 需真实 env），
区别 task-04 admin GET ``/api/platform-settings/mcp`` 的遮蔽视图（D-008）。

覆盖：
* daemon token 认证通（200，Bearer JWT 经 get_current_principal）
* 无 token → 401
* 无配置返空结构 ``{"platform_default": {"mcpServers": {}}, "whitelist": []}``
* 有配置返原值：env secret 类 key（token/key/secret/password）**不遮蔽**
* platform_default / whitelist 各自脏数据归一不报错

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
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.settings.model import PlatformSetting
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace


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


async def _create_workspace_row(db_session: AsyncSession, *, root_path: str) -> Workspace:
    """直接插 Workspace 行（绕开 scan），created_by 挂测试 admin。"""
    from app.modules.auth.model import User

    user = User(
        id=uuid.uuid4(),
        email=f"ws-owner-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="irrelevant",
        display_name="ws-owner",
        status="active",
    )
    db_session.add(user)
    await db_session.flush()

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


async def test_empty_when_no_settings(client: AsyncClient, auth_headers: dict[str, str]) -> None:
    """无任何 mcp.* 配置 → 空结构不报错。"""
    resp = await client.get("/api/daemon/mcp/config", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == {"platform_default": {"mcpServers": {}}, "whitelist": []}


async def test_returns_unredacted_env(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
) -> None:
    """env secret 类 key（token/key/secret/password）原值返回，不遮蔽（D-004 vs D-008）。"""
    await _put_setting(
        db_session,
        "mcp.platform_default",
        {
            "mcpServers": {
                "github": {
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-github"],
                    "env": {
                        "GITHUB_TOKEN": "ghp_super_secret_value",
                        "API_KEY": "sk-real-key-123",
                        "DB_PASSWORD": "p@ssw0rd",
                        "CLIENT_SECRET": "secret-xyz",
                        "NORMAL_VAR": "visible-anyway",
                    },
                },
                "filesystem": {
                    "command": "npx",
                    "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
                },
            }
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
    # 关键断言：四个 secret 类 key 都是原值，不是 "<set>" 遮蔽占位。
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
    """只配 platform_default 无 whitelist → whitelist 归一为 []。"""
    await _put_setting(
        db_session,
        "mcp.platform_default",
        {"mcpServers": {"time": {"command": "uvx", "args": ["mcp-server-time"]}}},
    )

    resp = await client.get("/api/daemon/mcp/config", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["platform_default"]["mcpServers"]["time"]["command"] == "uvx"
    assert body["whitelist"] == []


async def test_partial_config_whitelist_only(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
) -> None:
    """只配 whitelist 无 platform_default → platform_default 归一为 {mcpServers:{}}。"""
    await _put_setting(db_session, "mcp.whitelist", ["time", "fetch"])

    resp = await client.get("/api/daemon/mcp/config", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["platform_default"] == {"mcpServers": {}}
    assert body["whitelist"] == ["time", "fetch"]


async def test_dirty_data_normalized(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
) -> None:
    """DB 脏数据（非 dict / 缺 mcpServers / 非列表）归一不报错。"""
    await _put_setting(db_session, "mcp.platform_default", ["not", "a", "dict"])
    await _put_setting(db_session, "mcp.whitelist", {"oops": "object"})

    resp = await client.get("/api/daemon/mcp/config", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    # platform_default 非 dict → 归一为 {mcpServers:{}}；whitelist 非列表 → []
    assert body == {"platform_default": {"mcpServers": {}}, "whitelist": []}


async def test_platform_default_missing_mcp_servers_key(
    client: AsyncClient, auth_headers: dict[str, str], db_session: AsyncSession
) -> None:
    """platform_default 是 dict 但缺 mcpServers key → 补 {mcpServers:{}}。"""
    await _put_setting(db_session, "mcp.platform_default", {"other": "field"})

    resp = await client.get("/api/daemon/mcp/config", headers=auth_headers)
    assert resp.status_code == 200
    body = resp.json()
    assert body["platform_default"] == {"other": "field", "mcpServers": {}}


async def test_admin_view_redacts_but_daemon_view_does_not(
    client: AsyncClient,
    auth_headers: dict[str, str],
    db_session: AsyncSession,
) -> None:
    """对照断言：admin GET 遮蔽 secret，daemon GET 返原值（D-004 vs D-008）。"""
    await _put_setting(
        db_session,
        "mcp.platform_default",
        {
            "mcpServers": {
                "secret-server": {
                    "command": "run",
                    "env": {"API_TOKEN": "real-token-xyz"},
                }
            }
        },
    )

    # daemon 视图（本端点）：原值
    daemon_resp = await client.get("/api/daemon/mcp/config", headers=auth_headers)
    assert daemon_resp.status_code == 200
    daemon_env = daemon_resp.json()["platform_default"]["mcpServers"]["secret-server"]["env"]
    assert daemon_env["API_TOKEN"] == "real-token-xyz"

    # admin 视图（task-04 端点）：遮蔽为 <set>
    admin_resp = await client.get("/api/platform-settings/mcp", headers=auth_headers)
    assert admin_resp.status_code == 200
    admin_env = admin_resp.json()["mcpServers"]["secret-server"]["env"]
    assert admin_env["API_TOKEN"] == "<set>"


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
