"""``platform_change_progress`` table — SillySpec 进度同步层聚合存储。

Schema 对齐 design §8.1 + 跨仓契约 ``sillyhub-progress-sync-contract.md`` §3/§4.2。
存客户端 ``serializeForSync`` 裸六表 JSON 投影 + 元字段，按 change_name 全局聚合（D-008）。
"""

from __future__ import annotations

from datetime import UTC, datetime

from sqlalchemy import JSON, Column, DateTime, String, text
from sqlmodel import Field

from app.models.base import BaseModel


class PlatformChangeProgressORM(BaseModel, table=True):
    """平台级 change 进度聚合行。

    ``latest_progress`` 按裸 JSON 透传 serializeForSync 六表（NG-6 不强类型化）。
    ``last_pushed_at`` / ``last_pusher`` 用 String 而非 DateTime：契约 §7 明确
    base_ts 比对用 ISO 8601 UTC **字符串字典序**，存客户端
    ``X-SillySpec-Pushed-At`` 原值避免读写时区/精度转换（R-04 前提）。
    ``updated_at`` 是服务端落库审计字段（非比对基准），用 timezone-aware DateTime。
    """

    __tablename__ = "platform_change_progress"

    change_name: str = Field(
        sa_column=Column(String, primary_key=True, nullable=False),
    )
    latest_progress: dict | None = Field(
        default=None,
        sa_column=Column(JSON, nullable=True),
    )
    last_pushed_at: str | None = Field(
        default=None,
        sa_column=Column(String(64), nullable=True),
    )
    last_pusher: str | None = Field(
        default=None,
        sa_column=Column(String(255), nullable=True),
    )
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(UTC),
        sa_column=Column(
            DateTime(timezone=True),
            nullable=False,
            server_default=text("now()"),
        ),
    )
