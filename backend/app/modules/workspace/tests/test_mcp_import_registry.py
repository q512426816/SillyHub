"""从 MCP 资产库选入 workspace（POST /api/workspaces/{id}/mcp/import-from-registry）。

2026-09-11-workspace-asset-bridges task-02 / FR-02（GWT）/ D-004（写入语义）/
D-009（三态契约）：
- 权限：非成员 / 只读成员 → 403；Writer → 201
- 成功导入：解密 env 明文写盘（D-004：解密仅发生在导入内容构造期）、
  command/args 原样、GET mcp-config 脱敏口径一致；无现有文件直接建新文件
- 三态（D-009）：解密失败 422 中文文案（密文无法解密）且不落盘；server
  停用 / 无绑定可导入但响应带 warning；registry 侧 server/binding 零变化
- 同名改名（D-004）：同名冲突后缀 ``-registry`` 循环避撞，其余既有条目不变
- 审计：手工插行含 server_id 与改名结果，不含 env 明文
- 可见性：跨用户私有 server 与不存在 id 同 404（防枚举，registry 同口径）

fixture 构造沿用 test_mcp_config_write.py 的直插模式（workspace / spec_ws 行
直接插入，specDir 用 tmp_path 建真实目录）；registry server 用真实
McpRegistryService 创建（conftest 注入 SILLYSPEC_MASTER_KEY=v1，真加解密不
mock），不 mock 被测端点与 service，断言真实 HTTP 响应与磁盘副作用。
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.mcp_registry.model import McpServer, McpServerBinding
from app.modules.mcp_registry.schema import McpServerCreate, McpServerUpdate
from app.modules.mcp_registry.service import McpRegistryService
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workflow.model import AuditLog
from app.modules.workspace.model import Workspace

# ── helpers（沿用 test_mcp_config_write.py 的直插模式）──────────────────


async def _create_user(
    session: AsyncSession,
    *,
    is_platform_admin: bool = False,
    email: str | None = None,
) -> User:
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=email or f"user-{uid}@example.com",
        password_hash="irrelevant",
        display_name=f"User-{str(uid)[:4]}",
        status="active",
        is_platform_admin=is_platform_admin,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


def _token_for(user: User) -> str:
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=settings,
    )
    return token


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _grant_workspace_permission(
    session: AsyncSession,
    *,
    user_id: uuid.UUID,
    workspace_id: uuid.UUID,
    permission: Permission,
) -> None:
    """建一个只含单个权限的角色并授予该 workspace 成员（参照 test_probe_endpoint 模式）。"""
    role = Role(
        id=uuid.uuid4(),
        key=f"test-ws-{permission.value}-{uuid.uuid4().hex[:6]}",
        name=f"test {permission.value}",
    )
    session.add(role)
    await session.flush()
    session.add(RolePermission(role_id=role.id, permission=permission.value))
    session.add(UserWorkspaceRole(user_id=user_id, workspace_id=workspace_id, role_id=role.id))
    await session.commit()


async def _create_workspace(
    session: AsyncSession,
    *,
    created_by: uuid.UUID,
    root_path: str,
) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"slug-{uuid.uuid4().hex[:8]}",
        root_path=root_path,
        status="active",
        created_by=created_by,
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _create_spec_workspace(
    session: AsyncSession,
    *,
    workspace_id: uuid.UUID,
    spec_root: str,
) -> SpecWorkspace:
    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        spec_root=spec_root,
        strategy="platform-managed",
        sync_status="synced",
    )
    session.add(spec_ws)
    await session.commit()
    await session.refresh(spec_ws)
    return spec_ws


async def _setup_spec_workspace(
    session: AsyncSession,
    tmp_path: Path,
    *,
    initial_mcp: dict | None = None,
) -> tuple[Workspace, Path]:
    """建 owner + workspace + spec 工作区（specDir = tmp_path/spec）。"""
    owner = await _create_user(session)
    spec_root = tmp_path / "spec"
    spec_root.mkdir()
    mcp_path = spec_root / ".mcp.json"
    if initial_mcp is not None:
        mcp_path.write_text(json.dumps(initial_mcp, ensure_ascii=False), encoding="utf-8")

    ws = await _create_workspace(session, created_by=owner.id, root_path=str(spec_root))
    await _create_spec_workspace(session, workspace_id=ws.id, spec_root=str(spec_root))
    return ws, mcp_path


async def _create_registry_server(
    session: AsyncSession,
    *,
    owner: User,
    name: str,
    env: dict | None = None,
    secret_env_keys: list[str] | None = None,
    add_user_binding: bool = False,
) -> McpServer:
    """经真实 McpRegistryService 建资产库 server（真加密，不 mock cipher）。"""
    svc = McpRegistryService(session)
    server_config: dict = {"command": "npx", "args": ["-y", f"mcp-{name}"]}
    if env is not None:
        server_config["env"] = env
    created = await svc.create_server(
        McpServerCreate(name=name, server_config=server_config, secret_env_keys=secret_env_keys),
        owner,
    )
    if add_user_binding:
        await svc.add_binding(created.id, "user", owner)
    row = await session.get(McpServer, created.id)
    assert row is not None
    return row


def _import_url(workspace_id: uuid.UUID) -> str:
    return f"/api/workspaces/{workspace_id}/mcp/import-from-registry"


# ── 1. 权限矩阵（非成员/只读成员 403，Writer 201）──────────────────────────


async def test_非成员_import_被拒_403(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 普通用户不是工作区成员 When POST import Then 403 且文件不落盘。"""
    # Arrange
    ws, mcp_path = await _setup_spec_workspace(db_session, tmp_path)
    outsider = await _create_user(db_session, email="outsider@example.com")
    server = await _create_registry_server(db_session, owner=outsider, name="fetch")

    # Act
    resp = await client.post(
        _import_url(ws.id),
        json={"server_id": str(server.id)},
        headers=_headers(_token_for(outsider)),
    )

    # Assert
    assert resp.status_code == 403, resp.text
    assert not mcp_path.exists()


