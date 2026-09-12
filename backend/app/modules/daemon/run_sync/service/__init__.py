"""RunSync subdomain service — agent run status sync / interactive run closure.

Owns the AgentRun state machine (sync / close / messages / post-scan). Migrated
verbatim from DaemonService in change 2026-06-22-daemon-service-split (W4,
task-04). Behavior unchanged; see design §7.5 AgentRun status-sync lifecycle
table.

拆分说明（task-10，2026-09-07-arch-large-file-split design §5 Wave 2）：本文件
原为 4055 行单模块 ``run_sync/service.py``，已升级为 9 文件同名包——
sdk_pipeline（SDK 消息展开管线 + 截断常量 + 派发 LRU）/ group_bridge（群桥接
投影簇 + close 群收口钩子）/ gate（gate 决策簇）/ stage_team（stage/team 推进
簇 + post-scan 校验）/ submit_steps（submit_messages 解析/派发/override 段分步
函数）/ submit_commit（分段撤销 + 收尾持久化/发布段）/ close_run_steps
（close_interactive_run 拆分步 + 鉴权自动重投）/ publish（publish_* 模块级函数
+ PublishIntent/SubmittedMessages）。本 ``__init__`` 是兼容层：

- ``RunSyncService`` 类壳保留全部方法签名（公共签名逐一不变），方法体一行
  委托到子模块函数（第一参数传 service 实例——``self._session`` 经
  ``svc._session`` 显式传参）；类内互调保持 ``svc.<方法>`` 形态（拆分前
  ``self.<方法>`` 的运行时解析语义逐一保留，含 patch.object 类方法场景）；
  ``sync_agent_run_status`` 为小方法，逐字节保留在壳内；后台任务 helper 经
  task-11 轻重构③收敛进共享 mixin（daemon/_background_tasks.py，与
  SessionService 单源——``_fire_background_task`` 原实现删除、继承 mixin；
  ``_on_background_task_done`` 保留 staticmethod 壳守住既有测试契约）；
- 聚合重导出拆前命名空间的全部被消费符号（task-06 基线 15 符号 + 冒烟面）。

patch 兼容（D-007，本拆分最高风险点）：本命名空间保留 ``get_redis``
（43 处 patch）、``get_session_factory``（1 处 patch）、``_run_gate_via_delegate``
（1 处 patch）绑定；子模块一律 ``import
app.modules.daemon.run_sync.service as _rsvc`` 后 ``_rsvc.<符号>`` 延迟解析，
既有 45 处 patch("app.modules.daemon.run_sync.service.<sym>") 全部继续拦截。
对 session.service 私有符号（_apply_session_terminal_status /
_send_session_end_best_effort）与 TERMINAL_TURN_STATUSES / get_session_readiness
的既有导入语句原样落在需要的子模块（close_run_steps / gate），语义零变化。
"""

from __future__ import annotations

import asyncio
import json
import uuid
from datetime import UTC, datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

# D-007 patch 绑定（1 处 patch，test_run_sync_gate_decision_task:419）：gate
# 子模块经 _rsvc.get_session_factory() 延迟解析。
from app.core.db import get_session_factory
from app.core.logging import get_logger

# D-007 patch 绑定（43 处 patch，30 个测试文件）：publish/group_bridge/gate/
# stage_team/close_run_steps 等子模块经 _rsvc.get_redis() 延迟解析。
from app.core.redis import get_redis
from app.modules.agent.model import AgentRun, AgentRunLog, AgentSession

# D-007 patch 绑定（1 处 patch，test_run_sync_gate_decision_task:250）：gate
# 子模块经 _rsvc._run_gate_via_delegate 延迟解析。
from app.modules.change.dispatch import _run_gate_via_delegate
from app.modules.daemon import _background_tasks as _bg_tasks
from app.modules.daemon._background_tasks import BackgroundTaskMixin
from app.modules.daemon.lease.service import DaemonAgentRunNotFound
from app.modules.daemon.model import DaemonTaskLease
from app.modules.daemon.model_error import ModelErrorDTO
from app.modules.daemon.schema import ModelUsageItemRead
from app.modules.daemon.session.service import TERMINAL_TURN_STATUSES

