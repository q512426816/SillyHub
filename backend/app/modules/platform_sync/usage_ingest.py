"""agent-logs 上报后用量快照摄取（2026-10-02-change-center-token-usage task-02）。

上报链路顺带解析（design 总体方案 / D-002@v1）：CLI 每次 ``POST /api/agent-logs``
落库元信息后，backend 以 fire-and-forget 后台任务对候选 entry 逐个经既有「会话
回放」WS RPC 通道（``host_fs.read_agent_log_messages``）让 daemon 解析日志，把
daemon 解析器累计口径的 ``totalUsage`` 四项覆盖写进 ``platform_agent_logs`` 用量
快照五列（task-01 迁移）。消费方：change/usage_service 聚合本地段（task-03）。

铁律（design 风险登记 R-02/R-03/R-06 + Grill B-1 裁定）：

- **best-effort 全降级**：daemon 离线 / 超时 / method_not_found（旧 daemon）/
  unsupported / too_large / parse_error / totalUsage null 一律 ``log.info`` 跳过，
  不抛不重试——下次上报全量解析幂等补齐；上报响应路径零阻塞零失败放大。
- **节流**：同 entry 的 ``size_bytes``+``mtime_ms`` 与库中一致 且
  ``usage_parsed_at`` 距今 < 300s → 跳过（日志未增长不重复解析）。
- **并发**：定位段（``_resolve_agent_log_read_target``，内部多处 ``await
  session.execute``）**串行**执行——AsyncSession 禁止并发使用；纯 RPC 段
  ``asyncio.Semaphore(3)`` 限并发；单 entry 复用 ``send_host_fs_rpc`` 默认 30s
  传输预算（2026-10-03-usage-ingest-session-concurrency：定位原在信号灯内并发，
  同一 session 多协程 execute 触发 SQLAlchemy 并发禁令，多日志批次摄取大面积
  失败，已修）。
- **scope 构造（Grill B-1）**：后台任务无请求上下文，按 ingest 的 workspace_id
  自构造 ``PlatformSyncAuthScope(workspace_id=...)`` 精确匹配复用
  ``_resolve_agent_log_read_target``（其内部只消费 workspace 归属做定位）。
- **后台任务自开短 session**（``get_session_factory()``，先例
  agent/worker_redispatch.py:394-419）+ 模块级强引用集防 GC（语义等价
  daemon/_background_tasks.fire_background_task 先例；类宿主形态不适用——本
  service 实例在任务体内才创建，host 无处安放）。
"""

from __future__ import annotations

import asyncio
import uuid
from datetime import UTC, datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.logging import get_logger
from app.modules.platform_sync.model import AgentSessionLogORM
from app.modules.platform_sync.schema import AgentLogEntry

log = get_logger(__name__)

#: 有解析器且输出 totalUsage 的 format 白名单（registry.ts 三解析器中 cursor 恒
#: null、codex 未注册——对它们发 RPC 是纯浪费，候选期直接过滤）。
INGEST_FORMATS: frozenset[str] = frozenset({"zcode-model-io-jsonl", "claude-code-jsonl"})

#: 节流窗口（秒）：size+mtime 未变且窗口内已成功解析过 → 跳过（design R-02）。
INGEST_THROTTLE_WINDOW_S: float = 300.0

#: 单次摄取的并发 RPC 上限（design R-02：一批最多 50 entry，限并发防 RPC 风暴）。
INGEST_CONCURRENCY: int = 3

#: 模块级强引用集（防 asyncio.create_task 的 task 被 GC——等价
#: BackgroundTaskMixin._background_tasks 语义，见模块 docstring）。
_background_tasks: set[asyncio.Task] = set()


def _on_ingest_task_done(task: asyncio.Task) -> None:
    """done 回调：出引用集 + 意外异常记日志（best-effort 任务自身不抛）。"""
    _background_tasks.discard(task)
    try:
        exc = task.exception()
    except (asyncio.InvalidStateError, asyncio.CancelledError):
        return
    if exc is not None:
        log.warning("usage_ingest_task_failed", exc_info=exc)


