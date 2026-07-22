"""storage 模块 — 平台级对象存储抽象（S3 兼容）。

平台级基础设施域。提供 ``StorageBackend`` 抽象层（put/get/delete/head），
首个实现为 MinIO（S3 兼容），按配置切换；未来新增阿里云 OSS 等 S3 兼容
后端时仅需实现同一 ABC、在 factory 注册，业务代码零改动。

设计依据：``.sillyspec/changes/2026-07-22-platform-file-center/design.md`` §D-001/D-002。
"""

from __future__ import annotations

from app.modules.storage.base import StorageBackend
from app.modules.storage.factory import get_storage_backend, init_storage_backend

__all__ = [
    "StorageBackend",
    "get_storage_backend",
    "init_storage_backend",
]
