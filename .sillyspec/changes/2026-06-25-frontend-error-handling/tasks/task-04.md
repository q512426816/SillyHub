---
id: task-04
title: D 模式 16 处收敛——`${code}: ${message}` 改 errMessage/notify，保持原展示方式
priority: P1
estimated_hours: 2.0
depends_on: [task-01]
blocks: [task-09]
requirement_ids: [FR-04]
decision_ids: [D-004@v2, D-007@v1]
allowed_paths:
  - frontend/src/components/api-key-create-dialog.tsx
  - frontend/src/components/daemon-dir-browser.tsx
  - frontend/src/components/health-card.tsx
  - frontend/src/components/server-status-card.tsx
  - frontend/src/components/workspace-scan-dialog.tsx
  - frontend/src/components/workspace-member-add-dialog.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/members/page.tsx
  - frontend/src/app/(dashboard)/settings/api-keys/page.tsx
author: qinyi
created_at: 2026-06-25 10:21:25
---

## 目标

把 8 个文件 16 处反模式 `err instanceof ApiError ? \`${err.code}: ${err.message}\` : "<fallback>"`（把英文 `HTTP_xxx` / 业务 code 拼给中文用户）替换为全局 `errMessage(err, fallback)`，**严格保持原展示方式（toast / inline）不变**，仅去掉对用户暴露的英文 code。覆盖 D-004@v2 的精确 16 处清单。

依据：design.md §1（D 模式定义）/ §6（16 处清单）/ §9（等价替换兼容策略）/ §10 R-02；D-004@v2（实测 16 处）；D-007@v1（按场景区分展示）。

## 前置依赖

- **task-01**：必须先完成，提供 `lib/errors.ts` 的 `errMessage(err, fallback?)`（network_error 中文兜底 / 否则 err.message / 默认 fallback「操作失败」）。
- 本任务**不依赖 task-02**（useNotify）——所有 16 处统一用 `errMessage(err, fallback)` 取文案，展示侧沿用原 setState/message，最小改动；不引入 useNotify（避免在 store/纯回调里改 hook 调用拓扑，R-02 应对）。

## 实现步骤

### 总规则（每处通用）

1. 文件顶部新增 `import { errMessage } from "@/lib/errors";`（与现有 `import { ApiError } from "@/lib/api";` 共存——`ApiError` 仍被 errMessage 之外的逻辑使用，**不要删 ApiError import**）。
2. 把 `${err.code}: ${err.message}` 的三元整体替换为 `errMessage(err, "<原 fallback 中文>")`。
3. 赋值目标不变：原 `setError(msg)` / `setPageError(msg)` / `setState({...,message: msg})` / `message.error(msg)` 形式全部保留 setState/setMessage 调用，仅把三元表达式换成 `errMessage(...)`。
4. fallback 文案逐字保持原中文，不得改动。

### 16 处逐处清单

> 列：文件:行 | 原代码模式 | 原展示方式 | 改法

