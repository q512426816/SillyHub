---
id: task-05
title: 合并 3 处重复错误处理 util（kanban.ts 局部 errMessage + 2 个 ppm notifyErr）→ 统一 import 全局 errMessage
priority: P1
estimated_hours: 1.0
depends_on: [task-01]
blocks: [task-09]
requirement_ids: [FR-05]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/stores/kanban.ts
  - frontend/src/app/(dashboard)/ppm/problem-list/_forms.tsx
  - frontend/src/app/(dashboard)/ppm/problem-changes/_forms.tsx
author: qinyi
created_at: 2026-06-25 10:21:25
---

## 目标

消灭前端散落的 3 处重复「错误 → 中文文案」逻辑，统一收敛到 Wave 1 task-01 提供的全局 `errMessage(err, fallback?)`（`lib/errors.ts`）。消除多源漂移（局部版缺 network 中文兜底），所有调用点行为对齐 design §7 契约。覆盖 design §6「合并 3 处重复 util」清单与 FR-05。

依据：design.md §1（E 模式「重复实现 3 次，没人抽全局」）/ §6 文件变更清单「kanban.ts / ppm problem-list / problem-changes」/ §9（合并等价，全局版多了 network 兜底，是增强）/ §10；plan.md task-05 + AC-04；D-002@v1（fallback 签名策略，默认「操作失败」）。

> **前置事实核对（编写时已逐文件 grep 确认）**：
> - `frontend/src/stores/kanban.ts:181-185`：有**真正的局部 `errMessage(err, fallback)` 函数**（3 个调用点 :112/:134/:151）。
> - `ppm/problem-list/_forms.tsx:118-121` 与 `ppm/problem-changes/_forms.tsx:111-114`：实际定义的是**局部 `notifyErr(err, fallback)` 函数**（封装 `message.error(err.message ?? fallback)`），**不是** `errMessage` 命名。design §1 / §6 描述「3 处重复 errMessage util」是对意图的概括，精确事实是「1 个 errMessage + 2 个 notifyErr，三者职责重叠（都把 ApiError/任意错误映射为中文文案给 message.error）」。本蓝图按 FR-05「合并重复 util」的意图，3 个文件都收敛到全局 `errMessage`（ppm 的 notifyErr 一并撤掉，调用点改用全局 errMessage + message.error，行为等价）。

## 前置依赖

- **task-01**：必须先完成，提供 `frontend/src/lib/errors.ts` 的 `export function errMessage(err: unknown, fallback?: string): string`（network_error 中文兜底 / 否则 err.message / fallback ?? "操作失败"）。
- 本任务**不依赖 task-02**（useNotify）——store 层（kanban.ts）是 Zustand store 非 React 上下文，**禁止调用 hook**（task-02 R-01 已明示），仍走静态 `message.error(errMessage(...))`；ppm 表单层虽是 React 组件但本次只做「util 合并」最小改动，不引入 useNotify（保持原 `message.error` 调用，避免触发 R-02 展示方式漂移）。

## 实现步骤

### 文件 1：`frontend/src/stores/kanban.ts`（真正的局部 errMessage）

1. **删除局部函数**（:180-185）：
   ```ts
   /** 统一错误文案:ApiError 用后端 message,其它用 fallback。 */
   function errMessage(err: unknown, fallback: string): string {
     if (err instanceof ApiError) return err.message || fallback;
     if (err instanceof Error && err.message) return err.message;
     return fallback;
   }
   ```
2. **顶部 import 新增**（与现有 `import { message } from "antd";` / `import { ApiError } from "@/lib/api";` 同区域）：
   ```ts
   import { errMessage } from "@/lib/errors";
   ```
3. **3 个调用点不变**（:112 / :134 / :151 形式已是 `message.error(errMessage(err, "<中文>"))`，签名兼容，**无需改调用代码**）：
   - :112 `message.error(errMessage(err, "加载人员列表失败"));`
   - :134 `message.error(errMessage(err, "加载任务列表失败"));`
   - :151 `message.error(errMessage(err, "任务排序失败"));`