async def test_只读成员_import_被拒_403(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 成员只有 WORKSPACE_READ（无 WRITE）When POST import Then 403。"""
    # Arrange
    ws, mcp_path = await _setup_spec_workspace(db_session, tmp_path)
    reader = await _create_user(db_session, email="reader@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=reader.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_READ,
    )
    server = await _create_registry_server(db_session, owner=reader, name="fetch")

    # Act
    resp = await client.post(
        _import_url(ws.id), json={"server_id": str(server.id)}, headers=_headers(_token_for(reader))
    )

    # Assert
    assert resp.status_code == 403, resp.text
    assert not mcp_path.exists()


# ── 2. 成功导入（D-004：解密 env 明文写盘；GET 脱敏一致）────────────────────


async def test_writer导入自己的server_解密env明文写盘_无warning(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 启用+有绑定的私有 server（密钥键已加密）When Writer import Then 201 且盘上 env 为解密明文。"""
    # Arrange
    ws, mcp_path = await _setup_spec_workspace(db_session, tmp_path)
    writer = await _create_user(db_session, email="writer@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=writer.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_WRITE,
    )
    server = await _create_registry_server(
        db_session,
        owner=writer,
        name="fetch",
        env={"API_TOKEN": "ghp-real-token", "CACHE_DIR": "/tmp"},
        secret_env_keys=["API_TOKEN"],
        add_user_binding=True,
    )

    # Act
    resp = await client.post(
        _import_url(ws.id), json={"server_id": str(server.id)}, headers=_headers(_token_for(writer))
    )

    # Assert
    assert resp.status_code == 201, resp.text
    payload = resp.json()
    assert payload["written_name"] == "fetch"
    assert payload["renamed"] is False
    assert payload["warning"] is None  # 启用 + 有绑定 → 干净导入（D-009）
    on_disk = json.loads(mcp_path.read_text(encoding="utf-8"))
    entry = on_disk["mcpServers"]["fetch"]
    assert entry["command"] == "npx"
    assert entry["args"] == ["-y", "mcp-fetch"]
    assert entry["env"] == {"API_TOKEN": "ghp-real-token", "CACHE_DIR": "/tmp"}  # 解密明文


async def test_导入后_get_mcp_config可见新server_脱敏一致(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 已导入含密钥 env 的 server When GET mcp-config Then 新 server 可见且密钥遮蔽。"""
    # Arrange
    ws, _ = await _setup_spec_workspace(db_session, tmp_path)
    writer = await _create_user(db_session, email="writer2@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=writer.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_WRITE,
    )
    # GET mcp-config 需 WORKSPACE_READ（写角色只授了 WRITE，补读权限）
    await _grant_workspace_permission(
        db_session,
        user_id=writer.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_READ,
    )
    server = await _create_registry_server(
        db_session,
        owner=writer,
        name="context7",
        env={"API_TOKEN": "sk-plain", "POOL": "10"},
        secret_env_keys=["API_TOKEN"],
    )
    imported = await client.post(
        _import_url(ws.id), json={"server_id": str(server.id)}, headers=_headers(_token_for(writer))
    )
    assert imported.status_code == 201, imported.text

    # Act
    resp = await client.get(
        f"/api/workspaces/{ws.id}/mcp-config", headers=_headers(_token_for(writer))
    )

    # Assert
    assert resp.status_code == 200, resp.text
    env = resp.json()["mcpServers"]["context7"]["env"]
    assert env["API_TOKEN"] == "<set>"  # 与 GET 既有口径一致（_redact_mcp_env）
    assert env["POOL"] == "10"


async def test_无现有文件_直接写新文件(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 盘上无 .mcp.json When import Then 直接建新文件（merge 基为空）。"""
    # Arrange
    ws, mcp_path = await _setup_spec_workspace(db_session, tmp_path)
    writer = await _create_user(db_session, email="fresh-writer@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=writer.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_WRITE,
    )
    server = await _create_registry_server(db_session, owner=writer, name="fresh")

    # Act
    resp = await client.post(
        _import_url(ws.id), json={"server_id": str(server.id)}, headers=_headers(_token_for(writer))
    )

    # Assert
    assert resp.status_code == 201, resp.text
    on_disk = json.loads(mcp_path.read_text(encoding="utf-8"))
    assert set(on_disk["mcpServers"]) == {"fresh"}


async def test_既有server逐字保留(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 盘上已有既有 server When import 新 server Then 既有条目内容不变、新条目并存。"""
    # Arrange
    initial = {
        "mcpServers": {
            "existing": {
                "command": "postgres",
                "env": {"DATABASE_PASSWORD": "keep-me", "POOL": "10"},
            }
        }
    }
    ws, mcp_path = await _setup_spec_workspace(db_session, tmp_path, initial_mcp=initial)
    writer = await _create_user(db_session, email="keep-writer@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=writer.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_WRITE,
    )
    server = await _create_registry_server(db_session, owner=writer, name="newcomer")

    # Act
    resp = await client.post(
        _import_url(ws.id), json={"server_id": str(server.id)}, headers=_headers(_token_for(writer))
    )

    # Assert
    assert resp.status_code == 201, resp.text
    on_disk = json.loads(mcp_path.read_text(encoding="utf-8"))
    assert set(on_disk["mcpServers"]) == {"existing", "newcomer"}
    assert on_disk["mcpServers"]["existing"] == initial["mcpServers"]["existing"]  # 逐字不变


# ── 3. 同名冲突改名（D-004：后缀 -registry 循环避撞）────────────────────────


async def test_同名冲突_改名registry(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 盘上已有同名 server When import Then 写入为原名-registry 且原条目不变。"""
    # Arrange
    initial = {"mcpServers": {"fetch": {"command": "old-fetch"}}}
    ws, mcp_path = await _setup_spec_workspace(db_session, tmp_path, initial_mcp=initial)
    writer = await _create_user(db_session, email="rename-writer@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=writer.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_WRITE,
    )
    server = await _create_registry_server(db_session, owner=writer, name="fetch")

    # Act
    resp = await client.post(
        _import_url(ws.id), json={"server_id": str(server.id)}, headers=_headers(_token_for(writer))
    )

    # Assert
    assert resp.status_code == 201, resp.text
    payload = resp.json()
    assert payload["written_name"] == "fetch-registry"
    assert payload["renamed"] is True
    on_disk = json.loads(mcp_path.read_text(encoding="utf-8"))
    assert set(on_disk["mcpServers"]) == {"fetch", "fetch-registry"}
    assert on_disk["mcpServers"]["fetch"] == {"command": "old-fetch"}  # 原条目不被覆盖
    assert on_disk["mcpServers"]["fetch-registry"]["command"] == "npx"


async def test_改名循环避撞(client: AsyncClient, db_session: AsyncSession, tmp_path: Path) -> None:
    """Given 原名与原名-registry 均被占用 When import Then 循环追加后缀至 fetch-registry-registry。"""
    # Arrange
    initial = {
        "mcpServers": {
            "fetch": {"command": "old-fetch"},
            "fetch-registry": {"command": "older-fetch"},
        }
    }
    ws, mcp_path = await _setup_spec_workspace(db_session, tmp_path, initial_mcp=initial)
    writer = await _create_user(db_session, email="loop-writer@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=writer.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_WRITE,
    )
    server = await _create_registry_server(db_session, owner=writer, name="fetch")

    # Act
    resp = await client.post(
        _import_url(ws.id), json={"server_id": str(server.id)}, headers=_headers(_token_for(writer))
    )

    # Assert
    assert resp.status_code == 201, resp.text
    payload = resp.json()
    assert payload["written_name"] == "fetch-registry-registry"
    assert payload["renamed"] is True
    on_disk = json.loads(mcp_path.read_text(encoding="utf-8"))
    assert set(on_disk["mcpServers"]) == {"fetch", "fetch-registry", "fetch-registry-registry"}
    assert on_disk["mcpServers"]["fetch-registry"] == {"command": "older-fetch"}  # 撞名条目也不动


# ── 4. D-009 三态：解密失败 422 / 停用或无绑定 warning 可导入 ────────────────


async def test_解密失败_422_中文文案_不落盘(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Given 主密钥轮换后旧密文失配 When import Then 422 明确密文无法解密且文件不落盘。"""
    # Arrange：v1 真实密钥建 server → 把默认 cipher 换成 v2 失配密钥
    ws, mcp_path = await _setup_spec_workspace(db_session, tmp_path, initial_mcp={"mcpServers": {}})
    writer = await _create_user(db_session, email="stale-writer@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=writer.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_WRITE,
    )
    server = await _create_registry_server(
        db_session,
        owner=writer,
        name="stale-secret",
        env={"API_TOKEN": "old-value"},
        secret_env_keys=["API_TOKEN"],
    )
    original_text = mcp_path.read_text(encoding="utf-8")

    import app.core.crypto as crypto_module
    from app.core.crypto import CredentialCipher

    monkeypatch.setattr(
        crypto_module, "get_cipher", lambda: CredentialCipher(bytes.fromhex("bb" * 32), "v2")
    )
    assert (
        crypto_module.get_cipher().key_id == "v2"
    )  # monkeypatch 生效自检（service 惰性取默认 cipher）

    # Act
    resp = await client.post(
        _import_url(ws.id), json={"server_id": str(server.id)}, headers=_headers(_token_for(writer))
    )

    # Assert
    assert resp.status_code == 422, resp.text
    payload = resp.json()
    assert payload["code"] == "HTTP_422_MCP_REGISTRY_ENV_UNDECRYPTABLE"
    assert "密文" in payload["message"] and "解密" in payload["message"]  # 中文文案明确密文无法解密
    assert any("\u4e00" <= ch <= "\u9fff" for ch in payload["message"])
    assert mcp_path.read_text(encoding="utf-8") == original_text  # 盘上未被破坏
    assert "old-value" not in mcp_path.read_text(encoding="utf-8")  # 密文绝不写盘


async def test_停用且无绑定_可导入带warning(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given server 已停用且无绑定 When import Then 201 写盘成功但响应带 warning（D-009）。"""
    # Arrange
    ws, mcp_path = await _setup_spec_workspace(db_session, tmp_path)
    writer = await _create_user(db_session, email="warn-writer@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=writer.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_WRITE,
    )
    svc = McpRegistryService(db_session)
    server = await _create_registry_server(
        db_session, owner=writer, name="disabled-srv", env={"POOL": "5"}
    )
    await svc.update_server(server.id, McpServerUpdate(enabled=False), writer)  # 停用（仍无绑定）

    # Act
    resp = await client.post(
        _import_url(ws.id), json={"server_id": str(server.id)}, headers=_headers(_token_for(writer))
    )

    # Assert
    assert resp.status_code == 201, resp.text
    payload = resp.json()
    assert payload["written_name"] == "disabled-srv"
    assert payload["renamed"] is False
    assert payload["warning"] is not None
    assert "已停用" in payload["warning"]
    assert "未绑定" in payload["warning"]
    # .mcp.json 写入即生效——warning 不阻断落盘
    on_disk = json.loads(mcp_path.read_text(encoding="utf-8"))
    assert on_disk["mcpServers"]["disabled-srv"]["env"] == {"POOL": "5"}


async def test_导入后registry侧零变化(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 启用+有绑定 server When import Then registry 侧 server 行与 binding 集合零变化。"""
    # Arrange
    ws, _ = await _setup_spec_workspace(db_session, tmp_path)
    writer = await _create_user(db_session, email="frozen-writer@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=writer.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_WRITE,
    )
    server = await _create_registry_server(
        db_session,
        owner=writer,
        name="frozen-srv",
        env={"API_TOKEN": "secret-val", "POOL": "1"},
        secret_env_keys=["API_TOKEN"],
        add_user_binding=True,
    )
    frozen_config = json.dumps(server.server_config, sort_keys=True)
    frozen_encrypted = json.dumps(server.encrypted_env, sort_keys=True)
    frozen_updated_at = server.updated_at
    frozen_enabled = server.enabled

    # Act
    resp = await client.post(
        _import_url(ws.id), json={"server_id": str(server.id)}, headers=_headers(_token_for(writer))
    )

    # Assert
    assert resp.status_code == 201, resp.text
    # 列级 select 直接读 DB 当前值（绕 identity map 懒加载——异步 session 下
    # expire 后的 ORM 实例属性访问会炸 MissingGreenlet，列值 Row 无此问题）
    server_row = (
        await db_session.execute(
            select(
                McpServer.name,
                McpServer.enabled,
                McpServer.server_config,
                McpServer.encrypted_env,
                McpServer.updated_at,
            ).where(McpServer.id == server.id)
        )
    ).one()
    assert server_row.name == "frozen-srv"
    assert server_row.enabled is frozen_enabled  # 无 UPDATE/DELETE
    assert json.dumps(server_row.server_config, sort_keys=True) == frozen_config
    assert (
        json.dumps(server_row.encrypted_env, sort_keys=True) == frozen_encrypted
    )  # 密文一字节不动
    assert server_row.updated_at == frozen_updated_at
    bindings = (
        await db_session.execute(
            select(McpServerBinding).where(McpServerBinding.server_id == server.id)
        )
    ).scalars()
    assert len(list(bindings)) == 1  # 既有 user binding 原样，无新增/删除


# ── 5. 可见性（跨用户私有 404，与不存在同码防枚举）─────────────────────────


async def test_跨用户私有server_404(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 他人私有 server When Writer import Then 404 与不存在同码且文件不落盘。"""
    # Arrange
    ws, mcp_path = await _setup_spec_workspace(db_session, tmp_path)
    writer = await _create_user(db_session, email="vis-writer@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=writer.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_WRITE,
    )
    owner = await _create_user(db_session, email="private-owner@example.com")
    private = await _create_registry_server(db_session, owner=owner, name="private-srv")

    # Act
    resp = await client.post(
        _import_url(ws.id),
        json={"server_id": str(private.id)},
        headers=_headers(_token_for(writer)),
    )
    resp_missing = await client.post(
        _import_url(ws.id),
        json={"server_id": str(uuid.uuid4())},
        headers=_headers(_token_for(writer)),
    )

    # Assert
    assert resp.status_code == 404, resp.text
    assert resp.json()["code"] == "HTTP_404_MCP_SERVER_NOT_FOUND"
    assert resp_missing.status_code == 404  # 与不存在同码（枚举无差别）
    assert not mcp_path.exists()


# ── 6. 审计（手工插行：server_id + 改名结果，不含 env 明文）─────────────────


async def test_审计行记录server_id与改名结果_不含env明文(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 导入含密钥 env 的 server When 提交完成 Then 审计行落库且 details 不含 env 值。"""
    # Arrange
    initial = {"mcpServers": {"fetch": {"command": "old-fetch"}}}
    ws, _ = await _setup_spec_workspace(db_session, tmp_path, initial_mcp=initial)
    writer = await _create_user(db_session, email="audit-writer@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=writer.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_WRITE,
    )
    server = await _create_registry_server(
        db_session,
        owner=writer,
        name="fetch",  # 与盘上同名 → 触发改名，审计记录改名结果
        env={"API_TOKEN": "audit-secret-val"},
        secret_env_keys=["API_TOKEN"],
    )

    # Act
    resp = await client.post(
        _import_url(ws.id), json={"server_id": str(server.id)}, headers=_headers(_token_for(writer))
    )

    # Assert
    assert resp.status_code == 201, resp.text
    rows = (
        (
            await db_session.execute(
                select(AuditLog).where(
                    AuditLog.workspace_id == ws.id,
                    AuditLog.actor_id == writer.id,
                    AuditLog.action == "workspace_mcp_config.import_from_registry",
                )
            )
        )
        .scalars()
        .all()
    )
    assert len(rows) == 1, "导入成功后应落一条 import 审计行"
    details = json.loads(rows[0].details_json or "{}")
    assert details["server_id"] == str(server.id)
    assert details["written_name"] == "fetch-registry"
    assert details["renamed"] is True
    assert "audit-secret-val" not in (rows[0].details_json or "")  # env 明文绝不进审计
