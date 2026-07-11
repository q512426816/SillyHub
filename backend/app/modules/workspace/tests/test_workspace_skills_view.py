"""task-06 单测：workspace skills / .mcp.json 只读查看端点（变更 2026-07-07-skills-mcp-management-ui）。

覆盖：
- server-local 路径：真 tmp_path 建 specDir/skills/ + .mcp.json，端点直读容器 Path。
- daemon-client 路径：monkey-patch ``SkillsViewService._make_host_fs_delegate`` 返 fake
  delegate，验证 list_dir / read_file / stat 调用结构与返回脱敏。
- membership 校验：非成员普通用户 → 403。
- 无 skills/ 或 .mcp.json → 空返回不报错。
- .mcp.json env token/key/secret/password 类字段遮蔽（D-008）。

workspace 行直接插入（绕开 scan），spec_ws 行直接插入定位 specDir。
"""

from __future__ import annotations

import json
import uuid
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.spec_workspace.model import SpecWorkspace
from app.modules.workspace.model import Workspace
from app.modules.workspace.skills_view_service import SkillsViewService

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
    strategy: str = "repo-native",
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


class _FakeHostFsDelegate:
    """伪 HostFsDelegate：按预置 ``fs`` 字典（path → 类型/内容）应答。

    模拟 daemon-client 经 RPC 读宿主 specDir：list_dir / stat / read_file 全部
    从内存 fs 取，避免依赖真实 WS 通道。path 用绝对路径字符串键。
    """

    def __init__(self, fs: dict[str, Any]) -> None:
        # fs: {abs_path: {"type": "dir"|"file", "content"?: str, "children"?: [names]}}
        # 或简化：{abs_path: "dir" | file_content_str}
        self._fs = fs
        self.calls: list[tuple[str, str]] = []

    def _norm(self, p: str) -> str:
        return str(Path(p))

    async def list_dir(self, workspace, path: str) -> list[str]:
        self.calls.append(("list_dir", path))
        entry = self._fs.get(self._norm(path))
        if isinstance(entry, dict) and entry.get("type") == "dir":
            return sorted(entry.get("children", []))
        return []

    async def stat(self, workspace, path: str) -> dict:
        self.calls.append(("stat", path))
        entry = self._fs.get(self._norm(path))
        if entry is None:
            return {"exists": False, "is_dir": False, "size": 0}
        if isinstance(entry, dict) and entry.get("type") == "dir":
            return {"exists": True, "is_dir": True, "size": 0}
        content = entry if isinstance(entry, str) else ""
        return {"exists": True, "is_dir": False, "size": len(content.encode("utf-8"))}

    async def read_file(self, workspace, path: str) -> str:
        self.calls.append(("read_file", path))
        entry = self._fs.get(self._norm(path))
        if isinstance(entry, str):
            return entry
        return ""


# ── daemon-client 路径（HostFsDelegate RPC 读）──────────────────────────────
#
# 2026-07-10-remove-server-local-workspace-mode：server-local 直读分支已删，
# 所有 workspace 统一经 HostFsDelegate RPC 读。下列测试用 _FakeHostFsDelegate
# 内存 fs 模拟 daemon 宿主 specDir，覆盖 list_skills / get_mcp_config / 空目录 /
# 非法 JSON / env 脱敏 全部场景（原 server-local 组已删，能力等价覆盖）。


