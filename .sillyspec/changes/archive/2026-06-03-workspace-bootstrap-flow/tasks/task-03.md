---
id: task-03
title: 弹窗去 SSE，「生成项目规范」改为跳转详情页
priority: P0
estimated_hours: 2
depends_on: []
blocks: [task-07]
allowed_paths:
  - frontend/src/components/workspace-scan-dialog.tsx
created_at: 2026-06-03 15:21:49
author: WhaleFall
---

# task-03 弹窗去 SSE，「生成项目规范」改为跳转详情页

把 `workspace-scan-dialog.tsx` 的职责单一化为「扫描 + 新建 + 跳转」。移除弹窗内的
SSE 订阅与 `generating` 阶段，「生成项目规范」点击后调用 `scanGenerate` 拿到
`workspace_id`，用 `router.push('/workspaces/{workspace_id}')` 跳转详情页并关闭弹窗，
实时回显全部交给详情页（task-04）接管。「直接创建」「扫描」「取消」行为保持不变。

依据文档：`design.md` 决策 1（弹窗只建项目并跳转，回显全部交给详情页）、
`plan.md` task-03。

## 修改文件（精确路径）

- `frontend/src/components/workspace-scan-dialog.tsx`（唯一允许修改的文件）

不得修改其它任何文件。

## 实现要求

逐项落实，缺一不可：

1. **引入 useRouter**
   - 顶部新增 `import { useRouter } from "next/navigation";`（Next.js App Router，
     不是 `next/router`）。
   - 在组件体内：`const router = useRouter();`。

2. **删除 SSE 相关 import**
   - 删除 `import { streamAgentRunLogs, type StreamLogEvent, type DoneEventData } from "@/lib/agent";`
     整行。
   - 检查 `createWorkspace` 是否仍被 `handleCreate` 使用：仍使用，故保留 `createWorkspace`
     的 import。`scanGenerate`、`scanWorkspace`、`ScanResult` 均保留。

3. **删除 SSE / generate 相关 state**
   - 删除 `const [logs, setLogs] = useState<string[]>([]);`
   - 删除 `const [agentRunId, setAgentRunId] = useState<string | null>(null);`
   - 删除 `const eventSourceRef = useRef<EventSource | null>(null);`
   - 因不再使用 `useRef`，将顶部 `import { useRef, useState } from "react";` 改为
     `import { useState } from "react";`。

4. **改写 handleGenerate**
   - 移除全部 SSE 订阅逻辑（`streamAgentRunLogs` 调用、`onMessage`/`onDone`/`onError`
     回调、`onDone` 内的 `createWorkspace` 自动回显、`eventSourceRef.current = es`）。
   - 新逻辑：`if (!scan) return;` → 清错 → 调 `scanGenerate(scan.root_path)` →
     取 `workspace_id` → `router.push(\`/workspaces/\${result.workspace_id}\`)`。
   - 失败时 `catch` 内显示错误并把 phase 退回 `"ready"`，不跳转。
   - 详见「接口定义」伪代码。

5. **Phase 类型调整**
   - `type Phase` 去掉 `"generating"`，改为
     `type Phase = "idle" | "scanning" | "ready" | "creating";`。
   - 全文检索并移除所有 `phase === "generating"` 判断分支：
     - root-path `Input` 的 `disabled` 去掉 `|| phase === "generating"`。
     - 「扫描」`Button` 的 `disabled` 去掉 `|| phase === "generating"`。
     - 名称区块的渲染条件 `scan && phase !== "generating"` 改为 `scan &&`（即 `{scan && (...)}`）。
     - footer 取消按钮文案三元 `phase === "generating" ? "取消生成" : "取消"` 改为固定
       `"取消"`。
   - 「生成项目规范」按钮可加 `disabled={phase === "creating"}` 防重复点击（见边界处理）。

6. **删除 generating UI 区块**
   - 删除整段 `{phase === "generating" && ( <section ...> Agent 执行中... </section> )}`
     的 JSX（含 logs 渲染、`agentRunId?.slice(0, 8)`）。

7. **handleScan / handleCreate / handleCancel 行为保持**
   - `handleScan`：不变（扫描 + 自动填名）。
   - `handleCreate`：不变（直接 `createWorkspace` 后 `onCreated()`）。
   - `handleCancel`：移除 `eventSourceRef` 关闭逻辑（已无该 ref），仅保留 `onCancel()`。

## 接口定义

### handleGenerate 新逻辑（照此实现）

```tsx
const handleGenerate = async () => {
  if (!scan) return;
  setError(null);
  try {
    const result = await scanGenerate(scan.root_path);
    // result.workspace_id / result.agent_run_id
    router.push(`/workspaces/${result.workspace_id}`);
    // 跳转后弹窗随路由卸载，无需手动 onCancel；如需保险可保留 onCancel 由父决定
  } catch (err) {
    const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : "生成失败";
    setError(msg);
    setPhase("ready");
  }
};
```

注意：进入 `handleGenerate` 前 phase 已是 `"ready"`；本任务不再切到 `"generating"`。
可在 try 前置 `setPhase("creating")` 以禁用按钮，失败 catch 再退回 `"ready"`；成功跳转
后组件卸载，phase 不再生效。二选一即可，关键是失败路径回到 `"ready"` 且显示错误。

### scanGenerate 返回结构（来自 `@/lib/workspaces`）

```ts
export interface ScanGenerateResponse {
  workspace_id: string;
  agent_run_id: string;
}
export async function scanGenerate(rootPath: string): Promise<ScanGenerateResponse>;
```

