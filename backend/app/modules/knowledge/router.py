"""HTTP routes for knowledge and quicklog."""

from __future__ import annotations

import gzip
import json
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import require_permission
from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.knowledge.distill import DistillDispatchService
from app.modules.knowledge.graph import KnowledgeGraphService
from app.modules.knowledge.hits import HitsService
from app.modules.knowledge.schema import (
    DistillDispatchIn,
    DistillQuickEntryList,
    DistillQuickEntryOut,
    DistillTaskRead,
    GraphDumpOut,
    GraphNodesOut,
    GraphOverviewOut,
    GraphQueryOut,
    GraphSub,
    HitsBatchIn,
    HitsBatchOut,
    KnowledgeEntry,
    KnowledgeList,
    KnowledgeMergeIn,
    KnowledgeMergeResult,
    KnowledgeProposeIn,
    KnowledgeStatsOut,
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


# ── hits 接收 + 运营指标端点（2026-09-20-knowledge-effect-panel task-01）────────
#
# 字面量路由注册序铁律（文件首注释同款）：GET /knowledge/stats 必须在下方
# GET /knowledge/{filename:path} 通配之前，否则被当作 filename="stats" 吞掉。


@router.post("/knowledge/hits/batch", response_model=HitsBatchOut)
async def ingest_knowledge_hits(
    workspace_id: uuid.UUID,
    payload: HitsBatchIn,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_WRITE))],
) -> HitsBatchOut:
    """daemon 增量上行知识命中遥测（jsonl 行数组，行 sha256 幂等去重）。

    鉴权与 ``POST /spec-workspace/sync`` 同款 WORKSPACE_WRITE（daemon 经
    hub-client 自带用户身份上行，design 自审钉死的 postSpecSync 先例）；
    body 的 ``daemon_local_id`` 原样落库不 FK（数据层留归属）。
    """
    service = HitsService(session)
    return await service.ingest_batch(
        workspace_id,
        payload.lines,
        daemon_local_id=payload.daemon_local_id,
    )


@router.get("/knowledge/stats", response_model=KnowledgeStatsOut)
async def get_knowledge_stats(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.KNOWLEDGE_READ))],
) -> KnowledgeStatsOut:
    """知识运营指标：覆盖率(+8周趋势)/死条目(90天)/密度/生效速度 + 使用率榜。"""
    service = HitsService(session)
    return await service.stats(workspace_id)


# ── 知识图谱端点（2026-10-08-platform-knowledge-graph task-02 / D-001@v2）────────
#
# 字面量路由注册序铁律（文件首注释同款）：/knowledge/graph/* 四端点（query/
# overview/nodes + 2026-10-09-knowledge-graph-fullmap task-03 的 dump）必须在
# 下方 GET /knowledge/{filename:path} 通配之前，否则 graph/query 被当作 filename=
# "graph/query" 吞掉。RPC 直采单源真相（无本地回退）：不可用态 HTTP 200 恒回
# available=false + reason 六稳定键信封，前端按 reason 分支不弹错。


@router.get("/knowledge/graph/query", response_model=GraphQueryOut)
async def get_knowledge_graph_query(
    workspace_id: uuid.UUID,
    sub: GraphSub,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.KNOWLEDGE_READ))],
    anchor: str | None = Query(default=None, max_length=300),
    anchor2: str | None = Query(default=None, max_length=300),
    edges: str | None = Query(default=None, max_length=64),
    depth: int = Query(default=1, ge=1, le=3),
) -> GraphQueryOut:
    """图查询五视图（neighbors/path/impact/orphans/dangling；summary/nodes 直通）。

    ``sub`` 七值 Literal（daemon 白名单同集），非法值 422；``depth`` 钳 1-3、
    ``anchor``/``anchor2`` 自由串（daemon 侧黑名单消毒，拒绝回 invalid_input）。
    """
    service = KnowledgeGraphService(session)
    return await service.query(
        workspace_id,
        user.id,
        sub,
        anchor=anchor,
        anchor2=anchor2,
        edges=edges,
        depth=depth,
    )


@router.get("/knowledge/graph/overview", response_model=GraphOverviewOut)
async def get_knowledge_graph_overview(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.KNOWLEDGE_READ))],
) -> GraphOverviewOut:
    """总览 lite：summary 分布+簇代表（clusters 固定 50）与孤儿/悬空计数，三 RPC 逐条容错。"""
    service = KnowledgeGraphService(session)
    return await service.overview(workspace_id, user.id)


@router.get("/knowledge/graph/nodes", response_model=GraphNodesOut)
async def get_knowledge_graph_nodes(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.KNOWLEDGE_READ))],
    search: Annotated[str, Query(min_length=1, max_length=200)],
    limit: int = Query(default=20, ge=1, le=50),
) -> GraphNodesOut:
    """节点搜索（锚点自动补全数据源；不可用时 data=None，前端静默禁用补全）。"""
    service = KnowledgeGraphService(session)
    return await service.nodes(workspace_id, user.id, search, limit=limit)


