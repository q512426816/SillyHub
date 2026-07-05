---
id: task-02
title: 新建 RuntimeSessionDialog 组件（Wave-2）
priority: P1
estimated_hours: 3
depends_on: [task-01]
blocks: [task-03, task-04]
requirement_ids: [FR-01, FR-03]
decision_ids: [D-001@v1, D-002@v1]
created_at: 2026-06-23T10:29:26+08:00
author: qinyi
allowed_paths:
  - frontend/src/components/daemon/runtime-session-dialog.tsx
---

# task-02：新建 RuntimeSessionDialog 组件（Wave-2）

> 覆盖：FR-01（会话弹窗化）、FR-03（页面精简的弹窗承载层）；决策 D-001@v1（弹窗单例）、D-002@v1（默认态）。
> 依据文档：`design.md` §5 Phase-1、§7 接口定义、§7.5 契约表；`requirements.md` FR-01；`decisions.md` D-001/D-002。
> 参考代码：`frontend/src/components/ui/dialog.tsx`（shadcn/Radix Dialog）、`frontend/src/app/(dashboard)/runtimes/page.tsx` SessionListSection（1080–1311 行，状态管理参考）、`frontend/src/lib/daemon.ts`（会话 API）。

## 修改文件

| 操作 | 路径 | 说明 |
|---|---|---|
| 新增 | `frontend/src/components/daemon/runtime-session-dialog.tsx` | runtime 专属会话工作台弹窗组件，自管会话列表 + 三态渲染 |

仅新增 1 个文件，不动 `page.tsx`（page 接入属 task-04）、不动 helper 文件（task-01 产出）、不动 `lib/daemon.ts`（契约不变，§7.5）。

## 覆盖来源

- **FR-01 / FR-03**：`design.md` §5 Phase-1（弹窗组件自管 `sessions/selected/logs/attachSession/loading/error/deletingSessionId`，`grid [240px 1fr]` 左列表右会话区）；§7 props 定义。
- **D-001@v1 弹窗单例**：`decisions.md` D-001——单例由 `page.tsx` 的单一 `dialogRuntime` state 驱动，本组件接收 `runtime`（null=关闭）；切换 runtime 时 `key={runtime.id}` 强制重 mount 重置内部状态（design.md §10 R-04 应对）。
- **D-002@v1 默认态**：`decisions.md` D-002——open 后有活跃会话（`isActiveSession`：active/pending/reconnecting）→ attach 最近活跃；无 → idle 新建空白面板。
- **§7.5 契约表**：本组件复用 `listAgentSessions` / `getAgentSession` / `getAgentSessionLogs` / `deleteAgentSession` / `reopenSession`，不改任何后端契约。

## 实现要求

### 步骤 1：props 定义与导入

按 `design.md` §7 定义 props（严格匹配，不增不减）：

```ts
interface RuntimeSessionDialogProps {
  runtime: DaemonRuntimeRead | null; // null = 关闭（Dialog open 由外层控制，runtime 仅用于渲染内容/key）
  open: boolean;
  onClose: () => void;
  runtimes: DaemonRuntimeRead[]; // 全部 runtime，供会话区 InteractiveSessionChatSection 选 provider
}
```

导入（均来自既有文件，NFR-2 不新增依赖）：
- `Dialog`, `DialogContent` from `@/components/ui/dialog`（**不导入 DialogHeader/Footer/Title/Description**——内部自管 header，见步骤 3）
- `DaemonRuntimeRead`, `AgentSessionRead`, `AgentRunLogEntry`, `ApiError` 类型 + `listAgentSessions` / `getAgentSession` / `getAgentSessionLogs` / `deleteAgentSession` / `reopenSession` from `@/lib/daemon`
- 复用 task-01 提取的命名导出：`SessionsSidebar`, `SessionHistoryView`, `InteractiveSessionChatSection`, `logsToTurns`, `canResumeSession`, `isActiveSession`, `resumeDisabledTitle`, `ACTIVE_SESSION_VIEW_STATUSES`, `getProviderLabel`, `shortId` from `@/components/daemon/runtime-session-helpers`
- `Button` from `@/components/ui/button`（header 关闭/刷新按钮，参考 page.tsx 用法）
- React hooks：`useState/useEffect/useCallback/useMemo/useRef`

> 依赖 task-01：helper 文件未产出前本任务 import 会报错，故 `depends_on: [task-01]`。task-01 必须把 `getProviderLabel`/`shortId` 也下沉到 helpers（page.tsx 1080–1311 的 `SessionListSection` 内 header 用到 `focusRuntime.name ?? getProviderLabel(...)`，本组件 header 同样需要）。

