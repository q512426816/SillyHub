"""PPM 归属校验（ownership）——代填冒名防护原语。

PPM 执行/工时填报端点的归属字段（execute_user_id / check_user_id /
current_user_id / user_id）调用方原本可任意填，存在冒名风险（虚报工时、伪造执行）。
本模块提供 ``resolve_owner`` 归属校验原语 + ``PpmOwnershipDenied`` 错误类：

- 非管理员（``is_platform_admin=False``）显式把归属字段填成「非自己」→ 403；
- 平台管理员可代填（运维/纠错场景）；
- 字段为 ``None``（未指定）→ 不校验，保留调用方既有默认；
- 自填报（字段 == 当前登录用户）→ 放行。

校验放 service 层（纵深防御），router 把当前登录 ``User``（actor）透传进 service，
service 在落库前对每个归属字段调 ``resolve_owner``。详见 change
``2026-08-09-security-ppm-ownership`` design.md §4/§7。

``resolve_owner`` 仅读 ``actor.is_platform_admin`` 与 ``actor.id``（鸭子类型，
无 ``isinstance``、不查库），便于测试用 ``types.SimpleNamespace`` 构造 stub。
"""

from __future__ import annotations

import uuid
from typing import TYPE_CHECKING

from fastapi import status

from app.core.errors import AppError

if TYPE_CHECKING:
    from app.modules.auth.models import User


class PpmOwnershipDenied(AppError):
    """非管理员代他人填报 PPM 归属字段时抛出（403）。

    ppm 作用域错误类（与 ``resolve_owner`` 共处本模块），仿
    ``tool_gateway.tool_policy.SsrfBlocked`` 模式——不污染 ``core/errors.py``，
    经 ``core/errors.register_exception_handlers`` 全局 handler 按 ``http_status``
    自动映射为 HTTP 403 + ``code``，无需改 router。
    """

    code = "HTTP_403_PPM_OWNERSHIP_DENIED"
    http_status = status.HTTP_403_FORBIDDEN


def resolve_owner(
    *,
    actor: "User",
    requested: uuid.UUID | None,
    field: str = "execute_user_id",
) -> uuid.UUID | None:
    """归属校验原语：非管理员代他人填报→403；管理员可代填；未指定→None。

    Args:
        actor: 当前登录用户（由 router 透传）。读 ``is_platform_admin``/``id``。
        requested: 请求体里调用方填的归属字段值（可能 None=未指定）。
        field: 归属字段名（用于错误 details/日志定位）。

    Returns:
        校验后的归属值——``requested`` 为 None 时返回 None（调用方按既有默认处理，
        如 start 用登录用户 id、execute_problem 用 ``else actor.id``）；其余情况
        返回 ``requested``（管理员代填或自填放行）。

    Raises:
        PpmOwnershipDenied: 非管理员把归属字段显式填成「非自己」。
    """
    if requested is None:
        return None  # 未指定，不校验，调用方按既有默认
    if getattr(actor, "is_platform_admin", False):
        return requested  # 平台管理员代填放行
    if requested != actor.id:
        raise PpmOwnershipDenied(
            f"非管理员不能代他人填报 {field}（仅平台管理员可代填）",
            details={
                "field": field,
                "actor": str(actor.id),
                "requested": str(requested),
            },
        )
    return requested  # 自填，放行
