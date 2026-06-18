---
author: WhaleFall
created_at: 2026-06-18T09:35:00
---

# task-06：AdminRolePermissionPicker 三级渲染重构

> Wave 3 / 优先级 P0 / 前置依赖：task-01（menu-permissions.ts）。本任务为 W3 内首个执行，task-05（admin.ts 清理）反向依赖本任务，必须等 task-06 切换完 picker 数据源后才能删 PERMISSION_GROUPS export
> 关联设计：`design.md` §5.4（Picker 重组）、§5.1（数据结构）
> 关联需求：`requirements.md` FR-08（三级渲染）、FR-09（全选交互）、FR-10（折叠状态独立）

## 修改文件

- [ ] 修改 `frontend/src/components/admin-role-permission-picker.tsx`

## 现状摘要（核对依据）

读取当前 `frontend/src/components/admin-role-permission-picker.tsx`（共 145 行）核心事实：

- 数据源：从 `@/lib/admin` 导入 `PERMISSION_GROUPS`（6 大类，每类一个 `PermissionGroup` 字面量 + `permissions: PermissionWithGroup[]`）
- 折叠状态：`useState<Set<PermissionGroup>>`，初始全展开（构造时把 6 个 group key 全 add 进 Set）
- 全选逻辑：`toggleGroupAll(group, allKeys)` —— 全选时合并 Set 去重，取消时 `filter` 移除
- 渲染结构（单层）：

```
<div className="space-y-2">
  {PERMISSION_GROUPS.map(g => (
    <div className="rounded-md border ...">
      <div className="flex items-center gap-2 px-3 py-2">
        <button onClick={toggleGroupExpanded}>▼/▶</button>
        <label>
          <input type="checkbox" checked={allSelected} onChange={toggleGroupAll} />
          <span>{GROUP_LABEL[g.group]}</span>
          <span>（{selectedCount}/{keys.length}）</span>
        </label>
      </div>
      {isExpanded && (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3">
          {g.permissions.map(p => <label>...<input aria-label={p.key} />...</label>)}
        </div>
      )}
    </div>
  ))}
</div>
```

- 现有测试锚点：`screen.getByLabelText("user:read")` 定位单 permission；通过 group 文本 `.closest("label")` 定位全选 checkbox。

## 实现要求

### 数据源切换

- 新增 import：`import { MENU_PERMISSION_GROUPS, MENU_SECTION_ORDER, MENU_SECTION_LABEL, type MenuSection, type MenuPermissionGroup } from "@/lib/menu-permissions"`
- 删除 import：`PERMISSION_GROUPS` / `PermissionGroup`（来自 `@/lib/admin`）
- 删除旧常量：`GROUP_LABEL`（旧的 6 大类中文标题，整段移除）
- 组件中所有对 `g.group` / `PermissionGroup` 的引用改为 `g.section` / `g.menuKey` / `MenuSection`

### 渲染结构（section → menu → permission 三层）

整体外层 wrapper 沿用现有 `<div className="space-y-2 ...">`，内部由单层 `PERMISSION_GROUPS.map` 改为嵌套两层：

```
<div className="space-y-4 ...">  // section 之间留更大间距
  {MENU_SECTION_ORDER.map(section => {
    const menus = MENU_PERMISSION_GROUPS.filter(g => g.section === section);
    if (menus.length === 0) return null;  // 防御性
    return (
      <section key={section} data-section={section}>
        <div className="section-title">{MENU_SECTION_LABEL[section]}</div>
        <div className="space-y-2">
          {menus.map(menu => renderMenu(menu))}
        </div>
      </section>
    );
  })}
</div>
```

要点：

- **section 标题**：直接渲染 `MENU_SECTION_LABEL[section]`（"Overview" / "Management" / "系统管理" / "System"），样式参考现有 `<span className="text-xs font-medium">`，可加 `text-muted-foreground uppercase tracking-wide` 做分组标题视觉。
- **section 容器**：用语义化 `<section>` 标签 + `data-section` 属性便于测试定位。
- **menu 行容器**：保留现有 `<div className="rounded-md border border-border bg-card">` 卡片样式，`key={menu.menuKey}`。
- **menu 头部**：保留现有 `<div className="flex items-center gap-2 px-3 py-2">` 横向布局。

