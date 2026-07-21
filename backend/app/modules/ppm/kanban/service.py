"""kanban 看板子域 service —— 聚合查询 + 分配 + 拖拽排序。

无新表,聚合 ``ppm_project_member`` (人员) 与 ``ppm_plan_task`` (任务卡片)。
设计依据:``design.md`` §7 (kanban 端点) + §13 X-001 (人员=可见
project_member,可按 Organization 分组)。

源对齐:``PpdKanbanServiceImpl``。源按 ``dept`` 聚合 → 本项目平台级无 dept,
改用 ``Organization`` (复用 admin org) 分组 (X-001);人员来源由源
``AdminUserService`` 改为 ``PpmProjectMember``。
"""

from __future__ import annotations

import re
import uuid
from collections import defaultdict
from datetime import UTC, date, datetime, time
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.admin.model import Organization, UserOrganization
from app.modules.auth.model import User
from app.modules.ppm.kanban.model import PpmKanbanComment, PpmKanbanSubtask
from app.modules.ppm.kanban.schema import (
    KanbanQueryReq,
    OrgGroup,
    TaskAssignReq,
    TaskCardVO,
    TaskCreateReq,
    TaskUpdateReq,
    UserColumnVO,
)
from app.modules.ppm.project.model import PpmProjectMember
from app.modules.ppm.task.model import PlanTask

log = get_logger(__name__)

# 饱和度可用工时基线:每周 40 小时 (FR-01 MVP 简化,固定常量)。
DEFAULT_AVAILABLE_HOURS_PER_WEEK = 40


class KanbanError(AppError):
    """kanban 子域业务错误基类。"""

    code = "PPM_KANBAN_ERROR"
    http_status = 400


class TaskNotFound(KanbanError):
    code = "PPM_KANBAN_TASK_NOT_FOUND"
    http_status = 404


class CommentEmpty(KanbanError):
    code = "PPM_KANBAN_COMMENT_EMPTY"
    http_status = 422


def _parse_hours(raw: str | None) -> float:
    """把 ``PlanTask.work_load`` 字符串解析为**人天数** (无法解析返回 0)。

    ``work_load`` 约定 (与前端 ``parseWorkLoadPersonDays``、workbench
    ``_parse_workload_hours`` 同源,1 人天 = 8 小时):
    - 纯数字 / 带 ``d`` / ``天`` → 视为人天,原值返回;
    - 带 ``h`` / ``小时`` → 视为小时,÷8 换算成人天;
    - 空 / 无法解析 (如 "约3") → 返回 ``0.0``。

    看板 ``estimate_hours`` 与 task-plans 「工作量(人天)」「已消耗(人天)」
    同量纲,均按人天展示。函数名沿用历史命名,返回值为人天。
    """
    if not raw:
        return 0.0
    m = re.match(r"^\s*([\d.]+)\s*(h|d|小时|天)?\s*$", raw.strip(), re.I)
    if not m:
        return 0.0
    val = float(m.group(1))
    unit = (m.group(2) or "").lower()
    if unit in ("h", "小时"):
        return val / 8.0
    return val


def _parse_date_range(
    start_date: str | None, end_date: str | None
) -> tuple[datetime | None, datetime | None]:
    """解析日期范围字符串 (YYYY-MM-DD) → (起 UTC datetime, 止 当天 23:59:59 datetime)。

    用于按 ``PlanTask.end_time`` (截止日期) 过滤;无效输入返回 None。
    两重维度之日期维度的后端过滤基线。
    """
    start_dt: datetime | None = None
    end_dt: datetime | None = None
    if start_date:
        try:
            d = date.fromisoformat(start_date)
            start_dt = datetime.combine(d, time.min)
        except ValueError:
            start_dt = None
    if end_date:
        try:
            d = date.fromisoformat(end_date)
            end_dt = datetime.combine(d, time.max)
        except ValueError:
            end_dt = None
    return start_dt, end_dt


def _apply_date_filter(stmt: Any, start_date: str | None, end_date: str | None, column: Any) -> Any:
    """按截止日期区间 [start_date, end_date] 收紧 select stmt (含两端)。"""
    start_dt, end_dt = _parse_date_range(start_date, end_date)
    if start_dt is not None:
        stmt = stmt.where(column >= start_dt)
    if end_dt is not None:
        stmt = stmt.where(column <= end_dt)
    return stmt


