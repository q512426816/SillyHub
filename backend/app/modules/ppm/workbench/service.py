"""workbench 子域 service —— 个人工作台聚合数据。

设计依据:``design.md`` §7 (workbench 聚合子域)。
三个 getter 方法分别装配 profile / summary / calendar,均为纯只读聚合
(不新建表、不写表,D-impl 新接口只读)。
"""

from __future__ import annotations

import calendar as _calendar
import re
from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.admin.model import Organization, UserOrganization
from app.modules.auth.model import User
from app.modules.auth.rbac import list_user_workspace_roles
from app.modules.ppm.problem.model import PpmProblemChange, PpmProblemList
from app.modules.ppm.task.model import PlanTask, TaskExecute
from app.modules.ppm.workbench.schema import (
    CalendarDay,
    WorkbenchCalendar,
    WorkbenchMetrics,
    WorkbenchProfile,
    WorkbenchSummary,
    WorkbenchTodoItem,
)

# 任务待办取数上限 (top N,§7.2 待办派生)
_TODO_TASK_LIMIT = 20


def _to_aware(dt: datetime) -> datetime:
    """统一为 tz-aware UTC datetime。

    SQLite ``DateTime(timezone=True)`` 存 naive (见 backend-test-sqlite-vs-pg),
    与 tz-aware 比较 TypeError;PG 存 aware 时不改动。naive 视为 UTC。
    """
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt


# 日历 alert(任务进度)严重度排序:延期 > 临期 > 正常 > 无
_ALERT_SEVERITY = {"none": 0, "normal": 1, "late": 2, "over": 3}


def _parse_workload_hours(work_load: str | None) -> float:
    """PlanTask.work_load(计划工时字符串,如 '8h'/'1d'/'0.5d'/'16')解析为小时。

    1d=8h(工作日 8 小时)。无法解析返回 0.0。
    """
    if not work_load:
        return 0.0
    m = re.match(r"^\s*([\d.]+)\s*(h|d|小时|天)?\s*$", work_load.strip(), re.I)
    if not m:
        return 0.0
    try:
        val = float(m.group(1))
    except ValueError:
        return 0.0
    unit = (m.group(2) or "").lower()
    if unit in ("d", "天"):
        return val * 8.0
    return val  # h / 小时 / 无单位 → 按小时


def _task_alert(task: PlanTask, now: datetime) -> str:
    """单任务进度状态: normal(正常) / late(临期) / over(延期)。

    已完成或无截止 → normal。延期: end_time<now 且未完成 → over。临期
    (design 注意事项 2): 周期≤3日 → 截止前 1 天临期(含 1 日任务); 周期>3日
    → 截止前 2 天临期。周期 = (end_time - start_time).days。
    """
    if task.status == "已完成":
        return "normal"
    end_time = task.end_time
    if end_time is None:
        return "normal"
    end_aware = _to_aware(end_time)
    if end_aware < now:
        return "over"
    start_time = task.start_time
    if start_time is not None:
        period_days = (end_aware - _to_aware(start_time)).days
        threshold_days = 1 if period_days <= 3 else 2
        if now >= end_aware - timedelta(days=threshold_days):
            return "late"
    return "normal"


def _load_level_workload(hours: float) -> str:
    """load_level(任务饱和)按当日工时分档(design 注意事项 2):
    0→none(灰无计划) / <8→leisure(黄有空余) / 8-10→full(绿饱和) / >10→over(红过载)。"""
    if hours <= 0:
        return "none"
    if hours < 8:
        return "leisure"
    if hours <= 10:
        return "full"
    return "over"


