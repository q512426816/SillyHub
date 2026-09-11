"""McpRegistryService 单测：权限矩阵 + binding 约束 + 加密读写 + 写路径校验。

Change: 2026-09-10-mcp-central-registry（task-02 / TDD 先行）

覆盖（task implementation/acceptance 逐项）:
- 权限三态（D-001）：非 admin 平台库写 403 / 跨用户私有库读改删 404（防存在性
  枚举，skills 先例）/ 归属者 + admin 正常通过；
- list 三 scope（platform 全员可见 / mine / visible=平台∪自己）+ search/tag 过滤
  + 绑定态注入（platform_bound/user_bound）；
- binding 约束（D-002）：platform 需 admin + 重复 409；user binding 归属校验
  （自己的私有 / 平台共享放行，他人的私有 404/422 拒绝）+ 重复 409 + 解绑；
- 加密读写（Grill CC-03 / R-04）：secret 入库无明文（server_config.env 只剩
  非 secret 键 + encrypted_env 逐键信封）、decrypt_server_env 回读一致、update
  重抽列重加密 / 不传 server_config 密文不动、key 失配抛 CipherKeyMismatch
  上抛不吞错；
- 写路径校验（D-005 + design name 正则）：非 stdio 422、非法 name 422、同
  owner 维度同名 409 / 跨维度同名放行；
- delete 级联 binding 靠 FK CASCADE（SQLite 侧 PRAGMA foreign_keys=ON 验证）。

范式参考：
- ``app/modules/llm_provider/tests/test_llm_provider.py``（真实 CredentialCipher
  跑加解密不 mock；conftest 已注入 SILLYSPEC_MASTER_KEY=v1:aa*32）；
- ``app/modules/skills/tests/``（service 层 404 防枚举先例）。

非法 name 的 service 级校验用 ``model_construct`` 绕过 schema pattern（pydantic
官方逃逸口），否则 DTO 构造期就抛 ValidationError 到不了 service。
"""

from __future__ import annotations

import json
import uuid
from typing import Any

import pytest
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.crypto import CipherKeyMismatch, CredentialCipher
from app.core.errors import PermissionDenied
from app.modules.auth.model import User
from app.modules.mcp_registry.model import McpServer, McpServerBinding
from app.modules.mcp_registry.schema import McpServerCreate, McpServerUpdate
from app.modules.mcp_registry.service import (
    McpBindingDuplicate,
    McpBindingNotFound,
    McpBindingScopeInvalid,
    McpRegistryService,
    McpServerNameConflict,
    McpServerNameInvalid,
    McpServerNotFound,
    McpServerSecretEnvInvalid,
    McpServerTypeInvalid,
)

# ── Helpers ──────────────────────────────────────────────────────────────────

_PLAIN_CONFIG = {"command": "uvx", "args": ["mcp-server-fetch"], "env": {"CACHE_DIR": "/tmp"}}

_SECRET_ENV = {
    "GITHUB_TOKEN": "ghp_plainsecret",  # token
    "API_KEY": "sk-plain-1234",  # key
    "DB_SECRET": "plain-secret",  # secret
    "MYSQL_PASSWORD": "plain-pass",  # password（大小写不敏感）
    "CACHE_DIR": "/tmp",  # 明文留存
}

_SECRET_CONFIG = {"command": "npx", "args": ["-y", "server"], "env": dict(_SECRET_ENV)}

# 全部密钥键的显式指定态（用户自定义密钥类型——不再按键名自动判定）。
_ALL_SECRET_KEYS = ["GITHUB_TOKEN", "API_KEY", "DB_SECRET", "MYSQL_PASSWORD"]


async def _create_user(db_session: AsyncSession, *, label: str = "", admin: bool = False) -> User:
    """插入真实 User 行（service 收 User 对象；admin=is_platform_admin 短路 rbac）。"""
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=f"mcp-{uid.hex[:8]}-{label}@example.com",
        username=f"mcp-{uid.hex[:8]}",
        password_hash="irrelevant",
        display_name=f"MCP Test {label}",
        status="active",
        is_platform_admin=admin,
    )
    db_session.add(user)
    await db_session.commit()
    return user


def _payload(**overrides: Any) -> McpServerCreate:
    """默认 mine scope 的创建 payload。"""
    defaults: dict[str, Any] = {
        "name": "fetch",
        "server_config": dict(_PLAIN_CONFIG),
    }
    defaults.update(overrides)
    return McpServerCreate(**defaults)


async def _all_servers(db_session: AsyncSession) -> list[McpServer]:
    return list((await db_session.execute(select(McpServer))).scalars().all())


async def _bindings_of(db_session: AsyncSession, server_id: uuid.UUID) -> list[McpServerBinding]:
    stmt = select(McpServerBinding).where(McpServerBinding.server_id == server_id)
    return list((await db_session.execute(stmt)).scalars().all())


