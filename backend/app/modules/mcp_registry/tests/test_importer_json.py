"""import_from_json 单测：三包装解析、逐条容错、name 归一化、secret 加密落库、scope 两态。

Change: 2026-09-10-mcp-central-registry（task-08 / TDD 先行）

覆盖（task implementation/acceptance 逐项）:
- 三包装探测：mcpServers / servers / mcp 各一例导入成功；非法 JSON、顶层非
  dict、三键均未命中（含命中键值非 dict）→ ``McpImportPayloadInvalid`` 400；
- 逐条容错：非 dict 条目、非 stdio（D-005 http/sse）、缺 command、归一化后
  仍非法 name → skipped 带原因（``"<原始键>: <原因>"``）不中断整批；
- name 归一化：大写/下划线 → 小写连字符并计入 renamed；原名已合法不计 renamed；
- 同名 skip（幂等不改写）：既有同名 / 同批归一化撞名 / 再次导入同名同配置
  → 全 skip，既有资产一字节不动；
- secret 加密（经 service.create_server，importer 不碰 Cipher）：env secret 键
  落库后只存在于 encrypted_env，server_config.env 只剩非 secret 明文；元数据
  source=imported_json、dedup_key 留空（去重锚仅归 workspace 导入）；
- scope 两态：mine → owner=操作者；platform（admin）→ owner=NULL；platform
  非 admin → PermissionDenied 上抛（router 已落同权限门，service 纵深防御）。

范式参考 ``tests/test_service.py``（真实 CredentialCipher 跑加密不 mock，conftest
已注入 SILLYSPEC_MASTER_KEY=v1:aa*32）；导入本模块即经 service 注册 registry 表
到 metadata（根 conftest db_engine 显式清单不含 mcp_registry，同 test_router 注释）。
"""

from __future__ import annotations

import json
import uuid
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import PermissionDenied
from app.modules.auth.model import User
from app.modules.mcp_registry.importer import (
    McpImportPayloadInvalid,
    import_from_json,
)
from app.modules.mcp_registry.model import McpServer

# ── Helpers（test_service.py 同惯例）──────────────────────────────────────────


def _entry(command: str = "uvx") -> dict[str, Any]:
    """合法 stdio 条目（env 含一个非 secret 键）。"""
    return {"command": command, "args": ["mcp-server-fetch"], "env": {"CACHE_DIR": "/tmp"}}


async def _create_user(db_session: AsyncSession, *, label: str = "", admin: bool = False) -> User:
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=f"mcp-imp-{uid.hex[:8]}-{label}@example.com",
        username=f"mcp-imp-{uid.hex[:8]}",
        password_hash="irrelevant",
        status="active",
        is_platform_admin=admin,
    )
    db_session.add(user)
    await db_session.commit()
    return user


async def _rows(db_session: AsyncSession) -> list[McpServer]:
    return list((await db_session.execute(select(McpServer))).scalars().all())


async def _import(
    db_session: AsyncSession, server_map: dict[str, Any], scope: str, user: User
) -> Any:
    """把 server map 以最常见包装（mcpServers）导入（单测便捷封装）。"""
    return await import_from_json(db_session, json.dumps({"mcpServers": server_map}), scope, user)


# ── 三包装探测 + 400 契约 ──────────────────────────────────────────────────────


class TestWrapperDetection:
    async def test_mcpservers_wrapper_imports(self, db_session: AsyncSession) -> None:
        user = await _create_user(db_session, label="w1")

        result = await import_from_json(
            db_session, json.dumps({"mcpServers": {"fetch": _entry()}}), "mine", user
        )

        assert result.imported == ["fetch"]
        assert result.skipped == []
        assert result.renamed == []

    async def test_servers_wrapper_imports(self, db_session: AsyncSession) -> None:
        user = await _create_user(db_session, label="w2")

        result = await import_from_json(
            db_session, json.dumps({"servers": {"fetch": _entry()}}), "mine", user
        )

        assert result.imported == ["fetch"]

    async def test_mcp_key_wrapper_imports(self, db_session: AsyncSession) -> None:
        user = await _create_user(db_session, label="w3")

        result = await import_from_json(
            db_session, json.dumps({"mcp": {"fetch": _entry()}}), "mine", user
        )

        assert result.imported == ["fetch"]

    async def test_first_wrapper_key_wins(self, db_session: AsyncSession) -> None:
        """多包装键并存时按 mcpServers → servers → mcp 优先序取首个 dict 值。"""
        user = await _create_user(db_session, label="w4")

        result = await import_from_json(
            db_session,
            json.dumps(
                {"mcpServers": {"from-mcpservers": _entry()}, "servers": {"from-servers": _entry()}}
            ),
            "mine",
            user,
        )

        assert result.imported == ["from-mcpservers"]

    async def test_invalid_json_raises_400(self, db_session: AsyncSession) -> None:
        user = await _create_user(db_session, label="w5")

        with pytest.raises(McpImportPayloadInvalid) as exc_info:
            await import_from_json(db_session, "not-json{", "mine", user)

        assert exc_info.value.http_status == 400

    async def test_top_level_not_object_raises_400(self, db_session: AsyncSession) -> None:
        user = await _create_user(db_session, label="w6")

        with pytest.raises(McpImportPayloadInvalid):
            await import_from_json(db_session, "[]", "mine", user)

    async def test_no_wrapper_key_raises_400(self, db_session: AsyncSession) -> None:
        """三键均未命中 → 400 中文提示（task-08 卡：不视整体为 server map）。"""
        user = await _create_user(db_session, label="w7")

        with pytest.raises(McpImportPayloadInvalid):
            await import_from_json(db_session, "{}", "mine", user)

    async def test_wrapper_value_not_dict_raises_400(self, db_session: AsyncSession) -> None:
        """命中键但值非 dict（如 list）不算命中 → 400。"""
        user = await _create_user(db_session, label="w8")

        with pytest.raises(McpImportPayloadInvalid):
            await import_from_json(db_session, json.dumps({"mcpServers": []}), "mine", user)


