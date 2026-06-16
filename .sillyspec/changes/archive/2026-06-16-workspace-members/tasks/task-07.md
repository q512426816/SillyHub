---
id: task-07
title: "frontend/src/components/workspace-member-add-dialog.tsx 添加成员对话框（debounce 300ms 搜索 + 候选下拉 + 角色下拉 + 错误条 + Add 禁用逻辑）"
priority: P0
estimated_hours: 2
depends_on: [task-06]
blocks: [task-09]
allowed_paths:
  - frontend/src/components/workspace-member-add-dialog.tsx
---

# Task-07 — 添加成员对话框组件

## 0. 依据文档

- `requirements.md` **FR-08**（添加成员对话框 GWT 4 块）
- `design.md` **§5.2** 前端组件段（第 124-130 行）：
  > **对话框组件**（`frontend/src/components/workspace-member-add-dialog.tsx` 新增）：
  > - 搜索 input（debounce 300ms 调 `searchUsersForInvite`）
  > - 候选下拉（点击选中）
  > - 角色下拉（viewer / developer / workspace_owner）
  > - 提交按钮（无选中时 disabled）
  > - 错误提示行（API 失败时）
- `design.md` §6 文件清单第 164 行：`新增 frontend/src/components/workspace-member-add-dialog.tsx`
- `design.md` §10 R-02：搜索响应字段最小化（user_id / email / display_name，无 phone 等）
- `task-06.md`：本任务的 API client（6 个函数 + 5 个 interface 已定义在 `frontend/src/lib/workspace-members.ts`，本任务**消费** `searchUsersForInvite` / `addMember` / `UserSearchHit` / `WorkspaceMemberRoleKey`）
- 参考既有 dialog：`frontend/src/components/api-key-create-dialog.tsx`（error 行模式：`<div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">{error}</div>`）+ `frontend/src/components/workspace-scan-dialog.tsx`（phase state machine 模式）

## 1. 修改文件

**新建** `frontend/src/components/workspace-member-add-dialog.tsx` —— 单文件客户端组件，导出 named function `WorkspaceMemberAddDialog`（**禁止** default export，与 `api-key-create-dialog.tsx:17` 一致）。

> **关于 dialog 容器**：本项目当前**未引入** shadcn `Dialog` / `Select` 组件（已 `ls frontend/src/components/ui/` 验证，仅 `input.tsx` / `badge.tsx` / `button.tsx`）。既有 dialog（`api-key-create-dialog.tsx:62-63` / `workspace-scan-dialog.tsx:92-93`）一律用**手写 `fixed inset-0` 蒙层 + 居中卡片**实现。本任务跟随该约定，**不**新增 `frontend/src/components/ui/dialog.tsx` 或 `select.tsx`，全部用 `<div>` + Tailwind 类 + 原生 `<select>` 实现。如未来项目引入完整 shadcn，本组件可统一改造。

## 2. 实现要求

### 2.1 文件头

```tsx
"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ApiError } from "@/lib/api";
import {
  addMember,
  searchUsersForInvite,
  type UserSearchHit,
  type WorkspaceMemberRoleKey,
} from "@/lib/workspace-members";
```

> **强制** `"use client"` —— 组件含 `useState` / `useEffect` / `useRef`，必须是 Client Component。
> **强制** import 来自 `@/lib/...`（不要相对路径 `../lib/...`），与 `api-key-create-dialog.tsx:5-8` 一致。
> **不引入** `use-debounce` 等第三方库 —— debounce 用 `useEffect + setTimeout + clearTimeout` 内联实现（项目无 `use-debounce` 包，已 `grep package.json` 验证）。

### 2.2 Props 与内部 state machine

