---
author: WhaleFall
created_at: 2026-06-18T09:35:00
---

# task-07：picker 测试适配三级结构

## 修改文件

- [ ] 修改 `frontend/src/components/__tests__/admin-role-permission-picker.test.tsx`

## 必读依据

- 设计文档 §5.4 Picker 重组 + §5.7 测试修改清单：
  `F:\WorkNew\SillyHub\.sillyspec\changes\2026-06-18-menu-driven-permissions\design.md`
- 需求 FR-08（三级渲染）/ FR-09（全选交互）/ FR-10（折叠独立）：
  `requirements.md`
- 现有测试（识别可复用断言风格）：`frontend/src/components/__tests__/admin-role-permission-picker.test.tsx`
- 当前 picker 实现（确认 props 接口）：`frontend/src/components/admin-role-permission-picker.tsx`
- MENU_PERMISSION_GROUPS 数据（design §5.2，task-03 创建）：`frontend/src/lib/menu-permissions.ts`

## 现有测试识别（保留 vs 重写）

**保留的代码风格**：

- `import { describe, expect, it, vi } from "vitest"` + `@testing-library/react` + `fireEvent/render/screen`
- 用 `screen.getByText(/中文/)` 做正则匹配中文 label
- 用 `screen.getByLabelText("user:read")` 直接查 permission checkbox（aria-label）
- 用 `.closest("label")!.querySelector("input[type=checkbox]")` 在 group 行内取 checkbox
- 用 `onChange.mock.calls[0]![0]` 取实际调用参数

**完全重写**：

- 删除所有 6 大组 label 断言（"平台" / "管理（用户/组织/角色）" / "Workspace" / "Agent / 代码 / 部署 / 工具" / "变更" / "审计"）
- 删除 `import { PERMISSION_GROUPS } from "@/lib/admin"`（若有）
- 改为按 section → menuLabel → permission 三级查询

## 实现要求

### import 改造

```typescript
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";

import { AdminRolePermissionPicker } from "@/components/admin-role-permission-picker";
import { MENU_PERMISSION_GROUPS } from "@/lib/menu-permissions";
```

> 严禁 `import { PERMISSION_GROUPS } from "@/lib/admin"`，验收时 grep 验证。

### 测试用例清单（共 17 个，>14 阈值）

#### A. 渲染结构（5 个）

1. **`renders 4 sections in fixed order`**

   ```typescript
   const sections = ["总览", "管理", "系统管理", "系统"]; // 实际 label 以 task-06 实现为准
   sections.forEach((label) => {
     expect(screen.getByText(label)).toBeInTheDocument();
   });
   // 顺序断言：取所有 section 标题，比较 index
   const allTitles = screen.getAllByTestId("section-title").map(el => el.textContent);
   expect(allTitles).toEqual(sections);
   ```
   备用：若 task-06 不加 `data-testid`，用 `getAllByRole("heading")`。

2. **`overview section renders 8 menus`**

   ```typescript
   // design §5.2: overview 含 workspaces/components/topology/changes/scan-docs/runtime/knowledge/releases
   ["Workspace 首页", "项目组组件", "拓扑图", "变更中心", "扫描文档", "运行时", "知识 & 日志", "发布"]
     .forEach(label => expect(screen.getByText(label)).toBeInTheDocument());
   ```

3. **`admin section renders 3 menus`**

   ```typescript
   ["用户", "组织", "角色"].forEach(label =>
     expect(screen.getByText(label)).toBeInTheDocument(),
   );
   ```

4. **`system section renders 2 menus`**

   ```typescript
   ["Daemon 运行时", "设置"].forEach(label =>
     expect(screen.getByText(label)).toBeInTheDocument(),
   );
   ```

5. **`menu row shows menuLabel + selected count (X/Y)`**

   ```typescript
   render(<AdminRolePermissionPicker permissions={["user:read"]} onChange={vi.fn()} />);
   // users menu 有 3 个 permission（user:read / user:write / user:login:manage）
   expect(screen.getByText(/用户.*1\/3/)).toBeInTheDocument();
   ```

#### B. 全选交互（5 个）

6. **`all-selected menu shows checked checkbox`**

   ```typescript
   render(<AdminRolePermissionPicker
     permissions={["user:read", "user:write", "user:login:manage"]}
     onChange={vi.fn()} />);
   const usersRow = screen.getByText(/用户.*3\/3/).closest("div")!;
   const cb = usersRow.querySelector("input[type=checkbox]") as HTMLInputElement;
   expect(cb.checked).toBe(true);
   ```

