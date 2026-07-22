"""file 模块 — 平台级文件中心元数据模型。

File 表存对象存储（MinIO）中文件的业务元数据，PPM 各 ``file_urls`` 字段
改存本表 id（D-006）。``owner_type``/``owner_id`` 是多态归属（D-004/D-008）：
新建场景先上传后绑定（owner_id 可空），编辑场景由前端传入。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import BigInteger, Column, DateTime, Index, String, Uuid
from sqlmodel import Field

from app.models.base import BaseModel


def _now() -> datetime:
    """统一时间戳工厂 (带 UTC tz)。"""
    return datetime.now(UTC)


class File(BaseModel, table=True):
    """文件元数据 —— 平台级文件中心核心实体（D-004）。

    - ``stored_key``：对象存储键（日期分桶 + uuid，非文件原名，避免覆盖）。
    - ``owner_type``：归属对象类型（如 ppm_problem / ppm_plan_task / ppm_task_execute）。
    - ``owner_id``：归属对象 id，可空（D-008 新建场景先上传后绑定）。
    - ``deleted_at``：软删标记，非空即视为已删。
    """

    __tablename__ = "file"
    __table_args__ = (
        Index("ix_file_uploaded_by", "uploaded_by"),
        Index("ix_file_owner", "owner_type", "owner_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    owner_type: str = Field(
        sa_column=Column(String(64), nullable=False),
        description="归属对象类型（ppm_problem 等）。",
    )
    owner_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
        description="归属对象 id，新建场景可空（先上传后绑定，D-008）。",
    )
    original_name: str = Field(
        sa_column=Column(String(255), nullable=False),
        description="用户上传时的原始文件名（回显用）。",
    )
    stored_key: str = Field(
        sa_column=Column(String(255), nullable=False, unique=True),
        description="对象存储键（日期分桶 + uuid，唯一）。",
    )
    mime_type: str = Field(
        sa_column=Column(String(128), nullable=False),
        description="MIME 类型（图片/文件区分、Content-Disposition 判定，D-009）。",
    )
    size: int = Field(
        sa_column=Column(BigInteger, nullable=False),
        description="文件大小（字节）。",
    )
    uploaded_by: uuid.UUID = Field(
        sa_column=Column(Uuid(as_uuid=True), nullable=False),
        description="上传者 user id（当前 JWT 用户）。",
    )
    created_at: datetime = Field(
        default_factory=_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    deleted_at: datetime | None = Field(
        default=None,
        sa_column=Column(DateTime(timezone=True), nullable=True),
        description="软删标记；非空即已删（FR-4）。",
    )
