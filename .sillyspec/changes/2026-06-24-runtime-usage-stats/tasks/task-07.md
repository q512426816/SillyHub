---
id: task-07
title: run_sync 解析 cache(interactive 路径,沿用 input/output max 逻辑)
priority: P2
estimated_hours: 2
depends_on: [task-05]
blocks: [task-15]
requirement_ids: [FR-02]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
author: qinyi
created_at: 2026-06-24 10:55:18
---
# task-07: run_sync 解析 cache(interactive 路径,沿用 input/output max 逻辑)

## 修改文件（必填）

- `backend/app/modules/daemon/run_sync/service.py`(`RunSyncService.submit_messages` ~149-242、`close_interactive_run` ~416-540 两处方法)

## 覆盖来源

- Requirements: FR-02(interactive 路径 daemon usage_update / SDKResult 透传 cache,后端解析写 AgentRun.cache_*)
- design.md §5 Wave 2 interactive 路径、§7.5 生命周期契约表(usage_update emit / interactive turn 终态)
- plan.md Wave 2 task-07

## 实现要求

1. **`submit_messages` 解析 usage.cache_*(实时累积,service.py:149-159 提取 + service.py:227-238 写回)**:
   - 在提取 `input_tokens`/`output_tokens` 的同一段(service.py:150-156),增加提取 `cache_read_tokens`/`cache_creation_tokens`:
     - `cache_read = usage.get("cache_read_tokens")`,若 `isinstance(cache_read, (int, float)) and int(cache_read) > 0` 则 `latest_cache_read_tokens = max(latest_cache_read_tokens or 0, int(cache_read))`。
     - `cache_creation = usage.get("cache_creation_tokens")`,同上 max 逻辑。
   - 在 service.py:73-75 附近新增局部变量 `latest_cache_read_tokens: int | None = None`、`latest_cache_creation_tokens: int | None = None`(与 latest_input_tokens/output_tokens 并列)。
   - 在写回段(service.py:227-238),照搬 input/output 的"仅增不减"守卫追加 cache 两字段的写回:
     ```python
     if latest_cache_read_tokens is not None and (
         agent_run.cache_read_tokens is None
         or latest_cache_read_tokens > agent_run.cache_read_tokens
     ):
         agent_run.cache_read_tokens = latest_cache_read_tokens
         self._session.add(agent_run)
     # cache_creation_tokens 同理
     ```
2. **`close_interactive_run` 透传 cache(SDKResult 终态,service.py:416-540)**:
   - 在方法签名(service.py:416-436)新增两个 keyword-only 参数:`cache_read_tokens: int | None = None`、`cache_creation_tokens: int | None = None`(放在 output_tokens 之后,与现有 usage/cost 透传参数并列)。
   - 在透传段(service.py:529-540),照搬 `if input_tokens is not None: agent_run.input_tokens = input_tokens` 模式追加:
     ```python
     if cache_read_tokens is not None:
         agent_run.cache_read_tokens = cache_read_tokens
     if cache_creation_tokens is not None:
         agent_run.cache_creation_tokens = cache_creation_tokens
     ```
   - docstring 更新:说明 cache 两参数语义(None=daemon 未传,保留 AgentRun 原值;对齐 D-001@v1 codex 无 cache)。
3. **沿用 max 逻辑(submit_messages)**:interactive 流式过程中同一 run 多次 submit,usage 可能乱序/重复(Claude 中间事件 usage 常为 0/0,service.py:69-72 注释)。只在数值严格大于当前值时覆盖,防御乱序——与既有 input/output 完全一致。
4. **close 路径无 max**:close_interactive_run 是终态一次写入(SDKResultSuccess 真实值),照搬现有 input/output 直接覆盖语义(service.py:537-540 无 max 守卫),不加 max。
5. **不动 daemon 端上报字段名**:本任务假定 daemon(Wave 1 task-01/02/03)已按 snake_case `cache_read_tokens`/`cache_creation_tokens` 透传到 usage dict。若 daemon 尚未落地,本任务的解析逻辑取不到值(回退 None,不影响主功能)。

## 接口定义（代码类必填）

### submit_messages 新增局部变量 + 提取 + 写回