# D-007 setattr 绑定（test_session_events_cross._capture_publish 经
# monkeypatch.setattr("app.modules.daemon.run_sync.service.publish_sessions_changed")
# 拦截）：close_run_steps 调用点经 _rsvc.publish_sessions_changed 延迟解析。
from app.modules.daemon.session_events import publish_sessions_changed

if TYPE_CHECKING:
    from app.modules.agent.model import AgentMission
    from app.modules.change.model import Change
    from app.modules.daemon.service import DaemonService

log = get_logger(__name__)

# ── 聚合重导出（import 面 + patch 面，D-006/D-007）─────────────────────────
from .group_bridge import (  # noqa: E402
    GROUP_FALLBACK_SUMMARY_CHARS,
    GROUP_PROJECTION_FALLBACK_TEMPLATE,
    _GroupBridgeContext,
    extract_group_broadcast_segments,
    is_group_projectable_reply,
    resolve_group_member_identity,
)
from .publish import (  # noqa: E402
    _BASH_CHUNK_STATE_PRUNE_SIZE,
    BASH_CHUNK_MAX_CONTENT_CHARS,
    BASH_CHUNK_THROTTLE_INTERVAL_S,
    PublishIntent,
    SubmittedMessages,
    _bash_chunk_last_publish,
    publish_bash_chunk_event,
    publish_session_event,
    publish_submitted_messages,
)
from .sdk_pipeline import (  # noqa: E402
    _TOOL_USE_RUN_LRU_CAPACITY,
    TOOL_RESULT_MAX_CHARS,
    _channel_from_event_type,
    _extract_sdk_messages,
    _persist_agent_event,
    _tool_use_run_lru,
    _ToolUseRunLRU,
)

__all__ = [
    "BASH_CHUNK_MAX_CONTENT_CHARS",
    "BASH_CHUNK_THROTTLE_INTERVAL_S",
    "GROUP_FALLBACK_SUMMARY_CHARS",
    "GROUP_PROJECTION_FALLBACK_TEMPLATE",
    "TOOL_RESULT_MAX_CHARS",
    "_BASH_CHUNK_STATE_PRUNE_SIZE",
    "_TOOL_USE_RUN_LRU_CAPACITY",
    "PublishIntent",
    "RunSyncService",
    "SubmittedMessages",
    "_GroupBridgeContext",
    "_ToolUseRunLRU",
    "_bash_chunk_last_publish",
    "_channel_from_event_type",
    "_extract_sdk_messages",
    "_persist_agent_event",
    "_run_gate_via_delegate",
    "_tool_use_run_lru",
    "extract_group_broadcast_segments",
    "get_redis",
    "get_session_factory",
    "is_group_projectable_reply",
    "log",
    "publish_bash_chunk_event",
    "publish_session_event",
    "publish_sessions_changed",
    "publish_submitted_messages",
    "resolve_group_member_identity",
]

# ── 子模块（import 即注册；RunSyncService 类壳在其后定义）──────────────────
from . import close_run_steps as _close_run_steps  # noqa: E402
from . import gate as _gate  # noqa: E402
from . import group_bridge as _group_bridge  # noqa: E402
from . import publish as _publish  # noqa: E402
from . import stage_team as _stage_team  # noqa: E402
from . import submit_commit as _submit_commit  # noqa: E402
from . import submit_steps as _submit_steps  # noqa: E402


