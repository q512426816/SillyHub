"""RunPlacementService -- unified decision layer for agent run execution backend.

Decides whether an AgentRun should execute on the server (subprocess) or be
dispatched to a local daemon.  The daemon tables (daemon_runtimes,
daemon_task_leases) are created by the daemon module (task-01 / task-02);
this service uses raw SQL via ``text()`` so it works even before the ORM
models land.
"""

from __future__ import annotations

import enum
import json
import secrets
import uuid
from dataclasses import dataclass
from datetime import UTC, datetime

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.modules.agent.borrow_resolver import _resolve_borrowed_or_own_runtime
from app.modules.daemon.session_events import publish_sessions_changed

log = get_logger(__name__)


# ``_borrowed`` / ``_lender_user_id``：runtime dict 上的借用标记私有键（D-008@v1 /
# task-06 provides BorrowedLeaseFlag）。``_resolve_dispatch_runtime`` 解析出借用
# runtime 时把这两个键塞进 dict，调用方（``dispatch_to_daemon`` /
# ``prepare_scan_interactive_dispatch``）读出后写进 lease metadata，供 task-09 沙箱 +
# task-10 落 file 判别。前缀下划线 = transport-only，不进 lease metadata 原始键名。
_BORROWED_FLAG_KEY = "_borrowed"
_LENDER_USER_ID_KEY = "_lender_user_id"


def _stamp_borrowed_flag(rt: dict, borrowed: bool, lender: uuid.UUID | None) -> dict:
    """Mark borrowed/lender on a resolved runtime dict (D-008@v1 / task-06).

    ``_resolve_dispatch_runtime`` 在借用兜底命中时调用：把 ``_borrowed=True`` +
    ``_lender_user_id=<str>`` 塞进 runtime dict，让消费方（``dispatch_to_daemon`` /
    ``prepare_scan_interactive_dispatch``）读出后写进 lease metadata（task-06
    provides BorrowedLeaseFlag，供 task-09 沙箱 + task-10 落 file 判别）。

    自有路径（``borrowed=False``）不写任何标记 → 零回归（消费方读不到键 = 自有）。
    """
    if borrowed:
        rt[_BORROWED_FLAG_KEY] = True
        if lender is not None:
            rt[_LENDER_USER_ID_KEY] = str(lender)
    return rt


def _pop_borrowed_flag(rt: dict) -> tuple[bool, str | None]:
    """Read + remove the stashed borrowed/lender markers from a runtime dict.

    消费方（``dispatch_to_daemon`` / ``prepare_scan_interactive_dispatch``）在拿到
    ``_resolve_dispatch_runtime`` 返回的 runtime dict 后调用本函数取出（并清除）借用
    标记，写进 lease metadata。返回 ``(borrowed, lender_user_id_str)``；自有路径
    返回 ``(False, None)``。
    """
    borrowed = bool(rt.pop(_BORROWED_FLAG_KEY, False))
    lender_str: str | None = rt.pop(_LENDER_USER_ID_KEY, None)
    return borrowed, lender_str


# task-09 / D-007@v2（候选 B 主路径）：借用 lease 沙箱隔离 marker + slug 构造。
#
# daemon 不自动隔离借用任务（agent cwd 直接取 lease rootPath，daemon.ts:2723）。
# backend 派发借用 lease 时必须显式让 daemon 走独立沙箱：
#   - slug ``borrow-<actor>-<run>``（design §5 Phase 4）→ daemon 侧 ``prepareWorkspace``
#     mirror by slug 创建空目录（workspace.ts:118-160 分支 3）作 agent cwd。
#   - daemon ``_startInteractiveSession`` 检测 rootPath 上的 ``_BORROW_SANDBOX_MARKER``
#     前缀（``borrow-sandbox:<slug>``）→ 切沙箱 cwd + 调 SessionManager.registerBorrowSandbox
#     激活按 lease 隔离的只读 policy（session-manager.ts PolicyEngine 不命中 lender 缓存）。
#
# marker 走 ``metadata.cwd`` 字段：``build_claim_payload``（context.py:92）已有
# ``payload.root_path = lease_meta.cwd or root_path`` 透传链路，marker 借此搭车到 daemon，
# **无需改 context.py**（task-09 allowed_paths 不含 context.py）。daemon 解析 marker 后
# cwd 落到真实沙箱目录，marker 字符串本身不进真实文件系统路径。
_BORROW_SANDBOX_MARKER = "borrow-sandbox:"


def _make_borrow_sandbox_slug(actor_user_id: uuid.UUID, run_id: uuid.UUID) -> str:
    """构造借用沙箱目录 slug（``borrow-<actor>-<run>``，design §5 Phase 4）。

    actor + run_id 双段确保全局唯一（同一 actor 多次借用 / 跨 actor 不撞目录）。
    各取 hex 前 8 位缩减目录名长度（完整 32 位 hex 冗长；8 位 = 32 bit 已足够区分）。
    daemon 侧 ``prepareWorkspace(slug)`` 用此 slug 作 mirror 目录名。
    """
    return f"borrow-{actor_user_id.hex[:8]}-{run_id.hex[:8]}"


def _stamp_borrow_sandbox_metadata(
    metadata: dict,
    actor_user_id: uuid.UUID,
    run_id: uuid.UUID,
) -> str:
    """借用 lease 写沙箱 slug + cwd marker（task-09 / D-007@v2）。

    写入两字段：
      - ``borrow_sandbox_slug``：干净 slug（供 task-10 落 file / 审计 / observability 直接读，
        不需解析 marker）；
      - ``cwd`` = ``_BORROW_SANDBOX_MARKER + slug``：marker 协议串，借
        ``build_claim_payload`` 既有 cwd→root_path 透传链路带给 daemon（避免改 context.py）。

    本函数**覆盖**调用方此前写入的 ``metadata.cwd``（借用场景 cwd 必须是沙箱 marker，
    不能是 lender 代码路径——否则 daemon 用 lender 代码作 cwd，PolicyEngine 按 lease
    隔离失效）。

    Returns:
        构造的 slug（调用方可记日志）。
    """
    slug = _make_borrow_sandbox_slug(actor_user_id, run_id)
    metadata["borrow_sandbox_slug"] = slug
    metadata["cwd"] = _BORROW_SANDBOX_MARKER + slug
    return slug


def _runtime_daemon_instance_id(runtime: dict) -> uuid.UUID:
    """从 resolved runtime dict 抽 daemon_instance_id（task-11 审计写入用）。

    runtime dict shape = ``{id, user_id, provider, status, daemon_instance_id}``
    （placement.py:793 / queries.py:78）。借用路（resolve_shared_daemon_for_borrow →
    query_runtime_by_daemon_and_provider）的 daemon_instance_id 必非空（SQL select 该列）。
    SQLite 返回 CHAR(32) hex、PG 返 uuid.UUID，统一规范化。
    """
    raw = runtime.get("daemon_instance_id")
    if isinstance(raw, str):
        return uuid.UUID(raw)
    if isinstance(raw, uuid.UUID):
        return raw
    # 借用路不应命中（daemon_instance_id 在 select 列），防御性兜底用 runtime_id。
    rid = runtime["id"]
    return uuid.UUID(rid) if isinstance(rid, str) else rid


async def _insert_borrow_audit_row(
    session: AsyncSession,
    *,
    borrower_user_id: uuid.UUID,
    lender_user_id: uuid.UUID,
    daemon_instance_id: uuid.UUID,
    workspace_id: uuid.UUID,
    agent_run_id: uuid.UUID,
) -> None:
    """显式 INSERT 一条 daemon_borrow_audit 审计行（task-11 / FR-07 / D-004@v1）。

    借用 lease 创建时调用：每次借用落一行，D-004 仅审计不限额。usage_summary 在
    run 完成回调（AgentService.persist_borrow_run_output）补基础字段。

    **显式 INSERT 不靠 audit_hooks**（知识条目 daemon-usage-submit-chain / audit_hooks
    只在测试 lifespan 注册，生产要业务代码显式写）。失败仅记日志不抛——审计写入不得
    阻断借用派发（借用 lease 已建，审计失败属 best-effort，对齐 stage sync 范式）。

    raw SQL 而非 ORM：DaemonBorrowAudit model 在 agent/model.py，但本模块仅 import
    text()，沿用 placement.py 全程 raw SQL 风格，避免 model import 循环。SQLite 用
    hex 绑定、PG Uuid 列同样接受（对齐 lease INSERT 范式 :396）。
    """
    now = datetime.now(UTC)
    try:
        await session.execute(
            text(
                """
                INSERT INTO daemon_borrow_audit
                    (id, borrower_user_id, lender_user_id, daemon_instance_id,
                     workspace_id, agent_run_id, borrowed_at, usage_summary)
                VALUES
                    (:id, :borrower, :lender, :daemon, :ws, :run, :now, NULL)
                """
            ),
            {
                "id": uuid.uuid4().hex,
                "borrower": borrower_user_id.hex,
                "lender": lender_user_id.hex,
                "daemon": daemon_instance_id.hex,
                "ws": workspace_id.hex,
                "run": agent_run_id.hex,
                "now": now,
            },
        )
    except Exception as exc:
        log.warning(
            "borrow_audit_insert_failed",
            borrower_user_id=str(borrower_user_id),
            lender_user_id=str(lender_user_id),
            agent_run_id=str(agent_run_id),
            error=str(exc),
        )


