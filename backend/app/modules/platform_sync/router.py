"""platform_sync router — 进度同步层 6 端点（契约 sillyhub-progress-sync-contract.md）。

- POST /changes/{name}/progress：上行 progress + §4.2 base_ts 冲突检测（200/409）
- GET /changes：轻量列表（裸数组，按 token 派生 workspace 过滤）
- GET /changes/{name}/progress：完整 JSON（裸六表 + 顶层 last_pushed_at，404）
- POST /changes/{name}/documents：四件套全文同步（2026-08-14-platform-sync-docs-approval，D-004@v1）
- POST /changes/{name}/approval：审批决定提交（同上，D-001@v1 完整闭环）
- GET /changes/{name}/approval：审批状态查询（改读库，无记录默认 approved 放行）

router **不自带 prefix**，路径在路由内写全（``/changes/...``）；main 挂 ``prefix="/api"``
落地 ``/api/changes/...``。不自带 prefix 是为了避开 FastAPI 对 ``GET /changes`` 的
尾斜杠 redirect（307）——客户端 ``sync.js:543`` 打无尾斜杠 ``/api/changes``。

Change 2026-08-11-change-progress-projection task-07：3 端点从 require_platform_sync
解包 ``(user, workspace_id)``，透传 workspace_id 给 service 做收件箱隔离（shpsync_ token
派生工作区；shk_live_/JWT 过渡期 None 走全局聚合 fallback）。

Change security-audit-remediation task-06（D-004@v1）：三个 POST 端点改用
``require_platform_sync_write``——仅 shpsync_ token 可写（shk_live_/JWT 凭据有效也
403，全局桶写通道关闭）；四个 GET 端点解包 ``(user, PlatformSyncAuthScope)``——
shpsync_ 走 token 绑定 workspace（收件箱隔离不变），shk_live_/JWT 按 CHANGE_READ
workspace 并集 + NULL 桶聚合（service ``allowed_workspace_ids`` 参数）。
"""

from __future__ import annotations

from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.platform_sync.auth import (
    PlatformSyncAuthScope,
    require_platform_sync,
    require_platform_sync_write,
)
from app.modules.platform_sync.schema import (
    ApprovalSubmitOk,
    ApprovalSubmitRequest,
    ChangeApprovalResponse,
    ChangeListItem,
    ConflictResponse,
    DocumentsSyncOk,
    DocumentsSyncRequest,
    ProgressSyncOk,
    QuicklogEntryPushRequest,
    QuicklogPushOk,
)
from app.modules.platform_sync.service import PlatformSyncService

router = APIRouter(tags=["platform-sync"])

# 读端点鉴权依赖（shpsync_ 收件箱 / JWT·shk_live_ CHANGE_READ 并集 + NULL 桶）。
_read_auth = Annotated[tuple[User, PlatformSyncAuthScope], Depends(require_platform_sync)]
# 写端点鉴权依赖（仅 shpsync_ 可写，D-004@v1；JWT/shk_live_ 403）。
_write_auth = Annotated[tuple[User, PlatformSyncAuthScope], Depends(require_platform_sync_write)]


def _read_args(scope: PlatformSyncAuthScope) -> dict[str, Any]:
    """把读 scope 翻译成 service 读方法的 kwargs。

    shpsync_（``scope.workspace_id`` 非 None）→ 传 ``workspace_id``（收件箱隔离原语义，
    service 逐字节回归）；shk_live_/JWT → 传 ``allowed_workspace_ids``（并集 + NULL 桶）。
    """
    if scope.workspace_id is not None:
        return {"workspace_id": scope.workspace_id}
    return {"workspace_id": None, "allowed_workspace_ids": list(scope.allowed_workspace_ids_)}


def _header(request: Request, name: str) -> str | None:
    """读 ``X-SillySpec-*`` header，缺失/空均视为 None（契约 §4.1 / D-005 零回归）。"""
    value = request.headers.get(name)
    return value if value else None