### menu 行内容

每个 menu 行（即原 group panel）：

```
<div className="flex items-center gap-2 px-3 py-2">
  <button type="button" onClick={() => toggleMenuExpanded(menu.menuKey)} aria-label={isExpanded ? "折叠" : "展开"}>
    {isExpanded ? "▼" : "▶"}
  </button>
  <label className="flex flex-1 cursor-pointer items-center gap-2">
    <input
      type="checkbox"
      checked={allSelected}
      ref={el => { if (el) el.indeterminate = isIndeterminate }}  // 关键：半选态
      disabled={disabled || keys.length === 0}
      onChange={() => toggleMenuAll(menu)}
      aria-label={`${menu.menuLabel} 全选`}
    />
    <span className="text-xs font-medium">{menu.menuLabel}</span>
    <span className="text-[11px] text-muted-foreground">（{selectedCount}/{keys.length}）</span>
  </label>
</div>
```

要点：

- **折叠按钮**：沿用现有 `▼/▶` 文本图标，`aria-label` 中文。
- **全选 checkbox**：
  - 必须支持 `indeterminate` 半选状态。原生 `<input type="checkbox">` 不能用 `indeterminate` prop（React 限制），需要用 `ref` 在 effect 或 ref 回调里设置 `el.indeterminate = isIndeterminate`。
  - 当 `keys.length === 0` 时禁用（虽然 task-01 已保证 19 条 menu 全部 ≥1 permission，但边界处理仍保留）。
  - `aria-label` 改为 `"{menuLabel} 全选"` 以避免与单个 permission 的 `aria-label` 冲突（旧实现用 group label 文本定位，新实现也保留这条测试路径）。
- **menuLabel**：从 `MENU_PERMISSION_GROUPS[*].menuLabel` 读取，不再用 GROUP_LABEL 映射。
- **已选数量**：`（{selectedCount}/{keys.length}）` 沿用现有格式。`selectedCount` = `keys.filter(k => permissions.includes(k)).length`。

### permission grid（展开后）

沿用现有样式，零改动：

```
{isExpanded && (
  <div className="grid gap-1.5 border-t border-border bg-background/40 px-3 py-2 sm:grid-cols-2 lg:grid-cols-3">
    {menu.permissions.map(p => {
      const checked = permissions.includes(p.key);
      const inputId = `perm-${p.key.replace(/[^a-zA-Z0-9]/g, "-")}`;
      return (
        <label key={p.key} htmlFor={inputId} className={...}>
          <input id={inputId} type="checkbox" checked={checked} disabled={disabled}
                 onChange={() => togglePermission(p.key)} aria-label={p.key} />
          <div>
            <span>{p.name}</span>
            <span className="font-mono">{p.key}</span>
          </div>
        </label>
      );
    })}
  </div>
)}
```

注意：`p.key`（permission key，如 `user:read`）必须保留为 `aria-label`，task-07 测试依赖该锚点。

### 折叠状态

```typescript
const [expandedMenus, setExpandedMenus] = useState<Set<string>>(
  () => new Set(MENU_PERMISSION_GROUPS.map(g => g.menuKey))  // 默认全展开，与现状一致
);

const toggleMenuExpanded = (menuKey: string) => {
  setExpandedMenus(prev => {
    const next = new Set(prev);
    if (next.has(menuKey)) next.delete(menuKey);
    else next.add(menuKey);
    return next;
  });
};
```

要点：

- **默认全展开**：与现有实现一致，避免破坏既有用户体验和 task-07 的展开态断言。
- **key 类型**：从 `PermissionGroup` 改为 `string`（即 `menuKey`）。
- **独立性**：`toggleMenuExpanded` 只动一个 key，不影响其他 menu（FR-10）。这一点是直接由 Set 操作语义保证的，但 task-07 会专门测。

### 全选逻辑

