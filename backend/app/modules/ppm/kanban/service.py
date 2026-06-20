"""kanban 看板子域 service —— 聚合查询 + 分配 + 拖拽排序。

无新表,聚合 ``ppm_project_member`` (人员) 与 ``ppm_plan_task`` (任务卡片)。
设计依据:``design.md`` §7 (kanban 端点) + §13 X-001 (人员=可见
project_member,可按 Organization 分组)。

源对齐:``PpdKanbanServiceImpl``。源按 ``dept`` 聚合 → 本项目平台级无 dept,
改用 ``Organization`` (复用 admin org) 分组 (X-001);人员来源由源
``AdminUserService`` 改为 ``PpmProjectMember``。
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.admin.model import Organization, UserOrganization
from app.modules.ppm.kanban.schema import (
    KanbanQueryReq,
    OrgGroup,
    TaskAssignReq,
    TaskCardVO,
    UserColumnVO,
)
from app.modules.ppm.project.model import PpmProjectMember
from app.modules.ppm.task.model import PlanTask

log = get_logger(__name__)


class KanbanError(AppError):
    """kanban 子域业务错误基类。"""

    code = "PPM_KANBAN_ERROR"
    http_status = 400


class TaskNotFound(KanbanError):
    code = "PPM_KANBAN_TASK_NOT_FOUND"
    http_status = 404


def _parse_hours(raw: str | None) -> float:
    """把 ``PlanTask.work_load`` 字符串解析为小时数 (无法解析返回 0)。

    源 ``TaskCardVO.estimateHours`` 是整数;本项目 ``PlanTask.work_load``
    存字符串 (如 "8"、"0.5天"),此处做宽松解析。
    """
    if not raw:
        return 0.0
    try:
        return float(raw)
    except (TypeError, ValueError):
        return 0.0


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
                    estimate_hours=_parse_hours(t.work_load),
                    kanban_order=t.kanban_order,
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


__all__ = ["KanbanError", "PpdKanbanService", "TaskNotFound"]
