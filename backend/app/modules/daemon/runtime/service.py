"""Runtime subdomain service — registration / heartbeat / lifecycle."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Literal

from sqlalchemy import or_, select
from sqlalchemy import text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import AppError
from app.core.logging import get_logger
from app.modules.daemon.model import DaemonRuntime
from app.modules.workspace.model import Workspace

if TYPE_CHECKING:
    from app.modules.daemon.schema import RuntimeUsageRead

log = get_logger(__name__)

DEFAULT_RUNTIME_STALE_SECONDS = 45

# 时间窗选项(service 层用 Literal 类型注解,router 层用 Pydantic Enum 校验)。
RuntimeUsageWindow = Literal["1d", "7d", "30d"]


# ── Domain errors / RPC errors (runtime 主对象 + WS 通道层；task-07 迁入) ──────
# 原 facade service.py:43/100/107/114/121/128/135/142 字符级搬入。code/http_status/
# docstring/__init__ 零变化（B4）。RPC 错误族统一归 runtime 子包：根因是 runtime
# 的 WS 连接态/通道问题，runtime 子域已持有 WS 连接管理（B2）。


class DaemonRuntimeNotFound(AppError):
    code = "HTTP_404_DAEMON_RUNTIME_NOT_FOUND"
    http_status = 404


class DaemonRuntimeInUse(AppError):
    """Daemon runtime 仍被一个或多个 workspace 绑定（R-06 RESTRICT）。

    ``workspaces.daemon_runtime_id`` 外键按设计是 RESTRICT（workspace/model.py
    + migration 202607030900 注释）：删除一个仍在为 workspace 服务的 daemon 应被
    阻止。这里把它翻译成 409 + 绑定 workspace 列表，让调用方先去解绑，而不是让 DB
    的 IntegrityError 冒泡成 500。
    """

    code = "HTTP_409_DAEMON_RUNTIME_IN_USE"
    http_status = 409


class DaemonRuntimeOffline(AppError):
    """Target daemon runtime has no active WS connection (R-01)."""

    code = "HTTP_504_DAEMON_RUNTIME_OFFLINE"
    http_status = 504


# ── RPC errors (WS 通道层；root cause 是 runtime 连接态/通道问题) ────────────


class DaemonRpcTimeout(AppError):
    """RPC round-trip exceeded the per-call timeout (R-01)."""

    code = "HTTP_504_DAEMON_RPC_TIMEOUT"
    http_status = 504


class DaemonRpcConflict(AppError):
    """rpc_id collision in the pending map (UUID4 practical impossibility)."""

    code = "HTTP_409_DAEMON_RPC_ID_CONFLICT"
    http_status = 409


class DaemonRpcGatewayError(AppError):
    """WS channel-layer failure (offline / timeout / send failure) → 504."""

    code = "HTTP_504_DAEMON_RPC_GATEWAY"
    http_status = 504


class DaemonRpcForbiddenError(AppError):
    """daemon returned error.code=forbidden (allowed_roots violation, FR-04)."""

    code = "HTTP_403_DAEMON_RPC_FORBIDDEN"
    http_status = 403


class DaemonRpcRemoteGatewayError(AppError):
    """daemon returned a non-forbidden business error → 502."""

    code = "HTTP_502_DAEMON_RPC_REMOTE"
    http_status = 502


class DaemonRpcRemoteError(Exception):
    """Internal signal carrying a daemon error dict up the send_rpc call chain.

    Deliberately NOT an AppError: the HTTP endpoint re-maps it to
    DaemonRpcForbiddenError (403) or DaemonRpcRemoteGatewayError (502), so the
    raw daemon code/message never leaks directly to HTTP status mapping.
    """

    def __init__(self, error: dict) -> None:
        self.code = error.get("code", "unknown")
        self.message = error.get("message", "")
        super().__init__(f"daemon rpc error: {self.code}: {self.message}")


class RuntimeService:
    """Runtime lifecycle: register / heartbeat / enable / disable / cleanup."""

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    async def register_runtime(
        self,
        user_id: uuid.UUID,
        *,
        name: str | None = None,
        provider: str | None = None,
        version: str | None = None,
        os: str | None = None,
        arch: str | None = None,
        capabilities: dict | None = None,
    ) -> DaemonRuntime:
        """Register a new daemon runtime or return existing one (idempotent).

        If a runtime with the same user_id + provider + name already exists,
        update its fields and return it. Otherwise create a new record.
        """
        now = datetime.now(UTC)

        # Try to find existing runtime by user_id + provider + name
        stmt = select(DaemonRuntime).where(
            col(DaemonRuntime.user_id) == user_id,
            col(DaemonRuntime.provider) == provider,
            col(DaemonRuntime.name) == name,
        )
        existing = (await self._session.execute(stmt)).scalars().first()

        if existing is not None:
            # Update existing record
            existing.version = version
            existing.os = os
            existing.arch = arch
            existing.capabilities = capabilities
            if existing.status != "disabled":
                existing.status = "online"
            existing.last_heartbeat_at = now
            existing.updated_at = now
            self._session.add(existing)
            await self._session.commit()
            await self._session.refresh(existing)
            log.info(
                "daemon_runtime_reregistered",
                runtime_id=str(existing.id),
                user_id=str(user_id),
                provider=provider,
            )
            return existing

        # Create new runtime
        runtime = DaemonRuntime(
            id=uuid.uuid4(),
            user_id=user_id,
            name=name,
            provider=provider,
            version=version,
            os=os,
            arch=arch,
            status="online",
            last_heartbeat_at=now,
            capabilities=capabilities,
            metadata_={},
        )
        self._session.add(runtime)
        await self._session.commit()
        await self._session.refresh(runtime)
        log.info(
            "daemon_runtime_registered",
            runtime_id=str(runtime.id),
            user_id=str(user_id),
            provider=provider,
        )
        return runtime

    async def heartbeat(self, runtime_id: uuid.UUID) -> DaemonRuntime:
        """Update heartbeat timestamp for a daemon runtime."""
        runtime = await self._session.get(DaemonRuntime, runtime_id)
        if runtime is None:
            raise DaemonRuntimeNotFound(
                f"Daemon runtime '{runtime_id}' not found.",
                details={"runtime_id": str(runtime_id)},
            )

        now = datetime.now(UTC)
        runtime.last_heartbeat_at = now
        if runtime.status != "disabled":
            runtime.status = "online"
        runtime.updated_at = now
        self._session.add(runtime)
        await self._session.commit()
        await self._session.refresh(runtime)
        return runtime

    async def get_runtime(self, runtime_id: uuid.UUID) -> DaemonRuntime | None:
        """Get a daemon runtime by ID."""
        return await self._session.get(DaemonRuntime, runtime_id)

    async def list_runtimes(self, user_id: uuid.UUID) -> list[DaemonRuntime]:
        """List all runtimes for a given user."""
        stmt = (
            select(DaemonRuntime)
            .where(col(DaemonRuntime.user_id) == user_id)
            .order_by(col(DaemonRuntime.created_at).desc())
        )
        return list((await self._session.execute(stmt)).scalars().all())

    async def mark_offline(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID | None = None,
    ) -> DaemonRuntime:
        """Mark a daemon runtime as offline."""
        runtime = await self._session.get(DaemonRuntime, runtime_id)
        if runtime is None or (user_id is not None and runtime.user_id != user_id):
            raise DaemonRuntimeNotFound(
                f"Daemon runtime '{runtime_id}' not found.",
                details={"runtime_id": str(runtime_id)},
            )
        now = datetime.now(UTC)
        if runtime.status != "disabled":
            runtime.status = "offline"
        runtime.updated_at = now
        self._session.add(runtime)
        await self._session.commit()
        await self._session.refresh(runtime)
        return runtime

    async def disable_runtime(self, runtime_id: uuid.UUID, user_id: uuid.UUID) -> DaemonRuntime:
        """Disable a runtime for placement without losing heartbeat freshness."""
        runtime = await self._get_owned_runtime(runtime_id, user_id)
        now = datetime.now(UTC)
        runtime.status = "disabled"
        runtime.updated_at = now
        self._session.add(runtime)
        await self._session.commit()
        await self._session.refresh(runtime)
        return runtime

    async def delete_runtime(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> None:
        """Physically delete an owned runtime (ql-20260621-012).

        DB ondelete=CASCADE removes bound ``daemon_task_leases`` and
        ``agent_sessions`` rows automatically. The daemon re-registers as a
        fresh runtime on its next heartbeat.

        ``workspaces.daemon_runtime_id`` 是 RESTRICT（R-06 cascade 明确 out of
        scope）：若有未软删 workspace 仍绑定本 runtime，抛 ``DaemonRuntimeInUse``
        (409) 并带 workspace 列表，让调用方先解绑，而非让 FK 违约束冒泡成 500。
        """
        runtime = await self._get_owned_runtime(runtime_id, user_id)
        # 删前检查：被未软删 workspace 绑定的 runtime 不允许物理删除（RESTRICT）。
        # 排除 deleted_at IS NOT NULL 的软删 workspace，否则会永久卡住删除。
        bound = (
            await self._session.execute(
                select(Workspace.id, Workspace.name, Workspace.slug).where(
                    col(Workspace.daemon_runtime_id) == runtime_id,
                    col(Workspace.deleted_at).is_(None),
                )
            )
        ).all()
        if bound:
            names = ", ".join(row.slug or row.name or str(row.id) for row in bound)
            raise DaemonRuntimeInUse(
                f"该 daemon 仍被 {len(bound)} 个 workspace 绑定（{names}），"
                "请先在对应 workspace 中解除绑定后再删除",
                details={
                    "workspaces": [
                        {"id": str(row.id), "name": row.name, "slug": row.slug} for row in bound
                    ],
                },
            )
        await self._session.delete(runtime)
        await self._session.commit()

    async def enable_runtime(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID,
        *,
        max_age_seconds: int = DEFAULT_RUNTIME_STALE_SECONDS,
    ) -> DaemonRuntime:
        """Enable a runtime, restoring online only when its heartbeat is fresh."""
        runtime = await self._get_owned_runtime(runtime_id, user_id)
        now = datetime.now(UTC)
        runtime.status = (
            "online"
            if self._is_recent_heartbeat(runtime.last_heartbeat_at, max_age_seconds)
            else "offline"
        )
        runtime.updated_at = now
        self._session.add(runtime)
        await self._session.commit()
        await self._session.refresh(runtime)
        return runtime

    async def cleanup_stale_runtimes(
        self,
        max_age_seconds: int = DEFAULT_RUNTIME_STALE_SECONDS,
    ) -> int:
        """Mark runtimes as offline if heartbeat is older than max_age_seconds."""
        cutoff = datetime.now(UTC) - timedelta(seconds=max_age_seconds)
        stmt = select(DaemonRuntime).where(
            col(DaemonRuntime.status) == "online",
            or_(
                col(DaemonRuntime.last_heartbeat_at).is_(None),
                col(DaemonRuntime.last_heartbeat_at) < cutoff,
            ),
        )
        stale = list((await self._session.execute(stmt)).scalars().all())
        now = datetime.now(UTC)
        for runtime in stale:
            runtime.status = "offline"
            runtime.updated_at = now
            self._session.add(runtime)
        if stale:
            await self._session.commit()
        return len(stale)

    async def _get_owned_runtime(
        self,
        runtime_id: uuid.UUID,
        user_id: uuid.UUID,
    ) -> DaemonRuntime:
        runtime = await self._session.get(DaemonRuntime, runtime_id)
        if runtime is None or runtime.user_id != user_id:
            raise DaemonRuntimeNotFound(
                f"Daemon runtime '{runtime_id}' not found.",
                details={"runtime_id": str(runtime_id)},
            )
        return runtime

    @staticmethod
    def _is_recent_heartbeat(value: datetime | None, max_age_seconds: int) -> bool:
        if value is None:
            return False
        heartbeat_at = value if value.tzinfo else value.replace(tzinfo=UTC)
        return heartbeat_at >= datetime.now(UTC) - timedelta(seconds=max_age_seconds)

    # ── Usage aggregation (FR-03 / D-002@v1 / D-003@v2 / D-004@v1) ──────────────

    async def get_runtimes_usage(
        self,
        window: RuntimeUsageWindow,
    ) -> list[RuntimeUsageRead]:
        """Batch-aggregate token/cache/cost usage per runtime over a time window.

        单条 LEFT JOIN+COALESCE SQL 去重(D-003@v2):每 run 经 ``agent_session_id`` /
        ``lease_id`` 各 LEFT JOIN 后唯一一行,``COALESCE(s.runtime_id, l.runtime_id)``
        优先 session,interactive run 同时挂 session+lease 也只算一次(R-03 resolved)。

        分组粒度(D-002@v1):1d→hour 桶(≤24 点),7d/30d→day 桶。
        since(D-004@v1):1d=本地自然日 today 00:00 转 UTC;7d/30d=now(UTC)-N 天。

        ⚠️ 方言分支(R-05):生产 PostgreSQL 用 ``date_trunc``;后端单测用 SQLite
        in-memory(conftest.py),SQLite 无 ``date_trunc``,改用 ``strftime``。
        通过 ``self._session.bind.dialect.name`` 分支。

        ⚠️ SQLite 时区比较陷阱(R-05 补充):SQLAlchemy ``DateTime(timezone=True)`` 列
        在 aiosqlite 下走 ORM 写入时**丢弃时区信息**,aware datetime 被存成本地 naive
        时刻(本地 +08:00 的 ``23:59:00`` 存成 naive ``23:59:00``),且 SQLite 字符串
        比较不识别 tz 后缀。故 SQLite 方言下:
        - WHERE 用 ``datetime(r.created_at) >= :since``(归一化,naive 不转 UTC);
        - ``since`` 传**本地 naive**(对齐 ORM 存储的本地 naive),见 ``_since_param``。
        生产 PG 是 timestamptz 原生 UTC 比较,WHERE 用 ``r.created_at >= :since`` 且
        since 传 aware UTC,不受此影响。
        """
        if window not in ("1d", "7d", "30d"):
            raise ValueError(f"invalid window: {window!r} (expected 1d|7d|30d)")

        since = self._compute_since(window)
        unit = self._bucket_unit(window)
        dialect = self._dialect_name()
        since_param = self._since_param(since, dialect)

        # ── summary(无时间桶)──
        summary_sql = sa_text(self._build_summary_sql(dialect))
        summary_rows = (
            (await self._session.execute(summary_sql, {"since": since_param})).mappings().all()
        )

        # ── daily(按时间桶;方言分支:PG date_trunc / SQLite strftime)──
        daily_sql = sa_text(self._build_daily_sql(dialect, unit))
        daily_params: dict[str, object] = {"since": since_param}
        if dialect == "postgresql":
            daily_params["unit"] = unit
        daily_rows = (await self._session.execute(daily_sql, daily_params)).mappings().all()

        # ── 聚合成 RuntimeUsageRead(延迟 import 避免循环依赖)──
        from app.modules.daemon.schema import (
            RuntimeUsagePointRead,
            RuntimeUsageRead,
            RuntimeUsageSummaryRead,
        )

        summary_map: dict[str, RuntimeUsageSummaryRead] = {
            str(row["rid"]): RuntimeUsageSummaryRead(
                input_tokens=int(row["input_tokens"] or 0),
                output_tokens=int(row["output_tokens"] or 0),
                cache_read_tokens=int(row["cache_read_tokens"] or 0),
                cache_creation_tokens=int(row["cache_creation_tokens"] or 0),
                total_cost_usd=float(row["total_cost_usd"] or 0.0),
            )
            for row in summary_rows
        }
        daily_map: dict[str, list[RuntimeUsagePointRead]] = {}
        for row in daily_rows:
            rid = str(row["rid"])
            daily_map.setdefault(rid, []).append(
                RuntimeUsagePointRead(
                    ts=self._normalize_bucket_ts(row["bucket"], dialect),
                    input_tokens=int(row["input_tokens"] or 0),
                    output_tokens=int(row["output_tokens"] or 0),
                    cache_read_tokens=int(row["cache_read_tokens"] or 0),
                    cache_creation_tokens=int(row["cache_creation_tokens"] or 0),
                    total_cost_usd=float(row["total_cost_usd"] or 0.0),
                )
            )

        result = [
            RuntimeUsageRead(runtime_id=rid, summary=summary_map[rid], daily=daily_map.get(rid, []))
            for rid in summary_map
        ]
        log.info("runtime_usage_aggregated", window=window, runtime_count=len(result))
        return result

    def _dialect_name(self) -> str:
        """检测当前 session 绑定的 DB 方言名(postgresql / sqlite / ...)。

        AsyncSession.bind 返回 AsyncEngine,其 .dialect.name 用于分支:
        PG 用 ``date_trunc``,SQLite 用 ``strftime``(SQLite 无 date_trunc)。
        """
        bind = self._session.bind
        # AsyncEngine.dialect 同步暴露;async 绑定是 AsyncEngine(单测+生产均如此)。
        return bind.dialect.name

    @staticmethod
    def _since_param(since: datetime, dialect: str) -> datetime | str:
        """since 参数方言化(R-05 时区陷阱修复)。

        - PostgreSQL: 直接传 aware UTC datetime,timestamptz 列原生比较。
        - SQLite: ⚠️ 关键陷阱 —— SQLAlchemy ``DateTime(timezone=True)`` 列在
          aiosqlite 下走 ORM 写入时**丢弃时区信息**,aware datetime 被存成本地
          naive 时刻(如本地 +08:00 的 ``2026-06-23 23:59:00+08:00`` 存成 naive
          ``2026-06-23 23:59:00``)。``datetime(created_at)`` 对 naive 输入不做
          UTC 转换,原样返回 23:59。故 since 也必须用**本地 naive**与之对齐,
          否则比较错位(UTC 16:00 vs 本地 naive 23:59 → 昨天 run 被错误计入 1d 窗)。
          实现把 aware since 转**本地 tz** 再 strip tzinfo,格式化为
          ``YYYY-MM-DD HH:MM:SS.ffffff``(匹配 ``datetime()`` 输出)。
          生产 PG 是 timestamptz 原生 UTC 比较,不受此影响。
        """
        if dialect == "postgresql":
            return since
        # SQLite:转本地 tz naive(对齐 ORM 存储的本地 naive 时刻)
        since_local_naive = since.astimezone().replace(tzinfo=None)
        return since_local_naive.isoformat(sep=" ")

    @staticmethod
    def _build_summary_sql(dialect: str) -> str:
        """summary SQL(无时间桶),WHERE created_at 比较按方言归一化。

        - PG: ``r.created_at >= :since``(timestamptz 原生比较,since=aware UTC)。
        - SQLite: ``datetime(r.created_at) >= :since``(naive 原样归一化,since=本地 naive,
          对齐 ORM 存储的本地 naive 时刻,见 ``_since_param`` docstring)。
        """
        cmp = "r.created_at" if dialect == "postgresql" else "datetime(r.created_at)"
        return f"""
            SELECT COALESCE(s.runtime_id, l.runtime_id) AS rid,
                   SUM(COALESCE(r.input_tokens, 0))          AS input_tokens,
                   SUM(COALESCE(r.output_tokens, 0))         AS output_tokens,
                   SUM(COALESCE(r.cache_read_tokens, 0))     AS cache_read_tokens,
                   SUM(COALESCE(r.cache_creation_tokens, 0)) AS cache_creation_tokens,
                   SUM(COALESCE(r.total_cost_usd, 0))        AS total_cost_usd
            FROM agent_runs r
            LEFT JOIN agent_sessions s ON r.agent_session_id = s.id
            LEFT JOIN daemon_task_leases l ON r.lease_id = l.id
            WHERE COALESCE(s.runtime_id, l.runtime_id) IS NOT NULL
              AND {cmp} >= :since
            GROUP BY COALESCE(s.runtime_id, l.runtime_id)
        """

    @staticmethod
    def _build_daily_sql(dialect: str, unit: Literal["hour", "day"]) -> str:
        """构造 daily 时间桶 SQL,按方言分支(R-05)。

        - PostgreSQL: ``date_trunc(:unit, r.created_at) AS bucket`` — 参数化 unit,
          PG 原生支持;WHERE 用 ``r.created_at >= :since``(since=aware UTC)。
        - SQLite: ``strftime('<fmt>', r.created_at) AS bucket`` — hour 桶用
          ``%Y-%m-%d %H``(YYYY-MM-DD HH),day 桶用 ``%Y-%m-%d``;WHERE 用
          ``datetime(r.created_at) >= :since``(since=本地 naive,对齐 ORM 存储)。

        ⚠️ SQLite 的 strftime 返回 TEXT(本地 naive 桶),PG 的 date_trunc 返回 timestamptz;
        ``_normalize_bucket_ts`` 统一把 bucket 解析成 aware UTC datetime(测试只断言
        「ts 整点 + 桶数量」,不绑死时区,故生产/测试桶时区差异不影响断言)。
        """
        if dialect == "postgresql":
            return """
                SELECT COALESCE(s.runtime_id, l.runtime_id) AS rid,
                       date_trunc(:unit, r.created_at)          AS bucket,
                       SUM(COALESCE(r.input_tokens, 0))          AS input_tokens,
                       SUM(COALESCE(r.output_tokens, 0))         AS output_tokens,
                       SUM(COALESCE(r.cache_read_tokens, 0))     AS cache_read_tokens,
                       SUM(COALESCE(r.cache_creation_tokens, 0)) AS cache_creation_tokens,
                       SUM(COALESCE(r.total_cost_usd, 0))        AS total_cost_usd
                FROM agent_runs r
                LEFT JOIN agent_sessions s ON r.agent_session_id = s.id
                LEFT JOIN daemon_task_leases l ON r.lease_id = l.id
                WHERE COALESCE(s.runtime_id, l.runtime_id) IS NOT NULL
                  AND r.created_at >= :since
                GROUP BY COALESCE(s.runtime_id, l.runtime_id),
                         date_trunc(:unit, r.created_at)
                ORDER BY bucket ASC
            """
        # SQLite(及任何非 PG 方言,fallback 到 strftime)
        fmt = "%Y-%m-%d %H" if unit == "hour" else "%Y-%m-%d"
        # fmt 是内部常量(unit 受控为 'hour'|'day'),无 SQL 注入风险。
        return f"""
            SELECT COALESCE(s.runtime_id, l.runtime_id) AS rid,
                   strftime('{fmt}', r.created_at)         AS bucket,
                   SUM(COALESCE(r.input_tokens, 0))          AS input_tokens,
                   SUM(COALESCE(r.output_tokens, 0))         AS output_tokens,
                   SUM(COALESCE(r.cache_read_tokens, 0))     AS cache_read_tokens,
                   SUM(COALESCE(r.cache_creation_tokens, 0)) AS cache_creation_tokens,
                   SUM(COALESCE(r.total_cost_usd, 0))        AS total_cost_usd
            FROM agent_runs r
            LEFT JOIN agent_sessions s ON r.agent_session_id = s.id
            LEFT JOIN daemon_task_leases l ON r.lease_id = l.id
            WHERE COALESCE(s.runtime_id, l.runtime_id) IS NOT NULL
              AND datetime(r.created_at) >= :since
            GROUP BY COALESCE(s.runtime_id, l.runtime_id),
                     strftime('{fmt}', r.created_at)
            ORDER BY bucket ASC
        """

    @staticmethod
    def _normalize_bucket_ts(bucket: object, dialect: str) -> datetime:
        """把 SQL 返回的 bucket 列统一解析成 aware UTC datetime。

        - PostgreSQL: ``date_trunc`` 返回 timestamptz/aware datetime,直接返回。
        - SQLite: ``strftime`` 返回 TEXT(``YYYY-MM-DD HH`` 或 ``YYYY-MM-DD``),
          解析为 naive datetime 后补 UTC tzinfo(桶本就是 UTC 归一化的)。
        """
        if isinstance(bucket, datetime):
            return bucket if bucket.tzinfo is not None else bucket.replace(tzinfo=UTC)
        # SQLite TEXT 桶
        text_bucket = str(bucket)
        for fmt in ("%Y-%m-%d %H", "%Y-%m-%d"):
            try:
                return datetime.strptime(text_bucket, fmt).replace(tzinfo=UTC)
            except ValueError:
                continue
        # 兜底:fromisoformat(覆盖 ``YYYY-MM-DDTHH:MM:SS`` 等)
        return datetime.fromisoformat(text_bucket).replace(tzinfo=UTC)

    @staticmethod
    def _bucket_unit(window: RuntimeUsageWindow) -> Literal["hour", "day"]:
        """分组粒度(D-002@v1):1d→hour,7d/30d→day。"""
        return "hour" if window == "1d" else "day"

    @staticmethod
    def _compute_since(window: RuntimeUsageWindow) -> datetime:
        """起点(D-004@v1):1d=本地自然日 today 00:00 转 UTC;7d/30d=now(UTC)-N 天。

        created_at 为 timestamptz,返回 aware UTC datetime;SQLite 方言下再由
        ``_since_param`` 转 UTC naive ISO 字符串比较。
        """
        now_utc = datetime.now(UTC)
        if window == "1d":
            # 本地自然日 today 00:00;用本地时间计算再转 UTC
            local_now = now_utc.astimezone()  # 转本地 tz-aware
            local_midnight = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
            return local_midnight.astimezone(UTC)
        delta = {"7d": timedelta(days=7), "30d": timedelta(days=30)}[window]
        return now_utc - delta
