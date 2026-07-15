"""workbench 子域 Pydantic DTO。

字段对齐 ``design.md`` §7 (workbench 聚合子域)。
所有响应模型为纯产出型 DTO (无 ORM 映射),无需 ``from_attributes``。
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel as PydanticModel

# ---------------------------------------------------------------------------
# Profile —— 当前登录用户工作台头部信息
# ---------------------------------------------------------------------------


class WorkbenchProfile(PydanticModel):
    """个人工作台头部用户信息。

    ``avatar_text`` 为头像占位文案(取 display_name 首字),其余字段
    允许 ``None`` (来源数据缺失时)。
    """

    display_name: str | None = None
    employee_no: str | None = None
    department_name: str | None = None
    role_name: str | None = None
    avatar_text: str


# ---------------------------------------------------------------------------
# Metrics —— 工作台指标卡片
# ---------------------------------------------------------------------------


class WorkbenchMetrics(PydanticModel):
    """个人工作台指标卡片。"""

    task_count: int
    completion_rate: float
    delay_rate: float
    work_hours: float
    defect_count: int


# ---------------------------------------------------------------------------
# TodoItem —— 待办列表条目
# ---------------------------------------------------------------------------


class WorkbenchTodoItem(PydanticModel):
    """待办列表条目。

    ``type`` 标识来源类型(如 task / problem / work-hour 审批等);
    ``source`` 标识来源子系统标识(用于前端跳转回源)。
    """

    id: str
    name: str
    type: str
    source: str


# ---------------------------------------------------------------------------
# Summary —— 指标 + 待办聚合
# ---------------------------------------------------------------------------


class WorkbenchSummary(PydanticModel):
    """个人工作台聚合视图:指标卡片 + 待办列表。"""

    metrics: WorkbenchMetrics
    todos: list[WorkbenchTodoItem]


# ---------------------------------------------------------------------------
# Calendar —— 月度日历负载
# ---------------------------------------------------------------------------


class CalendarPlanItem(PydanticModel):
    """日历当日计划任务摘要(区间覆盖该天的 PlanTask)。"""

    id: str
    content: str | None = None
    project_name: str | None = None
    status: str | None = None
    start_time: datetime | None = None
    end_time: datetime | None = None


class CalendarProblemItem(PydanticModel):
    """日历当日缺陷摘要(区间覆盖该天的 PpmProblemList)。"""

    id: str
    pro_desc: str | None = None
    project_name: str | None = None
    status: str | None = None


class CalendarExecuteItem(PydanticModel):
    """日历当日实际执行摘要(actual 覆盖该天的 TaskExecute,所有状态)。"""

    id: str
    content: str | None = None
    status: str | None = None
    time_spent: float | None = None


class CalendarDay(PydanticModel):
    """日历单日(左点负载/右点进度 + 当日三类详情)。

    ``date`` 形如 ``YYYY-MM-DD``;``load_level`` (左点负载 none/leisure/full/over)
    与 ``alert_level`` (右点进度 none/green/yellow/red) 为分级文案。
    ``plan_items`` / ``problem_items`` / ``execute_items`` 为当日覆盖的三类摘要,
    供前端点击该天时展开 (D-009)。
    """

    date: str
    load_level: str
    alert_level: str
    task_count: int
    plan_items: list[CalendarPlanItem] = []
    problem_items: list[CalendarProblemItem] = []
    execute_items: list[CalendarExecuteItem] = []


class WorkbenchCalendar(PydanticModel):
    """个人工作台月度日历。"""

    year_month: str
    days: list[CalendarDay]


__all__ = [
    "CalendarDay",
    "CalendarExecuteItem",
    "CalendarPlanItem",
    "CalendarProblemItem",
    "WorkbenchCalendar",
    "WorkbenchMetrics",
    "WorkbenchProfile",
    "WorkbenchSummary",
    "WorkbenchTodoItem",
]
