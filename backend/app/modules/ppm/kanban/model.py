"""kanban 子域 ORM 模型 —— 平台级,UUID 主键,无 tenant_id (D-011@v1)。

两张新表对齐源看板 ``TaskDetailDrawer`` 的评论 / 子任务 / 附件功能
(源无独立表,本项目为对齐新建):

- ``PpmKanbanComment`` ↔ ``ppm_kanban_comment`` (任务评论)
- ``PpmKanbanSubtask`` ↔ ``ppm_kanban_subtask`` (任务子任务勾选)

注:附件不新建表 —— 复用 ``PlanTask.file_urls`` JSON 字段
(``app.modules.ppm.task.model``),TaskDetailDrawer 直接读 ``task.file_urls``。
task_id 为软关联(指向 ``ppm_plan_task.id``,不加 FK 约束,沿用 task 子域风格)。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from sqlalchemy import Boolean, Column, DateTime, Index, Integer, String, Uuid
from sqlmodel import Field

from app.models.base import BaseModel


def _now() -> datetime:
    """统一的 UTC 时间戳工厂。"""
    return datetime.now(UTC)


class PpmKanbanComment(BaseModel, table=True):
    """任务评论 (``ppm_kanban_comment``)。

    一条评论挂在一个 ``PlanTask`` 下,由某 ``user_id`` 发布;
    ``user_name`` 为冗余姓名(取自 ``project_member`` 快照)。
    """

    __tablename__ = "ppm_kanban_comment"
    __table_args__ = (Index("ix_ppm_kanban_comment_task", "task_id"),)

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    task_id: uuid.UUID = Field(sa_column=Column(Uuid(as_uuid=True), nullable=False))
    user_id: uuid.UUID = Field(sa_column=Column(Uuid(as_uuid=True), nullable=False))
    user_name: str | None = Field(default=None, sa_column=Column(String(100), nullable=True))
    content: str = Field(sa_column=Column(String(2000), nullable=False))
    created_at: datetime = Field(
        default_factory=_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


class PpmKanbanSubtask(BaseModel, table=True):
    """任务子任务 (``ppm_kanban_subtask``)。

    简单 checklist 项:``done`` 为完成标志;``sort_order`` 控制显示顺序。
    FR-01 仅要求勾选(``toggle``),新建/删除留待后续 task。
    """

    __tablename__ = "ppm_kanban_subtask"
    __table_args__ = (Index("ix_ppm_kanban_subtask_task", "task_id"),)

    id: uuid.UUID = Field(
        default_factory=uuid.uuid4,
        sa_column=Column(Uuid(as_uuid=True), primary_key=True, nullable=False),
    )
    task_id: uuid.UUID = Field(sa_column=Column(Uuid(as_uuid=True), nullable=False))
    title: str = Field(sa_column=Column(String(500), nullable=False))
    done: bool = Field(
        default=False,
        sa_column=Column(Boolean, nullable=False, default=False),
    )
    sort_order: int = Field(
        default=0,
        sa_column=Column(Integer, nullable=False, default=0),
    )
    created_at: datetime = Field(
        default_factory=_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=_now,
        sa_column=Column(DateTime(timezone=True), nullable=False),
    )


__all__ = ["PpmKanbanComment", "PpmKanbanSubtask"]
