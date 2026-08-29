"""platform_sync router — 进度同步层 6 端点（契约 sillyhub-progress-sync-contract.md）。

- POST /changes/{name}/progress：上行 progress + §4.2 base_ts 冲突检测（200/409）
- GET /changes：轻量列表（裸数组，按 token 派生 workspace 过滤）
- GET /changes/-/spec-manifest：服务器 spec 文件权威清单（2026-08-17-spec-file-incremental-sync task-01，design §5.2/§7）
- POST /changes/-/spec-sync：CLI 直跑增量 spec 文件 ops（2026-08-17-spec-file-incremental-sync task-02，design §5.2/§7）
- GET /changes/-/spec-bundle：CLI 直跑拉服务器 spec 整树 tar（2026-08-29-change-delete-closure-and-spec-pull task-08，design §7.1/§7.3）
- GET /changes/{name}/progress：完整 JSON（裸六表 + 顶层 last_pushed_at，404）
- POST /changes/{name}/documents：四件套全文同步（2026-08-14-platform-sync-docs-approval，D-004@v1）
- POST /changes/{name}/approval：审批决定提交（同上，D-001@v1 完整闭环）
- GET /changes/{name}/approval：审批状态查询（改读库，无记录默认 approved 放行）
- POST /quicklog-entries：quicklog 条目上行（幂等 upsert）
- POST /agent-logs：agent 会话日志元信息批量上报（2026-08-23-platform-agent-log-ingest
  task-02，协议 docs/platform-agent-log-protocol.md §1，仅 shpsync_）
- GET /agent-logs：agent 会话日志列表（读 scope 过滤 + last_seen_at 倒序，同上 task-02）
- GET /agent-logs/{entry_id}/content：单条日志原文尾部查看（2026-08-23-agent-activity-sessions
  task-05；读取前置/错误映射自 agent-log-conversation-view task-03 起抽共享 helper）
- GET /agent-logs/{entry_id}/messages：单条日志对话化归一化消息（2026-08-23-agent-log-
  conversation-view task-03，design §7.2；status 四值一律 200 分层、老 daemon 422）

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
from typing import TYPE_CHECKING, Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import JSONResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_session
from app.modules.auth.model import User
from app.modules.platform_sync.auth import (
    PlatformSyncAuthScope,
    require_platform_sync,
    require_platform_sync_write,
)
from app.modules.platform_sync.schema import (
    AgentLogContentResponse,
    AgentLogListItem,
    AgentLogListResponse,
    AgentLogMessagesResponse,
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

if TYPE_CHECKING:
    # 仅类型标注用（helper 返回值）；运行时 import 维持函数级（防模块加载环，
    # 与 read_agent_log_content 既有函数级 import 惯例一致）。
    from app.modules.platform_sync.model import AgentSessionLogORM

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
    if result.change_deleted:
        # task-04（FR-04 复活通道 4 / design §11）：已删 key 拒收——409 + 错误体
        # ``code='change_deleted'``，与下方 base_ts 冲突 409（契约 §4.4 body）按
        # code 字段区分。旧 CLI 把任意 409 当冲突处理：重试无害、最终报推送失败
        # 可接受（design §11 兼容口径）。错误体在本层 JSONResponse 直接构造，
        # 不动 schema.py 的 ConflictResponse（本卡文件集不含 schema.py）。
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={
                "code": "change_deleted",
                "message": "该变更已在平台删除，进度上行被拒收；请在本地 unregister 该变更。",
                "change_name": name,
            },
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
# task-08（2026-08-29-change-delete-closure-and-spec-pull）的 spec-bundle 同入
# 本块（R-06：字面量路由前置注册不可妥协）。


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
        # 审计 A6：透出被平台墓碑拒绝的路径列表（CLI 区分墓碑拒绝与版本冲突）
        platform_deleted=result["platform_deleted"],
    )


@router.get("/changes/-/spec-bundle")
async def get_spec_bundle(
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: _write_auth,
) -> StreamingResponse:
    """GET 服务器 spec 整树 tar（CLI 直跑拉取口子，task-08 / design §7.1 / FR-07）。

    持 ``shpsync_`` token 的 CLI 可拉本 workspace 整树（浏览器用户走既有 RBAC
    bundle 端点 ``GET /workspaces/{ws}/spec-workspace/bundle``）。鉴权同
    spec-manifest 先例：``require_platform_sync_write``（仅 shpsync_，JWT/
    shk_live_ 凭据有效也 403）——只读拉 bundle 是 shpsync_ 既有 spec-sync 写
    能力的严格子集，无越权扩大（design §7.1 权限评估）；不用读鉴权是为避免
    非同步方探测文件布局。workspace 唯一来源是 token 派生（URL 不带 workspace
    选择器，G6）；``scope.workspace_id`` 为空 → 403 fail-closed（对齐 task-01
    范式）。

    路由顺序硬约束（R-06，ppm export-excel 同款坑）：本字面量 ``-`` 段路由必须
    注册在 ``/changes/{name}/...`` 参数路由之前（FastAPI 按注册顺序匹配，防
    ``{name}`` 贪婪吞掉 ``-`` 段）——故放在下方 ``GET /changes/{name}/progress``
    之前的字面量端点块内，勿挪到文件尾。

    响应 ``application/x-tar`` 流：``Content-Disposition`` 文件名 + ``X-Spec-
    Version``（= ``spec_ws.spec_version``）；tar 顶层含内存生成的
    ``PLATFORM-BUNDLE.json`` 快照元数据（design §7.3，service.build_bundle）。
    二进制流不进 OpenAPI DTO（openapi.json/api-types 再生成归 gen:types 时点）。
    """
    _user, scope = auth
    if scope.workspace_id is None:
        # 防御：require_platform_sync_write 的 shpsync_ 通道恒派生 workspace；到达此
        # 分支即凭据形态异常，403 关闭通道（fail-closed，对齐 task-01 范式）。
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="缺少工作区归属")
    # 函数级 import 防模块加载环（对齐 service.py 透调 SpecWorkspaceService 惯例）。
    from app.modules.spec_workspace.service import SpecWorkspaceService

    _spec_root, spec_version, tar_stream = await SpecWorkspaceService(session).build_bundle(
        scope.workspace_id
    )
    return StreamingResponse(
        tar_stream,
        media_type="application/x-tar",
        headers={
            "Content-Disposition": f'attachment; filename="spec-bundle-{scope.workspace_id}.tar"',
            "X-Spec-Version": str(spec_version),
        },
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

    2026-08-23-agent-activity-sessions task-04（design §3.3.3）：透传鉴权 tuple 派生
    的真实 User id（tool_report 会话 owner，R-02）与 body 级 ``hub_session_id``
    （daemon env 注入的平台会话关联）给 service 做落库后归属——hub 未命中/跨 ws
    静默降级（D-005），响应恒 200 不变。
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
        # 建会话 owner = token 签发人（R-02 隔离语义：他人 token 上报产生他人会话）。
        user_id=_user.id,
        hub_session_id=body.hub_session_id,
    )
    return AgentLogPushOk(upserted=upserted)


@router.get("/agent-logs", response_model=AgentLogListResponse)
async def list_agent_logs(
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: _read_auth,
    workspace_id: uuid.UUID | None = Query(default=None, description="可选 workspace 过滤"),
    session_id: uuid.UUID | None = Query(
        default=None, description="可选会话过滤（只回该会话关联条目）"
    ),
    limit: int = Query(default=20, ge=1, le=100, description="返回条数，默认 20 上限 100"),
) -> AgentLogListResponse:
    """GET agent 会话日志列表（design §3.2 读通道，会话详情页日志线索）。

    鉴权 scope 复用 ``_read_args`` 翻译（shpsync_ → token 绑定 workspace；JWT/
    shk_live_ → CHANGE_READ 并集，本表 workspace_id NOT NULL 无 NULL 桶）。可选
    ``workspace_id`` query 参数再 AND 等值过滤：不在 scope 内（越权）→ 空列表，
    不 403 不泄漏 workspace 存在性（D-004）。

    2026-08-23-agent-activity-sessions task-04（design §3.3.6）：可选 ``session_id``
    query 参数再 AND ``agent_session_id`` 等值——会话详情页只取该会话关联条目；
    会话存在但不属 scope（越权）→ 空列表同既有语义（scope 过滤天然拦截）。
    排序 ``last_seen_at DESC NULLS LAST``（显式 nulls_last 消除方言分叉 X-07；
    ISO 8601 UTC 字典序 = 时间序 D-003）。响应字段 snake_case 原样（X-06，前端
    类型以 gen:types 生成契约为准）。
    """
    _user, scope = auth
    rows = await PlatformSyncService(session).list_agent_logs(
        **_read_args(scope),
        filter_workspace_id=workspace_id,
        filter_session_id=session_id,
        limit=limit,
    )
    return AgentLogListResponse(items=[AgentLogListItem.model_validate(row) for row in rows])


# ── 2026-08-23-agent-activity-sessions task-05（design §3.3.5 内容查看端点）；──
# ── 2026-08-23-agent-log-conversation-view task-03：读取前置/RPC 错误映射抽共享 helper ──

#: format 黑名单子串（Grill P2 改黑名单语义）：命中即视为二进制，409 拒绝在线
#: 查看；其余（含 *-jsonl / opencode-session-json-tree / unknown 等文本类）放行。
#: 子串匹配覆盖 sqlite3 / *-zstd 等变体；format 为 None（未上报）放行由 daemon
#: 读取侧兜底（文本读失败会以 remote error 形式显式报错，不静默）。
_AGENT_LOG_BINARY_FORMAT_TOKENS: frozenset[str] = frozenset({"sqlite", "zstd"})

#: 内容尾部截断上限（字节）：daemon 整文件读回后只下发尾部 262144 字节
#: （256 KiB，最新内容在尾部）；回解 ``errors="ignore"`` 防多字节字符被切。
_AGENT_LOG_CONTENT_MAX_BYTES = 262144


async def _resolve_agent_log_read_target(
    session: AsyncSession,
    entry_id: uuid.UUID,
    scope: PlatformSyncAuthScope,
) -> tuple[AgentSessionLogORM, uuid.UUID]:
    """agent 日志读取共享前置（task-03 从 read_agent_log_content 抽取，行为保持）。

    content / messages 两端点共用（2026-08-23-agent-log-conversation-view design
    §5/§7.2），防 scope/黑名单/daemon 定位两口径漂移：

    1. scope 内校验：shpsync_ 精确匹配 token 派生 workspace；JWT/shk_live_ 并集
       包含。不可见/不存在同语义 404（不泄漏存在性，口径同 list_agent_logs）。
    2. format 黑名单（Grill P2）：二进制格式显式 409，不喂给文本渲染。
    3. 定位目标 daemon：``entry.agent_session.runtime_id → DaemonRuntime.
       daemon_instance_id``（迁移窗口回落 runtime_id）优先；pending 未激活 →
       ``resolve_daemon_instance_for_workspace(entry.workspace_id)``；都无 →
       404 中文。

    Returns ``(entry, daemon_id)``；不可恢复错误直接 raise AppError。
    """
    from sqlalchemy import select

    from app.core.errors import AppError
    from app.modules.agent.model import AgentSession
    from app.modules.daemon.session.service import _resolve_daemon_id_for_runtime
    from app.modules.platform_sync.model import AgentSessionLogORM
    from app.modules.workspace.member_runtimes.queries import (
        resolve_daemon_instance_for_workspace,
    )

    entry = (
        await session.execute(select(AgentSessionLogORM).where(AgentSessionLogORM.id == entry_id))
    ).scalar_one_or_none()
    # scope 内校验：shpsync_ 精确匹配 token 派生 workspace；JWT/shk_live_ 并集
    # 包含。不可见/不存在同语义 404（不泄漏存在性，口径同 list_agent_logs）。
    # entry is None 与越权在同一 if 直接判（不用中间布尔变量），mypy 才能在此后
    # 把 entry 收窄为非 None（函数返回类型是 AgentSessionLogORM 非 Optional）。
    if entry is None or (
        entry.workspace_id != scope.workspace_id
        if scope.workspace_id is not None
        else entry.workspace_id not in scope.allowed_workspace_ids_
    ):
        raise AppError(
            "日志条目不存在或无权访问。",
            code="HTTP_404_AGENT_LOG_ENTRY_NOT_FOUND",
            http_status=404,
            details={"entry_id": str(entry_id)},
        )

    # ── 1. format 黑名单（Grill P2）：二进制格式显式 409，不喂给文本渲染。──
    fmt = (entry.format or "").lower()
    if any(token in fmt for token in _AGENT_LOG_BINARY_FORMAT_TOKENS):
        raise AppError(
            "该日志格式为二进制，暂不支持在线查看。",
            code="HTTP_409_AGENT_LOG_BINARY_FORMAT",
            http_status=409,
            details={"entry_id": str(entry_id), "format": entry.format},
        )

    # ── 2. 定位目标 daemon（会话已激活绑机优先；未激活回落 workspace 绑定）。──
    daemon_id: uuid.UUID | None = None
    if entry.agent_session_id is not None:
        runtime_id = (
            await session.execute(
                select(AgentSession.runtime_id).where(AgentSession.id == entry.agent_session_id)
            )
        ).scalar_one_or_none()
        if runtime_id is not None:
            # runtime→daemon_instance 映射（迁移窗口 daemon_instance_id 为 NULL 时
            # 回落 runtime_id 作连接键），runtime 行缺失返回 None 继续回落。
            daemon_id = await _resolve_daemon_id_for_runtime(session, runtime_id)
    if daemon_id is None:
        daemon_id = await resolve_daemon_instance_for_workspace(session, entry.workspace_id)
    if daemon_id is None:
        raise AppError(
            "未找到可读取该日志的机器（会话未激活且工作区未绑定守护进程），无法在线查看内容。",
            code="HTTP_404_AGENT_LOG_NO_BOUND_DAEMON",
            http_status=404,
            details={"entry_id": str(entry_id)},
        )
    return entry, daemon_id


async def _send_agent_log_rpc(
    entry: AgentSessionLogORM,
    daemon_id: uuid.UUID,
    method: str,
    args: dict[str, Any],
    *,
    unsupported_on_method_not_found: bool = False,
) -> dict[str, Any]:
    """agent 日志读取共享 RPC + ``DaemonRpcRemoteError`` 映射（task-03 抽取，行为保持）。

    直连 ws rpc（**不走 ``HostFsDelegate.read_file``**——其 ``_via_rpc_or_degrade``
    会把离线/远端错静默降级为空串，与错误语义冲突），默认 30s 传输预算。错误映射：

    - ``forbidden``（allowed_roots 白名单外）→ 409 中文（含 allowed_roots 配置指引）；
    - ``not_found``（文件不存在）→ 404 中文；
    - ``method_not_found``（老 daemon 未注册该方法）→ 422 中文
      ``HTTP_422_AGENT_LOG_UNSUPPORTED``——仅 ``unsupported_on_method_not_found=
      True`` 的调用方启用（messages 端点新方法；content 端点 read_file 全代
      daemon 均已注册，恒 False 保持既有语义）；
    - 其余远端错 → 既有 502 网关语义（不裸抛非 AppError 的 500）；
    - 离线（``DaemonRuntimeOffline``）/ 超时（``DaemonRpcTimeout``）为既有 AppError
      原样透传（错误处理器按既有 code/http_status 渲染，不在此改写语义）。
    """
    from app.core.errors import AppError
    from app.modules.daemon.host_fs.ws_rpc import send_host_fs_rpc
    from app.modules.daemon.runtime.service import (
        DaemonRpcRemoteError,
        DaemonRpcRemoteGatewayError,
    )
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    hub = get_daemon_ws_hub()
    try:
        return await send_host_fs_rpc(hub, daemon_id, method, entry.workspace_id, args)
    except DaemonRpcRemoteError as exc:
        # daemon 侧业务错（code 来自 toRpcError / assertWithinAllowedRoots）：
        # forbidden（allowed_roots 白名单外）/ not_found（文件不存在）显式中文，
        # 其余远端错沿用既有 502 网关语义（不裸抛非 AppError 的 500）。
        if exc.code == "forbidden":
            raise AppError(
                "读取该日志被守护进程拒绝：日志路径不在 allowed_roots 白名单内。"
                "请在 daemon 配置的 allowed_roots 中加入该日志所在目录后重试。",
                code="HTTP_409_AGENT_LOG_READ_FORBIDDEN",
                http_status=409,
                details={"entry_id": str(entry.id), "log_path": entry.log_path},
            ) from exc
        if exc.code == "not_found":
            raise AppError(
                "日志文件在目标机器上不存在（可能已被清理或移动）。",
                code="HTTP_404_AGENT_LOG_FILE_NOT_FOUND",
                http_status=404,
                details={"entry_id": str(entry.id), "log_path": entry.log_path},
            ) from exc
        if unsupported_on_method_not_found and exc.code == "method_not_found":
            # 老 daemon 未升级：ws-client ``_dispatchRpc`` 对未注册 method 回
            # ``error.code='method_not_found'``（实测 ws-client.ts:530）→ 422，
            # 前端据此回落原文端点（design §7.2 / D-003@v1；唯一 422 场景）。
            raise AppError(
                "当前机器的守护进程版本过旧，暂不支持对话式查看日志；"
                "请升级守护进程后重试，或改用原文查看。",
                code="HTTP_422_AGENT_LOG_UNSUPPORTED",
                http_status=422,
                details={"entry_id": str(entry.id), "daemon_code": exc.code},
            ) from exc
        raise DaemonRpcRemoteGatewayError(
            f"读取日志内容失败（daemon 返回错误：{exc.code}）。",
            details={"entry_id": str(entry.id), "daemon_code": exc.code},
        ) from exc


@router.get("/agent-logs/{entry_id}/content", response_model=AgentLogContentResponse)
async def read_agent_log_content(
    entry_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: _read_auth,
) -> AgentLogContentResponse:
    """GET 单条 agent 日志的内容（design §3.3.5，读即弃不落库）。

    鉴权 scope 校验 entry 可见（shpsync_ = token 绑定 workspace；JWT/shk_live_ =
    CHANGE_READ 并集），不可见 404 中文（不泄漏存在性）。

    读取链路（scope 校验 / format 黑名单 / daemon 定位 / 错误映射自 task-03 起
    共享 ``_resolve_agent_log_read_target`` + ``_send_agent_log_rpc``，与 messages
    端点同口径）：

    1. format 黑名单（sqlite/zstd 子串）→ 409 中文「二进制暂不支持」。
    2. 定位 daemon_id：会话 runtime→daemon_instance 优先；workspace 绑定回落；
       都无 → 404 中文。
    3. ``host_fs.read_file {path}`` RPC（默认 30s 超时）；daemon 拒 forbidden →
       409 中文（含 allowed_roots 配置指引）/ not_found → 404 中文 / 其余远端
       错 → 既有 502；机器离线 → 既有 ``DaemonRuntimeOffline``；RPC 超时 →
       既有 ``DaemonRpcTimeout``（504）。
    4. 尾部 262144 字节截断（``errors="ignore"`` 回解）后返回
       ``{content, truncated, size_bytes}``。
    """
    _user, scope = auth
    entry, daemon_id = await _resolve_agent_log_read_target(session, entry_id, scope)
    result = await _send_agent_log_rpc(entry, daemon_id, "read_file", {"path": entry.log_path})

    content = str(result.get("content", "")) if isinstance(result, dict) else ""
    # ── 4. 尾部 262144 字节截断（多字节字符被切由 errors=ignore 吞掉）。──
    raw = content.encode("utf-8")
    size_bytes = len(raw)
    truncated = size_bytes > _AGENT_LOG_CONTENT_MAX_BYTES
    if truncated:
        content = raw[-_AGENT_LOG_CONTENT_MAX_BYTES:].decode("utf-8", errors="ignore")
    return AgentLogContentResponse(content=content, truncated=truncated, size_bytes=size_bytes)


# ── 2026-08-23-agent-log-conversation-view task-03（design §7.2 对话化消息端点）──


@router.get("/agent-logs/{entry_id}/messages", response_model=AgentLogMessagesResponse)
async def read_agent_log_messages(
    entry_id: uuid.UUID,
    session: Annotated[AsyncSession, Depends(get_session)],
    auth: _read_auth,
    before_seq: int | None = Query(
        default=None, description="加载更早段：返回 seq 严格小于该值的窗口切片"
    ),
) -> AgentLogMessagesResponse:
    """GET 单条 agent 日志的对话化归一化消息（design §7.2，读即弃不落库）。

    scope 校验 / format 二进制 409 / daemon 定位 / RpcError→HTTP 映射全部复用
    ``_resolve_agent_log_read_target`` + ``_send_agent_log_rpc``（与 content 端点
    共享，防两口径漂移）。

    调 ``host_fs.read_agent_log_messages {path, format, beforeSeq?}``（task-02
    契约，默认 30s 传输预算）：daemon 全量读文件本地解析后只回 KB 级归一化消息
    （FR-02，替代 content 端点 256KB 原文尾部口径）。外层 daemon 返回 camelCase
    （``totalSegments``/``skippedLines``）→ 本端点转换层落 snake_case；messages
    内层逐字段已对齐（design §7.1）无需改名。

    status 四值（parsed/unsupported/parse_error/too_large）**一律 200 透传**——
    「RPC 成功≠解析成功」，unsupported/parse_error/too_large 由前端判断回落原文
    端点（design §7.2 / D-003@v1）；本端点零解析零改写（D-001@v1）。唯一 422：
    老 daemon 未注册该方法（``method_not_found``）→
    ``HTTP_422_AGENT_LOG_UNSUPPORTED``。``before_seq`` (int | None) 透传 daemon
    侧 ``beforeSeq``（加载更早切片键，FR-05）。
    """
    _user, scope = auth
    entry, daemon_id = await _resolve_agent_log_read_target(session, entry_id, scope)

    rpc_args: dict[str, Any] = {"path": entry.log_path, "format": entry.format or ""}
    if before_seq is not None:
        rpc_args["beforeSeq"] = before_seq
    result = await _send_agent_log_rpc(
        entry,
        daemon_id,
        "read_agent_log_messages",
        rpc_args,
        unsupported_on_method_not_found=True,
    )

    # camelCase→snake_case 转换层（messages 内层逐字段已对齐，model_validate
    # 递归校验即可）；status 非四值（契约破坏）由 pydantic 显式炸出而非静默改写。
    return AgentLogMessagesResponse.model_validate(
        {
            "status": result.get("status"),
            "messages": result.get("messages") or [],
            "truncated": result.get("truncated", False),
            "total_segments": result.get("totalSegments", 0),
            "skipped_lines": result.get("skippedLines", 0),
        }
    )
