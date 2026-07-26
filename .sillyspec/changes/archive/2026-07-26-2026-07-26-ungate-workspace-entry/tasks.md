---
author: qinyi
created_at: 2026-07-26 14:24:00
---

# 任务清单（Tasks）— 工作区入口门禁后移

> 本清单为 brainstorm 阶段**粗粒度骨架**（对应 6 Phase）。详细 Wave/Task 拆分、依赖、验收点在 plan 阶段展开（`sillyspec run plan --change 2026-07-26-ungate-workspace-entry`）。

## W1: 进门自由化（Phase 1，4 入口点）
- task-01: `workspaces/page.tsx` `handleActivate` 移除未绑定→Dialog 分支（always 导航）+ 删 bindingTarget state + 列表页 Dialog 进门用法
- task-02: `workspace-switcher.tsx` `handleClickEntry` 移除未绑定→Dialog 分支（always switchWorkspace）+ 删顶栏 Dialog 进门用法 + 移除 ql-004 入口点 canBorrow 判定（随进门闸移除）
- task-03: `m/workspaces/page.tsx` `handleActivate` 移除未绑定→Dialog 分支（always 提示电脑端）

## W2: Guard 降级（Phase 2）
- task-04: `workspace-binding-guard.tsx` unbound 不再渲染绑定表单（return null），降级为已绑定编辑入口

## W3: 统一空态组件（Phase 4）
- task-05: 新建 `components/daemon-required-notice.tsx`（feature/workspaceId/canBorrow + 配置/借用按钮）+ 单测

## W4: daemon 依赖页接入空态（Phase 5，plan 逐一核实耦合点）
- task-06: `runtime/page.tsx` 无 binding 主区渲染 DaemonRequiredNotice（先核实 daemon 耦合）
- task-07: `scan-docs/page.tsx` 同（host_fs 读源码）
- task-08: `components/page.tsx` 同（组件拓扑读源码）
- 注：agent 页不改（task-13 canBorrow 已覆盖）

## W5: 概览 binding 配置（Phase 3+6 合并，复用既有）
- task-09: 核实 `workspaces/[id]/page.tsx` 的 WorkspaceConfigCard unbound 渲染友好（非重型表单占满屏），按需收敛为轻量引导（保留配置入口）

## W6: 测试 + 验证
- task-10: 各 `__tests__/page.test.tsx` + guard/switcher 测试更新（进门自由化 + guard 降级 + 空态断言）
- task-11: 180072（无 binding 成员）真实点开各页 verify（daemon 依赖页空态 + 文档类正常）

---

**关键路径**：task-01/02/03（进门）→ task-04（guard）→ task-05（空态组件）→ task-06/07/08（接入）→ task-10/11（验证）。

**待 plan 核实**：daemon 依赖页（runtime/scan-docs/components）精确 daemon 耦合点（R-01 P0），确保空态接入不漏；概览 WorkspaceConfigCard unbound 渲染是否需收敛（task-09）。
