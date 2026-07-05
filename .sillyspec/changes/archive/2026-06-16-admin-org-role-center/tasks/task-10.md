---
id: task-10
title: 前端 /admin/organizations 页面 + 组织树组件
priority: P1
estimated_hours: 5
depends_on: [task-07, task-08]
blocks: [task-12]
allowed_paths:
  - frontend/src/app/(dashboard)/admin/organizations/page.tsx
  - frontend/src/components/admin-organization-tree.tsx
author: WhaleFall
created_at: 2026-06-16T15:40:00
---

# task-10: 前端 /admin/organizations 页面 + 组织树组件

实现组织管理页面（左树 + 右详情面板 + 编辑 Drawer）+ 递归组织树组件。

## 修改文件

| # | 路径 | 操作 | 说明 |
|---|---|---|---|
| 1 | `frontend/src/app/(dashboard)/admin/organizations/page.tsx` | 新增 | 完整页面：左树 + 右详情 + 编辑 Drawer + 删除 confirm |
| 2 | `frontend/src/components/admin-organization-tree.tsx` | 新增 | 递归渲染组织树，支持展开/折叠、节点选中、状态徽标 |

## 实现要求

### R-01: organizations/page.tsx 页面结构

- `"use client"` 顶级指令
- import：`useEffect` / `useState` / `useMemo` / `useSession` / `lib/admin` 的 `listOrganizations` `getOrganization` `createOrganization` `updateOrganization` `deleteOrganization` `disableOrganization` `enableOrganization` + types + `AdminOrganizationTree` + shadcn/ui 组件
- 三大状态：
  - `orgs: OrganizationRead[]` — 全树扁平数据（拉取一次，前端构树）
  - `selectedId: string | null` — 当前选中节点
  - `drawerState: { open: boolean; mode: "create" | "edit"; org?: OrganizationRead; parentId?: string | null }`
- 布局（CSS Grid 或 Flex）：
  - 左侧 40% 宽：组织树（含搜索框 + 「新建顶级组织」按钮）
  - 右侧 60% 宽：选中组织的详情面板
- 顶部工具栏：
  - 搜索框（按 name/code 实时过滤树节点 + 高亮匹配）
  - 「新建顶级组织」按钮（持 `organization:write` 可见）
- 左侧树：组件 `<AdminOrganizationTree nodes={tree} selectedId={selectedId} onSelect={setSelectedId} />`，节点点击后右侧详情更新
- 右侧详情面板（无选中时显示空状态「请从左侧选择一个组织」）：
  - 顶部：name + status 徽标 + member_count + children_count
  - 字段列表：code / description / parent_id（指向父组织名）/ sort_order / created_at / updated_at
  - 操作按钮：「编辑」「新建子组织」「禁用/启用」「删除」（均受 `organization:write` 控制）
- 编辑 Drawer（create / edit 共用）：
  - name 输入（必填 max 100）
  - code 输入（必填，pattern `^[a-z][a-z0-9_]*$`）
  - description 文本域
  - parent_id select（下拉显示树形结构，可选「无（顶级）」；编辑模式时不可指向自身或后代）
  - status radio（active / disabled，编辑模式可见）
  - sort_order 数字输入
- 删除 confirm：「确定删除组织 {name}？该操作不可恢复。子组织和关联用户需先清空。」

### R-02: admin-organization-tree.tsx 组件

- 接收 props：
  ```typescript
  interface AdminOrganizationTreeProps {
    nodes: OrganizationRead[];              // 扁平列表（含 parent_id）
    selectedId: string | null;
    onSelect: (id: string) => void;
    searchKeyword?: string;                 // 高亮匹配节点
  }
  ```
- 内部构树：`useMemo` 把扁平 `nodes` 转成嵌套 `{ node: OrganizationRead; children: TreeNode[] }`
- 递归组件 `<TreeNode>`：
  - 展开/折叠箭头（有 children 时显示）
  - 节点名称（搜索时高亮 `<mark>` 标签）
  - status 徽标（active 蓝色「启用」/ disabled 灰色「禁用」）
  - member_count 小徽标（如 `(12)`）
  - 选中态高亮（背景色变化）
- 交互：
  - 点击节点 → onSelect(id)
  - 点击箭头 → 展开/折叠（默认根节点展开）
  - 搜索时所有含匹配的节点自动展开（即使父节点折叠）

### R-03: 数据流