7. **`clicking checked select-all removes all 3 user permissions`**

   ```typescript
   const onChange = vi.fn();
   render(<AdminRolePermissionPicker
     permissions={["user:read", "user:write", "user:login:manage", "organization:read"]}
     onChange={onChange} />);
   const usersRow = screen.getByText(/用户.*3\/3/).closest("div")!;
   fireEvent.click(usersRow.querySelector("input[type=checkbox]")!);
   expect(onChange).toHaveBeenCalledWith(["organization:read"]);
   ```

8. **`partial selection shows indeterminate checkbox`**

   ```typescript
   render(<AdminRolePermissionPicker permissions={["user:read"]} onChange={vi.fn()} />);
   const usersRow = screen.getByText(/用户.*1\/3/).closest("div")!;
   const cb = usersRow.querySelector("input[type=checkbox]") as HTMLInputElement;
   // indeterminate 状态用 aria-checked="mixed" 或 cb.indeterminate 判断
   expect(cb.indeterminate).toBe(true);
   expect(cb.checked).toBe(false);
   ```

9. **`clicking indeterminate select-all adds all 3 user permissions`**

   ```typescript
   const onChange = vi.fn();
   render(<AdminRolePermissionPicker permissions={["organization:read"]} onChange={onChange} />);
   const usersRow = screen.getByText(/用户.*0\/3/).closest("div")!;
   fireEvent.click(usersRow.querySelector("input[type=checkbox]")!);
   const called = onChange.mock.calls[0]![0] as string[];
   expect(called).toEqual(expect.arrayContaining([
     "organization:read", "user:read", "user:write", "user:login:manage",
   ]));
   expect(called).toHaveLength(4);
   ```

10. **`selecting one menu does not affect other menus`**

    ```typescript
    const onChange = vi.fn();
    render(<AdminRolePermissionPicker permissions={[]} onChange={onChange} />);
    // 点击 organizations menu 全选
    const orgRow = screen.getByText(/组织.*0\/2/).closest("div")!;
    fireEvent.click(orgRow.querySelector("input[type=checkbox]")!);
    const called = onChange.mock.calls[0]![0] as string[];
    // 应只含 organization:read / organization:write，不含任何 user:* / role:*
    expect(called).toEqual(["organization:read", "organization:write"]);
    expect(called.some(k => k.startsWith("user:"))).toBe(false);
    expect(called.some(k => k.startsWith("role:"))).toBe(false);
    ```

#### C. 折叠交互（4 个）

11. **`defaults to all menus expanded`**

    ```typescript
    render(<AdminRolePermissionPicker permissions={[]} onChange={vi.fn()} />);
    // 展开后 permission 可见（用 user:read 作为探针）
    expect(screen.getByLabelText("user:read")).toBeInTheDocument();
    expect(screen.getByLabelText("organization:read")).toBeInTheDocument();
    expect(screen.getByLabelText("role:read")).toBeInTheDocument();
    ```
    > 若 task-06 选择默认折叠，本用例改为反向断言（queryByLabelText 返回 null）。**与 task-06 协商后二选一**。

12. **`collapsing one menu does not collapse others`**

    ```typescript
    render(<AdminRolePermissionPicker permissions={[]} onChange={vi.fn()} />);
    // 折叠 users
    const usersToggle = screen.getByLabelText("users").closest("div")!
      .querySelector("button[aria-label]");
    fireEvent.click(usersToggle!);
    // organizations permission 仍可见
    expect(screen.getByLabelText("organization:read")).toBeInTheDocument();
    ```

13. **`collapsed menu hides its permission grid`**

    ```typescript
    render(<AdminRolePermissionPicker permissions={[]} onChange={vi.fn()} />);
    const usersToggle = screen.getAllByRole("button", { name: /折叠|展开/ })[0];
    fireEvent.click(usersToggle);
    // 折叠后 user:read 不可见（若展开则有）
    expect(screen.queryByLabelText("user:read")).toBeNull();
    ```
    > 与用例 11 协调：默认展开 + 折叠 = 不可见；默认折叠 + 展开 = 可见。两者择其一组合。

