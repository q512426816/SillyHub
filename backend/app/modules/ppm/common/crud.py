"""通用分页/排序 helper —— ppm 各子域 service/router 共用。

统一沿用 admin 模块的 1-based 分页约定 (``page >= 1``、``offset = (page-1)*size``)
与 ``total`` via subquery-count 的统计方式，避免每个子域重复实现。

设计依据：
- ``design.md`` §5 (common helper 抽离复用)
- admin/roles_service.py 的 page/size/total 模式
- ``backend/scan/CONVENTIONS.md`` (类型标注强制 + 中文注释)
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, Field
from sqlalchemy import Select, func, select
from sqlalchemy.sql.expression import asc, desc

DEFAULT_PAGE = 1
DEFAULT_PAGE_SIZE = 20
MAX_PAGE_SIZE = 200


class SortOrder:
    """排序方向常量。"""

    ASC = "asc"
    DESC = "desc"
    _ALLOWED = frozenset({ASC, DESC})

    @classmethod
    def normalize(cls, value: str | None) -> str:
        """规范化排序方向，非法值回退为 ``desc``。"""
        if value is None:
            return cls.DESC
        v = value.strip().lower()
        return v if v in cls._ALLOWED else cls.DESC


@dataclass(slots=True)
class PageReq:
    """分页 + 排序请求参数。

    各子域的 Pydantic ``Query`` schema 可继承或组合此结构。直接作为依赖
    注入时，建议子域自定义 Pydantic 模型并复用 :func:`apply_pagination`
    / :func:`apply_sort`；此处 dataclass 供 service 层与单测直接构造。

    Attributes:
        page: 页码，1-based，最小 1。
        page_size: 每页条数，1–200。
        order_by: 排序字段名 (业务字段名，非列名)；为 ``None`` 表示不排序。
        order: 排序方向 ``asc``/``desc``，非法值归一为 ``desc``。
    """

    page: int = DEFAULT_PAGE
    page_size: int = DEFAULT_PAGE_SIZE
    order_by: str | None = None
    order: str = SortOrder.DESC

    def __post_init__(self) -> None:
        if self.page < 1:
            self.page = DEFAULT_PAGE
        if self.page_size < 1:
            self.page_size = DEFAULT_PAGE_SIZE
        if self.page_size > MAX_PAGE_SIZE:
            self.page_size = MAX_PAGE_SIZE
        self.order = SortOrder.normalize(self.order)

    @property
    def offset(self) -> int:
        """计算 SQL offset。"""
        return (self.page - 1) * self.page_size


class Page[T](BaseModel):
    """通用分页响应信封。

    与 admin ``RoleListResponse`` 形状一致：``items + total``，额外补
    ``page``/``page_size``/``total_pages`` 便于前端分页器渲染。

    泛型参数 ``T`` 为分页行类型 (通常是 Pydantic Response model 或 ORM 模型)。
    """

    items: list[T] = Field(default_factory=list)
    total: int = 0
    page: int = DEFAULT_PAGE
    page_size: int = DEFAULT_PAGE_SIZE

    @property
    def total_pages(self) -> int:
        """总页数 (向上取整)；page_size 为 0 时返回 0。"""
        if self.page_size <= 0:
            return 0
        return (self.total + self.page_size - 1) // self.page_size

    @classmethod
    def build(
        cls,
        *,
        items: list[T],
        total: int,
        req: PageReq,
    ) -> "Page[T]":
        """按行列表 + 总数 + 请求参数构造分页响应。"""
        return cls(
            items=items,
            total=total,
            page=req.page,
            page_size=req.page_size,
        )


# ---------------------------------------------------------------------------
# SQLAlchemy 查询构造 helper
# ---------------------------------------------------------------------------


def apply_pagination(stmt: Select[Any], req: PageReq) -> Select[Any]:
    """给 ``Select`` 语句追加 offset/limit。

    单独抽出以便 service 在分页前先执行 count (需要原始 stmt 的 subquery)，
    典型用法见模块文档末尾示例。

    Args:
        stmt: 已构造好 where/order 的 SQLAlchemy ``Select``。
        req: 分页参数。

    Returns:
        追加了 ``offset``/``limit`` 的新 ``Select``。
    """
    return stmt.offset(req.offset).limit(req.page_size)


def apply_sort(
    stmt: Select[Any],
    model: type,
    order_by: str | None,
    allowed: set[str],
    order: str = SortOrder.DESC,
    *,
    column_map: dict[str, str] | None = None,
) -> Select[Any]:
    """对 ``Select`` 追加白名单排序，防 SQL 注入。

    排序字段必须出现在 ``allowed`` 白名单内，否则忽略 (返回原 stmt，
    不抛错 —— 排序是弱语义，前端传错字段静默降级比 400 更友好)。
    字段名经 ``column_map`` 映射到实际列名 (允许前端用驼峰/别名排序)。

    Args:
        stmt: 已构造好 where 的 ``Select``。
        model: 排序字段所属的 SQLModel/SQLAlchemy 模型类。
        order_by: 前端传入的排序字段名。
        allowed: 允许排序的字段名白名单 (业务字段名)。
        order: ``asc``/``desc``。
        column_map: 业务字段名 → 模型属性名 的映射；缺省时两者同名。

    Returns:
        追加了 ``order_by`` 的新 ``Select``；非法字段返回原 stmt。
    """
    if not order_by:
        return stmt
    if order_by not in allowed:
        return stmt

    attr_name = (column_map or {}).get(order_by, order_by)
    column = getattr(model, attr_name, None)
    if column is None:
        return stmt

    direction = asc if SortOrder.normalize(order) == SortOrder.ASC else desc
    return stmt.order_by(direction(column))


async def count_total(session: Any, stmt: Select[Any]) -> int:
    """对 ``Select`` 的结果集执行 COUNT。

    用 subquery 包裹，兼容已有 ``order_by``/``join`` 的语句 (排序不影响计数)。
    需 ``AsyncSession``；同步 session 亦可 (直接调用 ``.execute`` 的非 async 版)。

    Args:
        session: SQLAlchemy AsyncSession (或同步 Session)。
        stmt: 待统计的 ``Select`` (含 where/join)。

    Returns:
        总行数；统计失败或为 NULL 时返回 0。
    """
    result = await session.execute(select(func.count()).select_from(stmt.subquery()))
    return result.scalar() or 0


__all__ = [
    "DEFAULT_PAGE",
    "DEFAULT_PAGE_SIZE",
    "MAX_PAGE_SIZE",
    "Page",
    "PageReq",
    "SortOrder",
    "apply_pagination",
    "apply_sort",
    "count_total",
]