# ── 权限三态（D-001：非 admin 平台库 403 / 跨用户私有 404 / 归属者+admin 通过）──


class TestPermissionMatrix:
    async def test_platform_create_by_non_admin_raises_403(self, db_session: AsyncSession) -> None:
        user = await _create_user(db_session, label="plain")
        svc = McpRegistryService(db_session)

        with pytest.raises(PermissionDenied) as exc_info:
            await svc.create_server(_payload(scope="platform"), user)

        assert exc_info.value.http_status == 403
        assert await _all_servers(db_session) == []  # 无写入

    async def test_platform_create_by_admin_ok(self, db_session: AsyncSession) -> None:
        admin = await _create_user(db_session, label="adm", admin=True)
        svc = McpRegistryService(db_session)

        detail = await svc.create_server(_payload(name="plat-fetch", scope="platform"), admin)

        assert detail.owner_user_id is None  # 平台共享位

    async def test_platform_update_delete_by_non_admin_raises_403(
        self, db_session: AsyncSession
    ) -> None:
        admin = await _create_user(db_session, label="adm", admin=True)
        plain = await _create_user(db_session, label="plain")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(_payload(name="plat-w", scope="platform"), admin)

        with pytest.raises(PermissionDenied):
            await svc.update_server(created.id, McpServerUpdate(note="hijack"), plain)
        with pytest.raises(PermissionDenied):
            await svc.delete_server(created.id, plain)

        assert await db_session.get(McpServer, created.id) is not None  # 行仍在

    async def test_cross_user_private_update_delete_raises_404_no_leak(
        self, db_session: AsyncSession
    ) -> None:
        """跨用户私有库读改删一律 404（与不存在同错误码，防存在性枚举）。"""
        owner = await _create_user(db_session, label="own")
        stranger = await _create_user(db_session, label="str")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(_payload(name="private-a"), owner)

        with pytest.raises(McpServerNotFound) as update_exc:
            await svc.update_server(created.id, McpServerUpdate(note="hijack"), stranger)
        with pytest.raises(McpServerNotFound):
            await svc.delete_server(created.id, stranger)
        # 完全不存在的 id 与跨用户同错误码（枚举无差别）
        with pytest.raises(McpServerNotFound):
            await svc.update_server(uuid.uuid4(), McpServerUpdate(note="x"), stranger)

        assert update_exc.value.http_status == 404
        fresh = await db_session.get(McpServer, created.id)
        assert fresh is not None
        assert fresh.note == ""  # 数据未被改动

    async def test_cross_user_private_admin_passes(self, db_session: AsyncSession) -> None:
        owner = await _create_user(db_session, label="own")
        admin = await _create_user(db_session, label="adm", admin=True)
        svc = McpRegistryService(db_session)
        created = await svc.create_server(_payload(name="private-b"), owner)

        updated = await svc.update_server(created.id, McpServerUpdate(note="by-admin"), admin)

        assert updated.note == "by-admin"
        await svc.delete_server(created.id, admin)
        assert await db_session.get(McpServer, created.id) is None

    async def test_owner_updates_own_private(self, db_session: AsyncSession) -> None:
        owner = await _create_user(db_session, label="own")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(_payload(name="private-c"), owner)

        updated = await svc.update_server(
            created.id, McpServerUpdate(note="mine", enabled=False), owner
        )

        assert updated.note == "mine"
        assert updated.enabled is False


# ── list 三 scope + search/tag + 绑定态注入 ───────────────────────────────────