14. **`expanded permission count matches MENU_PERMISSION_GROUPS data`**

    ```typescript
    // 遍历所有 menu，验证展开后渲染的 permission checkbox 数量正确
    const usersGroup = MENU_PERMISSION_GROUPS.find(g => g.menuKey === "users")!;
    expect(usersGroup.permissions).toHaveLength(3);
    // 渲染后 getByLabelText 数量
    usersGroup.permissions.forEach(p => {
      expect(screen.getByLabelText(p.key)).toBeInTheDocument();
    });
    ```

#### D. 数据源切换（3 个）

15. **`does not import PERMISSION_GROUPS from @/lib/admin`**

    ```typescript
    // 这是一个静态检查用例，无法在 runtime 测，但可在验收阶段 grep 文件确认
    // 用例本身只验证 MENU_PERMISSION_GROUPS 数据可用：
    expect(MENU_PERMISSION_GROUPS).toHaveLength(19);
    expect(MENU_PERMISSION_GROUPS.map(g => g.menuKey))
      .toEqual(expect.arrayContaining(["users", "organizations", "roles"]));
    ```

16. **`renders all 19 menus from MENU_PERMISSION_GROUPS`**

    ```typescript
    render(<AdminRolePermissionPicker permissions={[]} onChange={vi.fn()} />);
    MENU_PERMISSION_GROUPS.forEach(g => {
      expect(screen.getByText(g.menuLabel)).toBeInTheDocument();
    });
    ```

17. **`renders all permissions from MENU_PERMISSION_GROUPS`**

    ```typescript
    render(<AdminRolePermissionPicker permissions={[]} onChange={vi.fn()} />);
    const allKeys = MENU_PERMISSION_GROUPS.flatMap(g => g.permissions.map(p => p.key));
    allKeys.forEach(key => {
      expect(screen.getByLabelText(key)).toBeInTheDocument();
    });
    // 去重后数量验证
    expect(new Set(allKeys).size).toBe(allKeys.length);
    ```

### 与 task-06 的契约约定

为避免与实现联调阶段反复改测试，本任务执行前需向 task-06 落实以下实现细节：

1. **默认展开 vs 默认折叠**：默认全部展开（与现有「分组全展开」语义一致）
2. **section 标题 DOM 结构**：section 标题包在 `<h3 data-testid="section-title">` 内（推荐）或 `<div role="heading">`
3. **menu 行结构**：`<div>` 内含 `<button aria-label="折叠/展开">` + `<input type="checkbox">` + `<span>menuLabel</span>` + `<span>（X/Y）</span>`
4. **permission checkbox**：保留 `aria-label={p.key}` 现有约定
5. **indeterminate 实现**：用原生 `input.indeterminate = true`，并在 `aria-checked="mixed"` 同步（兼容 RTL 查询）

> 若 task-06 实际实现与上述任一不一致，**测试代码以 task-06 为准**，相应调整查询方式（如把 `getByLabelText` 换成 `getByRole("checkbox", { name: ... })`），但断言语义不变。

## 接口定义

无对外接口。本任务只修改测试文件，仅说明 import：

| import 来源 | 用途 |
|---|---|
| `vitest` | `describe/it/expect/vi` |
| `@testing-library/react` | `render/fireEvent/screen/within` |
| `@/components/admin-role-permission-picker` | 被测组件 |
| `@/lib/menu-permissions` | 数据源 `MENU_PERMISSION_GROUPS`（19 条） |

## 边界处理

1. **`permissions` 为空数组**：所有 menu 已选数量显示 `0/Y`，所有全选 checkbox 为未选中（非 indeterminate）。用例 11/13/14/16/17 均覆盖此路径。
2. **`permissions` 含不属于任何 menu 的 key**（如历史脏数据 `"foo:bar"`）：picker 渲染正常，已选数量不受影响。新增用例：
   ```typescript
   it("ignores permission keys not in any menu", () => {
     render(<AdminRolePermissionPicker permissions={["foo:bar"]} onChange={vi.fn()} />);
     MENU_PERMISSION_GROUPS.forEach(g => {
       const row = screen.getByText(new RegExp(g.menuLabel)).closest("div")!;
       const countText = row.textContent!;
       expect(countText).toMatch(/0\/\d+/); // 该 menu 无选中
     });
   });
   ```
