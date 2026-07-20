"""workbench 子域 service —— 个人工作台聚合数据。

设计依据:``design.md`` §7 (workbench 聚合子域)。
三个 getter 方法分别装配 profile / summary / calendar,均为纯只读聚合
(不新建表、不写表,D-impl 新接口只读)。
"""

from __future__ import annotations

import calendar as _calendar
import re
import uuid
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.admin.model import Organization, UserOrganization
from app.modules.auth.model import User
from app.modules.auth.rbac import list_user_workspace_roles
from app.modules.ppm.problem.model import PpmProblemChange, PpmProblemList
from app.modules.ppm.task.model import PlanTask, TaskExecute
from app.modules.ppm.workbench.schema import (
    CalendarDay,
    CalendarExecuteItem,
    CalendarPlanItem,
    CalendarProblemItem,
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


def _sum_actual_hours(
    rows: list[TaskExecute],
    year: int,
    month: int,
    today: date,
) -> dict[int, float]:
    """过去侧 (D-001 求和, 推翻 07-15 平摊): ``TaskExecute`` 实际工时
    (``time_spent`` 人天) ``× 8`` 直接累加到 actual 区间覆盖、落在 ``(year, month)``
    且 ``< today`` 的日历日(不平摊;跨多天记录覆盖日全计入)。

    返回 ``{day_of_month: hours}``。``time_spent × 8`` 转小时、``None → 0`` 跳过;
    区间覆盖复用 ``_covers_date`` 三档兜底(双端/单端/都无→跳过)。
    历史 migration 跨天数据求和后可能虚高饱和(规则11, 用户确认接受)。
    """
    daily: dict[int, float] = {}
    days_in_month = _calendar.monthrange(year, month)[1]
    for ex in rows:
        hours = float(ex.time_spent or 0.0) * 8.0
        if hours <= 0:
            continue
        # 仅遍历该 execute 覆盖的当月日 (O(Σ覆盖天数), 替代逐天 _covers_date 的 O(executes×31))
        for day in _covered_days_in_month(
            ex.actual_start_time, ex.actual_end_time, year, month, days_in_month
        ):
            if date(year, month, day) < today:
                daily[day] = daily.get(day, 0.0) + hours
    return daily


def _spread_remaining_hours(
    plan_tasks: list[PlanTask],
    spent_by_plan: dict[uuid.UUID, float],
    year: int,
    month: int,
    today: date,
) -> dict[int, float]:
    """未来侧 (D-007):未完成任务的剩余负载 ``(计划总量 − 已用) / 剩余天数`` 摊到
    当月 ``≥ today`` 的日历日。返回 ``{day_of_month: hours}``。

    兜底:``work_load`` 空 → 跳过 (R-06);``end_time`` 为 None 或区间已过期
    (``< today``) → 跳过 (R-05);已用 ≥ 计划 → 剩余 0 跳过 (D-007)。
    剩余天数区间 = ``[max(today, start), end]``,日均 = ``剩余人天 × 8 / 剩余天数``。
    """
    daily: dict[int, float] = {}
    for p in plan_tasks:
        total_hours = _parse_workload_hours(p.work_load)
        if total_hours <= 0:
            continue
        spent_days = float(spent_by_plan.get(p.id, 0.0) or 0.0)
        remaining_days = total_hours / 8.0 - spent_days
        if remaining_days <= 0:
            continue
        if p.end_time is None:
            continue
        end_date = _to_aware(p.end_time).date()
        start_date = _to_aware(p.start_time).date() if p.start_time is not None else end_date
        lower = max(today, start_date)
        if end_date < lower:
            continue
        span = (end_date - lower).days + 1
        per_day_hours = remaining_days * 8.0 / span
        if per_day_hours <= 0:
            continue
        cur = lower
        while cur <= end_date:
            if cur.year == year and cur.month == month and cur >= today:
                daily[cur.day] = daily.get(cur.day, 0.0) + per_day_hours
            cur += timedelta(days=1)
    return daily


# 右点进度严重度排序 (D-008): red(延期) > yellow(临期) > green(正常) > none
_ALERT_SEVERITY_PROGRESS = {"none": 0, "green": 1, "yellow": 2, "red": 3}


def _covers_date(start_dt: datetime | None, end_dt: datetime | None, day: date) -> bool:
    """区间 [start, end] 是否含 day (三档兜底,与 actual/计划/缺陷区间覆盖同构)。

    双端有 → ``s <= day <= e``;仅一端 → ``== 该端``;都无 → False。
    """
    s = _to_aware(start_dt).date() if start_dt is not None else None
    e = _to_aware(end_dt).date() if end_dt is not None else None
    if s is not None and e is not None:
        return s <= day <= e
    if s is not None:
        return s == day
    if e is not None:
        return e == day
    return False


def _progress_alert(
    start_dt: datetime | None,
    end_dt: datetime | None,
    is_completed: bool,
    work_load: str | None,
    spent_days: float,
    day: date,
    today: date,
) -> str | None:
    """单任务/缺陷对某天的右点进度贡献 (D-008): red / yellow / green / None。

    - 无 end → None
    - 已完成: 覆盖 → green (用户规则: 过去有任务覆盖就标绿,不论完成状态)
    - 延期 (end < today 未完成): ``day == 截止日`` → red;覆盖 → green
    - 未到截止: ``day == today`` 且覆盖 → 临期判定 (剩余/剩余天数 > 8h/天 → yellow,
      否则 green);非今天但覆盖 → green;不覆盖 → None
    """
    if end_dt is None:
        return None
    end_date = _to_aware(end_dt).date()
    start_date = _to_aware(start_dt).date() if start_dt is not None else end_date
    covers = start_date <= day <= end_date
    if is_completed:
        return "green" if covers else None
    if end_date < today:
        if day == end_date:
            return "red"
        return "green" if covers else None
    if day == today:
        if not covers:
            return None
        total_hours = _parse_workload_hours(work_load)
        remaining_days = total_hours / 8.0 - float(spent_days or 0.0)
        lower = today if start_date < today else start_date
        if end_date >= lower:
            span = (end_date - lower).days + 1
            if span > 0 and remaining_days * 8.0 / span > 8.0:
                return "yellow"
        return "green"
    return "green" if covers else None


def _worst_alert(alerts: list[str | None]) -> str:
    """取最严重的进度状态 (red > yellow > green > none)。"""
    level = 0
    result = "none"
    for a in alerts:
        sev = _ALERT_SEVERITY_PROGRESS.get(a or "none", 0)
        if sev > level:
            level = sev
            result = a
    return result


def _covered_days_in_month(
    start_dt: datetime | None,
    end_dt: datetime | None,
    year: int,
    month: int,
    days_in_month: int,
) -> list[int]:
    """记录区间按 :func:`_covers_date` 三档逻辑,返回落在 ``(year, month)`` 的日序号列表。

    双端 → ``[s, e]`` 与当月相交日;仅 start → ``[s]``(若在当月);仅 end → ``[e]``(若在当月);
    都无 → ``[]``。用于按日预分桶详情 items,把主循环的逐天遍历全部记录(O(31×N))降为
    按记录摊到其覆盖日(O(Σ覆盖天数))。与逐天调 ``_covers_date`` 完全等价。
    """
    s = _to_aware(start_dt).date() if start_dt is not None else None
    e = _to_aware(end_dt).date() if end_dt is not None else None
    month_first = date(year, month, 1)
    month_last = date(year, month, days_in_month)
    if s is not None and e is not None:
        days: list[int] = []
        d = max(s, month_first)
        hi = min(e, month_last)
        while d <= hi:
            days.append(d.day)
            d += timedelta(days=1)
        return days
    if s is not None:
        return [s.day] if month_first <= s <= month_last else []
    if e is not None:
        return [e.day] if month_first <= e <= month_last else []
    return []


def _alert_days_in_month(
    start_dt: datetime | None,
    end_dt: datetime | None,
    year: int,
    month: int,
    days_in_month: int,
) -> list[int]:
    """``_progress_alert`` 可能非 None 的当月日序号: 无 end → ``[]``;有 end → ``[start or end, end]``
    与当月相交日。``_progress_alert`` 对今天/截止日的特殊判定(临期 yellow、延期 red)均落在此区间内,
    故仅遍历这些天与逐天全量调用等价。"""
    if end_dt is None:
        return []
    e = _to_aware(end_dt).date()
    s = _to_aware(start_dt).date() if start_dt is not None else e
    month_first = date(year, month, 1)
    month_last = date(year, month, days_in_month)
    days: list[int] = []
    d = max(s, month_first)
    hi = min(e, month_last)
    while d <= hi:
        days.append(d.day)
        d += timedelta(days=1)
    return days


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
        # 区间只按 actual_start_time 过滤(ql-20260720-004):去掉 actual_end_time<end,
        # 进行中(actual_end_time=NULL)与跨月(actual_end_time 在下月)的执行记录不再漏算,
        # 与日历侧 _sum_actual_hours 区间相交口径对齐。
        hours_stmt = select(func.sum(TaskExecute.time_spent)).where(
            TaskExecute.execute_user_id == user.id
        )
        if start is not None and end is not None:
            hours_stmt = hours_stmt.where(TaskExecute.actual_start_time >= start).where(
                TaskExecute.actual_start_time < end
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

        # ① 问题待办:当前处理人(now_handle_user)含我即显示,不限责任人 duty_user_id
        # (duty 是责任人,审批人非责任人时也需看到待办;R-02 Python split 方言安全)
        problem_stmt = select(PpmProblemList)
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
        """装配个人工作台月度日历 (左点负载 D-001~007 + 右点进度 D-008 + 详情 D-009)。

        ``year_month`` 形如 ``YYYY-MM``。

        左点 ``load_level`` (负载,以今天分界,今天归未来侧):
          - 过去 (day < today): 实际工时平摊 (D-001~005)。
          - 今天及未来 (day ≥ today): 未完成任务的剩余负载 (D-007)。

        右点 ``alert_level`` (进度 D-008): 计划任务 + 缺陷两类,按区间覆盖该天取最严重
        (red > yellow > green > none)。延期任务截止日 → red;今天临期 → yellow;
        过去/未来有覆盖 → green;无覆盖 → none。

        详情 (D-009): ``plan_items`` / ``problem_items`` / ``execute_items`` 为当日
        覆盖的三类摘要。
        """
        now = datetime.now(UTC)
        today = _to_aware(now).date()
        year, month = self._parse_year_month(year_month, now)
        days_in_month = _calendar.monthrange(year, month)[1]

        month_start = datetime(year, month, 1, tzinfo=UTC)
        next_month_start = datetime(year + (month // 12), (month % 12) + 1, 1, tzinfo=UTC)

        # 计划任务:区间与当月相交 (user_id=me)
        plans = (
            (
                await self._session.execute(
                    select(PlanTask).where(
                        PlanTask.user_id == user.id,
                        PlanTask.start_time.is_not(None),
                        PlanTask.start_time < next_month_start,
                        or_(PlanTask.end_time.is_(None), PlanTask.end_time >= month_start),
                    )
                )
            )
            .scalars()
            .all()
        )

        # 缺陷:区间与当月相交 (duty_user_id=me)
        problems = (
            (
                await self._session.execute(
                    select(PpmProblemList).where(
                        PpmProblemList.duty_user_id == user.id,
                        PpmProblemList.plan_start_time.is_not(None),
                        PpmProblemList.plan_start_time < next_month_start,
                        or_(
                            PpmProblemList.plan_end_time.is_(None),
                            PpmProblemList.plan_end_time >= month_start,
                        ),
                    )
                )
            )
            .scalars()
            .all()
        )

        # 实际执行 (execute_user_id=me): 只拉与当月区间相交的记录 (CPU 优化, 少拉少循环)。
        # ``_covers_date`` 三档"至少覆盖当月一天"反推为 SQL: 双端相交 / 单 start 在当月 / 单 end 在当月。
        executes = (
            (
                await self._session.execute(
                    select(TaskExecute).where(
                        TaskExecute.execute_user_id == user.id,
                        or_(
                            and_(
                                TaskExecute.actual_start_time.is_not(None),
                                TaskExecute.actual_start_time < next_month_start,
                                or_(
                                    TaskExecute.actual_end_time.is_(None),
                                    TaskExecute.actual_end_time >= month_start,
                                ),
                            ),
                            and_(
                                TaskExecute.actual_start_time.is_(None),
                                TaskExecute.actual_end_time.is_not(None),
                                TaskExecute.actual_end_time >= month_start,
                                TaskExecute.actual_end_time < next_month_start,
                            ),
                        ),
                    )
                )
            )
            .scalars()
            .all()
        )

        # 已用工时聚合 (by plan_task_id): 未来剩余负载 + 临期判定。须全量累计
        # (不能只算当月, 否则剩余负载/临期失真), 故用单独聚合查询而非遍历当月 executes。
        spent_rows = (
            await self._session.execute(
                select(TaskExecute.plan_task_id, func.sum(TaskExecute.time_spent))
                .where(TaskExecute.execute_user_id == user.id)
                .group_by(TaskExecute.plan_task_id)
            )
        ).all()
        spent_by_plan: dict[uuid.UUID, float] = {
            pid: float(total or 0.0) for pid, total in spent_rows if pid is not None
        }

        # 实际执行关联的计划任务名 (execute_items.content),单独查避免依赖 relationship
        exec_plan_ids = {ex.plan_task_id for ex in executes if ex.plan_task_id is not None}
        plan_content_map: dict[uuid.UUID, str | None] = {}
        if exec_plan_ids:
            pc_rows = (
                await self._session.execute(
                    select(PlanTask.id, PlanTask.content).where(PlanTask.id.in_(exec_plan_ids))
                )
            ).all()
            plan_content_map = {pid: content for pid, content in pc_rows}

        # 左点:过去 actual 平摊 (D-001~005)
        daily_actual = _sum_actual_hours(executes, year, month, today)
        # 左点:未来剩余负载 (D-007)。未完成 + end>=today 的 plans 子集
        future_plans = [
            p
            for p in plans
            if p.status != "已完成"
            and p.end_time is not None
            and _to_aware(p.end_time).date() >= today
        ]
        daily_remaining = _spread_remaining_hours(future_plans, spent_by_plan, year, month, today)

        # 预分桶 (O(Σ覆盖天数), 替代原逐天遍历全部记录的 O(31×N), 降单请求 CPU):
        # 把"每天遍历所有记录"改成"每条记录摊到它覆盖的几天", 单 worker 并发时不再互相挤占。
        # task_count: plan start_time 当月落点计数 (现状口径保留)
        count_by_day: dict[int, int] = {}
        for p in plans:
            if p.start_time is not None:
                ps = _to_aware(p.start_time)
                if ps.year == year and ps.month == month:
                    count_by_day[ps.day] = count_by_day.get(ps.day, 0) + 1

        # 右点 alert: 每条记录摊到其 _progress_alert 覆盖的当月日, 取最严重 (D-008)
        alert_by_day: dict[int, str] = {}

        def _bump_alert(day: int, a: str | None) -> None:
            sev = _ALERT_SEVERITY_PROGRESS.get(a or "none", 0)
            if sev > _ALERT_SEVERITY_PROGRESS.get(alert_by_day.get(day, "none"), 0):
                alert_by_day[day] = a or "none"

        for p in plans:
            for day in _alert_days_in_month(p.start_time, p.end_time, year, month, days_in_month):
                _bump_alert(
                    day,
                    _progress_alert(
                        p.start_time,
                        p.end_time,
                        p.status == "已完成",
                        p.work_load,
                        spent_by_plan.get(p.id, 0.0),
                        date(year, month, day),
                        today,
                    ),
                )
        for prob in problems:
            for day in _alert_days_in_month(
                prob.plan_start_time, prob.plan_end_time, year, month, days_in_month
            ):
                _bump_alert(
                    day,
                    _progress_alert(
                        prob.plan_start_time,
                        prob.plan_end_time,
                        prob.status == "4",
                        prob.work_load,
                        float(prob.time_spent or 0.0),
                        date(year, month, day),
                        today,
                    ),
                )

        # 详情三类 (D-009): 按 _covers_date 覆盖日分桶
        plan_items_by_day: dict[int, list[CalendarPlanItem]] = {}
        for p in plans:
            for day in _covered_days_in_month(p.start_time, p.end_time, year, month, days_in_month):
                plan_items_by_day.setdefault(day, []).append(
                    CalendarPlanItem(
                        id=str(p.id),
                        content=p.content,
                        project_name=p.project_name,
                        status=p.status,
                        start_time=p.start_time,
                        end_time=p.end_time,
                    )
                )
        problem_items_by_day: dict[int, list[CalendarProblemItem]] = {}
        for prob in problems:
            for day in _covered_days_in_month(
                prob.plan_start_time, prob.plan_end_time, year, month, days_in_month
            ):
                problem_items_by_day.setdefault(day, []).append(
                    CalendarProblemItem(
                        id=str(prob.id),
                        pro_desc=prob.pro_desc,
                        project_name=prob.project_name,
                        status=prob.status,
                    )
                )
        execute_items_by_day: dict[int, list[CalendarExecuteItem]] = {}
        for ex in executes:
            for day in _covered_days_in_month(
                ex.actual_start_time, ex.actual_end_time, year, month, days_in_month
            ):
                execute_items_by_day.setdefault(day, []).append(
                    CalendarExecuteItem(
                        id=str(ex.id),
                        content=plan_content_map.get(ex.plan_task_id) if ex.plan_task_id else None,
                        status=ex.status,
                        time_spent=ex.time_spent,
                    )
                )

        days: list[CalendarDay] = []
        for day in range(1, days_in_month + 1):
            day_date = date(year, month, day)
            # 左点 load:过去→实际,未来→剩余
            if day_date < today:
                load_level = _load_level_workload(daily_actual.get(day, 0.0))
            else:
                load_level = _load_level_workload(daily_remaining.get(day, 0.0))
            days.append(
                CalendarDay(
                    date=f"{year_month}-{day:02d}",
                    task_count=count_by_day.get(day, 0),
                    load_level=load_level,
                    alert_level=alert_by_day.get(day, "none"),
                    plan_items=plan_items_by_day.get(day, []),
                    problem_items=problem_items_by_day.get(day, []),
                    execute_items=execute_items_by_day.get(day, []),
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