4. **ApiError import 处理**：grep 确认 kanban.ts 内 `ApiError` 仅被局部 `errMessage` 使用（删除局部函数后变 unused），**同步删除 `import { ApiError } from "@/lib/api";`**（避免 lint unused）。

### 文件 2：`frontend/src/app/(dashboard)/ppm/problem-list/_forms.tsx`（局部 notifyErr）

1. **删除局部函数**（:118-121）：
   ```ts
   function notifyErr(err: unknown, fallback: string) {
     if (err instanceof ApiError) message.error(err.message || fallback);
     else message.error(fallback);
   }
   ```
   保留同文件的 `notifyOk`（:115-117，是成功 toast 包装，**不在本任务范围**——它不处理错误文案，与 errMessage 无职责重叠）。
2. **顶部 import 新增**（与现有 `import { ApiError } from "@/lib/api";` 同区域）：
   ```ts
   import { errMessage } from "@/lib/errors";
   ```
3. **5 个 `notifyErr(err, "<fallback>")` 调用点改写**（行为等价：原 `notifyErr` 等价于 `message.error(err.message || fallback)`，与全局 `errMessage` 的业务错误分支语义一致；全局版多 network 兜底是增强）：
   - :352 `if (err instanceof ApiError) notifyErr(err, "保存失败");` → `if (err instanceof ApiError) message.error(errMessage(err, "保存失败"));`
   - :603 `notifyErr(err, "提交失败");` → `message.error(errMessage(err, "提交失败"));`（ProblemStartForm submit catch）
   - :675 `notifyErr(err, "提交失败");` → `message.error(errMessage(err, "提交失败"));`（ProblemAuditForm submit catch）
   - :752 `notifyErr(err, "提交失败");` → `message.error(errMessage(err, "提交失败"));`（ProblemDoneForm submit catch）
   - :855 `notifyErr(err, "提交失败");` → `message.error(errMessage(err, "提交失败"));`（ProblemCloseForm submit catch）

   > 注意 :352 的 `if (err instanceof ApiError) notifyErr(err, ...)` 形态特殊——原逻辑只对 ApiError 弹 toast（校验失败的 `form.validateFields()` reject 走 else 静默，由表单内联标注）。改写后**保留 `if (err instanceof ApiError)` 守卫**，仅把内部 `notifyErr(err, "保存失败")` 改成 `message.error(errMessage(err, "保存失败"))`。其余 4 处是无守卫的 `notifyErr(err, "提交失败")`（这些 submit 函数没有 validateFields 路径，任意错误都提示），直接替换。

4. **ApiError import 处理**：grep 确认本文件内 `ApiError` 还被 :352 的 type guard 使用，**保留 `import { ApiError } from "@/lib/api";`**。

### 文件 3：`frontend/src/app/(dashboard)/ppm/problem-changes/_forms.tsx`（局部 notifyErr）

1. **删除局部函数**（:111-114）：
   ```ts
   function notifyErr(err: unknown, fallback: string) {
     if (err instanceof ApiError) message.error(err.message || fallback);
     else message.error(fallback);
   }
   ```
   保留同文件的 `notifyOk`（:107-109）。
2. **顶部 import 新增**：
   ```ts
   import { errMessage } from "@/lib/errors";
   ```
3. **3 个 `notifyErr(err, "<fallback>")` 调用点改写**：
   - :341 `if (err instanceof ApiError) notifyErr(err, "提交失败");` → `if (err instanceof ApiError) message.error(errMessage(err, "提交失败"));`（ChangeCreateForm submit catch，保留守卫）
   - :572 `if (err instanceof ApiError) notifyErr(err, "保存失败");` → `if (err instanceof ApiError) message.error(errMessage(err, "保存失败"));`（ChangeEditForm submit catch，保留守卫）
   - :747 `notifyErr(err, "提交失败");` → `message.error(errMessage(err, "提交失败"));`（ChangeAuditForm submit catch，无守卫直接替换）

4. **ApiError import 处理**：本文件 `ApiError` 被 :341 / :572 type guard 使用，**保留**。

