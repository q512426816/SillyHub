---
id: task-16
title: daemon 提交链 cache 透传(hub-client.ts + daemon.ts + task-runner.ts)
priority: P0
estimated_hours: 2
depends_on: [task-01, task-02, task-03]
blocks: [task-15]
requirement_ids: [FR-02]
decision_ids: [D-001@v1]
allowed_paths:
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/task-runner.ts
author: qinyi
created_at: 2026-06-24 11:10:00
---

# task-16: daemon 提交链 cache 透传(hub-client.ts + daemon.ts + task-runner.ts)

## 修改文件（必填）

- `sillyhub-daemon/src/hub-client.ts` — submitMessages / completeLease 的 payload 类型(~476-477)+ 构造 body(~512-516)加 cache_read_tokens/cache_creation_tokens
- `sillyhub-daemon/src/daemon.ts` — usage 类型定义(~236-237, 1045, 1058-1059)+ SDK result 提取(~1088-1092)+ 实时回写(~1190)加 cache,并做字段名映射
- `sillyhub-daemon/src/task-runner.ts` — 实时回写(~1175, 1204)加 cache

## 覆盖来源

- Requirements: FR-02
- Decisions: D-001@v1（codex/老 CLI 无 cache → undefined，不 set，backend NULL）

## 实现要求

1. **hub-client.ts**：`submitMessages` / `completeLease` 的 payload 类型加 `cache_read_tokens?: number` / `cache_creation_tokens?: number`;构造 body 处(`if payload.X !== undefined` 守卫模式)加两行 `body.cache_read_tokens = payload.cache_read_tokens` / `body.cache_creation_tokens = payload.cache_creation_tokens`。
2. **daemon.ts**:
   - SDK result 提取(~1088-1092):从 `resultMeta.usage` 取 `cache_creation_input_tokens` / `cache_read_input_tokens`(SDK 全名),映射为 payload 的 `cache_creation_tokens` / `cache_read_tokens`(短名,对齐 backend `_METADATA_FIELDS`)。
   - 实时回写(~1190):`usage['cache_read_tokens']` / `usage['cache_creation_tokens']`(adapter emit 的 usage_update 已用短名,见 task-01),typeof number 守卫后回写。
   - 所有 usage 类型字面量(~236-237, 1045, 1058-1059)加两字段可选。
3. **task-runner.ts**:实时回写 AgentRun 的 usage(~1175, 1204)加 cache 两字段(typeof number 守卫)。

## 接口定义（代码类必填）

```typescript
// hub-client.ts payload 类型扩展
interface SubmitMessagesPayload {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;      // 新增
  cache_creation_tokens?: number;  // 新增
  // ...原有字段
}
// 构造 body(~512-516 模式)
if (payload.cache_read_tokens !== undefined) body.cache_read_tokens = payload.cache_read_tokens;
if (payload.cache_creation_tokens !== undefined) body.cache_creation_tokens = payload.cache_creation_tokens;

// daemon.ts SDK result 提取(~1088-1092 模式,注意全名→短名映射)
if (resultMeta.usage && typeof resultMeta.usage['cache_read_input_tokens'] === 'number') {
  payload.cache_read_tokens = resultMeta.usage['cache_read_input_tokens'];
}
if (resultMeta.usage && typeof resultMeta.usage['cache_creation_input_tokens'] === 'number') {
  payload.cache_creation_tokens = resultMeta.usage['cache_creation_input_tokens'];
}
// 实时回写(~1190 模式,adapter emit 已用短名)
if (usage && typeof usage['cache_read_tokens'] === 'number') { payload.cache_read_tokens = usage['cache_read_tokens']; }
```

## 边界处理（必填,至少5条）

- **cache 缺失(codex/老 Claude CLI 不透传)**:字段 undefined → 守卫 `!== undefined` 不 set body → backend 收不到该字段 → NULL(D-001@v1,前端显示「—」)。
- **数字类型校验**:所有提取用 `typeof === 'number'` 守卫,非数字(含 0)按实际值传;NaN/字符串不传。
- **brownfield 兼容**:不破坏现有 input/output 提交逻辑,仅在现有守卫块旁追加,顺序无关。
- **字段名映射一致性**:SDK 全名 `cache_*_input_tokens`(daemon.ts 提取处)↔ 短名 `cache_*_tokens`(adapter emit / payload / backend 列)。提取处做映射,其余环节统一短名。
- **不修改 adapter 产出的 usage 对象**:只读不改(adapter 由 task-01/02/03 产,本任务只消费+透传)。
- **0 值处理**:cache_read=0(无缓存命中)是合法值,守卫用 `typeof === 'number'` 而非 truthy,确保 0 能传。

## 非目标

- 不改 adapter 内部 cache 采集(task-01/02/03 负责)。
- 不改 backend 解析(task-06/07 负责)。
- 不改 interactive session/lease 协议本身,只在 usage payload 内加字段。

## 参考

- hub-client.ts:512-516 现有 input/output 构造守卫模式(照抄)。
- daemon.ts:1088-1092 现有 SDK result input/output 提取模式。
- task-runner.ts:1204 现有实时回写模式。
- 字段名契约:backend `_METADATA_FIELDS`(task-06)= `cache_read_tokens`/`cache_creation_tokens`。

## TDD 步骤

1. 写测试:hub-client 构造 body 带 cache / daemon SDK 全名→短名映射提取单测(vitest,用 mock usage 对象)
2. 确认失败(未透传)
3. 写实现(hub-client/daemon/task-runner 三处加 cache 透传)
4. 确认通过
5. 回归:input/output 提交不受影响

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-1 | `cd sillyhub-daemon && pnpm typecheck` | 通过 |
| AC-2 | vitest:hub-client submitMessages payload 含 cache_read/creation_tokens 时 body 携带 | body.cache_read_tokens === 输入值 |
| AC-3 | vitest:daemon SDK result 提取 cache_creation_input_tokens → payload.cache_creation_tokens(全名→短名映射) | 映射正确 |
| AC-4 | vitest:usage 无 cache 字段(codex)→ body 不含 cache_* → backend NULL | 不 set,不报错 |
| AC-5 | 端到端(集成):adapter 产 cache → daemon 提交 → backend AgentRun.cache_* 非 NULL(task-15 集成验证) | cache 到达 backend |

> 本任务为 cache 链路关键接线(P0),补 step9 符号影响面检查发现的遗漏:task-01/02/03 产 cache 但 daemon→backend 提交链原硬编码 input/output,cache 在边界丢弃。