| # | 文件:行 | 原代码模式 | 原展示 | 改法 |
|---|---|---|---|---|
| 1 | `components/api-key-create-dialog.tsx:53` | `setError(err instanceof ApiError ? \`${err.code}: ${err.message}\` : "签发失败")` | inline（dialog 内 `<div>` 错误条，`useState<string\|null>`） | `setError(errMessage(err, "签发失败"))` |
| 2 | `components/daemon-dir-browser.tsx:49` | `const msg = err instanceof ApiError ? \`${err.code}: ${err.message}\` : "加载失败"; setError(msg);` | inline（`<p>` 红字） | `setError(errMessage(err, "加载失败"));`（删中间 msg 变量直接内联；或保留 `const msg = errMessage(err, "加载失败");`，二选一，建议直接内联简化） |
| 3 | `components/health-card.tsx:35` | `const msg = err instanceof ApiError ? \`${err.code}: ${err.message}\` : "网络错误"; setState({ kind: "error", message: msg });` | inline（state.message 渲染 `<p>`） | `setState({ kind: "error", message: errMessage(err, "网络错误") });`（删中间 msg 变量） |
| 4 | `components/server-status-card.tsx:77` | `const msg = err instanceof ApiError ? \`${err.code}: ${err.message}\` : "网络错误"; setState({ kind: "error", message: msg });` | inline（state.message 渲染 `<p>`） | `setState({ kind: "error", message: errMessage(err, "网络错误") });` |
| 5 | `components/workspace-scan-dialog.tsx:92` (`handleCreateDaemonClient`) | `const msg = err instanceof ApiError ? \`${err.code}: ${err.message}\` : "创建失败"; setError(msg);` | inline（`{error && <p>}`） | `setError(errMessage(err, "创建失败"));` |
| 6 | `components/workspace-scan-dialog.tsx:111` (`handleScan`) | `const msg = err instanceof ApiError ? \`${err.code}: ${err.message}\` : "扫描失败"; setError(msg);` | inline | `setError(errMessage(err, "扫描失败"));` |
| 7 | `components/workspace-scan-dialog.tsx:125` (`handleGenerate`) | `const msg = err instanceof ApiError ? \`${err.code}: ${err.message}\` : "生成失败"; setError(msg);` | inline | `setError(errMessage(err, "生成失败"));` |
| 8 | `components/workspace-scan-dialog.tsx:142` (`handleCreate`) | `const msg = err instanceof ApiError ? \`${err.code}: ${err.message}\` : "创建失败"; setError(msg);` | inline | `setError(errMessage(err, "创建失败"));` |
| 9 | `app/(dashboard)/workspaces/[id]/members/page.tsx:57` (`refresh`) | `setError(err instanceof ApiError ? \`${err.code}: ${err.message}\` : "加载成员列表失败")` | inline（页面顶部红条 + 重试按钮） | `setError(errMessage(err, "加载成员列表失败"))` |
| 10 | `app/(dashboard)/workspaces/[id]/members/page.tsx:82` (`handleRoleChange`) | `setError(err instanceof ApiError ? \`${err.code}: ${err.message}\` : "修改角色失败")` | inline | `setError(errMessage(err, "修改角色失败"))` |
| 11 | `app/(dashboard)/workspaces/[id]/members/page.tsx:110` (`handleTransferOwnership`) | `setError(err instanceof ApiError ? \`${err.code}: ${err.message}\` : "传递所有权失败")` | inline | `setError(errMessage(err, "传递所有权失败"))` |
| 12 | `app/(dashboard)/workspaces/[id]/members/page.tsx:131` (`handleRemove`) | `setError(err instanceof ApiError ? \`${err.code}: ${err.message}\` : "移除成员失败")` | inline | `setError(errMessage(err, "移除成员失败"))` |
| 13 | `components/workspace-member-add-dialog.tsx:78` (search debounce catch) | `const msg = err instanceof ApiError ? \`${err.code}: ${err.message}\` : "搜索失败"; setError(msg);` | inline（对话框内红条 `useState<string\|null>`） | `setError(errMessage(err, "搜索失败"));` |
| 14 | `components/workspace-member-add-dialog.tsx:129` (`handleSubmit` catch) | `const msg = err instanceof ApiError ? \`${err.code}: ${err.message}\` : "添加失败"; setError(msg);` | inline | `setError(errMessage(err, "添加失败"));` |
| 15 | `app/(dashboard)/settings/api-keys/page.tsx:50` (`load`) | `setPageError(err instanceof ApiError ? \`${err.code}: ${err.message}\` : "加载失败")` | inline（页面顶部 pageError 红条） | `setPageError(errMessage(err, "加载失败"))` |
| 16 | `app/(dashboard)/settings/api-keys/page.tsx:82` (`handleRevoke`) | `setPageError(err instanceof ApiError ? \`${err.code}: ${err.message}\` : "吊销失败")` | inline | `setPageError(errMessage(err, "吊销失败"))` |

### 16 处展示方式统计

- **inline（红条 / state.message）：16 处全部**——8 个文件均通过 `setError` / `setPageError` / `setState({kind:"error",message})` 落到内联红条或 `<p>` 红字。
- **toast（antd `message.error`）：0 处**——所有 16 处原本都不是 toast。

> 结论：16 处**统一改 inline 路径**（`setError/setPageError/setState(errMessage(err, fallback))`），**不引入 useNotify**，最小改动且零行为漂移。

### import 整理

