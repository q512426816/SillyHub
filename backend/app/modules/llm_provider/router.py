"""HTTP routes for LLM provider management.

所有端点按 ``current_user.id`` 过滤（D-008 owner 级，用 ``get_current_user`` 非
``require_permission_any``）；list/detail 仅经 ``service._to_read`` 输出
``api_key_masked``，严禁返回明文 / ``encrypted_api_key``（R-02/R-04）。
"""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_user
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.llm_provider.schema import (
    FetchModelsRequest,
    FetchModelsResponse,
    LlmProviderCreate,
    LlmProviderList,
    LlmProviderRead,
    LlmProviderUpdate,
)
from app.modules.llm_provider.service import LlmProviderService

router = APIRouter(prefix="/llm-providers", tags=["llm_provider"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
CurrentUser = Annotated[User, Depends(get_current_user)]


def _parse_id(provider_id: str) -> uuid.UUID:
    return uuid.UUID(provider_id)


@router.get("", response_model=LlmProviderList)
async def list_providers(
    session: SessionDep,
    user: CurrentUser,
) -> LlmProviderList:
    service = LlmProviderService(session)
    items = await service.list_(user.id)
    return LlmProviderList(
        items=[service._to_read(i) for i in items],
        total=len(items),
    )


@router.post(
    "",
    response_model=LlmProviderRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_provider(
    data: LlmProviderCreate,
    session: SessionDep,
    user: CurrentUser,
) -> LlmProviderRead:
    service = LlmProviderService(session)
    row = await service.create(user.id, data)
    return service._to_read(row)


@router.post("/fetch-models", response_model=FetchModelsResponse)
async def fetch_provider_models(
    data: FetchModelsRequest,
    session: SessionDep,
    user: CurrentUser,
) -> FetchModelsResponse:
    """拉上游 ``/v1/models``（design §5.1 D-001/D-006）。

    双形态 body：
    - 编辑态 ``{provider_id}`` → 后端解密 encrypted_api_key 用；
    - 新建态 ``{base_url, api_key, auth_field?}`` → 直传不落库（用完即弃）。

    无状态查询（POST 仅因双形态 body，design §9 豁免生命周期契约）。
    响应仅含 ``{models:[{id, owned_by}]}``；明文 key 永不回传（NFR-02）。
    """
    service = LlmProviderService(session)
    return await service.fetch_models(user.id, data)


@router.get("/{provider_id}", response_model=LlmProviderRead)
async def get_provider(
    provider_id: str,
    session: SessionDep,
    user: CurrentUser,
) -> LlmProviderRead:
    service = LlmProviderService(session)
    row = await service.get(_parse_id(provider_id), user.id)
    return service._to_read(row)


@router.patch("/{provider_id}", response_model=LlmProviderRead)
async def update_provider(
    provider_id: str,
    data: LlmProviderUpdate,
    session: SessionDep,
    user: CurrentUser,
) -> LlmProviderRead:
    service = LlmProviderService(session)
    row = await service.update(_parse_id(provider_id), user.id, data)
    return service._to_read(row)


@router.delete("/{provider_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_provider(
    provider_id: str,
    session: SessionDep,
    user: CurrentUser,
) -> None:
    service = LlmProviderService(session)
    await service.delete(_parse_id(provider_id), user.id)


@router.post("/{provider_id}/set-default", response_model=LlmProviderRead)
async def set_default_provider(
    provider_id: str,
    session: SessionDep,
    user: CurrentUser,
) -> LlmProviderRead:
    service = LlmProviderService(session)
    row = await service.set_default(_parse_id(provider_id), user.id)
    return service._to_read(row)


@router.post("/{provider_id}/unset-default", response_model=LlmProviderRead)
async def unset_default_provider(
    provider_id: str,
    session: SessionDep,
    user: CurrentUser,
) -> LlmProviderRead:
    """取消默认（cc-switch 式「停止」）。

    对称 ``set-default``（「启动」）：取消本行默认。若取消后该用户×agent_kind 无任何
    默认供应商 → lease 不再下发 provider_config → daemon 回归本机凭证管理（D-007）。
    """
    service = LlmProviderService(session)
    row = await service.unset_default(_parse_id(provider_id), user.id)
    return service._to_read(row)
