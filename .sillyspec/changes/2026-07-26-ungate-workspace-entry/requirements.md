---
author: qinyi
created_at: 2026-07-26 14:22:00
---

# 需求规格（Requirements）— 工作区入口门禁后移

## 角色

| 角色 | 说明 |
|---|---|
| 工作区成员（含 business_member） | 工作区成员资格即进入权；有无 daemon 都能进、看文档 |
| 开发人员（lender / 自有 daemon） | 在概览 WorkspaceConfigCard 配自己 daemon（跑自有 agent + 标 shared 借出） |
| 平台管理员 | 可进任何工作区（查文档/审计） |
| 业务/管理人员（borrower） | 已可借（daemon-borrow）；本变更让其与普通成员一样进门无感 |

## 功能需求

### FR-01: 进门自由化（4 入口点）
覆盖决策：D-001, D-004
Given 用户是某工作区成员（或平台管理员）
When 用户在列表页 / 顶栏 switcher / 移动端点击该工作区
Then 直接导航/切换进入工作区（不弹 daemon 绑定 Dialog），与有无 binding 无关

Given 用户非该工作区成员（且非平台管理员）
When 点击该工作区
Then 不可进（后端 membership 鉴权拒绝，前端不展示或引导）

### FR-02: Guard 降级（不再阻断详情页）
覆盖决策：D-004
Given 成员进入工作区详情页
When 成员未绑定 daemon（unbound）
Then WorkspaceBindingGuard 不渲染绑定表单（return null），详情页内容（tabs/概览/文档）正常展示，不阻断

Given 成员已绑定 daemon
When 进入详情页
Then guard 显示"编辑我的接入配置"按钮（原行为，零回归）

### FR-03: 概览 binding 配置（复用既有 WorkspaceConfigCard）
覆盖决策：D-002
Given 成员在工作区概览页
When 成员未绑定 daemon
Then 概览的 WorkspaceConfigCard 渲染首次绑定引导（含 WorkspaceAccessGuide），作为**可选**配置入口，非阻断，与文档/变更统计共存

Given 成员已绑定 daemon
When 在概览页
Then WorkspaceConfigCard 显示已绑 daemon 信息 + 编辑/同步/scan（原行为，零回归）

### FR-04: daemon 依赖功能统一内联空态（DaemonRequiredNotice）
覆盖决策：D-003, D-004
Given 成员无自有 daemon（无 binding），访问 daemon 依赖页（运行时 / 扫描文档 / 组件拓扑源码）
When 页面主数据需 daemon（host_fs / daemon 实体）
Then 主区渲染 `DaemonRequiredNotice`："⚠ {feature} 需要守护进程" + [配置我的 daemon]（展开 WorkspaceAccessGuide）+ canBorrow 时提示可借；非阻断，页面其余部分正常

Given 成员已绑定/可借
When 访问 daemon 依赖页
Then 原行为（正常展示），零回归

### FR-05: 文档类页面 daemon 无关（不动）
覆盖决策：D-004
Given 成员（任意绑定状态）
When 访问文件中心 / 变更中心 / 成员管理 / 知识库 / 审计 / 审批 / 发布 / 事故
Then 正常浏览（数据在服务器，不经 daemon），无 daemon 要求、无空态

## 非功能需求

- **零回归**：已绑定用户的进门/编辑/跑 agent/借出/scan 行为完全不变；agent 页（task-13 canBorrow）不动。
- **兼容性**：纯前端，无 schema/API/后端变更；binding 数据模型不动。
- **可测试**：4 入口点进门自由化 + guard 降级 + DaemonRequiredNotice 渲染 + 各 daemon 依赖页空态，均有单测；180072（无 binding 成员）真实点页 verify。
- **三端**：桌面列表/switcher/详情 + 移动端列表同步放宽。

## 决策覆盖矩阵

| 决策 ID | 覆盖 FR | 说明 |
|---|---|---|
| D-001 | FR-01 | 进门权 = 成员 + 平台管理员 |
| D-002 | FR-03 | binding 保留为可选配置（复用 WorkspaceConfigCard） |
| D-003 | FR-04 | daemon 依赖页内联空态引导（非阻断） |
| D-004 | FR-01~05 | 方案 A：门禁完全后移 + 统一空态 |
