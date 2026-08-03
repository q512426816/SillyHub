---
author: WhaleFall
created_at: 2026-07-31T15:00:54
---

# 需求（Requirements）— /admin/roles 新建弹窗 + 权限左树右权

## 功能需求

### FR-01 新建/编辑:抽屉 → Modal
新建/编辑角色从右侧抽屉改为**居中弹窗(antd Modal)**,宽度 720(给左树右权留分栏)。Key/名称/描述字段、保存/取消、系统角色只读、权限校验逻辑不变。
- 验收:点"新建角色"/"编辑"打开居中 Modal(非右侧抽屉);字段/校验/保存行为与改前一致。

### FR-02 权限选择:左树右权(transfer)
权限区改为**左 section/menu 树 + 右当前 menu 权限面板**:
- 左树按 MENU_SECTION_ORDER 分组(section 标题 + menu 节点),每节点显示 `menuLabel` + 选中数 `(n/m)`;当前选中 menu 高亮;跳过 pickerHidden。
- 右面板:顶部 menu 名 + "全选 (n/m)" checkbox(indeterminate 支持);下方该 menu 权限 checkbox 列表(name + key)。
- 点击左树节点 → 右面板切换该 menu。
- 验收:左树总览所有 menu + 选中数;点节点右面板切权限;全选/单选/indeterminate 正确。

### FR-03 高度固定不拉长
权限选择区**高度固定**(如 h-[420px]),左右各自 overflow-y-auto,整体不再随 menu 数垂直拉长。
- 验收:menu 多时 Modal 内权限区高度固定,仅左右内部滚动。

### FR-04 默认选中 menu
右面板初始默认选中**第一个非 pickerHidden menu**(或第一个有选中的 menu),避免空白。
- 验收:打开 Modal 右面板非空(显第一个 menu 的权限)。

### FR-05 后端 / menu 数据 0 改
只改前端 picker 呈现,角色/权限 API 与 menu-permissions 数据结构不动。
- 验收:后端无改动;menu-permissions.ts 不动。

## 约束

- picker props 契约不变(permissions/onChange/disabled/className),仅内部重写
- 复用 MENU_SECTION_ORDER/MENU_SECTION_LABEL/MENU_PERMISSION_GROUPS + togglePermission/toggleMenuAll 逻辑
- 不改权限 key 集合 / pickerHidden 规则
- 保存/校验/只读逻辑迁移自现有 RoleDrawer,行为不变
