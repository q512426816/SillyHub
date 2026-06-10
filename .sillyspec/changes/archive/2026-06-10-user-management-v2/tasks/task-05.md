---
id: task-05
title: Drawer 增强（Workspace Tab + 会话撤销 + 密码增强）
priority: P0
estimated_hours: 1.5
depends_on: [task-04]
blocks: []
author: WhaleFall
created_at: "2026-06-10T11:45:44"
allowed_paths:
  - frontend/src/app/(dashboard)/settings/page.tsx
---

# task-05: Drawer 增强（Workspace Tab + 会话撤销 + 密码增强）

## 修改文件（必填）

| 操作 | 文件路径 | 说明 |
|------|----------|------|
| 修改 | `frontend/src/app/(dashboard)/settings/page.tsx` | Drawer 新增 "所属 Workspace" Tab；会话 Tab 增加撤销按钮；密码重置增加 force_change 复选框；补充新增的 import |

## 前置条件

本任务依赖 task-04 完成，task-04 在 `frontend/src/lib/settings.ts` 中新增了以下内容（本任务直接 import 使用）：

```typescript
// task-04 新增的接口
export interface UserWorkspaceRead {
  workspace_name: string;
  workspace_slug: string;
  role_name: string;
}

export interface RevokeAllResponse {
  revoked_count: number;
}

// task-04 新增的函数
export async function revokeSession(userId: string, sessionId: string): Promise<void>
export async function revokeAllSessions(userId: string): Promise<RevokeAllResponse>
export async function listUserWorkspaces(userId: string): Promise<UserWorkspaceRead[]>

// task-04 扩展了签名（新增第三个参数，带默认值 false）
export async function resetUserPassword(
  userId: string,
  newPassword: string,
  forceChangeOnNextLogin: boolean = false,
): Promise<void>
```

同时 task-04 删除了 `deleteUser`、`updateUser` 的 import（因相关 handler 被移除），本任务需要重新添加 `updateUser` 的 import（如果 Drawer 中需要用到的操作涉及它）。

## 实现要求

### R-01: 扩展 DrawerTab 类型

在 `UserDetailDrawer` 函数上方，将：

```typescript
type DrawerTab = "info" | "sessions" | "audit";
```

改为：

```typescript
type DrawerTab = "info" | "workspaces" | "sessions" | "audit";
```

### R-02: 新增 state 变量

在 `UserDetailDrawer` 函数内部，现有 state 声明区域（约 `useState<DrawerTab>("info")` 之后），新增以下 state：

```typescript
const [workspaces, setWorkspaces] = useState<UserWorkspaceRead[]>([]);
const [revoking, setRevoking] = useState<string | null>(null); // 正在撤销的 session ID，null 表示无
const [revokingAll, setRevokingAll] = useState(false);
const [revokeMsg, setRevokeMsg] = useState<{ ok: boolean; text: string } | null>(null);
const [forceChange, setForceChange] = useState(false); // 密码重置的 force_change 复选框
```

### R-03: 扩展 useEffect 数据加载

修改现有 `useEffect`（监听 `tab` 和 `user.id`），新增 `"workspaces"` 分支：

```typescript
useEffect(() => {
  if (tab === "sessions") {
    setLoading(true);
    listUserSessions(user.id)
      .then(setSessions)
      .catch(() => {})
      .finally(() => setLoading(false));
  } else if (tab === "workspaces") {
    setLoading(true);
    listUserWorkspaces(user.id)
      .then(setWorkspaces)
      .catch(() => {})
      .finally(() => setLoading(false));
  } else if (tab === "audit") {
    setLoading(true);
    listUserAudit(user.id)
      .then(setAuditLogs)
      .catch(() => {})
      .finally(() => setLoading(false));
  }
}, [tab, user.id]);
```

### R-04: 新增会话撤销 handler

在 `handleResetPassword` 函数之后，新增两个 handler：

