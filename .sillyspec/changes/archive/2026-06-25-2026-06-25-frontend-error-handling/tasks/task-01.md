---
id: task-01
title: 新增 errMessage(err, fallback?) 纯函数（network 兜底 / err.message / fallback）
priority: P0
estimated_hours: 0.5
depends_on: []
blocks: [task-02, task-03, task-04, task-06, task-07]
requirement_ids: [FR-01]
decision_ids: [D-001@v1, D-002@v1, D-006@v1]
allowed_paths:
  - frontend/src/lib/errors.ts
author: qinyi
created_at: 2026-06-25 10:21:25
---

## 目标

新建 `frontend/src/lib/errors.ts`，导出纯函数 `errMessage(err, fallback?)`：从任意错误取出面向用户的中文文案。它是后续 `useNotify`（task-02）、单测（task-03）、daemon 落地（task-04）、D 模式 16 处收敛（task-06）、合并 3 处局部 util（task-07）的共同地基，是整条关键路径的起点。**铁律：返回值绝不暴露英文 err.code（HTTP_xxx）。**

## 前置依赖

无。`ApiError`（`frontend/src/lib/api.ts:61-75`）已存在并 `export`，本任务仅消费其类型与字段。

## 实现步骤

1. 新建空文件 `frontend/src/lib/errors.ts`。
2. 顶部 import：`import { ApiError } from "@/lib/api";`（路径别名 `@/* → ./src/*`，见 CONVENTIONS）。
3. 写函数（精确实现，分支顺序不可调换）：

```ts
/**
 * 从任意错误取出面向用户的中文文案。
 *
 * 规则（按顺序匹配）：
 * 1. ApiError 且 code === "network_error" → 网络层失败的统一中文兜底
 *    （apiFetch catch fetch 异常时抛此 code，见 api.ts:136-141；
 *     err.message 此时是英文 "Failed to fetch"，不能直接展示）。
 * 2. 其它 Error（含 ApiError 业务错误）且 message 非空 → err.message
 *    （后端 AppError.message 已是中文，见 design §1）。
 * 3. 否则 → fallback ?? "操作失败"。
 *
 * 铁律：返回值绝不包含 err.code（英文 HTTP_xxx / 业务码），见 D-006@v1。
 */
export function errMessage(err: unknown, fallback?: string): string {
  if (err instanceof ApiError && err.code === "network_error") {
    return "网络连接失败，请检查网络后重试";
  }
  if (err instanceof Error && err.message) {
    return err.message;
  }
  return fallback ?? "操作失败";
}
```

4. 保存。**不要**在本任务里加 `useNotify`（task-02）或任何测试（task-03）—— 它们是独立 task，保持 PR 小且可独立 review。
5. 跑 typecheck 自检：`cd frontend && pnpm exec tsc --noEmit`（应 0 error；新文件无语法/类型问题）。

## 参考代码

- **`ApiError` 真实定义**（`frontend/src/lib/api.ts:61-75`）：

```ts
export class ApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly requestId: string | null;
  readonly details: unknown;
  constructor(status: number, payload: ApiErrorPayload) {
    super(payload.message);   // Error.message 即后端中文 message
    this.name = "ApiError";
    this.status = status;
    this.code = payload.code;
    this.requestId = payload.request_id;
    this.details = payload.details;
  }
}
```

  → `err.code` 直接可读；`err.message` 由 `super(payload.message)` 赋值，业务错误时是后端中文。

- **network_error 抛出点**（`api.ts:136-141`）：`apiFetch` catch `fetch` 异常时 `throw new ApiError(0, { code: "network_error", message: err.message ?? "Network error", ... })` —— 此时 `err.message` 是英文（"Failed to fetch"），必须走中文兜底，正是分支 1 的存在理由。
- **现有局部 errMessage**（`frontend/src/stores/kanban.ts:181-185`）：行为 `err.message ?? fallback`，无 network 兜底。全局版多了分支 1 是**增强**（task-07 合并时是等价+增强替换）。
- **路径别名**：CONVENTIONS 「Next.js App Router」节，`@/* → ./src/*`。

## 验收标准

对应 plan.md AC-01（task-03 负责编码覆盖）：
- `errMessage` 对 `network_error` 的 ApiError 返回「网络连接失败，请检查网络后重试」。
- 对业务 ApiError（如 409）返回后端中文 message 原值。
- 对普通 Error 返回 `err.message`。
- 对无 message 的值（null / undefined / {} / Error("")）返回 `fallback ?? "操作失败"`。
- 返回值在任何分支都不含 `HTTP_` / err.code 字样（D-006@v1 铁律）。
- `tsc --noEmit` 0 error。

## 测试

本 task 不写测试文件。`errMessage` 的全部行为由 **task-03** 的 `errors.test.ts` 覆盖（6 个 it，含分支 1/2/3 + fallback + 「不含 code」断言）。execute 本 task 时仅需保证 tsc 通过；测试在 task-03 一次性补齐。

## 风险/注意事项

- **分支顺序敏感**：必须先判 `instanceof ApiError && code === "network_error"`，再判 `instanceof Error`。若调换，network_error 会因为「也是 Error 且 message 非空」落入分支 2，把英文 "Failed to fetch" 返给用户（违反铁律）。
- **不要 import 整个 antd**：本文件是纯函数 util，保持零 UI 依赖（`useNotify` 在 task-02 单独加，避免本 task 误带 antd import）。
- **`err.message` 空串判定**：用 `err.message`（truthy）而非 `err.message !== undefined` —— 后端理论不会返空 message，但防御性写法更稳。
- **fallback 默认值**：design D-002@v1 锁定为「操作失败」（全站通用），调用方可传更具体的（如「加载失败」「删除失败」）覆盖。
