---
id: task-04
title: page.tsx 精简 + 接弹窗 + URL 恢复（Wave-3）
priority: P1
estimated_hours: 2
depends_on: [task-01, task-02]
blocks: [task-05]
requirement_ids: [FR-03, FR-05, FR-06]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - frontend/src/app/(dashboard)/runtimes/page.tsx
author: qinyi
created_at: 2026-06-23T10:29:26+08:00
---

# task-04: page.tsx 精简 + 接弹窗 + URL 恢复（Wave-3）

> 覆盖：FR-03（页面精简）、FR-05（关闭清理）、FR-06（URL 恢复）；决策 D-001@v1（弹窗单例）、D-003@v1（URL 恢复 + onClose 时序）
> 依赖：task-01（`runtime-session-helpers.tsx` 提取 `InteractiveSessionChatSection` / `isActiveSession` 等命名导出）、task-02（`RuntimeSessionDialog` 组件 props `{runtime, open, onClose, runtimes}`）
> 当前时间：2026-06-23T10:29:26+08:00，作者：qinyi

## 修改文件

| 操作 | 文件 | 说明 |
|---|---|---|
| 修改 | `frontend/src/app/(dashboard)/runtimes/page.tsx` | 移除底部常驻会话区；接 `RuntimeSessionDialog`；URL 恢复编排上移到 page；卡片调大；helper 改 import |

**仅此一个文件**。task-01（helpers 提取）/ task-02（弹窗组件）在本任务前完成，page 只消费。

## 覆盖来源

- **design.md §5 Phase-3（页面精简）**：移除底部 `SessionListSection` + `sessionSectionRef` + scroll；新增 `dialogRuntime` state；`handleOpenSession` 改 `setDialogRuntime`；卡片放宽；15s 轮询保留。
- **design.md §5 Phase-4（URL 恢复 / D-003）**：page mount 读 `?session=` → `getAgentSession` 查 `runtime_id` + status → 活跃开弹窗 attach / 非活跃清 param；`onClose` 清 param。
- **design.md §9 兼容**：纯前端组件重构，无 API 变更；回退移除 `RuntimeSessionDialog` 即回退。
- **requirements.md FR-03**：无底部常驻会话区，主体为摘要卡 + runtime 卡片，卡片更舒展。
- **requirements.md FR-05**：关闭弹窗 → `clearSessionParam`（D-003 onClose 时序，C-3 补强）。
- **requirements.md FR-06**：URL `?session=<活跃>` 自动开弹窗 attach；ended/failed/不存在清 param 降级。
- **decisions.md D-001@v1**：单例 `dialogRuntime`，切换 runtime 即替换（`RuntimeSessionDialog` 内部 `key` 重 mount 由 task-02 实现）。
- **decisions.md D-003@v1 + C-3 补强**：URL 写入由 `InteractiveSessionChatSection.onSessionCreated`（新建/续聊成功）；清除由 page 的 `handleCloseDialog` 负责；语义=活跃中刷新可恢复，主动关闭不恢复。

## 实现要求

### 步骤 a — 精简 page（移除底部常驻会话区 + focusedRuntime → dialogRuntime）

依据：design.md §5 Phase-3。

1. **删除组件级定义**（这些已随 task-01 提取到 `runtime-session-helpers.tsx`，page 不再需要本地定义）：
   - `InteractiveSessionChatSection`（约 447-535）—— 移除本地定义，改 import（见步骤 e）。
   - `SessionsSidebar`（约 810-899）、`SessionHistoryView`（约 969-1074）、`SessionListSection`（约 1080-1311）—— 全部移除（不再渲染常驻会话区，无需这些组件留在 page）。
   - `ACTIVE_SESSION_VIEW_STATUSES` / `isActiveSession` / `canResumeSession` / `resumeDisabledTitle` / `logsToTurns`（约 796-963）—— 移除本地定义，改 import 仍需用到的（见步骤 e）。
2. **改 page state**（`RuntimesPage`，约 1313）：
   - 移除 `const [focusedRuntime, setFocusedRuntime] = useState<DaemonRuntimeRead | null>(null)`（约 1320）。
   - 移除 `const sessionSectionRef = useRef<HTMLDivElement>(null)`（约 1321）。
   - 新增 `const [dialogRuntime, setDialogRuntime] = useState<DaemonRuntimeRead | null>(null)`。
