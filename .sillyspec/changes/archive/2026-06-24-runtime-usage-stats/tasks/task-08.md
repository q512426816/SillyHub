---
id: task-08
title: RuntimeService.get_runtimes_usage(window) 聚合接口(LEFT JOIN+COALESCE 去重核心)
priority: P0
estimated_hours: 5
depends_on: [task-04, task-05]
blocks: [task-10, task-15]
requirement_ids: [FR-03]
decision_ids: [D-002@v1, D-003@v2, D-004@v1]
allowed_paths:
  - backend/app/modules/daemon/runtime/service.py
author: qinyi
created_at: 2026-06-24 10:55:18
---

# task-08: RuntimeService.get_runtimes_usage(window) 聚合接口

## 修改文件（必填）

- `backend/app/modules/daemon/runtime/service.py` — 新增 `RuntimeService.get_runtimes_usage(window)` 异步方法 + 私有 `_compute_since(window)` / `_bucket_unit(window)` 辅助。不改动现有 register/heartbeat/lifecycle 方法。

## 覆盖来源

- Requirements: FR-03(按 runtime + 时间窗聚合 token/cache/cost,批量返回)
- Decisions:
  - D-002@v1(分组粒度:1d→`date_trunc('hour')` 24 点;7d/30d→`date_trunc('day')`)
  - D-003@v2(单条 SQL `LEFT JOIN agent_sessions s` + `LEFT JOIN daemon_task_leases l`,`GROUP BY COALESCE(s.runtime_id, l.runtime_id)` 去重;替代 D-003@v1 的 UNION 双路径,避免 interactive run 同时挂 session+lease 被算两次)
  - D-004@v1(`since` = 本地自然日 today 00:00,转 UTC 与 timestamptz `created_at` 比较;非实时刷新)

## 实现要求

1. 在 `RuntimeService` 中新增方法 `get_runtimes_usage(window)`,**不改动现有方法签名**。
2. **单条聚合 SQL**(summary,daily 结构相同只多一列 `bucket`)按 D-003@v2 实现,使用 SQLAlchemy `text()` 执行原生 PG SQL(参考 router.py:1268-1281 的 `sa_text` + `session.execute(sql, params)` + `result.mappings().all()` 模式)。**禁止 UNION 双路径**(D-003@v1 已被 v2 取代,会有重复计算)。
3. **每 run LEFT JOIN 后唯一一行去重**:`agent_runs r LEFT JOIN agent_sessions s ON r.agent_session_id=s.id LEFT JOIN daemon_task_leases l ON r.lease_id=l.id`。因 `agent_session_id`/`lease_id` 各为 FK 指向唯一行,LEFT JOIN 后每 run 仅产一行,`COALESCE(s.runtime_id, l.runtime_id)` 优先 session.runtime_id,天然去重(R-03 resolved)。
4. **时间过滤**:`WHERE COALESCE(s.runtime_id, l.runtime_id) IS NOT NULL AND r.created_at >= :since`。
5. **分组粒度**(D-002@v1):
   - `window="1d"`:`date_trunc('hour', r.created_at) AS bucket`
   - `window="7d"` / `window="30d"`:`date_trunc('day', r.created_at) AS bucket`
6. **since 计算**(D-004@v1):
   - `1d`:本地今天 00:00(aware datetime)转 UTC。
   - `7d`:now(UTC) - 7 天。
   - `30d`:now(UTC) - 30 天。
   - `created_at` 为 `timestamptz`,比较前确保 since 为 aware UTC。
7. 返回 `list[RuntimeUsageRead]`(task-09 定义);summary 查询无 bucket 分组,daily 查询带 bucket 分组后按 `runtime_id` 聚合成 list。
8. SQL 参数绑定用 named params(`:since`)防注入。
9. 不写 cache 列读取的 NULL 兼容(`SUM(COALESCE(r.cache_read_tokens, 0))`),确保老 NULL 数据求和为 0(FR-05)。
10. 进度日志:`log.info("runtime_usage_aggregated", window=window, runtime_count=len(result))`。

## 接口定义（代码类必填）

