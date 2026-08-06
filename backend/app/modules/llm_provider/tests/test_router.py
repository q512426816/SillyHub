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
            model="claude-sonnet-4",
            is_default=is_default,
        ),
    )
    return row.id


def _create_body(*, name: str = "p-http", is_default: bool = False) -> dict:
    """HTTP POST /api/llm-providers 创建 body（admin owner，最小字段集）。"""
    return {
        "name": name,
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