class RunSyncService(BackgroundTaskMixin):
    """AgentRun 状态同步子 service。构造接 AsyncSession。

    task-10 拆分类壳：保留全部方法签名（公共签名逐一不变），方法体一行委托
    到子模块函数（第一参数传 service 实例）；小方法（构造 / sync_agent_run_
    status）逐字节保留在壳内。task-11 轻重构③：后台任务 helper 收敛进共享
    mixin（daemon/_background_tasks.py，与 SessionService 单源）。
    """

    # 后台任务引用集 — 防止 asyncio.Task 被 GC 回收（每宿主类各持一份，
    # 与 SessionService 的集合互不串扰）
    _background_tasks: set[asyncio.Task] = set()

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        # 跨子域辅助：W4 早于 W5(session)/W6(lease)，_get_lease_and_verify_token
        # 与 _publish_session_event 仍在 facade（task-05/06 才迁）。持有 facade
        # 引用反向委托（design §7.2），task-05/06 落位后 facade 保留委托，本引用
        # 继续工作（委托到对应子 service），不耦合 Wave 顺序。
        self._facade: DaemonService | None = None

    # ------------------------------------------------------------------
    # Background task lifecycle helpers（H4 / R5，原逐字对齐 agent/service.py
    # :347-386；gate enqueue（task-05）/ gate 任务派发（task-07）消费）。
    # task-11 轻重构③：``_fire_background_task`` 原实现与 SessionService 逐字节
    # 相同，删除并继承共享 mixin 单源；``_on_background_task_done`` 的
    # staticmethod 表面是既有测试契约（test_run_sync_fire_background_task 以
    # getattr_static 断言 staticmethod + ``(task)`` 签名与 AgentService 对齐），
    # 保留两行壳、核心经共享函数 discard 本类集合并按本模块 log 记日志。
    # ------------------------------------------------------------------

    @staticmethod
    def _on_background_task_done(task: asyncio.Task) -> None:
        """Remove task from the tracking set and surface exceptions."""
        _bg_tasks.on_background_task_done(RunSyncService, task)

    async def _revoke_committed_partials(self, agent_run_id: uuid.UUID, segment_id: str) -> int:
        return await _submit_commit._revoke_committed_partials(self, agent_run_id, segment_id)

    async def _resolve_group_bridge_context(
        self, agent_run: AgentRun | None
    ) -> _GroupBridgeContext | None:
        return await _group_bridge._resolve_group_bridge_context(self, agent_run=agent_run)

    @staticmethod
    def _build_group_projection_row(
        ctx: _GroupBridgeContext,
        *,
        source_row: AgentRunLog,
        dedup_key: str | None,
        content_override: str | None = None,
        timestamp_override: datetime | None = None,
    ) -> AgentRunLog:
        return _group_bridge._build_group_projection_row(
            ctx,
            source_row=source_row,
            dedup_key=dedup_key,
            content_override=content_override,
            timestamp_override=timestamp_override,
        )

    async def _emit_group_mention_projection_fallback(self, agent_run: AgentRun) -> None:
        return await _group_bridge._emit_group_mention_projection_fallback(self, agent_run)

    async def _build_group_fallback_summary(self, agent_run: AgentRun) -> str | None:
        return await _group_bridge._build_group_fallback_summary(self, agent_run)

    async def _resolve_dispatch_run_id(
        self,
        agent_session_id: uuid.UUID,
        tool_use_id: str,
    ) -> uuid.UUID | None:
        return await _submit_commit._resolve_dispatch_run_id(self, agent_session_id, tool_use_id)

    @staticmethod
    def _override_marker_content(segment_id: str, thinking: bool) -> str:
        return _submit_steps._override_marker_content(segment_id, thinking)

    async def _override_marker_exists(self, agent_run_id: uuid.UUID, segment_id: str) -> bool:
        return await _submit_steps._override_marker_exists(self, agent_run_id, segment_id)

    # ── public ────────────────────────────────────────────────────────────

    async def submit_messages(
        self,
        lease_id: uuid.UUID,
        claim_token: str,
        agent_run_id: uuid.UUID,
        messages: list[dict],
    ) -> SubmittedMessages:
        """Submit agent conversation messages for a lease.

        Writes to AgentRunLog and syncs AgentRun status, then returns a
        :class:`SubmittedMessages` (an ``int`` == messages written) carrying
        the Redis pub/sub :class:`PublishIntent`. The caller (router) publishes
        AFTER the DB session has committed / released its connection via
        :func:`publish_submitted_messages` (QueuePool fix: Redis hangs must not
        pin DB connections).
        """
        return await _submit_steps.submit_messages(
            self, lease_id, claim_token, agent_run_id, messages
        )

    async def sync_agent_run_status(
        self,
        lease_id: uuid.UUID,
        claim_token: str,
        status: str,
        *,
        error: str | None = None,
    ) -> AgentRun | None:
        """Sync AgentRun status from daemon side.

        Validates the lease + claim_token, locates the associated AgentRun,
        updates its status and timestamps, and publishes a Redis event.

        Returns the updated AgentRun, or None if no AgentRun is linked.

        终态守卫（2026-08-25 会话审查 P1）：run 已处于终态
        （completed/failed/killed）时忽略非终态回退——迟到的 ``running`` 上报
        （daemon 重试 / 网络延迟）不得把已收口的 run 复活回 running；同值重发
        幂等放行（finished_at 等字段仅在为 None 时补写，重发无副作用）。
        """
        lease = await self._facade._get_lease_and_verify_token(lease_id, claim_token)

        if lease.agent_run_id is None:
            log.warning(
                "daemon_sync_no_agent_run",
                lease_id=str(lease_id),
            )
            return None

        agent_run = await self._session.get(AgentRun, lease.agent_run_id)
        if agent_run is None:
            raise DaemonAgentRunNotFound(
                f"AgentRun '{lease.agent_run_id}' not found for lease '{lease_id}'.",
                details={
                    "lease_id": str(lease_id),
                    "agent_run_id": str(lease.agent_run_id),
                },
            )

        # 终态守卫：已终态的 run 收到非终态（running）回退 → 记 warning 并按
        # 幂等处理直接返回当前行，不落库、不发布（迟到上报不复活终态）。
        if agent_run.status in TERMINAL_TURN_STATUSES and status not in TERMINAL_TURN_STATUSES:
            log.warning(
                "daemon_sync_terminal_run_regression_ignored",
                lease_id=str(lease_id),
                agent_run_id=str(agent_run.id),
                current_status=agent_run.status,
                incoming_status=status,
            )
            return agent_run

        now = datetime.now(UTC)
        agent_run.status = status

        if status == "running" and agent_run.started_at is None:
            agent_run.started_at = now
        if status in ("completed", "failed", "killed") and agent_run.finished_at is None:
            agent_run.finished_at = now
        if status == "killed" and agent_run.exit_code is None:
            agent_run.exit_code = -1
        if error is not None and status == "failed":
            agent_run.output_redacted = error

        self._session.add(agent_run)
        await self._session.commit()
        await self._session.refresh(agent_run)

        # Publish status change via Redis
        try:
            redis = get_redis()
            redis_payload: dict = {
                "event": "status_changed",
                "status": status,
                "lease_id": str(lease_id),
                "agent_run_id": str(agent_run.id),
            }
            if error is not None:
                redis_payload["error"] = error
            await redis.publish(
                f"agent_run:{agent_run.id}",
                json.dumps(redis_payload),
            )
        except Exception:
            log.warning(
                "daemon_sync_redis_publish_failed",
                lease_id=str(lease_id),
                agent_run_id=str(agent_run.id),
            )

        log.info(
            "daemon_agent_run_status_synced",
            lease_id=str(lease_id),
            agent_run_id=str(agent_run.id),
            status=status,
            error=error,
        )
        return agent_run

    async def _is_gate_rejected_first_failure(
        self, agent_run: AgentRun, session: AgentSession
    ) -> bool:
        return await _gate._is_gate_rejected_first_failure(
            self, agent_run=agent_run, session=session
        )

    async def close_interactive_run(
        self,
        lease_id: uuid.UUID,
        run_id: uuid.UUID,
        claim_token: str,
        *,
        status: str,
        is_error: bool,
        subtype: str | None = None,
        result_summary: str | None = None,
        # ── SDKResultSuccess usage / cost / duration 透传（修复 interactive 路径
        # AgentRun.{total_cost_usd,num_turns,duration_ms,duration_api_ms,
        # input_tokens,output_tokens} 全 NULL 问题）。None 表示 daemon 未传，
        # 保留 AgentRun 原值不覆盖。
        total_cost_usd: float | None = None,
        num_turns: int | None = None,
        duration_ms: int | None = None,
        duration_api_ms: int | None = None,
        input_tokens: int | None = None,
        output_tokens: int | None = None,
        # task-07 / FR-02：prompt cache 词元透传（SDKResultSuccess.usage.cache_*）。
        # None=daemon 未传，保留 AgentRun 原值不覆盖（对齐 D-001@v1 codex 无 cache）。
        # 终态一次写入直接覆盖（无 max 守卫，对齐 input/output 终态覆盖模式）。
        cache_read_tokens: int | None = None,
        cache_creation_tokens: int | None = None,
        # task-03（2026-08-29-usage-by-provider-model / FR-01-3 / design §2 §4.1）：
        # daemon 终态上报的逐模型用量明细行（SDK result.modelUsage 拆行；行内
        # api_requests 已由 daemon 按各模型 input+output 占比分摊，各行求和 ==
        # run 级总数——backend 不重复分摊，直接落行）+ run 级 API 调用次数精确值
        # （AgentRun 无该列，精确值只入日志观测，落库承载在明细行）。
        # None/空列表=老 daemon 未传 → 明细零行、run 列不填（N-01 兼容）。
        model_usage: list[ModelUsageItemRead] | None = None,
        api_requests: int | None = None,
        # task-06 / FR-02：daemon classifyModelError 回传的模型层错误。None=daemon
        # 未传（旧 daemon / 成功 run），AgentRun.error_detail 保持 None（design §9）。
        error: ModelErrorDTO | None = None,
    ) -> AgentRun:
        """Close an interactive AgentRun from daemon SDK result (gap-3 / design §4).

        Daemon ``SessionManager._onResult`` → ``hubClient.notifyRunResult`` → this
        endpoint. The lease is verified via ``claim_token``; the run is located by
        ``run_id`` (interactive lease has ``agent_run_id=NULL`` per D-005@v1, so we
        cannot read it off the lease row) and bound to the lease's session via
        ``lease.metadata.session_id`` to prevent cross-session run injection.

        Terminal mapping (design §4):
          - status=success → AgentRun.status='completed'
          - status=error_during_execution → AgentRun.status='failed'
            (interrupted semantics; error_code='interactive_interrupted')
          - any other is_error → AgentRun.status='failed'
            (error_code='interactive_failed')

        Idempotent: an AgentRun already in TERMINAL_TURN_STATUSES is a no-op
        (returns the row unchanged) so daemon retries after a transient network
        blip do not double-write or flip a completed run back to failed.

        ``cache_read_tokens`` / ``cache_creation_tokens`` (task-07 / FR-02): prompt
        cache 词元，daemon 从 SDKResultSuccess.usage 透传；None 表示 daemon 未传
        （老 daemon / codex 无 cache），保留 AgentRun 原值不覆盖。终态一次写入
        直接覆盖（无 max 守卫），对齐既有 input/output 终态覆盖语义。

        ``model_usage`` (task-03 / 2026-08-29-usage-by-provider-model / FR-01-3):
        daemon 终态上报的逐模型用量明细——事务内同 run 先 DELETE 后 INSERT 全部
        行（等价幂等 upsert by (run_id, model)，design §4.1）；run.model 终态填
        input+output 最大行的 model；run.llm_provider_id **仅空时**填会话当前值
        （dispatch 已按轮写入生效供应商，终态覆盖会造成切供应商竞态错归因，
        R-08）。明细落库 best-effort：savepoint 包裹，失败仅 warn 不阻塞 close。
        None/空列表（老 daemon）→ 零行为变化（N-01）。

        Raises ``DaemonAgentRunNotFound`` when the run does not exist or is not
        bound to the lease's session (resource-hiding 404 — no existence leak).
        """
        return await _close_run_steps.close_interactive_run(
            self,
            lease_id=lease_id,
            run_id=run_id,
            claim_token=claim_token,
            status=status,
            is_error=is_error,
            subtype=subtype,
            result_summary=result_summary,
            total_cost_usd=total_cost_usd,
            num_turns=num_turns,
            duration_ms=duration_ms,
            duration_api_ms=duration_api_ms,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cache_read_tokens=cache_read_tokens,
            cache_creation_tokens=cache_creation_tokens,
            model_usage=model_usage,
            api_requests=api_requests,
            error=error,
        )

    async def _gate_applicable(self, agent_run: AgentRun) -> bool:
        return await _gate._gate_applicable(self, agent_run)

    async def _resolve_gate_workspace_id(self, agent_run: AgentRun) -> uuid.UUID | None:
        return await _gate._resolve_gate_workspace_id(self, agent_run)

    async def _run_gate_decision_task(
        self,
        *,
        agent_run_id: uuid.UUID,
        workspace_id: uuid.UUID,
        change_id: uuid.UUID,
    ) -> None:
        return await _gate._run_gate_decision_task(
            self,
            agent_run_id=agent_run_id,
            workspace_id=workspace_id,
            change_id=change_id,
        )

    async def _publish_gate_status_changed(
        self,
        agent_run: AgentRun,
        gate_result: dict | None,
    ) -> None:
        return await _gate._publish_gate_status_changed(
            self, agent_run=agent_run, gate_result=gate_result
        )

    async def _publish_stage_status_changed(
        self,
        agent_run: AgentRun,
        change_id: uuid.UUID,
        stage: str | None,
        status: str,
    ) -> None:
        return await _stage_team._publish_stage_status_changed(
            self, agent_run=agent_run, change_id=change_id, stage=stage, status=status
        )

    async def _resolve_gate_spec_root(
        self,
        gate_session: AsyncSession,
        workspace: "object",
        change: "object",
    ) -> tuple[str | None, str | None]:
        return await _gate._resolve_gate_spec_root(self, gate_session, workspace, change)

    async def _trigger_stage_completion_callback(
        self,
        agent_run_id: uuid.UUID,
    ) -> None:
        return await _stage_team._trigger_stage_completion_callback(self, agent_run_id=agent_run_id)

    async def _handle_team_run_completion(
        self,
        agent_run: AgentRun,
        change: Change,
    ) -> None:
        return await _stage_team._handle_team_run_completion(
            self, agent_run=agent_run, change=change
        )

    async def _advance_team_stage(
        self,
        change: Change,
        mission: AgentMission,
        team_stage: str,
    ) -> None:
        return await _stage_team._advance_team_stage(
            self, change=change, mission=mission, team_stage=team_stage
        )

    async def _run_post_scan_validation(
        self,
        lease: DaemonTaskLease,
    ) -> None:
        return await _stage_team._run_post_scan_validation(self, lease=lease)

    async def _resolve_lease_workspace(self, lease: DaemonTaskLease):
        return await _stage_team._resolve_lease_workspace(self, lease=lease)

    async def _publish_run_event(
        self,
        agent_run_id: UUID,
        *,
        event: str,
        status: str,
        **extra: object,
    ) -> None:
        return await _publish._publish_run_event(
            self, agent_run_id, event=event, status=status, **extra
        )
