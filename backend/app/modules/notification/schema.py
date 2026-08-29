"""Pydantic DTOs for the notification module（task-07 / design §7.2）.

字段契约由 task-09/10（前端数据层）经 openapi.json 消费，字段名
逐字对齐 tasks/task-07.md provides：NotificationRead / NotificationListResponse
/ UnreadCountResponse / ReadAllResponse。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.modules.notification.model import Notification


class NotificationRead(BaseModel):
    """单条通知视图（仅本人可见字段，不含 recipient_user_id / dedupe_key）。"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    workspace_id: uuid.UUID
    type: str
    title: str
    body: str | None = None
    link: str | None = None
    ref_type: str | None = None
    ref_id: str | None = None
    read_at: datetime | None = None
    created_at: datetime


class NotificationListResponse(BaseModel):
    """列表分页响应（total 为本人（可选未读过滤后）总数）。"""

    items: list[NotificationRead] = Field(default_factory=list)
    total: int


class UnreadCountResponse(BaseModel):
    """未读数（铃铛徽标轮询/首载）。"""

    count: int


class ReadAllResponse(BaseModel):
    """全部已读响应（更新行数）。"""

    updated: int


def to_notification_read(row: Notification) -> NotificationRead:
    """ORM 行 → DTO（显式转换点，from_attributes 兜底）。"""
    return NotificationRead.model_validate(row)