本任务只用 `workspace_id` 做跳转；`agent_run_id` 不再在弹窗中使用（详情页 task-04 会
通过 `GET /workspaces/{id}/agent/runs` 自行恢复进行中的 run）。

### useRouter（Next.js App Router）

```tsx
import { useRouter } from "next/navigation";
const router = useRouter();
router.push(`/workspaces/${id}`); // 客户端导航到详情页
```

## 边界处理（至少 5 条）

1. **scanGenerate 失败不跳转**：API 抛错时进入 `catch`，`setError(msg)` 显示
   `${code}: ${message}`（`ApiError`）或兜底「生成失败」，phase 退回 `"ready"`，
   **不调用 `router.push`**，用户停留弹窗可重试。
2. **scan 为 null 直接 return**：`handleGenerate` 首行 `if (!scan) return;`，
   防止未扫描即点击导致 `scan.root_path` 读空。
3. **跳转前清理**：`router.push` 前 `setError(null)`，避免上次错误残留闪现；
   已删除 `eventSourceRef`，`handleCancel` 不再需要关闭 SSE 连接（无悬挂连接泄漏）。
4. **按钮 disabled 防重复点击**：「生成项目规范」按钮在请求进行中禁用（如
   `disabled={phase === "creating"}` 或调用前置 `setPhase("creating")`），避免双击
   触发两次 `scanGenerate`；后端 task-01 幂等也兜底，前端禁用为第一道防线。
5. **name 字段处理**：本任务跳转不再使用 `name`（弹窗不再 `createWorkspace`），
   故 `handleGenerate` 不读取 `name`；但「直接创建」`handleCreate` 仍用
   `name.trim() || rootPath`，须保持其逻辑不变，且名称输入框渲染条件改为
   `{scan && (...)}` 后在 ready 阶段仍正常显示供「直接创建」使用。
6. **路由跳转幂等**：`workspace_id` 缺失（理论不应发生）时不跳转——可信赖类型保证，
   若 `result.workspace_id` 为空字符串则不应执行 push（可加 `if (!result.workspace_id) return;`
   作为防御，非必需）。

## 非目标

- 不修改详情页 `workspaces/[id]/page.tsx`（恢复回显由 task-04 负责）。
- 不修改 `scanGenerate` API 及其 `@/lib/workspaces` 实现（仅消费其返回）。
- 不改后端、不改 SSE 基础设施（`@/lib/agent`、`@/lib/agent-stream`）。
- 「直接创建」（`handleCreate`，已检测到 `.sillyspec` 路径）行为完全不变。
- 「扫描」「取消」「自动填名」逻辑不变。

## 参考

- 详情页 `frontend/src/app/(dashboard)/workspaces/[id]/page.tsx`：`"use client"` 组件，
  说明详情页路由 `/workspaces/{id}` 真实存在，跳转目标有效。
- App Router 客户端导航统一用 `useRouter` from `"next/navigation"`（非 `next/router`）；
  `router.push(\`/workspaces/\${workspace_id}\`)` 完成跳转。
- `scanGenerate` 定义：`frontend/src/lib/workspaces.ts:103-113`。
- 现有弹窗结构：`frontend/src/components/workspace-scan-dialog.tsx`（本次改造对象）。

## TDD 步骤（前端以手动验证为主）

前端组件改造无单测基础设施，采用手动验证：

1. **静态检查**：改完后确认无残留 `streamAgentRunLogs`/`StreamLogEvent`/`DoneEventData`/
   `logs`/`agentRunId`/`eventSourceRef`/`"generating"` 引用（编译应无未用变量/缺失符号错误）。
   运行 `cd frontend && npm run lint`（或 `tsc --noEmit`）确认类型与 lint 通过。
2. **扫描验证**：启动前端，打开「添加 Workspace」，输入有效 root_path → 点「扫描」，
   确认扫描结果与名称输入框正常显示（phase=ready）。
3. **生成跳转验证**：点「生成项目规范」→ 确认页面跳转到 `/workspaces/{id}` 详情页，
   弹窗不再显示「Agent 执行中...」日志区块。
4. **失败路径验证**：模拟 `scanGenerate` 失败（如断后端）→ 确认弹窗内显示错误、
   不跳转、可重试。
5. **直接创建回归**：对已含 `.sillyspec` 的目录扫描 → 点「直接创建」→ 确认仍走原
   `createWorkspace` → `onCreated()` 流程，行为未变。
6. **取消回归**：任意阶段点「取消」→ 弹窗关闭，无报错（无悬挂 SSE）。

## 验收标准

| AC | 描述 | 验证方式 |
|---|---|---|
| AC-1 | `streamAgentRunLogs`、`StreamLogEvent`、`DoneEventData` 的 import 及 `logs`/`agentRunId`/`eventSourceRef` state、`generating` 阶段 UI 全部移除，`Phase` 不含 `"generating"` | 代码检索 + lint/tsc 通过 |
| AC-2 | 点击「生成项目规范」调用 `scanGenerate(scan.root_path)` 成功后 `router.push('/workspaces/{workspace_id}')` 跳转详情页，弹窗内无日志回显区块 | 手动操作观察跳转 |
| AC-3 | `scanGenerate` 失败时显示错误（`code: message` 或「生成失败」）、phase 退回 `ready`、不跳转 | 断后端模拟失败 |
| AC-4 | 「直接创建」「扫描」「取消」「自动填名」行为与改造前一致，未引入回归 | 手动回归 6 步 |
| AC-5 | 引入 `useRouter` from `"next/navigation"`，未误用 `next/router`；`useRef` 已移除 | 代码检索 |