class TestListScopes:
    async def _seed(self, db_session: AsyncSession) -> tuple[User, User]:
        admin = await _create_user(db_session, label="adm", admin=True)
        user_a = await _create_user(db_session, label="a")
        user_b = await _create_user(db_session, label="b")
        svc = McpRegistryService(db_session)
        await svc.create_server(_payload(name="plat-fetch", scope="platform"), admin)
        await svc.create_server(_payload(name="mine-a"), user_a)
        await svc.create_server(_payload(name="mine-b"), user_b)
        return user_a, user_b

    async def test_scope_platform_returns_only_platform_rows(
        self, db_session: AsyncSession
    ) -> None:
        user_a, _ = await self._seed(db_session)
        svc = McpRegistryService(db_session)

        listing = await svc.list_servers("platform", user_a)

        assert [i.name for i in listing.items] == ["plat-fetch"]
        assert listing.total == 1

    async def test_scope_mine_returns_only_own_rows(self, db_session: AsyncSession) -> None:
        user_a, _ = await self._seed(db_session)
        svc = McpRegistryService(db_session)

        listing = await svc.list_servers("mine", user_a)

        assert [i.name for i in listing.items] == ["mine-a"]

    async def test_scope_visible_is_platform_plus_own(self, db_session: AsyncSession) -> None:
        """visible = 平台共享全员可见 + 自己私有（他人私有不可见）。"""
        user_a, _ = await self._seed(db_session)
        svc = McpRegistryService(db_session)

        listing = await svc.list_servers("visible", user_a)

        names = {i.name for i in listing.items}
        assert names == {"plat-fetch", "mine-a"}  # mine-b 被排除

    async def test_search_filters_by_name_and_note(self, db_session: AsyncSession) -> None:
        user_a, _ = await self._seed(db_session)
        svc = McpRegistryService(db_session)
        await svc.update_server(
            (await svc.list_servers("mine", user_a)).items[0].id,
            McpServerUpdate(note="filesystem helper"),
            user_a,
        )

        by_name = await svc.list_servers("visible", user_a, search="plat")
        by_note = await svc.list_servers("visible", user_a, search="filesystem")

        assert [i.name for i in by_name.items] == ["plat-fetch"]
        assert [i.name for i in by_note.items] == ["mine-a"]

    async def test_tag_filters_python_side(self, db_session: AsyncSession) -> None:
        admin = await _create_user(db_session, label="adm", admin=True)
        user = await _create_user(db_session, label="u")
        svc = McpRegistryService(db_session)
        tagged = await svc.create_server(_payload(name="tagged", scope="platform"), admin)
        await svc.create_server(_payload(name="untagged", scope="platform"), admin)
        await svc.update_server(tagged.id, McpServerUpdate(tags=["net"]), admin)

        listing = await svc.list_servers("platform", user, tag="net")

        assert [i.name for i in listing.items] == ["tagged"]

    async def test_binding_state_annotation(self, db_session: AsyncSession) -> None:
        """platform_bound 按 server 维度、user_bound 按当前用户视角注入。"""
        admin = await _create_user(db_session, label="adm", admin=True)
        user = await _create_user(db_session, label="u")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(_payload(name="plat-bound", scope="platform"), admin)
        await svc.add_binding(created.id, "platform", admin)
        await svc.add_binding(created.id, "user", user)

        other = await _create_user(db_session, label="other")
        mine_view = await svc.list_servers("visible", user)
        other_view = await svc.list_servers("visible", other)

        item_mine = next(i for i in mine_view.items if i.id == created.id)
        assert item_mine.platform_bound is True
        assert item_mine.user_bound is True
        item_other = next(i for i in other_view.items if i.id == created.id)
        assert item_other.platform_bound is True  # 平台绑定对所有人可见
        assert item_other.user_bound is False  # 他人视角不虚报


# ── binding 约束（D-002）──────────────────────────────────────────────────────


