---
id: task-03
title: errMessage 单测（network 兜底 / 业务中文 / 非 ApiError / fallback / 绝不含 code）
priority: P0
estimated_hours: 1.0
depends_on: [task-01]
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - frontend/src/lib/errors.test.ts
author: qinyi
created_at: 2026-06-25 10:21:25
---

## 目标

新建 `frontend/src/lib/errors.test.ts`（与源文件 co-locate，惯例见 TESTING.md），用 6 个独立 `it` 覆盖 `errMessage` 的全部分支 + 「返回值绝不含 err.code」铁律（D-006@v1）。本 task 是 AC-01 的唯一编码验收证据，也是 Wave 1 「可独立验证」出口的关键 —— task-01/02 的正确性全靠它把关。

## 前置依赖

- **task-01**：`errMessage` 已存在于 `frontend/src/lib/errors.ts`，本测试 import 它。
- 不依赖 task-02（`useNotify` 不在本测试范围，见 task-02 测试节说明）。

## 实现步骤

1. 新建空文件 `frontend/src/lib/errors.test.ts`（路径在 `lib/` 下，与 `lib/api.test.ts` / `lib/daemon.test.ts` 同级，符合 co-locate 惯例 —— TESTING.md「co-locate 约定：测试就近放在源文件旁的同级 `xxx.test.ts`」）。
2. 顶部 import（**不 import describe/it/expect** —— vitest `globals: true` 已开启，TESTING.md 明示）：

```ts
import { describe, it, expect } from "vitest";  // 实际可不写；但为 IDE 跳转友好可保留 ——
                                                 // 按项目惯例（api.test.ts）实际不写更一致。
// 项目惯例核对：打开 frontend/src/lib/api.test.ts 第 1-5 行确认是否 import vitest。
// 若 api.test.ts 不 import（globals），本文件同样不 import，保持一致。
import { errMessage } from "@/lib/errors";
import { ApiError } from "@/lib/api";
```

   → **执行时第一步先读 `frontend/src/lib/api.test.ts` 头部**，按真实惯例决定是否 import vitest（globals=true 下两种都能跑，但与既有测试一致更专业）。

3. 写测试主体（6 个 it，分支全覆盖）：

```ts
describe("errMessage", () => {
  // 用例 1：业务 ApiError（409 等）→ 返回后端中文 message 原值
  it("returns backend Chinese message for business ApiError", () => {
    const err = new ApiError(409, {
      code: "HTTP_409_DAEMON_RUNTIME_IN_USE",
      message: "该 daemon 仍被 1 个 workspace 绑定，请先解绑后再移除",
      request_id: "req-abc",
      details: { bound_workspaces: ["ws-1"] },
    });
    expect(errMessage(err)).toBe("该 daemon 仍被 1 个 workspace 绑定，请先解绑后再移除");
  });

  // 用例 2：network_error ApiError → 中文兜底（err.message 此时是英文 "Failed to fetch"，不可暴露）
  it("returns Chinese fallback for network_error ApiError (not the English fetch message)", () => {
    const err = new ApiError(0, {
      code: "network_error",
      message: "Failed to fetch",
      request_id: null,
      details: null,
    });
    expect(errMessage(err)).toBe("网络连接失败，请检查网络后重试");
  });

  // 用例 3：普通 Error（非 ApiError）→ err.message
  it("returns err.message for generic Error", () => {
    expect(errMessage(new Error("boom"))).toBe("boom");
  });

  // 用例 4：无 message 的值 → 默认 fallback「操作失败」
  it("returns default fallback when err has no message", () => {
    expect(errMessage(null)).toBe("操作失败");
    expect(errMessage(undefined)).toBe("操作失败");
    expect(errMessage({})).toBe("操作失败");
    expect(errMessage(new Error(""))).toBe("操作失败"); // 空串 message 视为无
  });

  // 用例 5：传 fallback 参数 → 用传入值
  it("uses provided fallback when err has no message", () => {
    expect(errMessage(null, "加载失败")).toBe("加载失败");
    expect(errMessage(new Error(""), "删除失败")).toBe("删除失败");
  });

  // 用例 6：铁律 —— 所有分支返回值绝不包含 err.code / "HTTP_" 字样（D-006@v1）
  it("never exposes English err.code in any branch (D-006@v1)", () => {
    const businessErr = new ApiError(409, {
      code: "HTTP_409_DAEMON_RUNTIME_IN_USE",
      message: "该 daemon 仍被 1 个 workspace 绑定",
      request_id: null,
      details: null,
    });
    expect(errMessage(businessErr)).not.toContain("HTTP_");
    expect(errMessage(businessErr)).not.toContain("HTTP_409_DAEMON_RUNTIME_IN_USE");
    expect(errMessage(businessErr)).not.toContain("DAEMON_RUNTIME_IN_USE");

    const netErr = new ApiError(0, {
      code: "network_error",
      message: "Failed to fetch",
      request_id: null,
      details: null,
    });
    // network 兜底尤其要防 regression：一旦有人改回返 err.message 会暴露英文 + code
    expect(errMessage(netErr)).not.toContain("network_error");
    expect(errMessage(netErr)).not.toContain("Failed to fetch");
    expect(errMessage(netErr)).not.toContain("HTTP_");
  });
});
```

