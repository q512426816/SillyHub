"""工作区 MCP 配置写接口（PUT /api/workspaces/{id}/mcp-config）测试。

2026-08-26-workspace-mcp-edit task-02 / requirements FR-01/02/03（GWT）：
- 权限：非成员 / 只读成员 → 403；Writer → 200（FR-01）
- 校验：type 非 stdio → HTTP_422_MCP_TYPE_NOT_STDIO；command 缺失 / args 非数组 /
  env 值非字符串 / 未知键 → pydantic 422；失败一律不落盘（FR-02）
- ``<set>`` 还原：成功（盘上真值、响应仍脱敏）；server 改名 / env 键新增 /
  现有文件损坏 → HTTP_422_MCP_SECRET_UNRESOLVABLE，盘上内容不变（FR-03）
- 原子写：json.load 可解析 + indent=2 + 末尾换行 + ensure_ascii=False；
  os.replace 失败 → 临时文件清理、原文件不变
- 审计：写窗口内 audit_context 注入 actor/workspace 正确 + 用后清理（实现
  现状）；「audit_logs 落行」用例以 xfail(strict) 登记实现缺口（见该用例
  reason，task-01 写路径无 ORM 变更、钩子不触发）
- 中文文案：错误 message 含 CJK（对齐 tests/core/test_error_message_l10n.py 口径）

fixture 构造沿用 test_workspace_skills_view.py 的直插模式（workspace /
spec_ws 行直接插入，specDir 用 tmp_path 建真实目录），不 mock 被测端点与
service，断言真实 HTTP 响应与磁盘副作用。
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
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workflow.model import AuditLog
from app.modules.workspace.model import Workspace

# ── helpers（沿用 test_workspace_skills_view.py 的直插模式）──────────────────


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
    initial_raw: str | None = None,
) -> tuple[Workspace, Path]:
    """建 owner + workspace + spec 工作区（specDir = tmp_path/spec）。

    ``initial_mcp``：以 JSON 写入初始 ``.mcp.json``；``initial_raw``：写原始
    文本（损坏文件场景）；两者都缺省则不建文件。
    """
    owner = await _create_user(session)
    spec_root = tmp_path / "spec"
    spec_root.mkdir()
    mcp_path = spec_root / ".mcp.json"
    if initial_mcp is not None:
        mcp_path.write_text(json.dumps(initial_mcp, ensure_ascii=False), encoding="utf-8")
    elif initial_raw is not None:
        mcp_path.write_text(initial_raw, encoding="utf-8")

    ws = await _create_workspace(session, created_by=owner.id, root_path=str(spec_root))
    await _create_spec_workspace(session, workspace_id=ws.id, spec_root=str(spec_root))
    return ws, mcp_path


def _valid_body(**servers: dict) -> dict:
    return {"mcpServers": servers}


# ── 1. 权限（FR-01：无 WorkspaceWriter 权限 → 403）─────────────────────────


async def test_非成员_put_被拒_403(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 普通用户不是工作区成员 When PUT Then 403 且文件不落盘。"""
    # Arrange
    ws, mcp_path = await _setup_spec_workspace(db_session, tmp_path)
    outsider = await _create_user(db_session, email="outsider@example.com")

    # Act
    resp = await client.put(
        f"/api/workspaces/{ws.id}/mcp-config",
        json=_valid_body(context7={"command": "npx", "args": ["-y", "pkg"]}),
        headers=_headers(_token_for(outsider)),
    )

    # Assert
    assert resp.status_code == 403, resp.text
    assert not mcp_path.exists()


