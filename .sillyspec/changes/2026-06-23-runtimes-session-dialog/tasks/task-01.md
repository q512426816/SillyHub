---
id: task-01
title: 提取会话 helper 到 runtime-session-helpers.tsx（Wave-1，前置解耦）
priority: P1
estimated_hours: 1
depends_on: []
blocks: [task-02, task-03, task-04]
requirement_ids: [NFR-5]
decision_ids: []
allowed_paths:
  - frontend/src/components/daemon/runtime-session-helpers.tsx
  - frontend/src/app/(dashboard)/runtimes/page.tsx
created_at: 2026-06-23T10:29:26+08:00
author: qinyi
---

# task-01: 提取会话 helper 到 runtime-session-helpers.tsx（Wave-1，前置解耦）

> 纯符号迁移 + 命名导出，**行为零变更**。目的是为 task-02（新建 `RuntimeSessionDialog`）扫清 `page.tsx ↔ runtime-session-dialog.tsx` 循环依赖障碍（NFR-5）。本任务不引入任何新逻辑、不改 props 签名、不调整样式 class、不动后端。

## 修改文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `frontend/src/components/daemon/runtime-session-helpers.tsx` | 8 个会话符号 + `shortId` 的全新家，全部命名导出 |
| 修改 | `frontend/src/app/(dashboard)/runtimes/page.tsx` | 删除被迁移的内部定义，改为从 helpers 文件 import；保留 `shortId` 引用（同源 import） |

> 不动 `interactive-session-panel.tsx`（仅作为 import 目标，路径相对不变，因 helpers 与其同在 `components/daemon/` 目录）、不动 `page.test.tsx`（测试断言不依赖内部符号定义位置，只依赖 DOM 渲染，行为不变即不回归）。

## 覆盖来源

- **Requirements**：
  - `NFR-5`：helper 提取避免 `page ↔ dialog` 循环依赖（独立 `runtime-session-helpers.tsx`）。本任务直接落地该非功能需求——把 `page.tsx` 内联的会话符号独立成模块，使后续 `runtime-session-dialog.tsx` 可单向 `import` helpers 而无需反向引用 `page.tsx`。
- **Decisions**：无（本任务是纯结构性前置解耦，不承载决策；task-02/03/04 才消费 D-001~D-004）。

## 实现要求

### 步骤 1：新建 `frontend/src/components/daemon/runtime-session-helpers.tsx`

文件骨架：

```tsx
"use client";

// 1. React / next/navigation
import { useMemo } from "react";
// 注：InteractiveSessionChatSection 用到 useRouter/useSearchParams，随组件一起迁入
import { useRouter, useSearchParams } from "next/navigation";

// 2. UI 依赖
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

// 3. 业务类型 / 数据
import { InteractiveSessionPanel, type SessionTurnView } from "@/components/daemon/interactive-session-panel";
import { type AgentRunLogEntry } from "@/lib/agent";
import {
  PROVIDER_META,
  type AgentSessionRead,
  type AgentSessionStatus,
  type DaemonRuntimeRead,
} from "@/lib/daemon";
import { cn } from "@/lib/utils";
// icon：SessionsSidebar/SessionHistoryView/InteractiveSessionChatSection 里用到的
// MessageSquarePlus / RefreshCw / Trash2 从 lucide-react import
import { MessageSquarePlus, RefreshCw, Trash2 } from "lucide-react";
```

按 page.tsx 原始相对顺序，把以下符号整体搬入，**每个都加 `export`**（保持 `function` 声明形式，不改成箭头函数，避免 hoisting 差异）：

| 符号 | page.tsx 原行 | 类型 | 迁入要点 |
|---|---|---|---|
| `shortId` | 228-230 | 纯函数 | `page.tsx` 多处（`RuntimeCard` / `handleDelete` / `SessionListSection`）仍在用，迁出后 page 改 import；helpers 内部 `SessionsSidebar`/`SessionHistoryView` 也可直接引用同文件 |
| `InteractiveSessionChatSection` | 447-535 | 组件 | `useRouter`/`useSearchParams` 调用随组件整体迁入（注释 `ql-20260623` 保留）；依赖 `InteractiveSessionPanel` + `SessionTurnView` + `DaemonRuntimeRead`/`AgentSessionRead`；**props 签名一字不改** |
| `ACTIVE_SESSION_VIEW_STATUSES` | 796-800 | `ReadonlySet<AgentSessionStatus>` 常量 | `export const` |
| `isActiveSession` | 802-804 | 纯函数 | 引用本文件 `ACTIVE_SESSION_VIEW_STATUSES` |
| `SessionsSidebar` | 810-899 | 组件 | 引用 `isActiveSession`/`shortId`/`PROVIDER_META`/`Badge`/`Button`/`cn` + `Trash2`/`RefreshCw` icon；**props 签名一字不改** |
| `canResumeSession` | 907-914 | 纯函数 | 入参 `AgentSessionRead \| null` |
| `resumeDisabledTitle` | 917-921 | 纯函数 | 入参 `AgentSessionRead` |
| `logsToTurns` | 927-963 | 纯函数 | 入参 `AgentRunLogEntry[]`，返回 `SessionTurnView[]`；注释（含 `ql-20260621` token 说明）保留 |
| `SessionHistoryView` | 969-1074 | 组件 | 引用 `useMemo`/`canResumeSession`/`resumeDisabledTitle`/`shortId`/`Button`/`MessageSquarePlus` icon；**props 签名一字不改** |

