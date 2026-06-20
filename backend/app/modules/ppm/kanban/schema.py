"""kanban 看板子域 Pydantic schema。

字段对齐源 ``controller/admin/kanban/vo`` 包 (5 个 VO),命名转蛇形:
- ``UserColumnVO`` → :class:`UserColumnVO` (人员列,含任务统计)
- ``TaskCardVO``  → :class:`TaskCardVO`  (任务卡片)
- ``KanbanQueryReqVO`` → :class:`KanbanQueryReq`
- ``TaskAssignReqVO``  → :class:`TaskAssignReq`

X-001 扩展:人员列可按 Organization 分组,额外提供 :class:`OrgGroup`
包装器 (org_id/org_name + members)。
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------------------
# Request
# ---------------------------------------------------------------------------


class KanbanQueryReq(BaseModel):
    """看板查询参数 (源 ``KanbanQueryReqVO``)。

    平台级无 dept,人员范围由 ``project_member`` 决定;X-001 支持
    ``group_by_org=True`` 时按 Organization 折叠人员列。
    """

    user_ids: list[uuid.UUID] | None = Field(
        default=None, description="人员范围 (为空取当前用户可见的全部 project_member)"
    )
    status: str | None = Field(default=None, description="任务状态过滤 (对齐 PlanTask.status)")
    project_id: uuid.UUID | None = Field(default=None, description="项目过滤")
    keyword: str | None = Field(default=None, description="任务标题/内容关键词")
    group_by_org: bool = Field(default=False, description="True 时按 Organization 分组返回 (X-001)")


class TaskAssignReq(BaseModel):
    """分配任务请求 (源 ``TaskAssignReqVO``)。"""

    task_id: uuid.UUID = Field(..., description="任务 ID (PlanTask.id)")
    assignee_id: uuid.UUID = Field(..., description="新负责人 ID (→ PlanTask.user_id)")
    kanban_order: int | None = Field(default=None, description="可选新排序位置")


class TaskReorderReq(BaseModel):
    """拖拽排序请求体 (源 Controller ``reorderTasks`` body)。"""

    user_id: uuid.UUID = Field(..., description="所属人员列 (PlanTask.user_id)")
    task_ids: list[uuid.UUID] = Field(
        ..., description="该列下任务的新顺序 (按数组下标写 kanban_order)"
    )


# ---------------------------------------------------------------------------
# Response
# ---------------------------------------------------------------------------


class UserColumnVO(BaseModel):
    """人员列 (源 ``UserColumnVO``)。

    平台级:``dept_id``/``dept_name`` 语义改为 Organization
    (X-001,字段名沿用 ``dept_*`` 以兼容源 VO 结构)。
    """

    model_config = ConfigDict(from_attributes=True)

    user_id: uuid.UUID
    username: str | None = Field(default=None, description="人员名 (project_member.user_name)")
    avatar: str | None = None
    dept_id: uuid.UUID | None = Field(default=None, description="所属组织 ID (Organization.id)")
    dept_name: str | None = Field(default=None, description="所属组织名")
    task_count: int = Field(default=0, description="该人员当前任务数")
    total_hours: float = Field(default=0, description="该人员任务预估工时合计")
    saturation: int = Field(default=0, description="饱和度 0-100")
    task_ids: list[uuid.UUID] = Field(default_factory=list, description="该人员任务 ID 列表")


class OrgGroup(BaseModel):
    """Organization 分组 (X-001)。"""

    org_id: uuid.UUID | None = Field(default=None, description="组织 ID (None=未分组)")
    org_name: str | None = Field(default=None, description="组织名")
    members: list[UserColumnVO] = Field(default_factory=list)


class TaskCardVO(BaseModel):
    """任务卡片 (源 ``TaskCardVO``)。

    平台级对齐 ``PlanTask`` 字段;源 ``priority``/``progress``/
    ``estimate_hours``/``deadline`` 在 ``PlanTask`` 无直接对应,分别用
    ``work_load``(预估)/``end_time``(截止)/``time_spent``(进度代理)。
    """

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    title: str | None = Field(default=None, description="任务标题 (PlanTask.content)")
    status: str | None = Field(default=None, description="PlanTask.status")
    project_id: uuid.UUID | None = None
    project_name: str | None = None
    user_id: uuid.UUID | None = Field(default=None, description="负责人 ID")
    user_name: str | None = Field(default=None, description="负责人名")
    deadline: datetime | None = Field(default=None, description="截止时间 (PlanTask.end_time)")
    estimate_hours: float | None = Field(
        default=None, description="预估工时 (PlanTask.work_load 字符串解析)"
    )
    kanban_order: int = Field(default=0, description="看板排序")


__all__ = [
    "KanbanQueryReq",
    "OrgGroup",
    "TaskAssignReq",
    "TaskCardVO",
    "TaskReorderReq",
    "UserColumnVO",
]
