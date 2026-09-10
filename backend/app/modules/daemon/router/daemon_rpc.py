"""daemon 运行时面 RPC 端点（task-07 拆分，原 notify_misc 运行时域）。

runtime 级 daemon 交互面：fs 浏览（list-dir / list-roots，WS RPC 转发）、
pending-leases 补拉、控制指令补拉与 ACK（controls ×2）、skills 分发
（manifest / bundle / content）、MCP 平台配置拉取。鉴权统一
``get_current_principal``（daemon X-API-Key / Bearer）+ runtime/instance 归属
校验（不匹配/不存在同语义 404，owner-only）。
"""

from __future__ import annotations

import asyncio
import io
import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_principal
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease
from app.modules.daemon.router import SessionDep, router
from app.modules.daemon.schema import (
    ListDirRequest,
    ListDirResponse,
    ListRootsResponse,
)
from app.modules.daemon.service import (
    DaemonRpcForbiddenError,
    DaemonRpcGatewayError,
    DaemonRpcRemoteError,
    DaemonRpcRemoteGatewayError,
    DaemonRpcTimeout,
    DaemonRuntimeNotFound,
    DaemonRuntimeOffline,
    DaemonService,
)


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
            "守护进程当前离线，无法浏览目录；请确认守护进程在线后重试。",
            details={
                "runtime_id": str(runtime_id),
                "path": data.path,
                "reason": "offline_or_send_failed",
            },
        ) from exc
    except DaemonRpcTimeout as exc:
        raise DaemonRpcGatewayError(
            "目录浏览请求超时，请稍后重试。",
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
                "守护进程拒绝浏览该目录：路径不在允许的访问范围内。",
                details={
                    "runtime_id": str(runtime_id),
                    "path": data.path,
                    "daemon_code": exc.code,
                    "daemon_message": exc.message,
                },
            ) from exc
        raise DaemonRpcRemoteGatewayError(
            "守护进程执行目录浏览失败，请稍后重试。",
            details={
                "runtime_id": str(runtime_id),
                "path": data.path,
                "daemon_code": exc.code,
                "daemon_message": exc.message,
            },
        ) from exc

    entries = result.get("entries", []) if isinstance(result, dict) else []
    return ListDirResponse(entries=entries)


