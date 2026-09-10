"""``/api/mcp-servers*`` — MCP 中央资产库 13 端点 + 双层权限矩阵。

Change: 2026-09-10-mcp-central-registry（task-03 / design「接口定义」节 REST 清单
——13 端点的唯一权威，逐项对照无发明）。CRUD/binding 端点薄封装转调
``McpRegistryService`` 六方法（task-02，禁止在 router 重新发明业务规则）；
导入/模板/诊断端点对 importer / templates / render 用**函数体内惰性 import**
委托（先例 ``settings/router.py:89``），内部逻辑分别归 task-08/09/10/04——
对应模块尚未落地时捕获 ImportError 转 501（落地后移除该回退）。

权限矩阵（design REST 端点注释）：
- 读与我的库操作：任意登录用户（``CurrentUser`` = ``get_current_user``）；
- 平台库写：创建 ``scope=platform``、平台 server 的更新删除、platform 绑定
  解绑由 service 层 ``_require_admin`` 抛 ``PermissionDenied`` 403（与
  ``require_permission_any(SETTINGS_ADMIN)`` 同权限点同判定链，task-02 已单测）；
  scope 在请求体的导入两端点（import-json / workspace-import-apply）在 router
  侧先落同一 admin 门（``_require_admin_for_platform_scope``）——委托目标是
  importer（后续 task），权限门收敛在本层，不依赖委托方自行实现；
- 平台注入集诊断（GET /diagnostics，读全平台绑定态与各 workspace .mcp.json）：
  ``SettingsAdminUser``；
- 跨用户私有库：service 抛 404，与「不存在」同错误码防存在性枚举（对齐
  ``skills/service.py`` 先例）。

路由顺序铁律：静态段路由（/import-json、/workspace-scan、/workspace-import-apply、
/templates、/diagnostics）必须声明在 ``/{server_id}`` 参数路由**之前**——FastAPI
按声明序匹配，否则 GET /mcp-servers/templates 会被 GET /mcp-servers/{server_id}
的 UUID 解析吞成 422（tests/test_router.py 路由序断言钉死此约束）。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user, require_permission_any
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.mcp_registry.schema import (
    McpBindingCreate,
    McpDiagnostic,
    McpImportRequest,
    McpImportResult,
    McpServerCreate,
    McpServerDetail,
    McpServerList,
    McpServerUpdate,
    McpTemplateCreate,
    McpTemplateList,
    McpTemplateRead,
    McpWorkspaceCandidate,
    McpWorkspaceImportApplyRequest,
    McpWorkspaceScanRequest,
)
from app.modules.mcp_registry.service import McpRegistryService, ScopeFilter

router = APIRouter(tags=["mcp-registry"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
# 读与我的库操作：任意登录用户（skills/router.py:41 同款）。
CurrentUser = Annotated[User, Depends(get_current_user)]
# 平台注入集诊断等平台全局视图：SETTINGS_ADMIN（settings/router.py:55 同款）。
_settings_admin_check = require_permission_any(Permission.SETTINGS_ADMIN)
SettingsAdminUser = Annotated[User, Depends(_settings_admin_check)]


async def _require_admin_for_platform_scope(session: AsyncSession, user: User, scope: str) -> None:
    """scope 在请求体的平台库写端点（import-json / apply）的 admin 门。

    直调 ``require_permission_any(SETTINGS_ADMIN)`` 返回的 checker（Annotated
    元数据对直调无效果，传已解析的 user/session 即同判定链）；scope=mine 不设门。
    service.create_server 侧另有同权限点校验（task-02，纵深防御），此处收敛是为了
    委托给 importer（task-08/09）的端点在委托目标落地时即自带权限门。
    """
    if scope == "platform":
        await _settings_admin_check(user=user, session=session)


# ── 静态段（路由顺序铁律：必须先于 /{server_id} 参数路由声明）────────────────


@router.post("/mcp-servers/import-json", response_model=McpImportResult)
async def import_servers_from_json(
    payload: McpImportRequest,
    session: SessionDep,
    user: CurrentUser,
) -> McpImportResult:
    """JSON 粘贴导入：``{json_text, scope} → {imported, skipped, renamed}``。

    惰性委托 ``importer.import_from_json(session, json_text, scope, user)``（task-08
    落地；签名以 task-08 卡为准）。
    """
    await _require_admin_for_platform_scope(session, user, payload.scope)
    try:
        from app.modules.mcp_registry.importer import import_from_json
    except ImportError as exc:  # task-08 落地后移除 501 回退
        raise HTTPException(status_code=501, detail="JSON 导入能力尚未实现（task-08）。") from exc
    return await import_from_json(session, payload.json_text, payload.scope, user)


@router.post("/mcp-servers/workspace-scan", response_model=list[McpWorkspaceCandidate])
async def scan_workspaces_for_import(
    payload: McpWorkspaceScanRequest,
    session: SessionDep,
    user: CurrentUser,
) -> list[McpWorkspaceCandidate]:
    """workspace 扫描（只读候选列表，含去重判定；``{workspace_id?}`` 缺省=全部）。

    惰性委托 ``importer.scan_workspaces(session, workspace_id, user)``（task-09
    落地；签名以 task-09 卡为准）。
    """
    try:
        from app.modules.mcp_registry.importer import scan_workspaces
    except ImportError as exc:  # task-09 落地后移除 501 回退
        raise HTTPException(
            status_code=501, detail="workspace 扫描导入能力尚未实现（task-09）。"
        ) from exc
    return await scan_workspaces(session, payload.workspace_id, user)


@router.post("/mcp-servers/workspace-import-apply", response_model=McpImportResult)
async def apply_workspace_import(
    payload: McpWorkspaceImportApplyRequest,
    session: SessionDep,
    user: CurrentUser,
) -> McpImportResult:
    """应用扫描候选（``{candidates, scope}`` → 应用结果；apply 才落库）。

    惰性委托 ``importer.apply_workspace_import(session, candidates, scope, user)``
    （task-09 落地；签名以 task-09 卡为准）。
    """
    await _require_admin_for_platform_scope(session, user, payload.scope)
    try:
        from app.modules.mcp_registry.importer import apply_workspace_import
    except ImportError as exc:  # task-09 落地后移除 501 回退
        raise HTTPException(
            status_code=501, detail="workspace 导入应用能力尚未实现（task-09）。"
        ) from exc
    return await apply_workspace_import(session, payload.candidates, payload.scope, user)


@router.get("/mcp-servers/templates", response_model=McpTemplateList)
async def list_templates(session: SessionDep, user: CurrentUser) -> McpTemplateList:
    """模板列表（平台预置 + 本人自存；跨用户自存不出现）。

    惰性委托 ``templates.list_templates(session, user)``（task-10 落地）。
    """
    try:
        from app.modules.mcp_registry.templates import list_templates
    except ImportError as exc:  # task-10 落地后移除 501 回退
        raise HTTPException(status_code=501, detail="模板能力尚未实现（task-10）。") from exc
    return await list_templates(session, user)


@router.post(
    "/mcp-servers/templates",
    response_model=McpTemplateRead,
    status_code=status.HTTP_201_CREATED,
)
async def save_template(
    payload: McpTemplateCreate,
    session: SessionDep,
    user: CurrentUser,
) -> McpTemplateRead:
    """存为模板：``{name, from_server_id | server_config}``（双形态互斥）。

    惰性委托 ``templates.save_template(session, payload, user)``（task-10 落地）。
    """
    try:
        from app.modules.mcp_registry.templates import save_template
    except ImportError as exc:  # task-10 落地后移除 501 回退
        raise HTTPException(status_code=501, detail="模板能力尚未实现（task-10）。") from exc
    return await save_template(session, payload, user)


@router.get("/mcp-servers/diagnostics", response_model=list[McpDiagnostic])
async def get_diagnostics(
    session: SessionDep,
    _user: SettingsAdminUser,
) -> list[McpDiagnostic]:
    """平台注入集预检结果（D-011 五项；读全平台绑定态与 workspace .mcp.json，
    平台全局视图挂 SETTINGS_ADMIN）。

    惰性委托 ``render.precheck_diagnostics(session)``（task-04 落地）。
    """
    try:
        from app.modules.mcp_registry.render import precheck_diagnostics
    except ImportError as exc:  # task-04 落地后移除 501 回退
        raise HTTPException(status_code=501, detail="诊断预检能力尚未实现（task-04）。") from exc
    return await precheck_diagnostics(session)


# ── 列表 / 创建（无参数段）──────────────────────────────────────────────────


@router.get("/mcp-servers", response_model=McpServerList)
async def list_servers(
    session: SessionDep,
    user: CurrentUser,
    scope: ScopeFilter = "visible",
    search: str | None = None,
    tag: str | None = None,
) -> McpServerList:
    """列表（env 脱敏 + 绑定态 + 诊断徽标；``?scope=platform|mine|visible``）。"""
    return await McpRegistryService(session).list_servers(scope, user, search=search, tag=tag)


@router.post(
    "/mcp-servers",
    response_model=McpServerDetail,
    status_code=status.HTTP_201_CREATED,
)
async def create_server(
    payload: McpServerCreate,
    session: SessionDep,
    user: CurrentUser,
) -> McpServerDetail:
    """创建（``scope=platform`` 需 admin、stdio-only、secret 键抽列加密——service 层）。"""
    return await McpRegistryService(session).create_server(payload, user)


# ── 参数段（/{server_id}——必须声明在上方静态段之后）────────────────────────


@router.get("/mcp-servers/{server_id}", response_model=McpServerDetail)
async def get_server(
    server_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
) -> McpServerDetail:
    """详情（env 脱敏 + encrypted_env ct 遮蔽；跨用户私有 404 由 service 保证）。

    service 六方法契约（task-02 provides）无公开 detail getter——此处组合
    ``_get_server``（读可见性守卫，跨用户私有 404 防枚举）与 ``_to_detail``
    （DTO 组装 + 绑定态注入），两者均为 task-02 已单测能力，router 不重查表。
    """
    svc = McpRegistryService(session)
    row = await svc._get_server(server_id, user)
    return await svc._to_detail(row, user)


@router.patch("/mcp-servers/{server_id}", response_model=McpServerDetail)
async def update_server(
    server_id: uuid.UUID,
    payload: McpServerUpdate,
    session: SessionDep,
    user: CurrentUser,
) -> McpServerDetail:
    """部分更新（平台 server 需 admin、换 server_config 重加密——service 层）。"""
    return await McpRegistryService(session).update_server(server_id, payload, user)


@router.delete("/mcp-servers/{server_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_server(
    server_id: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
) -> None:
    """删除（平台 server 需 admin；binding 级联删靠 FK CASCADE——service 层）。"""
    await McpRegistryService(session).delete_server(server_id, user)


@router.post(
    "/mcp-servers/{server_id}/bindings",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def add_binding(
    server_id: uuid.UUID,
    payload: McpBindingCreate,
    session: SessionDep,
    user: CurrentUser,
) -> None:
    """加绑定 ``{scope_type}``（platform 需 admin；user 校验归属——service 层）。"""
    await McpRegistryService(session).add_binding(server_id, payload.scope_type, user)


@router.delete(
    "/mcp-servers/{server_id}/bindings/{scope_type}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_binding(
    server_id: uuid.UUID,
    scope_type: str,
    session: SessionDep,
    user: CurrentUser,
) -> None:
    """解绑（platform 需 admin——service 层；design ``/bindings/{scope_type}`` 形态）。"""
    await McpRegistryService(session).remove_binding(server_id, scope_type, None, user)


@router.delete(
    "/mcp-servers/{server_id}/bindings/{scope_type}/{scope_ref}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def remove_binding_with_ref(
    server_id: uuid.UUID,
    scope_type: str,
    scope_ref: uuid.UUID,
    session: SessionDep,
    user: CurrentUser,
) -> None:
    """解绑（带 scope_ref 精确删——design ``/bindings/{scope_type}[/scope_ref]``
    的可选尾段形态；user 解绑 scope_ref=本人即可，解他人的需 admin——service 层）。"""
    await McpRegistryService(session).remove_binding(server_id, scope_type, scope_ref, user)
