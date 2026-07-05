---
id: task-07
title: 新增 resilience/error-classify.ts（isRetryable / toCauseInfo 纯函数）
priority: P0
wave: W2
depends_on: []
blocks: [task-08, task-14]
requirement_ids: [FR-04]
decision_ids: []
allowed_paths:
  - sillyhub-daemon/src/resilience/error-classify.ts
  - sillyhub-daemon/src/resilience/__tests__/error-classify.test.ts
author: qinyi
created_at: 2026-06-24T15:05:00+08:00
---

# task-07: error-classify.ts

> 来源：design.md §5 Phase2 / §7 接口定义；plan.md Wave2 task-07。
> 本质：网络错误分类纯函数 `isRetryable` + cause 提取 `toCauseInfo`。可重试=TypeError(fetch failed)/TimeoutError/HubHttpError 5xx+429；不可重试=HubHttpError 4xx。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/resilience/error-classify.ts` | isRetryable + toCauseInfo |
| 新增 | `sillyhub-daemon/src/resilience/__tests__/error-classify.test.ts` | 单测 |

## 覆盖来源

| 来源 | 内容 | 本 task 体现 |
|---|---|---|
| FR-04 | 错误分类决定重试 | isRetryable 区分可重试/不可重试 |

## 实现要求

1. **`toCauseInfo(err)`**：从 task-01 的 extractCause 迁移/复用（task-01 在 hub-client 导出 extractCause 过渡，本 task 在 error-classify 提供 toCauseInfo，两者语义一致；本 task 实现后 task-02 可改用 toCauseInfo，但为减少跨 task 阻塞，task-02 保留 extractCause，本 task 提供等价 toCauseInfo 供 ResilienceService 用）。
2. **`isRetryable(err)`**：
   - `err instanceof TypeError` → true（fetch failed）
   - `err.name === 'TimeoutError'` 或 AbortSignal.timeout 抛的 DOMException(name='TimeoutError') → true
   - `err instanceof HubHttpError`：status∈{500,502,503,504,429} → true；其余 4xx → false
   - 其他 Error → false（保守，未知错误不重试）
3. **导入 HubHttpError**：从 `../hub-client.js` 导入。

## 接口定义

```ts
import { HubHttpError } from '../hub-client.js';

export function isRetryable(err: unknown): boolean {
  if (err instanceof TypeError) return true;                       // fetch failed
  if ((err as Error | undefined)?.name === 'TimeoutError') return true; // AbortSignal.timeout
  if (err instanceof HubHttpError) {
    const s = err.status;
    return s === 429 || (s >= 500 && s <= 599);
  }
  return false;
}

export interface CauseInfo { message: string; code?: string; status?: number; }
export function toCauseInfo(err: unknown): CauseInfo { /* 同 task-01 extractCause 逻辑 */ }
```

## 边界处理

1. **err 非 Error**：isRetryable→false；toCauseInfo→String(err) 兜底。
2. **4xx fail-fast**：401/403/404/422 不可重试（业务错误，重试无意义）。
3. **429 重试**：限流可恢复，重试 + 退避。
4. **AbortError 不重试**：name='AbortError' 非 TimeoutError，isRetryable→false（主动停止）。
5. **参数不可变**：纯函数只读。
6. **未知错误保守**：非 TypeError/TimeoutError/HubHttpError → false，避免盲目重试。

## 非目标

- 不实现重试循环（task-08）。
- 不实现退避计算（task-08）。
- 不改 hub-client extractCause（task-01 过渡，保留兼容）。

## 参考

- task-01 extractCause（toCauseInfo 等价逻辑）
- hub-client.ts HubHttpError（status 字段）
- design.md §5 Phase2 / §7

## TDD 步骤

1. 写测试：TypeError→true；TimeoutError→true；HubHttpError 503/429→true；HubHttpError 404/422→false；AbortError→false；普通 Error→false。
2. 确认失败。
3. 实现。
4. `cd sillyhub-daemon && pnpm test` 通过。
5. 回归。

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | isRetryable 导出 | grep 命中 |
| AC-02 | TypeError 可重试 | 测试 true |
| AC-03 | 5xx/429 可重试 | 测试 503/429 true |
| AC-04 | 4xx 不可重试 | 测试 404/422 false |
| AC-05 | TimeoutError 可重试 | 测试 true |
| AC-06 | AbortError/普通 Error 不重试 | 测试 false |
| AC-07 | 测试全绿 | `pnpm test` 通过 |
