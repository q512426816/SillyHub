"""只读组件目录 service（D-001@V1，变更 2026-07-06-component-readonly-split）。

组件不再是 ``workspaces`` 表的行，而是项目组 ``projects/*.yaml`` 派生的只读元数据。
本 service 读项目组的 spec_root（解析方式对齐 ``WorkspaceService.reparse``，daemon-client
platform-managed 与 server-local 两模式皆覆盖），用 :class:`WorkspaceParser` 解析
``projects/*.yaml``，丢弃 relations，返回 ``ComponentRead`` 列表，并过滤项目组自身。

不再触碰 ``workspaces`` 表的 component_key 行——组件没有 workspace 身份，写端点天然挡住。
"""

from __future__ import annotations

import uuid

from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.workspace.parser import ParsedWorkspace, WorkspaceParser


class ComponentRead(BaseModel):
    """单个只读组件的响应 DTO（对齐 design §7.1）。"""

    component_key: str = Field(..., max_length=100)
    name: str
    path: str | None = None
    type: str | None = None
    role: str | None = None
    tech_stack: list[str] = Field(default_factory=list)
    status: str = "active"


class ComponentListResponse(BaseModel):
    """``GET /workspaces/{id}/components`` 响应。"""

    items: list[ComponentRead]
    total: int


def _to_component(pw: ParsedWorkspace) -> ComponentRead:
    """ParsedWorkspace → ComponentRead。"""
    return ComponentRead(
        component_key=pw.component_key,
        name=pw.name,
        path=pw.path,
        type=pw.type,
        role=pw.role,
        tech_stack=list(pw.tech_stack),
        status=pw.status,
    )


class ComponentCatalogService:
    """只读组件目录：从 ``projects/*.yaml`` 派生组件清单。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def list_components(self, workspace_id: uuid.UUID) -> list[ComponentRead]:
        """列出项目组下的一级子项目组件（只读）。

        步骤：
        1. 取项目组 workspace（``WorkspaceService.get``，缺失抛 ``WorkspaceNotFound``）。
        2. 解析 spec_root——platform-managed 用 ``spec_ws.spec_root``，否则回退到
           容器可读的 ``_rewrite_path(ws.root_path)``（与 ``reparse`` 完全一致，
           daemon-client 兼容，参考 memory ``runtime-read-broken-daemon-client``）。
        3. ``WorkspaceParser().parse(root)``，只取 ``workspaces``，丢弃 ``relations``。
        4. 过滤项目组自身（component_key 命中 ws.name/slug 的条目），返回一级子项目。
        """
        # 延迟 import：service.py 较重，且避免与 router 的 import 顺序耦合
        from app.modules.spec_workspace.service import SpecWorkspaceService
        from app.modules.workspace.service import WorkspaceService, _rewrite_path

        ws = await WorkspaceService(self._session).get(workspace_id)

        # 1. 解析 spec_root（镜像 WorkspaceService.reparse 的 proven 路径）
        spec_ws_svc = SpecWorkspaceService(self._session)
        parse_root: str | None = None
        try:
            spec_ws = await spec_ws_svc.get(ws.id)
            if spec_ws.strategy == "platform-managed" and spec_ws.spec_root:
                parse_root = spec_ws.spec_root
        except Exception:
            pass
        root_path = parse_root or _rewrite_path(ws.root_path)

        # 2. 纯函数解析 projects/*.yaml（无 DB 副作用）
        parser = WorkspaceParser()
        parse_result = parser.parse(root_path)

        # 3. 过滤项目组自身（防御性：generate_projects 不产自 yaml，但手写 yaml 可能存在）
        own_keys = {k.lower() for k in (ws.name, ws.slug) if k}
        components = [
            _to_component(pw)
            for pw in parse_result.workspaces
            if pw.component_key.lower() not in own_keys
        ]
        return components

    @staticmethod
    def to_response(components: list[ComponentRead]) -> ComponentListResponse:
        """包装为 ``ComponentListResponse``。"""
        return ComponentListResponse(items=components, total=len(components))
