"""HTTP routes for scan documents."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.scan_docs.schema import (
    ScanDocConflictRead,
    ScanDocList,
    ScanDocRead,
    ScanDocReparseResponse,
    ScanDocReparseStats,
    ScanDocsStatsOut,
    ScanDocSummary,
    ScanDocWarning,
)
from app.modules.scan_docs.service import ScanDocsService

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["scan-docs"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get(
    "/scan-docs",
    response_model=ScanDocList,
)
async def list_scan_docs(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.SCAN_DOCS_READ))],
    q: Annotated[
        str | None,
        Query(min_length=1, description="按 path/title/content 大小写不敏感搜索"),
    ] = None,
) -> ScanDocList:
    service = ScanDocsService(session)
    items, total, conflict_counts = await service.list_(workspace_id, q=q)
    summaries = [
        ScanDocSummary.model_validate(d).model_copy(
            update={"conflict_count": conflict_counts.get(d.path, 0)}
        )
        for d in items
    ]
    return ScanDocList(items=summaries, total=total)


# ── stats 运营指标端点（2026-09-21-scan-docs-ops-panel task-01）─────────────
#
# 字面量路由注册序铁律（对齐 knowledge/router.py:215 先例）：GET /scan-docs/stats
# 必须保持在下方 GET /scan-docs/{doc_id} 通配之前——FastAPI 按声明序匹配，字面量
# 落后会被当作 doc_id="stats" 解析 UUID 失败返回 422（design R-03）。


@router.get(
    "/scan-docs/stats",
    response_model=ScanDocsStatsOut,
)
async def get_scan_docs_stats(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.SCAN_DOCS_READ))],
) -> ScanDocsStatsOut:
    """扫描文档运营指标：覆盖率（七件套+模块两级，8 周趋势）/陈旧（90 天）/
    每项目密度/近 30 天更新/最近更新榜 + docs-inject 注入频次（D-003@v1）。"""
    service = ScanDocsService(session)
    return await service.stats(workspace_id)


@router.get(
    "/scan-docs/{doc_id}",
    response_model=ScanDocRead,
)
async def get_scan_doc(
    workspace_id: uuid.UUID,
    doc_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.SCAN_DOCS_READ))],
) -> ScanDocRead:
    service = ScanDocsService(session)
    doc = await service.get(workspace_id, doc_id)
    read = ScanDocRead.model_validate(doc)
    read.conflict_count = await service.count_conflicts(workspace_id, doc.path)
    return read


@router.get(
    "/scan-docs/{doc_id}/conflicts",
    response_model=list[ScanDocConflictRead],
)
async def list_scan_doc_conflicts(
    workspace_id: uuid.UUID,
    doc_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.SCAN_DOCS_READ))],
) -> list[ScanDocConflictRead]:
    """某扫描文档路径的历史冲突归档（D-001@V1 last-write-wins 覆盖快照，倒序）。"""
    service = ScanDocsService(session)
    items = await service.list_conflicts(workspace_id, doc_id)
    return [ScanDocConflictRead.model_validate(i) for i in items]


@router.post(
    "/scan-docs/reparse",
    response_model=ScanDocReparseResponse,
    status_code=status.HTTP_200_OK,
)
async def reparse_scan_docs(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> ScanDocReparseResponse:
    service = ScanDocsService(session)
    stats, result = await service.reparse(workspace_id)
    warnings: list[ScanDocWarning] = []
    for w in result.warnings:
        warnings.append(
            ScanDocWarning(
                code=w.code,
                detail=w.detail,
                component_key=w.component_key,
                doc_type=w.doc_type,
            )
        )
    return ScanDocReparseResponse(
        workspace_id=workspace_id,
        stats=ScanDocReparseStats(**stats),
        warnings=warnings,
    )
