---
author: qinyi
created_at: 2026-07-26 14:20:00
---

# 提案（Proposal）— 工作区入口门禁后移

## 一句话

把"绑定 daemon"从工作区**进门闸**降级为**可选配置**——工作区像 git 仓库，成员（+平台管理员）随时可进；daemon 只在真正需要它的操作点（跑 agent / 读源码 / 看运行时）要求，没有时显示内联引导（可配 / 可借），不再拦死进门。文档/数据类页面（文件中心、变更中心、成员、知识库…）完全 daemon 无关。

## 背景

当前"绑定 daemon"是进门闸（列表页/顶栏/移动端未绑定弹绑定 Dialog、详情 guard 未绑定渲染绑定表单），导致没自有 daemon 的成员（纯查看、临时协作、未配 daemon 的开发、业务/管理人员）进不去、看不了服务器端文档。

`2026-07-25-daemon-borrow-for-business`（已归档）已让 business_member 绕过进门闸，但其他无 daemon 成员仍被拦。根因不是 binding 概念（开发人员绑自己 daemon 跑 agent + 标 shared 借出都需要它），而是**把它做成了进门闸**。

## 方案（方案 A）

门禁完全后移 + 统一内联空态（`DaemonRequiredNotice`）：

1. **进门自由化（4 入口）**：列表/switcher/移动端/guard 移除"未绑定→拦"分支，点工作区直接进。
2. **Guard 降级**：unbound 不再渲染绑定表单（return null），已绑定保留"编辑接入配置"。
3. **概览 binding 配置（复用既有）**：`WorkspaceConfigCard`（已在概览渲染、含 `WorkspaceAccessGuide`）自然成可选配置入口——guard 降级后它接管，无新建。
4. **统一空态组件** `DaemonRequiredNotice`（新）：daemon 依赖页无 daemon 时内联"⚠ 此功能需守护进程" + 配置/借用按钮，非阻断。
5. **daemon 依赖页接入**：runtime / scan-docs / components（读源码）无 binding 主区渲染空态。agent 页已有 canBorrow（task-13）不改。

## 范围

- 纯前端改造，无后端 / 无 schema / 无 API 变更（membership 进门权后端已强制）。
- `scale=large`（多文件、跨多页、UX 模型变化）→ plan → execute。

## 不在范围内（Non-Goals）

- **不动 binding 数据模型**：`workspace_member_runtimes` 表/schema 不变；daemon-borrow 的 `shared` 列不动。
- **不动后端**：无 API/schema/鉴权变更（membership 进门权后端已强制）。
- **不动 agent 页**：task-13 的 `canBorrow` 门禁已正确，不改。
- **不动 daemon-borrow 借用链路**：borrow 解析/沙箱/落 file/审计均不动。
- **不重构工作区 tabs 结构**：tabs 不变，只改各页面对"无 daemon"的兜底。
- **不做 binding 配置的强引导**（首次进入弹窗等）：binding 纯可选，概览既有 WorkspaceConfigCard 接管即可。

## 决策

- D-001 进门权 = 工作区成员 + 平台管理员。
- D-002 binding 保留为可选配置（不删概念）。
- D-003 daemon 依赖页用内联空态引导（非阻断、不隐藏入口）。
- D-004 选方案 A（门禁完全后移 + 统一空态）。

详见 `design.md`。`tasks.md` 给粗粒度骨架，`plan.md`（plan 阶段）拆 Wave/Task。
