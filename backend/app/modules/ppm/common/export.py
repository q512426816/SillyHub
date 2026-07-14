"""通用 Excel 导出 helper —— 基于 openpyxl，配置驱动列定义。

ppm 各子域约有 18 个 ``/export-excel`` 端点 (R-04)，逐个手写 openpyxl
样板不可取；本模块用 ``ColumnDef`` 描述列 → ``rows_to_workbook`` 产出
``.xlsx`` 字节流 → ``excel_response`` 包成 FastAPI ``StreamingResponse``。

性能与事件循环 (X-002)：openpyxl 是纯 CPU 同步库，会阻塞 async 事件循环。
导出端点应声明为同步 ``def`` (FastAPI 自动用线程池跑)，或在 ``async def``
端点内用 ``anyio.to_thread.run_sync(rows_to_workbook, ...)`` 调用。

设计依据：``design.md`` §7 (各子域 /export-excel) + §13 X-002 + §10 R-04。
"""

from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime
from io import BytesIO
from typing import Any
from urllib.parse import quote

from fastapi.responses import StreamingResponse
from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

Formatter = Callable[[Any], Any]
"""单元格格式化器：接收原始值，返回可写入单元格的值 (str/int/float/datetime/None)。"""

_HEADER_FONT = Font(bold=True, color="FFFFFF")
_HEADER_FILL = PatternFill(start_color="305496", end_color="305496", fill_type="solid")
_HEADER_ALIGN = Alignment(horizontal="center", vertical="center")


@dataclass(slots=True)
class ColumnDef:
    """单列导出定义。

    Attributes:
        field: 行字典中取值的键 (与 ORM/Pydantic 字段名对齐)。
        header: 表头显示文本 (通常中文)。
        width: 列宽 (字符数)；``None`` 用 openpyxl 默认。
        formatter: 值格式化器；``None`` 原样写入。
    """

    field: str
    header: str
    width: float | None = None
    formatter: Formatter | None = None

    def extract(self, row: Mapping[str, Any]) -> Any:
        """从行字典取值并格式化。缺失键返回 ``None``。"""
        value = row.get(self.field)
        if self.formatter is None:
            return value
        return self.formatter(value)


def rows_to_workbook(
    columns: list[ColumnDef],
    rows: Iterable[Mapping[str, Any]],
    *,
    sheet_name: str = "Sheet1",
) -> bytes:
    """把行数据按列定义写成 ``.xlsx`` 字节流。

    同步函数 (X-002)：调用方需在线程池中跑。

    Args:
        columns: 列定义 (顺序即输出顺序)。
        rows: 行字典的可迭代对象 (dict/Pydantic ``model_dump()`` 结果)。
        sheet_name: 工作表名。

    Returns:
        ``.xlsx`` 文件字节内容。
    """
    wb = Workbook()
    ws = wb.active
    ws.title = sheet_name

    # 表头
    headers = [c.header for c in columns]
    ws.append(headers)
    for idx, col in enumerate(columns, start=1):
        cell = ws.cell(row=1, column=idx)
        cell.font = _HEADER_FONT
        cell.fill = _HEADER_FILL
        cell.alignment = _HEADER_ALIGN
        if col.width is not None:
            ws.column_dimensions[get_column_letter(idx)].width = col.width

    # 数据行
    for row in rows:
        ws.append([col.extract(row) for col in columns])

    # 冻结首行，方便浏览
    ws.freeze_panes = "A2"

    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def excel_response(
    content: bytes,
    *,
    filename: str,
) -> StreamingResponse:
    """把 ``.xlsx`` 字节流包成 FastAPI 下载响应。

    Args:
        content: ``rows_to_workbook`` 返回的 ``.xlsx`` 字节。
        filename: 下载文件名 (建议含 ``.xlsx`` 后缀)。

    Returns:
        ``StreamingResponse``，``Content-Type`` 为 Excel MIME，
        ``Content-Disposition`` 触发浏览器下载。
    """

    def _iter() -> Iterable[bytes]:
        yield content

    # Content-Disposition 头是 latin-1 编码,中文字符超范围 → UnicodeEncodeError。
    # 用 RFC 5987 的 filename*=UTF-8''<percent-encoded> 格式,主流浏览器
    # (Chrome/Edge/Firefox)优先用 filename* 解码 UTF-8 原文,filename 作
    # ASCII 回退 (旧浏览器/curl 等场景可读但乱码)。
    ascii_fallback = filename.encode("ascii", "ignore").decode("ascii") or "export.xlsx"
    encoded = quote(filename, safe="")
    return StreamingResponse(
        _iter(),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"{ascii_fallback}\"; filename*=UTF-8''{encoded}"
            )
        },
    )


def export_to_response(
    columns: list[ColumnDef],
    rows: Iterable[Mapping[str, Any]],
    *,
    filename: str,
    sheet_name: str = "Sheet1",
) -> StreamingResponse:
    """一步到位：行数据 → workbook → 下载响应。

    便捷封装，端点侧常用入口。注意此函数同步执行 openpyxl 序列化，端点
    必须是 ``def`` (非 ``async def``) 或调用方用 ``anyio.to_thread`` 包裹。
    """
    content = rows_to_workbook(columns, rows, sheet_name=sheet_name)
    return excel_response(content, filename=filename)


def timestamped_filename(label: str) -> str:
    """生成「中文标签_YYYYMMDD_HHMMSS.xlsx」下载文件名。

    ppm 各子域 ``/export-excel`` 端点统一用此函数,确保文件名风格一致
    (中文短标签 + 精确到秒的时间戳),便于用户区分多次导出结果。

    Args:
        label: 中文短标签 (如 ``"里程碑明细"``、``"项目维护"``),作为文件名前缀。

    Returns:
        形如 ``里程碑明细_20260714_094030.xlsx`` 的文件名。
    """
    return f"{label}_{datetime.now():%Y%m%d_%H%M%S}.xlsx"


__all__ = [
    "ColumnDef",
    "Formatter",
    "excel_response",
    "export_to_response",
    "rows_to_workbook",
    "timestamped_filename",
]
