---
id: task-02
title: codex-app-server-driver.ts usage 尽力而为加 cache 字段
priority: P2
estimated_hours: 1
depends_on: []
blocks: [task-15]
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/interactive/codex-app-server-driver.ts
author: qinyi
created_at: 2026-06-24 10:55:18
---

# task-02: codex-app-server-driver.ts usage 尽力而为加 cache 字段

## 修改文件（必填）

`sillyhub-daemon/src/interactive/codex-app-server-driver.ts`(仅此一个文件):

1. **`TurnOutcome.usage` 类型扩展**(L560-563):`usage?: { input_tokens?: number; output_tokens?: number }` → 追加 `cache_read_tokens?: number; cache_creation_tokens?: number`。
2. **`_outcomeFromComplete` 返回类型 + 提取逻辑**(L796-816):返回类型 `out.usage` 同步加两 cache 字段;提取时从 `usage` 对象读 `cache_read_tokens` / `cache_creation_tokens`(短名,与 backend 契约一致),`typeof === 'number'` 守卫,非 number → `undefined`。
3. **`_reportOutcome` 参数类型**(L819-854):`outcome` 形参类型同步扩展(加两 cache 可选字段);success 分支 `r.usage = outcome.usage` 已是浅拷贝整个对象,自动携带新增字段,无需额外改动(确认 `outcome.usage` 类型已含 cache 即可)。

## 覆盖来源

- **Requirements**: FR-02(cache 采集,daemon 侧能取则取)
- **Decisions**: D-001@v1(codex/OpenAI 系多无 cache,取不到则 `undefined`,后端 NULL)

## 实现要求

1. **尽力而为(best-effort)**:codex CLI 经 OpenAI 系协议,`turn/completed` 事件的 usage 通常只含 `input_tokens`/`output_tokens`,无 cache。本 task 仅"把字段加到类型 + 提取逻辑里",codex 不返回 cache 时自然 `undefined`,**不要伪造 0**(让后端区分"无数据 NULL" vs "有数据 0")。
2. **字段命名用短名**:`cache_read_tokens` / `cache_creation_tokens`(对齐 ndjson.ts / stream-json 内部存储 / design §7 后端契约)。codex 若某天吐 `cached_tokens` / `prompt_tokens_details.cached_tokens`(OpenAI 新字段),在提取点做映射注释,但本 task 不主动猜测字段名——只加标准短名提取,取不到即 `undefined`。
3. **三处类型同步**:`TurnOutcome`(L560-563)、`_outcomeFromComplete` 返回 `out`(L806)、`_reportOutcome` 形参 `outcome`(L820-823)三处 `usage?` 类型必须一致,否则 tsc 报错。
4. **不改提取的 input/output 逻辑**:既有 L811-812 的 input/output 提取不动,只在 `out.usage = {...}` 对象字面量里追加两行 cache 提取。
5. **不动 success/failed/cancelled/unknown 分支**:`_reportOutcome` 只在 success 分支透传 usage(L827-833),failed/cancelled/unknown 不带 usage,保持不变。

## 接口定义（代码类必填）

### `TurnOutcome` 类型(L560-563 改)

```ts
type TurnOutcome = {
  kind: 'success' | 'failed' | 'cancelled' | 'unknown';
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_tokens?: number;       // 新增
    cache_creation_tokens?: number;   // 新增
  };
};
```

### `_outcomeFromComplete`(L796-816 改)

```ts
private _outcomeFromComplete(ev: AgentEvent): {
  kind: 'success' | 'failed' | 'cancelled' | 'unknown';
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_read_tokens?: number;       // 新增
    cache_creation_tokens?: number;   // 新增
  };
} {
  const status = (ev.metadata as { turn_status?: string })?.turn_status ?? '';
  const usage = (ev.metadata as { usage?: Record<string, unknown> })?.usage;
  let kind: 'success' | 'failed' | 'cancelled' | 'unknown' = 'unknown';
  if (status === 'completed') kind = 'success';
  else if (status === 'failed') kind = 'failed';
  else if (status === 'cancelled') kind = 'cancelled';
  const out: {
    kind: typeof kind;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_tokens?: number;
      cache_creation_tokens?: number;
    };
  } = { kind };
  if (usage && typeof usage === 'object') {
    out.usage = {
      input_tokens: typeof usage.input_tokens === 'number' ? usage.input_tokens : undefined,
      output_tokens: typeof usage.output_tokens === 'number' ? usage.output_tokens : undefined,
      // 新增:尽力而为提取(短名,对齐后端契约;codex 通常无,留 undefined)
      cache_read_tokens:
        typeof usage.cache_read_tokens === 'number' ? usage.cache_read_tokens : undefined,
      cache_creation_tokens:
        typeof usage.cache_creation_tokens === 'number' ? usage.cache_creation_tokens : undefined,
    };
  }
  return out;
}
```

### `_reportOutcome`(L819-854 改,仅类型)

```ts
private _reportOutcome(
  outcome: {
    kind: 'success' | 'failed' | 'cancelled' | 'unknown';
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_tokens?: number;       // 新增
      cache_creation_tokens?: number;   // 新增
    };
  },
  pendingErrorMsg: string | null,
  report: (r: Parameters<NonNullable<InteractiveDriverCallbacks['onTurnResult']>>[0]) => void,
): void {
  // 函数体不变(L827-853)。success 分支:
  //   if (outcome.usage) r.usage = outcome.usage;
  // outcome.usage 类型已含 cache,浅拷贝自动携带。
}
```

