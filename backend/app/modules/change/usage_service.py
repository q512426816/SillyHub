"""变更中心用量聚合只读服务（2026-08-30-change-center-usage-stats task-02 / FR-01 / FR-02）。

以「去重执行集合」为统一口径，为变更中心两个维度聚合执行用量（纯 SELECT，
零迁移、不改 daemon，D-003@v1 实时聚合）：

- 变更集合（D-002@v1 并集去重）：``agent_runs.change_id`` 派发锚点 ∪
  ``change_session_links`` 会话锚点，UNION 整行去重——同 run 双锚点只计一次；
- 快速修复集合：恒走 ``quicklog_session_links`` 会话链路（无派发锚点）；
- 详情两段聚合对齐 ``daemon/session/service.get_session_usage`` 先例：明细段
  ``agent_run_model_usage`` GROUP BY model，兜底段无明细 run 按 run 四维列
  ``COALESCE`` 归并（``ctx_tokens`` 快照列显式排除）；时间三元组与轮次在集合上
  ``MIN/MAX/SUM``（SQL 聚合忽略 NULL，全 NULL → None，R-05）。

数据流：router usage 端点（task-04）与 ``ChangeService.enrich_summaries`` /
quicklog 列表组装（task-03）→ 本服务 → ``ChangeUsageRead`` / ``UsageSummaryRead``
（schema.py task-01 DTO）→ 前端 ``api-types.ts`` 生成物（gen:types）。

聚合全部在 SQL 侧完成（子查询/UNION/GROUP BY，不拉 run 行进 Python 循环求和，
防 IN 膨胀与 N+1，R-03）；集合不 join ``agent_sessions`` 本体、不过滤
``deleted_at``（D-006@v1：软删会话消耗真实发生，计入统计；无
``agent_session_id`` 的孤儿 run 经派发锚点 ``change_id`` 仍命中，不丢数）。
"""

from __future__ import annotations

import uuid
from typing import Any

from sqlalchemy import Subquery, case, exists, func, select, union
from sqlalchemy.engine import RowMapping
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.errors import ChangeNotFound
from app.modules.agent.model import AgentRun, AgentRunModelUsage
from app.modules.change.model import Change, ChangeSessionLink, QuicklogSessionLink
from app.modules.change.schema import (
    ChangeUsageRead,
    UsageByModelItemRead,
    UsageSummaryRead,
    UsageTotalsRead,
)

#: 兜底桶名：run.model 为 NULL 的历史 run 归此桶，by_model 恒末位（R-04，
#: 对齐 by_provider「未记录」与 session-usage 同名先例）。
_UNRECORDED_MODEL = "未记录"


