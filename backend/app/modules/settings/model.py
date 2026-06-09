"""Persistent key-value settings stored in ``platform_settings`` table."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Column, DateTime, String, Uuid
from sqlmodel import Field

from app.models.base import BaseModel


class PlatformSetting(BaseModel, table=True):
    __tablename__ = "platform_settings"
    __table_args__ = ()

    key: str = Field(
        sa_column=Column(String(100), primary_key=True, nullable=False),
    )
    value: str = Field(sa_column=Column(String, nullable=False))
    updated_by: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(Uuid(as_uuid=True), nullable=True),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
