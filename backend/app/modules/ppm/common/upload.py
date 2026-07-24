"""通用 ``.xlsx`` 上传校验 helper —— ppm 各子域导入端点共用。

背景：``plan/router.py`` 原有私有 ``_validate_upload``（模块导入），``problem``
子域的 Excel 批量导入（D-013）需要相同校验，但不能跨子域引用 plan 的私有
``_`` 前缀函数。本模块把校验抽到 ``ppm/common``，中立异常
:class:`PpmUploadError`（非 ``PlanError``），由 ``app.core.errors`` 的
``AppError`` 处理器统一翻译为标准错误体。

设计依据：
- ``design.md`` §5 (Wave1 step1) + §10 R-06 + §11 D-013@v1
- ``plan/router.py:1009`` ``_validate_upload``（逻辑搬移，不改原函数）
"""

from __future__ import annotations

from fastapi import UploadFile

from app.core.errors import AppError

# 批量导入单文件上限 (10 MiB)：防止恶意/误传大文件全量进内存导致 OOM。
# 与 ``plan/router.py`` 的 ``MAX_IMPORT_BYTES`` 保持一致，但不反向 import
# plan 的常量（避免跨子域耦合，D-013）。
MAX_IMPORT_BYTES = 10 * 1024 * 1024


class PpmUploadError(AppError):
    """ppm 通用上传校验错误（中立异常，非 plan 域）。

    默认 400；具体校验场景（过大/格式不符）通过 ``http_status`` 覆盖为
    413 / 415，与 ``plan/router.py`` 的 ``_validate_upload`` 返回码对齐。
    """

    code = "PPM_UPLOAD_ERROR"
    http_status = 400


def validate_xlsx_upload(file: UploadFile, file_bytes: bytes) -> None:
    """校验上传文件为 ``.xlsx`` 且未超过大小上限。

    校验顺序（与 ``plan/router.py:_validate_upload`` 一致）：

    1. 大小超过 :data:`MAX_IMPORT_BYTES` → :class:`PpmUploadError` (413)
    2. 扩展名非 ``.xlsx`` 且 ``content_type`` 不含 ``spreadsheetml``/``xlsx``
       → :class:`PpmUploadError` (415)

    纯函数：只读 ``file.filename`` / ``file.content_type`` 和 ``file_bytes``
    的长度，不做 IO，便于单测。调用方应在 ``await file.read()`` 取得
    ``file_bytes`` 后、交解析器前调用。

    Args:
        file: FastAPI 上传文件对象（取文件名与 content_type）。
        file_bytes: 已读入内存的文件字节内容（取大小）。

    Raises:
        PpmUploadError: 文件过大 (413) 或格式不符 (415)。
    """
    if len(file_bytes) > MAX_IMPORT_BYTES:
        raise PpmUploadError(
            f"导入文件过大（{len(file_bytes)} bytes），上限 {MAX_IMPORT_BYTES} bytes",
            http_status=413,
        )
    name = (file.filename or "").lower()
    ctype = (file.content_type or "").lower()
    is_xlsx = name.endswith(".xlsx") or "spreadsheetml" in ctype or "xlsx" in ctype
    if not is_xlsx:
        raise PpmUploadError("仅支持 .xlsx 文件导入", http_status=415)


__all__ = ["MAX_IMPORT_BYTES", "PpmUploadError", "validate_xlsx_upload"]
