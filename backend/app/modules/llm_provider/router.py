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
    SetDefaultResult,
    UsageResult,
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


@router.post("/{provider_id}/usage", response_model=UsageResult)
async def query_provider_usage(
    provider_id: str,
    session: SessionDep,
    user: CurrentUser,
) -> UsageResult:
    """查供应商用量（余额 / 套餐额度），design §5.2 D-002/D-005。

    owner 级（``get_current_user`` + service 内 user_id 过滤，跨用户 → 404/403 不泄漏，
    同 fetch-models/get_provider 范式）。无状态查询（POST 仅因复用路径参数，design §8
    豁免生命周期契约）。

    - 200 ``UsageResult{success:true, data}``：多 tier 余额 / 额度；
    - 200 ``UsageResult{success:false}``：确定性失败（鉴权翻红带 ``is_valid:False`` /
      不支持 / 解析错 / SSRF）；
    - 5xx：瞬时失败（网络 / 5xx / 429 / 超时）经 service raise ``AppError`` 自然冒泡，
      本层不 try/except（同 fetch-models），前端保留上次成功值 10 分钟。

    响应无 api_key 字段（NFR-02）。
    """
    service = LlmProviderService(session)
    return await service.query_usage(_parse_id(provider_id), user.id)


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


@router.post("/{provider_id}/set-default", response_model=SetDefaultResult)
async def set_default_provider(
    provider_id: str,
    session: SessionDep,
    user: CurrentUser,
) -> SetDefaultResult:
    """置本行为默认供应商（cc-switch 式「启动」）。

    task-05（FR-07）：返回结构化 ``SetDefaultResult`` 三字段，供前端区分立即生效 /
    等待 turn 边界 / 凭证失败三种状态。service 层 ``set_default`` 已在 task-03 改造为
    返回 ``DefaultSwitchResult``（probe 凭证探测失败时 ``switched=False`` + ``error``
    不置位、不推送，原供应商继续服务运行中会话，D-003）。
    """
    service = LlmProviderService(session)
    result = await service.set_default(_parse_id(provider_id), user.id)
    return SetDefaultResult(
        switched=result.switched,
        affected_sessions=result.affected_sessions,
        error=result.error,
        litellm_registered=result.litellm_registered,
    )


@router.post("/{provider_id}/unset-default", response_model=SetDefaultResult)
async def unset_default_provider(
    provider_id: str,
    session: SessionDep,
    user: CurrentUser,
) -> SetDefaultResult:
    """取消默认（cc-switch 式「停止」）。

    对称 ``set-default``（「启动」）：取消本行默认。若取消后该用户×agent_kind 无任何
    默认供应商 → lease 不再下发 provider_config → daemon 回归本机凭证管理（D-007）。

    task-05（FR-07）：返回结构化 ``SetDefaultResult``（unset 不探测，恒
    ``switched=True`` + ``error=None``）。
    """
    service = LlmProviderService(session)
    result = await service.unset_default(_parse_id(provider_id), user.id)
    return SetDefaultResult(
        switched=result.switched,
        affected_sessions=result.affected_sessions,
        error=result.error,
        litellm_registered=result.litellm_registered,
    )