async def test_只读成员_put_被拒_403(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 成员只有 WORKSPACE_READ（无 WRITE）When PUT Then 403。"""
    # Arrange
    ws, mcp_path = await _setup_spec_workspace(db_session, tmp_path)
    reader = await _create_user(db_session, email="reader@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=reader.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_READ,
    )

    # Act
    resp = await client.put(
        f"/api/workspaces/{ws.id}/mcp-config",
        json=_valid_body(context7={"command": "npx"}),
        headers=_headers(_token_for(reader)),
    )

    # Assert
    assert resp.status_code == 403, resp.text
    assert not mcp_path.exists()


async def test_writer成员_put_成功_200(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 成员持有 WORKSPACE_WRITE When PUT Then 200 且配置写盘（FR-01 主流程）。"""
    # Arrange
    ws, mcp_path = await _setup_spec_workspace(db_session, tmp_path)
    writer = await _create_user(db_session, email="writer@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=writer.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_WRITE,
    )
    body = _valid_body(
        context7={"type": "stdio", "command": "npx", "args": ["-y", "@upstash/context7-mcp"]},
    )

    # Act
    resp = await client.put(
        f"/api/workspaces/{ws.id}/mcp-config", json=body, headers=_headers(_token_for(writer))
    )

    # Assert
    assert resp.status_code == 200, resp.text
    assert resp.json()["mcpServers"]["context7"]["command"] == "npx"
    on_disk = json.loads(mcp_path.read_text(encoding="utf-8"))
    assert on_disk["mcpServers"]["context7"]["args"] == ["-y", "@upstash/context7-mcp"]


# ── 2. 校验（FR-02：仅 stdio；FR-01 结构校验；失败一律不落盘）───────────────


async def test_type非stdio_被拒_422_且不落盘(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 某 server type 为 sse When PUT Then 422 HTTP_422_MCP_TYPE_NOT_STDIO（中文）且文件不落盘。"""
    # Arrange
    ws, mcp_path = await _setup_spec_workspace(db_session, tmp_path)
    owner_email = "owner-type@example.com"
    owner = await _create_user(db_session, is_platform_admin=True, email=owner_email)
    body = _valid_body(
        remote={"type": "sse", "command": "npx", "args": []},
        local={"type": "stdio", "command": "npx"},
    )

    # Act
    resp = await client.put(
        f"/api/workspaces/{ws.id}/mcp-config", json=body, headers=_headers(_token_for(owner))
    )

    # Assert
    assert resp.status_code == 422, resp.text
    payload = resp.json()
    assert payload["code"] == "HTTP_422_MCP_TYPE_NOT_STDIO"
    assert "stdio" in payload["message"]
    assert any("\u4e00" <= ch <= "\u9fff" for ch in payload["message"])  # 中文文案
    assert not mcp_path.exists()  # 整个请求拒绝，文件不落盘


async def test_command缺失_422_不落盘(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given server 条目缺 command When PUT Then pydantic 422 且文件不落盘。"""
    # Arrange
    ws, mcp_path = await _setup_spec_workspace(db_session, tmp_path)
    admin = await _create_user(db_session, is_platform_admin=True)
    body = {"mcpServers": {"nocmd": {"args": ["--flag"]}}}  # 缺 command

    # Act
    resp = await client.put(
        f"/api/workspaces/{ws.id}/mcp-config", json=body, headers=_headers(_token_for(admin))
    )

    # Assert
    assert resp.status_code == 422, resp.text
    assert resp.json()["code"] == "validation_error"
    assert not mcp_path.exists()


async def test_args非数组_422(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given args 是字符串而非数组 When PUT Then pydantic 422（FR-01 结构校验）。"""
    # Arrange
    ws, _ = await _setup_spec_workspace(db_session, tmp_path)
    admin = await _create_user(db_session, is_platform_admin=True)
    body = {"mcpServers": {"bad": {"command": "npx", "args": "-y pkg"}}}

    # Act
    resp = await client.put(
        f"/api/workspaces/{ws.id}/mcp-config", json=body, headers=_headers(_token_for(admin))
    )

    # Assert
    assert resp.status_code == 422, resp.text
    assert resp.json()["code"] == "validation_error"


async def test_env值非字符串_422(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given env 值是数字 When PUT Then pydantic 422（env 必须字符串字典）。"""
    # Arrange
    ws, _ = await _setup_spec_workspace(db_session, tmp_path)
    admin = await _create_user(db_session, is_platform_admin=True)
    body = {"mcpServers": {"bad": {"command": "npx", "env": {"POOL": 10}}}}

    # Act
    resp = await client.put(
        f"/api/workspaces/{ws.id}/mcp-config", json=body, headers=_headers(_token_for(admin))
    )

    # Assert
    assert resp.status_code == 422, resp.text


async def test_未知顶层键_422(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 顶层多出未知键 When PUT Then pydantic 422（extra=forbid 防拼写错键静默落盘）。"""
    # Arrange
    ws, _ = await _setup_spec_workspace(db_session, tmp_path)
    admin = await _create_user(db_session, is_platform_admin=True)
    body = {
        "mcpServers": {"ok": {"command": "npx"}},
        "mcpserver": {"typo": True},  # 拼写错键
    }

    # Act
    resp = await client.put(
        f"/api/workspaces/{ws.id}/mcp-config", json=body, headers=_headers(_token_for(admin))
    )

    # Assert
    assert resp.status_code == 422, resp.text
    assert resp.json()["code"] == "validation_error"


async def test_server条目未知键_422(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given server 条目多出未知键（如 url）When PUT Then pydantic 422。"""
    # Arrange
    ws, _ = await _setup_spec_workspace(db_session, tmp_path)
    admin = await _create_user(db_session, is_platform_admin=True)
    body = {"mcpServers": {"bad": {"command": "npx", "url": "http://evil"}}}

    # Act
    resp = await client.put(
        f"/api/workspaces/{ws.id}/mcp-config", json=body, headers=_headers(_token_for(admin))
    )

    # Assert
    assert resp.status_code == 422, resp.text


async def test_校验失败不破坏已有文件(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 盘上已有合法配置 When PUT 携带非法 type Then 422 且盘上内容不变。"""
    # Arrange
    initial = {
        "mcpServers": {
            "db": {"command": "postgres", "env": {"DATABASE_PASSWORD": "keep-me", "POOL": "10"}}
        }
    }
    ws, mcp_path = await _setup_spec_workspace(db_session, tmp_path, initial_mcp=initial)
    admin = await _create_user(db_session, is_platform_admin=True)
    original_text = mcp_path.read_text(encoding="utf-8")
    body = _valid_body(db={"type": "http", "command": "postgres"})

    # Act
    resp = await client.put(
        f"/api/workspaces/{ws.id}/mcp-config", json=body, headers=_headers(_token_for(admin))
    )

    # Assert
    assert resp.status_code == 422, resp.text
    assert mcp_path.read_text(encoding="utf-8") == original_text  # 内容原样


# ── 3. <set> 占位符还原（FR-03）─────────────────────────────────────────────


async def test_set还原成功_盘上真值_响应仍脱敏(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 盘上同名 server 同名 env 键有真值 When PUT 携带 <set> Then 盘上写回真值、响应显示 <set>。"""
    # Arrange
    initial = {
        "mcpServers": {
            "db": {
                "command": "postgres",
                "env": {"DATABASE_PASSWORD": "real-secret-value", "POOL": "10"},
            }
        }
    }
    ws, mcp_path = await _setup_spec_workspace(db_session, tmp_path, initial_mcp=initial)
    admin = await _create_user(db_session, is_platform_admin=True)
    body = _valid_body(
        db={
            "command": "postgres",
            "env": {"DATABASE_PASSWORD": "<set>", "POOL": "20"},  # 密钥保持占位符 + 改普通键
        }
    )

    # Act
    resp = await client.put(
        f"/api/workspaces/{ws.id}/mcp-config", json=body, headers=_headers(_token_for(admin))
    )

    # Assert
    assert resp.status_code == 200, resp.text
    # 盘上：占位符被还原为磁盘现有真值，普通键取新值
    on_disk = json.loads(mcp_path.read_text(encoding="utf-8"))
    assert on_disk["mcpServers"]["db"]["env"]["DATABASE_PASSWORD"] == "real-secret-value"
    assert on_disk["mcpServers"]["db"]["env"]["POOL"] == "20"
    assert "<set>" not in mcp_path.read_text(encoding="utf-8")  # 字面量绝不写盘
    # 响应：密钥类键仍脱敏显示 <set>
    resp_env = resp.json()["mcpServers"]["db"]["env"]
    assert resp_env["DATABASE_PASSWORD"] == "<set>"
    assert resp_env["POOL"] == "20"


async def test_set还原失败_server改名_422_盘上不变(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given <set> 键在磁盘现有文件的同名 server 下找不到（server 改名）When PUT Then 422 且盘上内容不变。"""
    # Arrange
    initial = {"mcpServers": {"old-server": {"command": "npx", "env": {"API_TOKEN": "real-token"}}}}
    ws, mcp_path = await _setup_spec_workspace(db_session, tmp_path, initial_mcp=initial)
    admin = await _create_user(db_session, is_platform_admin=True)
    original_text = mcp_path.read_text(encoding="utf-8")
    body = _valid_body(
        new_server={"command": "npx", "env": {"API_TOKEN": "<set>"}},  # server 改名 → 还原源丢失
    )

    # Act
    resp = await client.put(
        f"/api/workspaces/{ws.id}/mcp-config", json=body, headers=_headers(_token_for(admin))
    )

    # Assert
    assert resp.status_code == 422, resp.text
    payload = resp.json()
    assert payload["code"] == "HTTP_422_MCP_SECRET_UNRESOLVABLE"
    assert "new_server" in payload["message"]  # 指明 server 名
    assert "API_TOKEN" in payload["message"]  # 指明键名
    assert any("\u4e00" <= ch <= "\u9fff" for ch in payload["message"])  # 中文文案
    assert mcp_path.read_text(encoding="utf-8") == original_text  # 盘上未被破坏
    assert "<set>" not in mcp_path.read_text(encoding="utf-8")


async def test_set还原失败_env键新增_422_盘上不变(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given <set> 键是磁盘现有 server 上新增的键 When PUT Then 422 且盘上内容不变。"""
    # Arrange
    initial = {"mcpServers": {"db": {"command": "postgres", "env": {"POOL": "10"}}}}
    ws, mcp_path = await _setup_spec_workspace(db_session, tmp_path, initial_mcp=initial)
    admin = await _create_user(db_session, is_platform_admin=True)
    original_text = mcp_path.read_text(encoding="utf-8")
    body = _valid_body(
        db={
            "command": "postgres",
            "env": {"POOL": "10", "NEW_API_TOKEN": "<set>"},  # 键新增 → 还原源缺失
        }
    )

    # Act
    resp = await client.put(
        f"/api/workspaces/{ws.id}/mcp-config", json=body, headers=_headers(_token_for(admin))
    )

    # Assert
    assert resp.status_code == 422, resp.text
    payload = resp.json()
    assert payload["code"] == "HTTP_422_MCP_SECRET_UNRESOLVABLE"
    assert "db" in payload["message"]
    assert "NEW_API_TOKEN" in payload["message"]
    assert any("\u4e00" <= ch <= "\u9fff" for ch in payload["message"])
    assert mcp_path.read_text(encoding="utf-8") == original_text


async def test_set还原失败_现有文件损坏_视为空配置(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 盘上 .mcp.json 是损坏 JSON When PUT 携带 <set> Then 422（还原源视为空）且盘上内容不变。"""
    # Arrange
    ws, mcp_path = await _setup_spec_workspace(
        db_session, tmp_path, initial_raw='{"mcpServers": broken'
    )
    admin = await _create_user(db_session, is_platform_admin=True)
    body = _valid_body(db={"command": "postgres", "env": {"DATABASE_PASSWORD": "<set>"}})

    # Act
    resp = await client.put(
        f"/api/workspaces/{ws.id}/mcp-config", json=body, headers=_headers(_token_for(admin))
    )

    # Assert
    assert resp.status_code == 422, resp.text
    assert resp.json()["code"] == "HTTP_422_MCP_SECRET_UNRESOLVABLE"
    assert mcp_path.read_text(encoding="utf-8") == '{"mcpServers": broken'  # 损坏内容原样保留


async def test_无现有文件_全新配置直接写入(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 盘上无 .mcp.json 且请求不含 <set> When PUT Then 直接写新文件（task-01 边界）。"""
    # Arrange
    ws, mcp_path = await _setup_spec_workspace(db_session, tmp_path)
    admin = await _create_user(db_session, is_platform_admin=True)
    body = _valid_body(fresh={"command": "npx", "args": ["-y", "pkg"]})

    # Act
    resp = await client.put(
        f"/api/workspaces/{ws.id}/mcp-config", json=body, headers=_headers(_token_for(admin))
    )

    # Assert
    assert resp.status_code == 200, resp.text
    on_disk = json.loads(mcp_path.read_text(encoding="utf-8"))
    assert on_disk["mcpServers"]["fresh"]["command"] == "npx"


# ── 4. 原子写格式与故障清理（NFR / R-01）───────────────────────────────────


async def test_写入格式_json可解析_indent2_末尾换行_非ASCII保留(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given 合法 PUT When 写盘 Then json.load 可解析、indent=2、末尾换行、中文原样（ensure_ascii=False）。"""
    # Arrange
    ws, mcp_path = await _setup_spec_workspace(db_session, tmp_path)
    admin = await _create_user(db_session, is_platform_admin=True)
    body = _valid_body(cn={"command": "npx", "args": ["--名称", "参数"], "env": {"NOTE": "备注"}})

    # Act
    resp = await client.put(
        f"/api/workspaces/{ws.id}/mcp-config", json=body, headers=_headers(_token_for(admin))
    )

    # Assert
    assert resp.status_code == 200, resp.text
    text = mcp_path.read_text(encoding="utf-8")
    parsed = json.loads(text)  # 合法 JSON
    assert parsed["mcpServers"]["cn"]["env"]["NOTE"] == "备注"
    assert text.endswith("\n")  # 末尾换行
    assert '\n  "mcpServers"' in text  # indent=2（顶层键换行 + 2 空格缩进）
    assert "参数" in text  # ensure_ascii=False：非 ASCII 原样，不转 \uXXXX
    assert "\\u" not in text


async def test_os替换失败_临时文件清理_原文件不变(
    client: AsyncClient,
    db_session: AsyncSession,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """Given os.replace 抛 OSError When 写盘 Then 异常上抛（IO 故障走全局 500 通道）、无 tmp- 残留、原文件不变。

    httpx ASGITransport 默认 ``raise_app_exceptions=True``，未处理异常直接向
    测试端上抛而非转 500 响应——此处捕获 OSError 后断言清理副作用（R-01）。
    """
    # Arrange
    initial = {"mcpServers": {"db": {"command": "postgres"}}}
    ws, mcp_path = await _setup_spec_workspace(db_session, tmp_path, initial_mcp=initial)
    admin = await _create_user(db_session, is_platform_admin=True)
    spec_root = tmp_path / "spec"
    original_text = mcp_path.read_text(encoding="utf-8")

    import os as os_module

    real_replace = os_module.replace

    def _explode(src, dst, *args, **kwargs):
        if Path(src).name.startswith(".mcp.json.tmp-"):
            raise OSError("simulated replace failure")
        return real_replace(src, dst, *args, **kwargs)

    monkeypatch.setattr(os_module, "replace", _explode)
    body = _valid_body(db={"command": "postgres", "env": {"POOL": "99"}})

    # Act
    with pytest.raises(OSError, match="simulated replace failure"):
        await client.put(
            f"/api/workspaces/{ws.id}/mcp-config", json=body, headers=_headers(_token_for(admin))
        )

    # Assert
    assert not list(spec_root.glob("*.tmp-*"))  # 临时文件被清理，无残留
    assert mcp_path.read_text(encoding="utf-8") == original_text  # 原文件原样


# ── 5. 审计（写操作可追溯）─────────────────────────────────────────────────


async def test_写成功后_审计行落库_actor_workspace正确(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """Given Writer 写入成功 When 提交完成 Then audit_logs 有该工作区的行且 actor 正确（acceptance #6）。"""
    # Arrange：注册全局 ORM 审计钩子（mapper 级事件全局生效，幂等）
    from sqlalchemy.ext.asyncio import create_async_engine

    from app.core.audit_hooks import register_audit_hooks
    from app.modules.workflow.model import AuditLog

    register_audit_hooks(create_async_engine("sqlite+aiosqlite:///:memory:", future=True))

    ws, _mcp_path = await _setup_spec_workspace(db_session, tmp_path)
    writer = await _create_user(db_session, email="audit-writer@example.com")
    await _grant_workspace_permission(
        db_session,
        user_id=writer.id,
        workspace_id=ws.id,
        permission=Permission.WORKSPACE_WRITE,
    )

    # Act
    resp = await client.put(
        f"/api/workspaces/{ws.id}/mcp-config",
        json=_valid_body(db={"command": "postgres"}),
        headers=_headers(_token_for(writer)),
    )

    # Assert
    assert resp.status_code == 200, resp.text
    rows = (
        (await db_session.execute(select(AuditLog).where(AuditLog.workspace_id == ws.id)))
        .scalars()
        .all()
    )
    assert len(rows) >= 1, "写成功后应在 audit_logs 落审计行"
    assert all(r.actor_id == writer.id for r in rows)


async def test_写成功后_审计details记录server清单且不含env值(
    db_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Given Writer 写入含密钥的配置 When 提交完成 Then 审计 details 只记 server 名清单，不含任何 env 值。

    审计通道（task-01 修正版，design §7.1）：纯文件写不触发 audit_hooks，
    改为手工插 AuditLog + commit（settings/_audit_platform_setting_write 同模式）；
    session.info 全程不被 audit_context 污染。service 级直调，对写 helper 做
    spy 观察写窗口（被测方法 ``update_mcp_config`` 不 mock，文件照常真实写盘）。
    """
    # Arrange
    from app.modules.workspace.skills_view_service import (
        McpConfigUpdateRequest,
        McpServerEntryPut,
        SkillsViewService,
    )

    ws, mcp_path = await _setup_spec_workspace(db_session, tmp_path)
    writer = await _create_user(db_session, email="ctx-writer@example.com")

    observed_info: list[dict] = []
    real_write = SkillsViewService._write_mcp_config_sync

    def _spy_write(mcp_path_arg: Path, data: dict) -> None:
        observed_info.append(dict(db_session.info))
        real_write(mcp_path_arg, data)

    monkeypatch.setattr(SkillsViewService, "_write_mcp_config_sync", staticmethod(_spy_write))

    # Act
    resp_view = await SkillsViewService(db_session).update_mcp_config(
        ws.id,
        McpConfigUpdateRequest(
            mcpServers={"db": McpServerEntryPut(command="postgres", env={"POOL": "5"})}
        ),
        actor=writer,
    )

    # Assert
    assert resp_view.mcpServers["db"]["command"] == "postgres"
    assert all("audit_context" not in info for info in observed_info)  # 全程无 info 注入污染
    assert (
        json.loads(mcp_path.read_text(encoding="utf-8"))["mcpServers"]["db"]["env"]["POOL"] == "5"
    )
    row = await db_session.execute(
        select(AuditLog).where(AuditLog.workspace_id == ws.id, AuditLog.actor_id == writer.id)
    )
    audit = row.scalars().one()
    assert audit.action == "workspace_mcp_config.update"
    details = json.loads(audit.details_json or "{}")
    assert details == {"servers": ["db"]}  # 只记 server 名清单
    assert "5" not in (audit.details_json or "")  # env 值绝不进审计