```tsx
interface Props {
  workspaceId: string;     // 当前 workspace UUID；用于调 search / add 端点
  onAdded: () => void;     // Add 成功回调：父组件（Members 页面）触发刷新列表
  onClose: () => void;     // ESC / 外部点击 / Cancel 按钮时父组件 unmount 本组件
}

type Phase = "idle" | "searching" | "select" | "submitting" | "success" | "error";

const ROLE_OPTIONS: ReadonlyArray<{ value: WorkspaceMemberRoleKey; label: string }> = [
  { value: "developer", label: "Developer" },
  { value: "viewer", label: "Viewer" },
  { value: "workspace_owner", label: "Workspace Owner" },
];

export function WorkspaceMemberAddDialog({ workspaceId, onAdded, onClose }: Props) {
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<UserSearchHit[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserSearchHit | null>(null);
  const [role, setRole] = useState<WorkspaceMemberRoleKey>("developer"); // FR-08 默认 developer
  const [loading, setLoading] = useState(false);      // search 进行中
  const [submitting, setSubmitting] = useState(false); // Add 进行中
  const [error, setError] = useState<string | null>(null);

  // 竞态取消：每次新搜索开始时把上一笔请求"作废"
  const searchSeqRef = useRef(0);
  // 蒙层 ref：用于检测"点击外部"（pointer down 起点在蒙层而非卡片）
  const overlayRef = useRef<HTMLDivElement>(null);

  // … (effect 与 handler 见 §2.3 / §2.4)
}
```

**Phase 解释**（仅用于内部状态机逻辑，**不强求**显式 `phase` state——本任务用 `loading` / `submitting` / `error` / `selectedUser` 四个独立 state 表达足够；如选择不显式 Phase，需在代码注释里说明这 6 个 phase 与 state 的映射）：

| Phase | 等价 state 组合 |
|-------|----------------|
| idle | `loading=false, submitting=false, error=null, candidates=[], selectedUser=null, query=""` |
| searching | `loading=true` |
| select | `loading=false, selectedUser=null, candidates.length>0` |
| submitting | `submitting=true` |
| success | 短暂态（一瞬即触发 `onAdded` + `onClose`，UI 几乎看不到） |
| error | `error !== null` |

### 2.3 Debounce 300ms 搜索（核心）

```tsx
useEffect(() => {
  const q = query.trim();

  // 边界：长度 < 2 不发请求（与 backend Query(min_length=2) 一致；前端挡一层避免 422 噪音）
  if (q.length < 2) {
    setCandidates([]);
    setError(null);
    setLoading(false);
    return;
  }

  setLoading(true);
  setError(null);

  // 竞态 token：本笔请求分配一个递增 seq；返回时只在自己仍是最新 seq 时才 setState
  const mySeq = ++searchSeqRef.current;

  const timer = setTimeout(async () => {
    try {
      const hits = await searchUsersForInvite(workspaceId, q);
      // 仅当本笔仍是最新请求时才更新 state；否则丢弃（用户已继续输入）
      if (searchSeqRef.current === mySeq) {
        setCandidates(hits);
        setLoading(false);
      }
    } catch (err) {
      if (searchSeqRef.current === mySeq) {
        const msg =
          err instanceof ApiError
            ? `${err.code}: ${err.message}`
            : "搜索失败";
        setError(msg);
        setCandidates([]);
        setLoading(false);
      }
    }
  }, 300); // FR-08 明确 300ms

  return () => {
    clearTimeout(timer); // query 变化时清掉上一笔未触发的 timer
  };
}, [query, workspaceId]); // workspaceId 极少变，但加进 deps 保证切换 ws 时重新搜索
```

**Debounce 关键点**（review 时对照）：

1. `setTimeout` 必须在 effect 体内创建，**不**在 `onChange` 回调里创建（避免 React 18 StrictMode 双调用导致 timer 泄漏）
2. cleanup function `clearTimeout(timer)` 必须存在（用户连打字时取消未触发的请求）
3. `searchSeqRef.current` 递增 + 自检：**这是防竞态的核心**（用户先打 "a" 再打 "ab"，"a" 的请求晚返回时不能覆盖 "ab" 的结果）
4. **不**用 `AbortController` 取消 fetch（`apiFetch` 当前不支持传入 `signal`，已读 `api.ts:89-200` 验证）；改用"忽略返回"模式（即 seq 检查），等价于"逻辑取消"，HTTP 请求仍会完成但结果被丢弃
5. `q.length < 2` 直接清空 candidates 并 `return`，**不**触发 timer（避免无谓 300ms 等待）