**注意 `shortId` 的归属决策**（取舍说明）：`shortId` 被 `RuntimeCard`（留在 page）、`handleDelete`（留在 page）、`SessionsSidebar`、`SessionHistoryView` 共 4 处使用，跨 page 与 helpers 两端。倾向「被多处用到的下沉」——故把 `shortId` 下沉到 helpers 并 export，page.tsx 改 import 复用，避免在两端各保留一份导致漂移。

`PROVIDER_META` / `getProviderLabel`：`PROVIDER_META` 本身来自 `@/lib/daemon`（外部模块），`getProviderLabel` 是 page.tsx 内部 helper（被 `RuntimeCard`、`getCapabilityChips`、`SessionListSection` header、`handleDeleteRuntime`、`displayItems` 排序用，全部留在 page）。**不下沉** `getProviderLabel`（它在 page 内多处用，且 helpers 内组件用到的只是 `PROVIDER_META[s.provider]?.label` 这一表达式，不是 `getProviderLabel`）。`PROVIDER_META` 在 helpers 内直接从 `@/lib/daemon` import 即可。

### 步骤 2：page.tsx 删除内部定义 + 改 import

1. 顶部 import 区追加：
   ```tsx
   import {
     ACTIVE_SESSION_VIEW_STATUSES,
     InteractiveSessionChatSection,
     SessionHistoryView,
     SessionsSidebar,
     canResumeSession,
     isActiveSession,
     logsToTurns,
     resumeDisabledTitle,
     shortId,
   } from "@/components/daemon/runtime-session-helpers";
   ```
2. 删除 page.tsx 内的以下定义块（连同上方 JSDoc 注释一起删，注释随符号迁到 helpers）：
   - `shortId`（228-230）
   - `InteractiveSessionChatSection`（439-535，含上方 task-11 注释块）
   - `ACTIVE_SESSION_VIEW_STATUSES` + `isActiveSession`（794-804，含上方 `── 会话列表 + 历史回看` 分隔注释）
   - `SessionsSidebar`（806-899，含 JSDoc）
   - `canResumeSession` + `resumeDisabledTitle`（901-921，含 JSDoc）
   - `logsToTurns`（923-963，含 JSDoc）
   - `SessionHistoryView`（965-1074，含 JSDoc）
3. 保留 page.tsx 其余所有符号原样：`getStatusMeta`/`getProviderLabel`/`getProviderTone`/`PROVIDER_TONES`/`getAgents`/`getCapabilityChips`/`ProviderBadge`/`RuntimeCard`/`SessionListSection`/`RuntimesPage` 等不动。
4. `SessionListSection`（留在 page）仍引用 `SessionsSidebar`/`SessionHistoryView`/`InteractiveSessionChatSection`/`logsToTurns`/`isActiveSession`/`shortId` —— 这些现在全部来自顶部 import，调用处零改动。
5. `RuntimesPage` 内 `sessionStatsByRuntime` 用的 `isActiveSession` 同理来自 import。
6. 清理 page.tsx 顶部不再使用的 import（若某 icon/类型迁出后 page 不再用）：逐项核对——`MessageSquarePlus` 仅 `SessionHistoryView` 用 → 从 page 的 lucide-react import 中移除；`SessionTurnView` 仅 `InteractiveSessionChatSection`/`logsToTurns` 用 → 从 page 的 `interactive-session-panel` import 中移除（保留 `InteractiveSessionPanel`）；`AgentRunLogEntry` 仍被 `SessionListSection` 的 state 用 → 保留；`AgentSessionStatus` 检查 page 是否还直接引用（`ACTIVE_SESSION_VIEW_STATUSES` 迁走后若 page 不再出现 `AgentSessionStatus` 字面量则移除）。**最终以 `tsc --noEmit` + `pnpm lint` 无 unused 报错为准**，不要凭记忆删 import。

