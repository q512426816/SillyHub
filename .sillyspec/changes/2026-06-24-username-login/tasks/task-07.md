---
id: task-07
title: 前端用户列表 + 登录页 — admin/users/page.tsx 列表加登录名列、各处展示改 username 优先；login/page.tsx 文案改「登录名」、默认回填 admin
priority: P0
depends_on: [task-06]
blocks: [task-10]
decision_ids: [D-001@v1]
requirement_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/admin/users/page.tsx
  - frontend/src/app/(auth)/login/page.tsx
author: WhaleFall
created_at: 2026-06-25T08:43:50
---

# task-07 — 前端用户列表加「登录名」列 + 登录页文案改「登录名」、默认回填 admin

## 1. 覆盖来源

- `design.md` §3 Phase 4（前端段，L68-72）：
  - `admin/users/page.tsx`：列表增「登录名」列；各处 `user.email` 展示/标题/toast 改 `user.username` 优先（`email` 兜底）。
  - `login/page.tsx`：文案「邮箱 / 账号」→「登录名」；默认回填 `admin@sillyhub.local` → `admin`；`account` 字段保留（后端当 username 查）。
- `decisions.md`：D-001@v1（纯登录名登录，登录主账号由 email 切换为 username）。
- `plan.md` Wave 4 / 任务表 task-07、依赖关系图（task-06 → task-07 → task-10）。
- 现状已核实（见下方「2. 修改文件」逐处行号）。

## 2. 修改文件

| 文件 | 改动 |
|---|---|
| `frontend/src/app/(dashboard)/admin/users/page.tsx` | ① 列表 `columns` 在「邮箱」列**之前**新增「登录名」列（`dataIndex: "username"`）；② 各处展示用 username 优先（`user.email` → `user.username ?? user.email ?? "—"`）：toast 文案（创建约147、更新约150、删除约162、启停登录约182/185）、`DeleteConfirm` 文案（约488）、`ResetPasswordDialog` 标题（约545）、`SessionsDrawer` 标题（约667）、`AuditDrawer` 标题（约758）；③ 搜索框 `placeholder`「搜索 email / 显示名…」→「搜索 登录名 / 显示名…」（约362）。 |
| `frontend/src/app/(auth)/login/page.tsx` | ① 副标题「使用邮箱或账号访问平台」→「使用登录名访问平台」（约140）；② 表单 label「邮箱 / 账号」→「登录名」（约164）；③ Input `placeholder`「邮箱或账号」→「登录名」（约169）；④ 必填校验 message「请输入邮箱或账号」→「请输入登录名」；⑤ 默认回填 `admin@sillyhub.local` → `admin`（约45）。`account` 字段名、`autoComplete="username"` 均不改。 |

> task-06 已把 `lib/admin.ts` 的 `UserRead.username: string`（必填）与 `UserRead.email: string | null` 补齐；本任务列表与展示直接消费这两个字段，无需再改类型。

## 3. 实现要求

### 3.1 `admin/users/page.tsx` — 列表新增「登录名」列（置于「邮箱」列之前）

```tsx
const columns: TableProps<UserRead>["columns"] = [
  {
    title: "登录名",
    dataIndex: "username",
    key: "username",
    render: (_v: unknown, u: UserRead) => {
      const isSelf = u.id === currentUserId;
      return (
        <span className="font-mono">
          {u.username}
          {u.is_platform_admin && (
            <Tag color="success" className="ml-2">超管</Tag>
          )}
          {isSelf && (
            <span className="ml-2 text-[10px] text-amber-600">（自己）</span>
          )}
        </span>
      );
    },
  },
  {
    title: "邮箱",
    dataIndex: "email",
    key: "email",
    render: (v: string | null) => (
      <span className="font-mono text-xs text-muted-foreground">
        {v ?? "—"}
      </span>
    ),
  },
  // ...显示名 / 角色 / 状态 / 最近登录 / 操作 不变
];
```

> 「超管」Tag 与「（自己）」标记从原 email 列迁移到 username 列（登录名是用户的主标识，标记跟随主标识更合理）。邮箱列降为纯展示列（`v ?? "—"` 兜底空值），不再承载超管/自己标记。

### 3.2 展示兜底工具（避免散落 `?? "—"`）

在文件顶部工具区（`fmtDate` 附近）新增一个展示用辅助函数，统一「username 优先，email 兜底」语义，供 toast/标题/确认文案调用：

```tsx
/** 用户展示名：username 优先，email 兜底，全空返回占位 */
function userDisplay(u: { username?: string | null; email?: string | null }): string {
  return u.username || u.email || "（未命名）";
}
```

