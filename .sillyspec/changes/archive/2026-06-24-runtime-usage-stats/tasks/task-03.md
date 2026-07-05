---
id: task-03
title: ndjson.ts 确认 cache 透传到 TaskResult.usage
priority: P2
estimated_hours: 1
depends_on: []
blocks: [task-15]
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/adapters/ndjson.ts
author: qinyi
created_at: 2026-06-24 10:55:18
---

# task-03: ndjson.ts 确认 cache 透传到 TaskResult.usage

## 修改文件（必填）

`sillyhub-daemon/src/adapters/ndjson.ts`(本 task 可能**零改动或极小补丁**,核心是确认):

1. **确认 `handleStepFinish` 已采 cache**(L315-327):已读 `tokens.cache.read` / `tokens.cache.write` 累加到 `state.usage.cache_read_tokens` / `cache_write_tokens`(短名)。**确认即可,无需改**。
2. **确认 `getUsage()` 返回含 cache**(L361-364):返回 `{ ...this.state.usage }`,含 4 字段(input/output/cache_read/cache_write)。**确认即可**。
3. **确认提交链路携带 cache**(关键调查项):ndjson adapter 的 `getUsage()` 是否被调用、cache 是否流入最终 `TaskResult.metadata` / `BackendTaskResult` / `submit_messages` 的 usage。若调用方(task-runner.ts 或 daemon.ts 的 ndjson 批处理路径)只取了 input/output 而丢弃 cache,则**补**调用方透传(但调用方若不在 `allowed_paths` 则记为发现项,在 `docs/sillyspec/` 或回报;本 task allowed_paths 限定 ndjson.ts,优先确认 adapter 侧已就绪)。
4. **字段命名一致性确认**:ndjson 用 `cache_write_tokens`(write),而 design §7 后端契约 / stream-json / codex 用 `cache_creation_tokens`(creation)。**确认**:`cache_write` 与 `cache_creation` 是否同义(opencode 的 `tokens.cache.write` 即 Anthropic 的 cache_creation,是写入/创建缓存)。若后端期望 `cache_creation_tokens`,则需在 adapter 出口或调用方做字段名映射 `cache_write_tokens → cache_creation_tokens`。本 task **确认语义并在 ndjson.ts 注释标注**(或加映射 helper)。

## 覆盖来源

- **Requirements**: FR-02(cache 采集)
- **Decisions**: D-001@v1(ndjson/opencode/openclaw/pi 有 `tokens.cache.read`/`write`,已有采集)

## 实现要求

1. **读源码确认现状**(首要,不盲目改):`ndjson.ts:54-59` 类型含 `cache_read_tokens`/`cache_write_tokens`;`322-325` 累加;`361-364` getUsage 返回。三处确认无缺陷(类型守卫、累加符号、浅拷贝)。
2. **字段名映射决策**(关键):调查后端(`backend/app/modules/daemon/run_sync/service.py` / `agent/service.py` 的 `_METADATA_FIELDS`,task-06/task-07 将实现)期望的字段名。design §7 schema 是 `cache_creation_tokens`(creation)。若 ndjson 当前吐 `cache_write_tokens`(write)而后端要 `cache_creation_tokens`,有两条路:
   - (A)在 ndjson adapter `getUsage()` 出口映射:`cache_creation_tokens: this.state.usage.cache_write_tokens`(同时保留旧名向后兼容,或直接改名);
   - (B)在后端 `_METADATA_FIELDS` 接受 `cache_write_tokens`(task-06 的事,超出本 task)。
   - 本 task 选 (A):若确认需映射,在 `getUsage()` 返回对象加 `cache_creation_tokens` 字段(= cache_write_tokens 值),并在 `NdjsonState.usage` 接口注释标注"cache_write_tokens 即 cache_creation_tokens(opencode 命名)"。若不需映射(后端两者都收 / 前端合并显示),则仅加注释,不改代码。
