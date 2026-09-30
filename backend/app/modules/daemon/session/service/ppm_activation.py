"""PPM 物化 / 派发失败收敛 / tool_report 懒激活（task-08 拆分，原 :2223-2834）。

三个方法体下沉为模块函数（第一参数 svc），SessionService 类壳一行委托。
D-007：log / publish_sessions_changed / get_session_readiness /
_merge_lease_metadata 调用点经 ``_svc.`` 延迟解析。
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime

import app.modules.daemon.session.service as _svc
from app.modules.agent.model import (
    AgentRun,
    AgentSession,
)
from app.modules.agent.provider_caps import get_provider_caps
from app.modules.daemon.model import DaemonTaskLease
from app.modules.ppm.common.session_binding import PpmItemKind, load_item_files, load_ppm_item
from app.modules.ppm.problem.model import PpmProblemList
from app.modules.ppm.task.model import PlanTask

from .results import _PreparedPpmAttachment


async def _materialize_ppm_attachments(
    svc,
    *,
    user_id: uuid.UUID,
    kind: PpmItemKind,
    item_id: uuid.UUID,
    provider: str,
    manual_attachments: list,
    item: PlanTask | PpmProblemList | None = None,
) -> tuple[list[str], list[_PreparedPpmAttachment]]:
    """PPM 条目附件物化/降级（task-03 / FR-03 / D-003/D-006/D-007，写事务外）。

    消费链（design §5 Phase 2）：``item.file_urls`` → uuid 解析过滤（R-03：
    非 uuid 条目直接进降级清单）→ task-01 :func:`load_item_files` 取存活
    File 行 → 逐条 ``FileService._can_access`` 同口径校验（D-007：上传者
    本人/平台管理员；ppm 附件 owner_type 不命中 workspace/agent 锚分支）→
    有权且引擎支持附件（attachments 键）且与手动附件合并后 图≤5/文≤5 的条目
    读 file storage bytes → ``SessionAttachmentStorage.store_bytes``（内容寻址
    sha256 去重）产出预备行；其余条目降级为前导文字清单。

    ql-20260828-003 两项修复：

    - ``item`` 可选传参——create_session 前置解析已加载的条目行直接复用，
      全链只查一次 DB（缺省 None 自加载，独立调用/测试路径不变）。
    - IO 并行化——三阶段：①顺序资格判定（纯 DB/内存判断，保图≤5/文≤5
      的顺序水位语义，资格即预占、IO 失败让掉不回补，水位语义可预期）；
      ②资格条目 ``asyncio.gather`` 并行「读源 bytes + store_bytes」（串行
      实现最多 10 附件 × 2 次 IO = 20 次串行网络往返，慢存储下显著拖慢
      会话创建；每条独立兜错）；③按条目原序组装 prepared / 降级行。

    - 降级四类（均不阻塞会话创建，TaskCard GWT-3）：无权 → 仅文件名 +
      「无权访问」；超限 / 引擎不支持附件（attachments 键，ql-20260921-005
      改键）/ 读取失败（``read_failed``）/ 存储失败（``store_failed``）/
      File 已删或缺号的有权条目 → 文件名 + ``GET /api/file/{file_id}`` 链接
      （软删/缺号行回查取文件名，查无以 file_id 兜底）。
    - 纯只读 + storage IO、无 DB 写：``SessionAttachment`` 行 insert 归
      create_session 写事务内（消费返回的 ``_PreparedPpmAttachment``）；
      不复用 ``SessionAttachmentService.upload()``（自带 commit 与 PIL/
      大小校验，源文件已在 file 中心过上传校验不重复）。
    - item 查无（``item`` 传参时由调用方保证存在）或 ``file_urls`` 为空 →
      空产出。
    """
    from app.core.config import get_settings
    from app.modules.auth.model import User as _User
    from app.modules.file.model import File
    from app.modules.file.service import FileService
    from app.modules.session_attachment.service import (
        MAX_FILES_PER_MESSAGE,
        MAX_IMAGES_PER_MESSAGE,
    )
    from app.modules.session_attachment.storage import SessionAttachmentStorage
    from app.modules.storage.factory import get_storage_backend

    if item is None:
        item = await load_ppm_item(svc._session, kind, item_id)
    if item is None:
        return [], []
    entries = list(item.file_urls or [])
    if not entries:
        return [], []

    backend = get_storage_backend()
    # D-007：直接复用 FileService 的归属判定（构造范式对齐 agent/service.py
    # borrow 落 file 段：工厂单例 storage/settings，测试经 patch 注入 mock）。
    file_svc = FileService(svc._session, backend, get_settings())
    session_store = SessionAttachmentStorage(backend)
    actor = await svc._session.get(_User, user_id)

    live_rows = {row.id: row for row in await load_item_files(svc._session, kind, item_id)}

    # 与手动 attachment_ids 合并后的数量水位（图≤5/文≤5）——手动侧超限已在上
    # 方整体 422；ppm 侧超限条目走降级清单不 4xx（不阻塞会话创建）。
    image_n = sum(1 for r in manual_attachments if getattr(r, "kind", None) == "image")
    file_n = sum(1 for r in manual_attachments if getattr(r, "kind", None) == "file")

    # ── 阶段 1：顺序资格判定（无 storage IO）──按 file_urls 原序，资格即
    # 预占水位（IO 失败让掉不回补），保「图≤5/文≤5 按原序截断」可预期。
    degrade_lines: list[str] = []
    candidates: list[tuple[File, str]] = []
    for entry in entries:
        # R-03：file_urls 历史数据混有旧 URL 字符串——非 uuid 条目直接进降级清单。
        try:
            file_id = uuid.UUID(str(entry))
        except (ValueError, AttributeError, TypeError):
            degrade_lines.append(str(entry))
            continue
        row = live_rows.get(file_id)
        if row is None:
            # File 已删/缺号：回查行（含软删）取文件名，降级为文件名 + GET 链接。
            soft_row = await svc._session.get(File, file_id)
            name = (soft_row.original_name if soft_row is not None else None) or str(file_id)
            degrade_lines.append(f"{name}：GET /api/file/{file_id}")
            continue
        if actor is None or not await file_svc._can_access(user=actor, row=row):
            degrade_lines.append(f"{row.original_name}（无权访问）")
            continue
        # provider-abstraction task-11：引擎门控收敛查 ProviderCaps——附件通道按
        # attachments 键（claude/pi/cursor，ql-20260921-005 起改键，cursor 走
        # disk-only 落盘同样可收 .md 记录），与 attachments.py / knowledge/
        # distill.py 同口径（ql-20260922-001 补漏：本处漏改 multimodal 键导致
        # cursor 会话的 PPM 附件被错误降级为 GET 链接）。
        if not get_provider_caps(provider)["attachments"]:
            degrade_lines.append(f"{row.original_name}：GET /api/file/{row.id}")
            continue
        entry_kind = "image" if (row.mime_type or "").startswith("image/") else "file"
        if (entry_kind == "image" and image_n >= MAX_IMAGES_PER_MESSAGE) or (
            entry_kind == "file" and file_n >= MAX_FILES_PER_MESSAGE
        ):
            degrade_lines.append(f"{row.original_name}：GET /api/file/{row.id}")
            continue
        if entry_kind == "image":
            image_n += 1
        else:
            file_n += 1
        candidates.append((row, entry_kind))

    # ── 阶段 2：资格条目并行「读源 + 存储」──每条独立兜错（失败返回 None，
    # 阶段 3 按原序降级）；storage 后端无共享会话态，gather 并发安全。
    async def _materialize_one(row: File, entry_kind: str) -> _PreparedPpmAttachment | None:
        # 读 file storage bytes（整体读入；单附件大小已在 file 中心上传侧受限）。
        try:
            data = b"".join([chunk async for chunk in backend.get_object_stream(row.stored_key)])
        except Exception as exc:
            _svc.log.warning(
                "session_ppm_attachment_read_failed",
                file_id=str(row.id),
                error=str(exc),
            )
            return None
        try:
            object_key, sha256 = await session_store.store_bytes(
                user_id=user_id,
                data=data,
                media_type=row.mime_type,
                name=row.original_name,
            )
        except Exception as exc:
            _svc.log.warning(
                "session_ppm_attachment_store_failed",
                file_id=str(row.id),
                error=str(exc),
            )
            return None
        return _PreparedPpmAttachment(
            kind=entry_kind,
            media_type=row.mime_type,
            bytes=len(data),
            name=row.original_name[:255],
            object_key=object_key,
            sha256=sha256,
        )

    io_results = await asyncio.gather(
        *(_materialize_one(row, entry_kind) for row, entry_kind in candidates)
    )

    # ── 阶段 3：按条目原序组装（IO 失败条目降级为 GET 链接）──
    prepared: list[_PreparedPpmAttachment] = []
    for (row, _entry_kind), result in zip(candidates, io_results, strict=True):
        if result is None:
            degrade_lines.append(f"{row.original_name}：GET /api/file/{row.id}")
            continue
        prepared.append(result)
    return degrade_lines, prepared


async def _converge_failed_dispatch(
    svc,
    *,
    session: AgentSession,
    run: AgentRun,
    lease_id: uuid.UUID,
    error: str,
) -> None:
    """Mark a freshly-committed triple as failed terminal (create_session offline path)."""
    now = datetime.now(UTC)
    try:
        run.status = "failed"
        run.finished_at = now
        run.error_code = "interactive_dispatch_offline"
        run.output_redacted = error
        svc._session.add(run)

        session.status = "failed"
        session.ended_at = now
        session.last_active_at = now
        svc._session.add(session)

        lease = await svc._session.get(DaemonTaskLease, lease_id)
        if lease is not None and lease.status not in ("completed", "cancelled", "expired"):
            lease.status = "completed"
            lease.updated_at = now
            svc._session.add(lease)

        await svc._session.commit()
        await svc._session.refresh(session)
        await svc._session.refresh(run)

        # task-02：status→failed 收敛已落库，发布列表变更信号（publish
        # 静默容错，不会改变本函数的错误收敛语义）。
        await _svc.publish_sessions_changed("status_changed", session.id, session.user_id)

        # task-09 / FR-04：failed 终态清理 ready 状态（commit 后事务外，
        # best-effort；内层 try 隔离 clear 异常，不影响外层 commit/refresh
        # 错误收敛分支）。session 无 session_id 形参，用 session.id。
        try:
            _svc.get_session_readiness().clear(session.id)
        except Exception:
            _svc.log.warning(
                "session_ready_clear_failed",
                session_id=str(session.id),
            )
    except Exception:
        await svc._session.rollback()
        _svc.log.warning(
            "session_failed_dispatch_convergence_failed",
            session_id=str(session.id),
            run_id=str(run.id),
            lease_id=str(lease_id),
        )