> username 后端必填（task-02/06），正常不会为空；保留兜底仅防御历史脏数据或字段缺失的极端情况，避免 UI 出现空白/`undefined`。

### 3.3 各处 `user.email` 展示点 → `userDisplay(user)`

| 位置 | 原文 | 改后 |
|---|---|---|
| `handleSubmit` create toast（约147） | `` `用户 ${created.email} 已创建` `` | `` `用户 ${userDisplay(created)} 已创建` `` |
| `handleSubmit` update toast（约150） | `` `用户 ${updated.email} 已更新` `` | `` `用户 ${userDisplay(updated)} 已更新` `` |
| `handleConfirmDelete` toast（约162） | `` `用户 ${target.email} 已删除` `` | `` `用户 ${userDisplay(target)} 已删除` `` |
| `handleToggleLogin` toast（约182/185） | `` `已禁用 ${u.email} 的登录` `` / `` `已启用 ${u.email} 的登录` `` | 用 `userDisplay(u)` |
| `DeleteConfirm` 文案（约488） | `将删除用户 <span className="font-mono">{user.email}</span>` | `将删除用户 <span className="font-mono">{userDisplay(user)}</span>` |
| `ResetPasswordDialog` 标题（约545） | `重置 {user.email} 的密码` | `重置 {userDisplay(user)} 的密码` |
| `SessionsDrawer` 标题（约667） | `{user.email} 的会话` | `{userDisplay(user)} 的会话` |
| `AuditDrawer` 标题（约758） | `{user.email} 的审计日志（近 50 条）` | `{userDisplay(user)} 的审计日志（近 50 条）` |

### 3.4 搜索框 placeholder（约362）

```tsx
placeholder="搜索 登录名 / 显示名…"
```

> 搜索后端 `listUsers` 的 `q` 参数：当前后端 `users_service.py` 的搜索实现仍可能按 `email ilike`（或同时匹配 username/display_name）。本期前端只改文案，**不改 `listUsers` 的请求参数名**（仍是 `q`）。若后端 `q` 不匹配 username，是后端搜索实现问题（不在本任务 allowed_paths，且 plan 未把后端搜索列入任何 task），本任务在「边界处理」注明：前端注明 placeholder 文案以 username 为主，实际命中以后端 `q` 实现为准；如发现后端仅匹配 email，应在后续单独修后端搜索（非本期范围）。

### 3.5 `login/page.tsx` 文案与默认回填

```tsx
// L45 附近（useEffect 回填）
form.setFieldsValue({
  account: cached.account ?? "admin",       // 改：原 "admin@sillyhub.local" → "admin"
  password: cached.password ?? "admin123",
  remember: true,
});

// L140 副标题
<p className="mt-1 text-sm text-slate-500">
  使用登录名访问平台                       {/* 改：原「使用邮箱或账号访问平台」 */}
</p>

// L164-172 表单字段
<Form.Item
  label="登录名"                            {/* 改：原「邮箱 / 账号」 */}
  name="account"
  rules={[{ required: true, message: "请输入登录名" }]}   {/* 改：原「请输入邮箱或账号」 */}
>
  <Input
    placeholder="登录名"                    {/* 改：原「邮箱或账号」 */}
    autoComplete="username"                 {/* 不改 */}
    allowClear
  />
</Form.Item>
```

> `LoginFormValues.account` 字段名保留（后端 `LoginRequest.account` 字段不变，task-03 login 已纯按 username 查，零契约改）；`autoComplete="username"` 保留（浏览器密码管理器按 username 语义填充，正好契合「登录名」）。

## 4. 接口定义（columns 新增项 + 各处文案改动点）

### 4.1 列表 columns 新增「登录名」列

| 属性 | 值 |
|---|---|
| `title` | `"登录名"` |
| `dataIndex` | `"username"` |
| `key` | `"username"` |
| 位置 | columns 数组第 0 项（「邮箱」列之前） |
| `render` | 显示 `u.username`（font-mono）+ 超管 Tag + （自己）标记 |

### 4.2 「邮箱」列调整

| 属性 | 原值 | 改后 |
|---|---|---|
| `render` | 显示 `u.email` + 超管 Tag + （自己）标记 | 仅显示 `v ?? "—"`（纯展示，去标记，降为次要信息） |
| `title` | `"邮箱"` | 不变 |

### 4.3 文案改动点汇总（login/page.tsx）

| 字段 | 原文 | 改后 |
|---|---|---|
| 副标题（L140） | 使用邮箱或账号访问平台 | 使用登录名访问平台 |
| label（L164） | 邮箱 / 账号 | 登录名 |
| placeholder（L169） | 邮箱或账号 | 登录名 |
| rules message（L166） | 请输入邮箱或账号 | 请输入登录名 |
| 默认回填（L45） | `admin@sillyhub.local` | `admin` |

