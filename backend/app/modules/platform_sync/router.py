"""platform_sync router — 进度同步层 6 端点（契约 sillyhub-progress-sync-contract.md）。

- POST /changes/{name}/progress：上行 progress + §4.2 base_ts 冲突检测（200/409）
- GET /changes：轻量列表（裸数组，按 token 派生 workspace 过滤）
- GET /changes/-/spec-manifest：服务器 spec 文件权威清单（2026-08-17-spec-file-incremental-sync task-01，design §5.2/§7）
- POST /changes/-/spec-sync：CLI 直跑增量 spec 文件 ops（2026-08-17-spec-file-incremental-sync task-02，design §5.2/§7）
- GET /changes/{name}/progress：完整 JSON（裸六表 + 顶层 last_pushed_at，404）
- POST /changes/{name}/documents：四件套全文同步（2026-08-14-platform-sync-docs-approval，D-004@v1）
- POST /changes/{name}/approval：审批决定提交（同上，D-001@v1 完整闭环）
- GET /changes/{name}/approval：审批状态查询（改读库，无记录默认 approved 放行）
- POST /quicklog-entries：quicklog 条目上行（幂等 upsert）
- POST /agent-logs：agent 会话日志元信息批量上报（2026-08-23-platform-agent-log-ingest
  task-02，协议 docs/platform-agent-log-protocol.md §1，仅 shpsync_）
- GET /agent-logs：agent 会话日志列表（读 scope 过滤 + last_seen_at 倒序，同上 task-02）

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

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
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
    AgentLogListItem,
    AgentLogListResponse,
    AgentLogPushOk,
    AgentLogPushRequest,
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
    SpecManifestResponse,
    SpecSyncRequest,
    SpecSyncResponse,
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


# Change 2026-08-17-spec-file-incremental-sync task-01/task-02（design §5.2/§7）：
# 固定片段端点用 ``-`` 占位段，且必须注册在 ``/changes/{name}/...`` 路由之前
# （FastAPI 按注册顺序匹配），避免 ``{name}`` 贪婪匹配冲突。


@router.get("/changes/-/spec-manifest", response_model=SpecManifestResponse)
async def get_spec_manifest(
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: _write_auth,
) -> SpecManifestResponse:
    """GET 服务器 spec 文件权威清单（CLI 直跑增量同步锚点，design §5.2/§7）。

    CLI ``spec-sync.js`` 以此清单为锚 diff 本地 ``.sillyspec/``，算出增量 ops 后
    POST ``/changes/-/spec-sync``（D-004@v1：CLI 无本地缓存，服务器清单即基线）。

    读清单也收紧为写权限（``require_platform_sync_write``，仅 shpsync_ token，
    JWT/shk_live_ 403）——清单是增量写协议的一部分，避免非同步方探测文件布局。
    workspace_id 从 shpsync_ token 派生；无 workspace 归属 → 403 fail-closed
    （对齐 quicklog-entries 范式）。
    """
    _user, scope = auth
    if scope.workspace_id is None:
        # 防御：require_platform_sync_write 的 shpsync_ 通道恒派生 workspace；到达此
        # 分支即凭据形态异常，403 关闭通道（fail-closed）。
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="缺少工作区归属")
    files = await PlatformSyncService(session).get_spec_manifest(scope.workspace_id)
    return SpecManifestResponse(files=files)


@router.post("/changes/-/spec-sync", response_model=SpecSyncResponse)
async def push_spec_sync(
    body: SpecSyncRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: _write_auth,
) -> SpecSyncResponse:
    """POST 增量 spec 文件 ops（CLI 直跑增量同步，design §5.2/§7）。

    CLI ``spec-sync.js`` 以 spec-manifest 为锚 diff 本地 ``.sillyspec/`` 后把
    FileOp[] 整体一次 POST（空 ops 已在 CLI 短路不发请求，到达即有差异）。透传
    ``apply_spec_ops`` → ``SpecWorkspaceService.apply_ops``（单事务：成功全部落盘 /
    失败全部回滚）。conflict 不改 HTTP 状态（恒 200）：``conflict=true`` +
    ``server_versions`` 由 CLI console.warn 提示人工拍板、不阻塞（design §5.4/§5.5）；
    路径越界 422 由 apply_ops 的 AppError 透传（对齐 daemon 增量端点）。

    鉴权同 spec-manifest（``require_platform_sync_write``，仅 shpsync_ token，
    design §5.2——shpsync_ 此前只开放 progress/documents/approval 三写端点，本次
    起同 token 复用）；workspace_id 从 token 派生，无归属 → 403 fail-closed。
    """
    _user, scope = auth
    if scope.workspace_id is None:
        # 防御：require_platform_sync_write 的 shpsync_ 通道恒派生 workspace；到达此
        # 分支即凭据形态异常，403 关闭写通道（fail-closed，对齐 task-01 范式）。
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="缺少工作区归属")
    result = await PlatformSyncService(session).apply_spec_ops(
        workspace_id=scope.workspace_id, ops=body.ops
    )
    return SpecSyncResponse(
        ok=True,
        new_versions=result["new_versions"],
        conflict=result["conflict"],
        server_versions=result["server_versions"],
    )


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


# ── Change 2026-08-23-platform-agent-log-ingest task-02（design §3.2 / 协议 §1）──


@router.post("/agent-logs", response_model=AgentLogPushOk)
async def push_agent_logs(
    body: AgentLogPushRequest,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: _write_auth,
) -> AgentLogPushOk:
    """POST agent 会话日志元信息批量上报（协议 docs/platform-agent-log-protocol.md §1）。

    CLI ``sillyspec run`` 每次入口探测本地 harness 会话日志后 best-effort POST
    （5s 超时、失败只 warn 不阻断、本地 ``agent-session-log.json`` 留底）；上报只含
    路径与元信息、不含日志内容。语义恒 200 成功体（幂等 upsert，``(workspace_id,
    log_path)`` 整行覆盖 D-005，无乐观锁），CLI 不读 body、任意 2xx 即成功。

    workspace_id 从 require_platform_sync_write 派生（仅 shpsync_ 可写，D-004@v1；
    无凭据 401 / shk_live_·JWT 403，与 quicklog-entries 完全同款）；body 顶层
    ``workspace_id`` 键被 extra=ignore 吞掉——token 派生唯一权威，不信任 body。
    """
    _user, scope = auth
    if scope.workspace_id is None:
        # 防御：require_platform_sync_write 的 shpsync_ 通道恒派生 workspace；到达此
        # 分支即凭据形态异常，403 关闭写通道（fail-closed，对齐 quicklog-entries 范式）。
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="缺少工作区归属")
    upserted = await PlatformSyncService(session).upsert_agent_log_entries(
        workspace_id=scope.workspace_id,
        entries=body.entries,
        pushed_at=body.pushed_at,
        scan_run_id=body.scan_run_id,
    )
    return AgentLogPushOk(upserted=upserted)


@router.get("/agent-logs", response_model=AgentLogListResponse)
async def list_agent_logs(
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: _read_auth,
    workspace_id: uuid.UUID | None = Query(default=None, description="可选 workspace 过滤"),
    limit: int = Query(default=20, ge=1, le=100, description="返回条数，默认 20 上限 100"),
) -> AgentLogListResponse:
    """GET agent 会话日志列表（design §3.2 读通道，会话详情页日志线索）。

    鉴权 scope 复用 ``_read_args`` 翻译（shpsync_ → token 绑定 workspace；JWT/
    shk_live_ → CHANGE_READ 并集，本表 workspace_id NOT NULL 无 NULL 桶）。可选
    ``workspace_id`` query 参数再 AND 等值过滤：不在 scope 内（越权）→ 空列表，
    不 403 不泄漏 workspace 存在性（D-004）。排序 ``last_seen_at DESC NULLS LAST``
    （显式 nulls_last 消除方言分叉 X-07；ISO 8601 UTC 字典序 = 时间序 D-003）。
    响应字段 snake_case 原样（X-06，前端类型以 gen:types 生成契约为准）。
    """
    _user, scope = auth
    rows = await PlatformSyncService(session).list_agent_logs(
        **_read_args(scope),
        filter_workspace_id=workspace_id,
        limit=limit,
    )
    return AgentLogListResponse(items=[AgentLogListItem.model_validate(row) for row in rows])
