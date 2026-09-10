"""``/api/mcp-servers*`` 13 端点 HTTP 契约测试。

Change: 2026-09-10-mcp-central-registry（task-03 / TDD 先行）

覆盖（task implementation/acceptance 逐项）:
- **路由顺序铁律**：静态段子路由（/import-json、/workspace-scan、
  /workspace-import-apply、/templates、/diagnostics）必须声明在 /{server_id}
  参数路由之前——结构断言（router.routes 声明序）+ 行为断言（GET templates
  不被 {server_id} 的 UUID 解析吞成 422）双保险；
- **openapi 契约**：app.openapi() 含 13 端点对应的全部 path/method；
- **权限矩阵**（design REST 端点注释）：未登录 401；平台库写（create
  scope=platform / 平台 server 更新删除 / platform 绑定解绑 / diagnostics /
  apply 平台导入）非 admin 403；我的库登录即可；跨用户私有 404 与不存在
  **同 code**（防存在性枚举）；
- **CRUD/binding 主路径**：创建（env 脱敏透传不拼装明文）→ 列表（scope/
  search/tag）→ 详情 → 更新 → 删除 → 404；user binding 加/解回环与绑定态注入。

未实现端点（importer/templates/render 归 task-08/09/10/04）只测权限门与
501 桩行为，业务用例留给对应 task。错误断言用真实 HTTP 状态码
（skills/tests/test_router.py 同惯例），不断 service 内部异常类型。
"""

from __future__ import annotations

import uuid
from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token
from app.modules.auth.model import User

# 根 conftest db_engine 的显式模型注册清单不含 mcp_registry（本卡 allowed_paths
# 不覆盖 backend/conftest.py，清单补录归后续收尾 task）——collection 期 import
# 注册到 BaseModel.metadata，与 test_service.py 经 service import 等价，
# 保证本模块所有 db_engine fixture 的 create_all 含三张 registry 表。
from app.modules.mcp_registry import model  # noqa: F401  (metadata registration)

BASE = "/api/mcp-servers"

# 静态段路径（路由顺序铁律的受保护集合——必须先于 /{server_id} 声明）。
_STATIC_PATHS = (
    "/mcp-servers/import-json",
    "/mcp-servers/workspace-scan",
    "/mcp-servers/workspace-import-apply",
    "/mcp-servers/templates",
    "/mcp-servers/diagnostics",
)

# 13 端点对应的 (method, path) 全集（含解绑的可选尾段形态）。
_EXPECTED_OPERATIONS = {
    ("GET", "/api/mcp-servers"),
    ("POST", "/api/mcp-servers"),
    ("GET", "/api/mcp-servers/{server_id}"),
    ("PATCH", "/api/mcp-servers/{server_id}"),
    ("DELETE", "/api/mcp-servers/{server_id}"),
    ("POST", "/api/mcp-servers/{server_id}/bindings"),
    ("DELETE", "/api/mcp-servers/{server_id}/bindings/{scope_type}"),
    ("DELETE", "/api/mcp-servers/{server_id}/bindings/{scope_type}/{scope_ref}"),
    ("POST", "/api/mcp-servers/import-json"),
    ("POST", "/api/mcp-servers/workspace-scan"),
    ("POST", "/api/mcp-servers/workspace-import-apply"),
    ("GET", "/api/mcp-servers/templates"),
    ("POST", "/api/mcp-servers/templates"),
    ("GET", "/api/mcp-servers/diagnostics"),
}


# ── Helpers（skills/tests/test_router.py 同惯例）──────────────────────────────


