"""workspace 扫描导入单测：scan 只读三态判定、cmd /c 归一化等价、apply 幂等与 dedup_key。

Change: 2026-09-10-mcp-central-registry（task-09 / TDD 先行）

覆盖（task implementation/acceptance 逐项）:
- scan 只读：候选零落库（无 mcp_servers 新行）、server_config 脱敏输出、
  workspace .mcp.json 文件本身不动（registry 吸收不替代，design 非目标）；
- 三态判定：new（无 dedup_key 行）/ duplicate（同名同配置）/ renamed（同名异
  配置，apply 落库为 原名-<workspace 短名>，短名取 workspace 名 slug、空 slug
  回退 id 前 6 位）；
- cmd 归一化：``cmd /c`` 与 ``cmd.exe /C``（含路径前缀）包装的条目与既有裸
  command 行判为同配置走 duplicate（比对双端归一化）；
- apply 幂等：重复 apply 因 dedup_key 命中 skip 不重复入库；导入行 dedup_key =
  ``ws:<workspace_id>:<原名>``（R-07 原名可追溯）、source=imported_workspace；
- apply 重读文件取明文：脱敏候选（secret 值 ``<set>``）不阻断应用，secret 键
  只进 encrypted_env；
- 指定单 workspace 扫描（缺省=全部；不存在 → WorkspaceNotFound）；容错（无
  .mcp.json / 坏 JSON / 软删 workspace 不抛错不误报）；
- 工作区访问门（ql-20260911-003-355a P0-1）：非成员扫描被过滤 / 指定他人
  workspace → 403；apply 夹带非可见 workspace 候选 → 403 fail-fast；平台
  admin 放行全部。

范式参考 ``tests/test_render.py``（Workspace + SpecWorkspace 直插行 + tmp_path
落 .mcp.json）与 ``tests/test_importer_json.py``（真实 CredentialCipher 不 mock）。
成员授权 seed（Role + RolePermission + UserWorkspaceRole）照
``tests/modules/test_permission_cache.py:314-330`` 先例。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import PermissionDenied, WorkspaceNotFound
from app.modules.auth.model import Role, RolePermission, User, UserWorkspaceRole
from app.modules.auth.permissions import Permission
from app.modules.mcp_registry.importer import apply_workspace_import, scan_workspaces
from app.modules.mcp_registry.model import McpServer
from app.modules.mcp_registry.schema import McpWorkspaceCandidate
from app.modules.workspace.model import Workspace

# ── Helpers（test_render.py / test_importer_json.py 同惯例）───────────────────


def _entry(command: str = "uvx", args: list[str] | None = None) -> dict[str, Any]:
    return {"command": command, "args": args or ["mcp-server-fetch"]}


async def _create_user(
    db_session: AsyncSession, *, label: str = "", is_platform_admin: bool = False
) -> User:
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=f"mcp-ws-{uid.hex[:8]}-{label}@example.com",
        username=f"mcp-ws-{uid.hex[:8]}",
        password_hash="irrelevant",
        status="active",
        is_platform_admin=is_platform_admin,
    )
    db_session.add(user)
    await db_session.commit()
    return user


async def _grant_workspace_read(
    db_session: AsyncSession, *, user_id: uuid.UUID, workspace_id: uuid.UUID
) -> None:
    """seed WORKSPACE_READ 成员授权（Role + RolePermission + UserWorkspaceRole 直插）。"""
    role = Role(id=uuid.uuid4(), key=f"r{uuid.uuid4().hex[:6]}", name="R")
    db_session.add(role)
    await db_session.flush()
    db_session.add(RolePermission(role_id=role.id, permission=Permission.WORKSPACE_READ.value))
    db_session.add(UserWorkspaceRole(user_id=user_id, workspace_id=workspace_id, role_id=role.id))
    await db_session.commit()


async def _rows(db_session: AsyncSession) -> list[McpServer]:
    return list((await db_session.execute(select(McpServer))).scalars().all())


async def _create_workspace(
    db_session: AsyncSession,
    tmp_path: Path,
    *,
    created_by: uuid.UUID,
    name: str,
    mcp_servers: dict[str, Any] | None = None,
    soft_delete: bool = False,
) -> Workspace:
    """直插 Workspace + SpecWorkspace 行并按需落 specDir/.mcp.json（test_render 同法）。"""
    from app.modules.spec_workspace.model import SpecWorkspace

    spec_root = tmp_path / f"spec-{name}-{uuid.uuid4().hex[:6]}"
    spec_root.mkdir()
    ws = Workspace(
        id=uuid.uuid4(),
        name=name,
        slug=f"slug-{uuid.uuid4().hex[:8]}",
        root_path=str(spec_root),
        status="active",
        created_by=created_by,
    )
    if soft_delete:
        ws.deleted_at = datetime.now(UTC)
    db_session.add(ws)
    await db_session.flush()
    db_session.add(
        SpecWorkspace(
            id=uuid.uuid4(),
            workspace_id=ws.id,
            spec_root=str(spec_root),
            strategy="platform-managed",
            sync_status="synced",
        )
    )
    if mcp_servers is not None:
        _write_mcp_json(ws, mcp_servers)
    await db_session.commit()
    # P0-1 成员授权：创建者默认拿到该 workspace 的 WORKSPACE_READ（与平台
    # workspace 创建链路同语义），保证既有用例走「成员」路径。
    await _grant_workspace_read(db_session, user_id=created_by, workspace_id=ws.id)
    return ws


def _write_mcp_json(ws: Workspace, mcp_servers: dict[str, Any]) -> None:
    """覆写 workspace 的 .mcp.json（模拟用户在扫描后改文件）。"""
    (Path(ws.root_path) / ".mcp.json").write_text(
        json.dumps({"mcpServers": mcp_servers}), encoding="utf-8"
    )


def _by_name(candidates: list[McpWorkspaceCandidate], name: str) -> McpWorkspaceCandidate:
    return next(c for c in candidates if c.name == name)


# ── scan 只读阶段（零写库 + 脱敏 + 容错）──────────────────────────────────────


class TestScanReadOnly:
    async def test_scan_new_candidates_zero_write(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """新条目 verdict=new、secret 脱敏输出、扫描零落库且不动 .mcp.json 文件。"""
        user = await _create_user(db_session, label="s1")
        servers = {
            "fetch": {
                "command": "uvx",
                "args": ["mcp-server-fetch"],
                "env": {"GITHUB_TOKEN": "ghp_plain", "CACHE_DIR": "/tmp"},
            },
            "Context7_Fetch": _entry(),
        }
        ws = await _create_workspace(
            db_session, tmp_path, created_by=user.id, name="ws-plain", mcp_servers=servers
        )
        original_text = (Path(ws.root_path) / ".mcp.json").read_text(encoding="utf-8")

        candidates = await scan_workspaces(db_session, None, user)

        assert sorted(c.name for c in candidates) == ["context7-fetch", "fetch"]
        assert all(c.dedup_verdict == "new" for c in candidates)
        fetch = _by_name(candidates, "fetch")
        assert fetch.workspace_id == ws.id
        assert fetch.server_config["env"]["GITHUB_TOKEN"] == "<set>"  # 脱敏输出
        assert await _rows(db_session) == []  # 零写库
        assert (Path(ws.root_path) / ".mcp.json").read_text(encoding="utf-8") == original_text

    async def test_scan_tolerates_missing_broken_and_soft_deleted(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """无 .mcp.json / 坏 JSON / 软删 workspace → 空候选不抛错不误报。"""
        user = await _create_user(db_session, label="s2")
        # 1) specDir 存在但无 .mcp.json
        await _create_workspace(db_session, tmp_path, created_by=user.id, name="ws-empty")
        # 2) 坏 JSON 文件
        broken = await _create_workspace(
            db_session, tmp_path, created_by=user.id, name="ws-broken", mcp_servers={}
        )
        (Path(broken.root_path) / ".mcp.json").write_text("{not json", encoding="utf-8")
        # 3) 软删 workspace 带正常条目（应被排除）
        await _create_workspace(
            db_session,
            tmp_path,
            created_by=user.id,
            name="ws-dead",
            mcp_servers={"dead-tool": _entry()},
            soft_delete=True,
        )

        assert await scan_workspaces(db_session, None, user) == []

    async def test_scan_specified_workspace_only(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """workspace_id 指定单 workspace；不存在的 id → WorkspaceNotFound。"""
        user = await _create_user(db_session, label="s3")
        ws_a = await _create_workspace(
            db_session, tmp_path, created_by=user.id, name="ws-a", mcp_servers={"alpha": _entry()}
        )
        await _create_workspace(
            db_session, tmp_path, created_by=user.id, name="ws-b", mcp_servers={"beta": _entry()}
        )

        candidates = await scan_workspaces(db_session, ws_a.id, user)

        assert [c.name for c in candidates] == ["alpha"]
        assert candidates[0].workspace_id == ws_a.id

        with pytest.raises(WorkspaceNotFound):
            await scan_workspaces(db_session, uuid.uuid4(), user)


# ── 工作区访问门（P0-1，ql-20260911-003-355a）─────────────────────────────────


class TestWorkspaceMembershipGate:
    async def test_scan_all_filters_non_member_workspaces(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """非成员的 workspace 不进候选（他人 .mcp.json 内容不泄露给非成员）。"""
        owner = await _create_user(db_session, label="g1")
        outsider = await _create_user(db_session, label="g1o")
        await _create_workspace(
            db_session,
            tmp_path,
            created_by=owner.id,
            name="ws-others",
            mcp_servers={"fetch": _entry()},
        )

        assert await scan_workspaces(db_session, None, outsider) == []
        assert len(await _rows(db_session)) == 0  # 不落库也不留痕

    async def test_scan_specified_non_member_denied(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """指定他人 workspace_id 扫描 → PermissionDenied 403。"""
        owner = await _create_user(db_session, label="g2")
        outsider = await _create_user(db_session, label="g2o")
        ws = await _create_workspace(
            db_session,
            tmp_path,
            created_by=owner.id,
            name="ws-private",
            mcp_servers={"fetch": _entry()},
        )

        with pytest.raises(PermissionDenied):
            await scan_workspaces(db_session, ws.id, outsider)

    async def test_apply_non_member_candidate_denied(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """apply 候选引用非可见 workspace → 403 fail-fast（候选体可手写，不进容错）。"""
        owner = await _create_user(db_session, label="g3")
        outsider = await _create_user(db_session, label="g3o")
        ws = await _create_workspace(
            db_session,
            tmp_path,
            created_by=owner.id,
            name="ws-apply",
            mcp_servers={"fetch": _entry()},
        )
        forged = McpWorkspaceCandidate(
            name="fetch",
            server_config={"command": "uvx", "args": ["mcp-server-fetch"]},
            workspace_id=ws.id,
            dedup_verdict="new",
        )

        with pytest.raises(PermissionDenied):
            await apply_workspace_import(db_session, [forged], "mine", outsider)
        assert await _rows(db_session) == []  # 越权候选零落库

    async def test_platform_admin_scans_all(self, db_session: AsyncSession, tmp_path: Path) -> None:
        """平台 admin（SETTINGS_ADMIN 短路）放行全部 workspace 扫描。"""
        owner = await _create_user(db_session, label="g4")
        admin = await _create_user(db_session, label="g4a", is_platform_admin=True)
        await _create_workspace(
            db_session,
            tmp_path,
            created_by=owner.id,
            name="ws-admin-view",
            mcp_servers={"fetch": _entry()},
        )

        candidates = await scan_workspaces(db_session, None, admin)
        assert [c.name for c in candidates] == ["fetch"]


# ── 三态判定（new / duplicate / renamed）──────────────────────────────────────


class TestThreeStateVerdicts:
    async def test_duplicate_after_apply(self, db_session: AsyncSession, tmp_path: Path) -> None:
        """apply 落库后再次扫描：同锚同配置 → duplicate。"""
        user = await _create_user(db_session, label="v1")
        await _create_workspace(
            db_session, tmp_path, created_by=user.id, name="ws-dup", mcp_servers={"fetch": _entry()}
        )

        first = await scan_workspaces(db_session, None, user)
        await apply_workspace_import(db_session, first, "mine", user)
        second = await scan_workspaces(db_session, None, user)

        assert [c.dedup_verdict for c in first] == ["new"]
        assert [c.dedup_verdict for c in second] == ["duplicate"]
        assert len(await _rows(db_session)) == 1  # 扫描不落库、判定不重复导入

    async def test_cmd_wrapper_equivalent_is_duplicate(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """cmd /c 与 cmd.exe /C（含路径前缀）包装的条目与裸 command 判为同配置。"""
        user = await _create_user(db_session, label="v2")
        plain = {"command": "npx", "args": ["-y", "server"], "env": {"CACHE_DIR": "/tmp"}}
        ws = await _create_workspace(
            db_session, tmp_path, created_by=user.id, name="ws-cmd", mcp_servers={"fetch": plain}
        )
        await apply_workspace_import(
            db_session, await scan_workspaces(db_session, None, user), "mine", user
        )

        # cmd /c 包装形态（等价配置）→ duplicate
        _write_mcp_json(
            ws,
            {
                "fetch": {
                    "command": "cmd",
                    "args": ["/c", "npx", "-y", "server"],
                    "env": {"CACHE_DIR": "/tmp"},
                }
            },
        )
        candidates = await scan_workspaces(db_session, None, user)
        assert _by_name(candidates, "fetch").dedup_verdict == "duplicate"

        # cmd.exe /C 全路径形态（等价配置）→ duplicate
        _write_mcp_json(
            ws,
            {
                "fetch": {
                    "command": "C:\\Windows\\System32\\cmd.exe",
                    "args": ["/C", "npx", "-y", "server"],
                    "env": {"CACHE_DIR": "/tmp"},
                }
            },
        )
        candidates = await scan_workspaces(db_session, None, user)
        assert _by_name(candidates, "fetch").dedup_verdict == "duplicate"

    async def test_renamed_when_config_differs(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """同锚异配置 → renamed；apply 落库为 原名-<workspace 短名>，两行同 dedup_key；
        再次扫描判 duplicate（等价行已存在，判定稳定）。"""
        user = await _create_user(db_session, label="v3")
        ws = await _create_workspace(
            db_session,
            tmp_path,
            created_by=user.id,
            name="Demo WS",  # slug 短名 → demo-ws
            mcp_servers={"fetch": _entry()},
        )
        await apply_workspace_import(
            db_session, await scan_workspaces(db_session, None, user), "mine", user
        )

        _write_mcp_json(ws, {"fetch": _entry(command="npx", args=["other-server"])})
        candidates = await scan_workspaces(db_session, None, user)
        assert _by_name(candidates, "fetch").dedup_verdict == "renamed"

        result = await apply_workspace_import(db_session, candidates, "mine", user)
        assert result.imported == ["fetch-demo-ws"]

        rows = {r.name: r for r in await _rows(db_session)}
        assert set(rows) == {"fetch", "fetch-demo-ws"}
        assert all(r.dedup_key == f"ws:{ws.id}:fetch" for r in rows.values())
        assert rows["fetch-demo-ws"].server_config["command"] == "npx"

        again = await scan_workspaces(db_session, None, user)
        assert _by_name(again, "fetch").dedup_verdict == "duplicate"

    async def test_renamed_short_name_falls_back_to_id_prefix(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """纯非 ASCII workspace 名 slug 为空 → 短名回退 id 前 6 位。"""
        user = await _create_user(db_session, label="v4")
        ws = await _create_workspace(
            db_session,
            tmp_path,
            created_by=user.id,
            name="中文工作区",
            mcp_servers={"fetch": _entry()},
        )
        await apply_workspace_import(
            db_session, await scan_workspaces(db_session, None, user), "mine", user
        )

        _write_mcp_json(ws, {"fetch": _entry(command="npx")})
        candidates = await scan_workspaces(db_session, None, user)
        assert _by_name(candidates, "fetch").dedup_verdict == "renamed"

        result = await apply_workspace_import(db_session, candidates, "mine", user)

        expected = f"fetch-{ws.id.hex[:6]}"
        assert result.imported == [expected]
        assert {r.name for r in await _rows(db_session)} == {"fetch", expected}


# ── apply：幂等、元数据、重读文件取明文、name 归一化 ─────────────────────────


class TestApplySemantics:
    async def test_reapply_all_skip(self, db_session: AsyncSession, tmp_path: Path) -> None:
        """重复 apply：dedup_key 命中且配置相同 → 全 skip，不产生重复行。"""
        user = await _create_user(db_session, label="a1")
        await _create_workspace(
            db_session,
            tmp_path,
            created_by=user.id,
            name="ws-idem",
            mcp_servers={"fetch": _entry()},
        )
        candidates = await scan_workspaces(db_session, None, user)

        first = await apply_workspace_import(db_session, candidates, "mine", user)
        second = await apply_workspace_import(db_session, candidates, "mine", user)

        assert first.imported == ["fetch"]
        assert second.imported == []
        assert len(second.skipped) == 1
        assert second.skipped[0].startswith("fetch:")
        assert len(await _rows(db_session)) == 1

    async def test_apply_metadata_and_scope(self, db_session: AsyncSession, tmp_path: Path) -> None:
        """导入行 source=imported_workspace、dedup_key=ws:<workspace_id>:<原名>、
        scope=mine → owner=操作者。"""
        user = await _create_user(db_session, label="a2")
        ws = await _create_workspace(
            db_session,
            tmp_path,
            created_by=user.id,
            name="ws-meta",
            mcp_servers={"fetch": _entry()},
        )

        await apply_workspace_import(
            db_session, await scan_workspaces(db_session, None, user), "mine", user
        )

        row = (await _rows(db_session))[0]
        assert row.source == "imported_workspace"
        assert row.dedup_key == f"ws:{ws.id}:fetch"
        assert row.owner_user_id == user.id

    async def test_apply_rereads_file_for_plaintext(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """候选 server_config 已脱敏（<set>）——apply 重读文件取明文：secret 键只进
        encrypted_env，server_config.env 只剩非 secret 明文。"""
        user = await _create_user(db_session, label="a3")
        await _create_workspace(
            db_session,
            tmp_path,
            created_by=user.id,
            name="ws-sec",
            mcp_servers={
                "fetch": {
                    "command": "uvx",
                    "args": ["mcp-server-fetch"],
                    "env": {"GITHUB_TOKEN": "ghp_wsplain", "CACHE_DIR": "/tmp"},
                }
            },
        )
        candidates = await scan_workspaces(db_session, None, user)
        assert _by_name(candidates, "fetch").server_config["env"]["GITHUB_TOKEN"] == "<set>"

        result = await apply_workspace_import(db_session, candidates, "mine", user)

        assert result.imported == ["fetch"]
        row = (await _rows(db_session))[0]
        assert row.server_config["env"] == {"CACHE_DIR": "/tmp"}
        assert row.encrypted_env is not None
        assert set(row.encrypted_env) == {"GITHUB_TOKEN"}
        dumped = json.dumps({"cfg": row.server_config, "enc": row.encrypted_env}, default=str)
        assert "ghp_wsplain" not in dumped

    async def test_raw_name_normalized_dedup_key_keeps_raw(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """文件键 Context7_Fetch → 行名 context7-fetch（计 renamed）；dedup_key 保留
        原名可追溯（R-07）。"""
        user = await _create_user(db_session, label="a4")
        ws = await _create_workspace(
            db_session,
            tmp_path,
            created_by=user.id,
            name="ws-norm",
            mcp_servers={"Context7_Fetch": _entry()},
        )

        candidates = await scan_workspaces(db_session, None, user)
        assert [c.name for c in candidates] == ["context7-fetch"]

        result = await apply_workspace_import(db_session, candidates, "mine", user)

        assert result.imported == ["context7-fetch"]
        assert result.renamed == ["context7-fetch"]
        row = (await _rows(db_session))[0]
        assert row.name == "context7-fetch"
        assert row.dedup_key == f"ws:{ws.id}:Context7_Fetch"