@router.post("/changes/{name}/progress")
async def push_progress(
    name: str,
    request: Request,
    body: dict[str, Any],
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: _write_auth,
) -> Any:
    """POST 上行 progress + base_ts 冲突检测（契约 §4）。

    读 3 个 ``X-SillySpec-*`` header（User/Base-Ts/Pushed-At，缺失/空均 None）。
    200=接受（客户端据此更新 platform_last_sync）；409=冲突（body
    ``{conflict, platform_progress, last_pushed_at}``，客户端写冲突文件走 resolve）。
    body 是裸 ``serializeForSync`` 六表 JSON（NG-6 透传，不强类型校验）。

    workspace_id 从 require_platform_sync_write 派生（唯一写通道 shpsync_ token 绑定
    工作区；shk_live_/JWT 一律 403，task-06 / D-004@v1）。

    Change 2026-08-16-change-owner-from-token task-02（D-001@v1）：鉴权 tuple 的真实
    User id 以 ``user_id`` 透传 service——接受分支把 ux_changes.owner_id 对齐 token
    签发人；三个 ``X-SillySpec-*`` header 读取与 ``last_pusher`` 语义逐字不动（§9）。
    """
    _user, scope = auth
    workspace_id = scope.workspace_id
    base_ts = _header(request, "X-SillySpec-Base-Ts")
    pushed_at = _header(request, "X-SillySpec-Pushed-At")
    user = _header(request, "X-SillySpec-User")
    result = await PlatformSyncService(session).upsert_progress(
        workspace_id=workspace_id,
        name=name,
        body=body,
        base_ts=base_ts,
        pushed_at=pushed_at,
        user=user,
        # owner 对齐用真实 User（auth 已派生，改前丢弃）；header user 只喂 last_pusher。
        user_id=_user.id,
    )
    if result.conflict:
        # 409 必须返回正确状态码 + 契约 §4.4 body（客户端 fetchJsonWithStatus 读
        # res.status==409 + res.body.platform_progress，sync.js:314-318）。
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content=ConflictResponse(
                conflict=True,
                platform_progress=result.platform_progress or {},
                last_pushed_at=result.last_pushed_at,
            ).model_dump(),
        )
    return ProgressSyncOk()


@router.get("/changes")
async def list_changes(
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: _read_auth,
) -> list[ChangeListItem]:
    """GET 轻量 change 列表（契约 §5，裸数组形态 D-007，按鉴权 scope 聚合）。

    shpsync_ → token 绑定 workspace 收件箱；JWT/shk_live_ → CHANGE_READ workspace
    并集 + NULL 桶（task-06 / D-004@v1，全局聚合已关闭）。
    """
    _user, scope = auth
    items = await PlatformSyncService(session).list_lightweight(**_read_args(scope))
    return [ChangeListItem(**it) for it in items]


@router.get("/changes/{name}/progress")
async def get_progress(
    name: str,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: _read_auth,
) -> Any:
    """GET 单 change 完整 progress JSON（契约 §6，裸六表 + 顶层 last_pushed_at）。

    不存在/跨 workspace（无 CHANGE_READ）→ 404（客户端 fetchJson 返回 null 降级
    不阻断，契约 §8/§10）。
    """
    _user, scope = auth
    progress = await PlatformSyncService(session).get_progress(name=name, **_read_args(scope))
    if progress is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="change progress not found",
        )
    return progress


@router.get("/changes/{name}/approval")
async def get_approval(
    name: str,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: _read_auth,
) -> ChangeApprovalResponse:
    """GET 单 change 审批状态——给 sillyspec CLI execute 审批门控用（ql-20260812-001-6eb8）。

    CLI ``sync.js checkApproval`` 在 execute 启动时 GET 此端点，读 ``status``：
    rejected/pending 阻断 execute，其他（approved）放行（command.js:1071-1080）。

    **不因 change 无审批记录 404**：change 可能尚未上行 progress（execute 前），
    若 404 CLI 会 fetchJson→null→误判 pending 卡死（与本端点放行初衷相悖）。
    2026-08-14-platform-sync-docs-approval 起改读 ``approval`` 列（D-001@v1 完整闭环）：
    无记录（行不存在 / approval NULL 含仅 documents 占位行）→ 默认 ``approved`` 放行；
    有记录 → 真实 status/reason（rejected 时 CLI execute 启动 exit(1) 硬阻断，
    run/command.js:1113-1129 现有门控）。鉴权失败仍 401。

    task-06 / D-004@v1：读 scope 聚合——跨 workspace（无 CHANGE_READ）的 change 行
    不可见，回落默认 approved 放行（不泄漏 status/reason）。
    """
    _user, scope = auth
    record = await PlatformSyncService(session).get_approval_record(name=name, **_read_args(scope))
    if record is None:
        return ChangeApprovalResponse(
            status="approved",
            reason="no approval record; default-approved",
        )
    return ChangeApprovalResponse(
        status=str(record.get("status", "approved")),
        reason=record.get("reason"),
    )


