---
id: task-06
title: _METADATA_FIELDS 元组加 cache_read_tokens/cache_creation_tokens(batch 路径)
priority: P2
estimated_hours: 1
depends_on: [task-05]
blocks: [task-15]
requirement_ids: [FR-02]
decision_ids: []
allowed_paths:
  - backend/app/modules/agent/service.py
author: qinyi
created_at: 2026-06-24 10:55:18
---
# task-06: _METADATA_FIELDS 元组加 cache_read_tokens/cache_creation_tokens(batch 路径)

## 修改文件（必填）

- `backend/app/modules/agent/service.py`(仅 `_METADATA_FIELDS` 元组,service.py:39-47)

## 覆盖来源

- Requirements: FR-02(batch 路径 daemon 通过 result meta 上报 cache,后端 `_apply_run_metadata` 自动写入)
- design.md §5 Wave 2 batch 路径、§7.5 生命周期契约表 "batch result meta"
- plan.md Wave 2 task-06

## 实现要求

1. 在 `_METADATA_FIELDS` 元组(service.py:39-47)追加两个字符串元素:`"cache_read_tokens"` 和 `"cache_creation_tokens"`。
2. 追加位置放在 `"input_tokens"`/`"output_tokens"` 之后,保持 token 字段聚集。
3. **无需修改 `_apply_run_metadata` 函数本身**:该函数遍历 `_METADATA_FIELDS` 对每个字段做 `meta.get(field_name)` + `if value is not None: setattr(run, field_name, value)`,元组加字段后自动覆盖(D-001@v1:batch meta 无 cache 时 `value is None` → 不写 → run 字段保持 None,与 task-05 nullable 一致)。
4. 字段名必须与 `AgentRun` 属性名(task-05)和 daemon batch meta 中的 key 完全一致(snake_case: `cache_read_tokens`/`cache_creation_tokens`)。
5. 不改 `_apply_run_metadata` 的 `if value is not None` 守卫语义(防御乱序/None 不覆盖)。

## 接口定义（代码类必填）

```python
# backend/app/modules/agent/service.py — _METADATA_FIELDS(service.py:39-47)

_METADATA_FIELDS = (
    "total_cost_usd",
    "duration_ms",
    "duration_api_ms",
    "num_turns",
    "session_id",
    "input_tokens",
    "output_tokens",
    "cache_read_tokens",      # 新增 — batch meta cache read(prompt cache 命中读取词元)
    "cache_creation_tokens",  # 新增 — batch meta cache creation(prompt cache 写入词元)
)
```

`_apply_run_metadata` 无需改动,行为自动扩展:
```python
def _apply_run_metadata(run: AgentRun, meta: dict) -> None:
    for field_name in _METADATA_FIELDS:        # 现在遍历 9 个字段
        value = meta.get(field_name)
        if value is not None:                   # None → 不覆盖(老 daemon 不传 cache 时保持 None)
            setattr(run, field_name, value)     # setattr 写 AgentRun.cache_read_tokens / cache_creation_tokens
```

## 边界处理（必填,至少5条）

1. **null 行为(meta 缺 cache key)**:`meta.get("cache_read_tokens")` 返回 None → `if value is not None` 跳过 → run.cache_read_tokens 保持 None(老数据 NULL,与 task-05/task-04 nullable 一致)。不写默认 0。
2. **brownfield 兼容(老 daemon 不传 cache)**:老版本 daemon batch result meta 不含 cache 两 key,`_apply_run_metadata` 对新字段 `meta.get` 得 None 直接跳过,行为与不加字段完全一致。无破坏性变更。
3. **异常不静默**:若 daemon 误传非 int 类型(如字符串),`setattr` 会写入,在 commit 时由 DB/SQLAlchemy 类型校验报错,不静默吞。不在本层做类型转换(保持 `_apply_run_metadata` 通用性)。
4. **不改入参**:不修改 `_apply_run_metadata` 的签名(`run`, `meta`),不改变遍历逻辑,不改变 `if value is not None` 守卫。只扩展元组数据。
5. **覆盖语义(max 逻辑不在此层)**:batch 路径 `_apply_run_metadata` 是"meta 有值就覆盖"(与 interactive 路径 submit_messages 的 max 防御不同)。这是既有设计——batch result 是终态一次写入,无乱序问题,故直接覆盖。本任务不改变此语义。
6. **字段名一致性**:`cache_read_tokens`/`cache_creation_tokens` 必须与 task-05 AgentRun 属性名、daemon batch meta key(`sillyhub-daemon` Wave 1 task-01/02/03 上报)三方严格一致,snake_case,否则 `setattr` 触发 AttributeError 或 meta.get 取不到值。
7. **元组顺序**:放在 input/output_tokens 之后,便于阅读时与 token 组对齐,不影响运行时(setattr 顺序无副作用)。

