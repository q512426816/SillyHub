---
id: task-01
title: stream-json.ts(Claude)补 cache 词元采集并透传
priority: P1
estimated_hours: 2
depends_on: []
blocks: [task-15]
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/adapters/stream-json.ts
author: qinyi
created_at: 2026-06-24 10:55:18
---

# task-01: stream-json.ts(Claude)补 cache 词元采集并透传

## 修改文件（必填）

`sillyhub-daemon/src/adapters/stream-json.ts`(仅此一个文件):

1. **`_accumulatedUsage` 类型扩展**(L74-77):`{ input_tokens; output_tokens }` → `{ input_tokens; output_tokens; cache_read_tokens; cache_creation_tokens }`,初值加 `cache_read_tokens: 0, cache_creation_tokens: 0`。
2. **`_currentTurnUsage` 类型扩展**(L100-103):同上加 `cache_read_tokens` / `cache_creation_tokens`,初值 0。
3. **`resetAccumulator` 重置**(L186-200):重置两累加器时把 `cache_read_tokens: 0` / `cache_creation_tokens: 0` 一起清零(只改两处赋值字面量,不动其他清零项)。
4. **`parseStreamEvent` 的 `message_delta` 分支**(L467-488):从 `event.usage` 提取 `cache_creation_input_tokens` / `cache_read_input_tokens`(注意是带 `_input_` 的原始字段名),写入 `_currentTurnUsage.cache_creation_tokens` / `cache_read_tokens`;`grew` 判定追加 cache 两维增长。字段缺失/非 number 保持原值不动。
5. **`_buildUsageUpdateEvent` snapshot**(L546-562):`metadata.usage` 追加 `cache_read_tokens` 与 `cache_creation_tokens`(= 累计 + 当前 turn 同字段之和)。
6. **`parseAssistant` commit 分支**(L594-612):commit `_currentTurnUsage` 到 `_accumulatedUsage` 时累加 cache 两维;兜底分支(`message.usage`)同样从 `usage.cache_creation_input_tokens` / `cache_read_input_tokens` 取(命名映射);`usageSnapshot`(L675-678)追加 cache 两字段,`for` 循环注入 `ev.metadata.usage` 时一并带出。
7. **`extractResultStats` 函数签名+逻辑**(L990-1021):`accumulated` 参数类型扩展为含 `cache_read_tokens`/`cache_creation_tokens`;`result.usage` 提取 `cache_creation_input_tokens`/`cache_read_input_tokens` 并与 `accumulated` 同字段求和(对齐 input/output 既有 `+ accumulated.*` 模式);`parseResult` 调用处(L823)传入扩展后的 `this._accumulatedUsage`。

## 覆盖来源

- **Requirements**: FR-02(cache 采集,daemon 侧能取则取)
- **Decisions**: D-001@v1(Claude 有 `cache_creation_input_tokens`/`cache_read_input_tokens`;codex 无则 NULL)

## 实现要求

1. 字段命名映射(关键,易错):Claude CLI 原始事件用 `cache_creation_input_tokens` / `cache_read_input_tokens`(带 `_input_`);本 adapter 内部 `_accumulatedUsage` / `_currentTurnUsage` / snapshot / `extractResultStats` 统一用 `cache_creation_tokens` / `cache_read_tokens`(去掉 `_input_`,对齐 ndjson.ts:57-58 与 design §7 后端契约)。**只在与 Claude 原始事件对接的取值点做名称映射**。
2. `message_delta` 取值用 `typeof usage.cache_creation_input_tokens === 'number'` 守卫,非 number 不覆盖(保持 `_currentTurnUsage` 原值),与既有 `input_tokens`/`output_tokens`(L474-479)同模式。
3. `grew` 判定(L483-485)扩展为四维:`input_tokens`/`output_tokens`/`cache_read_tokens`/`cache_creation_tokens` 任一增长即 true,避免 cache 有增长但 input/output 未变时不 emit `usage_update`。
4. commit / snapshot / extractResultStats 全部沿用 input/output 既有模式(max 语义已由累加器天然实现:`_currentTurnUsage` 是 replace,commit 是 `+=`,`extractResultStats` 是 result.usage + accumulated)。
5. 不改 `_usesPartialAssistantStream`(返回 false)、不改 `buildArgs`(已带 `--include-partial-messages`)、不改其它 provider 分支(cursor 不走 stream_event)。

## 接口定义（代码类必填）

### 类型扩展

```ts
// L74-77 / L100-103(两处同结构)
private _accumulatedUsage: {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;       // 新增
  cache_creation_tokens: number;   // 新增
} = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
};
```

### `parseStreamEvent` 的 `message_delta` 分支(L467-488 改)