3. **`handleDeleteRuntime` 内引用更新**（约 1377）：`if (focusedRuntime?.id === runtime.id) setFocusedRuntime(null)` → `if (dialogRuntime?.id === runtime.id) setDialogRuntime(null)`；依赖数组 `focusedRuntime?.id` → `dialogRuntime?.id`。
4. **删除底部渲染块**（约 1546-1552）：移除 `<div ref={sessionSectionRef} className="scroll-mt-6"><SessionListSection ... /></div>` 整块及其外层 `<div className="space-y-5">` 包装（若剩余只有 runtime 列表 section，可直接平铺，保留 `space-y-*` 间距由父 `<main>` 的 `gap-5` 提供）。
5. **保留**：`items` / `error` / `refreshing` / `runtimeActionId` / `lastRefreshedAt` / `sessions` state 不变；`reload` / `handleToggleRuntime` / `handleDeleteRuntime` / 15s 轮询 / `displayItems` / `stats` / `sessionStatsByRuntime` 全部保留（卡片展示仍用 `sessionStatsByRuntime`，`sessions` 仍由 `reload` 拉 `listAgentSessions({limit:100})`）。

### 步骤 b — 接弹窗（handleOpenSession + 渲染 RuntimeSessionDialog）

依据：design.md §5 Phase-3、§7 props。

1. **改 `handleOpenSession`**（约 1387-1392）：
   ```ts
   const handleOpenSession = useCallback((runtime: DaemonRuntimeRead) => {
     setDialogRuntime(runtime);
   }, []);
   ```
   - 移除 `setFocusedRuntime` + `setTimeout` + `scrollIntoView`（不再滚动）。
2. **新增 `handleCloseDialog`**（与 URL 恢复 onClose 时序耦合，见步骤 c 一起实现）。
3. **渲染 `RuntimeSessionDialog`**：在 `<main>` 内、`<>...</>` 闭合 `</>` 之前（即与 error/列表同级、作为 main 的最后一个子元素），新增：
   ```tsx
   <RuntimeSessionDialog
     runtime={dialogRuntime}
     open={dialogRuntime !== null}
     onClose={handleCloseDialog}
     runtimes={items ?? []}
   />
   ```
   - `open` 由 `dialogRuntime !== null` 派生（单例，D-001）。
   - 切换 runtime（点 B 时 A 已开）→ `dialogRuntime` 替换 → RuntimeSessionDialog 内部 `key={runtime.id}`（task-02 实现）重 mount 清旧状态。
   - `items` 为 null（加载中）时弹窗也不会开（`handleOpenSession` 只能从已渲染的 RuntimeCard 触发，此时 items 必非 null）。

### 步骤 c — URL 恢复编排（从 SessionListSection 上移到 page）+ onClose 时序

依据：design.md §5 Phase-4、decisions.md D-003@v1 + C-3 补强。

> 现有 URL `?session=` 恢复逻辑在 `SessionListSection`（约 1129-1174），用 `writeSessionParam` / `clearSessionParam` / `getAgentSession` + `urlRestoreDoneRef`。task-01 提取 helper 时**不**把这套编排搬走——它属于 page 职责（page 持有 `dialogRuntime`，恢复点 = 开弹窗）。page 需重建等价的编排。

1. **page 新增 URL 恢复 state / ref / helper**（在 `RuntimesPage` 内）：
   ```ts
   const router = useRouter();
   const searchParams = useSearchParams();
   const urlRestoreDoneRef = useRef(false);
   ```
   - 顶部 `import { useSearchParams, useRouter } from "next/navigation"` 已存在（约 5），保留。
2. **`clearSessionParam` helper**（page 内定义，onClose 与降级共用）：
   ```ts
   const clearSessionParam = useCallback(() => {
     const next = new URLSearchParams(searchParams.toString());
     next.delete("session");
     const qs = next.toString();
     const target = qs ? `?${qs}` : window.location.pathname;
     router.replace(target, { scroll: false });
   }, [router, searchParams]);
   ```
   - **不**在 page 定义 `writeSessionParam`——写入仍由 `InteractiveSessionChatSection.onSessionCreated`（已随 task-01 提取到 helper，自带 `handleSessionCreated`/`handleSessionReset`）负责，page 不重复。