```typescript
const toggleMenuAll = (menu: MenuPermissionGroup) => {
  if (disabled) return;
  const keys = menu.permissions.map(p => p.key);
  if (keys.length === 0) return;
  const allSelected = keys.every(k => permissions.includes(k));
  if (allSelected) {
    // 已全选 → 移除该 menu 全部 key（不影响其他 menu / 不属于该 menu 的 key）
    const removing = new Set(keys);
    onChange(permissions.filter(p => !removing.has(p)));
  } else {
    // 未全选（含完全空选 + 部分选中）→ 加入该 menu 全部 key
    const merged = new Set([...permissions, ...keys]);
    onChange([...merged]);
  }
};
```

要点：

- **判定全选**：用 `every`，不能用 `selectedCount === keys.length` 配合空数组（空数组也满足，但 task-01 已保证非空）。
- **取消全选**：`filter` 严格只移除 `keys` 集合中的项，保留不属于该 menu 的 key（即使它们是脏数据，见边界 2）。
- **全选合并**：`Set` 去重，避免重复 key。

### 单选 togglePermission（沿用）

```typescript
const togglePermission = (key: string) => {
  if (disabled) return;
  if (permissions.includes(key)) {
    onChange(permissions.filter(p => p !== key));
  } else {
    onChange([...permissions, key]);
  }
};
```

零改动，但需在 menu 渲染时确保 `disabled` 传递到单个 permission checkbox（沿用现状）。

### onChange 调用约定

- 任何 checkbox 变更后，调用 `props.onChange(newSelectedKeys: string[])`。
- 数组顺序：单选时新 key 追加到末尾；全选时通过 `Set` 合并，迭代顺序由插入顺序决定（先 permissions 后 keys），不强约束排序。
- 不主动去重整个数组（只去重新加入的 key），保留调用方传入的任何 key（含脏数据）。

### indeterminate 状态判定

```typescript
const isMenuIndeterminate = (menu: MenuPermissionGroup): boolean => {
  const keys = menu.permissions.map(p => p.key);
  if (keys.length === 0) return false;
  const selectedCount = keys.filter(k => permissions.includes(k)).length;
  return selectedCount > 0 && selectedCount < keys.length;
};
```

通过 ref 在渲染后设置：

```typescript
const checkboxRef = (el: HTMLInputElement | null) => {
  if (el) el.indeterminate = isMenuIndeterminate(menu);
};
// ...
<input ref={checkboxRef} ... />
```

或者用 `useEffect` + `useRef` 数组，但 ref callback 更简洁，无 effect 开销。

## 接口定义

```typescript
import { useState } from "react";
import {
  MENU_PERMISSION_GROUPS,
  MENU_SECTION_ORDER,
  MENU_SECTION_LABEL,
  type MenuSection,
  type MenuPermissionGroup,
} from "@/lib/menu-permissions";

interface AdminRolePermissionPickerProps {
  /** 当前已选 permission key 数组（可包含脏数据，渲染层忽略未匹配项） */
  permissions: string[];
  /** 任意 checkbox 变更回调，传入新的 permission key 数组 */
  onChange: (_next: string[]) => void;
  /** 全局禁用 */
  disabled?: boolean;
  /** 容器额外 className */
  className?: string;
}

// 内部状态
// expandedMenus: 已展开的 menuKey 集合，默认全展开
type ExpandedMenusState = Set<string>;

// section 顺序常量直接复用 MENU_SECTION_ORDER（无需本地再定义）
// section 标题直接复用 MENU_SECTION_LABEL
```

旧本地常量 `GROUP_LABEL: Record<PermissionGroup, string>` 整段删除。

## 边界处理

