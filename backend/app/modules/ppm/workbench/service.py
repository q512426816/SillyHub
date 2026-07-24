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

from fastapi import HTTPException
from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.admin.model import Organization, UserOrganization
from app.modules.admin.organizations_service import _descendant_ids
from app.modules.auth.model import User
from app.modules.auth.rbac import list_user_workspace_roles
from app.modules.ppm.common.crud import Page
from app.modules.ppm.common.data_scope import MANAGER_ROLE_NAMES, is_super_admin
from app.modules.ppm.problem.model import PpmProblemChange, PpmProblemList
from app.modules.ppm.project.model import PpmProjectMember
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
    WorkbenchSwitchableUser,
    WorkbenchTodoItem,
)

# 分页待办单源保护上限 (Grill F2):移除 top20 后防极端用户单源膨胀。
_TODO_SOURCE_LIMIT = 200
# 默认每页条数 (FR-1 待办分页默认 10 条/页)。
_TODO_DEFAULT_PAGE_SIZE = 10

# 可见用户口径常量 (D-002@v1):复用 data_scope.MANAGER_ROLE_NAMES 避免硬编码漂移。
# 部门经理 → Organization 子树;项目/开发/业务经理 → 项目成员。
DEPT_MANAGER_NAME = "部门经理"
PROJECT_MANAGER_NAMES: frozenset[str] = MANAGER_ROLE_NAMES - {DEPT_MANAGER_NAME}


def _split_roles(role_name: str | None) -> set[str]:
    """逗号拼接角色名 → 去空 trimmed 集合(对齐 data_scope 拆分口径)。"""
    return {s.strip() for s in (role_name or "").split(",") if s.strip()}


