"""workspace skills / .mcp.json 只读查看端点单测。

2026-07-11 ql-20260711-001（spec sync 修复）：skills_view 回归 backend 容器内
**本地直读** ``spec_ws.spec_root``（容器路径，bind mount 映射宿主），不经
HostFsDelegate RPC（RPC 打 daemon 宿主读容器路径会失败）。下列测试用 tmp_path
建实际 specDir/skills/ + .mcp.json，端点直读本地 Path。

覆盖：
- 本地直读 list_skills（多 skill + 子目录文件）
- 本地直读 get_mcp_config（env token/secret 脱敏 D-008）
- 无 .mcp.json → 空返回不报错
- membership 校验：非成员普通用户 → 403；WORKSPACE_READ 成员可访问

workspace 行直接插入（绕开 scan），spec_ws 行直接插入定位 specDir。
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace

# ── helpers ─────────────────────────────────────────────────────────────────


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


async def _grant_workspace_read(
    session: AsyncSession, user_id: uuid.UUID, workspace_id: uuid.UUID
) -> None:
    role = Role(
        id=uuid.uuid4(),
        key=f"test-ws-read-{uuid.uuid4().hex[:6]}",
        name="test ws read",
    )
    session.add(role)
    await session.flush()
    session.add(RolePermission(role_id=role.id, permission=Permission.WORKSPACE_READ.value))
    session.add(UserWorkspaceRole(user_id=user_id, workspace_id=workspace_id, role_id=role.id))
    await session.commit()


async def _create_workspace(
    session: AsyncSession,
    *,
    created_by: uuid.UUID,
    root_path: str = "/tmp/irrelevant",
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
    strategy: str = "platform-managed",
) -> SpecWorkspace:
    spec_ws = SpecWorkspace(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        spec_root=spec_root,
        strategy=strategy,
        sync_status="synced",
    )
    session.add(spec_ws)
    await session.commit()
    await session.refresh(spec_ws)
    return spec_ws


# ── 本地直读 spec_root（backend 容器路径，不经 RPC）─────────────────────────


@pytest.mark.asyncio
async def test_list_skills_local_read(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """backend 本地直读 spec_root/skills/：多 skill + 子目录文件。"""
    admin = await _create_user(db_session, is_platform_admin=True)
    spec_root = tmp_path / "spec"
    skills_dir = spec_root / "skills"
    (skills_dir / "alpha").mkdir(parents=True)
    (skills_dir / "alpha" / "SKILL.md").write_text("# alpha", encoding="utf-8")
    (skills_dir / "beta").mkdir(parents=True)
    (skills_dir / "beta" / "SKILL.md").write_text("# beta", encoding="utf-8")
    (skills_dir / "beta" / "lib").mkdir()
    (skills_dir / "beta" / "lib" / "util.py").write_text("pass", encoding="utf-8")

    ws = await _create_workspace(db_session, created_by=admin.id, root_path=str(spec_root))
    await _create_spec_workspace(
        db_session, workspace_id=ws.id, spec_root=str(spec_root), strategy="platform-managed"
    )

    resp = await client.get(f"/api/workspaces/{ws.id}/skills", headers=_headers(_token_for(admin)))
    assert resp.status_code == 200, resp.text
    by_name = {s["name"]: s["files"] for s in resp.json()["skills"]}
    assert set(by_name.keys()) == {"alpha", "beta"}
    assert by_name["alpha"] == ["SKILL.md"]
    assert "SKILL.md" in by_name["beta"]
    assert "lib/util.py" in by_name["beta"]


@pytest.mark.asyncio
async def test_get_mcp_config_local_read(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """本地直读 .mcp.json + env secret 脱敏（D-008 password 类）。"""
    admin = await _create_user(db_session, is_platform_admin=True)
    spec_root = tmp_path / "spec"
    spec_root.mkdir()
    mcp = {
        "mcpServers": {
            "db": {
                "command": "postgres",
                "env": {"DATABASE_PASSWORD": "supersecret", "POOL": "10"},
            }
        }
    }
    (spec_root / ".mcp.json").write_text(json.dumps(mcp), encoding="utf-8")

    ws = await _create_workspace(db_session, created_by=admin.id, root_path=str(spec_root))
    await _create_spec_workspace(
        db_session, workspace_id=ws.id, spec_root=str(spec_root), strategy="platform-managed"
    )

    resp = await client.get(
        f"/api/workspaces/{ws.id}/mcp-config", headers=_headers(_token_for(admin))
    )
    assert resp.status_code == 200, resp.text
    env = resp.json()["mcpServers"]["db"]["env"]
    assert env["DATABASE_PASSWORD"] == "<set>"  # password 类脱敏
    assert env["POOL"] == "10"


@pytest.mark.asyncio
async def test_get_mcp_config_no_file_empty(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """spec_root 存在但无 .mcp.json → 空返回不报错。"""
    admin = await _create_user(db_session, is_platform_admin=True)
    spec_root = tmp_path / "spec"
    spec_root.mkdir()

    ws = await _create_workspace(db_session, created_by=admin.id, root_path=str(spec_root))
    await _create_spec_workspace(
        db_session, workspace_id=ws.id, spec_root=str(spec_root), strategy="platform-managed"
    )

    resp = await client.get(
        f"/api/workspaces/{ws.id}/mcp-config", headers=_headers(_token_for(admin))
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"mcpServers": {}}


# ── membership 校验（非成员 403）────────────────────────────────────────────


@pytest.mark.asyncio
async def test_non_member_gets_403(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """非成员普通用户（无 platform_admin、无 workspace role）→ 403。"""
    owner = await _create_user(db_session, email="owner@example.com")
    other = await _create_user(db_session, email="other@example.com")

    spec_root = tmp_path / "spec"
    (spec_root / "skills").mkdir(parents=True)

    ws = await _create_workspace(db_session, created_by=owner.id, root_path=str(spec_root))
    await _create_spec_workspace(
        db_session,
        workspace_id=ws.id,
        spec_root=str(spec_root),
        strategy="platform-managed",
    )

    # other 既非 platform admin 也无该 workspace 的 role → membership 校验挡下。
    resp_skills = await client.get(
        f"/api/workspaces/{ws.id}/skills", headers=_headers(_token_for(other))
    )
    resp_mcp = await client.get(
        f"/api/workspaces/{ws.id}/mcp-config", headers=_headers(_token_for(other))
    )
    assert resp_skills.status_code == 403, resp_skills.text
    assert resp_mcp.status_code == 403, resp_mcp.text


@pytest.mark.asyncio
async def test_member_with_workspace_read_can_access(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path
) -> None:
    """有 WORKSPACE_READ role 的成员可访问（membership 通过，本地直读 spec_root）。"""
    owner = await _create_user(db_session, email="owner2@example.com")
    member = await _create_user(db_session, email="member2@example.com")

    spec_root = tmp_path / "spec"
    (spec_root / "skills" / "team-skill").mkdir(parents=True)
    (spec_root / "skills" / "team-skill" / "SKILL.md").write_text("# team", encoding="utf-8")

    ws = await _create_workspace(db_session, created_by=owner.id, root_path=str(spec_root))
    await _create_spec_workspace(
        db_session,
        workspace_id=ws.id,
        spec_root=str(spec_root),
        strategy="platform-managed",
    )
    await _grant_workspace_read(db_session, user_id=member.id, workspace_id=ws.id)

    resp = await client.get(f"/api/workspaces/{ws.id}/skills", headers=_headers(_token_for(member)))
    assert resp.status_code == 200, resp.text
    assert {s["name"] for s in resp.json()["skills"]} == {"team-skill"}