# ── 逐条容错（坏条目进 skipped 不中断整批）────────────────────────────────────


class TestPerEntryTolerance:
    async def test_bad_entries_skip_without_breaking_batch(self, db_session: AsyncSession) -> None:
        """非 dict / 缺 command / 归一化后仍非法 name 各自进 skipped，好条目照常导入。"""
        user = await _create_user(db_session, label="t1")

        result = await _import(
            db_session,
            {
                "good-one": _entry(),
                "not-object": "just-a-string",  # 非 dict 条目
                "no-command": {"args": ["x"]},  # 缺 command
                "x": {"command": "uvx", "args": []},  # 归一化后长 1 仍非法
                "中文": {"command": "uvx", "args": []},  # 归一化后仅剩 "-" 非法
            },
            "mine",
            user,
        )

        assert result.imported == ["good-one"]
        assert len(result.skipped) == 4
        for item in result.skipped:  # 每条 skip 都带原因（"<原始键>: <原因>"）
            assert ": " in item
        assert [r.name for r in await _rows(db_session)] == ["good-one"]

    async def test_http_and_sse_entries_rejected(self, db_session: AsyncSession) -> None:
        """非 stdio 条目拒收（D-005），skip 原因明示仅支持 stdio。"""
        user = await _create_user(db_session, label="t2")

        result = await _import(
            db_session,
            {
                "remote-http": {"type": "http", "url": "https://x/mcp"},
                "remote-sse": {"type": "sse", "url": "https://x/sse"},
                "stdio-ok": _entry(),
            },
            "mine",
            user,
        )

        assert result.imported == ["stdio-ok"]
        assert len(result.skipped) == 2
        assert all("stdio" in item for item in result.skipped)
        assert [r.name for r in await _rows(db_session)] == ["stdio-ok"]

    async def test_explicit_stdio_entry_imports(self, db_session: AsyncSession) -> None:
        """显式 "type": "stdio" 视为缺省同型，正常导入。"""
        user = await _create_user(db_session, label="t3")

        result = await _import(
            db_session, {"explicit": {"type": "stdio", **_entry()}}, "mine", user
        )

        assert result.imported == ["explicit"]


# ── name 归一化（小写/连字符）与 renamed 统计 ──────────────────────────────────


class TestNameNormalization:
    async def test_uppercase_underscore_normalized_and_renamed(
        self, db_session: AsyncSession
    ) -> None:
        user = await _create_user(db_session, label="n1")

        result = await _import(db_session, {"Context7_Fetch": _entry()}, "mine", user)

        assert result.imported == ["context7-fetch"]
        assert result.renamed == ["context7-fetch"]
        assert [r.name for r in await _rows(db_session)] == ["context7-fetch"]

    async def test_valid_name_not_counted_as_renamed(self, db_session: AsyncSession) -> None:
        user = await _create_user(db_session, label="n2")

        result = await _import(db_session, {"fetch": _entry()}, "mine", user)

        assert result.imported == ["fetch"]
        assert result.renamed == []


# ── 同名冲突 skip（幂等不改写既有资产）────────────────────────────────────────