class TestBindingConstraints:
    async def test_platform_binding_requires_admin(self, db_session: AsyncSession) -> None:
        admin = await _create_user(db_session, label="adm", admin=True)
        plain = await _create_user(db_session, label="plain")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(_payload(name="plat-srv", scope="platform"), admin)

        with pytest.raises(PermissionDenied) as exc_info:
            await svc.add_binding(created.id, "platform", plain)

        assert exc_info.value.http_status == 403
        assert await _bindings_of(db_session, created.id) == []

    async def test_platform_binding_duplicate_rejected(self, db_session: AsyncSession) -> None:
        admin = await _create_user(db_session, label="adm", admin=True)
        svc = McpRegistryService(db_session)
        created = await svc.create_server(_payload(name="plat-dup", scope="platform"), admin)

        await svc.add_binding(created.id, "platform", admin)
        with pytest.raises(McpBindingDuplicate) as exc_info:
            await svc.add_binding(created.id, "platform", admin)

        assert exc_info.value.http_status == 409
        assert len(await _bindings_of(db_session, created.id)) == 1

    async def test_user_binding_on_own_private_server_ok(self, db_session: AsyncSession) -> None:
        owner = await _create_user(db_session, label="own")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(_payload(name="own-srv"), owner)

        await svc.add_binding(created.id, "user", owner)

        bindings = await _bindings_of(db_session, created.id)
        assert len(bindings) == 1
        assert bindings[0].scope_type == "user"
        assert bindings[0].scope_ref == owner.id

    async def test_user_binding_on_platform_server_ok(self, db_session: AsyncSession) -> None:
        """平台共享 server 任何用户可 user binding（注入集是本人的，非平台库写）。"""
        admin = await _create_user(db_session, label="adm", admin=True)
        plain = await _create_user(db_session, label="plain")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(_payload(name="plat-shared", scope="platform"), admin)

        await svc.add_binding(created.id, "user", plain)

        bindings = await _bindings_of(db_session, created.id)
        assert [(b.scope_type, b.scope_ref) for b in bindings] == [("user", plain.id)]

    async def test_user_binding_on_others_private_non_admin_404(
        self, db_session: AsyncSession
    ) -> None:
        owner = await _create_user(db_session, label="own")
        stranger = await _create_user(db_session, label="str")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(_payload(name="own-private"), owner)

        with pytest.raises(McpServerNotFound):
            await svc.add_binding(created.id, "user", stranger)

        assert await _bindings_of(db_session, created.id) == []

    async def test_user_binding_on_others_private_admin_422(self, db_session: AsyncSession) -> None:
        """admin 可见他人私有 server，但 user binding 的 scope_ref 非归属仍被拒（422）。"""
        owner = await _create_user(db_session, label="own")
        admin = await _create_user(db_session, label="adm", admin=True)
        svc = McpRegistryService(db_session)
        created = await svc.create_server(_payload(name="own-private-2"), owner)

        with pytest.raises(McpBindingScopeInvalid) as exc_info:
            await svc.add_binding(created.id, "user", admin)

        assert exc_info.value.http_status == 422
        assert await _bindings_of(db_session, created.id) == []

    async def test_user_binding_duplicate_rejected(self, db_session: AsyncSession) -> None:
        owner = await _create_user(db_session, label="own")
        other = await _create_user(db_session, label="other")
        admin = await _create_user(db_session, label="adm", admin=True)
        svc = McpRegistryService(db_session)
        created = await svc.create_server(_payload(name="dup-user", scope="platform"), admin)

        await svc.add_binding(created.id, "user", owner)
        with pytest.raises(McpBindingDuplicate):
            await svc.add_binding(created.id, "user", owner)
        # 同 server 不同 scope_ref 的 user binding 放行（partial unique 只按 (server, ref)）
        await svc.add_binding(created.id, "user", other)

        assert len(await _bindings_of(db_session, created.id)) == 2

    async def test_invalid_scope_type_rejected(self, db_session: AsyncSession) -> None:
        owner = await _create_user(db_session, label="own")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(_payload(name="scope-word"), owner)

        with pytest.raises(McpBindingScopeInvalid):
            await svc.add_binding(created.id, "workspace", owner)

    async def test_remove_platform_binding_requires_admin(self, db_session: AsyncSession) -> None:
        admin = await _create_user(db_session, label="adm", admin=True)
        plain = await _create_user(db_session, label="plain")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(_payload(name="plat-rm", scope="platform"), admin)
        await svc.add_binding(created.id, "platform", admin)

        with pytest.raises(PermissionDenied):
            await svc.remove_binding(created.id, "platform", None, plain)
        await svc.remove_binding(created.id, "platform", None, admin)

        assert await _bindings_of(db_session, created.id) == []

    async def test_remove_own_user_binding_ok(self, db_session: AsyncSession) -> None:
        admin = await _create_user(db_session, label="adm", admin=True)
        user = await _create_user(db_session, label="u")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(_payload(name="usr-rm", scope="platform"), admin)
        await svc.add_binding(created.id, "user", user)

        await svc.remove_binding(created.id, "user", user.id, user)

        assert await _bindings_of(db_session, created.id) == []

    async def test_remove_other_user_binding_by_non_admin_403(
        self, db_session: AsyncSession
    ) -> None:
        admin = await _create_user(db_session, label="adm", admin=True)
        owner = await _create_user(db_session, label="own")
        stranger = await _create_user(db_session, label="str")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(_payload(name="usr-other", scope="platform"), admin)
        await svc.add_binding(created.id, "user", owner)

        with pytest.raises(PermissionDenied):
            await svc.remove_binding(created.id, "user", owner.id, stranger)
        # admin 可解他人的 user binding
        await svc.remove_binding(created.id, "user", owner.id, admin)

        assert await _bindings_of(db_session, created.id) == []

    async def test_remove_missing_binding_404(self, db_session: AsyncSession) -> None:
        owner = await _create_user(db_session, label="own")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(_payload(name="usr-miss"), owner)

        with pytest.raises(McpBindingNotFound) as exc_info:
            await svc.remove_binding(created.id, "user", owner.id, owner)

        assert exc_info.value.http_status == 404

    async def test_delete_server_cascades_bindings_via_fk(self, db_session: AsyncSession) -> None:
        """删除级联 binding 靠 FK CASCADE（SQLite 侧开 PRAGMA 才等价 PG 行为）。"""
        await db_session.execute(text("PRAGMA foreign_keys = ON"))
        admin = await _create_user(db_session, label="adm", admin=True)
        user = await _create_user(db_session, label="u")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(_payload(name="plat-cascade", scope="platform"), admin)
        await svc.add_binding(created.id, "platform", admin)
        await svc.add_binding(created.id, "user", user)

        await svc.delete_server(created.id, admin)

        assert await db_session.get(McpServer, created.id) is None
        assert await _bindings_of(db_session, created.id) == []