### 2.4 提交 Add（含竞态与错误恢复）

```tsx
const handleSubmit = async () => {
  if (!selectedUser) return;       // Add 按钮已 disabled，双保险
  if (submitting) return;          // 防止双击

  setSubmitting(true);
  setError(null);

  try {
    await addMember(workspaceId, {
      user_id: selectedUser.user_id,
      role_key: role,
    });
    // FR-08 第 3 个 GWT：对话框关闭 + 列表刷新 + 新成员出现在表格中
    // 由父组件（task-09 Members 页面）的 onAdded 触发 refetch
    onAdded();
    onClose();
  } catch (err) {
    // FR-08 第 4 个 GWT：对话框保持打开，顶部显示红色错误条
    const msg =
      err instanceof ApiError
        ? `${err.code}: ${err.message}`
        : "添加失败";
    setError(msg);
    setSubmitting(false);
    // 注意：此处**不**调用 onClose，让用户看到错误后可重试或手动 Cancel
  }
};
```

### 2.5 ESC 键与外部点击关闭

```tsx
useEffect(() => {
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && !submitting) {
      onClose();
    }
  };
  window.addEventListener("keydown", onKey);
  return () => window.removeEventListener("keydown", onKey);
}, [onClose, submitting]);

const handleOverlayPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
  // 仅当 pointer down 起点在 overlay 本身（而非内部卡片）时才关闭
  // 用 pointerdown 而非 click：避免用户在 input 内拖选文本时误触关闭
  if (e.target === overlayRef.current && !submitting) {
    onClose();
  }
};
```

### 2.6 渲染 JSX（参考 api-key-create-dialog.tsx:62-110 模式）

```tsx
return (
  <div
    ref={overlayRef}
    onPointerDown={handleOverlayPointerDown}
    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
  >
    <div className="w-full max-w-lg rounded-lg border bg-background p-5 shadow-lg">
      <h2 className="text-base font-semibold">添加成员</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        搜索已注册的非成员用户（display name 或 email），选中后指定角色并添加。
      </p>

      <div className="mt-4 space-y-3">
        {/* 搜索 input + 候选下拉 */}
        <div>
          <label className="text-[11px] text-muted-foreground">搜索用户</label>
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              // 用户改 query 时清掉选中（避免候选列表变化后仍指向旧选中）
              setSelectedUser(null);
            }}
            placeholder="输入至少 2 个字符，如 ali / @example.com"
            className="mt-0.5"
            disabled={submitting}
            autoFocus
          />
          {loading && (
            <p className="mt-1 text-[11px] text-muted-foreground">搜索中…</p>
          )}
          {!loading && query.trim().length >= 2 && candidates.length === 0 && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              无匹配候选（已是成员或 status 非 active 的用户不展示）。
            </p>
          )}
          {candidates.length > 0 && (
            <ul className="mt-1 max-h-44 overflow-auto rounded border bg-card">
              {candidates.map((hit) => {
                const active = selectedUser?.user_id === hit.user_id;
                return (
                  <li key={hit.user_id}>
                    <button
                      type="button"
                      onClick={() => setSelectedUser(hit)}
                      disabled={submitting}
                      className={
                        "flex w-full items-center justify-between px-3 py-1.5 text-left text-xs hover:bg-muted/60 disabled:opacity-50 " +
                        (active ? "bg-primary/10 font-medium" : "")
                      }
                    >
                      <span>
                        {hit.display_name ?? "(no display name)"}{" "}
                        <span className="text-muted-foreground">&lt;{hit.email}&gt;</span>
                      </span>
                      {active && <span className="text-primary">已选</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 角色下拉（默认 developer） */}
        <div>
          <label className="text-[11px] text-muted-foreground">角色</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as WorkspaceMemberRoleKey)}
            disabled={submitting}
            className="mt-0.5 w-full rounded border bg-background px-2 py-1.5 text-sm"
          >
            {ROLE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-muted-foreground">
            workspace_owner 可管理成员；developer 可读写；viewer 只读。
          </p>
        </div>

        {/* 错误条（API 失败时） */}
        {error && (
          <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
            {error}
          </div>
        )}
      </div>

      {/* 底部按钮 */}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onClose} disabled={submitting}>
          取消
        </Button>
        <Button
          size="sm"
          onClick={handleSubmit}
          disabled={!selectedUser || loading || submitting}
        >
          {submitting ? "添加中…" : "添加"}
        </Button>
      </div>
    </div>
  </div>
);
```

