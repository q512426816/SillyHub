"""StorageBackend 工厂 + 单例 + FastAPI Depends 注入。

``init_storage_backend`` 在应用 lifespan startup 调用一次，按 ``settings.storage_backend``
建实现并缓存为单例；``get_storage_backend`` 作为 FastAPI Depends 注入点，
测试用 ``app.dependency_overrides[get_storage_backend]`` 注入 mock（NFR-4，不依赖真实 MinIO）。

设计依据：design.md §D-002。
"""

from __future__ import annotations

from app.core.config import Settings
from app.modules.storage.base import StorageBackend
from app.modules.storage.minio_backend import MinioStorage

_backend: StorageBackend | None = None


def _build(settings: Settings) -> StorageBackend:
    """按配置建存储实现。当前仅 minio；新增 OSS 等在此注册（NFR-2）。"""
    if settings.storage_backend == "minio":
        return MinioStorage(
            endpoint=settings.s3_endpoint,
            access_key=settings.s3_access_key,
            secret_key=settings.s3_secret_key,
            bucket=settings.s3_bucket,
            region=settings.s3_region,
        )
    raise ValueError(f"unsupported storage_backend: {settings.storage_backend!r}")


def init_storage_backend(settings: Settings) -> StorageBackend:
    """lifespan startup 调用：建单例并缓存。重复调用返回已建单例。"""
    global _backend
    if _backend is None:
        _backend = _build(settings)
    return _backend


def get_storage_backend() -> StorageBackend:
    """FastAPI Depends 注入点。未在 lifespan 初始化（如测试直挂 router）时按当前配置兜底建。"""
    global _backend
    if _backend is None:
        from app.core.config import get_settings

        _backend = _build(get_settings())
    return _backend