```ts
// 伪代码(在现有 input/output 提取之后追加)
if (typeof usage.cache_creation_input_tokens === 'number') {
  this._currentTurnUsage.cache_creation_tokens = usage.cache_creation_input_tokens; // 映射
}
if (typeof usage.cache_read_input_tokens === 'number') {
  this._currentTurnUsage.cache_read_tokens = usage.cache_read_input_tokens; // 映射
}
this._currentTurnHasRealUsage = true;

const grew =
  this._currentTurnUsage.input_tokens > prevInput ||
  this._currentTurnUsage.output_tokens > prevOutput ||
  this._currentTurnUsage.cache_read_tokens > prevCacheRead ||
  this._currentTurnUsage.cache_creation_tokens > prevCacheCreation;
// (prevCacheRead/prevCacheCreation 在取 input/output prev 同处预先快照)
```

### `_buildUsageUpdateEvent`(L546-562 改)

```ts
metadata: {
  status: 'usage_update',
  usage: {
    input_tokens: this._accumulatedUsage.input_tokens + this._currentTurnUsage.input_tokens,
    output_tokens: this._accumulatedUsage.output_tokens + this._currentTurnUsage.output_tokens,
    cache_read_tokens:
      this._accumulatedUsage.cache_read_tokens + this._currentTurnUsage.cache_read_tokens,
    cache_creation_tokens:
      this._accumulatedUsage.cache_creation_tokens + this._currentTurnUsage.cache_creation_tokens,
  },
}
```

### `parseAssistant` commit + 兜底(L594-613 / L675-678 改)

```ts
// commit 分支(加两行累加)
this._accumulatedUsage.cache_read_tokens += this._currentTurnUsage.cache_read_tokens;
this._accumulatedUsage.cache_creation_tokens += this._currentTurnUsage.cache_creation_tokens;
// _currentTurnUsage 重置时两 cache 字段清 0

// 兜底分支(message.usage):映射字段名
if (typeof usage.cache_creation_input_tokens === 'number') {
  this._accumulatedUsage.cache_creation_tokens += usage.cache_creation_input_tokens;
}
if (typeof usage.cache_read_input_tokens === 'number') {
  this._accumulatedUsage.cache_read_tokens += usage.cache_read_input_tokens;
}

// usageSnapshot(L675-678)
const usageSnapshot = {
  input_tokens: this._accumulatedUsage.input_tokens,
  output_tokens: this._accumulatedUsage.output_tokens,
  cache_read_tokens: this._accumulatedUsage.cache_read_tokens,
  cache_creation_tokens: this._accumulatedUsage.cache_creation_tokens,
};
```

### `extractResultStats`(L990-1021 改)

```ts
function extractResultStats(
  resultMsg: Record<string, unknown>,
  accumulated: {
    input_tokens: number;
    output_tokens: number;
    cache_read_tokens: number;       // 新增
    cache_creation_tokens: number;   // 新增
  },
): Record<string, unknown> {
  // ...knownKeys 不变...
  const usage = resultMsg.usage;
  if (isRecord(usage)) {
    stats.input_tokens = (typeof usage.input_tokens === 'number' ? usage.input_tokens : 0) + accumulated.input_tokens;
    stats.output_tokens = (typeof usage.output_tokens === 'number' ? usage.output_tokens : 0) + accumulated.output_tokens;
    // 新增:映射字段名
    stats.cache_creation_tokens =
      (typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : 0) +
      accumulated.cache_creation_tokens;
    stats.cache_read_tokens =
      (typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : 0) +
      accumulated.cache_read_tokens;
  } else if (accumulated.input_tokens > 0 || accumulated.output_tokens > 0 ||
             accumulated.cache_read_tokens > 0 || accumulated.cache_creation_tokens > 0) {
    stats.input_tokens = accumulated.input_tokens;
    stats.output_tokens = accumulated.output_tokens;
    stats.cache_read_tokens = accumulated.cache_read_tokens;           // 新增
    stats.cache_creation_tokens = accumulated.cache_creation_tokens;   // 新增
  }
  return stats;
}
```

## 边界处理（必填）