```typescript
const handleRevokeSession = async (sessionId: string) => {
  setRevoking(sessionId);
  setRevokeMsg(null);
  try {
    await revokeSession(user.id, sessionId);
    // 从本地列表移除已撤销的会话
    setSessions((prev) => prev.filter((s) => s.id !== sessionId));
    setRevokeMsg({ ok: true, text: "会话已撤销" });
  } catch (err) {
    setRevokeMsg({
      ok: false,
      text: err instanceof ApiError ? err.message : "撤销失败",
    });
  } finally {
    setRevoking(null);
  }
};

const handleRevokeAllSessions = async () => {
  if (!confirm(`确定撤销 ${user.email} 的全部会话？用户将被迫重新登录。`)) return;
  setRevokingAll(true);
  setRevokeMsg(null);
  try {
    const result = await revokeAllSessions(user.id);
    setSessions([]);
    setRevokeMsg({ ok: true, text: `已撤销 ${result.revoked_count} 个会话` });
  } catch (err) {
    setRevokeMsg({
      ok: false,
      text: err instanceof ApiError ? err.message : "批量撤销失败",
    });
  } finally {
    setRevokingAll(false);
  }
};
```

### R-05: 修改 handleResetPassword 传递 forceChange

修改现有 `handleResetPassword`，将 `forceChange` state 传入 `resetUserPassword`：

```typescript
const handleResetPassword = async () => {
  if (newPw.length < 8) return;
  setResetting(true);
  setMessage(null);
  try {
    await resetUserPassword(user.id, newPw, forceChange);
    setMessage({ ok: true, text: "密码已重置，用户需重新登录" });
    setResetMode(false);
    setNewPw("");
    setForceChange(false);
    onRefresh();
  } catch (err) {
    setMessage({ ok: false, text: err instanceof ApiError ? err.message : "重置失败" });
  } finally {
    setResetting(false);
  }
};
```

### R-06: 修改 Drawer Tab 按钮列表

将 tab 按钮渲染部分（约 line 507-519）从：

```tsx
{(["info", "sessions", "audit"] as const).map((t) => (
  <button
    key={t}
    onClick={() => setTab(t)}
    className={`flex-1 py-2 text-xs font-medium transition-colors ${
      tab === t
        ? "border-b-2 border-primary text-primary"
        : "text-muted-foreground hover:text-foreground"
    }`}
  >
    {{ info: "基本信息", sessions: "会话", audit: "审计" }[t]}
  </button>
))}
```

改为：

```tsx
{(["info", "workspaces", "sessions", "audit"] as const).map((t) => (
  <button
    key={t}
    onClick={() => setTab(t)}
    className={`flex-1 py-2 text-xs font-medium transition-colors ${
      tab === t
        ? "border-b-2 border-primary text-primary"
        : "text-muted-foreground hover:text-foreground"
    }`}
  >
    {{ info: "基本信息", workspaces: "所属 Workspace", sessions: "会话", audit: "审计" }[t]}
  </button>
))}
```

### R-07: 新增 Workspace Tab 内容

在 `{tab === "info" && (...)}` 和 `{tab === "sessions" && (...)}` 之间，新增：

```tsx
{tab === "workspaces" && (
  loading ? (
    <p className="py-4 text-center text-xs text-muted-foreground">加载中…</p>
  ) : workspaces.length === 0 ? (
    <p className="py-4 text-center text-xs text-muted-foreground">该用户未加入任何 Workspace</p>
  ) : (
    <div className="space-y-2">
      {workspaces.map((ws) => (
        <div key={ws.workspace_slug} className="rounded border bg-card p-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">{ws.workspace_name}</span>
            <Badge variant="outline">{ws.role_name}</Badge>
          </div>
          <div className="mt-0.5 text-[11px] font-mono text-muted-foreground">
            {ws.workspace_slug}
          </div>
        </div>
      ))}
    </div>
  )
)}
```

### R-08: 修改会话 Tab — 增加撤销按钮

将现有会话 Tab 内容（约 line 594-616）替换为：

```tsx
{tab === "sessions" && (
  loading ? (
    <p className="py-4 text-center text-xs text-muted-foreground">加载中…</p>
  ) : sessions.length === 0 ? (
    <p className="py-4 text-center text-xs text-muted-foreground">无活跃会话</p>
  ) : (
    <div className="space-y-2">
      {/* 撤销全部按钮 */}
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {sessions.length} 个活跃会话
        </span>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => void handleRevokeAllSessions()}
          disabled={revokingAll}
        >
          {revokingAll ? "撤销中…" : "撤销全部"}
        </Button>
      </div>
      {revokeMsg && (
        <p
          className={`text-xs ${
            revokeMsg.ok ? "text-emerald-600" : "text-destructive"
          }`}
        >
          {revokeMsg.text}
        </p>
      )}
      {sessions.map((s) => (
        <div key={s.id} className="rounded border bg-card p-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="truncate font-mono text-muted-foreground">
              {s.user_agent ?? "Unknown"}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void handleRevokeSession(s.id)}
              disabled={revoking === s.id}
              className="ml-2 h-6 px-2 text-[11px]"
            >
              {revoking === s.id ? "撤销中…" : "撤销"}
            </Button>
          </div>
          <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>{s.ip ?? "—"}</span>
            <span>{new Date(s.created_at).toLocaleString("zh-CN")}</span>
          </div>
        </div>
      ))}
    </div>
  )
)}
```