**Add 按钮 disabled 逻辑**（`!selectedUser || loading || submitting`）：

- `!selectedUser`：FR-08 第 1 个 GWT "Add 在无候选选中时 disabled"
- `loading`：搜索进行中时禁用（避免用户在结果未稳定时点 Add）
- `submitting`：Add 已发出未返回时禁用（防双击重复提交）

## 3. 接口定义

### 3.1 对外 Props

```ts
interface Props {
  workspaceId: string;       // 必传，UUID
  onAdded: () => void;       // Add 成功回调（无参；父组件按自己需要 refetch）
  onClose: () => void;       // 关闭回调（ESC / 外部点击 / Cancel / 成功后均触发）
}
```

**调用方**（task-09 Members 页面）使用模式：

```tsx
const [showAddDialog, setShowAddDialog] = useState(false);

// 渲染列表头部按钮：
<Button onClick={() => setShowAddDialog(true)}>+ Add Member</Button>

// 渲染对话框（条件渲染保证 unmount 时清 state）：
{showAddDialog && (
  <WorkspaceMemberAddDialog
    workspaceId={workspaceId}
    onAdded={() => refreshMembers()}  // refetch GET /members
    onClose={() => setShowAddDialog(false)}
  />
)}
```

### 3.2 内部 state（不外泄）

| State | 类型 | 初值 | 用途 |
|-------|------|------|------|
| `query` | `string` | `""` | 搜索 input 文本（含空格原样保留） |
| `candidates` | `UserSearchHit[]` | `[]` | debounce 后从 backend 返回的候选列表 |
| `selectedUser` | `UserSearchHit \| null` | `null` | 用户点击选中的候选；Add 时取其 `user_id` |
| `role` | `WorkspaceMemberRoleKey` | `"developer"` | 角色下拉当前值（FR-08 默认 developer） |
| `loading` | `boolean` | `false` | 搜索请求进行中（影响候选区提示文案 + Add disabled） |
| `submitting` | `boolean` | `false` | Add 请求进行中（影响全部 input/select disabled + Add 文案"添加中…"） |
| `error` | `string \| null` | `null` | 搜索或 Add 失败时的错误文本（同时用于 search / add 两类错误，由 setLoading 区分上下文） |

### 3.3 内部 state machine（隐性 6 phase）

| Phase | state 组合 | 用户视角 |
|-------|-----------|----------|
| `idle` | `query="" / loading=false / candidates=[] / selectedUser=null / error=null` | 刚打开对话框，未输入 |
| `searching` | `loading=true` | 显示"搜索中…"提示 |
| `select` | `loading=false / candidates.length>0 / selectedUser=null` | 候选列表已出，等用户选 |
| `submitting` | `submitting=true` | 显示"添加中…"，所有 input 禁用 |
| `success` | `submitting=true` → 立即 `onAdded()` + `onClose()` | 一瞬即逝，组件 unmount |
| `error` | `error !== null` | 红色错误条；input/select 不禁用（用户可改后重试） |

## 4. 边界处理