class ChangeUsageQueryService:
    """变更/快速修复执行用量的只读聚合服务（唯一数据源，对接线层 task-03/04）。

    服务类风格对齐同模块 ``ChangeService``：``__init__(session: AsyncSession)``
    注入会话，全部方法 async。四个公开方法即四个消费入口：

    - ``get_change_usage`` / ``get_quicklog_usage``：详情完整用量（两段聚合 +
      by_model，两个 usage 端点）；
    - ``summarize_changes`` / ``summarize_quicklogs``：列表批量摘要（一次查询
      出整页，零 N+1，R-03）。
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session

    # ── 详情：完整用量（ChangeUsageRead）───────────────────────────────

    async def get_change_usage(
        self, workspace_id: uuid.UUID, change_id: uuid.UUID
    ) -> ChangeUsageRead:
        """变更维度完整用量（D-002@v1 并集去重 + 两段聚合）。

        归属校验对齐 ``ChangeService.get`` 取法：``workspace_id + id`` DB 侧
        过滤取行，不存在/跨工作区同抛 :class:`ChangeNotFound`（404
        resource-hiding，不泄露存在性）。deleted 变更的读侧防复活 404 归
        router 层对齐（task-04，与既有详情端点同口径）。
        """
        owned = (
            await self._session.execute(
                select(Change.id).where(
                    col(Change.id) == change_id,
                    col(Change.workspace_id) == workspace_id,
                )
            )
        ).scalar_one_or_none()
        if owned is None:
            raise ChangeNotFound(
                "变更不存在，请检查变更 ID 是否正确或刷新变更列表。",
                details={
                    "workspace_id": str(workspace_id),
                    "change_id": str(change_id),
                },
            )
        return await self._aggregate_usage(self._change_run_ids(change_id))

    async def get_quicklog_usage(self, workspace_id: uuid.UUID, ql_id: str) -> ChangeUsageRead:
        """快速修复维度完整用量（恒走会话链路，聚合口径同详情）。

        不校验 ``quicklog_entries`` 行存在：条目双源合并（DB 推送 ∪ 文件解析），
        文件源条目无 DB 行；严格 404 语义由 router 层对齐详情端点做（task-04）。
        本方法对空集合返回全零 totals + 空 by_model + 三元组 None（R-05）。
        """
        return await self._aggregate_usage(self._quicklog_run_ids(workspace_id, ql_id))

    # ── 列表批量摘要（UsageSummaryRead，零 N+1）────────────────────────

    async def summarize_changes(
        self, change_ids: list[uuid.UUID]
    ) -> dict[uuid.UUID, UsageSummaryRead]:
        """一次查询出整页变更摘要（R-03：不逐行查询、不拉 run 行进内存）。

        (锚点 change_id, run) 两锚点 UNION 后外层 GROUP BY change_id；
        空列表零查询返回 ``{}``。无执行变更不进结果（调用方按 None 降级）。
        """
        if not change_ids:
            return {}
        rows = await self._summarize_anchor(self._change_summary_anchor(change_ids))
        return {row["group_key"]: self._row_to_summary(row) for row in rows}

    async def summarize_quicklogs(
        self, workspace_id: uuid.UUID, ql_ids: list[str]
    ) -> dict[str, UsageSummaryRead]:
        """一次查询出整页快速修复摘要（quicklog_session_links JOIN runs 后
        DISTINCT (ql_id, run_id) 再 GROUP BY ql_id）；空列表零查询返回 ``{}``。"""
        if not ql_ids:
            return {}
        rows = await self._summarize_anchor(self._quicklog_summary_anchor(workspace_id, ql_ids))
        return {row["group_key"]: self._row_to_summary(row) for row in rows}

    # ── 去重执行集合（子查询形态，两类口径共用）────────────────────────

    @staticmethod
    def _change_run_ids(change_id: uuid.UUID) -> Subquery:
        """变更侧去重执行集合（D-002@v1 并集去重）：

        ``agent_runs.change_id`` 派发锚点 UNION ``change_session_links`` 会话
        锚点（两分支均只选 id，UNION 整行去重 = 按 run 去重）——同 run 双锚点
        只计一次；跨变更共享会话时同一消耗在两个变更各完整计一次（R-03 口径
        特性，非 bug）。两锚点均经 change 定位（link 行挂 change、change 属
        workspace），天然限定本工作区，无需额外 workspace join。
        不过滤 ``agent_sessions.deleted_at``（D-006@v1 软删计入）；无
        ``agent_session_id`` 的孤儿 run 经派发锚点仍命中，不丢数。
        """
        dispatched = select(AgentRun.id).where(col(AgentRun.change_id) == change_id)
        linked = (
            select(AgentRun.id)
            .join(
                ChangeSessionLink,
                col(ChangeSessionLink.session_id) == col(AgentRun.agent_session_id),
            )
            .where(col(ChangeSessionLink.change_id) == change_id)
        )
        return union(dispatched, linked).subquery()

    @staticmethod
    def _quicklog_run_ids(workspace_id: uuid.UUID, ql_id: str) -> Subquery:
        """快速修复侧执行集合（无派发锚点，恒走会话链路）：

        ``quicklog_session_links`` 按 ``(workspace_id, ql_id)`` 定位 JOIN runs；
        DISTINCT 防御冗余（表上 ``unique(workspace_id, ql_id, session_id)`` 已
        保证 (ql_id, run_id) 不重，显式 DISTINCT 固化语义）。软删会话计入
        （D-006@v1）。
        """
        return (
            select(AgentRun.id)
            .join(
                QuicklogSessionLink,
                col(QuicklogSessionLink.session_id) == col(AgentRun.agent_session_id),
            )
            .where(
                col(QuicklogSessionLink.workspace_id) == workspace_id,
                col(QuicklogSessionLink.ql_id) == ql_id,
            )
            .distinct()
            .subquery()
        )

    @staticmethod
    def _run_metric_columns() -> list[Any]:
        """批量摘要锚点携带的 run 度量列（两分支 UNION 列同构）。

        ``ctx_tokens`` 是提示词大小快照列，显式不出现在任何 SUM（对齐详情
        兜底段口径，R-04）。
        """
        return [
            AgentRun.id.label("run_id"),
            AgentRun.started_at.label("started_at"),
            AgentRun.finished_at.label("finished_at"),
            AgentRun.duration_ms.label("duration_ms"),
            AgentRun.num_turns.label("num_turns"),
            AgentRun.input_tokens.label("input_tokens"),
            AgentRun.output_tokens.label("output_tokens"),
            AgentRun.cache_read_tokens.label("cache_read_tokens"),
            AgentRun.cache_creation_tokens.label("cache_creation_tokens"),
        ]

    @staticmethod
    def _change_summary_anchor(change_ids: list[uuid.UUID]) -> Subquery:
        """变更批量摘要锚点：(锚点 change_id, run 度量列) 两分支 UNION 整行去重。

        第二分支锚点列取 ``csl.change_id`` 而非 run 自带 ``change_id``——跨变更
        共享会话时 run 自带锚点可能指向别的变更或为 NULL，归属以 link 行为准；
        UNION 整行去重等价 ``(锚点 change_id, run_id)`` 维度去重（run_id 决定
        其余 run 列，D-002@v1 同 run 双锚点只计一次）。
        """
        cols = ChangeUsageQueryService._run_metric_columns()
        dispatched = select(col(AgentRun.change_id).label("group_key"), *cols).where(
            col(AgentRun.change_id).in_(change_ids)
        )
        linked = (
            select(col(ChangeSessionLink.change_id).label("group_key"), *cols)
            .select_from(AgentRun)
            .join(
                ChangeSessionLink,
                col(ChangeSessionLink.session_id) == col(AgentRun.agent_session_id),
            )
            .where(col(ChangeSessionLink.change_id).in_(change_ids))
        )
        return union(dispatched, linked).subquery()

    @staticmethod
    def _quicklog_summary_anchor(workspace_id: uuid.UUID, ql_ids: list[str]) -> Subquery:
        """快速修复批量摘要锚点：ql_id + run 度量列，DISTINCT (ql_id, run_id) 去重。"""
        return (
            select(
                col(QuicklogSessionLink.ql_id).label("group_key"),
                *ChangeUsageQueryService._run_metric_columns(),
            )
            .select_from(AgentRun)
            .join(
                QuicklogSessionLink,
                col(QuicklogSessionLink.session_id) == col(AgentRun.agent_session_id),
            )
            .where(
                col(QuicklogSessionLink.workspace_id) == workspace_id,
                col(QuicklogSessionLink.ql_id).in_(ql_ids),
            )
            .distinct()
            .subquery()
        )

    # ── 详情两段聚合（对齐 daemon/session/service.get_session_usage 范式）──

    async def _aggregate_usage(self, run_ids: Subquery) -> ChangeUsageRead:
        """集合上两段聚合 + 时间三元组，全部 SQL 侧完成（R-03 防膨胀）：

        1. 明细段（主源）：``agent_run_model_usage`` JOIN 集合，GROUP BY
           ``mu.model``，SUM 四维 token + ``api_requests``；
        2. 兜底段：集合中无任何明细行的 run（2026-08-29 之前的历史 run），NOT
           EXISTS 反连接（防 NOT IN 子查询膨胀），四维 token 列逐列
           ``SUM(COALESCE(col, 0))``，按 ``COALESCE(run.model, '未记录')`` 归并；
           ``api_requests`` 无来源恒 0（诚实值，R-04）；
        3. 时间三元组 + 轮次：集合上 ``MIN(started_at)`` / ``MAX(finished_at)``
           / ``SUM(duration_ms)`` / ``SUM(num_turns)``（D-001@v1 执行时间口径；
           SQL 聚合忽略 NULL，全 NULL → None，R-05 三种组合语义）。

        两段按 model 名 dict 归并求和（兜底段 run.model 可能与明细段同名——
        同名桶相加不丢）；by_model 按 input+output 降序、「未记录」恒末位；
        totals = 两段之和 + ``SUM(num_turns)``；空集合返回全 0 + 空 by_model。
        """
        in_set = AgentRun.id.in_(select(run_ids.c.id))

        # ── 明细段（主源）：usage 明细 × 集合 runs，GROUP BY model ──
        detail_stmt = (
            select(
                AgentRunModelUsage.model.label("model"),
                func.sum(AgentRunModelUsage.input_tokens).label("input_tokens"),
                func.sum(AgentRunModelUsage.output_tokens).label("output_tokens"),
                func.sum(AgentRunModelUsage.cache_read_tokens).label("cache_read_tokens"),
                func.sum(AgentRunModelUsage.cache_creation_tokens).label("cache_creation_tokens"),
                func.sum(AgentRunModelUsage.api_requests).label("api_requests"),
            )
            .join(AgentRun, AgentRunModelUsage.run_id == AgentRun.id)
            .where(in_set)
            .group_by(AgentRunModelUsage.model)
        )
        detail_rows = (await self._session.execute(detail_stmt)).mappings().all()

        # ── 兜底段：集合中无任何明细行的 run，四维 token 列求和 ──
        # run 级 token 列 nullable（老数据）→ 逐列 SUM(COALESCE(col, 0))；
        # ctx_tokens 是提示词大小快照列，严禁出现在任何 SUM。
        bucket = func.coalesce(AgentRun.model, _UNRECORDED_MODEL)
        fallback_stmt = (
            select(
                bucket.label("model"),
                func.sum(func.coalesce(AgentRun.input_tokens, 0)).label("input_tokens"),
                func.sum(func.coalesce(AgentRun.output_tokens, 0)).label("output_tokens"),
                func.sum(func.coalesce(AgentRun.cache_read_tokens, 0)).label("cache_read_tokens"),
                func.sum(func.coalesce(AgentRun.cache_creation_tokens, 0)).label(
                    "cache_creation_tokens"
                ),
            )
            .where(
                in_set,
                # NOT EXISTS 反连接：集合中无 agent_run_model_usage 行的 run。
                ~exists().where(AgentRunModelUsage.run_id == AgentRun.id),
            )
            .group_by(bucket)
        )
        fallback_rows = (await self._session.execute(fallback_stmt)).mappings().all()

        # ── 合并：按 model 名 dict 归并求和（两段同名桶相加，不丢）──
        buckets: dict[str, UsageByModelItemRead] = {}

        def _merge(
            name: str,
            input_t: int,
            output_t: int,
            cache_r: int,
            cache_c: int,
            api_r: int,
        ) -> None:
            cur = buckets.get(name)
            if cur is None:
                buckets[name] = UsageByModelItemRead(
                    model=name,
                    input_tokens=input_t,
                    output_tokens=output_t,
                    cache_read_tokens=cache_r,
                    cache_creation_tokens=cache_c,
                    api_requests=api_r,
                )
                return
            cur.input_tokens += input_t
            cur.output_tokens += output_t
            cur.cache_read_tokens += cache_r
            cur.cache_creation_tokens += cache_c
            cur.api_requests += api_r

        for row in detail_rows:
            _merge(
                str(row["model"]),
                int(row["input_tokens"] or 0),
                int(row["output_tokens"] or 0),
                int(row["cache_read_tokens"] or 0),
                int(row["cache_creation_tokens"] or 0),
                int(row["api_requests"] or 0),
            )
        for row in fallback_rows:
            # 兜底桶 api_requests 恒 0（历史 run 无调用次数来源，诚实值 R-04）。
            _merge(
                str(row["model"]),
                int(row["input_tokens"] or 0),
                int(row["output_tokens"] or 0),
                int(row["cache_read_tokens"] or 0),
                int(row["cache_creation_tokens"] or 0),
                0,
            )

        # ── 时间三元组 + 轮次（集合上聚合；无 GROUP BY 恒返回一行）──
        time_stmt = select(
            func.min(AgentRun.started_at).label("started_at"),
            func.max(AgentRun.finished_at).label("finished_at"),
            func.sum(AgentRun.duration_ms).label("duration_ms"),
            func.sum(AgentRun.num_turns).label("num_turns"),
        ).where(in_set)
        time_row = (await self._session.execute(time_stmt)).mappings().one()

        # by_model 排序：input+output 降序；「未记录」桶恒末位（即使总量最大）。
        by_model = sorted(
            buckets.values(),
            key=lambda item: (
                item.model == _UNRECORDED_MODEL,
                -(item.input_tokens + item.output_tokens),
            ),
        )
        totals = UsageTotalsRead(
            input_tokens=sum(item.input_tokens for item in by_model),
            output_tokens=sum(item.output_tokens for item in by_model),
            cache_read_tokens=sum(item.cache_read_tokens for item in by_model),
            cache_creation_tokens=sum(item.cache_creation_tokens for item in by_model),
            api_requests=sum(item.api_requests for item in by_model),
            # 轮次来自集合 agent_runs.num_turns（两段聚合均不含，单列在此求和）。
            num_turns=int(time_row["num_turns"] or 0),
        )
        return ChangeUsageRead(
            started_at=time_row["started_at"],
            finished_at=time_row["finished_at"],
            duration_ms=time_row["duration_ms"],
            totals=totals,
            by_model=by_model,
        )

    # ── 批量摘要外层聚合（变更/快速修复共用锚点形态）───────────────────

    async def _summarize_anchor(self, anchor: Subquery) -> list[RowMapping]:
        """锚点集合上一次 GROUP BY 出整页摘要行（R-03：不拉 run 行进内存）。

        token 四维取「明细优先、run 列兜底」的 per-run CASE——与详情两段聚合
        完全同口径（有 ``agent_run_model_usage`` 行的 run 取明细 SUM，无明细
        run 取 run 四维列 COALESCE 0），保证列表摘要与详情卡数字一致；
        ``api_requests`` 仅明细有来源（无明细 run 恒 0，R-04）；时间三元组与
        轮次直接在锚点 run 列上聚合（R-05 NULL 语义同详情）。
        """
        # 每 run 一行的明细汇总（限定锚点内 run，避免全表聚合；UNIQUE(run_id,
        # model) 下每 run 至多聚合出几行，再压成一行）。
        mu = (
            select(
                AgentRunModelUsage.run_id.label("run_id"),
                func.sum(AgentRunModelUsage.input_tokens).label("input_tokens"),
                func.sum(AgentRunModelUsage.output_tokens).label("output_tokens"),
                func.sum(AgentRunModelUsage.cache_read_tokens).label("cache_read_tokens"),
                func.sum(AgentRunModelUsage.cache_creation_tokens).label("cache_creation_tokens"),
                func.sum(AgentRunModelUsage.api_requests).label("api_requests"),
            )
            .where(AgentRunModelUsage.run_id.in_(select(anchor.c.run_id)))
            .group_by(AgentRunModelUsage.run_id)
            .subquery()
        )

        def prefer_mu(mu_col: Any, run_col: Any) -> Any:
            # LEFT JOIN 未命中（无明细 run）→ mu.run_id IS NULL → 取 run 列。
            return case(
                (mu.c.run_id.is_not(None), func.coalesce(mu_col, 0)),
                else_=func.coalesce(run_col, 0),
            )

        stmt = (
            select(
                anchor.c.group_key.label("group_key"),
                func.min(anchor.c.started_at).label("started_at"),
                func.max(anchor.c.finished_at).label("finished_at"),
                func.sum(anchor.c.duration_ms).label("duration_ms"),
                func.sum(prefer_mu(mu.c.input_tokens, anchor.c.input_tokens)).label("input_tokens"),
                func.sum(prefer_mu(mu.c.output_tokens, anchor.c.output_tokens)).label(
                    "output_tokens"
                ),
                func.sum(prefer_mu(mu.c.cache_read_tokens, anchor.c.cache_read_tokens)).label(
                    "cache_read_tokens"
                ),
                func.sum(
                    prefer_mu(mu.c.cache_creation_tokens, anchor.c.cache_creation_tokens)
                ).label("cache_creation_tokens"),
                # 兜底 run 无 mu 行 → COALESCE 后天然 0（与详情口径一致）。
                func.sum(func.coalesce(mu.c.api_requests, 0)).label("api_requests"),
                func.sum(anchor.c.num_turns).label("num_turns"),
            )
            .outerjoin(mu, mu.c.run_id == anchor.c.run_id)
            .group_by(anchor.c.group_key)
        )
        return list((await self._session.execute(stmt)).mappings().all())

    @staticmethod
    def _row_to_summary(row: RowMapping) -> UsageSummaryRead:
        """摘要行 → ``UsageSummaryRead``（NULL 安全：SUM 结果 or-0 / 三元组透传）。"""
        return UsageSummaryRead(
            started_at=row["started_at"],
            finished_at=row["finished_at"],
            duration_ms=row["duration_ms"],
            totals=UsageTotalsRead(
                input_tokens=int(row["input_tokens"] or 0),
                output_tokens=int(row["output_tokens"] or 0),
                cache_read_tokens=int(row["cache_read_tokens"] or 0),
                cache_creation_tokens=int(row["cache_creation_tokens"] or 0),
                api_requests=int(row["api_requests"] or 0),
                num_turns=int(row["num_turns"] or 0),
            ),
        )