async def _make_user(session: AsyncSession, *, admin: bool, label: str = "") -> tuple[User, str]:
    """插入真实 User 行并直签 access token（不走登录链，省 bcrypt 开销）。"""
    uid = uuid.uuid4()
    user = User(
        id=uid,
        email=f"mcp-rt-{uid.hex[:8]}-{label}@example.com",
        username=f"mcp-rt-{uid.hex[:8]}",
        password_hash="irrelevant",  # token 直签，不校验口令
        status="active",
        is_platform_admin=admin,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return user, token


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


def _payload(name: str = "fetch", scope: str = "mine") -> dict[str, Any]:
    return {
        "name": name,
        "server_config": {
            "command": "uvx",
            "args": ["mcp-server-fetch"],
            "env": {"GITHUB_TOKEN": "ghp-plainsecret", "CACHE_DIR": "/tmp"},
        },
        "scope": scope,
    }


async def _create(
    client: AsyncClient, token: str, *, name: str = "fetch", scope: str = "mine"
) -> dict[str, Any]:
    """用给定 token POST 创建 server，断言 201 并返回 detail JSON。"""
    resp = await client.post(BASE, json=_payload(name, scope), headers=_headers(token))
    assert resp.status_code == 201, resp.text
    return resp.json()


# ── 路由顺序 + openapi 契约（acceptance 第 1 条）─────────────────────────────


class TestRouteOrderAndContract:
    def test_static_routes_declared_before_server_id_routes(self) -> None:
        """静态段（templates/diagnostics/导入三入口）声明序必须先于 /{server_id}。

        FastAPI 按声明序匹配——若 /{server_id} 在前，GET /mcp-servers/templates
        会先命中参数路由并把 "templates" 当 UUID 解析失败吞成 422。
        """
        from app.modules.mcp_registry.router import router as mcp_router

        paths = [route.path for route in mcp_router.routes]
        first_param_index = next(i for i, p in enumerate(paths) if "{server_id}" in p)
        for static_path in _STATIC_PATHS:
            assert static_path in paths, f"缺少静态段路由：{static_path}"
            assert paths.index(static_path) < first_param_index, (
                f"静态段 {static_path} 声明在 /{{server_id}} 之后，会被参数路由遮蔽"
            )

    def test_openapi_contains_all_13_endpoint_operations(self) -> None:
        """openapi.json 含全部 13 端点对应的 (method, path)。"""
        from app.main import app

        spec = app.openapi()
        operations = {
            (method.lower(), path) for path, item in spec["paths"].items() for method in item
        }
        expected = {(method.lower(), path) for method, path in _EXPECTED_OPERATIONS}
        missing = expected - operations
        assert not missing, f"openapi 缺少端点：{sorted(missing)}"

    async def test_get_templates_not_shadowed_by_server_id_route(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """行为级防遮蔽：GET templates 绝不能是 422（UUID 解析失败=被 {id} 吞）。

        当前为 501 桩（templates 归 task-10，落地后 200）；401=鉴权未过，
        422=路由被 /{server_id} 遮蔽——两者都判失败。
        """
        _, token = await _make_user(db_session, admin=False, label="tpl")
        resp = await client.get(f"{BASE}/templates", headers=_headers(token))
        assert resp.status_code not in (401, 422), resp.text


# ── 权限矩阵（design REST 端点注释 + acceptance 第 2 条）────────────────────


class TestPermissionMatrix:
    async def test_unauthenticated_list_401(self, client: AsyncClient) -> None:
        resp = await client.get(BASE)
        assert resp.status_code == 401

    async def test_platform_create_requires_admin(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """非 admin 创建 scope=platform → 403；admin → 201（service 层同权限点）。"""
        _, plain_token = await _make_user(db_session, admin=False, label="plain")
        _, admin_token = await _make_user(db_session, admin=True, label="adm")

        denied = await client.post(
            BASE, json=_payload("plat-fetch", scope="platform"), headers=_headers(plain_token)
        )
        assert denied.status_code == 403, denied.text

        allowed = await client.post(
            BASE, json=_payload("plat-fetch", scope="platform"), headers=_headers(admin_token)
        )
        assert allowed.status_code == 201, allowed.text
        assert allowed.json()["owner_user_id"] is None  # 平台共享位

    async def test_mine_create_allowed_for_any_logged_in_user(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """我的库：登录即可建，owner=本人（D-001 双层可见性）。"""
        user, token = await _make_user(db_session, admin=False, label="mine")

        created = await _create(client, token, name="mine-fetch")

        assert created["owner_user_id"] == str(user.id)

    async def test_cross_user_private_read_404_same_code_as_missing(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """跨用户私有详情 404，且与完全不存在的 id 同错误码（防存在性枚举）。"""
        _, owner_token = await _make_user(db_session, admin=False, label="own")
        _, stranger_token = await _make_user(db_session, admin=False, label="str")
        created = await _create(client, owner_token, name="private-read")

        cross = await client.get(f"{BASE}/{created['id']}", headers=_headers(stranger_token))
        missing = await client.get(f"{BASE}/{uuid.uuid4()}", headers=_headers(stranger_token))

        assert cross.status_code == 404
        assert missing.status_code == 404
        assert cross.json()["code"] == missing.json()["code"]  # 同 code，枚举无差别

    async def test_cross_user_private_update_delete_404(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        _, owner_token = await _make_user(db_session, admin=False, label="own")
        _, stranger_token = await _make_user(db_session, admin=False, label="str")
        created = await _create(client, owner_token, name="private-write")

        patched = await client.patch(
            f"{BASE}/{created['id']}", json={"note": "hijack"}, headers=_headers(stranger_token)
        )
        deleted = await client.delete(f"{BASE}/{created['id']}", headers=_headers(stranger_token))

        assert patched.status_code == 404
        assert deleted.status_code == 404
        still = await client.get(f"{BASE}/{created['id']}", headers=_headers(owner_token))
        assert still.status_code == 200  # 数据未被改动
        assert still.json()["note"] == ""

    async def test_platform_update_delete_requires_admin(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        _, admin_token = await _make_user(db_session, admin=True, label="adm")
        _, plain_token = await _make_user(db_session, admin=False, label="plain")
        created = await _create(client, admin_token, name="plat-write", scope="platform")

        patched = await client.patch(
            f"{BASE}/{created['id']}", json={"note": "x"}, headers=_headers(plain_token)
        )
        deleted = await client.delete(f"{BASE}/{created['id']}", headers=_headers(plain_token))

        assert patched.status_code == 403
        assert deleted.status_code == 403

    async def test_platform_binding_add_requires_admin(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        _, admin_token = await _make_user(db_session, admin=True, label="adm")
        _, plain_token = await _make_user(db_session, admin=False, label="plain")
        created = await _create(client, admin_token, name="plat-bind", scope="platform")

        denied = await client.post(
            f"{BASE}/{created['id']}/bindings",
            json={"scope_type": "platform"},
            headers=_headers(plain_token),
        )
        assert denied.status_code == 403, denied.text

        allowed = await client.post(
            f"{BASE}/{created['id']}/bindings",
            json={"scope_type": "platform"},
            headers=_headers(admin_token),
        )
        assert allowed.status_code == 204, allowed.text

    async def test_platform_binding_remove_requires_admin(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        _, admin_token = await _make_user(db_session, admin=True, label="adm")
        _, plain_token = await _make_user(db_session, admin=False, label="plain")
        created = await _create(client, admin_token, name="plat-unbind", scope="platform")
        assert (
            await client.post(
                f"{BASE}/{created['id']}/bindings",
                json={"scope_type": "platform"},
                headers=_headers(admin_token),
            )
        ).status_code == 204

        denied = await client.delete(
            f"{BASE}/{created['id']}/bindings/platform", headers=_headers(plain_token)
        )
        assert denied.status_code == 403, denied.text

        allowed = await client.delete(
            f"{BASE}/{created['id']}/bindings/platform", headers=_headers(admin_token)
        )
        assert allowed.status_code == 204, allowed.text

    async def test_diagnostics_requires_settings_admin(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """诊断是平台全局视图（读全平台绑定态与 workspace 文件）→ SETTINGS_ADMIN。

        admin 侧当前到 501 桩（precheck_diagnostics 归 task-04，落地后 200），
        只断言过了权限门（非 403）。
        """
        _, plain_token = await _make_user(db_session, admin=False, label="plain")
        _, admin_token = await _make_user(db_session, admin=True, label="adm")

        denied = await client.get(f"{BASE}/diagnostics", headers=_headers(plain_token))
        assert denied.status_code == 403, denied.text

        passed_gate = await client.get(f"{BASE}/diagnostics", headers=_headers(admin_token))
        assert passed_gate.status_code != 403, passed_gate.text

    async def test_import_json_platform_scope_admin_gate_before_stub(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """import-json 的平台库 admin 门先于 501 桩生效（router 层收敛，不依赖 importer）。

        scope=mine 不设门 → 直达 501 桩（importer 归 task-08）。
        """
        _, plain_token = await _make_user(db_session, admin=False, label="plain")

        denied = await client.post(
            f"{BASE}/import-json",
            json={"json_text": "{}", "scope": "platform"},
            headers=_headers(plain_token),
        )
        assert denied.status_code == 403, denied.text

        stub = await client.post(
            f"{BASE}/import-json",
            json={"json_text": "{}", "scope": "mine"},
            headers=_headers(plain_token),
        )
        assert stub.status_code == 501, stub.text

    async def test_workspace_import_apply_platform_scope_admin_gate(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        _, plain_token = await _make_user(db_session, admin=False, label="plain")

        denied = await client.post(
            f"{BASE}/workspace-import-apply",
            json={"candidates": [], "scope": "platform"},
            headers=_headers(plain_token),
        )
        assert denied.status_code == 403, denied.text


# ── CRUD / binding 主路径（acceptance 第 3 条：脱敏由 DTO 与 service 保证）────


class TestCrudHappyPath:
    async def test_create_list_detail_update_delete_roundtrip(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        _, admin_token = await _make_user(db_session, admin=True, label="adm")

        # 创建：201 + secret 键整体抽离（service 存量 server_config.env 本就无
        # secret 键——比脱敏更强；明文 secret 绝不出现在响应）
        created = await _create(client, admin_token, name="plat-roundtrip", scope="platform")
        assert created["server_config"]["env"] == {"CACHE_DIR": "/tmp"}
        assert "ghp-plainsecret" not in str(created)
        assert created["encrypted_env"]["GITHUB_TOKEN"]["ct"] == "<set>"

        # 列表：?scope=platform 命中
        listed = await client.get(f"{BASE}?scope=platform", headers=_headers(admin_token))
        assert listed.status_code == 200, listed.text
        names = [item["name"] for item in listed.json()["items"]]
        assert "plat-roundtrip" in names

        # 详情：200 + encrypted_env ct 遮蔽（key_id 保留）
        detail = await client.get(f"{BASE}/{created['id']}", headers=_headers(admin_token))
        assert detail.status_code == 200, detail.text
        assert detail.json()["encrypted_env"]["GITHUB_TOKEN"]["ct"] == "<set>"

        # 更新：PATCH note/enabled
        patched = await client.patch(
            f"{BASE}/{created['id']}",
            json={"note": "updated-note", "enabled": False},
            headers=_headers(admin_token),
        )
        assert patched.status_code == 200, patched.text
        assert patched.json()["note"] == "updated-note"
        assert patched.json()["enabled"] is False

        # 删除：204 → 再读 404
        deleted = await client.delete(f"{BASE}/{created['id']}", headers=_headers(admin_token))
        assert deleted.status_code == 204
        gone = await client.get(f"{BASE}/{created['id']}", headers=_headers(admin_token))
        assert gone.status_code == 404

    async def test_list_search_and_tag_filters(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        _, token = await _make_user(db_session, admin=False, label="flt")
        first = await _create(client, token, name="searchable-one")
        await _create(client, token, name="plain-two")

        await client.patch(f"{BASE}/{first['id']}", json={"tags": ["net"]}, headers=_headers(token))

        by_tag = await client.get(f"{BASE}?scope=mine&tag=net", headers=_headers(token))
        assert [i["name"] for i in by_tag.json()["items"]] == ["searchable-one"]

        by_search = await client.get(
            f"{BASE}?scope=mine&search=searchable", headers=_headers(token)
        )
        assert [i["name"] for i in by_search.json()["items"]] == ["searchable-one"]

    async def test_user_binding_add_remove_roundtrip(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """我的库 server 的 user binding 加/解回环 + 列表绑定态注入。"""
        user, token = await _make_user(db_session, admin=False, label="bind")
        created = await _create(client, token, name="mine-bound")

        added = await client.post(
            f"{BASE}/{created['id']}/bindings",
            json={"scope_type": "user"},
            headers=_headers(token),
        )
        assert added.status_code == 204, added.text

        listed = await client.get(f"{BASE}?scope=mine", headers=_headers(token))
        item = next(i for i in listed.json()["items"] if i["id"] == created["id"])
        assert item["user_bound"] is True

        removed = await client.delete(
            f"{BASE}/{created['id']}/bindings/user/{user.id}", headers=_headers(token)
        )
        assert removed.status_code == 204, removed.text

        listed_after = await client.get(f"{BASE}?scope=mine", headers=_headers(token))
        item_after = next(i for i in listed_after.json()["items"] if i["id"] == created["id"])
        assert item_after["user_bound"] is False

    async def test_remove_binding_without_scope_ref_returns_422_for_user_scope(
        self, client: AsyncClient, db_session: AsyncSession
    ) -> None:
        """design ``/bindings/{scope_type}`` 无尾段形态：user 解绑缺 scope_ref → 422。"""
        _, token = await _make_user(db_session, admin=False, label="noref")
        created = await _create(client, token, name="mine-noref")

        resp = await client.delete(f"{BASE}/{created['id']}/bindings/user", headers=_headers(token))
        assert resp.status_code == 422, resp.text
        assert resp.json()["code"] == "HTTP_422_MCP_BINDING_SCOPE_INVALID"