1. **`query` 长度 < 2**：debounce effect 内 `if (q.length < 2) { setCandidates([]); setLoading(false); return; }`，**不**发请求（避免 backend `Query(min_length=2)` 返 422 噪音）。
2. **空候选列表**：query ≥ 2 字符且非 loading 且 `candidates.length === 0` 时显示"无匹配候选（已是成员或 status 非 active 的用户不展示）"提示，**不**当作错误（合法场景）。
3. **网络 / API 错误（search 与 add 均可能）**：catch `ApiError` → 渲染红色错误条；**不**关闭对话框（FR-08 第 4 个 GWT）；用户可改输入重试或手动 Cancel。
4. **Add 成功后清空表单并关闭**：成功路径直接调 `onAdded()` + `onClose()`，父组件 unmount 本组件 → state 自然清空；**不**手动 `setQuery("")`（无意义，组件即将销毁）。
5. **ESC 键关闭**：`useEffect` 监听 `window.keydown`，按 ESC 且 `!submitting` 时调 `onClose()`；**submitting 时禁用 ESC**（避免请求中关闭导致父组件 unmount 但 fetch 仍在飞——虽有 seq ref 保护但 UI 上不该让用户在 loading 时关）。
6. **外部点击关闭**：`onPointerDown` 在 overlay 上检测 `e.target === overlayRef.current`（即点击点在卡片之外）；用 pointerdown 而非 click 是为了避免用户在 input 内拖选文本松手时误触发关闭；`submitting` 时同样禁用。
7. **并发请求竞态**：`searchSeqRef.current` 递增 token，每次 effect 触发新 search 时 `++`，结果返回时 `if (searchSeqRef.current === mySeq)` 才 setState，否则丢弃（用户已打新字符，旧结果无意义）。
8. **Add 双击 / 重复提交**：`submitting` state + `if (submitting) return;` 双保险；Add 按钮 disabled 也屏蔽大部分场景。
9. **`workspaceId` 切换**（罕见，父组件不会在同一 dialog 实例里换 ws）：effect deps 含 `workspaceId`，切 ws 时会重新触发搜索（query 不变也走一次）——预期行为，不需特殊处理。
10. **`autoFocus` 在 input 上**：对话框打开时光标直接落搜索框，省一次点击；SSR 不会触发 focus（仅客户端）——安全。
11. **用户清空 query**：`onChange` 改 query 时清掉 `selectedUser`，避免候选列表更新后 `selectedUser` 仍指向已被过滤掉的旧 hit。
12. **`role` 切换不重置选中**：用户改角色下拉时**保留** selectedUser（典型流程：先选人再选角色）。

## 5. 非目标

- **不做**自定义角色输入（仅 3 个 literal：developer / viewer / workspace_owner；不暴露 reviewer / qa / component_lead / platform_admin —— 后两者由后端拒绝）
- **不做**邀请链接 / 邮件邀请（design §3 明确；本组件只搜已注册用户）
- **不做**批量添加（一次仅一个 user —— 后端 POST body 是单个 user_id）
- **不做**debounce 抽公共 hook（`use-debounce.ts`）—— 本组件是当前唯一需要 debounce 的地方，YAGNI；如未来 `daemon-runtime-search.tsx` 之类组件也需要再抽
- **不做**键盘导航候选（上下箭头选 / Enter 确认）—— 鼠标点击已足够；键盘导航需引入 `roving tabindex` 复杂度，超出范围
- **不做**候选区分页 / 滚动加载 —— backend 默认 `limit=10`，候选列表用 `max-h-44 overflow-auto` 即可
- **不做**loading skeleton / shimmer 动画 —— 一行"搜索中…"文本足够
- **不做**i18n —— 文案直接写中文（与既有 `api-key-create-dialog.tsx` / `workspace-scan-dialog.tsx` 一致）
- **不做**vitest 单测（design §3：前端依赖手动 e2e 验收；后端单测已覆盖核心业务逻辑）
- **不引入** shadcn `Dialog` / `Select` 组件（项目尚未 add；本组件用手写蒙层 + 原生 `<select>`）

## 6. 参考

| 文件 | 借鉴点 |
|------|--------|
| `frontend/src/components/api-key-create-dialog.tsx:1-159` | `"use client"` 头；`useState` 受控组件；error 行样式 `rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive`；蒙层结构 `fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4`；按钮 disabled 逻辑 `disabled={issuing \|\| !name.trim()}` |
| `frontend/src/components/workspace-scan-dialog.tsx:18-31` | Phase state machine 模式（`type Phase = "idle" \| "scanning" \| ...`） |
| `frontend/src/lib/workspace-members.ts`（task-06 产出） | import `searchUsersForInvite` / `addMember` / `UserSearchHit` / `WorkspaceMemberRoleKey` |
| `frontend/src/lib/api.ts:60-74` | `ApiError` 类（含 `code` / `status` / `message`），错误渲染 `${err.code}: ${err.message}` 格式 |
| `frontend/src/components/ui/input.tsx` | `<Input>` 组件 props（value / onChange / disabled / className / placeholder） |
| `frontend/src/components/ui/button.tsx` | `<Button variant="outline" size="sm">` 与 `<Button size="sm">` 用法 |

