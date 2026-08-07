"""McpToken workspace 级管理 HTTP API（非 MCP，workspace owner/admin 用）。

design §7.2 / D-002@v1 / task-02。三个端点：

- ``POST   /workspaces/{workspace_id}/mcp-tokens``      签发（明文 token **仅此一次**返回）
- ``GET    /workspaces/{workspace_id}/mcp-tokens``      列出（不返明文，含 last_used_at / revoked_at）
- ``DELETE /workspaces/{workspace_id}/mcp-tokens/{id}`` 吊销（204）

鉴权：三端点均 ``require_permission(Permission.WORKSPACE_WRITE)``（RBAC 层级满足：
WORKSPACE_ADMIN 自动继承 WRITE；viewer 只读 → 403）。``require_permission`` 自动从路径
取 ``{workspace_id}`` 注入 RBAC 闭包（与 agent/profile router 同模式）。

main.py 外层挂 ``prefix="/api"`` → 落地 ``/api/workspaces/{workspace_id}/mcp-tokens``
（G-1 注册步骤）。

DTO 内联在 router（task-02 allowed_paths 未含 schema.py，对齐 daemon/profile router
的内联 DTO 习惯）。响应 DTO 用 ``from_attributes=True`` 直接从 ORM 行构造；``token_hash``
与明文均**不出现在任何响应**（R-06：仅 POST 201 的 ``token`` 字段返回一次明文）。

异常风格：service 抛 ``AppError`` 子类（``McpTokenNotFound`` 404），由全局 ``AppError``
handler 统一序列化，router 不额外捕获。
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Path, status
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.mcp_gateway.service import (
    McpTokenNotFound,
    McpTokenService,
    McpWebhookNotFound,
    McpWebhookService,
)

# design §8.1：scope 取值集合。创建请求用 Literal 收口，非法值 FastAPI 自动 422。
McpScope = Literal["read", "dispatch", "converge"]

# webhook 订阅事件（design §8.2）：worker 终态事件 + "*" 全订阅。
McpWebhookEvent = Literal["worker.completed", "worker.failed", "*"]

router = APIRouter(prefix="/workspaces", tags=["mcp-tokens"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
# 三端点统一 WORKSPACE_WRITE（owner/developer 可管 token，viewer 只读 → 403）。
# require_permission 自动从路径取 {workspace_id} 注入 has_permission 闭包。
WorkspaceWriter = Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))]


# ────────────────────────────────────────────────────────────────────────────
# DTO（请求 / 响应）— 定义在 router（allowed_paths 未含 schema.py）。
# ────────────────────────────────────────────────────────────────────────────


class McpTokenCreateRequest(BaseModel):
    """签发请求。``scope`` 必须非空且取值 ∈ {read, dispatch, converge}。"""

    name: str = Field(min_length=1, max_length=100)
    scope: list[McpScope] = Field(min_length=1, max_length=3)


class McpTokenRead(BaseModel):
    """列表行——所有 GET 都安全返回。绝不包含明文或 ``token_hash``（R-06）。"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    scope: list[str]
    last_used_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime


class McpTokenCreated(BaseModel):
    """POST 201 响应——**唯一**携带明文 token 的地方（仅此一次返回，R-06）。

    不继承 ``McpTokenRead``：明文字段 ``token`` 语义独立（不可重复获取），单独建模
    让"明文只出现一次"的契约在类型上显眼。字段精简到 design §7.2 要求的
    ``{id, token, scope, created_at}``。
    """

    id: uuid.UUID
    token: str = Field(description="明文 token，仅本次响应返回，此后不可恢复（请立即保存）")
    name: str
    scope: list[str]
    created_at: datetime


class McpTokenListResponse(BaseModel):
    items: list[McpTokenRead]


def _service(session: AsyncSession) -> McpTokenService:
    from app.core.config import get_settings

    return McpTokenService(session, settings=get_settings())


# ════════════════════════════════════════════════════════════════════════════
# workspace 级端点：/workspaces/{workspace_id}/mcp-tokens
# ════════════════════════════════════════════════════════════════════════════


@router.post(
    "/{workspace_id}/mcp-tokens",
    response_model=McpTokenCreated,
    status_code=status.HTTP_201_CREATED,
)
async def create_mcp_token(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    payload: McpTokenCreateRequest,
    session: SessionDep,
    user: WorkspaceWriter,
) -> McpTokenCreated:
    """签发新 McpToken（明文 token 仅本次响应返回一次）。

    DB 只存 ``sha256(明文)``（``token_hash`` 唯一索引），不存明文（R-06 / design §8.1）。
    ``created_by`` 记当前操作 user（审计），token 本身无关 user 身份。
    """
    svc = _service(session)
    row, plaintext = await svc.create(
        workspace_id=workspace_id,
        name=payload.name,
        scope=payload.scope,
        created_by=user.id,
    )
    return McpTokenCreated(
        id=row.id,
        token=plaintext,
        name=row.name,
        scope=list(row.scope or []),
        created_at=row.created_at,
    )