# ── 加密读写（Grill CC-03 / R-04 / R-05）─────────────────────────────────────


class TestCryptoRoundtrip:
    async def test_create_persists_no_plaintext_secret(self, db_session: AsyncSession) -> None:
        user = await _create_user(db_session, label="a")
        svc = McpRegistryService(db_session)

        await svc.create_server(
            _payload(
                name="secret-srv",
                server_config=dict(_SECRET_CONFIG),
                secret_env_keys=list(_ALL_SECRET_KEYS),
            ),
            user,
        )

        row = (await _all_servers(db_session))[0]
        # 1) server_config.env 只剩非 secret 明文键
        assert row.server_config["env"] == {"CACHE_DIR": "/tmp"}
        assert row.server_config["command"] == "npx"
        # 2) encrypted_env 逐键信封（四标记全命中，R-05 边界）
        assert row.encrypted_env is not None
        assert set(row.encrypted_env) == {
            "GITHUB_TOKEN",
            "API_KEY",
            "DB_SECRET",
            "MYSQL_PASSWORD",
        }
        for envelope in row.encrypted_env.values():
            assert set(envelope) == {"ct", "key_id"}
            assert envelope["key_id"] == "v1"  # conftest 注入的主密钥版本
        # 3) 全行序列化无任何明文 secret（防 naive「拼接」假加密）
        dumped = json.dumps({"config": row.server_config, "enc": row.encrypted_env}, default=str)
        for plaintext in ("ghp_plainsecret", "sk-plain-1234", "plain-secret", "plain-pass"):
            assert plaintext not in dumped

    async def test_decrypt_server_env_roundtrip(self, db_session: AsyncSession) -> None:
        user = await _create_user(db_session, label="a")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(
            _payload(
                name="roundtrip",
                server_config=dict(_SECRET_CONFIG),
                secret_env_keys=list(_ALL_SECRET_KEYS),
            ),
            user,
        )
        row = await db_session.get(McpServer, created.id)
        assert row is not None

        env = svc.decrypt_server_env(row)

        assert env == _SECRET_ENV  # 非 secret 明文 ∪ 解密出的 secret，逐值一致

    async def test_create_without_secrets_keeps_encrypted_env_none(
        self, db_session: AsyncSession
    ) -> None:
        user = await _create_user(db_session, label="a")
        svc = McpRegistryService(db_session)

        created = await svc.create_server(_payload(name="plain-srv"), user)

        row = await db_session.get(McpServer, created.id)
        assert row is not None
        assert row.encrypted_env is None
        assert svc.decrypt_server_env(row) == {"CACHE_DIR": "/tmp"}

    async def test_update_replaces_and_reencrypts_secret_env(
        self, db_session: AsyncSession
    ) -> None:
        user = await _create_user(db_session, label="a")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(
            _payload(
                name="rekey",
                server_config={"command": "npx", "args": [], "env": {"API_KEY": "old-key"}},
                secret_env_keys=["API_KEY"],
            ),
            user,
        )
        row = await db_session.get(McpServer, created.id)
        assert row is not None
        assert row.encrypted_env is not None
        old_ct = row.encrypted_env["API_KEY"]["ct"]

        await svc.update_server(
            created.id,
            McpServerUpdate(
                server_config={"command": "npx", "args": [], "env": {"API_KEY": "new-key"}},
                secret_env_keys=["API_KEY"],
            ),
            user,
        )

        assert row.encrypted_env is not None
        assert set(row.encrypted_env) == {"API_KEY"}
        assert row.encrypted_env["API_KEY"]["ct"] != old_ct  # 密文已换
        assert svc.decrypt_server_env(row) == {"API_KEY": "new-key"}

    async def test_update_replacing_config_with_no_secrets_clears_encrypted_env(
        self, db_session: AsyncSession
    ) -> None:
        user = await _create_user(db_session, label="a")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(
            _payload(
                name="clear-sec",
                server_config={"command": "npx", "args": [], "env": {"API_KEY": "to-be-dropped"}},
                secret_env_keys=["API_KEY"],
            ),
            user,
        )

        await svc.update_server(
            created.id,
            McpServerUpdate(server_config={"command": "npx", "args": [], "env": {"N": "1"}}),
            user,
        )

        row = await db_session.get(McpServer, created.id)
        assert row is not None
        assert row.encrypted_env is None  # 整份替换语义：新配置无 secret → 清空

    async def test_update_without_server_config_keeps_ciphertext(
        self, db_session: AsyncSession
    ) -> None:
        user = await _create_user(db_session, label="a")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(
            _payload(
                name="keep-sec",
                server_config={"command": "npx", "args": [], "env": {"API_KEY": "stable"}},
                secret_env_keys=["API_KEY"],
            ),
            user,
        )
        row = await db_session.get(McpServer, created.id)
        assert row is not None
        frozen = json.dumps(row.encrypted_env, sort_keys=True)

        await svc.update_server(created.id, McpServerUpdate(note="metadata only"), user)

        assert json.dumps(row.encrypted_env, sort_keys=True) == frozen  # 密文一字节不动
        assert svc.decrypt_server_env(row) == {"API_KEY": "stable"}

    async def test_decrypt_key_mismatch_propagates(self, db_session: AsyncSession) -> None:
        """key 轮换失配：CipherKeyMismatch 原样上抛，不在 service 层吞错（task-04 降级）。"""
        user = await _create_user(db_session, label="a")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(
            _payload(
                name="stale-key",
                server_config={"command": "npx", "args": [], "env": {"API_KEY": "v1-value"}},
                secret_env_keys=["API_KEY"],
            ),
            user,
        )
        row = await db_session.get(McpServer, created.id)
        assert row is not None

        stale_service = McpRegistryService(
            db_session, cipher=CredentialCipher(bytes.fromhex("bb" * 32), "v2")
        )
        with pytest.raises(CipherKeyMismatch):
            stale_service.decrypt_server_env(row)

    async def test_non_str_secret_value_coerced_on_roundtrip(
        self, db_session: AsyncSession
    ) -> None:
        """secret 值非 str（如数字端口）→ str() 归一加密，解密回 str（文档化行为）。"""
        user = await _create_user(db_session, label="a")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(
            _payload(
                name="num-secret",
                server_config={"command": "npx", "args": [], "env": {"PORT_TOKEN": 8080}},
                secret_env_keys=["PORT_TOKEN"],
            ),
            user,
        )
        row = await db_session.get(McpServer, created.id)
        assert row is not None

        assert svc.decrypt_server_env(row) == {"PORT_TOKEN": "8080"}