3. **`handleCloseDialog`**（D-003 C-3 时序：用户主动关闭 = 放弃恢复点）：
   ```ts
   const handleCloseDialog = useCallback(() => {
     setDialogRuntime(null);
     clearSessionParam();
   }, [clearSessionParam]);
   ```
   - 顺序：先清 state（关弹窗触发 RuntimeSessionDialog unmount → task-02 内 SSE/轮询 cleanup，FR-05 / R-02），再清 param。
4. **URL 恢复 effect**（mount 读 `?session=`）：
   ```ts
   useEffect(() => {
     if (urlRestoreDoneRef.current) return;
     const sessionId = searchParams.get("session");
     if (!sessionId) return;
     // 等 items 加载完成（reload 的 finally setItems）
     if (items === null) return;
     urlRestoreDoneRef.current = true;
     void (async () => {
       let session: AgentSessionRead | null =
         sessions.find((s) => s.id === sessionId) ?? null;
       if (!session) {
         try { session = await getAgentSession(sessionId); }
         catch { session = null; } // 不属于本用户/已删/网络 → 降级
       }
       if (session && isActiveSession(session)) {
         const runtimeId = session.runtime_id;
         const matched = (items ?? []).find((r) => r.id === runtimeId) ?? null;
         // 活跃 → 开对应 runtime 弹窗，attach 由 RuntimeSessionDialog D-002 默认态接管
         setDialogRuntime(matched);
         // 注意：即使 matched 为 null（runtime 已离线/删除）也尝试开弹窗，
         // RuntimeSessionDialog 传 runtime=null 时 open=false 不显示，避免卡死；
         // 但更稳妥：matched 为 null 时降级清 param（见下）
         if (!matched) clearSessionParam();
       } else {
         // ended / failed / 不存在 → 降级 idle + 清 param（边界 6 / R-03）
         clearSessionParam();
       }
     })();
   }, [searchParams, items, sessions, clearSessionParam]);
   ```
   - **关键**：恢复编排不再 `setAttachSession`（那是旧 SessionListSection 的内部 state），而是 `setDialogRuntime(匹配 runtime)`。弹窗 open 后，RuntimeSessionDialog 按 D-002 默认态（有活跃 → attach 最近活跃；此处最近活跃即 URL 指向的会话）接管 attach 链路。page 不直接控制 attach。
   - `isActiveSession` 从 helper import（步骤 e）。
   - `getAgentSession` 已在顶部 import（约 38），保留。
   - 防御 `urlRestoreDoneRef` 只执行一次（避免 items/sessions 重载重复触发）。
5. **依赖关系**：`handleCloseDialog` / URL effect / `clearSessionParam` 互相通过 useCallback 稳定引用；effect 依赖数组含 `items, sessions, clearSessionParam`。

### 步骤 d — 卡片调大（runtime-list-scroll 放宽 + grid 间距）

依据：design.md §5 Phase-3「卡片放宽高度限制、grid 调整」、R-05 测试逐条重写①（`max-h-[680px]` class 断言失效）。

1. **`runtime-list-scroll` 容器**（约 1525-1528）：
   - 现：`className="max-h-[680px] overflow-y-auto pr-1"`。
   - 改为移除 `max-h-[680px]`（让卡片列表自然撑开页面，主体精简后页面本就不长）；保留 `data-testid="runtime-list-scroll"`；可保留 `overflow-y-auto`（runtime 极多时仍可滚）或一并移除。**推荐**：`className="pr-1"`（仅留间距），让页面整体滚动。
   - 若担心 runtime 很多导致页面过长，可调高为 `max-h-[none]` 或更大值如 `max-h-[1200px]`；本任务取「移除 max-h」最简洁，符合「卡片更舒展」。
