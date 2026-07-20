"""ppm 模块最小冒烟测试。

覆盖 change ``2026-07-20-ppm-permission-simplify`` task-05 / R-04 / AC-4:
task-01 去掉 6 个 ppm router 的 ``require_permission_any`` 后,只做"登录认证"
即可访问的回归守护。仅断言代表性 GET 端点 ``/api/ppm/workbench/profile``
在带合法 JWT 时返回 200、未带 Authorization 头时返回 401。

不依赖任何被删的 17 个 ppm 操作权限字符串,仅靠"登录拿 token"即可访问。
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import User


async def _make_user(session: AsyncSession) -> tuple[User, str]:
    """建一个 active 登录用户并签 JWT (复用 auth 测试的 helper 模式)。

    ppm 端点 task-01 后仅认证不授权,is_platform_admin 取值不影响访问结果,
    这里取默认值即可。
    """
    user = User(
        id=uuid.uuid4(),
        email=f"user-{uuid.uuid4().hex[:6]}@example.com",
        password_hash=password_hasher.hash("x"),
        status="active",
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


@pytest.mark.asyncio
async def test_workbench_profile_authenticated_returns_200(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    """登录用户 (合法 JWT) 访问 /api/ppm/workbench/profile → 200。

    task-01 后该端点仅 Depends(get_current_principal),无任务数据时
    WorkbenchService.get_profile 返回兜底空值,亦为 200。
    """
    _, token = await _make_user(db_session)
    resp = await client.get(
        "/api/ppm/workbench/profile",
        headers={"Authorization": f"Bearer {token}"},
    )
    assert resp.status_code == 200, resp.text
    # 关键字段存在 (display_name / avatar_text 永远非空)
    body = resp.json()
    assert "avatar_text" in body
    assert body["avatar_text"]


@pytest.mark.asyncio
async def test_workbench_profile_unauthenticated_returns_401(
    client: AsyncClient,
) -> None:
    """未携带 Authorization 头访问 /api/ppm/workbench/profile → 401。

    回归守护:去掉 require_permission_any 后,无凭证请求仍被
    get_current_principal 拦在认证层 (401),不会进入 handler。
    """
    resp = await client.get("/api/ppm/workbench/profile")
    assert resp.status_code == 401
