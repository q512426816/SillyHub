"""HTTP routes for changes."""

from __future__ import annotations

import io
import uuid
from datetime import datetime
from pathlib import PurePosixPath
from typing import Annotated, Any
from urllib.parse import quote

from fastapi import APIRouter, Depends, Query, status
from fastapi.responses import StreamingResponse
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.auth_deps import get_current_principal, require_permission
from app.core.db import get_session
from app.core.errors import AppError, PermissionDenied
from app.core.logging import get_logger
from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import has_permission
from app.modules.change.assets import ChangeAssetsQueryService
from app.modules.change.model import Change, ChangeSessionLink, QuicklogSessionLink
from app.modules.change.quicklog_service import QuicklogQueryService
from app.modules.change.schema import (
    ApprovalRead,
    ApproveRequest,
    ArchiveConfirmRequest,
    ArchiveGateResponse,
    ChangeAssetsRead,
    ChangeDeleteResponse,
    ChangeDocMatrix,
    ChangeDocMatrixEntry,
    ChangeFileContent,
    ChangeFileEntry,
    ChangeFileList,
    ChangeFileSyncResult,
    ChangeFileWriteRequest,
    ChangeFileWriteResponse,
    ChangeList,
    ChangePatchFileRead,
    ChangeRead,
    ChangeRenameRequest,
    ChangeRenameResponse,
    ChangeReparseResponse,
    ChangeReparseStats,
    ChangeSummary,
    ChangeTimelineRead,
    ChangeUsageRead,
    ChangeWarning,
    DispatchResponse,
    DocumentsSyncRequest,
    DocumentsSyncResponse,
    FeedbackRequest,
    HumanTestRequest,
    OkResponse,
    PendingFileEntry,
    PendingFileList,
    PlanReviewRequest,
    ProgressUpdate,
    ProposalReviewRequest,
    QuicklogEntryList,
    QuicklogEntryListItem,
    QuicklogEntryRead,
    QuicklogFileItem,
    RejectRequest,
    ReviewResponse,
    ScopeAuditResponse,
    ScopeFileDiffResponse,
    StageProfileUpdate,
    TransitionDispatchResponse,
    TransitionRequest,
    TransitionResponse,
    VerifyGateResponse,
)
from app.modules.change.scope_audit import (
    ScopeFileDiffService,
    normalize_scope_file_path,
    validate_scope_change,
)
from app.modules.change.service import ChangeService
from app.modules.change.timeline import ChangeTimelineQueryService
from app.modules.change.usage_service import ChangeUsageQueryService
from app.modules.daemon.runtime.service import (
    DaemonRpcRemoteError,
    DaemonRpcTimeout,
    DaemonRuntimeOffline,
)
from app.modules.daemon.schema import AgentSessionListItem, ChangeSessionAuthor
from app.modules.workspace.service import WorkspaceService

