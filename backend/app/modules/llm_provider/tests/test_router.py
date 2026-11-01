"""task-05（change 2026-08-06-provider-switch-live-session / FR-07）router 层测试。

覆盖 ``POST /api/llm-providers/{id}/set-default`` 与 ``unset-default`` 两端点：
- 返回 ``SetDefaultResult`` 三字段（``switched`` 布尔 / ``affected_sessions`` 整数 /
  ``error`` 字符串或 null）；
- 鉴权（``get_current_user``）：未带 Bearer → 401；
- owner 过滤（D-008）：跨用户 set/unset → 403（service ``PermissionDenied``），
  不存在的 provider_id → 404（service ``LlmProviderNotFound``）；
- 凭证探测失败路径（task-03 D-003）：probe ``ok=False`` → ``switched=False`` +
  ``error`` 透传，DB ``is_default`` 不变。

HTTP 层测试范式参考 ``ppm/task/tests/test_router.py``（``client`` + ``auth_headers``）；
mock probe/notify 参考 ``test_llm_provider.py`` 的 ``mock_probe_notify`` 夹具（patch
源模块避免真实网络 / WS / SQLite 缺 ``agent_sessions`` 表的 JOIN 报错）。

不跑 ``gen:types``（归 task-09 统一）。
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.llm_provider.probe import ProviderProbeResult

# ── mock probe/notify 夹具（照 test_llm_provider.py 范式）─────────────────────


@pytest.fixture
def mock_probe_notify(monkeypatch: pytest.MonkeyPatch) -> None:
    """patch ``probe_provider`` / ``notify_provider_switch`` 避免真实网络 / WS。

    HTTP 层调 ``service.set_default`` / ``unset_default`` 会触发真实 probe（HTTP 网络）
    + ``notify_provider_switch``（DB JOIN ``agent_sessions`` / ``daemon_task_leases`` +
    WS 推送）。SQLite 测试库无 ``agent_sessions`` 表（notify JOIN 报 ``no such table``），
    且真实 probe 会 timeout/fail（probe 返 ``ok=False`` → set_default 回滚不置位）。

    patch 目标是源模块（``app.modules.llm_provider.probe.probe_provider``）而非
    ``service.probe_provider``：service 内 lazy ``from ...probe import probe_provider``
    在调用时按属性查找源模块当前绑定 → patch 源模块即生效（详见 test_llm_provider.py
    同名夹具注释）。
    """

    async def _fake_probe(*_args: object, **_kwargs: object) -> ProviderProbeResult:
        return ProviderProbeResult(ok=True)

    async def _fake_notify(*_args: object, **_kwargs: object) -> int:
        return 0

    monkeypatch.setattr("app.modules.llm_provider.probe.probe_provider", _fake_probe)
    monkeypatch.setattr(
        "app.modules.daemon.lease.provider_switch.notify_provider_switch", _fake_notify
    )


@pytest.fixture
def mock_probe_fail(monkeypatch: pytest.MonkeyPatch) -> None:
    """probe 返 ``ok=False`` + ``error`` → set_default 回滚不置位（D-003 凭证失败路径）。"""

    async def _fake_probe(*_args: object, **_kwargs: object) -> ProviderProbeResult:
        return ProviderProbeResult(ok=False, error="凭证无效：上游 401")

    async def _fake_notify(*_args: object, **_kwargs: object) -> int:
        return 0

    monkeypatch.setattr("app.modules.llm_provider.probe.probe_provider", _fake_probe)
    monkeypatch.setattr(
        "app.modules.daemon.lease.provider_switch.notify_provider_switch", _fake_notify
    )


# ── helpers ──────────────────────────────────────────────────────────────────


async def _create_other_user(db_session: AsyncSession, *, label: str = "other") -> uuid.UUID:
    """插一个非当前认证用户的 User 行（跨用户隔离测试用）。

    ``auth_headers`` 固定为 ``admin@example.com`` 平台管理员，本 helper 建另一个用户
    供 service 层 owner 过滤验证（provider 归 other，admin 访问 → 403）。
    """
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    db_session.add(
        User(
            id=uid,
            email=f"other-{uid.hex[:8]}-{label}@example.com",
            username=f"other-{uid.hex[:8]}",
            password_hash="irrelevant",
            display_name=f"Other {label}",
            status="active",
        )
    )
    await db_session.commit()
    return uid


async def _seed_provider_for_user(
    db_session: AsyncSession,
    user_id: uuid.UUID,
    *,
    name: str = "p",
    is_default: bool = False,
) -> uuid.UUID:
    """经 ``service.create`` 给指定 user 落一个真实加密 api_key 的 provider。

    用 service 而非直插 ORM —— 走真实加密落盘（与生产一致），set_default 解密才能拿到
    非空 api_key_plain 过 probe 缺凭证早返分支（service ``not api_key_plain``）。
    """
    from app.modules.llm_provider.schema import LlmProviderCreate
    from app.modules.llm_provider.service import LlmProviderService

    svc = LlmProviderService(db_session)
    row = await svc.create(
        user_id,
        LlmProviderCreate(
            name=name,
            api_key="sk-router-secretkey-1234",
            base_url="https://api.anthropic.com",
            models=[{"name": "claude-sonnet-4", "roles": ["sonnet"]}],
            is_default=is_default,
            agent_kinds=["claude"],
        ),
    )
    return row.id


def _create_body(*, name: str = "p-http", is_default: bool = False) -> dict:
    """HTTP POST /api/llm-providers 创建 body（admin owner，最小字段集）。"""
    return {
        "name": name,
        "agent_kinds": ["claude"],
        "api_key": "sk-http-secretkey-1234",
        "base_url": "https://api.anthropic.com",
        "model": "claude-sonnet-4",
        "is_default": is_default,
    }


# ── set-default 端点 ─────────────────────────────────────────────────────────


class TestSetDefaultEndpoint:
    """``POST /api/llm-providers/{id}/set-default`` → ``SetDefaultResult``。"""

    async def test_success_returns_three_fields(
        self,
        client: AsyncClient,
        auth_headers: dict,
        mock_probe_notify: None,
    ) -> None:
        """成功切换 → 200 + ``SetDefaultResult{switched:True, affected_sessions:0, error:None}``。

        provider 经 HTTP 创建（owner = admin 当前用户），set_default 走 mock probe ok=True
        与 mock notify 返 0（无 active session）。
        """
        create = await client.post(
            "/api/llm-providers", headers=auth_headers, json=_create_body(name="set-ok")
        )
        assert create.status_code == 201, create.text
        pid = create.json()["id"]

        resp = await client.post(f"/api/llm-providers/{pid}/set-default", headers=auth_headers)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        # 三字段契约（FR-07）
        assert set(body.keys()) >= {"switched", "affected_sessions", "error"}
        assert body["switched"] is True
        assert body["affected_sessions"] == 0
        assert body["error"] is None
        # 类型守护（acceptance：bool / int / str|null）
        assert isinstance(body["switched"], bool)
        assert isinstance(body["affected_sessions"], int)

    async def test_probe_fail_returns_switched_false(
        self,
        client: AsyncClient,
        auth_headers: dict,
        mock_probe_fail: None,
    ) -> None:
        """probe ok=False（D-003 凭证失败）→ ``switched:False`` + ``error`` 透传，不置位。

        service 不改 ``is_default``、不推送（原供应商继续服务运行中会话，G4 不破坏）。
        """
        create = await client.post(
            "/api/llm-providers", headers=auth_headers, json=_create_body(name="set-fail")
        )
        pid = create.json()["id"]

        resp = await client.post(f"/api/llm-providers/{pid}/set-default", headers=auth_headers)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["switched"] is False
        assert body["affected_sessions"] == 0
        assert body["error"] == "凭证无效：上游 401"

    async def test_requires_auth(self, client: AsyncClient) -> None:
        """未带 Bearer → 401（``get_current_user`` ``AuthTokenMissing``）。"""
        resp = await client.post(f"/api/llm-providers/{uuid.uuid4()}/set-default")
        assert resp.status_code == 401, resp.text

    async def test_nonexistent_returns_404(
        self,
        client: AsyncClient,
        auth_headers: dict,
        mock_probe_notify: None,
    ) -> None:
        """provider_id 不存在 → ``LlmProviderNotFound`` 404。"""
        resp = await client.post(
            f"/api/llm-providers/{uuid.uuid4()}/set-default", headers=auth_headers
        )
        assert resp.status_code == 404, resp.text

    async def test_other_users_provider_returns_403(
        self,
        client: AsyncClient,
        auth_headers: dict,
        db_session: AsyncSession,
        mock_probe_notify: None,
    ) -> None:
        """跨用户 set_default → ``PermissionDenied`` 403（D-008 owner 级不泄漏）。

        provider 归 other 用户，admin（``auth_headers``）访问被拒。403 而非 404：
        service ``get`` 先 SELECT 到行再比对 ``user_id``（存在但不属于你 → 403）。
        """
        other_uid = await _create_other_user(db_session, label="set-xuser")
        pid = await _seed_provider_for_user(db_session, other_uid, name="other-set")

        resp = await client.post(f"/api/llm-providers/{pid}/set-default", headers=auth_headers)

        assert resp.status_code == 403, resp.text


# ── unset-default 端点 ───────────────────────────────────────────────────────


class TestUnsetDefaultEndpoint:
    """``POST /api/llm-providers/{id}/unset-default`` → ``SetDefaultResult``。"""

    async def test_success_returns_three_fields(
        self,
        client: AsyncClient,
        auth_headers: dict,
        mock_probe_notify: None,
    ) -> None:
        """成功取消 → 200 + ``SetDefaultResult{switched:True, affected_sessions:0, error:None}``。

        unset 不探测（恒 ``switched=True``），走 mock notify 返 0。
        """
        create = await client.post(
            "/api/llm-providers",
            headers=auth_headers,
            json=_create_body(name="unset-ok", is_default=True),
        )
        assert create.status_code == 201, create.text
        pid = create.json()["id"]

        resp = await client.post(f"/api/llm-providers/{pid}/unset-default", headers=auth_headers)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert set(body.keys()) >= {"switched", "affected_sessions", "error"}
        assert body["switched"] is True
        assert body["affected_sessions"] == 0
        assert body["error"] is None
        assert isinstance(body["switched"], bool)
        assert isinstance(body["affected_sessions"], int)

    async def test_requires_auth(self, client: AsyncClient) -> None:
        """未带 Bearer → 401。"""
        resp = await client.post(f"/api/llm-providers/{uuid.uuid4()}/unset-default")
        assert resp.status_code == 401, resp.text

    async def test_nonexistent_returns_404(
        self,
        client: AsyncClient,
        auth_headers: dict,
        mock_probe_notify: None,
    ) -> None:
        """provider_id 不存在 → ``LlmProviderNotFound`` 404。"""
        resp = await client.post(
            f"/api/llm-providers/{uuid.uuid4()}/unset-default", headers=auth_headers
        )
        assert resp.status_code == 404, resp.text

    async def test_other_users_provider_returns_403(
        self,
        client: AsyncClient,
        auth_headers: dict,
        db_session: AsyncSession,
        mock_probe_notify: None,
    ) -> None:
        """跨用户 unset_default → ``PermissionDenied`` 403（D-008 owner 级不泄漏）。"""
        other_uid = await _create_other_user(db_session, label="unset-xuser")
        pid = await _seed_provider_for_user(
            db_session, other_uid, name="other-unset", is_default=True
        )

        resp = await client.post(f"/api/llm-providers/{pid}/unset-default", headers=auth_headers)

        assert resp.status_code == 403, resp.text


# ── 2026-11-01-provider-share-audit-fixes：/usable 与 shares CRUD HTTP 层 ──────


async def _create_grantee(
    db_session: AsyncSession, *, label: str = "g"
) -> tuple[uuid.UUID, dict[str, str], str]:
    """建被共享方用户并签发 Bearer（复刻 conftest.auth_admin_token 范式）。

    返回 (user_id, headers, email)——email 即共享 identifier（精确匹配）。
    """
    from app.core.config import get_settings
    from app.core.security import create_access_token
    from app.modules.auth.model import User

    settings = get_settings()
    uid = uuid.uuid4()
    email = f"grantee-{uid.hex[:8]}-{label}@example.com"
    db_session.add(
        User(
            id=uid,
            email=email,
            username=f"grantee-{uid.hex[:8]}",
            password_hash="irrelevant",
            display_name=f"Grantee {label}",
            status="active",
            login_enabled=True,
        )
    )
    await db_session.commit()
    token, _ = create_access_token(user_id=uid, email=email, is_admin=False, settings=settings)
    return uid, {"Authorization": f"Bearer {token}"}, email


class TestUsableEndpoint:
    """``GET /api/llm-providers/usable``：路由顺序 + 共享行脱敏（FR-04）。"""

    async def test_route_not_shadowed_and_shared_row_sanitized(
        self,
        client: AsyncClient,
        auth_headers: dict,
        db_session: AsyncSession,
    ) -> None:
        """GET /usable 先于 GET /{provider_id} 注册不被吞；共享行四脱敏。"""
        _, grantee_headers, grantee_email = await _create_grantee(db_session)

        # admin（属主）经 HTTP 建 provider，自由配置里埋秘密标记（NFR-02/评审 P2 脱敏面）。
        create = await client.post(
            "/api/llm-providers",
            headers=auth_headers,
            json={
                **_create_body(name="share-src"),
                "extra_env": {"MY_SECRET_ENV": "secret-extra-marker"},
                "settings_config": {"env": {"MY_SECRET_KEY": "secret-settings-marker"}},
            },
        )
        assert create.status_code == 201, create.text
        pid = create.json()["id"]

        share = await client.post(
            f"/api/llm-providers/{pid}/shares",
            headers=auth_headers,
            json={"identifier": grantee_email},
        )
        assert share.status_code == 201, share.text

        usable = await client.get("/api/llm-providers/usable", headers=grantee_headers)
        # 路由顺序断言：若被 GET /{provider_id}（provider_id="usable"）遮蔽，
        # 这里会是 404/422 而非列表。
        assert usable.status_code == 200, usable.text
        rows = {item["id"]: item for item in usable.json()["items"]}
        assert pid in rows, rows.keys()
        shared = rows[pid]
        assert shared["is_shared"] is True
        assert shared["shared_by_name"] == "Admin"
        assert shared["is_default"] is False
        # 评审 P2 脱敏：自由配置不回传（可能手填令牌）；密钥仅 masked。
        assert shared["settings_config"] is None
        assert shared["extra_env"] is None
        assert "secret-extra-marker" not in usable.text
        assert "secret-settings-marker" not in usable.text
        assert shared["api_key_masked"]

        # own-only 列表零回归：被共享方在设置页列表看不到共享项。
        own = await client.get("/api/llm-providers", headers=grantee_headers)
        assert own.status_code == 200, own.text
        assert pid not in {item["id"] for item in own.json()["items"]}


class TestSharesCrudEndpoints:
    """shares CRUD：201/204/404/403 语义 + 畸形 UUID 422（FR-01/FR-04）。"""

    async def test_share_list_unshare_semantics(
        self,
        client: AsyncClient,
        auth_headers: dict,
        db_session: AsyncSession,
    ) -> None:
        """共享 201（body 带 grantee user_id）→ 列表可见 → 撤销 204 幂等。"""
        grantee_uid, _, grantee_email = await _create_grantee(db_session, label="crud")

        create = await client.post(
            "/api/llm-providers", headers=auth_headers, json=_create_body(name="crud-src")
        )
        pid = create.json()["id"]

        share = await client.post(
            f"/api/llm-providers/{pid}/shares",
            headers=auth_headers,
            json={"identifier": grantee_email},
        )
        assert share.status_code == 201, share.text
        assert share.json()["user_id"] == str(grantee_uid)

        listed = await client.get(f"/api/llm-providers/{pid}/shares", headers=auth_headers)
        assert listed.status_code == 200, listed.text
        assert [item["user_id"] for item in listed.json()["items"]] == [str(grantee_uid)]

        delete = await client.delete(
            f"/api/llm-providers/{pid}/shares/{grantee_uid}", headers=auth_headers
        )
        assert delete.status_code == 204, delete.text
        # 幂等：再删一次仍 204。
        again = await client.delete(
            f"/api/llm-providers/{pid}/shares/{grantee_uid}", headers=auth_headers
        )
        assert again.status_code == 204, again.text

        listed2 = await client.get(f"/api/llm-providers/{pid}/shares", headers=auth_headers)
        assert listed2.json()["items"] == []

    async def test_share_unknown_target_404(self, client: AsyncClient, auth_headers: dict) -> None:
        """identifier 无匹配用户 → 统一 404（防用户枚举）。"""
        create = await client.post(
            "/api/llm-providers", headers=auth_headers, json=_create_body(name="t404")
        )
        pid = create.json()["id"]

        resp = await client.post(
            f"/api/llm-providers/{pid}/shares",
            headers=auth_headers,
            json={"identifier": "nobody-unknown@example.com"},
        )
        assert resp.status_code == 404, resp.text

    async def test_non_owner_shares_denied(
        self,
        client: AsyncClient,
        auth_headers: dict,
        db_session: AsyncSession,
    ) -> None:
        """非属主列共享/撤销 → service.get 403（owner 级不泄漏）。"""
        _, grantee_headers, _ = await _create_grantee(db_session, label="nonowner")
        create = await client.post(
            "/api/llm-providers", headers=auth_headers, json=_create_body(name="own-only")
        )
        pid = create.json()["id"]

        listed = await client.get(f"/api/llm-providers/{pid}/shares", headers=grantee_headers)
        assert listed.status_code == 403, listed.text
        delete = await client.delete(
            f"/api/llm-providers/{pid}/shares/{uuid.uuid4()}", headers=grantee_headers
        )
        assert delete.status_code == 403, delete.text

    async def test_valid_uuid_unknown_provider_404(
        self, client: AsyncClient, auth_headers: dict
    ) -> None:
        """合法 UUID 但 provider 不存在 → 404（422 改动零回归护栏）。"""
        resp = await client.get(f"/api/llm-providers/{uuid.uuid4()}/shares", headers=auth_headers)
        assert resp.status_code == 404, resp.text

    async def test_shares_invalid_provider_uuid_returns_422(
        self, client: AsyncClient, auth_headers: dict
    ) -> None:
        """畸形 UUID → 422 JSON 错误体（HTTP_422_LLM_PROVIDER_ID_INVALID），不再 500。"""
        for method, path in (
            ("GET", "/api/llm-providers/not-a-uuid/shares"),
            ("POST", "/api/llm-providers/not-a-uuid/shares"),
            ("DELETE", f"/api/llm-providers/not-a-uuid/shares/{uuid.uuid4()}"),
            ("GET", "/api/llm-providers/12345/shares"),
        ):
            resp = await client.request(
                method, path, headers=auth_headers, json={"identifier": "x@example.com"}
            )
            assert resp.status_code == 422, f"{method} {path}: {resp.status_code} {resp.text}"
            body = resp.json()
            assert body["code"] == "HTTP_422_LLM_PROVIDER_ID_INVALID"
            assert "request_id" in body
