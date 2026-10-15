"""向量检索端点（change 2026-10-15-platform-vector-search）。

``POST /api/spec/knowledge/vector-search``（router 不自带 prefix，main 挂 ``/api``
落地契约路径——对齐 platform_sync router 形态，契约见 sillyspec src/knowledge-vector.js
文件头）。

鉴权：require_platform_sync 三通道分流，但本端点**只接受 shpsync_ workspace token**
（scope.workspace_id 非 None）——shk_live_/JWT 的并集 scope 表达不了「检索单一 workspace
语料」，且 CLI（唯一消费方）固化 Bearer shpsync_（sync.js:296 先例）。凭据有效但非
shpsync_ → PermissionDenied 403（对齐写端点「通道受限 403」边界语义；无凭据/无效 401
由依赖内部抛出）。

语料根：复用 KnowledgeService 的 spec 根解析（platform-managed spec_root 优先、
root_path/.sillyspec 兜底，hits.py 同款口径单源）。检索主体（解析/指纹/索引/余弦）
在 vector_search.py——本文件只做鉴权/参数钳位/线程池卸载/DTO 组装。
"""

from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.db import get_session
from app.core.errors import PermissionDenied
from app.modules.auth.model import User
from app.modules.knowledge.schema import VectorSearchIn, VectorSearchOut
from app.modules.knowledge.vector_search import get_embedder, search_sync
from app.modules.platform_sync.auth import PlatformSyncAuthScope, require_platform_sync
from app.modules.workspace.service import WorkspaceService

router = APIRouter(tags=["knowledge-vector"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]
SettingsDep = Annotated[Any, Depends(get_settings)]
_read_auth = Annotated[tuple[User, PlatformSyncAuthScope], Depends(require_platform_sync)]

_QUERY_MAX_CHARS = 4000  # CLI 侧同款截断上限（knowledge-vector.js）
_LIMIT_MIN, _LIMIT_MAX = 1, 50


async def _search_payload(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    body: VectorSearchIn,
    settings: Any,
) -> VectorSearchOut:
    from app.modules.knowledge.service import KnowledgeService

    query = body.query.strip()[:_QUERY_MAX_CHARS]
    limit = max(_LIMIT_MIN, min(_LIMIT_MAX, int(body.limit or 10)))
    workspace = await WorkspaceService(session).get(workspace_id)  # 未知 → 404（hits 同语义）
    spec_root = await KnowledgeService(session)._spec_content_root(workspace)
    embedder, embedder_error = get_embedder(settings.knowledge_embedding_model)
    # 模型加载与余弦检索是 CPU 阻塞面（首查秒级/查询毫秒级）——卸到线程池不卡事件循环。
    from fastapi.concurrency import run_in_threadpool

    out = await run_in_threadpool(
        search_sync,
        spec_root,
        str(workspace_id),
        query,
        limit,
        embedder,
        settings.knowledge_embedding_model,
        embedder_error=embedder_error,
    )
    return VectorSearchOut(
        ok=True,
        results=out["results"],
        model_ready=out["model_ready"],
        reason=out["reason"],
    )


@router.post("/spec/knowledge/vector-search")
async def vector_search_endpoint(
    body: VectorSearchIn,
    principal: _read_auth,
    session: SessionDep,
    settings: SettingsDep,
) -> VectorSearchOut:
    """向量检索：token 派生 workspace 语料内语义召回（契约与 fail-soft 见模块 docstring）。"""
    _user, scope = principal
    if scope.workspace_id is None:
        raise PermissionDenied(
            "Knowledge vector-search requires a workspace sync token (shpsync_).",
        )
    return await _search_payload(session, scope.workspace_id, body, settings)
