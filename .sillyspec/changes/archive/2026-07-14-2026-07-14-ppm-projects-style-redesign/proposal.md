---
author: WhaleFall
created_at: 2026-07-14 10:51:14
---

# 提案书（Proposal）

> 变更 `2026-07-14-ppm-projects-style-redesign` · 纯样式调整

## 动机

`/ppm/projects` 页及其依赖的两个共享组件（`PpmResourceTable` / `PpmProjectMembersTable`）虽已部分消费前端样式系统地基（`PageContainer`/`DataTable`/`Button` 等），但仍存在大量与「现代明亮活力」规范脱节的硬编码与手写实现。本次把这些规范化，让 5 个 ppm 页面（项目/客户/干系人/项目成员/成员管理抽屉）统一达标。

## 关键问题

1. **状态色与 token 脱节**：项目已有 `StatusBadge`（带圆点 pill，5 语义色）却未被 ppm 使用，状态/类型仍用 antd `Tag` 预设色（`processing`/`success`/`geekblue`），语义不通、视觉不统一。
2. **5 处手写浮层**：编辑表单 / 删除确认 / 成员管理全是 `fixed inset-0 z-40/50 bg-black/30` 手写遮罩 + `✕` emoji 关闭 + 原生 `<select>`/`<input>`，无焦点陷阱 / 无障碍 / 进出动画，且点遮罩即关、易丢失已填表单。
3. **toast 硬编码色**：`border-emerald-300 bg-emerald-50 text-emerald-700` 散落 4 处（两个组件各 2 处）。

## 变更范围

- **PpmResourceTable**：select 字段渲染 StatusBadge/Tag 分支（`statusKind`/`color`）；2 处浮层换 antd Drawer/Modal（`maskClosable={false}`）；toast/error 语义化；`project_name` 列加粗；搜索区按钮分组（数据组左 / 基础组最右），布局不动。
- **PpmProjectMembersTable**：2 处浮层换 antd Drawer/Modal（`maskClosable={false}`）；角色 `Tag` → `Badge`/token 色；toast/error 语义化。
- **projects/page.tsx**：状态枚举加 `statusKind`，类型 `color` 改 token 预设名；成员管理抽屉换 antd Drawer。

## 不在范围内（显式清单）

- 不改业务逻辑 / API / 数据流 / 字段定义
- 不改 antd Table / Pagination / Form / Select 本体
- 不改 AppShell / 侧边栏 / 顶栏（样式系统 P5 已落地）
- 不引入新 npm 依赖（antd 6 / radix / lucide 均已装）
- 搜索区布局完全保持现状（按钮行在字段上方右对齐 + 4 列网格 + 展开收起）
- 不动 customers 的 `striped` 斑马纹选项
- 不做暗色模式 / 移动端响应式

## 成功标准（可验证）

- ppm 范围内 grep 不到 `bg-black/30`、emoji `✕` 关闭按钮、`emerald-300` 硬编码色
- 项目状态列 = 带圆点 pill（进行中蓝 / 已完成绿 / 已暂停橙）；类型列 = Tag 色块（研发蓝 / 实施青 / 运维灰）
- 编辑/删除/成员管理浮层均为 antd Drawer/Modal，点遮罩不关，ESC / 关闭按钮可关
- 4 个 ppm 列表页 + 成员管理抽屉功能不回归（CRUD / 搜索 / 导出）
- `tsc --noEmit` + `pnpm lint` 通过；Docker rebuild 后实测核心页与原型视觉对照