@router.post(
    "/runtimes/{runtime_id}/list-roots",
    response_model=ListRootsResponse,
)
async def list_roots(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> ListRootsResponse:
    """Forward a list_roots request to the bound daemon over WS RPC.

    task-04 · FR-2 / D-002 ownership（runtime 必须属于当前用户）/ D-007 读=owner（非 admin）。
    daemon 返回该主机磁盘根锚点列表（用于前端文件夹选择锚点定位）。
    backend 仅负责 ownership 校验 + RPC/HTTP 状态映射，不解析路径。
    """
    svc = DaemonService(session)
    # Ownership check: runtime not owned by current user → 404.
    runtime = await svc._get_owned_runtime(runtime_id, user.id)

    # Lazy import（与 list_dir / placement.py / agent.service.py 一致）：
    # ws_hub 单例访问器按测试逐个 patch，模块顶部 import 会绑定陈旧/mock 引用。
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    hub = get_daemon_ws_hub()
    # task-06: ws_hub 按 daemon_instance_id 路由；runtime_id → daemon_id。
    # 迁移窗口 runtime.daemon_instance_id IS NULL → 回退 runtime_id（兼容旧数据）。
    daemon_id = runtime.daemon_instance_id or runtime_id
    try:
        result = await hub.send_rpc(daemon_id, "list_roots", {})
    except DaemonRuntimeOffline as exc:
        raise DaemonRpcGatewayError(
            "守护进程当前离线，无法读取磁盘根目录；请确认守护进程在线后重试。",
            details={
                "runtime_id": str(runtime_id),
                "reason": "offline_or_send_failed",
            },
        ) from exc
    except DaemonRpcTimeout as exc:
        raise DaemonRpcGatewayError(
            "读取磁盘根目录请求超时，请稍后重试。",
            details={
                "runtime_id": str(runtime_id),
                "rpc_id": exc.details.get("rpc_id") if exc.details else None,
                "timeout_seconds": exc.details.get("timeout_seconds") if exc.details else None,
            },
        ) from exc
    except DaemonRpcRemoteError as exc:
        # daemon business error — map forbidden → 403 (FR-04), others → 502.
        if exc.code == "forbidden":
            raise DaemonRpcForbiddenError(
                "守护进程拒绝读取磁盘根目录。",
                details={
                    "runtime_id": str(runtime_id),
                    "daemon_code": exc.code,
                    "daemon_message": exc.message,
                },
            ) from exc
        raise DaemonRpcRemoteGatewayError(
            "守护进程读取磁盘根目录失败，请稍后重试。",
            details={
                "runtime_id": str(runtime_id),
                "daemon_code": exc.code,
                "daemon_message": exc.message,
            },
        ) from exc

    roots = result.get("roots", []) if isinstance(result, dict) else []
    return ListRootsResponse(roots=roots)


@router.get(
    "/runtimes/{runtime_id}/pending-leases",
    response_model=list[dict],
)
async def get_pending_leases(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> list[dict]:
    """Return all pending leases for a runtime (polled by daemon).

    task-03（security-audit-remediation / FR-02 / D-001@v1）：查询前归属校验
    ——runtime 的 user 必须是当前认证 user，不匹配/不存在 → 404（owner-only，
    跨用户与不存在同语义）。同时把原 raw SQL 改 ORM 查询：原 text() 直绑
    uuid.UUID 参数在 SQLite（CHAR(32) 存储）下 ProgrammingError，且无法挂
    归属校验；ORM ``col()`` 由 dialect 处理 Uuid 绑定，两库行为一致。
    """
    runtime = await session.get(DaemonRuntime, runtime_id)
    if runtime is None or runtime.user_id != user.id:
        raise DaemonRuntimeNotFound(
            "运行时不存在或不属于当前用户。",
            details={"runtime_id": str(runtime_id)},
        )

    result = (
        (
            await session.execute(
                select(DaemonTaskLease)
                .where(
                    DaemonTaskLease.runtime_id == runtime_id,
                    DaemonTaskLease.status == "pending",
                )
                .order_by(DaemonTaskLease.created_at)
            )
        )
        .scalars()
        .all()
    )
    out = []
    for lease in result:
        meta = lease.metadata_ or {}
        # ql-20260823-007：reopen 租约只经 daemon:session_resume WS 消费（设计
        # §6.4），不是任务轮询的消费对象——混进 pending-leases 会被 daemon 的
        # HTTP 轮询兜底认领，随后因无 prompt/run_id 走 interactive_missing_fields
        # 裸退，租约永挂 claimed（2026-08-23 bdec91a4 事故排查发现）。
        # metadata.reopened_from_status 是 reopen 转换写入的精确标记。
        if meta.get("reopened_from_status") is not None:
            continue
        out.append(
            {
                "lease_id": str(lease.id),
                "agent_run_id": str(lease.agent_run_id) if lease.agent_run_id else None,
                "prompt": meta.get("prompt", ""),
                # 原 raw SQL JOIN daemon_runtimes 取 r.provider 兜底；本端点
                # WHERE l.runtime_id = 路径 runtime_id，故 r.provider 恒等于
                # 已取出的 runtime.provider，直接复用。
                "provider": meta.get("provider") or runtime.provider,
                "model": meta.get("model"),
                # daemon 侧自维护 provider→path 映射（daemon.ts _agentPaths），
                # capabilities 已上提到 daemon_instances 且不再含 cmd_path/protocol。
                "cmd_path": "",
                "protocol": "",
            }
        )
    return out


# ---------------------------------------------------------------------------
# 2026-08-29-daemon-platform-resilience task-04：控制指令补拉与 ACK 端点
# （design A2 / D-005@v1 / D-006@v1）。鉴权对齐 pending-leases 惯例：
# get_current_principal（daemon X-API-Key / Bearer）+ runtime 归属校验
# （不匹配/不存在同语义 404，owner-only）。
# ---------------------------------------------------------------------------


class ControlCommandItem(BaseModel):
    """补拉返回的单条控制指令（task-04 provides 契约：id/kind/payload/created_at）。

    ``payload`` 与 WS 消息 payload 同构且已含 ``command_id``（daemon 侧幂等键，
    补拉与 WS 推送共用同键去重）。
    """

    id: uuid.UUID
    kind: str
    payload: dict[str, Any] | None = None
    created_at: datetime


class PendingControlsResponse(BaseModel):
    """GET pending-controls 响应（仅 status=pending，created_at 升序）。"""

    commands: list[ControlCommandItem] = Field(default_factory=list)


class ControlsAckRequest(BaseModel):
    """POST controls/ack 请求体。

    ``ids`` 为 daemon 已处理（含消费失败的业务性错误——ack 语义=已处理防毒丸
    重投，不承诺成功）的指令 id 列表；空列表合法（acked=0）。
    """

    ids: list[uuid.UUID] = Field(default_factory=list)


class ControlsAckResponse(BaseModel):
    """POST controls/ack 响应：实际翻转 acked 的行数。"""

    acked: int


@router.get(
    "/runtimes/{runtime_id}/pending-controls",
    response_model=PendingControlsResponse,
)
async def get_pending_controls(
    runtime_id: uuid.UUID,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> PendingControlsResponse:
    """补拉待发控制指令（daemon 重连对账 / 心跳 pending_controls>0 触发）.

    2026-08-29-daemon-platform-resilience task-04 / design A2 / D-006@v1：
    **仅返回 status=pending 的指令**，``created_at`` 升序（FIFO）——delivered
    一律不重发（WS 推送成功 = TCP 已达 daemon 进程，重发 inject 会向 agent
    双发 prompt），过期与 delivered-未-ack 行由 GC 清理。归属校验同
    pending-leases（owner-only，跨用户与不存在同语义 404）。
    """
    from app.modules.daemon.control_commands import ControlCommandService

    runtime = await session.get(DaemonRuntime, runtime_id)
    if runtime is None or runtime.user_id != user.id:
        raise DaemonRuntimeNotFound(
            "运行时不存在或不属于当前用户。",
            details={"runtime_id": str(runtime_id)},
        )

    rows = await ControlCommandService(session).fetch_pending(runtime_id)
    return PendingControlsResponse(
        commands=[
            ControlCommandItem(
                id=row.id,
                kind=row.kind,
                payload=row.payload,
                created_at=row.created_at,
            )
            for row in rows
        ]
    )


@router.post(
    "/runtimes/{runtime_id}/controls/ack",
    response_model=ControlsAckResponse,
)
async def ack_controls(
    runtime_id: uuid.UUID,
    data: ControlsAckRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> ControlsAckResponse:
    """daemon 消费回执：ids 批量置 acked（pending|delivered 均可，终态幂等跳过）.

    2026-08-29-daemon-platform-resilience task-04 / design A2：ack 语义 =
    「daemon 已处理」——消费成功与消费失败的业务性错误同样 ack（防毒丸指令
    无限重投，错误进 daemon 日志）；过期/已回执行静默跳过。翻转范围限定
    本 runtime 名下（归属校验后防越权 ack 他人指令）。返回实际翻转数。
    """
    from app.modules.daemon.control_commands import ControlCommandService

    runtime = await session.get(DaemonRuntime, runtime_id)
    if runtime is None or runtime.user_id != user.id:
        raise DaemonRuntimeNotFound(
            "运行时不存在或不属于当前用户。",
            details={"runtime_id": str(runtime_id)},
        )

    acked = await ControlCommandService(session).ack(data.ids, runtime_id=runtime_id)
    return ControlsAckResponse(acked=acked)


# ---------------------------------------------------------------------------
# 2026-07-07-daemon-skill-execution task-06：platform sillyspec skills 分发端点。
# daemon skill-manager（task-03）启动时查 manifest 比对版本，新则拉 bundle 解压。
# 仿 daemon install bundle 分发：tar.gz + manifest（version=内容 sha256 前缀 + 文件 sha256）。
# ---------------------------------------------------------------------------


@router.get("/skills/latest/manifest")
async def get_skills_manifest(
    user: Annotated[Any, Depends(get_current_principal)],
    session: SessionDep,
) -> dict[str, Any]:
    """Return sillyspec skills manifest (version + file list + sha256 per file).

    daemon skill-manager 用来判定是否需重新拉取 bundle（版本漂移）。
    合并代码库 ``sillyspec-*`` + DB ``CustomSkill``（task-03，每个 → ``<name>/SKILL.md``）。
    源目录无 skills 时返回 404。
    """
    from app.modules.agent.skills_bundle_service import build_skills_manifest

    # task-07 D-004：透传 user.id，让 manifest 按 user 维度合并代码库 sillyspec-* + 该用户私有 CustomSkill。
    manifest = await build_skills_manifest(session=session, user_id=user.id)
    if not manifest.get("files"):
        raise HTTPException(status_code=404, detail="当前没有任何可用的技能包。")
    return manifest


@router.get("/skills/latest/bundle")
async def get_skills_bundle(
    user: Annotated[Any, Depends(get_current_principal)],
    session: SessionDep,
) -> StreamingResponse:
    """Return sillyspec-skills.tar.gz binary stream for daemon download.

    bundle 含代码库 ``sillyspec-*`` skill 目录 + DB ``CustomSkill``，打包为 gzip tar。
    无 skills 时返回 404。
    """
    from app.modules.agent.skills_bundle_service import build_skills_bundle

    # task-07 D-004：透传 user.id，让 bundle 按 user 维度打包代码库 sillyspec-* + 该用户私有 CustomSkill。
    bundle = await build_skills_bundle(session=session, user_id=user.id)
    if not bundle:
        raise HTTPException(status_code=404, detail="当前没有任何可用的技能包。")
    return StreamingResponse(
        io.BytesIO(bundle),
        media_type="application/gzip",
        headers={
            "Content-Disposition": "attachment; filename=sillyspec-skills.tar.gz",
        },
    )


# 2026-08-05-skill-content-viewer task-02：平台 skill 内容只读查看端点。
# 白名单 + 固定 SKILL.md（read_skill_md）天然防路径穿越；权限对齐 manifest。
# 声明在 manifest/bundle 之后（FastAPI 按声明顺序匹配；{skill_name} 不与 latest
# 静态段冲突，但防御性在后避免未来 {skill_name} 误捕获静态段）。
@router.get("/skills/{skill_name}/content")
async def get_skill_content(
    skill_name: str,
    user: Annotated[Any, Depends(get_current_principal)],
) -> dict[str, str]:
    """Return a sillyspec-* skill's SKILL.md content (read-only, traversal-safe).

    ``skill_name`` 必须在 sillyspec-* 白名单内；固定读 SKILL.md（不拼 path）。
    404 = 非白名单 / SKILL.md 缺失；413 = > 1 MiB。
    """
    from app.modules.agent.skills_bundle_service import read_skill_md

    try:
        content = read_skill_md(skill_name)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    return {"skill_name": skill_name, "content": content}


# ---------------------------------------------------------------------------
# 2026-07-07-skills-mcp-management-ui task-05：daemon 拉 MCP 平台配置端点。
# daemon skill-manager / mcp-config 启动时拉平台默认 mcpServers + 白名单，
# 注入 claude 启动 env（design D-004）。与 admin 视图（/api/mcp-servers*
# 详情脱敏）的区别：本端点给 daemon 用，**返回原值不脱敏**（daemon 需
# 真实 env 才能注入 claude）。
# 认证走 get_current_principal（daemon X-API-Key，同 skills/latest/* 端点）。
#
# 2026-09-10-mcp-central-registry task-05：platform 位数据源从 KV
# ``mcp.platform_default`` 切到 registry 渲染（``render_injection_set``，
# task-04；D-003 KV 弃用不读不清理），加可选 query ``user_id``——带值时
# platform ∪ user 注入集 + lease 归属授权校验（D-010）；渲染抛错返 503
# 保 daemon 本地 mcp.json 回落链可达（兼容策略 CC-04/CC-14）。
# ---------------------------------------------------------------------------


async def _read_mcp_config_raw(session: AsyncSession, workspace_id: uuid.UUID) -> dict[str, Any]:
    """读 workspace ``specDir/.mcp.json`` **明文不脱敏**（design §7.2，task-03）。

    daemon 需要真实 env 真值注入 agent 会话，故不复用
    ``SkillsViewService.get_mcp_config`` 的脱敏视图（D-004）。定位 specDir 与
    skills_view_service 同法：``SpecWorkspace.spec_root`` + platform_managed
    扁平根（backend 容器本地直读，不经 RPC）。

    容错：无 spec_ws / spec_root 缺失 / 文件缺失 / JSON 解析失败 / 非 dict
    结构 → 返回空 ``{"mcpServers": {}}`` 不抛错（daemon 侧回落空 workspace
    配置，R-03；非 stdio 条目的预净化兜底在 daemon fetchMcpBundle，task-05）。
    workspace 不存在/已软删 → ``WorkspaceNotFound``（404 中文，经全局
    AppError 处理器序列化）。
    """
    from app.core.spec_paths import SpecPathResolver
    from app.modules.spec_workspace.model import SpecWorkspace
    from app.modules.workspace.service import WorkspaceService

    # 不存在/已软删 → WorkspaceNotFound（404），复用既有中文报错文案。
    await WorkspaceService(session).get(workspace_id)

    stmt = select(SpecWorkspace).where(SpecWorkspace.workspace_id == workspace_id)
    spec_ws = (await session.execute(stmt)).scalars().first()
    if spec_ws is None or not spec_ws.spec_root:
        return {"mcpServers": {}}

    resolver = SpecPathResolver(spec_ws.spec_root, platform_managed=True)
    mcp_path = resolver._spec_root() / ".mcp.json"
    return await asyncio.to_thread(_read_mcp_json_sync, mcp_path)


def _read_mcp_json_sync(mcp_path: Path) -> dict[str, Any]:
    """``_read_mcp_config_raw`` 同步读+解析段（文件 IO 移出事件循环）。

    容错集与 ``skills_view_service._read_mcp_config_sync`` 一致，差异：
    **不脱敏**（daemon 注入需 env 真值，task-03 design §7.2）。
    """
    empty: dict[str, Any] = {"mcpServers": {}}
    if not mcp_path.is_file():
        return empty
    try:
        raw = mcp_path.read_text(encoding="utf-8")
    except (OSError, PermissionError):
        return empty
    try:
        data = json.loads(raw)
    except (json.JSONDecodeError, TypeError):
        return empty
    if not isinstance(data, dict):
        return empty
    mcp_servers = data.get("mcpServers")
    if not isinstance(mcp_servers, dict):
        mcp_servers = {}
    return {"mcpServers": mcp_servers}


_ACTIVE_LEASE_STATUSES = ("pending", "claimed")


async def _lease_covers_user(
    session: AsyncSession, *, principal_id: uuid.UUID, user_id: uuid.UUID
) -> bool:
    """D-010 user_id 授权校验：认证主体是否持有归属该 user 的活跃 lease。

    归属链（design「接口定义」授权规则段 / lease→user 关联链）：``lease.runtime_id
    → DaemonRuntime.user_id``，活跃态取 pending/claimed（现行 partial index
    ``idx_daemon_task_leases_expires_at`` 同口径，model.py）。匹配条件 =
    ``runtime.user_id == principal.id`` 且 ``runtime.user_id == 请求 user_id``
    ——get_current_principal 双路径（daemon X-API-Key / Bearer）统一解析为
    User principal，"daemon principal" 判定即由该归属链承担：把"泄漏 daemon
    token 可读任意用户 env"压回"只能读该 daemon 正在服务的用户"（R-08）。
    无匹配由调用方返 404（不泄露 user 存在性）。
    """
    stmt = (
        select(DaemonTaskLease.id)
        .join(DaemonRuntime, DaemonTaskLease.runtime_id == DaemonRuntime.id)
        .where(
            DaemonTaskLease.status.in_(_ACTIVE_LEASE_STATUSES),
            DaemonRuntime.user_id == principal_id,
            DaemonRuntime.user_id == user_id,
        )
        .limit(1)
    )
    return (await session.execute(stmt)).scalars().first() is not None


@router.get("/mcp/config")
async def get_daemon_mcp_config(
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
    workspace_id: uuid.UUID | None = None,
    user_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """返回 MCP 注入集 + server 白名单（**原值不脱敏**，design D-004）。

    daemon 启动 skill-manager / mcp-config 时拉取，用于：
      * ``platform_default.mcpServers`` → 注入 claude 启动 ``env``（真实值，
        ``encrypted_env`` 经 render 解密回填，secret 类 env key 不遮蔽）；
      * ``whitelist`` → 仅放行白名单内的 server。

    2026-09-10-mcp-central-registry task-05：platform 位数据源 = registry 渲染
    （``render_injection_set(session, user_id)``，task-04）——不带 ``user_id``
    仅 platform binding（等同旧 KV platform_default 语义，旧 daemon 零感知）；
    带 ``user_id`` = platform ∪ user 注入集，且先做 lease 归属双校验（D-010：
    认证主体持有归属该 user 的活跃 lease，无匹配 404 不泄露存在性）。
    ``mcp.platform_default`` KV 不再读（D-003 弃用，残留无害）。

    registry 空库 → 200 + ``{"platform_default": {"mcpServers": {}}, ...}``
    （对齐旧 KV 缺失回落语义）；渲染抛错 → 503（中文 detail）——daemon 侧
    fetch 非 200 回落本地 ``~/.sillyhub/daemon/mcp.json`` 的既有链路保持
    可达（空集 200 与故障 503 语义分开，兼容策略 CC-14）。

    可选 query ``workspace_id``（2026-08-26-workspace-mcp-edit task-03）：提供时
    响应追加 ``"workspace": {"mcpServers": {...}}``（读该工作区 ``specDir/.mcp.json``
    明文，见 ``_read_mcp_config_raw``，读取逻辑不动）；非法 UUID → 422（全局
    校验处理器中文报错）。
    """
    from app.modules.mcp_registry.render import render_injection_set
    from app.modules.settings.router import MCP_WHITELIST_KEY, _read_setting_json

    # D-010：user_id 有值 → lease 归属双校验，无匹配 404（不泄露 user 存在性）。
    if user_id is not None and not await _lease_covers_user(
        session, principal_id=user.id, user_id=user_id
    ):
        raise HTTPException(status_code=404, detail="未找到匹配的活跃任务租约。")

    # 换源 registry 渲染（task-04）；render 自身全程容错（解密失败降级/空库空集），
    # 此处只兜非预期故障（DB 异常等）→ 503，daemon 回落链保持可达。
    try:
        platform_default = await render_injection_set(session, user_id)
    except Exception as exc:
        raise HTTPException(status_code=503, detail="MCP 注入集渲染暂不可用，请稍后重试。") from exc

    # whitelist 读取不动（D-007 白名单留 settings）；脏数据归一为 []。
    raw_whitelist = await _read_setting_json(session, MCP_WHITELIST_KEY, [])
    whitelist = [str(x) for x in raw_whitelist] if isinstance(raw_whitelist, list) else []

    payload: dict[str, Any] = {
        "platform_default": platform_default,
        "whitelist": whitelist,
    }
    # 带 workspace_id → 追加明文 workspace 配置；不带 → payload 与旧结构完全一致。
    if workspace_id is not None:
        payload["workspace"] = await _read_mcp_config_raw(session, workspace_id)
    return payload
