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

from sqlalchemy import Select, exists, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import AppError
from app.core.logging import get_logger
from app.core.permission_cache import invalidate_all_permissions
from app.modules.auth.model import User
from app.modules.ppm.common.crud import (
    Page,
    PageReq,
    apply_pagination,
    apply_sort,
    count_total,
)
from app.modules.ppm.data_scope import DataScope, build_project_scope_clause
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
    ProjectMemberResp,
    ProjectMemberSummaryItem,
    ProjectMemberSummaryPageReq,
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


def _parse_uuid_optional(value: str | uuid.UUID | None) -> uuid.UUID | None:
    """把查询参数容错规整为 UUID。

    前端可能传占位符(如 "-"、"")或非法字符串(已选项目前传 "-" 拉空),
    这里 try-parse:能解析则返回 UUID,否则返回 None(等价于不过滤),
    避免 SQLAlchemy 比较 / 422。
    """
    if value is None:
        return None
    if isinstance(value, uuid.UUID):
        return value
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        return None


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

# 成员聚合排序白名单:派生列 owner_name/member_count 不进白名单 (D-005@v1,
# 不做成员数排序);仅项目表自身业务字段。
_MEMBER_SUMMARY_SORT_FIELDS: set[str] = {
    "updated_at",
    "created_at",
    "project_name",
    "project_code",
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
        operator_name: str | None = None,
    ) -> PpmProjectMaintenance:
        # project_code 唯一约束预检 (更友好的 409,而非 IntegrityError 500)
        await self._assert_code_available(data.project_code)
        # create_name 是系统字段(创建人姓名,design 约定不进表单由系统带出);
        # 前端不传时按当前登录用户姓名(operator_name)自动填充,避免创建人列为空。
        create_name = data.create_name or operator_name
        entity = PpmProjectMaintenance(
            id=uuid.uuid4(),
            create_name=create_name,
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
        scope: DataScope,
    ) -> Page[PpmProjectMaintenance]:
        stmt = select(PpmProjectMaintenance)
        stmt = self._apply_filters(stmt, req)
        # 数据范围过滤 (2026-07-18-project-plan-data-scope D-006@v1)
        project_scope = build_project_scope_clause(scope)
        if project_scope is not None:
            stmt = stmt.where(project_scope)
        total = await count_total(self._session, stmt)
        # 默认按创建时间降序(最新在前);前端显式传 order_by 时尊重前端选择
        order_by = req.order_by or "created_at"
        stmt = apply_sort(
            stmt,
            PpmProjectMaintenance,
            order_by,
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

    async def member_summary(
        self,
        req: ProjectMemberSummaryPageReq,
    ) -> Page[ProjectMemberSummaryItem]:
        """项目成员聚合查询 (design §7.2)。

        派生列:
        - owner_name:该项目 role_name ilike '%项目经理%' 的成员,取 created_at
          最早;无则 None (标量子查询)。
        - member_count:该项目成员行数 (标量子查询)。

        筛选:
        - project_name/project_status/project_type 直接作用项目表;
        - owner_name/member_keyword/role_name 用 EXISTS 子查询匹配项目下成员。
        """
        # 负责人姓名标量子查询 (多 PM 取 created_at 最早)
        owner_subq = (
            select(PpmProjectMember.user_name)
            .where(
                PpmProjectMember.pm_project_id == PpmProjectMaintenance.id,
                PpmProjectMember.role_name.ilike("%项目经理%"),
            )
            .order_by(PpmProjectMember.created_at.asc())
            .limit(1)
            .scalar_subquery()
        )
        # 成员数标量子查询
        count_subq = (
            select(func.count())
            .select_from(PpmProjectMember)
            .where(PpmProjectMember.pm_project_id == PpmProjectMaintenance.id)
            .scalar_subquery()
        )
        stmt = select(
            PpmProjectMaintenance.id,
            PpmProjectMaintenance.project_name,
            PpmProjectMaintenance.project_code,
            PpmProjectMaintenance.project_status,
            PpmProjectMaintenance.project_type,
            PpmProjectMaintenance.company_name,
            owner_subq.label("owner_name"),
            count_subq.label("member_count"),
            PpmProjectMaintenance.updated_at,
        )
        # 项目表直接筛选 (沿用 _apply_filters 模式)
        if req.project_name:
            stmt = stmt.where(PpmProjectMaintenance.project_name.like(f"%{req.project_name}%"))
        if req.project_status:
            stmt = stmt.where(PpmProjectMaintenance.project_status == req.project_status)
        if req.project_type:
            stmt = stmt.where(PpmProjectMaintenance.project_type == req.project_type)
        # EXISTS 筛选:owner_name (项目经理 + user_name 匹配)
        if req.owner_name:
            stmt = stmt.where(
                exists(
                    select(PpmProjectMember.id).where(
                        PpmProjectMember.pm_project_id == PpmProjectMaintenance.id,
                        PpmProjectMember.role_name.ilike("%项目经理%"),
                        PpmProjectMember.user_name.like(f"%{req.owner_name}%"),
                    )
                )
            )
        # EXISTS 筛选:role_name (成员角色 ilike)
        if req.role_name:
            stmt = stmt.where(
                exists(
                    select(PpmProjectMember.id).where(
                        PpmProjectMember.pm_project_id == PpmProjectMaintenance.id,
                        PpmProjectMember.role_name.ilike(f"%{req.role_name}%"),
                    )
                )
            )
        # EXISTS 筛选:member_keyword (成员 user_name 或 users.username 匹配)
        if req.member_keyword:
            kw = f"%{req.member_keyword}%"
            stmt = stmt.where(
                exists(
                    select(PpmProjectMember.id)
                    .outerjoin(User, User.id == PpmProjectMember.user_id)
                    .where(
                        PpmProjectMember.pm_project_id == PpmProjectMaintenance.id,
                        (PpmProjectMember.user_name.like(kw)) | (User.username.like(kw)),
                    )
                )
            )
        total = await count_total(self._session, stmt)
        stmt = apply_sort(
            stmt,
            PpmProjectMaintenance,
            req.order_by,
            _MEMBER_SUMMARY_SORT_FIELDS,
            req.order,
        )
        stmt = apply_pagination(stmt, _to_page_req(req))
        result = await self._session.execute(stmt)
        items = [
            ProjectMemberSummaryItem(
                id=row.id,
                project_name=row.project_name,
                project_code=row.project_code,
                project_status=row.project_status,
                project_type=row.project_type,
                company_name=row.company_name,
                owner_name=row.owner_name,  # 无 PM 时为 None
                member_count=int(row.member_count or 0),
                updated_at=row.updated_at,
            )
            for row in result.all()
        ]
        return Page.build(items=items, total=total, req=_to_page_req(req))

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
        # D-002@v2:PpmProjectMember 写入影响经理 project_ids,必须清 ppm-scope:* + perm:*
        await invalidate_all_permissions()
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
        # D-002@v2:PpmProjectMember 写入影响经理 project_ids,必须清 ppm-scope:* + perm:*
        await invalidate_all_permissions()
        return entity

    async def delete(self, entity_id: uuid.UUID) -> None:
        entity = await self.get(entity_id)
        await self._session.delete(entity)
        await self._session.commit()
        # D-002@v2:PpmProjectMember 写入影响经理 project_ids,必须清 ppm-scope:* + perm:*
        await invalidate_all_permissions()

    async def get(self, entity_id: uuid.UUID) -> PpmProjectMember:
        entity = await self._session.get(PpmProjectMember, entity_id)
        if entity is None:
            raise PpmProjectMemberNotFound(f"项目成员 '{entity_id}' 不存在")
        return entity

    async def page(self, req: ProjectMemberPageReq) -> Page[ProjectMemberResp]:
        """分页查询,LEFT JOIN users 带出登录账号 username (design §7.3)。

        service 层直接构造 ``ProjectMemberResp`` (含 username),router 无需再
        model_validate。``User.username`` 可空,LEFT JOIN 无对应用户时为 None。
        """
        stmt = select(PpmProjectMember, User.username).outerjoin(
            User, User.id == PpmProjectMember.user_id
        )
        pm_project_id = _parse_uuid_optional(req.pm_project_id)
        if pm_project_id is not None:
            stmt = stmt.where(PpmProjectMember.pm_project_id == pm_project_id)
        user_id = _parse_uuid_optional(req.user_id)
        if user_id is not None:
            stmt = stmt.where(PpmProjectMember.user_id == user_id)
        if req.role_name:
            # role_name 在「项目成员管理」页是多角色逗号拼接存储
            # (D-009@v1,源 multiple-value-type="join",如"开发经理,项目经理,..."),
            # 这里用 ilike 模糊匹配,避免精确匹配漏掉多角色拼接的成员导致下拉「无数据」。
            stmt = stmt.where(PpmProjectMember.role_name.ilike(f"%{req.role_name}%"))
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
        items = [
            ProjectMemberResp(
                id=row.PpmProjectMember.id,
                create_name=row.PpmProjectMember.create_name,
                pm_project_id=row.PpmProjectMember.pm_project_id,
                user_id=row.PpmProjectMember.user_id,
                user_name=row.PpmProjectMember.user_name,
                depart_id=row.PpmProjectMember.depart_id,
                phone=row.PpmProjectMember.phone,
                role_id=row.PpmProjectMember.role_id,
                role_name=row.PpmProjectMember.role_name,
                depart_name=row.PpmProjectMember.depart_name,
                username=row.username,
                created_by=row.PpmProjectMember.created_by,
                updated_by=row.PpmProjectMember.updated_by,
                created_at=row.PpmProjectMember.created_at,
                updated_at=row.PpmProjectMember.updated_at,
            )
            for row in result.all()
        ]
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
        pm_project_id = _parse_uuid_optional(req.pm_project_id)
        if pm_project_id is not None:
            stmt = stmt.where(PpmProjectStakeholder.pm_project_id == pm_project_id)
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