class TestDuplicateSkip:
    async def test_existing_same_name_skipped_without_overwrite(
        self, db_session: AsyncSession
    ) -> None:
        """同 scope 同名冲突（owner+name 唯一）skip，既有配置不被改写。"""
        user = await _create_user(db_session, label="d1")

        first = await _import(db_session, {"fetch": _entry(command="uvx")}, "mine", user)
        assert first.imported == ["fetch"]

        second = await _import(db_session, {"fetch": _entry(command="npx")}, "mine", user)

        assert second.imported == []
        assert len(second.skipped) == 1
        assert second.skipped[0].startswith("fetch:")
        rows = await _rows(db_session)
        assert len(rows) == 1
        assert rows[0].server_config["command"] == "uvx"  # 既有资产一字节不动

    async def test_same_batch_normalized_collision_skipped(self, db_session: AsyncSession) -> None:
        """同批多条归一化后撞名：首条导入，后续 skip。"""
        user = await _create_user(db_session, label="d2")

        result = await _import(db_session, {"Fetch": _entry(), "FETCH": _entry()}, "mine", user)

        assert result.imported == ["fetch"]
        assert len(result.skipped) == 1
        assert result.skipped[0].startswith("FETCH:")
        assert len(await _rows(db_session)) == 1

    async def test_reimport_same_json_idempotent(self, db_session: AsyncSession) -> None:
        """再次导入同名同配置全 skip（幂等，不新增不改写）。"""
        user = await _create_user(db_session, label="d3")
        payload = {"fetch": _entry(), "Context7_Fetch": _entry()}

        first = await _import(db_session, payload, "mine", user)
        second = await _import(db_session, payload, "mine", user)

        assert first.imported == ["fetch", "context7-fetch"]
        assert second.imported == []
        assert len(second.skipped) == 2
        assert second.renamed == []
        assert len(await _rows(db_session)) == 2

    async def test_cross_owner_same_name_allowed(self, db_session: AsyncSession) -> None:
        """唯一性按 owner 维度：不同用户各自导入同名互不冲突。"""
        user_a = await _create_user(db_session, label="da")
        user_b = await _create_user(db_session, label="db")

        result_a = await _import(db_session, {"fetch": _entry()}, "mine", user_a)
        result_b = await _import(db_session, {"fetch": _entry()}, "mine", user_b)

        assert result_a.imported == ["fetch"]
        assert result_b.imported == ["fetch"]
        assert result_b.skipped == []
        assert len(await _rows(db_session)) == 2


# ── secret 加密落库 + 元数据（经 service.create_server，importer 不碰 Cipher）──


class TestSecretAndMetadata:
    async def test_secret_keys_only_in_encrypted_env(self, db_session: AsyncSession) -> None:
        """env 明文整体放入 server_config，secret 键由 service 抽列加密——落库后
        server_config.env 只剩非 secret 明文，secret 只存在于 encrypted_env。"""
        user = await _create_user(db_session, label="s1")

        result = await _import(
            db_session,
            {
                "fetch": {
                    "command": "npx",
                    "args": ["-y", "server"],
                    "env": {"GITHUB_TOKEN": "ghp_plainsecret", "CACHE_DIR": "/tmp"},
                }
            },
            "mine",
            user,
        )

        assert result.imported == ["fetch"]
        row = (await _rows(db_session))[0]
        assert row.server_config["env"] == {"CACHE_DIR": "/tmp"}
        assert row.server_config["command"] == "npx"
        assert row.encrypted_env is not None
        assert set(row.encrypted_env) == {"GITHUB_TOKEN"}
        assert set(row.encrypted_env["GITHUB_TOKEN"]) == {"ct", "key_id"}
        dumped = json.dumps({"config": row.server_config, "enc": row.encrypted_env}, default=str)
        assert "ghp_plainsecret" not in dumped  # 全行序列化无明文 secret

    async def test_source_and_dedup_key_metadata(self, db_session: AsyncSession) -> None:
        """source=imported_json；dedup_key 留空（去重锚仅归 workspace 导入）。"""
        user = await _create_user(db_session, label="s2")

        await _import(db_session, {"fetch": _entry()}, "mine", user)

        row = (await _rows(db_session))[0]
        assert row.source == "imported_json"
        assert row.dedup_key is None

    async def test_secret_entry_skipped_for_name_conflict_keeps_no_plaintext(
        self, db_session: AsyncSession
    ) -> None:
        """撞名 skip 的 secret 条目不落库（不产生半行/明文残留）。"""
        user = await _create_user(db_session, label="s3")

        await _import(db_session, {"fetch": _entry()}, "mine", user)
        result = await _import(
            db_session,
            {"fetch": {"command": "npx", "args": [], "env": {"API_KEY": "sk-conflict"}}},
            "mine",
            user,
        )

        assert result.imported == []
        assert len(result.skipped) == 1
        rows = await _rows(db_session)
        assert len(rows) == 1
        assert rows[0].encrypted_env is None  # 既有行无 secret，未被动过


# ── scope 两态（owner 语义由 service.create_server 承载）──────────────────────


class TestScopeSemantics:
    async def test_scope_mine_sets_owner_to_operator(self, db_session: AsyncSession) -> None:
        user = await _create_user(db_session, label="m1")

        await _import(db_session, {"fetch": _entry()}, "mine", user)

        assert (await _rows(db_session))[0].owner_user_id == user.id

    async def test_scope_platform_by_admin_sets_owner_null(self, db_session: AsyncSession) -> None:
        admin = await _create_user(db_session, label="m2", admin=True)

        result = await _import(db_session, {"fetch": _entry()}, "platform", admin)

        assert result.imported == ["fetch"]
        assert (await _rows(db_session))[0].owner_user_id is None

    async def test_scope_platform_by_non_admin_denied(self, db_session: AsyncSession) -> None:
        """非 admin 直调 platform 导入 → service 权限门 403 上抛（纵深防御，
        router 已在端点侧落同权限门）。"""
        user = await _create_user(db_session, label="m3")

        with pytest.raises(PermissionDenied):
            await _import(db_session, {"fetch": _entry()}, "platform", user)

        assert await _rows(db_session) == []  # 无写入
