"""pm 项目管理子域 service 层。

每张表一个 service 类,提供 CRUD 6 件套 (create/update/delete/get/page) +
``ProjectMaintenanceService.simple_list`` (项目下拉)。统一复用
``app.modules.ppm.common.crud`` 的分页/计数 helper,不重复造轮子。

平台级:无 workspace 维度,CRUD 不带 workspace_id 过滤 (D-001@v1)。

设计依据:``design.md`` §5/§7,task-03.md。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.ppm.common.crud import (
    Page,
    PageReq,
    apply_pagination,
    apply_sort,
    count_total,
)
from app.modules.ppm.project.model import (
    PpmCustomerMaintenance,
    PpmProjectMaintenance,
    PpmProjectMember,
    PpmProjectStakeholder,
)
from app.modules.ppm.project.schema import (
    CustomerMaintenanceCreate,
    CustomerMaintenancePageReq,
    CustomerMaintenanceUpdate,
    ProjectMaintenanceCreate,
    ProjectMaintenancePageReq,
    ProjectMaintenanceUpdate,
    ProjectMemberCreate,
    ProjectMemberPageReq,
    ProjectMemberUpdate,
    ProjectSimpleItem,
    ProjectStakeholderCreate,
    ProjectStakeholderPageReq,
    ProjectStakeholderUpdate,
)

log = get_logger(__name__)


# ---------------------------------------------------------------------------
# 错误类型
# ---------------------------------------------------------------------------


class PpmProjectError(AppError):
    code = "PPM_PROJECT_ERROR"
    http_status = 400


class PpmProjectNotFound(PpmProjectError):
    code = "HTTP_404_PPM_PROJECT_NOT_FOUND"
    http_status = 404


class PpmProjectCodeDuplicate(PpmProjectError):
    code = "HTTP_409_PPM_PROJECT_CODE_DUPLICATE"
    http_status = 409


class PpmCustomerNotFound(PpmProjectError):
    code = "HTTP_404_PPM_CUSTOMER_NOT_FOUND"
    http_status = 404


class PpmProjectMemberNotFound(PpmProjectError):
    code = "HTTP_404_PPM_PROJECT_MEMBER_NOT_FOUND"
    http_status = 404


class PpmProjectMemberDuplicate(PpmProjectError):
    """同一项目下同一 user 已存在 (ux 约束)。"""

    code = "HTTP_409_PPM_PROJECT_MEMBER_DUPLICATE"
    http_status = 409


class PpmProjectStakeholderNotFound(PpmProjectError):
    code = "HTTP_404_PPM_PROJECT_STAKEHOLDER_NOT_FOUND"
    http_status = 404


def _now() -> datetime:
    return datetime.now(UTC)


def _to_page_req(page_req: Any) -> PageReq:
    """把 Pydantic ``XxxPageReq`` 转成通用 ``PageReq`` dataclass。"""
    return PageReq(
        page=page_req.page,
        page_size=page_req.page_size,
        order_by=page_req.order_by,
        order=page_req.order,
    )


# ---------------------------------------------------------------------------
# 项目维护 PpmProjectMaintenance
# ---------------------------------------------------------------------------

# 排序字段白名单 (业务字段名 → 模型属性名 一致)
_PROJECT_SORT_FIELDS: set[str] = {
    "created_at",
    "updated_at",
    "project_name",
    "project_code",
    "project_status",
}


class ProjectMaintenanceService:
    """项目维护 CRUD + simple_list。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(
        self,
        data: ProjectMaintenanceCreate,
        *,
        operator: uuid.UUID,
    ) -> PpmProjectMaintenance:
        # project_code 唯一约束预检 (更友好的 409,而非 IntegrityError 500)
        await self._assert_code_available(data.project_code)
        entity = PpmProjectMaintenance(
            id=uuid.uuid4(),
            create_name=data.create_name,
            company_name=data.company_name,
            project_name=data.project_name,
            project_code=data.project_code,
            project_status=data.project_status,
            project_type=data.project_type,
            project_effective_start_time=data.project_effective_start_time,
            project_effective_end_time=data.project_effective_end_time,
            project_maintenance_end_time=data.project_maintenance_end_time,
            created_by=operator,
            updated_by=operator,
        )
        self._session.add(entity)
        await self._session.commit()
        await self._session.refresh(entity)
        log.info(
            "ppm_project_created",
            project_id=str(entity.id),
            project_code=data.project_code,
        )
        return entity

    async def update(
        self,
        entity_id: uuid.UUID,
        data: ProjectMaintenanceUpdate,
        *,
        operator: uuid.UUID,
    ) -> PpmProjectMaintenance:
        entity = await self.get(entity_id)
        payload = data.model_dump(exclude_unset=True)
        for key, value in payload.items():
            setattr(entity, key, value)
        entity.updated_by = operator
        entity.updated_at = _now()
        await self._session.commit()
        await self._session.refresh(entity)
        log.info("ppm_project_updated", project_id=str(entity_id))
        return entity

    async def delete(self, entity_id: uuid.UUID) -> None:
        entity = await self.get(entity_id)
        await self._session.delete(entity)
        await self._session.commit()
        log.info("ppm_project_deleted", project_id=str(entity_id))

    async def get(self, entity_id: uuid.UUID) -> PpmProjectMaintenance:
        entity = await self._session.get(PpmProjectMaintenance, entity_id)
        if entity is None:
            raise PpmProjectNotFound(f"项目维护 '{entity_id}' 不存在")
        return entity

    async def page(
        self,
        req: ProjectMaintenancePageReq,
    ) -> Page[PpmProjectMaintenance]:
        stmt = select(PpmProjectMaintenance)
        stmt = self._apply_filters(stmt, req)
        total = await count_total(self._session, stmt)
        stmt = apply_sort(
            stmt,
            PpmProjectMaintenance,
            req.order_by,
            _PROJECT_SORT_FIELDS,
            req.order,
        )
        stmt = apply_pagination(stmt, _to_page_req(req))
        result = await self._session.execute(stmt)
        items = list(result.scalars().all())
        return Page.build(items=items, total=total, req=_to_page_req(req))

    async def simple_list(self) -> list[ProjectSimpleItem]:
        """项目下拉:返回 {id, project_name} 列表,按 project_name 升序。"""
        stmt = select(
            PpmProjectMaintenance.id,
            PpmProjectMaintenance.project_name,
        ).order_by(PpmProjectMaintenance.project_name.asc())
        result = await self._session.execute(stmt)
        return [ProjectSimpleItem(id=row.id, project_name=row.project_name) for row in result.all()]

    async def _assert_code_available(self, project_code: str) -> None:
        stmt = (
            select(func.count())
            .select_from(PpmProjectMaintenance)
            .where(PpmProjectMaintenance.project_code == project_code)
        )
        count = (await self._session.execute(stmt)).scalar() or 0
        if count > 0:
            raise PpmProjectCodeDuplicate(
                f"项目编号 '{project_code}' 已存在",
                details={"project_code": project_code},
            )

    @staticmethod
    def _apply_filters(
        stmt: Select[Any],
        req: ProjectMaintenancePageReq,
    ) -> Select[Any]:
        if req.project_name:
            stmt = stmt.where(PpmProjectMaintenance.project_name.like(f"%{req.project_name}%"))
        if req.project_code:
            stmt = stmt.where(PpmProjectMaintenance.project_code.like(f"%{req.project_code}%"))
        if req.project_status:
            stmt = stmt.where(PpmProjectMaintenance.project_status == req.project_status)
        if req.project_type:
            stmt = stmt.where(PpmProjectMaintenance.project_type == req.project_type)
        return stmt


