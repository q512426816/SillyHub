"""pm 项目管理子域 router。

4 个子前缀 + simple-list + export-excel:
- /project-maintenance
- /customer-maintenance
- /project-member
- /project-stakeholder

鉴权:统一 ``require_permission_any(Permission.PPM_PROJECT_*)``。
member/stakeholder 复用 PROJECT_* 权限 (design §7)。导出端点为同步 ``def``
以避开 openpyxl 阻塞事件循环 (X-002)。

设计依据:``design.md`` §7/§13 X-002,task-03.md。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission_any
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.ppm.common.crud import Page, PageReq
from app.modules.ppm.common.export import (
    ColumnDef,
    excel_response,
    rows_to_workbook,
    timestamped_filename,
)
from app.modules.ppm.project import service as svc
from app.modules.ppm.project.schema import (
    CustomerMaintenanceCreate,
    CustomerMaintenancePageReq,
    CustomerMaintenanceResp,
    CustomerMaintenanceUpdate,
    ProjectMaintenanceCreate,
    ProjectMaintenancePageReq,
    ProjectMaintenanceResp,
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
    ProjectStakeholderResp,
    ProjectStakeholderUpdate,
)

router = APIRouter(tags=["ppm-project"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]

# 读权限 (member/stakeholder 复用)
_PROJECT_READ = Depends(require_permission_any(Permission.PPM_PROJECT_READ))
_PROJECT_WRITE = Depends(require_permission_any(Permission.PPM_PROJECT_WRITE))
_PROJECT_DELETE = Depends(require_permission_any(Permission.PPM_PROJECT_DELETE))
_PROJECT_EXPORT = Depends(require_permission_any(Permission.PPM_PROJECT_EXPORT))
_CUSTOMER_READ = Depends(require_permission_any(Permission.PPM_CUSTOMER_READ))
_CUSTOMER_WRITE = Depends(require_permission_any(Permission.PPM_CUSTOMER_WRITE))
_CUSTOMER_DELETE = Depends(require_permission_any(Permission.PPM_CUSTOMER_DELETE))
_CUSTOMER_EXPORT = Depends(require_permission_any(Permission.PPM_CUSTOMER_EXPORT))


def _build_workbook_bytes(
    columns: list[ColumnDef],
    rows: list[dict],
    sheet_name: str,
) -> bytes:
    """在线程池中调用 openpyxl 序列化 (X-002)。"""
    return rows_to_workbook(columns, rows, sheet_name=sheet_name)


def _excel_stream(content: bytes, filename: str) -> StreamingResponse:
    """把 .xlsx 字节包成下载响应。"""
    return excel_response(content, filename=filename)


# ---------------------------------------------------------------------------
# 项目维护
# ---------------------------------------------------------------------------


@router.post(
    "/project-maintenance",
    response_model=ProjectMaintenanceResp,
    status_code=status.HTTP_201_CREATED,
)
async def create_project_maintenance(
    body: ProjectMaintenanceCreate,
    session: SessionDep,
    user: Annotated[User, _PROJECT_WRITE],
) -> ProjectMaintenanceResp:
    s = svc.ProjectMaintenanceService(session)
    entity = await s.create(body, operator=user.id)
    return ProjectMaintenanceResp.model_validate(entity)


@router.put(
    "/project-maintenance/{entity_id}",
    response_model=ProjectMaintenanceResp,
)
async def update_project_maintenance(
    entity_id: uuid.UUID,
    body: ProjectMaintenanceUpdate,
    session: SessionDep,
    user: Annotated[User, _PROJECT_WRITE],
) -> ProjectMaintenanceResp:
    s = svc.ProjectMaintenanceService(session)
    entity = await s.update(entity_id, body, operator=user.id)
    return ProjectMaintenanceResp.model_validate(entity)


@router.delete(
    "/project-maintenance/{entity_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_project_maintenance(
    entity_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, _PROJECT_DELETE],
) -> None:
    s = svc.ProjectMaintenanceService(session)
    await s.delete(entity_id)


# 注意:具体路径 (simple-list / export-excel / 列表) 必须声明在
# ``{entity_id}`` GET 之前,否则 ``simple-list`` 会被当 entity_id 解析为
# UUID 失败 (422)。FastAPI 按声明顺序匹配。


@router.get(
    "/project-maintenance",
    response_model=Page[ProjectMaintenanceResp],
)
async def page_project_maintenance(
    session: SessionDep,
    user: Annotated[User, _PROJECT_READ],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    order_by: str | None = Query(None),
    order: str = Query("desc"),
    project_name: str | None = Query(None),
    project_code: str | None = Query(None),
    project_status: str | None = Query(None),
    project_type: str | None = Query(None),
) -> Page[ProjectMaintenanceResp]:
    req = ProjectMaintenancePageReq(
        page=page,
        page_size=page_size,
        order_by=order_by,
        order=order,
        project_name=project_name,
        project_code=project_code,
        project_status=project_status,
        project_type=project_type,
    )
    s = svc.ProjectMaintenanceService(session)
    result = await s.page(req)
    return Page.build(
        items=[ProjectMaintenanceResp.model_validate(item) for item in result.items],
        total=result.total,
        req=PageReq(page=page, page_size=page_size, order_by=order_by, order=order),
    )


@router.get(
    "/project-maintenance/simple-list",
    response_model=list[ProjectSimpleItem],
)
async def simple_list_project_maintenance(
    session: SessionDep,
    user: Annotated[User, _PROJECT_READ],
) -> list[ProjectSimpleItem]:
    """项目下拉 (仅 id + project_name)。"""
    s = svc.ProjectMaintenanceService(session)
    return await s.simple_list()


@router.get("/project-maintenance/export-excel")
async def export_project_maintenance(
    session: SessionDep,
    user: Annotated[User, _PROJECT_EXPORT],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    order_by: str | None = Query(None),
    order: str = Query("desc"),
    project_name: str | None = Query(None),
    project_code: str | None = Query(None),
    project_status: str | None = Query(None),
    project_type: str | None = Query(None),
) -> StreamingResponse:
    """导出当前查询结果为 .xlsx。

    openpyxl 是同步 CPU 库,会阻塞事件循环;按 design §13 X-002,这里在
    async 端点内用 ``anyio.to_thread.run_sync`` 把序列化丢到线程池,DB
    查询仍走 async session。
    """
    import anyio

    req = ProjectMaintenancePageReq(
        page=page,
        page_size=page_size,
        order_by=order_by,
        order=order,
        project_name=project_name,
        project_code=project_code,
        project_status=project_status,
        project_type=project_type,
    )
    s = svc.ProjectMaintenanceService(session)
    result = await s.page(req)
    columns = [
        ColumnDef("project_code", "项目编号", width=20),
        ColumnDef("project_name", "项目名称", width=30),
        ColumnDef("company_name", "公司名称", width=30),
        ColumnDef("project_status", "项目状态", width=14),
        ColumnDef("project_type", "项目类型", width=14),
        ColumnDef("create_name", "创建人", width=14),
    ]
    rows = [ProjectMaintenanceResp.model_validate(item).model_dump() for item in result.items]
    content = await anyio.to_thread.run_sync(
        lambda: _build_workbook_bytes(columns, rows, "项目维护")
    )
    return _excel_stream(content, timestamped_filename("项目维护"))


@router.get(
    "/project-maintenance/member-summary",
    response_model=Page[ProjectMemberSummaryItem],
)
async def page_project_member_summary(
    session: SessionDep,
    user: Annotated[User, _PROJECT_READ],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    order_by: str | None = Query(None),
    order: str = Query("desc"),
    project_name: str | None = Query(None),
    project_status: str | None = Query(None),
    project_type: str | None = Query(None),
    owner_name: str | None = Query(None),
    member_keyword: str | None = Query(None),
    role_name: str | None = Query(None),
) -> Page[ProjectMemberSummaryItem]:
    """项目成员聚合 (派生 owner_name/member_count + 多维筛选)。

    必须声明在 ``/{entity_id}`` GET 之前 (路径优先级见 :134 注释),否则
    ``member-summary`` 会被当 entity_id 解析为 UUID 失败 (422)。
    """
    req = ProjectMemberSummaryPageReq(
        page=page,
        page_size=page_size,
        order_by=order_by,
        order=order,
        project_name=project_name,
        project_status=project_status,
        project_type=project_type,
        owner_name=owner_name,
        member_keyword=member_keyword,
        role_name=role_name,
    )
    s = svc.ProjectMaintenanceService(session)
    return await s.member_summary(req)


@router.get(
    "/project-maintenance/{entity_id}",
    response_model=ProjectMaintenanceResp,
)
async def get_project_maintenance(
    entity_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, _PROJECT_READ],
) -> ProjectMaintenanceResp:
    s = svc.ProjectMaintenanceService(session)
    entity = await s.get(entity_id)
    return ProjectMaintenanceResp.model_validate(entity)


# ---------------------------------------------------------------------------
# 客户维护
# ---------------------------------------------------------------------------


@router.post(
    "/customer-maintenance",
    response_model=CustomerMaintenanceResp,
    status_code=status.HTTP_201_CREATED,
)
async def create_customer_maintenance(
    body: CustomerMaintenanceCreate,
    session: SessionDep,
    user: Annotated[User, _CUSTOMER_WRITE],
) -> CustomerMaintenanceResp:
    s = svc.CustomerMaintenanceService(session)
    entity = await s.create(body, operator=user.id)
    return CustomerMaintenanceResp.model_validate(entity)


@router.put(
    "/customer-maintenance/{entity_id}",
    response_model=CustomerMaintenanceResp,
)
async def update_customer_maintenance(
    entity_id: uuid.UUID,
    body: CustomerMaintenanceUpdate,
    session: SessionDep,
    user: Annotated[User, _CUSTOMER_WRITE],
) -> CustomerMaintenanceResp:
    s = svc.CustomerMaintenanceService(session)
    entity = await s.update(entity_id, body, operator=user.id)
    return CustomerMaintenanceResp.model_validate(entity)


@router.delete(
    "/customer-maintenance/{entity_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_customer_maintenance(
    entity_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, _CUSTOMER_DELETE],
) -> None:
    s = svc.CustomerMaintenanceService(session)
    await s.delete(entity_id)


# 具体路径 (export-excel / 列表) 优先于 {entity_id} (见 project 段注释)


@router.get(
    "/customer-maintenance",
    response_model=Page[CustomerMaintenanceResp],
)
async def page_customer_maintenance(
    session: SessionDep,
    user: Annotated[User, _CUSTOMER_READ],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    order_by: str | None = Query(None),
    order: str = Query("desc"),
    company_name: str | None = Query(None),
    contact: str | None = Query(None),
    level: str | None = Query(None),
) -> Page[CustomerMaintenanceResp]:
    req = CustomerMaintenancePageReq(
        page=page,
        page_size=page_size,
        order_by=order_by,
        order=order,
        company_name=company_name,
        contact=contact,
        level=level,
    )
    s = svc.CustomerMaintenanceService(session)
    result = await s.page(req)
    return Page.build(
        items=[CustomerMaintenanceResp.model_validate(item) for item in result.items],
        total=result.total,
        req=PageReq(page=page, page_size=page_size, order_by=order_by, order=order),
    )


@router.get("/customer-maintenance/export-excel")
async def export_customer_maintenance(
    session: SessionDep,
    user: Annotated[User, _CUSTOMER_EXPORT],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    order_by: str | None = Query(None),
    order: str = Query("desc"),
    company_name: str | None = Query(None),
    contact: str | None = Query(None),
    level: str | None = Query(None),
) -> StreamingResponse:
    import anyio

    req = CustomerMaintenancePageReq(
        page=page,
        page_size=page_size,
        order_by=order_by,
        order=order,
        company_name=company_name,
        contact=contact,
        level=level,
    )
    s = svc.CustomerMaintenanceService(session)
    result = await s.page(req)
    columns = [
        ColumnDef("company_name", "公司名称", width=30),
        ColumnDef("contact", "联系人", width=14),
        ColumnDef("phone_no", "手机号", width=16),
        ColumnDef("dept_name", "部门", width=20),
        ColumnDef("level", "级别", width=10),
        ColumnDef("create_name", "创建人", width=14),
    ]
    rows = [CustomerMaintenanceResp.model_validate(item).model_dump() for item in result.items]
    content = await anyio.to_thread.run_sync(
        lambda: _build_workbook_bytes(columns, rows, "客户维护")
    )
    return _excel_stream(content, timestamped_filename("客户维护"))


@router.get(
    "/customer-maintenance/{entity_id}",
    response_model=CustomerMaintenanceResp,
)
async def get_customer_maintenance(
    entity_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, _CUSTOMER_READ],
) -> CustomerMaintenanceResp:
    s = svc.CustomerMaintenanceService(session)
    entity = await s.get(entity_id)
    return CustomerMaintenanceResp.model_validate(entity)


# ---------------------------------------------------------------------------
# 项目成员
# ---------------------------------------------------------------------------


@router.post(
    "/project-member",
    response_model=ProjectMemberResp,
    status_code=status.HTTP_201_CREATED,
)
async def create_project_member(
    body: ProjectMemberCreate,
    session: SessionDep,
    user: Annotated[User, _PROJECT_WRITE],
) -> ProjectMemberResp:
    s = svc.ProjectMemberService(session)
    entity = await s.create(body, operator=user.id)
    return ProjectMemberResp.model_validate(entity)


@router.put(
    "/project-member/{entity_id}",
    response_model=ProjectMemberResp,
)
async def update_project_member(
    entity_id: uuid.UUID,
    body: ProjectMemberUpdate,
    session: SessionDep,
    user: Annotated[User, _PROJECT_WRITE],
) -> ProjectMemberResp:
    s = svc.ProjectMemberService(session)
    entity = await s.update(entity_id, body, operator=user.id)
    return ProjectMemberResp.model_validate(entity)


@router.delete(
    "/project-member/{entity_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_project_member(
    entity_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, _PROJECT_DELETE],
) -> None:
    s = svc.ProjectMemberService(session)
    await s.delete(entity_id)


@router.get(
    "/project-member/{entity_id}",
    response_model=ProjectMemberResp,
)
async def get_project_member(
    entity_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, _PROJECT_READ],
) -> ProjectMemberResp:
    s = svc.ProjectMemberService(session)
    entity = await s.get(entity_id)
    return ProjectMemberResp.model_validate(entity)


@router.get(
    "/project-member",
    response_model=Page[ProjectMemberResp],
)
async def page_project_member(
    session: SessionDep,
    user: Annotated[User, _PROJECT_READ],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    order_by: str | None = Query(None),
    order: str = Query("desc"),
    # 容错:str | None,非法值(前端占位 "-")由 service 层规整为 None。
    # 不在 query 层强校验 UUID,避免 422 直接拒绝请求。
    pm_project_id: str | None = Query(None),
    user_id: str | None = Query(None),
    role_name: str | None = Query(None),
) -> Page[ProjectMemberResp]:
    req = ProjectMemberPageReq(
        page=page,
        page_size=page_size,
        order_by=order_by,
        order=order,
        pm_project_id=pm_project_id,
        user_id=user_id,
        role_name=role_name,
    )
    s = svc.ProjectMemberService(session)
    result = await s.page(req)
    # service.page() 已 LEFT JOIN users 并构造 ProjectMemberResp(含 username),
    # 此处无需再 model_validate,result.items 即为 Resp。
    return Page.build(
        items=list(result.items),
        total=result.total,
        req=PageReq(page=page, page_size=page_size, order_by=order_by, order=order),
    )


# ---------------------------------------------------------------------------
# 项目干系人
# ---------------------------------------------------------------------------


@router.post(
    "/project-stakeholder",
    response_model=ProjectStakeholderResp,
    status_code=status.HTTP_201_CREATED,
)
async def create_project_stakeholder(
    body: ProjectStakeholderCreate,
    session: SessionDep,
    user: Annotated[User, _PROJECT_WRITE],
) -> ProjectStakeholderResp:
    s = svc.ProjectStakeholderService(session)
    entity = await s.create(body, operator=user.id)
    return ProjectStakeholderResp.model_validate(entity)


@router.put(
    "/project-stakeholder/{entity_id}",
    response_model=ProjectStakeholderResp,
)
async def update_project_stakeholder(
    entity_id: uuid.UUID,
    body: ProjectStakeholderUpdate,
    session: SessionDep,
    user: Annotated[User, _PROJECT_WRITE],
) -> ProjectStakeholderResp:
    s = svc.ProjectStakeholderService(session)
    entity = await s.update(entity_id, body, operator=user.id)
    return ProjectStakeholderResp.model_validate(entity)


@router.delete(
    "/project-stakeholder/{entity_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_project_stakeholder(
    entity_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, _PROJECT_DELETE],
) -> None:
    s = svc.ProjectStakeholderService(session)
    await s.delete(entity_id)


@router.get(
    "/project-stakeholder/{entity_id}",
    response_model=ProjectStakeholderResp,
)
async def get_project_stakeholder(
    entity_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, _PROJECT_READ],
) -> ProjectStakeholderResp:
    s = svc.ProjectStakeholderService(session)
    entity = await s.get(entity_id)
    return ProjectStakeholderResp.model_validate(entity)


@router.get(
    "/project-stakeholder",
    response_model=Page[ProjectStakeholderResp],
)
async def page_project_stakeholder(
    session: SessionDep,
    user: Annotated[User, _PROJECT_READ],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    order_by: str | None = Query(None),
    order: str = Query("desc"),
    # 容错:同 project-member。
    pm_project_id: str | None = Query(None),
    stakeholder: str | None = Query(None),
    stakeholder_role: str | None = Query(None),
) -> Page[ProjectStakeholderResp]:
    req = ProjectStakeholderPageReq(
        page=page,
        page_size=page_size,
        order_by=order_by,
        order=order,
        pm_project_id=pm_project_id,
        stakeholder=stakeholder,
        stakeholder_role=stakeholder_role,
    )
    s = svc.ProjectStakeholderService(session)
    result = await s.page(req)
    return Page.build(
        items=[ProjectStakeholderResp.model_validate(item) for item in result.items],
        total=result.total,
        req=PageReq(page=page, page_size=page_size, order_by=order_by, order=order),
    )


__all__ = ["router"]
