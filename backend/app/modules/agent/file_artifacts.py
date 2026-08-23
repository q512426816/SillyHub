"""Agent 文件制品端点（2026-08-23-agent-file-upload-mcp task-03 / design §7.2 / §7.5）。

会话主 agent / 批任务 worker 经 daemon sillyhub-file MCP server（multipart 直传）
把本地工作目录内产物上传到平台文件中心，并在聊天流 / run 日志流留下文件行：

- ``POST /api/agent/file-artifacts``（multipart）：``FileService.upload_file`` 落
  File 行（owner_type=agent_session/agent_run，D-006@v2）+ 同步写一条 AgentRunLog
  日志行（channel=tool_call、tool_kind=FileUpload、content=六字段 JSON、
  dedup_key=file-upload:{file_id}，D-007@v1）+ Redis publish 实时扇出（D-011@v1，
  复用 submit_run_input 同款降级语义：publish 失败仅记 WARNING 不阻断上传）。
- ``GET /api/agent/file-artifacts?session_id=|run_id=``：按归属列文件元数据
  （FileMetaResp 含 description/created_at，created_at 倒序），供前端 run 详情
  「产出文件」区（D-010@v1，不复用 /api/file/list）。

鉴权（mcp_tools.py 同款双路径）：JWT Bearer / X-API-Key 经 ``get_current_principal``
落同一 User，解析出归属后分场景复核（ql-20260823-013 会话归属人制，supersede
D-004@v2 的会话场景锚 NULL 兜底 deny）：

- 会话场景（X-Session-Id）：上传者 == ``AgentSession.user_id`` 即放行——无工作区
  的 runtime 会话同样可传可列（「会话的都能上传回显」）；非归属人回退按
  ``AgentSession.workspace_id`` 锚复核（workspace 会话的成员/管理员语义不变）。
- worker 场景（run_id）：仍按 task-02 解析链取锚 workspace 复核
  （target_workspace_id ?? mission ?? task，锚 NULL 兜底 deny，D-004@v2）。
POST 复核 WORKSPACE_WRITE，GET 复核 WORKSPACE_READ（读级，面向前端普通成员与
daemon list 工具）。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Form, HTTPException, Query, Request, UploadFile, status
from fastapi import File as FastAPIFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth_deps import get_current_principal
from app.core.config import Settings, get_settings
from app.core.db import get_session
from app.core.logging import get_logger
from app.core.redis import get_redis
from app.modules.agent.mcp_tools import (
    _ACTIVE_RUN_STATUSES,
    _request_session_id,
)
from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.auth.rbac import has_permission
from app.modules.file.model import File
from app.modules.file.schema import FileMetaResp, FileUploadResp
from app.modules.file.service import FileService
from app.modules.storage.base import StorageBackend
from app.modules.storage.factory import get_storage_backend

log = get_logger(__name__)

router = APIRouter(tags=["agent-file-artifacts"])

SessionDep = Annotated[AsyncSession, Depends(get_session)]

# 双路径鉴权入口（JWT / X-API-Key，mcp_tools.SessionMcpUser 同款）：仅认证身份。
# 归属解析后分场景复核——会话场景走会话归属人制（_check_session_permission），
# worker 场景按锚 workspace 复核（_check_anchor_permission）。原 require_permission_any
# 「任意工作区持权」入口门已在 ql-20260823-013 移除：它把无任何工作区角色的
# 会话归属人也挡在门外，与「会话的都能上传回显」冲突；场景内复核权限只紧不松。
PrincipalUser = Annotated[User, Depends(get_current_principal)]

# D-007@v1：文件上传日志行常量（前端 assembler 按 tool_kind='FileUpload' 精确
# 匹配映射 file 段，优先于通用 tool_use 映射，R-07）。
FILE_UPLOAD_TOOL_KIND = "FileUpload"
_FILE_UPLOAD_LOG_CHANNEL = "tool_call"


def _make_file_service(
    session: Annotated[AsyncSession, Depends(get_session)],
    storage: Annotated[StorageBackend, Depends(get_storage_backend)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> FileService:
    """构造 FileService（file/router.py 同款依赖注入；测试用 overrides 换 MockStorage）。"""
    return FileService(session, storage, settings)


class FileArtifactListResponse(BaseModel):
    """GET /api/agent/file-artifacts 响应（D-010@v1，design §7.2）。"""

    files: list[FileMetaResp]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _check_anchor_permission(
    session: AsyncSession,
    user: User,
    *,
    permission: Permission,
    anchor_workspace_id: uuid.UUID | None,
) -> None:
    """按归属锚 workspace 复核权限（锚 NULL 兜底 deny——D-004@v2，防把 None 传进
    has_permission 的 workspace_id=None 分支变成「任意工作区」放行）。"""
    if anchor_workspace_id is None or not await has_permission(
        session,
        user=user,
        permission=permission,
        workspace_id=anchor_workspace_id,
    ):
        raise HTTPException(
            status.HTTP_403_FORBIDDEN,
            "对该会话或执行记录所属的工作区没有相应权限，禁止访问其文件制品。",
        )


async def _check_session_permission(
    session: AsyncSession,
    user: User,
    *,
    permission: Permission,
    agent_session: AgentSession,
) -> None:
    """会话场景授权——会话归属人制（ql-20260823-013，supersede D-004@v2 会话分支）。

    上传者 == ``AgentSession.user_id`` 即放行：daemon 的 API key / 浏览器 JWT 本就
    是会话主人的身份，无工作区的 runtime 会话同样可传可列；非归属人回退按
    ``AgentSession.workspace_id`` 锚复核（workspace 会话的成员/平台管理员语义
    不变），锚 NULL 且非归属人 → 403。
    """
    if user.id == agent_session.user_id:
        return
    await _check_anchor_permission(
        session,
        user,
        permission=permission,
        anchor_workspace_id=agent_session.workspace_id,
    )


async def _current_session_run(
    session: AsyncSession, agent_session_id: uuid.UUID
) -> AgentRun | None:
    """会话场景日志行挂载口径（D-007@v1）：当前活跃 run（_ACTIVE_RUN_STATUSES，
    mcp_tools 同源口径）优先，无活跃取最新 run 兜底（turn 间隙上传仍可挂）。"""
    active_stmt = (
        select(AgentRun)
        .where(
            AgentRun.agent_session_id == agent_session_id,
            AgentRun.status.in_(_ACTIVE_RUN_STATUSES),
        )
        .order_by(AgentRun.created_at.desc())
        .limit(1)
    )
    run = (await session.execute(active_stmt)).scalars().first()
    if run is not None:
        return run
    latest_stmt = (
        select(AgentRun)
        .where(AgentRun.agent_session_id == agent_session_id)
        .order_by(AgentRun.created_at.desc())
        .limit(1)
    )
    return (await session.execute(latest_stmt)).scalars().first()


async def _publish_file_upload_log(
    *,
    run: AgentRun,
    agent_session_id: uuid.UUID | None,
    log_id: uuid.UUID,
    content: str,
    timestamp: datetime,
) -> None:
    """写行成功后向 Redis 双通道 publish 该日志行（D-011@v1 / R-10）。

    - run 日志流 ``agent_run:{run_id}``：扁平 StreamLogEvent 形态（submit_run_input
      同款 + tool_kind，前端实时流按 tool_kind='FileUpload' 映射 file 段）。
    - 会话流 ``agent_session:{session_id}``：带 event/session_id/run_id 包络
      （daemon run_sync publish 同款），仅会话场景（batch worker run 无会话）。

    复用 submit_run_input 降级语义：publish 失败仅记 WARNING 不阻断上传响应
    （Redis Pub/Sub 无历史，丢失实时事件由前端刷新经 GET/回放补齐）。
    """
    ts_iso = timestamp.isoformat().replace("+00:00", "Z")
    run_payload = {
        "log_id": str(log_id),
        "channel": _FILE_UPLOAD_LOG_CHANNEL,
        "content": content,
        "timestamp": ts_iso,
        "tool_kind": FILE_UPLOAD_TOOL_KIND,
    }
    try:
        redis = get_redis()
        await redis.publish(f"agent_run:{run.id}", json.dumps(run_payload))
    except Exception:
        log.warning(
            "file_artifact_run_channel_publish_failed",
            run_id=str(run.id),
        )
    if agent_session_id is None:
        return
    session_payload = {
        "event": "log",
        "session_id": str(agent_session_id),
        "run_id": str(run.id),
        **run_payload,
    }
    try:
        redis = get_redis()
        await redis.publish(f"agent_session:{agent_session_id}", json.dumps(session_payload))
    except Exception:
        log.warning(
            "file_artifact_session_channel_publish_failed",
            session_id=str(agent_session_id),
            run_id=str(run.id),
        )


# ---------------------------------------------------------------------------
# POST /api/agent/file-artifacts（multipart 上传，design §7.2）
# ---------------------------------------------------------------------------


@router.post(
    "/agent/file-artifacts",
    response_model=FileUploadResp,
    status_code=status.HTTP_201_CREATED,
)
async def upload_file_artifact(
    request: Request,
    session: SessionDep,
    user: PrincipalUser,
    service: Annotated[FileService, Depends(_make_file_service)],
    file: Annotated[UploadFile, FastAPIFile()],
    description: Annotated[str, Form()] = "",
    run_id: Annotated[uuid.UUID | None, Form()] = None,
) -> FileUploadResp:
    """上传一个 agent 文件制品：File 行 + AgentRunLog 日志行 + Redis 实时扇出。

    场景解析（design §7.2）：

    - worker 场景（显式 ``run_id``）：校验 run 存在（404）后挂该 run，
      owner_type=agent_run；锚 workspace 走 task-02 解析链。
    - 会话场景（``X-Session-Id``，与 mcp_tools 同名同源）：日志行挂当前活跃 run
      （无活跃取最新，均无 422 中文引导），owner_type=agent_session、owner_id=
      会话 id；授权走会话归属人制（ql-20260823-013）：归属人放行（无工作区会话
      同样可传），非归属人按 AgentSession.workspace_id 锚复核 WORKSPACE_WRITE。

    worker 场景按锚 workspace 复核 WORKSPACE_WRITE（越权 403）；重放防护：直写日志行
    撞 ``(run_id, dedup_key)`` 部分唯一索引（ux_agent_run_logs_dedup）的
    IntegrityError 视作已写入，不 500。
    """
    # ── 1. 场景解析（run 挂载点 + owner + 锚 workspace）────────────────────
    if run_id is not None:
        run = await session.get(AgentRun, run_id)
        if run is None:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                "指定的执行记录不存在，无法上传文件制品。",
            )
        owner_type = "agent_run"
        owner_id = run.id
        agent_session_id = run.agent_session_id
        # task-02 解析链（FileService._agent_run_anchor，D-004@v2）：
        # target_workspace_id ?? mission.workspace_id ?? task.workspace_id。
        anchor_workspace_id = await service._agent_run_anchor(run.id)
        # ── 2. worker 场景：锚 workspace 复核 WORKSPACE_WRITE（越权 403）─────
        await _check_anchor_permission(
            session,
            user,
            permission=Permission.WORKSPACE_WRITE,
            anchor_workspace_id=anchor_workspace_id,
        )
    else:
        agent_session_id = _request_session_id(request, None)
        if agent_session_id is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "缺少上传上下文：请携带 X-Session-Id 会话头或 run_id 参数。",
            )
        agent_session = await session.get(AgentSession, agent_session_id)
        if agent_session is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "会话不存在。")
        run = await _current_session_run(session, agent_session_id)
        if run is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_ENTITY,
                "该会话还没有任何执行记录，无法关联上传的文件，请先发起对话或执行任务。",
            )
        owner_type = "agent_session"
        owner_id = agent_session.id
        # ── 2. 会话场景：会话归属人制（归属人放行，非归属人按 workspace 锚
        #    复核 WORKSPACE_WRITE，ql-20260823-013）───────────────────────────
        await _check_session_permission(
            session,
            user,
            permission=Permission.WORKSPACE_WRITE,
            agent_session=agent_session,
        )

    # ── 3. 落 File 行（FileService 复用：大小/类型校验 + MinIO + 元数据）────
    data = await file.read()
    resp = await service.upload_file(
        original_name=file.filename or "unnamed",
        data=data,
        mime_type=file.content_type or "application/octet-stream",
        uploaded_by=user.id,
        owner_type=owner_type,
        owner_id=owner_id,
        description=description,
    )

    # ── 4. 写 AgentRunLog 日志行（D-007@v1，六字段 JSON 进 content）────────
    now = datetime.now(UTC)
    content = json.dumps(
        {
            "file_id": str(resp.id),
            "original_name": resp.original_name,
            "size": resp.size,
            "mime_type": resp.mime_type,
            "description": resp.description,
            "created_at": now.isoformat().replace("+00:00", "Z"),
        },
        ensure_ascii=False,
    )
    log_entry = AgentRunLog(
        run_id=run.id,
        timestamp=now,
        channel=_FILE_UPLOAD_LOG_CHANNEL,
        tool_kind=FILE_UPLOAD_TOOL_KIND,
        content_redacted=content,
        dedup_key=f"file-upload:{resp.id}",
    )
    run_id_str = str(run.id)
    file_id_str = str(resp.id)
    session.add(log_entry)
    try:
        await session.commit()
    except IntegrityError:
        # 重放防护（R-05）：撞 (run_id, dedup_key) 部分唯一索引 → 先到者已写入，
        # 回滚视作成功（不 500）；已写入行此前已 publish，不再重复扇出。rollback
        # 会 expire 会话内对象（懒刷新在 greenlet 外炸 MissingGreenlet），日志
        # 参数用回滚前取好的字符串。
        await session.rollback()
        log.info(
            "file_upload_log_dedup_replayed",
            run_id=run_id_str,
            file_id=file_id_str,
        )
        return resp

    # ── 5. Redis 双通道实时扇出（D-011@v1，失败 WARNING 降级不阻断）────────
    await _publish_file_upload_log(
        run=run,
        agent_session_id=agent_session_id,
        log_id=log_entry.id,
        content=content,
        timestamp=log_entry.timestamp,
    )
    return resp


# ---------------------------------------------------------------------------
# GET /api/agent/file-artifacts（列表，design §7.2 / D-010@v1）
# ---------------------------------------------------------------------------


@router.get("/agent/file-artifacts", response_model=FileArtifactListResponse)
async def list_file_artifacts(
    session: SessionDep,
    user: PrincipalUser,
    service: Annotated[FileService, Depends(_make_file_service)],
    session_id: Annotated[uuid.UUID | None, Query()] = None,
    run_id: Annotated[uuid.UUID | None, Query()] = None,
) -> FileArtifactListResponse:
    """按 session_id / run_id 列文件制品（FileMetaResp 含 description/created_at）。

    会话场景走会话归属人制（归属人放行，非归属人按 workspace 锚复核
    WORKSPACE_READ，ql-20260823-013）；run 场景仍锚 workspace 复核 WORKSPACE_READ；
    按 created_at 倒序。前端 run 详情「产出文件」区与 daemon list_uploaded_files
    工具共用本端点（D-010@v1，不复用 /api/file/list——其非 admin owner 分支把
    owner_id 当 workspace id 鉴权会 404）。
    """
    if (session_id is None) == (run_id is None):
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_ENTITY,
            "请提供 session_id 或 run_id 中的一个查询参数。",
        )
    if session_id is not None:
        agent_session = await session.get(AgentSession, session_id)
        if agent_session is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "会话不存在。")
        owner_type = "agent_session"
        owner_id = agent_session.id
        await _check_session_permission(
            session,
            user,
            permission=Permission.WORKSPACE_READ,
            agent_session=agent_session,
        )
    else:
        assert run_id is not None  # 上面互斥校验保证二选一
        run = await session.get(AgentRun, run_id)
        if run is None:
            raise HTTPException(
                status.HTTP_404_NOT_FOUND,
                "指定的执行记录不存在。",
            )
        owner_type = "agent_run"
        owner_id = run.id
        anchor_workspace_id = await service._agent_run_anchor(run.id)
        await _check_anchor_permission(
            session,
            user,
            permission=Permission.WORKSPACE_READ,
            anchor_workspace_id=anchor_workspace_id,
        )
    stmt = (
        select(File)
        .where(
            File.owner_type == owner_type,
            File.owner_id == owner_id,
            File.deleted_at.is_(None),
        )
        .order_by(File.created_at.desc())
    )
    rows = (await session.execute(stmt)).scalars().all()
    return FileArtifactListResponse(files=[FileMetaResp.model_validate(r) for r in rows])
