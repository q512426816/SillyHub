---
id: task-06
title: 前端类型 + admin-user-drawer — lib/admin.ts 类型同步；admin-user-drawer.tsx 加「登录名」(必填、可编辑、冲突报错)、email 改可选
priority: P0
depends_on: [task-02]
blocks: [task-07, task-09]
decision_ids: [D-001@v1, D-004@v1]
requirement_ids: []
allowed_paths: [frontend/src/lib/admin.ts, frontend/src/components/admin-user-drawer.tsx]
author: WhaleFall
created_at: 2026-06-25T08:43:50
---

# task-06 — 前端类型同步 + admin-user-drawer 改造

## 1. 覆盖来源

- `design.md` §3 Phase 4（前端段）：`lib/admin.ts` 类型；`admin-user-drawer.tsx` 增「登录名」字段、email 改可选。
- `decisions.md`：D-001@v1（纯登录名登录，登录主账号由 email 切换为 username）、D-004@v1（username 可编辑、唯一冲突友好报错）。
- `plan.md` Wave 3 / 任务表 task-06。
- 现状已核实：`frontend/src/lib/admin.ts`（`UserRead.email: string` 必填、`UserCreateRequest` 无 username 且 email 必填、`UserUpdateRequest` 无 username/email）、`frontend/src/components/admin-user-drawer.tsx`（仅 email 字段，edit 时 disabled，无 username；`formValid = emailValid && passwordValid`）。

## 2. 修改文件

| 文件 | 改动 |
|---|---|
| `frontend/src/lib/admin.ts` | `UserRead.email` 改 `string \| null`；`UserCreateRequest` 增必填 `username: string`、`email` 改 `string \| null`（可选）；`UserUpdateRequest` 增 `username?: string`、`email?: string \| null`。 |
| `frontend/src/components/admin-user-drawer.tsx` | 新增「登录名」(username) 字段——必填、create+edit 均可编辑、唯一冲突（后端 409）回显错误；email 改非必填（仅非空时校验 `EMAIL_PATTERN`）；create body 传 `username`；edit body 支持传 `username`/`email`；`formValid` 改为 `username 必填 && (email 空 \|\| email 合法) && passwordValid`。新增 `username` state；useEffect edit 回填 `user.username`、create 清空。 |

## 3. 实现要求

### 3.1 `frontend/src/lib/admin.ts` 类型定义

```ts
export interface UserRead {
  id: string;
  username: string;            // 新增：后端 UserRead 已含 username，前端补字段（task-07 列表也会用到）
  email: string | null;        // 改：原 string → string | null
  display_name: string | null;
  status: string;
  is_platform_admin: boolean;
  login_enabled: boolean;
  last_login_at: string | null;
  created_at: string;
  organizations: OrganizationBrief[];
  roles: RoleBrief[];
}

export interface UserCreateRequest {
  username: string;            // 新增：必填
  email?: string | null;       // 改：原必填 email: string → 可选
  password: string;
  display_name?: string;
  is_platform_admin?: boolean;
  login_enabled?: boolean;
  organization_ids?: string[];
  role_ids?: string[];
}

export interface UserUpdateRequest {
  username?: string;           // 新增：可编辑
  email?: string | null;       // 新增：可编辑（传 null 表示清空）
  display_name?: string;
  is_platform_admin?: boolean;
  status?: string;
  login_enabled?: boolean;
  organization_ids?: string[];
  role_ids?: string[];
}
```

> 说明：`UserRead.username` 后端 schema 已返回（task-02 涵盖），前端此前未声明；本任务一并补上（task-07 列表展示与 edit 回填都依赖它）。`UserRead.email` 必须改 `string | null`，否则 tsc 对 nullable email 报错。

### 3.2 `admin-user-drawer.tsx` 字段 JSX 伪结构

