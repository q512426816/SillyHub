---
id: task-09
title: daemon/schema.py RuntimeUsage* Pydantic schema 定义
priority: P2
estimated_hours: 1
depends_on: []
blocks: [task-10]
requirement_ids: [FR-03]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/schema.py
author: qinyi
created_at: 2026-06-24 10:55:18
---

# task-09: daemon/schema.py RuntimeUsage* Pydantic schema 定义

## 修改文件（必填）

- `backend/app/modules/daemon/schema.py` — 新增 `RuntimeUsageWindow`(Enum 或 str Literal 别名)+ `RuntimeUsageSummaryRead` / `RuntimeUsagePointRead` / `RuntimeUsageRead` 三个 Pydantic BaseModel + 响应封装 `RuntimeUsageListResponse`。新增 section 不改动现有 schema(`AgentSessionRead` 等)。

## 覆盖来源

- Requirements: FR-03(按 runtime + 时间窗聚合返回结构化数据)
- Decisions: D-002@v1(`ts` 粒度:1d 小时桶 / 7d·30d 日桶,schema 用通用 `datetime` 承载,粒度由 service 层 date_trunc 决定)

## 实现要求

1. 在 `schema.py` 文件末尾新增一节 `# ── Runtime usage stats (FR-03 / D-002@v1) ──`,跟现有 section 注释风格一致(参考 `schema.py:11, 54, 86, 103` 的 `# ── ... ──` 分节)。
2. **RuntimeUsageWindow**:用 `enum.Enum`(str 混入)定义三值,使 FastAPI `Query(...)` 能自动 parse query string `"1d"` → enum;同时导出 `RuntimeUsageWindowLiteral = Literal["1d","7d","30d"]` 给 service 层 `get_runtimes_usage(window)` 类型注解用(Enum 和 Literal 都提供,service 内部用 Literal 更轻;router 用 Enum 做 query 解析)。两套类型共存,Enum 在 router 边界,Literal 在 service 内部。
3. **RuntimeUsageSummaryRead**:聚合总量,5 个数值字段,全为非可选(聚合后已 COALESCE 为 0,不存在 None)。cost 用 `float`。
4. **RuntimeUsagePointRead**:时间桶点,`ts: datetime`(PG `date_trunc` 返回的 aware datetime) + 同 5 字段。
5. **RuntimeUsageRead**:单个 runtime 的完整记录,`runtime_id: str`(UUID 转字符串,与 design §7 示例一致) + `summary` + `daily: list[...]`。
6. **RuntimeUsageListResponse**:顶层响应封装,`window: str` + `runtimes: list[RuntimeUsageRead]`,供 router `response_model=` 引用(design §7 响应结构)。
7. Pydantic v2 写法,字段默认值非 None 的不加 `= None`;`model_config` 不需要 `from_attributes`(本 schema 从 dict 构造,非 ORM)。
8. 字段顺序与 design §7 JSON 示例一致(input→output→cache_read→cache_creation→total_cost_usd),保证 JSON 输出可读。
9. 不写自定义 validator(数据已在 service 层归一);不加 `Field(description=...)` 除非现有 schema 有此惯例(检查 `schema.py` 现有字段基本无 description,保持一致不加)。

## 接口定义（代码类必填）

```python
# backend/app/modules/daemon/schema.py(文件末尾追加)

import enum
from datetime import datetime
from typing import Literal

from pydantic import BaseModel


# ── Runtime usage stats (FR-03 / D-002@v1) ─────────────────────────────────
# GET /api/daemon/runtimes/usage?window=1d|7d|30d 的响应 schema。
# ts 粒度由 service 层 date_trunc 决定:1d→hour 桶(24 点),7d/30d→day 桶(D-002@v1)。


class RuntimeUsageWindow(str, enum.Enum):
    """时间窗选项(FR-03 / D-002@v1)。"""

    DAY1 = "1d"
    DAY7 = "7d"
    DAY30 = "30d"


# 给 service 层类型注解用(Literal 比 Enum 更轻,内部函数签名用 Literal)。
RuntimeUsageWindowLiteral = Literal["1d", "7d", "30d"]


class RuntimeUsageSummaryRead(BaseModel):
    """单 runtime 在时间窗内的 token/cache/cost 聚合总量。

    聚合后已 COALESCE 归 0,字段非可选(FR-05 NULL 兼容在 SUM(COALESCE(...,0)) 处理)。
    """

    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_creation_tokens: int
    total_cost_usd: float


class RuntimeUsagePointRead(BaseModel):
    """时间桶点(1d 小时桶 / 7d·30d 日桶,D-002@v1)。

    ts 来自 PG ``date_trunc('hour'/'day', created_at)``,为 aware datetime。
    """

    ts: datetime
    input_tokens: int
    output_tokens: int
    cache_read_tokens: int
    cache_creation_tokens: int
    total_cost_usd: float


class RuntimeUsageRead(BaseModel):
    """单 runtime 的用量记录(summary 总量 + daily 时间序列)。"""

    runtime_id: str
    summary: RuntimeUsageSummaryRead
    daily: list[RuntimeUsagePointRead]


class RuntimeUsageListResponse(BaseModel):
    """GET /api/daemon/runtimes/usage 顶层响应(design §7)。"""

    window: str
    runtimes: list[RuntimeUsageRead]
```

## 边界处理（必填,至少5条）

