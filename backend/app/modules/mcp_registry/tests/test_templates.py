"""templates 模块单测：预置 seed 幂等、双形态存为模板、secret 丢弃、可见性隔离。

Change: 2026-09-10-mcp-central-registry（task-10 / TDD 先行）

覆盖（task implementation/acceptance 逐项）:
- 预置 seed（惰性幂等）：空库首调 ``list_templates`` 返回 5-7 个预置（本实现
  6 个定稿清单）；二次调用不重复写行；``save_template`` 不触发 seed（仅 list
  首调惰性 bootstrap，不动 main.py 启动链）；删除单个预置行后不再复活（库内
  仍有 is_preset 行 → 整体跳过 bootstrap）；
- 双形态创建（schema ``_enforce_dual_form``）：from_server_id（从既有 server 只
  复制 server_config 明文，encrypted_env 不跟随）与直传 server_config 二选一，
  双填/双空在 DTO 构造期即 422；直传路径 stdio-only（非 stdio 422）与 name
  合法性（422，model_construct 逃逸 DTO pattern）service 级防御纵深；
- secret 丢弃（模板明文无 secret 铁律）：从带 secret 的 server 存模板后模板
  行无 secret 明文、无密文残留（全行 JSON dump 断言）；直传形态带 secret env
  键同样被剥除；丢弃发生时 log.warning（monkeypatch 模块级 log spy——structlog
  经 PrintLoggerFactory 直写 stderr，caplog 抓不到，test_session_readiness.py:336
  同坑同法）；
- 可见性：预置（owner NULL）全员可见；自存模板仅本人可见（他人与管理员列表
  均不出现——防枚举同语义，蓝图未授予 admin 跨用户查看权）；
- HTTP 链路冒烟：GET /templates 200（seed 经 router 惰性触发，task-03 的 501
  桩随本 task 落地自然转正）、POST 直传形态 201。

范式参考 ``tests/test_service.py``（真实 CredentialCipher 跑加密不 mock，conftest
已注入 SILLYSPEC_MASTER_KEY=v1:aa*32）；导入本模块即经 templates 注册 registry
表到 metadata（根 conftest db_engine 显式清单不含 mcp_registry，同 test_router
注释）。
"""

from __future__ import annotations

import json
import re
import uuid
from typing import Any
from unittest.mock import MagicMock

import pytest
from httpx import AsyncClient
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token
from app.modules.auth.model import User
from app.modules.mcp_registry.model import McpServer, McpTemplate
from app.modules.mcp_registry.schema import McpServerCreate, McpTemplateCreate
from app.modules.mcp_registry.service import (
    McpRegistryService,
    McpServerNameInvalid,
    McpServerNotFound,
    McpServerTypeInvalid,
)
from app.modules.mcp_registry.templates import (
    PRESET_TEMPLATES,
    list_templates,
    save_template,
)

BASE = "/api/mcp-servers"

# 蓝图定稿基线（design 数据模型节：fetch / context7 / playwright /
# sequentialthinking / memory 等 5-7 个，git 为第 6 个公知补充）。
_EXPECTED_PRESET_NAMES = {
    "fetch",
    "context7",
    "playwright",
    "sequentialthinking",
    "memory",
    "git",
}

_NAME_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{1,99}$")

# ── Helpers（test_service.py / test_router.py 同惯例）────────────────────────


_PLAIN_CONFIG = {"command": "uvx", "args": ["mcp-server-fetch"], "env": {"CACHE_DIR": "/tmp"}}

_SECRET_CONFIG = {
    "command": "npx",
    "args": ["-y", "server"],
    "env": {
        "GITHUB_TOKEN": "ghp_plainsecret",  # token 标记
        "API_KEY": "sk-plain-1234",  # key 标记
        "CACHE_DIR": "/tmp",  # 非 secret 明文留存
    },
}


async def _create_user(db_session: AsyncSession, *, label: str = "", admin: bool = False) -> User:
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=f"mcp-tpl-{uid.hex[:8]}-{label}@example.com",
        username=f"mcp-tpl-{uid.hex[:8]}",
        password_hash="irrelevant",
        status="active",
        is_platform_admin=admin,
    )
    db_session.add(user)
    await db_session.commit()
    return user


async def _make_token_user(
    db_session: AsyncSession, *, admin: bool, label: str
) -> tuple[User, str]:
    """插入真实 User 行并直签 access token（HTTP 冒烟用，test_router 同惯例）。"""
    user = await _create_user(db_session, label=label, admin=admin)
    await db_session.refresh(user)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return user, token


async def _template_rows(db_session: AsyncSession) -> list[McpTemplate]:
    return list((await db_session.execute(select(McpTemplate))).scalars().all())


