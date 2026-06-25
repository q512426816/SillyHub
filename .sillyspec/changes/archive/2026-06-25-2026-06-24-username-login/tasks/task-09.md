---
id: task-09
title: 前端测试 — admin-user-drawer.test.tsx 登录名必填、email 可选用例更新
priority: P1
depends_on: [task-06]
blocks: []
decision_ids: []
requirement_ids: [SC-1]
allowed_paths: [frontend/src/components/__tests__/admin-user-drawer.test.tsx]
author: WhaleFall
created_at: 2026-06-25T08:43:50
---

# task-09 — admin-user-drawer.test.tsx 登录名必填 / email 可选 测试更新

## 1. 覆盖来源

- `design.md` §3 Phase 4（前端测试段：「drawer 登录名必填校验、email 可选」）、§3 Phase 5、§4 验收标准 1（新建必填登录名、email 可不填）与 5（非空 email 唯一，多空共存）。
- `decisions.md`：D-001@v1（纯登录名登录）、D-004@v1（username 可编辑、唯一冲突友好报错）。
- `plan.md` Wave 4 / 任务表 task-09（覆盖 SC-1）、依赖关系图（task-06 → task-09）。
- `task-06.md` 已锁定的新表单契约（本任务测试必须对齐）：
  - 新增 state `username`；`useEffect` edit 回填 `user.username ?? ""`、create 清空。
  - `usernameValid = username.trim().length >= 3`（必填、最小长度 3，对齐后端 `Field(min_length=3)`）。
  - `emailValid = email.trim() === "" || EMAIL_PATTERN.test(email)`（空合法；非空才校验格式）。
  - `passwordValid = mode === "edit" || password.length >= 8`。
  - `formValid = usernameValid && emailValid && passwordValid`。
  - 「登录名」字段 `aria-label="登录名"`、缺失/过短时红字「登录名至少 3 位」。
  - 「邮箱」字段 `aria-label="邮箱"`、label 改「邮箱（可选）」、edit 也可编辑、非空格式错红字「邮箱格式不合法」。
  - create body：`{ username, email: email.trim() || null, password, ... }`。
  - edit body：仅值相对原值变化时透传 `username` / `email`。
  - `onSubmit` reject 时 `setError(err.message)`，error 红字回显，不清空输入。

## 2. 修改文件

| 文件 | 改动 |
|---|---|
| `frontend/src/components/__tests__/admin-user-drawer.test.tsx` | 1) `makeUser` 工厂补 `username` 字段（默认 `"alice"`）、`email` 改可空（默认 `"alice@example.com"`）。2) 既有用例对齐新表单：原「create 提交」用例从填 email+password 改为填 username+password（email 留空也合法），断言 body 含 `username`。3) 新增 5 个用例（见 §4）。4) 保持现有渲染/mock 风格（`render` + `screen` + `fireEvent` + `waitFor`，`onSubmit: vi.fn().mockResolvedValue(undefined)`）。 |

> 仅改一个测试文件，不动被测组件 `admin-user-drawer.tsx`（task-06 范围）与 `lib/admin.ts` 类型。

## 3. 实现要求

### 3.1 测试栈与风格（沿用现有）

- 框架：`vitest`（`describe` / `it` / `expect` / `vi`）。
- 渲染：`@testing-library/react` 的 `render` / `screen` / `fireEvent` / `waitFor`。
- 断言保存按钮禁用：`screen.getByText("保存")` 取 `HTMLButtonElement`，断言 `.disabled`。
- 触发输入：`fireEvent.change(screen.getByLabelText("登录名"), { target: { value: "alice" } })`。
- mock `onSubmit`：`vi.fn().mockResolvedValue(undefined)`（成功）；冲突用例用 `vi.fn().mockRejectedValue(new Error("登录名已被占用"))`。
- mock 数据：沿用 `makeOrg` / `makeRole` / `makeUser` / `baseProps`（见现状文件 11-66 行）；`baseProps.organizations` / `roles` 已提供，无需真实 API。

### 3.2 工厂与 baseProps 调整

```tsx
function makeUser(overrides: Partial<UserRead> = {}): UserRead {
  return {
    id: "u1",
    username: "alice",                 // 新增：UserRead 现含 username（task-06 类型已补）
    email: "alice@example.com",        // 兼容：UserRead.email 现为 string | null
    display_name: "Alice",
    status: "active",
    is_platform_admin: false,
    login_enabled: true,
    last_login_at: null,
    created_at: "",
    organizations: [],
    roles: [],
    ...overrides,
  };
}
```