## 参考代码

### 局部签名 vs 全局签名兼容核对（核心验收点）

| 来源 | 签名 | ApiError 分支 | Error 分支 | 兜底 | network 中文 | 默认 fallback |
|---|---|---|---|---|---|---|
| kanban.ts 局部（删除前） | `errMessage(err: unknown, fallback: string): string` | `err.message \|\| fallback` | `err.message`（truthy 时） | `fallback` | **无** | 必填 |
| ppm `notifyErr`（删除前） | `notifyErr(err: unknown, fallback: string): void`（直接 message.error） | `message.error(err.message \|\| fallback)` | `message.error(fallback)` | `fallback` | **无** | 必填 |
| 全局 task-01 产物 | `errMessage(err: unknown, fallback?: string): string` | `err.message`（network_error 时中文兜底） | `err.message` | `fallback ?? "操作失败"` | **有**（network_error → 「网络连接失败，请检查网络后重试」） | 可选，默认「操作失败」 |

**兼容性结论**：
- 3 处调用点都**显式传 fallback 字符串**，全局签名 `fallback?` 是 supertype（兼容）。
- 业务错误分支（ApiError 且非 network_error）：局部 `err.message || fallback` vs 全局 `err.message` —— 当 `err.message` 为空字符串时，局部回退到 fallback，全局返回空串（最终由 message.error 显示空）。但**实际不会触发**：后端 `register_exception_handlers`（backend/app/core/errors.py:321-351）保证 message 非空中文。即便边界情况触发，全局版在调用方 `message.error(errMessage(...))` 的位置仍会显示空 toast，与局部 `||fallback` 的差异仅是「极端空 message 时少了 fallback 文案」——属于已知边界增强方向，本次接受（与 design §9「合并无行为差异，全局版多了 network 兜底是增强」一致；如需严格保 fallback 兜底，task-01 实现时可在 `err.message || fallback` 处也兜一层，本蓝图不强制约束 task-01 实现）。
- network 分支：**全局版是纯增强**（中文「网络连接失败…」比局部把 `Failed to fetch` 之类英文抛给用户更友好），符合 G1。
- 返回类型：kanban.ts 局部是 `: string`，全局 `: string` 一致；ppm `notifyErr` 是 `: void`（直接 toast），改写后调用方变成 `message.error(errMessage(...))`，整体仍是 `void` 表达式，无类型冲突。

### kanban.ts 替换示意

```ts
// 替换前（:181-185）
function errMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) return err.message || fallback;
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}

// 替换后（顶部 import）
import { errMessage } from "@/lib/errors";
// （局部函数整段删除，3 个调用点 :112/:134/:151 不动）
```

### ppm _forms.tsx 替换示意

```ts
// 替换前（problem-list/_forms.tsx:118-121）
function notifyErr(err: unknown, fallback: string) {
  if (err instanceof ApiError) message.error(err.message || fallback);
  else message.error(fallback);
}

// 替换后（顶部 import + 删局部函数 + 调用点改写）
import { errMessage } from "@/lib/errors";
// 调用点：notifyErr(err, "提交失败") → message.error(errMessage(err, "提交失败"))
```

## 验收标准

对应 **AC-04**（plan.md §全局验收「3 处局部 errMessage 删除，改 import 全局，行为等价」）：

- [ ] AC-04a：`stores/kanban.ts` 局部 `function errMessage(...)` 定义被删除；`import { errMessage } from "@/lib/errors";` 已加；3 个调用点 :112/:134/:151 形式不变（仍 `message.error(errMessage(err, "<中文>"))`）。
- [ ] AC-04b：`ppm/problem-list/_forms.tsx` 局部 `notifyErr` 删除；5 个调用点全部改为 `message.error(errMessage(err, "<原 fallback>"))`；:352 的 `if (err instanceof ApiError)` 守卫保留。
- [ ] AC-04c：`ppm/problem-changes/_forms.tsx` 局部 `notifyErr` 删除；3 个调用点全部改写；:341 / :572 的 type guard 守卫保留。
- [ ] AC-04d：fallback 中文文案逐字不变（加载人员列表失败 / 加载任务列表失败 / 任务排序失败 / 保存失败 / 提交失败）。
- [ ] AC-04e：grep 残留 = 0：`rg 'function errMessage\(' frontend/src` 仅命中 `lib/errors.ts`（全局定义）；`rg 'function notifyErr\(' frontend/src` 命中 = 0（两 ppm 文件已删）。
- [ ] AC-04f：`tsc --noEmit` 0 error；`next lint` 通过；`import { ApiError }` 在 kanban.ts 已删（unused），在 2 个 ppm _forms.tsx 保留（仍被 type guard 用）。