```tsx
// 新增 state
const [username, setUsername] = useState("");

// useEffect edit 回填（在现有 setEmail 等基础上增）
if (mode === "edit" && user) {
  setUsername(user.username ?? "");       // 新增
  setEmail(user.email ?? "");             // 改：兼容 null
  // ... 其余不变
} else {
  setUsername("");                         // 新增
  setEmail("");
  // ...
}

// 校验
const usernameValid = username.trim().length >= 3;          // 必填、最小长度
const emailValid = email.trim() === "" || EMAIL_PATTERN.test(email);  // 空合法；非空才校验格式
const passwordValid = mode === "edit" || password.length >= 8;
const formValid = usernameValid && emailValid && passwordValid;

// JSX：在「邮箱」字段之前插入「登录名」字段（username）
<div>
  <label className="text-[11px] text-muted-foreground">登录名 *</label>
  <input
    value={username}
    onChange={(e) => setUsername(e.target.value)}
    disabled={!canWrite}                      // create + edit 均可编辑（非 isSelf 受限）
    aria-label="登录名"
    className={`mt-0.5 ${inputCls} ${!usernameValid && username ? "border-destructive" : ""}`}
  />
  {!usernameValid && username && (
    <p className="mt-1 text-[10px] text-destructive">登录名至少 3 位</p>
  )}
</div>

// 「邮箱」字段：label 改「邮箱（可选）」、去掉 edit disabled、空合法
<div>
  <label className="text-[11px] text-muted-foreground">邮箱（可选）</label>
  <input
    value={email}
    onChange={(e) => setEmail(e.target.value)}
    disabled={!canWrite}                      // 改：edit 也可编辑（去掉 mode === "edit" disabled）
    aria-label="邮箱"
    className={`mt-0.5 ${inputCls} ${email && !emailValid ? "border-destructive" : ""}`}
  />
  {email && !emailValid && (
    <p className="mt-1 text-[10px] text-destructive">邮箱格式不合法</p>
  )}
</div>

// create body
const body: UserCreateRequest = {
  username,                                   // 新增：必传
  email: email.trim() || null,                // 改：空传 null（或省略，二者等价；统一传 null 显式）
  password,
  // ...
};

// edit body：仅当值相对原值有变化时透传（最小改动；也可无条件传，后端幂等）
const body: UserUpdateRequest = {
  username: username !== user.username ? username : undefined,   // 新增
  email: email !== (user.email ?? "") ? (email.trim() || null) : undefined,  // 新增
  display_name: displayName || undefined,
  // ...
};
```

> 标题处 `编辑用户 ${user?.email}` 改为 `编辑用户 ${user?.username}`（与 task-07 列表展示一致；本字段在本文件内即引用）。

### 3.3 错误回显（409 冲突）

`onSubmit` 的 `catch` 已有 `setError(err instanceof Error ? err.message : "保存失败")`。`apiFetch` 在非 2xx 时抛 `ApiError`（继承 `Error`，`message` 含后端 detail）。后端 task-03/05 在 username 冲突时返回 `409` + 中文 detail（如「登录名已被占用」），前端无需额外解析，直接回显到现有 `error` 区域即可。

> 若 `ApiError` 实际暴露 status 字段，可在 catch 中对 409 做更友好文案（如「该登录名已存在，请更换」）。本期保持最小改动：沿用现有 message 回显；如 message 不友好，再在 catch 中特判（`err.status === 409`）。task-09 测试覆盖「冲突报错回显」。

## 4. 边界处理

1. **username 必填缺失**：`usernameValid = username.trim().length >= 3`，缺失或过短时 `formValid=false`，保存按钮禁用；输入框聚焦后显示「登录名至少 3 位」红字。
2. **email 空合法、非空才校验格式**：`emailValid = email.trim() === "" || EMAIL_PATTERN.test(email)`；空值不报错、不阻断保存；非空且不匹配 `EMAIL_PATTERN` 时报「邮箱格式不合法」并阻断保存。
3. **409 唯一冲突回显**：username 改成已存在值（或 create 撞已有 username）时，后端返回 409，`onSubmit` reject → `catch` 把 message 写入 `error` state，在表单底部红字显示；不清空用户输入，便于修改后重试。
4. **edit 模式 username 可改**：username 输入框 `disabled={!canWrite}`（不再 `mode === "edit"` 锁死），edit 时可改；isSelf 保护仍适用（self 不能改自己的超管/登录开关，但可改自己的 username——若担心 self 改 username 锁死自己，按 D-004 允许编辑，不做额外限制；后端 `_resolve_username` 排除自身 id 防自伤）。
5. **password 仅 create 必填**：`passwordValid = mode === "edit" || password.length >= 8`；edit 模式不显示密码字段、不校验；create 模式不足 8 位阻断保存。
6. **保持 isSelf 保护**：`isSelf` 判定与「平台超级管理员」「允许登录」两个 checkbox 的 disabled 逻辑完全不变（self 不能取消自己超管、不能禁自己登录）。
7. **email 清空传 null**：edit 时清空 email 输入 → body `email: null`（仅当相对原值变化才传），后端写 NULL；多个 NULL email 因 PG 唯一索引 NULL 语义共存不报错（D-003）。

