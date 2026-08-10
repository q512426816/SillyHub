"""PPM 归属校验测试（change 2026-08-09-security-ppm-ownership）。

代填冒名防护原语 ``resolve_owner`` 的两层覆盖:

1. **纯函数层（无 DB）**: ``resolve_owner`` 4 分支 + ``PpmOwnershipDenied`` 错误语义
   (``code``/``http_status``/``details``)——安全原语逻辑全覆盖 (AC-1~4/8 逻辑层)。
2. **端点层（HTTP）**: ``POST /api/ppm/task-plan/start`` 双角色——非管理员代填他人
   ``execute_user_id`` → 403 + ``code=HTTP_403_PPM_OWNERSHIP_DENIED`` (AC-1/2/8 响应层);
   非管理员自填 → 201 (AC-4)。管理员代填 → 201 (AC-3) 由既有 ``task/tests/test_router.py``
   （admin token 填随机 ``execute_user_id`` 走通）回归覆盖，此处不重复。

其余 6 个归属端点（execute_plan / task-execute create+update / work-hour create+update /
execute_problem）与 start_plan_task 共用同一 ``resolve_owner`` 调用模式（task-02~06 接线,
本文件纯函数测试已证原语），不逐一重复 HTTP 用例。

设计依据: change ``2026-08-09-security-ppm-ownership`` design.md §4/§7/§11 +
tasks/task-07.md。
"""

from __future__ import annotations

import types
import uuid

import pytest

from app.modules.ppm.common.ownership import PpmOwnershipDenied, resolve_owner

# =============================================================================
# Part A — resolve_owner 纯函数（无 DB, SimpleNamespace stub）
# =============================================================================


class TestResolveOwner:
    """``resolve_owner`` 4 分支 + ``PpmOwnershipDenied`` 错误语义。

    ``resolve_owner`` 仅读 ``actor.is_platform_admin``/``actor.id``（鸭子类型，不查库），
    故用 ``types.SimpleNamespace`` 构造 stub，无需 DB fixture。
    """

    def test_requested_none_returns_none(self) -> None:
        """未指定归属字段（None）→ 返回 None（调用方按既有默认处理，不校验）。"""
        actor = types.SimpleNamespace(id=uuid.uuid4(), is_platform_admin=False)
        assert resolve_owner(actor=actor, requested=None) is None

    def test_admin_passes_any_requested(self) -> None:
        """平台管理员 → 放行任意 requested（AC-3 运维/纠错代填场景）。"""
        admin = types.SimpleNamespace(id=uuid.uuid4(), is_platform_admin=True)
        other = uuid.uuid4()
        assert resolve_owner(actor=admin, requested=other) == other

    def test_non_admin_self_passes(self) -> None:
        """非管理员 + requested==自己 → 放行（AC-4 自填）。"""
        me = uuid.uuid4()
        actor = types.SimpleNamespace(id=me, is_platform_admin=False)
        assert resolve_owner(actor=actor, requested=me) == me

    def test_non_admin_other_raises_with_403_semantics(self) -> None:
        """非管理员 + requested==他人 → PpmOwnershipDenied(403)（AC-1/2/8）。"""
        actor = types.SimpleNamespace(id=uuid.uuid4(), is_platform_admin=False)
        other = uuid.uuid4()
        with pytest.raises(PpmOwnershipDenied) as ei:
            resolve_owner(actor=actor, requested=other, field="execute_user_id")
        # AC-8: 错误携带 403 + 标准化 code（core/errors.py 全局 handler 据此映射响应）
        assert ei.value.http_status == 403
        assert ei.value.code == "HTTP_403_PPM_OWNERSHIP_DENIED"
        # details 含字段名 + 双方 id，便于审计定位
        details = ei.value.details
        assert details is not None
        assert details["field"] == "execute_user_id"
        assert details["actor"] == str(actor.id)
        assert details["requested"] == str(other)

    def test_field_name_is_configurable_for_other_owner_fields(self) -> None:
        """``field`` 默认 execute_user_id；传 user_id/check_user_id 等也能在 details 定位。

        work-hour 用 user_id、task-execute 三字段各不同名，均经此原语。
        """
        actor = types.SimpleNamespace(id=uuid.uuid4(), is_platform_admin=False)
        other = uuid.uuid4()
        with pytest.raises(PpmOwnershipDenied) as ei:
            resolve_owner(actor=actor, requested=other, field="user_id")
        details = ei.value.details
        assert details is not None
        assert details["field"] == "user_id"


# =============================================================================
# Part C — 端点层双角色（HTTP, start_plan_task）
# =============================================================================


@pytest.fixture()
async def non_admin_user(db_session):
    """建一个非平台管理员（is_platform_admin=False）并落库，返回 User。"""
    from app.core.config import get_settings
    from app.core.security import password_hasher
    from app.modules.auth.model import User

    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)

    user = User(
        id=uuid.uuid4(),
        email="ppm-member@example.com",
        password_hash=password_hasher.hash("Member123!@#"),
        display_name="普通成员",
        status="active",
        is_platform_admin=False,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture()
async def non_admin_token(non_admin_user) -> str:
    """非管理员的 access token（is_admin=False）。"""
    from app.core.config import get_settings
    from app.core.security import create_access_token

    settings = get_settings()
    token, _ = create_access_token(
        user_id=non_admin_user.id,
        email=non_admin_user.email,
        is_admin=non_admin_user.is_platform_admin,
        settings=settings,
    )
    return token


@pytest.fixture()
def non_admin_headers(non_admin_token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {non_admin_token}"}


async def _create_plan(client, headers, user_id: str) -> str:
    """admin 建一条任务计划（status=未开始），返回 plan_task_id。"""
    resp = await client.post(
        "/api/ppm/task-plan/create",
        json={"user_id": user_id, "content": "归属校验测试", "work_load": "1"},
        headers=headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


class TestStartPlanTaskOwnership:
    """``POST /api/ppm/task-plan/start`` 归属校验端点级双角色。

    start_plan_task 仅 ``AuthUser`` 认证依赖（无额外权限门），非管理员可直达
    service ``start()`` 的 ``resolve_owner`` 校验点，适合做端点级 403/201 验证。
    """

    async def test_non_admin_filling_other_rejected_403(
        self, client, auth_headers, non_admin_headers
    ) -> None:
        """非管理员启动 + execute_user_id=他人 → 403 + code（AC-1/2/8 响应层）。"""
        plan_id = await _create_plan(client, auth_headers, str(uuid.uuid4()))
        someone_else = str(uuid.uuid4())

        resp = await client.post(
            "/api/ppm/task-plan/start",
            json={"plan_task_id": plan_id, "execute_user_id": someone_else},
            headers=non_admin_headers,
        )

        assert resp.status_code == 403, resp.text
        body = resp.json()
        assert body["code"] == "HTTP_403_PPM_OWNERSHIP_DENIED"

    async def test_non_admin_filling_self_accepted_201(
        self, client, auth_headers, non_admin_headers, non_admin_user
    ) -> None:
        """非管理员启动 + execute_user_id=自己 → 201（AC-4 自填放行）。"""
        plan_id = await _create_plan(client, auth_headers, str(uuid.uuid4()))

        resp = await client.post(
            "/api/ppm/task-plan/start",
            json={"plan_task_id": plan_id, "execute_user_id": str(non_admin_user.id)},
            headers=non_admin_headers,
        )

        assert resp.status_code == 201, resp.text
        assert resp.json()["execute_user_id"] == str(non_admin_user.id)