class AgentLogUsageIngestService:
    """agent-logs 用量快照摄取（上报后异步调用，覆盖写幂等）。"""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def ingest_for_push(
        self,
        workspace_id: uuid.UUID,
        entries: list[AgentLogEntry],
    ) -> int:
        """上报后摄取入口：候选筛选 → 节流 → 串行定位 → 并发 RPC 解析 → 覆盖写。

        Returns 本次成功落库快照的 entry 数（失败/跳过不计，不抛——best-effort）。
        """
        candidates = [
            e for e in entries if (e.format or "") in INGEST_FORMATS and e.exists is not False
        ]
        if not candidates:
            return 0

        # 上报是 (workspace_id, log_path) 整行覆盖 upsert——按复合键批量取回库中
        # 行（含归属/节流判定所需列），不在内存里猜 id。
        rows = (
            (
                await self._session.execute(
                    select(AgentSessionLogORM).where(
                        AgentSessionLogORM.workspace_id == workspace_id,
                        AgentSessionLogORM.log_path.in_([e.log_path for e in candidates]),
                    )
                )
            )
            .scalars()
            .all()
        )
        by_path = {r.log_path: r for r in rows}

        now = datetime.now(UTC)
        pending: list[AgentSessionLogORM] = []
        for entry in candidates:
            row = by_path.get(entry.log_path)
            if row is None:
                # upsert 已落库却查无此行：异常态，跳过等下次上报（不抛）。
                log.info("usage_ingest_row_missing", log_path=entry.log_path)
                continue
            if row.agent_session_id is None:
                # 无会话归属：daemon 两级定位第一步即回落 workspace 绑定，且聚合
                # 侧按会话锚点 SUM 永远取不到该行——解析无收益，跳过。
                continue
            if self._throttled(row, entry, now):
                continue
            pending.append(row)
        if not pending:
            return 0

        # 定位段串行（2026-10-03-usage-ingest-session-concurrency）：定位是摄取
        # 路径上唯一吃 session 的环节（内部多处 await session.execute），必须逐条
        # 在并发区外完成——AsyncSession 禁止并发使用，原实现定位在 Semaphore(3)
        # 内并发触发 SQLAlchemy 并发禁令，多日志批次摄取大面积失败。
        located: list[tuple[AgentSessionLogORM, uuid.UUID]] = []
        for row in pending:
            daemon_id = await self._locate_row(row)
            if daemon_id is not None:
                located.append((row, daemon_id))
        if not located:
            return 0

        sem = asyncio.Semaphore(INGEST_CONCURRENCY)

        async def _guarded(row: AgentSessionLogORM, daemon_id: uuid.UUID) -> bool:
            async with sem:
                return await self._ingest_one(row, daemon_id)

        results = await asyncio.gather(*[_guarded(r, d) for r, d in located])
        await self._session.commit()
        return sum(1 for ok in results if ok)

    async def _locate_row(self, row: AgentSessionLogORM) -> uuid.UUID | None:
        """单 entry 串行定位（session 查询；AppError/意外均降级跳过返回 None）。"""
        from app.core.errors import AppError
        from app.modules.platform_sync.auth import PlatformSyncAuthScope

        # 延迟 import：router 模块级 import 本模块（挂载 fire），反向 import 会
        # 成环——函数内解析先例见 router._resolve_agent_log_read_target 自身。
        from app.modules.platform_sync.router import _resolve_agent_log_read_target

        try:
            # Grill B-1：后台任务自构造 workspace 精确 scope（该函数只消费
            # workspace 归属做校验与定位，不做 token 校验）。返回的 entry 与 row
            # 同 session 同 id——identity map 下即同一对象，无需透传。
            _entry, daemon_id = await _resolve_agent_log_read_target(
                self._session,
                row.id,
                PlatformSyncAuthScope(workspace_id=row.workspace_id),
            )
        except AppError as exc:
            # 定位语义性失败（404 无绑定 daemon / 离线 / 超时 / 409 白名单外）——
            # 按 design R-03 静默跳过。
            log.info(
                "usage_ingest_skipped",
                entry_id=str(row.id),
                code=getattr(exc, "code", None),
            )
            return None
        except Exception:
            # 防御兜底：best-effort 语义下任何意外都不抛进上报链路。
            log.warning("usage_ingest_locate_unexpected_error", entry_id=str(row.id))
            return None
        return daemon_id

    @staticmethod
    def _throttled(row: AgentSessionLogORM, entry: AgentLogEntry, now: datetime) -> bool:
        """节流判定：日志未增长（size+mtime 与库一致）且 300s 内已解析过 → 跳过。"""
        if (
            row.size_bytes is not None
            and row.size_bytes == entry.size_bytes
            and row.mtime_ms is not None
            and row.mtime_ms == entry.mtime_ms
            and row.usage_parsed_at is not None
        ):
            parsed_at = row.usage_parsed_at
            if parsed_at.tzinfo is None:
                parsed_at = parsed_at.replace(tzinfo=UTC)
            return (now - parsed_at).total_seconds() < INGEST_THROTTLE_WINDOW_S
        return False

    async def _ingest_one(self, row: AgentSessionLogORM, daemon_id: uuid.UUID) -> bool:
        """单 entry 纯 RPC 解析 + 覆盖写（不经 session IO；全降级不抛）。

        只在并发区（Semaphore 内）调用：RPC 走 ws hub、覆盖写是纯内存 ORM 属性
        赋值——两段都不碰 session，AsyncSession 并发禁律由此满足。校验
        （model_validate）在 try 保护圈内：畸形 totalUsage 只废本条，不炸 gather
        丢弃同批已成功条目（2026-10-03-usage-ingest-session-concurrency）。
        """
        from app.core.errors import AppError

        # 延迟 import（防成环，同 _locate_row）。
        from app.modules.platform_sync.router import _send_agent_log_rpc
        from app.modules.platform_sync.schema import AgentLogTotalUsage

        try:
            result = await _send_agent_log_rpc(
                row,
                daemon_id,
                "read_agent_log_messages",
                {"path": row.log_path, "format": row.format},
                unsupported_on_method_not_found=True,
            )
            if result.get("status") != "parsed":
                # unsupported / parse_error / too_large——解析器已给分层结论，不落库。
                return False
            raw_usage = result.get("totalUsage")
            if not raw_usage:
                # 零 usage 时 daemon 契约为 null（不伪造 0）——无快照可落。
                return False
            usage = AgentLogTotalUsage.model_validate(raw_usage)
        except AppError as exc:
            # RPC 语义性失败（422 旧 daemon 未注册 / 离线 / 超时 / 409 白名单外 /
            # 502 网关）——按 design R-03 静默跳过。
            log.info(
                "usage_ingest_skipped",
                entry_id=str(row.id),
                code=getattr(exc, "code", None),
            )
            return False
        except Exception:
            # 防御兜底（含畸形 totalUsage 的 ValidationError）：best-effort 语义下
            # 任何意外都不抛进 gather/上报链路，只废本条。
            log.warning("usage_ingest_unexpected_error", entry_id=str(row.id))
            return False

        # 覆盖写幂等：全量解析结果整体替换五列（cacheWriteTokens 已由
        # validation_alias 对齐 cache_write_tokens；None 项按 0 落库——聚合侧
        # SUM(COALESCE) 口径与其等价，快照内保持确定性数值）。
        #
        # 输入口径归一（2026-10-03-local-usage-caliber-fix）：ZCode 日志的
        # inputTokens 是**总输入**（含缓存命中部分）——实测主会话 113 条调用
        # 恒满足 totalTokens == inputTokens + outputTokens，GLM/OpenAI 口径；
        # 而平台 agent_runs（Anthropic 口径）的 input_tokens 不含缓存命中。
        # 此处统一归一为「非缓存输入」（input − cache_read，下限 0），下游
        # 命中率公式 cache_read/(cache_read+input) 与「输入」展示语义即与
        # 平台执行完全对齐（旧口径曾把命中率从 ~98% 压到 ~50%）。
        raw_input = usage.input_tokens or 0
        cache_read = usage.cache_read_tokens or 0
        row.usage_input_tokens = max(0, raw_input - cache_read)
        row.usage_output_tokens = usage.output_tokens or 0
        row.usage_cache_read_tokens = cache_read
        row.usage_cache_write_tokens = usage.cache_write_tokens or 0
        row.usage_parsed_at = datetime.now(UTC)
        return True


async def run_usage_ingest_for_push(
    workspace_id: uuid.UUID,
    entries: list[AgentLogEntry],
) -> int:
    """后台任务体：自开短 session 执行摄取（不进请求事务，design R-06）。"""
    from app.core.db import get_session_factory

    async with get_session_factory()() as db:
        return await AgentLogUsageIngestService(db).ingest_for_push(workspace_id, entries)


def fire_usage_ingest_for_push(
    workspace_id: uuid.UUID,
    entries: list[AgentLogEntry],
) -> asyncio.Task:
    """fire-and-forget 摄取（router push_agent_logs 在 service commit 后调用）。"""
    task = asyncio.create_task(run_usage_ingest_for_push(workspace_id, entries))
    _background_tasks.add(task)
    task.add_done_callback(_on_ingest_task_done)
    log.info(
        "usage_ingest_fired",
        workspace_id=str(workspace_id),
        entries=len(entries),
    )
    return task