# ── 写路径校验（D-005 stdio-only + design name 正则 + 同维度唯一）────────────


class TestWriteValidation:
    async def test_create_rejects_non_stdio_type(self, db_session: AsyncSession) -> None:
        user = await _create_user(db_session, label="a")
        svc = McpRegistryService(db_session)

        with pytest.raises(McpServerTypeInvalid) as exc_info:
            await svc.create_server(
                _payload(name="remote", server_config={"type": "http", "url": "https://x/mcp"}),
                user,
            )

        assert exc_info.value.http_status == 422
        assert await _all_servers(db_session) == []  # 未落库

    async def test_create_accepts_explicit_stdio_type(self, db_session: AsyncSession) -> None:
        user = await _create_user(db_session, label="a")
        svc = McpRegistryService(db_session)

        created = await svc.create_server(
            _payload(name="explicit", server_config={"type": "stdio", **_PLAIN_CONFIG}), user
        )

        assert created.server_type == "stdio"

    async def test_update_rejects_non_stdio_type(self, db_session: AsyncSession) -> None:
        user = await _create_user(db_session, label="a")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(_payload(name="u-stdio"), user)

        with pytest.raises(McpServerTypeInvalid):
            await svc.update_server(
                created.id,
                McpServerUpdate(server_config={"type": "sse", "url": "https://x/sse"}),
                user,
            )

    async def test_create_rejects_invalid_name(self, db_session: AsyncSession) -> None:
        """schema 层已有 pattern，此处验 service 级防御纵深（model_construct 逃逸 DTO 校验）。"""
        user = await _create_user(db_session, label="a")
        svc = McpRegistryService(db_session)

        for bad in ("Bad_Name", "-lead", "x", "a" * 101, "有名字"):
            inp = McpServerCreate.model_construct(name=bad, server_config=dict(_PLAIN_CONFIG))
            with pytest.raises(McpServerNameInvalid) as exc_info:
                await svc.create_server(inp, user)
            assert exc_info.value.http_status == 422

        assert await _all_servers(db_session) == []

    async def test_update_rejects_invalid_name(self, db_session: AsyncSession) -> None:
        user = await _create_user(db_session, label="a")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(_payload(name="valid-name"), user)

        bad_update = McpServerUpdate.model_construct(name="Also_Bad")
        with pytest.raises(McpServerNameInvalid):
            await svc.update_server(created.id, bad_update, user)

    async def test_same_dimension_name_conflict_409(self, db_session: AsyncSession) -> None:
        admin = await _create_user(db_session, label="adm", admin=True)
        user = await _create_user(db_session, label="u")
        svc = McpRegistryService(db_session)
        await svc.create_server(_payload(name="dup-name", scope="platform"), admin)

        with pytest.raises(McpServerNameConflict) as exc_info:
            await svc.create_server(_payload(name="dup-name", scope="platform"), admin)

        assert exc_info.value.http_status == 409
        # 同一用户位也互斥
        await svc.create_server(_payload(name="mine-dup"), user)
        with pytest.raises(McpServerNameConflict):
            await svc.create_server(_payload(name="mine-dup"), user)

    async def test_cross_dimension_same_name_allowed(self, db_session: AsyncSession) -> None:
        """平台位 vs 用户位 / 跨用户同名放行（COALESCE sentinel 唯一性语义）。"""
        admin = await _create_user(db_session, label="adm", admin=True)
        user_a = await _create_user(db_session, label="a")
        user_b = await _create_user(db_session, label="b")
        svc = McpRegistryService(db_session)

        await svc.create_server(_payload(name="shared-name", scope="platform"), admin)
        await svc.create_server(_payload(name="shared-name"), user_a)
        await svc.create_server(_payload(name="shared-name"), user_b)

        assert len(await _all_servers(db_session)) == 3

    async def test_rename_within_dimension_conflict_409(self, db_session: AsyncSession) -> None:
        user = await _create_user(db_session, label="u")
        svc = McpRegistryService(db_session)
        first = await svc.create_server(_payload(name="first-name"), user)
        second = await svc.create_server(_payload(name="second-name"), user)

        with pytest.raises(McpServerNameConflict):
            await svc.update_server(second.id, McpServerUpdate(name="first-name"), user)

        # 改回自身同名（no-op rename）不视为冲突
        unchanged = await svc.update_server(second.id, McpServerUpdate(name="second-name"), user)
        assert unchanged.name == "second-name"
        assert first.name == "first-name"