### 步骤 2：状态管理（对齐 page.tsx SessionListSection）

组件内自管以下 state（与 `page.tsx:1090-1099` 同构，但去掉 URL 恢复相关——URL 恢复属 task-04 / D-003，不在本组件职责内）：

```ts
const [sessions, setSessions] = useState<AgentSessionRead[]>([]);
const [loading, setLoading] = useState(true);
const [listError, setListError] = useState<string | null>(null);
const [selected, setSelected] = useState<AgentSessionRead | null>(null);
const [logs, setLogs] = useState<AgentRunLogEntry[]>([]);
const [logsLoading, setLogsLoading] = useState(false);
const [logsError, setLogsError] = useState<string | null>(null);
const [deletingSessionId, setDeletingSessionId] = useState<string | null>(null);
const [attachSession, setAttachSession] = useState<AgentSessionRead | null>(null);
```

- **不引入** `useRouter` / `useSearchParams` / `writeSessionParam` / `clearSessionParam` / `urlRestoreDoneRef`——URL 恢复逻辑在 `page.tsx` 层（task-04），本组件只通过 `onClose` 上报关闭事件（task-04 决定是否清 param）。
- `visibleSessions`：`sessions.filter(s => s.runtime_id === runtime?.id)`，用 `useMemo` 依赖 `[sessions, runtime?.id]`（对齐 page.tsx:1106-1109 的 `focusRuntime` 过滤）。

### 步骤 3：DialogContent 尺寸约束（关键，design.md §5 C-1）

shadcn `DialogContent`（`dialog.tsx:43`）默认 `max-w-lg w-full grid gap-4 p-6` + 自带 `<DialogPrimitive.Close>` 右上角 X。与「header + 左 240px 栏 + 右会话区」布局冲突（max-w-lg=512px 装不下；p-6 内边距 + grid gap-4 会套一层多余栅格）。处理：

- `DialogContent` **仅作定位壳**，通过 `className` override：
  ```
  className="max-w-[900px] w-[90vw] h-[80vh] max-h-[88vh] p-0 overflow-hidden"
  ```
  - `max-w-[900px] w-[90vw]`：宽度自适应（原 `max-w-lg w-full` 被覆盖）
  - `h-[80vh] max-h-[88vh]`：高度固定，内部列表/会话区各自滚动
  - `p-0`：去掉默认 `p-6`，由内部自管 padding
  - `overflow-hidden`：圆角裁剪
  - 注意 `cn()` 合并时后写的 `max-w-*`/`w-*`/`p-*` 会覆盖默认值（tailwind-merge 行为），grid/gap 因内部不再用 DialogHeader 默认结构而失效，无影响
- **不复用** `DialogHeader` / `DialogFooter` 默认结构，内部自管 `<header>`（含标题 + 关闭按钮，见步骤 4）
- DialogContent 自带的右上角 `<DialogPrimitive.Close>` X 保留（视觉上 header 自带关闭按钮与之重复时，header 用 `onClose` 调 props.onClose 统一关闭，避免双按钮；若重复则 header 不再额外渲染 X，直接依赖 DialogContent 自带的——本步骤二选一，优先保留 DialogContent 自带 X，header 仅放标题）

### 步骤 4：内部布局（自管 header + grid）

```tsx
<Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
  <DialogContent className="max-w-[900px] w-[90vw] h-[80vh] max-h-[88vh] p-0 overflow-hidden flex flex-col">
    <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-200">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold truncate">
          会话 · {runtime?.name ?? getProviderLabel(runtime?.provider)}
        </h2>
        <p className="text-[11px] text-muted-foreground">
          历史仅显示该运行时的会话，新建会话使用此提供方
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={() => void reloadSessions()} disabled={loading} className="h-7 text-[11px]">
        刷新会话
      </Button>
    </header>
    <div className="grid grid-cols-[240px_1fr] min-h-0 flex-1">
      <SessionsSidebar ... />
      {/* 三态渲染（步骤 6） */}
    </div>
  </DialogContent>
</Dialog>
```

- header 标题对齐 page.tsx:1238-1239 `会话 · ${focusRuntime.name ?? getProviderLabel(...)}`，副标题用聚焦态文案（page.tsx:1243）。
- 外层 `flex flex-col` + 内层 `min-h-0 flex-1` 让左右两栏在固定高度内各自滚动（DialogContent 已 `overflow-hidden`，列表/会话区内部 overflow-y-auto）。
- `grid grid-cols-[240px_1fr]` 对齐 design.md §5 Phase-1（左 240px 栏 + 右 1fr），区别于 page.tsx 的 `lg:grid-cols-[260px_minmax(0,1fr)]`（弹窗宽度固定，无需 lg 断点，左栏收窄到 240）。