async def _create_server(
    db_session: AsyncSession, user: User, *, name: str, server_config: dict[str, Any], scope: str
) -> McpServer:
    """经 service 创建 server（secret 抽列加密链路与生产一致，不绕行 ORM）。"""
    detail = await McpRegistryService(db_session).create_server(
        McpServerCreate(name=name, server_config=server_config, scope=scope), user
    )
    row = await db_session.get(McpServer, detail.id)
    assert row is not None
    return row


# ── 预置 seed（惰性幂等：首调插入 / 二次不重写 / 删后不复活）──────────────────


class TestPresetSeed:
    async def test_first_call_seeds_blueprint_presets(self, db_session: AsyncSession) -> None:
        user = await _create_user(db_session, label="seed1")

        listing = await list_templates(db_session, user)

        preset_names = {i.name for i in listing.items if i.is_preset}
        assert preset_names == _EXPECTED_PRESET_NAMES  # 蓝图定稿清单逐名对齐
        assert 5 <= len(preset_names) <= 7  # acceptance：5-7 个
        for item in listing.items:
            if item.is_preset:
                assert item.owner_user_id is None  # 平台预置位
                assert isinstance(item.server_config.get("command"), str)  # 可用形态
                assert item.server_config.get("args") is not None

    async def test_second_call_does_not_duplicate(self, db_session: AsyncSession) -> None:
        user = await _create_user(db_session, label="seed2")

        first = await list_templates(db_session, user)
        second = await list_templates(db_session, user)

        rows = await _template_rows(db_session)
        assert len(rows) == len(first.items)  # 二次调用零新写行
        assert len(second.items) == len(first.items)
        names = [r.name for r in rows]
        assert len(names) == len(set(names))  # 无重复名

    async def test_save_template_does_not_trigger_seed(self, db_session: AsyncSession) -> None:
        """惰性 bootstrap 仅挂 list_templates 首调——save 不 seed。"""
        user = await _create_user(db_session, label="seed3")

        await save_template(
            db_session,
            McpTemplateCreate(name="my-tpl", server_config=dict(_PLAIN_CONFIG)),
            user,
        )

        assert await _template_rows(db_session) != []  # 自存行在
        assert all(not r.is_preset for r in await _template_rows(db_session))  # 无 seed 行

    async def test_deleted_preset_not_resurrected(self, db_session: AsyncSession) -> None:
        """删除单个预置行后，后续调用不复活它（库内仍有 is_preset 行 → 跳过 bootstrap）。"""
        user = await _create_user(db_session, label="seed4")
        await list_templates(db_session, user)
        victim = next(r for r in await _template_rows(db_session) if r.name == "memory")
        await db_session.delete(victim)
        await db_session.commit()

        listing = await list_templates(db_session, user)

        names = {i.name for i in listing.items}
        assert "memory" not in names  # 删后不复活
        assert names == _EXPECTED_PRESET_NAMES - {"memory"}
        rows = await _template_rows(db_session)
        assert len(rows) == len(_EXPECTED_PRESET_NAMES) - 1

    async def test_preset_constant_shape(self) -> None:
        """常量自检：name 合法、全部 stdio 形态、env 无 secret 键（公知命令定稿）。"""
        assert 5 <= len(PRESET_TEMPLATES) <= 7
        for entry in PRESET_TEMPLATES:
            name = entry["name"]
            config = entry["server_config"]
            assert _NAME_PATTERN.match(name), f"预置名非法：{name!r}"
            assert isinstance(config.get("command"), str) and config["command"]
            assert isinstance(config.get("args"), list)
            assert config.get("type", "stdio") == "stdio"  # D-005
            for env_key in config.get("env") or {}:
                lowered = str(env_key).lower()
                assert not any(m in lowered for m in ("token", "key", "secret", "password")), (
                    f"预置 env 含 secret 形键：{env_key!r}"
                )


# ── 双形态创建（from_server_id | server_config 二选一）────────────────────────