1. **window 非法值防御**:Enum 在 router Query 边界拦截非法字符串(`window=2d` → FastAPI 422),schema 层不重复校验。Enum 用 `str, enum.Enum` 混入使 FastAPI 能直接 serialize `"1d"` 而非 `RuntimeUsageWindow.DAY1`(JSON 输出与 design §7 示例 `"window": "7d"` 一致)。
2. **空 runtimes 列表**:`RuntimeUsageListResponse.runtimes: list[...]` 允许空 list(`[]`),对应空窗场景(service 返回 `[]`),不抛 Pydantic 校验错误。`daily: list[...]` 同样允许空。
3. **ts 时区**:`datetime` 字段未加 `tzinfo` 约束,直接接收 PG `date_trunc` 返回的 aware datetime;FastAPI 序列化 aware datetime 为 ISO8601 带 offset 字符串(与 design §7 示例 `"2026-06-18T00:00:00"` 略有差异 — 实际会带 `+00:00`,前端 task-11 解析时容忍)。
4. **数值类型**:token 字段 `int`,cost 字段 `float`。service 层已 `int(... or 0)` / `float(... or 0.0)` 归一,不会传 None 进来;若意外传 None,Pydantic v2 会抛 ValidationError(防御性失败而非静默错)。
5. **runtime_id 字符串化**:`runtime_id: str`(非 UUID),service 层 `str(row["rid"])` 转字符串。与 design §7 示例 `"runtime_id": "rt_xxx"` 一致,前端按 string key 分发(task-14)。
6. **cache 字段恒存在**:codex 等无 cache 的 runtime,`cache_read_tokens`/`cache_creation_tokens` 为 0(非 None/缺失),前端 task-14 判断「全 0 显示 —」而非依赖字段缺失。
7. **无 `from_attributes`**:本 schema 从 dict 构造(`RuntimeUsageRead(runtime_id=..., summary=..., daily=...)`),非从 ORM model validate,故不加 `model_config = {"from_attributes": True}`(区别于 `AgentSessionRead` 等 ORM schema)。

## 非目标

- 不实现 service 聚合逻辑(task-08)。
- 不挂载 REST 端点(task-10)。
- 不定义前端 TS 类型(由 task-11 frontend `lib/daemon.ts` 定义 `RuntimeUsage*` TS 接口)。
- 不加自定义 validator / model_validator(数据归一在 service 层)。
- 不加 Field description(与现有 schema 风格保持一致)。

## 参考

- `schema.py:11-31` `AgentSessionRead` — `BaseModel` + `model_config = {"from_attributes": True}` 的 ORM schema 范例(本任务**不**用 from_attributes)。
- `schema.py:222-238` `DirEntry`/`ListDirRequest`/`ListDirResponse` — `Literal` + `Field` 用法范例。
- design.md §7 Pydantic 定义(字段名/顺序来源)。
- design.md §7.5 生命周期契约表(本 schema 为只读聚合响应,无状态字段)。

## TDD 步骤

1. **先写测试** `backend/tests/modules/daemon/test_usage_schema.py`:
   - `test_runtime_usage_window_enum_values`:`RuntimeUsageWindow("1d")` == `DAY1`,三值齐备。
   - `test_summary_read_from_dict`:`RuntimeUsageSummaryRead(input_tokens=1, output_tokens=2, cache_read_tokens=3, cache_creation_tokens=4, total_cost_usd=5.0)` 构造成功,字段类型正确。
   - `test_point_read_with_ts`:`RuntimeUsagePointRead(ts=datetime(2026,6,24,10,0,tzinfo=UTC), ...)` 构造成功。
   - `test_usage_read_nested`:`RuntimeUsageRead(runtime_id="rt_1", summary=..., daily=[...])` 嵌套构造 + `.model_dump()` JSON 可序列化。
   - `test_list_response_empty_runtimes`:`RuntimeUsageListResponse(window="7d", runtimes=[])` 允许空。
   - `test_usage_read_serializes_runtime_id_as_str`:`runtime_id` 序列化为 JSON string。
2. **跑测试确认全红**(schema 未定义 → ImportError)。
3. **实现** schema section(如接口定义)。
4. **跑测试确认全绿**。
5. **mypy / ruff** 通过。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | 运行 `test_runtime_usage_window_enum_values` 单测 | Enum 三值(`1d`/`7d`/`30d`)定义正确,`str` 混入使 `RuntimeUsageWindow("1d")` 可用 |
| 2 | 运行 `test_summary_read_from_dict` 单测 | 5 个数值字段构造成功,int/float 类型正确 |
| 3 | 运行 `test_point_read_with_ts` 单测 | `ts: datetime` 字段承载 aware datetime |
| 4 | 运行 `test_usage_read_nested` 单测 | `RuntimeUsageRead` 嵌套 summary + daily 构造 + `model_dump()` 可 JSON 序列化 |
| 5 | 运行 `test_list_response_empty_runtimes` 单测 | 空窗场景 `runtimes=[]` 不报错 |
| 6 | 运行 `test_usage_read_serializes_runtime_id_as_str` 单测 | `runtime_id` 序列化为 JSON string(与 design §7 示例一致) |
| 7 | `mypy backend/app/modules/daemon/schema.py` | 无类型错误 |
| 8 | `ruff check backend/app/modules/daemon/schema.py` | 无 lint 错误 |
| 9 | 现有 schema 单测全绿 | 未破坏既有 schema(`AgentSessionRead` 等) |