**关于 debounce 内联 vs 抽公共 hook**：

- 项目当前**无** `frontend/src/lib/use-debounce.ts`（已 `Glob frontend/src/lib/use-debounce*` 验证：No files found）
- 本任务**不**新建 `use-debounce.ts`，理由：
  1. 当前唯一需要 debounce 的组件，YAGNI
  2. 抽 hook 需要约定泛型（`useDebouncedValue<T>`）+ 单测，超出本任务 2h 估时
  3. 内联 `useEffect + setTimeout + clearTimeout + ref` 是 React 官方 debounce 范式，代码清晰可读
- 如未来 task-09 Members 页面的搜索框 / `daemon-runtime-search` 也需要 debounce，届时再抽 `lib/use-debounce.ts`，本组件统一迁移

## 7. TDD 步骤

本任务**不写 vitest 单测**（design §3 明确前端依赖手动 e2e 验收）。

### 7.1 静态检查（必跑）

```bash
# 1. TypeScript 编译
cd frontend && pnpm tsc --noEmit
# 期望：exit 0；无 TS2322 / TS2345 / TS2554

# 2. ESLint
cd frontend && pnpm lint -- src/components/workspace-member-add-dialog.tsx
# 期望：无 error；warning ≤ 0（react-hooks/exhaustive-deps 可能提示把 searchSeqRef 加进 deps，可加 // eslint-disable-next-line 抑制——ref 不需要进 deps）

# 3. Next.js build
cd frontend && pnpm next build
# 期望：build 成功；chunk 列表含 workspace-member-add-dialog
```

### 7.2 手动 e2e（FR-08 4 个 GWT 全覆盖）

**前置**：

- backend 已启动（`cd backend && uv run uvicorn app.main:app --port 8000`）
- frontend dev server（`cd frontend && pnpm dev`）
- 数据库至少有 2 个 active 用户：当前 owner（A）+ 另一个非成员（B，例如 `bob@example.com`）
- 已登录为 workspace_owner，进入 `/workspaces/{id}/members`（task-09 已实现 Members 页）

**测试用例**：

| 编号 | 步骤 | 期望 |
|------|------|------|
| TC-1 | 点击 "+ Add Member" 按钮 | 对话框弹出；搜索框 autoFocus；角色下拉默认 "Developer"；Add 按钮 disabled |
| TC-2 | 在搜索框输入 "a"（1 字符） | 不发请求；候选区空；不显示"搜索中…" |
| TC-3 | 继续输入到 "ab"（2 字符） | 300ms 后显示"搜索中…" → 然后显示候选列表（含 B）；A 不在列表（已是成员被排除） |
| TC-4 | 快速连续输入 "ab" → "abc" → "abcd" | 仅最后一次请求结果生效；中间请求结果被丢弃（通过 Network panel 验证：3 个请求都发出，但只有最后一个 setState 生效；用 console.log 在 `setCandidates` 前打 seq 验证） |
| TC-5 | 点击候选 B | B 行高亮（`bg-primary/10`）；右侧出现"已选"；Add 按钮变为 enabled |
| TC-6 | 改角色下拉为 "Viewer" | 下拉值更新；选中状态保留 |
| TC-7 | 点 Add | 按钮显示"添加中…"；所有 input/select disabled；约 200ms 后对话框关闭；Members 表格刷新出现 B（角色 viewer） |
| TC-8 | 再次打开对话框，搜索 B | 候选列表**不含** B（已是成员被排除） |
| TC-9 | 模拟失败：临时停掉 backend，打开对话框，输入 "ab" | 候选区显示"搜索失败"红色错误条；对话框不关；可改输入重试 |
| TC-10 | 提交时模拟失败：恢复 backend，选中某用户，断网后点 Add | 错误条显示 `network_error: ...`；对话框保持打开；恢复网络后可重试 |
| TC-11 | ESC 键 | 对话框关闭（submitting=false 时） |
| TC-12 | 点击对话框外部灰色蒙层 | 对话框关闭（同上） |
| TC-13 | submitting 时按 ESC / 点外部 | **不**关闭（保护请求中状态） |