> **注**:`InteractiveDriverCallbacks['onTurnResult']` 的 usage 类型若也有显式声明(可能在 callbacks 类型定义处),需同步扩展;若该处 usage 是宽泛 `Record<string, unknown>` 或 inline 推断,则无需改。execute 时若 tsc 报该回调 usage 类型不匹配,定位到 `onTurnResult` 类型声明处补 cache 两字段。

## 边界处理（必填）

1. **codex 无 cache(D-001@v1 主场景)**:`usage.cache_read_tokens`/`cache_creation_tokens` 不存在时,`typeof !== 'number'` 守卫返回 `undefined`。`out.usage` 对象中两字段为 `undefined`,后端收到后按 NULL 处理(SUM 忽略)。前端显示「—」。不报错、不 warn(codex 本就无 cache 是常态)。
2. **usage 对象本身不存在**:`if (usage && typeof usage === 'object')` 守卫,usage 为 undefined/null 时整个 `out.usage` 不赋值(保持既有 input/output 行为),cache 也自然不赋值。
3. **usage 字段类型异常(字符串/对象)**:`typeof === 'number'` 守卫把非 number 当缺失 → `undefined`,不抛异常、不 NaN。codex 若吐 `cache_read_tokens: "300"`(字符串)→ 当无数据处理。
4. **三处类型不一致致 tsc 失败**:必须 `TurnOutcome` / `_outcomeFromComplete` 返回 / `_reportOutcome` 形参三处 usage 类型字段完全一致(都含 4 个可选字段)。任一处遗漏 → tsc 结构类型不匹配报错。
5. **不伪造 0**:严格用 `undefined` 表示"无数据",不用 `0`。后端 DB 列 nullable,`undefined` 序列化为缺省 → NULL;若用 `0` 会污染 SUM(把"无数据"算成"0 token 缓存")。
6. **不改 success 透传逻辑**:`_reportOutcome` success 分支 `r.usage = outcome.usage` 是浅拷贝整个对象,新增字段自动跟随,**不要**改成逐字段 `r.usage = { input_tokens: ..., cache_read_tokens: ... }`(易漏字段)。保持整对象赋值。
7. **onTurnResult 回调类型**:若该回调的 usage 类型是显式 interface 且不含 cache,tsc 会在 `_reportOutcome` 内 `report(r)` 处报错(r.usage 含 cache 但回调签名不认)。此时需同步扩展回调类型声明(定位 `InteractiveDriverCallbacks` 定义)。execute 时遇到即补。

## 非目标

- 不改 `extractAgentEventFromCodexEvent` 或 codex JSON-RPC 解析层(那是把 codex 原始事件转 `AgentEvent` 的地方,本 task 假设 usage 已在 `ev.metadata.usage` 里)。
- 不主动探测 codex 是否吐 `cached_tokens` / `prompt_tokens_details`(OpenAI 新字段名)——本 task 只加标准短名提取,字段名探测留待实测。
- 不改 codex 走 `json-rpc.ts` 的路径(json-rpc adapter 独立,本 task 只管 `codex-app-server-driver.ts`)。
- 不加单测(P2 尽力而为,tsc 通过即可;实测 codex 无 cache 无断言意义)。

## 参考

- 既有 `input_tokens`/`output_tokens` 提取模式(`codex-app-server-driver.ts:810-813`)是 cache 的 1:1 模板:`typeof usage.X === 'number' ? usage.X : undefined`。
- design §7.5 生命周期契约表第 2 行:codex turn response → `usage.cache_read_tokens?`/`cache_creation_tokens?`(尽力而为)。
- D-001@v1:codex 无则 NULL,前端缓存项显示「—」。

## TDD 步骤

1. **写测试**(可选,P2 不强制单测,但若加):在 `sillyhub-daemon/tests/interactive/codex-app-server-driver.test.ts` 新增用例「complete event usage 带 cache 时透传」:构造 `AgentEvent` metadata 含 `usage: { input_tokens: 10, output_tokens: 5, cache_read_tokens: 8, cache_creation_tokens: 3 }`,`_outcomeFromComplete` 返回 `usage.cache_read_tokens === 8`。再测「usage 无 cache 时」→ `usage.cache_read_tokens === undefined`(非 0)。
2. **失败**(若加测试):运行 → cache 字段断言失败(类型/提取未加)。
3. **写代码**:按接口定义改 3 处类型 + `_outcomeFromComplete` 提取逻辑。
4. **通过**:tsc 通过(主验收);若加了测试则测试绿。
5. **回归**:跑 codex-app-server-driver 既有测试,确保 input/output 透传、success/failed/cancelled/unknown 分支不回归。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| 1 | `cd sillyhub-daemon && npx tsc --noEmit` | tsc 通过,三处 usage 类型(`TurnOutcome` / `_outcomeFromComplete` 返回 / `_reportOutcome` 形参)字段一致,无类型错误 |
| 2 | 代码 review:`_outcomeFromComplete` | `out.usage` 对象含 `cache_read_tokens` / `cache_creation_tokens` 两行,`typeof === 'number' ? : undefined` 守卫 |
| 3 | 代码 review:不伪造 0 | 非法/缺失值用 `undefined`,无 `?? 0` / `\|\| 0` |
| 4 | 代码 review:`_reportOutcome` | success 分支保持 `r.usage = outcome.usage` 整对象赋值,未拆字段;failed/cancelled/unknown 不带 usage |
| 5 | (若 `onTurnResult` 回调类型显式声明 usage)代码 review | 回调类型同步含 cache 两可选字段,`report(r)` 处无 tsc 报错 |
| 6 | `cd sillyhub-daemon && npx vitest run tests/interactive/codex-app-server-driver` | 既有测试全绿(若加了 cache 测试则一并绿) |