class WorkbenchService:
    """个人工作台聚合 service。

    注入 ``AsyncSession``,三个 getter 方法分别装配 profile / summary /
    calendar。全部为只读聚合查询,不写任何表。
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ------------------------------------------------------------------
    # profile —— 当前登录用户工作台头部信息
    # ------------------------------------------------------------------

    async def get_profile(self, user: User) -> WorkbenchProfile:
        """装配当前登录用户的头部信息。

        display_name / employee_no 直取 user;部门通过 user_organizations
        JOIN organizations 取首个 active 组织名;role_name 复用
        ``list_user_workspace_roles`` 取首个非空角色名 (D-004@v1);
        avatar_text 永远非空单字 (兜底 '#')。
        """
        # 部门:首个 active 组织名 (user_organizations 表本身无 status,用
        # organizations.status='active' 过滤,R-04 nullable 兜底)
        dept_stmt = (
            select(Organization.name)
            .join(
                UserOrganization,
                UserOrganization.organization_id == Organization.id,
            )
            .where(UserOrganization.user_id == user.id)
            .where(Organization.status == "active")
            .limit(1)
        )
        department_name = await self._session.scalar(dept_stmt)

        # 角色:复用 rbac 查询,取首个非空 role_name (tuple[2])
        ws_roles = await list_user_workspace_roles(self._session, user_id=user.id)
        role_name: str | None = None
        for _wid, _key, name in ws_roles:
            if name:
                role_name = name
                break

        # avatar_text:display_name → username → email → '#' 兜底,取 strip 后首字
        avatar_src = (
            (user.display_name or "").strip()
            or (user.username or "").strip()
            or (user.email or "").strip()
        )
        avatar_text = avatar_src[:1] if avatar_src else "#"

        return WorkbenchProfile(
            display_name=user.display_name,
            # 工号未录时用登录名(username)兜底覆盖,避免前端显示空
            employee_no=user.employee_no or user.username,
            department_name=department_name,
            role_name=role_name,
            avatar_text=avatar_text,
        )

    # ------------------------------------------------------------------
    # summary —— 指标卡片 + 待办列表
    # ------------------------------------------------------------------

    async def get_summary(
        self,
        user: User,
        range: str = "month",
    ) -> WorkbenchSummary:
        """装配个人工作台聚合视图 (指标 + 待办)。

        ``range`` ∈ {'week','month','all'}:统一按 ``PlanTask.start_time``
        区间过滤 (X-001 不依赖 month 字符串字段)。指标分母 = 区间内任务
        总数;defect_count 不受 range 影响。待办只读派生。
        """
        now = datetime.now(UTC)
        start, end = self._range_window(range, now)

        # 区间过滤条件 (range!='all' 才加 start_time 区间,X-001)
        def _apply_range(stmt):
            if start is not None and end is not None:
                stmt = stmt.where(PlanTask.start_time >= start).where(PlanTask.start_time < end)
            return stmt

        # task_count:区间内任务总数 (=分母)
        count_stmt = _apply_range(select(PlanTask).where(PlanTask.user_id == user.id))
        task_count = await self._session.scalar(
            select(func.count()).select_from(count_stmt.subquery())
        )
        task_count = int(task_count or 0)

        # completed:区间内已完成数
        completed_stmt = _apply_range(
            select(PlanTask).where(PlanTask.user_id == user.id).where(PlanTask.status == "已完成")
        )
        completed = await self._session.scalar(
            select(func.count()).select_from(completed_stmt.subquery())
        )
        completed = int(completed or 0)

        # delayed:end_time 非空且早于 now 且未完成 (D-010@v1)
        delayed_stmt = _apply_range(
            select(PlanTask)
            .where(PlanTask.user_id == user.id)
            .where(PlanTask.end_time.is_not(None))
            .where(PlanTask.end_time < now)
            .where(PlanTask.status != "已完成")
        )
        delayed = await self._session.scalar(
            select(func.count()).select_from(delayed_stmt.subquery())
        )
        delayed = int(delayed or 0)

        completion_rate = completed / task_count if task_count else 0.0
        delay_rate = delayed / task_count if task_count else 0.0

        # work_hours:SUM(task_execute.time_spent) where execute_user_id=me,
        # 区间按 actual_start_time/actual_end_time 过滤 (对齐 stat_by_user 口径)
        hours_stmt = select(func.sum(TaskExecute.time_spent)).where(
            TaskExecute.execute_user_id == user.id
        )
        if start is not None and end is not None:
            hours_stmt = hours_stmt.where(TaskExecute.actual_start_time >= start).where(
                TaskExecute.actual_end_time < end
            )
        work_hours_raw = await self._session.scalar(hours_stmt)
        work_hours = float(work_hours_raw) if work_hours_raw is not None else 0.0

        # defect_count:当前人名下未关闭缺陷 (status!='4'),不受 range 影响
        defect_stmt = (
            select(PpmProblemList)
            .where(PpmProblemList.duty_user_id == user.id)
            .where(PpmProblemList.status != "4")
        )
        defect_count = await self._session.scalar(
            select(func.count()).select_from(defect_stmt.subquery())
        )
        defect_count = int(defect_count or 0)

        metrics = WorkbenchMetrics(
            task_count=task_count,
            completion_rate=completion_rate,
            delay_rate=delay_rate,
            work_hours=work_hours,
            defect_count=defect_count,
        )

        # 待办派生
        todos = await self._derive_todos(user)

        return WorkbenchSummary(metrics=metrics, todos=todos)

    async def _derive_todos(self, user: User) -> list[WorkbenchTodoItem]:
        """派生待办列表:① 问题在办 (now_handle_user split 匹配);
        ② 问题变更待审批 (status="1" 审核中 且 now_handle_user 含我);
        ③ 任务待办 (非已完成的 PlanTask)。
        """
        todos: list[WorkbenchTodoItem] = []
        uid_str = str(user.id)

        # ① 问题待办:Python 端 split now_handle_user 匹配 (R-02 方言安全)
        problem_stmt = select(PpmProblemList).where(PpmProblemList.duty_user_id == user.id)
        problem_rows = (await self._session.execute(problem_stmt)).scalars().all()
        for p in problem_rows:
            if p.status == "4":
                continue
            handle_users = (p.now_handle_user or "").split(",")
            if uid_str not in handle_users:
                continue
            todos.append(
                WorkbenchTodoItem(
                    id=str(p.id),
                    name=p.pro_desc or p.project_name or "问题待处理",
                    type="缺陷",
                    source="problem_audit",
                )
            )

        # ② 问题变更待审批:status="1" 审核中 (ProblemChangeStatus.AUDITING,
        # problem/fsm.py) 且 now_handle_user split 含我 (R-02 方言安全,
        # 与问题清单分支同构)
        change_stmt = select(PpmProblemChange).where(PpmProblemChange.status == "1")
        change_rows = (await self._session.execute(change_stmt)).scalars().all()
        for c in change_rows:
            handle_users = (c.now_handle_user or "").split(",")
            if uid_str not in handle_users:
                continue
            todos.append(
                WorkbenchTodoItem(
                    id=str(c.id),
                    name=c.pro_desc or c.project_name or "问题变更待审批",
                    type="缺陷",
                    source="problem_change",
                )
            )

        # ③ 任务待办:非已完成,按 start_time 升序 top N
        task_stmt = (
            select(PlanTask)
            .where(PlanTask.user_id == user.id)
            .where(PlanTask.status != "已完成")
            .order_by(PlanTask.start_time.asc())
            .limit(_TODO_TASK_LIMIT)
        )
        task_rows = (await self._session.execute(task_stmt)).scalars().all()
        for t in task_rows:
            todos.append(
                WorkbenchTodoItem(
                    id=str(t.id),
                    name=t.content or t.project_name or "任务待办",
                    type="任务",
                    source="plan_task",
                )
            )

        return todos

    # ------------------------------------------------------------------
    # calendar —— 月度日历负载
    # ------------------------------------------------------------------

    async def get_calendar(
        self,
        user: User,
        year_month: str,
    ) -> WorkbenchCalendar:
        """装配个人工作台月度日历负载。

        ``year_month`` 形如 ``YYYY-MM``。只计 ``start_time`` 落在该月的任务
        (跨多日任务只计 start_time 当日,X-004 不虚高)。

        左点 load_level(任务饱和,注意事项 2):当日所有任务 work_load(计划工时)
        解析为小时累加,按 _load_level_workload 分档
        (none灰/<8 leisure黄/8-10 full绿/>10 over红)。

        右点 alert_level(任务进度,注意事项 2):当日任务按 _task_alert 取最
        严重状态(none灰无任务/normal绿/late黄临期/over红延期)。当日无任务 →
        load/alert 均 none。
        """
        now = datetime.now(UTC)
        year, month = self._parse_year_month(year_month, now)
        days_in_month = _calendar.monthrange(year, month)[1]

        # 月起止:本地当月 1 日 00:00 ~ 下月 1 日 00:00 (带 tz)
        month_start = datetime(year, month, 1, tzinfo=UTC)
        next_month_start = datetime(year + (month // 12), (month % 12) + 1, 1, tzinfo=UTC)

        # 当月任务:start_time 落在 [month_start, next_month_start)
        stmt = (
            select(PlanTask)
            .where(PlanTask.user_id == user.id)
            .where(PlanTask.start_time >= month_start)
            .where(PlanTask.start_time < next_month_start)
        )
        rows = (await self._session.execute(stmt)).scalars().all()

        # 按 start_time 当日落点:计数 + 工时累加(load) + 进度最严重(alert)
        daily_count: dict[int, int] = {}
        daily_workload: dict[int, float] = {}
        daily_alert: dict[int, str] = {}
        # SQLite DateTime(timezone=True) 存 naive (见 backend-test-sqlite-vs-pg),
        # 与 tz-aware ``now`` 直接比较会 TypeError;统一转 aware 比较。
        now_aware = _to_aware(now)
        for t in rows:
            start_time = t.start_time
            if start_time is None:
                continue
            day = start_time.day
            daily_count[day] = daily_count.get(day, 0) + 1
            daily_workload[day] = daily_workload.get(day, 0.0) + _parse_workload_hours(t.work_load)
            alert = _task_alert(t, now_aware)
            if _ALERT_SEVERITY[alert] > _ALERT_SEVERITY.get(daily_alert.get(day, "none"), 0):
                daily_alert[day] = alert

        days: list[CalendarDay] = []
        for day in range(1, days_in_month + 1):
            count = daily_count.get(day, 0)
            if count == 0:
                load_level = "none"
                alert_level = "none"
            else:
                load_level = _load_level_workload(daily_workload.get(day, 0.0))
                alert_level = daily_alert.get(day, "normal")
            days.append(
                CalendarDay(
                    date=f"{year_month}-{day:02d}",
                    task_count=count,
                    load_level=load_level,
                    alert_level=alert_level,
                )
            )

        return WorkbenchCalendar(year_month=year_month, days=days)

    # ------------------------------------------------------------------
    # helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _parse_year_month(year_month: str, now: datetime) -> tuple[int, int]:
        """解析 'YYYY-MM';非法兜底取当月 (constraints: 不 crash)。"""
        try:
            year_str, month_str = year_month.split("-")
            year = int(year_str)
            month = int(month_str)
            if not (1 <= month <= 12) or year < 1:
                raise ValueError
            return year, month
        except (ValueError, AttributeError):
            return now.year, now.month

    @staticmethod
    def _range_window(range_: str, now: datetime) -> tuple[datetime | None, datetime | None]:
        """计算统计区间 [start, end) (本地带 tz)。

        week=本周一 00:00~下周一 00:00;month=当月 1 日~下月 1 日;
        all=None (不加区间过滤)。
        """
        if range_ == "week":
            # weekday(): 周一=0..周日=6
            monday = now.date() - timedelta(days=now.weekday())
            start = datetime(monday.year, monday.month, monday.day, tzinfo=UTC)
            end = start + timedelta(days=7)
            return start, end
        if range_ == "month":
            start = datetime(now.year, now.month, 1, tzinfo=UTC)
            next_month = now.month % 12 + 1
            next_year = now.year + (now.month // 12)
            end = datetime(next_year, next_month, 1, tzinfo=UTC)
            return start, end
        # all / 未知 → 不加区间
        return None, None


__all__ = ["WorkbenchService"]