## 非目标

- 不改 `_apply_run_metadata` 函数体(只扩展元组数据)。
- 不写 interactive 路径(task-07 负责 run_sync/submit_messages/close_interactive_run 的 max 逻辑)。
- 不动 daemon 上报层(Wave 1 task-01/02/03 负责 daemon adapter 采集 cache 写入 result meta)。
- 不做类型校验/转换(保持通用 setattr,异常交给 DB 层)。
- 不改 AgentRunResponse schema(batch run 详情接口是否暴露 cache 字段由 task-09/其他需求决定)。

## 参考

- `backend/app/modules/agent/service.py:39-54`(`_METADATA_FIELDS` + `_apply_run_metadata`,batch 路径既有模式)
- `backend/app/modules/agent/model.py:210-217`(input/output_tokens,model 层字段名基准)
- task-04 migration / task-05 model(列名严格对应)
- design.md §7.5 生命周期契约表(batch result meta → `_apply_run_metadata`)

## TDD 步骤

1. 先确认 task-05 已落地(AgentRun 有 cache 两属性),否则 setattr 报 AttributeError。
2. 写单测 `tests/modules/agent/test_service_metadata.py`(若无则新建,放 `allowed_paths` 外的测试文件按 TDD 惯例允许):
   - 构造 `AgentRun` + `meta={"cache_read_tokens": 5400000, "cache_creation_tokens": 300000, "input_tokens": 1000}`,调 `_apply_run_metadata(run, meta)`,断言 `run.cache_read_tokens == 5400000 and run.cache_creation_tokens == 300000`。
   - 构造 `meta={"input_tokens": 1000}`(无 cache key),调 `_apply_run_metadata`,断言 `run.cache_read_tokens is None and run.cache_creation_tokens is None`(不写默认值)。
   - 构造 `meta={"cache_read_tokens": 0}`(值为 0),调 `_apply_run_metadata`,断言 `run.cache_read_tokens == 0`(0 不是 None,应写入)。
   - 构造既有 meta 字段(total_cost_usd)混合 cache,确认既有字段仍正确写入,不回归。
3. 跑 `cd backend && uv run pytest tests/modules/agent/test_service_metadata.py -q`。
4. 跑 `cd backend && uv run mypy app/modules/agent/service.py` 类型检查。
5. 跑 agent 模块既有测试 `cd backend && uv run pytest tests/modules/agent/ -q` 确认无回归。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | `cd backend && uv run mypy app/modules/agent/service.py` | 无错误 |
| 2 | 单测:meta 含 cache 两 key 时 `_apply_run_metadata` 写入 | `run.cache_read_tokens`/`cache_creation_tokens` 等于 meta 值 |
| 3 | 单测:meta 不含 cache key 时 `_apply_run_metadata` 不写 | 两字段保持 None,不写默认 0 |
| 4 | 单测:meta 含 `cache_read_tokens: 0` | 写入 0(0 非 None,应覆盖) |
| 5 | 单测:既有字段(total_cost_usd/input_tokens 等)混入 cache 仍正确写入 | 无回归,9 个字段全部按 `if value is not None` 覆盖 |
| 6 | `cd backend && uv run pytest tests/modules/agent/ -q` | 全绿,coverage 不下降 |
| 7 | 字段名与 task-05 AgentRun 属性 / daemon meta key 一致 | snake_case `cache_read_tokens`/`cache_creation_tokens` 三方一致 |