- 页面 mount → `listOrganizations(accessToken)` → setOrgs（扁平列表）
- selectedId 变化 → useEffect 调 `getOrganization(accessToken, id)` 获取详情（含 children）
- 「新建顶级组织」→ `setDrawerState({open:true, mode:"create", parentId:null})`
- 节点详情面板「新建子组织」→ `setDrawerState({open:true, mode:"create", parentId:org.id})`
- Drawer 提交：
  - create → `createOrganization(accessToken, {...body, parent_id: drawerState.parentId})` → toast「组织已创建」+ 关闭 Drawer + 重新 list + 自动选中新节点
  - edit → `updateOrganization(accessToken, org.id, body)` → toast「组织已更新」+ 关闭 Drawer + 重新 list
- 禁用/启用：confirm → `disableOrganization(accessToken, id)` / `enableOrganization(accessToken, id)` → toast + 重新 list
- 删除：confirm → `deleteOrganization(accessToken, id)` → 成功后清空 selectedId + 重新 list；失败（409 ORGANIZATION_HAS_CHILDREN / ORGANIZATION_IN_USE）→ toast 显示具体数字

### R-04: 权限检查

- `canWrite = user.permissions?.includes("organization:write") || user.is_platform_admin`
- 所有写操作按钮 `disabled={!canWrite}`

## 接口定义

### 页面组件签名

```typescript
export default function AdminOrganizationsPage(): JSX.Element;
```

### AdminOrganizationTree 组件签名

```typescript
interface AdminOrganizationTreeProps {
  nodes: OrganizationRead[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  searchKeyword?: string;
  defaultExpandedIds?: string[];   // 默认展开的节点 id（可选）
}
export function AdminOrganizationTree(props: AdminOrganizationTreeProps): JSX.Element;
```

### 调用的 lib/admin 函数

| 函数 | 触发时机 |
|---|---|
| `listOrganizations(accessToken)` | 页面 mount + 增删改后刷新 |
| `getOrganization(accessToken, id)` | selectedId 变化 |
| `createOrganization(accessToken, body)` | Drawer create 提交 |
| `updateOrganization(accessToken, id, body)` | Drawer edit 提交 |
| `disableOrganization(accessToken, id)` / `enableOrganization(accessToken, id)` | 详情面板操作 |
| `deleteOrganization(accessToken, id)` | confirm dialog |

## 边界处理

1. **空树（无组织）**：左侧显示「暂无组织，点击右上角新建」+ 空状态插画；右侧隐藏详情面板
2. **深层嵌套**：树递归无层数限制，缩进通过 CSS padding-left 实现（每层 16px）
3. **循环引用防护**：update parent_id 时校验 `parent_id !== org.id` 且 `parent_id` 不在自身后代集合（前端先校验，后端二次校验）
4. **删除占用拒绝（children）**：deleteOrganization 抛 409 ORGANIZATION_HAS_CHILDREN → toast `该组织有 ${details.children_count} 个子组织，需先删除子组织`
5. **删除占用拒绝（member）**：抛 409 ORGANIZATION_IN_USE → toast `该组织有 ${details.member_count} 个关联用户，需先移除用户`
6. **搜索高亮**：输入框实时（无 debounce）过滤树；匹配节点和其所有祖先节点自动展开；不匹配的节点隐藏
7. **selectedId 不存在**：list 刷新后若 selectedId 不在新列表中（如被删除），自动清空 + 右侧显示空状态
8. **parent_id select 校验**：编辑模式 select 选项排除自身和自身后代（前端过滤）；提交时再校验
9. **code 重复**：createOrganization 抛 409 ORGANIZATION_CODE_DUPLICATE → toast `code "${values.code}" 已存在`；表单字段下方也显示错误
10. **parent_id 不存在**：createOrganization 抛 404 ORGANIZATION_PARENT_NOT_FOUND → toast `父组织不存在`（理论上前端 select 不会出此情况，但兜底）
11. **status radio disabled**：create 模式不显示 status（默认 active）；edit 模式显示并可改
12. **token 缺失**：accessToken 为空 → useEffect 跳过，layout 已重定向
13. **disabled 组织在树中的视觉**：灰色文字 + 灰色徽标，但仍可点击查看详情

## 非目标

- 不实现后端 API（task-05 范围）
- 不实现 lib/admin.ts 客户端（task-08 范围）
- 不实现 admin/layout.tsx 鉴权（task-07 范围）
- 不实现组织成员管理子页面（仅显示 member_count 数字）
- 不实现拖拽排序（sort_order 仅通过编辑表单修改）
- 不实现组织级角色（仅平台级角色，design §3 明确排除）
- 不实现数据权限（行级/列级过滤）
- 不实现组织导入 / 导出

## 参考