### 步骤 5：数据加载 + 默认态（D-002）

- `open` 由 `true` → `false` 关闭时不主动清状态（key 重 mount 会清，见步骤 7）。
- `open === true` 且 `runtime` 非空时触发加载（`useEffect` 依赖 `[open, runtime?.id]`）：
  ```ts
  useEffect(() => {
    if (!open || !runtime) return;
    void reloadSessions();
  }, [open, runtime?.id]);
  ```
- `reloadSessions`：`listAgentSessions({ limit: 50 })` → `setSessions(resp.items)`（对齐 page.tsx:1111-1123）。
- **默认态（D-002）**：sessions 加载完成后（`loading` 由 true→false 的 effect），判断 `visibleSessions`：
  ```ts
  const defaultAttachedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!open || loading || defaultAttachedRef.current) return;
    defaultAttachedRef.current = runtime?.id ?? "x";
    const active = visibleSessions.find(isActiveSession);
    if (active) setAttachSession(active); // 有活跃 → attach 最近活跃（列表顺序由后端返回，取第一个活跃）
    // 无活跃 → 不 setAttachSession，右区自然进入 idle 三态分支
  }, [open, loading, visibleSessions]);
  ```
  - 用 `defaultAttachedRef` 防御重复触发（参考 page.tsx:1104 `urlRestoreDoneRef` 模式）。
  - 「最近活跃」兜底：后端 `listAgentSessions` 排序不保证，取 `visibleSessions.find(isActiveSession)` 第一个；若多个活跃需更精确排序，留 plan/verify 细化（design.md §12 自审 C-5）。

### 步骤 6：三态渲染（对齐 page.tsx:1280-1307，但去掉 focusProvider fallback 改用 runtime.provider）

右会话区按优先级渲染：

```tsx
{attachSession ? (
  <InteractiveSessionChatSection
    runtimes={runtimes}
    attachSession={attachSession}
    initialTurns={logsToTurns(logs)}
    onCloseAttach={() => setAttachSession(null)}
  />
) : selected ? (
  <SessionHistoryView
    session={selected}
    logs={logs}
    loading={logsLoading}
    error={logsError}
    onClose={() => setSelected(null)}
    onContinue={(s) => void handleContinue(s)}
  />
) : (
  <InteractiveSessionChatSection
    runtimes={runtimes}
    focusProvider={runtime?.provider ?? undefined}
  />
)}
```

- `attachSession` 优先：attach 续聊面板（D-002 默认 attach 或 task-03 active attach 触发）。
- `selected` 次之：只读历史回看（ended/failed 会话点开走这里）。
- idle 兜底：新建空白面板，`focusProvider={runtime?.provider}` 锁定该 runtime 的 provider（对齐 page.tsx:1302-1306 idle 分支，但 page 用 `focusRuntime?.provider`，这里直接用 props.runtime）。
- **本任务范围**：active 会话点开走只读 `SessionHistoryView`（沿用 page.tsx:1176-1194 `handleSelect` 逻辑：拉 `getAgentSessionLogs` → `setLogs` → `setSelected`）。**active 走 attach 续聊属 task-03（FR-02 / D-004）**，本任务的 `handleSelect` 暂保持统一只读，task-03 再改 `handleSelect` 分支。
- `handleDelete` / `handleContinue`（reopen）复用 page.tsx:1196-1232 逻辑（`deleteAgentSession` / `reopenSession` + 删除后从 sessions 过滤 + reopen 成功 setAttachSession）。**注意**：page.tsx 的 `handleContinue` 内有 `writeSessionParam`，本组件**不写 URL**（URL 职责在 task-04），故 `handleContinue` 仅 `reopenSession` + `setAttachSession(session)`，不调 `writeSessionParam`。

### 步骤 7：runtime key 重置（D-001 单例切换）

组件根 `Dialog` 由外层 `page.tsx` 渲染时，外层通过 `key={dialogRuntime?.id}` 强制重 mount（D-001 / R-04，task-04 落地）。本组件内部额外用 `defaultAttachedRef` 在 `runtime?.id` 变化时重置（防御）：

```ts
useEffect(() => {
  // runtime 切换（理论上 key 重 mount 已清，这里防御性重置 ref）
  defaultAttachedRef.current = null;
  setSessions([]); setSelected(null); setLogs([]); setAttachSession(null);
  setListError(null); setLogsError(null);
}, [runtime?.id]);
```