def _derive_priority(status: str | None, end_time: datetime | None) -> int:
    """对齐源 TaskPlanMapper.xml:147-150。1=逾期,2=活跃,3=已完成/其他。"""
    if status == "已完成":
        return 3
    if end_time is not None and end_time.date() < datetime.now(UTC).date():
        return 1  # 逾期:截止 < 今天 且 未完成
    if status in ("进行中", "未开始"):
        return 2
    return 3


def _derive_progress(status: str | None) -> int:
    """对齐源 TaskPlanMapper.xml:160-164。已完成 100/进行中 50/其他 0。"""
    if status == "已完成":
        return 100
    if status == "进行中":
        return 50
    return 0


class PpdKanbanService:
    """看板聚合 service (无状态,复用传入 session)。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ------------------------------------------------------------------
    # 人员列
    # ------------------------------------------------------------------

    async def get_user_columns(self, req: KanbanQueryReq) -> list[UserColumnVO] | list[OrgGroup]:
        """人员列 = 当前用户可见的 ``project_member``,含每人任务统计。

        X-001:``req.group_by_org=True`` 时返回 :class:`OrgGroup` 列表
        (按 Organization 折叠);否则返回扁平 :class:`UserColumnVO` 列表。

        任务统计范围与 :meth:`get_task_cards` 的过滤条件一致 (project_id/
        status/keyword),保证列与卡片数据自洽。
        """
        members = await self._query_visible_members(req.user_ids, req.project_id)
        if not members:
            return []

        # 每人任务统计 (与卡片过滤同条件)
        user_ids = [m.user_id for m in members]
        task_stats = await self._aggregate_task_stats(user_ids, req)

        # 组织映射 (X-001)
        org_map = await self._load_org_map(user_ids) if req.group_by_org else {}

        columns: list[UserColumnVO] = []
        for m in members:
            stat = task_stats.get(m.user_id, {"count": 0, "hours": 0.0, "task_ids": []})
            org = org_map.get(m.user_id)
            columns.append(
                UserColumnVO(
                    user_id=m.user_id,
                    username=m.user_name,
                    dept_id=org.id if org else None,
                    dept_name=org.name if org else None,
                    task_count=stat["count"],
                    total_hours=stat["hours"],
                    saturation=self._calc_saturation(stat["hours"]),
                    task_ids=stat["task_ids"],
                )
            )

        if not req.group_by_org:
            return columns

        # 按 org 分组 (无组织 → org_id=None)
        groups: dict[uuid.UUID | None, list[UserColumnVO]] = defaultdict(list)
        org_name_by_id: dict[uuid.UUID | None, str | None] = {}
        for col in columns:
            groups[col.dept_id].append(col)
            org_name_by_id.setdefault(col.dept_id, col.dept_name)
        return [
            OrgGroup(org_id=oid, org_name=org_name_by_id[oid], members=members_)
            for oid, members_ in groups.items()
        ]

    async def get_task_cards(self, req: KanbanQueryReq) -> list[TaskCardVO]:
        """任务卡片 (来自 ``PlanTask``,按 kanban_order 排序)。"""
        stmt = select(PlanTask)
        if req.user_ids:
            stmt = stmt.where(PlanTask.user_id.in_(req.user_ids))
        if req.project_id is not None:
            stmt = stmt.where(PlanTask.project_id == req.project_id)
        if req.status is not None:
            stmt = stmt.where(PlanTask.status == req.status)
        if req.keyword:
            like = f"%{req.keyword}%"
            stmt = stmt.where(PlanTask.content.like(like))
        # 日期维度:按截止时间 (end_time) 落在 [start_date, end_date] 过滤
        stmt = _apply_date_filter(stmt, req.start_date, req.end_date, PlanTask.end_time)
        stmt = stmt.order_by(PlanTask.user_id.asc(), PlanTask.kanban_order.asc())
        result = await self._session.execute(stmt)
        cards: list[TaskCardVO] = []
        for t in result.scalars().all():
            cards.append(
                TaskCardVO(
                    id=t.id,
                    title=t.content,
                    status=t.status,
                    project_id=t.project_id,
                    project_name=t.project_name,
                    user_id=t.user_id,
                    user_name=t.user_name,
                    deadline=t.end_time,
                    start_time=t.start_time,
                    priority=_derive_priority(t.status, t.end_time),
                    progress=_derive_progress(t.status),
                    create_time=t.created_at,
                    update_time=t.updated_at,
                    estimate_hours=_parse_hours(t.work_load),
                    task_description=t.task_description,
                    module_name=t.module_name,
                    work_partner=t.work_partner,
                    remarks=t.remarks,
                    kanban_order=t.kanban_order,
                    file_urls=list(t.file_urls or []),
                )
            )
        return cards

    # ------------------------------------------------------------------
    # 分配 + 排序 (写)
    # ------------------------------------------------------------------

    async def assign_task(self, req: TaskAssignReq) -> None:
        """分配任务给人员:更新 ``PlanTask.user_id`` / ``user_name``。

        对齐源 ``assignTask``:同时同步 ``user_name`` (取 project_member
        冗余名,member 不存在时置空),可选写入 ``kanban_order``。
        """
        task = await self._session.get(PlanTask, req.task_id)
        if task is None:
            raise TaskNotFound(f"PlanTask '{req.task_id}' not found.")

        # 取新负责人姓名 (优先 project_member 冗余名)
        new_name = await self._lookup_user_name(req.assignee_id)

        task.user_id = req.assignee_id
        task.user_name = new_name
        if req.kanban_order is not None:
            task.kanban_order = req.kanban_order
        await self._session.commit()
        log.info(
            "kanban_task_assigned",
            task_id=str(req.task_id),
            assignee_id=str(req.assignee_id),
        )

    async def reorder_tasks(self, user_id: uuid.UUID, task_ids: list[uuid.UUID]) -> None:
        """拖拽排序:按 ``task_ids`` 数组下标批量写 ``kanban_order``。

        对齐源 ``reorderTasks``:仅更新传入任务在该人员列下的顺序;
        ``user_id`` 用于约束范围 (防止跨列误改),数组下标即新 order。
        """
        if not task_ids:
            return
        # 单次查出该 user 下待更新任务,按传入顺序写 order
        result = await self._session.execute(
            select(PlanTask).where(PlanTask.user_id == user_id, PlanTask.id.in_(task_ids))
        )
        tasks_by_id = {t.id: t for t in result.scalars().all()}
        for order, tid in enumerate(task_ids):
            t = tasks_by_id.get(tid)
            if t is not None:
                t.kanban_order = order
        await self._session.commit()
        log.info("kanban_tasks_reordered", user_id=str(user_id), count=len(task_ids))

    # ------------------------------------------------------------------
    # task CRUD (FR-01)
    # ------------------------------------------------------------------

    async def create_task(self, req: TaskCreateReq) -> PlanTask:
        """新建 PlanTask,kanban_order 自动取该 user 列尾 +1。"""
        kanban_order = await self._next_kanban_order(req.user_id) if req.user_id else 0
        task = PlanTask(
            content=req.content,
            user_id=req.user_id or uuid.uuid4(),
            user_name=await self._lookup_user_name(req.user_id) if req.user_id else None,
            status="未开始",
            project_id=req.project_id,
            project_name=req.project_name,
            work_load=req.work_load,
            end_time=req.end_time,
            file_urls=list(req.file_urls or []),
            kanban_order=kanban_order,
        )
        self._session.add(task)
        await self._session.commit()
        await self._session.refresh(task)
        log.info("kanban_task_created", task_id=str(task.id))
        return task

    async def update_task(self, task_id: uuid.UUID, req: TaskUpdateReq) -> PlanTask:
        """更新 task 非空字段。"""
        task = await self._session.get(PlanTask, task_id)
        if task is None:
            raise TaskNotFound(f"PlanTask '{task_id}' not found.")
        if req.content is not None:
            task.content = req.content
        if req.status is not None:
            task.status = req.status
        if req.work_load is not None:
            task.work_load = req.work_load
        if req.end_time is not None:
            task.end_time = req.end_time
        if req.file_urls is not None:
            task.file_urls = list(req.file_urls)
        await self._session.commit()
        await self._session.refresh(task)
        log.info("kanban_task_updated", task_id=str(task_id))
        return task

    async def delete_task(self, task_id: uuid.UUID) -> None:
        """删除 task,级联删其 comment + subtask。"""
        task = await self._session.get(PlanTask, task_id)
        if task is None:
            raise TaskNotFound(f"PlanTask '{task_id}' not found.")
        # 级联清理评论 / 子任务(按 task_id 查)
        comments = await self._session.execute(
            select(PpmKanbanComment).where(PpmKanbanComment.task_id == task_id)
        )
        for c in comments.scalars().all():
            await self._session.delete(c)
        subtasks = await self._session.execute(
            select(PpmKanbanSubtask).where(PpmKanbanSubtask.task_id == task_id)
        )
        for s in subtasks.scalars().all():
            await self._session.delete(s)
        await self._session.delete(task)
        await self._session.commit()
        log.info("kanban_task_deleted", task_id=str(task_id))

    # ------------------------------------------------------------------
    # comment (D-011)
    # ------------------------------------------------------------------

    async def list_comments(self, task_id: uuid.UUID) -> list[PpmKanbanComment]:
        """列评论(按 created_at 升序)。task 不存在 → 404。"""
        await self._ensure_task(task_id)
        result = await self._session.execute(
            select(PpmKanbanComment)
            .where(PpmKanbanComment.task_id == task_id)
            .order_by(PpmKanbanComment.created_at.asc())
        )
        return list(result.scalars().all())

    async def add_comment(self, task_id: uuid.UUID, user: User, content: str) -> PpmKanbanComment:
        """新增评论。空内容 → 422;task 不存在 → 404。"""
        await self._ensure_task(task_id)
        if not content.strip():
            raise CommentEmpty("评论内容不能为空")
        user_name = await self._lookup_user_name(user.id)
        comment = PpmKanbanComment(
            task_id=task_id,
            user_id=user.id,
            user_name=user_name,
            content=content.strip(),
        )
        self._session.add(comment)
        await self._session.commit()
        await self._session.refresh(comment)
        log.info("kanban_comment_added", task_id=str(task_id), comment_id=str(comment.id))
        return comment

    # ------------------------------------------------------------------
    # subtask (D-011)
    # ------------------------------------------------------------------

    async def list_subtasks(self, task_id: uuid.UUID) -> list[PpmKanbanSubtask]:
        """列子任务(按 sort_order 升序)。task 不存在 → 404。"""
        await self._ensure_task(task_id)
        result = await self._session.execute(
            select(PpmKanbanSubtask)
            .where(PpmKanbanSubtask.task_id == task_id)
            .order_by(PpmKanbanSubtask.sort_order.asc())
        )
        return list(result.scalars().all())

    async def toggle_subtask(self, task_id: uuid.UUID, subtask_id: uuid.UUID) -> PpmKanbanSubtask:
        """翻转子任务 done;subtask 不存在 / task_id 不匹配 → 404。"""
        subtask = await self._session.get(PpmKanbanSubtask, subtask_id)
        if subtask is None or subtask.task_id != task_id:
            raise TaskNotFound(f"PpmKanbanSubtask '{subtask_id}' not found under task '{task_id}'.")
        subtask.done = not subtask.done
        await self._session.commit()
        await self._session.refresh(subtask)
        log.info("kanban_subtask_toggled", subtask_id=str(subtask_id), done=subtask.done)
        return subtask

    # ------------------------------------------------------------------
    # 内部辅助 (task CRUD / comment / subtask)
    # ------------------------------------------------------------------

    async def _ensure_task(self, task_id: uuid.UUID) -> None:
        """校验 PlanTask 存在,否则 404。"""
        task = await self._session.get(PlanTask, task_id)
        if task is None:
            raise TaskNotFound(f"PlanTask '{task_id}' not found.")

    async def _next_kanban_order(self, user_id: uuid.UUID) -> int:
        """取该 user 列尾 kanban_order + 1 (无任务返回 0)。"""
        result = await self._session.execute(
            select(PlanTask.kanban_order)
            .where(PlanTask.user_id == user_id)
            .order_by(PlanTask.kanban_order.desc())
            .limit(1)
        )
        row = result.first()
        return (row[0] + 1) if row else 0

    @staticmethod
    def _calc_saturation(total_hours: float) -> float:
        """饱和度 = total_hours / 可用工时 * 100,保留 1 位小数;分母为 0 返 0.0。"""
        available = DEFAULT_AVAILABLE_HOURS_PER_WEEK
        if available <= 0:
            return 0.0
        return round(total_hours / available * 100, 1)

    # ------------------------------------------------------------------
    # 搜人
    # ------------------------------------------------------------------

    async def search_users(self, keyword: str) -> list[UserColumnVO]:
        """按姓名模糊搜 project_member (源按 nickname 搜 AdminUser)。

        本项目平台级无独立 AdminUserService,人员来源统一是
        ``project_member``;按 ``user_name`` 模糊匹配并去重 (同人多名时取首条)。
        搜索结果不含任务统计 (对齐源:task_count=0)。
        """
        if not keyword or not keyword.strip():
            return []
        like = f"%{keyword.strip()}%"
        result = await self._session.execute(
            select(PpmProjectMember)
            .where(PpmProjectMember.user_name.like(like))
            .order_by(PpmProjectMember.user_name.asc())
        )
        seen: set[uuid.UUID] = set()
        out: list[UserColumnVO] = []
        for m in result.scalars().all():
            if m.user_id in seen:
                continue
            seen.add(m.user_id)
            out.append(
                UserColumnVO(
                    user_id=m.user_id,
                    username=m.user_name,
                    dept_id=None,
                    dept_name=m.depart_name,
                    task_count=0,
                )
            )
        return out

    # ------------------------------------------------------------------
    # 内部聚合辅助
    # ------------------------------------------------------------------

    async def _query_visible_members(
        self,
        user_ids: list[uuid.UUID] | None,
        project_id: uuid.UUID | None,
    ) -> list[PpmProjectMember]:
        """查可见 project_member (可按 user_ids / project_id 过滤,按 user_id 去重)。"""
        stmt = select(PpmProjectMember)
        if user_ids:
            stmt = stmt.where(PpmProjectMember.user_id.in_(user_ids))
        if project_id is not None:
            stmt = stmt.where(PpmProjectMember.pm_project_id == project_id)
        stmt = stmt.order_by(PpmProjectMember.user_name.asc())
        result = await self._session.execute(stmt)
        seen: set[uuid.UUID] = set()
        out: list[PpmProjectMember] = []
        for m in result.scalars().all():
            if m.user_id in seen:
                continue
            seen.add(m.user_id)
            out.append(m)
        return out

    async def _aggregate_task_stats(
        self, user_ids: list[uuid.UUID], req: KanbanQueryReq
    ) -> dict[uuid.UUID, dict[str, Any]]:
        """每人任务统计:count + 预估工时合计 + task_ids。

        过滤条件与 :meth:`get_task_cards` 对齐 (project/status/keyword)。
        """
        if not user_ids:
            return {}
        stmt = select(PlanTask).where(PlanTask.user_id.in_(user_ids))
        if req.project_id is not None:
            stmt = stmt.where(PlanTask.project_id == req.project_id)
        if req.status is not None:
            stmt = stmt.where(PlanTask.status == req.status)
        if req.keyword:
            like = f"%{req.keyword}%"
            stmt = stmt.where(PlanTask.content.like(like))
        # 日期维度:与 get_task_cards 同步按 end_time 过滤,保证列统计自洽
        stmt = _apply_date_filter(stmt, req.start_date, req.end_date, PlanTask.end_time)
        result = await self._session.execute(stmt)
        stats: dict[uuid.UUID, dict[str, Any]] = defaultdict(
            lambda: {"count": 0, "hours": 0.0, "task_ids": []}
        )
        for t in result.scalars().all():
            s = stats[t.user_id]
            s["count"] += 1
            s["hours"] += _parse_hours(t.work_load)
            s["task_ids"].append(t.id)
        return dict(stats)

    async def _load_org_map(self, user_ids: list[uuid.UUID]) -> dict[uuid.UUID, Organization]:
        """user_id → Organization 映射 (X-001 分组用)。

        一个用户可能挂多个组织,这里取首条 (按 organization.sort_order 升序)。
        """
        if not user_ids:
            return {}
        stmt = (
            select(UserOrganization, Organization)
            .join(Organization, UserOrganization.organization_id == Organization.id)
            .where(UserOrganization.user_id.in_(user_ids))
            .order_by(Organization.sort_order.asc())
        )
        result = await self._session.execute(stmt)
        out: dict[uuid.UUID, Organization] = {}
        for uo, org in result.all():
            # 首条优先 (已按 sort_order 排序)
            out.setdefault(uo.user_id, org)
        return out

    async def _lookup_user_name(self, user_id: uuid.UUID) -> str | None:
        """取 user_id 对应 project_member 冗余名 (无则 None)。"""
        result = await self._session.execute(
            select(PpmProjectMember.user_name).where(PpmProjectMember.user_id == user_id).limit(1)
        )
        row = result.first()
        return row[0] if row else None


__all__ = ["CommentEmpty", "KanbanError", "PpdKanbanService", "TaskNotFound"]