- `prototype-admin-center.html` 组织页原型
- `design.md` §7.2 组织管理接口
- `requirements.md` FR-07 / FR-08 / FR-09 组织管理完整 CRUD + 边界
- `lib/admin.ts` task-08 产出的类型 + 函数
- shadcn/ui Collapsible / Badge / Drawer / Dialog / Select / Input / RadioGroup 现有组件

## TDD 步骤

1. **写树组件单测**：`admin-organization-tree.test.tsx` 覆盖：
   - 渲染扁平数据为嵌套树
   - 点击节点 → onSelect(id)
   - 点击展开/折叠箭头 → 子节点显示/隐藏
   - selectedId 高亮对应节点
   - searchKeyword 过滤 + 高亮 + 自动展开祖先
   - status 徽标 active/disabled 颜色区分
2. **写页面集成测试**：`admin/organizations/__tests__/page.test.tsx` 覆盖：
   - mock listOrganizations 返回 5 节点树 → 渲染左树 + 右空状态
   - 点击树节点 → 右侧详情面板显示
   - 点击「新建子组织」→ Drawer 打开 + parent_id 默认为当前节点
   - 提交 createOrganization → 成功后 toast + 关闭 Drawer + list 重新调用
   - 删除占用场景：mock 返回 409 → toast 含 children_count
   - 编辑 parent_id=自身 → 表单校验失败
3. **跑测试失败**：`pnpm test -- admin-organization-tree admin/organizations` 全红
4. **实现树组件**：按 R-02
5. **实现页面**：按 R-01 / R-03 / R-04
6. **跑测试通过**：所有测试绿
7. **手动验证**：`pnpm dev`，platform_admin 登录：
   - 创建根组织 HQ
   - HQ 下新建子组织 Engineering / QA
   - Engineering 下新建 Frontend / Backend
   - 选中 Engineering 查看详情（children_count=2 / member_count=0）
   - 编辑 Engineering 改 name → 列表更新
   - 删除 Frontend（无子无成员）→ 成功
   - 删除 Engineering（有子）→ 失败 + toast `该组织有 1 个子组织`
   - 删除 HQ（有子）→ 失败

## 验收标准

| # | 验证步骤 | 通过标准 |
|---|---|---|
| AC-01 | 访问 `/admin/organizations` | 左侧显示树（含根组织），右侧显示「请从左侧选择」 |
| AC-02 | 创建根组织 HQ | 树新增 HQ 节点 + 自动选中 + 右侧显示详情 |
| AC-03 | HQ 详情面板点击「新建子组织」 | Drawer 打开，parent_id 默认指向 HQ |
| AC-04 | 创建子组织 Engineering（parent_id=HQ） | 树在 HQ 下方新增 Engineering（缩进显示） |
| AC-05 | 点击 HQ 节点的展开/折叠箭头 | 子节点显示/隐藏 |
| AC-06 | 搜索框输入「eng」 | 树过滤+高亮 Engineering，自动展开 HQ；不匹配的 QA 折叠 |
| AC-07 | 编辑 Engineering 改 name + sort_order | updateOrganization 调用成功，树 + 详情同步刷新 |
| AC-08 | 编辑 Engineering 选 parent_id=自身 | 表单校验失败，提示「不能选择自身或后代作为父组织」 |
| AC-09 | 禁用 Engineering | disableOrganization 成功，树节点变灰 + status 徽标变「禁用」 |
| AC-10 | 启用 Engineering | enableOrganization 成功，恢复 active |
| AC-11 | 删除 Engineering（有子组织 Frontend/Backend） | 失败 409 + toast `该组织有 2 个子组织，需先删除子组织` |
| AC-12 | 删除 HQ（有子 + 关联用户） | 失败 409 + toast 显示 children_count 或 member_count |
| AC-13 | 删除无子无成员的 Frontend | 成功 204，树节点消失，selectedId 清空，右侧显示空状态 |
| AC-14 | 创建组织时 code 与现有冲突 | 失败 409 + toast `code "xxx" 已存在` |
| AC-15 | 无 organization:write 的用户访问 | 树可见 + 详情可见，但所有写按钮 disabled |
| AC-16 | code 输入非法（如 `Eng_1` 或 `1eng`） | 表单校验失败，提交按钮 disabled |
| AC-17 | 深层嵌套（5 层）树渲染正常 | 每层缩进 16px，无视觉错乱 |
| AC-18 | `pnpm test -- admin-organization-tree admin/organizations` | 全部测试绿 |
| AC-19 | `pnpm typecheck` + `pnpm build` | 0 错误 |
