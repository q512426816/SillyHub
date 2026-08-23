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

from sqlalchemy import and_, false, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import allowed_workspace_ids, has_permission
from app.modules.file.model import File
from app.modules.file.schema import FileMetaResp, FileUploadResp
from app.modules.storage.base import StorageBackend

log = get_logger(__name__)


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
        description: str | None = None,
    ) -> FileUploadResp:
        """上传：校验 → 存对象 → 落 File 表 → 返回 FileUploadResp。

        ``description``：agent 上传制品说明（D-006@v2），落库前截断 255
        （仿 original_name，不加新校验错误码）；缺省 None 兼容旧行 NULL。
        """
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
            description=description[:255] if description else None,
        )
        self._session.add(row)
        try:
            await self._session.commit()
        except Exception:
            # 第五批 code-quality：commit 失败（DB 异常/连接断）→ MinIO 对象已写但
            # 无 File 行指向 → 孤儿对象。best-effort 补偿删存储对象（失败仅记日志，
            # 不掩盖原始 commit 异常，对齐 lease WS 容错范式）。
            try:
                await self._storage.delete_object(stored_key)
            except Exception:
                log.warning("file.upload_compensation_failed", stored_key=stored_key)
            raise
        return FileUploadResp(
            id=row.id,
            original_name=row.original_name,
            mime_type=row.mime_type,
            size=row.size,
            description=row.description,
        )

    async def _get_active(self, file_id: uuid.UUID) -> File:
        """取未软删的 File，不存在/已删抛 404。"""
        row = await self._session.get(File, file_id)
        if row is None or row.deleted_at is not None:
            raise AppError("文件不存在或已删除", code="file_not_found", http_status=404)
        return row

    def _not_found(self) -> AppError:
        """无权与不存在共用语义的 404（security-audit-remediation D-001，沿 287eed60 owner-only 约定）。"""
        return AppError("文件不存在或已删除", code="file_not_found", http_status=404)

    async def _can_access(self, *, user: User, row: File) -> bool:
        """归属判定（security-audit-remediation task-05 / FR-04）：

        本人上传（uploaded_by == user.id）或 platform_admin 豁免；
        workspace 归属文件对在该 workspace 有 WORKSPACE_READ 的用户可见
        （借用方案查看，R-04）。权限解析统一走 auth/rbac.py，不在本模块重复实现。
        """
        if row.uploaded_by == user.id or user.is_platform_admin:
            return True
        if row.owner_type == "workspace" and row.owner_id is not None:
            return await has_permission(
                self._session,
                user=user,
                permission=Permission.WORKSPACE_READ,
                workspace_id=row.owner_id,
            )
        return False

    async def _get_active_for(self, file_id: uuid.UUID, *, user: User) -> File:
        """取未软删 File 并断言归属；不存在/已删/无权统一 404（D-001）。"""
        row = await self._get_active(file_id)
        if not await self._can_access(user=user, row=row):
            raise self._not_found()
        return row

    async def get_meta(self, file_id: uuid.UUID, *, user: User) -> File:
        """取单个文件元数据（router Content-Disposition 判定用），归属断言后返回。"""
        return await self._get_active_for(file_id, user=user)

    async def get_stream(
        self, file_id: uuid.UUID, *, user: User
    ) -> tuple[File, AsyncIterator[bytes]]:
        """取下载流（归属断言后）：返回 (File 元数据, 异步字节流)。"""
        row = await self._get_active_for(file_id, user=user)
        return row, self._storage.get_object_stream(row.stored_key)

    async def batch_meta(self, ids: list[uuid.UUID], *, user: User) -> list[FileMetaResp]:
        """批量取元数据：跳过已软删 + 无权行静默剔除（对齐既有跳过软删回显语义）。"""
        if not ids:
            return []
        stmt = select(File).where(File.id.in_(ids), File.deleted_at.is_(None))
        rows = (await self._session.execute(stmt)).scalars().all()
        visible: list[FileMetaResp] = []
        for r in rows:
            if await self._can_access(user=user, row=r):
                visible.append(FileMetaResp.model_validate(r))
        return visible

    async def list_files(
        self,
        *,
        user: User,
        owner_type: str | None = None,
        owner_id: uuid.UUID | None = None,
        uploaded_by: uuid.UUID | None = None,
        limit: int = 100,
    ) -> list[FileMetaResp]:
        """按归属/上传者列文件元数据（task-13 / FR-06 借用方案查看，可见域 D-002）。

        业务/管理人员「借用方案」查看用：后端 close_interactive_run 回调把借用产出
        落 File 表（owner_type="workspace"、owner_id=ws_id、uploaded_by=业务人员，
        design §5 Phase 5 / D-009@v1），前端按 owner_type+owner_id 列方案文件。

        可见域（security-audit-remediation task-05）：非 admin 无权读全平台文件——
        带 ``owner_id``（workspace 归属查询）先校验该 workspace 的 WORKSPACE_READ
        成员资格，非成员 404；其余情况收敛为「本人上传 OR workspace 归属且
        owner_id 在 ``allowed_workspace_ids(user, WORKSPACE_READ)`` 集合内」。
        platform_admin 豁免可见全部（rbac has_permission 同款短路）。

        过滤掉已软删（deleted_at IS NULL）。``limit`` 上限 200 防滥用（router 层
        Query(le=200) 已约束，此处再 min 一道防御）。
        """
        if not user.is_platform_admin:
            if owner_id is not None:
                # 指定 workspace 归属查询：先校验成员资格，非成员与不存在同语义 404（D-001）。
                if not await has_permission(
                    self._session,
                    user=user,
                    permission=Permission.WORKSPACE_READ,
                    workspace_id=owner_id,
                ):
                    raise self._not_found()
            else:
                # 无 workspace 过滤：可见域 = 本人上传 OR 有 WORKSPACE_READ 的 workspace 归属。
                allowed = await allowed_workspace_ids(
                    self._session, user_id=user.id, permission=Permission.WORKSPACE_READ
                )
                domain = or_(
                    File.uploaded_by == user.id,
                    and_(
                        File.owner_type == "workspace",
                        File.owner_id.in_(allowed) if allowed else false(),
                    ),
                )
                stmt = select(File).where(File.deleted_at.is_(None), domain)
                if owner_type:
                    stmt = stmt.where(File.owner_type == owner_type)
                if uploaded_by is not None:
                    stmt = stmt.where(File.uploaded_by == uploaded_by)
                stmt = stmt.order_by(File.created_at.desc()).limit(min(max(limit, 1), 200))
                rows = (await self._session.execute(stmt)).scalars().all()
                return [FileMetaResp.model_validate(r) for r in rows]

        stmt = select(File).where(File.deleted_at.is_(None))
        if owner_type:
            stmt = stmt.where(File.owner_type == owner_type)
        if owner_id is not None:
            stmt = stmt.where(File.owner_id == owner_id)
        if uploaded_by is not None:
            stmt = stmt.where(File.uploaded_by == uploaded_by)
        stmt = stmt.order_by(File.created_at.desc()).limit(min(max(limit, 1), 200))
        rows = (await self._session.execute(stmt)).scalars().all()
        return [FileMetaResp.model_validate(r) for r in rows]

    async def soft_delete(self, file_id: uuid.UUID, *, user: User) -> None:
        """软删（归属断言后）：置 deleted_at + 同步删存储对象本体。

        第五批 code-quality：原仅置 deleted_at、注释称"对象本体由后续清理流程删除"
        但该清理流程全仓不存在 → MinIO 孤儿单调增长（账单泄漏）。改同步删对象本体
        (best-effort：删失败仅记日志、仍标软删防重复；历史已软删未删的孤儿需一次性
        清理脚本)。顺序：先 commit DB 软删标记，后删 MinIO——若反序 commit 失败会留
        下指向已删对象的 active File（下载 404 损坏功能），故宁可孤儿不可损坏。
        """
        row = await self._get_active_for(file_id, user=user)
        row.deleted_at = datetime.now(UTC)
        await self._session.commit()
        try:
            await self._storage.delete_object(row.stored_key)
        except Exception:
            log.warning(
                "file.soft_delete_storage_failed",
                file_id=str(file_id),
                stored_key=row.stored_key,
            )