3. **onChange mock 调用次数**：每次 click 应只触发 1 次 onChange，用 `expect(onChange).toHaveBeenCalledTimes(1)` 兜底防止重复触发。
4. **indeterminate 状态查询**：RTL 不能直接读 `cb.indeterminate`，需 `cb.indeterminate` 属性访问或 `cb.getAttribute("aria-checked") === "mixed"`。两者都断言更稳。
5. **中文 label 含特殊字符**：用 `getByText` 直接匹配整字符串，不要用正则（避免转义）。如 `getByText("知识 & 日志")`。
6. **MENU_PERMISSION_GROUPS 暂未创建**（task-03 在并行进行）：若本任务先于 task-03 完成，import 会失败。**必须等 task-03 落地后再执行本任务的测试运行步骤**，但测试代码可先写好。
7. **菜单数量 8/6/3/2 假设**：依据 design §5.2 推导，若 task-03 实际数据分布不同（如 `incidents` 移到其他 section），按实际 `MENU_PERMISSION_GROUPS` 调整用例 2/3/4 的预期数字，但用例总数不变。

## 非目标

- 不测试 `hasAnyPermission` / `canSeeMenu` / `visibleMenusBySection`（task-04 负责 `permission.test.ts`）
- 不测试 `MENU_PERMISSION_GROUPS` 数据完整性（menuKey 唯一性、key 命中后端枚举）（task-03 负责 `menu-permissions.test.ts`）
- 不测试实际保存到后端（picker 是受控组件，只验 onChange 调用）
- 不测试 Ant Design / shadcn 内部行为
- 不测试 disabled prop 的样式（已被现有用例 6 覆盖，可保留一个简化版）
- 不测试 className 透传（与三级结构无关）
- 不修改 `admin-role-permission-picker.tsx`（task-06 负责）

## TDD 步骤

1. **前置**：确认 task-03（menu-permissions.ts）与 task-06（picker 实现）已合入或并行进行中。
2. **读现有测试**：已完成，识别出可复用的 `getByLabelText` / `.closest("label")` / `onChange.mock.calls[0]![0]` 风格。
3. **重写 import**：删除 `@/lib/admin` 引用（若有），新增 `@/lib/menu-permissions`。
4. **重写渲染结构用例（A 组，5 个）**：替换原 "renders 6 group panels"。
5. **重写全选用例（B 组，5 个）**：在原 "group-level select-all" 基础上拆细到 menu 粒度。
6. **新增折叠用例（C 组，4 个）**：原测试无折叠覆盖。
7. **新增数据源完整性用例（D 组，3 个）**：保证 19 menu 全渲染。
8. **跑测试**：`cd frontend && pnpm test admin-role-permission-picker`。预期 task-06 未完成时部分用例 fail（用例 1-13 依赖实现），task-06 完成后全绿。
9. **故障注入验证**：故意改 task-06 的 `toggleMenuAll` 让"取消全选"漏移除一个 key（如少 filter `user:login:manage`），跑用例 7 应 fail。
10. **恢复**：撤销故障注入，重跑确认全绿。
11. **grep 验收**：`grep -nE "PERMISSION_GROUPS|@/lib/admin" frontend/src/components/__tests__/admin-role-permission-picker.test.tsx` 无匹配（menu-permissions import 不算）。

## 验收标准

| 验收项 | 通过标准 |
|---|---|
| 测试文件存在 | `frontend/src/components/__tests__/admin-role-permission-picker.test.tsx` |
| 用例数 ≥ 14 | 实际 17 个（5 渲染 + 5 全选 + 4 折叠 + 3 数据源） |
| 全部通过 | `cd frontend && pnpm test admin-role-permission-picker` exit code 0（task-06 完成后） |
| 数据源迁移 | `grep -nE "PERMISSION_GROUPS" frontend/src/components/__tests__/admin-role-permission-picker.test.tsx` 无匹配 |
| 无 `@/lib/admin` import | `grep -n "@/lib/admin" frontend/src/components/__tests__/admin-role-permission-picker.test.tsx` 无匹配 |
| 严格类型 | `grep -nE ":\s*any\b|as any" frontend/src/components/__tests__/admin-role-permission-picker.test.tsx` 无匹配 |
| 中文断言 | 用例使用 `getByText("中文 label")` 而非 ID 查询，保证 UI 文案可见性 |
| 覆盖 FR-08/09/10 | 渲染（FR-08）/ 全选（FR-09）/ 折叠独立（FR-10）三组场景各 ≥ 3 用例 |
