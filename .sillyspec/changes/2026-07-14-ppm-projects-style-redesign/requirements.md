---
author: WhaleFall
created_at: 2026-07-14 10:51:14
---

# 需求规格（Requirements）

> 变更 `2026-07-14-ppm-projects-style-redesign` · 纯样式调整

## 角色

| 角色 | 说明 |
|---|---|
| 项目管理员 | 使用 `/ppm/projects` 维护项目主数据，关注状态/类型可读性、表单不被误关 |
| 只读用户 | 查看项目列表（`canWrite=false` 时隐藏增删改） |

## 功能需求

### FR-01: 项目状态用 StatusBadge 渲染

覆盖决策：D-003@v1, D-004@v1

Given projects 页项目状态字段 option 配置了 `statusKind`
When 表格渲染状态列
Then 显示带圆点 pill（进行中=info蓝 / 已完成=success绿 / 已暂停=warning橙）

Given 状态 option 无 `statusKind`、仅有 `color`
When 渲染状态列
Then 退化为 antd Tag（向后兼容，不影响 customers/stakeholders 现有配置）

### FR-02: 项目类型用 antd Tag 渲染

覆盖决策：D-003@v1, D-004@v1

Given 类型字段 `color` 为 `blue` / `cyan` / `default`
When 渲染类型列
Then 显示对应色块 Tag（研发=blue / 实施=cyan / 运维=default 灰）

Given `color="default"`
When 渲染
Then 显示无 color 的默认灰 `<Tag>`（非 antd 自定义色字符串）

### FR-03: 浮层换 antd Drawer/Modal 且点遮罩不关

覆盖决策：D-002@v1, D-006@v1

Given 用户打开编辑抽屉 / 删除确认 / 成员管理抽屉
When 点击遮罩层（mask）
Then 弹窗**不**关闭（`maskClosable={false}`）

When 点击右上角 `✕` / 底部「取消」/ 按 ESC
Then 弹窗关闭

Given projects 页点「成员管理」打开外层 Drawer，内嵌成员表
When 在成员表内点「编辑成员」
Then 内层 Drawer/Modal 正常打开，z-index 高于外层，ESC 关最上层（R-06）

### FR-04: toast / error 提示语义化

覆盖决策：D-005@v1

Given 操作成功 / 失败
When 显示 toast
Then 用语义色（success=emerald / error=red），无硬编码 `emerald-300`/`bg-emerald-50`

### FR-05: 搜索区布局保持现状

覆盖决策：D-006@v1

Given 搜索字段数 > 4
When 渲染搜索区
Then 操作按钮行在字段**上方右对齐**（数据组：导出/新增 在左；基础组：查询/重置/展开 在**最右**；中间分隔线）；字段 4 列网格显示前 4 个 + 「展开」按钮

Given 搜索字段数 ≤ 4
When 渲染搜索区
Then 不显示「展开」按钮（`showExpandToggle` 逻辑不变）

### FR-06: project_name 列加粗

覆盖决策：G3（Design Grill）

When 表格渲染项目名称列
Then `project_name` 文字加粗（font-medium），项目编号独立成列、不加粗

## 非功能需求

- **兼容性**：`PpmFieldOption.statusKind` / `color="default"` 为新增可选字段，不传时渲染逻辑与现状一致；`customers` 的 `striped` / `serverSidePagination` 等现有 props 不变。
- **可回退**：浮层改动可在 git 历史回退；select 渲染保留「无 statusKind 无 color → 纯文本」兜底。
- **可测试**：grep 验证无残留硬编码；`tsc`/`pnpm lint`；Docker rebuild 实测。
- **跨平台**：纯前端，兼容 Windows / Linux / macOS（无平台相关改动）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | 全部 FR | 范围含两个共享组件（5 页面） |
| D-002@v1 | FR-03 | 浮层用 antd Drawer/Modal |
| D-003@v1 | FR-01, FR-02 | 状态 StatusBadge / 类型 Tag |
| D-004@v1 | FR-01, FR-02 | 状态/类型色彩映射 |
| D-005@v1 | （约束） | 不引入新依赖 |
| D-006@v1 | FR-03, FR-05 | 浮层遮罩不关 + 搜索区布局不变 + 按钮分组 |
