"""``app.modules.ppm.common.crud`` 单测。

覆盖 task-01 验收：
- ``apply_sort`` 对白名单/非白名单字段行为正确
- ``PageReq`` 边界归一 (page<1 / page_size>200 / 非法 order)
- ``Page.build`` / ``total_pages`` 计算
"""

from __future__ import annotations

import pytest
from sqlalchemy import Column, Integer, String, select
from sqlalchemy.orm import DeclarativeBase

from app.modules.ppm.common.crud import (
    DEFAULT_PAGE,
    DEFAULT_PAGE_SIZE,
    MAX_PAGE_SIZE,
    Page,
    PageReq,
    SortOrder,
    apply_pagination,
    apply_sort,
)


class _Base(DeclarativeBase):
    pass


class _Demo(_Base):
    __tablename__ = "_ppm_demo_for_test"

    id = Column(Integer, primary_key=True)
    name = Column(String(50))
    created_at = Column(Integer)


class TestPageReq:
    def test_defaults(self) -> None:
        req = PageReq()
        assert req.page == DEFAULT_PAGE
        assert req.page_size == DEFAULT_PAGE_SIZE
        assert req.offset == 0

    def test_invalid_page_clamped(self) -> None:
        req = PageReq(page=0, page_size=-5)
        assert req.page == DEFAULT_PAGE
        assert req.page_size == DEFAULT_PAGE_SIZE
        assert req.offset == 0

    def test_page_size_capped(self) -> None:
        req = PageReq(page=2, page_size=9999)
        assert req.page_size == MAX_PAGE_SIZE
        assert req.offset == MAX_PAGE_SIZE  # (2-1)*200

    def test_order_normalized(self) -> None:
        assert PageReq(order="asc").order == SortOrder.ASC
        assert PageReq(order="DESC").order == SortOrder.DESC
        assert PageReq(order="garbage").order == SortOrder.DESC
        assert PageReq(order=None).order == SortOrder.DESC


class TestApplySort:
    def _base_stmt(self) -> object:
        return select(_Demo)

    def test_whitelisted_field_applies_order(self) -> None:
        stmt = apply_sort(self._base_stmt(), _Demo, "name", {"name", "id"}, "asc")
        compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
        assert "ORDER BY" in compiled.upper()
        assert "name" in compiled.lower()

    def test_non_whitelisted_field_ignored(self) -> None:
        stmt = apply_sort(self._base_stmt(), _Demo, "secret", {"name", "id"}, "asc")
        compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
        assert "ORDER BY" not in compiled.upper()

    def test_none_order_by_skips_sort(self) -> None:
        stmt = apply_sort(self._base_stmt(), _Demo, None, {"name"}, "asc")
        compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
        assert "ORDER BY" not in compiled.upper()

    def test_column_map_translation(self) -> None:
        stmt = apply_sort(
            self._base_stmt(),
            _Demo,
            "createTime",
            {"createTime"},
            "desc",
            column_map={"createTime": "created_at"},
        )
        compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
        assert "ORDER BY" in compiled.upper()
        assert "created_at" in compiled.lower()

    def test_desc_direction(self) -> None:
        stmt = apply_sort(self._base_stmt(), _Demo, "id", {"id"}, "desc")
        compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
        assert "DESC" in compiled.upper()


class TestApplyPagination:
    def test_offset_limit_applied(self) -> None:
        req = PageReq(page=3, page_size=10)
        stmt = apply_pagination(select(_Demo), req)
        compiled = str(stmt.compile(compile_kwargs={"literal_binds": True}))
        assert "OFFSET 20" in compiled.upper().replace("  ", " ")
        assert "LIMIT 10" in compiled.upper()


class TestPage:
    def test_build_carries_req_params(self) -> None:
        req = PageReq(page=2, page_size=15)
        page = Page.build(items=[1, 2, 3], total=42, req=req)
        assert page.items == [1, 2, 3]
        assert page.total == 42
        assert page.page == 2
        assert page.page_size == 15

    def test_total_pages_rounding(self) -> None:
        req = PageReq(page=1, page_size=20)
        page = Page[int].build(items=[], total=42, req=req)
        assert page.total_pages == 3  # ceil(42/20)

        req2 = PageReq(page=1, page_size=20)
        page2 = Page[int].build(items=[], total=40, req=req2)
        assert page2.total_pages == 2  # 整除

    def test_total_pages_zero_size(self) -> None:
        page = Page[int](items=[], total=10, page=1, page_size=0)
        assert page.total_pages == 0


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