1. **Claude CLI 不透传 cache 字段(R-01)**:`event.usage` 无 `cache_creation_input_tokens`/`cache_read_input_tokens` 时,`typeof !== 'number'` 守卫不覆盖,`_currentTurnUsage.cache_*` 保持 0,最终 `extractResultStats` 输出 0(或 NULL 语义由后端 SUM 忽略)。不报错、不静默吞掉(日志可选 warn,但生产路径不强制)。execute 首要用真实 Claude CLI 流实测字段存在性。
2. **brownfield 兼容(老数据/老 lease)**:`resetAccumulator` 已含 cache 清零;跨 lease 复用 adapter 实例时 cache 不会污染。`result.usage` 缺 cache 字段时 `extractResultStats` 回退到 accumulated.cache_* (= 0)。既有无 cache 的 Claude 流行为不变。
3. **不改入参**:`extractResultStats` 仍是纯函数,只读 `resultMsg` 与 `accumulated`,不 mutate。`accumulated` 由调用方 `this._accumulatedUsage` 传入,本函数不修改它(原代码即如此,保持)。
4. **cache 非法值(字符串/null)**:`typeof === 'number'` 守卫把字符串/`null` 都当缺失处理(保持原值 / 累加 0),不抛异常,不 NaN。
5. **字段名歧义(`_input_` 后缀)**:严格区分"取值点用原始名 `cache_creation_input_tokens`/`cache_read_input_tokens`"与"内部存储用短名 `cache_creation_tokens`/`cache_read_tokens`"。代码注释明确标注映射关系。若 Claude CLI 未来改名,只改取值点。
6. **grew 判定漏 cache**:必须把 cache 两维纳入 `grew`,否则 cache 增长但 input/output 不变时不 emit `usage_update`,前端实时看不到 cache。
7. **cursor provider**:不走 `stream_event` 分支(parse 直接 default),本改动不影响 cursor。

## 非目标

- 不改 `TaskResult` / `BackendTaskResult` 类型(那是 task-runner/后端 task-06/task-07 的职责)。
- 不改后端 `submit_messages` / `_apply_run_metadata` 的解析(那是 task-06/task-07)。
- 不做 cache 的"读+写合并显示"(前端 task-14 的事)。
- 不实测 Claude CLI(R-01 实测在 execute 阶段做,本 task 只把采集代码写到位)。
- 不改 `_usesPartialAssistantStream`(维持 false)。

## 参考

- 现有 `input_tokens`/`output_tokens` 提取模式(`stream-json.ts:474-479` message_delta / `604-612` 兜底 / `1010-1019` extractResultStats)是 cache 的 1:1 模板。
- `ndjson.ts:54-59 / 322-325` 已有 `cache_read_tokens`/`cache_write_tokens`(短名)的采集范式,可对照命名一致性。
- design §7.5 生命周期契约表第 1 行:Claude `message_delta.event.usage` → `_currentTurnUsage.cache_*`。

## TDD 步骤

1. **写测试**(失败):在 `sillyhub-daemon/tests/adapters/stream-json.test.ts`(或同名 `.test.ts`)新增用例「message_delta 带 cache 时提取并透传」:
   - 构造一条 `{"type":"stream_event","event":{"type":"message_delta","usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":200,"cache_read_input_tokens":300}}}` 的行。
   - `adapter.parse(line)` 应返回 1 个 `text` event,`metadata.status === 'usage_update'` 且 `metadata.usage.cache_creation_tokens === 200`、`cache_read_tokens === 300`(注意:短名)。
   - 追加一条 `{"type":"assistant","message":{"content":[{"type":"text","text":"hi"}],"usage":{"input_tokens":0,"output_tokens":0}}}`,验证 assistant event 的 `metadata.usage.cache_read_tokens === 300` / `cache_creation_tokens === 200`(commit 后 snapshot)。
   - 再构造 result 行 `{"type":"result","result":"done","usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":200,"cache_read_input_tokens":300},"total_cost_usd":0.5}`,验证 `complete` event 的 `metadata.stats.cache_creation_tokens === 400`(result 200 + accumulated 200)/ `cache_read_tokens === 600`。
2. **失败**:运行 `npx vitest run` 该用例,断言 cache 字段 → 失败(代码还没加)。
3. **写代码**:按"实现要求"+接口定义改 `stream-json.ts`。
4. **通过**:重跑该用例 + 全部既有 stream-json 用例 → 绿。
5. **回归**:跑 `sillyhub-daemon` 全量 vitest,确保 input/output 既有行为 + resetAccumulator + cursor 路径未回归。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | `cd sillyhub-daemon && npx tsc --noEmit` | tsc 通过,无类型错误(累加器类型扩展后无残留旧类型引用) |
| 2 | `cd sillyhub-daemon && npx vitest run tests/adapters/stream-json` | 新增「message_delta 带 cache 提取并透传」用例通过 + 既有用例全绿 |
| 3 | `cd sillyhub-daemon && npx vitest run` | 全量 vitest 通过,无回归(input/output/thinking/usage_update/cursor 均不受影响) |
| 4 | 代码 review:字段命名映射 | 取值点(`event.usage` / `message.usage` / `resultMsg.usage`)用 `cache_*_input_tokens`;内部存储/snapshot/stats 用 `cache_*_tokens` 短名;注释标注映射 |
| 5 | 代码 review:`grew` 判定 | 四维增长判定,cache 单独增长时也 emit usage_update |
| 6 | 代码 review:resetAccumulator | 两累加器 4 个字段全部清零,无残留 |
