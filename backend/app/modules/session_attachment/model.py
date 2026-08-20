"""session_attachment 模块 — 会话附件元数据模型。

SessionAttachment 表存会话附件（图片/文件）的业务元数据，对象本体在 MinIO
（``modules/storage``），键为 ``attachments/{user_id}/{sha256}.{ext}`` 内容寻址
（同 user 同 sha256 复用对象，D-5）。生命周期（design §10）：draft
（``session_id`` NULL，已上传未发送）→ bound（inject 成功回填 ``session_id``），
唯一前进迁移；bound 后不可删不可变更，draft 48h 未发送由清理任务删行（对象保留）。

列定义须与 ``migrations/versions/20260820100000_session_attachments_multimodal.py``
一一对应（防漂移）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Uuid,
    text,
)
from sqlmodel import Field

from app.models.base import BaseModel


class SessionAttachment(BaseModel, table=True):
    """会话附件元数据行（design §4 / FR-1 / FR-3）。

    - ``session_id`` NULL = 草稿未发送；不加非空约束（发送时回填）。
    - FK ``SET NULL``：会话硬删时附件行保留（D-8 生命周期独立于会话删除）。
    - ``object_key`` 不加 unique：同 sha256 复用对象，多行共享同一键（D-5）。
    - ``width``/``height`` 仅 kind=image 有值（图片专用，文件为 NULL）。
    """

    __tablename__ = "session_attachments"
    __table_args__ = (
        Index("ix_session_attachments_user_session", "user_id", "session_id"),
        Index("ix_session_attachments_session", "session_id"),
    )

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    user_id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        description="归属用户 id（上传者）。",
    )
    session_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("agent_sessions.id", ondelete="SET NULL"),
            nullable=True,
        ),
        description="绑定会话 id；NULL = 草稿未发送（design §10）。",
    )
    kind: str = Field(
        sa_column=Column(String(16), nullable=False),
        description="附件类型：image | file。",
    )
    media_type: str = Field(
        sa_column=Column(String(128), nullable=False),
        description="MIME 类型（上传时 magic 校验后的真实值）。",
    )
    bytes: int = Field(
        sa_column=Column(BigInteger, nullable=False),
        description="文件大小（字节）。",
    )
    name: str = Field(
        sa_column=Column(String(255), nullable=False),
        description="展示名（已剥本地路径）。",
    )
    object_key: str = Field(
        sa_column=Column(String(255), nullable=False),
        description="对象存储键 attachments/{user_id}/{sha256}.{ext}（内容寻址）。",
    )
    sha256: str = Field(
        sa_column=Column(String(64), nullable=False),
        description="内容摘要（去重复用与 ETag 来源）。",
    )
    width: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
        description="图片宽度（像素）；仅 kind=image 有值。",
    )
    height: int | None = Field(
        default=None,
        sa_column=Column(Integer, nullable=True),
        description="图片高度（像素）；仅 kind=image 有值。",
    )
    created_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