> `baseProps` 不变（`onClose` / `onSubmit` / `organizations` / `roles` / `canWrite` / `canLoginManage` / `currentUserId`）。

## 4. 接口定义 — 测试用例清单

> 覆盖 SC-1（登录名必填、email 可选）。每个用例独立 `render`，不相互依赖。

| 用例 ID | it 描述 | 步骤 | 断言 |
|---|---|---|---|
| `test_username_required_create` | "create mode disables submit when username empty or too short" | create 模式渲染；不填 username（仅填合法 password）→ 取保存按钮；再填 username=`"ab"`（<3 位）→ 取保存按钮；再改为 `"alice"` → `waitFor` 保存启用 | 空/过短时 `submitBtn.disabled === true`；填 ≥3 位后 `submitBtn.disabled === false` |
| `test_username_editable` | "edit mode allows editing username field" | edit 模式渲染 `makeUser({ username: "alice" })`；取「登录名」输入框（`getByLabelText("登录名")`） | 初始 `value === "alice"`；`fireEvent.change` 改为 `"alice2"` 后 `value === "alice2"`；输入框 `disabled === false`（非 isSelf 场景） |
| `test_email_optional` | "create mode allows empty email and submits without email" | create 模式；填 username=`"bob"`、password=`"Password1!"`、email 留空；`waitFor` 保存启用；点击保存 | `submitBtn.disabled === false`；`onSubmit` 被调用；`body.username === "bob"`；`body.email` 为 `null` 或 `undefined`（空传 null，`expect(body.email).toBeFalsy()`） |
| `test_email_format_when_present` | "create mode validates email format only when email is non-empty" | create 模式；填 username=`"bob"`、password=`"Password1!"`；分三步：① email 留空 → 保存启用；② email=`"bad-email"` → 保存禁用 + 出现「邮箱格式不合法」；③ email=`"bob@example.com"` → 保存启用 + 红字消失 | 空 → `!disabled`；非法 → `disabled && screen.getByText("邮箱格式不合法")`；合法 → `!disabled && queryByText(...) === null` |
| `test_username_conflict_error_display` | "create mode displays error and keeps input when onSubmit rejects" | create 模式；`onSubmit = vi.fn().mockRejectedValue(new Error("登录名已被占用"))`；填 username=`"alice"`（撞已存在）、password=`"Password1!"`；点击保存；`waitFor` error 出现 | `screen.getByText("登录名已被占用")` 在文档中；「登录名」输入框仍保留 `value === "alice"`（未清空，便于改后重试）；`onSubmit` 被调用一次、`body.username === "alice"` |

> 既有用例调整（非新增，但必须同步）：
> - 原 `"create mode renders email + password + display_name fields"`：增断言「登录名」字段存在（`screen.getByText("登录名")` 或 `getByLabelText("登录名")`）。
> - 原 `"create submit is disabled when email invalid or password too short"`：rename 为 `"create submit is disabled when username missing or password too short"`，断言空表单保存禁用（此时 username 缺失 + password 缺失双因）。
> - 原 `"create submit calls onSubmit with form body"`：改为填 username=`"bob"` + password=`"Password1!"`（email 留空合法），断言 `body.username === "bob"`、`body.password === "Password1!"`。
> - 原 `"edit mode pre-fills fields from user"`：`makeUser` 已带 username，可补断言「登录名」输入框 `value === "alice"`。

## 5. 边界处理（≥5 条）

1. **mock organizations / roles**：复用 `baseProps.organizations`（`makeOrg("o1","Acme","acme")`）与 `roles`（`makeRole("r1","editor","Editor")`），不依赖真实 API；现有 `"organizations checkbox toggles selection"` 用例保持不变。
2. **create vs edit 模式**：每个用例显式传 `mode="create"` 或 `mode="edit"`；edit 用例必须传 `user`（`makeUser(...)`），create 用例不传 `user`。
3. **password 仅 create 必填**：`test_email_optional` / `test_email_format_when_present` 中 create 模式必须填合法 password（≥8 位），否则 `formValid` 因 password 失败而非被测字段失败；edit 用例不涉及 password。
4. **不依赖真实 API**：`onSubmit` 全程 mock（resolve 或 reject）；`test_username_conflict_error_display` 用 `mockRejectedValue(new Error("登录名已被占用"))` 模拟后端 409，验证前端 `setError(err.message)` 回显路径，不触达网络层。
5. **异步等待**：所有涉及「保存按钮启用/禁用」「onSubmit 调用」「error 出现」的断言用 `waitFor` 包裹，避免 React state 更新竞态。
6. **输入不清空**：冲突用例断言输入框值仍保留（`value === "alice"`），覆盖 task-06 §4.3「不清空用户输入，便于修改后重试」契约。
7. **email 空传 null**：`test_email_optional` 断言 `body.email` 为 falsy（`null` 或 `undefined`，task-06 实现 `email.trim() || null`），覆盖 SC-1「email 可不填」。
8. **aria-label 稳定**：所有取输入框用 `getByLabelText("登录名")` / `getByLabelText("邮箱")`，与 task-06 JSX 的 `aria-label` 对齐；不依赖 label 文本含「*」或「（可选）」的格式细节（这些可能随样式调整）。