@router.get("/knowledge/graph/dump", response_model=GraphDumpOut)
async def get_knowledge_graph_dump(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.KNOWLEDGE_READ))],
) -> Response:
    """全图 dump（星空总览数据源）：CLI 离线预计算坐标的全量 nodes/edges/stats。

    **手动 gzip 压缩**（2026-10-09-knowledge-graph-fullmap task-03 / Grill F-00：
    禁止全站 GZipMiddleware——SSE 流经压缩中间件有 zlib 缓冲致事件批量延迟
    风险，压缩面仅限本端点）：信封 JSON 化（ensure_ascii=False 紧凑分隔符）后
    ``gzip.compress``，``Content-Encoding: gzip`` 响应头（浏览器 fetch 透明解压）；
    **无条件压缩**（不可用 data=None 小包同构处理，一致性优先）；``Vary`` 标注
    缓存按 Accept-Encoding 区分。旧 CLI（cli_feature_missing:dump）恒 200 信封
    reason=upgrade_required，前端隐藏全图胶囊回退 orphans。
    """
    service = KnowledgeGraphService(session)
    envelope = await service.dump(workspace_id, user.id)
    payload = json.dumps(
        envelope.model_dump(mode="json"), ensure_ascii=False, separators=(",", ":")
    )
    return Response(
        content=gzip.compress(payload.encode("utf-8")),
        media_type="application/json",
        headers={"Content-Encoding": "gzip", "Vary": "Accept-Encoding"},
    )


# ── 治理信号（2026-09-27-knowledge-governance-cards 三层治理②层平台出口）──────
# 字面量路由必须在下方 GET /knowledge/{filename:path} 通配之前（声明顺序铁律，
# 同 /knowledge/stats 先例）。从已同步 spec 内容根直接计算——rot 待复核/收件箱
# 积压/伪域 auto-*，与 CLI `sillyspec knowledge digest` 同构；绑定类信号需仓
# 工作树在场，留 CLI 侧。


class GovernanceSignalOut(BaseModel):
    kind: str
    title: str
    count: int
    detail: str
    suggestion: str


class GovernanceOut(BaseModel):
    """v2（2026-09-27-governance-rpc-actions）：source 标数据源（daemon-rpc=CLI 单源
    直采，local=回退计算）；actions_available 标本端可否执行动作（RPC 直采时 True）。"""

    healthy: bool
    signals: list[GovernanceSignalOut]
    totals: dict[str, int]
    source: str = "local"
    actions_available: bool = False


class GovernanceActionIn(BaseModel):
    kind: str  # repair-paths | redomain
    from_domain: str | None = None
    to_domain: str | None = None


class GovernanceActionOut(BaseModel):
    output: str


@router.get("/knowledge/governance", response_model=GovernanceOut)
async def get_knowledge_governance(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.KNOWLEDGE_READ))],
) -> GovernanceOut:
    """知识治理信号：三类超阈才见人（安静即健康态）——知识 tab 信号卡数据源。

    v2 RPC 优先：用户已绑定 daemon 时直采 CLI digest（单源真相），回退本地计算。
    """
    service = KnowledgeService(session)
    data = await service.governance_signals(workspace_id, user_id=user.id)
    return GovernanceOut(
        **{k: v for k, v in data.items() if k in ("healthy", "signals", "totals", "source")},
        actions_available=data.get("source") == "daemon-rpc",
    )


@router.post("/knowledge/governance/actions", response_model=GovernanceActionOut, status_code=200)
async def post_knowledge_governance_action(
    workspace_id: uuid.UUID,
    payload: GovernanceActionIn,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.KNOWLEDGE_WRITE))],
) -> GovernanceActionOut:
    """治理动作执行（信号卡按钮端）：经绑定 daemon 白名单执行 CLI 机械动作。

    kind 白名单在 daemon 侧硬编码（repair-paths / redomain）；未绑定/离线时
    由 runtime 侧错误族映射（502/404/504）。
    """
    import re

    class _GovActionInvalid(Exception):
        pass

    try:
        if payload.kind not in ("repair-paths", "redomain"):
            raise _GovActionInvalid(f"kind 仅支持 repair-paths / redomain（收到 {payload.kind!r}）")
        if payload.kind == "redomain" and (
            not payload.from_domain
            or not payload.to_domain
            or not re.fullmatch(r"[a-z0-9-]+", payload.from_domain)
            or not re.fullmatch(r"[a-z0-9-]+", payload.to_domain)
        ):
            raise _GovActionInvalid("redomain 须配 from_domain/to_domain 且匹配 [a-z0-9-]+")
    except _GovActionInvalid as exc:
        from fastapi import HTTPException

        raise HTTPException(status_code=422, detail=str(exc)) from exc
    service = KnowledgeService(session)
    result = await service.governance_action(
        workspace_id,
        user.id,
        payload.kind,
        {"from": payload.from_domain, "to": payload.to_domain},
    )
    return GovernanceActionOut(**result)


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