### R-09: 密码重置区域增加 force_change 复选框

在密码重置的 `resetMode` 分支中，`<input type="password" ...>` 和按钮之间，新增复选框：

```tsx
{resetMode ? (
  <div className="space-y-2">
    <input
      type="password"
      value={newPw}
      onChange={(e) => setNewPw(e.target.value)}
      className={inputCls}
      placeholder="新密码（至少 8 位）"
    />
    <label className="flex items-center gap-2">
      <input
        type="checkbox"
        checked={forceChange}
        onChange={(e) => setForceChange(e.target.checked)}
        className="h-3.5 w-3.5 rounded border border-input"
      />
      <span className="text-xs text-muted-foreground">
        强制下次登录时修改密码
      </span>
    </label>
    <div className="flex gap-2">
      <Button
        size="sm"
        onClick={handleResetPassword}
        disabled={resetting || newPw.length < 8}
      >
        {resetting ? "重置中…" : "确认重置"}
      </Button>
      <Button
        size="sm"
        variant="outline"
        onClick={() => { setResetMode(false); setNewPw(""); setForceChange(false); }}
      >
        取消
      </Button>
    </div>
  </div>
) : (
  <Button
    size="sm"
    variant="destructive"
    onClick={() => setResetMode(true)}
  >
    重置密码
  </Button>
)}
```

### R-10: 更新 import 语句

在文件顶部的 import 块中，从 `@/lib/settings` 的 import 列表里新增以下符号：

```typescript
import {
  createUser,
  listSettings,
  listUserAudit,
  listUserSessions,
  listUsers,
  listUserWorkspaces,    // 新增
  resetUserPassword,
  revokeAllSessions,      // 新增
  revokeSession,          // 新增
  updateSettings,
  type AuditLogRead,
  type RevokeAllResponse, // 新增
  type UserRead,
  type UserListResponse,
  type UserSessionRead,
  type UserWorkspaceRead, // 新增
} from "@/lib/settings";
```

注意：task-04 可能已移除 `deleteUser` 和 `updateUser` 的 import。本任务只需要确认 `updateUser` 是否需要恢复——经过分析，当前 Drawer 的 info Tab 不直接调用 `updateUser`（用户编辑操作不在本任务范围内），因此**不恢复 `updateUser`** import。

## 接口定义（代码类任务必填）

### 新增的 TypeScript 类型（来自 task-04，本任务仅 import）

```typescript
interface UserWorkspaceRead {
  workspace_name: string;
  workspace_slug: string;
  role_name: string;
}

interface RevokeAllResponse {
  revoked_count: number;
}
```

### 新增的 API 函数（来自 task-04，本任务仅 import）

```typescript
function revokeSession(userId: string, sessionId: string): Promise<void>
function revokeAllSessions(userId: string): Promise<RevokeAllResponse>
function listUserWorkspaces(userId: string): Promise<UserWorkspaceRead[]>
```

### 修改的 API 函数（来自 task-04）

```typescript
function resetUserPassword(
  userId: string,
  newPassword: string,
  forceChangeOnNextLogin: boolean = false,  // 新增参数
): Promise<void>
```

### Drawer 内部状态变更

```typescript
// 原有
type DrawerTab = "info" | "sessions" | "audit";
// 变更为
type DrawerTab = "info" | "workspaces" | "sessions" | "audit";

// 新增 state
const [workspaces, setWorkspaces] = useState<UserWorkspaceRead[]>([]);
const [revoking, setRevoking] = useState<string | null>(null);
const [revokingAll, setRevokingAll] = useState(false);
const [revokeMsg, setRevokeMsg] = useState<{ ok: boolean; text: string } | null>(null);
const [forceChange, setForceChange] = useState(false);
```

### 控制流伪代码