# ---------------------------------------------------------------------------
# Public types
# ---------------------------------------------------------------------------


class ExecutionBackend(enum.Enum):
    """Where an AgentRun will be executed."""

    DAEMON = "daemon"  # local daemon mode


class NoOnlineDaemonError(Exception):
    """无在线 daemon，SERVER 路径已删除，无法执行 AgentRun。

    上层（AgentService 三处 dispatch 入口）捕获后：
    - 置 AgentRun.status = "failed"
    - AgentRun.error_code = "no_online_daemon"
    - AgentRun.output_redacted = "未检测到在线 daemon，请启动 sillyhub-daemon 后重试"

    task-03 (change 2026-06-18-workspace-client-path): daemon-client workspace
    绑定的 daemon 离线/不存在时，``runtime_id`` 携带目标运行时 id，
    默认 message 升级为「目标 daemon（{runtime_id}）离线，请启动...」，便于
    前端直接展示（D-001@v1 / FR-02 UX）。
    """

    def __init__(
        self,
        *,
        workspace_id: uuid.UUID | None = None,
        user_id: uuid.UUID,
        runtime_id: uuid.UUID | None = None,
        message: str | None = None,
    ) -> None:
        if user_id is None:
            raise TypeError("NoOnlineDaemonError requires user_id")
        self.workspace_id = workspace_id
        self.user_id = user_id
        self.runtime_id = runtime_id
        if message is None:
            if runtime_id is not None:
                message = f"目标 daemon（{runtime_id}）离线，请启动 sillyhub-daemon 后重试"
            else:
                message = "未检测到在线 daemon，请启动 sillyhub-daemon 后重试"
        self.message = message
        super().__init__(message)


# ---------------------------------------------------------------------------
# Service
# ---------------------------------------------------------------------------