## 6. 非目标

- 不改被测组件 `admin-user-drawer.tsx`（task-06 范围）。
- 不改 `lib/admin.ts` 类型（task-06 范围）。
- 不测试 `admin/users/page.tsx` 列表「登录名」列与展示切换（task-07 范围）。
- 不测试 `login/page.tsx` 文案与默认回填（task-07 范围）。
- 不测试后端 409 真实响应（后端测试在 task-08）；本任务仅用 `mockRejectedValue` 模拟 reject 路径。
- 不引入新 mock 网络层（msw / fetch mock）；沿用 `onSubmit` props 注入风格。
- 不测 username 正则格式（前端仅最小长度 ≥3，与后端对齐；无额外格式约束）。
- 不重写现有未受影响用例（如 `self-edit shows banner`、`disabled canWrite disables submit`、`organizations checkbox toggles selection`、`edit mode hides password field` 保持原样，仅因 `makeUser` 增字段而自动兼容）。

## 7. 参考

- `design.md` §3 Phase 4 / Phase 5、§4 验收标准 1/2/5。
- `decisions.md` D-001@v1（纯登录名登录）、D-004@v1（username 可编辑、冲突报错）。
- `plan.md` task-09 行（覆盖 SC-1）、依赖关系图（task-06 → task-09）。
- `task-06.md` §3.2 / §3.3 / §4（新表单契约：formValid、aria-label、错误文案、create/edit body、409 回显）。
- 现状：`frontend/src/components/__tests__/admin-user-drawer.test.tsx:1-197`（现有测试风格、`makeUser`/`baseProps` 模式）。
- 测试栈：`vitest` + `@testing-library/react`（项目既有，`frontend/package.json`）。

## 8. TDD 步骤

1. **Red（本任务先行或与 task-06 并行）**：先落测试用例 → 跑 `pnpm test admin-user-drawer` 应失败（因 task-06 未实现 username 字段 / email 可选）。若 task-06 已合并，则直接进 Green。
2. **Green**：
   - 改 `makeUser` 工厂补 `username`。
   - 同步 3 个既有用例（renders / disabled / submit with body）。
   - 新增 5 个用例（见 §4 表格）。
   - 跑 `pnpm test admin-user-drawer` 全绿。
3. **Verify（task-10 统一跑）**：
   - `pnpm test`（前端全量）全绿。
   - `pnpm tsc --noEmit` 无类型错误（`UserRead.username` / `email: string | null` 由 task-06 提供）。
   - `pnpm lint` 无新增 warning。

## 9. 验收标准

| 编号 | 验收点 | 验证方式 |
|---|---|---|
| AC-1 | `makeUser` 工厂返回含 `username` 字段，`email` 兼容 `string \| null` | 读改后测试文件 |
| AC-2 | `test_username_required_create`：username 空 / <3 位保存禁用，≥3 位启用 | `pnpm test admin-user-drawer` 该用例通过 |
| AC-3 | `test_username_editable`：edit 模式「登录名」输入框可改、初始回填 `user.username` | 同上 |
| AC-4 | `test_email_optional`：create 模式 email 留空可保存，`body.email` 为 falsy | 同上 |
| AC-5 | `test_email_format_when_present`：email 空合法、非空非法阻断 + 红字、改合法后恢复 | 同上 |
| AC-6 | `test_username_conflict_error_display`：onSubmit reject 时 error 红字回显、输入框值保留 | 同上 |
| AC-7 | 既有用例（renders / disabled / submit with body / pre-fills / self-edit / canWrite / org toggle / hides password）同步后仍通过 | `pnpm test admin-user-drawer` 全绿 |
| AC-8 | 不依赖真实 API：`onSubmit` 全程 mock，无网络调用 | 读测试代码（无 fetch/apiClient import） |
| AC-9 | `pnpm test admin-user-drawer` 全绿，无 skipped / todo 用例 | 命令行执行 |
| AC-10 | 覆盖 SC-1（登录名必填、email 可选）可追溯到本任务用例 | 用例清单 §4 与 SC-1 映射 |