3. **不改 handleStepFinish 累加逻辑**:既有 `cache.read → cache_read_tokens` / `cache.write → cache_write_tokens` 映射正确,不动。
4. **不改 createInitialState**:初值 0 正确。
5. **不改 buildArgs / parse / handleEvent / 其他 handler**:本 task 只管 usage 出口(getUsage + 字段命名)。

## 接口定义（代码类必填）

### 现状(确认无缺陷,无需改)

```ts
// NdjsonState.usage(ndjson.ts:54-59)— 已含 cache
usage: {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
};

// handleStepFinish(ndjson.ts:315-327)— 已累加
private handleStepFinish(part: Record<string, unknown>): void {
  const tokens = isRecord(part.tokens) ? part.tokens : null;
  if (!tokens) return;
  this.state.usage.input_tokens += typeof tokens.input === 'number' ? tokens.input : 0;
  this.state.usage.output_tokens += typeof tokens.output === 'number' ? tokens.output : 0;
  const cache = isRecord(tokens.cache) ? tokens.cache : null;
  if (cache) {
    this.state.usage.cache_read_tokens += typeof cache.read === 'number' ? cache.read : 0;
    this.state.usage.cache_write_tokens += typeof cache.write === 'number' ? cache.write : 0;
  }
}

// getUsage(ndjson.ts:361-364)— 已返回含 cache
getUsage(): NdjsonState['usage'] {
  return { ...this.state.usage };
}
```

### 若需字段名映射(getUsage 补丁,视调查结果)

```ts
/**
 * 累积的 token usage(多 step_finish 跨行累加)。
 *
 * 字段命名说明:
 *   - cache_write_tokens(opencode 原始名 `tokens.cache.write`)= Anthropic 的
 *     cache_creation_tokens(写入/创建缓存的 token)。后端契约(design §7)用
 *     cache_creation_tokens,故本方法额外吐 cache_creation_tokens 别名,
 *     与 cache_write_tokens 并存(同值),让后端 _METADATA_FIELDS 任一字段名都能命中。
 */
getUsage(): NdjsonState['usage'] & { cache_creation_tokens: number } {
  return {
    ...this.state.usage,
    cache_creation_tokens: this.state.usage.cache_write_tokens, // 别名映射
  };
}
```

> **决策点**:是否加别名由调查后端契约决定。若 task-06 的 `_METADATA_FIELDS` 将同时声明 `cache_write_tokens` 与 `cache_creation_tokens`,或后端只认 `cache_write_tokens`,则本 task 仅加注释不改 getUsage。execute 时与 task-06 协调字段名后定夺。

## 边界处理（必填）

1. **opencode 无 cache 字段**:`tokens.cache` 不存在时 `isRecord(tokens.cache)` 守卫跳过,cache_read/write 保持 0(初值)。不报错。与 input/output 缺失处理一致。
2. **cache.read / cache.write 非法值(字符串/null)**:`typeof === 'number' ? : 0` 守卫累加 0,不 NaN、不抛异常。既有逻辑已正确,确认即可。
3. **字段名 write vs creation 歧义**:`cache_write_tokens`(opencode/OpenAI 命名)与 `cache_creation_tokens`(Anthropic/design 后端契约命名)语义同义(都是"创建/写入缓存的 token")。本 task 必须在注释明确标注此映射关系,避免 task-06/task-07 后端解析时字段名对不上导致 cache 丢失。
4. **getUsage 浅拷贝**:`{ ...this.state.usage }` 是浅拷贝,返回后调用方修改不影响内部 state。确认既有浅拷贝正确,不引入深拷贝(YAGNI,usage 是扁平 number 对象)。
5. **跨 step 累加污染**:`resetState()`(L142-145)重置整个 state(含 usage 归零),跨 lease 复用 adapter 时 cache 不污染。确认 resetState 含 usage 重置(经 `createInitialState()` 实现)。
6. **提交链路断点(核心风险)**:若调查发现 task-runner.ts / daemon.ts 的 ndjson 批处理路径**未调用** `getUsage()` 或只取 input/output 丢弃 cache,则 cache 采了也白采。此情况下:本 task allowed_paths 仅 ndjson.ts,不能改 task-runner;**记为发现项回报**(在最终报告标注"ndjson adapter 已采 cache,但 task-runner.ts:XXX 未透传,需新增 task 或扩展 allowed_paths"),并在 `docs/sillyspec/` 记录。不擅自越界改 task-runner。