2. **grid 间距**（约 1529）：`className="grid gap-3 xl:grid-cols-2"` → `className="grid gap-4 xl:grid-cols-2"`（`gap-3` → `gap-4`，间距加大）。
3. **保留 15s 轮询**（约 1398-1403）不变；`reload` 仍拉 runtimes + sessions（卡片会话统计 `sessionStatsByRuntime` 仍需 sessions）。
4. **SummaryCard 网格**（约 1487）：不变（`grid gap-3 sm:grid-cols-2 xl:grid-cols-5`）。

### 步骤 e — helper 改 import

依据：design.md §6 helper 提取说明、§10 C-2（防循环依赖）。

task-01 将以下符号提取到 `frontend/src/components/daemon/runtime-session-helpers.tsx` 并命名导出。page 精简后需用的：

1. **顶部新增 import**：
   ```ts
   import {
     isActiveSession,
     // 若 page 不再渲染会话列表/历史，下面这些可能不需要——按精简后实际引用决定
   } from "@/components/daemon/runtime-session-helpers";
   import { RuntimeSessionDialog } from "@/components/daemon/runtime-session-dialog";
   ```
2. **page 精简后实际仍需的 helper 符号**（最小集）：
   - `isActiveSession` —— URL 恢复编排用（步骤 c）。
   - 可能**不需要** `InteractiveSessionChatSection`（page 不再渲染会话区，会话区全在弹窗内）、`SessionsSidebar`、`SessionHistoryView`、`logsToTurns`、`canResumeSession`、`resumeDisabledTitle`、`ACTIVE_SESSION_VIEW_STATUSES`——这些移除本地定义后若 page 无引用则不 import（让 ESLint no-unused 暴露真正未用符号）。
   - `PROVIDER_META` / `shortId` / `getProviderLabel` —— `getProviderLabel` 仍被 `RuntimeCard` / `handleDeleteRuntime` 用，`PROVIDER_META` 被 `getProviderLabel` 用，`shortId` 被 `RuntimeCard` / `handleDeleteRuntime` 用。**这三个保留 page 本地定义**（task-01 不一定提取；若 task-01 已提取则改 import，按 task-01 实际边界决定，本任务不强制）。
3. **移除本地定义后清理 import**：
   - `InteractiveSessionPanel, type SessionTurnView`（约 28）—— 若 page 不再用 `InteractiveSessionPanel`（全在弹窗内）则移除；`SessionTurnView` 类型若仅被已移除的 `logsToTurns` 用也一并移除。
   - `AgentRunLogEntry`（约 32）—— 若仅被已移除的 `logsToTurns` / `SessionHistoryView` 用则移除。
   - `deleteAgentSession` / `getAgentSessionLogs` / `reopenSession`（约 34-45）—— 若仅被已移除的 `SessionListSection` 用则移除；`getAgentSession`（约 38）**保留**（URL 恢复用）。
   - `AgentSessionStatus`（约 47）—— 若仅被已移除的 `ACTIVE_SESSION_VIEW_STATUSES` 用则移除。
   - `MessageSquarePlus`（约 16）—— 若仅被已移除的 `SessionHistoryView` 用则从 lucide import 移除。
4. **验证**：改完后 `pnpm lint` + `tsc --noEmit` 应通过（NFR-4），无未用 import / 未定义符号。逐步骤删 import，每删一组跑一次 tsc 定位。

## 完成标准

- [ ] **页面无底部常驻会话区**：渲染输出不含 `SessionListSection` / `SessionsSidebar` / `SessionHistoryView`；无 `sessionSectionRef` / `scroll-mt-6` 包装；无 `max-h-[680px]`（或显著调高）。
- [ ] **点会话开弹窗**：runtime 卡片「会话」按钮 → `handleOpenSession` → `setDialogRuntime` → `<RuntimeSessionDialog open>` 弹出该 runtime 工作台；不再 `scrollIntoView`。
- [ ] **弹窗单例（D-001）**：A 弹窗开时点 B → 切换为 B（`dialogRuntime` 替换）。
- [ ] **URL 刷新恢复（FR-06 / D-003）**：
  - URL `?session=<活跃>` + 页面 mount → `getAgentSession` 查到活跃 → `setDialogRuntime(匹配 runtime)` → 弹窗 open → RuntimeSessionDialog D-002 默认态 attach 该活跃会话。
  - URL `?session=<ended/failed/不存在>` + mount → `clearSessionParam`，不开弹窗，降级 idle。
  - `urlRestoreDoneRef` 保证只执行一次。
