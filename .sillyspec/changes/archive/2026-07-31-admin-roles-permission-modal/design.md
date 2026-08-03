---
author: WhaleFall
created_at: 2026-07-31T14:59:27
scale: large
risk_level: unit-sufficient
---

# 设计文档（Design）— /admin/roles 新建弹窗 + 权限选择左树右权

> 变更 `2026-07-31-admin-roles-permission-modal` · 方案 B（原型已确认）

## 1. 背景

`/admin/roles` 新建/编辑角色现为右侧**抽屉(Drawer)** + `AdminRolePermissionPicker` 把 38 个 menu **默认全展开**(`admin-role-permission-picker.tsx:29-31` `new Set(MENU_PERMISSION_GROUPS.map(g=>g.menuKey))`),每 menu 卡片 grid 2-3 列权限 checkbox 垂直堆叠 → 页面权限多时**拉得很长**,560px 抽屉里需大量滚动,选态总览不直观。

**用户决策**(原型对比 A/B/C 后):选**方案 B 左树右权(transfer)**。

## 2. 设计目标

- 新建/编辑:**右侧抽屉 → 居中弹窗(Modal)**。
- 权限选择:**左 section/menu 树 + 右当前 menu 权限面板**(transfer 风格),**高度固定**不再拉长;左树带每个 menu 选中数(`n/m`)+ 总览选中态。
- 保留:Key/名称/描述字段、保存/取消底栏、系统角色只读、权限 key 校验等现有逻辑不变。

## 3. 非目标（Non-Goals）

- ❌ 不改后端角色/权限 API 或 menu-permissions 数据结构(只改前端 picker 呈现)
- ❌ 不改其他页面(admin/users 等)的权限选择(若有共用组件,通过 prop 兼容,默认行为不变)
- ❌ 不做"跨 menu 批量/搜索"(YAGNI,左树已可快速定位;搜索留待后续)
- ❌ 不改权限 key 集合 / pickerHidden 规则

## 4. 总体方案（方案 B）

### 4.1 新建/编辑:抽屉 → Modal

`admin/roles/page.tsx` 的 `RoleDrawer`(:441-520)改为 antd `Modal`(居中,宽度 720 给左树右权留分栏空间):
- 外壳:`<Modal open title width={720} onCancel onOk>`,替代自定义 `fixed right-0 w-560` 抽屉。
- 字段(Key/名称/描述)逻辑不变;底栏保存/取消走 Modal footer(antd Modal `onOk`/`onCancel`,保留 saving/disabled/canWrite 守卫)。
- Modal body 内嵌权限选择区(左树右权)。

### 4.2 权限选择:左树右权(重写 AdminRolePermissionPicker)

`admin-role-permission-picker.tsx` 重写为左右分栏(高度固定,如 `h-[420px]`):

```
┌─ 左树(200px,可滚) ──┬─ 右权限面板(1fr,可滚) ──┐
│ WORKSPACE          │ ▶ 项目成员  全选(3/3)     │
│  工作区首页  0/3    │   ☑ 查看 project:read     │
│ ▶项目成员*  3/3(sel)│   ☑ 新增 project:create   │
│  里程碑      2/5    │   ☑ 删除 project:delete   │
│  知识库      0/4    │                          │
│ SYSTEM             │                          │
│  角色        7/7    │                          │
│  …                 │                          │
└────────────────────┴───────────────────────────┘
```

- **左树**:按 `MENU_SECTION_ORDER` 分组(section 标题 + menu 节点)。每节点显示 `menuLabel` + 选中数 `(n/m)`;当前选中 menu 高亮;跳过 `pickerHidden` 的 menu(同现状:162-164)。点击节点 → 右面板切换该 menu 权限。menu 选中数 0 时灰显数字。
- **右面板**:顶部 menu 名 + "全选 (n/m)" checkbox(indeterminate 支持);下方该 menu 的权限 checkbox 列表(name + key),复用现有 `togglePermission`/`toggleMenuAll` 逻辑。
- 默认选中**第一个非空 menu**(或第一个 menu),避免右面板空。
- 高度固定(`h-[420px] overflow-hidden`,左右各自 `overflow-y-auto`),**整体不再随 menu 数拉长**。

### 4.3 复用与兼容

