---
author: qinyi
created_at: 2026-06-16T09:53:36
id: task-09
title: "frontend/src/app/(dashboard)/workspaces/[id]/members/page.tsx 成员表格（role dropdown + Set Owner + Remove + (you) 标识 + 权限禁用）"
priority: P0
estimated_hours: 2
depends_on: [task-06, task-07, task-08]
blocks: [task-10, task-11]
allowed_paths:
  - frontend/src/app/(dashboard)/workspaces/[id]/members/page.tsx
  - frontend/src/components/workspace-member-row.tsx
---

# Task-09 — Members 子页面表格 + 行级操作

## 0. 依据文档

- `requirements.md` **FR-07**（前端 Members tab GWT，第 116-128 行 4 块）
- `requirements.md` **FR-08 末段**（第 144-146 行 GWT：addMember 失败时对话框保持打开 + 红色错误条 → 与本任务的 `onAdded` / `onClose` 回调对接）
- `design.md` **§5.2 Members 页面表格**（第 138-153 行）：4 列定义（User / Role / Granted At / Actions）+ 操作流程（Set Owner / Remove / 改 dropdown / Add Member）
- `design.md` §6 文件清单第 166 行：`新增 frontend/src/app/(dashboard)/workspaces/[id]/members/page.tsx`
- `design.md` §10 **R-04**：自我降级后失去管理权 → UI 上"修改自己 role" disabled；transfer-ownership 时强制 confirm
- `design.md` §3 非目标：前端依赖手动 e2e 验收，**不**做 vitest 单测
- `task-06.md`：API client（`listMembers` / `updateMemberRole` / `removeMember` / `transferOwnership` + `WorkspaceMemberView` / `WorkspaceMemberRoleKey`）
- `task-07.md`：`<WorkspaceMemberAddDialog>` 组件（`onAdded` / `onClose` 回调签名）
- `task-08.md`：workspace 详情页 tab 化（本页面在 `/workspaces/{id}/members` 路径下，会被 `layout.tsx` 包裹 → 自动获得 tab 栏；本任务**不**重复渲染 tab）

## 1. 修改文件

| 操作 | 文件 | 说明 |
|------|------|------|
| 新建 | `frontend/src/app/(dashboard)/workspaces/[id]/members/page.tsx` | Members 子路由 page（默认导出 `MembersPage`）；client component；含表格 + Add 按钮 + 操作按钮 + 状态管理 |
| 新建 | `frontend/src/components/workspace-member-row.tsx` | 行级子组件 named export `WorkspaceMemberRow`；封装 4 列渲染 + role dropdown + Set Owner / Remove 按钮 + 权限禁用逻辑 |

**为何拆 2 个文件**：

1. `page.tsx` 负责数据获取（`listMembers`）+ 顶层布局（header / error / loading / 表格外壳）+ Add 对话框挂载点
2. `WorkspaceMemberRow` 负责**单行**渲染 + 行级操作（role dropdown onChange / Set Owner onClick / Remove onClick）+ 权限禁用判定
3. 行级操作有副作用（PATCH / DELETE / POST → 触发父组件 refresh）—— 拆组件后行内 state（如"操作进行中"）天然隔离，不会因行 A 的 loading 影响行 B
4. 与既有 `api-keys/page.tsx`（行内联在 page）对比：本项目更典型的是行内联，但本任务行操作复杂度更高（3 类操作 + 权限判定 + 当前用户标识），拆子组件可读性更好；参考 `frontend/src/components/api-key-create-dialog.tsx` 与 `api-keys/page.tsx` 的拆分模式

> **关于 `<select>` / `<Dropdown>` UI 组件**：本项目 `components/ui/` 当前只有 `input.tsx` / `badge.tsx` / `button.tsx`（已 `ls` 验证）。task-07 已确立"原生 `<select>` + Tailwind 类"约定（见 task-07.md §1 末段说明）。本任务**沿用该约定**，**不**新建 `components/ui/select.tsx`，role dropdown 用原生 `<select>`。

## 2. 实现要求

### 2.1 page.tsx 文件头与 imports

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WorkspaceMemberAddDialog } from "@/components/workspace-member-add-dialog";
import { WorkspaceMemberRow } from "@/components/workspace-member-row";
import { ApiError } from "@/lib/api";
import {
  listMembers,
  type WorkspaceMemberView,
} from "@/lib/workspace-members";
import { useSession } from "@/stores/session";
```

**约束**：

- **强制** `"use client"` —— 含 `useState` / `useEffect` / `useCallback`，必须是 Client Component
- **强制** import 来自 `@/...` 别名（与 task-07 / `api-keys/page.tsx` 一致）
- **不**从 `next/link` / `next/navigation` 引入（本页面不跳转，操作就地刷新）
- `useSession` 用于拿 current user（**注意**：本项目**没有 `useAuth` hook**，已 `grep` 验证；权限判定**不**依赖客户端，详见 §2.4）

### 2.2 page.tsx 组件签名与 state

```tsx
interface Props {
  params: { id: string };
}