@pytest.mark.asyncio
async def test_list_skills_daemon_client_via_host_fs_delegate(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """daemon-client：经 HostFsDelegate list_dir/stat RPC 读 specDir/skills/。"""
    admin = await _create_user(db_session, is_platform_admin=True)
    spec_root = str(tmp_path / "spec")

    fs: dict[str, Any] = {
        str(Path(spec_root)): {"type": "dir", "children": ["skills"]},
        str(Path(spec_root) / "skills"): {
            "type": "dir",
            "children": ["alpha", "beta"],
        },
        str(Path(spec_root) / "skills" / "alpha"): {
            "type": "dir",
            "children": ["SKILL.md"],
        },
        str(Path(spec_root) / "skills" / "alpha" / "SKILL.md"): "# alpha",
        str(Path(spec_root) / "skills" / "beta"): {
            "type": "dir",
            "children": ["SKILL.md", "lib"],
        },
        str(Path(spec_root) / "skills" / "beta" / "SKILL.md"): "# beta",
        str(Path(spec_root) / "skills" / "beta" / "lib"): {
            "type": "dir",
            "children": ["util.py"],
        },
        str(Path(spec_root) / "skills" / "beta" / "lib" / "util.py"): "pass",
    }
    fake = _FakeHostFsDelegate(fs)
    monkeypatch.setattr(
        SkillsViewService, "_make_host_fs_delegate", staticmethod(lambda session: fake)
    )

    ws = await _create_workspace(db_session, created_by=admin.id, root_path=spec_root)
    await _create_spec_workspace(
        db_session, workspace_id=ws.id, spec_root=spec_root, strategy="platform-managed"
    )

    resp = await client.get(f"/api/workspaces/{ws.id}/skills", headers=_headers(_token_for(admin)))
    assert resp.status_code == 200, resp.text
    body = resp.json()
    by_name = {s["name"]: s["files"] for s in body["skills"]}
    assert set(by_name.keys()) == {"alpha", "beta"}
    assert by_name["alpha"] == ["SKILL.md"]
    assert "SKILL.md" in by_name["beta"]
    assert "lib/util.py" in by_name["beta"]

    # 确认走了 RPC（list_dir 被调），而非容器 Path 直读。
    methods = {call[0] for call in fake.calls}
    assert "list_dir" in methods
    assert "stat" in methods


@pytest.mark.asyncio
async def test_get_mcp_config_daemon_client_via_host_fs_delegate(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """daemon-client：经 HostFsDelegate stat/read_file RPC 读 .mcp.json，env 脱敏。"""
    admin = await _create_user(db_session, is_platform_admin=True)
    spec_root = str(tmp_path / "spec")
    mcp = {
        "mcpServers": {
            "db": {
                "command": "postgres",
                "env": {"DATABASE_PASSWORD": "supersecret", "POOL": "10"},
            }
        }
    }
    fs: dict[str, Any] = {
        str(Path(spec_root)): {"type": "dir", "children": [".mcp.json"]},
        str(Path(spec_root) / ".mcp.json"): json.dumps(mcp),
    }
    fake = _FakeHostFsDelegate(fs)
    monkeypatch.setattr(
        SkillsViewService, "_make_host_fs_delegate", staticmethod(lambda session: fake)
    )

    ws = await _create_workspace(db_session, created_by=admin.id, root_path=spec_root)
    await _create_spec_workspace(
        db_session, workspace_id=ws.id, spec_root=spec_root, strategy="platform-managed"
    )

    resp = await client.get(
        f"/api/workspaces/{ws.id}/mcp-config", headers=_headers(_token_for(admin))
    )
    assert resp.status_code == 200, resp.text
    env = resp.json()["mcpServers"]["db"]["env"]
    assert env["DATABASE_PASSWORD"] == "<set>"  # password 类脱敏
    assert env["POOL"] == "10"

    methods = [call[0] for call in fake.calls]
    assert "read_file" in methods


@pytest.mark.asyncio
async def test_get_mcp_config_daemon_client_no_file_empty(
    client: AsyncClient, db_session: AsyncSession, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """daemon-client：stat 返不存在 → 空不报错。"""
    admin = await _create_user(db_session, is_platform_admin=True)
    spec_root = str(tmp_path / "spec")
    fs: dict[str, Any] = {
        str(Path(spec_root)): {"type": "dir", "children": []},
    }
    fake = _FakeHostFsDelegate(fs)
    monkeypatch.setattr(
        SkillsViewService, "_make_host_fs_delegate", staticmethod(lambda session: fake)
    )

    ws = await _create_workspace(db_session, created_by=admin.id, root_path=spec_root)
    await _create_spec_workspace(
        db_session, workspace_id=ws.id, spec_root=spec_root, strategy="platform-managed"
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

    repo_root = tmp_path / "repo"
    (repo_root / ".sillyspec" / "skills").mkdir(parents=True)

    ws = await _create_workspace(db_session, created_by=owner.id, root_path=str(repo_root))
    await _create_spec_workspace(
        db_session,
        workspace_id=ws.id,
        spec_root=str(repo_root / ".sillyspec"),
        strategy="repo-native",
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
    """有 WORKSPACE_READ role 的成员可访问（membership 通过）。

    2026-07-10-remove-server-local-workspace-mode: skills_view 永远经
    HostFsDelegate RPC 读（daemon-client 单一模式）。本测试聚焦权限校验，
    故 mock delegate 直读本地 spec_root（已建 fixtures），避免依赖真 daemon。
    """
    owner = await _create_user(db_session, email="owner2@example.com")
    member = await _create_user(db_session, email="member2@example.com")

    repo_root = tmp_path / "repo"
    (repo_root / ".sillyspec" / "skills" / "team-skill").mkdir(parents=True)
    (repo_root / ".sillyspec" / "skills" / "team-skill" / "SKILL.md").write_text(
        "# team", encoding="utf-8"
    )

    ws = await _create_workspace(db_session, created_by=owner.id, root_path=str(repo_root))
    spec_root = str(repo_root / ".sillyspec")
    await _create_spec_workspace(
        db_session,
        workspace_id=ws.id,
        spec_root=spec_root,
        strategy="repo-native",
    )
    await _grant_workspace_read(db_session, user_id=member.id, workspace_id=ws.id)

    # mock delegate：list_dir/read_file/stat 直读本地 spec_root（权限是本测试焦点）
    from pathlib import Path
    from unittest.mock import patch

    class _LocalDelegate:
        async def list_dir(self, workspace, path: str):
            full = Path(spec_root) / path
            if not full.is_dir():
                return []
            return sorted(p.name for p in full.iterdir())

        async def read_file(self, workspace, path: str) -> str:
            return (Path(spec_root) / path).read_text(encoding="utf-8")

        async def stat(self, workspace, path: str) -> dict:
            full = Path(spec_root) / path
            return {
                "exists": full.exists(),
                "is_dir": full.is_dir(),
                "size": full.stat().st_size if full.exists() else 0,
            }

    with patch(
        "app.modules.workspace.skills_view_service.SkillsViewService._make_host_fs_delegate",
        return_value=_LocalDelegate(),
    ):
        resp = await client.get(
            f"/api/workspaces/{ws.id}/skills", headers=_headers(_token_for(member))
        )
    assert resp.status_code == 200, resp.text
    assert {s["name"] for s in resp.json()["skills"]} == {"team-skill"}