## 非目标

- 不改 `handleStepFinish` 累加逻辑(已正确)。
- 不改 `parse` / `handleEvent` 事件分派。
- 不改后端 `_METADATA_FIELDS` 解析(task-06 职责)。
- 不改前端 cache 合并显示(task-14 职责)。
- 不重构 `NdjsonState`(YAGNI,4 字段够用)。

## 参考

- 既有 `cache_read_tokens`/`cache_write_tokens` 采集(`ndjson.ts:54-59 / 322-325`)。
- design §7.5 生命周期契约表第 3 行:ndjson step_finish → `tokens.cache.read`/`write` → `cache_read/write_tokens`(累积)。
- design §7 后端 schema:`cache_creation_tokens`(creation 命名)— 字段名映射参考。
- stream-json.ts(task-01)内部存储用 `cache_creation_tokens`,可对照命名一致性。

## TDD 步骤

1. **写测试**(确认型):在 `sillyhub-daemon/tests/adapters/ndjson.test.ts` 新增/确认用例「step_finish 带 cache 时累加到 getUsage」:
   - 喂两行:`{"type":"step_finish","part":{"tokens":{"input":100,"output":50,"cache":{"read":200,"write":80}}}}` 和 `{"type":"step_finish","part":{"tokens":{"input":50,"output":30,"cache":{"read":100,"write":40}}}}`。
   - 断言 `adapter.getUsage()` 返回 `{ input_tokens: 150, output_tokens: 80, cache_read_tokens: 300, cache_write_tokens: 120 }`(累加正确)。
   - (若加了 cache_creation_tokens 别名)断言 `cache_creation_tokens === 120`。
2. **失败/确认**:若既有测试已覆盖且通过,本步骤是"确认绿";若 cache 累加有 bug(理论上不会,代码已正确),则失败 → 修。
3. **写代码**(视调查):若需加 `cache_creation_tokens` 别名,按接口定义补丁 getUsage;若仅注释,加 JSDoc 标注 write=creation 映射。
4. **通过**:`npx vitest run tests/adapters/ndjson` 全绿。
5. **回归**:跑 ndjson 全量测试,确保 text/tool_use/tool_result/error/step_start/step_finish 分派 + resetState + getOutput/getSessionId/getFinalStatus/getFinalError 不回归。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | 读 `ndjson.ts:54-59 / 315-327 / 361-364` | cache_read_tokens/cache_write_tokens 类型+累加+getUsage 三处无缺陷(类型守卫/累加符号/浅拷贝正确) |
| 2 | `cd sillyhub-daemon && npx tsc --noEmit` | tsc 通过(若加了 cache_creation_tokens 别名则返回类型扩展后无报错;若未加则零改动 tsc 必过) |
| 3 | `cd sillyhub-daemon && npx vitest run tests/adapters/ndjson` | 「step_finish 带 cache 累加到 getUsage」用例通过 + 既有用例全绿 |
| 4 | 调查提交链路:grep `getUsage\(\)` 调用方(task-runner.ts / daemon.ts) | 确认 cache 是否流入最终 TaskResult.metadata.usage / submit_messages;若断链,在报告中标注发现项(断点位置 + 建议补 task) |
| 5 | 字段名映射决策 | 明确 `cache_write_tokens`(opencode)= `cache_creation_tokens`(后端契约)的映射:在 getUsage 加别名 OR 仅注释(与 task-06 协调)。注释标注 write=creation 语义 |
| 6 | 代码 review:handleStepFinish | 未改动既有累加逻辑;resetState 含 usage 重置(经 createInitialState) |