每文件检查：`@/lib/api` 的 `ApiError` import 若改后仍有其他引用（如 type guard）则保留；无引用则一并删除（避免 lint unused）。`errMessage` 与 `ApiError` 在 task-01 实现后可在 errors.ts 内部判定，调用文件若不再需要 `instanceof ApiError` 可省 ApiError import。**默认保守保留 ApiError import**（grep 确认每个文件无其他 ApiError 用法再删；workspace-member-add-dialog.tsx 仅这一处用 ApiError，删后须移除 import；其余文件需逐个 grep）。

## 参考代码

### 替换前（health-card.tsx:34-36 典型）

```ts
const msg =
  err instanceof ApiError ? `${err.code}: ${err.message}` : "网络错误";
setState({ kind: "error", message: msg });
```

### 替换后

```ts
import { errMessage } from "@/lib/errors";
// ...
setState({ kind: "error", message: errMessage(err, "网络错误") });
```

### 替换前（members/page.tsx:55-59 典型 inline setError）

```ts
setError(
  err instanceof ApiError
    ? `${err.code}: ${err.message}`
    : "加载成员列表失败",
);
```

### 替换后

```ts
setError(errMessage(err, "加载成员列表失败"));
```

## 验收标准

对应 **AC-03**（plan.md §全局验收）：

- [ ] AC-03a：16 处全部替换为 `errMessage(err, fallback)` 形式；grep `rg '\$\{[^}]*[Cc]ode[^}]*\}\s*[:：]' frontend/src` 残留 = 0（task-09 执行，本任务提前自检 grep 应只剩 task-04 未触及处——本任务覆盖的 8 文件应为 0）。
- [ ] AC-03b：每处原 fallback 中文文案逐字不变（签发失败/加载失败/网络错误/创建失败/扫描失败/生成失败/搜索失败/添加失败/加载成员列表失败/修改角色失败/传递所有权失败/移除成员失败/吊销失败）。
- [ ] AC-03c：每处**原展示方式不变**——16 处原本全部 inline（红条 / `<p>` / state.message），改后仍为 inline，未误改为 toast。
- [ ] AC-03d：`tsc --noEmit` 0 error；`next lint` 通过。
- [ ] AC-03e：8 个文件无未使用 import（ApiError 仅在无其他引用时才删；errMessage 新增 import 均被使用）。

## 测试

- **grep 残留自检**（执行后输出应为空或仅含非业务字符串）：
  ```bash
  rg '\$\{[^}]*[Cc]ode[^}]*\}\s*[:：]' frontend/src/components frontend/src/app
  rg 'err instanceof ApiError \? `\$\{err.code\}' frontend/src
  ```
- **现有测试不破坏**：本任务只动 8 个文件，跑相关组件测试（若有）：
  ```bash
  pnpm test
  ```
  当前 8 文件均无专属测试文件（grep 确认），`pnpm test` 全绿即可。
- **手动验证**（可选）：触发 health-card.tsx / server-status-card.tsx 后端 500，确认显示「网络错误」而非 `HTTP_500_INTERNAL_SERVER_ERROR: ...`。

## 风险/注意事项

- **R-02 误改展示方式**：16 处原本全是 inline，**禁止改成 toast**（不要顺手 `useNotify().error`）。本蓝图明确不依赖 task-02 就是为了规避此风险。verify 阶段必须逐处核对「展示方式」列保持 inline。
- **R-02 遗漏**：design §6 注明「Grill grep 实测 16 处」（多于初估 8），本蓝图已逐一列出，覆盖 workspace-scan-dialog 4 处、members/page.tsx 4 处等高密度文件；执行时按表格勾对，不允许整体改一处漏一处（workspace-scan-dialog.tsx 和 members/page.tsx 各 4 处是遗漏重灾区）。
- **fallback 文案漂移**：严禁把「签发失败」改成「签发失败，请重试」之类——保持逐字原值，仅去掉 `${code}: ` 前缀。
- **未使用 import 误删**：workspace-member-add-dialog.tsx 仅 catch 用 ApiError，替换后 ApiError import 变 unused，须同步删除；其他文件需逐个 grep `ApiError` 用法确认（如 kanban.ts 也 import 了但本任务不改 kanban）。
- **不引入 useNotify**：明确规避——若用 useNotify 会改 setState 调用拓扑（inline→toast），违反 R-02「保持原展示方式」。
