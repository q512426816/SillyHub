"""Menu overrides 子路由：``/api/menu-overrides`` 三端点（task-05）。

Change ``2026-09-18-web-menu-management`` task-05 / design §总体方案 Phase 1.3
+ §接口定义。独立文件而非并入 admin 主 router 的根因（审查 B-01）：admin 主
router 自带 ``prefix="/admin"``（router.py），会把导航消费的公开读端点推到
``/api/admin/menu-overrides``，普通用户无法到达——故本子路由自带
``prefix="/menu-overrides"``，由 main.py 以 ``include_router(..., prefix="/api")``
sibling 挂载（先例 members_router / platform_sync_workspace_router）。

三端点（读/写分流，design Phase 2.4 / R-06）：

* ``GET    /api/menu-overrides``：仅需认证（``get_current_user``），任意登录
  用户读全量覆盖——普通用户导航也要消费改名/排序/隐藏（全局生效，D-002），
  内容仅为显示配置无敏感信息。
* ``PUT    /api/menu-overrides/{menu_key}``：``require_permission_any(MENU_ADMIN)``
  门控（无 workspace 路径参数的端点惯例，admin roles 端点同款；
  ``require_permission`` 需 ``{workspace_id}`` 路径参数，不适用本路由）。
* ``DELETE /api/menu-overrides/{menu_key}``：同上门控；整行删除 = 该菜单全部
  恢复默认，幂等 204。

本层是薄 HTTP 壳：参数翻译 + 依赖注入，校验 / 审计 / upsert 语义全委派
task-04 的 :class:`MenuOverrideService`（AppError 子类由全局 handler 序列化，
router 不捕获）。后端不校验 menu_key 是否存在于前端注册表——孤儿行由前端
合并层忽略（R-01 / constraints）。列表响应包装 DTO 定义在本模块内（task-05
allowed_paths 未含 schema.py，先例 agent/profile/router.py）。
"""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user, require_permission_any
from app.core.db import get_session
from app.modules.admin.menu_overrides_service import MenuOverrideService
from app.modules.admin.schema import MenuOverrideRead, MenuOverrideUpsert
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission

router = APIRouter(prefix="/menu-overrides", tags=["menu-overrides"])


class MenuOverrideListResponse(BaseModel):
    """GET 列表响应包装（仓库 list 响应惯例：顶层 ``items`` 字段）。"""

    items: list[MenuOverrideRead]


# menu_key 长度防御：对齐模型列 String(64)，超长由 FastAPI 422 拒绝（按字符
# 计数，中英文同一把尺），避免 upsert 落库时才被 DB 约束炸出 500。
MenuKeyPath = Annotated[str, Path(min_length=1, max_length=64)]


@router.get("", response_model=MenuOverrideListResponse)
async def list_menu_overrides(
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> MenuOverrideListResponse:
    """全量菜单覆盖（menu_key 升序）。仅需认证：内容为全局显示配置，无敏感
    信息（R-06）；FR-05 下发端点，导航侧所有登录用户消费。"""
    items = await MenuOverrideService(session, user.id).list_overrides()
    return MenuOverrideListResponse(items=items)


@router.put(
    "/{menu_key}",
    response_model=MenuOverrideRead,
    dependencies=[Depends(require_permission_any(Permission.MENU_ADMIN))],
)
async def upsert_menu_override(
    menu_key: MenuKeyPath,
    payload: MenuOverrideUpsert,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> MenuOverrideRead:
    """按 menu_key 建行或整行覆盖写（``None`` = 清除该维度回代码默认）。
    label/sort_order 校验与 ``menu_override.upserted`` 审计在 service 层。"""
    return await MenuOverrideService(session, user.id).upsert_override(menu_key, payload)


@router.delete(
    "/{menu_key}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_permission_any(Permission.MENU_ADMIN))],
)
async def delete_menu_override(
    menu_key: MenuKeyPath,
    session: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
) -> None:
    """按 menu_key 整行删除（该菜单全部恢复默认）。行不存在时幂等 204，
    ``menu_override.deleted`` 审计在 service 层。"""
    await MenuOverrideService(session, user.id).delete_override(menu_key)
    return None