# ── 密钥指定态 + 编辑占位语义（ql-20260911-003-355a P0-2 / 用户自定义密钥类型）──


class TestSecretDesignation:
    async def test_marker_named_key_without_designation_stays_plaintext(
        self, db_session: AsyncSession
    ) -> None:
        """用户自定义密钥类型：未指定的键（哪怕键名含 token）按明文留存。"""
        user = await _create_user(db_session, label="d")
        svc = McpRegistryService(db_session)

        created = await svc.create_server(
            _payload(
                name="user-choice",
                server_config={
                    "command": "npx",
                    "args": [],
                    "env": {"API_TOKEN": "plain-by-choice"},
                },
            ),
            user,
        )

        row = await db_session.get(McpServer, created.id)
        assert row is not None
        assert row.encrypted_env is None  # 未指定 → 不加密
        assert row.server_config["env"]["API_TOKEN"] == "plain-by-choice"
        assert created.secret_env_keys == []

    async def test_create_rejects_unknown_secret_key(self, db_session: AsyncSession) -> None:
        user = await _create_user(db_session, label="d")
        svc = McpRegistryService(db_session)

        with pytest.raises(McpServerSecretEnvInvalid) as exc_info:
            await svc.create_server(
                _payload(
                    name="ghost-key",
                    server_config=dict(_PLAIN_CONFIG),
                    secret_env_keys=["NOT_IN_ENV"],
                ),
                user,
            )

        assert exc_info.value.http_status == 422
        assert await _all_servers(db_session) == []

    async def test_create_rejects_placeholder_value(self, db_session: AsyncSession) -> None:
        """创建不接受 <set> 占位符（无既有密文可保留——占位符只能是误回传）。"""
        user = await _create_user(db_session, label="d")
        svc = McpRegistryService(db_session)

        with pytest.raises(McpServerSecretEnvInvalid):
            await svc.create_server(
                _payload(
                    name="ph-create",
                    server_config={"command": "npx", "args": [], "env": {"API_KEY": "<set>"}},
                    secret_env_keys=["API_KEY"],
                ),
                user,
            )
        # 占位符在明文键上同样拒绝（创建路径全 env 拦截）
        with pytest.raises(McpServerSecretEnvInvalid):
            await svc.create_server(
                _payload(
                    name="ph-plain",
                    server_config={"command": "npx", "args": [], "env": {"CACHE_DIR": "<set>"}},
                ),
                user,
            )

    async def test_update_placeholder_keeps_existing_ciphertext(
        self, db_session: AsyncSession
    ) -> None:
        """P0-2 核心：编辑回传 <set> = 保留既有密文（原值不被覆盖毁坏）。"""
        user = await _create_user(db_session, label="d")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(
            _payload(
                name="ph-keep",
                server_config={
                    "command": "npx",
                    "args": [],
                    "env": {"API_KEY": "real-secret", "CACHE_DIR": "/tmp"},
                },
                secret_env_keys=["API_KEY"],
            ),
            user,
        )
        row = await db_session.get(McpServer, created.id)
        assert row is not None
        assert row.encrypted_env is not None
        frozen_ct = row.encrypted_env["API_KEY"]["ct"]

        updated = await svc.update_server(
            created.id,
            McpServerUpdate(
                name="ph-keep-renamed",  # 只改名——顺带全量回传占位形态 env
                server_config={
                    "command": "npx",
                    "args": [],
                    "env": {"API_KEY": "<set>", "CACHE_DIR": "/tmp"},
                },
                secret_env_keys=["API_KEY"],
            ),
            user,
        )

        assert updated.name == "ph-keep-renamed"
        assert updated.secret_env_keys == ["API_KEY"]
        assert row.encrypted_env is not None
        assert row.encrypted_env["API_KEY"]["ct"] == frozen_ct  # 密文未动
        assert svc.decrypt_server_env(row) == {"API_KEY": "real-secret", "CACHE_DIR": "/tmp"}

    async def test_update_placeholder_on_new_secret_key_rejected(
        self, db_session: AsyncSession
    ) -> None:
        user = await _create_user(db_session, label="d")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(
            _payload(
                name="ph-new",
                server_config={"command": "npx", "args": [], "env": {"API_KEY": "v1"}},
                secret_env_keys=["API_KEY"],
            ),
            user,
        )

        with pytest.raises(McpServerSecretEnvInvalid):
            await svc.update_server(
                created.id,
                McpServerUpdate(
                    server_config={
                        "command": "npx",
                        "args": [],
                        "env": {"API_KEY": "<set>", "NEW_TOKEN": "<set>"},
                    },
                    secret_env_keys=["API_KEY", "NEW_TOKEN"],
                ),
                user,
            )

    async def test_update_placeholder_on_plain_key_rejected(self, db_session: AsyncSession) -> None:
        user = await _create_user(db_session, label="d")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(
            _payload(
                name="ph-plainkey",
                server_config={"command": "npx", "args": [], "env": {"API_KEY": "v1"}},
                secret_env_keys=["API_KEY"],
            ),
            user,
        )

        # API_KEY 降级为明文（secret_env_keys=[] 显式表达）但值仍是占位符 → 422
        with pytest.raises(McpServerSecretEnvInvalid):
            await svc.update_server(
                created.id,
                McpServerUpdate(
                    server_config={"command": "npx", "args": [], "env": {"API_KEY": "<set>"}},
                    secret_env_keys=[],
                ),
                user,
            )

    async def test_update_secret_env_keys_alone_remodels(self, db_session: AsyncSession) -> None:
        """只改指定态（不动 server_config）：明文键升级加密、密钥键降级解密回明文。"""
        user = await _create_user(db_session, label="d")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(
            _payload(
                name="redesignate",
                server_config={
                    "command": "npx",
                    "args": [],
                    "env": {"API_KEY": "stays", "CACHE_DIR": "/tmp"},
                },
                secret_env_keys=["API_KEY"],
            ),
            user,
        )

        # 升级：CACHE_DIR 也设为密钥
        await svc.update_server(
            created.id, McpServerUpdate(secret_env_keys=["API_KEY", "CACHE_DIR"]), user
        )
        row = await db_session.get(McpServer, created.id)
        assert row is not None
        assert set(row.encrypted_env) == {"API_KEY", "CACHE_DIR"}
        assert row.server_config["env"] == {}

        # 降级：CACHE_DIR 回明文（解密回填）
        await svc.update_server(created.id, McpServerUpdate(secret_env_keys=["API_KEY"]), user)
        await db_session.refresh(row)
        assert set(row.encrypted_env) == {"API_KEY"}
        assert row.server_config["env"] == {"CACHE_DIR": "/tmp"}
        assert svc.decrypt_server_env(row) == {"API_KEY": "stays", "CACHE_DIR": "/tmp"}

    async def test_list_detail_echo_secret_env_keys(self, db_session: AsyncSession) -> None:
        """列表/详情回显密钥键名清单（前端回显指定态的唯一依据）。"""
        user = await _create_user(db_session, label="d")
        svc = McpRegistryService(db_session)
        created = await svc.create_server(
            _payload(
                name="echo-keys",
                server_config=dict(_SECRET_CONFIG),
                secret_env_keys=list(_ALL_SECRET_KEYS),
            ),
            user,
        )

        detail = await svc._to_detail(await db_session.get(McpServer, created.id), user)
        assert sorted(detail.secret_env_keys) == sorted(_ALL_SECRET_KEYS)
        listing = await svc.list_servers("mine", user)
        assert sorted(listing.items[0].secret_env_keys) == sorted(_ALL_SECRET_KEYS)
        # 密钥键不出现在 env 视图（值在密文列）
        assert set(listing.items[0].server_config["env"]) == {"CACHE_DIR"}
