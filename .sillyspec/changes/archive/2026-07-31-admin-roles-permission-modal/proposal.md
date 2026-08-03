---
author: WhaleFall
created_at: 2026-07-31T15:00:54
---

# 提案（Proposal）— /admin/roles 新建弹窗 + 权限选择左树右权

## 动机

`/admin/roles` 新建/编辑角色现为右侧抽屉,权限选择(`AdminRolePermissionPicker`)把 38 个 menu **默认全展开**,垂直拉得很长(页面权限多时尤其),560px 抽屉里需大量滚动,选态总览不直观。

## 方案概述（方案 B，原型已确认）

- 新建/编辑:**右侧抽屉 → 居中弹窗(Modal)**。
- 权限选择:**左 section/menu 树 + 右当前 menu 权限面板**(transfer 风格),高度固定不再拉长;左树每节点带选中数 `(n/m)`,右面板含全选。
- 复用:section/menu 数据源、toggle 逻辑、pickerHidden 规则;picker props 契约不变(仅 /admin/roles 用,无共用兼容负担)。

## 范围

- 改:2 前端文件(admin/roles page 的 RoleDrawer → Modal;admin-role-permission-picker 重写左树右权)+ 测试。
- 不改:后端角色/权限 API、menu-permissions 数据结构、其他页面。

## 不在范围内（Non-Goals）

- 不改后端 API / menu-permissions 数据
- 不做权限搜索(YAGNI,左树已可快速定位)
- 不改权限 key 集合 / pickerHidden 规则
- 不改其他页面( picker 仅 /admin/roles 用)

## 规模

**large**(重写 picker 交互 + 抽屉换 Modal,跨组件 + 交互设计)。走 plan。
