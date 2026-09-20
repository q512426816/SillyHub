"""HTTP routes for knowledge and quicklog."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.knowledge.distill import DistillDispatchService
from app.modules.knowledge.schema import (
    DistillDispatchIn,
    DistillQuickEntryList,
    DistillQuickEntryOut,
    DistillTaskRead,
    KnowledgeEntry,
    KnowledgeList,
    KnowledgeMergeIn,
    KnowledgeMergeResult,
    KnowledgeProposeIn,
    KnowledgeUpdateIn,
    MergePreviewOut,
    QuicklogEntry,
    QuicklogList,
)
from app.modules.knowledge.service import KnowledgeService
from app.modules.knowledge.writer import KnowledgeWriterService

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["knowledge"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]


@router.get("/knowledge", response_model=KnowledgeList)
async def list_knowledge(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.KNOWLEDGE_READ))],
) -> KnowledgeList:
    service = KnowledgeService(session)
    return await service.list_knowledge(workspace_id)


# ── 写端点（change 2026-09-17-knowledge-precipitation task-04 / D-005@v1）──────
#
# 声明顺序铁律：**字面量路由必须注册在下方 GET /knowledge/{filename:path} 通配
# 路由之前**（FastAPI 按声明序匹配，通配在前会吞掉同形的字面量路径——后续
# task-07 的 GET /knowledge/distill/tasks 同理依赖本顺序）。全部挂
# require_permission(Permission.KNOWLEDGE_WRITE)；apply_ops 返回 conflict 时由
# KnowledgeWriterService 统一翻译 HTTP 409（message/conflict/server_versions）。


@router.post("/knowledge/propose", response_model=KnowledgeEntry)
async def propose_knowledge(
    workspace_id: uuid.UUID,
    payload: KnowledgeProposeIn,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.KNOWLEDGE_WRITE))],
) -> KnowledgeEntry:
    """手工录入知识候选（落 knowledge/proposed/<slug>.md）。"""
    service = KnowledgeWriterService(session)
    return await service.propose_manual(
        workspace_id,
        user,
        title=payload.title,
        category=payload.category,
        body=payload.body,
        tags=payload.tags,
    )


@router.patch("/knowledge/entries/{filename:path}", response_model=KnowledgeEntry)
async def update_knowledge_entry(
    workspace_id: uuid.UUID,
    filename: str,
    payload: KnowledgeUpdateIn,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.KNOWLEDGE_WRITE))],
) -> KnowledgeEntry:
    """编辑知识条目正文（decisions zone 由归档流程维护，返回 422）。"""
    service = KnowledgeWriterService(session)
    return await service.update_entry(
        workspace_id,
        user,
        filename=filename,
        content=payload.content,
    )


@router.post("/knowledge/proposed/{filename:path}/preview-merge", response_model=MergePreviewOut)
async def preview_merge_knowledge(
    workspace_id: uuid.UUID,
    filename: str,
    payload: KnowledgeMergeIn,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.KNOWLEDGE_WRITE))],
) -> MergePreviewOut:
    """合并预览（dry-run 不落盘）：将追加的段落文本与 INDEX 路由行。"""
    service = KnowledgeWriterService(session)
    return await service.preview_merge(
        workspace_id,
        filename=f"proposed/{filename}",
        target_file=payload.target_file,
        section_title=payload.section_title,
        keywords=payload.keywords,
    )


@router.post("/knowledge/proposed/{filename:path}/merge", response_model=KnowledgeMergeResult)
async def merge_knowledge(
    workspace_id: uuid.UUID,
    filename: str,
    payload: KnowledgeMergeIn,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.KNOWLEDGE_WRITE))],
) -> KnowledgeMergeResult:
    """执行两段式合并（段一 updates 无冲突才段二删候选）。"""
    service = KnowledgeWriterService(session)
    return await service.merge(
        workspace_id,
        user,
        filename=f"proposed/{filename}",
        target_file=payload.target_file,
        section_title=payload.section_title,
        keywords=payload.keywords,
    )


@router.post("/knowledge/proposed/{filename:path}/reject", status_code=status.HTTP_204_NO_CONTENT)
async def reject_knowledge(
    workspace_id: uuid.UUID,
    filename: str,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.KNOWLEDGE_WRITE))],
) -> None:
    """拒绝候选（单段 delete，入 spec-backups 备份区）。"""
    service = KnowledgeWriterService(session)
    await service.reject(workspace_id, user, filename=f"proposed/{filename}")


# ── 蒸馏派发端点（task-07 / FR-01 / FR-03 / D-002@v1）─────────────────────────
#
# 字面量路由必须保持在下方 GET /knowledge/{filename:path} 通配之前（文件首注释
# 同款铁律）：GET /knowledge/distill/tasks 注册在通配后会被当作 filename=
# "distill/tasks" 吞掉。


@router.post("/knowledge/distill", response_model=DistillTaskRead)
async def dispatch_distill(
    workspace_id: uuid.UUID,
    payload: DistillDispatchIn,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.KNOWLEDGE_WRITE))],
) -> DistillTaskRead:
    """派发蒸馏任务（源校验 + mode 分流：resume 续接 / fresh 新建蒸馏会话）。"""
    service = DistillDispatchService(session)
    return await service.dispatch(
        workspace_id,
        user,
        source_type=payload.source_type,
        source_ref=payload.source_ref,
        focus=payload.focus,
        mode=payload.mode,
        runtime_id=payload.runtime_id,
        agent_type=payload.agent_type,
        agent_profile_id=payload.agent_profile_id,
        model=payload.model,
        llm_provider_id=payload.llm_provider_id,
    )


@router.get("/knowledge/distill/tasks", response_model=list[DistillTaskRead])
async def list_distill_tasks(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.KNOWLEDGE_READ))],
) -> list[DistillTaskRead]:
    """该工作区的蒸馏任务列表（按 created_at 倒序，仅 knowledge-distill 类）。"""
    service = DistillDispatchService(session)
    return await service.list_tasks(workspace_id)


@router.get("/knowledge/distill/quick-entries", response_model=DistillQuickEntryList)
async def list_distill_quick_entries(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.KNOWLEDGE_READ))],
) -> DistillQuickEntryList:
    """quicklog 条目级 ql 列表（quick-2dba0118：quick 蒸馏源多选单位）。

    quicklog 是单文件多条目形态（QUICKLOG-*.md 内 ``## <ql-id>`` 节），
    ``GET /quicklog`` 的文件级列表不适用于逐条勾选——本端点投影
    ``parse_quick_entries`` 条目视图（ref/title/date，按 ref 倒序最新在前），
    供沉淀弹层 quick 源选择器消费。**注册序铁律**：必须保持在下方
    ``GET /knowledge/{filename:path}`` 通配之前（文件首注释同款）。
    """
    service = DistillDispatchService(session)
    entries = await service.list_quick_entries(workspace_id)
    return DistillQuickEntryList(
        items=[DistillQuickEntryOut(ref=e.ref, title=e.title, date=e.date) for e in entries]
    )


@router.get("/knowledge/{filename:path}", response_model=KnowledgeEntry)
async def get_knowledge(
    workspace_id: uuid.UUID,
    filename: str,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.KNOWLEDGE_READ))],
) -> KnowledgeEntry:
    """单条读取。

    task-04（task-01 遗留的跨目录 get HTTP 化）：``{filename}`` 改 ``:path``
    通配——filename 已扩展为含子目录段（如 ``decisions/daemon.md``），单段参数
    无法命中斜杠路径。前端编码按段 ``encodeURIComponent`` 拼 ``/``。
    """
    service = KnowledgeService(session)
    return await service.get_knowledge(workspace_id, filename)


@router.get("/quicklog", response_model=QuicklogList)
async def list_quicklog(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.KNOWLEDGE_READ))],
) -> QuicklogList:
    service = KnowledgeService(session)
    return await service.list_quicklog(workspace_id)


@router.get("/quicklog/{filename}", response_model=QuicklogEntry)
async def get_quicklog(
    workspace_id: uuid.UUID,
    filename: str,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.KNOWLEDGE_READ))],
) -> QuicklogEntry:
    service = KnowledgeService(session)
    return await service.get_quicklog(workspace_id, filename)