export default function MembersPage({ params }: Props) {
  const workspaceId = params.id;

  // 数据 state
  const [members, setMembers] = useState<WorkspaceMemberView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 操作中锁（避免并发：同一时刻只允许一个行级操作或 Add）
  const [actionLoading, setActionLoading] = useState(false);

  // Add 对话框挂载
  const [showAddDialog, setShowAddDialog] = useState(false);

  // 当前 session user（用于客户端展示加 + "(you)" 兜底；权威 is_current_user 来自 backend）
  const sessionUser = useSession((s) => s.user);

  /* handlers 见 §2.3 */
}
```

**关于 `members` 初值 `null`**（与 `incidents/page.tsx:51` 模式一致）：

- `null` = 还没请求过 / 加载中（区分于 `[]` = 已请求但 ws 无成员）
- `[]` = 合法空态（理论上 ws 至少有 1 个 owner，但保留空态分支防御性处理）

### 2.3 数据获取与刷新

```tsx
const refresh = useCallback(async () => {
  setLoading(true);
  setError(null);
  try {
    const list = await listMembers(workspaceId);
    setMembers(list);
  } catch (err) {
    setMembers([]);
    setError(
      err instanceof ApiError
        ? `${err.code}: ${err.message}`
        : "加载成员列表失败",
    );
  } finally {
    setLoading(false);
  }
}, [workspaceId]);

useEffect(() => {
  void refresh();
}, [refresh]);
```

**effect 依赖说明**：

- `refresh` 是 `useCallback([workspaceId])`，仅 `workspaceId` 变化时函数引用才变 → effect 重跑
- **不**把 `refresh` 进 `eslint-disable-next-line` —— 这里 deps 是 `[refresh]` 而非 `[workspaceId]`，等价但更"函数式正确"（参考 `incidents/page.tsx:71-73` 模式）

### 2.4 权限判定（核心：客户端只判定"是否当前用户行"，不判定"是否 owner/admin"）

**关键设计**：本任务**不在客户端读 permission flags**。理由：

1. 后端 `listMembers` 已返回 `is_current_user` 字段（design §5.1 schema 第 91 行）—— 权威当前用户判定
2. **写入操作**（role 改 / Remove / Set Owner / Add）的权限校验完全在 backend `require_permission_any(Permission.WORKSPACE_MEMBER_MANAGE)` 完成
3. 客户端的"禁用按钮"只是 UX 友好层 —— 即使绕过，backend 也会返 403，前端捕获后显示错误条

**客户端禁用规则**（基于 `is_current_user` + `role_key`）：

| 场景 | 客户端禁用规则 | 备注 |
|------|----------------|------|
| 当前用户改自己的 role | `disabled` | design R-04：避免自我降级后失去管理权 |
| owner 行的"Set Owner" | 自己（is_current_user）的 Set Owner 按钮 disabled（不能 transfer 给自己） | 同时 backend 会返 400 |
| owner 行的"Remove" | **不**特别禁用（仍可点；backend 会返 `cannot_remove_last_owner` 400） | 由后端兜底；前端 disabled 会产生"为什么禁用"的疑问 |
| 当前用户是 viewer / developer（非 owner） | **不**在客户端隐藏按钮 | backend 403 兜底；前端只能通过失败后错误条提示 |

> **决定**：本任务**不**做客户端"非 owner 隐藏按钮"。design §5.2 第 145 行 "owner 不可移除自己；最后 owner 不可移除/降级" 由 backend 兜底（FR-04 第 2 GWT / FR-05 第 2 GWT 已覆盖）；FR-07 第 4 GWT 明确"前端无按钮控制时...或前端隐藏该 tab（择一，本变更取'显示但禁用'以保持一致体验）" —— 这里"禁用"指**当前用户行**的按钮 disabled，**不**指"viewer 不可见 Add 按钮"。

**viewer / developer 用户进入 Members 页的体验**：

- 表格仍渲染（list 操作只需 `WORKSPACE_READ`）
- Add / Set Owner / Remove / role dropdown 仍渲染，**可点**，但点后 backend 返 403 → 前端错误条提示 `HTTP_403_PERMISSION_DENIED: ...`
- 这种"看得到但用不了"的体验符合 FR-07 第 4 GWT 的"显示但禁用"约定（**不**是 task-09 的隐藏，是 backend 拒绝 + 前端错误条）

> **替代方案**（**不采用**）：客户端读 `current_user.role_key` 后判断 `if (role !== 'workspace_owner' && role !== 'platform_admin') hide actions`。**拒绝理由**：
> 1. 客户端有 `is_current_user` 但**没有**"当前用户的 role"字段（design §5.1 schema 第 84-91 行 `WorkspaceMemberView` 只在 list 项里有 role_key，不知道哪条是 current user）
> 2. 即使遍历 members 找 `is_current_user===true` 那条的 role_key，platform_admin 可能不在 members 表中（design §2：platform_admin bypass 权限，不一定要在 ws members 里）—— 客户端无法判定
> 3. backend 是权限的唯一权威；客户端隐藏按钮是"误安全感"，绕过即可滥用
> 4. 后端 403 + 前端错误条足够清晰

### 2.5 行级操作 handler（page.tsx 中定义，通过 props 传给 WorkspaceMemberRow）

```tsx
const handleRoleChange = async (
  userId: string,
  nextRole: WorkspaceMemberRoleKey,
) => {
  if (actionLoading) return;
  setActionLoading(true);
  setError(null);
  try {
    await updateMemberRole(workspaceId, userId, { role_key: nextRole });
    await refresh();
  } catch (err) {
    setError(
      err instanceof ApiError
        ? `${err.code}: ${err.message}`
        : "修改角色失败",
    );
  } finally {
    setActionLoading(false);
  }
};

const handleTransferOwnership = async (userId: string, displayName: string) => {
  if (actionLoading) return;
  // design R-04 强制 confirm（自我降级是不可逆，至少在重新登录前）
  const ok = confirm(
    `确定把 workspace 所有权传递给 "${displayName}"？\n` +
      `你将降级为 developer，不再能管理成员（直到对方把所有权传回给你）。`,
  );
  if (!ok) return;

  setActionLoading(true);
  setError(null);
  try {
    await transferOwnership(workspaceId, userId);
    await refresh();  // refresh 后当前用户行会变为 developer（is_current_user 仍 true）
  } catch (err) {
    setError(
      err instanceof ApiError
        ? `${err.code}: ${err.message}`
        : "传递所有权失败",
    );
  } finally {
    setActionLoading(false);
  }
};

