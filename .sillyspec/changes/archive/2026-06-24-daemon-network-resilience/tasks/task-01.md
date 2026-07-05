---
id: task-01
title: hub-client._request fetch reject 透传 TypeError.cause（不吞底层 code）
priority: P0
wave: W1
depends_on: []
blocks: [task-02, task-06]
requirement_ids: [FR-01]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/src/hub-client.ts
  - sillyhub-daemon/src/__tests__/hub-client-cause.test.ts
author: qinyi
created_at: 2026-06-24T15:05:00+08:00
---

# task-01: hub-client._request fetch reject 透传 TypeError.cause

> 来源：design.md §5 Phase1（日志 cause 透传）/ §9 兼容（N-2 瘦客户端不动）；plan.md Wave1 task-01。
> 本质：`_request`（hub-client.ts:211）的 fetch reject 已"不包装透传"（注释 205），但 undici 的 `fetch failed` 是 `TypeError`，其底层原因（`ECONNREFUSED`/`ENOTFOUND`/`ETIMEDOUT`/证书错误）挂在 `error.cause`。当前透传本身正确，问题在：① `error.cause` 可能是 `Error` 或 `Object`，需确保链上不丢；② 提供一个稳定的 cause 提取工具，供 task-02 的 warn 展开。本 task 确保 cause 透传 + 导出提取辅助，**不改变"不包装、不重试"语义**。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 修改 | `sillyhub-daemon/src/hub-client.ts` | 确认 fetch reject 透传；导出 `extractCause(err)` 辅助 + `HubHttpError` 已含 status（无需改） |
| 新增 | `sillyhub-daemon/src/__tests__/hub-client-cause.test.ts` | cause 透传 + extractCause 单测 |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-01 | fetch failed 日志暴露底层 cause code | _request 透传 TypeError.cause；导出 extractCause 供 warn 用 |

## 实现要求

1. **核对现有行为**：读 `_request`（211-229）。当前 `await fetch(...)` reject 时直接抛出（无 try/catch 包装），TypeError 带 `cause` 已透传。**确认无需改 fetch 调用本身**——它已透传。
2. **新增导出 `extractCause`**：在 hub-client.ts 末尾导出纯函数（task-07 的 error-classify.ts 落地后可迁移，本 task 先放此处供 task-02 使用，避免跨 task 阻塞）：
   - 输入 `err: unknown`
   - 输出 `{ message: string, code?: string, status?: number }`
   - 提取规则：`HubHttpError` → `{ message: err.message, status: err.status }`；`TypeError`（fetch failed）→ 读 `err.cause`，cause 是 Error 取 `cause.code ?? cause.name` + `cause.message`；cause 缺失 → `code = err.name`；`TimeoutError`/DOMException（AbortSignal.timeout）→ `code = err.name`（'TimeoutError'）。
3. **不包装 reject**：保持注释 205 的语义——网络错误/超时 fetch 直接 reject 透传，**禁止**新增 try/catch 包装成自定义错误（会破坏 N-2 瘦客户端 + task-07 isRetryable 的 instanceof 判定）。
4. **HubHttpError 不动**：4xx/5xx 已是 HubHttpError（含 status/bodyText/url/method），extractCause 直接读 status。

## 接口定义

```ts
// hub-client.ts 新增导出（纯函数，无副作用）
export interface CauseInfo {
  message: string;   // 人类可读，优先 cause.message 否则 err.message
  code?: string;     // undici code（ECONNREFUSED…）或 err.name
  status?: number;   // HubHttpError 的 HTTP status
}

export function extractCause(err: unknown): CauseInfo {
  if (err instanceof HubHttpError) {
    return { message: err.message, status: err.status };
  }
  const e = err as { message?: string; name?: string; cause?: unknown } | null;
  const message = (e && typeof e.message === 'string' && e.message) || String(err);
  const cause = e?.cause as { code?: string; name?: string; message?: string } | undefined;
  if (cause && (cause.code || cause.name)) {
    return { message: cause.message ?? message, code: cause.code ?? cause.name };
  }
  return { message, code: e?.name };
}
```

控制流：`_request` fetch reject → 原样抛（TypeError/TimeoutError/HubHttpError）→ 上层 onTurnMessage/heartbeat catch → 调 `extractCause(e)` → warn 展开。本 task 只保证透传 + 导出工具。

## 边界处理

1. **cause 为 undefined/非对象**：`extractCause` 走 fallback `code = err.name`，不抛。fetch failed 但 undici 未挂 cause 的旧版本场景兜底。
2. **cause 是字符串**（非标准）：取 `String(err)` 作 message，code=err.name。
3. **不改变现有非 2xx 行为**：`!resp.ok` 仍抛 HubHttpError（225-227），extractCause 对 HubHttpError 返回 status，不触碰 bodyText 解析。
4. **不重试/不退避**：本 task 严禁在 _request 内加重试（那是 task-08 ResilienceService 的职责，N-2 蓝图）。
5. **参数不可变**：extractCause 只读 err/err.cause，不修改。
6. **向后兼容**：现有调用方（heartbeat/submitMessages/claim/complete 等）拿到的 reject Error 类型不变，只是多了可用的 extractCause。

## 非目标

- 不在 _request 加重试/退避（task-08）。
- 不改 HubHttpError 结构（已够用）。
- 不改 daemon.ts 两处 warn（task-02）。
- 不实现 isRetryable/toCauseInfo 在 error-classify.ts（task-07）；本 task 的 extractCause 是过渡，task-07 可迁走并保持导出兼容。
- 不改 AbortSignal.timeout(30s)（task-08 重试时才调整）。

## 参考

- hub-client.ts:205-229（_request 注释"不包装透传" + 实现）
- hub-client.ts:100-108（HubHttpError 构造）
- hub-client.ts:114（DEFAULT_TIMEOUT_MS=30000）
- design.md §5 Phase1 / §9 兼容策略

## TDD 步骤

1. 写测试 `hub-client-cause.test.ts`：① fetch reject TypeError 带 `{cause:{code:'ECONNREFUSED'}}` → extractCause 返回 `{code:'ECONNREFRESSED'}`；② 无 cause 的 TypeError → code=name；③ HubHttpError → 返回 status；④ TimeoutError(DOMException) → code='TimeoutError'。
2. 确认失败（extractCause 未导出）。
3. 实现导出 extractCause（_request 透传已就绪无需改）。
4. `cd sillyhub-daemon && pnpm test` 确认通过。
5. 回归：现有 hub-client.test.ts 全绿。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | `extractCause` 导出存在 | `grep "export function extractCause" sillyhub-daemon/src/hub-client.ts` 命中 |
| AC-02 | _request 仍透传 reject 不包装 | diff 不含新增 try/catch 包裹 fetch 抛自定义错误 |
| AC-03 | TypeError cause 透传 | 测试：mock fetch reject TypeError({cause:{code:'ECONNREFUSED'}}) → _request reject 的 err.cause.code === 'ECONNREFUSED' |
| AC-04 | HubHttpError 提取 status | extractCause(hubErr).status === 503 |
| AC-05 | 无 cause 兜底 | extractCause(new TypeError('x')).code === 'TypeError' |
| AC-06 | 现有测试全绿 | `cd sillyhub-daemon && pnpm test` 通过 |
| AC-07 | typecheck 通过 | `cd sillyhub-daemon && pnpm typecheck` 通过 |