class RunPlacementService:
    """Unified entry point that decides *where* an AgentRun executes."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ------------------------------------------------------------------
    # Decision
    # ------------------------------------------------------------------

    async def decide_backend(
        self,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        change_id: uuid.UUID | None = None,
        task_id: uuid.UUID | None = None,
        preferred_backend: str | None = None,
    ) -> ExecutionBackend:
        """Decide which backend should execute the upcoming AgentRun.

        Daemon-Only (task-01): the SERVER subprocess backend has been removed.
        This method now either returns ``ExecutionBackend.DAEMON`` (when an
        online daemon runtime exists) or raises ``NoOnlineDaemonError``.

        The ``preferred_backend`` parameter is retained for signature
        compatibility. Passing ``"server"`` is no longer supported and raises
        ``NoOnlineDaemonError``; any other value is ignored (daemon-only path).
        """
        log.info(
            "placement_decide_backend",
            workspace_id=str(workspace_id),
            user_id=str(user_id),
            change_id=str(change_id),
            task_id=str(task_id),
            preferred_backend=preferred_backend,
        )

        # SERVER backend removed (task-01); explicit "server" request is rejected.
        if preferred_backend is not None:
            pref = preferred_backend.lower().strip()
            if pref == "server":
                raise NoOnlineDaemonError(workspace_id=workspace_id, user_id=user_id)
            if pref != "daemon":
                log.warning(
                    "placement_unknown_preferred_backend",
                    preferred_backend=preferred_backend,
                )

        # task-03 (FR-02 / D-001@v1)：daemon-client workspace 强绑路由——
        # 校验 per-member binding 绑定的 daemon 是否在线且属于 user。避免「decide
        # 通过但 dispatch 抛错」的语义割裂（design §4.6 推荐方案）。
        # D-007@2026-07-10（remove-server-local-workspace-mode）：server-local 列删除后
        # 所有 workspace 永远 daemon-client，无 binding 行即未绑定，直接抛
        # NoOnlineDaemonError（不再回退 user 级 _get_online_runtime 兜底）。
        bound_rt = await self._resolve_decide_runtime(workspace_id=workspace_id, user_id=user_id)

        # daemon-client: bound_rt 已校验在线且属于 user。
        log.info(
            "placement_backend_daemon_client_bound",
            backend="daemon",
            runtime_id=str(bound_rt["id"]),
        )
        return ExecutionBackend.DAEMON

    # ------------------------------------------------------------------
    # Dispatch helpers
    # ------------------------------------------------------------------

    async def dispatch_to_daemon(
        self,
        agent_run_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        # task-03 (2026-06-18-workspace-client-path) / D-007@2026-07-10：
        # workspace 标识，所有 workspace 永远 daemon-client，按 per-member
        # binding 强绑路由；None 走上层 decide_backend 抛 NoOnlineDaemonError。
        workspace_id: uuid.UUID | None = None,
        # 通用字段（design §7.2）
        provider: str | None = None,
        model: str | None = None,
        prompt: str | None = None,
        resume_session_id: str | None = None,
        repo_url: str | None = None,
        branch: str | None = None,
        allowed_paths: list[str] | None = None,
        tool_config: dict | None = None,
        timeout_seconds: int | None = None,
        # stage run 专用（R-stage）
        step_prompt: str | None = None,
        stage: str | None = None,
        read_only: bool | None = None,
        # scan run 专用（R-stage）
        root_path: str | None = None,
        spec_root: str | None = None,
        runtime_root: str | None = None,
        # ql-20260617-009：workspace 标识（daemon 用 root_path 作真实 cwd 时仍需
        # slug 兜底 mirror，name 仅作日志可读性）。
        workspace_name: str | None = None,
        workspace_slug: str | None = None,
        # task-05（2026-08-02-agent-profile-layer / D-014）：run 绑定的 AgentProfile id。
        # 由上层 task-06 service.py 经 design §8 兜底链解析后传入；非空时其 provider
        # 优先作 target_provider（不改 daemon 选择顺序，binding 仍为唯一真相源）。
        # None = 未绑 profile，**零新增查询**（C-07），走原 workspace.default_agent 路径。
        agent_profile_id: uuid.UUID | None = None,
        # task-03（2026-08-19-cross-workspace-team-mission / design §4.2）：
        # representative_fallback 旗标，控制 worker 派发（target≠anchor）时本人无 binding
        # 的行为。True 走代表 binding（owner 优先→任意在线→None 抛错），False 维持 borrow
        # 兜底（零回归）。由 execution.py 根据派发场景传入，默认 False 保持向后兼容。
        representative_fallback: bool = False,
    ) -> uuid.UUID | None:
        """Dispatch an AgentRun to the user's daemon.

        所有上下文参数（除 CLAUDE.md，design §Phase 2 第 111 行）持久化到
        ``daemon_task_leases.metadata`` JSON 列。daemon 通过
        ``_build_claim_payload``（初始 claim）和 ``GET execution-context``
        （fetch，task-02/task-05）读取。

        守卫规则：
        - 真值字段用 ``if x:``（None / 空串 / 空 list 不写入）；
        - ``read_only`` / ``timeout_seconds`` 用 ``is not None``，避免
          ``False`` / ``0`` 被吞（R-stage 显式 false 必须持久化）。

        Returns lease_id，或 None（无在线 runtime——task-01 后此情况由
        decide_backend 抛 NoOnlineDaemonError，此处保留 None 兜底）。
        """
        runtime = await self._resolve_dispatch_runtime(
            workspace_id=workspace_id,
            user_id=user_id,
            provider=provider,
            agent_profile_id=agent_profile_id,
            representative_fallback=representative_fallback,
        )
        if runtime is None:
            log.warning(
                "dispatch_daemon_no_online_runtime",
                agent_run_id=str(agent_run_id),
                user_id=str(user_id),
            )
            return None

        # D-008@v1（task-06 provides BorrowedLeaseFlag）：从 runtime dict 取出借用标记
        # （_resolve_dispatch_runtime 借用兜底命中时塞入），稍后写进 lease metadata。
        # 自有路径返回 (False, None) → 不写标记，零回归。
        borrowed, lender_user_id_str = _pop_borrowed_flag(runtime)

        # raw SQL 返回的 id 在 SQLite 是 CHAR(32) hex string、在 PostgreSQL 是
        # UUID 对象；统一标准化为 uuid.UUID，供后续 .hex / str() / WS hub 使用。
        rid_raw = runtime["id"]
        runtime_id: uuid.UUID = uuid.UUID(rid_raw) if isinstance(rid_raw, str) else rid_raw

        lease_id = uuid.uuid4()
        now = datetime.now(UTC)
        metadata: dict = {}
        # 通用字段（design §7.2）
        if prompt:
            metadata["prompt"] = prompt
        if provider:
            metadata["provider"] = provider
        if model:
            metadata["model"] = model
        if resume_session_id:
            metadata["resume_session_id"] = resume_session_id
        if repo_url:
            metadata["repo_url"] = repo_url
        if branch:
            metadata["branch"] = branch
        if allowed_paths:
            metadata["allowed_paths"] = allowed_paths
        if tool_config:
            metadata["tool_config"] = tool_config
        if timeout_seconds is not None:
            metadata["timeout_seconds"] = timeout_seconds
        # stage run 专用（R-stage 应对）
        if step_prompt:
            metadata["step_prompt"] = step_prompt
        if stage:
            metadata["stage"] = stage
        if read_only is not None:
            metadata["read_only"] = read_only
        # scan run 专用（R-stage 应对）
        if root_path:
            metadata["root_path"] = root_path
        if spec_root:
            metadata["spec_root"] = spec_root
        if runtime_root:
            metadata["runtime_root"] = runtime_root
        # ql-20260617-009：workspace 标识透传给 daemon（_build_claim_payload + execution-context 均消费）
        if workspace_name:
            metadata["workspace_name"] = workspace_name
        if workspace_slug:
            metadata["workspace_slug"] = workspace_slug
        # 2026-07-08 D-001：所有 stage 统一 scan 模式（manual_approval=True +
        # ask_user_only=True）。AskUserQuestion 走 dialog 人审，其余工具 allow-through，
        # 消除 5min 超时。stage 走 dispatch_to_daemon（非 prepare_interactive_dispatch），
        # 此处补设（task-01 修正：原改 prepare_interactive_dispatch 但 stage 不走那）。
        metadata["manual_approval"] = True
        metadata["ask_user_only"] = True
        # task-08（security-audit-remediation D-005@v1）：归属锚点——quick-chat
        # 读/杀端点按 lease.agent_run_id → metadata.actor_user_id 链过滤非本人
        # 访问（main.py _assert_quick_chat_run_owner）。agent_runs.lease_id 列
        # 不可用作锚点（FK→worktree_leases，写 daemon lease id 即
        # ForeignKeyViolation，见 service.py:1729 注释），反向链锚点 = 本
        # lease 行的 agent_run_id 列。
        metadata["actor_user_id"] = str(user_id)

        # D-008@v1（task-06 provides BorrowedLeaseFlag）：借用 lease 标记 borrowed=True
        # + lender_user_id，供 task-09 沙箱（按 lease 隔离只读 root_path）+ task-10 落 file
        # 判别（owner_type=workspace 落点）。自有路径不写（零回归）。
        if borrowed:
            metadata["borrowed"] = True
            if lender_user_id_str:
                metadata["lender_user_id"] = lender_user_id_str
            # task-09 / D-007@v2（候选 B 主路径）：借用 lease cwd 必须是独立沙箱 marker，
            # 不能是 lender 代码 rootPath（否则 daemon 用 lender 代码作 cwd + PolicyEngine
            # 按 lease 隔离失效 → 借用 agent 可写开发代码区）。marker 借 build_claim_payload
            # 既有 cwd→root_path 透传带给 daemon，无需改 context.py。
            _stamp_borrow_sandbox_metadata(metadata, user_id, agent_run_id)
            # task-11 / FR-07 / D-004@v1：显式写 daemon_borrow_audit 审计行（不限额）。
            # 借用必然 workspace-scoped（AC7：无 workspace_id 不借用），故 workspace_id 非空。
            if workspace_id is not None:
                await _insert_borrow_audit_row(
                    self._session,
                    borrower_user_id=user_id,
                    lender_user_id=uuid.UUID(lender_user_id_str),
                    daemon_instance_id=_runtime_daemon_instance_id(runtime),
                    workspace_id=workspace_id,
                    agent_run_id=agent_run_id,
                )

        # 2026-07-08：interactive lease 必须带 session_id + run_id（daemon
        # _startInteractiveSession 缺这两个字段会 interactive_missing_fields 早返回）。
        # dispatch_to_daemon 原来走 batch 不需要这些；改 kind=interactive 后必须补。
        # 同时创建 AgentSession 行让 UI 会话列表能看到。
        interactive_session_id = uuid.uuid4()
        if "session_id" not in metadata:
            metadata["session_id"] = str(interactive_session_id)
        if "run_id" not in metadata:
            metadata["run_id"] = str(agent_run_id)

        await self._session.execute(
            text(
                """
                INSERT INTO daemon_task_leases
                    (id, agent_run_id, runtime_id, status, kind, metadata, created_at, updated_at)
                VALUES
                    (:id, :agent_run_id, :runtime_id, 'pending', 'interactive', :metadata, :now, :now)
                """
            ),
            {
                # SQLAlchemy ``Uuid`` 在 SQLite 以 CHAR(32) hex 存储；用 .hex
                # 绑定参数（无连字符），PostgreSQL Uuid 列同样接受该形式。
                "id": lease_id.hex,
                "agent_run_id": agent_run_id.hex,
                "runtime_id": runtime_id.hex,
                "metadata": json.dumps(metadata) if metadata else None,
                "now": now,
            },
        )

        # AgentSession 必须在 lease INSERT 之后（FK lease_id → daemon_task_leases.id）
        # config.manual_approval=True 是 backend permission_service.py:320 放行
        # PERMISSION_REQUEST（AskUserQuestion）的硬门控；缺它则 agent 提问被吞、前端
        # 收不到、agent 死等。对齐 scan（agent/service.py:1645）/ interactive
        # （session/service.py:488）的 config shape。ask_user_only=True 与 lease.metadata
        # 同名键语义一致（只 AskUserQuestion 阻塞，其他工具 allow-through）。
        stage_session_config = json.dumps(
            {
                "manual_approval": True,
                "ask_user_only": True,
            }
        )
        await self._session.execute(
            text(
                """
                INSERT INTO agent_sessions
                    (id, user_id, runtime_id, lease_id, provider, status, turn_count, config, created_at)
                VALUES
                    (:sid, :user_id, :runtime_id, :lease_id, :provider, 'pending', 0, :config, :now)
                """
            ),
            {
                "sid": interactive_session_id.hex,
                "user_id": user_id.hex if hasattr(user_id, "hex") else str(user_id),
                "runtime_id": runtime_id.hex,
                "lease_id": lease_id.hex,
                "provider": provider or "claude",
                "config": stage_session_config,
                "now": now,
            },
        )
        # 关联 AgentRun → AgentSession
        await self._session.execute(
            text("UPDATE agent_runs SET agent_session_id = :sid WHERE id = :rid"),
            {"sid": str(interactive_session_id), "rid": agent_run_id.hex},
        )
        await self._session.commit()

        # task-03（design §3 生命周期契约表）：stage 会话 raw INSERT 落库后广播
        # created（列表出现新行）。user_id 从插入参数取；非 UUID 形态（绑定层已
        # 兜 str 的防御分支）取不到则不发。publish 内部静默容错。
        if isinstance(user_id, uuid.UUID):
            await publish_sessions_changed("created", interactive_session_id, user_id)

        log.info(
            "dispatch_daemon_lease_created",
            lease_id=str(lease_id),
            agent_run_id=str(agent_run_id),
            runtime_id=str(runtime_id),
        )

        # -- Wave 2: WS wake-up signal (stub) -----------------------------------
        did_raw = runtime.get("daemon_instance_id")
        daemon_id: uuid.UUID = (
            (uuid.UUID(did_raw) if isinstance(did_raw, str) else did_raw)
            if did_raw is not None
            else runtime_id
        )
        await self._send_ws_wakeup(
            daemon_id,
            lease_id,
            agent_run_id,
            payload_runtime_id=runtime_id,
        )

        return lease_id

    # ------------------------------------------------------------------
    # Interactive session dispatch (D-005@v1 / FR-01, task-05)
    # ------------------------------------------------------------------

    @dataclass(frozen=True, slots=True)
    class InteractiveDispatch:
        """Result of ``prepare_interactive_dispatch``.

        Holds the identifiers needed to wake the daemon and to send the
        follow-up SESSION_INJECT control message. The lease is created with
        ``agent_run_id=NULL`` (D-005@v1) — the first turn run_id is stored in
        lease metadata only, so the interactive lease never participates in
        batch expiry / handle_lease_expiry paths.
        """

        lease_id: uuid.UUID
        runtime_id: uuid.UUID
        daemon_id: uuid.UUID
        run_id: uuid.UUID
        # gap-2（D-002@v3 补丁）：lease 级 claim_token，供 create_session 在首 turn
        # SESSION_INJECT payload 中直接携带（避免再查一次 lease metadata）。
        claim_token: str

    async def prepare_interactive_dispatch(
        self,
        *,
        agent_session_id: uuid.UUID,
        agent_run_id: uuid.UUID,
        user_id: uuid.UUID,
        provider: str,
        prompt: str,
        model: str | None,
        manual_approval: bool = False,
        ask_user_only: bool = False,
        workspace_id: uuid.UUID | None = None,
        cwd: str | None = None,
        # 2026-08-14-sessions-portal task-03 / Grill C-01（P0）：runtime_id 钉定。
        # 非空时 lease 直接定位该 runtime，跳过 _get_online_runtime 的
        # first-online 选择与 provider 不在线 fallback（:1329），也不走
        # workspace 借用兜底——钉定不可满足时明确抛错，绝不静默换机。
        pinned_runtime_id: uuid.UUID | None = None,
    ) -> "RunPlacementService.InteractiveDispatch":
        """Create the long-lived interactive lease for a new session.

        D-005@v1 contract:
        - ``agent_run_id`` column is NULL (the FK lives on AgentRun.agent_session_id,
          not on the lease).
        - ``kind='interactive'`` so lease_service / claim / expire paths can
          branch (D-002@v3 driver vs batch TaskRunner).
        - ``lease_expires_at`` is NULL → ``expire_leases`` never selects it
          (interactive lease lifecycle is owned by ``DaemonService.end_session``).
        - first turn parameters (run_id / prompt / model / provider /
          manual_approval) are stored in lease ``metadata`` so the daemon
          claim payload can drive an independent first turn.

        Note: since 2026-07-08 D-001, ``manual_approval`` / ``ask_user_only``
        in ``metadata`` are forced to ``True`` (scan mode) regardless of the
        caller-provided arguments; the parameters are kept for signature
        compatibility only.

        Adds + flushes only; does NOT commit and does NOT send any WS message.
        The caller (``DaemonService.create_session``) owns the single commit
        that fixes the session↔lease↔run triple, then calls
        ``notify_interactive_dispatch``.

        Raises ``NoOnlineDaemonError`` when no online runtime is available for
        the user (server-local routing). Since 2026-07-09-change-detail-session
        (D-003@v1), change-scoped interactive sessions may pass
        ``workspace_id`` + ``cwd``; they are written into lease ``metadata`` so
        ``lease/context.build_claim_payload`` can resolve spec_root / root_path
        for the daemon. Ordinary quick-chat sessions leave both ``None`` and
        behave exactly as before.
        """
        # D-008@v1（task-08 spike-01 前置解析）：先按原 user 级查自有 daemon（零回归，
        # 不改 _get_online_runtime 的 user 级签名）。无自有在线 daemon + 有 workspace 上下文
        # → 调 _resolve_borrowed_or_own_runtime 借用工作空间共享 daemon（业务/管理人员
        # quick-chat 场景）。helper 内部复检自有（同样 None）→ DAEMON_BORROW → shared lender。
        # 无 workspace_id（普通 quick-chat 无变更上下文）不借用——借用边界 = 工作空间成员资格
        # （design §3 非目标），保持原 NoOnlineDaemonError 行为零回归。
        #
        # task-03（2026-08-14-sessions-portal / Grill C-01 P0）：pinned_runtime_id 命中时
        # 走钉定路径——直接按 id + 属主 + online 复查该 runtime，跳过 first-online 选择、
        # provider fallback 与借用兜底；不可满足（离线/不存在/非本人）→ 抛
        # NoOnlineDaemonError（上层 create_session 捕获后转 4xx），不静默换机。
        borrowed = False
        lender_user_id: uuid.UUID | None = None
        if pinned_runtime_id is not None:
            runtime = await self._query_pinned_online_runtime(user_id, pinned_runtime_id)
            if runtime is None:
                log.warning(
                    "interactive_dispatch_pinned_runtime_unavailable",
                    agent_session_id=str(agent_session_id),
                    user_id=str(user_id),
                    pinned_runtime_id=str(pinned_runtime_id),
                )
                raise NoOnlineDaemonError(
                    user_id=user_id,
                    runtime_id=pinned_runtime_id,
                    message=(
                        f"指定的运行时（{pinned_runtime_id}）已离线或不存在，请重新选择机器/智能体"
                    ),
                )
        else:
            runtime = await self._get_online_runtime(user_id, provider=provider)
            if runtime is None and workspace_id is not None:
                rt, borrowed, lender_user_id = await _resolve_borrowed_or_own_runtime(
                    self._session, workspace_id, user_id, provider
                )
                if rt is not None:
                    runtime = rt
            if runtime is None:
                log.warning(
                    "interactive_dispatch_no_online_runtime",
                    agent_session_id=str(agent_session_id),
                    user_id=str(user_id),
                )
                raise NoOnlineDaemonError(user_id=user_id)

        rid_raw = runtime["id"]
        runtime_id: uuid.UUID = uuid.UUID(rid_raw) if isinstance(rid_raw, str) else rid_raw
        did_raw = runtime.get("daemon_instance_id")
        daemon_id: uuid.UUID = (
            (uuid.UUID(did_raw) if isinstance(did_raw, str) else did_raw)
            if did_raw is not None
            else runtime_id
        )

        lease_id = uuid.uuid4()
        now = datetime.now(UTC)
        # gap-2（D-002@v3 补丁 design §3 / §6 step 1）：interactive lease 在创建时
        # 即生成 claim_token 写入 metadata，使首 turn SESSION_INJECT payload 能携带
        # claim_token 给 daemon（daemon claim 后复用同一 token，claim_lease 不重新生成）。
        # 与 batch lease 区分：batch lease 无 claim_token，claim_lease 时才生成。
        claim_token = secrets.token_hex(32)
        metadata: dict = {
            "session_id": str(agent_session_id),
            "run_id": str(agent_run_id),
            "prompt": prompt,
            "provider": provider,
            "claim_token": claim_token,
        }
        if model:
            metadata["model"] = model
        # 2026-07-08 D-001：所有 stage 统一 scan 模式（manual_approval=True +
        # ask_user_only=True）。AskUserQuestion 走 dialog 人审（入口保留），其余工具
        # allow-through，消除 5min 超时（根因 1）。入参 manual_approval/ask_user_only
        # 保留签名兼容但不再生效。
        metadata["manual_approval"] = True
        metadata["ask_user_only"] = True
        # 2026-07-09-change-detail-session / D-003@v1（R-02 接线）：变更会话透传
        # workspace_id + cwd 到 lease metadata，让 lease/context.build_claim_payload
        # 的 ws_id 分支（context.py:118）命中，解析 spec_root/root_path 给 daemon。
        # 普通 quick-chat 不写 → ws_id=None → 与现状一致（零回归，边界 E4）。
        if workspace_id is not None:
            metadata["workspace_id"] = str(workspace_id)
        if cwd:
            metadata["cwd"] = cwd
        # D-008@v1（task-06 provides BorrowedLeaseFlag）：借用 lease 标记 borrowed=True
        # + lender_user_id，供 task-09 沙箱（按 lease 隔离只读 root_path）+ task-10 落 file
        # 判别。自有 daemon 路径 borrowed=False 不写（零回归）。
        if borrowed:
            metadata["borrowed"] = True
            if lender_user_id is not None:
                metadata["lender_user_id"] = str(lender_user_id)
            # task-09 / D-007@v2（候选 B 主路径）：借用 lease cwd 必须是独立沙箱 marker，
            # 覆盖上方 caller cwd（quick-chat 场景 cwd 可能指 lender 代码 → daemon 会用作
            # cwd → PolicyEngine 按 lease 隔离失效）。marker 借 build_claim_payload 既有
            # cwd→root_path 透传带给 daemon，无需改 context.py。
            _stamp_borrow_sandbox_metadata(metadata, user_id, agent_run_id)
            # task-11 / FR-07 / D-004@v1：显式写 daemon_borrow_audit 审计行（不限额）。
            # workspace_id / lender_user_id 借用必然非空（AC7 + borrow_resolver 契约）。
            if lender_user_id is not None and workspace_id is not None:
                await _insert_borrow_audit_row(
                    self._session,
                    borrower_user_id=user_id,
                    lender_user_id=lender_user_id,
                    daemon_instance_id=daemon_id,
                    workspace_id=workspace_id,
                    agent_run_id=agent_run_id,
                )

        # Raw SQL mirrors dispatch_to_daemon so we can set kind/agent_run_id=NULL
        # without touching the batch ORM insert path. NULL lease_expires_at is
        # the D-005@v1 proof that expire_leases skips this lease.
        await self._session.execute(
            text(
                """
                INSERT INTO daemon_task_leases
                    (id, agent_run_id, runtime_id, status, kind,
                     lease_expires_at, metadata, created_at, updated_at)
                VALUES
                    (:id, NULL, :runtime_id, 'pending', 'interactive',
                     NULL, :metadata, :now, :now)
                """
            ),
            {
                "id": lease_id.hex,
                "runtime_id": runtime_id.hex,
                "metadata": json.dumps(metadata),
                "now": now,
            },
        )
        # Flush so the row is visible inside the caller's transaction; the
        # caller commits the full triple (session + run + lease) atomically.
        await self._session.flush()

        log.info(
            "interactive_dispatch_lease_prepared",
            lease_id=str(lease_id),
            agent_session_id=str(agent_session_id),
            agent_run_id=str(agent_run_id),
            runtime_id=str(runtime_id),
        )

        return RunPlacementService.InteractiveDispatch(
            lease_id=lease_id,
            runtime_id=runtime_id,
            daemon_id=daemon_id,
            run_id=agent_run_id,
            claim_token=claim_token,
        )

    async def prepare_scan_interactive_dispatch(
        self,
        *,
        agent_session_id: uuid.UUID,
        agent_run_id: uuid.UUID,
        user_id: uuid.UUID,
        provider: str,
        prompt: str,
        model: str | None,
        root_path: str,
        spec_root: str,
        runtime_root: str | None = None,
        workspace_id: uuid.UUID | None = None,
        workspace_name: str | None = None,
        workspace_slug: str | None = None,
        repo_url: str | None = None,
        branch: str | None = None,
        spec_strategy: str = "platform-managed",
    ) -> "RunPlacementService.InteractiveDispatch":
        """scan 真阻塞（generic-wibbling-whisper.md 改造点 A）：scan 专用 interactive lease。

        与 ``prepare_interactive_dispatch`` 同构（kind='interactive' / lease_expires_at=NULL
        / agent_run_id 列 NULL），但写入 scan 所需的 lease.metadata（root_path / spec_root
        / runtime_root / workspace_* / repo_url / branch，daemon 经 execution-context
        重建 scan bundle）+ 强制 ``manual_approval=True``（注入 canUseTool）+
        ``ask_user_only=True``（只 AskUserQuestion 阻塞，其他工具 allow-through 让 scan
        自动跑）。runtime 按 ``_resolve_dispatch_runtime(workspace_id, user_id)``
        路由——per-member binding 优先，无 member 行回退 workspace 全局列（D-006，
        2026-07-02-workspace-config-flow task-01）。
        """
        runtime = await self._resolve_dispatch_runtime(
            workspace_id=workspace_id,
            user_id=user_id,
            provider=provider,
        )
        if runtime is None:
            log.warning(
                "scan_interactive_dispatch_no_online_runtime",
                agent_session_id=str(agent_session_id),
                user_id=user_id,
            )
            raise NoOnlineDaemonError(user_id=user_id)

        # D-008@v1（task-06 provides BorrowedLeaseFlag）：与 dispatch_to_daemon 同语义，
        # 从 runtime dict 取借用标记写进 lease metadata（scan 路也走借用兜底）。
        borrowed, lender_user_id_str = _pop_borrowed_flag(runtime)

        rid_raw = runtime["id"]
        runtime_id: uuid.UUID = uuid.UUID(rid_raw) if isinstance(rid_raw, str) else rid_raw
        did_raw = runtime.get("daemon_instance_id")
        daemon_id: uuid.UUID = (
            (uuid.UUID(did_raw) if isinstance(did_raw, str) else did_raw)
            if did_raw is not None
            else runtime_id
        )

        lease_id = uuid.uuid4()
        now = datetime.now(UTC)
        claim_token = secrets.token_hex(32)
        metadata: dict = {
            "session_id": str(agent_session_id),
            "run_id": str(agent_run_id),
            "prompt": prompt,
            "provider": provider,
            "claim_token": claim_token,
            # scan 真阻塞：强制 manual_approval=True（注入 canUseTool）+ ask_user_only=True
            # （只 AskUserQuestion 阻塞等用户决策，其他工具 allow-through 让 scan 自动推进）。
            "manual_approval": True,
            "ask_user_only": True,
            # scan bundle 重建字段（daemon execution-context fetch 消费）。
            "root_path": root_path,
            "spec_root": spec_root,
            "scan_run_id": str(agent_run_id),
            "mode": "scan",
            # spec 同步策略透传（2026-06-28-daemon-client-spec-sync-strategy，D-001）：
            # daemon claim 后经 build_claim_payload 读此字段放入 claim payload，
            # pullSpecBundle 据此三分支初始化缓存。
            "spec_strategy": spec_strategy,
        }
        if model:
            metadata["model"] = model
        if runtime_root:
            metadata["runtime_root"] = runtime_root
        if workspace_id:
            metadata["workspace_id"] = str(workspace_id)
        if workspace_name:
            metadata["workspace_name"] = workspace_name
        if workspace_slug:
            metadata["workspace_slug"] = workspace_slug
        if repo_url:
            metadata["repo_url"] = repo_url
        if branch:
            metadata["branch"] = branch
        # D-008@v1（task-06 provides BorrowedLeaseFlag）：借用 lease 标记，供 task-09 沙箱
        # + task-10 落 file 判别。与 dispatch_to_daemon 同语义（scan 路也读 runtime dict 标记）。
        if borrowed:
            metadata["borrowed"] = True
            if lender_user_id_str:
                metadata["lender_user_id"] = lender_user_id_str
            # task-09 / D-007@v2（候选 B 主路径）：借用 scan lease cwd 必须是独立沙箱 marker，
            # 覆盖上方 root_path（scan 路的 root_path 是 lender 代码路径，若作 cwd 则 daemon
            # 在 lender 代码区跑 + PolicyEngine 按 lease 隔离失效）。marker 借 build_claim_payload
            # 既有 cwd→root_path 透传（cwd 优先于 root_path）带给 daemon，无需改 context.py。
            # scan 语义字段（root_path/spec_root/runtime_root）仍保留在 metadata，仅 cwd 透传
            # 给 daemon 时被 marker 优先覆盖。
            _stamp_borrow_sandbox_metadata(metadata, user_id, agent_run_id)
            # task-11 / FR-07 / D-004@v1：显式写 daemon_borrow_audit 审计行（不限额）。
            # scan 借用同样 workspace-scoped（AC7），workspace_id 非空。
            if workspace_id is not None:
                await _insert_borrow_audit_row(
                    self._session,
                    borrower_user_id=user_id,
                    lender_user_id=uuid.UUID(lender_user_id_str),
                    daemon_instance_id=_runtime_daemon_instance_id(runtime),
                    workspace_id=workspace_id,
                    agent_run_id=agent_run_id,
                )

        # Raw SQL 与 prepare_interactive_dispatch 一致：kind='interactive' + NULL
        # lease_expires_at（scan 长任务永不过期，由 DaemonService.end_session 管生命周期）。
        await self._session.execute(
            text(
                """
                INSERT INTO daemon_task_leases
                    (id, agent_run_id, runtime_id, status, kind,
                     lease_expires_at, metadata, created_at, updated_at)
                VALUES
                    (:id, NULL, :runtime_id, 'pending', 'interactive',
                     NULL, :metadata, :now, :now)
                """
            ),
            {
                "id": lease_id.hex,
                "runtime_id": runtime_id.hex,
                "metadata": json.dumps(metadata),
                "now": now,
            },
        )
        await self._session.flush()

        log.info(
            "scan_interactive_dispatch_lease_prepared",
            lease_id=str(lease_id),
            agent_session_id=str(agent_session_id),
            agent_run_id=str(agent_run_id),
            runtime_id=str(runtime_id),
        )

        return RunPlacementService.InteractiveDispatch(
            lease_id=lease_id,
            runtime_id=runtime_id,
            daemon_id=daemon_id,
            run_id=agent_run_id,
            claim_token=claim_token,
        )

    async def notify_interactive_dispatch(
        self,
        dispatch: "RunPlacementService.InteractiveDispatch",
    ) -> bool:
        """Wake the target daemon after ``create_session`` committed the triple.

        Returns True when a wake-up was delivered to a connected daemon,
        False when the daemon is offline (caller must converge the session to
        a failed terminal state and raise ``DaemonRuntimeOffline``).

        Sends a plain ``task_available`` wakeup; the SESSION_INJECT control
        message with the first-turn prompt is sent by the service layer via
        ``ws_hub.send_session_control`` after this returns True. Routing is by
        ``dispatch.daemon_id`` (WS connection key); the payload carries
        ``dispatch.runtime_id`` for provider session identification.
        """
        from app.modules.daemon.ws_hub import get_daemon_ws_hub

        hub = get_daemon_ws_hub()
        if hub.is_connected(dispatch.daemon_id):
            await hub.send_wakeup(
                dispatch.daemon_id,
                lease_id=dispatch.lease_id,
                payload_runtime_id=dispatch.runtime_id,
            )
            log.info(
                "interactive_dispatch_wakeup_sent",
                daemon_id=str(dispatch.daemon_id),
                runtime_id=str(dispatch.runtime_id),
                lease_id=str(dispatch.lease_id),
                run_id=str(dispatch.run_id),
            )
            return True

        # Fallback: broadcast to any connected daemon entity on the same host.
        connected = hub.connected_daemon_ids
        if connected:
            for did in connected:
                await hub.send_wakeup(
                    did,
                    lease_id=dispatch.lease_id,
                    payload_runtime_id=dispatch.runtime_id,
                )
            log.info(
                "interactive_dispatch_wakeup_broadcast",
                target_daemon=str(dispatch.daemon_id),
                sent_to=[str(d) for d in connected],
                lease_id=str(dispatch.lease_id),
                run_id=str(dispatch.run_id),
            )
            return True

        log.info(
            "interactive_dispatch_wakeup_no_connection",
            daemon_id=str(dispatch.daemon_id),
            lease_id=str(dispatch.lease_id),
            run_id=str(dispatch.run_id),
        )
        return False

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _resolve_dispatch_runtime(
        self,
        *,
        workspace_id: uuid.UUID | None,
        user_id: uuid.UUID,
        provider: str | None,
        agent_profile_id: uuid.UUID | None = None,
        # task-03（2026-08-19-cross-workspace-team-mission / D-001@v2）：
        # representative_fallback 旗标，控制本人无 binding 时的行为。
        #   - True：调用 resolve_representative_binding 查代表 binding（owner 优先→任意在线），
        #           无结果抛 NoOnlineDaemonError（no_binding_for_workspace 语义）。
        #   - False（默认）：维持现状 borrow 兜底链不动（字节级零回归）。
        # 旗标由 caller（execution.py，task-04）根据派发场景控制；本函数只加参数与分支。
        representative_fallback: bool = False,
    ) -> dict | None:
        """Resolve the runtime a dispatch should target.

        Routing rules (D-007@2026-07-10 remove-server-local-workspace-mode，
        server-local 列已删，所有 workspace 永远 daemon-client)：

        - ``workspace_id is None``：dispatch 缺 workspace 上下文，直接抛
          ``NoOnlineDaemonError``（不再静默走 user 级 ``_get_online_runtime``
          server-local 兼容路径；上层 ``decide_backend`` 已守此入口）。
        - Per-member binding (WorkspaceMemberRuntime) 是唯一绑定真相源：
          if a row exists for ``(workspace_id, user_id)``, read its
          ``daemon_id`` (D-004):
            - ``daemon_id`` is None (pre-migration row) →
              ``NoOnlineDaemonError(message="未绑定守护进程，请重绑")``.
            - Daemon must be online + owned by user.
            - Resolve ``provider`` parameter (caller override) or
              ``workspace.default_agent`` → find matching runtime on that
              daemon (D-005).
            - Match found → return that runtime.
            - No match → ``NoOnlineDaemonError`` with enabled-providers list
              (D-008, never auto-fallback to another provider).
        - No binding row → ``NoOnlineDaemonError``（工作区未绑定守护进程，
          daemon-client 单一模式下无全局列可回退）。
        """
        # Branch 0: no workspace context → dispatch 缺绑定，直接抛错。
        if workspace_id is None:
            raise NoOnlineDaemonError(user_id=user_id)

        # D-008@v1（task-06）：提前解析 target_provider，供自有解析 + 借用 helper 共用。
        # task-05（2026-08-02-agent-profile-layer / D-014）：target_provider 优先级改为
        #   profile.provider > caller provider > workspace.default_agent
        # profile.provider 优先体现「档案决定供应商」（不改 daemon 选择顺序，binding 仍为
        # 唯一真相源；profile.provider 仅影响 runtime 匹配 + borrow lender 选择）。
        # agent_profile_id 由上层 task-06 经 §8 兜底链解析后传入；None 时 _resolve_profile_provider
        # **零查询**直接返回 None（C-07：null 路径与今天 100% 一致——同样的解析顺序与 SQL）。
        profile_provider = await self._resolve_profile_provider(agent_profile_id)
        target_provider = profile_provider or provider
        if target_provider is None:
            target_provider = await self._resolve_workspace_default_agent(workspace_id)

        # Per-member binding (D-006, 2026-07-02-workspace-config-flow task-01 +
        # D-007 单一 daemon-client)：WorkspaceMemberRuntime 行是唯一绑定真相源。
        # 无 binding 行 → NoOnlineDaemonError（不再回退 legacy Workspace 全局列）。
        from app.modules.workspace.member_runtimes.resolver import (
            MemberBindingResolver,
        )

        binding = await MemberBindingResolver.resolve_member_binding_or_none(
            self._session, workspace_id, user_id
        )

        if binding is None:
            # 分支①（本人无 binding）：根据 representative_fallback 旗标决定路径。
            # task-03（design §4.2 / D-001@v2）：旗标控制 worker 派发行为——target≠anchor
            # 时旗标开走代表 binding，旗标关维持 borrow 兜底（零回归）。
            if representative_fallback:
                # 分支②（旗标开）：调用 resolve_representative_binding 查代表 binding。
                # owner 优先→任意在线→None；无结果抛 NoOnlineDaemonError（no_binding_for_workspace
                # 语义，与 borrow 路的"未绑定守护进程"区分）。
                from app.modules.workspace.member_runtimes.queries import (
                    resolve_representative_binding,
                )

                representative_rt = await resolve_representative_binding(
                    self._session, workspace_id, user_id, target_provider
                )
                if representative_rt is not None:
                    return representative_rt
                raise NoOnlineDaemonError(
                    workspace_id=workspace_id,
                    user_id=user_id,
                    message="工作区无在线绑定（代表 binding 未命中）",
                )
            else:
                # 分支③（旗标关，默认）：维持现状 borrow 兜底链不动（字节级零回归）。
                # D-008@v1（task-06）：无自有 binding → 借用兜底（业务/管理人员场景）。
                # helper 内部先复检自有（同样 None）→ DAEMON_BORROW 权限闸 → shared lender。
                # 命中借用 runtime 即返回（dict 上塞 borrowed 标记供 lease metadata）；
                # 未命中（无权限 / 无 shared lender）→ 抛原 NoOnlineDaemonError 文案不变。
                borrowed_rt = await _resolve_borrowed_or_own_runtime(
                    self._session, workspace_id, user_id, target_provider
                )
                rt, borrowed, lender = borrowed_rt
                if rt is not None:
                    return _stamp_borrowed_flag(rt, borrowed, lender)
                raise NoOnlineDaemonError(
                    workspace_id=workspace_id,
                    user_id=user_id,
                    message="工作区未绑定守护进程",
                )

        # task-08: per-member binding now routes via daemon_id + default_agent.
        daemon_id = binding.daemon_id
        if daemon_id is None:
            # 旧 binding 行尚未迁移 daemon_id—指引用户重绑（D-004 过渡期）。
            # 此分支不接入借用：stale binding 属配置问题（非"无自有 daemon"），
            # 业务/管理人员通常无 binding 行（走上面 binding-None 借用兜底）。
            raise NoOnlineDaemonError(
                workspace_id=workspace_id,
                user_id=user_id,
                message="未绑定守护进程，请重绑",
            )

        did = uuid.UUID(str(daemon_id)) if not isinstance(daemon_id, uuid.UUID) else daemon_id

        # Step 1: verify the daemon_instance is online + owned by user
        daemon = await self._query_daemon_online_by_id(did, user_id)
        if daemon is None:
            # D-008@v1（task-06）：自有 daemon 离线 → 借用兜底。helper 复检自有（仍离线）
            # → 权限 → shared lender。命中借用则返回；未命中 → 抛原"离线"文案不变。
            borrowed_rt = await _resolve_borrowed_or_own_runtime(
                self._session, workspace_id, user_id, target_provider
            )
            rt, borrowed, lender = borrowed_rt
            if rt is not None:
                return _stamp_borrowed_flag(rt, borrowed, lender)
            raise NoOnlineDaemonError(
                workspace_id=workspace_id,
                user_id=user_id,
                message="绑定的守护进程离线或不存在，请启动后重试",
            )

        # Step 2: find a runtime matching target_provider on this daemon
        # （target_provider 已在函数入口解析，此处直接用）。
        rt = await self._query_runtime_by_daemon_and_provider(did, target_provider)
        if rt is not None:
            return rt

        # Step 3: D-008 — 自有 daemon 在线但缺 default_agent provider：no auto-fallback。
        # **不借用另一台 daemon**（避免 silent fallback 到其他 lender；自有 daemon 在线
        # 时优先让用户修 provider 配置，而非偷借）。error with enabled providers list。
        enabled = await self._get_daemon_enabled_providers(did)
        if target_provider:
            msg = f"守护进程已启用 {enabled}，但未启用 default_agent '{target_provider}'"
        else:
            msg = f"守护进程已启用 {enabled}，但未设置 default_agent，请在工作区设置中配置"
        raise NoOnlineDaemonError(
            workspace_id=workspace_id,
            user_id=user_id,
            message=msg,
        )

    # ------------------------------------------------------------------
    # Daemon-entity resolution helpers (task-08 / D-004 / D-005 / D-008)
    # ------------------------------------------------------------------

    async def _resolve_profile_provider(
        self,
        agent_profile_id: uuid.UUID | None,
    ) -> str | None:
        """task-05（2026-08-02-agent-profile-layer / D-014）：解析 profile.provider 作
         target_provider（不反向选 daemon）。

         ``agent_profile_id`` 由上层 task-06 service.py 经 design §8 兜底链解析后传入
         ——visibility 已在绑定时校验，§8 兜底（workspace.default_agent_profile_id →
         平台默认）也由 task-06 在写 AgentRun.agent_profile_id 前完成。故此处**只按 id
         取 provider**，不重复 resolve_profile（避免重复加载 Workspace/User + 兜底查询）。

         C-07（null 路径零新增查询）：``agent_profile_id is None`` 时**不发任何 SQL**，
         直接返回 None，让调用方回退 caller provider → workspace.default_agent 原路径
        （与今天 100% 一致）。

         provider 归一化（:func:`_normalize_provider`）：profile.provider 可能是
         ``'claude'``，而 workspace.default_agent 习惯写 ``'claude_code'``（agent_type
         不是 provider，daemon 上永不启用，见 orchestrator.py:38）。归一后
         ``'claude_code'`` → ``'claude'`` 对齐 daemon_runtimes.provider 规范值，使
         runtime 匹配 + borrow lender 选择稳定命中。**只归一 profile.provider**——
         workspace.default_agent 回退值保持原样透传，避免改 null 路径行为（C-07）。

         Returns:
             归一化后的 profile.provider，或 None（未绑 / 档案被删）。
        """
        # C-07：未绑 profile → 零查询，直接回退。
        if agent_profile_id is None:
            return None
        from app.modules.agent.profile.service import _normalize_provider

        row = (
            (
                await self._session.execute(
                    text("SELECT provider FROM agent_profiles WHERE id = :id"),
                    {"id": agent_profile_id.hex},
                )
            )
            .mappings()
            .first()
        )
        if row is None:
            # 档案被删（FK ondelete=SET NULL 理论上 agent_profile_id 已同步置空，
            # 此处防御性兜底——回退 workspace.default_agent，不阻断 dispatch）。
            return None
        return _normalize_provider(row["provider"])

    async def _resolve_workspace_default_agent(
        self,
        workspace_id: uuid.UUID,
    ) -> str | None:
        """Return ``workspace.default_agent`` for *workspace_id*, or None.

        D-008@v1（task-06）：派发 / 决策两路的 target_provider 解析前移到 binding 检查
        之前，供自有解析 + 借用 helper（``_resolve_borrowed_or_own_runtime``）共用同一
        provider，保证 4 路借用语义一致（R-01 反割裂）。原 ``_resolve_dispatch_runtime``
        Step 2 内联 SQL 抽到这里，零回归（同 SQL 同顺序）。
        """
        ws_data = (
            (
                await self._session.execute(
                    text("SELECT default_agent FROM workspaces WHERE id = :id"),
                    {"id": workspace_id.hex},
                )
            )
            .mappings()
            .first()
        )
        return ws_data["default_agent"] if ws_data else None

    async def _query_daemon_online_by_id(
        self,
        daemon_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> dict | None:
        """Return the online daemon_instance row, or None if offline / not owned.

        Thin wrapper over the shared module-level query (D-004@v1,
        2026-07-05-daemon-client-change-binding-fix task-01). 派发与写回链路共用同一
        条 SQL，避免逻辑重复。
        """
        from app.modules.workspace.member_runtimes.queries import (
            query_daemon_online_by_id,
        )

        return await query_daemon_online_by_id(self._session, daemon_id, user_id)

    async def _query_runtime_by_daemon_and_provider(
        self,
        daemon_id: uuid.UUID,
        target_provider: str | None,
    ) -> dict | None:
        """Return the first online runtime matching ``target_provider`` on the
        given daemon, or None (design §6 D-005). 共享查询薄壳（task-01）。
        """
        from app.modules.workspace.member_runtimes.queries import (
            query_runtime_by_daemon_and_provider,
        )

        return await query_runtime_by_daemon_and_provider(self._session, daemon_id, target_provider)

    async def _get_daemon_enabled_providers(
        self,
        daemon_id: uuid.UUID,
    ) -> list[str]:
        """Return sorted unique provider names enabled on the daemon. 共享查询薄壳（task-01）。"""
        from app.modules.workspace.member_runtimes.queries import (
            get_daemon_enabled_providers,
        )

        return await get_daemon_enabled_providers(self._session, daemon_id)

    async def _resolve_decide_runtime(
        self,
        *,
        workspace_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> dict:
        """Resolve runtime for ``decide_backend`` (task-08, daemon_id routing).

        D-007@2026-07-10（remove-server-local-workspace-mode）：server-local 列删除后
        所有 workspace 永远 daemon-client，无 binding 行即未绑定，直接抛
        ``NoOnlineDaemonError``（不再回退 user 级全局运行时兜底 / legacy workspace
        全局运行时列）。

        Returns a runtime ``dict`` when the workspace has a per-member binding
        and the bound daemon is online + has at least one online runtime.

        Raises ``NoOnlineDaemonError`` when:
            * 无 binding 行（workspace 未绑定守护进程）
            * binding.daemon_id is None (pre-migration) → "未绑定守护进程，请重绑"
            * daemon is offline / cross-user
            * daemon is online but has no online runtimes (all providers stale)
        """
        # Per-member binding (D-004, 2026-07-03-daemon-entity-binding task-08 +
        # D-007 单一 daemon-client)。WorkspaceMemberRuntime 行是唯一绑定真相源。
        from app.modules.workspace.member_runtimes.resolver import (
            MemberBindingResolver,
        )

        binding = await MemberBindingResolver.resolve_member_binding_or_none(
            self._session, workspace_id, user_id
        )

        if binding is None:
            # D-008@v1（task-06）：无自有 binding → 借用兜底，与 _resolve_dispatch_runtime
            # 同语义。helper provider 用 workspace.default_agent（与 dispatch 借用同 provider），
            # 避免「decide 借用任一 provider 通过、dispatch 因 default_agent 不匹配报错」割裂
            # （R-01 / 重现 D-007）。命中借用 runtime 即返回（decide 只验可达性，不消费 borrowed
            # 标记）；未命中 → 抛原 NoOnlineDaemonError 文案不变。
            target_provider = await self._resolve_workspace_default_agent(workspace_id)
            rt, _borrowed, _lender = await _resolve_borrowed_or_own_runtime(
                self._session, workspace_id, user_id, target_provider
            )
            if rt is not None:
                return rt
            raise NoOnlineDaemonError(
                workspace_id=workspace_id,
                user_id=user_id,
                message="工作区未绑定守护进程",
            )

        # task-08: per-member binding now routes via daemon_id.
        daemon_id = binding.daemon_id
        if daemon_id is None:
            # 旧 binding 行尚未迁移 daemon_id—指引用户重绑（D-004 过渡期）。
            # 与 _resolve_dispatch_runtime 同：此分支不接入借用（stale binding 属配置问题）。
            raise NoOnlineDaemonError(
                workspace_id=workspace_id,
                user_id=user_id,
                message="未绑定守护进程，请重绑",
            )

        did = uuid.UUID(str(daemon_id)) if not isinstance(daemon_id, uuid.UUID) else daemon_id

        # Verify the daemon_instance is online + owned by user.
        daemon = await self._query_daemon_online_by_id(did, user_id)
        if daemon is None:
            # D-008@v1（task-06）：自有 daemon 离线 → 借用兜底，与 _resolve_dispatch_runtime
            # 同语义（provider=default_agent）。命中借用则返回；未命中 → 抛原"离线"文案不变。
            target_provider = await self._resolve_workspace_default_agent(workspace_id)
            rt, _borrowed, _lender = await _resolve_borrowed_or_own_runtime(
                self._session, workspace_id, user_id, target_provider
            )
            if rt is not None:
                return rt
            raise NoOnlineDaemonError(
                workspace_id=workspace_id,
                user_id=user_id,
                message="绑定的守护进程离线或不存在，请启动后重试",
            )

        # Pick any online runtime on the daemon to confirm the daemon is
        # reachable (decide only validates reachability, not provider match;
        # the specific provider is resolved by _resolve_dispatch_runtime).
        rt = await self._query_runtime_by_daemon_and_provider(did, None)
        if rt is not None:
            return rt

        # Daemon has no online runtimes at all — still raise (not D-008
        # which is for provider mismatch; this is a more fundamental state).
        enabled = await self._get_daemon_enabled_providers(did)
        raise NoOnlineDaemonError(
            workspace_id=workspace_id,
            user_id=user_id,
            message=(
                f"守护进程在线但无可用运行时（已启用 provider: {enabled}），请确认 daemon 状态正常"
            ),
        )

    async def _get_online_runtime(
        self,
        user_id: uuid.UUID,
        *,
        provider: str | None = None,
    ) -> dict | None:
        """Return the first online daemon runtime for the user, or None.

        If *provider* is given, prefer a runtime with that provider; if none
        is online, fall back to any online runtime and emit
        ``placement_provider_fallback`` (FR-03: dispatch must never silently
        fail just because the requested provider is momentarily offline). When
        *provider* is None, behavior is unchanged (ORDER BY last_heartbeat_at,
        no warning).
        """
        try:
            if provider:
                # 1) strict match on the requested provider
                row = await self._query_online(user_id, provider=provider)
                if row:
                    return row
                # 2) fall back to any online runtime + observable warning
                fallback = await self._query_online(user_id, provider=None)
                if fallback:
                    log.warning(
                        "placement_provider_fallback",
                        wanted=provider,
                        actual=fallback.get("provider"),
                        user_id=str(user_id),
                    )
                    return fallback
                return None
            # provider=None: unchanged single query, no warning
            return await self._query_online(user_id, provider=None)
        except Exception as exc:
            log.warning(
                "placement_get_online_runtime_query_failed",
                user_id=str(user_id),
                error=str(exc),
            )
            return None

    async def _query_pinned_online_runtime(
        self,
        user_id: uuid.UUID,
        runtime_id: uuid.UUID,
    ) -> dict | None:
        """task-03（2026-08-14-sessions-portal / Grill C-01 P0）：按 id 精确复查钉定 runtime。

        返回该 runtime 行（dict，与 ``_get_online_runtime`` 同列集）当且仅当
        ``id + 属主 + status='online'`` 三者同时满足；否则 None（调用方
        ``prepare_interactive_dispatch`` 抛错，不 fallback）。与 first-online
        路径的关键差异：无 provider fallback、无 ORDER BY 心跳择优、无借用。
        """
        result = await self._session.execute(
            text(
                """
                SELECT id, user_id, provider, status, daemon_instance_id
                FROM daemon_runtimes
                WHERE id = :rid
                  AND user_id = :uid
                  AND status = 'online'
                """
            ),
            {"rid": runtime_id.hex, "uid": user_id.hex},
        )
        row = result.mappings().first()
        return dict(row) if row else None

    async def _query_online(
        self,
        user_id: uuid.UUID,
        *,
        provider: str | None = None,
    ) -> dict | None:
        """Query the first online daemon runtime, optionally filtered by provider.

        Ordered by ``last_heartbeat_at DESC`` so the most recently seen runtime
        wins (R-02). Raises propagate to ``_get_online_runtime`` which owns the
        error-suppression policy.
        """
        where_extra = "AND provider = :provider" if provider else ""
        params: dict = {"user_id": user_id.hex}
        if provider:
            params["provider"] = provider
        result = await self._session.execute(
            text(
                f"""
                SELECT id, user_id, provider, status, daemon_instance_id
                FROM daemon_runtimes
                WHERE user_id = :user_id
                  AND status = 'online'
                  {where_extra}
                ORDER BY last_heartbeat_at DESC NULLS LAST
                LIMIT 1
                """
            ),
            params,
        )
        row = result.mappings().first()
        return dict(row) if row else None

    async def _send_ws_wakeup(
        self,
        daemon_id: uuid.UUID,
        lease_id: uuid.UUID,
        agent_run_id: uuid.UUID,
        *,
        payload_runtime_id: uuid.UUID | None = None,
    ) -> None:
        """Send a WebSocket wake-up signal to the daemon via DaemonWsHub.

        Routing is by ``daemon_id`` (the WS connection key, design §5.3). The
        payload optionally carries ``payload_runtime_id`` so the daemon
        dispatches the wake to the correct provider session (design §5.3).
        Defaults to ``daemon_id`` when ``payload_runtime_id`` is None (legacy
        compat for callers without a provider-level runtime_id).
        """
        from app.modules.daemon.ws_hub import get_ws_hub

        hub = get_ws_hub()
        if hub.is_connected(daemon_id):
            await hub.send_wakeup(
                str(daemon_id),
                lease_id=str(lease_id),
                payload_runtime_id=payload_runtime_id,
            )
            log.info(
                "ws_wakeup_sent",
                daemon_id=str(daemon_id),
                lease_id=str(lease_id),
                agent_run_id=str(agent_run_id),
                payload_runtime_id=str(payload_runtime_id) if payload_runtime_id else None,
            )
            return

        # Fallback: broadcast to all connected daemon entities on the same host.
        connected = hub.connected_runtime_ids
        if connected:
            for did in connected:
                await hub.send_wakeup(
                    did,
                    lease_id=str(lease_id),
                    payload_runtime_id=payload_runtime_id,
                )
            log.info(
                "ws_wakeup_broadcast",
                target_daemon=str(daemon_id),
                sent_to=[str(d) for d in connected],
                lease_id=str(lease_id),
                agent_run_id=str(agent_run_id),
            )
        else:
            log.info(
                "ws_wakeup_skipped_no_connection",
                daemon_id=str(daemon_id),
                lease_id=str(lease_id),
                agent_run_id=str(agent_run_id),
            )