- 数据源不变:`MENU_SECTION_ORDER` / `MENU_SECTION_LABEL` / `MENU_PERMISSION_GROUPS`(menu-permissions.ts)。
- 选中态逻辑不变:`permissions`/`onChange`/`togglePermission`/`toggleMenuAll`(picker 内部)。
- `disabled`/`pickerHidden` 语义不变。
- 共用风险:AdminRolePermissionPicker 若被其他页面用(grep 确认),prop 契约(permissions/onChange/disabled)不变 → 调用方零改动,仅视觉变(左树右权)。若仅 /admin/roles 用,无兼容负担。

## 5. 文件变更清单（File Changes）

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | frontend/src/app/(dashboard)/admin/roles/page.tsx | RoleDrawer(:441-520)抽屉 → antd Modal(居中 w-720) |
| 修改 | frontend/src/components/admin-role-permission-picker.tsx | 重写为左树(section/menu)+ 右权限面板(transfer),高度固定 |
| 新增 | frontend/src/components/__tests__/admin-role-permission-picker-tree.test.tsx | 左树切换/全选/indeterminate/选中数/默认选第一个 menu 测试 |
| 删除 | frontend/src/components/__tests__/admin-role-permission-picker.test.tsx | 旧 picker 全展开卡片测试,被 tree test 替代(左树右权交互不同) |

## 6. 接口定义

```ts
// AdminRolePermissionPicker props 不变(prop 契约兼容,仅内部重写为左树右权)
interface AdminRolePermissionPickerProps {
  permissions: string[];
  onChange: (_next: string[]) => void;
  disabled?: boolean;
  className?: string;
}
```

## 7. 生命周期契约

生命周期契约：不涉及/N/A。本次只改 `/admin/roles` 前端**新建/编辑弹窗形态 + 权限选择交互**(抽屉→Modal、平铺→左树右权),**不涉及 lease / session / agent_run / runtime 的状态机或状态转换**,不改角色/权限后端 API 或 menu-permissions 数据结构。纯前端呈现改动,无生命周期事件。

## 8. 风险登记（Risk）

- **R1(中) 共用 picker 兼容**:AdminRolePermissionPicker 若被其他页面用,左树右权重写改变视觉(prop 不变)。缓解:grep 确认调用方;prop 契约不变 → 调用方零改;若有视觉依赖需回归测试。
- **R2(低) 左树小屏拥挤**:720 Modal 内左树 200 + 右面板,窄屏可能挤。缓解:左树固定 200px 可滚,右面板 flex-1;Modal 720 在桌面端足够。
- **R3(低) 默认选中 menu**:右面板初始空不好。缓解:默认选中第一个非 pickerHidden menu(或第一个有选中的 menu)。
- **R4(低) Modal vs 抽屉交互差异**:Modal 居中遮罩,抽屉右侧滑出。保存/取消/onClose 逻辑复用,仅外壳换。

## 9. 自审（Self-Review）

- ✅ 覆盖需求:抽屉→Modal + 权限左树右权(高度固定解决太长)
- ✅ 改动集中:2 前端文件(page + picker)+ 测试;后端 0 改、menu-permissions 数据 0 改
- ✅ 复用:section/menu 数据源、togglePermission/toggleMenuAll 逻辑、pickerHidden 规则
- ✅ prop 契约不变(picker 兼容)
- ✅ 生命周期契约不涉及(纯前端)
- ⚠️ 待 execute 确认:picker 是否被其他页面共用(grep);antd Modal 替换抽屉的 form/校验迁移;左树默认选中策略

## 10. 决策与方案选择（Decision Tracking）

| 决策 ID | 标题 | 选项（✅采纳 / ❌否决） | 覆盖位置 |
|---|---|---|---|
| D-001@v1 | 新建形态:抽屉 → 居中 Modal | ✅ antd Modal w-720(替代自定义右侧抽屉);❌ 保留抽屉;❌ 全屏 | §4.1 |
| D-002@v1 | 权限选择:左树右权(方案 B,用户原型确认) | ✅ 左 section/menu 树 + 右权限面板(高度固定);❌ A 折叠+搜索(改动最小但用户未选);❌ C tab 切 section | §4.2 |
| D-003@v1 | picker prop 契约不变(兼容共用) | ✅ permissions/onChange/disabled 不变,仅内部重写;调用方零改 | §4.3、§6 |
| D-004@v1 | 后端 / menu 数据 0 改 | 只改前端 picker 呈现,角色/权限 API 与 menu-permissions 结构不动 | §3 |
