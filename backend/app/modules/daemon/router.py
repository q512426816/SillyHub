"""HTTP routes for daemon runtime management and task lease lifecycle."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Annotated, Literal

from fastapi import (
    APIRouter,
    Depends,
    Header,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_principal, require_permission_any
from app.core.config import get_settings
from app.core.db import get_session, get_session_factory
from app.core.logging import get_logger
from app.modules.agent.schema import AgentRunLogEntry
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.daemon.permission_service import (
    DaemonPermissionService,
    PermissionResponseRead,
    SessionDialogRead,
)
from app.modules.daemon.protocol import (
    DAEMON_MSG_HEARTBEAT,
    DAEMON_MSG_PERMISSION_REQUEST,
    DAEMON_MSG_RPC_RESULT,
    PermissionRequestPayload,
)
from app.modules.daemon.run_sync.service import publish_submitted_messages
from app.modules.daemon.schema import (
    AgentSessionListResponse,
    AgentSessionRead,
    DaemonInstanceProviderItem,
    DaemonInstanceRead,
    DaemonRegisterRequest,
    DaemonRegisterResponse,
    DaemonRegisterRuntimeItem,
    DaemonRuntimeAllowedRootsUpdate,
    DaemonRuntimeListResponse,
    DaemonRuntimeRead,
    DaemonRuntimeUpdate,
    DaemonTaskLeaseRead,
    LeaseClaimRequest,
    LeaseClaimResponse,
    LeaseCompleteRequest,
    LeaseCompleteResponse,
    LeaseHeartbeatRequest,
    LeaseHeartbeatResponse,
    LeaseMessagesRequest,
    LeaseMessagesResponse,
    LeaseStartRequest,
    LeaseStartResponse,
    LeaseSyncRequest,
    LeaseSyncResponse,
    ListDirRequest,
    ListDirResponse,
    OwnerRead,
    RuntimeUsageListResponse,
    RuntimeUsageWindow,
    SessionReopenResponse,
)
from app.modules.daemon.service import (
    DaemonLeaseNotFound,
    DaemonRpcForbiddenError,
    DaemonRpcGatewayError,
    DaemonRpcRemoteError,
    DaemonRpcRemoteGatewayError,
    DaemonRpcTimeout,
    DaemonRuntimeNotFound,
    DaemonRuntimeOffline,
    DaemonService,
    DaemonSessionNotFound,
)

log = get_logger(__name__)


# ── Daemon distribution metadata (public, no auth) ───────────────────────────
# GET /api/daemon/version —— 供前端安装区块 / install.sh 拉取最新版本号与下载地址。
# 当前硬编码；后续可改为读 nginx 托管的 latest.json 或配置中心。
# latest.json（install.sh 消费）字段：version / downloadUrl；本端点多返回 minRequired
# 供前端做版本门槛提示。
DAEMON_DOWNLOAD_URL = "/daemon/latest/sillyhub-daemon.js"


def _compute_daemon_version() -> str:
    """从已部署的 daemon bundle 中提取 BUILD_ID（git short SHA）。

    daemon 侧 build-id.ts 在 bundle 时注入 BUILD_ID，此处从部署的 JS 文件中
    正则提取。提取失败时回退 "unknown"。
    """
    import re

    try:
        bundle_path = get_settings().daemon_dist_dir / "sillyhub-daemon.js"
        if not bundle_path.is_file():
            return "unknown"
        text = bundle_path.read_text(errors="replace")
        m = re.search(r'BUILD_ID\s*=\s*["\x27]([^"\x27]+)', text)
        return m.group(1) if m else "unknown"
    except Exception:
        return "unknown"


def _compute_daemon_semver() -> str:
    """从已部署 bundle 提取 DAEMON_VERSION（语义版本）。

    2026-07-04-daemon-version-management D-004/D-009：与 BUILD_ID（SHA）分开提取，
    供 GET /api/daemon/version 展示语义版本（self-update 仍用 BUILD_ID 比对）。
    提取失败回退 "unknown"。
    """
    import re

    try:
        bundle_path = get_settings().daemon_dist_dir / "sillyhub-daemon.js"
        if not bundle_path.is_file():
            return "unknown"
        text = bundle_path.read_text(errors="replace")
        m = re.search(r'DAEMON_VERSION\s*=\s*["\x27]([^"\x27]+)', text)
        return m.group(1) if m else "unknown"
    except Exception:
        return "unknown"


def get_daemon_latest_version() -> str:
    """缓存 daemon latest BUILD_ID（git SHA，进程级，deploy 后不变）。

    2026-07-04-daemon-version-management D-009：返回值仍为 SHA，供 self-update 端点
    WS 推送（daemon preflight 按 BUILD_ID 比对）。语义版本走 get_daemon_latest_semver。
    """
    global _DAEMON_VERSION_CACHE
    if _DAEMON_VERSION_CACHE is None:
        _DAEMON_VERSION_CACHE = _compute_daemon_version()
    return _DAEMON_VERSION_CACHE


def get_daemon_latest_semver() -> str:
    """缓存 daemon latest 语义版本（DAEMON_VERSION，供前端展示）。"""
    global _DAEMON_SEMVER_CACHE
    if _DAEMON_SEMVER_CACHE is None:
        _DAEMON_SEMVER_CACHE = _compute_daemon_semver()
    return _DAEMON_SEMVER_CACHE


_DAEMON_VERSION_CACHE: str | None = None
_DAEMON_SEMVER_CACHE: str | None = None


class DaemonVersionResponse(BaseModel):
    """GET /api/daemon/version 响应：daemon 分发元数据（公开端点）。

    2026-07-04-daemon-version-management D-004：新增 latest_version（语义）+
    latest_build_id（SHA），供前端版本比对与升级入口。旧 latest/minRequired/
    downloadUrl 保留（install.sh 兼容）。
    """

    latest: str = Field(description="最新发布版本号（= latest_build_id 回退值，兼容 install.sh）")
    minRequired: str = Field(description="最低兼容版本号（低于则需升级）")  # noqa: N815 - JSON 契约字段名（install.sh/前端消费，不可改 snake_case）
    downloadUrl: str = Field(description="单文件 bundle 下载地址（相对站内路径）")  # noqa: N815 - JSON 契约字段名（install.sh/前端消费，不可改 snake_case）
    latest_version: str = Field(
        description="最新语义版本（DAEMON_VERSION，bundle 提取失败=unknown）"
    )
    latest_build_id: str = Field(description="最新构建标识（BUILD_ID/git SHA，前端升级比对用）")


# ── Per-daemon heartbeat DTO（inline，task-07）─────────────────────────────────
# design §5.4 / §9.1：daemon 单条心跳合并上报 daemon_local_id + 各 provider 状态。
# 原 schema.py 内的 runtime_id 版本已被 per-daemon 契约取代；DTO 内联在此避免
# 触碰 schema.py（task-05 的 allowed_path，非 task-07）。WS breaking（D-007）：
# daemon_local_id 必填，旧 daemon per-provider body 会被 pydantic 拒成 422。


class DaemonHeartbeatProviderItem(BaseModel):
    """单个 provider 心跳上报项（per-daemon heartbeat body 内 ``providers[]``）。"""

    provider: str = Field(min_length=1, max_length=50)
    status: str = Field(default="online", max_length=20)


class DaemonHeartbeatRequest(BaseModel):
    """Per-daemon 心跳请求体（design §5.4 / §9.1 / D-006）。

    daemon 周期上报其 ``daemon_local_id``（=daemon_instances.id）+ 各 provider 的
    当前 status。backend 刷新 daemon_instances.last_heartbeat_at + 各 runtime.status。
    2026-07-04-daemon-version-management：同时上报 daemon_version/daemon_build_id
    （D-002，register + heartbeat 都带），backend 刷新 instance.version/build_id。
    """

    daemon_local_id: uuid.UUID = Field(description="daemon 本地 uuid（daemon_instances.id）")
    daemon_version: str | None = Field(default=None, max_length=50)
    daemon_build_id: str | None = Field(default=None, max_length=50)
    providers: list[DaemonHeartbeatProviderItem] = Field(default_factory=list)


class DaemonHeartbeatRuntimePolicy(BaseModel):
    """心跳响应内单个 runtime 的 per-runtime allowed_roots。"""

    runtime_id: uuid.UUID
    allowed_roots: list[str]


class DaemonHeartbeatResponse(BaseModel):
    """Per-daemon 心跳响应体。

    2026-07-06-allowed-roots-per-runtime：返 per-runtime allowed_roots map
    （runtimes: [{runtime_id, allowed_roots}]），daemon _syncAllowedRoots per-runtime 同步。
    """

    daemon_instance_id: uuid.UUID
    status: str
    runtimes: list[DaemonHeartbeatRuntimePolicy] = Field(default_factory=list)


# SSE response headers shared with the run-scoped stream endpoint
# (app/modules/agent/router.py). Proxies/buffers must not hold SSE frames.
_SESSION_SSE_HEADERS = {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "X-Accel-Buffering": "no",
}

router = APIRouter(prefix="/daemon", tags=["daemon"])

# task-09：change-write 任务队列回执三端点（FR-08 / D-004@v1），复用本 router 的
# /daemon prefix + tag；路由写相对路径（/runtimes/{rid}/pending-change-writes 等），
# 经外层 main.py 的 prefix="/api" 挂载后落地 /api/daemon/...
from app.modules.daemon.change_write_router import (  # noqa: E402
    router as change_write_router,
)

router.include_router(change_write_router)

# task-10 / D-006@v1: daemon audit batch upload + paginated audit read.
# Inherits this router's /daemon prefix → POST resolves to
# /api/daemon/audit/batch (matches design §7.3); the GET audit read resolves
# to /api/daemon/workspaces/{wid}/runtimes/{rid}/policy-audit (deviation: design
# §7.3 wrote /api/workspaces/... but editing app/main.py is out of task-10's
# allowed_paths — see audit/router.py module docstring).
from app.modules.daemon.audit.router import router as audit_router  # noqa: E402

router.include_router(audit_router)

SessionDep = Annotated[AsyncSession, Depends(get_session)]
# 管理 UI 端点用 runtime:admin；daemon 自身的注册/心跳/lease 生命周期仍走 get_current_principal
RuntimeAdminUser = Annotated[User, Depends(require_permission_any(Permission.RUNTIME_ADMIN))]


# ── Daemon distribution metadata (public, no auth) ───────────────────────────
@router.get(
    "/version",
    response_model=DaemonVersionResponse,
)
async def get_daemon_version() -> DaemonVersionResponse:
    """公开端点：返回 daemon 最新版本 / 最低要求版本 / 下载地址。

    无需认证——前端「首次安装」区块与 install.sh 都需要匿名拉取该元数据。
    downloadUrl 为相对路径（如 ``/daemon/latest/sillyhub-daemon.js``），由 nginx
    静态托管；调用方（前端/脚本）按自身已知的服务端 base URL 拼接。
    """
    return DaemonVersionResponse(
        latest=get_daemon_latest_version(),
        minRequired="0.1.0",
        downloadUrl=DAEMON_DOWNLOAD_URL,
        latest_version=get_daemon_latest_semver(),
        latest_build_id=get_daemon_latest_version(),
    )


# ── Runtime registration & heartbeat ────────────────────────────────────────


@router.post(
    "/register",
    response_model=DaemonRegisterResponse,
    status_code=status.HTTP_201_CREATED,
)
async def register_daemon(
    data: DaemonRegisterRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> DaemonRegisterResponse:
    """Per-daemon 注册（design §5.2 / D-006）。

    daemon 启动一次性上报 daemon_local_id + 机器级字段 + provider 列表。backend
    先 upsert daemon_instances，再为每个 provider upsert daemon_runtimes，并清理
    stale runtime（provider 卸载）。返回 daemon_instance_id + 各 runtime_id。
    """
    svc = DaemonService(session)
    result = await svc.register_daemon(
        user.id,
        daemon_local_id=data.daemon_local_id,
        server_url=data.server_url,
        hostname=data.hostname,
        os=data.os,
        arch=data.arch,
        allowed_roots=data.allowed_roots,
        providers=[item.model_dump() for item in data.providers],
        daemon_version=data.daemon_version,
        daemon_build_id=data.daemon_build_id,
    )
    return DaemonRegisterResponse(
        daemon_instance_id=result.daemon_instance_id,
        runtimes=[
            DaemonRegisterRuntimeItem(
                provider=r.provider,
                runtime_id=r.runtime_id,
                allowed_roots=r.allowed_roots,
            )
            for r in result.runtimes
        ],
    )


@router.post(
    "/heartbeat",
    response_model=DaemonHeartbeatResponse,
)
async def daemon_heartbeat(
    data: DaemonHeartbeatRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> DaemonHeartbeatResponse:
    """Per-daemon HTTP 心跳（design §5.4 / §9.1 / D-006）。

    daemon 单条心跳合并上报 ``daemon_local_id`` + 各 provider 状态。backend 刷新
    ``daemon_instances.last_heartbeat_at`` + 各 ``daemon_runtimes.status``。
    ``heartbeat_ack`` 经 WS 下发到该 daemon 连接（task-06 通路），本 HTTP 响应只
    回 ``{daemon_instance_id, status, allowed_roots}``（allowed_roots 从 daemon
    实体读，已上提到 daemon_instances，design §4.2）。

    WS breaking（D-007）：旧 daemon 按 per-provider body 上报（无 daemon_local_id）
    → pydantic 校验 daemon_local_id 必填失败 → 422 拒绝，要求同步升级。
    """
    svc = DaemonService(session)
    instance = await svc.heartbeat_daemon(
        data.daemon_local_id,
        providers=[item.model_dump() for item in data.providers],
        daemon_version=data.daemon_version,
        daemon_build_id=data.daemon_build_id,
    )
    # ql-20260706-005：col 属 sqlmodel（非 sqlalchemy 顶层），误从 sqlalchemy
    # 导入会 ImportError → heartbeat 端点 500 → daemon 拿不到 per-runtime
    # allowed_roots → CC 配的可写目录全 deny。与 service.py:13 用法对齐。
    from sqlmodel import col as _col

    from app.modules.daemon.model import DaemonRuntime

    rt_rows = (
        (
            await session.execute(
                select(DaemonRuntime).where(_col(DaemonRuntime.daemon_instance_id) == instance.id)
            )
        )
        .scalars()
        .all()
    )
    return DaemonHeartbeatResponse(
        daemon_instance_id=instance.id,
        status=instance.status or "online",
        runtimes=[
            DaemonHeartbeatRuntimePolicy(
                runtime_id=rt.id,
                allowed_roots=list(rt.allowed_roots or []),
            )
            for rt in rt_rows
        ],
    )


# ── Runtime usage stats (FR-03 / D-002·003·004) ──────────────────────────────
# 静态路径 /runtimes/usage 必须声明在动态 /runtimes/{runtime_id} 之前：FastAPI 按声明
# 顺序匹配，否则 "usage" 会被 {runtime_id} 捕获，再 UUID parse 失败 -> 422。
# 聚合在 service 层(task-08)，router 仅做参数校验 + DTO 封装；window Enum 边界非法值
# 由 FastAPI 自动返回 422。


@router.get(
    "/runtimes/usage",
    response_model=RuntimeUsageListResponse,
)
async def get_runtimes_usage(
    session: SessionDep,
    user: RuntimeAdminUser,
    window: RuntimeUsageWindow = Query(
        RuntimeUsageWindow.DAY7,
        description="时间窗：1d(本地自然日 today 00:00，按小时) / 7d / 30d(按日)",
    ),
) -> RuntimeUsageListResponse:
    """批量返回全部 runtime 在指定时间窗内的 token/cache/cost 用量(FR-03)。

    聚合在 service 层用单条 LEFT JOIN+COALESCE SQL 去重(D-003@v2,task-08)；
    分组粒度 1d→hour / 7d·30d→day(D-002@v1)；起点 1d=本地自然日 today 00:00(D-004@v1)。
    空窗 / 无 runtime 正常返回 200 ``{"window":..., "runtimes":[]}``。
    """
    from app.modules.daemon.runtime.service import RuntimeService

    svc = RuntimeService(session)
    runtimes = await svc.get_runtimes_usage(window.value)
    log.info("runtimes_usage_served", window=window.value, count=len(runtimes))
    return RuntimeUsageListResponse(window=window.value, runtimes=runtimes)


def _derive_policy_version(updated_at: datetime | None) -> int:
    """Derive a monotonic policy ``version`` from a runtime's ``updated_at``.

    task-08 / D-004：daemon uses this to drop stale/reordered
    ``policy_update`` pushes (only accept when incoming version > local).
    Epoch millis keeps second-level writes distinct and is monotonic across
    successive DB writes (``update_allowed_roots`` bumps ``updated_at`` each
    call). A missing ``updated_at`` falls back to wall-clock now so the push
    still carries a sensible, forward-only value.
    """
    ts = updated_at if updated_at is not None else datetime.now(UTC)
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=UTC)
    return int(ts.timestamp() * 1000)


def _runtime_read(
    runtime: object,
    owner: object | None = None,
    instance: object | None = None,
) -> DaemonRuntimeRead:
    """Build DaemonRuntimeRead, attaching nested OwnerRead when an owner user
    row is available (task-04 / D-006@v1)。2026-07-04-daemon-version-management：
    instance 非空时填 daemon_version/daemon_build_id（JOIN daemon_instances 带出）。"""
    read = DaemonRuntimeRead.model_validate(runtime)
    update: dict[str, object] = {}
    if owner is not None:
        update["owner"] = OwnerRead(
            user_id=getattr(owner, "id", None),
            email=getattr(owner, "email", None),
            display_name=getattr(owner, "display_name", None),
        )
    if instance is not None:
        update["daemon_version"] = getattr(instance, "version", None)
        update["daemon_build_id"] = getattr(instance, "build_id", None)
    if not update:
        return read
    return read.model_copy(update=update)


# ── Runtime admin global list (task-04 / FR-01/04 / D-005@v1) ────────────────
# 固定路径 /runtimes/page 必须声明在动态 /runtimes/{runtime_id} 之前，否则
# "page" 会被 {runtime_id} 捕获再 UUID parse 失败 → 422（与 /runtimes/usage 同款约束）。


@router.get(
    "/runtimes/page",
    response_model=DaemonRuntimeListResponse,
)
async def list_runtimes_page(
    session: SessionDep,
    user: RuntimeAdminUser,
    q: str | None = Query(default=None, max_length=200),
    type_filter: str | None = Query(default=None, alias="type", max_length=50),
    status_filter: str | None = Query(default=None, alias="status", max_length=20),
    user_id: uuid.UUID | None = Query(default=None),
    limit: int = Query(default=12, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
) -> DaemonRuntimeListResponse:
    """平台管理员分页查看全部 owner 的 runtime；普通账号只见自己 (FR-01/02/04)."""
    svc = DaemonService(session)
    await svc.cleanup_stale_runtimes()
    rows, total = await svc.list_runtimes_page(
        actor_user_id=user.id,
        is_platform_admin=user.is_platform_admin,
        q=q,
        type_filter=type_filter,
        status_filter=status_filter,
        user_id=user_id,
        limit=limit,
        offset=offset,
    )
    return DaemonRuntimeListResponse(
        items=[_runtime_read(runtime, owner, instance) for runtime, owner, instance in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.patch(
    "/runtimes/{runtime_id}",
    response_model=DaemonRuntimeRead,
)
async def update_runtime(
    runtime_id: uuid.UUID,
    data: DaemonRuntimeUpdate,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> DaemonRuntimeRead:
    """PATCH runtime display_alias (task-04 / FR-03 / D-002@v1).

    省略 display_alias = 不变；显式 null/空白 = 清空；字符串 = 更新（strip）。
    """
    svc = DaemonService(session)
    runtime = await svc.update_runtime(
        runtime_id,
        user.id,
        display_alias=data.display_alias,
        display_alias_set="display_alias" in data.model_fields_set,
        is_platform_admin=user.is_platform_admin,
    )
    return DaemonRuntimeRead.model_validate(runtime)


@router.put(
    "/runtimes/{runtime_id}/allowed-roots",
    response_model=DaemonRuntimeRead,
)
async def update_runtime_allowed_roots(
    runtime_id: uuid.UUID,
    data: DaemonRuntimeAllowedRootsUpdate,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> DaemonRuntimeRead:
    """PUT runtime allowed_roots sandbox (2026-06-29-runtime-allowed-roots-config task-02).

    admin 配置 daemon 可访问目录（多路径，绝对路径或 ~ 开头）。

    task-08 / design §5.3：DB 写入成功后 best-effort 推送 ``policy_update`` 到在线
    daemon（sub-second 热更新）。推送失败（runtime 离线 / 通道异常）不阻断 PUT
    响应——daemon 在下一次心跳拉取全量 resync 兜底（R-07）。``version`` 从更新后
    runtime 的 ``updated_at`` 派生为 epoch 毫秒，单调递增，供 daemon 丢弃乱序旧推送。
    """
    svc = DaemonService(session)
    try:
        runtime = await svc.update_allowed_roots(
            runtime_id,
            user.id,
            allowed_roots=data.allowed_roots,
            is_platform_admin=user.is_platform_admin,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    # 2026-07-03-daemon-entity-binding：allowed_roots 已上提到 daemon_instances
    # （design §4.1/§4.2）。update_allowed_roots 经 runtime.daemon_instance_id 写
    # daemon_instance.allowed_roots + bump instance.updated_at，但 runtime 行本身
    # 不变 → 这里读 daemon_instance 拿最新 roots 与 updated_at。
    from app.modules.daemon.model import DaemonInstance

    instance = (
        await session.get(DaemonInstance, runtime.daemon_instance_id)
        if runtime.daemon_instance_id is not None
        else None
    )

    # task-08：best-effort WS push（daemon 离线不阻断 PUT，心跳兜底 R-07）。
    # version 派生自 daemon_instance.updated_at（写入实际发生的行，epoch 毫秒，单调）。
    if instance is not None:
        version = _derive_policy_version(instance.updated_at)
        roots_to_push = list(runtime.allowed_roots or [])
        daemon_id = instance.id
    else:
        # runtime 无关联 daemon_instance（迁移过渡 / 测试 fixture）→ 仍推一个
        # 前向 version，避免 PUT 路径空推。daemon_id 退化为 runtime.id。
        version = _derive_policy_version(runtime.updated_at)
        roots_to_push = list(runtime.allowed_roots or [])
        daemon_id = runtime.id

    # Lazy import（与 list_dir / self_update 一致）：ws_hub 单例经
    # get_daemon_ws_hub 取，测试 per-test patch 不会被模块顶部 import 绑死。
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    try:
        hub = get_daemon_ws_hub()
        # ws_hub 按 daemon_id 路由（task-06 / design §5.3）；payload 内仍带 runtime_id
        # 标识 provider 会话，由 send_policy_update 注入。
        await hub.send_policy_update(
            daemon_id,
            roots_to_push,
            version,
            payload_runtime_id=runtime.id,
        )
    except Exception:
        log.warning(
            "allowed_roots_policy_push_failed",
            runtime_id=str(runtime.id),
            daemon_id=str(daemon_id),
            version=version,
            exc_info=True,
        )
    # 用 _runtime_read 填充 instance.allowed_roots（否则前端拿到 default [~/.sillyhub]）
    return _runtime_read(runtime, instance=instance)


@router.post(
    "/runtimes/{runtime_id}/self-update",
)
async def trigger_daemon_self_update(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> dict[str, str | bool]:
    """推送 daemon 自更新指令到指定 runtime（admin）。

    通过 WS 发送 `daemon:self_update`，daemon 收到后下载最新 bundle 替换并退出重启。
    返回 `{"sent": bool, "latest_version": str}`。
    """
    from app.modules.daemon.model import DaemonRuntime
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    latest = get_daemon_latest_version()
    hub = get_daemon_ws_hub()
    # task-06: ws_hub 按 daemon_instance_id 路由；runtime_id → daemon_id。
    # 迁移窗口 runtime.daemon_instance_id IS NULL → 回退 runtime_id（兼容旧数据）。
    runtime = await session.get(DaemonRuntime, runtime_id)
    daemon_id = (runtime.daemon_instance_id if runtime else None) or runtime_id
    sent = await hub.send_self_update(daemon_id, version=latest)
    if not sent:
        from app.modules.daemon.runtime.service import DaemonRuntimeOffline

        raise DaemonRuntimeOffline(
            "Runtime is offline or WS send failed.",
            details={"runtime_id": str(runtime_id)},
        )
    return {"sent": True, "latest_version": latest}


@router.get(
    "/runtimes/{runtime_id}",
    response_model=DaemonRuntimeRead,
)
async def get_runtime(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> DaemonRuntimeRead:
    """Get daemon runtime info by ID."""
    svc = DaemonService(session)
    runtime = await svc.get_runtime(runtime_id, user.id, is_platform_admin=user.is_platform_admin)
    if runtime is None:
        raise DaemonRuntimeNotFound(
            f"Daemon runtime '{runtime_id}' not found.",
            details={"runtime_id": str(runtime_id)},
        )
    return DaemonRuntimeRead.model_validate(runtime)


@router.post(
    "/runtimes/{runtime_id}/disable",
    response_model=DaemonRuntimeRead,
)
async def disable_runtime(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> DaemonRuntimeRead:
    """Disable a daemon runtime for placement without deleting it."""
    svc = DaemonService(session)
    runtime = await svc.disable_runtime(
        runtime_id, user.id, is_platform_admin=user.is_platform_admin
    )
    return DaemonRuntimeRead.model_validate(runtime)


@router.post(
    "/runtimes/{runtime_id}/enable",
    response_model=DaemonRuntimeRead,
)
async def enable_runtime(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> DaemonRuntimeRead:
    """Enable a daemon runtime, restoring online only when heartbeat is fresh."""
    svc = DaemonService(session)
    runtime = await svc.enable_runtime(
        runtime_id, user.id, is_platform_admin=user.is_platform_admin
    )
    return DaemonRuntimeRead.model_validate(runtime)


@router.delete(
    "/runtimes/{runtime_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_runtime(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> None:
    """Delete a daemon runtime and its bound leases/sessions (ql-20260621-012).

    Physical delete; DB ``ondelete=CASCADE`` clears ``daemon_task_leases`` and
    ``agent_sessions`` bound to this runtime. The daemon re-registers as a new
    runtime on next heartbeat.
    """
    svc = DaemonService(session)
    await svc.delete_runtime(runtime_id, user.id, is_platform_admin=user.is_platform_admin)


@router.post(
    "/runtimes/{runtime_id}/offline",
    response_model=DaemonRuntimeRead,
)
async def mark_runtime_offline(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> DaemonRuntimeRead:
    """Mark a daemon runtime offline during graceful daemon shutdown."""
    svc = DaemonService(session)
    runtime = await svc.mark_offline(runtime_id, user.id)
    return DaemonRuntimeRead.model_validate(runtime)


@router.get(
    "/instances",
    response_model=list[DaemonInstanceRead],
)
async def list_daemon_instances(
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> list[DaemonInstanceRead]:
    """List online daemon instances for the current user (task-10 / FR-09).

    Used by workspace-daemon-switcher to show available daemons.
    Returns each daemon instance with its enabled provider runtimes so the
    frontend can render provider badges without extra round-trips.
    """
    svc = DaemonService(session)
    await svc.cleanup_stale_runtimes()
    instances = await svc.list_instances(user.id)

    reads: list[DaemonInstanceRead] = []
    for inst in instances:
        # Fetch provider runtimes for this daemon instance
        from app.modules.daemon.runtime.service import RuntimeService

        rt_svc = RuntimeService(session)
        provider_rows = await rt_svc._get_runtimes_by_instance(inst.id)
        reads.append(
            DaemonInstanceRead(
                id=inst.id,
                hostname=inst.hostname,
                display_alias=inst.display_alias,
                status=inst.status or "online",
                providers=[
                    DaemonInstanceProviderItem(
                        provider=r.provider or "",
                        status=r.status or "unknown",
                        version=r.version,
                    )
                    for r in provider_rows
                ],
            )
        )
    return reads


@router.get(
    "/runtimes",
    response_model=list[DaemonRuntimeRead],
)
async def list_runtimes(
    session: SessionDep,
    user: RuntimeAdminUser,
) -> list[DaemonRuntimeRead]:
    """List all daemon runtimes for the current user."""
    svc = DaemonService(session)
    await svc.cleanup_stale_runtimes()
    runtimes = await svc.list_runtimes(user.id)
    return [DaemonRuntimeRead.model_validate(r) for r in runtimes]


# ── Task lease lifecycle ────────────────────────────────────────────────────


@router.post(
    "/leases/{lease_id}/claim",
    response_model=LeaseClaimResponse,
)
async def claim_lease(
    lease_id: uuid.UUID,
    data: LeaseClaimRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> LeaseClaimResponse:
    """Claim a pending task lease for execution."""
    svc = DaemonService(session)
    lease, payload = await svc.claim_lease(lease_id, data.runtime_id)
    meta = lease.metadata_ or {}
    return LeaseClaimResponse(
        lease_id=lease.id,
        claim_token=meta.get("claim_token", ""),
        payload=payload,
        lease_expires_at=lease.lease_expires_at,
    )


@router.post(
    "/leases/{lease_id}/start",
    response_model=LeaseStartResponse,
)
async def start_lease(
    lease_id: uuid.UUID,
    data: LeaseStartRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> LeaseStartResponse:
    """Mark a claimed lease as started (agent is now running)."""
    svc = DaemonService(session)
    lease = await svc.start_lease(lease_id, data.claim_token)
    return LeaseStartResponse(
        lease_id=lease.id,
        status=lease.status or "claimed",
    )


@router.post(
    "/leases/{lease_id}/heartbeat",
    response_model=LeaseHeartbeatResponse,
)
async def lease_heartbeat(
    lease_id: uuid.UUID,
    data: LeaseHeartbeatRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> LeaseHeartbeatResponse:
    """Send a heartbeat for an active lease to prevent expiry."""
    svc = DaemonService(session)
    lease = await svc.lease_heartbeat(lease_id, data.claim_token)
    return LeaseHeartbeatResponse(
        lease_id=lease.id,
        status=lease.status or "claimed",
    )


@router.post(
    "/leases/{lease_id}/messages",
    response_model=LeaseMessagesResponse,
)
async def submit_lease_messages(
    lease_id: uuid.UUID,
    data: LeaseMessagesRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> LeaseMessagesResponse:
    """Submit agent conversation messages for a running lease."""
    svc = DaemonService(session)
    submission = await svc.submit_messages(
        lease_id,
        data.claim_token,
        data.agent_run_id,
        data.messages,
    )
    # QueuePool 修复 3：Redis publish 在 service 返回（DB 已 commit、连接已归还）
    # 之后执行。Redis 卡死不再持有本请求的 DB 连接池 slot。
    if submission.publish_intent is not None:
        await publish_submitted_messages(submission.publish_intent)
    return LeaseMessagesResponse(accepted=True, count=int(submission))


@router.post(
    "/leases/{lease_id}/complete",
    response_model=LeaseCompleteResponse,
)
async def complete_lease(
    lease_id: uuid.UUID,
    data: LeaseCompleteRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> LeaseCompleteResponse:
    """Mark a lease as completed with execution results."""
    svc = DaemonService(session)
    lease = await svc.complete_lease(lease_id, data.claim_token, data.result)
    return LeaseCompleteResponse(
        lease_id=lease.id,
        status=lease.status or "completed",
    )


@router.post(
    "/leases/{lease_id}/sync",
    response_model=LeaseSyncResponse,
)
async def sync_lease_status(
    lease_id: uuid.UUID,
    data: LeaseSyncRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> LeaseSyncResponse:
    """Sync AgentRun status from daemon side."""
    svc = DaemonService(session)
    agent_run = await svc.sync_agent_run_status(
        lease_id,
        data.claim_token,
        data.status,
        error=data.error,
    )
    return LeaseSyncResponse(
        agent_run_id=agent_run.id if agent_run else None,
        status=agent_run.status if agent_run else data.status,
    )


# ── Interactive run terminal close (gap-3, design §4) ────────────────────────
# Daemon uplink: SDK result → close AgentRun. Auth via X-Claim-Token header
# (lease-scoped, 32-byte random) instead of the body claim_token used by sync.
# Distinct from sync_agent_run_status: this is for interactive sessions where
# lease.agent_run_id is NULL (D-005@v1) and the run id comes from the path.


class InteractiveRunResultRequest(BaseModel):
    """Body for POST /leases/{lease_id}/runs/{run_id}/result (gap-3).

    Field names mirror the SDK result message shape (snake_case) so the daemon
    can forward verbatim without renaming.
    """

    # SDK result.subtype / top-level status: 'success' | 'error_during_execution' | others
    status: str = Field(min_length=1, max_length=64)
    is_error: bool = False
    # SDK result.subtype (e.g. 'success', 'error_during_execution', 'error_max_turns')
    subtype: str | None = Field(default=None, max_length=64)
    # Optional human-readable summary; stored redacted on AgentRun.output_redacted
    result_summary: str | None = Field(default=None, max_length=20000)
    # ── SDKResultSuccess usage / cost / duration 透传（全部可选，daemon 可能不传，
    # 对应 AgentRun.{total_cost_usd,num_turns,duration_ms,duration_api_ms,
    # input_tokens,output_tokens}，原先 interactive 路径全 NULL）。
    total_cost_usd: float | None = None
    num_turns: int | None = None
    duration_ms: int | None = None
    duration_api_ms: int | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None


class InteractiveRunResultResponse(BaseModel):
    agent_run_id: uuid.UUID
    status: str


@router.post(
    "/leases/{lease_id}/runs/{run_id}/result",
    response_model=InteractiveRunResultResponse,
)
async def close_interactive_run(
    lease_id: uuid.UUID,
    run_id: uuid.UUID,
    data: InteractiveRunResultRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
    # gap-3 / design §4: lease-scoped claim token in header (distinct from the
    # body claim_token of sync/heartbeat). Fastapi Header() is case-insensitive.
    x_claim_token: Annotated[str, Header(alias="X-Claim-Token", min_length=1)],
) -> InteractiveRunResultResponse:
    """Close an interactive AgentRun from a daemon SDK result (gap-3 / design §4).

    Daemon ``SessionManager._onResult`` → ``hubClient.notifyRunResult`` → here.
    The lease is verified via the ``X-Claim-Token`` header (lease-scoped), and
    the run is bound to the lease's session to prevent cross-session injection.
    Idempotent on already-terminal runs.

    Auth: ``get_current_principal`` accepts the daemon's ``X-API-Key`` (long-lived
    credential issued at register time); ``X-Claim-Token`` authorizes the specific
    lease. A browser JWT would also pass ``get_current_principal`` but normal
    callers are daemon-side only.
    """
    svc = DaemonService(session)
    agent_run = await svc.close_interactive_run(
        lease_id,
        run_id,
        x_claim_token,
        status=data.status,
        is_error=data.is_error,
        subtype=data.subtype,
        result_summary=data.result_summary,
        total_cost_usd=data.total_cost_usd,
        num_turns=data.num_turns,
        duration_ms=data.duration_ms,
        duration_api_ms=data.duration_api_ms,
        input_tokens=data.input_tokens,
        output_tokens=data.output_tokens,
    )
    return InteractiveRunResultResponse(
        agent_run_id=agent_run.id,
        status=agent_run.status or "failed",
    )


# ── Daemon-restart session recovery (gap-8.1 / design §11) ─────────────────
# Daemon calls these on boot, BEFORE its three loops (heartbeat/poll/ws), to
# reconcile persisted interactive sessions after a restart. Auth:
# ``get_current_principal`` (daemon X-API-Key). Thin wrappers over
# recover_session_after_daemon_restart / confirm_session_reconnected /
# mark_session_recovery_failed (service.py:2071 / 2318 / 2375).


class SessionRecoverRequest(BaseModel):
    """Body for POST /sessions/{session_id}/recover (gap-8.1).

    Fields mirror the persisted record reloaded from JsonSessionPersistence;
    backend validates ownership via runtime_id / lease_id / provider /
    lease.kind (never trusts agent_session_id beyond audit).
    """

    runtime_id: uuid.UUID
    lease_id: uuid.UUID
    provider: str = Field(min_length=1, max_length=64)
    # SDK session_id — audit/log only; backend never trusts it for ownership.
    agent_session_id: str = Field(default="", max_length=128)
    interrupted_run_id: uuid.UUID | None = None


class SessionRuntimeRequest(BaseModel):
    """Body for confirm-reconnected / mark-recovery-failed (gap-8.1)."""

    runtime_id: uuid.UUID
    reason: str | None = Field(default=None, max_length=128)


class SessionRecoveryResponse(BaseModel):
    session_id: uuid.UUID
    lease_id: uuid.UUID | None = None
    status: str
    interrupted_run_status: str | None = None


@router.post(
    "/sessions/{session_id}/recover",
    response_model=SessionRecoveryResponse,
)
async def recover_session(
    session_id: uuid.UUID,
    data: SessionRecoverRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> SessionRecoveryResponse:
    """Reconcile an interactive session after daemon restart (gap-8.1).

    Daemon ``_recoverSessionsOnBoot`` → ``hubClient.recoverSession`` → here,
    BEFORE ``restoreAndReconnect`` (query resume). Ownership-guarded, idempotent
    on terminal sessions, rotates the lease ``claim_token``. Returns
    ``reconnecting`` when recoverable (daemon proceeds to resume) or
    terminal/rejected otherwise.
    """
    svc = DaemonService(session)
    result = await svc.recover_session_after_daemon_restart(
        session_id,
        runtime_id=data.runtime_id,
        lease_id=data.lease_id,
        provider=data.provider,
        agent_session_id=data.agent_session_id,
        interrupted_run_id=data.interrupted_run_id,
    )
    return SessionRecoveryResponse(
        session_id=result.session_id,
        lease_id=result.lease_id,
        status=result.status,
        interrupted_run_status=result.interrupted_run_status,
    )


@router.post(
    "/sessions/{session_id}/confirm-reconnected",
    response_model=SessionRecoveryResponse,
)
async def confirm_session_reconnected(
    session_id: uuid.UUID,
    data: SessionRuntimeRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> SessionRecoveryResponse:
    """Flip reconnecting → active after daemon resume succeeds (gap-8.1).

    Two-phase recover step 2: daemon ran recover_session (wrote reconnecting) →
    restoreAndReconnect (driver.start resume) → on success calls this.
    """
    svc = DaemonService(session)
    result_status = await svc.confirm_session_reconnected(
        session_id,
        runtime_id=data.runtime_id,
    )
    return SessionRecoveryResponse(session_id=session_id, status=result_status)


@router.post(
    "/sessions/{session_id}/mark-recovery-failed",
    response_model=SessionRecoveryResponse,
)
async def mark_session_recovery_failed(
    session_id: uuid.UUID,
    data: SessionRuntimeRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> SessionRecoveryResponse:
    """Flip reconnecting → failed after daemon resume failed (gap-8.1).

    Daemon calls this when driver.start({resume}) throws (cwd mismatch /
    executable missing / SDK jsonl missing) — session cannot be restored.
    """
    svc = DaemonService(session)
    result_status = await svc.mark_session_recovery_failed(
        session_id,
        runtime_id=data.runtime_id,
        reason=data.reason or "restore_failed",
    )
    return SessionRecoveryResponse(session_id=session_id, status=result_status)


@router.get(
    "/leases/{lease_id}",
    response_model=DaemonTaskLeaseRead,
)
async def get_lease(
    lease_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> DaemonTaskLeaseRead:
    """Get lease info by ID."""
    svc = DaemonService(session)
    lease = await svc.get_lease(lease_id)
    if lease is None:
        raise DaemonLeaseNotFound(
            f"Daemon task lease '{lease_id}' not found.",
            details={"lease_id": str(lease_id)},
        )
    return DaemonTaskLeaseRead.model_validate(lease)


@router.get(
    "/runtimes/{runtime_id}/leases",
    response_model=list[DaemonTaskLeaseRead],
)
async def list_runtime_leases(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: RuntimeAdminUser,
) -> list[DaemonTaskLeaseRead]:
    """List all leases for a given daemon runtime."""
    svc = DaemonService(session)
    # Verify runtime exists
    runtime = await svc.get_runtime(runtime_id)
    if runtime is None:
        raise DaemonRuntimeNotFound(
            f"Daemon runtime '{runtime_id}' not found.",
            details={"runtime_id": str(runtime_id)},
        )
    leases = await svc.list_leases(runtime_id)
    return [DaemonTaskLeaseRead.model_validate(lease) for lease in leases]


@router.post(
    "/runtimes/{runtime_id}/list-dir",
    response_model=ListDirResponse,
)
async def list_dir(
    runtime_id: uuid.UUID,
    data: ListDirRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> ListDirResponse:
    """Forward a list_dir request to the bound daemon over WS RPC.

    The daemon performs the actual readdir+stat and allowed_roots validation
    (task-05); backend only owns ownership checks + RPC/HTTP status mapping.
    """
    svc = DaemonService(session)
    # Ownership check: runtime not owned by current user → 404.
    runtime = await svc._get_owned_runtime(runtime_id, user.id)

    # Lazy import (matches placement.py / agent.service.py): the ws_hub
    # singleton accessor is patched per-test via ws_hub.get_daemon_ws_hub, and a
    # module-top `from ... import` would bind a stale/mock ref if this module
    # were first imported while such a patch was active.
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    hub = get_daemon_ws_hub()
    # task-06: ws_hub 按 daemon_instance_id 路由；runtime_id → daemon_id。
    # 迁移窗口 runtime.daemon_instance_id IS NULL → 回退 runtime_id（兼容旧数据）。
    daemon_id = runtime.daemon_instance_id or runtime_id
    try:
        result = await hub.send_rpc(daemon_id, "list_dir", {"path": data.path})
    except DaemonRuntimeOffline as exc:
        raise DaemonRpcGatewayError(
            f"daemon runtime '{runtime_id}' offline.",
            details={
                "runtime_id": str(runtime_id),
                "path": data.path,
                "reason": "offline_or_send_failed",
            },
        ) from exc
    except DaemonRpcTimeout as exc:
        raise DaemonRpcGatewayError(
            "daemon list_dir rpc timed out.",
            details={
                "runtime_id": str(runtime_id),
                "path": data.path,
                "rpc_id": exc.details.get("rpc_id") if exc.details else None,
                "timeout_seconds": exc.details.get("timeout_seconds") if exc.details else None,
            },
        ) from exc
    except DaemonRpcRemoteError as exc:
        # daemon business error — map forbidden → 403 (FR-04), others → 502.
        if exc.code == "forbidden":
            raise DaemonRpcForbiddenError(
                "daemon refused list_dir: path outside allowed_roots.",
                details={
                    "runtime_id": str(runtime_id),
                    "path": data.path,
                    "daemon_code": exc.code,
                    "daemon_message": exc.message,
                },
            ) from exc
        raise DaemonRpcRemoteGatewayError(
            f"daemon list_dir failed: {exc.code}.",
            details={
                "runtime_id": str(runtime_id),
                "path": data.path,
                "daemon_code": exc.code,
                "daemon_message": exc.message,
            },
        ) from exc

    entries = result.get("entries", []) if isinstance(result, dict) else []
    return ListDirResponse(entries=entries)


# ── Interactive session endpoints (task-05, FR-01/02/04/05) ─────────────────
# DTOs live inline (per task-05 allowed_paths: schema.py is the batch DTO home
# and must not be modified). router only does DTO mapping; all business logic
# + SQL lives in DaemonService.*_session.

# Interactive session callers need task:run_agent (same gate as quick-chat /
# dispatch). Aliased separately so the intent is self-documenting.
TaskRunAgentUser = Annotated[User, Depends(require_permission_any(Permission.TASK_RUN_AGENT))]


def get_permission_service(
    session: SessionDep,
) -> DaemonPermissionService:
    """Construct DaemonPermissionService bound to the request's DB session + ws_hub.

    task-08: DaemonPermissionService wraps DaemonService (which owns the DB
    session + publish/lock helpers) and the process-wide DaemonWsHub singleton.
    The dependency is created per-request so the DB session lifecycle stays
    consistent with other endpoints.
    """
    svc = DaemonService(session)
    # Lazy import (matches placement.py / agent.service.py): the ws_hub
    # singleton accessor is patched per-test via ws_hub.get_daemon_ws_hub, and a
    # module-top `from ... import` would bind a stale/mock ref if this module
    # were first imported while such a patch was active.
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    hub = get_daemon_ws_hub()
    return DaemonPermissionService(svc, hub)


PermissionServiceDep = Annotated[DaemonPermissionService, Depends(get_permission_service)]


class SessionCreateRequest(BaseModel):
    provider: Literal["claude", "codex"]
    prompt: str = Field(min_length=1, max_length=8000)
    model: str | None = Field(default=None, max_length=128)
    manual_approval: bool = False
    ask_user_only: bool = False


class SessionCreateResponse(BaseModel):
    session_id: uuid.UUID
    run_id: uuid.UUID
    lease_id: uuid.UUID
    status: str
    stream_url: str


class SessionInjectRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=8000)


class SessionInjectResponse(BaseModel):
    session_id: uuid.UUID
    run_id: uuid.UUID
    status: str


class SessionControlResponse(BaseModel):
    session_id: uuid.UUID
    status: str
    current_run_id: uuid.UUID | None = None


class SessionEndRequest(BaseModel):
    """gap-4 (design §5): daemon uplink body for POST /sessions/{id}/end.

    Optional body carried by the daemon ``notifySessionEnd`` call. ``status``
    is informational (the backend reconciles to ``ended`` regardless — failed
    sessions are still driven through end_session by the daemon after fail()).
    ``reason`` is recorded into the ``session_ended`` SSE event for UI context.
    """

    status: Literal["ended", "failed"] | None = None
    reason: str | None = Field(default=None, max_length=2000)


# ── Interactive session permission approval (task-08, FR-07 / D-007@v1) ──────
# DTOs inline (per task-08 allowed_paths: schema.py is the batch DTO home).
# The service is wired via get_permission_service so the request-scoped DB
# session and the process-wide ws_hub singleton are shared with the rest of
# the daemon module.


class PermissionResponseRequest(BaseModel):
    decision: Literal["allow", "deny"]
    message: str | None = Field(default=None, max_length=2000)
    # AskUserQuestion dialog answer. Present iff the originating request was a
    # dialog (the service also detects this via the persisted DB row, so the
    # field is optional and ignored for plain canUseTool approvals).
    dialog_result: dict | None = None


@router.post(
    "/sessions/{session_id}/permissions/{request_id}/response",
    response_model=PermissionResponseRead,
)
async def respond_session_permission(
    session_id: uuid.UUID,
    request_id: str,
    body: PermissionResponseRequest,
    user: TaskRunAgentUser,
    service: PermissionServiceDep,
) -> PermissionResponseRead:
    """User allow/deny for a session permission_request (FR-07 / D-007@v1).

    Handles both plain canUseTool approvals and AskUserQuestion dialogs:
      - plain approval: cancels the 5min timeout timer, publishes
        permission_resolved SSE. 404 when the request has already timed out /
        never existed; 504 when the daemon runtime is offline; 409 when
        manual_approval is disabled.
      - dialog: flips the persisted session_dialog_requests row to answered,
        forwards ``dialog_result`` to the daemon. 404 when the row is
        missing/cancelled; 409 when already answered; 504 when offline.
    """
    return await service.respond_permission(
        user_id=user.id,
        session_id=session_id,
        request_id=request_id,
        decision=body.decision,
        message=body.message,
        dialog_result=body.dialog_result,
    )


# ── Pending dialog recovery (dialog extension) ──────────────────────────────
# Page-refresh recovery: returns the session's still-pending AskUserQuestion
# dialogs so the frontend can re-render the cards after a reconnect. Ownership
# is enforced inside the service (404 on cross-user, no existence leak).


@router.get(
    "/sessions/{session_id}/dialogs",
    response_model=list[SessionDialogRead],
)
async def list_pending_dialogs(
    session_id: uuid.UUID,
    user: TaskRunAgentUser,
    service: PermissionServiceDep,
) -> list[SessionDialogRead]:
    """Return the session's pending AskUserQuestion dialogs (dialog extension).

    Used by the frontend after a page refresh to recover dialogs the user has
    not yet answered. Returns only ``status=pending`` rows, oldest first.
    Cross-user sessions surface as 404 (ownership enforced in the service).
    """
    return await service.list_pending_dialogs(user.id, session_id)


# ── Session list + history (task-12, FR-10 / D-005@v1) ───────────────────────
# IMPORTANT: ``GET /sessions`` (fixed path) is registered BEFORE the
# parameterized ``/sessions/{session_id}/...`` routes so FastAPI does not match
# the literal "sessions" against a path param. History logs reuse the existing
# AgentRunLogEntry DTO from agent.schema (no field-drift copy).

_SessionStatusQuery = Literal["pending", "active", "reconnecting", "ended", "failed"]


@router.get(
    "/sessions",
    response_model=AgentSessionListResponse,
)
async def list_sessions(
    session: SessionDep,
    user: TaskRunAgentUser,
    limit: int = Query(default=20, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    status: _SessionStatusQuery | None = Query(default=None),
) -> AgentSessionListResponse:
    """List the current user's AgentSessions (owner-scoped, stable paging)."""
    svc = DaemonService(session)
    items, total = await svc.list_agent_sessions(
        user.id,
        limit=limit,
        offset=offset,
        status_filter=status,
    )
    return AgentSessionListResponse(
        items=[AgentSessionRead.model_validate(item) for item in items],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/sessions/{session_id}",
    response_model=AgentSessionRead,
)
async def get_session_detail(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> AgentSessionRead:
    """Return a single owned AgentSession (task-06 / FR-2 / D-002@v1).

    Read-only single-read counterpart to ``GET /sessions``. Ownership is
    enforced inside the service so a missing OR cross-user session both
    surface as 404 without leaking existence.
    """
    svc = DaemonService(session)
    agent_session = await svc.get_agent_session(session_id, user.id)
    return AgentSessionRead.model_validate(agent_session)


@router.post(
    "/sessions",
    response_model=SessionCreateResponse,
    status_code=status.HTTP_201_CREATED,
)
async def create_session(
    data: SessionCreateRequest,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> SessionCreateResponse:
    """Create a new interactive session and dispatch its first turn (FR-01)."""
    svc = DaemonService(session)
    result = await svc.create_session(
        user.id,
        provider=data.provider,
        prompt=data.prompt,
        model=data.model,
        manual_approval=data.manual_approval,
        ask_user_only=data.ask_user_only,
    )
    s = result.agent_session
    return SessionCreateResponse(
        session_id=s.id,
        run_id=result.agent_run.id,
        lease_id=result.lease_id,
        status=s.status or "active",
        stream_url=f"/api/daemon/sessions/{s.id}/stream",
    )


@router.post(
    "/sessions/{session_id}/inject",
    response_model=SessionInjectResponse,
    status_code=status.HTTP_201_CREATED,
)
async def inject_session(
    session_id: uuid.UUID,
    data: SessionInjectRequest,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> SessionInjectResponse:
    """Append a new turn run to an active interactive session (FR-02)."""
    svc = DaemonService(session)
    result = await svc.inject_session(session_id, user.id, prompt=data.prompt)
    return SessionInjectResponse(
        session_id=result.agent_session.id,
        run_id=result.agent_run.id,
        status=result.agent_run.status or "pending",
    )


@router.post(
    "/sessions/{session_id}/reopen",
    response_model=SessionReopenResponse,
)
async def reopen_session(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> SessionReopenResponse:
    """Reopen an ended Claude session for SDK resume (task-05 / FR-2).

    Validation + optimistic placeholder only — sets ``status=reconnecting``
    and returns immediately; the full lease/WS transition is task-07 and the
    daemon SDK resume is task-08. Never blocks on daemon confirmation
    (design §4.3.1 step 7).
    """
    svc = DaemonService(session)
    return await svc.reopen_session(session_id, user.id)


@router.post(
    "/sessions/{session_id}/interrupt",
    response_model=SessionControlResponse,
)
async def interrupt_session(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> SessionControlResponse:
    """Send a turn-level interrupt for the current run (FR-04)."""
    svc = DaemonService(session)
    result = await svc.interrupt_session(session_id, user.id)
    return SessionControlResponse(
        session_id=result.agent_session.id,
        status=result.agent_session.status or "active",
        current_run_id=result.current_run_id,
    )


@router.post(
    "/sessions/{session_id}/end",
    response_model=SessionControlResponse,
)
async def end_session(
    session_id: uuid.UUID,
    request: Request,
    session: SessionDep,
    user: TaskRunAgentUser,
    reason: str = Query(default="manual"),
    # gap-4 (design §5): daemon uplink body. Optional so the front-end
    # (query-only) and the daemon (body) can share this endpoint. When the
    # body carries a reason it takes precedence over the query param.
    end_body: SessionEndRequest | None = None,
) -> SessionControlResponse:
    """End an interactive session: single reconciliation of session/lease/run (FR-05).

    gap-4 (design §5): daemon uplink. The daemon ``SessionManager.end/fail`` →
    ``hubClient.notifySessionEnd`` → this endpoint with ``{status, reason}`` in
    the body and ``X-API-Key`` auth (resolved by ``get_current_principal`` to the
    runtime owner). The front-end still calls with ``?reason=manual`` (no body);
    both paths converge on ``service.end_session``. Body reason wins when present.

    ql-20260623-004: 区分调用方定 session 归属——daemon（无 Bearer，仅
    ``X-API-Key``）传 ``actor_runtime_owner_id``，service 走 runtime 归属校验
    （api-key owner = runtime owner，不查 ``AgentSession.user_id``，否则 admin
    共享 runtime 场景 creator≠owner 必 404）；前端（Bearer JWT）保持 user_id 校验。
    """
    effective_reason = end_body.reason if (end_body and end_body.reason) else reason
    # 无 Authorization: Bearer 即 daemon 身份（X-API-Key）：api-key owner 是
    # runtime owner，走 runtime 归属校验；否则前端 Bearer JWT 走 user_id 校验。
    has_bearer = (request.headers.get("authorization") or "").lower().startswith("bearer ")
    svc = DaemonService(session)
    result = await svc.end_session(
        session_id,
        user.id,
        reason=effective_reason,
        actor_runtime_owner_id=None if has_bearer else user.id,
    )
    return SessionControlResponse(
        session_id=result.agent_session.id,
        status=result.agent_session.status or "ended",
        current_run_id=result.current_run_id,
    )


@router.delete(
    "/sessions/{session_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
async def delete_session(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> None:
    """Delete an owned terminal session without deleting its run history."""
    await DaemonService(session).delete_agent_session(session_id, user.id)


@router.get("/sessions/{session_id}/stream")
async def stream_session_logs(
    session_id: uuid.UUID,
    user: TaskRunAgentUser,
) -> StreamingResponse:
    """Stream session-level SSE aggregating every AgentRun of the session.

    Single connection survives across multiple turns (run_id changes); events
    carry ``run_id`` so the frontend can delineate turn boundaries (FR-03 /
    D-005@v1 / R-08). Closes only on ``session_ended``.

    Ownership is verified here (``AgentSession.user_id == user.id``) so neither
    a missing nor a cross-user session reaches the Redis subscription (no
    existence leak). A terminal-status session still enters the generator,
    which emits ``event: done`` internally.

    连接池安全：不注入请求级 session（会贯穿整个 StreamingResponse 生命周期、
    长时间占用一个连接池 slot）。归属校验改用短 session——校验后立即归还；
    StreamingResponse 生成器内部用 get_session_factory() 自建独立短 session
    做逐次查询（见 AgentService.stream_session_logs）。
    """
    # Local imports keep top-level load cost minimal and avoid an import cycle
    # (agent.service imports nothing from daemon, but be defensive).
    from app.modules.agent.model import AgentSession
    from app.modules.agent.service import AgentService

    # 归属校验：短 session，校验完即归还连接池 slot（不贯穿 SSE 生命周期）
    gen = None
    async with get_session_factory()() as session:
        owned = (
            await session.execute(
                select(AgentSession).where(
                    AgentSession.id == session_id,
                    AgentSession.user_id == user.id,
                )
            )
        ).scalar_one_or_none()
        if owned is not None:
            # 构造生成器对象（惰性求值，此处不执行其 body）；session 随
            # async with 结束立即归还，stream_session_logs 内部自建短 session。
            gen = AgentService(session).stream_session_logs(session_id)
    if owned is None:
        raise DaemonSessionNotFound(
            f"AgentSession '{session_id}' not found.",
            details={"session_id": str(session_id)},
        )

    return StreamingResponse(
        gen,
        media_type="text/event-stream",
        headers=_SESSION_SSE_HEADERS,
    )


@router.get(
    "/sessions/{session_id}/logs",
    response_model=list,  # response items are AgentRunLogEntry
)
async def get_session_logs(
    session_id: uuid.UUID,
    session: SessionDep,
    user: TaskRunAgentUser,
) -> list[AgentRunLogEntry]:
    """Return all logs of a session, aggregated across AgentRuns (D-005@v1).

    Read-only. Ownership / existence follow the same resource-hiding 404 as
    the other session endpoints (no existence leak for missing / cross-user).
    Response items reuse the existing ``AgentRunLogEntry`` DTO; ``run_id`` is
    preserved so the frontend can delineate turn boundaries.
    """
    svc = DaemonService(session)
    logs = await svc.get_agent_session_logs(session_id, user.id)
    return [AgentRunLogEntry.model_validate(log) for log in logs]


# ── WebSocket endpoint ───────────────────────────────────────────────────────


@router.websocket("/ws")
async def daemon_websocket(
    websocket: WebSocket,
    daemon_local_id: str = Query(
        ...,
        description="Daemon-local UUID (daemon_instances.id). Replaces the legacy runtime_id handshake (task-06 / D-006 / design §5.3).",
    ),
) -> None:
    """WebSocket endpoint for daemon entity real-time communication (task-06).

    Each daemon process connects **once** with its ``daemon_local_id`` (the
    locally-persisted uuid surfaced as ``daemon_instances.id``). The backend
    looks up that id, registers the connection keyed by ``daemon_id``, and
    routes all server→daemon messages over this single socket. Provider-level
    dispatch (which runtime/session a message targets) is carried inside each
    payload's ``runtime_id`` field (design §5.3).

    Breaking change (D-007): the legacy ``?runtime_id=...`` handshake is no
    longer accepted — old daemons are rejected with code=4001 and a hint to
    upgrade.

    Authentication is expected to be handled at the HTTP upgrade phase via
    the ``Authorization: Bearer <token>`` header or a ``token`` query param.
    """
    # Validate daemon_local_id format before accepting.
    try:
        daemon_id = uuid.UUID(daemon_local_id)
    except (ValueError, AttributeError):
        log.warning("ws_invalid_daemon_local_id", daemon_local_id=daemon_local_id)
        await websocket.close(code=4001, reason="invalid daemon_local_id")
        return

    # Look up the daemon entity (must be registered first via POST /register).
    # Lazy import keeps the model import off the hot path and matches the
    # ws_hub singleton accessor pattern below.
    from app.core.db import get_session_factory
    from app.modules.daemon.model import DaemonInstance

    try:
        session_factory = get_session_factory()
        async with session_factory() as ws_session:
            instance = await ws_session.get(DaemonInstance, daemon_id)
    except Exception:
        log.exception(
            "ws_handshake_instance_lookup_failed",
            daemon_id=str(daemon_id),
        )
        await websocket.close(code=1011, reason="internal error")
        return

    if instance is None:
        # Unknown daemon_local_id → reject (not registered). Old daemons that
        # still send a runtime_id here arrive as a parse-failure above; a
        # daemon_local_id that parses but has no row means the daemon skipped
        # registration — both are handshake failures (D-007 breaking).
        log.warning(
            "ws_handshake_unknown_daemon",
            daemon_id=str(daemon_id),
            hint="daemon must POST /register before opening the WS",
        )
        await websocket.close(
            code=4001, reason="unknown daemon_local_id; upgrade daemon and register first"
        )
        return

    await websocket.accept()

    # Lazy import (matches placement.py / agent.service.py): the ws_hub
    # singleton accessor is patched per-test via ws_hub.get_daemon_ws_hub, and a
    # module-top `from ... import` would bind a stale/mock ref if this module
    # were first imported while such a patch was active.
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    hub = get_daemon_ws_hub()
    await hub.connect(daemon_id, websocket)

    try:
        while True:
            try:
                data = await websocket.receive_json()
            except ValueError:
                log.warning(
                    "ws_invalid_json",
                    daemon_id=str(daemon_id),
                )
                continue

            msg_type = data.get("type")

            if msg_type == DAEMON_MSG_HEARTBEAT:
                # design §10 risk control: the daemon may include a provider
                # runtime_id in the payload; validate it belongs to this daemon
                # entity and drop on mismatch (best-effort, never close WS).
                raw_payload = data.get("payload") or {}
                await _validate_payload_runtime_belongs(
                    daemon_id,
                    raw_payload,
                    "heartbeat",
                )
                log.debug("ws_heartbeat_received", daemon_id=str(daemon_id))
                await hub.send_heartbeat_ack(
                    daemon_id,
                    payload_runtime_id=await _payload_runtime_id(raw_payload, daemon_id),
                )
            elif msg_type == DAEMON_MSG_RPC_RESULT:
                # daemon → server RPC reply. Route to the pending future via the
                # hub correlation map; struct validation + error mapping lives in
                # the send_rpc call chain (list-dir endpoint), not here.
                payload = data.get("payload") or {}
                rpc_id = payload.get("rpc_id")
                if not rpc_id:
                    log.warning(
                        "ws_rpc_result_missing_id",
                        daemon_id=str(daemon_id),
                        msg=data,
                    )
                    continue
                await hub.resolve_rpc(rpc_id, payload)
            elif msg_type == DAEMON_MSG_PERMISSION_REQUEST:
                # task-08 / FR-07 / D-007@v1: daemon canUseTool uplink.
                # Validate the payload shape; on any validation error warn and
                # drop (never close the WS — task-03 NFR-05). The permission
                # service runs its own session/runtime/run/manual_approval
                # validation and either publishes SSE + arms the 5min timer or
                # logs a warning and returns.
                raw_payload = data.get("payload") or {}
                try:
                    payload = PermissionRequestPayload(**raw_payload)
                except Exception:
                    log.warning(
                        "ws_permission_request_invalid_payload",
                        daemon_id=str(daemon_id),
                        payload=raw_payload,
                    )
                    continue
                # design §10: the session referenced by the request must be
                # owned by the daemon that opened this connection. The
                # permission service repeats this check internally; we pass the
                # connection's daemon_id so the service can map session → daemon.
                # Open a short-lived DB session for the request (WS loop has no
                # request-scoped dependency). Best-effort; failures only warn.
                try:
                    session_factory = get_session_factory()
                    async with session_factory() as ws_session:
                        svc = DaemonService(ws_session)
                        perm = DaemonPermissionService(svc, hub)
                        await perm.handle_permission_request(daemon_id, payload)
                except Exception:
                    log.exception(
                        "ws_permission_request_handler_failed",
                        daemon_id=str(daemon_id),
                        request_id=payload.request_id,
                    )
            else:
                log.warning(
                    "ws_unknown_message_type",
                    daemon_id=str(daemon_id),
                    msg_type=msg_type,
                )
    except WebSocketDisconnect as exc:
        # 记 close code/reason：区分 1000(主动关) / 1006(网络层断) / 1011 / 4000(replaced) 等，
        # 否则 daemon 端 WS 断开（尤其 import get_spec_bundle 期间）只能看到 "disconnected"，无法定位根因。
        log.info(
            "ws_client_disconnected",
            daemon_id=str(daemon_id),
            code=getattr(exc, "code", None),
            reason=getattr(exc, "reason", None) or "",
        )
    except Exception:
        log.exception("ws_unexpected_error", daemon_id=str(daemon_id))
    finally:
        await hub.disconnect(daemon_id)


async def _payload_runtime_id(
    raw_payload: dict,
    daemon_id: uuid.UUID,
) -> uuid.UUID:
    """Extract ``payload.runtime_id`` if present and well-formed, else daemon_id.

    Used to echo the provider runtime_id back in heartbeat_ack so the daemon
    can correlate the ack to a provider session (design §5.3).
    """
    raw = raw_payload.get("runtime_id")
    if not raw:
        return daemon_id
    try:
        return uuid.UUID(str(raw))
    except (ValueError, AttributeError):
        return daemon_id


async def _validate_payload_runtime_belongs(
    daemon_id: uuid.UUID,
    raw_payload: dict,
    label: str,
) -> None:
    """design §10 risk control: payload.runtime_id must belong to daemon_id.

    Validates that a ``runtime_id`` carried inside an inbound WS payload
    resolves to a ``daemon_runtimes`` row whose ``daemon_instance_id`` equals
    the connection's ``daemon_id``. On mismatch (dirty data / cross-daemon
    leak) the message is *not* rejected here — callers drop the message and
    this helper only emits a warning. Best-effort: DB lookup failures are
    logged and treated as valid (fail-open) so a transient DB hiccup cannot
    stall the WS receive loop.
    """
    raw_rid = raw_payload.get("runtime_id")
    if not raw_rid:
        return  # payload carries no runtime_id — nothing to validate.
    try:
        runtime_id = uuid.UUID(str(raw_rid))
    except (ValueError, AttributeError):
        log.warning(
            "ws_payload_invalid_runtime_id",
            label=label,
            daemon_id=str(daemon_id),
            runtime_id=raw_rid,
        )
        return

    try:
        from app.modules.daemon.model import DaemonRuntime

        session_factory = get_session_factory()
        async with session_factory() as ws_session:
            runtime = await ws_session.get(DaemonRuntime, runtime_id)
    except Exception:
        # Fail-open on DB errors — never stall the WS loop.
        log.exception(
            "ws_payload_runtime_validation_db_error",
            label=label,
            daemon_id=str(daemon_id),
            runtime_id=str(runtime_id),
        )
        return

    if runtime is None or runtime.daemon_instance_id != daemon_id:
        log.warning(
            "ws_payload_runtime_id_mismatch",
            label=label,
            daemon_id=str(daemon_id),
            payload_runtime_id=str(runtime_id),
            bound_daemon_id=str(runtime.daemon_instance_id) if runtime else None,
            hint="dropping message; payload.runtime_id not owned by this connection",
        )


@router.get(
    "/runtimes/{runtime_id}/pending-leases",
    response_model=list[dict],
)
async def get_pending_leases(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> list[dict]:
    """Return all pending leases for a runtime (polled by daemon)."""
    from sqlalchemy import text as sa_text

    result = await session.execute(
        sa_text(
            """
            SELECT l.id, l.agent_run_id, l.metadata, r.provider
            FROM daemon_task_leases l
            JOIN daemon_runtimes r ON l.runtime_id = r.id
            WHERE l.runtime_id = :rid AND l.status = 'pending'
            ORDER BY l.created_at
            """
        ),
        {"rid": runtime_id},
    )
    rows = result.mappings().all()
    out = []
    for row in rows:
        meta = row["metadata"] or {}
        out.append(
            {
                "lease_id": str(row["id"]),
                "agent_run_id": str(row["agent_run_id"]) if row["agent_run_id"] else None,
                "prompt": meta.get("prompt", ""),
                "provider": meta.get("provider") or row["provider"],
                "model": meta.get("model"),
                # daemon 侧自维护 provider→path 映射（daemon.ts _agentPaths），
                # capabilities 已上提到 daemon_instances 且不再含 cmd_path/protocol。
                "cmd_path": "",
                "protocol": "",
            }
        )
    return out