### 步骤 3：验证行为不变

1. `cd frontend && pnpm lint`（ruff/eslint 无 unused / 无循环依赖告警）
2. `cd frontend && pnpm exec tsc --noEmit`（类型零变更，必须通过）
3. `cd frontend && pnpm exec vitest run src/app/\(dashboard\)/runtimes/page.test.tsx`（现有测试全绿，DOM 断言不依赖符号位置，只依赖渲染结果 → 不应回归）

## 完成标准

- [ ] `frontend/src/components/daemon/runtime-session-helpers.tsx` 存在，命名导出 9 个符号（8 个会话符号 + `shortId`），每个 export 名与原内部名完全一致。
- [ ] `frontend/src/app/(dashboard)/runtimes/page.tsx` 不再内联定义这 9 个符号（grep `function InteractiveSessionChatSection` / `function SessionsSidebar` / `function SessionHistoryView` / `function logsToTurns` / `function canResumeSession` / `function isActiveSession` / `function resumeDisabledTitle` / `const ACTIVE_SESSION_VIEW_STATUSES` / `function shortId` 在 page.tsx 内 0 命中）。
- [ ] `pnpm lint` 通过（无 unused import、无未使用变量）。
- [ ] `tsc --noEmit` 通过。
- [ ] `vitest run page.test.tsx` 现有断言全绿（行为不变 = 用例不回归；**不新增测试**，新 helpers 的测试覆盖由 task-05/06 在弹窗语境下补）。
- [ ] page.tsx 内所有原本调用这些符号的位置（`SessionListSection` / `RuntimesPage`）编译通过且运行时行为与迁移前一致（人工 diff 确认无逻辑改动，只有定义位置迁移 + import 路径变化）。

## 注意事项

1. **export 命名一致性**：helpers 文件里的每个符号名必须与 page.tsx 原内部名一字不差（含大小写），否则 page.tsx 的调用处和未来 dialog 的 import 都要跟着改，违背「纯移动」原则。`function` 声明形式保留（不转箭头函数），保持 hoisting 行为一致。

2. **循环依赖预防（NFR-5 核心）**：
   - helpers 文件 **不得** import `page.tsx`（单向依赖：page → helpers，未来 dialog → helpers）。
   - helpers 依赖图：`runtime-session-helpers.tsx` → `interactive-session-panel.tsx` + `@/lib/daemon` + `@/lib/agent` + `@/components/ui/*` + `@/lib/utils` + `next/navigation` + `lucide-react`。全部是叶子依赖，无环。
   - 验收时 `pnpm lint` 若报 `import/no-cycle` 即说明 helpers 误引了 page，需修正。

3. **hook 随组件迁移**：`InteractiveSessionChatSection` 内的 `useRouter()` / `useSearchParams()` 调用（写/清 URL `?session=`）**整体随组件迁入 helpers**，逻辑零改动（`handleSessionCreated` / `handleSessionReset` 原样搬）。`next/navigation` 的 import 在 helpers 顶部声明。这是「行为不变」的关键——hook 调用点和闭包依赖（`router`/`searchParams`）随组件一起移动，组件渲染上下文不变，URL 行为不变。

4. **`"use client"` 指令**：helpers 文件顶部必须有 `"use client";`（含 `useRouter`/`useSearchParams`/`useMemo` 等 client-only hook，且被 client component page.tsx 引用）。缺这条指令会导致 Next.js 编译期报错。

5. **JSDoc / 注释保留**：原符号上方的 JSDoc（如 `task-11 D-004` 续聊说明、`ql-20260619-007` active 只读说明、`ql-20260621` token 说明、`ql-20260623` URL param 说明）随符号迁入 helpers，保持代码考古链路完整。page.tsx 内删除符号时连同样关注释一起删（避免悬空注释）。

6. **import 粒度**：page.tsx 顶部新增的 helpers import 用具名导入列表（不用 `import * as`），与项目现有风格一致（参考 page.tsx 对 `@/lib/daemon` 的具名 import 模式）。

7. **`shortId` 双向引用确认**：迁出后 page.tsx 的 `RuntimeCard`（638 行 `shortId(runtime.id)`）、`handleDelete`（1198 行）、`SessionListSection` header（如 `shortId(session.id)` 在删除 confirm 里）均通过顶部 import 复用同一份，杜绝两份实现漂移。

8. **不动测试**：本任务不碰 `page.test.tsx`（行为不变 → 测试不回归即可），也不新建 helpers 单测（helpers 的行为由 `page.test.tsx` 现有断言 + task-05/06 弹窗测试间接覆盖）。测试改动集中在 task-05/06。