### 7.3 竞态验证（深度）

打开 DevTools → Network → 节流到 "Slow 3G"，在搜索框快速打 "abcdef"：

- Network 应显示 5 个 `/members/search?q=a...` 请求
- 候选区最终只显示 `q=abcdef` 的结果，**不**出现中间的 `q=abc` 残留结果
- Console 无 React state-update-on-unmounted warning

## 8. 验收标准

| 编号 | 检查项 | 通过条件 |
|------|--------|----------|
| AC-1 | 文件存在且为 named export | `frontend/src/components/workspace-member-add-dialog.tsx` 存在；`grep "^export function" frontend/src/components/workspace-member-add-dialog.tsx` 输出恰好 1 行（`WorkspaceMemberAddDialog`）；`grep "^export default" frontend/src/components/workspace-member-add-dialog.tsx` 输出 0 行 |
| AC-2 | `"use client"` 顶部声明 | 文件第 1 行（或第 1 行注释后）为 `"use client";`；`grep '"use client"' frontend/src/components/workspace-member-add-dialog.tsx` 输出 1 行 |
| AC-3 | debounce 300ms 内联实现 | `grep "setTimeout" frontend/src/components/workspace-member-add-dialog.tsx` 输出 ≥1 行（300ms timer）；`grep "clearTimeout" frontend/src/components/workspace-member-add-dialog.tsx` 输出 ≥1 行；**不**引入 `use-debounce` 包（`grep "use-debounce" frontend/package.json` 输出 0 行） |
| AC-4 | 竞态 ref 保护 | `grep "searchSeqRef\|useRef" frontend/src/components/workspace-member-add-dialog.tsx` 输出 ≥2 行；`grep "++searchSeqRef\|=== mySeq\|searchSeqRef.current" frontend/src/components/workspace-member-add-dialog.tsx` 输出 ≥3 行 |
| AC-5 | Add 按钮 disabled 三态 | JSX 中 `disabled={!selectedUser \|\| loading \|\| submitting}` 完整出现 |
| AC-6 | 输入 < 2 字符不发请求 | effect 内含 `if (q.length < 2) { setCandidates([]); setLoading(false); return; }` 或等价逻辑；`grep "length < 2\|trim().length" frontend/src/components/workspace-member-add-dialog.tsx` 输出 ≥1 行 |
| AC-7 | 候选区只显示 active 非成员用户 | 由 backend 保证（task-04 端点 + task-02 service 已实现 LEFT JOIN 排除成员 + WHERE status='active'）；前端只渲染 `candidates` 数组——AC 通过的条件是 `candidates` 来源仅为 `searchUsersForInvite` 返回值，**不**做客户端二次过滤 |
| AC-8 | 错误时 dialog 不关 | `handleSubmit` catch 块内**不**调用 `onClose`；`grep -A 15 "catch (err)" frontend/src/components/workspace-member-add-dialog.tsx` 显示 catch 内有 `setError` 但无 `onClose` |
| AC-9 | Add 成功后触发 onAdded | `handleSubmit` try 块尾部含 `onAdded(); onClose();`（顺序：先 onAdded 让父 refetch，再 onClose unmount） |
| AC-10 | 错误条样式与 api-key-create-dialog 一致 | JSX 中含 `className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive"` 错误条 |
| AC-11 | TypeScript 编译通过 | `cd frontend && pnpm tsc --noEmit` exit 0 |
| AC-12 | ESLint 通过 | `cd frontend && pnpm lint -- src/components/workspace-member-add-dialog.tsx` exit 0（warning 允许 ≤ 0） |
| AC-13 | 角色下拉含 3 个选项 | `grep -E '"developer"|"viewer"|"workspace_owner"' frontend/src/components/workspace-member-add-dialog.tsx` 在 ROLE_OPTIONS 区域输出恰好 3 个值；**不**含 `platform_admin` / `reviewer` / `qa` / `component_lead` |
| AC-14 | 默认 role = developer | `useState<WorkspaceMemberRoleKey>("developer")` 在文件中存在 |
| AC-15 | ESC + 外部点击关闭 | `grep "Escape\|onPointerDown\|overlayRef" frontend/src/components/workspace-member-add-dialog.tsx` 输出 ≥3 行；submitting 时禁用关闭（`if (... && !submitting)`） |