### 4.4 文案改动点汇总（users/page.tsx）

| 字段 | 原 | 改后 |
|---|---|---|
| 搜索 placeholder | 搜索 email / 显示名… | 搜索 登录名 / 显示名… |
| 创建 toast | `用户 ${x.email} 已创建` | `用户 ${userDisplay(x)} 已创建` |
| 更新 toast | `用户 ${x.email} 已更新` | `用户 ${userDisplay(x)} 已更新` |
| 删除 toast | `用户 ${x.email} 已删除` | `用户 ${userDisplay(x)} 已删除` |
| 启停登录 toast | `已禁用/启用 ${x.email} 的登录` | 用 `userDisplay(x)` |
| 删除确认正文 | `将删除用户 {user.email}` | `将删除用户 {userDisplay(user)}` |
| 重置密码标题 | `重置 {user.email} 的密码` | `重置 {userDisplay(user)} 的密码` |
| 会话抽屉标题 | `{user.email} 的会话` | `{userDisplay(user)} 的会话` |
| 审计抽屉标题 | `{user.email} 的审计日志（近 50 条）` | `{userDisplay(user)} 的审计日志（近 50 条）` |

## 5. 边界处理

1. **email 为空时展示用 username 兜底（不显空）**：所有展示点统一走 `userDisplay(u) = u.username || u.email || "（未命名）"`。username 后端必填（task-02/06），正常场景必有值；兜底仅防极端脏数据，确保 UI 永不出现 `undefined`/空白。
2. **登录页默认回填 `admin`**：useEffect 中 `cached.account ?? "admin"`（原 `admin@sillyhub.local`）。首次访问无缓存时回填 `admin`，便于开发/演示快速登录；有「记住我」缓存时优先用缓存 account。
3. **`account` 字段名不改**：`LoginFormValues.account`、表单 `name="account"`、`login(values.account, ...)` 全部保留。后端 `LoginRequest.account` 字段名不变（design §5 非目标明确零契约改），task-03 login 已纯按 username 查 `account` 值。
4. **`autoComplete="username"` 保留**：浏览器密码管理器按 username 语义自动填充，与「登录名」语义一致，不改为 `off` 或别的值。
5. **搜索后端字段注明**：前端 placeholder 改「搜索 登录名 / 显示名…」，但 `listUsers({ q })` 请求参数名不变。实际命中字段由后端 `users_service.py` 的 `q` 实现决定（可能匹配 email / username / display_name 之一或组合）。若实测发现后端 `q` 不匹配 username 导致搜登录名搜不到，属后端搜索实现问题，不在本任务 allowed_paths 与本期任何 task 范围内 —— 在本任务备注中显式注明，留待后续单独修复。
6. **登录副标题对齐**：副标题「使用登录名访问平台」与 label「登录名」、placeholder「登录名」三者文案统一为「登录名」，不再混用「邮箱/账号」旧称。
7. **邮箱列降级但保留**：email 列不删除（管理员仍需看用户邮箱用于通知/找回场景），仅降为次要展示（`text-muted-foreground` + 空 `—` 兜底）；超管/自己标记迁至登录名列，避免用户认知割裂。
8. **「（自己）」与「超管」标记不丢失**：从 email 列 render 迁移到 username 列 render，标记内容与判定逻辑（`isSelf = u.id === currentUserId`、`u.is_platform_admin`）完全不变。
9. **`isSelf` 逻辑不动**：删除按钮 `disabled={!canWrite || isSelf}`、禁登录按钮 `disabled={!canLoginManage || (isSelf && u.login_enabled)` 等权限判定全部不变；本任务仅改展示文案，不改任何 disabled/权限分支。

## 6. 非目标

- 不改 `lib/admin.ts` 类型（task-06 范围）。
- 不改 `admin-user-drawer.tsx`（task-06 范围）。
- 不改后端 `users_service.py` 搜索实现（不在本期任何 task 范围；若 placeholder 与后端 `q` 命中字段不一致，留待后续）。
- 不改 `LoginRequest.account` 字段名 / 登录请求契约（design §5 非目标）。
- 不改 `autoComplete` 属性值。
- 不删除「邮箱」列（仅降级展示）。
- 不改 columns 的分页/排序/`rowKey`/`scroll`/`pagination` 配置。
- 不在本任务写测试代码（task-09 覆盖 drawer；列表/登录页本期无独立测试任务，由 task-10 集成手测覆盖）。

