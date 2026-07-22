"""file 模块 — 平台级文件中心（MinIO + 通用上传/预览 + PPM 接入）。

平台级基础设施域。提供通用文件上传/下载/元数据/软删 API（``/api/file``），
文件本体存对象存储（MinIO，经 storage 抽象层），元数据落 ``file`` 表。
PPM 各 ``file_urls`` 字段改存本表文件 id（D-006）。

设计依据：``.sillyspec/changes/2026-07-22-platform-file-center/design.md``。
"""

from __future__ import annotations

from app.modules.file.model import File
from app.modules.file.schema import BatchMetaRequest, FileMetaResp, FileUploadResp
from app.modules.file.service import FileService

__all__ = [
    "BatchMetaRequest",
    "File",
    "FileMetaResp",
    "FileService",
    "FileUploadResp",
]
