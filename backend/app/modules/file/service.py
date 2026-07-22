"""file 模块业务层 — 上传/下载流/批量元数据/软删。

存储经 ``Depends(get_storage_backend)`` 注入（测试用 dependency_overrides 换 mock，
不依赖真实 MinIO，NFR-4）。大小/类型校验在本层做并抛 ``AppError``，
413/415 状态码由 router 映射（task-05）。

设计依据：design.md §D-003/D-008 + tasks/task-04.md。
"""

from __future__ import annotations

import re
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import AppError
from app.modules.file.model import File
from app.modules.file.schema import FileMetaResp, FileUploadResp
from app.modules.storage.base import StorageBackend


def _safe_ext(original_name: str) -> str:
    """取扩展名（小写，仅字母数字，≤10 字符），防注入；无则空串。"""
    ext = Path(original_name).suffix.lower().lstrip(".")
    return ext if re.fullmatch(r"[a-z0-9]{1,10}", ext) else ""


class FileService:
    """文件中心业务服务。"""

    def __init__(
        self,
        session: AsyncSession,
        storage: StorageBackend,
        settings: Settings,
    ) -> None:
        self._session = session
        self._storage = storage
        self._settings = settings

    def validate_upload(self, *, size: int, mime_type: str) -> None:
        """大小/类型校验。超限/不符抛 AppError（router 映射 413/415）。"""
        max_bytes = self._settings.file_max_size_mb * 1024 * 1024
        if size > max_bytes:
            raise AppError(
                f"文件大小 {size} 字节超过上限 {self._settings.file_max_size_mb}MB",
                code="file_too_large",
                http_status=413,
            )
        if mime_type not in self._settings.file_allowed_type_set:
            raise AppError(
                f"不支持的文件类型 {mime_type!r}",
                code="file_type_not_allowed",
                http_status=415,
            )

    async def upload_file(
        self,
        *,
        original_name: str,
        data: bytes,
        mime_type: str,
        uploaded_by: uuid.UUID,
        owner_type: str = "",
        owner_id: uuid.UUID | None = None,
    ) -> FileUploadResp:
        """上传：校验 → 存对象 → 落 File 表 → 返回 FileUploadResp。"""
        self.validate_upload(size=len(data), mime_type=mime_type)
        file_id = uuid.uuid4()
        now = datetime.now(UTC)
        ext = _safe_ext(original_name)
        suffix = f".{ext}" if ext else ""
        stored_key = f"{now:%Y/%m}/{file_id}{suffix}"
        await self._storage.put_object(stored_key, data, mime_type)
        row = File(
            id=file_id,
            owner_type=owner_type,
            owner_id=owner_id,
            original_name=original_name[:255],
            stored_key=stored_key,
            mime_type=mime_type,
            size=len(data),
            uploaded_by=uploaded_by,
            created_at=now,
        )
        self._session.add(row)
        await self._session.commit()
        return FileUploadResp(
            id=row.id, original_name=row.original_name, mime_type=row.mime_type, size=row.size
        )

    async def _get_active(self, file_id: uuid.UUID) -> File:
        """取未软删的 File，不存在/已删抛 404。"""
        row = await self._session.get(File, file_id)
        if row is None or row.deleted_at is not None:
            raise AppError("文件不存在或已删除", code="file_not_found", http_status=404)
        return row

    async def get_meta(self, file_id: uuid.UUID) -> File:
        """取单个文件元数据（router Content-Disposition 判定用）。"""
        return await self._get_active(file_id)

    async def get_stream(self, file_id: uuid.UUID) -> tuple[File, AsyncIterator[bytes]]:
        """取下载流：返回 (File 元数据, 异步字节流)。"""
        row = await self._get_active(file_id)
        return row, self._storage.get_object_stream(row.stored_key)

    async def batch_meta(self, ids: list[uuid.UUID]) -> list[FileMetaResp]:
        """批量取元数据（跳过已软删），供前端回显。"""
        if not ids:
            return []
        stmt = select(File).where(File.id.in_(ids), File.deleted_at.is_(None))
        rows = (await self._session.execute(stmt)).scalars().all()
        return [FileMetaResp.model_validate(r) for r in rows]

    async def soft_delete(self, file_id: uuid.UUID) -> None:
        """软删：置 deleted_at。对象本体由后续清理流程删除，这里不动存储。"""
        row = await self._get_active(file_id)
        row.deleted_at = datetime.now(UTC)
        await self._session.commit()