```python
# backend/app/modules/daemon/runtime/service.py(在 RuntimeService 类内新增)

from typing import Literal
from sqlalchemy import text as sa_text

RuntimeUsageWindow = Literal["1d", "7d", "30d"]

class RuntimeService:
    # ... 现有方法不动 ...

    async def get_runtimes_usage(
        self,
        window: RuntimeUsageWindow,
    ) -> list["RuntimeUsageRead"]:
        """Batch-aggregate token/cache/cost usage per runtime over a time window.

        单条 LEFT JOIN+COALESCE SQL 去重(D-003@v2);1d 按 hour / 7d·30d 按 day
        分组(D-002@v1);since 本地自然日(D-004@v1)。
        """
        since = self._compute_since(window)
        unit = self._bucket_unit(window)  # 'hour' | 'day'

        # ── summary(无时间桶)──
        summary_sql = sa_text(
            """
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
              AND r.created_at >= :since
            GROUP BY COALESCE(s.runtime_id, l.runtime_id)
            """
        )
        summary_rows = (
            (await self._session.execute(summary_sql, {"since": since}))
            .mappings()
            .all()
        )

        # ── daily(按 date_trunc 时间桶)──
        daily_sql = sa_text(
            f"""
            SELECT COALESCE(s.runtime_id, l.runtime_id) AS rid,
                   date_trunc(:unit, r.created_at)      AS bucket,
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
            GROUP BY COALESCE(s.runtime_id, l.runtime_id), date_trunc(:unit, r.created_at)
            ORDER BY bucket ASC
            """
        )
        daily_rows = (
            (await self._session.execute(
                daily_sql, {"since": since, "unit": unit}
            ))
            .mappings()
            .all()
        )

        # 按 rid 聚合成 RuntimeUsageRead(延迟 import 避免循环)
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
                    ts=row["bucket"],
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

    @staticmethod
    def _bucket_unit(window: RuntimeUsageWindow) -> Literal["hour", "day"]:
        """分组粒度(D-002@v1):1d→hour,7d/30d→day。"""
        return "hour" if window == "1d" else "day"

    @staticmethod
    def _compute_since(window: RuntimeUsageWindow) -> datetime:
        """起点(D-004@v1):1d=本地自然日 today 00:00 转 UTC;7d/30d=now(UTC)-N 天。

        created_at 为 timestamptz,返回 aware UTC datetime。
        """
        now_utc = datetime.now(UTC)
        if window == "1d":
            # 本地自然日 today 00:00;用本地时间计算再转 UTC
            local_now = now_utc.astimezone()  # 转本地 tz-aware
            local_midnight = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
            return local_midnight.astimezone(UTC)
        delta = {"7d": timedelta(days=7), "30d": timedelta(days=30)}[window]
        return now_utc - delta
```

## 边界处理（必填,至少5条）

1. **无 runtime 归属的 run(COALESCE IS NULL 不计入)**:WHERE 子句 `COALESCE(s.runtime_id, l.runtime_id) IS NOT NULL` 显式过滤掉 session 和 lease 都无 runtime_id 的孤儿 run(既无 agent_session_id 也 session.runtime_id 为 NULL,且无 lease_id 或 lease.runtime_id 为 NULL),不进聚合结果。
2. **空窗返回 0 个 runtime**:时间窗内无任何 run 命中,`summary_rows`/`daily_rows` 为空,返回 `[]`;调用方(task-10 router)包装成 `{"window": ..., "runtimes": []}`。不抛异常。
3. **NULL 求和**:`SUM(COALESCE(col, 0))` 把每行 NULL 归一为 0;空集合 SUM 返回 NULL,Python 侧再 `int(row[col] or 0)` / `float(... or 0.0)` 兜底,确保 0 而非 None。
4. **时区**:since 必须为 aware UTC datetime 才能与 timestamptz `created_at` 比较;`_compute_since` 中本地自然日 midnight 先转本地 tz-aware 再 `astimezone(UTC)`(避免 naive datetime 被当 UTC)。`date_trunc` 在 PG 服务器侧处理 timestamptz,bucket 列为 aware datetime。
5. **重复计算防御(D-003@v2 / R-03)**:interactive run 同时有 `agent_session_id`(非空)和 `lease_id`,若用 UNION 双路径(session 路径 + lease 路径)会被 SUM 两次。LEFT JOIN+COALESCE 单查询每 run 唯一一行,COALESCE 优先 session.runtime_id,interactive run 永远走 session 分支,不会被 lease 分支二次计入。单测须显式构造此场景验证。
6. **window 参数校验**:`Literal["1d","7d","30d"]` 类型注解;非法值(如 `window="2d"`)应在 router 层 task-10 由 Pydantic Enum/Literal 拦截,service 层不做防御(信任上层);但 `_compute_since` 的 dict 取值会 KeyError — service 内可用 `if window not in {...}` 提前 raise ValueError 做防御性编程。
7. **30 天性能(R-04)**:WHERE `r.created_at >= :since` 时间过滤收窄行数;若聚合慢,execute 阶段确认 `agent_runs.created_at` 索引(本任务不强制加索引,留 execute 判断)。
8. **cache 列 NULL 兼容(FR-05)**:老数据/老 daemon 不上报 cache,`cache_read_tokens`/`cache_creation_tokens` 为 NULL,`SUM(COALESCE(...,0))` 归 0;codex 系 runtime 的 cache 永远 0(前端 task-14 显示「—」)。