## 5. 非目标

- 不改 `login/page.tsx` 文案与默认回填（task-07 范围）。
- 不改 `admin/users/page.tsx` 列表「登录名」列与展示切换（task-07 范围）。
- 不改 `lib/admin.ts` 中 `RoleUserRead.email` 等无关字段（仅动 `UserRead`/`UserCreateRequest`/`UserUpdateRequest` 三个接口）。
- 不引入 username 格式正则（仅最小长度 ≥3，与后端 `Field(min_length=3)` 对齐；如后端另有格式约束，前端不做更严格校验）。
- 不改 `onSubmit` 签名与父组件 `users/page.tsx` 的调用契约（仍传 `UserCreateRequest | UserUpdateRequest`）。
- 不在本任务写测试代码（task-09 范围；本任务仅改类型 + 组件）。

## 6. 参考

- `design.md` §3 Phase 4、§4 验收标准 1/2/5。
- `decisions.md` D-001@v1、D-004@v1。
- `plan.md` task-06 行、依赖关系图（task-02 → task-06 → task-07/09）。
- 现状：`frontend/src/lib/admin.ts:25-60`、`frontend/src/components/admin-user-drawer.tsx:46-126`。
- 样式参考：`.sillyspec/changes/archive/2026-06-21-2026-06-21-frontend-style-system/design.md`（input/border-destructive/text-destructive 类名沿用现有，不改风格）。

## 7. TDD 步骤（本任务以类型+组件实现为主；测试代码在 task-09）

1. **Red（task-09 先行或并行）**：`admin-user-drawer.test.tsx` 新增用例——create 模式无 username 时保存禁用；填 username 后可保存；email 空合法；email 非空且格式错阻断；edit 模式 username 可编辑；submit 冲突 409 时 error 回显。本期 task-06 不写测试，但实现须满足这些断言。
2. **Green（本任务）**：
   - 改 `lib/admin.ts` 三接口类型。
   - 改 `admin-user-drawer.tsx`：增 username state/useEffect/校验/JSX/create body/edit body；email 改可选与可编辑；`formValid` 重写；标题用 username。
3. **Verify**：`pnpm tsc --noEmit`（或项目既有 lint/typecheck 命令）无类型错误；`pnpm lint` 无新增 warning；手动打开 drawer 验证字段与禁用态。完整测试在 task-09 落地、task-10 跑全绿。

## 8. 验收标准

| 编号 | 验收点 | 验证方式 |
|---|---|---|
| AC-1 | `lib/admin.ts` `UserRead.email: string \| null`、`UserCreateRequest.username: string`(必填)、`UserCreateRequest.email?: string \| null`、`UserUpdateRequest.username?: string`、`UserUpdateRequest.email?: string \| null`、`UserRead.username: string` | 读改后文件 / `tsc --noEmit` 通过 |
| AC-2 | drawer create 模式显示「登录名」必填字段，缺失或 <3 位时保存禁用并红字提示 | 手动 / task-09 测试 |
| AC-3 | drawer create 模式 email 改非必填，留空可保存；非空格式错才阻断 | 手动 / task-09 测试 |
| AC-4 | drawer edit 模式 username 可编辑（非 isSelf 受限场景） | 手动 / task-09 测试 |
| AC-5 | create body 含 `username`、`email`（空传 null）；edit body 在值变化时传 `username`/`email` | 读代码 / 网络请求断言（task-09） |
| AC-6 | username 唯一冲突（后端 409）时，表单底部红字回显错误，不清空输入 | 手动 / task-09 模拟 reject |
| AC-7 | `formValid = usernameValid && emailValid && passwordValid`；password 仅 create 必填 | 读代码 |
| AC-8 | isSelf 保护逻辑（超管/登录开关 disabled）不变 | 读代码 diff，确认未动 |
| AC-9 | drawer 标题 edit 模式显示 `编辑用户 ${username}` | 手动 |
| AC-10 | `tsc --noEmit` + `lint` 对两文件无新增错误 | 命令行执行 |