# ── Change 2026-08-14-platform-sync-docs-approval task-04（D-001@v1 / D-004@v1）──


@router.post("/changes/{name}/documents", response_model=DocumentsSyncOk)
async def push_documents(
    name: str,
    body: DocumentsSyncRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: _write_auth,
) -> DocumentsSyncOk:
    """POST 四件套文档全文（CLI ``sync.js syncDocuments`` :442-497 预留契约）。

    body 是扁平 map（键限四件套白名单，schema 层 422）。定向 upsert ``documents``
    列（D-003@v1 单写者，不触碰 latest_progress/approval）；行不存在 INSERT 占位
    （下行端点由占位行守卫视为「无进度」）。全量替换语义（整列覆盖，与 CLI 全量推一致）。

    仅 shpsync_ token 可写（task-06 / D-004@v1，workspace_id 由 token 派生）。
    """
    _user, scope = auth
    workspace_id = scope.workspace_id
    synced = await PlatformSyncService(session).upsert_documents(
        workspace_id=workspace_id, name=name, documents=body.root
    )
    return DocumentsSyncOk(synced=synced, change_name=name)


@router.post("/changes/{name}/approval", response_model=ApprovalSubmitOk)
async def submit_approval(
    name: str,
    body: ApprovalSubmitRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: _write_auth,
) -> ApprovalSubmitOk:
    """POST 审批决定（CLI ``sync.js _submitApproval`` :944-996 预留契约，过去式 decision）。

    D-001@v1 完整闭环：落 approval 列（重复提交覆盖，后写赢）。``decided_by`` 取
    ``require_platform_sync_write`` 解包的权威 ``User.username``（唯一写通道 shpsync_
    token 反查真实 User；**不用** ``X-SillySpec-User`` header fallback——客户端可伪造，
    Grill UB-2）。rejected 记录随后被 GET approval 读到 → CLI execute 启动 exit(1)
    硬阻断。task-06 / D-004@v1：JWT/shk_live_ 一律 403。
    """
    user, scope = auth
    workspace_id = scope.workspace_id
    await PlatformSyncService(session).set_approval(
        workspace_id=workspace_id,
        name=name,
        decision=body.decision,
        reason=body.reason,
        decided_by=user.username,
    )
    return ApprovalSubmitOk(decision=body.decision, change_name=name)


@router.post("/quicklog-entries", response_model=QuicklogPushOk)
async def push_quicklog_entry(
    body: QuicklogEntryPushRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: _write_auth,
) -> Any:
    """POST quicklog 条目推送（design §5.2 / FR-03 / D-003 双链路推送落点）。

    CLI quicklog.js 两触发点（allocate/complete）best-effort POST；语义恒 200 成功体
    （幂等 upsert，同 ``ql_id`` 整条覆盖 D-004，无 base_ts 乐观锁）。失败由 CLI 静默
    兜底（文件解析链路），平台端无重试语义。

    workspace_id 从 require_platform_sync_write 派生（仅 shpsync_ 可写，G6/D-004@v1）；
    body 不含也不接受 workspace 字段（extra=ignore 宽松）。payload 裸存原文（D-005）。
    """
    _user, scope = auth
    if scope.workspace_id is None:
        # 防御：require_platform_sync_write 的 shpsync_ 通道恒派生 workspace；到达此
        # 分支即凭据形态异常，403 关闭写通道（fail-closed，对齐 task-06 收紧语义）。
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="缺少工作区归属")
    await PlatformSyncService(session).upsert_quicklog_entry(
        workspace_id=scope.workspace_id,
        payload=body.model_dump(exclude_none=False),
    )
    return QuicklogPushOk(ql_id=body.ql_id)