## 非目标

- 不实现具体 REST 端点(由 task-10 挂载)。
- 不定义 Pydantic schema(由 task-09 定义,本任务 import 使用)。
- 不改 `agent_runs`/`agent_sessions`/`daemon_task_leases` 表结构或 migration(由 task-04/05 完成 cache 列)。
- 不做实时刷新 / SSE 推聚合(D-004@v1 非实时)。
- 不做币种换算 / 多 runtime 合并全局图(design §3 非目标)。
- 不加索引(R-04,留 execute 阶段判断)。

## 参考

- router.py:1268-1281 已有 `sa_text` + `JOIN daemon_runtimes` 原生 SQL + `mappings().all()` 模式 — 本任务在 service 层用同样的 `self._session.execute(sa_text(...), params).mappings().all()`。
- design.md §7 接口定义(SQL 原文)、§7.5 生命周期契约表(只读不改 lifecycle)。
- decisions.md D-003@v2 evidence:`run_sync/service.py:359-365, 286` 证明 interactive run 同时挂 session+lease。
- `agent/model.py:195-202`(agent_session_id FK)、`agent/model.py:175`(total_cost_usd)、`daemon/model.py:208`(lease.runtime_id)、`agent/model.py:333`(session.runtime_id)。

## TDD 步骤

1. **先写测试** `backend/tests/modules/daemon/runtime/test_usage_aggregation.py`(或对应 test_runtime_service.py 扩展):
   - `test_dual_path_dedup_interactive_run`:构造 1 个 interactive run 同时挂 agent_session_id(指向 session with runtime_id=R1)和 lease_id(指向 lease with runtime_id=R2),input_tokens=100。断言 summary 中 **R1 出现(input=100),R2 不出现**,即只算一次(COALESCE 优先 session)。
   - `test_batch_run_via_lease`:构造 1 个 batch run(无 agent_session_id,挂 lease_id→runtime R3),output_tokens=200。断言 R3 summary output=200。
   - `test_window_1d_hourly_buckets`:1d 窗内插入跨 3 小时的 run,断言 daily 有 3 个 point,`ts` 为 hour-truncated。
   - `test_window_7d_daily_buckets`:7d 窗插入跨 2 天的 run,断言 daily 有 2 个 point,`ts` 为 day-truncated。
   - `test_null_tokens_sum_to_zero`:cache_read_tokens=NULL 的 run,断言 summary cache_read=0。
   - `test_orphan_run_excluded`:无 session 且无 lease 的 run,断言不在结果中。
   - `test_empty_window_returns_empty`:时间窗内无 run,断言返回 `[]`。
   - `test_since_local_midnight_to_utc`:1d window,since 为本地自然日 00:00 转 UTC(可 mock now 验证边界)。
2. **跑测试确认全红**(方法未实现 → ImportError/AttributeError)。
3. **实现** `get_runtimes_usage` + `_compute_since` + `_bucket_unit`。
4. **跑测试确认全绿**。
5. **mypy / ruff** 通过(`backend` 子项目命令)。
6. coverage 不强求本任务单测覆盖,但 task-15 汇总 backend coverage≥60%。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | 运行 `test_dual_path_dedup_interactive_run` 单测 | interactive run 同时挂 session+lease 只算 1 次,COALESCE 优先 session.runtime_id,lease.runtime_id 分支不重复计入(R-03/D-003@v2 核心) |
| 2 | 运行 `test_window_1d_hourly_buckets` 单测 | 1d 窗 daily 返回按 `date_trunc('hour')` 的小时桶(D-002@v1) |
| 3 | 运行 `test_window_7d_daily_buckets` 单测 | 7d/30d 窗 daily 返回按 `date_trunc('day')` 的日桶(D-002@v1) |
| 4 | 运行 `test_null_tokens_sum_to_zero` 单测 | cache 列 NULL 的 run 求和为 0(SUM+COALESCE,FR-05) |
| 5 | 运行 `test_orphan_run_excluded` 单测 | 无 runtime 归属的 run 不计入结果(WHERE COALESCE IS NOT NULL) |
| 6 | 运行 `test_empty_window_returns_empty` 单测 | 空窗返回 `[]` 不抛异常 |
| 7 | 运行 `test_since_local_midnight_to_utc` 单测 | 1d since = 本地自然日 today 00:00 转 UTC(D-004@v1),与 timestamptz created_at 可比较 |
| 8 | `mypy backend/app/modules/daemon/runtime/service.py` | 无类型错误 |
| 9 | `ruff check backend/app/modules/daemon/runtime/service.py` | 无 lint 错误 |
| 10 | 现有 `RuntimeService` 单测(register/heartbeat/list_runtimes)全绿 | 未破坏既有方法 |