## 测试

- **grep 残留自检**（执行后输出应符合预期）：
  ```bash
  # 全局 errMessage 仅 lib/errors.ts 定义一次
  rg 'function errMessage\(' frontend/src
  # 期望：仅 frontend/src/lib/errors.ts:XX 命中

  # 局部 notifyErr 已彻底消失
  rg 'function notifyErr\(' frontend/src
  # 期望：无命中

  # 3 个文件的 errMessage 调用应全部解析到全局 import
  rg 'errMessage\(' frontend/src/stores/kanban.ts
  rg 'errMessage\(' 'frontend/src/app/(dashboard)/ppm/problem-list/_forms.tsx'
  rg 'errMessage\(' 'frontend/src/app/(dashboard)/ppm/problem-changes/_forms.tsx'
  ```
- **现有测试不破坏**：跑 `pnpm test`（ppm / kanban 相关测试若有须全绿）。当前 3 文件均无专属单测（grep 确认无 `kanban.test.ts` / `_forms.test.tsx`），`pnpm test` 全绿即可。
- **行为等价手动验证**（可选）：在 kanban 看板触发一次失败（如断网拉任务列表），确认仍弹「加载任务列表失败」toast；在 ppm 问题表单提交触发 422，确认仍弹后端中文 message（非英文 code）。

## 风险/注意事项

- **R-02 风险外延（util 合并版）**：禁止借机改展示方式——3 个文件原本都是 antd `message.error` toast（B 模式），改后**仍须是 `message.error(errMessage(...))` toast**，不要顺手改成 inline 红条或 useNotify（useNotify 在 store 层会破坏 React 上下文约束，task-02 R-01 已明示）。
- **kanban.ts ApiError import 误删/漏删**：删除局部 `errMessage` 后 `ApiError` 在该文件变 unused，**必须同步删 import**，否则 `next lint` 报 unused。执行时 grep `kanban.ts` 内 `ApiError` 确认仅局部函数用到（应仅 1 处 `instanceof ApiError`，随函数删除而消失）。
- **ppm ApiError import 切勿误删**：2 个 ppm `_forms.tsx` 删除 `notifyErr` 后，`ApiError` 仍被 :352 / :341 / :572 的 `if (err instanceof ApiError)` 守卫使用（这些守卫保留），**必须保留 import**。逐文件 grep 区分。
- **:352 / :341 / :572 守卫保留**：这 3 处原逻辑是「只对 ApiError 弹 toast，校验失败（form.validateFields reject）静默走表单内联标注」，改写时**只换 `notifyErr` → `message.error(errMessage(...))`**，外层 `if (err instanceof ApiError)` 守卫不动，避免把校验失败也误弹 toast。
- **空 message 边界**：局部版 `err.message || fallback` 在 err.message 为空时回退 fallback；全局版 task-01 实现需在业务错误分支也兜 `|| fallback`（否则极少数边界空 message 会显示空 toast）。本蓝图已在「兼容核对」表标注，task-01 实现时注意；本任务不强约束 task-01，若 task-01 未兜，本任务验收时手动验证后端业务错误 message 非空即可（后端已保证）。
- **不扩展到 ppm 其它文件**：ppm 目录可能还有其它 `message.error(err.message)` 散点（非本任务范围），本次只动 design §6 列出的 2 个 _forms.tsx；如需全站收敛，后续单独变更（与 N3「不全量收敛」一致）。