# ---------------------------------------------------------------------------
# 客户维护 PpmCustomerMaintenance
# ---------------------------------------------------------------------------

_CUSTOMER_SORT_FIELDS: set[str] = {
    "created_at",
    "updated_at",
    "company_name",
    "contact",
    "level",
}


class CustomerMaintenanceService:
    """客户维护 CRUD。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(
        self,
        data: CustomerMaintenanceCreate,
        *,
        operator: uuid.UUID,
    ) -> PpmCustomerMaintenance:
        entity = PpmCustomerMaintenance(
            id=uuid.uuid4(),
            create_name=data.create_name,
            company_name=data.company_name,
            contact=data.contact,
            phone_no=data.phone_no,
            dept_name=data.dept_name,
            level=data.level,
            created_by=operator,
            updated_by=operator,
        )
        self._session.add(entity)
        await self._session.commit()
        await self._session.refresh(entity)
        log.info("ppm_customer_created", customer_id=str(entity.id))
        return entity

    async def update(
        self,
        entity_id: uuid.UUID,
        data: CustomerMaintenanceUpdate,
        *,
        operator: uuid.UUID,
    ) -> PpmCustomerMaintenance:
        entity = await self.get(entity_id)
        payload = data.model_dump(exclude_unset=True)
        for key, value in payload.items():
            setattr(entity, key, value)
        entity.updated_by = operator
        entity.updated_at = _now()
        await self._session.commit()
        await self._session.refresh(entity)
        return entity

    async def delete(self, entity_id: uuid.UUID) -> None:
        entity = await self.get(entity_id)
        await self._session.delete(entity)
        await self._session.commit()

    async def get(self, entity_id: uuid.UUID) -> PpmCustomerMaintenance:
        entity = await self._session.get(PpmCustomerMaintenance, entity_id)
        if entity is None:
            raise PpmCustomerNotFound(f"客户维护 '{entity_id}' 不存在")
        return entity

    async def page(
        self,
        req: CustomerMaintenancePageReq,
    ) -> Page[PpmCustomerMaintenance]:
        stmt = select(PpmCustomerMaintenance)
        if req.company_name:
            stmt = stmt.where(PpmCustomerMaintenance.company_name.like(f"%{req.company_name}%"))
        if req.contact:
            stmt = stmt.where(PpmCustomerMaintenance.contact.like(f"%{req.contact}%"))
        if req.level:
            stmt = stmt.where(PpmCustomerMaintenance.level == req.level)
        total = await count_total(self._session, stmt)
        stmt = apply_sort(
            stmt,
            PpmCustomerMaintenance,
            req.order_by,
            _CUSTOMER_SORT_FIELDS,
            req.order,
        )
        stmt = apply_pagination(stmt, _to_page_req(req))
        result = await self._session.execute(stmt)
        items = list(result.scalars().all())
        return Page.build(items=items, total=total, req=_to_page_req(req))


# ---------------------------------------------------------------------------
# 项目成员 PpmProjectMember
# ---------------------------------------------------------------------------

_MEMBER_SORT_FIELDS: set[str] = {
    "created_at",
    "updated_at",
    "user_name",
    "role_name",
}


class ProjectMemberService:
    """项目成员 CRUD。

    注意 ``ux_ppm_project_member_project_user`` 唯一约束:同一 project 下
    同一 user 只能有一条成员记录。
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(
        self,
        data: ProjectMemberCreate,
        *,
        operator: uuid.UUID,
    ) -> PpmProjectMember:
        await self._assert_not_duplicate(data.pm_project_id, data.user_id)
        entity = PpmProjectMember(
            id=uuid.uuid4(),
            create_name=data.create_name,
            pm_project_id=data.pm_project_id,
            user_id=data.user_id,
            user_name=data.user_name,
            depart_id=data.depart_id,
            phone=data.phone,
            role_id=data.role_id,
            role_name=data.role_name,
            depart_name=data.depart_name,
            created_by=operator,
            updated_by=operator,
        )
        self._session.add(entity)
        await self._session.commit()
        await self._session.refresh(entity)
        log.info(
            "ppm_project_member_created",
            member_id=str(entity.id),
            project_id=str(data.pm_project_id),
            user_id=str(data.user_id),
        )
        return entity

    async def update(
        self,
        entity_id: uuid.UUID,
        data: ProjectMemberUpdate,
        *,
        operator: uuid.UUID,
    ) -> PpmProjectMember:
        entity = await self.get(entity_id)
        payload = data.model_dump(exclude_unset=True)
        for key, value in payload.items():
            setattr(entity, key, value)
        entity.updated_by = operator
        entity.updated_at = _now()
        await self._session.commit()
        await self._session.refresh(entity)
        return entity

    async def delete(self, entity_id: uuid.UUID) -> None:
        entity = await self.get(entity_id)
        await self._session.delete(entity)
        await self._session.commit()

    async def get(self, entity_id: uuid.UUID) -> PpmProjectMember:
        entity = await self._session.get(PpmProjectMember, entity_id)
        if entity is None:
            raise PpmProjectMemberNotFound(f"项目成员 '{entity_id}' 不存在")
        return entity

    async def page(self, req: ProjectMemberPageReq) -> Page[PpmProjectMember]:
        stmt = select(PpmProjectMember)
        if req.pm_project_id is not None:
            stmt = stmt.where(PpmProjectMember.pm_project_id == req.pm_project_id)
        if req.user_id is not None:
            stmt = stmt.where(PpmProjectMember.user_id == req.user_id)
        if req.role_name:
            stmt = stmt.where(PpmProjectMember.role_name == req.role_name)
        total = await count_total(self._session, stmt)
        stmt = apply_sort(
            stmt,
            PpmProjectMember,
            req.order_by,
            _MEMBER_SORT_FIELDS,
            req.order,
        )
        stmt = apply_pagination(stmt, _to_page_req(req))
        result = await self._session.execute(stmt)
        items = list(result.scalars().all())
        return Page.build(items=items, total=total, req=_to_page_req(req))

    async def _assert_not_duplicate(
        self,
        pm_project_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None:
        stmt = (
            select(func.count())
            .select_from(PpmProjectMember)
            .where(
                PpmProjectMember.pm_project_id == pm_project_id,
                PpmProjectMember.user_id == user_id,
            )
        )
        count = (await self._session.execute(stmt)).scalar() or 0
        if count > 0:
            raise PpmProjectMemberDuplicate(
                "该项目下该用户已存在成员记录",
                details={
                    "pm_project_id": str(pm_project_id),
                    "user_id": str(user_id),
                },
            )


# ---------------------------------------------------------------------------
# 项目干系人 PpmProjectStakeholder
# ---------------------------------------------------------------------------

_STAKEHOLDER_SORT_FIELDS: set[str] = {
    "created_at",
    "updated_at",
    "stakeholder",
    "stakeholder_role",
}


class ProjectStakeholderService:
    """项目干系人 CRUD。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def create(
        self,
        data: ProjectStakeholderCreate,
        *,
        operator: uuid.UUID,
    ) -> PpmProjectStakeholder:
        entity = PpmProjectStakeholder(
            id=uuid.uuid4(),
            create_name=data.create_name,
            stakeholder=data.stakeholder,
            stakeholder_role=data.stakeholder_role,
            phone=data.phone,
            pm_project_id=data.pm_project_id,
            created_by=operator,
            updated_by=operator,
        )
        self._session.add(entity)
        await self._session.commit()
        await self._session.refresh(entity)
        log.info(
            "ppm_project_stakeholder_created",
            stakeholder_id=str(entity.id),
            project_id=str(data.pm_project_id),
        )
        return entity

    async def update(
        self,
        entity_id: uuid.UUID,
        data: ProjectStakeholderUpdate,
        *,
        operator: uuid.UUID,
    ) -> PpmProjectStakeholder:
        entity = await self.get(entity_id)
        payload = data.model_dump(exclude_unset=True)
        for key, value in payload.items():
            setattr(entity, key, value)
        entity.updated_by = operator
        entity.updated_at = _now()
        await self._session.commit()
        await self._session.refresh(entity)
        return entity

    async def delete(self, entity_id: uuid.UUID) -> None:
        entity = await self.get(entity_id)
        await self._session.delete(entity)
        await self._session.commit()

    async def get(self, entity_id: uuid.UUID) -> PpmProjectStakeholder:
        entity = await self._session.get(PpmProjectStakeholder, entity_id)
        if entity is None:
            raise PpmProjectStakeholderNotFound(f"项目干系人 '{entity_id}' 不存在")
        return entity

    async def page(
        self,
        req: ProjectStakeholderPageReq,
    ) -> Page[PpmProjectStakeholder]:
        stmt = select(PpmProjectStakeholder)
        if req.pm_project_id is not None:
            stmt = stmt.where(PpmProjectStakeholder.pm_project_id == req.pm_project_id)
        if req.stakeholder:
            stmt = stmt.where(PpmProjectStakeholder.stakeholder.like(f"%{req.stakeholder}%"))
        if req.stakeholder_role:
            stmt = stmt.where(PpmProjectStakeholder.stakeholder_role == req.stakeholder_role)
        total = await count_total(self._session, stmt)
        stmt = apply_sort(
            stmt,
            PpmProjectStakeholder,
            req.order_by,
            _STAKEHOLDER_SORT_FIELDS,
            req.order,
        )
        stmt = apply_pagination(stmt, _to_page_req(req))
        result = await self._session.execute(stmt)
        items = list(result.scalars().all())
        return Page.build(items=items, total=total, req=_to_page_req(req))


__all__ = [
    "CustomerMaintenanceService",
    "PpmCustomerNotFound",
    "PpmProjectCodeDuplicate",
    "PpmProjectError",
    "PpmProjectMemberDuplicate",
    "PpmProjectMemberNotFound",
    "PpmProjectNotFound",
    "PpmProjectStakeholderNotFound",
    "ProjectMaintenanceService",
    "ProjectMemberService",
    "ProjectStakeholderService",
]