## 9. 风险与回滚

| 编号 | 风险 | 等级 | 应对 |
|------|------|------|------|
| R-1 | React 18 StrictMode 双调用导致 effect 跑两次，debounce timer 创建两次 | P2 | cleanup function `clearTimeout(timer)` 保证每次 effect 重跑时清掉旧 timer；StrictMode 仅 dev 触发，prod 无影响 |
| R-2 | `searchSeqRef` 在 StrictMode 下被 `++` 两次 → 第一次的 seq 永远不等于 latest → 第一次请求结果被丢弃（**预期行为**，非 bug） | P3 | 不需修复；StrictMode 下"丢弃第一次"恰恰符合 debounce 语义 |
| R-3 | 原生 `<select>` 在不同 OS 上样式不一致（Windows 黑色下拉箭头 / macOS 灰色） | P3 | 接受；未来引入 shadcn Select 时统一改造；当前优先功能正确性 |
| R-4 | `autoFocus` 在某些浏览器（Safari）首次打开对话框时不生效 | P3 | 可接受；用户手动点一下即可；如必须修复，加 `useEffect(() => { inputRef.current?.focus(); }, [])` |
| R-5 | 用户在搜索结果出现前就按 Enter（无 form 包裹） → 触发浏览器默认行为 | P3 | 本组件**不**用 `<form onSubmit>`，Add 只通过按钮 onClick 触发；Enter 不触发 Add（与 api-key-create-dialog 一致） |
| R-6 | `apiFetch` 内部 401 时跳转 `/login` 会让对话框"消失"（整页跳转） | P3 | 这是 `apiFetch` 设计行为（auth.ts 已统一处理），对话框组件无需关心；用户重新登录后重新打开对话框即可 |
| R-7 | 用户改 `query` 时清掉 `selectedUser`，但 UI 选中态消失可能让用户疑惑"为什么我选的人没了" | P3 | 用 `placeholder` "已选"指示当前选择；候选行高亮告知当前点击会切到哪个；可接受 |
| R-8 | backend search 端点未实现（task-04 未完成）时调 search 返 404 → 错误条显示 `..._not_found` 让用户以为"用户不存在" | P2 | 错误条文本透传 backend code，用户看到 `workspace_not_found` 等可知是后端问题；本任务**不**额外包装错误码到中文映射（design §3 YAGNI） |

**回滚**：

```bash
git rm frontend/src/components/workspace-member-add-dialog.tsx
```

完全恢复（无类型扩散：本组件的所有类型都来自 `@/lib/workspace-members`，task-06 文件保留不影响回滚；调用方 task-09 的 import 会因文件不存在而编译失败，但 task-09 在 `blocks` 列表，本任务回滚时 task-09 必然未实现或一并回滚）。

## 10. 依赖与下游

- **本任务依赖**：
  - **task-06**（API client）：import `searchUsersForInvite` / `addMember` / `UserSearchHit` / `WorkspaceMemberRoleKey` —— **硬依赖**，task-06 必须先完成
  - 既有组件：`@/components/ui/button`、`@/components/ui/input`、`@/lib/api`（ApiError）—— 已存在
  - **不依赖** backend 运行时（编译期 + 静态检查可独立完成；手动 e2e 需 backend）
- **本任务阻塞**：
  - **task-09**（Members 页面 `members/page.tsx`）：import 本组件 `<WorkspaceMemberAddDialog>` + 触发 "+ Add Member" 按钮 + 条件渲染