```
Drawer 打开:
  tab 默认 "info"

用户点击 Tab:
  switch(tab):
    "info" → 显示基本信息 + 密码重置
    "workspaces" → 调用 listUserWorkspaces(userId) → 渲染 workspace 列表
    "sessions" → 调用 listUserSessions(userId) → 渲染会话列表 + 撤销按钮
    "audit" → 调用 listUserAudit(userId) → 渲染审计日志

会话 Tab - 撤销单个:
  点击"撤销" → setRevoking(sessionId)
  → revokeSession(userId, sessionId)
  → 成功: 从 sessions 数组中移除该会话, 显示成功提示
  → 失败: 显示错误信息
  → finally: setRevoking(null)

会话 Tab - 撤销全部:
  点击"撤销全部" → confirm() 弹窗确认
  → setRevokingAll(true)
  → revokeAllSessions(userId)
  → 成功: 清空 sessions 数组, 显示 "已撤销 N 个会话"
  → 失败: 显示错误信息
  → finally: setRevokingAll(false)

密码重置 - force_change:
  重置区域新增复选框
  点击"确认重置" → resetUserPassword(userId, newPw, forceChange)
  → forceChange = true 时, 后端写入审计日志标记
  → 成功后重置 forceChange = false
```

## 边界处理（必填）

1. **null/空值行为**：`UserWorkspaceRead` 的 `workspace_name`、`workspace_slug`、`role_name` 后端保证非空。若后端返回的字段为 `null`（不应发生但防御），渲染时用 `?? "—"` 兜底。`workspaces` 数组为空时显示"该用户未加入任何 Workspace"空状态文案。

2. **兼容旧行为（brownfield）**：`DrawerTab` 类型从 3 值扩展为 4 值，Tab 栏宽度自动分配（每个 tab 用 `flex-1`），不影响现有 tab 的渲染。密码重置的 `forceChange` state 默认 `false`，与 task-04 中 `resetUserPassword` 的第三个参数默认值一致，不勾选时行为与修改前完全相同。

3. **异常不静默吞掉**：
   - `listUserWorkspaces` 调用失败时 `.catch(() => {})` 静默处理，`workspaces` 保持空数组，用户看到"该用户未加入任何 Workspace"。这是因为 Workspace 列表是辅助信息，加载失败不应阻断 Drawer 使用。**但**：后续版本应考虑添加错误状态提示。
   - `revokeSession` / `revokeAllSessions` 调用失败时通过 `revokeMsg` state 明确显示红色错误信息，不静默吞掉。
   - `resetUserPassword` 调用失败时通过 `message` state 显示错误。

4. **不修改传入参数**：`user` prop 是只读的 `UserRead` 对象，所有 handler 只读取 `user.id`，不修改 `user` 对象。`sessions` 数组的更新使用 `setSessions(prev => prev.filter(...))` 函数式更新，不直接修改原数组。

5. **撤销操作防重入**：`revoking` state 跟踪当前正在撤销的 sessionId，同一会话的撤销按钮在请求期间 `disabled`。`revokingAll` state 防止"撤销全部"按钮被重复点击。两个操作互斥：撤销全部期间单个撤销按钮也应禁用——通过 `disabled={revokingAll || revoking === s.id}` 实现。

6. **confirm 弹窗取消**：`handleRevokeAllSessions` 中使用 `confirm()` 弹窗，用户点击"取消"时函数直接 return，不执行任何操作。不需要 try/catch 处理 `confirm`（浏览器原生同步 API，不会抛异常）。

7. **会话撤销后本地状态同步**：撤销单个会话后，从 `sessions` 数组中移除该条目，而不是重新请求整个列表。撤销全部后清空 `sessions` 数组。如果撤销过程中 `sessions` 因 tab 切换重新加载，React 的 state 更新会自然合并，不存在竞态问题（因为 `setSessions` 在 `.then` 和 `handleRevoke*` 中都有调用，后执行的覆盖前者）。

## 非目标（本任务不做的事）

- **不修改 settings.ts**：API 客户端函数由 task-04 添加，本任务只 import 使用
- **不修改后端**：后端端点由 task-01/02/03 实现
- **不在 info Tab 中添加用户编辑功能**：本任务不在 info Tab 中添加修改显示名、修改角色、修改状态等编辑功能，这些属于后续需求
- **不做 Workspace Tab 的交互操作**：不添加"将用户移出 Workspace"、"修改用户在 Workspace 中的角色"等操作，只做只读展示
- **不做前端权限判断**：不根据当前登录用户角色决定是否显示撤销按钮或 force_change 复选框，权限由后端保障
- **不修改操作列**：task-04 已简化操作列，本任务不改动
- **不修改 Drawer 外部结构**：Drawer 的 overlay、定位、宽度等样式不变
- **不恢复 `deleteUser` / `updateUser` import**：本任务不需要这两个函数