> 实际上 key 重 mount 会重建整个组件 state，此 effect 主要服务于「runtime 在弹窗打开期间被外层替换但未重 mount」的边界（task-04 若忘记加 key）。优先保证 task-04 加 `key={dialogRuntime?.id}`，本 effect 作为兜底。

### 步骤 8：关闭清理（FR-05 前置，SSE/轮询泄漏 R-02）

- `onClose`（props）：外层调 `setDialogRuntime(null)` + `setOpen(false)`。
- 本组件 DialogContent 内 attach 的 `InteractiveSessionChatSection`（内含 `InteractiveSessionPanel`）unmount 时其自身 cleanup effect 负责 `closeStream` + `clearInterval`（R-02 应对，复用既有 cleanup，本组件不重复实现）。
- 本组件**不**调 `clearSessionParam`（URL 清除属 task-04 / D-003 onClose 时序）。

## 完成标准

- [ ] `frontend/src/components/daemon/runtime-session-dialog.tsx` 存在，导出 `RuntimeSessionDialog`（命名导出或默认均可，建议命名导出与项目约定一致）。
- [ ] props 签名严格匹配 §7（`runtime / open / onClose / runtimes` 四个，无多余）。
- [ ] DialogContent className override 为 `max-w-[900px] w-[90vw] h-[80vh] max-h-[88vh] p-0 overflow-hidden`，内部自管 header + `grid grid-cols-[240px_1fr]`，未用 DialogHeader/Footer。
- [ ] `open=true && runtime` 时 `listAgentSessions({limit:50})` 加载并按 `runtime_id` 过滤。
- [ ] 默认态 D-002：有活跃会话→attach 第一个活跃；无→idle 空白面板（`focusProvider=runtime.provider`）。
- [ ] 三态渲染（attachSession / selected / idle）正确分支。
- [ ] SC-1 前置：弹窗能打开，左侧列出该 runtime 历史会话，右侧默认态符合 D-002。
- [ ] `pnpm tsc --noEmit`（frontend）通过，无类型错误（helper 已由 task-01 提取，import 可解析）。
- [ ] 本任务不含 task-03（active attach 续聊）/ task-04（page 接入 + URL 恢复）/ 测试（task-05/06），范围严格收敛。

## 注意事项

1. **DialogContent 默认样式冲突（C-1）**：默认 `max-w-lg w-full grid gap-4 p-6` + 自带 Close X。必须 className override 掉 `max-w-lg`/`p-6`，且不复用 DialogHeader（其默认 `text-center sm:text-left` + `space-y-1.5` 与自管 header 冲突）。DialogContent 自带的右上角 X 保留即可（header 不再重复渲染关闭按钮），关闭走 `onOpenChange(false)` → `onClose`。
2. **单例切换 key（D-001 / R-04）**：本组件靠外层 `key={runtime.id}` 重 mount 保证状态重置；内部 `runtime?.id` effect 仅作兜底。task-04 接入 page.tsx 时务必加 key，否则会串状态。
3. **依赖 task-01 helper**：`SessionsSidebar` / `SessionHistoryView` / `InteractiveSessionChatSection` / `logsToTurns` / `canResumeSession` / `isActiveSession` / `resumeDisabledTitle` / `ACTIVE_SESSION_VIEW_STATUSES` / `getProviderLabel` / `shortId` 必须由 task-01 提取到 `runtime-session-helpers.tsx` 并命名导出，否则本任务 import 报错。`InteractiveSessionChatSection` 含 `InteractiveSessionPanel`（含 SSE/轮询），下沉到 helpers 文件是为了避免 `page.tsx ↔ runtime-session-dialog.tsx` 循环依赖（design.md §6 helper 提取说明 / NFR-5）。
4. **职责边界**：本任务只做「弹窗壳 + 列表加载 + 默认态 + 三态渲染骨架」。active attach 续聊（`handleSelect` 改造走 attach 而非只读）= task-03；page.tsx 接入（`dialogRuntime` state + 移除常驻会话区 + URL 恢复）= task-04；测试 = task-05/06。不要越界实现。
5. **URL 不在本组件职责**：本组件不 import `useRouter`/`useSearchParams`，不写/不清 `?session=`。`handleContinue`（reopen）成功后只 `setAttachSession`，不 `writeSessionParam`（task-04 决定 URL 写入时机）。
6. **listAgentSessions 排序兜底（C-5）**：后端返回顺序不保证「最近活跃在前」，`visibleSessions.find(isActiveSession)` 取第一个活跃可能非最新。若需精确「最近活跃」，可在本组件对 `visibleSessions` 按 `created_at`/`updated_at` 倒序排序后再 find（留 verify 阶段确认字段，design.md §12 自审 C-5 标记为 plan 细化）。