router = APIRouter(prefix="/workspaces/{workspace_id}", tags=["change"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]

log = get_logger(__name__)

# ql-20260826-012：list_change_sessions 固定取最新 N 条（原无界全量，变更挂的
# 会话随使用无限增长）；200 覆盖变更详情页可视列表。
_CHANGE_SESSIONS_MAX = 200


def _get_user_role(user: User) -> str:
    if getattr(user, "is_platform_admin", False):
        return "admin"
    return "business_user"


# GET files 显式同步预算（2026-10-16-change-files-sync-result 修订；承 2026-10-14
# files-refresh-explicit-sync / 2026-10-13-change-files-refresh-sync D-002@v1）：
# 仅 sync=1（用户点「刷新」按钮）触发。原 3s 预算窄于真实同步耗时——daemon 串行
# ``platform sync`` + ``sync-docs`` 两条 CLI 实测 5.5~13.5s（daemon.log 2026-10-13~
# 14 多例），3s 下真同步恒超时→静默降级，「刷新」永远拿旧数据。放宽到 15s 覆盖
# 实测上界并留余量；超时仍静默降级不阻断 GET（并已带 sync_result 回执明示原因）。
# 默认（不带 sync）纯读零同步。
_FILES_REFRESH_SYNC_RPC_TIMEOUT_S = 15.0

# stderr_tail 入库/回执前的长度硬帽（daemon 侧 cliOutputSnippet 已截短，此处兜底
# 防异常长输出随响应放大）。
_FILES_REFRESH_SYNC_STDERR_TAIL_MAX = 500


async def _sync_change_via_daemon(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    change: Change,
    user_id: uuid.UUID,
) -> dict[str, Any]:
    """GET files 刷新前置：绑定 daemon 在线则触发其对此变更的定向上行同步。

    2026-10-13-change-files-refresh-sync task-04（D-002/D-003@v1）建立链路；
    2026-10-16-change-files-sync-result 修订：**回执不再丢弃**——返回
    ``{"triggered", "ok", "reason", "stderr_tail"}`` 结构化结果（endpoint 组装进
    ``ChangeFileList.sync_result`` 供前端展示失败原因），失败路径从无声 log.info
    升级为 log.warning 留痕。链路：per-member binding 解析（未绑定 = 等效离线，
    不接入借用兜底——避免借他机 CLI 的副作用）→ daemon 在线判断 →
    ``send_rpc('sillyspec_sync_change')``（daemon 串行 ``platform sync --change``
    落镜像 + ``platform sync-docs --change`` 落 DB 四件套，15s 防抖防频繁刷新
    打爆 CLI）。降级铁律（D-003@v1）不变：未绑定 / 离线 / DaemonRpcTimeout /
    DaemonRpcRemoteError（含老 daemon 未注册 method 的 method not found）各路
    均不抛，GET files 永不因同步失败报错——只把失败事实与原因如实带回。
    """
    result: dict[str, Any] = {
        "triggered": False,
        "ok": None,
        "reason": None,
        "stderr_tail": None,
    }
    try:
        from app.modules.daemon.ws_hub import get_daemon_ws_hub
        from app.modules.workspace.member_runtimes.queries import (
            query_daemon_online_by_id,
        )
        from app.modules.workspace.member_runtimes.resolver import (
            MemberBindingResolver,
        )

        # 懒导入防循环依赖（对齐 daemon/router/machines.py 同款惯例）；
        # resolve_member_binding_or_none：无绑定行 / 意外异常均回 None（不抛）。
        binding = await MemberBindingResolver.resolve_member_binding_or_none(
            session, workspace_id, user_id
        )
        if binding is None or binding.daemon_id is None:
            result["reason"] = "no_binding"
            log.info(
                "change.files_refresh_sync_skipped",
                workspace_id=str(workspace_id),
                change_id=str(change.id),
                reason="no_binding",
            )
            return result
        daemon_id = (
            binding.daemon_id
            if isinstance(binding.daemon_id, uuid.UUID)
            else uuid.UUID(str(binding.daemon_id))
        )
        if await query_daemon_online_by_id(session, daemon_id, user_id) is None:
            result["reason"] = "daemon_offline"
            log.info(
                "change.files_refresh_sync_skipped",
                workspace_id=str(workspace_id),
                change_id=str(change.id),
                daemon_id=str(daemon_id),
                reason="daemon_offline",
            )
            return result

        hub = get_daemon_ws_hub()
        result["triggered"] = True
        log.info(
            "change.files_refresh_sync_triggered",
            workspace_id=str(workspace_id),
            change_id=str(change.id),
            change_key=change.change_key,
            daemon_id=str(daemon_id),
        )
        rpc_result = await hub.send_rpc(
            daemon_id,
            "sillyspec_sync_change",
            {
                "change": change.change_key,
                "workspace_id": str(workspace_id),
            },
            timeout=_FILES_REFRESH_SYNC_RPC_TIMEOUT_S,
        )
        # daemon 回执消费（2026-10-16 修复核心）：manager 恒以 ok/skipped 形态
        # resolve，绝不被吞——ok:false 带 reason（cli_failed / no_workspace_root /
        # …）与 stderr_tail 原样透传进回执。
        if isinstance(rpc_result, dict) and rpc_result.get("ok") is False:
            result["ok"] = False
            result["reason"] = str(rpc_result.get("reason") or "cli_failed")
            tail = rpc_result.get("stderr_tail")
            result["stderr_tail"] = (
                str(tail)[:_FILES_REFRESH_SYNC_STDERR_TAIL_MAX] if tail else None
            )
            log.warning(
                "change.files_refresh_sync_failed",
                workspace_id=str(workspace_id),
                change_id=str(change.id),
                change_key=change.change_key,
                daemon_id=str(daemon_id),
                reason=result["reason"],
                stderr_tail=result["stderr_tail"],
            )
        elif isinstance(rpc_result, dict) and rpc_result.get("skipped"):
            # 防抖跳过（15s TTL / in-flight 去重）：刚同步过或正在同步，非失败。
            result["reason"] = f"skipped_{rpc_result['skipped']}"
            log.info(
                "change.files_refresh_sync_skipped",
                workspace_id=str(workspace_id),
                change_id=str(change.id),
                reason=result["reason"],
            )
        else:
            result["ok"] = True
            log.info(
                "change.files_refresh_sync_done",
                workspace_id=str(workspace_id),
                change_id=str(change.id),
                change_key=change.change_key,
                daemon_id=str(daemon_id),
                actions=rpc_result.get("actions") if isinstance(rpc_result, dict) else None,
            )
    except DaemonRpcTimeout as exc:
        result["ok"] = False
        result["reason"] = "rpc_timeout"
        log.warning(
            "change.files_refresh_sync_failed",
            workspace_id=str(workspace_id),
            change_id=str(change.id),
            reason="rpc_timeout",
            error=f"{type(exc).__name__}: {exc}",
        )
    except DaemonRpcRemoteError as exc:
        result["ok"] = False
        result["reason"] = "rpc_remote_error"
        log.warning(
            "change.files_refresh_sync_failed",
            workspace_id=str(workspace_id),
            change_id=str(change.id),
            reason="rpc_remote_error",
            error=f"{type(exc).__name__}: {exc}",
        )
    except DaemonRuntimeOffline as exc:
        result["ok"] = False
        result["reason"] = "runtime_offline"
        log.warning(
            "change.files_refresh_sync_failed",
            workspace_id=str(workspace_id),
            change_id=str(change.id),
            reason="runtime_offline",
            error=f"{type(exc).__name__}: {exc}",
        )
    except Exception as exc:  # 降级收口：同步失败绝不阻断 GET（D-003@v1）
        result["ok"] = False
        result["reason"] = "exception"
        log.warning(
            "change.files_refresh_sync_failed",
            workspace_id=str(workspace_id),
            change_id=str(change.id),
            reason="exception",
            error=f"{type(exc).__name__}: {exc}",
        )
    return result


async def _build_transition_response(
    service: ChangeService,
    result: dict,
) -> TransitionResponse:
    """从 ``transition_with_dispatch`` 返回的 dict 组装 TransitionResponse。

    task-11（design §6.3）：``/transition`` 与 ``/advance-stage`` 共用本 helper，
    保证两端点响应组装逻辑一致（含 team_mode 的 mission_id/mode 字段透传，
    D-004@v2）。``result`` 形如 ``{"change": Change, "agent_dispatch": dict}``。
    """
    # Enrich the change data for the response
    enriched_change = await service.enrich_with_workspace_ids(result["change"])

    # Build agent_dispatch: convert raw dict to TransitionDispatchResponse or None
    agent_dispatch: TransitionDispatchResponse | None = None
    raw_dispatch = result.get("agent_dispatch")
    if raw_dispatch and raw_dispatch.get("dispatched") is True:
        agent_dispatch = TransitionDispatchResponse(
            dispatched=True,
            agent_run_id=raw_dispatch.get("agent_run_id"),
            stage=raw_dispatch.get("stage"),
            reason=None,
            mission_id=raw_dispatch.get("mission_id"),
            mode=raw_dispatch.get("mode"),
        )

    return TransitionResponse(
        change=enriched_change.model_dump(),
        agent_dispatch=agent_dispatch,
    )


def _coerce_gate_errors(raw: Any) -> list[str]:
    """把 gate_result / gate cmd 的 errors 字段规整为 ``list[str]``（task-11）。

    ``_read_latest_gate_result`` 取的 gate_result 是落库 JSON（errors 已是
    list[str]），``_run_gate_via_delegate`` 返回 errors 也是 list[str]；但
    brownfield / 异常落库可能缺键或类型漂移，统一兜底：非 list 降级为空列表，
    每条 ``str()`` 强转。不在响应层做截断（截断在落库侧 ``_truncate_gate_errors``
    已做，响应如实返回）。
    """
    if not isinstance(raw, list):
        return []
    return [str(e) for e in raw]


@router.get(
    "/changes",
    response_model=ChangeList,
)
async def list_changes(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
    location: str | None = Query(None),
    status: str | None = Query(None),
    owner: str | None = Query(None),
    search: str | None = Query(None),
    current_stage: str | None = Query(None),
    # 2026-10-14-change-center-lineage-tag-and-filter：出身分类筛选（thin|full），
    # 透传 service.list_（_is_thin_lineage 三分支投影口径，含归档兜底行）；
    # 缺省/未知值不过滤（对齐 sort 白名单 fallback 风格）。
    lineage: str | None = Query(None),
    # task-02（2026-08-13-change-center-rework / D-004 / FR-02 / FR-04）：排序白名单
    # 透传 service.list_（默认 updated_at desc，最近活动优先，R-05）。
    sort: str = Query("updated_at_desc"),
    # task-02（FR-02 / D-002）：「待我处理」聚焦筛选。ql-20260813-005（gap②）：
    # 透传 service.list_，由 service 算全局 pending 集合 SQL IN 分页（total=全局 N），
    # 不再 router 层 enrich 后 Python filter（后者本页过滤致 N 偏低、分页偏移）。
    pending_review_only: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
) -> ChangeList:
    service = ChangeService(session)
    items, total = await service.list_(
        workspace_id,
        location=location,
        status=status,
        owner=owner,
        search=search,
        current_stage=current_stage,
        lineage=lineage,
        sort=sort,
        pending_review_only=pending_review_only,
        page=page,
        page_size=page_size,
    )
    enriched = await service.enrich_summaries(items)
    return ChangeList(items=enriched, total=total)


@router.get(
    "/changes/{change_id}",
    response_model=ChangeRead,
)
async def get_change(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> ChangeRead:
    service = ChangeService(session)
    change = await service.get(workspace_id, change_id)
    return await service.enrich_with_workspace_ids(change)


@router.delete(
    "/changes/{change_id}",
    response_model=ChangeDeleteResponse,
)
async def delete_change(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> ChangeDeleteResponse:
    """平台删除入口（task-06 / 2026-08-29-change-delete-closure-and-spec-pull，
    design §6.1 / FR-05a / D-001@v1）。

    组合权限 = ``change.owner_id == 当前用户`` **或** ``CHANGE_ARCHIVE``（owner 为空
    仅后者可删；workspace_owner 角色已内置、platform_admin 经 has_permission 短路）。
    ``require_permission`` 依赖工厂（auth_deps.py）不支持行级 OR，故实现为端点内
    组合校验（agent/file_artifacts.py 同款先例；permission 枚举用法照
    members_router 先例）；未通过判 403。不存在 404、已删幂等 409（code=
    change_deleted）由 ``ChangeService.delete_change`` 给出。
    """
    service = ChangeService(session)
    # 先取行判 owner（同时覆盖 404：行不存在 / workspace 不存在）。
    change = await service.get(workspace_id, change_id)
    allowed = change.owner_id == user.id
    if not allowed:
        allowed = await has_permission(
            session,
            user=user,
            permission=Permission.CHANGE_ARCHIVE,
            workspace_id=workspace_id,
        )
    if not allowed:
        raise PermissionDenied(
            "无权删除该变更：仅变更责任人本人或持有 change:archive 权限的成员可删除。",
            details={
                "permission": Permission.CHANGE_ARCHIVE.value,
                "workspace_id": str(workspace_id),
                "change_id": str(change_id),
            },
        )
    return await service.delete_change(workspace_id, change_id, actor_id=user.id)


@router.patch(
    "/changes/{change_id}/title",
    response_model=ChangeRenameResponse,
)
async def rename_change_title(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    payload: ChangeRenameRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> ChangeRenameResponse:
    """平台改名入口（2026-10-16-change-title-condense-backfill FR-05，用户口径 2026-10-16）。

    组合权限与删除端点同款三元组——变更责任人本人（``change.owner_id == 当前
    用户``）**或** ``CHANGE_ARCHIVE``（workspace_owner 角色内置、platform_admin
    经 has_permission 短路），即「管理员 || 平台责任人 || 变更责任人」；实现为
    端点内组合校验（delete_change 同款先例）。带宽校验（10-30 字必须，strip 后
    判，越带 422）、已删行 409、rename 审计事件由 ``ChangeService.rename_title``
    给出。改名后的语义 title 不被 CLI 兜底上行回翻（is_fallback 收养守卫）。
    """
    service = ChangeService(session)
    change = await service.get(workspace_id, change_id)
    allowed = change.owner_id == user.id
    if not allowed:
        allowed = await has_permission(
            session,
            user=user,
            permission=Permission.CHANGE_ARCHIVE,
            workspace_id=workspace_id,
        )
    if not allowed:
        raise PermissionDenied(
            "无权改名该变更：仅变更责任人本人、平台管理员或工作区负责人可操作。",
            details={
                "permission": Permission.CHANGE_ARCHIVE.value,
                "workspace_id": str(workspace_id),
                "change_id": str(change_id),
            },
        )
    renamed = await service.rename_title(
        workspace_id, change_id, title=payload.title, actor_id=user.id
    )
    return ChangeRenameResponse(
        id=renamed.id, change_key=renamed.change_key, title=renamed.title or ""
    )


@router.get(
    "/changes/{change_id}/documents",
    response_model=ChangeDocMatrix,
)
async def get_change_documents(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> ChangeDocMatrix:
    service = ChangeService(session)
    docs, prototypes, references = await service.get_documents(workspace_id, change_id)
    return ChangeDocMatrix(
        change_id=change_id,
        documents=[
            ChangeDocMatrixEntry(
                doc_type=d.doc_type,
                exists=d.exists,
                path=d.path,
                status=d.status,
                last_modified_at=d.last_modified_at,
            )
            for d in docs
        ],
        prototypes=prototypes,
        references=references,
    )


@router.post(
    "/changes/reparse",
    response_model=ChangeReparseResponse,
    status_code=status.HTTP_200_OK,
)
async def reparse_changes(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> ChangeReparseResponse:
    service = ChangeService(session)
    stats, result = await service.reparse(workspace_id)
    warnings: list[ChangeWarning] = []
    for w in result.warnings:
        warnings.append(
            ChangeWarning(
                code=w.code,
                detail=w.detail,
                change_key=w.change_key,
                doc_type=w.doc_type,
            )
        )
    return ChangeReparseResponse(
        workspace_id=workspace_id,
        stats=ChangeReparseStats(**stats),
        warnings=warnings,
    )


@router.patch(
    "/changes/{change_id}/stage-profile",
    response_model=OkResponse,
)
async def update_stage_profile(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    data: StageProfileUpdate,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> OkResponse:
    """task-03（2026-08-13-profile-system-prompt-injection）：存每阶段独立 profile_id。

    写 ``change.stages[<current_stage>]["profile_id"]``（D-003 每阶段独立）。
    profile_id=None 清除（跟随工作区默认）。
    """
    from sqlalchemy import select

    from app.modules.change.model import Change

    stmt = select(Change).where(
        Change.workspace_id == workspace_id,
        Change.id == change_id,
    )
    change = (await session.execute(stmt)).scalars().first()
    if change is None:
        raise AppError(
            "变更不存在，无法绑定阶段档案。",
            http_status=404,
            details={"change_id": str(change_id)},
        )
    if not change.current_stage:
        raise AppError(
            "变更尚未进入任何阶段，无法绑定阶段档案。",
            http_status=400,
        )

    # dict copy 防 SQLAlchemy JSON in-place 改不 dirty（反复踩的坑）。
    stages = dict(change.stages or {})
    stage_data = dict(stages.get(change.current_stage) or {})
    if data.profile_id is None:
        stage_data.pop("profile_id", None)
    else:
        stage_data["profile_id"] = data.profile_id
    stages[change.current_stage] = stage_data
    change.stages = stages
    session.add(change)
    await session.commit()
    return OkResponse(ok=True)


# ── File tree endpoints（2026-07-02-change-detail-file-tree-editor）──────


@router.get(
    "/changes/{change_id}/files",
    response_model=ChangeFileList,
)
async def list_change_files(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
    sync: bool = Query(
        False, description="true=触发绑定 daemon 定向上行同步后再返回（仅前端「刷新」按钮点击使用）"
    ),
) -> ChangeFileList:
    """变更文件树清单（2026-07-02-change-detail-file-tree-editor）。

    2026-10-14-files-refresh-explicit-sync：触发面收窄——默认（sync=false）纯读，
    直接返回平台镜像数据、不碰 daemon 通道（悬浮面板轮询/初始加载零同步开销）；
    仅显式 sync=true（前端「刷新」按钮点击、错误重试）先经绑定 daemon 触发一次
    此变更的定向上行同步（在线才触发，失败降级不抛——``_sync_change_via_daemon``
    任何情况不抛），使主动刷新尽量拿到 daemon 本机最新文档。
    2026-10-16-change-files-sync-result：sync=true 时降级不再无声——响应带
    ``sync_result`` 回执（触发状态 / 成败 / 机读原因 / CLI 失败尾段），前端据此
    在同步未完成时提示原因；默认纯读回执恒 None。``service.list_files`` 本体
    纯读语义零改动。
    """
    service = ChangeService(session)
    change = await service.get(workspace_id, change_id)
    sync_result: dict[str, Any] | None = None
    if sync:
        sync_result = await _sync_change_via_daemon(session, workspace_id, change, user.id)
    items = await service.list_files(workspace_id, change_id)
    return ChangeFileList(
        change_id=change_id,
        items=[ChangeFileEntry(**it) for it in items],
        sync_result=ChangeFileSyncResult(**sync_result) if sync_result else None,
    )


async def _fetch_session_titles(
    db: AsyncSession, session_ids: list[uuid.UUID]
) -> dict[uuid.UUID, str | None]:
    """批量取会话标题：每会话最早一条 channel=user_input 摘要（前 30 字）。

    task-03（2026-08-25-session-spec-binding / X-013）：自 ``list_change_sessions``
    提取为共享 helper——本端点与 task-07 快速修复会话端点（GET
    ``/quicklog-entries/{ql_id}/sessions``）两个消费方同在本文件，标题口径必须
    同源。窗口函数 ROW_NUMBER 分区取首条（P5 2026-08-24 会话审查，与 agent/
    daemon router 同步）——拉全部 user_input 行 Python 取最早会随轮数线性放大。

    返回映射只含命中的会话（值已按前 30 字截断；空文本归一为 None）；未命中
    会话不出现在映射，调用方 ``get`` 默认 None，与旧实现
    ``(content or "")[:30] or None`` 语义一致。
    """
    if not session_ids:
        return {}
    rn = (
        func.row_number()
        .over(
            partition_by=AgentRun.agent_session_id,
            order_by=(AgentRunLog.timestamp.asc(), AgentRunLog.id.asc()),
        )
        .label("rn")
    )
    title_subq = (
        select(
            AgentRun.agent_session_id.label("session_id"),
            # 2026-09-09 阿里云 slow.query 实测：摘要只取前 30 字（返回值 [:30]），
            # SQL 内 substr 截到 64 字符，免把单行均值 33KB 的 TOAST 全文解压拉回
            # （substr 双方言语符语义，64 > 30 保证派生零回归；与 agent/daemon
            # router 同款优化三处同步）。
            func.substr(AgentRunLog.content_redacted, 1, 64).label("content"),
            rn,
        )
        .join(AgentRunLog, AgentRunLog.run_id == AgentRun.id)
        .where(
            col(AgentRun.agent_session_id).in_(session_ids),
            col(AgentRunLog.channel) == "user_input",
        )
        .subquery()
    )
    title_rows = (
        await db.execute(
            select(title_subq.c.session_id, title_subq.c.content).where(title_subq.c.rn == 1)
        )
    ).all()
    return {row.session_id: (row.content or "")[:30] or None for row in title_rows}


@router.get(
    "/changes/{change_id}/sessions",
    response_model=list[AgentSessionListItem],
)
async def list_change_sessions(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> list[AgentSessionListItem]:
    """列出某变更下的全部会话（2026-07-09-change-detail-session task-09）。

    跨成员可见（D-005@v1，不加 user_id 过滤），鉴权复用 CHANGE_READ（X-03）。
    task-03（2026-08-25-session-spec-binding / FR-03 / D-002@v1）：数据源从
    ``AgentSession.change_id`` 单 FK 切换为 ``change_session_links`` M:N JOIN——
    links 为唯一关联真相，存量单 FK 由迁移播种成 link 行（design §5.W1.2）不丢；
    ``AgentSession.change_id`` 列继续写入不动（D-002@v1 冻结语义）。
    标题取该会话最早一条 channel=user_input 的 AgentRunLog 摘要（前 30 字，X-04，
    共享 helper ``_fetch_session_titles``）。按 last_active_at desc 排序（Python
    排序规避 PG/SQLite 方言差异）。

    ql-20260826-012：原查询无界全量（变更挂的会话无限增长）。SQL 侧加
    ``last_active_at desc + nulls_last + limit`` 取数窗口（显式 nulls_last 消除
    PG/SQLite 方言分叉，nulls_last 两方言 3.30+ 均原生支持），下方的 Python
    最终排序保留（幂等，口径不变）——超窗的远古会话不再返回。
    """
    # 1. links JOIN agent_sessions（跨成员）。unique(change_id, session_id) 使
    #    同一 (变更, 会话) 至多一行 link，JOIN 不会产生重复会话行，无需 distinct。
    sessions = (
        (
            await session.execute(
                select(AgentSession)
                .join(ChangeSessionLink, ChangeSessionLink.session_id == AgentSession.id)
                .where(
                    ChangeSessionLink.change_id == change_id,
                    col(AgentSession.deleted_at).is_(None),  # FR-07 软删过滤
                )
                # ql-20260826-012：最新 N 条取数窗口（见 docstring）。
                .order_by(col(AgentSession.last_active_at).desc().nulls_last())
                .limit(_CHANGE_SESSIONS_MAX)
            )
        )
        .scalars()
        .all()
    )
    if not sessions:
        return []

    session_ids = [s.id for s in sessions]
    user_ids = {s.user_id for s in sessions}

    # 2. 批量取作者展示名（避免 N+1）。
    users = (await session.execute(select(User).where(col(User.id).in_(user_ids)))).scalars().all()
    user_name_map: dict[uuid.UUID, str | None] = {u.id: u.display_name for u in users}

    # 3. 批量取标题（共享 helper，task-07 快速修复会话端点同源复用，X-013）。
    titles = await _fetch_session_titles(session, session_ids)

    # 4. 组装 + 按 last_active_at desc 排序。
    items = [
        AgentSessionListItem(
            id=s.id,
            provider=s.provider,
            status=s.status,
            turn_count=s.turn_count,
            mode=(s.config or {}).get("mode"),
            author=ChangeSessionAuthor(
                user_id=s.user_id, display_name=user_name_map.get(s.user_id)
            ),
            last_active_at=s.last_active_at,
            title=titles.get(s.id),
        )
        for s in sessions
    ]
    items.sort(
        key=lambda x: x.last_active_at or datetime.min,
        reverse=True,
    )
    return items


@router.get(
    "/changes/-/by-session/{session_id}",
    response_model=list[ChangeSummary],
)
async def list_session_changes(
    workspace_id: uuid.UUID,
    session_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> list[ChangeSummary]:
    """列出某会话关联的全部变更（2026-10-13-session-change-files-hover task-01 / FR-01）。

    会话页面悬浮变更文件面板的数据源：``change_session_links`` M:N 表反向查询
    （正向端点为上方 ``list_change_sessions``；``-`` 路径占位符写法对齐
    platform_sync 的 ``/changes/-/spec-manifest`` 惯例，第二段为固定字面量
    ``by-session``，与 ``/changes/{change_id}/xxx`` 动态段不冲突）。

    排序（service.list_changes_for_session）：未归档（``location != 'archive'``）
    优先 → 组内 ``created_at`` desc——前端「进行中置顶、归档折叠可展开」分组
    直接消费该序；软删（``location='deleted'``）变更排除，与变更中心读侧口径
    一致。鉴权复用 CHANGE_READ 跨成员可见（对齐 list_change_sessions / D-005@v1）。
    """
    # 会话存在性 + 工作空间归属校验：不匹配 → 404（中文文案，l10n 守护把关）。
    agent_session = (
        await session.execute(
            select(AgentSession).where(
                col(AgentSession.id) == session_id,
                col(AgentSession.workspace_id) == workspace_id,
            )
        )
    ).scalar_one_or_none()
    if agent_session is None:
        raise AppError(
            "会话不存在或不属于该工作空间。",
            http_status=404,
            details={"session_id": str(session_id)},
        )
    svc = ChangeService(session)
    return await svc.list_changes_for_session(workspace_id, session_id)


@router.get(
    "/changes/{change_id}/usage",
    response_model=ChangeUsageRead,
)
async def get_change_usage(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> ChangeUsageRead:
    """变更维度执行用量聚合（task-04 / D-005@v1 独立用量端点）。

    委托 ``ChangeUsageQueryService.get_change_usage``：不存在/跨工作区由 service
    抛 ``ChangeNotFound``（404 resource-hiding，不泄露存在性）。deleted 口径
    （task-04 核实现状）：既有 ``GET /changes/{change_id}`` 详情端点经
    ``ChangeService.get`` 只按 id+workspace 取行，**不**对 ``location='deleted'``
    404——其「读侧防复活」是 enrich 投影层跳过 deleted 行（service.py
    ``enrich_with_workspace_ids``/``enrich_summaries`` 前置过滤），本端点保持
    同口径：不加额外 deleted 404，聚合结果如实返回。
    """
    return await ChangeUsageQueryService(session).get_change_usage(workspace_id, change_id)


@router.get(
    "/changes/{change_id}/assets",
    response_model=ChangeAssetsRead,
)
async def get_change_assets(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> ChangeAssetsRead:
    """变更沉淀资产聚合（2026-09-25-change-precipitated-assets / D-001@v1 方案 a）。

    按变更名解析 spec 树镜像：knowledge/fr + knowledge/decisions 的归属条目、
    归档目录 test-trace/change-patch/delta 容错读取；逐项 fail-open（单项失败
    降级为空，不影响其它组）。不存在/跨工作区由 service 抛 ``ChangeNotFound``
    （404 resource-hiding，对齐 usage 端点口径）。
    """
    return await ChangeAssetsQueryService(session).get_change_assets(workspace_id, change_id)


@router.get(
    "/changes/{change_id}/timeline",
    response_model=ChangeTimelineRead,
)
async def get_change_timeline(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> ChangeTimelineRead:
    """变更合成时间线聚合（2026-09-26-change-real-timeline / FR-01）。

    复刻 CLI ``sillyspec watcher timeline`` 三源合成：事件轴
    （platform_change_events 正序 + requirements 工件 created_at 诞生锚）、
    任务面（tasks.md 行 × 提交锚推断）、脚注统计。thin 轻量变更 steps 恒空
    的主线叙事由本端点承载；events 恒 provisional（红线 D-004：只展示不
    消费）。git 提交标题经 daemon best-effort 反查，失败降级仅哈希。不存
    在/跨工作区抛 ``ChangeNotFound``（对齐 assets 端点口径）。
    """
    return await ChangeTimelineQueryService(session).get_change_timeline(
        workspace_id, change_id, user.id
    )


@router.get(
    "/changes/{change_id}/assets/patch-file",
    response_model=ChangePatchFileRead,
)
async def get_change_patch_file(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
    path: str = Query(..., description="变更目录相对文件路径（如 src/flow.js）"),
) -> ChangePatchFileRead:
    """归档留档单文件 diff 切片（2026-09-25-change-detail-assets-usability / FR-04）。

    卡面「归档留档」清单点开某文件时，读该变更归档目录 ``change.patch``（缺件回退
    ``scope-audit.patch``——厚流程归档只落快照留档）并切出该文件的 diff 段——冻结
    在收尾时点、无后续演进混入（与范围对账的实时窗口锚不同源，两者不可互替）。
    ``path`` 复用 scope-audit 单文件比对的同一白名单校验（拒 ``..``/
    绝对路径/pathspec magic → 422）；切片命中与否由响应 ``diff``/``note`` 表达，
    不抛 404（读不到留档是展示面降级，不是资源不存在）。
    """
    service = ChangeAssetsQueryService(session)
    return await service.get_patch_file_diff(
        workspace_id, change_id, normalize_scope_file_path(path)
    )


@router.get(
    "/changes/{change_id}/files/content",
    response_model=ChangeFileContent,
)
async def get_change_file_content(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
    path: str = Query(...),
) -> ChangeFileContent:
    service = ChangeService(session)
    rel, content, exists = await service.read_file(workspace_id, change_id, path)
    return ChangeFileContent(path=rel, content=content, exists=exists)


@router.get("/changes/{change_id}/files/raw")
async def get_change_file_raw(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
    path: str = Query(..., description="相对变更目录的文件路径"),
) -> StreamingResponse:
    """读变更文件原始字节（2026-08-26-file-fullscreen-preview task-01 / FR-04）。

    供前端构造 Blob 全屏预览镜像目录里的图片/文档（D-001）：Content-Type 由
    service 按扩展名推断（未知回 application/octet-stream）；错误语义——穿越/不
    存在 404、超 50MB 413 均在 service 层收口。权限与 files/content 一致
    （CHANGE_READ）。Content-Disposition 用 inline（浏览器内联展示而非下载），
    RFC 5987 ``filename*`` 写法对齐 explorer/router.py download 端点（ASCII
    回退 + quote 编码原名）。
    """
    service = ChangeService(session)
    data, media_type = await service.read_file_raw(workspace_id, change_id, path)
    # RFC 5987：filename* 承载原始文件名，filename 给 ASCII 回退（防头注入去引号）。
    name = PurePosixPath(path).name or "file"
    ascii_name = name.encode("ascii", "ignore").decode() or "file"
    ascii_name = ascii_name.replace('"', "").strip() or "file"
    disposition = f"inline; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(name)}"
    return StreamingResponse(
        io.BytesIO(data),
        media_type=media_type,
        headers={
            "Content-Disposition": disposition,
            # Content-Length 必须等于实际 body 字节数（body 就是完整文件字节）
            "Content-Length": str(len(data)),
        },
    )


@router.post(
    "/changes/{change_id}/files/content",
    response_model=ChangeFileWriteResponse,
)
async def write_change_file_content(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    body: ChangeFileWriteRequest,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> ChangeFileWriteResponse:
    service = ChangeService(session)
    # D-001@v1：daemon-client 写回入队需 user_id 校验 daemon 归属（现算 runtime）。
    result = await service.write_file(workspace_id, change_id, body.path, body.content, user.id)
    return ChangeFileWriteResponse(**result)


@router.get(
    "/changes/{change_id}/files/pending",
    response_model=PendingFileList,
)
async def list_pending_change_files(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> PendingFileList:
    service = ChangeService(session)
    items = await service.list_pending_files(workspace_id, change_id)
    return PendingFileList(items=[PendingFileEntry(**it) for it in items])


# ── Progress / Approval / Documents sync ─────────────────────────────────


@router.post(
    "/changes/{change_key}/progress",
    response_model=OkResponse,
)
async def update_progress(
    workspace_id: uuid.UUID,
    change_key: str,
    body: ProgressUpdate,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> OkResponse:
    service = ChangeService(session)
    await service.update_progress(
        workspace_id,
        change_key,
        current_stage=body.currentStage,
        stages=body.stages,
        last_active=body.lastActive,
    )
    return OkResponse()


@router.get(
    "/changes/{change_key}/approval",
    response_model=ApprovalRead,
)
async def get_approval(
    workspace_id: uuid.UUID,
    change_key: str,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> ApprovalRead:
    service = ChangeService(session)
    approval_status, reason = await service.get_approval(workspace_id, change_key)
    return ApprovalRead(status=approval_status, reason=reason)


@router.post(
    "/changes/{change_key}/approve",
    response_model=OkResponse,
)
async def approve_change(
    workspace_id: uuid.UUID,
    change_key: str,
    body: ApproveRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> OkResponse:
    service = ChangeService(session)
    await service.approve(workspace_id, change_key, approved_by=body.approved_by)
    return OkResponse()


@router.post(
    "/changes/{change_key}/reject",
    response_model=OkResponse,
)
async def reject_change(
    workspace_id: uuid.UUID,
    change_key: str,
    body: RejectRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> OkResponse:
    service = ChangeService(session)
    await service.reject(workspace_id, change_key, reason=body.reason)
    return OkResponse()


@router.post(
    "/changes/{change_key}/documents",
    response_model=DocumentsSyncResponse,
)
async def sync_documents(
    workspace_id: uuid.UUID,
    change_key: str,
    body: DocumentsSyncRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> DocumentsSyncResponse:
    service = ChangeService(session)
    docs = body.iter_documents()
    synced = await service.sync_documents(workspace_id, change_key, documents=docs)
    return DocumentsSyncResponse(synced=synced)


# ── Workflow endpoints ───────────────────────────────────────────────────


@router.post(
    "/changes/{change_id}/transition",
    response_model=TransitionResponse,
)
async def transition_change(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    body: TransitionRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> TransitionResponse:
    service = ChangeService(session)
    result = await service.transition_with_dispatch(
        workspace_id=workspace_id,
        change_id=change_id,
        target_stage=body.target_stage,
        user_role=_get_user_role(_user),
        reason=body.reason,
        user_id=_user.id,
        provider=body.provider,
        model=body.model,
        agent_profile_id=body.agent_profile_id,
        team_mode=body.team_mode,
        worker_preset=body.worker_preset,
        main_agent_config=body.main_agent_config,
    )
    return await _build_transition_response(service, result)


@router.post(
    "/changes/{change_id}/advance-stage",
    response_model=TransitionResponse,
)
async def advance_stage(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    body: TransitionRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> TransitionResponse:
    """单步推进 change 阶层（task-11，design §6.3 / D-005）。

    前端 ``handleDispatch`` 走 HTTP（非直连 MCP），与 task-07
    ``advance_change_stage`` MCP tool 共用同一 service 方法
    ``ChangeService.transition_with_dispatch``（team 分流：single → AgentService，
    team → _dispatch_execute_team）。body/响应与 ``/transition`` 完全对齐——
    ``advance-stage`` 为前端语义命名别名（D-005 选 HTTP 入口）。
    """
    service = ChangeService(session)
    result = await service.transition_with_dispatch(
        workspace_id=workspace_id,
        change_id=change_id,
        target_stage=body.target_stage,
        user_role=_get_user_role(_user),
        reason=body.reason,
        user_id=_user.id,
        provider=body.provider,
        model=body.model,
        agent_profile_id=body.agent_profile_id,
        team_mode=body.team_mode,
        worker_preset=body.worker_preset,
        main_agent_config=body.main_agent_config,
    )
    return await _build_transition_response(service, result)


@router.post(
    "/changes/{change_id}/run-verify-gate",
    response_model=VerifyGateResponse,
)
async def run_verify_gate(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> VerifyGateResponse:
    """gate 软调用（task-11，design §6.2/§6.3 / D-003/D-008）。

    与 task-09 ``run_verify_gate`` MCP tool 对齐，**不硬阻塞、不改 change 状态**
    （结果交调用方决策，核验纪律靠调用方）：

    1. 优先读最近 completed AgentRun.gate_result（``_read_latest_gate_result``）
       → ``source="gate_result"``。
    2. gate_result 缺 → 经 ``_run_gate_via_delegate`` 软调 ``sillyspec gate verify``
       （复用 task-06 RPC 骨架，不自动阻塞推进）→ ``source="gate_cmd"``。
    3. 两者均不可用（workspace 无 code_root / RPC 异常 / daemon 离线）
       → ``source="unavailable"``, ``exit_code=None``。
    """
    # 局部 import：dispatch / run_sync / workspace 依赖较重，且 dispatch 顶层
    # import 会与 service 形成循环（service.py 内部也是函数内 import 同款模式）。
    from app.modules.change.dispatch import (
        _read_latest_gate_result,
        _run_gate_via_delegate,
    )
    from app.modules.daemon.run_sync.service import RunSyncService
    from app.modules.workspace.service import WorkspaceService

    service = ChangeService(session)
    # service.get 校验 workspace 归属 + change 存在（不存在抛 → 404 语义）。
    change = await service.get(workspace_id, change_id)

    # 1. 优先读最近 completed AgentRun.gate_result（design §6.2 step 1）。
    gate_result, _gate_run_id = await _read_latest_gate_result(session, change_id)
    if gate_result:
        return VerifyGateResponse(
            exit_code=gate_result.get("exit_code"),
            errors=_coerce_gate_errors(gate_result.get("errors")),
            source="gate_result",
        )

    # 2. gate_result 缺 → 软调 sillyspec gate verify（design §6.2 step 2）。
    try:
        workspace = await WorkspaceService(session).get(workspace_id)
        # 复用 RunSyncService._resolve_gate_spec_root（gate cmd 的 cwd/specBase
        # 规范解析：platform-managed/repo-mirrored 走 SpecWorkspace.spec_root，
        # repo-native 走 workspace.root_path）。该方法是 gate cmd 唯一权威解析器，
        # 在此跨模块复用避免重复 ~30 行平台/仓库分流逻辑（生产级 DRY 取舍）。
        run_sync = RunSyncService(session)
        code_root, spec_dir = await run_sync._resolve_gate_spec_root(session, workspace, change)
        if not code_root:
            # workspace.root_path 缺 → gate 无 cwd 可跑，降级 unavailable
            # （design §6.2 step 3，不抛崩端点）。
            log.warning(
                "run_verify_gate_code_root_missing",
                change_id=str(change_id),
                workspace_id=str(workspace_id),
            )
            return VerifyGateResponse(exit_code=None, errors=[], source="unavailable")

        gate_cmd_result = await _run_gate_via_delegate(
            session=session,
            workspace=workspace,
            change_name=change.change_key,
            code_root=code_root,
            spec_dir=spec_dir,
        )
        return VerifyGateResponse(
            exit_code=gate_cmd_result.get("exit_code"),
            errors=_coerce_gate_errors(gate_cmd_result.get("errors")),
            source="gate_cmd",
        )
    except Exception as exc:
        # RPC 异常 / daemon 离线 / ws_rpc 未接线 → unavailable（design §6.2 step 3）。
        # gate 软调用语义要求端点不抛崩，结果交调用方决策。
        log.warning(
            "run_verify_gate_cmd_failed",
            change_id=str(change_id),
            error=str(exc),
            error_type=type(exc).__name__,
        )
        return VerifyGateResponse(exit_code=None, errors=[], source="unavailable")


@router.post(
    "/changes/{change_id}/feedback",
    response_model=ChangeRead,
)
async def submit_feedback(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    body: FeedbackRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> ChangeRead:
    service = ChangeService(session)
    change = await service.submit_feedback(
        workspace_id,
        change_id,
        category=body.category,
        text=body.text,
        user_id=_user.id,
        target_stage=body.target_stage,
    )
    return await service.enrich_with_workspace_ids(change)


@router.get(
    "/changes/{change_id}/archive-gate",
    response_model=ArchiveGateResponse,
)
async def check_archive_gate(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> ArchiveGateResponse:
    service = ChangeService(session)
    return await service.check_archive_gate(workspace_id, change_id)


# ── Review Gate endpoints ────────────────────────────────────────────────


@router.post(
    "/changes/{change_id}/proposal-review",
    response_model=ReviewResponse,
)
async def proposal_review(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    body: ProposalReviewRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> ReviewResponse:
    service = ChangeService(session)
    result = await service.proposal_review(
        workspace_id,
        change_id,
        body.decision,
        body.comment,
        _user.id,
        notify_session=body.notify_session,
    )
    enriched = await service.enrich_with_workspace_ids(result["change"])
    raw_dispatch = result.get("agent_dispatch")
    agent_dispatch = None
    if raw_dispatch and raw_dispatch.get("dispatched"):
        agent_dispatch = TransitionDispatchResponse(
            dispatched=True,
            agent_run_id=raw_dispatch.get("agent_run_id"),
            stage=raw_dispatch.get("stage"),
        )
    return ReviewResponse(
        change=enriched.model_dump(),
        agent_dispatch=agent_dispatch,
        notified_session=result["notified_session"],
        notify_error=result.get("notify_error"),
    )


@router.post(
    "/changes/{change_id}/plan-review",
    response_model=ReviewResponse,
)
async def plan_review(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    body: PlanReviewRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> ReviewResponse:
    service = ChangeService(session)
    result = await service.plan_review(
        workspace_id,
        change_id,
        body.decision,
        body.comment,
        _user.id,
        notify_session=body.notify_session,
    )
    enriched = await service.enrich_with_workspace_ids(result["change"])
    raw_dispatch = result.get("agent_dispatch")
    agent_dispatch = None
    if raw_dispatch and raw_dispatch.get("dispatched"):
        agent_dispatch = TransitionDispatchResponse(
            dispatched=True,
            agent_run_id=raw_dispatch.get("agent_run_id"),
            stage=raw_dispatch.get("stage"),
        )
    return ReviewResponse(
        change=enriched.model_dump(),
        agent_dispatch=agent_dispatch,
        notified_session=result["notified_session"],
        notify_error=result.get("notify_error"),
    )


@router.post(
    "/changes/{change_id}/human-test",
    response_model=ReviewResponse,
)
async def human_test(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    body: HumanTestRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> ReviewResponse:
    service = ChangeService(session)
    result = await service.human_test(
        workspace_id,
        change_id,
        body.result,
        body.comment,
        _user.id,
        notify_session=body.notify_session,
    )
    enriched = await service.enrich_with_workspace_ids(result["change"])
    raw_dispatch = result.get("agent_dispatch")
    agent_dispatch = None
    if raw_dispatch and raw_dispatch.get("dispatched"):
        agent_dispatch = TransitionDispatchResponse(
            dispatched=True,
            agent_run_id=raw_dispatch.get("agent_run_id"),
            stage=raw_dispatch.get("stage"),
        )
    return ReviewResponse(
        change=enriched.model_dump(),
        agent_dispatch=agent_dispatch,
        notified_session=result["notified_session"],
        notify_error=result.get("notify_error"),
    )


@router.post(
    "/changes/{change_id}/archive-confirm",
    response_model=ReviewResponse,
)
async def archive_confirm(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    body: ArchiveConfirmRequest,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
) -> ReviewResponse:
    service = ChangeService(session)
    result = await service.archive_confirm(
        workspace_id,
        change_id,
        body.comment,
        _user.id,
        notify_session=body.notify_session,
    )
    enriched = await service.enrich_with_workspace_ids(result["change"])
    raw_dispatch = result.get("agent_dispatch")
    agent_dispatch = None
    if raw_dispatch and raw_dispatch.get("dispatched"):
        agent_dispatch = TransitionDispatchResponse(
            dispatched=True,
            agent_run_id=raw_dispatch.get("agent_run_id"),
            stage=raw_dispatch.get("stage"),
        )
    return ReviewResponse(
        change=enriched.model_dump(),
        agent_dispatch=agent_dispatch,
        notified_session=result["notified_session"],
        notify_error=result.get("notify_error"),
    )


# ── Agent dispatch endpoints ────────────────────────────────────────────


@router.get(
    "/changes/{change_id}/agent-status",
    response_model=DispatchResponse,
)
async def get_agent_status(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> DispatchResponse:
    """Get the current agent dispatch status for a change."""
    from app.modules.change.dispatch import get_config_for_stage, has_active_run

    service = ChangeService(session)
    change = await service.get(workspace_id, change_id)

    current_stage = change.current_stage or "draft"
    config = get_config_for_stage(current_stage)
    has_active = await has_active_run(session, change_id)

    # Extract last_dispatch from stages JSON
    stages = change.stages or {}
    last_dispatch = stages.get("last_dispatch")

    # Fallback: if last_dispatch has no run_id, query this change's most recent run.
    # ql-20260706-004：按 change_id 精确过滤——旧实现只按 workspace 取最近 run，会把
    # workspace 下 scan/它变更的 run（change_id 为 NULL）误当本变更日志串台显示。
    # AgentRun.change_id 列实存（model.py，带索引 ix_agent_runs_change_id），dispatch
    # 落库即写（agent/service.py），故按 FK 取本变更最近 run；没派发过则保持 None
    # （前端不渲染日志面板），不再做 workspace 级回退（那正是串台来源）。
    if not last_dispatch or not last_dispatch.get("run_id"):
        from sqlalchemy import select

        from app.modules.agent.model import AgentRun

        stmt = (
            select(AgentRun)
            .where(col(AgentRun.change_id) == change_id)
            .order_by(col(AgentRun.started_at).desc())
            .limit(1)
        )
        result = await session.execute(stmt)
        latest_run = result.scalar_one_or_none()
        if latest_run:
            last_dispatch = {
                "run_id": str(latest_run.id),
                "stage": current_stage,
                "status": latest_run.status,
                "at": latest_run.started_at.isoformat() if latest_run.started_at else None,
                "finished_at": latest_run.finished_at.isoformat()
                if latest_run.finished_at
                else None,
                "exit_code": latest_run.exit_code,
            }

    return DispatchResponse(
        change_id=change_id,
        current_stage=current_stage,
        has_active_run=has_active,
        config_enabled=config is not None and config.enabled if config else False,
        last_dispatch=last_dispatch,
    )


@router.post(
    "/changes/{change_id}/dispatch",
    response_model=DispatchResponse,
)
async def manual_dispatch(
    workspace_id: uuid.UUID,
    change_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_CREATE))],
    # ql-20260618-009：max_length 与 schema.py TransitionRequest 对齐（64/128）
    provider: str | None = Query(default=None, max_length=64),
    model: str | None = Query(default=None, max_length=128),
    # 2026-08-12-dispatch-bind-agent-profile task-04：手动派发也支持选档案
    # （Query 风格对齐 provider/model）。None=跟随工作区默认。
    agent_profile_id: uuid.UUID | None = Query(default=None),
) -> DispatchResponse:
    """Manually trigger agent dispatch for the current stage of a change."""
    from app.modules.change.dispatch import dispatch, get_config_for_stage, has_active_run

    service = ChangeService(session)
    change = await service.get(workspace_id, change_id)

    current_stage = change.current_stage or "draft"
    config = get_config_for_stage(current_stage)

    if config is None or not config.enabled:
        return DispatchResponse(
            change_id=change_id,
            current_stage=current_stage,
            has_active_run=False,
            config_enabled=False,
            last_dispatch=None,
        )

    dispatch_result = await dispatch(
        session=session,
        workspace_id=workspace_id,
        change_id=change_id,
        target_stage=current_stage,
        user_id=_user.id,
        provider=provider,
        model=model,
        agent_profile_id=agent_profile_id,
    )

    # Refresh change to get updated stages
    await session.refresh(change)
    stages = change.stages or {}
    last_dispatch = stages.get("last_dispatch")

    # Fallback: same logic as get_agent_status endpoint (ql-20260706-004：按
    # change_id 过滤，避免 scan run 串台；详见 get_agent_status 注释)。
    if not last_dispatch or not last_dispatch.get("run_id"):
        from sqlalchemy import select

        from app.modules.agent.model import AgentRun

        stmt = (
            select(AgentRun)
            .where(col(AgentRun.change_id) == change_id)
            .order_by(col(AgentRun.started_at).desc())
            .limit(1)
        )
        result = await session.execute(stmt)
        latest_run = result.scalar_one_or_none()
        if latest_run:
            last_dispatch = {
                "run_id": str(latest_run.id),
                "stage": current_stage,
                "status": latest_run.status,
                "at": latest_run.started_at.isoformat() if latest_run.started_at else None,
                "finished_at": latest_run.finished_at.isoformat()
                if latest_run.finished_at
                else None,
                "exit_code": latest_run.exit_code,
            }

    return DispatchResponse(
        change_id=change_id,
        current_stage=current_stage,
        has_active_run=dispatch_result.get("dispatched", False)
        or await has_active_run(session, change_id),
        config_enabled=True,
        last_dispatch=last_dispatch,
        dispatch_result=dispatch_result,
    )


@router.get(
    "/quicklog-entries",
    response_model=QuicklogEntryList,
)
async def list_quicklog_entries(
    workspace_id: uuid.UUID,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
    # FR-04：search 全文（标题+四段）+ status/author 筛选 + include_placeholder
    # （默认隐藏空壳，D-007）+ linked_change（FR-07 反向区块数据面）。
    search: str | None = Query(None),
    status: str | None = Query(None),
    author: str | None = Query(None),
    linked_change: str | None = Query(None),
    include_placeholder: bool = Query(False),
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
) -> QuicklogEntryList:
    """GET 快速修复列表（FR-04：双源合并 → 派生 → 筛选 → 分页）。"""
    workspace = await WorkspaceService(session).get(workspace_id)
    result = await QuicklogQueryService(session).list_entries(
        workspace,
        search=search,
        status=status,
        author=author,
        linked_change=linked_change,
        include_placeholder=include_placeholder,
        page=page,
        page_size=page_size,
    )
    # 2026-08-30-change-center-usage-stats task-03（FR-04）：页内 ql_id 一次批量
    # usage 摘要（对齐 modules_by_ql 组装先例，R-03 禁 N+1）；空页零查询
    # （summarize_quicklogs 空集合短路）；无会话绑定的条目不进 map → usage
    # 保持 None（文件源条目常态，D-001 不回退生命周期口径）。
    usage_map = await ChangeUsageQueryService(session).summarize_quicklogs(
        workspace_id, [e.ql_id for e in result.items]
    )
    items = [
        QuicklogEntryListItem(
            ql_id=e.ql_id,
            timestamp=e.timestamp,
            title=e.title,
            status=e.status,
            status_note=e.status_note,
            placeholder=e.placeholder,
            author_raw=e.author_raw,
            author_name=e.author_name,
            owner_name=e.owner_name,
            linked_changes=list(e.linked_changes),
            files=[QuicklogFileItem(path=p, note=n) for p, n in e.files],
            affected_modules=result.modules_by_ql.get(e.ql_id, []),
            source=e.source,
            usage=usage_map.get(e.ql_id),
        )
        for e in result.items
    ]
    return QuicklogEntryList(items=items, total=result.total)


@router.get(
    "/quicklog-entries/{ql_id}",
    response_model=QuicklogEntryRead,
)
async def get_quicklog_entry(
    workspace_id: uuid.UUID,
    ql_id: str,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> QuicklogEntryRead:
    """GET 快速修复单条详情（FR-06：四段正文 + raw_block；404 未命中）。"""
    workspace = await WorkspaceService(session).get(workspace_id)
    e = await QuicklogQueryService(session).get_entry(workspace, ql_id)
    if e is None:
        raise AppError(
            "快速修复条目不存在",
            http_status=404,
            details={"ql_id": ql_id},
        )
    return QuicklogEntryRead(
        ql_id=e.ql_id,
        timestamp=e.timestamp,
        title=e.title,
        status=e.status,
        status_note=e.status_note,
        placeholder=e.placeholder,
        author_raw=e.author_raw,
        author_name=e.author_name,
        owner_name=e.owner_name,
        linked_changes=list(e.linked_changes),
        files=[QuicklogFileItem(path=p, note=n) for p, n in e.files],
        affected_modules=[],
        source=e.source,
        body_sections=dict(e.body_sections or {}),
        raw_block=e.raw_block,
        truncated=e.truncated,
    )


@router.get(
    "/quicklog-entries/{ql_id}/usage",
    response_model=ChangeUsageRead,
)
async def get_quicklog_usage(
    workspace_id: uuid.UUID,
    ql_id: str,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> ChangeUsageRead:
    """快速修复条目维度执行用量聚合（task-04 / D-005@v1 独立用量端点）。

    404 严格对齐 ``get_quicklog_entry`` 详情端点：先经
    ``QuicklogQueryService.get_entry`` 校验条目存在（双源均未命中 → 404），
    不像姊妹端点 ``/sessions`` 容忍「有 link 无条目」竞态（usage 卡只在
    条目存在的抽屉内渲染，竞态窗口极小，前端按边界态降级）。存在再委托
    ``ChangeUsageQueryService.get_quicklog_usage`` 聚合（无绑定条目返回全零
    totals + 空 by_model + 三元组 None）。
    """
    workspace = await WorkspaceService(session).get(workspace_id)
    e = await QuicklogQueryService(session).get_entry(workspace, ql_id)
    if e is None:
        raise AppError(
            "快速修复条目不存在",
            http_status=404,
            details={"ql_id": ql_id},
        )
    return await ChangeUsageQueryService(session).get_quicklog_usage(workspace_id, ql_id)


@router.get(
    "/quicklog-entries/{ql_id}/sessions",
    response_model=list[AgentSessionListItem],
)
async def list_quicklog_sessions(
    workspace_id: uuid.UUID,
    ql_id: str,
    session: SessionDep,
    _user: Annotated[User, Depends(require_permission(Permission.CHANGE_READ))],
) -> list[AgentSessionListItem]:
    """列出某快速修复条目下绑定的全部会话（2026-08-25-session-spec-binding task-07）。

    FR-04 数据源：读 ``quicklog_session_links`` M:N JOIN ``agent_sessions``。
    跨成员可见（对齐 ``list_change_sessions`` 现状——列表跨成员、stream
    owner-only 不变，不加 user_id 过滤），鉴权复用 CHANGE_READ。``ql_id`` 为
    自然键（D-001@v1：无 FK 到 quicklog_entries——条目双源合并且与 agent-logs
    到达顺序不保证，绑定行不依赖条目行存在），故查询按 (workspace_id, ql_id)
    匹配 link 且不校验条目存在：无绑定返回空列表不 404（快速修复刚建、尚无
    会话是常态，design §5.W3.2）；工作区隔离由 link 行 workspace_id 保证。
    为快速修复级会话门户路由（D-006@v1，与变更门户同构）提供数据面。
    标题经共享 helper ``_fetch_session_titles`` 与变更侧同源复用（X-013 禁止
    复制 window-function 代码），按 last_active_at desc 排序（Python 排序规避
    PG/SQLite 方言差异，对齐 ``list_change_sessions``）。
    """
    # 1. links JOIN agent_sessions（跨成员）。unique(workspace_id, ql_id,
    #    session_id) 使同一 (条目, 会话) 至多一行 link，JOIN 不会产生重复
    #    会话行，无需 distinct。
    sessions = (
        (
            await session.execute(
                select(AgentSession)
                .join(QuicklogSessionLink, QuicklogSessionLink.session_id == AgentSession.id)
                .where(
                    QuicklogSessionLink.workspace_id == workspace_id,
                    QuicklogSessionLink.ql_id == ql_id,
                    col(AgentSession.deleted_at).is_(None),  # 软删过滤（对齐变更侧）
                )
            )
        )
        .scalars()
        .all()
    )
    if not sessions:
        return []

    session_ids = [s.id for s in sessions]
    user_ids = {s.user_id for s in sessions}

    # 2. 批量取作者展示名（避免 N+1）。
    users = (await session.execute(select(User).where(col(User.id).in_(user_ids)))).scalars().all()
    user_name_map: dict[uuid.UUID, str | None] = {u.id: u.display_name for u in users}

    # 3. 批量取标题（共享 helper，与 list_change_sessions 同源复用，X-013）。
    titles = await _fetch_session_titles(session, session_ids)

    # 4. 组装 + 按 last_active_at desc 排序（与 list_change_sessions 同构）。
    items = [
        AgentSessionListItem(
            id=s.id,
            provider=s.provider,
            status=s.status,
            turn_count=s.turn_count,
            mode=(s.config or {}).get("mode"),
            author=ChangeSessionAuthor(
                user_id=s.user_id, display_name=user_name_map.get(s.user_id)
            ),
            last_active_at=s.last_active_at,
            title=titles.get(s.id),
        )
        for s in sessions
    ]
    items.sort(
        key=lambda x: x.last_active_at or datetime.min,
        reverse=True,
    )
    return items


# ── 单文件变化比对（ql-20260910-017-2006，scope-audit --file 平台入口）────────


@router.get("/sillyspec/file-diff", response_model=ScopeFileDiffResponse)
async def get_change_scope_file_diff(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
    change: str = Query(
        min_length=1,
        max_length=128,
        description="变更名或 quick-<8hex> 会话名（scope-audit --change 同参）",
    ),
    file: str = Query(
        min_length=1,
        max_length=512,
        description="仓库内文件相对路径（反斜杠自动归一为 POSIX）",
    ),
) -> ScopeFileDiffResponse:
    """单文件内容变化比对：对账同源锚点的 git diff（变更中心点击文件入口）。

    链路：绑定解析（成员自己行）→ daemon RPC ``sillyspec_file_diff`` → 本机
    ``sillyspec scope-audit --change <c> --file <f> --json``（锚点与行数表格
    同源：quick=HEAD 未提交窗口 / 归档=快照基点 / 活跃=worktree 锚）。advisory
    只读。错误族见 change/scope_audit.py（422 升级引导 / 502 离线远端 / 504
    超时 / 404 未绑定）。
    """
    service = ScopeFileDiffService(session)
    return await service.get_file_diff(
        workspace_id,
        user.id,
        change=validate_scope_change(change),
        file=normalize_scope_file_path(file),
    )


# ── 对账表（ql-20260911-001-c0be，scope-audit 表模式平台入口）─────────────────


@router.get("/sillyspec/scope-audit", response_model=ScopeAuditResponse)
async def get_change_scope_audit(
    workspace_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(require_permission(Permission.WORKSPACE_READ))],
    change: str = Query(
        min_length=1,
        max_length=128,
        description="变更名或 quick-<8hex> 会话名（scope-audit --change 同参）",
    ),
) -> ScopeAuditResponse:
    """对账表：计划×实际三态全表 + 行数（变更中心结果卡数据源）。

    daemon 在本机跑 ``sillyspec scope-audit --change <c> --json``（锚点与
    --file/行数同源）。full-flow 行 verdict=计划内/计划外/计划未动，quick 行
    attribution=已声明/软归属/未声明。错误族与 file-diff 端点同源（422 升级
    引导 / 404 未绑定 / 502 离线远端 / 504 超时）。
    """
    service = ScopeFileDiffService(session)
    return await service.get_scope_audit(
        workspace_id,
        user.id,
        change=validate_scope_change(change),
    )