```python
# backend/app/modules/daemon/run_sync/service.py — submit_messages 内

# (service.py:73-75 附近,与 latest_input_tokens 并列)
latest_input_tokens: int | None = None
latest_output_tokens: int | None = None
latest_cache_read_tokens: int | None = None       # 新增
latest_cache_creation_tokens: int | None = None   # 新增
latest_session_id: str | None = None

# (service.py:150-156 提取段,扩展 usage 解析)
usage = msg.get("usage")
if isinstance(usage, dict):
    in_tok = usage.get("input_tokens")
    out_tok = usage.get("output_tokens")
    cache_read_tok = usage.get("cache_read_tokens")        # 新增
    cache_creation_tok = usage.get("cache_creation_tokens")  # 新增
    if isinstance(in_tok, (int, float)) and int(in_tok) > 0:
        latest_input_tokens = max(latest_input_tokens or 0, int(in_tok))
    if isinstance(out_tok, (int, float)) and int(out_tok) > 0:
        latest_output_tokens = max(latest_output_tokens or 0, int(out_tok))
    if isinstance(cache_read_tok, (int, float)) and int(cache_read_tok) > 0:
        latest_cache_read_tokens = max(latest_cache_read_tokens or 0, int(cache_read_tok))
    if isinstance(cache_creation_tok, (int, float)) and int(cache_creation_tok) > 0:
        latest_cache_creation_tokens = max(latest_cache_creation_tokens or 0, int(cache_creation_tok))

# (service.py:227-238 写回段,追加 cache 两字段的 max 守卫)
if latest_input_tokens is not None and (
    agent_run.input_tokens is None or latest_input_tokens > agent_run.input_tokens
):
    agent_run.input_tokens = latest_input_tokens
    self._session.add(agent_run)
if latest_output_tokens is not None and (
    agent_run.output_tokens is None or latest_output_tokens > agent_run.output_tokens
):
    agent_run.output_tokens = latest_output_tokens
    self._session.add(agent_run)
# 新增:cache 词元实时写回(仅增不减,防御乱序,对齐 input/output)
if latest_cache_read_tokens is not None and (
    agent_run.cache_read_tokens is None
    or latest_cache_read_tokens > agent_run.cache_read_tokens
):
    agent_run.cache_read_tokens = latest_cache_read_tokens
    self._session.add(agent_run)
if latest_cache_creation_tokens is not None and (
    agent_run.cache_creation_tokens is None
    or latest_cache_creation_tokens > agent_run.cache_creation_tokens
):
    agent_run.cache_creation_tokens = latest_cache_creation_tokens
    self._session.add(agent_run)
```

### close_interactive_run 签名扩展 + 透传

```python
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
    total_cost_usd: float | None = None,
    num_turns: int | None = None,
    duration_ms: int | None = None,
    duration_api_ms: int | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    # 新增:cache 词元透传(SDKResultSuccess.usage.cache_*);None=daemon 未传,保留 AgentRun 原值
    cache_read_tokens: int | None = None,
    cache_creation_tokens: int | None = None,
) -> AgentRun:
    ...
    # (service.py:529-540 透传段,追加)
    if total_cost_usd is not None:
        agent_run.total_cost_usd = total_cost_usd
    ...
    if output_tokens is not None:
        agent_run.output_tokens = output_tokens
    # 新增:cache 词元终态透传(直接覆盖,无 max — 终态一次写入,对齐 input/output)
    if cache_read_tokens is not None:
        agent_run.cache_read_tokens = cache_read_tokens
    if cache_creation_tokens is not None:
        agent_run.cache_creation_tokens = cache_creation_tokens
```

## 边界处理（必填,至少5条）

1. **null 行为(usage 无 cache key)**:`usage.get("cache_read_tokens")` 返回 None → `isinstance(None, (int, float))` 为 False → 跳过 max 累积 → `latest_cache_read_tokens` 保持 None → 写回段 `is not None` 守卫跳过 → AgentRun.cache_read_tokens 保持 None。老 daemon / codex 无 cache 时全程 None,与 task-04/05 nullable 一致(D-001@v1)。
2. **brownfield 兼容(老 daemon 不传 cache)**:submit_messages 既有 usage 解析只取 input/output,新增 cache 解析对老 daemon 无副作用(get 返回 None 跳过)。close_interactive_run 新增 keyword-only 参数默认 None,daemon 老版本不传该参数 → 透传段跳过 → AgentRun 原值不变。调用方(router/WS handler)无需同步改动即可向后兼容。
3. **异常不静默**:`isinstance(x, (int, float))` 类型守卫已防御 daemon 误传字符串/None;若 daemon 传畸形类型(bool 等),`int(x)` 转换 + `> 0` 比较会自然过滤(bool True→1)。不 raise,但也不静默写入脏数据。close 路径若 daemon 传非 int,setattr 写入后 commit 由 DB 类型校验报错。
4. **不改入参**:submit_messages 不改方法签名(只加局部变量);close_interactive_run 只在 keyword-only 参数末尾追加(向后兼容,既有调用不传 cache 两参数时默认 None)。不改 `_eventToMessages`/`_extract_sdk_messages`(usage 透传到首条 flat record 的逻辑既有,task-12 已处理,本任务只消费)。
5. **max 逻辑(submit) vs 直接覆盖(close)一致性**:submit_messages 流式过程中多次调用,严格沿用 input/output 的 `> current` 守卫(仅增不减),防御 Claude 中间事件 usage=0/0 乱序覆盖(service.py:69-72 注释)。close_interactive_run 是 SDKResultSuccess 终态一次写入,沿用现有 input/output 的直接覆盖(无 max)。两条路径语义各自与对应 input/output 字段保持一致,不引入新模式。
6. **cache_read vs cache_creation 独立**:两字段独立累积/覆盖,不合并、不计算差值。前端展示时按需合并读取/写入(design §5 Wave 4),后端只存原始值。
7. **Redis 透传不在本任务**:service.py:262-270(summary_payload)/ 306-317(token_payload) 当前只透传 input/output 到 SSE。cache 是否推 SSE 给前端实时显示,属 task-14/前端范围,本任务只保证 DB 写入。若后续需要,扩展 token_payload 加 cache 两 key 即可,不影响本任务 AC。

