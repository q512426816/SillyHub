"""plan 子域 router 层 HTTP 测试。

覆盖 export-excel 字面量路由顺序回归 (ql-20260714-001-8c02):
- ``/plan-node-detail/export-excel`` 必须前置于 ``/plan-node-detail/{item_id}``,
  否则字面量 ``export-excel`` 会被 ``{item_id}`` 路径参数吞掉当 UUID 解析返回 422。
- ``/plan-node/export-excel`` 同理 (同 problem ql-020 / project 路由前置约定)。

依据: ``design.md`` §7/§13 + ``ppm/project/tests/test_router.py::test_project_export_excel``。
使用根 conftest 的 ``client`` (platform_admin,全权限) + ``auth_headers`` fixture。
"""

from __future__ import annotations

from io import BytesIO

import pytest
from httpx import AsyncClient
from openpyxl import load_workbook


@pytest.mark.parametrize(
    "path,expected_header",
    [
        ("/api/ppm/plan-node/export-excel", "总体阶段"),
        ("/api/ppm/plan-node-detail/export-excel", "任务主题"),
    ],
)
async def test_export_excel_literal_route_not_shadowed(
    client: AsyncClient, auth_headers: dict, path: str, expected_header: str
) -> None:
    """export-excel 字面量路径必须命中专用导出端点 (200 + 合法 xlsx),
    不能被 ``{item_id}`` 路径参数拦截返回 422。"""
    resp = await client.get(path, headers=auth_headers)
    # 回归点:修复前此处为 422 (export-excel 被 {item_id} 当 UUID 解析失败)
    assert resp.status_code == 200, resp.text
    assert resp.headers["content-type"].startswith(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )
    assert "attachment" in resp.headers["content-disposition"]
    wb = load_workbook(BytesIO(resp.content))
    headers = [c.value for c in wb.active[1]]
    assert expected_header in headers