@router.get(
    "/{workspace_id}/mcp-tokens",
    response_model=McpTokenListResponse,
)
async def list_mcp_tokens(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    session: SessionDep,
    _user: WorkspaceWriter,
) -> McpTokenListResponse:
    """列出该 workspace 全部 token（含已吊销），新→旧。

    不返明文（明文从未持久化，无法返回）；含 ``last_used_at`` / ``revoked_at`` 供管理
    UI 展示使用情况与吊销状态。
    """
    svc = _service(session)
    rows = await svc.list_for_workspace(workspace_id=workspace_id)
    return McpTokenListResponse(items=[McpTokenRead.model_validate(r) for r in rows])


@router.delete(
    "/{workspace_id}/mcp-tokens/{token_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def revoke_mcp_token(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    token_id: Annotated[uuid.UUID, Path(...)],
    session: SessionDep,
    _user: WorkspaceWriter,
) -> None:
    """吊销（``revoked_at = now``，幂等）。

    service.revoke 返 False（不存在 / 已吊销 / 跨 workspace 越权）→ 404，不泄露具体
    原因（防存在性探测）。成功返 204；吊销后 ``authenticate`` 立即返 None（正缓存被
    精确 DEL，无 TTL 放行窗口）。
    """
    svc = _service(session)
    revoked = await svc.revoke(token_id=token_id, workspace_id=workspace_id)
    if not revoked:
        raise McpTokenNotFound(
            "MCP token not found or already revoked.",
            details={
                "mcp_token_id": str(token_id),
                "workspace_id": str(workspace_id),
            },
        )
    return None


# ════════════════════════════════════════════════════════════════════════════
# workspace 级端点：/workspaces/{workspace_id}/mcp-webhooks（task-11 / design §7.3 §8.2）
# ════════════════════════════════════════════════════════════════════════════


class McpWebhookCreateRequest(BaseModel):
    """注册 webhook 请求。``secret`` 明文仅本次入站，服务端加密入库、绝不回显。

    ``token_id`` 指定绑定哪个 McpToken（webhook 级联随 token 删除）；``events``
    非空，取值 ∈ {worker.completed, worker.failed, "*"}。
    """

    token_id: uuid.UUID
    url: str = Field(min_length=1, max_length=500)
    secret: str = Field(min_length=1, max_length=128)
    events: list[McpWebhookEvent] = Field(min_length=1)


class McpWebhookRead(BaseModel):
    """webhook 列表/详情行——绝不包含 ``secret``（明文或密文都不回显）。"""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    token_id: uuid.UUID
    url: str
    events: list[str]
    active: bool
    created_at: datetime


class McpWebhookListResponse(BaseModel):
    items: list[McpWebhookRead]


def _webhook_service(session: AsyncSession) -> McpWebhookService:
    return McpWebhookService(session)


@router.post(
    "/{workspace_id}/mcp-webhooks",
    response_model=McpWebhookRead,
    status_code=status.HTTP_201_CREATED,
    tags=["mcp-webhooks"],
)
async def create_mcp_webhook(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    payload: McpWebhookCreateRequest,
    session: SessionDep,
    _user: WorkspaceWriter,
) -> McpWebhookRead:
    """注册 webhook。``secret`` 加密入库（get_cipher），响应不回显 secret。"""
    svc = _webhook_service(session)
    row = await svc.create(
        token_id=payload.token_id,
        workspace_id=workspace_id,
        url=payload.url,
        secret=payload.secret,
        events=list(payload.events),
    )
    return McpWebhookRead.model_validate(row)


@router.get(
    "/{workspace_id}/mcp-webhooks",
    response_model=McpWebhookListResponse,
    tags=["mcp-webhooks"],
)
async def list_mcp_webhooks(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    session: SessionDep,
    _user: WorkspaceWriter,
) -> McpWebhookListResponse:
    """列出该 workspace 全部 webhook（不返 secret）。"""
    svc = _webhook_service(session)
    rows = await svc.list_for_workspace(workspace_id=workspace_id)
    return McpWebhookListResponse(items=[McpWebhookRead.model_validate(r) for r in rows])


@router.delete(
    "/{workspace_id}/mcp-webhooks/{webhook_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    tags=["mcp-webhooks"],
)
async def delete_mcp_webhook(
    workspace_id: Annotated[uuid.UUID, Path(...)],
    webhook_id: Annotated[uuid.UUID, Path(...)],
    session: SessionDep,
    _user: WorkspaceWriter,
) -> None:
    """删除 webhook（204）。不存在 / 跨 workspace → 404（防存在性探测）。"""
    svc = _webhook_service(session)
    deleted = await svc.delete(webhook_id=webhook_id, workspace_id=workspace_id)
    if not deleted:
        raise McpWebhookNotFound(
            "MCP webhook not found.",
            details={
                "mcp_webhook_id": str(webhook_id),
                "workspace_id": str(workspace_id),
            },
        )
    return None