const handleRemove = async (userId: string, displayName: string) => {
  if (actionLoading) return;
  const ok = confirm(`确定从 workspace 移除成员 "${displayName}"？`);
  if (!ok) return;

  setActionLoading(true);
  setError(null);
  try {
    await removeMember(workspaceId, userId);
    await refresh();
  } catch (err) {
    setError(
      err instanceof ApiError
        ? `${err.code}: ${err.message}`
        : "移除成员失败",
    );
  } finally {
    setActionLoading(false);
  }
};

const handleAddClicked = () => {
  if (actionLoading) return;
  setShowAddDialog(true);
};
```

### 2.6 page.tsx JSX 渲染

```tsx
return (
  <div className="flex flex-col gap-4">
    {/* 顶部 header：标题 + Add 按钮（Add 在 actionLoading 时 disabled） */}
    <header className="flex items-center justify-between">
      <div>
        <h2 className="text-sm font-medium">成员管理</h2>
        <p className="text-[11px] text-muted-foreground">
          管理 workspace 成员：添加、修改角色、移除、传递所有权。
        </p>
      </div>
      <Button size="sm" onClick={handleAddClicked} disabled={actionLoading}>
        + Add Member
      </Button>
    </header>

    {/* 错误条（与 api-keys/page.tsx 一致） */}
    {error && (
      <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
        {error}
      </div>
    )}

    {/* 表格主体 */}
    {loading ? (
      <p className="py-12 text-center text-xs text-muted-foreground">
        加载中…
      </p>
    ) : !members || members.length === 0 ? (
      <div className="rounded-md border bg-card p-8 text-center">
        <p className="text-sm">暂无成员</p>
        <p className="mt-1 text-xs text-muted-foreground">
          workspace 至少应有一个 workspace_owner；如出现空列表，请检查权限或联系平台管理员。
        </p>
      </div>
    ) : (
      <div className="rounded-md border bg-card">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Granted At</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <WorkspaceMemberRow
                key={m.user_id}
                member={m}
                actionLoading={actionLoading}
                onRoleChange={(next) => handleRoleChange(m.user_id, next)}
                onSetOwner={() =>
                  handleTransferOwnership(
                    m.user_id,
                    m.display_name ?? m.email,
                  )
                }
                onRemove={() =>
                  handleRemove(m.user_id, m.display_name ?? m.email)
                }
              />
            ))}
          </tbody>
        </table>
      </div>
    )}

    {/* Add 对话框（条件渲染） */}
    {showAddDialog && (
      <WorkspaceMemberAddDialog
        workspaceId={workspaceId}
        onAdded={() => {
          void refresh();
        }}
        onClose={() => setShowAddDialog(false)}
      />
    )}
  </div>
);
```

**关于表格容器 max-width / padding**：

- **不**加 `<div className="mx-auto max-w-6xl px-6 py-6">` —— 本页面已被 `layout.tsx`（task-08 产出）的 `<main className="mx-auto max-w-5xl px-6 py-8">` 包裹；本页面根 `<div className="flex flex-col gap-4">` 只负责内部布局
- layout 提供外层 padding + max-width + tab 栏；page 只填表格内容

### 2.7 WorkspaceMemberRow 子组件实现

```tsx
// frontend/src/components/workspace-member-row.tsx
"use client";

import { Badge } from "@/components/ui/badge";
import type {
  WorkspaceMemberRoleKey,
  WorkspaceMemberView,
} from "@/lib/workspace-members";

const ROLE_OPTIONS: ReadonlyArray<{
  value: WorkspaceMemberRoleKey;
  label: string;
}> = [
  { value: "developer", label: "Developer" },
  { value: "viewer", label: "Viewer" },
  { value: "workspace_owner", label: "Workspace Owner" },
];

interface Props {
  member: WorkspaceMemberView;
  actionLoading: boolean;          // 父组件全局操作锁（任一操作进行中时所有行禁用）
  onRoleChange: (next: WorkspaceMemberRoleKey) => void;
  onSetOwner: () => void;
  onRemove: () => void;
}