## 7. 参考

- `design.md` §3 Phase 4（L68-72）、§4 验收标准 1/3、§5 非目标（不改 LoginRequest.account）。
- `decisions.md` D-001@v1（纯登录名登录）。
- `plan.md` Wave 4 task-07、依赖关系图（task-06 → task-07 → task-10）。
- 现状：
  - `frontend/src/app/(dashboard)/admin/users/page.tsx`（columns L200-219、toast L147/150/162/182/185、搜索 L362、DeleteConfirm L488、ResetPasswordDialog L545、SessionsDrawer L667、AuditDrawer L758）。
  - `frontend/src/app/(auth)/login/page.tsx`（回填 L45、副标题 L140、label L164、placeholder L169、rules L166）。
- task-06：`lib/admin.ts` 已声明 `UserRead.username: string`、`UserRead.email: string | null`（本任务消费这两个字段）。
- 样式参考：`.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/design.md`（`font-mono` / `text-muted-foreground` / `text-amber-600` / Tag 等沿用现有类名，不改风格）。

## 8. TDD 步骤（本任务以展示层改动为主；无独立单测任务，由 task-10 集成验证）

1. **Green（本任务）**：
   - 改 `admin/users/page.tsx`：新增 `userDisplay` 工具函数；columns 新增「登录名」列（首项）并把超管/自己标记迁入、「邮箱」列 render 改纯展示；8 处 `user.email` 展示改 `userDisplay(...)`；搜索 placeholder 改文案。
   - 改 `login/page.tsx`：默认回填 `admin`；副标题/label/placeholder/rules message 四处文案改「登录名」。
2. **Verify**：
   - `cd frontend && pnpm tsc --noEmit` 无类型错误（`UserRead.username` 为 `string`，`UserRead.email` 为 `string | null`，`userDisplay` 入参类型兼容）。
   - `cd frontend && pnpm lint` 无新增 warning（无 `any`、无未用变量）。
   - 手测（task-10 集成阶段）：
     - `/admin/users` 列表首列显示「登录名」，超管/自己标记在登录名列；email 列空值显示 `—`；toast/确认/抽屉标题均显示登录名。
     - 登录页副标题/label/placeholder 均为「登录名」；清 localStorage 后首次访问 account 回填 `admin`。
3. **回归检查**：确认未误改权限判定（isSelf/canWrite/canLoginManage 的 disabled 分支）、未误改 `account` 字段名与 `autoComplete`。

## 9. 验收标准

| 编号 | 验收点 | 验证方式 |
|---|---|---|
| AC-1 | `admin/users/page.tsx` columns 首项为「登录名」列（`dataIndex: "username"`），置于「邮箱」列之前 | 读改后文件 / 浏览器看列表首列标题 |
| AC-2 | 「邮箱」列降为纯展示（`v ?? "—"`），不再承载超管/自己标记 | 读 render 函数 |
| AC-3 | 超管 Tag 与「（自己）」标记迁移到「登录名」列 render 内，判定逻辑不变 | 读 render / 手测自己行与超管行 |
| AC-4 | 创建/更新/删除/启停登录 4 处 toast 使用 `userDisplay(...)`（username 优先） | 读 `handleSubmit`/`handleConfirmDelete`/`handleToggleLogin` |
| AC-5 | `DeleteConfirm` 正文、`ResetPasswordDialog` 标题、`SessionsDrawer` 标题、`AuditDrawer` 标题 4 处使用 `userDisplay(user)` | 读对应组件 |
| AC-6 | 搜索框 placeholder 为「搜索 登录名 / 显示名…」 | 读 input placeholder |
| AC-7 | email 为空时所有展示点不出现空白/`undefined`（`userDisplay` 兜底「（未命名）」） | 读 `userDisplay` 实现 + 手测空 email 用户 |
| AC-8 | `login/page.tsx` 默认回填 `admin`（清缓存后首次访问） | 手测 / 读 useEffect |
| AC-9 | 登录页副标题、label、placeholder、rules message 四处文案均为「登录名」（无「邮箱/账号」残留） | grep `邮箱` 在 login/page.tsx 无残留 |
| AC-10 | `LoginFormValues.account` 字段名、表单 `name="account"`、`login(values.account, ...)` 调用、`autoComplete="username"` 均未改动 | git diff 确认仅改文案与默认值 |
| AC-11 | 权限判定（isSelf/canWrite/canLoginManage 的 disabled 分支）未误改 | git diff 确认 disabled 表达式不变 |
| AC-12 | `pnpm tsc --noEmit` + `pnpm lint` 对两文件无新增错误 | 命令行执行 |