## 非目标

- 不改 daemon 上报层(Wave 1 task-01 stream-json / task-02 codex / task-03 ndjson 负责采集 cache 写入 usage dict)。
- 不改 `_eventToMessages` / `_extract_sdk_messages`(usage 透传逻辑既有)。
- 不改 SSE token_payload 透传 cache(前端实时显示属 task-14 范围;DB 已有值,前端轮询/进页面即可拿到)。
- 不写 batch 路径(task-06 `_METADATA_FIELDS` 负责)。
- 不改 close_interactive_run 的状态映射/幂等/binding 校验逻辑(只追加 cache 透传)。
- 不做 cache 与 cost 的换算(费用计算在 daemon 侧,后端只存原值)。

## 参考

- `backend/app/modules/daemon/run_sync/service.py:48-333`(submit_messages 完整方法,input/output 提取+max 写回模式)
- `backend/app/modules/daemon/run_sync/service.py:416-609`(close_interactive_run,SDKResult 透传模式)
- `backend/app/modules/daemon/run_sync/service.py:69-72`(Claude 中间事件 usage=0/0 乱序注释,max 守卫依据)
- `backend/app/modules/agent/model.py:210-217`(input/output_tokens,max 守卫 `agent_run.X is None or latest > agent_run.X`)
- task-05(AgentRun.cache_* 属性,setattr 目标)
- design.md §7.5 生命周期契约表(usage_update emit / interactive turn 终态两行)

## TDD 步骤

1. 先确认 task-05 已落地(AgentRun 有 cache 两属性),否则 setattr 报 AttributeError。
2. **submit_messages 单测**(`tests/modules/daemon/run_sync/test_service_cache.py`,若无则新建):
   - 构造 messages = `[{event_type:"text", content:"[ASSISTANT] hi", usage:{"input_tokens":100,"output_tokens":50,"cache_read_tokens":5400000,"cache_creation_tokens":300000}}]`,调 submit_messages,断言 AgentRun.cache_read_tokens == 5400000、cache_creation_tokens == 300000。
   - 乱序防御:先 submit `usage:{cache_read_tokens:1000}`,再 submit `usage:{cache_read_tokens:500}`,断言 AgentRun.cache_read_tokens == 1000(max 不减)。
   - 0/None 过滤:submit `usage:{cache_read_tokens:0}`(Claude 中间事件),断言 AgentRun.cache_read_tokens 保持 None(0 被 `> 0` 过滤)。
   - 无 cache key:submit `usage:{input_tokens:100}`(老 daemon),断言 AgentRun.cache_read_tokens is None。
   - 混合:input/output 既有 max 逻辑不回归(同时传 input/output/cache,断言四字段都正确)。
3. **close_interactive_run 单测**:
   - 调 close 传 `cache_read_tokens=5400000, cache_creation_tokens=300000`,断言 AgentRun 两字段被写入。
   - 调 close 不传 cache 两参数(默认 None),断言 AgentRun 原值不变(向后兼容)。
   - 幂等:AgentRun 已 terminal 时调 close,cache 不被改写(既有幂等逻辑覆盖)。
4. 跑 `cd backend && uv run pytest tests/modules/daemon/run_sync/ -q`。
5. 跑 `cd backend && uv run mypy app/modules/daemon/run_sync/service.py`。
6. 跑 run_sync 既有测试确认无回归。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | submit_messages 单测:usage 含 cache_read/cache_creation | AgentRun 两字段写入,max 累积正确 |
| 2 | submit_messages 单测:乱序(先大后小) | cache 值取 max,不被小值覆盖 |
| 3 | submit_messages 单测:cache_read_tokens=0(Claude 中间事件) | 被过滤,AgentRun 保持 None/原值 |
| 4 | submit_messages 单测:usage 无 cache key(老 daemon) | AgentRun 两字段 None,无副作用 |
| 5 | submit_messages 单测:input/output 既有 max 逻辑 | 四字段混合时全部正确,无回归 |
| 6 | close_interactive_run 单测:传 cache 两参数 | AgentRun 两字段被写入 |
| 7 | close_interactive_run 单测:不传 cache 两参数(默认 None) | AgentRun 原值不变,向后兼容 |
| 8 | close_interactive_run 单测:AgentRun 已 terminal(幂等) | cache 不被改写,既有幂等不破坏 |
| 9 | `cd backend && uv run mypy app/modules/daemon/run_sync/service.py` | 无错误 |
| 10 | `cd backend && uv run pytest tests/modules/daemon/run_sync/ -q` | 全绿,coverage 不下降 |
| 11 | 字段名一致性:usage key / close 参数名 / AgentRun 属性名 | snake_case `cache_read_tokens`/`cache_creation_tokens` 三方一致,与 daemon Wave1 上报对齐 |