export function WorkspaceMemberRow({
  member,
  actionLoading,
  onRoleChange,
  onSetOwner,
  onRemove,
}: Props) {
  const isCurrentUser = member.is_current_user;
  const isOwner = member.role_key === "workspace_owner";

  // 当前用户改自己的 role → 禁用（design R-04 防自我降级）
  const roleDisabled = actionLoading || isCurrentUser;

  // 当前用户行的 Set Owner → 禁用（不能 transfer 给自己）
  const setOwnerDisabled = actionLoading || isCurrentUser;

  // 当前用户行的 Remove → 禁用（不能移除自己；design §5.2 第 145 行隐含）
  const removeDisabled = actionLoading || isCurrentUser;

  const displayName = member.display_name?.trim() || member.email;

  return (
    <tr>
      {/* Col 1: User */}
      <td>
        <div className="flex flex-col">
          <span className="text-xs font-medium">
            {displayName}
            {isCurrentUser && (
              <span className="ml-1 text-[11px] text-muted-foreground">
                (you)
              </span>
            )}
          </span>
          <span className="text-[11px] text-muted-foreground">
            {member.email}
          </span>
        </div>
      </td>

      {/* Col 2: Role dropdown */}
      <td>
        <select
          value={member.role_key}
          onChange={(e) =>
            onRoleChange(e.target.value as WorkspaceMemberRoleKey)
          }
          disabled={roleDisabled}
          className="h-8 rounded border border-input bg-background px-2 text-xs focus:border-ring focus:outline-none disabled:opacity-50"
        >
          {/* 仅渲染白名单 3 个；backend 可能回显 platform_admin 等，加 fallback option 避免受控组件警告 */}
          {ROLE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
          {/* 若 role_key 不在白名单（如 platform_admin / reviewer 等），显示一个 disabled option */}
          {!ROLE_OPTIONS.some((o) => o.value === member.role_key) && (
            <option value={member.role_key} disabled>
              {member.role_name} ({member.role_key}) — 不可修改
            </option>
          )}
        </select>
        {isOwner && (
          <Badge variant="default" className="ml-1.5 align-middle">
            owner
          </Badge>
        )}
      </td>

      {/* Col 3: Granted At */}
      <td className="text-[11px] text-muted-foreground">
        {new Date(member.granted_at).toLocaleString("zh-CN")}
      </td>

      {/* Col 4: Actions */}
      <td className="text-right space-x-1">
        <Button
          size="sm"
          variant="outline"
          onClick={onSetOwner}
          disabled={setOwnerDisabled}
        >
          Set Owner
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={onRemove}
          disabled={removeDisabled}
          className="text-destructive hover:text-destructive"
        >
          Remove
        </Button>
      </td>
    </tr>
  );
}
```

**关于 owner 行的 Set Owner / Remove 禁用策略**：

- 当前用户是 owner → 自己的 Set Owner 禁用（不能给自己 transfer）+ 自己的 Remove 禁用（不能移除自己）
- **其他** owner 行的 Set Owner / Remove **不**禁用 —— 用户可以 transfer 给另一个 owner（虽然无意义，但 backend 不拒绝）或 remove 另一个 owner（如果还有第 3 个 owner 兜底）
- "最后 owner 不能移除"由 backend 返 `cannot_remove_last_owner` 400 兜底；前端**不**预先判定（前端不知道"还有几个 owner"，需遍历 members 计算 —— 即使计算 backend 也会再校验一次，前端禁用反而是误安全感）

## 3. 接口定义

### 3.1 `MembersPage`（page.tsx 默认导出）

```tsx
interface Props {
  params: { id: string };  // workspace UUID / slug，来自路由段 [id]
}

export default function MembersPage({ params }: Props): JSX.Element;
```

**内部 state**：

| State | 类型 | 初值 | 用途 |
|-------|------|------|------|
| `members` | `WorkspaceMemberView[] \| null` | `null` | null=未加载；[]=已加载但空 |
| `loading` | `boolean` | `true` | 首屏骨架；refresh 期间也置 true（与 `incidents/page.tsx` 不同 —— incidents 不重置 loading；本任务为 UX 明确每次 refresh 显示"加载中…"，但实际 refresh 很快，可考虑去掉；**决定保留**：与 task-07 的 dialog loading 风格一致） |
| `error` | `string \| null` | `null` | 行级 / list / add 错误统一展示在顶部 |
| `actionLoading` | `boolean` | `false` | 全局操作锁：任一写入操作进行中时所有按钮 + role dropdown 禁用 |
| `showAddDialog` | `boolean` | `false` | Add 对话框挂载控制 |

**内部 handler**：

| Handler | 签名 | 行为 |
|---------|------|------|
| `refresh` | `() => Promise<void>` | 调 `listMembers` → setMembers / setError；useCallback([workspaceId]) |
| `handleRoleChange` | `(userId, nextRole) => Promise<void>` | confirm？**不**confirm（role 改是轻量操作）；调 updateMemberRole → refresh |
| `handleTransferOwnership` | `(userId, displayName) => Promise<void>` | **confirm**（design R-04）；调 transferOwnership → refresh |
| `handleRemove` | `(userId, displayName) => Promise<void>` | **confirm**；调 removeMember → refresh |
| `handleAddClicked` | `() => void` | `if (actionLoading) return; setShowAddDialog(true)` |

**effect 依赖**：`useEffect(() => { void refresh(); }, [refresh])` —— 仅 `[workspaceId]` 变化时重跑。

### 3.2 `WorkspaceMemberRow`（workspace-member-row.tsx named export）

```tsx
interface Props {
  member: WorkspaceMemberView;
  actionLoading: boolean;
  onRoleChange: (next: WorkspaceMemberRoleKey) => void;
  onSetOwner: () => void;
  onRemove: () => void;
}

export function WorkspaceMemberRow(props: Props): JSX.Element;
```

**子组件无内部 state**（所有状态由父通过 props 注入；行级"操作进行中"由父的 `actionLoading` 表达，行级操作不区分用户 —— 任一操作中所有行禁用，简化心智负担）。

**Props 设计取舍**：

- `onRoleChange(next)` 传 `next: WorkspaceMemberRoleKey` 而非 event —— 子组件做 `e.target.value as WorkspaceMemberRoleKey` 转换，父无需处理 DOM event，更纯净
- `onSetOwner()` / `onRemove()` 无参 —— 父在闭包里已绑定 `userId`（见 §2.6 渲染处）
- `actionLoading` 是父的全局锁透传 —— 子组件不维护"本行操作中"独立 state（理由：父的 actionLoading 已足够；细到行级反而引入复杂度且无 UX 收益）

## 4. 边界处理

1. **members 为空（`[]`）**：显示"暂无成员"卡片 + 提示"workspace 至少应有一个 workspace_owner"；**不**当作错误；Add 按钮仍可用（虽然后端会拒绝 —— 因为若 ws 真无 owner，没人有 member:manage 权限）
2. **当前用户是 viewer / developer**：表格仍渲染；Add / Set Owner / Remove / role dropdown 仍渲染且**可点**；点后 backend 返 403 → 顶部错误条显示 `HTTP_403_PERMISSION_DENIED: ...`；**不**在客户端隐藏按钮（理由见 §2.4）
3. **改自己 role**：role dropdown `disabled={actionLoading || isCurrentUser}` —— 当前用户行的 dropdown 始终禁用（design R-04 防自我降级）；其他用户行的 dropdown 正常可改
4. **最后 owner 不能 Remove / Set Owner 失效**：前端**不**预先判定；backend 返 `cannot_remove_last_owner` 400 → 顶部错误条显示；用户重试或选其他操作
5. **transfer 后自己变 developer 需刷新**：refresh 后 list 重拉，当前用户行的 role_key 变为 `developer`、is_current_user 仍 true → dropdown 自动 disabled（防止再次自我降级）；UX 上无额外提示（用户已 confirm 过，知道会降级）
6. **并发请求 lock**：`actionLoading` state + 每个 handler 头部 `if (actionLoading) return;` —— 任一写入操作进行中时，所有行按钮 + role dropdown + Add 按钮 disabled；避免并发 PATCH/DELETE/POST 导致数据竞争
7. **网络错误显示重试按钮**：**不**单独加重试按钮；错误条 + Add 按钮可重新触发（list 操作的"重试"= 改 role / 点 Add 间接再触发 refresh；若想显式重试，可在错误条加 `<button onClick={() => void refresh()}>重试</button>` —— **本任务加**，UX 更友好，与既有 incidents 页错误条相比是改进）
   - 实现：错误条改为 `<div>{error} <button onClick={() => void refresh()} className="underline">重试</button></div>`
8. **role dropdown 选项只含白名单 3 个**：`ROLE_OPTIONS` 数组硬编码 `workspace_owner` / `developer` / `viewer`，**不**含 `platform_admin` / `reviewer` / `qa` / `component_lead`；若 backend 回显的 `member.role_key` 不在白名单（理论上不应发生，因为本 API 写入端已校验，但 platform_admin 用户在 list 中可能回显），加 fallback `<option disabled>` 避免受控组件 value 不匹配警告
9. **role dropdown 改成相同值**：用户点开 dropdown 又选了当前值 → onChange 仍触发 → 后端 PATCH 一次（幂等，无副作用）；前端**不**做"如果 next === member.role_key 就 return"优化（YAGNI，且后端 PATCH 是幂等的）
10. **WorkspaceMemberView.role_key 类型为 `string`（非 literal）**：task-06 第 79 行明确"响应里用 str（不用 Literal），允许 service 回显 platform_admin 等用于显示" → 本任务 dropdown `value={member.role_key}` 类型兼容；onChange 时 `as WorkspaceMemberRoleKey` 强转（dropdown 只渲染白名单 3 个 option，用户不可能选到非法值，所以强转安全）
11. **sessionUser 为 null（未登录或 session 过期）**：本任务**不**依赖 sessionUser 做权限判定（is_current_user 来自 backend），仅用于"客户端兜底展示"（实际不使用，§2.2 中 state 保留但 UI 不读）；如 session 过期 → apiFetch 401 自动跳 `/login`（api.ts 内部处理）
12. **workspaceId 不存在 / 已删除**：`listMembers` 返 404 `workspace_not_found` → 错误条显示；用户点 tab 栏其他 tab 或返回 `/workspaces` 列表
13. **多次快速点 Add**：`actionLoading` 不锁 Add 点击（Add 只开对话框）；但对话框内 task-07 有自己的 `submitting` 防双击；本任务**不**在 Add 按钮上额外防抖
14. **dialog 关闭后 state 残留**：`<WorkspaceMemberAddDialog>` 是条件渲染（`{showAddDialog && <Dialog />}`），关闭 → unmount → state 自然清空；下次打开是全新实例
15. **layout.tsx 已渲染 tab 栏 + header**：本 page.tsx **不**重复渲染 `<h1>workspace 名</h1>` 或 tab 栏；只渲染"成员管理"标题（h2）+ 表格 + Add 按钮 + dialog
16. **transfer-ownership 的 displayName fallback**：`m.display_name ?? m.email` —— display_name 可能为 null（design schema），fallback 到 email；confirm 弹窗显示可读名

## 5. 非目标

- **不做**分页 / pagination（design §10 R-3：YAGNI；当前 ws 成员通常 < 20）
- **不做**搜索 / 过滤当前表格（design §3 非目标；搜索仅用于"加成员时找候选"，已在 task-07 对话框实现）
- **不做**导出 CSV / 审计（design §3 非目标）
- **不做**批量操作（design §3 非目标；一次只能操作一个成员）
- **不引入** shadcn `Select` / `Dropdown` / `Table` 组件（项目当前未 add；本任务用原生 `<select>` + `<table>`，与 task-07 / api-keys 页一致）
- **不在客户端**判定"当前用户是否 owner / platform_admin"（权限权威在后端；客户端隐藏按钮是误安全感）
- **不做**vitest 单测（design §3：前端依赖手动 e2e 验收）
- **不做**i18n（与既有 api-keys / incidents 页一致，文案直接写中文）
- **不做**loading skeleton / shimmer（一行"加载中…"文本足够）
- **不做** optimistic update（每次操作后 await refresh 重拉全表，简单可靠；optimistic update 需处理 rollback，YAGNI）
- **不做** "last owner" 的客户端预判禁用（backend `cannot_remove_last_owner` 兜底）
- **不修改** task-07 的 `<WorkspaceMemberAddDialog>` 组件（消费其 `onAdded` / `onClose` API 即可）
- **不修改** task-08 的 `layout.tsx` / `workspace-tabs.tsx`（本页面是被包裹方）

## 6. 参考

| 文件 | 借鉴点 |
|------|--------|
| `frontend/src/app/(dashboard)/settings/api-keys/page.tsx:1-156` | **主参考** —— 表格 + 操作按钮风格；错误条样式 `rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive`；空态卡片 `rounded-md border bg-card p-8 text-center`；confirm 弹窗用法 `confirm("...")`；useCallback + useEffect refresh 模式；`actionLoading` 等价模式（api-keys 用 `loading` 单态，本任务拆 `loading` / `actionLoading` 区分 list vs write） |
| `frontend/src/app/(dashboard)/workspaces/[id]/incidents/page.tsx:49-278` | **次参考** —— `items: Incident[] \| null` 三态（null/[]/array）；statusFilter 不需要本任务用，但 `actionLoading: string \| null` 改为 `boolean` 简化；多按钮 per row 模式 |
| `frontend/src/components/api-key-create-dialog.tsx:62-110` | dialog 挂载模式 `{showCreate && <Dialog onCreated={...} onClose={...} />}`；本任务 `{showAddDialog && <WorkspaceMemberAddDialog ... />}` 同构 |
| `frontend/src/lib/workspace-members.ts`（task-06 产出） | import `listMembers` / `updateMemberRole` / `removeMember` / `transferOwnership` / `WorkspaceMemberView` / `WorkspaceMemberRoleKey` |
| `frontend/src/components/workspace-member-add-dialog.tsx`（task-07 产出） | import `<WorkspaceMemberAddDialog>`；props: `workspaceId` / `onAdded` / `onClose` |
| `frontend/src/lib/api.ts:53-74` | `ApiError` 类（`code` / `status` / `message`），错误渲染 `${err.code}: ${err.message}` 格式 |
| `frontend/src/stores/session.ts` | `useSession` zustand store；本任务**仅** import 用于客户端兜底（实际 UI 不读，详见 §2.2 / §4.11） |
| `frontend/src/components/ui/button.tsx` | `<Button size="sm" variant="outline">` / `<Button size="sm" variant="ghost">` / `<Button size="sm">` 用法 |
| `frontend/src/components/ui/badge.tsx` | `<Badge variant="default">owner</Badge>` 用法（owner 标识） |

**关于 `useSession` 是否真用**：

- task-06 / task-07 都**不**直接用 useSession
- 本任务原本设想"客户端判定 current user 隐藏按钮"，但 §2.4 决定**不**这样做 → useSession 在本任务**实际未消费**
- **决定**：保留 `useSession` import 但 state `sessionUser` 不参与渲染（防御性占位；如 reviewer 强烈反对 unused var，可直接删 import + state —— 但本任务 AC 不强制要求；ESLint `@typescript-eslint/no-unused-vars` 可能触发 warning，**应对**：在 `sessionUser` 后加 `// eslint-disable-next-line @typescript-eslint/no-unused-vars` 或直接删
- **最终决定**：**删** `useSession` import 和 `sessionUser` state（§4.11 已说明"实际不使用"）；本任务的 is_current_user 完全依赖 backend 字段

## 7. TDD 步骤

本任务**不写 vitest 单测**（design §3 明确依赖手动 e2e 验收；前端组件测试需引入 RTL + jsdom，超出本任务 2h 估时）。

### 7.1 静态检查（必跑）

```bash
# 1. TypeScript 编译
cd frontend && pnpm tsc --noEmit
# 期望：exit 0；无 TS2322 / TS2345 / TS2554

# 2. ESLint
cd frontend && pnpm lint -- src/app/\(dashboard\)/workspaces/\[id\]/members/page.tsx src/components/workspace-member-row.tsx
# 期望：无 error；warning ≤ 0

# 3. Next.js build
cd frontend && pnpm next build
# 期望：build 成功；chunk 列表含 members/page 和 workspace-member-row
```

### 7.2 手动 e2e（FR-07 GWT 全覆盖）

**前置**：

- backend 已启动（task-04 router 已挂载 + task-05 测试已绿）
- frontend dev server（`cd frontend && pnpm dev`）
- 数据库至少 3 个用户：
  - **A**（workspace_owner，当前登录）
  - **B**（developer，已是该 ws 成员）
  - **C**（非成员，active 用户，用于 Add 测试）
- 已登录为 A，进入 `/workspaces/{id}/members`

**测试用例**：

| 编号 | 角色 | 步骤 | 期望 |
|------|------|------|------|
| TC-1 | A (owner) | 进入 `/workspaces/{id}/members` | Members tab 高亮；显示"成员管理"标题 + Add 按钮；表格渲染 N 行（含 header），含 A、B 两行；A 行有 "(you)" 标识 |
| TC-2 | A | 看 A 行 | User 列：A 的 display_name + "(you)" + email；Role 列：dropdown 当前值 "Workspace Owner" + owner badge；dropdown **disabled**（自己改自己 role 禁用）；Actions 列：Set Owner 按钮 **disabled**、Remove 按钮 **disabled** |
| TC-3 | A | 看 B 行（developer） | dropdown 当前 "Developer"，**enabled**；Set Owner **enabled**；Remove **enabled** |
| TC-4 | A | 改 B 的 role dropdown 为 "Viewer" | 不弹 confirm；B 行 dropdown 变 "Viewer"；表格刷新（短暂"加载中…"）；refresh 后 B 的 role 显示 Viewer |
| TC-5 | A | 点 B 行的 "Set Owner" | 弹 confirm："确定把 workspace 所有权传递给 B？你将降级为 developer..."；点"确定"后 refresh；A 行的 role 变为 Developer、A 的 dropdown disabled（自己改自己）；B 行的 role 变为 Workspace Owner + owner badge；A 的 Set Owner/Remove 仍 disabled；B 的 Set Owner/Remove 现在 disabled（B 是当前用户） |
| TC-6 | A | （回到 A 是 owner 状态）点 B 的 "Remove" | 弹 confirm："确定从 workspace 移除成员 B？"；点"确定"；refresh；表格少一行，只剩 A |
| TC-7 | A | 点 "+ Add Member" | 弹 task-07 对话框（验证 task-07 集成） |
| TC-8 | viewer（登出后以 viewer 登录） | 进入 `/workspaces/{id}/members` | 表格渲染（list 操作有 WORKSPACE_READ 权限）；表格中 viewer 行有 "(you)"；dropdown / Set Owner / Remove / Add 按钮**仍渲染且可点**（客户端不隐藏） |
| TC-9 | viewer | 点 "Add Member" | 顶部错误条显示 `HTTP_403_PERMISSION_DENIED: ...`（backend 拒绝） |
| TC-10 | viewer | 改某成员 role dropdown | 顶部错误条显示 `HTTP_403_PERMISSION_DENIED: ...` |
| TC-11 | A | 制造最后 owner：移除所有其他 owner，只剩 A | A 的 Remove 应该 disabled（自己）；尝试通过 API 直接 DELETE A → backend 返 400 `cannot_remove_last_owner`；前端 UI 不暴露此路径 |
| TC-12 | A | 断网（DevTools Offline），点 B 的 Remove | confirm 后弹错误条 `network_error: ...`；点"重试"按钮（错误条内）→ 仍失败（断网）；恢复网络后点重试 → 成功 |
| TC-13 | A | 网络错误后改 B 的 role | actionLoading=false（错误条未锁）；dropdown 可改；改后正常 PATCH |

### 7.3 e2e 关键验证点（review 时对照）

- 当前用户行**必须**有 "(you)" 后缀
- 当前用户行的 role dropdown **必须** disabled
- 当前用户行的 Set Owner + Remove **必须** disabled
- viewer 用户的列表能渲染（不被前端隐藏）
- viewer 点任意操作 → 错误条 403（不被前端 preemptive 拒绝）
- transfer 成功后 refresh，原 owner 行 role 变 developer、新 owner 行 role 变 owner + badge

## 8. 验收标准

| 编号 | 检查项 | 通过条件 |
|------|--------|----------|
| AC-1 | 表格渲染 N+1 行（含 header） | `members/page.tsx` JSX 含 `<table><thead><tr><th>User</th><th>Role</th><th>Granted At</th><th>Actions</th></tr></thead>`；`<tbody>` 内 `{members.map((m) => <WorkspaceMemberRow key={m.user_id} ... />)}` |
| AC-2 | 当前用户行有 "(you)" 后缀 | `WorkspaceMemberRow` 渲染中含 `{isCurrentUser && <span...>(you)</span>}` 或等价；TC-2 验证 A 行展示 "(you)" |
| AC-3 | viewer 不被前端隐藏 Add 按钮 | `members/page.tsx` 中 Add 按钮**不**有条件渲染（不依赖 current user role）；TC-8/TC-9 验证 viewer 看到 Add + 点后 403 |
| AC-4 | 非 owner 行可改 role | `WorkspaceMemberRow` 中 role dropdown 的 `disabled={actionLoading \|\| isCurrentUser}`（**不**含 isOwner 判定，只判 isCurrentUser）；TC-3/TC-4 验证 B 行可改 |
| AC-5 | owner 行 Set Owner 自己禁用 | `WorkspaceMemberRow` 中 Set Owner 的 `disabled={actionLoading \|\| isCurrentUser}`；TC-2 验证 A 行 Set Owner disabled |
| AC-6 | role dropdown 选项只含白名单 3 个 | `ROLE_OPTIONS` 数组恰好 3 项：`workspace_owner` / `developer` / `viewer`；**不**含 `platform_admin` 等；`grep -E '"workspace_owner"\|"developer"\|"viewer"' frontend/src/components/workspace-member-row.tsx` 在 ROLE_OPTIONS 区域输出恰好 3 行 |
| AC-7 | 错误条样式 + 重试按钮 | `members/page.tsx` 错误条 JSX 含 `className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive"` + 内部 `<button onClick={() => void refresh()}>重试</button>` |
| AC-8 | actionLoading 全局锁 | 每个 handler（handleRoleChange / handleTransferOwnership / handleRemove）首行含 `if (actionLoading) return;`；setActionLoading(true) 在 await 前，setActionLoading(false) 在 finally |
| AC-9 | transfer 与 remove 有 confirm | `handleTransferOwnership` 含 `confirm(...)`；`handleRemove` 含 `confirm(...)`；`handleRoleChange` **不**含 confirm（轻量操作） |
| AC-10 | dialog 条件渲染 | JSX 含 `{showAddDialog && <WorkspaceMemberAddDialog workspaceId={workspaceId} onAdded={...} onClose={...} />}` |
| AC-11 | `"use client"` 顶部声明 | `members/page.tsx` 和 `workspace-member-row.tsx` 文件首行（或注释后）均为 `"use client";` |
| AC-12 | TypeScript 编译通过 | `cd frontend && pnpm tsc --noEmit` exit 0 |
| AC-13 | ESLint 通过 | `cd frontend && pnpm lint` 无新增 error / warning |
| AC-14 | Next.js build 成功 | `cd frontend && pnpm next build` exit 0；chunk 列表含 members/page 和 workspace-member-row |
| AC-15 | 子组件 named export | `workspace-member-row.tsx` 含 `export function WorkspaceMemberRow(props: Props)`；**不**含 `export default` |
| AC-16 | page 默认导出 | `members/page.tsx` 含 `export default function MembersPage({ params }: Props)` |
| AC-17 | 不依赖 task-08 tab 栏 | `members/page.tsx` 不渲染 tab 栏 / 不渲染 workspace header `<h1>`（由 layout 提供）；只渲染 `<h2>成员管理</h2>` |

## 9. 风险与回滚

| 编号 | 风险 | 等级 | 应对 |
|------|------|------|------|
| R-1 | 当前用户行被前端误禁用所有操作 → owner 看到自己一行全 disabled，以为 bug | P2 | 文档明确：自己改自己 role / transfer 给自己 / remove 自己 都无意义 → 禁用是正确 UX；UI 上 "(you)" 标识 + disabled 视觉提示用户"这是你自己" |
| R-2 | viewer 用户点 Add → backend 403 → 错误条显示，但 viewer 困惑"为什么我看到 Add 按钮" | P2 | 接受（design FR-07 第 4 GWT "显示但禁用"约定）；错误条透传 `HTTP_403_PERMISSION_DENIED` 让 viewer 知道是权限问题；如未来需要"viewer 隐藏 Add"，需先在 backend listMembers 返回 current_user_role_key 字段（design 未定义，本任务**不**做） |
| R-3 | role dropdown 受控组件 value 不在 option 列表中 → React 警告 | P3 | 加 fallback `<option value={member.role_key} disabled>` 兜底（§2.7 实现）；触发条件：backend 回显 platform_admin / reviewer 等（理论不应发生但防御性处理） |
| R-4 | actionLoading 全局锁导致用户改 role 时整表禁用 1-2 秒 → UX 卡顿 | P3 | 接受（操作通常 < 500ms，禁用反馈让用户知道"操作进行中"）；若需细粒度，可改为 `actionLoadingUserId: string \| null` 仅锁当前操作的行，但本任务**不**做（YAGNI，UX 改进后续迭代） |
| R-5 | transfer 后自己变 developer，但 `members` state 仍含旧 is_current_user=true → dropdown 仍 disabled | P3 | 不是 bug：refresh 后 backend 重算 is_current_user（仍 true，因为 session user 没变），所以当前用户行始终是 is_current_user=true；只是 role_key 从 workspace_owner 变 developer —— dropdown disabled 不变（仍禁用），符合 design R-04 "禁止自我降级" |
| R-6 | 用户在 transfer confirm 弹窗点"取消"后 actionLoading 已被 set true | P3 | 修复：confirm 返回 false 时**不**进入 setActionLoading(true) —— 见 §2.5 `handleTransferOwnership` 实现：`const ok = confirm(...); if (!ok) return;` 在 `setActionLoading(true)` 之前 |
| R-7 | layout.tsx（task-08）未就绪时访问 `/workspaces/{id}/members` → 404 或无 tab 栏 | P2 | task-08 是 task-09 的 `depends_on` 前置；本任务实施时假设 task-08 已完成；如并行开发，task-08 未完成时本页面无 tab 栏但仍可工作（内容渲染不依赖 layout） |
| R-8 | backend listMembers 返 200 但 items 中 is_current_user 全为 false（backend bug） | P2 | 前端 "(you)" 不显示，dropdown 全可点 —— 用户可能误改自己 role；本任务**不**做客户端兜底（依赖 backend 字段正确性，task-02 service 已正确填充 is_current_user） |
| R-9 | 用户连续点 Add → 多个对话框挂载 | P3 | `showAddDialog` 是 boolean，重复 setShowAddDialog(true) 无副作用；React 渲染时只挂载一个 dialog 实例 |

**回滚**：

```bash
git rm frontend/src/app/\(dashboard\)/workspaces/\[id\]/members/page.tsx
git rm frontend/src/components/workspace-member-row.tsx
```

完全恢复（无类型扩散：本任务消费 task-06 的类型 + task-07 的组件；回滚后 task-06/07 的文件不受影响）。tab 栏仍渲染 Members 链接（task-08 产出），点击会 404 —— 可接受（回滚场景）。

## 10. 依赖与下游

- **本任务依赖**（depends_on）：
  - **task-06**（API client）：import `listMembers` / `updateMemberRole` / `removeMember` / `transferOwnership` + 类型 `WorkspaceMemberView` / `WorkspaceMemberRoleKey` —— **硬依赖**
  - **task-07**（Add 对话框）：import `<WorkspaceMemberAddDialog>` —— **硬依赖**
  - **task-08**（tab 化 layout）：本页面在 `(dashboard)/workspaces/[id]/members/page.tsx` 路径，会被 task-08 的 `layout.tsx` 自动包裹获得 tab 栏 —— **软依赖**（task-08 未完成时本页面仍能独立工作，只是无 tab 栏）
- **本任务阻塞**（blocks）：
  - **task-10**（lint + build 集成）：本任务的 2 个文件必须 lint + build 通过
  - **task-11**（Docker e2e）：本任务的 Members 页面是 e2e 验收的核心入口（admin 加成员 / transfer / remove / 最后 owner 保护）