4. 保存。
5. 跑测试：`cd frontend && pnpm test errors`（vitest 按 filename 过滤），应 6/6 通过。
6. 跑全量 typecheck：`cd frontend && pnpm exec tsc --noEmit`（0 error）。
7. 跑全量测试确认无回归：`cd frontend && pnpm test`（既有 `api.test.ts` / `daemon.test.ts` 等应全绿）。

## 参考代码

- **`ApiError` 真实构造签名**（`frontend/src/lib/api.ts:61-75`，**execute 时按此签名构造，勿编造**）：

```ts
export class ApiError extends Error {
  constructor(status: number, payload: ApiErrorPayload) { ... }
}
// ApiErrorPayload = { code: string; message: string; request_id: string | null; details: unknown }
```

  → 构造形如 `new ApiError(409, { code, message, request_id, details })`。**注意 `request_id` 是 snake_case**（payload 字段），构造函数内部映射到 `this.requestId`（camelCase 属性）。测试里构造 payload 必须用 `request_id`。

- **`errMessage` 实现**（task-01 产物，3 分支）：network_error → 中文兜底；Error+message → err.message；否则 fallback ?? "操作失败"。本测试 6 个 it 一一对应。
- **测试惯例**（`.sillyspec/docs/frontend/scan/TESTING.md`）：
  - vitest 2 + jsdom + `globals: true` + `setupFiles: ["./src/test/setup.ts"]`。
  - `tsconfig` `types: ["vitest/globals", ...]` —— 测试内无需 import describe/it/expect。
  - co-locate：`xxx.test.ts` 与源文件同级（`lib/api.test.ts`、`lib/daemon.test.ts` 既有范例）。
  - 运行：`pnpm test`（CI，`vitest run`）/ `pnpm test:watch`。
- **既有同类测试参考**：`frontend/src/lib/api.test.ts`（API 封装测试，构造 ApiError / 断言 code+message 的范例；execute 时打开头 10 行确认 import 风格）。

## 验收标准

对应 plan.md **AC-01**（本 task 是唯一编码证据）：
- ✅ `errMessage` 单测全绿：network_error→中文兜底、业务错误→后端中文 message、非 ApiError→err.message、无 message→fallback。
- ✅ 返回值绝不含 err.code / `HTTP_` / `network_error` / `Failed to fetch` 字样（D-006@v1 铁律，用例 6 显式断言）。
- ✅ `pnpm test errors` 6/6 通过；`pnpm test` 全量绿（无回归）。
- ✅ `tsc --noEmit` 0 error。

## 测试

本 task **本身就是测试**。6 个 it 的覆盖矩阵：

| 用例 | 输入 | 期望输出 | 覆盖分支 |
|---|---|---|---|
| 1 | ApiError(409, 业务码, 中文 msg) | 中文 msg 原值 | 分支 2（ApiError 落 Error 分支） |
| 2 | ApiError(0, network_error, "Failed to fetch") | 「网络连接失败，请检查网络后重试」 | 分支 1（network 兜底） |
| 3 | Error("boom") | "boom" | 分支 2（普通 Error） |
| 4 | null / undefined / {} / Error("") | 「操作失败」 | 分支 3（默认 fallback） |
| 5 | 同 4 但传 fallback="加载失败"/"删除失败" | 传入 fallback | 分支 3（自定义 fallback） |
| 6 | 业务码 ApiError + network_error ApiError | 不含 code/HTTP_/英文 fetch msg | D-006@v1 铁律（跨分支断言） |

边界额外防 regression：用例 6 的 network_error 断言「不含 Failed to fetch」专门守住 task-01 风险节「分支顺序敏感」—— 一旦有人把分支 1 和分支 2 调换，network_error 会落到分支 2 返回英文 "Failed to fetch"，本断言立即失败。

## 风险/注意事项

- **`request_id` 字段名**：构造 ApiError payload 时用 snake_case（`request_id`），不是 `requestId`。错写会被 TS 报错（payload 类型 `ApiErrorPayload`），但注意 review 时不要被属性名 `requestId` 误导。
- **不要测 `useNotify`**：本 task 范围仅 `errMessage`（FR-01 / AC-01）。`useNotify` 是 React hook，测它需 `renderHook` + `<AntApp>` provider + mock message 实例，成本高收益低（1 行转调），其正确性由 task-04 端到端间接覆盖。强行加会偏离 AC-01 范围。
- **空串 message 视为「无」**：用例 4 的 `new Error("")` 应返回 fallback。task-01 实现用 `err.message`（truthy 判定），空串是 falsy 落入分支 3 —— 此为预期，断言锁定之。
- **`{}` 不是 Error 实例**：用例 4 的 `errMessage({})` 走分支 3（既非 ApiError 也非 Error）。不要写成 `errMessage({ message: "x" })` 期望返回 "x" —— 那会失败（非 Error 实例，不读 message 字段）。若想覆盖鸭子类型，需改 errMessage 实现，design 未要求，**勿擅自扩展**（YAGNI）。
- **import vitest 与否**：globals=true 下两种都合法。execute 时**先读 `api.test.ts` 头部**按既有惯例决定，保持风格统一。若 api.test.ts 不 import，本文件也不 import；反之则 import（一致性 > 个人偏好）。
- **测试文件位置**：放 `frontend/src/lib/errors.test.ts`，**不要**新建 `lib/__tests__/errors.test.ts` 子目录 —— `lib/` 下既有 `api.test.ts` / `daemon.test.ts` 都是同级 co-locate，`__tests__/` 子目录仅用于多文件聚合（如 `lib/ppm/__tests__/`）。与本目录单文件惯例对齐。