class TestDualFormCreate:
    async def test_from_server_id_copies_plain_config(self, db_session: AsyncSession) -> None:
        user = await _create_user(db_session, label="f1")
        server = await _create_server(
            db_session, user, name="plain-srv", server_config=dict(_PLAIN_CONFIG), scope="mine"
        )

        saved = await save_template(
            db_session, McpTemplateCreate(name="from-server", from_server_id=server.id), user
        )

        assert saved.is_preset is False
        assert saved.owner_user_id == user.id
        assert saved.server_config == _PLAIN_CONFIG  # 明文配置逐键复制
        assert set(saved.server_config) == {"command", "args", "env"}

    async def test_from_platform_server_ok_for_any_user(self, db_session: AsyncSession) -> None:
        """平台共享 server 全员可读 → 任意登录用户可存为模板（读路径，非平台库写）。"""
        admin = await _create_user(db_session, label="adm", admin=True)
        plain = await _create_user(db_session, label="p")
        server = await _create_server(
            db_session, admin, name="plat-srv", server_config=dict(_PLAIN_CONFIG), scope="platform"
        )

        saved = await save_template(
            db_session, McpTemplateCreate(name="from-plat", from_server_id=server.id), plain
        )

        assert saved.owner_user_id == plain.id  # 模板归存的人，不归 server owner

    async def test_from_foreign_private_server_404(self, db_session: AsyncSession) -> None:
        """跨用户私有 server 存模板 → 404（与不存在同错误码，防存在性枚举）；admin 放行。"""
        owner = await _create_user(db_session, label="own")
        stranger = await _create_user(db_session, label="str")
        admin = await _create_user(db_session, label="adm", admin=True)
        server = await _create_server(
            db_session, owner, name="private-srv", server_config=dict(_PLAIN_CONFIG), scope="mine"
        )
        payload = McpTemplateCreate(name="hijack", from_server_id=server.id)

        with pytest.raises(McpServerNotFound) as exc_info:
            await save_template(db_session, payload, stranger)
        assert exc_info.value.http_status == 404
        with pytest.raises(McpServerNotFound):  # 完全不存在的 id 同错误码
            await save_template(
                db_session, McpTemplateCreate(name="ghost", from_server_id=uuid.uuid4()), stranger
            )

        by_admin = await save_template(
            db_session, McpTemplateCreate(name="by-admin", from_server_id=server.id), admin
        )
        assert by_admin.owner_user_id == admin.id

    async def test_direct_server_config_creates(self, db_session: AsyncSession) -> None:
        user = await _create_user(db_session, label="d1")

        saved = await save_template(
            db_session,
            McpTemplateCreate(name="direct-tpl", server_config=dict(_PLAIN_CONFIG)),
            user,
        )

        assert saved.name == "direct-tpl"
        assert saved.server_config == _PLAIN_CONFIG
        assert saved.is_preset is False
        row = await db_session.get(McpTemplate, saved.id)
        assert row is not None
        assert row.owner_user_id == user.id

    async def test_schema_rejects_both_forms(self) -> None:
        with pytest.raises(ValidationError):
            McpTemplateCreate(
                name="both",
                from_server_id=uuid.uuid4(),
                server_config=dict(_PLAIN_CONFIG),
            )

    async def test_schema_rejects_neither_form(self) -> None:
        with pytest.raises(ValidationError):
            McpTemplateCreate(name="neither")

    async def test_direct_rejects_non_stdio(self, db_session: AsyncSession) -> None:
        user = await _create_user(db_session, label="d2")

        with pytest.raises(McpServerTypeInvalid) as exc_info:
            await save_template(
                db_session,
                McpTemplateCreate(
                    name="remote-tpl",
                    server_config={"type": "http", "url": "https://x/mcp"},
                ),
                user,
            )
        assert exc_info.value.http_status == 422
        assert [r for r in await _template_rows(db_session) if not r.is_preset] == []

    async def test_direct_rejects_invalid_name(self, db_session: AsyncSession) -> None:
        """schema 层已有 pattern，此处验 service 级防御纵深（model_construct 逃逸）。"""
        user = await _create_user(db_session, label="d3")

        for bad in ("Bad_Name", "-lead", "x", "有名字"):
            payload = McpTemplateCreate.model_construct(name=bad, server_config=dict(_PLAIN_CONFIG))
            with pytest.raises(McpServerNameInvalid) as exc_info:
                await save_template(db_session, payload, user)
            assert exc_info.value.http_status == 422

        assert [r for r in await _template_rows(db_session) if not r.is_preset] == []


# ── secret 丢弃（模板明文无 secret：明文与密文都不进 mcp_templates）────────────


