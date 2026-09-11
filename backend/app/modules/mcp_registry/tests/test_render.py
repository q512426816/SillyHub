"""render 单测：注入集渲染 golden + 诊断预检五项（D-011 逐项）。

Change: 2026-09-10-mcp-central-registry（task-04 / TDD 先行）

覆盖（task implementation/acceptance 逐项）:
- 渲染：platform ∪ user 并集 / user_id=None 仅 platform / 同 server 双绑定去重 /
  enabled 过滤与未绑定排除 / 解密回填 golden / 解密失败降级无 secret 形态不炸
  渲染 / 非 stdio 剔除 / 空库空集不抛错；
- 诊断五项：decrypt_failed（platform 位才查，user 位不越界）/ bound_but_disabled /
  invalid_type_defensive（写路径外的直插 http 行）/ platform_name_shadow（含
  platform 名自动放行不误报 blocked）/ workspace_blocked_by_whitelist（KV 白名单
  命中不报）/ 禁用 platform 位不算 shadow / 容错（无 .mcp.json、坏 JSON、软删
  workspace 不抛错不误报）。

范式参考：
- ``tests/test_service.py``（真实 CredentialCipher 跑加解密不 mock；错版密钥用
  ``CredentialCipher(bb*32, "v2")`` 制造 CipherKeyMismatch）；
- ``daemon/tests/test_mcp_config_endpoint.py``（Workspace + SpecWorkspace 直插行
  定位 specDir/.mcp.json，tmp_path 落文件）。

非 stdio 行走 ORM 直插（service 写路径 D-005 已挡 http/sse，诊断的
invalid_type_defensive 正是为直插/脏数据兜底——先例 test_service 的
model_construct 逃逸口思路）。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import CredentialCipher
from app.modules.auth.model import User
from app.modules.mcp_registry.model import McpServer, McpServerBinding
from app.modules.mcp_registry.render import precheck_diagnostics, render_injection_set
from app.modules.mcp_registry.schema import McpDiagnostic, McpServerCreate
from app.modules.mcp_registry.service import McpRegistryService

# ── Helpers ──────────────────────────────────────────────────────────────────

_PLAIN_CONFIG = {"command": "uvx", "args": ["mcp-server-fetch"], "env": {"CACHE_DIR": "/tmp"}}

_SECRET_ENV = {"GITHUB_TOKEN": "ghp_plainsecret", "CACHE_DIR": "/tmp"}

_SECRET_CONFIG = {"command": "npx", "args": ["-y", "server"], "env": dict(_SECRET_ENV)}


async def _create_user(db_session: AsyncSession, *, label: str = "", admin: bool = False) -> User:
    """插入真实 User 行（service 收 User 对象；admin=is_platform_admin 短路 rbac）。"""
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=f"mcp-r-{uid.hex[:8]}-{label}@example.com",
        username=f"mcp-r-{uid.hex[:8]}",
        password_hash="irrelevant",
        display_name=f"MCP Render {label}",
        status="active",
        is_platform_admin=admin,
    )
    db_session.add(user)
    await db_session.commit()
    return user


async def _create_platform_server(
    db_session: AsyncSession,
    admin: User,
    *,
    name: str,
    server_config: dict[str, Any] | None = None,
    cipher: CredentialCipher | None = None,
    secret_env_keys: list[str] | None = None,
) -> McpServer:
    """经 service 真实写路径建平台共享 server 并绑 platform（返回 ORM 行）。"""
    from app.modules.mcp_registry.schema import McpServerCreate

    svc = (
        McpRegistryService(db_session)
        if cipher is None
        else McpRegistryService(db_session, cipher=cipher)
    )
    detail = await svc.create_server(
        McpServerCreate(
            name=name,
            server_config=dict(server_config or _PLAIN_CONFIG),
            secret_env_keys=secret_env_keys,
            scope="platform",
        ),
        admin,
    )
    await svc.add_binding(detail.id, "platform", admin)
    row = await db_session.get(McpServer, detail.id)
    assert row is not None
    return row


async def _insert_platform_bound_row(
    db_session: AsyncSession,
    *,
    name: str,
    server_type: str = "stdio",
    enabled: bool = True,
) -> McpServer:
    """ORM 直插 platform-bound 行（绕开 service 写路径校验——非 stdio / 禁用态专用）。"""
    row = McpServer(
        name=name,
        owner_user_id=None,
        server_type=server_type,
        server_config=dict(_PLAIN_CONFIG),
        tags=[],
        note="",
        enabled=enabled,
        source="manual",
    )
    db_session.add(row)
    await db_session.flush()
    db_session.add(McpServerBinding(server_id=row.id, scope_type="platform", scope_ref=None))
    await db_session.commit()
    await db_session.refresh(row)
    return row


async def _create_workspace_with_mcp_json(
    db_session: AsyncSession,
    tmp_path: Path,
    *,
    created_by: uuid.UUID,
    name: str,
    mcp_servers: dict[str, Any] | None = None,
    soft_delete: bool = False,
) -> None:
    """直插 Workspace + SpecWorkspace 行并按需落 specDir/.mcp.json（daemon 测试同法）。"""
    from app.modules.spec_workspace.model import SpecWorkspace
    from app.modules.workspace.model import Workspace

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
        (spec_root / ".mcp.json").write_text(
            json.dumps({"mcpServers": mcp_servers}), encoding="utf-8"
        )
    await db_session.commit()


async def _put_whitelist(db_session: AsyncSession, names: list[str]) -> None:
    """落 settings KV mcp.whitelist（PlatformSetting JSON 行，daemon 端点同存储）。"""
    from app.modules.settings.model import PlatformSetting
    from app.modules.settings.router import MCP_WHITELIST_KEY

    db_session.add(PlatformSetting(key=MCP_WHITELIST_KEY, value=json.dumps(names)))
    await db_session.commit()


def _by_code(diags: list[McpDiagnostic], code: str) -> list[McpDiagnostic]:
    return [d for d in diags if d.code == code]


# ── 注入集渲染 golden（task acceptance 1-3）──────────────────────────────────


class TestRenderInjectionSet:
    async def test_platform_union_user_injection_set(self, db_session: AsyncSession) -> None:
        """user_id 有值 → platform ∪ user；None → 仅 platform；他人 user 位不串。"""
        admin = await _create_user(db_session, label="adm", admin=True)
        user_a = await _create_user(db_session, label="a")
        user_b = await _create_user(db_session, label="b")
        await _create_platform_server(db_session, admin, name="plat-fetch")
        from app.modules.mcp_registry.schema import McpServerCreate

        svc = McpRegistryService(db_session)
        mine_a = await svc.create_server(
            McpServerCreate(name="mine-a", server_config=dict(_PLAIN_CONFIG)), user_a
        )
        await svc.add_binding(mine_a.id, "user", user_a)
        mine_b = await svc.create_server(
            McpServerCreate(name="mine-b", server_config=dict(_PLAIN_CONFIG)), user_b
        )
        await svc.add_binding(mine_b.id, "user", user_b)

        golden = {
            "plat-fetch": {
                "command": "uvx",
                "args": ["mcp-server-fetch"],
                "env": {"CACHE_DIR": "/tmp"},
            }
        }
        assert await render_injection_set(db_session, None) == {"mcpServers": golden}
        assert set((await render_injection_set(db_session, user_a.id))["mcpServers"]) == {
            "plat-fetch",
            "mine-a",
        }
        assert set((await render_injection_set(db_session, user_b.id))["mcpServers"]) == {
            "plat-fetch",
            "mine-b",
        }

    async def test_platform_and_user_binding_on_same_server_no_duplicate(
        self, db_session: AsyncSession
    ) -> None:
        """同一 server 同时挂 platform + user binding → join 去重，单条输出。"""
        admin = await _create_user(db_session, label="adm", admin=True)
        user = await _create_user(db_session, label="u")
        row = await _create_platform_server(db_session, admin, name="dual-bound")
        await McpRegistryService(db_session).add_binding(row.id, "user", user)

        rendered = (await render_injection_set(db_session, user.id))["mcpServers"]

        assert list(rendered) == ["dual-bound"]

    async def test_unbound_and_disabled_excluded(self, db_session: AsyncSession) -> None:
        """未绑定的 server 不出现；enabled=false 的绑定 server 也不出现。"""
        admin = await _create_user(db_session, label="adm", admin=True)
        svc = McpRegistryService(db_session)
        from app.modules.mcp_registry.schema import McpServerCreate, McpServerUpdate

        await svc.create_server(  # 有 server 无 binding
            McpServerCreate(name="orphan", server_config=dict(_PLAIN_CONFIG), scope="platform"),
            admin,
        )
        disabled = await svc.create_server(
            McpServerCreate(name="disabled", server_config=dict(_PLAIN_CONFIG), scope="platform"),
            admin,
        )
        await svc.add_binding(disabled.id, "platform", admin)
        await svc.update_server(disabled.id, McpServerUpdate(enabled=False), admin)

        assert await render_injection_set(db_session, None) == {"mcpServers": {}}

    async def test_decrypt_backfill_golden_shape(self, db_session: AsyncSession) -> None:
        """encrypted_env 解密回填 env，与 server_config 明文键合并输出。"""
        admin = await _create_user(db_session, label="adm", admin=True)
        await _create_platform_server(
            db_session,
            admin,
            name="with-secrets",
            server_config=dict(_SECRET_CONFIG),
            secret_env_keys=["GITHUB_TOKEN"],
        )

        rendered = (await render_injection_set(db_session, None))["mcpServers"]

        assert rendered == {
            "with-secrets": {
                "command": "npx",
                "args": ["-y", "server"],
                "env": {"GITHUB_TOKEN": "ghp_plainsecret", "CACHE_DIR": "/tmp"},
            }
        }

    async def test_decrypt_failure_degrades_to_no_secret_form(
        self, db_session: AsyncSession
    ) -> None:
        """错版密钥（CipherKeyMismatch）→ 该 server 降级无 secret 形态，渲染不炸。"""
        admin = await _create_user(db_session, label="adm", admin=True)
        stale_cipher = CredentialCipher(bytes.fromhex("bb" * 32), "v2")
        await _create_platform_server(
            db_session,
            admin,
            name="stale-secret",
            server_config=dict(_SECRET_CONFIG),
            cipher=stale_cipher,
            secret_env_keys=["GITHUB_TOKEN"],
        )
        await _create_platform_server(db_session, admin, name="healthy")  # 同批对照

        rendered = (await render_injection_set(db_session, None))["mcpServers"]

        assert rendered["stale-secret"] == {
            "command": "npx",
            "args": ["-y", "server"],
            "env": {"CACHE_DIR": "/tmp"},  # secret 键整体丢弃（无 secret 形态）
        }
        assert rendered["healthy"]["env"] == {"CACHE_DIR": "/tmp"}

    async def test_same_name_user_overrides_platform_deterministically(
        self, db_session: AsyncSession
    ) -> None:
        """P2-10（ql-20260911-003-355a）：同名 platform/user 条目——用户私有确定性
        覆盖平台位（platform 先处理、user 后处理；platform 视角不受影响）。"""
        admin = await _create_user(db_session, label="adm", admin=True)
        user = await _create_user(db_session, label="u")
        await _create_platform_server(
            db_session,
            admin,
            name="dupe",
            server_config={"command": "plat-cmd", "args": [], "env": {}},
        )
        svc = McpRegistryService(db_session)
        mine = await svc.create_server(
            McpServerCreate(
                name="dupe",
                server_config={"command": "user-cmd", "args": [], "env": {}},
                scope="mine",
            ),
            user,
        )
        await svc.add_binding(mine.id, "user", user)

        user_view = (await render_injection_set(db_session, user.id))["mcpServers"]
        platform_view = (await render_injection_set(db_session, None))["mcpServers"]

        assert user_view["dupe"]["command"] == "user-cmd"  # 用户私有覆盖
        assert platform_view["dupe"]["command"] == "plat-cmd"  # 平台视角不变

    async def test_empty_registry_renders_empty_structure(self, db_session: AsyncSession) -> None:
        """空库输出空 mcpServers 结构不抛错（对齐 KV 缺失回落语义）。"""
        assert await render_injection_set(db_session, None) == {"mcpServers": {}}
        assert await render_injection_set(db_session, uuid.uuid4()) == {"mcpServers": {}}

    async def test_non_stdio_excluded_from_output(self, db_session: AsyncSession) -> None:
        """server_type 非 stdio 剔除不输出（invalid_type_defensive 对应防御）。"""
        admin = await _create_user(db_session, label="adm", admin=True)
        await _create_platform_server(db_session, admin, name="stdio-one")
        await _insert_platform_bound_row(db_session, name="remote-http", server_type="http")

        rendered = (await render_injection_set(db_session, None))["mcpServers"]

        assert set(rendered) == {"stdio-one"}


# ── 诊断预检五项（D-011 逐项，task acceptance 4）────────────────────────────


class TestPrecheckDiagnostics:
    async def test_clean_state_returns_empty(self, db_session: AsyncSession) -> None:
        """无绑定 / 无 workspace / 无 KV → 空诊断列表不抛错。"""
        assert await precheck_diagnostics(db_session) == []

    async def test_decrypt_failed_diagnostic(self, db_session: AsyncSession) -> None:
        """platform 位错版密文 → decrypt_failed（含 server_name）；user 位不越界。"""
        admin = await _create_user(db_session, label="adm", admin=True)
        user = await _create_user(db_session, label="u")
        stale_cipher = CredentialCipher(bytes.fromhex("bb" * 32), "v2")
        await _create_platform_server(
            db_session,
            admin,
            name="plat-stale",
            server_config=dict(_SECRET_CONFIG),
            cipher=stale_cipher,
            secret_env_keys=["GITHUB_TOKEN"],
        )
        # user 位错版密文（私有 + user binding）：平台预检不查 user 位
        svc = McpRegistryService(db_session)
        from app.modules.mcp_registry.schema import McpServerCreate

        mine_stale = await McpRegistryService(db_session, cipher=stale_cipher).create_server(
            McpServerCreate(
                name="mine-stale",
                server_config=dict(_SECRET_CONFIG),
                secret_env_keys=["GITHUB_TOKEN"],
            ),
            user,
        )
        await svc.add_binding(mine_stale.id, "user", user)

        diags = await precheck_diagnostics(db_session)

        failed = _by_code(diags, "decrypt_failed")
        assert [d.server_name for d in failed] == ["plat-stale"]
        assert failed[0].server_id is not None
        assert "Key mismatch" in (failed[0].detail or "")

    async def test_bound_but_disabled_diagnostic(self, db_session: AsyncSession) -> None:
        """有 platform binding 但 enabled=false → 配置死角提示。"""
        row = await _insert_platform_bound_row(db_session, name="ghost", enabled=False)

        diags = await precheck_diagnostics(db_session)

        disabled = _by_code(diags, "bound_but_disabled")
        assert len(disabled) == 1
        assert disabled[0].server_id == row.id
        assert disabled[0].server_name == "ghost"

    async def test_invalid_type_defensive_diagnostic(self, db_session: AsyncSession) -> None:
        """platform 位混入非 stdio（写路径外脏数据）→ 严重级提示。"""
        row = await _insert_platform_bound_row(db_session, name="remote-sse", server_type="sse")

        diags = await precheck_diagnostics(db_session)

        invalid = _by_code(diags, "invalid_type_defensive")
        assert len(invalid) == 1
        assert invalid[0].server_id == row.id
        assert "sse" in (invalid[0].detail or "")

    async def test_platform_name_shadow_and_auto_allow(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """workspace 同名遮蔽 platform 位；platform 渲染集名自动放行不算 blocked。"""
        admin = await _create_user(db_session, label="adm", admin=True)
        plat = await _create_platform_server(db_session, admin, name="fetch")
        await _create_workspace_with_mcp_json(
            db_session,
            tmp_path,
            created_by=admin.id,
            name="ws-shadow",
            mcp_servers={
                "fetch": {"command": "npx", "args": ["-y", "local-fetch"]},
                "ws-only": {"command": "npx", "args": ["-y", "ws-tool"]},
            },
        )
        # 白名单留空：fetch 靠 platform 名自动放行，ws-only 无人背书
        await _put_whitelist(db_session, [])

        diags = await precheck_diagnostics(db_session)

        shadow = _by_code(diags, "platform_name_shadow")
        assert len(shadow) == 1
        assert shadow[0].server_id == plat.id
        assert shadow[0].server_name == "fetch"
        assert "ws-shadow" in (shadow[0].detail or "")
        blocked = _by_code(diags, "workspace_blocked_by_whitelist")
        assert [d.server_name for d in blocked] == ["ws-only"]  # fetch 不误报

    async def test_workspace_blocked_by_whitelist_respects_kv(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """KV mcp.whitelist 命中的 workspace server 不报，未命中的报。"""
        admin = await _create_user(db_session, label="adm", admin=True)
        await _create_workspace_with_mcp_json(
            db_session,
            tmp_path,
            created_by=admin.id,
            name="ws-wl",
            mcp_servers={
                "allowed-one": {"command": "npx", "args": []},
                "blocked-one": {"command": "npx", "args": []},
            },
        )
        await _put_whitelist(db_session, ["allowed-one"])

        diags = await precheck_diagnostics(db_session)

        blocked = _by_code(diags, "workspace_blocked_by_whitelist")
        assert [d.server_name for d in blocked] == ["blocked-one"]
        assert blocked[0].server_id is None  # workspace 位非 registry 实体
        assert "ws-wl" in (blocked[0].detail or "")

    async def test_disabled_platform_position_not_shadowed(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """禁用的 platform 位不进渲染集 → 不构成 shadow，只有 bound_but_disabled。"""
        admin = await _create_user(db_session, label="adm", admin=True)
        await _insert_platform_bound_row(db_session, name="ghost-shared", enabled=False)
        await _create_workspace_with_mcp_json(
            db_session,
            tmp_path,
            created_by=admin.id,
            name="ws-ghost",
            mcp_servers={"ghost-shared": {"command": "npx", "args": []}},
        )

        diags = await precheck_diagnostics(db_session)

        assert _by_code(diags, "platform_name_shadow") == []
        assert len(_by_code(diags, "bound_but_disabled")) == 1

    async def test_workspace_fault_tolerance(
        self, db_session: AsyncSession, tmp_path: Path
    ) -> None:
        """无 .mcp.json / 坏 JSON / 软删 workspace → 不抛错不误报。"""
        from app.modules.spec_workspace.model import SpecWorkspace
        from app.modules.workspace.model import Workspace

        admin = await _create_user(db_session, label="adm", admin=True)
        # 1) specDir 存在但无 .mcp.json
        await _create_workspace_with_mcp_json(
            db_session, tmp_path, created_by=admin.id, name="ws-empty"
        )
        # 2) 坏 JSON 文件
        spec_root = tmp_path / "spec-broken"
        spec_root.mkdir()
        (spec_root / ".mcp.json").write_text("{not json", encoding="utf-8")
        ws = Workspace(
            id=uuid.uuid4(),
            name="ws-broken",
            slug=f"slug-{uuid.uuid4().hex[:8]}",
            root_path=str(spec_root),
            status="active",
            created_by=admin.id,
        )
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
        # 3) 软删 workspace 带正常 .mcp.json（应被排除）
        await _create_workspace_with_mcp_json(
            db_session,
            tmp_path,
            created_by=admin.id,
            name="ws-dead",
            mcp_servers={"dead-tool": {"command": "npx", "args": []}},
            soft_delete=True,
        )
        await db_session.commit()

        diags = await precheck_diagnostics(db_session)

        assert _by_code(diags, "workspace_blocked_by_whitelist") == []
        assert _by_code(diags, "platform_name_shadow") == []