def _to_aware(dt: datetime) -> datetime:
    """统一为 tz-aware UTC datetime。

    SQLite ``DateTime(timezone=True)`` 存 naive (见 backend-test-sqlite-vs-pg),
    与 tz-aware 比较 TypeError;PG 存 aware 时不改动。naive 视为 UTC。
    """
    if dt.tzinfo is None:
        return dt.replace(tzinfo=UTC)
    return dt


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

    async def get_profile(self, actor: User, target: User) -> WorkbenchProfile:
        """装配工作台头部信息。

        数据取自 ``target``(切换用户时为目标人,否则=登录人);``can_view_others``
        反映 ``actor``(登录人)是否可切换查看他人(经理 ‖ super_admin,D-005@v1)。

        display_name / employee_no 直取 target;部门通过 user_organizations
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
            .where(UserOrganization.user_id == target.id)
            .where(Organization.status == "active")
            .limit(1)
        )
        department_name = await self._session.scalar(dept_stmt)

        # 角色:复用 rbac 查询,取首个非空 role_name (tuple[2])
        ws_roles = await list_user_workspace_roles(self._session, user_id=target.id)
        role_name: str | None = None
        for _wid, _key, name in ws_roles:
            if name:
                role_name = name
                break

        # avatar_text:display_name → username → email → '#' 兜底,取 strip 后首字
        avatar_src = (
            (target.display_name or "").strip()
            or (target.username or "").strip()
            or (target.email or "").strip()
        )
        avatar_text = avatar_src[:1] if avatar_src else "#"

        # can_view_others:登录人(actor)能力,与 target 无关
        can_view_others = await self._can_view_others(actor)

        return WorkbenchProfile(
            display_name=target.display_name,
            # 工号未录时用登录名(username)兜底覆盖,避免前端显示空
            employee_no=target.employee_no or target.username,
            department_name=department_name,
            role_name=role_name,
            avatar_text=avatar_text,
            can_view_others=can_view_others,
        )

    # ------------------------------------------------------------------
    # summary —— 指标卡片 + 待办列表
    # ------------------------------------------------------------------

    async def get_summary(
        self,
        target: User,
        range: str = "month",
    ) -> WorkbenchSummary:
        """装配个人工作台指标聚合 (待办已移至 /workbench/todos,D-003@v1)。

        数据取自 ``target``(切换用户时为目标人)。``range`` ∈ {'week','month',
        'all'}:统一按 ``PlanTask.start_time`` 区间过滤 (X-001 不依赖 month 字符串
        字段)。指标分母 = 区间内任务总数;defect_count 不受 range 影响。
        """
        now = datetime.now(UTC)
        start, end = self._range_window(range, now)

        # 区间过滤条件 (range!='all' 才加 start_time 区间,X-001)
        def _apply_range(stmt):
            if start is not None and end is not None:
                stmt = stmt.where(PlanTask.start_time >= start).where(PlanTask.start_time < end)
            return stmt

        # 指标一次聚合 (性能优化 Wave 2 / E5-3:原 3 条 count roundtrip 合并为 1 条
        # 条件聚合,配合 ix_ppm_plan_task_user_status 索引一次命中)。case 通用方言
        # (SQLite/PG),比 PG FILTER 可移植。口径与原 task_count/completed/delayed
        # 完全一致:total=区间内任务数;completed=status 已完成;delayed=end_time<now
        # 且未完成 (D-010@v1)。
        plan_agg = _apply_range(
            select(
                func.count().label("total"),
                func.sum(case((PlanTask.status == "已完成", 1), else_=0)).label("completed"),
                func.sum(
                    case(
                        (
                            and_(
                                PlanTask.end_time.is_not(None),
                                PlanTask.end_time < now,
                                PlanTask.status != "已完成",
                            ),
                            1,
                        ),
                        else_=0,
                    )
                ).label("delayed"),
            ).where(PlanTask.user_id == target.id)
        )
        row = (await self._session.execute(plan_agg)).one()
        task_count = int(row.total or 0)
        completed = int(row.completed or 0)
        delayed = int(row.delayed or 0)

        completion_rate = completed / task_count if task_count else 0.0
        delay_rate = delayed / task_count if task_count else 0.0

        # work_hours:SUM(task_execute.time_spent) where execute_user_id=me,
        # 区间只按 actual_start_time 过滤(ql-20260720-004):去掉 actual_end_time<end,
        # 进行中(actual_end_time=NULL)与跨月(actual_end_time 在下月)的执行记录不再漏算,
        # 与日历侧 _sum_actual_hours 区间相交口径对齐。
        hours_stmt = select(func.sum(TaskExecute.time_spent)).where(
            TaskExecute.execute_user_id == target.id
        )
        if start is not None and end is not None:
            hours_stmt = hours_stmt.where(TaskExecute.actual_start_time >= start).where(
                TaskExecute.actual_start_time < end
            )
        work_hours_raw = await self._session.scalar(hours_stmt)
        work_hours = float(work_hours_raw) if work_hours_raw is not None else 0.0

        # defect_count:当前人名下未完成缺陷 (status!='已完成'),不受 range 影响。
        # 3 态简化后 status 为中文 (新建/进行中/已完成,见 problem.fsm.ProblemStatus),
        # 已完成=终态不计 (ql-20260721-002 修复:原 'status!="4"' 为旧数字码,3 态后永真致已完成也被统计)。
        # 口径 (ql-20260721-003 用户确认):我负责 (duty_user_id=我) 或 我处理
        # (now_handle_user 逗号分隔含我) 任一即算"我的缺陷",与待办列表口径对齐
        # (原仅 duty_user_id=我,审批人/处理人非责任人时漏统计,致"缺陷数量"偏少)。
        # now_handle_user 精确 token 匹配 (性能优化 Wave 2 / E5-6:原裸 like
        # "%{uid}%" 有 UUID 前缀碰撞过计风险——改 concat(',',..,',') like '%,uid,%'
        # 精确匹配,与 data_scope.problem_scope_clause 口径一致)。
        defect_handle = func.concat(",", func.coalesce(PpmProblemList.now_handle_user, ""), ",")
        defect_stmt = (
            select(PpmProblemList)
            .where(PpmProblemList.status != "已完成")
            .where(
                or_(
                    PpmProblemList.duty_user_id == target.id,
                    defect_handle.like(f"%,{target.id},%"),
                )
            )
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

        # 待办已移至独立分页端点 GET /workbench/todos (D-003@v1 职责瘦身)。
        return WorkbenchSummary(metrics=metrics)

    async def _derive_todos(self, target: User) -> list[WorkbenchTodoItem]:
        """派生待办列表(全量有序,供 get_todos 分页切片):① 问题在办
        (now_handle_user split 匹配);② 问题变更待审批 (status="1" 审核中 且
        now_handle_user 含我);③ 任务待办 (非已完成的 PlanTask)。

        顺序稳定:问题 → 变更 → 任务(任务内按 start_time 升序)。
        """
        todos: list[WorkbenchTodoItem] = []
        uid_str = str(target.id)

        # ① 问题待办:当前处理人(now_handle_user)含我即显示,不限责任人 duty_user_id
        # (duty 是责任人,审批人非责任人时也需看到待办)。
        # 性能优化 Wave 2 / E5-1:原 select(PpmProblemList) 无 where 全表拉取后
        # Python 过滤,改 SQL where 下推(status != 已完成 + now_handle_user 精确
        # token 含我),走索引消除全表扫描。精确 token 用 concat(',',..,',')
        # like '%,uid,%',与原 Python split 语义一致(防 UUID 子串误匹配)。
        uid_csv = f"%,{uid_str},%"
        problem_handle = func.concat(",", func.coalesce(PpmProblemList.now_handle_user, ""), ",")
        problem_stmt = (
            select(PpmProblemList)
            .where(PpmProblemList.status != "已完成")
            .where(problem_handle.like(uid_csv))
        )
        for p in (await self._session.execute(problem_stmt)).scalars().all():
            todos.append(
                WorkbenchTodoItem(
                    id=str(p.id),
                    name=p.pro_desc or p.project_name or "问题待处理",
                    type="缺陷",
                    source="problem_audit",
                )
            )

        # ② 问题变更待审批:status="1" 审核中 (ProblemChangeStatus.AUDITING,
        # problem/fsm.py) 且 now_handle_user 含我。同 ① 下推 SQL where。
        change_handle = func.concat(",", func.coalesce(PpmProblemChange.now_handle_user, ""), ",")
        change_stmt = (
            select(PpmProblemChange)
            .where(PpmProblemChange.status == "1")
            .where(change_handle.like(uid_csv))
        )
        for c in (await self._session.execute(change_stmt)).scalars().all():
            todos.append(
                WorkbenchTodoItem(
                    id=str(c.id),
                    name=c.pro_desc or c.project_name or "问题变更待审批",
                    type="缺陷",
                    source="problem_change",
                )
            )

        # ③ 任务待办:非已完成,按 start_time 升序(保护上限 _TODO_SOURCE_LIMIT)
        task_stmt = (
            select(PlanTask)
            .where(PlanTask.user_id == target.id)
            .where(PlanTask.status != "已完成")
            .order_by(PlanTask.start_time.asc())
            .limit(_TODO_SOURCE_LIMIT)
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

    async def get_todos(
        self,
        target: User,
        page: int = 1,
        page_size: int = _TODO_DEFAULT_PAGE_SIZE,
    ) -> Page[WorkbenchTodoItem]:
        """分页待办(FR-1 / D-001@v1):全量派生后按 (page, page_size) 切片。

        total = 全量长度(三源合并),items = 切片。page<1 兜底为 1。
        """
        all_todos = await self._derive_todos(target)
        total = len(all_todos)
        page = max(page, 1)
        page_size = max(page_size, 1)
        offset = (page - 1) * page_size
        items = all_todos[offset : offset + page_size]
        return Page[WorkbenchTodoItem](
            items=items,
            total=total,
            page=page,
            page_size=page_size,
        )

    # ------------------------------------------------------------------
    # 切换用户:权限收口 + 可见用户集 (D-002@v1 / D-005@v1 / FR-02~04)
    # ------------------------------------------------------------------

    async def _load_user(self, user_id: uuid.UUID) -> User:
        """按 id 载入用户;不存在 → 404。"""
        u = (
            await self._session.execute(select(User).where(User.id == user_id))
        ).scalar_one_or_none()
        if u is None:
            raise HTTPException(status_code=404, detail="目标用户不存在")
        return u

    async def _resolve_target_user(self, actor: User, target_user_id: str | None) -> User:
        """解析工作台展示目标用户(切换用户权限收口,FR-04 / R-01)。

        - 不传 / 传自己 → actor(完全兼容旧行为)
        - 超管 → 任意目标(校验存在性 → 404)
        - 经理 → 目标须在可见集,否则 403
        """
        if not target_user_id:
            return actor
        try:
            tid = uuid.UUID(str(target_user_id))
        except (ValueError, AttributeError, TypeError):
            raise HTTPException(status_code=400, detail="target_user_id 非法") from None
        if tid == actor.id:
            return actor
        if await is_super_admin(self._session, actor):
            return await self._load_user(tid)
        visible = await self._visible_user_ids(actor)
        if tid not in visible:
            raise HTTPException(status_code=403, detail="无权查看该用户工作台")
        return await self._load_user(tid)

    async def _visible_user_ids(self, actor: User) -> set[uuid.UUID]:
        """当前登录人可切换查看的用户集(D-002@v1 按经理角色分口径)。

        - 部门经理 → 所属 org 子树({oid} | _descendant_ids)成员
        - 项目/开发/业务经理 → 其经理项目(不含部门经理角色项目)的 PpmProjectMember.user_id
        - 兼具 → 并集;恒含 actor 自己
        超管 → 全部 active 用户(供 list_switchable_users;_resolve_target_user
        对超管已短路,不依赖此分支)。
        """
        # 超管:全部 active 用户
        if await is_super_admin(self._session, actor):
            all_active = (
                (await self._session.execute(select(User.id).where(User.status == "active")))
                .scalars()
                .all()
            )
            return set(all_active)

        member_rows = (
            (
                await self._session.execute(
                    select(PpmProjectMember).where(PpmProjectMember.user_id == actor.id)
                )
            )
            .scalars()
            .all()
        )
        has_dept = any(_split_roles(r.role_name) & {DEPT_MANAGER_NAME} for r in member_rows)
        proj_pids = {
            r.pm_project_id
            for r in member_rows
            if _split_roles(r.role_name) & PROJECT_MANAGER_NAMES
        }
        ids: set[uuid.UUID] = set()

        if has_dept:
            my_orgs = (
                (
                    await self._session.execute(
                        select(UserOrganization.organization_id).where(
                            UserOrganization.user_id == actor.id
                        )
                    )
                )
                .scalars()
                .all()
            )
            for oid in my_orgs:
                # _descendant_ids 排除根,须 {oid} 并回(对齐 _subtree_member_count,
                # 否则部门经理看不到本部门成员,违反 FR-3;Grill C3)。
                subtree = {oid} | await _descendant_ids(self._session, oid)
                member_uids = (
                    (
                        await self._session.execute(
                            select(UserOrganization.user_id).where(
                                UserOrganization.organization_id.in_(subtree)
                            )
                        )
                    )
                    .scalars()
                    .all()
                )
                ids.update(member_uids)

        if proj_pids:
            proj_uids = (
                (
                    await self._session.execute(
                        select(PpmProjectMember.user_id).where(
                            PpmProjectMember.pm_project_id.in_(proj_pids)
                        )
                    )
                )
                .scalars()
                .all()
            )
            ids.update(proj_uids)

        ids.add(actor.id)
        return ids

    async def _can_view_others(self, actor: User) -> bool:
        """登录人是否可切换查看他人工作台(超管 ‖ 任一经理角色,D-005@v1)。"""
        if await is_super_admin(self._session, actor):
            return True
        rows = (
            (
                await self._session.execute(
                    select(PpmProjectMember.role_name).where(PpmProjectMember.user_id == actor.id)
                )
            )
            .scalars()
            .all()
        )
        return any(_split_roles(r) & MANAGER_ROLE_NAMES for r in rows)

    async def list_switchable_users(self, actor: User) -> list[WorkbenchSwitchableUser]:
        """当前登录人可切换查看的用户列表(GET /workbench/switchable-users)。

        非经理非超管 → 空(前端不显切换入口)。装配批量 JOIN 取
        display_name/employee_no/首个 active 部门名,防 N+1。
        """
        ids = await self._visible_user_ids(actor)
        # 超管时 _visible_user_ids 也返回全部 active 用户(见下),此处统一装配。
        rows = (
            await self._session.execute(
                select(User, Organization.name)
                .outerjoin(UserOrganization, UserOrganization.user_id == User.id)
                .outerjoin(
                    Organization,
                    and_(
                        Organization.id == UserOrganization.organization_id,
                        Organization.status == "active",
                    ),
                )
                .where(User.id.in_(ids), User.status == "active")
                .order_by(User.display_name.asc())
            )
        ).all()
        # 每用户取首个 active 部门名(可能多行,取第一行)。
        seen: dict[uuid.UUID, WorkbenchSwitchableUser] = {}
        for u, dept_name in rows:
            if u.id in seen:
                continue
            seen[u.id] = WorkbenchSwitchableUser(
                user_id=str(u.id),
                display_name=u.display_name,
                employee_no=u.employee_no,
                department_name=dept_name,
            )
        return list(seen.values())

    # ------------------------------------------------------------------
    # calendar —— 月度日历负载
    # ------------------------------------------------------------------

    async def get_calendar(
        self,
        target: User,
        year_month: str,
    ) -> WorkbenchCalendar:
        """装配个人工作台月度日历 (左点负载 D-001~007 + 右点进度 D-008 + 详情 D-009)。

        数据取自 ``target``(切换用户时为目标人)。``year_month`` 形如 ``YYYY-MM``。

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
                        PlanTask.user_id == target.id,
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
                        PpmProblemList.duty_user_id == target.id,
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
                        TaskExecute.execute_user_id == target.id,
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
                .where(TaskExecute.execute_user_id == target.id)
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
                        prob.status == "已完成",
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
