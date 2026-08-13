"""``platform_change_progress`` table — SillySpec 进度同步层聚合存储。

Schema 对齐 design §8.1/§8.2 + 跨仓契约 ``sillyhub-progress-sync-contract.md`` §3/§4.2。
存客户端 ``serializeForSync`` 裸六表 JSON 投影 + 元字段，按 ``(workspace_id, change_name)``
复合唯一约束在 workspace 内聚合（D-001@v1；change_name 由全局聚合改为 workspace 内聚合）。

Change 2026-08-11-change-progress-projection task-02：加 ``workspace_id`` 列 + 复合唯一约束，
为收件箱 workspace 隔离（task-06/07）与变更中心实时投影（task-08）提供数据基础。

约束取 nullable + 复合唯一约束（非复合 PK）：design §9 要求 shk_live_ 过渡期
``workspace_id=None`` 可写（投影 join 不命中走 fallback）。复合 PK 列在 SQL 不允许 NULL，
会阻断过渡期写入，故 model 与 task-03 migration 统一用「nullable 列 + 复合唯一约束」
（唯一约束允许多 NULL，老行/过渡期 NULL 安全）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Column,
    DateTime,
    ForeignKey,
    String,
    UniqueConstraint,
    Uuid,
    text,
)
from sqlmodel import Field

from app.models.base import BaseModel


class PlatformChangeProgressORM(BaseModel, table=True):
    """workspace 级 change 进度聚合行（design §8.2 / D-001@v1）。

    ``latest_progress`` 按裸 JSON 透传 serializeForSync 六表（NG-6 不强类型化）。
    ``last_pushed_at`` / ``last_pusher`` 用 String 而非 DateTime：契约 §7 明确
    base_ts 比对用 ISO 8601 UTC **字符串字典序**，存客户端
    ``X-SillySpec-Pushed-At`` 原值避免读写时区/精度转换（R-04 前提）。
    ``updated_at`` 是服务端落库审计字段（非比对基准），用 timezone-aware DateTime。

    ``(workspace_id, change_name)`` 复合唯一约束：同一 workspace 内 change_name 唯一，
    不同 workspace 各占一行（D-001@v1 收件箱隔离）；workspace 删则级联删其下进度行。
    ``workspace_id`` nullable：shk_live_ 过渡期 None 行可写（design §9），投影 join 不命中
    走 fallback。
    ``id`` 独立 UUID 主键（``default=uuid.uuid4``）：change_name 去主键后主键唯一性由 id 保证
    （D-001@v1；change_name 全表唯一 → 同 workspace 内唯一，跨 workspace 同名各占一行）。
    """

    __tablename__ = "platform_change_progress"
    __table_args__ = (
        UniqueConstraint(
            "workspace_id",
            "change_name",
            name="uq_platform_change_progress_workspace_change",
        ),
    )

    id: uuid.UUID = Field(
        sa_column=Column(
            Uuid(as_uuid=True),
            primary_key=True,
            nullable=False,
            default=uuid.uuid4,
        ),
    )
    workspace_id: uuid.UUID | None = Field(
        default=None,
        sa_column=Column(
            Uuid(as_uuid=True),
            ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=True,
        ),
    )
    change_name: str = Field(
        sa_column=Column(String, nullable=False),
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