- [ ] **关闭清 param（FR-05 / D-003 C-3）**：弹窗 `onClose`（`handleCloseDialog`）→ `setDialogRuntime(null)` + `clearSessionParam`；刷新不再自动弹出。
- [ ] **卡片更舒展（FR-03）**：`max-h-[680px]` 移除（或调高），grid `gap-4`。
- [ ] **15s 轮询保留**：runtime 列表自动刷新 + `sessionStatsByRuntime` 卡片会话数仍更新。
- [ ] **helper import 正确**：page 不再有本地 `InteractiveSessionChatSection` / `SessionsSidebar` / `SessionHistoryView` / `logsToTurns` 等定义；`isActiveSession` 从 helper import；无循环依赖（page 不 import dialog，dialog import helper，page import dialog + helper）。
- [ ] `pnpm lint` + `tsc --noEmit` 通过（NFR-4）；page 相关 vitest（task-05 重写 `page.test.tsx`）后续任务覆盖，本任务只保证 page 自身编译/类型通过。

## 注意事项

1. **URL 恢复编排从 SessionListSection 上移到 page**：这是本任务最易错点。原 `SessionListSection` 的恢复 effect（约 1148-1174）做的是 `setAttachSession(session)`（组件内部 state），上移到 page 后改成 `setDialogRuntime(匹配 runtime)`——page 不持有 attach state，attach 由弹窗（task-02）按 D-002 默认态接管。不要试图在 page 直接 attach。
2. **onClose 时序（D-003 C-3）**：`handleCloseDialog` 必须同时做 `setDialogRuntime(null)` + `clearSessionParam`。只清 state 不清 param → 刷新又会自动弹出（违背「主动关闭不恢复」语义）；只清 param 不清 state → 弹窗不关。两者顺序：先关弹窗（触发 RuntimeSessionDialog cleanup，FR-05 / R-02 SSE 泄漏防护），再清 param。
3. **URL 写入职责不在 page**：`writeSessionParam` 不要在 page 重建。新建/续聊成功写 param 仍由 `InteractiveSessionChatSection.onSessionCreated`（task-01 提取的 helper 内）负责。page 只负责「读 + 清」。若发现 helper 提取后 `onSessionCreated` 行为变化，那是 task-01 的边界，本任务不改。
4. **依赖 task-01 / task-02**：本任务编码前确认：
   - task-01 已创建 `runtime-session-helpers.tsx` 并 export `isActiveSession`（及 page 精简后仍需的符号）。
   - task-02 已创建 `runtime-session-dialog.tsx` 并 export `RuntimeSessionDialog`，props 签名 `{runtime: DaemonRuntimeRead | null; open: boolean; onClose: () => void; runtimes: DaemonRuntimeRead[]}`。
   - 若 task-01/02 未完成，本任务无法编译——按 plan 的 Wave 顺序，task-04 在 Wave-3，task-01/02 在 Wave-1/2 之前。
5. **`items ?? []` 传 runtimes**：弹窗 props `runtimes` 用于会话区选 provider；`items` 为 null（初始加载）时传 `[]`，但此时弹窗不会 open（无 RuntimeCard 可点），无副作用。
6. **不删 `sessions` state / `sessionStatsByRuntime`**：卡片展示会话数（`RuntimeCard` 的 `sessionStats`）仍需 `sessions` 聚合。`reload` 仍拉 `listAgentSessions({limit:100})`。不要误删。
7. **匹配 runtime 为 null 的边界**：URL 指向活跃会话但其 `runtime_id` 对应的 runtime 已不在 `items`（删除/未注册）→ `matched` 为 null → `clearSessionParam` 降级（弹窗不开，避免传 `runtime=null` 给 dialog 产生歧义）。R-03 兜底。
8. **不改后端 / API / 数据模型**（NFR-1）：本任务纯前端 page 重构，`lib/daemon.ts` 全部签名不变。