1. **menu.permissions 为空**：task-01 已保证 19 条 menu 全部 ≥1 permission，但渲染层仍要防御性处理 —— 当 `keys.length === 0` 时，禁用全选 checkbox（`disabled={disabled || keys.length === 0}`），`aria-label` 仍输出，已选数量显示 `（0/0）`，permission grid 渲染为空。不抛错。
2. **selected 包含不属于任何 menu 的 key**（脏数据）：渲染层只比对 `keys.filter(k => permissions.includes(k))`，脏数据不影响 `selectedCount` 与 `allSelected` 判定，也不会被全选/取消全选操作误删。`onChange` 输出的数组保留脏数据原样。理由：picker 不负责清洗，只负责呈现与编辑，调用方（`admin-roles` 页面）如需清洗可自行处理。
3. **同时勾选多个 menu 的全选**：每个 menu 的 `toggleMenuAll` 独立调用 `onChange`，互不干扰。例如先全选 `users`（onChange 传 3 个 user:*），再全选 `roles`（onChange 传 3 个 user:* + 2 个 role:*）。两个回调串行触发，调用方依次接收。
4. **section 切换不丢失折叠状态**：`expandedMenus` 是 `useState`，section 重渲染只是 `.filter` 重排，不重置 Set。即使 `MENU_PERMISSION_GROUPS` 数据更新（task-01 不会动态变），Set 中已存在的 menuKey 仍生效。FR-10 要求"切换 menu A 不影响 menu B"，本设计天然满足。
5. **props.permissions 为 undefined**：TypeScript 接口已声明为 `string[]` 非可选，但运行时防御 —— 在组件入口加 `const selected = permissions ?? [];`，后续全用 `selected` 替代 `permissions` 读取，避免 `permissions.includes` 抛错。`onChange` 仍透传给调用方。
6. **disabled 状态下点全选**：`toggleMenuAll` 入口 `if (disabled) return;`，与现有逻辑一致。原生 checkbox 也 `disabled={disabled}` 双保险。
7. **同 menuKey 重复**：task-01 测试已保证 menuKey 唯一。渲染层用 `menuKey` 作为 React `key`，若数据异常重复会触发 React warning 但不崩。

## 非目标

本任务 **不做** 以下事情（留给后续 task 或拒绝范围扩张）：

- ❌ 不改 picker 的视觉样式（颜色 / 边距 / 字体 / 卡片圆角 / grid 列数全部沿用）
- ❌ 不实现搜索 / 过滤功能（picker 没有搜索框，未来如需另起变更）
- ❌ 不实现权限分类的拖拽排序（19 个 menu 顺序固定由 `MENU_PERMISSION_GROUPS` 数组顺序决定）
- ❌ 不引入新的 Ant Design 组件（除现有原生 `<input type="checkbox">` + 折叠按钮外，不引入 `antd` 的 `Checkbox.Group` / `Collapse` / `Tree`，避免重写样式）
- ❌ 不写测试（task-07 负责 picker 测试改写）
- ❌ 不改 `admin-roles` 页面调用方（picker 的 props 接口零变更）
- ❌ 不动 `@/lib/admin.ts`（task-05 负责 PERMISSION_GROUPS 删除，但本任务必须先停止 import 它，否则 task-05 删除时会编译失败）

## TDD 步骤

### 步骤 1：先看 task-07 测试期望

读取 `frontend/src/components/__tests__/admin-role-permission-picker.test.tsx`（task-07 与本任务并行开发），核对：

- 测试用 `screen.getByText("系统管理")` 定位 section 标题
- 测试用 `screen.getByLabelText("user:read")` 定位单 permission（必须保留）
- 测试用 `screen.getByText(/3\/3/)` 或类似格式定位 menu 已选数量（注意 `users` menu 共 3 个 permission）
- 测试用 `screen.getByRole("button", { name: /折叠|展开/ })` 或 `.closest("label")` 定位全选 checkbox
- 测试用 `data-section="admin"` 或类似属性定位 section 容器

⚠️ 与 task-07 同步对齐：若 task-07 测试有特殊定位要求（如 indeterminate 断言），本任务的 ref callback / aria-label / data-* 属性必须配合。

### 步骤 2：改数据源（保持现有渲染结构能跑通）

