"""PPM 物化 / 派发失败收敛 / tool_report 懒激活（task-08 拆分，原 :2223-2834）。

三个方法体下沉为模块函数（第一参数 svc），SessionService 类壳一行委托。
D-007：log / publish_sessions_changed / get_session_readiness /
_merge_lease_metadata 调用点经 ``_svc.`` 延迟解析。
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlmodel import col

import app.modules.daemon.session.service as _svc
from app.core.errors import AppError
from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession
from app.modules.agent.provider_caps import get_provider_caps
from app.modules.daemon.control_commands import KIND_SESSION_INJECT, ControlCommandService
from app.modules.daemon.model import DaemonTaskLease
from app.modules.daemon.runtime.service import DaemonRuntimeOffline
from app.modules.ppm.common.session_binding import PpmItemKind, load_item_files, load_ppm_item
from app.modules.ppm.problem.model import PpmProblemList
from app.modules.ppm.task.model import PlanTask

from .errors import (
    DaemonSessionConfigInvalid,
    DaemonSessionLlmProviderKindMismatch,
    DaemonSessionLlmProviderNotFound,
    DaemonSessionNotActive,
    ToolReportActivateNoDaemon,
)
from .helpers import _resolve_daemon_id_for_runtime
from .results import SessionDispatchResult, _PrelockedInjectAttachments, _PreparedPpmAttachment


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
    有权且 provider=claude 且与手动附件合并后 图≤5/文≤5 的条目读 file
    storage bytes → ``SessionAttachmentStorage.store_bytes``（内容寻址
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
      「无权访问」；超限 / provider≠claude / 读取失败（``read_failed``）/
      存储失败（``store_failed``）/ File 已删或缺号的有权条目 → 文件名 +
      ``GET /api/file/{file_id}`` 链接（软删/缺号行回查取文件名，查无以
      file_id 兜底）。
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
        # provider-abstraction task-11：引擎门控收敛查 ProviderCaps（multimodal
        # 键，与原 != "claude" 判定等价——不支持附件的引擎整条降级为链接）。
        if not get_provider_caps(provider)["multimodal"]:
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


async def _activate_tool_report_session(
    svc,
    session: AgentSession,
    user_id: uuid.UUID,
    *,
    prompt: str,
    # P1（2026-08-25 会话路径二审 #2）：切换字段 + 附件透传——原实现只透传
    # prompt，上游「带切换字段或附件豁免空 prompt」后空 prompt 被当首条消息
    # 建首轮，用户附件与切换要求被静默丢弃。现照 create_session 同款语义在
    # 激活事务内应用（校验错误同款：profile 404/403、provider 404/422）。
    agent_profile_id: str | None = None,
    llm_provider_id: str | None = None,
    attachment_ids: list[uuid.UUID] | None = None,
    # 二审 #1：inject_session 主路径取锁前预组装的附件产物（rows/payload/
    # gate 快照）；激活分支复用（gate 基准复核见下方组装段）。
    prelocked_attachments: _PrelockedInjectAttachments | None = None,
) -> SessionDispatchResult:
    """懒激活一个未绑定机器的 tool_report 会话（task-05 / design §3.3.4）。

    CLI 工具上报聚合出的会话（``origin='tool_report'``，platform_sync task-04
    创建，``status='pending'`` 且无 lease/runtime）在用户发首条消息继续时调用：
    复刻 :meth:`create_session` 的派发段——建首轮 AgentRun + interactive lease
    （**首条消息即首轮**，prompt 存 lease metadata）+ commit + 唤醒 daemon +
    best-effort SESSION_INJECT。与 create 的差异：

    - **机器选择（D-010 / Grill P1-2）**：不新增成员绑定预检，沿用
      ``prepare_interactive_dispatch`` 内部既有自选（用户自有 first-online +
      workspace shared 借用），与 create「仅 provider 入口」同语义。
    - **cwd**：最新关联 ``platform_agent_logs`` 行（``agent_session_id`` 匹配、
      ``last_seen_at`` 倒序取 1）的 ``agent_cwd``，缺省回落
      ``workspace.root_path``；都无 → None（不设，走普通 quick-chat 语义）。
    - **provider**：保持 task-04 创建时的 D-007 映射，不覆盖。
    - **无在线机器**：``NoOnlineDaemonError``（裸 Exception）转
      :class:`ToolReportActivateNoDaemon`（409 中文），不裸抛 500。
    - **配置/附件（2026-08-25 二审 #2）**：``agent_profile_id`` /
      ``llm_provider_id`` 照 create_session 语义落会话三列 + 首轮 run 快照 +
      lease metadata（``apply_session_profile_to_lease`` /
      ``session_llm_provider_id``）+ config_snapshot 展示键；空串 = "none"
      对未激活会话（本就 NULL）等价不动。附件走 inject 主路径同款机制：
      标记行进 user_input 日志 + draft→bound 回填 + SESSION_INJECT payload
      attachments 键。空 prompt 一律拒绝——daemon ``_startInteractiveSession``
      拒建空 prompt 会话（切换字段/附件必须随首条消息一起发送）。

    Caller（:meth:`inject_session`）已持会话行锁并完成归属校验（user_id 必须
    是会话属主）；本方法成功后直接返回首轮派发结果（不回落
    ``_inject_into_session``——激活已消费首条消息为首轮，再走 inject 会撞
    turn 冲突守卫）。
    """
    # 归档区禁写（2026-08-30 审计④-1）：激活分支在 inject_session 内先于
    # _inject_into_session（守卫所在）提前 return——预会话工作区已归档时，
    # 首条消息激活同样是在归档区建 run/lease 并派发执行，须与共享核心同拦。
    await svc._ensure_session_workspace_writable(session)
    from app.modules.agent.placement import (
        NoOnlineDaemonError,
        RunPlacementService,
    )
    from app.modules.platform_sync.model import AgentSessionLogORM

    # ── 二审 #2：激活分支输入守卫——空 prompt 一律拒绝 ─────────────────────
    # 上游对「带切换字段/附件」豁免空 prompt（ql-20260817-010 / D-7），但激活的
    # 首轮由 lease metadata prompt 驱动 daemon 建 SDK 会话——daemon
    # ``_startInteractiveSession`` 对空 prompt 直接拒建（SESSION_INJECT 路由
    # 同样丢弃空 prompt），空 prompt 激活会留下 pending 死轮。故激活必须携带
    # 首条消息；切换字段/附件随消息一起生效（不再静默丢弃，也不再误建空轮）。
    if not prompt.strip():
        raise DaemonSessionNotActive(
            "该会话尚未激活，请先发送一条消息启动会话（切换配置或附件需随消息一起发送）。",
            details={
                "session_id": str(session.id),
                "reason": "activation_requires_message",
            },
        )

    # ── 二审 #2：切换字段解析（校验口径与 create_session 逐字对齐）────────
    # agent_profile_id 空串 = "none" 取消档案：未激活会话本就 NULL，等价不动。
    profile = None
    if agent_profile_id:
        from app.modules.agent.profile.service import AgentProfileService
        from app.modules.auth.model import User as _User

        try:
            _profile_uuid = uuid.UUID(agent_profile_id)
        except (ValueError, AttributeError, TypeError) as exc:
            raise DaemonSessionConfigInvalid(
                f"Invalid agent_profile_id '{agent_profile_id}'.",
                details={"agent_profile_id": agent_profile_id},
            ) from exc
        _actor = await svc._session.get(_User, user_id)
        if _actor is None:
            raise DaemonSessionConfigInvalid(
                "Session owner user not found.",
                details={"user_id": str(user_id)},
            )
        # 读可见性与 GET /agent-profiles?scope=mine 同口径（同 create/inject）。
        profile = await AgentProfileService(svc._session).get(
            profile_id=_profile_uuid, actor=_actor
        )

    # llm_provider_id 空串 = "none" 清空：未激活会话本就 NULL，等价不动。
    llm_provider_row = None
    if llm_provider_id:
        from app.modules.llm_provider.model import LlmProvider

        try:
            _provider_uuid = uuid.UUID(llm_provider_id)
        except (ValueError, AttributeError, TypeError) as exc:
            raise DaemonSessionConfigInvalid(
                f"Invalid llm_provider_id '{llm_provider_id}'.",
                details={"llm_provider_id": llm_provider_id},
            ) from exc
        llm_provider_row = await svc._session.get(LlmProvider, _provider_uuid)
        # 归属按会话属主（激活注入者即属主，inject_session 已过归属校验）。
        if llm_provider_row is None or llm_provider_row.user_id != user_id:
            raise DaemonSessionLlmProviderNotFound(
                f"LlmProvider '{llm_provider_id}' not found.",
                details={"llm_provider_id": llm_provider_id},
            )
        # FR-06：agent_kind 与会话引擎不匹配 → 422，不静默降级（同 create）。
        if llm_provider_row.agent_kind != session.provider:
            raise DaemonSessionLlmProviderKindMismatch(
                "LlmProvider agent_kind does not match the session engine.",
                details={
                    "llm_provider_id": llm_provider_id,
                    "agent_kind": llm_provider_row.agent_kind,
                    "engine": session.provider,
                },
            )

    # ── 二审 #1/#2：附件解析（预组装复用 / 无预组装兜底，口径同主路径）────
    validated_attachments: list = []
    inject_attachments: list[dict] = []
    if attachment_ids:
        if prelocked_attachments is not None:
            validated_attachments = list(prelocked_attachments.rows)
            # gate 基准复核（对齐 _inject_into_session 组装段）：激活事务内
            # 会话供应商将被本轮参数改写（llm_provider_row.id 或保持 NULL），
            # 与预组装基准一致且引擎不变 → 复用锁外产物；漂移且 supports
            # 翻转 → 锁内重解析重组装（罕见竞态兜底）。
            gate_basis = llm_provider_row.id if llm_provider_row is not None else None
            if (
                prelocked_attachments.gate_provider_id_basis == gate_basis
                and prelocked_attachments.agent_kind == session.provider
            ):
                inject_attachments = list(prelocked_attachments.inject_attachments)
            else:
                supports = await svc._resolve_inject_gate(
                    user_id=session.user_id,
                    gate_provider_id_basis=gate_basis,
                    agent_kind=session.provider or "",
                )
                if supports == prelocked_attachments.gate_supports_multimodal:
                    inject_attachments = list(prelocked_attachments.inject_attachments)
                else:
                    inject_attachments = await svc._assemble_inject_attachment_payload(
                        validated_attachments, supports_multimodal=supports
                    )
        else:
            validated_attachments = await svc._validate_inject_attachment_rows(
                session_id=session.id,
                session_user_id=session.user_id,
                session_provider=session.provider or "",
                attachment_ids=attachment_ids,
            )
            supports = await svc._resolve_inject_gate(
                user_id=session.user_id,
                gate_provider_id_basis=(
                    llm_provider_row.id if llm_provider_row is not None else None
                ),
                agent_kind=session.provider or "",
            )
            inject_attachments = await svc._assemble_inject_attachment_payload(
                validated_attachments, supports_multimodal=supports
            )

    now = datetime.now(UTC)
    # ── cwd 解析（design §3.3.4 第 2 点）：最新关联 entry.agent_cwd 优先，
    # 回落 workspace.root_path；两者皆无 → None 不设（cwd 可空）。
    cwd: str | None = None
    latest_entry = (
        await svc._session.execute(
            select(AgentSessionLogORM.agent_cwd)
            .where(col(AgentSessionLogORM.agent_session_id) == session.id)
            .order_by(col(AgentSessionLogORM.last_seen_at).desc().nulls_last())
            .limit(1)
        )
    ).first()
    if latest_entry is not None and latest_entry[0]:
        cwd = latest_entry[0]
    if cwd is None and session.workspace_id is not None:
        from app.modules.workspace.model import Workspace

        ws_row = await svc._session.get(Workspace, session.workspace_id)
        if ws_row is not None:
            cwd = ws_row.root_path

    model = (session.config or {}).get("model")
    try:
        # 首轮 run（对齐 create_session :876-894；首轮发送者=激活注入者，
        # 即会话属主——inject_session 已过 _get_owned_session_for_update）。
        # 二审 #2：切换字段照 create_session 落首轮快照（D-008）。
        from app.modules.agent.service import _build_agent_profile_snapshot

        run = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            provider=session.provider,
            model=model,
            status="pending",
            spec_strategy="interactive",
            agent_session_id=session.id,
            user_id=user_id,
            agent_profile_id=profile.id if profile is not None else None,
            agent_profile_snapshot=(
                _build_agent_profile_snapshot(profile) if profile is not None else None
            ),
            llm_provider_id=(llm_provider_row.id if llm_provider_row is not None else None),
        )
        svc._session.add(run)
        await svc._session.flush()

        placement = RunPlacementService(svc._session)
        try:
            dispatch = await placement.prepare_interactive_dispatch(
                agent_session_id=session.id,
                agent_run_id=run.id,
                user_id=user_id,
                provider=session.provider,
                prompt=prompt,
                model=model,
                workspace_id=session.workspace_id,
                cwd=cwd,
            )
        except NoOnlineDaemonError as exc:
            # 裸 Exception → 409 中文 AppError（不裸抛 500，design §3.3.4 第 6 点）。
            raise ToolReportActivateNoDaemon(
                "当前没有可用的在线守护进程，无法继续该会话",
                details={"session_id": str(session.id)},
            ) from exc

        # ── 二审 #1：附件 draft→bound 回填（同事务，唯一前进迁移）──────────
        for att_row in validated_attachments:
            if att_row.session_id is None:
                att_row.session_id = session.id
                svc._session.add(att_row)

        # ── 二审 #2：切换字段落 lease metadata（同 create_session 口径）────
        # 档案：system_prompt + mcp/skill 维度键（apply_session_profile_to_lease
        # 非 commit 变体）；供应商：独立 key session_llm_provider_id（claim 端
        # _inject_provider_config 最高优先级分支消费）。
        if profile is not None:
            from app.modules.agent.service import AgentService

            await AgentService(svc._session).apply_session_profile_to_lease(
                dispatch.lease_id, profile
            )
        if llm_provider_row is not None:
            await _svc._merge_lease_metadata(
                svc._session,
                dispatch.lease_id,
                {"session_llm_provider_id": str(llm_provider_row.id)},
            )

        # 回填三元组 + 激活（对齐 create_session :954-958：turn_count 置 1，
        # 首条消息即首轮）。二审 #2：会话配置三列 + config_snapshot 展示键
        # （profile_name/provider_name/model，仅选中才写；machine/agent 名
        # 为既有必写键）。
        session.runtime_id = dispatch.runtime_id
        session.lease_id = dispatch.lease_id
        session.status = "active"
        session.turn_count = 1
        session.last_active_at = now
        if cwd is not None:
            session.cwd = cwd
        session.agent_profile_id = profile.id if profile is not None else None
        session.llm_provider_id = llm_provider_row.id if llm_provider_row is not None else None
        # config_snapshot 补 machine_name/agent_name（design §3.3.4 第 4 点，
        # 展示用）：保留 task-04 写入的 harness 等既有键。
        machine_name, agent_name = await svc._resolve_runtime_labels(dispatch.runtime_id)
        snapshot = dict(session.config_snapshot or {})
        snapshot["machine_name"] = machine_name
        snapshot["agent_name"] = agent_name
        if profile is not None or llm_provider_row is not None:
            snapshot["profile_name"] = profile.name if profile is not None else None
            snapshot["provider_name"] = (
                llm_provider_row.name if llm_provider_row is not None else None
            )
            snapshot["model"] = (
                (llm_provider_row.model or llm_provider_row.default_fallback_model)
                if llm_provider_row is not None
                else None
            )
            snapshot["engine"] = session.provider
        session.config_snapshot = snapshot
        svc._session.add(session)

        # 首 turn user_input 日志（对齐 create_session :986-993，列表标题派生
        # 与历史回放依赖该行）。二审 #2：附件标记行插头部（D-3，口径与
        # _inject_into_session 主路径一致——[附件:id|kind|name] 逐附件一行）。
        user_input_content = prompt
        if validated_attachments:
            from app.modules.session_attachment.service import (
                attachment_marker_line,
            )

            marker_lines = "\n".join(attachment_marker_line(r) for r in validated_attachments)
            user_input_content = f"{marker_lines}\n{prompt}" if prompt else marker_lines
        svc._session.add(
            AgentRunLog(
                run_id=run.id,
                channel="user_input",
                content_redacted=user_input_content[:5000],
                timestamp=now,
            )
        )
        await svc._session.commit()
        await svc._session.refresh(session)
        await svc._session.refresh(run)
    except AppError:
        await svc._session.rollback()
        raise
    except Exception:
        await svc._session.rollback()
        raise

    # task-02：status→active（CLI 会话懒激活）已随上方 commit 落库，发布
    # 列表变更信号（created 由 platform_sync 插入分支负责，此处只发激活）。
    await _svc.publish_sessions_changed("status_changed", session.id, session.user_id)

    # commit 成功 → 唤醒 daemon（对齐 create_session :1001-1020：失败收敛
    # 刚提交的三元组为 failed 终态后抛 DaemonRuntimeOffline）。
    delivered = await placement.notify_interactive_dispatch(dispatch)
    if not delivered:
        await svc._converge_failed_dispatch(
            session=session,
            run=run,
            lease_id=dispatch.lease_id,
            error="interactive dispatch wake-up failed (daemon offline)",
        )
        raise DaemonRuntimeOffline(
            "执行代理当前不在线，会话无法启动。请确认本机 daemon 进程已运行"
            "（任务栏/终端 sillyhub-daemon），重启后重试；若刚重启请等几秒再试。",
            details={
                "runtime_id": str(dispatch.runtime_id),
                "session_id": str(session.id),
                "run_id": str(run.id),
            },
        )

    # best-effort SESSION_INJECT 携带首条消息（对齐 create_session 主路径：
    # task-04（design A2）三段式——WS 失败落库 pending 待补拉）。
    # ql-20260904-016：与 create_session 同步去掉 timeout=8 的原地 ready 死等
    # ——早到 inject 由 daemon 60s park 窗口 + 补拉 + firstPrompt fallback 兜底。
    daemon_id = await _resolve_daemon_id_for_runtime(svc._session, dispatch.runtime_id)
    control_ok = False
    if daemon_id is not None:
        inject_payload = {
            "session_id": str(session.id),
            "lease_id": str(dispatch.lease_id),
            "run_id": str(run.id),
            "prompt": prompt,
            # gap-2：首 turn SESSION_INJECT 携带 lease 级 claim_token。
            "claim_token": dispatch.claim_token,
            "runtime_id": str(dispatch.runtime_id),
        }
        # 二审 #2：附件随激活首轮下发（D-4，同主路径 inject——仅在有附件时
        # 附加，旧 daemon 忽略未知键，协议向后兼容）。
        if inject_attachments:
            inject_payload["attachments"] = inject_attachments
        _row, control_ok = await ControlCommandService(svc._session).enqueue_and_push(
            daemon_id=daemon_id,
            runtime_id=dispatch.runtime_id,
            kind=KIND_SESSION_INJECT,
            payload=inject_payload,
        )
    if not control_ok:
        # 唤醒已送达但控制消息发送失败：daemon 仍会 claim lease（metadata 含
        # prompt），不因控制消息失败判定会话失败，仅留观测日志（对齐 create）。
        _svc.log.warning(
            "tool_report_activation_control_send_failed",
            session_id=str(session.id),
            run_id=str(run.id),
            runtime_id=str(dispatch.runtime_id),
        )

    await svc._publish_session_event(
        session.id,
        {"event": "session_created", "session_id": str(session.id), "run_id": str(run.id)},
    )
    return SessionDispatchResult(
        agent_session=session,
        agent_run=run,
        lease_id=dispatch.lease_id,
    )