## 参考

- 现有 Drawer 的 Tab 切换模式：`(["info", "sessions", "audit"] as const).map(...)` 模式，新增 tab 直接扩展数组即可
- 现有 `handleResetPassword` 的 try/catch + message 模式，新增的 `handleRevokeSession` / `handleRevokeAllSessions` 照搬此模式
- 现有会话列表渲染结构：`sessions.map(s => <div>...</div>)`，撤销按钮加在每条会话卡片的右上角
- 现有密码重置区域的 `resetMode` 展开/收起模式，复选框插入在 password input 和按钮之间
- design.md 决策 5：Drawer 新增 "所属 Workspace" Tab，会话 Tab 增加撤销按钮，密码重置增加 force_change_on_next_login 复选框

## TDD 步骤

1. **写测试**：本任务是对 React 组件的 UI 增强，核心逻辑是 API 调用 + 状态管理。测试策略：
   - 手动测试为主，验证各 Tab 切换、撤销按钮、复选框的交互行为
   - 如项目有 React Testing Library 配置，可编写 Drawer 组件的集成测试

2. **确认失败**：运行 `npx tsc --noEmit`，确认新增的 import（如 `listUserWorkspaces`）在 task-04 未完成时会导致编译错误

3. **写代码**：按 R-01 ~ R-10 逐一实现

4. **确认通过**：运行 `npx tsc --noEmit`，零类型错误

5. **回归**：确认现有功能不受影响——用户列表加载、Drawer 打开、基本信息 Tab、审计 Tab、密码重置（不勾选 force_change 时行为不变）

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|----------|----------|
| AC-01 | 运行 `npx tsc --noEmit` | 零类型错误 |
| AC-02 | 打开设置页 → 用户管理 → 点击用户行 | Drawer 打开，Tab 栏显示 4 个 Tab："基本信息"、"所属 Workspace"、"会话"、"审计" |
| AC-03 | 点击"基本信息" Tab | 显示邮箱、显示名、状态、角色、创建时间、最后登录信息；底部有"重置密码"按钮 |
| AC-04 | 点击"重置密码"按钮 | 展开密码输入框 + "强制下次登录时修改密码"复选框 + 确认/取消按钮 |
| AC-05 | 不勾选复选框 → 输入密码 → 确认重置 | 密码重置成功，行为与修改前一致（force_change_on_next_login = false） |
| AC-06 | 勾选复选框 → 输入密码 → 确认重置 | 密码重置成功，后端审计日志记录 force_change_on_next_login = true |
| AC-07 | 取消重置 → 再次展开 | 复选框回到未勾选状态，密码输入框清空 |
| AC-08 | 点击"所属 Workspace" Tab | 调用 `listUserWorkspaces` API，显示 workspace_name + role_name 列表，每个卡片显示 slug |
| AC-09 | 用户无 Workspace 时点击 Tab | 显示"该用户未加入任何 Workspace"空状态文案 |
| AC-10 | 点击"会话" Tab | 会话列表顶部显示"N 个活跃会话"和"撤销全部"按钮；每个会话卡片右侧有"撤销"按钮 |
| AC-11 | 点击某个会话的"撤销"按钮 | 按钮变为"撤销中…"并 disabled；成功后该会话从列表移除，显示绿色成功提示；失败显示红色错误信息 |
| AC-12 | 点击"撤销全部"按钮 | 弹出 confirm 弹窗；确认后按钮变为"撤销中…"并 disabled；成功后列表清空，显示"已撤销 N 个会话" |
| AC-13 | 点击"撤销全部" → 在弹窗中点取消 | 不执行任何操作，列表不变 |
| AC-14 | 撤销操作进行中点击其他会话的撤销按钮 | 该按钮 disabled（revokingAll 或 revoking 互斥） |
| AC-15 | 点击"审计" Tab | 审计日志列表正常显示，行为与修改前一致 |
| AC-16 | Tab 栏宽度 | 4 个 Tab 均匀分配宽度（各占 flex-1），Tab 文字完整可见无溢出 |