- 替换 import：删 `PERMISSION_GROUPS` / `PermissionGroup`，加 `MENU_PERMISSION_GROUPS` / `MENU_SECTION_ORDER` / `MENU_SECTION_LABEL` / `MenuSection` / `MenuPermissionGroup`
- 临时把 `PERMISSION_GROUPS.map(g => ...)` 改成 `MENU_PERMISSION_GROUPS.map(g => ...)`（仍是单层，先编译过）
- 把 `g.group` → `g.menuKey`，`g.permissions` 字段不变（task-01 已对齐 `PermissionItem` 结构）
- 删除 `GROUP_LABEL`，临时用 `g.menuLabel` 替代
- 跑 `pnpm typecheck` 应该能过（但渲染层还不是三层，先确保不破坏编译）

### 步骤 3：重写渲染层（section → menu → permission）

- 外层改为 `MENU_SECTION_ORDER.map(section => ...)` 嵌套 `MENU_PERMISSION_GROUPS.filter(g => g.section === section).map(menu => ...)`
- 加 section 标题 div
- menu 卡片样式零改动，但 `key={menu.menuKey}`
- 跑 `pnpm typecheck` 应过

### 步骤 4：实现折叠状态 + 全选逻辑

- `useState<Set<string>>` 替换旧的 `Set<PermissionGroup>`
- `toggleMenuExpanded(menuKey: string)` 替换 `toggleGroupExpanded`
- `toggleMenuAll(menu: MenuPermissionGroup)` 替换 `toggleGroupAll(group, allKeys)`，内部从 `menu.permissions` 取 keys
- 实现 `isMenuIndeterminate` + ref callback 设置 `el.indeterminate`

### 步骤 5：跑 task-07 测试

```bash
pnpm test admin-role-permission-picker
```

应全绿。如有失败，对照失败 case 修正 aria-label / data-section / 文本格式。

### 步骤 6：跑 typecheck

```bash
pnpm typecheck
```

应无错。重点检查：

- 是否还有 `PermissionGroup` / `PERMISSION_GROUPS` 残留引用（grep 一遍）
- 是否有任何 `any`
- ref callback 类型 `(el: HTMLInputElement | null) => void` 是否正确

## 验收标准

| 验收项 | 通过标准 |
|---|---|
| 数据源切换 | `import` 只来自 `@/lib/menu-permissions`，`@/lib/admin` 不再被本文件引用（grep `from "@/lib/admin"` 在 picker.tsx 中应无匹配） |
| 三级渲染 | DOM 中能定位到 `section[data-section] > div > div[card] > div[grid] > label[permission]` 三层结构；4 个 section 全部渲染（即使某 section menu 全部不可见也保留 section 标题，因为 picker 是编辑场景不是导航） |
| section 顺序 | overview → management → admin → system，与 `MENU_SECTION_ORDER` 一致 |
| section 标题 | 4 个标题分别匹配 `MENU_SECTION_LABEL` 的 4 个值 |
| menu 卡片样式 | 沿用 `rounded-md border border-border bg-card`，视觉零变化 |
| 折叠独立 | 切换 menu A 折叠状态后，menu B 的展开/折叠状态保持原样（FR-10） |
| 全选 indeterminate | menu 部分选中时 checkbox 显示横线（`el.indeterminate === true`）；全选显示勾；空选不显示勾也不显示横线 |
| 全选合并 | 未全选点击全选 → 加入该 menu 全部 key，不影响其他 menu / 其他 key |
| 取消全选 | 已全选点击全选 → 仅移除该 menu 的 key，其他 menu / 脏数据 key 保留 |
| 已选数量 | 显示 `（X/Y）` 格式，X 为该 menu 已选数，Y 为该 menu `permissions.length` |
| 单选 onChange | 勾选单个 permission → `onChange(["...原数组", "newKey"])`；取消 → `onChange(原数组.filter(...))` |
| disabled 全局生效 | `disabled={true}` 时所有 checkbox `disabled === true`，点击不触发 `onChange` |
| aria-label 保留 | 单 permission 的 `aria-label={p.key}` 必须保留，否则 task-07 测试断点 |
| 类型严格 | 无 `any`，无 `@ts-ignore`，`pnpm typecheck` 通过 |
| 旧常量删除 | 本文件内 `GROUP_LABEL` / `PermissionGroup` 类型注解 / `PERMISSION_GROUPS` 全部清除 |