class TestSecretDropping:
    async def test_save_from_secret_server_drops_all_traces(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """从带 secret 的 server 存模板：行内无 secret 明文、无密文，且 log.warning。"""
        import app.modules.mcp_registry.templates as templates_mod

        log_spy = MagicMock()
        monkeypatch.setattr(templates_mod, "log", log_spy)

        user = await _create_user(db_session, label="s1")
        server = await _create_server(
            db_session, user, name="secret-srv", server_config=dict(_SECRET_CONFIG), scope="mine"
        )
        assert server.encrypted_env is not None  # 前置：server 侧确有密文信封
        ciphertexts = [env["ct"] for env in server.encrypted_env.values()]

        saved = await save_template(
            db_session, McpTemplateCreate(name="safe-tpl", from_server_id=server.id), user
        )

        assert saved.server_config["env"] == {"CACHE_DIR": "/tmp"}  # 只剩非 secret 明文
        row = await db_session.get(McpTemplate, saved.id)
        assert row is not None
        dumped = json.dumps(
            {"name": row.name, "config": row.server_config, "is_preset": row.is_preset},
            default=str,
        )
        for plaintext in ("ghp_plainsecret", "sk-plain-1234"):  # 明文不残留
            assert plaintext not in dumped
        for ct in ciphertexts:  # 密文不跟随（encrypted_env 不复制）
            assert ct not in dumped
        # 丢弃有痕：log.warning 携带被丢弃的 secret 键名（DTO 无标记字段，日志兜底）
        warn_events = log_spy.warning.call_args_list
        assert len(warn_events) == 1
        assert sorted(warn_events[0].kwargs.get("dropped_keys", [])) == ["API_KEY", "GITHUB_TOKEN"]

    async def test_direct_form_strips_secret_env_keys(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """直传形态带 secret env 键：同样剥除（任何路径不得把 secret 明文写入模板）。"""
        import app.modules.mcp_registry.templates as templates_mod

        log_spy = MagicMock()
        monkeypatch.setattr(templates_mod, "log", log_spy)

        user = await _create_user(db_session, label="s2")

        saved = await save_template(
            db_session,
            McpTemplateCreate(
                name="direct-secret-tpl", server_config=json.loads(json.dumps(_SECRET_CONFIG))
            ),
            user,
        )

        assert saved.server_config["env"] == {"CACHE_DIR": "/tmp"}
        dumped = json.dumps(saved.server_config, default=str)
        for plaintext in ("ghp_plainsecret", "sk-plain-1234"):
            assert plaintext not in dumped
        assert log_spy.warning.call_count == 1

    async def test_save_from_plain_server_no_warning(
        self, db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """无 secret 的 server 存模板：不告警（信号不虚报）。"""
        import app.modules.mcp_registry.templates as templates_mod

        log_spy = MagicMock()
        monkeypatch.setattr(templates_mod, "log", log_spy)

        user = await _create_user(db_session, label="s3")
        server = await _create_server(
            db_session, user, name="plain2", server_config=dict(_PLAIN_CONFIG), scope="mine"
        )

        await save_template(
            db_session, McpTemplateCreate(name="quiet-tpl", from_server_id=server.id), user
        )

        log_spy.warning.assert_not_called()


# ── 可见性（预置全员 + 自存仅本人）────────────────────────────────────────────


class TestVisibility:
    async def test_owner_sees_presets_plus_own(self, db_session: AsyncSession) -> None:
        user = await _create_user(db_session, label="v1")

        await save_template(
            db_session,
            McpTemplateCreate(name="own-tpl", server_config=dict(_PLAIN_CONFIG)),
            user,
        )
        listing = await list_templates(db_session, user)

        names = {i.name for i in listing.items}
        assert names >= _EXPECTED_PRESET_NAMES  # 预置对所有人可见
        assert "own-tpl" in names

    async def test_other_user_sees_only_presets(self, db_session: AsyncSession) -> None:
        """他人自存不出现（防枚举同语义）；管理员也无跨用户查看权（蓝图按字面）。"""
        owner = await _create_user(db_session, label="v2")
        stranger = await _create_user(db_session, label="v3")
        admin = await _create_user(db_session, label="v4", admin=True)

        await save_template(
            db_session,
            McpTemplateCreate(name="private-tpl", server_config=dict(_PLAIN_CONFIG)),
            owner,
        )

        for viewer in (stranger, admin):
            listing = await list_templates(db_session, viewer)
            names = {i.name for i in listing.items}
            assert names == _EXPECTED_PRESET_NAMES  # 仅预置，他人自存不可见
            assert all(i.owner_user_id is None for i in listing.items)


# ── HTTP 链路冒烟（task-03 桩转正：501 回退随模块落地自然失效）────────────────


class TestHttpWiring:
    async def test_get_templates_seeds_and_returns_200(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        _, token = await _make_token_user(db_session, admin=False, label="h1")

        resp = await client.get(f"{BASE}/templates", headers={"Authorization": f"Bearer {token}"})

        assert resp.status_code == 200, resp.text
        items = resp.json()["items"]
        assert {i["name"] for i in items if i["is_preset"]} == _EXPECTED_PRESET_NAMES

    async def test_post_direct_form_201(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        user, token = await _make_token_user(db_session, admin=False, label="h2")

        resp = await client.post(
            f"{BASE}/templates",
            json={"name": "http-tpl", "server_config": _PLAIN_CONFIG},
            headers={"Authorization": f"Bearer {token}"},
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["owner_user_id"] == str(user.id)
        assert body["is_preset"] is False
